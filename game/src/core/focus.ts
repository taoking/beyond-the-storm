// 现实这一侧：专注计时、有效时间、份的结算。规则来自 设计/02_玩法.md 第 2 节和第 3.4 节。
// 这里不读系统时钟：现在几点、这一段有多少毫秒是确认在运行的，都由调用方传进来。
import { CONFIG } from "./config.ts";
import { CATEGORY_NAME, STYLES, type TaskCategory } from "./content.ts";

const S = CONFIG.shares;

/** 本地日历：把墙上钟的毫秒数换成本地日期。测试里换成固定时区的实现。 */
export interface Calendar {
  dateKey(wall: number): string;
  /** 严格晚于 wall 的下一个本地 00:00 */
  nextMidnight(wall: number): number;
}

export const localCalendar: Calendar = {
  dateKey(wall) {
    const d = new Date(wall);
    const p = (n: number): string => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },
  nextMidnight(wall) {
    const d = new Date(wall);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  },
};

/** 固定时区偏移的日历（分钟，东为正）。测试用。 */
export function fixedCalendar(offsetMinutes = 0): Calendar {
  const off = offsetMinutes * 60_000;
  const DAY = 86_400_000;
  return {
    dateKey: (wall) => new Date(Math.floor((wall + off) / DAY) * DAY).toISOString().slice(0, 10),
    nextMidnight: (wall) => (Math.floor((wall + off) / DAY) + 1) * DAY - off,
  };
}

export type FocusPreset = { kind: "countdown"; focusMin: number; breakMin: number } | { kind: "countup" };
export type FocusPhase = "focus" | "break" | "awaitNext";
/** user 你暂停的；sleep 休眠后回来；exit 关机或退出后回来；gap 确认不了的断档；outdoor 出门前暂停的 */
export type PauseReason = "user" | "sleep" | "exit" | "gap" | "outdoor";

export interface FocusRound {
  recordId: number;
  startedWall: number;
  effectiveMs: number;
  shares: number;
  unlocked: string[];
}

export interface FocusSession {
  preset: FocusPreset;
  taskId: number | null;
  category: TaskCategory;
  phase: FocusPhase;
  paused: PauseReason | null;
  /** 这个阶段已经走了多少（专注阶段只算有效时间） */
  phaseMs: number;
  /** 这个阶段的目标；正向计时是 null */
  targetMs: number | null;
  round: FocusRound;
  /** 确认不了的断档，等你选「算进去 / 不算」 */
  pendingGapMs: number;
}

export interface FocusRecord {
  id: number;
  startedWall: number;
  /** 记在开始的那天 */
  date: string;
  taskId: number | null;
  category: TaskCategory;
  effectiveMs: number;
  /** 其中手动确认的部分 */
  manualMs: number;
  shares: number;
  note: string;
}

export interface Task {
  id: number;
  name: string;
  category: TaskCategory;
  done: boolean;
  totalMs: number;
}

export interface Spine {
  category: TaskCategory;
  date: string;
  /** 默认不显示；设置里打开才显示 */
  taskName: string | null;
}

export interface RealJournalEntry {
  wall: number;
  date: string;
  type: "share" | "unlock" | "milestone" | "manual" | "spine";
  text: string;
}

/** 一轮结束时那一行小结（04 第 19.2 节）：只写这一轮真实发生的 */
export interface RoundSummary {
  wall: number;
  minutes: number;
  shares: number;
  unlocked: string[];
}

export interface FocusState {
  session: FocusSession | null;
  settings: {
    autoNext: boolean;
    preset: FocusPreset;
    taskId: number | null;
    category: TaskCategory;
    /** 专注/休息结束时的系统通知，默认关（04 第 19.2 节 A7） */
    notify: boolean;
  };
  shares: {
    lastGrantWall: number | null;
    /** 上次得份以后累计的有效专注 */
    sinceGrantMs: number;
    /** 本地日期 → 这天已得几份。存成表，时钟回拨也不会多给 */
    byDate: Record<string, number>;
    total: number;
  };
  records: FocusRecord[];
  nextRecordId: number;
  tasks: Task[];
  nextTaskId: number;
  stats: {
    msByDate: Record<string, number>;
    msByCategory: Record<TaskCategory, number>;
    /** 没挂任务的专注，按类别攒着换书脊 */
    untaskedMs: Record<TaskCategory, number>;
    totalMs: number;
    /** 满 10 分钟的专注次数 */
    rounds: number;
  };
  milestones: { hours: number; rounds: number; days: number };
  spines: Spine[];
  journal: RealJournalEntry[];
  lastSummary: RoundSummary | null;
}

export type FocusEvent =
  | { type: "share"; wall: number; date: string; total: number; unlocked: string | null; manual: boolean }
  | { type: "focusEnded"; wall: number; summary: RoundSummary; toBreak: boolean }
  | { type: "breakEnded"; wall: number; autoStarted: boolean };

const zeroByCategory = (): Record<TaskCategory, number> => ({ study: 0, code: 0, write: 0, other: 0 });

export function createFocus(): FocusState {
  return {
    session: null,
    settings: { autoNext: false, preset: { kind: "countdown", focusMin: 25, breakMin: 5 }, taskId: null, category: "study", notify: false },
    shares: { lastGrantWall: null, sinceGrantMs: 0, byDate: {}, total: 0 },
    records: [],
    nextRecordId: 1,
    tasks: [],
    nextTaskId: 1,
    stats: { msByDate: {}, msByCategory: zeroByCategory(), untaskedMs: zeroByCategory(), totalMs: 0, rounds: 0 },
    milestones: { hours: 0, rounds: 0, days: 0 },
    spines: [],
    journal: [],
    lastSummary: null,
  };
}

// ---------- 份 ----------

export function sharesToday(fs: FocusState, wall: number, cal: Calendar): number {
  return fs.shares.byDate[cal.dateKey(wall)] ?? 0;
}

/** 已经解锁了几件样式（只算首版开放的那几件） */
export function unlockedStyleCount(total: number): number {
  let n = 0;
  for (let i = 0; i < S.stylesEnabled; i++) if (total >= S.styleThresholds[i]) n += 1;
  return n;
}

/**
 * 条件都满足就发一份（02 第 2.4 节）。「当前正在有效专注」由调用方保证；
 * 手动确认断档时 manual 为 true。
 */
function tryGrant(fs: FocusState, wall: number, cal: Calendar, events: FocusEvent[], manual = false): boolean {
  const sh = fs.shares;
  const date = cal.dateKey(wall);
  if ((sh.byDate[date] ?? 0) >= S.perDay) return false;
  if (sh.lastGrantWall !== null && wall - sh.lastGrantWall < S.cooldownMs) return false;
  if (sh.sinceGrantMs < S.minEffectiveMs) return false;
  sh.byDate[date] = (sh.byDate[date] ?? 0) + 1;
  sh.lastGrantWall = wall;
  sh.sinceGrantMs = 0;
  sh.total += 1;
  let unlocked: string | null = null;
  const idx = S.styleThresholds.indexOf(sh.total);
  if (idx >= 0 && idx < S.stylesEnabled) unlocked = STYLES[idx].id;
  fs.journal.push({ wall, date, type: "share", text: manual ? "得一份（手动确认的时间）" : "得一份" });
  if (unlocked) {
    fs.journal.push({ wall, date, type: "unlock", text: `新样式：${STYLES[idx].name}` });
  }
  const s = fs.session;
  if (s) {
    s.round.shares += 1;
    if (unlocked) s.round.unlocked.push(unlocked);
    const rec = fs.records.find((r) => r.id === s.round.recordId);
    if (rec) rec.shares += 1;
  }
  events.push({ type: "share", wall, date, total: sh.total, unlocked, manual });
  return true;
}

// ---------- 记有效时间 ----------

function addEffective(fs: FocusState, ms: number, date: string, manual = false): void {
  const s = fs.session!;
  const st = fs.stats;
  s.round.effectiveMs += ms;
  fs.shares.sinceGrantMs += ms;
  st.msByDate[date] = (st.msByDate[date] ?? 0) + ms;
  st.msByCategory[s.category] += ms;
  st.totalMs += ms;
  const rec = fs.records.find((r) => r.id === s.round.recordId);
  if (rec) {
    rec.effectiveMs += ms;
    if (manual) rec.manualMs += ms;
  }
  const task = s.taskId === null ? null : fs.tasks.find((t) => t.id === s.taskId);
  if (task) task.totalMs += ms;
  else {
    // 没挂任务的专注，按类别每攒满 10 小时多一本书脊
    st.untaskedMs[s.category] += ms;
    const per = CONFIG.milestones.spineHoursPerCategory * 3_600_000;
    while (st.untaskedMs[s.category] >= per) {
      st.untaskedMs[s.category] -= per;
      addSpine(fs, s.category, date, null, 0);
    }
  }
}

function addSpine(fs: FocusState, category: TaskCategory, date: string, taskName: string | null, wall: number): void {
  fs.spines.push({ category, date, taskName });
  fs.journal.push({ wall, date, type: "spine", text: `你的那一格多了一本${CATEGORY_NAME[category]}的书脊` });
}

function checkMilestones(fs: FocusState, wall: number, date: string): void {
  const M = CONFIG.milestones;
  const reach = (list: number[], value: number, have: number): number => {
    let n = have;
    while (n < list.length && value >= list[n]) n += 1;
    return n;
  };
  const m = fs.milestones;
  const hours = reach(M.hours, fs.stats.totalMs / 3_600_000, m.hours);
  for (let i = m.hours; i < hours; i++) fs.journal.push({ wall, date, type: "milestone", text: `累计专注 ${M.hours[i]} 小时` });
  m.hours = hours;
  const rounds = reach(M.sessions, fs.stats.rounds, m.rounds);
  for (let i = m.rounds; i < rounds; i++) fs.journal.push({ wall, date, type: "milestone", text: `累计专注 ${M.sessions[i]} 次` });
  m.rounds = rounds;
  const dayCount = Object.values(fs.stats.msByDate).filter((v) => v > 0).length;
  const days = reach(M.days, dayCount, m.days);
  for (let i = m.days; i < days; i++) fs.journal.push({ wall, date, type: "milestone", text: `有过专注的日子满 ${M.days[i]} 天` });
  m.days = days;
}

// ---------- 轮次 ----------

function beginRound(fs: FocusState, wall: number, cal: Calendar): void {
  const s = fs.session!;
  const id = fs.nextRecordId++;
  fs.records.push({
    id,
    startedWall: wall,
    date: cal.dateKey(wall),
    taskId: s.taskId,
    category: s.category,
    effectiveMs: 0,
    manualMs: 0,
    shares: 0,
    note: "",
  });
  s.phase = "focus";
  s.phaseMs = 0;
  s.targetMs = s.preset.kind === "countdown" ? s.preset.focusMin * 60_000 : null;
  s.round = { recordId: id, startedWall: wall, effectiveMs: 0, shares: 0, unlocked: [] };
}

/** 一轮专注收尾：记次数、看成就、出那一行小结 */
function closeRound(fs: FocusState, wall: number, cal: Calendar): RoundSummary {
  const s = fs.session!;
  const r = s.round;
  if (r.effectiveMs >= S.minEffectiveMs) fs.stats.rounds += 1;
  checkMilestones(fs, wall, cal.dateKey(wall));
  if (r.effectiveMs <= 0) fs.records = fs.records.filter((rec) => rec.id !== r.recordId);
  const summary: RoundSummary = {
    wall,
    minutes: Math.round(r.effectiveMs / 60_000),
    shares: r.shares,
    unlocked: [...r.unlocked],
  };
  fs.lastSummary = summary;
  return summary;
}

export interface AdvanceOptions {
  /** 你正在野外直接操控他：这时休息结束不会自动接下一轮（02 第 1 节） */
  directControl?: boolean;
}

/**
 * 把一段确认在运行的现实时间记进专注。wall 是这段结束时的墙上钟，ms 是这段的长度。
 * 这段里会在准确的时刻换阶段、过午夜、发份，和调用得多密无关。
 */
export function advanceFocus(fs: FocusState, wall: number, ms: number, cal: Calendar, opt: AdvanceOptions = {}): FocusEvent[] {
  const events: FocusEvent[] = [];
  const sh = fs.shares;
  // 时钟被往回拨了：冷却从这一刻重新计
  if (sh.lastGrantWall !== null && wall < sh.lastGrantWall) sh.lastGrantWall = wall;
  let now = wall - ms;
  let left = ms;
  while (left > 0) {
    const s = fs.session;
    if (!s || s.paused || s.phase === "awaitNext") break;
    // 冷却早就到点、只是当时在休息或暂停：一进入有效专注就结算
    if (s.phase === "focus") tryGrant(fs, now, cal, events);
    let chunk = Math.min(left, cal.nextMidnight(now) - now);
    if (s.targetMs !== null) chunk = Math.min(chunk, s.targetMs - s.phaseMs);
    if (s.phase === "focus") {
      // 在冷却到点、攒满 10 分钟的那一刻停一下，份发在准确的时刻
      if (sh.lastGrantWall !== null) {
        const cool = sh.lastGrantWall + S.cooldownMs - now;
        if (cool > 0) chunk = Math.min(chunk, cool);
      }
      const need = S.minEffectiveMs - sh.sinceGrantMs;
      if (need > 0) chunk = Math.min(chunk, need);
    }
    chunk = Math.max(chunk, 0);
    if (s.phase === "focus" && chunk > 0) addEffective(fs, chunk, cal.dateKey(now));
    s.phaseMs += chunk;
    now += chunk;
    left -= chunk;
    const phaseDone = s.targetMs !== null && s.phaseMs >= s.targetMs;
    // 这一轮正好走完的那一刻已经不在专注里了：份等下一段有效专注再结算
    if (s.phase === "focus" && !phaseDone) tryGrant(fs, now, cal, events);
    if (phaseDone) {
      if (s.phase === "focus") {
        const summary = closeRound(fs, now, cal);
        const breakMin = s.preset.kind === "countdown" ? s.preset.breakMin : 0;
        if (breakMin > 0) {
          s.phase = "break";
          s.phaseMs = 0;
          s.targetMs = breakMin * 60_000;
        } else {
          s.phase = "awaitNext";
          s.targetMs = null;
        }
        events.push({ type: "focusEnded", wall: now, summary, toBreak: breakMin > 0 });
        if (breakMin <= 0 && fs.settings.autoNext && !opt.directControl) beginRound(fs, now, cal);
      } else {
        const auto = fs.settings.autoNext && !opt.directControl;
        if (auto) beginRound(fs, now, cal);
        else {
          s.phase = "awaitNext";
          s.targetMs = null;
        }
        events.push({ type: "breakEnded", wall: now, autoStarted: auto });
      }
    } else if (chunk === 0) {
      break; // 防呆：不该走到这里
    }
  }
  return events;
}

// ---------- 你的操作 ----------

export interface StartOptions {
  preset?: FocusPreset;
  taskId?: number | null;
  category?: TaskCategory;
}

/** 开始专注。不选任务也行，沿用上次的类别和时长。 */
export function startFocus(fs: FocusState, wall: number, cal: Calendar, opt: StartOptions = {}): FocusEvent[] {
  const events = fs.session ? endFocus(fs, wall, cal) : [];
  const st = fs.settings;
  if (opt.preset) st.preset = opt.preset;
  if (opt.taskId !== undefined) st.taskId = opt.taskId;
  const task = st.taskId === null ? null : fs.tasks.find((t) => t.id === st.taskId && !t.done);
  if (!task) st.taskId = null;
  st.category = task ? task.category : (opt.category ?? st.category);
  fs.session = {
    preset: st.preset,
    taskId: st.taskId,
    category: st.category,
    phase: "focus",
    paused: null,
    phaseMs: 0,
    targetMs: null,
    round: { recordId: 0, startedWall: wall, effectiveMs: 0, shares: 0, unlocked: [] },
    pendingGapMs: 0,
  };
  beginRound(fs, wall, cal);
  fs.lastSummary = null;
  return events;
}

export function pauseFocus(fs: FocusState, reason: PauseReason = "user"): void {
  const s = fs.session;
  if (!s || s.paused || s.phase === "awaitNext") return;
  s.paused = reason;
}

/** 继续。断档的选择没做就继续，按不算（04 第 19.6 节第 4 条）。 */
export function resumeFocus(fs: FocusState): void {
  const s = fs.session;
  if (!s || !s.paused) return;
  s.paused = null;
  s.pendingGapMs = 0;
}

/** 提前结束（或结束休息、结束等待）：保留已有的分钟，不问「确定吗」 */
export function endFocus(fs: FocusState, wall: number, cal: Calendar): FocusEvent[] {
  const s = fs.session;
  if (!s) return [];
  const events: FocusEvent[] = [];
  if (s.phase === "focus") {
    const summary = closeRound(fs, wall, cal);
    events.push({ type: "focusEnded", wall, summary, toBreak: false });
  }
  fs.session = null;
  return events;
}

/** 延长这一轮（只有倒计时的专注阶段可以） */
export function extendFocus(fs: FocusState, minutes = 5): boolean {
  const s = fs.session;
  if (!s || s.phase !== "focus" || s.targetMs === null) return false;
  s.targetMs += minutes * 60_000;
  return true;
}

/** 跳过休息，或者在「准备好了就开始」时开始下一轮 */
export function startNextRound(fs: FocusState, wall: number, cal: Calendar): boolean {
  const s = fs.session;
  if (!s || s.phase === "focus") return false;
  s.paused = null;
  s.pendingGapMs = 0;
  beginRound(fs, wall, cal);
  fs.lastSummary = null;
  return true;
}

export function setNote(fs: FocusState, recordId: number, note: string): boolean {
  const rec = fs.records.find((r) => r.id === recordId);
  if (!rec) return false;
  rec.note = note.trim().slice(0, 200);
  return true;
}

/**
 * 应用确认不了自己刚才是不是一直在运行（02 第 3.4 节）。
 * sleep、exit 是明确的：这一轮停在「已暂停」，不给选择。gap 是确认不了的断档：停在「已暂停」，等你选。
 */
export function interruptFocus(fs: FocusState, kind: "sleep" | "exit" | "gap", gapMs = 0): void {
  const s = fs.session;
  if (!s || s.phase === "awaitNext") return;
  if (s.paused) {
    // 本来就停着：只把明确的原因盖过去，不凭空生出一段待确认的时间
    if (kind !== "gap" && s.paused === "gap") {
      s.paused = kind;
      s.pendingGapMs = 0;
    }
    return;
  }
  s.paused = kind;
  s.pendingGapMs = kind === "gap" && s.phase === "focus" ? Math.max(0, gapMs) : 0;
}

/**
 * 「刚才那 N 分钟算进去 / 不算」。算进去也只按规则结算，这一段最多补发 1 份，
 * 手记里标明是手动确认的时间。专注仍停在「已暂停」，由你点继续或结束。
 */
export function resolveGap(fs: FocusState, wall: number, cal: Calendar, count: boolean): FocusEvent[] {
  const s = fs.session;
  const events: FocusEvent[] = [];
  if (!s || s.pendingGapMs <= 0) return events;
  let ms = s.pendingGapMs;
  s.pendingGapMs = 0;
  s.paused = "user";
  if (!count || s.phase !== "focus") return events;
  if (s.targetMs !== null) ms = Math.min(ms, Math.max(0, s.targetMs - s.phaseMs));
  if (ms <= 0) return events;
  const date = cal.dateKey(wall);
  addEffective(fs, ms, date, true);
  s.phaseMs += ms;
  fs.journal.push({ wall, date, type: "manual", text: `手动确认了 ${Math.round(ms / 60_000)} 分钟` });
  tryGrant(fs, wall, cal, events, true);
  return events;
}

// ---------- 任务 ----------

export function addTask(fs: FocusState, name: string, category: TaskCategory): Task {
  const task: Task = { id: fs.nextTaskId++, name: name.trim().slice(0, 80) || "未命名", category, done: false, totalMs: 0 };
  fs.tasks.push(task);
  return task;
}

/** 任务要你自己勾。勾完一个，书架上你的那一格多一本书脊。 */
export function completeTask(fs: FocusState, id: number, wall: number, cal: Calendar): boolean {
  const task = fs.tasks.find((t) => t.id === id);
  if (!task || task.done) return false;
  task.done = true;
  if (fs.settings.taskId === id) fs.settings.taskId = null;
  addSpine(fs, task.category, cal.dateKey(wall), task.name, wall);
  return true;
}

// ---------- 专注条的八种状态（04 第 19.6 节第 1 条） ----------

export type FocusBarState =
  | "idle"
  | "focusing"
  | "countup"
  | "break"
  | "awaitNext"
  | "pausedByUser"
  | "pausedAfterSleep"
  | "pausedAfterGap";

export function focusBarState(fs: FocusState): FocusBarState {
  const s = fs.session;
  if (!s) return "idle";
  if (s.paused) {
    if (s.pendingGapMs > 0) return "pausedAfterGap";
    return s.paused === "sleep" || s.paused === "exit" ? "pausedAfterSleep" : "pausedByUser";
  }
  if (s.phase === "break") return "break";
  if (s.phase === "awaitNext") return "awaitNext";
  return s.targetMs === null ? "countup" : "focusing";
}
