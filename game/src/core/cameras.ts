// 镜头里看得见哪些地点。这是表现层的假设，不是世界事实：
// 05 的母场景和裁切还没有定稿，定了以后只改这张表，模拟不用动。
import { PLACES, type PlaceId } from "./content.ts";

export type CameraId = "window" | "hearth" | "wideIndoor" | "wideYard";

const indoor = (Object.keys(PLACES) as PlaceId[]).filter((p) => PLACES[p].zone === "indoor");
const yard = (Object.keys(PLACES) as PlaceId[]).filter((p) => PLACES[p].zone === "yard");

export const CAMERAS: Record<CameraId, { name: string; note: string; places: PlaceId[] }> = {
  window: {
    name: "雪窗小窗",
    note: "按 04 第 19.1 节、05 第 9.1 节的窗下书桌构图：雪窗、窗台、窗下的书桌在同一个裁切里。不是旧试片的裁切。",
    places: ["window", "windowsill", "desk"],
  },
  hearth: {
    name: "炉边小窗",
    note: "壁炉、扶手椅、灶台和水壶、仪器角（05 试片里炉边那一区的东西）。",
    places: ["hearth", "armchair", "stove", "instruments"],
  },
  wideIndoor: {
    name: "全景（只有屋里）",
    note: "05 现有试片的全景只画了屋里。",
    places: indoor,
  },
  wideYard: {
    name: "全景（屋里加院子）",
    note: "04 第 3.1 节说的「屋内＋院子的全景」。泉屋、防风林、林子边缘、溪湾不在里面。",
    places: [...indoor, ...yard],
  },
};

export const CAMERA_IDS = Object.keys(CAMERAS) as CameraId[];

export function visibleIn(camera: CameraId, place: PlaceId): boolean {
  return CAMERAS[camera].places.includes(place);
}
