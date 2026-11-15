import {newGame,cmdCheckOuting,cmdDepart,cmdOutdoor,cmdOutdoorPanel,cmdStartFocus,cmdPauseFocus,cmdReturnToWild,type Result,type Game} from '../../game/src/core/game.ts';
import {present} from '../../game/src/core/view.ts';
import {fixedCalendar} from '../../game/src/core/focus.ts';
import type {WildAction} from '../../game/src/core/wild.ts';
import {AREAS} from '../../game/src/core/content.ts';

// Independent ephemeral fixture, never the user's running game or save file.
const game=newGame(20261113);
const cal=fixedCalendar(480),$=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const canvas=$<HTMLCanvasElement>('map'),ctx=canvas.getContext('2d')!;
const snapshot=()=>present(game,Date.now(),cal);
let originX=0,originY=0,tile=20;
const panelNames={pack:'背包',map:'地图',journal:'手记'};
function run(result:Result){$('message').textContent=result.ok?'':result.reason||'这一步暂时做不了。';render();}
function outdoor(action:WildAction){run(cmdOutdoor(game,Date.now(),action));}
function openPanel(panel:Game['outdoorPanel']){run(cmdOutdoorPanel(game,panel));if(panel)$('closePanel').focus();else canvas.focus();}
function render(){
 const s=snapshot(),o=s.outing,m=o?.map;
 $('pack').hidden=game.mode!=='companion';$('outdoor').hidden=game.mode!=='outdoor';$('focusView').hidden=game.mode!=='outdoorFocus';
 const status=$('status');status.dataset.minute=String(game.world.minute);status.dataset.day=String(game.world.day);status.dataset.mode=game.mode;status.dataset.x=String(m?.x??'');status.dataset.y=String(m?.y??'');
 status.textContent=game.mode==='companion'?'已在木屋 · 专注不会自动恢复':game.mode==='outdoorFocus'?'户外临时专注 · 世界暂停':`${o?.area||'院门外'} · ${s.world.clock} · ${s.world.look} · 体温 ${o?.body.warmth}% / 体力 ${o?.body.stamina}% / 生命 ${o?.body.health}%`;
 if(game.mode==='companion'){
  const check=cmdCheckOuting(game);$('stock').textContent=`家中柴 ${s.stock.wood} 根，粮 ${s.stock.food} 餐；可带干粮 ${check.maxRations} 份、柴 ${check.maxBundles} 捆。`;
  $<HTMLInputElement>('rations').max=String(check.maxRations);$<HTMLInputElement>('bundles').max=String(check.maxBundles);$<HTMLButtonElement>('depart').disabled=!check.ok;
 }
 $('enter').hidden=!!m;$<HTMLButtonElement>('enter').disabled=!!o?.panel;
 $<HTMLButtonElement>('home').disabled=game.mode!=='outdoor'||!!o?.panel||!!m&&!m.atHomeExit;
 for(const b of document.querySelectorAll<HTMLButtonElement>('[data-action],#focus'))b.disabled=game.mode!=='outdoor'||!!o?.panel;
 $('panel').hidden=!o?.panel;
 if(o?.panel){$('panelTitle').textContent=panelNames[o.panel as keyof typeof panelNames];$('panelContent').textContent=o.panel==='pack'?`干粮 ${o.rations} 份\n背包 ${o.bag.slots}/${o.bag.maxSlots} 格\n`+o.bag.items.map(i=>`${i.name} ${i.count}`).join('\n'):o.panel==='journal'?s.today.top.map(e=>e.text).join('\n')||'还没有新的记录。':`${o.area||'院门外'}\n${m?.atHomeExit?'已在返家出口。':'先走回蓝色出口，再从出口回家。'}`;}
 ctx.clearRect(0,0,640,360);ctx.fillStyle='#213946';ctx.fillRect(0,0,640,360);
 if(!m){ctx.fillStyle='#dbe3dc';ctx.font='20px system-ui';ctx.fillText('院门外：选择进入松林，或走回家门。',50,170);return;}
 tile=Math.min(600/m.map[0].length,310/m.map.length);originX=(640-tile*m.map[0].length)/2;originY=(360-tile*m.map.length)/2;
 m.map.forEach((row,y)=>[...row].forEach((cell,x)=>{ctx.fillStyle=cell==='#'?'#102d31':cell==='H'?'#78b6d1':'#5d797c';ctx.fillRect(originX+x*tile,originY+y*tile,tile-1,tile-1);if(cell==='H'){ctx.fillStyle='#0b303e';ctx.font=`${tile*.6}px system-ui`;ctx.fillText('⌂',originX+x*tile+tile*.15,originY+(y+.75)*tile)}}));
 for(const exit of AREAS.find(a=>a.id===m.id)?.exits||[])if(exit.to==='home'){ctx.fillStyle='#78b6d1';ctx.fillRect(originX+exit.x*tile,originY+exit.y*tile,tile-1,tile-1);ctx.fillStyle='#163844';ctx.font=`${tile*.6}px system-ui`;ctx.fillText('⌂',originX+(exit.x+.15)*tile,originY+(exit.y+.75)*tile)}
 for(const n of m.nodes){ctx.fillStyle=n.available>0?'#d4b46d':'#7e8079';ctx.fillRect(originX+(n.x+.25)*tile,originY+(n.y+.25)*tile,tile*.5,tile*.5)}
 for(const f of m.fires){ctx.fillStyle=f.burning?'#f5a250':'#b98f68';ctx.beginPath();ctx.arc(originX+(f.x+.5)*tile,originY+(f.y+.5)*tile,tile*.22,0,Math.PI*2);ctx.fill()}
 ctx.fillStyle='#d4f1b9';ctx.fillRect(originX+(m.x+.2)*tile,originY+(m.y+.2)*tile,tile*.6,tile*.6);
}
$('depart').onclick=()=>{run(cmdDepart(game,Date.now(),{rations:Number($<HTMLInputElement>('rations').value),bundles:Number($<HTMLInputElement>('bundles').value)}));canvas.focus()};
$('enter').onclick=()=>{outdoor({type:'travel',to:'pineForest'});canvas.focus()};
$('home').onclick=()=>outdoor({type:'travel',to:'home'});
$('focus').onclick=()=>run(cmdStartFocus(game,Date.now(),cal));
$('back').onclick=()=>{cmdPauseFocus(game);run(cmdReturnToWild(game));canvas.focus()};
for(const b of document.querySelectorAll<HTMLButtonElement>('[data-panel]'))b.onclick=()=>openPanel(b.dataset.panel as Game['outdoorPanel']);
for(const b of document.querySelectorAll<HTMLButtonElement>('[data-action]'))b.onclick=()=>outdoor({type:b.dataset.action} as WildAction);
$('closePanel').onclick=()=>openPanel(null);
function gather(id:string){outdoor({type:'gather',node:id})}
canvas.onclick=e=>{
 if(game.mode!=='outdoor'||game.outdoorPanel)return;
 canvas.focus();const rect=canvas.getBoundingClientRect(),x=Math.floor(((e.clientX-rect.left)*640/rect.width-originX)/tile),y=Math.floor(((e.clientY-rect.top)*360/rect.height-originY)/tile),m=snapshot().outing?.map;
 if(!m||x<0||y<0||y>=m.map.length||x>=m.map[0].length)return;
 const n=m.nodes.find(n=>n.x===x&&n.y===y);outdoor({type:'walkTo',x,y});
 if(n&&game.mode==='outdoor'&&!game.outdoorPanel)gather(n.id);
};
document.addEventListener('keydown',e=>{
 if(game.mode!=='outdoor'||e.ctrlKey||e.metaKey||e.altKey)return;
 if(e.key==='Escape'&&game.outdoorPanel){e.preventDefault();openPanel(null);return}
 if(game.outdoorPanel||document.activeElement!==canvas)return;
 const k=e.key.toLowerCase(),dir:Record<string,[number,number]>={w:[0,-1],s:[0,1],a:[-1,0],d:[1,0]};
 if(dir[k]){e.preventDefault();outdoor({type:'move',dx:dir[k][0],dy:dir[k][1]})}
 else if(['b','m','j'].includes(k)){e.preventDefault();openPanel(({b:'pack',m:'map',j:'journal'} as const)[k as 'b'|'m'|'j'])}
 else if(k==='e'){e.preventDefault();const n=snapshot().outing?.map?.nodes.find(n=>n.near&&n.available>0);if(n)gather(n.id)}
});
// Read-only verification surface; all actions above call the real 06 commands.
Object.assign(window,{outdoorReview:{read:()=>({snapshot:snapshot(),minute:game.world.minute,day:game.world.day})}});
render();
