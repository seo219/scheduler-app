// src/pages/CalendarPage.jsx
import React, { useState, useEffect, useCallback } from 'react';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { auth, db } from '../firebaseConfig';
import { doc, getDoc, deleteDoc, collection, getDocs, setDoc } from 'firebase/firestore';
import './CalendarPage.css';
import { Calendar as CalendarIcon } from 'lucide-react';
import Holidays from 'date-holidays';

/* ---------- date helpers ---------- */
const DAY_MS = 86400000;
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const keyOf = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
const parseYMD = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/* ---------- holidays (KR) ---------- */
function toYMD(input) {
  if (typeof input === 'string') return input.slice(0, 10);
  const d = new Date(input);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate()
  ).padStart(2, '0')}`;
}
const isWeekend = (date) => [0, 6].includes(date.getDay());
function expandSeollalChuseok(map) {
  const keys = Array.from(map.keys());
  const isFestival = (name) => /추석|설날/.test(name);
  const seeds = keys.filter((k) => isFestival(map.get(k).name));
  for (const k of seeds) {
    const baseName = map.get(k).name.includes('추석') ? '추석' : '설날';
    const d = parseYMD(k);
    const prev = addDays(d, -1);
    const next = addDays(d, +1);
    if (!map.has(keyOf(prev))) map.set(keyOf(prev), { name: `${baseName} 연휴`, type: 'observance' });
    if (!map.has(keyOf(next))) map.set(keyOf(next), { name: `${baseName} 연휴`, type: 'observance' });
    if ([prev, d, next].some(isWeekend)) {
      let sub = addDays(next, 1);
      while (isWeekend(sub) || map.has(keyOf(sub))) sub = addDays(sub, 1);
      if (!map.has(keyOf(sub))) map.set(keyOf(sub), { name: '대체공휴일', type: 'substitute' });
    }
  }
}
function getKRHolidayMap(year) {
  const hd = new Holidays('KR');
  const list = hd.getHolidays(year) || [];
  const map = new Map();
  for (const h of list) {
    const key = toYMD(h.date);
    map.set(key, { name: h.localName || h.name || '공휴일', type: h.type });
  }
  expandSeollalChuseok(map);
  return map;
}

/* ---------- utils ---------- */
function pickTodoTitle(t) {
  const cands = ['title', 'text', 'todo', 'task', 'subject', 'label', 'name', 'content'];
  for (const k of cands) {
    const v = t?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '할 일';
}

/* ========================================================= */
export default function CalendarPage() {
  const [value, setValue] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(null);

  const [viewMode, setViewMode] = useState('none'); // none | loading | plan | holiday
  const [scheduleData, setScheduleData] = useState([]);
  const [hadPlan, setHadPlan] = useState(false);     // ⬅️ 과거 메모 노출 판정용
  const [commentText, setCommentText] = useState('');

  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [holidayMap, setHolidayMap] = useState(new Map());
  const [holidayCache, setHolidayCache] = useState({});
  const [hasPlanDays, setHasPlanDays] = useState(new Set());
  const [todoByDate, setTodoByDate] = useState(new Map());
  const [monthlyTodos, setMonthlyTodos] = useState([]);

  const isPastSelected = selectedDate ? dayStart(selectedDate) < dayStart(new Date()) : false;
  const localFormat = (date) => keyOf(date);

  /* ---------- init from ?date= ---------- */
  useEffect(() => {
    if (selectedDate) return;
    const qp = searchParams.get('date');
    if (qp) {
      const [y, m, d] = qp.split('-').map((n) => parseInt(n, 10));
      const jump = new Date(y, (m || 1) - 1, d || 1);
      setValue(jump);
      setSelectedDate(jump);
    } else {
      const today = new Date();
      setValue(today);
      setSelectedDate(today);
    }
    setViewMode('loading');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- loaders ---------- */
  const loadHolidaysForYear = useCallback(
    (year) => {
      if (holidayCache[year]) {
        setHolidayMap(holidayCache[year]);
        return;
      }
      const map = getKRHolidayMap(year);
      setHolidayMap(map);
      setHolidayCache((prev) => ({ ...prev, [year]: map }));
    },
    [holidayCache]
  );

  const loadMonthPlans = useCallback(async (year, month) => {
    const user = auth.currentUser;
    if (!user) return;
    const ym = `${year}-${String(month + 1).padStart(2, '0')}`;
    const colRef = collection(db, 'users', user.uid, 'dailySchedules');
    const snap = await getDocs(colRef);
    const set = new Set();
    snap.forEach((docSnap) => {
      const id = docSnap.id;
      if (!id.startsWith(ym)) return;
      const data = docSnap.data() || {};
      const has =
        (Array.isArray(data.generatedTasks) && data.generatedTasks.length > 0) ||
        data.isHoliday === true;
      if (has) set.add(id);
    });
    setHasPlanDays(set);
  }, []);

  const loadTodosForMonth = useCallback(async (year, month) => {
    const user = auth.currentUser;
    if (!user) return;
    const colRef = collection(db, 'users', user.uid, 'todos');
    const snap = await getDocs(colRef);
    const map = new Map();
    const list = [];
    const today = dayStart(new Date());
    snap.forEach((docSnap) => {
      const t = docSnap.data() || {};
      if (t.done === true) return;
      let raw = t.dueDate ?? t.due ?? t.date;
      let due = null;
      if (raw?.toDate) due = raw.toDate();
      else if (raw instanceof Date) due = raw;
      else if (typeof raw === 'number') due = new Date(raw);
      else if (typeof raw === 'string') {
        const m = raw.match(/(\d{4})\D*(\d{1,2})\D*(\d{1,2})/);
        if (m) due = new Date(+m[1], +m[2] - 1, +m[3]);
      }
      if (!due || isNaN(due)) return;
      const dueKey = keyOf(due);
      if (due.getFullYear() === year && due.getMonth() === month) {
        map.set(dueKey, (map.get(dueKey) || 0) + 1);
        const dday = Math.ceil((dayStart(due) - today) / DAY_MS);
        list.push({ dueKey, title: pickTodoTitle(t), dday });
      }
    });
    list.sort((a, b) => {
      const aa = a.dday >= 0 ? 0 : 1;
      const bb = b.dday >= 0 ? 0 : 1;
      if (aa !== bb) return aa - bb;
      if (a.dday !== b.dday) return a.dday - b.dday;
      return a.dueKey.localeCompare(b.dueKey);
    });
    setTodoByDate(map);
    setMonthlyTodos(list);
  }, []);

  const handleActiveMonthChange = ({ activeStartDate }) => {
    if (!activeStartDate) return;
    const y = activeStartDate.getFullYear();
    const m = activeStartDate.getMonth();
    loadHolidaysForYear(y);
    loadMonthPlans(y, m);
    loadTodosForMonth(y, m);
  };

  useEffect(() => {
    if (!value) return;
    const y = value.getFullYear();
    const m = value.getMonth();
    loadHolidaysForYear(y);
    loadMonthPlans(y, m);
    loadTodosForMonth(y, m);
  }, [value, loadHolidaysForYear, loadMonthPlans, loadTodosForMonth]);

  /* ---------- selected date data ---------- */
  useEffect(() => {
    (async () => {
      if (!selectedDate) return;
      const key = localFormat(selectedDate);
      const user = auth.currentUser;
      if (!user) return;
      setViewMode('loading');
      const ref = doc(db, 'users', user.uid, 'dailySchedules', key);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        setScheduleData([]);
        setHadPlan(false);
        setCommentText('');
        setViewMode('none');
        return;
      }
      const data = snap.data() || {};
      const had = Array.isArray(data.generatedTasks) && data.generatedTasks.length > 0;
      setScheduleData(data.generatedTasks || []);
      setHadPlan(had);
      setCommentText(data.comment || '');
      setViewMode(data.isHoliday ? 'holiday' : had ? 'plan' : 'none');
    })();
  }, [selectedDate]);

  /* ---------- actions ---------- */
  // ✅ 달력 페이지 → 기존 방식(클래식) 휴일 지정
  const handleHolidayClassic = React.useCallback(() => {
    if (!selectedDate) return;
    const dateKey = localFormat(selectedDate);
    sessionStorage.removeItem(`busy:${dateKey}`);     // 혹시 이전 페이지에서 저장한 busyBlocks가 남아있다면 제거
    navigate(`/holiday/schedule/classic/${dateKey}`); // 전체 시간표 생성(기존 방식)
  }, [selectedDate, navigate]);





  const handleCancelHoliday = async () => {
    if (!selectedDate) return;
    const user = auth.currentUser;
    if (!user) return;
    const key = localFormat(selectedDate);
    await deleteDoc(doc(db, 'users', user.uid, 'dailySchedules', key));
    setScheduleData([]);
    setHadPlan(false);
    setCommentText('');
    setViewMode('none');
  };

  const handleSaveComment = async () => {
    if (!selectedDate) return;
    const user = auth.currentUser;
    if (!user) return;
    const key = localFormat(selectedDate);
    await setDoc(
      doc(db, 'users', user.uid, 'dailySchedules', key),
      { comment: (commentText || '').trim() },
      { merge: true }
    );
  };

  /* ✅ 추가: 계획표 수정 시, AI 스케줄링 초기화 경고 */
  const handleEditPlanClick = useCallback(() => {
    // AI로 채워진 블록(origin:'ai' && type:'todo')가 하나라도 있으면 경고
    const hasAI =
      Array.isArray(scheduleData) &&
      scheduleData.some((t) => t?.origin === 'ai' && (t?.type === 'todo' || !t?.type));

    if (hasAI) {
      const ok = window.confirm(
        '이 계획표는 AI 스케줄링이 적용되어 있습니다.\n' +
        '계획표를 수정하면 자동 배치된 할 일(스케줄링)이 초기화될 수 있어요.\n' +
        '계속하시겠어요?'
      );
      if (!ok) return;
    }
    navigate(`/plan/${localFormat(selectedDate)}/edit`, { state: { scheduleData } });
  }, [navigate, selectedDate, scheduleData]);

  /* ---------- summary table ---------- */
  const typeColors = { sleep: '#FFFFFF', meal: '#F5F5F5', fixed: '#E0E0E0', todo: '#F0F0F0', holiday: '#FFFFFF' };
  // CalendarPage.jsx 안의 renderSummary 만 이걸로 교체
  const renderSummary = () => {
    if (!selectedDate) return null;

    const events = [];
    scheduleData.forEach((it, idx) => {
      const { start, end, task, type } = it;
      const color = it.color || it.bgColor || it.background;
      const bg = (color && String(color).trim()) || typeColors[type] || typeColors.todo;

      if (type === "holiday") {
        if (start) events.push({ time: start, label: task, color: "#FFFFFF", key: `s-h${idx}`, kind: "start" });
        if (end) events.push({ time: end, label: `${task} 종료`, color: "#FFFFFF", key: `e-h${idx}`, kind: "end" });
        return;
      }

      if (task === "수면") {
        if (end) events.push({ time: end, label: "기상", color: typeColors.sleep, key: `wake-${idx}`, kind: "end" });
        if (start) events.push({ time: start, label: "취침", color: typeColors.sleep, key: `bed-${idx}`, kind: "start" });
        return;
      }

      if (start && end) {
        events.push({ time: start, label: task, color: bg, key: `s-${idx}-${start}`, kind: "start" });
        events.push({ time: end, label: `${task} 종료`, color: bg, key: `e-${idx}-${end}`, kind: "end" });
      }
    });

    // 정렬 로직: 시간 오름차순, 같은 시간이면 'end'가 'start'보다 먼저
    events.sort((a, b) => {
      const t = a.time.localeCompare(b.time);
      if (t !== 0) return t;
      const pa = a.kind === "end" ? 0 : 1;
      const pb = b.kind === "end" ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return a.label.localeCompare(b.label); // 안정화용
    });

    // '기상'을 목록 맨 앞으로 회전 (기존 동작 유지)
    const wakeIdx = events.findIndex((e) => e.label === "기상");
    const ordered = wakeIdx > 0 ? [...events.slice(wakeIdx), ...events.slice(0, wakeIdx)] : events;

    if (ordered.length === 0) return null;

    return (
      <table className="summary-table">
        <tbody>
          {ordered.map((ev) => (
            <tr key={ev.key}>
              <td style={{ backgroundColor: ev.color || "#FFFFFF", fontWeight: "bold", width: "40%" }}>
                {ev.time}
              </td>
              <td style={{ backgroundColor: ev.color || "#FFFFFF" }}>{ev.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  /* ---------- render ---------- */
  return (
    <div className="calendar-page">
      <h1>
        <CalendarIcon size={28} style={{ verticalAlign: 'middle', marginRight: 8, marginBottom: 7 }} />
        달력
      </h1>

      <div className="calendar-layout">
        <div className="calendar-wrapper">
          <Calendar
            onClickDay={(day) => {
              setValue(day);
              setSelectedDate(day);
            }}
            value={value}
            locale="ko-KR"
            calendarType="gregory"
            formatDay={(locale, date) => `${date.getDate()}일`}
            onActiveStartDateChange={handleActiveMonthChange}
            tileClassName={({ date, view }) => {
              if (view !== 'month') return null;
              const classes = [];
              const day = date.getDay();
              if (day === 6) classes.push('sat');
              if (day === 0) classes.push('sun');
              const key = keyOf(date);
              if (holidayMap.has(key)) {
                classes.push('holiday-tile');
                const prevIs = holidayMap.has(keyOf(addDays(date, -1)));
                const nextIs = holidayMap.has(keyOf(addDays(date, +1)));
                if (!prevIs && nextIs) classes.push('holiday-start');
                else if (prevIs && nextIs) classes.push('holiday-middle');
                else if (prevIs && !nextIs) classes.push('holiday-end');
                else classes.push('holiday-single');
              }
              if (hasPlanDays.has(key)) classes.push('has-plan');
              return classes.join(' ');
            }}
            tileContent={({ date, view }) => {
              if (view !== 'month') return null;
              const key = keyOf(date);
              const h = holidayMap.get(key);
              const name = h?.name || null;
              const short = name ? (name.length > 8 ? name.slice(0, 8) + '…' : name) : null;
              return (
                <>
                  <div className="holiday-row">
                    {name && (
                      <span className="holiday-badge" title={name}>
                        {short}
                      </span>
                    )}
                  </div>
                  {todoByDate.has(key) && <span className="todo-dot" aria-label="할 일 있음" />}
                </>
              );
            }}
          />

          <div className="month-todos">
            <div className="month-todos__title">이달의 할 일</div>
            {monthlyTodos.length === 0 ? (
              <div className="month-todos__empty">이번 달 마감 일정이 없어요.</div>
            ) : (
              <ul className="month-todos__list">
                {monthlyTodos.slice(0, 8).map((t) => (
                  <li key={`${t.dueKey}-${t.title}`} className="month-todo">
                    <span className="month-todo__date">{t.dueKey.replace(/-/g, '. ')}</span>
                    <span className={`month-todo__dday ${t.dday === 0 ? 'is-today' : t.dday < 0 ? 'is-past' : ''}`}>
                      {t.dday === 0 ? 'D-DAY' : t.dday < 0 ? `D+${Math.abs(t.dday)}` : `D-${t.dday}`}
                    </span>
                    <span className="month-todo__title">{t.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="schedule-panel">
          {!selectedDate && <p>날짜를 선택해주세요</p>}
          {viewMode === 'loading' && <p>로딩 중…</p>}

          {selectedDate && viewMode !== 'loading' && (
            <>
              <div className="panel-header">
                <h2>{selectedDate.toLocaleDateString('ko-KR')} 일정</h2>

                {viewMode !== 'none' && (
                  <div className="panel-actions">
                    <button
                      className="btn"
                      onClick={() => navigate(`/full-schedule?date=${localFormat(selectedDate)}`)}
                    >
                      전체 일정표 보기
                    </button>
                  </div>
                )}
              </div>

              {viewMode !== 'none' && renderSummary()}

              {/* 오늘/미래 + 일정 없음 */}
              {viewMode === 'none' && !isPastSelected && (
                <div className="btn-group">
                  <button onClick={() => navigate(`/plan/${localFormat(selectedDate)}`)}>계획표 만들기</button>
                  <button onClick={handleHolidayClassic}>휴일 지정</button>
                </div>
              )}

              {/* 오늘/미래 + 계획표 있음 */}
              {viewMode === 'plan' && !isPastSelected && (
                <div className="btn-group">
                  <button onClick={handleEditPlanClick}>
                    계획표 수정하기
                  </button>
                  <button onClick={() => navigate(`/ai/schedule/${localFormat(selectedDate)}`)}>
                    AI 스케줄링 받기
                  </button>
                </div>
              )}

              {/* 오늘/미래 + 휴일 */}
              {viewMode === 'holiday' && !isPastSelected && (
                <div className="btn-group">
                  <button onClick={handleHolidayClassic}>다시 추천 받기</button>
                  <button onClick={handleCancelHoliday}>휴일 해제하기</button>
                </div>
              )}

              {/* 과거 + '계획표가 있던' 날만 메모 활성화 */}
              {isPastSelected && hadPlan && (
                <div style={{ marginTop: 12 }}>
                  <label htmlFor="comment" style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>
                    코멘트
                  </label>
                  <textarea
                    id="comment"
                    rows={4}
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="그날 일정은 어땠나요? 기록을 남겨보세요."
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      borderRadius: 8,
                      border: '1px solid #ccc',
                      padding: 10,
                      resize: 'vertical',
                    }}
                  />
                  <div className="btn-group">
                    <button onClick={handleSaveComment}>메모 저장</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
