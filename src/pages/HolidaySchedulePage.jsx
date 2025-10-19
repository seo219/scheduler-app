import React, { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { generateHolidaySchedule } from '../api/gptScheduler';
import { auth, db } from '../firebaseConfig';
import { doc, setDoc } from 'firebase/firestore';
import './HolidaySchedulePage.css';

// 타입별 색상
const TYPE_COLORS = {
  sleep: '#FFFFFF',
  meal: '#F5F5F5',
  fixed: '#E3F9E5',
  holiday: '#FFEFD5',
};

// 시간 → 분
const toMin = (hhmm = '00:00') => {
  const [h, m] = String(hhmm).split(':').map(n => parseInt(n, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};

// 저장 포맷 통일(+ ‘휴식’류 제거)
function toSavable(tasks = []) {
  return tasks
    .filter(t => !/휴식|rest|break/i.test(String(t.task || t.activity)))
    .map(t => {
      const type = t.type || 'holiday';
      const base = (t.task || t.activity || (type === 'meal' ? '식사' : '활동')) + '';
      const name = (type === 'meal' && base.toLowerCase() === 'meal') ? '식사' : base;
      return {
        start: String(t.start || '').slice(0, 5),
        end: String(t.end || '').slice(0, 5),
        type,
        task: name,
        activity: name,
        color: t.color || TYPE_COLORS[type] || TYPE_COLORS.holiday,
      };
    });
}

// 저장 직전 중복 제거
function dedupeTasks(arr = []) {
  const seen = new Set();
  const out = [];
  for (const t of arr) {
    const name = String(t.task || t.activity || '').trim();
    const key = `${t.type}|${t.start}|${t.end}|${name}`;
    if (!seen.has(key)) { seen.add(key); out.push(t); }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

// 하루 내 수면 블록(00:00~기상, 취침~23:59)
function buildSleepBlocks(wakeUp, bedTime) {
  return [
    { start: '00:00', end: wakeUp, type: 'sleep', task: '수면', activity: '수면', color: TYPE_COLORS.sleep },
    { start: bedTime, end: '23:59', type: 'sleep', task: '수면', activity: '수면', color: TYPE_COLORS.sleep },
  ];
}

// 컨디션별 기본 기상/취침
const ENERGY_DEFAULTS = {
  '피곤함': { wakeUp: '10:00', bedTime: '21:30' },
  '보통': { wakeUp: '09:00', bedTime: '22:00' },
  '에너지 충만': { wakeUp: '08:00', bedTime: '23:00' },
};

// 컨디션별 기본 식사(예: 40분)
const MEAL_DEFAULTS = {
  '피곤함': [
    { start: '12:30', end: '13:10', type: 'meal', task: '점심', color: TYPE_COLORS.meal },
    { start: '18:30', end: '19:10', type: 'meal', task: '저녁', color: TYPE_COLORS.meal },
  ],
  '보통': [
    { start: '12:00', end: '12:40', type: 'meal', task: '점심', color: TYPE_COLORS.meal },
    { start: '18:00', end: '18:40', type: 'meal', task: '저녁', color: TYPE_COLORS.meal },
  ],
  '에너지 충만': [
    { start: '11:30', end: '12:10', type: 'meal', task: '점심', color: TYPE_COLORS.meal },
    { start: '18:30', end: '19:10', type: 'meal', task: '저녁', color: TYPE_COLORS.meal },
  ],
};

export default function HolidaySchedulePage() {
  const { dateKey } = useParams(); // YYYY-MM-DD
  const navigate = useNavigate();

  const [interest, setInterest] = useState('운동');
  const [energy, setEnergy] = useState('보통');
  const [loading, setLoading] = useState(false);

  const [tasksForSave, setTasksForSave] = useState([]); // 엔진 결과
  const [previewRows, setPreviewRows] = useState([]); // 표 표시용

  const interestOptions = ['운동', '음악', '미술', '영화/드라마', '독서'];
  const energyOptions = ['피곤함', '보통', '에너지 충만'];

  const { wakeUp, bedTime } = useMemo(
    () => ENERGY_DEFAULTS[energy] || ENERGY_DEFAULTS['보통'],
    [energy]
  );
  const mealBlocks = useMemo(
    () => MEAL_DEFAULTS[energy] || MEAL_DEFAULTS['보통'],
    [energy]
  );
  const dateTitle = useMemo(
    () => (dateKey ? dateKey.replace(/-/g, '. ') : ''),
    [dateKey]
  );

  const handleRecommend = async () => {
    try {
      setLoading(true);

      // 식사는 컨디션 기본값을 고정데이터로 제공
      const tasks = await generateHolidaySchedule({
        interest,
        energy,
        fixedData: { meals: mealBlocks },
      });

      setTasksForSave(tasks);

      // 표: 기상/취침 가짜행 + 실제 일정(‘휴식’ 제거)
      const head = { start: wakeUp, end: '', label: '기상', type: 'sleep' };
      const tail = { start: bedTime, end: '', label: '취침', type: 'sleep' };

      const realRows = tasks
        .filter(t => !/휴식|rest|break/i.test(String(t.task || t.activity)))
        .map(t => ({
          start: t.start,
          end: t.end,
          label: t.activity || t.task,
          type: t.type || 'holiday',
        }));

      const all = [head, ...realRows, tail].sort((a, b) => toMin(a.start) - toMin(b.start));
      setPreviewRows(all);
    } catch (err) {
      console.error('[HolidaySchedulePage] recommend error:', err);
      // alert('추천 생성 중 문제가 발생했습니다.'); // alert 대신 console.error 사용
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      if (!Array.isArray(tasksForSave) || tasksForSave.length === 0) {
        // alert('먼저 추천을 생성해주세요.');
        console.log('먼저 추천을 생성해주세요.');
        return;
      }
      const user = auth.currentUser;
      if (!user?.uid) {
        // alert('로그인 후 이용해주세요.');
        console.log('로그인 후 이용해주세요.');
        return;
      }
      const docId = String(dateKey ?? '').trim();
      if (!docId) {
        // alert('dateKey가 비어있습니다.');
        console.log('dateKey가 비어있습니다.');
        return;
      }

      const sleepBlocks = buildSleepBlocks(wakeUp, bedTime);
      const payload = {
        isHoliday: true,
        sleepTime: { wakeUp, bedTime },
        generatedTasks: dedupeTasks([
          ...toSavable(sleepBlocks),
          ...toSavable(tasksForSave),
        ]),
      };

      const ref = doc(db, 'users', user.uid, 'dailySchedules', docId);
      await setDoc(ref, payload, { merge: true });
      // alert('휴일 일정으로 저장되었습니다.');
      console.log('휴일 일정으로 저장되었습니다.');
      navigate(`/calendar?date=${docId}`, { replace: true });
    } catch (err) {
      console.error('[HolidaySchedulePage] save error:', err);
      // alert('저장 실패: ' + (err?.message || String(err)));
    }
  };

  // 계획표 페이지로 이동
  const handleGoPlan = () => navigate(`/plan/${dateKey}`);

  return (
    <div className="holiday-schedule-page">
      <h2>{dateTitle} 휴일 일정 추천</h2>

      <div className="controls">
        <button onClick={handleGoPlan} className="control-btn">계획표로 이동</button>

        <label>
          관심사
          <select value={interest} onChange={(e) => setInterest(e.target.value)}>
            {interestOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </label>

        <label>
          컨디션
          <select value={energy} onChange={(e) => setEnergy(e.target.value)}>
            {energyOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
          </select>
        </label>

        <button onClick={handleRecommend} disabled={loading} className="control-btn">
          {loading ? '추천 생성 중…' : '추천 생성'}
        </button>
      </div>

      {previewRows.length > 0 && (
        <>
          {/* ⬇️ 스크롤 박스 (헤더 고정) */}
          <div className="table-frame">
            <div className="table-scroll">
              <table className="preview schedule-table">
                <thead>
                  <tr>
                    <th>시작</th>
                    <th>종료</th>
                    <th>활동</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r, i) => {
                    const cls = `row-${r.type || 'holiday'}`;
                    return (
                      <tr key={i} className={cls}>
                        <td className="time">{r.start}</td>
                        <td className="time">{r.end || '—'}</td>
                        <td className="label">{r.label}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>


          <div className="btns">
            <button onClick={handleSave} className="control-btn">휴일 일정으로 저장</button>
            <button onClick={() => navigate(-1)} className="control-btn">취소</button>
          </div>
        </>
      )}
    </div>
  );
}