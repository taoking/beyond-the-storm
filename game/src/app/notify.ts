// 专注/休息结束时的系统通知（04 第 19.2 节 A7）。
//
// - 是本机设置，默认关；勾上的那一刻才问浏览器要权限，别的时候一律不问。
// - 只在计时自己走完时发（心跳里 G.advance 吐出的结束事件）；你自己点「结束」「跳过休息」不发。
// - 每次结束最多一条，只写现实计时（「25 分钟专注结束」），不写份、样式和屋里的事。
// - 只有主窗口在推进游戏，所以只有主窗口会发；主窗口换人时用记在本机的上一条的标签挡住重发。
// - 没有权限或浏览器不支持：什么也不弹，计时区照常变，设置旁边写一句现在的情况。
//
// 上半部分是纯函数（测试直接用），下半部分才碰浏览器。
import type { FocusEvent } from "../core/focus.ts";
import type { Game } from "../core/game.ts";

export type Permission = "granted" | "denied" | "default" | "unsupported";

/** 推进之前记下的这一轮计时。结束事件里没有计划时长，只能先记 */
export interface RoundClock {
  /** 这一轮的身份：记录号加开始时刻，删档重开后记录号重来也不会撞 */
  round: string;
  /** 正在走的这一段（专注或休息）计划多少分钟，含「加 5 分钟」 */
  targetMin: number;
  focusMin: number;
  breakMin: number;
}

export interface SystemNotice {
  title: string;
  body: string;
  /** 同一轮同一种结束只有一个标签：系统和本机记录都靠它去重 */
  tag: string;
}

export function roundClock(g: Game): RoundClock | null {
  const s = g.focus.session;
  if (!s || s.preset.kind !== "countdown" || s.targetMs === null) return null;
  return {
    round: `${s.round.recordId}-${s.round.startedWall}`,
    targetMin: Math.round(s.targetMs / 60_000),
    focusMin: s.preset.focusMin,
    breakMin: s.preset.breakMin,
  };
}

/**
 * 这一次推进里有没有计时走完。心跳一秒一跳，一次推进最多碰到一个终点；
 * 万一碰到好几个也只报第一个，因为推进前记下的计时说的正是它。
 */
export function noticeFor(before: RoundClock | null, events: readonly FocusEvent[]): SystemNotice | null {
  if (!before) return null;
  const end = events.find((e) => e.type === "focusEnded" || e.type === "breakEnded");
  if (!end) return null;
  if (end.type === "focusEnded") {
    return {
      title: `${before.targetMin} 分钟专注结束`,
      body: end.toBreak ? `接下来休息 ${before.breakMin} 分钟` : "",
      tag: `bts-${before.round}-focus`,
    };
  }
  if (end.type === "breakEnded") {
    return {
      title: `${before.breakMin} 分钟休息结束`,
      body: end.autoStarted ? `下一轮 ${before.focusMin} 分钟已开始` : "",
      tag: `bts-${before.round}-break`,
    };
  }
  return null;
}

export interface NotifyDeps {
  enabled(): boolean;
  permission(): Permission;
  show(n: SystemNotice): void;
  /** 本机所有窗口共用的「上一条发过的标签」 */
  lastTag(): string | null;
  setLastTag(tag: string): void;
}

export interface Notifier {
  /** 心跳推进以后调一次；返回这次发了的那条（测试用） */
  afterAdvance(leader: boolean, before: RoundClock | null, events: readonly FocusEvent[]): SystemNotice | null;
}

export function createNotifier(deps: NotifyDeps): Notifier {
  return {
    afterAdvance(leader, before, events) {
      if (!leader) return null;
      const n = noticeFor(before, events);
      if (!n || !deps.enabled() || deps.permission() !== "granted") return null;
      if (deps.lastTag() === n.tag) return null;
      deps.setLastTag(n.tag);
      try {
        deps.show(n);
      } catch (err) {
        console.info("系统通知没发出去", err);
        return null;
      }
      return n;
    },
  };
}

/** 设置旁边那一句：现在会不会弹、为什么不弹 */
export function notifyStatus(enabled: boolean, permission: Permission): string {
  if (!enabled) return "";
  switch (permission) {
    case "granted":
      return "结束时发一条系统通知";
    case "denied":
      return "浏览器没有允许通知，只在计时区显示";
    case "unsupported":
      return "这里不支持系统通知，只在计时区显示";
    default:
      return "还没允许通知，只在计时区显示；取消再勾一次可以重新询问";
  }
}

// ---------- 浏览器 ----------

const PREFS_KEY = "bts.prefs.v1";
const LAST_TAG_KEY = "bts.notify.last";

/** 本机设置：不进存档，删档重开也不丢（06 第 2 节的 UIState） */
export interface Prefs {
  notify: boolean;
}

export function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    return { notify: p.notify === true };
  } catch {
    return { notify: false };
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch (err) {
    console.info("本机设置没存上", err);
  }
}

export function browserPermission(): Permission {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission as Permission;
}

/** 只在你勾上开关的那一下调用；已经有答案（允许或拒绝）就不再问 */
export async function askPermission(): Promise<Permission> {
  const now = browserPermission();
  if (now !== "default") return now;
  try {
    return (await Notification.requestPermission()) as Permission;
  } catch {
    return browserPermission();
  }
}

export function browserNotifier(): Notifier {
  return createNotifier({
    enabled: () => loadPrefs().notify,
    permission: browserPermission,
    show: (n) => {
      new Notification(n.title, { body: n.body, tag: n.tag });
    },
    lastTag: () => {
      try {
        return localStorage.getItem(LAST_TAG_KEY);
      } catch {
        return null;
      }
    },
    setLastTag: (tag) => {
      try {
        localStorage.setItem(LAST_TAG_KEY, tag);
      } catch {
        // 记不住也只是可能多一条，不影响计时
      }
    },
  });
}
