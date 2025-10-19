// src/App.jsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';

import RequireAuth from './components/RequireAuth';
import Layout       from './components/Layout';

import LoginPage            from './pages/LoginPage';
import RegisterPage         from './pages/RegisterPage';
import CalendarPage         from './pages/CalendarPage';
import PlanDetailForm       from './pages/PlanDetailForm';
import ReschedulePage       from './pages/ReschedulePage';

import PlanTemplatesPage    from './pages/PlanTemplatesPage';
import TemplateForm         from './pages/TemplateForm';
import TemplateSelectPage   from './pages/TemplateSelectPage';

import TodoListsPage        from './pages/TodoListsPage';
import TodoForm             from './pages/TodoForm';

import HolidayPage          from './pages/HolidayPage';
import HolidaySchedulePage  from './pages/HolidaySchedulePage';
import HolidayScheduleForm  from './pages/HolidayScheduleForm';

import AISchedulePage       from './pages/AISchedulePage';

import SettingsPage         from './pages/SettingsPage';

import FullSchedulePage from './pages/FullSchedulePage';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/full-schedule" element={<FullSchedulePage />} />
        
        {/* Public */}
        <Route path="/login"    element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Protected */}
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/calendar" replace />} />

            {/* Calendar & Plans */}
            <Route path="calendar"        element={<CalendarPage />} />
            <Route path="plan/:date"      element={<PlanDetailForm />} />
            <Route path="plan/:date/edit" element={<PlanDetailForm isEdit />} />
            <Route path="reschedule/:date" element={<ReschedulePage />} />

            {/* Holiday */}
            <Route path="holiday"                element={<HolidayPage />} />
            <Route path="holiday/schedule/:dateKey" element={<HolidaySchedulePage />} />
            <Route path="holiday/form"           element={<HolidayScheduleForm />} />

            {/* AI 스케줄링 */}
            <Route path="ai/schedule/:date"      element={<AISchedulePage />} />

            {/* Templates */}
            <Route path="templates"              element={<PlanTemplatesPage />} />
            <Route path="templates/new"          element={<TemplateForm />} />
            <Route path="templates/:id/edit"     element={<TemplateForm isEdit />} />
            <Route path="templates/select/:date" element={<TemplateSelectPage />} />

            {/* Todos */}
            <Route path="todos"       element={<TodoListsPage />} />
            <Route path="todos/new"   element={<TodoForm />} />
            <Route path="todos/:id/edit" element={<TodoForm isEdit />} />

            {/* Settings */}
            <Route path="settings" element={<SettingsPage />} />

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/calendar" replace />} />
          </Route>
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
