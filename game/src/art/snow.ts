// 窗外的飘雪：粒子的参数和每一时刻的位置。纯算术，不碰 DOM，测试直接跑；真正画在 compose.ts。
// 批次 3 选了 A：雪不出图，由程序画。小雪稀，大雪密，暴风雪斜着刮（另有一层风雪雾，在 compose.ts）。
// 粒子用固定种子的伪随机排好，位置只是时间的函数：同一时刻永远画成一样，不记状态、不碰内核。
// 坐标都是 2560×1440。
import type { ArtWeather } from "./layers.ts";

export type SnowKind = Exclude<ArtWeather, "calm">;

export interface SnowParams {
  /** 每百万像素（2560×1440 坐标）几片 */
  perMpx: number;
  /** 下落速度，像素/秒（最远一层到最近一层之间按深度插） */
  fall: [number, number];
  /** 风：横向漂移，像素/秒，正数往右 */
  wind: number;
  /** 左右飘的幅度，像素 */
  sway: number;
  /** 半径，像素 */
  size: [number, number];
  /** 拖影：按速度往回拉这么多秒画成一道（0 是圆点） */
  streak: number;
  /** 最近一层的不透明度 */
  alpha: number;
}

export const SNOW: Record<SnowKind, SnowParams> = {
  lightSnow: { perMpx: 55, fall: [32, 78], wind: 10, sway: 16, size: [1.8, 4.4], streak: 0, alpha: 0.85 },
  heavySnow: { perMpx: 230, fall: [60, 150], wind: 26, sway: 18, size: [1.8, 5], streak: 0, alpha: 0.9 },
  blizzard: { perMpx: 420, fall: [240, 460], wind: 760, sway: 24, size: [1.3, 3.1], streak: 0.03, alpha: 0.85 },
};

/** 远、中、近三层，各自一个不透明度，一层一笔画完 */
export const TIERS = 3;
const TIER_ALPHA = [0.42, 0.68, 1];

/** 粒子在玻璃外接框外多留的一圈，免得从框边上凭空冒出来 */
const MARGIN = 48;

interface Flake {
  /** 在环绕区里的起点，0–1 */
  u: number;
  v: number;
  /** 深度 0（远）–1（近）：越近越大、越快 */
  z: number;
  /** 左右飘的相位和快慢 */
  ph: number;
  f: number;
}

/** mulberry32：固定种子的伪随机 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED: Record<SnowKind, number> = { lightSnow: 0x5e0a1, heavySnow: 0x5e0b2, blizzard: 0x5e0c3 };
const fields = new Map<string, Flake[]>();

function field(kind: SnowKind, n: number): Flake[] {
  const key = `${kind}:${n}`;
  let f = fields.get(key);
  if (!f) {
    const r = rng(SEED[kind]);
    f = Array.from({ length: n }, () => ({ u: r(), v: r(), z: r(), ph: r() * Math.PI * 2, f: 0.4 + r() * 0.9 }));
    // 远的先画，近的盖在上面
    f.sort((a, b) => a.z - b.z);
    fields.set(key, f);
  }
  return f;
}

export type Box = readonly [number, number, number, number];

export function flakeCount(kind: SnowKind, box: Box): number {
  return Math.max(1, Math.round((SNOW[kind].perMpx * (box[2] + 2 * MARGIN) * (box[3] + 2 * MARGIN)) / 1e6));
}

const mod = (a: number, m: number): number => ((a % m) + m) % m;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * t 秒时框里每一片雪：(x, y) 是位置，r 是半径，(dx, dy) 是拖影（这一片往回拉的那一头相对 x, y 的偏移，没有拖影是 0），
 * tier 是远中近哪一层。按远到近的顺序给。
 */
export function eachFlake(
  kind: SnowKind,
  box: Box,
  t: number,
  fn: (x: number, y: number, r: number, dx: number, dy: number, tier: number) => void,
): void {
  const p = SNOW[kind];
  const fw = box[2] + 2 * MARGIN;
  const fh = box[3] + 2 * MARGIN;
  for (const k of field(kind, flakeCount(kind, box))) {
    const vy = lerp(p.fall[0], p.fall[1], k.z);
    const vx = p.wind * (0.6 + 0.8 * k.z);
    const x = box[0] - MARGIN + mod(k.u * fw + vx * t + p.sway * Math.sin(k.ph + k.f * t), fw);
    const y = box[1] - MARGIN + mod(k.v * fh + vy * t, fh);
    const r = lerp(p.size[0], p.size[1], k.z);
    fn(x, y, r, -vx * p.streak, -vy * p.streak, Math.min(TIERS - 1, Math.floor(k.z * TIERS)));
  }
}

/** 某一层的颜色：白天近白，夜里偏蓝灰（窗外整体暗了，雪不能比窗外的雪地还亮） */
export function snowColor(kind: SnowKind, tier: number, night: boolean): string {
  const a = (SNOW[kind].alpha * TIER_ALPHA[tier]).toFixed(3);
  return night ? `rgba(176,190,218,${a})` : `rgba(250,252,255,${a})`;
}
