// G2 表现层：只读真实活动、地点与独立氛围选择，映射给精灵和天气图层。
// 不改世界状态、不推进游戏、不创建事件，不解析中文叙述来判断动作。
import { dayPartOf, seasonOf, SEASON_NAME, type DayPart } from "./calendar.ts";
import { CONFIG, type Season, type WeatherTier } from "./config.ts";
import { PROJECTS } from "./content.ts";
import type { Game } from "./game.ts";
import type { ActivityKind, ActorState, World } from "./state.ts";
import { previewLook, weatherArtKey, type WeatherArtKey } from "./weather.ts";

export type PoseKey =
  | "sleep" | "sit" | "sitRead" | "sitWrite" | "sitHold"
  | "standWork" | "standLook" | "crouch" | "walk";

export type PropKey = "book" | "journal" | "cup" | "bowl" | "kettle" | "pot" | "tools" | "instrument" | "pinecone" | null;
export interface PoseProjection {
  activity: ActivityKind | null;
  pose: PoseKey | null;
  prop: PropKey;
}

/** 可以当作独立绘制的姿态，不是另一个角色状态机。只读 Activity 的 kind、地点和 data。 */
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
      ? { activity: kind, pose: "standWork", prop: "pot" }
      : { activity: kind, pose: isSeat ? "sitHold" : "standWork", prop: "bowl" };
  }
  if (kind === "journal") return { activity: kind, pose: isSeat ? "sitWrite" : "standWork", prop: "journal" };
  if (kind === "observe") return { activity: kind, pose: "standLook", prop: "instrument" };
  if (kind === "project") {
    const id = a.data.id;
    const def = PROJECTS.find((p) => p.id === id);
    if (def?.kind === "read") return { activity: kind, pose: isSeat ? "sitRead" : "standLook", prop: "book" };
    // 书桌上做的不是读书的事（整理气象记录这类）是写写抄抄，不是拿工具修东西
    if (isDesk) return { activity: kind, pose: "sitWrite", prop: "journal" };
    return { activity: kind, pose: place === "cellar" ? "crouch" : "standWork", prop: "tools" };
  }
  if (kind === "leisure") {
    if (leisureId === "readIdle") return { activity: kind, pose: isSeat ? "sitRead" : "standLook", prop: "book" };
    if (leisureId === "writeNotes" || leisureId === "weatherNotes")
      return { activity: kind, pose: isSeat ? "sitWrite" : "standLook", prop: "journal" };
    if (leisureId === "tea") return { activity: kind, pose: isArmchair ? "sitHold" : "standWork", prop: "cup" };
    if (leisureId === "fireSit" || leisureId === "rest") return { activity: kind, pose: "sit", prop: null };
    if (leisureId === "tidyShelf") return { activity: kind, pose: "standWork", prop: "book" };
    if (leisureId === "radio") return { activity: kind, pose: "standLook", prop: null };
    if (leisureId === "tidyTools") return { activity: kind, pose: "standWork", prop: "tools" };
    if (leisureId === "waterPlant") return { activity: kind, pose: "standWork", prop: "cup" };
    // 夏天傍晚的「坐在门口」由内核在开始时标成 variant: "sit"；没有标记的（含老存档）按走走算
    if (leisureId === "yardStroll") return { activity: kind, pose: a.data.variant === "sit" ? "sit" : "walk", prop: null };
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
  /** world 是真实世界；ambience 是你选的、冻结着的画面。两者不混。 */
  source: "world" | "ambience";
  season: Season;
  seasonLabel: string;
  weather: WeatherTier;
  weatherLabel: string;
  /** 给美术素材查表的稳定 ID，渲染器不用匹配中文天气描述。老存档里认不出的天气名是 null */
  weatherKey: WeatherArtKey | null;
  /** 画面的光：按当季天黑的钟点分四档。冬天 17:00 以后就是 night */
  time: VisualTime;
  /** 光的中文说法，跟 time 走：冬天 17:30 是「夜」。和 world.dayPart（作息上的时段）不是一回事 */
  dayPart: string;
  /**
   * 内核作息的七个时段键（calendar.ts 的 DayPart），只看钟点、不看季节：冬天 17:30 是 afternoon。
   * 画面要按时段选东西时读它，不读中文。氛围态没有真实钟点，按所选时段取代表键：
   * dawn→dawn、day→noon、dusk→dusk、night→night。
   */
  dayPartKey: DayPart;
}

function visualTime(minute: number, season: Season): VisualTime {
  const m = ((minute % 1440) + 1440) % 1440;
  const part = dayPartOf(m);
  const darkness = CONFIG.outing.dusk[season]; // 与 06 户外返家前的四季天黑时间保持同一来源
  if (m < 6 * 60 || m >= darkness) return "night";
  if (part === "dawn") return "dawn";
  if (m >= darkness - 30) return "dusk";
  return "day";
}
function timeLabel(time: VisualTime, minute: number): string {
  if (time === "night") return "夜";
  if (time === "dawn") return "清晨";
  if (time === "dusk") return "傍晚";
  // 白天继续保留上午、午间、下午的描述，窗口光照统一用 day 键。
  const part = dayPartOf(((minute % 1440) + 1440) % 1440);
  return part === "noon" ? "午间" : part === "morning" ? "上午" :
    part === "dusk" || part === "evening" ? "傍晚" : "下午";
}

const AMBIENCE_DAY_PART: Record<VisualTime, DayPart> = { dawn: "dawn", day: "noon", dusk: "dusk", night: "night" };

/** 与 World.weather 独立：只投影已经保存的氛围选择，不重新抽天气。 */
export function projectedLook(g: Game, w: World, clockMinute: number): LookProjection {
  // 读档时已把「氛围态却没有选择」修回陪伴（save.ts），这里没有选择就是真实世界
  if (g.mode === "ambience" || g.mode === "outdoorFocus") {
    const selected = g.ambience;
    if (selected) {
      return {
        source: "ambience",
        season: selected.season,
        seasonLabel: SEASON_NAME[selected.season],
        weather: selected.weather,
        weatherLabel: previewLook(selected.season, selected.weather),
        weatherKey: weatherArtKey(previewLook(selected.season, selected.weather)),
        time: selected.time,
        dayPart: ({ dawn: "清晨", day: "白天", dusk: "傍晚", night: "夜" } as const)[selected.time],
        dayPartKey: AMBIENCE_DAY_PART[selected.time],
      };
    }
  }
  const info = seasonOf(w.day);
  return {
    source: "world",
    season: info.season,
    seasonLabel: SEASON_NAME[info.season],
    weather: w.weather.today,
    weatherLabel: w.weather.look,
    weatherKey: weatherArtKey(w.weather.look),
    time: visualTime(clockMinute, info.season),
    dayPart: timeLabel(visualTime(clockMinute, info.season), clockMinute),
    dayPartKey: dayPartOf(((clockMinute % 1440) + 1440) % 1440),
  };
}
