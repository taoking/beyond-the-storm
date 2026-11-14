// 只读的投影：把一局游戏的事实整理成界面要的样子。这里的函数都不改状态。
// 灰盒界面、以后的正式界面、多窗口的从窗口，读的都是这一份。
import { CAMERA_IDS, visibleIn, type CameraId } from "./cameras.ts";
import { clockText, DAY_PART_NAME, dayPartOf, SEASON_NAME, seasonOf } from "./calendar.ts";
import { CONFIG, type LifeTier } from "./config.ts";
import { CROP_BY_ID, PLACES, PROJECTS, STYLES, zoneOf, type PlaceId, type Zone } from "./content.ts";
import { focusBarState, sharesToday, unlockedStyleCount, type Calendar, type FocusBarState, type RoundSummary } from "./focus.ts";
import { frozen, type Game, type Mode, type Notice } from "./game.ts";
import { actionLabel, fireLook, foodCap, foodDays, hasEffect, projectStatus, woodCap, woodDays, type ProjectStatus } from "./sim.ts";
import { dayClock, type WorldEvent } from "./state.ts";
import { TIER_NAME } from "./weather.ts";
import { actorPose, projectedLook, type LookProjection, type PoseProjection } from "./visual.ts";

export const MOOD_NAME: Record<LifeTier, string> = { thrift: "俭", normal: "正常", rich: "丰足" };

export interface ProjectView {
  id: string;
  name: string;
  kind: string;
  status: ProjectStatus;
  note: string;
  stages: number;
  stage: number;
  /** 阶段里的进度只用三个词，不显示工时和百分比 */
  stageWord: string;
  pinned: boolean;
  /** 给开发调试器看的确切数 */
  debugMinutes: number;
  debugStageMinutes: number;
}

export interface Snapshot {
  mode: Mode;
  frozen: boolean;
  /** 状态条上的一句：氛围预览 · 世界暂停 之类 */
  modeLine: string;
  world: {
    /** 世界日牌：冬 · 第 12 天 */
    dayLabel: string;
    /** 到站以来第几天，从 1 起 */
    stationDay: number;
    look: string;
    tierName: string;
    /** 作息上的时段（清晨、上午……晚上、夜），只看钟点。画面的光用 look.dayPart */
    dayPart: string;
    /** 只在户外和调试器里显示具体钟点 */
    clock: string;
    omen: boolean;
    tomorrow: string | null;
  };
  actor: {
    label: string;
    place: PlaceId;
    placeName: string;
    zone: Zone;
    asleep: boolean;
    away: boolean;
    outfit: string;
    /** 镜头里看不见他的时候，说一句他在哪 */
    whereabouts: string;
    visible: Record<CameraId, boolean>;
  };
  /**
   * 画面里要画的人：氛围态里是不产出的闲暇演出；户外临时专注是空屋。
   * visible 按 stage.place 算（画面上哪个镜头看得见这个人）；actor.visible 是他真实位置的事实。
   */
  stage: {
    show: boolean;
    place: PlaceId | null;
    label: string;
    illusion: boolean;
    outfit: "indoor" | "outdoor" | null;
    visible: Record<CameraId, boolean>;
  } & PoseProjection;
  /** 当前实际可绘制的天气、季节和时间；独立氛围和真实世界严格分开。 */
  look: LookProjection;
  fire: { look: string; burn: number; ember: number };
  life: { mood: string; woodLine: string; foodLine: string; heater: boolean };
  stock: { wood: number; woodCap: number; woodDays: number; food: number; foodCap: number; foodDays: number; ingredients: number; cans: number; fuel: number; lumber: number };
  projects: ProjectView[];
  plots: { name: string; crop: string | null; daysLeft: number; ripe: boolean; preferred: string | null }[];
  greenhouse: { usable: boolean };
  jar: { cones: number; fullJars: number; pending: number };
  request: string | null;
  /** 近况卡：今天到现在真实发生过的事，要紧的在前 */
  today: { top: WorldEvent[]; more: WorldEvent[] };
  traces: { type: string; place: PlaceId }[];
  outing: { area: string | null; minutesFromDoor: number; rations: number; bundles: number; panel: string | null } | null;
  focus: {
    bar: FocusBarState;
    text: string;
    dots: number;
    total: number;
    stylesUnlocked: number;
    nextStyleAt: number | null;
    summary: RoundSummary | null;
    summaryText: string;
    pendingGapMinutes: number;
    recordId: number | null;
  };
  notices: Notice[];
}

function mmss(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** 点开柴堆、储物架时，确切的数前面的那一句（04 评审附 C） */
function stockLine(days: number, tier: LifeTier, what: "柴" | "粮"): string {
  const use = what === "柴" ? "烧" : "吃";
  if (tier === "thrift") return what === "柴" ? "柴不多了，这几天省着烧。" : "粮不多了，这几天吃简单些。";
  if (days >= CONFIG.tiers.rich) return `${what}很宽裕。`;
  if (days >= CONFIG.supply.targetDays) return `${what}还够${use}一阵。`;
  return `${what}还够${use}几天。`;
}

function stageWord(done: number, total: number): string {
  if (total <= 0) return "";
  const r = done / total;
  return r < 1 / 3 ? "刚开头" : r < 2 / 3 ? "过半" : "快好了";
}

export function summaryText(s: RoundSummary | null): string {
  if (!s) return "";
  const parts = [`这一轮 ${s.minutes} 分钟`];
  if (s.shares > 0) parts.push(`得 ${s.shares} 份`);
  for (const id of s.unlocked) {
    const style = STYLES.find((x) => x.id === id);
    if (style) parts.push(`新样式：${style.name.split("：").reverse().join("")}`);
  }
  return parts.join(" · ");
}

function stageVisible(place: PlaceId | null): Record<CameraId, boolean> {
  return Object.fromEntries(CAMERA_IDS.map((c) => [c, place !== null && visibleIn(c, place)])) as Record<CameraId, boolean>;
}

const MODE_LINE: Record<Mode, string> = {
  companion: "真实的今天",
  ambience: "氛围预览 · 世界暂停",
  outdoor: "在野外",
  outdoorFocus: "户外暂停 · 他留在原地",
};

export function present(g: Game, wall: number, cal: Calendar): Snapshot {
  const w = g.world;
  const a = w.actor;
  const info = seasonOf(w.day);
  const t = dayClock(w);
  const fz = frozen(g);
  const label = a.away ? "出门了" : actionLabel(w);
  const visible = Object.fromEntries(CAMERA_IDS.map((c) => [c, !a.away && visibleIn(c, a.place)])) as Record<CameraId, boolean>;

  // 表现姿态只读已有的结构化 Activity/phase/data，永远不解析中文 label。
  const pose = actorPose(a);
  let stage: Omit<Snapshot["stage"], "visible">;
  if (g.mode === "outdoorFocus") {
    stage = { show: false, place: null, label: "屋里没人，炉里留着余火", illusion: false, outfit: null, activity: null, pose: null, prop: null };
  } else if (g.mode === "ambience") {
    // 独立氛围只演出一个不消耗资源的姿态；真实 actor 和 world 都不动。
    stage = a.away
      ? { show: false, place: null, label: "", illusion: true, outfit: null, activity: null, pose: null, prop: null }
      : { show: true, place: "armchair", label: "在炉边坐着", illusion: true, outfit: "indoor", activity: null, pose: "sit", prop: null };
  } else if (g.mode === "outdoor") {
    // 野外完整动画/走路路径尚未实装；这里只给预留站姿，不捏造位移。
    stage = { show: true, place: "wild", label: "在野外", illusion: false, outfit: "outdoor", activity: null, pose: "standLook", prop: null };
  } else {
    stage = { show: true, place: a.place, label, illusion: false, outfit: a.outfit, ...pose };
  }

  const fs = g.focus;
  const s = fs.session;
  const bar = focusBarState(fs);
  let text = "";
  if (!s) {
    const p = fs.settings.preset;
    text = p.kind === "countdown" ? `▶ ${p.focusMin}/${p.breakMin}` : "▶ 正向计时";
  } else {
    const remain = s.targetMs === null ? s.phaseMs : s.targetMs - s.phaseMs;
    const clock = mmss(remain);
    switch (bar) {
      case "focusing":
        text = clock;
        break;
      case "countup":
        text = `↑ ${clock}`;
        break;
      case "break":
        text = `休息 ${clock}`;
        break;
      case "awaitNext":
        text = "准备好了就开始 ▶";
        break;
      case "pausedByUser":
        text = `已暂停 ${clock}`;
        break;
      case "pausedAfterSleep":
        text = `已暂停 ${clock}　电脑睡了一会儿`;
        break;
      case "pausedAfterGap":
        text = `已暂停 ${clock}`;
        break;
      default:
        break;
    }
  }
  const total = fs.shares.total;
  const unlocked = unlockedStyleCount(total);
  const nextStyleAt = unlocked < CONFIG.shares.stylesEnabled ? CONFIG.shares.styleThresholds[unlocked] : null;

  const todays = w.events.filter((e) => e.day === w.day);
  const ranked = [...todays].sort((x, y) => y.weight - x.weight || y.minute - x.minute);
  const top = ranked.slice(0, 4).sort((x, y) => x.minute - y.minute);
  const more = ranked.slice(4, 6).sort((x, y) => x.minute - y.minute);

  const d = w.today;
  return {
    mode: g.mode,
    frozen: fz,
    modeLine: MODE_LINE[g.mode],
    world: {
      dayLabel: `${SEASON_NAME[info.season]} · 第 ${info.dayInSeason + 1} 天`,
      stationDay: w.day + 1,
      look: w.weather.look,
      tierName: TIER_NAME[w.weather.today],
      dayPart: DAY_PART_NAME[dayPartOf(t % 1440)],
      clock: clockText(t),
      omen: w.weather.tomorrow === "D" && d.observed,
      tomorrow: hasEffect(w, "forecast") ? TIER_NAME[w.weather.tomorrow] : null,
    },
    actor: {
      label,
      place: a.place,
      placeName: PLACES[a.place].name,
      zone: zoneOf(a.place),
      asleep: a.asleep,
      away: a.away,
      outfit: a.outfit,
      whereabouts: a.away ? "出门了" : `${label}（${PLACES[a.place].name}）`,
      visible,
    },
    stage: { ...stage, visible: stageVisible(stage.show ? stage.place : null) },
    look: projectedLook(g, w, t),
    fire: { look: fireLook(w), burn: Math.round(w.fire.burn), ember: w.fire.ember },
    life: {
      mood: MOOD_NAME[d.mood],
      woodLine: stockLine(woodDays(w), d.woodTier, "柴") + (d.heater ? "点着暖炉。" : ""),
      foodLine: stockLine(foodDays(w), d.foodTier, "粮"),
      heater: d.heater,
    },
    stock: {
      wood: w.stock.wood,
      woodCap: woodCap(w),
      woodDays: woodDays(w),
      food: w.stock.food,
      foodCap: foodCap(w),
      foodDays: foodDays(w),
      ingredients: w.stock.ingredients,
      cans: w.stock.cans,
      fuel: w.stock.fuel,
      lumber: w.stock.materials.lumber,
    },
    projects: PROJECTS.filter((p) => w.projects[p.id].known).map((p) => {
      const ps = w.projects[p.id];
      const st = projectStatus(w, p.id);
      const stageMinutes = ps.stage < p.stages.length ? p.stages[ps.stage].hours * 60 : 0;
      return {
        id: p.id,
        name: p.name,
        kind: p.kind,
        status: st.status,
        note: st.note,
        stages: p.stages.length,
        stage: ps.done ? p.stages.length : ps.stage,
        stageWord: st.status === "doing" ? stageWord(ps.minutesInStage, stageMinutes) : "",
        pinned: w.intents.pinned.includes(p.id),
        debugMinutes: ps.minutesInStage,
        debugStageMinutes: stageMinutes,
      };
    }),
    plots: w.plots.map((p, i) => ({
      name: `第 ${i + 1} 格`,
      crop: p.crop ? CROP_BY_ID[p.crop].name : null,
      daysLeft: p.daysLeft,
      ripe: p.ripe,
      preferred: p.preferred ? CROP_BY_ID[p.preferred].name : null,
    })),
    greenhouse: { usable: hasEffect(w, "greenhouse") },
    jar: { cones: w.jar.cones, fullJars: w.jar.fullJars, pending: w.pendingCones },
    request: w.intents.request?.kind ?? null,
    today: { top, more },
    traces: w.traces.filter((x) => x.until > w.minute).map((x) => ({ type: x.type, place: x.place })),
    outing: w.outing
      ? {
          area: w.outing.area ? CONFIG.outing.areas[w.outing.area].name : null,
          minutesFromDoor: w.outing.minutesFromDoor,
          rations: w.outing.rations,
          bundles: w.outing.bundles,
          panel: g.outdoorPanel,
        }
      : null,
    focus: {
      bar,
      text,
      dots: sharesToday(fs, wall, cal),
      total,
      stylesUnlocked: unlocked,
      nextStyleAt,
      summary: fs.lastSummary,
      summaryText: summaryText(fs.lastSummary),
      pendingGapMinutes: s ? Math.round(s.pendingGapMs / 60_000) : 0,
      recordId: s && s.phase === "focus" ? s.round.recordId : null,
    },
    notices: g.notices,
  };
}

