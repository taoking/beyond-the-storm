// 窗外的小事：03 第 10.4 节（首版四种：窗沿的鸟、林边的鹿、南飞的大雁、冬夜的极光）。
// 底线（01）：不用点、不弹出来、不给奖励；手记只记他真看见的；不扰动世界的随机和他的日子。
import { describe, expect, it } from "vitest";
import { yearbook } from "../src/core/annals.ts";
import { seasonOf } from "../src/core/calendar.ts";
import { CONFIG } from "../src/core/config.ts";
import { fixedCalendar } from "../src/core/focus.ts";
import { advanceCompanionMinutes, cmdEnterAmbience, newGame } from "../src/core/game.ts";
import { placesIn } from "../src/core/rooms.ts";
import { deserialize, serialize } from "../src/core/save.ts";
import { activity, createWorld, stepMinute } from "../src/core/sim.ts";
import { dayClock, emptyYearPage, type WindowKind, type World } from "../src/core/state.ts";
import { present } from "../src/core/view.ts";
import { firstSightsLine, planWindowDay, windowEventView, windowTick, WINDOW_KINDS } from "../src/core/windowEvents.ts";

const WIN = CONFIG.IMPL.window;
const cal = fixedCalendar(0);

/** 把今天的窗外换成一件正在发生的 kind，他摆在 place，手头是 category 的事 */
function staged(kind: WindowKind, place: World["actor"]["place"], category: "leisure" | "chore" | "sleep" = "leisure"): World {
  const w = createWorld(3);
  stepMinute(w);
  w.actor.place = place;
  w.actor.asleep = category === "sleep";
  w.actor.activity = activity(category === "sleep" ? "sleep" : category === "chore" ? "choreWood" : "leisure", "测试", category, [{ place, minutes: 30 }]);
  w.windowEvents = { day: w.day, plan: [{ kind, start: w.minute, end: w.minute + 10, seen: false, watched: false }], firsts: {} };
  return w;
}

const windowLogs = (w: World) => w.events.filter((e) => e.type === "window");

describe("03 第 10.4 节：什么时候发生", () => {
  it("同一个种子、同一天永远排成一样；排的时候不改世界", () => {
    const a = createWorld(7);
    const b = createWorld(7);
    const before = JSON.stringify(a);
    expect(planWindowDay(a)).toEqual(planWindowDay(b));
    expect(JSON.stringify(a)).toBe(before);
  });

  it("windowTick 不抽世界的随机数、不碰他在做的事", () => {
    const w = createWorld(11);
    for (let i = 0; i < 3 * 1440; i++) {
      const strip = (x: World) => {
        const { windowEvents: _a, events: _b, nextEventId: _c, yearStats, ...rest } = x;
        return JSON.stringify({ ...rest, yearStats: { ...yearStats, firstSights: undefined } });
      };
      const before = strip(w);
      windowTick(w);
      expect(strip(w)).toBe(before);
      stepMinute(w);
    }
  });

  it("只在合适的季节、天气、钟点；一天最多两件、彼此不重叠", () => {
    let total = 0;
    for (let seed = 0; seed < 12; seed++) {
      const g = newGame(seed);
      const w = g.world;
      let day = -1;
      while (w.day < 120) {
        advanceCompanionMinutes(g, 30);
        if (w.day === day) continue;
        day = w.day;
        const plan = w.windowEvents.plan.filter((e) => e.start >= w.dayStart);
        expect(plan.length).toBeLessThanOrEqual(WIN.maxPerDay);
        const info = seasonOf(w.day);
        for (const e of plan) {
          const def = WIN.kinds[e.kind];
          total += 1;
          expect(def.chance[info.season]).toBeGreaterThan(0);
          expect(def.tiers).toContain(w.weather.today);
          expect(def.looks).toContain(w.weather.look);
          const clock = e.start - w.dayStart + CONFIG.calendar.wakeMinute;
          expect(clock).toBeGreaterThanOrEqual(def.from);
          expect(clock).toBeLessThan(def.to);
          expect(e.end - e.start).toBeGreaterThanOrEqual(def.minutes[0]);
          expect(e.end - e.start).toBeLessThanOrEqual(def.minutes[1]);
          if (e.kind === "geese") expect(info.dayInSeason).toBeLessThan(def.autumnDays!);
        }
        const sorted = [...plan].sort((x, y) => x.start - y.start);
        for (let i = 1; i < sorted.length; i++) expect(sorted[i].start).toBeGreaterThanOrEqual(sorted[i - 1].end);
      }
    }
    expect(total).toBeGreaterThan(0);
  });

  it("稀：平均每个世界年十来件，极光一冬一两回，暴风雪天、出不了院子的天一件也没有", () => {
    const count: Record<string, number> = {};
    let badDays = 0;
    const runs = 16;
    for (let seed = 100; seed < 100 + runs; seed++) {
      const w = createWorld(seed);
      while (w.day < 60) {
        const d = w.day;
        while (w.day === d) stepMinute(w);
        // 刚换了一天：windowTick 已经排好了这一天
        const plan = w.windowEvents.plan.filter((e) => e.start >= w.dayStart);
        if (w.weather.today === "C" || w.weather.today === "D") badDays += plan.length;
        for (const e of plan) count[e.kind] = (count[e.kind] ?? 0) + 1;
      }
    }
    const perYear = (k: string) => (count[k] ?? 0) / runs;
    const all = WINDOW_KINDS.reduce((a, k) => a + perYear(k), 0);
    expect(badDays).toBe(0);
    expect(all).toBeGreaterThan(6);
    expect(all).toBeLessThan(30);
    expect(perYear("aurora")).toBeLessThan(4);
    expect(perYear("geese")).toBeLessThan(4);
  });
});

describe("03 第 10.4 节：他看见了才进手记", () => {
  it("窗沿的鸟：他在观测间才看得见；第一次是这天的要事，以后只记一笔日常", () => {
    for (const p of WIN.observationPlaces) expect(placesIn("observation_room")).toContain(p);
    const away = staged("bird", "stove");
    windowTick(away);
    expect(windowLogs(away)).toHaveLength(0);
    expect(away.windowEvents.plan[0].seen).toBe(false);

    const w = staged("bird", "window");
    windowTick(w);
    const [log] = windowLogs(w);
    expect(log.weight).toBe(3);
    expect(log.text).toContain("窗沿上落了只小鸟");
    expect(log.text).toContain("看了一会儿");
    expect(w.windowEvents.firsts.bird).toBe(w.day);
    expect(w.yearStats.firstSights).toEqual(["bird"]);
    // 同一件只记一次
    stepMinute(w);
    expect(windowLogs(w)).toHaveLength(1);

    // 下一件：日常
    w.windowEvents.plan = [{ kind: "bird", start: w.minute, end: w.minute + 5, seen: false, watched: false }];
    w.actor.place = "desk";
    windowTick(w);
    expect(windowLogs(w)[1].weight).toBe(1);
    expect(w.yearStats.firstSights).toEqual(["bird"]);
  });

  it("鹿、大雁、极光：醒着在家哪儿都看得见；睡着、出门了不记", () => {
    const busy = staged("deer", "stove", "chore");
    windowTick(busy);
    expect(windowLogs(busy)[0].text).toBe("远处林子边上站着一头鹿。");
    expect(busy.windowEvents.plan[0].watched).toBe(false);

    const asleep = staged("aurora", "bed", "sleep");
    windowTick(asleep);
    expect(windowLogs(asleep)).toHaveLength(0);

    const out = staged("geese", "gate");
    out.actor.away = true;
    windowTick(out);
    expect(windowLogs(out)).toHaveLength(0);
  });

  it("快照：正常陪伴里给画面一个只读字段；氛围态里没有", () => {
    const g = newGame(5);
    advanceCompanionMinutes(g, 1);
    const w = g.world;
    w.windowEvents.plan = [{ kind: "aurora", start: w.minute - 10, end: w.minute + 30, seen: false, watched: false }];
    const snap = present(g, 0, cal);
    expect(snap.stage.windowEvent).toMatchObject({ kind: "aurora", name: "极光", seed: w.minute - 10, progress: 0.25 });
    expect(windowEventView(w)?.progress).toBe(0.25);
    cmdEnterAmbience(g, { season: "winter", weather: "A", time: "night" });
    expect(present(g, 0, cal).stage.windowEvent).toBeNull();
  });
});

describe("年册：第一次看到的窗外小事", () => {
  it("接在世界一栏的末尾；这一年没有就不写", () => {
    expect(firstSightsLine([])).toBe("");
    expect(firstSightsLine(["aurora"])).toBe("第一次看见极光。");
    expect(firstSightsLine(["bird", "deer", "aurora"])).toBe("第一次看见窗沿的小鸟、林边的鹿和极光。");

    const g = newGame(2);
    const page = { ...emptyYearPage(0, "plain"), firstSights: ["deer", "aurora"] as WindowKind[] };
    const bare = { ...emptyYearPage(1, "plain") };
    delete bare.firstSights;
    g.world.yearbook.push(page, bare);
    const book = yearbook(g, cal);
    expect(book.pages[0].world.at(-1)).toBe("第一次看见林边的鹿和极光。");
    expect(book.pages[1].world.some((l) => l.includes("第一次看见"))).toBe(false);
  });

  it("真跑一年：第一次看见的都在第一页，第二年不再重复", () => {
    const g = newGame(1);
    advanceCompanionMinutes(g, 2 * 60 * 1440 + 60);
    const [y1, y2] = g.world.yearbook;
    const firsts = Object.keys(g.world.windowEvents.firsts);
    expect(firsts.length).toBeGreaterThan(0);
    expect([...(y1.firstSights ?? []), ...(y2.firstSights ?? [])].sort()).toEqual([...firsts].sort());
    for (const k of y2.firstSights ?? []) expect(y1.firstSights).not.toContain(k);
  });
});

describe("存档", () => {
  it("老存档没有窗外小事：读档补上，接着走", () => {
    const g = newGame(4);
    advanceCompanionMinutes(g, 600);
    const raw = JSON.parse(serialize(g, 0));
    delete raw.game.world.windowEvents;
    delete raw.game.world.yearStats.firstSights;
    const back = deserialize(JSON.stringify(raw)).game;
    expect(back.world.windowEvents).toEqual({ day: -1, plan: [], firsts: {} });
    advanceCompanionMinutes(back, 10);
    expect(back.world.windowEvents.day).toBe(back.world.day);
    expect(dayClock(back.world)).toBeGreaterThan(0);
  });
});
