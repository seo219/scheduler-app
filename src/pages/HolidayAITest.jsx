// src/pages/HolidayAITest.jsx
import React, { useEffect, useState } from "react";
import dayjs from "dayjs";
import { getAuth, signInAnonymously } from "firebase/auth";

// 상대 경로(추천). 만약 @ alias를 쓰면 "../api/holidayPlan" → "@/api/holidayPlan" 로 바꿔도 됩니다.
import { createHolidaySchedule } from "../api/holidayPlan";
import { app as firebaseApp } from "../firebaseConfig";

// ───────────────────────── 도우미들 ─────────────────────────
function toISO(dateISO, hhmm) {
  // "HH:mm" → 같은 날짜의 ISO 문자열. 이미 ISO면 그대로 반환
  if (!hhmm || hhmm.includes("T")) return hhmm;
  const [h, m] = hhmm.split(":").map(Number);
  return dayjs(dateISO).startOf("day").add(h, "hour").add(m, "minute").toISOString();
}

// ①번 화면 값(수면/식사/고정) → BusyEvent[] 형태로 변환
function buildBusyBlocks(dateISO, form) {
  const out = [];

  // 수면
  out.push({
    title: "수면",
    type: "sleep",
    start: toISO(dateISO, form.sleep), // 예: "02:00"
    end: toISO(dateISO, form.wake),    // 예: "10:00"
  });

  // 식사
  for (const m of form.meals || []) {
    out.push({
      title: m.title || "식사",
      type: "meal",
      start: toISO(dateISO, m.start),
      end: toISO(dateISO, m.end),
    });
  }

  // 고정 일정
  for (const p of form.plans || []) {
    out.push({
      title: p.title || "일정",
      type: "fixed",
      start: toISO(dateISO, p.start),
      end: toISO(dateISO, p.end),
    });
  }

  return out;
}

function clock(s) {
  return new Date(s).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ───────────────────────── 페이지 컴포넌트 ─────────────────────────
export default function HolidayAITest() {
  const [preview, setPreview] = useState([]);
  const [loading, setLoading] = useState(false);

  // 오늘 날짜 기준 테스트
  const dateISO = dayjs().startOf("day").toISOString();

  // Callable은 인증 필요 → 익명 로그인
  useEffect(() => {
    const auth = getAuth(firebaseApp);
    if (!auth.currentUser) {
      signInAnonymously(auth).catch((e) => {
        console.error("익명 로그인 실패:", e);
        alert("로그인 실패(콘솔 확인)");
      });
    }
  }, []);

  async function onGenerate() {
    setLoading(true);
    try {
      // 테스트용 샘플 입력 (1번 화면 값이 아직 안 연결됐다고 가정)
      const form = {
        wake: "10:00",
        sleep: "02:00",
        meals: [
          { title: "점심", start: "11:00", end: "12:00" },
          { title: "저녁", start: "19:30", end: "20:00" },
        ],
        plans: [
          { title: "씻기", start: "10:00", end: "10:30" },
          { title: "학교", start: "13:00", end: "17:00" },
        ],
      };

      const busyBlocks = buildBusyBlocks(dateISO, form);

      // 서버(Cloud Functions) 호출 → 활동 아이디어 수신 → 빈 시간 채우기
      const merged = await createHolidaySchedule({
        app: firebaseApp,
        dateISO,
        location: { city: "부산광역시", lat: 35.1796, lon: 129.0756 },
        weather: {
          summary: "맑음",
          tempC: 13,
          precipitation: "none",
          isOutdoorFriendly: true,
        },
        prefs: "해변 산책, 카페, 전시 선호",
        busyBlocks,
      });

      setPreview(merged);
    } catch (e) {
      console.error(e);
      alert("휴일 일정 생성 실패(콘솔 확인)");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 760, margin: "40px auto", fontFamily: "system-ui, sans-serif" }}>
      <h2 style={{ marginBottom: 12 }}>휴일 일정 생성 (테스트)</h2>

      <button
        onClick={onGenerate}
        disabled={loading}
        style={{
          padding: "10px 16px",
          borderRadius: 8,
          border: "1px solid #ddd",
          cursor: loading ? "default" : "pointer",
        }}
      >
        {loading ? "생성 중..." : "휴일 일정 생성"}
      </button>

      <ul style={{ marginTop: 24, listStyle: "none", padding: 0 }}>
        {preview.map((b, i) => (
          <li
            key={i}
            style={{
              padding: "10px 12px",
              border: "1px solid #eee",
              borderRadius: 8,
              marginBottom: 10,
            }}
          >
            <div style={{ fontWeight: 600 }}>
              {b.title} <span style={{ color: "#888", fontWeight: 400 }}>({b.type})</span>
            </div>
            <div style={{ color: "#555", marginTop: 4 }}>
              {clock(b.start)} ~ {clock(b.end)}
            </div>
          </li>
        ))}
        {preview.length === 0 && (
          <li style={{ color: "#777", marginTop: 16 }}>아직 생성된 일정이 없습니다.</li>
        )}
      </ul>
    </div>
  );
}
