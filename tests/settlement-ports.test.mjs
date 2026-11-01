import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSea, automaticPort, terrainHarbours} from '../scripts/waterways.mjs';

const project=(x,y)=>[x,y];
function grid(){const g={width:30,height:20,cell:1,data:new Uint8Array(600)};for(let y=0;y<20;y++)for(let x=0;x<6;x++)g.data[y*30+x]=8;return g;}
const places=[{kind:'settlement',lon:7,lat:10,name:'Coast'},{kind:'settlement',lon:17,lat:10,name:'River'},{kind:'settlement',lon:28,lat:10,name:'Inland'},{kind:'natural',lon:7,lat:10,name:'Coastal wood'}];

test('the lightweight dock requirement agrees with the full travel port lookup',()=>{
  const g=grid(),waterways=[{kind:'river',pts:[[17,2],[17,17]],navigable:true},{kind:'shore',pts:[[5,0],[5,19]]},{kind:'wind',pts:[[0,2],[2,18]]}];
  const ports=terrainHarbours(g,places,project,1),full=buildSea(g,waterways,{milesPerPixel:1,ports}),light=buildSea(g,waterways,{milesPerPixel:1,ports,portsOnly:true});
  assert.equal(light.offshore,undefined);assert.equal(light.links,undefined);assert.equal(light.reachOf,undefined);
  for(let x=0;x<30;x++)for(let y=0;y<20;y++){
    const p={kind:'settlement',lon:x,lat:y};assert.equal(automaticPort(p,light,project,1),automaticPort(p,full,project,1));
  }
  assert.equal(automaticPort(places[0],light,project,1),true);
  assert.equal(automaticPort(places[1],light,project,1),true);
  assert.equal(automaticPort(places[2],light,project,1),false);
  assert.equal(automaticPort(places[3],light,project,1),false);
});

test('non-navigable rivers cannot require docks, and a decorative current does not make an inland port',()=>{
  const g=grid(),sea=buildSea(g,[{kind:'river',pts:[[17,2],[17,17]],navigable:false},{kind:'current',pts:[[28,0],[28,19]]}],{milesPerPixel:1,portsOnly:true});
  assert.equal(automaticPort(places[1],sea,project,1),false);
  assert.equal(automaticPort(places[2],sea,project,1),false);
  assert.equal(automaticPort(places[0],null,project,1),false);
});

test('only enabled visible settlement harbours open terrain shoreline cells',()=>{
  const g=grid(),p=places[0];
  assert.equal(terrainHarbours(g,[p],project,1).length,1);
  for(const extra of [{port:false},{hidden:true},{kind:'natural'}])assert.equal(terrainHarbours(g,[{...p,...extra}],project,1).length,0);
  assert.equal(terrainHarbours(null,[p],project,1).length,0);
});
