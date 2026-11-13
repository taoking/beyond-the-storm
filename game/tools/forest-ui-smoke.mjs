// Chrome smoke: actual UI keyboard -> forest resource -> walk back to gate -> return home.
// Run with Vite at http://127.0.0.1:5173. Needs optional dev-only playwright package.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { newGame, cmdDepart, cmdEnterForest } from "../src/core/game.ts";

const output=process.argv[2] ?? "artifacts/forest-browser";
await mkdir(output,{recursive:true});
const g=newGame(20261114);
g.world.weather.today="A";
g.world.actor.place="door";
g.world.actor.asleep=false;
g.world.actor.away=false;
g.world.actor.activity=null;
const depart=cmdDepart(g,Date.now(),{rations:2,bundles:1});
const forest=cmdEnterForest(g);
assert.equal(depart.ok,true);
assert.equal(forest.ok,true);
const saved=JSON.stringify({version:1,savedWall:Date.now(),game:g});
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
await context.addInitScript(({saved}) => {
  if(location.host==="127.0.0.1:5173") localStorage.setItem("bts.save.v1",saved);
},{saved});
const page=await context.newPage();
const errors=[];
page.on("pageerror",e=>errors.push(e.message));
try{
  await page.goto("http://127.0.0.1:5173",{waitUntil:"domcontentloaded"});
  await page.locator(".forest-panel").waitFor({timeout:20000});
  const pre=page.locator(".forest-map");
  assert.match(await pre.innerText(),/@/);
  const initialMap=await pre.innerText();
  await page.screenshot({path:output+"/01-forest-start.png",fullPage:true});
  for(const key of ["ArrowRight","ArrowRight","ArrowUp","ArrowUp","ArrowRight"])
    await page.keyboard.press(key);
  await page.waitForTimeout(500);
  assert.notEqual(await pre.innerText(),initialMap,"Player should actually move on forest map");
  const item=page.locator('[data-cmd="forestGather"]').filter({hasText:"枯枝堆"});
  await item.waitFor();
  assert.equal(await item.isDisabled(),false,"Forest gather button should be active next to resource");
  await item.click();
  await page.waitForTimeout(300);
  assert.match(await page.locator(".forest-panel").innerText(),/柴 ×2/);
  await page.screenshot({path:output+"/02-forest-gather.png",fullPage:true});
  const gameBefore=await page.evaluate(()=>JSON.parse(localStorage.getItem("bts.save.v1")).game);
  assert.equal(gameBefore.world.outing.forest.goods.wood,2);
  for(const key of ["ArrowLeft","ArrowDown","ArrowDown","ArrowLeft","ArrowLeft"])
    await page.keyboard.press(key);
  await page.waitForTimeout(400);
  const home=page.locator('[data-cmd="forestReturn"]');
  assert.equal(await home.isDisabled(),false,"Forest return button only enables at gate");
  await home.click();
  await page.waitForTimeout(300);
  const gameAfter=await page.evaluate(()=>JSON.parse(localStorage.getItem("bts.save.v1")).game);
  assert.equal(gameAfter.mode,"companion");
  assert.equal(gameAfter.world.outing,null);
  assert.equal(gameAfter.world.stock.wood,gameBefore.world.stock.wood+2+gameBefore.world.outing.bundles*3);
  assert.equal(gameAfter.world.actor.outfit,"indoor");
  await page.screenshot({path:output+"/03-return-home.png",fullPage:true});
  assert.deepEqual(errors,[],"No uncaught browser errors");
  console.log(JSON.stringify({passed:true,browser:"Chromium",mapMoved:true,
    collectedWood:2,returnedToCabin:true,realInventoryDelta:5,
    images:["01-forest-start.png","02-forest-gather.png","03-return-home.png"]},null,2));
}finally{
  await browser.close();
}
