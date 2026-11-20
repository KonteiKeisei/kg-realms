// A companion world's own map tiles: saved outside its module folder (which an update replaces), per
// game world, and read in place of the module's by the map, the map files download and the export.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { terrainSource, ownTilesFolder, TILE_HOME, setOwnTiles, ownTiles } from "../scripts/world-tiles.mjs";
import { registerWorld, worldDef } from "../scripts/worlds.mjs";

const store = {};
globalThis.foundry ??= { utils: {} };
globalThis.foundry.utils.deepClone ??= (x) => structuredClone(x);
globalThis.game = { world: { id: "the-forge-wardens" }, settings: { get: (_m, k) => store[k], set: async (_m, k, v) => { store[k] = v; } } };

registerWorld({ id: "trorune", module: "kg-realms-trorune", terrainPack: "terrain-pack.json" });
const trorune = worldDef("trorune");

test("a companion map reads its module's tiles until it has its own", () => {
  assert.deepEqual(terrainSource(trorune), { pack: "modules/kg-realms-trorune/data/worlds/trorune/terrain-pack.json", base: "modules/kg-realms-trorune", own: null });
});

test("own tiles live under this game world's KG Realms Data folder, never the module's", () => {
  const folder = ownTilesFolder("trorune");
  assert.equal(folder, `${TILE_HOME}/the-forge-wardens/trorune`);
  assert.ok(!folder.startsWith("modules/"));
  assert.notEqual(ownTilesFolder("trorune", "another-game"), folder, "two game worlds never share them");
});

test("with its own tiles, every reader goes to them; back to the module's leaves the record gone", async () => {
  await setOwnTiles("trorune", { folder: ownTilesFolder("trorune"), src: "maps/new.webp", made: 1, modulePack: "abc" });
  assert.deepEqual(terrainSource(trorune), { pack: `${TILE_HOME}/the-forge-wardens/trorune/terrain-pack.json`, base: `${TILE_HOME}/the-forge-wardens/trorune`, own: ownTiles("trorune") });
  await setOwnTiles("trorune", null);
  assert.equal(ownTiles("trorune"), null);
  assert.equal(terrainSource(trorune).base, "modules/kg-realms-trorune");
});

test("a made-here world keeps its tiles in its own data folder", () => {
  registerWorld({ id: "made", root: "KG Realms Data/World/made", assetBase: "KG Realms Data/World/made", terrainPack: "terrain-pack.json", homebrew: true });
  assert.equal(terrainSource(worldDef("made"), { folder: "elsewhere" }).base, "KG Realms Data/World/made");
});

test("the map, the map files download, regenerating and the export all read tiles through the lookup", () => {
  const read = (f) => readFileSync(new URL(`../scripts/${f}`, import.meta.url), "utf8");
  assert.ok(read("terrain/map-assets.mjs").includes("terrainSource(world)"), "the map and its download");
  const exp = read("homebrew/export.mjs");
  assert.ok(exp.includes("const tileSource = terrainSource(def), assetBase = tileSource.base;"), "the export carries own tiles");
  const hb = read("homebrew/homebrew.mjs");
  assert.ok(hb.includes("target = companion ? ownTilesFolder(def.id) : def.root"), "a companion's new tiles never go in its module folder");
  assert.ok(hb.includes("await uploadJson(target, \"terrain-pack.json\", pack);"));
  assert.ok(hb.includes("data-map-module") && hb.includes("async function checkModuleTiles()"), "the way back, and the update notice");
});
