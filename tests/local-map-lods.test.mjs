import "./helpers/worlds.mjs";
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {LOCAL_MAP_ASSETS} from '../../kg-realms-faerun/scripts/local-map-assets.mjs';
import {mapAsset} from '../scripts/local-map-renderer.mjs';
import {resolveLocalLods,LocalMapLodSurface} from '../scripts/local-map-lods.mjs';
import {LocalMaps} from '../scripts/local-maps.mjs';
const asset=LOCAL_MAP_ASSETS.find(a=>a.id==='waterdeep');
const catalog=JSON.parse(readFileSync(new URL('../data/worlds/toril/local/waterdeep-lods.json',import.meta.url),'utf8'));
test('Waterdeep retains the complete native bounds at all three levels and every KTX2 is block-aligned with one texture level',()=>{
  assert.equal(catalog.width,19400);assert.equal(catalog.height,28050);assert.deepEqual(catalog.lods.map(l=>l.tiles.length),[4,35,140]);
  for(const lod of catalog.lods){assert.ok(Math.abs(lod.tiles.reduce((n,t)=>n+t.width*t.height,0)-catalog.width*catalog.height)<.01);
    for(const t of lod.tiles){const file=new URL('../'+t.src.replace(/^modules\/kg-realms(-faerun)?\//,''),import.meta.url),bytes=readFileSync(file);
      assert.equal(bytes.readUInt32LE(20),t.textureWidth);assert.equal(bytes.readUInt32LE(24),t.textureHeight);assert.equal(bytes.readUInt32LE(40),1);
      assert.equal(t.textureWidth%4,0);assert.equal(t.textureHeight%4,0);assert.equal(bytes.length,t.ktxBytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),t.hash);
      assert.equal(t.webpSrc,undefined);// KTX2 only: no WebP tile to fall back on.
    }
  }
});
test('the Waterdeep default cannot replace another local map with custom artwork or a different preset',()=>{
  const scene=local=>({background:{src:null},flags:{'kg-realms':{localMap:{world:'toril',placeId:asset.placeId,...local}}}});
  assert.equal(mapAsset(scene({})),null);assert.equal(mapAsset(scene({map:'custom-waterdeep.webp'})),null);
  assert.equal(mapAsset(scene({presetId:'waterdeep-v2'})),asset);assert.equal(mapAsset(scene({map:asset.source})),asset);
});
test('local catalogue loading validates data, shares requests and can recover after a malformed response',async()=>{
  const old={fetch:globalThis.fetch,foundry:globalThis.foundry};let reads=0;
  try{
    globalThis.foundry={utils:{getRoute:p=>p}};globalThis.fetch=async()=>{reads++;const data=structuredClone(catalog);data.lods[0].tiles[0].width=NaN;return{ok:true,json:async()=>data};};
    await assert.rejects(()=>resolveLocalLods(asset),/texture geometry/);
    globalThis.fetch=async()=>{reads++;return{ok:true,json:async()=>structuredClone(catalog)}};
    const [a,b]=await Promise.all([resolveLocalLods(asset),resolveLocalLods(asset)]);assert.equal(a,b);assert.equal(reads,2);assert.equal(a.lods.length,3);
  }finally{Object.assign(globalThis,old)}
});
test('Waterdeep is created as a separate settlement with its default places and roads, without replacing a valid existing map link',async()=>{
  const old={game:globalThis.game,foundry:globalThis.foundry,fetch:globalThis.fetch,Scene:globalThis.Scene};
  try{
    const preset=JSON.parse(readFileSync(new URL('../data/worlds/toril/local/waterdeep.json',import.meta.url),'utf8'));
    const custom={id:'custom',name:'My Waterdeep',width:1000,height:1000,getFlag:()=>null},scenes=[custom];scenes.get=id=>scenes.find(s=>s.id===id);
    globalThis.game={user:{isGM:true},scenes,release:{generation:13}};globalThis.foundry={utils:{getRoute:p=>p}};globalThis.fetch=async()=>({json:async()=>structuredClone(preset)});
    globalThis.Scene={async create(data){const flags={};const scene={...data,id:'new-waterdeep',notes:[],getFlag:(m,k)=>flags[k],async setFlag(m,k,v){flags[k]=v},async createEmbeddedDocuments(type,docs){scene.notes.push(...docs.map(d=>({...d,getFlag:(m,k)=>d.flags?.[m]?.[k]})));return docs;}};scenes.push(scene);return scene;}};
    const links=[],maps=new LocalMaps({getRealmPlaces:async()=>[{id:asset.placeId,scene:'custom'}],savePlaceEdit:async(...args)=>links.push(args)});maps.ensureEntrance=async()=>{};
    const result=await maps.applyPreset({id:'waterdeep-v2',file:'waterdeep.json',revision:1},{create:true});
    assert.equal(result.scene.id,'new-waterdeep');assert.equal(result.scene.width,19400);assert.equal(result.scene.height,28050);assert.equal(result.scene.getFlag('kg-realms','localMap').presetId,'waterdeep-v2');
    assert.equal(links.length,0);assert.equal(custom.name,'My Waterdeep');assert.equal(result.scene.notes.length,preset.places.length);assert.equal(mapAsset(result.scene),asset);
    // The defaults: the places inside the scene, the roads, the icon pack and the marker size.
    assert.ok(preset.places.length>100);assert.ok(preset.places.every(p=>p.x>=0&&p.y>=0&&p.x<=19400&&p.y<=28050));
    assert.deepEqual(result.scene.getFlag('kg-realms','cityRoads').roads.map(r=>r.id),preset.roads.roads.map(r=>r.id));
    assert.equal(result.scene.getFlag('kg-realms','localMap').iconPack,preset.iconPack);assert.equal(result.scene.getFlag('kg-realms','localMap').markerScale,preset.markerScale);
  }finally{Object.assign(globalThis,old)}
});

function surfaceFixture({failAdd=false}={}){
  const frames=[],meshes=[],released=[];
  class Texture{
    constructor(base,frame){this.baseTexture=base;this.width=frame?.width??8;this.height=frame?.height??8;frames.push(this);}
    destroy(base){assert.equal(base,false);this.baseTexture=null;}
  }
  class Mesh{
    constructor({texture}){this.texture=texture;this.anchor={set(){}};this.position={set(){}};meshes.push(this);}
    // A computed visibility accessor must never be overwritten by the LOD loader.
    get visible(){return true;}
    destroy(){this.destroyed=true;}
  }
  const primary={background:{transform:{},get visible(){return false;},elevation:0,sortLayer:0,zIndex:-Infinity,alpha:1,tint:0xffffff},children:[],
    addChild(m){this.children.push(m);m.parent=this;if(failAdd)throw Error('Insertion failed');},
    removeChild(m){this.children.splice(this.children.indexOf(m),1);m.parent=null;}};
  const canvas={primary,scene:{id:'test'},dimensions:{sceneX:5,sceneY:7,sceneWidth:16,sceneHeight:16}};
  const tile={id:'test',lod:0,textureWidth:8,textureHeight:8,frameX:0,frameY:0,frameWidth:8,frameHeight:8,x:0,y:0,width:8,height:8};
  const surface=new LocalMapLodSurface({asset:{id:'test',width:16,height:16,lods:[{z:-3}]},canvas,PIXI:{Texture,Rectangle:class{constructor(x,y,width,height){Object.assign(this,{x,y,width,height});}}},Mesh});
  surface.decoder={acquire:async()=>({width:8,height:8,baseTexture:{resource:{_levelBuffers:[{levelBuffer:new Uint8Array(16)}]}}}),release:async t=>{released.push(t.id);}};
  return{surface,tile,primary,frames,meshes,released};
}

test('LOD tiles render with computed visibility and hide cached detail using renderable',async()=>{
  const f=surfaceFixture(),r=await f.surface.load(f.tile),h=r.upload();await r.release();
  assert.equal(f.primary.children.length,1);assert.equal(h.mesh.renderable,false);assert.deepEqual(f.released,[]);
  f.surface.cache={resident:new Map([['test',{tile:f.tile,handle:h}]]),status:()=>({errors:[],rootReady:false})};
  f.surface.activeLod=0;f.surface.changed();assert.equal(h.mesh.renderable,true);
  f.surface.activeLod=-3;f.surface.changed();assert.equal(h.mesh.renderable,false);assert.equal(h.mesh.visible,true);
  h.dispose();assert.equal(f.primary.children.length,0);assert.equal(f.frames[0].baseTexture,null);assert.deepEqual(f.released,['test']);
});

test('a failed tile insertion removes the partial mesh, crop frame and decoder reference',async()=>{
  const f=surfaceFixture({failAdd:true}),r=await f.surface.load(f.tile),log=console.error;console.error=()=>{};
  try{assert.throws(()=>r.upload(),/Insertion failed/);}finally{console.error=log;}
  await r.release();assert.equal(f.primary.children.length,0);assert.equal(f.meshes[0].destroyed,true);assert.equal(f.frames[0].baseTexture,null);assert.deepEqual(f.released,['test']);
});
