import { test } from "node:test";
import assert from "node:assert/strict";
import { homebrewSheet, planTiles, packManifest, emptyIndex, worldIdFrom, zipStore, crc32, moduleIdFrom, moduleScript, TILE_SUFFIX, MAX_PICTURE, ROUTES_FILE, milesFromGrid, resheet, WORLD_MARGIN } from "../scripts/homebrew/plan.mjs";
import { packFiles } from "../scripts/terrain/asset-store.mjs";
import { selectLod } from "../scripts/terrain/lod-cache.mjs";

test("a picture's sheet is one picture pixel per sheet pixel, centred well away from the poles", () => {
  const s = homebrewSheet(12000, 9000, 1200);
  assert.equal(s.width, 12000); assert.equal(s.height, 9000);
  assert.ok(s.worldSize >= 24000); assert.equal(s.worldSize, 512 * 2 ** s.nativeZoom);
  assert.equal(s.x % 512, 0); assert.equal(s.y % 512, 0);
  assert.ok(s.x + s.width <= s.worldSize && s.y + s.height <= s.worldSize);
  assert.equal(s.milesPerPixel, 0.1); assert.equal(s.bounds.mapWidthMiles, 1200);
  assert.ok(s.bounds.west < s.bounds.east && s.bounds.south < s.bounds.north && s.bounds.north < 85);
  assert.throws(() => homebrewSheet(100, 100, 0));
});

test("homebrew files use extensions Foundry lets a GM upload", () => {
  const allowed = /\.(json|fbx)$/;
  assert.match(ROUTES_FILE, allowed); assert.match(`z0-0-0${TILE_SUFFIX}`, allowed);
  assert.equal(emptyIndex("trorune", "Trorune", homebrewSheet(8192, 6144, 3277)).routes, ROUTES_FILE);
});

test("a made world's web map world leaves room to zoom out to the whole picture", () => {
  // Realm scenes stop zooming out at a world 2.6 screens wide (main.mjs): the picture then has to fit.
  for (const [w, h] of [[16384, 12288], [8192, 6144], [3000, 2000], [1021, 1019]]) {
    const s = homebrewSheet(w, h, 1000);
    assert.ok(s.worldSize >= WORLD_MARGIN * Math.max(w, h), `${w} x ${h}`);
    assert.ok(Math.max(w, h) / s.worldSize * 2.6 <= 1, `${w} x ${h} fits on screen when zoomed out`);
  }
});

test("worlds made with a smaller web map world move to the current rules and keep their tiles", () => {
  const sheet = homebrewSheet(16384, 12288, 3277), lods = planTiles(sheet);
  for (const t of lods.flatMap((l) => l.tiles)) { t.ktxBytes = 10; t.hash = "a".repeat(64); }
  const pack = packManifest("trorune", sheet, lods, "b".repeat(64)), index = emptyIndex("trorune", "Trorune", sheet);
  assert.equal(resheet(index, pack), null);
  // As 0.74.0 and 0.74.1 made it: a world twice the picture's size, one zoom lower.
  const oldSheet = { ...sheet, nativeZoom: 6, detailZoom: 6, worldSize: 32768, x: 8192, y: 10240 };
  const oldPack = { ...pack, sourceMap: oldSheet, lods: pack.lods.map((l) => ({ ...l, z: l.z - 1, tiles: l.tiles.map((t) => ({ ...t, lod: t.lod - 1 })) })) };
  const next = resheet({ ...index, sourceMap: oldSheet, mainMap: { bounds: oldSheet.bounds } }, oldPack);
  assert.deepEqual(next.index.sourceMap, sheet); assert.deepEqual(next.pack.sourceMap, sheet);
  assert.deepEqual(next.pack.lods.map((l) => l.z), pack.lods.map((l) => l.z));
  assert.deepEqual(next.pack.lods.flatMap((l) => l.tiles.map((t) => [t.path, t.x, t.y, t.lod])), oldPack.lods.flatMap((l) => l.tiles.map((t) => [t.path, t.x, t.y, t.lod + 1])));
  assert.equal(next.index.sourceMap.milesPerPixel, 3277 / 16384);
});

test("the map width in miles defaults from a scene's grid when it is measured in miles", () => {
  assert.equal(milesFromGrid(8192, { size: 100, distance: 40, units: "Miles" }), 3277);
  assert.equal(milesFromGrid(8192, { size: 100, distance: 40, units: "mi" }), 3277);
  assert.equal(milesFromGrid(8192, { size: 100, distance: 5, units: "ft" }), null);
  assert.equal(milesFromGrid(8192, { size: 0, distance: 40, units: "mi" }), null);
});

test("tiles cover the picture once per level, with Toril's frame rules", () => {
  for (const [w, h] of [[12000, 9000], [3000, 2000], [MAX_PICTURE, 5000], [1021, 1019]]) {
    const sheet = homebrewSheet(w, h, 500), lods = planTiles(sheet);
    assert.equal(lods.at(-1).z, sheet.nativeZoom);
    assert.equal(lods.length, Math.max(w, h) > 4096 ? 2 : 1);
    for (const lod of lods) {
      const area = lod.tiles.reduce((n, t) => n + t.width * t.height, 0);
      assert.ok(Math.abs(area - w * h) / (w * h) < 0.001, `level ${lod.z} covers the picture`);
      for (const t of lod.tiles) {
        assert.equal(t.textureWidth % 4, 0); assert.equal(t.textureHeight % 4, 0);
        assert.ok(t.textureWidth <= 4096 && t.textureHeight <= 4096);
        assert.ok(t.frameX + t.frameWidth <= t.textureWidth && t.frameY + t.frameHeight <= t.textureHeight);
        assert.ok(t.path.endsWith(TILE_SUFFIX));
        const c = t.crop;
        assert.ok(c.right - c.left + c.padLeft <= t.textureWidth && c.bottom - c.top + c.padTop <= t.textureHeight);
      }
    }
  }
});

test("the pack passes KG Realms' own manifest checks and its levels are chosen by zoom", () => {
  const sheet = homebrewSheet(12000, 9000, 1200), lods = planTiles(sheet);
  for (const t of lods.flatMap((l) => l.tiles)) { t.ktxBytes = 1000; t.hash = "a".repeat(63) + (t.id.length % 10); }
  const pack = packManifest("known-lands", sheet, lods, "f".repeat(64));
  assert.equal(pack.id, "known-lands-terrain");
  assert.ok(pack.lods.every((l) => l.tiles.every((t) => !("crop" in t))));
  assert.ok(packFiles(pack).size > 0);
  assert.equal(selectLod(pack.lods, sheet.nativeZoom - 3), sheet.nativeZoom - 2);
  assert.equal(selectLod(pack.lods, sheet.nativeZoom + 4), sheet.nativeZoom);
  const index = emptyIndex("known-lands", "The Known Lands", sheet);
  assert.deepEqual(index.places, []); assert.deepEqual(index.regions, []); assert.equal(index.sourceMap, sheet);
});

test("world and module ids are tidy and never clash", () => {
  assert.equal(worldIdFrom("The Known Lands"), "the-known-lands");
  assert.equal(worldIdFrom("Faerûn!"), "faerun");
  assert.equal(worldIdFrom("toril", ["toril", "toril-2"]), "toril-3");
  assert.equal(worldIdFrom("  "), "world");
  assert.equal(moduleIdFrom("KG Realms: The Known Lands"), "kg-realms-the-known-lands");
  const script = moduleScript("kg-realms-the-known-lands", { id: "the-known-lands", title: "The Known Lands" });
  assert.match(script, /kgRealmsRegisterWorlds/); assert.match(script, /"module":"kg-realms-the-known-lands"/);
});

test("the export zip is a valid stored zip", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  const zip = zipStore([{ name: "a/module.json", bytes: "{}" }, { name: "a/b.ktx2", bytes: new Uint8Array([1, 2, 3]) }]);
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  const central = view.getUint32(end + 16, true);
  assert.equal(view.getUint32(central, true), 0x02014b50);
});
