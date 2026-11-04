import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalMaps} from '../scripts/local-maps.mjs';
import {registerWorld} from '../scripts/worlds.mjs';
import {RegionalMaps} from '../scripts/regional-service.mjs';
import {sourceProjection} from '../scripts/source-map.mjs';
import {homebrewSheet} from '../scripts/homebrew/plan.mjs';
import {applyEdits} from '../scripts/places.mjs';

function fixture(places,selected='Stonebridge') {
  const warnings=[],messages=[],edits=[],prompts=[],flags={},note={id:'note',text:'Old Mill',texture:{src:''},getFlag:()=>null};
  const scene={id:'town-map',name:'STONEBRIDGE',notes:[note],getFlag:(_m,k)=>flags[k],setFlag:async(_m,k,value)=>{flags[k]=value;},updateEmbeddedDocuments:async(type,updates)=>{assert.equal(type,'Note');Object.assign(note,updates[0]);}};
  globalThis.game={user:{isGM:true},scenes:{get:()=>null},journal:[]};
  globalThis.canvas={scene:null};
  globalThis.ui={notifications:{warn:message=>warnings.push(message),info:message=>messages.push(message),error:message=>warnings.push(message)}};
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
  assert.doesNotMatch(f.prompts[0].content,/undefined|null|Woodland|value="42"/);
  assert.match(f.prompts[0].content,/Hidden keep/,'GM setup includes hidden places without revealing them');
  assert.equal(f.flags.localMap.placeId,'town');assert.equal(f.flags.localMap.world,'trorune');
  assert.equal(f.note['flags.kg-realms.local'].name,'Old Mill');
  assert.deepEqual(f.edits,[['trorune','town',{scene:'town-map'}]]);
  assert.deepEqual(f.warnings,[]);assert.equal(f.messages.length,1);
});

test('Make local map explains an empty eligible place list without writing or opening an unusable prompt',async()=>{
  const f=fixture([{kind:'settlement'},{kind:'site',name:''},{kind:'natural',name:'Woodland'}]);
  await f.maps.make(f.scene,'trorune');
  assert.equal(f.prompts.length,0);assert.deepEqual(f.flags,{});assert.deepEqual(f.edits,[]);
  assert.equal(f.warnings.length,1);assert.match(f.warnings[0],/no named settlements or sites/);
});

test('conversion on an empty Regional map finds its inherited linked place and preserves the shared realm identity',async()=>{
  registerWorld({id:'conversion-empty-first',module:'example'});
  registerWorld({id:'conversion-realm',module:'example'});
  registerWorld({id:'conversion-dale',module:'example'});
  const f=fixture([],'Lonelywood');f.scene.name='Lonelywood';
  const rootSheet=homebrewSheet(1000,500,1000),regionalSheet=homebrewSheet(300,300,150),root=sourceProjection(rootSheet);
  const link={world:'conversion-dale',parent:'conversion-realm',scene:'detail',parentScene:'overview',title:'Icewind Dale',footprint:[[100,100],[130,100],[130,130],[100,130]].map(p=>root.toLonLat(...p)),anchors:[{parent:[100,100],region:[0,0]},{parent:[130,100],region:[300,0]},{parent:[100,130],region:[0,300]}],positions:{lonely:[1,2]}};
  const [lon,lat]=root.toLonLat(115,115),place={id:'lonely',name:'Lonelywood',kind:'settlement',class:'Town',lon,lat,scene:f.scene.id,hidden:true};
  const index={'conversion-realm':{places:[place],sourceMap:rootSheet},'conversion-dale':{places:[],sourceMap:regionalSheet}};
  const edits={},settings={regionalMaps:{'conversion-dale':link}};
  game.settings={get:(_m,k)=>settings[k]};game.scenes={get:id=>id==='overview'?{id}:null};
  canvas.scene={getFlag:(_m,k)=>k==='world'?'conversion-dale':null};
  const service=new RegionalMaps({loadWorld:async world=>index[world],getRoutes:async()=>({features:[]}),getEdits:world=>edits[world],rawPlaces:(world,places)=>applyEdits(places,edits[world])});
  f.maps.getRealmPlaces=async world=>{await service.prepare(world);return service.places(world);};
  f.maps.savePlaceEdit=async(world,id,fields)=>{
    f.edits.push([world,id,fields]);
    const before=structuredClone(edits[world]??{edits:{},added:{}}),after=structuredClone(before);
    (after.edits[id]??={}).scene=fields.scene;
    edits[world]=service.reconcileEdits(world,before,after,edits);
  };
  await f.maps.make(f.scene);
  assert.equal(f.prompts.length,1);assert.match(f.prompts[0].content,/value="Lonelywood"/);
  assert.equal(f.flags.localMap.world,'conversion-dale');assert.equal(f.flags.localMap.placeId,'lonely');
  assert.equal(service.places('conversion-realm').find(p=>p.id==='lonely').scene,f.scene.id);
  assert.equal(service.places('conversion-dale').find(p=>p.id==='lonely').scene,f.scene.id);
  assert.equal(edits['conversion-dale'].edits.lonely.scene,undefined,'shared link belongs to the canonical realm place');
  assert.equal(edits['conversion-realm'].edits.lonely.scene,f.scene.id);
  assert.deepEqual(link.positions.lonely,[1,2]);assert.equal(place.hidden,true);assert.deepEqual(f.warnings,[]);
});

test('a saved scene link on another map takes precedence over the active map and a same-name guess',async()=>{
  registerWorld({id:'conversion-other',module:'example'});
  const f=fixture([],'Stonebridge'),asked=[];
  canvas.scene={getFlag:(_m,k)=>k==='world'?'conversion-empty-first':null};
  f.maps.getRealmPlaces=async world=>{
    asked.push(world);
    if(world==='conversion-empty-first')return[{id:'wrong',kind:'settlement',name:'Stonebridge'}];
    if(world==='conversion-other')return[{id:'correct',kind:'settlement',name:'Stonebridge',scene:f.scene.id}];
    return[];
  };
  await f.maps.make(f.scene);
  assert.equal(f.flags.localMap.world,'conversion-other');assert.equal(f.flags.localMap.placeId,'correct');
  assert.ok(asked.includes('conversion-other'));assert.deepEqual(f.edits,[['conversion-other','correct',{scene:f.scene.id}]]);
});

test('an explicitly chosen map stays authoritative and synthetic trail crossings are excluded',async()=>{
  const f=fixture([{id:'town',kind:'settlement',name:'Stonebridge'},{id:'entry',name:'Trail crossing',kind:'site',regionalEntry:true}]);
  canvas.scene={getFlag:()=> 'conversion-other'};
  await f.maps.make(f.scene,'trorune');
  assert.equal(f.flags.localMap.world,'trorune');assert.equal(f.flags.localMap.placeId,'town');
  assert.doesNotMatch(f.prompts[0].content,/Trail crossing/);
});

test('a map data load failure reports the load error instead of claiming its places are missing',async()=>{
  const f=fixture([]);f.maps.getRealmPlaces=async()=>{throw Error('HTTP 403');};
  await f.maps.make(f.scene,'trorune');
  assert.equal(f.prompts.length,0);assert.deepEqual(f.flags,{});assert.deepEqual(f.edits,[]);
  assert.equal(f.warnings.length,1);assert.match(f.warnings[0],/could not load places.*HTTP 403/);
});
