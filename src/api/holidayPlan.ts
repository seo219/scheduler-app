// src/api/holidayPlan.ts
import { getFunctions, httpsCallable } from "firebase/functions";
import type { FirebaseApp } from "firebase/app";
import {
  computeFreeSlots,
  type BusyEvent, // 수면/식사/고정/이동 블록 타입
} from "../utils/freeSlots";
import {
  packActivitiesIntoSlots,
  type ActivityIdea, // 서버가 돌려주는 활동 아이디어 타입
} from "../utils/packActivities";

export type CreateHolidayScheduleArgs = {
  app: FirebaseApp;
  dateISO: string; // 예: "2025-10-29T00:00:00+09:00"
  location: { city?: string; lat?: number; lon?: number } | any;
  weather:
    | { summary: string; tempC?: number; precipitation?: string; isOutdoorFriendly?: boolean }
    | any;
  prefs?: string; // 사용자가 적은 선호 텍스트
  busyBlocks: BusyEvent[]; // ①번 화면에서 넘어온 수면/식사/고정 일정
  region?: string; // 기본 "asia-northeast3"
};

/**
 * ②번 화면에서 "휴일 일정 생성" 클릭 시 호출하는 함수.
 * - 서버 Callable(generateHolidayPlan)을 호출해 활동 아이디어를 받고
 * - 빈 시간대에 (이동 포함) 자동 배치한 뒤
 * - 기존 블록과 합쳐 시간순으로 반환합니다.
 */
export async function createHolidaySchedule({
  app,
  dateISO,
  location,
  weather,
  prefs,
  busyBlocks,
  region = "asia-northeast3",
}: CreateHolidayScheduleArgs): Promise<BusyEvent[]> {
  // 1) busyBlocks 정규화(혹시 type이 임의 문자열로 올 수 있으니 안전하게 보정)
  const allow = new Set<BusyEvent["type"]>(["sleep", "meal", "fixed", "travel"]);
  const normalizedBusy: BusyEvent[] = busyBlocks.map((b) => ({
    ...b,
    type: allow.has(b.type as BusyEvent["type"]) ? (b.type as BusyEvent["type"]) : "fixed",
  }));

  // 2) 빈 시간대 계산
  const free = computeFreeSlots(dateISO, normalizedBusy);

  // 3) 서버 함수 호출 → 활동 아이디어 수신
  const fn = httpsCallable(getFunctions(app, region), "generateHolidayPlan");
  const { data } = await fn({ date: dateISO, location, weather, prefs });
  const activities: ActivityIdea[] = (data as any)?.activities ?? [];

  // 4) 아이디어를 빈 슬롯에 (이동/버퍼 포함) 배치
  const aiBlocks = packActivitiesIntoSlots(free, activities);

  // 5) 기존 + AI 블록 병합 후 시간순 정렬하여 반환
  return [...normalizedBusy, ...aiBlocks].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
  );
}
