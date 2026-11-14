const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const path=require('node:path'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1150,height:1100}}),errors=[],checks=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8766/设计/原型/04_v1.5_户外按动作走.html');
  await page.waitForFunction(()=>window.outdoorReview);
  const read=()=>page.evaluate(()=>window.outdoorReview.read());
  const time=s=>s.day*1440+s.minute;
  const clickTile=async(x,y)=>{
   const p=await page.evaluate(({x,y})=>{const m=window.outdoorReview.read().snapshot.outing.map,r=document.getElementById('map').getBoundingClientRect(),t=Math.min(600/m.map[0].length,310/m.map.length),ox=(640-t*m.map[0].length)/2,oy=(360-t*m.map.length)/2;return{x:r.left+(ox+(x+.5)*t)*r.width/640,y:r.top+(oy+(y+.5)*t)*r.height/360}},{x,y});
   await page.mouse.click(p.x,p.y);
  };
  await page.click('#depart');await page.click('#enter');
  let a=await read();assert.equal(a.snapshot.outing.areaId,'pineForest');checks.push('真实cmdDepart与travel进入松林');
  await page.waitForTimeout(350);assert.equal(time(await read()),time(a));checks.push('站着不动世界分钟不走');
  await page.focus('#map');await page.keyboard.press('d');let b=await read();assert.equal(time(b)-time(a),2);checks.push('走一格按配置花2分钟');
  for(const panel of ['pack','map','journal']){
   await page.click(`[data-panel="${panel}"]`);const before=await read();
   await page.keyboard.press('d');await page.keyboard.press('e');assert.equal(time(await read()),time(before));
   assert.ok(await page.locator('[data-action="rest"]').isDisabled());assert.ok(await page.locator('[data-action="eat"]').isDisabled());assert.ok(await page.locator('[data-action="fire"]').isDisabled());assert.ok(await page.locator('#home').isDisabled());
   await page.keyboard.press('Escape');assert.equal((await read()).snapshot.outing.panel,null);
  }checks.push('三个面板拒绝方向/采集，禁用生活动作和返家，Esc关闭');
  a=await read();await page.click('[data-action="eat"]');b=await read();assert.equal(time(b)-time(a),10);assert.equal(b.snapshot.outing.rations,a.snapshot.outing.rations-1);checks.push('吃干粮走10分钟并实际扣1份');
  a=await read();await page.click('[data-action="rest"]');b=await read();assert.equal(time(b)-time(a),10);assert.ok(b.snapshot.outing.body.stamina>=a.snapshot.outing.body.stamina);checks.push('歇息走10分钟并恢复体力');
  const fire=b.snapshot.outing.map.fires[0];await clickTile(fire.x,fire.y);a=await read();await page.click('[data-action="fire"]');b=await read();assert.equal(time(b)-time(a),10);assert.ok(b.snapshot.outing.map.fires.some(f=>f.burning));checks.push('走到生火点，生火走10分钟且真实篝火点亮');
  const node=b.snapshot.outing.map.nodes.find(n=>n.available>0);await clickTile(node.x,node.y);b=await read();assert.ok(b.snapshot.outing.map.nodes.find(n=>n.id===node.id).available<node.available);checks.push('点资源自动走到并采集，资源库存实际减少');
  assert.ok(await page.locator('#home').isDisabled());checks.push('不在出口不能返家');
  a=await read();await page.click('#focus');b=await read();assert.equal(b.snapshot.mode,'outdoorFocus');assert.equal(b.snapshot.stage.show,false);
  await page.waitForTimeout(350);assert.equal(time(await read()),time(a));await page.click('#back');b=await read();assert.equal(b.snapshot.mode,'outdoor');assert.equal(time(b),time(a));assert.deepEqual(b.snapshot.outing.map,a.snapshot.outing.map);assert.deepEqual(b.snapshot.outing.bag,a.snapshot.outing.bag);checks.push('临时专注空木屋冻结，返回保留位置、时间、背包');
  await page.screenshot({path:path.join(__dirname,'04_v1.5_浏览器截图.png'),fullPage:true});
  await clickTile(0,4);assert.ok(!(await page.locator('#home').isDisabled()));await page.click('#home');b=await read();assert.equal(b.snapshot.mode,'companion');assert.equal(b.snapshot.outing,null);assert.notEqual(b.snapshot.focus.bar,'focusing');checks.push('走回真实区域出口才返家入库，专注不自动恢复');
  await page.goto('http://127.0.0.1:8766/设计/原型/04-05_窗下书桌_窗口体验原型.html');
  await page.click('#modeOutdoor');await page.waitForFunction(()=>window.outdoorReview);checks.push('旧窗下书桌原型户外入口跳到新试片');
  await page.goto('http://127.0.0.1:8766/设计/原型/04_桌面陪伴_交互演示.html');
  await page.click('#goOutdoor');await page.getByRole('button',{name:'出门，暂停当前专注',exact:true}).click();await page.waitForFunction(()=>window.outdoorReview);checks.push('旧桌面陪伴原型确认出门跳到新试片');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(__dirname,'04_v1.5_验证结果.json'),JSON.stringify({browser:'headless installed Google Chrome',checks,pageErrors:errors,limitations:'不是Safari、原生小窗、完整专注计时或长期运行验证'},null,2)+'\n');
  console.log('PASS '+checks.length+' real-core outdoor browser scenarios');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
