// src/pages/TemplateSelectPage.jsx
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams }      from 'react-router-dom';
import { auth, db }                    from '../firebaseConfig';
import { collection, getDocs }         from 'firebase/firestore';
import './TemplateSelectPage.css';

export default function TemplateSelectPage() {
  // 1) URL 파라미터에서 date(YYYY-MM-DD) 읽기
  const { date } = useParams();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);

  // 2) Firestore에서 템플릿 목록 로드
  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) return;
      const ref  = collection(db, 'users', user.uid, 'templates');
      const snap = await getDocs(ref);
      setTemplates(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    })();
  }, []);

  // 3) 템플릿 불러오기 버튼 핸들러
  const handleLoadTemplate = (templateId) => {
    // PlanDetailForm 편집 경로에 ?template= 쿼리로 전달
    navigate(`/plan/${date}/edit?template=${templateId}`);
  };

  return (
    <div className="template-select-page">
      <h2>📋 템플릿 불러오기</h2>
      {templates.length === 0 ? (
        <p>불러올 템플릿이 없습니다.</p>
      ) : (
        <ul className="template-list">
          {templates.map(tpl => (
            <li key={tpl.id} className="template-item">
              <span className="template-name">{tpl.name || '이름 없는 템플릿'}</span>
              <button
                className="btn-load"
                onClick={() => handleLoadTemplate(tpl.id)}
              >
                불러오기
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
