import { test } from "node:test";
import assert from "node:assert/strict";
import { CampPanel } from "../scripts/ui-camp.mjs";
import { TravelHud } from "../scripts/ui-hud.mjs";
import { campRequest, matchingCampRequest, rollCampRequest } from "../scripts/camp-rolls.mjs";
import { writeJourney } from "../scripts/journey-write.mjs";
import { gmGame, testScene } from "./helpers/journey.mjs";

function setup() {
  const state={trip:{departed:0},watch:{campId:"new-camp",scene:{night:1,step:"forage"},tasks:{a:"forage",b:"forage"},checks:{campId:"new-camp",night:1,forage:{campId:"new-camp",asked:1,requests:{a:"request-a",b:"request-b"},rolls:{},dc:15}}}};
  const scene=testScene(state);gmGame({scenes:{get:()=>scene}});
  const camp=new CampPanel({});
  const tag=(actor="a")=>campRequest(state,scene.id,"forage",actor,"sur");
  const message=(t,total=15,id="roll-a")=>({id,speaker:{actor:t.actor},flags:{"kg-realms":{campRoll:t}},rolls:[{total}]});
  return{state,scene,camp,tag,message};
}

test("previous camps, reused night numbers, old request IDs and unscoped rolls never count", async () => {
  const {state,scene,camp,tag,message}=setup();const current=tag();
  await camp.onRoll(message({...current,campId:"previous-camp"},20));
  await camp.onRoll(message({...current,requestId:"previous-request"},20));
  await camp.onRoll({speaker:{actor:"a"},flags:{dnd5e:{roll:{skillId:"sur"}}},rolls:[{total:20}],timestamp:Date.now()});
  assert.equal(scene.writes.length,0);
  await camp.onRoll(message(current,15));assert.equal(state.watch.checks.forage.rolls.a.total,15);
  await camp.onRoll(message(current,19));assert.equal(state.watch.checks.forage.rolls.a.total,19);
  state.watch.scene.step="done";await camp.onRoll(message(current,25));assert.equal(state.watch.checks.forage.rolls.a.total,19);
});

test("simultaneous party rolls are retained, and a queued old result cannot restore an old camp", async () => {
  const {state,scene,camp,tag,message}=setup();
  await Promise.all([camp.onRoll(message(tag("a"),17,"a")),camp.onRoll(message(tag("b"),12,"b"))]);
  assert.equal(Object.keys(state.watch.checks.forage.rolls).length,2);
  const old=tag();
  const reset=writeJourney(scene,()=>({watch:{campId:"next-camp",scene:{night:1,step:"camp"},tasks:{a:"forage"},checks:{night:1,campId:"next-camp"}}}));
  const late=camp.onRoll(message(old,30));await Promise.all([reset,late]);
  assert.equal(state.watch.campId,"next-camp");assert.equal(state.watch.checks.forage,undefined);
});

test("an old camp chat button cannot launch a fresh actor roll", async () => {
  const {state,tag}=setup();const old=tag();state.watch.campId="next";
  let warned=0;globalThis.ui={notifications:{info:()=>warned++}};
  await rollCampRequest(old);assert.equal(warned,1);assert.equal(matchingCampRequest(state,old),false);
});

test("clearing a camp or reroll removes saved results under Foundry's merge semantics", async () => {
  const {state,scene}=setup();
  state.watch.checks.forage.rolls={a:{total:20,msg:"old",done:true}};
  state.watch.asks={watch:{total:21,done:true}};
  await writeJourney(scene,()=>({"watch.checks.forage.rolls":{}}));
  assert.deepEqual(state.watch.checks.forage.rolls,{});
  await writeJourney(scene,()=>({watch:{...state.watch,campId:"another-camp",checks:{campId:"another-camp",night:1},asks:{}}}));
  assert.deepEqual(state.watch.checks,{campId:"another-camp",night:1});
  assert.deepEqual(state.watch.asks,{});
  assert.ok(scene.writes.some(p=>Object.keys(p).some(k=>k.endsWith(".-=forage"))));
});

test("camp roll buttons tag the system roll with the exact current request", async () => {
  const {tag}=setup();let received;
  game.actors={get:()=>({isOwner:true,rollSkill:async(...args)=>{received=args;}})};
  game.system={version:"5.3.3"};globalThis.foundry={utils:{isNewerVersion:()=>true}};
  await rollCampRequest(tag());
  assert.deepEqual(received[0],{skill:"sur",target:15});
  assert.deepEqual(received[2].data.flags["kg-realms"].campRoll,tag());
});

test("Survival and Stealth choices consume the same request, so concurrent clicks cannot roll both", async () => {
  const {state}=setup();state.watch.tasks.a="conceal";
  state.watch.checks.conceal={campId:state.watch.campId,asked:1,requests:{a:"one-choice"},rolls:{},dc:10};
  game.system={version:"5.3.3"};globalThis.foundry={utils:{isNewerVersion:()=>true}};
  let calls=0,finish;game.actors={get:()=>({isOwner:true,rollSkill:()=>{calls++;return new Promise(r=>finish=r);}})};
  const first=rollCampRequest(campRequest(state,"realm","conceal","a","sur"));
  const second=rollCampRequest(campRequest(state,"realm","conceal","a","ste"));
  assert.equal(calls,1);finish([]);await Promise.all([first,second]);
});

test("making camp twice with the same night number creates new identities and removes every old result", async () => {
  const {state,scene}=setup();let next=0;
  globalThis.foundry={utils:{randomID:()=>`camp-${++next}`,deepClone:structuredClone}};
  const hud=new TravelHud({getScene:()=>scene,getLayer:()=>null});hud.progress=()=>({night:1});
  const panel=hud.camp;panel.members=()=>[];
  await panel.click({dataset:{camp:"setup"}});const first=state.watch.campId;
  state.watch.checks.forage={campId:first,done:true,rolls:{a:{total:30}},result:{success:true}};
  state.watch.asks={watch:{campId:first,total:30,done:true}};
  await panel.click({dataset:{camp:"setup"}});
  assert.notEqual(state.watch.campId,first);assert.equal(state.watch.checks.forage,undefined);assert.deepEqual(state.watch.asks,{});
});

test("watch checks reject previous camps and reroll requests, including late chat updates", async () => {
  const {state,camp,message}=setup();
  state.watch.scene.step="w0";
  state.watch.asks={watch:{campId:state.watch.campId,requestId:"watch-request",actor:"a",skill:"prc",night:1,dc:15}};
  const tag=campRequest(state,"realm","watch","a","prc");
  await camp.onRoll(message({...tag,campId:"old-camp"},25));assert.equal(state.watch.asks.watch.total,undefined);
  await camp.onRoll(message(tag,12));assert.equal(state.watch.asks.watch.total,12);
  state.watch.asks.watch={...state.watch.asks.watch,requestId:"reroll",total:null,msg:null};
  await camp.onRoll(message(tag,29));assert.equal(state.watch.asks.watch.total,null);
  await camp.onRoll(message({...tag,requestId:"reroll"},18,"new-message"));assert.equal(state.watch.asks.watch.total,18);
});

test("a double-click on the next watch starts one encounter roll, and stale next buttons do nothing", async () => {
  gmGame();globalThis.foundry={utils:{randomID:()=>"id"}};
  const state={trip:{departed:0},watch:{campId:"camp",checks:{campId:"camp",night:1},scene:{night:1,step:"camp"}},encounters:[{id:"e",rest:{night:1,pending:true,rolls:[]}}]};
  const scene=testScene(state), p={status:"resting",night:1,since:0,until:57600};let clock=0;
  const hud={scene,state,leader:true,get clock(){return clock;},progress:()=>p,save:async c=>writeJourney(scene,()=>c),advanceClock:async dt=>clock+=dt};
  const camp=new CampPanel(hud);camp.members=()=>[];camp.plan=()=>({rest:16,window:8,watches:[{id:"a",from:0,to:4},{id:"b",from:4,to:8}]});camp.campEffects=()=>({conceal:0});
  camp.waitForWatch=async()=>{};
  let rolls=0,finish;globalThis.Roll=class{evaluate(){rolls++;return new Promise(r=>finish=r);}};
  const button={dataset:{camp:"scene-next",step:"w0"}};
  const first=camp.click(button),second=camp.click(button);await new Promise(setImmediate);assert.equal(rolls,1);
  finish({total:2});await Promise.all([first,second]);await camp.click(button);assert.equal(rolls,1);
});
