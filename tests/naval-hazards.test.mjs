import {test} from 'node:test';
import assert from 'node:assert/strict';
import {hazardDefaults,HAZARD_TYPES,isHazard,isNavalHazard,isRiverHazard,hazardVisible,navalHazardHours,encounterFile,readEncounterFile} from '../scripts/river-hazards.mjs';
import {encounterHours,schedule,itinerary,buildGraph,replayTrip} from '../scripts/travel.mjs';
import {registerKinds} from '../scripts/card-kinds.mjs';
import {worldForExport} from '../scripts/homebrew/export-policy.mjs';
import {RoadEditor} from '../scripts/ui-roads.mjs';
import {RealmLayer} from '../scripts/realm-layer.mjs';
import {gmGame} from './helpers/journey.mjs';

const hazard=(extra={})=>({id:'reef',...hazardDefaults('naval'),at:[5,0],radius:.1,...extra});
const track=kind=>[{at:[0,0],hour:0,kind},{at:[10,0],hour:10}];
const leg=(kind,from=0,to=10)=>({kind,pts:[[from,0],[to,0]],miles:Math.abs(to-from),mph:1});

test('Naval Hazard is a permanent hazard with hidden discovery defaults, separate from river hazards',()=>{
 const e=hazard();assert.equal(HAZARD_TYPES.naval,'Naval Hazard');assert.equal(e.name,'Naval Hazard');
 assert.ok(isHazard(e)&&isNavalHazard(e));assert.equal(isRiverHazard(e),false);
 assert.equal(e.permanent,true);assert.equal(e.autoDiscover,true);assert.equal(hazardVisible(e),false);assert.equal(hazardVisible(e,true),true);
 assert.equal(hazardVisible({...e,visibility:'discovered'}),true);
});

test('only open sea, shipping lanes and trade winds trigger Naval Hazards',()=>{
 for(const kind of ['sea','lane','wind']){const events=encounterHours(track(kind),[hazard()]);assert.equal(events.length,1,kind);assert.equal(events[0].hour,5);assert.equal(events[0].sourceId,'reef');}
 for(const kind of ['road','trail','offroad','river','flying',undefined])assert.deepEqual(encounterHours(track(kind),[hazard()]),[],String(kind));
});

test('a closer land passage cannot steal a later sea encounter',()=>{
 const route=[{at:[0,0],hour:0,kind:'road'},{at:[10,0],hour:10,kind:'road'},{at:[0,.05],hour:20,kind:'sea'},{at:[10,.05],hour:30}];
 const [event]=encounterHours(route,[hazard()]);assert.equal(event.hour,25);
});

test('continuous segments detect tiny hazards between sparse samples and group one passage',()=>{
 const route=[{at:[0,0],hour:0,kind:'sea'},{at:[5,0],hour:5,kind:'lane'},{at:[10,0],hour:10}];
 const found=navalHazardHours(route,hazard({radius:.001}));assert.equal(found.length,1);assert.equal(found[0].hour,5);
 assert.equal(navalHazardHours(track('sea'),hazard({at:[5,1]})).length,0);
});

test('separate sea passages have independent resolution IDs and replay pauses again on return',()=>{
 const route=[...track('sea').slice(0,1),{at:[10,0],hour:10,kind:'road'},{at:[10,10],hour:20,kind:'road'},{at:[10,0],hour:30,kind:'sea'},{at:[0,0],hour:40}];
 const events=encounterHours(route,[hazard()]);assert.deepEqual(events.map(e=>e.hour),[5,35]);assert.notEqual(events[0].id,events[1].id);
 assert.deepEqual(events.map(e=>e.sourceId),['reef','reef']);
 const trip={departed:0,decisions:[],resumed:{}};
 assert.equal(replayTrip(trip,{hours:40,encounters:events,sail:[{from:0,to:40}]},40*3600).encounter.id,events[0].id);
 trip.resumed[events[0].id]=5*3600;
 assert.equal(replayTrip(trip,{hours:40,encounters:events,sail:[{from:0,to:40}]},40*3600).encounter.id,events[1].id);
});

test('regional native scale controls reach and camp encounters do not trigger',()=>{
 assert.equal(encounterHours(track('sea'),[hazard({at:[5,.5],radius:1})]).length,1);
 assert.equal(encounterHours(track('sea'),[hazard({at:[5,.5],radius:1,nativeMetric:[1,0,0,10]})]).length,0);
 assert.equal(encounterHours(track('sea'),[hazard({rest:{at:1}})]).length,0);
});

test('teleports, stationary and zero-time segments are excluded; walking timing samples preserve sea encounters',()=>{
 assert.deepEqual(encounterHours([{...track('sea')[0],portalTransfer:true},track('sea')[1]],[hazard()]),[]);
 assert.deepEqual(encounterHours([{at:[5,0],hour:0,kind:'sea'},{at:[5,0],hour:10}],[hazard()]),[]);
 assert.deepEqual(encounterHours([{at:[0,0],hour:0,kind:'sea'},{at:[10,0],hour:0}],[hazard()]),[]);
 const route=[track('sea')[0],{at:[3,0],hour:3,kind:'sea',timingBoundary:true},track('sea')[1]];
 assert.equal(encounterHours(route,[hazard()])[0].hour,5);
});

test('daily schedule and actual encounters respect exact sea endpoints, including short crossings',()=>{
 const plan={legs:[leg('road',-10,0),leg('sea',0,2),leg('road',2,12)]};
 const hazards=[hazard({id:'start',at:[.01,0],radius:.001}),hazard({id:'sea',at:[1,0]}),hazard({id:'land',at:[3,0]})];
 const sched=schedule(plan,{milesPerPixel:1,encounters:hazards});
 const daily=sched.days.flatMap(d=>d.encounters);assert.deepEqual(daily.map(e=>e.sourceId),['start','sea']);
 const actual=encounterHours([...sched.samples,{at:[12,0],hour:sched.hours}],hazards);
 assert.deepEqual(actual.map(e=>[e.sourceId,e.hour]),daily.map(e=>[e.sourceId,e.hour]));
 assert.ok(Math.abs(actual[0].hour-10.01)<1e-9);
});

test('non-crewed day sailing triggers even without continuous sailing periods',()=>{
 const result=itinerary(buildGraph([]),[[0,0],[10,0]],{milesPerPixel:1,legs:[{sea:{vessel:{mph:1,crewed:false}}}],seaPlan:()=>({legs:[leg('sea')],miles:10}),encounters:[hazard()]});
 assert.deepEqual(result.sail,[]);assert.equal(encounterHours(result.track,[hazard()])[0].hour,5);
 assert.equal(result.days.flatMap(d=>d.encounters).length,1);
});

test('Naval Hazards round-trip through encounter files and survive export with current travel excluded',()=>{
 const e=hazard({lon:-10,lat:20,group:'Reefs',scene:'scene',notes:'Sharp rocks'});delete e.at;
 const all=readEncounterFile(JSON.parse(JSON.stringify(encounterFile({reef:e},'test'))));assert.deepEqual(all.reef,e);
 const exported=worldForExport({encounters:{reef:e,ordinary:{kind:'encounter'}}},{includeTravel:false});assert.deepEqual(exported.encounters,{reef:e});
});

test('cards can change a hazard to Naval and preserve player discovery rules; editor lists its subtype',async()=>{
 gmGame({scenes:new Map()});globalThis.foundry={utils:{escapeHTML:String,deepClone:o=>structuredClone(o)}};
 let records={reef:{...hazardDefaults('rapids'),river:'old-river',lon:1,lat:2}};const kinds=new Map();
 registerKinds({register:(id,kind)=>kinds.set(id,kind)},{encounters:()=>records,saveEncounters:async(_world,fn)=>records=fn(records)});
 const card=kinds.get('encounter'),ref={world:'test',id:'reef'};
 assert.ok(card.get(ref).fields.find(f=>f.name==='subtype').options.some(([key,label])=>key==='naval'&&label==='Naval Hazard'));
 await card.save(ref,{subtype:'naval'});assert.ok(isNavalHazard(records.reef));assert.equal(records.reef.river,undefined);
 const editor=new RoadEditor({getEncounters:()=>records});assert.ok(editor.encounterList().includes('Naval Hazard'));
 game.user.isGM=false;assert.equal(card.get(ref).visibility,'hidden');records.reef.visibility='discovered';assert.deepEqual(card.get(ref).rows,[['Hazard','Naval Hazard']]);
 await card.save(ref,{subtype:'waterfall'});assert.ok(isNavalHazard(records.reef));
});

test('map layer registers Naval Hazards as hazards without marking them as river hazards',()=>{
 gmGame();const layer=new RealmLayer();layer.setEncounters({reef:{...hazardDefaults('naval'),lon:1,lat:2}});
 assert.equal(layer.hasHazards,true);assert.equal(layer.hasRiverHazards,false);
 layer.setEncounters({});assert.equal(layer.hasHazards,false);
});
