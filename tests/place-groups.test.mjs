import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {PinEditor} from '../scripts/ui-pins.mjs';

test('place groups start collapsed and search expansion is discarded when search clears or the editor reopens',async()=>{
  const {document,window}=parseHTML('<html><body></body></html>');
  Object.assign(globalThis,{document,window,game:{user:{isGM:true}},foundry:{utils:{escapeHTML:String,getRoute:String}},fetch:async()=>({json:async()=>[]}),localStorage:{getItem:()=> '["kind:settlement","kind:realms","settlement|Town"]'}});
  const places=[{id:'town',name:'Twin Town',kind:'settlement',class:'Town',lon:1,lat:1},{id:'site',name:'Twin Cave',kind:'site',class:'Cave',lon:2,lat:2},{id:'kingdom',name:'Twin Kingdom',kind:'domain',class:'Kingdom',lon:3,lat:3},{id:'region',name:'Twin Region',kind:'territory',class:'Region',partOf:'kingdom',lon:4,lat:4},{id:'forest',name:'Twin Forest',kind:'natural',class:'Forest',lon:5,lat:5}];
  const editor=new PinEditor({getLayer:()=>({frame:{},setAreaEdit(){}}),getPlaces:()=>places,getPlace:id=>places.find(p=>p.id===id),getMarkers:()=>({})});
  await editor.open();
  const expanded=()=>editor.panel.querySelectorAll('.kgr-place-groups details[open]').length;
  const search=value=>{const input=editor.panel.querySelector('[name="place-filter"]');input.value=value;input.dispatchEvent(new window.Event('input',{bubbles:true}));};
  const open=key=>{const d=editor.panel.querySelector(`[data-place-open="${key}"]`);d.open=true;d.setAttribute('open','');d.dispatchEvent(new window.Event('toggle',{bubbles:true}));};
  assert.equal(expanded(),0,'ignore remembered expanded groups from older releases');
  open('kind:settlement');open('settlement|Town');assert.equal(expanded(),2);
  search('Twin');assert.ok(expanded()>=4);assert.equal(editor.panel.querySelectorAll('.kgr-enc-list-row').length,5);
  editor.select('site');search('');assert.equal(expanded(),0,'selection must not force a group back open');
  open('kind:realms');open('realm:kingdom');assert.equal(expanded(),2);
  search('Twin Region');assert.equal(editor.panel.querySelectorAll('.kgr-enc-list-row').length,1);
  search('   ');assert.equal(expanded(),0,'whitespace counts as cleared search');
  open('kind:site');search('Twin');editor.close();await editor.open();
  assert.equal(expanded(),0);assert.equal(editor.panel.querySelector('[name="place-filter"]').value,'');
  editor.close();
});
