// src/pages/PlanDetailForm.jsx
import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import FixedSchedule from '../components/FixedSchedule';
import { auth, db } from '../firebaseConfig';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { loadTemplate, saveTemplate } from '../services/templateService';
import './PlanDetailForm.css';
import dayjs from "dayjs";


export default function PlanDetailForm() {
  const { date } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const templateId = new URLSearchParams(location.search).get('template');

  const passed = useMemo(
    () => location.state?.scheduleData || [],
    [location.state?.scheduleData]
  );

  const [name, setName] = useState('');
  const [fixedData, setFixedData] = useState({
    sleepTime: { wakeUp: '', bedTime: '' },
    meals: [
      { type: '아침', start: '', end: '' },
      { type: '점심', start: '', end: '' },
      { type: '저녁', start: '', end: '' },
    ],
    schedules: []
  });

  // 기존 데이터(Plan → 편집으로 넘어온 경우) 불러오기
  useEffect(() => {
    if (!passed.length) return;
    const sleep = passed.find(it => it.task === '수면');
    const sleepTime = sleep
      ? { wakeUp: sleep.end, bedTime: sleep.start }
      : { wakeUp: '', bedTime: '' };

    const meals = passed
      .filter(it => it.type === 'meal')
      .map(it => ({
        type: (it.task && it.task !== '식사') ? it.task : (it.mealType || '식사'),
        start: it.start,
        end: it.end
      }));

    const schedules = passed
      .filter(it => it.type === 'fixed')
      .map(it => ({
        task: it.task,
        start: it.start,
        end: it.end,
        color: it.color || '#F3FFF3'
      }));

    setFixedData({ sleepTime, meals, schedules });
  }, [passed]);

  // 템플릿 또는 기존 저장된 일정 로딩
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    if (templateId) {
      loadTemplate(user.uid, templateId).then(tpl => {
        if (!tpl) return;
        setName(tpl.name);
        setFixedData({
          sleepTime: tpl.sleepTime,
          meals: tpl.meals,
          schedules: tpl.schedules
        });
      });
    } else if (!passed.length) {
      (async () => {
        const ref = doc(db, 'users', user.uid, 'dailySchedules', date);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;
        const data = snap.data();
        setName(data.name || '');

        const tasks = data.generatedTasks || [];
        const sleep = tasks.find(it => it.task === '수면');
        const sleepTime = sleep
          ? { wakeUp: sleep.end, bedTime: sleep.start }
          : { wakeUp: '', bedTime: '' };

        const meals = tasks
          .filter(it => it.type === 'meal')
          .map(it => ({
            type: (it.task && it.task !== '식사') ? it.task : (it.mealType || '식사'),
            start: it.start,
            end: it.end
          }));

        const schedules = tasks
          .filter(it => it.type === 'fixed')
          .map(it => ({
            task: it.task,
            start: it.start,
            end: it.end,
            color: it.color || '#F3FFF3'
          }));

        setFixedData({ sleepTime, meals, schedules });
      })();
    }
  }, [templateId, passed, date]);

  // 일정 저장
  const handleSaveSchedule = async () => {
    const user = auth.currentUser;
    if (!user) return alert('로그인 후 이용해주세요.');

    const tasks = [];
    const { wakeUp, bedTime } = fixedData.sleepTime;

    if (wakeUp && bedTime) {
      tasks.push({
        task: '수면',
        start: bedTime,
        end: wakeUp,
        type: 'sleep',
        color: '#E3D1FF'
      });
    }

    fixedData.meals.forEach(({ type, start, end }) => {
      if (start && end) {
        tasks.push({
          task: type || '식사',
          start,
          end,
          type: 'meal',
          color: '#F5F5F5'
        });
      }
    });

    fixedData.schedules.forEach(({ task, start, end, color }) => {
      if (task && start && end) {
        tasks.push({ task, start, end, type: 'fixed', color });
      }
    });

    try {
      const ref = doc(db, 'users', user.uid, 'dailySchedules', date);
      await setDoc(ref, { generatedTasks: tasks, isHoliday: false }, { merge: true });
      alert('일정이 저장되었습니다.');
      // 저장 후 해당 날짜가 열린 상태로 달력으로 이동
      navigate(`/calendar?date=${date}`, { replace: true });
    } catch (err) {
      alert('저장 중 오류: ' + err.message);
    }
  };

  // 템플릿 저장 (버튼 누를 때에만 이름 입력)
  const handleSaveTemplate = async () => {
    const user = auth.currentUser;
    if (!user) return alert('로그인 후 이용해주세요.');

    let templateName = name?.trim();
    if (!templateName) {
      templateName = window.prompt('템플릿 이름을 입력해주세요', '예: 평일 기본');
      if (!templateName || !templateName.trim()) return;
      setName(templateName.trim());
    }

    try {
      await saveTemplate(user.uid, { name: templateName.trim(), ...fixedData }, templateId);
      alert('템플릿이 저장되었습니다.');
    } catch (err) {
      alert('저장 실패: ' + err.message);
    }
  };

  // ✅ 휴일 지정 버튼: "휴일 일정 추천" 페이지로 이동만 수행
  // ✅ buildBusyBlocks(...) 바로 아래에 둡니다.
  // const handleGoHolidaySchedule = () => {
  //   if (!date) return alert("날짜를 찾을 수 없습니다.");

  //   const dateKey = date;
  //   const dateISO = dayjs(dateKey).startOf("day").toISOString();

  //   // 1번 화면의 현재 입력값을 form으로 매핑
  //   const form = {
  //     wake: fixedData.sleepTime?.wakeUp || "",   // "HH:mm"
  //     sleep: fixedData.sleepTime?.bedTime || "",  // "HH:mm"
  //     meals: (fixedData.meals || []).map(m => ({
  //       title: m.type || "식사",
  //       start: m.start,
  //       end: m.end,
  //     })),
  //     plans: (fixedData.schedules || []).map(p => ({
  //       title: p.task || "일정",
  //       start: p.start,
  //       end: p.end,
  //     })),
  //   };

  //   const busyBlocks = buildBusyBlocks(dateISO, form);

  //   // 새로고침에도 유지되도록 백업
  //   sessionStorage.setItem(`busy:${dateKey}`, JSON.stringify(busyBlocks));

  //   // 2번 화면으로 이동(라우트 구조에 맞게 유지)
  //   navigate(`/holiday/schedule/${dateKey}`, { state: { busyBlocks } });
  // };


  const handleLoadTemplate = () => {
    navigate(`/templates/select/${date}`);
  };

  // "오전/오후 10:00" 같은 문자열도 대응해서 HH:mm로 바꿔주기
  function normalizeHHMM(s) {
    if (!s) return s;
    const m = String(s).match(/(오전|오후)?\s?(\d{1,2}):(\d{2})/);
    if (!m) return s; // 이미 HH:mm이면 그대로
    let h = Number(m[2]), mm = m[3];
    if (m[1] === "오후" && h < 12) h += 12;
    if (m[1] === "오전" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${mm}`;
  }

  // 같은 날짜 기준 HH:mm → ISO
  function toISO(dateISO, hhmm) {
    const t = normalizeHHMM(hhmm);
    if (!t || t.includes("T")) return t;
    const [h, m] = t.split(":").map(Number);
    return dayjs(dateISO).startOf("day").add(h, "hour").add(m, "minute").toISOString();
  }

  // 수면/식사/고정 → busyBlocks
  function buildBusyBlocks(dateISO, form) {
    const out = [];
    // 수면
    out.push({
      title: "수면",
      type: "sleep",
      start: toISO(dateISO, form.sleep),   // 예: "02:00"
      end: toISO(dateISO, form.wake),    // 예: "10:00"
    });
    // 식사
    for (const m of form.meals || []) {
      out.push({
        title: m.title || "식사",
        type: "meal",
        start: toISO(dateISO, m.start),
        end: toISO(dateISO, m.end),
      });
    }
    // 고정 일정
    for (const p of form.plans || []) {
      out.push({
        title: p.title || "일정",
        type: "fixed",
        start: toISO(dateISO, p.start),
        end: toISO(dateISO, p.end),
      });
    }
    return out.sort((a, b) => new Date(a.start) - new Date(b.start));
  }

  // ── [버튼] 취미/휴일 일정 추천 페이지로 이동 (busyBlocks 전달)
// const handleHolidayDesignate = () => {
//   const dateKey = date;                                   // URL 파라미터로 받은 날짜 (YYYY-MM-DD)
//   const dateISO = dayjs(dateKey).startOf("day").toISOString();

//   // 현재 폼 값을 buildBusyBlocks가 읽는 형태로 맞춤
//   const form = {
//     wake:  fixedData?.sleepTime?.wakeUp || "",            // "HH:mm"
//     sleep: fixedData?.sleepTime?.bedTime || "",           // "HH:mm"
//     meals: (fixedData?.meals || []).map(m => ({
//       title: m.type || "식사",
//       start: m.start,
//       end:   m.end,
//     })),
//     plans: (fixedData?.schedules || []).map(p => ({
//       title: p.task || "일정",
//       start: p.start,
//       end:   p.end,
//     })),
//   };

//   const busyBlocks = buildBusyBlocks(dateISO, form);

//   // 새로고침 대비: 세션스토리지에도 백업
//   sessionStorage.setItem(`busy:${dateKey}`, JSON.stringify(busyBlocks));

//   // 새 페이지로 넘길 때 state로도 전달
//   navigate(`/holiday/schedule/${dateKey}`, { state: { busyBlocks } });
// };


//   // 계획표 작성 페이지 → 새 방식 "휴일 지정" (빈 시간만 AI가 채우는 경로로 이동)
// const handleHolidayDesignate = () => {
//   if (!date) return;
//   const dateKey = date;
//   const dateISO = dayjs(dateKey).startOf("day").toISOString();

//   const toISO = (hhmm) => {
//     if (!hhmm || hhmm.includes("T")) return hhmm;
//     const [h, m] = String(hhmm).split(":").map(Number);
//     return dayjs(dateISO).startOf("day").add(h, "hour").add(m, "minute").toISOString();
//   };
//   const toMin = (hhmm) => {
//     const [h, m] = String(hhmm).split(":").map(Number);
//     return h * 60 + m;
//   };

//   const blocks = [];

//   // 수면
//   const { bedTime, wakeUp } = fixedData?.sleepTime || {};
//   if (bedTime && wakeUp) {
//     let start = toISO(bedTime);
//     let end   = toISO(wakeUp);
//     // 취침이 자정을 넘는(예: 02:00) 경우 다음날로 이동
//     if (toMin(bedTime) <= toMin(wakeUp)) {
//       end = dayjs(end).add(1, "day").toISOString();
//     }
//     blocks.push({ title: "수면", type: "sleep", start, end });
//   }

//   // 식사
//   for (const m of fixedData?.meals || []) {
//     if (m.start && m.end) {
//       blocks.push({ title: m.type || "식사", type: "meal", start: toISO(m.start), end: toISO(m.end) });
//     }
//   }

//   // 고정 일정
//   for (const p of fixedData?.schedules || []) {
//     if (p.task && p.start && p.end) {
//       blocks.push({ title: p.task, type: "fixed", start: toISO(p.start), end: toISO(p.end) });
//     }
//   }

//   // 새로고침해도 유지되도록 sessionStorage에도 저장
//   sessionStorage.setItem(`busy:${dateKey}`, JSON.stringify(blocks));

//   // ★ 새 방식 라우트로 이동 (state에도 싣기)
//   navigate(`/holiday/schedule/${dateKey}`, { state: { busyBlocks: blocks } });
// };

  // 계획표 작성 페이지 → 새 방식 "휴일 지정" (빈 시간만 AI가 채우는 경로로 이동)
const handleHolidayDesignate = () => {
  if (!date) return;

  const dateKey = date;
  const dateISO = dayjs(dateKey).startOf("day").toISOString();

  // 1번 화면의 현재 입력값을 form으로 정리
  const form = {
    wake:  fixedData.sleepTime?.wakeUp || "",  // "HH:mm"
    sleep: fixedData.sleepTime?.bedTime || "", // "HH:mm"
    meals: (fixedData.meals || []).map(m => ({
      title: m.type || "식사",
      start: m.start,
      end:   m.end,
    })),
    plans: (fixedData.schedules || []).map(p => ({
      title: p.task || "일정",
      start: p.start,
      end:   p.end,
    })),
  };

  // ✅ 여기서 buildBusyBlocks를 실제 사용 → 미사용 경고 사라짐
  const busyBlocks = buildBusyBlocks(dateISO, form);

  // 새로고침 대비 백업
  sessionStorage.setItem(`busy:${dateKey}`, JSON.stringify(busyBlocks));

  // 새 방식 라우트로 이동(state도 전달)
  navigate(`/holiday/schedule/${dateKey}`, { state: { busyBlocks } });
};


  return (
    <div className="plan-detail-form">
      <h1> {date} 계획표 작성</h1>
      {/* ✅ 여기만 변경: onClick 핸들러만 교체 */}
      <div className="holiday-template-buttons">
        <button className="btn-holiday" onClick={handleHolidayDesignate}>취미 일정 추천</button>
        <button className="btn-template" onClick={handleLoadTemplate}>템플릿 불러오기</button>
      </div>
      <FixedSchedule fixedData={fixedData} setFixedData={setFixedData} />

      <div className="buttons">
        <button className="btn-primary" onClick={handleSaveSchedule}>일정으로 저장</button>
        <button className="btn-secondary" onClick={handleSaveTemplate}>템플릿 저장하기</button>
      </div>
    </div>
  );
}
