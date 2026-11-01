import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, itinerary, planJourney, terrainLookup } from "../scripts/travel.mjs";

// A 1,000 px square sheet: land in the west, sea from x 600 east. The town stands on the shore at
// x 602, just inside a water cell, as a port drawn on the coast does.
const cell = 10, W = 100, H = 100, data = new Uint8Array(W * H).fill(1);
for (let y = 0; y < H; y++) for (let x = 60; x < W; x++) data[y * W + x] = 8;
const terrainAt = terrainLookup({ data, width: W, height: H, cell });
const toSheet = (lon, lat) => [lon, lat];
const road = { type: "Feature", properties: { id: "r", kind: "road" }, geometry: { type: "LineString", coordinates: [[100, 500], [400, 500], [602, 500]] } };
const graph = buildGraph([road], toSheet, []);
const opts = { mode: "roads", terrainAt, milesPerPixel: 0.5 };

test("a journey may end at a town on the water's edge", () => {
  const plan = planJourney(graph, [100, 500], [602, 500], opts);
  assert.ok(plan, "the way to the shore town is found");
  assert.ok(Math.abs(plan.miles - 251) < 2);
  const trip = itinerary(graph, [[100, 500], [602, 500]], { mode: "roads", terrainAt, milesPerPixel: 0.5 });
  assert.ok(trip && trip.legs.length === 1);
});

test("a journey may start at a town on the water's edge", () => {
  assert.ok(planJourney(graph, [602, 500], [100, 500], opts));
});

test("with no way overland, a leg goes by boat when water joins its ends", () => {
  const seaPlan = (from, to) => ({ legs: [{ kind: "sea", pts: [from, to], miles: Math.hypot(to[0] - from[0], to[1] - from[1]) * 0.5 }], miles: Math.hypot(to[0] - from[0], to[1] - from[1]) * 0.5, normalHours: 1 });
  const island = [900, 500];
  const trip = itinerary(buildGraph([], toSheet, []), [[100, 500], island], { mode: "roads", terrainAt, milesPerPixel: 0.5, seaPlan, legs: [{ seaFallback: { vessel: { mph: 2, crewed: true } } }] });
  assert.ok(trip, "the island is reached");
  assert.equal(trip.legs[0].sea, true);
  assert.equal(trip.legs[0].autoSea, true);
  assert.equal(itinerary(buildGraph([], toSheet, []), [[100, 500], island], { mode: "roads", terrainAt, milesPerPixel: 0.5, seaPlan: () => null, legs: [{ seaFallback: { vessel: { mph: 2 } } }] }), null, "no water route either: no journey");
});

test("open water further out still blocks a way overland", () => {
  assert.equal(planJourney(buildGraph([], toSheet, []), [100, 500], [900, 500], opts), null);
});
