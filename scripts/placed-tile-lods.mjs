import {resolveLocalLods} from './local-map-lods.mjs';
import {KtxDecoder} from './terrain/ktx-decoder.mjs';
const ID='kg-realms';
const renderingStopped=()=>Object.assign(Error('Tile rendering stopped.'),{name:'AbortError'});
export const placedTileAsset=doc=>{const asset=doc?.getFlag?.(ID,'tileAsset')??doc?.flags?.[ID]?.tileAsset;return asset&&doc.texture?.src===asset.preview?asset:null;};

/** Native Tile meshes keep their elevation, rotation, occlusion and hit testing. Only artwork changes. */
export function placedTextureSize(asset,document,zoom,budgetBytes,maxTextureSize){
  const ratio=Math.max(document.width*Math.abs(document.texture?.scaleX??1)/asset.width,document.height*Math.abs(document.texture?.scaleY??1)/asset.height)*zoom;
  const scale=Math.min(1,Math.max(.0001,ratio),maxTextureSize/Math.max(asset.width,asset.height),Math.sqrt(Math.max(4,budgetBytes)/(asset.width*asset.height*4)));
  return{width:Math.max(1,Math.floor(asset.width*scale)),height:Math.max(1,Math.floor(asset.height*scale))};
}

/** Stream compressed chunks into a bounded native tile texture. The full source image is not loaded. */
export async function composePlacedTexture(asset,{renderer,PIXI,decoder,width,height,stopped=()=>false}){
  const scale=Math.max(width/asset.width,height/asset.height),level=asset.lods.find(l=>2**l.z>=scale)??asset.lods.at(-1);
  const surface=PIXI.RenderTexture.create({width,height,resolution:1}),stage=new PIXI.Container();
  try{
    renderer.render(stage,{renderTexture:surface,clear:true});
    for(const chunk of level.tiles){
      if(stopped())throw renderingStopped();
      let input,frame,sprite;
      try{
        input=await decoder.acquire(chunk);if(stopped())throw renderingStopped();
        frame=new PIXI.Texture(input.baseTexture,new PIXI.Rectangle(chunk.frameX,chunk.frameY,chunk.frameWidth,chunk.frameHeight));
        sprite=new PIXI.Sprite(frame);sprite.position.set(chunk.x*width/asset.width,chunk.y*height/asset.height);sprite.width=chunk.width*width/asset.width;sprite.height=chunk.height*height/asset.height;stage.addChild(sprite);
        renderer.render(stage,{renderTexture:surface,clear:false});
      }finally{sprite?.destroy({texture:false,baseTexture:false});frame?.destroy(false);if(input)await decoder.release(chunk);}
    }
    return{texture:surface,width,height,bytes:width*height*4,dispose(){surface.destroy(true);}};
  }catch(error){surface.destroy(true);throw error;}finally{stage.destroy({children:true});}
}

export function tileInView(tile,view){const b=tile.bounds;return tile.visible!==false&&!!tile.mesh&&(!b||!view||b.x+b.width>=view.x&&b.y+b.height>=view.y&&b.x<=view.x+view.width&&b.y<=view.y+view.height);}

class TileSurface{
  constructor(tile,asset,manager){this.tile=tile;this.asset=asset;this.manager=manager;this.original=tile.texture;this.stopped=false;this.decoder=new KtxDecoder({bytes:async chunk=>{
    const response=await fetch(foundry.utils.getRoute(chunk.src),{cache:'no-cache'});if(!response.ok)throw Error(`Tile artwork could not be read (HTTP ${response.status}).`);
    const bytes=await response.arrayBuffer();if(bytes.byteLength!==chunk.ktxBytes)throw Error('Incomplete placed tile artwork.');
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');if(hash!==chunk.hash)throw Error('Placed tile artwork failed verification.');return bytes;
  }});}
  update(budget){
    this.budget=budget;if(this.stopped||this.failed||!this.tile.mesh||this.tile.visible===false)return;
    if(this.work){this.again=true;return;}
    this.work=this.draw().catch(error=>{if(!this.stopped&&error.name!=='AbortError'){this.failed=true;console.error('kg-realms | placed tile LOD',error);ui.notifications.error(`KG Realms: ${error.message} The tile preview is kept.`);}}).finally(()=>{this.work=null;if(this.again&&!this.stopped){this.again=false;this.update(this.budget);}});
  }
  async draw(){
    const epoch=this.epoch,asset=await resolveLocalLods(this.asset);if(this.stopped||this.epoch!==epoch)return;
    const renderer=canvas.app.renderer,max=renderer.gl.getParameter(renderer.gl.MAX_TEXTURE_SIZE),zoom=canvas.stage.scale.x*(window.devicePixelRatio??1);
    const size=placedTextureSize(asset,this.tile.document,zoom,this.budget,max);
    if(this.owned&&this.owned.bytes<=this.budget&&Math.abs(size.width-this.owned.width)<Math.max(2,this.owned.width*.15)&&Math.abs(size.height-this.owned.height)<Math.max(2,this.owned.height*.15))return;
    const next=await composePlacedTexture(asset,{...size,renderer,PIXI,decoder:this.decoder,stopped:()=>this.stopped||this.epoch!==epoch});
    if(this.stopped||this.epoch!==epoch||!this.tile.mesh){next.dispose();return;}
    // Keep Tile.texture as a normal image for core sourceElement, video checks and drag previews.
    const old=this.owned;this.owned=next;this.tile.mesh.texture=next.texture;
    this.tile.renderFlags?.set({refreshMesh:true,refreshTransform:true,refreshElevation:true,refreshState:true,refreshPerception:true});old?.dispose();
  }
  release(){this.epoch=(this.epoch??0)+1;if(this.owned){if(!this.tile.mesh?.destroyed&&this.tile.mesh?.texture===this.owned.texture){this.tile.mesh.texture=this.original;this.tile.renderFlags?.set({refreshMesh:true,refreshTransform:true,refreshPerception:true});}this.owned.dispose();this.owned=null;}}
  stop(){this.stopped=true;this.release();}
}

export class PlacedTileLods{
  constructor(){this.surfaces=new Map();}
  install(){
    Hooks.on('drawTile',tile=>this.attach(tile));Hooks.on('destroyTile',tile=>this.remove(tile));
    Hooks.on('updateTile',doc=>{const tile=doc.object;if(!tile)return;const surface=this.surfaces.get(doc.id),asset=placedTileAsset(doc);if(surface&&surface.asset.id!==asset?.id)this.remove(tile);this.schedule();});
    for(const hook of ['canvasPan','canvasResize'])Hooks.on(hook,()=>this.schedule());
    Hooks.on('canvasTearDown',()=>this.clear());Hooks.on('canvasReady',()=>{for(const tile of canvas.tiles?.placeables??[])this.attach(tile);this.schedule();});
    // Show the editable source in Configure Tile, while the stored renderer source stays lightweight.
    Hooks.on('renderTileConfig',(app,html)=>{const doc=app.document??app.object,asset=placedTileAsset(doc),root=html instanceof HTMLElement?html:html?.[0];const field=root?.querySelector('[name="texture.src"]');if(asset&&field)field.value=asset.source;});
    Hooks.on('preUpdateTile',(doc,changes)=>{const asset=placedTileAsset(doc);if(!asset||changes.flags?.[ID]?.['-=tileAsset']!==undefined||changes[`flags.${ID}.-=tileAsset`]!==undefined)return;
      if(changes['texture.src']===asset.source)changes['texture.src']=asset.preview;else if(changes.texture?.src===asset.source)changes.texture.src=asset.preview;
    });
  }
  attach(tile){if(tile._original)return;const asset=placedTileAsset(tile.document);if(!asset||!tile.mesh)return;this.surfaces.get(tile.document.id)?.stop();this.surfaces.set(tile.document.id,new TileSurface(tile,asset,this));this.schedule();}
  remove(tile){const key=tile.document?.id??tile.id,surface=this.surfaces.get(key);if(surface?.tile!==tile)return;surface.stop();this.surfaces.delete(key);}
  clear(){for(const surface of this.surfaces.values())surface.stop();this.surfaces.clear();if(this.pending!=null)cancelAnimationFrame(this.pending);this.pending=null;}
  schedule(){if(this.pending!=null)return;this.pending=requestAnimationFrame(()=>{this.pending=null;this.update();});}
  update(){const transform=canvas.stage.worldTransform,screen=canvas.app.renderer.screen,a=transform.applyInverse({x:0,y:0}),b=transform.applyInverse({x:screen.width,y:screen.height}),view={x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y)};
    const visible=[];for(const surface of this.surfaces.values()){if(tileInView(surface.tile,view))visible.push(surface);else surface.release();}
    const budget=(Number(game.settings.get(ID,'localMapBudget'))||128)*1048576/2/Math.max(1,visible.length);for(const surface of visible)surface.update(budget);
  }
  status(){return{tiles:this.surfaces.size,gpuBytes:[...this.surfaces.values()].reduce((n,s)=>n+(s.owned?.bytes??0),0)};}
}
