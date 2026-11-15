#!/usr/bin/env node
// Four-room G2 candidate integrity check. No external dependencies.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const here = __dirname;
const j = (name) => JSON.parse(fs.readFileSync(path.join(here, name), "utf8"));
const manifest = j("站位与房间.json");
const G4 = JSON.parse(fs.readFileSync(path.join(here, "..", "05_G4_高清插画生产规格.json"), "utf8"));
const ids = ["hearth_room", "observation_room", "kitchen_room", "bedroom"];
assert.equal(Object.keys(manifest.rooms).length, 4, "must have exactly four rooms");
assert.deepEqual(Object.keys(manifest.rooms), ids, "room ids must match G4");
assert.deepEqual(G4.cameras.map((r) => r.id), ids, "G4 room cameras differ");
assert.deepEqual(G4.characters.variants, ["male"], "only male variant is approved");
assert.deepEqual([manifest.canvas.width, manifest.canvas.height], [1600, 900]);
assert.deepEqual(manifest.screenValidationSizes, [[320,180],[480,270],[1280,720]]);
assert.equal(Object.keys(manifest.locations).length, 17);
assert.equal(manifest.architecture.centralRoom, "hearth_room");
let displays = 0;
let maxWindowWidth = 0;
for (const id of ids) {
  const room = manifest.rooms[id];
  const win = room.windows[0].rect;
  assert(win.width >= 600 && win.height >= 300, id + " lost its large-window proposal");
  maxWindowWidth = Math.max(maxWindowWidth, win.width);
  displays += room.displaySlots.length;
  for (const file of [room.sceneEmpty, room.scenePosed]) {
    const src = fs.readFileSync(path.join(here, file), "utf8");
    assert(src.startsWith("<svg ") && src.trimEnd().endsWith("</svg>"), file);
    assert(src.includes('width="1600" height="900"'), file);
  }
  const roomsPlaces = Object.entries(manifest.locations).filter(([_, p]) => p.room === id);
  assert(roomsPlaces.length > 0, id + " needs locations");
  for (const [name, p] of roomsPlaces) {
    assert.equal(p.standingHeightPx, Math.round(113+p.footAnchor[1]*0.37), name + " perspective slope");
    assert(p.footAnchor[0] >= 0 && p.footAnchor[0] <= 1600, name + " foot X");
    assert(p.footAnchor[1] >= 0 && p.footAnchor[1] <= 900, name + " foot Y");
  }
}
assert.equal(manifest.rooms.observation_room.windows[0].rect.width, 818);
assert.equal(maxWindowWidth, 863, "bedroom window may be wider in pixels while observation remains narrative focus");
assert.equal(displays, 6, "all six 03 display slots must stay empty");
assert.deepEqual(manifest.characterPosePreviews.map(x=>x.pose), ["sitRead","sitWrite","standWork","sleep"]);
assert(fs.existsSync(path.join(here, "房间平面示意.svg")));
assert(fs.existsSync(path.join(here, "四间对照.html")));
console.log("PASS: 4 room scenes, 4 pose previews, 17 anchors, 6 displays, 4 large windows, G4 male-only room contract");
