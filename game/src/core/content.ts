// 内容表：地点、修缮和慢事、作物、样式。来自 设计/03_主要内容.md。
import type { Season } from "./config.ts";

// ---------- 地点 ----------

/** indoor 屋里；eaves 屋檐和背风处（泉屋、防风林近处）；yard 院子；nearby 屋边；away 你带他去的野外 */
export type Zone = "indoor" | "eaves" | "yard" | "nearby" | "away";

export const PLACES = {
  bed: { name: "床", zone: "indoor" },
  hearth: { name: "柴炉", zone: "indoor" },
  woodpile: { name: "柴堆", zone: "indoor" },
  stove: { name: "料理台", zone: "indoor" },
  shelf: { name: "储物架", zone: "indoor" },
  desk: { name: "书桌", zone: "indoor" },
  bookshelf: { name: "书架", zone: "indoor" },
  workbench: { name: "工作台", zone: "indoor" },
  radio: { name: "收音机", zone: "indoor" },
  gramophone: { name: "唱片机", zone: "indoor" },
  armchair: { name: "扶手椅", zone: "indoor" },
  window: { name: "雪窗", zone: "indoor" },
  windowsill: { name: "窗台", zone: "indoor" },
  instruments: { name: "仪器角", zone: "indoor" },
  cellar: { name: "地窖口", zone: "yard" },
  backdoor: { name: "后门", zone: "indoor" },
  door: { name: "门和衣架", zone: "indoor" },
  springhouse: { name: "泉屋", zone: "eaves" },
  windbreak: { name: "防风林", zone: "eaves" },
  choppingBlock: { name: "劈柴墩", zone: "yard" },
  garden: { name: "菜地", zone: "yard" },
  greenhouse: { name: "暖棚", zone: "yard" },
  dryingRack: { name: "晾架", zone: "yard" },
  vane: { name: "风向标和百叶箱", zone: "yard" },
  solar: { name: "太阳能板", zone: "yard" },
  gate: { name: "院门", zone: "yard" },
  forestEdge: { name: "林子边缘", zone: "nearby" },
  creekBend: { name: "泉溪下游的湾", zone: "nearby" },
  wild: { name: "野外", zone: "away" },
} as const satisfies Record<string, { name: string; zone: Zone }>;

export type PlaceId = keyof typeof PLACES;

export function zoneOf(place: PlaceId): Zone {
  return PLACES[place].zone;
}

// ---------- 修缮和慢事 ----------

export type Material = "lumber" | "rope" | "canvas" | "glass" | "metal" | "parts" | "cloth" | "hide" | "film";
export const MATERIAL_NAME: Record<Material, string> = {
  lumber: "木料",
  rope: "旧绳索",
  canvas: "帆布",
  glass: "玻璃",
  metal: "金属件",
  parts: "零件",
  cloth: "布料",
  hide: "皮子",
  film: "胶卷",
};
export const MATERIALS = Object.keys(MATERIAL_NAME) as Material[];

export type ProjectEffect =
  | "saveWood" // 每天的柴用度减 1
  | "woodCap" // 柴的上限 80 → 120
  | "foodCap" // 粮的上限 60 → 90
  | "fence" // 菜地每格多收 1 餐
  | "greenhouse" // 暖棚 2 格
  | "piped" // 不用每天提水
  | "power" // 屋里有电灯
  | "gramophone"
  | "dryingRack"
  | "radio"
  | "forecast" // 能看明天的天气
  | "handbook" // 能看出当天下午的变化
  | "carving"
  | "book"
  // 03 第 7.2 节：要去近处带回素材的慢事
  | "fishingRod" // 能在溪谷和冰湖钓大鱼（工具，那两处还没做）
  | "bow" // 能远处打猎（工具，动物还没做）
  | "lantern" // 傍晚和夜里看得清（工具）
  | "bigPack" // 背包多 6 格
  | "photo" // 冲洗胶卷：一张照片，上照片墙
  | "northernPlants"; // 认得更多能采的植物：近处多出新的采集点

/** 做完就拿在手上的工具（03 第 6.4 节），快照里列出来 */
export const TOOL_NAME: Partial<Record<ProjectEffect, string>> = { fishingRod: "钓竿", bow: "弓", lantern: "提灯", bigPack: "大背包" };

export interface ProjectDef {
  id: string;
  name: string;
  kind: "repair" | "craft" | "read";
  /** 每个阶段的工时（游戏小时）和材料 */
  stages: { hours: number; materials?: Partial<Record<Material, number>>; look: string }[];
  where: "indoor" | "yard";
  place: PlaceId;
  effect: ProjectEffect;
  /** 基础修缮：材料在屋里、旧木料堆和院子里就有，不出门也能做完 */
  base?: boolean;
  /** 要先做完哪一件 */
  requires?: string;
  repeatable?: boolean;
  /** 开局不知道，要先拿到这样东西才出现在手头的事里（02 第 7.3 节的「没发现」） */
  discover?: { keepsake?: string; material?: Material };
  /** 能反复做的事做完一回得到什么藏品（KEEPSAKES 的 id；"photo" 按 FILM_PHOTOS 的先后） */
  yields?: string;
  /** 动作卡上的字 */
  doing: string;
}

const three = (total: number): [number, number, number] => {
  const a = Math.floor(total / 3);
  return [a, a, total - 2 * a];
};

function stagesOf(
  hours: number[],
  looks: string[],
  materials: (Partial<Record<Material, number>> | undefined)[] = [],
): ProjectDef["stages"] {
  return hours.map((h, i) => ({ hours: h, look: looks[i], materials: materials[i] }));
}

/** 顺序就是他自己的习惯：先保暖，再存和产，再享受；然后是动手的慢事；读书在最后。 */
export const PROJECTS: ProjectDef[] = [
  {
    id: "windowGaps",
    base: true,
    name: "补窗缝",
    kind: "repair",
    stages: stagesOf([3, 3], ["毡条塞好了", "泥灰抹平了"]),
    where: "indoor",
    place: "window",
    effect: "saveWood",
    doing: "在补窗缝",
  },
  {
    id: "woodshed",
    base: true,
    name: "搭柴棚",
    kind: "repair",
    stages: stagesOf(three(18), ["立柱", "上梁", "铺顶"], [{ lumber: 4 }, { lumber: 4 }, { lumber: 2 }]),
    where: "yard",
    place: "choppingBlock",
    effect: "woodCap",
    doing: "在搭柴棚",
  },
  {
    id: "cellar",
    base: true,
    name: "整理地窖",
    kind: "repair",
    stages: stagesOf(three(15), ["杂物搬开了", "架子擦干净了", "地窖能用了"]),
    where: "yard",
    place: "cellar",
    effect: "foodCap",
    doing: "在整理地窖",
  },
  {
    id: "fence",
    base: true,
    name: "修篱笆",
    kind: "repair",
    stages: stagesOf([4, 4], ["桩子立起来了", "篱笆编好了"], [{ lumber: 2 }, { lumber: 2 }]),
    where: "yard",
    place: "garden",
    effect: "fence",
    doing: "在修篱笆",
  },
  {
    id: "dryingRack",
    base: true,
    name: "修晾架",
    kind: "repair",
    stages: stagesOf([3, 3], ["架子扶起来了", "横杆装好了"], [{ lumber: 2 }, { lumber: 1 }]),
    where: "yard",
    place: "dryingRack",
    effect: "dryingRack",
    doing: "在修晾架",
  },
  {
    id: "bedding",
    name: "加厚床褥、挂窗帘",
    kind: "repair",
    stages: stagesOf([4, 4], ["床褥缝厚了", "窗帘挂上了"], [{ cloth: 2 }, { cloth: 2 }]),
    where: "indoor",
    place: "bed",
    effect: "saveWood",
    doing: "在缝床褥",
  },
  {
    id: "greenhouse",
    name: "修暖棚",
    kind: "repair",
    stages: stagesOf(
      [9, 9, 9, 9],
      ["骨架扶正了", "一面玻璃装上了", "帆布蒙好了", "暖棚能用了"],
      [{ lumber: 4 }, { glass: 3 }, { canvas: 2 }, { glass: 3 }],
    ),
    where: "yard",
    place: "greenhouse",
    effect: "greenhouse",
    doing: "在修暖棚",
  },
  {
    id: "waterPipe",
    name: "接水管",
    kind: "repair",
    stages: stagesOf(three(15), ["旧管拆掉了", "新管接到短廊", "料理台边能出水了"], [{ metal: 2 }, { metal: 2 }, { metal: 1 }]),
    where: "indoor",
    place: "stove",
    effect: "piped",
    doing: "在接水管",
  },
  {
    id: "solar",
    name: "修太阳能板",
    kind: "repair",
    stages: stagesOf(
      [10, 10, 10, 10],
      ["支架紧好了", "线路理清了", "电池接上了", "屋里有电了"],
      [{ metal: 2 }, { parts: 2 }, { parts: 2 }, { metal: 1 }],
    ),
    where: "yard",
    place: "solar",
    effect: "power",
    doing: "在修太阳能板",
  },
  {
    id: "gramophone",
    name: "修唱片机",
    kind: "repair",
    stages: stagesOf(three(15), ["拆开清了灰", "换了皮带和针", "能转了"], [{ parts: 1 }, { parts: 2 }, { parts: 1 }]),
    where: "indoor",
    place: "gramophone",
    effect: "gramophone",
    requires: "solar",
    doing: "在修唱片机",
  },
  {
    id: "radio",
    name: "修收音机",
    kind: "craft",
    stages: stagesOf(three(18), ["拆开了", "线圈重新绕过", "有声音了"]),
    where: "indoor",
    place: "workbench",
    effect: "radio",
    doing: "在修收音机",
  },
  {
    id: "weatherRecords",
    name: "整理气象记录",
    kind: "craft",
    stages: stagesOf(three(24), ["按年份分开了", "抄清了一半", "整理完了"]),
    where: "indoor",
    place: "desk",
    effect: "forecast",
    doing: "在整理气象记录",
  },
  {
    id: "carving",
    name: "削木雕",
    kind: "craft",
    stages: stagesOf([3, 3], ["有了大样", "刻完了"]),
    where: "indoor",
    place: "workbench",
    effect: "carving",
    repeatable: true,
    yields: "carving",
    doing: "在削木雕",
  },
  // 03 第 7.2 节：要去近处带回素材。材料见 03 第 3.4 节；工时、阶段按 7.2 节的表
  {
    id: "fishingRod",
    name: "做钓竿",
    kind: "craft",
    stages: stagesOf([4, 4], ["竿身削好了", "装上了线轮和钩"], [{ lumber: 1 }, { metal: 1 }]),
    where: "indoor",
    place: "workbench",
    effect: "fishingRod",
    doing: "在做钓竿",
  },
  {
    id: "bow",
    name: "做弓",
    kind: "craft",
    stages: stagesOf(three(18), ["弓身削出来了", "弯好定了形", "上了弦"], [{ lumber: 1, rope: 1 }, { lumber: 1 }, { rope: 1 }]),
    where: "indoor",
    place: "workbench",
    effect: "bow",
    doing: "在做弓",
  },
  {
    id: "lantern",
    name: "修提灯",
    kind: "craft",
    stages: stagesOf([3, 3], ["灯罩擦净、换了芯", "提梁修好了"], [{ metal: 1 }, { metal: 1 }]),
    where: "indoor",
    place: "workbench",
    effect: "lantern",
    doing: "在修提灯",
  },
  {
    id: "bigPack",
    name: "缝大背包",
    kind: "craft",
    stages: stagesOf(three(18), ["帆布裁好了", "缝上了皮底", "背带缝牢了"], [{ canvas: 1 }, { canvas: 1, hide: 1 }, { hide: 2 }]),
    where: "indoor",
    place: "workbench",
    effect: "bigPack",
    doing: "在缝大背包",
  },
  {
    id: "developFilm",
    name: "冲洗胶卷",
    kind: "craft",
    stages: stagesOf([3, 3], ["显了影", "晾干了"], [{ film: 1 }]),
    where: "indoor",
    place: "workbench",
    effect: "photo",
    repeatable: true,
    yields: "photo",
    discover: { material: "film" },
    doing: "在冲洗胶卷",
  },
  {
    id: "handbook",
    name: "读《观测员手册》",
    kind: "read",
    stages: stagesOf(three(15), ["读了三分之一", "读了大半", "读完了"]),
    where: "indoor",
    place: "desk",
    effect: "handbook",
    doing: "在读《观测员手册》",
  },
  ...["书架上的第一本书", "书架上的第二本书", "书架上的食谱"].map(
    (name, i): ProjectDef => ({
      id: `book${i + 1}`,
      name: `读${name}`,
      kind: "read",
      stages: stagesOf(three(15), ["读了三分之一", "读了大半", "读完了"]),
      where: "indoor",
      place: "desk",
      effect: "book",
      doing: `在读${name}`,
    }),
  ),
  {
    id: "northernPlants",
    name: "读《北方草木》",
    kind: "read",
    stages: stagesOf(three(15), ["读了三分之一", "读了大半", "读完了"]),
    where: "indoor",
    place: "desk",
    effect: "northernPlants",
    discover: { keepsake: "northernPlants" },
    doing: "在读《北方草木》",
  },
];

export const PROJECT_BY_ID: Record<string, ProjectDef> = Object.fromEntries(PROJECTS.map((p) => [p.id, p]));

// ---------- 等的慢事：腌、晾（03 第 7.3 节） ----------

/**
 * 食材里有名目的几样（都算在 stock.ingredients 之内，02 第 5.3 节照旧按食材吃）：
 * pickles 腌菜、jerky 肉干鱼干、rawMeat 生肉和大鱼、mint 野薄荷。其余的食材（松子、浆果……）不分名目。
 */
export type PantryKind = "pickles" | "jerky" | "rawMeat" | "mint";
export const PANTRY_NAME: Record<PantryKind, string> = { pickles: "腌菜", jerky: "肉干鱼干", rawMeat: "生肉、大鱼", mint: "野薄荷" };

/** pickles 腌菜（地窖口的坛子）、jerky 肉干鱼干、herbTea 药草茶（晾架） */
export type CureKind = "pickles" | "jerky" | "herbTea";

export interface CureDef {
  name: string;
  /** 在哪等：地窖口的坛子、院里的晾架 */
  place: "cellar" | "dryingRack";
  /** 要先做完哪件修缮 */
  needs: "cellar" | "dryingRack";
  /** 拿什么做：白菜是收菜时留下的，其余是储物架上有名目的食材 */
  from: "cabbage" | PantryKind;
  /** 等几天（03 第 7.3 节） */
  days: number;
  /** 下坛、上架、取下来时动作卡上的字 */
  putLabel: string;
  takeLabel: string;
}

export const CURES: Record<CureKind, CureDef> = {
  pickles: { name: "腌菜", place: "cellar", needs: "cellar", from: "cabbage", days: 3, putLabel: "在地窖口腌白菜", takeLabel: "从地窖口取腌菜" },
  jerky: { name: "肉干鱼干", place: "dryingRack", needs: "dryingRack", from: "rawMeat", days: 2, putLabel: "在晾架上挂肉和鱼", takeLabel: "从晾架上收肉干" },
  herbTea: { name: "药草茶", place: "dryingRack", needs: "dryingRack", from: "mint", days: 2, putLabel: "在晾架上晾薄荷", takeLabel: "从晾架上收薄荷" },
};

// ---------- 作物 ----------

export interface CropDef {
  id: "radish" | "cabbage" | "potato";
  name: string;
  days: number;
  meals: number;
  /** 菜地里能种的季节；暖棚四季都行 */
  seasons: Season[];
}

export const CROPS: CropDef[] = [
  { id: "radish", name: "萝卜", days: 4, meals: 4, seasons: ["spring", "summer", "autumn"] },
  { id: "cabbage", name: "白菜", days: 5, meals: 5, seasons: ["summer", "autumn"] },
  { id: "potato", name: "土豆", days: 6, meals: 6, seasons: ["spring", "summer"] },
];
export const CROP_BY_ID = Object.fromEntries(CROPS.map((c) => [c.id, c])) as Record<CropDef["id"], CropDef>;

// ---------- 份解锁的样式（首版前 8 件） ----------

export type StyleSlot = "lamp" | "sound" | "windowsill" | "armchair" | "deskCorner" | "idle" | "scarf";

export interface StyleDef {
  id: string;
  name: string;
  slot: StyleSlot;
  /** 实物要他亲手去换；灯光和声音立刻生效 */
  physical: boolean;
}

/** 下标对应 CONFIG.shares.styleThresholds */
export const STYLES: StyleDef[] = [
  { id: "lampAmber", name: "灯光：琥珀", slot: "lamp", physical: false },
  { id: "soundKettle", name: "声景：水壶轻沸", slot: "sound", physical: false },
  { id: "plant", name: "一小盆绿植", slot: "windowsill", physical: true },
  { id: "blanketGreen", name: "毛毯：墨绿格", slot: "armchair", physical: true },
  { id: "lampCandle", name: "灯光：烛光", slot: "lamp", physical: false },
  { id: "enamelCup", name: "旧搪瓷杯", slot: "deskCorner", physical: true },
  { id: "idleWaterPlant", name: "闲暇动作：给绿植浇水", slot: "idle", physical: false },
  { id: "scarfMustard", name: "围巾：芥黄", slot: "scarf", physical: true },
];

/** 开局就有的默认样式，不放进解锁 */
export const DEFAULT_STYLE: Record<StyleSlot, string> = {
  lamp: "lampWarm",
  sound: "none",
  windowsill: "none",
  armchair: "blanketPlain",
  deskCorner: "none",
  idle: "none",
  scarf: "scarfRed",
};

// ---------- 藏品和六处展示位（03 第 3.1、6.5 节） ----------

/** 六处固定展示位，id 跟 room_locations.json 的 displaySlots 一致 */
export type DisplaySlotId = "photo_wall" | "hearth_shelf" | "windowsill" | "desk_corner" | "bedside" | "wall_spare";
export const DISPLAY_SLOT_IDS: DisplaySlotId[] = ["photo_wall", "hearth_shelf", "windowsill", "desk_corner", "bedside", "wall_spare"];

export function emptyDisplay(): Record<DisplaySlotId, string[]> {
  return Object.fromEntries(DISPLAY_SLOT_IDS.map((id) => [id, []])) as unknown as Record<DisplaySlotId, string[]>;
}

export interface DisplaySlotDef {
  name: string;
  /** 他去摆的时候站在哪 */
  place: PlaceId;
  /** 一直占着一格的东西（窗台的玻璃罐） */
  fixed?: string;
  /** 这一处的样式位：样式有固定的一格，不跟藏品抢（03 第 4.1 节） */
  style?: StyleSlot;
}

export const DISPLAY_SLOTS: Record<DisplaySlotId, DisplaySlotDef> = {
  photo_wall: { name: "照片墙", place: "hearth" },
  hearth_shelf: { name: "炉上搁板", place: "hearth" },
  windowsill: { name: "窗台", place: "windowsill", fixed: "玻璃罐", style: "windowsill" },
  desk_corner: { name: "书桌一角", place: "desk", style: "deskCorner" },
  bedside: { name: "床头", place: "bed" },
  wall_spare: { name: "卧室的墙上", place: "bed" },
};

/**
 * photo 照片（照片墙）、ornament 小摆件和标本（窗台、炉上搁板）、oldThing 旧物（书桌一角），03 第 6.5 节。
 * book 是带回来的书，上书架，不占展示位。床头、卧室墙上 03 没说放什么，先按 IMPL 的做法：床头放小东西，墙上挂照片。
 */
export type KeepsakeKind = "photo" | "ornament" | "oldThing" | "book";

/** 每类藏品能摆在哪几处，按这个顺序找空位 */
export const KEEPSAKE_FITS: Record<KeepsakeKind, DisplaySlotId[]> = {
  photo: ["photo_wall", "wall_spare"],
  ornament: ["windowsill", "hearth_shelf", "bedside"],
  oldThing: ["desk_corner", "bedside"],
  book: [],
};

export interface KeepsakeDef {
  id: string;
  name: string;
  kind: KeepsakeKind;
  /** 能有好几件（木雕）；其余独一份 */
  repeatable?: boolean;
  /** 不写就按 KEEPSAKE_FITS 的类别 */
  fits?: DisplaySlotId[];
}

/** 首个可玩版的几件（03 第 0 节：2–3 件）。以后的照片、鹿角、怀表……做到对应的区域和慢事时再加 */
export const KEEPSAKES: KeepsakeDef[] = [
  // 木雕：03 第 4.4 节「摆在窗台或炉上搁板」
  { id: "carving", name: "小木雕", kind: "ornament", repeatable: true, fits: ["windowsill", "hearth_shelf"] },
  { id: "jayFeather", name: "一根松鸦的羽毛", kind: "ornament" },
  { id: "postcard", name: "工棚里的一张旧明信片", kind: "oldThing" },
  { id: "northernPlants", name: "《北方草木》", kind: "book" },
  // 冲洗胶卷得到的照片（03 第 7.2 节）：按冲洗的先后给，松林工棚那一卷是第一张
  { id: "photoShed", name: "一张旧照片：几个伐木工站在工棚前", kind: "photo" },
  { id: "photo", name: "一张冲洗出来的照片", kind: "photo", repeatable: true },
];

/** 冲洗胶卷按先后给的照片；都有了以后给不带名目的「photo」 */
export const FILM_PHOTOS = ["photoShed"];
export const KEEPSAKE_BY_ID: Record<string, KeepsakeDef> = Object.fromEntries(KEEPSAKES.map((k) => [k.id, k]));

export type TaskCategory = "study" | "code" | "write" | "other";
export const CATEGORY_NAME: Record<TaskCategory, string> = {
  study: "学习阅读",
  code: "编程工作",
  write: "写作创作",
  other: "其他",
};

// ---------- 野外的区域（03 第 5.1 节） ----------

/** 背包里能装的东西：柴按根、干粮按份，其余按件 */
export type Goods = "wood" | "ingredients" | "fuel" | "cans" | Material;

/**
 * 资源点。kind 决定采一次花多久、给多少、多久恢复（数在 config.ts 的 IMPL.wild.gather）：
 * twigs 枯枝、forage 松子浆果这类、salvage 旧世界留下的东西（独一份，拿一件少一件）。
 */
export interface NodeDef {
  id: string;
  name: string;
  x: number;
  y: number;
  kind: "twigs" | "forage" | "salvage";
  /** 给的东西；藏品点是 null，拿到的是 keepsake */
  gives: Goods | null;
  /** salvage 一共放了几件（03 第 3.4 节的账） */
  total?: number;
  /** 只在这几个季节有；不写是四季都有 */
  seasons?: Season[];
  /** 是一件藏品（KEEPSAKES 的 id）：不占背包格，带回家才算拿到；kind 是 salvage、total 是 1 */
  keepsake?: string;
  /** 要先有这个效果才认得、才看得见（读完《北方草木》多出来的采集点） */
  needs?: ProjectEffect;
}

export interface AreaDef {
  id: string;
  name: string;
  /** 从这个区域的回家出口走回家门要几个游戏分钟（03 第 5.1 节的单程路程） */
  homeMinutes: number;
  /** 地形：# 走不过去（密林、石堆），. 能走 */
  map: string[];
  /** 出口：站在这一格才能离开。to 是去哪，home 是回家 */
  exits: { x: number; y: number; to: "home" | string }[];
  /** 从家里来时落脚的那一格 */
  entry: { x: number; y: number };
  /** 固定的生火点 */
  fires: { x: number; y: number }[];
  nodes: NodeDef[];
}

export const AREAS: AreaDef[] = [
  {
    id: "pineForest",
    name: "松林",
    homeMinutes: 20,
    map: [
      "###############",
      "#.....#.......#",
      "#..........##.#",
      "#...##........#",
      "..............#",
      "#...###.......#",
      "#.......#.....#",
      "#.............#",
      "###############",
    ],
    exits: [{ x: 0, y: 4, to: "home" }],
    entry: { x: 0, y: 4 },
    fires: [
      { x: 2, y: 6 },
      { x: 10, y: 4 },
    ],
    nodes: [
      { id: "twigsA", name: "枯枝堆", x: 4, y: 1, kind: "twigs", gives: "wood" },
      { id: "twigsB", name: "松树下的枯枝", x: 6, y: 7, kind: "twigs", gives: "wood" },
      { id: "pineNuts", name: "松子", x: 9, y: 1, kind: "forage", gives: "ingredients", seasons: ["autumn", "winter"] },
      { id: "berries", name: "浆果", x: 10, y: 7, kind: "forage", gives: "ingredients", seasons: ["winter", "summer", "autumn"] },
      // 读完《北方草木》才认得的两样（03 第 7.2 节「近处多出新的采集点」）。选了松林春天空着的那一段
      { id: "lingonberry", name: "林下的越橘", x: 2, y: 2, kind: "forage", gives: "ingredients", seasons: ["autumn", "winter", "spring"], needs: "northernPlants" },
      { id: "wildOnion", name: "背阴坡的野葱", x: 7, y: 3, kind: "forage", gives: "ingredients", seasons: ["spring", "summer"], needs: "northernPlants" },
      // 废弃的伐木工棚。种子、旧工具内核里还没有，先不放
      { id: "shedLumber", name: "工棚的旧木料", x: 12, y: 3, kind: "salvage", gives: "lumber", total: 10 },
      { id: "shedRope", name: "工棚的旧绳索", x: 13, y: 4, kind: "salvage", gives: "rope", total: 3 },
      { id: "shedCanvas", name: "工棚的帆布", x: 12, y: 5, kind: "salvage", gives: "canvas", total: 5 },
      { id: "shedFuel", name: "工棚的一罐油", x: 13, y: 6, kind: "salvage", gives: "fuel", total: 1 },
      { id: "shedCan", name: "工棚的罐头", x: 11, y: 6, kind: "salvage", gives: "cans", total: 1 },
      { id: "shedFilm", name: "工棚抽屉里的一卷胶卷", x: 12, y: 6, kind: "salvage", gives: "film", total: 1 },
      { id: "shedBook", name: "工棚里的一本书", x: 13, y: 2, kind: "salvage", gives: null, total: 1, keepsake: "northernPlants" },
      { id: "shedPostcard", name: "工棚窗台上的明信片", x: 11, y: 3, kind: "salvage", gives: null, total: 1, keepsake: "postcard" },
      // 藏品：林子里的一根羽毛（03 第 6.5 节的标本）
      { id: "feather", name: "雪地上的一根羽毛", x: 3, y: 7, kind: "salvage", gives: null, total: 1, keepsake: "jayFeather" },
    ],
  },
];

export const AREA_BY_ID: Record<string, AreaDef> = Object.fromEntries(AREAS.map((a) => [a.id, a]));

export const GOODS_NAME: Record<Goods, string> = { wood: "柴", ingredients: "食材", fuel: "燃油", cans: "罐头", ...MATERIAL_NAME };
