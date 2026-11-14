// 灰盒界面：把 view.ts 的投影画出来，把点击变成命令。没有游戏规则在这里。
import { CAMERAS, CAMERA_IDS } from "../core/cameras.ts";
import { clockText } from "../core/calendar.ts";
import { CONFIG } from "../core/config.ts";
import { CATEGORY_NAME, CROPS, DEFAULT_STYLE, PLACES, STYLES, type TaskCategory } from "../core/content.ts";
import type { FocusPreset } from "../core/focus.ts";
import { ownsStyle, type Game } from "../core/game.ts";
import { checkOuting, REFUSAL_TEXT } from "../core/outing.ts";
import { present, type Snapshot } from "../core/view.ts";
import { cal, startRuntime } from "./runtime.ts";
import { cameraCaption, CROP, drawScene } from "./scene.ts";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const btn = (label: string, cmd: string, args: unknown[] = [], disabled = false): string =>
  `<button data-cmd="${cmd}" data-args="${esc(JSON.stringify(args))}"${disabled ? " disabled" : ""}>${esc(label)}</button>`;
const pct = (a: number, b: number): string => (b > 0 ? `${((a / b) * 100).toFixed(0)}%` : "—");

const rt = startRuntime();
let showToday = false;
let journalTab: "world" | "real" = "world";

function presetOf(value: string): FocusPreset {
  if (value === "up") return { kind: "countup" };
  const [f, b] = value.split("/").map(Number);
  return { kind: "countdown", focusMin: f, breakMin: b };
}

function renderTop(s: Snapshot): string {
  const dots = "●".repeat(s.focus.dots) + "○".repeat(CONFIG.shares.perDay - s.focus.dots);
  const projected = s.look.source === "ambience";
  const headline = projected ? `氛围 · ${s.look.seasonLabel}` : s.world.dayLabel;
  const weather = s.look.weatherLabel;
  const part = s.look.dayPart;
  return `
    <strong>${esc(headline)}</strong>
    <span>${esc(weather)}</span>
    <span class="dim">${esc(part)}${s.mode === "outdoor" ? ` ${s.world.clock}` : ""}</span>
    ${projected ? `<span class="dim">真实世界暂停在 ${esc(s.world.dayLabel)}</span>` : ""}
    ${s.world.omen ? '<span class="dim">气压在掉</span>' : ""}
    ${s.world.tomorrow ? `<span class="dim">明天：${esc(s.world.tomorrow)}</span>` : ""}
    <span class="mode${s.frozen ? " frozen" : ""}">${esc(s.modeLine)}</span>
    ${rt.leader ? "" : '<span class="follower">副窗口（只显示，操作交给主窗口）</span>'}
    <span class="dots" title="今天 ${s.focus.dots} 份 · 累计 ${s.focus.total} 份">${dots}</span>`;
}

function renderAction(s: Snapshot): string {
  const parts = [`<span class="action">${esc(s.stage.label || s.actor.label)}</span>`];
  if (s.stage.illusion) parts.push('<span class="dim">（氛围里的演出，不是真实动作）</span>');
  if (s.request) parts.push(`<span class="dim">说过：${esc(REQUEST_NAME[s.request])}</span> ${btn("取消", "cancelRequest")}`);
  parts.push(`<button data-ui="today">${showToday ? "收起" : "看看今天"}</button>`);
  if (s.mode === "ambience" || (s.mode === "outdoorFocus" && rt.game?.ambience)) parts.push(btn("回到今天", "returnToToday"));
  if (s.mode === "outdoorFocus") parts.push(btn("回到野外", "returnToWild"));
  return parts.join(" ");
}

const REQUEST_NAME: Record<string, string> = { earlyRest: "今天早点歇", playRecord: "放张唱片", tea: "泡杯茶", windowSit: "去窗边坐会儿" };

function renderToday(s: Snapshot): string {
  const li = (e: { text: string }): string => `<li>${esc(e.text)}</li>`;
  const doing = s.projects.find((p) => p.status === "doing");
  return `
    <div>${esc(s.actor.whereabouts)}</div>
    <ul>${s.today.top.map(li).join("") || '<li class="dim">今天还没有值得一提的事。</li>'}</ul>
    ${s.today.more.length ? `<details><summary>展开</summary><ul>${s.today.more.map(li).join("")}</ul></details>` : ""}
    <div>${esc(s.life.woodLine)}${esc(s.life.foodLine)}</div>
    <div class="dim">手头的事：${doing ? `${esc(doing.name)}（${esc(doing.stageWord)}）` : "没有在做的"}</div>`;
}

function renderFocus(s: Snapshot, g: Game): string {
  const f = s.focus;
  const out: string[] = [`<span class="clock">${esc(f.text)}</span>`];
  switch (f.bar) {
    case "idle":
      out.push('<button data-ui="start">开始专注</button>');
      break;
    case "focusing":
      out.push(btn("暂停", "pauseFocus"), btn("结束", "endFocus"), btn("加 5 分钟", "extendFocus"));
      break;
    case "countup":
      out.push(btn("暂停", "pauseFocus"), btn("结束", "endFocus"));
      break;
    case "break":
      out.push(btn("跳过休息", "nextRound"), btn("结束", "endFocus"));
      break;
    case "awaitNext":
      out.push(btn("开始下一轮", "nextRound"), btn("结束", "endFocus"));
      break;
    default:
      out.push(btn("继续", "resumeFocus"), btn("结束", "endFocus"));
  }
  out.push(
    `<label class="dim"><input type="checkbox" data-ui="autoNext"${g.focus.settings.autoNext ? " checked" : ""}/> 自动接下一轮</label>`,
  );
  if (f.bar === "pausedAfterGap") {
    out.push(
      `<div class="gap">有 ${f.pendingGapMinutes} 分钟确认不了在不在计时。 ${btn("算进去", "resolveGap", [true])} ${btn("不算", "resolveGap", [false])}</div>`,
    );
  }
  return out.join(" ");
}

function renderInspect(s: Snapshot, g: Game): string {
  const w = g.world;
  const st = s.stock;
  const h: string[] = [];
  h.push(`<h3>家里</h3>
    <div>${esc(s.life.mood)}${s.life.heater ? " · 点着暖炉" : ""} · 火：${esc(FIRE_NAME[s.fire.look])}</div>
    <div>${esc(s.life.woodLine)} <span class="dim">柴 ${st.wood}/${st.woodCap} 根，约够 ${st.woodDays.toFixed(1)} 天</span></div>
    <div>${esc(s.life.foodLine)} <span class="dim">粮 ${st.food}/${st.foodCap} 餐，约够 ${st.foodDays.toFixed(1)} 天</span></div>
    <div class="dim">食材 ${st.ingredients} · 罐头 ${st.cans} · 燃油 ${st.fuel} · 木料 ${st.lumber}</div>
    <div class="row">
      <label><input type="checkbox" data-ui="keepCans"${w.intents.keepCans ? " checked" : ""}/> 罐头留着</label>
      <label><input type="checkbox" data-ui="keepFuel"${w.intents.keepFuel ? " checked" : ""}/> 燃油留着</label>
    </div>
    <div>窗台的罐：${s.jar.cones}/30 颗${s.jar.fullJars ? `，架上 ${Math.min(3, s.jar.fullJars)} 只满罐` : ""}${s.jar.pending ? `，还有 ${s.jar.pending} 颗没放` : ""}</div>`);

  h.push("<h3>手头的事</h3><table>");
  for (const p of s.projects) {
    const boxes = "■".repeat(p.stage) + "□".repeat(p.stages - p.stage);
    h.push(`<tr><td>${p.pinned ? "📌" : ""}${esc(p.name)}</td><td>${boxes}</td>
      <td>${esc(p.note)}${p.stageWord ? ` · ${esc(p.stageWord)}` : ""}</td>
      <td>${p.status === "done" ? "" : p.pinned ? btn("取消置顶", "unpin", [p.id]) : btn("置顶", "pin", [p.id])}
          ${p.status === "done" ? "" : p.status === "paused" ? btn("接着做", "pauseProject", [p.id, false]) : btn("先放着", "pauseProject", [p.id, true])}</td></tr>`);
  }
  h.push("</table>");

  h.push("<h3>菜地</h3><table>");
  const cropOptions = (bed: string, i: number, cur: string | null): string =>
    `<select data-ui="plot" data-bed="${bed}" data-i="${i}"><option value="">随他</option>${CROPS.map(
      (c) => `<option value="${c.id}"${cur === c.name ? " selected" : ""}>${c.name}</option>`,
    ).join("")}</select>`;
  s.plots.forEach((p, i) => {
    h.push(`<tr><td>${esc(p.name)}</td><td>${p.crop ? `${esc(p.crop)}${p.ripe ? "，熟了" : `，还有 ${p.daysLeft} 天`}` : "空着"}</td><td>下一茬 ${cropOptions("garden", i, p.preferred)}</td></tr>`);
  });
  h.push(`</table><div class="dim">暖棚：${s.greenhouse.usable ? "能用" : "破的，修好才能用"}</div>`);

  h.push(`<h3>小请求</h3><div class="row">${Object.entries(REQUEST_NAME)
    .map(([k, name]) => btn(name, "request", [k], !!s.request))
    .join("")}</div>`);

  h.push("<h3>样式</h3>");
  const owned = STYLES.filter((x) => ownsStyle(g, x.id));
  h.push(
    `<div class="dim">已有 ${s.focus.stylesUnlocked} 件${s.focus.nextStyleAt ? `，下一件在累计 ${s.focus.nextStyleAt} 份` : ""}</div><div class="row">`,
  );
  for (const x of owned) {
    const on = w.styles[x.slot] === x.id;
    const pending = w.intents.styleSwaps.some((q) => q.styleId === x.id);
    h.push(btn(`${x.name}${on ? " ✓" : pending ? "（想换）" : ""}`, "style", [x.slot, on ? DEFAULT_STYLE[x.slot] : x.id]));
  }
  h.push("</div>");

  h.push("<h3>氛围</h3>");
  h.push(`<div class="row">
    <select id="ambSeason"><option value="winter">冬</option><option value="spring">春</option><option value="summer">夏</option><option value="autumn">秋</option></select>
    <select id="ambWeather"><option value="A">晴</option><option value="B">小雪</option><option value="C">大雪</option><option value="D">暴风雪</option></select>
    <select id="ambTime"><option value="dawn">清晨</option><option value="day">白天</option><option value="dusk">傍晚</option><option value="night">夜</option></select>
    <button data-ui="ambience">换成这个画面</button></div>
    <div class="dim">选了以后世界停在这一刻；专注照常记录和得份。</div>`);

  h.push("<h3>出门</h3>");
  if (s.outing) {
    h.push('<div class="dim">在外面。走、采、歇、生火在场景下面的「野外」一栏。</div>');
  } else {
    const c = checkOuting(w);
    h.push(`<div class="row">干粮 <input id="packRations" type="number" min="0" max="${c.maxRations}" value="${Math.min(2, c.maxRations)}" style="width:50px"/>
      柴捆 <input id="packBundles" type="number" min="0" max="${c.maxBundles}" value="${Math.min(1, c.maxBundles)}" style="width:50px"/>
      <button data-ui="depart"${s.mode !== "companion" ? " disabled" : ""}>点门出门</button></div>
      <div class="dim">${c.ok ? `最多带 ${c.maxRations} 份干粮、${c.maxBundles} 捆柴${c.wrapUp ? `；收尾 ${c.wrapUp} 个游戏分钟` : ""}` : esc(REFUSAL_TEXT[c.reason!])}</div>`);
  }

  h.push(`<h3>手记</h3><div class="row"><button data-ui="tabWorld">日子</button><button data-ui="tabReal">专注</button></div>`);
  if (journalTab === "world") {
    const days = [...w.summaries].slice(-8).reverse();
    h.push(days.map((d) => `<div>${esc(d.text)}</div>`).join("") || '<div class="dim">第一天还没过完。</div>');
  } else {
    const f = g.focus;
    h.push(`<div class="dim">累计 ${(f.stats.totalMs / 3_600_000).toFixed(1)} 小时 · ${f.stats.rounds} 次 · ${f.shares.total} 份 · 书脊 ${f.spines.length} 本</div>`);
    h.push(
      [...f.records]
        .slice(-8)
        .reverse()
        .map((r) => {
          const task = f.tasks.find((t) => t.id === r.taskId);
          return `<div>${r.date} · ${Math.round(r.effectiveMs / 60_000)} 分钟 · ${esc(task ? task.name : CATEGORY_NAME[r.category])}${r.shares ? ` · ${r.shares} 份` : ""}${r.manualMs ? " · 含手动确认" : ""}${r.note ? ` · ${esc(r.note)}` : ""}</div>`;
        })
        .join("") || '<div class="dim">还没有专注记录。</div>',
    );
    const open = f.tasks.filter((t) => !t.done);
    if (open.length) h.push(`<div class="row">${open.map((t) => btn(`勾完：${t.name}`, "completeTask", [t.id])).join("")}</div>`);
    h.push(f.journal.slice(-6).reverse().map((j) => `<div class="dim">${j.date} ${esc(j.text)}</div>`).join(""));
  }
  return h.join("");
}

const BODY_NAME = { warmth: "体温", stamina: "体力", health: "生命" } as const;
const bar = (n: number): string => `<span class="bar"><i style="width:${n}%"></i></span>`;

/** 野外一栏：单独一块，内容变了才重画（世界在野外只随动作变），按钮不会在按下和松开之间被换掉 */
function renderWild(s: Snapshot): string {
  const o = s.outing!;
  const off = s.mode !== "outdoor" || o.panel !== null;
  const h: string[] = [];
  h.push(`<div><strong>${o.area ? esc(o.area) : "院门外"}</strong> · ${esc(s.world.clock)}${o.dark ? " · 天黑了" : ""}${o.nearFire ? " · 在火边" : ""} · 走回家门要 ${o.minutesFromDoor} 分钟</div>`);
  h.push(`<div>${(Object.keys(BODY_NAME) as (keyof typeof BODY_NAME)[]).map((k) => `${BODY_NAME[k]} ${o.body[k]} ${bar(o.body[k])}`).join("")}</div>`);
  const items = [o.rations ? `干粮 ${o.rations}` : "", ...o.bag.items.map((x) => `${x.name} ${x.count}`)].filter(Boolean);
  h.push(`<div>背包 ${o.bag.slots}/${o.bag.maxSlots} 格：${esc(items.join("、") || "空的")}</div>`);
  const m = o.map;
  if (m) {
    const cells: string[] = [];
    m.map.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === "#") return cells.push('<span class="wall"></span>');
        const me = m.x === x && m.y === y;
        const nodeHere = m.nodes.find((n) => n.x === x && n.y === y);
        const fire = m.fires.find((f) => f.x === x && f.y === y);
        const mark = me ? "@" : nodeHere ? (nodeHere.available > 0 ? "*" : "·") : fire ? (fire.burning ? "火" : "F") : "";
        const title = nodeHere ? nodeHere.name : fire ? "生火点" : "";
        cells.push(`<span class="${me ? "me" : ""}" title="${esc(title)}" data-x="${x}" data-y="${y}" data-cmd="outdoor" data-args="${esc(JSON.stringify([{ type: "walkTo", x, y }]))}">${mark}</span>`);
      }),
    );
    h.push(`<div class="map" style="grid-template-columns:repeat(${m.map[0].length},18px)">${cells.join("")}</div>`);
    h.push('<div class="dim">WASD 或方向键走一格，点格子走过去。* 能采，· 这会儿没有，F 生火点，火 点着的篝火。</div>');
    h.push(
      `<div class="row">${m.nodes
        .filter((n) => n.available > 0 || n.unique)
        .map((n) => btn(`采${n.name}${n.unique ? `（剩 ${n.available}）` : ""}`, "outdoor", [{ type: "gather", node: n.id }], off || n.why !== null))
        .join("")}</div>`,
    );
    const why = m.nodes.filter((n) => n.why && n.available > 0).map((n) => `${n.name}：${n.why}`);
    if (why.length) h.push(`<div class="dim">${esc(why.join("　"))}</div>`);
  }
  const atFire = m?.fires.some((f) => f.near) ?? false;
  h.push(`<div class="row">
    ${btn("歇一会儿", "outdoor", [{ type: "rest" }], off)}
    ${btn("吃一份干粮", "outdoor", [{ type: "eat" }], off || o.rations <= 0)}
    ${m ? btn(m.fires.some((f) => f.near && f.burning) ? "添一捆柴" : "生火", "outdoor", [{ type: "fire" }], off || !atFire) : ""}
    ${m ? "" : btn("去松林", "outdoor", [{ type: "travel", to: "pineForest" }], off)}
    ${btn(m ? "从林口回家" : "回屋", "outdoor", [{ type: "travel", to: "home" }], off || (m !== null && !m.atHomeExit))}
    ${(["map", "pack", "journal"] as const).map((p) => btn(o.panel === p ? `合上${PANEL_NAME[p]}` : PANEL_NAME[p], "outdoorPanel", [o.panel === p ? null : p], s.mode !== "outdoor")).join("")}
  </div>`);
  h.push(`<div class="dim">${o.panel ? "面板开着：什么也不做，世界就停着；也不算专注。" : s.mode === "outdoorFocus" ? "在专注：世界停着，他留在原地。" : "站着不动世界不走；每个动作花游戏里的时间。"}</div>`);
  return h.join("");
}

const FIRE_NAME: Record<string, string> = { out: "还没生火", ember: "只剩余烬", low: "小火", mid: "烧得正好", high: "旺火" };
const PANEL_NAME = { map: "地图", pack: "背包", journal: "手记" } as const;

function renderDebug(s: Snapshot, g: Game): string {
  const t = g.telemetry;
  const w = g.world;
  const h: string[] = ["<h3>开发调试（不是游戏界面）</h3>"];
  h.push(`<div>${rt.leader ? "主窗口" : "副窗口"} · 心跳：${esc(rt.lastVerdict)}</div>
    <div>到站第 ${s.world.stationDay} 天 ${s.world.clock} · 天气档 ${w.weather.today}→明天 ${w.weather.tomorrow}</div>
    <div>年份：${w.yearKind} · 炉膛 ${s.fire.burn}+${s.fire.ember} 分钟</div>
    <div>${esc(PLACES[w.actor.place].name)} · ${esc(w.actor.activity?.kind ?? "—")} · 还剩 ${w.actor.activity?.left ?? 0} 分</div>
    <div>G2：${esc(s.stage.pose ?? "—")} / ${esc(s.stage.prop ?? "—")} · 镜头演出：${esc(s.stage.place ?? "空屋")} · 天气来源：${esc(s.look.source)}</div>
    <div class="row">${btn("快进 1 小时", "debugSkip", [60])}${btn("快进 1 天", "debugSkip", [1440])}${btn("快进 12 天", "debugSkip", [1440 * 12])}</div>
    <div class="row">${btn("模拟休眠回来", "debugInterrupt", ["sleep", 0])}${btn("模拟 23 分钟断档", "debugInterrupt", ["gap", 23 * 60_000])}</div>
    <div class="row"><button data-ui="reset">删档重开</button></div>
    <div class="dim">快进只推世界、不推专注，只在正常陪伴时有效。</div>`);
  h.push(`<h3>他醒着时镜头里看得见他</h3><div class="dim">分母：正常陪伴、醒着、没被带出门的 ${t.awakeMinutes} 个游戏分钟</div><table>`);
  for (const c of CAMERA_IDS) h.push(`<tr><td>${esc(CAMERAS[c].name)}</td><td>${pct(t.visibleAwake[c], t.awakeMinutes)}</td></tr>`);
  h.push("</table><h3>醒着时在哪</h3><table>");
  const zoneName = { indoor: "屋里", eaves: "泉屋和防风林", yard: "院子", nearby: "屋边", away: "野外" } as const;
  for (const [z, n] of Object.entries(t.zoneAwake)) h.push(`<tr><td>${zoneName[z as keyof typeof zoneName]}</td><td>${pct(n, t.awakeMinutes)}</td></tr>`);
  h.push("</table><h3>项目的确切进度</h3><table>");
  for (const p of s.projects.filter((x) => x.status === "doing")) h.push(`<tr><td>${esc(p.name)}</td><td>${p.debugMinutes}/${p.debugStageMinutes} 分</td></tr>`);
  h.push("</table><h3>今天的全部事件</h3>");
  h.push(
    w.events
      .filter((e) => e.day === w.day)
      .slice(-14)
      .map((e) => `<div class="dim">${clockText(e.minute % 1440)} ${esc(e.text)}</div>`)
      .join(""),
  );
  return h.join("");
}

const sceneCtx = $<HTMLCanvasElement>("scene").getContext("2d")!;
const c320 = $<HTMLCanvasElement>("small320").getContext("2d")!;
const c480 = $<HTMLCanvasElement>("small480").getContext("2d")!;
let lastTaskSig = "";
let lastWildHtml = "";

function render(): void {
  const g = rt.game;
  if (!g) {
    $("topbar").textContent = "在等主窗口的状态……";
    return;
  }
  const s = present(g, Date.now(), cal);
  $("topbar").innerHTML = renderTop(s);
  drawScene(sceneCtx, s, { frames: true });
  drawScene(c320, s, { crop: CROP.window });
  drawScene(c480, s, { crop: CROP.hearth });
  $("cap320").textContent = cameraCaption(s, "window", "320×180");
  $("cap480").textContent = cameraCaption(s, "hearth", "480×270");
  $("actionRow").innerHTML = renderAction(s);
  const card = $("todayCard");
  card.hidden = !showToday;
  if (showToday) card.innerHTML = renderToday(s);
  $("summaryRow").textContent = s.focus.summaryText;
  $("focusBar").innerHTML = renderFocus(s, g);
  $("notices").textContent = s.notices.slice(-2).map((n) => n.text).join("　");
  const wild = $("wild");
  wild.hidden = !s.outing;
  const wildHtml = s.outing ? renderWild(s) : "";
  if (wildHtml !== lastWildHtml) {
    lastWildHtml = wildHtml;
    wild.innerHTML = wildHtml;
  }
  // 检查面板里有下拉框和输入框：鼠标或键盘正停在上面时不重画，免得打断操作
  const inspect = $("inspect");
  if (!inspect.matches(":hover") && !inspect.contains(document.activeElement)) inspect.innerHTML = renderInspect(s, g);
  $("debug").innerHTML = renderDebug(s, g);
  const sig = g.focus.tasks.map((t) => `${t.id}${t.done}`).join(",");
  if (sig !== lastTaskSig) {
    lastTaskSig = sig;
    $("taskPick").innerHTML =
      '<option value="">不选任务</option>' +
      g.focus.tasks
        .filter((t) => !t.done)
        .map((t) => `<option value="${t.id}">${esc(t.name)}</option>`)
        .join("");
  }
}

rt.onChange = render;

document.addEventListener("click", (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-cmd],[data-ui]");
  if (!el || (el as HTMLButtonElement).disabled) return;
  if (el.dataset.cmd) {
    rt.dispatch(el.dataset.cmd, ...(JSON.parse(el.dataset.args ?? "[]") as unknown[]));
    $("inspect").innerHTML = "";
    render();
    return;
  }
  const val = (id: string): string => $<HTMLInputElement>(id).value;
  switch (el.dataset.ui) {
    case "today":
      showToday = !showToday;
      break;
    case "start": {
      const taskId = val("taskPick") ? Number(val("taskPick")) : null;
      rt.dispatch("startFocus", presetOf(val("preset")), val("category") as TaskCategory, taskId);
      break;
    }
    case "addTask":
      if (val("taskName").trim()) rt.dispatch("addTask", val("taskName"), val("category"));
      $<HTMLInputElement>("taskName").value = "";
      break;
    case "ambience":
      rt.dispatch("enterAmbience", { season: val("ambSeason"), weather: val("ambWeather"), time: val("ambTime") });
      break;
    case "depart":
      rt.dispatch("depart", Number(val("packRations")), Number(val("packBundles")));
      break;
    case "tabWorld":
      journalTab = "world";
      break;
    case "tabReal":
      journalTab = "real";
      break;
    case "reset":
      if (confirm("删掉这个存档，从入冬第一天重新开始？")) rt.reset();
      break;
    default:
      return;
  }
  $("inspect").innerHTML = "";
  render();
});

document.addEventListener("change", (ev) => {
  const el = ev.target as HTMLInputElement | HTMLSelectElement;
  switch (el.dataset.ui) {
    case "autoNext":
      rt.dispatch("setAutoNext", (el as HTMLInputElement).checked);
      break;
    case "keepCans":
      rt.dispatch("keep", "cans", (el as HTMLInputElement).checked);
      break;
    case "keepFuel":
      rt.dispatch("keep", "fuel", (el as HTMLInputElement).checked);
      break;
    case "plot":
      rt.dispatch("plot", el.dataset.bed, Number(el.dataset.i), el.value || null);
      break;
    default:
      break;
  }
});

$<HTMLInputElement>("note").addEventListener("keydown", (ev) => {
  if (ev.key !== "Enter") return;
  const g = rt.game;
  const input = ev.target as HTMLInputElement;
  const id = g?.focus.session?.round.recordId ?? g?.focus.records.at(-1)?.id;
  if (id) rt.dispatch("setNote", id, input.value);
  input.value = "";
});

/** 按住方向键时一步至少隔这么久，免得键盘连发一秒走几十格（野外每一步都花游戏时间） */
const STEP_INTERVAL_MS = 200;
let lastStep = 0;
const STEP: Record<string, [number, number]> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
};

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && showToday) {
    showToday = false;
    render();
    return;
  }
  const dir = STEP[ev.key.length === 1 ? ev.key.toLowerCase() : ev.key];
  const typing = ev.target instanceof HTMLInputElement || ev.target instanceof HTMLSelectElement || ev.target instanceof HTMLTextAreaElement;
  if (!dir || typing || rt.game?.mode !== "outdoor" || !rt.game.world.outing?.pos) return;
  ev.preventDefault();
  const now = performance.now();
  if (now - lastStep < STEP_INTERVAL_MS) return;
  lastStep = now;
  rt.dispatch("outdoor", { type: "move", dx: dir[0], dy: dir[1] });
  render();
});
