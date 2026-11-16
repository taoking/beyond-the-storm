// 年册和统计页的只读汇总：02 第 2.7、11 节，03 第 4.3、13 节，04 第 8 节。
import { describe, expect, it } from "vitest";
import { cnNumber, focusStats, noteWorldYear, weekKeys, yearbook, yearTitle } from "../src/core/annals.ts";
import { CONFIG } from "../src/core/config.ts";
import { fixedCalendar } from "../src/core/focus.ts";
import {
  advance,
  advanceCompanionMinutes,
  cmdAddTask,
  cmdCheckOuting,
  cmdCompleteTask,
  cmdDepart,
  cmdEndFocus,
  cmdOutdoor,
  cmdStartFocus,
  newGame,
  type Game,
} from "../src/core/game.ts";
import { deserialize, serialize } from "../src/core/save.ts";
import { stepMinute } from "../src/core/sim.ts";
import { dayClock, emptyYearPage } from "../src/core/state.ts";

const cal = fixedCalendar(0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const YEAR_MIN = CONFIG.calendar.yearDays * 1440;
// 2026-11-16 是周一
const T0 = Date.UTC(2026, 10, 16, 9);

function session(seed = 1) {
  const g = newGame(seed);
  const s = {
    g,
    wall: T0,
    /** 按确认在运行的现实时间往前走（专注和世界都走） */
    run(ms: number, stepMs = 10_000): void {
      let left = ms;
      while (left > 0) {
        const dt = Math.min(stepMs, left);
        s.wall += dt;
        advance(g, { wall: s.wall, verifiedMs: dt }, cal);
        left -= dt;
      }
    },
    /** 现实时间跳过去（应用关着），世界不走 */
    idle(ms: number): void {
      s.wall += ms;
    },
    focus(ms: number, taskId: number | null = null): void {
      cmdStartFocus(g, s.wall, cal, { preset: { kind: "countup" }, taskId, category: "code" });
      s.run(ms);
      cmdEndFocus(g, s.wall, cal);
    },
  };
  return s;
}

/** 世界直接推到下一年的第一天，再来一下心跳让 game.ts 记下新一年的墙上钟 */
function toNextYear(s: ReturnType<typeof session>): void {
  const w = s.g.world;
  const target = (Math.floor(w.day / CONFIG.calendar.yearDays) + 1) * CONFIG.calendar.yearDays;
  let guard = YEAR_MIN * 2;
  while (w.day < target && guard-- > 0) advanceCompanionMinutes(s.g, 1);
  s.run(1000, 1000);
}

describe("世界年开始的墙上钟", () => {
  it("第一下心跳记下第一年；走进下一年时记下那一刻", () => {
    const s = session();
    expect(s.g.yearWalls).toEqual({});
    s.run(1000, 1000);
    expect(s.g.yearWalls).toEqual({ 0: T0 + 1000 });
    s.idle(3 * HOUR);
    toNextYear(s);
    expect(s.g.yearWalls[1]).toBe(s.wall);
    expect(s.g.world.yearbook).toHaveLength(1);
  });

  it("一次跳过好几年：中间那几年是空的一段；白纸记录却已不在第一年：之前的年记成不知道", () => {
    const g = newGame(2);
    g.yearWalls = { 0: 100 };
    advanceCompanionMinutes(g, YEAR_MIN * 2 + 1440);
    noteWorldYear(g, 500);
    expect(g.yearWalls).toEqual({ 0: 100, 1: 500, 2: 500 });
    const h = newGame(3);
    advanceCompanionMinutes(h, YEAR_MIN + 1440);
    noteWorldYear(h, 900);
    expect(h.yearWalls).toEqual({ 0: null, 1: 900 });
  });

  it("没有记这个的老存档：到今天为止的每一年都记成不知道，年册的现实一栏照实说", () => {
    const g = newGame(4);
    advanceCompanionMinutes(g, YEAR_MIN + 1440);
    delete (g as Partial<Game>).yearWalls;
    const back = deserialize(serialize(g, T0)).game;
    expect(back.yearWalls).toEqual({ 0: null, 1: null });
    const book = yearbook(back, cal);
    expect(book.pages).toHaveLength(1);
    expect(book.pages[0].real.known).toBe(false);
    expect(book.pages[0].real.lines).toEqual(["这一年开始时还没有对照现实时间。"]);
  });
});

describe("世界年册（02 第 11 节、03 第 13 节）", () => {
  it("只有过完的年才有一页；还在过的这一年只有一句", () => {
    const s = session();
    s.run(1000, 1000);
    const book = yearbook(s.g, cal);
    expect(book.pages).toEqual([]);
    expect(book.current.text).toBe("第一年还在过，今天是冬天第 1 天。过完这一年，这里多一页。");
  });

  it("现实一栏只算这一年对应的那段现实时间：专注、份、勾完的任务；第二年的不混进来", () => {
    const s = session();
    cmdAddTask(s.g, "读完第三章", "study");
    cmdAddTask(s.g, "改简历", "write");
    s.focus(50 * MIN);
    cmdCompleteTask(s.g, 1, s.wall, cal);
    s.idle(26 * HOUR);
    s.focus(30 * MIN);
    toNextYear(s);
    s.focus(20 * MIN);
    cmdCompleteTask(s.g, 2, s.wall, cal);

    const page = yearbook(s.g, cal).pages[0];
    expect(page.real.known).toBe(true);
    expect(page.real.focusMs).toBe(80 * MIN);
    expect(page.real.shares).toBe(2);
    expect(page.real.tasks).toEqual(["读完第三章"]);
    expect(page.real.from).toBe("2026-11-16");
    expect(page.real.to).toBe("2026-11-17");
    expect(page.real.lines).toEqual(["现实里是 2026-11-16 到 2026-11-17。", "专注了 1 小时 20 分，得了 2 份。", "勾完了：读完第三章。"]);
  });

  it("世界一栏只从这一年真实记下的事里取：年名、初雪和最后一场雪、最长的暴风雪、修缮、收成、去过的地方、俭", () => {
    const g = newGame(5);
    const w = g.world;
    const yd = CONFIG.calendar.yearDays;
    // 换成写好的一年，只看汇总怎么读它
    w.summaries = Array.from({ length: yd }, (_, day) => ({ day, look: "晴", mood: "normal" as const, text: "" }));
    w.summaries[3].look = "大雪"; // 冬
    w.summaries[27].look = "小雪"; // 春天第 4 天
    w.summaries[39].look = "暴风雪"; // 夏天第 4 天
    w.summaries[44].look = "冻雨"; // 不是雪
    w.summaries[56].look = "小雪"; // 秋天第 9 天
    w.yearbook = [
      { ...emptyYearPage(0, "snowy"), longestBlizzard: 3, repairsDone: ["搭柴棚", "整理地窖"], harvests: 11, outings: 5, visits: { pineForest: 4 }, thriftDays: 3 },
    ];
    const page = yearbook(g, cal).pages[0];
    expect(page.title).toBe("第一年 · 多雪的一年");
    expect(page.world).toEqual([
      "初雪在秋天第 9 天，最后一场雪在夏天第 4 天。最长的一场暴风雪连着三天。",
      "修好了：搭柴棚、整理地窖。菜地收了十一茬。去了松林四次。",
      "有三天过得俭。",
    ]);
  });

  it("没发生的事不编：没有秋雪、没有暴风雪、没出门、没过俭都照实写或者不写", () => {
    const g = newGame(6);
    const w = g.world;
    w.summaries = Array.from({ length: CONFIG.calendar.yearDays }, (_, day) => ({ day, look: day === 10 ? "小雪" : "多云", mood: "normal" as const, text: "" }));
    w.yearbook = [emptyYearPage(0, "plain")];
    expect(yearbook(g, cal).pages[0].world).toEqual(["秋天没有下雪，最后一场雪在冬天第 11 天。这一年没有刮暴风雪。", "这一年没有过得俭的日子。"]);
    w.yearbook = [{ ...emptyYearPage(0, "warm"), outings: 2, visits: {} }];
    expect(yearbook(g, cal).pages[0].world[1]).toBe("出了两趟门。");
  });

  it("进了野外的区域，这一年的「去过哪里」记一次", () => {
    const g = newGame(7);
    const w = g.world;
    for (const ps of Object.values(w.projects)) ps.paused = true;
    let guard = 40 * 1440;
    while (guard-- > 0 && !(dayClock(w) >= 9 * 60 && !w.actor.asleep && w.weather.today !== "D" && cmdCheckOuting(g).ok)) stepMinute(w);
    expect(cmdDepart(g, T0, { rations: 2, bundles: 1 }).ok).toBe(true);
    expect(cmdOutdoor(g, T0, { type: "travel", to: "pineForest" }).ok).toBe(true);
    expect(w.yearStats.visits).toEqual({ pineForest: 1 });
    expect(w.yearStats.outings).toBe(1);
  });

  it("年的名字用 03 第 10.2 节的说法，序数用汉字", () => {
    expect(yearTitle(1, "warm")).toBe("第二年 · 少雪的一年");
    expect(yearTitle(11, "earlyFrost")).toBe("第十二年 · 霜下得早的一年");
    expect([cnNumber(2), cnNumber(10), cnNumber(11), cnNumber(20), cnNumber(42), cnNumber(120)]).toEqual(["两", "十", "十一", "二十", "四十二", "120"]);
  });
});

describe("统计页（02 第 2.7 节、04 第 8.1 节）", () => {
  it("本周是周一到周日，只拿日期算", () => {
    expect(weekKeys("2026-11-16")).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
    expect(weekKeys("2026-11-22")[0]).toBe("2026-11-16");
    expect(weekKeys("2027-01-01")[0]).toBe("2026-12-28");
  });

  it("今天、本周、按类别、按任务：时长、满 10 分钟的次数、份", () => {
    const s = session();
    cmdAddTask(s.g, "整理笔记", "study");
    s.focus(50 * MIN, 1);
    s.focus(5 * MIN); // 不满 10 分钟：算时长，不算次数；冷却正好到了，得一份
    s.idle(24 * HOUR);
    s.focus(30 * MIN);
    const st = focusStats(s.g.focus, s.wall, cal);
    expect(st.today).toEqual({ date: "2026-11-17", ms: 30 * MIN, rounds: 1, shares: 1 });
    expect(st.week.from).toBe("2026-11-16");
    expect(st.week.ms).toBe(85 * MIN);
    expect(st.week.rounds).toBe(2);
    expect(st.week.shares).toBe(3);
    expect(st.week.days.map((d) => d.ms / MIN)).toEqual([55, 30, 0, 0, 0, 0, 0]);
    expect(st.byCategory.find((c) => c.category === "study")!.ms).toBe(50 * MIN);
    expect(st.byCategory.find((c) => c.category === "code")!).toMatchObject({ ms: 35 * MIN, rounds: 1, shares: 2 });
    expect(st.byTask).toEqual([{ id: 1, name: "整理笔记", done: false, ms: 50 * MIN, rounds: 1 }]);
    expect(st.total).toEqual({ ms: 85 * MIN, rounds: 2, shares: 3, focusDays: 2 });
    expect(st.milestones).toEqual({ hours: [1], rounds: [], days: [] });
    expect(st.keepsakes).toEqual(["现实手记第一页夹着一张便签。"]);
  });

  it("累计时长的纪念只看累计小时；书架那一格放 12 本，更早的收进纪念册", () => {
    const s = session();
    const fs = s.g.focus;
    fs.stats.totalMs = 230 * HOUR;
    for (let i = 0; i < 15; i++) fs.spines.push({ category: "write", date: "2026-11-16", taskName: null });
    const st = focusStats(fs, s.wall, cal);
    expect(st.keepsakes).toEqual(["现实手记第一页夹着一张便签。", "你的那一格里有一枚书签。", "那一格里有一本纪念册，贴了一页。"]);
    expect(st.spines.shelf).toHaveLength(12);
    expect(st.spines.archived).toBe(3);
  });

  it("统计和年册都是只读的：算一遍不改存档", () => {
    const s = session();
    s.focus(40 * MIN);
    toNextYear(s);
    const before = serialize(s.g, s.wall);
    focusStats(s.g.focus, s.wall, cal);
    yearbook(s.g, cal);
    expect(serialize(s.g, s.wall)).toBe(before);
  });
});
