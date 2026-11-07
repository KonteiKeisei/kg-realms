import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Harvested items are made on the spot (no compendium) and stack by their key; Provisioning makes rations.
globalThis.foundry = { utils: { isNewerVersion: (a, b) => parseFloat(a) > parseFloat(b) } };
globalThis.game = { system: { version: "5.1.0" }, time: { worldTime: 10 * 86400 } };
const { itemData, giveYield, provision, priceOf, spoilFood } = await import("../scripts/harvest/items.mjs");

function actor() {
  const a = { items: [] };
  a.createEmbeddedDocuments = async (_t, list) => list.map((d) => {
    const it = structuredClone(d);
    it.update = async (u) => { for (const [k, v] of Object.entries(u)) { const p = k.split("."); let o = it; while (p.length > 1) { const s = p.shift(); o = o[s] ??= {}; } o[p[0]] = v; } };
    it.delete = async () => { a.items.splice(a.items.indexOf(it), 1); };
    it.getFlag = (m, k) => it.flags?.[m]?.[k];
    a.items.push(it);
    return it;
  });
  return a;
}

test("prices keep a whole coin", () => {
  assert.deepEqual(priceOf(2), { value: 2, denomination: "gp" });
  assert.deepEqual(priceOf(0.5), { value: 5, denomination: "sp" });
  assert.deepEqual(priceOf(0.25), { value: 25, denomination: "cp" });
});

test("meat is food, parts are materials, and like stacks with like", async () => {
  const meat = itemData({ key: "meat:rare", name: "Rare edible meat", unitGp: 0.25, qty: 30, part: "meat", at: 0 });
  assert.equal(meat.type, "consumable");
  assert.equal(meat.system.type.value, "food");
  assert.deepEqual(meat.system.weight, { value: 1, units: "lb" });
  const claws = itemData({ key: "claws:rare", name: "Rare claws", unitGp: 2.5, qty: 3, part: "claws", at: 0 });
  assert.equal(claws.type, "loot");
  assert.equal(claws.system.type.value, "material");
  const a = actor();
  await giveYield(a, { key: "meat:rare", name: "Rare edible meat", unitGp: 0.25, qty: 30, part: "meat", at: 0 });
  await giveYield(a, { key: "meat:rare", name: "Rare edible meat", unitGp: 0.25, qty: 12, part: "meat", at: 86400 });
  await giveYield(a, { key: "meat:mangled", name: "Mangled meat", unitGp: 0, qty: 4, part: "meat", at: 86400 });
  assert.equal(a.items.length, 2, "one stack of rare meat, one of mangled");
  assert.equal(a.items[0].system.quantity, 42);
  assert.equal(a.items[0].flags["kg-realms"].harvest.batches.length, 2);
});

test("Provisioning: each one's own meat, oldest first, into rations in their own pack", async () => {
  const ration = { name: "Rations", type: "consumable", toObject: () => ({ name: "Rations", type: "consumable", system: { quantity: 1 } }) };
  globalThis.fromUuid = async () => ration;
  const a = actor();
  await giveYield(a, { key: "meat:common", name: "Common edible meat", unitGp: 0.05, qty: 10, part: "meat", at: 0 });
  await giveYield(a, { key: "meat:mangled", name: "Mangled meat", unitGp: 0, qty: 5, part: "meat", at: 100 });
  const r = await provision([a], 20, "Item.ration");
  assert.deepEqual([r.lb, r.rations], [15, 5]);
  assert.equal(a.items.find((i) => i.name === "Rations").system.quantity, 5);
  assert.ok(!a.items.some((i) => /meat/i.test(i.name)), "all 15 lb used: both stacks gone");
  await assert.rejects(() => { globalThis.fromUuid = async () => null; return provision([a], 20, ""); }, /ration item is not set/);
});

test("spoilage: fresh meat older than 3 days goes off", async () => {
  const a = actor();
  await giveYield(a, { key: "meat:common", name: "Common edible meat", unitGp: 0.05, qty: 10, part: "meat", at: 0 });
  await giveYield(a, { key: "meat:common", name: "Common edible meat", unitGp: 0.05, qty: 6, part: "meat", at: 9 * 86400 });
  const gone = await spoilFood([a]);
  assert.equal(gone[0].lb, 10);
  assert.equal(a.items[0].system.quantity, 6);
});

test("the harvest window is in the unified shell, with a practice run, and Provisioning is a camp task", () => {
  const ui = readFileSync(new URL("../scripts/harvest/ui-harvest.mjs", import.meta.url), "utf8");
  assert.ok(ui.includes("shellHead(") && ui.includes("shellTabs(") && ui.includes("kgr-sh-foot"));
  assert.ok(ui.includes('data-act="practice"'));
  assert.ok(/if \(!practice\) await this\.#apply/.test(ui), "a practice run applies nothing");
  const tasks = readFileSync(new URL("../scripts/camp-tasks.mjs", import.meta.url), "utf8");
  assert.ok(tasks.includes('label: "Provisioning"'));
  const camp = readFileSync(new URL("../scripts/ui-camp.mjs", import.meta.url), "utf8");
  assert.ok(!camp.includes('["forage", "conceal", "alarm"]'), "every camp task list includes Provisioning");
});
