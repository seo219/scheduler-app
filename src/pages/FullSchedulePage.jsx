import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { auth, db } from '../firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import './FullSchedulePage.css';
import { TYPE_COLORS } from '../constants/typeColors';

const toDateKey = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};
const parseYMD = (ymd) => {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const toMin = (hhmm) => {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).split(':').map(n => parseInt(n, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return (h * 60 + m) % 1440;
};
const minToHHMM = (t) => `${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;

const STEP = 10;

const isSleepish = (title = '', type = '') => {
  const t  = String(title).toLowerCase();
  const ty = String(type).toLowerCase();
  return (
    /수면|취침|기상|잠|sleep|bed|wake/.test(t) ||
    /sleep|bed|wake/.test(ty)
  );
};

export default function FullSchedulePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const dateParam = params.get('date');
  const baseDate  = useMemo(() => (dateParam ? parseYMD(dateParam) : new Date()), [dateParam]);
  const dateKey   = useMemo(() => toDateKey(baseDate), [baseDate]);

  const [items, setItems]   = useState([]);
  const [wakeMin, setWakeMin] = useState(null);
  const [bedMin,  setBedMin]  = useState(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const user = auth.currentUser;
      if (!user) return;
      const snap = await getDoc(doc(db, 'users', user.uid, 'dailySchedules', dateKey));
      if (!mounted) return;
      const data = snap.data() || {};

      let w = toMin(data?.sleepTime?.wakeUp);
      let b = toMin(data?.sleepTime?.bedTime);

      const tryExtractSleepFrom = (arr = []) => {
        arr.forEach((t) => {
          const title = `${t?.title ?? t?.task ?? ''}`.trim();
          const typ   = `${t?.type ?? ''}`.trim();
          const s = toMin(t?.start);
          const e = toMin(t?.end);
          if (w == null && /(기상|wake)/i.test(title) && (s != null || e != null)) w = (s ?? e);
          if (b == null && /(취침|bed)/i.test(title)  && (s != null || e != null)) b = (s ?? e);
          if (isSleepish(title, typ)) {
            if (b == null && s != null) b = s;
            if (w == null && e != null) w = e;
          }
        });
      };
      tryExtractSleepFrom(data.generatedTasks);
      tryExtractSleepFrom(data.schedules);
      tryExtractSleepFrom(data.fixedList);

      setWakeMin(Number.isFinite(w) ? w : null);
      setBedMin(Number.isFinite(b) ? b : null);

      const merged = [];

      (data.meals || []).forEach(m => {
        const s = toMin(m.start), e = toMin(m.end);
        if (s==null || e==null) return;
        merged.push({ title: m.type || '식사', start: s, end: e, type: 'meal' });
      });

      (data.schedules || data.fixedList || []).forEach(s => {
        const sMin = toMin(s.start), eMin = toMin(s.end);
        if (sMin==null || eMin==null) return;
        const title = s.title || s.name || s.type || '일정';
        if (isSleepish(title, s.type)) return;
        merged.push({
          title,
          start: sMin, end: eMin, type: s.type || 'fixed',
          color: s.color || s.bgColor || s.background,
        });
      });

      (data.generatedTasks || []).forEach(t => {
        const s = toMin(t.start), e = toMin(t.end);
        if (s==null || e==null) return;
        const title = t.title || t.task || '할 일';
        if (isSleepish(title, t.type)) return;
        merged.push({
          title,
          start: s, end: e, type: t.type || 'todo',
          color: t.color || t.bgColor || t.background,
        });
      });

      setItems(merged);
    })();
    return () => { mounted = false; };
  }, [dateKey]);

  const windowStart = (wakeMin != null) ? wakeMin : 0;
  const windowSpan  = (wakeMin != null && bedMin != null)
    ? (((bedMin - wakeMin + 1440) % 1440) || 1440)
    : 1440;

  const offsets = useMemo(() => {
    const out = [];
    for (let off = 0; off < windowSpan; off += STEP) out.push(off);
    return out;
  }, [windowSpan]);

  const norm = useCallback((m) => ((m - windowStart + 1440) % 1440), [windowStart]);

  const cellForOffset = (off) => {
    const minuteOfDay = (windowStart + off) % 1440;
    const hit = items.find(it => {
      let s = norm(it.start);
      let e = norm(it.end);
      if (e <= s) e += 1440;
      return s <= off && off < e;
    });
    if (!hit) return { time: minToHHMM(minuteOfDay), text: '', style: {} };
    const bg = (hit.color && String(hit.color).trim()) || (TYPE_COLORS[hit.type] || '#fff');
    return { time: minToHHMM(minuteOfDay), text: hit.title, style: { background: bg } };
  };

  const shiftDay = useCallback((delta) => {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + delta);
    navigate(`/full-schedule?date=${toDateKey(d)}`);
  }, [baseDate, navigate]);

  const goCalendar = useCallback(() => {
    navigate(`/calendar?date=${dateKey}`);
  }, [navigate, dateKey]);

  const handlePrint = useCallback(() => window.print(), []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') shiftDay(-1);
      else if (e.key === 'ArrowRight') shiftDay(1);
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        handlePrint();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shiftDay, handlePrint]);

  return (
    <div className="full-page">
      <header className="full-header">
        <div className="left">
          <button onClick={goCalendar}>달력으로</button>
        </div>

        <div className="center">
          <button className="nav-btn" onClick={() => shiftDay(-1)} aria-label="이전">◀ 이전</button>
          <h1><span className="mobile-title-text">{dateKey} 전체 일정표</span></h1>
          <button className="nav-btn" onClick={() => shiftDay(+1)} aria-label="다음">다음 ▶</button>
        </div>

        <div className="right">
          <button onClick={handlePrint}>인쇄</button>
        </div>
      </header>

      <div className="table-wrapper">
        <table className="full-table">
          <thead>
            <tr><th>시간</th><th>활동</th></tr>
          </thead>
          <tbody>
            {wakeMin != null && (
              <tr>
                <td className="time" style={{ background: TYPE_COLORS.sleep }}>{minToHHMM(wakeMin)}</td>
                <td className="activity" style={{ background: TYPE_COLORS.sleep }}>기상</td>
              </tr>
            )}

            {offsets.map(off => {
              const cell = cellForOffset(off);
              return (
                <tr key={off}>
                  <td className="time">{cell.time}</td>
                  <td className="activity" style={cell.style}>{cell.text}</td>
                </tr>
              );
            })}

            {bedMin != null && (
              <tr>
                <td className="time" style={{ background: TYPE_COLORS.sleep }}>{minToHHMM(bedMin)}</td>
                <td className="activity" style={{ background: TYPE_COLORS.sleep }}>취침</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}