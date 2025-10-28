import dayjs from "dayjs";
import type { TimeRange } from "./freeSlots";

export type ActivityIdea = {
  title: string;
  category: string;
  indoorOutdoor: "indoor" | "outdoor" | "either";
  durationMin: number;
  prepMin?: number;
  placeQuery?: string;
  notes?: string;
};

export type BusyEvent = {
  title: string;
  type: "sleep" | "meal" | "fixed" | "travel";
  start: string;
  end: string;
  color?: string;
  place?: { name?: string; lat?: number; lon?: number };
};

/** 1차 버전: 위치 정보가 없으면 보수적으로 20분 이동으로 가정 */
function estimateTravelMin(_prev?: BusyEvent, _nextIdea?: ActivityIdea): number {
  return 20;
}

/**
 * freeSlots에 활동 아이디어를 채워 넣습니다.
 * 필요 시 "이동" 블록을 자동 삽입하고, 각 활동 뒤에 작은 버퍼를 둡니다.
 */
export function packActivitiesIntoSlots(
  freeSlots: TimeRange[],
  ideas: ActivityIdea[],
  opts: { bufferMin?: number } = {}
): BusyEvent[] {
  const { bufferMin = 10 } = opts;
  const scheduled: BusyEvent[] = [];

  let ideaIdx = 0;
  for (const slot of freeSlots) {
    let cursor = dayjs(slot.start);
    const slotEnd = dayjs(slot.end);

    while (ideaIdx < ideas.length) {
      const idea = ideas[ideaIdx];

      const travel = estimateTravelMin(scheduled[scheduled.length - 1], idea);
      const prep = idea.prepMin ?? 0;
      const totalNeed = travel + prep + idea.durationMin + bufferMin;

      if (cursor.add(totalNeed, "minute").isAfter(slotEnd)) break;

      // 이동 블록
      if (travel > 0) {
        const travelEnd = cursor.add(travel, "minute");
        scheduled.push({
          title: "이동",
          type: "travel",
          start: cursor.toISOString(),
          end: travelEnd.toISOString(),
        });
        cursor = travelEnd;
      }

      // 활동 블록
      const actStart = cursor;
      const actEnd = cursor.add(idea.durationMin, "minute");
      scheduled.push({
        title: idea.title,
        type: "fixed",
        start: actStart.toISOString(),
        end: actEnd.toISOString(),
        place: idea.placeQuery ? { name: idea.placeQuery } : undefined,
      });

      // 활동 후 버퍼
      cursor = actEnd.add(bufferMin, "minute");

      ideaIdx++;
      if (cursor.isAfter(slotEnd)) break;
    }
  }

  return scheduled;
}
