import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {labelHitIndex} from '../scripts/label-hits.mjs';
import {applyEdits,placesGeoJSON,searchWorld} from '../scripts/places.mjs';
const index=JSON.parse(fs.readFileSync(new URL('../data/worlds/toril/index.json',import.meta.url)));
const rect=(l,t,r,b)=>[[l,t],[r,t],[r,b],[l,b]];
const feature=(id,polygon,hidden=false)=>({properties:{id,hidden,labelPolygons:[polygon]}});
test('rotated labels, padding and cell boundaries resolve without bounding-box false hits',()=>{
 const hits=labelHitIndex([feature('slant',[[250,240],[290,280],[280,290],[240,250]])]);
 assert.equal(hits(260,260),'slant');assert.equal(hits(241,281),null);
 assert.equal(hits(237,250,4),'slant');assert.equal(hits(232,250,4),null);
});
test('small labels beat larger overlapping names and hidden places follow editing state',()=>{
 const hit=labelHitIndex([feature('region',rect(0,0,100,100)),feature('town',rect(40,40,50,50)),feature('hidden',rect(200,0,220,20),true)]);
 assert.equal(hit(45,45),'town');assert.equal(hit(80,80),'region');
 assert.equal(hit(210,10),null);assert.equal(hit(210,10,0,true),'hidden');
});
test('the satellite map carries no printed names: every place has a synthetic label',()=>{
 const places=applyEdits(index.places),features=placesGeoJSON(places).features,hit=labelHitIndex(features);
 const failed=[];
 assert.ok(features.length>1500);assert.ok(features.every(f=>!f.properties.printed));
 const printed=places.filter(p=>p.labelPolygons?.length);
 for(const p of printed){const label=p;
  assert.ok(searchWorld(label.name,{places},100).some(r=>r.item.id===p.id),label.name);
  let reachable=false;
  for(const poly of p.labelPolygons){
   assert.ok(poly.every(v=>v.every(Number.isFinite)),label.name);
   const center=poly.reduce((s,v)=>[s[0]+v[0]/poly.length,s[1]+v[1]/poly.length],[0,0]);
   for(const v of [center,...poly.map(v=>[(v[0]+center[0])/2,(v[1]+center[1])/2])])if(hit(...v)===p.id)reachable=true;
  }
  if(!reachable)failed.push(label.name);
 }
 assert.deepEqual(failed,[]);
});
test('small sites and geographic names across the sheet remain distinct entries',()=>{
 for(const name of ["Agatha's Lair",'Phandalin','Conyberry','Triboar','Yartar','Kryptgarden Forest','High Road','Pirate Isles','Thay','Calimport','Chult','Reghed Glacier','Maer Dualdon','Lac Dinneshere',"Dougan's Hole",'Forest of Amtar','Mere of Dead Men','Sword Mountains','Ardeep Forest','Forlorn Hills','Dun Hills','Stone Wood','The Ice Lakes']){
  const p=index.places.find(p=>p.name===name);assert.ok(p&&Number.isFinite(p.lon)&&Number.isFinite(p.lat),name);
 }
 const p=index.places.find(p=>p.name==='Triboar');
 const edited=applyEdits(index.places,{edits:{[p.id]:{name:'Our Agatha',page:'JournalEntry.example'}}});
 const e=placesGeoJSON(edited).features.find(f=>f.properties.id===p.id);
 assert.equal(e.properties.name,'Our Agatha');assert.equal(e.properties.edited,true);assert.equal(e.properties.gold,true);
});
