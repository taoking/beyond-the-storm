/* Validate deliverables, real browser sizes and room/actor/light independence. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const sharp=require('sharp');
const {chromium}=require('playwright');
const base=__dirname,file=p=>path.join(base,p);
const spec=JSON.parse(fs.readFileSync(file('站位.json')));
const url=process.env.REVIEW_URL||'http://127.0.0.1:8765/设计/原型/05_木屋四间_20261115/';
async function main(){
 const [W,H]=spec.canvas;assert.equal(W*9,H*16);assert.equal(spec.defaultRoom,'observation');
 const expected={hearth:['hearth','woodpile','armchair','radio','gramophone'],observation:['window','windowsill','desk','bookshelf','instruments'],kitchen:['stove','shelf','workbench','door','backdoor'],bedroom:['bed']};
 const ids=spec.rooms.flatMap(r=>r.locations.map(l=>l.id));assert.equal(new Set(ids).size,16);
 const geometry=[];
 for(const r of spec.rooms){
  assert.deepEqual(r.locations.map(l=>l.id),expected[r.id]);assert.ok(r.windows.length);
  if(r.id!=='hearth'){const door=spec.doors.find(d=>d.from==='hearth'&&d.to===r.id);assert.ok(door.screens[r.id].polygon.length>=4)}
  const raw=await sharp(file(r.neutralStructure)).ensureAlpha().raw().toBuffer();let transparent=0;
  for(let i=3;i<raw.length;i+=4)if(raw[i]===0)transparent++;
  assert.ok(transparent>1000,r.id+' glass holes');
  for(const l of r.locations){assert.equal(l.standingHeightPx,Math.round(r.depthScale.slope*l.footAnchor[1]+r.depthScale.intercept));assert.ok(l.standingHeightPx/H>=.4&&l.standingHeightPx/H<=.5);assert.ok(fs.existsSync(file(l.contactShadow)))}
  for(const time of ['day','night'])for(const kind of ['empty',spec.posePlacements.find(p=>p.roomId===r.id).id])for(const w of [320,480,1280]){const m=await sharp(file(`previews/${r.id}_${kind}_${time}_${w}.webp`)).metadata();assert.equal(m.width,w);assert.equal(m.height,w*9/16)}
  geometry.push({room:r.id,locations:r.locations.length,transparentGlassPixels:transparent,standingHeightRange:r.locations.map(l=>l.standingHeightPx)});
 }
 assert.equal(spec.displayAreas.length,6);assert.ok(spec.outsideLocations.every(l=>l.roomId===null&&!l.actorInRoom));
 const g3=JSON.parse(fs.readFileSync(file('状态层按房间.json')));assert.equal(g3.rows.length,43);assert.equal(new Set(g3.rows.map(l=>l.sourceId)).size,43);
 for(const l of g3.rows)for(const p of l.candidateFiles)assert.ok(fs.existsSync(file(p)),p);
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1150},deviceScaleFactor:1}),errors=[],failed=[],frames=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push(r.url()));
  await page.goto(url);await page.evaluate(()=>window.reviewReady);
  assert.equal((await page.evaluate(()=>window.reviewState)).selected,'observation');
  const set=async(id,value)=>{await page.selectOption('#'+id,String(value));await page.evaluate(()=>window.reviewReady)};
  // Changing the simulated actual room must leave the selected room unchanged and empty.
  await set('actor','kitchen');let state=await page.evaluate(()=>window.reviewState);assert.equal(state.selected,'observation');assert.equal(state.shown,false);
  await set('actor','outside');state=await page.evaluate(()=>window.reviewState);assert.equal(state.selected,'observation');assert.equal(state.shown,false);
  await page.focus('#size');await page.keyboard.press('4');assert.equal((await page.evaluate(()=>window.reviewState)).selected,'observation');
  await page.focus('#frame');await page.keyboard.press('4');await page.evaluate(()=>window.reviewReady);assert.equal((await page.evaluate(()=>window.reviewState)).selected,'bedroom');
  const lightEffects=[];
  for(const r of spec.rooms){
   await page.locator(`#roomTabs [data-room="${r.id}"]`).click();await page.evaluate(()=>window.reviewReady);
   await set('actor',r.id);
   for(const time of ['day','night']){await set('time',time);for(const size of [320,480,1280]){
     await set('size',size);const rect=await page.locator('#frame').boundingBox();assert.equal(rect.width,size);assert.equal(rect.height,size*9/16);
     const name=`previews/browser_${r.id}_${time}_${size}.png`;await page.locator('#frame').screenshot({path:file(name)});
     frames.push({room:r.id,time,size,width:rect.width,height:rect.height,screenshot:name,actor:(await page.evaluate(()=>window.reviewState)).shown});
   }}
   await set('actor','none');await set('fire','out');
   // Read a single representative receiver instead of transferring a complete canvas.
   const receiver=async()=>page.evaluate(([x,y])=>{const p=document.getElementById('scene').getContext('2d').getImageData(x,y,1,1).data;return Array.from(p)},r.glow.source);
   const off=await receiver();await set('fire','high');const high=await receiver();assert.ok(high[0]>off[0]+8,r.id+' fire receiver not changing');lightEffects.push({room:r.id,off,high});
   await set('fire','mid');
  }
  await page.locator('#roomTabs [data-room="observation"]').click();await page.evaluate(()=>window.reviewReady);await set('size',320);await set('actor','hearth');
  await page.locator('#roomTrigger').focus();await page.locator('#roomTrigger').click();await page.locator('#roomMenu').screenshot({path:file('previews/browser_小平面建议.png')});
  assert.equal(await page.locator('#mini [data-room="hearth"]').getAttribute('data-occupied'),'true');assert.equal((await page.evaluate(()=>window.reviewState)).selected,'observation');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#roomMenu').isHidden(),true);
  assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
  fs.writeFileSync(file('验证结果.json'),JSON.stringify({status:'PASS',browser:'installed Google Chrome, headless',deviceScaleFactor:1,geometry,frames,lightEffects,checks:['默认观测间','换人物房间不跟随；泉屋不冒充灶间','输入控件不劫持数字键；画面聚焦1–4换房','24个真实CSS尺寸画面','逐间熄火与旺火受光实际像素不同','16个地点、6展示位、5窗、43状态组完整归属','窗玻璃真实alpha孔、每站阴影存在','小平面点只报位置；Esc收起'],pageErrors:errors,failedRequests:failed,limitations:['仅候选与Chrome检查；不代表正式G5、真实Snapshot接入或审美通过','未测Safari、Mac原生置顶/焦点、后台及合盖','未复跑内核时间占比；任务单采样只转录']},null,2)+'\n');
  console.log('PASS: 4 rooms / 16 places / 6 display areas / 43 G3 groups / 48 image previews / 24 exact CSS browser frames; no follow, outdoor exclusion, focus, mini-map and firelight checks.');
 }finally{await browser.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1});
