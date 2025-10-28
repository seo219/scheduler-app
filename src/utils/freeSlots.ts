import dayjs from "dayjs";

export type TimeRange = { start: string; end: string };

export type BusyEvent = TimeRange & {
  /** 화면 1번에서 넘어오는 블록: 수면/식사/고정 등 */
  title: string;
  type: "sleep" | "meal" | "fixed" | "travel";
  color?: string;
};

/**
 * 하루 중 바쁜 블록(busy) 사이의 빈 시간대(free slots)를 계산합니다.
 * @param dateISO 대상 날짜(예: "2025-10-29T00:00:00+09:00")
 * @param busy    바쁜 블록 배열 (start/end는 ISO 문자열)
 * @param dayStartHour 하루 시작 시각(기본 5시), dayEndHour 하루 종료 시각(기본 23시)
 */
export function computeFreeSlots(
  dateISO: string,
  busy: BusyEvent[],
  opts: { dayStartHour?: number; dayEndHour?: number } = {}
): TimeRange[] {
  const { dayStartHour = 5, dayEndHour = 23 } = opts;

  const dayStart = dayjs(dateISO).startOf("day").add(dayStartHour, "hour");
  const dayEnd = dayjs(dateISO).startOf("day").add(dayEndHour, "hour");

  // 유효 블록만 정렬
  const blocks = [...busy]
    .filter(b => dayjs(b.end).isAfter(dayjs(b.start)))
    .sort((a, b) => dayjs(a.start).valueOf() - dayjs(b.start).valueOf())
    // 하루 범위를 벗어나는 경우 컷(클램프)
    .map(b => {
      const s = dayjs(b.start).isBefore(dayStart) ? dayStart : dayjs(b.start);
      const e = dayjs(b.end).isAfter(dayEnd) ? dayEnd : dayjs(b.end);
      return { s, e };
    })
    .filter(b => b.e.isAfter(b.s));

  const free: TimeRange[] = [];
  let cursor = dayStart;

  for (const b of blocks) {
    if (b.s.isAfter(cursor)) {
      free.push({ start: cursor.toISOString(), end: b.s.toISOString() });
    }
    if (b.e.isAfter(cursor)) cursor = b.e;
  }
  if (cursor.isBefore(dayEnd)) {
    free.push({ start: cursor.toISOString(), end: dayEnd.toISOString() });
  }
  return free;
}
