// 画面的图层逻辑：画面状态 → 按顺序叠哪些图层文件，哪些这套还没有；世界快照 → 画面状态和人形站位。
// 灰盒主界面（src/app/scene.ts）和美术查看页（art.html）共用这一份，真正叠图在 compose.ts。
// 只读 Snapshot，不碰世界；纯逻辑，不碰 DOM，测试直接跑。
import type { RoomId } from "../core/rooms.ts";
import { MOOD_NAME, type Snapshot } from "../core/view.ts";

export type ArtTime = "day" | "night";
export type ArtWeather = "calm" | "snow" | "blizzard";
export type ArtFire = "out" | "ember" | "low" | "mid" | "high";
export type ArtFood = "none" | "sparse" | "half" | "full";

export interface ArtState {
  time: ArtTime;
  weather: ArtWeather;
  fire: ArtFire;
  /** 柴堆五档，0 是空 */
  wood: 0 | 1 | 2 | 3 | 4;
  food: ArtFood;
  /** 窗台玻璃罐里的松果：0 空，1/2/3 是三分之一、三分之二、满 */
  jar: 0 | 1 | 2 | 3;
  /** 其余开关的物件图层（不带扩展名），如 armchair_blanket、coat、quilt_thick */
  props: string[];
  /** 油灯摆着（修好太阳能板以前） */
  oilLamp: boolean;
  /** 油灯点着 */
  lamp: boolean;
  heater: boolean;
  actor: boolean;
}

export const EMPTY_STATE: ArtState = {
  time: "day", weather: "calm", fire: "out", wood: 0, food: "none", jar: 0, props: [], oilLamp: true, lamp: false, heater: false, actor: false,
};

/** 由 time、weather 这些开关管的图层；剩下的才列成单独的物件开关 */
export const MANAGED = new Set([
  "interior_rgba", "glass_mask", "day_preview", "source_clean_1672x940",
  "outside_winter_day_rgba", "outside_winter_day_clear_rgba", "outside_winter_night_rgba",
  "weather_snow", "weather_blizzard", "night_ambient",
  "woodpile_0", "woodpile_1", "woodpile_2", "woodpile_3", "woodpile_4", "stock_sparse", "stock_half", "stock_full",
  "jar_1", "jar_2", "jar_3",
  "actor_contact", "actor_male_pose", "bed_front_occlusion", "chair_front_occlusion",
  "fire_spill_low", "fire_spill_high", "fire_flame_ember", "fire_flame_low", "fire_flame_mid", "fire_flame_high",
  "oil_lamp_body", "oil_lamp_glow", "heater_flame_on",
  "radio_broken", "gramophone_covered",
]);

/** 修好以后换图的物件：新的那张没开就画旧的（旧的罩布让出来的那块在室内层里是透明的，不画就成了窗洞） */
const REPAIRED: Record<string, string> = { radio_fixed: "radio_broken", gramophone_open: "gramophone_covered" };

/** 盖在人物前面的物件 */
const OVER_ACTOR = new Set(["quilt_thick"]);

/**
 * 素材还没出、先用代码顶一下的那几层，跟文件名混在 layers 里，以 ~ 开头。
 * 图一到（have 说有），对应的顶替就不再出现。
 */
export const STAND_IN = {
  /** 夜里的窗外还没出：用白天的窗外层压暗 */
  nightOutside: "~night_outside",
  /** 夜色层还没出：整间盖一层薄薄的夜色 */
  nightRoom: "~night_room",
} as const;

export interface Stack {
  /** 从下往上；~ 开头的是 STAND_IN */
  layers: string[];
  /** layers 的前这么多层是窗外（窗外、天气），先叠在一起、按玻璃掩码裁，再垫在室内层下面 */
  outside: number;
  /** 人形画在 layers[figureAt] 之前（等于 layers.length 就画在最上面）：比家具靠前、比遮挡物、夜色和火光靠后 */
  figureAt: number;
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

  const day = ["outside_winter_day_rgba", "outside_winter_day_clear_rgba"];
  if (s.time === "day") first(...day);
  else if (have("outside_winter_night_rgba")) layers.push("outside_winter_night_rgba");
  else {
    missing.push("outside_winter_night_rgba");
    const hit = day.find(have);
    if (hit) layers.push(hit, STAND_IN.nightOutside);
  }
  // 雪和暴风雪在玻璃外面：跟窗外一起裁，垫在窗框下面
  if (s.weather !== "calm") want(`weather_${s.weather}`);
  const outside = layers.length;
  want("interior_rgba");

  // 柴堆 0 档、粮空就是底图本身；旧套有单独的 woodpile_0
  if (room === "hearth_room" && (s.wood > 0 || have("woodpile_0"))) want(`woodpile_${s.wood}`);
  if (room === "kitchen_room" && s.food === "half") first("stock_half", "stock_sparse");
  else if (room === "kitchen_room" && s.food !== "none") want(`stock_${s.food}`);
  if (room === "observation_room" && s.jar > 0) want(`jar_${s.jar}`);
  for (const [fixed, old] of Object.entries(REPAIRED)) if (!s.props.includes(fixed) && have(old)) layers.push(old);
  for (const p of s.props) if (!OVER_ACTOR.has(p)) want(p);

  const figureAt = layers.length;
  if (s.actor) {
    want("actor_contact");
    want("actor_male_pose");
    if (room === "bedroom") want("bed_front_occlusion");
    if (room === "observation_room") want("chair_front_occlusion");
  }
  for (const p of s.props) if (OVER_ACTOR.has(p)) want(p);

  if (s.time === "night") {
    if (have("night_ambient")) layers.push("night_ambient");
    else {
      missing.push("night_ambient");
      if (have("interior_rgba")) layers.push(STAND_IN.nightRoom);
    }
  }
  if (s.fire !== "out") {
    want(`fire_spill_${s.fire === "high" ? "high" : "low"}`);
    if (room === "hearth_room") {
      if (s.fire === "mid") first("fire_flame_mid", "fire_flame_low");
      else want(`fire_flame_${s.fire}`);
    }
  }
  if (s.oilLamp) {
    want("oil_lamp_body");
    if (s.lamp) want("oil_lamp_glow");
  }
  if (s.heater && room === "observation_room") want("heater_flame_on");
  return { layers, outside, figureAt, missing };
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

/** 人形占位：角色图出来以前，按站位的脚底和身高画一个人形 */
export interface Figure {
  /** 2560×1440 画布上的脚底 */
  foot: [number, number];
  height: number;
  /** stage.pose 的九种姿态键 */
  pose: string;
  /** 室内衣着、出门的衣着、氛围态的演出（不是真在做事） */
  look: "indoor" | "outdoor" | "illusion";
}

export type Locate = (place: string) => { foot: [number, number] | null; height: number | null } | null | undefined;

/** 他在这一间（按 stage.visible）就给站位上的人形；站位没写脚底就不画 */
export function figureFromSnapshot(snap: Snapshot, room: RoomId, locate: Locate): Figure | null {
  const st = snap.stage;
  if (!st.visible[room] || !st.place) return null;
  const l = locate(st.place);
  if (!l?.foot) return null;
  return {
    foot: l.foot,
    height: l.height ?? 600,
    pose: st.pose ?? "standLook",
    look: st.illusion ? "illusion" : st.outfit === "outdoor" ? "outdoor" : "indoor",
  };
}

/** 世界快照 → 选了 room 这一间时该画成什么样 */
export function artFromSnapshot(snap: Snapshot, room: RoomId): WorldArt {
  const notes: string[] = [];
  const look = snap.look;
  const time: ArtTime = look.time === "day" || look.time === "dawn" ? "day" : "night";
  if (look.time === "dawn" || look.time === "dusk") notes.push(`${look.dayPart}没有单独的图，按${time === "day" ? "白天" : "夜里"}画`);

  const key = look.weatherKey ?? "cloudy";
  const weather = WEATHER[key] ?? "calm";
  if (!["clear", "cloudy", "lightSnow", "heavySnow", "blizzard"].includes(key)) notes.push(`${look.weatherLabel}没有天气层，按平静画`);

  const look5 = snap.fire.look;
  const fire: ArtFire = look5 === "ember" || look5 === "low" || look5 === "mid" || look5 === "high" ? look5 : "out";

  const woodRatio = snap.stock.woodCap > 0 ? snap.stock.wood / snap.stock.woodCap : 0;
  const wood = Math.max(0, Math.min(4, Math.ceil(woodRatio * 4))) as ArtState["wood"];
  const foodRatio = snap.stock.foodCap > 0 ? snap.stock.food / snap.stock.foodCap : 0;
  const food: ArtFood = foodRatio <= 0 ? "none" : foodRatio < 1 / 3 ? "sparse" : foodRatio < 2 / 3 ? "half" : "full";
  // 每罐 30 颗；满了就换一只空罐，所以只看当前这一罐
  const cones = snap.jar.cones;
  const jar = (cones <= 0 ? 0 : cones < 12 ? 1 : cones < 24 ? 2 : 3) as ArtState["jar"];

  const stageOf = (id: string): number => snap.projects.find((p) => p.id === id)?.stage ?? 0;
  const done = (id: string): boolean => {
    const p = snap.projects.find((q) => q.id === id);
    return !!p && p.stage >= p.stages;
  };
  const atDesk = snap.traces.filter((t) => t.place === "desk").map((t) => t.type);
  const props: string[] = [];
  if (room === "hearth_room") {
    props.push("kettle", "armchair_blanket");
    if (snap.life.mood === MOOD_NAME.rich) props.push("snack_plate");
    if (done("radio")) props.push("radio_fixed");
    if (done("gramophone")) props.push("gramophone_open");
  }
  if (room === "observation_room") {
    if (atDesk.includes("openBook") || atDesk.includes("openJournal")) props.push("desk_work");
    if (atDesk.includes("cup")) props.push("cup");
  }
  if (room === "kitchen_room") {
    if (!snap.actor.away && snap.stage.outfit !== "outdoor") props.push("coat");
    const a = snap.stage.activity;
    if (snap.stage.place === "stove" && (a === "meal" || a === "choreFood")) props.push("prep");
  }
  if (room === "bedroom" && stageOf("bedding") >= 1) props.push("quilt_thick");

  const actor = snap.stage.visible[room];
  const lamp = time === "night" && actor && !snap.actor.asleep;
  return {
    state: { time, weather, fire, wood, food, jar, props, oilLamp: !done("solar"), lamp, heater: snap.life.heater, actor },
    notes,
  };
}
