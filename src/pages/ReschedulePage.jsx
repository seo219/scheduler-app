// src/pages/ReschedulePage.jsx

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { generateSlotTimes, generateSchedule } from '../api/gptScheduler';
import { loadTodos } from '../services/todoService';
import { auth, db } from '../firebaseConfig';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import './ReschedulePage.css';

export default function ReschedulePage() {
  const { date } = useParams();            // YYYY-MM-DD
  const navigate = useNavigate();

  const [fixedData, setFixedData]   = useState({});
  const [todos, setTodos]           = useState([]);
  const [aiTasks, setAiTasks]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);

  // 로딩 완료 플래그 & 중복 호출 가드
  const [fixedLoaded, setFixedLoaded] = useState(false);
  const [todosLoaded, setTodosLoaded] = useState(false);
  const aiRequestedRef = useRef(false);

  // 1) Firestore에서 오늘의 fixedData(수면·식사·고정 일정) 불러오기
  useEffect(() => {
    async function fetchFixedData() {
      try {
        const user = auth.currentUser;
        if (!user) return; // 로그인 가드
        const ref = doc(db, 'users', user.uid, 'dailySchedules', date);
        const snap = await getDoc(ref);
        if (!snap.exists()) { setFixedLoaded(true); return; }

        const tasks = snap.data().generatedTasks || [];

        // 수면: task === '수면' 으로 들어있는 것을 표준화
        const sleep = tasks.find(it => it.task === '수면');
        const sleepTime = sleep
          ? { wakeUp: sleep.end, bedTime: sleep.start }
          : { wakeUp: '', bedTime: '' };

        // 식사: type === 'meal'
        const meals = tasks
          .filter(it => it.type === 'meal')
          .map(it => ({ start: it.start, end: it.end }));

        // 고정: type === 'fixed'
        const schedules = tasks
          .filter(it => it.type === 'fixed')
          .map(it => ({
            start: it.start,
            end: it.end,
            task: it.task,
            color: it.color || '#E3F9E5',
          }));

        setFixedData({ sleepTime, meals, schedules });
        setFixedLoaded(true);
      } catch (e) {
        console.error(e);
        setFixedLoaded(true); // 실패해도 진행은 하도록
      }
    }
    fetchFixedData();
  }, [date]);

  // 2) To-Do 목록 불러오기
  useEffect(() => {
    async function fetchTodos() {
      try {
        const user = auth.currentUser;
        if (!user) { setTodosLoaded(true); return; }
        const list = await loadTodos(user.uid);
        setTodos(list);
      } finally {
        setTodosLoaded(true);
      }
    }
    fetchTodos();
  }, []);

  // 3) AI 일정 생성: 로딩 완료 후 딱 1회만
  useEffect(() => {
    if (!fixedLoaded || !todosLoaded) return;
    if (aiRequestedRef.current) return;
    aiRequestedRef.current = true;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        // (디버깅 필요 없으면 주석 처리 가능)
        await generateSlotTimes({ fixedData });

        const schedule = await generateSchedule({ fixedData, todoData: todos });
        setAiTasks(schedule);
      } catch (e) {
        setError(e.message || '알 수 없는 오류');
      } finally {
        setLoading(false);
      }
    })();
  }, [fixedLoaded, todosLoaded, fixedData, todos]);

  // 4) 저장 핸들러
  const handleSave = async () => {
    try {
      const user = auth.currentUser;
      if (!user) {
        alert('로그인 후 이용해주세요.');
        return;
      }
      const ref = doc(db, 'users', user.uid, 'dailySchedules', date);
      await setDoc(ref, { generatedTasks: aiTasks, isHoliday: false }, { merge: true });
      navigate('/calendar');
    } catch (e) {
      alert('저장 오류: ' + e.message);
    }
  };

  if (loading) return <div className="reschedule-page">AI 일정 생성 중…</div>;
  if (error)   return <div className="reschedule-page error">오류: {error}</div>;

  return (
    <div className="reschedule-page">
      <h2>{date.replace(/-/g, '. ')} AI 일정 미리보기</h2>

      {aiTasks.length === 0 ? (
        <p>생성된 일정이 없습니다.</p>
      ) : (
        <table className="ai-table">
          <thead>
            <tr>
              <th>시간</th>
              <th>내용</th>
            </tr>
          </thead>
          <tbody>
            {aiTasks.map((t, i) => (
              <tr key={i} style={{ backgroundColor: t.color || 'transparent' }}>
                <td>{t.start} – {t.end}</td>
                <td>{t.activity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="btn-group">
        <button onClick={handleSave}>일정으로 저장</button>
        <button onClick={() => navigate(-1)}>취소</button>
      </div>
    </div>
  );
}
