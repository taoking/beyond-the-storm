// 专注时钟和份的结算：设计/02_玩法.md 第 2.3、2.4、3.4 节的表逐行对照。
import { describe, expect, it } from "vitest";
import {
  addTask,
  advanceFocus,
  completeTask,
  createFocus,
  endFocus,
  extendFocus,
  fixedCalendar,
  focusBarState,
  interruptFocus,
  pauseFocus,
  resolveGap,
  resumeFocus,
  startFocus,
  startNextRound,
  type FocusEvent,
  type FocusPreset,
  type FocusState,
} from "../src/core/focus.ts";

const cal = fixedCalendar(0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** 一个固定的现实日的 00:00（UTC） */
const D0 = Date.UTC(2026, 10, 16);
const at = (h: number, m = 0): number => D0 + h * HOUR + m * MIN;

/** 从 from 走到 to，每次心跳 stepMs；返回这段里得份的时刻（距 origin 的分钟） */
function run(fs: FocusState, from: number, to: number, origin = from, stepMs = 1000): number[] {
  const shares: number[] = [];
  let now = from;
  while (now < to) {
    const dt = Math.min(stepMs, to - now);
    now += dt;
    for (const e of advanceFocus(fs, now, dt, cal)) if (e.type === "share") shares.push((e.wall - origin) / MIN);
  }
  return shares;
}

const countup: FocusPreset = { kind: "countup" };
const pomodoro = (focusMin: number, breakMin: number): FocusPreset => ({ kind: "countdown", focusMin, breakMin });

describe("份的结算（02 第 2.4 节的表）", () => {
  it("一口气专注：第 10、55、100、145 分钟……第 9 份在 6 小时 10 分，之后当天不再给", () => {
    const fs = createFocus();
    const t0 = at(8);
    startFocus(fs, t0, cal, { preset: countup });
    const shares = run(fs, t0, t0 + 8 * HOUR);
    expect(shares).toEqual([10, 55, 100, 145, 190, 235, 280, 325, 370]);
    expect(fs.shares.byDate[cal.dateKey(t0)]).toBe(9);
    expect(fs.shares.total).toBe(9);
  });

  it("25/5 连做：第 10、60、105、150、195 分钟；两小时四轮共 3 份", () => {
    const fs = createFocus();
    fs.settings.autoNext = true;
    const t0 = at(9);
    startFocus(fs, t0, cal, { preset: pomodoro(25, 5) });
    const shares = run(fs, t0, t0 + 200 * MIN);
    expect(shares).toEqual([10, 60, 105, 150, 195]);
    expect(shares.filter((m) => m <= 120)).toHaveLength(3);
  });

  it("50/10 连做：第 10、60、105、150 分钟", () => {
    const fs = createFocus();
    fs.settings.autoNext = true;
    const t0 = at(9);
    startFocus(fs, t0, cal, { preset: pomodoro(50, 10) });
    expect(run(fs, t0, t0 + 160 * MIN)).toEqual([10, 60, 105, 150]);
  });

  it("第一轮 15 分钟，休息 1 小时，再开第二轮：第二轮约第 5 分钟得第 2 份", () => {
    const fs = createFocus();
    const t0 = at(9);
    startFocus(fs, t0, cal, { preset: countup });
    expect(run(fs, t0, t0 + 15 * MIN)).toEqual([10]);
    endFocus(fs, t0 + 15 * MIN, cal);
    const t1 = t0 + 75 * MIN;
    startFocus(fs, t1, cal, { preset: countup });
    expect(run(fs, t1, t1 + 20 * MIN, t1)).toEqual([5]);
  });

  it("每隔 45 分钟以上开始一段 10 分钟专注：每次 1 份，每天至多 9 份", () => {
    const fs = createFocus();
    let got = 0;
    for (let i = 0; i < 12; i++) {
      const t = at(6) + i * 60 * MIN;
      startFocus(fs, t, cal, { preset: countup });
      got += run(fs, t, t + 10 * MIN).length;
      endFocus(fs, t + 10 * MIN, cal);
    }
    expect(got).toBe(9);
  });

  it("不显示也不需要重新开始：冷却到点时正在有效专注就当场得下一份", () => {
    const fs = createFocus();
    const t0 = at(9);
    startFocus(fs, t0, cal, { preset: countup });
    // 一次心跳直接跨过一整段（后台节流到很长一跳也一样准）
    const events = advanceFocus(fs, t0 + 60 * MIN, 60 * MIN, cal);
    const walls = events.filter((e) => e.type === "share").map((e) => (e.wall - t0) / MIN);
    expect(walls).toEqual([10, 55]);
  });
});

describe("现实午夜（02 第 2.4 节的三个边界）", () => {
  it("第 9 份在 22:50 得到，一直专注过午夜：00:00 当场得第二天第 1 份，下一份最早 00:45", () => {
    const fs = createFocus();
    const t0 = at(16, 40);
    startFocus(fs, t0, cal, { preset: countup });
    const shares = run(fs, t0, at(25, 20), D0);
    expect(shares.slice(0, 9).at(-1)).toBe(22 * 60 + 50);
    expect(shares.slice(9)).toEqual([24 * 60, 24 * 60 + 45]);
    expect(fs.shares.byDate[cal.dateKey(D0)]).toBe(9);
    expect(fs.shares.byDate[cal.dateKey(D0 + DAY)]).toBe(2);
  });

  it("第 9 份在 23:40 得到，一直专注过午夜：00:00 只清份数，00:25 得第二天第 1 份", () => {
    const fs = createFocus();
    const t0 = at(17, 30);
    startFocus(fs, t0, cal, { preset: countup });
    const shares = run(fs, t0, at(25), D0);
    expect(shares.slice(0, 9).at(-1)).toBe(23 * 60 + 40);
    expect(shares.slice(9)).toEqual([24 * 60 + 25]);
  });

  it("午夜只重置当天份数：冷却、攒的有效分钟、正在跑的专注都不动", () => {
    const fs = createFocus();
    const t0 = at(23, 52);
    startFocus(fs, t0, cal, { preset: countup });
    // 23:52 开始，午夜时才攒了 8 分钟：不因为换日就给，也不清零重攒
    const shares = run(fs, t0, at(24, 30), D0);
    expect(shares).toEqual([24 * 60 + 2]);
    expect(fs.session?.paused).toBeNull();
    expect(fs.records).toHaveLength(1);
  });

  it("一次跨午夜的专注：一条记录，记在开始的那天；时长按分钟各归各的日期；份按发放的时刻归日期", () => {
    const fs = createFocus();
    const t0 = at(23, 30);
    startFocus(fs, t0, cal, { preset: countup });
    run(fs, t0, at(24, 30));
    endFocus(fs, at(24, 30), cal);
    expect(fs.records).toHaveLength(1);
    expect(fs.records[0].date).toBe(cal.dateKey(D0));
    expect(fs.stats.msByDate[cal.dateKey(D0)]).toBe(30 * MIN);
    expect(fs.stats.msByDate[cal.dateKey(D0 + DAY)]).toBe(30 * MIN);
    // 23:40 一份记在头一天，00:25 一份记在第二天
    expect(fs.shares.byDate[cal.dateKey(D0)]).toBe(1);
    expect(fs.shares.byDate[cal.dateKey(D0 + DAY)]).toBe(1);
  });

  it("每日份数是「日期 → 份数」的表：时钟拨回已经拿满的那天，不会再给 9 份", () => {
    const fs = createFocus();
    const t0 = at(8);
    startFocus(fs, t0, cal, { preset: countup });
    expect(run(fs, t0, t0 + 7 * HOUR)).toHaveLength(9);
    endFocus(fs, t0 + 7 * HOUR, cal);
    // 第二天得了 1 份以后，时钟被拨回头一天
    const t1 = at(32);
    startFocus(fs, t1, cal, { preset: countup });
    expect(run(fs, t1, t1 + 20 * MIN)).toHaveLength(1);
    endFocus(fs, t1 + 20 * MIN, cal);
    const back = at(10);
    startFocus(fs, back, cal, { preset: countup });
    expect(run(fs, back, back + 3 * HOUR)).toHaveLength(0);
    expect(fs.shares.byDate[cal.dateKey(D0)]).toBe(9);
  });

  it("时钟被往回拨：冷却从这一刻重新计 45 分钟", () => {
    const fs = createFocus();
    const t0 = at(32);
    startFocus(fs, t0, cal, { preset: countup });
    expect(run(fs, t0, t0 + 12 * MIN)).toHaveLength(1);
    // 拨回 5 小时前（同一天，份数没满）
    const back = t0 - 5 * HOUR;
    const shares = run(fs, back, back + 50 * MIN, back);
    // 回拨是在回来后的第一次心跳（1 秒后）发现的
    expect(shares).toHaveLength(1);
    expect(shares[0]).toBeCloseTo(45, 1);
  });
});

describe("有效专注时间（02 第 2.3 节）", () => {
  it("暂停和休息的时间不算", () => {
    const fs = createFocus();
    const t0 = at(9);
    startFocus(fs, t0, cal, { preset: pomodoro(25, 5) });
    run(fs, t0, t0 + 5 * MIN);
    pauseFocus(fs);
    expect(focusBarState(fs)).toBe("pausedByUser");
    run(fs, t0 + 5 * MIN, t0 + 65 * MIN);
    expect(fs.stats.totalMs).toBe(5 * MIN);
    resumeFocus(fs);
    run(fs, t0 + 65 * MIN, t0 + 95 * MIN);
    // 接着走完剩下的 20 分钟，然后是 5 分钟休息，再往后在等下一轮
    expect(fs.stats.totalMs).toBe(25 * MIN);
    expect(focusBarState(fs)).toBe("awaitNext");
  });

  it("提前结束保留已有的分钟；不满 10 分钟不记成一次", () => {
    const fs = createFocus();
    const t0 = at(9);
    startFocus(fs, t0, cal, { preset: pomodoro(25, 5) });
    run(fs, t0, t0 + 7 * MIN);
    const events = endFocus(fs, t0 + 7 * MIN, cal);
    expect(fs.stats.totalMs).toBe(7 * MIN);
    expect(fs.stats.rounds).toBe(0);
    expect(fs.records[0].effectiveMs).toBe(7 * MIN);
    expect((events[0] as Extract<FocusEvent, { type: "focusEnded" }>).summary.minutes).toBe(7);
    expect(fs.session).toBeNull();
  });

  it("计时结束不等于任务完成；勾完任务多一本书脊", () => {
    const fs = createFocus();
    const task = addTask(fs, "读第三章", "study");
    const t0 = at(9);
    startFocus(fs, t0, cal, { preset: pomodoro(25, 0), taskId: task.id });
    run(fs, t0, t0 + 30 * MIN);
    expect(task.done).toBe(false);
    expect(task.totalMs).toBe(25 * MIN);
    expect(fs.spines).toHaveLength(0);
    completeTask(fs, task.id, t0 + 30 * MIN, cal);
    expect(fs.spines).toEqual([{ category: "study", date: cal.dateKey(t0), taskName: "读第三章" }]);
  });

  it("没挂任务的专注，按类别每攒满 10 小时多一本书脊", () => {
    const fs = createFocus();
    let t = at(0);
    for (let i = 0; i < 5; i++) {
      startFocus(fs, t, cal, { preset: countup, category: "code" });
      run(fs, t, t + 125 * MIN, t, 60_000);
      endFocus(fs, t + 125 * MIN, cal);
      t += DAY;
    }
    expect(fs.stats.msByCategory.code).toBe(625 * MIN);
    expect(fs.spines.filter((s) => s.category === "code")).toHaveLength(1);
  });

  it("延长只加在这一轮上", () => {
    const fs = createFocus();
    const t0 = at(9);
    startFocus(fs, t0, cal, { preset: pomodoro(25, 5) });
    run(fs, t0, t0 + 20 * MIN);
    expect(extendFocus(fs, 5)).toBe(true);
    run(fs, t0 + 20 * MIN, t0 + 29 * MIN);
    expect(focusBarState(fs)).toBe("focusing");
    run(fs, t0 + 29 * MIN, t0 + 31 * MIN);
    expect(focusBarState(fs)).toBe("break");
    expect(fs.stats.totalMs).toBe(30 * MIN);
  });

  it("没开自动接续：休息完停在「准备好了就开始」，点了才开始下一轮", () => {
    const fs = createFocus();
    const t0 = at(9);
    startFocus(fs, t0, cal, { preset: pomodoro(25, 5) });
    run(fs, t0, t0 + 60 * MIN);
    expect(focusBarState(fs)).toBe("awaitNext");
    expect(fs.stats.totalMs).toBe(25 * MIN);
    expect(startNextRound(fs, t0 + 60 * MIN, cal)).toBe(true);
    run(fs, t0 + 60 * MIN, t0 + 70 * MIN);
    expect(fs.stats.totalMs).toBe(35 * MIN);
    expect(fs.records).toHaveLength(2);
  });
});

describe("一轮结束的小结（04 第 19.2 节）", () => {
  it("只写这一轮真实发生的：25 分钟不一定得 1 份", () => {
    const fs = createFocus();
    fs.settings.autoNext = true;
    const t0 = at(9);
    startFocus(fs, t0, cal, { preset: pomodoro(25, 5) });
    const summaries: { minutes: number; shares: number; unlocked: string[] }[] = [];
    let now = t0;
    while (now < t0 + 120 * MIN) {
      now += 1000;
      for (const e of advanceFocus(fs, now, 1000, cal)) if (e.type === "focusEnded") summaries.push(e.summary);
    }
    // 四轮：第 10 分钟、第 60 分钟、第 105 分钟各一份 → 1、0、1、1
    expect(summaries.map((s) => s.shares)).toEqual([1, 0, 1, 1]);
    expect(summaries.map((s) => s.minutes)).toEqual([25, 25, 25, 25]);
    // 累计第 1 份解锁第一件样式，第 3 份解锁第二件
    expect(summaries[0].unlocked).toEqual(["lampAmber"]);
    expect(summaries[3].unlocked).toEqual(["soundKettle"]);
  });
});

describe("休眠、退出和确认不了的断档（02 第 3.4 节）", () => {
  it("明确的休眠：停在「已暂停」，已确认的分钟留着，不给「算进去」的选择", () => {
    const fs = createFocus();
    const t0 = at(9);
    startFocus(fs, t0, cal, { preset: pomodoro(25, 5) });
    run(fs, t0, t0 + 18 * MIN);
    interruptFocus(fs, "sleep");
    expect(focusBarState(fs)).toBe("pausedAfterSleep");
    expect(fs.session?.pendingGapMs).toBe(0);
    // 睡了三小时回来：什么都没多
    run(fs, t0 + 198 * MIN, t0 + 200 * MIN);
    expect(fs.stats.totalMs).toBe(18 * MIN);
    expect(resolveGap(fs, t0 + 200 * MIN, cal, true)).toEqual([]);
    resumeFocus(fs);
    run(fs, t0 + 200 * MIN, t0 + 207 * MIN);
    expect(fs.stats.totalMs).toBe(25 * MIN);
  });

  it("确认不了的断档：选「算进去」按规则结算，这一段最多补发 1 份，手记标明是手动确认的", () => {
    const fs = createFocus();
    const t0 = at(9);
    startFocus(fs, t0, cal, { preset: countup });
    expect(run(fs, t0, t0 + 12 * MIN)).toEqual([10]);
    // 之后断了 3 小时，确认不了
    interruptFocus(fs, "gap", 180 * MIN);
    expect(focusBarState(fs)).toBe("pausedAfterGap");
    const back = t0 + 192 * MIN;
    const events = resolveGap(fs, back, cal, true);
    expect(events.filter((e) => e.type === "share")).toHaveLength(1);
    expect(fs.shares.total).toBe(2);
    expect(fs.stats.totalMs).toBe(192 * MIN);
    expect(fs.records[0].manualMs).toBe(180 * MIN);
    expect(fs.journal.some((j) => j.type === "manual")).toBe(true);
    expect(fs.journal.at(-1)?.text).toContain("手动确认");
    // 仍然停着，由你点继续或结束
    expect(fs.session?.paused).toBe("user");
  });

  it("选「不算」，或者没选就点了继续：这一段不计", () => {
    for (const how of ["no", "resume"] as const) {
      const fs = createFocus();
      const t0 = at(9);
      startFocus(fs, t0, cal, { preset: countup });
      run(fs, t0, t0 + 12 * MIN);
      interruptFocus(fs, "gap", 60 * MIN);
      if (how === "no") resolveGap(fs, t0 + 72 * MIN, cal, false);
      else resumeFocus(fs);
      expect(fs.stats.totalMs).toBe(12 * MIN);
      expect(fs.shares.total).toBe(1);
      expect(fs.session?.pendingGapMs).toBe(0);
    }
  });

  it("倒计时里算进去的断档不超过这一轮剩下的时间", () => {
    const fs = createFocus();
    const t0 = at(9);
    startFocus(fs, t0, cal, { preset: pomodoro(25, 5) });
    run(fs, t0, t0 + 18 * MIN);
    interruptFocus(fs, "gap", 23 * MIN);
    resolveGap(fs, t0 + 41 * MIN, cal, true);
    expect(fs.stats.totalMs).toBe(25 * MIN);
  });

  it("明确的休眠不能用断档的选择补算", () => {
    const fs = createFocus();
    const t0 = at(9);
    startFocus(fs, t0, cal, { preset: countup });
    run(fs, t0, t0 + 12 * MIN);
    interruptFocus(fs, "gap", 60 * MIN);
    interruptFocus(fs, "exit");
    expect(focusBarState(fs)).toBe("pausedAfterSleep");
    resolveGap(fs, t0 + 72 * MIN, cal, true);
    expect(fs.stats.totalMs).toBe(12 * MIN);
  });
});
