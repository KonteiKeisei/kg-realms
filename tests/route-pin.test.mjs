// 0.96.7: a route edit during a journey never changes the way already travelled.
import test from "node:test";
import assert from "node:assert/strict";
import { keepTravelled } from "../scripts/route-pin.mjs";

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
