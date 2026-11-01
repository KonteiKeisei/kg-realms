import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DATA_HOME, dataFolder, inGameWorld, freeFolder, filesToMove, copyFiles } from "../scripts/homebrew/plan.mjs";

const pack = { lods: [{ tiles: [{ path: "assets/terrain/a.ktx2.fbx" }, { path: "assets/terrain/b.ktx2.fbx" }] }] };
const bytes = (...n) => new Uint8Array(n);

test("made worlds are saved in the Data folder, never in a game world's", () => {
  assert.equal(dataFolder("trorune"), "KG Realms Data/World/trorune");
  assert.equal(DATA_HOME, "KG Realms Data/World");
  assert.doesNotMatch(readFileSync(new URL("../scripts/homebrew/homebrew.mjs", import.meta.url), "utf8"), /`worlds\/\$\{/);
});

test("only worlds still in a game world's folder move", () => {
  assert.equal(inGameWorld({ root: "worlds/mine/kg-realms/trorune" }), true);
  assert.equal(inGameWorld({ root: "KG Realms Data/World/trorune" }), false);
  assert.equal(inGameWorld({ root: "modules/kg-realms-faerun/data/worlds/toril" }), false);
  assert.equal(inGameWorld({}), false);
});

test("two game worlds' maps of one name get a folder each", () => {
  assert.equal(freeFolder("trorune", []), "trorune");
  assert.equal(freeFolder("trorune", ["trorune"]), "trorune-2");
  assert.equal(freeFolder("trorune", ["trorune", "trorune-2"]), "trorune-3");
});

test("the pack, index and every tile must arrive; other files move if they exist; the upload probe stays behind", () => {
  const files = filesToMove(pack, ["notes.json", "assets/terrain/a.ktx2.fbx", "assets/terrain/probe.ktx2.fbx"], "roads.json");
  const required = files.filter((f) => f.required).map((f) => f.path).sort();
  assert.deepEqual(required, ["assets/terrain/a.ktx2.fbx", "assets/terrain/b.ktx2.fbx", "index.json", "terrain-pack.json"]);
  const paths = files.map((f) => f.path);
  for (const p of ["roads.json", "waterways.json", "biomes.json", "encounters.json", "local/index.json", "notes.json"]) assert.ok(paths.includes(p), p);
  assert.ok(!paths.some((p) => p.includes("probe")));
  assert.equal(new Set(paths).size, paths.length, "no file twice");
});

test("copying: every file arrives as it was, and optional files that do not exist are passed over", async () => {
  const source = { "a.bin": bytes(1, 2), "b.bin": bytes(3) }, saved = {}, seen = [];
  const files = [{ path: "a.bin", required: true }, { path: "b.bin", required: true }, { path: "none.json", required: false }];
  const done = await copyFiles(files, { read: async (p) => source[p] ?? null, write: async (p, b) => (saved[p] = b), onFile: (n, of) => seen.push([n, of]) });
  assert.equal(done, 3);
  assert.deepEqual(saved, source);
  assert.deepEqual(seen.at(-1), [3, 3]);
});

test("copying stops with an error when a required file is missing or comes back changed", async () => {
  await assert.rejects(copyFiles([{ path: "tile", required: true }], { read: async () => null, write: async (p, b) => b }), /tile is missing/);
  await assert.rejects(copyFiles([{ path: "tile", required: true }], { read: async () => bytes(1, 2), write: async () => bytes(1, 9) }), /tile changed when saved/);
  await assert.rejects(copyFiles([{ path: "tile", required: true }], { read: async () => bytes(1, 2), write: async () => null }), /tile changed when saved/);
  await assert.rejects(copyFiles([{ path: "tile", required: true }], { read: async () => bytes(1), write: async () => { throw Error("no room"); } }), /no room/);
});
