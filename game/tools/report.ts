// 06 第 4 节的指标：人物可见率、活动密度、时间配比，加上「地点 × 姿态 × 房间」。给 04/05 做构图、站位和出图用。
// 用法：node tools/report.ts [--runs N] [--days D]
// 采样条件：正常陪伴、不出门、不专注（没有任务类别的轻推），他照自己的习惯做项目；从入冬第一天起。
import { seasonOf, SEASON_NAME } from "../src/core/calendar.ts";
import { PLACES, type PlaceId } from "../src/core/content.ts";
import { localCalendar } from "../src/core/focus.ts";
import { advanceCompanionMinutes, newGame } from "../src/core/game.ts";
import { LOCATIONS, placesIn, ROOM_IDS, ROOMS, roomOf, type RoomId } from "../src/core/rooms.ts";
import { createTelemetry, type Telemetry } from "../src/core/telemetry.ts";
import { present } from "../src/core/view.ts";

const args = process.argv.slice(2);
const arg = (name: string, fallback: number): number => (args.includes(`--${name}`) ? Number(args[args.indexOf(`--${name}`) + 1]) : fallback);
const runs = arg("runs", 40);
const days = arg("days", 60);
const pct = (a: number, b: number): string => `${((a / Math.max(1, b)) * 100).toFixed(1)}%`;

function add(into: Telemetry, t: Telemetry): void {
  into.companionMinutes += t.companionMinutes;
  into.awakeMinutes += t.awakeMinutes;
  for (const r of ROOM_IDS) into.visibleAwake[r] += t.visibleAwake[r];
  for (const [z, n] of Object.entries(t.zoneAwake)) into.zoneAwake[z as keyof Telemetry["zoneAwake"]] += n;
  for (const [p, n] of Object.entries(t.placeAwake)) into.placeAwake[p] = (into.placeAwake[p] ?? 0) + n;
  for (const [c, n] of Object.entries(t.category)) into.category[c] = (into.category[c] ?? 0) + n;
}

const total = createTelemetry();
const bySeason: Record<string, Telemetry> = {};
const eventsPerDay: number[] = [];
const notablePerDay: number[] = [];
const typeCount: Record<string, number> = {};
/** 现实 2 小时 = 醒着的 480 个游戏分钟。每个这样的窗口里有几件「值得一提」以上的事、换了几次动作 */
const notablePer2h: number[] = [];
const switchesPer2h: number[] = [];
/** 他醒着时画面上的样子：键是「地点|姿态|道具」，从 present() 的 stage 取，跟画面读的是同一份 */
interface PoseCell { place: PlaceId; room: RoomId | null; pose: string; prop: string; minutes: number; acts: Record<string, number> }
const poseCells = new Map<string, PoseCell>();

for (let seed = 0; seed < runs; seed++) {
  const g = newGame(seed);
  const w = g.world;
  let day = 0;
  let seen = 0;
  let windowAwake = 0;
  let windowNotable = 0;
  let windowSwitches = 0;
  let lastAct = w.actor.activity;
  let prev = createTelemetry();
  while (w.day < days) {
    advanceCompanionMinutes(g, 1);
    if (!w.actor.asleep) {
      windowAwake += 1;
      if (w.actor.activity !== lastAct) windowSwitches += 1;
    }
    lastAct = w.actor.activity;
    // 跟 telemetry 的可见率同一个分母：醒着、没出门
    if (!w.actor.asleep && !w.actor.away) {
      const st = present(g, 0, localCalendar).stage;
      if (st.place) {
        const pose = st.pose ?? "（无）";
        const prop = st.prop ?? "—";
        const key = `${st.place}|${pose}|${prop}`;
        const cell = poseCells.get(key) ?? { place: st.place, room: st.room, pose, prop, minutes: 0, acts: {} };
        cell.minutes += 1;
        // 闲暇、项目、请求再细到哪一种，方便查某个姿态是哪件事给的
        const data = w.actor.activity?.data;
        const sub = st.activity === "leisure" || st.activity === "project" ? data?.id : st.activity === "request" ? data?.kind : undefined;
        const act = `${st.activity ?? "（无）"}${sub ? `:${sub}` : ""}`;
        cell.acts[act] = (cell.acts[act] ?? 0) + 1;
        poseCells.set(key, cell);
      }
    }
    for (; seen < w.events.length; seen++) {
      const e = w.events[seen];
      typeCount[e.type] = (typeCount[e.type] ?? 0) + 1;
      if (e.weight >= 2) windowNotable += 1;
    }
    if (windowAwake >= 480) {
      notablePer2h.push(windowNotable);
      switchesPer2h.push(windowSwitches);
      windowAwake = windowNotable = windowSwitches = 0;
    }
    if (w.day !== day) {
      const season = SEASON_NAME[seasonOf(day).season];
      const delta = structuredClone(g.telemetry);
      // 这一天的增量
      delta.companionMinutes -= prev.companionMinutes;
      delta.awakeMinutes -= prev.awakeMinutes;
      for (const r of ROOM_IDS) delta.visibleAwake[r] -= prev.visibleAwake[r];
      for (const z of Object.keys(delta.zoneAwake) as (keyof Telemetry["zoneAwake"])[]) delta.zoneAwake[z] -= prev.zoneAwake[z];
      for (const p of Object.keys(delta.placeAwake)) delta.placeAwake[p] -= prev.placeAwake[p] ?? 0;
      for (const c of Object.keys(delta.category)) delta.category[c] -= prev.category[c] ?? 0;
      add((bySeason[season] ??= createTelemetry()), delta);
      prev = structuredClone(g.telemetry);
      const todays = w.summaries.length ? w.events.filter((e) => e.day === day) : [];
      eventsPerDay.push(todays.length);
      notablePerDay.push(todays.filter((e) => e.weight >= 2).length);
      day = w.day;
      // 事件只保留最近十几天，seen 要跟着裁剪后的数组走
      seen = w.events.length;
    }
  }
  add(total, g.telemetry);
}

const mean = (xs: number[]): string => (xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)).toFixed(1);
const q = (xs: number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * p)] ?? 0;

console.log(`# 灰盒采样：${runs} 个种子 × 入冬起 ${days} 个游戏日`);
console.log(`\n采样条件：正常陪伴，不出门，不专注，他照自己的习惯做项目。共 ${total.companionMinutes} 个游戏分钟，其中他醒着 ${total.awakeMinutes} 个（${pct(total.awakeMinutes, total.companionMinutes)}）。`);
console.log("地点归哪间读 assets/05/rooms/b1_20261116/room_locations.json；画面只显示选定的那一间，下面是选了那一间时看得见他的比例。\n");
console.log("## 各间看得见他\n");
console.log("| 房间 | 占醒着的时间 | 占全部世界时间 | 包括的地点 |");
console.log("|---|---|---|---|");
for (const r of ROOM_IDS) {
  const names = placesIn(r).map((p) => PLACES[p].name).join("、");
  console.log(`| ${ROOMS[r].name} | ${pct(total.visibleAwake[r], total.awakeMinutes)} | ${pct(total.visibleAwake[r], total.companionMinutes)} | ${names} |`);
}
const inRooms = ROOM_IDS.reduce((n, r) => n + total.visibleAwake[r], 0);
console.log(`| 四间都不在（院子、屋边、泉屋和防风林） | ${pct(total.awakeMinutes - inRooms, total.awakeMinutes)} | | |`);
console.log("\n按季节（占醒着的时间）：\n");
console.log(`| 季节 | ${ROOM_IDS.map((r) => ROOMS[r].name).join(" | ")} |`);
console.log(`|---|${ROOM_IDS.map(() => "---").join("|")}|`);
for (const [season, t] of Object.entries(bySeason)) {
  console.log(`| ${season} | ${ROOM_IDS.map((r) => pct(t.visibleAwake[r], t.awakeMinutes)).join(" | ")} |`);
}
console.log("\n## 他醒着时在哪\n");
const zoneName = { indoor: "屋里", eaves: "泉屋和防风林", yard: "院子", nearby: "林子边缘和溪湾", away: "野外" } as const;
console.log("| 区域 | 占醒着的时间 |\n|---|---|");
for (const [z, n] of Object.entries(total.zoneAwake)) console.log(`| ${zoneName[z as keyof typeof zoneName]} | ${pct(n, total.awakeMinutes)} |`);
console.log("\n| 地点 | 房间 | 占醒着的时间 |\n|---|---|---|");
for (const [p, n] of Object.entries(total.placeAwake).sort((a, b) => b[1] - a[1])) {
  const room = roomOf(p as PlaceId);
  console.log(`| ${PLACES[p as PlaceId].name} | ${room ? ROOMS[room].name : "—"} | ${pct(n, total.awakeMinutes)} |`);
}

console.log("\n## 地点 × 姿态 × 房间\n");
console.log("姿态和道具取自 present() 快照的 stage（画面就照它画人），分母同上：他醒着、没出门的时间。站位读 room_locations.json 的 footAnchor。\n");
const POSES = ["sit", "sitRead", "sitWrite", "sitHold", "standWork", "standLook", "crouch", "walk", "sleep", "（无）"];
const cells = [...poseCells.values()];
const poseCols = POSES.filter((p) => cells.some((c) => c.pose === p));
const roomRows: { name: string; room: RoomId | null }[] = [...ROOM_IDS.map((r) => ({ name: ROOMS[r].name, room: r })), { name: "四间都不在", room: null }];
console.log("各间的姿态（占醒着的时间；一行加起来就是上面「各间看得见他」那一列）：\n");
console.log(`| 房间 | ${poseCols.join(" | ")} | 合计 |`);
console.log(`|---|${poseCols.map(() => "---").join("|")}|---|`);
for (const { name, room } of roomRows) {
  const inRoom = cells.filter((c) => c.room === room);
  const sum = (p: string): number => inRoom.filter((c) => c.pose === p).reduce((n, c) => n + c.minutes, 0);
  const all = inRoom.reduce((n, c) => n + c.minutes, 0);
  console.log(`| ${name} | ${poseCols.map((p) => (sum(p) ? pct(sum(p), total.awakeMinutes) : "")).join(" | ")} | ${pct(all, total.awakeMinutes)} |`);
}
const placeMinutes: Partial<Record<PlaceId, number>> = {};
for (const c of cells) placeMinutes[c.place] = (placeMinutes[c.place] ?? 0) + c.minutes;
const roomOrder = (r: RoomId | null): number => (r ? ROOM_IDS.indexOf(r) : ROOM_IDS.length);
console.log("\n逐条（地点按房间排，同一地点里按时间多少排；占这个地点 = 他在这个地点时有多少是这个姿态）：\n");
console.log("| 房间 | 地点 | 站位 | 姿态 | 道具 | 占醒着的时间 | 占这个地点 | 主要动作 |");
console.log("|---|---|---|---|---|---|---|---|");
cells.sort((a, b) => roomOrder(a.room) - roomOrder(b.room) || (placeMinutes[b.place] ?? 0) - (placeMinutes[a.place] ?? 0) || a.place.localeCompare(b.place) || b.minutes - a.minutes);
for (const c of cells) {
  const foot = LOCATIONS[c.place]?.foot;
  const acts = Object.entries(c.acts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ${pct(n, c.minutes)}`).join("，");
  console.log(`| ${c.room ? ROOMS[c.room].name : "—"} | ${PLACES[c.place].name} | ${foot ? foot.join(",") : "—"} | ${c.pose} | ${c.prop} | ${pct(c.minutes, total.awakeMinutes)} | ${pct(c.minutes, placeMinutes[c.place] ?? 0)} | ${acts} |`);
}
const unused = (Object.keys(LOCATIONS) as PlaceId[]).filter((p) => roomOf(p) && !placeMinutes[p]);
if (unused.length) console.log(`\n有站位、但这次采样里他醒着没去过的地点：${unused.map((p) => `${PLACES[p].name}（${ROOMS[roomOf(p)!].name}）`).join("、")}。`);
console.log("\n## 他的时间花在哪（占全部世界时间）\n");
const catName: Record<string, string> = { sleep: "睡觉", necessity: "必要生活", chore: "活计", observe: "观测", project: "项目", small: "小事", leisure: "闲暇" };
console.log("| 类别 | 占比 |\n|---|---|");
for (const [c, n] of Object.entries(total.category).sort((a, b) => b[1] - a[1])) console.log(`| ${catName[c] ?? c} | ${pct(n, total.companionMinutes)} |`);
console.log("\n## 活动密度\n");
console.log(`- 每个游戏日（约现实 4 小时）记下的事件：平均 ${mean(eventsPerDay)} 条，其中「值得一提」以上的 ${mean(notablePerDay)} 条。`);
console.log(`- 每现实 2 小时（他醒着的 480 个游戏分钟）：「值得一提」以上的事平均 ${mean(notablePer2h)} 件，最少的一成窗口里有 ${q(notablePer2h, 0.1)} 件，中位 ${q(notablePer2h, 0.5)} 件。`);
console.log(`- 每现实 2 小时他换动作 ${mean(switchesPer2h)} 次，中位 ${q(switchesPer2h, 0.5)} 次（平均每个动作持续约 ${(480 / Number(mean(switchesPer2h))).toFixed(0)} 个游戏分钟，合现实 ${(480 / Number(mean(switchesPer2h)) / 4).toFixed(1)} 分钟）。`);
console.log(`- 各类事件的条数（${runs * days} 个游戏日合计）：${Object.entries(typeCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("，")}`);
