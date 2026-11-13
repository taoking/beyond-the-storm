// 天气生成：02 第 3.5、4 节。一天一档，头一天定好；硬边界写在抽取里。
import { CONFIG, type Season, type WeatherTier, type YearKind } from "./config.ts";
import { seasonOf } from "./calendar.ts";
import { next, pickWeighted, type Rng } from "./rng.ts";

export interface SkyState {
  blizzardRun: number;
  badRun: number;
  recover: number;
}

export function makeSky(): SkyState {
  return { blizzardRun: 0, badRun: 0, recover: 0 };
}

export function pickYearKind(rng: Rng): YearKind {
  return pickWeighted(rng, CONFIG.weather.yearKinds);
}

/** 这一天用哪一季的天气表：春迟年开春头几天、霜早年秋末几天用冬天的 */
export function weatherSeason(day: number, kind: YearKind): Season {
  const info = seasonOf(day);
  const p = CONFIG.weather.yearKindParams[kind];
  if (info.season === "spring" && info.dayInSeason < p.lateSpring) return "winter";
  if (info.season === "autumn" && info.dayInSeason >= info.seasonLength - p.earlyFrost) return "winter";
  return info.season;
}

/** 抽一天的天气档，并更新连续坏天气的计数 */
export function drawWeather(sky: SkyState, rng: Rng, day: number, kind: YearKind): WeatherTier {
  const w = CONFIG.weather;
  const table = w.table[weatherSeason(day, kind)];
  const bad = w.yearKindParams[kind].bad;
  const p = { A: 0, B: 0, C: table.C * bad, D: table.D * bad };
  const rest = 1 - p.C - p.D;
  const fair = table.A + table.B;
  p.A = (rest * table.A) / fair;
  p.B = (rest * table.B) / fair;
  if (sky.recover > 0 || sky.badRun >= w.maxBadRun) p.C = p.D = 0;
  if (sky.blizzardRun >= w.maxBlizzardRun) p.D = 0;
  const total = p.A + p.B + p.C + p.D;
  let r = next(rng) * total;
  let tier: WeatherTier = "A";
  for (const k of ["A", "B", "C", "D"] as const) {
    r -= p[k];
    if (r < 0) {
      tier = k;
      break;
    }
  }
  if (tier === "C" || tier === "D") {
    sky.badRun += 1;
    sky.blizzardRun = tier === "D" ? sky.blizzardRun + 1 : 0;
  } else {
    if (sky.badRun >= 2) sky.recover = w.recoverDays;
    sky.badRun = 0;
    sky.blizzardRun = 0;
    if (sky.recover > 0) sky.recover -= 1;
  }
  return tier;
}

/** 03 第 10.1 节：每一档在各季常见的样子。只影响画面和手记的用词，不改这一天的档。 */
const LOOKS: Record<Season, Record<WeatherTier, [string, number][]>> = {
  winter: { A: [["晴", 1], ["多云", 1]], B: [["小雪", 1]], C: [["大雪", 1]], D: [["暴风雪", 1]] },
  spring: {
    A: [["晴", 1], ["多云", 1]],
    B: [["小雪", 1], ["冷雨", 1], ["雾", 1]],
    C: [["大雪", 1], ["冻雨", 1]],
    D: [["暴风雪", 1]],
  },
  summer: {
    A: [["晴", 1], ["多云", 1]],
    B: [["冷雨", 2], ["小雪", 1]],
    C: [["雷雨", 1], ["冻雨", 1]],
    D: [["暴风雪", 1]],
  },
  autumn: {
    A: [["晴", 1], ["多云", 1]],
    B: [["小雪", 1], ["冷雨", 1], ["雾", 1]],
    C: [["大雪", 1], ["冻雨", 1]],
    D: [["暴风雪", 1]],
  },
};

export function pickLook(rng: Rng, season: Season, tier: WeatherTier): string {
  return pickWeighted(rng, LOOKS[season][tier]);
}

export const TIER_NAME: Record<WeatherTier, string> = { A: "好天", B: "一般", C: "出不了院子", D: "暴风雪" };
