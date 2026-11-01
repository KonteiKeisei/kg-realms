import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ridePrice, RIDE_DEALS } from "../scripts/travel.mjs";
import { spotTitle, spotName } from "../scripts/map-layers.mjs";

test("out of the box a wagon is a free ride and a coach charges the book's fare", () => {
  assert.equal(ridePrice(100, "wagon"), null);
  assert.deepEqual(ridePrice(100, "coach"), { gp: 3, paid: false });
});

test("either can charge, be free or pay, per mile for each member", () => {
  assert.deepEqual(ridePrice(100, "wagon", { terms: { wagon: "fare" } }), { gp: 2, paid: false });
  assert.deepEqual(ridePrice(100, "wagon", { terms: { wagon: "paid" } }), { gp: 8, paid: true });
  assert.deepEqual(ridePrice(100, "coach", { terms: { coach: "paid" } }), { gp: 4, paid: true });
  assert.equal(ridePrice(100, "coach", { terms: { coach: "free" } }), null);
});

test("the GM's rates and the world's prices apply; other ways of travel are not priced", () => {
  assert.deepEqual(ridePrice(100, "coach", { terms: { coach: "paid" }, pays: { coach: 10 } }), { gp: 10, paid: true });
  assert.deepEqual(ridePrice(100, "coach", { fares: { coach: 5 } }), { gp: 5, paid: false });
  assert.deepEqual(ridePrice(100, "coach", {}, 2), { gp: 6, paid: false });
  for (const m of ["foot", "mounted", "flying", "custom"]) assert.equal(ridePrice(100, m), null, m);
});

test("pay is about a skilled hireling's day at each one's daily distance", () => {
  assert.equal(RIDE_DEALS.pays.wagon * 24 / 100, 1.92);
  assert.equal(RIDE_DEALS.pays.coach * 48 / 100, 1.92);
});

const square = (x, y, r) => [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];
const empire = { id: "e", name: "Salvae Empire", kind: "domain", class: "Empire", lon: 90, lat: 90 };
const empiria = { id: "m", name: "Empiria", kind: "territory", class: "Region", partOf: "e", lon: 0, lat: 0, area: square(0, 0, 10) };
const arine = (miles) => ({ id: "a", name: "Arine", kind: "settlement", class: "City", miles });
const bay = { id: "b", name: "Turquoise Bay", class: "Bay", lon: 1, lat: 1, area: square(1, 1, 2) };
const at = (list, f = spotTitle) => f(1, 1, list, (p) => p.miles ?? 999);

test("a journey's title uses the short name; the route keeps the whole line", () => {
  assert.equal(at([empire, empiria, arine(2)]), "Arine");
  assert.equal(at([empire, empiria, arine(2)], spotName), "In Arine, Empiria, Salvae Empire");
  assert.equal(at([empire, empiria, bay, arine(30)]), "Turquoise Bay");
  assert.equal(at([empire, empiria, arine(30)]), "Arine");
  assert.equal(at([empire, empiria]), "Empiria");
  assert.equal(at([]), "Wilderness");
});

test("the panel: Stay stays; titles and deals are wired in", () => {
  const hud = readFileSync(new URL("../scripts/ui-hud.mjs", import.meta.url), "utf8");
  assert.ok(!hud.includes("Go on from here"));
  assert.ok(hud.includes('<label class="stay" title="Days to stay here">'));
  assert.ok(!hud.includes('${sts[0].name ?? "Start"}'));
  assert.ok(hud.includes("Paid as escort")); assert.ok(hud.includes("Paid to guard")); assert.ok(hud.includes('name="term-'));
});

test("the rules say it plainly", () => {
  const rules = readFileSync(new URL("../scripts/travel-rules.mjs", import.meta.url), "utf8");
  assert.ok(rules.includes("Encumbrance and slow walkers don't slow the party")); assert.ok(rules.includes("paid as an escort"));
});
