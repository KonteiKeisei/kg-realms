import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyRouteEdits, editsBetween, nearestOnLine } from "../scripts/routes.mjs";
import { sourceMapStyle, SOURCE_MAP } from "../scripts/source-map.mjs";

const base = { type: "FeatureCollection", features: [
  { type: "Feature", properties: { id: "a", kind: "road", name: "High Road" }, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
  { type: "Feature", properties: { id: "b", kind: "trail", name: null }, geometry: { type: "LineString", coordinates: [[2, 2], [3, 3]] } }
] };

test("route edits move, retype, delete and add routes", () => {
  const out = applyRouteEdits(base, {
    edited: { a: { kind: "road", name: "High Road", coordinates: [[0, 0], [0.5, 0.7], [1, 1]] } },
    deleted: ["b"],
    added: { n: { kind: "trail", name: null, coordinates: [[5, 5], [6, 6]], from: "p1", to: "p2" } }
  });
  assert.deepEqual(out.features.map((f) => f.properties.id), ["a", "n"]);
  assert.equal(out.features[0].geometry.coordinates.length, 3);
  assert.equal(out.features[0].properties.edited, true);
  assert.equal(out.features[1].properties.from, "p1");
  assert.equal(out.features[1].properties.added, true);
});

test("an imported network becomes the edits that reproduce it", () => {
  const target = { type: "FeatureCollection", features: [
    { ...base.features[0], geometry: { type: "LineString", coordinates: [[0, 0], [2, 2]] } },
    { type: "Feature", properties: { id: "x", kind: "road", name: "New" }, geometry: { type: "LineString", coordinates: [[9, 9], [8, 8]] } }
  ] };
  const edits = editsBetween(base, target);
  assert.deepEqual(edits.deleted, ["b"]);
  assert.ok(edits.edited.a && edits.added.x);
  const again = applyRouteEdits(base, edits);
  assert.deepEqual(again.features.map((f) => f.geometry.coordinates), target.features.map((f) => f.geometry.coordinates));
});

test("a click finds the nearest segment of a line", () => {
  const hit = nearestOnLine([[0, 0], [10, 0], [10, 10]], [9, 4]);
  assert.equal(hit.index, 1);
  assert.ok(Math.abs(hit.distance - 1) < 1e-9);
});

test("roads draw live in red, with the editor overlay and decluttered markers", () => {
  const style = sourceMapStyle({ tiles: { tapestry: "t", routes: base }, glyphs: "g", sourceMap: SOURCE_MAP });
  const ids = style.layers.map((l) => l.id);
  for (const id of ["trails", "roads", "road-centre", "route-edit-line", "route-edit-nodes", "poi-labels-overview"]) assert.ok(ids.includes(id), id);
  const roads = style.layers.find((l) => l.id === "roads");
  assert.match(roads.paint["line-color"], /^#b/);
  assert.equal(style.layers.find((l) => l.id === "poi-labels-overview").layout["icon-allow-overlap"], false);
  assert.equal(style.layers.find((l) => l.id === "poi-labels-local").layout["icon-allow-overlap"], true);
  const shipped = JSON.parse(readFileSync(new URL("../data/worlds/toril/routes.geojson", import.meta.url)));
  assert.ok(applyRouteEdits(shipped, {}).features.length === shipped.features.length);
});
