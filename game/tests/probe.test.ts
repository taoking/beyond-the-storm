// 06 第 12 节真机验证日志的判断：用造出来的日志检查「通过 / 可疑 / 没测到」判得对不对。
// 记录端要真浏览器，这里只测 src/app/probe/analyze.ts 这个纯函数。
import { describe, expect, it } from "vitest";
import { analyze, browserOf, type Item } from "../src/app/probe/analyze.ts";
import type { Entry } from "../src/app/probe/entries.ts";

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15";
const T0 = Date.UTC(2026, 10, 16, 1, 0, 0);
const MIN = 60_000;

/** 造一个页面会话的日志。add 的字段按种类补齐 */
function session(sid: string, ua: string, start = T0) {
  const list: Entry[] = [];
  let seq = 0;
  let t = start;
  const add = (fields: Record<string, unknown>, at = t): void => {
    list.push({ t: at, m: at - start, sid, seq: seq++, ...fields } as Entry);
  };
  add({ k: "open", ua, href: "http://localhost:5173/", discarded: false, nav: "navigate", support: { locks: true, bc: true, idb: true, ls: true, memory: ua === CHROME }, tzOffset: -480, heartbeat: { trustGapMs: 120_000, sleepSkewMs: 30_000 }, hidden: false });
  add({ k: "store", kind: "idb" });
  add({ k: "lock", phase: "requested" });
  add({ k: "leader", from: "save", viaLock: true, waitedMs: 3, lastHeardAgoMs: null, wm: 360, focus: "none" });
  const sum = (over: Record<string, unknown> = {}): void => {
    t += MIN;
    add({
      k: "sum", beats: 60, wallMs: MIN, monoMs: MIN, verifiedMs: MIN, maxBeatMs: 1004, skewMs: 1, interrupts: 0, interruptMs: 0,
      dWorld: 4, cmpWorld: 4, cmpWorldExpect: 4, dFocus: MIN, cmpFocus: MIN, cmpFocusExpect: MIN, focusOver: 0, hiddenMs: 0,
      mode: "companion", wm: 400, asleep: false, focus: "focus", saves: 6, saveFails: 0, saveChars: 120_000, maxSaveMs: 2,
      heap: ua === CHROME ? 40e6 : null, nodes: 300, locks: { held: 1, pending: 0 }, tzOffset: -480, ...over,
    });
  };
  return { list, add, sum, at: () => t, skip: (ms: number) => (t += ms) };
}

const byId = (items: Item[], id: Item["id"]): Item => items.find((i) => i.id === id)!;

describe("真机验证日志的判断（06 第 12 节）", () => {
  it("没有日志：每一项都是没测到", () => {
    const r = analyze([]);
    expect(r.items.every((i) => i.verdict === "untested")).toBe(true);
  });

  it("认得出 Chrome 和 Safari", () => {
    expect(browserOf(CHROME)).toBe("Chrome");
    expect(browserOf(SAFARI)).toBe("Safari");
  });

  it("一切正常的一段：连开 2.5 小时、后台 8 分钟、合盖一次，都通过", () => {
    const s = session("a", CHROME);
    for (let i = 0; i < 60; i++) s.sum();
    // 后台 8 分钟，定时器一分钟一跳
    s.add({ k: "vis", state: "hidden", leader: true, wm: 400, fms: 0 });
    for (let i = 0; i < 8; i++) s.sum({ beats: 1, maxBeatMs: 60_000, hiddenMs: MIN });
    s.add({ k: "hidden", wallMs: 8 * MIN, monoMs: 8 * MIN, leader: true, beats: 8, maxBeatMs: 60_000, verifiedMs: 8 * MIN, sleeps: 0, unverified: 0, interruptMs: 0, dFocus: 8 * MIN, cmpFocus: 8 * MIN, cmpFocusExpect: 8 * MIN, cmpWorld: 32, cmpWorldExpect: 32, froze: false, ended: "visible" });
    s.add({ k: "vis", state: "visible", leader: true, wm: 432, fms: 0 });
    // 合盖 40 分钟：单调钟不走
    s.skip(40 * MIN);
    s.add({ k: "beat", dw: 40 * MIN, dm: 1000, kind: "sleep", verifiedMs: 0, gapMs: 40 * MIN, dWorld: 0, dFocus: 0, focusBefore: "focus", focusAfter: "focus:sleep", pendingGapMs: 0, hidden: false });
    for (let i = 0; i < 90; i++) s.sum({ focus: "focus:sleep", dFocus: 0, cmpFocus: 0, cmpFocusExpect: 0 });
    const r = analyze(s.list);
    for (const id of ["log", "sleep", "background", "longrun"] as const) expect(byId(r.items, id).verdict, byId(r.items, id).lines.join("\n")).toBe("pass");
    expect(byId(r.items, "safari").verdict).toBe("untested");
  });

  it("页面被杀后补写的重复条目只算一次", () => {
    const s = session("a", CHROME);
    s.sum();
    s.add({ k: "saveFail", err: "x" });
    const twice = [...s.list, ...s.list.slice(-2)];
    const r = analyze(twice);
    expect(r.entries).toBe(s.list.length);
    expect(byId(r.items, "log").lines.some((l) => l.includes("失败 1 次"))).toBe(true);
  });

  it("断档时世界或专注还在走、专注没停：可疑", () => {
    const s = session("a", CHROME);
    s.sum();
    s.add({ k: "beat", dw: 10 * MIN, dm: 10 * MIN, kind: "unverified", verifiedMs: 0, gapMs: 10 * MIN, dWorld: 3, dFocus: 0, focusBefore: "focus", focusAfter: "focus", pendingGapMs: 0, hidden: true });
    const r = analyze(s.list);
    expect(byId(r.items, "log").verdict).toBe("suspect");
    expect(byId(r.items, "sleep").verdict).toBe("suspect");
  });

  it("后台被压到两分钟以上一跳、没断档却少算了时间：可疑", () => {
    const s = session("a", CHROME);
    s.sum();
    s.add({ k: "hidden", wallMs: 10 * MIN, monoMs: 10 * MIN, leader: true, beats: 3, maxBeatMs: 180_000, verifiedMs: 4 * MIN, sleeps: 0, unverified: 2, interruptMs: 6 * MIN, dFocus: 0, cmpFocus: 0, cmpFocusExpect: 0, cmpWorld: 0, cmpWorldExpect: 0, froze: true, ended: "visible" });
    expect(byId(analyze(s.list).items, "background").verdict).toBe("suspect");
    const s2 = session("b", CHROME);
    s2.add({ k: "hidden", wallMs: 10 * MIN, monoMs: 10 * MIN, leader: true, beats: 10, maxBeatMs: 60_000, verifiedMs: 7 * MIN, sleeps: 0, unverified: 0, interruptMs: 0, dFocus: 0, cmpFocus: 0, cmpFocusExpect: 0, cmpWorld: 0, cmpWorldExpect: 0, froze: false, ended: "visible" });
    expect(byId(analyze(s2.list).items, "background").verdict).toBe("suspect");
  });

  it("长跑：钟在漂、堆内存一直涨、存档写失败：可疑", () => {
    const s = session("a", CHROME);
    for (let i = 0; i < 150; i++) s.sum({ skewMs: 200, heap: 40e6 + i * 1e6 });
    s.add({ k: "saveFail", err: "QuotaExceededError" });
    const r = analyze(s.list);
    const long = byId(r.items, "longrun");
    expect(long.verdict).toBe("suspect");
    expect(long.lines.filter((l) => l.startsWith("✗")).length).toBe(2);
    expect(byId(r.items, "log").verdict).toBe("suspect");
  });

  it("专注记多了、一天超过 9 份、两份隔不到 45 分钟：可疑", () => {
    const s = session("a", CHROME);
    s.sum({ cmpFocus: MIN + 5_000, focusOver: 1 });
    s.add({ k: "share", total: 1, today: 1, date: "2026-11-16", sinceLastMs: null, via: "beat" });
    s.add({ k: "share", total: 2, today: 10, date: "2026-11-16", sinceLastMs: 20 * MIN, via: "beat" });
    const log = byId(analyze(s.list).items, "log");
    expect(log.verdict).toBe("suspect");
    expect(log.lines.filter((l) => l.startsWith("✗")).length).toBe(4);
  });

  it("两个窗口：一个接手是通过，同时两个主窗口是可疑", () => {
    const a = session("a", SAFARI);
    for (let i = 0; i < 5; i++) a.sum();
    const b = session("b", SAFARI, T0 + 30_000);
    b.list.splice(3, 1); // 先当副窗口
    b.add({ k: "fsum", heard: 60, maxSilenceMs: 1100, lastHeardAgoMs: 0, locks: { held: 1, pending: 1 } }, T0 + 2 * MIN);
    b.add({ k: "leader", from: "handover", viaLock: true, waitedMs: 270_000, lastHeardAgoMs: 1200, wm: 420, focus: "none" }, T0 + 5 * MIN + 1000);
    const ok = analyze([...a.list, ...b.list]);
    expect(byId(ok.items, "windows").verdict, byId(ok.items, "windows").lines.join("\n")).toBe("pass");
    expect(byId(ok.items, "safari").verdict).toBe("pass");
    // 第二个窗口在前一个还在推进时也出小结
    b.add({ k: "sum", beats: 60, wallMs: MIN, monoMs: MIN, verifiedMs: MIN, maxBeatMs: 1000, skewMs: 0, interrupts: 0, interruptMs: 0, dWorld: 4, cmpWorld: 4, cmpWorldExpect: 4, dFocus: 0, cmpFocus: 0, cmpFocusExpect: 0, focusOver: 0, hiddenMs: 0, mode: "companion", wm: 400, asleep: false, focus: "none", saves: 6, saveFails: 0, saveChars: 1, maxSaveMs: 1, heap: null, nodes: 1, locks: null, tzOffset: -480 }, T0 + 3 * MIN);
    expect(byId(analyze([...a.list, ...b.list]).items, "windows").verdict).toBe("suspect");
  });
});
