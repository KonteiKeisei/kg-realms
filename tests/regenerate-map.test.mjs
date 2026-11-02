import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homebrewSheet, nextTileFolder, planTiles, TILE_SUFFIX } from "../scripts/homebrew/plan.mjs";

const old = homebrewSheet(3200, 2400, 3000);

test("new tiles go in a new folder each time, so the old map stays whole", () => {
  const first = { lods: [{ tiles: [{ path: "assets/terrain/z5-0-0" + TILE_SUFFIX }] }] };
  assert.equal(nextTileFolder(first), "assets/terrain/v2");
  assert.equal(nextTileFolder({ lods: [{ tiles: [{ path: "assets/terrain/v2/z5-0-0" + TILE_SUFFIX }] }] }), "assets/terrain/v3");
  assert.ok(planTiles(old, "assets/terrain/v2").flatMap((l) => l.tiles).every((t) => t.path.startsWith("assets/terrain/v2/z")));
  const store = readFileSync(new URL("../scripts/terrain/asset-store.mjs", import.meta.url), "utf8");
  const rule = new RegExp(/!\/(\^assets.*?\$)\/\.test\(t\.path/.exec(store)[1]);
  assert.ok(rule.test("assets/terrain/v2/z5-0-0" + TILE_SUFFIX)); assert.ok(rule.test("assets/terrain/z5-0-0.ktx2"));
  assert.ok(!rule.test("assets/terrain/../z5-0-0.ktx2"));
});

test("only the tiles change: not the world's sheet, the scene's size or anything placed", () => {
  const brew = readFileSync(new URL("../scripts/homebrew/homebrew.mjs", import.meta.url), "utf8");
  const body = brew.slice(brew.indexOf("async function regenerateMap"), brew.indexOf("/* ------------------------------------------------------------------ afterwards"));
  assert.ok(!body.includes('uploadJson(def.root, "index.json"'), "index.json keeps the sheet");
  assert.ok(body.includes("const sheet = index.sourceMap"));
  assert.ok(body.includes("resizeWidth: sheet.width, resizeHeight: sheet.height"), "any picture is fitted to the map as it is");
  assert.ok(body.indexOf('uploadJson(def.root, "terrain-pack.json", pack)') > body.indexOf("encodeTiles(bitmap, tiles"), "the map switches only once every tile is saved");
  assert.ok(!/scene\.update\(\{[^}]*(width|height|grid)/.test(body), "the scene keeps its size and grid");
});

test("the scene config: the picture and the button, only on a made realm map, saved by nothing but the button", () => {
  const brew = readFileSync(new URL("../scripts/homebrew/homebrew.mjs", import.meta.url), "utf8");
  assert.ok(brew.includes("Regenerate map tiles from this picture"));
  assert.ok(brew.includes("!homebrewOf(scene) ||"));
  assert.ok(/<input type="text" data-map-src/.test(brew), "no form name");
  assert.ok(readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8").includes("sceneMapPicture(root, scene);"));
});
