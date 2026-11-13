// 四种世界状态、出门、意向、存档和时间判定：02 第 1、3.4、6.4、9、14 节，06 第 5 节的六项行为验收。
import { describe, expect, it } from "vitest";
import { seasonOf } from "../src/core/calendar.ts";
import { CONFIG } from "../src/core/config.ts";
import { fixedCalendar } from "../src/core/focus.ts";
import {
  advance,
  cmdCancelRequest,
  cmdCheckOuting,
  cmdChooseStyle,
  cmdDepart,
  cmdEndFocus,
  cmdEnterAmbience,
  cmdHeadHome,
  cmdOutdoorPanel,
  cmdPauseProject,
  cmdPinProject,
  cmdPlotPreference,
  cmdRequest,
  cmdResolveGap,
  cmdResumeFocus,
  cmdReturnToToday,
  cmdReturnToWild,
  cmdStartFocus,
  cmdTravelTo,
  interrupt,
  newGame,
  worldRate,
  type Game,
} from "../src/core/game.ts";
import { judgeGap } from "../src/core/heartbeat.ts";
import { deserialize, serialize } from "../src/core/save.ts";
import { stepMinute } from "../src/core/sim.ts";
import { dayClock } from "../src/core/state.ts";
import { present } from "../src/core/view.ts";

const cal = fixedCalendar(0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 10, 16, 9);

/** 带着现实时钟的一局：run 按确认在运行的时间往前走 */
function session(seed = 1, opt = {}) {
  const g = newGame(seed, opt);
  const s = {
    g,
    wall: T0,
    run(ms: number, stepMs = 1000, hidden = false): void {
      let left = ms;
      while (left > 0) {
        const dt = Math.min(stepMs, left);
        s.wall += dt;
        advance(g, { wall: s.wall, verifiedMs: dt, hidden }, cal);
        left -= dt;
      }
    },
    /** 陪伴状态下直接走游戏分钟（不经过现实时钟） */
    game(minutes: number): void {
      for (let i = 0; i < minutes; i++) stepMinute(g.world);
    },
    until(cond: (g: Game) => boolean, max = 20 * 1440): void {
      for (let i = 0; i < max; i++) {
        if (cond(g)) return;
        stepMinute(g.world);
      }
      throw new Error("等不到这个条件");
    },
    toClock(minute: number): void {
      s.until((x) => dayClock(x.world) >= minute && !x.world.actor.asleep);
    },
  };
  return s;
}

/** 找一个头一天能出门、人在屋里的时刻 */
function readyToGoOut(seed = 1) {
  for (let k = seed; k < seed + 50; k++) {
    const s = session(k);
    if (s.g.world.weather.today === "D") continue;
    for (const ps of Object.values(s.g.world.projects)) ps.paused = true;
    s.toClock(9 * 60);
    s.until((x) => cmdCheckOuting(x).ok, 600);
    return s;
  }
  throw new Error("找不到合适的种子");
}

const worldFacts = (g: Game): string => {
  const w = g.world;
  return JSON.stringify([w.minute, w.day, w.stock, w.fire, w.projects, w.plots, w.events.length, w.actor, w.jar, w.tally]);
};

describe("世界速率（02 第 3.2 节）", () => {
  it("陪伴：现实 1 分钟 = 游戏 4 分钟；他睡着后 = 2 小时；氛围态和户外临时专注冻结", () => {
    const s = session();
    const m0 = s.g.world.minute;
    s.run(10 * MIN);
    expect(s.g.world.minute - m0).toBe(40);
    s.until((g) => g.world.actor.asleep);
    expect(worldRate(s.g)).toBe(120);
    const m1 = s.g.world.minute;
    s.run(2 * MIN);
    expect(s.g.world.minute - m1).toBe(240);
  });

  it("世界走多少只看确认在运行的时间有多长，和心跳多密无关", () => {
    const hashes = [250, 1000, 7000, 60_000, 30 * MIN].map((step) => {
      const s = session(5);
      s.run(30 * MIN, step);
      return JSON.stringify(s.g.world);
    });
    for (const h of hashes) expect(h).toBe(hashes[0]);
  });

  it("醒着的 16 小时约等于现实 4 小时，一夜约等于现实 4 分钟", () => {
    const s = session(2);
    // 22:05 压完火睡下：醒着 965 个游戏分钟（现实 241 分钟），一夜 475 个游戏分钟（现实 4 分钟）
    s.run(4 * HOUR + 10 * MIN);
    expect(s.g.world.day).toBe(1);
    expect(dayClock(s.g.world)).toBeLessThan(6 * 60 + 30);
  });
});

describe("独立氛围态（02 第 1 节）", () => {
  it("进去以后世界时间、库存、天气、项目全部停在这一刻；专注照常得份；回到今天接着走", () => {
    const s = session(3);
    s.run(20 * MIN);
    expect(cmdEnterAmbience(s.g, { season: "summer", weather: "A", time: "dusk" }).ok).toBe(true);
    const before = worldFacts(s.g);
    cmdStartFocus(s.g, s.wall, cal, { preset: { kind: "countup" } });
    s.run(70 * MIN);
    expect(s.g.focus.shares.total).toBe(2);
    // 份先攒着；除了「攒着的小球果」，世界一点没动
    expect(worldFacts(s.g)).toBe(before);
    expect(s.g.world.pendingCones).toBe(2);
    expect(present(s.g, s.wall, cal).frozen).toBe(true);
    expect(present(s.g, s.wall, cal).stage.illusion).toBe(true);

    expect(cmdReturnToToday(s.g).ok).toBe(true);
    const m = s.g.world.minute;
    s.run(15 * MIN);
    expect(s.g.world.minute - m).toBe(60);
    // 回来以后，他下次手头空下来时一次放几颗
    s.until((g) => g.world.pendingCones === 0, 600);
    expect(s.g.world.jar.cones).toBe(2);
    expect(s.g.world.events.some((e) => e.type === "cones" && e.text.includes("2 颗"))).toBe(true);
  });

  it("冻结时不能表达世界里的意向；样式只能预览已经有的，回到今天他再去换", () => {
    const s = session(3);
    cmdStartFocus(s.g, s.wall, cal, { preset: { kind: "countup" } });
    s.run(4 * HOUR); // 攒够份，解锁到第 4 件（墨绿格毛毯要 10 份，这里只有 6 份）
    expect(s.g.focus.shares.total).toBe(6);
    cmdEndFocus(s.g, s.wall, cal);
    cmdEnterAmbience(s.g, { season: "winter", weather: "B", time: "night" });
    expect(cmdPinProject(s.g, "carving").ok).toBe(false);
    expect(cmdRequest(s.g, "tea").ok).toBe(false);
    expect(cmdPlotPreference(s.g, "garden", 0, "radish").ok).toBe(false);
    expect(cmdChooseStyle(s.g, "armchair", "blanketGreen").ok).toBe(false);
    expect(cmdChooseStyle(s.g, "windowsill", "plant").ok).toBe(true);
    expect(s.g.world.styles.windowsill).toBe("none");
    cmdReturnToToday(s.g);
    s.until((g) => g.world.styles.windowsill === "plant", 600);
    expect(s.g.world.events.some((e) => e.type === "style")).toBe(true);
  });
});

describe("份只留下记录和痕迹（01 底线）", () => {
  it("专注 6 个多小时拿满 9 份：柴粮的账只有他自己的来源和消耗，项目进度只来自他做的工时", () => {
    const s = session(7);
    cmdStartFocus(s.g, s.wall, cal, { preset: { kind: "countup" } });
    s.run(6 * HOUR + 30 * MIN, 60_000);
    const w = s.g.world;
    expect(s.g.focus.shares.total).toBe(9);
    const sources = Object.keys(w.tally).filter((k) => k.startsWith("柴:") || k.startsWith("粮:"));
    for (const k of sources) expect(["柴:备柴", "柴:折枯枝", "粮:备粮(冬)", "粮:备粮(春夏秋)", "粮:菜地", "粮:暖棚", "粮:起鱼笼"]).toContain(k);
    const sum = (prefix: string): number => sources.filter((k) => k.startsWith(prefix)).reduce((a, k) => a + w.tally[k], 0);
    expect(w.stock.wood).toBe(CONFIG.stock.wood0 + sum("柴:") - (w.tally["烧柴"] ?? 0));
    expect(w.stock.food).toBe(CONFIG.stock.food0 + sum("粮:") - (w.tally["吃粮"] ?? 0));
    expect(w.tally["项目分钟"] ?? 0).toBe(w.tally["时间:project"] ?? 0);
    // 每一份只留下一颗小球果
    expect(w.jar.cones + w.pendingCones).toBe(9);
  });

  it("不用番茄钟也能正常生活：一次专注都没有，世界照样过完一个冬天", () => {
    const s = session(8);
    s.until((g) => g.world.day === 24, 30 * 1440);
    expect(s.g.world.tally["缺餐"] ?? 0).toBe(0);
    expect(s.g.world.tally["无火分钟"] ?? 0).toBe(0);
    expect(s.g.focus.shares.total).toBe(0);
  });
});

describe("出门（02 第 9 节、第 14.3–14.6 条）", () => {
  it("暴风雪天不能出门：他不动，什么都不扣", () => {
    const s = session(1, { alwaysBlizzard: true });
    s.toClock(9 * 60);
    const before = JSON.stringify(s.g.world.stock);
    const r = cmdDepart(s.g, s.wall, { rations: 1, bundles: 1 });
    expect(r).toEqual({ ok: false, reason: "这天气出不去。" });
    expect(JSON.stringify(s.g.world.stock)).toBe(before);
    expect(s.g.mode).toBe("companion");
    expect(s.g.world.actor.away).toBe(false);
  });

  it("睡着时点门：只说一句「已经歇下了，天亮再走」，不叫醒、不快进、不扣行囊、不压火", () => {
    const s = readyToGoOut(1);
    s.until((g) => g.world.actor.asleep);
    s.game(30);
    const before = worldFacts(s.g);
    const r = cmdDepart(s.g, s.wall, { rations: 1, bundles: 0 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("已经歇下了，天亮再走。");
    expect(worldFacts(s.g)).toBe(before);
    expect(s.g.world.actor.asleep).toBe(true);
    expect(s.g.mode).toBe("companion");
    expect(s.g.notices.at(-1)?.text).toBe("已经歇下了，天亮再走。");
    // 醒来以后按正常流程出门
    s.until((g) => !g.world.actor.asleep && cmdCheckOuting(g).ok, 2000);
    expect(cmdDepart(s.g, s.wall, { rations: 0, bundles: 0 }).ok).toBe(true);
  });

  it("人在林边、溪湾、泉屋：不能半小时瞬移回家。提示等他回来，世界照常走，回来后可以再出门", () => {
    const s = session(4);
    // 等到他去了林子边缘或溪湾干活
    s.until((g) => ["forestEdge", "creekBend"].includes(g.world.actor.place), 30 * 1440);
    const stock = JSON.stringify(s.g.world.stock);
    const minute = s.g.world.minute;
    const r = cmdDepart(s.g, s.wall, { rations: 0, bundles: 0 });
    expect(r.reason).toBe("还在外面，等回来再出门。");
    expect(s.g.world.minute).toBe(minute);
    expect(JSON.stringify(s.g.world.stock)).toBe(stock);
    expect(s.g.world.actor.away).toBe(false);
    // 泉屋也算远处
    const s2 = session(4);
    s2.until((g) => g.world.actor.place === "springhouse");
    expect(cmdCheckOuting(s2.g).reason).toBe("far");
    // 世界照常运行，等他自然回来
    s.until((g) => cmdCheckOuting(g).ok, 600);
    expect(s.g.world.minute).toBeGreaterThan(minute + 30);
    expect(cmdDepart(s.g, s.wall, { rations: 0, bundles: 0 }).ok).toBe(true);
  });

  it("屋里能自然收尾的事：略过收尾，世界钟确实走过这段时间，最多半个游戏小时", () => {
    const s = readyToGoOut(1);
    // 等到一顿饭吃到只剩 20 分钟
    s.until((g) => {
      const a = g.world.actor.activity;
      return a?.kind === "meal" && a.phase === 1 && a.left === 20;
    });
    const check = cmdCheckOuting(s.g);
    expect(check).toMatchObject({ ok: true, wrapUp: 20 });
    const minute = s.g.world.minute;
    expect(cmdDepart(s.g, s.wall, { rations: 0, bundles: 0 }).ok).toBe(true);
    expect(s.g.world.minute - minute).toBe(20);
    // 这顿饭是真的吃完了
    expect(s.g.world.today.meals.filter((m) => m.eaten).length).toBeGreaterThanOrEqual(1);

    // 还要一个多小时的事：不让走
    const s2 = readyToGoOut(1);
    s2.until((g) => {
      const a = g.world.actor.activity;
      return a?.kind === "meal" && a.phase === 0 && a.left === 28;
    });
    expect(cmdCheckOuting(s2.g)).toMatchObject({ ok: false, reason: "busy" });
  });

  it("行囊的下限：柴、粮各自只能拿走够用 3 天以上的部分；拿走的是真库存；出门前压火当场扣柴", () => {
    const s = readyToGoOut(1);
    const w = s.g.world;
    const check = cmdCheckOuting(s.g);
    expect(check.maxRations).toBe(Math.floor(w.stock.food - 9));
    expect(cmdDepart(s.g, s.wall, { rations: check.maxRations + 1, bundles: 0 }).ok).toBe(false);
    const wood = w.stock.wood;
    const food = w.stock.food;
    const night = w.today.nightSticks;
    expect(cmdDepart(s.g, s.wall, { rations: 2, bundles: 1 }).ok).toBe(true);
    expect(w.stock.food).toBe(food - 2);
    expect(w.stock.wood).toBe(wood - 3 - night);
    expect(s.g.mode).toBe("outdoor");
    expect(w.actor.away).toBe(true);
    // 压的火管 8 个游戏小时
    expect(w.fire.burn).toBeGreaterThanOrEqual(480);

    // 家里不到 3 天的那一样带不走
    const poor = session(1, { wood: 17, food: 8 });
    poor.toClock(9 * 60);
    expect(cmdCheckOuting(poor.g)).toMatchObject({ maxRations: 0, maxBundles: 0 });
  });

  it("户外直控：现实 1 分钟 = 游戏 10 分钟；家里的家务和项目不动，只有火在烧；应用切到后台就暂停", () => {
    const s = readyToGoOut(1);
    cmdDepart(s.g, s.wall, { rations: 2, bundles: 0 });
    const w = s.g.world;
    const m = w.minute;
    const events = w.events.length;
    const burn = w.fire.burn;
    s.run(6 * MIN);
    expect(w.minute - m).toBe(60);
    expect(w.fire.burn).toBe(burn - 60);
    expect(w.events.length).toBe(events);
    s.run(6 * MIN, 1000, true);
    expect(w.minute - m).toBe(60);
  });

  it("打开地图、背包、手记：世界暂停，关闭后原地接续；这段不算有效专注，不得份", () => {
    const s = readyToGoOut(1);
    cmdDepart(s.g, s.wall, { rations: 2, bundles: 0 });
    cmdTravelTo(s.g, s.wall, "pineForest");
    const w = s.g.world;
    for (const panel of ["map", "pack", "journal"] as const) {
      cmdOutdoorPanel(s.g, panel);
      const before = worldFacts(s.g);
      s.run(30 * MIN);
      expect(worldFacts(s.g)).toBe(before);
      expect(w.outing).toMatchObject({ area: "pineForest", minutesFromDoor: 20 });
      cmdOutdoorPanel(s.g, null);
    }
    expect(s.g.focus.stats.totalMs).toBe(0);
    expect(s.g.focus.shares.total).toBe(0);
    const m = w.minute;
    s.run(1 * MIN);
    expect(w.minute - m).toBe(10);
  });

  it("出门时正在跑的专注暂停；直接操控时不计有效专注；休息在野外走完后不自动接下一轮", () => {
    const s = readyToGoOut(1);
    s.g.focus.settings.autoNext = true;
    cmdStartFocus(s.g, s.wall, cal, { preset: { kind: "countdown", focusMin: 25, breakMin: 5 } });
    s.run(12 * MIN);
    s.until((g) => cmdCheckOuting(g).ok, 600);
    cmdDepart(s.g, s.wall, { rations: 1, bundles: 0 });
    expect(s.g.focus.session?.paused).toBe("outdoor");
    const ms = s.g.focus.stats.totalMs;
    s.run(10 * MIN);
    expect(s.g.focus.stats.totalMs).toBe(ms);

    // 休息阶段出门玩：休息结束时下一轮不会自动开始
    const b = readyToGoOut(1);
    b.g.focus.settings.autoNext = true;
    cmdStartFocus(b.g, b.wall, cal, { preset: { kind: "countdown", focusMin: 25, breakMin: 5 } });
    b.run(26 * MIN);
    expect(b.g.focus.session?.phase).toBe("break");
    b.until((g) => cmdCheckOuting(g).ok, 600);
    cmdDepart(b.g, b.wall, { rations: 1, bundles: 0 });
    b.run(10 * MIN);
    expect(b.g.focus.session?.phase).toBe("awaitNext");
  });

  it("户外临时专注：世界冻结，他留在原地，照常得份；专注结束不自动切回去，要你点「回到野外」", () => {
    const s = readyToGoOut(1);
    cmdDepart(s.g, s.wall, { rations: 2, bundles: 0 });
    cmdTravelTo(s.g, s.wall, "pineForest");
    cmdStartFocus(s.g, s.wall, cal, { preset: { kind: "countdown", focusMin: 25, breakMin: 0 } });
    expect(s.g.mode).toBe("outdoorFocus");
    const before = worldFacts(s.g);
    s.run(40 * MIN);
    expect(s.g.focus.shares.total).toBe(1);
    expect(worldFacts(s.g)).toBe(before);
    expect(s.g.mode).toBe("outdoorFocus");
    const view = present(s.g, s.wall, cal);
    expect(view.stage.show).toBe(false);
    expect(view.modeLine).toContain("户外暂停");
    // 可以像氛围态一样自选画面，世界仍然停着
    expect(cmdEnterAmbience(s.g, { season: "autumn", weather: "A", time: "day" }).ok).toBe(true);
    expect(s.g.mode).toBe("outdoorFocus");
    expect(cmdReturnToWild(s.g).ok).toBe(true);
    expect(s.g.mode).toBe("outdoor");
    expect(s.g.world.outing).toMatchObject({ area: "pineForest", minutesFromDoor: 20 });
  });

  it("走回家门才算回家：背包入库，换回便服，专注不会自动恢复；上午被出门占了，下午补活计", () => {
    const s = session(1, { wood: 30, food: 20 });
    for (const ps of Object.values(s.g.world.projects)) ps.paused = true;
    if (s.g.world.weather.today === "D" || s.g.world.weather.today === "C") return;
    s.toClock(8 * 60 + 5);
    s.until((g) => cmdCheckOuting(g).ok, 600);
    const w = s.g.world;
    cmdStartFocus(s.g, s.wall, cal, { preset: { kind: "countup" } });
    const food0 = w.stock.food;
    expect(cmdDepart(s.g, s.wall, { rations: 2, bundles: 1 }).ok).toBe(true);
    const eaten = (): number => w.today.meals.filter((m) => m.eaten).length;
    const eatenAtHome = eaten();
    expect(w.today.outingMorning).toBe(true);
    cmdTravelTo(s.g, s.wall, "pineForest");
    expect(w.outing?.minutesFromDoor).toBe(20);
    s.run(20 * MIN); // 在松林待了 200 个游戏分钟
    const wood = w.stock.wood;
    expect(cmdHeadHome(s.g).ok).toBe(true);
    expect(s.g.mode).toBe("companion");
    expect(w.actor.away).toBe(false);
    expect(w.actor.outfit).toBe("indoor");
    // 带出去 2 份干粮，在外面到了饭点吃掉的那几份没了，剩下的原样入库
    expect(w.stock.food).toBe(food0 - (eaten() - eatenAtHome));
    expect(w.stock.wood).toBe(wood + 3);
    expect(s.g.focus.session?.paused).toBe("outdoor");
    // 这天没有做上午的活计，回来以后下午补
    expect(dayClock(w)).toBeLessThan(14 * 60);
    s.until((g) => g.world.today.afternoonChore || g.world.actor.asleep);
    expect(w.today.afternoonChore).toBe(true);
  });

  it("到午夜撑不住按昏倒：第二天早上在床上醒来，炉子是凉的要重新生火，柴粮丢一部分", () => {
    const s = readyToGoOut(1);
    const w = s.g.world;
    cmdDepart(s.g, s.wall, { rations: 4, bundles: 2 });
    const day = w.day;
    const food = w.stock.food;
    cmdTravelTo(s.g, s.wall, "pineForest");
    // 一直待到过了午夜
    for (let i = 0; i < 2000 && s.g.mode === "outdoor"; i++) s.run(6000);
    expect(s.g.mode).toBe("companion");
    expect(w.outing).toBeNull();
    expect(w.actor.place).toBe("bed");
    expect(w.events.some((e) => e.type === "collapse")).toBe(true);
    // 路上吃掉了午饭、晚饭两份干粮，剩下 2 份丢一半
    expect(w.stock.food).toBe(food + 1);
    s.until((g) => g.world.day === day + 1 && !g.world.actor.asleep, 600);
    s.until((g) => g.world.fire.burn > 0, 120);
    expect(w.tally["冷启动"]).toBe(1);
    expect(w.tally["无火分钟"] ?? 0).toBe(0);
  });

  it("返家提示：按天色和回程加半小时余量触发，一趟里每种只提一次，反复开地图不刷屏", () => {
    const s = readyToGoOut(1);
    const w = s.g.world;
    cmdDepart(s.g, s.wall, { rations: 2, bundles: 0 });
    cmdTravelTo(s.g, s.wall, "pineForest");
    const reminders = (): string[] => s.g.notices.filter((n) => n.kind === "reminder").map((n) => n.text);
    expect(reminders()).toEqual([]);
    const dusk = CONFIG.outing.dusk[seasonOf(w.day).season];
    expect(dusk).toBe(17 * 60);
    // 冬天 17:00 天黑，回程 20 分钟加半小时余量：16:10 提第一句
    while (dayClock(w) < 16 * 60 + 9) s.run(6000);
    expect(reminders()).toEqual([]);
    s.run(12_000);
    expect(reminders()).toEqual(["天色不早了，该往回走了。"]);
    for (let i = 0; i < 5; i++) {
      cmdOutdoorPanel(s.g, "map");
      s.run(5 * MIN);
      cmdOutdoorPanel(s.g, null);
      s.run(6000);
    }
    expect(reminders()).toHaveLength(1);
    while (dayClock(w) < 17 * 60 + 5) s.run(6000);
    expect(reminders()).toHaveLength(2);
    // 提示不要求确认，你仍可以接着走
    expect(s.g.mode).toBe("outdoor");
    cmdHeadHome(s.g);
    expect(reminders()).toHaveLength(2);
  });

  it("各季天黑的钟点是可调的初值：冬 17:00、春秋 18:30、夏 20:00", () => {
    expect(CONFIG.outing.dusk).toEqual({ winter: 17 * 60, spring: 18 * 60 + 30, summer: 20 * 60, autumn: 18 * 60 + 30 });
  });
});

describe("意向（02 第 6.4 节、第 14.1–14.2 条）", () => {
  it("小请求按游戏世界日过期：夜里没轮到，第二天醒来自动取消；现实午夜不会误取消", () => {
    const s = session(1);
    s.toClock(21 * 60 + 45);
    expect(cmdRequest(s.g, "windowSit").ok).toBe(true);
    // 离睡觉不到半小时，今天轮不到了
    s.until((g) => g.world.actor.asleep);
    expect(s.g.world.intents.request?.kind).toBe("windowSit");
    s.until((g) => !g.world.actor.asleep, 600);
    expect(s.g.world.intents.request).toBeNull();

    // 现实里跨过午夜，游戏日没换：请求还在
    const r = session(1);
    r.wall = Date.UTC(2026, 10, 16, 23, 58);
    r.toClock(21 * 60 + 45);
    cmdRequest(r.g, "windowSit");
    const day = r.g.world.day;
    r.run(4 * MIN);
    expect(cal.dateKey(r.wall)).toBe("2026-11-17");
    expect(r.g.world.day).toBe(day);
    expect(r.g.world.intents.request?.kind).toBe("windowSit");
  });

  it("一次一件；他择机去做，做了就消掉；当天可以取消", () => {
    const s = session(1);
    s.toClock(10 * 60);
    expect(cmdRequest(s.g, "tea").ok).toBe(true);
    expect(cmdRequest(s.g, "windowSit")).toEqual({ ok: false, reason: "已经说了一件" });
    s.until((g) => g.world.intents.request === null, 300);
    expect(s.g.world.events.some((e) => e.type === "request")).toBe(true);
    cmdRequest(s.g, "windowSit");
    cmdCancelRequest(s.g);
    expect(s.g.world.intents.request).toBeNull();
  });

  it("他睡着、被你带出门时不能提；早点歇只在傍晚 6 点以后有效；放唱片要有修好的唱片机", () => {
    const s = readyToGoOut(1);
    expect(cmdRequest(s.g, "earlyRest")).toEqual({ ok: false, reason: "天还早，他不肯睡" });
    expect(cmdRequest(s.g, "playRecord")).toEqual({ ok: false, reason: "唱片机还没修好" });
    s.until((g) => g.world.actor.asleep);
    expect(cmdRequest(s.g, "tea").ok).toBe(false);
    const o = readyToGoOut(1);
    cmdDepart(o.g, o.wall, { rations: 0, bundles: 0 });
    expect(cmdRequest(o.g, "tea").ok).toBe(false);
  });

  it("今天早点歇：吃过晚饭、压好火就睡，不能用来连着跳日子", () => {
    const s = session(1);
    s.toClock(18 * 60 + 5);
    expect(cmdRequest(s.g, "earlyRest").ok).toBe(true);
    s.until((g) => g.world.actor.asleep, 300);
    expect(dayClock(s.g.world)).toBeLessThan(20 * 60);
    expect(s.g.world.today.meals.find((m) => m.name === "dinner")?.eaten).toBe(true);
    expect(s.g.world.today.banked).toBe(true);
    // 还是睡到第二天清晨才醒
    const day = s.g.world.day;
    s.until((g) => !g.world.actor.asleep, 900);
    expect(s.g.world.day).toBe(day + 1);
    expect(cmdRequest(s.g, "earlyRest").ok).toBe(false);
  });

  it("菜地 4 格里至少 2 格归他定；暖棚 2 格里至少 1 格归他定，没修好不能选", () => {
    const s = session(1);
    expect(cmdPlotPreference(s.g, "garden", 0, "potato").ok).toBe(true);
    expect(cmdPlotPreference(s.g, "garden", 1, "radish").ok).toBe(true);
    expect(cmdPlotPreference(s.g, "garden", 2, "radish")).toEqual({ ok: false, reason: "其余的格子归他自己定" });
    // 已经指定的可以改、可以交还给他
    expect(cmdPlotPreference(s.g, "garden", 0, "cabbage").ok).toBe(true);
    expect(cmdPlotPreference(s.g, "garden", 1, null).ok).toBe(true);
    expect(cmdPlotPreference(s.g, "garden", 2, "radish").ok).toBe(true);
    expect(cmdPlotPreference(s.g, "greenhouse", 0, "radish").ok).toBe(false);
    s.g.world.projects.greenhouse.done = true;
    expect(cmdPlotPreference(s.g, "greenhouse", 0, "radish").ok).toBe(true);
    expect(cmdPlotPreference(s.g, "greenhouse", 1, "potato")).toEqual({ ok: false, reason: "其余的格子归他自己定" });
  });

  it("暖棚里你指定的那格不会盖掉已经种下的", () => {
    const s = session(1);
    const w = s.g.world;
    for (const ps of Object.values(w.projects)) ps.paused = true;
    w.projects.greenhouse.done = true;
    s.until((g) => g.world.greenhouse.every((p) => p.crop !== null), 10 * 1440);
    const growing = w.greenhouse[0].crop;
    const want = growing === "cabbage" ? "radish" : "cabbage";
    cmdPlotPreference(s.g, "greenhouse", 0, want);
    s.game(300);
    expect(w.greenhouse[0].crop).toBe(growing);
    s.until((g) => g.world.greenhouse[0].crop === want, 12 * 1440);
    // 另一格始终是他自己定的
    expect(w.greenhouse[1].preferred).toBeNull();
  });

  it("最多置顶 3 件；暂停不限", () => {
    const s = session(1);
    for (const id of ["carving", "radio", "handbook"]) expect(cmdPinProject(s.g, id).ok).toBe(true);
    expect(cmdPinProject(s.g, "cellar")).toEqual({ ok: false, reason: "最多置顶 3 件" });
    for (const id of ["windowGaps", "woodshed", "cellar", "fence"]) expect(cmdPauseProject(s.g, id, true).ok).toBe(true);
  });

  it("没有「添柴、做饭、备柴、备粮」这类命令", async () => {
    const api = await import("../src/core/game.ts");
    const names = Object.keys(api).filter((k) => k.startsWith("cmd"));
    for (const n of names) expect(n).not.toMatch(/Wood|Food|Cook|Fire|Chore|Stock|Meal/);
  });
});

describe("休眠、退出和断档（02 第 3.4 节）", () => {
  it("判定：正常心跳算数；墙上钟多走一大截是休眠；两个钟都走了很久是确认不了的断档", () => {
    const prev = { wall: T0, mono: 1_000_000 };
    expect(judgeGap(prev, { wall: T0 + 1000, mono: 1_001_000 })).toEqual({ kind: "running", verifiedMs: 1000, gapMs: 0 });
    // 后台节流到一分钟一跳：仍然确认在运行
    expect(judgeGap(prev, { wall: T0 + 61_000, mono: 1_061_000 }).kind).toBe("running");
    // 合上盖子两小时：单调钟没走
    expect(judgeGap(prev, { wall: T0 + 2 * HOUR, mono: 1_003_000 })).toEqual({ kind: "sleep", verifiedMs: 0, gapMs: 2 * HOUR });
    // 页面被冻结 23 分钟：两个钟都走了
    expect(judgeGap(prev, { wall: T0 + 23 * MIN, mono: 1_000_000 + 23 * MIN })).toEqual({
      kind: "unverified",
      verifiedMs: 0,
      gapMs: 23 * MIN,
    });
    // 时钟被往回拨：以单调钟为准
    expect(judgeGap(prev, { wall: T0 - HOUR, mono: 1_002_000 })).toEqual({ kind: "running", verifiedMs: 2000, gapMs: 0 });
  });

  it("休眠回来：世界从冻结的那一刻接着走，不补；这一轮停在「已暂停」，点继续才接着计", () => {
    const s = session(6);
    cmdStartFocus(s.g, s.wall, cal, { preset: { kind: "countup" } });
    s.run(20 * MIN);
    const minute = s.g.world.minute;
    const shares = s.g.focus.shares.total;
    // 电脑睡了 3 小时：驱动不给任何确认过的时间，只报一次休眠
    s.wall += 3 * HOUR;
    interrupt(s.g, "sleep");
    expect(s.g.world.minute).toBe(minute);
    expect(present(s.g, s.wall, cal).focus.bar).toBe("pausedAfterSleep");
    s.run(10 * MIN);
    expect(s.g.focus.stats.totalMs).toBe(20 * MIN);
    expect(s.g.focus.shares.total).toBe(shares);
    expect(s.g.world.minute - minute).toBe(40);
    cmdResumeFocus(s.g);
    s.run(5 * MIN);
    expect(s.g.focus.stats.totalMs).toBe(25 * MIN);
  });

  it("确认不了的断档：世界不补；专注由你选，算进去最多补 1 份", () => {
    const s = session(6);
    cmdStartFocus(s.g, s.wall, cal, { preset: { kind: "countup" } });
    s.run(12 * MIN);
    const minute = s.g.world.minute;
    s.wall += 2 * HOUR;
    interrupt(s.g, "gap", 2 * HOUR);
    const view = present(s.g, s.wall, cal);
    expect(view.focus.bar).toBe("pausedAfterGap");
    expect(view.focus.pendingGapMinutes).toBe(120);
    expect(s.g.world.minute).toBe(minute);
    cmdResolveGap(s.g, s.wall, cal, true);
    expect(s.g.focus.shares.total).toBe(2);
    expect(s.g.world.minute).toBe(minute);
    expect(s.g.world.pendingCones + s.g.world.jar.cones).toBe(2);
  });

  it("存档：退出再打开，世界和专注都停在退出的那一刻；离开多久都不补", () => {
    const s = session(9);
    cmdStartFocus(s.g, s.wall, cal, { preset: { kind: "countdown", focusMin: 50, breakMin: 10 } });
    s.run(33 * MIN);
    const text = serialize(s.g, s.wall);
    // 三天以后重新打开
    const later = s.wall + 72 * HOUR;
    const file = deserialize(text);
    const g = file.game;
    expect(file.savedWall).toBe(s.wall);
    expect(JSON.stringify(g.world)).toBe(JSON.stringify(s.g.world));
    interrupt(g, "exit");
    expect(g.focus.session?.paused).toBe("exit");
    expect(g.focus.session?.pendingGapMs).toBe(0);
    expect(g.focus.stats.totalMs).toBe(33 * MIN);
    // 没有「欢迎回来」的补算：手记里没有多出任何一天
    expect(g.world.summaries.length).toBe(s.g.world.summaries.length);
    // 接着走：和没有中断过、只是同样停着专注的那一局一模一样
    interrupt(s.g, "exit");
    let wall = later;
    for (let i = 0; i < 600; i++) {
      wall += 1000;
      advance(g, { wall, verifiedMs: 1000 }, cal);
    }
    s.run(10 * MIN);
    expect(JSON.stringify(g.world)).toBe(JSON.stringify(s.g.world));
  });

  it("读不了更新版本的存档，也不会把坏文件当成存档", () => {
    expect(() => deserialize("{}")).toThrow();
    expect(() => deserialize(JSON.stringify({ version: 999, savedWall: 0, game: {} }))).toThrow();
  });
});

describe("给界面的只读投影（06 第 2 节 ViewPresenter）", () => {
  it("读多少次都不改世界", () => {
    const s = session(12);
    s.run(30 * MIN);
    const before = JSON.stringify(s.g);
    for (let i = 0; i < 50; i++) present(s.g, s.wall, cal);
    expect(JSON.stringify(s.g)).toBe(before);
  });

  it("近况卡只有今天真实发生过的事，最多 4 条要紧的加 2 条展开；镜头里看不见他时有一句去向", () => {
    const s = session(12);
    s.toClock(15 * 60);
    const view = present(s.g, s.wall, cal);
    expect(view.today.top.length).toBeLessThanOrEqual(4);
    expect(view.today.more.length).toBeLessThanOrEqual(2);
    for (const e of [...view.today.top, ...view.today.more]) expect(e.day).toBe(s.g.world.day);
    expect(view.actor.whereabouts.length).toBeGreaterThan(0);
    expect(view.world.dayLabel).toBe("冬 · 第 1 天");
    // 动作卡不用第三人称
    expect(view.actor.label).not.toMatch(/他/);
  });

  it("可见率只统计正常陪伴、他醒着的时间", () => {
    const s = session(12);
    s.run(4 * HOUR + 10 * MIN);
    const t = s.g.telemetry;
    expect(t.companionMinutes).toBeGreaterThan(t.awakeMinutes);
    expect(t.awakeMinutes).toBeGreaterThan(900);
    expect(t.visibleAwake.wideYard).toBeGreaterThanOrEqual(t.visibleAwake.wideIndoor);
    expect(t.visibleAwake.wideIndoor).toBeGreaterThanOrEqual(t.visibleAwake.window);
    const zones = Object.values(t.zoneAwake).reduce((a, b) => a + b, 0);
    expect(zones).toBe(t.awakeMinutes);
  });
});
