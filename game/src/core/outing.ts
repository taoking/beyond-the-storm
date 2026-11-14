// 出门和回家：02 第 9 节、第 14.3–14.5 条。出门、野外的一分钟（身体、饭点、昏倒、返家提示）、回家和昏倒的收账。
// 区域里怎么走、怎么采在 wild.ts；野外的时间只随动作走，所有动作的时间都从 outdoorMinute 过。
import { CONFIG } from "./config.ts";
import { seasonOf } from "./calendar.ts";
import { MATERIAL_NAME, zoneOf, type Goods, type Material } from "./content.ts";
import {
  activity,
  bankFire,
  foodCap,
  logEvent,
  normalWoodUse,
  remainingMinutes,
  startActivity,
  stepMinute,
  woodCap,
} from "./sim.ts";
import { bump, dayClock, type Bag, type Body, type WildAct, type World } from "./state.ts";

const O = CONFIG.outing;
const W = CONFIG.IMPL.wild;

export type OutingRefusal = "blizzard" | "asleep" | "far" | "busy" | "away" | "overPack";

export const REFUSAL_TEXT: Record<OutingRefusal, string> = {
  blizzard: "这天气出不去。",
  asleep: "已经歇下了，天亮再走。",
  far: "还在外面，等回来再出门。",
  busy: "手头的事还要一阵，做完再走。",
  away: "已经在外面了。",
  overPack: "带不了这么多，家里得留够三天的。",
};

export interface OutingCheck {
  ok: boolean;
  reason?: OutingRefusal;
  /** 出门前要收尾的游戏分钟 */
  wrapUp: number;
  /** 行囊下限：柴、粮各自只能拿走够用 3 天以上的部分 */
  maxRations: number;
  maxBundles: number;
}

export function checkOuting(w: World): OutingCheck {
  const maxRations = Math.max(0, Math.floor(w.stock.food - O.packFloorDays * 3));
  const maxBundles = Math.max(0, Math.floor((w.stock.wood - O.packFloorDays * normalWoodUse(w)) / O.sticksPerBundle));
  const base = { wrapUp: 0, maxRations, maxBundles };
  if (w.actor.away) return { ok: false, reason: "away", ...base };
  if (w.weather.today === "D") return { ok: false, reason: "blizzard", ...base };
  const act = w.actor.activity;
  if (w.actor.asleep || act?.kind === "sleep") return { ok: false, reason: "asleep", ...base };
  const zone = zoneOf(w.actor.place);
  if (zone !== "indoor" && zone !== "yard") return { ok: false, reason: "far", ...base };
  let wrapUp = 0;
  if (act && !act.interruptible) {
    wrapUp = remainingMinutes(act);
    // 这件事后面还要去远处的，也不能当成半小时内能收尾
    const goesFar = act.phases.slice(act.phase).some((p) => !["indoor", "yard"].includes(zoneOf(p.place)));
    if (goesFar) return { ok: false, reason: "far", ...base, wrapUp };
    if (wrapUp > O.maxWrapUpMinutes) return { ok: false, reason: "busy", ...base, wrapUp };
  }
  return { ok: true, ...base, wrapUp };
}

/** 背包占几格：同类堆叠，干粮、柴、每样素材各算各的（02 第 9.3 节） */
export function bagSlots(rations: number, bag: Bag): number {
  let n = Math.ceil(rations / O.rationsPerSlot);
  for (const [k, v] of Object.entries(bag) as [Goods, number][]) {
    if (!v) continue;
    const per = k === "wood" ? O.woodPerSlot : k === "ingredients" || k === "fuel" || k === "cans" ? W.otherPerSlot : O.materialsPerSlot;
    n += Math.ceil(v / per);
  }
  return n;
}

/** 真的出门：收尾（世界钟照走）、扣行囊、压火。出不了门时什么都不扣。 */
export function depart(w: World, pack: { rations: number; bundles: number }): OutingCheck {
  const check = checkOuting(w);
  if (!check.ok) return check;
  const wood = pack.bundles * O.sticksPerBundle;
  if (
    pack.rations > check.maxRations || pack.bundles > check.maxBundles || pack.rations < 0 || pack.bundles < 0 ||
    !Number.isInteger(pack.rations) || !Number.isInteger(pack.bundles) || bagSlots(pack.rations, { wood }) > O.bagSlots
  ) {
    return { ...check, ok: false, reason: "overPack" };
  }
  const act = w.actor.activity;
  if (act && !act.interruptible) {
    // 必要的事做完再走；这段时间世界照常走
    let guard = O.maxWrapUpMinutes + 1;
    w.actor.leaving = true;
    while (w.actor.activity === act && guard-- > 0) stepMinute(w);
    w.actor.leaving = false;
  }
  w.actor.activity = null;
  w.stock.food -= pack.rations;
  w.stock.wood -= wood;
  bump(w, "行囊带走的粮", pack.rations);
  bump(w, "行囊带走的柴", wood);
  bankFire(w, O.bankMinutes);
  if (dayClock(w) < CONFIG.supply.morningSlot[1] && !w.today.morningChore) w.today.outingMorning = true;
  w.actor.away = true;
  w.actor.place = "wild";
  w.actor.outfit = "outdoor";
  w.outing = {
    area: null,
    pos: null,
    minutesFromDoor: 0,
    rations: pack.rations,
    bag: wood ? { wood } : {},
    body: fullBody(),
    campfire: null,
    last: null,
    departedAt: w.minute,
    reminded: { dusk: false, night: false, late: false, cold: false, tired: false },
  };
  w.yearStats.outings += 1;
  bump(w, "出门");
  const carried = [pack.rations ? `${pack.rations} 份干粮` : "", pack.bundles ? `${pack.bundles} 捆柴` : ""].filter(Boolean);
  logEvent(w, "outing", carried.length ? `压好火出门了，带了${carried.join("、")}。` : "压好火出门了。", 3);
  return check;
}

export function fullBody(): Body {
  return { warmth: W.bodyMax, stamina: W.bodyMax, health: W.bodyMax };
}

export type CollapseCause = "cold" | "tired" | "midnight";

/** 野外的一分钟里值得告诉你的事。不是世界里发生的事，不进手记（昏倒除外，它在 collapse 里记） */
export type OutdoorNote =
  | { kind: "reminder"; reminder: HomeReminder }
  | { kind: "warning"; warning: "cold" | "tired" }
  | { kind: "collapse"; cause: CollapseCause };

const clamp = (n: number): number => Math.max(0, Math.min(W.bodyMax, n));

/** 天黑了没有：当季的天黑钟点以后，到第二天清晨 */
export function isDark(w: World): boolean {
  const t = dayClock(w);
  return t >= O.dusk[seasonOf(w.day).season] || t % 1440 < CONFIG.calendar.wakeMinute;
}

/** 他身边有没有点着的篝火（同一格或相邻） */
export function nearFire(w: World): boolean {
  const o = w.outing;
  const f = o?.campfire;
  if (!o || !f || !o.pos || f.area !== o.area || f.until <= w.minute) return false;
  return Math.abs(f.x - o.pos.x) + Math.abs(f.y - o.pos.y) <= 1;
}

function tickBody(w: World, act: WildAct): void {
  const o = w.outing!;
  const b = o.body;
  const tier = w.weather.today === "D" ? "C" : w.weather.today;
  if (nearFire(w)) b.warmth = clamp(b.warmth + W.fireWarmth);
  else b.warmth = clamp(b.warmth - W.chill[seasonOf(w.day).season][tier] - (isDark(w) ? W.nightChill : 0));
  if (b.warmth <= 0) b.health = clamp(b.health - W.frostbite);
  b.stamina = clamp(b.stamina - W.stamina[act]);
}

/**
 * 人在外面的一个游戏分钟：野外所有花时间的动作（走一格、采、歇、生火、吃、区域之间的路）都从这里过。
 * 家里照常走一分钟（他不在家，只有炉火在烧），到饭点吃干粮，身体按这一分钟在做的事变化，
 * 然后看要不要昏倒、要不要提一句回家。昏倒以后 w.outing 是 null。
 */
export function outdoorMinute(w: World, act: WildAct): OutdoorNote[] {
  const notes: OutdoorNote[] = [];
  if (!w.outing) return notes;
  stepMinute(w);
  const o = w.outing;
  o.last = act;
  const t = dayClock(w);
  for (const meal of w.today.meals) {
    if (meal.eaten || meal.skipped || t < meal.minute) continue;
    if (o.rations > 0) {
      o.rations -= 1;
      meal.eaten = true;
      o.body.stamina = clamp(o.body.stamina + W.rationStamina);
      bump(w, "吃饭");
    } else {
      // 没带干粮：这顿在外面没吃上，体力也就没补上。算不算缺餐是暂行的做法，见 IMPL.outingMealWithoutRationsIsMissed
      meal.skipped = true;
      if (CONFIG.IMPL.outingMealWithoutRationsIsMissed) w.today.missedMeals += 1;
    }
  }
  tickBody(w, act);
  const b = o.body;
  const cause: CollapseCause | null =
    b.health <= 0 ? "cold" : b.stamina <= 0 ? "tired" : t >= O.collapseMinute ? "midnight" : null;
  if (cause) {
    collapse(w, cause);
    notes.push({ kind: "collapse", cause });
    return notes;
  }
  const r = takeHomeReminder(w);
  if (r) notes.push({ kind: "reminder", reminder: r });
  if (b.warmth >= W.coldWarning) o.reminded.cold = false;
  else if (!o.reminded.cold) {
    o.reminded.cold = true;
    notes.push({ kind: "warning", warning: "cold" });
  }
  if (b.stamina >= W.tiredWarning) o.reminded.tired = false;
  else if (!o.reminded.tired) {
    o.reminded.tired = true;
    notes.push({ kind: "warning", warning: "tired" });
  }
  return notes;
}

/** 连着花几个游戏分钟做同一件事。each 在每一分钟之后调用（人还在外面时）。返回 false 表示中途昏倒了 */
export function spendOutdoor(w: World, minutes: number, act: WildAct, notes: OutdoorNote[], each?: () => void): boolean {
  for (let i = 0; i < minutes; i++) {
    notes.push(...outdoorMinute(w, act));
    if (!w.outing) return false;
    each?.();
  }
  return true;
}

/** 回家和昏倒共用的收账。keep 是普通物资（柴、干粮、食材）留下的比例；燃油、罐头、素材全留 */
function settle(w: World, keep: number): void {
  const o = w.outing!;
  const bag = o.bag;
  const kept = (n: number | undefined): number => Math.floor((n ?? 0) * keep);
  // 装不下的部分不入库，也不记进来源（账要对得上）
  const put = (have: number, cap: number, n: number): number => Math.max(0, Math.min(n, cap - have));
  const food = put(w.stock.food, foodCap(w), kept(o.rations));
  const wood = put(w.stock.wood, woodCap(w), kept(bag.wood));
  const ingredients = put(w.stock.ingredients, CONFIG.stock.ingredientCap, kept(bag.ingredients));
  const fuel = put(w.stock.fuel, CONFIG.stock.fuelCap, bag.fuel ?? 0);
  const cans = put(w.stock.cans, CONFIG.stock.canCap, bag.cans ?? 0);
  w.stock.food += food;
  w.stock.wood += wood;
  w.stock.ingredients += ingredients;
  w.stock.fuel += fuel;
  w.stock.cans += cans;
  bump(w, "带回的粮", food);
  bump(w, "带回的柴", wood);
  if (ingredients) bump(w, "带回的食材", ingredients);
  if (fuel) bump(w, "带回的燃油", fuel);
  if (cans) bump(w, "带回的罐头", cans);
  for (const m of Object.keys(MATERIAL_NAME) as Material[]) {
    const n = bag[m] ?? 0;
    if (!n) continue;
    w.stock.materials[m] += n;
    bump(w, `带回的素材:${m}`, n);
  }
  w.outing = null;
  w.actor.away = false;
  w.actor.outfit = "indoor";
}

/** 走回家门：背包入库，换回便服 */
export function arriveHome(w: World): void {
  if (!w.outing) return;
  settle(w, 1);
  w.actor.place = "door";
  if (w.fire.burn <= 0 && w.fire.ember <= 0) bump(w, "回家时火已经灭了");
  logEvent(w, "outing", "回到家了。", 3);
}

const COLLAPSE_TEXT: Record<CollapseCause, string> = {
  cold: "在外面冻得撑不住了。醒来已经在自己的床上。",
  tired: "在外面累得走不动了。醒来已经在自己的床上。",
  midnight: "夜里在外面撑不住了。醒来已经在自己的床上。",
};

/** 昏倒：在家里的床上醒来，已经是第二天早上；柴粮丢一部分，素材不丢（02 第 9.7 节） */
export function collapse(w: World, cause: CollapseCause): void {
  if (!w.outing) return;
  settle(w, 1 - CONFIG.IMPL.collapseLossRatio);
  w.actor.place = "bed";
  bump(w, "昏倒");
  bump(w, `昏倒:${cause}`);
  logEvent(w, "collapse", COLLAPSE_TEXT[cause], 4);
  const until = Math.max(1, w.dayStart + 1440 - w.minute);
  // 这一夜炉子是凉的，记成冷启动：醒来他先生火，没有别的惩罚
  startActivity(w, activity("sleep", "睡着了", "sleep", [{ place: "bed", minutes: until }], { collapsed: true, cause }));
}

export type HomeReminder = "dusk" | "night" | "late";

export const REMINDER_TEXT: Record<HomeReminder, string> = {
  dusk: "天色不早了，该往回走了。",
  night: "天黑了，更冷，也看不清路。",
  late: "夜深了，再不回去撑不到天亮。",
};

export const WARNING_TEXT: Record<"cold" | "tired", string> = {
  cold: "冷得厉害了。找个生火点烤烤火，或者往回走。",
  tired: "走累了。歇一歇，或者吃点干粮。",
};

/**
 * 该不该提一句回家（02 第 14.5 条）：按天色、回程要多久加半小时余量来定，
 * 一趟里每种只提一次，不是固定弹三条。调用一次就记为提过。
 */
export function takeHomeReminder(w: World): HomeReminder | null {
  const o = w.outing;
  if (!o) return null;
  const t = dayClock(w);
  const dusk = O.dusk[seasonOf(w.day).season];
  const eta = o.minutesFromDoor + O.homeMarginMinutes;
  if (!o.reminded.late && t >= O.lateWarningMinute) {
    o.reminded.late = o.reminded.night = o.reminded.dusk = true;
    return "late";
  }
  if (!o.reminded.night && t >= dusk) {
    o.reminded.night = o.reminded.dusk = true;
    return "night";
  }
  if (!o.reminded.dusk && t + eta >= dusk) {
    o.reminded.dusk = true;
    return "dusk";
  }
  return null;
}
