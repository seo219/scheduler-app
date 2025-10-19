import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { auth } from '../firebaseConfig';
import {
  signInWithEmailAndPassword,
  signInAnonymously
} from 'firebase/auth';
import './AuthPages.css';

export default function LoginPage() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleLogin = async () => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate('/calendar');
    } catch (err) {
      alert('로그인 실패: ' + err.message);
    }
  };

  const handleGuest = async () => {
    try {
      await signInAnonymously(auth);
      navigate('/calendar');
    } catch (err) {
      alert('게스트 로그인 실패: ' + err.message);
    }
  };

  return (
    <div className="auth-container">
      <h2>로그인</h2>
      <input
        type="email"
        placeholder="이메일"
        value={email}
        onChange={e => setEmail(e.target.value)}
      />
      <input
        type="password"
        placeholder="비밀번호"
        value={password}
        onChange={e => setPassword(e.target.value)}
      />
      <div className="btn-group">
        <button onClick={handleLogin}>로그인</button>
        <button onClick={handleGuest}>게스트 로그인</button>
      </div>
      <p>
        계정이 없으신가요? <Link to="/register">회원가입</Link>
      </p>
    </div>
  );
}
