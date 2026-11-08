// 0.96.5: Provisioning's rations shared equally, fewest first; Rest Recovery's no food or water trait.
import test from "node:test";
import assert from "node:assert/strict";

globalThis.foundry ??= {};
globalThis.foundry.utils ??= {};
globalThis.foundry.utils.getProperty ??= (o, path) => path.split(".").reduce((x, k) => x?.[k], o);
const { evenShares, eats, isRation } = await import("../scripts/harvest/items.mjs");

test("equal shares keep the total; the leftover goes to whoever had fewest", () => {
  const s = evenShares([{ id: "a", n: 6 }, { id: "b", n: 0 }, { id: "c", n: 1 }]);
  assert.deepEqual(s, { b: 3, c: 2, a: 2 });
  assert.equal(Object.values(s).reduce((x, y) => x + y, 0), 7);
});

test("ties for fewest go in the party's order", () => {
  assert.deepEqual(evenShares([{ id: "a", n: 0 }, { id: "b", n: 0 }, { id: "c", n: 5 }]), { a: 2, b: 2, c: 1 });
});

test("nothing to share and nobody sharing", () => {
  assert.deepEqual(evenShares([]), {});
  assert.deepEqual(evenShares([{ id: "a", n: 0 }, { id: "b", n: 0 }]), { a: 0, b: 0 });
});

test("Rest Recovery's no food or water trait means they don't eat", () => {
  assert.equal(eats({ flags: { dnd5e: { noFoodWater: true } } }), false);
  assert.equal(eats({ flags: { dnd5e: { noFoodWater: false } } }), true);
  assert.equal(eats({}), true);
});

test("a ration is known by its source, or by name and type", () => {
  const uuid = "Compendium.x.items.Item.r";
  assert.ok(isRation({ _stats: { compendiumSource: uuid } }, uuid, null));
  assert.ok(isRation({ name: "Rations", type: "consumable" }, uuid, { name: "Rations", type: "consumable" }));
  assert.ok(!isRation({ name: "Rations", type: "loot" }, uuid, { name: "Rations", type: "consumable" }));
});
