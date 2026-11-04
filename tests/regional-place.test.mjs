import test from 'node:test';
import assert from 'node:assert/strict';
import {regionalPlace} from '../scripts/regional-place.mjs';
import {RegionalMaps} from '../scripts/regional-service.mjs';
import {rectangleLink} from '../scripts/regional-placement.mjs';
import {homebrewSheet} from '../scripts/homebrew/plan.mjs';
import {registerKinds} from '../scripts/card-kinds.mjs';

test('region scene links recognise older outlines and uniquely named rectangle maps',()=>{
  const places=[{id:'dale',name:'Icewind Dale',kind:'territory',class:'Region'},{id:'town',name:'Icewind Dale',class:'Town'}];
  assert.equal(regionalPlace({title:'Map of the Icewind Dale'},places)?.id,'dale');
  assert.equal(regionalPlace({outline:'dale',title:'Different title'},places)?.id,'dale');
  assert.equal(regionalPlace({placeId:'dale',title:'Different title'},places)?.id,'dale');
  assert.equal(regionalPlace({placeId:null,title:'Map of the Icewind Dale'},places),null);
  assert.equal(regionalPlace({title:'Icewind Dale'},[places[0],{...places[0],id:'duplicate'}]),null);
});

test('regional scene entry and a custom territory outline remain independent from the picture rectangle',async()=>{
  const sheet=homebrewSheet(1000,1000,1000),area=[[1,2],[3,4],[5,1],[7,3],[2,0]],base={id:'dale',name:'Icewind Dale',kind:'territory',class:'Region',area,lon:0,lat:0};
  const links={dale:{world:'dale',parent:'realm',scene:'detail',title:'Map of the Icewind Dale',...rectangleLink([500,500],200,sheet,sheet)}};
  const actions=[],scene={id:'detail',name:'Icewind Dale detailed',getFlag:()=>null,activate:async()=>actions.push('activate'),view:async()=>actions.push('view')};
  globalThis.game={user:{isGM:true},settings:{get:()=>links},scenes:new Map([['detail',scene]])};
  globalThis.foundry={utils:{escapeHTML:String}};globalThis.fromUuidSync=()=>null;
  let edits={};const service=new RegionalMaps({rawPlaces:()=>[base],getEdits:()=>edits});
  const kinds=new Map();registerKinds({register:(k,v)=>kinds.set(k,v)},{realmPlaces:async world=>service.places(world),presetFor:async()=>null});
  const ref={kind:'realm',world:'realm',id:'dale'},handler=kinds.get('realm');
  const card=await handler.get(ref);assert.deepEqual(card.enter,{scene:'detail',label:'Enter Icewind Dale'});
  assert.equal(card.form.scene,'','derived links must not become manual scene edits when the card saves');
  await handler.enter(ref,false);await handler.enter(ref,true);assert.deepEqual(actions,['view','activate']);
  game.user.isGM=false;await handler.enter(ref,true);assert.equal(actions.length,2,'players cannot activate scenes');game.user.isGM=true;
  assert.deepEqual(service.places('realm')[0].area,area);
  Object.assign(links.dale,rectangleLink([600,550],400,sheet,sheet));
  assert.deepEqual(service.places('realm')[0].area,area,'resizing the scene never replaces the custom outline');
  const footprint=structuredClone(links.dale.footprint);edits={edits:{dale:{area:[[0,0],[1,0],[1,1]]}}};
  assert.deepEqual(service.places('realm')[0].area,edits.edits.dale.area);assert.deepEqual(links.dale.footprint,footprint,'redrawing a territory never resizes the scene');
  edits={edits:{dale:{scene:'manual'}}};assert.equal(service.places('realm')[0].regionalMapScene,undefined,'manual links retain precedence');
  edits={};game.scenes.clear();assert.equal((await handler.get(ref)).enter,null,'missing scenes do not leave an enter action');
  assert.deepEqual(base.area,area,'the source place was not mutated');
});

test('advanced alignment preserves scene coverage instead of copying the linked territory shape',async()=>{
  const sheet=homebrewSheet(1000,1000,1000),base={id:'dale-place',name:'Icewind Dale',kind:'territory',class:'Region',lon:0,lat:0,area:[[1,2],[3,4],[5,1]]};
  let links={dale:{world:'dale',parent:'realm',parentScene:'overview',scene:'detail',title:'Map of the Icewind Dale',outline:base.id,...rectangleLink([500,500],200,sheet,sheet)}};
  const before=structuredClone(links.dale.footprint),user={id:'gm',isGM:true,active:true},scene={id:'detail',name:'Icewind Dale',getFlag:()=> 'dale'};
  globalThis.game={user,users:[user],scenes:new Map([['overview',{id:'overview',name:'Realm'}]]),settings:{get:(_m,k)=>k==='regionalMaps'?links:'',set:async(_m,_k,v)=>links=v}};
  let dialogs=0;globalThis.foundry={utils:{escapeHTML:String},applications:{api:{DialogV2:{wait:async options=>{
    assert.equal(++dialogs,1,'a valid alignment should save in one dialog');
    assert.ok(!options.content.includes('name="outline"'));
    const fields={placeId:base.id};links.dale.anchors.forEach((a,i)=>['parent','region'].forEach(side=>a[side].forEach((v,j)=>fields[`${side}-${i}-${j}`]=v)));
    fields['region-1-0']=900;return fields;
  }}}}};
  globalThis.ui={notifications:{info(){},error:message=>{throw Error(message);}}};
  const service=new RegionalMaps({rawPlaces:w=>w==='realm'?[base]:[],getRoutes:async()=>({features:[]})});
  service.indexes={realm:{sourceMap:sheet},dale:{sourceMap:sheet}};service.prepare=async()=>{};service.load=async()=>{};
  await service.configureAdvanced(scene);
  assert.deepEqual(links.dale.footprint,before);assert.equal(links.dale.anchors[1].region[0],900);assert.equal(links.dale.placeId,base.id);assert.deepEqual(base.area,[[1,2],[3,4],[5,1]]);
});
