import { test } from "node:test";
import assert from "node:assert/strict";
import { placeLayer, placeShape, areaKind, placeOutline, recordIndex, areasGeoJSON, outlinedIds, realmColor, interiorPoint, insideRing } from "../scripts/map-layers.mjs";

test("an area's name goes well inside it, even in a crescent whose centre lies outside", () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.deepEqual(interiorPoint(square), [5, 5]);
  // A U opening upward: its centre (5, 5) is open water outside the land.
  const u = [[0, 0], [10, 0], [10, 10], [7, 10], [7, 3], [3, 3], [3, 10], [0, 10]];
  assert.equal(insideRing(u, [5, 6]), false);
  const at = interiorPoint(u);
  assert.equal(insideRing(u, at), true, `${at} is inside`);
});

test("every type has a layer: points, realms, and the land and water", () => {
  for (const c of ["City", "Town", "Village", "Hamlet", "Keep", "Castle", "Ruins", "Temple", "Mine", "Lighthouse", "Port", "Peak", "Volcano", "Cave", "Pass", "Island", "Hill", "Grove", "POI"]) assert.equal(placeLayer({ class: c }), "places", c);
  for (const c of ["Region", "Macroregion", "Kingdom", "Empire"]) assert.equal(placeLayer({ class: c }), "realms", c);
  for (const c of ["Forest", "Mountains", "Hills", "Desert", "Marsh", "Swamp", "Glacier", "Islands", "Coast", "Sea", "Bay", "Gulf", "Strait", "Lake", "Shoal", "River"]) assert.equal(placeLayer({ class: c }), "geo", c);
  for (const c of ["Road", "Trail"]) assert.equal(placeLayer({ class: c }), null, c);
  assert.equal(placeLayer({ class: "Something new" }), "places", "an unknown type is a place");
});

test("a place's own layer and shape win over its type's", () => {
  assert.equal(placeLayer({ class: "Island", layer: "geo" }), "geo");
  assert.equal(placeShape({ class: "Island" }), "point");
  assert.equal(placeShape({ class: "Island", shape: "area" }), "area");
  assert.equal(placeShape({ class: "Kingdom" }), "area");
  assert.equal(placeShape({ class: "River" }), "line");
  assert.equal(areaKind({ class: "Sea" }), "water");
  assert.equal(areaKind({ class: "Forest" }), "land");
  assert.equal(areaKind({ class: "Region" }), "realm");
});

test("an area's outline: the one drawn, else its world's area record as a rectangle", () => {
  const records = recordIndex([{ name: "Aglarond", bounds: { west: 1, east: 3, south: 1, north: 2 } }]);
  const drawn = placeOutline({ class: "Region", name: "Aglarond", area: [[0, 0], [1, 0], [1, 1]] }, records);
  assert.equal(drawn.closed, true); assert.equal(drawn.pts.length, 3);
  const rect = placeOutline({ class: "Region", name: "aglarond" }, records);
  assert.deepEqual(rect.pts, [[1, 2], [3, 2], [3, 1], [1, 1]]); assert.equal(rect.fromRecord, true);
  const line = placeOutline({ class: "Mountains", name: "Spine", area: [[0, 0], [2, 2]], areaClosed: false }, records);
  assert.equal(line.closed, false);
  assert.equal(placeOutline({ class: "City", name: "Aglarond" }, records), null, "a point has no outline");
});

test("the areas source: borders, lines and name points, on their layers; places without outlines left to the places source", () => {
  const places = [
    { id: "k", name: "Giamela", class: "Kingdom", lon: 1, lat: 1, area: [[0, 0], [2, 0], [2, 2], [0, 2]] },
    { id: "r", name: "Torrose", class: "River", lon: 5, lat: 5, area: [[4, 4], [6, 6]], areaClosed: false },
    { id: "s", name: "Sea of Fallen Stars", class: "Sea", lon: 9, lat: 9 },
    { id: "c", name: "Wakeflow", class: "City", lon: 1, lat: 1 }
  ];
  const { areas, labels } = areasGeoJSON(places);
  assert.deepEqual(areas.features.map((f) => [f.properties.id, f.geometry.type, f.properties.layer]), [["k", "Polygon", "realms"], ["r", "LineString", "geo"]]);
  assert.deepEqual(areas.features[0].geometry.coordinates[0].at(-1), [0, 0], "the ring closes");
  assert.deepEqual(labels.features.map((f) => f.properties.id), ["k"]);
  assert.deepEqual([...outlinedIds(places)], ["k", "r"]);
  assert.match(realmColor(places[0]), /^#[0-9a-f]{6}$/);
});
