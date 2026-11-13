// 06 第 4 节的指标：人物可见率、活动密度、时间配比。给 04/05 做构图和回访设计用。
// 用法：node tools/report.ts [--runs N] [--days D]
// 采样条件：正常陪伴、不出门、不专注（没有任务类别的轻推），他照自己的习惯做项目；从入冬第一天起。
import { CAMERA_IDS, CAMERAS } from "../src/core/cameras.ts";
import { seasonOf, SEASON_NAME } from "../src/core/calendar.ts";
import { PLACES, type PlaceId } from "../src/core/content.ts";
import { advanceCompanionMinutes, newGame } from "../src/core/game.ts";
import { createTelemetry, type Telemetry } from "../src/core/telemetry.ts";

const args = process.argv.slice(2);
const arg = (name: string, fallback: number): number => (args.includes(`--${name}`) ? Number(args[args.indexOf(`--${name}`) + 1]) : fallback);
const runs = arg("runs", 40);
const days = arg("days", 60);
const pct = (a: number, b: number): string => `${((a / Math.max(1, b)) * 100).toFixed(1)}%`;

function add(into: Telemetry, t: Telemetry): void {
  into.companionMinutes += t.companionMinutes;
  into.awakeMinutes += t.awakeMinutes;
  for (const c of CAMERA_IDS) into.visibleAwake[c] += t.visibleAwake[c];
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
      for (const c of CAMERA_IDS) delta.visibleAwake[c] -= prev.visibleAwake[c];
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
console.log("镜头里有哪些地点是假设（src/core/cameras.ts），05 定稿后要重算。\n");
console.log("## 镜头里看得见他\n");
console.log("| 镜头 | 占醒着的时间 | 占全部世界时间 | 包括的地点 |");
console.log("|---|---|---|---|");
for (const c of CAMERA_IDS) {
  const names = c.startsWith("wide") ? CAMERAS[c].note : CAMERAS[c].places.map((p) => PLACES[p].name).join("、");
  console.log(`| ${CAMERAS[c].name} | ${pct(total.visibleAwake[c], total.awakeMinutes)} | ${pct(total.visibleAwake[c], total.companionMinutes)} | ${names} |`);
}
console.log("\n按季节（占醒着的时间）：\n");
console.log(`| 季节 | ${CAMERA_IDS.map((c) => CAMERAS[c].name).join(" | ")} |`);
console.log(`|---|${CAMERA_IDS.map(() => "---").join("|")}|`);
for (const [season, t] of Object.entries(bySeason)) {
  console.log(`| ${season} | ${CAMERA_IDS.map((c) => pct(t.visibleAwake[c], t.awakeMinutes)).join(" | ")} |`);
}
console.log("\n## 他醒着时在哪\n");
const zoneName = { indoor: "屋里", eaves: "泉屋和防风林", yard: "院子", nearby: "林子边缘和溪湾", away: "野外" } as const;
console.log("| 区域 | 占醒着的时间 |\n|---|---|");
for (const [z, n] of Object.entries(total.zoneAwake)) console.log(`| ${zoneName[z as keyof typeof zoneName]} | ${pct(n, total.awakeMinutes)} |`);
console.log("\n| 地点 | 占醒着的时间 |\n|---|---|");
for (const [p, n] of Object.entries(total.placeAwake).sort((a, b) => b[1] - a[1])) {
  console.log(`| ${PLACES[p as PlaceId].name} | ${pct(n, total.awakeMinutes)} |`);
}
console.log("\n## 他的时间花在哪（占全部世界时间）\n");
const catName: Record<string, string> = { sleep: "睡觉", necessity: "必要生活", chore: "活计", observe: "观测", project: "项目", small: "小事", leisure: "闲暇" };
console.log("| 类别 | 占比 |\n|---|---|");
for (const [c, n] of Object.entries(total.category).sort((a, b) => b[1] - a[1])) console.log(`| ${catName[c] ?? c} | ${pct(n, total.companionMinutes)} |`);
console.log("\n## 活动密度\n");
console.log(`- 每个游戏日（约现实 4 小时）记下的事件：平均 ${mean(eventsPerDay)} 条，其中「值得一提」以上的 ${mean(notablePerDay)} 条。`);
console.log(`- 每现实 2 小时（他醒着的 480 个游戏分钟）：「值得一提」以上的事平均 ${mean(notablePer2h)} 件，最少的一成窗口里有 ${q(notablePer2h, 0.1)} 件，中位 ${q(notablePer2h, 0.5)} 件。`);
console.log(`- 每现实 2 小时他换动作 ${mean(switchesPer2h)} 次，中位 ${q(switchesPer2h, 0.5)} 次（平均每个动作持续约 ${(480 / Number(mean(switchesPer2h))).toFixed(0)} 个游戏分钟，合现实 ${(480 / Number(mean(switchesPer2h)) / 4).toFixed(1)} 分钟）。`);
console.log(`- 各类事件的条数（${runs * days} 个游戏日合计）：${Object.entries(typeCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("，")}`);
