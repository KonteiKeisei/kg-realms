import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { withShoreBorders, placeFromShore, inlandWaters, canBeBiome, placeLayer, areasGeoJSON } from "../scripts/map-layers.mjs";
import { lakeBiome, climateOf } from "../scripts/biome-climate.mjs";

const loop = [[0, 0], [10, 0], [10, 10], [0, 10]];
const shores = { s1: { kind: "shore", name: "Lake Oban", pts: loop, closed: true, water: "inside" }, s2: { kind: "shore", name: "Ebony Coast", pts: [[0, 0], [5, 5], [9, 0]] }, r1: { kind: "river", name: "Lake Oban", pts: loop } };

test("a place that follows a shoreline takes its outline; the outline stays one", () => {
  const [p] = withShoreBorders([{ id: "p", name: "Lake Oban", class: "Lake", lon: 5, lat: 5, shore: "s1" }], shores);
  assert.equal(p.area, loop, "the shoreline's own, not a copy"); assert.equal(p.areaClosed, true); assert.equal(p.shape, "area"); assert.equal(p.shoreLine, true);
  assert.equal(placeLayer(p), "geo");
  assert.equal(areasGeoJSON([p]).areas.features[0].geometry.type, "Polygon");
  assert.deepEqual(areasGeoJSON([p]).labels.features[0].geometry.coordinates, [5, 5]);
});

test("a place with no shoreline chosen is untouched: it is never forced", () => {
  const own = { id: "p", name: "Lake Oban", class: "Lake", lon: 5, lat: 5 };
  assert.equal(withShoreBorders([own], shores)[0], own);
});

test("a name outside the outline moves in; ends apart makes a line; a deleted shoreline says so", () => {
  const [far] = withShoreBorders([{ id: "p", class: "Lake", lon: 50, lat: 50, shore: "s1" }], shores);
  assert.ok(far.lon > 0 && far.lon < 10 && far.lat > 0 && far.lat < 10, "inside");
  const [open] = withShoreBorders([{ id: "p", class: "Coast", lon: 1, lat: 1, shore: "s2" }], shores);
  assert.equal(open.shape, "line"); assert.equal(open.areaClosed, false);
  const [gone] = withShoreBorders([{ id: "p", class: "Lake", lon: 1, lat: 1, shore: "nope" }], shores);
  assert.equal(gone.shoreGone, true); assert.equal(gone.area, undefined);
  assert.equal(withShoreBorders([{ id: "p", shore: "r1", lon: 1, lat: 1 }], shores)[0].shoreGone, true, "a river is not a shoreline");
});

test("making a place from a shoreline: water inside a lake, outside islands, ends apart a coast", () => {
  const lake = placeFromShore("s1", shores.s1);
  assert.equal(lake.class, "Lake"); assert.equal(lake.shore, "s1"); assert.equal(lake.name, "Lake Oban"); assert.equal(lake.layer, "geo");
  assert.ok(lake.lon > 0 && lake.lon < 10);
  assert.equal(placeFromShore("x", { ...shores.s1, water: "outside" }).class, "Islands");
  assert.equal(placeFromShore("x", shores.s2).class, "Coast");
  const [island] = withShoreBorders([{ id: "i", ...placeFromShore("x", { ...shores.s1, water: "outside" }) }], { x: { ...shores.s1, water: "outside" } });
  assert.equal(canBeBiome(island), true, "an island can be a biome");
  const [water] = withShoreBorders([{ id: "w", ...lake }], shores);
  assert.equal(canBeBiome(water), false, "a lake cannot");
});

const forest = { type: "forest", climate: "kgr-forest" }, tundra = { type: "tundra", climate: "kgr-tundra" };
test("a lake has the weather of the land it lies in", () => {
  const query = (x, y) => (x >= 0 && x <= 10 && y >= 0 && y <= 10 ? null : forest);
  assert.equal(climateOf(lakeBiome(5, 5, [loop], query)), "kgr-forest");
  assert.equal(lakeBiome(50, 50, [loop], query), null, "on no lake: the open sea");
  assert.equal(lakeBiome(5, 5, [loop], () => null), null, "water all round: the open sea");
});

test("the commonest biome around it wins, and a lake within a lake uses the smaller", () => {
  const big = [[-100, -100], [100, -100], [100, 100], [-100, 100]];
  const query = (x, y) => { if (x >= 0 && x <= 10 && y >= 0 && y <= 10) return null; if (Math.abs(x) > 100 || Math.abs(y) > 100) return tundra; return x > 9 && y > 9 ? tundra : forest; };
  assert.equal(climateOf(lakeBiome(5, 5, [big, loop], query)), "kgr-forest");
  assert.equal(climateOf(lakeBiome(50, 50, [big, loop], query)), "kgr-tundra", "only in the big one");
});

test("inland waters: closed shorelines with water inside, and lakes with their own border", () => {
  const rings = inlandWaters([{ class: "Lake", area: loop }, { class: "Sea", area: loop }, { class: "Lake", shoreLine: true, area: loop }, { class: "Lake" }], { ...shores, o: { kind: "shore", pts: loop, closed: true, water: "outside" }, n: { kind: "shore", pts: loop, closed: true } });
  assert.equal(rings.length, 2, "one shoreline, one lake's own");
});

test("the editor offers it, never forces it, and hands the reshaping to the shoreline", () => {
  const pins = readFileSync(new URL("../scripts/ui-pins.mjs", import.meta.url), "utf8");
  assert.ok(readFileSync(new URL("../scripts/borders.mjs", import.meta.url), "utf8").includes('<option value="">Its own border</option>')); assert.ok(pins.includes("Reshape it in ${borderHome(p.followRef)}"));
  assert.ok(pins.includes("#editable(p) { return p?.shoreLine ? null : this.#outline(p); }"));
  const water = readFileSync(new URL("../scripts/ui-waterways.mjs", import.meta.url), "utf8");
  assert.ok(water.includes('data-act="make-place"'));
});
