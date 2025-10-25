import React, { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { generateHolidayScheduleFreeform } from '../api/gptScheduler';
import { auth, db } from '../firebaseConfig';
import { doc, setDoc } from 'firebase/firestore';
import './HolidaySchedulePage.css';
import { TYPE_COLORS } from '../constants/typeColors';

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

export default function HolidaySchedulePage() {
  const { dateKey } = useParams(); // YYYY-MM-DD
  const navigate = useNavigate();

  const dateTitle = useMemo(
    () => (dateKey ? dateKey.replace(/-/g, '. ') : ''),
    [dateKey]
  );

  const [memo, setMemo] = useState('');        // 자유 입력
  const [autonomy, setAutonomy] = useState(75); // 재량 슬라이더
  const [loading, setLoading] = useState(false);

  const [tasksForSave, setTasksForSave] = useState([]); // 엔진 결과
  const [previewRows, setPreviewRows] = useState([]);   // 표 표시용

  const handleGenerate = async () => {
    if (!memo.trim()) {
      alert('원하는 분위기/키워드/제약을 자유롭게 적어주세요.');
      return;
    }
    try {
      setLoading(true);
      // fixedData를 비워두면 내부 기본 sleep/meals로 처리됨
      const tasks = await generateHolidayScheduleFreeform({
        dateKey,
        freeText: memo,
        autonomy,
        tz: 'Asia/Seoul',
        fixedData: {}
      });
      setTasksForSave(tasks);

      const rows = tasks
        .filter(t => !/휴식|rest|break/i.test(String(t.task || t.activity)))
        .map(t => ({
          start: t.start,
          end: t.end,
          label: t.activity || t.task,
          type: t.type || 'holiday',
        }));
      setPreviewRows(rows);
    } catch (err) {
      console.error('[HolidaySchedulePage] freeform generate error:', err);
      alert('생성 중 문제가 발생했어요.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      if (!Array.isArray(tasksForSave) || tasksForSave.length === 0) {
        console.log('먼저 생성해주세요.');
        return;
      }
      const user = auth.currentUser;
      if (!user?.uid) {
        console.log('로그인 후 이용해주세요.');
        return;
      }
      const docId = String(dateKey ?? '').trim();
      if (!docId) {
        console.log('dateKey가 비어있습니다.');
        return;
      }

      const payload = {
        isHoliday: true,
        freeText: memo,
        autonomy,
        generatedTasks: dedupeTasks(toSavable(tasksForSave)),
      };

      const ref = doc(db, 'users', user.uid, 'dailySchedules', docId);
      await setDoc(ref, payload, { merge: true });
      console.log('휴일 일정으로 저장되었습니다.');
      navigate(`/calendar?date=${docId}`, { replace: true });
    } catch (err) {
      console.error('[HolidaySchedulePage] save error:', err);
    }
  };

  return (
    <div className="holiday-schedule-page">
      <h2>{dateTitle} 휴일 일정 — 자유 입력 (AI 재량)</h2>

      <div className="controls" style={{marginBottom: 16}}>
        <label style={{flex:1}}>
          메모
          <textarea
            rows={4}
            value={memo}
            onChange={(e)=>setMemo(e.target.value)}
            placeholder="예) 햇빛+산책 / 조용한 실내 / 붐비는 곳 싫음 / 예산 3만원 / 멀리 X / 비와도 OK ..."
            style={{width:'100%'}}
          />
        </label>

        <label style={{display:'flex', alignItems:'center', gap:8}}>
          재량
          <input
            type="range"
            min={0}
            max={100}
            value={autonomy}
            onChange={e=>setAutonomy(Number(e.target.value))}
          />
          <span className="mono">{autonomy}</span>
        </label>

        <button onClick={handleGenerate} disabled={loading} className="control-btn">
          {loading ? '생성 중…' : 'AI로 생성'}
        </button>
      </div>

      {previewRows.length > 0 && (
        <>
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
                  {previewRows.map((r, i) => (
                    <tr key={i} className={`row-${r.type || 'holiday'}`}>
                      <td className="time">{r.start}</td>
                      <td className="time">{r.end || '—'}</td>
                      <td className="label">{r.label}</td>
                    </tr>
                  ))}
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

