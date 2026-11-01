const ID='kg-realms';
export const groupActor = token => {const a=token?.actor??token?.document?.actor;return a?.type==='group'&&!a.getFlag?.(ID,'party')?.retired;};
export const tokenDoc = token => token?.document ?? token;
export const partyMeta = actor => actor?.getFlag?.(ID,'party') ?? actor?.flags?.[ID]?.party ?? null;
export function groupMembers(actor) {
  const rows=actor?.system?.members;
  if(actor?.type!=='group'||!Array.isArray(rows))return [];
  return [...new Map(rows.map(row=>{let a=row?.actor??row;if(typeof a==='string')a=game.actors?.get(a.replace(/^Actor\./,''));return a?.id&&a.type!=='group'?[a.id,a]:null;}).filter(Boolean)).values()];
}
export function memberRows(actor) {
  const raw=actor?.toObject?.().system?.members??actor?._source?.system?.members;
  if(Array.isArray(raw))return raw.map(row=>typeof row==='string'?{actor:row}:{...row,actor:typeof row.actor==='string'?row.actor:row.actor?.id});
  return groupMembers(actor).map(a=>({actor:a.id}));
}
export function sceneParties(scene) {
  const seen=new Set();return Array.from(scene?.tokens??[]).filter(t=>{if(!groupActor(t)||partyMeta(t.actor)?.retired||seen.has(t.actor.id))return false;seen.add(t.actor.id);return true;}).sort((a,b)=>(partyMeta(a.actor)?.number??1)-(partyMeta(b.actor)?.number??1));
}
export function familyActors(actor) {
  const family=partyMeta(actor)?.family??actor.id;
  return Array.from(game.actors??[]).filter(a=>a.type==='group'&&!partyMeta(a)?.retired&&(a.id===family||partyMeta(a)?.family===family));
}
export function rosterStamp(actors) {return JSON.stringify(actors.map(a=>[a.id,memberRows(a),partyMeta(a)]));}
const views=new WeakMap();
/** Stable scene view for one party. All other document methods stay bound to the real scene. */
export function partyScene(scene, partyId) {
  if(!scene||!partyId)return scene;
  if(scene.partyId===partyId)return scene;
  const real=scene.realScene??scene,parties=sceneParties(real);
  if(!parties.some(t=>t.actor.id===partyId))return null;
  let cache=views.get(real);if(!cache){cache=new Map();views.set(real,cache);}if(cache.has(partyId))return cache.get(partyId);
  const path=`partyJourneys.${partyId}`;
  const proxy=new Proxy(real,{get(target,key){
    if(key==='realScene')return real;if(key==='partyId')return partyId;
    if(key==='getFlag')return(m,k)=>m===ID&&k==='journey'?(target.getFlag(ID,'partyJourneys')?.[partyId]??{}):m===ID&&k==='partyToken'?`Actor.${partyId}`:target.getFlag(m,k);
    if(key==='setFlag')return(m,k,v)=>target.setFlag(m,m===ID&&k==='journey'?path:k,v);
    if(key==='update')return(patch,options)=>target.update(Object.fromEntries(Object.entries(patch).map(([k,v])=>[k.replace(/^flags\.kg-realms\.journey(?=\.|$)/,`flags.${ID}.${path}`),v])),options);
    const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});cache.set(partyId,proxy);return proxy;
}
export function journeyScenes(scene) {
  if(scene?.partyId)return [scene];
  const parties=sceneParties(scene),stored=scene?.getFlag?.(ID,'partyJourneys');
  return stored&&parties.length?parties.map(t=>partyScene(scene,t.actor.id)):[scene];
}
export function selectedParty(scene, explicit=null) {
  const parties=sceneParties(scene);
  if(explicit)return parties.find(t=>t.actor.id===explicit||t.id===explicit)||null;
  const selected=globalThis.canvas?.scene?.id===scene?.id?(canvas.tokens?.controlled??[]).filter(groupActor):[];
  if(selected.length===1)return parties.find(t=>t.id===tokenDoc(selected[0]).id)??null;
  if(parties.length===1)return parties[0];
  if(parties.length>1)throw Error('Select one party token before choosing its destination.');
  return null;
}

export function focusedScene(scene) {
 if(!scene||!scene.getFlag?.(ID,'partyJourneys'))return scene;
 const parties=sceneParties(scene),focus=scene.getFlag(ID,'partyFocus'),id=parties.some(t=>t.actor.id===focus)?focus:parties[0]?.actor.id;
 return partyScene(scene,id)??scene;
}
export function partyLabel(scene) {const token=sceneParties(scene?.realScene??scene).find(t=>t.actor.id===scene?.partyId);return token?.name??'Party';}
