import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { TradeMarkets, cleanTrade, tradePrice, tradeCoin, economyScale, tradeBasePrice, unscaleTradeBase, visibleTradeRows } from "../scripts/trade.mjs";
import { tradeSection } from "../scripts/ui-trade.mjs";
import { gmGame } from "./helpers/journey.mjs";
const raw = JSON.parse(await fs.readFile(new URL("../data/worlds/toril/trade.json", import.meta.url)));
const fixture = () => {
  let edits = {}, scale = "x1", loads = 0;
  const service = new TradeMarkets({ load: async () => { loads++; return structuredClone(raw); }, getEdits: () => edits, getScale: () => scale, saveEdits: async (w, id, value) => { if (value == null) delete edits[id]; else edits[id] = value; } });
  return { service, scale: s => scale = s, loads: () => loads, edits: () => edits };
};
const neverwinter = { id: Object.entries(raw.matches).find(([, id]) => id === "neverwinter")[0], name: "Neverwinter" };
test("the bundled trade export retains all 153 profiles, 55 goods and 171 specialties", () => {
  assert.equal(raw.settlements.length, 153); assert.equal(raw.goods.length, 55); assert.equal(raw.signature_goods.length, 171); assert.equal(Object.keys(raw.matches).length, 140);
  for (const s of raw.settlements) for (const group of ["exports", "imports"]) for (const r of s[group]) { assert.ok(raw.goods.some(g => g.id === r.good)); assert.ok(Number.isFinite(s.price_mod[r.good])); }
});
test("Neverwinter trade follows the supplied local price without applying house effects twice", async () => {
  const x = fixture(), m = await x.service.get("toril", neverwinter), timber = m.rows.find(r => r.good === "timber");
  assert.equal(timber.base, 1); assert.equal(timber.mod, .85); assert.equal(tradePrice(timber, m.scale), .85); assert.equal(tradeCoin(.85), "85 cp");
  assert.ok(m.houses.includes("Brightwater Trust")); assert.equal(m.rows.filter(r => r.group === "specialties").length, 2);
  x.scale("x2"); assert.equal(tradePrice(timber, (await x.service.get("toril", neverwinter)).scale), 1.7);
});
test("all economy setting choices multiply once, including fractional copper prices", () => {
  assert.equal(economyScale("x10"), 10); assert.equal(economyScale("d5"), .2); assert.equal(economyScale("bad"), 1);
  assert.equal(tradeCoin(tradePrice({ base: .01, mod: 1.3 }, 1)), "1.3 cp"); assert.equal(tradeCoin(0), "0 cp");
});

test("economy-adjusted editor prices convert back once and survive later setting changes", () => {
  const row = { base: 50, mod: 1.2 };
  assert.equal(tradeBasePrice(row, .1), 5);
  row.base = unscaleTradeBase(7, .1);
  assert.equal(row.base, 70); assert.equal(tradePrice(row, .1), 8.4);
  assert.equal(tradeBasePrice(row, 2), 140); assert.equal(tradePrice(row, 2), 168);
  for (const setting of ["d10", "d3", "x1", "x3", "x10"]) {
    const scale = economyScale(setting), stored = unscaleTradeBase(tradeBasePrice({ base: .01 }, scale), scale);
    assert.ok(Math.abs(stored - .01) < 1e-15);
  }
});

test("hidden trade goods retain their data and are omitted from both player card formats", async () => {
  gmGame(); const x = fixture(), market = await x.service.get("toril", neverwinter);
  market.rows[0].hidden = true; market.rows[0].name = "Secret clockwork";
  await x.service.save("toril", neverwinter.id, market);
  const saved = await x.service.get("toril", neverwinter);
  assert.equal(saved.rows[0].hidden, true);
  assert.equal(visibleTradeRows(saved, false).length, saved.rows.length - 1);
  globalThis.foundry = { utils: { escapeHTML: String } };
  for (const compact of [false, true]) {
    const player = tradeSection(saved, false, { compact }), gm = tradeSection(saved, true, { compact });
    assert.ok(!player.includes("Secret clockwork")); assert.ok(gm.includes("Secret clockwork"));
    assert.ok(gm.includes("fa-eye-slash"));
    assert.equal(gm.includes('data-act="trade-more"'), compact);
    assert.ok(player.includes("Brightwater Trust"));
  }
  const allHidden = { ...saved, houses: [], rows: saved.rows.map(r => ({ ...r, hidden: true })) };
  assert.equal(tradeSection(allHidden, false), "");
  assert.equal(cleanTrade({ rows: [{ ...saved.rows[0], hidden: "false" }] }).rows[0].hidden, false);
});
test("trade data loads once for several cards and reuses its catalogue on price changes", async () => {
  const x = fixture(); await Promise.all([x.service.get("toril", neverwinter), x.service.get("toril", { id: "phandalin", name: "Phandalin" })]); x.scale("x5"); await x.service.get("toril", neverwinter); assert.equal(x.loads(), 1);
});
test("failed trade downloads can retry instead of permanently caching a rejection", async () => {
  let calls = 0; const s = new TradeMarkets({ load: async () => { if (++calls === 1) throw Error("offline"); return structuredClone(raw); } });
  await assert.rejects(s.get("toril", neverwinter), /offline/); assert.ok((await s.get("toril", neverwinter)).rows.length);
});
test("profile mapping survives renamed places and does not fuzzy-match nearby names", async () => {
  const x = fixture(); assert.equal((await x.service.get("toril", { ...neverwinter, name: "My Neverwinter" })).profile, "neverwinter");
  assert.equal((await x.service.get("toril", { id: "custom", name: "Neverwinter Wood" })).rows.length, 0);
  assert.equal((await x.service.get("toril", { id: "custom", name: "A new name", original: "Phandalin" })).profile, "phandalin");
});
test("location overrides stay local, reset to source defaults and permit custom goods", async () => {
  gmGame(); const x = fixture(), first = await x.service.get("toril", neverwinter);
  first.rows.find(r => r.good === "timber").base = 4;
  first.rows.push({ key: "custom", name: "My goods", unit: "1 crate", group: "imports", base: 3, mod: 2, availability: "Stocked" });
  await x.service.save("toril", neverwinter.id, first, first.revision);
  assert.equal((await x.service.get("toril", neverwinter)).rows.find(r => r.key === "custom").base, 3);
  const other = await x.service.get("toril", { id: "custom-other", name: "Neverwinter" }); assert.equal(other.rows.find(r => r.good === "timber").base, 1);
  await x.service.save("toril", neverwinter.id, null); assert.equal((await x.service.get("toril", neverwinter)).rows.find(r => r.good === "timber").base, 1);
});
test("player calls cannot save trade and invalid prices cannot enter the world setting", async () => {
  gmGame(); game.user.isGM = false; const x = fixture(); await assert.rejects(x.service.save("toril", "x", { rows: [] }), /GM/); assert.deepEqual(x.edits(), {});
  const row = { key: "r", name: "Salt", unit: "1 lb", group: "exports", base: 1, mod: 1 };
  for (const base of [NaN, Infinity, -1, "1"]) assert.throws(() => cleanTrade({ rows: [{ ...row, base }] }), /prices/);
  assert.throws(() => cleanTrade({ rows: [row, row] }), /identifier/); assert.equal(cleanTrade({ rows: [{ ...row, base: 0 }] }).rows[0].base, 0);
});
test("rumoured-card callers can omit trade, while public trade pills escape data and hide GM provenance", () => {
  gmGame(); globalThis.foundry = { utils: { escapeHTML: s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]) } };
  const market = { rows: [{ key: "x", name: '<img onerror="bad">', group: "exports", base: 1, mod: 1, unit: "1 lb", availability: "Stocked", source: "GM provenance" }], houses: [], scale: 2 };
  const player = tradeSection(market, false); assert.ok(player.includes("2 gp")); assert.ok(!player.includes("<img")); assert.ok(!player.includes("GM provenance")); assert.ok(!player.includes('data-act="trade-edit"'));
  assert.ok(tradeSection(market, true).includes('data-act="trade-edit"')); assert.equal(tradeSection(null, false), ""); assert.equal(tradeSection({ rows: [], houses: [] }, false), "");
});
