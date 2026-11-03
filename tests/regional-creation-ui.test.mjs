import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHomebrew} from '../scripts/homebrew/homebrew.mjs';

test('scene actions open regional-specific creation and settings dialogs without entering the tile build on cancel',async()=>{
  const handlers=new Map(),dialogs=[];
  globalThis.Hooks={on:(name,fn)=>handlers.set(name,fn),once:()=>{}};
  globalThis.HTMLElement=class {};
  globalThis.foundry={utils:{deepClone:structuredClone,escapeHTML:String},applications:{api:{DialogV2:{wait:async options=>{dialogs.push(options);return null;}}}}};
  const def={id:'regional-dialog-test',scene:'made',title:'Icewind Dale',miles:440},settings={homebrewWorlds:{[def.id]:def},regionalMaps:{[def.id]:{parent:'realm'}}};
  const made={id:'made',getFlag:(_m,k)=>k==='world'?def.id:null},picture={id:'picture',name:'Map of Icewind Dale',width:1000,grid:{},background:{src:'map.webp'},getFlag:()=>null};
  globalThis.game={user:{isGM:true},settings:{register:()=>{},get:(_m,k)=>settings[k]??{}},scenes:new Map([['made',made],['picture',picture]])};
  const entry=id=>{const el=new HTMLElement();el.dataset={entryId:id};return el;};
  registerHomebrew();const actions=[];handlers.get('getSceneContextOptions')(null,actions);
  await actions.find(a=>a.name==='Make regional map').callback(entry('picture'));
  assert.equal(dialogs[0].window.title,'Make regional map');assert.match(dialogs[0].content,/Regional map name/);assert.match(dialogs[0].content,/choose its parent realm and coverage outline/);assert.equal(dialogs[0].buttons[0].label,'Build regional map');
  await actions.find(a=>a.name==='Realm world settings').callback(entry('made'));
  assert.match(dialogs[1].content,/Regional map name/);
  settings.regionalMaps={};
  await actions.find(a=>a.name==='Realm world settings').callback(entry('made'));
  assert.match(dialogs[2].content,/World name/);
});
