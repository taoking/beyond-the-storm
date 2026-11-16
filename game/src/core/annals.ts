// 年册和统计页：只读的汇总（02 第 2.7、11 节，03 第 4.3、13 节，04 第 8 节）。
// 这里的函数都不改世界和专注的状态；唯一写的是 noteWorldYear，记下每个世界年开始时的墙上钟，
// 好让年册的现实一栏知道「这一年」对应哪一段现实时间。它不碰规则、不抽随机数。
import { SEASON_NAME, seasonOf } from "./calendar.ts";
import { CONFIG, type YearKind } from "./config.ts";
import { AREA_BY_ID, CATEGORY_NAME, type TaskCategory } from "./content.ts";
import type { Calendar, FocusState, Spine } from "./focus.ts";
import type { Game } from "./game.ts";
import type { World, YearPage } from "./state.ts";
import { firstSightsLine } from "./windowEvents.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;

// ---------- 世界年开始的墙上钟 ----------

/**
 * 世界走进新的一年时记下墙上钟。game.ts 在每次心跳和每个野外动作之后调用。
 * 一次跳过好几年（只有开发用的快进会这样）时，中间那几年的现实时间是空的一段。
 * 一张白纸的记录却已经不在第一年（老存档、测试直接推世界）：之前那几年记成不知道。
 */
export function noteWorldYear(g: Game, wall: number): void {
  const year = seasonOf(g.world.day).year;
  const walls = (g.yearWalls ??= {});
  if (year in walls) return;
  const empty = Object.keys(walls).length === 0;
  for (let y = year - 1; y >= 0 && !(y in walls); y--) walls[y] = empty ? null : wall;
  walls[year] = wall;
}

// ---------- 数字和用词 ----------

const DIGIT = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 一到九十九写成汉字，再大的照写阿拉伯数字。counting 为真时「二」写成「两」（两次、两天） */
export function cnNumber(n: number, counting = true): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) return String(n);
  if (n === 2 && counting) return "两";
  if (n < 10) return DIGIT[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${tens === 1 ? "" : DIGIT[tens]}十${ones ? DIGIT[ones] : ""}`;
}

/** 「A」「A和B」「A、B和C」 */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join("、")}和${names[names.length - 1]}`;
}

/** 几小时几分；不到一小时写「几分钟」 */
export function durationText(ms: number): string {
  const m = Math.floor(ms / MIN);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} 小时 ${m % 60} 分` : `${h} 小时`;
}

/** 03 第 10.2 节「年册上的名字」 */
export const YEAR_KIND_NAME: Record<YearKind, string> = {
  plain: "平常的一年",
  snowy: "多雪的一年",
  warm: "少雪的一年",
  lateSpring: "春天来得晚的一年",
  earlyFrost: "霜下得早的一年",
};

/** 下的是雪的天气（03 第 10.1 节的说法里带雪的三种） */
const SNOW_LOOKS = new Set(["小雪", "大雪", "暴风雪"]);

// ---------- 年册 ----------

export interface YearbookPage {
  /** 第几个世界年，从 0 起 */
  year: number;
  /** 「第二年 · 多雪的一年」 */
  title: string;
  /** 世界这一栏：这一年真实发生的事，一句一行 */
  world: string[];
  /** 现实这一栏：这一年对应的那段现实时间里的专注。和世界一栏分开，不写成一个故事 */
  real: {
    /** 这一年开始或结束的墙上钟不知道（老存档） */
    known: boolean;
    from: string | null;
    to: string | null;
    focusMs: number;
    shares: number;
    tasks: string[];
    lines: string[];
  };
}

export interface Yearbook {
  /** 过完的年，早的在前 */
  pages: YearbookPage[];
  /** 还在过的这一年：只有一句，不提前写这一页 */
  current: { year: number; text: string };
}

function seasonDayText(dayInYear: number): string {
  const info = seasonOf(dayInYear);
  return `${SEASON_NAME[info.season]}天第 ${info.dayInSeason + 1} 天`;
}

/**
 * 初雪和最后一场雪。一年从入冬算起，所以「最后一场雪」是春夏里的最后一场（冬天过去以后），
 * 「初雪」是秋天里的第一场（03 第 13 节的例子：初雪在秋天第 9 天，最后一场雪在夏天第 4 天）。
 * 从每日小结的天气取，小结是永久留着的。
 */
function snowLine(w: World, year: number): string {
  const yd = CONFIG.calendar.yearDays;
  const snowy = w.summaries
    .filter((s) => Math.floor(s.day / yd) === year && SNOW_LOOKS.has(s.look))
    .map((s) => s.day - year * yd)
    .sort((a, b) => a - b);
  const seasonOfDay = (d: number) => seasonOf(d).season;
  const firstAutumn = snowy.find((d) => seasonOfDay(d) === "autumn");
  const warmPart = snowy.filter((d) => seasonOfDay(d) === "spring" || seasonOfDay(d) === "summer");
  const winterPart = snowy.filter((d) => seasonOfDay(d) === "winter");
  const last = warmPart.length ? warmPart[warmPart.length - 1] : winterPart[winterPart.length - 1];
  const parts = [
    firstAutumn === undefined ? "秋天没有下雪" : `初雪在${seasonDayText(firstAutumn)}`,
    last === undefined ? "" : `最后一场雪在${seasonDayText(last)}`,
  ].filter(Boolean);
  return `${parts.join("，")}。`;
}

function worldLines(w: World, p: YearPage): string[] {
  const lines: string[] = [];
  const blizzard =
    p.longestBlizzard <= 0
      ? "这一年没有刮暴风雪。"
      : p.longestBlizzard === 1
        ? "最长的一场暴风雪刮了一天。"
        : `最长的一场暴风雪连着${cnNumber(p.longestBlizzard)}天。`;
  lines.push(snowLine(w, p.year) + blizzard);

  const life: string[] = [];
  if (p.repairsDone.length) life.push(`修好了：${p.repairsDone.join("、")}。`);
  if (p.harvests > 0) life.push(`菜地收了${cnNumber(p.harvests)}茬。`);
  const visits = Object.entries(p.visits ?? {}).filter(([, n]) => n > 0);
  if (visits.length) {
    life.push(`去了${visits.map(([id, n]) => `${AREA_BY_ID[id]?.name ?? id}${cnNumber(n)}次`).join("，")}。`);
  } else if (p.outings > 0) {
    life.push(`出了${cnNumber(p.outings)}趟门。`);
  }
  if (life.length) lines.push(life.join(""));

  lines.push(p.thriftDays > 0 ? `有${cnNumber(p.thriftDays)}天过得俭。` : "这一年没有过得俭的日子。");
  // 第一次看到的窗外小事（03 第 10.4 节）：只记他真看见了的，这一年没有就不写
  const sights = firstSightsLine(p.firstSights);
  if (sights) lines.push(sights);
  return lines;
}

function realColumn(g: Game, year: number, cal: Calendar): YearbookPage["real"] {
  const start = g.yearWalls?.[year] ?? null;
  const end = g.yearWalls?.[year + 1] ?? null;
  if (start === null || end === null) {
    return { known: false, from: null, to: null, focusMs: 0, shares: 0, tasks: [], lines: ["这一年开始时还没有对照现实时间。"] };
  }
  const fs = g.focus;
  // 第一年从开局算起：第一下心跳之前就开始的专注也归它
  const lower = year === 0 ? -Infinity : start;
  const within = (wall: number): boolean => wall >= lower && wall < end;
  // 一次专注记在开始的那一刻（02 第 2.4 节：跨午夜的专注记在开始的那天）
  const focusMs = fs.records.filter((r) => within(r.startedWall)).reduce((a, r) => a + r.effectiveMs, 0);
  const shares = fs.journal.filter((j) => j.type === "share" && within(j.wall)).length;
  const tasks = fs.tasks.filter((t) => t.done && t.doneWall !== undefined && within(t.doneWall)).map((t) => t.name);
  const from = cal.dateKey(start);
  const to = cal.dateKey(Math.max(start, end - 1));
  const lines = [from === to ? `现实里是 ${from} 这一天。` : `现实里是 ${from} 到 ${to}。`];
  lines.push(focusMs > 0 || shares > 0 ? `专注了 ${durationText(focusMs)}，得了 ${shares} 份。` : "这段时间里没有专注的记录。");
  if (tasks.length) lines.push(`勾完了：${tasks.join("、")}。`);
  return { known: true, from, to, focusMs, shares, tasks, lines };
}

export function yearTitle(year: number, kind: YearKind): string {
  return `第${cnNumber(year + 1, false)}年 · ${YEAR_KIND_NAME[kind]}`;
}

/** 世界年册：只有真实过完的年才有一页（04 第 8.1 节「当世界年真实结束后汇总」） */
export function yearbook(g: Game, cal: Calendar): Yearbook {
  const w = g.world;
  const pages = w.yearbook.map((p) => ({
    year: p.year,
    title: yearTitle(p.year, p.kind),
    world: worldLines(w, p),
    real: realColumn(g, p.year, cal),
  }));
  const info = seasonOf(w.day);
  return {
    pages,
    current: {
      year: info.year,
      text: `第${cnNumber(info.year + 1, false)}年还在过，今天是${seasonDayText(info.dayInYear)}。过完这一年，这里多一页。`,
    },
  };
}

// ---------- 统计页 ----------

export interface FocusTotals {
  ms: number;
  /** 满 10 分钟的专注次数（02 第 2.7 节「累计次数」的口径） */
  rounds: number;
  shares: number;
}

export interface FocusStats {
  today: FocusTotals & { date: string };
  /** 本周：周一到周日 */
  week: FocusTotals & { from: string; to: string; days: { date: string; ms: number }[] };
  /** 按类别，从开始用起 */
  byCategory: (FocusTotals & { category: TaskCategory; name: string })[];
  /** 按任务，从开始用起；不挂任务的专注不在这里，只在类别里 */
  byTask: { id: number; name: string; done: boolean; ms: number; rounds: number }[];
  total: FocusTotals & { focusDays: number };
  /** 到过的档，只列到过的，不提下一档还差多少 */
  milestones: { hours: number[]; rounds: number[]; days: number[] };
  /** 03 第 4.3 节累计时长留下的东西 */
  keepsakes: string[];
  /** 书架上你的那一格：最近 12 本；更早的收进了纪念册 */
  spines: { shelf: Spine[]; archived: number };
}

/** "2026-11-16" 这一周的周一到周日。只拿日期串算，不经过时区 */
export function weekKeys(dateKey: string): string[] {
  const [y, m, d] = dateKey.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  const monday = base - ((new Date(base).getUTCDay() + 6) % 7) * 86_400_000;
  return Array.from({ length: 7 }, (_, i) => new Date(monday + i * 86_400_000).toISOString().slice(0, 10));
}

/** 03 第 4.3 节：1 小时一张便签，10 小时一枚书签，100 小时一本纪念册（之后每到一档贴一页），1000 小时换硬皮 */
function keepsakes(fs: FocusState): string[] {
  const hours = fs.stats.totalMs / HOUR;
  const out: string[] = [];
  if (hours >= 1) out.push("现实手记第一页夹着一张便签。");
  if (hours >= 10) out.push("你的那一格里有一枚书签。");
  if (hours >= 100) {
    const pages = CONFIG.milestones.hours.filter((h) => h > 100 && hours >= h).length;
    out.push(`那一格里有一本纪念册${pages ? `，贴了${cnNumber(pages)}页` : ""}。`);
  }
  if (hours >= 1000) out.push("纪念册换成了硬皮封面。");
  return out;
}

export function focusStats(fs: FocusState, wall: number, cal: Calendar): FocusStats {
  const min = CONFIG.shares.minEffectiveMs;
  const counted = fs.records.filter((r) => r.effectiveMs >= min);
  const today = cal.dateKey(wall);
  const week = weekKeys(today);
  const inWeek = new Set(week);
  const msOn = (d: string): number => fs.stats.msByDate[d] ?? 0;
  const sharesOn = (d: string): number => fs.shares.byDate[d] ?? 0;

  const byCategory = (Object.keys(CATEGORY_NAME) as TaskCategory[]).map((c) => {
    const rs = fs.records.filter((r) => r.category === c);
    return {
      category: c,
      name: CATEGORY_NAME[c],
      ms: fs.stats.msByCategory[c] ?? 0,
      rounds: rs.filter((r) => r.effectiveMs >= min).length,
      shares: rs.reduce((a, r) => a + r.shares, 0),
    };
  });
  const byTask = fs.tasks.map((t) => ({
    id: t.id,
    name: t.name,
    done: t.done,
    ms: t.totalMs,
    rounds: counted.filter((r) => r.taskId === t.id).length,
  }));
  const M = CONFIG.milestones;
  const slots = M.spineSlots;
  return {
    today: { date: today, ms: msOn(today), rounds: counted.filter((r) => r.date === today).length, shares: sharesOn(today) },
    week: {
      from: week[0],
      to: week[6],
      days: week.map((d) => ({ date: d, ms: msOn(d) })),
      ms: week.reduce((a, d) => a + msOn(d), 0),
      rounds: counted.filter((r) => inWeek.has(r.date)).length,
      shares: week.reduce((a, d) => a + sharesOn(d), 0),
    },
    byCategory,
    byTask,
    total: {
      ms: fs.stats.totalMs,
      rounds: fs.stats.rounds,
      shares: fs.shares.total,
      focusDays: Object.values(fs.stats.msByDate).filter((v) => v > 0).length,
    },
    milestones: {
      hours: M.hours.slice(0, fs.milestones.hours),
      rounds: M.sessions.slice(0, fs.milestones.rounds),
      days: M.days.slice(0, fs.milestones.days),
    },
    keepsakes: keepsakes(fs),
    spines: { shelf: fs.spines.slice(-slots), archived: Math.max(0, fs.spines.length - slots) },
  };
}
