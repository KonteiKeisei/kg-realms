import { test } from "node:test";
import assert from "node:assert/strict";
import { TradeMarkets, isTradeRegion, placesInRegion, summarizeTrade } from "../scripts/trade.mjs";
import { tradeSection } from "../scripts/ui-trade.mjs";

globalThis.foundry ??= { utils: { escapeHTML: (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]) } };

const region = { id: "heart", name: "The Heartlands", kind: "territory", areaClosed: true, area: [[0, 0], [10, 0], [10, 10], [0, 10]] };
const town = (id, name, lon, lat, extra = {}) => ({ id, name, kind: "settlement", lon, lat, ...extra });
const places = [region, town("a", "Arbertonn", 2, 2), town("b", "Briar Glen", 8, 8), town("x", "Far Port", 20, 20), town("h", "Hidden Hold", 5, 5, { visibility: "hidden" }), { id: "s", name: "Keep", kind: "site", lon: 5, lat: 4 }];
const data = {
  settlements: [
    { id: "pa", name: "Arbertonn", exports: [{ good: "wheat", tag: "t" }], imports: [{ good: "iron", tag: "t" }], price_mod: { wheat: 1, iron: 1.2 }, houses: ["hq"] },
    { id: "pb", name: "Briar Glen", exports: [{ good: "wheat", tag: "t" }], price_mod: { wheat: 1.5 } },
    { id: "px", name: "Far Port", exports: [{ good: "salt", tag: "t" }] },
    { id: "ph", name: "Hidden Hold", exports: [{ good: "salt", tag: "t" }] }
  ],
  goods: [{ id: "wheat", name: "Wheat", unit: "1 bushel", base: 1, cat: "Food" }, { id: "iron", name: "Iron", unit: "1 lb", base: 0.1 }, { id: "salt", name: "Salt", unit: "1 lb", base: 0.05 }],
  signature_goods: [], houses: [{ id: "hq", name: "House Lanne" }], tags: { t: "tag" }, matches: {}
};
const markets = () => new TradeMarkets({ load: async () => structuredClone(data), getPlaces: async () => places, getScale: () => "x1", getEdits: () => ({}) });

test("a territory or domain with a closed outline is a trade region; its settlements are the ones inside", () => {
  assert.equal(isTradeRegion(region), true);
  assert.equal(isTradeRegion({ ...region, kind: "settlement" }), false);
  assert.equal(isTradeRegion({ ...region, areaClosed: false }), false);
  assert.deepEqual(placesInRegion(region, places).map((p) => p.name), ["Arbertonn", "Briar Glen", "Hidden Hold"]);
});

test("a region's card sums up its places' trade: each good once, its price range and where", async () => {
  const m = await markets().get("w", region);
  assert.ok(m.summary);
  const wheat = m.rows.find((r) => r.name === "Wheat");
  assert.deepEqual(wheat.where.map((w) => [w.name, w.gp]), [["Arbertonn", 1], ["Briar Glen", 1.5]]);
  assert.ok(!m.rows.some((r) => r.where.some((w) => w.name === "Far Port")), "outside the region");
  assert.deepEqual(m.houses, ["House Lanne"]);
  const html = tradeSection(m, false);
  assert.match(html, /Wheat <small>\(2\)<\/small>/);
  assert.match(html, /1 gp to 1\.5 gp/);
  assert.ok(!html.includes('data-act="trade-edit"'), "read-only: each place's own card edits its trade");
});

test("a hidden place's goods stay the GM's in the summary", async () => {
  const m = await markets().get("w", region);
  const player = tradeSection(m, false), gm = tradeSection(m, true);
  assert.ok(!player.includes("Salt") && !player.includes("Hidden Hold"));
  assert.ok(gm.includes("Salt") && gm.includes("Hidden Hold"));
});

test("a region given trade of its own keeps it; a settlement is unchanged", async () => {
  const t = new TradeMarkets({ load: async () => structuredClone(data), getPlaces: async () => places, getScale: () => "x1", getEdits: () => ({ heart: { profile: "", rows: [{ key: "k", name: "Wool", unit: "1 lb", group: "exports", base: 1, mod: 1 }], houses: [] } }) });
  const own = await t.get("w", region);
  assert.equal(own.summary, undefined);
  assert.deepEqual(own.rows.map((r) => r.name), ["Wool"]);
  const a = await markets().get("w", places[1]);
  assert.equal(a.summary, undefined);
  assert.ok(a.rows.some((r) => r.name === "Wheat"));
});

test("a region with no trading places inside shows no summary", () => {
  assert.deepEqual(summarizeTrade([]).rows, []);
});
