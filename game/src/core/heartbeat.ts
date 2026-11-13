// 「这一段时间应用是不是一直在运行」的判定：02 第 3.4 节。
// 原则：能确认应用一直在运行的时间才算数；确认不了的断档，世界一律不补。
//
// 驱动每次心跳带两个钟：墙上钟（Date.now，休眠时照走、可能被人拨）和单调钟
// （performance.now，同一进程里只增不减）。两个钟的差告诉我们刚才发生了什么。
import { CONFIG } from "./config.ts";

export interface Beat {
  wall: number;
  mono: number;
}

export type GapKind =
  /** 确认在运行：这段时间照常记进专注和世界 */
  | "running"
  /** 墙上钟比单调钟多走了一大截：电脑睡过（或时钟被往后拨）。不计、不补、不给选择 */
  | "sleep"
  /** 两个钟都走了很久、中间没有心跳：页面被挂起或冻结，确认不了。专注停在已暂停，由你选算不算 */
  | "unverified";

export interface GapVerdict {
  kind: GapKind;
  /** 记进专注和世界的毫秒数（只有 running 不是 0） */
  verifiedMs: number;
  /** 断档有多长（按单调钟；sleep 时按墙上钟），给界面显示「有 N 分钟确认不了」 */
  gapMs: number;
}

/**
 * 比较前后两次心跳。
 * - 单调钟走得不多、墙上钟也对得上：确认在运行（后台节流到一分钟一跳也在这里面）。
 * - 墙上钟往回走了（时钟被往回拨）：以单调钟为准，份的冷却由 focus.ts 另行处理。
 */
export function judgeGap(prev: Beat, now: Beat, cfg = CONFIG.heartbeat): GapVerdict {
  const mono = Math.max(0, now.mono - prev.mono);
  const wall = now.wall - prev.wall;
  const skew = wall - mono;
  if (skew > cfg.sleepSkewMs) {
    // 单调钟在休眠时不走的平台（macOS 上的 Chrome、Safari）会落到这里
    return { kind: "sleep", verifiedMs: 0, gapMs: wall };
  }
  if (mono > cfg.trustGapMs) {
    // 单调钟在休眠时也走的平台，休眠会落到这里：确认不了，就问
    return { kind: "unverified", verifiedMs: 0, gapMs: mono };
  }
  return { kind: "running", verifiedMs: mono, gapMs: 0 };
}
