import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneContextEntry} from '../scripts/foundry-compat.mjs';
import {backgroundOf,sceneBackgroundPatch} from '../scripts/local-maps.mjs';
import {KtxDecoder} from '../scripts/terrain/ktx-decoder.mjs';

test('V14 scene menu entries use native fields and retain the selected row in onClick; V13 entries stay unchanged',()=>{
  let clicked;const source={name:'Edit map',condition:row=>row.id==='scene',callback:(row,event)=>{clicked=[row,event];}};
  globalThis.game={release:{generation:13}};assert.equal(sceneContextEntry(source),source);
  game.release.generation=14;const entry=sceneContextEntry(source),row={id:'scene'},event={type:'click'};
  assert.equal(entry.label,'Edit map');assert.equal(entry.visible(row),true);entry.onClick(event,row);assert.deepEqual(clicked,[row,event]);for(const key of ['condition','name','callback'])assert.equal(key in entry,false);
});

test('V14 background reads and patches use the starting Level without accessing deprecated Scene fields',()=>{
  game.release.generation=14;const scene={initialLevel:{id:'level',background:{src:'image.avif',color:'#888888'}},levels:{size:1},get background(){throw Error('Deprecated field');}};
  assert.equal(backgroundOf(scene),'image.avif');assert.deepEqual(sceneBackgroundPatch(scene,null,'#000000'),{levels:[{_id:'level',background:{src:null,color:'#000000'}}]});
  game.release.generation=13;assert.deepEqual(sceneBackgroundPatch({},'image.webp','#999999'),{'background.src':'image.webp',backgroundColor:'#999999'});
});

for(const generation of [13,14])test(`V${generation} KTX decoding uses its native parser without detaching shared bytes and frees textures`,async()=>{
  const input=new Uint8Array([1,2,3]),calls=[],resources=[],destroyed=[];
  globalThis.PIXI={MIPMAP_MODES:{OFF:0},ALPHA_MODES:{PREMULTIPLIED_ALPHA:1,NO_PREMULTIPLIED_ALPHA:2},BaseTexture:class{constructor(resource,options){this.resource=resource;this.options=options;}},Texture:class{constructor(base){this.baseTexture=base;}destroy(all){destroyed.push(all);}}};
  const resource={isPremultiplied:generation===14};resources.push(resource);
  globalThis.foundry={canvas:generation===14?{KTX2Parser:{parse:async(bytes,options)=>{calls.push(options);assert.equal(bytes,input);return resource;}}}:{}};
  globalThis.PixiBasisKTX2=generation===13?{KTX2Parser:{transcode:async bytes=>{calls.push('legacy');assert.equal(bytes,input);return[resource];}}}:undefined;
  const decoder=new KtxDecoder({bytes:async()=>input}),tile={hash:'tile'};
  const [a,b]=await Promise.all([decoder.acquire(tile),decoder.acquire(tile)]);assert.equal(a,b);assert.equal(calls.length,1);assert.equal(input.byteLength,3);
  assert.equal(a.baseTexture.options.alphaMode,generation===14?1:2);
  if(generation===14)assert.deepEqual(calls[0],{transfer:false});
  await decoder.release(tile);assert.equal(destroyed.length,0);await decoder.release(tile);assert.deepEqual(destroyed,[true]);
});
