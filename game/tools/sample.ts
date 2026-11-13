// 打印头几天的动作流水，用来肉眼检查作息。用法：node tools/sample.ts [种子] [天数]
import { clockText } from "../src/core/calendar.ts";
import { actionLabel, createWorld, stepMinute } from "../src/core/sim.ts";
import { dayClock } from "../src/core/state.ts";

const seed = Number(process.argv[2] ?? 1);
const days = Number(process.argv[3] ?? 2);
const w = createWorld(seed);
let last = "";
while (w.day < days) {
  const label = `${actionLabel(w)} @${w.actor.place}`;
  if (label !== last) {
    const f = w.fire;
    console.log(
      `D${w.day + 1} ${clockText(dayClock(w))} ${w.weather.today}/${w.weather.look} [${w.today.mood}] 柴${w.stock.wood} 粮${w.stock.food} 火${Math.round(f.burn)}+${f.ember}  ${label}`,
    );
    last = label;
  }
  stepMinute(w);
}
console.log("\n小结：");
for (const s of w.summaries) console.log(" ", s.text);
