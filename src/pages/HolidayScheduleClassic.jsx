// src/pages/HolidaySchedulePage.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { auth, db } from '../firebaseConfig';
import { doc, setDoc } from 'firebase/firestore';
import './HolidaySchedulePage.css';
import { TYPE_COLORS } from '../constants/typeColors';

// ⛳️ gptScheduler에서 내보낸 함수(없어도 동작하도록 아래에서 가드함)
import { generateHolidayScheduleFreeform } from '../api/gptScheduler';

import {
  inferSleepFromHistory,
  loadHolidayPrefs,
  saveHolidayPrefs,
  loadLastHolidayMemo,
  saveHolidayMemo,
  getCurrentPosition
} from '../services/holidayService';
import { fetchWeatherSummary, reverseGeocode } from '../api/weatherService';

/* ---------- 유틸: 결과 정규화 ---------- */
function normalizeHolidayResult(res) {
  // 다양한 반환 형태에 방어적으로 대응
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.tasks)) return res.tasks;
  if (res.plan && Array.isArray(res.plan.tasks)) return res.plan.tasks;
  if (Array.isArray(res.items)) return res.items;
  return [];
}

/* ---------- 유틸: 오프라인(Fallback) 생성기 ---------- */
function fallbackHolidayPlan({ sleepTime }) {
  // 아주 단순한 기본 일정: 기상~취침 사이를 식사/활동으로 채움
  const toMin = (hhmm = '00:00') => {
    const [h, m] = String(hhmm).split(':').map(n => parseInt(n, 10));
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
  const toHHMM = (min) => {
    const t = Math.max(0, Math.min(1439, Math.round(min)));
    const h = String(Math.floor(t / 60)).padStart(2, '0');
    const m = String(t % 60).padStart(2, '0');
    return `${h}:${m}`;
  };

  const wake = toMin(sleepTime?.wakeUp || '08:00');
  const bed = toMin(sleepTime?.bedTime || '23:30');
  const day = (bed - wake + 1440) % 1440 || 14 * 60; // 비정상 값 방어

  // 블록 구성: 아침/점심/저녁 식사 + 오전/오후 활동 + 저녁 활동
  const blocks = [
    { type: 'meal', start: wake + 30, dur: 40, task: '아침 식사' },
    { type: 'holiday', start: wake + 80, dur: 160, task: '오전 활동(산책/카페/전시)' },
    { type: 'meal', start: wake + 260, dur: 50, task: '점심 식사' },
    { type: 'holiday', start: wake + 320, dur: 200, task: '오후 활동(가벼운 운동/취미)' },
    { type: 'meal', start: wake + 530, dur: 60, task: '저녁 식사' },
    { type: 'holiday', start: wake + 600, dur: 120, task: '저녁 활동(산책/영화/독서)' },
  ].filter(b => b.start >= wake && (b.start + b.dur) <= ((wake + day) % 1440 || 1440));

  // 수면 고정 블록은 저장 시점에만 반영하면 되므로 여기선 제외
  return blocks.map(b => ({
    type: b.type,
    task: b.task,
    start: toHHMM(b.start),
    end: toHHMM(b.start + b.dur),
    origin: 'offline-fallback'
  }));
}

/* ---------- 저장 포맷 통일(+ ‘휴식’류 제거) ---------- */
function toSavable(tasks = []) {
  return (tasks || [])
    .filter(t => !/휴식|rest|break/i.test(String(t.task || t.activity)))
    .map(t => {
      const type = t.type || 'holiday';
      const base = (t.task || t.activity || (type === 'meal' ? '식사' : '활동')) + '';
      const name = (type === 'meal' && base.toLowerCase() === 'meal') ? '식사' : base;
      return {
        task: name,
        type,
        start: t.start,
        end: t.end,
        origin: t.origin || 'ai-holiday',
      };
    });
}

export default function HolidayScheduleClassic() {
  const params = useParams();
  const location = useLocation();
  // path params: /holiday/schedule/:date | :dateKey | :day | :id
  const pathDate = params.date || params.dateKey || params.day || params.id;
  // query string fallback: ?date=YYYY-MM-DD
  const queryDate = new URLSearchParams(location.search).get('date');
  const dateKey = pathDate || queryDate || '';
  const navigate = useNavigate();

  const [memo, setMemo] = useState('');
  const [sleepTime, setSleepTime] = useState({ bedTime: '', wakeUp: '' });
  const [pos, setPos] = useState(null);
  const [place, setPlace] = useState('');
  const [weather, setWeather] = useState(null); // ✅ 추가

  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');         // 🔔 상단 안내문
  const [tasksForSave, setTasksForSave] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);

  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) return;
      // ✅ 개발 모드 더블 마운트만 막고, 새로고침 시에는 다시 초기화되도록 window 전역 가드 사용
      const guardKey = `holiday:init:${dateKey || 'default'}:${user.uid}`;
      if (!window.__HOLIDAY_INIT_GUARDS) window.__HOLIDAY_INIT_GUARDS = new Set();
      if (window.__HOLIDAY_INIT_GUARDS.has(guardKey)) return;
      window.__HOLIDAY_INIT_GUARDS.add(guardKey);

      // 1) 메모 프리필
      const lastMemo = await loadLastHolidayMemo(user.uid);
      setMemo(lastMemo || '');

      // 2) 수면: prefs → 없으면 히스토리 추론 → 그래도 없으면 최초 입력
      let prefs = await loadHolidayPrefs(user.uid);
      let st = prefs?.sleepTime;
      if (!st?.bedTime || !st?.wakeUp) {
        st = await inferSleepFromHistory(user.uid, { lookback: 30 });
        if (!st) st = { bedTime: '23:30', wakeUp: '08:30' }; // 기본값(조용히 사용)
        await saveHolidayPrefs(user.uid, { sleepTime: st });
      }
      setSleepTime(st);

      // 3) 위치 → 날씨 요약
      const p = await getCurrentPosition();
      setPos(p);
      if (p?.lat != null && p?.lon != null) {
        const geo = await reverseGeocode({ lat: p.lat, lon: p.lon });
        setPlace(geo?.place || '');
        const w = await fetchWeatherSummary({ lat: p.lat, lon: p.lon });
        setWeather(w);
      }
    })();
  }, [dateKey]);

  const buildPreview = (tasks = []) => {
    const rows = (tasks || []).map((t, i) => ({
      i,
      time: `${t.start} ~ ${t.end}`,
      type: t.type || 'holiday',
      name: t.task || t.activity || (t.type === 'meal' ? '식사' : '활동')
    }));
    setPreviewRows(rows);
  };

  const handleGenerate = async () => {
    const user = auth.currentUser;
    if (!user) return alert('로그인이 필요합니다.');

    setLoading(true);
    setNotice('');
    try {
      // 위치/날씨 한 줄 요약(간단)
      const locLine = place ? `지역: ${place}` : '';
      const wxLine = weather?.summaryShort ? `날씨: ${weather.summaryShort}` : '';
      const wline = [locLine, wxLine].filter(Boolean).join(' · ') || '위치/날씨 정보 없음';

      const freeText = [
        memo?.trim() || '',
        wline,
        '실내/실외를 상황에 맞게 추천하고, 이동/휴식 밸런스를 고려해 주세요.'
      ].filter(Boolean).join('\n');

      const autonomy = 100;
      const fixedData = { sleepTime };

      // 🔎 진단용 로깅
      const hasAI =
        typeof generateHolidayScheduleFreeform === 'function';
      const hasKey =
        !!import.meta.env?.VITE_OPENAI_API_KEY;

      console.log('[HolidayAI] hasAI:', hasAI, 'hasKey:', hasKey, 'dateKey:', dateKey);

      let result = null;
      if (hasAI && hasKey) {
        try {
          result = await generateHolidayScheduleFreeform({
            dateKey,
            freeText,
            autonomy,
            tz: 'Asia/Seoul',
            fixedData,
            language: 'ko'
          });
          console.log('[HolidayAI] raw result:', result);
        } catch (e) {
          console.error('[HolidayAI] generate error:', e);
        }
      } else {
        console.warn('[HolidayAI] AI 비활성 상태(hasAI:', hasAI, 'hasKey:', hasKey, ') → 오프라인 Fallback 사용');
      }

      // 결과 정규화
      let tasks = normalizeHolidayResult(result);

      // 결과가 비었으면 Fallback
      let usedFallback = false;
      if (!tasks || tasks.length === 0) {
        tasks = fallbackHolidayPlan({ sleepTime });
        usedFallback = true;
      }

      const cleaned = toSavable(tasks);
      setTasksForSave(cleaned);
      buildPreview(cleaned);

      setNotice(
        usedFallback
          ? '⚠️ AI 응답이 비어있어서 오프라인 기본 일정으로 채웠습니다.'
          : '✅ AI 생성 완료'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    const user = auth.currentUser;
    if (!user) return alert('로그인이 필요합니다.');
    if (!dateKey) {
      alert('날짜가 없습니다. /holiday/schedule/:date 또는 ?date=YYYY-MM-DD 형태로 접근해 주세요.');
      return;
    }
    if (!tasksForSave?.length) return alert('생성된 일정이 없습니다.');

    const dayRef = doc(db, 'users', user.uid, 'dailySchedules', dateKey);
    await setDoc(dayRef, {
      generatedTasks: tasksForSave,
      isHoliday: true,
      dayType: 'holiday',
      source: 'ai-holiday',           // (선택) 출처 표시
      updatedAt: new Date().toISOString()
    }, { merge: true });
    await saveHolidayMemo(user.uid, dateKey, memo || '', {
      weatherSummary: weather?.summaryShort || null,
      position: pos ? { lat: pos.lat, lon: pos.lon } : null
    });

    alert('휴일 일정 및 메모를 저장했습니다.');
    navigate(`/calendar?date=${dateKey}`);
  };

  return (
    <div className="holiday-schedule-page container">
      <h2>{dateKey || '미지정'} 휴일 일정 추천 <span style={{ opacity: .6, fontSize: 14 }}></span></h2>

      {notice && (
        <div className="box" style={{ background: '#fff8e1', borderColor: '#f59e0b' }}>
          {notice}
        </div>
      )}

      <div className="box">
        <h4>수면</h4>
        <p>
          기상 <b>{sleepTime.wakeUp || '--:--'}</b> ~ 취침 <b>{sleepTime.bedTime || '--:--'}</b>
        </p>
      </div>

      <div className="box">
        <h4>현재 위치/날씨</h4>
        <p>
          {place
            ? `지역: ${place}`
            : (pos ? `좌표 (${pos.lat?.toFixed?.(3)}, ${pos.lon?.toFixed?.(3)})` : '위치 정보 없음')}
          {` · `}
          {weather?.summaryShort ? `날씨: ${weather.summaryShort}` : '날씨 정보 없음'}
        </p>
      </div>

      <div className="box">
        <h4>선호하는 활동을 적어주세요.</h4>
        <textarea
          value={memo}
          onChange={e => setMemo(e.target.value)}
          placeholder="원하는 분위기/제약/취향 등을 적어주세요"
          rows={4}
          style={{ width: '100%', resize: 'vertical' }}
        />
      </div>

      <div className="btns">
        <button onClick={handleGenerate} className="control-btn" disabled={loading}>
          {loading ? '생성 중…' : '휴일 일정 생성'}
        </button>
        <button onClick={handleSave} className="control-btn" disabled={!tasksForSave.length}>
          휴일 일정으로 저장
        </button>
        <button onClick={() => navigate(-1)} className="control-btn">취소</button>
      </div>

      {previewRows.length > 0 && (
        <div className="box">
          <h4>추천 미리보기</h4>
          <div className="table like">
            <table>
              <thead>
                <tr><th>시간</th><th>유형</th><th>활동</th></tr>
              </thead>
              <tbody>
                {previewRows.map(r => (
                  <tr key={r.i}>
                    <td>{r.time}</td>
                    <td>
                      <span style={{
                        display: 'inline-block',
                        background: TYPE_COLORS[r.type] || '#EEE',
                        padding: '2px 8px',
                        borderRadius: 8
                      }}>{r.type}</span>
                    </td>
                    <td>{r.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
