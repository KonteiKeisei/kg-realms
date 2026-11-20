// A road is picked, and a corner added, where the map draws it: curved through its corners
// (smoothLine), not the straight lines between them. On a bend the drawn line bows away from the
// straight one, further the closer the zoom, and a click on what you see missed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { smoothLine } from "../scripts/routes.mjs";
import { lonLatToSource, sourceToLonLat } from "../scripts/source-map.mjs";

globalThis.foundry ??= { utils: { escapeHTML: (s) => String(s) } };
globalThis.canvas = { app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } } };
const { RoadEditor } = await import("../scripts/ui-roads.mjs");

// A right-angled road; screen px = lon/lat x 30 (a close zoom).
const K = 30, corners = [[0, 0], [10, 0], [10, 10]], drawn = smoothLine(corners, lonLatToSource, sourceToLonLat);
const layer = { toScreen: (x, y) => [x * K, y * K], fromScreen: (x, y) => [x / K, y / K], setRouteEdit() {} };
const fc = (coordinates) => ({ type: "FeatureCollection", features: [{ type: "Feature", properties: { id: "r1" }, geometry: { type: "LineString", coordinates } }] });
const click = ([x, y]) => ({ button: 0, clientX: x, clientY: y, preventDefault() {}, stopImmediatePropagation() {} });
const offStraight = ([x, y]) => Math.min(Math.abs(y), Math.abs(x - 10 * K));
// The drawn point furthest from the straight corner lines: where a click on the bend lands.
const bend = drawn.map((p) => layer.toScreen(...p)).sort((a, b) => offStraight(b) - offStraight(a))[0];

function editor(extra = {}) {
  const ed = new RoadEditor({ getLayer: () => layer, getRoutes: () => fc(corners), getDrawnRoutes: () => fc(drawn), getPlaces: () => [], ...extra });
  ed.active = true;
  return ed;
}

test("the drawn bend lies well away from the straight lines at a close zoom", () => {
  assert.ok(offStraight(bend) > 14, `${offStraight(bend).toFixed(1)} px: beyond the old 9 px reach`);
});

test("a click on the drawn bend picks the road", () => {
  const ed = editor();
  let picked = null; ed.select = (id) => { picked = id; };
  ed.handlers.pointerdown(click(bend));
  assert.equal(picked, "r1");
});

test("the reach is 14 px from the drawn line; further away picks nothing", () => {
  const [x, y] = layer.toScreen(...drawn[5]), near = editor(), far = editor();
  let a = null, b = null; near.select = (id) => { a = id; }; far.select = (id) => { b = id; };
  near.handlers.pointerdown(click([x, y - 12]));
  far.handlers.pointerdown(click([x, y - 30]));
  assert.equal(a, "r1", "at most 12 px off");
  assert.equal(b, null, "about 30 px off");
});

test("on the selected road, a click on its drawn bend adds a corner there, between the right two", async () => {
  const { parseHTML } = await import("linkedom");
  globalThis.document ??= parseHTML("<!doctype html><html><body></body></html>").document;
  const ed = editor({ getEdits: () => ({}), getBase: () => fc(corners) });
  ed.selected = "r1"; ed.coords = corners.map((c) => [...c]);
  ed.select = () => assert.fail("the click should add a corner, not pick a road");
  ed.handlers.pointerdown(click(bend));
  assert.equal(ed.coords.length, 4, "a new corner on the bend");
  assert.ok(ed.node === 1 || ed.node === 2, "next to the bend's corner");
  const at = layer.toScreen(...ed.coords[ed.node]);
  assert.ok(Math.hypot(at[0] - bend[0], at[1] - bend[1]) < 2, "where the drawn line was clicked");
});
