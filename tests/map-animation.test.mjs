import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RealmLayer,updateMapGlows} from '../scripts/realm-layer.mjs';
import {NightLights} from '../scripts/night-lights.mjs';
import {makeFrame} from '../scripts/geo.mjs';

test('night flicker does not invalidate the separate labels canvas; day and hidden tabs stay idle',()=>{
 globalThis.document={hidden:false};const writes=[];
 const map=(name,layers)=>({isStyleLoaded:()=>true,getLayer:id=>layers.includes(id),getLayoutProperty:()=>undefined,setGlobalStateProperty:(...v)=>writes.push([name,...v]),setPaintProperty:(...v)=>writes.push([name,...v])});
 const ground=map('ground',['night-glow','place-glow']),labels=map('labels',[]);
 for(let i=0;i<150;i++)updateMapGlows([ground,labels],{night:true,gold:false,phase:i/10});
 assert.equal(writes.length,150);assert.ok(writes.every(([name])=>name==='ground'));
 writes.length=0;updateMapGlows([ground,labels],{night:false,gold:false,phase:1});assert.equal(writes.length,0);
 updateMapGlows([ground,labels],{night:false,gold:true,phase:1});assert.equal(writes.length,1);assert.equal(writes[0][1],'place-glow');
 writes.length=0;document.hidden=true;updateMapGlows([ground,labels],{night:true,gold:true,phase:1});assert.equal(writes.length,0);
 document.hidden=false;ground.getLayoutProperty=()=> 'none';updateMapGlows([ground,labels],{night:true,gold:true,phase:1});assert.equal(writes.length,0);
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

test('settlement lights update at most ten times a second and skip offscreen sprite updates',t=>{
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
 alphaWrites=0;sizeWrites=0;
 // A deterministic 15-second, 144 Hz renderer simulation, not a live FPS measurement.
 for(let i=1;i<=2160;i++){now=i*15000/2160;for(const fn of callbacks)fn();}
 assert.ok(alphaWrites>=140&&alphaWrites<=150,alphaWrites);assert.equal(sizeWrites,0);
 canvas.environment.darknessLevel=0;for(let i=0;i<100;i++){now+=100;lights.tick();}assert.equal(lights.root.visible,false);
 const before=alphaWrites;assert.ok(sprites[1].lastAlpha===undefined);
 canvas.environment.darknessLevel=.9;document.hidden=true;lights.tick();assert.equal(alphaWrites,before);
 document.hidden=false;lights.tick();assert.equal(lights.root.visible,true);assert.equal(alphaWrites,before+1);
 lights.destroy();assert.equal(callbacks.size,0);
 lights.draw([],frame);assert.equal(callbacks.size,0);lights.destroy();
});
