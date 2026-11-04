import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneEditorTools} from '../scripts/scene-tools.mjs';

test('GM can configure an ordinary scene before conversion, and edit realm, Regional and local maps from Token Controls',()=>{
  for(const kind of ['ordinary','realm','regional','local']){
    const native={name:'select'},controls={tokens:{tools:{select:native}}},scene={id:kind};let opened,editing;
    sceneEditorTools(controls,{scene,isGM:true,realm:['realm','regional'].includes(kind),local:kind==='local',configure:s=>opened=s,edit:on=>editing=on});
    controls.tokens.tools.kgRealmsSceneConfig.onChange();assert.equal(opened,scene);assert.equal(controls.tokens.tools.select,native);
    if(kind==='ordinary')assert.equal(controls.tokens.tools.kgRealmsEditor,undefined);
    else{controls.tokens.tools.kgRealmsEditor.onChange({},true);assert.equal(editing,true);assert.match(controls.tokens.tools.kgRealmsEditor.title,/Map editor/);}
    assert.equal(controls.tokens.tools.kgRealmsRegions,undefined);
  }
});
test('players do not receive GM editing or scene configuration tools',()=>{
  const controls={tokens:{tools:{}}};sceneEditorTools(controls,{scene:{id:'realm'},isGM:false,realm:true});assert.deepEqual(controls.tokens.tools,{});
});
