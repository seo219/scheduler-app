// src/api/gptScheduler.js
import OpenAI from 'openai';
import { TYPE_COLORS } from '../constants/typeColors';

/* ========================== 기본 설정 ========================== */
const MODEL = 'gpt-4o';           // 프로젝트에서 통일해 쓰는 기본 모델
const ENABLE_BROWSER = true;      // 브라우저에서 직접 호출(개발/로컬)

/* ============================ 유틸 ============================= */
const toMin = (hhmm = '00:00') => {
  const [h, m] = String(hhmm).split(':').map(n => parseInt(n, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};
const toHHMM = (min) => {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};
// HH:MM → 절대 분(기준 refStart 이전이면 다음날로 민다)
const toAbs = (hhmm, refStart) => {
  let m = toMin(hhmm);
  const ref = ((refStart % 1440) + 1440) % 1440;
  if (m < ref) m += 1440;
  return m;
};

const padHHMM = (s) => toHHMM(toMin(s));
const clamp = (t, lo, hi) => Math.max(lo, Math.min(hi, t));
const rnd = (x, step = 10) => Math.round(x / step) * step;

/** AI/로컬 생성 태스크 표준화(+ 메타 필드 보존) */
const normalizeTask = (t) => {
  const type = t.type || (t.task === '수면' ? 'sleep' : 'fixed');
  const task = t.task || t.activity || (type === 'sleep' ? '수면' : '');
  const activity = t.activity || task;
  return {
    start: padHHMM(t.start),
    end: padHHMM(t.end),
    type,
    task,
    activity,
    color: t.color || TYPE_COLORS[type] || undefined,
    _engine: t._engine,
    _reason: t._reason,
    // ===== 메타 (프롬프트 확장 필드 보존) =====
    detail: t.detail,
    place: t.place,
    area: t.area,
    transport: t.transport,
    travelMin: t.travelMin,
    cost: t.cost,         // "무료/저가/보통/비쌈"
    indoor: t.indoor,     // boolean
    tags: t.tags,         // string[]
  };
};

function normalizeFixedData(fixedData = {}) {
  const sleepTime = fixedData.sleepTime || { wakeUp: '06:00', bedTime: '22:00' };
  const meals = (fixedData.meals || []).map(m => ({
    start: padHHMM(m.start), end: padHHMM(m.end),
    type: 'meal', task: m.task || '식사', activity: '식사', color: TYPE_COLORS.meal,
  }));
  const schedules = (fixedData.schedules || []).map(s => ({
    start: padHHMM(s.start), end: padHHMM(s.end),
    type: 'fixed', task: s.task || '고정 일정', activity: s.task || '고정 일정', color: s.color || TYPE_COLORS.fixed,
  }));
  const wake = padHHMM(sleepTime.wakeUp || '06:00');
  const bed = padHHMM(sleepTime.bedTime || '22:00');
  return { sleepTime: { wakeUp: wake, bedTime: bed }, meals, schedules };
}

/** 모델이 앞뒤로 설명을 붙여도 JSON만 안정 추출 */
function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  if (s.startsWith('```')) s = s.replace(/^```[a-zA-Z-]*\n?/, '').replace(/```$/, '').trim();
  try { return JSON.parse(s); }
  catch (e) { if (import.meta.env?.DEV) console.debug('[extractJson] first parse fail', e); }
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i >= 0 && j > i) {
    try { return JSON.parse(s.slice(i, j + 1)); }
    catch (e) { if (import.meta.env?.DEV) console.debug('[extractJson] slice parse fail', e); }
  }
  return null;
}

/** 고정블록을 제외한 빈 구간 계산([s,e]는 절대분, cross-midnight 대응) */
function windowsFromFixed(dayStart, dayEnd, fixedBlocks) {
  let start = dayStart;
  let end = dayEnd;
  if (end <= start) end += 1440; // 자정 넘김

  const fixed = [...fixedBlocks]
    .map(b => {
      let s = toAbs(b.start, start);
      let e = toAbs(b.end, start);
      if (e <= s) e += 1440;
      s = clamp(s, start, end);
      e = clamp(e, start, end);
      return { ...b, s, e };
    })
    .filter(b => b.e > b.s)
    .sort((a, b) => a.s - b.s);

  const free = [];
  let cur = start;
  for (const b of fixed) {
    if (b.s > cur) free.push({ s: cur, e: b.s });
    cur = Math.max(cur, b.e);
  }
  if (cur < end) free.push({ s: cur, e: end });
  return free;
}

function isRestLabel(label = '') {
  const s = String(label).toLowerCase();
  return s.includes('휴식') || s.includes('휴게') || s.includes('rest') || s.includes('break');
}

const withEngine = (list, engine, reason) =>
  list.map(t => ({ ...t, _engine: engine, _reason: reason || null }));

/** 생성 결과를 윈도우에 맞춰 자르고, 겹침 제거/병합/휴식 상한 적용 */
function fitIntoWindows(
  rawTasks,
  { windows, dayStart, dayEnd, minBlock = 60, restMaxBlocks = 2, restMaxRatio = 0.2, forceType }
) {
  const clipped = [];
  for (const t0 of rawTasks || []) {
    const t = normalizeTask({ ...t0, type: forceType || t0.type });
    let s = rnd(toAbs(t.start, dayStart), 10);
    let e = rnd(toAbs(t.end, dayStart), 10);
    if (e <= s) continue;

    for (const w of windows) {
      const ss = Math.max(s, w.s), ee = Math.min(e, w.e);
      if (ee - ss >= minBlock) {
        clipped.push({ ...t, start: toHHMM(ss % 1440), end: toHHMM(ee % 1440), _s: ss, _e: ee });
        break;
      }
    }
  }

  clipped.sort((a, b) => a._s - b._s);
  const packed = [];
  for (const t of clipped) {
    const overlap = packed.some(p => Math.max(p._s, t._s) < Math.min(p._e, t._e));
    if (!overlap) packed.push(t);
  }

  const merged = [];
  for (const t of packed) {
    const last = merged[merged.length - 1];
    const name = t.task || t.activity;
    const lastName = last?.task || last?.activity;
    if (last && lastName === name && last.type === t.type && last._e === t._s) {
      last._e = t._e;
      last.end = t.end;
    } else {
      merged.push({ ...t });
    }
  }

  const totalSpan = (dayEnd <= dayStart ? dayEnd + 1440 : dayEnd) - dayStart;
  const restBlocks = merged.filter(x => isRestLabel(x.task || x.activity));
  const restTime = restBlocks.reduce((a, b) => a + (b._e - b._s), 0);

  const tooManyBlocks = restBlocks.length > restMaxBlocks;
  const tooMuchTime = restTime > totalSpan * restMaxRatio;
  if (tooManyBlocks || tooMuchTime) {
    const trimmed = [];
    let keptRest = 0, keptRestTime = 0;
    for (const t of merged) {
      if (isRestLabel(t.task || t.activity)) {
        const span = t._e - t._s;
        if (keptRest < restMaxBlocks && keptRestTime + span <= totalSpan * restMaxRatio) {
          trimmed.push(t);
          keptRest += 1;
          keptRestTime += span;
        }
      } else trimmed.push(t);
    }
    return trimmed.map(x => ({ ...x, _s: undefined, _e: undefined }));
  }
  return merged.map(x => ({ ...x, _s: undefined, _e: undefined }));
}

/* ===================== A) TODO 자동 배치(미래용) ===================== */
function buildTodoPrompt({ sleepTime, fixedBlocks, todos }) {
  const lines = [];
  lines.push('하루 일정표에서 빈 시간에 할 일을 배치하라.');
  lines.push(`- 기상: ${sleepTime.wakeUp}, 취침: ${sleepTime.bedTime}`);
  lines.push('- 이미 존재하는 고정 블록(겹치기 금지):');
  if (!fixedBlocks.length) lines.push('  - (없음)');
  fixedBlocks.forEach(b => lines.push(`  - ${b.start}~${b.end} ${b.task || b.activity || b.type}`));
  lines.push('- 투두(마감 빠른 순 우선):');
  if (!todos?.length) lines.push('  - (없음)');
  (todos || []).forEach((t, i) => lines.push(`  - ${i + 1}. ${t.text || t.task || '할일'} | due: ${t.dueDate || '없음'}`));
  lines.push('');
  lines.push('출력 JSON 예: {"tasks":[{"start":"HH:MM","end":"HH:MM","type":"todo","task":"문자열"}]}');
  lines.push('- 고정과 겹치지 않게. 10분 단위. 기본 60분 세션(필요시 30~90분).');
  lines.push('- 연속 작업은 같은 이름으로 배치(후처리 병합).');
  lines.push('- 코드블록 금지. JSON 객체 하나만.');
  return lines.join('\n');
}

export async function generateSchedule({ fixedData = {}, todoData = [] }) {
  const { sleepTime, meals, schedules } = normalizeFixedData(fixedData);
  const dayStart = toMin(sleepTime.wakeUp);
  const dayEnd = toMin(sleepTime.bedTime);
  const fixedBlocks = [...meals, ...schedules].map(normalizeTask);
  const windows = windowsFromFixed(dayStart, dayEnd, fixedBlocks);

  const apiKey = import.meta?.env?.VITE_OPENAI_API_KEY;
  const client = apiKey ? new OpenAI({
    apiKey,
    baseURL: import.meta?.env?.VITE_OPENAI_BASE_URL || undefined,
    dangerouslyAllowBrowser: ENABLE_BROWSER,
  }) : null;

  let aiTasks = null, reason = '';
  if (!client) reason = 'NO_API_KEY';

  if (client) {
    try {
      const prompt = buildTodoPrompt({ sleepTime, fixedBlocks, todos: todoData });
      const res = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      });
      const json = extractJson(res?.choices?.[0]?.message?.content || '');
      aiTasks = fitIntoWindows(Array.isArray(json?.tasks) ? json.tasks : [], {
        windows, dayStart, dayEnd, minBlock: 60, restMaxBlocks: 1, restMaxRatio: 0.1, forceType: 'todo',
      });
    } catch (e) {
      reason = e?.message || 'OPENAI_ERROR';
      console.warn('[generateSchedule] OpenAI 실패:', reason);
    }
  }

  if (!aiTasks || aiTasks.length === 0) {
    const sorted = [...(todoData || [])].sort((a, b) => (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31'));
    const raw = [];
    let i = 0;
    for (const w of windows) {
      let c = w.s;
      while (c + 60 <= w.e && i < sorted.length) {
        raw.push({ start: toHHMM(c), end: toHHMM(c + 60), type: 'todo', task: sorted[i++].text || '할 일' });
        c += 60;
      }
      if (i >= sorted.length) break;
    }
    aiTasks = withEngine(
      fitIntoWindows(raw, { windows, dayStart, dayEnd, minBlock: 60, forceType: 'todo', restMaxBlocks: 0, restMaxRatio: 0 }),
      'FALLBACK',
      reason || 'NO_AI_RESULT'
    );
  } else {
    aiTasks = withEngine(aiTasks, 'OPENAI', null);
  }

  return [...fixedBlocks, ...aiTasks].map(normalizeTask);
}

export async function generateSimpleSchedule({ fixedData = {}, todoData = [] }) {
  const tasks = await generateSchedule({ fixedData, todoData });
  return tasks.map(t => `${t.start} - ${t.task}`);
}

/* ===================== B) 관심사/컨디션 기반 휴일 ===================== */
const CATALOG = {
  '운동': ['조깅', '스트레칭', '요가', '근력 운동', '자전거 타기', '수영', '하이킹', '유산소', '코어 트레이닝'],
  '음악': ['악기 연습', '보컬 트레이닝', '작곡', '음악 감상', '리듬 트레이닝'],
  '미술': ['스케치', '수채화', '디지털 드로잉', '유화', '크로키'],
  '영화/드라마': ['영화 감상', '드라마 정주행', '감상 노트 정리', '리뷰 작성'],
  '독서': ['독서', '하이라이트 정리', '서평 작성', '독서 토론 준비'],
};

function buildHolidayPrompt({ interest, energy, sleepTime, windows, duration, targetSessions }) {
  const ws = windows.length
    ? windows.map(w => `- ${toHHMM(w.s)} ~ ${toHHMM(w.e)}`).join('\n')
    : '- (없음)';
  const lines = [];
  lines.push('휴일 하루 활동 일정을 JSON 한 개로 생성하라.');
  lines.push(`- 관심사: ${interest}`);
  lines.push(`- 컨디션: ${energy} (기본 세션 길이 ${duration}분)`);
  lines.push(`- 하루 총 세션 개수: ${targetSessions}개 (±1개 허용)`);
  lines.push(`- 기상: ${sleepTime.wakeUp}, 취침: ${sleepTime.bedTime}`);
  lines.push('- 아래 빈 시간 구간 안에서만 활동 배치(시작/종료 모두 구간 내부):');
  lines.push(ws);
  lines.push('');
  lines.push('규칙:');
  lines.push('- 고정/서로 겹치지 않게. 10분 단위로 반올림.');
  lines.push('- 세션 사이 휴식 최소 10분 확보.');
  lines.push('- 세션 사이 휴식 길이 컨디션에 맞게 조절.');
  lines.push('- 관심사에 맞는 다양한 하위 활동명을 섞을 것.');
  lines.push('- 휴식 항목은 과도하게 만들지 말 것(필요시 1~2개).');
  lines.push('- 동일 활동이 연속이면 같은 이름으로 배치(후처리 병합).');
  lines.push('');
  lines.push('출력 JSON 예: {"tasks":[{"start":"09:00","end":"10:00","type":"holiday","task":"요가"}]}');
  lines.push('- 코드블록 금지. JSON 객체 하나만.');
  return lines.join('\n');
}

function fallbackHoliday({ interest, energy, windows, duration, dayStart, dayEnd }) {
  const TARGET = { '피곤함': 3, '보통': 5, '에너지 충만': 6 }[energy] || 5;
  const BREAK = { '피곤함': 30, '보통': 20, '에너지 충만': 15 }[energy] || 20;
  const names = CATALOG[interest] || [interest + ' 활동'];
  let nameIdx = 0;

  const raw = [];
  let sessions = 0;

  for (const w of windows) {
    let cursor = Math.ceil(w.s / 10) * 10;
    while (cursor + duration <= w.e && sessions < TARGET) {
      const start = cursor, end = start + duration;
      raw.push({ start: toHHMM(start), end: toHHMM(end), type: 'holiday', task: names[nameIdx % names.length], color: TYPE_COLORS.holiday });
      nameIdx += 1;
      sessions += 1;
      cursor = end + BREAK;
    }
    if (sessions >= TARGET) break;
  }

  return fitIntoWindows(raw, {
    windows, dayStart, dayEnd, minBlock: duration,
    restMaxBlocks: 2, restMaxRatio: 0.2, forceType: 'holiday',
  });
}

export async function generateHolidaySchedule({ interest, energy, fixedData = {} }) {
  const ENERGY = {
    '피곤함': { wakeUp: '10:00', bedTime: '21:30', duration: 45, target: 3 },
    '보통': { wakeUp: '09:00', bedTime: '22:00', duration: 60, target: 5 },
    '에너지 충만': { wakeUp: '08:00', bedTime: '23:00', duration: 90, target: 6 },
  };

  const base = normalizeFixedData({
    ...fixedData,
    sleepTime: fixedData?.sleepTime ?? ENERGY[energy] ?? undefined,
  });
  const { sleepTime, meals, schedules } = base;
  const dayStart = toMin(sleepTime.wakeUp);
  const dayEnd = toMin(sleepTime.bedTime);
  const duration = ENERGY[energy]?.duration || 60;
  const targetSessions = ENERGY[energy]?.target || 5;

  const fixedBlocks = [...meals, ...schedules].map(normalizeTask);
  const windows = windowsFromFixed(dayStart, dayEnd, fixedBlocks);

  const apiKey = import.meta?.env?.VITE_OPENAI_API_KEY;
  const client = apiKey ? new OpenAI({
    apiKey,
    baseURL: import.meta?.env?.VITE_OPENAI_BASE_URL || undefined,
    dangerouslyAllowBrowser: ENABLE_BROWSER,
  }) : null;

  let aiTasks = null, reason = '';
  if (!client) reason = 'NO_API_KEY';

  if (client) {
    try {
      const prompt = buildHolidayPrompt({ interest, energy, sleepTime, windows, duration, targetSessions });
      const res = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      });
      const json = extractJson(res?.choices?.[0]?.message?.content || '');
      aiTasks = fitIntoWindows(Array.isArray(json?.tasks) ? json.tasks : [], {
        windows, dayStart, dayEnd,
        minBlock: duration,
        restMaxBlocks: 2, restMaxRatio: 0.2,
        forceType: 'holiday',
      });
    } catch (e) {
      reason = e?.message || 'OPENAI_ERROR';
      console.warn('[generateHolidaySchedule] OpenAI 실패:', reason);
    }
  }

  if (!aiTasks || aiTasks.length === 0) {
    aiTasks = withEngine(fallbackHoliday({ interest, energy, windows, duration, dayStart, dayEnd }), 'FALLBACK', reason || 'NO_AI_RESULT');
  } else {
    aiTasks = withEngine(aiTasks, 'OPENAI', null);
  }

  return [...fixedBlocks, ...aiTasks].map(normalizeTask);
}

/* ========== C) 프리폼(자유 메모) 기반 휴일 — 현실성/다양성 강화 프롬프트 ========== */
export function buildHolidayFreeformPrompt({
  dateKey,
  freeText,
  autonomy = 70,
  tz = 'Asia/Seoul',
  fixedData = {},
  language = 'ko',
}) {
  // 앵커/윈도우 계산
  const base = normalizeFixedData(fixedData);
  const { sleepTime, meals, schedules } = base;
  const dayStart = toMin(sleepTime.wakeUp);
  const dayEnd = toMin(sleepTime.bedTime);
  const fixedBlocks = [...meals, ...schedules].map(normalizeTask);
  const windows = windowsFromFixed(dayStart, dayEnd, fixedBlocks);

  /* ───────── system ───────── */
  const system = [
    '당신은 세밀한 휴일/나들이 일정 플래너입니다.',
    '다음 제약을 모두 지키며, 현실적인 “하루 계획표”를 만듭니다.',
    '',
    '■ 출력',
    "- 오직 유효한 JSON 객체 하나만 반환(코드블록 금지).",
    "- 시간 형식은 24시간제 'HH:mm'. 모든 구간은 제공된 windows 내부에 완전히 포함, 서로 겹치지 않음.",
    '- 10분 단위로 반올림. 연속 세션 사이에는 5–15분 마이크로 브레이크 또는 이동을 배치.',
    '',
    '■ 다양성/현실성 원칙',
    '- 테마 다양성: 동일 활동 연속 남발 금지. 가벼운/집중/휴식이 리듬을 이루도록 구성.',
    '- 지리/동선: 근접한 장소를 묶어 “클러스터링”하고 지그재그 이동 금지.',
    '- 이동 고려: 장소가 바뀌면 이동 세션을 별도 블록으로 추가하거나 다음 세션 시작 시간에 이동 시간을 반영.',
    '  · 동일 권역(area): 10–15분, 인접 권역: 20–30분, 원거리/혼잡: 40–60분을 가이드라인으로 사용.',
    '- 시간대 리듬: 오전 워밍업(가벼운 활동), 점심 후 저강도, 오후 피크에 중강도, 밤에는 쿨다운.',
    '- 식사/카페: 기본 45–90분, 필요 시 ±30분 조정 가능(단, 전체 리듬 유지).',
    '- 날씨/온도: 비/눈/강풍/폭염/한파가 보이면 실내 비중을 늘리고 이동/대기 시간을 넉넉히.',
    '- 예산: 활동별 대략적 비용 레이블(무료/저가/보통/비쌈) 포함.',
    '',
    '■ 안전/휴식',
    '- 과도한 휴식 생성 금지(총 시간의 20% 이내, 블록 1–2개 권장).',
    '- 취침 60–90분 전에 고강도 활동 금지. 마지막은 정리/산책/가벼운 여가로 마무리.',
    '',
    '■ 필드 정의',
    "- tasks[].type은 기본 'holiday'.",
    '- 권장 추가 필드: detail, place, area, transport, travelMin, cost, indoor, tags(string[]).',
    '',
    '■ 반려 조건',
    '- windows가 짧거나 비어 있으면, 가능한 구간에 맞춰 40–150분 사이 블록을 3–6개 배치.',
    '',
    '반드시 JSON만 반환하세요.',
  ].join('\n');

  /* ───────── user ───────── */
  const userObj = {
    dateKey,
    tz,
    language,
    autonomy,  // 0~100: 높을수록 창의적 제안/시간 미세조정 허용(하드 제약 준수)
    anchors: {
      sleepTime,
      meals,             // 소프트 앵커: ±30분 조정 가능
      schedules,         // 하드 앵커: 겹치기 금지
    },
    windows: windows.map(w => ({ start: toHHMM(w.s), end: toHHMM(w.e) })),
    preferences: {
      freeText,               // 사용자가 쓴 선호/금기/예산/동반자/가고 싶은 곳 등
      diversity: true,        // 활동/장소/강도 다양성
      clusterByArea: true,    // 동선 최소화
      includeBreaks: true,    // 마이크로 브레이크/이동 포함
    },
    rules: {
      hard: {
        obeyWindows: true,
        nonOverlapping: true,
        timeFormat: 'HH:mm',
      },
      soft: {
        minBlockMin: 40,
        maxBlockMin: 150,
        microBreakMin: [5, 15],
        adjustMealsMinutes: 30,
        maxRestRatio: 0.2,
        preferIndoorIfBadWeather: true,
      },
      travelHeuristics: {
        sameAreaMin: 10, sameAreaMax: 15,
        adjacentAreaMin: 20, adjacentAreaMax: 30,
        farOrCongestedMin: 40, farOrCongestedMax: 60,
      },
    },
  };

  const schema = {
    type: 'object',
    required: ['tasks', 'assumptions', 'notes'],
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          required: ['start', 'end', 'task'],
          properties: {
            start: { type: 'string', description: 'HH:mm' },
            end: { type: 'string', description: 'HH:mm' },
            task: { type: 'string' },
            type: { type: 'string', enum: ['holiday', 'fixed', 'meal', 'sleep'] },
            detail: { type: 'string' },
            place: { type: 'string' },
            area: { type: 'string' },
            transport: { type: 'string', description: '도보/지하철/버스/차 등' },
            travelMin: { type: 'number' },
            cost: { type: 'string', description: '무료/저가/보통/비쌈' },
            indoor: { type: 'boolean' },
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      assumptions: { type: 'array', items: { type: 'string' } },
      notes: { type: 'string' },
    },
  };

  const user =
    `USER_INPUT:\n${JSON.stringify(userObj, null, 2)}\n\n` +
    `RESPONSE_FORMAT (JSON Schema):\n${JSON.stringify(schema, null, 2)}\n\n` +
    `반드시 위 스키마에 맞는 단 하나의 JSON 객체만 반환하세요.`;

  return { system, user, context: { windows, dayStart, dayEnd, fixedBlocks } };
}

export async function generateHolidayScheduleFreeform({
  dateKey,
  freeText,
  autonomy = 70,
  tz = 'Asia/Seoul',
  fixedData = {},
  language = 'ko',
}) {
  const { system, user, context } = buildHolidayFreeformPrompt({ dateKey, freeText, autonomy, tz, fixedData, language });
  const { windows, dayStart, dayEnd, fixedBlocks } = context;

  const apiKey = import.meta?.env?.VITE_OPENAI_API_KEY;
  const client = apiKey ? new OpenAI({
    apiKey,
    baseURL: import.meta?.env?.VITE_OPENAI_BASE_URL || undefined,
    dangerouslyAllowBrowser: ENABLE_BROWSER,
  }) : null;

  let aiTasks = null, reason = '';
  if (!client) reason = 'NO_API_KEY';

  if (client) {
    try {
      const res = await client.chat.completions.create({
        model: MODEL,
        temperature: 0.6,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      const json = extractJson(res?.choices?.[0]?.message?.content || '');
      const raw = Array.isArray(json?.tasks) ? json.tasks : [];
      aiTasks = fitIntoWindows(raw, {
        windows, dayStart, dayEnd,
        minBlock: 40, restMaxBlocks: 2, restMaxRatio: 0.2,
        forceType: 'holiday',
      });
    } catch (e) {
      reason = e?.message || 'OPENAI_ERROR';
      console.warn('[generateHolidayScheduleFreeform] OpenAI 실패:', reason);
    }
  }

  if (!aiTasks || aiTasks.length === 0) {
    // 폴백: freeText를 힌트로 간단 생성
    const names = /산책|걷/i.test(freeText) ? ['근처 산책', '카페 타임', '가벼운 취미']
      : /영화|극장/i.test(freeText) ? ['영화 감상', '간식', '감상 메모']
        : /전시|미술|박물/i.test(freeText) ? ['전시 관람', '카페 휴식', '정리/느낀점']
          : ['취미/가벼운 활동', '리프레시', '가벼운 외식'];
    const block = 60;
    const raw = [];
    for (const w of windows) {
      let c = Math.ceil(w.s / 10) * 10;
      let i = 0;
      while (c + block <= w.e && i < names.length) {
        raw.push({ start: toHHMM(c), end: toHHMM(c + block), type: 'holiday', task: names[i++] });
        c += block + 20;
      }
      if (raw.length >= names.length) break;
    }
    aiTasks = withEngine(
      fitIntoWindows(raw, { windows, dayStart, dayEnd, minBlock: 40, forceType: 'holiday' }),
      'FALLBACK',
      reason || 'NO_AI_RESULT'
    );
  } else {
    aiTasks = withEngine(aiTasks, 'OPENAI', null);
  }

  return [...fixedBlocks, ...aiTasks].map(normalizeTask);
}

/* ======================= 공용 유틸(타 페이지에서 사용) ======================= */
export function generateSlotTimes(start = '06:00', end = '22:00', stepMinutes = 10) {
  const s = toMin(start), e = toMin(end);
  const out = [];
  for (let t = s; t <= e; t += stepMinutes) out.push(toHHMM(t));
  return out;
}

/* ============================== 경고 로그 ============================== */
const apiKey = import.meta.env.VITE_OPENAI_API_KEY || '';
if (!apiKey) console.warn('API Key가 설정되지 않았습니다!');
