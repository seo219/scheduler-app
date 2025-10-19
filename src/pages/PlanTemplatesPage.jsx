// src/pages/PlanTemplatesPage.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate }                  from 'react-router-dom';
import { collection, getDocs }          from 'firebase/firestore';
import { db, auth }                     from '../firebaseConfig';
import { deleteTemplate }               from '../services/templateService';
import './PlanTemplatesPage.css';
import { FileText as FileTextIcon } from 'lucide-react';

export default function PlanTemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const navigate = useNavigate();

  // Firestore에서 템플릿 목록 로드
  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) return;
      const snap = await getDocs(collection(db, 'users', user.uid, 'templates'));
      setTemplates(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    })();
  }, []);

  // 새 템플릿 페이지로 이동
  const handleNew = () => {
    navigate('/templates/new');
  };

  // 템플릿 편집 페이지로 이동
  const handleEdit = (id) => {
    navigate(`/templates/${id}/edit`);
  };

  // 템플릿 삭제
  const handleDelete = async (id) => {
    const user = auth.currentUser;
    if (!user) return;
    if (!window.confirm('정말 삭제하시겠습니까?')) return;
    try {
      await deleteTemplate(user.uid, id);
      setTemplates(prev => prev.filter(t => t.id !== id));
    } catch (err) {
      alert('삭제 중 오류: ' + err.message);
    }
  };

  return (
    <div className="templates-page">
      <h1>
        <FileTextIcon size={28} style={{ verticalAlign: 'middle', marginRight: '8px', marginBottom:'4px'}}/>
        템플릿 관리
        </h1>
      <button className="btn new" onClick={handleNew}>
        + 새 템플릿 추가
      </button>
      <ul className="template-list">
        {templates.length === 0 ? (
          <li className="empty">등록된 템플릿이 없습니다.</li>
        ) : (
          templates.map(tpl => (
            <li key={tpl.id} className="template-item">
              <span className="name">{tpl.name}</span>
              <div className="actions">
                <button className="btn edit" onClick={() => handleEdit(tpl.id)}>
                  수정
                </button>
                <button className="btn delete" onClick={() => handleDelete(tpl.id)}>
                  삭제
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
