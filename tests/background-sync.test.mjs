import { test } from "node:test";
import assert from "node:assert/strict";
import { TravelHud } from "../scripts/ui-hud.mjs";
import { gmGame, testScene } from "./helpers/journey.mjs";
import {registerWorld} from '../scripts/worlds.mjs';

test("off-map sync is idle without viewers, caches its planner, and accepts an explicit player request", async () => {
  registerWorld({id:'test-world',module:'test-companion'});
  const hooks={},once={},seen=[];
  globalThis.Hooks={on:(name,fn)=>(hooks[name]??=[]).push(fn),once:(name,fn)=>(once[name]??=[]).push(fn)};
  globalThis.foundry={utils:{debounce:fn=>fn,getRoute:s=>s,mergeObject:Object.assign,hasProperty:(o,p)=>p.split(".").every(k=>(o=o?.[k])!==undefined)}};
  const state={trip:{departed:0},waypoints:[],stays:[]},scene=testScene(state);
  scene.flags={"kg-realms":{world:"test-world",level:"surface",bounds:{west:0,east:10,south:0,north:10}}};
  scene.dimensions={sceneRect:{x:0,y:0,width:1000,height:1000}};
  scene.getFlag=(m,k)=>k==="journey"?state:scene.flags[m]?.[k];
  const scenes=[scene];scenes.get=id=>scenes.find(s=>s.id===id);
  gmGame({scenes,actors:[],i18n:{localize:s=>s},socket:{on:(channel,fn)=>{game.socket.receive=fn;}}});
  globalThis.canvas={scene:null,tokens:{placeables:[]}};
  const player={id:"player",active:true,isGM:false,viewedScene:null};game.users.push(player);
  let fetches=0,builds=0,ticks=0;
  globalThis.fetch=async path=>{fetches++;return{ok:true,json:async()=>path.endsWith("index.json")?{places:[],routes:"routes.geojson"}:path.endsWith("routes.geojson")?{features:[]}:{} };};
  const refresh=TravelHud.prototype.refresh,tick=TravelHud.prototype.tick,progress=TravelHud.prototype.refreshProgress;
  TravelHud.prototype.refresh=async function(){assert.ok(this.headless);assert.equal(this.el,null);builds++;seen.push(this.scene.id);};
  TravelHud.prototype.tick=async function(){ticks++;seen.push(this.scene.id);};
  TravelHud.prototype.refreshProgress=async function(){ticks++;};
  try {
    await import("../scripts/main.mjs");
    const clock=hooks.updateWorldTime[0];
    clock();await new Promise(setImmediate);assert.equal(fetches,0);assert.equal(builds,0);
    player.viewedScene=scene.id;clock();
    for(let i=0;i<10&&!builds;i++)await new Promise(setImmediate);
    assert.equal(builds,1);const initialFetches=fetches;
    clock();await new Promise(setImmediate);assert.equal(builds,1);assert.equal(fetches,initialFetches);assert.equal(ticks,1);
    player.viewedScene=null;clock();await new Promise(setImmediate);assert.equal(ticks,1);
    once.ready.find(fn=>fn.toString().includes("game.socket.on"))();
    game.socket.receive({type:"request-sync",scene:scene.id,user:player.id});
    await new Promise(setImmediate);assert.equal(ticks,2);assert.deepEqual(new Set(seen),new Set([scene.id]));
  } finally {TravelHud.prototype.refresh=refresh;TravelHud.prototype.tick=tick;TravelHud.prototype.refreshProgress=progress;}
});
