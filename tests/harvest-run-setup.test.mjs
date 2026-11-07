// 0.96.4: each creature's step carries its own setup (leader, helper, skills, parts), changed by the
// party until the GM requests its rolls.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry ??= { utils: { escapeHTML: (s) => String(s) } };
const { applySetup, changeSetup, bestSkill, stepChecks, stepReady } = await import("../scripts/harvest/run.mjs");

const part = (key, dc) => ({ key, name: key, kind: "hide", perLb: false, dice: [1, 1, 0], unitGp: 1, minutes: 20, dcs: { sur: dc - 4, med: dc - 2, slt: dc } });
const party = [
  { id: "a", name: "Ash", img: "", mods: { sur: 10, med: 4, slt: 4 } },
  { id: "b", name: "Bree", img: "", mods: { sur: 1, med: 9, slt: 3 } }
];
const step = () => applySetup({ all: [part("hide", 14), part("bones", 12)], skip: [], lead: null, help: null, asked: false, done: false, rolls: {}, overrides: {} });

test("a step with nobody leading has no checks and can't be confirmed", () => {
  const s = step();
  assert.equal(stepChecks(s).length, 0);
  assert.equal(stepReady({ ...s, asked: true }), false);
});

test("picking a leader uses their best skill and sets each part's DC", () => {
  const s = step();
  assert.ok(changeSetup(s, { field: "lead", value: "a" }, party));
  assert.equal(s.lead.skill, "sur");
  assert.equal(s.parts[0].dcLead, 10);
  assert.equal(bestSkill(party[1].mods, s.all), "med");
});

test("a helper can't be the leader; leading the helper swaps them", () => {
  const s = step();
  changeSetup(s, { field: "lead", value: "a" }, party);
  assert.equal(changeSetup(s, { field: "help", value: "a" }, party), false);
  changeSetup(s, { field: "help", value: "b" }, party);
  changeSetup(s, { field: "lead", value: "b" }, party);
  assert.equal(s.lead.id, "b");
  assert.equal(s.help.id, "a");
  assert.equal(stepChecks(s).length, 4);
});

test("unticking a part drops it and its time; the skill can be changed", () => {
  const s = step();
  changeSetup(s, { field: "lead", value: "a" }, party);
  changeSetup(s, { field: "part", key: "bones", on: false }, party);
  assert.deepEqual(s.parts.map((p) => p.key), ["hide"]);
  assert.equal(s.minutes, 20);
  changeSetup(s, { field: "skill", role: "lead", value: "slt" }, party);
  assert.equal(s.parts[0].dcLead, 14);
});

test("once the rolls are asked for, the setup is fixed", () => {
  const s = step();
  changeSetup(s, { field: "lead", value: "a" }, party);
  s.asked = true;
  assert.equal(changeSetup(s, { field: "lead", value: "b" }, party), false);
  assert.equal(s.lead.id, "a");
});
