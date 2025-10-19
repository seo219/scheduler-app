import React, { useState, useEffect } from 'react';
import { useParams, useNavigate }        from 'react-router-dom';
import FixedSchedule                      from '../components/FixedSchedule';
import { auth }                           from '../firebaseConfig';
import { loadTemplate, saveTemplate }     from '../services/templateService';
import './TemplateForm.css';

export default function TemplateForm() {
  const { id } = useParams();           // id = 템플릿 ID (편집 모드 여부)
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  const [name, setName] = useState('');
  const [fixedData, setFixedData] = useState({
    sleepTime: { wakeUp: '', bedTime: '' },
    meals:     [],
    schedules: []
  });

  // 편집 모드: 기존 템플릿 불러오기
  useEffect(() => {
    if (isEdit) {
      const user = auth.currentUser;
      if (!user) return;

      loadTemplate(user.uid, id).then(data => {
        if (data) {
          setName(data.name || '');
          setFixedData({
            sleepTime: data.sleepTime || { wakeUp: '', bedTime: '' },
            meals:     data.meals     || [],
            schedules: data.schedules || []
          });
        }
      });
    }
  }, [id, isEdit]);

  // 템플릿 저장 핸들러
  const handleSubmit = async () => {
    const user = auth.currentUser;
    if (!user) {
      alert('로그인이 필요합니다.');
      return;
    }

    if (!name.trim()) {
      alert('템플릿 이름을 입력해주세요.');
      return;
    }

    try {
      await saveTemplate(user.uid, { name, ...fixedData }, id);
      alert('템플릿 저장 완료!');
      navigate('/templates');
    } catch (err) {
      alert('저장 실패: ' + (err.message || err));
    }
  };

  return (
    <div className="template-form">
      <h1>{isEdit ? '템플릿 수정' : '새 템플릿 만들기'}</h1>

      <input
        type="text"
        placeholder="템플릿 이름"
        value={name}
        onChange={e => setName(e.target.value)}
      />

      {/* 수면, 식사, 고정 일정 입력 컴포넌트 */}
      <FixedSchedule
        fixedData={fixedData}
        setFixedData={setFixedData}
      />

      <button onClick={handleSubmit}>
        {isEdit ? '저장하기' : '생성하기'}
      </button>
    </div>
  );
}
