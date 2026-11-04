import {onCanvas} from './canvas-input.mjs';
import {sourceProjection} from './source-map.mjs';
import {segmentCuts,mixPoint,affine} from './regional-maps.mjs';
import {pointInBiome} from './biomes.mjs';

export function rectangleLink(center,width,parentSheet,regionalSheet){
  const height=width*regionalSheet.height/regionalSheet.width,x=center[0]-width/2,y=center[1]-height/2;
  const corners=[[x,y],[x+width,y],[x+width,y+height],[x,y+height]],p=sourceProjection(parentSheet);
  return {footprint:corners.map(q=>p.toLonLat(...q)),anchors:[{parent:corners[0],region:[0,0]},{parent:corners[1],region:[regionalSheet.width,0]},{parent:corners[3],region:[0,regionalSheet.height]}],placement:{center:[...center],width,height}};
}

/** Every distinct parent-road crossing becomes the same endpoint on both maps. */
export function regionalEntrances(routes,link,parentSheet,regionalSheet){
  const p=sourceProjection(parentSheet),r=sourceProjection(regionalSheet),t=affine(link.anchors),polygon=link.footprint.map(q=>p.toSource(...q)),out=[];
  for(const f of routes.features??[]){
    if(f.geometry?.type!=='LineString')continue;
    const pts=f.geometry.coordinates.map(q=>p.toSource(...q)),route=f.properties?.id??'road',kind=f.properties?.kind==='trail'?'Trail':'Road';let crossing=out.filter(e=>e.route===route).length;
    for(let i=1;i<pts.length;i++){
      const a=pts[i-1],b=pts[i],cuts=segmentCuts(a,b,polygon);
      for(const cut of cuts){
        const before=mixPoint(a,b,Math.max(0,cut-1e-5)),after=mixPoint(a,b,Math.min(1,cut+1e-5));
        let crosses=pointInBiome(before,polygon)!==pointInBiome(after,polygon);
        // A traced route may end exactly on the boundary.
        if(!crosses&&(cut===0||cut===1)){const q=mixPoint(a,b,cut),extended=mixPoint(a,b,cut===0?-1e-5:1+1e-5);crosses=pointInBiome(q,polygon)!==pointInBiome(extended,polygon);}
        if(!crosses)continue;
        const at=mixPoint(a,b,cut);if(out.some(e=>e.route===route&&Math.hypot(e.parent[0]-at[0],e.parent[1]-at[1])<.01))continue;
        const native=t.toRegion(at),id=`regional-entry:${link.world}:${route}:${crossing++}`;
        out.push({id,route,kind,name:`${kind} crossing ${out.length+1}${f.properties?.name?`: ${f.properties.name}`:''}`,parent:at,region:native,parentLL:p.toLonLat(...at),regionLL:r.toLonLat(...native)});
      }
    }
  }return out;
}

/** Regional crossing positions are local overrides; their realm-side anchors remain fixed. */
export function adjustedEntrances(entries,edits,sheet){
  const projection=sourceProjection(sheet);
  return entries.map(entry=>{const e=edits?.[entry.id];if(!Number.isFinite(e?.lon)||!Number.isFinite(e?.lat))return entry;
    return {...entry,regionLL:[e.lon,e.lat],region:projection.toSource(e.lon,e.lat),adjusted:true};});
}

export function followCrossingRoads(routes,entries){
  const byId=new Map(entries.map(e=>[e.id,e.regionLL]));
  return {...routes,features:(routes?.features??[]).map(f=>{const from=byId.get(f.properties?.from),to=byId.get(f.properties?.to);if((!from&&!to)||f.geometry?.type!=='LineString')return f;const coordinates=f.geometry.coordinates.map(p=>[...p]);if(from)coordinates[0]=[...from];if(to)coordinates[coordinates.length-1]=[...to];return {...f,geometry:{...f.geometry,coordinates}};})};
}

/** Clip rather than project unrelated journeys onto the regional picture. */
export function regionalJourneyParts(path,wet,link,parentSheet,regionalSheet){
  if(!path?.length)return [];
  const p=sourceProjection(parentSheet),r=sourceProjection(regionalSheet),t=affine(link.anchors),polygon=link.footprint.map(q=>p.toSource(...q));
  const picture=[[0,0],[regionalSheet.width,0],[regionalSheet.width,regionalSheet.height],[0,regionalSheet.height]].map(t.toParent);
  const inside=q=>pointInBiome(q,polygon)&&pointInBiome(q,picture),parts=[];let run=null;
  for(let i=1;i<path.length;i++){
    const a=p.toSource(...path[i-1]),b=p.toSource(...path[i]),cuts=[...new Set([...segmentCuts(a,b,polygon),...segmentCuts(a,b,picture)])].sort((x,y)=>x-y);
    for(let j=1;j<cuts.length;j++){
      const x=mixPoint(a,b,cuts[j-1]),y=mixPoint(a,b,cuts[j]);
      if(!inside(mixPoint(x,y,.5))){run=null;continue;}
      const start=r.toLonLat(...t.toRegion(x)),end=r.toLonLat(...t.toRegion(y));
      if(!run){run={coords:[start],wet:[!!wet?.[i-1]]};parts.push(run);}
      run.coords.push(end);run.wet.push(!!wet?.[i-1]);
    }
  }return parts;
}

/** A local placement tool. It changes no settings until its Finish button is used. */
export async function placeRegionalRectangle({parentScene,parentSheet,regionalSheet,existing,placeChoices=[],placeId=null,getLayer,onStart}){
  await parentScene.view();onStart?.();
  let layer=getLayer();
  const expected=parentScene.getFlag?.('kg-realms','world');
  for(let i=0;i<200&&(!layer?.frame||layer.ready===false||(layer.options?.world&&layer.options.world!==expected));i++){await new Promise(resolve=>setTimeout(resolve,50));layer=getLayer();}
  const p=sourceProjection(parentSheet);
  if(!layer?.frame||layer.ready===false||(layer.options?.world&&layer.options.world!==expected))throw Error('Wait for the parent map to finish loading, then place the rectangle again.');
  const old=existing?.footprint?.map(q=>p.toSource(...q)),center=old?[old.reduce((n,q)=>n+q[0],0)/old.length,old.reduce((n,q)=>n+q[1],0)/old.length]:[parentSheet.width/2,parentSheet.height/2];
  let width=old?Math.max(...old.map(q=>q[0]))-Math.min(...old.map(q=>q[0])):parentSheet.width/5,drag=null;
  if(!old&&canvas.app?.renderer?.screen){const screen=canvas.app.renderer.screen,a=p.toSource(...layer.fromScreen(screen.width*.25,screen.height/2)),b=p.toSource(...layer.fromScreen(screen.width*.75,screen.height/2)),c=p.toSource(...layer.fromScreen(screen.width/2,screen.height/2));center.splice(0,2,...c);width=Math.abs(b[0]-a[0]);}
  const el=document.createElement('div');el.className='kgr-ui kgr-panel';el.style.cssText='position:fixed;top:100px;left:80px;width:370px;z-index:110;';
  el.innerHTML='<div class="body" style="padding:14px"><b>Place regional map on the realm</b><p>Drag inside the rectangle to move it. Alt + mouse wheel makes it larger or smaller. The picture aspect ratio stays fixed; regional miles do not change.</p><button type="button" data-finish>Use this rectangle</button><button type="button" data-cancel>Cancel</button></div>';document.body.append(el);
  const label=document.createElement('label');label.textContent='Area';
  const select=document.createElement('select');select.name='regional-place';
  for(const p of [{id:'',name:'No linked place'},...placeChoices]){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;if(p.id===(placeId??''))option.setAttribute('selected','');select.append(option);}
  label.append(select);
  const hint=document.createElement('p');hint.textContent="This place's card opens the regional scene. Draw its territory outline separately in Places; resizing this rectangle keeps that outline unchanged.";
  const finish=el.querySelector('[data-finish]');finish.before(label,hint);
  return new Promise(resolve=>{
    let off;
    const result=()=>({...rectangleLink(center,width,parentSheet,regionalSheet),placeId:select.value||null}),render=()=>layer.setAreaEdit(result().footprint,true);
    const point=e=>{const rect=canvas.app.view.getBoundingClientRect(),ll=layer.fromScreen(e.clientX-rect.left,e.clientY-rect.top);return p.toSource(...ll);};
    const stop=e=>{e.preventDefault();e.stopImmediatePropagation();};
    const cleanup=value=>{off?.();window.removeEventListener('keydown',key,true);el.remove();layer.setAreaEdit(null);resolve(value);};
    const key=e=>{if(e.key==='Escape'){stop(e);cleanup(null);}};
    off=onCanvas({pointerdown:e=>{if(e.button!==0)return;const q=point(e),height=width*regionalSheet.height/regionalSheet.width;if(Math.abs(q[0]-center[0])<=width/2&&Math.abs(q[1]-center[1])<=height/2){stop(e);drag={at:q,center:[...center]};}},pointermove:e=>{if(!drag)return;stop(e);const q=point(e);center[0]=drag.center[0]+q[0]-drag.at[0];center[1]=drag.center[1]+q[1]-drag.at[1];render();},pointerup:e=>{if(drag){stop(e);drag=null;}},wheel:e=>{if(!e.altKey||e.target!==canvas.app.view)return;stop(e);width=Math.max(parentSheet.width/10000,Math.min(parentSheet.width*2,width*Math.exp(-e.deltaY*.0015)));render();}});
    window.addEventListener('keydown',key,true);el.querySelector('[data-finish]').onclick=()=>cleanup(result());el.querySelector('[data-cancel]').onclick=()=>cleanup(null);render();
  });
}
