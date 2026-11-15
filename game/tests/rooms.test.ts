// 木屋分四间（03 第 3.1 节）：地点归哪间读 05 的 room_locations.json，内核的地点和它对得上。
import { describe, expect, it } from "vitest";
import { PLACES, PROJECT_BY_ID, type PlaceId } from "../src/core/content.ts";
import { advanceMinutes, createWorld } from "../src/core/sim.ts";
import { CANVAS, DEFAULT_ROOM, JSON_DEFAULT_ROOM, LOCATIONS, placesIn, ROOM_IDS, ROOMS, roomOf, UNKNOWN_LOCATIONS } from "../src/core/rooms.ts";

/** 03 第 3.1 节的表 */
const TABLE: Record<string, PlaceId[]> = {
  hearth_room: ["hearth", "woodpile", "armchair", "radio", "gramophone"],
  observation_room: ["window", "windowsill", "desk", "bookshelf", "instruments"],
  kitchen_room: ["stove", "shelf", "workbench", "door", "backdoor"],
  bedroom: ["bed"],
};

describe("四间和 room_locations.json", () => {
  it("JSON 是 2560×1440，四间就是这四间，默认显示观测间", () => {
    expect(CANVAS).toEqual([2560, 1440]);
    expect(ROOM_IDS.map((r) => ROOMS[r].name)).toEqual(["炉间", "观测间", "灶间", "卧室"]);
    expect(DEFAULT_ROOM).toBe("observation_room");
    expect(JSON_DEFAULT_ROOM).toBe(DEFAULT_ROOM);
  });

  it("JSON 里的地点 id 内核都有", () => {
    expect(UNKNOWN_LOCATIONS).toEqual([]);
  });

  it("各间有什么和 03 第 3.1 节一致", () => {
    for (const r of ROOM_IDS) expect(placesIn(r).sort()).toEqual([...TABLE[r]].sort());
  });

  it("屋里的地点都在某一间，屋外的都不在", () => {
    for (const id of Object.keys(PLACES) as PlaceId[]) {
      expect(roomOf(id) !== null, id).toBe(PLACES[id].zone === "indoor");
    }
  });

  it("地窖口在院子，整理地窖算院子里的活", () => {
    expect(PLACES.cellar.zone).toBe("yard");
    expect(roomOf("cellar")).toBe(null);
    expect(PROJECT_BY_ID.cellar.where).toBe("yard");
  });

  it("柴炉和料理台的名字和 JSON 的标签一样", () => {
    expect(PLACES.hearth.name).toBe("柴炉");
    expect(PLACES.stove.name).toBe("料理台");
    expect(LOCATIONS.hearth?.label).toBe(PLACES.hearth.name);
    expect(LOCATIONS.stove?.label).toBe(PLACES.stove.name);
  });

  it("屋里每个地点都有站位；六处展示位分在炉间、观测间、卧室", () => {
    for (const r of ROOM_IDS) for (const p of placesIn(r)) expect(LOCATIONS[p]?.foot, p).toHaveLength(2);
    const slots = Object.fromEntries(ROOM_IDS.map((r) => [r, ROOMS[r].displaySlots.map((s) => s.id)]));
    expect(slots).toEqual({
      hearth_room: ["photo_wall", "hearth_shelf"],
      observation_room: ["windowsill", "desk_corner"],
      kitchen_room: [],
      bedroom: ["bedside", "wall_spare"],
    });
  });
});

describe("一处火：烧水、泡茶在柴炉，做饭在料理台（03 第 3.1 节）", () => {
  it("一个月里烧水、喝水、泡茶都在柴炉边，做饭在料理台", () => {
    const w = createWorld(3);
    const seen = new Map<string, Set<PlaceId>>();
    for (let i = 0; i < 30 * 1440; i++) {
      advanceMinutes(w, 1);
      const a = w.actor.activity;
      if (!a) continue;
      const key = a.kind === "leisure" || a.kind === "request" ? `${a.kind}:${a.data.id ?? a.data.kind}` : a.kind;
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key)!.add(w.actor.place);
    }
    expect([...seen.get("boilWater")!]).toEqual(["hearth"]);
    expect([...seen.get("drink")!]).toEqual(["hearth"]);
    expect([...seen.get("leisure:tea")!].sort()).toEqual(["armchair", "hearth"]);
    expect(seen.get("meal")!.has("stove")).toBe(true);
    expect(seen.get("meal")!.has("hearth")).toBe(false);
  });
});
