import { test } from "node:test";
import assert from "node:assert/strict";
import { TravelHud } from "../scripts/ui-hud.mjs";
import { progressKey, needsRouteRefresh } from "../scripts/journey-state.mjs";
import { replayTrip } from "../scripts/travel.mjs";
import { gmGame, testScene } from "./helpers/journey.mjs";

function setup() {
  gmGame();
  const state={trip:{departed:0,decisions:[],resumed:{},halts:[]},waypoints:[],hours:8,rest:16};
  const scene=testScene(state);globalThis.canvas={scene,tokens:{placeables:[]}};
  const hud=new TravelHud({getLayer:()=>null,getPlaces:()=>[]});
  hud.el={};hud.draw=()=>{};hud.render=()=>{};
  hud.plan={hours:20,encounters:[],stays:[]};hud.result={track:[{at:[0,0],hour:0},{at:[100,0],hour:20}]};
  state.now={hour:0,status:"moving",told:progressKey(state,hud.progress())};
  return{state,scene,hud};
}

test("an in-flight sync cannot publish onto a newly viewed scene or a replacement trip", async () => {
  const {hud,scene,state}=setup(), other=testScene({},"encounter");
  const work=hud.tick();canvas.scene=other;await work;
  assert.equal(scene.writes.length,0);assert.equal(other.writes.length,0);
  canvas.scene=scene;const next=hud.tick();state.trip={...state.trip,departed:100};await next;
  assert.equal(scene.writes.length,0);
});

test("movement snapshots respect the threshold instead of publishing each clock second", async () => {
  const {hud,scene}=setup();
  await hud.tick({force:true});assert.equal(scene.writes.length,1);
  for(let i=1;i<=10;i++){game.time.worldTime=3600+i;await hud.tick();}
  assert.equal(scene.writes.length,1);
  game.time.worldTime=3790;await hud.tick();assert.equal(scene.writes.length,2);
  assert.equal(hud.asked.size,0);
});

test("losing primary authority cancels an in-flight publication", async () => {
  const {hud,scene}=setup();const work=hud.tick();game.user.active=false;
  game.users.push({id:"other",isGM:true,active:true});await work;
  assert.equal(scene.writes.length,0);
});

test("camp changes retain the existing route and only rebuild progress projection", async () => {
  setup();
  const hud=new TravelHud({getRoutes:()=>{throw Error("rerouted");},getEncounters:()=>[],getTowns:()=>[]});
  const result={hours:20,track:[],legEnds:[20],sail:[]};hud.result=result;hud.graph={};
  let ticks=0;hud.tick=()=>ticks++;await hud.refreshProgress();
  assert.equal(hud.result,result);assert.equal(ticks,1);
  for(const changes of [{watch:{}},{now:{}},{trip:{}},{encounters:[]},{rest:8}])assert.equal(needsRouteRefresh(changes),false);
  assert.equal(needsRouteRefresh({waypoints:[]}),true);assert.equal(needsRouteRefresh({method:"flying"}),true);
});
