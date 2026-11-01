import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EncounterBox} from '../scripts/ui-encounter-box.mjs';
test('encounter box accepts a Foundry scene collection without Array.flatMap',()=>{
 const old={game:globalThis.game,canvas:globalThis.canvas};
 try{
  const realm={tokens:[],getFlag:(m,k)=>k==='journey'?{now:{status:'encounter',encounter:{id:'meeting'}},encounters:[{id:'meeting',name:'Meeting',scene:'city'}]}:null};
  const scenes=new Map([['realm',realm]]);scenes[Symbol.iterator]=function*(){yield* this.values();};
  globalThis.game={user:{isGM:true},scenes};globalThis.canvas={scene:{id:'elsewhere'}};
  const box=new EncounterBox({worldEncounters:()=>({})});assert.doesNotThrow(()=>box.refresh());assert.equal(box.el,null);
 }finally{Object.assign(globalThis,old);}
});
