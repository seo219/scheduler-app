// src/api/weatherService.js

// ──────────────────────────────────────────────────────────────
// 날씨 코드 → 한글 설명
// ──────────────────────────────────────────────────────────────
export const WEATHER_CODE_KO = {
  0: '맑음',
  1: '대체로 맑음',
  2: '부분적 흐림',
  3: '흐림',
  45: '안개',
  48: '착빙 안개',
  51: '이슬비 약함',
  53: '이슬비',
  55: '이슬비 강함',
  56: '얼음 이슬비 약함',
  57: '얼음 이슬비 강함',
  61: '비 약함',
  63: '비',
  65: '비 강함',
  66: '얼음 비 약함',
  67: '얼음 비 강함',
  71: '눈 약함',
  73: '눈',
  75: '눈 강함',
  77: '싸락눈',
  80: '소나기 약함',
  81: '소나기',
  82: '소나기 강함',
  85: '소나기 눈 약함',
  86: '소나기 눈 강함',
  95: '뇌우',
  96: '뇌우(우박)',
  99: '강한 뇌우(우박)',
};

const num = (v) => (v === 0 || (typeof v === 'number' && isFinite(v)) ? v : null);

// ──────────────────────────────────────────────────────────────
// 좌표 → 지역명 (Reverse Geocoding)
// 1차: Open-Meteo (CORS 차단 시 실패 가능)
// 2차: BigDataCloud (무료·키X·CORS OK)
// 둘 다 실패하면 null 반환 (UI는 좌표만 노출)
// ──────────────────────────────────────────────────────────────
// 좌표 → 지역명 (CORS 안전, 중복 제거)
export async function reverseGeocode({ lat, lon, language = 'ko' }) {
  if (lat == null || lon == null) return null;

  // 표기 중복 제거 (공백 무시, 소문자 비교)
  const dedupeJoin = (...xs) => {
    const out = [];
    const seen = new Set();
    for (const x of xs) {
      const s = (x || '').trim();
      if (!s) continue;
      const k = s.replace(/\s+/g, '').toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(s); }
    }
    return out.join(' ');
  };

  // 1) BigDataCloud (무료/키X/CORS OK) — 우선 사용
  try {
    const u = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
    u.searchParams.set('latitude', String(lat));
    u.searchParams.set('longitude', String(lon));
    u.searchParams.set('localityLanguage', language);
    const res = await fetch(u.toString());
    if (res.ok) {
      const p = await res.json();
      const primary = p.city || p.locality || p.localityInfo?.administrative?.[0]?.name;
      const secondary = p.principalSubdivision || p.countryName;
      const place = dedupeJoin(primary, secondary);
      if (place) return { place, raw: p };
    }
  } catch { /* 무시하고 폴백 진행 */ }

  // 2) Open-Meteo — 폴백(성공 시만 사용; CORS 차단될 수 있음)
  try {
    const u = new URL('https://geocoding-api.open-meteo.com/v1/reverse');
    u.searchParams.set('latitude', String(lat));
    u.searchParams.set('longitude', String(lon));
    u.searchParams.set('language', language);
    u.searchParams.set('count', '1');
    const res = await fetch(u.toString());
    if (res.ok) {
      const data = await res.json();
      const p = data?.results?.[0];
      if (p) {
        const place = dedupeJoin(
          p.city || p.name,
          p.district || p.admin3,
          p.admin2,
          p.admin1
        );
        if (place) return { place, raw: p };
      }
    }
  } catch { /* 최종 실패 */ }

  return null;
}


// ──────────────────────────────────────────────────────────────
/** 현재 날씨 요약
 *  - 성공 예: "맑음 24°"
 *  - 현재 기온이 없으면: "맑음 12°~20°"
 *  - 반환: { tmin, tmax, code, temp, condition, summaryShort, raw }
 */
// ──────────────────────────────────────────────────────────────
export async function fetchWeatherSummary({ lat, lon, tz = 'Asia/Seoul' }) {
  if (lat == null || lon == null) return null;

  const u = new URL('https://api.open-meteo.com/v1/forecast');
  u.searchParams.set('latitude', String(lat));
  u.searchParams.set('longitude', String(lon));
  u.searchParams.set('timezone', tz || 'auto');
  u.searchParams.set('forecast_days', '1');
  u.searchParams.set('current_weather', 'true');
  u.searchParams.set(
    'daily',
    'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode'
  );

  const res = await fetch(u.toString(), { mode: 'cors' });
  if (!res.ok) return null;

  const data = await res.json();

  const tmin = num(data?.daily?.temperature_2m_min?.[0]);
  const tmax = num(data?.daily?.temperature_2m_max?.[0]);
  const code = num(
    data?.current_weather?.weathercode ?? data?.daily?.weathercode?.[0]
  );
  const tempNow = num(data?.current_weather?.temperature);
  const condition = WEATHER_CODE_KO[code] || null;

  let summaryShort = null;
  if (tempNow != null) {
    summaryShort = [condition, `${Math.round(tempNow)}°`]
      .filter(Boolean)
      .join(' ');
  } else if (tmin != null && tmax != null) {
    summaryShort = [condition, `${Math.round(tmin)}°~${Math.round(tmax)}°`]
      .filter(Boolean)
      .join(' ');
  }

  return {
    tmin,
    tmax,
    code,
    temp: tempNow ?? null,
    condition,
    summaryShort,
    raw: data,
  };
}
