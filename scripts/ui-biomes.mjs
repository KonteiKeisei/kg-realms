import {RealmDialog} from "./ui-theme.mjs";
import { onCanvas } from "./canvas-input.mjs";
import { nearestOnLine } from "./routes.mjs";
import { BIOME_FIELDS, DEFAULT_BIOMES, biomeTypes, biomeZone, biomeLookup, biomePriority } from "./biomes.mjs";
import { lonLatToSource, sourceToLonLat } from "./source-map.mjs";
import { borderSelect, borderHome } from "./borders.mjs";
const esc=s=>foundry.utils.escapeHTML(String(s??""));
/** Calendaria's climate zones, for a biome to take its weather from; none without Calendaria. */
const climateZones=()=>{const list=game.modules.get("calendaria")?.active?globalThis.CALENDARIA?.api?.getCalendarZones?.()??[]:[];return list.map(z=>[z.id,game.i18n.localize(z.name??z.id)]);};
const climateRow=(scope,value,blank)=>{const zones=climateZones();if(!zones.length)return"";return`<label>Weather <span class="kgr-rule" tabindex="0" data-tooltip="The Calendaria climate zone this biome's weather comes from. A party here gets its weather. Edit the zones under Calendaria's Zone Climate." data-tooltip-class="kgr-rule-tip">?</span><select data-scope="${scope}" data-field="climate">${blank?`<option value="">${esc(blank)}</option>`:""}${zones.map(([id,name])=>`<option value="${esc(id)}" ${id===value?"selected":""}>${esc(name)}</option>`).join("")}</select></label>`;};

export class BiomeEditor {
  constructor(options){Object.assign(this,options);this.active=false;this.undo=[];this.mode="zones";this.newType="plains";}
  all(){return this.getBiomes?.()??{};}
  status(){return{hint:this.tracing?"Tracing the map biome...":this.traceMode?"Click inside the selected biome, or near its boundary.":this.tracePreview?"Review the traced outline. Drag corners to adjust; Enter saves it.":this.draft?"Click to add corners. Enter or double-click closes the biome zone.":this.selected?"Drag a corner, or click an edge to add a corner. Delete removes the selected corner.":"Draw a biome zone or select an existing one. Unzoned land uses the map's terrain.",esc:this.traceMode||this.tracing?"cancels tracing":this.draft?"cancels the zone":this.selected?"deselects the zone":"leaves editing",crosshair:!!(this.draft||this.traceMode)};}
  open(){
    if(this.active||!game.user.isGM||!this.getLayer()?.frame)return;this.active=true;
    this.panel=document.createElement("div");this.panel.className="kgr-tab kgr-biomes-tab";(this.host??document.body).append(this.panel);
    this.panel.addEventListener("click",e=>this.click(e.target.closest("[data-bio]")?.dataset));
    this.panel.addEventListener("change",e=>this.change(e.target));
    this.off=onCanvas({pointerdown:e=>this.down(e),pointermove:e=>this.move(e),pointerup:e=>this.up(e),dblclick:e=>{if(this.draft){this.stop(e);if(this.coords.length>1&&Math.hypot(...this.coords.at(-1).map((v,i)=>v-this.coords.at(-2)[i]))<1e-7)this.coords.pop();this.finish();}}});
    this.key=e=>{if(e.target?.closest?.("input,textarea,select"))return;if(e.key==="Escape"){this.stop(e);if(this.draft||this.selected||this.traceMode||this.tracing)this.select(null);else this.onLeave?.();}else if(e.key==="Enter"&&this.draft){this.stop(e);this.finish();}else if((e.key==="Delete"||e.key==="Backspace")&&this.node!=null){this.stop(e);this.removeNode();}else if(e.code==="KeyZ"&&(e.ctrlKey||e.metaKey)){this.stop(e);this.back();}};
    window.addEventListener("keydown",this.key,true);this.render();this.draw();
  }
  close(){if(!this.active)return;this.active=false;this.cancelTrace();this.off?.();window.removeEventListener("keydown",this.key,true);this.panel?.remove();this.panel=null;this.selected=this.draft=this.drag=this.node=this.hover=null;this.coords=[];this.getLayer()?.setBiomes(null);this.getLayer()?.setRouteEdit(null,null);}
  stop(e){e.preventDefault();e.stopImmediatePropagation();}
  global(e){const r=canvas.app.view.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top];}
  screen(pts=this.coords??[]){return pts.map(p=>this.getLayer().toScreen(...p));}
  select(id){this.cancelTrace();this.selected=id;this.draft=null;this.node=null;this.coords=id?structuredClone(this.all().zones?.[id]?.pts??[]):[];this.draw();this.render();}
  cancelTrace(){this.traceEpoch=(this.traceEpoch??0)+1;this.traceWorker?.terminate();this.traceWorker=null;this.traceMode=this.tracing=this.tracePreview=false;this.traceHoles=[];}
  async traceAt(lonLat){
    if(this.tracing)return;const epoch=this.traceEpoch??0;this.tracing=true;this.render();this.onStatus?.();
    try{
      const grid=await this.getTerrain?.();if(!grid)throw Error("The map's biome grid is not available. Draw this zone manually.");
      if(!this.active||epoch!==(this.traceEpoch??0))return;
      const worker=this.traceWorker=new Worker(foundry.utils.getRoute("modules/kg-realms/scripts/biome-trace-worker.mjs"),{type:"module"});
      const pixels=grid.data.slice(),code=biomeTypes(this.all())[this.newType]?.terrain??1;
      const result=await new Promise((resolve,reject)=>{worker.onmessage=e=>e.data.error?reject(Error(e.data.error)):resolve(e.data.result);worker.onerror=e=>reject(Error(e.message||"Automatic tracing is unavailable. Draw this zone manually."));worker.postMessage({grid:{data:pixels,width:grid.width,height:grid.height,cell:grid.cell},at:lonLatToSource(...lonLat),code},[pixels.buffer]);});
      if(!this.active||epoch!==(this.traceEpoch??0))return;
      this.traceMode=false;this.tracePreview=this.draft=true;this.coords=result.pts.map(p=>sourceToLonLat(...p));this.traceHoles=result.holes.map(r=>r.map(p=>sourceToLonLat(...p)));this.hover=null;
    }catch(error){if(this.active&&epoch===(this.traceEpoch??0))ui.notifications.warn(`KG Realms: ${error.message}`);}
    finally{if(epoch===(this.traceEpoch??0)){this.traceWorker?.terminate();this.traceWorker=null;this.tracing=false;if(this.active){this.draw();this.render();}}}
  }
  async commit(fn){if(!game.user.isGM)return;this.undo.push(structuredClone(this.all()));if(this.undo.length>40)this.undo.shift();await this.saveBiomes(fn);this.draw();this.render();}
  async back(){const before=this.undo.pop();if(before){await this.saveBiomes(()=>before);this.select(null);}}
  down(e){
    if(!this.active||e.button!==0)return;const g=this.global(e),layer=this.getLayer();
    if(this.traceMode){this.stop(e);return this.traceAt(layer.fromScreen(...g));}
    if(this.tracePreview){this.stop(e);const pts=this.screen(),i=pts.findIndex(p=>Math.hypot(p[0]-g[0],p[1]-g[1])<9);if(i>=0){this.drag=this.node=i;return this.draw();}const hit=nearestOnLine([...pts,pts[0]],g);if(hit?.distance<9){this.coords.splice(hit.index+1,0,layer.fromScreen(...hit.point));this.drag=this.node=hit.index+1;return this.draw();}return;}
    if(this.draft){this.stop(e);this.coords.push(layer.fromScreen(...g));return this.draw();}
    if(this.selected&&!this.all().zones?.[this.selected]?.follow){
      const pts=this.screen(),i=pts.findIndex(p=>Math.hypot(p[0]-g[0],p[1]-g[1])<9);
      if(i>=0){this.stop(e);this.drag=this.node=i;return this.draw();}
      const hit=nearestOnLine([...pts,pts[0]],g);if(hit?.distance<9){this.stop(e);this.coords.splice(hit.index+1,0,layer.fromScreen(...hit.point));this.drag=this.node=hit.index+1;return this.draw();}
    }
    const hit=biomeLookup(this.all())(...layer.fromScreen(...g));
    if(hit?.zoneId){this.stop(e);this.select(hit.zoneId);}else this.select(null);
  }
  move(e){if(this.drag!=null){this.stop(e);this.coords[this.drag]=this.getLayer().fromScreen(...this.global(e));this.draw();}else if(this.draft&&!this.tracePreview){this.hover=this.getLayer().fromScreen(...this.global(e));this.draw();}}
  async up(e){if(this.drag==null)return;this.stop(e);this.drag=null;if(this.tracePreview)return this.draw();const pts=structuredClone(this.coords),id=this.selected;await this.commit(c=>({...c,zones:{...c.zones,[id]:{...c.zones[id],pts}}}));}
  async finish(){if(!this.draft)return;if(this.coords.length<3)return ui.notifications.warn("KG Realms: a biome zone needs at least three corners.");const id=`bio-${foundry.utils.randomID()}`,type=this.newType,pts=structuredClone(this.coords),holes=structuredClone(this.traceHoles??[]);this.draft=null;this.hover=null;await this.commit(c=>({...c,zones:{...c.zones,[id]:{name:biomeTypes(c)[type]?.name??"Biome",type,pts,...(holes.length?{holes}:{}),overrides:{}}}}));this.select(id);}
  async removeNode(){if(this.coords.length<=3)return ui.notifications.warn("KG Realms: a biome zone needs at least three corners.");this.coords.splice(this.node,1);this.node=null;if(this.tracePreview)return this.draw();const id=this.selected,pts=structuredClone(this.coords);await this.commit(c=>({...c,zones:{...c.zones,[id]:{...c.zones[id],pts}}}));}
  draw(){
    if(!this.active)return;const config=this.all(),types=biomeTypes(config),zones=Object.entries(config.zones??{}).map(([id,z])=>({...z,id,color:biomeZone({...z,id},types).color}));
    if(this.draft&&this.coords?.length)zones.push({id:"draft",name:this.tracePreview?"Traced biome preview":"New zone",color:types[this.newType]?.color,pts:[...this.coords,...(this.hover?[this.hover]:[])],holes:this.traceHoles??[]});
    else if(this.selected){const z=zones.find(z=>z.id===this.selected);if(z)z.pts=this.coords;}
    this.getLayer()?.setBiomes(zones,this.selected??"draft");
    this.getLayer()?.setRouteEdit(this.draft?[...this.coords,...(this.hover?[this.hover]:[])]:null,config.zones?.[this.selected]?.follow?[]:this.coords??[],this.node);this.onStatus?.();
  }
  fields(values,defaults,scope){return Object.entries(BIOME_FIELDS).map(([k,f])=>`<label>${f.label}<span><input type="number" data-scope="${scope}" data-field="${k}" min="${f.min}" max="${f.max}" step="${f.step}" value="${values[k]??""}" placeholder="${defaults[k]}"><small>${f.unit??""}${scope==="zone"?` · default ${defaults[k]}`:""}</small></span></label>`).join("");}
  render(){
    if(!this.panel)return;const c=this.all(),types=biomeTypes(c),options=selected=>Object.entries(types).map(([k,t])=>`<option value="${esc(k)}" ${k===selected?"selected":""}>${esc(t.name)}</option>`).join("");
    let body="";
    if(this.mode==="types"){
      const id=this.typeId&&types[this.typeId]?this.typeId:"plains",t=types[id];this.typeId=id;
      body=`<label>Biome type<select data-bio="type-select">${options(id)}</select></label><label>Name<input data-scope="type" data-field="name" value="${esc(t.name)}" maxlength="100"></label><label>Base terrain<select data-scope="type" data-field="terrain">${[[1,"Plains"],[2,"Forest"],[3,"Hills"],[4,"Mountains"],[5,"Wetlands"],[6,"Desert"],[7,"Snow and ice"],[9,"Grassland"]].map(([code,label])=>`<option value="${code}" ${code===t.terrain?"selected":""}>${label}</option>`).join("")}</select></label><label>Default overlap priority<input type="number" data-scope="type" data-field="priority" min="${DEFAULT_BIOMES[id]?1:0}" max="1000" value="${t.priority}"></label><label>Zone color<input type="color" data-scope="type" data-field="color" value="${t.color}"></label>${climateRow("type",t.climate)}<div class="bio-fields">${this.fields(t,t,"type")}</div><p class="hint">Speed multipliers apply to the base terrain's travel rules. DCs are the starting values for new camps. Every zone inherits these values unless it overrides them.</p><div class="row"><button data-bio="new-type">Add custom type</button><button data-bio="reset-type">${DEFAULT_BIOMES[id]?"Reset defaults":"Delete custom type"}</button></div>`;
    }else if(this.traceMode)body=`<p>${this.tracing?"Tracing the connected map area...":"Click inside the selected biome or near its outline."}</p><p class="hint">Uses the map's terrain classes. You can adjust the preview before saving. Tracing runs separately from the map display.</p><button data-bio="cancel">Cancel tracing</button>`;
    else if(this.draft)body=`<p>${this.coords.length} corners. ${this.tracePreview?`Review the outline, then drag corners to adjust. ${this.traceHoles?.length??0} clearings preserved.`:"Click to add more; Enter or double-click closes the zone."}</p><div class="row"><button data-bio="finish" class="primary">${this.tracePreview?"Save traced zone":"Finish zone"}</button><button data-bio="cancel">Cancel</button></div>`;
    else if(this.selected&&c.zones?.[this.selected]){
      const z=c.zones[this.selected],base=types[z.type]??types.plains;
      body=`<label>Zone name<input data-scope="zone" data-field="name" value="${esc(z.name)}" maxlength="200"></label><label>Biome type<select data-scope="zone" data-field="type">${options(z.type)}</select></label>${climateRow("zone",z.climate??"","Same as its type")}${this.borderRow(z)}<label>Overlap priority<input type="number" data-scope="zone" data-field="priority" min="${DEFAULT_BIOMES[z.type]?1:0}" max="1000" value="${z.priority===0&&DEFAULT_BIOMES[z.type]?"":z.priority??""}" placeholder="${base.priority}"></label><p class="hint">Lower numbers win where zones overlap. Blank inherits the type. Zero is reserved for custom biomes. At equal priority, the smaller zone wins. Modifiers do not stack.</p><div class="bio-fields">${this.fields(z.overrides??{},base,"zone")}</div><p class="hint">Leave an override blank to inherit its type's default. Watch duty and setup fatigue are unchanged.</p><div class="row"><button data-bio="inherit">Use type defaults</button><button data-bio="delete" class="danger">Delete zone</button></div>`;
    }else body=`<label>New zone's type<select data-bio="draw-type">${options(this.newType)}</select></label><div class="row"><button data-bio="trace" class="primary" ${this.getTerrain?"":"disabled"}>Trace map biome</button><button data-bio="draw">Draw manually</button></div><p class="hint">Trace finds the connected map terrain and offers an editable outline. Draw manually when an area needs a different boundary. Unzoned land keeps its map biome.</p><label>Existing zone<select data-bio="zone-select"><option value="">Select a zone</option>${Object.entries(c.zones??{}).map(([id,z])=>`<option value="${esc(id)}">${esc(z.name??id)}</option>`).join("")}</select></label>`;
    this.panel.innerHTML=`<div class="row"><button data-bio="zones" class="${this.mode==="zones"?"on":""}">Zones</button><button data-bio="types" class="${this.mode==="types"?"on":""}">Type defaults</button><button data-bio="undo" ${this.undo.length?"":"disabled"}>Undo</button></div>${body}<p class="hint">Travel changes apply to new journeys. Active journeys keep their departure settings. New camps and party biome flags use current zone settings.</p><div class="row"><button data-bio="export">Export biomes</button><button data-bio="import">Import biomes</button>${this.selected?'<button data-bio="cancel">Done</button>':""}</div>`;this.onStatus?.();
  }
  /** Share an outline with a shoreline or a place instead of its own corners; make a place from this zone. */
  borderRow(z){
    const self=`biome:${this.selected}`,choices=(this.getBorderChoices?.(self,z.name)??[]).filter(c=>!c.ref.startsWith("biome:")),place=this.zonePlace?.(this.selected);
    const share=choices.length||z.follow?`<label>Border <span class="kgr-rule" tabindex="0" data-tooltip="Follow a shoreline's or a place's outline: one outline, drawn once, whichever came first. Reshape that one and this zone moves. Leaving it keeps a copy to change here." data-tooltip-class="kgr-rule-tip">?</span>${borderSelect('data-scope="zone" data-field="follow"',choices,z.follow??"",esc)}</label>${z.follow?`<p class="hint">${z.followGone?"Its outline has gone, or no longer closes, so this zone is off.":`Reshape it in ${borderHome(z.follow)}.`}</p>`:""}`:"";
    const make=place?`<p class="hint">The place ${esc(place.name)} shares this outline.</p>`:this.makeZonePlace?`<div class="row"><button data-bio="make-place" data-tooltip="Make a place from this zone. Its border follows the zone, so there is one outline to draw."><i class="fa-solid fa-location-dot"></i> Make a place</button></div>`:"";
    return share+make;
  }
  async click(d){
    const a=d?.bio;if(!a)return;
    if(a==="make-place"){await this.makeZonePlace?.(this.selected);return this.render();}
    if(a==="zones"||a==="types"){this.mode=a;return this.render();}
    if(a==="trace"){this.select(null);this.traceMode=true;this.draw();return this.render();}
    if(a==="draw"){this.cancelTrace();this.selected=null;this.draft=true;this.coords=[];this.node=null;this.draw();return this.render();}
    if(a==="finish")return this.finish();if(a==="cancel")return this.select(null);if(a==="undo")return this.back();
    if(a==="new-type"){const id=`custom-${foundry.utils.randomID()}`;this.typeId=id;return this.commit(c=>({...c,types:{...c.types,[id]:{...DEFAULT_BIOMES.plains,name:"New biome"}}}));}
    if(a==="reset-type"){
      const id=this.typeId;if(!DEFAULT_BIOMES[id]&&Object.values(this.all().zones??{}).some(z=>z.type===id))return ui.notifications.warn("KG Realms: change the zones using this type before deleting it.");
      return this.commit(c=>{const types={...c.types};delete types[id];return{...c,types};});
    }
    if(a==="inherit"){const id=this.selected;return this.commit(c=>({...c,zones:{...c.zones,[id]:{...c.zones[id],overrides:{}}}}));}
    if(a==="delete"){const id=this.selected;if(!await RealmDialog.confirm({window:{title:"Delete biome zone"},content:"<p>Delete this biome zone? The map's underlying biome will apply. Undo restores it.</p>",rejectClose:false}))return;await this.commit(c=>{const zones={...c.zones};delete zones[id];return{...c,zones};});return this.select(null);}
    if(a==="export")return foundry.utils.saveDataToFile(JSON.stringify({version:1,...this.all()},null,2),"application/json","biomes.json");
    if(a==="import"){
      const input=document.createElement("input");input.type="file";input.accept=".json";input.onchange=async()=>{try{const data=JSON.parse(await input.files[0].text());if(!data||typeof data.types!=="object"||typeof data.zones!=="object"||Object.values(data.zones).some(z=>!Array.isArray(z.pts)||z.pts.length<3||z.pts.length>10000||!z.pts.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite))))throw Error("Invalid biome file");await this.commit(()=>({types:data.types,zones:data.zones}));this.select(null);}catch(e){ui.notifications.warn(`KG Realms: ${e.message}`);}};input.click();
    }
  }
  change(el){
    if(el.dataset.bio==="type-select"){this.typeId=el.value;return this.render();}if(el.dataset.bio==="draw-type"){this.newType=el.value;return;}if(el.dataset.bio==="zone-select")return this.select(el.value||null);
    const k=el.dataset.field,scope=el.dataset.scope;if(!k)return;
    if(scope==="type"){const id=this.typeId,v=BIOME_FIELDS[k]||k==="terrain"||k==="priority"?Number(el.value):el.value;return this.commit(c=>({...c,types:{...c.types,[id]:{...c.types?.[id],[k]:v}}}));}
    if(scope==="zone"&&k==="follow"){const id=this.selected,shown=this.all().zones?.[id]?.pts;return this.commit(c=>{const z={...c.zones[id]};if(el.value){z.follow=el.value;delete z.holes;}else{delete z.follow;if(shown)z.pts=structuredClone(shown);}return{...c,zones:{...c.zones,[id]:z}};});}
    if(scope==="zone"){const id=this.selected;return this.commit(c=>{const z={...c.zones[id]};if(BIOME_FIELDS[k]){z.overrides={...z.overrides};if(el.value==="")delete z.overrides[k];else z.overrides[k]=Math.max(BIOME_FIELDS[k].min,Math.min(BIOME_FIELDS[k].max,Number(el.value)));}else if(k==="priority"){if(el.value===""||(Number(el.value)===0&&DEFAULT_BIOMES[z.type]))delete z.priority;else z.priority=Math.max(0,Math.min(1000,Number(el.value)||0));}else z[k]=el.value;return{...c,zones:{...c.zones,[id]:z}};});}
  }
  refresh(){if(this.active){if(this.selected&&this.drag==null&&this.all().zones?.[this.selected])this.coords=structuredClone(this.all().zones[this.selected].pts);this.draw();this.render();}}
}

