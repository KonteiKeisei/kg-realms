import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LocalMapEffects, enableLocalMapFx} from '../scripts/local-map-effects.mjs';
import {gmGame} from './helpers/journey.mjs';

function setup(plus=true) {
  const values=new Map([['kg-realms.localMapFxEnabled',false],['fxmaster.disableAll',true]]),writes=[];
  gmGame({modules:new Map([['fxmaster',{active:true}],['fxmaster-plus',{active:plus}]]),settings:{settings:new Map([['fxmaster.disableAll',{}]]),get:(m,k)=>values.get(m+'.'+k)??'',set:async(m,k,v)=>{writes.push([m,k,v]);values.set(m+'.'+k,v);}}});
  globalThis.ui={notifications:{info(){}}};globalThis.foundry={utils:{getRoute:p=>p}};
  globalThis.CONFIG={RegionBehavior:{dataModels:{'fxmaster.filterEffectsRegion':class{}}}};
  const data={schema:1,source:{width:100,height:100,padding:.25,gridSize:100},lights:[{_id:'light1',x:30,y:40,config:{dim:1}}],regions:[{_id:'region1',shapes:[],behaviors:[{_id:'behavior1',type:'fxmaster.filterEffectsRegion',system:{water_enabled:true},disabled:false}]}]};
  let reads=0;globalThis.fetch=async()=>{reads++;return{ok:true,json:async()=>structuredClone(data)}};
  const region=d=>({...d,id:d._id,async updateEmbeddedDocuments(type,updates){for(const u of updates)Object.assign(this.behaviors.find(b=>b._id===u._id),u);}});
  const scene={id:'city',name:'City',width:100,height:100,padding:.25,grid:{size:100},lights:[],regions:[],flags:{},created:[],getFlag(m,k){return this.flags[k]},async setFlag(m,k,v){this.flags[k]=v},async createEmbeddedDocuments(type,docs,options){this.created.push({type,docs,options});const collection=type==='Region'?this.regions:this.lights;collection.push(...docs.map(d=>type==='Region'?region(d):({...d,id:d._id})));}};
  return {scene,data,values,writes,reads:()=>reads};
}

test('stock lights and global FX regions seed once, and later GM deletions survive a new defaults revision',async()=>{
  const f=setup(),effects=new LocalMapEffects(),entry={file:'city-effects.json',revision:1};
  await Promise.all([effects.apply(f.scene,entry),effects.apply(f.scene,entry)]);
  assert.deepEqual(f.scene.created.map(c=>c.type),['AmbientLight','Region']);assert.equal(f.reads(),1);
  assert.equal(f.scene.created[1].options.keepId,true);assert.equal(f.scene.regions[0].behaviors[0].disabled,false);
  await effects.apply(f.scene,entry);assert.equal(f.scene.created.length,2);assert.equal(f.reads(),1);
  f.scene.lights=[];f.scene.regions=[];await effects.apply(f.scene,{...entry,revision:2});
  assert.equal(f.scene.created.length,2);
});

test('without Plus the lights work; enabling Plus later installs the waiting regions',async()=>{
  const f=setup(false),effects=new LocalMapEffects(),entry={file:'city-effects.json',revision:1};
  await effects.apply(f.scene,entry);assert.deepEqual(f.scene.created.map(c=>c.type),['AmbientLight']);
  game.modules.get('fxmaster-plus').active=true;await effects.apply(f.scene,entry);
  assert.deepEqual(f.scene.created.map(c=>c.type),['AmbientLight','Region']);
});

test('existing source IDs or identical copied lights are not duplicated or overwritten',async()=>{
  const f=setup();f.scene.lights=[{...f.data.lights[0],id:'copied-id'}];f.scene.regions=[{id:'region1',shapes:['GM custom shape']}];
  await new LocalMapEffects().apply(f.scene,{file:'city-effects.json',revision:1});
  assert.equal(f.scene.created.length,0);assert.deepEqual(f.scene.regions[0].shapes,['GM custom shape']);
});

test('an unavailable FX region model leaves stock lights usable and can recover later',async()=>{
  const f=setup(),effects=new LocalMapEffects(),entry={file:'city-effects.json',revision:1};
  CONFIG.RegionBehavior.dataModels={};
  await effects.apply(f.scene,entry);
  assert.equal(f.scene.lights.length,1);assert.equal(f.scene.regions.length,0);
  assert.equal(f.scene.flags.localEffects.regions,undefined);
  CONFIG.RegionBehavior.dataModels['fxmaster.filterEffectsRegion']=class{};
  await effects.apply(f.scene,entry);
  assert.equal(f.scene.lights.length,1);assert.equal(f.scene.regions.length,1);
});

test('resized scenes, players and secondary GMs cannot import defaults',async()=>{
  const f=setup(),effects=new LocalMapEffects(),entry={file:'city-effects.json',revision:1};f.scene.width=200;
  await effects.apply(f.scene,entry);assert.equal(f.scene.created.length,0);assert.equal(f.scene.flags.localEffects,undefined);
  f.scene.width=100;game.user.isGM=false;await effects.apply(f.scene,entry);assert.equal(f.scene.created.length,0);
  game.user.isGM=true;game.users.unshift({id:'earlier',isGM:true,active:true});await effects.apply(f.scene,entry);assert.equal(f.scene.created.length,0);
});

test('FXMaster world rendering is enabled once and later GM or client preferences are left alone',async()=>{
  const f=setup();await enableLocalMapFx();assert.equal(f.values.get('fxmaster.disableAll'),false);
  assert.equal(f.writes.length,2);f.values.set('fxmaster.disableAll',true);await enableLocalMapFx();assert.equal(f.values.get('fxmaster.disableAll'),true);
  assert.ok(f.writes.every(([m,k])=>!(m==='fxmaster'&&k==='enable')));
  setup(false);await enableLocalMapFx();assert.equal(game.settings.get('fxmaster','disableAll'),true);
});

test('a changed distance scale cannot silently change the supplied light radii',async()=>{
  const f=setup();f.data.source.gridDistance=5;f.data.source.gridUnits='ft';f.scene.grid.distance=10;f.scene.grid.units='ft';
  const effects=new LocalMapEffects(),entry={file:'city-effects.json',revision:1};
  await effects.apply(f.scene,entry);assert.equal(f.scene.created.length,0);
  f.scene.grid.distance=5;await effects.apply(f.scene,entry);assert.equal(f.scene.lights.length,1);
});

test('the water checkbox defers new regions, suspends existing ones, and restores only previously enabled behaviors',async()=>{
  const f=setup(),effects=new LocalMapEffects(),entry={file:'city-effects.json',revision:1};
  f.values.set('kg-realms.localMapWaterRegions',false);await effects.apply(f.scene,entry);
  assert.equal(f.scene.lights.length,1);assert.equal(f.scene.regions.length,0);
  f.values.set('kg-realms.localMapWaterRegions',true);await effects.apply(f.scene,entry);
  const water=f.scene.regions[0],shape=structuredClone(water.shapes);
  const unrelated={id:'custom-region',behaviors:[{type:'fxmaster.filterEffectsRegion',system:{water_enabled:true},disabled:false}]};f.scene.regions.push(unrelated);
  f.values.set('kg-realms.localMapWaterRegions',false);await effects.apply(f.scene,entry);
  assert.equal(water.behaviors[0].disabled,true);assert.equal(unrelated.behaviors[0].disabled,false);
  assert.deepEqual(water.shapes,shape);
  f.values.set('kg-realms.localMapWaterRegions',true);await effects.apply(f.scene,entry);assert.equal(water.behaviors[0].disabled,false);
  water.behaviors[0].disabled=true;
  f.values.set('kg-realms.localMapWaterRegions',false);await effects.apply(f.scene,entry);
  f.values.set('kg-realms.localMapWaterRegions',true);await effects.apply(f.scene,entry);assert.equal(water.behaviors[0].disabled,true);
});

test('a checkbox change while defaults are loading is applied before the queued work finishes',async()=>{
  const f=setup(),effects=new LocalMapEffects(),entry={file:'city-effects.json',revision:1};let loaded;
  globalThis.fetch=()=>new Promise(resolve=>loaded=()=>resolve({ok:true,json:async()=>structuredClone(f.data)}));
  const initial=effects.apply(f.scene,entry);f.values.set('kg-realms.localMapWaterRegions',false);
  const changed=effects.apply(f.scene,entry);loaded();await Promise.all([initial,changed]);
  assert.equal(f.scene.flags.localEffects.waterEnabled,false);
  assert.equal(f.scene.regions[0]?.behaviors[0].disabled??true,true);
});

test('shipped effects contain the supplied stock lights and only global FXMaster water behaviors',()=>{
  for(const [name,count,regions]of [['luskan',308,1],['helms-hold',255,1],['neverwinter',540,3]]){
    const data=JSON.parse(readFileSync(new URL(`../data/worlds/toril/local/${name}-effects.json`,import.meta.url),'utf8'));
    assert.equal(data.lights.length,count);assert.equal(data.regions.length,regions);
    assert.equal(new Set(data.lights.map(l=>l._id)).size,count);
    assert.ok(data.lights.every(l=>Number.isFinite(l.x)&&Number.isFinite(l.y)&&l.config));
    assert.ok(data.regions.every(r=>r.behaviors.every(b=>b.type==='fxmaster.filterEffectsRegion'&&b.disabled===false&&b.system.water_enabled&&b.system.events.length===0&&b.system._elev_gateMode==='none')));
  }
});
