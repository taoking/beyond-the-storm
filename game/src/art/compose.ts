// 把 layers.ts 选好的图层真的叠出来：读图、按玻璃掩码裁窗外、画人形占位、逐级缩小，贴到画布上；
// 下雪时在玻璃那一块逐帧补上飘雪（SnowLoop，粒子在 snow.ts）。
// 灰盒主界面和美术查看页共用。只碰 DOM 和图片，不碰世界。
// 坐标都是 2560×1440；画布按 CSS 尺寸 × 屏幕倍率出图，缩小是逐级减半再平滑缩放（不做最近邻）。
import type { RoomId } from "../core/rooms.ts";
import { blendOf, PROCEDURAL, SNOWY, STAND_IN, type ArtWeather, type Figure, type Stack } from "./layers.ts";
import { eachFlake, snowColor, TIERS, type SnowKind } from "./snow.ts";

export const W = 2560;
export const H = 1440;

// ---- 素材库：按 套/房间/图层名 索引 ----

export interface Library {
  /** 新的在前：按目录名末尾的日期排 */
  sets: string[];
  has(set: string, room: RoomId, name: string): boolean;
  url(set: string, room: RoomId, name: string): string | undefined;
  /** 这一套、这一间有的全部图层名（不带扩展名） */
  names(set: string, room: RoomId): string[];
}

/** urls 是 import.meta.glob(".../rooms/套/房间/名字.{webp,png}", { query: "?url", eager: true }) 的结果 */
export function library(urls: Record<string, string>): Library {
  const files = new Map<string, string>();
  for (const [path, url] of Object.entries(urls)) {
    const m = path.match(/rooms\/([^/]+)\/([^/]+)\/([^/]+)\.(webp|png)$/);
    if (m) files.set(`${m[1]}/${m[2]}/${m[3]}`, url);
  }
  const sets = [...new Set([...files.keys()].map((k) => k.split("/")[0]))].sort((a, b) =>
    (b.split("_").at(-1) ?? "").localeCompare(a.split("_").at(-1) ?? ""),
  );
  return {
    sets,
    has: (set, room, name) => files.has(`${set}/${room}/${name}`),
    url: (set, room, name) => files.get(`${set}/${room}/${name}`),
    names: (set, room) => [...files.keys()].filter((k) => k.startsWith(`${set}/${room}/`)).map((k) => k.split("/")[2]).sort(),
  };
}

// ---- 读图：同一张只读一次；读不出来当作没有 ----

const images = new Map<string, Promise<HTMLImageElement | null>>();
export function loadImage(url: string): Promise<HTMLImageElement | null> {
  let p = images.get(url);
  if (!p) {
    const img = new Image();
    img.src = url;
    p = img.decode().then(
      () => img,
      () => {
        console.warn("[art] 读不出图层", url);
        return null;
      },
    );
    images.set(url, p);
  }
  return p;
}

function canvas(w = W, h = H): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

interface Glass {
  /** alpha 掩码，2560×1440 */
  alpha: HTMLCanvasElement;
  /** 玻璃（外扩以后）的外接框 [x, y, w, h]：雪只在这一块逐帧重画 */
  box: [number, number, number, number];
}

/**
 * glass_mask.png 是灰度图（白是玻璃）。换成 alpha 掩码，再往外扩 3 像素：
 * 窗外层本来就比玻璃多出 2 像素垫在窗框的软边下面，裁得正好贴玻璃，软边会透出底色。
 */
const masks = new Map<string, Promise<Glass | null>>();
function glassAlpha(url: string): Promise<Glass | null> {
  let p = masks.get(url);
  if (!p) {
    p = loadImage(url).then((img) => {
      if (!img) return null;
      const a = canvas();
      const ctx = a.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, W, H);
      const data = ctx.getImageData(0, 0, W, H);
      const px = data.data;
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let i = 0; i < px.length; i += 4) {
        const v = px[i];
        px[i + 3] = v;
        px[i] = px[i + 1] = px[i + 2] = 0;
        if (v > 0) {
          const q = i >> 2, x = q % W, y = (q / W) | 0;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      if (x1 < 0) return null;
      ctx.putImageData(data, 0, 0);
      const R = 3;
      const grow = (src: HTMLCanvasElement, dx: number, dy: number): HTMLCanvasElement => {
        const out = canvas();
        const o = out.getContext("2d")!;
        for (let k = -R; k <= R; k++) o.drawImage(src, k * dx, k * dy);
        return out;
      };
      const bx = Math.max(0, x0 - R), by = Math.max(0, y0 - R);
      return { alpha: grow(grow(a, 1, 0), 0, 1), box: [bx, by, Math.min(W, x1 + R + 1) - bx, Math.min(H, y1 + R + 1) - by] };
    });
    masks.set(url, p);
  }
  return p;
}

// ---- 人形占位 ----

const FIGURE_FILL: Record<Figure["look"], string> = {
  indoor: "rgba(228,178,118,.55)",
  outdoor: "rgba(166,80,73,.6)",
  illusion: "rgba(113,147,172,.55)",
};

/** 角色图出来以前的人形：坐、蹲矮一截，睡是横着的 */
export function drawFigure(ctx: CanvasRenderingContext2D, f: Figure): void {
  const [x, y] = f.foot;
  const h = f.height;
  ctx.save();
  ctx.fillStyle = FIGURE_FILL[f.look];
  ctx.strokeStyle = "rgba(255,230,190,.9)";
  ctx.lineWidth = 4;
  if (f.pose === "sleep") {
    ctx.fillRect(x - h * 0.5, y - h * 0.2, h, h * 0.14);
    ctx.strokeRect(x - h * 0.5, y - h * 0.2, h, h * 0.14);
  } else {
    const body = f.pose.startsWith("sit") || f.pose === "crouch" ? h * 0.62 : h;
    const head = h * 0.065;
    ctx.beginPath();
    ctx.arc(x, y - body + head, head, 0, Math.PI * 2);
    ctx.rect(x - h * 0.09, y - body + head * 2.2, h * 0.18, body - head * 2.2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// ---- 叠图 ----

export type OutsideMode = "art" | "magenta" | "navy";

export interface SceneSpec {
  set: string;
  room: RoomId;
  stack: Stack;
  figure: Figure | null;
  /** 查看页查窗洞用：窗外换成品红或深蓝的纯色 */
  outside?: OutsideMode;
}

/** 叠好的整张，和逐级减半的几级（levels[0] 是 2560×1440） */
export interface Composed {
  key: string;
  /** 整张；下雪时不带雪，雪由 SnowLoop 在玻璃那一块逐帧补上 */
  levels: HTMLCanvasElement[];
  snow: Snowfall | null;
}

/** 下雪时另留的两半（都逐级减半）：雪下面（底色、窗外、风雪雾，已按玻璃裁）和雪上面（室内往上全部，玻璃处透明） */
export interface Snowfall {
  kind: SnowKind;
  night: boolean;
  below: HTMLCanvasElement[];
  above: HTMLCanvasElement[];
  glass: Glass;
}

export const sceneKey = (s: SceneSpec): string =>
  [s.set, s.room, s.outside ?? "art", s.stack.night, s.stack.outside, s.stack.figureAt, s.stack.layers.join(","), s.figure ? JSON.stringify(s.figure) : ""].join("|");

const BACKDROP = "#0f1418";

/** 风雪雾：把远景压淡，越往下（地平线、雪林）越浓。大雪薄薄一层，暴风雪厚 */
function drawFog(ctx: CanvasRenderingContext2D, kind: ArtWeather, night: boolean): void {
  // 夜里窗外本来就暗，雾薄一点，远山还留个影子
  const k = night ? 0.7 : 1;
  const [top, bottom] = (kind === "blizzard" ? [0.5, 0.72] : [0.14, 0.26]).map((a) => a * k);
  const rgb = night ? "58,68,94" : "218,225,234";
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `rgba(${rgb},${top})`);
  g.addColorStop(1, `rgba(${rgb},${bottom})`);
  ctx.save();
  ctx.globalCompositeOperation = "source-atop"; // 只盖在已经画了的窗外上
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** ~fog_大雪 这种名字 → 天气档位 */
function procedural(name: string, prefix: string): SnowKind | null {
  const k = name.slice(prefix.length) as SnowKind;
  return name.startsWith(prefix) && SNOWY.includes(k) ? k : null;
}

interface Parts {
  full: HTMLCanvasElement;
  snow: { kind: SnowKind; night: boolean; below: HTMLCanvasElement; above: HTMLCanvasElement; glass: Glass } | null;
}

async function composeFull(lib: Library, spec: SceneSpec): Promise<Parts> {
  const { set, room, stack, figure } = spec;
  const mode = spec.outside ?? "art";
  const files = stack.layers.map((name) => (name.startsWith("~") ? null : lib.url(set, room, name)));
  const maskUrl = lib.url(set, room, "glass_mask");
  const [imgs, glass] = await Promise.all([
    Promise.all(files.map((u) => (u ? loadImage(u) : Promise.resolve(null)))),
    mode === "art" && maskUrl && stack.outside > 0 ? glassAlpha(maskUrl) : Promise.resolve(null),
  ]);

  const c = canvas();
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = mode === "magenta" ? "#ff00ff" : mode === "navy" ? "#141e46" : BACKDROP;
  ctx.fillRect(0, 0, W, H);

  // 窗外一组：单独叠，按玻璃掩码裁，垫在室内层下面。雪是这一组最上面一层，逐帧画，这里只记下档位
  let snow: SnowKind | null = null;
  if (mode === "art" && stack.outside > 0) {
    const o = canvas();
    const octx = o.getContext("2d")!;
    for (let i = 0; i < stack.outside; i++) {
      const name = stack.layers[i];
      const img = imgs[i];
      const fog = procedural(name, PROCEDURAL.fog);
      if (img) octx.drawImage(img, 0, 0, W, H);
      else if (name === STAND_IN.nightOutside) {
        octx.globalCompositeOperation = "source-atop";
        octx.fillStyle = "rgba(6,12,34,.68)";
        octx.fillRect(0, 0, W, H);
        octx.globalCompositeOperation = "source-over";
      } else if (fog) drawFog(octx, fog, stack.night);
      else snow = procedural(name, PROCEDURAL.snow) ?? snow;
    }
    if (glass) {
      octx.globalCompositeOperation = "destination-in";
      octx.drawImage(glass.alpha, 0, 0);
    }
    ctx.drawImage(o, 0, 0);
  }

  // 下雪（还得有玻璃掩码，知道雪落在哪）就把室内往上单独叠一张，两半夹着雪逐帧画；不下雪直接叠在同一张上
  const split = snow && glass;
  const a = split ? canvas() : c;
  const actx = a.getContext("2d")!;
  for (let i = stack.outside; i < stack.layers.length; i++) {
    if (figure && i === stack.figureAt) drawFigure(actx, figure);
    const img = imgs[i];
    if (img) {
      // 光层（火光、灯光）用加亮叠法，叠在夜色上面
      actx.globalCompositeOperation = blendOf(stack.layers[i]);
      actx.drawImage(img, 0, 0, W, H);
      actx.globalCompositeOperation = "source-over";
    } else if (stack.layers[i] === STAND_IN.nightRoom) {
      actx.fillStyle = "rgba(8,12,30,.5)";
      actx.fillRect(0, 0, W, H);
    }
  }
  if (figure && stack.figureAt >= stack.layers.length) drawFigure(actx, figure);
  if (!split) return { full: c, snow: null };

  const full = canvas();
  const fctx = full.getContext("2d")!;
  fctx.drawImage(c, 0, 0);
  fctx.drawImage(a, 0, 0);
  return { full, snow: { kind: snow!, night: stack.night, below: c, above: a, glass: glass! } };
}

/** 逐级减半，留着每一级，小画布从最近的一级缩 */
function pyramid(src: HTMLCanvasElement, smallest: number): HTMLCanvasElement[] {
  const out = [src];
  let cur = src;
  while (cur.width / 2 >= smallest) {
    const c = canvas(Math.round(cur.width / 2), Math.round(cur.height / 2));
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(cur, 0, 0, c.width, c.height);
    out.push(c);
    cur = c;
  }
  return out;
}

/** 叠出整张再逐级缩到 smallest 像素宽为止 */
export async function compose(lib: Library, spec: SceneSpec, smallest = 320): Promise<Composed> {
  const p = await composeFull(lib, spec);
  const levels = pyramid(p.full, smallest);
  if (!p.snow) return { key: sceneKey(spec), levels, snow: null };
  const { kind, night, below, above, glass } = p.snow;
  return { key: sceneKey(spec), levels, snow: { kind, night, glass, below: pyramid(below, smallest), above: pyramid(above, smallest) } };
}

/** 画布的像素尺寸设成 CSS 尺寸 × 屏幕倍率；返回有没有变 */
export function fitCanvas(c: HTMLCanvasElement, cssW: number, cssH: number): boolean {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(cssW * dpr));
  const h = Math.max(1, Math.round(cssH * dpr));
  if (c.width === w && c.height === h) return false;
  c.width = w;
  c.height = h;
  return true;
}

/** 不比画布小的最小一级 */
const levelFor = (levels: HTMLCanvasElement[], width: number): HTMLCanvasElement => levels.filter((l) => l.width >= width).at(-1) ?? levels[0];

/** 从不比画布小的最小一级平滑缩到画布大小 */
export function blit(composed: Composed, c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const src = levelFor(composed.levels, c.width);
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return ctx;
}

// ---- 飘雪：只在玻璃的外接框里逐帧重画 ----

/** 每块画布按它的像素尺寸备一份：框在画布上的位置、缩好的掩码、画雪用的草稿 */
interface Prepared {
  snow: Snowfall;
  width: number;
  height: number;
  rect: [number, number, number, number];
  mask: HTMLCanvasElement;
  scratch: HTMLCanvasElement;
}
const prepared = new WeakMap<HTMLCanvasElement, Prepared>();

function prepare(snow: Snowfall, c: HTMLCanvasElement): Prepared {
  const old = prepared.get(c);
  if (old && old.snow === snow && old.width === c.width && old.height === c.height) return old;
  const kx = c.width / W;
  const ky = c.height / H;
  const [bx, by, bw, bh] = snow.glass.box;
  const x = Math.max(0, Math.floor(bx * kx));
  const y = Math.max(0, Math.floor(by * ky));
  const w = Math.min(c.width, Math.ceil((bx + bw) * kx)) - x;
  const h = Math.min(c.height, Math.ceil((by + bh) * ky)) - y;
  const mask = canvas(w, h);
  const mctx = mask.getContext("2d")!;
  mctx.imageSmoothingQuality = "high";
  mctx.drawImage(snow.glass.alpha, x / kx, y / ky, w / kx, h / ky, 0, 0, w, h);
  const p: Prepared = { snow, width: c.width, height: c.height, rect: [x, y, w, h], mask, scratch: canvas(w, h) };
  prepared.set(c, p);
  return p;
}

/** 从某一组逐级减半的图里取对应 rect 那一块，贴到画布的 rect 上 */
function blitRect(levels: HTMLCanvasElement[], ctx: CanvasRenderingContext2D, rect: Prepared["rect"]): void {
  const src = levelFor(levels, ctx.canvas.width);
  const s = src.width / ctx.canvas.width;
  const [x, y, w, h] = rect;
  ctx.drawImage(src, x * s, y * s, w * s, h * s, x, y, w, h);
}

/**
 * 画一帧雪：框里先贴雪下面那半，再画 t 秒时的雪（按玻璃掩码裁），再贴雪上面那半。
 * after 是查看页的标注：裁在框里重画，免得被这一帧盖掉。
 */
export function drawSnowFrame(snow: Snowfall, c: HTMLCanvasElement, t: number, after?: (ctx: CanvasRenderingContext2D) => void): void {
  const p = prepare(snow, c);
  const [x, y, w, h] = p.rect;
  if (w <= 0 || h <= 0) return;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  blitRect(snow.below, ctx, p.rect);

  const s = p.scratch.getContext("2d")!;
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.globalCompositeOperation = "source-over";
  s.clearRect(0, 0, w, h);
  const kx = c.width / W;
  s.setTransform(kx, 0, 0, c.height / H, -x, -y);
  // 小画布上最小也画成大约 0.7 个像素宽，不然小窗里的雪整片消失
  const minR = 0.7 / kx;
  const streak = snow.kind === "blizzard";
  const paths = Array.from({ length: TIERS }, () => new Path2D());
  const widths = Array.from({ length: TIERS }, () => 0);
  const counts = Array.from({ length: TIERS }, () => 0);
  eachFlake(snow.kind, snow.glass.box, t, (fx, fy, r, dx, dy, tier) => {
    const rr = Math.max(r, minR);
    const path = paths[tier];
    if (streak) {
      path.moveTo(fx, fy);
      path.lineTo(fx + dx, fy + dy);
      widths[tier] += rr * 2;
    } else {
      path.moveTo(fx + rr, fy);
      path.arc(fx, fy, rr, 0, Math.PI * 2);
    }
    counts[tier]++;
  });
  s.lineCap = "round";
  for (let i = 0; i < TIERS; i++) {
    if (!counts[i]) continue;
    const color = snowColor(snow.kind, i, snow.night);
    if (streak) {
      s.strokeStyle = color;
      s.lineWidth = widths[i] / counts[i];
      s.stroke(paths[i]);
    } else {
      s.fillStyle = color;
      s.fill(paths[i]);
    }
  }
  s.setTransform(1, 0, 0, 1, 0, 0);
  s.globalCompositeOperation = "destination-in";
  s.drawImage(p.mask, 0, 0);
  ctx.drawImage(p.scratch, x, y);

  blitRect(snow.above, ctx, p.rect);
  if (after) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    after(ctx);
    ctx.restore();
  }
}

/**
 * 让雪动起来：每秒 fps 帧，只重画玻璃那一块。窗口在后台（document.hidden）时不画；
 * 系统设了「减弱动态效果」就只画静止的一帧。不下雪就停。
 */
export class SnowLoop {
  private scene: Composed | null = null;
  private targets: HTMLCanvasElement[] = [];
  private after: ((ctx: CanvasRenderingContext2D, c: HTMLCanvasElement) => void) | undefined;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly still = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  /** 画了多少帧、一共花了多少毫秒（只算画雪，开发时看开销） */
  readonly stats = { frames: 0, ms: 0 };

  private readonly fps: number;

  constructor(fps = 15) {
    this.fps = fps;
    document.addEventListener("visibilitychange", () => this.sync());
    this.still?.addEventListener("change", () => {
      this.frame();
      this.sync();
    });
  }

  /** 画布刚贴好 scene（blit 过）以后调：马上补一帧雪，再按需开、停 */
  play(scene: Composed, targets: HTMLCanvasElement[], after?: (ctx: CanvasRenderingContext2D, c: HTMLCanvasElement) => void): void {
    this.scene = scene;
    this.targets = targets;
    this.after = after;
    this.frame();
    this.sync();
  }

  private sync(): void {
    const run = !!this.scene?.snow && this.targets.length > 0 && !document.hidden && !this.still?.matches;
    if (run && !this.timer) this.timer = setInterval(() => this.frame(), 1000 / this.fps);
    else if (!run && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private frame(): void {
    const snow = this.scene?.snow;
    if (!snow || document.hidden) return;
    const t0 = performance.now();
    const t = this.still?.matches ? 0 : t0 / 1000;
    for (const c of this.targets) drawSnowFrame(snow, c, t, this.after && ((ctx) => this.after!(ctx, c)));
    this.stats.frames++;
    this.stats.ms += performance.now() - t0;
  }
}
