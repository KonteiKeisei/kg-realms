import {test} from 'node:test';
import assert from 'node:assert/strict';
import {settlementEntrances, chooseSettlementGate, enterSettlement, gateTokenPosition, entranceType, settlementArrivalMode} from '../scripts/settlement-entry.mjs';
import {gmGame} from './helpers/journey.mjs';

const gate=(id,x=400,y=300,rec={})=>({id,x,y,getFlag:()=>({name:id,category:'gate',entry:false,...rec})});
const actor=id=>({id,uuid:`Actor.${id}`,documentName:'Actor',type:'group',name:id,async getTokenDocument(){return {toObject:()=>({actorId:id,name:id,width:2,height:1,texture:{src:`${id}.webp`}})};}});
const token=(id,a=null,name='Party')=>({id,uuid:`Scene.city.Token.${id}`,name,actor:a,actorId:a?.id,width:2,height:1,toObject(){return {_id:id,actorId:this.actorId,name:this.name,width:this.width,height:this.height,texture:{src:'party-art.webp'},flags:{custom:{keep:true}}};}});
function setup() {
  gmGame({actors:[],packs:new Map()});
  const notices=[];globalThis.ui={notifications:{warn:m=>notices.push(m)}};
  globalThis.foundry={utils:{escapeHTML:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')},applications:{api:{DialogV2:{}}}};
  globalThis.fromUuid=async()=>null;
  const scene={id:'city',name:'Neverwinter',grid:{size:100},dimensions:{sceneX:100,sceneY:100,sceneWidth:1000,sceneHeight:800},notes:[gate('west'),gate('east',1000,700)],tokens:[],updates:[],creates:[],activations:0,designation:'',getFlag(){return this.designation;},async setFlag(m,k,v){this.designation=v;},async updateEmbeddedDocuments(type,list){this.updates.push(...list);for(const u of list)Object.assign(this.tokens.find(t=>t.id===u._id),u);},async createEmbeddedDocuments(type,list){this.creates.push(...list);return list.map((data,i)=>{const t={...data,id:`new${this.tokens.length+i}`,uuid:`Scene.city.Token.new${this.tokens.length+i}`,actor:game.actors.find(a=>a.id===data.actorId)};this.tokens.push(t);return t;});},async activate(){this.activations++;}};
  const source={id:'realm',tokens:[token('source-default',actor('default-group'))],getFlag:()=>''};
  return {scene,source,notices};
}

test('entrances include gate categories and marked roads/docks, without choosing by approach',()=>{
  const {scene}=setup();scene.notes.push(gate('dock',500,600,{category:'harbour',entry:true}),gate('inn',200,200,{category:'inn'}));
  assert.deepEqual(settlementEntrances(scene).map(g=>g.id),['west','east','dock']);
  assert.deepEqual(gateTokenPosition(scene,scene.notes[0],{width:2,height:1}),{x:300,y:250});
  assert.deepEqual(gateTokenPosition(scene,{x:0,y:0},{width:2,height:1}),{x:100,y:100});
});

test('gate choice is primary-GM-only and requires an explicit result',async()=>{
  const {scene}=setup();let calls=0;
  foundry.applications.api.DialogV2.wait=async c=>{calls++;assert.match(c.content,/<option value="">Choose an entrance/);assert.equal(c.buttons[0].disabled,true);return {gate:'east'};};
  assert.equal(await chooseSettlementGate(scene),'east');
  game.user.isGM=false;assert.equal(await chooseSettlementGate(scene),null);assert.equal(calls,1);
  game.user.isGM=true;foundry.applications.api.DialogV2.wait=async()=>false;
  assert.equal(await chooseSettlementGate(scene),null);
});

test('a destination override moves only its existing party token at the chosen gate before activation',async()=>{
  const {scene,source}=setup(),a=actor('wardens'),b=actor('global'),pc=token('pc',actor('player'),'Player');
  scene.tokens=[token('party',a,'Wardens'),pc];scene.designation=a.uuid;
  source.tokens=[token('source',b)];
  assert.equal(await enterSettlement(scene,'east',{sourceScene:source,globalActor:b.uuid}),true);
  assert.equal(scene.creates.length,0);assert.deepEqual(scene.updates,[{_id:'party',x:900,y:650}]);
  assert.equal(pc.x,undefined);assert.equal(scene.activations,1);assert.equal(scene.designation,a.uuid);
});

test('a missing destination party token is copied from the main map with its artwork and dimensions',async()=>{
  const {scene,source}=setup(),a=actor('wardens');source.tokens=[token('source',a,'Forge Wardens')];
  await enterSettlement(scene,'west',{sourceScene:source,globalActor:a.uuid});
  assert.equal(scene.creates.length,1);const created=scene.creates[0];
  assert.equal(created.actorId,a.id);assert.equal(created._id,undefined);assert.equal(created.texture.src,'party-art.webp');
  assert.deepEqual(created.flags,{custom:{keep:true}});assert.equal(created.x,300);assert.equal(created.y,250);
  assert.equal(scene.designation,scene.tokens[0].uuid);assert.equal(source.tokens.length,1,'the main-map token remains');
});

test('individual character tokens cannot substitute for the required group actor',async()=>{
  const {scene,source}=setup();source.tokens=[token('pc',{...actor('player'),type:'character'},'Haldak')];scene.tokens=[token('pc2',{...actor('other'),type:'character'},'Kavu')];
  assert.equal(await enterSettlement(scene,'west',{sourceScene:source}),false);assert.equal(scene.creates.length,0);assert.equal(scene.activations,0);
});

test('a designated sidebar actor can create a party token even when it has no token on the main map',async()=>{
  const {scene,source}=setup(),a=actor('wardens');game.actors.push(a);fromUuid=async uuid=>uuid===a.uuid?a:null;
  await enterSettlement(scene,'east',{sourceScene:source,globalActor:a.uuid});
  assert.equal(scene.creates[0].actorId,'wardens');assert.equal(scene.creates[0].x,900);
});

test('compendium designations reuse an imported world actor or import it once before placement',async()=>{
  const {scene,source}=setup(),comp={...actor('packactor'),pack:'world.party',uuid:'Compendium.world.party.Actor.packactor'};
  const world={...actor('imported'),_stats:{compendiumSource:comp.uuid}};game.actors.push(world);fromUuid=async()=>comp;
  await enterSettlement(scene,'west',{sourceScene:source,globalActor:comp.uuid});
  assert.equal(scene.creates[0].actorId,'imported');
  const next=setup();let imports=0;fromUuid=async()=>comp;game.actors.importFromCompendium=async()=>{imports++;return world;};
  await enterSettlement(next.scene,'west',{sourceScene:next.source,globalActor:comp.uuid});
  assert.equal(imports,1);assert.equal(next.scene.creates[0].actorId,'imported');
});

test('missing entrances and lost authority cannot activate or place tokens',async()=>{
  const {scene,source,notices}=setup();
  assert.equal(await enterSettlement(scene,'deleted',{sourceScene:source}),false);assert.equal(notices.length,1);
  game.user.active=false;assert.equal(await enterSettlement(scene,'west',{sourceScene:source}),false);
  assert.equal(scene.activations,0);assert.equal(scene.creates.length,0);
});

test('a gate deleted while resolving an actor does not place a token at its old location',async()=>{
  const {scene,source}=setup();fromUuid=async()=>{scene.notes=[];return actor('party');};
  assert.equal(await enterSettlement(scene,'west',{sourceScene:source,globalActor:'Actor.party'}),false);
  assert.equal(scene.creates.length,0);assert.equal(scene.activations,0);
});

test('concurrent entry clicks cannot create duplicate party tokens',async()=>{
  const {scene,source}=setup();await Promise.all([enterSettlement(scene,'west',{sourceScene:source}),enterSettlement(scene,'west',{sourceScene:source})]);
  assert.equal(scene.creates.length,1);assert.equal(scene.activations,1);
});

test('a stale scene designation is repaired when a new party marker is placed',async()=>{
  const {scene,source}=setup();scene.designation='Scene.city.Token.deleted';
  await enterSettlement(scene,'west',{sourceScene:source});assert.equal(scene.designation,scene.tokens[0].uuid);
});


test('land and sea entrances are separate and a river landmark is not automatically a dock',()=>{
  const {scene}=setup();scene.notes.push(gate('dock',500,600,{category:'harbour',entry:true}),gate('river',500,200,{category:'harbour'}));
  assert.deepEqual(settlementEntrances(scene,{arrival:'land'}).map(g=>g.id),['west','east']);
  assert.deepEqual(settlementEntrances(scene,{arrival:'sea'}).map(g=>g.id),['dock']);
  assert.equal(entranceType({category:'other',entry:true,entryType:'dock'}),'dock');
  assert.equal(entranceType({category:'harbour',entry:true,entryType:'land'}),'land');
  assert.equal(entranceType({category:'other',entry:false,entryType:'dock'}),null);
});

test('a single sea dock skips the picker, but a sea arrival cannot fall back to a gate',async()=>{
  const {scene,source,notices}=setup();foundry.applications.api.DialogV2.wait=async()=>{throw Error('Unnecessary picker');};
  assert.equal(await chooseSettlementGate(scene,{arrival:'sea'}),null);assert.match(notices[0],/no dock entrances/);
  scene.notes.push(gate('dock',500,600,{category:'harbour',entry:true}));
  assert.equal(await chooseSettlementGate(scene,{arrival:'sea'}),'dock');
  assert.equal(await enterSettlement(scene,'west',{arrival:'sea'}),false);assert.equal(scene.activations,0);
  assert.equal(await enterSettlement(scene,'dock',{sourceScene:source,arrival:'sea'}),true);assert.equal(scene.creates[0].x,400);
});

test('multiple docks require a GM choice and visibly identify private options',async()=>{
  const {scene}=setup();scene.notes.push(gate('private <dock>',500,600,{category:'harbour',entry:true,privateEntry:true}),gate('public',600,600,{category:'harbour',entry:true}));
  foundry.applications.api.DialogV2.wait=async c=>{
    assert.match(c.content,/private &lt;dock>/);assert.match(c.content,/\(Private\)/);assert.match(c.content,/Entry may be prohibited/);assert.doesNotMatch(c.content,/<option value="west"/);
    let change;const warning={hidden:true},button={disabled:true},select={value:'private <dock>',addEventListener:(event,fn)=>change=fn};
    c.render(null,{element:{querySelector:q=>q.startsWith('select')?select:q==='[data-private-entry]'?warning:button}});
    change();assert.equal(warning.hidden,false);assert.equal(button.disabled,false);select.value='public';change();assert.equal(warning.hidden,true);
    return {gate:'public'};
  };
  assert.equal(await chooseSettlementGate(scene,{arrival:'sea'}),'public');
});

test('a private gate or a sole private dock needs permission before tokens or scenes change',async()=>{
  for(const arrival of ['land','sea']){
    const {scene,source}=setup();scene.notes=[gate('private',400,300,{category:arrival==='sea'?'harbour':'gate',entry:true,privateEntry:true})];let warnings=0;
    foundry.applications.api.DialogV2.confirm=async c=>{warnings++;assert.match(c.content,/private/);return false;};
    assert.equal(await enterSettlement(scene,'private',{sourceScene:source,arrival}),false);assert.equal(scene.creates.length,0);assert.equal(scene.activations,0);
    foundry.applications.api.DialogV2.confirm=async()=>{warnings++;return true;};
    assert.equal(await enterSettlement(scene,'private',{sourceScene:source,arrival}),true);assert.equal(warnings,2);assert.equal(scene.activations,1);
  }
});

test('entry revalidates private status, dock type and authority across asynchronous resolution',async()=>{
  let f=setup();fromUuid=async()=>{f.scene.notes[0]=gate('west',400,300,{privateEntry:true});return actor('party');};let warned=0;
  foundry.applications.api.DialogV2.confirm=async()=>{warned++;return false;};
  assert.equal(await enterSettlement(f.scene,'west',{globalActor:'Actor.party'}),false);assert.equal(warned,1);assert.equal(f.scene.creates.length,0);
  f=setup();f.scene.notes=[gate('dock',400,300,{entry:true,category:'harbour',privateEntry:true})];
  foundry.applications.api.DialogV2.confirm=async()=>{f.scene.notes=[];return true;};
  assert.equal(await enterSettlement(f.scene,'dock',{arrival:'sea'}),false);assert.equal(f.scene.creates.length,0);
  f=setup();f.scene.notes=[gate('private',400,300,{privateEntry:true})];foundry.applications.api.DialogV2.confirm=async()=>{game.user.active=false;return true;};
  assert.equal(await enterSettlement(f.scene,'private'),false);assert.equal(f.scene.activations,0);
});

test('sea arrival follows the incoming vessel leg, including rowboats and mixed journeys',()=>{
  const result={legs:[{start:0,hours:2,sea:true,crewed:false},{start:2,hours:3,sea:false},{start:5,hours:4,sea:true}]};
  for(const hour of [1,2,6,9])assert.equal(settlementArrivalMode(result,hour),'sea');
  for(const hour of [2.1,5])assert.equal(settlementArrivalMode(result,hour),'land');
  assert.equal(settlementArrivalMode({track:[{hour:0,kind:'river'},{hour:1}]},1),'sea');
  assert.equal(settlementArrivalMode({legs:[{start:0,hours:2,sea:false,seaFailed:true}]},1),'land');
});


test('a dock removed while preparing a new token cannot activate the scene',async()=>{
 const {scene}=setup();scene.notes=[gate('dock',400,300,{category:'harbour',entry:true})];
 const a=actor('party');a.getTokenDocument=async()=>{scene.notes=[];return{toObject:()=>({width:1,height:1})};};fromUuid=async()=>a;
 assert.equal(await enterSettlement(scene,'dock',{arrival:'sea',globalActor:'Actor.party'}),false);assert.equal(scene.creates.length,0);assert.equal(scene.activations,0);
});

test('a split party arrives with its own group actor instead of moving the city override for another party',async()=>{
 const {scene,source}=setup(),one=actor('one'),two=actor('two');scene.tokens=[token('existing-one',one)];scene.designation=one.uuid;
 source.partyId=two.id;source.tokens=[token('source-two',two)];
 assert.equal(await enterSettlement(scene,'west',{sourceScene:source,globalActor:one.uuid}),true);assert.equal(scene.creates.length,1);assert.equal(scene.creates[0].actorId,two.id);assert.equal(scene.updates.length,0);
});
