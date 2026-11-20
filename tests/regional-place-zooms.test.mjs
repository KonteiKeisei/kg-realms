import { test } from "node:test";
import assert from "node:assert/strict";
import { placeZooms } from "../scripts/source-map.mjs";

// The sheets as kg-realms-trorune 1.0.0 ships them, and Toril's.
const trorune = { width: 16384, height: 12288, tileSize: 512, nativeZoom: 7, detailZoom: 7, milesPerPixel: 0.20001220703125 };
const heartlands = { width: 8192, height: 6407, tileSize: 512, nativeZoom: 6, detailZoom: 6, milesPerPixel: 0.048828125 };
const toril = { width: 12840, height: 9150, nativeZoom: 7, detailZoom: 9, milesPerPixel: 500 / 1700 };

test("realm maps keep their zooms", () => {
  assert.deepEqual(placeZooms(toril), { regional: 5.5, local: 7.5 });
  assert.deepEqual(placeZooms(trorune), { regional: 4.5, local: 6 });
  assert.deepEqual(placeZooms(heartlands), { regional: 3.5, local: 5 }, "the same picture as a realm map: its own zooms");
});

test("on a Regional map every place shows from the whole-map view, the most important ones further out", () => {
  const z = placeZooms({ ...heartlands, regional: true });
  // The Heartlands' whole-map view on a 940 px wide map area: zoom 2.88. Keep of Miserth (rank 5) needed 5.
  const wholeView = heartlands.nativeZoom - Math.log2(heartlands.width / 940);
  assert.ok(z.local < wholeView, `every place by ${z.local.toFixed(2)}, below the whole-map view ${wholeView.toFixed(2)}`);
  assert.ok(z.regional < z.local && z.regional > 0);
  assert.ok(Math.abs(z.local - 2.5) < 1e-9 && Math.abs(z.regional - 1.5) < 1e-9);
});

test("a tiny Regional picture never asks for a zoom below the map's", () => {
  const z = placeZooms({ width: 600, height: 400, nativeZoom: 1, milesPerPixel: 0.01, regional: true });
  assert.ok(z.regional > 0 && z.local > z.regional);
});
