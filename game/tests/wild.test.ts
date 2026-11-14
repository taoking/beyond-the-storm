// 野外按动作走：区域地图、采集、背包、身体状态、篝火、回家和昏倒（02 第 9 节，03 第 3.4、5.1 节）。
import { describe, expect, it } from "vitest";
import { seasonOf } from "../src/core/calendar.ts";
import { CONFIG, type WeatherTier } from "../src/core/config.ts";
import { AREA_BY_ID, AREAS } from "../src/core/content.ts";
import { fixedCalendar } from "../src/core/focus.ts";
import { cmdCheckOuting, cmdDepart, cmdOutdoor, newGame, type Game } from "../src/core/game.ts";
import { bagSlots, fullBody } from "../src/core/outing.ts";
import { deserialize, serialize } from "../src/core/save.ts";
import { stepMinute } from "../src/core/sim.ts";
import { dayClock } from "../src/core/state.ts";
import { present } from "../src/core/view.ts";
import { nodeAvailable, pathTo, passable, type WildAction } from "../src/core/wild.ts";

const W = CONFIG.IMPL.wild;
const cal = fixedCalendar(0);
const WALL = Date.UTC(2026, 10, 16, 9);
const forest = AREA_BY_ID.pineForest;
const node = (id: string) => forest.nodes.find((n) => n.id === id)!;

/** 9 点以后、能出门的那一刻；weather 固定这一天的天气档 */
function ready(opt: { seed?: number; weather?: WeatherTier; day?: (d: number) => boolean } = {}): Game {
  for (let seed = opt.seed ?? 1; seed < (opt.seed ?? 1) + 80; seed++) {
    const g = newGame(seed);
    const w = g.world;
    for (const ps of Object.values(w.projects)) ps.paused = true;
    let guard = 40 * 1440;
    while (guard-- > 0 && !(dayClock(w) >= 9 * 60 && !w.actor.asleep && (!opt.day || opt.day(w.day)) && w.weather.today !== "D" && cmdCheckOuting(g).ok)) {
      stepMinute(w);
    }
    if (guard <= 0) continue;
    if (opt.weather) w.weather.today = opt.weather;
    return g;
  }
  throw new Error("找不到合适的种子");
}

function out(g: Game, pack = { rations: 2, bundles: 1 }): Game {
  const r = cmdDepart(g, WALL, pack);
  if (!r.ok) throw new Error(r.reason);
  return g;
}

function act(g: Game, action: WildAction): void {
  const r = cmdOutdoor(g, WALL, action);
  if (!r.ok) throw new Error(`${JSON.stringify(action)}：${r.reason}`);
}

const facts = (g: Game): string => JSON.stringify([g.world.minute, g.world.stock, g.world.fire, g.world.outing, g.world.wild, g.world.events.length, g.mode]);

describe("区域是数据（03 第 5.1 节）", () => {
  it("地图每行一样宽；出口、入口、生火点、资源点都在能走的格子上，彼此走得到", () => {
    for (const area of AREAS) {
      const width = area.map[0].length;
      expect(area.map.every((row) => row.length === width)).toBe(true);
      const spots = [area.entry, ...area.exits, ...area.fires, ...area.nodes];
      for (const p of spots) expect(passable(area, p.x, p.y)).toBe(true);
      for (const p of spots) expect(pathTo(area, area.entry, (q) => q.x === p.x && q.y === p.y)).not.toBeNull();
      expect(area.exits.some((e) => e.to === "home")).toBe(true);
    }
  });

  it("松林的工棚按 03 第 3.4 节的账：木料 10、旧绳索 3、帆布 5、1 罐油、1 个罐头", () => {
    const shed = Object.fromEntries(forest.nodes.filter((n) => n.kind === "salvage").map((n) => [n.gives, n.total]));
    expect(shed).toEqual({ lumber: 10, rope: 3, canvas: 5, fuel: 1, cans: 1 });
    expect(forest.homeMinutes).toBe(20);
  });
});

describe("按动作走（用户 2026-11-14 定）", () => {
  it("去松林走 20 个游戏分钟，落在林口；不能穿墙、斜走、跳格；做不了的命令什么都不改", () => {
    const g = out(ready());
    const m = g.world.minute;
    act(g, { type: "travel", to: "pineForest" });
    expect(g.world.minute - m).toBe(20);
    expect(g.world.outing).toMatchObject({ area: "pineForest", pos: forest.entry, minutesFromDoor: 20 });
    const before = facts(g);
    const notices = g.notices.length;
    for (const bad of [
      { type: "move", dx: -1, dy: 0 }, // 林口外是路，不是格子
      { type: "move", dx: 1, dy: 1 },
      { type: "move", dx: 2, dy: 0 },
      { type: "move", dx: 0.5, dy: 0 },
      { type: "walkTo", x: 0, y: 0 },
      { type: "travel", to: "pineForest" },
      { type: "travel", to: "nowhere" },
    ] as WildAction[]) {
      expect(cmdOutdoor(g, WALL, bad).ok).toBe(false);
    }
    expect(facts(g)).toBe(before);
    expect(g.notices.length).toBe(notices + 7);
    act(g, { type: "move", dx: 1, dy: 0 });
    const there = facts(g);
    // 不在出口不能回家
    expect(cmdOutdoor(g, WALL, { type: "travel", to: "home" })).toEqual({ ok: false, reason: "沿小路走回松林的出口，才能回家。" });
    expect(facts(g)).toBe(there);
    expect(before).not.toBe(there);
  });

  it("走一格花 stepMinutes；回家门的分钟数含林子里的路；点远处一格是一步步走过去，时间照算", () => {
    const g = out(ready());
    act(g, { type: "travel", to: "pineForest" });
    const m = g.world.minute;
    act(g, { type: "walkTo", x: 5, y: 4 });
    expect(g.world.minute - m).toBe(5 * W.stepMinutes);
    expect(g.world.outing!.minutesFromDoor).toBe(20 + 5 * W.stepMinutes);
    expect(g.world.outing!.last).toBe("walk");
  });

  it("体温：好天掉得最慢，大雪冻雨最快，夜里更冷；全是整数", () => {
    const loss = (weather: WeatherTier, night = false): number => {
      const g = out(ready({ weather }));
      act(g, { type: "travel", to: "pineForest" });
      if (night) {
        while (dayClock(g.world) < CONFIG.outing.dusk[seasonOf(g.world.day).season]) {
          g.world.outing!.body = fullBody();
          act(g, { type: "rest" });
        }
      }
      g.world.outing!.body = fullBody();
      act(g, { type: "rest" });
      expect(Number.isInteger(g.world.outing!.body.warmth)).toBe(true);
      return W.bodyMax - g.world.outing!.body.warmth;
    };
    const a = loss("A");
    const b = loss("B");
    const c = loss("C");
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(loss("A", true)).toBe(a + W.nightChill * W.restMinutes);
  });

  it("好天从容走一趟不用生火：冬天上午出门，在林子里待 4 个小时，走回家还暖和", () => {
    const g = out(ready({ weather: "A" }));
    act(g, { type: "travel", to: "pineForest" });
    for (let i = 0; i < 24; i++) act(g, { type: "rest" });
    act(g, { type: "travel", to: "home" });
    expect(g.mode).toBe("companion");
    expect(g.world.tally["昏倒"] ?? 0).toBe(0);
  });
});

describe("采集和背包（02 第 9.2–9.3 节）", () => {
  it("点资源点自动走过去采：路和采都花时间；绳索一次拿完 3 件，走回家门才入库；拿完就没有了，下一趟也没有", () => {
    const g = out(ready({ weather: "A" }));
    act(g, { type: "travel", to: "pineForest" });
    const m = g.world.minute;
    act(g, { type: "gather", node: "shedRope" });
    const o = g.world.outing!;
    const steps = pathTo(forest, forest.entry, (p) => Math.abs(p.x - 13) + Math.abs(p.y - 4) <= 1)!.length;
    expect(g.world.minute - m).toBe(steps * W.stepMinutes + W.gather.salvage.minutes);
    expect(o.bag.rope).toBe(3);
    expect(g.world.stock.materials.rope).toBe(0);
    expect(g.world.wild.taken.shedRope).toBe(3);
    expect(cmdOutdoor(g, WALL, { type: "gather", node: "shedRope" })).toEqual({ ok: false, reason: "已经拿完了。" });
    act(g, { type: "walkTo", x: 0, y: 4 });
    act(g, { type: "travel", to: "home" });
    expect(g.world.stock.materials.rope).toBe(3);
    expect(g.world.tally["带回的素材:rope"]).toBe(3);
    expect(nodeAvailable(g.world, node("shedRope"))).toBe(0);
  });

  it("木料一次最多拿一格（5 件），剩下的留着；记的是拿走了几件，以后补齐 03 的数量老存档也拿得到", () => {
    const g = out(ready({ weather: "A" }));
    act(g, { type: "travel", to: "pineForest" });
    act(g, { type: "gather", node: "shedLumber" });
    expect(g.world.outing!.bag.lumber).toBe(5);
    expect(nodeAvailable(g.world, node("shedLumber"))).toBe(5);
    act(g, { type: "gather", node: "shedLumber" });
    expect(g.world.outing!.bag.lumber).toBe(10);
    expect(nodeAvailable(g.world, node("shedLumber"))).toBe(0);
    expect(g.world.wild.taken.shedLumber).toBe(10);
  });

  it("季节和天数：松子只在秋冬；枯枝采过以后过 3 天才恢复", () => {
    const summer = ready({ day: (d) => seasonOf(d).season === "summer", weather: "A" });
    expect(nodeAvailable(summer.world, node("pineNuts"))).toBe(0);
    const g = out(ready({ weather: "A" }));
    expect(seasonOf(g.world.day).season).toBe("winter");
    expect(nodeAvailable(g.world, node("pineNuts"))).toBe(W.gather.forage.amount);
    act(g, { type: "travel", to: "pineForest" });
    act(g, { type: "gather", node: "twigsA" });
    expect(g.world.outing!.bag.wood).toBe(3 + W.gather.twigs.amount);
    expect(cmdOutdoor(g, WALL, { type: "gather", node: "twigsA" })).toEqual({ ok: false, reason: "前两天才采过，还没长回来。" });
    const day = g.world.day;
    g.world.day = day + W.gather.twigs.regrowDays! - 1;
    expect(nodeAvailable(g.world, node("twigsA"))).toBe(0);
    g.world.day = day + W.gather.twigs.regrowDays!;
    expect(nodeAvailable(g.world, node("twigsA"))).toBe(W.gather.twigs.amount);
  });

  it("20 格算上带出去的干粮和柴，柴捆和捡的柴按根合在一起堆；装不下的东西留在原地，什么都不改", () => {
    const g = out(ready({ weather: "A" }), { rations: 2, bundles: 1 });
    const o = g.world.outing!;
    // 1 捆柴加 3 根捡的是 6 根，一格
    expect(bagSlots(o.rations, { wood: 6 })).toBe(2);
    act(g, { type: "travel", to: "pineForest" });
    o.bag.parts = 5 * (CONFIG.outing.bagSlots - 2); // 用别的东西塞满
    expect(bagSlots(o.rations, o.bag)).toBe(CONFIG.outing.bagSlots);
    const before = facts(g);
    expect(cmdOutdoor(g, WALL, { type: "gather", node: "shedRope" })).toEqual({ ok: false, reason: "背包装不下了，东西先留在原地。" });
    expect(facts(g)).toBe(before);
    expect(nodeAvailable(g.world, node("shedRope"))).toBe(3);
    // 柴还能塞进那一格里剩下的空：1 捆是 3 根，再捡 3 根正好 6 根一格
    act(g, { type: "gather", node: "twigsA" });
    expect(g.world.outing!.bag.wood).toBe(6);
  });

  it("燃油、罐头到家里的上限就不拿，留在原地", () => {
    const g = out(ready({ weather: "A" }));
    g.world.stock.fuel = CONFIG.stock.fuelCap;
    act(g, { type: "travel", to: "pineForest" });
    expect(cmdOutdoor(g, WALL, { type: "gather", node: "shedFuel" })).toEqual({ ok: false, reason: "家里的燃油放满了，先留在这里。" });
    expect(nodeAvailable(g.world, node("shedFuel"))).toBe(1);
    act(g, { type: "gather", node: "shedCan" });
    expect(g.world.outing!.bag.cans).toBe(1);
  });
});

describe("身体状态、篝火、昏倒（02 第 9.4、9.7 节）", () => {
  it("篝火只能在生火点生，要一捆柴、花时间；点着以后在旁边歇体温往上走，走开就掉", () => {
    const g = out(ready({ weather: "B" }), { rations: 2, bundles: 1 });
    act(g, { type: "travel", to: "pineForest" });
    expect(cmdOutdoor(g, WALL, { type: "fire" })).toEqual({ ok: false, reason: "这里生不了火，找个生火点。" });
    act(g, { type: "walkTo", x: 2, y: 5 }); // 生火点 (2,6) 旁边
    for (let i = 0; i < 6; i++) act(g, { type: "rest" });
    const cold = g.world.outing!.body.warmth;
    const m = g.world.minute;
    act(g, { type: "fire" });
    expect(g.world.minute - m).toBe(W.lightFireMinutes);
    expect(g.world.outing!.bag.wood ?? 0).toBe(0);
    expect(g.world.tally["野外烧的柴"]).toBe(3);
    act(g, { type: "rest" });
    expect(g.world.outing!.body.warmth).toBeGreaterThan(cold);
    expect(cmdOutdoor(g, WALL, { type: "fire" })).toEqual({ ok: false, reason: "背包里的柴不够一捆。" });
    const warm = g.world.outing!.body.warmth;
    expect(warm).toBeGreaterThan(cold);
    act(g, { type: "walkTo", x: 13, y: 7 });
    const away = g.world.outing!.body.warmth;
    act(g, { type: "rest" });
    expect(g.world.outing!.body.warmth).toBeLessThan(away);
    expect(present(g, WALL, cal).outing!.nearFire).toBe(false);
  });

  it("歇一会儿、吃干粮能回体力；饭点在外面自动吃一份干粮，也回体力", () => {
    const g = out(ready({ weather: "A" }), { rations: 3, bundles: 0 });
    act(g, { type: "travel", to: "pineForest" });
    const o = g.world.outing!;
    o.body.stamina = 1000;
    act(g, { type: "rest" });
    expect(o.body.stamina).toBe(1000 - W.stamina.rest * W.restMinutes);
    const s = o.body.stamina;
    act(g, { type: "eat" });
    expect(o.rations).toBe(2);
    expect(o.body.stamina).toBe(s + W.rationStamina);
  });

  it("体力见底会昏倒：手记写累得走不动；素材全留，柴粮丢一部分", () => {
    const g = out(ready({ weather: "A" }), { rations: 0, bundles: 2 });
    act(g, { type: "travel", to: "pineForest" });
    act(g, { type: "gather", node: "shedRope" });
    const wood = g.world.stock.wood;
    for (let i = 0; i < 2000 && g.mode === "outdoor"; i++) {
      g.world.outing!.body.warmth = W.bodyMax;
      act(g, { type: "move", dx: 0, dy: i % 2 ? 1 : -1 });
    }
    expect(g.mode).toBe("companion");
    expect(g.world.actor.place).toBe("bed");
    expect(g.world.events.filter((e) => e.type === "collapse").map((e) => e.text)).toEqual(["在外面累得走不动了。醒来已经在自己的床上。"]);
    expect(g.world.stock.materials.rope).toBe(3);
    expect(g.world.stock.wood).toBe(wood + Math.floor(6 * (1 - CONFIG.IMPL.collapseLossRatio)));
    expect(g.notices.some((n) => n.kind === "body" && n.text.includes("累"))).toBe(true);
  });

  it("体温见底开始掉生命，生命见底会昏倒：手记写冻得撑不住；先提醒一句冷了", () => {
    const g = out(ready({ weather: "C" }), { rations: 2, bundles: 0 });
    act(g, { type: "travel", to: "pineForest" });
    for (let i = 0; i < 300 && g.mode === "outdoor"; i++) {
      g.world.outing!.body.stamina = W.bodyMax;
      act(g, { type: "rest" });
    }
    expect(g.mode).toBe("companion");
    expect(g.world.events.filter((e) => e.type === "collapse").map((e) => e.text)).toEqual(["在外面冻得撑不住了。醒来已经在自己的床上。"]);
    expect(g.world.tally["昏倒:cold"]).toBe(1);
    expect(g.notices.some((n) => n.kind === "body" && n.text.includes("冷"))).toBe(true);
    // 没有永久的后果：第二天早上醒来，先生火
    let guard = 2 * 1440;
    while (guard-- > 0 && (g.world.actor.asleep || g.world.actor.activity?.kind === "sleep")) stepMinute(g.world);
    while (guard-- > 0 && g.world.fire.burn <= 0) stepMinute(g.world);
    expect(g.world.fire.burn).toBeGreaterThan(0);
    expect(g.world.tally["无火分钟"] ?? 0).toBe(0);
  });

  it("一个时钟：家里的火只按动作花掉的分钟烧；身体三项和背包一直是整数", () => {
    const g = out(ready({ weather: "B" }));
    const burn = g.world.fire.burn;
    act(g, { type: "travel", to: "pineForest" });
    act(g, { type: "gather", node: "twigsB" });
    act(g, { type: "rest" });
    act(g, { type: "eat" });
    const spent = g.world.minute - g.world.outing!.departedAt;
    expect(g.world.fire.burn).toBe(burn - spent);
    const o = g.world.outing!;
    for (const v of [...Object.values(o.body), ...Object.values(o.bag)]) expect(Number.isInteger(v)).toBe(true);
  });

  it("D6 暂行不变：在外面到了饭点没带干粮，这顿没吃上，不算缺餐", () => {
    const g = out(ready({ weather: "A" }), { rations: 0, bundles: 0 });
    act(g, { type: "travel", to: "pineForest" });
    while (dayClock(g.world) < CONFIG.meals.lunch + 5) {
      g.world.outing!.body = fullBody();
      act(g, { type: "rest" });
    }
    const lunch = g.world.today.meals.find((m) => m.name === "lunch")!;
    expect(lunch).toMatchObject({ eaten: false, skipped: true });
    expect(g.world.today.missedMeals).toBe(0);
    expect(CONFIG.IMPL.outingMealWithoutRationsIsMissed).toBe(false);
  });
});

describe("存档", () => {
  it("位置、背包、身体、篝火、资源点的记忆存了读回来一样，接着能走", () => {
    const g = out(ready({ weather: "A" }));
    act(g, { type: "travel", to: "pineForest" });
    act(g, { type: "gather", node: "shedCanvas" });
    const back = deserialize(serialize(g, WALL)).game;
    expect(back.world.outing).toEqual(g.world.outing);
    expect(back.world.wild).toEqual(g.world.wild);
    act(back, { type: "move", dx: 0, dy: 1 });
  });

  it("老存档：没有野外记忆、行囊还是柴捆的，读回来柴按根进背包，身体是满的，人在林口", () => {
    const g = out(ready({ weather: "A" }), { rations: 2, bundles: 2 });
    act(g, { type: "travel", to: "pineForest" });
    const old = JSON.parse(serialize(g, WALL));
    const o = old.game.world.outing;
    old.game.world.wild = undefined;
    for (const k of ["bag", "body", "campfire", "last", "pos"]) delete o[k];
    o.bundles = 2;
    o.reminded = { dusk: false, night: false, late: false };
    const back = deserialize(JSON.stringify(old)).game;
    expect(back.world.wild).toEqual({ taken: {}, harvested: {} });
    expect(back.world.outing).toMatchObject({ bag: { wood: 6 }, body: fullBody(), pos: forest.entry, area: "pineForest" });
    expect("bundles" in back.world.outing!).toBe(false);
    act(back, { type: "travel", to: "home" });
    expect(back.mode).toBe("companion");
  });
});

describe("长跑：带他出门（固定的出门策略）", () => {
  it("每 3 天去一趟松林：不缺餐、不断火、不昏倒；柴的账对得上；家里不靠它", async () => {
    const { CASES, runCase } = await import("../src/core/longrun.ts");
    const c = CASES.find((x) => x.id === "outings")!;
    const r = runCase(c, 4, 2);
    expect(r.outing["出门"]).toBeGreaterThan(4);
    expect(r.missedMeals).toBe(0);
    expect(r.noFireMinutes).toBe(0);
    expect(r.outing["昏倒"] ?? 0).toBe(0);
    expect(r.tierShare.thrift).toBeLessThan(0.01);
    // 带回的柴 = 带走的 + 采到的 − 烧掉的（装不下的不入库，所以只会少不会多）
    const o = r.outing;
    expect(o["带回的柴"]).toBeLessThanOrEqual(o["行囊带走的柴"] + o["野外采到:wood"] - (o["野外烧的柴"] ?? 0) + 1e-9);
    expect(o["带回的柴"]).toBeGreaterThan(0.95 * (o["行囊带走的柴"] + o["野外采到:wood"] - (o["野外烧的柴"] ?? 0)));
  });
});
