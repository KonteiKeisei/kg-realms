import { test } from "node:test";
import assert from "node:assert/strict";
import { selectPartyTokens, partyReference } from "../scripts/party-token.mjs";

const token=(id,actor={},name="Group")=>({document:{id,name,uuid:`Scene.map.Token.${id}`,actorId:actor.id},actor:{type:"group",...actor}});
const scene=(ref="")=>({id:"map",getFlag:()=>ref});

test("scene token and actor overrides precede the global actor, then automatic lookup",()=>{
  const a=token("a",{id:"world",uuid:"Actor.world"}),b=token("b",{id:"other",uuid:"Actor.other"}),named=token("named",{},"Party Token");
  const all=[a,b,named];
  assert.deepEqual(selectPartyTokens(scene(b.document.uuid),all,"Actor.world"),[b]);
  assert.deepEqual(selectPartyTokens(scene("Actor.other"),all,"Actor.world"),[b]);
  assert.deepEqual(selectPartyTokens(scene("Scene.map.Token.deleted"),all,"Actor.world"),[a]);
  assert.deepEqual(selectPartyTokens(scene(),all,"Actor.deleted"),[named]);
  const owned=token("owned",{hasPlayerOwner:true,type:"character"});
  assert.deepEqual(selectPartyTokens(scene(),[a,owned]),[a]);
});

test("a compendium designation matches imported actor sources without importing another actor",()=>{
  const uuid="Compendium.world.party.Actor.party",a=token("a",{id:"imported",_stats:{compendiumSource:uuid}});
  const b=token("b",{id:"legacy",flags:{core:{sourceId:uuid}}});
  assert.deepEqual(selectPartyTokens(scene(),[a,b],uuid),[a,b]);
});

test("party drops validate sidebar/compendium actors and scene token ownership",async()=>{
  const actor={type:"group",documentName:"Actor",uuid:"Compendium.world.party.Actor.party",name:"Forge Wardens"};
  globalThis.fromUuid=async()=>actor;
  assert.deepEqual(await partyReference({type:"Actor",uuid:actor.uuid}),{uuid:actor.uuid,name:actor.name});
  const doc={documentName:"Token",uuid:"Scene.map.Token.a",name:"Wardens",actor:{type:"group"},parent:{id:"map"}};fromUuid=async()=>doc;
  assert.equal((await partyReference({type:"Token",uuid:doc.uuid},{scene:scene()})).uuid,doc.uuid);
  await assert.rejects(partyReference({type:"Token",uuid:doc.uuid}),/global designation/);
  await assert.rejects(partyReference({type:"Token",uuid:doc.uuid},{scene:{id:"other"}}),/this scene/);
  await assert.rejects(partyReference({type:"Item",uuid:"Item.no"}),/Drop a group actor/);
});
