// 存档：整局游戏就是一份 JSON。世界停住时它不变；重开以后从这一刻接着走，不补离开的时间。
import { SAVE_VERSION, type Game } from "./game.ts";

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

/** 命令走不到、只有存档被改坏才会有的组合，读档时修回能解释的状态 */
function repair(g: Game): void {
  // 氛围态却没有选的画面：回到真实的今天（世界本来就停着，不补时间）
  if (g.mode === "ambience" && !g.ambience) g.mode = "companion";
}
