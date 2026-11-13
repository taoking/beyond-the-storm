// 一局游戏：世界 + 专注 + 四种世界状态（02 第 1 节）。界面只能通过这里的白名单命令改东西。
import { CONFIG, type Season, type WeatherTier } from "./config.ts";
import { STYLES, zoneOf, type CropDef, type StyleSlot, type TaskCategory } from "./content.ts";
import {
  advanceFocus,
  addTask,
  completeTask,
  createFocus,
  endFocus,
  extendFocus,
  interruptFocus,
  pauseFocus,
  resolveGap,
  resumeFocus,
  setNote,
  startFocus,
  startNextRound,
  unlockedStyleCount,
  type Calendar,
  type FocusEvent,
  type FocusState,
  type StartOptions,
} from "./focus.ts";
import {
  arriveHome,
  checkOuting,
  depart,
  outingMinute,
  REFUSAL_TEXT,
  REMINDER_TEXT,
  takeHomeReminder,
  travel,
  type OutingCheck,
} from "./outing.ts";
import { createWorld, hasEffect, stepMinute } from "./sim.ts";
import { enterForest, moveForest, gatherForest, restForest, returnForest } from "./forest.ts";
import { dayClock, type NewWorldOptions, type RequestKind, type World } from "./state.ts";
import { createTelemetry, sampleTelemetry, type Telemetry } from "./telemetry.ts";

export const SAVE_VERSION = 1;

/** companion 正常陪伴；ambience 独立氛围态；outdoor 户外直控；outdoorFocus 户外临时专注 */
export type Mode = "companion" | "ambience" | "outdoor" | "outdoorFocus";

export interface AmbienceChoice {
  season: Season;
  weather: WeatherTier;
  /** 时段：dawn、day、dusk、night */
  time: "dawn" | "day" | "dusk" | "night";
}

/** 给界面的一行安静的提示：不抢焦点、不用点。不是世界里发生的事，不进手记。 */
export interface Notice {
  id: number;
  wall: number;
  kind: "refusal" | "reminder" | "info";
  text: string;
}

export interface Game {
  version: number;
  world: World;
  focus: FocusState;
  mode: Mode;
  ambience: AmbienceChoice | null;
  /** 户外直控时打开的信息面板：打开时世界暂停（02 第 14.6 条） */
  outdoorPanel: "map" | "pack" | "journal" | null;
  /** 不足一个游戏分钟的零头，单位是「毫秒 × 倍率」，满 60000 进一分钟 */
  carry: number;
  notices: Notice[];
  nextNoticeId: number;
  telemetry: Telemetry;
}

export interface Result {
  ok: boolean;
  reason?: string;
}

const OK: Result = { ok: true };
const no = (reason: string): Result => ({ ok: false, reason });

export function newGame(seed: number, opt: NewWorldOptions = {}): Game {
  return {
    version: SAVE_VERSION,
    world: createWorld(seed, opt),
    focus: createFocus(),
    mode: "companion",
    ambience: null,
    outdoorPanel: null,
    carry: 0,
    notices: [],
    nextNoticeId: 1,
    telemetry: createTelemetry(),
  };
}

function notice(g: Game, wall: number, kind: Notice["kind"], text: string): void {
  g.notices.push({ id: g.nextNoticeId++, wall, kind, text });
  if (g.notices.length > 20) g.notices.splice(0, g.notices.length - 20);
}

export function frozen(g: Game): boolean {
  return g.mode === "ambience" || g.mode === "outdoorFocus";
}

/** 现实 1 分钟走几个游戏分钟。hidden：应用在后台（户外直控这时暂停）。 */
export function worldRate(g: Game, hidden = false): number {
  const R = CONFIG.rates;
  switch (g.mode) {
    case "companion":
      return g.world.actor.asleep ? R.asleep : R.awake;
    case "outdoor":
      return g.outdoorPanel || hidden ? 0 : R.outdoor;
    default:
      return 0;
  }
}

function syncNudge(g: Game): void {
  const s = g.focus.session;
  const active = s && !s.paused;
  g.world.nudge = {
    category: active && s.phase === "focus" ? s.category : null,
    onBreak: !!active && s.phase === "break",
  };
}

function applyFocusEvents(g: Game, events: FocusEvent[]): void {
  for (const e of events) {
    // 每一份留一个小痕迹：他下次手头空下来时往罐里放一颗。不碰柴粮和项目。
    if (e.type === "share") g.world.pendingCones += 1;
  }
}

function afterCollapseOrArrival(g: Game): void {
  if (!g.world.outing && (g.mode === "outdoor" || g.mode === "outdoorFocus")) {
    g.mode = "companion";
    g.outdoorPanel = null;
    g.ambience = null;
  }
}

export interface Heartbeat {
  /** 这一段结束时的墙上钟 */
  wall: number;
  /** 这一段里确认应用在运行的毫秒数 */
  verifiedMs: number;
  /** 应用在后台 */
  hidden?: boolean;
}

/**
 * 把一段确认在运行的现实时间交给游戏。专注和世界各按各的规则走；
 * 世界走多少只看这段时间有多长，和画面刷新了几次无关。
 */
export function advance(g: Game, hb: Heartbeat, cal: Calendar): FocusEvent[] {
  // 直接操控他的时候不算有效专注：防呆，正常流程里出门时已经暂停了
  const running = g.focus.session;
  if (g.mode === "outdoor" && running && running.phase === "focus" && !running.paused) pauseFocus(g.focus, "outdoor");
  const events = advanceFocus(g.focus, hb.wall, hb.verifiedMs, cal, { directControl: g.mode === "outdoor" });
  applyFocusEvents(g, events);
  syncNudge(g);

  // 全用整数算（毫秒 × 倍率，满 60000 进一个游戏分钟）：同样长的一段时间，
  // 不管拆成多少次心跳喂进来，世界走到的地方都一模一样。
  let budget = Math.floor(hb.verifiedMs);
  const w = g.world;
  while (budget > 0) {
    const rate = worldRate(g, hb.hidden);
    if (rate <= 0) break;
    const need = 60_000 - g.carry;
    if (budget * rate < need) {
      g.carry += budget * rate;
      break;
    }
    const used = Math.ceil(need / rate);
    budget -= used;
    const over = used * rate - need;
    stepMinute(w);
    // 多出来不到 1 毫秒的零头留给下一分钟；倍率变了（他睡着或醒来）就不要了
    g.carry = worldRate(g, hb.hidden) === rate ? over : 0;
    if (g.mode === "companion") sampleTelemetry(g.telemetry, w);
    if (w.outing) {
      outingMinute(w);
      const r = takeHomeReminder(w);
      if (r) notice(g, hb.wall, "reminder", REMINDER_TEXT[r]);
      afterCollapseOrArrival(g);
    }
  }
  return events;
}

/** 无头长跑和测试用：按陪伴状态直接走若干游戏分钟，照样采样。 */
export function advanceCompanionMinutes(g: Game, minutes: number): void {
  for (let i = 0; i < minutes; i++) {
    stepMinute(g.world);
    sampleTelemetry(g.telemetry, g.world);
  }
}

/** 应用确认不了自己刚才是否在运行：见 heartbeat.ts。世界不补；专注停在已暂停。 */
export function interrupt(g: Game, kind: "sleep" | "exit" | "gap", gapMs = 0): void {
  interruptFocus(g.focus, kind, gapMs);
  syncNudge(g);
}

// ---------- 专注 ----------

export function cmdStartFocus(g: Game, wall: number, cal: Calendar, opt: StartOptions = {}): Result {
  applyFocusEvents(g, startFocus(g.focus, wall, cal, opt));
  // 在野外打开专注：世界冻结，他停在原地，画面换成空着的木屋
  if (g.mode === "outdoor") {
    g.mode = "outdoorFocus";
    g.outdoorPanel = null;
  }
  syncNudge(g);
  return OK;
}

export function cmdPauseFocus(g: Game): Result {
  pauseFocus(g.focus, "user");
  syncNudge(g);
  return OK;
}

export function cmdResumeFocus(g: Game): Result {
  const s = g.focus.session;
  if (!s) return no("没有在计时");
  // 直接操控他的时候不算有效专注：在野外点继续，等于在野外打开专注
  if (g.mode === "outdoor" && s.phase === "focus") g.mode = "outdoorFocus";
  resumeFocus(g.focus);
  syncNudge(g);
  return OK;
}

export function cmdEndFocus(g: Game, wall: number, cal: Calendar): Result {
  applyFocusEvents(g, endFocus(g.focus, wall, cal));
  syncNudge(g);
  return OK;
}

export function cmdExtendFocus(g: Game, minutes = 5): Result {
  return extendFocus(g.focus, minutes) ? OK : no("现在不能延长");
}

export function cmdNextRound(g: Game, wall: number, cal: Calendar): Result {
  if (!startNextRound(g.focus, wall, cal)) return no("现在不能开始下一轮");
  if (g.mode === "outdoor") g.mode = "outdoorFocus";
  syncNudge(g);
  return OK;
}

export function cmdSetNote(g: Game, recordId: number, note: string): Result {
  return setNote(g.focus, recordId, note) ? OK : no("找不到这条记录");
}

export function cmdResolveGap(g: Game, wall: number, cal: Calendar, count: boolean): Result {
  applyFocusEvents(g, resolveGap(g.focus, wall, cal, count));
  return OK;
}

export function cmdAddTask(g: Game, name: string, category: TaskCategory): Result {
  addTask(g.focus, name, category);
  return OK;
}

export function cmdCompleteTask(g: Game, id: number, wall: number, cal: Calendar): Result {
  return completeTask(g.focus, id, wall, cal) ? OK : no("找不到这个任务");
}

export function cmdSetAutoNext(g: Game, on: boolean): Result {
  g.focus.settings.autoNext = on;
  return OK;
}

// ---------- 四种世界状态 ----------

/** 你选了一个不是「真实的今天」的画面：世界停在这一刻 */
export function cmdEnterAmbience(g: Game, choice: AmbienceChoice): Result {
  if (g.mode === "outdoor") return no("在野外先打开专注，才能换画面");
  if (g.mode === "companion") g.mode = "ambience";
  g.ambience = choice;
  return OK;
}

/** 回到今天：从冻结时的那一刻接着走。攒下的份和样式更换，他之后陆续补做。 */
export function cmdReturnToToday(g: Game): Result {
  if (g.mode === "ambience") {
    g.mode = "companion";
    g.ambience = null;
    return OK;
  }
  if (g.mode === "outdoorFocus") {
    // 人在野外：只把画面换回空着的木屋，世界仍然停着
    g.ambience = null;
    return OK;
  }
  return no("现在就是今天");
}

/** 回到野外：从原地接着走。专注结束不会自动切回去，要你自己点。 */
export function cmdReturnToWild(g: Game): Result {
  if (g.mode !== "outdoorFocus") return no("没有在户外临时专注");
  const s = g.focus.session;
  // 直接操控他的时候不算有效专注：正在跑的专注停下
  if (s && s.phase === "focus" && !s.paused) pauseFocus(g.focus, "outdoor");
  g.mode = "outdoor";
  g.ambience = null;
  syncNudge(g);
  return OK;
}

// ---------- 出门 ----------

export function cmdCheckOuting(g: Game): OutingCheck {
  if (g.mode !== "companion") {
    return { ok: false, reason: g.mode === "ambience" ? undefined : "away", wrapUp: 0, maxRations: 0, maxBundles: 0 };
  }
  return checkOuting(g.world);
}

/** 点门出门。出不了的时候只给一句克制的话，什么都不扣、不叫醒、不快进。 */
export function cmdDepart(g: Game, wall: number, pack: { rations: number; bundles: number }): Result {
  if (g.mode === "ambience") return no("先回到今天");
  if (g.mode !== "companion") return no(REFUSAL_TEXT.away);
  const r = depart(g.world, pack);
  if (!r.ok) {
    const text = REFUSAL_TEXT[r.reason!];
    notice(g, wall, "refusal", text);
    return no(text);
  }
  const s = g.focus.session;
  if (s && s.phase === "focus" && !s.paused) pauseFocus(g.focus, "outdoor");
  g.mode = "outdoor";
  g.carry = 0;
  syncNudge(g);
  return OK;
}

/** 去一个区域：路程是时间往前跳一段 */
export function cmdTravelTo(g: Game, wall: number, areaId: string): Result {
  const w = g.world;
  const area = CONFIG.outing.areas[areaId];
  if (g.mode !== "outdoor" || !w.outing) return no("没有在野外");
  if (g.outdoorPanel) return no("先合上面板");
  if (!area) return no("没有这个地方");
  if (w.outing.area === areaId) return no("已经在这里了");
  const ok = travel(w, Math.max(0, area.travelMinutes - w.outing.minutesFromDoor), "out");
  if (ok && w.outing) w.outing.area = areaId;
  const r = takeHomeReminder(w);
  if (r) notice(g, wall, "reminder", REMINDER_TEXT[r]);
  afterCollapseOrArrival(g);
  return OK;
}

/** 06 v0.4 新松林：先走 20 分钟林道，再进入可直接操控的真实网格。 */
export function cmdEnterForest(g: Game): Result {
  if (g.mode !== "outdoor" || g.outdoorPanel) return no("先回到野外并合上面板。");
  const r=enterForest(g.world);
  afterCollapseOrArrival(g);
  return r;
}
export function cmdForestMove(g: Game, dx: number, dy: number): Result {
  if (g.mode !== "outdoor" || g.outdoorPanel) return no("先合上面板再走。");
  const r=moveForest(g.world,dx,dy);
  afterCollapseOrArrival(g);
  return r;
}
export function cmdForestGather(g: Game, id: string): Result {
  if (g.mode !== "outdoor" || g.outdoorPanel) return no("先合上面板再采集。");
  const r=gatherForest(g.world,id);
  afterCollapseOrArrival(g);
  return r;
}
export function cmdForestRest(g: Game): Result {
  if (g.mode !== "outdoor" || g.outdoorPanel) return no("先合上面板再休息。");
  const r=restForest(g.world);
  afterCollapseOrArrival(g);
  return r;
}
export function cmdForestReturn(g: Game): Result {
  if (g.mode !== "outdoor" || g.outdoorPanel) return no("先合上面板再回家。");
  const r=returnForest(g.world);
  afterCollapseOrArrival(g);
  if(r.ok)g.carry=0;
  return r;
}

/** 旧灰盒的旅途调试命令仍供 v0.3 旧测试使用；真正的松林网格必须从林口返家。 */
export function cmdHeadHome(g: Game): Result {
  const w = g.world;
  if (g.mode !== "outdoor" || !w.outing) return no("没有在野外");
  if (g.outdoorPanel) return no("先合上面板");
  if(w.outing.forest) return no("沿小路走回松林入口，才能回家。");
  w.outing.area = null;
  if (travel(w, w.outing.minutesFromDoor, "home")) arriveHome(w);
  afterCollapseOrArrival(g);
  g.carry = 0;
  return OK;
}

export function cmdOutdoorPanel(g: Game, panel: Game["outdoorPanel"]): Result {
  if (g.mode !== "outdoor") return no("没有在野外");
  g.outdoorPanel = panel;
  return OK;
}

// ---------- 你能表达的意向（02 第 6.4 节） ----------

function intentsOpen(g: Game): Result {
  // 冻结时不和虚构的季节混着改世界里的设施、项目、种植（04 第 19.6 节第 16 条）
  return frozen(g) ? no("世界停着，回到今天再说") : OK;
}

export function cmdPinProject(g: Game, id: string): Result {
  const gate = intentsOpen(g);
  if (!gate.ok) return gate;
  const w = g.world;
  const ps = w.projects[id];
  if (!ps || !ps.known) return no("没有这件事");
  if (w.intents.pinned.includes(id)) return OK;
  if (w.intents.pinned.length >= CONFIG.project.maxPinned) return no("最多置顶 3 件");
  w.intents.pinned.push(id);
  return OK;
}

export function cmdUnpinProject(g: Game, id: string): Result {
  const gate = intentsOpen(g);
  if (!gate.ok) return gate;
  g.world.intents.pinned = g.world.intents.pinned.filter((x) => x !== id);
  return OK;
}

export function cmdPauseProject(g: Game, id: string, paused: boolean): Result {
  const gate = intentsOpen(g);
  if (!gate.ok) return gate;
  const ps = g.world.projects[id];
  if (!ps || !ps.known) return no("没有这件事");
  ps.paused = paused;
  return OK;
}

/** 这一格下一茬想种什么。只管下一茬，不拔正长着的。菜地至少 2 格、暖棚至少 1 格归他定。 */
export function cmdPlotPreference(g: Game, bed: "garden" | "greenhouse", index: number, crop: CropDef["id"] | null): Result {
  const gate = intentsOpen(g);
  if (!gate.ok) return gate;
  const w = g.world;
  const plots = bed === "garden" ? w.plots : w.greenhouse;
  const plot = plots[index];
  if (!plot) return no("没有这一格");
  if (bed === "greenhouse" && !hasEffect(w, "greenhouse")) return no("暖棚还没修好");
  if (crop !== null && plot.preferred === null) {
    const used = plots.filter((p) => p.preferred !== null).length;
    const max = bed === "garden" ? CONFIG.garden.maxPreferredPlots : CONFIG.garden.maxPreferredGreenhouse;
    if (used >= max) return no("其余的格子归他自己定");
  }
  plot.preferred = crop;
  return OK;
}

export function cmdKeep(g: Game, what: "cans" | "fuel", keep: boolean): Result {
  const gate = intentsOpen(g);
  if (!gate.ok) return gate;
  if (what === "cans") g.world.intents.keepCans = keep;
  else g.world.intents.keepFuel = keep;
  return OK;
}

/** 小请求：一次一件，不是命令。他睡着、不在家附近、世界停着时不能说（02 第 14.1 条）。 */
export function cmdRequest(g: Game, kind: RequestKind): Result {
  const gate = intentsOpen(g);
  if (!gate.ok) return gate;
  const w = g.world;
  if (g.mode !== "companion" || w.actor.away) return no("他不在家");
  if (w.actor.asleep) return no("已经歇下了");
  const zone = zoneOf(w.actor.place);
  if (zone !== "indoor" && zone !== "yard") return no("他还在外面");
  if (w.intents.request) return no("已经说了一件");
  if (kind === "earlyRest" && dayClock(w) < CONFIG.calendar.earlyRestFrom) return no("天还早，傍晚再问他吧");
  if (kind === "playRecord" && !hasEffect(w, "gramophone")) return no("唱片机还没修好");
  w.intents.request = { kind, day: w.day };
  return OK;
}

export function cmdCancelRequest(g: Game): Result {
  g.world.intents.request = null;
  return OK;
}

/** 样式拥有情况：默认样式一直有；份解锁的按累计份数 */
export function ownsStyle(g: Game, styleId: string): boolean {
  const idx = STYLES.findIndex((s) => s.id === styleId);
  if (idx < 0) return true; // 开局就有的默认样式
  return idx < unlockedStyleCount(g.focus.shares.total);
}

/**
 * 换样式。灯光、声景立刻生效；实物记成「想换」，他下次手头空了亲手去换。
 * 冻结时也能选（只是预览已拥有的），回到今天以后他再真的去换。
 */
export function cmdChooseStyle(g: Game, slot: StyleSlot, styleId: string): Result {
  if (!ownsStyle(g, styleId)) return no("还没有这件");
  const def = STYLES.find((s) => s.id === styleId);
  if (def && def.slot !== slot) return no("放不到这个位置");
  const w = g.world;
  if (slot === "lamp" || slot === "sound" || slot === "idle") {
    w.styles[slot] = styleId;
    return OK;
  }
  w.intents.styleSwaps = w.intents.styleSwaps.filter((s) => s.slot !== slot);
  if (w.styles[slot] !== styleId) w.intents.styleSwaps.push({ slot, styleId });
  return OK;
}
