const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const url=process.env.REVIEW_URL||'http://127.0.0.1:8765/设计/原型/05_新木屋修订_20261115/';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1050},deviceScaleFactor:1}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>window.reviewReady);
  const report=[];
  for(const size of [320,480,1280])for(const pose of ['sitWrite','sitRead','standWork','sleep'])for(const camera of ['wide','window','hearth']){
   await page.evaluate(async({size,pose,camera})=>{document.getElementById('size').value=size;document.getElementById('pose').value=pose;document.getElementById('camera').value=camera;await window.renderReview()},{size,pose,camera});
   const rect=await page.locator('#view').boundingBox();assert.equal(rect.width,size);assert.equal(rect.height,size*9/16);
   report.push({size,pose,camera,width:rect.width,height:rect.height});
   if((size===320&&pose==='sitWrite'&&camera==='window')||(size===480&&pose==='sitRead'&&camera==='hearth')||(size===1280&&pose==='sleep'&&camera==='wide'))await page.locator('#view').screenshot({path:path.join(root,`previews/browser_${pose}_${size}.png`)});
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(root,'浏览器验证.json'),JSON.stringify({browser:'headless installed Google Chrome',deviceScaleFactor:1,frames:report,pageErrors:errors,limitations:'未测Safari、原生Mac小窗或长期运行'},null,2)+'\n');
  console.log('PASS 36 browser frames at exact 320×180 / 480×270 / 1280×720; no page errors.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
