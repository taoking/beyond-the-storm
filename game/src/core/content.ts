// 内容表：地点、修缮和慢事、作物、样式。来自 设计/03_主要内容.md。
import type { Season } from "./config.ts";

// ---------- 地点 ----------

/** indoor 屋里；eaves 屋檐和背风处（泉屋、防风林近处）；yard 院子；nearby 屋边；away 你带他去的野外 */
export type Zone = "indoor" | "eaves" | "yard" | "nearby" | "away";

export const PLACES = {
  bed: { name: "床", zone: "indoor" },
  hearth: { name: "壁炉", zone: "indoor" },
  woodpile: { name: "柴堆", zone: "indoor" },
  stove: { name: "灶台", zone: "indoor" },
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
  cellar: { name: "地窖口", zone: "indoor" },
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

export type Material = "lumber" | "rope" | "canvas" | "glass" | "metal" | "parts" | "cloth" | "hide";
export const MATERIAL_NAME: Record<Material, string> = {
  lumber: "木料",
  rope: "旧绳索",
  canvas: "帆布",
  glass: "玻璃",
  metal: "金属件",
  parts: "零件",
  cloth: "布料",
  hide: "皮子",
};

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
  | "book";

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
    where: "indoor",
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
    stages: stagesOf(three(15), ["旧管拆掉了", "新管接到短廊", "灶台边能出水了"], [{ metal: 2 }, { metal: 2 }, { metal: 1 }]),
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
    doing: "在削木雕",
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
];

export const PROJECT_BY_ID: Record<string, ProjectDef> = Object.fromEntries(PROJECTS.map((p) => [p.id, p]));

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

export type TaskCategory = "study" | "code" | "write" | "other";
export const CATEGORY_NAME: Record<TaskCategory, string> = {
  study: "学习阅读",
  code: "编程工作",
  write: "写作创作",
  other: "其他",
};
