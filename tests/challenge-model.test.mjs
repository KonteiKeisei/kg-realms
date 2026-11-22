// 0.97.0: skill challenges. The rules of a run: successes before failures, no repeated skills, spells
// the GM rules on, stages and the three endings.
import test from "node:test";
import assert from "node:assert/strict";
import { exportChallenge, importChallenge, exportFileName, challengeLinks, gmOverride, addMember, removeMember, unskipActor, stillToAct, everyoneActed, assignRoll, unassignRoll, pendingRolls, pendingFor, pendingTerms, rollPending, gmRule } from "../scripts/challenge/model.mjs";
import { normalizeChallenge, challengeProblems, startRun, canAct, recordRoll, requestSpell, ruleSpell, gmMark, skipActor, canAdvance, nextStage, endEarly, endingFor, rollTerms, contributions, actedIn } from "../scripts/challenge/model.mjs";

const party = [{ id: "a", name: "Ash" }, { id: "b", name: "Bree" }, { id: "c", name: "Cole" }];
const challenge = (over = {}) => normalizeChallenge({
  name: "Old Bark-Bane",
  goal: { succ: 8, fail: 3, partial: 5 },
  stages: [
    { title: "Round 1", approaches: [{ options: ["skill:nat", "skill:per"], dc: 16 }, { options: ["skill:sur"], dc: 16 }], spells: ["Speak with Plants"], spellEffect: "auto" },
    { title: "Round 2", approaches: [{ options: ["skill:ath"], dc: 17 }, { options: ["check:str"], dc: 12 }], spells: [], spellEffect: "dc2" },
    { title: "Round 3", approaches: [{ options: ["skill:med", "skill:sur"], dc: 16 }] }
  ],
  ...over
});
const run = (over) => startRun(challenge(over), party, { scene: "s1", runId: "r1", join: true });

test("a stored challenge is cleaned: bad options dropped, numbers kept in range, partial capped at the goal", () => {
  const c = normalizeChallenge({ goal: { succ: 4, fail: 0, partial: 9 }, stages: [{ approaches: [{ options: ["skill:nat", "skill:nope", "check:xyz"], dc: 99 }] }] });
  assert.deepEqual(c.goal, { succ: 4, fail: 1, partial: 4 });
  assert.deepEqual(c.stages[0].approaches[0].options, ["skill:nat"]);
  assert.equal(c.stages[0].approaches[0].dc, 40);
  assert.equal(c.rules.noRepeat, true);
});

test("a challenge with an empty approach can't start", () => {
  const c = normalizeChallenge({ stages: [{ title: "R1", approaches: [{ options: [], dc: 10 }] }] });
  assert.equal(challengeProblems(c).length, 1);
  assert.equal(challengeProblems(challenge()).length, 0);
});

test("a roll at or over the DC is a success; under is a failure; the skill is then used", () => {
  const r = run();
  assert.equal(recordRoll(r, { actor: "a", approach: 0, option: "skill:nat", total: 16 }).success, true);
  assert.equal(recordRoll(r, { actor: "b", approach: 1, option: "skill:sur", total: 15 }).success, false);
  assert.deepEqual([r.succ, r.fail], [1, 1]);
  assert.deepEqual(r.used.a, ["skill:nat"]);
});

test("a character acts once a stage, an option not offered is refused, and a used skill can't be used again", () => {
  const r = run();
  recordRoll(r, { actor: "a", approach: 0, option: "skill:nat", total: 20 });
  assert.equal(recordRoll(r, { actor: "a", approach: 1, option: "skill:sur", total: 20 }), null);
  assert.equal(recordRoll(r, { actor: "b", approach: 0, option: "skill:sur", total: 20 }), null);
  nextStage(r); nextStage(r);
  // Round 3 offers Survival again; Ash used Nature, so Survival is fine for Ash, and Nature would not be.
  assert.equal(canAct(r, "a", "skill:sur").ok, true);
  r.stages[2].approaches[0].options.push("skill:nat");
  assert.equal(canAct(r, "a", "skill:nat").ok, false);
});

test("with no repeats off, a skill can be used again", () => {
  const r = run({ rules: { noRepeat: false } });
  recordRoll(r, { actor: "a", approach: 0, option: "skill:nat", total: 20 });
  nextStage(r); nextStage(r);
  r.stages[2].approaches[0].options.push("skill:nat");
  assert.equal(canAct(r, "a", "skill:nat").ok, true);
});

test("a spell the GM allows is the stage's effect: an automatic success in round 1", () => {
  const r = run();
  assert.ok(requestSpell(r, { actor: "c", spell: "Speak with Plants", text: "I ask it to hold still" }));
  const act = ruleSpell(r, "c", "allow");
  assert.equal(act.success, true);
  assert.equal(r.succ, 1);
  assert.equal(actedIn(r).has("c"), true);
});

test("a spell that lowers the DC by 2 applies to that character's next roll only", () => {
  const r = run();
  nextStage(r);
  requestSpell(r, { actor: "a", spell: "Mold Earth" });
  assert.deepEqual(ruleSpell(r, "a", "allow"), { boost: "dc2" });
  assert.deepEqual(rollTerms(r, "a", 0), { dc: 15, advantage: false });
  assert.equal(recordRoll(r, { actor: "a", approach: 0, option: "skill:ath", total: 15 }).success, true);
  assert.equal(r.boosts.a, undefined);
});

test("a denied spell leaves the character free to roll", () => {
  const r = run();
  requestSpell(r, { actor: "b", spell: "Prestidigitation" });
  ruleSpell(r, "b", "deny");
  assert.equal(r.requests.b, undefined);
  assert.equal(canAct(r, "b").ok, true);
});

test("spells can't be asked for when the rule is off", () => {
  const r = run({ rules: { spells: false } });
  assert.equal(requestSpell(r, { actor: "a", spell: "Calm Emotions" }), false);
});

test("reaching the goal ends it at once in full success; the failure limit ends it in failure", () => {
  const r = run({ goal: { succ: 2, fail: 3, partial: 1 } });
  gmMark(r, true); gmMark(r, true);
  assert.equal(r.result, "full");
  const f = run();
  gmMark(f, false); gmMark(f, false); gmMark(f, false);
  assert.equal(f.result, "fail");
  assert.equal(gmMark(f, true), null);
});

test("after the last stage: partial success from the partial threshold, failure below it", () => {
  const r = run();
  for (let i = 0; i < 6; i++) gmMark(r, true);
  nextStage(r); nextStage(r); nextStage(r);
  assert.equal(r.result, "partial");
  const low = run();
  for (let i = 0; i < 4; i++) gmMark(low, true);
  assert.equal(endingFor(low), "fail");
  endEarly(low);
  assert.equal(low.result, "fail");
});

test("with everyone must act on, the stage can't end until all have acted or been skipped", () => {
  const r = run({ rules: { everyone: true } });
  recordRoll(r, { actor: "a", approach: 0, option: "skill:nat", total: 20 });
  assert.equal(canAdvance(r), false);
  recordRoll(r, { actor: "b", approach: 1, option: "skill:sur", total: 20 });
  skipActor(r, "c");
  assert.equal(canAdvance(r), true);
});

test("moving on clears spell requests and boosts", () => {
  const r = run();
  requestSpell(r, { actor: "a", spell: "Calm Emotions" });
  r.boosts.b = { dc: 2 };
  nextStage(r);
  assert.deepEqual([r.requests, r.boosts], [{}, {}]);
});

test("a challenge exported and imported again comes back the same", () => {
  const c = challenge();
  c.outcomes.full.effects.push({ kind: "item", uuid: "Item.abc", name: "Heartwood Charm" });
  const file = exportChallenge(c, { exportedAt: "2026-11-21T00:00:00Z" });
  assert.equal(file.format, "kg-realms-skill-challenge");
  const back = importChallenge(JSON.stringify(file));
  assert.deepEqual(back.challenge, normalizeChallenge(c));
  assert.deepEqual(challengeLinks(back.challenge), [{ kind: "item", uuid: "Item.abc", name: "Heartwood Charm", outcome: "full" }]);
  assert.equal(exportFileName(c), "old-bark-bane.json");
});

test("a bare challenge object imports; other files, newer schemas and bad JSON are refused", () => {
  assert.equal(importChallenge(JSON.stringify({ name: "Hand made", stages: [{ approaches: [{ options: ["skill:ath"], dc: 12 }] }] })).challenge.name, "Hand made");
  assert.match(importChallenge("{oops").error, /valid JSON/);
  assert.match(importChallenge(JSON.stringify({ format: "kg-notification-filter", rules: [] })).error, /isn't a KG Realms/);
  assert.match(importChallenge(JSON.stringify({ format: "kg-realms-skill-challenge", schema: 99, challenge: {} })).error, /newer/);
  assert.match(importChallenge(JSON.stringify({ hello: 1 })).error, /doesn't hold/);
});

test("a GM override is that character's act this stage, with its note, and uses up no skill", () => {
  const r = run();
  requestSpell(r, { actor: "a", spell: "Calm Emotions" });
  const act = gmOverride(r, "a", true, "Sings the treant a lullaby from her childhood");
  assert.equal(act.kind, "gm");
  assert.equal(act.note, "Sings the treant a lullaby from her childhood");
  assert.equal(r.succ, 1);
  assert.equal(r.requests.a, undefined);
  assert.equal(actedIn(r).has("a"), true);
  assert.deepEqual(r.used.a ?? [], []);
  assert.equal(gmOverride(r, "a", false), null);
  assert.equal(gmOverride(r, "b", false, "Falls in the mud").success, false);
  assert.equal(r.fail, 1);
});

test("a GM override can end the challenge, and none is taken once it's over", () => {
  const r = run({ goal: { succ: 1, fail: 3, partial: 0 } });
  gmOverride(r, "c", true, "Talks it down");
  assert.equal(r.result, "full");
  assert.equal(gmOverride(r, "a", true), null);
});

test("contributions list each character's marks and spells", () => {
  const r = run();
  recordRoll(r, { actor: "a", approach: 0, option: "skill:nat", total: 20 });
  requestSpell(r, { actor: "b", spell: "Speak with Plants" });
  ruleSpell(r, "b", "allow");
  const c = contributions(r);
  assert.equal(c.find((x) => x.id === "a").marks, "✓");
  assert.deepEqual(c.find((x) => x.id === "b").spells, ["Speak with Plants"]);
  gmOverride(r, "c", true, "Climbs the treant");
  assert.deepEqual(contributions(r).find((x) => x.id === "c").others, ["Climbs the treant"]);
});

// 0.98.4: the GM chooses who takes part, and a skip can be taken back.
test("a run starts with nobody taking part, the scene's characters kept as its roster", () => {
  const r = startRun(challenge(), party, { scene: "s1", runId: "r1" });
  assert.deepEqual(r.party, []);
  assert.deepEqual(r.roster.map((p) => p.id), ["a", "b", "c"]);
  assert.equal(canAct(r, "a").ok, false);
  assert.equal(everyoneActed(r), true, "nobody is waiting");
});

test("the GM adds and removes characters; a removed one can't act, what they did still counts", () => {
  const r = startRun(challenge(), party, { scene: "s1", runId: "r1" });
  assert.equal(addMember(r, party[0]), true);
  assert.equal(addMember(r, party[0]), false, "already in");
  assert.equal(addMember(r, { id: "z", name: "Zed" }), true, "anyone the GM picks, not only the roster");
  assert.deepEqual(stillToAct(r).map((p) => p.id), ["a", "z"]);
  recordRoll(r, { actor: "a", approach: 0, option: "skill:nat", total: 20 });
  assert.equal(removeMember(r, "a"), true);
  assert.equal(canAct(r, "a").ok, false);
  assert.equal(r.succ, 1);
  assert.deepEqual(stillToAct(r).map((p) => p.id), ["z"]);
  assert.deepEqual(contributions(r).map((c) => [c.id, c.marks]), [["z", ""], ["a", "✓"]]);
  assert.equal(removeMember(r, "a"), false, "already out");
  assert.equal(addMember(r, party[0]), true, "and back in");
});

test("a skip is taken back: the character can act again this stage", () => {
  const r = run();
  skipActor(r, "b");
  assert.equal(canAct(r, "b").ok, false);
  assert.equal(unskipActor(r, "b"), true);
  assert.equal(canAct(r, "b").ok, true);
  assert.equal(unskipActor(r, "b"), false, "nothing to take back");
  recordRoll(r, { actor: "c", approach: 0, option: "skill:nat", total: 20 });
  assert.equal(unskipActor(r, "c"), false, "a roll isn't a skip");
});

// 0.98.6: the GM sets up rolls for each character, from an approach or of the GM's own.
test("an approach set up for a character carries its skills and DC; rolled, it's their act", () => {
  const r = run();
  const p = assignRoll(r, "a", { approach: 0 });
  assert.deepEqual([p.options, p.dc, p.approach], [["skill:nat", "skill:per"], 16, 0]);
  assert.deepEqual(pendingFor(r, "a").map((x) => x.id), [p.id]);
  const act = rollPending(r, p.id, { option: "skill:per", total: 17 });
  assert.equal(act.success, true);
  assert.equal(act.option, "skill:per");
  assert.deepEqual(pendingRolls(r), []);
  assert.deepEqual(r.used.a, ["skill:per"]);
  assert.equal(r.succ, 1);
});

test("a character can have several rolls set up in one stage, each rolled once", () => {
  const r = run();
  const one = assignRoll(r, "a", { approach: 0 }), two = assignRoll(r, "a", { approach: 1 });
  rollPending(r, one.id, { option: "skill:nat", total: 5 });
  assert.equal(rollPending(r, one.id, { option: "skill:per", total: 20 }), null, "already rolled");
  assert.equal(rollPending(r, two.id, { option: "skill:sur", total: 20 }).success, true);
  assert.deepEqual([r.succ, r.fail], [1, 1]);
});

test("a set-up roll refuses a skill it doesn't offer, a used one, a missing total and an outsider", () => {
  const r = run();
  r.used.a = ["skill:nat"];
  const p = assignRoll(r, "a", { approach: 0 });
  assert.equal(rollPending(r, p.id, { option: "skill:ath", total: 20 }), null, "not offered");
  assert.equal(rollPending(r, p.id, { option: "skill:nat", total: 20 }), null, "used up");
  assert.equal(rollPending(r, p.id, { option: "skill:per", total: NaN }), null, "no total");
  assert.equal(assignRoll(r, "zz", { approach: 0 }), null, "not taking part");
  assert.equal(assignRoll(r, "a", { approach: 9 }), null, "no such approach");
});

test("the GM's own roll: valid skills only, DC kept in range, its note kept", () => {
  const r = run();
  const p = assignRoll(r, "b", { options: ["skill:ste", "skill:nope"], dc: 99, text: "Hides in the scree" });
  assert.deepEqual([p.options, p.dc, p.approach, p.text], [["skill:ste"], 40, null, "Hides in the scree"]);
  assert.equal(assignRoll(r, "b", { options: ["skill:nope"], dc: 10 }), null);
  assert.equal(rollPending(r, p.id, { option: "skill:ste", total: 40 }).success, true);
});

test("a spell boost lowers a set-up roll's DC once", () => {
  const r = run();
  r.boosts.a = { dc: 2, spell: "Guidance" };
  const p = assignRoll(r, "a", { approach: 0 });
  assert.equal(pendingTerms(r, p).dc, 14);
  assert.equal(rollPending(r, p.id, { option: "skill:nat", total: 14 }).success, true);
  assert.equal(r.boosts.a, undefined);
});

test("set-up rolls go at the next stage, with a removed character, and none after the end", () => {
  const r = run({ goal: { succ: 1, fail: 3, partial: 0 } });
  const a = assignRoll(r, "a", { approach: 0 }), b = assignRoll(r, "b", { approach: 0 });
  assert.equal(unassignRoll(r, b.id), true);
  assignRoll(r, "c", { approach: 0 });
  removeMember(r, "c");
  assert.deepEqual(pendingRolls(r).map((p) => p.id), [a.id]);
  const old = run(); delete old.pending;
  assert.deepEqual(pendingRolls(old), [], "a run kept before 0.98.6");
  rollPending(r, a.id, { option: "skill:nat", total: 20 });
  assert.equal(r.result, "full");
  assert.equal(assignRoll(r, "b", { approach: 0 }), null);
  const s = run(); assignRoll(s, "a", { approach: 0 }); nextStage(s);
  assert.deepEqual(pendingRolls(s), []);
});

test("the GM's ruling counts even after the character has acted this stage", () => {
  const r = run();
  recordRoll(r, { actor: "a", approach: 0, option: "skill:nat", total: 20 });
  assert.equal(gmRule(r, "a", false, "Slips on the scree").success, false);
  assert.deepEqual([r.succ, r.fail], [1, 1]);
  assert.equal(gmRule(r, "zz", true), null);
});
