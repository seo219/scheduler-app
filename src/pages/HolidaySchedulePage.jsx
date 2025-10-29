// src/pages/HolidaySchedulePage.jsx
import React, { useEffect, useState, useRef } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import dayjs from "dayjs";
import "./HolidaySchedulePage.css";

import { app as firebaseApp, auth, db } from "../firebaseConfig";
import { doc, setDoc } from "firebase/firestore";
import { createHolidaySchedule } from "../api/holidayPlan";

import {
  inferSleepFromHistory,
  loadHolidayPrefs, saveHolidayPrefs,
  loadLastHolidayMemo, saveHolidayMemo,
  getCurrentPosition,
} from "../services/holidayService";
import { fetchWeatherSummary, reverseGeocode } from "../api/weatherService";
import { TYPE_COLORS } from "../constants/typeColors";

// 기본 색(저장 시 color가 없을 때 보정)
const TYPE_DEFAULT_COLORS = {
  sleep: "#E3D1FF",
  meal: "#F5F5F5",
  fixed: "#E0E0E0",
  travel: "#F0F0F0",
  holiday: "#FFFFFF",
};


export default function HolidaySchedulePage() {
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  // path params: /holiday/schedule/:date | :dateKey | :day | :id
  const pathDate = params.date || params.dateKey || params.day || params.id;
  // query string fallback: ?date=YYYY-MM-DD
  const queryDate = new URLSearchParams(location.search).get("date");
  const dateKey = pathDate || queryDate || "";

  const { state, search } = useLocation();
  const inboundBusyRef = useRef([]);

  const [memo, setMemo] = useState("");
  const [sleepTime, setSleepTime] = useState({ bedTime: "", wakeUp: "" });
  const [pos, setPos] = useState(null);
  const [place, setPlace] = useState("");
  const [weather, setWeather] = useState(null);

  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [tasksForSave, setTasksForSave] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);

  /* ----------------------------------------------------
   * busyBlocks 수신(state → sessionStorage) + 수면표시 갱신
   * -------------------------------------------------- */
  useEffect(() => {
    let blocks = [];

    // 1) /holiday/schedule/:date 로 올 때 state로 받은 busyBlocks
    const fromState = state?.busyBlocks;
    if (Array.isArray(fromState) && fromState.length) {
      blocks = fromState;
    } else {
      // 2) 새로고침 대비 sessionStorage 백업값
      const dk = new URLSearchParams(search).get("date") || dayjs().format("YYYY-MM-DD");
      const raw = sessionStorage.getItem(`busy:${dk}`);
      if (raw) {
        try { blocks = JSON.parse(raw) || []; } catch { blocks = []; }
      }
    }

    inboundBusyRef.current = blocks;

    // 표시용 수면시간은 busyBlocks의 sleep 블록을 우선
    const sb = blocks.find(b => b.type === "sleep");
    if (sb && sb.start && sb.end) {
      let bed = dayjs(sb.start);
      let wake = dayjs(sb.end);
      if (!wake.isAfter(bed)) wake = wake.add(1, "day"); // 자정 넘김 보정
      setSleepTime({ bedTime: bed.format("HH:mm"), wakeUp: wake.format("HH:mm") });
    }
  }, [state, search]);

  /* ----------------------------------------------------
   * 사용자 기본값/위치/날씨
   * -------------------------------------------------- */
  useEffect(() => {
    (async () => {
      const user = auth.currentUser;
      if (!user) return;

      const guardKey = `holiday:init:${dateKey || "default"}:${user.uid}`;
      if (!window.__HOLIDAY_INIT_GUARDS) window.__HOLIDAY_INIT_GUARDS = new Set();
      if (window.__HOLIDAY_INIT_GUARDS.has(guardKey)) return;
      window.__HOLIDAY_INIT_GUARDS.add(guardKey);

      // 메모 프리필
      const lastMemo = await loadLastHolidayMemo(user.uid);
      setMemo(lastMemo || "");

      // 수면 기본(없으면 유추)
      let prefs = await loadHolidayPrefs(user.uid);
      let st = prefs?.sleepTime;
      if (!st?.bedTime || !st?.wakeUp) {
        st = await inferSleepFromHistory(user.uid, { lookback: 30 }) ||
          { bedTime: "23:30", wakeUp: "08:30" };
        await saveHolidayPrefs(user.uid, { sleepTime: st });
      }
      // busyBlocks 에서 수면을 못받았다면만 기본값 적용
      setSleepTime(prev => (prev.bedTime || prev.wakeUp) ? prev : st);

      // 위치/날씨
      const p = await getCurrentPosition();
      setPos(p);
      if (p?.lat != null && p?.lon != null) {
        const geo = await reverseGeocode({ lat: p.lat, lon: p.lon });
        setPlace(geo?.place || "");
        const w = await fetchWeatherSummary({ lat: p.lat, lon: p.lon });
        setWeather(w);
      }
    })();
  }, [dateKey]);

  /* ----------------------------------------------------
   * 헬퍼
   * -------------------------------------------------- */
  // HH:mm -> ISO (같은 날짜 기준)
  const hhmmToISO = (dateISO, hhmm) => {
    if (!hhmm || String(hhmm).includes("T")) return hhmm;
    const [h, m] = String(hhmm).split(":").map(Number);
    return dayjs(dateISO).startOf("day").add(h, "hour").add(m, "minute").toISOString();
  };

  // 블록이 자정을 넘기면 end 를 다음날로 보정
  const fixSpan = (b) => {
    let s = dayjs(b.start);
    let e = dayjs(b.end);
    if (!e.isAfter(s)) e = e.add(1, "day");
    return { ...b, start: s.toISOString(), end: e.toISOString() };
  };

  // [start,end] 경계 밖을 잘라서(clip) 반환
  const clipToWindow = (blocks, startISO, endISO) => {
    const W = dayjs(startISO);
    const B = dayjs(endISO);
    return (blocks || [])
      .map((b) => {
        let s = dayjs(b.start);
        let e = dayjs(b.end);
        if (!e.isAfter(s)) e = s.add(1, "minute");
        if (s.isBefore(W)) s = W;
        if (e.isAfter(B)) e = B;
        if (!e.isAfter(s)) return null;
        return { ...b, start: s.toISOString(), end: e.toISOString() };
      })
      .filter(Boolean)
      .sort((a, b) => dayjs(a.start).valueOf() - dayjs(b.start).valueOf());
  };

  const buildPreview = (tasks = []) => {
    const rows = (tasks || []).map((t, i) => ({
      i,
      time: `${t.start} ~ ${t.end}`,
      type: t.type || "holiday",
      name: t.task || t.activity || (t.type === "meal" ? "식사" : "활동"),
    }));
    setPreviewRows(rows);
  };

  /* ----------------------------------------------------
   * 생성
   * -------------------------------------------------- */
  const handleGenerate = async () => {
    const user = auth.currentUser;
    if (!user) return alert("로그인이 필요합니다.");

    // 기준 날짜
    const dk = new URLSearchParams(search).get("date") || dayjs().format("YYYY-MM-DD");
    const dateISO = dayjs(dk).startOf("day").toISOString();

    // 경계(기상~취침) ISO 계산
    const wakeISO0 = hhmmToISO(dateISO, sleepTime?.wakeUp || "08:30");
    let bedISO0 = hhmmToISO(dateISO, sleepTime?.bedTime || "23:30");
    if (dayjs(bedISO0).valueOf() <= dayjs(wakeISO0).valueOf()) {
      bedISO0 = dayjs(bedISO0).add(1, "day").toISOString(); // 자정 넘김 보정
    }

    // busyBlocks 준비 (없으면 수면만)
    let busyBlocks =
      Array.isArray(inboundBusyRef.current) && inboundBusyRef.current.length
        ? inboundBusyRef.current
        : [{
          title: "수면",
          type: "sleep",
          start: bedISO0,   // 취침
          end: wakeISO0,  // 기상
        }];

    busyBlocks = busyBlocks.map(fixSpan);
    const busyInWindow = clipToWindow(busyBlocks, wakeISO0, bedISO0);

    setLoading(true);
    setNotice("");
    try {
      const planRaw = await createHolidaySchedule({
        app: firebaseApp,
        dateISO,
        location: { city: place || "", lat: pos?.lat, lon: pos?.lon },
        weather: {
          summary: weather?.summaryShort || "정보 없음",
          tempC: weather?.tempC ?? undefined,
          precipitation: weather?.precip ?? "unknown",
          isOutdoorFriendly: !/비|눈|폭우|폭설/.test(weather?.summaryShort || ""),
        },
        prefs: (memo || "").trim(),
        busyBlocks: busyInWindow,
        options: {
          dayWindow: { start: wakeISO0, end: bedISO0 }, // ✅ 하루 경계 강제
          endPaddingMinutes: 10,
          minSlotMinutes: 30,
          minActivityMinutes: 30,
          defaultTravelMinutes: 10,
        },
      });

      // 서버가 경계를 벗어나도 한 번 더 자르기
      const plan = clipToWindow(planRaw || [], wakeISO0, bedISO0);

      // busyBlocks(사용자 고정)과 동일 시간 구간만 fixed로 인정
      const toKey = (s, e) => `${dayjs(s).toISOString()}__${dayjs(e).toISOString()}`;
      const BUSY_KEYS = new Set((busyInWindow || []).map(b => toKey(b.start, b.end)));

      const tasks = (plan || []).map((b) => {
        const key = toKey(b.start, b.end);
        const isBusyMatch = BUSY_KEYS.has(key);

        const rawType = String(b.type || "").toLowerCase();
        const finalType = isBusyMatch
          ? "fixed"
          : (rawType === "meal" || rawType === "sleep") ? rawType : "holiday";

        const base = {
          task: b.title,
          type: finalType,
          start: dayjs(b.start).format("HH:mm"),
          end: dayjs(b.end).format("HH:mm"),
          origin: isBusyMatch ? (b.origin || "user-fixed") : "ai-holiday",
        };

        // color가 있을 때만 필드 추가 (undefined 방지)
        if (isBusyMatch && b.color != null) base.color = b.color;
        return base;
      });




      // 수면 블록이 없으면 하나 추가(기존 일정은 그대로 유지)
      const hasSleep = tasks.some(t => t.type === 'sleep' || t.task === '수면');
      if (!hasSleep) {
        // HH:mm 보정 헬퍼 (ISO가 들어와도 HH:mm으로 맞춤)
        const toHHMM = v =>
          String(v || '').includes('T') ? dayjs(v).format('HH:mm') : String(v || '00:00');

        const bed = toHHMM(sleepTime?.bedTime || '23:30'); // 저장 포맷: start=취침
        const wake = toHHMM(sleepTime?.wakeUp || '08:30'); //              end=기상

        tasks.push({
          task: '수면',
          type: 'sleep',
          start: bed,
          end: wake,
          color: (typeof TYPE_DEFAULT_COLORS !== 'undefined'
            ? TYPE_DEFAULT_COLORS.sleep
            : '#E3D1FF'),
          origin: 'ai-holiday',
        });
      }


      setTasksForSave(tasks);
      buildPreview(tasks);
      setNotice("✅ 빈 시간을 AI로 채웠습니다.");
    } catch (e) {
      console.error(e);
      setNotice("⚠️ 생성 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  /* ----------------------------------------------------
   * 저장
   * -------------------------------------------------- */
  const handleSave = async () => {
    const user = auth.currentUser;
    if (!user) return alert("로그인이 필요합니다.");
    if (!dateKey) {
      alert("날짜가 없습니다. /holiday/schedule/:date 또는 ?date=YYYY-MM-DD 형태로 접근해 주세요.");
      return;
    }
    if (!tasksForSave?.length) return alert("생성된 일정이 없습니다.");

    const dayRef = doc(db, "users", user.uid, "dailySchedules", dateKey);
    // undefined를 가진 키는 제거
    const stripUndefined = (obj) =>
      Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

    const cleanedTasks = (tasksForSave || []).map(stripUndefined);

    await setDoc(dayRef, {
      generatedTasks: cleanedTasks,   // ← 여기만 cleanedTasks로 바꿈
      isHoliday: true,
      dayType: "holiday",
      source: "ai-holiday",
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    await saveHolidayMemo(user.uid, dateKey, memo || "", {
      weatherSummary: weather?.summaryShort || null,
      position: pos ? { lat: pos.lat, lon: pos.lon } : null,
    });

    alert("휴일 일정 및 메모를 저장했습니다.");
    navigate(`/calendar?date=${dateKey}`);
  };

  /* ----------------------------------------------------
   * 렌더
   * -------------------------------------------------- */
  return (
    <div className="holiday-schedule-page container">
      <h2>{dateKey || "미지정"} 취미 일정 추천 <span style={{ opacity: .6, fontSize: 14 }}></span></h2>

      {notice && (
        <div className="box" style={{ background: "#fff8e1", borderColor: "#f59e0b" }}>
          {notice}
        </div>
      )}

      <div className="box">
        <h4>수면</h4>
        <p>
          기상 <b>{sleepTime.wakeUp || "--:--"}</b> ~ 취침 <b>{sleepTime.bedTime || "--:--"}</b>
        </p>
      </div>

      <div className="box">
        <h4>현재 위치/날씨</h4>
        <p>
          {place
            ? `지역: ${place}`
            : (pos ? `좌표 (${pos.lat?.toFixed?.(3)}, ${pos.lon?.toFixed?.(3)})` : "위치 정보 없음")}
          {" · "}
          {weather?.summaryShort ? `날씨: ${weather.summaryShort}` : "날씨 정보 없음"}
        </p>
      </div>

      <div className="box">
        <h4>선호하는 활동을 적어주세요.</h4>
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="원하는 분위기/제약/취향 등을 적어주세요"
          rows={4}
          style={{ width: "100%", resize: "vertical" }}
        />
      </div>

      <div className="btns">
        <button onClick={handleGenerate} className="control-btn" disabled={loading}>
          {loading ? "생성 중…" : "취미 일정 생성"}
        </button>
        <button onClick={handleSave} className="control-btn" disabled={!tasksForSave.length}>
          일정으로 저장
        </button>
        <button onClick={() => navigate(-1)} className="control-btn">취소</button>
      </div>

      {previewRows.length > 0 && (
        <div className="box">
          <h4>추천 미리보기</h4>
          <div className="table like">
            <table>
              <thead>
                <tr><th>시간</th><th>유형</th><th>활동</th></tr>
              </thead>
              <tbody>
                {previewRows.map((r) => (
                  <tr key={r.i}>
                    <td>{r.time}</td>
                    <td>
                      <span
                        style={{
                          display: "inline-block",
                          background: TYPE_COLORS[r.type] || "#EEE",
                          padding: "2px 8px",
                          borderRadius: 8,
                        }}
                      >
                        {r.type}
                      </span>
                    </td>
                    <td>{r.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

