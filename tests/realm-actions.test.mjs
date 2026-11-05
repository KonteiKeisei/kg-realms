import test from 'node:test';
import assert from 'node:assert/strict';
import {registerWorld} from '../scripts/worlds.mjs';
import {registerHomebrew} from '../scripts/homebrew/homebrew.mjs';
import {RegionalMaps} from '../scripts/regional-service.mjs';

function fixture(generation=13){
  const handlers=new Map(),dialogs=[],settings={homebrewWorlds:{detail:{id:'detail',title:'Detailed map'}},regionalMaps:{detail:{parent:'companion-realm'}}};
  globalThis.Hooks={on:(name,fn)=>{const list=handlers.get(name)??[];list.push(fn);handlers.set(name,list);},once:()=>{}};
  globalThis.HTMLElement=class {};
  globalThis.foundry={utils:{deepClone:structuredClone,escapeHTML:String},applications:{api:{DialogV2:{wait:async d=>{dialogs.push(d);return null;}}}}};
  const scene=(id,flags)=>({id,getFlag:(_m,k)=>flags[k]});
  const scenes=new Map([
    ['realm',scene('realm',{world:'companion-realm'})],
    ['detail',scene('detail',{world:'detail'})],
    ['unlinked',scene('unlinked',{world:'unlinked-detail',regionalMap:true})],
    ['plain',scene('plain',{})]
  ]);
  globalThis.game={release:{generation},user:{isGM:true},modules:{get:()=>null},settings:{register:()=>{},get:(_m,k)=>settings[k]??{}},scenes};
  if(generation===14){const plain=scenes.get('plain');plain.initialLevel={id:'base',background:{src:'map.webp'}};plain.levels={size:1};Object.defineProperty(plain,'background',{get(){throw Error('Deprecated Scene background accessed');}});}
  registerWorld({id:'companion-realm',title:'Example Realm',module:'example-companion'});
  registerWorld({id:'unlinked-detail',title:'Unlinked detail',module:'kg-realms'});
  registerHomebrew();new RegionalMaps({}).init();
  const actions=[];for(const fn of handlers.get('getSceneContextOptions'))fn(null,actions);
  const entry=id=>{const el=new HTMLElement();el.dataset={entryId:id};return el;};
  return {actions,entry,dialogs,settings};
}

test('a companion realm exports through its scene menu without becoming a homebrew world',async()=>{
  const {actions,entry,dialogs,settings}=fixture();
  const exp=actions.find(a=>a.name==='Export as module');
  assert.equal(exp.condition(entry('realm')),true);
  assert.equal(exp.condition(entry('detail')),true);
  assert.equal(exp.condition(entry('plain')),false);
  assert.equal(actions.find(a=>a.name==='Realm world settings').condition(entry('realm')),false);
  await exp.callback(entry('realm'));
  assert.match(dialogs[0].content,/KG Realms: Example Realm/);
  assert.deepEqual(Object.keys(settings.homebrewWorlds),['detail']);
});

test('the V14 scene menu reads Level pictures and passes the selected scene through its native click handler',async()=>{
  const {actions,entry,dialogs}=fixture(14),make=actions.find(a=>a.label==='Make realm world');
  assert.equal(make.visible(entry('plain')),true);await make.onClick({type:'click'},entry('plain'));assert.equal(dialogs[0].window.title,'Make realm world');
  for(const action of actions)for(const key of ['condition','callback','name'])assert.equal(key in action,false);
});

test('Regional settings are available on linked or explicitly created detailed scenes, never the realm',()=>{
  const {actions,entry,settings}=fixture(),configure=actions.find(a=>a.name==='Regional map settings');
  assert.equal(configure.condition(entry('realm')),false);
  assert.equal(configure.condition(entry('detail')),true);
  assert.equal(configure.condition(entry('unlinked')),true);
  assert.equal(configure.condition(entry('plain')),false);
  settings.regionalMaps={};
  assert.equal(configure.condition(entry('realm')),false);
  assert.equal(configure.condition(entry('unlinked')),true,'cancelled parent placement can be resumed');
  game.user.isGM=false;
  assert.equal(configure.condition(entry('detail')),false);
  assert.equal(configure.condition(entry('unlinked')),false);
  assert.equal(actions.find(a=>a.name==='Export as module').condition(entry('realm')),false);
});
