import test from 'node:test';
import assert from 'node:assert/strict';
import {changeLocalPlaceType,localPlaceType,localSourceKeys,deletedLocalPlace} from '../scripts/local-places.mjs';
import {settlementEntrances} from '../scripts/settlement-entry.mjs';
import {LocalMaps} from '../scripts/local-maps.mjs';
import {applyEdits} from '../scripts/places.mjs';
import {registerWorld} from '../scripts/worlds.mjs';
import {RegionalMaps} from '../scripts/regional-service.mjs';

test('Place, Gate and Dock changes preserve authored content and update actual arrival classification',()=>{
  const original={name:'Harbor',category:'harbour',entry:false,known:'My text',scene:'linked',img:'my.webp',gmNotes:'Private',sourceName:'Old harbor'},before=structuredClone(original);
  let rec=changeLocalPlaceType(original,'dock');assert.equal(localPlaceType(rec),'dock');assert.equal(rec.entryType,'dock');
  const scene={notes:[{id:'pin',x:100,y:200,getFlag:()=>rec}]};assert.equal(settlementEntrances(scene,{arrival:'sea'}).length,1);
  rec=changeLocalPlaceType(rec,'gate');assert.equal(settlementEntrances(scene,{arrival:'land'}).length,1);assert.equal(settlementEntrances(scene,{arrival:'sea'}).length,0);
  rec=changeLocalPlaceType(rec,'place');assert.equal(rec.category,'harbour');assert.equal(settlementEntrances(scene).length,0);
  for(const key of ['name','known','scene','img','gmNotes','sourceName'])assert.equal(rec[key],original[key]);assert.deepEqual(original,before);
  assert.equal(localPlaceType({category:'harbour',entry:true,entryType:'land'}),'gate');assert.throws(()=>changeLocalPlaceType(original,'invalid'));
});

test('deleted source identity survives a renamed local marker',()=>{
  const rec={name:'My renamed shop',sourceName:'Original shop'},map={deletedPlaces:localSourceKeys(rec)};
  assert.equal(deletedLocalPlace(map,{name:'Original shop'}),true);assert.equal(deletedLocalPlace(map,{name:'Another shop'}),false);
});

function fixture(){
  const gm={id:'gm',isGM:true,active:true};globalThis.game={user:gm,users:Object.assign([gm],{activeGM:gm}),settings:{get:()=>''}};
  globalThis.foundry={utils:{getRoute:p=>p}};globalThis.ui={notifications:{info(){}}};
  const scene={id:'local',name:'Local',notes:[],map:{world:'customization-test',placeId:'town',presetId:'town',presetRevision:1,unplaced:[]},roads:{roads:[]},getFlag(_module,key){return key==='localMap'?this.map:key==='cityRoads'?this.roads:null;},async setFlag(_module,key,value){if(key==='localMap')this.map=value;else if(key==='cityRoads')this.roads=value;},async createEmbeddedDocuments(_type,list){for(const raw of list)this.notes.push({id:raw._id??String(this.notes.length),...raw,getFlag:(m,k)=>raw.flags?.[m]?.[k]});return this.notes;},async updateEmbeddedDocuments(){}};
  game.scenes=[scene];game.scenes.get=id=>game.scenes.find(s=>s.id===id);
  const maps=new LocalMaps({getRealmPlaces:async()=>[],savePresetsDone:async value=>{maps.done=value;},presetsDone:()=>maps.done??[]});maps.ensureEntrance=async()=>{};maps.applySeasons=async()=>{};maps.unlinkScene=async()=>{};
  registerWorld({id:'customization-test',module:'example',title:'Example'});
  return {scene,maps};
}

test('deleted local places remain absent through a source update and only return on explicit restore',async()=>{
  const {scene,maps}=fixture();
  const removed={id:'deleted',parent:scene,rec:{name:'My renamed shop',sourceName:'Shop',category:'shop',known:'My changes'},getFlag(){return this.rec;},async delete(){scene.notes=scene.notes.filter(n=>n!==this);}};
  const kept={id:'kept',parent:scene,rec:{name:'Inn',category:'inn',known:'My inn text',img:'mine.webp'},getFlag(){return this.rec;}};scene.notes=[removed,kept];
  const preset={name:'Original town',placeId:'town',places:[{name:'Shop',category:'shop',known:'Source shop',x:10,y:20},{name:'Inn',category:'inn',known:'Source replacement',x:50,y:60}],unplaced:[],roads:{roads:[{id:'source-road'}]}};
  globalThis.fetch=async()=>({json:async()=>preset});maps.presets=async()=>[{id:'town',file:'town.json',revision:9}];
  await maps.deletePlace(removed);assert.equal(scene.notes.length,1);assert.ok(scene.map.deletedPlaces.includes('name:shop'));
  await maps.applyPreset({id:'town',file:'town.json',revision:9},{world:'customization-test',scene});assert.equal(scene.notes.length,1);assert.equal(kept.rec.known,'My inn text');
  scene.roads={roads:[]};await maps.restoreSourcePlaces(scene);assert.equal(scene.notes.length,2);assert.equal(scene.notes.find(n=>n.text==='Shop').getFlag('kg-realms','local').known,'Source shop');assert.equal(kept.rec.known,'My inn text');assert.deepEqual(scene.roads,{roads:[]},'restoring deleted places does not restore roads');assert.deepEqual(scene.map.deletedPlaces,[]);
});

test('loading an existing preset map never reapplies source art, places, roads or effects, and deleting its scene does not regenerate it',async()=>{
  const {scene,maps}=fixture();let calls=0;maps.presets=async()=>[{id:'town',placeId:'town',revision:99,create:true,map:{src:'new-art'},effects:{file:'effects.json'}}];maps.applyPreset=async()=>{calls++;return {scene,places:1};};maps.applyEffects=async()=>{calls++;};
  const before=structuredClone(scene.map);await maps.applyPresets('customization-test');assert.equal(calls,0);assert.deepEqual(scene.map,before);assert.deepEqual(maps.done,['town']);
  game.scenes.splice(0,1);await maps.applyPresets('customization-test');assert.equal(calls,0);
});

test('permanent realm deletions stay out of normal, restore and updated-source lists',()=>{
  const places=[{id:'a',name:'Source place'},{id:'b',name:'Kept'}],edits={deleted:['a'],edits:{a:{name:'Changed'}},added:{}};
  assert.deepEqual(applyEdits(places,edits).map(p=>p.id),['b']);assert.deepEqual(applyEdits(places,edits,'surface',{removed:true}),[]);
  assert.deepEqual(applyEdits([{id:'a',name:'Updated source'},...places.slice(1)],edits).map(p=>p.id),['b']);
});

test('a permanently deleted canonical place stays absent from its published Regional projection',()=>{
  fixture();game.settings.get=()=>({});const edits={root:{deleted:['own']},child:{deleted:['original']}};
  const maps=new RegionalMaps({getEdits:id=>edits[id],rawPlaces:(id,places)=>applyEdits(places,edits[id])});
  maps.indexes.root={places:[{id:'published',name:'Published',canonicalWorld:'child',canonicalId:'original'},{id:'own',name:'Root place'}]};
  assert.deepEqual(maps.places('root'),[]);
});
