import {RealmDialog} from "./ui-theme.mjs";
import {partyOutlineValue,drawPartyOutline} from './party-appearance.mjs';
import {groupMembers,groupActor,tokenDoc,familyActors,rosterStamp,partyMeta} from './party-groups.mjs';
import {isPrimaryGM} from './authority.mjs';
const ID='kg-realms',esc=s=>foundry.utils.escapeHTML(String(s??''));
/** Member portraits spaced evenly around the inside of the token ring, from the top (one member sits at the bottom). */
export function portraitLayout(width,height,count){
 const d=Math.min(width,height),ring=d*.34,r=Math.min(d*.105,count>1?ring*Math.sin(Math.PI/count)*.9:d*.13);
 return Array.from({length:count},(_,i)=>{const angle=count>1?-Math.PI/2+i*2*Math.PI/count:Math.PI/2;return{x:width/2+Math.cos(angle)*ring,y:height/2+Math.sin(angle)*ring,r};});
}
/**
 * The inner radius (pixels) of a painted ring round a square image's edge, or 0 when it has none: a
 * band of one even, solid colour, at least a tenth of the radius deep, that goes all the way round.
 */
export function framedRadius(data,size){
 const c=size/2,ringAt=r=>{const px=[];for(let i=0;i<64;i++){const a=i/64*Math.PI*2,x=Math.round(c+Math.cos(a)*r),y=Math.round(c+Math.sin(a)*r),j=(Math.min(size-1,Math.max(0,y))*size+Math.min(size-1,Math.max(0,x)))*4;px.push([data[j],data[j+1],data[j+2],data[j+3]]);}
  const m=[0,1,2].map(k=>px.reduce((s,p)=>s+p[k],0)/px.length),spread=Math.sqrt(px.reduce((s,p)=>s+[0,1,2].reduce((t,k)=>t+(p[k]-m[k])**2,0),0)/px.length/3);
  return{even:spread<22&&px.every(p=>p[3]>200),m};};
 const outer=ringAt(c*.9);if(!outer.even)return 0;
 let r=c*.9,inside=false;while(r>c*.5){const at=ringAt(r-2);if(!at.even||Math.hypot(...[0,1,2].map(k=>at.m[k]-outer.m[k]))>40){inside=true;break;}r-=2;}
 // One colour all the way in is a plain picture, not a frame round one.
 return inside&&c*.9-r>=c*.1?Math.max(c*.55,r-2):0;
}
export class PortraitCache {
 constructor(){this.entries=new Map();this.pending=[];this.loading=0;}
 acquire(src){
  let entry=this.entries.get(src);if(!entry){entry={refs:0};this.entries.set(src,entry);entry.promise=new Promise((resolve,reject)=>{this.pending.push({src,entry,resolve,reject});this.pump();});}entry.refs++;
  return entry.promise.then(texture=>({src,texture})).catch(error=>{this.release(src);throw error;});
 }
 pump(){while(this.loading<2&&this.pending.length){const job=this.pending.shift();this.loading++;this.load(job.src).then(texture=>{job.entry.texture=texture;job.resolve(texture);if(!job.entry.refs)this.dispose(job.src,job.entry);},error=>{job.entry.failed=true;job.reject(error);}).finally(()=>{this.loading--;this.pump();});}}
 async load(src){
  const response=await fetch(foundry.utils.getRoute(src));if(!response.ok)throw Error('Portrait could not be loaded');const bitmap=await createImageBitmap(await response.blob());
  try{
   const c=document.createElement('canvas');c.width=c.height=128;const side=Math.min(bitmap.width,bitmap.height),g=c.getContext('2d',{willReadFrequently:true});
   g.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,128,128);
   // Token art with its own painted ring (a frame round the face) would sit as a thick second ring
   // inside ours: draw only what is inside that frame.
   const inner=framedRadius(g.getImageData(0,0,128,128).data,128);
   if(inner){const k=inner/64,s=side*k;g.clearRect(0,0,128,128);g.drawImage(bitmap,(bitmap.width-s)/2,(bitmap.height-s)/2,s,s,0,0,128,128);}
   return PIXI.Texture.from(c);
  }finally{bitmap.close();}
 }
 release(src){const e=this.entries.get(src);if(!e)return;e.refs=Math.max(0,e.refs-1);if(!e.refs&&(e.texture||e.failed))this.dispose(src,e);}
 dispose(src,e){if(this.entries.get(src)!==e)return;this.entries.delete(src);e.texture?.destroy(true);}
}
export class PartyPortraits {
 constructor(){this.cache=new PortraitCache();}
 clear(token){token.kgrPartyRosterKey=null;token.kgrPartyEpoch=(token.kgrPartyEpoch??0)+1;token.kgrPartyPortraits?.destroy({children:true});token.kgrPartyPortraits=null;for(const p of token.kgrPartyImages??[])if(p)this.cache.release(p.src);token.kgrPartyImages=[];}
 install(){
  for(const event of ['drawToken','refreshToken'])Hooks.on(event,t=>this.draw(t));
  Hooks.on('destroyToken',t=>this.clear(t));
  Hooks.on('canvasPan',()=>this.fitStrokes());
  Hooks.on('canvasTearDown',()=>{for(const t of canvas.tokens?.placeables??[])this.clear(t);});
  Hooks.on('updateActor',actor=>{for(const t of canvas.tokens?.placeables??[])if(t.actor?.id===actor.id||groupMembers(t.actor).some(a=>a.id===actor.id)){this.draw(t);}});
 }
 async draw(token){
  if(!groupActor(token)||token.destroyed){if(token.kgrPartyPortraits)this.clear(token);return;}
  const members=groupMembers(token.actor),w=token.w??token.document.width*canvas.grid.size,h=token.h??token.document.height*canvas.grid.size;
  const key=JSON.stringify([members.map(a=>[a.id,a.img]),w,h]);if(token.kgrPartyRosterKey===key)return;token.kgrPartyRosterKey=key;
  const epoch=token.kgrPartyEpoch=(token.kgrPartyEpoch??0)+1;
  const images=await Promise.all(members.map(a=>this.cache.acquire(a.img).catch(()=>null)));
  if(token.destroyed||token.kgrPartyEpoch!==epoch){for(const p of images)if(p)this.cache.release(p.src);return;}
  for(const p of token.kgrPartyImages??[])if(p)this.cache.release(p.src);token.kgrPartyImages=images;
  token.kgrPartyPortraits?.destroy({children:true});const root=token.kgrPartyPortraits=new PIXI.Container();root.eventMode='none';token.addChild(root);
  const layout=portraitLayout(w,h,members.length),d=Math.min(w,h),outlineRadius=d*.468;
  // Transparent surround: additive glow behind a single outer outline.
  const glow=new PIXI.Graphics();glow.blendMode=PIXI.BLEND_MODES.ADD;
  const track=new PIXI.Graphics();root.addChild(glow,track);
  const strokes=[];
  layout.forEach((p,i)=>{
   if(!images[i]){const label=new PIXI.Text((members[i].name??'?').slice(0,1),{fontSize:p.r,fontFamily:'Arial',fill:0xe8d6b5});label.anchor.set(.5);label.position.set(p.x,p.y);root.addChild(label);}
   else{const mask=new PIXI.Graphics().beginFill(0xffffff).drawCircle(p.x,p.y,p.r).endFill(),sprite=new PIXI.Sprite(images[i].texture);sprite.anchor.set(.5);sprite.position.set(p.x,p.y);sprite.width=sprite.height=p.r*2;sprite.mask=mask;root.addChild(sprite,mask);}
   // A light outline over each circle's edge, drawn after the portrait.
   const g=new PIXI.Graphics();root.addChild(g);strokes.push({g,p});
  });
  // Lines a steady width on screen at any zoom or display scale (redrawn on zoom: fitStrokes).
  token.kgrPartyStrokes=()=>{
   if(root.destroyed)return;const zoom=(canvas.stage?.scale?.x||1)*(token.kgrFitFactor||1),line=Math.min(d*.03,Math.max(d*.004,1.4/zoom));
   drawPartyOutline(track,glow,strokes,{width:w,height:h,radius:outlineRadius,line,colour:partyOutlineValue()});
  };
  token.kgrPartyStrokes();
  token.kgrFitNow?.();
 }
 /** On zoom: the portrait rings' lines, kept a steady width on screen. */
 fitStrokes(){if(this.frame)return;this.frame=requestAnimationFrame(()=>{this.frame=0;for(const t of canvas.tokens?.placeables??[])t.kgrPartyStrokes?.();});}
}
export class PartyInterface {
 constructor(manager){this.manager=manager;}
 install(){
  // The token HUD's party button opens split (one group token) or merge (several selected) directly.
  Hooks.on('renderTokenHUD',(app,html)=>{const t=app.object??app.document?.object;if(!groupActor(t)||!game.user.isGM)return;const root=html instanceof HTMLElement?html:html?.[0];if(!root||root.querySelector('[data-party-edit]'))return;const button=document.createElement('button');button.type='button';button.dataset.partyEdit='true';button.className='control-icon';button.title=(canvas.tokens?.controlled??[]).filter(groupActor).length>1?'Merge party':'Split party';button.innerHTML='<i class="fa-solid fa-people-arrows"></i>';button.onclick=e=>{e.preventDefault();e.stopPropagation();this.editSelected(t).catch(err=>ui.notifications.error(err.message));};(root.querySelector('.col.right')??root).append(button);});
 }
 async editSelected(token){
  const doc=tokenDoc(token),selected=[...new Map([...(canvas.tokens?.controlled??[]).filter(groupActor).map(tokenDoc),doc].map(t=>[t.id,t])).values()];
  selected.sort((a,b)=>(partyMeta(a.actor)?.number??1)-(partyMeta(b.actor)?.number??1));
  return this.open(selected[0],selected[1]??null,selected.slice(2));
 }
 async open(left,right=null,extra=[]){
  if(!isPrimaryGM())return ui.notifications.warn('The primary GM manages party membership.');
  const scene=left.parent,actors=familyActors(left.actor),stamp=rosterStamp(actors),members=[...groupMembers(left.actor),...(right?groupMembers(right.actor):[]),...extra.flatMap(t=>groupMembers(t.actor))];
  const all=new Map(members.map(a=>[a.id,a])),rightIds=new Set(right?[...groupMembers(right.actor),...extra.flatMap(t=>groupMembers(t.actor))].map(a=>a.id):[]),checked=new Set();
  const result=await RealmDialog.wait({window:{title:right?'Merge party':'Split party'},position:{width:760},rejectClose:false,
   content:`<div class="kgr-ui kgr-party-transfer"><p>Drag members between the two sides. Shift-click cards to select several, then drag one of them to move them together. Character sheets and their items stay unchanged. Pooled group inventory stays with the original group.</p><div class="kgr-party-sides"><section data-party-side="left"><h3>${esc(left.name)}</h3><div class="kgr-party-members"></div></section><section data-party-side="right"><h3>${esc(right?.name??'New party')}</h3><div class="kgr-party-members"></div></section></div><p class="hint" data-party-summary></p></div>`,
   buttons:[{action:'confirm',label:'Confirm',default:true,callback:()=>[...all.keys()].filter(id=>rightIds.has(id))},{action:'cancel',label:'Cancel',callback:()=>null}],
   render:(_e,dialog)=>{
    const root=dialog.element,paint=()=>{for(const side of ['left','right']){const rows=[...all.values()].filter(a=>rightIds.has(a.id)===(side==='right'));root.querySelector(`[data-party-side="${side}"] .kgr-party-members`).innerHTML=rows.map(a=>`<div class="kgr-party-card ${checked.has(a.id)?'selected':''}" draggable="true" data-member="${esc(a.id)}" tabindex="0" role="option" aria-selected="${checked.has(a.id)}"><i class="fa-solid fa-grip-vertical kgr-party-grip" aria-hidden="true"></i><img src="${esc(a.img)}" alt=""><span>${esc(a.name)}</span></div>`).join('')||'<p class="hint">Drop members here</p>';}
     const n=all.size-rightIds.size;root.querySelector('[data-party-summary]').textContent=`${n} in ${left.name}; ${rightIds.size} in ${right?.name??'the new party'}.`;root.querySelector('[data-action="confirm"]').disabled=!right&&(!n||!rightIds.size);
    };
    const move=(ids,side)=>{for(const id of ids)if(all.has(id)){side==='right'?rightIds.add(id):rightIds.delete(id);checked.delete(id);}paint();};
    // A click selects that card alone; Shift-click (or Ctrl-click) adds it to the selection or takes it out.
    const pick=(id,add)=>{if(add)checked.has(id)?checked.delete(id):checked.add(id);else{checked.clear();checked.add(id);}paint();root.querySelector(`[data-member="${CSS.escape(id)}"]`)?.focus();};
    root.addEventListener('click',e=>{const id=e.target.closest('[data-member]')?.dataset.member;if(id)pick(id,e.shiftKey||e.ctrlKey||e.metaKey);});
    root.addEventListener('keydown',e=>{const id=e.target.closest?.('[data-member]')?.dataset.member;if(id&&(e.key==='Enter'||e.key===' ')){e.preventDefault();pick(id,e.shiftKey||e.ctrlKey||e.metaKey);}});
    root.addEventListener('dragstart',e=>{const id=e.target.closest('[data-member]')?.dataset.member;if(!id)return;e.dataTransfer.setData('application/x-kgr-party-members',JSON.stringify(checked.has(id)?[...checked]:[id]));});
    root.addEventListener('dragover',e=>{if(e.target.closest('[data-party-side]'))e.preventDefault();});root.addEventListener('drop',e=>{const side=e.target.closest('[data-party-side]')?.dataset.partySide;if(!side)return;e.preventDefault();try{move(JSON.parse(e.dataTransfer.getData('application/x-kgr-party-members')),side);}catch{}});paint();
   }
  });
  if(Array.isArray(result))await this.manager.commit({scene,left,right,rightIds:result,stamp,extra});
 }
}
