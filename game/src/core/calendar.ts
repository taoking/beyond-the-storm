import { CONFIG, MIN_PER_DAY, type Season } from "./config.ts";

export interface SeasonInfo {
  season: Season;
  /** 这一季的第几天，从 0 起 */
  dayInSeason: number;
  seasonLength: number;
  /** 第几个世界年，从 0 起 */
  year: number;
  /** 这一年的第几天，从 0 起 */
  dayInYear: number;
}

/** day 是到站以来第几天，从 0 起 */
export function seasonOf(day: number): SeasonInfo {
  const { seasons, yearDays } = CONFIG.calendar;
  const dayInYear = ((day % yearDays) + yearDays) % yearDays;
  let d = dayInYear;
  for (const [season, n] of seasons) {
    if (d < n) return { season, dayInSeason: d, seasonLength: n, year: Math.floor(day / yearDays), dayInYear };
    d -= n;
  }
  throw new Error("unreachable");
}

/** 到入冬还有几天（冬天里返回 0） */
export function daysUntilWinter(day: number): number {
  const info = seasonOf(day);
  return info.season === "winter" ? 0 : CONFIG.calendar.yearDays - info.dayInYear;
}

export const SEASON_NAME: Record<Season, string> = { winter: "冬", spring: "春", summer: "夏", autumn: "秋" };

export type DayPart = "dawn" | "morning" | "noon" | "afternoon" | "dusk" | "evening" | "night";
export const DAY_PART_NAME: Record<DayPart, string> = {
  dawn: "清晨",
  morning: "上午",
  noon: "午间",
  afternoon: "下午",
  dusk: "傍晚",
  evening: "晚上",
  night: "夜",
};

/** minuteOfDay 取 0..1439 */
export function dayPartOf(minuteOfDay: number): DayPart {
  const h = minuteOfDay / 60;
  if (h < 6) return "night";
  if (h < 8) return "dawn";
  if (h < 12) return "morning";
  if (h < 14) return "noon";
  if (h < 18) return "afternoon";
  if (h < 20) return "dusk";
  if (h < 22) return "evening";
  return "night";
}

export function clockText(minuteOfDay: number): string {
  const m = ((Math.floor(minuteOfDay) % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
