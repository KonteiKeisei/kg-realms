import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildGraph, itinerary, methodSpeed, planJourney, roadGapMiles, roadReachMiles, METHODS, TERRAIN } from "../scripts/travel.mjs";

const line = (id, pts, kind = "road") => ({ type: "Feature", properties: { id, kind, name: id }, geometry: { type: "LineString", coordinates: pts } });
const graphOf = (...f) => buildGraph(f, (x, y) => [x, y]);
const road = graphOf(line("King's Road", [[0, 0], [100, 0], [200, 0]]));
const opts = { milesPerPixel: 1, terrainAt: () => TERRAIN[1], hookPx: 2000 };
const wagon = { method: { key: "wagon", baseMph: 3 } }, coach = { method: { key: "coach", baseMph: 3 } };
const plain = { milesPerPixel: 1, terrainAt: () => TERRAIN[1], hoursPerDay: 8 };

test("a wagon or coach follows the road between stops beside it", () => {
  for (const how of [wagon, coach]) {
    const r = itinerary(road, [[0, 1], [200, 1]], { ...plain, legs: [how], mode: "roads" });
    assert.ok(r, how.method.key);
    assert.ok(r.ground.road > 190); assert.ok(r.ground.offroad < 5);
  }
});

test("it never goes across country, even when that is far shorter", () => {
  const bend = graphOf(line("Long Way", [[0, 0], [0, 500], [100, 500], [100, 0]]));
  const on = itinerary(bend, [[0, 0], [100, 0]], { ...plain, legs: [wagon], mode: "roads" });
  assert.ok(on.ground.road > 1000, "the long way round");
  assert.ok(itinerary(bend, [[0, 0], [100, 0]], { ...plain, legs: [{ method: { key: "foot", baseMph: 3 } }], mode: "roads" }).ground.road < 1, "on foot cuts across");
});

test("a stop far from any road, or roads that do not meet, is no way at all; the button to go direct does not rescue it", () => {
  assert.equal(itinerary(road, [[0, 1], [100, 300]], { ...plain, legs: [wagon], mode: "roads" }), null);
  assert.equal(itinerary(road, [[0, 1], [100, 300]], { ...plain, legs: [wagon], legModes: ["direct"], mode: "roads" }), null);
  const apart = graphOf(line("West", [[0, 0], [100, 0]]), line("East", [[500, 0], [600, 0]]));
  assert.equal(itinerary(apart, [[0, 0], [600, 0]], { ...plain, legs: [coach], mode: "roads" }), null);
  assert.equal(itinerary(graphOf(), [[0, 0], [10, 0]], { ...plain, legs: [wagon], mode: "roads" }), null, "a map with no roads");
  assert.ok(itinerary(road, [[0, 1], [100, 300]], { ...plain, legs: [{ method: { key: "foot", baseMph: 3 } }], mode: "roads" }), "on foot still can");
});

test("trails count as roads for it", () => {
  const t = graphOf(line("Goat Path", [[0, 0], [100, 0]], "trail"));
  assert.ok(itinerary(t, [[0, 0], [100, 0]], { ...plain, legs: [wagon], mode: "roads" }).ground.trail > 90);
});

test("beside a road means near any part of it, scaled to the map", () => {
  assert.equal(roadGapMiles(road, [50, 2], 1), 2, "the middle of a long stretch");
  assert.equal(roadGapMiles(road, [50, 2], 0.5), 1);
  assert.equal(roadGapMiles(graphOf(), [0, 0], 1), Infinity);
  assert.equal(roadReachMiles(0.1), 3); assert.equal(roadReachMiles(1), 24);
  assert.equal(planJourney(road, [0, 1], [100, 30], { ...opts, mode: "roadsOnly" }) === null, true);
  assert.ok(planJourney(road, [0, 1], [100, 20], { ...opts, mode: "roadsOnly" }));
});

test("a coach is faster than a wagon on roads only, and pace scales it; the GM's speed wins", () => {
  const T = TERRAIN[1], at = (m, kind, o = {}) => methodSpeed(m, o)(kind, T);
  assert.equal(METHODS.coach.roadMph, 6); assert.equal(METHODS.wagon.roadMph, undefined);
  assert.equal(at({ key: "coach" }, "road"), 6); assert.equal(at({ key: "wagon" }, "road"), 3);
  assert.equal(at({ key: "coach" }, "trail"), at({ key: "wagon" }, "trail"), "no stations on a trail");
  assert.equal(at({ key: "coach" }, "road", { pace: "fast" }), 8); assert.equal(at({ key: "coach" }, "road", { pace: "slow" }), 4);
  assert.equal(at({ key: "coach", roadMph: 9 }, "road"), 9);
});

test("a coach gets there in about half a wagon's time on the road", () => {
  const hours = (how) => itinerary(road, [[0, 0], [200, 0]], { ...plain, legs: [how], mode: "roads" }).legs[0].hours;
  assert.ok(Math.abs(hours(coach) * 2 - hours(wagon)) < 0.01, `${hours(coach)} and ${hours(wagon)}`);
});

test("walkers and riders are not affected", () => {
  const T = TERRAIN[1];
  assert.equal(methodSpeed({ key: "foot", baseMph: 3 })("road", T), 3);
  assert.equal(methodSpeed({ key: "mounted" })("road", T), 3);
  assert.ok(!METHODS.foot.roadsOnly && !METHODS.mounted.roadsOnly && !METHODS.flying.roadsOnly && !METHODS.custom.roadsOnly);
});

test("the panel explains it, drops the go-direct button, and takes the coach's speed", () => {
  const hud = readFileSync(new URL("../scripts/ui-hud.mjs", import.meta.url), "utf8");
  assert.ok(hud.includes("goes only by road and trail")); assert.ok(hud.includes("!roadsOnly && !done")); assert.ok(hud.includes('name="coachMph"'));
  assert.ok(hud.includes("roads and trails only")); assert.ok(!hud.includes("slow pace off the roads"));
});
