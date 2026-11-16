// 窗外小事的占位画法：位置和形状只是时间的函数（纯算术，不碰 DOM，测试直接跑），真正画在 compose.ts。
// 图还没有出（05 的「窗外的小事」排在人物之后）；这一套里有 window_<种类> 的图就用图，这里只是缺图时的程序层。
// 跟雪一样在窗外一组里、按玻璃掩码裁；同一时刻永远画成一样，不记状态、不碰内核。坐标都是 2560×1440。
import type { WindowKind } from "../core/state.ts";
import { ROOMS, type RoomId } from "../core/rooms.ts";
import type { Box } from "./snow.ts";

export type { WindowKind };

/** 画面上的一件：种类和编号（内核给的开始分钟，定位置、队形用） */
export interface SightArt {
  kind: WindowKind;
  seed: number;
}

/** 这一间最大的那块玻璃的外接框：鸟落在它的下沿，鹿和大雁在它里面 */
export function mainPane(room: RoomId): Box {
  let best: Box = [0, 0, 0, 0];
  for (const pane of ROOMS[room].panes) {
    const xs = pane.map((p) => p[0]);
    const ys = pane.map((p) => p[1]);
    const box: Box = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    if (box[2] * box[3] > best[2] * best[3]) best = box;
  }
  return best;
}

/** 0–1 的小数，同一个 seed 永远一样 */
export function frac(seed: number, salt = 0): number {
  let h = Math.imul((seed ^ (salt * 0x9e3779b1)) >>> 0, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 窗沿的鸟：落在玻璃下沿，偶尔点一下头。size 是身长 */
export function birdAt(box: Box, t: number, seed: number): { x: number; y: number; size: number; nod: number; facing: 1 | -1 } {
  return {
    x: box[0] + box[2] * (0.22 + 0.16 * frac(seed, 1)),
    y: box[1] + box[3] - 10,
    size: 60,
    // 每四五秒点一下头：大部分时间是 0
    nod: Math.max(0, Math.sin(t * 1.4 + seed)) ** 12,
    facing: frac(seed, 2) < 0.5 ? 1 : -1,
  };
}

/** 远处林边的鹿：站在玻璃高度大约四分之三处（远景的林边），隔一阵低头吃两口。height 是肩高 */
export function deerAt(box: Box, t: number, seed: number): { x: number; y: number; height: number; graze: number; facing: 1 | -1 } {
  return {
    x: box[0] + box[2] * (0.15 + 0.35 * frac(seed, 3)),
    y: box[1] + box[3] * 0.8,
    height: 44,
    // 0 抬头，1 低头；十来秒一个来回，慢慢过渡
    graze: 0.5 + 0.5 * Math.tanh(4 * Math.sin(t * 0.55 + seed)),
    facing: frac(seed, 4) < 0.5 ? 1 : -1,
  };
}

/** 大雁一趟飞过要几秒；PASS 秒以后再从头来（一件持续的时间里大约飞过一两趟） */
export const GEESE_PASS = 36;
export const GEESE_PERIOD = 48;
const GEESE_MARGIN = 160;

/** 一队大雁：人字形，从右往左飞过玻璃上部。t=0（减弱动态效果时的静止帧）正好在中间 */
export function geeseAt(box: Box, t: number, seed: number): { x: number; y: number; flap: number }[] {
  const n = 5 + Math.floor(frac(seed, 5) * 4);
  const cycle = (((t + GEESE_PASS / 2) % GEESE_PERIOD) + GEESE_PERIOD) % GEESE_PERIOD;
  if (cycle > GEESE_PASS) return [];
  const p = cycle / GEESE_PASS;
  const span = box[2] + 2 * GEESE_MARGIN;
  const lx = box[0] + box[2] + GEESE_MARGIN - span * p;
  const ly = box[1] + box[3] * (0.16 + 0.14 * frac(seed, 6)) + 12 * Math.sin(p * Math.PI * 2);
  const out: { x: number; y: number; flap: number }[] = [];
  for (let i = 0; i < n; i++) {
    const rank = Math.ceil(i / 2);
    const side = i === 0 ? 0 : i % 2 ? -1 : 1;
    out.push({ x: lx + rank * 34, y: ly + side * rank * 20, flap: Math.sin(t * 5 + i * 0.9) });
  }
  return out;
}

/** 极光的几道光幕：每道是一串竖条，顶边和高度沿横向起伏，慢慢飘 */
export const AURORA_BANDS = 3;
export const AURORA_STEP = 24;

/** 第 band 道在横坐标 x 处的那一条：top 顶边、height 高、alpha 浓淡（0–1） */
export function auroraStrip(box: Box, band: number, x: number, t: number): { top: number; height: number; alpha: number } {
  const u = (x - box[0]) / Math.max(1, box[2]);
  const top = box[1] + box[3] * (0.08 + 0.1 * band + 0.06 * Math.sin(u * 5.5 + t * 0.12 + band * 1.7));
  const height = box[3] * (0.2 + 0.08 * Math.sin(u * 3.1 - t * 0.09 + band * 2.3));
  // 两头淡、中间浓，再加一点缓慢的明暗
  const edge = Math.sin(Math.PI * Math.min(1, Math.max(0, u)));
  const alpha = edge * (0.55 + 0.45 * Math.sin(u * 8 + t * 0.2 + band)) * (band === 0 ? 1 : 0.7);
  return { top, height, alpha: Math.max(0, alpha) };
}
