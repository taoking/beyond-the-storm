// 木屋的四间（03 第 3.1 节）：画面只显示玩家选定的那一间，不跟着他走，他不在就是空屋。
// 地点归哪间、门洞、展示位、窗、站位都读 05 的 room_locations.json，这是唯一的一份坐标（2560×1440）。
// 这里只读，不是世界事实：模拟不看房间，换了图只改那份 JSON。
import locations from "../../../assets/05/rooms/b1_20261116/room_locations.json" with { type: "json" };
import { PLACES, type PlaceId } from "./content.ts";

export type RoomId = "hearth_room" | "observation_room" | "kitchen_room" | "bedroom";

/** 炉间在中间，其余三间的门开向它 */
export const ROOM_IDS: RoomId[] = ["hearth_room", "observation_room", "kitchen_room", "bedroom"];
export const DEFAULT_ROOM: RoomId = "observation_room";

type Point = [number, number];
type Rect = [number, number, number, number];

export interface RoomDef {
  name: string;
  /** 外窗的玻璃，每块一个多边形 */
  panes: Point[][];
  doorways: { to: string; polygon?: Point[]; offscreen?: boolean }[];
  displaySlots: { id: string; rect: Rect }[];
  lamp: Point;
}

export interface LocationDef {
  room: RoomId | null;
  label: string;
  foot: Point | null;
  heightPx: number | null;
}

interface RawRoom {
  name: string;
  windows: { panesCanvasPolygons: number[][][] }[];
  doorways: { to: string; polygon?: number[][]; offscreen?: boolean }[];
  displaySlots: { id: string; rect: number[] }[];
  lampAnchor: number[];
}
interface RawLocation {
  room?: string;
  label: string;
  footAnchor?: number[];
  standingHeightPx?: number;
}

const raw = locations as unknown as {
  canvas: number[];
  architecture: { defaultSelectedRoom: string };
  rooms: Record<string, RawRoom>;
  locations: Record<string, RawLocation>;
};

export const CANVAS: [number, number] = [raw.canvas[0], raw.canvas[1]];

export const ROOMS = Object.fromEntries(
  ROOM_IDS.map((id) => {
    const r = raw.rooms[id];
    const def: RoomDef = {
      name: r.name,
      panes: r.windows.flatMap((w) => w.panesCanvasPolygons as Point[][]),
      doorways: r.doorways.map((d) => ({ to: d.to, polygon: d.polygon as Point[] | undefined, offscreen: d.offscreen })),
      displaySlots: r.displaySlots.map((s) => ({ id: s.id, rect: s.rect as Rect })),
      lamp: r.lampAnchor as Point,
    };
    return [id, def];
  }),
) as Record<RoomId, RoomDef>;

const isRoom = (id: string | undefined): id is RoomId => ROOM_IDS.includes(id as RoomId);

/** JSON 里写到的地点。content.ts 里有、JSON 里没写的地点不在任何一间 */
export const LOCATIONS = Object.fromEntries(
  Object.entries(raw.locations)
    .filter(([id]) => id in PLACES)
    .map(([id, l]) => [
      id,
      {
        room: isRoom(l.room) ? l.room : null,
        label: l.label,
        foot: (l.footAnchor as Point | undefined) ?? null,
        heightPx: l.standingHeightPx ?? null,
      },
    ]),
) as Partial<Record<PlaceId, LocationDef>>;

/** JSON 里有、content.ts 里没有的地点 id。测试要求它是空的 */
export const UNKNOWN_LOCATIONS = Object.keys(raw.locations).filter((id) => !(id in PLACES));
export const JSON_DEFAULT_ROOM = raw.architecture.defaultSelectedRoom;

/** 这个地点在哪一间；院子、屋外、野外都是 null */
export function roomOf(place: PlaceId): RoomId | null {
  return LOCATIONS[place]?.room ?? null;
}

export function placesIn(room: RoomId): PlaceId[] {
  return (Object.keys(LOCATIONS) as PlaceId[]).filter((p) => roomOf(p) === room);
}

export function visibleIn(room: RoomId, place: PlaceId): boolean {
  return roomOf(place) === room;
}
