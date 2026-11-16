// 真机验证日志的记录端（06 第 12 节）：可见性、页面冻结和恢复、两个钟的差、世界推进、有效专注、得份、
// Web Lock、存档读写。存在本机 IndexedDB 的环形缓冲里（最多 MAX_ENTRIES 条），从 /log.html 导出。
//
// 只记不改：这里不调用任何改游戏状态的函数，每个入口都包了 try/catch，出错也不影响游戏。
import { CONFIG } from "../../core/config.ts";
import { localCalendar } from "../../core/focus.ts";
import { worldRate, type Game } from "../../core/game.ts";
import type { Beat, GapVerdict } from "../../core/heartbeat.ts";
import type { Entry, FocusSig } from "./entries.ts";

export const PROBE_DB = "bts.probe";
export const PROBE_STORE = "log";
/** 环形缓冲的上限。4 小时连开大约写 600 条，两万条够几周 */
export const MAX_ENTRIES = 20_000;
/** 还没写进 IndexedDB 的条目同步抄一份在 localStorage：页面被杀、被浏览器重新载入也不丢，下次打开时补进去 */
export const MIRROR_PREFIX = "bts.probe.pending.";
const MIRROR_MAX = 500;
const SUM_EVERY_MS = 60_000;
const FLUSH_EVERY_MS = 5_000;
/** 间隔超过这么久的心跳单独记一条（后台被节流时大约一分钟一条） */
const ODD_BEAT_MS = 5_000;
const ODD_SKEW_MS = 2_000;

export interface Probe {
  loaded(found: boolean, info?: { chars?: number; savedWall?: number; err?: unknown }): void;
  lockRequested(supported: boolean): void;
  /** 当上主窗口。要在运行时注册完自己的 visibilitychange、pagehide 监听之后调用 */
  leader(g: Game, from: "save" | "new" | "handover", lastHeardWall: number | null): void;
  beat(g: Game, prev: Beat, now: Beat, verdict: GapVerdict, verifiedMs: number): void;
  command(g: Game | null, name: string, result: unknown): void;
  saved(chars: number, ms: number): void;
  saveFailed(err: unknown): void;
  heard(): void;
}

interface Baseline {
  wm: number;
  fms: number;
  shares: number;
  rate: number;
  asleep: boolean;
  focus: FocusSig;
  focusing: boolean;
  mode: string;
}

const errText = (err: unknown): string => String(err instanceof Error ? `${err.name}: ${err.message}` : err).slice(0, 300);

function focusSig(g: Game): FocusSig {
  const s = g.focus.session;
  if (!s) return "none";
  return s.paused ? `${s.phase}:${s.paused}` : s.phase;
}

function baseline(g: Game): Baseline {
  const s = g.focus.session;
  return {
    wm: g.world.minute,
    fms: g.focus.stats.totalMs,
    shares: g.focus.shares.total,
    rate: worldRate(g),
    asleep: g.world.actor.asleep,
    focus: focusSig(g),
    focusing: !!s && s.phase === "focus" && !s.paused && g.mode !== "outdoor",
    mode: g.mode,
  };
}

function emptySum() {
  return {
    beats: 0, wallMs: 0, monoMs: 0, verifiedMs: 0, maxBeatMs: 0, skewMs: 0, interrupts: 0, interruptMs: 0,
    dWorld: 0, cmpWorld: 0, cmpWorldExpect: 0, dFocus: 0, cmpFocus: 0, cmpFocusExpect: 0, focusOver: 0, hiddenMs: 0,
    saves: 0, saveFails: 0, saveChars: 0, maxSaveMs: 0,
  };
}

function emptySpan(leader: boolean) {
  return {
    t0: Date.now(), m0: performance.now(), leader, beats: 0, maxBeatMs: 0, verifiedMs: 0, sleeps: 0, unverified: 0,
    interruptMs: 0, dFocus: 0, cmpFocus: 0, cmpFocusExpect: 0, cmpWorld: 0, cmpWorldExpect: 0, froze: false,
  };
}

export function startProbe(opt: { lockName: string; isLeader: () => boolean; game: () => Game | null }): Probe {
  const sid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let seq = 0;
  let queue: Entry[] = [];
  let db: IDBDatabase | null = null;
  let dbFailed = false;
  let base: Baseline | null = null;
  let acc = emptySum();
  let lastSum = Date.now();
  let span: ReturnType<typeof emptySpan> | null = null;
  let lockAskedAt: number | null = null;
  let viaLock = false;
  let locks: { held: number; pending: number } | null = null;
  let lastSaveChars = 0;
  // 副窗口
  let heard = 0;
  let lastHeard: number | null = null;
  let maxSilence = 0;
  let lastFsum = Date.now();

  type Fields = Entry extends infer E ? (E extends Entry ? Omit<E, "t" | "m" | "sid" | "seq"> : never) : never;
  const mirrorKey = MIRROR_PREFIX + sid;
  /** 正在写进 IndexedDB、还没确认写好的那一批 */
  let inflight: Entry[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function mirror(): void {
    try {
      const pending = inflight.length + queue.length;
      if (pending === 0) localStorage.removeItem(mirrorKey);
      else if (pending <= MIRROR_MAX) localStorage.setItem(mirrorKey, JSON.stringify(inflight.concat(queue)));
    } catch {
      /* localStorage 满了或不让用：只是少一层保险 */
    }
  }

  function push(fields: Fields): void {
    queue.push({ t: Date.now(), m: Math.round(performance.now()), sid, seq: seq++, ...fields } as Entry);
    if (dbFailed && queue.length > 2000) queue.splice(0, queue.length - 2000);
    mirror();
    flushTimer ??= setTimeout(() => {
      flushTimer = null;
      flush();
    }, 250);
  }

  function flush(): void {
    if (!db || queue.length === 0 || inflight.length > 0) return;
    inflight = queue;
    queue = [];
    const giveBack = (): void => {
      queue = inflight.concat(queue);
      inflight = [];
    };
    try {
      const tx = db.transaction(PROBE_STORE, "readwrite");
      const store = tx.objectStore(PROBE_STORE);
      let lastKey = 0;
      for (const e of inflight) store.add(e).onsuccess = (ev) => (lastKey = Number((ev.target as IDBRequest).result));
      tx.oncomplete = () => {
        inflight = [];
        mirror();
        // 环形缓冲：删掉比最近 MAX_ENTRIES 条更早的
        if (lastKey > MAX_ENTRIES && db) {
          try {
            db.transaction(PROBE_STORE, "readwrite").objectStore(PROBE_STORE).delete(IDBKeyRange.upperBound(lastKey - MAX_ENTRIES));
          } catch {
            /* 下次再删 */
          }
        }
        if (queue.length) flush();
      };
      tx.onerror = giveBack;
      tx.onabort = giveBack;
    } catch (err) {
      giveBack();
      console.warn("验证日志写不进 IndexedDB", err);
    }
  }

  /** 别的页面没来得及写进去的（被杀、被重新载入）：补进 IndexedDB。还开着的窗口的会重复，分析时按 sid+seq 去重 */
  function adoptOrphans(): void {
    if (!db) return;
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(MIRROR_PREFIX) || key === mirrorKey) continue;
        const list = JSON.parse(localStorage.getItem(key) ?? "[]") as Entry[];
        const tx = db.transaction(PROBE_STORE, "readwrite");
        for (const e of list) tx.objectStore(PROBE_STORE).add(e);
        tx.oncomplete = () => localStorage.removeItem(key);
      }
    } catch (err) {
      console.warn("补写上次的验证日志失败", err);
    }
  }

  const safe =
    <A extends unknown[]>(fn: (...a: A) => void) =>
    (...a: A): void => {
      try {
        fn(...a);
      } catch (err) {
        console.warn("验证日志出错（不影响游戏）", err);
      }
    };

  function queryLocks(): void {
    if (!("locks" in navigator)) return;
    navigator.locks
      .query()
      .then((s) => {
        const mine = (list?: LockInfo[]) => (list ?? []).filter((l) => l.name === opt.lockName).length;
        locks = { held: mine(s.held), pending: mine(s.pending) };
      })
      .catch(() => {});
  }

  function closeSum(g: Game | null): void {
    const now = Date.now();
    if (opt.isLeader() && g && acc.beats + acc.saves > 0) {
      const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
      push({
        k: "sum",
        ...acc,
        saveChars: acc.saveChars || lastSaveChars,
        mode: g.mode,
        wm: g.world.minute,
        asleep: g.world.actor.asleep,
        focus: focusSig(g),
        heap,
        nodes: document.getElementsByTagName("*").length,
        locks,
        tzOffset: new Date().getTimezoneOffset(),
      });
    }
    acc = emptySum();
    lastSum = now;
    queryLocks();
  }

  function closeSpan(ended: "visible" | "pagehide"): void {
    if (!span) return;
    const { t0, m0, ...rest } = span;
    push({ k: "hidden", ...rest, wallMs: Date.now() - t0, monoMs: Math.round(performance.now() - m0), ended });
    span = null;
  }

  /** 看看状态有没有变：得份、专注换状态、模式切换。via 是心跳还是哪条命令 */
  function observe(g: Game, via: string): Baseline {
    const cur = baseline(g);
    if (base) {
      if (cur.shares > base.shares) {
        const now = Date.now();
        const last = g.focus.shares.lastGrantWall;
        const prevGrant = prevGrantWall;
        push({
          k: "share",
          total: cur.shares,
          today: g.focus.shares.byDate[localCalendar.dateKey(now)] ?? 0,
          date: localCalendar.dateKey(now),
          sinceLastMs: prevGrant !== null && last !== null ? last - prevGrant : null,
          via,
        });
      }
      if (cur.focus !== base.focus) push({ k: "focus", from: base.focus, to: cur.focus, via, pendingGapMs: g.focus.session?.pendingGapMs ?? 0 });
      if (cur.mode !== base.mode) push({ k: "mode", from: base.mode, to: cur.mode, via });
    }
    prevGrantWall = g.focus.shares.lastGrantWall;
    return cur;
  }
  let prevGrantWall: number | null = null;
  let lateHooks = (): void => {};

  function hiddenNow(): boolean {
    return document.visibilityState === "hidden";
  }

  const probe: Probe = {
    loaded: safe((found, info = {}) => {
      const ok = !info.err;
      push({
        k: "load",
        ok,
        found,
        chars: info.chars,
        savedWall: info.savedWall,
        closedMs: info.savedWall ? Date.now() - info.savedWall : undefined,
        err: info.err ? errText(info.err) : undefined,
      });
    }),
    lockRequested: safe((supported) => {
      lockAskedAt = performance.now();
      viaLock = supported;
      push({ k: "lock", phase: supported ? "requested" : "unsupported" });
    }),
    leader: safe((g, from, lastHeardWall) => {
      base = baseline(g);
      prevGrantWall = g.focus.shares.lastGrantWall;
      push({
        k: "leader",
        from,
        viaLock,
        waitedMs: lockAskedAt === null ? null : Math.round(performance.now() - lockAskedAt),
        lastHeardAgoMs: lastHeardWall === null ? null : Date.now() - lastHeardWall,
        wm: g.world.minute,
        focus: base.focus,
      });
      acc = emptySum();
      lastSum = Date.now();
      if (span) span.leader = true;
      lateHooks();
    }),
    beat: safe((g, prev, now, verdict, verifiedMs) => {
      if (!base) base = baseline(g);
      const b = base;
      const cur = observe(g, "beat");
      const dw = now.wall - prev.wall;
      const dm = now.mono - prev.mono;
      const dWorld = cur.wm - b.wm;
      const dFocus = cur.fms - b.fms;
      const running = verdict.kind === "running";
      const hidden = hiddenNow();
      const rateSteady = cur.rate === b.rate && cur.asleep === b.asleep && cur.mode === b.mode;
      const focusSteady = b.focusing && cur.focus === b.focus;
      for (const a of span ? [acc, span] : [acc]) {
        a.beats += 1;
        a.verifiedMs += verifiedMs;
        a.maxBeatMs = Math.max(a.maxBeatMs, Math.round(dm));
        a.dFocus += dFocus;
        if (running && rateSteady) {
          a.cmpWorld += dWorld;
          a.cmpWorldExpect += (verifiedMs * b.rate) / 60_000;
        }
        if (running && focusSteady) {
          a.cmpFocus += dFocus;
          a.cmpFocusExpect += verifiedMs;
        }
        if (!running) a.interruptMs += verdict.gapMs;
      }
      acc.wallMs += dw;
      acc.monoMs += dm;
      acc.dWorld += dWorld;
      if (running) acc.skewMs += dw - dm;
      else acc.interrupts += 1;
      if (dFocus > verifiedMs + 1) acc.focusOver += 1;
      if (hidden) acc.hiddenMs += dw;
      if (span && !running) {
        if (verdict.kind === "sleep") span.sleeps += 1;
        else span.unverified += 1;
      }
      if (!running || dm > ODD_BEAT_MS || Math.abs(dw - dm) > ODD_SKEW_MS || dFocus > verifiedMs + 1) {
        push({
          k: "beat",
          dw,
          dm: Math.round(dm),
          kind: verdict.kind,
          verifiedMs,
          gapMs: Math.round(verdict.gapMs),
          dWorld,
          dFocus,
          focusBefore: b.focus,
          focusAfter: cur.focus,
          pendingGapMs: g.focus.session?.pendingGapMs ?? 0,
          hidden,
        });
      }
      base = cur;
      if (now.wall - lastSum >= SUM_EVERY_MS || now.wall < lastSum) closeSum(g);
    }),
    command: safe((g, name, result) => {
      if (!g) return;
      const b = base ?? baseline(g);
      const cur = observe(g, name);
      const r = result && typeof result === "object" && "ok" in result ? (result as { ok: boolean; reason?: string }) : null;
      push({
        k: "cmd",
        name,
        ok: r ? r.ok : true,
        reason: r?.reason,
        dWorld: cur.wm - b.wm,
        dFocus: cur.fms - b.fms,
        debug: name.startsWith("debug") || name === "reset",
      });
      base = cur;
    }),
    saved: safe((chars, ms) => {
      acc.saves += 1;
      acc.saveChars = chars;
      lastSaveChars = chars;
      acc.maxSaveMs = Math.max(acc.maxSaveMs, Math.round(ms * 10) / 10);
    }),
    saveFailed: safe((err) => {
      acc.saveFails += 1;
      push({ k: "saveFail", err: errText(err) });
    }),
    heard: safe(() => {
      const now = Date.now();
      if (lastHeard !== null) maxSilence = Math.max(maxSilence, now - lastHeard);
      lastHeard = now;
      heard += 1;
      if (now - lastFsum >= SUM_EVERY_MS && !opt.isLeader()) {
        push({ k: "fsum", heard, maxSilenceMs: maxSilence, lastHeardAgoMs: 0, locks });
        heard = 0;
        maxSilence = 0;
        lastFsum = now;
        queryLocks();
      }
    }),
  };

  // —— 开页面这一刻 ——
  const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  push({
    k: "open",
    ua: navigator.userAgent,
    href: location.href,
    discarded: !!(document as Document & { wasDiscarded?: boolean }).wasDiscarded,
    nav: nav?.type ?? "unknown",
    support: {
      locks: "locks" in navigator,
      bc: typeof BroadcastChannel !== "undefined",
      idb: typeof indexedDB !== "undefined",
      ls: (() => {
        try {
          return typeof localStorage !== "undefined" && localStorage !== null;
        } catch {
          return false;
        }
      })(),
      memory: "memory" in performance,
    },
    tzOffset: new Date().getTimezoneOffset(),
    heartbeat: { ...CONFIG.heartbeat },
    hidden: document.visibilityState === "hidden",
  });
  if (document.visibilityState === "hidden") span = emptySpan(false);

  try {
    const req = indexedDB.open(PROBE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(PROBE_STORE, { autoIncrement: true });
    req.onsuccess = () => {
      db = req.result;
      adoptOrphans();
      push({ k: "store", kind: "idb" });
      flush();
    };
    req.onerror = () => {
      dbFailed = true;
      push({ k: "store", kind: "memory", err: errText(req.error) });
    };
  } catch (err) {
    dbFailed = true;
    push({ k: "store", kind: "memory", err: errText(err) });
  }

  // —— 页面生命周期：这些监听只记录，不碰游戏 ——
  // 收小结、收后台那一段要等运行时自己的监听先跑完（它会在这时补一次心跳），
  // 所以当上主窗口以后改由 leader() 里后注册的监听来做（late）。
  let late = false;
  function visClose(): void {
    if (document.visibilityState === "hidden") {
      closeSum(opt.game());
      span = emptySpan(opt.isLeader());
    } else closeSpan("visible");
    flush();
  }
  function hideClose(): void {
    closeSum(opt.game());
    closeSpan("pagehide");
    flush();
  }
  lateHooks = () => {
    if (late) return;
    late = true;
    document.addEventListener("visibilitychange", safe(visClose));
    window.addEventListener("pagehide", safe(hideClose));
  };
  const g0 = (): { wm: number | null; fms: number | null } => {
    const g = opt.game();
    return { wm: g ? g.world.minute : null, fms: g ? g.focus.stats.totalMs : null };
  };
  document.addEventListener(
    "visibilitychange",
    safe(() => {
      push({ k: "vis", state: document.visibilityState, leader: opt.isLeader(), ...g0() });
      if (!late) visClose();
    }),
  );
  const life = (ev: "freeze" | "resume" | "pageshow" | "pagehide" | "focus" | "blur", target: EventTarget) =>
    target.addEventListener(
      ev,
      safe((e: Event) => {
        const persisted = "persisted" in e ? (e as PageTransitionEvent).persisted : undefined;
        push({ k: "life", ev, persisted });
        if (ev === "freeze" && span) span.froze = true;
        if (ev === "pagehide" && !late) hideClose();
        if (ev === "freeze" || ev === "pagehide") flush();
      }),
    );
  life("freeze", document);
  life("resume", document);
  life("pageshow", window);
  life("pagehide", window);
  life("focus", window);
  life("blur", window);
  window.addEventListener(
    "error",
    safe((e: ErrorEvent) => push({ k: "error", msg: `${e.message} @${e.filename}:${e.lineno}`.slice(0, 300) })),
  );
  window.addEventListener(
    "unhandledrejection",
    safe((e: PromiseRejectionEvent) => push({ k: "error", msg: `unhandledrejection: ${errText(e.reason)}` })),
  );
  setInterval(
    safe(() => {
      // 副窗口一直没收到广播时也要出小结
      const now = Date.now();
      if (!opt.isLeader() && now - lastFsum >= SUM_EVERY_MS) {
        push({ k: "fsum", heard, maxSilenceMs: maxSilence, lastHeardAgoMs: lastHeard === null ? null : now - lastHeard, locks });
        heard = 0;
        maxSilence = 0;
        lastFsum = now;
        queryLocks();
      }
      flush();
    }),
    FLUSH_EVERY_MS,
  );
  queryLocks();
  return probe;
}
