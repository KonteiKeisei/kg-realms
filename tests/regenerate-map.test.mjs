import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homebrewSheet, detailLevels, nextTileFolder, planTiles, MAX_PICTURE, TILE_SUFFIX } from "../scripts/homebrew/plan.mjs";

const old = homebrewSheet(3200, 2400, 3000);

test("how much detail a new picture keeps", () => {
  assert.equal(detailLevels(old, 3200, 2400), 0, "the same size");
  assert.equal(detailLevels(old, 3300, 2475), 0, "barely bigger");
  assert.equal(detailLevels(old, 1600, 1200), 0, "smaller");
  assert.equal(detailLevels(old, 6400, 4800), 1);
  assert.equal(detailLevels(old, 8000, 6000), 2, "enough to keep all of it");
  assert.equal(detailLevels(old, 8000, 3000), 2, "a different shape counts by its larger side");
  assert.equal(detailLevels(homebrewSheet(9000, 6000, 1000), 30000, 20000), 0, "the browser's limit holds");
  assert.ok(3200 * 2 ** detailLevels(old, 60000, 45000) <= MAX_PICTURE);
});

test("a finer level covers the same sheet, on the same positions, and is cut from the right part of the picture", () => {
  const lods = planTiles(old, { detail: 2 }), fine = lods.at(-1), n = old.nativeZoom;
  assert.deepEqual(lods.map((l) => l.z), [n, n + 2], "the sheet's own level, then the finer one");
  assert.equal(fine.scale, 4); assert.equal(fine.width, 12800); assert.equal(fine.height, 9600);
  assert.equal(Math.max(...fine.tiles.map((t) => t.x + t.width)), old.width);
  assert.equal(Math.max(...fine.tiles.map((t) => t.y + t.height)), old.height);
  assert.equal(fine.tiles.reduce((a, t) => a + t.width * t.height, 0), old.width * old.height, "no gaps, no overlaps");
  // The picture is at the finest level's size, so that level is cut one to one; the sheet's own at a quarter.
  assert.equal(fine.tiles[0].crop.scale, 1);
  assert.equal(lods[0].tiles[0].crop.scale, 0.25);
});

test("with no extra detail, tiles are planned as they always were", () => {
  const t = planTiles(old)[0].tiles[0];
  assert.ok(t.path.startsWith("assets/terrain/z")); assert.equal(t.crop.scale, 1);
});

test("new tiles go in a new folder each time, so the old map stays whole", () => {
  const first = { lods: [{ tiles: [{ path: "assets/terrain/z5-0-0" + TILE_SUFFIX }] }] };
  assert.equal(nextTileFolder(first), "assets/terrain/v2");
  assert.equal(nextTileFolder({ lods: [{ tiles: [{ path: "assets/terrain/v2/z5-0-0" + TILE_SUFFIX }] }] }), "assets/terrain/v3");
  assert.ok(planTiles(old, { folder: "assets/terrain/v2", detail: 1 }).flatMap((l) => l.tiles).every((t) => t.path.startsWith("assets/terrain/v2/z")));
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
  assert.ok(body.includes("resizeWidth: sheet.width * f, resizeHeight: sheet.height * f"), "any picture is fitted to the map as it is");
  assert.ok(body.indexOf('uploadJson(def.root, "terrain-pack.json", pack)') > body.indexOf("encodeTiles(bitmap, tiles"), "the map switches only once every tile is saved");
  assert.ok(!/scene\.update\(\{[^}]*(width|height|grid)/.test(body), "the scene keeps its size and grid");
});

test("the scene config: Foundry's Background Image stays and saves as always, with the button under it", () => {
  const brew = readFileSync(new URL("../scripts/homebrew/homebrew.mjs", import.meta.url), "utf8");
  assert.ok(brew.includes("Regenerate map tiles from this picture"));
  assert.ok(brew.includes("!homebrewOf(scene) ||"));
  assert.ok(brew.includes('root.querySelector(\'[name$="background.src"]\')'), "it reads Foundry's field");
  assert.ok(brew.includes("native.after(row)"), "under it");
  assert.ok(!brew.includes("native.hidden") && !brew.includes('native.style.display'), "the field is not hidden");
  assert.ok(!brew.includes("data-map-src"), "no box of its own, which the scene's Save could not keep");
  assert.ok(brew.includes('String(field?.value ?? "").trim() || backgroundOf(scene) || used'), "what is in the field, saved or not");
  assert.ok(brew.indexOf("await setBackground(scene, null)") < brew.indexOf("flags.${ID}.mapVersion`]: Date.now()"), "emptied before everyone reloads");
  assert.ok(readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8").includes("sceneMapPicture(root, scene);"));
});


test("overlapping rebuilds cannot share upload filenames, including abandoned builds", async () => {
  const {runMapBuild}=await import("../scripts/homebrew/map-build.mjs");
  const {packFiles}=await import("../scripts/terrain/asset-store.mjs");
  const pack={lods:[]},one=nextTileFolder(pack,"first-build"),two=nextTileFolder(pack,"second-build");
  assert.notEqual(one,two);
  const lods=planTiles(old,{folder:one});
  for(const lod of lods)for(const tile of lod.tiles){tile.hash="a".repeat(64);tile.ktxBytes=10;}
  assert.doesNotThrow(()=>packFiles({schema:1,id:"test-terrain",fingerprint:"b".repeat(64),sourceMap:old,lods}));
  assert.equal(nextTileFolder({lods},"next"),"assets/terrain/v3-next");
  let finish;
  const pending=runMapBuild("test",()=>new Promise(r=>finish=r));
  await assert.rejects(runMapBuild("test",()=>assert.fail("second build ran")),/already/);
  finish();await pending;
  await assert.rejects(runMapBuild("test",()=>Promise.reject(Error("failed"))),/failed/);
  assert.equal(await runMapBuild("test",async()=>"retry"),"retry");
});
