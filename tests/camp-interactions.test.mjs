import { test } from "node:test";
import assert from "node:assert/strict";
import { CampPanel } from "../scripts/ui-camp.mjs";
import { TravelHud } from "../scripts/ui-hud.mjs";
import { campPhases } from "../scripts/camp.mjs";
import { replayTrip } from "../scripts/travel.mjs";
import { writeJourney } from "../scripts/journey-write.mjs";
import { skillBonus, campRequest } from "../scripts/camp-rolls.mjs";
import { HARMLESS_WATCH_OUTCOMES, WATCH_ROLL_MS, ambientWatchResult } from "../scripts/watch-outcomes.mjs";
import { watchResultsHtml, rollingWatchHtml } from "../scripts/watch-roll-view.mjs";
import { travelRules, ruleTooltip, ruleContent } from "../scripts/travel-rules.mjs";
import { encounterTimeRemaining, randomCampEscape } from "../scripts/camp-resolution.mjs";
import { pastTaskSummary } from "../scripts/camp-tasks.mjs";
import { gmGame, testScene } from "./helpers/journey.mjs";
const H=3600;

function setup() {
  gmGame();globalThis.foundry={utils:{randomID:()=>Math.random().toString(),escapeHTML:s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;'),deepClone:structuredClone}};
  game.settings.get=(m,k)=>["advancedWatches","taskForage","taskConceal","taskAlarm"].includes(k);game.messages=new Map();
  const actors=["a","b","c","d"].map(id=>({id,name:id,isOwner:true,items:[],system:{skills:{sur:{total:2},ste:{total:-1},slt:{total:3},prc:{total:4,passive:14}},details:{race:"Human"}}}));
  game.actors={get:id=>actors.find(a=>a.id===id)};game.modules=new Map([["rest-recovery",{active:true}]]);let recoveries=0;
  game.restrecovery={promptRest:()=>{recoveries++;return true;}};
  globalThis.ui={notifications:{info:()=>{},warn:()=>{}}};globalThis.ChatMessage={create:()=>{}};
  globalThis.Roll=class{async evaluate(){return{total:2};}};
  const started=18*H,state={rest:16,trip:{departed:10*H,decisions:[{rest:16,started}],resumed:{},halts:[]},watch:{campId:"camp",setup:1,phases:{...campPhases(),campId:"camp"},tasks:{a:"alarm"},hours:{a:2,b:2,c:2,d:2},checks:{campId:"camp",night:1},scene:{night:1,step:"w0",hold:true}},encounters:[{id:"e",dc:15,rest:{night:1,at:5,watch:0}},{id:"future",rest:{night:1,at:7,watch:1,pending:true}}]};
  const scene=testScene(state), plan=()=>({hours:40,stays:[],encounters:state.encounters});game.scenes={get:()=>scene};game.time.worldTime=started+5*H;
  const hud={scene,state,leader:true,get clock(){return game.time.worldTime;},members:()=>actors,progress:()=>replayTrip(state.trip,plan(),game.time.worldTime),save:c=>writeJourney(scene,()=>c),advanceClock:async dt=>game.time.worldTime+=dt,ruleText:()=>travelRules(),planCampEscape:async distance=>({at:[111,222],origin:[100,200],distance,returnSeconds:7200})};
  const camp=new CampPanel(hud);camp.waitForWatch=async()=>{};
  const click=(campAction,extra={})=>camp.click({dataset:{camp:campAction,...extra}});
  const resolve=async(kind,minutes=60)=>{camp.change({dataset:{camp:"encounter-resolution"},value:kind});camp.change({dataset:{camp:"encounter-duration"},value:minutes});return click("scene-carry");};
  camp.renderScene=()=>{};
  return{state,scene,hud,camp,actors,started,click,resolve,recoveries:()=>recoveries};
}

test("unqueued watches roll for two seconds and a harmless 1 never creates an encounter",async()=>{
  const x=setup();x.state.encounters=[];x.state.watch.tasks={};x.state.watch.scene.step="camp";game.time.worldTime=x.started;
  let calls=0;globalThis.Roll=class{async evaluate(){calls++;return{total:1};}};
  await x.click("scene-next",{step:"w0"});
  const r=x.state.watch.reveals[0];assert.equal(WATCH_ROLL_MS,2000);assert.equal(r.results[0].roll,1);assert.equal(r.results[0].harmless,true);assert.ok(r.results[0].text);
  assert.equal(calls,1);assert.deepEqual(x.state.encounters,[]);assert.equal(x.hud.progress().status,"resting");
  assert.ok(HARMLESS_WATCH_OUTCOMES.length>=20);assert.equal(new Set(HARMLESS_WATCH_OUTCOMES).size,HARMLESS_WATCH_OUTCOMES.length);
});

test("a real 1 stays on its result until the GM continues, without rerolling",async()=>{
  const x=setup();x.state.watch.tasks={};x.state.encounters=[{id:"e",rest:{night:1,pending:true,rolls:[]}}];x.state.watch.scene.step="camp";game.time.worldTime=x.started;
  let calls=0;globalThis.Roll=class{async evaluate(){calls++;return{total:1};}};
  await x.click("scene-next",{step:"w0"});const reveal=x.state.watch.reveals[0];
  assert.equal(reveal.results[0].harmless,undefined);assert.equal(x.state.trip.resumed.e,undefined);
  await x.click("scene-next",{step:"w1"});assert.equal(x.state.watch.scene.step,"w0");
  await x.click("watch-continue",{reveal:"stale"});assert.equal(reveal.seen,undefined);
  await x.click("watch-continue",{reveal:reveal.id});assert.equal(x.state.watch.reveals[0].seen,true);assert.equal(calls,1);assert.equal(x.hud.progress().status,"encounter");
});

test("landed dice show the actual result, red harmless failures and no hidden GM detail",()=>{
  setup();assert.match(watchResultsHtml([ambientWatchResult(4,1,()=>0)]),/Harmless failure/);
  assert.match(watchResultsHtml([{die:4,roll:3}]),/>3<\/span>/);
  assert.match(watchResultsHtml([{die:4,roll:1}]),/Something lurks just beyond the firelight/);
  assert.doesNotMatch(watchResultsHtml([{die:4,roll:1,text:"secret"}],{hidden:true}),/secret|Something lurks|Rolled 1/);
  assert.match(rollingWatchHtml({id:"roll",until:Date.now()+2000},[4]),/duration:2000ms/);
});

test("an automatic alarm succeeds without requesting a roll and records the GM's reason",async()=>{
  const x=setup();game.time.worldTime=x.started;x.state.watch.scene.step="alarm";
  x.camp.change({dataset:{camp:"override-reason",kind:"task",key:"alarm"},value:"Alarm scroll covered the camp"});
  await x.click("task-override",{key:"alarm",result:"success",campId:"camp"});
  const c=x.state.watch.checks.alarm;assert.equal(c.done,true);assert.equal(c.result.success,true);assert.equal(c.asked,undefined);
  assert.equal(c.override.reason,"Alarm scroll covered the camp");assert.equal(c.override.automatic,true);assert.equal(x.camp.campEffects(1).alarm,true);
  assert.equal(campRequest(x.state,x.scene.id,"alarm","a","sur"),null);
});

test("overrides preserve the original roll, cannot be issued by players or from an old camp",async()=>{
  const x=setup();game.time.worldTime=x.started;x.state.watch.scene.step="alarm";
  x.state.watch.checks.alarm={campId:"camp",asked:1,leader:"a",dc:12,rolls:{a:{total:4,skill:"sur"}}};
  await x.click("task-override",{key:"alarm",result:"success",campId:"old"});assert.equal(x.state.watch.checks.alarm.done,undefined);
  game.user.isGM=false;await x.click("task-override",{key:"alarm",result:"success",campId:"camp"});assert.equal(x.state.watch.checks.alarm.done,undefined);
  game.user.isGM=true;await x.click("task-override",{key:"alarm",result:"success",campId:"camp"});
  assert.equal(x.state.watch.checks.alarm.rolls.a.total,4);assert.equal(x.state.watch.checks.alarm.override.automatic,false);
});

test("watch perception can be automatically failed without creating a false roll",async()=>{
  const x=setup();x.camp.change({dataset:{camp:"override-reason",kind:"check",key:"watch"},value:"The watcher was distracted"});
  await x.click("check-override",{key:"watch",result:"failure",campId:"camp"});
  const c=x.state.watch.asks.watch;assert.equal(c.done,true);assert.equal(c.success,false);assert.equal(c.total,undefined);assert.equal(c.override.reason,"The watcher was distracted");
});

test("button bonuses keep positive, zero and negative values, and task summaries are past tense",()=>{
  const x=setup();assert.equal(skillBonus(x.actors[0],"sur"),"(+2)");assert.equal(skillBonus(x.actors[0],"ste"),"(-1)");assert.equal(skillBonus(x.actors[0],"unknown"),"(+0)");
  assert.equal(pastTaskSummary("alarm",{success:true}),"Alarms were set.");assert.match(pastTaskSummary("conceal",{successes:0}),/was not concealed/);
});

test("rule tooltips contain labelled paragraphs rather than one text block",()=>{
  const R=travelRules();assert.ok((R.alarm.match(/<p>/g)??[]).length>=3);assert.match(R.alarm,/<strong>Check<\/strong>/);assert.match(ruleTooltip(R.alarm),/data-tooltip-class="kgr-rule-tip"/);
  assert.match(travelRules("2024").rest,/one additional hour per interruption/);
  assert.doesNotMatch(ruleContent('<p><img src=x onerror=alert(1)>Text</p>'),/<img/);
  assert.match(ruleTooltip(travelRules().sleep),/aria-label="[^"]*Sentry&#39;s/);
});

test("encounter duration adds only time not already passed, then watches continue",async()=>{
  const x=setup();game.time.worldTime+=30*60;await x.resolve("continue",60);
  assert.equal(game.time.worldTime,x.started+6*H);assert.equal(x.state.trip.resumed.e,x.started+6*H);assert.equal(x.hud.progress().until,x.started+17*H);
  assert.equal(x.state.encounters[1].rest.pending,true);assert.equal(x.recoveries(),0);assert.equal(encounterTimeRemaining(100,0,1),0);
});

test("ending watches completes the remaining rest once and suppresses later camp encounters",async()=>{
  const x=setup();await x.resolve("complete",60);
  assert.equal(game.time.worldTime,x.started+13*H);assert.equal(x.state.watch.scene.step,"recovery");assert.equal(x.state.encounters[1].rest.quiet,true);
  assert.equal(x.recoveries(),0);await x.click("camp-recover");assert.equal(x.recoveries(),1);assert.equal(x.state.watch.scene.step,"pack");
});

test("interrupted rest skips recovery and preserves exactly four hours for packing",async()=>{
  const x=setup();await x.resolve("interrupted",60);
  assert.equal(game.time.worldTime,x.started+6*H);assert.equal(x.state.watch.scene.step,"pack");assert.equal(x.hud.progress().until,x.started+10*H);
  await x.click("scene-break");assert.equal(game.time.worldTime,x.started+10*H);assert.equal(x.recoveries(),0);assert.equal(x.state.trip.campEnds[1].restComplete,false);
});

test("abandoning camp skips recovery and packing, records displacement, and halts travel",async()=>{
  const x=setup();await x.resolve("abandon",60);
  assert.equal(game.time.worldTime,x.started+6*H);assert.equal(x.state.watch.scene.step,"done");assert.equal(x.hud.progress().status,"halted");
  assert.deepEqual(x.state.trip.escape.at,[111,222]);assert.equal(x.state.trip.escape.distance,5);assert.equal(x.recoveries(),0);
});

test("practice interruption uses its own clock, without adding encounter time twice",async()=>{
  const x=setup(),real=game.time.worldTime;x.camp.practice={state:structuredClone(x.state),camped:x.started,clock:x.started+5*H};
  await x.resolve("interrupted",60);assert.equal(game.time.worldTime,real);assert.equal(x.camp.prog().until,x.started+10*H);
  await x.click("scene-break");assert.equal(game.time.worldTime,real);assert.equal(x.recoveries(),0);
});

test("random fleeing retains the requested miles and avoids disallowed directions",()=>{
  const p=randomCampEscape([0,0],5,.5,([x])=>x>=0,()=>.5);assert.ok(p);assert.equal(p.distance,5);assert.ok(Math.abs(Math.hypot(...p.at)*.5-5)<1e-8);
  assert.equal(randomCampEscape([0,0],5,.5,()=>false),null);
});

test("held encounter cards open once for GMs, while redraws and players cannot reopen them",async()=>{
  const x=setup(),calls=[];const hud=new TravelHud({getScene:()=>x.scene,openEncounter:(...a)=>calls.push(a)});const p=x.hud.progress();
  await hud.openHeldEncounter(p);await hud.openHeldEncounter(p);assert.deepEqual(calls,[["e",true]]);
  game.user.isGM=false;await hud.openHeldEncounter({...p,encounter:{id:"other"}});assert.equal(calls.length,1);
});

test("concluding the same encounter twice cannot add time, move twice or request recovery",async()=>{
  const x=setup();await x.resolve("abandon",60);const ended=game.time.worldTime;
  await x.click("scene-carry");assert.equal(game.time.worldTime,ended);assert.equal(x.state.watch.resolutions.length,1);assert.equal(x.state.trip.halts.length,1);assert.equal(x.recoveries(),0);
});

test("holding an encounter opens its GM card and bare ambient encounters do not open blank cards",async()=>{
  const x=setup(),seen=[];x.hud.openHeldEncounter=p=>seen.push(p.encounter.id);
  await x.click("scene-hold");assert.deepEqual(seen,["e"]);
  const hud=new TravelHud({getScene:()=>x.scene,openEncounter:()=>seen.push("blank")});
  await hud.openHeldEncounter({...x.hud.progress(),encounter:{id:"ambient",generic:true}});assert.deepEqual(seen,["e"]);
  await hud.openHeldEncounter({...x.hud.progress(),encounter:{id:"illustrated",generic:true,img:"camp.webp"}});assert.deepEqual(seen,["e","blank"]);
});

test("camp activity requests inherit the local biome DC while explicit GM DCs win",async()=>{
  const x=setup();game.time.worldTime=x.started;x.state.watch.scene.step="alarm";
  x.hud.currentBiome=()=>({type:"taiga",name:"Cold Wood",dc:{forage:22,conceal:13,alarm:8}});
  assert.equal(x.camp.defaultTaskDc("forage"),22);await x.click("task-ask",{key:"alarm"});assert.equal(x.state.watch.checks.alarm.dc,8);
  x.state.watch.checks.alarm={campId:"camp",dc:17};await x.click("task-ask",{key:"alarm"});assert.equal(x.state.watch.checks.alarm.dc,17);
});
