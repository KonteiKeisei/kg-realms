import {MapRequests} from './asset-request.mjs';
import {DownloadProgress} from './download-progress.mjs';
const OWNER={schema:1,kind:'kg-realms-map-assets'};
export const missing=e=>e?.name==='NotFoundError';
export async function sha256(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export function packFiles(manifest){
  if(manifest?.schema!==1||!/^[\w-]+-terrain$/.test(manifest.id??'')||!Array.isArray(manifest.lods)||!/^[a-f0-9]{64}$/.test(manifest.fingerprint??''))throw Error('Invalid map package manifest');
  const m=manifest.sourceMap;if(!m||!['width','height','x','y','worldSize','nativeZoom'].every(k=>Number.isFinite(m[k]))||m.width<=0||m.height<=0||m.worldSize<=0)throw Error('Invalid map package registration');
  if(manifest.lods.some((l,i)=>!Number.isInteger(l.z)||!Array.isArray(l.tiles)||!l.tiles.length||(i>0&&l.z<=manifest.lods[i-1].z)))throw Error('Invalid map detail levels');
  const files=new Map(),ids=new Set();
  for(const lod of manifest.lods)for(const t of lod.tiles??[]){
    if(t.lod!==lod.z||ids.has(t.id)||!/^assets\/terrain\/(v\d+\/)?z\d+-\d+-\d+\.ktx2(\.fbx)?$/.test(t.path??'')||!/^[a-f0-9]{64}$/.test(t.hash??'')||!Number.isSafeInteger(t.ktxBytes)||t.ktxBytes<=0||t.ktxBytes>16777216)throw Error('Invalid map package entry');
    for(const k of ['x','y','width','height','textureWidth','textureHeight','frameX','frameY','frameWidth','frameHeight'])if(!Number.isFinite(t[k])||t[k]<0)throw Error('Invalid map geometry');
    if(!t.width||!t.height||t.textureWidth>4096||t.textureHeight>4096||t.frameX+t.frameWidth>t.textureWidth||t.frameY+t.frameHeight>t.textureHeight)throw Error('Invalid map frame');
    ids.add(t.id);if(files.has(t.hash)&&files.get(t.hash).ktxBytes!==t.ktxBytes)throw Error('Conflicting map package hashes');files.set(t.hash,t);
  }
  if(!files.size)throw Error('Empty map package');return files;
}
export function sameGeometry(a,b){return ['width','height','x','y','worldSize','nativeZoom'].every(k=>a?.sourceMap?.[k]===b?.sourceMap?.[k]);}
export class ClientRecord {
  async #db(){
    if(!globalThis.indexedDB)return null;
    this.opening??=new Promise((resolve,reject)=>{const r=indexedDB.open('kg-realms-map-assets',1);r.onupgradeneeded=()=>r.result.createObjectStore('client');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return this.opening;
  }
  async get(){const db=await this.#db();if(!db)return this.memory??{};return new Promise((resolve,reject)=>{const r=db.transaction('client').objectStore('client').get('folder');r.onsuccess=()=>resolve(r.result??{});r.onerror=()=>reject(r.error);});}
  async set(value){this.memory=value;const db=await this.#db();if(!db)return;await new Promise((resolve,reject)=>{const tx=db.transaction('client','readwrite');tx.objectStore('client').put(value,'folder');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
}
class Queue {
  active=0;pending=[];
  run(fn,priority=0){return new Promise((resolve,reject)=>{this.pending.push({fn,resolve,reject,priority});this.pump();});}
  pump(){this.pending.sort((a,b)=>b.priority-a.priority);while(this.active<2&&this.pending.length){const j=this.pending.shift();this.active++;Promise.resolve().then(j.fn).then(j.resolve,j.reject).finally(()=>{this.active--;this.pump();});}}
}
export class MapAssetStore {
  constructor({base='modules/kg-realms',fetcher=(...a)=>fetch(...a),record=new ClientRecord(),picker=()=>window.showDirectoryPicker({id:'kg-realms-maps',mode:'readwrite'}),lock,timeoutMs=45000,intervalMs=250,retries=2,retryBaseMs=2000}={}){
    Object.assign(this,{base,fetcher,record,picker,timeoutMs});this.lock=lock??(async(fn)=>{
      if(!globalThis.navigator?.locks?.request)throw Error('This browser cannot safely coordinate map downloads. Use a current supported browser.');
      return navigator.locks.request('kg-realms:map-download',{ifAvailable:true},l=>{if(!l)throw Error('Another tab is downloading maps. Wait for it to finish.');return fn();});
    });
    this.choice='stream';this.listeners=new Set();this.queue=new Queue();this.jobs=new Map();this.transfers=new Map();this.receipts={};this.state='idle';this.verified=new Set();
    this.retrying=new Map();this.progress=new DownloadProgress();this.requests=new MapRequests({base,fetcher:(...args)=>this.fetcher(...args),timeoutMs,intervalMs,retries,retryBaseMs});
  }
  // Each world's map is streamed or saved on its own (0.75.6): the choice and the saved package are
  // kept by pack id. One folder holds every world's saved files (they are named by their hash).
  get choice(){return this.choices?.[this.manifest?.id]??'stream';}
  set choice(v){(this.choices??={})[this.manifest?.id??'']=v;}
  get installed(){const all=this.installedAll??{};return this.manifest?all[this.manifest.id]??null:Object.values(all)[0]??null;}
  set installed(v){this.installedAll??={};if(v)this.installedAll[v.id]=v;else if(this.manifest)delete this.installedAll[this.manifest.id];}
  supported(){return !!globalThis.isSecureContext&&typeof globalThis.window?.showDirectoryPicker==='function'&&!!globalThis.navigator?.locks;}
  on(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  emit(){if(this.emitPending)return;this.emitPending=true;setTimeout(()=>{this.emitPending=false;const s=this.status();for(const fn of this.listeners)fn(s);},50);}
  setManifest(m){
    this.files=packFiles(m);this.manifest=m;
    this.largest=Math.max(...[...this.files.values()].map(t=>t.ktxBytes));
    this.metadataAllowance=new TextEncoder().encode(JSON.stringify(m)).byteLength*2+this.files.size*320+4096;
    this.emit();
  }
  async restore(){
    if(this.restored)return;this.restored=true;
    let saved={};try{saved=await this.record.get();}catch{this.rememberWarning='This browser could not restore its saved folder connection.';}
    // Before 0.75.6 one choice served every world; it was made for Toril's map.
    this.choices={...(saved.choices??{})};const legacy=saved.choice&&saved.choice!=='ask'?saved.choice:null;
    if(legacy&&!saved.choices)this.choices['faerun-terrain']=legacy;
    this.handle=saved.handle;
    if(!this.handle)return;
    try{if(await this.permission('read')!=='granted'){this.state='reconnect';this.emit();return;}await this.openFolder(false);}catch(e){this.issue=e.message;this.state='reconnect';}
  }
  async permission(mode){return this.handle?.queryPermission?this.handle.queryPermission({mode}):'granted';}
  async remember(){try{await this.record.set({choices:{...this.choices},handle:this.handle});}catch{this.rememberWarning='The files are saved, but this browser could not remember the folder. Reconnect it next time.';}}
  async choose(){const pending=this.picker();const h=await pending;await this.adopt(h);}
  async reconnect(){
    if(!this.handle)return this.choose();
    const pending=this.handle.requestPermission?.({mode:'readwrite'});if(pending&&await pending!=='granted')throw Error('Folder access was not granted.');
    await this.openFolder(false);this.issue=null;this.emit();
  }
  async adopt(handle){
    if(this.active)throw Error('Pause the current download before changing folders.');
    const previous=Object.fromEntries(['handle','directory','objects','receipts','installed','state'].map(k=>[k,this[k]]));this.handle=handle;
    try{await this.openFolder(true);}catch(e){Object.assign(this,previous);throw e;}
    await this.remember();this.issue=null;this.emit();
  }
  async json(name,fallback){try{return JSON.parse(await(await(await this.directory.getFileHandle(name)).getFile()).text());}catch(e){if(missing(e))return fallback;throw e;}}
  async writeJson(name,value){const f=await this.directory.getFileHandle(name,{create:true}),w=await f.createWritable();try{await w.write(JSON.stringify(value));await w.close();}catch(e){await w.abort().catch(()=>{});throw e;}}
  async openFolder(create){
    let selectedOwner=null;
    try{selectedOwner=JSON.parse(await(await(await this.handle.getFileHandle('managed.json')).getFile()).text());}catch(e){if(!missing(e)&&this.handle.name==='KG Realms')throw Error('This KG Realms folder has an invalid owner file.');}
    const directory=selectedOwner?.kind===OWNER.kind&&selectedOwner.schema===1?this.handle:await this.handle.getDirectoryHandle('KG Realms',{create});
    this.directory=directory;
    const owner=await this.json('managed.json',null);
    if(!owner){
      if(!create)throw Error('The selected folder is not a KG Realms map folder.');
      for await(const [name] of directory.entries())throw Error(`The KG Realms subfolder already contains unrecognised files (${name}). Choose another folder.`);
      await this.writeJson('managed.json',OWNER);
    }else if(owner.kind!==OWNER.kind||owner.schema!==1)throw Error('The selected folder belongs to a different map manager.');
    this.objects=await directory.getDirectoryHandle('objects',{create});
    try{this.receipts=await this.json('verified.json',{});if(!this.receipts||Array.isArray(this.receipts)||typeof this.receipts!=='object')throw Error('Invalid saved index');}
    catch{this.receipts={};this.rememberWarning='The saved file index needs rebuilding. Verify and repair will reuse valid map files.';}
    // Each world's saved package: active-<pack>.json (before 0.75.6, Toril's only: active.json).
    this.installedAll={};
    try{const legacy=await this.json('active.json',null);if(legacy){packFiles(legacy);this.installedAll[legacy.id]=legacy;}}
    catch{this.rememberWarning='The saved package index needs rebuilding. Verify and repair will reuse valid map files.';}
    for await(const [name] of directory.entries()){
      if(!/^active-[\w-]+\.json$/.test(name))continue;
      try{const pack=await this.json(name,null);if(pack){packFiles(pack);this.installedAll[pack.id]=pack;}}catch{this.rememberWarning='A saved package index needs rebuilding. Verify and repair will reuse valid map files.';}
    }
    this.lastScan=null;this.state='connected';this.emit();
  }
  status(){
    const files=this.files??new Map(),total=[...files.values()].reduce((n,t)=>n+t.ktxBytes,0),present=[...files.values()].filter(t=>this.receipts[t.hash]?.bytes===t.ktxBytes),done=present.reduce((n,t)=>n+t.ktxBytes,0);
    const upToDate=!!this.installed&&this.installed.fingerprint===this.manifest?.fingerprint;
    const retry=[...this.retrying.values()].sort((a,b)=>b.retryAt-a.retryAt)[0]??null;
    return {state:this.state,revision:this.revision??0,choice:this.choice,folder:this.handle?.name??null,folderLabel:this.handle?(this.directory===this.handle?this.handle.name:`${this.handle.name} / KG Realms`):null,supported:this.supported(),totalBytes:total,doneBytes:done,remainingBytes:total-done,spaceNeededBytes:total>done||!upToDate?total-done+2*(this.largest??0)+(this.metadataAllowance??0):0,receivedBytes:[...this.transfers.values()].reduce((n,x)=>n+x,0),files:files.size,completed:present.length,active:!!this.active,installed:!!this.installed,upToDate,retry,transfer:this.progress.snapshot({remainingBytes:total-done,remainingFiles:files.size-present.length,retrying:!!retry}),failedRequest:this.failedRequest??null,issue:this.issue??null,warning:this.rememberWarning??null};
  }
  async #read(t){
    if(!this.objects)throw Error('Reconnect the map folder to use local maps.');
    const f=await(await this.objects.getFileHandle(`${t.hash}.ktx2`)).getFile();
    if(f.size!==t.ktxBytes)throw Error('A local map file has the wrong size. Use Repair download.');
    const bytes=await f.arrayBuffer(),signature=`${t.hash}:${f.size}:${f.lastModified}`;
    if(!this.verified.has(signature)){if(await sha256(bytes)!==t.hash)throw Error('A local map file is damaged. Use Repair download.');this.verified.add(signature);}
    return bytes;
  }
  async bytes(t,{network=!(this.choice==='local'&&this.installed),priority=1}={}){
    if(this.objects){try{return await this.#read(t);}catch(e){if(!missing(e)){this.issue=e.message;this.emit();}delete this.receipts[t.hash];}}
    // This world's own saved map is never quietly swapped for downloads: a missing file is a repair.
    // Any other world's map (streamed, or not saved yet) comes from the server (0.75.6).
    if(!network&&!this.writing){this.issue='A required local map file is unavailable. Reconnect the folder or use Repair download.';this.emit();throw Error(this.issue);}
    return (await this.#fetch(t,priority)).slice(0);
  }
  async #fetch(t,priority){
    if(this.jobs.has(t.hash))return this.jobs.get(t.hash);
    const promise=this.queue.run(async()=>{
      this.requests.timeoutMs=this.timeoutMs;
      let bytes;
      let received=0;
      try{bytes=await this.requests.read(t,{paced:this.writing,onProgress:length=>{if(this.writing)this.progress.network(Math.max(0,length-received));received=length;this.transfers.set(t.hash,length);this.emit();},onRetry:info=>{if(info)this.retrying.set(t.hash,info);else this.retrying.delete(t.hash);this.emit();}});}
      catch(e){this.failedRequest={path:t.path,status:e.status??null};throw e;}
      const length=bytes.byteLength;
      if(await sha256(bytes)!==t.hash)throw Error(`Map download failed its integrity check: ${t.path}`);
      if(this.writing&&this.objects){
        const h=await this.objects.getFileHandle(`${t.hash}.ktx2`,{create:true}),w=await h.createWritable();
        try{await w.write(bytes);await w.close();}catch(e){await w.abort().catch(()=>{});throw e;}
        this.receipts[t.hash]={bytes:length};this.progress.saved(length);this.checkpoints=(this.checkpoints??0)+1;
        if(this.checkpoints>=16)await this.checkpoint();
      }
      return bytes.buffer;
    },priority).finally(()=>{this.jobs.delete(t.hash);this.transfers.delete(t.hash);this.emit();});
    this.jobs.set(t.hash,promise);return promise;
  }
  async checkpoint(){
    // Serialize snapshots so an older write can never replace a newer receipt list.
    const snapshot={...this.receipts};this.checkpoints=0;
    const write=()=>this.writeJson('verified.json',snapshot);this.saving=(this.saving??Promise.resolve()).catch(()=>{}).then(write);return this.saving;
  }
  async scan({verify=false}={}){
    if(!this.objects)throw Error('Choose or reconnect a folder first.');
    let cursor=0;const files=[...this.files.values()];this.state='checking';this.emit();
    await Promise.all([0,1].map(async()=>{while(cursor<files.length){const t=files[cursor++];try{if(verify)await this.#read(t);else{const f=await(await this.objects.getFileHandle(`${t.hash}.ktx2`)).getFile();if(f.size!==t.ktxBytes)throw Error('Wrong size');}this.receipts[t.hash]={bytes:t.ktxBytes};}catch(e){if(['NotAllowedError','SecurityError','NotReadableError'].includes(e.name))throw e;delete this.receipts[t.hash];}}}));
    this.lastScan=verify?this.manifest.fingerprint:null;this.state='connected';if(this.writing)await this.checkpoint();this.emit();
  }
  download(){
    if(this.active)return this.active;
    this.pauseRequested=false;this.cancelRequested=false;this.issue=null;this.failedRequest=null;
    const pending=(async()=>{
      if(!this.objects)throw Error('Choose or reconnect a folder first.');
      if(await this.permission('readwrite')!=='granted')throw Error('Reconnect the folder to allow writing map files.');
      return this.lock(async()=>{
      this.writing=true;
      try{
        // Recheck under the write lock: another tab may have completed since the preview.
        await this.scan({verify:true});this.progress.start();this.state='downloading';this.emit();
        const list=[...this.files.values()].filter(t=>!this.receipts[t.hash]);let cursor=0;
        await Promise.all([0,1].map(async()=>{while(!this.pauseRequested&&cursor<list.length){const t=list[cursor++];await this.#fetch(t,0);this.emit();}}));
        await this.checkpoint();
        if(this.pauseRequested){this.state=this.cancelRequested?'cancelled':'paused';return;}
        // Commit only a complete generation. The previous active manifest survives interruptions.
        await this.writeJson(`active-${this.manifest.id}.json`,this.manifest);this.installed=this.manifest;this.choice='local';this.rememberWarning=null;this.issue=null;await this.remember();this.revision=(this.revision??0)+1;this.state='ready';
      }catch(e){this.pauseRequested=true;await Promise.allSettled([...this.jobs.values()]);await this.checkpoint().catch(()=>{});this.issue=e.message;this.state='error';throw e;}
      finally{this.progress.stop();this.writing=false;}
      });
    })();
    this.active=pending.catch(e=>{this.issue=e.message;this.state='error';throw e;}).finally(()=>{this.active=null;this.emit();});
    this.emit();return this.active;
  }
  pause(){this.pauseRequested=true;if(this.active)this.state='pausing';this.emit();}
  cancel(){this.cancelRequested=true;this.pause();}
  async stream(){this.choice='stream';await this.remember();this.emit();}
}
