import { test } from "node:test";
import assert from "node:assert/strict";
import { creatureProfile, partsFor, edible, dcFor, harvestCheck, harvestYield, rollAmount, preserve, spoil, coins, tierOf, DEFAULT_DCS, dragonColour } from "../scripts/harvest/catalog.mjs";

// Stand-in actors in dnd5e's shapes: v3 (damage parts as pairs) and v4 (activities, Sets).
const v4weapon = (name, types, natural = true) => ({ name, type: "weapon", system: { type: { value: natural ? "natural" : "martialM" }, damage: { base: { types: new Set(types) } }, activities: new Map([["a", { type: "attack" }]]) } });
const v4feat = (name, types = [], kind = "save") => ({ name, type: "feat", system: { activities: new Map([["a", { type: kind, damage: { parts: types.length ? [{ types: new Set(types) }] : [] } }]]) } });
const v3weapon = (name, type) => ({ name, type: "weapon", system: { type: { value: "natural" }, actionType: "mwak", damage: { parts: [["1d6", type]] } } });
const actor = ({ name, type, subtype = "", size = "med", cr = 0, items = [], fly = 0, prc = 0, darkvision = 0, di = [] }) => ({
  name, items,
  system: { details: { type: { value: type, subtype }, cr }, traits: { size, di: { value: new Set(di) } }, attributes: { movement: { fly }, senses: { darkvision } }, skills: { prc: { value: prc } } }
});

const wolf = actor({ name: "Wolf", type: "beast", cr: 0.25, prc: 1, items: [v3weapon("Bite", "piercing")] });
const dragon = actor({
  name: "Adult Red Dragon", type: "dragon", size: "huge", cr: 17, fly: 80, prc: 2, darkvision: 120,
  items: [v4weapon("Rend", ["slashing", "fire"]), v4feat("Fire Breath", ["fire"]), v4feat("Legendary Resistance"), v4feat("Spellcasting", [], "cast")]
});
const keyOf = (parts) => parts.map((p) => p.key).sort();

test("a creature's parts come from its own sheet: a wolf", () => {
  const parts = partsFor(creatureProfile(wolf));
  assert.deepEqual(keyOf(parts), ["bones:common", "eyes:common", "fangs:common", "hide:common", "meat:common"]);
  const meat = parts.find((p) => p.part === "meat");
  assert.equal(meat.name, "Common edible meat");
  assert.equal(meat.dc, 10, "DC 10 + half its CR (0) + nothing for meat");
  assert.equal(meat.minutes, 40, "a Medium creature: 20 minutes a part, twice for meat");
});

test("an adult red dragon: scales keep the colour, not the age, and legendary rarity", () => {
  const parts = partsFor(creatureProfile(dragon));
  const scales = parts.find((p) => p.part === "scales");
  assert.equal(scales.name, "Legendary red dragon scales");
  assert.equal(scales.key, "scales-red:legendary");
  assert.equal(scales.max, 4, "Huge: four hides' worth");
  assert.equal(scales.dc, 10 + 8 + 4);
  for (const k of ["meat", "claws", "gland", "eyes", "wings", "arcane", "blood", "heart", "bones"]) assert.ok(parts.some((p) => p.part === k), k);
  assert.equal(parts.find((p) => p.part === "gland").name, "Legendary fire gland");
  assert.equal(dragonColour("Ancient Blue Dragon"), "blue");
});

test("edibility: undead, fiends and constructs never; humanoids and giants by the world setting", () => {
  const zombie = creatureProfile(actor({ name: "Zombie", type: "undead" }));
  const bandit = creatureProfile(actor({ name: "Bandit", type: "humanoid", items: [v4weapon("Scimitar", ["slashing"], false)] }));
  const devilBeast = creatureProfile(actor({ name: "Hell Hound", type: "beast", subtype: "fiend" }));
  assert.equal(edible(zombie), false);
  assert.equal(edible(devilBeast), false);
  assert.equal(edible(bandit), false);
  assert.equal(edible(bandit, { people: true }), true);
  assert.ok(!partsFor(zombie).some((p) => p.part === "meat"), "no meat option at all");
  assert.ok(partsFor(zombie).some((p) => p.key === "grave-dust:common"));
  assert.ok(!partsFor(bandit).some((p) => p.part === "claws"), "a scimitar is not a claw");
});

test("plants give wild greens and bark; ghosts give no skin or bones", () => {
  const shambler = partsFor(creatureProfile(actor({ name: "Shambling Mound", type: "plant", size: "lg", cr: 5 })));
  assert.ok(shambler.some((p) => p.name === "Rare wild greens"));
  assert.ok(shambler.some((p) => p.part === "bark"));
  assert.ok(shambler.some((p) => p.part === "sap"));
  const ghost = partsFor(creatureProfile(actor({ name: "Ghost", type: "undead", cr: 4 })));
  assert.deepEqual(keyOf(ghost), ["ectoplasm:uncommon"]);
  const fire = partsFor(creatureProfile(actor({ name: "Fire Elemental", type: "elemental", size: "lg", cr: 5, di: ["fire"] })));
  assert.ok(fire.some((p) => p.name === "Rare ember essence"));
});

test("DCs: Survival takes 4 off, Medicine 2, and the GM's settings change them", () => {
  const part = { dc: 15 };
  assert.equal(dcFor(part, "sur"), 11);
  assert.equal(dcFor(part, "med"), 13);
  assert.equal(dcFor(part, "slt"), 15);
  const dcs = { ...DEFAULT_DCS, base: 12, survival: 2, parts: { ...DEFAULT_DCS.parts, meat: 1 } };
  const meat = partsFor(creatureProfile(wolf), { dcs }).find((p) => p.part === "meat");
  assert.equal(meat.dc, 13);
  assert.equal(dcFor(meat, "sur", dcs), 11);
});

test("a helper's success is +1 and a failure -1; failing by 5 ruins a part", () => {
  assert.deepEqual(harvestCheck(14, { total: 12, dc: 10 }, 15), { total: 15, helped: 1, success: true, ruined: false });
  assert.equal(harvestCheck(15, { total: 3, dc: 10 }, 15).success, false);
  assert.equal(harvestCheck(10, null, 15).ruined, true);
  assert.equal(harvestCheck(11, null, 15).ruined, false);
});

test("a failed meat check still gives a quarter, mangled; other parts give nothing", () => {
  const meat = partsFor(creatureProfile(wolf)).find((p) => p.part === "meat");
  const fangs = partsFor(creatureProfile(wolf)).find((p) => p.part === "fangs");
  const fail = harvestCheck(2, null, 15);
  assert.deepEqual(harvestYield(meat, fail, 30), { qty: 7, key: "meat:mangled", name: "Mangled meat", unitGp: 0, outcome: "mangled" });
  assert.equal(harvestYield(meat, fail, 3).outcome, "nothing", "a quarter of 3 lb is under a pound");
  assert.equal(harvestYield(fangs, fail, 4).outcome, "ruined");
  assert.equal(harvestYield(fangs, harvestCheck(20, null, 12), 4).qty, 4);
});

test("amounts, rarity, coins, Provisioning and spoilage", () => {
  assert.equal(rollAmount([5, 10, 10], () => 0), 15);
  assert.equal(rollAmount([5, 10, 10], () => 0.999), 60);
  assert.equal(tierOf(0.5).key, "common");
  assert.equal(tierOf(5).key, "rare");
  assert.equal(tierOf(30).key, "legendary");
  assert.equal(coins(2.55), "2 gp 5 sp 5 cp");
  assert.equal(coins(0), "nothing");
  const p = preserve([{ at: 0, lb: 10 }, { at: 1, lb: 15 }], 20);
  assert.deepEqual(p, { used: [{ index: 0, lb: 10 }, { index: 1, lb: 8 }], lb: 18, rations: 6 });
  const s = spoil([{ at: 0, lb: 10 }, { at: 3 * 86400, lb: 5 }], 4 * 86400);
  assert.equal(s.lost, 10);
  assert.equal(s.good.length, 1);
});
