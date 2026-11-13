/**
 * 05/G2 cross-check against REAL 06 v0.2 present(): Snapshot, not a mock.
 * Node 22+: node --experimental-strip-types 设计/原型/05_v1.0_06真实快照冒烟.mjs
 * No game source modifications. This is a read-only renderer integration check.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { newGame } from "../../game/src/core/game.ts";
import { fixedCalendar } from "../../game/src/core/focus.ts";
import { stepMinute } from "../../game/src/core/sim.ts";
import { present } from "../../game/src/core/view.ts";

const here = dirname(fileURLToPath(import.meta.url));
const sandbox = {};
runInNewContext(readFileSync(join(here, "05_v1.0_G2只读视觉适配器.js"), "utf8"), sandbox);
const adapt = sandbox.BeyondStormG2Art.makeFrame;
const wall = 1790000000000;
const cal = fixedCalendar(480);
let total = 0, rendered = 0, empty = 0;
const g = newGame(20261113);
const actual = () => present(g, wall, cal);
const source = actual();
assert.equal(typeof source.stage.show, "boolean");
assert.ok(["out","ember","low","mid","high"].includes(source.fire.look));

for (let minute = 0; minute < 1440; minute++) {
  // Step the actual deterministic world one game minute (only the sim owns it).
  stepMinute(g.world);
  const snap = actual();
  const before = JSON.stringify(g);
  for (const cam of ["window","hearth","wide"]) {
    const frame = adapt(snap, cam);
    assert.equal(frame.fire.look, snap.fire.look);
    assert.equal(frame.jar.stagedCones, snap.jar.cones);
    assert.equal(frame.jar.pendingButNotDrawn, snap.jar.pending);
    assert.equal(frame.mode, snap.mode);
    assert.equal(typeof frame.actor.rendered, "boolean");
    if (frame.actor.rendered) rendered++; else empty++;
    total++;
  }
  assert.equal(JSON.stringify(g), before, "Adapter must not change 06 game state");
}

// In ambience, 06's present() has not yet added a distinct projected look;
// the visual layer must never fake it by displaying actual weather.
g.mode = "ambience";
g.ambience = {season:"winter",weather:"A",time:"night"};
const a = adapt(actual(), "hearth");
assert.equal(a.worldFrozen, true);
assert.equal(a.weather.source, "projection_missing");
assert.equal(a.weather.weather, null);

// Outdoor temporary-focus cabin scene is genuinely empty (no ghost sprite).
g.mode = "outdoorFocus";
const b = adapt(actual(), "wide");
assert.equal(b.actor.rendered, false);
assert.equal(b.worldFrozen, true);

console.log(JSON.stringify({test:"real 06 present() -> 05 visual adapter",
  seed:20261113,worldMinutes:1440,visualFrames:total,rendered,empty,
  noWorldMutations:true,ambienceHonest:true,outdoorFocusEmpty:true},null,2));
