import {isHazard} from '../river-hazards.mjs';

const ACTOR='(?:Compendium\\.[\\w-]+\\.[\\w-]+\\.Actor\\.[A-Za-z0-9]{16}|Actor\\.[A-Za-z0-9]{16})';
const actorLink=new RegExp(`@UUID\\[${ACTOR}(?:\\.[^\\]]*)?\\](?:\\{([^}]*)\\})?`,'g');
const actorUuid=new RegExp(ACTOR,'g');

/** Remove actor attachments and actor links from an exported card, retaining their display text. */
export function cardForExport(record,{includeCardActors=true}={}){
  if(includeCardActors||!record)return structuredClone(record);
  const clean=value=>{
    if(typeof value==='string')return value.replace(actorLink,(_all,text)=>text??'').replace(actorUuid,'');
    if(Array.isArray(value))return value.map(clean);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clean(v)]));
    return value;
  };
  const {actor,actors,...rest}=structuredClone(record);
  for(const field of ['known','rumours','gmNotes','notes','summary','journal'])if(field in rest)rest[field]=clean(rest[field]);
  return rest;
}

export function presetForExport(preset,options){
  const out=structuredClone(preset);if(out?.places)out.places=out.places.map(p=>cardForExport(p,options));return out;
}

export function worldForExport(data,options){
  const out=structuredClone(data);
  out.places=(out.places??[]).map(p=>cardForExport(p,options));
  out.encounters=Object.fromEntries(Object.entries(out.encounters??{}).filter(([,e])=>options.includeTravel||isHazard(e)).map(([id,e])=>[id,cardForExport(e,options)]));
  if(out.regionalEdits)for(const key of ['edits','added'])out.regionalEdits[key]=Object.fromEntries(Object.entries(out.regionalEdits[key]??{}).map(([id,p])=>[id,cardForExport(p,options)]));
  return out;
}

export function journeyForExport(state,options){
  const out=structuredClone(state);if(out?.encounters)out.encounters=out.encounters.map(e=>cardForExport(e,options));return out;
}

/** Raw scene and journal IDs on travel cards are links too. */
export function travelLinks(scene){
  const own=scene.flags?.['kg-realms']??{},out=new Set();
  for(const state of [own.journey,...Object.values(own.partyJourneys??{})]){
    if(state?.trip?.log)out.add(`JournalEntry.${state.trip.log}`);
    for(const e of state?.encounters??[])if(e.scene)out.add(`Scene.${e.scene}`);
  }
  return [...out];
}
