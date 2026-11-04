import test from 'node:test';
import assert from 'node:assert/strict';
import {rectangleLink,regionalEntrances,regionalJourneyParts,placeRegionalRectangle} from '../scripts/regional-placement.mjs';
import {parseHTML} from 'linkedom';
import {sourceProjection} from '../scripts/source-map.mjs';
import {homebrewSheet} from '../scripts/homebrew/plan.mjs';
const parent=homebrewSheet(1000,1000,1000),child=homebrewSheet(400,200,200),p=sourceProjection(parent),c=sourceProjection(child);
const link={world:'detail',...rectangleLink([500,500],200,parent,child)};
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
test('rectangle placement preserves picture aspect and does not change regional scale',()=>{
  near(link.placement.width/link.placement.height,2);assert.equal(child.milesPerPixel,.5);
  const bigger=rectangleLink([500,500],600,parent,child);near(bigger.placement.height,300);assert.equal(child.milesPerPixel,.5);
});
test('two trails crossing the rectangle create two matching native endpoints',()=>{
  const routes={features:[100,800].map((x,i)=>({properties:{id:`trail${i}`,kind:'trail'},geometry:{type:'LineString',coordinates:[[x,500],[500,500]].map(q=>p.toLonLat(...q))}}))};
  const entries=regionalEntrances(routes,link,parent,child);assert.equal(entries.length,2);near(entries[0].region[0],0);near(entries[0].region[1],100);near(entries[1].region[0],400);near(entries[1].region[1],100);assert.notEqual(entries[0].id,entries[1].id);
});
test('an unrelated realm journey produces no regional path and through-travel clips to the picture edge',()=>{
  const ll=pts=>pts.map(q=>p.toLonLat(...q));
  assert.deepEqual(regionalJourneyParts(ll([[10,10],[200,200]]),[],link,parent,child),[]);
  const parts=regionalJourneyParts(ll([[100,500],[900,500]]),[false,false],link,parent,child);assert.equal(parts.length,1);near(c.toSource(...parts[0].coords[0])[0],0);near(c.toSource(...parts[0].coords.at(-1))[0],400);
});
test('re-entering a region keeps separate paths without drawing a connecting chord across the picture',()=>{
  const path=[[100,500],[500,500],[900,500],[900,800],[500,800],[500,500]].map(q=>p.toLonLat(...q));
  const parts=regionalJourneyParts(path,[],link,parent,child);assert.equal(parts.length,2);
});
test('the placement tool drags, resizes with Alt-wheel, and saves a fixed-aspect rectangle',async()=>{
  const {window,document}=parseHTML('<html><body><canvas></canvas></body></html>');Object.assign(globalThis,{window,document});
  const view=document.querySelector('canvas');view.getBoundingClientRect=()=>({left:0,top:0});globalThis.canvas={app:{view}};
  const layer={frame:{},fromScreen:(x,y)=>p.toLonLat(x,y),setAreaEdit:()=>{}};
  const place={id:'dale',name:'Icewind Dale',area:[[1,2],[3,4],[5,1]]},before=structuredClone(place);
  const pending=placeRegionalRectangle({parentScene:{view:async()=>{}},parentSheet:parent,regionalSheet:child,placeChoices:[place],placeId:'dale',getLayer:()=>layer});await new Promise(resolve=>setImmediate(resolve));
  const fire=(type,props)=>{const e=new window.Event(type,{bubbles:true,cancelable:true});Object.assign(e,props);view.dispatchEvent(e);};
  fire('wheel',{altKey:true,deltaY:-100});fire('pointerdown',{button:0,clientX:500,clientY:500});fire('pointermove',{clientX:600,clientY:550});fire('pointerup',{});
  document.querySelector('[data-finish]').click();const result=await pending;near(result.placement.center[0],600);near(result.placement.center[1],550);assert.ok(result.placement.width>200);near(result.placement.width/result.placement.height,2);
  assert.equal(result.placeId,'dale');assert.deepEqual(place,before,'placement stores the place link without changing its outline');
});
