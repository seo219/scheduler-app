// src/pages/TodoForm.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams }      from 'react-router-dom';
import { auth }                        from '../firebaseConfig';
import { addTodo, loadTodo, updateTodo } from '../services/todoService';
import './TodoForm.css';

export default function TodoForm({ isEdit = false }) {
  const navigate = useNavigate();
  const { id }   = useParams();  // 편집 모드에서 URL 파라미터로 받은 할 일 ID
  const [text, setText]         = useState('');
  const [dueDate, setDueDate]   = useState('');

  // 편집 모드일 때 기존 할 일 불러오기
  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      const user = auth.currentUser;
      if (!user) return;
      const todo = await loadTodo(user.uid, id);
      if (todo) {
        setText(todo.text);
        setDueDate(todo.dueDate);
      }
    })();
  }, [isEdit, id]);

  // 저장 핸들러 (추가/수정 모두 처리)
  const handleSubmit = async e => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) return alert('로그인 후 이용해주세요.');
    try {
      if (isEdit) {
        await updateTodo(user.uid, id, { text, dueDate });
      } else {
        await addTodo(user.uid, { text, dueDate, isDone: false, priority: 0, duration: 30 });
      }
      navigate('/todos');
    } catch (err) {
      alert('저장 중 오류: ' + err.message);
    }
  };

  return (
    // 다인: 클래스 변경
    <div className="todo-form-page">
      <h2>{isEdit ? '할 일 수정' : '새 할 일 추가'}</h2>
      <form onSubmit={handleSubmit}>
        <label>
          할 일
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            required
          />
        </label>
        <label>
          마감일
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            required
          />
        </label>
        <button type="submit" className="btn submit">
          {isEdit ? '저장' : '추가'}
        </button>
      </form>
    </div>
  );
}
