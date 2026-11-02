import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homebrewSheet, regenSheet, sameShape, nextTileFolder, planTiles, resheet, MAX_PICTURE, TILE_SUFFIX } from "../scripts/homebrew/plan.mjs";

const old = homebrewSheet(3200, 2400, 3000);
const lon = (s, x) => (x + s.x) / s.worldSize;

test("a same-size picture keeps the sheet exactly", () => {
  const s = regenSheet(old, 3200, 2400);
  for (const k of ["width", "height", "nativeZoom", "worldSize", "x", "y"]) assert.equal(s[k], old[k], k);
  assert.deepEqual(s.bounds, old.bounds);
  assert.equal(s.keepSheet, true);
});

test("a bigger picture doubles the sheet, over the same ground", () => {
  const s = regenSheet(old, 8000, 6000);
  assert.equal(s.width, 12800, "enough doublings to hold all of it"); assert.equal(s.height, 9600);
  assert.equal(s.nativeZoom, old.nativeZoom + 2);
  assert.deepEqual(s.bounds, old.bounds, "the bounds do not move, so neither does anything placed in longitude and latitude");
  assert.equal(lon(s, s.width), lon(old, old.width)); assert.equal(lon(s, 0), lon(old, 0));
  assert.equal(s.x % 512, 0, "still tile aligned"); assert.equal(s.y % 512, 0);
  assert.equal(s.milesPerPixel * s.width, 3000, "still the same miles across");
});

test("barely bigger stays the same size; smaller never shrinks the sheet", () => {
  assert.equal(regenSheet(old, 3300, 2475).width, 3200);
  assert.equal(regenSheet(old, 1600, 1200).width, 3200);
});

test("the browser's limit holds", () => {
  const s = regenSheet(homebrewSheet(9000, 6000, 1000), 30000, 20000);
  assert.ok(Math.max(s.width, s.height) <= MAX_PICTURE, String(s.width));
  assert.equal(s.width, 9000);
});

test("the shape check", () => {
  assert.ok(sameShape(old, 8000, 6000)); assert.ok(sameShape(old, 8000, 6040));
  assert.ok(!sameShape(old, 8000, 8000));
});

test("new tiles go in a new folder each time, so the old map stays whole", () => {
  const first = { lods: [{ tiles: [{ path: "assets/terrain/z5-0-0" + TILE_SUFFIX }] }] };
  assert.equal(nextTileFolder(first), "assets/terrain/v2");
  assert.equal(nextTileFolder({ lods: [{ tiles: [{ path: "assets/terrain/v2/z5-0-0" + TILE_SUFFIX }] }] }), "assets/terrain/v3");
  const lods = planTiles(regenSheet(old, 8000, 6000), "assets/terrain/v2");
  assert.ok(lods.flatMap((l) => l.tiles).every((t) => t.path.startsWith("assets/terrain/v2/z")));
  assert.ok(planTiles(old)[0].tiles[0].path.startsWith("assets/terrain/z"), "a new world's tiles are where they always were");
});

test("a rebuilt sheet is not moved on the next load, and the map loader accepts its tiles", () => {
  const s = regenSheet(old, 8000, 6000);
  assert.equal(resheet({ sourceMap: s, mainMap: { bounds: s.bounds } }, { lods: [] }), null);
  const store = readFileSync(new URL("../scripts/terrain/asset-store.mjs", import.meta.url), "utf8");
  const rule = /!\/(\^assets.*?\$)\/\.test\(t\.path/.exec(store)[1];
  assert.ok(new RegExp(rule).test("assets/terrain/v2/z5-0-0" + TILE_SUFFIX)); assert.ok(new RegExp(rule).test("assets/terrain/z5-0-0.ktx2"));
  assert.ok(!new RegExp(rule).test("assets/terrain/../z5-0-0.ktx2"));
});

test("the scene config: the picture and the button, only on a made realm map, saved by nothing but the button", () => {
  const brew = readFileSync(new URL("../scripts/homebrew/homebrew.mjs", import.meta.url), "utf8");
  assert.ok(brew.includes("Regenerate map tiles from this picture"));
  assert.ok(brew.includes("!homebrewOf(scene) ||"));
  assert.ok(/<input type="text" data-map-src/.test(brew), "no form name");
  const body = brew.slice(brew.indexOf("async function regenerateMap"));
  assert.ok(body.indexOf('uploadJson(def.root, "terrain-pack.json", pack)') > body.indexOf("encodeTiles(bitmap, tiles"), "the map switches only once every tile is saved");
  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.ok(main.includes("sceneMapPicture(root, scene);"));
});
