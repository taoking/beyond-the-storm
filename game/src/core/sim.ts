// 世界模拟：一步一个游戏分钟。规则来自 设计/02_玩法.md 第 3–8 节。
// 这里没有现实时间、没有界面；谁来调 stepMinute、调多快，由 game.ts 决定。
import { CONFIG, type LifeTier, type Season } from "./config.ts";
import { dayPartOf, daysUntilWinter, seasonOf } from "./calendar.ts";
import {
  CROP_BY_ID,
  CROPS,
  MATERIAL_NAME,
  PROJECT_BY_ID,
  PROJECTS,
  STYLES,
  zoneOf,
  type CropDef,
  type Material,
  type PlaceId,
  type ProjectDef,
  type ProjectEffect,
} from "./content.ts";
import { chance, intBetween, pickWeighted } from "./rng.ts";
import {
  bump,
  createWorldShell,
  dayClock,
  emptyDay,
  emptyYearPage,
  type Activity,
  type ActivityCategory,
  type ActivityKind,
  type DayState,
  type MealSlot,
  type NewWorldOptions,
  type Phase,
  type PlotState,
  type World,
} from "./state.ts";
import { drawWeather, pickLook, pickYearKind, weatherSeason } from "./weather.ts";

const C = CONFIG;
const TIER_ORDER: LifeTier[] = ["thrift", "normal", "rich"];
const MEAL_NAME = { breakfast: "早饭", lunch: "午饭", dinner: "晚饭" } as const;

// ---------- 由状态推出来的量 ----------

export function hasEffect(w: World, effect: ProjectEffect): boolean {
  return countEffect(w, effect) > 0;
}

export function countEffect(w: World, effect: ProjectEffect): number {
  let n = 0;
  for (const p of PROJECTS) if (p.effect === effect && w.projects[p.id].done) n += 1;
  return n;
}

export function woodCap(w: World): number {
  return hasEffect(w, "woodCap") ? C.stock.woodCapShed : C.stock.woodCap;
}

export function foodCap(w: World): number {
  return hasEffect(w, "foodCap") ? C.stock.foodCapCellar : C.stock.foodCap;
}

/** 当季「正常」的柴日用度，算上省柴的修缮 */
export function normalWoodUse(w: World): number {
  return Math.max(1, C.woodUse[seasonOf(w.day).season].normal - countEffect(w, "saveWood"));
}

export function woodDays(w: World): number {
  return w.stock.wood / normalWoodUse(w);
}

export function foodDays(w: World): number {
  return w.stock.food / 3;
}

function nextTier(days: number, cur: LifeTier): LifeTier {
  const t = C.tiers;
  if (cur === "thrift") return days < t.thriftExit ? "thrift" : days >= t.rich ? "rich" : "normal";
  if (cur === "rich") return days >= t.richExit ? "rich" : days < t.thrift ? "thrift" : "normal";
  return days < t.thrift ? "thrift" : days >= t.rich ? "rich" : "normal";
}

function lowerTier(a: LifeTier, b: LifeTier): LifeTier {
  return TIER_ORDER[Math.min(TIER_ORDER.indexOf(a), TIER_ORDER.indexOf(b))];
}

export function yardWeather(w: World): boolean {
  return w.weather.today === "A" || w.weather.today === "B";
}

/** 入库。装不下的部分不进库，也不记进来源（账要对得上）。返回真正入库的数。 */
function addWood(w: World, n: number, source: string): number {
  const got = Math.max(0, Math.min(n, woodCap(w) - w.stock.wood));
  w.stock.wood += got;
  bump(w, `柴:${source}`, got);
  return got;
}

function addFood(w: World, n: number, source: string): number {
  const got = Math.max(0, Math.min(n, foodCap(w) - w.stock.food));
  w.stock.food += got;
  bump(w, `粮:${source}`, got);
  return got;
}

export function logEvent(w: World, type: string, text: string, weight = 1): void {
  w.events.push({ id: w.nextEventId++, day: w.day, minute: w.minute, type, text, weight });
}

function leaveTrace(w: World, type: string, place: PlaceId, minutes: number): void {
  w.traces = w.traces.filter((t) => !(t.type === type && t.place === place));
  w.traces.push({ type, place, until: w.minute + minutes });
}

// ---------- 新的一天 ----------

function planDay(w: World, prev: DayState | null): void {
  const season = seasonOf(w.day).season;
  const d = emptyDay();
  d.woodTier = nextTier(woodDays(w), prev?.woodTier ?? "normal");
  d.foodTier = nextTier(foodDays(w), prev?.foodTier ?? "normal");
  // 柴进了俭才点煤油暖炉：柴照俭的量烧，心境按正常算（02 第 5.8 节）
  if (d.woodTier === "thrift" && w.stock.fuel >= 1 && !w.intents.keepFuel) {
    w.stock.fuel -= 1;
    d.heater = true;
    logEvent(w, "heater", "柴不多了，点上了仪器角的煤油暖炉。", 3);
  }
  d.mood = lowerTier(d.heater ? "normal" : d.woodTier, d.foodTier);
  let use = C.woodUse[season][d.woodTier] - countEffect(w, "saveWood");
  if (w.weather.today === "D" && d.woodTier !== "thrift") use += C.stormExtraWood;
  use = Math.max(C.minWoodPerDay, use);
  d.woodUse = use;
  d.nightSticks = Math.max(1, Math.floor(use / 3));
  d.daySticks = Math.max(1, use - d.nightSticks);
  d.stickMinutes = Math.round(C.fire.awakeMinutes / d.daySticks);
  const thrift = d.foodTier === "thrift";
  const meal = (name: MealSlot["name"], optional = false): MealSlot => ({
    name,
    minute: C.meals[name],
    eaten: false,
    optional,
    skipped: false,
  });
  d.meals = [meal("breakfast"), meal("lunch", thrift), meal("dinner")];
  w.today = d;
  if (d.mood === "thrift") w.yearStats.thriftDays += 1;
  if (d.mood === "rich") w.yearStats.richDays += 1;
  bump(w, `日:${d.mood}`);
  bump(w, "日:合计");
  if (prev && prev.mood !== d.mood) {
    const text =
      d.mood === "thrift"
        ? "存的不多了，这几天省着过。"
        : d.mood === "rich"
          ? "柴粮都宽裕，火可以烧旺些。"
          : prev.mood === "thrift"
            ? "缓过来了，日子照常。"
            : "存货回到平常的样子。";
    logEvent(w, "tier", text, 3);
  }
}

export function createWorld(seed: number, opt: NewWorldOptions = {}): World {
  const w = createWorldShell(seed, opt);
  w.weather.tomorrow = drawTomorrow(w);
  planDay(w, null);
  logEvent(w, "season", "入冬第一天。接手了站里的日志本。", 3);
  startActivity(w, wakeActivity());
  return w;
}

function drawTomorrow(w: World): World["weather"]["tomorrow"] {
  const next = w.day + 1;
  if (next % C.calendar.yearDays === 0) w.nextYearKind = w.forceYearKind ?? pickYearKind(w.rng.weather);
  if (w.alwaysBlizzard) return "D";
  return drawWeather(w.sky, w.rng.weather, next, w.nextYearKind);
}

function growCrops(w: World): void {
  const info = seasonOf(w.day);
  for (const p of w.plots) {
    if (!p.crop) continue;
    if (!p.ripe) {
      if (info.season === "winter") {
        // 入冬前没熟的收不到
        p.crop = null;
        continue;
      }
      if (w.weather.yesterday !== "D") p.daysLeft -= 1;
      if (p.daysLeft <= 0) p.ripe = true;
    }
  }
  for (const p of w.greenhouse) {
    if (!p.crop || p.ripe) continue;
    p.daysLeft -= 1;
    if (p.daysLeft <= 0) p.ripe = true;
  }
}

function writeSummary(w: World): void {
  const todays = w.events.filter((e) => e.day === w.day);
  const picked = todays
    .filter((e) => e.weight >= 2)
    .sort((a, b) => b.weight - a.weight || a.minute - b.minute)
    .slice(0, 4)
    .sort((a, b) => a.minute - b.minute);
  if (picked.length === 0) {
    const quiet = todays.filter((e) => e.type === "leisure").slice(-1);
    picked.push(...quiet);
  }
  const body = picked.map((e) => e.text).join("");
  w.summaries.push({
    day: w.day,
    look: w.weather.look,
    mood: w.today.mood,
    text: `第 ${w.day + 1} 天，${w.weather.look}。${body || "屋里待了一天。"}`,
  });
}

export function newDay(w: World): void {
  writeSummary(w);
  const prev = w.today;
  if (prev.missedMeals) bump(w, "缺餐", prev.missedMeals);
  if (prev.didChore) bump(w, "有活计的天");
  w.day += 1;
  w.dayStart = w.minute;
  const info = seasonOf(w.day);

  // 小请求按游戏世界日过期（02 第 14.1 条）
  if (w.intents.request && w.intents.request.day < w.day) w.intents.request = null;

  if (info.dayInYear === 0) {
    w.yearbook.push(w.yearStats);
    w.yearKind = w.nextYearKind;
    w.yearStats = emptyYearPage(info.year, w.yearKind);
  }
  w.weather.yesterday = w.weather.today;
  w.weather.today = w.weather.tomorrow;
  w.weather.tomorrow = drawTomorrow(w);
  w.weather.look = pickLook(w.rng.look, weatherSeason(w.day, w.yearKind), w.weather.today);
  w.weather.blizzardRun = w.weather.today === "D" ? w.weather.blizzardRun + 1 : 0;
  w.yearStats.longestBlizzard = Math.max(w.yearStats.longestBlizzard, w.weather.blizzardRun);

  growCrops(w);
  planDay(w, prev);

  if (info.dayInSeason === 0) {
    const first: Record<Season, string> = {
      winter: "入冬了。",
      spring: "开春了。",
      summer: "入夏了。",
      autumn: "入秋了，该备冬了。",
    };
    logEvent(w, "season", first[info.season], 3);
  }

  const keepFrom = w.day - C.IMPL.eventKeepDays;
  if (w.events.length && w.events[0].day < keepFrom) w.events = w.events.filter((e) => e.day >= keepFrom);
  w.traces = w.traces.filter((t) => t.until > w.minute);
  w.actor.asleep = false;
}

// ---------- 活动 ----------

export function activity(
  kind: ActivityKind,
  label: string,
  category: ActivityCategory,
  phases: Phase[],
  data: Activity["data"] = {},
  interruptible = false,
): Activity {
  const ph = phases.map((p) => ({ ...p, minutes: Math.max(1, Math.round(p.minutes)) }));
  return { kind, label, category, phases: ph, phase: 0, left: ph[0].minutes, interruptible, data };
}

function totalMinutes(a: Activity): number {
  let n = 0;
  for (const p of a.phases) n += p.minutes;
  return n;
}

export function remainingMinutes(a: Activity): number {
  let n = a.left;
  for (let i = a.phase + 1; i < a.phases.length; i++) n += a.phases[i].minutes;
  return n;
}

function wakeActivity(): Activity {
  return activity("wake", "起床", "necessity", [{ place: "bed", minutes: C.IMPL.wakeUpMinutes }]);
}

function eaveWoodActivity(): Activity {
  const m = C.supply.eaveWoodMinutes;
  return activity("eaveWood", "去防风林折枯枝", "chore", [
    { place: "backdoor", minutes: 2, label: "抓着牵引绳出后门" },
    { place: "windbreak", minutes: m - 10, label: "在防风林折枯枝" },
    { place: "woodpile", minutes: 8, label: "在码枯枝" },
  ]);
}

function eaveFoodActivity(): Activity {
  const m = C.supply.eaveFoodMinutes;
  return activity("eaveFood", "去泉屋起鱼笼", "chore", [
    { place: "springhouse", minutes: m - 20, label: "在泉屋起鱼笼" },
    { place: "stove", minutes: 20, label: "在收拾鱼" },
  ]);
}

function choreActivity(w: World, what: "wood" | "food", slot: "m" | "a"): Activity {
  const m = C.supply.choreMinutes;
  if (what === "wood") {
    return activity(
      "choreWood",
      "备柴",
      "chore",
      [
        { place: "forestEdge", minutes: m - 90, label: "在林子边上锯倒木" },
        { place: "choppingBlock", minutes: 80, label: "在院里劈柴" },
        { place: "woodpile", minutes: 10, label: "在码柴" },
      ],
      { slot },
    );
  }
  const season = seasonOf(w.day).season;
  const water = season === "winter" ? "在溪湾凿冰洞下钩" : season === "spring" ? "在溪湾下钩" : "在溪湾钓鱼";
  const land =
    season === "winter"
      ? "沿林子边查套索"
      : season === "spring"
        ? "在坡上挖根茎"
        : season === "summer"
          ? "在林子边采野菜"
          : "在林子边采根茎";
  return activity(
    "choreFood",
    "备粮",
    "chore",
    [
      { place: "creekBend", minutes: m - 100, label: water },
      { place: "forestEdge", minutes: 70, label: land },
      { place: "stove", minutes: 30, label: "在收拾带回来的东西" },
    ],
    { slot },
  );
}

/** 这顿饭吃什么：俭时先食材、再罐头、最后才是粮；丰足时有食材就做好菜（02 第 5.3 节） */
function mealSource(w: World): "ingredient" | "can" | "food" | "dish" | null {
  const s = w.stock;
  const tier = w.today.foodTier;
  const canOk = s.cans > 0 && !w.intents.keepCans;
  if (tier === "thrift") {
    if (s.ingredients > 0) return "ingredient";
    if (canOk) return "can";
    return s.food >= 1 ? "food" : null;
  }
  if (s.food >= 1) return tier === "rich" && s.ingredients > 0 ? "dish" : "food";
  if (s.ingredients > 0) return "ingredient";
  return canOk ? "can" : null;
}

function mealActivity(meal: MealSlot, source: string): Activity {
  const name = MEAL_NAME[meal.name];
  const half = C.mealMinutes / 2;
  return activity(
    "meal",
    `吃${name}`,
    "necessity",
    [
      { place: "stove", minutes: half, label: source === "can" ? "在热罐头" : `在做${name}` },
      { place: "armchair", minutes: half, label: `在吃${name}` },
    ],
    { meal: meal.name, source },
  );
}

function teaPhases(w: World): Phase[] {
  return [
    { place: "stove", minutes: 5, label: "在泡茶" },
    { place: "armchair", minutes: intBetween(w.rng.actor, 20, 30), label: "在炉边喝茶" },
  ];
}

// ---------- 闲暇 ----------

interface LeisureDef {
  id: string;
  /** 这会儿想做它的程度；0 是不做 */
  weight(w: World, t: number): number;
  build(w: World, t: number): { label: string; phases: Phase[]; text: string };
  /** 你在做这类现实任务、或者正在休息时，他更爱做它（02 第 6.3 节） */
  nudge: string[];
}

const snowing = (w: World): boolean => /雪/.test(w.weather.look);
const isEvening = (t: number): boolean => t >= 19 * 60;
const span = (w: World, lo: number, hi: number): number => intBetween(w.rng.actor, lo, hi);

const LEISURE: LeisureDef[] = [
  {
    id: "tea",
    weight: (_w, t) => (isEvening(t) ? 3 : 2),
    build: (w) => ({ label: "喝茶", phases: teaPhases(w), text: "泡了杯茶。" }),
    nudge: ["break"],
  },
  {
    id: "watchSnow",
    weight: () => 2,
    build: (w) => {
      const label = snowing(w) ? "在窗边看雪" : "在窗边看天";
      return { label, phases: [{ place: "window", minutes: span(w, 15, 25) }], text: `${label.slice(1)}。` };
    },
    nudge: ["break", "write"],
  },
  {
    id: "fireSit",
    weight: (w, t) => (isEvening(t) ? 3 : 1) * (w.today.mood === "thrift" ? 2 : 1),
    build: (w) => {
      const label = w.today.mood === "thrift" ? "裹着毯子烤火" : "在烤火";
      return { label, phases: [{ place: "armchair", minutes: span(w, 15, 30) }], text: "在炉边坐了一阵。" };
    },
    nudge: ["break"],
  },
  {
    id: "readIdle",
    weight: () => 2,
    build: (w, t) =>
      isEvening(t)
        ? { label: "在炉边翻书", phases: [{ place: "armchair", minutes: span(w, 30, 45) }], text: "在炉边翻了会儿书。" }
        : { label: "在窗下翻书", phases: [{ place: "desk", minutes: span(w, 30, 45) }], text: "在窗下翻了会儿书。" },
    nudge: ["study"],
  },
  {
    id: "tidyShelf",
    weight: (_w, t) => (isEvening(t) ? 0 : 1),
    build: (w) => ({ label: "在整理书架", phases: [{ place: "bookshelf", minutes: span(w, 20, 30) }], text: "理了理书架。" }),
    nudge: ["study"],
  },
  {
    id: "weatherNotes",
    weight: () => 1,
    build: (w) => ({
      label: "在看气象记录",
      phases: [{ place: "instruments", minutes: span(w, 15, 25) }],
      text: "翻了翻前任的气象记录。",
    }),
    nudge: ["study"],
  },
  {
    id: "tidyTools",
    weight: (_w, t) => (isEvening(t) ? 0 : 1),
    build: (w) => ({ label: "在整理工具", phases: [{ place: "workbench", minutes: span(w, 20, 30) }], text: "把工具归了位。" }),
    nudge: ["code"],
  },
  {
    id: "radio",
    weight: (w, t) => (hasEffect(w, "radio") && isEvening(t) ? 3 : 1),
    build: (w) =>
      hasEffect(w, "radio")
        ? { label: "在听收音机", phases: [{ place: "radio", minutes: span(w, 20, 30) }], text: "听了会儿收音机。" }
        : { label: "在摆弄收音机", phases: [{ place: "radio", minutes: span(w, 20, 30) }], text: "摆弄了一阵收音机，还是只有沙沙声。" },
    nudge: ["code"],
  },
  {
    id: "writeNotes",
    weight: () => 0.5,
    build: (w) => ({
      label: "在日志本上添几行",
      phases: [{ place: "desk", minutes: span(w, 15, 25) }],
      text: "在日志本上添了几行。",
    }),
    nudge: ["write"],
  },
  {
    id: "yardStroll",
    weight: (w, t) => {
      if (!yardWeather(w) || t < 8 * 60) return 0;
      const season = seasonOf(w.day).season;
      if (season === "summer" && t >= 18 * 60 && t < 21 * 60) return 3;
      return t < 18 * 60 ? 1 : 0;
    },
    build: (w, t) =>
      seasonOf(w.day).season === "summer" && t >= 18 * 60
        ? { label: "坐在门口", phases: [{ place: "gate", minutes: span(w, 20, 30) }], text: "傍晚在门口坐了一阵。" }
        : { label: "在院子里走走", phases: [{ place: "gate", minutes: span(w, 15, 20) }], text: "在院子里走了走。" },
    nudge: [],
  },
  {
    id: "rest",
    weight: (_w, t) => (dayPartOf(t) === "noon" ? 3 : 0),
    build: (w) => ({ label: "歇一会儿", phases: [{ place: "armchair", minutes: span(w, 20, 30) }], text: "午后歇了一会儿。" }),
    nudge: ["break"],
  },
  {
    id: "waterPlant",
    weight: (w, t) => (w.styles.idle === "idleWaterPlant" && w.styles.windowsill === "plant" && t < 12 * 60 ? 1 : 0),
    build: () => ({ label: "在给绿植浇水", phases: [{ place: "windowsill", minutes: 3 }], text: "给窗台的绿植浇了水。" }),
    nudge: [],
  },
];

/** 下一件到点要做的事是几点：闲暇别拖过它 */
function nextBoundary(w: World, t: number): number {
  const marks = [8 * 60, 14 * 60, 20 * 60, bedtime(w)];
  for (const m of w.today.meals) if (!m.eaten && !m.skipped) marks.push(m.minute);
  let best = bedtime(w);
  for (const m of marks) if (m > t && m < best) best = m;
  return best;
}

function leisureActivity(w: World, t: number): Activity {
  const nudges: string[] = [];
  if (w.nudge.onBreak) nudges.push("break");
  else if (w.nudge.category) nudges.push(w.nudge.category);
  const options: [LeisureDef, number][] = [];
  for (const def of LEISURE) {
    let weight = def.weight(w, t);
    if (weight <= 0) continue;
    if (def.nudge.some((n) => nudges.includes(n))) weight *= 3;
    // 今天做过的少做些，刚做完的不接着做，免得一下午都在摆弄同一样东西
    const times = w.today.leisure[def.id] ?? 0;
    weight /= 1 + 2 * times;
    if (w.today.lastLeisure === def.id) weight *= 0.1;
    options.push([def, weight]);
  }
  const def = pickWeighted(w.rng.actor, options);
  const built = def.build(w, t);
  w.today.leisure[def.id] = (w.today.leisure[def.id] ?? 0) + 1;
  w.today.lastLeisure = def.id;
  // 别拖过下一件到点的事，但至少做 10 分钟，免得几分钟一换
  const room = Math.max(10, nextBoundary(w, t) - t);
  let total = 0;
  for (const p of built.phases) total += p.minutes;
  if (total > room) {
    const last = built.phases[built.phases.length - 1];
    last.minutes = Math.max(5, last.minutes - (total - room));
  }
  return activity("leisure", built.label, "leisure", built.phases, { id: def.id, text: built.text }, true);
}

// ---------- 项目 ----------

export type ProjectStatus = "unknown" | "done" | "paused" | "doing" | "needMaterials" | "needWeather" | "blocked" | "queued";

/** 还没开工的基础修缮阶段一共还要多少木料 */
function lumberReservedForBase(w: World): number {
  let n = 0;
  for (const def of PROJECTS) {
    if (!def.base) continue;
    const ps = w.projects[def.id];
    if (ps.done) continue;
    for (let i = ps.stage; i < def.stages.length; i++) {
      if (i === ps.stage && ps.stageStarted) continue;
      n += def.stages[i].materials?.lumber ?? 0;
    }
  }
  return n;
}

function missingMaterials(w: World, def: ProjectDef, stage: number): Partial<Record<Material, number>> | null {
  const need = def.stages[stage].materials;
  if (!need) return null;
  const missing: Partial<Record<Material, number>> = {};
  let any = false;
  // 旧木料堆先留给基础修缮：别的项目只能用多出来的，保证基础修缮不出门也做得完（02 第 7.6 节）
  const reserved = def.base ? 0 : lumberReservedForBase(w);
  for (const [k, n] of Object.entries(need) as [Material, number][]) {
    const have = k === "lumber" ? w.stock.materials[k] - reserved : w.stock.materials[k];
    const lack = n - Math.max(0, have);
    if (lack > 0) {
      missing[k] = lack;
      any = true;
    }
  }
  return any ? missing : null;
}

export function projectStatus(w: World, id: string): { status: ProjectStatus; note: string } {
  const def = PROJECT_BY_ID[id];
  const ps = w.projects[id];
  if (!ps.known) return { status: "unknown", note: "" };
  if (ps.done && !def.repeatable) return { status: "done", note: "做完了" };
  if (ps.paused) return { status: "paused", note: "你让先放着" };
  if (def.requires && !w.projects[def.requires].done) {
    return { status: "blocked", note: `要先${PROJECT_BY_ID[def.requires].name}` };
  }
  if (!ps.stageStarted) {
    const missing = missingMaterials(w, def, ps.stage);
    if (missing) {
      const parts = (Object.entries(missing) as [Material, number][]).map(([k, n]) => `${MATERIAL_NAME[k]} ${n}`);
      // 木料堆里其实有，只是留给了基础修缮：照实说，不显示成单纯的缺货
      const held = !def.base && missing.lumber !== undefined && lumberReservedForBase(w) > 0;
      return { status: "needMaterials", note: `等材料：${held ? "旧木料先留给基础修缮，" : ""}还差${parts.join("、")}` };
    }
  }
  if (def.where === "yard" && !yardWeather(w)) return { status: "needWeather", note: "等天气" };
  const act = w.actor.activity;
  if (act?.kind === "project" && act.data.id === id) return { status: "doing", note: "在做" };
  if (ps.stage > 0 || ps.minutesInStage > 0 || ps.stageStarted) return { status: "doing", note: "在做" };
  return { status: "queued", note: "还没排到" };
}

function projectEligible(w: World, def: ProjectDef): boolean {
  const ps = w.projects[def.id];
  if (def.repeatable && ps.timesDone >= C.IMPL.autoCarvings && !w.intents.pinned.includes(def.id)) {
    // 木雕：他自己只刻头几件，之后你置顶了才接着刻。手上刻到一半的会刻完
    if (ps.stage === 0 && ps.minutesInStage === 0 && !ps.stageStarted) return false;
  }
  const { status } = projectStatus(w, def.id);
  return status === "doing" || status === "queued";
}

/** 他挑下一件：你置顶的 → 已经开了工的 → 他自己的习惯顺序（02 第 7.4 节） */
function pickProject(w: World, mode: "afternoon" | "evening"): ProjectDef | null {
  const eligible = PROJECTS.filter((p) => projectEligible(w, p));
  const pool = mode === "evening" ? eligible.filter((p) => p.kind === "read") : eligible;
  if (pool.length === 0) return null;
  for (const id of w.intents.pinned) {
    const hit = pool.find((p) => p.id === id);
    if (hit) return hit;
  }
  // 读书主要放在晚上，下午没有别的可做才读
  const hands = mode === "afternoon" ? pool.filter((p) => p.kind !== "read") : pool;
  const from = hands.length ? hands : pool;
  const started = from.find((p) => {
    const ps = w.projects[p.id];
    return ps.stage > 0 || ps.minutesInStage > 0 || ps.stageStarted;
  });
  return started ?? from[0];
}

function projectBlock(w: World, def: ProjectDef, minutes: number, evening: boolean): Activity {
  const ps = w.projects[def.id];
  const stageLeft = def.stages[ps.stage].hours * 60 - ps.minutesInStage;
  const place: PlaceId = evening ? "armchair" : def.place;
  const label = evening ? def.doing.replace("在读", "在炉边读") : def.doing;
  return activity(
    "project",
    label,
    "project",
    [{ place, minutes: Math.min(minutes, stageLeft) }],
    { id: def.id, evening },
    true,
  );
}

function finishStage(w: World, def: ProjectDef): void {
  const ps = w.projects[def.id];
  const look = def.stages[ps.stage].look;
  ps.stage += 1;
  ps.minutesInStage = 0;
  ps.stageStarted = false;
  if (ps.stage < def.stages.length) {
    logEvent(w, "stage", `${def.name}：${look}。`, 3);
    return;
  }
  ps.timesDone += 1;
  if (def.repeatable) {
    ps.stage = 0;
    w.carvings += 1;
    logEvent(w, "projectDone", "木雕刻好了，摆在窗台上。", 3);
  } else {
    ps.done = true;
    logEvent(w, "projectDone", def.kind === "read" ? `${def.name.replace(/^读/, "读完了")}。` : `${def.name}：做完了。`, 4);
    if (def.kind === "repair") w.yearStats.repairsDone.push(def.name);
  }
  w.intents.pinned = w.intents.pinned.filter((id) => id !== def.id || def.repeatable === true);
}

function projectDecision(w: World, t: number): Activity | null {
  const d = w.today;
  if (d.mood === "thrift") return null; // 俭的时候项目先放下
  const P = C.project;
  const bad = !yardWeather(w);
  const cap = bad ? P.indoorBadWeatherCapMinutes : P.dailyCapMinutes;
  let windowEnd = 0;
  if (t >= P.afternoon[0] && t < P.afternoon[1]) windowEnd = P.afternoon[1];
  else if (bad && t >= P.badWeatherMorning[0] && t < P.badWeatherMorning[1]) windowEnd = P.badWeatherMorning[1];
  if (windowEnd && !d.projectStopped && d.projectMinutes < cap && w.minute >= d.restUntil) {
    const minutes = Math.min(P.minStintMinutes, cap - d.projectMinutes, windowEnd - t);
    const def = minutes >= 15 ? pickProject(w, "afternoon") : null;
    if (def) return projectBlock(w, def, minutes, false);
  }
  if (t >= P.evening[0] && t < bedtime(w) && d.eveningReadMinutes < P.eveningReadCapMinutes) {
    const minutes = Math.min(P.eveningReadCapMinutes - d.eveningReadMinutes, bedtime(w) - t);
    const def = minutes >= 15 ? pickProject(w, "evening") : null;
    if (def) return projectBlock(w, def, minutes, true);
  }
  return null;
}

// ---------- 菜地 ----------

function plantable(w: World, crop: CropDef, greenhouse: boolean): boolean {
  if (greenhouse) return true;
  const info = seasonOf(w.day);
  if (info.season === "winter") return false;
  const late = C.weather.yearKindParams[w.yearKind].lateSpring;
  if (info.season === "spring" && info.dayInSeason < 1 + late) return false; // 开春第 2 天化了冻才下种
  if (!crop.seasons.includes(info.season)) return false;
  return daysUntilWinter(w.day) > crop.days; // 入冬前来不及熟的不种
}

/** 归他定的格子：粮紧就种熟得快的，否则挑地里最少的那种，让菜地有点花样 */
function chooseCrop(w: World, plots: PlotState[], index: number, greenhouse: boolean): CropDef | null {
  const pref = plots[index].preferred;
  if (pref && plantable(w, CROP_BY_ID[pref], greenhouse)) return CROP_BY_ID[pref];
  const options = CROPS.filter((c) => plantable(w, c, greenhouse));
  if (options.length === 0) return null;
  if (foodDays(w) < C.supply.targetDays) return options.reduce((a, b) => (b.days < a.days ? b : a));
  const count = (id: string): number => plots.filter((p) => p.crop === id).length;
  return options.reduce((a, b) => (count(b.id) < count(a.id) ? b : a));
}

function plotYield(w: World, plot: PlotState, greenhouse: boolean): number {
  if (greenhouse) return C.garden.greenhouseYield;
  const info = seasonOf(w.day);
  const frostDays = C.weather.yearKindParams[w.yearKind].earlyFrost;
  const frost = info.season === "autumn" && info.dayInSeason >= info.seasonLength - frostDays;
  const base = CROP_BY_ID[plot.crop!].meals + (hasEffect(w, "fence") ? C.garden.fenceBonus : 0);
  return base - (frost ? C.garden.frostPenalty : 0);
}

function gardenWork(w: World): { harvest: boolean; plant: boolean } {
  let harvest = false;
  let plant = false;
  const beds: [PlotState[], boolean][] = [[w.plots, false]];
  if (hasEffect(w, "greenhouse")) beds.push([w.greenhouse, true]);
  for (const [plots, gh] of beds) {
    plots.forEach((p, i) => {
      // 粮装满了就留在地里晚几天收，不会凭空消失
      if (p.crop && p.ripe && w.stock.food + plotYield(w, p, gh) <= foodCap(w)) harvest = true;
      if (!p.crop && chooseCrop(w, plots, i, gh)) plant = true;
    });
  }
  return { harvest, plant };
}

function doGarden(w: World): void {
  const beds: [PlotState[], boolean][] = [[w.plots, false]];
  if (hasEffect(w, "greenhouse")) beds.push([w.greenhouse, true]);
  const harvested: Record<string, number> = {};
  let meals = 0;
  let planted = 0;
  for (const [plots, gh] of beds) {
    plots.forEach((p, i) => {
      if (p.crop && p.ripe) {
        const y = plotYield(w, p, gh);
        if (w.stock.food + y <= foodCap(w)) {
          addFood(w, y, gh ? "暖棚" : "菜地");
          meals += y;
          const name = CROP_BY_ID[p.crop].name;
          harvested[name] = (harvested[name] ?? 0) + 1;
          p.crop = null;
          p.ripe = false;
          w.yearStats.harvests += 1;
        }
      }
      if (!p.crop) {
        const crop = chooseCrop(w, plots, i, gh);
        if (crop) {
          p.crop = crop.id;
          p.ripe = false;
          p.daysLeft = gh
            ? seasonOf(w.day).season === "winter"
              ? C.garden.greenhouseWinterDays
              : C.garden.greenhouseDays
            : crop.days;
          planted += 1;
        }
      }
    });
  }
  const parts: string[] = [];
  const names = Object.entries(harvested).map(([name, n]) => `${n} 格${name}`);
  if (names.length) parts.push(`收了${names.join("、")}，${meals} 餐`);
  if (planted) parts.push(`下了 ${planted} 格种`);
  if (parts.length) logEvent(w, "garden", `${parts.join("；")}。`, meals ? 3 : 2);
}

// ---------- 他怎么决定下一件事（02 第 6.2 节） ----------

export function bedtime(w: World): number {
  return w.today.mood === "thrift" ? C.IMPL.thriftBedMinute : C.calendar.bedMinute;
}

function earlyRestActive(w: World, t: number): boolean {
  return w.intents.request?.kind === "earlyRest" && t >= C.calendar.earlyRestFrom;
}

/** 活计：按 02 第 5.5 节的三条线 */
function choreDecision(w: World, t: number): Activity | null {
  const d = w.today;
  const S = C.supply;
  let slot: "m" | "a" | null = null;
  if (t >= S.morningSlot[0] && t < S.morningSlot[1] && !d.morningChore) slot = "m";
  else if (
    t >= S.afternoonSlot[0] &&
    t < S.afternoonSlot[1] &&
    !d.afternoonChore &&
    (d.mood === "thrift" || (d.outingMorning && !d.morningChore))
  ) {
    slot = "a"; // 俭的时候下午也干；上午被出门占了，下午补
  }
  if (!slot) return null;
  const wn = normalWoodUse(w);
  const wd = woodDays(w);
  const fd = foodDays(w);
  if (yardWeather(w)) {
    const autumn = seasonOf(w.day).season === "autumn";
    const days = w.weather.tomorrow === "D" ? S.omenDays : S.targetDays;
    const woodTarget = autumn ? woodCap(w) : Math.min(woodCap(w), days * wn);
    const foodTarget = autumn ? foodCap(w) : Math.min(foodCap(w), days * 3);
    const wneed = w.stock.wood < woodTarget;
    const fneed = w.stock.food < foodTarget;
    if (!wneed && !fneed) return null;
    return choreActivity(w, wneed && (!fneed || wd <= fd) ? "wood" : "food", slot);
  }
  if (wd < S.tightDays && !d.eaveWood) return eaveWoodActivity();
  if (fd < S.tightDays && !d.eaveFood) return eaveFoodActivity();
  return null;
}

function smallThing(w: World, t: number): Activity | null {
  if (w.pendingCones > 0) {
    return activity("cones", "往罐里放小球果", "small", [{ place: "windowsill", minutes: C.IMPL.conesMinutes }], {}, true);
  }
  const swap = w.intents.styleSwaps[0];
  if (swap) {
    const style = STYLES.find((s) => s.id === swap.styleId);
    const place: PlaceId =
      swap.slot === "armchair" ? "armchair" : swap.slot === "deskCorner" ? "desk" : swap.slot === "scarf" ? "door" : "windowsill";
    return activity(
      "swapStyle",
      `在换${style ? style.name.replace(/^.*：/, "") : "样式"}`,
      "small",
      [{ place, minutes: C.IMPL.swapStyleMinutes }],
      {},
      true,
    );
  }
  const req = w.intents.request;
  if (req && req.kind !== "earlyRest" && t < bedtime(w) - 30) {
    if (req.kind === "tea") return activity("request", "喝茶", "small", teaPhases(w), { kind: req.kind }, true);
    if (req.kind === "windowSit") {
      return activity("request", "去窗边坐会儿", "small", [{ place: "window", minutes: 20 }], { kind: req.kind }, true);
    }
    if (req.kind === "playRecord" && hasEffect(w, "gramophone")) {
      return activity(
        "request",
        "放唱片",
        "small",
        [
          { place: "gramophone", minutes: 3, label: "在换唱片" },
          { place: "armchair", minutes: 30, label: "在听唱片" },
        ],
        { kind: req.kind },
        true,
      );
    }
  }
  return null;
}

function decide(w: World): Activity {
  const t = dayClock(w);
  const d = w.today;
  const f = w.fire;
  const s = w.stock;
  const late = t >= bedtime(w) || earlyRestActive(w, t);

  // 1. 火：先取，后用（02 第 5.6 节）。过了睡觉的点不再单独添，留给压火
  if (f.burn <= 0 && !late) {
    if (s.wood >= 1) {
      return f.ember > 0
        ? activity("tendFire", "在添柴", "necessity", [{ place: "hearth", minutes: C.IMPL.tendFireMinutes }])
        : activity("lightFire", "在生火", "necessity", [{ place: "hearth", minutes: C.IMPL.lightFireMinutes }]);
    }
    if (!d.eaveWood) return eaveWoodActivity();
  }

  // 2. 饭点。粮是零就先去起鱼笼，这顿晚一个多小时
  for (const meal of d.meals) {
    if (meal.eaten || meal.skipped) continue;
    const due = t >= meal.minute || (meal.name === "dinner" && earlyRestActive(w, t));
    if (!due) continue;
    if (meal.optional && s.ingredients <= 0 && !(s.cans > 0 && !w.intents.keepCans)) {
      meal.skipped = true;
      continue;
    }
    const source = mealSource(w);
    if (source) return mealActivity(meal, source);
    if (!d.eaveFood) return eaveFoodActivity();
    meal.skipped = true;
    d.missedMeals += 1;
  }

  // 晚上 10 点以后不开新的事：压火，睡觉
  if (late) {
    if (!d.banked) {
      return activity("bankFire", "在压火", "necessity", [{ place: "hearth", minutes: C.IMPL.bankFireMinutes }]);
    }
    const until = Math.max(60, w.dayStart + 1440 - w.minute);
    return activity("sleep", "睡着了", "sleep", [{ place: "bed", minutes: until }]);
  }

  // 3. 清晨的例行事
  if (!d.waterFetched && !hasEffect(w, "piped")) {
    return activity("fetchWater", "去泉屋提水", "necessity", [{ place: "springhouse", minutes: C.IMPL.fetchWaterMinutes }]);
  }
  if (!d.waterBoiled) {
    return activity("boilWater", "在烧水", "necessity", [{ place: "stove", minutes: C.IMPL.boilWaterMinutes }]);
  }
  if (!d.observed) {
    const place: PlaceId = yardWeather(w) ? "vane" : "instruments";
    const label = place === "vane" ? "在院里看风向标和百叶箱" : "在仪器角看气压";
    return activity("observe", label, "observe", [{ place, minutes: C.IMPL.observeMinutes }]);
  }
  if (w.actor.thirst >= C.IMPL.thirstIntervalMinutes) {
    return activity("drink", "在喝水", "necessity", [{ place: "stove", minutes: C.IMPL.drinkMinutes }], {}, true);
  }

  // 攒着的小事，插在两件事之间
  const small = smallThing(w, t);
  if (small) return small;

  // 4. 活计
  const chore = choreDecision(w, t);
  if (chore) return chore;

  // 5. 到了该收的东西
  if (yardWeather(w)) {
    const g = gardenWork(w);
    if (g.harvest || g.plant) {
      const inGreenhouse = seasonOf(w.day).season === "winter";
      const where = inGreenhouse ? "暖棚" : "菜地";
      return activity("garden", g.harvest ? `在${where}收菜` : `在${where}下种`, "chore", [
        { place: inGreenhouse ? "greenhouse" : "garden", minutes: g.harvest ? C.IMPL.harvestMinutes : C.IMPL.plantMinutes },
      ]);
    }
  }

  // 6. 手头的项目
  const project = projectDecision(w, t);
  if (project) return project;

  // 晚饭后记一笔日志
  if (!d.journal && t >= 19 * 60) {
    return activity("journal", "在写日志", "leisure", [{ place: "desk", minutes: 15 }], {}, true);
  }

  // 7、8. 闲暇
  return leisureActivity(w, t);
}

// ---------- 开始、推进、做完 ----------

function addStick(w: World): void {
  w.stock.wood -= 1;
  w.fire.burn = Math.max(0, w.fire.burn) + w.today.stickMinutes;
  w.fire.ember = C.fire.emberMinutes;
  bump(w, "烧柴");
}

/** 压火：睡前和出门前。压进去的柴当场从库存里扣（02 第 5.6 条 3、第 9.1 节） */
export function bankFire(w: World, minutes: number): number {
  const d = w.today;
  const n = Math.min(d.nightSticks, w.stock.wood);
  w.stock.wood -= n;
  bump(w, "烧柴", n);
  if (n > 0) {
    w.fire.burn = Math.max(0, w.fire.burn) + (minutes * n) / d.nightSticks;
    w.fire.ember = C.fire.emberMinutes;
  }
  return n;
}

export function startActivity(w: World, act: Activity): void {
  const d = w.today;
  const a = w.actor;
  // 要离开屋里一阵子的事，走之前先把柴添够；柴堆是空的就先去折枯枝（02 第 5.6 条 5）
  if (act.phases.some((p) => zoneOf(p.place) !== "indoor")) {
    // 多留几分钟：回来以后走到炉边、把柴添上也要时间
    const dur = totalMinutes(act) + C.IMPL.fireMarginMinutes;
    // 柴堆空着出门，回来还得再去折一趟枯枝才有柴添，这段也要算进去
    const refetch = w.stock.wood === 0 ? C.supply.eaveWoodMinutes : 0;
    if (act.kind !== "eaveWood" && w.stock.wood === 0 && w.fire.burn + C.fire.emberMinutes < dur + refetch && !d.eaveWood) {
      act = eaveWoodActivity();
    } else {
      let extra = 0;
      while (w.fire.burn + C.fire.emberMinutes < dur && w.stock.wood >= 1 && extra < C.fire.maxTopUp) {
        addStick(w);
        extra += 1;
      }
    }
  }
  switch (act.kind) {
    case "choreWood":
    case "choreFood":
      if (act.data.slot === "m") d.morningChore = true;
      else d.afternoonChore = true;
      d.didChore = true;
      break;
    case "eaveFood":
      d.eaveFood = true;
      d.didChore = true;
      break;
    case "meal": {
      // 先取：开始做饭时就从库里拿
      const src = act.data.source;
      if (src === "ingredient") w.stock.ingredients -= 1;
      else if (src === "can") w.stock.cans -= 1;
      else {
        w.stock.food -= 1;
        bump(w, "吃粮");
        if (src === "dish") w.stock.ingredients -= 1;
      }
      break;
    }
    case "project": {
      const def = PROJECT_BY_ID[act.data.id as string];
      const ps = w.projects[def.id];
      if (!ps.stageStarted) {
        // 一个阶段开工时才把这个阶段的材料拿到手边
        const need = def.stages[ps.stage].materials ?? {};
        for (const [k, n] of Object.entries(need) as [Material, number][]) w.stock.materials[k] -= n;
        ps.stageStarted = true;
      }
      break;
    }
    case "tendFire":
      // 余烬上添柴，放上去就着了
      if (w.stock.wood >= 1) addStick(w);
      break;
    case "eaveWood":
      d.eaveWood = true;
      d.didChore = true;
      // 柴堆和炉膛同时是空的：这一趟算冷启动（02 第 5.6 条 7）
      if (w.fire.burn <= 0 && w.fire.ember <= 0) act.data.cold = true;
      break;
    case "sleep":
      a.asleep = true;
      break;
    default:
      break;
  }
  a.activity = act;
  a.place = act.phases[0].place;
  a.outfit = zoneOf(a.place) === "indoor" || a.place === "springhouse" ? "indoor" : "outdoor";
}

export function complete(w: World, act: Activity): void {
  const d = w.today;
  const s = w.stock;
  switch (act.kind) {
    case "lightFire":
      if (s.wood >= 1) addStick(w);
      bump(w, "冷启动");
      logEvent(w, "fire", "炉子凉了，重新生了火。", 3);
      break;
    case "bankFire":
      bankFire(w, C.fire.nightMinutes);
      d.banked = true;
      break;
    case "sleep":
      newDay(w);
      startActivity(w, wakeActivity());
      return;
    case "fetchWater":
      d.waterFetched = true;
      leaveTrace(w, "bucket", "stove", 60);
      logEvent(w, "water", "去泉屋提了水。", 1);
      break;
    case "boilWater":
      d.waterBoiled = true;
      w.actor.thirst = 0;
      leaveTrace(w, "kettleSteam", "stove", 30);
      break;
    case "drink":
      w.actor.thirst = 0;
      break;
    case "observe":
      d.observed = true;
      logEvent(w, "observe", `记了观测：${w.weather.look}。`, 1);
      if (w.weather.tomorrow === "D") logEvent(w, "omen", "气压在掉，风向也变了，明天怕是有暴风雪。", 3);
      break;
    case "meal": {
      const meal = d.meals.find((m) => m.name === act.data.meal);
      if (meal) meal.eaten = true;
      w.actor.thirst = 0;
      bump(w, "吃饭");
      leaveTrace(w, "bowl", "armchair", 90);
      const name = MEAL_NAME[act.data.meal as keyof typeof MEAL_NAME];
      const src = act.data.source;
      if (src === "dish") logEvent(w, "meal", `${name}用架上的食材做了顿好的。`, 2);
      else if (src === "can") logEvent(w, "meal", `${name}开了一个罐头。`, 2);
      else if (src === "ingredient") logEvent(w, "meal", `${name}把架上的食材当饭吃了。`, 2);
      else logEvent(w, "meal", `吃了${name}。`, 1);
      break;
    }
    case "choreWood": {
      const n = addWood(w, C.supply.woodYield[w.weather.today as "A" | "B"] ?? C.supply.woodYield.B, "备柴");
      leaveTrace(w, "wetBoots", "door", 120);
      logEvent(w, "chore", `在林子边上锯了倒木，劈好码上，添了 ${n} 根柴。`, 3);
      break;
    }
    case "choreFood": {
      const season = seasonOf(w.day).season;
      const yieldToday = C.supply.foodYield[season][w.weather.today as "A" | "B"] ?? C.supply.foodYield[season].B;
      const n = addFood(w, yieldToday, season === "winter" ? "备粮(冬)" : "备粮(春夏秋)");
      leaveTrace(w, "wetBoots", "door", 120);
      const how = season === "winter" ? "凿了冰洞下钩，查了套索" : season === "spring" ? "下了钩，挖了些根茎" : "钓了鱼，采了些野菜根茎";
      logEvent(w, "chore", `去溪湾和林子边${how}，带回 ${n} 餐。`, 3);
      break;
    }
    case "eaveWood":
      addWood(w, C.supply.eaveWood, "折枯枝");
      logEvent(w, "eave", "抓着绳子去林带折了一捆枯枝。", 3);
      break;
    case "eaveFood":
      addFood(w, C.supply.eaveFood, "起鱼笼");
      logEvent(w, "eave", "泉屋的笼里有几条小的，收拾了。", 3);
      break;
    case "garden":
      doGarden(w);
      break;
    case "project": {
      const def = PROJECT_BY_ID[act.data.id as string];
      leaveTrace(w, "projectTools", act.phases[0].place, 120);
      if (!act.data.evening) {
        // 做满一段歇一下；也可能今天就到这儿。上限不是配额（02 第 6.2 节）
        d.restUntil = w.minute + C.IMPL.projectBreakMinutes;
        const p = d.mood === "rich" ? C.IMPL.projectStopChance.rich : C.IMPL.projectStopChance.normal;
        if (chance(w.rng.actor, p)) d.projectStopped = true;
      }
      if (def.kind === "read") leaveTrace(w, "openBook", act.phases[0].place, 120);
      break;
    }
    case "cones": {
      const n = w.pendingCones;
      w.pendingCones = 0;
      w.jar.cones += n;
      while (w.jar.cones >= C.shares.conesPerJar) {
        w.jar.cones -= C.shares.conesPerJar;
        w.jar.fullJars += 1;
      }
      bump(w, "小球果", n);
      logEvent(w, "cones", `往窗台的罐里放了 ${n} 颗小球果。`, 2);
      break;
    }
    case "swapStyle": {
      const swap = w.intents.styleSwaps.shift();
      if (swap) {
        w.styles[swap.slot] = swap.styleId;
        const style = STYLES.find((x) => x.id === swap.styleId);
        logEvent(w, "style", `换上了${style ? style.name : "原来的样子"}。`, 2);
      }
      break;
    }
    case "request": {
      const kind = act.data.kind;
      if (w.intents.request?.kind === kind) w.intents.request = null;
      w.actor.thirst = kind === "tea" ? 0 : w.actor.thirst;
      if (kind === "tea") leaveTrace(w, "cup", "armchair", 60);
      logEvent(w, "request", kind === "tea" ? "泡了杯茶。" : kind === "windowSit" ? "去窗边坐了会儿。" : "放了张唱片。", 2);
      break;
    }
    case "journal":
      d.journal = true;
      leaveTrace(w, "openJournal", "desk", 180);
      logEvent(w, "journal", "记了今天的日志。", 1);
      break;
    case "leisure":
      if (act.data.id === "tea") {
        w.actor.thirst = 0;
        leaveTrace(w, "cup", "armchair", 60);
      }
      if (act.data.id === "readIdle") leaveTrace(w, "openBook", act.phases[0].place, 120);
      logEvent(w, "leisure", act.data.text as string, 1);
      break;
    default:
      break;
  }
}

/** 当前活动走一分钟。做完了就把它返回，由 stepMinute 在钟走过这一分钟以后结算。 */
function tick(w: World): Activity | null {
  const a = w.actor;
  const act = a.activity!;
  if (!a.asleep) a.thirst += 1;
  bump(w, `时间:${act.category}`);
  if (act.kind === "project") {
    const def = PROJECT_BY_ID[act.data.id as string];
    const ps = w.projects[def.id];
    ps.minutesInStage += 1;
    bump(w, "项目分钟");
    if (act.data.evening) w.today.eveningReadMinutes += 1;
    else w.today.projectMinutes += 1;
    if (ps.minutesInStage >= def.stages[ps.stage].hours * 60) {
      finishStage(w, def);
      act.left = 1;
      act.phase = act.phases.length - 1;
    }
  }
  act.left -= 1;
  if (act.left > 0) return null;
  act.phase += 1;
  if (act.phase < act.phases.length) {
    act.left = act.phases[act.phase].minutes;
    a.place = act.phases[act.phase].place;
    a.outfit = zoneOf(a.place) === "indoor" || a.place === "springhouse" ? "indoor" : "outdoor";
    return null;
  }
  a.activity = null;
  return act;
}

/** doing 是这一分钟里他在做的事。醒来发现炉子凉了、去抱柴、生火，这几段记成冷启动，不算断火。 */
function burnFire(w: World, doing: Activity | null): void {
  const f = w.fire;
  if (f.burn > 0) f.burn -= 1;
  else if (f.ember > 0) f.ember -= 1;
  else {
    const coldStart =
      doing?.kind === "lightFire" ||
      doing?.kind === "wake" ||
      (doing?.kind === "eaveWood" && doing.data.cold === true) ||
      (doing?.kind === "sleep" && doing.data.collapsed === true);
    bump(w, w.actor.away ? "离家时无火分钟" : coldStart ? "冷启动分钟" : "无火分钟");
  }
}

/** 世界往前走一个游戏分钟。人被你带出门时，家里只有炉火在烧。 */
export function stepMinute(w: World): void {
  const a = w.actor;
  let finished: Activity | null = null;
  let doing: Activity | null = null;
  if (!a.away) {
    if (!a.activity && !a.leaving) startActivity(w, decide(w));
    doing = a.activity;
    if (doing) finished = tick(w);
  }
  burnFire(w, doing);
  w.minute += 1;
  if (finished) complete(w, finished);
  // 做完一件马上定下一件，界面上不会出现「什么也没在做」的空档
  if (!a.away && !a.activity && !a.leaving) startActivity(w, decide(w));
}

export function advanceMinutes(w: World, minutes: number): void {
  for (let i = 0; i < minutes; i++) stepMinute(w);
}

/** 当前动作卡上的字 */
export function actionLabel(w: World): string {
  const act = w.actor.activity;
  if (!act) return w.actor.away ? "出门了" : "";
  return act.phases[act.phase].label ?? act.label;
}

export function fireLook(w: World): "out" | "ember" | "low" | "mid" | "high" {
  if (w.fire.burn <= 0) return w.fire.ember > 0 ? "ember" : "out";
  const tier = w.today.woodTier;
  return tier === "thrift" ? "low" : tier === "rich" ? "high" : "mid";
}

