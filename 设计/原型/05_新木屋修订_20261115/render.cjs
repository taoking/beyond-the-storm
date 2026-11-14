// Deterministic review renderer: generated artwork stays untouched in sources/.
// NODE_PATH=/tmp/beyond-storm-art-tools/node_modules node <this file>
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const assert = require('node:assert/strict');
const base = __dirname;
const spec = JSON.parse(fs.readFileSync(path.join(base, '站位与镜头.json')));
const [width, height] = spec.canvas;
const file = s => path.join(base, s);
const writeJSON = (p, d) => fs.writeFileSync(file(p), JSON.stringify(d, null, 2) + '\n');
const blank = () => sharp({create:{width,height,channels:4,background:'#00000000'}});
const svg = s => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${s}</svg>`);
const contains = (r, b) => b[0]>=r[0] && b[1]>=r[1] && b[0]+b[2]<=r[0]+r[2] && b[1]+b[3]<=r[1]+r[3];
async function alphaBounds(buf) {
  const {data,info}=await sharp(buf).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let l=info.width,t=info.height,r=-1,b=-1;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>12){l=Math.min(l,x);t=Math.min(t,y);r=Math.max(r,x);b=Math.max(b,y)}
  assert.ok(r>=l,'empty alpha asset'); return [l,t,r-l+1,b-t+1];
}
async function main(){
  for(const d of ['layers','previews'])fs.mkdirSync(file(d),{recursive:true});
  const source=await sharp(file('sources/cabin_generated.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.equal(source.info.width,width);assert.equal(source.info.height,height);
  const room=Buffer.from(source.data),mask=Buffer.alloc(width*height*4);let glassPixels=0;
  for(const [l,t,w,h] of spec.glassMask.regions)for(let y=t;y<t+h;y++)for(let x=l;x<l+w;x++){
    const i=(y*width+x)*4, [r,g,b]=room.subarray(i,i+3);
    if(b>r+10 && g>r+5 && b>g){room[i+3]=0;mask[i]=mask[i+1]=mask[i+2]=mask[i+3]=255;glassPixels++}
  }
  await sharp(room,{raw:{width,height,channels:4}}).png().toFile(file('layers/room_structure.png'));
  await sharp(mask,{raw:{width,height,channels:4}}).png().toFile(file('layers/window_mask.png'));
  // Small illustration patch for this candidate, not a formal G6 background.
  const outside=await sharp(file('sources/exterior_patch.png')).resize(255,361).png().toBuffer();
  const door=await sharp(outside).resize(56,64).png().toBuffer();
  const exterior=await blank().composite([{input:outside,left:136,top:127},{input:door,left:1383,top:226}]).png().toBuffer();
  await sharp(exterior).composite([{input:await sharp(mask,{raw:{width,height,channels:4}}).png().toBuffer(),blend:'dest-in'}]).png().toFile(file('layers/exterior_reference.png'));
  const roomPNG=await sharp(room,{raw:{width,height,channels:4}}).png().toBuffer();
  const day=await blank().composite([{input:file('layers/exterior_reference.png')},{input:roomPNG}]).png().toBuffer();
  await sharp(day).toFile(file('empty_day.png'));
  const night=await sharp(svg('<rect width="100%" height="100%" fill="#0c2045" opacity="0.56"/>')).png().toBuffer();
  await sharp(night).toFile(file('layers/night_mask.png'));
  await sharp(day).composite([{input:night}]).png().toFile(file('empty_night.png'));
  for(const l of spec.locations)if(l.contactShadow){
    const [x,y]=l.id==='bed'?spec.poses.sleep.sleepAnchor:l.footAnchor;
    const ellipse=svg(`<ellipse cx="${x}" cy="${y-1}" rx="${l.id==='bed'?25:l.standingHeightPx*.13}" ry="6" fill="#20150d" opacity=".35"/>`);
    await sharp(ellipse).blur(2).png().toFile(file(l.contactShadow));
  }
  const report={canvas:spec.canvas,glassPixels,poses:{},geometricVisibility:[],limitations:['仅几何边框与静态像素核验；不是内核时间占比报告，也不是用户审美验收']};
  for(const [id,p] of Object.entries(spec.poses)){
    let actor=sharp(file(p.source)).trim({background:'#00000000',threshold:12});
    actor=actor.resize(p.width?{width:p.width}:{height:p.height});
    const a=await actor.png().toBuffer(),meta=await sharp(a).metadata();
    const layer=await blank().composite([{input:a,left:p.left,top:p.top}]).png().toBuffer();
    const polys=p.occlusionPolygons.map(points=>`<polygon points="${points.map(p=>p.join(',')).join(' ')}" fill="white"/>`).join('');
    const clipped=await sharp(day).composite([{input:svg(polys),blend:'dest-in'}]).png().toBuffer();
    // Foreground restoration touches only the actor silhouette, avoiding even
    // rounding changes elsewhere when alpha compositing the same background.
    const occ=await sharp(clipped).composite([{input:layer,blend:'dest-in'}]).png().toBuffer();
    await sharp(layer).toFile(file(`layers/actor_${id}.png`));
    await sharp(occ).toFile(file(`layers/foreground_${id}.png`));
    const shadow=spec.locations.find(l=>l.id===p.place).contactShadow;
    const comp=await sharp(day).composite([{input:file(shadow)},{input:layer},{input:occ}]).png().toBuffer();
    await sharp(comp).webp({lossless:true}).toFile(file(`previews/${id}.webp`));
    const bbox=await alphaBounds(layer);
    p.renderedRect=[p.left,p.top,meta.width,meta.height];p.alphaBounds=bbox;
    p.layer=`layers/actor_${id}.png`;p.foreground=`layers/foreground_${id}.png`;
    // Exact unchanged background outside the actor and its contact shadow.
    const before=await sharp(day).ensureAlpha().raw().toBuffer();
    const after=await sharp(comp).ensureAlpha().raw().toBuffer();
    const al=await sharp(layer).raw().toBuffer(),sh=await sharp(file(shadow)).raw().toBuffer();
    let outsideChanges=0;
    for(let i=0;i<before.length;i+=4)if(!al[i+3]&&!sh[i+3] && (before[i]!==after[i]||before[i+1]!==after[i+1]||before[i+2]!==after[i+2]||before[i+3]!==after[i+3]))outsideChanges++;
    assert.equal(outsideChanges,0,'background drift');
    report.poses[id]={renderedRect:p.renderedRect,alphaBounds:bbox,outsideChanges};
    for(const c of spec.cameras){
      assert.equal(c.rect[2]*9,c.rect[3]*16);
      report.geometricVisibility.push({pose:id,camera:c.id,full:contains(c.rect,bbox),upper:contains(c.rect,p.upperBodyRect||[bbox[0],bbox[1],bbox[2],Math.ceil(bbox[3]/2)])});
      for(const w of [320,480,1280]){
        const [left,top,cw,ch]=c.rect;
        await sharp(comp).extract({left,top,width:cw,height:ch}).resize(w,w*9/16).webp({quality:95}).toFile(file(`previews/${id}_${c.id}_${w}.webp`));
      }
    }
  }
  const tiles=[];let row=0;
  for(const id of Object.keys(spec.poses)){
    let col=0;
    for(const c of spec.cameras){
      tiles.push({input:await sharp(file(`previews/${id}_${c.id}_320.webp`)).png().toBuffer(),left:col*320,top:row*206+26});
      tiles.push({input:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="26"><rect width="320" height="26" fill="#172127"/><text x="9" y="18" font-size="13" fill="#e8d8bf">${id} / ${c.id} / 320×180</text></svg>`),left:col*320,top:row*206});col++;
    }row++;
  }
  await sharp({create:{width:960,height:824,channels:4,background:'#172127'}}).composite(tiles).png().toFile(file('overview_320.png'));
  writeJSON('站位与镜头.json',spec);writeJSON('验证结果.json',report);
  console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1});
