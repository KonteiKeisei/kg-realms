import test from 'node:test';
import assert from 'node:assert/strict';
import {RegionalMaps} from '../scripts/regional-service.mjs';
import {placesGeoJSON,searchWorld} from '../scripts/places.mjs';
import {areasGeoJSON,outlinedIds} from '../scripts/map-layers.mjs';
import {sourceMapStyle} from '../scripts/source-map.mjs';
import {buildStyle} from '../scripts/realm-style.mjs';

function evaluate(value,p,state,zoom=4){
  if(!Array.isArray(value))return value;
  const [op,...args]=value,v=args.map(a=>op==='literal'?a:evaluate(a,p,state,zoom));
  switch(op){case 'get':return p[v[0]];case 'global-state':return state[v[0]];case 'zoom':return zoom;case 'literal':return args[0];case 'all':return v.every(Boolean);case 'any':return v.some(Boolean);case '!':return !v[0];case '==':return v[0]===v[1];case '!=':return v[0]!==v[1];case '<=':return v[0]<=v[1];case '>=':return v[0]>=v[1];case '<':return v[0]<v[1];case 'in':return v[1].includes(v[0]);case '+':return v.reduce((a,b)=>a+b,0);default:throw Error(`Unsupported filter ${op}`);}
}
function fixture(){
  const link={world:'dale',parent:'realm',placeId:'area',scene:'detail',entrances:[{id:'crossing',name:'Trail crossing',regionLL:[0,0],parentLL:[0,0]}]},links={dale:link};
  globalThis.game={scenes:new Map([['detail',{id:'detail'}]]),settings:{get:()=>links}};
  const raw=[{id:'area',name:'Icewind Dale',kind:'territory',class:'Area',rank:5,lon:0,lat:0,area:[[-1,-1],[1,-1],[1,1],[-1,1]]},{id:'town',name:'Bryn Shander',kind:'settlement',class:'Town',rank:4,lon:.2,lat:0}];
  const service=new RegionalMaps({rawPlaces:id=>id==='realm'?raw:[],getEdits:()=>({})}),places=service.places('realm');
  return{service,places,features:placesGeoJSON(places,outlinedIds(places)).features};
}

test('linked Regional places retain a marker despite area outlines and ordinary place rank',()=>{
  const f=fixture(),p=f.features.find(f=>f.properties.id==='area').properties;
  assert.equal(p.regionalMapEntry,true);assert.equal(p.outlined,true);assert.equal(p.icon,'faerun-regional');assert.equal(p.minzoom,0);
  const areas=areasGeoJSON(f.places);assert.equal(areas.areas.features.length,1);assert.equal(areas.labels.features.length,0,'the entry point owns its label');
  for(const style of [sourceMapStyle({tiles:{tapestry:'image'}}),buildStyle({tiles:{surface:'s',global:'g'},level:'surface'})]){
    const entry=style.layers.find(l=>l.id==='regional-map-entries');assert.ok(entry);assert.equal(entry.layout['text-allow-overlap'],true);assert.equal(entry.layout['text-optional'],false);
    for(const mapLayers of [['places'],['realms'],['places','realms']])for(const settledZoom of [0,4,9])assert.equal(evaluate(entry.filter,p,{gm:false,editing:false,mapLayers,settledZoom}),true);
    for(const mapLayers of [[],['geo']])assert.equal(evaluate(entry.filter,p,{gm:false,editing:false,mapLayers}),false);
    assert.equal(evaluate(entry.filter,{...p,hidden:true},{gm:false,editing:false,mapLayers:['places']}),false);
  }
});

test('crossings are edit-only in both styles and stay out of search and travel destinations',()=>{
  const f=fixture(),p=f.features.find(f=>f.properties.id==='crossing').properties;
  assert.ok(p.regionalEntry);assert.ok(f.service.places('realm').some(p=>p.id==='crossing'));
  assert.ok(!f.service.destinations('realm').some(p=>p.regionalEntry));assert.equal(searchWorld('Trail crossing',{places:f.places}).length,0);
  for(const style of [sourceMapStyle({tiles:{tapestry:'image'}}),buildStyle({tiles:{surface:'s',global:'g'},level:'surface'})]){
    const layers=style.layers.filter(l=>l.source==='places'&&l.filter);
    for(const gm of [false,true])for(const mapLayers of [['places'],['realms'],['places','realms']])assert.ok(layers.every(l=>!evaluate(l.filter,p,{gm,editing:false,mapLayers,settledZoom:9},9)));
    assert.ok(layers.some(l=>evaluate(l.filter,p,{gm:true,editing:true,mapLayers:['places'],settledZoom:9},9)));
    assert.ok(layers.every(l=>!evaluate(l.filter,p,{gm:false,editing:true,mapLayers:['places'],settledZoom:9},9)));
    const town=f.features.find(f=>f.properties.id==='town').properties;
    assert.ok(layers.every(l=>!evaluate(l.filter,town,{gm:true,editing:false,mapLayers:['realms'],settledZoom:9},9)));
  }
});
