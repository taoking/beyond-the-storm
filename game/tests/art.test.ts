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
    const s = layerStack(haveIn("b1_20261116", "hearth_room"), "hearth_room", { ...EMPTY_STATE, time: "night", fire: "low", oilLamp: false });
    expect(s.layers).toEqual(["interior_rgba", "radio_broken", "gramophone_covered", "fire_flame_low"]);
    expect(s.missing).toEqual(["outside_winter_night_rgba", "night_ambient", "fire_spill_low"]);
  });

  it("批次 2：收音机、唱片机没修好画旧的，修好换新的", () => {
    const have = haveIn("b1_20261116", "hearth_room");
    const day = { ...EMPTY_STATE, wood: 4 as const, fire: "mid" as const, props: ["kettle", "armchair_blanket"] };
    expect(layerStack(have, "hearth_room", day).layers).toEqual([
      "outside_winter_day_clear_rgba", "interior_rgba", "woodpile_4", "radio_broken", "gramophone_covered", "kettle", "armchair_blanket",
      "fire_flame_mid", "oil_lamp_body",
    ]);
    const fixed = layerStack(have, "hearth_room", { ...day, props: ["radio_fixed", "gramophone_open"] }).layers;
    expect(fixed).toContain("radio_fixed");
    expect(fixed).not.toContain("radio_broken");
    expect(fixed).not.toContain("gramophone_covered");
  });
});

describe("档位", () => {
  it("中火：有 fire_flame_mid 用它，旧套没有就退回小火；柴堆 0 档在新套里就是底图", () => {
    const old = layerStack(haveIn("g5_20261115", "hearth_room"), "hearth_room", { ...EMPTY_STATE, fire: "mid" });
    expect(old.layers).toContain("fire_flame_low");
    const mid = layerStack((n) => n === "interior_rgba" || n === "fire_flame_mid", "hearth_room", { ...EMPTY_STATE, fire: "mid", oilLamp: false });
    expect(mid.layers).toContain("fire_flame_mid");
    const empty = layerStack(haveIn("b1_20261116", "hearth_room"), "hearth_room", { ...EMPTY_STATE, wood: 0, oilLamp: false });
    expect(empty.missing).toEqual([]);
  });
});

describe("世界快照 → 画面状态", () => {
  it("粮分三段、罐子分三档，做完的项目换图层", () => {
    const snap = present(newGame(3), 0, localCalendar);
    const at = (food: number, cones: number) => ({ ...snap, stock: { ...snap.stock, food, foodCap: 60 }, jar: { ...snap.jar, cones } });
    expect(artFromSnapshot(at(0, 0), "kitchen_room").state.food).toBe("none");
    expect(artFromSnapshot(at(10, 0), "kitchen_room").state.food).toBe("sparse");
    expect(artFromSnapshot(at(30, 0), "kitchen_room").state.food).toBe("half");
    expect(artFromSnapshot(at(60, 0), "kitchen_room").state.food).toBe("full");
    expect([0, 5, 15, 29].map((c) => artFromSnapshot(at(30, c), "observation_room").state.jar)).toEqual([0, 1, 2, 3]);

    const done = (id: string) => ({ ...snap, projects: [...snap.projects.filter((p) => p.id !== id), { ...snap.projects[0], id, stages: 2, stage: 2 }] });
    expect(artFromSnapshot(snap, "hearth_room").state.props).not.toContain("radio_fixed");
    expect(artFromSnapshot(done("radio"), "hearth_room").state.props).toContain("radio_fixed");
    expect(artFromSnapshot(done("bedding"), "bedroom").state.props).toContain("quilt_thick");
    expect(artFromSnapshot(snap, "bedroom").state.oilLamp).toBe(true);
    expect(artFromSnapshot(done("solar"), "bedroom").state.oilLamp).toBe(false);
  });


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
