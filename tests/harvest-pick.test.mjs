import { test } from "node:test";
import assert from "node:assert/strict";
import { partsFor, pickParts, isCorePart } from "../scripts/harvest/catalog.mjs";

const profile = (over) => ({ name: "Creature", type: "beast", subtype: "", size: "med", cr: 7, attacks: [], senses: { darkvision: 0, blindsight: 0, tremorsense: 0, truesight: 0 }, perceptive: false, fly: false, spellcaster: false, legendary: false, immunities: [], traits: [], ...over });
const mindFlayer = profile({ name: "Mind Flayer", type: "aberration", perceptive: true, spellcaster: true, attacks: [{ name: "Extract Brain", types: ["piercing"], natural: true }] });
const deer = profile({ name: "Deer", cr: 0, attacks: [{ name: "Bite", types: ["piercing"], natural: true }] });
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

test("meat and hide are always offered and never part of the pick", () => {
  const parts = partsFor(deer);
  assert.deepEqual(parts.filter(isCorePart).map((p) => p.part), ["meat", "hide"]);
  for (let i = 0; i < 50; i++) for (const key of pickParts(parts)) assert.ok(!isCorePart(parts.find((p) => p.key === key)));
});

test("one or two of the other parts are picked, never more, never the same twice", () => {
  const parts = partsFor(mindFlayer), others = parts.filter((p) => !isCorePart(p)).map((p) => p.key);
  assert.ok(others.length >= 5, "bones, fangs, eyes, arcane gland, blood, heart");
  const sizes = new Set();
  for (let i = 0; i < 200; i++) {
    const pick = pickParts(parts);
    sizes.add(pick.length);
    assert.equal(new Set(pick).size, pick.length);
    assert.ok(pick.every((k) => others.includes(k)));
  }
  assert.deepEqual([...sizes].sort(), [1, 2]);
});

test("the pick follows the dice it is given, so a saved pick can be replayed", () => {
  const parts = partsFor(mindFlayer), others = parts.filter((p) => !isCorePart(p)).map((p) => p.key);
  assert.deepEqual(pickParts(parts, seq(0.9, 0, 0)), [others[0], others[1]], "two: the first, then the next");
  assert.deepEqual(pickParts(parts, seq(0.1, 0.99)), [others.at(-1)], "one: the last");
});

test("a creature with only one other part gets that one; with none, nothing is picked", () => {
  const bones = profile({ name: "Worm", cr: 0 });
  assert.deepEqual(pickParts(partsFor(bones), seq(0.9, 0)), [partsFor(bones).find((p) => p.part === "bones").key]);
  assert.deepEqual(pickParts([{ part: "meat", key: "meat:common" }]), []);
});
