// View-driven loading and a hard bound on owned GPU texture payloads. No polling.
export function selectLod(lods, zoom, previous) {
  const levels=lods.map(l=>l.z);
  if(previous!=null){const i=levels.indexOf(previous);if(i>=0&&zoom<=previous+.15&&(i===0||zoom>levels[i-1]-.15))return previous;}
  return levels.find(z=>z>=zoom)??levels.at(-1);
}
export function overlaps(t,b){return t.x<b.x1&&t.x+t.width>b.x0&&t.y<b.y1&&t.y+t.height>b.y0;}
/**
 * Whether finer tiles already drawn hide a tile within the view: one finer level's tiles (a level's
 * tiles never overlap one another) cover all of the tile's visible part. Then it need not be drawn.
 */
export function hiddenByFiner(tile,finer,view){
  const x0=Math.max(tile.x,view.x0),y0=Math.max(tile.y,view.y0),x1=Math.min(tile.x+tile.width,view.x1),y1=Math.min(tile.y+tile.height,view.y1);
  if(x1<=x0||y1<=y0)return true;
  const need=(x1-x0)*(y1-y0),byLevel=new Map();
  for(const f of finer){if(f.lod<=tile.lod)continue;const w=Math.min(x1,f.x+f.width)-Math.max(x0,f.x),h=Math.min(y1,f.y+f.height)-Math.max(y0,f.y);if(w>0&&h>0)byLevel.set(f.lod,(byLevel.get(f.lod)??0)+w*h);}
  for(const area of byLevel.values())if(area>=need*0.9999)return true;
  return false;
}
export function chooseView(catalog,view,zoom,budgetBytes,bytesPerPixel=1,previous){
  const roots=catalog.lods[0].tiles,rootBytes=roots.reduce((n,t)=>n+t.textureWidth*t.textureHeight*bytesPerPixel,0);
  let z=selectLod(catalog.lods,zoom,previous),index=catalog.lods.findIndex(l=>l.z===z),tiles;const requestedZ=z;
  while(index>=0){
    z=catalog.lods[index].z;tiles=catalog.lods[index].tiles.filter(t=>overlaps(t,view));
    const need=index===0?rootBytes:rootBytes+tiles.reduce((n,t)=>n+t.textureWidth*t.textureHeight*bytesPerPixel,0);
    if(need<=budgetBytes||index===0)break;index--;
  }
  const cx=(view.x0+view.x1)/2,cy=(view.y0+view.y1)/2;
  tiles.sort((a,b)=>Math.hypot(a.x+a.width/2-cx,a.y+a.height/2-cy)-Math.hypot(b.x+b.width/2-cx,b.y+b.height/2-cy));
  return {z,tiles,requestedZ,budgetLimited:z!==requestedZ};
}
export class LodCache {
  constructor({roots,load,budgetBytes=128*1048576,concurrency=2,onChange=()=>{}}){
    Object.assign(this,{load,budgetBytes,concurrency,onChange});
    this.roots=roots;this.rootIds=new Set(roots.map(t=>t.id));this.resident=new Map();this.loading=new Map();
    this.errors=new Map();this.blocked=new Set();this.wanted=new Map();this.bytes=0;this.peakBytes=0;this.serial=0;this.stopped=false;
    this.loadedTotal=0;this.discarded=0;
  }
  request(tiles){
    if(this.stopped)return;
    const list=[...this.roots,...tiles],wanted=new Map(list.map(t=>[t.id,t]));
    const changed=wanted.size!==this.wanted.size||[...wanted.keys()].some(k=>!this.wanted.has(k));
    this.wanted=wanted;
    if(changed)this.blocked.clear();
    for(const id of wanted.keys()){const r=this.resident.get(id);if(r)r.used=++this.serial;}
    this.#pump();this.onChange();
  }
  #drop(id){const r=this.resident.get(id);if(!r)return;r.handle.dispose();this.bytes-=r.bytes;this.resident.delete(id);}
  #admit(bytes){
    const cold=[...this.resident.values()].filter(r=>!this.wanted.has(r.tile.id)&&!this.rootIds.has(r.tile.id)).sort((a,b)=>a.used-b.used);
    for(const r of cold){if(this.bytes+bytes<=this.budgetBytes)break;this.#drop(r.tile.id);}
    return this.bytes+bytes<=this.budgetBytes;
  }
  #pump(){
    if(this.stopped)return;
    for(const tile of this.wanted.values()){
      if(this.loading.size>=this.concurrency)break;
      if(this.resident.has(tile.id)||this.loading.has(tile.id)||this.errors.has(tile.id)||this.blocked.has(tile.id))continue;
      // Finish base coverage before spending slots or memory on fine tiles.
      if(!this.rootIds.has(tile.id)&&this.roots.some(t=>!this.resident.has(t.id)))continue;
      this.loading.set(tile.id,true);
      Promise.resolve().then(()=>this.load(tile)).then(async resource=>{
        try{
          if(this.stopped||!this.wanted.has(tile.id)){this.discarded++;return;}
          if(!Number.isFinite(resource.bytes)||resource.bytes<=0)throw Error('Invalid texture payload');
          if(!this.#admit(resource.bytes)){this.blocked.add(tile.id);return;}
          const handle=resource.upload();
          this.resident.set(tile.id,{tile,handle,bytes:resource.bytes,used:++this.serial});
          this.bytes+=resource.bytes;this.peakBytes=Math.max(this.peakBytes,this.bytes);this.loadedTotal++;
        }finally{await resource.release?.();}
      }).catch(error=>{if(!this.stopped)this.errors.set(tile.id,error.message);}).finally(()=>{
        this.loading.delete(tile.id);if(!this.stopped){this.#pump();this.onChange();}
      });
    }
  }
  status(){
    const missing=[...this.wanted.keys()].filter(id=>!this.resident.has(id));
    const baseFailed=this.roots.some(t=>this.errors.has(t.id)),rootReady=this.roots.every(t=>this.resident.has(t.id));
    return {state:this.stopped?'stopped':baseFailed?'failed':missing.some(id=>this.errors.has(id))?'degraded':missing.some(id=>this.blocked.has(id))?'limited':missing.length?'loading':'ready',
      textureBytes:this.bytes,peakTextureBytes:this.peakBytes,budgetBytes:this.budgetBytes,resident:this.resident.size,inFlight:this.loading.size,
      wanted:this.wanted.size,missing:missing.length,rootReady,loadedTotal:this.loadedTotal,discarded:this.discarded,errors:[...this.errors].map(([id,error])=>({id,error}))};
  }
  retry(){this.errors.clear();this.blocked.clear();this.#pump();this.onChange();}
  resize(bytes){
    this.budgetBytes=bytes;this.wanted=new Map(this.roots.map(t=>[t.id,t]));this.blocked.clear();
    this.#admit(0);this.onChange();
  }
  stop(){
    this.stopped=true;this.wanted.clear();for(const id of [...this.resident.keys()])this.#drop(id);this.onChange();
  }
}
