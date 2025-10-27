// src/services/holidayService.js
import { db } from '../firebaseConfig';
import {
  collection, doc, getDoc, getDocs, setDoc
} from 'firebase/firestore';

/* ---------- time utils ---------- */
const toMin = (hhmm = '00:00') => {
  const [h, m] = String(hhmm).split(':').map(n => parseInt(n, 10));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
};
const toHHMM = (min) => {
  const t = Math.max(0, Math.min(1439, Math.round(min)));
  const h = String(Math.floor(t / 60)).padStart(2,'0');
  const m = String(t % 60).padStart(2,'0');
  return `${h}:${m}`;
};
const median = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
};

/* ---------- 1) 과거에서 수면 추론 ---------- */
export async function inferSleepFromHistory(uid, { lookback = 30 } = {}) {
  const colRef = collection(db, 'users', uid, 'dailySchedules');
  const snap = await getDocs(colRef);

  // YYYY-MM-DD 문서ID 기준 최신 우선
  const docs = snap.docs
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.id))
    .sort((a,b) => b.id.localeCompare(a.id))
    .slice(0, lookback);

  const bed = [];
  const wake = [];
  for (const d of docs) {
    const data = d.data() || {};
    const tasks = data.generatedTasks || [];
    const sleep = tasks.find(t => (t.task === '수면') || (t.type === 'sleep'));
    if (sleep?.start && sleep?.end) {
      const b = toMin(sleep.start);
      const w = toMin(sleep.end);
      // 간단 필터: 수면 4h~12h 사이만 채택
      const dur = (w - b + 1440) % 1440;
      if (dur >= 240 && dur <= 720) {
        bed.push(b);
        wake.push(w);
      }
    }
  }
  const mb = median(bed);
  const mw = median(wake);
  if (mb == null || mw == null) return null;
  return { bedTime: toHHMM(mb), wakeUp: toHHMM(mw) };
}

/* ---------- 2) 휴일 prefs 저장/로드 ---------- */
export async function loadHolidayPrefs(uid) {
  const ref = doc(db, 'users', uid, 'prefs', 'holiday');
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : {};
}
export async function saveHolidayPrefs(uid, partial) {
  const ref = doc(db, 'users', uid, 'prefs', 'holiday');
  await setDoc(ref, { ...partial, updatedAt: new Date().toISOString() }, { merge: true });
}

/* ---------- 3) 휴일 메모 저장/최근 메모 로드 ---------- */
export async function saveHolidayMemo(uid, dateKey, memo, extras = {}) {
  const ref = doc(db, 'users', uid, 'holidayMemos', dateKey);
  await setDoc(ref, {
    memo: String(memo || ''),
    createdAt: new Date().toISOString(),
    ...extras
  }, { merge: true });

  // 빠른 프리필을 위해 prefs에도 lastMemo 저장
  await saveHolidayPrefs(uid, { lastMemo: String(memo || ''), lastMemoDate: dateKey });
}

export async function loadLastHolidayMemo(uid) {
  // prefs 우선
  const prefs = await loadHolidayPrefs(uid);
  if (prefs?.lastMemo) return prefs.lastMemo;

  // 혹시 prefs 없으면 holidayMemos에서 최신 1개 탐색
  const colRef = collection(db, 'users', uid, 'holidayMemos');
  const snap = await getDocs(colRef);
  const docs = snap.docs
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.id))
    .sort((a,b) => b.id.localeCompare(a.id));
  if (!docs.length) return '';
  return docs[0].data()?.memo || '';
}

/* ---------- 4) 위치(geolocation) ---------- */
export function getCurrentPosition(opts = { enableHighAccuracy: false, timeout: 10000 }) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      }),
      () => resolve(null),
      opts
    );
  });
}
