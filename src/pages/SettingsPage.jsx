// src/pages/SettingsPage.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../firebaseConfig';
import {
  signOut,
  sendPasswordResetEmail,
  deleteUser
} from 'firebase/auth';
import {
  getDocs,
  collection,
  deleteDoc,
  doc
} from 'firebase/firestore';
import './SettingsPage.css';
import { Settings as SettingsIcon } from 'lucide-react';

export default function SettingsPage() {
  const [email, setEmail] = useState('');
  const [fontFamily, setFontFamily] = useState(
    localStorage.getItem('fontFamily') || 'system-ui, sans-serif'
  );
  const navigate = useNavigate();

  // 사용자 이메일 가져오기
  useEffect(() => {
    const u = auth.currentUser;
    setEmail(u?.email || '익명 사용자');
  }, []);

  // CSS 변수와 localStorage에 폰트 패밀리 반영
  useEffect(() => {
    document.documentElement.style.setProperty('--font-family', fontFamily);
    localStorage.setItem('fontFamily', fontFamily);
  }, [fontFamily]);

  // 게스트 데이터 삭제 + 계정 삭제
  const clearAndRemoveGuest = async (uid) => {
    const colls = ['todos', 'templates', 'dailySchedules'];
    for (const collName of colls) {
      const snap = await getDocs(collection(db, 'users', uid, collName));
      for (const d of snap.docs) {
        await deleteDoc(doc(db, 'users', uid, collName, d.id));
      }
    }
    const user = auth.currentUser;
    if (user) await deleteUser(user);
  };

  // 로그아웃 & (익명이면) 계정 삭제
  const handleLogout = async () => {
    const user = auth.currentUser;
    if (!user) return;
    if (user.isAnonymous) {
      if (!window.confirm('게스트 데이터+계정이 완전 삭제됩니다. 계속하시겠습니까?')) return;
      await clearAndRemoveGuest(user.uid);
      navigate('/login');
      return;
    }
    await signOut(auth);
    navigate('/login');
  };

  const handleResetPassword = async () => {
    if (!email) return alert('등록된 이메일이 없습니다.');
    await sendPasswordResetEmail(auth, email);
    alert('비밀번호 재설정 메일을 보냈습니다.');
  };

  const handleDeleteAccount = async () => {
    const user = auth.currentUser;
    if (!user || user.isAnonymous) return;
    if (!window.confirm('정말 계정을 삭제하시겠습니까?')) return;
    try {
      await deleteUser(user);
      navigate('/register');
    } catch {
      alert('오류: 재인증 후 다시 시도해주세요.');
    }
  };

  return (
    <div className="settings-page">
      <h1>
        <SettingsIcon
          size={28}
          style={{
            verticalAlign: 'middle',
            marginRight: '8px',
            marginBottom: '6px'
          }}
        />
        설정
      </h1>

      {/* 계정 관련 */}
      <section className="section">
  <h2>계정</h2>
  <p className="account-info">
    <span className="account-label">로그인 계정:</span> {email}
  </p>

  <div className="button-group">
    <button onClick={handleLogout} className="btn logout">
      로그아웃{auth.currentUser?.isAnonymous ? ' & 삭제' : ''}
    </button>

    {!auth.currentUser?.isAnonymous && (
      <>
        <button onClick={handleResetPassword} className="btn reset">
          비밀번호 재설정
        </button>
        <button onClick={handleDeleteAccount} className="btn delete-account">
          계정 삭제
        </button>
      </>
    )}
  </div>
</section>

      {/* 글꼴 설정 */}
      <section className="section">
        <h2>글꼴 설정</h2>
        <div className="form-group">
          <label>글꼴</label>
          <select
            value={fontFamily}
            onChange={(e) => setFontFamily(e.target.value)}
          >
            <option value="system-ui, sans-serif">System UI</option>
            <option value="Arial, sans-serif">Arial</option>
            <option value="'Times New Roman', serif">Times New Roman</option>
            <option value="'Courier New', monospace">Courier New</option>
          </select>
        </div>
      </section>
    </div>
  );
}
