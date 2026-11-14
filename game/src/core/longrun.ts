// 长跑的统计口径，工具和测试共用。只读世界状态，不改规则。
import { CONFIG, type LifeTier } from "./config.ts";
import { AREA_BY_ID, PROJECTS } from "./content.ts";
import { checkOuting, depart } from "./outing.ts";
import { createWorld, stepMinute } from "./sim.ts";
import { dayClock, type NewWorldOptions, type World } from "./state.ts";
import { runWild, wildView } from "./wild.ts";

export interface LongRunCase {
  id: string;
  title: string;
  years?: number;
  world?: NewWorldOptions;
  /** 开局就算修好的项目 */
  done?: string[];
  /** 不让他做项目（对照「一件修缮都不做」） */
  noProjects?: boolean;
  /** 每隔几天带他去一趟松林（固定的出门策略，见 outingTrip） */
  outingEveryDays?: number;
}

const BASE = ["windowGaps", "woodshed", "cellar", "fence"];

export const CASES: LongRunCase[] = [
  { id: "bare", title: "开局，没有修缮，也不做项目", noProjects: true },
  { id: "base", title: "基础修缮全修好（补窗缝、柴棚、地窖、篱笆），不做别的项目", done: BASE, noProjects: true },
  { id: "full", title: "再加暖棚、床褥窗帘", done: [...BASE, "greenhouse", "bedding"], noProjects: true },
  { id: "natural", title: "照他自己的习惯做项目（实际玩法）" },
  { id: "natural1", title: "只看头一个世界年：照他自己的习惯做项目", years: 1 },
  { id: "snowy", title: "压力：连着风雪年，没有修缮", world: { forceYearKind: "snowy" }, noProjects: true },
  { id: "zero", title: "压力：入冬第一天柴粮都是零、炉膛是空的", years: 2, world: { wood: 0, food: 0, coldHearth: true }, noProjects: true },
  {
    id: "worst",
    title: "结构：柴粮是零、炉膛是空的，一整年天天暴风雪",
    years: 1,
    world: { wood: 0, food: 0, coldHearth: true, alwaysBlizzard: true },
    noProjects: true,
  },
  { id: "outings", title: "照他自己的习惯做项目，每 3 天带他去一趟松林（固定的出门策略）", outingEveryDays: 3 },
];

const WI = CONFIG.IMPL.wild;

/**
 * 长跑用的一趟松林：9 点以后，好天或一般的天气出门，带 2 份干粮 1 捆柴（家里够的话）。
 * 按内容表的顺序把采得到的都采了；冷了去最近的生火点生火烤到暖和，累了先吃干粮再歇；
 * 下午 2 点半以后或者没得采了就走回林口回家。只调玩家能用的那套野外动作，不碰内核规则。
 */
export function outingTrip(w: World): void {
  const c = checkOuting(w);
  if (!depart(w, { rations: Math.min(2, c.maxRations), bundles: Math.min(1, c.maxBundles) }).ok) return;
  runWild(w, { type: "travel", to: "pineForest" });
  const area = AREA_BY_ID.pineForest;
  const tend = (): void => {
    for (let guard = 0; guard < 30 && w.outing; guard++) {
      const b = w.outing.body;
      if (b.stamina < WI.tiredWarning + 1000) {
        if (w.outing.rations > 0) runWild(w, { type: "eat" });
        else runWild(w, { type: "rest" });
        continue;
      }
      if (b.warmth < WI.coldWarning + 1000) {
        const view = wildView(w);
        const fire = view?.fires.find((f) => f.near);
        if (!fire && view) {
          const spot = [...area.fires].sort((a, b) => Math.abs(a.x - view.x) + Math.abs(a.y - view.y) - (Math.abs(b.x - view.x) + Math.abs(b.y - view.y)))[0];
          if (!runWild(w, { type: "walkTo", x: spot.x, y: spot.y }).ok) return;
          continue;
        }
        if (fire && !fire.burning && !runWild(w, { type: "fire" }).ok) return;
        runWild(w, { type: "rest" });
        if (w.outing && w.outing.body.warmth >= WI.bodyMax - 1500) return;
        continue;
      }
      return;
    }
  };
  for (const node of area.nodes) {
    if (!w.outing || dayClock(w) >= 14 * 60 + 30) break;
    tend();
    if (w.outing) runWild(w, { type: "gather", node: node.id });
  }
  if (!w.outing) return;
  runWild(w, { type: "walkTo", x: area.exits[0].x, y: area.exits[0].y });
  runWild(w, { type: "travel", to: "home" });
}

export interface LongRunResult {
  title: string;
  runs: number;
  years: number;
  days: number;
  tierShare: Record<LifeTier, number>;
  thriftRuns: number[];
  missedMeals: number;
  noFireMinutes: number;
  coldStarts: number;
  coldStartMinutes: number;
  choreDayShare: number;
  projectHoursPerDay: number;
  woodPerDay: number;
  mealsPerDay: number;
  perYear: Record<string, number>;
  timeShare: Record<string, number>;
  /** 单个世界年里折枯枝、起鱼笼的最多次数 */
  maxEavePerYear: { wood: number; food: number };
  baseRepairsDoneDay: number | null;
  /** 出门的账：每个世界年的趟数、昏倒、带回来的各样东西 */
  outing: Record<string, number>;
}

export function prepareWorld(c: LongRunCase, seed: number): World {
  const w = createWorld(seed, c.world);
  for (const id of c.done ?? []) w.projects[id].done = true;
  if (c.noProjects) for (const p of PROJECTS) if (!w.projects[p.id].done) w.projects[p.id].paused = true;
  return w;
}

export function runCase(c: LongRunCase, runs: number, years: number): LongRunResult {
  const yearDays = CONFIG.calendar.yearDays;
  const total: Record<string, number> = {};
  const thriftRuns: number[] = [];
  const max = { wood: 0, food: 0 };
  let baseDoneSum = 0;
  let baseDoneCount = 0;
  for (let seed = 0; seed < runs; seed++) {
    const w = prepareWorld(c, seed);
    const days = years * yearDays;
    let run = 0;
    let day = -1;
    let yearStart = { wood: 0, food: 0 };
    let baseDone: number | null = null;
    let lastTrip = -1;
    while (w.day < days) {
      if (
        c.outingEveryDays && w.day % c.outingEveryDays === 0 && w.day !== lastTrip && dayClock(w) >= 9 * 60 &&
        dayClock(w) < 11 * 60 && (w.weather.today === "A" || w.weather.today === "B") && checkOuting(w).ok
      ) {
        lastTrip = w.day;
        outingTrip(w);
      }
      if (w.day !== day) {
        day = w.day;
        if (w.today.mood === "thrift") run += 1;
        else if (run) {
          thriftRuns.push(run);
          run = 0;
        }
        if (day % yearDays === 0) {
          const now = { wood: (w.tally["柴:折枯枝"] ?? 0) / CONFIG.supply.eaveWood, food: (w.tally["粮:起鱼笼"] ?? 0) / CONFIG.supply.eaveFood };
          max.wood = Math.max(max.wood, now.wood - yearStart.wood);
          max.food = Math.max(max.food, now.food - yearStart.food);
          yearStart = now;
        }
        if (baseDone === null && !c.noProjects && ["windowGaps", "woodshed", "cellar", "fence", "dryingRack"].every((id) => w.projects[id].done)) {
          baseDone = day;
        }
      }
      stepMinute(w);
    }
    if (run) thriftRuns.push(run);
    // 最后一个世界年
    max.wood = Math.max(max.wood, (w.tally["柴:折枯枝"] ?? 0) / CONFIG.supply.eaveWood - yearStart.wood);
    max.food = Math.max(max.food, (w.tally["粮:起鱼笼"] ?? 0) / CONFIG.supply.eaveFood - yearStart.food);
    if (baseDone !== null) {
      baseDoneSum += baseDone;
      baseDoneCount += 1;
    }
    // 最后一天还没过完就停了，它已经记进「日:」里，这里照实合计
    for (const [k, v] of Object.entries(w.tally)) total[k] = (total[k] ?? 0) + v;
  }
  thriftRuns.sort((a, b) => a - b);
  const dayCount = total["日:合计"] ?? 1;
  const t = (k: string): number => total[k] ?? 0;
  const ny = dayCount / yearDays;
  const minutes = Object.entries(total).filter(([k]) => k.startsWith("时间:"));
  const allMinutes = minutes.reduce((a, [, v]) => a + v, 0) || 1;
  return {
    title: c.title,
    runs,
    years,
    days: dayCount,
    tierShare: { rich: t("日:rich") / dayCount, normal: t("日:normal") / dayCount, thrift: t("日:thrift") / dayCount },
    thriftRuns,
    missedMeals: t("缺餐"),
    noFireMinutes: t("无火分钟"),
    coldStarts: t("冷启动"),
    coldStartMinutes: t("冷启动分钟"),
    choreDayShare: t("有活计的天") / dayCount,
    projectHoursPerDay: t("项目分钟") / 60 / dayCount,
    woodPerDay: t("烧柴") / dayCount,
    mealsPerDay: t("吃饭") / dayCount,
    perYear: Object.fromEntries(
      Object.entries(total)
        .filter(([k]) => k.startsWith("柴:") || k.startsWith("粮:"))
        .map(([k, v]) => [k, v / ny]),
    ),
    timeShare: Object.fromEntries(minutes.map(([k, v]) => [k.slice(3), v / allMinutes])),
    maxEavePerYear: max,
    baseRepairsDoneDay: baseDoneCount ? baseDoneSum / baseDoneCount : null,
    outing: Object.fromEntries(
      Object.entries(total)
        .filter(([k]) => k === "出门" || k.startsWith("昏倒") || k.startsWith("带回的") || k.startsWith("野外") || k.startsWith("行囊带走") || k === "离家时无火分钟" || k === "回家时火已经灭了")
        .map(([k, v]) => [k, v / ny]),
    ),
  };
}

const pct = (x: number, digits = 1): string => `${(x * 100).toFixed(digits)}%`;

export function formatReport(r: LongRunResult): string {
  const lines: string[] = [];
  lines.push(`\n== ${r.title} ==（${r.runs} 次 × ${r.years} 个世界年，共 ${r.days} 天）`);
  lines.push(`  丰足 ${pct(r.tierShare.rich)}  正常 ${pct(r.tierShare.normal)}  俭 ${pct(r.tierShare.thrift)}`);
  const tr = r.thriftRuns;
  lines.push(
    tr.length
      ? `  俭：${tr.length} 段，中位 ${tr[tr.length >> 1]} 天，95% 不超过 ${tr[Math.floor(tr.length * 0.95)]} 天，最长 ${tr[tr.length - 1]} 天`
      : "  没有出现俭",
  );
  lines.push(`  缺餐 ${r.missedMeals} 次；无火 ${r.noFireMinutes} 分钟（冷启动另计 ${r.coldStartMinutes} 分钟）；重新生火 ${r.coldStarts} 次`);
  lines.push(`  有活计的日子 ${pct(r.choreDayShare, 0)}；项目每天平均 ${r.projectHoursPerDay.toFixed(2)} 小时；每天烧柴 ${r.woodPerDay.toFixed(1)} 根、吃 ${r.mealsPerDay.toFixed(1)} 餐`);
  const src = Object.entries(r.perYear)
    .sort()
    .map(([k, v]) => `${k} ${v.toFixed(1)}`)
    .join("，");
  lines.push(`  每个世界年的来源：${src}`);
  lines.push(`  单个世界年里最多折枯枝 ${r.maxEavePerYear.wood} 次、起鱼笼 ${r.maxEavePerYear.food} 次`);
  const time = Object.entries(r.timeShare)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${pct(v)}`)
    .join("，");
  lines.push(`  他的时间：${time}`);
  if (r.baseRepairsDoneDay !== null) lines.push(`  五件基础修缮平均在第 ${r.baseRepairsDoneDay.toFixed(0)} 天全部做完`);
  if (r.outing["出门"]) {
    const o = Object.entries(r.outing)
      .sort()
      .map(([k, v]) => `${k} ${v.toFixed(1)}`)
      .join("，");
    lines.push(`  出门（每个世界年）：${o}`);
  }
  return lines.join("\n");
}
