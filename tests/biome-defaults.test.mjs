import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { DEFAULT_BIOMES,biomeTypes,biomeLookup,biomePriority,mergeBiomeConfig,biomeEdits,freezeBiomeTravel } from "../scripts/biomes.mjs";
const shipped=JSON.parse(await fs.readFile(new URL("../data/worlds/toril/biomes.json",import.meta.url)));
const box=[[0,0],[10,0],[10,10],[0,10]];
test("mountain, hill and plain defaults match the GM's supplied values",()=>{
 const m=DEFAULT_BIOMES.mountains,h=DEFAULT_BIOMES.hills,p=DEFAULT_BIOMES.plains;
 assert.deepEqual([m.offroad,m.road,m.trail,m.forage,m.conceal,m.alarm,m.priority],[.2,.7,.3,20,20,12,1]);
 assert.deepEqual([h.offroad,h.road,h.trail,h.forage,h.conceal,h.alarm,h.priority],[.5,.9,.7,15,10,10,2]);
 assert.deepEqual([p.offroad,p.trail,p.priority],[.8,.9,10]);assert.equal(DEFAULT_BIOMES.forest.priority,5);
 for(const d of Object.values(DEFAULT_BIOMES)){assert.ok(d.priority>0);assert.ok(d.offroad<=.8);assert.ok(Number.isFinite(d.forage));}
});
test("lowest priority wins and zero is reserved for custom biome types",()=>{
 const config={types:{lava:{name:"Lava",terrain:4,priority:0}},zones:{p:{type:"plains",pts:box},f:{type:"forest",pts:box},h:{type:"hills",pts:box},m:{type:"mountains",pts:box}}};
 assert.equal(biomeLookup(config)(5,5).zoneId,"m");config.zones.l={type:"lava",pts:box};assert.equal(biomeLookup(config)(5,5).zoneId,"l");
 assert.equal(biomePriority({type:"forest",priority:0},biomeTypes()),5,"old zero defaults inherit the updated type");
});
test("the supplied biome import retains its three named zones and their overrides",()=>{
 const zones=Object.values(shipped.zones);assert.deepEqual(zones.map(z=>z.name),["Neverwinter Wood","Hotenow Mountains","The Crags"]);
 assert.deepEqual(zones.map(z=>z.pts.length),[235,40,164]);assert.equal(zones[0].overrides.forage,10);assert.equal(zones[1].priority,1);assert.equal(zones[2].overrides.alarm,10);
});
test("shipped biome defaults merge with private edits and deleted zones stay deleted",()=>{
 const ids=Object.keys(shipped.zones),changed=structuredClone(shipped);changed.zones[ids[0]].name="My wood";delete changed.zones[ids[1]];
 const own=biomeEdits(shipped,changed);assert.equal(own.zones[ids[1]],null);assert.equal(Object.keys(own.zones).length,2);
 const merged=mergeBiomeConfig(shipped,own);assert.equal(merged.zones[ids[0]].name,"My wood");assert.ok(!merged.zones[ids[1]]);assert.equal(Object.values(shipped.zones)[0].name,"Neverwinter Wood");
 assert.deepEqual(biomeEdits(shipped,shipped),{types:{},zones:{}});
});
test("new journeys freeze resolved defaults while earlier journeys keep their original speeds and priority direction",()=>{
 const current=freezeBiomeTravel({}),old=freezeBiomeTravel({},true);
 assert.equal(current.types.plains.offroad,.8);assert.equal(current.types.mountains.offroad,.2);assert.equal(old.types.plains.offroad,1);assert.equal(old.types.mountains.offroad,1);assert.equal(old.legacyPriority,true);
 const c={zones:{a:{type:"forest",priority:1,pts:box},b:{type:"hills",priority:5,pts:box}}};assert.equal(biomeLookup(c)(1,1).zoneId,"a");assert.equal(biomeLookup(c,undefined,undefined,{legacyPriority:true})(1,1).zoneId,"b");
});
