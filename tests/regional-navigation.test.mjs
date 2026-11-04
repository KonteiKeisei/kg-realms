import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalMaps} from '../scripts/local-maps.mjs';
const scene=(id,name,flags={})=>({id,name,getFlag:(_m,k)=>flags[k]??null});
test('regional scenes join the existing top navigation trail between realm and settlement',()=>{
  const realm=scene('realm','Faerun'),region=scene('region','Icewind Dale'),town=scene('town','Bryn Shander',{localMap:{world:'dale',placeId:'bryn',name:'Bryn Shander'}});
  const maps=Object.create(LocalMaps.prototype);maps.regionalParent=s=>s===region?{to:realm,focus:null}:null;maps.realmSceneFor=id=>id==='dale'?region:null;
  assert.deepEqual(maps.trail(region).map(s=>s.label),['Faerun','Icewind Dale']);
  assert.deepEqual(maps.trail(town).map(s=>s.label),['Faerun','Icewind Dale','Bryn Shander']);
  assert.deepEqual(maps.trail(realm).map(s=>s.label),['Faerun']);
});
test('regional navigation retains GM-only activation and the view-only back action',async()=>{
  let viewed=0,activated=0;const realm={id:'realm',view:async()=>viewed++,activate:async()=>activated++},maps=Object.create(LocalMaps.prototype);
  globalThis.game={user:{isGM:true}};await maps.navigateTrail({scene:realm,focus:null},{viewOnly:true});assert.equal(viewed,1);assert.equal(activated,0);
  await maps.navigateTrail({scene:realm,focus:null});assert.equal(activated,1);
  game.user.isGM=false;await maps.navigateTrail({scene:realm},{viewOnly:true});assert.equal(viewed,1);
});
