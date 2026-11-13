// 世界模拟：设计/02_玩法.md 第 3–8 节。
import { describe, expect, it } from "vitest";
import { seasonOf } from "../src/core/calendar.ts";
import { CONFIG } from "../src/core/config.ts";
import { PROJECT_BY_ID, PROJECTS } from "../src/core/content.ts";
import { CASES, runCase } from "../src/core/longrun.ts";
import { activity, advanceMinutes, createWorld, foodCap, normalWoodUse, projectStatus, startActivity, stepMinute, woodCap } from "../src/core/sim.ts";
import { dayClock, type World } from "../src/core/state.ts";

/** 走到条件成立为止；超过上限就报错 */
function runUntil(w: World, cond: (w: World) => boolean, maxMinutes = 20 * 1440): void {
  for (let i = 0; i < maxMinutes; i++) {
    if (cond(w)) return;
    stepMinute(w);
  }
  throw new Error("等不到这个条件");
}

/** 走到这一天的某个钟点（游戏分钟） */
function runToClock(w: World, minute: number): void {
  runUntil(w, (x) => dayClock(x) >= minute && !x.actor.asleep);
}

function pauseAllProjects(w: World): void {
  for (const ps of Object.values(w.projects)) ps.paused = true;
}

const kinds = (w: World): string[] => w.events.map((e) => e.type);

describe("可复现", () => {
  it("同一个种子走出同一个世界；不同的种子不一样", () => {
    const a = createWorld(7);
    const b = createWorld(7);
    const c = createWorld(8);
    advanceMinutes(a, 30 * 1440);
    advanceMinutes(b, 30 * 1440);
    advanceMinutes(c, 30 * 1440);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(c));
  });

  it("中途存成 JSON 再读回来接着走，和一口气走完一样", () => {
    const straight = createWorld(3);
    advanceMinutes(straight, 20_000);
    const first = createWorld(3);
    advanceMinutes(first, 7_777);
    const restored = JSON.parse(JSON.stringify(first)) as World;
    advanceMinutes(restored, 20_000 - 7_777);
    expect(JSON.stringify(restored)).toBe(JSON.stringify(straight));
  });
});

describe("季节和天气（02 第 3.5、4 节）", () => {
  it("一年 60 天：冬 24、春 12、夏 12、秋 12，从入冬第一天开始", () => {
    const count: Record<string, number> = {};
    for (let d = 0; d < 60; d++) count[seasonOf(d).season] = (count[seasonOf(d).season] ?? 0) + 1;
    expect(count).toEqual({ winter: 24, spring: 12, summer: 12, autumn: 12 });
    expect(seasonOf(0)).toMatchObject({ season: "winter", dayInSeason: 0 });
    expect(seasonOf(60)).toMatchObject({ season: "winter", year: 1 });
  });

  it("天气的硬边界在任何年份都不破；头一天定的天气就是第二天的天气", () => {
    for (const force of [undefined, "snowy", "lateSpring", "earlyFrost"] as const) {
      for (let seed = 0; seed < 6; seed++) {
        const w = createWorld(seed, { forceYearKind: force });
        pauseAllProjects(w);
        const tiers: string[] = [];
        let promised = w.weather.tomorrow;
        let day = 0;
        tiers.push(w.weather.today);
        while (w.day < 60 * 12) {
          stepMinute(w);
          if (w.day !== day) {
            day = w.day;
            expect(w.weather.today).toBe(promised);
            promised = w.weather.tomorrow;
            tiers.push(w.weather.today);
          }
        }
        let blizzards = 0;
        let bad = 0;
        let mustBeFair = 0;
        for (const t of tiers) {
          const isBad = t === "C" || t === "D";
          if (mustBeFair > 0) {
            expect(isBad).toBe(false);
            mustBeFair -= 1;
          }
          if (isBad) {
            bad += 1;
            blizzards = t === "D" ? blizzards + 1 : 0;
          } else {
            if (bad >= 2) mustBeFair = CONFIG.weather.recoverDays - 1;
            bad = 0;
            blizzards = 0;
          }
          expect(blizzards).toBeLessThanOrEqual(3);
          expect(bad).toBeLessThanOrEqual(4);
        }
        if (force === undefined) {
          // 夏天没有暴风雪
          tiers.forEach((t, d) => {
            if (seasonOf(d).season === "summer") expect(t).not.toBe("D");
          });
        }
      }
    }
  });
});

describe("柴粮是真实库存（02 第 5 节）", () => {
  it("账对得上：没有按天自动长出来的东西，也没有过天时另扣一遍", () => {
    for (const seed of [1, 2, 3]) {
      const w = createWorld(seed);
      for (let i = 0; i < 120 * 1440; i++) {
        stepMinute(w);
        if (w.stock.wood < 0 || w.stock.food < 0) throw new Error("库存成了负数");
      }
      const t = w.tally;
      const sum = (prefix: string): number =>
        Object.entries(t)
          .filter(([k]) => k.startsWith(prefix))
          .reduce((a, [, v]) => a + v, 0);
      expect(w.stock.wood).toBe(CONFIG.stock.wood0 + sum("柴:") - (t["烧柴"] ?? 0));
      expect(w.stock.food).toBe(CONFIG.stock.food0 + sum("粮:") - (t["吃粮"] ?? 0));
    }
  });

  it("每天起床时定一次档，一天之内不变", () => {
    const w = createWorld(5);
    pauseAllProjects(w);
    let day = w.day;
    let mood = w.today.mood;
    for (let i = 0; i < 60 * 1440; i++) {
      stepMinute(w);
      if (w.day !== day) {
        day = w.day;
        mood = w.today.mood;
      }
      expect(w.today.mood).toBe(mood);
    }
  });

  it("够用不到 2 天进俭，回到 3 天才离开；10 天进丰足，掉到 8 天才离开", () => {
    // 冬天正常日用 6 根：11 根不到 2 天
    const thrift = createWorld(1, { wood: 11 });
    expect(thrift.today.woodTier).toBe("thrift");
    expect(thrift.today.mood).toBe("thrift");
    const normal = createWorld(1, { wood: 12 });
    expect(normal.today.woodTier).toBe("normal");
    const rich = createWorld(1, { wood: 60, food: 30 });
    expect(rich.today.woodTier).toBe("rich");
    expect(rich.today.foodTier).toBe("rich");
    const w = createWorld(1, { wood: 60, food: 29 });
    expect(w.today.foodTier).toBe("normal");
    // 较低的那一档决定心境
    expect(w.today.mood).toBe("normal");
  });

  it("用度按档：冬天丰足 8 根、正常 6 根、俭 4 根；暴风雪天正常和丰足多 1 根", () => {
    expect(createWorld(1).today.woodUse).toBe(8);
    expect(createWorld(1, { wood: 30 }).today.woodUse).toBe(6);
    expect(createWorld(1, { wood: 8 }).today.woodUse).toBe(4);
    expect(createWorld(1, { wood: 30, alwaysBlizzard: true }).today.woodUse).toBe(7);
    expect(createWorld(1, { wood: 8, alwaysBlizzard: true }).today.woodUse).toBe(4);
  });

  it("俭的日子：有食材先吃食材，再开没标「留着」的罐头，最后才是粮；有东西可顶就吃三顿", () => {
    const w = createWorld(2, { food: 5 });
    pauseAllProjects(w);
    expect(w.today.foodTier).toBe("thrift");
    w.stock.ingredients = 1;
    w.stock.cans = 2;
    runToClock(w, 21 * 60);
    // 早饭吃食材，午饭、晚饭开罐头；粮没动（这天上午去备了粮，只会多不会少）
    expect(w.stock.ingredients).toBe(0);
    expect(w.stock.cans).toBe(0);
    expect(w.tally["吃粮"] ?? 0).toBe(0);
    expect(w.today.meals.map((m) => m.eaten)).toEqual([true, true, true]);
  });

  it("罐头标了「留着」他就不动；没有东西可顶，俭的日子只吃两顿", () => {
    const w = createWorld(2, { food: 5 });
    pauseAllProjects(w);
    w.stock.cans = 2;
    w.intents.keepCans = true;
    runToClock(w, 21 * 60);
    expect(w.stock.cans).toBe(2);
    expect(w.today.meals.map((m) => m.eaten)).toEqual([true, false, true]);
    expect(w.tally["吃粮"]).toBe(2);
    expect(w.today.missedMeals).toBe(0);
  });

  it("丰足又有食材：做好菜，1 份食材加 1 餐粮", () => {
    const w = createWorld(2);
    pauseAllProjects(w);
    expect(w.today.foodTier).toBe("rich");
    w.stock.ingredients = 2;
    const food = w.stock.food;
    runToClock(w, 9 * 60);
    expect(w.stock.ingredients).toBe(1);
    expect(w.stock.food).toBe(food - 1);
    expect(w.events.some((e) => e.type === "meal" && e.text.includes("好的"))).toBe(true);
  });

  it("柴进了俭才点煤油暖炉：柴照俭的量烧，心境按正常算；标了「留着」就不点", () => {
    // 天天暴风雪、柴只有 8 根：第二天起床时柴还在俭里
    const w = createWorld(4, { wood: 8, alwaysBlizzard: true });
    w.stock.fuel = 2;
    runUntil(w, (x) => x.day === 1);
    expect(w.today.woodTier).toBe("thrift");
    expect(w.today.heater).toBe(true);
    expect(w.stock.fuel).toBe(1);
    expect(w.today.mood).toBe("normal");
    expect(w.today.woodUse).toBe(4);
    const kept = createWorld(4, { wood: 8, alwaysBlizzard: true });
    kept.stock.fuel = 2;
    kept.intents.keepFuel = true;
    runUntil(kept, (x) => x.day === 3);
    expect(kept.stock.fuel).toBe(2);
  });
});

describe("先取后用（02 第 5.6 节）", () => {
  it("最坏的一天：柴粮都是零、暴风雪。先折枯枝才生火，先起鱼笼才吃饭；4 进 4 出、2 进 2 出", () => {
    const w = createWorld(9, { wood: 0, food: 0, coldHearth: true, alwaysBlizzard: true });
    pauseAllProjects(w);
    runUntil(w, (x) => x.day === 1);
    const order = kinds(w).filter((k) => ["eave", "fire", "meal"].includes(k));
    // 折枯枝 → 生火 → 起鱼笼 → 早饭 → 晚饭
    expect(order).toEqual(["eave", "fire", "eave", "meal", "meal"]);
    expect(w.tally["柴:折枯枝"]).toBe(4);
    expect(w.tally["粮:起鱼笼"]).toBe(2);
    expect(w.tally["吃粮"]).toBe(2);
    expect(w.tally["烧柴"]).toBe(4);
    expect(w.stock.wood).toBe(0);
    expect(w.stock.food).toBe(0);
    expect(w.tally["缺餐"] ?? 0).toBe(0);
    // 除了冷启动那一段，火没有断过
    expect(w.tally["无火分钟"] ?? 0).toBe(0);
    expect(w.tally["冷启动分钟"]).toBeGreaterThan(0);
  });

  it("每天各至多一次：只靠檐下活计，一整年天天暴风雪也没有缺餐、没有断火", () => {
    const w = createWorld(11, { wood: 0, food: 0, coldHearth: true, alwaysBlizzard: true });
    pauseAllProjects(w);
    runUntil(w, (x) => x.day === 60, 61 * 1440);
    expect(w.tally["缺餐"] ?? 0).toBe(0);
    expect(w.tally["无火分钟"] ?? 0).toBe(0);
    expect(w.tally["冷启动"]).toBe(1);
    expect(w.tally["柴:折枯枝"]).toBeLessThanOrEqual(60 * 4);
    expect(w.tally["粮:起鱼笼"]).toBeLessThanOrEqual(60 * 2);
    // 天天都是俭，但日子照过：一天两顿热的
    expect(w.tally["日:thrift"]).toBe(w.tally["日:合计"]);
    expect(w.tally["吃饭"]).toBe(120);
  });

  it("晚上 10 点以后不开新的事；睡前压火管一夜", () => {
    const w = createWorld(6);
    pauseAllProjects(w);
    runUntil(w, (x) => x.actor.asleep);
    expect(dayClock(w)).toBeGreaterThanOrEqual(22 * 60);
    expect(dayClock(w)).toBeLessThan(22 * 60 + 30);
    expect(w.today.banked).toBe(true);
    // 压的火加上余烬撑到天亮
    expect(w.fire.burn + w.fire.ember).toBeGreaterThanOrEqual(8 * 60 - 30);
  });

  it("柴堆空着要离开屋子：火要够烧到回来、再折一趟枯枝，不够就先去折枯枝；今天折过了就不能再折", () => {
    const S = CONFIG.supply;
    const away = 240;
    const trip = () => activity("choreWood", "去备柴", "chore", [{ place: "forestEdge", minutes: away }], { slot: "m" });
    // 烧到回来（加添柴的余量），再加回来以后折枯枝的 1 小时；余烬的 2 小时算在里面
    const enough = away + CONFIG.IMPL.fireMarginMinutes + S.eaveWoodMinutes - CONFIG.fire.emberMinutes;
    const world = (burn: number): World => {
      const w = createWorld(41);
      w.stock.wood = 0;
      w.fire.burn = burn;
      return w;
    };
    let w = world(enough);
    startActivity(w, trip());
    expect(w.actor.activity?.kind).toBe("choreWood");
    // 差一分钟就不走：只算到回来的话这时还绰绰有余
    w = world(enough - 1);
    expect(enough - 1).toBeGreaterThan(away + CONFIG.IMPL.fireMarginMinutes - CONFIG.fire.emberMinutes);
    startActivity(w, trip());
    expect(w.actor.activity?.kind).toBe("eaveWood");
    // 今天已经折过一次：不能为了守火再凭空多折一次，照原计划走
    w = world(enough - 1);
    w.today.eaveWood = true;
    startActivity(w, trip());
    expect(w.actor.activity?.kind).toBe("choreWood");
    expect(w.stock.wood).toBe(0);
    // 柴堆里有柴：添上再走，不去折枯枝
    w = world(0);
    w.stock.wood = 5;
    startActivity(w, trip());
    expect(w.actor.activity?.kind).toBe("choreWood");
    expect(w.stock.wood).toBeLessThan(5);
  });

  it("到了饭点没吃上的那一顿，10 点以后补吃完再睡；只补这一顿，不加餐", () => {
    const w = createWorld(6);
    pauseAllProjects(w);
    runToClock(w, 21 * 60 + 50);
    const dinner = w.today.meals.find((m) => m.name === "dinner")!;
    expect(dinner.eaten).toBe(true);
    // 当成这顿被别的必需的事挤到了 10 点以后：手上这件事 10 点 05 分才做完
    dinner.eaten = false;
    startActivity(w, activity("drink", "在喝水", "necessity", [{ place: "stove", minutes: 15 }]));
    const ate = w.tally["吃饭"];
    const food = w.stock.food;
    runUntil(w, (x) => dayClock(x) >= 22 * 60);
    expect(dinner.eaten).toBe(false);
    runUntil(w, (x) => x.actor.asleep);
    expect(dinner.eaten).toBe(true);
    expect(w.tally["吃饭"]).toBe(ate + 1);
    expect(w.stock.food).toBe(food - 1);
    expect(w.today.missedMeals).toBe(0);
    expect(w.today.banked).toBe(true);
    expect(dayClock(w)).toBeGreaterThanOrEqual(22 * 60);
    expect(dayClock(w)).toBeLessThan(23 * 60 + 30);
  });

  it("入库不超过上限：秋天备货到装满为止，装不下的不入库，也不记成来源", () => {
    const w = createWorld(43);
    pauseAllProjects(w);
    runUntil(w, (x) => seasonOf(x.day).season === "autumn", 50 * 1440);
    w.stock.wood = woodCap(w) - 2;
    w.stock.food = foodCap(w) - 1;
    let truncated = false;
    let gotWood = w.tally["柴:备柴"] ?? 0;
    let gotFood = w.tally["粮:备粮"] ?? 0;
    while (seasonOf(w.day).season === "autumn") {
      const wood = w.stock.wood;
      const food = w.stock.food;
      stepMinute(w);
      expect(w.stock.wood).toBeLessThanOrEqual(woodCap(w));
      expect(w.stock.food).toBeLessThanOrEqual(foodCap(w));
      const dw = (w.tally["柴:备柴"] ?? 0) - gotWood;
      const df = (w.tally["粮:备粮"] ?? 0) - gotFood;
      // 一次备柴最少 14 根、备粮最少 6 餐：入库的比这少，就是被上限截掉了，记进来源的也只有真入库的
      if (dw > 0) {
        expect(dw).toBeLessThanOrEqual(woodCap(w) - wood);
        if (dw < 14) truncated = true;
      }
      if (df > 0) {
        expect(df).toBeLessThanOrEqual(foodCap(w) - food);
        if (df < 6) truncated = true;
      }
      gotWood += dw;
      gotFood += df;
    }
    expect(truncated).toBe(true);
  });
});

describe("验收目标（02 第 5.7 节）：不出门的无人值守长跑", () => {
  const byId = Object.fromEntries(CASES.map((c) => [c.id, c]));
  const RUNS = 40;
  const YEARS = 8;

  it("开局没有修缮：俭不超过 5%，正常六成以上，95% 的俭不超过 3 天，有活计的日子不超过六成", () => {
    const r = runCase(byId.bare, RUNS, YEARS);
    expect(r.missedMeals).toBe(0);
    expect(r.noFireMinutes).toBe(0);
    expect(r.coldStarts).toBe(0);
    expect(r.tierShare.thrift).toBeLessThanOrEqual(0.05);
    expect(r.tierShare.normal).toBeGreaterThanOrEqual(0.6);
    expect(r.thriftRuns[Math.floor(r.thriftRuns.length * 0.95)] ?? 0).toBeLessThanOrEqual(3);
    expect(r.choreDayShare).toBeLessThanOrEqual(0.6);
  });

  it("基础修缮全修好：俭不超过 1%，丰足三成以上，有活计的日子不超过一半", () => {
    const r = runCase(byId.base, RUNS, YEARS);
    expect(r.missedMeals).toBe(0);
    expect(r.noFireMinutes).toBe(0);
    expect(r.tierShare.thrift).toBeLessThanOrEqual(0.01);
    expect(r.tierShare.rich).toBeGreaterThanOrEqual(0.3);
    expect(r.choreDayShare).toBeLessThanOrEqual(0.5);
  });

  it("照他自己的习惯做项目：没有缺餐、没有断火，五件基础修缮不出门就能做完", () => {
    const r = runCase(byId.natural, RUNS, 2);
    expect(r.missedMeals).toBe(0);
    expect(r.noFireMinutes).toBe(0);
    expect(r.baseRepairsDoneDay).not.toBeNull();
    expect(r.baseRepairsDoneDay!).toBeLessThan(60);
    // 03 第 2.6 节：哪一年折枯枝超过 40 根（10 次），林带的说法不成立
    expect(r.maxEavePerYear.wood).toBeLessThanOrEqual(10);
  });

  it("压力：连着风雪年、柴粮清零起步，都没有缺餐；断火只有被设成冷启动的那一段", () => {
    const snowy = runCase(byId.snowy, RUNS, YEARS);
    expect(snowy.missedMeals).toBe(0);
    expect(snowy.noFireMinutes).toBe(0);
    const zero = runCase(byId.zero, RUNS, 2);
    expect(zero.missedMeals).toBe(0);
    expect(zero.noFireMinutes).toBe(0);
    expect(zero.coldStarts).toBe(RUNS);
  });
});

describe("项目（02 第 7 节）", () => {
  it("份不推进项目；他按自己的习惯顺序先补窗缝，做完以后每天少烧 1 根", () => {
    const w = createWorld(21);
    const before = normalWoodUse(w);
    runUntil(w, (x) => x.projects.windowGaps.done);
    expect(normalWoodUse(w)).toBe(before - 1);
    expect(w.events.some((e) => e.type === "projectDone")).toBe(true);
    expect(w.yearStats.repairsDone).toContain("补窗缝");
  });

  it("一个阶段开工时才拿这个阶段的材料；材料不够就停在上一阶段做完的样子", () => {
    const w = createWorld(22);
    w.projects.windowGaps.done = true;
    w.stock.materials.lumber = 5; // 够柴棚第一阶段（4），不够第二阶段（4）
    for (const [id, ps] of Object.entries(w.projects)) if (id !== "woodshed") ps.paused = true;
    runUntil(w, (x) => x.projects.woodshed.stage === 1, 40 * 1440);
    expect(w.stock.materials.lumber).toBe(1);
    advanceMinutes(w, 5 * 1440);
    expect(w.projects.woodshed.stage).toBe(1);
    expect(w.projects.woodshed.minutesInStage).toBe(0);
    expect(projectStatus(w, "woodshed")).toMatchObject({ status: "needMaterials", note: "等材料：还差木料 3" });
    // 材料到了自己接上
    w.stock.materials.lumber += 10;
    runUntil(w, (x) => x.projects.woodshed.done, 60 * 1440);
    expect(w.stock.materials.lumber).toBe(11 - 6);
  });

  it("拓展修缮缺你从野外带回的材料时只是等着，不挡别的事", () => {
    const w = createWorld(23);
    expect(projectStatus(w, "greenhouse").status).toBe("needMaterials");
    expect(projectStatus(w, "gramophone").status).toBe("blocked");
    runUntil(w, (x) => x.projects.cellar.done, 60 * 1440);
    expect(w.projects.greenhouse.minutesInStage).toBe(0);
  });

  it("你置顶的先做；你让先放着的不做", () => {
    const w = createWorld(24);
    w.intents.pinned = ["carving"];
    w.projects.windowGaps.paused = true;
    runUntil(w, (x) => x.carvings >= 1, 20 * 1440);
    expect(w.projects.windowGaps.minutesInStage).toBe(0);
    expect(w.projects.woodshed.stage).toBe(0);
  });

  it("每天的上限不是配额：平时不超过 3 工时，坏天气室内不超过 5 工时，晚上读书不超过 1 工时", () => {
    const w = createWorld(25);
    let maxFair = 0;
    let maxBad = 0;
    let maxRead = 0;
    while (w.day < 40) {
      stepMinute(w);
      const bad = w.weather.today === "C" || w.weather.today === "D";
      if (bad) maxBad = Math.max(maxBad, w.today.projectMinutes);
      else maxFair = Math.max(maxFair, w.today.projectMinutes);
      maxRead = Math.max(maxRead, w.today.eveningReadMinutes);
    }
    expect(maxFair).toBeLessThanOrEqual(180);
    expect(maxBad).toBeLessThanOrEqual(300);
    expect(maxRead).toBeLessThanOrEqual(60);
    expect(maxFair).toBeGreaterThan(0);
  });

  it("俭的时候项目先放下", () => {
    const w = createWorld(26, { wood: 8, food: 4 });
    expect(w.today.mood).toBe("thrift");
    runToClock(w, 20 * 60);
    expect(w.today.projectMinutes).toBe(0);
    expect(w.today.eveningReadMinutes).toBe(0);
  });

  it("院子里的项目要好天或一般的天气", () => {
    const w = createWorld(27, { alwaysBlizzard: true });
    w.projects.windowGaps.done = true;
    for (const [id, ps] of Object.entries(w.projects)) if (id !== "woodshed") ps.paused = true;
    advanceMinutes(w, 6 * 1440);
    expect(PROJECT_BY_ID.woodshed.where).toBe("yard");
    expect(w.projects.woodshed.minutesInStage).toBe(0);
    expect(projectStatus(w, "woodshed").status).toBe("needWeather");
  });

  it("动手的项目和在读的书各有各的进度；同一分钟只推进一件，晚上读的不占白天的工时", () => {
    const w = createWorld(28);
    const started = (id: string): boolean => {
      const ps = w.projects[id];
      return !ps.done && (ps.stage > 0 || ps.minutesInStage > 0);
    };
    let both = false;
    let total = w.tally["项目分钟"] ?? 0;
    while (w.day < 8) {
      const day = w.today;
      const before = day.projectMinutes + day.eveningReadMinutes;
      stepMinute(w);
      const now = w.tally["项目分钟"] ?? 0;
      expect(now - total).toBeLessThanOrEqual(1);
      if (w.today === day) expect(day.projectMinutes + day.eveningReadMinutes - before).toBe(now - total);
      total = now;
      const act = w.actor.activity;
      if (act?.kind === "project" && act.data.evening) {
        // 晚上在炉边做的只有读书
        expect(PROJECT_BY_ID[act.data.id as string].kind).toBe("read");
        expect(w.actor.place).toBe("armchair");
      }
      const hands = PROJECTS.some((p) => p.kind !== "read" && started(p.id));
      const reading = PROJECTS.some((p) => p.kind === "read" && started(p.id));
      if (hands && reading) both = true;
    }
    expect(both).toBe(true);
  });

  it("旧木料先留给基础修缮：你把暖棚置顶，它等材料并说明原因，五件基础修缮照样不出门做完", () => {
    const w = createWorld(29);
    w.intents.pinned = ["greenhouse"];
    expect(w.stock.materials.lumber).toBe(18);
    expect(projectStatus(w, "greenhouse")).toEqual({ status: "needMaterials", note: "等材料：旧木料先留给基础修缮，还差木料 3" });
    const base = PROJECTS.filter((p) => p.base);
    expect(base.map((p) => p.id)).toEqual(["windowGaps", "woodshed", "cellar", "fence", "dryingRack"]);
    runUntil(w, (x) => base.every((p) => x.projects[p.id].done), 120 * 1440);
    expect(w.projects.greenhouse.stage).toBe(0);
    expect(w.projects.greenhouse.minutesInStage).toBe(0);
    // 基础修缮用掉 17 根，剩下的 1 根不够暖棚第一阶段的 4 根；这时是单纯的缺货
    expect(w.stock.materials.lumber).toBe(1);
    expect(projectStatus(w, "greenhouse")).toEqual({ status: "needMaterials", note: "等材料：还差木料 3" });
  });

  it("带回来的木料是多出来的：暖棚可以先用它开工，基础修缮的那 17 根不受影响", () => {
    const w = createWorld(29);
    w.intents.pinned = ["greenhouse"];
    w.stock.materials.lumber += 3; // 从松林工棚带回 3 根，连同多出的 1 根正好 4 根
    expect(projectStatus(w, "greenhouse").status).toBe("queued");
    const base = PROJECTS.filter((p) => p.base);
    runUntil(w, (x) => x.projects.greenhouse.stage >= 1, 60 * 1440);
    expect(base.every((p) => w.projects[p.id].done)).toBe(false);
    runUntil(w, (x) => base.every((p) => x.projects[p.id].done), 120 * 1440);
    expect(w.stock.materials.lumber).toBe(0);
  });
});

describe("菜地（02 第 8 节）", () => {
  it("冬天休耕；开春第 2 天才下种；入冬前来不及熟的不种；收成进粮", () => {
    const w = createWorld(31);
    pauseAllProjects(w);
    runUntil(w, (x) => x.day === 24, 30 * 1440);
    expect(w.plots.every((p) => p.crop === null)).toBe(true);
    runUntil(w, (x) => x.day === 25);
    expect(w.plots.every((p) => p.crop === null)).toBe(true);
    runUntil(w, (x) => x.plots.some((p) => p.crop !== null), 6 * 1440);
    expect(w.day).toBeGreaterThanOrEqual(25);
    runUntil(w, (x) => (x.tally["粮:菜地"] ?? 0) > 0, 12 * 1440);
    // 走到入冬：地里不留没熟的
    runUntil(w, (x) => x.day === 60, 40 * 1440);
    expect(w.plots.every((p) => p.crop === null || p.ripe)).toBe(true);
  });

  it("菜熟了但粮已经装满：留在地里晚几天收，不会凭空消失", () => {
    const w = createWorld(32);
    pauseAllProjects(w);
    runUntil(w, (x) => x.plots.every((p) => p.crop !== null), 40 * 1440);
    w.stock.food = CONFIG.stock.foodCap;
    for (const p of w.plots) {
      p.ripe = true;
      p.daysLeft = 0;
    }
    const before = w.tally["粮:菜地"] ?? 0;
    runUntil(w, (x) => (x.tally["粮:菜地"] ?? 0) > before, 10 * 1440);
    // 收的那一格正好装得下
    expect(w.stock.food).toBeLessThanOrEqual(CONFIG.stock.foodCap);
    expect(w.plots.some((p) => p.ripe)).toBe(true);
  });

  it("你的偏好只管下一茬，不拔正长着的", () => {
    const w = createWorld(33);
    pauseAllProjects(w);
    runUntil(w, (x) => x.plots.every((p) => p.crop !== null), 40 * 1440);
    const growing = w.plots[0].crop;
    const want = growing === "potato" ? "radish" : "potato";
    w.plots[0].preferred = want;
    advanceMinutes(w, 600);
    expect(w.plots[0].crop).toBe(growing);
    runUntil(w, (x) => x.plots[0].crop === want, 12 * 1440);
  });

  it("暖棚修好以后四季能种，每格 4 餐", () => {
    const w = createWorld(34);
    pauseAllProjects(w);
    w.projects.greenhouse.done = true;
    runUntil(w, (x) => (x.tally["粮:暖棚"] ?? 0) > 0, 20 * 1440);
    expect(seasonOf(w.day).season).toBe("winter");
    expect((w.tally["粮:暖棚"] ?? 0) % 4).toBe(0);
  });
});

describe("他的一天（02 第 3.1、6 节）", () => {
  it("每件事都有最短的持续时间，不会几秒一换；晚饭以后不干活计", () => {
    const w = createWorld(41);
    let last = w.actor.activity;
    let started = w.minute;
    let shortest = Infinity;
    while (w.day < 10) {
      stepMinute(w);
      const act = w.actor.activity;
      if (act !== last) {
        if (last && !["cones", "drink", "tendFire", "bankFire", "wake"].includes(last.kind)) {
          shortest = Math.min(shortest, w.minute - started);
        }
        if (act && act.category === "chore" && act.kind !== "garden") {
          expect(dayClock(w)).toBeLessThan(18 * 60 + 1);
        }
        last = act;
        started = w.minute;
      }
    }
    expect(shortest).toBeGreaterThanOrEqual(5);
  });

  it("一天里有闲暇：就算丰足，项目也不把一天填满", () => {
    const r = runCase(CASES.find((c) => c.id === "natural1")!, 6, 1);
    expect(r.timeShare.leisure).toBeGreaterThan(0.15);
    expect(r.timeShare.project).toBeLessThan(0.25);
    expect(r.timeShare.sleep).toBeGreaterThan(0.3);
  });

  it("世界手记只记真实发生过的事：每个过完的游戏日有一条小结", () => {
    const w = createWorld(42);
    advanceMinutes(w, 5 * 1440);
    expect(w.summaries.map((s) => s.day)).toEqual([0, 1, 2, 3, 4].slice(0, w.day));
    for (const s of w.summaries) expect(s.text).toMatch(/^第 \d+ 天，/);
  });
});
