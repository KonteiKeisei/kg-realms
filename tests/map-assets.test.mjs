import "./helpers/worlds.mjs";
import test from 'node:test';
import assert from 'node:assert/strict';
import {MapAssetStore,packFiles,sha256,sameGeometry} from '../scripts/terrain/asset-store.mjs';
class Dir {
  constructor(name='Maps'){this.name=name;this.children=new Map();this.permission='granted';}
  async queryPermission(){return this.permission;}
  async requestPermission(){return this.permission;}
  async getDirectoryHandle(name,{create=false}={}){if(!this.children.has(name)){if(!create)throw new DOMException('Missing','NotFoundError');this.children.set(name,new Dir(name));}return this.children.get(name);}
  async getFileHandle(name,{create=false}={}){
    if(!this.children.has(name)){if(!create)throw new DOMException('Missing','NotFoundError');this.children.set(name,{bytes:new Uint8Array(),modified:0});}
    const data=this.children.get(name);
    return {getFile:async()=>new File([data.bytes],name,{lastModified:data.modified}),createWritable:async()=>{let pending;return {write:async b=>pending=typeof b==='string'?new TextEncoder().encode(b):new Uint8Array(b).slice(),close:async()=>{data.bytes=pending;data.modified++;},abort:async()=>{}};}};
  }
  async *entries(){yield* this.children.entries();}
}
const record=()=>({value:{},async get(){return this.value;},async set(v){this.value=v;}});
async function manifest(values=['first','second','third']){
 const payloads=new Map(),lods=[];
 for(let i=0;i<values.length;i++){
  const b=new TextEncoder().encode(values[i]),hash=await sha256(b),z=[5,7,9][i];payloads.set(hash,b);
  lods.push({z,tiles:[{id:`z${z}-0-0`,lod:z,path:`assets/terrain/z${z}-0-0.ktx2`,hash,ktxBytes:b.length,x:0,y:0,width:16,height:16,textureWidth:4,textureHeight:4,frameX:0,frameY:0,frameWidth:4,frameHeight:4}]});
 }
 return {m:{schema:1,id:'faerun-terrain',version:'1',fingerprint:await sha256(new TextEncoder().encode(JSON.stringify(lods))),sourceMap:{width:16,height:16,x:100,y:100,worldSize:65536,nativeZoom:7},lods},payloads};
}
async function setup(values){
 const {m,payloads}=await manifest(values),saved=record(),folder=new Dir(),calls=[];
 const fetcher=async url=>{const file=[...packFiles(store.manifest).values()].find(t=>new URL(url,'https://test').pathname.endsWith('/'+t.path));assert.ok(file,`Unknown asset URL: ${url}`);assert.equal(new URL(url,'https://test').search,'');calls.push(file.hash);return new Response(payloads.get(file.hash));};
 const store=new MapAssetStore({record:saved,picker:async()=>folder,lock:async f=>f(),fetcher,intervalMs:0,retries:0});store.setManifest(m);await store.choose();return {store,m,payloads,saved,folder,calls,fetcher};
}
test('the manifest rejects traversal, conflicting IDs and invalid frame dimensions',async()=>{
 const {m}=await manifest();assert.equal(packFiles(m).size,3);
 const bad=structuredClone(m);bad.lods[0].tiles[0].path='../outside.ktx2';assert.throws(()=>packFiles(bad));
 const duplicate=structuredClone(m);duplicate.lods[1].tiles[0].id=duplicate.lods[0].tiles[0].id;assert.throws(()=>packFiles(duplicate));
 const frame=structuredClone(m);frame.lods[0].tiles[0].frameWidth=100;assert.throws(()=>packFiles(frame));
});
test('complete installation persists files, and subsequent reads make zero network requests',async()=>{
 const f=await setup();await f.store.download();assert.equal(f.calls.length,3);assert.equal(f.store.choice,'local');assert.ok(f.store.status().upToDate);
 const again=new MapAssetStore({record:f.saved,fetcher:()=>{throw Error('Unexpected network');},lock:async fn=>fn()});again.setManifest(f.m);await again.restore();
 for(const lod of f.m.lods){const bytes=await again.bytes(lod.tiles[0]);assert.equal(await sha256(bytes),lod.tiles[0].hash);}
 assert.equal(again.status().remainingBytes,0);assert.ok(again.installed);
});
test('reselecting an existing folder recovers without a browser record or redownload',async()=>{
 const f=await setup();await f.store.download();const fresh=new MapAssetStore({record:record(),picker:async()=>f.folder,fetcher:()=>{throw Error('Unexpected network');},lock:async fn=>fn()});
 fresh.setManifest(f.m);await fresh.choose();await fresh.scan({verify:true});await fresh.download();assert.ok(fresh.status().upToDate);assert.equal(fresh.choice,'local');
});
test('pause keeps verified files and resume requests only missing files',async()=>{
 const f=await setup();let stop=true;const fetcher=f.store.fetcher;f.store.fetcher=async u=>{if(stop){stop=false;f.store.pause();}return fetcher(u);};
 await f.store.download();assert.equal(f.store.state,'paused');assert.equal(f.store.installed,null);assert.ok(f.store.status().completed>0);
 await f.store.download();assert.equal(f.calls.length,3);assert.ok(f.store.status().upToDate);
});
test('the managed folder itself can be reselected without creating a nested installation',async()=>{
 const f=await setup();await f.store.download();const selected=f.store.directory;
 const again=new MapAssetStore({record:record(),picker:async()=>selected,fetcher:()=>{throw Error('Unexpected network');},lock:async fn=>fn()});again.setManifest(f.m);await again.choose();await again.download();
 assert.equal(again.objects,f.store.objects);assert.equal(again.status().folderLabel,'KG Realms');assert.ok(!selected.children.has('KG Realms'));
});
test('an interrupted update retains the working generation and reuses unchanged content',async()=>{
 const f=await setup();await f.store.download();const old=f.store.installed;
 const update=await manifest(['changed','second','third']);for(const [k,v] of update.payloads)f.payloads.set(k,v);f.store.setManifest(update.m);
 assert.ok(sameGeometry(old,update.m));assert.equal(f.store.installed,old);
 await f.store.download();assert.equal(f.calls.length,4);assert.equal(f.store.installed.fingerprint,update.m.fingerprint);
});
test('damaged local data does not silently download and explicit repair fetches only the bad file',async()=>{
 const f=await setup();await f.store.download();const t=f.m.lods[0].tiles[0],data=f.store.objects.children.get(`${t.hash}.ktx2`);data.bytes=new TextEncoder().encode('wrong');data.modified++;
 await assert.rejects(f.store.bytes(t));assert.equal(f.calls.length,3);
 f.store.lastScan=null;await f.store.download();assert.equal(f.calls.length,4);assert.equal(await sha256(await f.store.bytes(t)),t.hash);
});
test('hash mismatches never commit a package as installed',async()=>{
 const f=await setup();f.store.fetcher=async()=>new Response('wrong');await assert.rejects(f.store.download());assert.equal(f.store.installed,null);assert.equal(f.store.state,'error');assert.equal(f.store.active,null);
});
test('a failed update preserves the prior usable map generation',async()=>{
 const f=await setup();await f.store.download();const old=f.store.installed;
 const update=await manifest(['changed','second','third']);f.store.setManifest(update.m);f.store.fetcher=async()=>new Response('bad');
 await assert.rejects(f.store.download());assert.equal(f.store.installed,old);assert.equal(await sha256(await f.store.bytes(old.lods[0].tiles[0])),old.lods[0].tiles[0].hash);
});
test('a damaged package index is rebuilt from existing files without redownloading',async()=>{
 const f=await setup();await f.store.download();f.store.directory.children.get(`active-${f.m.id}.json`).bytes=new TextEncoder().encode('{broken');
 const again=new MapAssetStore({record:record(),picker:async()=>f.folder,fetcher:()=>{throw Error('Unexpected network');},lock:async fn=>fn()});again.setManifest(f.m);await again.choose();await again.download();assert.ok(again.status().upToDate);
});
test('each world streams or saves on its own: another world streams although this one is saved',async()=>{
 const f=await setup();await f.store.download();assert.equal(f.store.choice,'local');
 // A second world (another pack) on the same computer: not saved, so streamed, never blocked.
 const other=await manifest(['alpha','beta','gamma']);other.m.id='trorune-terrain';
 const served=[];f.store.fetcher=async url=>{const file=[...packFiles(other.m).values()].find(t=>url.endsWith('/'+t.path));served.push(file.hash);return new Response(other.payloads.get(file.hash));};
 f.store.setManifest(other.m);
 assert.equal(f.store.choice,'stream');assert.equal(f.store.installed,null);
 const bytes=await f.store.bytes(other.m.lods[0].tiles[0]);assert.equal(await sha256(bytes),other.m.lods[0].tiles[0].hash);assert.equal(served.length,1);
 // Back to the first world: still saved, still read from the folder.
 f.store.setManifest(f.m);assert.equal(f.store.choice,'local');assert.ok(f.store.installed);
});
test('a choice saved before 0.75.6 belongs to Toril only',async()=>{
 const f=await setup();await f.store.download();f.saved.value={choice:'local',handle:f.folder};
 const again=new MapAssetStore({record:f.saved,fetcher:()=>{throw Error('Unexpected network');},lock:async fn=>fn()});await again.restore();
 again.setManifest(f.m);assert.equal(again.choice,'local');
 const other=await manifest(['x','y','z']);other.m.id='trorune-terrain';again.setManifest(other.m);assert.equal(again.choice,'stream');
});
test('cancel retains completed files and leaves no incomplete package active',async()=>{
 const f=await setup(),fetcher=f.store.fetcher;let once=true;f.store.fetcher=async u=>{if(once){once=false;f.store.cancel();}return fetcher(u);};
 await f.store.download();assert.equal(f.store.state,'cancelled');assert.equal(f.store.installed,null);await f.store.download();assert.ok(f.store.status().upToDate);assert.equal(f.calls.length,3);
});
test('permission loss requests reconnection instead of downloading another copy',async()=>{
 const f=await setup();await f.store.download();f.folder.permission='prompt';
 const again=new MapAssetStore({record:f.saved,fetcher:()=>{throw Error('Unexpected network');},lock:async fn=>fn()});again.setManifest(f.m);await again.restore();assert.equal(again.state,'reconnect');await assert.rejects(again.bytes(f.m.lods[0].tiles[0]));
 f.folder.permission='granted';await again.reconnect();assert.ok(again.installed);await again.bytes(f.m.lods[0].tiles[0]);
});
test('unrecognised files in the managed subfolder are never overwritten',async()=>{
 const f=await setup();const other=new Dir(),managed=await other.getDirectoryHandle('KG Realms',{create:true});managed.children.set('my-note.txt',{bytes:new TextEncoder().encode('keep'),modified:1});
 const before=f.store.objects;await assert.rejects(f.store.adopt(other));assert.equal(f.store.objects,before);assert.ok(managed.children.has('my-note.txt'));assert.ok(!managed.children.has('managed.json'));
});
test('duplicate starts share one download and concurrent tabs cannot both acquire the write lock',async()=>{
 const f=await setup();let unlock;f.store.lock=async fn=>{await new Promise(r=>unlock=r);return fn();};
 const first=f.store.download(),second=f.store.download();assert.equal(first,second);await new Promise(r=>setImmediate(r));unlock();await first;assert.equal(f.calls.length,3);
 const other=await setup();other.store.lock=async()=>{throw Error('Another tab is downloading maps');};await assert.rejects(other.store.download());assert.equal(other.calls.length,0);
});
test('a stalled connection releases its slots and leaves an installation resumable',async()=>{
 const f=await setup();f.store.timeoutMs=5;f.store.fetcher=(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
 await assert.rejects(f.store.download(),/stalled/);assert.equal(f.store.active,null);assert.equal(f.store.jobs.size,0);assert.equal(f.store.installed,null);
 f.store.fetcher=f.fetcher;await f.store.download();assert.ok(f.store.status().upToDate);
});

test('a partial installation resumes with canonical URLs on a host that rejects cache queries',async()=>{
 const f=await setup();let calls=0;const original=f.fetcher;
 f.store.fetcher=async(url,opts)=>{assert.ok(!url.includes('?'));assert.equal(opts.cache,'no-cache');calls++;if(calls===2)return new Response('Forbidden',{status:403});return original(url,opts);};
 await assert.rejects(f.store.download(),/HTTP 403 for assets\/terrain\//);
 const before=new Set(Object.keys(f.store.receipts));assert.ok(before.size>0);assert.equal(f.store.failedRequest.status,403);assert.equal(f.store.installed,null);
 f.store.fetcher=original;await f.store.download();assert.ok(f.store.status().upToDate);assert.equal(f.calls.length,3);assert.equal(f.store.failedRequest,null);
});

test('download details count transferred bytes once and reset when reusing saved files',async()=>{
 const f=await setup();await f.store.download();const complete=f.store.status();
 assert.equal(complete.transfer.transferredBytes,complete.totalBytes);assert.equal(complete.transfer.sessionFiles,3);const elapsed=complete.transfer.elapsedMs;
 await new Promise(r=>setTimeout(r,10));assert.equal(f.store.status().transfer.elapsedMs,elapsed);
 await f.store.download();assert.equal(f.store.status().transfer.transferredBytes,0);assert.equal(f.store.status().transfer.sessionFiles,0);assert.equal(f.calls.length,3);
});
