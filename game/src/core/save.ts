// 存档：整局游戏就是一份 JSON。世界停住时它不变；重开以后从这一刻接着走，不补离开的时间。
import { AREA_BY_ID } from "./content.ts";
import { SAVE_VERSION, type Game } from "./game.ts";
import { fullBody } from "./outing.ts";
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
  const w = g.world;
  w.wild ??= { taken: {}, harvested: {} };
  // 野外还只有「离家门几分钟」的老存档：带出去的柴捆按根放进背包，身体是满的，人在区域的入口
  const o = w.outing as (OutingState & { bundles?: number }) | null;
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
