import { test } from "node:test";
import assert from "node:assert/strict";
import { TravelBounce } from "../scripts/travel-motion.mjs";
import { TravelHud } from "../scripts/ui-hud.mjs";
import { gmGame, testScene } from "./helpers/journey.mjs";
import { makeFrame } from "../scripts/geo.mjs";
import { SOURCE_MAP, lonLatToSource } from "../scripts/source-map.mjs";
import { campPhases } from "../scripts/camp.mjs";

test("fast-forward uses one eight-second token update and does not restart it at the same position", async () => {
  gmGame();const state={trip:{departed:0,decisions:[],resumed:{},halts:[]},waypoints:[],hours:8,rest:16};
  const scene=testScene(state), moves=[];
  const doc={id:"party",name:"Party Token",actor:{type:"group",system:{members:[]}},x:0,y:0,width:1,height:1};
  scene.updateEmbeddedDocuments=async(type,updates,options)=>{moves.push({type,updates,options});Object.assign(doc,updates[0]);};
  class FoundryToken {
    constructor(document) { this.document=document; }
    get id() { return this.document.id; }
    get w() { return this.document.width*100; }
    get h() { return this.document.height*100; }
    get center() { return {x:50,y:50}; }
  }
  globalThis.canvas={scene,tokens:{placeables:[new FoundryToken(doc)]}};
  const hud=new TravelHud({getLayer:()=>({frame:makeFrame(SOURCE_MAP.bounds,{x:0,y:0,width:10000,height:10000})}),getPlaces:()=>[]});
  hud.el={};hud.draw=()=>{};hud.render=()=>{};
  hud.plan={hours:20,encounters:[],stays:[]};hud.result={track:[{at:[100,100],hour:0},{at:[500,500],hour:20}]};
  hud.asked.add((await import("../scripts/journey-state.mjs")).progressKey(hud.state,hud.progress()));
  game.time.advance=async dt=>{game.time.worldTime+=dt;};
  await hud.advanceClock(3600);
  assert.equal(moves.length,1);assert.equal(moves[0].options.animation.duration,8000);
  assert.equal(moves[0].updates[0]._id,"party");
  assert.ok(Number.isFinite(moves[0].updates[0].x));assert.ok(Number.isFinite(moves[0].updates[0].y));
  await hud.tick();assert.equal(moves.length,1,"document destination, not the animated artwork, determines remaining movement");
});

test("travel jiggle restores the artwork pivot on scene changes and leaves token coordinates alone", () => {
  const ticker=new Set(), scene={id:"map",grid:{size:100}};
  globalThis.canvas={scene,app:{ticker:{add:fn=>ticker.add(fn),remove:fn=>ticker.delete(fn)}}};
  const mesh={scale:{y:2},pivot:{y:17}}, doc={id:"p",x:25,y:40,parent:scene,object:{mesh}};
  const bounce=new TravelBounce();bounce.start(doc,8000);bounce.frame();
  assert.equal(ticker.size,1);assert.ok(mesh.pivot.y>=17);
  canvas.scene={id:"other"};bounce.frame();
  assert.equal(mesh.pivot.y,17);assert.equal(ticker.size,0);assert.equal(doc.x,25);assert.equal(doc.y,40);
});

test("abandoning camp moves the actual party token and map position together, then retains the escape point", async () => {
  gmGame();game.time.worldTime=13*3600;game.settings.get=()=>"";
  globalThis.foundry={utils:{escapeHTML:String,deepClone:structuredClone}};
  const state={trip:{departed:0,decisions:[{rest:16,started:8*3600}],resumed:{},halts:[]},watch:{campId:"camp",phases:{...campPhases(),campId:"camp"},hours:{a:2,b:2,c:2,d:2},checks:{campId:"camp",night:1},scene:{night:1,step:"w0",hold:true}},encounters:[{id:"e",rest:{night:1,at:5,watch:0}}]};
  const scene=testScene(state),moves=[],doc={id:"party",name:"Party Token",actor:{type:"group",system:{members:[]}},x:0,y:0,width:1,height:1};
  scene.updateEmbeddedDocuments=async(type,updates,options)=>{moves.push({updates,options});Object.assign(doc,updates[0]);};
  scene.tokens=[doc];globalThis.canvas={scene,tokens:{placeables:[{document:doc,id:doc.id,w:100,h:100,center:{x:50,y:50}}]}};
  const frame=makeFrame(SOURCE_MAP.bounds,{x:0,y:0,width:10000,height:10000});
  const hud=new TravelHud({getScene:()=>scene,getLayer:()=>({frame}),getPlaces:()=>[],getTerrain:async()=>null});
  const actors=["a","b","c","d"].map(id=>({id,name:id,items:[],system:{skills:{},details:{race:"Human"}}}));hud.members=()=>actors;
  hud.el={};hud.draw=()=>{};hud.render=()=>{};hud.camp.renderScene=()=>{};
  hud.plan={hours:40,encounters:state.encounters,stays:[]};hud.result={track:[{at:[1000,1000],hour:0},{at:[2000,1000],hour:40}]};hud.trackMiles=[0,100];
  // Avoid chat/journal side effects in this movement check.
  const {progressKey}=await import("../scripts/journey-state.mjs");
  const save=hud.save.bind(hud);hud.save=async changes=>{await save(changes);hud.asked.add(progressKey(hud.state,hud.progress()));};
  hud.camp.change({dataset:{camp:"encounter-resolution"},value:"abandon"});
  await hud.camp.click({dataset:{camp:"scene-carry"}});
  assert.equal(hud.progress().status,"halted");assert.equal(state.trip.escape.distance,5);
  const at=lonLatToSource(...hud.whereNow());assert.ok(Math.hypot(at[0]-state.trip.escape.at[0],at[1]-state.trip.escape.at[1])<1e-6);
  assert.equal(moves.length,1);assert.equal(moves[0].updates[0]._id,"party");assert.equal(moves[0].options.animation.duration,8000);
  const destination=[doc.x,doc.y];await hud.tick();assert.deepEqual([doc.x,doc.y],destination);assert.equal(moves.length,1);
});
