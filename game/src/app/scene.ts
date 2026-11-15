// 灰盒场景：色块和文字，只为看清「人在哪、在做什么、火怎么样」。
// 一次只画一间（03 第 3.1 节），坐标全是 room_locations.json 的 2560×1440，按画布大小平滑缩放。
import { PLACES, type PlaceId } from "../core/content.ts";
import { CANVAS, LOCATIONS, placesIn, ROOMS, roomOf, type RoomId } from "../core/rooms.ts";
import type { Snapshot } from "../core/view.ts";
import type { WeatherArtKey } from "../core/weather.ts";

const [CW, CH] = CANVAS;

const ROOM_COLOR: Record<RoomId, string> = {
  hearth_room: "#241d19",
  observation_room: "#1b242a",
  kitchen_room: "#1f2320",
  bedroom: "#1f1d26",
};
const FIRE_COLOR: Record<string, string> = { out: "#2a2f33", ember: "#7a3b2a", low: "#c9793f", mid: "#f0a04b", high: "#ffcf6b" };
/** 灰盒按 G2 的稳定素材键绘色。以后只须替换成真实天气贴图，不解析天气中文字。 */
const WEATHER_COLOR: Record<WeatherArtKey, string> = {
  clear: "#80a6c3",
  cloudy: "#708fa6",
  lightSnow: "#9eb4c5",
  heavySnow: "#889fb3",
  blizzard: "#687c95",
  coldRain: "#596f88",
  fog: "#9aa8ab",
  freezingRain: "#677d90",
  thunderstorm: "#3b526d",
};
const TRACE_NAME: Record<string, string> = {
  bowl: "碗",
  cup: "杯",
  bucket: "桶",
  kettleSteam: "汽",
  wetBoots: "靴",
  projectTools: "具",
  openBook: "书",
  openJournal: "记",
};

function poly(ctx: CanvasRenderingContext2D, pts: [number, number][]): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

const foot = (p: PlaceId): [number, number] => LOCATIONS[p]?.foot ?? [CW / 2, CH * 0.8];

/** 竖着的一根柱子，高度跟着 0..1 的比例走（柴堆、储物架上的粮） */
function bar(ctx: CanvasRenderingContext2D, at: [number, number], ratio: number, color: string): void {
  const h = Math.round(Math.max(0, Math.min(1, ratio)) * 260);
  ctx.fillStyle = "#2c3a43";
  ctx.fillRect(at[0] - 40, at[1] - 300, 80, 260);
  ctx.fillStyle = color;
  ctx.fillRect(at[0] - 40, at[1] - 40 - h, 80, h);
}

export function drawRoom(ctx: CanvasRenderingContext2D, snap: Snapshot, room: RoomId): void {
  const def = ROOMS[room];
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.scale(ctx.canvas.width / CW, ctx.canvas.height / CH);
  ctx.fillStyle = ROOM_COLOR[room];
  ctx.fillRect(0, 0, CW, CH);
  ctx.fillStyle = "#151b20";
  ctx.fillRect(0, CH * 0.68, CW, CH * 0.32);

  // 窗外是独立的展示投影：正常显示真实天气，氛围只显示选中的演出天气。
  const look = snap.look;
  for (const pane of def.panes) {
    poly(ctx, pane);
    ctx.fillStyle = WEATHER_COLOR[look.weatherKey ?? "cloudy"];
    ctx.fill();
    if (look.time === "night" || look.time === "dusk") {
      ctx.fillStyle = look.time === "night" ? "rgba(6,12,34,.64)" : "rgba(31,27,54,.24)";
      ctx.fill();
    }
  }
  if (def.panes[0]) {
    // 字写在最宽的那块玻璃左上角
    const width = (pane: [number, number][]): number => Math.max(...pane.map((p) => p[0])) - Math.min(...pane.map((p) => p[0]));
    const widest = def.panes.reduce((a, b) => (width(b) > width(a) ? b : a));
    const [x, y] = widest.reduce((m, p) => (p[0] + p[1] < m[0] + m[1] ? p : m));
    ctx.fillStyle = "#101820";
    ctx.font = "40px sans-serif";
    ctx.fillText(look.source === "ambience" ? `（氛围）${look.weatherLabel}` : look.weatherLabel, x + 24, y + 60);
  }

  // 门洞和展示位
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#3d4d57";
  for (const d of def.doorways) {
    if (!d.polygon) continue;
    poly(ctx, d.polygon);
    ctx.stroke();
  }
  ctx.setLineDash([16, 12]);
  ctx.strokeStyle = "#5d717d";
  for (const s of def.displaySlots) ctx.strokeRect(...s.rect);
  ctx.setLineDash([]);

  // 灯：起初是油灯，修好太阳能板后是电灯；灰盒只标个位置
  ctx.fillStyle = "#e4b27666";
  ctx.beginPath();
  ctx.arc(def.lamp[0], def.lamp[1], 22, 0, Math.PI * 2);
  ctx.fill();

  // 跟着状态变的东西
  if (room === "hearth_room") {
    const [x, y] = foot("hearth");
    ctx.fillStyle = FIRE_COLOR[snap.fire.look] ?? "#333";
    ctx.fillRect(x - 110, y - 330, 220, 180);
    bar(ctx, foot("woodpile"), snap.stock.wood / snap.stock.woodCap, "#876448");
  }
  if (room === "kitchen_room") bar(ctx, foot("shelf"), snap.stock.food / snap.stock.foodCap, "#9aa36a");
  if (room === "observation_room") {
    const [x, y] = foot("windowsill");
    ctx.strokeStyle = "#c7d8de";
    ctx.lineWidth = 4;
    ctx.strokeRect(x - 20, y - 120, 40, 60);
    const fill = Math.round((snap.jar.cones / 30) * 60);
    ctx.fillStyle = "#b28b63";
    ctx.fillRect(x - 20, y - 60 - fill, 40, fill);
  }

  // 地点
  ctx.font = "44px sans-serif";
  for (const id of placesIn(room)) {
    const [x, y] = foot(id);
    ctx.fillStyle = "#2c3a43";
    ctx.fillRect(x - 14, y - 14, 28, 28);
    ctx.fillStyle = "#7d919d";
    ctx.fillText(PLACES[id].name, x + 24, y + 14);
  }

  // 真实动作留下的小痕迹
  ctx.fillStyle = "#e4b276";
  for (const t of snap.traces) {
    if (roomOf(t.place) !== room) continue;
    const [x, y] = foot(t.place);
    ctx.fillText(TRACE_NAME[t.type] ?? "·", x - 70, y - 30);
  }

  // 人：站位读 JSON 的脚底和身高；睡着是横着的
  if (snap.stage.room === room && snap.stage.place) {
    const [x, y] = foot(snap.stage.place);
    const h = LOCATIONS[snap.stage.place]?.heightPx ?? 600;
    ctx.fillStyle = snap.stage.illusion ? "#7193ac" : snap.stage.outfit === "outdoor" ? "#a65049" : "#e4b276";
    const sitting = snap.stage.pose?.startsWith("sit") || snap.stage.pose === "crouch";
    if (snap.stage.pose === "sleep") ctx.fillRect(x - h * 0.5, y - h * 0.18, h, h * 0.14);
    else {
      const bodyH = sitting ? h * 0.62 : h;
      ctx.fillRect(x - h * 0.1, y - bodyH, h * 0.2, bodyH);
    }
    if (snap.actor.asleep && !snap.stage.illusion) {
      ctx.fillStyle = "#c7d8de";
      ctx.fillText("zz", x + h * 0.5, y - h * 0.2);
    }
  }
  ctx.restore();
}

export function roomCaption(snap: Snapshot, room: RoomId, size: string): string {
  // 文案按演出位置判断，不能用真实 actor.room 去判断冻结的幻影人物。
  const where = snap.stage.room === room ? "看得见人" : `空屋 · ${snap.stage.show ? snap.actor.whereabouts : snap.stage.label}`;
  return `${size} · ${ROOMS[room].name} · ${where}`;
}
