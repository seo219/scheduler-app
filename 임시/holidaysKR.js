// src/utils/holidaysKR.js
import Holidays from 'date-holidays';

/**
 * 해당 연도의 한국 공휴일을 Map(YYYY-MM-DD -> { name, type })으로 반환
 * - 대체공휴일/임시공휴일 포함 (라이브러리 데이터에 따라 자동 반영)
 */
export function getKoreanHolidaysForYear(year = new Date().getFullYear()) {
  const hd = new Holidays('KR'); // South Korea
  const list = hd.getHolidays(year);

  const map = new Map();
  for (const h of list) {
    // h.date: ISO string "YYYY-MM-DDT00:00:00.000Z" 형태일 수 있음 → 현지 날짜 문자열로 변환
    const d = new Date(h.date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${day}`;

    // 이름 정리 (localName 우선, 없으면 name)
    const name = h.localName || h.name || '공휴일';
    map.set(key, { name, type: h.type }); // type: public/observance 등
  }
  return map;
}
