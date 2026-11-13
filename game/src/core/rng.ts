// 可存档的种子随机数（mulberry32）。状态是一个 32 位整数，存进世界状态里。

export interface Rng {
  s: number;
}

export function makeRng(seed: number): Rng {
  return { s: seed >>> 0 };
}

/** [0, 1) */
export function next(rng: Rng): number {
  rng.s = (rng.s + 0x6d2b79f5) >>> 0;
  let t = rng.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function chance(rng: Rng, p: number): boolean {
  return next(rng) < p;
}

/** 含两端的整数 */
export function intBetween(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(next(rng) * (hi - lo + 1));
}

export function pickWeighted<T>(rng: Rng, items: readonly (readonly [T, number])[]): T {
  let total = 0;
  for (const [, w] of items) total += w;
  let r = next(rng) * total;
  for (const [item, w] of items) {
    r -= w;
    if (r < 0) return item;
  }
  return items[items.length - 1][0];
}
