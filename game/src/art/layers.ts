// 美术查看页的图层逻辑：画面状态 → 按顺序叠哪些图层文件，哪些这套还没有。
// 只读 Snapshot，不碰世界。以后正式渲染的适配器从这里长出来（HANDOFF 4.1 第 6 条）。
import type { RoomId } from "../core/rooms.ts";
import { MOOD_NAME, type Snapshot } from "../core/view.ts";

export type ArtTime = "day" | "night";
export type ArtWeather = "calm" | "snow" | "blizzard";
export type ArtFire = "out" | "ember" | "low" | "high";
export type ArtFood = "none" | "sparse" | "full";

export interface ArtState {
  time: ArtTime;
  weather: ArtWeather;
  fire: ArtFire;
  /** 柴堆五档，0 是空 */
  wood: 0 | 1 | 2 | 3 | 4;
  food: ArtFood;
  /** 其余开关的物件图层（不带扩展名），如 armchair_blanket、coat、quilt_thick */
  props: string[];
  lamp: boolean;
  heater: boolean;
  actor: boolean;
}

export const EMPTY_STATE: ArtState = {
  time: "day", weather: "calm", fire: "out", wood: 0, food: "none", props: [], lamp: false, heater: false, actor: false,
};

/** 由 time、weather 这些开关管的图层；剩下的才列成单独的物件开关 */
export const MANAGED = new Set([
  "interior_rgba", "glass_mask", "day_preview", "source_clean_1672x940",
  "outside_winter_day_rgba", "outside_winter_day_clear_rgba", "outside_winter_night_rgba",
  "weather_snow", "weather_blizzard", "night_ambient",
  "woodpile_0", "woodpile_1", "woodpile_2", "woodpile_3", "woodpile_4", "stock_sparse", "stock_full",
  "actor_contact", "actor_male_pose", "bed_front_occlusion", "chair_front_occlusion",
  "fire_spill_low", "fire_spill_high", "fire_flame_ember", "fire_flame_low", "fire_flame_high",
  "oil_lamp_body", "oil_lamp_glow", "heater_flame_on",
]);

/** 盖在人物前面的物件 */
const OVER_ACTOR = new Set(["quilt_thick"]);

export interface Stack {
  /** 从下往上 */
  layers: string[];
  /** 这个状态要、这套里没有的图层 */
  missing: string[];
}

/** have(名字) 说这一套、这一间有没有这个图层 */
export function layerStack(have: (name: string) => boolean, room: RoomId, s: ArtState): Stack {
  const layers: string[] = [];
  const missing: string[] = [];
  const want = (name: string): void => void (have(name) ? layers.push(name) : missing.push(name));
  const first = (...names: string[]): void => {
    const hit = names.find(have);
    if (hit) layers.push(hit);
    else missing.push(names[0]);
  };

  if (s.time === "night") want("outside_winter_night_rgba");
  else first("outside_winter_day_rgba", "outside_winter_day_clear_rgba");
  want("interior_rgba");
  if (s.weather !== "calm") want(`weather_${s.weather}`);

  if (room === "hearth_room") want(`woodpile_${s.wood}`);
  if (room === "kitchen_room" && s.food !== "none") want(`stock_${s.food}`);
  for (const p of s.props) if (!OVER_ACTOR.has(p)) want(p);

  if (s.actor) {
    want("actor_contact");
    want("actor_male_pose");
    if (room === "bedroom") want("bed_front_occlusion");
    if (room === "observation_room") want("chair_front_occlusion");
  }
  for (const p of s.props) if (OVER_ACTOR.has(p)) want(p);

  if (s.time === "night") want("night_ambient");
  if (s.fire !== "out") {
    want(`fire_spill_${s.fire === "high" ? "high" : "low"}`);
    if (room === "hearth_room") want(`fire_flame_${s.fire}`);
  }
  want("oil_lamp_body");
  if (s.lamp) want("oil_lamp_glow");
  if (s.heater && room === "observation_room") want("heater_flame_on");
  return { layers, missing };
}

export interface WorldArt {
  state: ArtState;
  /** 素材分得比内核粗、只能就近画的地方 */
  notes: string[];
}

const WEATHER: Record<string, ArtWeather> = {
  clear: "calm", cloudy: "calm", fog: "calm", coldRain: "calm", freezingRain: "calm", thunderstorm: "calm",
  lightSnow: "snow", heavySnow: "snow", blizzard: "blizzard",
};

/** 世界快照 → 选了 room 这一间时该画成什么样 */
export function artFromSnapshot(snap: Snapshot, room: RoomId): WorldArt {
  const notes: string[] = [];
  const look = snap.look;
  const time: ArtTime = look.time === "day" || look.time === "dawn" ? "day" : "night";
  if (look.time === "dawn" || look.time === "dusk") notes.push(`${look.dayPart}没有单独的图，按${time === "day" ? "白天" : "夜里"}画`);

  const key = look.weatherKey ?? "cloudy";
  const weather = WEATHER[key] ?? "calm";
  if (!["clear", "cloudy", "lightSnow", "heavySnow", "blizzard"].includes(key)) notes.push(`${look.weatherLabel}没有天气层，按平静画`);

  let fire: ArtFire;
  switch (snap.fire.look) {
    case "ember": fire = "ember"; break;
    case "low": fire = "low"; break;
    case "mid": fire = "low"; notes.push("炉火只有三档图，正常的火按小火画"); break;
    case "high": fire = "high"; break;
    default: fire = "out";
  }

  const woodRatio = snap.stock.woodCap > 0 ? snap.stock.wood / snap.stock.woodCap : 0;
  const wood = Math.max(0, Math.min(4, Math.ceil(woodRatio * 4))) as ArtState["wood"];
  const foodRatio = snap.stock.foodCap > 0 ? snap.stock.food / snap.stock.foodCap : 0;
  const food: ArtFood = foodRatio >= 0.6 ? "full" : foodRatio > 0 ? "sparse" : "none";

  const props: string[] = [];
  if (room === "kitchen_room" && !snap.actor.away && snap.stage.outfit !== "outdoor") props.push("coat");
  if (room === "hearth_room" && snap.life.mood === MOOD_NAME.rich) props.push("snack_plate");

  const actor = snap.stage.visible[room];
  const lamp = time === "night" && actor && !snap.actor.asleep;
  return {
    state: { time, weather, fire, wood, food, props, lamp, heater: snap.life.heater, actor },
    notes,
  };
}
