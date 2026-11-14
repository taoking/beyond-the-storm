/* 05 v1.0 G2 visual adapter contract tests: node 设计/原型/05_v1.0_G2只读视觉适配器.test.cjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const code = fs.readFileSync(path.join(__dirname, "05_v1.0_G2只读视觉适配器.js"), "utf8");
const context = {};
vm.runInNewContext(code, context);
const adapt = context.BeyondStormG2Art.makeFrame;
const fixture = () => ({
  mode: "companion", frozen: false,
  world: { dayLabel: "冬 · 第 12 天", look: "大雪", dayPart: "傍晚" },
  actor: { label: "正在写字", place: "desk", outfit: "indoor", whereabouts: "正在写字（书桌）", visible: {window:false,hearth:false} },
  stage: { show: true, place: "desk", label: "正在写字", illusion: false, visible: {wideIndoor:true,window:true,hearth:false} },
  look: {source:"world",weather:"C",weatherLabel:"大雪",weatherKey:"snow",season:"winter",dayPart:"傍晚",dayPartKey:"afternoon",time:"night"},
  fire: {look:"mid",burn:60,ember:30},
  jar: {cones:3,pending:9},
  today: { top: [{id:1,text:"清晨提水",minute:310,weight:1}], more: [] },
  focus: {bar:"focusing",text:"25:00",summaryText:""}
});
let passed = 0;
function check(name, fn) { fn(); console.log("✓ " + name); passed++; }
check("stage.visible=true draws desk despite actual actor.visible=false", () => {
 const f = adapt(fixture(),"window");assert.equal(f.actor.rendered,true);
 assert.equal(f.actor.stagePlace,"desk");assert.equal(f.diagnostics.snapshotActorVisibleNotUsed,true);
});
check("desk absent from hearth crop and no misleading sprite", () => {
 const f=adapt(fixture(),"hearth");assert.equal(f.actor.rendered,false);assert.equal(f.actor.pose,null);
});
check("the adapter does not mutate 06 world snapshot", () => {
 const s=fixture(),before=JSON.stringify(s);adapt(s,"window");assert.equal(JSON.stringify(s),before);
});
check("missing pose stays pending without inferring from Chinese label", () => {
 const f=adapt(fixture(),"window");assert.equal(f.actor.pose,null);assert.equal(f.actor.posePending,true);
});
check("G2 pose and prop pass through if present", () => {
 const s=fixture();s.stage.pose="sitWrite";s.stage.prop="journal";
 const f=adapt(s,"window");assert.equal(f.actor.pose,"sitWrite");assert.equal(f.actor.prop,"journal");
});
check("outdoor focus freezes with empty cabin even if real actor remains desk", () => {
 const s=fixture();s.mode="outdoorFocus";s.frozen=true;s.stage.show=false;s.stage.place=null;
 const f=adapt(s,"window");assert.equal(f.actor.rendered,false);assert.equal(f.worldFrozen,true);
});
check("outdoor true state never teleports wild actor to cabin", () => {
 const s=fixture();s.mode="outdoor";s.stage.place="wild";s.actor.place="wild";s.stage.visible={wideIndoor:false,window:false,hearth:false};
 assert.equal(adapt(s,"wide").actor.rendered,false);
});
check("ambience stage can appear by hearth independently of real actor.place", () => {
 const s=fixture();s.mode="ambience";s.frozen=true;s.stage={show:true,place:"armchair",illusion:true,label:"",visible:{wideIndoor:true,window:false,hearth:true}};
 assert.equal(adapt(s,"hearth").actor.rendered,true);
 assert.equal(adapt(s,"window").actor.rendered,false);
});
check("ambience without look projection NEVER silently paints real weather as chosen", () => {
 const s=fixture();s.mode="ambience";s.stage.illusion=true;delete s.look;
 const f=adapt(s,"window");assert.equal(f.weather.source,"projection_missing");
 assert.equal(f.weather.weather,null);assert.equal(f.diagnostics.missingAmbienceProjection,true);
});
check("ambience uses separately provided readonly look when available", () => {
 const s=fixture();s.mode="ambience";s.look={source:"ambience",weather:"晴",season:"autumn",dayPart:"黄昏",dayPartKey:"dusk",time:"dusk"};
 assert.equal(adapt(s,"window").weather.weather,"晴");
});
check("ambience renderer takes the staged outfit instead of the real actor's winter coat", () => {
 const s=fixture();s.mode="ambience";s.actor.outfit="outdoor";s.actor.place="gate";
 s.stage={show:true,place:"armchair",illusion:true,label:"在炉边坐着",outfit:"indoor",pose:"sit",prop:null,visible:{wideIndoor:true,window:false,hearth:true}};
 const f=adapt(s,"hearth");assert.equal(f.actor.rendered,true);assert.equal(f.actor.outfit,"indoor");
 assert.equal(s.actor.outfit,"outdoor");
});
check("stable G2 weather sprite key passes through without Chinese parsing", () => {
 const s=fixture();s.look={source:"world",weatherLabel:"暴风雪",weather:"D",
   weatherKey:"blizzard",season:"winter",dayPart:"夜"};
 const f=adapt(s,"window");
 assert.equal(f.weather.weatherKey,"blizzard");assert.equal(f.weather.weather,"暴风雪");
});
check("fire out means zero flame AND zero fire glow", () => {
 const s=fixture();s.fire.look="out";const f=adapt(s,"wide");
 assert.equal(f.fire.drawFlame,false);assert.equal(f.fire.drawGlow,false);
});
check("fire respects five states exactly", () => {
 for(const look of ["out","ember","low","mid","high"]){const s=fixture();s.fire.look=look;assert.equal(adapt(s,"wide").fire.look,look)}
});
check("jar draws staged cones, not pending focus shares", () => {
 const f=adapt(fixture(),"window");assert.equal(f.jar.stagedCones,3);
 assert.equal(f.jar.pendingButNotDrawn,9);
});
check("today card displays only real events", () => {
 const s=fixture();s.today.top=[];const f=adapt(s,"window");assert.equal(f.today.events.length,0);
});
check("round summary never invents a reward", () => {
 const s=fixture();s.focus.summaryText="这一轮 25 分钟";
 assert.equal(adapt(s,"window").focus.lastRoundSummary,"这一轮 25 分钟");
});
check("invalid camera is rejected", () => assert.throws(()=>adapt(fixture(),"unknown"),{name:"RangeError"}));
check("stage.visible=false hides an anchor inside the crop", () => {
 const s=fixture();s.stage.visible.window=false;assert.equal(adapt(s,"window").actor.rendered,false);
});
check("stage.visible=true remains authoritative beyond placeholder crop", () => {
 const s=fixture();s.stage.visible.hearth=true;assert.equal(adapt(s,"hearth").actor.rendered,true);
});
check("missing stage.visible fails closed rather than guessing from coordinates", () => {
 const s=fixture();delete s.stage.visible;assert.equal(adapt(s,"window").actor.rendered,false);
});
check("stage.show=false suppresses even a stale true camera membership", () => {
 const s=fixture();s.stage.show=false;assert.equal(adapt(s,"window").actor.rendered,false);
});
check("lighting time and seven-part routine key stay distinct in winter", () => {
 const f=adapt(fixture(),"window");assert.equal(f.weather.time,"night");assert.equal(f.weather.dayPartKey,"afternoon");
});
check("outdoor focus may project world weather with an empty cabin", () => {
 const s=fixture();s.mode="outdoorFocus";s.stage.show=false;
 const f=adapt(s,"wide");assert.equal(f.weather.source,"real_world");assert.equal(f.weather.weather,"大雪");assert.equal(f.actor.rendered,false);
});
check("invalid look source fails closed without real-weather fallback", () => {
 const s=fixture();s.mode="ambience";s.look.source="invalid";
 assert.equal(adapt(s,"window").weather.weather,null);
});
check("art wide explicitly maps to the core wideIndoor camera", () => {
 const f=adapt(fixture(),"wide");assert.equal(f.actor.rendered,true);assert.equal(f.diagnostics.cameraProjectionKey,"wideIndoor");
});
console.log(passed + " art adapter checks passed");
