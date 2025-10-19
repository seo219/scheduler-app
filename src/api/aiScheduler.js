// src/api/aiScheduler.js

// ============= 유틸 =============
export function toMin(hhmm = "00:00") {
  if (!hhmm || typeof hhmm !== "string") return 0;
  const [h, m] = hhmm.split(":").map(v => parseInt(v, 10));
  const H = Number.isFinite(h) ? h : 0;
  const M = Number.isFinite(m) ? m : 0;
  return Math.min(24 * 60, Math.max(0, H * 60 + M));
}

export function toHHMM(min) {
  const clamped = Math.min(24 * 60, Math.max(0, Math.round(min)));
  const h = String(Math.floor(clamped / 60)).padStart(2, "0");
  const m = String(clamped % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function mergeIntervals(intervals) {
  if (!intervals?.length) return [];
  const arr = [...intervals].sort((a, b) => a.s - b.s);
  const merged = [];
  for (const cur of arr) {
    if (!merged.length || merged[merged.length - 1].e <= cur.s) {
      merged.push({ s: cur.s, e: cur.e, label: cur.label });
    } else {
      merged[merged.length - 1].e = Math.max(merged[merged.length - 1].e, cur.e);
    }
  }
  return merged.map(x => ({
    s: Math.max(0, x.s),
    e: Math.min(24 * 60, x.e),
    label: x.label
  }));
}

// ============= 바쁜 시간 계산 =============
/**
 * fixedData 구조 예시:
 * {
 *   sleepTime: { wakeUp: "07:30", bedTime: "23:30" },
 *   meals: [{ type:"아침", start:"08:00", end:"08:30" }, ...],
 *   schedules: [{ task:"학교", start:"13:00", end:"17:00" }, ...]
 * }
 */
export function computeBusyIntervals(fixedData) {
  const busy = [];
  const st = fixedData?.sleepTime;

  // 수면: "오늘 0~24h" 관점에서만 막는다.
  // 자정 넘김(기상 > 취침)일 땐 '기상 전 구간'만 막고 취침은 내일로 간주한다.
  if (st?.wakeUp || st?.bedTime) {
    const w = st?.wakeUp != null ? toMin(st.wakeUp) : null; // 기상
    const b = st?.bedTime != null ? toMin(st.bedTime) : null; // 취침

    if (w != null && b != null) {
      if (b >= w) {
        // 일반: 00:00~기상 / 취침~24:00
        busy.push({ s: 0, e: w, label: "수면" });
        busy.push({ s: b, e: 24 * 60, label: "수면" });
      } else {
        // 자정 넘김: 00:00~기상만 막는다 (취침은 다음날)
        busy.push({ s: 0, e: w, label: "수면" });
      }
    } else if (w != null) {
      busy.push({ s: 0, e: w, label: "수면" });
    } else if (b != null) {
      busy.push({ s: b, e: 24 * 60, label: "수면" });
    }
  }

  (fixedData?.meals || []).forEach(m => {
    if (m?.start && m?.end) {
      busy.push({ s: toMin(m.start), e: toMin(m.end), label: m.type || "식사" });
    }
  });

  (fixedData?.schedules || []).forEach(s => {
    if (s?.start && s?.end) {
      busy.push({ s: toMin(s.start), e: toMin(s.end), label: s.task || "고정" });
    }
  });

  return mergeIntervals(busy);
}

// ============= 빈 시간 구하기 =============
export function findFreeSlots(busyIntervals) {
  const busy = mergeIntervals(busyIntervals);
  const free = [];
  let cursor = 0;

  for (const b of busy) {
    if (cursor < b.s) free.push({ s: cursor, e: b.s });
    cursor = Math.max(cursor, b.e);
  }
  if (cursor < 24 * 60) free.push({ s: cursor, e: 24 * 60 });

  return free;
}

// ============= TODO 배치 =============
/**
 * todos: [{ id, title, duration(min), priority, dueDate }]
 * freeSlots: [{ s, e }]
 * options:
 *   - allowSplit: 긴 할 일을 여러 슬롯으로 쪼개기
 *   - minBlock: 분할 시 최소 블록 길이(분)
 *   - spacing: 각 작업 사이 간격(분)
 *   - taskType: 저장 시 type
 *   - taskColor: 색상 힌트
 */
export function packTodosIntoSlots(
  todos,
  freeSlots,
  options = {}
) {
  const {
    allowSplit = false,
    minBlock = 15,
    spacing = 0,
    taskType = "todo",
    taskColor = "#F0F0F0"
  } = options;

  const list = [...(todos || [])].map(t => ({
    ...t,
    duration: Number.isFinite(+t.duration) ? +t.duration : 30,
    priority: Number.isFinite(+t.priority) ? +t.priority : 0
  }));

  // 우선순위 높은 것 먼저, 마감일 빠른 것 먼저
  list.sort((a, b) => (b.priority - a.priority) || String(a.dueDate).localeCompare(String(b.dueDate)));

  const free = [...(freeSlots || [])].map(x => ({ s: x.s, e: x.e }));
  const placed = [];
  const leftovers = [];

  const slotLen = s => s.e - s.s;

  for (const work of list) {
    let need = work.duration;
    let placedOnce = false;

    for (let i = 0; i < free.length && need > 0; i++) {
      const slot = free[i];
      const len = slotLen(slot);
      if (len < minBlock) continue;

      if (!allowSplit) {
        if (len >= need) {
          const start = slot.s;
          const end = start + need;
          placed.push({
            id: work.id,
            title: work.title || work.task || "할 일",
            start: toHHMM(start),
            end: toHHMM(end),
            type: taskType,
            color: taskColor
          });
          // 슬롯 소비
          slot.s = end + spacing;
          placedOnce = true;
          need = 0;
          break;
        }
      } else {
        // 분할 배치
        const chunk = Math.max(minBlock, Math.min(len, need));
        const start = slot.s;
        const end = start + chunk;
        placed.push({
          id: work.id,
          title: work.title || work.task || "할 일",
          start: toHHMM(start),
          end: toHHMM(end),
          type: taskType,
          color: taskColor
        });
        slot.s = end + spacing;
        need -= chunk;
        placedOnce = true;
        i--; // 같은 슬롯(남은 길이) 계속 사용
      }
    }

    if (need > 0 && !placedOnce) {
      leftovers.push(work);
    }
  }

  // 길이가 0 이하가 된 슬롯 제거
  const cleanedFree = free.filter(s => s.e - s.s >= minBlock);

  return { placed, leftovers, free: cleanedFree };
}
