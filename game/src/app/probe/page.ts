// 真机验证日志的导出页（log.html）：读本机 IndexedDB 里的日志，显示判断，导出成文件。开发用，不进游戏窗口。
import { analyze, reportText, VERDICT_TEXT, type Report } from "./analyze.ts";
import { PROBE_FORMAT, PROBE_FORMAT_VERSION, type Entry, type ProbeExport } from "./entries.ts";
import { MIRROR_PREFIX, PROBE_DB, PROBE_STORE } from "./recorder.ts";

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PROBE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(PROBE_STORE, { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** IndexedDB 里的，加上还没写进去、抄在 localStorage 里的（游戏窗口被杀时留下的）。重复的由 analyze 去重 */
async function readAll(): Promise<Entry[]> {
  const db = await openDb();
  const stored = await new Promise<Entry[]>((resolve, reject) => {
    const req = db.transaction(PROBE_STORE, "readonly").objectStore(PROBE_STORE).getAll();
    req.onsuccess = () => resolve(req.result as Entry[]);
    req.onerror = () => reject(req.error);
  });
  const seen = new Set(stored.map((e) => `${e.sid}:${e.seq}`));
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(MIRROR_PREFIX)) continue;
    try {
      for (const e of JSON.parse(localStorage.getItem(key) ?? "[]") as Entry[]) if (!seen.has(`${e.sid}:${e.seq}`)) stored.push(e);
    } catch {
      /* 坏了就不要 */
    }
  }
  return stored;
}

async function clearAll(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PROBE_STORE, "readwrite");
    tx.objectStore(PROBE_STORE).clear();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(MIRROR_PREFIX)) localStorage.removeItem(key);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function stamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function exportOf(entries: Entry[]): ProbeExport {
  return { format: PROBE_FORMAT, version: PROBE_FORMAT_VERSION, exportedWall: Date.now(), ua: navigator.userAgent, entries };
}

function render(r: Report, entries: Entry[]): void {
  $("report").innerHTML = r.items
    .map(
      (it) =>
        `<div class="item ${it.verdict}"><h2><span>【${VERDICT_TEXT[it.verdict]}】</span>${esc(it.title)}</h2>${it.lines
          .map((l) => `<p${l.startsWith("✗") ? ' class="bad"' : ""}>${esc(l)}</p>`)
          .join("")}</div>`,
    )
    .join("");
  $("tail").textContent = entries
    .slice(-200)
    .map((e) => JSON.stringify(e))
    .join("\n");
}

let entries: Entry[] = [];
async function refresh(): Promise<void> {
  try {
    entries = await readAll();
    const r = analyze(entries);
    render(r, entries);
    $("status").textContent = `${entries.length} 条，${r.sessions} 个页面会话`;
  } catch (err) {
    $("status").textContent = `读不到日志：${String(err)}`;
  }
}

$("refresh").onclick = () => void refresh();
$("exportJson").onclick = async () => {
  await refresh();
  download(`bts-probe-${stamp()}.json`, JSON.stringify(exportOf(entries)), "application/json");
};
$("exportText").onclick = async () => {
  await refresh();
  download(`bts-probe-${stamp()}.txt`, reportText(analyze(entries)), "text/plain");
};
$("clear").onclick = async () => {
  if (!confirm("清空这台电脑这个浏览器里的全部验证日志？游戏存档不受影响。")) return;
  await clearAll();
  await refresh();
};
// 给无界面浏览器的自检用：window.__probeExport() 返回和「导出 JSON」一样的内容
(window as Window & { __probeExport?: () => Promise<ProbeExport> }).__probeExport = async () => exportOf(await readAll());
void refresh();
