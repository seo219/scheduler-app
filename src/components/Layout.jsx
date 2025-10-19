// src/components/Layout.jsx
import React from 'react';
import { Outlet } from 'react-router-dom';
import NavBar from './NavBar';
import './Layout.css'; // 필요하다면 스타일 파일 추가

export default function Layout() {
  return (
    <div className="layout-container">
      {/* 페이지 상단에 고정할 헤더가 있다면 여기에 넣으세요 */}
      <main>
        {/* 자식 라우트(페이지) 컴포넌트가 이곳에 렌더링됩니다 */}
        <Outlet />
      </main>
      {/* 모든 페이지 하단에 고정될 네비게이션 바 */}
      <NavBar />
    </div>
  );
}
