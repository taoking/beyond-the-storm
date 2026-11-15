/// <reference types="vite/client" />
// 美术查看页（开发用，不是游戏）：选一套素材、一间屋，按画面状态叠图层，
// 在 1280×720、480×270、320×180 三种真实窗口尺寸下平滑缩放着看。状态可以手动拨，也可以接世界快照。
import { advanceCompanionMinutes, newGame, type Game } from "../core/game.ts";
import { localCalendar } from "../core/focus.ts";
import { clockText } from "../core/calendar.ts";
import { ROOM_IDS, type RoomId } from "../core/rooms.ts";
import { present, type Snapshot } from "../core/view.ts";
import { artFromSnapshot, EMPTY_STATE, layerStack, MANAGED, type ArtState } from "./layers.ts";

const W = 2560;
const H = 1440;
const ROOM_NAME: Record<RoomId, string> = { hearth_room: "炉间", observation_room: "观测间", kitchen_room: "灶间", bedroom: "卧室" };
const POSE_NAME: Record<string, string> = {
  sleep: "睡", sit: "坐", sitRead: "坐着读", sitWrite: "坐着写", sitHold: "坐着端", standWork: "站着干活", standLook: "站着看", crouch: "蹲", walk: "走",
};

// ---- 素材：按 套/房间/图层名 索引 ----

type Pt = number[];
interface RoomJson {
  rooms: Record<string, {
    name: string;
    status?: string;
    source?: string;
    windows: { panesCanvasPolygons: Pt[][] }[];
    doorways: { to: string; polygon?: Pt[] }[];
    displaySlots: { id: string; rect: number[] }[];
    actor?: { rect: number[]; pose?: string };
    lampAnchor: Pt;
  }>;
  locations: Record<string, { room?: string | null; label: string; footAnchor?: Pt | null; standingHeightPx?: number | null }>;
}

const FILE_URLS = import.meta.glob("../../../assets/05/rooms/*/*/*.{webp,png}", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const JSONS = import.meta.glob("../../../assets/05/rooms/*/room_locations.json", { import: "default", eager: true }) as Record<string, RoomJson>;

const files = new Map<string, string>(); // "套/房间/名字" → url
for (const [path, url] of Object.entries(FILE_URLS)) {
  const m = path.match(/rooms\/([^/]+)\/([^/]+)\/([^/]+)\.(webp|png)$/);
  if (m) files.set(`${m[1]}/${m[2]}/${m[3]}`, url);
}
const coords = new Map<string, RoomJson>();
for (const [path, json] of Object.entries(JSONS)) {
  const m = path.match(/rooms\/([^/]+)\/room_locations\.json$/);
  if (m) coords.set(m[1], json);
}
/** 新的在前：按目录名末尾的日期排 */
const SETS = [...coords.keys()].sort((a, b) => (b.split("_").at(-1) ?? "").localeCompare(a.split("_").at(-1) ?? ""));

const layerNames = (set: string, room: RoomId): string[] =>
  [...files.keys()].filter((k) => k.startsWith(`${set}/${room}/`)).map((k) => k.split("/")[2]).sort();

const images = new Map<string, Promise<HTMLImageElement>>();
function load(url: string): Promise<HTMLImageElement> {
  let p = images.get(url);
  if (!p) {
    const img = new Image();
    img.src = url;
    p = img.decode().then(() => img);
    images.set(url, p);
  }
  return p;
}

// ---- 世界：从新开局按陪伴状态走到指定的那一刻 ----

let game: Game | null = null;
let gameSeed = 0;
function worldAt(seed: number, day: number, minute: number): Snapshot {
  const target = (day - 1) * 1440 + minute;
  const now = (g: Game): number => g.world.day * 1440 + g.world.minute;
  if (!game || gameSeed !== seed || now(game) > target) {
    game = newGame(seed);
    gameSeed = seed;
  }
  advanceCompanionMinutes(game, Math.max(0, target - now(game)));
  return present(game, Date.now(), localCalendar);
}

// ---- 控件 ----

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const val = (id: string): string => $<HTMLInputElement>(id).value;
const on = (id: string): boolean => $<HTMLInputElement>(id).checked;

const ui = {
  set: SETS[0] ?? "",
  room: "observation_room" as RoomId,
  source: "manual" as "manual" | "world",
  props: new Set<string>(),
};

const SAVED = ["seed", "day", "minute", "time", "weather", "fire", "wood", "food", "lamp", "heater", "actor", "outside", "ovFoot", "ovPane", "ovDoor", "ovSlot", "ovActor", "ovSmall"];
const STORE = "bts-art-viewer";
function save(): void {
  const o: Record<string, unknown> = { set: ui.set, room: ui.room, source: ui.source, props: [...ui.props] };
  for (const id of SAVED) {
    const el = $<HTMLInputElement>(id);
    o[id] = el.type === "checkbox" ? el.checked : el.value;
  }
  try {
    localStorage.setItem(STORE, JSON.stringify(o));
  } catch {
    // 存不了就算了，下次从默认开始
  }
}
function restore(): void {
  let o: Record<string, unknown> = {};
  try {
    o = JSON.parse(localStorage.getItem(STORE) ?? "{}");
  } catch {
    return;
  }
  if (typeof o.set === "string" && SETS.includes(o.set)) ui.set = o.set;
  if (ROOM_IDS.includes(o.room as RoomId)) ui.room = o.room as RoomId;
  if (o.source === "world" || o.source === "manual") ui.source = o.source;
  if (Array.isArray(o.props)) ui.props = new Set(o.props.map(String));
  for (const id of SAVED) {
    const el = $<HTMLInputElement>(id);
    if (!(id in o)) continue;
    if (el.type === "checkbox") el.checked = Boolean(o[id]);
    else el.value = String(o[id]);
  }
}

function segment(box: HTMLElement, items: [string, string][], current: () => string, pick: (v: string) => void): void {
  box.replaceChildren(
    ...items.map(([v, label]) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.setAttribute("aria-pressed", String(v === current()));
      b.onclick = () => {
        pick(v);
        refresh();
      };
      return b;
    }),
  );
}

/** 这一间里不归 MANAGED 管的物件图层，各给一个开关 */
function buildProps(): void {
  const names = layerNames(ui.set, ui.room).filter((n) => !MANAGED.has(n));
  const box = $("props");
  box.replaceChildren(
    ...names.map((n) => {
      const l = document.createElement("label");
      const c = document.createElement("input");
      c.type = "checkbox";
      c.checked = ui.props.has(n);
      c.onchange = () => {
        if (c.checked) ui.props.add(n);
        else ui.props.delete(n);
        render();
      };
      l.append(c, n);
      return l;
    }),
  );
}

function buildDummy(): void {
  const sel = $<HTMLSelectElement>("dummy");
  const keep = sel.value;
  const locs = Object.entries(coords.get(ui.set)?.locations ?? {}).filter(([, l]) => l.room === ui.room && l.footAnchor);
  sel.replaceChildren(new Option("（不画）", ""), ...locs.map(([id, l]) => new Option(l.label, id)));
  sel.value = locs.some(([id]) => id === keep) ? keep : "";
}

function refresh(): void {
  const sets = $<HTMLSelectElement>("set");
  if (!sets.options.length) sets.append(...SETS.map((s) => new Option(s, s)));
  sets.value = ui.set;
  segment($("rooms"), ROOM_IDS.map((r) => [r, ROOM_NAME[r]]), () => ui.room, (v) => (ui.room = v as RoomId));
  segment($("source"), [["manual", "手动"], ["world", "接世界"]], () => ui.source, (v) => (ui.source = v as "manual" | "world"));
  $<HTMLFieldSetElement>("world").disabled = ui.source !== "world";
  $<HTMLFieldSetElement>("manual").disabled = ui.source !== "manual";
  buildProps();
  buildDummy();
  render();
}

// ---- 画 ----

interface Figure {
  foot: Pt;
  height: number;
  pose: string;
}

function drawFigure(ctx: CanvasRenderingContext2D, f: Figure): void {
  const [x, y] = f.foot;
  const h = f.height;
  ctx.save();
  ctx.fillStyle = "rgba(228,178,118,.55)";
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

function compose(imgs: { name: string; img: HTMLImageElement }[], outside: string, figure: Figure | null): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  if (outside !== "art") {
    ctx.fillStyle = outside === "magenta" ? "#ff00ff" : "#141e46";
    ctx.fillRect(0, 0, W, H);
  }
  for (const { name, img } of imgs) {
    if (outside !== "art" && (name.startsWith("outside_") || name.startsWith("weather_"))) continue;
    ctx.drawImage(img, 0, 0, W, H);
    // 人形画在人物图层那一档：比家具靠前、比夜色和火光靠后
    if (figure && name === "interior_rgba") drawFigure(ctx, figure);
  }
  return c;
}

/** 逐级减半，留着每一级，小画布从最近的一级缩 */
function pyramid(src: HTMLCanvasElement, smallest: number): HTMLCanvasElement[] {
  const out = [src];
  let cur = src;
  while (cur.width / 2 >= smallest) {
    const c = document.createElement("canvas");
    c.width = Math.round(cur.width / 2);
    c.height = Math.round(cur.height / 2);
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(cur, 0, 0, c.width, c.height);
    out.push(c);
    cur = c;
  }
  return out;
}

function overlays(ctx: CanvasRenderingContext2D, json: RoomJson, room: RoomId, dpr: number, here: string | null): void {
  const r = json.rooms[room];
  if (!r) return;
  const k = ctx.canvas.width / W;
  const P = (p: Pt): [number, number] => [p[0] * k, p[1] * k];
  const line = (pts: Pt[], color: string, close = true): void => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(...P(p)) : ctx.moveTo(...P(p))));
    if (close) ctx.closePath();
    ctx.strokeStyle = color;
    ctx.stroke();
  };
  ctx.save();
  ctx.lineWidth = 1.5 * dpr;
  ctx.font = `${11 * dpr}px -apple-system, "PingFang SC", sans-serif`;
  if (on("ovPane")) for (const w of r.windows) for (const p of w.panesCanvasPolygons) line(p, "#00e5ff");
  if (on("ovDoor")) for (const d of r.doorways) if (d.polygon) {
    line(d.polygon, "#7fd4ff");
    ctx.fillStyle = "#7fd4ff";
    ctx.fillText(`门洞 → ${d.to}`, ...P([d.polygon[0][0] + 10, d.polygon[0][1] + 40]));
  }
  if (on("ovSlot")) for (const s of r.displaySlots) {
    const [x, y, w, h] = s.rect;
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    line([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], "#8dff8d");
    ctx.setLineDash([]);
    ctx.fillStyle = "#8dff8d";
    ctx.fillText(s.id, ...P([x + 8, y - 10]));
  }
  if (on("ovActor")) {
    if (r.actor) {
      const [x, y, w, h] = r.actor.rect;
      line([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], "#ffb347");
      ctx.fillStyle = "#ffb347";
      ctx.fillText(`人物框 ${r.actor.pose ?? ""}`, ...P([x + 8, y + 36]));
    }
    ctx.beginPath();
    ctx.arc(...P(r.lampAnchor), 5 * dpr, 0, Math.PI * 2);
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  }
  if (on("ovFoot")) for (const [id, l] of Object.entries(json.locations)) {
    if (l.room !== room || !l.footAnchor) continue;
    const color = id === here ? "#ffe24d" : "#ff5a5a";
    const [x, y] = P(l.footAnchor);
    const h = (l.standingHeightPx ?? 0) * k;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 3.5 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - h);
    ctx.stroke();
    ctx.fillText(`${l.label} ${id}`, x + 6 * dpr, y - 4 * dpr);
  }
  ctx.restore();
}

const TARGETS: [string, number, number][] = [["c1280", 1280, 720], ["c480", 480, 270], ["c320", 320, 180]];
let token = 0;

async function render(): Promise<void> {
  const my = ++token;
  save();
  const set = ui.set;
  const room = ui.room;
  const json = coords.get(set);
  const have = (n: string): boolean => files.has(`${set}/${room}/${n}`);

  let state: ArtState;
  let notes: string[] = [];
  let snap: Snapshot | null = null;
  let figure: Figure | null = null;
  let here: string | null = null;
  if (ui.source === "world") {
    $("clock").textContent = clockText(Number(val("minute")));
    $("status").textContent = "世界在走……";
    await new Promise(requestAnimationFrame);
    snap = worldAt(Math.max(1, Number(val("seed")) || 1), Math.max(1, Number(val("day")) || 1), Number(val("minute")));
    ({ state, notes } = artFromSnapshot(snap, room));
    if (snap.stage.visible[room] && snap.stage.place) {
      here = snap.stage.place;
      const l = json?.locations[here];
      // 人物图层是固定的单帧试摆，跟他实际的地点、姿态对不上；站位用人形标出来
      if (l?.footAnchor) figure = { foot: l.footAnchor, height: l.standingHeightPx ?? 600, pose: snap.stage.pose ?? "standLook" };
    }
  } else {
    state = {
      ...EMPTY_STATE,
      time: val("time") as ArtState["time"],
      weather: val("weather") as ArtState["weather"],
      fire: val("fire") as ArtState["fire"],
      wood: Number(val("wood")) as ArtState["wood"],
      food: val("food") as ArtState["food"],
      props: [...ui.props].filter(have),
      lamp: on("lamp"),
      heater: on("heater"),
      actor: on("actor"),
    };
    const d = val("dummy");
    const l = d ? json?.locations[d] : undefined;
    if (l?.footAnchor) {
      here = d;
      figure = { foot: l.footAnchor, height: l.standingHeightPx ?? 600, pose: d === "bed" ? "sleep" : "standLook" };
    }
  }

  const stack = layerStack(have, room, state);
  $("status").textContent = have("interior_rgba") ? `读图中（${stack.layers.length} 层）……` : `${set} 里还没有${ROOM_NAME[room]}的底图`;
  const imgs = await Promise.all(stack.layers.map(async (name) => ({ name, img: await load(files.get(`${set}/${room}/${name}`)!) })));
  if (my !== token) return;

  const full = compose(imgs, val("outside"), figure);
  const dpr = window.devicePixelRatio || 1;
  const levels = pyramid(full, 320 * dpr);
  for (const [id, w, h] of TARGETS) {
    const c = $<HTMLCanvasElement>(id);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const src = levels.filter((l) => l.width >= c.width).at(-1) ?? full;
    ctx.drawImage(src, 0, 0, c.width, c.height);
    if (json && (id === "c1280" || on("ovSmall"))) overlays(ctx, json, room, dpr, here);
  }
  $("status").textContent = "";
  info(set, room, json, stack, notes, snap);
}

function info(set: string, room: RoomId, json: RoomJson | undefined, stack: { layers: string[]; missing: string[] }, notes: string[], snap: Snapshot | null): void {
  const r = json?.rooms[room];
  const lines: [string, string?][] = [
    [`<b>${set} · ${ROOM_NAME[room]}</b>${r?.status ? ` · ${r.status}` : ""}${r?.source ? ` · ${r.source}` : ""}`],
    [`叠了 ${stack.layers.length} 层（下→上）：${stack.layers.join("、") || "无"}`],
  ];
  if (stack.missing.length) lines.push([`这套没有：${stack.missing.join("、")}`, "miss"]);
  if (snap) {
    const s = snap;
    const where = s.stage.visible[room]
      ? `在这间：${s.stage.label}（${POSE_NAME[s.stage.pose ?? ""] ?? s.stage.pose ?? "—"}）`
      : `不在这间：${s.actor.whereabouts || s.stage.label}`;
    lines.push([`世界：${s.world.dayLabel} ${s.world.clock} · ${s.look.dayPart} · ${s.look.weatherLabel} · 炉火 ${s.fire.look} · 柴 ${Math.round(s.stock.wood)}/${s.stock.woodCap} · 粮 ${Math.round(s.stock.food)}/${s.stock.foodCap} · ${s.life.mood}`]);
    lines.push([where]);
    for (const n of notes) lines.push([n, "miss"]);
  }
  $("info").innerHTML = lines.map(([t, cls]) => `<p${cls ? ` class="${cls}"` : ""}>${t}</p>`).join("");
}

// ---- 接线 ----

restore();
$<HTMLSelectElement>("set").onchange = () => {
  ui.set = val("set");
  refresh();
};
for (const id of ["time", "weather", "fire", "wood", "food", "lamp", "heater", "actor", "dummy", "outside", "ovFoot", "ovPane", "ovDoor", "ovSlot", "ovActor", "ovSmall", "seed", "day", "minute"]) {
  $(id).addEventListener(id === "minute" ? "input" : "change", () => void render());
}
const step = (min: number): void => {
  let m = Number(val("minute")) + min;
  let d = Number(val("day"));
  while (m >= 1440) (m -= 1440), d++;
  while (m < 0) (m += 1440), d--;
  if (d < 1) (d = 1), (m = 0);
  $<HTMLInputElement>("minute").value = String(m);
  $<HTMLInputElement>("day").value = String(d);
  void render();
};
$("back1h").onclick = () => step(-60);
$("next1h").onclick = () => step(60);
$("nextDay").onclick = () => step(1440);
refresh();
