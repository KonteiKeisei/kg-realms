import test from "node:test";
import assert from "node:assert/strict";
import { receiveCampMessage, validWatchChanges, sendCampMessage } from "../scripts/camp-messages.mjs";
import { CampPanel } from "../scripts/ui-camp.mjs";
import { journeyKey } from "../scripts/journey-state.mjs";
import { gmGame, testScene } from "./helpers/journey.mjs";

test("camp requests take identity from the document update and replace old payloads", async () => {
  const calls=[],user={id:"player",active:true,setFlag:async(m,k,v)=>calls.push([m,k,v])};
  globalThis.game={user};globalThis.foundry={utils:{randomID:()=>"unique"}};
  await sendCampMessage({type:"watch",changes:{hours:{a:2}}});
  assert.equal(typeof calls[0][2],"string");
  const changes={flags:{"kg-realms":{campMessage:calls[0][2]}}},received=[];
  receiveCampMessage(user,changes,"impostor",(...args)=>received.push(args));assert.equal(received.length,0);
  receiveCampMessage(user,changes,user.id,(...args)=>received.push(args));assert.equal(received[0][1],user.id);
  receiveCampMessage(user,{flags:{"kg-realms":{campMessage:"{"}}},user.id,()=>assert.fail("invalid JSON"));
});

test("watch edits reject malformed data and characters outside the party", () => {
  const ids=new Set(["a","b"]);
  assert.ok(validWatchChanges({order:["b","a"],hours:{a:0,b:8},sleep:{a:"trance"},join:{b:true}},ids));
  for(const value of [{order:"a"},{order:["a","a"]},{hours:{a:-1}},{hours:{a:Infinity}},{hours:{a:9}},{hours:{outsider:2}},{join:{a:"yes"}},{sleep:{a:"unknown"}},{gmLock:false},{}])assert.equal(validWatchChanges(value,ids),false,JSON.stringify(value));
});

test("the GM rejects spoofed holders, old camps and tasks for another party", async () => {
  const state={trip:{departed:0},watch:{campId:"current",lock:{user:"owner",at:Date.now()},tasks:{},hours:{a:2}}};
  const scene=testScene(state),a={id:"a",testUserPermission:u=>u.id==="owner"},outsider={id:"other",testUserPermission:()=>true};
  gmGame({scenes:{get:()=>scene},actors:{get:id=>id==="a"?a:outsider}});
  game.users.push({id:"owner",active:true},{id:"intruder",active:true});
  const camp=new CampPanel({scene,state,members:()=>[a]});
  const msg={type:"watch",scene:scene.id,trip:journeyKey(state),campId:"current",user:"owner",changes:{hours:{a:0}}};
  await camp.onMessage(msg,"intruder");assert.equal(state.watch.hours.a,2);
  await camp.onMessage({...msg,campId:"old"},"owner");assert.equal(state.watch.hours.a,2);
  await camp.onMessage({...msg,taskSet:{id:"other",task:"watch"}},"owner");assert.deepEqual(state.watch.tasks,{});
  await camp.onMessage(msg,"owner");assert.equal(state.watch.hours.a,0);
  await camp.onMessage({...msg,taskSet:{id:"a",task:"watch"}},"owner");assert.equal(state.watch.tasks.a,"watch");
});
