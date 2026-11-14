// 世界状态：一份可以整个存成 JSON 的事实。界面和镜头不在这里。
import { CONFIG, type LifeTier, type WeatherTier, type YearKind } from "./config.ts";
import {
  DEFAULT_STYLE,
  PROJECTS,
  type CropDef,
  type Goods,
  type Material,
  type PlaceId,
  type StyleSlot,
  type TaskCategory,
} from "./content.ts";
import { makeRng, type Rng } from "./rng.ts";
import { drawWeather, makeSky, pickLook, pickYearKind, weatherSeason, type SkyState } from "./weather.ts";

export type ActivityKind =
  | "wake"
  | "sleep"
  | "bankFire"
  | "tendFire"
  | "lightFire"
  | "fetchWater"
  | "boilWater"
  | "drink"
  | "meal"
  | "observe"
  | "choreWood"
  | "choreFood"
  | "eaveWood"
  | "eaveFood"
  | "garden"
  | "project"
  | "cones"
  | "swapStyle"
  | "request"
  | "journal"
  | "leisure";

/** 用来统计他的时间花在哪：睡觉、必要生活、活计、观测、项目、小事、闲暇 */
export type ActivityCategory = "sleep" | "necessity" | "chore" | "observe" | "project" | "small" | "leisure";

export interface Phase {
  place: PlaceId;
  minutes: number;
  /** 动作卡上的字；不写就用活动的 label */
  label?: string;
}

export interface Activity {
  kind: ActivityKind;
  label: string;
  category: ActivityCategory;
  phases: Phase[];
  phase: number;
  /** 当前阶段还剩几分钟 */
  left: number;
  /** 你点门出门时能不能马上放下 */
  interruptible: boolean;
  data: Record<string, string | number | boolean>;
}

export type MealName = "breakfast" | "lunch" | "dinner";

export interface MealSlot {
  name: MealName;
  minute: number;
  eaten: boolean;
  /** 俭的日子的午饭：有食材或罐头可顶才吃，没有不算缺餐 */
  optional: boolean;
  skipped: boolean;
}

/** 起床时定下、当天不变的东西，和当天的各种「做过了」 */
export interface DayState {
  woodTier: LifeTier;
  foodTier: LifeTier;
  mood: LifeTier;
  /** 这天点着煤油暖炉 */
  heater: boolean;
  woodUse: number;
  nightSticks: number;
  daySticks: number;
  stickMinutes: number;
  meals: MealSlot[];
  morningChore: boolean;
  afternoonChore: boolean;
  eaveWood: boolean;
  eaveFood: boolean;
  waterFetched: boolean;
  waterBoiled: boolean;
  observed: boolean;
  journal: boolean;
  banked: boolean;
  didChore: boolean;
  projectMinutes: number;
  projectStopped: boolean;
  restUntil: number;
  eveningReadMinutes: number;
  /** 上午被你带出门占了 */
  outingMorning: boolean;
  missedMeals: number;
  /** 今天各样闲暇做了几回 */
  leisure: Record<string, number>;
  lastLeisure: string;
}

export interface ActorState {
  place: PlaceId;
  activity: Activity | null;
  asleep: boolean;
  /** 被你带出门了，人不在家 */
  away: boolean;
  outfit: "indoor" | "outdoor";
  thirst: number;
  /** 正在为出门收尾：手上的事做完以后不接新的 */
  leaving: boolean;
}

export interface PlotState {
  crop: CropDef["id"] | null;
  daysLeft: number;
  ripe: boolean;
  /** 你想让这一格下一茬种什么；null 是随他 */
  preferred: CropDef["id"] | null;
}

export interface ProjectState {
  known: boolean;
  stage: number;
  minutesInStage: number;
  /** 这个阶段的材料已经拿到手边了 */
  stageStarted: boolean;
  done: boolean;
  paused: boolean;
  timesDone: number;
}

export type RequestKind = "earlyRest" | "playRecord" | "tea" | "windowSit";

export interface WorldEvent {
  id: number;
  day: number;
  /** 发生时的绝对游戏分钟 */
  minute: number;
  type: string;
  text: string;
  /** 1 日常，2 值得一提，3 这天的要事，4 大事 */
  weight: number;
}

export interface DaySummary {
  day: number;
  look: string;
  mood: LifeTier;
  text: string;
}

export interface YearPage {
  year: number;
  kind: YearKind;
  thriftDays: number;
  richDays: number;
  longestBlizzard: number;
  repairsDone: string[];
  harvests: number;
  outings: number;
}

/** 场景里的小痕迹：真实动作留下的，过一阵自己消失 */
export interface Trace {
  type: string;
  place: PlaceId;
  until: number;
}

/** 野外的动作，决定这一分钟耗多少体力；表现层也拿它选姿态 */
export type WildAct = "walk" | "road" | "gather" | "fire" | "rest" | "eat";

/** 身体三项，0..IMPL.wild.bodyMax 的整数（02 第 9.4 节）。出门时都是满的 */
export interface Body {
  warmth: number;
  stamina: number;
  health: number;
}

/** 背包里除了带出去的干粮以外的东西：柴按根，其余按件 */
export type Bag = Partial<Record<Goods, number>>;

export interface OutingState {
  /** 在哪个区域；null 是在院门外 */
  area: string | null;
  /** 在区域地图上的哪一格；不在区域里是 null */
  pos: { x: number; y: number } | null;
  /** 走回家门要几个游戏分钟 */
  minutesFromDoor: number;
  /** 干粮，从家里的粮拿的（1 餐 = 1 份） */
  rations: number;
  /** 背包里的东西：柴（带出去的柴捆按 3 根算，加上捡的）、食材、燃油、罐头、素材 */
  bag: Bag;
  body: Body;
  /** 点着的篝火：在哪个区域哪一格，烧到哪个绝对分钟 */
  campfire: { area: string; x: number; y: number; until: number } | null;
  /** 最近一个动作；没动过是 null */
  last: WildAct | null;
  departedAt: number;
  /** 已经提过的返家提示，一趟里每种只提一次；cold、tired 回到警戒线以上会重新可提 */
  reminded: { dusk: boolean; night: boolean; late: boolean; cold: boolean; tired: boolean };
}

/** 野外资源点的记忆，跨趟保留（02 第 9.2 节） */
export interface WildMemory {
  /** 独一份的东西已经拿走了几件。还剩几件 = 03 的账 − 这个数，以后补齐数量时老存档也拿得到 */
  taken: Record<string, number>;
  /** 会恢复的点上次被采是哪一天 */
  harvested: Record<string, number>;
}

export interface World {
  seed: number;
  /** 绝对游戏分钟，第 0 天 00:00 起算。开局是第 0 天 06:00 */
  minute: number;
  /** 到站以来第几天，从 0 起；他起床时加一 */
  day: number;
  /** 这一天起床那一刻的绝对分钟 */
  dayStart: number;
  rng: { weather: Rng; actor: Rng; look: Rng };
  sky: SkyState;
  yearKind: YearKind;
  nextYearKind: YearKind;
  /** 只给测试用：固定年份性格、天天暴风雪 */
  forceYearKind: YearKind | null;
  alwaysBlizzard: boolean;
  weather: { today: WeatherTier; tomorrow: WeatherTier; yesterday: WeatherTier; look: string; blizzardRun: number };
  stock: {
    wood: number;
    food: number;
    ingredients: number;
    cans: number;
    fuel: number;
    materials: Record<Material, number>;
  };
  fire: { burn: number; ember: number };
  today: DayState;
  actor: ActorState;
  plots: PlotState[];
  greenhouse: PlotState[];
  projects: Record<string, ProjectState>;
  intents: {
    pinned: string[];
    request: { kind: RequestKind; day: number } | null;
    keepCans: boolean;
    keepFuel: boolean;
    styleSwaps: { slot: StyleSlot; styleId: string }[];
  };
  styles: Record<StyleSlot, string>;
  /** 得了份、还没放进罐里的小球果 */
  pendingCones: number;
  jar: { cones: number; fullJars: number };
  carvings: number;
  /** 现实这边传进来的轻推，只影响他闲暇时爱做什么 */
  nudge: { category: TaskCategory | null; onBreak: boolean };
  outing: OutingState | null;
  wild: WildMemory;
  events: WorldEvent[];
  nextEventId: number;
  summaries: DaySummary[];
  yearbook: YearPage[];
  yearStats: YearPage;
  traces: Trace[];
  /** 累计数：烧了几根、吃了几餐、各来源入库多少…… */
  tally: Record<string, number>;
}

export function emptyDay(): DayState {
  return {
    woodTier: "normal",
    foodTier: "normal",
    mood: "normal",
    heater: false,
    woodUse: 6,
    nightSticks: 2,
    daySticks: 4,
    stickMinutes: 240,
    meals: [],
    morningChore: false,
    afternoonChore: false,
    eaveWood: false,
    eaveFood: false,
    waterFetched: false,
    waterBoiled: false,
    observed: false,
    journal: false,
    banked: false,
    didChore: false,
    projectMinutes: 0,
    projectStopped: false,
    restUntil: 0,
    eveningReadMinutes: 0,
    outingMorning: false,
    missedMeals: 0,
    leisure: {},
    lastLeisure: "",
  };
}

export function emptyYearPage(year: number, kind: YearKind): YearPage {
  return { year, kind, thriftDays: 0, richDays: 0, longestBlizzard: 0, repairsDone: [], harvests: 0, outings: 0 };
}

export interface NewWorldOptions {
  wood?: number;
  food?: number;
  /** 炉膛是空的（压力测试用） */
  coldHearth?: boolean;
  forceYearKind?: YearKind;
  /** 天天暴风雪（只给结构性压力测试用，会绕开天气的硬边界） */
  alwaysBlizzard?: boolean;
}

/**
 * 新世界的壳：入冬第一天清晨 6 点，还没有排这一天。平时用 sim.createWorld。
 * （分开是为了让 state.ts 不依赖 sim.ts。）
 */
export function createWorldShell(seed: number, opt: NewWorldOptions = {}): World {
  const weatherRng = makeRng(seed);
  const sky = makeSky();
  const yearKind = opt.forceYearKind ?? pickYearKind(weatherRng);
  const today = opt.alwaysBlizzard ? "D" : drawWeather(sky, weatherRng, 0, yearKind);
  const lookRng = makeRng(seed ^ 0x5bd1e995);
  const wood = opt.wood ?? CONFIG.stock.wood0;
  const food = opt.food ?? CONFIG.stock.food0;
  const projects: Record<string, ProjectState> = {};
  for (const p of PROJECTS) {
    projects[p.id] = {
      known: true,
      stage: 0,
      minutesInStage: 0,
      stageStarted: false,
      done: false,
      paused: false,
      timesDone: 0,
    };
  }
  const plot = (): PlotState => ({ crop: null, daysLeft: 0, ripe: false, preferred: null });
  return {
    seed,
    minute: CONFIG.calendar.wakeMinute,
    day: 0,
    dayStart: CONFIG.calendar.wakeMinute,
    rng: { weather: weatherRng, actor: makeRng(seed ^ 0x9e3779b9), look: lookRng },
    sky,
    yearKind,
    nextYearKind: yearKind,
    forceYearKind: opt.forceYearKind ?? null,
    alwaysBlizzard: opt.alwaysBlizzard ?? false,
    weather: {
      today,
      tomorrow: today,
      yesterday: "A",
      look: pickLook(lookRng, weatherSeason(0, yearKind), today),
      blizzardRun: today === "D" ? 1 : 0,
    },
    stock: {
      wood,
      food,
      ingredients: 0,
      cans: 0,
      fuel: 0,
      materials: { lumber: CONFIG.stock.lumber0, rope: 0, canvas: 0, glass: 0, metal: 0, parts: 0, cloth: 0, hide: 0 },
    },
    // 开局炉膛里有火（03 第 2.7 节）
    fire: opt.coldHearth ? { burn: 0, ember: 0 } : { burn: 240, ember: CONFIG.fire.emberMinutes },
    today: emptyDay(),
    actor: { place: "bed", activity: null, asleep: false, away: false, outfit: "indoor", thirst: 0, leaving: false },
    plots: Array.from({ length: CONFIG.garden.plots }, plot),
    greenhouse: Array.from({ length: CONFIG.garden.greenhousePlots }, plot),
    projects,
    intents: { pinned: [], request: null, keepCans: false, keepFuel: false, styleSwaps: [] },
    styles: { ...DEFAULT_STYLE },
    pendingCones: 0,
    jar: { cones: 0, fullJars: 0 },
    carvings: 0,
    nudge: { category: null, onBreak: false },
    outing: null,
    wild: { taken: {}, harvested: {} },
    events: [],
    nextEventId: 1,
    summaries: [],
    yearbook: [],
    yearStats: emptyYearPage(0, yearKind),
    traces: [],
    tally: {},
  };
}

export function bump(w: World, key: string, by = 1): void {
  w.tally[key] = (w.tally[key] ?? 0) + by;
}

/** 这一天的钟点（游戏分钟）。过了午夜还没睡时会大于 1440 */
export function dayClock(w: World): number {
  return CONFIG.calendar.wakeMinute + (w.minute - w.dayStart);
}
