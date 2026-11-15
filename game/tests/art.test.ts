// 美术查看页的图层逻辑（src/art/layers.ts）：画面状态 → 叠哪些图层，世界快照 → 画面状态。
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { artFromSnapshot, EMPTY_STATE, layerStack } from "../src/art/layers.ts";
import { localCalendar } from "../src/core/focus.ts";
import { advanceCompanionMinutes, newGame } from "../src/core/game.ts";
import { ROOM_IDS } from "../src/core/rooms.ts";
import { present } from "../src/core/view.ts";

const ROOMS = new URL("../../assets/05/rooms/", import.meta.url);
const haveIn = (set: string, room: string): ((n: string) => boolean) => {
  let names: string[] = [];
  try {
    names = readdirSync(new URL(`${set}/${room}/`, ROOMS)).map((f) => f.replace(/\.(webp|png)$/, ""));
  } catch {
    // 这一套还没有这间
  }
  return (n) => names.includes(n);
};

describe("图层顺序", () => {
  it("窗外最下，再是室内层和天气；夜色、火光、灯在人物之上", () => {
    const s = layerStack(haveIn("g5_20261115", "hearth_room"), "hearth_room", {
      ...EMPTY_STATE, time: "night", weather: "snow", fire: "high", wood: 3, props: ["armchair_blanket"], lamp: true, actor: true,
    });
    expect(s.missing).toEqual([]);
    expect(s.layers).toEqual([
      "outside_winter_night_rgba", "interior_rgba", "weather_snow", "woodpile_3", "armchair_blanket",
      "actor_contact", "actor_male_pose", "night_ambient", "fire_spill_high", "fire_flame_high", "oil_lamp_body", "oil_lamp_glow",
    ]);
  });

  it("厚被子盖在人物上面", () => {
    const s = layerStack(haveIn("g5_20261115", "bedroom"), "bedroom", { ...EMPTY_STATE, props: ["quilt_thick"], actor: true });
    expect(s.layers.indexOf("quilt_thick")).toBeGreaterThan(s.layers.indexOf("bed_front_occlusion"));
  });

  it("批次 1 的新底图用晴天窗外层，没有的图层报出来", () => {
    const s = layerStack(haveIn("b1_20261116", "hearth_room"), "hearth_room", { ...EMPTY_STATE, time: "night", fire: "low" });
    expect(s.layers).toEqual(["interior_rgba"]);
    expect(s.missing).toContain("outside_winter_night_rgba");
    expect(s.missing).toContain("fire_flame_low");
    const day = layerStack(haveIn("b1_20261116", "observation_room"), "observation_room", EMPTY_STATE);
    expect(day.layers).toEqual(["outside_winter_day_clear_rgba", "interior_rgba"]);
  });
});

describe("世界快照 → 画面状态", () => {
  it("一个月里每一刻：看得见人只在他所在的那一间，柴堆档位跟着库存", () => {
    const g = newGame(7);
    for (let i = 0; i < 30 * 24; i++) {
      advanceCompanionMinutes(g, 60);
      const snap = present(g, 0, localCalendar);
      for (const room of ROOM_IDS) {
        const { state } = artFromSnapshot(snap, room);
        expect(state.actor).toBe(snap.stage.room === room);
        if (snap.stock.wood <= 0) expect(state.wood).toBe(0);
        else expect(state.wood).toBeGreaterThan(0);
        if (state.lamp) expect(state.time).toBe("night");
      }
    }
  });
});
