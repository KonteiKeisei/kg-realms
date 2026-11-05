import {RealmDialog} from "../ui-theme.mjs";
import {ROAD_TYPES,project,distance,validateRoads,joinRoads} from './routing.mjs';
import {onCanvas,RightClick} from '../canvas-input.mjs';
import {shellSection} from '../ui-shell.mjs';
import {isPrimaryGM} from '../authority.mjs';
const ID='kg-realms',empty=()=>({schema:1,revision:0,roads:[]});
const esc=s=>foundry.utils.escapeHTML(String(s??''));
export function canvasPoint(event){const r=canvas.app.view.getBoundingClientRect(),p=canvas.stage.worldTransform.applyInverse({x:event.clientX-r.left,y:event.clientY-r.top});return[p.x,p.y];}
export class SettlementRoadEditor {
  constructor(){this.saving=Promise.resolve();this.active=false;}
  /**
   * Settlement roads, the Roads tab of the Local places editor (ui-local.mjs), which gives it host:
   * the element it draws into (its body and its footer). The tab's state goes to onStatus (for the
   * editing bar); Escape with nothing to cancel calls onLeave (the Local places editor closes).
   */
  open(scene=canvas.scene,{host}={}){
    if(!isPrimaryGM())return ui.notifications.warn('Only the primary GM can edit settlement roads.');
    if(!scene?.getFlag(ID,'localMap')||!host)return;
    if(this.active)return this.mount(host);
    this.scene=scene;this.data=structuredClone(scene.getFlag(ID,'cityRoads')??empty());validateRoads(this.data);this.base=JSON.stringify(scene.getFlag(ID,'cityRoads')??empty());this.history=[];
    this.active=true;this.kind='street';this.selected=null;this.drawing=null;this.joining=false;this.right=new RightClick();
    this.graphics=new PIXI.Graphics();this.graphics.eventMode='none';canvas.interface.addChild(this.graphics);
    this.off=onCanvas({pointerdown:e=>this.down(e),pointermove:e=>this.move(e),pointerup:e=>this.up(e),dblclick:e=>{if(this.drawing){e.stopImmediatePropagation();this.finish();}},contextmenu:e=>{e.preventDefault();}});
    this.key=e=>{if(e.target.closest?.('input,textarea,select,[contenteditable]'))return;if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();if(this.joining){this.joining=false;this.render();}else if(this.drawing){this.drawing=null;this.render();this.paint();}else this.leave();}else if(e.key==='Enter'&&this.drawing){e.preventDefault();e.stopImmediatePropagation();this.finish();}};
    document.addEventListener('keydown',this.key,true);this.mount(host);this.paint();
  }
  /** Draw into a (new) host: the Local places editor redraws its tab area. */
  mount(host){
    if(!host)return;this.el=host;
    if(!host.kgrRoadsWired){host.kgrRoadsWired=true;
      host.addEventListener('click',e=>this.action(e).catch(error=>ui.notifications.error(error.message)));
      host.addEventListener('change',e=>{
        if(e.target.name==='newKind')this.kind=e.target.value;
        const road=this.selectedRoad();if(!road)return;
        if(e.target.name==='roadName'||e.target.name==='roadKind'){this.remember();road[e.target.name==='roadName'?'name':'kind']=e.target.value;this.save();this.paint();}
      });
      host.addEventListener('toggle',e=>{const k=e.target.dataset?.sec;if(k)(this.shut??=new Set())[e.target.open?'delete':'add'](k);},true);
    }
    this.render();
  }
  selectedRoad(){return this.data?.roads.find(r=>r.id===this.selected);}
  remember(){this.history.push(structuredClone(this.data));if(this.history.length>30)this.history.shift();}
  async save(){
    const snapshot=structuredClone(this.data),scene=this.scene;
    this.saving=this.saving.catch(()=>{}).then(async()=>{
      if(!isPrimaryGM())throw Error('The primary GM changed. Reopen the road editor before saving.');
      const live=scene.getFlag(ID,'cityRoads')??empty();
      if(JSON.stringify(live)!==this.base)throw Error('Another GM changed these roads. Export your draft, then reopen the editor before saving.');
      snapshot.revision=(live.revision??0)+1;await scene.setFlag(ID,'cityRoads',snapshot);this.base=JSON.stringify(snapshot);
      this.issue=null;if(this.active&&this.scene===scene)this.render();
    });
    this.saving.catch(e=>{this.issue=e.message;if(this.active)this.render();ui.notifications.error(`KG Realms: ${e.message}`);});return this.saving;
  }
  /** Escape with nothing to cancel: leave editing (the Local places editor closes). */
  leave(){this.onLeave?.();}
  async close({save=true}={}){
    if(!this.active)return;if(save&&this.drawing?.points.length>=2)await this.finish();
    this.active=false;this.off?.();document.removeEventListener('keydown',this.key,true);cancelAnimationFrame(this.frame);this.frame=null;this.graphics?.destroy();this.graphics=null;
    this.el=null;this.drawing=this.drag=null;this.joining=false;this.onClose?.();
  }
  render(){
    if(!this.el||!this.active)return;const selected=this.selectedRoad(),body=this.el.querySelector(':scope > .body'),scroll=body?.scrollTop??0;
    const shut=this.shut??new Set(),units=this.scene.grid.units||'ft',per=(this.scene.grid.distance||5)/(this.scene.grid.size||100);
    const length=r=>{let d=0;for(let i=1;i<r.points.length;i++)d+=distance(r.points[i-1],r.points[i]);d*=per;return d<10?d.toFixed(1):String(Math.round(d));};
    const rows=kind=>this.data.roads.filter(r=>r.kind===kind).map(r=>`<button type="button" data-act="select" data-id="${esc(r.id)}" class="kgr-sh-row ${this.selected===r.id?'on':''}"><span class="kgr-sh-ico"><i class="fa-solid fa-road"></i></span><span class="kgr-sh-main"><b>${esc(r.name)}</b><small>${length(r)} ${esc(units)} · ${r.points.length} points</small></span></button>`).join('');
    const status=this.joining?`Click another road to join it onto ${esc(selected?.name??'this road')}, end to end. It keeps this road's name and category. Escape cancels.`:this.drawing?'Click to add points. Right-click removes the last point. Enter or Finish saves the road; Escape cancels this draft. Right-drag pans the map.':'Select a road, then drag its points. Click a selected line to insert a point. Right-click a point to remove it. Right-drag pans the map.';
    this.el.innerHTML=`<div class="body">
      <div class="row"><select name="newKind" aria-label="New road category">${Object.entries(ROAD_TYPES).map(([v,n])=>`<option value="${v}" ${this.kind===v?'selected':''}>${n}</option>`).join('')}</select><button data-act="draw" class="primary" ${this.drawing?'disabled':''}><i class="fa-solid fa-plus"></i> Draw road</button></div>
      ${this.issue?`<p class="kgr-city-issue" role="alert">${esc(this.issue)}</p>`:''}<p class="hint">${status}</p>
      ${this.drawing?'<button data-act="finish" class="primary">Finish road</button>':''}
      ${selected?`<div class="kgr-sh-inspector"><div class="kgr-sh-eyebrow">Selected road</div><div class="kgr-sh-grid2"><label>Name<input name="roadName" maxlength="200" value="${esc(selected.name)}"></label><label>Category<select name="roadKind">${Object.entries(ROAD_TYPES).map(([v,n])=>`<option value="${v}" ${selected.kind===v?'selected':''}>${n}</option>`).join('')}</select></label></div>
      <div class="row">${this.joining?'<button data-act="join-cancel"><i class="fa-solid fa-xmark"></i> Cancel joining</button>':`<button data-act="join" title="Join another road onto this one, end to end" ${this.data.roads.length>1?'':'disabled'}><i class="fa-solid fa-link"></i> Join road</button>`}<button data-act="delete" class="danger"><i class="fa-solid fa-trash"></i> Delete road</button></div></div>`:''}
      ${Object.entries(ROAD_TYPES).map(([kind,label])=>shellSection(label+'s',rows(kind)||'<p class="hint">None yet.</p>',{count:this.data.roads.filter(r=>r.kind===kind).length,open:!shut.has(kind),key:kind})).join('')}
      <p class="hint">Carriages use avenues and streets. Walking uses every category and avoids alleys where practical. Crossing roads and snapped endpoints connect.</p></div>
      <div class="kgr-sh-foot"><button data-act="undo" ${this.history.length?'':'disabled'}><i class="fa-solid fa-rotate-left"></i> Undo</button><span class="kgr-sh-sp"></span><button data-act="import">Import</button><button data-act="export">Export</button></div>`;
    const nb=this.el.querySelector(':scope > .body');if(nb)nb.scrollTop=scroll;
    this.onStatus?.({mode:'Settlement roads',hint:this.joining?'Click the road to join onto this one.':this.drawing?'Click to add a road point. Enter finishes. Right-drag pans.':'Select a road, drag points, click a selected line to insert a point. Right-drag pans.',esc:this.joining?'cancels joining':this.drawing?'cancels this road':'leaves editing',crosshair:!!(this.drawing||this.joining)});
  }
  paint(){
    const g=this.graphics;if(!g||g.destroyed)return;g.clear();const scale=canvas.stage.scale.x||1;
    for(const road of [...this.data.roads,...(this.drawing?[this.drawing]:[])]){
      const selected=road.id===this.selected||road===this.drawing,color=selected?0xffd583:({avenue:0xe9a84a,street:0xe8c37e,lane:0x79c8b8,alley:0xc994cf}[road.kind]);
      g.lineStyle((selected?4:2)/scale,color,selected ? .95 : .65);
      road.points.forEach((p,i)=>i?g.lineTo(...p):g.moveTo(...p));
      if(road===this.drawing&&this.pointer&&road.points.length)g.lineTo(...this.pointer);
      if(selected)for(const p of road.points)g.beginFill(color).drawCircle(p[0],p[1],5/scale).endFill();
    }
  }
  snap(at,exclude){
    const radius=Math.min(40,12/(canvas.stage.scale.x||1));let best={point:at,distance:radius};
    for(const road of this.data.roads)for(const p of road.points){if(p===exclude)continue;const d=distance(at,p);if(d<best.distance)best={point:[...p],distance:d};}return best.point;
  }
  down(e){
    if(!this.active||this.scene!==canvas.scene)return;
    if(![0,2].includes(e.button))return;const at=canvasPoint(e),radius=10/(canvas.stage.scale.x||1),road=this.selectedRoad();
    // Right button: acts on release, and only if it was a click. A right-drag is left to Foundry, which pans the map.
    if(e.button===2){
      if(this.drawing)return this.right.down(e,()=>{this.drawing?.points.pop();this.paint();});
      const i=road?road.points.findIndex(p=>distance(at,p)<radius):-1;
      const point=i>=0?road.points[i]:null;
      if(point&&road.points.length>2)this.right.down(e,()=>{const k=road.points.indexOf(point);if(k<0||road.points.length<=2)return;this.remember();road.points.splice(k,1);this.save();this.paint();});
      return;
    }
    if(this.joining){
      e.preventDefault();e.stopImmediatePropagation();const other=this.roadAt(at,radius);
      if(!other||other===road)return ui.notifications.info('KG Realms: click another road to join onto this one. Escape cancels.');
      return this.join(other);
    }
    if(this.drawing){e.preventDefault();e.stopImmediatePropagation();if(e.detail>1)return;const p=this.snap(at);if(!this.drawing.points.length||distance(p,this.drawing.points.at(-1))>.1)this.drawing.points.push(p);this.paint();return;}
    let vertex=road?.points.findIndex(p=>distance(at,p)<radius)??-1;
    if(vertex>=0){e.preventDefault();e.stopImmediatePropagation();this.remember();this.drag={road,index:vertex,at,moved:false};return;}
    let hit;
    for(const r of this.data.roads)for(let i=1;i<r.points.length;i++){const q=project(at,r.points[i-1],r.points[i]);if(q.distance<radius&&(!hit||q.distance<hit.distance))hit={...q,road:r,index:i};}
    if(!hit)return;e.preventDefault();e.stopImmediatePropagation();
    if(this.selected===hit.road.id){this.remember();hit.road.points.splice(hit.index,0,hit.point);this.drag={road:hit.road,index:hit.index,at,moved:true};}else this.selected=hit.road.id;
    this.render();this.paint();
  }
  move(e){
    if(!this.active||(!this.drag&&!this.drawing))return;
    if(!this.drag&&e.target!==canvas.app.view)return;
    this.pointer=canvasPoint(e);if(this.drag){this.drag.moved ||= distance(this.pointer,this.drag.at)>.5;this.drag.road.points[this.drag.index]=this.pointer;}
    e.stopImmediatePropagation();if(this.frame==null)this.frame=requestAnimationFrame(()=>{this.frame=null;this.paint();});
  }
  /** The road nearest a canvas point, within a radius, else null. */
  roadAt(at,radius){
    let hit=null;
    for(const r of this.data.roads)for(let i=1;i<r.points.length;i++){const q=project(at,r.points[i-1],r.points[i]);if(q.distance<radius&&(!hit||q.distance<hit.distance))hit={distance:q.distance,road:r};}
    return hit?.road??null;
  }
  /** Join another road onto the selected one, end to end: one road, keeping the selected one's name and category. */
  async join(other){
    const road=this.selectedRoad();if(!road||!other||other===road)return;
    const j=joinRoads(road.points,other.points),units=this.scene.grid.units||'ft',gap=j.gap*(this.scene.grid.distance||5)/(this.scene.grid.size||100);
    const content=`<p>Join <b>${esc(other.name)}</b> onto <b>${esc(road.name)}</b>?</p><p>${j.gap<1?'Their ends meet.':`Their nearest ends are ${gap<10?gap.toFixed(1):Math.round(gap)} ${esc(units)} apart; a straight piece will link them.`} The joined road keeps the name ${esc(road.name)} and its category.</p>`;
    const yes=await RealmDialog.confirm({window:{title:'Join roads'},content,rejectClose:false});
    this.joining=false;
    if(!yes||!this.active)return this.render();
    this.remember();road.points=j.points;this.data.roads=this.data.roads.filter(r=>r!==other);
    this.render();this.paint();await this.save();
    ui.notifications.info(`KG Realms: joined into one road, ${road.name}.`);
  }
  up(e){if(e.button===2){if(this.right.up(e))e.stopImmediatePropagation();return;}if(!this.drag||e.button!==0)return;e.stopImmediatePropagation();const drag=this.drag;this.drag=null;if(drag.moved){drag.road.points[drag.index]=this.snap(canvasPoint(e),drag.road.points[drag.index]);this.save();}else this.history.pop();this.paint();}
  async finish(){if(!this.drawing)return;if(this.drawing.points.length<2)return ui.notifications.warn('A road needs at least two points.');this.remember();this.selected=this.drawing.id;this.data.roads.push(this.drawing);this.drawing=null;this.pointer=null;this.render();this.paint();await this.save();}
  async action(e){
    const button=e.target.closest('[data-act]'),act=button?.dataset.act;if(!act)return;
    // Any other action leaves joining.
    if(!['join','join-cancel','close'].includes(act))this.joining=false;

    if(act==='draw'){this.drawing={id:foundry.utils.randomID(),name:`New ${ROAD_TYPES[this.kind].toLowerCase()}`,kind:this.kind,points:[]};this.selected=null;this.render();return;}
    if(act==='finish')return this.finish();
    if(act==='join'){if(this.selectedRoad()){this.joining=true;this.render();}return;}
    if(act==='join-cancel'){this.joining=false;return this.render();}
    if(act==='select'){this.selected=button.dataset.id;this.render();this.paint();const p=this.selectedRoad()?.points[0];if(p)canvas.animatePan({x:p[0],y:p[1],duration:400});return;}
    if(act==='delete'){const road=this.selectedRoad();if(!road)return;const yes=await RealmDialog.confirm({window:{title:'Delete road'},content:`<p>Delete ${esc(road.name)}?</p>`,rejectClose:false});if(!yes)return;this.remember();this.data.roads=this.data.roads.filter(r=>r!==road);this.selected=null;this.render();this.paint();return this.save();}
    if(act==='undo'){if(!this.history.length)return;this.data=this.history.pop();this.selected=null;this.render();this.paint();return this.save();}
    if(act==='export'){await this.saving.catch(()=>{});return foundry.utils.saveDataToFile(JSON.stringify({type:'kg-realms-settlement-roads',scene:this.scene.name,width:this.scene.width,height:this.scene.height,grid:{size:this.scene.grid.size,distance:this.scene.grid.distance,units:this.scene.grid.units},...this.data},null,1),'application/json',`${this.scene.name}-roads.json`);}
    if(act==='import'){
      const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.onchange=async()=>{try{const data=JSON.parse(await input.files[0].text());validateRoads(data);if(data.type!=='kg-realms-settlement-roads'||data.width!==this.scene.width||data.height!==this.scene.height)throw Error('This export belongs to a map with different dimensions.');const yes=await RealmDialog.confirm({window:{title:'Import settlement roads'},content:`<p>Merge ${data.roads.length} roads by ID? Existing roads with matching IDs will be replaced.</p>`,rejectClose:false});if(!yes)return;this.remember();const merged=new Map(this.data.roads.map(r=>[r.id,r]));for(const r of data.roads)merged.set(r.id,r);this.data.roads=[...merged.values()];this.render();this.paint();await this.save();}catch(error){ui.notifications.error(error.message);}};input.click();
    }
  }
}
