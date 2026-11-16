// 美术查看页的图层逻辑（src/art/layers.ts）：画面状态 → 叠哪些图层，世界快照 → 画面状态。
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { artFromSnapshot, blendOf, EMPTY_STATE, figureFromSnapshot, layerStack, PROCEDURAL, STAND_IN, type ArtState } from "../src/art/layers.ts";
import { eachFlake, flakeCount, SNOW, type Box } from "../src/art/snow.ts";
import { auroraStrip, birdAt, deerAt, GEESE_PASS, geeseAt, mainPane } from "../src/art/sights.ts";
import { localCalendar } from "../src/core/focus.ts";
import { advanceCompanionMinutes, newGame } from "../src/core/game.ts";
import { LOCATIONS, ROOM_IDS } from "../src/core/rooms.ts";
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
  it("窗外和天气一组在最下，再是室内层；夜色、火光、灯在人物之上", () => {
    const s = layerStack(haveIn("g5_20261115", "hearth_room"), "hearth_room", {
      ...EMPTY_STATE, time: "night", weather: "heavySnow", fire: "high", wood: 3, props: ["armchair_blanket"], lamp: true, actor: true,
    });
    // 旧套里点着的灯体还没有：灯体照旧画（在夜色下面），光照旧加
    expect(s.missing).toEqual(["oil_lamp_lit"]);
    // 旧套有 weather_snow 文件也不用：雪和雾是程序画的；夜里有火光层就不画火苗
    expect(s.layers).toEqual([
      "outside_winter_night_rgba", "~fog_heavySnow", "~snow_heavySnow", "interior_rgba", "woodpile_3", "armchair_blanket", "oil_lamp_body",
      "actor_contact", "actor_male_pose", "night_ambient", "fire_spill_high", "oil_lamp_glow",
    ]);
    expect(s.outside).toBe(3);
    expect(s.night).toBe(true);
    expect(s.layers[s.figureAt]).toBe("actor_contact");
  });

  it("厚被子盖在人物上面", () => {
    const s = layerStack(haveIn("g5_20261115", "bedroom"), "bedroom", { ...EMPTY_STATE, props: ["quilt_thick"], actor: true });
    expect(s.layers.indexOf("quilt_thick")).toBeGreaterThan(s.layers.indexOf("bed_front_occlusion"));
  });

  it("批次 1 的新底图用晴天窗外层，没有的图层报出来", () => {
    const s = layerStack(haveIn("b1_20261116", "hearth_room"), "hearth_room", { ...EMPTY_STATE, time: "night", fire: "low", oilLamp: false });
    // 夜里的窗外和夜色还没出：白天的窗外压暗、整间盖一层夜色顶着
    expect(s.layers).toEqual([
      "outside_winter_day_clear_rgba", STAND_IN.nightOutside, "interior_rgba", "radio_broken", "gramophone_covered", STAND_IN.nightRoom, "fire_flame_low",
    ]);
    expect(s.outside).toBe(2);
    expect(s.missing).toEqual(["outside_winter_night_rgba", "night_ambient", "fire_spill_low"]);
    // 人形在家具之后、夜色之前
    expect(s.layers[s.figureAt]).toBe(STAND_IN.nightRoom);
    // 图到了就不再顶替
    const real = layerStack((n) => n !== "outside_winter_day_clear_rgba", "hearth_room", { ...EMPTY_STATE, time: "night", oilLamp: false });
    expect(real.layers.filter((n) => n.startsWith("~"))).toEqual([]);
    // 一间什么都没有：空栈，不报错
    const none = layerStack(() => false, "observation_room", { ...EMPTY_STATE, time: "night", weather: "blizzard", jar: 2, actor: true });
    expect(none.layers).toEqual([]);
    expect(none.figureAt).toBe(0);
  });

  it("批次 2：收音机、唱片机没修好画旧的，修好换新的", () => {
    const have = haveIn("b1_20261116", "hearth_room");
    const day = { ...EMPTY_STATE, wood: 4 as const, fire: "mid" as const, props: ["kettle", "armchair_blanket"] };
    expect(layerStack(have, "hearth_room", day).layers).toEqual([
      "outside_winter_day_clear_rgba", "interior_rgba", "woodpile_4", "radio_broken", "gramophone_covered", "kettle", "armchair_blanket",
      "oil_lamp_body", "fire_flame_mid",
    ]);
    const fixed = layerStack(have, "hearth_room", { ...day, props: ["radio_fixed", "gramophone_open"] }).layers;
    expect(fixed).toContain("radio_fixed");
    expect(fixed).not.toContain("radio_broken");
    expect(fixed).not.toContain("gramophone_covered");
  });
});

// 批次 3 出完以后会有的全部图层（每间都假定有，只看规则）
const BATCH3 = new Set([
  "outside_winter_day_clear_rgba", "outside_winter_night_rgba", "glass_mask", "interior_rgba", "night_ambient",
  "fire_flame_ember", "fire_flame_low", "fire_flame_mid", "fire_flame_high", "fire_spill_ember", "fire_spill_low", "fire_spill_high",
  "oil_lamp_body", "oil_lamp_lit", "oil_lamp_glow", "heater_flame_on", "heater_flame_night",
]);
const b3 = (n: string): boolean => BATCH3.has(n);
const night: ArtState = { ...EMPTY_STATE, time: "night" };

describe("批次 3：夜里的图层", () => {
  it("光层用加亮叠法，在夜色上面；没点的灯体在夜色下面跟着变暗", () => {
    const s = layerStack(b3, "hearth_room", { ...night, fire: "high", lamp: true });
    expect(s.missing).toEqual([]);
    expect(s.layers).toEqual(["outside_winter_night_rgba", "interior_rgba", "night_ambient", "fire_spill_high", "oil_lamp_lit", "oil_lamp_glow"]);
    expect(s.layers.map(blendOf)).toEqual(["source-over", "source-over", "source-over", "lighter", "source-over", "lighter"]);
    for (const n of ["fire_spill_ember", "fire_spill_low", "heater_flame_night"]) expect(blendOf(n)).toBe("lighter");
    for (const n of ["fire_flame_high", "oil_lamp_body", "heater_flame_on", "night_ambient"]) expect(blendOf(n)).toBe("source-over");
    const unlit = layerStack(b3, "hearth_room", { ...night, actor: true }).layers;
    expect(unlit.indexOf("oil_lamp_body")).toBeLessThan(unlit.indexOf("night_ambient"));
    expect(unlit).not.toContain("oil_lamp_lit");
  });

  it("火光层只在夜里画；夜里炉间不画火苗，余烬用 fire_spill_ember，中火用小火那层", () => {
    const at = (s: ArtState, room: Parameters<typeof layerStack>[1] = "hearth_room") => layerStack(b3, room, { ...s, oilLamp: false });
    const day = at({ ...EMPTY_STATE, fire: "high" }).layers;
    expect(day).toContain("fire_flame_high");
    expect(day.filter((n) => n.startsWith("fire_spill"))).toEqual([]);
    const fire = (f: ArtState["fire"], room: Parameters<typeof layerStack>[1] = "hearth_room") =>
      at({ ...night, fire: f }, room).layers.filter((n) => n.startsWith("fire_"));
    expect(fire("ember")).toEqual(["fire_spill_ember"]);
    expect(fire("low")).toEqual(["fire_spill_low"]);
    expect(fire("mid")).toEqual(["fire_spill_low"]);
    expect(fire("high")).toEqual(["fire_spill_high"]);
    // 另外三间：门洞透进来的光，余烬不画光，也不算缺
    expect(fire("ember", "observation_room")).toEqual([]);
    expect(at({ ...night, fire: "ember" }, "observation_room").missing).toEqual([]);
    expect(fire("mid", "bedroom")).toEqual(["fire_spill_low"]);
    expect(fire("high", "bedroom")).toEqual(["fire_spill_high"]);
    // 灶间的火光层可有可无：没有不算缺
    const kitchen = layerStack((n) => b3(n) && !n.startsWith("fire_spill"), "kitchen_room", { ...night, fire: "high", oilLamp: false });
    expect(kitchen.missing).toEqual([]);
  });

  it("夜里暖炉用 heater_flame_night，白天用 heater_flame_on", () => {
    expect(layerStack(b3, "observation_room", { ...night, heater: true }).layers.at(-1)).toBe("heater_flame_night");
    expect(layerStack(b3, "observation_room", { ...night, heater: true }).layers).not.toContain("heater_flame_on");
    expect(layerStack(b3, "observation_room", { ...EMPTY_STATE, heater: true }).layers).toContain("heater_flame_on");
  });

  it("夜里的新图还没出：火苗、灯体、白天的暖炉照旧画，缺的报出来", () => {
    const old = (n: string): boolean => b3(n) && !["fire_spill_ember", "fire_spill_low", "oil_lamp_lit", "heater_flame_night", "oil_lamp_glow"].includes(n);
    const h = layerStack(old, "hearth_room", { ...night, fire: "ember", lamp: true });
    expect(h.layers).toContain("fire_flame_ember");
    expect(h.layers).toContain("oil_lamp_body");
    expect(h.missing).toEqual(["fire_spill_ember", "oil_lamp_lit", "oil_lamp_glow"]);
    const o = layerStack(old, "observation_room", { ...night, heater: true, oilLamp: false });
    expect(o.layers.at(-1)).toBe("heater_flame_on");
    expect(o.missing).toEqual(["heater_flame_night"]);
  });

  it("雪：程序画，在窗外一组的最上面；大雪、暴风雪先垫一层风雪雾，小雪没有雾；没有窗外就不画", () => {
    const w = (weather: ArtState["weather"], t: ArtState["time"] = "day") => layerStack(b3, "observation_room", { ...EMPTY_STATE, time: t, weather });
    expect(w("calm").layers.filter((n) => n.startsWith("~"))).toEqual([]);
    expect(w("lightSnow").layers.slice(0, w("lightSnow").outside)).toEqual(["outside_winter_day_clear_rgba", PROCEDURAL.snow + "lightSnow"]);
    expect(w("heavySnow").layers.slice(0, 3)).toEqual(["outside_winter_day_clear_rgba", "~fog_heavySnow", "~snow_heavySnow"]);
    const b = w("blizzard", "night");
    expect(b.layers[b.outside - 1]).toBe("~snow_blizzard");
    expect(b.layers[b.outside - 2]).toBe("~fog_blizzard");
    expect(b.night).toBe(true);
    expect(b.missing).toEqual([]);
    expect(layerStack((n) => n === "interior_rgba", "observation_room", { ...EMPTY_STATE, weather: "blizzard" }).outside).toBe(0);
  });
});

describe("飘雪的粒子", () => {
  const box: Box = [400, 200, 1600, 700];
  const take = (kind: keyof typeof SNOW, t: number) => {
    const out: number[][] = [];
    eachFlake(kind, box, t, (...a) => out.push(a));
    return out;
  };

  it("小雪稀、大雪密、暴风雪最密；同一时刻画成一样", () => {
    expect(flakeCount("lightSnow", box)).toBeLessThan(flakeCount("heavySnow", box));
    expect(flakeCount("heavySnow", box)).toBeLessThan(flakeCount("blizzard", box));
    expect(take("heavySnow", 12.5)).toEqual(take("heavySnow", 12.5));
    expect(take("heavySnow", 12.5)).not.toEqual(take("heavySnow", 13));
  });

  it("雪都在框附近，往下落；暴风雪斜着刮、带拖影", () => {
    for (const kind of ["lightSnow", "heavySnow", "blizzard"] as const) {
      for (const [x, y, r] of take(kind, 100)) {
        expect(x).toBeGreaterThanOrEqual(box[0] - 48);
        expect(x).toBeLessThan(box[0] + box[2] + 48);
        expect(y).toBeGreaterThanOrEqual(box[1] - 48);
        expect(y).toBeLessThan(box[1] + box[3] + 48);
        expect(r).toBeGreaterThan(0);
      }
    }
    expect(take("lightSnow", 0).every(([, , , dx, dy]) => dx === 0 && dy === 0)).toBe(true);
    // 拖影往左上：风往右、雪往下
    expect(take("blizzard", 0).every(([, , , dx, dy]) => dx < 0 && dy < 0 && Math.abs(dx) > Math.abs(dy))).toBe(true);
    // 远的先画
    const tiers = take("heavySnow", 0).map((f) => f[5]);
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
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

    const sky = (weatherKey: string) => artFromSnapshot({ ...snap, look: { ...snap.look, weatherKey } } as typeof snap, "observation_room").state.weather;
    expect(["clear", "lightSnow", "heavySnow", "blizzard", "fog"].map(sky)).toEqual(["calm", "lightSnow", "heavySnow", "blizzard", "calm"]);
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

describe("主界面的场景", () => {
  it("人形只画在他所在的那一间，站在 JSON 的站位上", () => {
    const g = newGame(11);
    const locate = (p: string) => LOCATIONS[p as keyof typeof LOCATIONS] && { foot: LOCATIONS[p as keyof typeof LOCATIONS]!.foot, height: LOCATIONS[p as keyof typeof LOCATIONS]!.heightPx };
    let seen = 0;
    for (let i = 0; i < 7 * 24; i++) {
      advanceCompanionMinutes(g, 60);
      const snap = present(g, 0, localCalendar);
      for (const room of ROOM_IDS) {
        const f = figureFromSnapshot(snap, room, locate);
        if (!snap.stage.visible[room]) expect(f).toBeNull();
        else {
          expect(f?.foot).toEqual(LOCATIONS[snap.stage.place!]!.foot);
          seen++;
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("场景读的图和内核读的坐标是同一套", () => {
    const set = (path: string, re: RegExp) => readFileSync(new URL(path, import.meta.url), "utf8").match(re)?.[1];
    const core = set("../src/core/rooms.ts", /rooms\/([^/]+)\/room_locations\.json/);
    expect(core).toBeTruthy();
    expect(set("../src/app/scene.ts", /rooms\/([^/*]+)\/\*\//)).toBe(core);
  });
});

describe("窗外的小事（03 第 10.4 节）：程序画的占位", () => {
  const bird = { kind: "bird" as const, seed: 1 };
  const deer = { kind: "deer" as const, seed: 1 };

  it("在窗外一组、雾和雪之间；没有图先用程序层顶着、报缺图；有图就用图", () => {
    const s = layerStack(b3, "hearth_room", { ...EMPTY_STATE, weather: "heavySnow", sight: deer });
    expect(s.layers.slice(0, s.outside)).toEqual(["outside_winter_day_clear_rgba", "~fog_heavySnow", PROCEDURAL.sight + "deer", "~snow_heavySnow"]);
    expect(s.missing).toEqual(["window_deer"]);
    expect(s.sight).toEqual(deer);
    const art = layerStack((n) => b3(n) || n === "window_deer", "hearth_room", { ...EMPTY_STATE, sight: deer });
    expect(art.layers.slice(0, art.outside)).toEqual(["outside_winter_day_clear_rgba", "window_deer"]);
    expect(art.sight).toBeNull();
    expect(art.missing).toEqual([]);
  });

  it("窗沿的鸟只在观测间；没有窗外就不画", () => {
    expect(layerStack(b3, "observation_room", { ...EMPTY_STATE, sight: bird }).layers).toContain("~window_bird");
    expect(layerStack(b3, "kitchen_room", { ...EMPTY_STATE, sight: bird }).layers).not.toContain("~window_bird");
    expect(layerStack((n) => n === "interior_rgba", "observation_room", { ...EMPTY_STATE, sight: deer }).sight).toBeNull();
  });

  it("快照里的小事进画面状态；进度不进（整张不会每拍重叠）", () => {
    const g = newGame(5);
    advanceCompanionMinutes(g, 1);
    const w = g.world;
    w.windowEvents.plan = [{ kind: "geese", start: w.minute, end: w.minute + 4, seen: false, watched: false }];
    const a = artFromSnapshot(present(g, 0, localCalendar), "kitchen_room").state.sight;
    advanceCompanionMinutes(g, 1);
    const b = artFromSnapshot(present(g, 0, localCalendar), "kitchen_room").state.sight;
    expect(a).toEqual({ kind: "geese", seed: w.minute - 1 });
    expect(b).toEqual(a);
  });

  it("位置只是时间的函数：鸟在最大那块玻璃的下沿，鹿在玻璃里，大雁从右往左飞过，静止帧在中间", () => {
    const pane = mainPane("observation_room");
    expect(pane[2] * pane[3]).toBeGreaterThan(0);
    const b = birdAt(pane, 3, 7);
    expect(b).toEqual(birdAt(pane, 3, 7));
    expect(b.y).toBeGreaterThan(pane[1] + pane[3] * 0.9);
    expect(b.x).toBeGreaterThan(pane[0]);
    expect(b.x).toBeLessThan(pane[0] + pane[2]);
    const d = deerAt(pane, 0, 7);
    expect(d.y).toBeGreaterThan(pane[1]);
    expect(d.y).toBeLessThan(pane[1] + pane[3]);
    expect(d.graze).toBeGreaterThanOrEqual(0);
    expect(d.graze).toBeLessThanOrEqual(1);

    const still = geeseAt(pane, 0, 7);
    expect(still.length).toBeGreaterThanOrEqual(5);
    expect(Math.abs(still[0].x - (pane[0] + pane[2] / 2))).toBeLessThan(pane[2] * 0.1);
    expect(geeseAt(pane, 5, 7)[0].x).toBeLessThan(geeseAt(pane, 1, 7)[0].x);
    // 一趟飞完歇一阵
    expect(geeseAt(pane, GEESE_PASS / 2 + 1, 7)).toEqual([]);

    const box: Box = [0, 0, 1000, 500];
    for (let x = 0; x <= 1000; x += 50) {
      const s = auroraStrip(box, 0, x, 12);
      expect(s.alpha).toBeGreaterThanOrEqual(0);
      expect(s.alpha).toBeLessThanOrEqual(1);
      expect(s.top).toBeGreaterThanOrEqual(0);
      expect(s.top + s.height).toBeLessThan(500);
    }
  });
});
