// 野外的区域：在地图上走、采、歇、吃、生火，在院门外和区域之间来回（02 第 9.2–9.4 节）。
// 区域本身是 content.ts 里的数据，这里是读它的通用规则。每个动作先查能不能做（做不了什么都不改），
// 再把要花的游戏分钟交给 outing.ts 的 outdoorMinute，最后才生效：中途昏倒的，这个动作就没做成。
import { seasonOf } from "./calendar.ts";
import { CONFIG } from "./config.ts";
import { AREA_BY_ID, GOODS_NAME, type AreaDef, type Goods, type NodeDef } from "./content.ts";
import { arriveHome, bagSlots, spendOutdoor, type OutdoorNote } from "./outing.ts";
import { logEvent, woodCap } from "./sim.ts";
import { bump, type OutingState, type World } from "./state.ts";

const W = CONFIG.IMPL.wild;
const O = CONFIG.outing;

export type WildAction =
  | { type: "move"; dx: number; dy: number }
  | { type: "walkTo"; x: number; y: number }
  | { type: "gather"; node: string }
  | { type: "rest" }
  | { type: "eat" }
  | { type: "fire" }
  /** 去一个区域（在院门外时），或者回家（在院门外，或站在区域的回家出口上） */
  | { type: "travel"; to: string };

export interface WildResult {
  ok: boolean;
  reason?: string;
  /** 这个动作花掉的游戏分钟（中途昏倒的，算到昏倒那一分钟；不含昏倒后在床上睡的） */
  minutes: number;
  notes: OutdoorNote[];
}

type Pos = { x: number; y: number };

const refuse = (reason: string): WildResult => ({ ok: false, reason, minutes: 0, notes: [] });

export function passable(area: AreaDef, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && y >= 0 && y < area.map.length && x >= 0 && x < area.map[y].length && area.map[y][x] !== "#";
}

const dist = (a: Pos, b: Pos): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** 从 from 走到任意一个满足 goal 的格子的最短路（不含起点）；走不到是 null */
export function pathTo(area: AreaDef, from: Pos, goal: (p: Pos) => boolean): Pos[] | null {
  if (goal(from)) return [];
  const key = (p: Pos): string => `${p.x},${p.y}`;
  const prev = new Map<string, Pos | null>([[key(from), null]]);
  const queue: Pos[] = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: cur.x + dx, y: cur.y + dy };
      if (!passable(area, next.x, next.y) || prev.has(key(next))) continue;
      prev.set(key(next), cur);
      if (goal(next)) {
        const path: Pos[] = [];
        for (let p: Pos | null = next; p && key(p) !== key(from); p = prev.get(key(p)) ?? null) path.unshift(p);
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

const onHomeExit = (area: AreaDef, p: Pos): boolean => area.exits.some((e) => e.to === "home" && e.x === p.x && e.y === p.y);

/** 从区域里这一格走回家门要几个游戏分钟：走到回家出口，再加路程 */
export function minutesToDoor(area: AreaDef, p: Pos): number {
  const path = pathTo(area, p, (q) => onHomeExit(area, q));
  return area.homeMinutes + (path ? path.length : 0) * W.stepMinutes;
}

function here(w: World): { o: OutingState; area: AreaDef; pos: Pos } | null {
  const o = w.outing;
  const area = o?.area ? AREA_BY_ID[o.area] : undefined;
  if (!o || !area || !o.pos) return null;
  return { o, area, pos: o.pos };
}

/** 一个资源点现在还剩多少能拿；0 是这会儿没有（季节不对、还没恢复、拿完了） */
export function nodeAvailable(w: World, node: NodeDef): number {
  if (node.seasons && !node.seasons.includes(seasonOf(w.day).season)) return 0;
  const rule = W.gather[node.kind];
  if (rule.regrowDays === null) return Math.max(0, (node.total ?? 0) - (w.wild.taken[node.id] ?? 0));
  const last = w.wild.harvested[node.id];
  return last === undefined || w.day - last >= rule.regrowDays ? rule.amount : 0;
}

/** 家里放得下的余量：有上限的东西，家里的加上背包里的不能超过上限（满了就留在原地） */
function homeRoom(w: World, o: OutingState, goods: Goods): number {
  const carried = o.bag[goods] ?? 0;
  switch (goods) {
    case "wood":
      return woodCap(w) - w.stock.wood - carried;
    case "ingredients":
      return CONFIG.stock.ingredientCap - w.stock.ingredients - carried;
    case "fuel":
      return CONFIG.stock.fuelCap - w.stock.fuel - carried;
    case "cans":
      return CONFIG.stock.canCap - w.stock.cans - carried;
    default:
      return Infinity;
  }
}

/** 背包还能再装多少件这样东西 */
function bagRoom(o: OutingState, goods: Goods, upTo: number): number {
  let n = 0;
  while (n < upTo && bagSlots(o.rations, { ...o.bag, [goods]: (o.bag[goods] ?? 0) + n + 1 }) <= O.bagSlots) n++;
  return n;
}

/** 这一次能拿几件，拿不了时说一句为什么 */
function gatherAmount(w: World, o: OutingState, node: NodeDef): { n: number; reason?: string } {
  const available = nodeAvailable(w, node);
  if (available <= 0) {
    if (node.seasons && !node.seasons.includes(seasonOf(w.day).season)) return { n: 0, reason: "这个季节没有。" };
    return { n: 0, reason: W.gather[node.kind].regrowDays === null ? "已经拿完了。" : "前两天才采过，还没长回来。" };
  }
  const unique = W.gather[node.kind].regrowDays === null;
  const want = unique ? Math.min(available, W.gather[node.kind].amount) : available;
  const home = homeRoom(w, o, node.gives);
  // 会恢复的东西一次采完一份，装不下整份就先不采；旧东西能拿几件拿几件，剩下的留着
  const fit = Math.min(want, home, bagRoom(o, node.gives, want));
  if (home <= 0 || (!unique && home < want)) return { n: 0, reason: `家里的${GOODS_NAME[node.gives]}放满了，先留在这里。` };
  if (fit <= 0 || (!unique && fit < want)) return { n: 0, reason: "背包装不下了，东西先留在原地。" };
  return { n: fit };
}

/** 一步步走过去，每一格花 stepMinutes。返回 false 是走到一半昏倒了 */
function walk(w: World, path: Pos[], notes: OutdoorNote[]): boolean {
  for (const p of path) {
    if (!spendOutdoor(w, W.stepMinutes, "walk", notes)) return false;
    const o = w.outing!;
    o.pos = { ...p };
    o.minutesFromDoor = minutesToDoor(AREA_BY_ID[o.area!], p);
  }
  return true;
}

export function runWild(w: World, action: WildAction): WildResult {
  const o = w.outing;
  if (!o) return refuse("没有在野外。");
  const start = w.minute;
  const notes: OutdoorNote[] = [];
  // 动作接下来了就是 ok，哪怕中途昏倒（昏倒在 notes 里）；只有查下来做不了才是拒绝
  const done = (): WildResult => ({ ok: true, minutes: w.minute - start, notes });

  if (action.type === "travel") {
    if (action.to === "home") {
      if (o.area !== null) {
        const h = here(w)!;
        if (!onHomeExit(h.area, h.pos)) return refuse(`沿小路走回${h.area.name}的出口，才能回家。`);
        o.area = null;
        o.pos = null;
        o.campfire = null;
        o.minutesFromDoor = h.area.homeMinutes;
        if (!spendOutdoor(w, h.area.homeMinutes, "road", notes, () => (w.outing!.minutesFromDoor -= 1))) return done();
      }
      arriveHome(w);
      return done();
    }
    const target = AREA_BY_ID[action.to];
    if (!target) return refuse("没有这个地方。");
    if (o.area === action.to) return refuse("已经在这里了。");
    if (o.area !== null) return refuse("先回到院门外。");
    if (!spendOutdoor(w, target.homeMinutes, "road", notes, () => (w.outing!.minutesFromDoor += 1))) return done();
    const live = w.outing!;
    live.area = target.id;
    live.pos = { ...target.entry };
    live.minutesFromDoor = minutesToDoor(target, target.entry);
    return done();
  }

  if (action.type === "rest") {
    spendOutdoor(w, W.restMinutes, "rest", notes);
    return done();
  }

  if (action.type === "eat") {
    if (o.rations <= 0) return refuse("没带干粮了。");
    if (!spendOutdoor(w, W.eatMinutes, "eat", notes)) return done();
    const live = w.outing!;
    live.rations -= 1;
    live.body.stamina = Math.min(W.bodyMax, live.body.stamina + W.rationStamina);
    bump(w, "野外吃的干粮");
    return done();
  }

  const h = here(w);
  if (!h) return refuse("先走到一个地方去。");
  const { area, pos } = h;

  if (action.type === "move" || action.type === "walkTo") {
    const goal = action.type === "move" ? { x: pos.x + action.dx, y: pos.y + action.dy } : { x: action.x, y: action.y };
    if (action.type === "move" && (!Number.isInteger(action.dx) || !Number.isInteger(action.dy) || Math.abs(action.dx) + Math.abs(action.dy) !== 1)) {
      return refuse("一次走一格。");
    }
    if (!passable(area, goal.x, goal.y)) return refuse("那边走不过去。");
    const path = pathTo(area, pos, (p) => p.x === goal.x && p.y === goal.y);
    if (!path) return refuse("那边走不过去。");
    if (!path.length) return refuse("已经在这里了。");
    walk(w, path, notes);
    return done();
  }

  if (action.type === "gather") {
    const node = area.nodes.find((n) => n.id === action.node);
    if (!node) return refuse("这里没有这样东西。");
    const { n, reason } = gatherAmount(w, o, node);
    if (n <= 0) return refuse(reason!);
    const path = pathTo(area, pos, (p) => dist(p, node) <= 1);
    if (!path) return refuse("走不到那边。");
    if (!walk(w, path, notes)) return done();
    if (!spendOutdoor(w, W.gather[node.kind].minutes, "gather", notes)) return done();
    const live = w.outing!;
    live.bag[node.gives] = (live.bag[node.gives] ?? 0) + n;
    const unique = W.gather[node.kind].regrowDays === null;
    if (unique) w.wild.taken[node.id] = (w.wild.taken[node.id] ?? 0) + n;
    else w.wild.harvested[node.id] = w.day;
    bump(w, `野外采到:${node.gives}`, n);
    logEvent(w, "gather", unique ? `在${area.name}拿了${node.name}（${n}）。` : `在${area.name}采了${node.name}。`, unique ? 2 : 1);
    return done();
  }

  if (action.type === "fire") {
    const spot = area.fires.find((f) => dist(f, pos) <= 1) ?? null;
    if (!spot) return refuse("这里生不了火，找个生火点。");
    if ((o.bag.wood ?? 0) < W.fireSticks) return refuse("背包里的柴不够一捆。");
    const burning = o.campfire && o.campfire.area === area.id && o.campfire.x === spot.x && o.campfire.y === spot.y && o.campfire.until > w.minute;
    const minutes = burning ? CONFIG.IMPL.tendFireMinutes : W.lightFireMinutes;
    if (!spendOutdoor(w, minutes, "fire", notes)) return done();
    const live = w.outing!;
    live.bag.wood = (live.bag.wood ?? 0) - W.fireSticks;
    const from = burning && live.campfire ? Math.max(live.campfire.until, w.minute) : w.minute;
    live.campfire = { area: area.id, x: spot.x, y: spot.y, until: from + W.fireBurnMinutes };
    bump(w, "野外烧的柴", W.fireSticks);
    if (!burning) logEvent(w, "campfire", `在${area.name}生了一堆火。`, 1);
    return done();
  }
  return refuse("做不了这件事。");
}

/** 给界面的区域投影 */
export interface WildView {
  id: string;
  name: string;
  map: string[];
  x: number;
  y: number;
  atHomeExit: boolean;
  fires: { x: number; y: number; burning: boolean; near: boolean; minutesLeft: number }[];
  nodes: { id: string; name: string; x: number; y: number; available: number; unique: boolean; near: boolean; why: string | null }[];
}

export function wildView(w: World): WildView | null {
  const h = here(w);
  if (!h) return null;
  const { o, area, pos } = h;
  const cf = o.campfire;
  return {
    id: area.id,
    name: area.name,
    map: area.map,
    x: pos.x,
    y: pos.y,
    atHomeExit: onHomeExit(area, pos),
    fires: area.fires.map((f) => {
      const burning = !!cf && cf.area === area.id && cf.x === f.x && cf.y === f.y && cf.until > w.minute;
      return { ...f, burning, near: dist(f, pos) <= 1, minutesLeft: burning ? cf!.until - w.minute : 0 };
    }),
    nodes: area.nodes.map((n) => {
      const g = gatherAmount(w, o, n);
      return {
        id: n.id,
        name: n.name,
        x: n.x,
        y: n.y,
        available: nodeAvailable(w, n),
        unique: W.gather[n.kind].regrowDays === null,
        near: dist(n, pos) <= 1,
        why: g.n > 0 ? null : (g.reason ?? null),
      };
    }),
  };
}
