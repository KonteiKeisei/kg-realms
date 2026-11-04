import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalMaps} from '../scripts/local-maps.mjs';

function fixture(places,selected='Stonebridge') {
  const warnings=[],messages=[],edits=[],prompts=[],flags={},note={id:'note',text:'Old Mill',texture:{src:''},getFlag:()=>null};
  const scene={id:'town-map',name:'STONEBRIDGE',notes:[note],getFlag:(_m,k)=>flags[k],setFlag:async(_m,k,value)=>{flags[k]=value;},updateEmbeddedDocuments:async(type,updates)=>{assert.equal(type,'Note');Object.assign(note,updates[0]);}};
  globalThis.game={user:{isGM:true},scenes:{get:()=>null},journal:[]};
  globalThis.ui={notifications:{warn:message=>warnings.push(message),info:message=>messages.push(message)}};
  globalThis.foundry={utils:{escapeHTML:String,randomID:()=> 'local-place'},applications:{api:{DialogV2:{prompt:async options=>{prompts.push(options);return selected;}}}}};
  const maps=new LocalMaps({getRealmPlaces:async world=>{assert.equal(world,'trorune');return places;},savePlaceEdit:async(...args)=>edits.push(args)});
  maps.settings=async target=>assert.equal(target,scene);
  maps.ensureEntrance=async target=>assert.equal(target,scene);
  return {maps,scene,note,flags,warnings,messages,edits,prompts};
}

test('Make local map converts a named settlement even when other realm records have invalid names',async()=>{
  const places=[null,{id:'missing',kind:'site'},{id:'null-name',kind:'settlement',name:null},{id:'numeric',kind:'site',name:42},{id:'blank',kind:'site',name:'   '},{id:'hidden',kind:'site',name:'Hidden keep',hidden:true},{id:'land',kind:'natural',name:'Woodland'},{id:'town',kind:'settlement',class:'Town',name:'Stonebridge'},{id:'site',kind:'site',name:'Abbey'}];
  const before=structuredClone(places),f=fixture(places,'sToNeBrIdGe');
  await f.maps.make(f.scene,'trorune');
  assert.deepEqual(places,before,'conversion does not rename, delete or change realm records');
  assert.equal(f.prompts.length,1);
  assert.match(f.prompts[0].content,/value="Stonebridge"/,'the scene name still guesses its realm place without case sensitivity');
  assert.match(f.prompts[0].content,/value="Abbey"/);
  assert.doesNotMatch(f.prompts[0].content,/undefined|null|Hidden keep|Woodland|value="42"/);
  assert.equal(f.flags.localMap.placeId,'town');assert.equal(f.flags.localMap.world,'trorune');
  assert.equal(f.note['flags.kg-realms.local'].name,'Old Mill');
  assert.deepEqual(f.edits,[['trorune','town',{scene:'town-map'}]]);
  assert.deepEqual(f.warnings,[]);assert.equal(f.messages.length,1);
});

test('Make local map explains an empty eligible place list without writing or opening an unusable prompt',async()=>{
  const f=fixture([{kind:'settlement'},{kind:'site',name:''},{kind:'settlement',name:'Hidden town',hidden:true}]);
  await f.maps.make(f.scene,'trorune');
  assert.equal(f.prompts.length,0);assert.deepEqual(f.flags,{});assert.deepEqual(f.edits,[]);
  assert.equal(f.warnings.length,1);assert.match(f.warnings[0],/no named, visible settlements or sites/);
});
