// G2 表现层：只读真实活动、地点与独立氛围选择，映射给精灵和天气图层。
// 不改世界状态、不推进游戏、不创建事件，不解析中文叙述来判断动作。
import { DAY_PART_NAME, dayPartOf, seasonOf, SEASON_NAME } from "./calendar.ts";
import type { Season, WeatherTier } from "./config.ts";
import { PROJECTS } from "./content.ts";
import type { Game } from "./game.ts";
import type { ActivityKind, ActorState, World } from "./state.ts";
import { previewLook } from "./weather.ts";

export type PoseKey =
  | "sleep" | "sit" | "sitRead" | "sitWrite" | "sitHold"
  | "standWork" | "standLook" | "crouch" | "walk";

export type PropKey = "book" | "journal" | "cup" | "bowl" | "kettle" | "tools" | "instrument" | "pinecone" | null;
export interface PoseProjection {
  activity: ActivityKind | null;
  pose: PoseKey | null;
  prop: PropKey;
}

/** 可以当作独立绘制的姿态，不是另一个角色状态机。 */
export function actorPose(actor: ActorState): PoseProjection {
  const a = actor.activity;
  if (actor.asleep || a?.kind === "sleep") return { activity: a?.kind ?? null, pose: "sleep", prop: null };
  if (!a) return { activity: null, pose: null, prop: null };
  const kind = a.kind;
  const place = actor.place;
  const leisureId = a.data.id;
  const requestKind = a.data.kind;
  const isArmchair = place === "armchair";
  const isDesk = place === "desk";
  const isSeat = isArmchair || isDesk;

  if (kind === "wake") return { activity: kind, pose: "sit", prop: null };
  if (kind === "meal") {
    return place === "stove"
      ? { activity: kind, pose: "standWork", prop: a.data.source === "can" ? "bowl" : "tools" }
      : { activity: kind, pose: isSeat ? "sitHold" : "standWork", prop: "bowl" };
  }
  if (kind === "journal") return { activity: kind, pose: isSeat ? "sitWrite" : "standWork", prop: "journal" };
  if (kind === "observe") return { activity: kind, pose: "standLook", prop: "instrument" };
  if (kind === "project") {
    const id = a.data.id;
    const def = PROJECTS.find((p) => p.id === id);
    return def?.kind === "read"
      ? { activity: kind, pose: isSeat ? "sitRead" : "standLook", prop: "book" }
      : { activity: kind, pose: place === "cellar" ? "crouch" : "standWork", prop: "tools" };
  }
  if (kind === "leisure") {
    if (leisureId === "readIdle") return { activity: kind, pose: isSeat ? "sitRead" : "standLook", prop: "book" };
    if (leisureId === "writeNotes" || leisureId === "weatherNotes")
      return { activity: kind, pose: isSeat ? "sitWrite" : "standLook", prop: "journal" };
    if (leisureId === "tea") return { activity: kind, pose: isArmchair ? "sitHold" : "standWork", prop: "cup" };
    if (leisureId === "fireSit" || leisureId === "rest") return { activity: kind, pose: "sit", prop: null };
    if (leisureId === "tidyTools" || leisureId === "tidyShelf" || leisureId === "radio")
      return { activity: kind, pose: "standWork", prop: "tools" };
    if (leisureId === "waterPlant") return { activity: kind, pose: "standWork", prop: "cup" };
    if (leisureId === "yardStroll") return { activity: kind, pose: "walk", prop: null };
    return { activity: kind, pose: "standLook", prop: null };
  }
  if (kind === "request") {
    if (requestKind === "tea") return { activity: kind, pose: isArmchair ? "sitHold" : "standWork", prop: "cup" };
    if (requestKind === "windowSit") return { activity: kind, pose: "standLook", prop: null };
    if (requestKind === "playRecord") return { activity: kind, pose: isArmchair ? "sit" : "standWork", prop: null };
    return { activity: kind, pose: isSeat ? "sit" : "standLook", prop: null };
  }
  if (kind === "drink") return { activity: kind, pose: "standWork", prop: "cup" };
  if (kind === "boilWater") return { activity: kind, pose: "standWork", prop: "kettle" };
  if (kind === "fetchWater") return { activity: kind, pose: "walk", prop: null };
  if (kind === "cones") return { activity: kind, pose: "standWork", prop: "pinecone" };
  if (kind === "swapStyle") return { activity: kind, pose: "standWork", prop: "tools" };
  if (kind === "garden") return { activity: kind, pose: "crouch", prop: "tools" };
  if (kind === "bankFire" || kind === "tendFire" || kind === "lightFire")
    return { activity: kind, pose: "crouch", prop: "tools" };
  if (kind === "choreWood" || kind === "choreFood" || kind === "eaveWood" || kind === "eaveFood")
    return { activity: kind, pose: place === "woodpile" ? "crouch" : "standWork", prop: "tools" };
  return { activity: kind, pose: "standLook", prop: null };
}

export type VisualTime = "dawn" | "day" | "dusk" | "night";
export interface LookProjection {
  /** world 是事实，ambience 是冻结演出，missing 表示缺失选择，不偷用真实天气。 */
  source: "world" | "ambience" | "missing";
  season: Season | null;
  seasonLabel: string | null;
  weather: WeatherTier | null;
  weatherLabel: string | null;
  time: VisualTime | null;
  dayPart: string | null;
}

function visualTime(minute: number): VisualTime {
  const part = dayPartOf(minute % 1440);
  if (part === "dawn") return "dawn";
  if (part === "dusk" || part === "evening") return "dusk";
  if (part === "night") return "night";
  return "day";
}

/** 与 World.weather 独立：只投影已经保存的氛围选择，不重新抽天气。 */
export function projectedLook(g: Game, w: World, clockMinute: number): LookProjection {
  if (g.mode === "ambience" || g.mode === "outdoorFocus") {
    const selected = g.ambience;
    if (selected) {
      return {
        source: "ambience",
        season: selected.season,
        seasonLabel: SEASON_NAME[selected.season],
        weather: selected.weather,
        weatherLabel: previewLook(selected.season, selected.weather),
        time: selected.time,
        dayPart: ({ dawn: "清晨", day: "白天", dusk: "傍晚", night: "夜" } as const)[selected.time],
      };
    }
    if (g.mode === "ambience") {
      return { source: "missing", season: null, seasonLabel: null, weather: null, weatherLabel: null, time: null, dayPart: null };
    }
  }
  const info = seasonOf(w.day);
  return {
    source: "world",
    season: info.season,
    seasonLabel: SEASON_NAME[info.season],
    weather: w.weather.today,
    weatherLabel: w.weather.look,
    time: visualTime(clockMinute),
    dayPart: DAY_PART_NAME[dayPartOf(clockMinute % 1440)],
  };
}
