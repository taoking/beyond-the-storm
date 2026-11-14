// 真浏览器冒烟：灰盒界面里出门 → 键盘走 → 按住方向键不会连走几十格 → 鼠标按住采集按钮跨过一次重画也点得上 → 走回林口 → 回家入库。
// 用无界面 Chrome 加调试协议，真实时间（不要用 --virtual-time-budget：Web Locks 不会授予，页面是空的）。
// 先在另一个终端 npm run dev，然后：node tools/wild-smoke.mjs [截图目录]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdDepart, cmdOutdoor, newGame } from "../src/core/game.ts";
import { cmdCheckOuting } from "../src/core/game.ts";
import { stepMinute } from "../src/core/sim.ts";
import { dayClock } from "../src/core/state.ts";

const URL = "http://127.0.0.1:5173/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const out = process.argv[2] ?? join(tmpdir(), "bts-wild-smoke");
await mkdir(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 一局在松林林口的存档：好天，带 2 份干粮 1 捆柴
const g = newGame(20261114);
for (const ps of Object.values(g.world.projects)) ps.paused = true;
while (!(dayClock(g.world) >= 9 * 60 && !g.world.actor.asleep && cmdCheckOuting(g).ok)) stepMinute(g.world);
g.world.weather.today = "A";
assert.equal(cmdDepart(g, Date.now(), { rations: 2, bundles: 1 }).ok, true);
assert.equal(cmdOutdoor(g, Date.now(), { type: "travel", to: "pineForest" }).ok, true);
const saved = JSON.stringify({ version: 1, savedWall: Date.now(), game: g });

const profile = await mkdtemp(join(tmpdir(), "bts-chrome-"));
const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=9333", `--user-data-dir=${profile}`, "--window-size=1440,1000", "about:blank"], { stdio: "ignore" });
try {
  let targets;
  for (let i = 0; i < 50 && !targets; i++) {
    await sleep(200);
    targets = await fetch("http://127.0.0.1:9333/json").then((r) => r.json()).catch(() => null);
  }
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
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
  const evaluate = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true })).result.value;
  const game = () => evaluate(`JSON.parse(localStorage.getItem("bts.save.v1")).game`);
  const key = (k, code, repeat = false) =>
    send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: { ArrowRight: 39, ArrowLeft: 37, ArrowUp: 38, ArrowDown: 40 }[k], autoRepeat: repeat })
      .then(() => send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code }));
  const shot = async (name) => {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(out, name), Buffer.from(data, "base64"));
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `if (!sessionStorage.getItem("seeded")) { localStorage.setItem("bts.save.v1", ${JSON.stringify(saved)}); sessionStorage.setItem("seeded", "1"); }`,
  });
  await send("Page.navigate", { url: URL });
  for (let i = 0; i < 100 && !(await evaluate(`!!document.querySelector("#wild .map")`)); i++) await sleep(200);
  assert.equal(await evaluate(`!!document.querySelector("#wild .map")`), true, "野外一栏没出来");
  await shot("01-forest-entry.png");

  // 键盘走两格，每步之间隔开
  const m0 = (await game()).world.minute;
  for (const k of ["ArrowRight", "ArrowRight"]) {
    await key(k, k);
    await sleep(260);
  }
  let s = await game();
  assert.deepEqual(s.world.outing.pos, { x: 2, y: 4 });
  assert.equal(s.world.minute - m0, 4);

  // 按住方向键：一秒里连发 30 次，最多走 5–6 步
  for (let i = 0; i < 30; i++) {
    await key("ArrowRight", "ArrowRight", i > 0);
    await sleep(33);
  }
  await sleep(300);
  s = await game();
  const held = (s.world.minute - m0 - 4) / 2;
  assert.ok(held >= 1 && held <= 6, `按住一秒走了 ${held} 步`);

  // 走回林口一带，鼠标按住采集按钮跨过一次心跳重画再松开，采集照样生效
  await evaluate(`document.querySelector('#wild .map span[data-x="3"][data-y="1"]').click()`);
  await sleep(300);
  const box = await evaluate(`(() => { const b = [...document.querySelectorAll('#wild button')].find(b => b.textContent.includes("枯枝堆")); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, disabled: b.disabled }; })()`);
  assert.equal(box.disabled, false, "枯枝堆按钮不能点");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await sleep(1300);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await sleep(300);
  s = await game();
  assert.equal(s.world.outing.bag.wood, 6, "采到的枯枝没进背包");
  await shot("02-gathered.png");

  // 走回林口，回家
  await evaluate(`document.querySelector('#wild .map span[data-x="0"][data-y="4"]').click()`);
  await sleep(300);
  const before = await game();
  await evaluate(`[...document.querySelectorAll('#wild button')].find(b => b.textContent.includes("从林口回家")).click()`);
  await sleep(400);
  s = await game();
  assert.equal(s.mode, "companion", `没回到家：${JSON.stringify({ pos: s.world.outing?.pos, notices: s.notices.slice(-3) })}`);
  assert.equal(s.world.outing, null);
  assert.equal(s.world.stock.wood, before.world.stock.wood + 6);
  assert.equal(await evaluate(`document.querySelector("#wild").hidden`), true);
  await shot("03-home.png");
  assert.deepEqual(errors, [], "页面里有未捕获的错误");
  console.log(JSON.stringify({ passed: true, heldKeySteps: held, screenshots: out }, null, 2));
  ws.close();
} finally {
  chrome.kill();
}
