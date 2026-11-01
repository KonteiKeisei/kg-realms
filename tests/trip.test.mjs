import { test } from "node:test";
import assert from "node:assert/strict";
import { replayTrip, encounterHours } from "../scripts/travel.mjs";

const H = 3600, T0 = 1000000;
const plan = (extra = {}) => ({ hours: 20, encounters: [], stays: [], ...extra });
const trip = (extra = {}) => ({ departed: T0, decisions: [], resumed: {}, halts: [], ...extra });

test("the party moves with the clock", () => {
  assert.equal(replayTrip(trip(), plan(), T0 + 3 * H).hour, 3);
  assert.equal(replayTrip(trip(), plan(), T0 + 3 * H).status, "moving");
  assert.equal(replayTrip(trip(), plan(), T0 - H).hour, 0);
});

test("after a day's travel it waits for camp or push on", () => {
  const p = replayTrip(trip(), plan(), T0 + 12 * H);
  assert.equal(p.status, "decide");
  assert.equal(p.hour, 8);
  assert.equal(p.since, T0 + 8 * H);
  // Camp 16 hours from the moment the day ended, then on again.
  const camp = trip({ decisions: [{ rest: 16 }] });
  assert.equal(replayTrip(camp, plan(), T0 + 12 * H).status, "resting");
  assert.equal(replayTrip(camp, plan(), T0 + 12 * H).hour, 8);
  assert.equal(replayTrip(camp, plan(), T0 + 26 * H).hour, 10);
  // Push on: one more hour, then asked again.
  const push = replayTrip(trip({ decisions: [{ push: true }] }), plan(), T0 + 12 * H);
  assert.equal(push.status, "decide");
  assert.equal(push.hour, 9);
  assert.equal(push.stop, 1);
});

test("encounters stop the party until the GM carries on", () => {
  const p = plan({ encounters: [{ id: "a", name: "Orcs", hour: 2 }] });
  assert.equal(replayTrip(trip(), p, T0 + 5 * H).status, "encounter");
  assert.equal(replayTrip(trip(), p, T0 + 5 * H).hour, 2);
  const on = replayTrip(trip({ resumed: { a: T0 + 4 * H } }), p, T0 + 5 * H);
  assert.equal(on.status, "moving");
  assert.equal(on.hour, 3);
});

test("halts, stays and arrival", () => {
  assert.equal(replayTrip(trip({ halts: [{ from: T0 + H, to: null }] }), plan(), T0 + 5 * H).hour, 1);
  assert.equal(replayTrip(trip({ halts: [{ from: T0 + H, to: T0 + 3 * H }] }), plan(), T0 + 5 * H).hour, 3);
  const stay = replayTrip(trip(), plan({ stays: [{ hour: 4, seconds: 24 * H }] }), T0 + 10 * H);
  assert.equal(stay.status, "stay");
  assert.equal(stay.hour, 4);
  const done = replayTrip(trip({ decisions: [{ rest: 16 }, { rest: 16 }] }), plan(), T0 + 100 * H);
  assert.equal(done.status, "arrived");
  assert.equal(done.hour, 20);
});

test("skipping ahead to an encounter makes camp on the way", () => {
  const p = replayTrip(trip(), plan({ encounters: [{ id: "a", hour: 18 }] }), Infinity, { autoRest: 16 });
  assert.equal(p.status, "encounter");
  assert.equal(p.made.length, 2);
  assert.equal(p.since, T0 + 18 * H + 32 * H);
  const rest = replayTrip(trip(), plan(), Infinity);
  assert.equal(rest.status, "decide");
  assert.equal(rest.since, T0 + 8 * H);
});

test("encounters land on the route nearest them", () => {
  const track = [0, 1, 2, 3].map((i) => ({ at: [i * 10, 0], hour: i }));
  const out = encounterHours(track, [{ id: "a", at: [21, 3], radius: 5 }, { id: "b", at: [0, 50], radius: 5 }]);
  assert.deepEqual(out.map((e) => [e.id, e.hour]), [["a", 2]]);
});

test("the route sheet lists where the going changes, with roads named from the map", async () => {
  const { readFileSync } = await import("node:fs");
  const { buildGraph, itinerary, routeSheet } = await import("../scripts/travel.mjs");
  const { lonLatToSource, SOURCE_MAP } = await import("../scripts/source-map.mjs");
  const routes = JSON.parse(readFileSync(new URL("../data/worlds/toril/routes.geojson", import.meta.url)));
  const places = JSON.parse(readFileSync(new URL("../data/worlds/toril/index.json", import.meta.url))).places;
  const pos = (p) => p.mapAnchor ?? lonLatToSource(p.lon, p.lat);
  const at = (n) => pos(places.find((p) => p.name === n));
  const g = buildGraph(routes.features, lonLatToSource, places.filter((p) => ["Road", "Trail"].includes(p.class)).map((p) => ({ name: p.name, at: pos(p) })));
  const it = itinerary(g, [at("Waterdeep"), at("Daggerford")], { mode: "roads", milesPerPixel: SOURCE_MAP.milesPerPixel });
  const sh = routeSheet(it, { stops: [{ name: "Waterdeep", keep: true }, { name: "Daggerford", keep: true }], places: [], milesPerPixel: SOURCE_MAP.milesPerPixel });
  assert.equal(sh.nodes[0].name, "Waterdeep");
  assert.equal(sh.nodes.at(-1).name, "Daggerford");
  assert.equal(sh.segments.length, sh.nodes.length - 1);
  // The way is a named road (the shipped names or the map's labels), not just "Road".
  assert.ok(sh.segments.some((s) => s.kind !== "offroad" && !/^(Road|Trail)$/.test(s.via)), sh.segments.map((s) => s.via).join(", "));
  assert.ok(Math.abs(sh.segments.reduce((a, s) => a + s.miles, 0) - it.miles) < 1);
});

test("a point that only shapes the path, a little off a trail, does not leave the trail", async () => {
  const { readFileSync } = await import("node:fs");
  const { buildGraph, itinerary, routeSheet } = await import("../scripts/travel.mjs");
  const { lonLatToSource, SOURCE_MAP } = await import("../scripts/source-map.mjs");
  const routes = JSON.parse(readFileSync(new URL("../data/worlds/toril/routes.geojson", import.meta.url)));
  const places = JSON.parse(readFileSync(new URL("../data/worlds/toril/index.json", import.meta.url))).places;
  const pos = (p) => lonLatToSource(p.lon, p.lat), at = (n) => pos(places.find((p) => p.name === n));
  const g = buildGraph(routes.features, lonLatToSource, places.filter((p) => ["Road", "Trail"].includes(p.class)).map((p) => ({ name: p.name, at: pos(p) })));
  const trail = routes.features.find((f) => /Triaboar/.test(f.properties.name ?? "")).geometry.coordinates;
  const mid = lonLatToSource(...trail[Math.floor(trail.length / 2)]);
  const off = [mid[0] + 5, mid[1] + 3];
  const it = itinerary(g, [at("Old Owl Well"), off, at("Helm's Hold")], { mode: "roads", milesPerPixel: SOURCE_MAP.milesPerPixel });
  const sh = routeSheet(it, { stops: [{ name: "Old Owl Well", keep: true }, { name: "via", keep: false }, { name: "Helm's Hold", keep: true }], places: [], milesPerPixel: SOURCE_MAP.milesPerPixel });
  assert.ok(!sh.nodes.some((n) => /^Leave/.test(n.name)), sh.nodes.map((n) => n.name).join(", "));
});

test("a long off-road stretch made of short pieces is not called a road", async () => {
  const { routeSheet } = await import("../scripts/travel.mjs");
  const mpp = 0.3, piece = (kind, name, x0, x1) => ({ kind, name, pts: [[x0, 0], [x1, 0]] });
  // 10 px of road, three off-road pieces of 7 px (about 2 mi each, 6 mi together), then the road again.
  const legs = [piece("road", "High Road", 0, 10), piece("offroad", null, 10, 17), piece("offroad", null, 17, 24), piece("offroad", null, 24, 31), piece("road", "High Road", 31, 41)];
  const itin = { legs: [{ plan: { legs } }], track: [{ at: [0, 0], hour: 0 }, { at: [41, 0], hour: 4 }], hours: 4 };
  const sh = routeSheet(itin, { stops: [{ name: "A", keep: true }, { name: "B", keep: true }], milesPerPixel: mpp });
  assert.ok(sh.segments.some((s) => s.kind === "offroad"), sh.segments.map((s) => s.via).join(", "));
  // One short piece between the same road still counts as the road.
  const short = [piece("road", "High Road", 0, 10), piece("offroad", null, 10, 15), piece("road", "High Road", 15, 25)];
  const sh2 = routeSheet({ legs: [{ plan: { legs: short } }], track: [{ at: [0, 0], hour: 0 }, { at: [25, 0], hour: 2 }], hours: 2 }, { stops: [{ name: "A", keep: true }, { name: "B", keep: true }], milesPerPixel: mpp });
  assert.deepEqual(sh2.segments.map((s) => s.via), ["High Road"]);
});

test("the day of a travel hour follows the schedule: a day's travel, camp, and stays that reset the day", async () => {
  const { elapsedAt } = await import("../scripts/travel.mjs");
  const day = (plan, h) => Math.floor(elapsedAt(plan, h, { hoursPerDay: 8, rest: 16 }) / 24 + 1e-9) + 1;
  const stay = { hours: 30, stays: [{ hour: 6, seconds: 2 * 86400 }] };
  assert.equal(elapsedAt(stay, 9, { hoursPerDay: 8, rest: 16 }), 57);
  assert.equal(day(stay, 9), 3);
  assert.equal(day({ hours: 30, stays: [] }, 7), 1);
  assert.equal(day({ hours: 30, stays: [] }, 9), 2);
  assert.equal(day({ hours: 30, stays: [] }, 17), 3);
});
