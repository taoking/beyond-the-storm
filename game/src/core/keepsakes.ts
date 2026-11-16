// 藏品、六处展示位和书架（03 第 3.1、4.3、6.5 节；04 第 7 节表第 13 条）。
// 藏品只出现在固定的六处，不自由摆放；摆上去、换下来都是他亲手做（intents.arrange，sim 里的「arrange」小事）。
// 放不下的收进手记的收藏页，满了不自动顶替。书不占展示位，上书架。
import { CONFIG } from "./config.ts";
import { DISPLAY_SLOT_IDS, DISPLAY_SLOTS, KEEPSAKE_BY_ID, KEEPSAKE_FITS, type DisplaySlotId, type KeepsakeDef } from "./content.ts";
import { logEvent } from "./sim.ts";
import type { World } from "./state.ts";

const IMPL = CONFIG.IMPL;

export type ShelfLevel = "few" | "many";

export function keepsakeDef(w: World, uid: string): KeepsakeDef | undefined {
  const item = w.keepsakes.find((k) => k.uid === uid);
  return item ? KEEPSAKE_BY_ID[item.id] : undefined;
}

/** 这件藏品能摆在哪几处，按找空位的先后 */
export function fitsOf(def: KeepsakeDef): DisplaySlotId[] {
  return def.fits ?? KEEPSAKE_FITS[def.kind];
}

/** 这一处一共给藏品留几格：总数减去固定物件（玻璃罐）和样式位 */
export function keepsakeCapacity(slot: DisplaySlotId): number {
  const s = DISPLAY_SLOTS[slot];
  return Math.max(0, IMPL.displayCapacity[slot] - (s.fixed ? 1 : 0) - (s.style ? 1 : 0));
}

/** 现在这一处还空几格（只看已经摆上的） */
export function freeNow(w: World, slot: DisplaySlotId): number {
  return keepsakeCapacity(slot) - w.display[slot].length;
}

/** 算上他还没去做的摆放以后，这一处还空几格 */
export function freePlanned(w: World, slot: DisplaySlotId): number {
  let n = freeNow(w, slot);
  for (const a of w.intents.arrange) {
    if (a.put && a.slot === slot) n -= 1;
    if (a.take && a.slot === slot) n += 1;
    // 要从这里挪去别处的那件，挪走以后这里空出一格
    if (a.put && a.slot !== slot && w.display[slot].includes(a.put)) n += 1;
  }
  return n;
}

/** 摆在哪一处；书在书架上；收在手记里是 null */
export function whereIs(w: World, uid: string): DisplaySlotId | "bookshelf" | null {
  if (keepsakeDef(w, uid)?.kind === "book") return "bookshelf";
  return DISPLAY_SLOT_IDS.find((s) => w.display[s].includes(uid)) ?? null;
}

/**
 * 拿到一件藏品（木雕刻好了、从野外带回了家）。书直接上书架；别的有空位就记成「待摆放」，
 * 他手头空了亲手摆上去；哪处都满了就收进手记的收藏页。返回要摆去的那一处，或者 "bookshelf"、null。
 */
export function acquireKeepsake(w: World, id: string): DisplaySlotId | "bookshelf" | null {
  const def = KEEPSAKE_BY_ID[id];
  if (!def) return null;
  const n = w.keepsakes.filter((k) => k.id === id).length;
  if (!def.repeatable && n > 0) return null;
  const uid = def.repeatable ? `${id}#${n + 1}` : id;
  w.keepsakes.push({ uid, id, day: w.day });
  if (def.kind === "book") return "bookshelf";
  const slot = fitsOf(def).find((s) => freePlanned(w, s) > 0) ?? null;
  if (slot) w.intents.arrange.push({ slot, put: uid, take: null });
  return slot;
}

/**
 * 你想换一处展示位上的东西：put 是要摆上去的那件（可以是收在手记里的，也可以是摆在别处的），
 * take 是要换下来的那件。满了必须指明换下哪件，不自动顶替。返回不行的原因，行就是 null。
 */
export function checkArrange(w: World, slot: DisplaySlotId, put: string | null, take: string | null): string | null {
  if (!DISPLAY_SLOT_IDS.includes(slot)) return "没有这个位置";
  if (!put && !take) return "要选一件摆上去或者换下来";
  if (take && !w.display[slot].includes(take)) return "这件不在这里";
  if (put) {
    const def = keepsakeDef(w, put);
    if (!def) return "还没有这件";
    if (!fitsOf(def).includes(slot)) return `${def.name}放不到${DISPLAY_SLOTS[slot].name}`;
    if (w.display[slot].includes(put)) return "已经摆在这里了";
    // 先把这件之前的安排撤掉再算空位
    const others = w.intents.arrange.filter((a) => a.put !== put);
    const free = freePlanned({ ...w, intents: { ...w.intents, arrange: others } }, slot) + (take ? 1 : 0);
    if (free <= 0) return `${DISPLAY_SLOTS[slot].name}放满了，先选一件换下来`;
  }
  return null;
}

/** 记成「想换」：同一件之前的安排作废，以这一次为准 */
export function planArrange(w: World, slot: DisplaySlotId, put: string | null, take: string | null): void {
  w.intents.arrange = w.intents.arrange.filter((a) => (put === null || a.put !== put) && (take === null || a.take !== take));
  w.intents.arrange.push({ slot, put, take });
}

/** 他亲手摆好：换下来的收进手记，摆上去的从别处挪过来。到这时已经不成立的（空位被占了）就不做 */
export function doArrange(w: World, a: { slot: DisplaySlotId; put: string | null; take: string | null }): void {
  const here = w.display[a.slot];
  const name = (uid: string): string => keepsakeDef(w, uid)?.name ?? "一件东西";
  const where = DISPLAY_SLOTS[a.slot].name;
  let took: string | null = null;
  if (a.take && here.includes(a.take)) {
    here.splice(here.indexOf(a.take), 1);
    took = a.take;
  }
  let put: string | null = null;
  if (a.put && keepsakeDef(w, a.put) && !here.includes(a.put) && freeNow(w, a.slot) > 0) {
    for (const s of DISPLAY_SLOT_IDS) w.display[s] = w.display[s].filter((u) => u !== a.put);
    w.display[a.slot].push(a.put);
    put = a.put;
  }
  if (put && took) logEvent(w, "display", `把${where}上的${name(took)}换成了${name(put)}。`, 2);
  else if (put) logEvent(w, "display", `把${name(put)}摆到了${where}。`, 2);
  else if (took) logEvent(w, "display", `把${name(took)}从${where}收了下来。`, 1);
}

/** 他接下来要摆的那件的名字（动作卡用） */
export function arrangeLabel(w: World): string {
  const a = w.intents.arrange[0];
  if (!a) return "";
  const uid = a.put ?? a.take;
  const def = uid ? keepsakeDef(w, uid) : undefined;
  return a.put ? `在摆${def ? def.name : "东西"}` : `在收${def ? def.name : "东西"}`;
}

/** 书架上的书：带回的书，加上你那一格里的书脊（那一格放得下 milestones.spineSlots 本，满了早的收进纪念册） */
export function shelfCount(w: World, spines: number): { books: number; spines: number; total: number } {
  const books = w.keepsakes.filter((k) => KEEPSAKE_BY_ID[k.id]?.kind === "book").length;
  const onShelf = Math.min(spines, CONFIG.milestones.spineSlots);
  return { books, spines: onShelf, total: books + onShelf };
}

/** 前任留下的书一直在，所以最少也是「稀疏」；只升不降 */
export function shelfLevel(w: World, spines: number): ShelfLevel {
  return shelfCount(w, spines).total >= IMPL.shelfManyAt ? "many" : "few";
}
