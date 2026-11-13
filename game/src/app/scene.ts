// 灰盒场景：色块和文字，只为看清「人在哪、在做什么、火怎么样」。
// 坐标是灰盒自己随手排的，不是 05 的母场景；镜头框只是把 cameras.ts 里那几处地点框起来。
import { CAMERAS, visibleIn, type CameraId } from "../core/cameras.ts";
import { PLACES, type PlaceId } from "../core/content.ts";
import type { Snapshot } from "../core/view.ts";

export const SCENE_W = 960;
export const SCENE_H = 270;

/** 每个地点在灰盒画面里的位置（屋里 0–480，院子 490–740，远处 750–960） */
export const SPOT: Record<PlaceId, [number, number]> = {
  bed: [40, 60],
  door: [28, 190],
  woodpile: [60, 238],
  window: [140, 66],
  windowsill: [140, 104],
  desk: [140, 132],
  bookshelf: [262, 80],
  radio: [240, 190],
  workbench: [292, 190],
  gramophone: [262, 132],
  shelf: [322, 232],
  cellar: [215, 238],
  hearth: [392, 122],
  armchair: [352, 166],
  stove: [440, 166],
  instruments: [452, 102],
  backdoor: [462, 238],
  choppingBlock: [530, 200],
  garden: [600, 110],
  greenhouse: [690, 110],
  dryingRack: [690, 200],
  vane: [530, 60],
  solar: [610, 40],
  gate: [610, 240],
  springhouse: [800, 60],
  windbreak: [900, 60],
  forestEdge: [800, 200],
  creekBend: [900, 200],
  wild: [850, 130],
};

/** 小窗的裁切框（灰盒坐标，16:9） */
export const CROP: Record<"window" | "hearth", [number, number, number, number]> = {
  window: [44, 40, 192, 108],
  hearth: [304, 84, 176, 99],
};

const FIRE_COLOR: Record<string, string> = { out: "#2a2f33", ember: "#7a3b2a", low: "#c9793f", mid: "#f0a04b", high: "#ffcf6b" };
const TRACE_NAME: Record<string, string> = {
  bowl: "碗",
  cup: "杯",
  bucket: "桶",
  kettleSteam: "汽",
  wetBoots: "靴",
  projectTools: "具",
  openBook: "书",
  openJournal: "记",
};

export interface DrawOptions {
  /** 只画这一块（小窗）；不给就是全景 */
  crop?: [number, number, number, number];
  /** 在全景上标出镜头框 */
  frames?: boolean;
}

/** 单独的野外灰盒主镜头：这里只画 Snapshot，不负责移动、采集或世界时间。 */
function drawForestScene(ctx: CanvasRenderingContext2D, snap: Snapshot): void {
  const f=snap.outing?.forest;
  if(!f)return;
  const w=ctx.canvas.width,h=ctx.canvas.height;
  ctx.save();
  ctx.fillStyle="#0e1716";ctx.fillRect(0,0,w,h);
  const unit=Math.max(8,Math.floor(Math.min((w-30)/f.width,(h-30)/f.height)));
  const ox=Math.floor((w-unit*f.width)/2),oy=Math.floor((h-unit*f.height)/2);
  const nodes=new Map(f.nodes.map(n=>[n.x+","+n.y,n]));
  for(let y=0;y<f.height;y++)for(let x=0;x<f.width;x++){
    const tile=f.tiles[y][x];
    const px=ox+x*unit,py=oy+y*unit;
    ctx.fillStyle=tile==="#" ? "#283631" : tile==="G" ? "#8b7460" : (x+y)%3===0 ? "#294238" : "#20372e";
    ctx.fillRect(px,py,unit-1,unit-1);
    if(x===f.fireSpot.x && y===f.fireSpot.y){
      ctx.fillStyle="#d28b54";ctx.beginPath();ctx.arc(px+unit/2,py+unit/2,Math.max(3,unit/5),0,Math.PI*2);ctx.fill();
    }
    const n=nodes.get(x+","+y);
    if(n){
      ctx.fillStyle=n.ready ? (n.unique ? "#efbd72" : "#95c5a4") : "#526257";
      ctx.beginPath();ctx.arc(px+unit/2,py+unit/2,Math.max(2,unit/6),0,Math.PI*2);ctx.fill();
    }
    if(x===f.x && y===f.y){
      ctx.fillStyle="#f3b36c";ctx.fillRect(px+unit*.3,py+unit*.15,unit*.4,unit*.7);
      ctx.fillStyle="#a5443f";ctx.fillRect(px+unit*.35,py+unit*.09,unit*.3,unit*.21);
    }
  }
  ctx.fillStyle="#d5dfd6";ctx.font="12px ui-monospace,monospace";
  ctx.fillText("松林 · 06 v0.4 灰盒试玩（非最终美术）",12,16);
  ctx.fillText("体温 "+f.warmth+"   体力 "+f.stamina+"   生命 "+f.health+"   背包 "+f.slots+"/20",12,h-8);
  ctx.restore();
}

export function drawScene(ctx: CanvasRenderingContext2D, snap: Snapshot, opt: DrawOptions = {}): void {
  if(snap.mode==="outdoor" && snap.outing?.forest){drawForestScene(ctx,snap);return;}
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  ctx.save();
  ctx.fillStyle = "#0f1418";
  ctx.fillRect(0, 0, cw, ch);
  if (opt.crop) {
    const [x, y, w, h] = opt.crop;
    ctx.scale(cw / w, ch / h);
    ctx.translate(-x, -y);
  } else {
    ctx.scale(cw / SCENE_W, ch / SCENE_H);
  }

  // 三块地方
  const blocks: [number, number, string, string][] = [
    [0, 480, "#1b242a", "屋里"],
    [490, 250, "#1a2420", "院子"],
    [750, 210, "#161c22", "屋檐外和屋边"],
  ];
  for (const [x, w, color, name] of blocks) {
    ctx.fillStyle = color;
    ctx.fillRect(x, 0, w, SCENE_H);
    ctx.fillStyle = "#3d4d57";
    ctx.font = "10px sans-serif";
    ctx.fillText(name, x + 4, 12);
  }

  // 雪窗是独立展示投影：正常显示真实天气，氛围只显示选中的演出天气。
  // 户外临时专注同样可能处于冻结状态，但不代表一定选择了氛围天气。
  const look = snap.look;
  ctx.fillStyle = look.source === "ambience" ? "#39506b" :
    look.source === "missing" ? "#344453" :
    /雪/.test(look.weatherLabel ?? "") ? "#8fa9bb" : "#6f8ea6";
  ctx.fillRect(70, 44, 140, 52);
  ctx.fillStyle = "#101820";
  ctx.font = "10px sans-serif";
  const weatherText = look.source === "missing" ? "（氛围未选择）" :
    look.source === "ambience" ? `（氛围）${look.weatherLabel ?? ""}` :
    look.weatherLabel ?? "";
  ctx.fillText(weatherText, 76, 58);

  // 炉火
  ctx.fillStyle = FIRE_COLOR[snap.fire.look] ?? "#333";
  ctx.fillRect(372, 96, 40, 34);

  // 柴堆和粮：高度跟着库存走
  const wood = Math.round((snap.stock.wood / snap.stock.woodCap) * 30);
  ctx.fillStyle = "#876448";
  ctx.fillRect(46, 250 - wood, 28, wood);
  const food = Math.round((snap.stock.food / snap.stock.foodCap) * 30);
  ctx.fillStyle = "#9aa36a";
  ctx.fillRect(308, 250 - food, 28, food);

  // 玻璃罐
  ctx.strokeStyle = "#c7d8de";
  ctx.strokeRect(160, 96, 8, 12);
  ctx.fillStyle = "#b28b63";
  const fill = Math.round((snap.jar.cones / 30) * 12);
  ctx.fillRect(160, 108 - fill, 8, fill);

  // 地点
  ctx.font = "11px sans-serif";
  for (const id of Object.keys(SPOT) as PlaceId[]) {
    const [x, y] = SPOT[id];
    ctx.fillStyle = "#2c3a43";
    ctx.fillRect(x - 3, y - 3, 6, 6);
    ctx.fillStyle = "#5d717d";
    ctx.fillText(PLACES[id].name, x + 6, y + 3);
  }

  // 真实动作留下的小痕迹
  ctx.fillStyle = "#e4b276";
  for (const t of snap.traces) {
    const [x, y] = SPOT[t.place];
    ctx.fillText(TRACE_NAME[t.type] ?? "·", x - 12, y - 6);
  }

  // 人
  if (snap.stage.show && snap.stage.place) {
    const [x, y] = SPOT[snap.stage.place];
    ctx.fillStyle = snap.stage.illusion ? "#7193ac" : snap.actor.outfit === "outdoor" ? "#a65049" : "#e4b276";
    ctx.beginPath();
    ctx.arc(x, y - 10, 7, 0, Math.PI * 2);
    ctx.fill();
    if (snap.actor.asleep && !snap.stage.illusion) {
      ctx.fillStyle = "#c7d8de";
      ctx.fillText("zz", x + 8, y - 14);
    }
  }

  if (opt.frames) {
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    for (const id of ["window", "hearth"] as const) {
      const [x, y, w, h] = CROP[id];
      ctx.strokeStyle = id === "window" ? "#c7d8de" : "#f7b05d";
      ctx.strokeRect(x, y, w, h);
    }
    ctx.setLineDash([]);
  }
  ctx.restore();
}

export function cameraCaption(snap: Snapshot, cam: CameraId, size: string): string {
  // 文案同样按演出位置判断，不能用真实 actor.visible 去判断冻结的幻影人物。
  const seen = snap.stage.show && snap.stage.place !== null && visibleIn(cam, snap.stage.place);
  const where = seen ? "看得见人" : `空景 · ${snap.stage.show ? snap.actor.whereabouts : snap.stage.label}`;
  return `${size} · ${CAMERAS[cam].name} · ${where}`;
}
