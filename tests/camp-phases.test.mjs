import { test } from "node:test";
import assert from "node:assert/strict";
import { campPhases, campSchedule } from "../scripts/camp.mjs";
import { CampPanel } from "../scripts/ui-camp.mjs";
import { replayTrip } from "../scripts/travel.mjs";
import { writeJourney } from "../scripts/journey-write.mjs";
import { gmGame, testScene } from "./helpers/journey.mjs";
const H=3600;

function setup(total=16){
  gmGame();globalThis.Roll=class{async evaluate(){return{total:2};}};globalThis.foundry={utils:{randomID:()=>Math.random().toString(),deepClone:structuredClone}};
  const started=18*H,phases=campPhases(total),actors=[0,1,2,3].map(i=>({id:`a${i}`}));
  const state={rest:total,trip:{departed:started-8*H,decisions:[{rest:total,started}],resumed:{},halts:[]},watch:{campId:"camp",setup:1,phases:{...phases,campId:"camp"},checks:{night:1,campId:"camp"},scene:{night:1,step:"camp"}}};
  const scene=testScene(state),plan={hours:40,encounters:[],stays:[]};game.time.worldTime=started;
  const hud={scene,state,leader:true,get clock(){return game.time.worldTime;},progress:()=>replayTrip(state.trip,plan,game.time.worldTime),save:c=>writeJourney(scene,()=>c),advanceClock:async t=>{game.time.worldTime+=t;}};
  const panel=new CampPanel(hud);panel.members=()=>actors.map(actor=>({id:actor.id,actor,sleep:"full"}));panel.waitForWatch=async()=>{};
  let recoveries=0,at;game.modules=new Map([["rest-recovery",{active:true}]]);game.restrecovery={promptRest:()=>{recoveries++;at=game.time.worldTime;return true;}};
  game.time.calendar={timeToComponents:t=>({year:1,month:0,dayOfMonth:Math.floor(t/86400)})};
  const click=(act,step)=>panel.click({dataset:{camp:act,step}});
  return{panel,state,started,actors,hud,click,recoveries:()=>recoveries,at:()=>at};
}

test("new camps reserve 4/8/4, and extra time delays packing instead of moving the watches",()=>{
  const base=campSchedule(campPhases(16),18*H),long=campSchedule(campPhases(20),18*H);
  assert.equal(base.restStart,22*H);assert.equal(base.restEnd,30*H);assert.equal(base.packStart,30*H);assert.equal(base.end,34*H);
  assert.equal(long.restStart,base.restStart);assert.equal(long.restEnd,base.restEnd);
  assert.equal(long.packStart,34*H);assert.equal(long.end,38*H);assert.equal(campPhases(4).total,16);
});

test("setup, every watch, recovery and packing advance distinct amounts of time",async()=>{
  const x=setup();
  for(let i=0;i<4;i++){
    await x.click("scene-next",`w${i}`);
    assert.equal(game.time.worldTime,x.started+(4+i*2)*H);
    const t=x.panel.watchTimes(x.hud.progress(),i);assert.equal(t.to-t.from,2*H);
    assert.equal(x.recoveries(),0);
  }
  await x.click("scene-next","recovery");assert.equal(game.time.worldTime,x.started+12*H);
  await x.click("camp-recover");assert.equal(x.recoveries(),1);assert.equal(x.at(),x.started+12*H);
  assert.equal(x.state.watch.scene.step,"pack");assert.equal(game.time.worldTime,x.started+12*H);
  await x.click("scene-break");assert.equal(game.time.worldTime,x.started+16*H);assert.equal(x.recoveries(),1);assert.equal(x.state.watch.scene.step,"done");
});

test("extra waiting follows recovery, with four hours of packing still left afterwards",async()=>{
  const x=setup(20);for(let i=0;i<4;i++)await x.click("scene-next",`w${i}`);
  await x.click("scene-next","recovery");await x.click("camp-recover");
  assert.equal(x.state.watch.scene.step,"wait");assert.equal(game.time.worldTime,x.started+12*H);
  await x.click("scene-next","pack");assert.equal(game.time.worldTime,x.started+16*H);
  await x.click("scene-break");assert.equal(game.time.worldTime,x.started+20*H);assert.equal(x.recoveries(),1);
});

test("a completed encounter extends its own watch and later watches, preserving earlier starts",()=>{
  const x=setup();x.state.encounters=[{id:"e",rest:{night:1,at:5,watch:0}}];x.state.trip.resumed.e=x.started+6*H;
  const p={status:"resting",night:1,since:x.started,until:x.started+17*H};
  const first=x.panel.watchTimes(p,0),second=x.panel.watchTimes(p,1);
  assert.equal(first.from,x.started+4*H);assert.equal(first.to,x.started+7*H);
  assert.equal(second.from,first.to);assert.equal(second.to,x.started+9*H);
  assert.equal(x.panel.schedule(p).end,x.started+17*H);
});

test("duplicate recovery clicks cannot request two rests",async()=>{
  const x=setup();x.state.watch.scene.step="recovery";game.time.worldTime=x.started+12*H;
  let calls=0,finish;game.restrecovery.promptRest=()=>{calls++;return new Promise(r=>finish=r);};
  const first=x.click("camp-recover"),second=x.click("camp-recover");await new Promise(setImmediate);
  assert.equal(calls,1);finish(true);await Promise.all([first,second]);assert.equal(calls,1);
});

test("one pushed hour shifts subsequent camps in both travel distance and time",()=>{
  const p={hours:40,encounters:[],stays:[]};
  const normal=replayTrip({departed:0,decisions:[],resumed:{}},p,Infinity,{autoRest:16});
  const pushed=replayTrip({departed:0,decisions:[{push:true,started:8*H}],resumed:{}},p,Infinity,{autoRest:16});
  assert.deepEqual(pushed.camps,normal.camps.map(h=>h+1));assert.equal(pushed.since,normal.since);
  const day2normal=replayTrip({departed:0,decisions:[{rest:16}],resumed:{}},p,Infinity);
  const day2pushed=replayTrip({departed:0,decisions:[{push:true},{rest:16}],resumed:{}},p,Infinity);
  assert.equal(day2pushed.hour,day2normal.hour+1);assert.equal(day2pushed.since,day2normal.since+H);
});

test("a delayed push starts at the current clock and gives a full additional hour",()=>{
  const plan={hours:40,encounters:[],stays:[]},trip={departed:0,decisions:[{push:true,started:18*H}],resumed:{}};
  const before=replayTrip(trip,plan,17*H);assert.equal(before.status,"decide");assert.equal(before.hour,8);
  const during=replayTrip(trip,plan,18.5*H);assert.equal(during.status,"moving");assert.equal(during.hour,8.5);
  const after=replayTrip(trip,plan,19*H);assert.equal(after.status,"decide");assert.equal(after.hour,9);
});

test("completed phase metadata cannot keep the previous camp's length for a new camp",()=>{
  const x=setup(20);x.state.watch.scene.step="done";x.state.rest=16;
  assert.equal(x.panel.plan().rest,16);assert.equal(x.panel.plan().wait,0);
  x.state.watch.scene.step="w0";assert.equal(x.panel.plan().rest,20);
});

test("a recovery failure allows retry, and a handover never repeats an uncertain request",async()=>{
  const x=setup();x.state.watch.scene.step="recovery";game.time.worldTime=x.started+12*H;
  let calls=0;globalThis.ui={notifications:{warn:()=>{}}};game.restrecovery.promptRest=()=>{calls++;return false;};
  await x.click("camp-recover");assert.equal(x.state.watch.recovery.state,"failed");assert.equal(x.state.watch.scene.step,"recovery");
  x.state.watch.recovery.state="requesting";await x.click("camp-recover");assert.equal(calls,1);
  await x.click("recovery-skip");assert.equal(x.state.watch.scene.step,"pack");assert.equal(calls,1);assert.equal(game.time.worldTime,x.started+12*H);
});

test("finishing a practice camp cannot advance the real world's clock or request recovery",async()=>{
  const x=setup(),worldTime=game.time.worldTime,state=structuredClone(x.state);
  state.watch.scene.step="pack";
  x.panel.practice={state,clock:x.started+12*H,camped:x.started};
  x.panel.renderScene=()=>{};
  await x.click("scene-break");
  assert.equal(x.panel.practice,null);assert.equal(game.time.worldTime,worldTime);assert.equal(x.recoveries(),0);
});
