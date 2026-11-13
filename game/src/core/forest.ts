// 06 v0.4 松林竖切：地图、采集、背包与体温体力生命。
// 全部确定性；不用系统时间和随机数，不改变 02/03 v3.1 的经济/专注规则。
// 林中动作推进游戏分钟，真正入库仅在回到木屋门口后发生。
import { CONFIG, type Season } from "./config.ts";
import { seasonOf } from "./calendar.ts";
import { woodCap, stepMinute, logEvent } from "./sim.ts";
import { bump, type World } from "./state.ts";
import { collapse, outingMinute, travel, arriveHome } from "./outing.ts";

export const FOREST_WIDTH = 13;
export const FOREST_HEIGHT = 9;
export const FOREST_GATE = { x: 1, y: 4 } as const;
export type ForestKind = "wood" | "ingredient" | "lumber" | "rope" | "canvas" | "fuel" | "can";
export interface ForestNode {
  id: string;
  x: number;
  y: number;
  name: string;
  kind: ForestKind;
  amount: number;
  /** >=1 表示过多少个游戏日才恢复，null 表示独一份 */
  regrowDays: number | null;
  seasons?: Season[];
  gatherMinutes: number;
}
export interface ForestGoods {
  wood: number;
  ingredient: number;
  lumber: number;
  rope: number;
  canvas: number;
  fuel: number;
  can: number;
}
export interface ForestMemory {
  /** 一趟只能拾取一次，不会因为离开再进就刷出 */
  collectedUnique: string[];
  harvestedAt: Record<string, number>;
}
export interface ForestVisit {
  x: number;
  y: number;
  warmth: number;
  stamina: number;
  health: number;
  goods: ForestGoods;
  /** 已走过的地块（不依赖玩家屏幕尺寸） */
  visited: string[];
}
export interface ForestResult { ok: boolean; reason?: string; }
const YES: ForestResult = { ok: true };
const no = (reason: string): ForestResult => ({ ok: false, reason });

/** v0.4 最小区域：伐木工棚一次性材料的第一批，而非全部 03 物品。 */
export const FOREST_NODES: readonly ForestNode[] = [
  { id:"twigsA", x:4, y:2, name:"枯枝堆", kind:"wood", amount:2, regrowDays:3, gatherMinutes:45 },
  { id:"twigsB", x:5, y:7, name:"松树下的枯枝", kind:"wood", amount:2, regrowDays:3, gatherMinutes:45 },
  { id:"pineNuts", x:8, y:2, name:"松子", kind:"ingredient", amount:1, regrowDays:5, seasons:["winter","autumn"], gatherMinutes:25 },
  { id:"berries", x:9, y:6, name:"浆果", kind:"ingredient", amount:1, regrowDays:5, seasons:["winter","summer","autumn"], gatherMinutes:25 },
  { id:"campLumber", x:10, y:2, name:"工棚旧木料", kind:"lumber", amount:3, regrowDays:null, gatherMinutes:30 },
  { id:"campRope", x:10, y:4, name:"工棚旧绳索", kind:"rope", amount:1, regrowDays:null, gatherMinutes:15 },
  { id:"campCanvas", x:11, y:5, name:"工棚帆布", kind:"canvas", amount:1, regrowDays:null, gatherMinutes:15 },
  { id:"campFuel", x:11, y:3, name:"工棚燃油", kind:"fuel", amount:1, regrowDays:null, gatherMinutes:10 },
  { id:"campCan", x:10, y:6, name:"工棚罐头", kind:"can", amount:1, regrowDays:null, gatherMinutes:10 },
];

/** # 石头与密林阻挡；. 林地；G 返回木屋的小径 */
const ROWS = [
  "#############",
  "#.......#...#",
  "#...........#",
  "#...##......#",
  "#G.........#",
  "#...###.....#",
  "#...........#",
  "#...........#",
  "#############",
] as const;

export function forestPassable(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && y >= 0 && y < FOREST_HEIGHT &&
    x >= 0 && x < FOREST_WIDTH && ROWS[y][x] !== "#";
}
export function forestMap(): readonly string[] { return ROWS; }
const tileKey = (x: number, y: number): string => x + "," + y;
export function blankForestGoods(): ForestGoods {
  return { wood:0, ingredient:0, lumber:0, rope:0, canvas:0, fuel:0, can:0 };
}
export function forestMemory(w: World): ForestMemory {
  return w.forestMemory ?? (w.forestMemory = { collectedUnique: [], harvestedAt: {} });
}
export function newForestVisit(): ForestVisit {
  return { x: FOREST_GATE.x, y: FOREST_GATE.y, warmth:100, stamina:100, health:100,
    goods:blankForestGoods(), visited:[tileKey(FOREST_GATE.x, FOREST_GATE.y)] };
}
export function slotCount(o: NonNullable<World["outing"]>): number {
  if (!o.forest) return 0;
  const g = o.forest.goods;
  return Math.ceil(o.rations / 4) + Math.ceil(o.bundles / 2) +
    Math.ceil(g.wood / 6) + Math.ceil(g.ingredient / 5) +
    Math.ceil(g.lumber / 5) + Math.ceil(g.rope / 5) +
    Math.ceil(g.canvas / 5) + Math.ceil(g.fuel / 5) + Math.ceil(g.can / 5);
}
export function isForestNodeReady(w: World, node: ForestNode): boolean {
  if (node.seasons && !node.seasons.includes(seasonOf(w.day).season)) return false;
  const m = w.forestMemory;
  if (!m) return true;
  if (node.regrowDays === null) return !m.collectedUnique.includes(node.id);
  const prev = m.harvestedAt[node.id];
  return prev === undefined || w.day - prev >= node.regrowDays;
}

/** BFS shortest valid walk back to forest gate, used for honest dusk ETA. */
export function shortestStepsToGate(x: number, y: number): number {
  if (!forestPassable(x,y)) return Infinity;
  const q: [number, number, number][] = [[x,y,0]];
  const seen = new Set<string>([tileKey(x,y)]);
  for (let i=0;i<q.length;i++) {
    const [cx,cy,d] = q[i];
    if (cx===FOREST_GATE.x && cy===FOREST_GATE.y) return d;
    for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx=cx+dx, ny=cy+dy, key=tileKey(nx,ny);
      if (forestPassable(nx,ny) && !seen.has(key)) { seen.add(key); q.push([nx,ny,d+1]); }
    }
  }
  return Infinity;
}

/** 每个真实游戏分钟失温：世界正常走时、林中动作及返家路上都共用。 */
export function tickForestBody(w: World): boolean {
  const f=w.outing?.forest;
  if (!f) return false;
  const weather=w.weather.today;
  f.warmth=Math.max(0,f.warmth-(weather==="C" ? 0.20 : weather==="B" ? 0.10 : 0.065));
  if (f.warmth<20) f.health=Math.max(0,f.health-(20-f.warmth)/150);
  if (f.warmth<=0 || f.health<=0 || f.stamina<=0) {
    collapse(w);
    return true;
  }
  return false;
}
/** 在真实 06 world clock 中消费时间：炉火、饭点、气温与午夜按同一规则。 */
function spend(w: World, minutes: number): boolean {
  for (let i=0;i<minutes;i++) {
    if (!w.outing) return false;
    stepMinute(w);
    if (outingMinute(w)) return false;
  }
  return !!w.outing;
}
function ready(w: World): ForestVisit | null { return w.outing?.forest ?? null; }

/** 与现有出门收尾保持兼容：在院门外，真正走 20 游戏分钟到林口。 */
export function enterForest(w: World): ForestResult {
  if (!w.outing || w.outing.area !== null) return no("先回到院门外，才能去松林。");
  if (!travel(w, CONFIG.outing.areas.pineForest.travelMinutes, "out") || !w.outing) return no("路上撑不住了。");
  const o=w.outing;
  o.area = "pineForest";
  o.forest = newForestVisit();
  o.minutesFromDoor = CONFIG.outing.areas.pineForest.travelMinutes;
  forestMemory(w);
  return YES;
}

export function moveForest(w: World, dx: number, dy: number): ForestResult {
  const f=ready(w);
  if (!f) return no("没有在松林地图中。");
  if (!Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx)+Math.abs(dy)!==1) return no("只能沿小路走一格。");
  const x=f.x+dx,y=f.y+dy;
  if (!forestPassable(x,y)) return no("前面是密林或石堆。");
  if (f.stamina < 4) return no("体力不够了，先歇一会儿。");
  if (!spend(w,3)) return no("途中撑不住了，已经回到木屋。");
  const next=ready(w);
  if (!next) return no("途中撑不住了，已经回到木屋。");
  next.x=x;next.y=y;
  next.stamina=Math.max(0,next.stamina-3);
  next.visited.push(tileKey(x,y));
  if (next.stamina<=0) { collapse(w); return no("体力耗尽，醒来时已经在木屋里。"); }
  if (w.outing) w.outing.minutesFromDoor = CONFIG.outing.areas.pineForest.travelMinutes + shortestStepsToGate(x,y)*3;
  return YES;
}

export function gatherForest(w: World, nodeId: string): ForestResult {
  const f=ready(w), o=w.outing;
  if (!f || !o) return no("没有在松林地图中。");
  const node=FOREST_NODES.find(n=>n.id===nodeId);
  if (!node) return no("这里没有可以采的东西。");
  if (Math.abs(f.x-node.x)+Math.abs(f.y-node.y)>1) return no("需要走到采集点旁边。");
  if (!isForestNodeReady(w,node)) return no("这里还没有恢复，或这个季节没有。");
  if (f.stamina < 8) return no("体力不足，先歇一会儿。");
  if (node.kind==="fuel" && w.stock.fuel+f.goods.fuel+node.amount>CONFIG.stock.fuelCap) return no("家里的燃油罐满了，先留在这里。");
  if (node.kind==="can" && w.stock.cans+f.goods.can+node.amount>CONFIG.stock.canCap) return no("家里的罐头已满，先留在这里。");
  const hypothetical: ForestVisit = { ...f, goods:{...f.goods,[node.kind]:f.goods[node.kind]+node.amount} };
  if (slotCount({...o,forest:hypothetical})>20) return no("背包装不下，东西先留在原地。");
  if (!spend(w,node.gatherMinutes)) return no("采集时撑不住了，醒来时已经在木屋里。");
  const live=ready(w);
  if (!live) return no("采集时撑不住了，醒来时已经在木屋里。");
  live.goods[node.kind]+=node.amount;
  live.stamina=Math.max(0,live.stamina-6);
  if (node.regrowDays===null) forestMemory(w).collectedUnique.push(node.id);
  else forestMemory(w).harvestedAt[node.id]=w.day;
  bump(w,"野外采集");
  logEvent(w,"gather",`在松林找到了${node.name}。`,1);
  if (live.stamina<=0) { collapse(w); return no("采完东西后体力耗尽，醒来时已在木屋里。"); }
  return YES;
}
export function restForest(w: World): ForestResult {
  const f=ready(w);
  if (!f) return no("没有在松林里。");
  if (!spend(w,10)) return no("停下来休息时撑不住了。");
  const live=ready(w);
  if (!live) return no("已经回到木屋。");
  live.stamina=Math.min(100,live.stamina+24);
  return YES;
}
export function returnForest(w: World): ForestResult {
  const f=ready(w);
  if (!f) return no("没有在松林地图中。");
  if (f.x!==FOREST_GATE.x || f.y!==FOREST_GATE.y) return no("沿小路走回林口，才能回家。");
  // 从林口回木屋的 20 游戏分钟是已有 03 距离，不是界面瞬移。
  if (!travel(w,CONFIG.outing.areas.pineForest.travelMinutes,"home") || !w.outing) return no("返家途中撑不住了。");
  arriveHome(w);
  return YES;
}

/** 返家和昏倒统一收账；素材保留，普通采集物在昏倒时掉部分。 */
export function settleForestGoods(w: World, collapsed: boolean): void {
  const goods=w.outing?.forest?.goods;
  if (!goods) return;
  const ordinary=collapsed ? 0.5 : 1;
  const wood=Math.floor(goods.wood*ordinary);
  const ingredient=Math.floor(goods.ingredient*ordinary);
  const actualWood=Math.max(0,Math.min(wood,woodCap(w)-w.stock.wood));
  const actualIngredient=Math.max(0,Math.min(ingredient,CONFIG.stock.ingredientCap-w.stock.ingredients));
  w.stock.wood+=actualWood;
  w.stock.ingredients+=actualIngredient;
  bump(w,"松林带回的柴",actualWood);
  bump(w,"松林带回的食材",actualIngredient);
  for(const key of ["lumber","rope","canvas"] as const) {
    w.stock.materials[key]+=goods[key];
    bump(w,"松林带回的"+key,goods[key]);
  }
  // 独一份的燃油、罐头在昏倒时同样保留；在拾取时已确保不会越入库上限。
  w.stock.fuel=Math.min(CONFIG.stock.fuelCap,w.stock.fuel+goods.fuel);
  w.stock.cans=Math.min(CONFIG.stock.canCap,w.stock.cans+goods.can);
  bump(w,"松林带回燃油",goods.fuel);
  bump(w,"松林带回罐头",goods.can);
}

export interface ForestSnapshot {
  x:number; y:number; width:number; height:number;
  tiles: readonly string[];
  warmth:number; stamina:number; health:number;
  returnMinutes:number;
  atGate:boolean;
  slots:number; maxSlots:number;
  goods:ForestGoods;
  nodes: { id:string; x:number; y:number; name:string; ready:boolean; reachable:boolean; unique:boolean }[];
}
export function forestSnapshot(w: World): ForestSnapshot | null {
  const o=w.outing, f=o?.forest;
  if (!o || !f) return null;
  return {
    x:f.x,y:f.y,width:FOREST_WIDTH,height:FOREST_HEIGHT,tiles:ROWS,
    warmth:Math.round(f.warmth),stamina:Math.round(f.stamina),health:Math.round(f.health),
    returnMinutes:o.minutesFromDoor,atGate:f.x===FOREST_GATE.x && f.y===FOREST_GATE.y,
    slots:slotCount(o),maxSlots:20,goods:{...f.goods},
    nodes:FOREST_NODES.map(n=>({id:n.id,x:n.x,y:n.y,name:n.name,
      ready:isForestNodeReady(w,n),
      reachable:Math.abs(f.x-n.x)+Math.abs(f.y-n.y)<=1,
      unique:n.regrowDays===null})),
  };
}
