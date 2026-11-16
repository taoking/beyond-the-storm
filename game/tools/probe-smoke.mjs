// 真浏览器冒烟：真机验证日志（06 第 12 节）能不能写进去、导出、被 tools/probe-check.ts 读懂。
// 无界面 Chrome 加调试协议，真实时间（不要用 --virtual-time-budget：Web Locks 不会授予，页面是空的）。
// 步骤：开灰盒 → 开始专注 → 冻结页面 130 秒（无界面 Chrome 解冻时会重新载入页面，走「重开」） → 开第二个窗口当副窗口
// → 关掉主窗口让它接手 → 继续专注 → 用调试器把它的脚本停 125 秒（确认不了的断档） → 在 /log.html 导出，交给 probe-check。
// 先 npm run dev，然后：node tools/probe-smoke.mjs [地址] [导出文件]。整个跑下来约 5 分钟。
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://127.0.0.1:5173/";
const OUT = process.argv[3] ?? join(tmpdir(), "bts-probe-smoke.json");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9334;
const FREEZE_MS = 130_000;
const STALL_MS = 125_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const profile = await mkdtemp(join(tmpdir(), "bts-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--window-size=1440,1000", "about:blank"], { stdio: "ignore" });

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.text);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (expression, awaitPromise = false) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? ""));
    return r.result.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  return { ws, send, evaluate, errors };
}

async function newPage(url) {
  const t = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" }).then((r) => r.json());
  return { target: t, page: await connect(t.webSocketDebuggerUrl) };
}

try {
  let targets;
  for (let i = 0; i < 50 && !targets; i++) {
    await sleep(200);
    targets = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).catch(() => null);
  }
  const first = targets.find((t) => t.type === "page");
  const A = await connect(first.webSocketDebuggerUrl);
  await A.send("Page.navigate", { url: BASE });
  for (let i = 0; i < 100 && !(await A.evaluate(`!!document.querySelector('[data-ui="start"]')`)); i++) await sleep(200);
  log("主窗口起来了");
  await A.evaluate(`document.getElementById("preset").value = "up"; document.querySelector('[data-ui="start"]').click()`);
  await sleep(15_000);
  // 切到另一个标签页 20 秒：主窗口转到后台再回来
  const blank = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  await fetch(`http://127.0.0.1:${PORT}/json/activate/${blank.id}`);
  await sleep(1_000);
  log("切到别的标签页，主窗口：", await A.evaluate("document.visibilityState"));
  await sleep(20_000);
  await fetch(`http://127.0.0.1:${PORT}/json/activate/${first.id}`);
  await fetch(`http://127.0.0.1:${PORT}/json/close/${blank.id}`);
  await sleep(2_000);
  log("切回来，主窗口：", await A.evaluate("document.visibilityState"));
  log("专注了 15 秒，冻结页面", FREEZE_MS / 1000, "秒");
  await A.send("Page.setWebLifecycleState", { state: "frozen" });
  await sleep(FREEZE_MS);
  await A.send("Page.setWebLifecycleState", { state: "active" });
  await sleep(3_000);
  const bar = await A.evaluate(`document.getElementById("focusBar").innerText`);
  log("恢复以后专注条：", bar.replace(/\s+/g, " "));

  log("开第二个窗口");
  const B = await newPage(BASE);
  await sleep(8_000);
  const bFollower = await B.page.evaluate(`!!document.querySelector(".follower")`);
  log("第二个窗口是副窗口：", bFollower);
  log("关掉主窗口");
  await fetch(`http://127.0.0.1:${PORT}/json/close/${first.id}`);
  await sleep(8_000);
  const bLeader = await B.page.evaluate(`!document.querySelector(".follower")`);
  log("第二个窗口接手：", bLeader);
  await B.page.evaluate(`[...document.querySelectorAll("#focusBar button")].find((b) => b.textContent === "继续")?.click()`);
  await sleep(10_000);
  log("继续专注 10 秒，把脚本停", STALL_MS / 1000, "秒");
  await B.page.send("Debugger.enable");
  await B.page.send("Debugger.pause");
  await sleep(STALL_MS);
  await B.page.send("Debugger.resume");
  await sleep(4_000);
  log("恢复以后专注条：", (await B.page.evaluate(`document.getElementById("focusBar").innerText`)).replace(/\s+/g, " "));
  const L = await newPage(new URL("log.html", BASE).href);
  for (let i = 0; i < 50 && !(await L.page.evaluate(`typeof window.__probeExport === "function"`)); i++) await sleep(200);
  await sleep(6_000); // 等副窗口把缓冲写进 IndexedDB
  const data = await L.page.evaluate(`window.__probeExport()`, true);
  await writeFile(OUT, JSON.stringify(data));
  log(`导出 ${data.entries.length} 条 → ${OUT}`);
  const kinds = {};
  for (const e of data.entries) kinds[e.k] = (kinds[e.k] ?? 0) + 1;
  log("各种类条数：", JSON.stringify(kinds));
  const shown = await L.page.evaluate(`document.getElementById("report").innerText`);
  assert.ok(shown.includes("合上盖子"), "导出页没显示判断");
  assert.ok(bFollower && bLeader, "副窗口没接手");
  for (const k of ["open", "load", "leader", "beat", "sum", "life", "cmd", "focus", "vis"]) assert.ok(kinds[k] > 0, `没有 ${k} 条`);
  assert.ok(data.entries.some((e) => e.k === "beat" && e.kind === "unverified"), "没有记下确认不了的断档");
  assert.ok(data.entries.some((e) => e.k === "leader" && e.from === "handover"), "没有记下接手");
  const errs = [...A.errors, ...B.page.errors, ...L.page.errors];
  assert.deepEqual(errs, [], "页面报错");
  const check = spawnSync(process.execPath, [join(import.meta.dirname, "probe-check.ts"), OUT], { encoding: "utf8" });
  console.log(check.stdout, check.stderr);
} finally {
  chrome.kill();
}
