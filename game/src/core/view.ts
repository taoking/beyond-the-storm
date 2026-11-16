// 只读的投影：把一局游戏的事实整理成界面要的样子。这里的函数都不改状态。
// 灰盒界面、以后的正式界面、多窗口的从窗口，读的都是这一份。
import { DISPLAY_ROOM, ROOM_IDS, roomOf, visibleIn, type RoomId } from "./rooms.ts";
import { clockText, DAY_PART_NAME, dayPartOf, SEASON_NAME, seasonOf } from "./calendar.ts";
import { CONFIG, type LifeTier } from "./config.ts";
import {
  AREA_BY_ID,
  CROP_BY_ID,
  CURES,
  DISPLAY_SLOT_IDS,
  DISPLAY_SLOTS,
  GOODS_NAME,
  KEEPSAKE_BY_ID,
  PLACES,
  PROJECTS,
  STYLES,
  TOOL_NAME,
  zoneOf,
  type CureKind,
  type DisplaySlotId,
  type Goods,
  type KeepsakeKind,
  type Material,
  type PantryKind,
  type ProjectEffect,
  type PlaceId,
  type Zone,
} from "./content.ts";
import { freeNow, keepsakeCapacity, shelfCount, shelfLevel, whereIs, type ShelfLevel } from "./keepsakes.ts";
import { windowEventView, type WindowEventView } from "./windowEvents.ts";
import { focusBarState, sharesToday, unlockedStyleCount, type Calendar, type FocusBarState, type RoundSummary } from "./focus.ts";
import { frozen, type Game, type Mode, type Notice } from "./game.ts";
import { actionLabel, fireLook, foodCap, foodDays, hasEffect, plainIngredients, projectStatus, woodCap, woodDays, type ProjectStatus } from "./sim.ts";
import { bagCapacity, bagSlots, isDark, nearFire } from "./outing.ts";
import { dayClock, type WildAct, type WorldEvent } from "./state.ts";
import { TIER_NAME } from "./weather.ts";
import { actorPose, projectedLook, type LookProjection, type PoseKey, type PoseProjection } from "./visual.ts";
import { wildView, type WildView } from "./wild.ts";

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
    /** 画面里看不见他的时候，说一句他在哪 */
    whereabouts: string;
    /** 他真实在哪一间；院子、屋外、出门了是 null */
    room: RoomId | null;
    visible: Record<RoomId, boolean>;
  };
  /**
   * 画面里要画的人：氛围态里是不产出的闲暇演出；户外临时专注是空屋。
   * room、visible 按 stage.place 算（选了哪一间就画得出这个人）；actor.room、actor.visible 是他真实位置的事实。
   */
  stage: {
    show: boolean;
    place: PlaceId | null;
    label: string;
    illusion: boolean;
    outfit: "indoor" | "outdoor" | null;
    room: RoomId | null;
    visible: Record<RoomId, boolean>;
    /** 书架两档：books_few / books_many（前任的书一直在，最少是稀疏） */
    shelf: ShelfLevel;
    /** 六处展示位上摆着的藏品（KEEPSAKES 的 id，木雕可能有几件）；样式和玻璃罐不在这里，看 collection.displays */
    displays: Record<DisplaySlotId, string[]>;
    /** 院里看得见的等的慢事：地窖口有没有一坛腌菜，晾架上挂着哪几样（空数组是空架子）。世界事实 */
    curing: { crock: boolean; rack: CureKind[] };
    /**
     * 窗外正在发生的小事（03 第 10.4 节）：世界事实，画在窗外一组。氛围态里没有（那是冻结的选择，不生成世界事件）。
     * 不用点、不弹出来；seen 是他看见了（手记里有一笔）
     */
    windowEvent: WindowEventView | null;
  } & PoseProjection;
  /** 当前实际可绘制的天气、季节和时间；独立氛围和真实世界严格分开。 */
  look: LookProjection;
  fire: { look: string; burn: number; ember: number };
  life: { mood: string; woodLine: string; foodLine: string; heater: boolean };
  stock: {
    wood: number;
    woodCap: number;
    woodDays: number;
    food: number;
    foodCap: number;
    foodDays: number;
    ingredients: number;
    /** 食材里有名目的几样（在 ingredients 之内），plain 是不分名目的那些 */
    pantry: Record<PantryKind, number> & { plain: number };
    /** 晾好的药草茶还能泡几杯（不是食材） */
    tea: number;
    cans: number;
    fuel: number;
    lumber: number;
    /** 所有素材，含木料 */
    materials: Record<Material, number>;
  };
  /** 等的慢事（03 第 7.3 节）：地窖口的坛子、晾架上的东西 */
  curing: { kind: CureKind; name: string; place: "cellar" | "dryingRack"; amount: number; daysLeft: number; ready: boolean }[];
  /** 做好的工具（03 第 6.4 节）：钓竿、弓、提灯、大背包 */
  tools: { effect: string; name: string }[];
  /** 学会的菜式、茶（只影响画面、声音和手记） */
  dishes: string[];
  projects: ProjectView[];
  plots: { name: string; crop: string | null; daysLeft: number; ripe: boolean; preferred: string | null }[];
  greenhouse: { usable: boolean };
  jar: { cones: number; fullJars: number; pending: number };
  /** 藏品、六处展示位、书架（03 第 3.1、4.3、6.5 节）。世界事实，氛围态里也照实给 */
  collection: CollectionView;
  request: string | null;
  /** 近况卡：今天到现在真实发生过的事，要紧的在前 */
  today: { top: WorldEvent[]; more: WorldEvent[] };
  traces: { type: string; place: PlaceId }[];
  outing: {
    /** 区域的名字；在院门外是 null */
    area: string | null;
    areaId: string | null;
    minutesFromDoor: number;
    rations: number;
    panel: string | null;
    /** 体温、体力、生命，0–100 */
    body: { warmth: number; stamina: number; health: number };
    bag: { slots: number; maxSlots: number; items: { goods: Goods; name: string; count: number }[] };
    dark: boolean;
    nearFire: boolean;
    /** 最近一个动作 */
    last: WildAct | null;
    /** 在区域里时的地图、资源点、生火点 */
    map: WildView | null;
  } | null;
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

export interface KeepsakeView {
  uid: string;
  id: string;
  name: string;
  kind: KeepsakeKind;
  /** 到站以来第几天拿到的，从 1 起 */
  stationDay: number;
  /** 摆在哪一处，书在书架上，收在手记的收藏页是 null */
  where: DisplaySlotId | "bookshelf" | null;
  /** 他还没去做的安排：想摆到哪一处（04 第 5.3 节「已带回，待摆放」），要换下来是 "takeDown" */
  pending: DisplaySlotId | "takeDown" | null;
}

export interface DisplayView {
  id: DisplaySlotId;
  name: string;
  room: RoomId | null;
  /** 这一处一共几格（含玻璃罐、样式位） */
  capacity: number;
  /** 给藏品的格数，和现在还空几格 */
  keepsakeSlots: number;
  free: number;
  /** 一直在的东西（窗台的玻璃罐） */
  fixed: string | null;
  /** 这一处样式位上现在的样式 id；没有样式位或没摆是 null */
  style: string | null;
  items: { uid: string; id: string; name: string }[];
}

export interface CollectionView {
  items: KeepsakeView[];
  displays: DisplayView[];
  shelf: {
    level: ShelfLevel;
    /** 带回的书 */
    books: number;
    /** 你那一格里的书脊（最多 milestones.spineSlots 本） */
    spines: number;
    /** 合起来到这个数是「放满」 */
    manyAt: number;
  };
}

function collectionView(g: Game): CollectionView {
  const w = g.world;
  const spines = g.focus.spines.length;
  const count = shelfCount(w, spines);
  const pendingOf = (uid: string): KeepsakeView["pending"] => {
    const a = w.intents.arrange.find((x) => x.put === uid || x.take === uid);
    if (!a) return null;
    return a.put === uid ? a.slot : "takeDown";
  };
  return {
    items: w.keepsakes.map((k) => {
      const def = KEEPSAKE_BY_ID[k.id];
      return {
        uid: k.uid,
        id: k.id,
        name: def?.name ?? k.id,
        kind: def?.kind ?? "ornament",
        stationDay: k.day + 1,
        where: whereIs(w, k.uid),
        pending: pendingOf(k.uid),
      };
    }),
    displays: DISPLAY_SLOT_IDS.map((id) => {
      const s = DISPLAY_SLOTS[id];
      const style = s.style ? w.styles[s.style] : null;
      return {
        id,
        name: s.name,
        room: DISPLAY_ROOM[id] ?? null,
        capacity: CONFIG.IMPL.displayCapacity[id],
        keepsakeSlots: keepsakeCapacity(id),
        free: freeNow(w, id),
        fixed: s.fixed ?? null,
        style: style && style !== "none" ? style : null,
        items: w.display[id].map((uid) => {
          const k = w.keepsakes.find((x) => x.uid === uid);
          return { uid, id: k?.id ?? uid, name: (k && KEEPSAKE_BY_ID[k.id]?.name) ?? uid };
        }),
      };
    }),
    shelf: { level: shelfLevel(w, spines), books: count.books, spines: count.spines, manyAt: CONFIG.IMPL.shelfManyAt },
  };
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

const WILD_POSE: Record<WildAct, PoseKey> = { walk: "walk", road: "walk", gather: "crouch", fire: "crouch", rest: "sit", eat: "sitHold" };

const percent = (n: number): number => Math.round((n / CONFIG.IMPL.wild.bodyMax) * 100);

function roomsVisible(place: PlaceId | null): Record<RoomId, boolean> {
  return Object.fromEntries(ROOM_IDS.map((r) => [r, place !== null && visibleIn(r, place)])) as Record<RoomId, boolean>;
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
  const realPlace = a.away ? null : a.place;

  // 表现姿态只读已有的结构化 Activity/phase/data，永远不解析中文 label。
  const pose = actorPose(a);
  let stage: Omit<Snapshot["stage"], "room" | "visible" | "shelf" | "displays" | "curing" | "windowEvent">;
  if (g.mode === "outdoorFocus") {
    stage = { show: false, place: null, label: "屋里没人，炉里留着余火", illusion: false, outfit: null, activity: null, pose: null, prop: null };
  } else if (g.mode === "ambience") {
    // 独立氛围只演出一个不消耗资源的姿态；真实 actor 和 world 都不动。
    stage = a.away
      ? { show: false, place: null, label: "", illusion: true, outfit: null, activity: null, pose: null, prop: null }
      : { show: true, place: "armchair", label: "在炉边坐着", illusion: true, outfit: "indoor", activity: null, pose: "sit", prop: null };
  } else if (g.mode === "outdoor") {
    // 野外只有最近一个动作，姿态跟着它；位移由区域地图上的格子表示
    const last = w.outing?.last ?? null;
    stage = { show: true, place: "wild", label: "在野外", illusion: false, outfit: "outdoor", activity: null, pose: last ? WILD_POSE[last] : "standLook", prop: null };
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
  const collection = collectionView(g);
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
      room: realPlace && roomOf(realPlace),
      visible: roomsVisible(realPlace),
    },
    stage: {
      ...stage,
      curing: {
        crock: w.curing.some((b) => CURES[b.kind].place === "cellar"),
        rack: w.curing.filter((b) => CURES[b.kind].place === "dryingRack").map((b) => b.kind),
      },
      room: stage.show && stage.place ? roomOf(stage.place) : null,
      visible: roomsVisible(stage.show ? stage.place : null),
      shelf: collection.shelf.level,
      displays: Object.fromEntries(collection.displays.map((d) => [d.id, d.items.map((x) => x.id)])) as Record<DisplaySlotId, string[]>,
      windowEvent: g.mode === "ambience" ? null : windowEventView(w),
    },
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
      pantry: { ...w.pantry, plain: plainIngredients(w) },
      tea: w.tea,
      cans: w.stock.cans,
      fuel: w.stock.fuel,
      lumber: w.stock.materials.lumber,
      materials: { ...w.stock.materials },
    },
    curing: w.curing.map((b) => ({
      kind: b.kind,
      name: CURES[b.kind].name,
      place: CURES[b.kind].place,
      amount: b.amount,
      daysLeft: Math.max(0, b.daysLeft),
      ready: b.daysLeft <= 0,
    })),
    tools: (Object.entries(TOOL_NAME) as [ProjectEffect, string][]).filter(([e]) => hasEffect(w, e)).map(([effect, name]) => ({ effect, name })),
    dishes: [...w.dishes],
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
    collection,
    request: w.intents.request?.kind ?? null,
    today: { top, more },
    traces: w.traces.filter((x) => x.until > w.minute).map((x) => ({ type: x.type, place: x.place })),
    outing: w.outing
      ? {
          area: w.outing.area ? AREA_BY_ID[w.outing.area].name : null,
          areaId: w.outing.area,
          minutesFromDoor: w.outing.minutesFromDoor,
          rations: w.outing.rations,
          panel: g.outdoorPanel,
          body: {
            warmth: percent(w.outing.body.warmth),
            stamina: percent(w.outing.body.stamina),
            health: percent(w.outing.body.health),
          },
          bag: {
            slots: bagSlots(w.outing.rations, w.outing.bag),
            maxSlots: bagCapacity(w),
            items: (Object.entries(w.outing.bag) as [Goods, number][])
              .filter(([, n]) => n > 0)
              .map(([goods, count]) => ({ goods, name: GOODS_NAME[goods], count })),
          },
          dark: isDark(w),
          nearFire: nearFire(w),
          last: w.outing.last,
          map: wildView(w),
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

