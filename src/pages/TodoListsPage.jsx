import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebaseConfig';
import { loadTodos, deleteTodo } from '../services/todoService';
import './TodoListsPage.css';
import { CheckSquare as CheckSquareIcon } from 'lucide-react';

export default function TodoListsPage() {
  const [todos, setTodos] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    const loadAndClean = async () => {
      const user = auth.currentUser;
      if (!user) return;
      const all = await loadTodos(user.uid);

      const today = new Date();
      today.setHours(0,0,0,0);
      const expired = all.filter(t => new Date(t.dueDate) < today);
      for (const t of expired) {
        await deleteTodo(user.uid, t.id);
      }
      setTodos(all.filter(t => new Date(t.dueDate) >= today));
    };

    loadAndClean();
  }, []);

  const calcDDay = dueDateStr => {
    const today = new Date(); today.setHours(0,0,0,0);
    const dueDate = new Date(dueDateStr); dueDate.setHours(0,0,0,0);
    const diffDays = Math.ceil((dueDate - today) / (1000*60*60*24));
    if (diffDays > 0) return `D-${diffDays}`;
    if (diffDays === 0) return 'D-day';
    return `D+${Math.abs(diffDays)}`;
  };

  const handleDelete = async id => {
    const user = auth.currentUser;
    if (!user) return;
    if (!window.confirm('정말 이 할 일을 삭제하시겠습니까?')) return;
    try {
      await deleteTodo(user.uid, id);
      setTodos(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  };

  return (
    <div className="todos-page">
      <h1>
        <CheckSquareIcon size={28} style={{ verticalAlign: 'middle', marginRight: '8px', marginBottom:'4px'}}/>
        할 일 목록
      </h1>
      <button className="btn new-todo" onClick={() => navigate('/todos/new')}>
        + 새 할 일 추가
      </button>

      {todos.length === 0 ? (
        <p className="empty">등록된 할 일이 없습니다.</p>
      ) : (
        <ul className="todo-list">
          {todos.map(todo => (
            <li key={todo.id} className="todo-item">
              <span className="text">{todo.text}</span>
              <div className="date-info">
                <span className="due">{new Date(todo.dueDate).toLocaleDateString('ko-KR')}</span>
                <span className="dday">{calcDDay(todo.dueDate)}</span>
              </div>
              <div className="actions">
                <button className="btn edit" onClick={() => navigate(`/todos/${todo.id}/edit`)}>수정</button>
                <button className="btn delete" onClick={() => handleDelete(todo.id)}>삭제</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
