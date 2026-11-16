/// <reference types="vite/client" />
// 灰盒的场景：一次只画玩家选的那一间（03 第 3.1 节），用 05 的真图。
// 选哪些图层、什么顺序是 src/art/layers.ts（美术查看页也用它），叠图和缩放是 src/art/compose.ts。
// 角色图还没出，他在这一间就在站位上画人形占位。缺的图层不画，不报错。
import { LOCATIONS, ROOMS, type RoomId } from "../core/rooms.ts";
import type { PlaceId } from "../core/content.ts";
import type { Snapshot } from "../core/view.ts";
import { artFromSnapshot, figureFromSnapshot, layerStack, type Locate } from "../art/layers.ts";
import { blit, compose, fitCanvas, GlassLoop, library, sceneKey, type Composed, type SceneSpec } from "../art/compose.ts";

// 只打包内核坐标那一套（rooms.ts 读的 room_locations.json 在同一个目录）；tests/art.test.ts 查两边一致
const LIB = library(
  import.meta.glob("../../../assets/05/rooms/b1_20261116/*/*.{webp,png}", { query: "?url", import: "default", eager: true }) as Record<string, string>,
);
const SET = LIB.sets[0] ?? "";

const locate: Locate = (place) => {
  const l = LOCATIONS[place as PlaceId];
  return l && { foot: l.foot, height: l.heightPx };
};

export function sceneSpec(snap: Snapshot, room: RoomId): SceneSpec {
  const { state } = artFromSnapshot(snap, room);
  const stack = layerStack((n) => LIB.has(SET, room, n), room, state);
  return { set: SET, room, stack, figure: figureFromSnapshot(snap, room, locate) };
}

export interface Target {
  canvas: HTMLCanvasElement;
  /** CSS 尺寸；不给就按画布现在的显示宽度、16:9 */
  css?: [number, number];
}

let shown: Composed | null = null;
let pending: string | null = null;
const painted = new WeakMap<HTMLCanvasElement, string>();
/** 下雪、窗外有小事时只在玻璃那一块逐帧补上，15 帧；后台、减弱动态效果时不动 */
const glassLoop = new GlassLoop(15);

function cssSize(t: Target): [number, number] {
  if (t.css) return t.css;
  const w = t.canvas.getBoundingClientRect().width || t.canvas.width;
  return [w, (w * 9) / 16];
}

function paintAll(c: Composed, targets: Target[]): void {
  let changed = false;
  for (const t of targets) {
    const [w, h] = cssSize(t);
    const resized = fitCanvas(t.canvas, w, h);
    const sig = `${c.key}@${t.canvas.width}`;
    if (!resized && painted.get(t.canvas) === sig) continue;
    blit(c, t.canvas);
    painted.set(t.canvas, sig);
    changed = true;
  }
  if (changed) glassLoop.play(c, targets.map((t) => t.canvas));
}

/**
 * 每拍都可以调：画面没变（图层、人形、画布像素尺寸都一样）就什么也不做；
 * 变了就在后台读图、叠好再一次换上，读图期间画布上留着上一张。
 */
export function paintRoom(targets: Target[], snap: Snapshot, room: RoomId): void {
  const spec = sceneSpec(snap, room);
  const key = sceneKey(spec);
  if (shown?.key === key) return paintAll(shown, targets);
  if (pending === key) return;
  pending = key;
  const dpr = window.devicePixelRatio || 1;
  const smallest = Math.min(...targets.map((t) => cssSize(t)[0])) * dpr;
  compose(LIB, spec, smallest).then(
    (c) => {
      if (pending !== key) return; // 读图期间又换了画面
      pending = null;
      shown = c;
      paintAll(c, targets);
    },
    (err) => {
      if (pending === key) pending = null;
      console.warn("[scene] 叠图失败", err);
    },
  );
}

export function roomCaption(snap: Snapshot, room: RoomId, size: string): string {
  // 文案按演出位置判断，不能用真实 actor.room 去判断冻结的幻影人物。
  const where = snap.stage.room === room ? "看得见人" : `空屋 · ${snap.stage.show ? snap.actor.whereabouts : snap.stage.label}`;
  // 窗外的小事：只在说明里轻轻带一句，不弹、不用点（窗沿的鸟只在观测间的窗上）
  const ev = snap.stage.windowEvent;
  const sight = ev && (ev.kind !== "bird" || room === "observation_room") ? ` · 窗外：${ev.name}` : "";
  return `${size} · ${ROOMS[room].name} · ${where}${sight}`;
}
