import test from 'node:test';
import assert from 'node:assert/strict';
import {affine,compileRegions,regionalPlaces,segmentCuts,regionalPointAtDistance} from '../scripts/regional-maps.mjs';
import {homebrewSheet} from '../scripts/homebrew/plan.mjs';
import {sourceProjection} from '../scripts/source-map.mjs';
import {buildGraph,itinerary,pointAtHour,routeSheet,TERRAIN,encounterHours} from '../scripts/travel.mjs';
import {makeFrame,latLonToScene,sceneToLatLon} from '../scripts/geo.mjs';
import {reconcileAway} from '../scripts/away-pause.mjs';
import {RegionalMaps} from '../scripts/regional-service.mjs';
import {TravelHud} from '../scripts/ui-hud.mjs';
import {gmGame} from './helpers/journey.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
function fixture(){
  const parent={id:'realm',sourceMap:homebrewSheet(1000,500,1000)},data={id:'dale',sourceMap:homebrewSheet(300,300,150)},root=sourceProjection(parent.sourceMap),child=sourceProjection(data.sourceMap);
  const link={world:'dale',parent:'realm',title:'Icewind Dale',scene:'detail',parentScene:'overview',footprint:[[100,100],[130,100],[130,130],[100,130]].map(p=>root.toLonLat(...p)),anchors:[{parent:[100,100],region:[0,0]},{parent:[130,100],region:[300,0]},{parent:[100,130],region:[0,300]}]};
  const network=compileRegions(parent,[{link,data,terrainAt:()=>TERRAIN[1]}]);
  const plan=(pts,extra={})=>itinerary(buildGraph([],root.toSource),pts,{mode:'direct',milesPerPixel:1,segments:network.segments,terrainAt:network.terrainAt(()=>TERRAIN[1]),...extra});
  return {parent,data,root,child,link,network,plan};
}
test('through a region uses realm, regional, realm miles with exact entry and exit timing',()=>{
  const {plan}=fixture(),r=plan([[20,115],[190,115]]);
  near(r.miles,290);near(r.hours,290/3);near(pointAtHour(r.track,80/3)[0],100);near(pointAtHour(r.track,155/3)[0],115);near(pointAtHour(r.track,230/3)[0],130);
  near(r.track.at(-1).miles,290);near(r.legs[0].sched.days.reduce((n,d)=>n+d.miles,0),290);
  const sh=routeSheet(r,{stops:[{name:'Start'},{name:'End'}],milesPerPixel:1});
  assert.ok(sh.nodes.some(n=>n.name==='Enter Icewind Dale'));assert.ok(sh.nodes.some(n=>n.name==='Leave Icewind Dale'));near(sh.nodes.at(-1).miles,290);near(sh.nodes.at(-1).hour,290/3);
});
test('reverse travel, endpoints inside and multiple re-entries never reuse the realm scale',()=>{
  const {plan}=fixture();near(plan([[190,115],[20,115]]).miles,290);near(plan([[110,115],[120,115]]).miles,50);
  near(plan([[20,115],[115,115],[20,115],[190,115]]).miles,600);
});
test('several regional maps own independent scales along one journey',()=>{
  const {parent,data,root,link}=fixture();const second={...link,world:'east',title:'East',footprint:[[200,100],[230,100],[230,130],[200,130]].map(p=>root.toLonLat(...p)),anchors:link.anchors.map(a=>({...a,parent:[a.parent[0]+100,a.parent[1]]}))};
  const n=compileRegions(parent,[{link,data,terrainAt:()=>TERRAIN[1]},{link:second,data:{...data,sourceMap:{...data.sourceMap,milesPerPixel:1}},terrainAt:()=>TERRAIN[1]}]);
  const r=itinerary(buildGraph([],root.toSource),[[20,115],[290,115]],{mode:'direct',milesPerPixel:1,segments:n.segments,terrainAt:n.terrainAt(()=>TERRAIN[1])});near(r.miles,660);
});
test('camp escape distances remain true miles inside a region and across its border',()=>{
  const {network}=fixture();near(regionalPointAtDistance([115,115],0,10,network.segments,1)[0],117);near(regionalPointAtDistance([120,115],0,60,network.segments,1)[0],140);
});
test('regional terrain affects hours once, and flying ignores terrain while keeping true distance',()=>{
  const {parent,data,link,root}=fixture(),n=compileRegions(parent,[{link,data,terrainAt:()=>TERRAIN[4]}]);
  const options={mode:'direct',milesPerPixel:1,segments:n.segments,terrainAt:n.terrainAt(()=>TERRAIN[1])};
  const graph=buildGraph([],root.toSource),r=itinerary(graph,[[20,115],[190,115]],options);near(r.hours,(140+300)/3);
  const flying=itinerary(graph,[[20,115],[190,115]],{...options,legs:[{method:{key:'flying',mph:10}}]});near(flying.miles,290);near(flying.hours,29);
});
test('parent roads inside coverage are replaced with regional roads, retaining long polylines',()=>{
  const {network,root,child}=fixture(),line=(id,pts,proj)=>({type:'FeatureCollection',features:[{type:'Feature',properties:{id,kind:'road',name:id},geometry:{type:'LineString',coordinates:pts.map(p=>proj.toLonLat(...p))}}]});
  const roads=network.roads(line('old',[[20,115],[190,115]],root),{dale:line('new',[[0,150],[150,150],[300,150]],child)});
  assert.equal(roads.features.length,3);assert.ok(roads.features[2].properties.id.startsWith('dale:'));assert.equal(roads.features[2].geometry.coordinates.length,3);
  const r=itinerary(buildGraph(roads.features,root.toSource),[[20,115],[190,115]],{mode:'roadsOnly',milesPerPixel:1,segments:network.segments,terrainAt:network.terrainAt(()=>TERRAIN[1])});near(r.miles,290);
});
test('routing compares the true regional cost with roads that go around its footprint',()=>{
  const {network,root,child}=fixture(),feature=(id,pts,p)=>({type:'Feature',properties:{id,kind:'road'},geometry:{type:'LineString',coordinates:pts.map(q=>p.toLonLat(...q))}});
  const roads=network.roads({features:[feature('across',[[20,115],[190,115]],root),feature('around',[[20,115],[20,95],[190,95],[190,115]],root)]},{dale:{features:[feature('regional',[[0,150],[300,150]],child)]}});
  const r=itinerary(buildGraph(roads.features,root.toSource,[],{precision:1e6}),[[20,115],[190,115]],{mode:'roads',milesPerPixel:1,segments:network.segments,terrainAt:network.terrainAt(()=>TERRAIN[1])});
  assert.ok(r.miles<250);assert.ok(!r.track.some(p=>p.regionTitle));
});
test('invalid anchors and overlapping footprints fail, while an imperfect picture fit is accepted',()=>{
  const {parent,data,link}=fixture();assert.throws(()=>affine([{parent:[0,0],region:[0,0]},{parent:[1,1],region:[1,1]},{parent:[2,2],region:[2,2]}]),/triangle/);
  assert.throws(()=>compileRegions(parent,[{link,data},{link:{...link,world:'other'},data}]),/overlap/);
  const loose=compileRegions(parent,[{link:{...link,anchors:link.anchors.map(a=>({...a,region:a.region.map(n=>n/2+200)}))},data}]);assert.equal(loose.regions[0].uncovered,true);
  assert.deepEqual(segmentCuts([0,0],[10,0],[[3,-2],[7,-2],[7,2],[3,2]]),[0,.3,.7,1]);
});
test('imperfect picture coverage keeps regional scale and retains realm terrain and roads in the unmatched fringe',()=>{
  const {parent,data,root,link}=fixture();
  // The regional picture covers the right half of the outlined region, but not the left half.
  const shifted={...link,anchors:link.anchors.map(a=>({...a,region:[a.region[0]-150,a.region[1]]}))};
  let regionalQueries=0;
  const n=compileRegions(parent,[{link:shifted,data,terrainAt:()=>{regionalQueries++;return TERRAIN[4];}}]),terrain=n.terrainAt(()=>TERRAIN[1]);
  assert.equal(n.regions[0].uncovered,true);assert.equal(terrain(105,115),TERRAIN[1]);assert.equal(regionalQueries,0);assert.equal(terrain(120,115),TERRAIN[4]);
  const road={type:'FeatureCollection',features:[{type:'Feature',properties:{id:'parent',kind:'road'},geometry:{type:'LineString',coordinates:[[100,115],[130,115]].map(p=>root.toLonLat(...p))}}]};
  const roads=n.roads(road,{});assert.equal(roads.features.length,1);
  near(root.toSource(...roads.features[0].geometry.coordinates.at(-1))[0],115);
  const r=itinerary(buildGraph([],root.toSource),[[100,115],[130,115]],{mode:'direct',milesPerPixel:1,segments:n.segments,terrainAt:terrain});
  near(r.miles,150);near(r.hours,75);assert.ok(r.track.some(p=>p.regionalFallback));assert.ok(r.track.some(p=>p.regionTitle&&!p.regionalFallback));
});
test('inherited and published POIs retain canonical identity, metadata and visibility',()=>{
  const {parent,data,link,root,child}=fixture(),bryn={id:'bryn',name:'Bryn Shander',lon:root.toLonLat(115,115)[0],lat:root.toLonLat(115,115)[1],scene:'town',hidden:true,area:[[1,1],[2,2],[3,3]]},discovery={id:'cave',name:'Cave',lon:child.toLonLat(100,100)[0],lat:child.toLonLat(100,100)[1],hidden:true};
  const raw=w=>w==='realm'?[bryn]:[discovery],indexes={realm:parent,dale:data};
  const inherited=regionalPlaces('dale',raw,{dale:link},indexes).find(p=>p.id==='bryn');assert.equal(inherited.canonicalWorld,'realm');assert.equal(inherited.scene,'town');assert.equal(inherited.hidden,true);assert.equal(inherited.area,undefined);near(child.toSource(inherited.lon,inherited.lat)[0],150);
  assert.equal(regionalPlaces('realm',raw,{dale:link},indexes).length,1);
  const published=regionalPlaces('realm',raw,{dale:{...link,publish:['cave']}},indexes).find(p=>p.id==='cave');assert.equal(published.canonicalWorld,'dale');assert.equal(published.hidden,true);assert.equal(published.approximate,true);
});
test('regional position edits remain local while inherited metadata writes back to the canonical map',()=>{
  gmGame();const {parent,data,link,root}=fixture(),settings={regionalMaps:{dale:link}};game.settings.get=(_m,k)=>settings[k];
  const bryn={id:'bryn',name:'Bryn',...Object.fromEntries(['lon','lat'].map((k,i)=>[k,root.toLonLat(115,115)[i]]))},edits={dale:{edits:{bryn:{lon:10,lat:11}},added:{}}};
  const service=new RegionalMaps({rawPlaces:w=>w==='realm'?[bryn]:[],getEdits:w=>edits[w]});service.indexes={realm:parent,dale:data};
  const before=structuredClone(edits.dale),after=structuredClone(before);after.edits.bryn.name='New name';const all={dale:before};
  service.reconcileEdits('dale',before,after,all);assert.equal(all.realm.edits.bryn.name,'New name');assert.equal(after.edits.bryn.name,undefined);assert.equal(after.edits.bryn.lon,10);assert.equal(service.places('dale')[0].lon,10);
});
test('a departed regional journey reuses its saved geometry and timing after regional data changes or becomes unavailable',async()=>{
  gmGame();globalThis.foundry={utils:{escapeHTML:String,deepClone:structuredClone}};globalThis.canvas={scene:null,tokens:{placeables:[]}};
  const {plan,network,parent,root}=fixture(),points=[[20,115],[190,115]],stops=points.map(p=>{const [lon,lat]=root.toLonLat(...p);return {lon,lat};});let state={waypoints:[stops[1]],legModes:['direct']};const scene={getFlag:()=>state};
  const hud=new TravelHud({headless:true,getScene:()=>scene,getSourceMap:()=>parent.sourceMap,getLayer:()=>null,getRoutes:()=>({features:[]}),getTerrain:async()=>null,getPlaces:()=>[],getEncounters:()=>[],getWaterways:()=>({}),getRegionalNetwork:async()=>({...network,graph:buildGraph([],root.toSource)})});hud.stops=()=>stops;hud.speed=()=>({feet:30});hud.favoredTerrains=()=>[];hud.tick=()=>{};
  await hud.refresh();near(hud.result.miles,290);const expectedHours=hud.result.hours,snapshot=structuredClone(hud.regionalSnapshot);assert.ok(snapshot);
  state.trip={departed:0,regionalPlan:snapshot,biomeTravel:{version:2,types:{},zones:{}},walking:{baseFeet:30,changes:[]}};hud.getRegionalNetwork=async()=>{throw Error('Offline');};await hud.refresh();near(hud.result.miles,290);near(hud.result.hours,expectedHours);
});

test('regional view projects the same journey both ways and continues to use the parent scene',()=>{
  gmGame();const {parent,data,link,root,child}=fixture();game.settings.get=(_m,k)=>k==='regionalMaps'?{dale:link}:'';
  const owner={id:'overview',getFlag:(_m,k)=>k==='world'?'realm':null},scene={id:'detail',getFlag:(_m,k)=>k==='world'?'dale':null};game.scenes=new Map([['overview',owner],['detail',scene]]);
  const service=new RegionalMaps({});service.indexes={realm:parent,dale:data};
  const frame=makeFrame(data.sourceMap.bounds,{x:0,y:0,width:600,height:600});let drawn;
  const layer={frame,setJourney:(...args)=>drawn=args,toScreen:(lon,lat)=>[lon,lat],fromScreen:(lon,lat)=>[lon,lat],placeAt:()=> 'bryn'};
  const view=service.viewLayer(layer,'dale'),ll=root.toLonLat(115,115),native=child.toLonLat(150,150);view.setJourney([ll],[{at:ll,name:'Party'}]);assert.equal(drawn[0],null);near(drawn[1][0].at[1],native[1]);
  const pixel=latLonToScene(view.frame,ll[1],ll[0]);near(pixel.x,300);near(pixel.y,300);const back=sceneToLatLon(view.frame,pixel);near(back.lon,ll[0]);near(back.lat,ll[1]);assert.equal(view.placeAt(), 'bryn');assert.equal(service.rootScene(scene),owner);
});

test('regional encounters use native circular reach even when the parent projection is stretched',()=>{
  gmGame();const {parent,data,link,root,child}=fixture();game.settings.get=(_m,k)=>k==='regionalMaps'?{dale:link}:'';const service=new RegionalMaps({});service.indexes={realm:parent,dale:data};
  const ll=child.toLonLat(150,150),records=w=>w==='dale'?{test:{name:'Regional encounter',lon:ll[0],lat:ll[1],radius:1}}:{};
  const e=service.encounters('realm',records)[0];assert.equal(e.id,'region/dale/test');assert.deepEqual(service.recordRef('realm',e.id),{world:'dale',id:'test'});
  const hits=encounterHours([{at:[115,115.1],hour:1},{at:[115,115.5],hour:2}],[{...e,radius:e.reach}]);assert.equal(hits.length,1);assert.equal(hits[0].hour,1);
});

test('regional mirror tokens follow only the selected party and disappear on exit without touching placed tokens',async()=>{
  gmGame();const {parent,data,link}=fixture();game.settings.get=(_m,k)=>k==='regionalMaps'?{dale:link}:'';
  const makeToken=(id)=>({id,actor:{id,type:'group'},width:1,height:1,toObject:()=>({_id:id,actorId:id,width:1,height:1,flags:{}})});
  const a=makeToken('a'),b=makeToken('b'),placed={id:'decoration',getFlag:()=>null};
  const owner={id:'overview',tokens:[a,b],getFlag:(_m,k)=>k==='world'?'realm':null};
  const scene={id:'detail',grid:{size:100},tokens:[placed],dimensions:{sceneRect:{x:0,y:0,width:600,height:600}},getFlag:(_m,k)=>k==='world'?'dale':null,
    async createEmbeddedDocuments(_type,rows){for(const row of rows)this.tokens.push({...row,id:'mirror',getFlag:(_m,k)=>row.flags['kg-realms'][k]});},
    async updateEmbeddedDocuments(_type,rows){for(const row of rows)Object.assign(this.tokens.find(t=>t.id===row._id),row);},
    async deleteEmbeddedDocuments(_type,ids){this.tokens=this.tokens.filter(t=>!ids.includes(t.id));}};
  game.scenes=new Map([['overview',owner],['detail',scene]]);const service=new RegionalMaps({});service.indexes={realm:parent,dale:data};
  await Promise.all([service.syncPosition(owner,[110,115],['a']),service.syncPosition(owner,[115,115],['a'])]);assert.equal(scene.tokens.length,2);assert.equal(scene.tokens[1].actorId,'a');near(scene.tokens[1].x,250);
  await service.syncPosition(owner,[190,115],['a']);assert.deepEqual(scene.tokens,[placed]);
});

test('switching to a linked regional scene does not insert an away pause into the parent journey',async()=>{
  const trip={departed:1,halts:[]},owner={id:'realm',tokens:[],getFlag:()=>({trip})},region={id:'region',tokens:[],getFlag:()=>null};const scenes=[owner,region];scenes.active=region;gmGame({scenes});let writes=0;
  await reconcileAway({isRealm:s=>s===owner,sameMap:(a,b)=>a===owner&&b===region,write:()=>writes++,now:100});assert.equal(writes,0);
  scenes.active={id:'encounter'};await reconcileAway({isRealm:s=>s===owner,write:()=>writes++,now:100});assert.equal(writes,1);
});
