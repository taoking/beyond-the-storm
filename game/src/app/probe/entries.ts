// 真机验证日志的条目格式（06 第 12 节）。记录端（recorder.ts）写，导出页和 tools/probe-check.ts 读。
// 只是记下来给人事后看，不参与游戏规则；改格式要把 PROBE_FORMAT_VERSION 加一。

export const PROBE_FORMAT = "bts-probe";
export const PROBE_FORMAT_VERSION = 1;

/** 每一条都有的字段：墙上钟、这个页面的单调钟、页面会话 id、会话内序号、种类 */
export interface Base {
  t: number;
  m: number;
  sid: string;
  seq: number;
}

/** 专注的状态简写：none / focus / break / awaitNext，暂停时加 `:原因` */
export type FocusSig = string;

export type Entry = Base &
  (
    | {
        k: "open";
        ua: string;
        href: string;
        /** 页面是被浏览器丢弃后重新载入的（Chrome 的 document.wasDiscarded） */
        discarded: boolean;
        /** navigate / reload / back_forward / prerender */
        nav: string;
        support: { locks: boolean; bc: boolean; idb: boolean; ls: boolean; memory: boolean };
        tzOffset: number;
        heartbeat: { trustGapMs: number; sleepSkewMs: number };
        hidden: boolean;
      }
    | { k: "store"; kind: "idb" | "memory"; err?: string }
    | { k: "load"; ok: boolean; found: boolean; chars?: number; savedWall?: number; closedMs?: number; err?: string }
    | { k: "lock"; phase: "requested" | "unsupported" }
    | {
        k: "leader";
        /** save 从存档读；new 新开局；handover 从前一个主窗口手里接过来 */
        from: "save" | "new" | "handover";
        viaLock: boolean;
        /** 从请求锁到拿到锁等了多久 */
        waitedMs: number | null;
        /** handover：离最后一次收到主窗口广播过了多久 */
        lastHeardAgoMs: number | null;
        wm: number;
        focus: FocusSig;
      }
    | { k: "vis"; state: string; leader: boolean; wm: number | null; fms: number | null }
    | { k: "life"; ev: "freeze" | "resume" | "pageshow" | "pagehide" | "focus" | "blur"; persisted?: boolean }
    | {
        /** 不寻常的一次心跳：没判为在运行，或间隔超过 5 秒，或两个钟差了 2 秒以上 */
        k: "beat";
        dw: number;
        dm: number;
        kind: "running" | "sleep" | "unverified";
        verifiedMs: number;
        gapMs: number;
        /** 这一跳里世界走了几个游戏分钟、专注记了多少毫秒 */
        dWorld: number;
        dFocus: number;
        focusBefore: FocusSig;
        focusAfter: FocusSig;
        pendingGapMs: number;
        hidden: boolean;
      }
    | {
        /** 主窗口每 60 秒一条小结（转到后台、关页面时也收一次） */
        k: "sum";
        beats: number;
        wallMs: number;
        monoMs: number;
        verifiedMs: number;
        maxBeatMs: number;
        /** 判为在运行的那些跳里，墙上钟减单调钟的累计：长时间运行的漂移 */
        skewMs: number;
        interrupts: number;
        interruptMs: number;
        /** 这段里心跳带来的世界推进（游戏分钟） */
        dWorld: number;
        /** 倍率没变的那些跳：实际推进和按倍率算的应推进 */
        cmpWorld: number;
        cmpWorldExpect: number;
        dFocus: number;
        /** 一直在有效专注的那些跳：实际记的和确认运行的毫秒 */
        cmpFocus: number;
        cmpFocusExpect: number;
        /** 记进专注的比确认运行的还多的跳数（应当永远是 0） */
        focusOver: number;
        hiddenMs: number;
        mode: string;
        wm: number;
        asleep: boolean;
        focus: FocusSig;
        saves: number;
        saveFails: number;
        saveChars: number;
        maxSaveMs: number;
        heap: number | null;
        nodes: number;
        locks: { held: number; pending: number } | null;
        tzOffset: number;
      }
    | { k: "fsum"; heard: number; maxSilenceMs: number; lastHeardAgoMs: number | null; locks: { held: number; pending: number } | null }
    | {
        /** 一段后台：从转到后台到回到前台（或页面关掉） */
        k: "hidden";
        wallMs: number;
        monoMs: number;
        leader: boolean;
        beats: number;
        maxBeatMs: number;
        verifiedMs: number;
        sleeps: number;
        unverified: number;
        interruptMs: number;
        dFocus: number;
        cmpFocus: number;
        cmpFocusExpect: number;
        cmpWorld: number;
        cmpWorldExpect: number;
        froze: boolean;
        ended: "visible" | "pagehide";
      }
    | { k: "share"; total: number; today: number; date: string; sinceLastMs: number | null; via: "beat" | string }
    | { k: "focus"; from: FocusSig; to: FocusSig; via: "beat" | string; pendingGapMs: number }
    | { k: "mode"; from: string; to: string; via: string }
    | { k: "cmd"; name: string; ok: boolean; reason?: string; dWorld: number; dFocus: number; debug: boolean }
    | { k: "saveFail"; err: string }
    | { k: "error"; msg: string }
  );

export type Kind = Entry["k"];
export type EntryOf<K extends Kind> = Extract<Entry, { k: K }>;

export interface ProbeExport {
  format: typeof PROBE_FORMAT;
  version: number;
  exportedWall: number;
  ua: string;
  entries: Entry[];
}
