import {bypassPartyEncounter} from '../scripts/party-encounters.mjs';
import {testScene} from './helpers/journey.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CityFleet} from '../scripts/city/fleet.mjs';
import {CityTransit} from '../scripts/city/transit.mjs';
import {gmGame} from './helpers/journey.mjs';
import {TravelHud} from '../scripts/ui-hud.mjs';
import {replayTrip} from '../scripts/travel.mjs';
const collection=rows=>{rows.get=id=>rows.find(x=>x.id===id);return rows;};
function setup(){
 const actors=collection(['a','b'].map(id=>({id,name:id,type:'character',system:{currency:{gp:10}},flags:{},getFlag(m,k){return this.flags[k]}})));
 const groups=actors.map((a,i)=>({id:'g'+i,type:'group',name:'Party '+i,system:{members:[{actor:a}]}}));
 const tokens=collection(groups.map((actor,i)=>({id:'t'+i,actor,actorId:actor.id,name:actor.name,x:100+i*200,y:100,width:1,height:1})));
 const roads={schema:1,roads:[{id:'road',name:'Main avenue',kind:'avenue',points:[[100,150],[2000,150]]}]},scene={id:'city',tokens,notes:new Map(),width:2200,height:1000,grid:{size:100,distance:100,units:'ft'},getFlag:()=>roads,async updateEmbeddedDocuments(type,updates){for(const u of updates)Object.assign(tokens.get(u._id),u);}};
 const values=new Map([['cityTransit',{schema:2,trips:{}}],['priceScale','d10']]),advances=[];
 gmGame({actors,scenes:new Map([['city',scene]]),time:{worldTime:100,async advance(dt){advances.push(dt);this.worldTime+=dt;}},settings:{get:(m,k)=>values.get(k)??'',async set(m,k,v){values.set(k,structuredClone(v));}}});
 globalThis.canvas={scene,tokens:{controlled:[]}};let id=0;globalThis.foundry={utils:{randomID:()=>`trip${id++}`,escapeHTML:String}};
 globalThis.Actor={async updateDocuments(updates){for(const u of updates){const a=actors.get(u._id);if(u['system.currency'])a.system.currency=u['system.currency'];if(u['flags.kg-realms.cityFare'])a.flags.cityFare=u['flags.kg-realms.cityFare'];}}};
 const fleet=new CityFleet();return{fleet,scene,tokens,actors,advances};
}
test('simultaneous settlement rides preserve both records, charge separate riders and advance one clock',async()=>{
 const f=setup(),a=f.fleet.worker('g0'),b=f.fleet.worker('g1');
 await Promise.all([a.start(f.scene,{x:1600,y:150},{mode:'mixed',riderIds:['a']}),b.start(f.scene,{x:1900,y:150},{mode:'mixed',riderIds:['b']})]);
 assert.equal(f.fleet.active().length,2);assert.equal(a.ride.riders[0].id,'a');assert.equal(b.ride.riders[0].id,'b');assert.equal(a.ride.payments[0].amount,5);
 const rate=f.fleet.rate;f.fleet.lastTick=performance.now()-1000;f.fleet.lastCommit=-100000;f.fleet.pending=0;await f.fleet.tick();
 assert.deepEqual(f.advances,[Math.floor(rate)]);assert.ok(f.tokens[0].x>100);assert.ok(f.tokens[1].x>300);assert.equal(a.ride.tokens.length,1);assert.equal(a.ride.tokens[0].id,'t0');
});
test('concurrent rides reject a member travelling in both parties and share one clock',async()=>{
 const f=setup();await f.fleet.worker('g0').start(f.scene,{x:1600,y:150},{mode:'walk',riderIds:['a']});await f.fleet.worker('g1').start(f.scene,{x:1900,y:150},{mode:'walk',riderIds:['b']});
 f.fleet.drive=()=>{};f.fleet.changed();
 assert.throws(()=>f.fleet.assertRiders('g1',['a']),/already travelling/);
 // One clock: a speed set for one party is the speed for every moving party.
 await f.fleet.worker('g0').setSpeed(4);assert.equal(f.fleet.ride('g0').rate,4);assert.equal(f.fleet.ride('g1').rate,4);assert.equal(f.fleet.rate,4);
});
test('with Calendaria, trips run on its clock at their speed, and its own speed and state come back afterwards',async()=>{
 const f=setup(),values=new Map([['timeSpeedMultiplier',60],['timeSpeedIncrement','minute']]),kept=new Map();
 const clock={running:false,locked:false,realTimeSpeed:3600,predictedWorldTime:100,start(){this.running=true;},stop(){this.running=false;},loadSpeedFromSettings(){this.realTimeSpeed=values.get('timeSpeedMultiplier')*(values.get('timeSpeedIncrement')==='second'?1:60);}};
 game.modules={get:id=>id==='calendaria'?{active:true,api:{managers:{TimeClock:clock}}}:undefined};
 const base=game.settings;game.settings={get:(m,k)=>m==='calendaria'?values.get(k):k==='cityClockBefore'?kept.get(k)??{}:base.get(m,k),set:async(m,k,v)=>{if(m==='calendaria')values.set(k,v);else if(k==='cityClockBefore')kept.set(k,v);else return base.set(m,k,v);}};
 await f.fleet.worker('g0').start(f.scene,{x:1600,y:150},{mode:'walk',riderIds:['a']});
 await f.fleet.calendaria((await import('../scripts/city/transit.mjs')).calendariaClock(),true);
 assert.equal(clock.running,true);assert.equal(clock.realTimeSpeed,1);assert.equal(values.get('timeSpeedIncrement'),'second');
 await f.fleet.worker('g0').setSpeed(3);assert.equal(clock.realTimeSpeed,3);
 await f.fleet.calendaria((await import('../scripts/city/transit.mjs')).calendariaClock(),false);
 assert.equal(clock.running,false);assert.equal(values.get('timeSpeedMultiplier'),60);assert.equal(values.get('timeSpeedIncrement'),'minute');
 delete game.modules;game.settings=base;
});
test('selection is mandatory for a city containing multiple parties',()=>{
 const f=setup();assert.throws(()=>f.fleet.selected(f.scene),/Select one party/);canvas.tokens.controlled=[{document:f.tokens[1],actor:f.tokens[1].actor}];assert.equal(f.fleet.selected(f.scene).partyId,'g1');
});
test('unfocused overland parties spend scheduled rest and stays without watch decisions, but stop for encounters',()=>{
 const state={trip:{departed:0,decisions:[],resumed:{}},hours:8,rest:16},scene={getFlag:()=>state};gmGame({time:{worldTime:30*3600}});
 const hud=new TravelHud({headless:true,getScene:()=>scene});hud.unfocused=true;hud.plan={hours:40,encounters:[],stays:[]};const p=hud.progress();assert.equal(p.hour,14);assert.equal(p.status,'moving');assert.deepEqual(p.made,[{rest:16}]);
 hud.plan.encounters=[{id:'ambush',hour:10}];const held=hud.progress();assert.equal(held.status,'encounter');assert.equal(held.hour,10);
 hud.unfocused=false;assert.equal(hud.progress().status,'decide');
});

test('bypassing a background encounter requires a reason and records it only on the current held encounter',async()=>{
 setup();const state={trip:{departed:0,resumed:{}},now:{status:'encounter',encounter:{id:'ambush'}}},scene=testScene(state);
 await assert.rejects(bypassPartyEncounter(scene,{id:'ambush'},'  '),/resolution reason/);
 assert.equal(await bypassPartyEncounter(scene,{id:'old'},'Paid a toll'),false);assert.equal(scene.writes.length,0);
 assert.equal(await bypassPartyEncounter(scene,{id:'ambush',name:'Toll patrol'},'Paid a toll'),true);assert.equal(state.trip.resumed.ambush,100);assert.equal(state.trip.bypassedEncounters[0].reason,'Paid a toll');
 game.user.isGM=false;assert.equal(await bypassPartyEncounter(scene,{id:'ambush'},'Other reason'),false);
});

test('racing departures cannot charge a character belonging to two different groups twice',async()=>{
 const f=setup();f.tokens[1].actor.system.members=[{actor:f.actors[0]}];
 const results=await Promise.allSettled([f.fleet.worker('g0').start(f.scene,{x:1600,y:150},{mode:'mixed',riderIds:['a']}),f.fleet.worker('g1').start(f.scene,{x:1800,y:150},{mode:'mixed',riderIds:['a']})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.fleet.active().length,1);
});

test('publishing a fleet update never mutates the cached setting before Foundry broadcasts it',async()=>{
 const f=setup(),before=f.fleet.state();await f.fleet.write('g0',{id:'new',phase:'complete'});assert.deepEqual(before.trips,{});assert.equal(f.fleet.state().trips.g0.id,'new');
});
