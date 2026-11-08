import { test } from "node:test";
import assert from "node:assert/strict";
import { promptCompletedCampRest } from "../scripts/rest-recovery.mjs";
import { CampPanel } from "../scripts/ui-camp.mjs";

test("a completed camp requests one party rest without advancing time or changing the active profile", () => {
  const calls = [];
  const api = {
    activeProfile: "Wilderness",
    promptRest(ids, longRest, newDay) { calls.push({ ids, longRest, newDay }); return true; }
  };
  assert.equal(promptCompletedCampRest(api, [{ id: "a" }, { id: "b" }, { id: "a" }]), true);
  assert.deepEqual(calls, [{ ids: ["a", "b"], longRest: true, newDay: true }]);
  assert.equal(api.activeProfile, "Wilderness");
});

test("a camp rest within one calendar date is still a new day, so Rest Recovery asks for food and water", () => {
  const calls = [];
  const api = { promptRest(ids, longRest, newDay) { calls.push(newDay); return true; } };
  promptCompletedCampRest(api, [{ id: "a" }], { start: 2, end: 5 });
  assert.deepEqual(calls, [true]);
});

test("an unavailable Rest Recovery API or empty party does not request a rest", () => {
  const api = { promptRest() { throw new Error("should not run"); } };
  assert.equal(promptCompletedCampRest(null, [{ id: "a" }]), false);
  assert.equal(promptCompletedCampRest(api, []), false);
});

test("breaking camp advances the clock before requesting the current-profile party rest", async () => {
  const calls = [], actor = { id: "hero" };
  const hud = { leader: true, state: { watch: { scene: { night: 1, step: "dawn" } } }, clock: 100,
    progress: () => ({ status: "resting", night: 1, since: 100, until: 200 }) };
  const panel = new CampPanel(hud);
  panel.members = () => [{ id: actor.id, actor }];
  panel.sceneNow = () => ({ step: "dawn" });
  panel.write = async () => { calls.push("close scene"); };
  panel.advance = async (seconds) => { calls.push(`advance ${seconds}`); hud.clock += seconds; };
  globalThis.game = { user: { id:"gm",isGM: true }, users:[{id:"gm",isGM:true,active:true}], settings:{get:()=>""}, modules: new Map([["rest-recovery", { active: true }]]),
    time: { calendar: { timeToComponents: (t) => ({ year: 1, month: 1, dayOfMonth: t < 150 ? 1 : 2 }) } },
    restrecovery: { promptRest(ids, longRest, newDay) { calls.push([ids, longRest, newDay]); return true; } } };
  globalThis.ui = { notifications: { warn: () => { throw new Error("rest should be requested"); } } };
  await panel.click({ dataset: { camp: "scene-break" } });
  assert.deepEqual(calls, ["advance 100", "close scene", [["hero"], true, true]]);
});

test("an unknown rest end cannot silently finish camp or request recovery",async()=>{
  const hud={leader:true,state:{watch:{scene:{night:1,step:"dawn"}}},clock:100,progress:()=>({status:"resting",night:1,since:100,until:null})};
  const panel=new CampPanel(hud);panel.sceneNow=()=>({step:"dawn"});
  panel.members=()=>[];
  panel.write=async()=>{throw Error("camp closed");};panel.advance=async()=>{throw Error("time advanced");};
  let warnings=0;
  globalThis.game={user:{id:"gm",isGM:true},users:[{id:"gm",isGM:true,active:true}],settings:{get:()=>""}};
  globalThis.ui={notifications:{warn:()=>warnings++}};
  await panel.click({dataset:{camp:"scene-break"}});assert.equal(warnings,1);
});
