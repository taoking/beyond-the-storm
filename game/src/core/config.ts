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
  /** 现实 1 分钟 = 游戏几分钟。户外直控没有速率：世界只随他的动作走（IMPL.wild） */
  rates: { awake: 4, asleep: 120 },
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
    /** 背包（02 第 9.3 节）：20 格；干粮 4 份一格，柴 2 捆（6 根）一格，素材 5 件一格 */
    bagSlots: 20,
    rationsPerSlot: 4,
    woodPerSlot: 6,
    materialsPerSlot: 5,
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
    /**
     * 暂行（D6，等野外的体力、体温、背包做出来再定）：人在外面到了饭点，行囊里有干粮就吃一份；
     * 没有干粮这顿就不吃。这里定的是那一顿算不算缺餐，现在不算。不代表野外可以一直不吃。
     */
    outingMealWithoutRationsIsMissed: false,
    /** 昏倒后背包里的柴粮丢掉的比例 */
    collapseLossRatio: 0.5,
    /** 世界手记保留最近多少个游戏日的逐条事件；更早的只留每日小结 */
    eventKeepDays: 12,
    /**
     * 野外（02 第 9 节，用户 2026-11-14 定「按动作走」）：站着不动世界不走，每个动作花若干游戏分钟。
     * 身体三项都是 0..bodyMax 的整数，显示时换成百分数。下面的「每分钟」都是动作进行中的每个游戏分钟。
     */
    wild: {
      stepMinutes: 2,
      restMinutes: 10,
      eatMinutes: 10,
      lightFireMinutes: 10,
      /** 生火要几根柴（一捆） */
      fireSticks: 3,
      /** 篝火点着以后烧多久；再添一捆接着烧这么久 */
      fireBurnMinutes: 90,
      bodyMax: 10_000,
      /** 每分钟掉的体温：按季节和天气（D 出不了门） */
      chill: {
        winter: { A: 15, B: 25, C: 50 },
        spring: { A: 10, B: 18, C: 40 },
        summer: { A: 4, B: 10, C: 30 },
        autumn: { A: 10, B: 18, C: 40 },
      } as Record<Season, Record<"A" | "B" | "C", number>>,
      /** 天黑以后（当季的 outing.dusk 起）每分钟多掉的体温 */
      nightChill: 20,
      /** 在点着的篝火旁边（同一格或相邻）每分钟回的体温，代替上面的失温 */
      fireWarmth: 150,
      /** 体温见底以后每分钟掉的生命 */
      frostbite: 100,
      /** 各种动作每分钟耗的体力；负数是恢复 */
      stamina: { walk: 25, road: 20, gather: 30, fire: 20, rest: -150, eat: 0 },
      /** 吃一份干粮回的体力（自己吃的和饭点吃的一样） */
      rationStamina: 3_000,
      /** 掉到这里提一句；回到这一线以上再掉下来会再提 */
      coldWarning: 3_000,
      tiredWarning: 2_000,
      /** 食材、燃油、罐头每格几件 */
      otherPerSlot: 5,
      gather: {
        twigs: { minutes: 45, amount: 3, regrowDays: 3 },
        forage: { minutes: 25, amount: 1, regrowDays: 5 },
        /** 旧东西：一次最多拿一格的量 */
        salvage: { minutes: 15, amount: 5, regrowDays: null },
      } as Record<"twigs" | "forage" | "salvage", { minutes: number; amount: number; regrowDays: number | null }>,
    },
  },
  heartbeat: {
    /** 两次心跳的间隔不超过这个数，且单调钟和墙上钟对得上，才算「确认在运行」 */
    trustGapMs: 120_000,
    /** 墙上钟比单调钟多走了这么多，判为休眠（或时钟被往后拨），不给「算进去」的选择 */
    sleepSkewMs: 30_000,
  },
};

export type Config = typeof CONFIG;
