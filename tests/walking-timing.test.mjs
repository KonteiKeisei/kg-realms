import { test } from "node:test";
import assert from "node:assert/strict";
import { walkingHistory, retimeWalking, baseTravelHour } from "../scripts/walking-timing.mjs";
import { TravelHud } from "../scripts/ui-hud.mjs";
import { pointAtHour, encounterHours } from "../scripts/travel.mjs";
import { sourceToLonLat } from "../scripts/source-map.mjs";
import { gmGame, testScene } from "./helpers/journey.mjs";
const H=3600;
const near=(a,b)=>assert.ok(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-7,`${a} differs from ${b}`);
const raw=()=>({hours:40,track:[{at:[0,0],hour:0,leg:0},{at:[60,0],hour:20,leg:0},{at:[120,0],hour:40,leg:0}],legs:[{method:"foot",start:0,hours:40,sched:{samples:[]}}],legEnds:[40],sail:[]});

test("a slowdown between samples preserves all travelled positions and changes only the remaining hours",()=>{
  const original=raw(),r=retimeWalking(original,{baseFeet:30,changes:[{hour:12,feet:20}]});
  assert.equal(r.hours,54);near(pointAtHour(r.track,12),pointAtHour(original.track,12));
  near(pointAtHour(r.track,8),[24,0]);near(pointAtHour(r.track,13),[38,0]);
  assert.equal(baseTravelHour(r.track,13),12+2/3);assert.equal(original.hours,40);
  const encounter={id:"near",at:[35,0],radius:100};
  assert.equal(encounterHours(original.track,[encounter])[0].hour,20);
  assert.equal(encounterHours(r.track,[encounter])[0].hour,24,"a timing boundary cannot relocate an existing encounter's sample");
});

test("repeated slowing and speeding up retain earlier timing after serialization",()=>{
  const history=walkingHistory({baseFeet:30,changes:[{hour:12,feet:20},{hour:20,feet:30}]});
  const r=retimeWalking(raw(),JSON.parse(JSON.stringify(history)));
  assert.equal(r.hours,44);near(pointAtHour(r.track,24),[60,0]);near(pointAtHour(r.track,25),[63,0]);
  near(pointAtHour(r.track,12),[36,0]);assert.equal(baseTravelHour(r.track,25),21);
});

test("walking encumbrance does not slow ships, mounts or flight",()=>{
  const methods=["foot","foot","mounted","flying","foot"];
  const legs=methods.map((method,i)=>({method,sea:i===1,start:i*10,hours:10,sched:{samples:[]}}));
  const r=retimeWalking({hours:50,legs,track:Array.from({length:6},(_,i)=>({at:[i*30,0],hour:i*10,leg:Math.min(i,4)})),legEnds:[10,20,30,40,50],sail:[{from:10,to:20}]},{baseFeet:30,changes:[{hour:5,feet:15}]});
  assert.equal(r.legs[0].hours,15);assert.equal(r.legs[1].hours,10);assert.equal(r.legs[2].hours,10);assert.equal(r.legs[3].hours,10);assert.equal(r.legs[4].hours,20);
  assert.deepEqual(r.sail,[{from:15,to:25}]);assert.equal(r.hours,65);
});

function setup() {
  gmGame();globalThis.foundry={utils:{escapeHTML:String,deepClone:structuredClone}};
  const a=sourceToLonLat(1000,1000),b=sourceToLonLat(2200,1000);
  const state={start:{lon:a[0],lat:a[1],name:"Start"},waypoints:[{lon:b[0],lat:b[1],name:"End"}],trip:{departed:0,decisions:[],resumed:{},halts:[]}};
  const scene=testScene(state),actor={name:"Walker",system:{attributes:{movement:{walk:30}}}};
  const routes={features:[]},options={headless:true,getScene:()=>scene,getRoutes:()=>routes,getTerrain:async()=>null,getPlaces:()=>[],getEncounters:()=>[],getWaterways:()=>({})};
  const create=()=>{const hud=new TravelHud(options);hud.members=()=>[actor];hud.tick=async()=>{};return hud;};
  return{state,scene,actor,hud:create(),create};
}

test("the variant encumbrance thresholds count only when the world uses Variant Encumbrance",()=>{
  const x=setup(),old=game.settings;
  // A Small halfling with Strength 12 carrying 105 of 180 lb: dnd5e still reports the variant thresholds.
  x.actor.system.attributes.encumbrance={value:105,max:180,thresholds:{encumbered:60,heavilyEncumbered:120,maximum:180}};
  try{
    for(const [rule,want] of [["normal",[]],["none",[]],["variant",["encumbered"]]]){
      game.settings={...old,get:(m,k)=>m==="dnd5e"&&k==="encumbrance"?rule:old?.get?.(m,k)};
      assert.deepEqual(x.hud.speed().burdened.map(b=>b.burden),want,rule);
    }
    game.settings={...old,get:(m,k)=>m==="dnd5e"&&k==="encumbrance"?"normal":old?.get?.(m,k)};
    x.actor.system.attributes.encumbrance.value=190;
    assert.deepEqual(x.hud.speed().burdened.map(b=>b.burden),["over carrying capacity"]);
  }finally{game.settings=old;}
});

test("the HUD keeps the party and completed camp fixed when encumbrance changes on day two",async()=>{
  const x=setup();x.state.trip.decisions=[{rest:16,started:8*H}];game.time.worldTime=30*H;
  await x.hud.refresh();const p=x.hud.progress(),at=pointAtHour(x.hud.result.track,p.hour),camp=pointAtHour(x.hud.result.track,x.hud.camps[0]);
  assert.equal(p.hour,14);assert.equal(p.dayHours,6);const before=x.hud.result.hours;
  x.actor.system.attributes.movement.walk=20;await x.hud.refresh();
  assert.equal(x.hud.progress().hour,p.hour);assert.equal(x.hud.progress().dayHours,6);near(pointAtHour(x.hud.result.track,p.hour),at);
  near(pointAtHour(x.hud.result.track,x.hud.camps[0]),camp);assert.ok(x.hud.result.hours>before);
  assert.deepEqual(x.state.trip.walking.changes,[{hour:14,feet:20,at:30*H}]);
  const rebuilt=x.create();await rebuilt.refresh();near(pointAtHour(rebuilt.result.track,rebuilt.progress().hour),at);
  assert.deepEqual(x.state.trip.walking.changes,[{hour:14,feet:20,at:30*H}]);
});

test("changing speed in an active camp retains that camp's position, start and end",async()=>{
  const x=setup();x.state.trip.decisions=[{rest:16,started:8*H}];game.time.worldTime=12*H;
  await x.hud.refresh();const before=x.hud.progress(),at=pointAtHour(x.hud.result.track,before.hour);
  x.actor.system.attributes.movement.walk=20;await x.hud.refresh();
  const p=x.hud.progress();assert.equal(p.status,"resting");assert.equal(p.since,before.since);assert.equal(p.until,before.until);near(pointAtHour(x.hud.result.track,p.hour),at);
  assert.equal(x.state.trip.walking.changes[0].hour,8);
});

test("a second speed change anchors at today's location rather than replaying the first slowdown",async()=>{
  const x=setup();game.time.worldTime=4*H;await x.hud.refresh();x.actor.system.attributes.movement.walk=20;await x.hud.refresh();
  game.time.worldTime=6*H;const at=pointAtHour(x.hud.result.track,x.hud.progress().hour);
  x.actor.system.attributes.movement.walk=30;await x.hud.refresh();near(pointAtHour(x.hud.result.track,x.hud.progress().hour),at);
  assert.equal(x.state.trip.walking.changes.length,2);assert.ok(Math.abs(x.state.trip.walking.changes[1].hour-(4+4/3))<1e-7);
  const writes=x.scene.writes.length;await x.hud.refreshProgress();await x.hud.refresh();assert.equal(x.scene.writes.length,writes,"unchanged speed does not write timing again");
});

test("a scene update during timing publication converges without duplicate changes or an old redraw",async()=>{
  const x=setup();game.time.worldTime=6*H;await x.hud.refresh();
  const at=pointAtHour(x.hud.result.track,6),update=x.scene.update,work=[];
  x.scene.update=async patch=>{await update(patch);work.push(x.hud.refreshProgress());};
  x.actor.system.attributes.movement.walk=20;await x.hud.refresh();await Promise.all(work);
  near(pointAtHour(x.hud.result.track,x.hud.progress().hour),at);assert.equal(x.state.trip.walking.changes.length,1);assert.equal(x.hud.appliedWalking,JSON.stringify(x.state.trip.walking));
});

test("only the primary GM publishes a speed change; other planners consume the saved history",async()=>{
  const x=setup();game.time.worldTime=6*H;await x.hud.refresh();const primary=game.user;
  const secondary={id:"secondary",isGM:true,active:true};game.users.push(secondary);game.user=secondary;
  x.actor.system.attributes.movement.walk=20;const observer=x.create(),writes=x.scene.writes.length;await observer.refresh();
  assert.equal(x.scene.writes.length,writes);near(pointAtHour(observer.result.track,6),pointAtHour(x.hud.result.track,6));
  game.user=primary;await x.hud.refresh();await observer.refreshProgress();
  assert.equal(x.state.trip.walking.changes.length,1);assert.equal(observer.result.hours,x.hud.result.hours);
});
