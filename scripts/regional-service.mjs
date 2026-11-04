import {placeRegionalRectangle,regionalEntrances,regionalJourneyParts} from './regional-placement.mjs';
import { compileRegions, affine, regionalPlaces } from './regional-maps.mjs';
import { sourceProjection } from './source-map.mjs';
import { buildGraph, terrainLookup } from './travel.mjs';
import { pointInBiome, biomeLookup } from './biomes.mjs';
import { makeFrame, aspect, latLonToScene, sceneToLatLon } from './geo.mjs';
import { applyEdits } from './places.mjs';
import { focusedScene } from './party-groups.mjs';
import { onCanvas } from './canvas-input.mjs';
import { isPrimaryGM } from './authority.mjs';
const ID='kg-realms', KEY='regionalMaps';
const clone=x=>structuredClone(x), esc=x=>foundry.utils.escapeHTML(String(x??''));
export class RegionalMaps {
  constructor(options){Object.assign(this,options);this.indexes={};this.networks=new Map();this.writes=Promise.resolve();this.loadErrors={};this.entryPoints={};}
  get links(){return game.settings.get(ID,KEY)??{};}
  init(){
    game.settings.register(ID,KEY,{scope:'world',config:false,type:Object,default:{},onChange:()=>{this.networks.clear();this.onChange?.();}});
    for(const hook of ['getSceneContextOptions','getSceneDirectoryEntryContext'])Hooks.on(hook,(_app,options)=>{
      options.push({name:'Regional map settings',icon:'<i class="fa-solid fa-map-location-dot"></i>',condition:li=>game.user.isGM&&!!this.sceneFrom(li)?.getFlag(ID,'world'),callback:li=>this.configure(this.sceneFrom(li)).catch(e=>ui.notifications.error(`KG Realms: ${e.message}`))});
    });
  }
  sceneFrom(li){const el=li?.[0]??li;return game.scenes.get(el?.dataset?.entryId??el?.dataset?.documentId);}
  async load(id){try{const data=await this.loadWorld(id);delete this.loadErrors[id];return this.indexes[id]=data;}catch(error){this.loadErrors[id]=error;throw error;}}
  async prepare(id){
    const own=this.links[id],root=own?.parent??id,links=Object.values(this.links).filter(l=>l.parent===root);
    if(own&&!game.scenes.get(own.parentScene))throw Error('The parent realm scene is missing. Repair it in Regional map settings.');
    await Promise.allSettled([root,...links.map(l=>l.world)].map(w=>this.load(w)));
    if(this.loadErrors[id])throw this.loadErrors[id];
    if(links.length&&!this.loadErrors[root]){
      const routes=await this.getRoutes(root,this.indexes[root]);
      for(const link of links)if(this.indexes[link.world])this.entryPoints[link.world]=regionalEntrances(routes,link,this.indexes[root].sourceMap,this.indexes[link.world].sourceMap);
    }
  }
  places(id){const list=regionalPlaces(id,w=>this.rawPlaces(w,this.indexes[w]?.places??[]),this.links,this.indexes);const result=applyEdits(list,{edits:this.getEdits?.(id)?.edits??{}},"surface");
    const relevant=this.links[id]?[this.links[id]]:Object.values(this.links).filter(l=>l.parent===id);
    for(const link of relevant)for(const entry of this.entryPoints[link.world]??link.entrances??[]){const ll=id===link.world?entry.regionLL:entry.parentLL;result.push({id:entry.id,name:entry.name,lon:ll[0],lat:ll[1],kind:'site',class:'Site',rank:1,gold:true,visibility:'discovered',regionalEntry:true,summary:'Linked realm/regional road crossing. Draw regional roads to this marker. Its position follows map placement.'});}return result;}
  destinations(id){
    const out=this.places(id),byId=new Map(out.map((p,i)=>[p.id,i]));
    for(const link of Object.values(this.links).filter(l=>l.parent===id)){
      if(!this.indexes[link.world]||!this.indexes[id])continue;
      const parent=sourceProjection(this.indexes[id].sourceMap),child=sourceProjection(this.indexes[link.world].sourceMap),t=affine(link.anchors);
      for(const p of this.places(link.world).filter(p=>!p.regionalEntry)){
        const ll=parent.toLonLat(...t.toParent(child.toSource(p.lon,p.lat)));
        if(!pointInBiome(ll,link.footprint))continue;
        const mapped={...p,lon:ll[0],lat:ll[1],regionalWorld:link.world,regionalTitle:link.title};
        if(byId.has(p.id))out[byId.get(p.id)]=mapped;else{byId.set(p.id,out.length);out.push(mapped);}
      }
    }return out;
  }
  recordRef(world,id){const match=/^region\/([\w-]+)\/(.+)$/.exec(id??'');return match?{world:match[1],id:match[2]}:{world,id};}
  metricFor(world,child){
    const link=this.links[child];if(!link||link.parent!==world)return {};
    const t=affine(link.anchors),o=t.toRegion([0,0]),x=t.toRegion([1,0]),y=t.toRegion([0,1]);
    return {nativeMetric:[x[0]-o[0],x[1]-o[1],y[0]-o[0],y[1]-o[1]]};
  }
  encounters(world,records){
    if(!this.indexes[world])return [];
    const root=sourceProjection(this.indexes[world].sourceMap),out=Object.entries(records(world)).map(([id,e])=>({id,...e,at:root.toSource(e.lon,e.lat),reach:(e.radius??3)/root.sourceMap.milesPerPixel}));
    for(const link of Object.values(this.links).filter(l=>l.parent===world)){
      if(!this.indexes[link.world])continue;
      const child=sourceProjection(this.indexes[link.world].sourceMap),t=affine(link.anchors);
      for(const [id,e] of Object.entries(records(link.world))){const at=t.toParent(child.toSource(e.lon,e.lat)),ll=root.toLonLat(...at);out.push({...e,id:`region/${link.world}/${id}`,sourceWorld:link.world,sourceRecord:id,lon:ll[0],lat:ll[1],at,reach:(e.radius??3)/child.sourceMap.milesPerPixel,...this.metricFor(world,link.world)});}
    }return out;
  }
  rootScene(scene){const link=this.links[scene?.getFlag(ID,'world')];return link?game.scenes.get(link.parentScene):scene;}
  ownerScene(scene){const root=this.rootScene(scene);return root?focusedScene(root):null;}
  async network(id){
    const links=Object.values(this.links).filter(l=>l.parent===id);
    if(!links.length)return null;
    await this.prepare(id);
    for(const link of links)if(this.loadErrors[link.world])throw Error(`${link.title}: regional map data is unavailable. Restore it before planning through this realm.`);
    const key=JSON.stringify([links,this.revision?.(),[id,...links.map(l=>l.world)].map(w=>this.indexes[w]?.sourceMap)]);
    if(this.networks.get(id)?.key===key)return this.networks.get(id).network;
    const contexts=await Promise.all(links.map(async link=>{
      const data=this.indexes[link.world],grid=await this.getTerrain(link.world,data),projection=sourceProjection(data.sourceMap);
      return {link,data,terrainAt:biomeLookup(this.getBiomes(link.world),terrainLookup(grid),projection.toSource).terrain};
    }));
    const parent={...this.indexes[id],id},network=compileRegions(parent,contexts);
    const childRoutes=Object.fromEntries(await Promise.all(links.map(async l=>[l.world,await this.getRoutes(l.world,this.indexes[l.world])])));
    network.routes=network.roads(await this.getRoutes(id,parent),childRoutes);
    const labels=this.destinations(id).filter(p=>['Road','Trail'].includes(p.class)).map(p=>({name:p.name,at:network.root.toSource(p.lon,p.lat)}));
    network.graph=buildGraph(network.routes.features,network.root.toSource,labels,{precision:1e6});
    this.networks.set(id,{key,network});return network;
  }
  frame(scene){
    const id=scene?.getFlag(ID,'world'),data=this.indexes[id];if(!data?.sourceMap)return null;
    const d=scene.dimensions,r=d.sceneRect??{x:d.sceneX,y:d.sceneY,width:d.sceneWidth,height:d.sceneHeight},bounds=data.sourceMap.bounds,ratio=aspect(bounds),width=Math.min(r.width,r.height/ratio),height=width*ratio;
    return makeFrame(bounds,{x:r.x+(r.width-width)/2,y:r.y+(r.height-height)/2,width,height});
  }
  viewLayer(layer,world){
    const link=this.links[world];if(!link)return layer;
    const parent=sourceProjection(this.indexes[link.parent].sourceMap),region=sourceProjection(this.indexes[world].sourceMap),t=affine(link.anchors);
    const toView=(lon,lat)=>region.toLonLat(...t.toRegion(parent.toSource(lon,lat))),fromView=(lon,lat)=>parent.toLonLat(...t.toParent(region.toSource(lon,lat)));
    return new Proxy(layer,{get(target,key){
      if(key==='frame')return {project:(lat,lon)=>{const p=toView(lon,lat);return latLonToScene(target.frame,p[1],p[0]);},unproject:p=>{const v=sceneToLatLon(target.frame,p),q=fromView(v.lon,v.lat);return {lon:q[0],lat:q[1]};}};
      if(key==='setJourney')return(path,marks,wet)=>{
        const parts=regionalJourneyParts(path,wet,link,parent.sourceMap,region.sourceMap);
        const visible=marks?.filter(m=>{const q=t.toRegion(parent.toSource(...m.at));return pointInBiome(m.at,link.footprint)&&q[0]>=0&&q[1]>=0&&q[0]<=region.sourceMap.width&&q[1]<=region.sourceMap.height;}).map(m=>({...m,at:toView(...m.at)}));
        return target.setJourney(null,visible??[],null,parts);
      };
      if(key==='toScreen')return(lon,lat)=>target.toScreen(...toView(lon,lat));
      if(key==='fromScreen')return(...args)=>{const p=target.fromScreen(...args);return p?fromView(...p):p;};
      if(key==='placeAt')return(...args)=>{const p=target.placeAt(...args);if(!p||typeof p==='string')return p;const q=fromView(p.lon,p.lat);return {...p,lon:q[0],lat:q[1]};};
      const value=target[key];return typeof value==='function'?value.bind(target):value;
    }});
  }
  // Coordinate edits stay local. Metadata edits to an inherited place go to its canonical map.
  reconcileEdits(world,before,after,all){
    const places=this.places(world),coordinate=new Set(['lon','lat','area','shape','areaClosed','follow','shore','biomeZone','removed']);
    for(const p of places){if(p.regionalEntry){delete after.edits?.[p.id];delete after.added?.[p.id];continue;}if(!p.canonicalWorld||p.canonicalWorld===world)continue;
      const old=before.edits?.[p.id]??{},next=after.edits?.[p.id]??{},target=all[p.canonicalWorld]??={edits:{},added:{}},dest=target.added?.[p.canonicalId]??((target.edits??={})[p.canonicalId]??={});
      for(const k of new Set([...Object.keys(old),...Object.keys(next)]))if(!coordinate.has(k)&&JSON.stringify(old[k])!==JSON.stringify(next[k])){if(next[k]===undefined)delete dest[k];else dest[k]=next[k];if(after.edits?.[p.id])delete after.edits[p.id][k];}
    }
    return after;
  }
  async openView(world,owner){
    const link=this.links[world];
    const scene=link?game.scenes.get(link.scene):owner?.realScene??owner;
    if(!scene)throw Error('The linked map scene is missing. Open Regional map settings to repair it.');
    await scene.view();
  }
  syncPosition(owner,at,ids){
    this.writes=this.writes.catch(()=>{}).then(()=>this.syncPositionNow(owner,at,ids));return this.writes;
  }
  async syncPositionNow(owner,at,ids){
    if(!isPrimaryGM()||!owner||!at)return;
    const root=owner.getFlag(ID,'world'),links=Object.values(this.links).filter(l=>l.parent===root&&this.indexes[l.world]);
    if(!links.length||!this.indexes[root])return;
    const network=compileRegions({...this.indexes[root],id:root},links.map(link=>({link,data:this.indexes[link.world]})));
    if(!isPrimaryGM())return;
    const rootTokens=Array.from(owner.tokens??[]).filter(t=>t.actor?.type==='group'&&(ids?ids.includes(t.id):!owner.partyId||t.actor.id===owner.partyId));
    for(const r of network.regions){
      const scene=game.scenes.get(r.scene);if(!scene)continue;
      const inside=network.owner(at)===r&&r.hasArtwork(at),frame=this.frame(scene);if(!frame)continue;
      const ll=r.projection.toLonLat(...r.toRegion(at)),c=latLonToScene(frame,ll[1],ll[0]);
      for(const token of rootTokens){
        const existing=Array.from(scene.tokens??[]).find(t=>t.getFlag(ID,'regionalProxy')===`${owner.id}:${token.id}`);
        if(!inside){if(existing)await scene.deleteEmbeddedDocuments('Token',[existing.id],{kgRealmsTravel:true});continue;}
        const size=scene.grid.size,position={x:c.x-token.width*size/2,y:c.y-token.height*size/2};
        if(existing){if(Math.hypot(existing.x-position.x,existing.y-position.y)>2)await scene.updateEmbeddedDocuments('Token',[{_id:existing.id,...position}],{kgRealmsTravel:true});}
        else{const data=token.toObject();delete data._id;await scene.createEmbeddedDocuments('Token',[{...data,...position,flags:{...data.flags,[ID]:{...data.flags?.[ID],regionalProxy:`${owner.id}:${token.id}`}}}],{kgRealmsTravel:true});}
      }
    }
  }
  async manage(scene){
    const world=scene?.getFlag(ID,'world');if(this.links[world])return this.configure(scene);
    const candidates=Array.from(game.scenes).filter(s=>s.getFlag(ID,'world')&&s.getFlag(ID,'world')!==world&&(!this.links[s.getFlag(ID,'world')]||this.links[s.getFlag(ID,'world')].parent===world));
    if(!candidates.length)return ui.notifications.info('Add the detailed picture as a Foundry scene, then right-click it and choose Make regional map. Its rectangle will be placed on this realm after tile creation.');
    const id=await foundry.applications.api.DialogV2.wait({window:{title:'Regional maps'},rejectClose:false,content:`<p>Choose a detailed map to link or adjust. New pictures can be converted with Make regional map in the scene directory.</p><div class="form-group"><label>Detailed map</label><select name="scene">${candidates.map(s=>`<option value="${s.id}">${esc(s.name)}${this.links[s.getFlag(ID,'world')]?' (linked)':''}</option>`).join('')}</select></div>`,buttons:[{action:'edit',label:'Configure regional map',callback:(_e,b)=>b.form.elements.scene.value},{action:'cancel',label:'Cancel',callback:()=>null}]});
    if(id)return this.configure(game.scenes.get(id));
  }
  async configure(scene){
    if(!isPrimaryGM())throw Error('The primary GM configures regional maps.');
    const world=scene.getFlag(ID,'world'),existing=this.links[world];
    if(!existing&&(scene.getFlag(ID,'journey')?.trip||Object.values(scene.getFlag(ID,'partyJourneys')??{}).some(j=>j.trip)))throw Error("Clear the detailed map's independent journey before linking it to a realm.");
    const parents=Array.from(game.scenes).filter(s=>s.id!==scene.id&&s.getFlag(ID,'world')!==world&&s.getFlag(ID,'world')&&!this.links[s.getFlag(ID,'world')]);
    if(!parents.length)throw Error('Create a parent realm scene first.');
    if(Object.values(this.links).some(l=>l.parent===world))throw Error('A map with regional children cannot itself become a region.');
    const choice=await foundry.applications.api.DialogV2.wait({window:{title:'Place regional map'},rejectClose:false,content:`<p>Select the parent realm, then place a rectangle with this detailed picture's aspect ratio. Drag to position it and Alt + mouse wheel to resize. Four corners align automatically. Regional miles are unchanged.</p><div class="form-group"><label>Parent realm</label><select name="parent">${parents.map(s=>`<option value="${s.id}" ${s.id===existing?.parentScene?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div>`,buttons:[{action:'place',label:'Place rectangle on realm',callback:(_e,b)=>b.form.elements.parent.value},{action:'advanced',label:'Advanced three-landmark alignment',callback:()=> 'advanced'},{action:'cancel',label:'Cancel',callback:()=>null}]});
    if(!choice)return;if(choice==='advanced')return this.configureAdvanced(scene);
    const parentScene=game.scenes.get(choice),parent=parentScene.getFlag(ID,'world'),revision=JSON.stringify(this.links);
    await this.prepare(parent);await this.load(world);
    let placement;try{placement=await placeRegionalRectangle({parentScene,parentSheet:this.indexes[parent].sourceMap,regionalSheet:this.indexes[world].sourceMap,existing:existing?.parent===parent?existing:null,getLayer:this.getLayer,onStart:this.onPlacementStart});}finally{this.onPlacementEnd?.();}
    if(!placement)return;
    const link={...existing,world,parent,parentScene:parentScene.id,scene:scene.id,title:scene.name,...placement,publish:existing?.publish??[]};
    link.entrances=regionalEntrances(await this.getRoutes(parent,this.indexes[parent]),link,this.indexes[parent].sourceMap,this.indexes[world].sourceMap);
    const all=clone(this.links);all[world]=link;
    compileRegions({...this.indexes[parent],id:parent},Object.values(all).filter(l=>l.parent===parent).map(l=>({link:l,data:this.indexes[l.world]})));
    if(!isPrimaryGM()||JSON.stringify(this.links)!==revision)throw Error('Regional settings changed. Reopen placement before saving.');
    await game.settings.set(ID,KEY,all);this.entryPoints[world]=link.entrances;
    ui.notifications.info(`Regional map placed with ${link.entrances.length} road/trail crossings. Open its map and draw roads to the named crossing markers.`);
  }
  async configureAdvanced(scene){
    if(!isPrimaryGM())throw Error('The primary GM configures regional maps.');
    const world=scene.getFlag(ID,'world'),existing=this.links[world];
    if(!existing&&(scene.getFlag(ID,'journey')?.trip||Object.values(scene.getFlag(ID,'partyJourneys')??{}).some(j=>j.trip)))throw Error("Finish or clear this map's independent journeys before linking it to a parent.");
    const parents=Array.from(game.scenes).filter(s=>s.id!==scene.id&&s.getFlag(ID,'world')&&!this.links[s.getFlag(ID,'world')]&&s.getFlag(ID,'world')!==world);
    if(!parents.length)throw Error('Create a parent realm scene first. Use Make realm world on the detailed picture, then link it here.');
    const choice=await foundry.applications.api.DialogV2.wait({window:{title:'Regional map: parent realm'},rejectClose:false,content:`<p>Link this detailed map beneath a realm. Its own width in miles controls travel inside the linked outline.</p><div class="form-group"><label>Parent realm scene</label><select name="parent">${parents.map(s=>`<option value="${s.id}" ${existing?.parentScene===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div>`,buttons:[{action:'next',label:'Choose coverage and alignment',callback:(_e,b)=>b.form.elements.parent.value},{action:'cancel',label:'Cancel',callback:()=>null}]});
    if(!choice||choice==='cancel')return;const parentScene=game.scenes.get(choice),parent=parentScene.getFlag(ID,'world');
    if(Object.values(this.links).some(l=>l.parent===world))throw Error('A map with regional children cannot itself become a region.');
    await this.prepare(parent);await this.load(world);
    const areas=this.rawPlaces(parent,this.indexes[parent].places).filter(p=>p.area?.length>=3&&p.areaClosed!==false);
    if(existing?.footprint&&!areas.some(a=>a.id===existing.outline))areas.unshift({id:existing.outline??"regional-rectangle",name:existing.title,area:existing.footprint});
    if(!areas.length)throw Error('On the parent map, open Map editor > Places > Draw regional coverage. Draw and close its outline, then reopen this dialog.');
    const selected=areas.find(p=>p.id===existing?.outline)??areas[0],p=sourceProjection(this.indexes[parent].sourceMap),child=this.indexes[world].sourceMap;
    const defaults=area=>{const pts=area.area.map(q=>p.toSource(...q)),xs=pts.map(q=>q[0]),ys=pts.map(q=>q[1]);return [{parent:[Math.min(...xs),Math.min(...ys)],region:[0,0]},{parent:[Math.max(...xs),Math.min(...ys)],region:[child.width,0]},{parent:[Math.min(...xs),Math.max(...ys)],region:[0,child.height]}];};
    const anchors=existing?.parent===parent?existing.anchors:defaults(selected),raw=this.rawPlaces(world,this.indexes[world].places);
    let draft;const revision=JSON.stringify(this.links);
    do{
      const result=await foundry.applications.api.DialogV2.wait({window:{title:`${scene.name}: regional map`},position:{width:660},rejectClose:false,
        content:`<p>Regional map width: <b>${Math.round(child.width*child.milesPerPixel)} miles</b>. Change this in Realm world settings. The outline does not have to fit the picture exactly. Beyond the picture, regional scale still applies and realm roads and terrain fill the gaps.</p><div class="form-group"><label>Parent outline</label><select name="outline">${areas.map(a=>`<option value="${a.id}" ${a.id===(draft?.outline??selected.id)?'selected':''}>${esc(a.name)}</option>`).join('')}</select></div><p>Fit the picture to the outline to start. For maps with different shapes, match three non-collinear landmarks using image pixel coordinates. Pick on each map, switching scenes as needed.</p><button type="button" data-fit>Fit picture to outline</button><table><thead><tr><th>Landmark</th><th>Parent X / Y</th><th>Regional X / Y</th></tr></thead><tbody>${anchors.map((a,i)=>`<tr><td>${i+1}</td>${['parent','region'].map(side=>`<td><input aria-label="Landmark ${i+1} ${side} X" name="${side}-${i}-0" type="number" step="any" value="${draft?.[`${side}-${i}-0`]??a[side][0]}" style="width:90px"><input aria-label="Landmark ${i+1} ${side} Y" name="${side}-${i}-1" type="number" step="any" value="${draft?.[`${side}-${i}-1`]??a[side][1]}" style="width:90px"><button type="button" data-pick="${side}" data-i="${i}">Pick</button></td>`).join('')}</tr>`).join('')}</tbody></table><p data-pick-status role="status"></p><details><summary>Regional places to show approximately on the realm</summary>${raw.map(q=>`<label style="display:block"><input type="checkbox" name="publish-${esc(q.id)}" ${existing?.publish?.includes(q.id)?'checked':''}> ${esc(q.name)}</label>`).join('')||'<p>No regional-only places yet. Add them with the map editor and return here.</p>'}</details><p>Existing parent POIs inside the outline remain linked. Adjust their regional markers after saving. Journeys remain stored on ${esc(parentScene.name)}.</p>`,
        render:(_e,dialog)=>{
          const el=dialog.element,form=el.querySelector('form');
          el.querySelector('[data-fit]').onclick=()=>{const a=defaults(areas.find(a=>a.id===form.elements.outline.value));a.forEach((v,i)=>['parent','region'].forEach(side=>v[side].forEach((n,j)=>form.elements[`${side}-${i}-${j}`].value=n)));};
          el.querySelectorAll('[data-pick]').forEach(button=>button.onclick=()=>{const side=button.dataset.pick,id=side==='parent'?parent:world;
            if(canvas.scene?.getFlag(ID,'world')!==id)return ui.notifications.warn(`View the ${side==='parent'?parentScene.name:scene.name} scene before picking.`);
            const status=el.querySelector('[data-pick-status]');status.textContent='Click the landmark on the map. Escape cancels.';
            this.cancelPick?.();const handler=e=>{if(e.button!==0||canvas.scene?.getFlag(ID,'world')!==id)return;const rect=canvas.app.view.getBoundingClientRect(),ll=this.getLayer().fromScreen(e.clientX-rect.left,e.clientY-rect.top),projection=sourceProjection(this.indexes[id].sourceMap),xy=projection.toSource(...ll);xy.forEach((n,j)=>form.elements[`${side}-${button.dataset.i}-${j}`].value=Math.round(n*100)/100);status.textContent='Landmark selected.';this.cancelPick();e.preventDefault();e.stopImmediatePropagation();};
            const cancel=e=>{if(e.key==='Escape')this.cancelPick?.();};const off=onCanvas({pointerdown:handler});this.cancelPick=()=>{off();window.removeEventListener('keydown',cancel);this.cancelPick=null;};window.addEventListener('keydown',cancel);
          });
        },close:()=>this.cancelPick?.(),
        buttons:[{action:'save',label:'Save regional map',callback:(_e,b)=>new foundry.applications.ux.FormDataExtended(b.form).object},{action:'cancel',label:'Cancel',callback:()=>null}]});
      if(!result||typeof result!=='object')return;draft=result;
      try{
        const footprint=areas.find(a=>a.id===result.outline).area,link={world,parent,parentScene:parentScene.id,scene:scene.id,title:scene.name,outline:result.outline,footprint:clone(footprint),anchors:[0,1,2].map(i=>Object.fromEntries(['parent','region'].map(side=>[side,[0,1].map(j=>Number(result[`${side}-${i}-${j}`]))]))),publish:raw.filter(q=>result[`publish-${q.id}`]).map(q=>q.id)};
        const all=clone(this.links);all[world]=link;
        const preview=compileRegions({...this.indexes[parent],id:parent},Object.values(all).filter(l=>l.parent===parent).map(l=>({link:l,data:this.indexes[l.world],terrainAt:()=>({})})));
        if(!isPrimaryGM())throw Error('The primary GM changed. Reopen the dialog.');
        if(JSON.stringify(this.links)!==revision)throw Error('Regional links changed while this dialog was open. Cancel and reopen it.');
        await game.settings.set(ID,KEY,all);ui.notifications.info(preview.regions.find(r=>r.world===world)?.uncovered?'Regional map linked. Some coverage extends beyond the picture: regional scale still applies, with realm roads and terrain filling those areas.':'Regional map linked. Review inherited POI positions and trace the regional roads.');return;
      }catch(error){ui.notifications.error(error.message);}
    }while(true);
  }
}
