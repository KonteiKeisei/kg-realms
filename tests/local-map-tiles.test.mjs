import test from 'node:test';
import assert from 'node:assert/strict';
import {planLocalTiles,buildLocalMapTiles,localMapPicture,stagePlacedMapTiles} from '../scripts/local-map-tiles.mjs';
import {placedTextureSize,placedTileAsset,tileInView,PlacedTileLods} from '../scripts/placed-tile-lods.mjs';
import {mapAsset} from '../scripts/local-map-renderer.mjs';
import {lodSrcAllowed,resolveLocalLods} from '../scripts/local-map-lods.mjs';
import {parseHTML} from 'linkedom';
import {upload} from '../scripts/homebrew/homebrew.mjs';

function fakeTile(tile){const bytes=new Uint8Array(80),v=new DataView(bytes.buffer);bytes.set([0xab,0x4b,0x54,0x58,0x20,0x32,0x30,0xbb,0x0d,0x0a,0x1a,0x0a]);v.setUint32(20,tile.textureWidth,true);v.setUint32(24,tile.textureHeight,true);v.setUint32(40,1,true);v.setUint32(44,1,true);return bytes;}
function fixture(){
  const stored=new Map(),updates=[],progress=[];let closed=false;
  const scene={id:'local-scene',name:'Stonebridge',width:1021,height:513,grid:{size:100,distance:10,units:'ft'},background:{src:'worlds/table/old.webp'},tiles:[{elevation:20,sort:4,occlusion:{mode:3},roof:true,texture:{src:'worlds/table/roof.webp'}}],walls:[{c:[1,2,3,4]}],lights:[{x:1,y:2}],tokens:[{actorId:'npc'}],notes:[{x:30,y:40}],flags:{'kg-realms':{localMap:{world:'trorune',placeId:'town',markerScale:2},cityRoads:{roads:[{id:'main'}]}}},getFlag(m,k){return this.flags[m]?.[k];},async update(patch){updates.push(structuredClone(patch));this.flags['kg-realms'].localMap.tileAsset=patch['flags.kg-realms.localMap.tileAsset'];if('background.src'in patch)this.background.src=patch['background.src'];}};
  globalThis.game={release:{generation:13}};globalThis.foundry={utils:{getRoute:p=>p,escapeHTML:String}};
  const io={authority:()=>true,buildId:crypto.randomUUID(),picture:async()=>({width:1021,height:513,close:()=>{closed=true;}}),prepare:async()=>{},encode:async(_bitmap,tile)=>fakeTile(tile),write:async(path,bytes)=>stored.set(path,new Uint8Array(bytes)),read:async path=>stored.get(path),progress:(...args)=>progress.push(args)};
  return{scene,io,stored,updates,progress,closed:()=>closed};
}

test('local tile plans cover odd image dimensions at three detail levels with bounded textures',()=>{
  const plan=planLocalTiles(4097,2039,{sceneId:'town',buildId:'build'});
  assert.deepEqual(plan.lods.map(l=>l.z),[-2,-1,0]);
  for(const lod of plan.lods){
    assert.equal(Math.max(...lod.tiles.map(t=>t.x+t.width)),4097);assert.equal(Math.max(...lod.tiles.map(t=>t.y+t.height)),2039);
    for(const t of lod.tiles){assert.ok(t.textureWidth<=1024&&t.textureHeight<=1024);assert.equal(t.textureWidth%4,0);assert.equal(t.textureHeight%4,0);assert.ok(t.frameX+t.frameWidth<=t.textureWidth);assert.ok(t.frameY+t.frameHeight<=t.textureHeight);}
  }
  assert.throws(()=>planLocalTiles(20000,1000,{sceneId:'town',buildId:'build'}),/Invalid/);
  assert.throws(()=>planLocalTiles(10,10,{sceneId:'../town',buildId:'build'}),/identity/);
});

test('local retiling verifies uploaded files then changes only the background and tile selection',async()=>{
  const f=fixture(),before=structuredClone({grid:f.scene.grid,tiles:f.scene.tiles,walls:f.scene.walls,lights:f.scene.lights,tokens:f.scene.tokens,notes:f.scene.notes,roads:f.scene.flags['kg-realms'].cityRoads});
  const asset=await buildLocalMapTiles(f.scene,'worlds/table/new-master.webp',f.io);
  assert.equal(f.updates.length,1);assert.equal(f.scene.background.src,'worlds/table/new-master.webp');
  assert.equal(asset.placeId,'town');assert.equal(f.scene.getFlag('kg-realms','localMap').markerScale,2);
  assert.deepEqual({grid:f.scene.grid,tiles:f.scene.tiles,walls:f.scene.walls,lights:f.scene.lights,tokens:f.scene.tokens,notes:f.scene.notes,roads:f.scene.flags['kg-realms'].cityRoads},before);
  assert.equal(f.closed(),true);assert.equal(mapAsset(f.scene),asset);
  globalThis.fetch=async path=>({ok:f.stored.has(path),status:200,json:async()=>JSON.parse(new TextDecoder().decode(f.stored.get(path)))});
  const resolved=await resolveLocalLods(asset);assert.equal(resolved.lods.length,3);
  assert.ok(resolved.lods.every(l=>l.tiles.every(t=>lodSrcAllowed(t.src,asset.city,asset))));
  f.scene.background.src='worlds/table/another-master.webp';assert.equal(mapAsset(f.scene),null,'a newly saved image can render normally before it is retiled');
});

test('changed upload bytes, cancellation and authority loss never publish partially built local tiles',async()=>{
  for(const mode of ['corrupt','cancel','authority']){
    const f=fixture();let stop=false,allowed=true;f.io.authority=()=>allowed;f.io.cancelled=()=>stop;
    if(mode==='corrupt')f.io.read=async path=>{const bytes=f.stored.get(path).slice();bytes[0]^=1;return bytes;};
    if(mode==='cancel')f.io.encode=async(_bitmap,tile)=>{stop=true;return fakeTile(tile);};
    if(mode==='authority'){const write=f.io.write;f.io.write=async(...args)=>{await write(...args);allowed=false;};}
    await assert.rejects(()=>buildLocalMapTiles(f.scene,'worlds/table/new.webp',f.io));
    assert.equal(f.updates.length,0,mode);assert.equal(f.scene.background.src,'worlds/table/old.webp',mode);assert.equal(f.scene.getFlag('kg-realms','localMap').tileAsset,undefined,mode);assert.equal(f.closed(),true,mode);
  }
});

test('a concurrent tile replacement or local-map relink is detected before commit',async()=>{
  const f=fixture(),write=f.io.write;f.io.write=async(...args)=>{await write(...args);if(args[0].endsWith('lods.json'))f.scene.flags['kg-realms'].localMap.placeId='different-place';};
  await assert.rejects(()=>buildLocalMapTiles(f.scene,'worlds/table/new.webp',f.io),/changed during/);assert.equal(f.updates.length,0);
});

test('local tile paths are limited to their build folder and cannot escape through a catalogue',()=>{
  const asset={dataRoot:'KG Realms Data/Local/town/build'},city='scene-town';
  assert.equal(lodSrcAllowed(`${asset.dataRoot}/assets/maps/ktx2/${city}/z0-0-0.ktx2.fbx`,city,asset),true);
  for(const src of [`${asset.dataRoot}/assets/maps/ktx2/${city}/../secret.ktx2.fbx`,'worlds/other/secret.ktx2',`${asset.dataRoot}/assets/maps/ktx2/other/z.ktx2.fbx`])assert.equal(lodSrcAllowed(src,city,asset),false);
  assert.equal(lodSrcAllowed('KG Realms Data/Local/../secret/assets/maps/ktx2/scene-town/z.ktx2',city,{dataRoot:'KG Realms Data/Local/../secret'}),false);
});

test('Configure Scene offers local retiling alongside the native Background Image field without changing it',()=>{
  const f=fixture(),{document}=parseHTML('<html><body><form><div class="form-group"><input name="background.src" value="worlds/table/new.webp"></div></form></body></html>');globalThis.document=document;
  localMapPicture(document.body,f.scene);localMapPicture(document.body,f.scene);
  assert.equal(document.querySelectorAll('[data-kgr-local-map-picture]').length,1);
  assert.equal(document.querySelector('input').value,'worlds/table/new.webp');assert.match(document.querySelector('button').textContent,/Regenerate local map tiles from Background Image/);
  assert.equal(f.updates.length,0);
});

test('Foundry 14 restores the level background if publishing the local tile flag fails',async()=>{
  const f=fixture();game.release.generation=14;
  const level={background:{src:'old-level.webp'},async update(patch){this.background.src=patch['background.src'];}};
  f.scene.levels={size:1,contents:[level]};f.scene.firstLevel=level;f.scene.update=async()=>{throw Error('Cannot save scene');};
  await assert.rejects(()=>buildLocalMapTiles(f.scene,'new-level.webp',f.io),/Cannot save/);assert.equal(level.background.src,'old-level.webp');
});

function placedFixture(){
  const f=fixture();f.io.preview=async()=>new Uint8Array([1,2,3]);
  f.scene.tiles=[{id:'floor',texture:{src:'floor.webp',scaleX:-1,scaleY:1,anchorX:.4,fit:'contain'},x:40,y:50,width:400,height:200,rotation:32,elevation:0,sort:5,alpha:.75,occlusion:{mode:0},flags:{}},{id:'roof',texture:{src:'roof.webp',scaleX:1,scaleY:1},x:10,y:20,width:600,height:450,elevation:20,occlusion:{mode:3,alpha:.2},sort:9,flags:{}},{id:'video',texture:{src:'rain.webm'},elevation:30}];
  f.scene.updateEmbeddedDocuments=async(type,patches)=>{assert.equal(type,'Tile');for(const patch of patches){const tile=f.scene.tiles.find(t=>t.id===patch._id);tile.texture.src=patch['texture.src'];tile.flags??={};tile.flags['kg-realms']??={};if('flags.kg-realms.-=tileAsset'in patch)delete tile.flags['kg-realms'].tileAsset;else tile.flags['kg-realms'].tileAsset=patch['flags.kg-realms.tileAsset'];}};
  return f;
}
test('placed image tiles keep independent elevation, rotation, geometry and occlusion, with rollback and native video',async()=>{
  const f=placedFixture(),before=structuredClone(f.scene.tiles),restore=await stagePlacedMapTiles(f.scene,f.io);
  for(const [i,tile] of f.scene.tiles.entries()){
    if(tile.id==='video'){assert.deepEqual(tile,before[i]);continue;}
    const asset=placedTileAsset(tile);assert.ok(asset);assert.equal(asset.source,before[i].texture.src);assert.match(asset.preview,/preview.png$/);
    const actual=structuredClone(tile);actual.texture.src=before[i].texture.src;actual.flags={};assert.deepEqual(actual,before[i]);
  }
  assert.notEqual(placedTileAsset(f.scene.tiles[0]).id,placedTileAsset(f.scene.tiles[1]).id);
  await restore();assert.deepEqual(f.scene.tiles,before.map(t=>t.id==='video'?t:{...t,flags:{'kg-realms':{}}}));
});
test('background publish failure restores placed tile source selections',async()=>{
  const f=placedFixture(),before=structuredClone(f.scene.tiles);f.scene.update=async()=>{throw Error('Save failed');};
  await assert.rejects(()=>buildLocalMapTiles(f.scene,'new-background.webp',{...f.io,beforePublish:()=>stagePlacedMapTiles(f.scene,f.io)}),/Save failed/);
  assert.deepEqual(f.scene.tiles.map(t=>t.texture.src),before.map(t=>t.texture.src));assert.ok(f.scene.tiles.every(t=>!placedTileAsset(t)));
});
test('placed tile detail respects zoom, hardware limits, GPU share and viewport without flattening elevations',()=>{
  const asset={width:16000,height:8000},doc={width:8000,height:4000,texture:{scaleX:-1,scaleY:1}};
  const large=placedTextureSize(asset,doc,2,64*1048576,8192),small=placedTextureSize(asset,doc,.1,64*1048576,8192);
  assert.ok(large.width*large.height*4<=64*1048576);assert.ok(large.width<=8192);assert.ok(small.width<large.width);
  assert.equal(tileInView({mesh:{},bounds:{x:0,y:0,width:10,height:10}},{x:5,y:5,width:100,height:100}),true);
  assert.equal(tileInView({mesh:{},bounds:{x:500,y:500,width:10,height:10}},{x:5,y:5,width:100,height:100}),false);
  const manager=new PlacedTileLods(),tile={_original:{},document:{id:'roof'}};manager.attach(tile);manager.remove(tile);assert.equal(manager.status().tiles,0,'native drag previews do not replace the real tile controller');
});

test('production upload and readback follow the server-confirmed preview and catalogue paths',async()=>{
  const f=placedFixture(),stored=new Map(),directories=[];
  foundry.utils.getRoute=path=>`/vtt/${path}`;
  foundry.applications={apps:{FilePicker:{implementation:{createDirectory:async(_source,path)=>directories.push(path),upload:async(_source,dir,file)=>{
    const name=file.name==='preview.png'?'saved-preview.png':file.name,path=`${dir}/${name}`;
    stored.set(path,new Uint8Array(await file.arrayBuffer()));return{path:encodeURI(path)};
  }}}}};
  globalThis.fetch=async path=>{const key=decodeURI(String(path).replace(/^\/vtt\//,'')),bytes=stored.get(key);return{ok:!!bytes,status:bytes?200:404,arrayBuffer:async()=>bytes.buffer};};
  const io={...f.io};delete io.write;delete io.read;delete io.prepare;
  await stagePlacedMapTiles(f.scene,io);
  assert.ok(directories.length);const asset=placedTileAsset(f.scene.tiles[0]);assert.match(asset.preview,/saved-preview.png$/);assert.ok(stored.has(decodeURI(asset.preview)));
  const catalog=JSON.parse(new TextDecoder().decode(stored.get(decodeURI(asset.lodManifest))));
  assert.ok(catalog.lods.flatMap(l=>l.tiles).every(t=>lodSrcAllowed(t.src,asset.city,asset)));
});

test('an unconfirmed or failed upload stops before a nonexistent preview can be selected',async()=>{
  const f=fixture();let response;
  foundry.applications={apps:{FilePicker:{implementation:{upload:async()=>response}}}};
  for(response of [undefined,false,{}, {error:'Write denied'}, {status:'error',message:'Disk full'}])await assert.rejects(()=>upload('map','preview.png',new Uint8Array([1]),'image/png'),/confirm|denied|full/);
  assert.equal(f.updates.length,0);
});
