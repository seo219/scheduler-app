import React, { useState, useEffect } from 'react';
import './FixedSchedule.css';

const DEFAULT_MEALS = [
  { type: '아침', start: '', end: '' },
  { type: '점심', start: '', end: '' },
  { type: '저녁', start: '', end: '' },
];

export default function FixedSchedule({ fixedData, setFixedData }) {

  // local state
  const [sleepStart, setSleepStart] = useState('');
  const [sleepEnd, setSleepEnd] = useState('');
  const [meals, setMeals] = useState([]);
  const [fixedList, setFixedList] = useState([]);

  useEffect(() => {
    setSleepStart(fixedData.sleepTime?.bedTime ?? '');
    setSleepEnd(fixedData.sleepTime?.wakeUp ?? '');
    setMeals(fixedData.meals?.length ? fixedData.meals : DEFAULT_MEALS);
    setFixedList(fixedData.schedules ?? []);
  }, [fixedData]); // ✅ DEFAULT_MEALS는 모듈 상수라 deps에 안 넣어도 됨

  // 수면
  const handleSleepStart = (val) => {
    setSleepStart(val);
    setFixedData({ sleepTime: { bedTime: val, wakeUp: sleepEnd }, meals, schedules: fixedList });
  };
  const handleSleepEnd = (val) => {
    setSleepEnd(val);
    setFixedData({ sleepTime: { bedTime: sleepStart, wakeUp: val }, meals, schedules: fixedList });
  };

  // 식사
  const addMeal = () => {
    const newMeals = [...meals, { type: '간식', start: '', end: '' }];
    setMeals(newMeals);
    setFixedData({ sleepTime: { bedTime: sleepStart, wakeUp: sleepEnd }, meals: newMeals, schedules: fixedList });
  };
  const updateMeal = (i, field, val) => {
    const newMeals = meals.map((m, idx) => idx === i ? { ...m, [field]: val } : m);
    setMeals(newMeals);
    setFixedData({ sleepTime: { bedTime: sleepStart, wakeUp: sleepEnd }, meals: newMeals, schedules: fixedList });
  };
  const removeMeal = i => {
    const newMeals = meals.filter((_, idx) => idx !== i);
    setMeals(newMeals);
    setFixedData({ sleepTime: { bedTime: sleepStart, wakeUp: sleepEnd }, meals: newMeals, schedules: fixedList });
  };

  // 고정 스케줄
  const addFixed = () => {
    const newList = [...fixedList, { task: '', start: '', end: '', color: '#F3FFF3' }];
    setFixedList(newList);
    setFixedData({ sleepTime: { bedTime: sleepStart, wakeUp: sleepEnd }, meals, schedules: newList });
  };
  const updateFixed = (i, field, val) => {
    const newList = fixedList.map((f, idx) => idx === i ? { ...f, [field]: val } : f);
    setFixedList(newList);
    setFixedData({ sleepTime: { bedTime: sleepStart, wakeUp: sleepEnd }, meals, schedules: newList });
  };
  const removeFixed = (i) => {
    const newList = fixedList.filter((_, idx) => idx !== i);
    setFixedList(newList);
    setFixedData({ sleepTime: { bedTime: sleepStart, wakeUp: sleepEnd }, meals, schedules: newList });
  };

  return (
    <div className="fixed-schedule">
      <h2>수면 시간</h2>
      <div className="time-row">
        <label>기상</label>
        <input type="time" value={sleepEnd} onChange={e => handleSleepEnd(e.target.value)} />
        <label>취침</label>
        <input type="time" value={sleepStart} onChange={e => handleSleepStart(e.target.value)} />
      </div>

      <h2>식사 시간</h2>
      {meals.map((m, i) => (
        <div className="time-row" key={i}>
          <label></label>
          <select value={m.type || ''} onChange={e => updateMeal(i, 'type', e.target.value)}>
            <option value="아침">아침</option>
            <option value="점심">점심</option>
            <option value="저녁">저녁</option>
            <option value="간식">간식</option>
          </select>
          <label>시작</label>
          <input type="time" value={m.start || ''} onChange={e => updateMeal(i, 'start', e.target.value)} />
          <label>종료</label>
          <input type="time" value={m.end || ''} onChange={e => updateMeal(i, 'end', e.target.value)} />
          <button className="delete-btn" onClick={() => removeMeal(i)}>삭제</button>
        </div>
      ))}
      <button className="add-btn" onClick={addMeal}>+ 식사 시간 추가</button>

      <h2>고정 스케줄</h2>
      {fixedList.map((f, i) => (
        <div className="time-row" key={i}>
          <input placeholder="할 일" value={f.task} onChange={e => updateFixed(i, 'task', e.target.value)} />
          <label>시작</label>
          <input type="time" value={f.start} onChange={e => updateFixed(i, 'start', e.target.value)} />
          <label>종료</label>
          <input type="time" value={f.end} onChange={e => updateFixed(i, 'end', e.target.value)} />
          <label>색상</label>
          <input type="color" value={f.color} onChange={e => updateFixed(i, 'color', e.target.value)} />
          <button className="delete-btn" onClick={() => removeFixed(i)}>삭제</button>
        </div>
      ))}
      <button className="add-btn" onClick={addFixed}>+ 고정 일정 추가</button>
    </div>
  );
}
