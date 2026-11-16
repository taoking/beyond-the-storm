// 03 第 7.2 节的慢事（要去近处带回素材）、第 7.3 节的腌菜和晾架、读完《北方草木》的效果。
import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/core/config.ts";
import { AREA_BY_ID, CURES, PROJECT_BY_ID, PROJECTS } from "../src/core/content.ts";
import { fixedCalendar } from "../src/core/focus.ts";
import { cmdCheckOuting, cmdDepart, cmdOutdoor, newGame, type Game } from "../src/core/game.ts";
import { acquireKeepsake } from "../src/core/keepsakes.ts";
import { bagCapacity } from "../src/core/outing.ts";
import { deserialize, serialize } from "../src/core/save.ts";
import { createWorld, discoverProjects, newDay, projectStatus, stepMinute } from "../src/core/sim.ts";
import { dayClock, type World } from "../src/core/state.ts";
import { present } from "../src/core/view.ts";
import { nodeAvailable, nodeKnown } from "../src/core/wild.ts";

const cal = fixedCalendar(0);
const WALL = Date.UTC(2026, 10, 17, 9);
const snap = (g: Game) => present(g, WALL, cal);

function runUntil(w: World, cond: (w: World) => boolean, maxMinutes = 20 * 1440): void {
  for (let i = 0; i < maxMinutes; i++) {
    if (cond(w)) return;
    stepMinute(w);
  }
  throw new Error("等不到这个条件");
}

/** 只留这一件让他做 */
function only(w: World, id: string): void {
  for (const ps of Object.values(w.projects)) ps.paused = true;
  w.projects[id].paused = false;
}

/** 粮放在「正常」那一档，免得丰足的好菜把食材吃掉 */
function normalFood(w: World, food = 20): void {
  w.stock.food = food;
  w.today.foodTier = "normal";
  w.today.mood = "normal";
}

const texts = (w: World): string[] => w.events.map((e) => e.text);

describe("03 第 7.2 节：要去近处带回素材的慢事", () => {
  it("工时、阶段、材料按 03 第 7.2 节和 3.4 节的表", () => {
    const hours = (id: string) => PROJECT_BY_ID[id].stages.map((s) => s.hours);
    const mats = (id: string) => PROJECT_BY_ID[id].stages.map((s) => s.materials ?? {});
    expect(hours("fishingRod")).toEqual([4, 4]);
    expect(mats("fishingRod")).toEqual([{ lumber: 1 }, { metal: 1 }]);
    expect(hours("bow")).toEqual([6, 6, 6]);
    expect(mats("bow")).toEqual([{ lumber: 1, rope: 1 }, { lumber: 1 }, { rope: 1 }]);
    expect(hours("lantern")).toEqual([3, 3]);
    expect(mats("lantern")).toEqual([{ metal: 1 }, { metal: 1 }]);
    expect(hours("bigPack")).toEqual([6, 6, 6]);
    expect(mats("bigPack")).toEqual([{ canvas: 1 }, { canvas: 1, hide: 1 }, { hide: 2 }]);
    expect(hours("developFilm")).toEqual([3, 3]);
    expect(hours("northernPlants")).toEqual([5, 5, 5]);
    expect(PROJECT_BY_ID.northernPlants.kind).toBe("read");
  });

  it("他自己的先后：修缮在前，然后是要动手的慢事（7.1 再 7.2 的表序），读书在最后", () => {
    const ids = PROJECTS.map((p) => p.id);
    const kinds = PROJECTS.map((p) => p.kind);
    expect(kinds.lastIndexOf("repair")).toBeLessThan(kinds.indexOf("craft"));
    expect(kinds.lastIndexOf("craft")).toBeLessThan(kinds.indexOf("read"));
    const crafts = ids.filter((id) => PROJECT_BY_ID[id].kind === "craft");
    expect(crafts).toEqual(["radio", "weatherRecords", "carving", "fishingRod", "bow", "lantern", "bigPack", "developFilm"]);
  });

  it("开局：钓竿、弓、提灯、大背包看得见；钓竿第一段用旧木料堆多出来的那 1 根，其余等材料；读《北方草木》和冲洗胶卷还没发现", () => {
    const w = createWorld(1);
    for (const id of ["fishingRod", "bow", "lantern", "bigPack"]) expect(w.projects[id].known).toBe(true);
    expect(projectStatus(w, "fishingRod").status).toBe("queued");
    for (const id of ["bow", "lantern", "bigPack"]) expect(projectStatus(w, id).status).toBe("needMaterials");
    expect(projectStatus(w, "bow").note).toBe("等材料：还差旧绳索 1");
    for (const id of ["northernPlants", "developFilm"]) expect(projectStatus(w, id).status).toBe("unknown");
    const g = newGame(1);
    expect(snap(g).projects.map((p) => p.id)).not.toContain("northernPlants");
  });

  it("做弓：素材按阶段从库里拿，做完手上多一把弓（快照的 tools）", () => {
    const g = newGame(3);
    const w = g.world;
    only(w, "bow");
    w.stock.materials.lumber = 30;
    w.stock.materials.rope = 2;
    runUntil(w, (x) => x.projects.bow.done, 30 * 1440);
    expect(w.stock.materials.rope).toBe(0);
    expect(w.stock.materials.lumber).toBe(28);
    expect(snap(g).tools).toEqual([{ effect: "bow", name: "弓" }]);
  });

  it("缝好大背包，背包 20 格变 26 格", () => {
    const g = newGame(4);
    expect(bagCapacity(g.world)).toBe(CONFIG.outing.bagSlots);
    g.world.projects.bigPack.done = true;
    expect(bagCapacity(g.world)).toBe(26);
  });

  it("冲洗胶卷：胶卷进了门才出现；冲好一张旧照片，等他挂上照片墙；胶卷用掉以后等材料", () => {
    const g = newGame(5);
    const w = g.world;
    w.stock.materials.film = 1;
    discoverProjects(w);
    expect(w.projects.developFilm.known).toBe(true);
    expect(texts(w)).toContain("手头的事里多了一件：冲洗胶卷。");
    only(w, "developFilm");
    runUntil(w, (x) => x.projects.developFilm.timesDone === 1, 20 * 1440);
    expect(w.stock.materials.film).toBe(0);
    expect(w.keepsakes.map((k) => k.id)).toContain("photoShed");
    expect(w.intents.arrange.some((a) => a.put === "photoShed" && a.slot === "photo_wall") || w.display.photo_wall.includes("photoShed")).toBe(true);
    expect(projectStatus(w, "developFilm").status).toBe("needMaterials");
  });
});

describe("读《北方草木》（03 第 7.2 节）", () => {
  it("书带回家才出现；读完认得越橘和野葱，松林多出两个采集点，之前地图上没有", () => {
    const w = createWorld(6);
    const forest = AREA_BY_ID.pineForest;
    const added = forest.nodes.filter((n) => n.needs === "northernPlants");
    expect(added.map((n) => n.id).sort()).toEqual(["lingonberry", "wildOnion"]);
    for (const n of added) {
      expect(nodeKnown(w, n)).toBe(false);
      expect(nodeAvailable(w, n)).toBe(0);
    }
    acquireKeepsake(w, "northernPlants");
    discoverProjects(w);
    expect(w.projects.northernPlants.known).toBe(true);
    only(w, "northernPlants");
    runUntil(w, (x) => x.projects.northernPlants.done, 30 * 1440);
    expect(texts(w)).toContain("读完了《北方草木》。");
    expect(texts(w).some((t) => t.startsWith("认得了更多能采的东西：松林林下的越橘"))).toBe(true);
    for (const n of added) expect(nodeKnown(w, n)).toBe(true);
    // 越橘入冬也有（03 没写季节，先选秋冬春）
    expect(nodeAvailable(w, added.find((n) => n.id === "lingonberry")!)).toBe(1);
  });

  it("从松林把书带回家：上书架，手头的事里多一件读《北方草木》；读完以后野外的地图上看得见新的点", () => {
    let g: Game | null = null;
    for (let s = 10; s < 90 && !g; s++) {
      const c = newGame(s);
      for (const ps of Object.values(c.world.projects)) ps.paused = true;
      let guard = 40 * 1440;
      while (guard-- > 0 && !(dayClock(c.world) >= 9 * 60 && !c.world.actor.asleep && c.world.weather.today !== "D" && cmdCheckOuting(c).ok)) stepMinute(c.world);
      if (guard > 0) g = c;
    }
    const w = g!.world;
    w.weather.today = "A";
    expect(cmdDepart(g!, WALL, { rations: 2, bundles: 1 }).ok).toBe(true);
    const go = (a: Parameters<typeof cmdOutdoor>[2]) => expect(cmdOutdoor(g!, WALL, a).ok).toBe(true);
    go({ type: "travel", to: "pineForest" });
    expect(snap(g!).outing!.map!.nodes.map((n) => n.id)).not.toContain("lingonberry");
    expect(cmdOutdoor(g!, WALL, { type: "gather", node: "lingonberry" }).ok).toBe(false);
    go({ type: "gather", node: "shedBook" });
    go({ type: "walkTo", x: 0, y: 4 });
    go({ type: "travel", to: "home" });
    expect(w.projects.northernPlants.known).toBe(true);
    expect(snap(g!).projects.map((p) => p.id)).toContain("northernPlants");
    w.projects.northernPlants.done = true;
    // 下一趟
    runUntil(w, (x) => dayClock(x) >= 9 * 60 && !x.actor.asleep && x.weather.today !== "D" && cmdCheckOuting(g!).ok && x.day > 0, 20 * 1440);
    w.weather.today = "A";
    expect(cmdDepart(g!, WALL, { rations: 1, bundles: 0 }).ok).toBe(true);
    go({ type: "travel", to: "pineForest" });
    expect(snap(g!).outing!.map!.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(["lingonberry", "wildOnion"]));
  });
});

describe("腌菜（03 第 7.3 节）", () => {
  function ripeCabbage(w: World): void {
    w.plots[0] = { crop: "cabbage", daysLeft: 0, ripe: true, preferred: null };
    w.weather.today = "A";
  }

  it("地窖整理好以后，收白菜时留 2 餐在地窖口腌上；3 天后取出 2 份腌菜进储物架，学会一道新菜", () => {
    const g = newGame(7);
    const w = g.world;
    only(w, "carving");
    w.projects.carving.paused = true;
    w.projects.cellar.done = true;
    normalFood(w, 30);
    ripeCabbage(w);
    runUntil(w, (x) => x.plots[0].crop !== "cabbage" || !x.plots[0].ripe, 2 * 1440);
    expect(w.tally["腌菜:下坛的白菜"]).toBe(CONFIG.cure.pickleCabbageMeals);
    expect(w.tally["粮:菜地"]).toBe(5 - CONFIG.cure.pickleCabbageMeals);
    expect(w.curing).toEqual([{ kind: "pickles", amount: 2, daysLeft: CURES.pickles.days, day: w.day }]);
    expect(snap(g).stage.curing).toEqual({ crock: true, rack: [] });
    expect(texts(w).some((t) => t.includes("留了 2 餐白菜在地窖口腌上"))).toBe(true);
    const start = w.day;
    runUntil(w, (x) => (x.tally["腌菜:取出"] ?? 0) > 0, 12 * 1440);
    expect(w.day - start).toBeGreaterThanOrEqual(CURES.pickles.days);
    expect(w.tally["腌菜:取出"]).toBe(2);
    expect(w.curing).toEqual([]);
    expect(w.dishes).toContain("pickleStew");
    expect(texts(w)).toContain("学会了一道新菜：腌白菜炖锅子。");
    expect(snap(g).stage.curing.crock).toBe(false);
  });

  it("地窖还没整理、粮紧、坛子里还有：都不腌，收的菜全进粮", () => {
    for (const setup of [
      (w: World) => normalFood(w, 30),
      (w: World) => {
        w.projects.cellar.done = true;
        w.stock.food = 9; // 够用 3 天，不到 7 天
      },
      (w: World) => {
        w.projects.cellar.done = true;
        normalFood(w, 30);
        w.curing.push({ kind: "pickles", amount: 2, daysLeft: 2, day: 0 });
      },
    ]) {
      const w = createWorld(8);
      for (const ps of Object.values(w.projects)) ps.paused = true;
      setup(w);
      ripeCabbage(w);
      runUntil(w, (x) => !x.plots[0].ripe, 2 * 1440);
      expect(w.tally["腌菜:下坛的白菜"] ?? 0).toBe(0);
      expect(w.tally["粮:菜地"]).toBe(5);
    }
  });

  it("腌菜按食材吃：俭的时候先顶饭，手记照实写", () => {
    const w = createWorld(9);
    for (const ps of Object.values(w.projects)) ps.paused = true;
    w.stock.ingredients = 2;
    w.pantry.pickles = 2;
    w.stock.food = 2;
    w.today.foodTier = "thrift";
    w.today.mood = "thrift";
    runUntil(w, (x) => texts(x).some((t) => t.endsWith("就着腌白菜吃了。")), 2 * 1440);
    expect(w.pantry.pickles).toBe(1);
    expect(w.stock.ingredients).toBe(1);
  });
});

describe("晾架（03 第 7.3 节）", () => {
  it("晾架修好、储物架上有生肉或大鱼：他挂上去，2 天后收下肉干鱼干（还是食材）；快照看得见晾架上有东西", () => {
    const g = newGame(11);
    const w = g.world;
    for (const ps of Object.values(w.projects)) ps.paused = true;
    w.projects.dryingRack.done = true;
    normalFood(w);
    w.weather.today = "A";
    w.stock.ingredients = 2;
    w.pantry.rawMeat = 2;
    runUntil(w, (x) => x.curing.length > 0, 2 * 1440);
    expect(w.curing[0]).toMatchObject({ kind: "jerky", amount: 2, daysLeft: 2 });
    expect(w.stock.ingredients).toBe(0);
    expect(snap(g).stage.curing.rack).toEqual(["jerky"]);
    runUntil(w, (x) => x.pantry.jerky === 2, 15 * 1440);
    expect(w.stock.ingredients).toBe(2);
    expect(w.curing).toEqual([]);
    expect(snap(g).stage.curing.rack).toEqual([]);
  });

  it("晾架在暴风雪天不算一天；地窖口的坛子照算", () => {
    const w = createWorld(12);
    w.curing.push({ kind: "jerky", amount: 1, daysLeft: 1, day: 0 }, { kind: "pickles", amount: 2, daysLeft: 1, day: 0 });
    w.weather.today = "D";
    newDay(w);
    expect(w.curing.map((b) => b.daysLeft)).toEqual([1, 0]);
  });

  it("晾好的薄荷进茶罐，不算食材、不顶饭；他泡茶时先泡薄荷茶", () => {
    const g = newGame(13);
    const w = g.world;
    for (const ps of Object.values(w.projects)) ps.paused = true;
    w.projects.dryingRack.done = true;
    normalFood(w);
    w.weather.today = "A";
    w.stock.ingredients = 1;
    w.pantry.mint = 1;
    runUntil(w, (x) => x.curing.length > 0, 2 * 1440);
    expect(w.curing[0].kind).toBe("herbTea");
    expect(w.stock.ingredients).toBe(0);
    runUntil(w, (x) => x.tea > 0 || x.dishes.includes("mintTea"), 15 * 1440);
    expect(w.stock.ingredients).toBe(0);
    runUntil(w, (x) => texts(x).includes("泡了杯薄荷茶。"), 10 * 1440);
    expect(w.tea).toBeLessThan(CONFIG.IMPL.cure.teaCupsPerMint);
  });

  it("晾架还塌着：架上的生肉照常当食材吃，不挂", () => {
    const w = createWorld(14);
    for (const ps of Object.values(w.projects)) ps.paused = true;
    w.weather.today = "A";
    w.stock.ingredients = 1;
    w.pantry.rawMeat = 1;
    advanceDays(w, 1);
    expect(w.curing).toEqual([]);
  });
});

function advanceDays(w: World, days: number): void {
  for (let i = 0; i < days * 1440; i++) stepMinute(w);
}

describe("存档", () => {
  it("老存档：没有新慢事、胶卷、坛子晾架的，读进来补上；书已经带回的，读《北方草木》算发现了", () => {
    const g = newGame(15);
    acquireKeepsake(g.world, "northernPlants");
    const old = JSON.parse(serialize(g, WALL));
    const w = old.game.world;
    for (const id of ["fishingRod", "bow", "lantern", "bigPack", "developFilm", "northernPlants"]) delete w.projects[id];
    delete w.stock.materials.film;
    delete w.pantry;
    delete w.tea;
    delete w.curing;
    delete w.dishes;
    const back = deserialize(JSON.stringify(old)).game;
    const bw = back.world;
    expect(bw.projects.northernPlants.known).toBe(true);
    expect(bw.projects.developFilm.known).toBe(false);
    expect(bw.projects.bow.known).toBe(true);
    expect(bw.stock.materials.film).toBe(0);
    expect(bw.pantry).toEqual({ pickles: 0, jerky: 0, rawMeat: 0, mint: 0 });
    expect(bw.curing).toEqual([]);
    const s = snap(back);
    expect(s.stage.curing).toEqual({ crock: false, rack: [] });
    expect(s.projects.map((p) => p.id)).toContain("northernPlants");
    // 读回来接着走不出错
    for (let i = 0; i < 1440; i++) stepMinute(bw);
  });

  it("坛子、晾架、有名目的食材存了读回来一样", () => {
    const g = newGame(16);
    g.world.curing.push({ kind: "pickles", amount: 2, daysLeft: 2, day: 0 });
    g.world.pantry.jerky = 1;
    g.world.stock.ingredients = 1;
    g.world.tea = 3;
    const back = deserialize(serialize(g, WALL)).game;
    expect(back.world.curing).toEqual(g.world.curing);
    expect(back.world.pantry).toEqual(g.world.pantry);
    expect(back.world.tea).toBe(3);
  });
});
