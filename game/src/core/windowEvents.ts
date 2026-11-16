// 窗外的小事（03 第 10.4 节）：鸟落在窗沿、远处林边的鹿、南飞的大雁、冬夜的极光。
// 不给奖励、不用点、不弹出来，只是偶尔抬头时看到世界还在动。首版四种（03 第 0 节「3–4 种」）。
//
// - 什么时候发生：每个世界日他起床以后，按「世界种子 + 第几天」各掷一次，看这一季、这天的天气（档和样子）、钟点。
//   用的是这里单独的随机（不存状态，同一个种子同一天永远一样），不碰世界的天气、人、样子三条随机流，
//   所以加上它以后世界里别的事一件也不变。
// - 发生了就是世界事实：stage.windowEvent 给画面（氛围态里没有，那是冻结的选择）。
// - 他看见了才进手记（他醒着、在家；窗沿的鸟要他在观测间）。第一次看见的记成这天的要事，也进这一年的年册；
//   以后再看见只记一笔日常。他手头是闲暇或观测，就「看了一会儿」：只是手记里的一句，不改他在做的事。
// - 他没看见（睡着、出门、窗沿的鸟他不在观测间）就不记，画面上照样有。
import { CONFIG } from "./config.ts";
import { seasonOf } from "./calendar.ts";
import { makeRng, next, type Rng } from "./rng.ts";
import { logEvent } from "./sim.ts";
import type { WindowEvent, WindowEventsState, WindowKind, World } from "./state.ts";

const WIN = CONFIG.IMPL.window;

/** 手记、年册里的叫法，也是界面上显示的顺序 */
export const WINDOW_KINDS: WindowKind[] = ["bird", "deer", "geese", "aurora"];
export const WINDOW_NAME: Record<WindowKind, string> = {
  bird: "窗沿的小鸟",
  deer: "林边的鹿",
  geese: "南飞的大雁",
  aurora: "极光",
};

/** 掷的先后：少见的先占位置（一天最多 maxPerDay 件、彼此不重叠） */
const ROLL_ORDER: WindowKind[] = ["aurora", "geese", "deer", "bird"];

/** 第一次看见 / 以后再看见，手记里的一句（不带句号，看了一会儿时接在后面） */
const TEXT: Record<WindowKind, { first: string; again: string }> = {
  bird: { first: "窗沿上落了只小鸟", again: "窗沿上又来了只鸟" },
  deer: { first: "远处林子边上站着一头鹿", again: "林子边上又见到了鹿" },
  geese: { first: "一队大雁往南飞过去了", again: "又有一队大雁往南去了" },
  aurora: { first: "夜里天上起了极光", again: "夜里又有极光" },
};

export function emptyWindowEvents(): WindowEventsState {
  return { day: -1, plan: [], firsts: {} };
}

/** 这一天单独的随机：只看种子和第几天，不存状态 */
export function windowRng(seed: number, day: number): Rng {
  let h = Math.imul((seed ^ 0x51ed270b) >>> 0, 0x9e3779b1) ^ Math.imul(day + 1, 0x85ebca6b);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return makeRng(h);
}

/**
 * 排这一天的窗外小事。只读世界（种子、第几天、起床的时刻、今天的天气），不改它。
 * 每一种不管条件合不合都掷三次（机会、时刻、长短），这样哪天的条件变了也不影响别的种类。
 */
export function planWindowDay(w: World): WindowEvent[] {
  const info = seasonOf(w.day);
  const r = windowRng(w.seed, w.day);
  const plan: WindowEvent[] = [];
  for (const kind of ROLL_ORDER) {
    const def = WIN.kinds[kind];
    const roll = next(r);
    const at = next(r);
    const len = next(r);
    if (plan.length >= WIN.maxPerDay) continue;
    if (!def.tiers.includes(w.weather.today) || !def.looks.includes(w.weather.look)) continue;
    if (def.autumnDays !== undefined && info.season === "autumn" && info.dayInSeason >= def.autumnDays) continue;
    if (roll >= def.chance[info.season]) continue;
    const clock = def.from + Math.floor(at * (def.to - def.from));
    const minutes = def.minutes[0] + Math.floor(len * (def.minutes[1] - def.minutes[0] + 1));
    const start = w.dayStart + clock - CONFIG.calendar.wakeMinute;
    const end = start + minutes;
    if (plan.some((e) => start < e.end && e.start < end)) continue;
    plan.push({ kind, start, end, seen: false, watched: false });
  }
  return plan.sort((a, b) => a.start - b.start);
}

/** 这一分钟窗外正在发生的那一件；没有是 null */
export function activeWindowEvent(w: World): WindowEvent | null {
  const st = w.windowEvents;
  if (!st) return null;
  return st.plan.find((e) => e.start <= w.minute && w.minute < e.end) ?? null;
}

/** 他这一分钟看不看得见这一种 */
export function canSee(w: World, kind: WindowKind): boolean {
  const a = w.actor;
  if (a.away || a.asleep || a.activity?.kind === "sleep") return false;
  if (WIN.kinds[kind].seenAt === "observation") return WIN.observationPlaces.includes(a.place);
  return true;
}

/**
 * 世界每走一分钟调一次（sim.stepMinute 的末尾）：换了一天就排新的一天；正在发生的那件他头一回看见就记进手记。
 * 不抽世界的随机数，不改他在做的事。
 */
export function windowTick(w: World): void {
  const st = (w.windowEvents ??= emptyWindowEvents());
  if (st.day !== w.day) {
    st.plan = st.plan.filter((e) => e.end > w.minute).concat(planWindowDay(w));
    st.day = w.day;
  }
  if (st.plan.length && st.plan[0].end <= w.minute) st.plan = st.plan.filter((e) => e.end > w.minute);
  const e = activeWindowEvent(w);
  if (!e || e.seen || !canSee(w, e.kind)) return;
  e.seen = true;
  const cat = w.actor.activity?.category;
  e.watched = cat === "leisure" || cat === "observe";
  const first = st.firsts[e.kind] === undefined;
  const base = first ? TEXT[e.kind].first : TEXT[e.kind].again;
  const text = e.watched ? `${base}，看了一会儿。` : `${base}。`;
  if (first) {
    st.firsts[e.kind] = w.day;
    (w.yearStats.firstSights ??= []).push(e.kind);
  }
  logEvent(w, "window", text, first ? 3 : 1);
}

export interface WindowEventView {
  kind: WindowKind;
  name: string;
  /** 这一件的编号（开始的绝对分钟）：画面拿它定位置、队形，同一件画成一样 */
  seed: number;
  /** 0–1，走到哪了 */
  progress: number;
  /** 他看见了没有（手记里有没有这一笔） */
  seen: boolean;
  /** 他停下来看了一会儿（只是手记里的说法，他手头的事没变） */
  watched: boolean;
}

export function windowEventView(w: World): WindowEventView | null {
  const e = activeWindowEvent(w);
  if (!e) return null;
  return {
    kind: e.kind,
    name: WINDOW_NAME[e.kind],
    seed: e.start,
    progress: (w.minute - e.start) / (e.end - e.start),
    seen: e.seen,
    watched: e.watched,
  };
}

/** 第一次看见的那几样，年册的一句；一样也没有就是空串 */
export function firstSightsLine(kinds: readonly WindowKind[] | undefined): string {
  const names = (kinds ?? []).map((k) => WINDOW_NAME[k]);
  if (names.length === 0) return "";
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join("、")}和${names[names.length - 1]}`;
  return `第一次看见${list}。`;
}
