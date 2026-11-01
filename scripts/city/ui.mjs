import {tripActive} from './transit.mjs';
import {CityFleet} from './fleet.mjs';
import {selectedParty,sceneParties,groupMembers,familyActors,rosterStamp} from '../party-groups.mjs';
import {CityRideView} from './ride-view.mjs';
import {CityHud,JOURNEY_COLOURS} from './hud.mjs';
import {SettlementRoadEditor,canvasPoint} from './road-editor.mjs';
import {coinLabel} from './money.mjs';
import {cityDuration} from './routing.mjs';
import {isPrimaryGM} from '../authority.mjs';
import {onCanvas,RightClick} from '../canvas-input.mjs';
import {editBar} from '../ui-editbar.mjs';
import {registerPanelPlace} from './panel-place.mjs';
const ID='kg-realms',esc=s=>foundry.utils.escapeHTML(String(s??''));
// Planning a trip, in the city HUD (city/hud.mjs): where to, which way, on foot or by coach, and who
// goes. Members left unticked split off on Set off as a party of their own, which stays put.
export class SettlementTravelUI {
  constructor({localMaps}={}){this.localMaps=localMaps;this.fleet=new CityFleet(()=>{this.hud.render();this.paint();});this.fleet.onTick=()=>this.hud.tick();this.editor=new SettlementRoadEditor();this.hud=new CityHud(this);}
  get controller(){const scene=this.scene??canvas.scene,id=this.partyId??((canvas.tokens?.controlled??[]).filter(t=>t.actor?.type==='group').length===1?canvas.tokens.controlled.find(t=>t.actor?.type==='group').actor.id:sceneParties(scene)[0]?.actor.id);return this.fleet.worker(id??'__idle__');}
  /** A journey's ride view, drawn in the HUD. */
  rideView(worker,hud){return new CityRideView(worker,hud);}

  install(){
    registerPanelPlace();
    this.fleet.install();
    this.hud.install();
    Hooks.on('updateActor',()=>{if(this.el)this.render();});
    Hooks.on('getSceneControlButtons',controls=>{
      if(!game.user.isGM||!canvas.scene?.getFlag(ID,'localMap')||!controls.notes)return;
      controls.notes.tools.kgRealmsCityRoads={name:'kgRealmsCityRoads',title:'Settlement roads (avenue, street, lane, alley)',icon:'fa-solid fa-road',order:102,button:true,onChange:()=>this.openRoads()};
      controls.notes.tools.kgRealmsCityTravel={name:'kgRealmsCityTravel',title:'Plan a trip in this settlement',icon:'fa-solid fa-horse',order:103,button:true,onChange:()=>this.open()};
    });
    Hooks.on('canvasTearDown',()=>{this.close();this.editor.close({save:false});this.graphics?.destroy();this.graphics=null;});
    Hooks.on('canvasReady',()=>this.paint());
    Hooks.on('canvasPan',()=>{if(this.frame!=null)return;this.frame=requestAnimationFrame(()=>{this.frame=null;this.paint();this.editor.paint();});});
    Hooks.on('updateScene',(scene,changes)=>{if(scene.id!==this.scene?.id)return;if(changes.flags?.[ID]?.cityRoads||Object.keys(changes).some(k=>k.startsWith(`flags.${ID}.cityRoads`)))this.render();});
    Hooks.on('updateToken',(token,changes)=>{if(token.parent?.id===this.scene?.id&&('x'in changes||'y'in changes)&&!tripActive(this.controller.ride))this.render();});
    Hooks.on('updateSetting',setting=>{if([`${ID}.priceScale`,`${ID}.cityWalkMph`,`${ID}.cityCarriageMph`].includes(setting.key))this.render();});
  }
  dock(){this.hud.dock();}
  /** Settlement roads: the Roads tab of the Local places editor. */
  openRoads(){this.close();this.localMaps?.editor.open({tab:'roads'});}
  async open(scene=canvas.scene,target=null,{party=null}={}){
    if(!isPrimaryGM())return ui.notifications.warn('The primary GM chooses the party destination and begins settlement travel.');
    if(!scene?.getFlag(ID,'localMap'))return;
    let selected;try{selected=party?sceneParties(scene).find(t=>t.actor.id===party)??selectedParty(scene):selectedParty(scene);}catch(error){return ui.notifications.warn(error.message);}
    if(!selected)return ui.notifications.warn('Select a group actor party token first.');
    this.partyId=selected.actor.id;
    if(tripActive(this.controller.ride)){this.hud.focus=this.partyId;this.hud.render();return;}
    if(this.el&&this.scene===scene&&!target)return this.close();
    await this.editor.close();await this.localMaps?.editor.close();if(canvas.scene?.id!==scene.id)await scene.view();
    if(!this.hud.el)this.hud.show();
    this.close();this.scene=scene;this.target=target;this.waive=false;this.mode=null;
    // Who goes: every member, until unticked; the party left behind is named here.
    this.going=new Set(groupMembers(selected.actor).map(a=>a.id));this.splitName='';
    if(game.settings.get(ID,'cityHudMin'))await game.settings.set(ID,'cityHudMin',false);
    this.el=this.hud.slot('body');this.foot=this.hud.slot('foot');
    // Esc: finish editing the route, else back to the HUD.
    this.menuKey=e=>{if(e.key!=='Escape'||e.target.closest?.('input,textarea,select'))return;e.preventDefault();e.stopImmediatePropagation();if(this.routeEditing){this.routeEditing=false;this.render();}else this.close();};document.addEventListener('keydown',this.menuKey,true);
    for(const part of [this.el,this.foot])part.addEventListener('click',e=>this.action(e).catch(error=>{ui.notifications.error(error.message);this.render();}));
    this.el.addEventListener('change',e=>{if(e.target.name==='waive'){this.waive=e.target.checked;this.render();}if(e.target.name==='member'){e.target.checked?this.going.add(e.target.value):this.going.delete(e.target.value);this.render();}});
    // The search box and the left-behind party's name: kept as typed, without redrawing the panel.
    this.el.addEventListener('input',e=>{if(e.target.matches('[data-place-search]')){this.search=e.target.value;this.showMatches();}if(e.target.name==='split-name')this.splitName=e.target.value;});
    this.el.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.matches('[data-place-search]')){const first=this.el.querySelector('[data-act="choose"]');if(first){e.preventDefault();first.click();}}});
    this.el.addEventListener('pointerover',e=>{const act=e.target.closest('[data-act]')?.dataset.act;if(act==='walk'||act==='coach'){this.preview=act==='walk'?this.walkPreview:this.coachPreview;this.paint();}});
    this.el.addEventListener('pointerleave',()=>{this.preview=this.chosen();this.paint();});
    this.hud.render();this.render();
  }
  /** The way chosen: on foot or by coach (by coach when there is one, until the GM picks). */
  chosen(){const coach=this.coachPreview?.plan.boardingCount?this.coachPreview:null;return this.mode==='walk'?this.walkPreview:this.mode==='coach'?coach??this.walkPreview:coach??this.walkPreview;}
  render(){
    if(!this.el||this.picking)return;const scene=this.scene;if(!scene||scene!==canvas.scene)return this.close();
    if(tripActive(this.controller.ride))return this.close();
    const all=this.controller.members(scene),members=all.filter(a=>this.going.has(a.id)),staying=all.filter(a=>!this.going.has(a.id));
    const notes=Array.from(scene.notes??[]).map(n=>({note:n,rec:n.getFlag(ID,'local')})).filter(x=>x.rec).sort((a,b)=>a.rec.name.localeCompare(b.rec.name));
    this.preview=this.walkPreview=this.coachPreview=null;let issue='';
    if(this.target)try{this.walkPreview=this.controller.preview(scene,this.target,'walk');this.coachPreview=this.controller.preview(scene,this.target,'mixed');}catch(e){issue=e.message;}
    const p=this.coachPreview,coaches=p?.plan.boardingCount??0,byCoach=coaches&&this.mode!=='walk',total=p&&!this.waive?coaches*p.perRider*members.length:0;
    this.preview=this.chosen();
    const party=sceneParties(scene).find(t=>t.actor.id===this.partyId);
    let from='';try{const o=this.controller.origin(scene);from=this.hud.streetAt?.(o)??'';}catch{}
    this.hud.head({icon:'fa-route',eyebrow:from?`Plan a trip / from ${from}`:'Plan a trip',title:party?.name??'Party'});
    this.notes=notes;
    const via=this.target?.via??[];
    const route=this.target&&!issue?`<div class="kgr-city-route"><span>${via.length?`Route through ${via.length} point${via.length===1?'':'s'}`:'Shortest route'}</span>${via.length&&!this.routeEditing?'<button data-act="reset-route" title="Back to the shortest route">Reset</button>':''}<button data-act="edit-route" class="${this.routeEditing?'on':''}" aria-pressed="${!!this.routeEditing}"><i class="fa-solid fa-route"></i> ${this.routeEditing?'Done':'Edit route'}</button></div>${this.routeEditing?'<p class="hint">Click the roads to send the party that way. Drag a point to move it; right-click a point to remove it. Esc when done.</p>':''}`:'';
    const who=all.length>1?`<div class="kgr-city-who"><div class="kgr-city-who-head">Who goes <small>${members.length} of ${all.length}</small></div><div class="kgr-city-members">${all.map(a=>`<label class="${this.going.has(a.id)?'':'off'}"><input type="checkbox" name="member" value="${esc(a.id)}" ${this.going.has(a.id)?'checked':''}><img src="${esc(a.img)}" alt=""><span>${esc(a.name)}</span></label>`).join('')}</div>${staying.length?`<div class="kgr-city-split"><div><i class="fa-solid fa-people-arrows"></i> ${esc(listNames(staying))} ${staying.length===1?'stays':'stay'} here as a new party:<span class="kgr-rule" data-tooltip="On Set off, the unticked members leave this party for a new party token beside it. They do not travel or pay a fare. The travelling party keeps its name. Join them up again with the party tools.">?</span></div><label class="kgr-city-split-name"><input type="text" name="split-name" value="${esc(this.splitName||listNames(staying))}" aria-label="Name of the party that stays"><i class="fa-solid fa-pen" aria-hidden="true"></i></label><small>${esc(party?.name??'The party')} keeps its name.</small></div>`:''}</div>`:'';
    this.el.innerHTML=!this.target?`<p class="kgr-city-choose"><i class="fa-solid fa-location-crosshairs"></i> Click a place on the map, or anywhere along the roads.</p><label class="kgr-sh-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input type="search" data-place-search placeholder="Or find a place by name" aria-label="Find a place by name" value="${esc(this.search??'')}"></label><div class="kgr-city-matches" data-matches></div><p class="hint">Starting from the party's current location.</p>`:
      `<div class="kgr-city-destination"><strong>${esc(this.preview?.destination.name??(this.target.note?notes.find(n=>n.note.id===this.target.note)?.rec.name:'Selected map point'))}</strong><button data-act="change">Change</button></div>
      ${issue?`<p class="kgr-city-issue" role="status">${esc(issue)}${via.length?' <button data-act="reset-route">Reset route</button>':''}</p>`:''}${route}
      <div class="kgr-city-methods"><button data-act="walk" class="${!byCoach?'on':''}" aria-pressed="${!byCoach}" ${!this.walkPreview?'disabled':''}><strong><i class="fa-solid fa-person-walking"></i> On foot</strong><small>${this.walkPreview?cityDuration(this.walkPreview.plan.seconds):'No route'}</small><small>Free</small></button><button data-act="coach" class="${byCoach?'on':''}" aria-pressed="${!!byCoach}" ${!coaches?'disabled':''}><strong><i class="fa-solid fa-horse"></i> By coach<span class="kgr-rule" data-tooltip="Base 5 sp per rider, adjusted by the economy setting. Walking connections are included. Each carriage ride has its own fare.">?</span></strong><small>${coaches?cityDuration(p.plan.seconds):'No coach route'}</small><small>${coaches?(this.waive?'Fare waived':`${coinLabel(p.perRider)} each`):''}</small></button></div>
      ${who}
      ${byCoach?`<p class="kgr-city-fare hint">${members.length} riders / <strong>${coinLabel(total)} total</strong>${coaches>1?` / ${coaches} carriage rides`:''} <label class="kgr-city-waive"><input type="checkbox" name="waive" ${this.waive?'checked':''}> Waive fare</label></p>`:''}
      ${!all.length?'<p class="kgr-city-issue">No party characters assigned.</p>':!members.length?'<p class="kgr-city-issue">Tick at least one member to set off.</p>':''}`;
    this.foot.hidden=false;
    this.foot.innerHTML=`<button type="button" data-act="close"><i class="fa-solid fa-arrow-left"></i> Back</button><span class="kgr-sh-sp"></span>${this.target?`<button type="button" class="main" data-act="set-off" ${!this.preview||issue||!members.length?'disabled':''}><i class="fa-solid fa-play"></i> ${staying.length?`Set off with ${members.length}`:'Set off'}</button>`:''}`;
    if(!this.target)this.showMatches();
    this.arm();this.paint();
  }
  /** The places whose names match the search box (up to eight). */
  showMatches(){
    const box=this.el?.querySelector('[data-matches]');if(!box)return;const q=(this.search??'').trim().toLowerCase();
    const list=q?(this.notes??[]).filter(({rec})=>rec.name.toLowerCase().includes(q)).slice(0,8):[];
    box.innerHTML=list.map(({note:n,rec})=>`<button type="button" data-act="choose" data-note="${esc(n.id)}" class="kgr-sh-row"><span class="kgr-sh-main"><b>${esc(rec.name)}</b></span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>`).join('')||(q?'<p class="hint">No place by that name.</p>':'');
  }
  /** The place marker under a canvas point, if any. */
  noteAt([x,y]){
    const scale=Number(this.scene?.getFlag(ID,'localMap')?.markerScale)||1,zoom=canvas.stage.scale.x||1;let best=null;
    for(const {note:n} of this.notes??[]){const r=Math.max((n.iconSize??64)*scale/2,24/zoom),d=Math.hypot(n.x-x,n.y-y);if(d<=r&&(!best||d<best.d))best={n,d};}
    return best?.n??null;
  }
  /**
   * The map clicks this panel takes: choosing the destination (no destination yet), or editing the
   * route (route points: click the roads to add one, drag one to move it, right-click one to remove it).
   */
  arm(){
    const want=this.el&&(!this.target||this.routeEditing)?(this.target?'route':'choose'):null;
    if(want===this.armed)return;this.offPick?.();this.offPick=null;this.armed=want;
    const view=canvas.app?.view;if(view){if(want&&this.previousCursor===undefined)this.previousCursor=view.style.cursor;view.style.cursor=want?'crosshair':this.previousCursor??'';if(!want)this.previousCursor=undefined;}
    if(!want)return;
    const stop=e=>{e.preventDefault();e.stopImmediatePropagation();};
    if(want==='choose'){this.offPick=onCanvas({pointerdown:e=>{if(e.button!==0)return;stop(e);const at=canvasPoint(e),n=this.noteAt(at);this.target=n?{note:n.id}:{x:at[0],y:at[1]};this.render();}});return;}
    const right=new RightClick(),hit=at=>{const zoom=canvas.stage.scale.x||1;return(this.target.via??[]).findIndex(p=>Math.hypot(p[0]-at[0],p[1]-at[1])<=14/zoom);};
    this.offPick=onCanvas({
      pointerdown:e=>{const at=canvasPoint(e),i=hit(at);
        if(e.button===2){if(i>=0)right.down(e,()=>{this.target={...this.target,via:this.target.via.filter((_,k)=>k!==i)};this.render();});return;}
        if(e.button!==0)return;stop(e);
        if(i>=0){this.dragVia={i,moved:false};return;}
        const p=this.controller.snapToRoad?.(this.scene,at)??at,via=[...(this.target.via??[])];via.splice(this.insertAt(via,p),0,p);this.target={...this.target,via};this.render();},
      pointermove:e=>{if(!this.dragVia)return;stop(e);const via=[...this.target.via];via[this.dragVia.i]=canvasPoint(e);this.dragVia.moved=true;this.target={...this.target,via};this.paint();},
      pointerup:e=>{if(e.button===2){right.up(e);return;}if(!this.dragVia)return;stop(e);const {i,moved}=this.dragVia;this.dragVia=null;if(!moved)return;const via=[...this.target.via];via[i]=this.controller.snapToRoad?.(this.scene,via[i])??via[i];this.target={...this.target,via};this.render();},
      contextmenu:e=>{if(hit(canvasPoint(e))>=0)e.preventDefault();}
    });
  }
  /** Where a new route point goes among the others: where it lengthens the way the least. */
  insertAt(via,p){
    let from;try{from=this.controller.origin(this.scene);}catch{return via.length;}
    const end=this.preview?.plan.end??p,stops=[from,...via,end],d=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);let best=0,cost=Infinity;
    for(let i=0;i<stops.length-1;i++){const c=d(stops[i],p)+d(p,stops[i+1])-d(stops[i],stops[i+1]);if(c<cost){cost=c;best=i;}}
    return best;
  }
  paint(){
    if(!canvas.ready||!canvas.interface)return;
    const journeys=this.fleet.active().filter(([,r])=>r.scene===canvas.scene?.id),focus=journeys.length===1?journeys[0][0]:this.hud.focus;
    const planning=this.el&&!this.picking?this.preview?.plan:null;
    if(!journeys.length&&!planning){this.graphics?.clear();return;}
    if(!this.graphics||this.graphics.destroyed){this.graphics=new PIXI.Graphics();this.graphics.eventMode='none';canvas.interface.addChild(this.graphics);}
    const g=this.graphics,scale=canvas.stage.scale.x||1;g.clear();
    const line=(plan,colour,bright)=>{for(const leg of plan.legs){const c=colour??(leg.mode==='carriage'?0xe9bf6a:0x76cbbb);g.lineStyle((bright?7:5)/scale,c,bright?.14:.06);leg.points.forEach((p,i)=>i?g.lineTo(...p):g.moveTo(...p));g.lineStyle((bright?2.5:1.8)/scale,c,bright?.9:.4);leg.points.forEach((p,i)=>i?g.lineTo(...p):g.moveTo(...p));}g.lineStyle(2/scale,0xffffff,bright?.9:.4).beginFill(colour??0xe9bf6a,bright?1:.5).drawCircle(plan.end[0],plan.end[1],6/scale).endFill();};
    // A journey's colour (city/hud.mjs JOURNEY_COLOURS) when several travel at once; the one in focus drawn bright.
    journeys.forEach(([id,r],i)=>{if(!planning)line(r.plan,journeys.length>1?JOURNEY_COLOURS[i%JOURNEY_COLOURS.length]:null,journeys.length===1||focus===id||focus==='all'||!focus);});
    if(planning)line(planning,null,true);
    // The route points the GM set, numbered in order (while the route is being planned).
    const via=planning?this.target?.via??[]:[];
    via.forEach(p=>{g.lineStyle(2/scale,0x1b1f24,.95).beginFill(this.routeEditing?0xffffff:0xe9bf6a).drawCircle(p[0],p[1],(this.routeEditing?8:6)/scale).endFill();});
    this.labels??=[];for(const l of this.labels)l.destroy();this.labels=[];
    if(this.routeEditing)via.forEach((p,i)=>{const t=new PIXI.Text(String(i+1),{fontSize:11,fontWeight:'700',fill:0x1b1f24});t.anchor.set(.5);t.scale.set(1/scale);t.position.set(p[0],p[1]);g.addChild(t);this.labels.push(t);});
  }
  async action(e){const act=e.target.closest('[data-act]')?.dataset.act;if(!act)return;
    if(act==='close')return this.close();if(act==='roads')return this.openRoads();
    if(act==='change'){this.target=null;this.routeEditing=false;this.render();return;}
    if(act==='choose'){this.target={note:e.target.closest('[data-note]').dataset.note};this.search='';this.render();return;}
    if(act==='edit-route'){this.routeEditing=!this.routeEditing;this.render();return;}
    if(act==='reset-route'){this.target={...this.target,via:[]};this.routeEditing=false;this.render();return;}
    if(act==='walk'||act==='coach'){this.mode=act;this.render();return;}
    if(act==='set-off')return this.setOff(e.target.closest('button'));
  }
  /**
   * Set off: the unticked members first split off as their own party (party-manager.mjs), which stays
   * here under the name given; the travelling party keeps its own name. Then the trip begins.
   */
  async setOff(button){
    if(button)button.disabled=true;
    const scene=this.scene,controller=this.controller,token=sceneParties(scene).find(t=>t.actor.id===this.partyId);
    const all=controller.members(scene),staying=all.filter(a=>!this.going.has(a.id)),mode=this.mode==='walk'||!this.coachPreview?.plan.boardingCount?'walk':'mixed',target=this.target,waive=this.waive&&mode==='mixed';
    if(staying.length){
      if(!this.partyManager)throw Error('Party splitting is unavailable.');
      const keep=token.name,actorName=token.actor.name,name=(this.splitName||listNames(staying)).trim()||listNames(staying);
      const done=await this.partyManager.commit({scene,left:token,rightIds:staying.map(a=>a.id),stamp:rosterStamp(familyActors(token.actor))});
      // The party manager numbers both parties: the travelling one gets its own name back, the other the name given.
      const renames=[{_id:token.actor.id,name:actorName}];if(done?.actor)renames.push({_id:done.actor.id,name});
      await Actor.updateDocuments(renames);
      const tokens=[{_id:token.id,name:keep}];await scene.updateEmbeddedDocuments('Token',tokens,{kgRealmsParty:true});
      if(done?.token)await scene.updateEmbeddedDocuments('Token',[{_id:done.token.id,name}],{kgRealmsParty:true});
    }
    const preview=controller.preview(scene,target,mode);
    await this.hud.clearAsks?.(target?.note);
    await controller.start(scene,target,{mode,riderIds:controller.members(scene).map(a=>a.id),waive,quote:preview.quote});
    this.hud.focus=this.partyId;this.close();
  }
  close(){this.routeEditing=false;const el=this.el;this.el=null;this.arm();this.el=el;if(this.menuKey)document.removeEventListener('keydown',this.menuKey,true);this.menuKey=null;this.search='';for(const l of this.labels??[])l.destroy();this.labels=[];editBar.hide(this);this.el=null;this.foot=null;this.preview=null;this.graphics?.clear();this.hud.render();this.paint();}
}
/** "Nebura and Ursula", "Haldak, Ria and Cal". */
function listNames(actors){const n=actors.map(a=>a.name);return n.length<2?n.join(''):n.slice(0,-1).join(', ')+' and '+n.at(-1);}
