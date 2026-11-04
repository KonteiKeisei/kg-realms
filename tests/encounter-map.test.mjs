import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {RealmLayer} from '../scripts/realm-layer.mjs';
import {journeyEncounterKey,journeyEncounterRef,journeyEncounterPreview,encounterPreview} from '../scripts/encounter-map.mjs';
import {PlaceCard} from '../scripts/ui-card.mjs';
import {PlaceCards} from '../scripts/place-card.mjs';
import {registerKinds} from '../scripts/card-kinds.mjs';
import {sourceMapStyle} from '../scripts/source-map.mjs';
import {TravelHud} from '../scripts/ui-hud.mjs';

const secret={id:'ambush',name:'Hidden ambush',known:'Secret encounter content',notes:'Hidden notes',gmNotes:'Hidden GM plan',dc:15,lon:1,lat:2};
function layerFixture(gm=true,loaded=true){
  globalThis.game={user:{isGM:gm}};
  const sources=new Map(),callbacks=[];
  const map={style:{_loaded:loaded},isStyleLoaded:()=>loaded,once:(_e,fn)=>callbacks.push(fn),setGlobalStateProperty(){},getSource:id=>({setData:data=>sources.set(id,data)})};
  const layer=new RealmLayer();layer.ready=true;layer.map=map;
  return{layer,map,sources,flush(){map.style._loaded=true;for(const fn of callbacks)fn();}};
}

test('the HUD emits the owning scene and party on encounter dots and omits them for players',()=>{
  globalThis.game={user:{isGM:true}};
  const scene={id:'realm',partyId:'party-a',getFlag:()=>({encounters:[secret],waypoints:[],show:'route'})};
  let drawn;const hud=new TravelHud({headless:true,getScene:()=>scene,getLayer:()=>({setJourney:(...args)=>drawn=args}),getPlaces:()=>[]});
  hud.stops=()=>[{lon:0,lat:0},{lon:2,lat:2}];hud.progress=()=>null;hud.draw();
  const mark=drawn[1].find(m=>m.kind==='encounter');assert.ok(mark);assert.deepEqual(journeyEncounterRef(mark.cardKey),{kind:'journey',scene:'realm',partyId:'party-a',id:'ambush'});
  game.user.isGM=false;hud.draw();assert.ok(!drawn[1].some(m=>m.kind==='encounter'));
});

test('journey dots carry stable card references and private dots never enter player rendering sources',()=>{
  const f=layerFixture(),key=journeyEncounterKey({id:'realm',partyId:'party-a'},secret.id),marks=[{kind:'encounter',name:secret.name,cardKey:key,at:[1,2]},{kind:'stop',name:'Public destination',at:[3,4]}];
  f.layer.setJourney(null,marks);assert.equal(f.sources.get('journey-camps').features[0].properties.cardKey,key);
  assert.deepEqual(journeyEncounterRef(key),{kind:'journey',scene:'realm',partyId:'party-a',id:'ambush'});
  game.user.isGM=false;f.layer.setJourney(null,marks);
  assert.equal(f.layer.journey[1].length,1);assert.ok(!JSON.stringify(f.sources.get('journey-camps')).includes('Hidden ambush'));
  f.layer.setEncounters({secret,publicHazard:{kind:'rapids',visibility:'discovered',name:'Known rapids',lon:2,lat:3},hiddenHazard:{kind:'rapids',visibility:'hidden',name:'Hidden rapids',lon:3,lat:4}});
  assert.deepEqual(Object.keys(f.layer.encounters),['publicHazard']);assert.deepEqual(f.sources.get('encounters').features.map(f=>f.properties.name),['Known rapids']);
});

test('a queued GM map write rechecks permission before placing dots or names in either source',()=>{
  const f=layerFixture(true,false);
  f.layer.setJourney(null,[{kind:'encounter',name:secret.name,at:[1,2]}]);f.layer.setEncounters({secret});
  game.user.isGM=false;f.flush();
  assert.equal(f.sources.get('journey-camps').features.length,0);assert.equal(f.sources.get('encounters').features.length,0);
});

test('hover hit detection resolves journey encounter dots only for the GM',()=>{
  const f=layerFixture(),key=journeyEncounterKey({id:'realm'},'ambush');
  f.layer.camera={x:0,y:0,w:100,h:100};f.layer.el={clientWidth:100,clientHeight:100};f.layer.options={sourceMap:{}};
  const queries=[];f.map.getLayer=()=>true;f.map.project=()=>({x:25,y:25});
  f.map.queryRenderedFeatures=(_box,{layers})=>{queries.push(layers);return layers.includes('journey-camps')?[{properties:{kind:'encounter',cardKey:key}}]:[];};
  assert.equal(f.layer.placeAt({x:25,y:25}),key);
  game.user.isGM=false;queries.length=0;assert.equal(f.layer.placeAt({x:25,y:25}),null);assert.ok(!queries.some(ids=>ids.includes('journey-camps')));
});

test('a journey preview reads the correct party record and denies players before returning content',()=>{
  const actor=id=>({id,type:'group',getFlag:()=>null}),a=actor('a'),b=actor('b');
  const scene={id:'realm',tokens:[{id:'ta',actor:a},{id:'tb',actor:b}],getFlag:(_m,k)=>k==='partyJourneys'?{a:{encounters:[secret]},b:{encounters:[{...secret,name:'Other party encounter'}]}}:null};
  globalThis.game={user:{isGM:true},scenes:new Map([['realm',scene]])};
  const key=journeyEncounterKey({id:'realm',partyId:'a'},'ambush');assert.equal(journeyEncounterPreview(key).name,secret.name);
  assert.equal(journeyEncounterPreview(journeyEncounterKey({id:'realm',partyId:'b'},'ambush')).name,'Other party encounter');
  assert.equal(journeyEncounterPreview(journeyEncounterKey({id:'realm',partyId:'missing'},'ambush')),null);
  assert.equal(journeyEncounterPreview('journey-encounter:malformed'),null);
  game.user.isGM=false;assert.equal(journeyEncounterPreview(key),null);
});

test('ordinary encounter cards deny players even if discovered, and direct card calls cannot reveal details',async()=>{
  globalThis.game={user:{isGM:false},scenes:new Map([['realm',{getFlag:()=>({encounters:[{...secret,kind:'rapids',visibility:'discovered'}]})}]])};
  globalThis.foundry={utils:{escapeHTML:String}};globalThis.fromUuidSync=()=>null;
  const cards=new PlaceCards();registerKinds(cards,{encounters:()=>({secret:{...secret,visibility:'discovered'}})});
  for(const ref of [{kind:'encounter',world:'world',id:'secret'},{kind:'journey',scene:'realm',id:'ambush'}]){
    assert.deepEqual(cards.kinds[ref.kind].get(ref),{gmOnly:true,visibility:'hidden'});
    await cards.open(ref);assert.equal(cards.app,null);
  }
});

test('GM hover cards are marked private and delayed hovers or direct opens cannot expose them to players',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {document,window}=parseHTML('<html><body><canvas></canvas></body></html>'),handlers=new Map(),view=document.querySelector('canvas');view.getBoundingClientRect=()=>({left:0,top:0});document.elementFromPoint=()=>view;
  Object.assign(globalThis,{document,window,game:{user:{isGM:true}},foundry:{utils:{escapeHTML:String,getRoute:String}},canvas:{app:{view},stage:{on:(k,v)=>handlers.set(k,v),off:k=>handlers.delete(k)},tokens:{controlled:[]}},requestAnimationFrame:fn=>setTimeout(fn,0),cancelAnimationFrame:clearTimeout});
  const key=journeyEncounterKey({id:'realm'},'ambush'),p=encounterPreview(secret,key,journeyEncounterRef(key));let opened=0;
  const card=new PlaceCard({getPlace:()=>p,openCard:()=>opened++,hoverDelayMs:()=>20});card.attach({placeAt:()=>key,frame:null});
  const move={global:{x:100,y:100},client:{clientX:100,clientY:100},getLocalPosition:()=>({x:100,y:100})};
  handlers.get('pointermove')(move);t.mock.timers.tick(0);t.mock.timers.tick(20);
  assert.ok(card.el?.classList.contains('kgr-gm-only'));assert.match(card.el.textContent,/GM only/);assert.match(card.el.textContent,/Perception DC: 15/);assert.match(card.el.textContent,/Hidden GM plan/);
  card.open(key);assert.equal(opened,1);
  handlers.get('pointermove')(move);t.mock.timers.tick(0);t.mock.timers.tick(8);game.user.isGM=false;t.mock.timers.tick(50);
  assert.equal(card.el,null);assert.equal(card.cue,null);card.open(key);assert.equal(opened,1);
  handlers.get('pointermove')(move);t.mock.timers.tick(30);assert.equal(document.querySelector('.kgr-card,.kgr-hover-cue'),null);card.detach();
});

test('map styles independently gate private encounter circles and their labels',()=>{
  const style=sourceMapStyle({tiles:{tapestry:'t'},glyphs:'g'});
  for(const id of ['journey-camps','journey-camp-labels','journey-stop-names','encounter-marks','encounter-labels'])assert.ok(JSON.stringify(style.layers.find(l=>l.id===id).filter).includes('"global-state","gm"'),id);
});

test('full private card windows have the GM border and badge and are cleared if access changes',async()=>{
  const {document,window}=parseHTML('<html><body></body></html>');Object.assign(globalThis,{document,window});
  class App {
    constructor(){this.element=document.createElement('div');this.element.className='kgr-ui kgr-place-card';this.content=document.createElement('div');this.element.append(this.content);document.body.append(this.element);}
    async render(){const html=await this._renderHTML();this._replaceHTML(html,this.content);this.rendered=true;return this;}
    async close(){this.element.remove();this.rendered=false;}
  }
  globalThis.foundry={utils:{escapeHTML:String},applications:{api:{ApplicationV2:App}}};globalThis.TextEditor={enrichHTML:async s=>s};globalThis.game={user:{isGM:true},scenes:new Map()};globalThis.fromUuidSync=()=>null;
  const cards=new PlaceCards();cards.register('encounter',{get:()=>({gmOnly:true,name:secret.name,known:secret.known,visibility:'discovered'})});
  await cards.open({kind:'encounter',id:'secret'});const app=cards.app;
  assert.ok(app.element.classList.contains('kgr-gm-only'));assert.match(app.content.textContent,/GM only/);
  game.user.isGM=false;app._replaceHTML('Secret stale render',app.content);assert.equal(app.content.textContent,'');
  app.dirty=true;cards.enforceAccess();assert.equal(app.dirty,false);assert.equal(app.accessRevoked,true);assert.equal(cards.app,null);assert.equal(document.querySelector('.kgr-place-card'),null);
});
