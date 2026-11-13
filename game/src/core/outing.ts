// 出门和回家：02 第 9 节、第 14.3–14.5 条。这里只管事实（库存、炉火、人在哪），
// 野外的地图、采集、身体状态还没有做；现在的野外只有「离家门几分钟」这一个量。
import { CONFIG } from "./config.ts";
import { seasonOf } from "./calendar.ts";
import { zoneOf } from "./content.ts";
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
import { bump, dayClock, type World } from "./state.ts";

const O = CONFIG.outing;

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

/** 真的出门：收尾（世界钟照走）、扣行囊、压火。出不了门时什么都不扣。 */
export function depart(w: World, pack: { rations: number; bundles: number }): OutingCheck {
  const check = checkOuting(w);
  if (!check.ok) return check;
  if (pack.rations > check.maxRations || pack.bundles > check.maxBundles || pack.rations < 0 || pack.bundles < 0) {
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
  w.stock.wood -= pack.bundles * O.sticksPerBundle;
  bump(w, "行囊带走的粮", pack.rations);
  bump(w, "行囊带走的柴", pack.bundles * O.sticksPerBundle);
  bankFire(w, O.bankMinutes);
  if (dayClock(w) < CONFIG.supply.morningSlot[1] && !w.today.morningChore) w.today.outingMorning = true;
  w.actor.away = true;
  w.actor.place = "wild";
  w.actor.outfit = "outdoor";
  w.outing = {
    area: null,
    minutesFromDoor: 0,
    rations: pack.rations,
    bundles: pack.bundles,
    departedAt: w.minute,
    reminded: { dusk: false, night: false, late: false },
  };
  w.yearStats.outings += 1;
  bump(w, "出门");
  const carried = [pack.rations ? `${pack.rations} 份干粮` : "", pack.bundles ? `${pack.bundles} 捆柴` : ""].filter(Boolean);
  logEvent(w, "outing", carried.length ? `压好火出门了，带了${carried.join("、")}。` : "压好火出门了。", 3);
  return check;
}

/** 人在外面时每个游戏分钟要看的事：到饭点吃干粮，午夜撑不住。返回 true 表示昏倒了。 */
export function outingMinute(w: World): boolean {
  const o = w.outing;
  if (!o) return false;
  const t = dayClock(w);
  for (const meal of w.today.meals) {
    if (meal.eaten || meal.skipped || t < meal.minute) continue;
    if (o.rations > 0) {
      o.rations -= 1;
      meal.eaten = true;
      bump(w, "吃饭");
    } else {
      // 没带干粮：这顿在外面没吃上。算不算缺餐是暂行的做法，见 IMPL.outingMealWithoutRationsIsMissed
      meal.skipped = true;
      if (CONFIG.IMPL.outingMealWithoutRationsIsMissed) w.today.missedMeals += 1;
    }
  }
  if (t >= O.collapseMinute) {
    collapse(w);
    return true;
  }
  return false;
}

/** 路程是时间往前跳一段，不用一步步走（02 第 9.2 节）。返回 false 表示路上昏倒了。 */
export function travel(w: World, minutes: number, toward: "home" | "out"): boolean {
  for (let i = 0; i < minutes; i++) {
    if (!w.outing) return false;
    stepMinute(w);
    w.outing.minutesFromDoor = Math.max(0, w.outing.minutesFromDoor + (toward === "home" ? -1 : 1));
    if (outingMinute(w)) return false;
  }
  return true;
}

/** 走回家门：背包入库，换回便服 */
export function arriveHome(w: World): void {
  const o = w.outing;
  if (!o) return;
  // 装不下的部分不入库，也不记进来源（账要对得上）
  const food = Math.max(0, Math.min(o.rations, foodCap(w) - w.stock.food));
  const wood = Math.max(0, Math.min(o.bundles * O.sticksPerBundle, woodCap(w) - w.stock.wood));
  w.stock.food += food;
  w.stock.wood += wood;
  bump(w, "带回的粮", food);
  bump(w, "带回的柴", wood);
  w.outing = null;
  w.actor.away = false;
  w.actor.place = "door";
  w.actor.outfit = "indoor";
  if (w.fire.burn <= 0 && w.fire.ember <= 0) bump(w, "回家时火已经灭了");
  logEvent(w, "outing", "回到家了。", 3);
}

/** 昏倒：在家里的床上醒来，已经是第二天早上；柴粮丢一部分（02 第 9.7 节） */
export function collapse(w: World): void {
  const o = w.outing;
  if (!o) return;
  const keep = 1 - CONFIG.IMPL.collapseLossRatio;
  const rations = Math.floor(o.rations * keep);
  const wood = Math.floor(o.bundles * keep) * O.sticksPerBundle;
  w.stock.food = Math.min(foodCap(w), w.stock.food + rations);
  w.stock.wood = Math.min(woodCap(w), w.stock.wood + wood);
  w.outing = null;
  w.actor.away = false;
  w.actor.place = "bed";
  w.actor.outfit = "indoor";
  bump(w, "昏倒");
  logEvent(w, "collapse", "夜里在外面撑不住了。醒来已经在自己的床上。", 4);
  const until = Math.max(1, w.dayStart + 1440 - w.minute);
  // 这一夜炉子是凉的，记成冷启动：醒来他先生火，没有别的惩罚
  startActivity(w, activity("sleep", "睡着了", "sleep", [{ place: "bed", minutes: until }], { collapsed: true }));
}

export type HomeReminder = "dusk" | "night" | "late";

export const REMINDER_TEXT: Record<HomeReminder, string> = {
  dusk: "天色不早了，该往回走了。",
  night: "天黑了，更冷，也看不清路。",
  late: "夜深了，再不回去撑不到天亮。",
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
