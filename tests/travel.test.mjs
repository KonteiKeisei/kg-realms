import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { buildGraph, planJourney, schedule, perceptionAgainst, terrainLookup, forcedMarchDCs, itinerary, speedFactor, TERRAIN, PACES } from "../scripts/travel.mjs";
import { lonLatToSource, SOURCE_MAP } from "../scripts/source-map.mjs";

const routes = JSON.parse(readFileSync(new URL("../data/worlds/toril/routes.geojson", import.meta.url)));
const places = JSON.parse(readFileSync(new URL("../data/worlds/toril/index.json", import.meta.url))).places;
const at = (n) => places.find((p) => p.name === n).mapAnchor;
const mpp = SOURCE_MAP.milesPerPixel;

test("paces follow the 2014 table", () => {
  assert.deepEqual(Object.values(PACES).map((p) => p.mph * 8), [32, 24, 16]);
  assert.equal(PACES.fast.perception, -5);
  assert.deepEqual(forcedMarchDCs(10), [11, 12]);
});

test("Waterdeep to Daggerford follows the High Road at road pace", async () => {
  const { data, info } = await sharp(readFileSync(new URL("../data/worlds/toril/terrain.png", import.meta.url))).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  const terrainAt = terrainLookup({ data, width: info.width, height: info.height, cell: 4 });
  const graph = buildGraph(routes.features, lonLatToSource);
  const plan = planJourney(graph, at("Waterdeep"), at("Daggerford"), { milesPerPixel: mpp, terrainAt });
  assert.ok(plan);
  const onRoad = plan.legs.filter((l) => l.kind !== "offroad").reduce((s, l) => s + l.miles, 0);
  assert.ok(onRoad / plan.miles > 0.9, `${onRoad} of ${plan.miles} miles on roads`);
  assert.ok(plan.miles > 100 && plan.miles < 125, `${plan.miles} miles`);
  const normal = schedule(plan, { pace: "normal", milesPerPixel: mpp, terrainAt });
  const fast = schedule(plan, { pace: "fast", milesPerPixel: mpp, terrainAt });
  assert.ok(fast.hours < normal.hours);
  // An encounter on the road lands on a day, and fast pace costs passive Perception.
  const mid = plan.legs.find((l) => l.kind !== "offroad").pts[3];
  const s = schedule(plan, { pace: "fast", milesPerPixel: mpp, terrainAt, encounters: [{ id: "e", name: "Ambush", at: mid, dc: 14 }] });
  assert.equal(s.days.flatMap((d) => d.encounters).length, 1);
  // Each night but the last ends in a camp on the path.
  assert.equal(normal.camps.length, normal.days.length - 1);
  for (const c of normal.camps) assert.ok(Array.isArray(c.at) && Number.isFinite(c.at[0]));
  const r = perceptionAgainst([{ name: "Ana", passive: 16 }, { name: "Bo", passive: 12 }], 14, "fast");
  assert.deepEqual(r.map((c) => c.notices), [false, false]);
  assert.deepEqual(perceptionAgainst([{ name: "Ana", passive: 16 }], 14, "normal").map((c) => c.notices), [true]);
});

test("difficult terrain halves off-road progress", () => {
  const forest = { name: "forest", difficult: true, rough: true }, plain = { name: "plains", difficult: false };
  const plan = { legs: [{ kind: "offroad", pts: [[0, 0], [100, 0]] }] };
  const a = schedule(plan, { milesPerPixel: 1, terrainAt: () => plain }), b = schedule(plan, { milesPerPixel: 1, terrainAt: () => forest });
  assert.ok(Math.abs(b.hours - 2 * a.hours) < 1e-6);
});

test("2024 pace caps: terrain limits the pace, roads lift it, trails ease it", () => {
  const f = (kind, t, pace) => speedFactor(kind, TERRAIN[t], { rules: "2024", pace });
  assert.equal(f("offroad", 9, "fast"), 1);          // grassland allows fast
  assert.equal(f("offroad", 2, "fast"), 3 / 4);      // forest caps at normal
  assert.equal(f("offroad", 4, "normal"), 2 / 3);    // mountains cap at slow
  assert.equal(f("trail", 4, "normal"), 1);          // a trail eases slow to normal
  assert.equal(f("road", 4, "fast"), 1);             // a road lifts the cap
});

test("an itinerary through waypoints counts travel and stay days", () => {
  const graph = buildGraph(routes.features, lonLatToSource);
  const it = itinerary(graph, [at("Waterdeep"), at("Daggerford"), at("Baldur's Gate")], { stays: [2], mode: "roads", milesPerPixel: mpp });
  assert.ok(it && it.legs.length === 2);
  assert.equal(it.days.filter((d) => d.type === "stay").length, 2);
  assert.equal(it.days.length, it.legs[0].days + 2 + it.legs[1].days);
  // Waterdeep to Daggerford keeps to the High Road (the DM map has no road on to Baldur's Gate).
  assert.ok(it.legs[0].plan.legs.filter((l) => l.kind === "road").reduce((s, l) => s + l.miles, 0) > it.legs[0].miles * 0.8);
});


test("party speed sets the pace: 25 ft is 2.5 mph at normal pace", () => {
  const plan = { legs: [{ kind: "road", pts: [[0, 0], [100, 0]] }] };
  const a = schedule(plan, { milesPerPixel: 1, baseMph: 3 }), b = schedule(plan, { milesPerPixel: 1, baseMph: 2.5 });
  assert.ok(Math.abs(a.hours - 100 / 3) < 1e-6 && Math.abs(b.hours - 40) < 1e-6);
  const fast = schedule(plan, { milesPerPixel: 1, baseMph: 2.5, pace: "fast" });
  assert.ok(Math.abs(fast.hours - 100 / (2.5 * 4 / 3)) < 1e-6);
});
