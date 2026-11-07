import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as realmLayer from '../scripts/realm-layer.mjs';
import {NightLights} from '../scripts/night-lights.mjs';
import {makeFrame} from '../scripts/geo.mjs';
const {RealmLayer}=realmLayer;
const src=f=>fs.readFileSync(new URL(`../scripts/${f}`,import.meta.url),'utf8');

test('the realm map glows are steady: no glow timer, and the night glow does not follow a clock',()=>{
 assert.equal(realmLayer.updateMapGlows,undefined);
 const layer=src('realm-layer.mjs');
 assert.doesNotMatch(layer,/setInterval/,'no repeating timer redraws the realm map');
 assert.doesNotMatch(layer,/startPulse|\.pulse\b/);
 assert.doesNotMatch(src('source-map.mjs'),/global-state'\s*,\s*'phase'/,'night glow brightness depends on the place alone');
 const street=src('city/street-names.mjs'),glow=street.slice(street.indexOf('#glow(runs'),street.indexOf('#stopGlow() {'));
 assert.doesNotMatch(glow,/Math\.sin|\.alpha\s*=/,'the street search highlight does not blink or fade');
});

test('a search highlight shows steadily for a few seconds, then is cleared, with one style write each',t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const writes=[],data=[];
 const map={isStyleLoaded:()=>true,setPaintProperty:(...v)=>writes.push(v),getSource:()=>({setData:d=>data.push(d)})};
 const layer=new RealmLayer();layer.ready=true;layer.map=map;
 const point={type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:{type:'Point',coordinates:[1,1]}}]};
 layer.flash(point);
 assert.deepEqual(writes,[['flash-glow','circle-opacity',0.8],['flash-ring','circle-stroke-opacity',1]]);
 assert.deepEqual(data,[point]);
 t.mock.timers.tick(4000);assert.equal(writes.length,2,'no blinking while shown');assert.equal(data.length,1);
 t.mock.timers.tick(600);assert.equal(data.length,2);assert.deepEqual(data[1].features,[]);
 assert.equal(writes.length,2);
});

test('repeated canvas pan notifications with an unchanged camera do not schedule MapLibre redraws',()=>{
 globalThis.window={devicePixelRatio:1};globalThis.PIXI={Point:class{constructor(x,y){Object.assign(this,{x,y});}}};
 let offset=0,jumps=0,resize=0;
 globalThis.canvas={app:{renderer:{screen:{width:200,height:100}}},stage:{scale:{x:1},toLocal:p=>({x:p.x+offset,y:p.y})}};
 const layer=new RealmLayer();layer.ready=true;layer.frame=makeFrame({west:0,east:2,south:0,north:2},{x:0,y:0,width:200,height:100});layer.options={};
 layer.el={style:{}};layer.map={resize:()=>resize++,setPixelRatio(){},jumpTo:()=>jumps++,setGlobalStateProperty(){}};
 layer.update();assert.equal(jumps,1);assert.equal(resize,1);
 for(let i=0;i<2160;i++)layer.update();assert.equal(jumps,1);assert.equal(resize,1);
 offset=20;layer.update();assert.equal(jumps,2);
 canvas.app.renderer.screen.width=300;layer.update();assert.equal(jumps,3);assert.equal(resize,2);
 clearTimeout(layer.settleTimer);
});

test('settlement lights are steady: brightness is written only when dusk changes it, and offscreen lights are skipped',t=>{
 let now=0,alphaWrites=0,sizeWrites=0;const callbacks=new Set();
 t.mock.method(performance,'now',()=>now);
 class Container{constructor(){this.children=[];}addChild(s){this.children.push(s);}destroy(){this.destroyed=true;}}
 class Sprite{constructor(){this.anchor={set(){}};this.position={x:0,y:0,set(x,y){this.x=x;this.y=y;}};}set alpha(v){alphaWrites++;this.lastAlpha=v;}set width(v){sizeWrites++;}set height(v){sizeWrites++;}}
 const grad={addColorStop(){}};
 globalThis.document={hidden:false,createElement:()=>({getContext:()=>({createRadialGradient:()=>grad,fillRect(){}})})};
 globalThis.PIXI={Container,Sprite,Texture:{from:()=>({})},BLEND_MODES:{ADD:1}};
 globalThis.canvas={environment:{darknessLevel:.9},scene:{grid:{size:100,distance:20}},interface:{addChildAt(){}},app:{ticker:{add:fn=>callbacks.add(fn),remove:fn=>callbacks.delete(fn)},renderer:{screen:{width:200,height:200}}},stage:{scale:{x:1},worldTransform:{applyInverse:p=>p}}};
 const frame=makeFrame({west:0,east:2,south:0,north:2},{x:0,y:0,width:200,height:200});
 const lights=new NightLights();lights.draw([{id:'visible',class:'City',lon:1,lat:1},{id:'offscreen',class:'City',lon:20,lat:20}],frame);
 const sprites=lights.lights.map(l=>l.s);assert.equal(sprites[0].visible,true);assert.equal(sprites[1].visible,false);
 const steady=sprites[0].lastAlpha;assert.ok(steady>0);
 alphaWrites=0;sizeWrites=0;
 // A deterministic 15-second, 144 Hz renderer simulation, not a live FPS measurement.
 for(let i=1;i<=2160;i++){now=i*15000/2160;for(const fn of callbacks)fn();}
 assert.equal(alphaWrites,0,'a steady light is not written again');assert.equal(sizeWrites,0);assert.equal(sprites[0].lastAlpha,steady);
 // Dusk: the light dims once, then stays.
 canvas.environment.darknessLevel=.5;now+=100;lights.tick();assert.equal(alphaWrites,1);assert.ok(sprites[0].lastAlpha<steady);
 for(let i=0;i<20;i++){now+=100;lights.tick();}assert.equal(alphaWrites,1);
 canvas.environment.darknessLevel=0;for(let i=0;i<100;i++){now+=100;lights.tick();}assert.equal(lights.root.visible,false);
 const before=alphaWrites;assert.ok(sprites[1].lastAlpha===undefined);
 canvas.environment.darknessLevel=.9;document.hidden=true;now+=100;lights.tick();assert.equal(alphaWrites,before);
 document.hidden=false;now+=100;lights.tick();assert.equal(lights.root.visible,true);assert.equal(sprites[0].lastAlpha,steady);
 // Each light keeps its own steady brightness, different from its neighbour's.
 const two=new NightLights();two.draw([{id:'a',class:'City',lon:1,lat:1},{id:'b',class:'City',lon:1.1,lat:1.1}],frame);
 assert.notEqual(two.lights[0].bright,two.lights[1].bright);two.destroy();
 lights.destroy();assert.equal(callbacks.size,0);
 lights.draw([],frame);assert.equal(callbacks.size,0);lights.destroy();
});
