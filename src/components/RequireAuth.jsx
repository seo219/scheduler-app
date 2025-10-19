import React, { useState, useEffect } from 'react';
import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { auth }                       from '../firebaseConfig';
import { onAuthStateChanged }         from 'firebase/auth';

export default function RequireAuth() {
  const [user, setUser] = useState(undefined);
  const location = useLocation();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, u => setUser(u));
    return () => unsub();
  }, []);

  if (user === undefined) {
    return <div>로딩중…</div>;
  }
  if (user === null) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <Outlet />;
}
