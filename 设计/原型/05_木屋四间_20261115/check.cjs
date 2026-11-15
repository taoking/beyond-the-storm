#!/usr/bin/env node
// Legacy 1600×900 prototype remains for layout history, not gameplay coordinates.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const folder=__dirname;
const ref=JSON.parse(fs.readFileSync(path.join(folder,'站位与房间.json'),'utf8'));
assert.equal(ref.deprecated,true);
assert.equal(ref.doNotUseForGameplay,true);
assert.equal(ref.canonicalPath,'assets/05/rooms/g5_20261115/room_locations.json');
const root=path.resolve(folder,'../../..');
const canonical=JSON.parse(fs.readFileSync(path.join(root,ref.canonicalPath),'utf8'));
const ids=['hearth_room','observation_room','kitchen_room','bedroom'];
assert.deepEqual(Object.keys(canonical.rooms),ids);
assert.deepEqual(canonical.canvas,[2560,1440]);
assert.equal(canonical.architecture.defaultSelectedRoom,'observation_room');
assert.equal(canonical.architecture.kitchenBackDoorAndCoveredWalkwaySameOpening,true);
assert.equal(Object.values(canonical.rooms).reduce((n,r)=>n+r.displaySlots.length,0),6);
for(const room of ids){
 const legacyLabels={hearth_room:['炉间_空屋.svg','炉间_读书.svg'],observation_room:['观测间_空屋.svg','观测间_写字.svg'],kitchen_room:['灶间_空屋.svg','灶间_料理.svg'],bedroom:['卧室_空屋.svg','卧室_睡觉.svg']}[room];
 for(const file of legacyLabels)assert(fs.readFileSync(path.join(folder,file),'utf8').trimEnd().endsWith('</svg>'));
}
console.log('PASS: old G2 SVGs intact, single authoritative 2560×1440 room_locations.json');
