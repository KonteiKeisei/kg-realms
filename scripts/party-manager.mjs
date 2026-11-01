import {isPrimaryGM} from './authority.mjs';
import {familyActors,memberRows,partyMeta,rosterStamp,sceneParties} from './party-groups.mjs';
const ID='kg-realms',locks=new Map();
const clone=value=>foundry.utils.deepClone(value);
const meta=(family,baseName,number,generated=false)=>({family,baseName,number,generated});
const name=(base,n,count)=>count>1?`${base} ${n}`:base;
export class PartyManager {
 constructor({busy=()=>false,changed=()=>{},before=null,stopTravel=null,isRealm=null}={}){Object.assign(this,{busy,changed,before,stopTravel,isRealm});}
 async commit({scene,left,right=null,rightIds,stamp,extra=[]}){
  if(!isPrimaryGM())throw Error('Only the primary GM can split or merge parties.');
  const a=left.actor;if(a?.type!=='group'||(right&&right.actor?.type!=='group'))throw Error('Party tokens must use group actors.');
  const family=partyMeta(a)?.family??a.id;
  if(locks.has(family))throw Error('This party is already being changed.');
  const task=this.perform({scene,left,right,rightIds,stamp,family,extra});locks.set(family,task);try{return await task;}finally{locks.delete(family);}
 }
 async perform({scene,left,right,rightIds,stamp,family,extra}){
  await this.before?.(scene);
  const actors=familyActors(left.actor),root=game.actors.get(family)??left.actor;
  if(game.actors.get(left.actor.id)!==left.actor)throw Error('Link this party token to its world group actor before splitting.');
  if([...(right?[right]:[]),...extra].some(t=>!actors.includes(t.actor)))throw Error('Merge tokens from the same party family.');
  if(rosterStamp(actors)!==stamp)throw Error('Party membership changed. Reopen the split or merge window.');
  // A party mid settlement trip: the trip stops where it is (0.70), rather than the split being refused.
  for(const a of actors)if(this.busy(a.id)){if(!this.stopTravel)throw Error('Stop settlement travel before changing party membership.');await this.stopTravel(a.id);}
  if(actors.some(a=>this.busy(a.id)))throw Error('The settlement trip could not be stopped. Try again.');
  // A camp or encounter on a realm map only holds a split made on that map itself. Split anywhere else
  // (a settlement, an encounter scene), the realm map journey is paused meanwhile and stays with the
  // party that travelled on; the parties split from it join it there when the table returns.
  for(const s of game.scenes){if(this.isRealm&&s!==scene&&s!==scene.realScene)continue;const j=s.getFlag(ID,'journey'),js=s.getFlag(ID,'partyJourneys')??{};for(const a of actors){const p=js[a.id]??(a===root?j:null);if(p?.trip&&['resting','encounter'].includes(p.now?.status)&&p.watch?.scene?.step!=='done')throw Error('Resolve the encounter or finish this camp before changing its party.');}}
  const pool=[...memberRows(left.actor),...(right?memberRows(right.actor):[]),...extra.flatMap(t=>memberRows(t.actor))],byId=new Map(pool.map(r=>[r.actor,r]));
  if(byId.size!==pool.length)throw Error('A character appears in both groups. Fix the group memberships first.');
  const ids=[...new Set(rightIds)];if(ids.some(id=>!byId.has(id)))throw Error('Only current members of these groups can be moved.');
  let rRows=ids.map(id=>byId.get(id)),lRows=pool.filter(row=>!ids.includes(row.actor));
  if(!right&&(!lRows.length||!rRows.length))throw Error('Leave at least one member in each party.');
  if(!lRows.length&&!rRows.length)throw Error('A party needs at least one member.');
  // Keep the original group when consolidating completely into its split counterpart.
  let a=left.actor,b=right?.actor,leftToken=left,rightToken=right;
  if(b===root){[a,b]=[b,a];[lRows,rRows]=[rRows,lRows];[leftToken,rightToken]=[rightToken,leftToken];}
  if(!lRows.length&&a===root)[lRows,rRows]=[rRows,lRows];
  const base=partyMeta(root)?.baseName??left.name??root.name,number=Math.max(1,...actors.map(x=>partyMeta(x)?.number??1))+1;
  const snapshots=actors.map(x=>({_id:x.id,name:x.name,'system.members':memberRows(x),[`flags.${ID}.party`]:clone(partyMeta(x))}));
  let createdActor,createdToken,updatesApplied=false;const oldNames=[],removedTokens=[];
  try{
   if(!b&&rRows.length){
    const proto=clone(a.prototypeToken?.toObject?.()??a.toObject().prototypeToken??{});delete proto._id;
    createdActor=b=await Actor.create({name:`${base} ${number}`,type:'group',img:a.img,folder:a.folder?.id??null,ownership:clone(a.ownership),prototypeToken:{...proto,actorLink:true,name:`${base} ${number}`},system:{members:rRows},flags:{[ID]:{party:meta(family,base,number,true)}}},{renderSheet:false});
    const data=clone(leftToken.toObject());delete data._id;delete data._stats;delete data.delta;
    Object.assign(data,{actorId:b.id,actorLink:true,name:`${base} ${number}`,x:leftToken.x+scene.grid.size*(leftToken.width??1)+12,y:leftToken.y});
    const d=scene.dimensions;data.x=Math.min(d.sceneX+d.sceneWidth-(data.width??1)*scene.grid.size,Math.max(d.sceneX,data.x));
    data.flags={...(data.flags??{}),[ID]:{...(data.flags?.[ID]??{}),partyFamily:family}};
    [createdToken]=await scene.createEmbeddedDocuments('Token',[data]);if(!createdToken)throw Error('The split party token could not be placed.');
   }
   if(!isPrimaryGM()||rosterStamp(actors)!==stamp)throw Error('Party membership or GM authority changed before saving.');
   const survivors=actors.filter(x=>x!==a&&x!==b&&!extra.some(t=>t.actor.id===x.id)).concat(lRows.length?[a]:[],rRows.length?[b]:[]),count=survivors.length;
   const updates=[{_id:a.id,'system.members':lRows,[`flags.${ID}.party`]:meta(family,base,partyMeta(a)?.number??1,a!==root)}];
   if(b)updates.push({_id:b.id,'system.members':rRows,[`flags.${ID}.party`]:partyMeta(b)??meta(family,base,number,b!==root)});
   for(const t of extra)updates.push({_id:t.actor.id,'system.members':[]});
   for(const x of survivors){let u=updates.find(u=>u._id===x.id);if(!u){u={_id:x.id};updates.push(u);}u.name=name(base,partyMeta(x)?.number??1,count);}
   updatesApplied=true;await Actor.updateDocuments(updates);
   // Move the legacy single journey into the original party slot, retaining all existing decisions.
   for(const s of game.scenes){
    const tokens=Array.from(s.tokens??[]).filter(t=>actors.some(x=>x.id===t.actorId)||t.actorId===createdActor?.id);if(!tokens.length)continue;
    const old=s.getFlag(ID,'journey'),stored=s.getFlag(ID,'partyJourneys');
    if(!stored&&tokens.some(t=>t.actorId===root.id))await s.setFlag(ID,`partyJourneys.${root.id}`,clone(old??{}));
    for(const token of tokens)oldNames.push({scene:s,id:token.id,name:token.name});
    const tokenUpdates=tokens.filter(t=>survivors.some(x=>x.id===t.actorId)).map(t=>({_id:t.id,name:name(base,partyMeta(t.actor)?.number??(t.actorId===createdActor?.id?number:1),count)}));
    if(tokenUpdates.length)await s.updateEmbeddedDocuments('Token',tokenUpdates,{kgRealmsParty:true});
   }
   const empty=[!lRows.length?a:null,!rRows.length?b:null,...extra.map(t=>t.actor)].filter(Boolean);
   for(const x of empty){
    if(x===root)throw Error('The original party cannot be removed.');
    for(const s of game.scenes){const tokens=Array.from(s.tokens??[]).filter(t=>t.actorId===x.id);if(tokens.length){removedTokens.push(...tokens.map(t=>({scene:s,data:{...t.toObject(),_id:t.id}})));await s.deleteEmbeddedDocuments('Token',tokens.map(t=>t.id));}if(s.getFlag(ID,'partyFocus')===x.id)await s.setFlag(ID,'partyFocus',root.id);}
    // Keep the empty actor as an archive: pooled items and currency must never be deleted by a merge.
    await Actor.updateDocuments([{_id:x.id,[`flags.${ID}.party`]:{...partyMeta(x),retired:true},name:`${base} ${partyMeta(x)?.number??2} (merged)`}]);
   }
   await Promise.resolve(this.changed(scene)).catch(error=>console.warn('kg-realms | Party display refresh:',error));
   for(const x of empty){
    const data=x.toObject(),hasInventory=(data.items?.length??0)>0||Object.values(x.system?.currency??{}).some(n=>Number(n)>0)||(data.effects?.length??0)>0||!!x.system?.primaryVehicle;
    if(partyMeta(x)?.generated&&!hasInventory)try{await x.delete();}catch(error){console.warn('kg-realms | Empty merged group retained:',error);}
    else if(hasInventory)ui.notifications.info(`KG Realms: pooled items or currency remain on ${x.name} in the Actors sidebar.`);
   }
   return{actor:b,token:createdToken};
  }catch(error){
   const problems=[];
   for(const saved of removedTokens)try{if(!Array.from(saved.scene.tokens??[]).some(t=>t.id===saved.data._id))await saved.scene.createEmbeddedDocuments('Token',[saved.data],{keepId:true});}catch(e){problems.push(e.message);}
   if(updatesApplied)try{await Actor.updateDocuments(snapshots);}catch(e){problems.push(e.message);}
   if(createdToken)try{await scene.deleteEmbeddedDocuments('Token',[createdToken.id]);}catch(e){problems.push(e.message);}
   if(createdActor)try{await createdActor.delete();}catch(e){problems.push(e.message);}
   for(const n of oldNames)try{if(!Array.from(n.scene.tokens??[]).some(t=>t.id===n.id))continue;await n.scene.updateEmbeddedDocuments('Token',[{_id:n.id,name:n.name}],{kgRealmsParty:true});}catch(e){problems.push(e.message);}
   if(problems.length)throw Error(`${error.message} Some changes could not be restored: ${problems.join('; ')}. Review the group rosters before continuing.`);
   throw error;
  }
 }
}
