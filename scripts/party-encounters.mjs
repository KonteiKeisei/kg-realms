import {writeJourney} from './journey-write.mjs';
import {journeyKey} from './journey-state.mjs';
import {isPrimaryGM} from './authority.mjs';
export async function bypassPartyEncounter(scene,encounter,reason,{now=game.time.worldTime,trip=journeyKey(scene.getFlag('kg-realms','journey'))}={}){
 reason=String(reason??'').trim();if(!reason)throw Error('Write a resolution reason before bypassing the encounter.');if(!isPrimaryGM())return false;
 let applied=false;
 await writeJourney(scene,fresh=>{
  if(fresh.now?.status!=='encounter'||fresh.now.encounter?.id!==encounter.id)return null;
  applied=true;return{[`trip.resumed.${encounter.id}`]:now,'trip.bypassedEncounters':[...(fresh.trip?.bypassedEncounters??[]),{id:encounter.id,name:encounter.name,at:now,reason}]};
 },{trip});return applied;
}
