import "./helpers/worlds.mjs";
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LocalMaps} from '../scripts/local-maps.mjs';

test('preset refresh retires pending entries and fills only blank placed cards',async()=>{
  const previous={game:globalThis.game,foundry:globalThis.foundry,fetch:globalThis.fetch};
  const preset={name:'City',placeId:'city',places:[{name:'Blank',x:100,y:100,known:'Wiki text',summary:'Wiki summary'},{name:'Written',x:200,y:200,known:'Default replacement'}],unplaced:[],retired:['Removed']};
  const note=(id,rec)=>({id,x:10,y:20,getFlag:()=>rec});
  const blank=note('blank',{name:'Blank',known:'',summary:'',gmNotes:'Private detail'}),written=note('written',{name:'Written',known:'GM text'});
  const scene={name:'City',notes:[blank,written],updates:[],map:{presetRevision:4,unplaced:[{name:'Removed'},{name:'Custom pending',known:'My text'}]},getFlag(){return this.map;},async setFlag(m,k,v){this.map=v;},async updateEmbeddedDocuments(t,rows){this.updates.push(...rows);}};
  try{
    globalThis.game={user:{isGM:true}};
    globalThis.foundry={utils:{getRoute:p=>p}};
    globalThis.fetch=async()=>({json:async()=>preset});
    const maps=new LocalMaps({getRealmPlaces:async()=>[]});maps.ensureEntrance=async()=>{};
    await maps.applyPreset({file:'city.json',revision:5},{scene});
    assert.deepEqual(scene.updates,[{_id:'blank','flags.kg-realms.local.known':'Wiki text','flags.kg-realms.local.summary':'Wiki summary'}]);
    assert.deepEqual(scene.map.unplaced,[{name:'Custom pending',known:'My text'}]);
    assert.equal(scene.map.presetRevision,5);
    assert.equal(blank.x,10);assert.equal(written.x,10);
  } finally {Object.assign(globalThis,previous);}
});
