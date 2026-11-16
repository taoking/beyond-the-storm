// 读真机验证日志，按 06 第 12 节逐项给「通过 / 可疑 / 没测到」。纯函数，不碰 DOM：
// 导出页（log.html）和 tools/probe-check.ts 共用，两边看到的判断一样。
import type { Entry, EntryOf, ProbeExport } from "./entries.ts";

export type Verdict = "pass" | "suspect" | "untested";
export const VERDICT_TEXT: Record<Verdict, string> = { pass: "通过", suspect: "可疑", untested: "没测到" };

export interface Item {
  id: "log" | "sleep" | "background" | "longrun" | "safari" | "windows";
  title: string;
  verdict: Verdict;
  /** 判断的依据，一行一件事；可疑的那几行以「✗」开头 */
  lines: string[];
}

export interface Report {
  entries: number;
  sessions: number;
  fromWall: number | null;
  toWall: number | null;
  items: Item[];
}

/** 判断用的阈值。都是「看着不对劲」的线，不是游戏规则 */
export const LIMITS = {
  /** 后台多久算「超过 5 分钟」 */
  backgroundMs: 5 * 60_000,
  /** 后台那段确认运行的时间不能比墙上钟少太多（没有断档时） */
  backgroundKeep: 0.98,
  /** 连开多久才算测过 */
  longrunMs: 2 * 3_600_000,
  /** 运行时两个钟每小时最多差几秒 */
  driftMsPerHour: 2_000,
  /** 没有断档时，确认运行的时间占墙上钟的比例 */
  keepRatio: 0.99,
  /** 存档最多多少字符（localStorage 一般 5M 字符） */
  saveChars: 1_500_000,
  /** 后段堆内存比前段多出这么多倍且超过 heapGrowBytes，算可疑 */
  heapGrow: 1.5,
  heapGrowBytes: 30 * 1024 * 1024,
  /** 世界推进和按倍率算的差：分钟 */
  worldSlackMin: 2,
  worldSlackRatio: 0.005,
  /** 专注记的和确认运行的差：毫秒 */
  focusSlackMs: 1_000,
  /** 两份之间至少隔多久、每天最多几份（02 第 2.4 节，和 config.ts 的 shares 一致） */
  shareCooldownMs: 45 * 60_000,
  sharesPerDay: 9,
};

const sec = (ms: number): string => (Math.abs(ms) < 120_000 ? `${(ms / 1000).toFixed(1)} 秒` : Math.abs(ms) < 7_200_000 ? `${(ms / 60_000).toFixed(1)} 分钟` : `${(ms / 3_600_000).toFixed(2)} 小时`);
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const mb = (b: number): string => `${(b / 1024 / 1024).toFixed(1)} MB`;
const clock = (wall: number): string => {
  const d = new Date(wall);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export function browserOf(ua: string): "Safari" | "Chrome" | "Firefox" | "其他" {
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/(Chrome|Chromium|CriOS|Edg)\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return "Safari";
  return "其他";
}

interface Session {
  sid: string;
  browser: string;
  open: EntryOf<"open"> | null;
  entries: Entry[];
  first: number;
  last: number;
  leaderAt: number | null;
  leader: EntryOf<"leader"> | null;
}

function of<K extends Entry["k"]>(list: Entry[], k: K): EntryOf<K>[] {
  return list.filter((e): e is EntryOf<K> => e.k === k);
}

function sessionsOf(entries: Entry[]): Session[] {
  const map = new Map<string, Session>();
  for (const e of entries) {
    let s = map.get(e.sid);
    if (!s) {
      s = { sid: e.sid, browser: "其他", open: null, entries: [], first: e.t, last: e.t, leaderAt: null, leader: null };
      map.set(e.sid, s);
    }
    s.entries.push(e);
    s.first = Math.min(s.first, e.t);
    s.last = Math.max(s.last, e.t);
    if (e.k === "open") {
      s.open = e;
      s.browser = browserOf(e.ua);
    }
    if (e.k === "leader" && s.leaderAt === null) {
      s.leaderAt = e.t;
      s.leader = e;
    }
  }
  for (const s of map.values()) s.entries.sort((a, b) => a.seq - b.seq);
  return [...map.values()].sort((a, b) => a.first - b.first);
}

function item(id: Item["id"], title: string, lines: string[], tested: boolean): Item {
  const verdict: Verdict = lines.some((l) => l.startsWith("✗")) ? "suspect" : tested ? "pass" : "untested";
  return { id, title, verdict, lines };
}

function worldOk(actual: number, expect: number): boolean {
  return Math.abs(actual - expect) <= LIMITS.worldSlackMin + expect * LIMITS.worldSlackRatio;
}

// ---------- 日志本身和全程都该成立的 ----------

function checkLog(all: Entry[], sessions: Session[]): Item {
  const lines: string[] = [];
  const browsers = [...new Set(sessions.map((s) => s.browser))];
  lines.push(`${all.length} 条，${sessions.length} 个页面会话（${browsers.join("、") || "—"}）`);
  for (const s of of(all, "store")) if (s.kind === "memory") lines.push(`✗ ${clock(s.t)} IndexedDB 打不开，这个页面的日志只在内存里：${s.err ?? ""}`);
  const errors = of(all, "error");
  if (errors.length) lines.push(`✗ 页面报错 ${errors.length} 次，第一次：${errors[0].msg}`);
  const loads = of(all, "load");
  for (const l of loads) if (!l.ok) lines.push(`✗ ${clock(l.t)} 读存档失败：${l.err}`);
  const saveFails = of(all, "saveFail");
  if (saveFails.length) lines.push(`✗ 存档失败 ${saveFails.length} 次，第一次：${saveFails[0].err}`);
  const sums = of(all, "sum");
  const saves = sums.reduce((n, s) => n + s.saves, 0);
  lines.push(`存档写了 ${saves} 次，失败 ${saveFails.length} 次；读档 ${loads.filter((l) => l.found).length} 次，失败 ${loads.filter((l) => !l.ok).length} 次`);
  const over = sums.reduce((n, s) => n + s.focusOver, 0);
  if (over) lines.push(`✗ 有 ${over} 次心跳记进专注的时间比确认运行的还多`);
  // 断档的那一跳，世界和专注都不该动
  const moved = of(all, "beat").filter((b) => b.kind !== "running" && (b.dWorld !== 0 || b.dFocus !== 0));
  if (moved.length) lines.push(`✗ 有 ${moved.length} 次断档时世界或专注仍然往前走了（第一次 ${clock(moved[0].t)}：世界 ${moved[0].dWorld} 分，专注 ${moved[0].dFocus} 毫秒）`);
  // 世界推进：倍率没变的那些跳
  let cw = 0;
  let ce = 0;
  for (const s of sums) {
    cw += s.cmpWorld;
    ce += s.cmpWorldExpect;
  }
  if (ce > 0) lines.push(`${worldOk(cw, ce) ? "" : "✗ "}世界推进：按倍率应走 ${ce.toFixed(1)} 个游戏分钟，实际 ${cw}`);
  let cf = 0;
  let cfe = 0;
  for (const s of sums) {
    cf += s.cmpFocus;
    cfe += s.cmpFocusExpect;
  }
  if (cfe > 0) lines.push(`${Math.abs(cf - cfe) <= LIMITS.focusSlackMs ? "" : "✗ "}有效专注：确认运行 ${sec(cfe)}，记进专注 ${sec(cf)}`);
  // 得份：每天不超过 9 份，两份之间至少 45 分钟（时钟被往回拨的除外）
  const shares = of(all, "share");
  const perDate = new Map<string, number>();
  for (const s of shares) perDate.set(s.date, Math.max(perDate.get(s.date) ?? 0, s.today));
  if (shares.length) lines.push(`得份 ${shares.length} 次：${[...perDate].map(([d, n]) => `${d} 到 ${n} 份`).join("，")}`);
  for (const [d, n] of perDate) if (n > LIMITS.sharesPerDay) lines.push(`✗ ${d} 得了 ${n} 份，超过每天 ${LIMITS.sharesPerDay} 份`);
  for (const s of shares) if (s.sinceLastMs !== null && s.sinceLastMs >= 0 && s.sinceLastMs < LIMITS.shareCooldownMs) lines.push(`✗ ${clock(s.t)} 这一份离上一份只隔了 ${sec(s.sinceLastMs)}`);
  const debug = of(all, "cmd").filter((c) => c.debug);
  if (debug.length) lines.push(`用过调试按钮 ${debug.length} 次（${[...new Set(debug.map((c) => c.name))].join("、")}）：这些时段的数不算真机表现`);
  return item("log", "日志本身和全程", lines, all.length > 0);
}

// ---------- 1. 合上盖子再打开 ----------

/** 专注或休息正在走、没有暂停 */
const runningSig = (sig: string): boolean => (sig === "focus" || sig === "break");

function checkSleep(all: Entry[], sessions: Session[]): Item {
  const lines: string[] = [];
  const bySid = new Map(sessions.map((s) => [s.sid, s]));
  const gaps = of(all, "beat").filter((b) => b.kind !== "running");
  for (const b of gaps) {
    const s = bySid.get(b.sid)!;
    const label = b.kind === "sleep" ? "休眠" : "确认不了的断档";
    const was = b.focusBefore;
    let line = `${clock(b.t)} ${s.browser}：墙上钟走了 ${sec(b.dw)}，单调钟走了 ${sec(b.dm)} → 判为「${label}」；专注 ${was} → ${b.focusAfter}`;
    if (b.dWorld !== 0 || b.dFocus !== 0) line = `✗ ${line}；世界走了 ${b.dWorld} 分、专注记了 ${b.dFocus} 毫秒`;
    else if (runningSig(was) && runningSig(b.focusAfter)) line = `✗ ${line}；专注没有停下来`;
    else if (b.kind === "unverified" && was === "focus" && b.pendingGapMs <= 0) line = `✗ ${line}；没有留下等你选「算进去 / 不算」的断档`;
    lines.push(line);
  }
  const kinds = new Map<string, Set<string>>();
  for (const b of gaps) {
    const br = bySid.get(b.sid)!.browser;
    if (!kinds.has(br)) kinds.set(br, new Set());
    kinds.get(br)!.add(b.kind === "sleep" ? "休眠" : "断档");
  }
  if (kinds.size) lines.push(`各浏览器落在哪一行：${[...kinds].map(([b, k]) => `${b} → ${[...k].join(" / ")}`).join("；")}`);
  // 关掉（或浏览器丢弃页面）以后重开：从存档接着走，离开的时间不补
  for (const l of of(all, "load")) {
    if (!l.found || !l.closedMs || l.closedMs < 60_000) continue;
    const s = bySid.get(l.sid)!;
    const lead = of(s.entries, "leader")[0];
    const paused = !lead || !runningSig(lead.focus);
    lines.push(`${paused ? "" : "✗ "}${clock(l.t)} ${s.browser} 重新打开（距上次存档 ${sec(l.closedMs)}${s.open?.discarded ? "，页面被浏览器丢弃过" : ""}）：专注 ${lead?.focus ?? "?"}`);
  }
  return item("sleep", "1. 合上盖子再打开", lines, gaps.length > 0);
}

// ---------- 2. 主窗口在后台超过 5 分钟 ----------

function checkBackground(all: Entry[], sessions: Session[]): Item {
  const lines: string[] = [];
  const bySid = new Map(sessions.map((s) => [s.sid, s]));
  const spans = of(all, "hidden").filter((h) => h.leader && h.wallMs >= LIMITS.backgroundMs);
  let tested = 0;
  for (const h of spans) {
    const br = bySid.get(h.sid)!.browser;
    const head = `${clock(h.t - h.wallMs)} ${br} 后台 ${sec(h.wallMs)}：心跳 ${h.beats} 次，最长间隔 ${sec(h.maxBeatMs)}，确认运行 ${sec(h.verifiedMs)}${h.froze ? "，页面被冻结过" : ""}`;
    if (h.sleeps > 0) {
      lines.push(`${head}；中间有休眠，算在第 1 项`);
      continue;
    }
    tested += 1;
    const bad: string[] = [];
    if (h.unverified > 0) bad.push(`有 ${h.unverified} 次断档（${sec(h.interruptMs)}），专注被停下：后台定时器被压到了 2 分钟以上`);
    else if (h.verifiedMs < h.wallMs * LIMITS.backgroundKeep) bad.push(`没有断档却少算了 ${sec(h.wallMs - h.verifiedMs)}`);
    if (h.cmpFocusExpect > 0 && Math.abs(h.cmpFocus - h.cmpFocusExpect) > LIMITS.focusSlackMs) bad.push(`专注应记 ${sec(h.cmpFocusExpect)}，记了 ${sec(h.cmpFocus)}`);
    if (h.cmpWorldExpect > 0 && !worldOk(h.cmpWorld, h.cmpWorldExpect)) bad.push(`世界应走 ${h.cmpWorldExpect.toFixed(1)} 分，走了 ${h.cmpWorld}`);
    const focusNote = h.cmpFocusExpect > 0 ? `；专注记了 ${sec(h.cmpFocus)}` : "";
    lines.push(bad.length ? `✗ ${head}；${bad.join("；")}` : `${head}${focusNote}`);
  }
  for (const s of sessions) if (s.open?.discarded) lines.push(`${clock(s.first)} ${s.browser} 页面被浏览器丢弃后重新载入，按「重开」处理（第 1 项有这次读档）`);
  if (!spans.length) {
    const longest = of(all, "hidden").filter((h) => h.leader).reduce((m, h) => Math.max(m, h.wallMs), 0);
    lines.push(`主窗口在后台最长的一段是 ${sec(longest)}，不到 5 分钟`);
  }
  return item("background", "2. 主窗口在后台超过 5 分钟", lines, tested > 0);
}

// ---------- 3. 连续开着 2–4 小时 ----------

function quarterMean(values: number[], which: "first" | "last"): number {
  const n = Math.max(1, Math.floor(values.length / 4));
  const part = which === "first" ? values.slice(Math.min(values.length - 1, 1), n + 1) : values.slice(-n);
  return part.reduce((a, b) => a + b, 0) / Math.max(1, part.length);
}

function checkLongrun(_all: Entry[], sessions: Session[]): Item {
  const lines: string[] = [];
  const leaders = sessions.filter((s) => s.leaderAt !== null);
  if (!leaders.length) return item("longrun", "3. 连续开着 2–4 小时", ["没有主窗口的记录"], false);
  const best = leaders.reduce((a, b) => (b.last - b.leaderAt! > a.last - a.leaderAt! ? b : a));
  const dur = best.last - best.leaderAt!;
  const sums = of(best.entries, "sum");
  const tested = dur >= LIMITS.longrunMs;
  lines.push(`最长的一次主窗口：${best.browser}，${clock(best.leaderAt!)} 起 ${sec(dur)}${tested ? "" : "（不到 2 小时，下面的数只作参考）"}`);
  let wall = 0;
  let verified = 0;
  let skew = 0;
  let interruptMs = 0;
  let cw = 0;
  let ce = 0;
  for (const s of sums) {
    wall += s.wallMs;
    verified += s.verifiedMs;
    skew += s.skewMs;
    interruptMs += s.interruptMs;
    cw += s.cmpWorld;
    ce += s.cmpWorldExpect;
  }
  const interrupts = sums.reduce((n, s) => n + s.interrupts, 0);
  const runWall = wall - of(best.entries, "beat").filter((b) => b.kind !== "running").reduce((n, b) => n + b.dw, 0);
  const hours = Math.max(runWall, 1) / 3_600_000;
  const drift = skew / hours;
  lines.push(`${Math.abs(drift) <= LIMITS.driftMsPerHour ? "" : "✗ "}两个钟的漂移：运行期间墙上钟比单调钟多走 ${sec(skew)}（每小时 ${(drift / 1000).toFixed(2)} 秒）`);
  const keep = runWall > 0 ? verified / runWall : 1;
  lines.push(`${keep >= LIMITS.keepRatio ? "" : "✗ "}确认运行 ${sec(verified)}，占没断档时的墙上钟 ${pct(keep)}；断档 ${interrupts} 次共 ${sec(interruptMs)}`);
  if (ce > 0) lines.push(`${worldOk(cw, ce) ? "" : "✗ "}世界推进：应走 ${ce.toFixed(1)} 分，走了 ${cw}`);
  const chars = sums.map((s) => s.saveChars).filter((n) => n > 0);
  if (chars.length) {
    const max = Math.max(...chars);
    lines.push(`${max <= LIMITS.saveChars ? "" : "✗ "}存档大小：开始 ${(chars[0] / 1024).toFixed(0)} K 字符，最后 ${(chars.at(-1)! / 1024).toFixed(0)} K，最大 ${(max / 1024).toFixed(0)} K；单次写最慢 ${Math.max(...sums.map((s) => s.maxSaveMs)).toFixed(1)} 毫秒`);
  }
  const heaps = sums.map((s) => s.heap).filter((n): n is number => typeof n === "number");
  if (heaps.length >= 8) {
    const a = quarterMean(heaps, "first");
    const b = quarterMean(heaps, "last");
    const bad = b > a * LIMITS.heapGrow && b - a > LIMITS.heapGrowBytes;
    lines.push(`${bad ? "✗ " : ""}堆内存：前四分之一平均 ${mb(a)}，后四分之一 ${mb(b)}`);
  } else lines.push("堆内存：这个浏览器不给（Safari 没有 performance.memory），去活动监视器看");
  const nodes = sums.map((s) => s.nodes);
  if (nodes.length >= 2) lines.push(`页面元素数：${nodes[0]} → ${nodes.at(-1)}，最多 ${Math.max(...nodes)}`);
  return item("longrun", "3. 连续开着 2–4 小时", lines, tested);
}

// ---------- 4. Safari ----------

function checkSafari(all: Entry[], sessions: Session[]): Item {
  const lines: string[] = [];
  const safari = sessions.filter((s) => s.browser === "Safari");
  if (!safari.length) return item("safari", "4. Safari", ["没有 Safari 的记录"], false);
  const ids = new Set(safari.map((s) => s.sid));
  const mine = all.filter((e) => ids.has(e.sid));
  for (const s of safari) {
    const sup = s.open?.support;
    if (sup) {
      const missing = (["locks", "bc", "ls", "idb"] as const).filter((k) => !sup[k]);
      lines.push(`${missing.length ? "✗ " : ""}${clock(s.first)} 打开：Web Locks ${sup.locks ? "有" : "没有"}，BroadcastChannel ${sup.bc ? "有" : "没有"}，localStorage ${sup.ls ? "有" : "没有"}，IndexedDB ${sup.idb ? "有" : "没有"}`);
    }
    if (s.leader) lines.push(`  当上主窗口：${s.leader.from}${s.leader.viaLock ? `，经 Web Lock，等了 ${sec(s.leader.waitedMs ?? 0)}` : "，没有走锁"}`);
    else {
      const heard = of(s.entries, "fsum").reduce((n, f) => n + f.heard, 0);
      lines.push(`${heard > 0 ? "" : "✗ "}  副窗口：收到主窗口广播 ${heard} 次`);
    }
  }
  const saves = of(mine, "sum").reduce((n, s) => n + s.saves, 0);
  const fails = of(mine, "saveFail").length;
  lines.push(`${fails ? "✗ " : ""}Safari 里存档写了 ${saves} 次，失败 ${fails} 次`);
  for (const l of of(mine, "load")) if (!l.ok) lines.push(`✗ Safari 读存档失败：${l.err}`);
  return item("safari", "4. Safari", lines, safari.some((s) => s.leader));
}

// ---------- 多窗口：Web Lock 的持有和交接 ----------

function checkWindows(all: Entry[], sessions: Session[]): Item {
  const lines: string[] = [];
  // 每条小结覆盖 [t - wallMs, t]；不同会话的主窗口小结互相重叠，就是同时有两个主窗口
  const spans = of(all, "sum").map((s) => ({ sid: s.sid, a: s.t - s.wallMs, b: s.t })).sort((x, y) => x.a - y.a);
  let dual = 0;
  let firstDual: number | null = null;
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length && spans[j].a < spans[i].b; j++) {
      if (spans[j].sid !== spans[i].sid && Math.min(spans[i].b, spans[j].b) - spans[j].a > 5_000) {
        dual += 1;
        firstDual ??= spans[j].a;
      }
    }
  }
  if (dual) lines.push(`✗ 有 ${dual} 段时间同时有两个主窗口在推进世界（第一次 ${clock(firstDual!)}）`);
  const handovers = of(all, "leader").filter((l) => l.from === "handover");
  for (const h of handovers) {
    const s = sessions.find((x) => x.sid === h.sid)!;
    lines.push(`${clock(h.t)} ${s.browser} 副窗口接手：离最后一次收到广播 ${sec(h.lastHeardAgoMs ?? 0)}`);
  }
  for (const s of sessions.filter((x) => x.leader && !x.leader.viaLock)) lines.push(`${clock(s.first)} ${s.browser} 没有 Web Locks，直接当主窗口（多开会算两遍）`);
  const locks = of(all, "sum").map((s) => s.locks).filter((l): l is { held: number; pending: number } => !!l);
  if (locks.some((l) => l.held > 1)) lines.push("✗ 锁同时被不止一个窗口拿着");
  const overlapping = sessions.filter((a) => sessions.some((b) => b !== a && b.first < a.last && a.first < b.last));
  lines.push(`同时开着的页面会话 ${overlapping.length} 个，副窗口接手 ${handovers.length} 次`);
  return item("windows", "多窗口（Web Lock 的持有和交接）", lines, overlapping.length > 1);
}

export function analyze(data: ProbeExport | Entry[]): Report {
  // 页面被杀以后补写的条目可能和原来的重复：按 sid+seq 去重
  const seen = new Set<string>();
  const all = (Array.isArray(data) ? data : data.entries)
    .filter((e) => {
      const key = `${e.sid}:${e.seq}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.t - b.t || a.seq - b.seq);
  const sessions = sessionsOf(all);
  return {
    entries: all.length,
    sessions: sessions.length,
    fromWall: all.length ? all[0].t : null,
    toWall: all.length ? all.at(-1)!.t : null,
    items: [checkLog(all, sessions), checkSleep(all, sessions), checkBackground(all, sessions), checkLongrun(all, sessions), checkSafari(all, sessions), checkWindows(all, sessions)],
  };
}

export function reportText(r: Report): string {
  const out: string[] = [];
  out.push(`真机验证日志：${r.entries} 条，${r.sessions} 个页面会话${r.fromWall ? `，${clock(r.fromWall)} 到 ${clock(r.toWall!)}` : ""}`);
  for (const it of r.items) {
    out.push("", `【${VERDICT_TEXT[it.verdict]}】${it.title}`);
    for (const l of it.lines) out.push(`  ${l}`);
  }
  return out.join("\n");
}
