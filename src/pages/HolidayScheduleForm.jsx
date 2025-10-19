// src/pages/HolidayScheduleForm.jsx
import React, { useState } from 'react';
import { generateSimpleSchedule } from '../api/gptScheduler';
import './HolidayScheduleForm.css';

export default function HolidayScheduleForm({
  dateKey,
  onSave,
  onCancel
}) {
  const [interest, setInterest] = useState('운동');
  const [generated, setGenerated] = useState([]);

  const interestOptions = ['운동','음악','미술','영화/드라마','독서'];

  // 추천 받기 (리롤)
  const handleRecommend = async () => {
    const text = await generateSimpleSchedule({ interest, mood: 'happy' });
    const lines = text.split('\n')
      .map(l => {
        const [time, task] = l.split(' - ');
        return time && task
          ? { time: time.trim(), task: task.trim() }
          : null;
      })
      .filter(Boolean);
    setGenerated(lines);
  };

  // 저장
  const handleSave = () => {
    onSave(generated);
  };

  return (
    <div className="holiday-form">
      <h3>{dateKey} 휴일 추천</h3>

      <div className="field">
        <label>관심사:</label>
        <select
          value={interest}
          onChange={e => setInterest(e.target.value)}
        >
          {interestOptions.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>

      <div className="buttons">
        <button onClick={handleRecommend}>
          {generated.length ? '다시 추천' : '추천 받기'}
        </button>
        {generated.length > 0 && (
          <button onClick={handleSave}>확인 및 저장</button>
        )}
        <button onClick={onCancel}>취소</button>
      </div>

      {generated.length > 0 && (
        <div className="holiday-preview">
          <h4>추천 일정</h4>
          <ul>
            {generated.map((it, i) => (
              <li key={i}>{it.time} — {it.task}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
