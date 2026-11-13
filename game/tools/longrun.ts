// 无人值守长跑：不出门、不专注，只看柴粮和作息。对照 设计/02_玩法.md 第 5.7 节的验收目标。
// 用法：node tools/longrun.ts [--runs N] [--years Y] [--case 名字]
import { CONFIG } from "../src/core/config.ts";
import { runCase, CASES, formatReport } from "../src/core/longrun.ts";

const args = process.argv.slice(2);
const arg = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const only = args.includes("--case") ? args[args.indexOf("--case") + 1] : null;
const runs = arg("runs", 40);
const years = arg("years", 8);
console.log(`世界年 ${CONFIG.calendar.yearDays} 天；每种情形 ${runs} 次 × ${years} 个世界年（标了年数的情形除外），种子 0..${runs - 1}`);
for (const c of CASES) {
  if (only && c.id !== only) continue;
  const t0 = performance.now();
  const r = runCase(c, runs, c.years ?? years);
  console.log(formatReport(r));
  console.log(`  （用时 ${((performance.now() - t0) / 1000).toFixed(1)} 秒）`);
}
