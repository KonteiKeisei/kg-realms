import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BIOMES,biomeTypes,biomeLookup,biomeFlag,syncPartyBiome,onlyBiomeFlagChanged } from "../scripts/biomes.mjs";
import { TERRAIN,speedFactor,buildGraph,itinerary,encounterHours,replayTrip } from "../scripts/travel.mjs";
import { riverHazardHours,hazardDefaults,hazardVisible } from "../scripts/river-hazards.mjs";
import { TravelHud } from "../scripts/ui-hud.mjs";
import { sourceToLonLat } from "../scripts/source-map.mjs";
import { makeFrame,latLonToScene } from "../scripts/geo.mjs";
import { SOURCE_MAP } from "../scripts/source-map.mjs";
import { gmGame,testScene } from "./helpers/journey.mjs";
import { RealmLayer } from "../scripts/realm-layer.mjs";
import { registerKinds } from "../scripts/card-kinds.mjs";
import { heldEncounterId } from "../scripts/ui-encounter-box.mjs";
const box=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];

test("all nine defaults exist and unzoned terrain infers the biome without actor assignment",()=>{
  assert.deepEqual(Object.keys(DEFAULT_BIOMES),["plains","forest","desert","tundra","taiga","hills","wetlands","mountains","glacier","arctic","jungle","swamp","savanna","steppe","badlands","coast","volcanic"]);
  for(const [code,type] of [[1,"plains"],[2,"forest"],[4,"mountains"],[5,"wetlands"],[7,"glacier"]])assert.equal(biomeLookup({},()=>TERRAIN[code])(5,5).type,type);
  assert.equal(biomeLookup({},()=>TERRAIN[8])(5,5),null);
});
test("named forest zones inherit defaults and override only their own section",()=>{
  const q=biomeLookup({types:{forest:{forage:17}},zones:{nw:{name:"Neverwinter Wood",type:"forest",pts:box(0,0,20,20),overrides:{forage:23,offroad:.8}},other:{name:"Other Wood",type:"forest",pts:box(40,0,60,20)}}});
  assert.equal(q(10,10).forage,23);assert.equal(q(50,10).forage,17);assert.equal(q(10,10).alarm,12);assert.equal(q(50,10).offroad,.4);
  assert.equal(q(30,10).type,"plains");assert.equal(q(10,10).name,"Neverwinter Wood");
});
test("custom biome types and custom zones retain usable macro identifiers",()=>{
  const config={types:{ash:{name:"Ash wastes",terrain:6,forage:30,offroad:.6}},zones:{a:{type:"ash",pts:box(0,0,5,5)}}};
  const flag=biomeFlag(biomeLookup(config)(1,1),{world:"toril",scene:"map"});
  assert.equal(flag.type,"ash");assert.equal(flag.zoneId,"a");assert.equal(flag.dc.forage,30);assert.equal(flag.travel.offroad,.6);assert.equal(flag.world,"toril");
});
test("overlap uses priority, then smallest area, with inclusive zone edges and no stacking",()=>{
  const config={zones:{large:{type:"forest",pts:box(0,0,100,100),overrides:{offroad:.5}},small:{type:"taiga",priority:5,pts:box(5,5,10,10),overrides:{offroad:.8}}}};
  let q=biomeLookup(config);assert.equal(q(5,5).zoneId,"small");assert.equal(q(6,6).offroad,.8);
  config.zones.large.priority=1;q=biomeLookup(config);assert.equal(q(6,6).zoneId,"large");
});
test("zones never turn ocean into land, and invalid polygons do not affect lookup",()=>{
  const c={zones:{land:{type:"desert",pts:box(0,0,10,10)},bad:{type:"forest",pts:[[0,0],[1,1],[2,2]],priority:10}}};
  assert.equal(biomeLookup(c,()=>TERRAIN[8])(2,2),null);assert.equal(biomeLookup(c)(2,2).type,"desert");
});
test("biome speed multipliers apply once over the edition's terrain rules",()=>{
  const q=biomeLookup({zones:{forest:{type:"forest",pts:box(0,0,10,10),overrides:{offroad:.8,road:.9}}}}),T=q.terrain(5,5);
  assert.equal(speedFactor("offroad",T),.4);assert.equal(speedFactor("road",T),.9);assert.equal(speedFactor("trail",T),.6);
  assert.equal(speedFactor("offroad",T,{rules:"2024",pace:"normal"}),.8);
});
test("journey routing uses biome modifiers while flight ignores ground biomes",()=>{
  const q=biomeLookup({zones:{forest:{type:"forest",pts:box(-10,-10,200,10)}}}),graph=buildGraph([],p=>p);
  const opts={milesPerPixel:1,mode:"direct",terrainAt:q.terrain,legs:[{method:{key:"foot",baseMph:3}}]};
  const foot=itinerary(graph,[[0,0],[30,0]],opts);assert.ok(Math.abs(foot.hours-50)<1e-8);
  const flight=itinerary(graph,[[0,0],[30,0]],{...opts,legs:[{method:{key:"flying",mph:6}}]});assert.equal(flight.hours,5);
});
test("ten party members update on biome transitions, not on unchanged movement ticks",async()=>{
  let writes=0;const events=[];globalThis.Hooks={callAll:(...x)=>events.push(x)};
  const actors=Array.from({length:10},(_,i)=>({id:String(i),flags:{},getFlag(){return this.flags.biome;},async update(p){writes++;this.flags.biome=p["flags.kg-realms.biome"];}}));
  const q=biomeLookup({zones:{a:{type:"forest",pts:box(0,0,10,10)}}});
  for(let x=1;x<9;x++)await syncPartyBiome(actors,biomeFlag(q(x,2),{world:"toril",scene:"map"}));
  assert.equal(writes,10);assert.equal(events.length,10);
  await syncPartyBiome(actors,biomeFlag(q(20,2),{world:"toril",scene:"map"}));assert.equal(writes,20);assert.equal(actors[0].flags.biome.type,"plains");
  await syncPartyBiome(actors,null);assert.equal(writes,30);assert.equal(actors[0].flags.biome,null);
});
test("world actors use a single batch and invalidated scene work cannot update flags",async()=>{
  let calls=0;globalThis.Actor={updateDocuments:async docs=>{calls++;assert.equal(docs.length,10);}};
  const actors=Array.from({length:10},(_,i)=>({id:String(i)})),value=biomeFlag(biomeLookup()(0,0));
  await syncPartyBiome(actors,value,()=>false);assert.equal(calls,0);await syncPartyBiome(actors,value);assert.equal(calls,1);delete globalThis.Actor;
});

const riverTrack=()=>[{at:[0,0],hour:0,kind:"river",waterway:"r"},{at:[10,0],hour:2,kind:"river",waterway:"r"},{at:[20,0],hour:4,kind:"river",waterway:"r"}];
test("rapids and waterfalls start permanent, hidden and automatically discoverable",()=>{
  for(const kind of ["rapids","waterfall"]){const e=hazardDefaults(kind);assert.equal(e.permanent,true);assert.equal(e.visibility,"hidden");assert.equal(e.autoDiscover,true);assert.equal(hazardVisible(e),false);assert.equal(hazardVisible({...e,visibility:"discovered"}),true);}
});
test("river hazards stop river travel at the projected point, not nearby roads or the wrong river",()=>{
  const e={id:"fall",...hazardDefaults("waterfall"),at:[5,0],radius:1,river:"r"};
  const events=encounterHours(riverTrack(),[e]);assert.equal(events.length,1);assert.equal(events[0].hour,1);assert.equal(events[0].sourceId,"fall");
  assert.equal(encounterHours(riverTrack().map(p=>({...p,kind:"road"})),[e]).length,0);
  assert.equal(encounterHours(riverTrack(),[{...e,river:"other"}]).length,0);
  const p=replayTrip({departed:0,decisions:[],resumed:{}},{hours:4,encounters:events},7200);assert.equal(p.status,"encounter");assert.equal(p.encounter.kind,"hazard");
});
test("return trips encounter a permanent hazard again with a separate resolution id",()=>{
  const track=[...riverTrack(),{at:[20,20],hour:6,kind:"road"},{at:[20,0],hour:8,kind:"river",waterway:"r"},{at:[0,0],hour:12,kind:"river",waterway:"r"}];
  const found=riverHazardHours(track,{id:"rapids",kind:"rapids",at:[5,0],radius:1,river:"r"});
  assert.equal(found.length,2);assert.notEqual(found[0].id,found[1].id);assert.equal(found[0].sourceId,found[1].sourceId);
});
test("the HUD infers actor biome from the party's live map position without a journey",async()=>{
  gmGame();const scene=testScene({}),a=sourceToLonLat(10,10),b=sourceToLonLat(20,20),state={types:{},zones:{z:{name:"Cold Wood",type:"taiga",pts:[[a[0],a[1]],[b[0],a[1]],[b[0],b[1]],[a[0],b[1]]]}}};
  const actor={id:"pc",biome:null,getFlag(){return this.biome;},async update(p){this.biome=p["flags.kg-realms.biome"];}};
  const frame=makeFrame(SOURCE_MAP.bounds,{x:0,y:0,width:10000,height:10000});
  const hud=new TravelHud({getScene:()=>scene,getLayer:()=>({frame}),getPlaces:()=>[],getBiomes:()=>state,getWorld:()=>"toril",getTerrain:async()=>null});hud.members=()=>[actor];
  hud.partyTokens=()=>[];await hud.syncBiome();assert.equal(actor.biome,null,"no token does not erase another map's biome");
  const ll=sourceToLonLat(15,15),token={center:latLonToScene(frame,ll[1],ll[0])};hud.partyTokens=()=>[token];
  await hud.syncBiome();assert.equal(actor.biome.type,"taiga");
  const outside=sourceToLonLat(100,15);token.center=latLonToScene(frame,outside[1],outside[0]);await hud.syncBiome();assert.equal(actor.biome.type,"plains");
  // A moving journey uses the same source-position lookup; the flag is never selected by hand.
  hud.plan={hours:10,encounters:[]};hud.result={track:[{at:[15,15],hour:0},{at:[100,15],hour:10}]};scene.getFlag=()=>({trip:{departed:0}});game.time.worldTime=0;
  await hud.syncBiome();assert.equal(actor.biome.type,"taiga");assert.equal(actor.biome.name,"Cold Wood");
  game.time.worldTime=3600;await hud.syncBiome();assert.equal(actor.biome.type,"plains");
});

test("reaching a river hazard discovers its permanent world record once and cards resolve to that record",async()=>{
  gmGame();globalThis.foundry={utils:{escapeHTML:String,deepClone:structuredClone}};
  const state={trip:{departed:0,resumed:{},decisions:[],halts:[]}},scene=testScene(state);globalThis.canvas={scene,tokens:{placeables:[]}};
  const e={id:"fall",...hazardDefaults("waterfall"),at:[5,0],radius:1,river:"r"},events=encounterHours(riverTrack(),[e]);let discovers=0,opened;
  const hud=new TravelHud({headless:true,getScene:()=>scene,getLayer:()=>null,getPlaces:()=>[],getEncounters:()=>[e],discoverHazard:async id=>{assert.equal(id,"fall");discovers++;e.visibility="discovered";events[0].visibility="discovered";},openEncounter:(id)=>opened=id});
  hud.members=()=>[];hud.result={track:riverTrack(),hours:4};hud.plan={hours:4,encounters:events};game.time.worldTime=2*3600;
  const {progressKey}=await import("../scripts/journey-state.mjs");hud.asked.add(progressKey(hud.state,hud.progress()));
  await hud.tick();await hud.tick();assert.equal(discovers,1);assert.equal(e.permanent,true);assert.equal(hazardVisible(e),true);
  await hud.showEncounterCard(events[0].id);assert.equal(opened,"fall");
  events[0].visibility="hidden";events[0].autoDiscover=false;await hud.tick();assert.equal(discovers,1);
});

test("invalid imported defaults cannot create NaN speeds or replace a default type's name",()=>{
  const types=biomeTypes({types:{forest:{offroad:"no",forage:99},bad:{terrain:8,trail:0,color:"bad"}}});
  assert.equal(types.forest.name,"Forest");assert.equal(types.forest.offroad,.4);assert.equal(types.forest.forage,40);
  assert.equal(types.bad.terrain,1);assert.equal(types.bad.trail,.1);assert.equal(types.bad.color,DEFAULT_BIOMES.plains.color);
  assert.equal(biomeLookup({zones:{a:{type:"forest",pts:box(0,0,3,3),overrides:null}}})(1,1).offroad,.4);
});

test("biome-only actor updates skip general HUD refresh while real movement changes still refresh",()=>{
  const b=biomeFlag(biomeLookup()(1,1));
  assert.equal(onlyBiomeFlagChanged({"flags.kg-realms.biome":b}),true);
  assert.equal(onlyBiomeFlagChanged({flags:{"kg-realms":{biome:b}}}),true);
  assert.equal(onlyBiomeFlagChanged({flags:{"kg-realms":{biome:null}}}),true);
  assert.equal(onlyBiomeFlagChanged({flags:{"kg-realms":{biome:b}},system:{attributes:{movement:{walk:20}}}}),false);
  assert.equal(onlyBiomeFlagChanged({flags:{"kg-realms":{biome:b,other:true}}}),false);
  assert.equal(onlyBiomeFlagChanged({}),false);
});

test("the map overlay closes polygon rings, reflects selection and clears when the editor closes",()=>{
  const sources=new Map(),layers=[],map={style:{_loaded:true},getSource:id=>sources.get(id),addSource:(id)=>sources.set(id,{setData(data){this.data=data;}}),addLayer:l=>layers.push(l)};
  const layer=new RealmLayer();layer.ready=true;layer.map=map;
  layer.setBiomes([{id:"wood",name:"Wood",color:"#438253",pts:box(0,0,5,5)}],"wood");
  assert.equal(layers.length,3);const f=sources.get("biome-zones").data.features[0];assert.equal(f.properties.selected,true);assert.deepEqual(f.geometry.coordinates[0][0],f.geometry.coordinates[0].at(-1));
  layer.setBiomes(null);assert.equal(sources.get("biome-zones").data.features.length,0);assert.equal(layers.length,3);
  layer.setEncounters({h:{kind:"rapids",name:"Rapids",lon:1,lat:2}});assert.equal(layer.hasRiverHazards,true);
  layer.setEncounters({});assert.equal(layer.hasRiverHazards,false);
});

test("discovered river hazard cards are readable to players while ordinary encounters remain hidden",()=>{
  gmGame();game.user.isGM=false;game.scenes=new Map();globalThis.foundry={utils:{escapeHTML:String}};
  const kinds=new Map(),records={h:{kind:"rapids",name:"Rapids",visibility:"discovered",dc:17},e:{name:"Secret encounter"}};
  registerKinds({register:(id,kind)=>kinds.set(id,kind)},{encounters:()=>records});
  const kind=kinds.get("encounter"),h=kind.get({world:"toril",id:"h"});
  assert.equal(h.visibility,"discovered");assert.equal(h.type,"Hazard");assert.deepEqual(h.rows,[["Hazard","Rapids"]]);
  records.h.visibility="hidden";assert.equal(kind.get({world:"toril",id:"h"}).visibility,"hidden");
  assert.equal(kind.get({world:"toril",id:"e"}).visibility,"hidden");
});

test("a hazard's linked encounter scene resumes the current passage rather than its permanent record",()=>{
  const state={now:{status:"encounter",encounter:{id:"fall:river:2",sourceId:"fall"}}};
  assert.equal(heldEncounterId(state,"fall"),"fall:river:2");assert.equal(heldEncounterId(state,"other"),null);
  state.now.status="moving";assert.equal(heldEncounterId(state,"fall"),null);
  state.now={status:"encounter",encounter:{id:"ordinary"}};assert.equal(heldEncounterId(state,"ordinary"),"ordinary");
});

test("editing biome travel settings cannot rewind active travel, including after a reload",async()=>{
  gmGame();globalThis.foundry={utils:{escapeHTML:String,deepClone:structuredClone}};
  const a=sourceToLonLat(1000,1000),b=sourceToLonLat(2200,1000),config={types:{plains:{offroad:1}},zones:{}};
  const state={start:{lon:a[0],lat:a[1]},waypoints:[{lon:b[0],lat:b[1]}],trip:{departed:0,decisions:[],resumed:{},halts:[]}},scene=testScene(state);
  const make=()=>{const hud=new TravelHud({headless:true,getScene:()=>scene,getRoutes:()=>({features:[]}),getTerrain:async()=>null,getPlaces:()=>[],getEncounters:()=>[],getWaterways:()=>({}),getBiomes:()=>config});hud.members=()=>[];hud.tick=async()=>{};return hud;};
  const hud=make();game.time.worldTime=4*3600;await hud.refresh();
  const before=hud.currentBiome(),hours=hud.result.hours,point=hud.result.track.find(p=>p.hour>=4).at;
  assert.equal(before.travel.offroad,1);config.types.plains.offroad=.5;await hud.refresh();
  assert.equal(hud.result.hours,hours);assert.deepEqual(hud.result.track.find(p=>p.hour>=4).at,point);assert.equal(hud.currentBiome().travel.offroad,.5);
  const reload=make();await reload.refresh();assert.equal(reload.result.hours,hours);
  state.trip=null;state.waypoints=[{lon:a[0],lat:a[1]},{lon:b[0],lat:b[1]}];reload.getLayer=()=>null;await reload.refresh();assert.equal(reload.result.hours,hours*2,"new journey plans use the updated speed");
});
