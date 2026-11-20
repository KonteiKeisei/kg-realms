// Inside a Regional map's outline the Regional map decides where places are: the realm draws them
// where the Regional map has them, unless the realm has its own alignment for one (0.97.7), which is
// for the realm only and never moves the Regional map.
import test from 'node:test';
import assert from 'node:assert/strict';
import {regionalPlaces,linkProjection} from '../scripts/regional-maps.mjs';
import {homebrewSheet} from '../scripts/homebrew/plan.mjs';
import {sourceProjection} from '../scripts/source-map.mjs';
import {RegionalMaps} from '../scripts/regional-service.mjs';
import {gmGame} from './helpers/journey.mjs';

const near=(a,b,msg)=>assert.ok(Math.abs(a-b)<1e-4,`${msg??''} ${a} != ${b}`);
function fixture(){
  const parent={id:'realm',sourceMap:homebrewSheet(1000,500,1000)},data={id:'dale',sourceMap:homebrewSheet(300,300,150)},root=sourceProjection(parent.sourceMap),child=sourceProjection(data.sourceMap);
  const link={world:'dale',parent:'realm',title:'Icewind Dale',scene:'detail',parentScene:'overview',footprint:[[100,100],[130,100],[130,130],[100,130]].map(p=>root.toLonLat(...p)),anchors:[{parent:[100,100],region:[0,0]},{parent:[130,100],region:[300,0]},{parent:[100,130],region:[0,300]}]};
  return {parent,data,root,child,link,indexes:{realm:parent,dale:data}};
}

test('a realm place moved on the Regional map is drawn on the realm where the Regional map has it', () => {
  const {root,child,link,indexes}=fixture(),bryn={id:'bryn',name:'Bryn Shander',lon:root.toLonLat(115,115)[0],lat:root.toLonLat(115,115)[1]};
  const [lon,lat]=child.toLonLat(30,30);
  const realm=regionalPlaces('realm',w=>w==='realm'?[bryn]:[],{dale:link},indexes,w=>w==='dale'?{bryn:{lon,lat}}:{});
  const p=realm.find(q=>q.id==='bryn');
  assert.equal(p.regionalPosition,'dale');
  const [x,y]=root.toSource(p.lon,p.lat);near(x,103,'x');near(y,103,'y');
  // Not moved there: the realm position stands (the two agree already).
  const untouched=regionalPlaces('realm',w=>w==='realm'?[bryn]:[],{dale:link},indexes,()=>({})).find(q=>q.id==='bryn');
  assert.equal(untouched.regionalPosition,undefined);near(untouched.lon,bryn.lon);
});

test('a place made on the Regional map shows on the realm at its converted spot, keeping its rank', () => {
  const {root,child,link,indexes}=fixture(),[lon,lat]=child.toLonLat(150,150);
  const cave={id:'cave',name:'Cave',lon,lat,rank:5,kind:'site'};
  const p=regionalPlaces('realm',w=>w==='realm'?[]:[cave],{dale:link},indexes).find(q=>q.id==='cave');
  assert.equal(p.regionalWorld,'dale');assert.equal(p.rank,5,'its rank still decides the zoom it shows at');
  const [x,y]=root.toSource(p.lon,p.lat);near(x,115);near(y,115);
});

const setup=(realmEdits={},daleEdits={},daleAdded={},realmRaw,daleRaw)=>{
  gmGame();const f=fixture(),settings={regionalMaps:{dale:f.link}};game.settings.get=(_m,k)=>settings[k];
  const edits={realm:{edits:realmEdits,added:{}},dale:{edits:daleEdits,added:daleAdded}};
  const service=new RegionalMaps({rawPlaces:w=>w==='realm'?realmRaw:daleRaw,getEdits:w=>edits[w]});service.indexes=f.indexes;
  return {...f,service,edits};
};
const bryn=(root)=>({id:'bryn',name:'Bryn',lon:root.toLonLat(115,115)[0],lat:root.toLonLat(115,115)[1]});

test('on the realm a shared place is drawn at its realm alignment, else its Regional position, else as it ships', () => {
  const f=fixture(),b=bryn(f.root),[lon,lat]=f.child.toLonLat(30,30),aligned=f.root.toLonLat(125,125);
  // 1. A realm alignment wins on the realm.
  let s=setup({bryn:{lon:aligned[0],lat:aligned[1]}},{bryn:{lon,lat}},{},[b],[]);
  let p=s.service.places('realm').find(q=>q.id==='bryn');near(s.root.toSource(p.lon,p.lat)[0],125);assert.equal(p.realmAligned,true);
  // 2. Else the Regional position, converted.
  s=setup({},{bryn:{lon,lat}},{},[b],[]);
  p=s.service.places('realm').find(q=>q.id==='bryn');near(s.root.toSource(p.lon,p.lat)[0],103);
  // 3. Else as it ships.
  s=setup({},{},{},[b],[]);
  p=s.service.places('realm').find(q=>q.id==='bryn');near(s.root.toSource(p.lon,p.lat)[0],115);
});

test('a drag on the realm aligns the realm only: the Regional position stays', () => {
  const f=fixture(),b=bryn(f.root),[lon,lat]=f.child.toLonLat(30,30),s=setup({},{bryn:{lon,lat}},{},[b],[]);
  const before=structuredClone(s.edits.realm),after=structuredClone(before),to=f.root.toLonLat(120,110);
  after.edits.bryn={lon:to[0],lat:to[1]};const all={realm:before,dale:structuredClone(s.edits.dale)};
  s.service.reconcileEdits('realm',before,after,all);
  assert.deepEqual(after.edits.bryn,{lon:to[0],lat:to[1]},'kept as the realm alignment');
  assert.deepEqual(all.dale.edits.bryn,{lon,lat},'the Regional position is untouched');
});

test('a realm drag of a place never placed on the Regional map saves its Regional spot first', () => {
  const f=fixture(),b=bryn(f.root),s=setup({},{},{},[b],[]);
  const before=structuredClone(s.edits.realm),after=structuredClone(before),to=f.root.toLonLat(120,110);
  after.edits.bryn={lon:to[0],lat:to[1]};const all={realm:before,dale:{edits:{},added:{}}};
  s.service.reconcileEdits('realm',before,after,all);
  const [x,y]=f.child.toSource(all.dale.edits.bryn.lon,all.dale.edits.bryn.lat);near(x,150,'where it was: realm 115 is regional 150');near(y,150);
  assert.deepEqual(after.edits.bryn,{lon:to[0],lat:to[1]});
});

test('a place made on the Regional map, dragged on the realm, is aligned on the realm only', () => {
  const f=fixture(),[lon,lat]=f.child.toLonLat(150,150),cave={id:'cave',name:'Cave',lon,lat},s=setup({},{},{cave},[],[cave]);
  const before=structuredClone(s.edits.realm),after=structuredClone(before),to=f.root.toLonLat(110,120);
  after.edits.cave={lon:to[0],lat:to[1]};const all={realm:before,dale:structuredClone(s.edits.dale)};
  s.service.reconcileEdits('realm',before,after,all);
  assert.deepEqual(all.dale.added.cave,cave,'its own record is untouched');
  assert.deepEqual(after.edits.cave,{lon:to[0],lat:to[1]});
  const p=setup({cave:{lon:to[0],lat:to[1]}},{},{cave},[],[cave]).service.places('realm').find(q=>q.id==='cave');near(f.root.toSource(p.lon,p.lat)[1],120);
});

test('resetting the realm alignment shows the Regional position again', () => {
  const f=fixture(),b=bryn(f.root),[lon,lat]=f.child.toLonLat(30,30);
  const p=setup({},{bryn:{lon,lat}},{},[b],[]).service.places('realm').find(q=>q.id==='bryn');
  assert.equal(p.realmAligned,undefined);near(f.root.toSource(p.lon,p.lat)[0],103);
});

test('travel uses the Regional position, not a realm alignment', () => {
  const f=fixture(),b=bryn(f.root),[lon,lat]=f.child.toLonLat(30,30),aligned=f.root.toLonLat(125,125);
  const s=setup({bryn:{lon:aligned[0],lat:aligned[1]}},{bryn:{lon,lat}},{},[b],[]);
  const dest=s.service.destinations('realm').find(q=>q.id==='bryn');near(f.root.toSource(dest.lon,dest.lat)[0],103);
});

test('the link projection goes there and back', () => {
  const {root,link,indexes}=fixture(),proj=linkProjection(link,indexes),[lon,lat]=root.toLonLat(112,121);
  const back=proj.toParent(...proj.toRegion(lon,lat));near(back[0],lon);near(back[1],lat);
});

test('the move tool is gone: every realm place inside a Regional map is shared', async () => {
  const {readFileSync}=await import('node:fs');
  const main=readFileSync(new URL('../scripts/main.mjs',import.meta.url),'utf8'),pins=readFileSync(new URL('../scripts/ui-pins.mjs',import.meta.url),'utf8');
  assert.ok(!pins.includes('move-regional')&&!main.includes('moveToRegional'));
});