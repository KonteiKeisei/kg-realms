import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {registerWorld} from '../scripts/worlds.mjs';
import {buildExport,setExportData,restoreModuleRegionalMaps,sceneFromModule} from '../scripts/homebrew/export.mjs';
import {homebrewSheet,planTiles,packManifest} from '../scripts/homebrew/plan.mjs';
import {packFiles} from '../scripts/terrain/asset-store.mjs';
import {generateSelectedScenes} from '../scripts/module-scenes.mjs';

async function unzip(parts){
  const b=new Uint8Array(await new Blob(parts).arrayBuffer()),v=new DataView(b.buffer),decode=new TextDecoder();
  let end=b.length-22;while(v.getUint32(end,true)!==0x06054b50)end--;
  let at=v.getUint32(end+16,true);const files=new Map();
  for(let i=0;i<v.getUint16(end+10,true);i++){
    const size=v.getUint32(at+24,true),len=v.getUint16(at+28,true),offset=v.getUint32(at+42,true),name=decode.decode(b.subarray(at+46,at+46+len));
    const start=offset+30+v.getUint16(offset+26,true);files.set(name,b.slice(start,start+size));at+=46+len;
  }
  return files;
}
const read=(files,path)=>JSON.parse(new TextDecoder().decode(files.get(path)));
const doc=data=>({...data,id:data._id,getFlag:(_m,k)=>data.flags?.['kg-realms']?.[k],toObject:()=>structuredClone(data)});

function fixture(){
  const root='export-parent',children=['export-north','export-east'],served=new Map(),data={},defs={},scenes=[];
  const links=children.map((world,i)=>({world,parent:root,scene:`region${i}`,parentScene:'overview',title:`Detailed ${i}`,footprint:[[i,0],[i+1,0],[i+1,1]],anchors:[{parent:[1,1],region:[10,10]},{parent:[2,1],region:[20,10]},{parent:[1,2],region:[10,20]}],positions:{capital:[15+i,25]},publish:['site'],entrances:[{id:`crossing-${i}`,name:`Trail crossing ${i+1}`}]}));
  for(const [i,id] of [root,...children].entries()){
    const base=`modules/source-${i}`,dir=`${base}/data/worlds/${id}`,bytes=`TILE-${id}`;
    defs[id]=registerWorld({id,title:id,module:`source-${i}`,assetBase:base});
    const sheet=homebrewSheet(128,128,i?150*i:1000),lods=planTiles(sheet);
    for(const lod of lods)for(const t of lod.tiles){t.hash=createHash('sha256').update(bytes).digest('hex');t.ktxBytes=bytes.length;served.set(`${base}/${t.path}`,bytes);}
    served.set(`${dir}/terrain-pack.json`,JSON.stringify(packManifest(id,sheet,lods,'a'.repeat(64))));
    served.set(`${dir}/index.json`,JSON.stringify({world:id,sourceMap:sheet,places:[],routes:'roads.json'}));
    served.set(`${dir}/roads.json`,JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{id:'road'},geometry:{type:'LineString',coordinates:[[1,1],[2,2]]}}]}));
    served.set(`${dir}/local/index.json`,'[]');
    const img=`worlds/demo/${id}/marker.webp`;served.set(img,`ART-${id}`);
    data[id]={places:[{id:'site',name:id,lon:1,lat:2,img}],routeEdits:{},waterways:{},biomes:{zones:{}},encounters:{},tradeEdits:{},markers:{},snow:{north:{on:!!i}},regionalLinks:i?[]:links,regionalEdits:{edits:{capital:{lon:15+i,lat:25},[`crossing-${i-1}`]:{lon:8,lat:9}},added:{}},regionalSnow:false};
    scenes.push(doc({_id:i?`region${i-1}`:'overview',name:id,tokens:[],notes:[],flags:{'kg-realms':{world:id,journey:{secret:true},partyJourneys:{old:{}},...(i?{regionalMap:true}:{})}}}));
  }
  const gm={id:'gm',isGM:true,active:true},settings=new Map();
  const collection=new Map(scenes.map(s=>[s.id,s]));collection.map=fn=>[...collection.values()].map(fn);
  globalThis.location={origin:'http://localhost:30000'};
  globalThis.foundry={utils:{getRoute:p=>`/${p}`,deepClone:structuredClone}};
  globalThis.game={system:{id:'dnd5e'},user:gm,users:Object.assign([gm],{activeGM:gm}),settings:{get:(_m,k)=>settings.get(k),set:async(_m,k,v)=>settings.set(k,structuredClone(v))},actors:new Map(),scenes:collection,modules:{get:()=>({version:'0.93.8'})}};
  globalThis.ui={notifications:{info:()=>{},warn:()=>{},error:()=>{}}};globalThis.fromUuid=async()=>null;
  globalThis.fetch=async url=>{const value=served.get(decodeURIComponent(String(url).replace(/^\//,'')));return {ok:value!==undefined,status:value===undefined?404:200,json:async()=>JSON.parse(value),arrayBuffer:async()=>new TextEncoder().encode(value).buffer};};
  setExportData(async id=>structuredClone(data[id]));
  return {root,children,defs,links,settings,served,data,collection};
}

test('one realm ZIP carries every linked Regional map, independent tiles, scale, roads and import settings',async()=>{
  const f=fixture(),M='bundled-realm';
  const built=await buildExport(f.defs[f.root],{moduleId:M,title:'My realm',version:'1.0.0'}),files=await unzip(built.parts);
  const worlds=[];runInNewContext(new TextDecoder().decode(files.get(`${M}/scripts/main.mjs`)),{Hooks:{once:(_name,fn)=>fn({registerWorld:w=>worlds.push(JSON.parse(JSON.stringify(w)))})}});
  assert.deepEqual(worlds.map(w=>w.id),[f.root,...f.children]);
  assert.deepEqual(worlds[0].regionalMaps.links,f.links);
  const tilePaths=[];
  for(const [i,id] of [f.root,...f.children].entries()){
    const path=`${M}/data/worlds/${id}`,index=read(files,`${path}/index.json`),pack=read(files,`${path}/terrain-pack.json`);
    assert.equal(index.sourceMap.milesPerPixel,(i?150*i:1000)/128);
    assert.equal(read(files,`${path}/roads.json`).features.length,1);
    for(const t of packFiles(pack).values()){tilePaths.push(t.path);assert.equal(new TextDecoder().decode(files.get(`${M}/${t.path}`)),`TILE-${id}`);}
    const image=index.places[0].img.replace(/^modules\//,'');assert.equal(new TextDecoder().decode(files.get(image)),`ART-${id}`);
    const scene=read(files,`${path}/packs/scenes.json`)[0];assert.equal(scene.flags['kg-realms'].journey,undefined);assert.equal(scene.flags['kg-realms'].partyJourneys,undefined);
  }
  assert.equal(new Set(tilePaths).size,tilePaths.length,'identical source filenames do not overwrite another map');
  assert.match(built.report,/Regional maps included: 2/);assert.equal(built.problems,0);
  for(const w of worlds)registerWorld(w);
  f.collection.delete('region0');f.collection.delete('region1');
  await restoreModuleRegionalMaps();assert.equal(f.settings.get('regionalMaps'),undefined,'wait for linked scenes');
  const imported=worlds.flatMap(w=>read(files,`${M}/data/worlds/${w.id}/packs/scenes.json`));
  game.packs={get:()=>({getIndex:async()=>imported.map(s=>({_id:s._id})),getDocument:async id=>({toObject:()=>structuredClone(imported.find(s=>s._id===id))})})};
  globalThis.getDocumentClass=()=>({create:async d=>{const s=doc(d);f.collection.set(s.id,s);return s;}});
  // Import the realm, then generate only the detailed scenes selected in the checklist.
  f.collection.set('overview',doc(imported.find(s=>s._id==='overview')));
  await sceneFromModule(f.collection.get('overview'),{kgRealmsSceneSetup:true},'gm');
  assert.equal(f.collection.has('region0'),false,'new exports do not eagerly import unchecked scenes');
  for(const [path,bytes] of files)f.served.set(`modules/${path}`,new TextDecoder().decode(bytes));
  await generateSelectedScenes(worlds[0],['region0','region1']);
  for(const [i,id] of f.children.entries()){
    assert.ok(f.collection.has(`region${i}`));assert.deepEqual(f.settings.get('regionalMaps')[id],f.links[i]);
    assert.deepEqual(f.settings.get('placeEdits')[id],f.data[id].regionalEdits);
    assert.equal(f.settings.get('regionalSnow')[id],false);
  }
  f.settings.delete('regionalMaps');
  await sceneFromModule(f.collection.get('overview'),{},'another-gm');
  assert.deepEqual(f.settings.get('regionalMaps')[f.children[0]],f.links[0],'the active GM adopts links for scenes imported by another GM');
});

test('missing Regional scene or data blocks the export instead of producing an incomplete realm',async()=>{
  const f=fixture(),options={moduleId:'bundle-missing',title:'Realm',version:'1'};
  f.collection.delete('region0');await assert.rejects(()=>buildExport(f.defs[f.root],options),/missing.*registered data or linked scene/);
  f.collection.set('region0',doc({_id:'region0',tokens:[],notes:[],flags:{'kg-realms':{world:f.children[0]}}}));
  f.served.delete(`${f.defs[f.children[0]].root}/terrain-pack.json`);
  await assert.rejects(()=>buildExport(f.defs[f.root],options),/terrain-pack.json: HTTP 404/);
});

test('Regional import preserves existing campaign links, marker edits and snow choices',async()=>{
  const f=fixture(),id=f.children[0],prior={...f.links[0],title:'GM-adjusted link'};
  registerWorld({...f.defs[f.root],regionalMaps:{schema:1,links:f.links,state:{[id]:{placeEdits:{edits:{capital:{lon:99}},added:{}},snow:false}}}});
  f.settings.set('regionalMaps',{[id]:prior});f.settings.set('placeEdits',{[id]:{edits:{capital:{lon:123}},added:{}}});f.settings.set('regionalSnow',{[id]:true});
  await restoreModuleRegionalMaps();assert.deepEqual(f.settings.get('regionalMaps')[id],prior);assert.equal(f.settings.get('placeEdits')[id].edits.capital.lon,123);assert.equal(f.settings.get('regionalSnow')[id],true);
});

test('Regional source restoration preserves a world whose only customization is permanent deletions',async()=>{
  const f=fixture(),id=f.children[0];
  registerWorld({...f.defs[f.root],regionalMaps:{schema:1,links:f.links,state:{[id]:{placeEdits:{edits:{capital:{name:'Source'}},added:{}},snow:false}}}});
  const own={edits:{},added:{},deleted:['capital']};f.settings.set('placeEdits',{[id]:own});await restoreModuleRegionalMaps();assert.deepEqual(f.settings.get('placeEdits')[id],own);
});

test('realm exports omit permanently deleted canonical places from Regional copies too',async()=>{
  const f=fixture(),id=f.children[0],M='deletion-export';
  f.data[f.root].regionalEdits={edits:{},added:{},deleted:['doomed']};f.data[f.root].places.push({id:'doomed',name:'Deleted place',kind:'site',lon:0,lat:0});f.data[id].places.push({id:'copy',name:'Deleted copy',kind:'site',canonicalWorld:f.root,canonicalId:'doomed',lon:0,lat:0});
  const built=await buildExport(f.defs[f.root],{moduleId:M,title:'Realm',version:'1'}),files=await unzip(built.parts);
  assert.ok(!read(files,`${M}/data/worlds/${f.root}/index.json`).places.some(p=>p.id==='doomed'));assert.ok(!read(files,`${M}/data/worlds/${id}/index.json`).places.some(p=>p.id==='copy'));
  assert.ok(f.data[id].places.some(p=>p.id==='copy'),'live source data is unchanged');
});
