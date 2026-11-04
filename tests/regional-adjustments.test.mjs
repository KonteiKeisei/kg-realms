import test from 'node:test';
import assert from 'node:assert/strict';
import {mapSnowEnabled,snowConfig} from '../scripts/snow.mjs';
import {adjustedEntrances,followCrossingRoads} from '../scripts/regional-placement.mjs';
import {compileRegions} from '../scripts/regional-maps.mjs';
import {homebrewSheet} from '../scripts/homebrew/plan.mjs';
import {sourceProjection} from '../scripts/source-map.mjs';
import {buildGraph,itinerary,TERRAIN,pointAtHour} from '../scripts/travel.mjs';
import {RegionalMaps} from '../scripts/regional-service.mjs';
import {SnowTab} from '../scripts/ui-snow.mjs';
import {parseHTML} from 'linkedom';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
test('regional snow is off by default and opts in independently of realm snow',()=>{
  const links={dale:{parent:'realm'}};
  assert.equal(mapSnowEnabled('dale',links,{},true),false);
  assert.equal(mapSnowEnabled('dale',links,{dale:{enabled:true}},false),true);
  assert.equal(mapSnowEnabled('dale',links,{dale:{enabled:false}},true),false);
  assert.equal(mapSnowEnabled('realm',links,{},true),true);
});
test('regional Snow tab exposes its own opt-in and hides snow-line controls until enabled',async()=>{
  const {document,window}=parseHTML('<html><body></body></html>');Object.assign(globalThis,{document,window});globalThis.game={user:{isGM:true}};globalThis.foundry={utils:{escapeHTML:String}};
  Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return this.querySelector('option[selected]')?.getAttribute('value')??'';},set(v){for(const o of this.querySelectorAll('option')){if(o.getAttribute('value')===v)o.setAttribute('selected','');else o.removeAttribute('selected');}}});
  let enabled=false;
  const tab=new SnowTab({isRegional:()=>true,getEnabled:()=>enabled,setEnabled:async value=>enabled=value,getSnow:()=>snowConfig(),getMonths:()=>['Winter','Summer'],getSheet:()=>({height:500,width:1000,milesPerPixel:1}),snow:{preview:()=>{}}});
  tab.open();assert.ok(tab.panel.querySelector('[name="regional-enabled"]'));assert.equal(tab.panel.querySelector('[name="north-on"]'),null);
  const checkbox=tab.panel.querySelector('[name="regional-enabled"]');checkbox.checked=true;checkbox.dispatchEvent(new window.Event('change',{bubbles:true}));await new Promise(resolve=>setImmediate(resolve));assert.equal(enabled,true);assert.ok(tab.panel.querySelector('[name="north-on"]'));tab.close();
});
test('regional crossing edits persist through regeneration without moving the realm endpoint',()=>{
  const sheet=homebrewSheet(300,300,150),p=sourceProjection(sheet),ll=p.toLonLat(30,200),entry={id:'gate',parent:[100,115],parentLL:[1,2],region:[0,150],regionLL:p.toLonLat(0,150)};
  const edited=adjustedEntrances([entry],{gate:{lon:ll[0],lat:ll[1]}},sheet)[0];
  const roads={features:[{properties:{from:'gate'},geometry:{type:'LineString',coordinates:[[1,2],[3,4]]}}]};const followed=followCrossingRoads(roads,[edited]);assert.deepEqual(followed.features[0].geometry.coordinates[0],ll);assert.deepEqual(roads.features[0].geometry.coordinates[0],[1,2]);near(edited.region[0],30);near(edited.region[1],200);assert.deepEqual(edited.parentLL,[1,2]);assert.deepEqual(entry.region,[0,150]);
  const settings={regionalMaps:{dale:{world:'dale',parent:'realm',entrances:[entry],anchors:[{parent:[0,0],region:[0,0]},{parent:[1,0],region:[1,0]},{parent:[0,1],region:[0,1]}],footprint:[[0,0],[1,0],[1,1]]}}};
  globalThis.game={settings:{get:(_m,k)=>settings[k]}};
  const edits={edits:{gate:{lon:ll[0],lat:ll[1]}},added:{}},service=new RegionalMaps({rawPlaces:()=>[],getEdits:w=>w==='dale'?edits:{}});service.indexes={dale:{sourceMap:sheet}};
  const after=service.reconcileEdits('dale',{edits:{},added:{}},structuredClone(edits),{});assert.deepEqual(after.edits.gate,edits.edits.gate);
  const reloaded=new RegionalMaps({getEdits:()=>edits});reloaded.indexes=service.indexes;near(reloaded.entrances('dale')[0].region[0],30);
});
test('moving a crossing connects the original realm road to the adjusted native road without phantom mileage',()=>{
  const parent={id:'realm',sourceMap:homebrewSheet(1000,500,1000)},data={sourceMap:homebrewSheet(300,300,150)},p=sourceProjection(parent.sourceMap),c=sourceProjection(data.sourceMap);
  const link={world:'dale',parent:'realm',title:'Dale',footprint:[[100,100],[130,100],[130,130],[100,130]].map(q=>p.toLonLat(...q)),anchors:[{parent:[100,100],region:[0,0]},{parent:[130,100],region:[300,0]},{parent:[100,130],region:[0,300]}],entrances:[{id:'gate',name:'Trail crossing',kind:'Trail',parent:[100,115],parentLL:p.toLonLat(100,115),region:[20,150],adjusted:true}]};
  const n=compileRegions(parent,[{link,data,terrainAt:()=>TERRAIN[1]}]),line=(id,pts,projection)=>({features:[{properties:{id,kind:'trail'},geometry:{type:'LineString',coordinates:pts.map(q=>projection.toLonLat(...q))}}]});
  const roads=n.roads(line('realm',[[20,115],[190,115]],p),{dale:line('native',[[20,150],[300,150]],c)});
  const result=itinerary(buildGraph(roads.features,p.toSource,[],{precision:1e6}),[[20,115],[190,115]],{mode:'roadsOnly',milesPerPixel:1,segments:n.segments,terrainAt:n.terrainAt(()=>TERRAIN[1])});
  assert.ok(result);near(result.miles,280);assert.ok(result.track.some(q=>q.portalTransfer));near(result.hours,280/3);
  const seam=result.track.find(q=>q.portalTransfer);near(pointAtHour(result.track,seam.hour)[0],102);assert.ok(pointAtHour(result.track,seam.hour-.001)[0]<100);
});
