/* Candidate layer assembler. Artwork originates from imagegen, not procedural scene drawing.
 * NODE_PATH=/tmp/beyond-storm-art-tools/node_modules node <this file>
 * The single editable coordinate source is 站位.json. Sources are never overwritten. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const base = __dirname;
const spec = JSON.parse(fs.readFileSync(path.join(base, '站位.json')));
const [width, height] = spec.canvas;
const file = p => path.join(base, p);
const blank = () => sharp({create:{width,height,channels:4,background:'#00000000'}});
const svg = body => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`);
const polygon = (points, attrs='fill="white"') => `<polygon points="${points.map(p=>p.join(',')).join(' ')}" ${attrs}/>`;
const save = async (p,b) => sharp(b).png().toFile(file(p));
async function bounds(buf) {
  const {data,info}=await sharp(buf).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let l=info.width,t=info.height,r=-1,b=-1;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>12){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x);b=Math.max(b,y)}
  assert.ok(r>=l,'empty alpha layer'); return [l,t,r-l+1,b-t+1];
}
async function placed(source, placement) {
  const b=await sharp(file(source)).trim({background:'#00000000',threshold:12}).resize(placement.width?{width:placement.width}:{height:placement.height}).png().toBuffer();
  return blank().composite([{input:b,left:placement.left,top:placement.top}]).png().toBuffer();
}
function lightingSvg(room, strength, part='receiver') {
  const [x,y]=room.glow.source;
  const door=spec.doors.find(d=>d.to===room.id && d.from==='hearth');
  const shape=door?polygon(door.screens[room.id].polygon,'fill="url(#door)"'):'';
  const defs=`<defs><radialGradient id="floor"><stop stop-color="#ffb65e" stop-opacity="${strength*.22}"/><stop offset="1" stop-color="#ffb65e" stop-opacity="0"/></radialGradient><linearGradient id="door" x2="0" y2="1"><stop stop-color="#e49b43" stop-opacity="${strength*.14}"/><stop offset="1" stop-color="#ffae58" stop-opacity="${strength*.32}"/></linearGradient></defs>`;
  if(part==='door')return svg(defs+shape);
  return svg(`${defs}${polygon(room.glow.floor,'fill="url(#floor)"')}${room.id==='hearth'?`<ellipse cx="${x}" cy="${y}" rx="170" ry="160" fill="url(#floor)"/>`:''}${room.id==='bedroom'?'<ellipse cx="1250" cy="550" rx="300" ry="160" fill="url(#floor)"/>':''}`);
}
async function main(){
  for(const d of ['layers','previews'])fs.mkdirSync(file(d),{recursive:true});
  const report={canvas:spec.canvas,sourceCanvas:spec.sourceCanvas,crop:spec.sourceCrop,rooms:{},poses:{},limits:['候选静态装配与几何/像素检查；不是正式生产资产、内核可见率或用户审美通过']};
  for(const room of spec.rooms){
    const {data,info}=await sharp(file(room.artworkSource||`sources/${room.id}.png`)).extract({left:spec.sourceCrop[0],top:spec.sourceCrop[1],width,height}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(info.width,width);const structure=Buffer.from(data),glass=Buffer.alloc(data.length);let glassPixels=0;
    for(const window of room.windows)for(const [l,t,w,h] of window.regions)for(let y=t;y<t+h;y++)for(let x=l;x<l+w;x++){
      const i=(y*width+x)*4,[r,g,b]=structure.subarray(i,i+3);
      if(b>r+18 && g>r+5 && b>g+8){structure[i+3]=0;glass[i]=glass[i+1]=glass[i+2]=glass[i+3]=255;glassPixels++}
    }
    assert.ok(glassPixels>1000,room.id+' missing glass');
    const plate=await sharp(structure,{raw:{width,height,channels:4}}).png().toBuffer();
    const mask=await sharp(glass,{raw:{width,height,channels:4}}).png().toBuffer();
    await save(`layers/${room.id}_structure.png`,plate);await save(`layers/${room.id}_window_mask.png`,mask);
    const outsideParts=[];
    for(const window of room.windows)for(const [left,top,w,h] of window.regions){outsideParts.push({input:await sharp(file('sources/exterior_patch.png')).resize(w,h,{fit:'cover'}).png().toBuffer(),left,top})}
    const outside=await blank().composite(outsideParts).png().toBuffer();
    const exterior=await sharp(outside).composite([{input:mask,blend:'dest-in'}]).png().toBuffer();
    await save(`layers/${room.id}_exterior_day.png`,exterior);
    const outsideNight=await sharp(exterior).modulate({brightness:.47,saturation:.7}).png().toBuffer();
    await save(`layers/${room.id}_exterior_night.png`,outsideNight);
    const night=await sharp(svg('<rect width="100%" height="100%" fill="#142640" opacity=".62"/>')).png().toBuffer();
    await save(`layers/${room.id}_night.png`,night);
    let snowLight;
    if(room.nightSnowLight){const {ellipse:[x,y,rx,ry],maxOpacity,file:p}=room.nightSnowLight;snowLight=await sharp(svg(`<defs><radialGradient id="s"><stop stop-color="#b3cce3" stop-opacity="${maxOpacity}"/><stop offset="1" stop-color="#b3cce3" stop-opacity="0"/></radialGradient></defs><ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="url(#s)"/>`)).png().toBuffer();await save(p,snowLight)}
    const lamp=await placed('sources/lamp.png',room.lamp);await save(room.lamp.body,lamp);
    const [lx,ly]=room.lamp.lightCenter;
    const lampLight=await sharp(svg(`<defs><radialGradient id="l"><stop stop-color="#ffd793" stop-opacity=".35"/><stop offset="1" stop-color="#ffd793" stop-opacity="0"/></radialGradient></defs><ellipse cx="${lx}" cy="${ly+50}" rx="190" ry="170" fill="url(#l)"/><ellipse cx="${lx}" cy="${ly}" rx="3" ry="6" fill="#ffe8b2"/>`)).png().toBuffer();
    await save(room.lamp.glow,lampLight);
    const lights={},doorLights={};
    for(const [key,strength] of [['low',.45],['mid',.7],['high',1]]){
      lights[key]=await sharp(lightingSvg(room,strength)).png().toBuffer();await save(`layers/${room.id}_firelight_${key}.png`,lights[key]);
      doorLights[key]=await sharp(lightingSvg(room,strength,'door')).png().toBuffer();await save(`layers/${room.id}_doorlight_${key}.png`,doorLights[key]);
    }
    const flames={};
    if(room.id==='hearth')for(const [key,h] of [['low',40],['mid',64],['high',86]]){
      flames[key]=await placed('sources/fire.png',{left:1005-(h-40)/2,top:520-h,height:h});await save(`layers/fire_${key}.png`,flames[key]);
    }
    // Every actionable place gets its own floor contact shadow, even where no pose exists yet.
    for(const location of room.locations){
      const [x,y]=location.footAnchor,[rx,ry]=location.shadowRadius;
      await sharp(svg(`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="#21180f" opacity=".38"/>`)).blur(2).png().toFile(file(location.contactShadow));
      assert.equal(location.standingHeightPx,Math.round(room.depthScale.slope*y+room.depthScale.intercept));
      assert.ok(location.standingHeightPx/height>=.4 && location.standingHeightPx/height<=.5);
    }
    let actor,foreground,shadow;
    const pose=spec.posePlacements.find(p=>p.roomId===room.id);
    actor=await placed(pose.source,pose);await save(`layers/${room.id}_actor_${pose.id}.png`,actor);
    // Furniture extracted from this same plate restores only its intersection with the actor.
    // This is a compositor mask, not generated replacement art.
    const occ=await sharp(svg(pose.occlusionPolygons.map(p=>polygon(p)).join(''))).png().toBuffer();
    const fullOccluder=await sharp(plate).composite([{input:occ,blend:'dest-in'}]).png().toBuffer();
    await save(`layers/${room.id}_occluder.png`,fullOccluder);
    foreground=await sharp(fullOccluder).composite([{input:actor,blend:'dest-in'}]).png().toBuffer();
    await save(`layers/${room.id}_foreground_${pose.id}.png`,foreground);
    if(pose.id==='sleep'){
      const [x,y]=pose.bedContactAnchor;
      shadow=await sharp(svg(`<ellipse cx="${x-30}" cy="${y+10}" rx="70" ry="10" fill="#342a20" opacity=".2"/>`)).blur(3).png().toBuffer();
      await save('layers/shadow_sleep_head.png',shadow);
    }else shadow=fs.readFileSync(file(room.locations.find(l=>l.id===pose.place).contactShadow));
    const actorBounds=await bounds(actor);
    report.poses[pose.id]={room:room.id,place:pose.place,alphaBounds:actorBounds,standingEquivalentPx:room.locations.find(l=>l.id===pose.place).standingHeightPx,footAnchor:pose.footAnchor,bedContactAnchor:pose.bedContactAnchor,layer:`layers/${room.id}_actor_${pose.id}.png`};
    const nightActor=await sharp(actor).composite([{input:night,blend:'atop'}]).png().toBuffer();
    const nightForeground=await sharp(foreground).composite([{input:night,blend:'atop'}]).png().toBuffer();
    // A room always stays complete. At night the darkening precedes local light.
    for(const time of ['day','night']){
      const exteriorForTime=time==='day'?exterior:outsideNight;
      const roomAndLamp=await sharp(plate).composite([{input:lamp}]).png().toBuffer();
      const timedRoom=time==='night'?await sharp(roomAndLamp).composite([{input:night,blend:'atop'}]).png().toBuffer():roomAndLamp;
      // Glass is transparent in timedRoom: snowlight must not be darkened twice.
      const noLight=await blank().composite([{input:exteriorForTime},{input:timedRoom}]).png().toBuffer();
      const backgroundLight=await sharp(noLight).composite([{input:doorLights.mid,blend:'screen'}]).png().toBuffer();
      const lightParts=[{input:lights.mid,blend:'screen'}];
      if(time==='night'&&snowLight)lightParts.unshift({input:snowLight,blend:'screen'});
      if(time==='night')lightParts.push({input:lampLight,blend:'screen'});
      if(room.id==='hearth')lightParts.push({input:flames.mid});
      const empty=await sharp(backgroundLight).composite(lightParts).png().toBuffer();
      const occupied=await sharp(backgroundLight).composite([{input:shadow},{input:time==='night'?nightActor:actor},{input:time==='night'?nightForeground:foreground},...lightParts]).png().toBuffer();
      await save(`${room.id}_empty_${time}.png`,empty);
      await sharp(occupied).webp({lossless:true}).toFile(file(`${room.id}_${pose.id}_${time}.webp`));
      for(const w of [320,480,1280]){
        await sharp(empty).resize(w,w*9/16).webp({quality:95}).toFile(file(`previews/${room.id}_empty_${time}_${w}.webp`));
        await sharp(occupied).resize(w,w*9/16).webp({quality:95}).toFile(file(`previews/${room.id}_${pose.id}_${time}_${w}.webp`));
      }
      if(time==='night'){
        const raw=await sharp(occupied).removeAlpha().raw().toBuffer();
        const [bx,by,bw,bh]=actorBounds;let sum=0,n=0;
        for(let y=by;y<by+bh;y++)for(let x=bx;x<bx+bw;x++){const i=(y*width+x)*3;sum+=(raw[i]*.2126+raw[i+1]*.7152+raw[i+2]*.0722);n++}
        report.poses[pose.id].nightBoundsMeanLuma=+(sum/n).toFixed(2);
      }
    }
    report.rooms[room.id]={glassPixels,locations:room.locations.length,windowCount:room.windows.length,independentLamp:room.lamp.id,doorsToHearth:spec.doors.filter(d=>d.from==='hearth'&&d.to===room.id).map(d=>d.id),previews:12};
  }
  await drawPlan();
  const tiles=[];let row=0;
  for(const room of spec.rooms){
    const pose=spec.posePlacements.find(p=>p.roomId===room.id);
    for(const [col,[kind,label]] of [['empty_day','空屋 · 冬昼'],[`${pose.id}_day`,'有人 · 冬昼'],[`${pose.id}_night`,'有人 · 冬夜']].entries()){
      tiles.push({input:await sharp(file(`previews/${room.id}_${kind}_320.webp`)).png().toBuffer(),left:col*320,top:row*210+30});
      tiles.push({input:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="30"><rect width="320" height="30" fill="#18242b"/><text x="10" y="21" font-family="PingFang SC, sans-serif" font-size="14" fill="#eadcc6">${room.label} / ${label} / 320×180</text></svg>`),left:col*320,top:row*210});
    }row++;
  }
  await sharp({create:{width:960,height:840,channels:4,background:'#18242b'}}).composite(tiles).png().toFile(file('四间总览_320.png'));
  fs.writeFileSync(file('装配结果.json'),JSON.stringify(report,null,2)+'\n');
  fs.writeFileSync(file('data.js'),'// Generated from 站位.json; edit that JSON, then run render.cjs.\nwindow.FOUR_ROOMS = '+JSON.stringify(spec)+';\n');
  console.log(JSON.stringify(report,null,2));
}
async function drawPlan(){
  const sx=x=>80+x*90,sy=y=>100+y*80;
  let body='<rect width="1280" height="850" fill="#f3eee4"/><g font-family="PingFang SC, sans-serif" fill="#283b41"><text x="55" y="43" font-size="25">木屋分四间 · 俯视平面候选</text><text x="55" y="74" font-size="14">北 ↑　炉间居中，三门常开；每间窗可见天气。位置是拓扑示意，非施工尺寸。</text>';
  const rect=(r,attrs)=>`<rect x="${sx(r[0])}" y="${sy(r[1])}" width="${r[2]*90}" height="${r[3]*80}" ${attrs}/>`;
  for(const room of spec.rooms){
    body+=rect(room.planRect,`fill="${room.id==='hearth'?'#e9d6bb':'#e4dfd4'}" stroke="#534b3d" stroke-width="7"`);
    body+=`<text x="${sx(room.planRect[0]+.2)}" y="${sy(room.planRect[1]+.37)}" font-size="21" font-weight="bold">${room.label}${room.id==='observation'?'（默认）':''}</text>`;
    for(const l of room.locations){const [x,y]=l.planPoint;const end=x>room.planRect[0]+3;body+=`<circle cx="${sx(x)}" cy="${sy(y)}" r="4" fill="#706254"/><text x="${sx(x)+(end?-8:8)}" y="${sy(y)+5}" font-size="13" text-anchor="${end?'end':'start'}">${l.planLabel||l.label}</text>`}
    {const [x,y]=room.lamp.planPoint;body+=`<circle cx="${sx(x)}" cy="${sy(y)}" r="5" fill="#bd8c4d"/><text x="${sx(x)-7}" y="${sy(y)+22}" text-anchor="end" font-size="12">油灯</text>`}
  }
  for(const d of spec.doors){const [x,y]=d.planPoint;const vertical=d.id!=='hearth_kitchen';body+=`<path d="M${sx(x)-(vertical?0:40)},${sy(y)-(vertical?35:0)} ${vertical?'v70':'h80'}" stroke="#f3eee4" stroke-width="11"/>`;body+=`<path d="M${sx(x)-(vertical?0:40)},${sy(y)-(vertical?35:0)} ${vertical?'v70':'h80'}" stroke="#bf884c" stroke-width="2" stroke-dasharray="4 3"/>`}
  body+=rect(spec.floorPlan.shortPassage,'fill="#e2dccf" stroke="#8d7e65" stroke-dasharray="5 3"');
  body+=rect(spec.floorPlan.springhouse,'fill="#e1e6df" stroke="#8d7e65" stroke-dasharray="5 3"');
  for(const room of spec.rooms)for(const w of room.windows){const [x,y]=w.planPoint;const span=w.planSpan*(w.onDoor?80:90);body+=`<path d="M${sx(x)-(w.onDoor?0:span/2)},${sy(y)-(w.onDoor?span/2:0)} ${w.onDoor?'v'+span:'h'+span}" stroke="#5a9caf" stroke-width="8"/>`}
  body+=`<text x="${sx(8.05)}" y="${sy(6.95)}" font-size="12">短廊</text><text x="${sx(9.3)}" y="${sy(7)}" font-size="15">泉屋（室外）</text><text x="${sx(4)-150}" y="${sy(6.7)}" font-size="13">正门 ← 院子</text><text x="${sx(8.2)}" y="${sy(6.1)}" font-size="13">后门兼短廊门 →</text><text x="${sx(8.2)}" y="${sy(7.9)}" font-size="12">牵引绳由短廊向防风林；地窖口在院子</text><text x="55" y="807" font-size="15">蓝线＝窗（灶间两扇为门上窗）　虚线缺口＝门；炉间南门在炉间候选取景点后方。</text><text x="55" y="833" font-size="13">本轮只审四间构图；每间独立 16:9，窗外、人物、油灯与火光分层。正式 G5 未开始。</text></g>`;
  const out=`<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="850">${body}</svg>`;
  fs.writeFileSync(file('俯视平面.svg'),out);await sharp(Buffer.from(out)).png().toFile(file('俯视平面.png'));
}
main().catch(e=>{console.error(e);process.exitCode=1});
