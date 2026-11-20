// A Regional map trades from its realm's catalogue, and a place on both maps has one market (0.97.7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TradeMarkets, tradeHome } from "../scripts/trade.mjs";

const files = {
  realm: { settlements: [{ id: "pa", name: "Arbertonn", exports: [{ good: "wheat", tag: "t" }] }], goods: [{ id: "wheat", name: "Wheat", unit: "1 bushel", base: 1 }, { id: "iron", name: "Iron", unit: "1 lb", base: 0.1 }], signature_goods: [], houses: [{ id: "hl", name: "House Lanne" }], tags: { t: "Farmland" }, matches: {} },
  dale: { settlements: [{ id: "pd", name: "Briar Glen", exports: [{ good: "honey", tag: "u" }] }], goods: [{ id: "honey", name: "Honey", unit: "1 jar", base: 2 }, { id: "iron", name: "Dale iron", unit: "1 lb", base: 0.2 }], signature_goods: [], houses: [], tags: { u: "Hives" }, matches: {} },
  empty: null
};
const markets = (edits = {}) => new TradeMarkets({ load: async (w) => structuredClone(files[w]), parentOf: (w) => (w === "dale" || w === "empty" ? "realm" : null), getEdits: (w) => edits[w] ?? {}, getScale: () => "x1" });

test("a Regional map with no trade file offers its realm's goods, houses and profiles", async () => {
  const data = await markets().data("empty");
  assert.deepEqual(data.goods.map((g) => g.id), ["wheat", "iron"]);
  assert.deepEqual(data.houses.map((h) => h.name), ["House Lanne"]);
  assert.ok(data.byName.has("arbertonn"), "the realm's settlement profiles");
  assert.equal(data.tags.t, "Farmland");
});

test("a Regional map's own entries win over its realm's", async () => {
  const data = await markets().data("dale");
  assert.deepEqual(data.goods.map((g) => g.id).sort(), ["honey", "iron", "wheat"]);
  assert.equal(data.goodsById.get("iron").name, "Dale iron");
  assert.ok(data.byName.has("briarglen") && data.byName.has("arbertonn"));
});

test("a realm's data is not touched by its Regional maps", async () => {
  const data = await markets().data("realm");
  assert.deepEqual(data.goods.map((g) => g.id), ["wheat", "iron"]);
});

test("a place shown on its Regional map reads its realm market, edits included", async () => {
  const t = markets({ realm: { bryn: { profile: "", rows: [{ key: "k", name: "Wool", unit: "1 lb", group: "exports", base: 1, mod: 1 }], houses: [] } } });
  const fromRegion = await t.get("dale", { id: "bryn", name: "Bryn", canonicalWorld: "realm", canonicalId: "bryn" });
  const fromRealm = await t.get("realm", { id: "bryn", name: "Bryn" });
  assert.deepEqual(fromRegion.rows.map((r) => r.name), ["Wool"]);
  assert.equal(fromRegion.revision, fromRealm.revision, "one record, so one save path");
});

test("a place made on the Regional map keeps its own market there", async () => {
  const t = markets({ dale: { cave: { profile: "", rows: [{ key: "k", name: "Glowcap", unit: "1 oz", group: "specialties", base: 5, mod: 1 }], houses: [] } } });
  const m = await t.get("dale", { id: "cave", name: "Cave" });
  assert.deepEqual(m.rows.map((r) => r.name), ["Glowcap"]);
  // Shown on the realm, it still reads the Regional record.
  const onRealm = await t.get("realm", { id: "cave", name: "Cave", canonicalWorld: "dale", canonicalId: "cave" });
  assert.deepEqual(onRealm.rows.map((r) => r.name), ["Glowcap"]);
});

test("the trade editor opens, and saves, the place's home market", () => {
  assert.deepEqual(tradeHome("dale", { id: "x", canonicalWorld: "realm", canonicalId: "y", name: "N" }), { world: "realm", place: { id: "y", name: "N" } });
  assert.deepEqual(tradeHome("realm", { id: "x", name: "N" }), { world: "realm", place: { id: "x", name: "N" } });
  const ui = readFileSync(new URL("../scripts/ui-trade.mjs", import.meta.url), "utf8");
  assert.ok(ui.includes("({ world, place } = tradeHome(world, place));"), "the editor saves where the place belongs");
});

test("earlier trade edits of shared places move to the realm once, never over the realm's own", () => {
  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  const move = main.slice(main.indexOf("async function moveSharedTrade"), main.indexOf('Hooks.once("ready", () => moveSharedTrade()'));
  assert.ok(move.includes("if (home[id]) continue;"), "the realm's own record wins");
  assert.ok(move.includes("isPrimaryGM()"));
});
