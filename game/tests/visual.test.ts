// G2 只读表现层：有结构化姿态/道具和独立氛围，不改变 02/03/06 事实模型。
import { describe, expect, it } from "vitest";
import { PROJECTS, type PlaceId } from "../src/core/content.ts";
import { CONFIG } from "../src/core/config.ts";
import { dayPartOf, seasonOf } from "../src/core/calendar.ts";
import { CAMERA_IDS, visibleIn } from "../src/core/cameras.ts";
import { deserialize, serialize } from "../src/core/save.ts";
import { fixedCalendar } from "../src/core/focus.ts";
import { advanceCompanionMinutes, cmdEnterAmbience, newGame } from "../src/core/game.ts";
import { dayClock, type Activity, type ActivityKind, type ActorState } from "../src/core/state.ts";
import { present } from "../src/core/view.ts";
import { actorPose, projectedLook } from "../src/core/visual.ts";
import { previewLook, weatherArtKey, WEATHER_ART_KEYS } from "../src/core/weather.ts";

const calendar = fixedCalendar(0);
const wall = 1780000000000;
const makeActivity = (kind: ActivityKind, place: PlaceId, data: Activity["data"] = {}, label = "不用于姿态判断"): Activity => ({
  kind, label, category: "leisure",
  phases: [{ place, minutes: 15 }],
  phase: 0, left: 15, interruptible: true, data,
});
function actor(kind: ActivityKind, place: PlaceId, data: Activity["data"] = {}): ActorState {
  return { place, asleep: false, away: false, outfit: "indoor",
    thirst: 0, leaving: false, activity: makeActivity(kind, place, data) };
}

describe("06 G2 actor pose projection reads structured facts only", () => {
  it("maps sleep and wake at the actual bed", () => {
    expect(actorPose(actor("sleep", "bed")).pose).toBe("sleep");
    expect(actorPose(actor("wake", "bed")).pose).toBe("sit");
  });
  it("maps afternoon construction separately from evening reading", () => {
    const readId = PROJECTS.find(p => p.kind === "read")!.id;
    const repairId = PROJECTS.find(p => p.kind === "repair")!.id;
    expect(actorPose(actor("project", "armchair", { id: readId }))).toMatchObject({pose:"sitRead", prop:"book"});
    expect(actorPose(actor("project", "workbench", { id: repairId }))).toMatchObject({pose:"standWork", prop:"tools"});
  });
  it("keeps cooking and sitting for the same meal as separate prop/pose states", () => {
    expect(actorPose(actor("meal", "stove", {meal:"dinner"}))).toMatchObject({pose:"standWork", prop:"pot"});
    expect(actorPose(actor("meal", "armchair", {meal:"dinner"}))).toMatchObject({pose:"sitHold", prop:"bowl"});
  });
  it("weather-records project means writing and records, not repairing equipment", () => {
    const a = actor("project", "desk", {id:"weatherRecords"});
    expect(actorPose(a)).toMatchObject({pose:"sitWrite",prop:"journal"});
    a.activity!.label="this sentence is not parsed";
    expect(actorPose(a).pose).toBe("sitWrite");
  });
  it("radio listening, bookshelf tidying and cooking never give out repair tools", () => {
    expect(actorPose(actor("leisure","radio",{id:"radio"}))).toMatchObject({pose:"standLook",prop:null});
    expect(actorPose(actor("leisure","bookshelf",{id:"tidyShelf"}))).toMatchObject({pose:"standWork",prop:"book"});
    expect(actorPose(actor("leisure","workbench",{id:"tidyTools"}))).toMatchObject({pose:"standWork",prop:"tools"});
    expect(actorPose(actor("meal","stove"))).toMatchObject({pose:"standWork",prop:"pot"});
  });
  it("sitting at the gate reads the kernel's structured variant, not the clock", () => {
    const sit = actor("leisure","gate",{id:"yardStroll",variant:"sit"});
    expect(actorPose(sit).pose).toBe("sit");
    // 没有标记的（白天走走、老存档）按走路
    expect(actorPose(actor("leisure","gate",{id:"yardStroll"})).pose).toBe("walk");
  });
  it("the kernel marks summer-evening yard leisure as sitting and nothing else", () => {
    const summer = Array.from({length:CONFIG.calendar.yearDays},(_,day)=>day)
      .find(day => seasonOf(day).season === "summer")!;
    const g = newGame(3);
    const seen = new Map<string, Set<string>>();
    for (let i = 0; i < 1440 * (summer + 12); i++) {
      advanceCompanionMinutes(g, 1);
      const a = g.world.actor.activity;
      if (a?.kind !== "leisure" || a.data.id !== "yardStroll") continue;
      const key = String(a.data.variant ?? "none");
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key)!.add(a.label);
    }
    expect([...(seen.get("sit") ?? [])]).toEqual(["坐在门口"]);
    expect(seen.get("none")?.has("坐在门口") ?? false).toBe(false);
  });
  it("tea carries a cup while writing carries a journal", () => {
    expect(actorPose(actor("leisure", "armchair", {id:"tea"}))).toMatchObject({pose:"sitHold", prop:"cup"});
    expect(actorPose(actor("journal", "desk"))).toMatchObject({pose:"sitWrite", prop:"journal"});
  });
  it("distinguishes structural leisure IDs without looking at Chinese labels", () => {
    const a = actor("leisure", "desk", {id:"readIdle"});
    const first = actorPose(a);
    a.activity!.label = "not the same language at all";
    expect(actorPose(a)).toEqual(first);
    expect(first.pose).toBe("sitRead");
  });
  it("outdoor observation and indoor instruments share a look pose", () => {
    expect(actorPose(actor("observe", "vane"))).toMatchObject({pose:"standLook",prop:"instrument"});
    expect(actorPose(actor("observe", "instruments"))).toMatchObject({pose:"standLook",prop:"instrument"});
  });
  it("small things preserve real prop semantics", () => {
    expect(actorPose(actor("cones", "windowsill"))).toMatchObject({pose:"standWork",prop:"pinecone"});
    expect(actorPose(actor("boilWater", "stove"))).toMatchObject({pose:"standWork",prop:"kettle"});
    expect(actorPose(actor("garden", "garden")).pose).toBe("crouch");
  });
  it("if the real actor is between actions, pose stays unavailable (not inferred)", () => {
    const a = actor("leisure", "desk");
    a.activity = null;
    expect(actorPose(a)).toEqual({activity:null,pose:null,prop:null});
  });
});

describe("G2 visual look always separates reality from ambience", () => {
  it("normal mode projects actual season, weather, and day part without changing them", () => {
    const g = newGame(11), before = JSON.stringify(g);
    const snap = present(g, wall, calendar);
    expect(snap.look.source).toBe("world");
    expect(snap.look.weatherLabel).toBe(g.world.weather.look);
    expect(snap.look.weatherKey).toBe(weatherArtKey(g.world.weather.look));
    expect(snap.world.look).toBe(g.world.weather.look);
    expect(JSON.stringify(g)).toBe(before);
  });
  it("ambience exposes selected weather and time while keeping world weather factual", () => {
    const g = newGame(8);
    const real = g.world.weather.look;
    expect(cmdEnterAmbience(g, {season:"autumn",weather:"C",time:"dusk"}).ok).toBe(true);
    const beforeWorld = JSON.stringify(g.world);
    const snap = present(g, wall, calendar);
    expect(snap.mode).toBe("ambience");
    expect(snap.frozen).toBe(true);
    expect(snap.world.look).toBe(real);
    expect(snap.look).toMatchObject({
      source:"ambience",season:"autumn",weather:"C",weatherLabel:previewLook("autumn","C"),
      time:"dusk", dayPart:"傍晚",weatherKey:weatherArtKey(previewLook("autumn","C")),
    });
    expect(snap.stage).toMatchObject({illusion:true,place:"armchair",pose:"sit",activity:null,prop:null});
    expect(JSON.stringify(g.world)).toBe(beforeWorld);
  });
  it("winter window is night at 17:00 using existing per-season dusk configuration", () => {
    const g=newGame(7), before=JSON.stringify(g);
    // day zero begins in winter; use the same dusk threshold as outdoor return safety.
    expect(CONFIG.outing.dusk.winter).toBe(17*60);
    const at1659=projectedLook(g,g.world,16*60+59);
    const at1700=projectedLook(g,g.world,17*60);
    expect(at1659.time).toBe("dusk");
    expect(at1700.time).toBe("night");
    expect(at1700.dayPart).toBe("夜");
    expect(JSON.stringify(g)).toBe(before);
  });
  it("seasonal evening and twilight differ between winter and summer", () => {
    const g=newGame(7), summer=Array.from({length:CONFIG.calendar.yearDays},(_,day)=>day)
      .find(day => seasonOf(day).season === "summer")!;
    g.world.day=summer;
    expect(projectedLook(g,g.world,19*60).time).toBe("day");
    expect(projectedLook(g,g.world,19*60).dayPart).toBe("傍晚");
    expect(projectedLook(g,g.world,19*60+45).time).toBe("dusk");
    expect(projectedLook(g,g.world,20*60).time).toBe("night");
  });
  it("all weather descriptions have typed drawable keys and unknown stays explicit", () => {
    expect(Object.keys(WEATHER_ART_KEYS)).toHaveLength(9);
    expect(Object.values(WEATHER_ART_KEYS)).toHaveLength(new Set(Object.values(WEATHER_ART_KEYS)).size);
    expect(weatherArtKey("小雪")).toBe("lightSnow");
    expect(weatherArtKey("冻雨")).toBe("freezingRain");
    expect(weatherArtKey("暴风雪")).toBe("blizzard");
    expect(weatherArtKey("new weather")).toBeNull();
    const g=newGame(4);
    g.world.weather.look="雾";
    expect(projectedLook(g,g.world,600).weatherKey).toBe("fog");
    expect(projectedLook(g,g.world,600).weatherLabel).toBe("雾");
  });
  it("a save stuck in ambience without a choice loads back into the real today", () => {
    const g = newGame(3);g.mode="ambience";g.ambience=null;
    const loaded = deserialize(serialize(g, wall)).game;
    expect(loaded.mode).toBe("companion");
    const snap=present(loaded,wall,calendar);
    expect(snap.look.source).toBe("world");
    expect(snap.look.weatherLabel).toBe(loaded.world.weather.look);
  });
  it("dayPartKey is the kernel's schedule part; dayPart follows the light", () => {
    const g=newGame(7);
    // 冬天 17:30：光已经是夜，作息上还是下午
    const look=projectedLook(g,g.world,17*60+30);
    expect(look).toMatchObject({time:"night",dayPart:"夜",dayPartKey:"afternoon"});
    expect(present(g,wall,calendar).look.dayPartKey).toBe(dayPartOf(dayClock(g.world) % 1440));
    g.mode="ambience";g.ambience={season:"summer",weather:"A",time:"day"};
    expect(projectedLook(g,g.world,17*60+30).dayPartKey).toBe("noon");
  });
  it("stage.visible follows the staged place, not the real one", () => {
    const g=newGame(5);
    g.world.actor.place="gate";
    expect(present(g,wall,calendar).actor.visible.hearth).toBe(false);
    cmdEnterAmbience(g,{season:"winter",weather:"B",time:"night"});
    const snap=present(g,wall,calendar);
    expect(snap.stage.place).toBe("armchair");
    for (const c of CAMERA_IDS) expect(snap.stage.visible[c]).toBe(visibleIn(c,"armchair"));
    g.mode="outdoorFocus";
    expect(Object.values(present(g,wall,calendar).stage.visible).every(v=>!v)).toBe(true);
  });
  it("outdoorFocus can use a selected still view while remaining an empty cabin", () => {
    const g = newGame(5);g.mode="outdoorFocus";
    g.ambience={season:"winter",weather:"D",time:"night"};
    const snap=present(g,wall,calendar);
    expect(snap.stage).toMatchObject({show:false,pose:null,prop:null});
    expect(snap.look.source).toBe("ambience");
    expect(snap.frozen).toBe(true);
  });
  it("outdoorFocus without a choice shows a frozen view of real weather", () => {
    const g = newGame(2);g.mode="outdoorFocus";
    const snap=present(g,wall,calendar);
    expect(snap.look.source).toBe("world");
    expect(snap.stage.show).toBe(false);
  });
  it("preview weather choice is deterministic and does not consume world RNG", () => {
    const g = newGame(19);
    const before=JSON.stringify(g.world.rng);
    for(let n=0;n<100;n++) previewLook("winter","C");
    expect(JSON.stringify(g.world.rng)).toBe(before);
    expect(previewLook("winter","C")).toBe("大雪");
  });
});

describe("G2 stage projection is for appearance, not a second world", () => {
  it("carries the actual current action, not a fabricated sprite loop", () => {
    const g=newGame(13);
    g.world.actor.asleep=false;
    g.world.actor.place="desk";
    g.world.actor.activity=makeActivity("journal","desk");
    const snap=present(g,wall,calendar);
    expect(snap.stage).toMatchObject({show:true,place:"desk",pose:"sitWrite",prop:"journal",activity:"journal"});
  });
  it("user cannot render an extra character while the outdoor focus cabin is empty", () => {
    const g=newGame(13);g.mode="outdoorFocus";
    const snap=present(g,wall,calendar);
    expect(snap.stage.show).toBe(false);
    expect(snap.stage.pose).toBeNull();
  });
  it("fire and jar remain unchanged when projecting poses and light", () => {
    const g=newGame(11);
    const before=JSON.stringify(g);
    const snap=present(g,wall,calendar);
    expect(snap.jar.cones).toBe(g.world.jar.cones);
    expect(snap.jar.pending).toBe(g.world.pendingCones);
    expect(snap.fire.look).toMatch(/^(out|ember|low|mid|high)$/);
    expect(JSON.stringify(g)).toBe(before);
  });
  it("independent ambience actor wears indoor clothes even if real actor is outdoors", () => {
    const g=newGame(8);
    g.world.actor.asleep=false;
    g.world.actor.away=false;
    g.world.actor.place="gate";
    g.world.actor.outfit="outdoor";
    cmdEnterAmbience(g,{season:"winter",weather:"D",time:"night"});
    const original=JSON.stringify(g.world);
    const snap=present(g,wall,calendar);
    expect(snap.actor.outfit).toBe("outdoor");
    expect(snap.stage).toMatchObject({show:true,place:"armchair",outfit:"indoor",illusion:true,pose:"sit"});
    expect(JSON.stringify(g.world)).toBe(original);
  });
  it("ambience is not a real action or a second active task", () => {
    const g=newGame(12);
    g.world.actor.asleep=false;g.world.actor.place="desk";
    g.world.actor.activity=makeActivity("journal","desk");
    cmdEnterAmbience(g,{season:"winter",weather:"B",time:"night"});
    const snap=present(g,wall,calendar);
    expect(snap.actor.place).toBe("desk");
    expect(snap.stage).toMatchObject({place:"armchair",illusion:true,pose:"sit",activity:null});
    expect(g.world.actor.activity.kind).toBe("journal");
  });
});
