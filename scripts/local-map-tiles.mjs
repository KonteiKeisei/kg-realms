import {isPrimaryGM} from './authority.mjs';
import {backgroundOf} from './local-maps.mjs';
import {runMapBuild} from './homebrew/map-build.mjs';
import {TileEncoder,cutTile,ktx2Header} from './homebrew/tiles.mjs';
import {MAX_PICTURE,TILE_SUFFIX} from './homebrew/plan.mjs';
import {BuildWindow,ensureDir,upload} from './homebrew/homebrew.mjs';

const ID='kg-realms';
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const esc=value=>foundry.utils.escapeHTML(String(value??''));
const savedPath=(result,requested)=>typeof result==='string'?result:typeof result?.path==='string'?result.path:requested;

/** Three detail levels in image pixel space. Scene dimensions, elevation and grid never change. */
export function planLocalTiles(width,height,{sceneId,buildId,placed=false}={}) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||Math.max(width,height)>MAX_PICTURE)throw Error('Invalid local-map picture dimensions.');
  if(!/^[\w-]+$/.test(sceneId??'')||!/^[\w-]+$/.test(buildId??''))throw Error('Invalid local-map build identity.');
  const city=`scene-${sceneId}`,id=`${city}-${buildId}`,dataRoot=`KG Realms Data/Local/${sceneId}/${buildId}`,tileDir=`${dataRoot}/assets/maps/ktx2/${city}`;
  const coarse=placed?Math.min(-2,Math.floor(Math.log2(512/Math.max(width,height)))):-2;
  const levels=placed?[coarse,Math.min(-1,Math.floor(coarse/2)),0]:[-2,-1,0];
  const lods=levels.map(z=>{
    const scale=2**z,w=Math.max(1,Math.ceil(width*scale)),h=Math.max(1,Math.ceil(height*scale)),tiles=[];
    for(let y=0;y<h;y+=1020)for(let x=0;x<w;x+=1020){
      const pw=Math.min(1020,w-x),ph=Math.min(1020,h-y),tw=Math.ceil((pw+4)/4)*4,th=Math.ceil((ph+4)/4)*4,name=`z${z+2}-${x}-${y}`;
      tiles.push({id:name,lod:z,x:x/scale,y:y/scale,width:Math.min(pw/scale,width-x/scale),height:Math.min(ph/scale,height-y/scale),textureWidth:tw,textureHeight:th,frameX:2,frameY:2,frameWidth:Math.min(pw,(width-x/scale)*scale),frameHeight:Math.min(ph,(height-y/scale)*scale),src:`${tileDir}/${name}${TILE_SUFFIX}`,crop:{left:Math.max(0,x-2),top:Math.max(0,y-2),right:Math.min(w,x+pw+2),bottom:Math.min(h,y+ph+2),padLeft:x===0?2:0,padTop:y===0?2:0,scale}});
    }
    return{z,tiles};
  });
  return{id,city,dataRoot,tileDir,width,height,lods};
}

async function readPicture(src){
  const url=/^(?:https?:|data:|blob:)/i.test(src)?src:foundry.utils.getRoute(src);
  const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error(`The picture could not be read (HTTP ${response.status}).`);
  const blob=await response.blob();let bitmap=await createImageBitmap(blob);
  if(Math.max(bitmap.width,bitmap.height)>MAX_PICTURE){const f=MAX_PICTURE/Math.max(bitmap.width,bitmap.height),width=Math.max(1,Math.round(bitmap.width*f)),height=Math.max(1,Math.round(bitmap.height*f));bitmap.close();bitmap=await createImageBitmap(blob,{resizeWidth:width,resizeHeight:height,resizeQuality:'high'});}
  return bitmap;
}

/** Build and verify a new folder before switching one scene flag. Failures keep the map in use. */
export async function buildLocalMapTiles(scene,src,io={}) {
  const authority=io.authority??(()=>isPrimaryGM()),halt=()=>{if(io.cancelled?.())throw Error('Build cancelled.');if(!authority())throw Error('The primary GM must build local-map tiles.');};
  halt();const previous=structuredClone(scene.getFlag(ID,'localMap'));if(!previous)throw Error('Make this scene a local map first.');
  if((scene.levels?.size??scene.levels?.contents?.length??0)>1)throw Error('Background tiling currently requires a scene with one level. Overhead tiles can keep their elevations.');
  if(!src||/\.(webm|mp4|m4v|ogv)(?:[?#]|$)/i.test(src))throw Error('Choose a still picture in Background Image.');
  const revision=JSON.stringify(previous.tileAsset??null),size=[scene.width,scene.height],progress=io.progress??(()=>{});let bitmap,encoder,rollback,committed=false;
  try{
    progress('read',0,1);bitmap=await(io.picture??readPicture)(src);halt();
    const plan=planLocalTiles(bitmap.width,bitmap.height,{sceneId:scene.id,buildId:io.buildId??crypto.randomUUID(),placed:io.placed}),tiles=plan.lods.flatMap(l=>l.tiles);
    progress('read',1,1);
    if(io.prepare)await io.prepare(plan.tileDir);else await ensureDir(plan.tileDir);
    const write=io.write??(async(path,bytes,type)=>{const parts=path.split('/'),name=parts.pop();return upload(parts.join('/'),name,bytes,type);});
    const read=io.read??(async path=>{const url=/^(?:https?:|blob:|data:)/i.test(path)?path:foundry.utils.getRoute(path);let r;
      for(let attempt=0;attempt<3;attempt++){r=await fetch(url,{cache:'no-store'});if(r.ok)break;if(![404,503].includes(r.status)||attempt===2)throw Error(`Saved file could not be read (HTTP ${r.status}): ${path}`);await new Promise(resolve=>setTimeout(resolve,150*(attempt+1)));}
      return new Uint8Array(await r.arrayBuffer());});
    await io.bitmapReady?.(bitmap,plan,{write,read});
    const workers=Math.max(1,Math.min(2,(globalThis.navigator?.hardwareConcurrency??2)-1));
    if(!io.encode){encoder=new TileEncoder(workers,`${location.origin}${foundry.utils.getRoute(`modules/${ID}`)}`);await encoder.ready;}
    let next=0,done=0;
    await Promise.all(Array.from({length:workers},async(_,worker)=>{
      while(next<tiles.length){halt();const tile=tiles[next++];
        const bytes=await(io.encode?io.encode(bitmap,tile,worker):encoder.encode(worker,cutTile(bitmap,tile),tile.textureWidth,tile.textureHeight,{alpha:true}));halt();
        const head=ktx2Header(bytes);if(!head.magic||head.width!==tile.textureWidth||head.height!==tile.textureHeight||head.levels!==1)throw Error(`The encoder made an invalid tile: ${tile.id}.`);
        tile.hash=await hash(bytes);tile.ktxBytes=bytes.byteLength;tile.src=savedPath(await write(tile.src,bytes,'application/octet-stream'),tile.src);
        const stored=await read(tile.src);if(stored.byteLength!==tile.ktxBytes||await hash(stored)!==tile.hash)throw Error(`The server changed tile ${tile.id}.`);
        progress('tiles',++done,tiles.length);
      }
    }));halt();
    const lods=plan.lods.map(l=>({...l,tiles:l.tiles.map(({crop,...tile})=>tile)}));
    const manifest={schema:1,id:plan.id,width:plan.width,height:plan.height,lods};
    let lodManifest=`${plan.dataRoot}/lods.json`;const bytes=new TextEncoder().encode(JSON.stringify(manifest));
    lodManifest=savedPath(await write(lodManifest,bytes,'application/json'),lodManifest);
    if(await hash(await read(lodManifest))!==await hash(bytes))throw Error('The server changed the local-map catalogue.');
    halt();const latest=scene.getFlag(ID,'localMap');
    if(!latest||latest.world!==previous.world||latest.placeId!==previous.placeId||JSON.stringify(latest.tileAsset??null)!==revision||scene.width!==size[0]||scene.height!==size[1])throw Error('The local map changed during this build. Start again from its current settings.');
    const asset={id:plan.id,city:plan.city,width:plan.width,height:plan.height,world:latest.world,placeId:latest.placeId,source:src,lodManifest,dataRoot:plan.dataRoot,tiles:[]};
    rollback=await io.beforePublish?.(asset);halt();
    const final=scene.getFlag(ID,'localMap');if(!final||final.world!==previous.world||final.placeId!==previous.placeId||JSON.stringify(final.tileAsset??null)!==revision||scene.width!==size[0]||scene.height!==size[1])throw Error('The local map changed during this build. Start again from its current settings.');
    progress('save',0,1);
    // The original source remains editable and travels with exports. Only its rendering changes.
    let level,oldSource;
    if((game.release?.generation??13)>=14&&scene.levels){level=scene.initialLevel??scene.firstLevel??scene.levels.contents?.[0];if(!level)throw Error('The scene has no starting level.');oldSource=level.background?.src;await level.update({'background.src':src});}
    try{halt();await scene.update({[`flags.${ID}.localMap.tileAsset`]:asset,...((game.release?.generation??13)<14?{'background.src':src}:{})});}
    catch(error){if(level)await level.update({'background.src':oldSource??null}).catch(rollback=>console.error('kg-realms | restoring local map background',rollback));throw error;}
    committed=true;progress('save',1,1);return asset;
  }catch(error){if(!committed&&rollback)await rollback().catch(failed=>console.error('kg-realms | restoring placed tiles',failed));throw error;}
  finally{encoder?.stop();bitmap?.close();}
}

/** Retile placed image artwork while leaving every native Tile document's geometry intact. */
export async function stagePlacedMapTiles(scene,io={}){
  const docs=Array.from(scene.tiles?.values?.()??scene.tiles??[]),patches=[],old=[];
  for(const tile of docs){
    const id=tile.id??tile._id,previous=tile.getFlag?.(ID,'tileAsset')??tile.flags?.[ID]?.tileAsset,current=tile.texture?.src;
    const src=previous&&current===previous.preview?previous.source:current;
    if(!src||/\.(?:webm|mp4|m4v|ogv)(?:[?#]|$)/i.test(src))continue;
    let preview;
    const fake={id:`${scene.id}-${id}`,name:tile.name??'Placed tile',width:tile.width,height:tile.height,flags:{localMap:{world:scene.getFlag(ID,'localMap')?.world,placeId:id}},getFlag:(_m,k)=>fake.flags[k],update:async patch=>{fake.flags.localMap.tileAsset=patch[`flags.${ID}.localMap.tileAsset`];}};
    const asset=await buildLocalMapTiles(fake,src,{...io,placed:true,beforePublish:undefined,bitmapReady:async(bitmap,plan,{write,read})=>{
      let bytes;
      if(io.preview)bytes=await io.preview(bitmap);
      else{const factor=Math.min(1,512/Math.max(bitmap.width,bitmap.height)),canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*factor)),Math.max(1,Math.round(bitmap.height*factor)));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bytes=new Uint8Array(await(await canvas.convertToBlob({type:'image/png'})).arrayBuffer());}
      preview=`${plan.dataRoot}/preview.png`;preview=savedPath(await write(preview,bytes,'image/png'),preview);if(await hash(await read(preview))!==await hash(bytes))throw Error('The server changed a tile preview.');
    }});
    patches.push({_id:id,'texture.src':preview,[`flags.${ID}.tileAsset`]:{...asset,tileId:id,preview}});
    old.push({id,src:current,asset:structuredClone(previous)});
  }
  for(const original of old){const latest=Array.from(scene.tiles?.values?.()??scene.tiles??[]).find(t=>(t.id??t._id)===original.id);if(!latest||latest.texture?.src!==original.src||JSON.stringify(latest.getFlag?.(ID,'tileAsset')??latest.flags?.[ID]?.tileAsset)!==JSON.stringify(original.asset))throw Error('A placed tile changed during the build. Start again.');}
  if(io.cancelled?.())throw Error('Build cancelled.');
  if(!(io.authority??(()=>isPrimaryGM()))())throw Error('The primary GM must build local-map tiles.');
  const restore=async()=>{if(!old.length)return;await scene.updateEmbeddedDocuments('Tile',old.map(t=>({_id:t.id,'texture.src':t.src,...(t.asset?{[`flags.${ID}.tileAsset`]:t.asset}:{[`flags.${ID}.-=tileAsset`]:null})})));};
  try{if(patches.length)await scene.updateEmbeddedDocuments('Tile',patches);}catch(error){await restore().catch(()=>{});throw error;}
  return restore;
}

export async function regenerateLocalMapTiles(scene,src) {
  if(!isPrimaryGM())return ui.notifications.warn('KG Realms: the primary GM must regenerate local-map tiles.');
  if(!src)return ui.notifications.warn('KG Realms: choose a picture in Background Image first.');
  const yes=await foundry.applications.api.DialogV2.confirm({window:{title:`Regenerate tiles: ${scene.name}`},content:`<p>Build new background tiles and optimize placed image tiles for ${esc(scene.name)}. Pins, roads, grid scale and scene contents stay in place. Each placed tile retains its position, elevation and occlusion settings. Videos stay native.</p><p>The current tiles stay in use until every new file has been saved and verified.</p>`,rejectClose:false});
  if(!yes)return;
  let cancelled=false;
  const win=new BuildWindow(scene.name,()=>{cancelled=true;win.message='Stopping...';win.render();},{id:`kgr-local-build-${scene.id}`,title:`Local map tiles: ${scene.name}`,steps:[['read','Read the picture'],['tiles','Build and verify tiles'],['save','Switch the map to them']]});win.render({force:true});
  try{
    const io={cancelled:()=>cancelled,progress:(step,done,total)=>win.set(step,done===total?'done':'now',`${done} / ${total}`)};
    const asset=await runMapBuild(`local:${scene.id}`,()=>buildLocalMapTiles(scene,src,{...io,beforePublish:()=>stagePlacedMapTiles(scene,io)}));
    win.finished=true;win.message='Done. The local map is using the new tiles.';win.render();return asset;
  }catch(error){win.finished=true;win.message=`${error.message} The previous tile selection was kept.`;win.render();console.error('kg-realms | local map tiles',error);}
}

export function localMapPicture(root,scene) {
  if(!root||!scene?.getFlag(ID,'localMap')||root.querySelector('[data-kgr-local-map-picture]'))return;
  const field=root.querySelector('[name$="background.src"]'),row=document.createElement('div');row.className='form-group';row.dataset.kgrLocalMapPicture='true';
  row.innerHTML='<label>Local map tiles</label><div class="form-fields"><button type="button" data-local-map-regen><i class="fa-solid fa-arrows-rotate"></i> Regenerate local map tiles from Background Image</button></div><p class="hint">Rebuilds the background and optimizes placed image tiles. Pins, roads, walls, lights, grid and tile elevations are preserved. Videos remain native.</p>';
  row.querySelector('button').addEventListener('click',()=>regenerateLocalMapTiles(scene,String(field?.value??'').trim()||backgroundOf(scene)||scene.getFlag(ID,'localMap')?.tileAsset?.source));
  const native=field?.closest('.form-group');if(native)native.after(row);else(root.querySelector('form')??root).append(row);
}
