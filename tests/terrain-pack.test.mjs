import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {packFiles} from '../scripts/terrain/asset-store.mjs';
const manifest=JSON.parse(fs.readFileSync(new URL('../data/worlds/toril/terrain-pack.json',import.meta.url)));
test('the optimized pack keeps full geography at all three LODs and uses smaller detail chunks',()=>{
 assert.deepEqual(manifest.lods.map(l=>l.z),[5,7,9]);assert.deepEqual(manifest.lods.map(l=>l.tiles.length),[4,117,1836]);
 for(const lod of manifest.lods){
  assert.equal(lod.tiles.reduce((n,t)=>n+t.width*t.height,0),manifest.sourceMap.width*manifest.sourceMap.height);
  for(const t of lod.tiles){assert.ok(t.x>=0&&t.y>=0&&t.x+t.width<=manifest.sourceMap.width&&t.y+t.height<=manifest.sourceMap.height);assert.ok(t.textureWidth<=(lod.z===5?2048:1024));assert.ok(t.textureHeight<=(lod.z===5?2048:1024));}
 }
});
test('every shipped optimized chunk matches its size, hash, frame and one-level KTX2 header',()=>{
 const files=packFiles(manifest);assert.equal(files.size,1957);let bytes=0;
 for(const t of files.values()){
  const b=fs.readFileSync(new URL('../'+t.path,import.meta.url));bytes+=b.length;
  assert.equal(b.length,t.ktxBytes);assert.equal(createHash('sha256').update(b).digest('hex'),t.hash);
  assert.equal(b.readUInt32LE(20),t.textureWidth);assert.equal(b.readUInt32LE(24),t.textureHeight);assert.equal(b.readUInt32LE(40),1);assert.equal(b.readUInt32LE(44),1);
 }
 assert.equal(bytes,manifest.totalBytes);assert.ok(bytes<250*1048576);
});
