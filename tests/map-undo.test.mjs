// Ctrl+Z in the map editors steps back on the map it was taken on, never another. Before this, the
// editors kept one history for every map: undo on a realm map wrote its regional map's saved place
// edits over the realm's, and every place the GM had added there was lost.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MapUndo } from "../scripts/undo-stack.mjs";

globalThis.foundry ??= { utils: { escapeHTML: (s) => String(s), deepClone: (x) => structuredClone(x) } };
const notes = [];
globalThis.ui = { notifications: { info: (m) => notes.push(m), warn() {}, error() {} } };
const { BiomeEditor } = await import("../scripts/ui-biomes.mjs");

test("each map's steps come back only on that map, newest first", () => {
  const u = new MapUndo(10);
  u.push("trorune", "t1"); u.push("heartlands", "h1"); u.push("trorune", "t2"); u.push("heartlands", "h2");
  assert.equal(u.pop("trorune"), "t2");
  assert.equal(u.pop("trorune"), "t1");
  assert.equal(u.pop("trorune"), null, "nothing left here: the regional map's steps stay there");
  assert.ok(u.elsewhere("trorune"));
  assert.equal(u.pop("heartlands"), "h2");
  assert.equal(u.pop("heartlands"), "h1");
  assert.equal(u.elsewhere("heartlands"), false);
});

test("the history keeps its limit across maps", () => {
  const u = new MapUndo(3);
  for (const s of ["a1", "b1", "a2", "b2"]) u.push(s[0], s);
  assert.equal(u.pop("a"), "a2");
  assert.equal(u.pop("a"), null, "a1 was the oldest and went");
});

test("the biome editor: Ctrl+Z on the realm map never writes the regional map's biomes there", async () => {
  let world = "the-heartlands";
  const saved = { trorune: { zones: { realm: { pts: [] } } }, "the-heartlands": { zones: { region: { pts: [] } } } };
  const editor = new BiomeEditor({ getWorld: () => world, getBiomes: () => saved[world], saveBiomes: async (fn) => { saved[world] = fn(structuredClone(saved[world])); }, getLayer: () => null });
  globalThis.game = { user: { isGM: true } };
  editor.active = false;
  // An edit on the regional map: its old biomes are remembered.
  await editor.commit((c) => ({ ...c, zones: { ...c.zones, moved: { pts: [] } } }));
  // On the realm map, Ctrl+Z: nothing of the regional map's lands here.
  world = "trorune";
  await editor.back();
  assert.deepEqual(Object.keys(saved.trorune.zones), ["realm"], "the realm's biomes are untouched");
  assert.match(notes.at(-1), /another map/);
  // Back on the regional map, the step undoes there.
  world = "the-heartlands";
  await editor.back();
  assert.deepEqual(Object.keys(saved["the-heartlands"].zones), ["region"]);
});

test("every map editor keeps a per-map history", async () => {
  const { readFileSync } = await import("node:fs");
  for (const file of ["ui-pins.mjs", "ui-roads.mjs", "ui-waterways.mjs", "ui-biomes.mjs"]) {
    const src = readFileSync(new URL(`../scripts/${file}`, import.meta.url), "utf8");
    assert.ok(src.includes("new MapUndo("), `${file} uses MapUndo`);
    assert.ok(/\.pop\(world\)/.test(src), `${file} undoes on this map only`);
  }
  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.equal((main.match(/getWorld: \(\) => current\?\.region\.world \?\? null/g) ?? []).length, 4, "each editor knows its map");
});
