import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneBehaviorRequirements,mergedPackageRequirements,assertSceneBehaviors,moduleSceneFolderPath} from '../scripts/scene-package-support.mjs';
import {sceneForExport} from '../scripts/homebrew/export-plan.mjs';

test('a folder migration marker is local to its installation and is not inherited by a re-export',()=>{
  const source={_id:'scene',name:'Place',folder:'source-folder',flags:{'kg-realms':{moduleFolder:{module:'same-package',revision:1}}}},before=structuredClone(source);
  const exported=sceneForExport(source,'realm');assert.equal(exported.folder,undefined);assert.equal(exported.flags['kg-realms'].moduleFolder,undefined);assert.deepEqual(source,before);
});

test('Region behavior providers become explicit companion requirements, including disabled behaviors',()=>{
  const scenes=[{regions:[{behaviors:[{type:'fxmaster.filterEffectsRegion'},{type:'indy-fx.indyFX',disabled:true},{type:'teleportToken'},{type:'dnd5e.example'},{type:'fxmaster.filterEffectsRegion'}]}]}];
  const before=structuredClone(scenes),modules=new Map([['fxmaster',{manifest:'https://example.test/fxmaster/module.json'}]]);
  assert.deepEqual(sceneBehaviorRequirements(scenes,{modules,systemId:'dnd5e'}),[{id:'fxmaster',type:'module',manifest:'https://example.test/fxmaster/module.json'},{id:'indy-fx',type:'module'}]);
  assert.deepEqual(scenes,before);
  assert.deepEqual(mergedPackageRequirements([{relationships:{requires:[{id:'kg-realms'}]}},{relationships:{requires:[{id:'kg-realms'},{id:'indy-fx'}]}}]),[{id:'kg-realms'},{id:'indy-fx'}]);
});

test('unsupported Region behavior errors identify the scene, region and provider without removing data',()=>{
  const scene={name:'Harbor',regions:[{_id:'river',name:'River',behaviors:[{type:'indy-fx.indyFX',disabled:true},{type:'teleportToken'}]}]},before=structuredClone(scene);
  assert.throws(()=>assertSceneBehaviors(scene,{teleportToken:class{}}),error=>/Harbor/.test(error.message)&&/River/.test(error.message)&&/indy-fx/.test(error.message)&&/reload/.test(error.message));
  assert.doesNotThrow(()=>assertSceneBehaviors(scene,{teleportToken:class{},'indy-fx.indyFX':class{}}));
  assert.deepEqual(scene,before);
});

test('folder paths keep realm overviews at root and group towns with every linked interior',()=>{
  const nodes=[{id:'realm',kind:'realm',name:'Realm'},{id:'regional',kind:'regional',name:'North',parent:'realm'},{id:'city',kind:'local',name:'Town',parent:'regional'},{id:'inn',kind:'scene',name:'Inn',parent:'city'},{id:'cellar',kind:'local',name:'Cellar',parent:'inn'},{id:'cave',kind:'scene',name:'Cave',parent:'regional'},{id:'room',kind:'scene',name:'Room',parent:'cave'}];
  assert.deepEqual(moduleSceneFolderPath(nodes,nodes[0]),[]);
  assert.deepEqual(moduleSceneFolderPath(nodes,nodes[1]),['Regional Maps']);
  for(const node of nodes.slice(2,5))assert.deepEqual(moduleSceneFolderPath(nodes,node),['Places','Town']);
  assert.deepEqual(moduleSceneFolderPath(nodes,nodes[6]),['Places','Cave']);
});
