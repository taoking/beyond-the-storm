// 专注/休息结束时的系统通知：04 第 19.2 节 A7。什么时候发、发什么字、多窗口只发一次。
import { describe, expect, it } from "vitest";
import { createNotifier, noticeFor, notifyStatus, roundClock, type NotifyDeps, type Permission, type SystemNotice } from "../src/app/notify.ts";
import { fixedCalendar, type FocusPreset } from "../src/core/focus.ts";
import { advance, cmdEndFocus, cmdExtendFocus, cmdNextRound, cmdPauseFocus, cmdResumeFocus, cmdSetAutoNext, cmdStartFocus, newGame, type Game } from "../src/core/game.ts";

const cal = fixedCalendar(0);
const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 16, 9);

/** 一台机器：几个窗口共用的 localStorage 只有「上一条的标签」这一项和通知设置 */
function machine(enabled = true, permission: Permission = "granted") {
  const shown: SystemNotice[] = [];
  let last: string | null = null;
  const deps = (): NotifyDeps => ({
    enabled: () => enabled,
    permission: () => permission,
    show: (n) => shown.push(n),
    lastTag: () => last,
    setLastTag: (t) => {
      last = t;
    },
  });
  return { shown, window: () => createNotifier(deps()) };
}

/** 像 runtime 的心跳那样一秒一跳地推进，每跳把事件交给通知器 */
function run(g: Game, from: number, ms: number, notifier = machine().window(), leader = true, step = 1000): { wall: number; sent: { at: number; n: SystemNotice }[] } {
  const sent: { at: number; n: SystemNotice }[] = [];
  let wall = from;
  for (let left = ms; left > 0; left -= step) {
    const dt = Math.min(step, left);
    wall += dt;
    const before = roundClock(g);
    const n = notifier.afterAdvance(leader, before, advance(g, { wall, verifiedMs: dt }, cal));
    if (n) sent.push({ at: (wall - from) / MIN, n });
  }
  return { wall, sent };
}

function started(preset: FocusPreset = { kind: "countdown", focusMin: 25, breakMin: 5 }, autoNext = false): Game {
  const g = newGame(7);
  cmdSetAutoNext(g, autoNext);
  cmdStartFocus(g, T0, cal, { preset, category: "study", taskId: null });
  return g;
}

describe("什么时候发", () => {
  it("25/5：专注走完发一条，休息走完再发一条，中间不发", () => {
    const g = started();
    const { sent } = run(g, T0, 40 * MIN);
    expect(sent.map((s) => [s.at, s.n.title, s.n.body])).toEqual([
      [25, "25 分钟专注结束", "接下来休息 5 分钟"],
      [30, "5 分钟休息结束", ""],
    ]);
  });

  it("自动接下一轮：休息结束那条说下一轮开始了，下一轮走完照样发", () => {
    const g = started(undefined, true);
    const { sent } = run(g, T0, 56 * MIN, undefined, true, 5000);
    expect(sent.map((s) => [s.at, s.n.title, s.n.body])).toEqual([
      [25, "25 分钟专注结束", "接下来休息 5 分钟"],
      [30, "5 分钟休息结束", "下一轮 25 分钟已开始"],
      [55, "25 分钟专注结束", "接下来休息 5 分钟"],
    ]);
    expect(new Set(sent.map((s) => s.n.tag)).size).toBe(3);
  });

  it("加了 5 分钟：报的是这一轮实际计的 30 分钟", () => {
    const g = started();
    run(g, T0, 10 * MIN);
    cmdExtendFocus(g, 5);
    const { sent } = run(g, T0 + 10 * MIN, 21 * MIN);
    expect(sent.map((s) => [s.at, s.n.title])).toEqual([[20, "30 分钟专注结束"]]);
  });

  it("暂停的那段不算：暂停 10 分钟，专注结束晚 10 分钟", () => {
    const g = started();
    let { wall } = run(g, T0, 5 * MIN);
    cmdPauseFocus(g);
    wall = run(g, wall, 10 * MIN).wall;
    expect(run(g, wall, 10 * MIN).sent).toEqual([]);
    // 已暂停时没有事件；继续以后再走 20 分钟到点
    cmdResumeFocus(g);
    const after = run(g, wall + 10 * MIN, 20 * MIN).sent;
    expect(after.map((s) => s.n.title)).toEqual(["25 分钟专注结束"]);
  });

  it("你自己点结束、跳过休息不发：那是你按的，不用告诉你", () => {
    const g = started();
    const n = machine().window();
    let { wall } = run(g, T0, 10 * MIN, n);
    cmdEndFocus(g, wall, cal);
    expect(run(g, wall, 30 * MIN, n).sent).toEqual([]);
    cmdStartFocus(g, wall, cal, {});
    wall = run(g, wall, 25 * MIN, n).wall;
    cmdNextRound(g, wall, cal); // 跳过休息
    expect(run(g, wall, 3 * MIN, n).sent).toEqual([]);
  });

  it("正向计时没有终点，不发", () => {
    const g = started({ kind: "countup" });
    expect(run(g, T0, 90 * MIN, undefined, true, 10_000).sent).toEqual([]);
  });

  it("没开、没授权、不支持：一条也不发", () => {
    for (const [on, perm] of [
      [false, "granted"],
      [true, "denied"],
      [true, "default"],
      [true, "unsupported"],
    ] as [boolean, Permission][]) {
      const m = machine(on, perm);
      run(started(), T0, 31 * MIN, m.window());
      expect(m.shown, `${on} ${perm}`).toEqual([]);
    }
  });

  it("一次推进里结束了好几段也只发一条，报推进前正在走的那段", () => {
    const g = started({ kind: "countdown", focusMin: 1, breakMin: 1 }, true);
    const { sent } = run(g, T0, 3 * MIN, undefined, true, 3 * MIN);
    expect(sent.map((s) => s.n.title)).toEqual(["1 分钟专注结束"]);
  });
});

describe("发什么字：只有现实计时", () => {
  it("得了份、解锁了样式，通知里也一个字不提", () => {
    const g = started({ kind: "countdown", focusMin: 50, breakMin: 10 });
    g.focus.shares.total = 9; // 离下一件样式只差一份
    const { sent } = run(g, T0, 61 * MIN, undefined, true, 5000);
    expect(g.focus.shares.total).toBeGreaterThan(9);
    expect(g.focus.lastSummary!.unlocked.length).toBeGreaterThan(0);
    expect(sent.length).toBe(2);
    for (const { n } of sent) expect(`${n.title}${n.body}`).not.toMatch(/份|样式|罐|柴|粮|他|屋/);
  });

  it("noticeFor 不看推进前的计时就不发", () => {
    expect(noticeFor(null, [{ type: "breakEnded", wall: 0, autoStarted: false }])).toBeNull();
  });

  it("设置旁边那一句", () => {
    expect(notifyStatus(false, "denied")).toBe("");
    expect(notifyStatus(true, "granted")).toContain("系统通知");
    for (const p of ["denied", "default", "unsupported"] as Permission[]) expect(notifyStatus(true, p)).toContain("只在计时区显示");
  });
});

describe("多窗口只发一次", () => {
  it("副窗口不发：只有拿着锁的主窗口在推进", () => {
    const m = machine();
    const g = started();
    const a = m.window();
    const b = m.window();
    let wall = T0;
    for (let i = 0; i < 26 * 60; i++) {
      wall += 1000;
      const before = roundClock(g);
      const events = advance(g, { wall, verifiedMs: 1000 }, cal);
      a.afterAdvance(true, before, events);
      b.afterAdvance(false, before, events);
    }
    expect(m.shown.map((n) => n.title)).toEqual(["25 分钟专注结束"]);
  });

  it("主窗口发完就关了，接手的窗口从旧一点的状态再走到同一个终点，不重发", () => {
    const m = machine();
    const g = started();
    run(g, T0, 24 * MIN, m.window());
    // 副窗口最后收到的是 24 分钟时的状态
    const copy = JSON.parse(JSON.stringify(g)) as Game;
    run(g, T0 + 24 * MIN, 2 * MIN, m.window());
    expect(m.shown.length).toBe(1);
    run(copy, T0 + 24 * MIN, 2 * MIN, m.window());
    expect(m.shown.length).toBe(1);
  });
});
