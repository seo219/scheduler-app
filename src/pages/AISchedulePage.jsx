// src/pages/AISchedulePage.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { auth, db } from "../firebaseConfig";
import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import "./AISchedulePage.css"; // 외부 CSS 파일 참조

/* =================== time helpers =================== */
const DAY = 1440;
const pad = (n) => String(n).padStart(2, "0");
const fmtHM = (absMin) => {
  const x = ((absMin % DAY) + DAY) % DAY;
  const h = Math.floor(x / 60);
  const mi = x % 60;
  return `${pad(h)}:${pad(mi)}`;
};

/* 날짜 → ms, D-표시용 */
function startOfDayMs(d) {
  const dt = new Date(d);
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
}
function ymd(ms) {
  const d = new Date(ms); const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}


/* NEW: 마감일을 숫자 시간으로 안전하게 변환 */
function dueTime(v) {
  try {
    if (v == null || v === "") return Number.POSITIVE_INFINITY;
    if (v?.toDate) return +v.toDate();
    if (v instanceof Date) return +v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const m = v.match(/(\d{4})\D*(\d{1,2})\D*(\d{1,2})/);
      if (m) return +new Date(+m[1], +m[2] - 1, +m[3]); // YYYY, M, D
      const p = Date.parse(v);
      if (Number.isFinite(p)) return p;
    }
  } catch { /* ignore parse errors */ }
  return Number.POSITIVE_INFINITY;
}


function safeToMin(v) {
  if (v == null) return NaN;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim();

  let m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = +m[1], mi = +m[2];
    if (h >= 0 && h < 48 && mi >= 0 && mi < 60) return h * 60 + mi;
    return NaN;
  }
  m = s.match(/^(\d{2})(\d{2})$/);
  if (m) {
    const h = +m[1], mi = +m[2];
    if (h >= 0 && h < 48 && mi >= 0 && mi < 60) return h * 60 + mi;
    return NaN;
  }
  m = s.match(/(\d{1,2})\s*시\s*(\d{1,2})?\s*분?/);
  if (m) {
    const h = +m[1], mi = m[2] ? +m[2] : 0;
    if (h >= 0 && h < 48 && mi >= 0 && mi < 60) return h * 60 + mi;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** 수면에서 window 계산: start=기상(end), end=취침(start)+24h */
function windowFromSleepIntervals(genBusy) {
  const sleeps = genBusy.filter(
    (t) =>
      t.type === "sleep" ||
      /수면|sleep/i.test(t.task || "") ||
      /수면|sleep/i.test(t.label || "")
  );
  if (!sleeps.length) return null;

  let best = null, bestDur = -1;
  for (const s of sleeps) {
    const st = safeToMin(s.start ?? s.s);
    const en = safeToMin(s.end ?? s.e);
    if (!Number.isFinite(st) || !Number.isFinite(en)) continue;
    const dur = (en + DAY - st) % DAY;
    if (dur > bestDur) { bestDur = dur; best = { st, en }; }
  }
  if (!best) return null;

  const wake = best.en;
  let bed = best.st;
  if (bed <= wake) bed += DAY;
  return { startMin: wake, endMin: bed };
}

/** 자정 넘김 대비 복제(0~1440, 1440~2880) */
function duplicateForWrap(list) {
  const out = [];
  for (const t of list) {
    const s = safeToMin(t.start ?? t.s);
    const e = safeToMin(t.end ?? t.e);
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
    const disp = (t.task || t.title || t.label || t.type || "").trim();
    out.push({ ...t, s, e, disp });
    out.push({ ...t, s: s + DAY, e: e + DAY, disp });
  }
  return out;
}

/* =================== page =================== */
export default function AISchedulePage() {
  const navigate = useNavigate();
  const { date } = useParams();
  const baseDayMs = useMemo(() => startOfDayMs(new Date()), []);

  const [loading, setLoading] = useState(true);
  const [timeline, setTimeline] = useState({ startMin: 0, endMin: DAY });
  const [busyView, setBusyView] = useState([]); // 표시/계산용(복제 포함, 절대분)

  const [todos, setTodos] = useState([]);
  const [blockedTicks, setBlockedTicks] = useState(new Set()); // 절대분 10분 틱
  const [previewTicks, setPreviewTicks] = useState(new Map()); // absMin → title 
  const [leftovers, setLeftovers] = useState([]);
  const [pick, setPick] = useState(null); // 미리보기 선택 칸(absMin)

  const user = auth.currentUser;

  useEffect(() => {
    (async () => {
      if (!user) { navigate("/login"); return; }
      setLoading(true);
      try {
        // 하루 문서
        const dayRef = doc(db, "users", user.uid, "dailySchedules", date);
        const daySnap = await getDoc(dayRef);
        const day = daySnap.exists() ? daySnap.data() : {};

        const g = (Array.isArray(day?.generatedTasks) ? day.generatedTasks : [])
          .filter((t) => (t.start ?? t.timeStart) && (t.end ?? t.timeEnd) && t.type !== "todo")
          .map((t) => ({
            start: t.start ?? t.timeStart,
            end: t.end ?? t.timeEnd,
            type: t.type || "fixed",
            task: t.task || t.title || "",
            label: t.label || t.type || "",
          }))
          .filter((t) => {
            const s = safeToMin(t.start), e = safeToMin(t.end);
            return Number.isFinite(s) && Number.isFinite(e) && e > s;
          });

        const win = windowFromSleepIntervals(g) ?? { startMin: 0, endMin: DAY };
        setTimeline(win);
        setBusyView(duplicateForWrap(g));

        // 할 일
        const todosRef = collection(db, "users", user.uid, "todos");
        const snap = await getDocs(todosRef);
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const undone = rows.filter((x) => x.isDone !== true);
        const mapped = undone.map((x) => ({
          id: x.id,
          title: x.title || x.text || x.task || "할 일",
          priority: Number.isFinite(+x.priority) ? +x.priority : 0,
          dueDate: x.dueDate || "",
          minMinutes: "",
          maxMinutes: "",
          enabled: true,
        }));
        setTodos(mapped);

        // 초기화
        setPreviewTicks(new Map());
        setBlockedTicks(new Set());
        setLeftovers([]);
        setPick(null);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, date]);

  /* =================== 화면 헬퍼 =================== */
  const ticks = useMemo(() => {
    const arr = [];
    for (let m = timeline.startMin; m < timeline.endMin; m += 10) arr.push(m);
    return arr;
  }, [timeline]);

  const busyInfoAt = (m) => {
    const iv = busyView.find((b) => b.s <= m && m < b.e);
    if (!iv) return null;
    const label = (iv.disp || iv.task || iv.label || iv.type || "").trim();
    let kind = "fixed";
    if (iv.type === "sleep" || /수면|sleep/i.test(label)) kind = "sleep";
    else if (iv.type === "meal" || /식|meal/i.test(label)) kind = "meal";
    return { label, kind };
  };

  const isBlocked = (m) => blockedTicks.has(m);
  const toggleBlock = (m) => {
    if (m === timeline.startMin) return;
    if (m >= timeline.endMin) return;
    if (busyInfoAt(m)) return; // 바쁜 칸은 차단 불가
    setBlockedTicks((prev) => {
      const next = new Set(prev);
      next.has(m) ? next.delete(m) : next.add(m);
      return next;
    });
  };

  /* =================== free ticks =================== */
  function buildFreeTicks() {
    const busySet = new Set();
    for (let m = timeline.startMin; m < timeline.endMin; m += 10) {
      const busy = busyView.some((iv) => iv.s <= m && m < iv.e);
      if (busy) busySet.add(m);
    }
    for (const t of blockedTicks)
      if (t >= timeline.startMin && t < timeline.endMin) busySet.add(t);

    // 특별 처리: '기상' 틱을 busy로 처리해서 AI가 빈 시간으로 보지 않게 함
    if (Number.isFinite(timeline.startMin)) {
      const wakeTick = timeline.startMin;
      if (wakeTick >= timeline.startMin && wakeTick < timeline.endMin) {
        busySet.add(wakeTick);
      }
    }


    const free = [];
    for (let m = timeline.startMin; m < timeline.endMin; m += 10) {
      if (!busySet.has(m)) free.push(m);
    }
    return free;
  }

  /* ===== 최소/최대 반영 + water-filling ===== */
  function distributeWithBounds(freeTicks, todoList) {
    const K = todoList.length, N = freeTicks.length;
    if (K === 0 || N === 0) return { previewMap: new Map(), leftovers: todoList.slice() };

    const sorted = todoList
      .map((t, idx) => ({
        ...t,
        _due: dueTime(t.dueDate),
        _idx: idx,
      }))
      .sort((a, b) => (a._due - b._due) || (b.priority - a.priority) || (a._idx - b._idx));

    const metas = sorted.map((t) => {
      // 최소(분) → 10분 단위 올림
      const minTicksRaw = Math.max(0, Math.ceil((t.minMinutes ? +t.minMinutes : 0) / 10));

      // 최대(분) 해석:
      // - 입력 비어있음/NaN ⇒ 무제한
      // - 숫자 ≥0 ⇒ 그 값을 10분 단위 내림 (0 이면 정확히 0)
      let maxTicks;
      if (t.maxMinutes === "" || t.maxMinutes == null) {
        maxTicks = Number.MAX_SAFE_INTEGER;
      } else {
        const parsed = Math.max(0, Math.floor((+t.maxMinutes) / 10));
        maxTicks = Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
      }

      // 최대가 0이면 완전 금지, 그 외엔 최소가 최대를 넘지 않게 클램프
      const minTicks = Math.min(minTicksRaw, maxTicks);

      return { id: t.id, title: t.title, minTicks, maxTicks, got: 0, ticks: [] };
    });

    // 1) 최소 선배정
    let cursor = 0;
    for (const m of metas) {
      const want = Math.min(m.minTicks, m.maxTicks);
      const take = Math.min(want, N - cursor);
      if (take > 0) {
        m.ticks.push(...freeTicks.slice(cursor, cursor + take));
        m.got += take;
        cursor += take;
      }
    }

    const totalMinNeed = metas.reduce((s, x) => s + Math.min(x.minTicks, x.maxTicks), 0);
    if (totalMinNeed > N) {
      const leftovers = metas
        .filter(x => x.got < x.minTicks)
        .map(x => ({ id: x.id, title: x.title, need: x.minTicks - x.got }));
      const previewMap = new Map();
      for (const m of metas) for (const t of m.ticks) previewMap.set(t, m.title);
      return { previewMap, leftovers };
    }

    // 2) water-filling
    let R = N - cursor;
    const current = metas.map(m => m.got);
    const cap = metas.map(m => m.maxTicks);

    while (R > 0) {
      let elig = metas.map((_, i) => i).filter(i => current[i] < cap[i]);
      if (!elig.length) break;

      elig.sort((i, j) => (current[i] - current[j]) || (i - j));
      const base = current[elig[0]];
      let L = [elig[0]];
      for (let k = 1; k < elig.length; k++) {
        if (current[elig[k]] === base) L.push(elig[k]); else break;
      }
      const nextLevel = (L.length < elig.length) ? current[elig[L.length]] : Number.POSITIVE_INFINITY;
      const minCapLevel = Math.min(...L.map(i => cap[i]));
      const target = Math.min(nextLevel, minCapLevel);
      let delta = target - base;
      if (delta <= 0) { elig = elig.filter(i => current[i] < cap[i]); if (!elig.length) break; continue; }

      const cost = delta * L.length;
      if (R >= cost) {
        for (const i of L) current[i] += delta;
        R -= cost;
      } else {
        const q = Math.floor(R / L.length);
        const r = R % L.length;
        if (q > 0) { for (const i of L) current[i] += q; R -= q * L.length; }
        for (let k = 0; k < r; k++) { current[L[k]] += 1; R -= 1; }
      }
    }

    // 3) 추가분 연속 부여
    for (let i = 0; i < metas.length; i++) {
      const add = current[i] - metas[i].got;
      if (add > 0) {
        metas[i].ticks.push(...freeTicks.slice(cursor, cursor + add));
        metas[i].got += add;
        cursor += add;
      }
    }

    const previewMap = new Map();
    for (const m of metas) for (const t of m.ticks) previewMap.set(t, m.title);
    return { previewMap, leftovers: [] };
  }

  /* =================== 스케줄 생성/적용 =================== */
  const handleGenerate = () => {
    const freeTicks = buildFreeTicks();
    if (!freeTicks.length) { alert("빈 시간이 없습니다."); return; }
    if (!todos.length) { alert("스케줄링할 할 일이 없습니다."); return; }

    const { previewMap, leftovers: lo } = distributeWithBounds(
      freeTicks,
      todos.filter(t => t.enabled !== false)  // ✅ 활성만 스케줄링
    );
    setPreviewTicks(previewMap);
    setLeftovers(lo);
    setPick(null);
    if (lo.length) {
      const msg = lo.map(l => `${l.title}: 최소 ${l.need * 10}분 미충족`).join("\n");
      alert("빈 시간이 최소 요구량보다 부족합니다.\n\n" + msg + "\n\n가능한 범위에서 우선 배정했어요.");
    }
  };

  const handleApply = async () => {
    if (!user) { navigate("/login"); return; }
    if (previewTicks.size === 0) { alert("먼저 미리보기를 생성하세요."); return; }

    // 연속 블록으로 병합
    const placed = [];
    let s = null, cur = null;
    for (let m = timeline.startMin; m < timeline.endMin; m += 10) {
      const t = previewTicks.get(m) || "";
      if (!cur && t) { cur = t; s = m; }
      else if (cur && t !== cur) { placed.push({ title: cur, absStart: s, absEnd: m }); cur = t; s = t ? m : null; }
    }
    if (cur && s != null) placed.push({ title: cur, absStart: s, absEnd: timeline.endMin });

    // 저장
    const dayRef = doc(db, "users", user.uid, "dailySchedules", date);
    const snap = await getDoc(dayRef);
    const before = snap.exists() ? snap.data() : {};
    const prevTasks = Array.isArray(before.generatedTasks) ? before.generatedTasks : [];
    const kept = prevTasks.filter((t) => !(t?.origin === "ai" && t?.type === "todo"));

    const next = [
      ...kept,
      ...placed.map((p) => ({
        start: fmtHM(p.absStart),
        end: fmtHM(p.absEnd),
        task: p.title,
        type: "todo",
        origin: "ai",
      })),
    ];
    await setDoc(
      dayRef,
      { generatedTasks: next, updatedAt: new Date().toISOString() },
      { merge: true }
    );
    alert("일정에 반영했습니다.");
    navigate(`/calendar?date=${date}`);
  };

  /* =================== render =================== */

  const todosSorted = useMemo(() => {
    return todos
      .map((t, i) => ({ ...t, _due: dueTime(t.dueDate), _idx: i }))
      .sort((a, b) =>
        (a._due - b._due) ||
        ((a.priority ?? 0) - (b.priority ?? 0)) ||
        (a._idx - b._idx)
      );
  }, [todos]);


  if (loading) return <div className="ai-schedule container">로딩중…</div>;

  return (
    <div className="ai-schedule container">
      {/* 🗑️ 인라인 스타일 오버라이드 블록을 제거합니다. */}
      <h1>{date} AI 스케줄링</h1>

      {/* 🗑️ 상단 버튼 바 제거됨 */}

      {/* 할 일 목록 제목 */}
      <div className="section-head">
        <h3 className="section-title">할 일 ({todos.length})</h3>
        {/* 🚨 참고: 여기서 '차단 초기화' 버튼이 제거됨. 하단 plan-head로 이동 */}
      </div>

      {/* === 대상 할 일 목록 === */}
      <div className="todo-pills">
        {todosSorted.map((t, idx) => (
          <div className={`pill ${t.enabled === false ? 'disabled' : ''} ${idx === 0 ? 'is-first' : ''}`}
            key={t.id}
            title={`P${t.priority}${t.dueDate ? ` • ${t.dueDate}` : ""}`}>
            {/* 헤더: 번호/제목 ←→ D-xx · 날짜 */}
            <div className="pill-head">
              <div className="pill-left">
                {idx >= 0 && <span className="pill-idx">{idx + 1}</span>}
                <span className="pill-title">{t.title}</span>

                {/* 👇 제목 옆으로 이동 */}
                <span className="pill-meta-inline">
                  <span className="chip fill">
                    {(() => {
                      const dd = Math.ceil((startOfDayMs(dueTime(t.dueDate)) - baseDayMs) / 86400000);
                      return `D-${dd >= 0 ? dd : 0}`;
                    })()}
                  </span>
                  <span className="chip outline">{ymd(dueTime(t.dueDate))}</span>
                </span>
              </div>
            </div>


            {/* 컨트롤: 우측(2열) 컴팩트 배치 */}
            <div className="pill-controls" style={{ height: 28 }}> {/* ⬅️ 높이 강제 적용 */}
              <button
                type="button"
                className={`btn xs ${t.enabled === false ? 'off' : 'on'}`}
                onClick={() => setTodos(prev =>
                  prev.map(x => x.id === t.id ? { ...x, enabled: !(x.enabled !== false) } : x)
                )}
                aria-pressed={t.enabled !== false}
                style={{ minWidth: 54 }}
              >
                {t.enabled === false ? '비활성' : '활성'}
              </button>
              <label>
                최소(분)
                <input
                  type="number" min={0} step={10}
                  value={t.minMinutes} placeholder="예: 20"
                  onChange={(e) => setTodos(prev =>
                    prev.map(x => x.id === t.id ? { ...x, minMinutes: e.target.value } : x)
                  )}
                  style={{ width: 72, height: 26, padding: '0 4px', fontSize: 13 }} /* ⬅️ 수정됨 */
                />
              </label>
              <label>
                최대(분)
                <input
                  type="number" min={0} step={10}
                  value={t.maxMinutes} placeholder="무제한"
                  onChange={(e) => setTodos(prev =>
                    prev.map(x => x.id === t.id ? { ...x, maxMinutes: e.target.value } : x)
                  )}
                  style={{ width: 72, height: 26, padding: '0 4px', fontSize: 13 }} /* ⬅️ 수정됨 */
                />
              </label>
            </div>
            {/* 배치 실패 알림은 그대로 유지 */}
          </div>
        ))}
      </div>

      {leftovers.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: 16 }}>
            <h3 className="section-title">배치 실패(최소 미충족) {leftovers.length}건</h3>
          </div>
          <div className="todo-pills warn">
            {leftovers.map((l, idx) => (
              <div className="pill" key={`left-${idx}`}>
                <span className="pill-title">{l.title}</span>
                <span className="pill-meta">미충족: {l.need * 10}분</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* === 좌우 2열 레이아웃: 계획표 헤더에 '미리보기 생성' 버튼 추가 === */}
      <div className="boards" style={{ marginTop: leftovers.length > 0 ? 0 : 20 }}>
        {/* LEFT: 전체 계획표 (활동 / 차단 설정) */}
        <div className="board">
          <div className="plan-card">
            <div className="plan-head">
              <span>시간</span>
              <span className="left-plan-titles">
                <span className="title-group">
                  {/* 라벨을 묶어 공간 확보 */}
                  <span className="head-title">활동</span>
                  <span className="head-title" title="클릭하여 AI가 이 시간대에 일정을 넣지 않도록 비워둡니다."> 시간 비우기 설정 (클릭)</span>
                </span>
                {/* 버튼은 그룹 외부에 배치하여 오른쪽 끝에 고정 */}
                <button className="btn micro on" onClick={() => setBlockedTicks(new Set())}>
                  차단 초기화
                </button>
              </span>
            </div>

            <div className="plan-body">
              {/* 기상 마커 (왼쪽) */}
              {Number.isFinite(timeline.startMin) && (
                <div className="plan-row marker is-wake" title="기상">
                  <span className="plan-time">{fmtHM(timeline.startMin)}</span>
                  <span className="plan-what">기상</span>
                </div>
              )}

              {/* 시간 틱들 */}
              {/* 시간 틱들 (기상 tick은 marker로 처리했으므로 제외) */}
              {ticks.filter(m => m !== timeline.startMin).map((m) => {
                const info = busyInfoAt(m);
                const blocked = isBlocked(m);
                const baseCls = info ? `is-fixed is-${info.kind}` : (blocked ? "is-blocked" : "");

                const text = info ? info.label : (blocked ? "비움 (차단됨)" : "");

                return (
                  <div
                    key={m}
                    className={`plan-row ${baseCls}`}
                    role={!info ? "button" : undefined}
                    onClick={() => toggleBlock(m)}
                    title={!info ? "클릭하여 AI가 이 시간대에 일정을 배정하지 않도록 비우기/해제" : ""}
                  >
                    <span className="plan-time">{fmtHM(m)}</span>
                    <span className="plan-what">{text}</span>
                  </div>
                );
              })}


              {/* 취침 마커(현재 있던 것) — 유지 */}
              <div className="plan-row marker is-sleep">
                <span className="plan-time">{fmtHM(timeline.endMin)}</span>
                <span className="plan-what">취침</span>
              </div>

            </div>
          </div>
        </div>

        {/* RIGHT: 미리보기(셀 교환) - 버튼 포함 */}
        <div className="board">
          <div className="plan-card">
            <div className="plan-head">
              <span>시간</span>
              <span className="head-inline">
                <span className="head-title">미리보기(셀 교환)</span>
                <button className="btn micro on" onClick={handleGenerate} disabled={!todos.length}>
                  미리보기 생성
                </button>
              </span>
            </div>
            <div className="plan-body">
              {Number.isFinite(timeline.startMin) && (
                <div className="plan-row marker is-wake" title="기상">
                  <span className="plan-time">{fmtHM(timeline.startMin)}</span>
                  <span className="plan-what">기상</span>
                </div>
              )}
              {ticks.filter(m => m !== timeline.startMin).map((m) => {
                const base = busyInfoAt(m);
                const blocked = isBlocked(m);
                const text = previewTicks.get(m) || "";
                const picked = pick === m;
                const cls = base ? `is-fixed is-${base.kind}` : (blocked ? "is-blocked" : (text ? "has-preview" : ""));

                return (
                  <div
                    key={m}
                    className={`plan-row ${cls} ${picked ? "picked" : ""}`}
                    onClick={() => {
                      // 클릭 금지: 실제 일정(base) 또는 사용자가 차단(blocked)
                      if (base || blocked) return;
                      const destText = previewTicks.get(m);
                      if (pick == null) { if (destText) setPick(m); return; }
                      if (pick === m) { setPick(null); return; }
                      const srcText = previewTicks.get(pick);
                      if (!srcText) { setPick(null); return; }
                      const next = new Map(previewTicks);
                      if (destText) { next.set(m, srcText); next.set(pick, destText); }
                      else { next.delete(pick); next.set(m, srcText); }
                      setPreviewTicks(next);
                      setPick(null);
                    }}
                    role={(!base && !blocked) ? "button" : undefined}
                  >
                    <span className="plan-time">{fmtHM(m)}</span>
                    <span className="plan-what">
                      {text || (base ? base.label : (blocked ? "×" : ""))}
                    </span>
                  </div>
                );
              })}

              <div className="plan-row marker is-sleep">
                <span className="plan-time">{fmtHM(timeline.endMin)}</span>
                <span className="plan-what">취침</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* === 하단 버튼 바 추가 === */}
      <div className="bottom-bar">
        <button className="btn cancel" onClick={() => navigate(-1)}>취소</button>
        <button className="btn primary" onClick={handleApply}>일정에 반영</button>
      </div>

    </div>
  );
}