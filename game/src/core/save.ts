// 存档：整局游戏就是一份 JSON。世界停住时它不变；重开以后从这一刻接着走，不补离开的时间。
import { seasonOf } from "./calendar.ts";
import { AREA_BY_ID, DISPLAY_SLOT_IDS, emptyDisplay, KEEPSAKE_BY_ID } from "./content.ts";
import { SAVE_VERSION, type Game } from "./game.ts";
import { fitsOf, freeNow } from "./keepsakes.ts";
import { fullBody } from "./outing.ts";
import { ROOM_IDS } from "./rooms.ts";
import { emptyRooms } from "./telemetry.ts";
import type { OutingState } from "./state.ts";
import { minutesToDoor } from "./wild.ts";

export interface SaveFile {
  version: number;
  savedWall: number;
  game: Game;
}

export function serialize(g: Game, wall: number): string {
  const file: SaveFile = { version: SAVE_VERSION, savedWall: wall, game: g };
  return JSON.stringify(file);
}

export function deserialize(text: string): SaveFile {
  const file = JSON.parse(text) as SaveFile;
  if (typeof file !== "object" || file === null || typeof file.version !== "number" || !file.game) {
    throw new Error("存档格式不对");
  }
  if (file.version > SAVE_VERSION) throw new Error(`存档来自更新的版本（${file.version}），这一版读不了`);
  // 以后改了存档结构，在这里按 version 一级级迁移
  repair(file.game);
  return file;
}

/** 读档时补上老存档没有的字段，修掉命令走不到、只有存档坏了才会有的组合 */
function repair(g: Game): void {
  // 氛围态却没有选的画面：回到真实的今天（世界本来就停着，不补时间）
  if (g.mode === "ambience" && !g.ambience) g.mode = "companion";
  // 镜头还是雪窗、炉边、全景时的指标：不是世界事实，按四间清零重记
  if (!ROOM_IDS.every((r) => typeof g.telemetry.visibleAwake[r] === "number")) g.telemetry.visibleAwake = emptyRooms();
  const w = g.world;
  w.wild ??= { taken: {}, harvested: {} };
  // 还没记世界年开始时间的老存档：到今天为止的每一年都不知道对应哪段现实时间，年册的现实一栏照实说
  if (!g.yearWalls) {
    g.yearWalls = {};
    for (let y = 0; y <= seasonOf(w.day).year; y++) g.yearWalls[y] = null;
  }
  // 还没有藏品和展示位的老存档：刻好的木雕按当时的说法已经摆上了，照找空位的先后直接摆好，摆不下的收进手记
  w.intents.arrange ??= [];
  if (!w.keepsakes) {
    w.keepsakes = [];
    w.display = emptyDisplay();
    for (let i = 1; i <= (w.carvings ?? 0); i++) {
      const uid = `carving#${i}`;
      w.keepsakes.push({ uid, id: "carving", day: w.day });
      const slot = fitsOf(KEEPSAKE_BY_ID.carving).find((s) => freeNow(w, s) > 0);
      if (slot) w.display[slot].push(uid);
    }
  }
  w.display ??= emptyDisplay();
  for (const s of DISPLAY_SLOT_IDS) w.display[s] ??= [];
  // 野外还只有「离家门几分钟」的老存档：带出去的柴捆按根放进背包，身体是满的，人在区域的入口
  const o = w.outing as (OutingState & { bundles?: number }) | null;
  if (o) o.found ??= [];
  if (o && !o.body) {
    o.bag = o.bundles ? { wood: o.bundles * 3 } : {};
    delete o.bundles;
    o.body = fullBody();
    o.campfire = null;
    o.last = null;
    o.reminded = { ...o.reminded, cold: false, tired: false };
    const area = o.area ? AREA_BY_ID[o.area] : undefined;
    o.area = area ? area.id : null;
    o.pos = area ? { ...area.entry } : null;
    o.minutesFromDoor = area ? minutesToDoor(area, area.entry) : 0;
  }
}
