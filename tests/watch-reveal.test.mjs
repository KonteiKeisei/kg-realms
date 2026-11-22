import { test } from "node:test";
import assert from "node:assert/strict";
import { CampPanel } from "../scripts/ui-camp.mjs";
import { writeJourney } from "../scripts/journey-write.mjs";
import { gmGame, testScene } from "./helpers/journey.mjs";

function setup(){
  gmGame();globalThis.foundry={utils:{randomID:()=>"reveal"}};
  const state={trip:{departed:0},watch:{campId:"camp",checks:{night:1,campId:"camp"},scene:{night:1,step:"camp"}},encounters:[{id:"e",rest:{night:1,pending:true,rolls:[]}}]};
  const scene=testScene(state),p={status:"resting",night:1,since:0,until:57600};let clock=0;
  const hud={scene,state,leader:true,get clock(){return clock;},progress:()=>p,save:c=>writeJourney(scene,()=>c),advanceClock:async dt=>{clock+=dt;}};
  const camp=new CampPanel(hud);camp.members=()=>[];camp.plan=()=>({rest:16,window:8,watches:[{id:"a",from:0,to:4},{id:"b",from:4,to:8}]});camp.campEffects=()=>({conceal:0});
  let rolls=0;globalThis.Roll=class{async evaluate(){rolls++;return{total:2};}};
  let release,delay;camp.waitForWatch=ms=>{delay=ms;return new Promise(r=>release=r);};
  return{camp,hud,state,p,rolls:()=>rolls,release:()=>release(),delay:()=>delay};
}

test("watch outcomes are published straight after the reveal is saved (0.97.9: no die), and a completed watch does not replay",async()=>{
  const x=setup();const action=x.camp.click({dataset:{camp:"scene-next",step:"w0"}});
  await new Promise(setImmediate);
  assert.equal(x.delay(),0);assert.equal(x.rolls(),0);
  assert.equal(x.state.watch.scene.step,"w0");assert.equal(x.state.watch.reveals[0].done,false);
  assert.deepEqual(x.state.encounters[0].rest.rolls,[]);
  x.release();await action;assert.equal(x.rolls(),1);assert.equal(x.state.watch.reveals[0].done,true);
  x.camp.waitForWatch=()=>{throw Error("replayed");};assert.equal(await x.camp.revealWatch(x.p,0),true);
});

test("a replacement camp cannot receive dice or outcomes from an unfinished reveal",async()=>{
  const x=setup();const action=x.camp.click({dataset:{camp:"scene-next",step:"w0"}});
  await new Promise(setImmediate);x.state.watch={campId:"new-camp",scene:{step:"camp",night:1}};
  x.release();await action;assert.equal(x.rolls(),0);assert.equal(x.state.watch.scene.step,"camp");
});

test("an interrupted reveal retains its identity and finishes at once",async()=>{
  const x=setup();x.state.watch.reveals={0:{id:"previous-gm",campId:"camp",until:Date.now()+1000,done:false}};
  const work=x.camp.revealWatch(x.p,0);await new Promise(setImmediate);
  assert.equal(x.delay(),0);assert.equal(x.state.watch.reveals[0].id,"previous-gm");
  x.release();assert.equal(await work,true);
});

test("the clock passing several watches rolls them all and saves them once (0.96.4)",async()=>{
  const x=setup();x.camp.waitForWatch=()=>{throw Error("no reveal wait in a catch-up");};
  x.hud.state.watch.scene.step="camp";Object.defineProperty(x.hud,"clock",{get:()=>13*3600});
  const writes=x.hud.scene.writes.length;
  x.camp.followClock(x.p);for(let i=0;i<20&&(x.camp.following||x.hud.scene.writes.length===writes);i++)await new Promise(setImmediate);
  assert.equal(x.hud.scene.writes.length-writes,1,"one save for every watch passed");
  assert.equal(x.state.watch.reveals[0].done,true);assert.equal(x.state.watch.reveals[1].done,true);
  assert.equal(x.state.watch.scene.step,"w1");assert.equal(x.state.encounters[0].rest.rolls.length,2);
});

test("a primary GM can finish an interrupted reveal without mounting a carousel",async()=>{
  const x=setup();x.state.watch.scene.step="w0";
  x.state.watch.reveals={0:{id:"old-primary",campId:"camp",until:Date.now()+1000,done:false}};
  x.camp.followClock(x.p);await new Promise(setImmediate);
  assert.equal(x.camp.following,true);assert.equal(x.rolls(),0);
  x.release();for(let i=0;i<8&&x.camp.following;i++)await new Promise(setImmediate);
  assert.equal(x.state.watch.reveals[0].done,true);assert.equal(x.rolls(),1);assert.equal(x.camp.following,false);
});
