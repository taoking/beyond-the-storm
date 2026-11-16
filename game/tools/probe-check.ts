// 读真机验证日志的导出文件（/log.html 的「导出 JSON」），按 06 第 12 节逐项给「通过 / 可疑 / 没测到」。
// 用法：node tools/probe-check.ts <导出的 .json> [--json]
// 有可疑项时退出码是 1。判断的口径在 src/app/probe/analyze.ts，导出页上显示的是同一份。
import { readFileSync } from "node:fs";
import { analyze, reportText } from "../src/app/probe/analyze.ts";
import { PROBE_FORMAT, type ProbeExport } from "../src/app/probe/entries.ts";

const file = process.argv[2];
if (!file) {
  console.error("用法：node tools/probe-check.ts <导出的 .json> [--json]");
  process.exit(2);
}
const data = JSON.parse(readFileSync(file, "utf8")) as ProbeExport;
if (data.format !== PROBE_FORMAT || !Array.isArray(data.entries)) {
  console.error(`${file} 不是验证日志的导出文件（format 应为 ${PROBE_FORMAT}）`);
  process.exit(2);
}
const report = analyze(data);
console.log(process.argv.includes("--json") ? JSON.stringify(report, null, 2) : reportText(report));
process.exit(report.items.some((i) => i.verdict === "suspect") ? 1 : 0);
