import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {parseHTML} from 'linkedom';
import {registerWorld} from '../scripts/worlds.mjs';
import {buildExport,setExportData,sceneFromModule,exportModule} from '../scripts/homebrew/export.mjs';
import {buildLocalMapTiles,stagePlacedMapTiles} from '../scripts/local-map-tiles.mjs';
import {placedTileAsset} from '../scripts/placed-tile-lods.mjs';
import {mapAsset} from '../scripts/local-map-renderer.mjs';
import {resolveLocalLods} from '../scripts/local-map-lods.mjs';
import {sceneTemplates,generateSelectedScenes,templateForPlace,generatePlaceScene,sceneChecklistContent,bindSceneChecklist,openSceneChecklist,promptInstalledScenes,regenerateSceneCopy,adoptPackagedScenes} from '../scripts/module-scenes.mjs';
import {selectedScenePlan,sceneTemplateCatalog} from '../scripts/scene-template-plan.mjs';
import {registerKinds} from '../scripts/card-kinds.mjs';
import {homebrewSheet} from '../scripts/homebrew/plan.mjs';

const R='r'.repeat(16),D='d'.repeat(16),L='l'.repeat(16),I='i'.repeat(16),A='a'.repeat(16),J='j'.repeat(16),P='p'.repeat(16);
const ROOT='template-realm',CHILD='template-dale',MODULE='template-bundle';
const collection=()=>{const map=new Map();map.map=fn=>[...map.values()].map(fn);map.filter=fn=>[...map.values()].filter(fn);return map;};
function document(raw){return {...structuredClone(raw),id:raw._id,getFlag(m,k){return this.flags?.[m]?.[k];},toObject(){const{getFlag,toObject,view,activate,id,update,...data}=this;return structuredClone(data);},async view(){this.viewed=true;},async activate(){this.activated=true;}};}
async function unzip(parts){
  const bytes=new Uint8Array(await new Blob(parts).arrayBuffer()),v=new DataView(bytes.buffer),decode=new TextDecoder();let end=bytes.length-22;while(v.getUint32(end,true)!==0x06054b50)end--;
  let at=v.getUint32(end+16,true);const out=new Map();for(let n=0;n<v.getUint16(end+10,true);n++){const size=v.getUint32(at+24,true),len=v.getUint16(at+28,true),offset=v.getUint32(at+42,true),name=decode.decode(bytes.subarray(at+46,at+46+len)),start=offset+30+v.getUint16(offset+26,true);out.set(name,bytes.slice(start,start+size));at+=46+len;}return out;
}
const jsonBytes=data=>new TextEncoder().encode(JSON.stringify(data));
const jsonFile=(files,name)=>JSON.parse(new TextDecoder().decode(files.get(name)));

test('mutually linked interior scenes have a usable checklist tree without rewriting their authored links',()=>{
  const scenes=[{_id:R,name:'Realm',flags:{'kg-realms':{world:ROOT}}},{_id:L,name:'Hall',notes:[{flags:{'kg-realms':{local:{scene:I}}}}]},{_id:I,name:'Cellar',notes:[{flags:{'kg-realms':{local:{scene:L}}}}]}];
  const before=structuredClone(scenes),catalog=sceneTemplateCatalog(ROOT,scenes,[]);
  assert.deepEqual(selectedScenePlan(catalog.scenes,[I]).map(n=>n.id),[R,L,I]);assert.deepEqual(scenes,before);
});

async function fixture({retiled=false,exportOptions={},configure,allowProblems=false}={}){
  const served=new Map(),settings=new Map(),requests=[],created=[],dialogs=[],messages=[],edits=[];
  const gm={id:'gm',isGM:true,active:true,can:()=>true};
  globalThis.game={user:gm,users:Object.assign([gm],{activeGM:gm}),release:{generation:13},system:{id:'dnd5e'},time:{worldTime:0},actors:collection(),journal:collection(),playlists:collection(),scenes:collection(),modules:{get:()=>({version:'0.94.0'})},settings:{get:(_m,k)=>settings.get(k),set:async(_m,k,v)=>settings.set(k,structuredClone(v))}};
  globalThis.location={origin:'http://localhost:30000'};globalThis.canvas={scene:null};
  globalThis.ui={notifications:{info:s=>messages.push(s),warn:s=>messages.push(s),error:s=>messages.push(s)}};
  globalThis.foundry={utils:{getRoute:p=>`/${p}`,escapeHTML:s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'),randomID:()=> 'c'.repeat(16),deepClone:structuredClone},applications:{api:{DialogV2:{wait:async options=>{dialogs.push(options);return null;}}}}};
  globalThis.fetch=async url=>{const path=decodeURIComponent(String(url).replace(/^\//,''));requests.push(path);const bytes=served.get(path);return{ok:!!bytes,status:bytes?200:404,json:async()=>JSON.parse(new TextDecoder().decode(bytes)),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};};
  const sourceDocs=new Map([[`Actor.${A}`,{_id:A,name:'Innkeeper',type:'npc',img:'worlds/author/innkeeper.webp'}],[`JournalEntry.${J}`,{_id:J,name:'Room notes',pages:[{_id:P,name:'Overview',text:{content:'Room description'}}]}]]);
  globalThis.fromUuid=async uuid=>sourceDocs.has(uuid)?document(sourceDocs.get(uuid)):null;
  const link={world:CHILD,parent:ROOT,scene:D,parentScene:R,title:'Northreach',placeId:'area',footprint:[[0,0],[1,0],[1,1]],anchors:[{parent:[0,0],region:[0,0]},{parent:[1,0],region:[1,0]},{parent:[0,1],region:[0,1]}],positions:{town:[1,2]}};
  const defs={},state={};
  for(const [n,id] of [ROOT,CHILD].entries()){
    const base=`modules/source-${n}`,root=`${base}/data/worlds/${id}`;
    defs[id]=registerWorld({id,title:n?'Northreach':'Trorune',module:`source-${n}`,assetBase:base});
    served.set(`${root}/index.json`,jsonBytes({world:id,places:[],sourceMap:homebrewSheet(100,100,n?100:1000),routes:'roads.json'}));
    served.set(`${root}/terrain-pack.json`,jsonBytes({lods:[{tiles:[{path:'assets/terrain/chunk.ktx2.fbx'}]}]}));
    served.set(`${root}/roads.json`,jsonBytes({type:'FeatureCollection',features:[]}));served.set(`${root}/local/index.json`,jsonBytes([]));
    served.set(`${base}/assets/terrain/chunk.ktx2.fbx`,new TextEncoder().encode(`REALM TILE ${n}`));
    state[id]={places:n?[]:[{id:'town',kind:'settlement',class:'Town',name:'Stonebridge',scene:L},{id:'area',kind:'domain',class:'Area',name:'Northreach'}],routeEdits:{},waterways:{},biomes:{},encounters:{},tradeEdits:{},markers:{},regionalLinks:n?[]:[link],regionalEdits:{edits:{town:{lon:1,lat:2}},added:{}},regionalSnow:false};
  }
  const notes=[{_id:'inn-note',text:'Inn',x:5,y:5,flags:{'kg-realms':{local:{name:'Inn',category:'inn',visibility:'hidden',scene:I}}}}];
  const scenes=[
    {_id:R,name:'Trorune',notes:[],tokens:[],flags:{'kg-realms':{world:ROOT,bounds:homebrewSheet(100,100,1000).bounds,version:3}}},
    {_id:D,name:'Northreach',notes:[],tokens:[],flags:{'kg-realms':{world:CHILD,regionalMap:true}}},
    {_id:L,name:'Stonebridge',width:1000,height:1000,notes,tokens:[{_id:'npc-token',actorId:A}],tiles:[{_id:'tile',texture:{src:'worlds/author/stonebridge-tile.webp'},x:0,y:0,width:1000,height:1000}],walls:[{c:[0,0,100,100]}],lights:[{x:20,y:30}],flags:{'kg-realms':{localMap:{world:CHILD,placeId:'town',name:'Stonebridge'},cityRoads:{roads:[{id:'road',points:[[0,0],[10,10]]}]}}}},
    {_id:I,name:'Inn',tokens:[],notes:[{_id:'journal-pin',entryId:J,pageId:P,text:'Room notes'}],flags:{'kg-realms':{returnTo:{scene:L,note:'inn-note',name:'Inn'}}}}
  ];
  for(const scene of scenes)game.scenes.set(scene._id,document(scene));
  for(const [path,data]of [['worlds/author/stonebridge-tile.webp','TILED ART'],['worlds/author/innkeeper.webp','ACTOR ART']])served.set(path,new TextEncoder().encode(data));
  if(retiled){
    const scene=game.scenes.get(L);scene.update=async patch=>{scene.flags['kg-realms'].localMap.tileAsset=patch['flags.kg-realms.localMap.tileAsset'];scene.background={src:patch['background.src']};};
    scene.tiles[0].elevation=20;scene.tiles[0].occlusion={mode:3};
    served.set('worlds/author/new master.webp',new TextEncoder().encode('EDITABLE MASTER'));
    Object.defineProperty(scene,'updateEmbeddedDocuments',{value:async(_type,patches)=>{for(const patch of patches){const tile=scene.tiles.find(t=>t._id===patch._id);tile.texture.src=patch['texture.src'];tile.flags={'kg-realms':{tileAsset:patch['flags.kg-realms.tileAsset']}};}}});
    const io={authority:()=>true,buildId:'fixture-build',picture:async()=>({width:128,height:64,close:()=>{}}),preview:async()=>new TextEncoder().encode('TILE PREVIEW'),prepare:async()=>{},encode:async(_bitmap,tile)=>{
      const bytes=new Uint8Array(80),v=new DataView(bytes.buffer);bytes.set([0xab,0x4b,0x54,0x58,0x20,0x32,0x30,0xbb,0x0d,0x0a,0x1a,0x0a]);v.setUint32(20,tile.textureWidth,true);v.setUint32(24,tile.textureHeight,true);v.setUint32(40,1,true);return bytes;
    },write:async(path,bytes)=>served.set(path,new Uint8Array(bytes)),read:async path=>served.get(path)};
    await buildLocalMapTiles(scene,'worlds/author/new master.webp',{...io,beforePublish:()=>stagePlacedMapTiles(scene,io)});
  }
  setExportData(async id=>structuredClone(state[id]));
  await configure?.({state,sourceDocs,served,scenes:game.scenes,defs});
  const exported=await buildExport(defs[ROOT],{moduleId:MODULE,title:'Trorune',version:'1.0.0',rootScene:R,...exportOptions});if(!allowProblems)assert.equal(exported.problems,0);
  const files=await unzip(exported.parts),worlds=[];
  runInNewContext(new TextDecoder().decode(files.get(`${MODULE}/scripts/main.mjs`)),{Hooks:{once:(_name,fn)=>fn({registerWorld:w=>worlds.push(JSON.parse(JSON.stringify(w)))})}});
  // A fresh installation: only the exported module's bytes remain accessible.
  served.clear();for(const [name,bytes]of files)served.set(`modules/${name}`,bytes);
  for(const w of worlds)registerWorld(w);
  const root=worlds[0];game.scenes=collection();game.actors=collection();game.journal=collection();requests.length=0;
  globalThis.fromUuid=async()=>null;
  globalThis.getDocumentClass=type=>({create:async(raw,options)=>{
    const doc=document(raw),target=type==='Scene'?game.scenes:type==='Actor'?game.actors:type==='JournalEntry'?game.journal:game.playlists;
    assert.equal(options.keepId,true);target.set(doc.id,doc);created.push([type,doc.id,options]);if(type==='Scene')await sceneFromModule(doc,options,'gm');return doc;
  }});
  const maps={getRealmPlaces:async()=>[],savePlaceEdit:async(...args)=>edits.push(args)};game.modules.get=()=>({version:'0.94.0',api:{localMaps:maps}});
  return{root,worlds,files,served,requests,created,dialogs,settings,messages,edits,link,exported};
}

const CARD_ACTOR='k'.repeat(16),CARD_ITEM='v'.repeat(16),ENCOUNTER_ACTOR='e'.repeat(16),TRAVEL_SCENE='q'.repeat(16);
function optionalContent({missing=false}={}){
  return({state,sourceDocs,served,scenes})=>{
    state[ROOT].places[0].actor=`Actor.${CARD_ACTOR}`;
    scenes.get(L).notes[0].flags['kg-realms'].local.actor=`Actor.${CARD_ACTOR}`;
    scenes.get(R).flags['kg-realms'].journey={name:'Campaign route',waypoints:[{id:'town'}],trip:{departed:12},encounters:[{id:'private',name:'Private ambush',scene:TRAVEL_SCENE,actors:[`Actor.${ENCOUNTER_ACTOR}`]}]};
    state[ROOT].encounters={ambush:{name:'Road ambush',actors:[`Actor.${ENCOUNTER_ACTOR}`],scene:TRAVEL_SCENE},rapids:{name:'Rapids',kind:'hazard',subtype:'rapids'}};
    state[CHILD].encounters={ambush:{name:'Regional ambush',actors:[`Actor.${ENCOUNTER_ACTOR}`]}};
    sourceDocs.set(`Actor.${CARD_ACTOR}`,{_id:CARD_ACTOR,name:'Card only guide',img:'worlds/author/card-guide.webp',description:`@UUID[Item.${CARD_ITEM}]{Guide cloak}`});
    sourceDocs.set(`Item.${CARD_ITEM}`,{_id:CARD_ITEM,name:'Guide cloak',img:'worlds/author/cloak.webp'});
    sourceDocs.set(`Actor.${ENCOUNTER_ACTOR}`,{_id:ENCOUNTER_ACTOR,name:'Encounter guard',img:'worlds/author/guard.webp'});
    sourceDocs.set(`Scene.${TRAVEL_SCENE}`,{_id:TRAVEL_SCENE,name:'Road encounter scene',tokens:[],notes:[],flags:{}});
    if(!missing)for(const file of ['card-guide','cloak','guard'])served.set(`worlds/author/${file}.webp`,new TextEncoder().encode(file));
  };
}

function exportedData(f){
  setExportData(async id=>({places:jsonFile(f.files,`${MODULE}/data/worlds/${id}/index.json`).places,routeEdits:{},waterways:{},biomes:{},encounters:jsonFile(f.files,`${MODULE}/data/worlds/${id}/encounters.json`).encounters,tradeEdits:{},markers:{},regionalLinks:[],regionalEdits:{}}));
}

for(const includeTravel of [false,true])for(const includeCardActors of [false,true])test(`export choices remain independent: Travel ${includeTravel}, Card actors ${includeCardActors}`,async()=>{
  const f=await fixture({exportOptions:{includeTravel,includeCardActors},configure:optionalContent()}),docs=[ROOT,CHILD].flatMap(id=>jsonFile(f.files,`${MODULE}/data/worlds/${id}/packs/scenes.json`));
  const actorIds=[ROOT,CHILD].flatMap(id=>{const path=`${MODULE}/data/worlds/${id}/packs/actors.json`;return f.files.has(path)?jsonFile(f.files,path).map(a=>a._id):[];});
  assert.ok(actorIds.includes(A),'placed scene token actors remain required');
  assert.equal(actorIds.includes(CARD_ACTOR),includeCardActors);assert.equal(actorIds.includes(ENCOUNTER_ACTOR),includeTravel&&includeCardActors);
  const place=jsonFile(f.files,`${MODULE}/data/worlds/${ROOT}/index.json`).places.find(p=>p.id==='town');assert.equal(!!place.actor,includeCardActors);
  const town=docs.find(s=>s._id===L);assert.equal(!!town.notes[0].flags['kg-realms'].local.actor,includeCardActors);
  const realm=docs.find(s=>s._id===R);assert.equal(!!realm.flags['kg-realms'].journey,includeTravel);
  const encounters=jsonFile(f.files,`${MODULE}/data/worlds/${ROOT}/encounters.json`).encounters;assert.equal(!!encounters.ambush,includeTravel);assert.ok(encounters.rapids);
  assert.equal(docs.some(s=>s._id===TRAVEL_SCENE),includeTravel);
  if(includeTravel){assert.equal(realm.flags['kg-realms'].journey.trip.departed,12);assert.equal(!!realm.flags['kg-realms'].journey.encounters[0].actors,includeCardActors);}
  assert.match(f.exported.report,new RegExp(`Current Travel \\(including encounters\\): ${includeTravel?'included':'excluded'}`));
  assert.equal([...f.files.keys()].some(path=>path.endsWith('/card-guide.webp')),includeCardActors);
  await generateSelectedScenes(f.root,[L]);assert.equal(game.scenes.get(L).tokens[0].actorId,A);assert.ok(game.actors.has(A));
});

test('unchecked optional content cannot block export with its missing pictures or nested item art',async()=>{
  const f=await fixture({configure:optionalContent({missing:true})});
  assert.equal(f.exported.problems,0);assert.doesNotMatch(f.exported.report,/card-guide.webp|cloak.webp|guard.webp/);
  assert.ok(![...f.files.keys()].some(path=>path.endsWith('/packs/items.json')));
});

test('missing selected Card actor and item artwork names their documents and the maps that reference them',async()=>{
  const f=await fixture({exportOptions:{includeCardActors:true},configure:optionalContent({missing:true}),allowProblems:true});
  assert.equal(f.exported.problems,4,'the two missing files are reported in both realm and Regional bundles');
  for(const text of ['Actor "Card only guide"','Item "Guide cloak"','Scene "Trorune"','Scene "Stonebridge"'])assert.ok(f.exported.report.includes(text),text);
  assert.doesNotMatch(f.exported.report,/guard.webp/,'unchecked Travel is not collected');
});

test('re-export prunes unchecked Card actor dependencies from an installed companion without dropping placed token actors',async()=>{
  const f=await fixture({exportOptions:{includeTravel:true,includeCardActors:true},configure:optionalContent()});exportedData(f);
  const result=await buildExport(f.root,{moduleId:'pruned-bundle',title:'Pruned',version:'1',rootScene:R,includeTravel:false,includeCardActors:false});
  assert.equal(result.problems,0);const files=await unzip(result.parts);
  const actors=jsonFile(files,`pruned-bundle/data/worlds/${CHILD}/packs/actors.json`);assert.ok(actors.some(a=>a._id===A));
  assert.ok(!actors.some(a=>a._id===CARD_ACTOR||a._id===ENCOUNTER_ACTOR));
  assert.ok(![...files.keys()].some(path=>/\/(?:card-guide|cloak|guard)\.webp$/.test(path)));
  const place=jsonFile(files,`pruned-bundle/data/worlds/${ROOT}/index.json`).places.find(p=>p.id==='town');assert.equal(place.actor,undefined);
});

test('export form offers both unchecked choices and applies their submitted values',async()=>{
  const f=await fixture({exportOptions:{includeTravel:true,includeCardActors:true},configure:optionalContent()});exportedData(f);
  let form,download;
  foundry.applications.api.DialogV2.wait=async options=>{form=options;return{id:'form-bundle',title:'Form export',version:'1',includeTravel:false,includeCardActors:false};};
  foundry.applications.api.DialogV2.prompt=async()=>{};foundry.utils.saveDataToFile=blob=>{download=blob;};
  await exportModule(f.root,R);
  const {document}=parseHTML(form.content);for(const name of ['includeTravel','includeCardActors']){const checkbox=document.querySelector(`input[name="${name}"]`);assert.equal(checkbox.type,'checkbox');assert.equal(checkbox.hasAttribute('checked'),false);}
  assert.ok(download);const files=await unzip([download]);
  const scenes=jsonFile(files,`form-bundle/data/worlds/${ROOT}/packs/scenes.json`);assert.equal(scenes.find(s=>s._id===R).flags['kg-realms'].journey,undefined);
  assert.equal(jsonFile(files,`form-bundle/data/worlds/${ROOT}/index.json`).places.find(p=>p.id==='town').actor,undefined);
});

test('a fresh exported module generates the realm and Regional map, then generates the tiled settlement and interior on demand',async()=>{
  const f=await fixture(),nodes=sceneTemplates(f.root),town=nodes.find(n=>n.id===L);
  assert.equal(nodes.find(n=>n.id===D).parent,R);assert.equal(town.parent,D);assert.equal(nodes.find(n=>n.id===I).parent,L);
  await generateSelectedScenes(f.root,[D]);
  assert.deepEqual([...game.scenes.keys()],[R,D]);assert.equal(game.scenes.has(L),false);assert.equal(game.scenes.has(I),false);
  assert.deepEqual(f.settings.get('regionalMaps')[CHILD],f.link);
  const node=templateForPlace(CHILD,{id:'town',canonicalWorld:ROOT,canonicalId:'town'},L);assert.equal(node.id,L);
  const local=await generatePlaceScene(CHILD,node);
  assert.equal(local.flags['kg-realms'].localMap.placeId,'town');assert.equal(local.flags['kg-realms'].localMap.world,CHILD);
  assert.equal(local.tiles.length,1);assert.equal(local.walls.length,1);assert.equal(local.lights.length,1);
  assert.equal(local.flags['kg-realms'].cityRoads.roads.length,1);assert.equal(local.notes[0].flags['kg-realms'].local.visibility,'hidden');
  assert.equal(local.tokens[0].actorId,A);assert.ok(game.actors.has(A));assert.equal(game.scenes.has(I),false);
  const art=local.tiles[0].texture.src;assert.match(art,/^modules\/template-bundle\/assets\/maps\//);assert.equal(new TextDecoder().decode(f.served.get(art)),'TILED ART');
  await generatePlaceScene(CHILD,templateForPlace(CHILD,{id:'inn'},I));
  assert.ok(game.scenes.has(I));assert.ok(game.journal.has(J));assert.equal(game.scenes.get(I).notes[0].entryId,J);assert.equal(game.scenes.get(I).notes[0].pageId,P);
  assert.ok(f.requests.every(path=>path.startsWith(`modules/${MODULE}/`)),'no author-world or source-module fetch survives');
  const before=f.created.length;local.name='My edited town';await generateSelectedScenes(f.root,[L]);assert.equal(f.created.length,before);assert.equal(local.name,'My edited town');
});

test('the checklist displays hierarchy and selects required ancestors without enabling unchecked maps',async()=>{
  const f=await fixture(),nodes=sceneTemplates(f.root),{document,Event}=parseHTML('<html><body></body></html>');
  document.body.innerHTML=sceneChecklistContent(f.root,nodes);bindSceneChecklist(document.body,nodes,f.root);
  const find=id=>document.querySelector(`[name="scene-template"][value="${id}"]`);
  assert.equal(document.querySelector(`[data-template-row="${L}"]`).parentElement.closest('li').dataset.templateRow,D);
  find(I).checked=true;find(I).dispatchEvent(new Event('change',{bubbles:true}));for(const id of [R,D,L,I])assert.equal(find(id).checked,true);
  find(D).checked=false;find(D).dispatchEvent(new Event('change',{bubbles:true}));assert.equal(find(L).checked,false);assert.equal(find(I).checked,false);
  document.querySelector('[data-scene-select="all"]').click();assert.ok([...document.querySelectorAll('[name="scene-template"]')].every(b=>b.checked));
  document.querySelector('[data-scene-select="none"]').click();assert.ok([...document.querySelectorAll('[name="scene-template"]')].every(b=>!b.checked));
  assert.deepEqual(selectedScenePlan(nodes,[I]).map(n=>n.id),[R,D,L,I]);assert.throws(()=>selectedScenePlan(nodes,['unknown']),/Unknown scene selection/);
});

test('GM cards offer generation on both realm and Regional places, including nested scene cards; players do not',async()=>{
  const f=await fixture(),handlers=new Map(),places=[{id:'town',name:'Stonebridge',class:'Town',kind:'settlement',scene:L},{id:'area',name:'Northreach',class:'Area',kind:'domain'}];
  registerKinds({register:(name,handler)=>handlers.set(name,handler)},{realmPlaces:async()=>places,presetFor:async()=>null,savePlaceEdit:async()=>{},localMaps:game.modules.get('kg-realms').api.localMaps});
  const realm=handlers.get('realm'),card=await realm.get({world:ROOT,id:'town'});assert.equal(card.gmActions[0].act,'generate');
  assert.equal((await realm.get({world:ROOT,id:'area'})).gmActions[0].act,'generate');
  await realm.act({world:CHILD,id:'town'},'generate');assert.ok(game.scenes.has(L));assert.equal(game.scenes.get(L).viewed,true);
  const note=game.scenes.get(L).notes[0];note.id=note._id;note.parent=game.scenes.get(L);note.getFlag=(m,k)=>note.flags?.[m]?.[k];note.parent.notes.get=id=>id===note.id?note:null;
  const nested=handlers.get('local').get({scene:L,note:note.id});assert.ok(nested.gmActions.some(a=>a.act==='generate'));
  game.user={id:'player',isGM:false};assert.deepEqual((await realm.get({world:ROOT,id:'town'})).gmActions,[]);
  assert.deepEqual(handlers.get('local').get({scene:L,note:note.id}).gmActions,[]);
  await assert.rejects(()=>generateSelectedScenes(f.root,[I]),/Only a GM/);
});

test('first-load Later and Never preserve scenes; the checklist is still available manually',async()=>{
  const f=await fixture();await promptInstalledScenes();assert.equal(f.dialogs.length,1);assert.equal(game.scenes.size,0);assert.equal(f.settings.get('sceneTemplateSetup'),undefined);
  foundry.applications.api.DialogV2.wait=async options=>{f.dialogs.push(options);return{never:true};};
  await promptInstalledScenes();assert.equal(f.settings.get('sceneTemplateSetup')[MODULE],'never');const count=f.dialogs.length;
  await promptInstalledScenes();assert.equal(f.dialogs.length,count);await openSceneChecklist(f.root);assert.equal(f.dialogs.length,count+1);
});

test('regeneration without tokens creates and links a fresh copy while retaining the current scene',async()=>{
  const f=await fixture();await generateSelectedScenes(f.root,[L]);const previous=game.scenes.get(L);
  foundry.applications.api.DialogV2.wait=async()=>({includeTokens:false});
  const copy=await regenerateSceneCopy(f.root,sceneTemplates(f.root).find(n=>n.id===L));
  assert.notEqual(copy.id,L);assert.equal(copy.tokens.length,0);assert.equal(copy.tiles.length,1);assert.equal(copy.notes.length,1);
  assert.equal(game.scenes.get(L),previous);assert.equal(previous.tokens.length,1);assert.deepEqual(f.edits,[[ROOT,'town',{scene:copy.id}]]);
  await generateSelectedScenes(f.root,[I]);assert.equal(game.scenes.get(I).flags['kg-realms'].returnTo.scene,copy.id);
});

test('older exported modules discover their hierarchy and card generators directly from packaged snapshots',async()=>{
  const f=await fixture();for(const world of f.worlds)registerWorld({...world,sceneTemplates:undefined});
  await adoptPackagedScenes();const node=templateForPlace(ROOT,{id:'area'});assert.equal(node.id,D);
  const root=(await import('../scripts/worlds.mjs')).worldDef(ROOT),nodes=sceneTemplates(root);
  assert.equal(nodes.find(n=>n.id===L).parent,D);await generateSelectedScenes(root,[L]);assert.ok(game.scenes.has(L));
});

test('repeated regeneration updates a parent pin from its previous generated copy',async()=>{
  const f=await fixture();await generateSelectedScenes(f.root,[L]);let count=0;foundry.utils.randomID=()=>`copy${++count}`.padEnd(16,'x');
  const pin=game.scenes.get(L).notes[0];pin.getFlag=(m,k)=>pin.flags[m]?.[k];pin.update=async patch=>{pin.flags['kg-realms'].local.scene=patch['flags.kg-realms.local.scene'];};
  foundry.applications.api.DialogV2.wait=async()=>({includeTokens:false});
  const node=sceneTemplates(f.root).find(n=>n.id===I),first=await regenerateSceneCopy(f.root,node),second=await regenerateSceneCopy(f.root,node);
  assert.notEqual(first.id,second.id);assert.equal(pin.flags['kg-realms'].local.scene,second.id);assert.ok(game.scenes.has(first.id));
});

test('selected generation without tokens and concurrent clicks create one clean scene with its full map content',async()=>{
  const f=await fixture();await Promise.all([generateSelectedScenes(f.root,[L],{includeTokens:false}),generateSelectedScenes(f.root,[L],{includeTokens:false})]);
  assert.equal(game.scenes.get(L).tokens.length,0);assert.equal(game.scenes.get(L).tiles.length,1);
  assert.equal(f.created.filter(([type,id])=>type==='Scene'&&id===L).length,1);assert.equal(game.actors.size,0);
});

test('missing packaged scenes stop generation and leave the setup incomplete for a retry',async()=>{
  const f=await fixture(),path=`modules/${MODULE}/data/worlds/${CHILD}/packs/scenes.json`;
  const docs=JSON.parse(new TextDecoder().decode(f.served.get(path))).filter(s=>s._id!==L);f.served.set(path,jsonBytes(docs));
  foundry.applications.api.DialogV2.wait=async()=>({ids:[L],includeTokens:true});
  await assert.rejects(()=>openSceneChecklist(f.root),/packaged scene.*missing/);
  assert.equal(game.scenes.has(L),false);assert.equal(f.settings.get('sceneTemplateSetup'),undefined);
});

test('an exported module can be re-exported with every ungenerated scene and document still included',async()=>{
  const f=await fixture();assert.equal(game.scenes.size,0);
  const data={places:jsonFile(f.files,`${MODULE}/data/worlds/${ROOT}/index.json`).places,routeEdits:{},waterways:{},biomes:{},encounters:{},tradeEdits:{},markers:{},regionalLinks:[],regionalEdits:{}};
  setExportData(async id=>({...data,places:jsonFile(f.files,`${MODULE}/data/worlds/${id}/index.json`).places,regionalLinks:[]}));
  // No scenes or Regional settings have been generated in this installation.
  const again=await buildExport(f.root,{moduleId:'second-bundle',title:'Second export',version:'1.0.0',rootScene:R});
  assert.equal(again.problems,0);const files=await unzip(again.parts);
  const docs=jsonFile(files,`second-bundle/data/worlds/${CHILD}/packs/scenes.json`);assert.ok(docs.some(s=>s._id===L));assert.ok(docs.some(s=>s._id===I));
  assert.ok(jsonFile(files,`second-bundle/data/worlds/${CHILD}/packs/actors.json`).some(a=>a._id===A));
  assert.ok(files.has(docs.find(s=>s._id===L).tiles[0].texture.src.replace(/^modules\//,'')));
});

test('locally regenerated background tiles and their master image survive export and a fresh on-demand import',async()=>{
  const f=await fixture({retiled:true});await generateSelectedScenes(f.root,[L]);
  const scene=game.scenes.get(L),asset=scene.flags['kg-realms'].localMap.tileAsset;
  assert.match(asset.lodManifest,/^modules\/template-bundle\//);assert.equal(asset.dataRoot,undefined);
  assert.equal(new TextDecoder().decode(f.served.get(decodeURIComponent(scene.background.src))),'EDITABLE MASTER');
  const resolved=await resolveLocalLods(mapAsset(scene));assert.equal(resolved.lods.length,3);
  for(const tile of resolved.lods.flatMap(l=>l.tiles)){assert.match(tile.src,/^modules\/template-bundle\/assets\/maps\/ktx2\/.*\.ktx2$/);assert.ok(f.served.has(tile.src));}
  assert.equal(scene.tiles[0].elevation,20);assert.deepEqual(scene.tiles[0].occlusion,{mode:3});
  const placed=placedTileAsset(scene.tiles[0]);assert.ok(placed);assert.equal(placed.dataRoot,undefined);
  assert.equal(new TextDecoder().decode(f.served.get(placed.source)),'TILED ART');assert.equal(new TextDecoder().decode(f.served.get(placed.preview)),'TILE PREVIEW');
  for(const tile of (await resolveLocalLods(placed)).lods.flatMap(l=>l.tiles))assert.ok(f.served.has(tile.src));
  assert.ok(f.requests.every(path=>path.startsWith(`modules/${MODULE}/`)));
});

test('re-exporting retiled scenes resolves encoded source filenames with spaces',async()=>{
  const f=await fixture({retiled:true});
  setExportData(async id=>({places:jsonFile(f.files,`${MODULE}/data/worlds/${id}/index.json`).places,routeEdits:{},waterways:{},biomes:{},encounters:{},tradeEdits:{},markers:{},regionalLinks:[],regionalEdits:{}}));
  const built=await buildExport(f.root,{moduleId:'space-bundle',title:'Round trip',version:'1.0.0',rootScene:R});
  assert.equal(built.problems,0);const files=await unzip(built.parts),scene=jsonFile(files,`space-bundle/data/worlds/${CHILD}/packs/scenes.json`).find(s=>s._id===L);
  const source=decodeURIComponent(scene.background.src).replace(/^modules\//,'');assert.equal(new TextDecoder().decode(files.get(source)),'EDITABLE MASTER');
});

test('the export UI refuses to download a module with a missing required file and lists what needs repair',async()=>{
  const f=await fixture(),data={places:jsonFile(f.files,`${MODULE}/data/worlds/${ROOT}/index.json`).places,routeEdits:{},waterways:{},biomes:{},encounters:{},tradeEdits:{},markers:{},regionalLinks:[],regionalEdits:{}};
  setExportData(async id=>({...data,places:jsonFile(f.files,`${MODULE}/data/worlds/${id}/index.json`).places,regionalLinks:[]}));
  const source=jsonFile(f.files,`${MODULE}/data/worlds/${CHILD}/packs/scenes.json`).find(s=>s._id===L).tiles[0].texture.src;f.served.delete(source);
  let downloads=0,report;
  foundry.utils.saveDataToFile=()=>{downloads++;};
  foundry.applications.api.DialogV2.wait=async options=>{if(options.window.title==='Export needs repair'){report=options;return null;}return{id:'strict-bundle',title:'Strict export',version:'1.0.0'};};
  ui.notifications.remove=()=>{};
  await exportModule(f.root,R);
  assert.equal(downloads,0);assert.equal(report.window.title,'Export needs repair');assert.match(report.content,/module was not downloaded/);assert.ok(report.content.includes(source));
});

test('Download repair report saves source locations and failed values as JSON without exporting an incomplete module or changing scenes',async()=>{
  const f=await fixture();exportedData(f);await generateSelectedScenes(f.root,[L]);
  const scene=game.scenes.get(L),before=scene.toObject(),source=scene.tiles[0].texture.src;f.served.delete(source);
  const downloads=[];
  foundry.utils.saveDataToFile=(data,type,name)=>downloads.push({data,type,name});
  foundry.applications.api.DialogV2.wait=async options=>{
    if(options.window.title!=='Export needs repair')return{id:'repair-bundle',title:'Repair export',version:'2',includeTravel:false,includeCardActors:false};
    const button=options.buttons.find(b=>b.action==='download');assert.equal(button.label,'Download repair report');return button.callback();
  };
  ui.notifications.remove=()=>{};
  await exportModule(f.root,R);
  assert.equal(downloads.length,1);assert.equal(downloads[0].type,'application/json');assert.equal(downloads[0].name,'repair-bundle-export-repair.json');
  const packet=JSON.parse(downloads[0].data);assert.equal(packet.kind,'kg-realms-export-repair');assert.equal(packet.schema,1);assert.equal(packet.export.rootScene,R);assert.equal(packet.export.includeTravel,false);assert.equal(packet.export.includeCardActors,false);assert.ok(packet.problemCount>0);
  const issue=packet.worlds.flatMap(w=>w.issues).find(i=>i.path===source);assert.equal(issue.kind,'missing-file');assert.match(issue.error,/HTTP 404/);
  const location=issue.uses.find(u=>u.documentId===L);assert.equal(location.documentName,'Stonebridge');assert.equal(location.documentType,'Scene');assert.deepEqual(location.path,['tiles',0,'texture','src']);assert.equal(location.embedded[0].id,'tile');assert.equal(location.value,source);
  assert.ok(location.sourceUuids.includes(`Scene.${L}`));assert.match(packet.report,/Stonebridge/);assert.equal(packet.parts,undefined);assert.deepEqual(scene.toObject(),before);
});
