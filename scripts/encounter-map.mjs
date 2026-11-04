import {partyScene} from './party-groups.mjs';

const PREFIX='journey-encounter:';
export const privateEncounterId=id=>typeof id==='string'&&(id.startsWith(PREFIX)||id.startsWith('encounter:'));
export function journeyEncounterKey(scene,id){
  return PREFIX+encodeURIComponent(JSON.stringify({kind:'journey',scene:scene.id,partyId:scene.partyId??null,id}));
}
export function journeyEncounterRef(key){
  if(typeof key!=='string'||!key.startsWith(PREFIX))return null;
  try{const ref=JSON.parse(decodeURIComponent(key.slice(PREFIX.length)));return ref?.kind==='journey'&&typeof ref.scene==='string'&&typeof ref.id==='string'&&(ref.partyId==null||typeof ref.partyId==='string')?ref:null;}catch{return null;}
}
export function encounterPreview(e,id,cardRef){
  return {...e,id,cardRef,gmOnly:true,class:'Encounter',kind:'encounter',hidden:false,known:e.known??e.notes??'',summary:e.notes??''};
}
export function journeyEncounterPreview(key){
  if(!globalThis.game?.user?.isGM)return null;
  const ref=journeyEncounterRef(key);if(!ref)return null;
  const e=partyScene(game.scenes.get(ref.scene),ref.partyId)?.getFlag('kg-realms','journey')?.encounters?.find(e=>e.id===ref.id);
  return e?encounterPreview(e,key,ref):null;
}
