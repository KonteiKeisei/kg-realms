import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { placeZooms, sourceMapStyle, SOURCE_MAP } from "../scripts/source-map.mjs";
import { homebrewSheet } from "../scripts/homebrew/plan.mjs";

const gateOf = (style, id) => JSON.stringify(style.layers.find((l) => l.id === id).filter);
const style = (sourceMap) => sourceMapStyle({ tiles: { tapestry: "t" }, glyphs: "g", sourceMap });

test("Toril keeps the zooms it was tuned to", () => {
  assert.deepEqual(placeZooms(SOURCE_MAP), { regional: 5.5, local: 7.5 });
  assert.ok(gateOf(style(SOURCE_MAP), "poi-labels-local").includes('"settledZoom"],7.5'));
});

test("a made world shows its places by its own map's size, not Toril's", () => {
  for (const width of [4000, 8192, 16000]) {
    const sheet = homebrewSheet(width, width * 0.7, 3000), z = placeZooms(sheet);
    assert.equal(z.local, sheet.nativeZoom - 1, "every place from half its picture's size");
    assert.equal(z.regional, sheet.nativeZoom - 2.5);
    assert.ok(z.local < sheet.nativeZoom, "well before the picture is enlarged");
    const s = style(sheet);
    assert.ok(gateOf(s, "poi-labels-local").includes(`"settledZoom"],${z.local}`));
    assert.ok(gateOf(s, "poi-labels-regional").includes(`"settledZoom"],${z.regional}`));
    assert.ok(gateOf(s, "poi-labels-overview").includes(`"settledZoom"],${z.regional}`));
  }
});

test("a marker's text sizes still rise with the zoom on any map", () => {
  const stops = (sheet) => style(sheet).layers.find((l) => l.id === "poi-labels-local").layout["text-size"];
  const text = JSON.stringify(stops(homebrewSheet(8192, 6000, 3000)));
  assert.ok(text.includes("interpolate"));
});

test("search and the crosshairs land where the place shows, on its layer", () => {
  const read = (f) => readFileSync(new URL(`../scripts/${f}`, import.meta.url), "utf8");
  const layer = read("realm-layer.mjs");
  assert.match(layer, /scaleForZoom\(zoom\) \{ return \(2 \*\* zoom \* TILE_SIZE \* 2\) \/ this\.frame\.k; \}/);
  assert.match(layer, /Math\.log2\(\(view\.scale \* this\.frame\.k\) \/ \(TILE_SIZE \* 2\)\)/, "the inverse of what update() draws");
  assert.ok(read("ui-search.mjs").includes("await layer.showSpot(it.lon, it.lat)"));
  assert.ok(read("ui-search.mjs").includes("this.showLayer?.(it)"));
  assert.ok(read("ui-pins.mjs").includes("layer.showSpot(p.lon, p.lat, 400)"));
  assert.ok(read("main.mjs").includes("layer.showSpot(lon, lat, 400)"));
});
