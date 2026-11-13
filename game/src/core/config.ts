// 所有数值的唯一出处。数字来自 设计/02_玩法.md 第 13 节和 设计/03_主要内容.md，
// 02/03 没写、由实现补的初值集中在 IMPL 一节，改之前先看 设计/讨论记录 里的实现差异清单。

export type Season = "winter" | "spring" | "summer" | "autumn";
/** 天气四档：A 好天、B 一般、C 出不了院子、D 暴风雪 */
export type WeatherTier = "A" | "B" | "C" | "D";
export type LifeTier = "thrift" | "normal" | "rich";
export type YearKind = "plain" | "snowy" | "warm" | "lateSpring" | "earlyFrost";

export const MIN_PER_HOUR = 60;
export const MIN_PER_DAY = 1440;

export const CONFIG = {
  calendar: {
    seasons: [
      ["winter", 24],
      ["spring", 12],
      ["summer", 12],
      ["autumn", 12],
    ] as [Season, number][],
    yearDays: 60,
    wakeMinute: 6 * 60,
    bedMinute: 22 * 60,
    /** 「今天早点歇」只在这个钟点以后有效 */
    earlyRestFrom: 18 * 60,
  },
  /** 现实 1 分钟 = 游戏几分钟 */
  rates: { awake: 4, asleep: 120, outdoor: 10 },
  weather: {
    table: {
      winter: { A: 0.35, B: 0.35, C: 0.18, D: 0.12 },
      spring: { A: 0.45, B: 0.35, C: 0.15, D: 0.05 },
      summer: { A: 0.6, B: 0.3, C: 0.1, D: 0 },
      autumn: { A: 0.45, B: 0.35, C: 0.15, D: 0.05 },
    } as Record<Season, Record<WeatherTier, number>>,
    maxBlizzardRun: 3,
    maxBadRun: 4,
    recoverDays: 2,
    yearKinds: [
      ["plain", 0.4],
      ["snowy", 0.15],
      ["warm", 0.15],
      ["lateSpring", 0.15],
      ["earlyFrost", 0.15],
    ] as [YearKind, number][],
    yearKindParams: {
      plain: { bad: 1, lateSpring: 0, earlyFrost: 0 },
      snowy: { bad: 1.35, lateSpring: 0, earlyFrost: 0 },
      warm: { bad: 0.7, lateSpring: 0, earlyFrost: 0 },
      lateSpring: { bad: 1, lateSpring: 3, earlyFrost: 0 },
      earlyFrost: { bad: 1, lateSpring: 0, earlyFrost: 3 },
    } as Record<YearKind, { bad: number; lateSpring: number; earlyFrost: number }>,
  },
  stock: {
    wood0: 60,
    food0: 45,
    woodCap: 80,
    foodCap: 60,
    woodCapShed: 120,
    foodCapCellar: 90,
    lumber0: 18,
    ingredientCap: 12,
    fuelCap: 3,
    canCap: 6,
  },
  tiers: { thrift: 2, thriftExit: 3, rich: 10, richExit: 8 },
  woodUse: {
    winter: { thrift: 4, normal: 6, rich: 8 },
    spring: { thrift: 3, normal: 5, rich: 6 },
    summer: { thrift: 2, normal: 4, rich: 5 },
    autumn: { thrift: 3, normal: 5, rich: 6 },
  } as Record<Season, Record<LifeTier, number>>,
  stormExtraWood: 1,
  minWoodPerDay: 2,
  /** 饭点（游戏分钟）。俭：两顿；正常、丰足：三顿 */
  meals: { breakfast: 7 * 60 + 30, lunch: 12 * 60 + 30, dinner: 18 * 60 + 30 },
  mealMinutes: 60,
  supply: {
    targetDays: 7,
    omenDays: 10,
    tightDays: 3,
    choreMinutes: 240,
    woodYield: { A: 20, B: 14 } as Record<"A" | "B", number>,
    foodYield: {
      winter: { A: 6, B: 4 },
      spring: { A: 6, B: 5 },
      summer: { A: 8, B: 6 },
      autumn: { A: 8, B: 6 },
    } as Record<Season, Record<"A" | "B", number>>,
    eaveWood: 4,
    eaveWoodMinutes: 60,
    eaveFood: 2,
    eaveFoodMinutes: 90,
    morningSlot: [8 * 60, 12 * 60] as [number, number],
    afternoonSlot: [14 * 60, 18 * 60] as [number, number],
  },
  fire: {
    emberMinutes: 120,
    nightMinutes: 480,
    awakeMinutes: 960,
    /** 离开炉边前最多多添几根 */
    maxTopUp: 2,
  },
  garden: {
    plots: 4,
    greenhousePlots: 2,
    greenhouseYield: 4,
    greenhouseDays: 5,
    greenhouseWinterDays: 6,
    /** 玩家最多指定几格，其余归他自己定 */
    maxPreferredPlots: 2,
    maxPreferredGreenhouse: 1,
    fenceBonus: 1,
    frostPenalty: 1,
  },
  project: {
    dailyCapMinutes: 180,
    indoorBadWeatherCapMinutes: 300,
    eveningReadCapMinutes: 60,
    minStintMinutes: 60,
    afternoon: [14 * 60, 18 * 60] as [number, number],
    badWeatherMorning: [9 * 60, 12 * 60] as [number, number],
    evening: [20 * 60, 22 * 60] as [number, number],
    maxPinned: 3,
  },
  shares: {
    perDay: 9,
    cooldownMs: 45 * 60_000,
    minEffectiveMs: 10 * 60_000,
    conesPerJar: 30,
    jarsOnShelf: 3,
    /** 累计份数解锁样式的门槛，24 件 */
    styleThresholds: [
      1, 3, 6, 10, 15, 21, 28, 36, 45, 56, 68, 82, 98, 116, 136, 160, 188, 220, 258, 302, 352, 410, 478, 556,
    ],
    /** 首个可玩版只开放前几件 */
    stylesEnabled: 8,
  },
  milestones: {
    hours: [1, 5, 10, 25, 50, 100, 200, 300, 500, 1000],
    sessions: [10, 50, 100, 250, 500, 1000, 2000],
    days: [3, 7, 30, 60, 100, 200, 365],
    spineHoursPerCategory: 10,
    spineSlots: 12,
  },
  outing: {
    packFloorDays: 3,
    sticksPerBundle: 3,
    /** 出门前自动略过的收尾上限（02 第 14.3 条） */
    maxWrapUpMinutes: 30,
    bankMinutes: 480,
    /** 首测初值（02 第 14.5 条）：各季天黑的钟点 */
    dusk: { winter: 17 * 60, spring: 18 * 60 + 30, summer: 20 * 60, autumn: 18 * 60 + 30 } as Record<Season, number>,
    homeMarginMinutes: 30,
    lateWarningMinute: 21 * 60 + 30,
    collapseMinute: 24 * 60,
    areas: { pineForest: { name: "松林", travelMinutes: 20 } } as Record<string, { name: string; travelMinutes: number }>,
  },
  /**
   * 02、03 没有写明、实现时补的初值。每一项在
   * 设计/讨论记录/2026-11-13_06灰盒实现差异与默认_Claude.md 里有一条说明。
   */
  IMPL: {
    lightFireMinutes: 20,
    tendFireMinutes: 3,
    /** 离开前看火够不够烧到回来时，多留的余量 */
    fireMarginMinutes: 10,
    wakeUpMinutes: 5,
    fetchWaterMinutes: 30,
    boilWaterMinutes: 10,
    observeMinutes: 10,
    bankFireMinutes: 5,
    drinkMinutes: 3,
    thirstIntervalMinutes: 240,
    harvestMinutes: 30,
    plantMinutes: 20,
    conesMinutes: 1,
    swapStyleMinutes: 5,
    /** 俭的日子早些睡 */
    thriftBedMinute: 21 * 60,
    /** 每做满一段项目，这天就此收工的机会 */
    projectStopChance: { normal: 0.1, rich: 0.2 },
    projectBreakMinutes: 15,
    /** 木雕没被置顶时，他自己最多刻几件 */
    autoCarvings: 2,
    /** 昏倒后背包里的柴粮丢掉的比例 */
    collapseLossRatio: 0.5,
    /** 世界手记保留最近多少个游戏日的逐条事件；更早的只留每日小结 */
    eventKeepDays: 12,
  },
  heartbeat: {
    /** 两次心跳的间隔不超过这个数，且单调钟和墙上钟对得上，才算「确认在运行」 */
    trustGapMs: 120_000,
    /** 墙上钟比单调钟多走了这么多，判为休眠（或时钟被往后拨），不给「算进去」的选择 */
    sleepSkewMs: 30_000,
  },
};

export type Config = typeof CONFIG;
