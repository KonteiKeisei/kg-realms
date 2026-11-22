// 0.96.7: a route edit during a journey never changes the way already travelled.
import test from "node:test";
import assert from "node:assert/strict";
import { keepTravelled, freezeTravel } from "../scripts/route-pin.mjs";
import { buildGraph, itinerary, terrainLookup } from "../scripts/travel.mjs";

const A = { lon: 1, lat: 1, stop: true }, B = { lon: 2, lat: 2, stop: true }, C = { lon: 3, lat: 3, stop: true };
const NEW = { lon: 1.5, lat: 1.2, stop: true }, PIN = { lon: 0.5, lat: 0.5, stop: true, pinned: true };
const old = { waypoints: [A, B], stays: [0, 0], legModes: [null, "sea"], legMethods: [], legVessels: [], legFares: [], legWays: [] };

test("a stop added to the leg the party is on first pins where they stand", () => {
  // Party partway along leg 0 (start to A). The new stop goes before A.
  const edit = { waypoints: [NEW, A, B], stays: [0, 0, 0], legModes: [null, null, "sea"] };
  const r = keepTravelled(old, edit, { cur: 0, mid: true, pin: PIN });
  assert.equal(r.pinned, true);
  assert.deepEqual(r.changes.waypoints, [PIN, NEW, A, B]);
  assert.deepEqual(r.changes.legModes, [null, null, null, "sea"]);
  assert.deepEqual(r.changes.stays, [0, 0, 0, 0]);
});

test("an edit further ahead leaves the party's leg alone: no pin", () => {
  const r = keepTravelled(old, { waypoints: [A, B, C] }, { cur: 0, mid: true, pin: PIN });
  assert.equal(r.pinned, false);
  assert.deepEqual(r.changes.waypoints, [A, B, C]);
});

test("anything behind the party is refused", () => {
  // Party on leg 1 (A to B): A is behind them.
  assert.equal(keepTravelled(old, { waypoints: [C, B] }, { cur: 1, mid: true, pin: PIN }).refused, true);
  assert.equal(keepTravelled(old, { legModes: ["sea", "sea"] }, { cur: 1, mid: true, pin: PIN }).refused, true);
  assert.equal(keepTravelled(old, { waypoints: [B] }, { cur: 1, mid: true, pin: PIN }).refused, true);
});

test("at a stop, its stay can still change, and the next leg changes without a pin", () => {
  const r = keepTravelled(old, { stays: [8, 0], waypoints: [A, C] }, { cur: 1, mid: false, pin: null });
  assert.equal(r.pinned, false);
  assert.deepEqual(r.changes.waypoints, [A, C]);
});

test("moving the end of the party's leg pins first; its way of travel goes on both halves", () => {
  const r = keepTravelled(old, { waypoints: [A, C] }, { cur: 1, mid: true, pin: PIN });
  assert.deepEqual(r.changes.waypoints, [A, PIN, C]);
  assert.deepEqual(r.changes.legModes, [null, "sea", "sea"]);
});

// 0.97.3: a new pace mid-journey used to retime the whole route and move the party back past camps.
test("a pace change mid-leg pins where the party stands and keeps the old pace on the way travelled", () => {
  const s = { ...old, pace: "fast", hours: 8, method: "foot", legTravel: [] };
  const r = freezeTravel(s, { pace: "slow" }, { cur: 1, mid: true, pin: PIN });
  assert.equal(r.frozen, true);
  assert.equal(r.pinned, true);
  assert.deepEqual(r.changes.waypoints, [A, PIN, B]);
  assert.equal(r.changes.pace, "slow");
  assert.deepEqual(r.changes.legTravel.map((t) => t?.pace ?? null), ["fast", "fast"]);
  assert.deepEqual(r.changes.legModes, [null, "sea", "sea"]);
});

test("a pace change at a stop freezes only the legs behind; an earlier freeze is kept; no change, nothing", () => {
  const s = { ...old, pace: "normal", hours: 8, legTravel: [{ pace: "slow", hours: 8 }] };
  const r = freezeTravel(s, { pace: "fast" }, { cur: 1, mid: false, pin: null });
  assert.equal(r.pinned, false);
  assert.equal("waypoints" in r.changes, false);
  assert.deepEqual(r.changes.legTravel.map((t) => t.pace), ["slow"]);
  assert.equal(freezeTravel(s, { pace: "normal" }, { cur: 1, mid: true, pin: PIN }).frozen, false);
  assert.equal(freezeTravel(s, { name: "x" }, { cur: 1, mid: true, pin: PIN }).frozen, false);
});

test("a leg keeps its own pace: changing the route's pace leaves its hours alone", () => {
  const cell = 10, W = 100, H = 10, data = new Uint8Array(W * H).fill(1);
  const terrainAt = terrainLookup({ data, width: W, height: H, cell });
  const road = { type: "Feature", properties: { id: "r", kind: "road" }, geometry: { type: "LineString", coordinates: [[0, 50], [400, 50], [800, 50]] } };
  const graph = buildGraph([road], (a, b) => [a, b], []);
  const opts = { mode: "roads", terrainAt, milesPerPixel: 0.1 };
  const before = itinerary(graph, [[0, 50], [400, 50], [800, 50]], { ...opts, pace: "fast" });
  const after = itinerary(graph, [[0, 50], [400, 50], [800, 50]], { ...opts, pace: "slow", legs: [{ pace: "fast", hoursPerDay: 8 }] });
  assert.ok(Math.abs(after.legEnds[0] - before.legEnds[0]) < 1e-9, "the leg travelled keeps its time");
  assert.ok(after.legEnds[1] - after.legEnds[0] > before.legEnds[1] - before.legEnds[0], "the way on is slower");
});
test("a wagon leg to or from a stop put where the party stood may leave the road", () => {
  const cell = 10, W = 100, H = 30, data = new Uint8Array(W * H).fill(1);
  const terrainAt = terrainLookup({ data, width: W, height: H, cell });
  const road = { type: "Feature", properties: { id: "r", kind: "road" }, geometry: { type: "LineString", coordinates: [[0, 50], [400, 50], [800, 50]] } };
  const graph = buildGraph([road], (a, b) => [a, b], []);
  const opts = { mode: "roads", terrainAt, milesPerPixel: 0.1 };
  const off = [100, 250], wagon = { method: { key: "wagon", baseMph: 3 } };
  assert.equal(itinerary(graph, [off, [800, 50]], { ...opts, legs: [wagon] }), null, "an ordinary stop that far off the road: no wagon route");
  assert.ok(itinerary(graph, [off, [800, 50]], { ...opts, legs: [{ ...wagon, pinned: true }] }), "from where the party stood, it goes");
});
test("renaming a stop already behind the party is allowed: a name is not the route", () => {
  const r = keepTravelled(old, { waypoints: [{ ...A, name: "Camp Dread", named: true }, B] }, { cur: 1, mid: true, pin: PIN });
  assert.equal(r.refused, undefined);
  assert.equal(r.pinned, false);
});
