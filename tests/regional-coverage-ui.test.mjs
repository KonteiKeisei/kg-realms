import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {PinEditor} from '../scripts/ui-pins.mjs';
import {applyEdits} from '../scripts/places.mjs';

function setup(answer,base=[]){
  const {document,window}=parseHTML('<html><body></body></html>');Object.assign(globalThis,{document,window,localStorage:{getItem:()=>null,setItem:()=>{}}});
  let edits={edits:{},added:{}},cards=0,dialog;
  globalThis.foundry={utils:{escapeHTML:String,deepClone:structuredClone,randomID:()=> 'coverage'},applications:{api:{DialogV2:{wait:async config=>{dialog=config;return answer;}}}}};
  globalThis.ui={notifications:{warn:()=>{},info:()=>{}}};globalThis.game={user:{isGM:true}};
  globalThis.canvas={app:{view:{getBoundingClientRect:()=>({left:0,top:0})}},stage:{worldTransform:{applyInverse:p=>p}}};
  const layer={frame:{},fromScreen:(x,y)=>[x,y],toScreen:(x,y)=>[x,y],setAreaEdit:()=>{},placeAt:()=>null};
  const places=()=>applyEdits(base,edits);
  const editor=new PinEditor({getLayer:()=>layer,getPlaces:places,getPlace:id=>places().find(p=>p.id===id),getRegions:()=>[],getEdits:()=>edits,getMarkers:()=>({}),getRemoved:()=>[],saveEdits:async fn=>{edits=fn(structuredClone(edits));},openCard:()=>cards++});
  editor.active=true;editor.select(null);
  const click=(x,y)=>editor.handlers.pointerdown({button:0,clientX:x,clientY:y,preventDefault(){},stopImmediatePropagation(){}});
  return {editor,click,places,get cards(){return cards;},get dialog(){return dialog;}};
}

test('territory border drawing is available before selection and creates a named closed region without opening a place card',async()=>{
  const s=setup({existing:'',name:'Icewind Dale'});assert.ok(s.editor.panel.querySelector('[data-act="draw-area"]'));
  assert.match(s.editor.panel.textContent,/does not resize the regional scene rectangle/);
  await s.editor.drawRegionalCoverage();assert.equal(s.editor.placing,true);
  await s.click(20,20);assert.equal(s.editor.drawing.areaBorder,true);assert.equal(s.cards,0);
  await s.click(0,0);await s.click(100,0);await s.click(100,100);
  assert.match(s.editor.panel.textContent,/Finish closed border/);
  await s.editor.onKey({key:'Enter',target:document.body,preventDefault(){},stopImmediatePropagation(){}});
  const p=s.places()[0];assert.equal(p.name,'Icewind Dale');assert.equal(p.kind,'territory');assert.equal(p.shape,'area');assert.equal(p.areaClosed,true);assert.equal(p.area.length,3);assert.equal(s.editor.drawing,null);
});

test('choosing an existing region redraws its outline without duplicating or replacing its metadata',async()=>{
  const s=setup({existing:'dale',name:''},[{id:'dale',name:'Icewind Dale',kind:'territory',class:'Region',lon:20,lat:20,scene:'settlement',page:'journal'}]);
  await s.editor.drawRegionalCoverage();assert.equal(s.editor.selected,'dale');assert.equal(s.editor.placing,false);
  await s.click(0,0);await s.click(100,0);await s.click(100,100);await s.click(0,0);
  assert.equal(s.places().length,1);const p=s.places()[0];assert.equal(p.areaClosed,true);assert.equal(p.scene,'settlement');assert.equal(p.page,'journal');
});

test('regional coverage cannot finish as an open line or with fewer than three corners, and cancel preserves the old outline',async()=>{
  const area=[[0,0],[100,0],[100,100]],s=setup({existing:'dale',name:''},[{id:'dale',name:'Icewind Dale',kind:'territory',class:'Region',lon:20,lat:20,area,areaClosed:true}]);
  await s.editor.drawRegionalCoverage();await s.click(10,10);await s.click(90,10);
  await s.editor.onKey({key:'Enter',target:document.body,preventDefault(){},stopImmediatePropagation(){}});assert.ok(s.editor.drawing);assert.deepEqual(s.places()[0].area,area);
  s.editor.onKey({key:'Escape',target:document.body,preventDefault(){},stopImmediatePropagation(){}});assert.equal(s.editor.drawing,null);assert.deepEqual(s.places()[0].area,area);
});
