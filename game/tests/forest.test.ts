// 06 v0.4 松林最小可玩流程：在独立开发分支测试，不把原型数值当成 02/03 正式定稿。
import { describe, expect, it } from "vitest";
import { CONFIG } from "../src/core/config.ts";
import { FOREST_GATE, FOREST_NODES, forestMap, forestPassable, shortestStepsToGate, slotCount } from "../src/core/forest.ts";
import { advance, cmdDepart, cmdEnterForest, cmdForestGather, cmdForestMove,
  cmdForestRest, cmdForestReturn, cmdHeadHome, cmdOutdoorPanel, cmdStartFocus,
  cmdReturnToWild, newGame, type Game } from "../src/core/game.ts";
import { fixedCalendar } from "../src/core/focus.ts";
import { serialize, deserialize } from "../src/core/save.ts";
import { present } from "../src/core/view.ts";

const WALL=Date.UTC(2026,10,14,10);
const cal=fixedCalendar(0);
function ready(seed=1):Game{
  const g=newGame(seed);
  g.world.weather.today="A";
  g.world.actor.place="door";
  g.world.actor.asleep=false;
  g.world.actor.away=false;
  g.world.actor.activity=null;
  expect(cmdDepart(g,WALL,{rations:2,bundles:1}).ok).toBe(true);
  expect(cmdEnterForest(g).ok).toBe(true);
  return g;
}
const forest=(g:Game)=>g.world.outing!.forest!;
const node=(id:string)=>FOREST_NODES.find(x=>x.id===id)!;
function routeTo(g:Game,id:string):void{
  const target=node(id),f=forest(g);
  const start:[number,number]=[f.x,f.y];
  const queue:[number,number,number,number][]=[[...start,-1,-1]];
  const used=new Set([start.join(",")]);
  const parent=new Map<string,string>();
  let dest:string|null=null;
  for(let i=0;i<queue.length;i++){
    const [x,y]=queue[i];
    if(Math.abs(x-target.x)+Math.abs(y-target.y)<=1){dest=x+","+y;break;}
    for(const [dx,dy] of [[0,-1],[1,0],[0,1],[-1,0]]){
      const nx=x+dx,ny=y+dy,key=nx+","+ny;
      if(!forestPassable(nx,ny)||used.has(key))continue;
      used.add(key);parent.set(key,x+","+y);queue.push([nx,ny,dx,dy]);
    }
  }
  if(!dest)throw new Error("unreachable "+id);
  const steps:[number,number][]=[];
  let curr=dest;
  while(curr!==start.join(",")){
    const prev=parent.get(curr)!;
    const [x,y]=curr.split(",").map(Number),[px,py]=prev.split(",").map(Number);
    steps.push([x-px,y-py]);curr=prev;
  }
  for(const [dx,dy] of steps.reverse())expect(cmdForestMove(g,dx,dy).ok).toBe(true);
}
function returnGate(g:Game):void{
  const f=forest(g);const queue:[[number,number],Array<[number,number]>][]=[[[f.x,f.y],[]]];
  const used=new Set([f.x+","+f.y]);
  let path:Array<[number,number]>|null=null;
  for(let i=0;i<queue.length;i++){
    const [[x,y],steps]=queue[i];
    if(x===FOREST_GATE.x&&y===FOREST_GATE.y){path=steps;break;}
    for(const [dx,dy] of [[0,-1],[-1,0],[0,1],[1,0]]){
      const nx=x+dx,ny=y+dy,key=nx+","+ny;
      if(!forestPassable(nx,ny)||used.has(key))continue;
      used.add(key);queue.push([[nx,ny],[...steps,[dx,dy]]]);
    }
  }
  if(!path)throw Error("no path back");
  for(const [dx,dy] of path)expect(cmdForestMove(g,dx,dy).ok).toBe(true);
}
describe("06 v0.4 forest vertical slice",()=>{
  it("uses existing 20-game-minute route and a deterministic grid with an actual gate",()=>{
    const g=ready(),o=g.world.outing!;
    expect(o.area).toBe("pineForest");
    expect(o.minutesFromDoor).toBe(20);
    expect(o.forest).toMatchObject({x:1,y:4,warmth:100,stamina:100,health:100});
    expect(forestMap()).toHaveLength(9);
    expect(shortestStepsToGate(FOREST_GATE.x,FOREST_GATE.y)).toBe(0);
    expect(present(g,WALL,cal).outing?.forest?.width).toBe(13);
  });
  it("cannot cross walls, move diagonally, teleport home, or mutate on refused command",()=>{
    const g=ready(),before=JSON.stringify(g.world);
    expect(cmdForestMove(g,2,0).ok).toBe(false);
    expect(cmdForestMove(g,-1,0).ok).toBe(false); // gate left edge blocked
    expect(cmdHeadHome(g).ok).toBe(false);
    expect(cmdForestGather(g,"campFuel").ok).toBe(false);
    expect(JSON.stringify(g.world)).toBe(before);
  });
  it("movement consumes game time, weather cools the body and return ETA includes forest path",()=>{
    const g=ready(),w=g.world,m=w.minute,fire=w.fire.burn;
    expect(cmdForestMove(g,1,0).ok).toBe(true);
    expect(w.minute).toBe(m+3);
    expect(w.fire.burn).toBeLessThan(fire);
    expect(forest(g).stamina).toBe(97);
    expect(forest(g).warmth).toBeLessThan(100);
    expect(w.outing!.minutesFromDoor).toBeGreaterThan(20);
  });
  it("collects finite camp rope and really transfers it at the home door; caches cannot reset",()=>{
    const g=ready(),w=g.world;
    routeTo(g,"campRope");
    const b=w.stock.materials.rope;
    expect(cmdForestGather(g,"campRope").ok).toBe(true);
    expect(forest(g).goods.rope).toBe(1);
    expect(cmdForestGather(g,"campRope").ok).toBe(false);
    expect(w.stock.materials.rope).toBe(b); // still in backpack
    expect(cmdForestReturn(g).ok).toBe(false); // nowhere near the gate
    returnGate(g);
    expect(cmdForestReturn(g).ok).toBe(true);
    expect(g.mode).toBe("companion");
    expect(w.outing).toBeNull();
    expect(w.stock.materials.rope).toBe(b+1);
    expect(w.forestMemory!.collectedUnique).toContain("campRope");
    g.world.actor.place="door";g.world.actor.asleep=false;g.world.actor.activity=null;
    expect(cmdDepart(g,WALL,{rations:0,bundles:0}).ok).toBe(true);
    expect(cmdEnterForest(g).ok).toBe(true);
    routeTo(g,"campRope");
    expect(cmdForestGather(g,"campRope").ok).toBe(false);
  });
  it("weather and seasons gate forage points, and renewable resources remember harvest day",()=>{
    const g=ready(),w=g.world;
    routeTo(g,"twigsA");
    expect(cmdForestGather(g,"twigsA").ok).toBe(true);
    expect(cmdForestGather(g,"twigsA").ok).toBe(false);
    expect(w.forestMemory!.harvestedAt.twigsA).toBe(w.day);
    expect(forest(g).goods.wood).toBe(2);
    expect(present(g,WALL,cal).outing!.forest!.nodes.find(n=>n.id==="twigsA")!.ready).toBe(false);
  });
  it("respects 20 slots including already packed rations and bundles",()=>{
    const g=ready(),o=g.world.outing!,f=forest(g);
    expect(slotCount(o)).toBe(2); // 2 rations + 1 bundle
    f.goods.rope=90;
    expect(slotCount(o)).toBe(20);
    routeTo(g,"campLumber");
    const before=g.world.minute;
    expect(cmdForestGather(g,"campLumber").ok).toBe(false);
    expect(g.world.minute).toBe(before);
    expect(g.world.forestMemory?.collectedUnique).not.toContain("campLumber");
  });
  it("map/backpack panel pauses the actual world and body drain; it does not award focus shares",()=>{
    const g=ready(),before=JSON.stringify(g.world);
    cmdOutdoorPanel(g,"pack");
    advance(g,{wall:WALL+30*60_000,verifiedMs:30*60_000},cal);
    expect(JSON.stringify(g.world)).toBe(before);
    expect(g.focus.shares.total).toBe(0);
    expect(cmdForestMove(g,1,0).ok).toBe(false);
    cmdOutdoorPanel(g,null);
    expect(cmdForestMove(g,1,0).ok).toBe(true);
  });
  it("outdoor temporary focus keeps the real forest coordinates and inventory frozen",()=>{
    const g=ready();
    cmdForestMove(g,1,0);
    expect(cmdStartFocus(g,WALL,cal,{preset:{kind:"countup"}}).ok).toBe(true);
    const saved=JSON.stringify({...g.world,pendingCones:0});
    expect(g.mode).toBe("outdoorFocus");
    advance(g,{wall:WALL+20*60_000,verifiedMs:20*60_000},cal);
    expect(JSON.stringify({...g.world,pendingCones:0})).toBe(saved); // focus only adds pending cones
    expect(present(g,WALL,cal).stage.show).toBe(false);
    cmdReturnToWild(g);
    expect(g.mode).toBe("outdoor");
    expect(forest(g).x).toBe(2);
  });
  it("body decline during idle verified time eventually rescues without permanent death",()=>{
    const g=ready();
    forest(g).warmth=0.01;
    advance(g,{wall:WALL+60_000,verifiedMs:60_000},cal);
    expect(g.mode).toBe("companion");
    expect(g.world.outing).toBeNull();
    expect(g.world.actor.place).toBe("bed");
    expect(g.world.events.some(e=>e.type==="collapse")).toBe(true);
  });
  it("saves and reloads forest location/loot and one-off discovery memory",()=>{
    const g=ready();routeTo(g,"campRope");
    cmdForestGather(g,"campRope");
    const fresh=deserialize(serialize(g,WALL)).game;
    expect(fresh.world.outing?.forest).toEqual(g.world.outing?.forest);
    expect(fresh.world.forestMemory).toEqual(g.world.forestMemory);
    expect(present(fresh,WALL,cal).outing?.forest?.goods.rope).toBe(1);
  });
  it("does not rewrite D6 provisional out-of-home meal logic",()=>{
    expect(CONFIG.IMPL.outingMealWithoutRationsIsMissed).toBe(false);
  });
});
