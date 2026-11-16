// 把 layers.ts 选好的图层真的叠出来：读图、按玻璃掩码裁窗外、画人形占位、逐级缩小，贴到画布上。
// 灰盒主界面和美术查看页共用。只碰 DOM 和图片，不碰世界。
// 坐标都是 2560×1440；画布按 CSS 尺寸 × 屏幕倍率出图，缩小是逐级减半再平滑缩放（不做最近邻）。
import type { RoomId } from "../core/rooms.ts";
import { STAND_IN, type Figure, type Stack } from "./layers.ts";

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

/**
 * glass_mask.png 是灰度图（白是玻璃）。换成 alpha 掩码，再往外扩 3 像素：
 * 窗外层本来就比玻璃多出 2 像素垫在窗框的软边下面，裁得正好贴玻璃，软边会透出底色。
 */
const masks = new Map<string, Promise<HTMLCanvasElement | null>>();
function glassAlpha(url: string): Promise<HTMLCanvasElement | null> {
  let p = masks.get(url);
  if (!p) {
    p = loadImage(url).then((img) => {
      if (!img) return null;
      const a = canvas();
      const ctx = a.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0, W, H);
      const data = ctx.getImageData(0, 0, W, H);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        px[i + 3] = px[i];
        px[i] = px[i + 1] = px[i + 2] = 0;
      }
      ctx.putImageData(data, 0, 0);
      const R = 3;
      const grow = (src: HTMLCanvasElement, dx: number, dy: number): HTMLCanvasElement => {
        const out = canvas();
        const o = out.getContext("2d")!;
        for (let k = -R; k <= R; k++) o.drawImage(src, k * dx, k * dy);
        return out;
      };
      return grow(grow(a, 1, 0), 0, 1);
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
  levels: HTMLCanvasElement[];
}

export const sceneKey = (s: SceneSpec): string =>
  [s.set, s.room, s.outside ?? "art", s.stack.outside, s.stack.figureAt, s.stack.layers.join(","), s.figure ? JSON.stringify(s.figure) : ""].join("|");

const BACKDROP = "#0f1418";

async function composeFull(lib: Library, spec: SceneSpec): Promise<HTMLCanvasElement> {
  const { set, room, stack, figure } = spec;
  const mode = spec.outside ?? "art";
  const files = stack.layers.map((name) => (name.startsWith("~") ? null : lib.url(set, room, name)));
  const maskUrl = lib.url(set, room, "glass_mask");
  const [imgs, mask] = await Promise.all([
    Promise.all(files.map((u) => (u ? loadImage(u) : Promise.resolve(null)))),
    mode === "art" && maskUrl && stack.outside > 0 ? glassAlpha(maskUrl) : Promise.resolve(null),
  ]);

  const c = canvas();
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = mode === "magenta" ? "#ff00ff" : mode === "navy" ? "#141e46" : BACKDROP;
  ctx.fillRect(0, 0, W, H);

  // 窗外一组：单独叠，按玻璃掩码裁，垫在室内层下面
  if (mode === "art" && stack.outside > 0) {
    const o = canvas();
    const octx = o.getContext("2d")!;
    for (let i = 0; i < stack.outside; i++) {
      const img = imgs[i];
      if (img) octx.drawImage(img, 0, 0, W, H);
      else if (stack.layers[i] === STAND_IN.nightOutside) {
        octx.globalCompositeOperation = "source-atop";
        octx.fillStyle = "rgba(6,12,34,.68)";
        octx.fillRect(0, 0, W, H);
        octx.globalCompositeOperation = "source-over";
      }
    }
    if (mask) {
      octx.globalCompositeOperation = "destination-in";
      octx.drawImage(mask, 0, 0);
    }
    ctx.drawImage(o, 0, 0);
  }

  for (let i = stack.outside; i < stack.layers.length; i++) {
    if (figure && i === stack.figureAt) drawFigure(ctx, figure);
    const img = imgs[i];
    if (img) ctx.drawImage(img, 0, 0, W, H);
    else if (stack.layers[i] === STAND_IN.nightRoom) {
      ctx.fillStyle = "rgba(8,12,30,.5)";
      ctx.fillRect(0, 0, W, H);
    }
  }
  if (figure && stack.figureAt >= stack.layers.length) drawFigure(ctx, figure);
  return c;
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
  const full = await composeFull(lib, spec);
  return { key: sceneKey(spec), levels: pyramid(full, smallest) };
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

/** 从不比画布小的最小一级平滑缩到画布大小 */
export function blit(composed: Composed, c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const src = composed.levels.filter((l) => l.width >= c.width).at(-1) ?? composed.levels[0];
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return ctx;
}
