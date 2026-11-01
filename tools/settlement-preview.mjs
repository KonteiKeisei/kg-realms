// Local fixture only. All world documents and payments below are in-memory stubs.
import {LocalMapLodSurface} from '../scripts/local-map-lods.mjs';
import {SettlementTravelUI} from '../scripts/city/ui.mjs';
import {LocalEditor} from '../scripts/ui-local.mjs';
const callbacks=new Map();
globalThis.Hooks={on(name,fn){const id=Symbol(name),map=callbacks.get(name)??new Map();map.set(id,fn);callbacks.set(name,map);return id;},off(name,id){callbacks.get(name)?.delete(id);},callAll(name,...args){for(const fn of callbacks.get(name)?.values()??[])fn(...args);}};
const route=p=>'/'+p.replace(/^\/?modules\/kg-realms\//,'').replace(/^\//,'');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
globalThis.foundry={utils:{getRoute:route,escapeHTML:esc,randomID:()=>crypto.randomUUID().replaceAll('-','').slice(0,16),saveDataToFile:(text,type,name)=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();URL.revokeObjectURL(a.href);}},applications:{api:{DialogV2:{confirm:async()=>true}}}};
globalThis.ui={notifications:{info:console.log,warn:console.warn,error:m=>{console.error(m);document.getElementById('proof-status').textContent=m;}},controls:{render(){}}};
const values=new Map([['priceScale','d10'],['localMapBudget',128],['cityTransit',{}]]),settings=new Map();
const collection=docs=>{const map=new Map(docs.map(d=>[d.id,d]));map[Symbol.iterator]=function*(){yield*map.values()};Object.defineProperty(map,'contents',{get:()=>[...map.values()]});return map;};
const actors=collection(['Rowan','Kestrel','Bram'].map((name,i)=>({id:'rider'+i,name,type:'character',img:route('modules/kg-realms-faerun/assets/poi-img/Phandalin.webp'),system:{currency:{gp:10}},flags:{},getFlag(m,k){return this.flags[k]}})));
const group={id:'demo-group',name:'Demonstration party',type:'group',system:{members:[...actors].map(actor=>({actor}))}};
const token={id:'party',name:'Party',uuid:'Scene.demo.Token.party',x:7450,y:9050,width:1,height:1,actor:group};
const local={world:'toril',name:'Waterdeep'},flags={localMap:local,partyToken:token.uuid,cityRoads:{schema:1,revision:1,roads:[
 {id:'lane','name':'Demo lane (fixture only)',kind:'lane',points:[[7500,9100],[7900,9100]]},
 {id:'avenue','name':'Demo avenue (fixture only)',kind:'avenue',points:[[7900,9100],[7900,7300],[9850,7300]]},
 {id:'alley','name':'Demo alley (fixture only)',kind:'alley',points:[[9850,7300],[10100,7300]]}
]}};
const notes=collection([{id:'destination',x:10100,y:7300,text:'Demonstration inn',getFlag:()=>({name:'Demonstration inn',category:'inn',visibility:'discovered'})}]);
const scene={id:'demo',name:'Waterdeep (Master V2)',width:19400,height:28050,grid:{size:100,distance:100,units:'ft'},dimensions:{sceneX:0,sceneY:0},tokens:collection([token]),notes,getFlag:(m,k)=>flags[k],async setFlag(m,k,value){flags[k]=structuredClone(value);Hooks.callAll('updateScene',scene,{flags:{[m]:{[k]:value}}});},async updateEmbeddedDocuments(type,updates,options){for(const u of updates){Object.assign(this.tokens.get(u._id),u);Hooks.callAll('updateToken',this.tokens.get(u._id),u,options);}return updates;},async view(){}};
token.parent=scene;for(const n of notes)n.parent=scene;
const user={id:'gm',name:'GM',isGM:true,active:true},users=[user];users.get=id=>users.find(u=>u.id===id);
globalThis.game={user,users,actors,scenes:collection([scene]),paused:false,time:{worldTime:1000,components:{hour:12},async advance(n){this.worldTime+=n;Hooks.callAll('updateWorldTime',this.worldTime);}},settings:{register(m,k,v){settings.set(k,v);if(!values.has(k))values.set(k,v.default);},get:(m,k)=>values.get(k)??'',async set(m,k,v){values.set(k,structuredClone(v));settings.get(k)?.onChange?.(v);Hooks.callAll('updateSetting',{key:m+'.'+k});return v;}}};
globalThis.Actor={async updateDocuments(updates){for(const u of updates){const a=actors.get(u._id);if(u['system.currency'])a.system.currency=structuredClone(u['system.currency']);if('system.currency.cp'in u)a.system.currency.cp=u['system.currency.cp'];if(u['flags.kg-realms.cityFare'])a.flags.cityFare=u['flags.kg-realms.cityFare'];if('flags.kg-realms.-=cityFare'in u)delete a.flags.cityFare;}}};
await PIXI.Assets.init();PIXI.Assets.loader.parsers.push(PixiBasisKTX2.loadKTX2);PIXI.Assets.detections.push(PixiBasisKTX2.detectKTX2);PIXI.Assets.resolver.parsers.push(PixiBasisKTX2.resolveKTX2TextureUrl);
await PixiBasisKTX2.KTX2Parser.loadTranscoder('/.cache/foundry-ktx-runtime/scripts/ktx2/basis_transcoder.js','/.cache/foundry-ktx-runtime/scripts/ktx2/basis_transcoder.wasm');
const renderer=new PIXI.Renderer({width:innerWidth,height:innerHeight,backgroundColor:0x11161c,antialias:false}),stage=new PIXI.Container(),primary=new PIXI.Container(),inter=new PIXI.Container();
primary.sortableChildren=true;
const bg=new PIXI.Sprite(PIXI.Texture.EMPTY);Object.assign(bg,{elevation:0,sortLayer:0,sort:0,alpha:1,tint:0xffffff});bg.object=primary;Object.defineProperty(bg,'visible',{get:()=>false});primary.background=bg;primary.addChild(bg);stage.addChild(primary,inter);document.body.prepend(renderer.view);
class Mesh extends PIXI.Sprite{constructor({texture,name,object}){super(texture);this.name=name;this.object=object;Object.defineProperty(this,'visible',{get:()=>true});}}
globalThis.canvas={scene,stage,primary,interface:inter,ready:true,loading:false,app:{view:renderer.view,renderer},dimensions:{sceneX:0,sceneY:0,sceneWidth:19400,sceneHeight:28050},async animatePan(p){zoom(stage.scale.x,p.x,p.y);}};
const localMaps={localMapOf:()=>local,localOf:n=>n.getFlag?.('kg-realms','local'),open(){},settings(){},async setIconPack(){},roadEditor:()=>uiTravel.editor,travel:()=>uiTravel.open(scene)};
const uiTravel=new SettlementTravelUI({localMaps});localMaps.editor=new LocalEditor(localMaps);uiTravel.install();
const catalog=await(await fetch('/data/worlds/toril/local/waterdeep-lods.json')).json();let surface,mode='ktx2',status;
function zoom(scale,x=9700,y=14025){stage.scale.set(scale);stage.position.set(innerWidth/2-x*scale,innerHeight/2-y*scale);renderer.render(stage);primary.renderDirty=true;Hooks.callAll('canvasPan');}
async function renderMode(next,budget=128){surface?.stop();mode=next;surface=new LocalMapLodSurface({asset:catalog,canvas,PIXI,Mesh,mode,budgetBytes:budget*1048576,report:s=>{status=s;document.getElementById('proof-status').textContent=`${mode}, LOD ${s.lod}, ${s.loading}, ${s.resident} resident tiles, ${s.texturePayloadMiB} MiB, native 19400 x 28050. Demo roads only.`;}});await surface.start();}
const fixture=globalThis.fixture={scene,ui:uiTravel,renderer,stage,get surface(){return surface},get status(){return status},get mode(){return mode},zoom,renderMode,
 async reset(){if(uiTravel.controller.timer){clearInterval(uiTravel.controller.timer);uiTravel.controller.timer=null;}await game.settings.set('kg-realms','cityTransit',{});token.x=7450;token.y=9050;for(const a of actors){a.system.currency={gp:10};a.flags={};}},
 async plan(){await this.reset();zoom(.14,8800,8200);await uiTravel.open(scene,{note:'destination'});},
 async ride(){await this.reset();uiTravel.close();await uiTravel.editor.close({save:false});await uiTravel.controller.start(scene,{note:'destination'},{mode:'mixed',riderIds:[...actors].map(a=>a.id)});},
 async roads(){await this.reset();zoom(.18,8800,8200);await uiTravel.openRoads();},
 async places(){await this.reset();localMaps.editor.open({tab:'places'});}
};
// Sprite fixture uses the same ordering fields as the primary map meshes.
function draw(){for(const child of primary.children)child.zIndex=child.sort??0;renderer.render(stage);requestAnimationFrame(draw);}
zoom(Math.min(innerWidth/19400,(innerHeight-60)/28050));await renderMode('ktx2');draw();
document.getElementById('scene-navigation').addEventListener('click',async e=>{const act=e.target.dataset.demo;if(!act)return;try{if(act==='overview')zoom(Math.min(innerWidth/19400,(innerHeight-60)/28050));if(act==='regional')zoom(.24,9200,9000);if(act==='detail')zoom(1,9200,9000);if(act==='plan')await fixture.plan();if(act==='roads')await fixture.roads();if(act==='ride')await fixture.ride();if(['webp','ktx2'].includes(act))await renderMode(act);}catch(error){ui.notifications.error(error.message);}});
document.getElementById('theme').onchange=e=>{document.body.className='kgr-theme-'+e.target.value;};
window.addEventListener('resize',()=>{renderer.resize(innerWidth,innerHeight);Hooks.callAll('canvasResize');});
