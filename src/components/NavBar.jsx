// src/components/NavBar.jsx
import React from 'react';
import { NavLink } from 'react-router-dom';
import { Calendar, FileText, CheckSquare, Settings } from 'lucide-react';
import './NavBar.css';

const items = [
  { to: '/calendar',  Icon: Calendar,   label: '캘린더' },
  { to: '/templates', Icon: FileText,   label: '템플릿' },
  { to: '/todos',     Icon: CheckSquare,label: '할 일' },
  { to: '/settings',  Icon: Settings,   label: '설정' },
];

export default function NavBar() {
  return (
    <nav className="nav-bar">
      {items.map((it) => {
        const I = it.Icon;              // ← 지역 변수로 고정 (icon 이름 안 씀)
        return (
          <NavLink
            key={it.to}
            to={it.to}
            className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
          >
            <I className="nav-icon" size={24} />
            <span className="nav-label">{it.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
