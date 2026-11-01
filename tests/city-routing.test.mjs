import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildCityGraph,planCityRoute,joinCityPlans,snapToRoad,cityPosition,validateRoads} from '../scripts/city/routing.mjs';
import {farePerRider,payFare,walletValue} from '../scripts/city/money.mjs';
const road=(id,kind,points)=>({id,name:id,kind,points});
const graph=roads=>buildCityGraph({schema:1,revision:1,roads});
test('roads connect at geometric crossings and near endpoints without a separate junction marker',()=>{
  const g=graph([road('east','street',[[0,0],[1000,0]]),road('north','street',[[500,0],[500,500]])]);
  const p=planCityRoute(g,[20,0],[500,480]);assert.equal(p.feet,960);assert.equal(p.boardingCount,0);
  assert.ok(p.legs[0].points.some(p=>p[0]===500&&p[1]===0));
  const cross=graph([road('east','street',[[0,0],[1000,0]]),road('north','street',[[500,-500],[500,500]])]);assert.equal(planCityRoute(cross,[20,0],[500,480]).feet,960);
});
test('walking avoids an alley when a modest street detour is available, but still uses an essential alley',()=>{
  const streets=[road('shortcut','alley',[[0,0],[1000,0]]),road('main','street',[[0,0],[0,100],[1000,100],[1000,0]])];
  const p=planCityRoute(graph(streets),[0,0],[1000,0]);assert.deepEqual(p.legs[0].roads,['main']);assert.equal(p.feet,1200);
  assert.equal(planCityRoute(graph(streets.slice(0,1)),[0,0],[1000,0]).feet,1000);
});
test('carriage travel uses only streets and avenues and keeps lane access on foot',()=>{
  const roads=[road('front lane','lane',[[0,0],[100,0]]),road('avenue','avenue',[[100,0],[2000,0]]),road('back alley','alley',[[2000,0],[2100,0]])];
  const p=planCityRoute(graph(roads),[0,0],[2100,0],{mode:'mixed'});
  assert.deepEqual(p.legs.map(l=>l.mode),['walk','carriage','walk']);assert.equal(p.boardingCount,1);assert.deepEqual(p.legs[1].roads,['avenue']);
  assert.ok(p.seconds<planCityRoute(graph(roads),[0,0],[2100,0]).seconds);
});
test('a carriage takes a legal detour instead of driving through a lane',()=>{
  const p=planCityRoute(graph([road('lane','lane',[[0,0],[1000,0]]),road('street','street',[[0,0],[0,100],[1000,100],[1000,0]])]),[0,0],[1000,0],{mode:'mixed'});
  assert.ok(p.legs.some(l=>l.mode==='carriage'));assert.ok(p.legs.filter(l=>l.mode==='carriage').every(l=>!l.roads.includes('lane')));
});
test('route timing uses distance scale and fixed speeds, not the alley preference cost',()=>{
  const p=planCityRoute(graph([road('alley','alley',[[0,0],[5280,0]])]),[0,0],[5280,0]);assert.equal(p.seconds,1200);
  assert.equal(cityPosition(p,600).point[0],2640);assert.equal(cityPosition(p,9999).point[0],5280);
  assert.equal(planCityRoute(graph([road('alley','alley',[[0,0],[5280,0]])]),[0,0],[5280,0],{feetPerPixel:2}).seconds,2400);
});
test('missing roads, disconnected networks and distant endpoints return actionable errors',()=>{
  assert.throws(()=>planCityRoute(graph([]),[0,0],[100,0]),/Draw settlement roads/);
  assert.throws(()=>planCityRoute(graph([road('a','street',[[0,0],[100,0]]),road('b','street',[[1000,0],[1100,0]])]),[0,0],[1100,0]),/do not connect/);
  assert.throws(()=>planCityRoute(graph([road('a','street',[[0,0],[100,0]])]),[0,0],[100,900]),/too far/);
  assert.throws(()=>validateRoads({schema:1,roads:[road('a','unknown',[[0,0],[1,1]])]}),/invalid geometry/);
});
test('carriage base fare is 5 sp and respects the shared economy multiplier',()=>{
  assert.equal(farePerRider('x1'),50);assert.equal(farePerRider('d10'),5);assert.equal(farePerRider('x2'),100);assert.equal(farePerRider('d100'),1);
});
test('fare change preserves wealth and never depends on wallet size',()=>{
  for(const wallet of [{gp:1},{cp:5},{sp:1,cp:2},{pp:1000000},{ep:1},{gp:2,sp:3,cp:4}])for(const price of [0,1,5,50,125]){
    const after=payFare(wallet,price);if(walletValue(wallet)<price)assert.equal(after,null);else assert.equal(walletValue(after),walletValue(wallet)-price);
  }
  assert.deepEqual(payFare({gp:1},5),{pp:0,gp:0,ep:0,sp:9,cp:5});
});

test('a route through points the GM sets takes the longer way and stays aboard a carriage at a route point',()=>{
  // Two ways from west to east: straight along the south street, or round by the north avenue.
  const g=graph([road('south','street',[[0,0],[1000,0]]),road('west','avenue',[[0,0],[0,500]]),road('north','avenue',[[0,500],[1000,500]]),road('east','avenue',[[1000,500],[1000,0]])]);
  assert.equal(planCityRoute(g,[0,0],[1000,0]).feet,1000);
  const via=snapToRoad(g,[480,530]).point;assert.deepEqual(via,[480,500]);
  const p=joinCityPlans([planCityRoute(g,[0,0],via,{mode:'mixed'}),planCityRoute(g,via,[1000,0],{mode:'mixed'})]);
  assert.equal(p.feet,2000);assert.equal(p.boardingCount,1);assert.equal(p.legs.length,1);assert.deepEqual(p.end,[1000,0]);
  assert.ok(p.legs[0].points.some(q=>q[0]===480&&q[1]===500));
});