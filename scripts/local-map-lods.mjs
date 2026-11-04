import { assetModules } from "./worlds.mjs";
/** A tile picture may only come from the engine or a registered world's module, in that city's folder. */
export function lodSrcAllowed(src, city, asset = {}) {
  if(!/^[\w-]+$/.test(city??''))return false;
  const m = /^modules\/([\w-]+)\/assets\/maps\/ktx2\/([\w-]+)\/[\w-]+\.ktx2$/.exec(src ?? "");
  if(m)return m[2] === city && assetModules().has(m[1]);
  const root=asset.dataRoot;
  return typeof root==='string'&&/^KG Realms Data\/Local\/[\w-]+\/[\w-]+$/.test(root)&&typeof src==='string'&&src.startsWith(`${root}/assets/maps/ktx2/${city}/`)&&/^[\w-]+\.ktx2(?:\.fbx)?$/.test(src.slice(`${root}/assets/maps/ktx2/${city}/`.length));
}
import {chooseView,LodCache} from './terrain/lod-cache.mjs';
import {KtxDecoder} from './terrain/ktx-decoder.mjs';
const manifests=new Map();
export async function resolveLocalLods(asset) {
  if(!asset?.lodManifest)return asset;
  if(!manifests.has(asset.lodManifest))manifests.set(asset.lodManifest,(async()=>{
    const response=await fetch(foundry.utils.getRoute(asset.lodManifest));if(!response.ok)throw Error(`Local map catalogue: HTTP ${response.status}`);
    const data=await response.json();
    if(data.schema!==1||data.id!==asset.id||data.width!==asset.width||data.height!==asset.height||!Array.isArray(data.lods)||data.lods.length!==3)throw Error('Invalid local map LOD catalogue.');
    const ids=new Set();
    for(const [i,lod]of data.lods.entries()){
      if(!Number.isFinite(lod.z)||!lod.tiles?.length||(i&&lod.z<=data.lods[i-1].z))throw Error('Invalid map detail level.');
      for(const t of lod.tiles){
        const geometry=['x','y','width','height','textureWidth','textureHeight','frameX','frameY','frameWidth','frameHeight'];
        if(t.lod!==lod.z||ids.has(t.id)||typeof t.id!=='string'||!lodSrcAllowed(t.src,asset.city,asset)||!/^[a-f0-9]{64}$/.test(t.hash??'')||!Number.isSafeInteger(t.ktxBytes)||t.ktxBytes<=0||t.ktxBytes>16777216||geometry.some(k=>!Number.isFinite(t[k])||t[k]<0)||!t.width||!t.height||t.textureWidth>4096||t.textureHeight>4096||t.textureWidth%4||t.textureHeight%4||t.frameWidth<=0||t.frameHeight<=0||t.frameX+t.frameWidth>t.textureWidth||t.frameY+t.frameHeight>t.textureHeight||t.x+t.width>data.width+.001||t.y+t.height>data.height+.001)throw Error('Invalid local map texture geometry.');
        ids.add(t.id);
      }
    }
    return{...asset,...data};
  })().catch(e=>{manifests.delete(asset.lodManifest);throw e;}));
  return manifests.get(asset.lodManifest);
}
/** The primary canvas group retains Foundry lighting, weather and token ordering. */
export class LocalMapLodSurface {
  constructor({asset,canvas,PIXI,Mesh,mode='ktx2',budgetBytes=128*1048576,report=()=>{}}){Object.assign(this,{asset,canvas,PIXI,Mesh,mode,budgetBytes,report});this.activeLod=asset.lods[0].z;this.stopped=false;this.hooks=[];this.notified=false;}
  async start(){
    this.decoder=new KtxDecoder({bytes:async tile=>{
      const res=await fetch(foundry.utils.getRoute(tile.src),{cache:'no-cache'});if(!res.ok)throw Error(`Map tile HTTP ${res.status}: ${tile.id}`);
      const bytes=await res.arrayBuffer();if(bytes.byteLength!==tile.ktxBytes)throw Error(`Incomplete map tile: ${tile.id}`);
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');if(hash!==tile.hash)throw Error(`Map tile failed verification: ${tile.id}`);return bytes;
    }});
    this.cache=new LodCache({roots:this.asset.lods[0].tiles,budgetBytes:this.budgetBytes,load:t=>this.load(t),onChange:()=>this.changed()});
    const move=()=>this.schedule();
    for(const hook of ['canvasPan','canvasResize'])this.hooks.push([hook,Hooks.on(hook,move)]);
    window.addEventListener('resize',move);this.unresize=()=>window.removeEventListener('resize',move);
    this.updateView();
  }
  schedule(){if(this.pending!=null||this.stopped)return;this.pending=requestAnimationFrame(()=>{this.pending=null;this.updateView();});}
  updateView(){
    if(this.stopped||!this.cache)return;
    const c=this.canvas,d=c.dimensions,a=this.asset,sw=d.sceneWidth/a.width,sh=d.sceneHeight/a.height;
    const rect=c.app.view.getBoundingClientRect(),inv=c.stage.worldTransform;
    const p=inv.applyInverse({x:0,y:0}),q=inv.applyInverse({x:rect.width,y:rect.height});
    const padx=(q.x-p.x)*.15,pady=(q.y-p.y)*.15;
    this.view={x0:(p.x-padx-d.sceneX)/sw,y0:(p.y-pady-d.sceneY)/sh,x1:(q.x+padx-d.sceneX)/sw,y1:(q.y+pady-d.sceneY)/sh};
    const first=this.cache.resident.values().next().value,ratio=first?first.bytes/(first.tile.textureWidth*first.tile.textureHeight):1;
    const zoom=Math.log2(Math.max(.00001,c.stage.scale.x*sw*(window.devicePixelRatio||1)));
    const selected=chooseView(a,this.view,zoom,this.budgetBytes,ratio,this.activeLod);this.activeLod=selected.z;this.budgetLimited=selected.budgetLimited;this.cache.request(selected.tiles);
  }
  async load(tile){
    const P=this.PIXI;let texture,owned=false,disposed=false;
    // KTX2 only (0.65.6): the WebP tiles are no longer shipped.
    const release=()=>{if(disposed)return;disposed=true;return this.decoder.release(tile);};
    try{
      texture=await this.decoder.acquire(tile);
      if(texture.width!==tile.textureWidth||texture.height!==tile.textureHeight)throw Error('Local tile dimensions do not match its catalogue.');
      const buffers=texture.baseTexture.resource?._levelBuffers;
      if(!buffers?.length)throw Error('The client could not decode a compressed map texture.');
      const bytes=buffers?.reduce((n,l)=>n+(l.levelBuffer?.byteLength??0),0)||tile.textureWidth*tile.textureHeight*4;
      return{bytes,upload:()=>{
        const frame=new P.Texture(texture.baseTexture,new P.Rectangle(tile.frameX,tile.frameY,tile.frameWidth,tile.frameHeight));
        const c=this.canvas,bg=c.primary.background,d=c.dimensions;if(!bg||bg.destroyed||!bg.transform){frame.destroy(false);throw Error('The local map background was removed.');}
        let mesh;
        const dispose=()=>{
          if(mesh&&!mesh.destroyed){mesh.parent?.removeChild(mesh);mesh.destroy({children:true,texture:false,baseTexture:false});}
          if(frame.baseTexture)frame.destroy(false);
          return release();
        };
        try{
          mesh=new this.Mesh({texture:frame,name:`kgr-${tile.id}`,object:bg.object??c.primary});
          mesh.anchor.set(0);mesh.position.set(d.sceneX+tile.x*d.sceneWidth/this.asset.width,d.sceneY+tile.y*d.sceneHeight/this.asset.height);
          mesh.width=tile.width*d.sceneWidth/this.asset.width;mesh.height=tile.height*d.sceneHeight/this.asset.height;
          mesh.elevation=bg.elevation;mesh.sortLayer=bg.sortLayer;mesh.sort=(bg.sort??0)+tile.lod+4;mesh.zIndex=bg.zIndex;mesh.alpha=bg.alpha;mesh.tint=bg.tint;mesh.hoverFade=false;mesh.textureAlphaThreshold=0;mesh.eventMode='none';
          mesh.renderable=tile.lod<=this.activeLod;
          c.primary.addChild(mesh);c.primary.sortDirty=c.primary.renderDirty=true;
          // The managed background already has Texture.EMPTY. Do not change its visibility.
          owned=true;
          return{mesh,dispose:()=>{dispose();if(c.primary&&!c.primary.destroyed)c.primary.renderDirty=true;}};
        }catch(error){dispose();console.error('kg-realms | local map tile upload',tile.id,error);throw error;}

      },release:()=>{if(!owned)return release();}};
    }catch(e){await release();throw e;}
  }
  changed(){
    if(!this.cache||this.stopped)return;const status=this.cache.status();
    for(const entry of this.cache.resident.values())entry.handle.mesh.renderable=entry.tile.lod<=this.activeLod;
    this.report({...status,state:this.mode,sceneId:this.canvas.scene?.id,asset:this.asset.id,lod:this.activeLod,lods:this.asset.lods.map(l=>l.z),loading:status.state,budgetLimited:this.budgetLimited,texturePayloadMiB:+(status.textureBytes/1048576).toFixed(2)});
    if(status.errors.length&&!this.notified){this.notified=true;ui.notifications.error(`KG Realms: ${status.errors[0].error}`);}
    if(status.rootReady&&!this.refined){this.refined=true;this.schedule();}
    this.canvas.primary.renderDirty=true;
  }
  stop(){this.stopped=true;if(this.pending!=null)cancelAnimationFrame(this.pending);this.unresize?.();for(const [hook,id]of this.hooks)Hooks.off(hook,id);this.hooks=[];this.cache?.stop();}
}
