import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CityTransit,cityFeetPerPixel} from '../scripts/city/transit.mjs';
import {walletValue} from '../scripts/city/money.mjs';
import {gmGame} from './helpers/journey.mjs';
function setup({fail=false,economy='x1'}={}){
  const values=new Map([['cityTransit',{}],['priceScale',economy]]),writes=[];
  const actors=new Map(['a','b'].map(id=>[id,{id,name:id,type:'character',img:'x.webp',system:{currency:{gp:1}},flags:{},getFlag(m,k){return this.flags[k]}}]));
  const group={type:'group',system:{members:[...actors.values()].map(actor=>({actor}))}};
  const token={id:'party',uuid:'Scene.city.Token.party',name:'Party',x:-50,y:-50,width:1,height:1,actor:group};
  const tokens=new Map([['party',token]]);tokens[Symbol.iterator]=function*(){yield* this.values()};
  const roads={schema:1,revision:1,roads:[{id:'road',name:'Avenue',kind:'avenue',points:[[0,0],[2000,0]]}]};
  const scene={id:'city',width:3000,height:1000,grid:{size:100,distance:100,units:'ft'},tokens,notes:new Map(),getFlag(m,k){if(k==='cityRoads')return roads;if(k==='partyToken')return token.uuid;return{world:'toril'};},async updateEmbeddedDocuments(type,updates,options){writes.push({type,updates,options});for(const u of updates)Object.assign(tokens.get(u._id),u);}};
  gmGame({actors,scenes:new Map([['city',scene]]),settings:{get:(m,k)=>values.get(k)??'',set:async(m,k,v)=>{values.set(k,structuredClone(v));}},time:{worldTime:1000,async advance(n){assert.equal(n,Math.floor(n));this.worldTime+=n;}}});
  let ids=0;globalThis.foundry={utils:{randomID:()=>`trip-${ids++}`}};
  let batches=0;globalThis.Actor={async updateDocuments(updates){batches++;for(const [i,u]of updates.entries()){const a=actors.get(u._id);if(u['system.currency'])a.system.currency=structuredClone(u['system.currency']);if('system.currency.cp'in u)a.system.currency.cp=u['system.currency.cp'];if(u['flags.kg-realms.cityFare'])a.flags.cityFare=u['flags.kg-realms.cityFare'];if('flags.kg-realms.-=cityFare'in u)delete a.flags.cityFare;if(fail&&batches===1&&i===0)throw Error('Lost reply after one payment');}}};
  return{controller:new CityTransit(),values,actors,scene,writes,batches:()=>batches};
}
test('the scene-designated party token is always the origin, and the economy fare charges each rider',async()=>{
  const f=setup({economy:'d10'}),p=f.controller.preview(f.scene,{x:2000,y:0},'mixed');assert.deepEqual(p.plan.start,[0,0]);
  await f.controller.start(f.scene,{x:2000,y:0},{mode:'mixed',riderIds:['a','b'],quote:p.quote});
  assert.equal(f.controller.ride.phase,'travelling');assert.equal(f.controller.ride.fare.total,10);assert.equal(f.batches(),1);
  assert.equal(walletValue(f.actors.get('a').system.currency),95);assert.equal(game.time.worldTime,1000);
  await assert.rejects(()=>f.controller.resumeBoarding(),/no longer boarding/);assert.equal(f.batches(),1);
});
test('a lost payment reply resumes only unpaid riders and never charges a marked actor twice',async()=>{
  const f=setup({fail:true});await assert.rejects(()=>f.controller.start(f.scene,{x:2000,y:0},{mode:'mixed',riderIds:['a','b']}),/Lost reply/);
  assert.equal(f.controller.ride.phase,'boarding');assert.equal(walletValue(f.actors.get('a').system.currency),50);assert.equal(walletValue(f.actors.get('b').system.currency),100);
  const replacement=new CityTransit();await replacement.resumeBoarding();
  assert.equal(replacement.ride.phase,'travelling');assert.equal(walletValue(f.actors.get('a').system.currency),50);assert.equal(walletValue(f.actors.get('b').system.currency),50);
});
test('cancelling incomplete boarding refunds confirmed charges once without replacing later wallet changes',async()=>{
  const f=setup({fail:true});await assert.rejects(()=>f.controller.start(f.scene,{x:2000,y:0},{mode:'mixed',riderIds:['a','b']}));
  f.actors.get('a').system.currency.cp=7;await f.controller.stop();assert.equal(walletValue(f.actors.get('a').system.currency),107);assert.equal(walletValue(f.actors.get('b').system.currency),100);
  await f.controller.stop();assert.equal(walletValue(f.actors.get('a').system.currency),107);
});
test('waived fares and foot travel never update character currency',async()=>{
  for(const options of [{mode:'mixed',waive:true},{mode:'walk'}]){const f=setup();await f.controller.start(f.scene,{x:2000,y:0},{...options,riderIds:['a','b']});assert.equal(f.batches(),0);assert.equal(f.controller.ride.fare.total,0);}
});
test('insufficient money, stale quotes, unauthorized controls and non-party riders stop before payment',async()=>{
  const f=setup(),p=f.controller.preview(f.scene,{x:2000,y:0},'mixed');f.values.set('priceScale','x2');
  await assert.rejects(()=>f.controller.start(f.scene,{x:2000,y:0},{mode:'mixed',riderIds:['a'],quote:p.quote}),/fare changed/);
  f.actors.get('a').system.currency={cp:1};await assert.rejects(()=>f.controller.start(f.scene,{x:2000,y:0},{mode:'mixed',riderIds:['a']}),/cannot afford/);
  await assert.rejects(()=>f.controller.start(f.scene,{x:2000,y:0},{riderIds:['not-party']}),/current party/);
  game.user.isGM=false;await assert.rejects(()=>f.controller.start(f.scene,{x:2000,y:0},{riderIds:['b']}),/primary GM/);assert.equal(f.batches(),0);
});
test('arrival advances only remaining whole seconds and moves the designated token to the route end',async()=>{
  const f=setup();await f.controller.start(f.scene,{x:2000,y:0},{mode:'walk',riderIds:['a']});
  f.controller.pending=10000;f.controller.lastTick=performance.now();f.controller.lastCommit=0;await f.controller.tick();
  assert.equal(f.controller.ride.phase,'complete');assert.equal(game.time.worldTime,1000+f.controller.ride.plan.seconds);
  assert.equal(f.scene.tokens.get('party').x,1950);assert.equal(f.scene.tokens.get('party').y,-50);
  assert.equal(f.writes[0].options.animation.duration,400);
});
test('trips start in real time, glide each second, and commit the clock only every ten seconds',async()=>{
  const f=setup();await f.controller.start(f.scene,{x:2000,y:0},{mode:'walk',riderIds:['a']});
  assert.equal(f.controller.ride.rate,1);
  const c=f.controller;c.lastCommit=performance.now();c.lastMove=-Infinity;c.lastTick=performance.now()-1000;await c.tick();
  assert.equal(game.time.worldTime,1000,'no clock commit after one second');assert.equal(f.writes.length,1);assert.equal(f.writes[0].options.animation.duration,1000);
  const x1=f.scene.tokens.get('party').x;assert.ok(x1>-50,'the token moved on the uncommitted time');
  c.lastCommit=-Infinity;c.lastMove=-Infinity;c.lastTick=performance.now()-1000;await c.tick();
  assert.equal(game.time.worldTime,1002,'the clock catches up when it commits');assert.ok(f.scene.tokens.get('party').x>x1);
});
test('the speed can be set from 1x to 5x during a trip',async()=>{
  const f=setup();await f.controller.start(f.scene,{x:2000,y:0},{mode:'walk',riderIds:['a']});
  await f.controller.setSpeed(3);assert.equal(f.controller.ride.rate,3);await f.controller.setSpeed(9);assert.equal(f.controller.ride.rate,5);
});
test('grid distance conversion supports feet, metric and miles and rejects unknown units',()=>{
  assert.equal(cityFeetPerPixel({grid:{size:100,distance:100,units:'ft'}}),1);
  assert.equal(cityFeetPerPixel({grid:{size:100,distance:1,units:'mi'}}),52.8);
  assert.ok(Math.abs(cityFeetPerPixel({grid:{size:100,distance:100,units:'m'}})-3.280839895)<1e-8);
  assert.throws(()=>cityFeetPerPixel({grid:{size:100,distance:1,units:'squares'}}),/grid distance/);
});

test('a paused trip excludes outside clock changes and can resume without another payment',async()=>{
  const f=setup();await f.controller.start(f.scene,{x:2000,y:0},{mode:'mixed',riderIds:['a','b']});
  game.time.worldTime+=20;f.controller.pending=3.8;await f.controller.pause();
  assert.equal(f.controller.ride.phase,'paused');assert.equal(f.controller.ride.elapsed,23);
  const paid=f.batches();game.time.worldTime+=500;await f.controller.pause();
  assert.equal(f.controller.ride.phase,'travelling');assert.equal(game.time.worldTime-f.controller.ride.started,23);assert.equal(f.batches(),paid);
  const reconnect=new CityTransit();assert.equal(reconnect.elapsed(),23);assert.equal(reconnect.ride.id,f.controller.ride.id);
});
test('Arrive now spends exactly the rest of the trip, including uncommitted time, and ends at the destination',async()=>{
  const f=setup();await f.controller.start(f.scene,{x:2000,y:0},{mode:'walk',riderIds:['a']});
  f.controller.pending=20.9;await f.controller.arriveNow();
  assert.equal(game.time.worldTime,1000+f.controller.ride.plan.seconds);assert.equal(f.controller.ride.phase,'complete');
  assert.equal(f.scene.tokens.get('party').x,1950);assert.equal(f.controller.pending,0);
});
test('stopping mid-trip advances only elapsed time, not the rest of the route',async()=>{
  const f=setup();await f.controller.start(f.scene,{x:2000,y:0},{mode:'walk',riderIds:['a']});
  game.time.worldTime+=20;f.controller.pending=5.5;await f.controller.stop();
  assert.equal(game.time.worldTime,1025);assert.equal(f.controller.ride.elapsed,25);assert.equal(f.controller.ride.phase,'stopped');
  assert.ok(f.scene.tokens.get('party').x<1950);
});
test('NPC companions in the designated party roster are riders too',async()=>{
  const f=setup();f.actors.get('b').type='npc';assert.equal(f.controller.members(f.scene).length,2);
  await f.controller.start(f.scene,{x:2000,y:0},{mode:'mixed',riderIds:['a','b']});assert.equal(f.controller.ride.fare.total,100);assert.equal(walletValue(f.actors.get('b').system.currency),50);
});
test('an existing KG Transit ride cannot run a second settlement travel clock',async()=>{
  const f=setup();game.modules=new Map([['kg-transit',{active:true}]]);game.settings.settings=new Map([['kg-transit.activeRide',{}]]);
  const get=game.settings.get;game.settings.get=(m,k)=>m==='kg-transit'&&k==='activeRide'?{id:'rail-trip'}:get(m,k);
  await assert.rejects(()=>f.controller.start(f.scene,{x:2000,y:0},{mode:'walk',riderIds:['a']}),/current KG Transit ride/);assert.equal(f.batches(),0);
});
test('stopping before reaching the first coach refunds the booked fare',async()=>{
  const f=setup(),data=f.scene.getFlag('kg-realms','cityRoads');data.roads=[{id:'lane',name:'Lane',kind:'lane',points:[[0,0],[500,0]]},{id:'street',name:'Street',kind:'street',points:[[500,0],[2000,0]]}];
  await f.controller.start(f.scene,{x:2000,y:0},{mode:'mixed',riderIds:['a','b']});assert.equal(walletValue(f.actors.get('a').system.currency),50);
  await f.controller.stop();assert.equal(walletValue(f.actors.get('a').system.currency),100);assert.equal(f.controller.ride.phase,'stopped');
});
test('stopping in a first coach refunds a later coach but retains the used ride fare',async()=>{
  const f=setup(),data=f.scene.getFlag('kg-realms','cityRoads');data.roads=[{id:'first',name:'First street',kind:'street',points:[[0,0],[800,0]]},{id:'lane',name:'Lane',kind:'lane',points:[[800,0],[1000,0]]},{id:'second',name:'Second street',kind:'street',points:[[1000,0],[2000,0]]}];
  await f.controller.start(f.scene,{x:2000,y:0},{mode:'mixed',riderIds:['a']});assert.equal(f.controller.ride.plan.boardingCount,2);assert.equal(walletValue(f.actors.get('a').system.currency),0);
  game.time.worldTime+=20;await f.controller.stop();assert.equal(walletValue(f.actors.get('a').system.currency),50);
});
test('a lost refund reply leaves the clock stopped and cannot credit the same refund twice',async()=>{
  const f=setup({fail:true});await assert.rejects(()=>f.controller.start(f.scene,{x:2000,y:0},{mode:'mixed',riderIds:['a','b']}));
  const normal=Actor.updateDocuments;Actor.updateDocuments=async updates=>{await normal(updates);throw Error('Lost refund reply');};
  await assert.rejects(()=>f.controller.stop(),/Lost refund/);assert.equal(f.controller.ride.phase,'stopping');assert.equal(walletValue(f.actors.get('a').system.currency),100);
  Actor.updateDocuments=normal;const replacement=new CityTransit();await replacement.stop();assert.equal(replacement.ride.phase,'stopped');assert.equal(walletValue(f.actors.get('a').system.currency),100);
});
