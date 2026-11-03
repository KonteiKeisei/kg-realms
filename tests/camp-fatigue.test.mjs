import { test } from "node:test";
import assert from "node:assert/strict";
import { CampPanel } from "../scripts/ui-camp.mjs";
import { campRequest, rollCampRequest, applyWatchFatigue } from "../scripts/camp-rolls.mjs";
import { setupWork } from "../scripts/camp-tasks.mjs";
import { campPhases } from "../scripts/camp.mjs";
import { writeJourney } from "../scripts/journey-write.mjs";
import { gmGame, testScene } from "./helpers/journey.mjs";
const H=3600;

function setup() {
  gmGame();game.settings.get=(m,k)=>["advancedWatches","taskForage","taskConceal","taskAlarm"].includes(k);
  globalThis.foundry={utils:{randomID:()=>Math.random().toString(),deepClone:structuredClone,escapeHTML:String,isNewerVersion:()=>true}};
  globalThis.ui={notifications:{info:()=>{}}};
  const state={rest:16,trip:{departed:0,resumed:{}},watch:{campId:"camp",setup:1,phases:{...campPhases(),campId:"camp"},scene:{night:1,step:"w0"},tasks:{a:"forage",b:"conceal",c:"alarm",d:"watch"},checks:{campId:"camp",night:1},hours:{a:2,b:2,c:2,d:2}}};
  const scene=testScene(state),actors=["a","b","c","d"].map(id=>({id,name:id,isOwner:true,items:[],system:{skills:{prc:{passive:14,total:4}},details:{race:"Human"}}}));
  game.actors={get:id=>actors.find(a=>a.id===id)};game.scenes={get:()=>scene};game.system={version:"5.3.3"};game.modules=new Map();game.time.worldTime=4*H;
  let progress={status:"resting",night:1,since:0,until:16*H};
  const hud={scene,state,leader:true,get clock(){return game.time.worldTime;},members:()=>actors,progress:()=>progress,save:c=>writeJourney(scene,()=>c),ruleText:()=>({}),render:()=>{}};
  const camp=new CampPanel(hud);
  return{camp,state,scene,actors,hud,setProgress:p=>progress=p};
}

test("foragers, concealers and alarm setters remain in the watch order with their own hours",()=>{
  const x=setup();
  assert.deepEqual(x.camp.plan().watches.map(w=>w.id),["a","b","c","d"]);
  assert.deepEqual(x.actors.map(a=>x.camp.fatigue(a.id)),["forage","conceal","alarm",null]);
});

test("Take a watch can be switched off and on without losing setup activity or other shifts",async()=>{
  const x=setup();await x.camp.change({dataset:{camp:"watch-duty",id:"a"},checked:false});
  assert.equal(x.state.watch.hours.a,0);assert.equal(x.state.watch.tasks.a,"forage");
  assert.deepEqual(x.camp.plan().watches.map(w=>w.id),["b","c","d"]);
  assert.deepEqual([x.state.watch.hours.b,x.state.watch.hours.c,x.state.watch.hours.d],[2,2,2]);
  await x.camp.change({dataset:{camp:"watch-duty",id:"a"},checked:true});
  assert.equal(x.state.watch.hours.a,2);assert.equal(x.camp.plan().watches[0].id,"a");
  assert.equal(x.state.watch.tasks.a,"forage");
});

test("player duty changes use the primary GM's existing write path and respect its lock",async()=>{
  const x=setup(),gm=game.user,player={id:"player",active:true,isGM:false};game.users.push(player);
  const sent=[];player.setFlag=async (_module,_key,body)=>sent.push(JSON.parse(body));game.user=player;
  x.state.watch.gmLock=true;
  await x.camp.change({dataset:{camp:"watch-duty",id:"a"},checked:false});assert.equal(sent.length,0);
  x.state.watch.gmLock=false;
  await x.camp.change({dataset:{camp:"watch-duty",id:"a"},checked:false});
  assert.equal(sent.length,1);assert.equal(x.state.watch.hours.a,2);assert.equal(sent[0].changes.hours.a,0);
  game.user=gm;await x.camp.onMessage(sent[0],player.id);
  assert.equal(x.state.watch.hours.a,0);assert.equal(x.state.watch.tasks.a,"forage");
});

test("fatigue affects skill, tool and ability checks only during that worker's active watch",()=>{
  const x=setup(),config={subject:x.actors[0],skill:"sur",advantage:true};
  applyWatchFatigue(config,[{camp:x.camp,progress:x.hud.progress()}]);
  assert.equal(config.disadvantage,true);assert.equal(config.advantage,true);
  for(const config of [{subject:x.actors[1],ability:"wis"},{subject:x.actors[3],tool:"thief"}]){
    applyWatchFatigue(config,[{camp:x.camp,progress:x.hud.progress()}]);assert.equal(config.disadvantage,undefined);
  }
  for(const time of [0,6*H,12*H,16*H]){
    game.time.worldTime=time;const config={subject:x.actors[0],ability:"dex"};
    applyWatchFatigue(config,[{camp:x.camp,progress:x.hud.progress()}]);assert.equal(config.disadvantage,undefined);
  }
  game.time.worldTime=4*H;x.state.watch.scene.step="recovery";
  assert.equal(x.camp.fatiguedOnWatch("a"),false);
});

test("failed setup work remains tiring after changing assignment, but old camp results do not",()=>{
  const x=setup();x.state.watch.checks.forage={campId:"camp",done:true,result:{success:false},rolls:{a:{total:4}}};
  x.state.watch.tasks.a="watch";assert.equal(x.camp.fatigue("a"),"forage");
  x.state.watch.campId="next";assert.equal(setupWork(x.state.watch,"a","watch"),null);
  assert.equal(setupWork({},"a","forage"),"forage");assert.equal(setupWork(undefined,"a"),null);
});

test("everyone can opt out while keeping their setup jobs and the no-watch warning",async()=>{
  const x=setup();x.state.watch.scene=null;
  for(const actor of x.actors)await x.camp.change({dataset:{camp:"watch-duty",id:actor.id},checked:false});
  assert.deepEqual(x.camp.plan().watches,[]);
  assert.equal(x.state.watch.tasks.a,"forage");
  x.camp.setupView="watches";
  const html=x.camp.html({status:"decide",night:1,since:0,limit:8});
  assert.match(html,/No one keeps watch/);
});

test("a shared watch stops tiring a worker when their own part of the shift ends",()=>{
  const x=setup();x.state.watch.join={b:true};x.state.watch.hours.b=4;
  game.time.worldTime=5*H;assert.equal(x.camp.fatiguedOnWatch("a"),true);assert.equal(x.camp.fatiguedOnWatch("b"),true);
  game.time.worldTime=7*H;assert.equal(x.camp.fatiguedOnWatch("a"),false);assert.equal(x.camp.fatiguedOnWatch("b"),true);
});

test("watch requests carry disadvantage through the native roll, while setup requests stay normal",async()=>{
  const x=setup();x.state.watch.asks={watch:{campId:"camp",requestId:"request",actor:"a",skill:"prc",night:1,dc:15,disadvantage:true}};
  const calls=[];x.actors[0].rollSkill=async(...args)=>calls.push(args);
  const tag=campRequest(x.state,x.scene.id,"watch","a","prc");await rollCampRequest(tag);
  assert.equal(calls[0][0].disadvantage,true);assert.equal(calls[0][0].target,15);
  assert.deepEqual(calls[0][2].data.flags["kg-realms"].campRoll,tag);
  x.state.watch.checks.forage={campId:"camp",asked:1,requests:{a:"forage"},rolls:{},dc:10};
  await rollCampRequest(campRequest(x.state,x.scene.id,"forage","a","sur"));
  assert.equal(calls[1][0].disadvantage,undefined);
  foundry.utils.isNewerVersion=()=>false;await rollCampRequest(tag);assert.equal(calls[2][1].disadvantage,true);
});

test("the GM records fatigue on the watch request and practice rolls two dice keeping the lower",async()=>{
  const x=setup(),e={id:"e",dc:15,rest:{night:1,at:5,watch:0}};x.state.encounters=[e];game.time.worldTime=5*H;
  x.setProgress({status:"encounter",camp:true,night:1,since:5*H,campStart:0,encounter:e});
  globalThis.ChatMessage={create:()=>{}};
  await x.camp.click({dataset:{camp:"ask",key:"watch"}});assert.equal(x.state.watch.asks.watch.disadvantage,true);
  const practiceState=structuredClone(x.state);x.camp.practice={state:practiceState,clock:5*H,camped:0};x.camp.renderScene=()=>{};
  let formula;globalThis.Roll=class{constructor(f){formula=f;}async evaluate(){return{total:7};}};
  await x.camp.click({dataset:{camp:"roll",key:"watch"}});assert.equal(formula,"2d20kl + @mod");
  assert.equal(practiceState.watch.asks.watch.total,7);assert.equal(x.state.watch.asks.watch.total,null);
});
