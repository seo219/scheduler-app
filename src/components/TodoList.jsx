import React, { useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import './TodoList.css'; // 스타일은 필요에 따라 작성

export default function TodoList({ items, setItems }) {
  const [openId, setOpenId] = useState(null);

  const addItem = () =>
    setItems([...items, { id: Date.now(), text: '', dueDate: null }]);

  const deleteItem = (id) =>
    setItems(items.filter(it => it.id !== id));

  const updateText = (id, text) =>
    setItems(items.map(it => it.id === id ? { ...it, text } : it));

  const updateDate = (id, date) => {
    setItems(items.map(it => it.id === id ? { ...it, dueDate: date } : it));
    setOpenId(null);
  };

  return (
    <div className="todo-list">
      <h3>✅ 할 일 목록</h3>
      <button onClick={addItem}>＋ 추가</button>
      {items.map(item => (
        <div key={item.id} className="todo-item">
          <input
            type="text"
            placeholder="내용"
            value={item.text}
            onChange={e => updateText(item.id, e.target.value)}
          />
          <button onClick={() => setOpenId(item.id)}>
            {item.dueDate ? item.dueDate.toLocaleDateString() : '마감일'}
          </button>
          <button onClick={() => deleteItem(item.id)}>삭제</button>
          {openId === item.id && (
            <DatePicker
              selected={item.dueDate}
              onChange={date => updateDate(item.id, date)}
              inline
            />
          )}
        </div>
      ))}
    </div>
  );
}
