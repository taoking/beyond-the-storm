// 真浏览器冒烟：专注/休息结束时的系统通知（04 第 19.2 节 A7）。
// 默认关 → 勾上才问一次权限 → 没允许时只写一句、不再问 → 授权后专注走完主窗口发一条、副窗口不发
// → 在副窗口关掉，休息走完主窗口也不发。约 2–3 分钟，真实时间。
// 用无界面 Chrome 加调试协议（不要用 --virtual-time-budget：Web Locks 不会授予）。权限用 Browser.grantPermissions 给。
// 先在另一个终端 npm run dev -- --port 5199，然后：node tools/notify-smoke.mjs [http://localhost:5199/]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixedCalendar } from "../src/core/focus.ts";
import { advance, cmdStartFocus, newGame } from "../src/core/game.ts";

const URL = process.argv[2] ?? "http://localhost:5199/";
const ORIGIN = new globalThis.URL(URL).origin;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 一局 1/1 的专注，已经走了 50 秒；读档时会停在「已暂停」，点继续再走 10 秒就到点
const g = newGame(20261117);
const t0 = Date.now() - 50_000;
cmdStartFocus(g, t0, fixedCalendar(0), { preset: { kind: "countdown", focusMin: 1, breakMin: 1 }, category: "study", taskId: null });
advance(g, { wall: t0 + 50_000, verifiedMs: 50_000 }, fixedCalendar(0));
const saved = JSON.stringify({ version: 1, savedWall: Date.now(), game: g });

// 把真的 Notification 包一层：照常调用，顺手记下发了什么、问了几次
const WRAP = `(() => {
  window.__shown = []; window.__asked = 0;
  const Real = window.Notification;
  if (!Real) return;
  class N extends Real { constructor(t, o) { super(t, o); window.__shown.push({ title: t, body: o && o.body, tag: o && o.tag }); } }
  N.requestPermission = (...a) => { window.__asked++; return Real.requestPermission(...a); };
  window.Notification = N;
})();`;

async function connect(wsUrl, page = true) {
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
  const evaluate = async (expr, userGesture = false) =>
    (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture })).result.value;
  if (page) {
    await send("Page.enable");
    await send("Runtime.enable");
  }
  return { ws, send, evaluate, errors };
}

const profile = await mkdtemp(join(tmpdir(), "bts-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--window-size=1440,1000", "about:blank"], {
  stdio: "ignore",
});
try {
  let targets;
  for (let i = 0; i < 50 && !targets; i++) {
    await sleep(200);
    targets = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).catch(() => null);
  }
  const version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json());
  const browser = await connect(version.webSocketDebuggerUrl, false).catch(() => null);
  const a = await connect(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await a.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `if (!sessionStorage.getItem("seeded")) { localStorage.setItem("bts.save.v1", ${JSON.stringify(saved)}); sessionStorage.setItem("seeded", "1"); }`,
  });
  await a.send("Page.addScriptToEvaluateOnNewDocument", { source: WRAP });
  await a.send("Page.navigate", { url: URL });
  const box = `document.querySelector('[data-ui="notify"]')`;
  for (let i = 0; i < 100 && !(await a.evaluate(`!!${box}`)); i++) await sleep(200);
  assert.equal(await a.evaluate(`!!${box}`), true, "通知开关没出来");

  // 1. 默认关，没问过权限
  assert.equal(await a.evaluate(`${box}.checked`), false, "默认应该是关的");
  assert.equal(await a.evaluate(`localStorage.getItem("bts.prefs.v1")`), null);
  assert.equal(await a.evaluate(`window.__asked`), 0, "没勾就问了权限");
  const before = await a.evaluate(`Notification.permission`);
  console.log("起始权限：", before);

  // 2. 勾上：问一次；无界面里没人点允许，只写一句、计时照常
  await a.evaluate(`${box}.click()`, true);
  await sleep(1500);
  assert.equal(await a.evaluate(`window.__asked`), before === "default" ? 1 : 0, "勾上时应该问一次");
  assert.equal(await a.evaluate(`JSON.parse(localStorage.getItem("bts.prefs.v1")).notify`), true);
  const degraded = await a.evaluate(`document.querySelector(".notifyStatus")?.textContent ?? ""`);
  console.log("没授权时那一句：", degraded, "权限：", await a.evaluate(`Notification.permission`));
  assert.match(degraded, /只在计时区显示/);
  await sleep(3000);
  assert.equal(await a.evaluate(`window.__asked`), before === "default" ? 1 : 0, "不应该反复问");

  // 3. 授权（相当于你在弹窗里点了允许）
  const grant = { permissions: ["notifications"], origin: ORIGIN };
  if (browser) await browser.send("Browser.grantPermissions", grant);
  else await a.send("Browser.grantPermissions", grant);
  await sleep(1500);
  assert.equal(await a.evaluate(`Notification.permission`), "granted");
  const ok = await a.evaluate(`document.querySelector(".notifyStatus")?.textContent ?? ""`);
  console.log("授权后那一句：", ok);
  assert.match(ok, /系统通知/);

  // 4. 开第二个窗口：副窗口
  const created = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  const b = await connect(created.webSocketDebuggerUrl);
  await b.send("Page.addScriptToEvaluateOnNewDocument", { source: WRAP });
  await b.send("Page.navigate", { url: URL });
  for (let i = 0; i < 100 && !(await b.evaluate(`!!document.querySelector(".follower")`)); i++) await sleep(200);
  assert.equal(await b.evaluate(`!!document.querySelector(".follower")`), true, "第二个窗口应该是副窗口");
  assert.equal(await b.evaluate(`${box}.checked`), true, "设置在两个窗口里是同一份");

  // 5. 主窗口点继续，约 10 秒后专注到点：主窗口一条，副窗口零条
  await a.evaluate(`document.querySelector('[data-cmd="resumeFocus"]').click()`, true);
  for (let i = 0; i < 40 && (await a.evaluate(`window.__shown.length`)) === 0; i++) await sleep(500);
  await sleep(2000);
  const shownA = await a.evaluate(`window.__shown`);
  const shownB = await b.evaluate(`window.__shown`);
  console.log("主窗口发的：", JSON.stringify(shownA), "副窗口发的：", JSON.stringify(shownB));
  assert.equal(shownA.length, 1);
  assert.equal(shownA[0].title, "1 分钟专注结束");
  assert.equal(shownA[0].body, "接下来休息 1 分钟");
  assert.equal(shownB.length, 0);
  assert.match(await a.evaluate(`document.getElementById("summaryRow").textContent`), /这一轮 1 分钟/);

  // 6. 在副窗口关掉；休息走完，主窗口也不发
  await b.evaluate(`${box}.click()`, true);
  await sleep(500);
  assert.equal(await a.evaluate(`JSON.parse(localStorage.getItem("bts.prefs.v1")).notify`), false);
  console.log("等休息走完（约 60 秒）……");
  const t1 = Date.now();
  for (let i = 0; i < 150 && !(await a.evaluate(`document.querySelector("#focusBar").textContent.includes("开始下一轮")`)); i++) {
    if (i % 15 === 0) console.log(`  ${Math.round((Date.now() - t1) / 1000)} 秒：`, await a.evaluate(`document.querySelector("#focusBar .clock").textContent + " · " + document.querySelector("#debug div").textContent + " · " + document.visibilityState`));
    await sleep(1000);
  }
  console.log(`  休息在 ${Math.round((Date.now() - t1) / 1000)} 秒后走完`);
  assert.match(await a.evaluate(`document.querySelector("#focusBar").textContent`), /开始下一轮/, "休息没走完");
  await sleep(1500);
  assert.equal((await a.evaluate(`window.__shown`)).length, 1, "关掉以后不该再发");
  assert.equal((await b.evaluate(`window.__shown`)).length, 0);
  assert.deepEqual([...a.errors, ...b.errors], [], "页面报错了");
  console.log("通知冒烟：通过");
  a.ws.close();
  b.ws.close();
  browser?.ws.close();
} finally {
  chrome.kill();
}
