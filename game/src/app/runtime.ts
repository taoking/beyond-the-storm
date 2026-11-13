// 浏览器里的运行时：心跳、休眠和断档的判定、存档、多窗口共用一份事实。
//
// 多窗口：同一时间只有一个窗口（主窗口）在推进游戏，靠 Web Locks 抢一把锁；
// 其余窗口只显示主窗口广播过来的状态，操作也发给主窗口去做。主窗口关了，排队的窗口接手。
// 这样打开第二个窗口不会让世界算两遍，也不会多发份。
import { localCalendar } from "../core/focus.ts";
import * as G from "../core/game.ts";
import { judgeGap, type Beat } from "../core/heartbeat.ts";
import { deserialize, serialize } from "../core/save.ts";
import type { TaskCategory } from "../core/content.ts";
import type { FocusPreset } from "../core/focus.ts";

const SAVE_KEY = "bts.save.v1";
const LOCK = "bts.leader";
const CHANNEL = "bts.sync";
const BEAT_MS = 1000;
const SAVE_EVERY_MS = 10_000;

export const cal = localCalendar;

type Command = { name: string; args: unknown[] };
type Message = { type: "state"; text: string } | { type: "cmd"; cmd: Command } | { type: "hello" };

/** 界面能发的命令。名字和参数都是可以跨窗口传的普通数据。 */
const COMMANDS: Record<string, (g: G.Game, wall: number, ...a: never[]) => unknown> = {
  startFocus: (g, wall, preset: FocusPreset, category: TaskCategory, taskId: number | null) =>
    G.cmdStartFocus(g, wall, cal, { preset, category, taskId }),
  pauseFocus: (g) => G.cmdPauseFocus(g),
  resumeFocus: (g) => G.cmdResumeFocus(g),
  endFocus: (g, wall) => G.cmdEndFocus(g, wall, cal),
  extendFocus: (g) => G.cmdExtendFocus(g, 5),
  nextRound: (g, wall) => G.cmdNextRound(g, wall, cal),
  resolveGap: (g, wall, count: boolean) => G.cmdResolveGap(g, wall, cal, count),
  setNote: (g, _wall, id: number, note: string) => G.cmdSetNote(g, id, note),
  addTask: (g, _wall, name: string, category: TaskCategory) => G.cmdAddTask(g, name, category),
  completeTask: (g, wall, id: number) => G.cmdCompleteTask(g, id, wall, cal),
  setAutoNext: (g, _wall, on: boolean) => G.cmdSetAutoNext(g, on),
  enterAmbience: (g, _wall, choice: G.AmbienceChoice) => G.cmdEnterAmbience(g, choice),
  returnToToday: (g) => G.cmdReturnToToday(g),
  returnToWild: (g) => G.cmdReturnToWild(g),
  depart: (g, wall, rations: number, bundles: number) => G.cmdDepart(g, wall, { rations, bundles }),
  travelTo: (g, wall, area: string) => G.cmdTravelTo(g, wall, area),
  headHome: (g) => G.cmdHeadHome(g),
  enterForest: (g) => G.cmdEnterForest(g),
  forestMove: (g, _wall, dx: number, dy: number) => G.cmdForestMove(g, dx, dy),
  forestGather: (g, _wall, id: string) => G.cmdForestGather(g, id),
  forestRest: (g) => G.cmdForestRest(g),
  forestWarm: (g) => G.cmdForestWarm(g),
  forestReturn: (g) => G.cmdForestReturn(g),
  outdoorPanel: (g, _wall, panel: G.Game["outdoorPanel"]) => G.cmdOutdoorPanel(g, panel),
  pin: (g, _wall, id: string) => G.cmdPinProject(g, id),
  unpin: (g, _wall, id: string) => G.cmdUnpinProject(g, id),
  pauseProject: (g, _wall, id: string, paused: boolean) => G.cmdPauseProject(g, id, paused),
  plot: (g, _wall, bed: "garden" | "greenhouse", i: number, crop: "radish" | "cabbage" | "potato" | null) =>
    G.cmdPlotPreference(g, bed, i, crop),
  keep: (g, _wall, what: "cans" | "fuel", keep: boolean) => G.cmdKeep(g, what, keep),
  request: (g, _wall, kind: "earlyRest" | "playRecord" | "tea" | "windowSit") => G.cmdRequest(g, kind),
  cancelRequest: (g) => G.cmdCancelRequest(g),
  style: (g, _wall, slot: never, id: string) => G.cmdChooseStyle(g, slot, id),
  // —— 下面是开发调试用的，不是玩法 ——
  debugSkip: (g, _wall, minutes: number) => {
    if (g.mode === "companion") G.advanceCompanionMinutes(g, minutes);
  },
  debugInterrupt: (g, _wall, kind: "sleep" | "gap", ms: number) => G.interrupt(g, kind, ms),
};

export interface Runtime {
  game: G.Game | null;
  leader: boolean;
  /** 最近一次心跳的判定，给调试面板看 */
  lastVerdict: string;
  /** 仅供灰盒界面展示最近一次操作被拒绝的原因，不进入游戏手记。 */
  lastActionError: string;
  dispatch(name: string, ...args: unknown[]): void;
  reset(): void;
  onChange: () => void;
}

function nowBeat(): Beat {
  return { wall: Date.now(), mono: performance.now() };
}

function load(): G.Game | null {
  try {
    const text = localStorage.getItem(SAVE_KEY);
    return text ? deserialize(text).game : null;
  } catch (err) {
    console.error("读存档失败，按新世界开始", err);
    return null;
  }
}

export function startRuntime(): Runtime {
  const channel = new BroadcastChannel(CHANNEL);
  let prev: Beat = nowBeat();
  let remainder = 0;
  let lastSave = 0;
  /** 从窗口记着最近一次收到状态的时刻，接手时从这里接着算 */
  let lastHeard: Beat | null = null;

  const rt: Runtime = {
    game: null,
    leader: false,
    lastVerdict: "",
    lastActionError: "",
    onChange: () => {},
    dispatch(name, ...args) {
      if (!rt.leader) {
        channel.postMessage({ type: "cmd", cmd: { name, args } } satisfies Message);
        return;
      }
      run({ name, args });
    },
    reset() {
      if (!rt.leader) return;
      rt.game = G.newGame((Math.random() * 2 ** 31) | 0);
      prev = nowBeat();
      save(true);
      broadcast();
      rt.onChange();
    },
  };

  function run(cmd: Command): void {
    const g = rt.game;
    const fn = COMMANDS[cmd.name];
    if (!g || !fn) return;
    beat(); // 先把到这一刻为止的时间结清，再执行操作
    const result = (fn as (g: G.Game, wall: number, ...a: unknown[]) => unknown)(g, Date.now(), ...cmd.args);
    rt.lastActionError = result && typeof result === "object" && "ok" in result && !(result as G.Result).ok
      ? (result as G.Result).reason ?? "现在做不了这件事。"
      : "";
    if (rt.lastActionError) console.info(`[${cmd.name}]`, rt.lastActionError);
    save(true);
    broadcast();
    rt.onChange();
  }

  function save(force = false): void {
    if (!rt.leader || !rt.game) return;
    const now = Date.now();
    if (!force && now - lastSave < SAVE_EVERY_MS) return;
    lastSave = now;
    try {
      localStorage.setItem(SAVE_KEY, serialize(rt.game, now));
    } catch (err) {
      console.error("存档失败", err);
    }
  }

  function broadcast(): void {
    if (rt.leader && rt.game) channel.postMessage({ type: "state", text: JSON.stringify(rt.game) } satisfies Message);
  }

  function beat(): void {
    const g = rt.game;
    if (!rt.leader || !g) return;
    const now = nowBeat();
    const verdict = judgeGap(prev, now);
    prev = now;
    rt.lastVerdict = `${verdict.kind}${verdict.gapMs ? ` ${Math.round(verdict.gapMs / 1000)} 秒` : ""}`;
    if (verdict.kind === "running") {
      // 游戏内核只收整数毫秒，零头攒到下一次
      const ms = verdict.verifiedMs + remainder;
      const whole = Math.floor(ms);
      remainder = ms - whole;
      if (whole > 0) G.advance(g, { wall: now.wall, verifiedMs: whole, hidden: document.hidden }, cal);
    } else {
      G.interrupt(g, verdict.kind === "sleep" ? "sleep" : "gap", verdict.gapMs);
      save(true);
    }
  }

  function tick(): void {
    beat();
    save();
    broadcast();
    rt.onChange();
  }

  channel.onmessage = (ev: MessageEvent<Message>) => {
    const msg = ev.data;
    if (msg.type === "state" && !rt.leader) {
      rt.game = JSON.parse(msg.text) as G.Game;
      lastHeard = nowBeat();
      rt.onChange();
    } else if (msg.type === "cmd" && rt.leader) {
      run(msg.cmd);
    } else if (msg.type === "hello" && rt.leader) {
      broadcast();
    }
  };

  function becomeLeader(): void {
    rt.leader = true;
    if (rt.game && lastHeard) {
      // 从前一个主窗口手里接过来：这个窗口一直开着，接着它最后广播的状态走
      prev = lastHeard;
    } else {
      const saved = load();
      if (saved) {
        // 重新打开：离开的时间不补，这一轮专注停在「已暂停」
        G.interrupt(saved, "exit");
        rt.game = saved;
      } else {
        rt.game = G.newGame((Math.random() * 2 ** 31) | 0);
      }
      prev = nowBeat();
    }
    setInterval(tick, BEAT_MS);
    document.addEventListener("visibilitychange", () => {
      tick();
      save(true);
    });
    window.addEventListener("pagehide", () => {
      beat();
      save(true);
    });
    tick();
  }

  if ("locks" in navigator) {
    // 抢到锁的那个窗口当主窗口，一直握着不放；其余的在这里排队
    void navigator.locks.request(LOCK, () => {
      becomeLeader();
      return new Promise<void>(() => {});
    });
    channel.postMessage({ type: "hello" } satisfies Message);
  } else {
    becomeLeader();
  }
  return rt;
}
