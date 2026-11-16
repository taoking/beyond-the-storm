// 藏品、六处展示位和书架（03 第 3.1、4.3、4.4、6.5 节；04 第 7 节表第 13 条）。
import { describe, expect, it } from "vitest";
import { artFromSnapshot } from "../src/art/layers.ts";
import { CONFIG } from "../src/core/config.ts";
import { DISPLAY_SLOT_IDS, PROJECT_BY_ID } from "../src/core/content.ts";
import { fixedCalendar } from "../src/core/focus.ts";
import { cmdArrange, cmdCheckOuting, cmdDepart, cmdEnterAmbience, cmdOutdoor, cmdReturnToToday, newGame, type Game } from "../src/core/game.ts";
import { acquireKeepsake, keepsakeCapacity } from "../src/core/keepsakes.ts";
import { collapse } from "../src/core/outing.ts";
import { DISPLAY_ROOM, ROOMS, ROOM_IDS } from "../src/core/rooms.ts";
import { deserialize, serialize } from "../src/core/save.ts";
import { stepMinute } from "../src/core/sim.ts";
import { dayClock } from "../src/core/state.ts";
import { present } from "../src/core/view.ts";
import type { WildAction } from "../src/core/wild.ts";

const cal = fixedCalendar(0);
const WALL = Date.UTC(2026, 10, 16, 9);

/** 一直走到他把手上要摆的都摆完（最多三天） */
function untilArranged(g: Game): void {
  for (let i = 0; i < 3 * 1440 && g.world.intents.arrange.length > 0; i++) stepMinute(g.world);
  expect(g.world.intents.arrange).toEqual([]);
}

const snap = (g: Game) => present(g, WALL, cal);

function ready(seed = 1): Game {
  for (let s = seed; s < seed + 80; s++) {
    const g = newGame(s);
    const w = g.world;
    for (const ps of Object.values(w.projects)) ps.paused = true;
    let guard = 40 * 1440;
    while (guard-- > 0 && !(dayClock(w) >= 9 * 60 && !w.actor.asleep && w.weather.today !== "D" && cmdCheckOuting(g).ok)) stepMinute(w);
    if (guard <= 0) continue;
    w.weather.today = "A";
    return g;
  }
  throw new Error("找不到合适的种子");
}

function act(g: Game, action: WildAction): void {
  const r = cmdOutdoor(g, WALL, action);
  if (!r.ok) throw new Error(`${JSON.stringify(action)}：${r.reason}`);
}

describe("六处展示位（03 第 3.1 节）", () => {
  it("id 跟 room_locations.json 一致，炉间两处、观测间两处、卧室两处", () => {
    const inJson = ROOM_IDS.flatMap((r) => ROOMS[r].displaySlots.map((s) => s.id)).sort();
    expect([...DISPLAY_SLOT_IDS].sort()).toEqual(inJson);
    expect(DISPLAY_ROOM).toMatchObject({
      photo_wall: "hearth_room",
      hearth_shelf: "hearth_room",
      windowsill: "observation_room",
      desk_corner: "observation_room",
      bedside: "bedroom",
      wall_spare: "bedroom",
    });
  });

  it("格数按 04 的初值；窗台的玻璃罐和样式位各占一格，剩下的给藏品", () => {
    expect(CONFIG.IMPL.displayCapacity).toEqual({ photo_wall: 6, hearth_shelf: 3, windowsill: 3, desk_corner: 2, bedside: 1, wall_spare: 1 });
    expect(DISPLAY_SLOT_IDS.map((s) => keepsakeCapacity(s))).toEqual([6, 3, 1, 1, 1, 1]);
    const c = snap(newGame(1)).collection;
    expect(c.items).toEqual([]);
    expect(c.displays.find((d) => d.id === "windowsill")).toMatchObject({ fixed: "玻璃罐", style: null, items: [], free: 1 });
  });
});

describe("木雕（03 第 4.4、7.1 节）", () => {
  it("刻好一件：先记成待摆放，他手头空了亲手摆到窗台；第二件窗台满了摆到炉上搁板", () => {
    const g = newGame(2);
    const w = g.world;
    const ps = w.projects.carving;
    const def = PROJECT_BY_ID.carving;
    for (let n = 1; n <= 2; n++) {
      // 直接把木雕推到最后一段的尾巴上，让他自己刻完
      for (const p of Object.values(w.projects)) p.paused = true;
      ps.paused = false;
      ps.stage = def.stages.length - 1;
      ps.minutesInStage = def.stages[ps.stage].hours * 60 - 1;
      ps.stageStarted = true;
      w.intents.pinned = ["carving"];
      for (let i = 0; i < 3 * 1440 && w.carvings < n; i++) stepMinute(w);
      expect(w.carvings).toBe(n);
      const item = snap(g).collection.items.at(-1)!;
      expect(item).toMatchObject({ uid: `carving#${n}`, id: "carving", where: null, pending: n === 1 ? "windowsill" : "hearth_shelf" });
      untilArranged(g);
    }
    expect(w.display.windowsill).toEqual(["carving#1"]);
    expect(w.display.hearth_shelf).toEqual(["carving#2"]);
    expect(snap(g).stage.displays.windowsill).toEqual(["carving"]);
    expect(w.events.some((e) => e.text === "把小木雕摆到了窗台。")).toBe(true);
  });
});

describe("野外找到的藏品（02 第 9.7 节：藏品不丢）", () => {
  it("羽毛、明信片、书：不占背包格，到家才算拿到；书上书架，别的等他摆", () => {
    const g = ready();
    expect(cmdDepart(g, WALL, { rations: 2, bundles: 1 }).ok).toBe(true);
    act(g, { type: "travel", to: "pineForest" });
    const slots = snap(g).outing!.bag.slots;
    act(g, { type: "gather", node: "feather" });
    act(g, { type: "gather", node: "shedPostcard" });
    act(g, { type: "gather", node: "shedBook" });
    expect(snap(g).outing!.bag.slots).toBe(slots);
    expect(g.world.outing!.found).toEqual(["jayFeather", "postcard", "northernPlants"]);
    expect(g.world.keepsakes).toEqual([]);
    expect(cmdOutdoor(g, WALL, { type: "gather", node: "feather" }).ok).toBe(false);

    act(g, { type: "walkTo", x: 0, y: 4 });
    act(g, { type: "travel", to: "home" });
    const c = snap(g).collection;
    expect(c.items.map((k) => [k.id, k.where, k.pending])).toEqual([
      ["jayFeather", null, "windowsill"],
      ["postcard", null, "desk_corner"],
      ["northernPlants", "bookshelf", null],
    ]);
    expect(c.shelf).toMatchObject({ books: 1, spines: 0, level: "few" });
    untilArranged(g);
    expect(g.world.display.windowsill).toEqual(["jayFeather"]);
    expect(g.world.display.desk_corner).toEqual(["postcard"]);
  });

  it("昏倒也不丢：醒来在床上，藏品照样到手", () => {
    const g = ready(5);
    expect(cmdDepart(g, WALL, { rations: 2, bundles: 1 }).ok).toBe(true);
    act(g, { type: "travel", to: "pineForest" });
    act(g, { type: "gather", node: "feather" });
    collapse(g.world, "tired");
    expect(g.world.keepsakes.map((k) => k.id)).toEqual(["jayFeather"]);
    expect(g.world.intents.arrange).toEqual([{ slot: "windowsill", put: "jayFeather", take: null }]);
  });
});

describe("换着摆：满了不自动顶替（04 第 7 节第 13 条）", () => {
  it("哪处都满了收进手记；你选了换下哪件，他亲手去换，换下的收进手记", () => {
    const g = newGame(3);
    const w = g.world;
    for (let i = 0; i < 5; i++) acquireKeepsake(w, "carving");
    untilArranged(g);
    // 窗台 1 格、炉上搁板 3 格，第五件没处放
    expect(w.display.windowsill).toEqual(["carving#1"]);
    expect(w.display.hearth_shelf).toEqual(["carving#2", "carving#3", "carving#4"]);
    expect(snap(g).collection.items.at(-1)).toMatchObject({ uid: "carving#5", where: null, pending: null });

    expect(cmdArrange(g, "windowsill", "carving#5").reason).toBe("窗台放满了，先选一件换下来");
    expect(cmdArrange(g, "photo_wall", "carving#5").reason).toBe("小木雕放不到照片墙");
    expect(cmdArrange(g, "windowsill", "nothing").reason).toBe("还没有这件");
    expect(cmdArrange(g, "windowsill", "carving#5", "carving#2").reason).toBe("这件不在这里");
    expect(cmdArrange(g, "windowsill", "carving#5", "carving#1").ok).toBe(true);
    expect(snap(g).collection.items.find((k) => k.uid === "carving#1")!.pending).toBe("takeDown");
    untilArranged(g);
    expect(w.display.windowsill).toEqual(["carving#5"]);
    expect(snap(g).collection.items.find((k) => k.uid === "carving#1")!.where).toBe(null);
    expect(w.events.some((e) => e.text === "把窗台上的小木雕换成了小木雕。")).toBe(true);

    // 只收下来不换：空出一格，之后能直接摆上去
    expect(cmdArrange(g, "hearth_shelf", null, "carving#3").ok).toBe(true);
    expect(cmdArrange(g, "hearth_shelf", "carving#1").ok).toBe(true);
    untilArranged(g);
    expect(w.display.hearth_shelf).toEqual(["carving#2", "carving#4", "carving#1"]);
  });

  it("氛围态里也能选，世界停着不摆；回到今天他再去", () => {
    const g = newGame(4);
    const w = g.world;
    for (let i = 0; i < 5; i++) acquireKeepsake(w, "carving");
    untilArranged(g);
    expect(cmdEnterAmbience(g, { season: "summer", weather: "A", time: "day" }).ok).toBe(true);
    expect(cmdArrange(g, "windowsill", "carving#5", "carving#1").ok).toBe(true);
    expect(w.display.windowsill).toEqual(["carving#1"]);
    expect(cmdReturnToToday(g).ok).toBe(true);
    untilArranged(g);
    expect(w.display.windowsill).toEqual(["carving#5"]);
  });
});

describe("书架两档（03 第 3.1、4.3 节）", () => {
  it("前任的书一直在，开局是稀疏；带回的书加上你那一格的书脊到 6 本是放满；书脊最多算 12 本", () => {
    const g = newGame(1);
    expect(snap(g).stage.shelf).toBe("few");
    expect(artFromSnapshot(snap(g), "observation_room").state.props).toContain("books_few");
    acquireKeepsake(g.world, "northernPlants");
    for (let i = 0; i < 4; i++) g.focus.spines.push({ category: "study", date: "2026-11-16", taskName: null });
    expect(snap(g).collection.shelf).toMatchObject({ books: 1, spines: 4, level: "few", manyAt: 6 });
    g.focus.spines.push({ category: "code", date: "2026-11-16", taskName: null });
    expect(snap(g).stage.shelf).toBe("many");
    const art = artFromSnapshot(snap(g), "observation_room").state.props;
    expect(art).toContain("books_many");
    expect(art).not.toContain("books_few");
    expect(artFromSnapshot(snap(g), "hearth_room").state.props).not.toContain("books_many");
    for (let i = 0; i < 20; i++) g.focus.spines.push({ category: "other", date: "2026-11-16", taskName: null });
    expect(snap(g).collection.shelf.spines).toBe(CONFIG.milestones.spineSlots);
  });
});

describe("存档", () => {
  it("摆着的、待摆的、这一趟找到的，存了读回来一样", () => {
    const g = newGame(6);
    acquireKeepsake(g.world, "carving");
    acquireKeepsake(g.world, "postcard");
    const back = deserialize(serialize(g, WALL)).game;
    expect(back.world.keepsakes).toEqual(g.world.keepsakes);
    expect(back.world.display).toEqual(g.world.display);
    expect(back.world.intents.arrange).toEqual(g.world.intents.arrange);
  });

  it("老存档：没有藏品的，刻好的木雕按当时的说法已经摆上了；出门在外的补上空的 found", () => {
    const g = ready(7);
    g.world.carvings = 3;
    expect(cmdDepart(g, WALL, { rations: 2, bundles: 1 }).ok).toBe(true);
    const old = JSON.parse(serialize(g, WALL));
    const w = old.game.world;
    delete w.keepsakes;
    delete w.display;
    delete w.intents.arrange;
    delete w.outing.found;
    const back = deserialize(JSON.stringify(old)).game;
    expect(back.world.keepsakes.map((k) => k.uid)).toEqual(["carving#1", "carving#2", "carving#3"]);
    expect(back.world.display.windowsill).toEqual(["carving#1"]);
    expect(back.world.display.hearth_shelf).toEqual(["carving#2", "carving#3"]);
    expect(back.world.intents.arrange).toEqual([]);
    expect(back.world.outing!.found).toEqual([]);
    expect(snap(back).collection.items).toHaveLength(3);
  });
});
