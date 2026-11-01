import { test } from "node:test";
import assert from "node:assert/strict";
import { partyFavoredBiomes, favoredBiomeMultiplier } from "../scripts/favored-terrain.mjs";
import { biomeTypes, freezeBiomeTravel } from "../scripts/biomes.mjs";
import { TravelHud } from "../scripts/ui-hud.mjs";
import { retimeWalking } from "../scripts/walking-timing.mjs";
import { pointAtHour, itinerary, buildGraph, TERRAIN } from "../scripts/travel.mjs";
import { sourceToLonLat } from "../scripts/source-map.mjs";
import { gmGame, testScene } from "./helpers/journey.mjs";
const H=3600, types=biomeTypes(), feature=(name,description="")=>({type:"feat",name,system:{description:{value:description}}});
const ranger=(...feats)=>({name:"Ranger",type:"character",items:[{type:"class",name:"Ranger",system:{identifier:"ranger",levels:1}},...feats],system:{attributes:{movement:{walk:30}}}});
const terrains=(actor,t=types)=>partyFavoredBiomes([actor],t);
const near=(a,b)=>assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-7,`${a} differs from ${b}`);

test("ranger feature names, formatted descriptions and chosen lists identify selected terrain",()=>{
 assert.deepEqual(terrains(ranger(feature("Natural Explorer (Forest)"))),["forest"]);
 assert.deepEqual(terrains(ranger(feature("Favoured Terrain: Mountain"))),["mountains"]);
 assert.deepEqual(terrains(ranger(feature("Favored Terrain","<p><strong>Favored terrain</strong>: Forest</p>"))),["forest"]);
 assert.deepEqual(terrains(ranger(feature("Natural Explorer","<p>Favored terrains:</p><ul><li>Forest</li><li>Hills</li></ul>"))),["forest","hills"]);
 assert.deepEqual(terrains(ranger(feature("Natural Explorer","You have chosen forest as your favored terrain."))),["forest"]);
 assert.deepEqual(terrains(ranger(feature("Favored Terrain","Forest, Mountains"))),["forest","mountains"]);
});
test("generic choice lists, other classes, enemies, and substring names do not grant travel benefits",()=>{
 const rules="<p>Choose one type of favored terrain: arctic, coast, desert, forest, grassland, mountain, or swamp.</p><p>While traveling in your favored terrain, difficult terrain does not slow your group.</p>";
 assert.deepEqual(terrains(ranger(feature("Natural Explorer",rules))),[]);
 assert.deepEqual(terrains({items:[feature("Favored Terrain: Forest")]}),[]);
 assert.deepEqual(terrains(ranger(feature("Favored Enemy: Forest creatures"))),[]);
 assert.deepEqual(terrains(ranger(feature("Favored Terrain: Rainforest"))),[]);
});
test("ordinary synonyms and custom biome names work without stacking several rangers",()=>{
 const t=biomeTypes({types:{ash:{name:"Ash wastes",terrain:6}}});
 assert.deepEqual(terrains(ranger(feature("Favored Terrain: Swamp, Grassland, Arctic, Ash Wastes")),t),["ash","glacier","plains","tundra","wetlands"]);
 assert.deepEqual(partyFavoredBiomes([ranger(feature("Favored Terrain: Forest")),ranger(feature("Favored Terrain: Forest"))],t),["forest"]);
 const a=ranger(feature("Favored Terrain: Forest"));assert.deepEqual(terrains(a),["forest"]);
 a.items[1].name="Favored Terrain: Desert";assert.deepEqual(terrains(a),["desert"],"item cache follows edits");
 a.items.pop();assert.deepEqual(terrains(a),[]);
});
test("only the lost fraction of a matching biome speed is halved",()=>{
 assert.equal(favoredBiomeMultiplier(.6,"forest",["forest"]),.8);
 assert.equal(favoredBiomeMultiplier(.04,"forest",["forest"]),.52);
 assert.equal(favoredBiomeMultiplier(.2,"forest",["forest"]),.6);
 assert.equal(favoredBiomeMultiplier(1,"forest",["forest"]),1);
 assert.equal(favoredBiomeMultiplier(1.5,"forest",["forest"]),1.5);
 assert.equal(favoredBiomeMultiplier(.6,"forest",["desert"]),.6);
});
test("matching terrain changes route time while other biomes, ships and flight retain their speeds",()=>{
 const graph=buildGraph([],p=>p),biome={type:"forest",offroad:.6,road:.8,trail:.4};
 const terrainAt=()=>({...TERRAIN[1],biome}),opts={mode:"direct",milesPerPixel:1,terrainAt};
 for(const method of ["foot","mounted","flying"]){
  const raw=itinerary(graph,[[0,0],[36,0]],{...opts,legs:[{method:{key:method,baseMph:3,mph:6}}]});
  const changed=retimeWalking(raw,{baseFeet:30,favored:["forest"],changes:[]},{terrainAt});
  assert.ok(Math.abs(changed.hours-raw.hours*(method==="flying"?1:.75))<1e-7);
  assert.equal(retimeWalking(raw,{baseFeet:30,favored:["desert"],changes:[]},{terrainAt}).hours,raw.hours);
  const ship={...raw,legs:raw.legs.map(l=>({...l,sea:true}))};
  assert.equal(retimeWalking(ship,{baseFeet:30,favored:["forest"],changes:[]},{terrainAt}).hours,raw.hours);
 }
});
test("road and trail penalties use their own modifiers and a mixed route benefits only in matching terrain",()=>{
 const biome={type:"forest",offroad:.6,road:.8,trail:.4},terrainAt=()=>({...TERRAIN[1],biome});
 for(const kind of ["road","trail"]){
  const graph=buildGraph([{properties:{id:kind,kind},geometry:{coordinates:[[0,0],[36,0]]}}],(x,y)=>[x,y]);
  const raw=itinerary(graph,[[0,0],[36,0]],{mode:"roads",milesPerPixel:1,terrainAt});
  const timed=retimeWalking(raw,{baseFeet:30,favored:["forest"],changes:[]},{terrainAt});
  assert.ok(Math.abs(timed.hours/raw.hours-biome[kind]/favoredBiomeMultiplier(biome[kind],"forest",["forest"]))<1e-7);
 }
 const mixed=(x)=>({...TERRAIN[1],biome:{...biome,type:x<18?"forest":"desert"}});
 const raw=itinerary(buildGraph([],p=>p),[[0,0],[36,0]],{mode:"direct",milesPerPixel:1,terrainAt:mixed});
 const timed=retimeWalking(raw,{baseFeet:30,favored:["forest"],changes:[]},{terrainAt:mixed});
 assert.ok(Math.abs(timed.hours/raw.hours-.875)<1e-7);
});

function setup({active=true,favored=false}={}){
 gmGame();globalThis.foundry={utils:{escapeHTML:String,deepClone:structuredClone}};
 const a=sourceToLonLat(1000,1000),b=sourceToLonLat(2200,1000),config={types:{plains:{offroad:.6}}};
 const state={start:{lon:a[0],lat:a[1],name:"Start"},waypoints:[{lon:b[0],lat:b[1],name:"End"}],trip:active?{departed:0,decisions:[],resumed:{},halts:[],biomeTravel:freezeBiomeTravel(config)}:null};
 const scene=testScene(state),actor=ranger(...(favored?[feature("Favored Terrain: Plains")]:[])),routes={features:[]};
 const create=()=>{const hud=new TravelHud({headless:true,getScene:()=>scene,getRoutes:()=>routes,getTerrain:async()=>null,getBiomes:()=>config,getPlaces:()=>[],getEncounters:()=>[],getWaterways:()=>({})});hud.members=()=>[actor];hud.stops=()=>[state.start,...state.waypoints];hud.tick=async()=>{};return hud;};
 return{state,scene,actor,hud:create(),create};
}
test("the route preview automatically uses the traveling ranger's chosen terrain",async()=>{
 const x=setup({active:false}),before=x.hud;await before.refresh();const original=before.result.hours;
 x.actor.items.push(feature("Favored Terrain: Plains"));await before.refresh();
 assert.ok(Math.abs(before.result.hours-original*.75)<1e-7);assert.equal(x.scene.writes.length,0);
});
test("gaining and losing favored terrain preserves distance, past camps and reload timing",async()=>{
 const x=setup();x.state.trip.decisions=[{rest:16,started:8*H}];game.time.worldTime=30*H;
 await x.hud.refresh();const hour=x.hud.progress().hour,position=pointAtHour(x.hud.result.track,hour),camp=pointAtHour(x.hud.result.track,x.hud.camps[0]),total=x.hud.result.hours;
 x.actor.items.push(feature("Favored Terrain: Plains"));await x.hud.refresh();
 near(pointAtHour(x.hud.result.track,x.hud.progress().hour),position);near(pointAtHour(x.hud.result.track,x.hud.camps[0]),camp);
 assert.ok(x.hud.result.hours<total);assert.equal(x.state.trip.walking.changes.length,1);
 const reload=x.create();await reload.refresh();assert.equal(reload.result.hours,x.hud.result.hours);near(pointAtHour(reload.result.track,reload.progress().hour),position);
 game.time.worldTime=31*H;const later=pointAtHour(x.hud.result.track,x.hud.progress().hour);
 x.actor.items.pop();await x.hud.refresh();near(pointAtHour(x.hud.result.track,x.hud.progress().hour),later);
 assert.equal(x.state.trip.walking.changes.length,2);
 const writes=x.scene.writes.length;await x.hud.refresh();assert.equal(x.scene.writes.length,writes);
});
test("favored terrain updates in camp retain its start, end and location; players consume GM history",async()=>{
 const x=setup();x.state.trip.decisions=[{rest:16,started:8*H}];game.time.worldTime=12*H;
 await x.hud.refresh();const before=x.hud.progress(),at=pointAtHour(x.hud.result.track,before.hour),primary=game.user;
 x.actor.items.push(feature("Favored Terrain: Plains"));game.user={id:"player",isGM:false};
 const observer=x.create(),writes=x.scene.writes.length;await observer.refresh();assert.equal(x.scene.writes.length,writes);
 game.user=primary;await x.hud.refresh();await observer.refreshProgress();
 const after=x.hud.progress();assert.equal(after.since,before.since);assert.equal(after.until,before.until);near(pointAtHour(x.hud.result.track,after.hour),at);
 assert.equal(observer.result.hours,x.hud.result.hours);
});
