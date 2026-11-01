import test from 'node:test';
import assert from 'node:assert/strict';
import {LodCache,selectLod,chooseView} from '../scripts/terrain/lod-cache.mjs';
const tile=(id,x=0,z=7)=>({id,x,y:0,width:10,height:10,textureWidth:4,textureHeight:4,lod:z});
const turn=()=>new Promise(r=>setImmediate(r));
async function settle(cache){for(let i=0;i<100;i++){await turn();if(!cache.loading.size)return;}throw Error('Cache did not settle');}
function fixture(options={}){
 const roots=[tile('root',0,5)],uploads=[],released=[],disposed=[];
 const cache=new LodCache({roots,budgetBytes:40,load:async t=>({bytes:10,upload:()=>{uploads.push(t.id);return {dispose:()=>disposed.push(t.id)};},release:()=>released.push(t.id)}),...options});
 return {cache,roots,uploads,released,disposed};
}
test('LOD selection follows zoom and keeps a small hysteresis band',()=>{
 const lods=[{z:5},{z:7},{z:9}];assert.equal(selectLod(lods,3),5);assert.equal(selectLod(lods,6),7);assert.equal(selectLod(lods,8),9);
 assert.equal(selectLod(lods,7.1,7),7);assert.equal(selectLod(lods,7.2,7),9);assert.equal(selectLod(lods,6.9,9),9);assert.equal(selectLod(lods,6.7,9),7);
});
test('a view chooses coarser coverage when its detailed tiles exceed the payload budget',()=>{
 const catalog={lods:[{z:5,tiles:[tile('root',0,5)]},{z:7,tiles:[tile('middle')]},{z:9,tiles:[tile('a',0,9),tile('b',10,9)]}]};
 const view={x0:0,y0:0,x1:20,y1:10};assert.equal(chooseView(catalog,view,8,32,1).z,7);assert.equal(chooseView(catalog,view,8,48,1).z,9);
});
test('roots finish before fine loads and the global decode concurrency is bounded',async()=>{
 let running=0,maximum=0;const calls=[],pending=[];
 const {cache}=fixture({roots:[tile('r1',0,5),tile('r2',10,5)],load:t=>new Promise(resolve=>{calls.push(t.id);maximum=Math.max(maximum,++running);pending.push(()=>{running--;resolve({bytes:10,upload:()=>({dispose(){}}),release(){}});});})});
 cache.request([tile('a'),tile('b')]);await turn();assert.deepEqual(calls,['r1','r2']);pending.shift()();await turn();assert.deepEqual(calls,['r1','r2']);
 pending.shift()();await turn();assert.equal(calls.length,4);assert.equal(maximum,2);while(pending.length)pending.shift()();await settle(cache);assert.equal(cache.status().state,'ready');
});
test('moving the viewport replaces queued work and discards stale in-flight results',async()=>{
 let complete;const calls=[];const {cache,released}=fixture({concurrency:1});const ordinary=cache.load;
 cache.load=async t=>{calls.push(t.id);if(t.id==='old')return new Promise(r=>complete=()=>ordinary(t).then(r));return ordinary(t);};
 cache.request([]);await settle(cache);cache.request([tile('old'),tile('old-queued'),tile('old-never')]);await turn();
 cache.request([tile('new')]);complete();await settle(cache);
 assert.ok(!cache.resident.has('old'));assert.ok(!calls.includes('old-never'));assert.ok(cache.resident.has('new'));assert.ok(released.includes('old'));
});
test('cold tiles are evicted under a hard budget while root coverage stays pinned',async()=>{
 const {cache,disposed}=fixture({budgetBytes:30});cache.request([tile('a'),tile('b')]);await settle(cache);assert.equal(cache.bytes,30);
 cache.request([tile('c'),tile('d')]);await settle(cache);assert.equal(cache.bytes,30);assert.ok(cache.resident.has('root'));assert.ok(disposed.includes('a')&&disposed.includes('b'));assert.ok(cache.peakBytes<=30);
});
test('an oversized target is not uploaded and cannot trigger an automatic retry loop',async()=>{
 const f=fixture({budgetBytes:15});f.cache.request([tile('big')]);await settle(f.cache);
 assert.equal(f.cache.status().state,'limited');assert.deepEqual(f.uploads,['root']);assert.ok(f.released.includes('big'));assert.equal(f.cache.bytes,10);
});
test('a failed detail tile leaves root coverage intact and retries only on request',async()=>{
 const f=fixture();let bad=true,calls=0;const load=f.cache.load;
 f.cache.load=async t=>{if(t.id==='bad'){calls++;if(bad)throw Error('HTTP 404');}return load(t);};
 f.cache.request([tile('bad')]);await settle(f.cache);assert.equal(f.cache.status().state,'degraded');assert.equal(calls,1);assert.ok(f.cache.resident.has('root'));
 f.cache.request([tile('bad')]);await settle(f.cache);assert.equal(calls,1);bad=false;f.cache.retry();await settle(f.cache);assert.equal(f.cache.status().state,'ready');
});
test('upload errors remain errors and still release decoder resources',async()=>{
 const released=[];const {cache}=fixture({load:async t=>({bytes:10,upload:()=>{throw Error('GPU upload failed');},release:()=>released.push(t.id)})});
 cache.request([]);await settle(cache);assert.equal(cache.status().state,'failed');assert.equal(cache.bytes,0);assert.deepEqual(released,['root']);
});
test('stop destroys resident resources and late decodes cannot allocate GPU textures',async()=>{
 let finish;const f=fixture();const load=f.cache.load;f.cache.load=async t=>t.id==='late'?new Promise(r=>finish=()=>load(t).then(r)):load(t);
 f.cache.request([]);await settle(f.cache);f.cache.request([tile('late')]);await turn();f.cache.stop();finish();await settle(f.cache);
 assert.equal(f.cache.bytes,0);assert.equal(f.cache.resident.size,0);assert.deepEqual(f.uploads,['root']);assert.ok(f.released.includes('late'));assert.ok(f.disposed.includes('root'));
});
test('reducing the budget evicts detail before admitting the next view',async()=>{
 const {cache}=fixture({budgetBytes:40});cache.request([tile('a'),tile('b'),tile('c')]);await settle(cache);cache.resize(15);
 assert.equal(cache.bytes,10);assert.ok(cache.resident.has('root'));cache.request([tile('a')]);await settle(cache);assert.ok(cache.bytes<=15);
});
