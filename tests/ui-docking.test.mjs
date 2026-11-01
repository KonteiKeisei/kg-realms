import { test } from "node:test";
import assert from "node:assert/strict";
import { uiBounds } from "../scripts/ui-editbar.mjs";
import { dockOverMap, dockSceneTrail } from "../scripts/ui-docking.mjs";

function setup() {
  const boxes=new Map();
  globalThis.window={innerWidth:1440,innerHeight:900};
  globalThis.document={getElementById:id=>boxes.get(id)};
  globalThis.getComputedStyle=el=>({display:el.hidden?"none":"block",visibility:"visible"});
  const add=(id,left,top,width,height)=>boxes.set(id,{getBoundingClientRect:()=>({left,top,right:left+width,bottom:top+height,width,height})});
  const style={setProperty(k,v){this[k]=v;}};
  return {boxes,add,el:{style}};
}

test("the carousel starts below navigation using the edit bar's map bounds", () => {
  const {add,el}=setup();
  add("scene-controls",0,80,80,400);add("scene-navigation",80,0,1000,60);
  add("sidebar",1100,0,340,900);add("hotbar",350,780,700,120);
  assert.deepEqual(uiBounds(),{left:80,right:1100,top:60,bottom:780});
  dockOverMap(el);
  assert.equal(el.style.left,"590px");assert.equal(el.style.top,"80px");assert.equal(el.style.bottom,"auto");
  assert.equal(el.style.width,"680px");assert.equal(el.style.maxHeight,"688px");
});

test("hidden UI stops reserving space, and narrow short windows constrain the carousel", () => {
  const {add,boxes,el}=setup();window.innerWidth=480;window.innerHeight=430;
  add("controls",0,50,50,200);add("navigation",50,0,300,44);add("hotbar",60,350,400,80);
  add("sidebar",300,0,180,430);boxes.get("sidebar").hidden=true;
  dockOverMap(el);
  assert.equal(el.style.left,"265px");assert.equal(el.style.width,"406px");assert.equal(el.style.maxHeight,"274px");
  boxes.get("hotbar").hidden=true;dockOverMap(el);
  assert.equal(el.style.top,"64px");assert.equal(el.style.bottom,"auto");assert.equal(el.style.maxHeight,"354px");
});

test("full-height scene picker wrappers retain top clearance without limiting taller carousels", () => {
  const {add,el}=setup();window.innerHeight=1200;
  add("scene-navigation",0,0,1440,1200);
  dockOverMap(el);
  assert.equal(el.style.top,"64px");assert.equal(el.style.maxHeight,"1124px");
});

test("the scene trail stays below navigation and centered clear of the sidebar", () => {
  const {add,el}=setup();
  add("scene-controls",0,80,80,400);add("scene-navigation",80,0,1000,60);
  add("sidebar",1100,0,340,900);
  dockSceneTrail(el);
  assert.equal(el.style.top,"68px");assert.equal(el.style.left,"590px");
  assert.equal(el.style.maxWidth,"996px");
});
