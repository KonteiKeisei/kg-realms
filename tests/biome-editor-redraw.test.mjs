import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmLayer } from "../scripts/realm-layer.mjs";

globalThis.foundry ??= { utils: { escapeHTML: (s) => String(s), randomID: () => "id" } };
globalThis.canvas = { app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } } };
const { BiomeEditor } = await import("../scripts/ui-biomes.mjs");

function layerWithMap() {
  const sends = [];
  const map = { style: { _loaded: true }, isStyleLoaded: () => true, getLayer: () => true, addLayer() {}, addSource() {}, getSource: (id) => ({ setData: (d) => sends.push([id, d]) }) };
  const layer = new RealmLayer(); layer.ready = true; layer.map = map;
  return { layer, sends };
}
const zone = (id, x) => ({ id, name: id, color: "#123456", pts: [[x, 0], [x + 1, 0], [x + 1, 1]] });

test("the same zones twice go to the map once; a changed zone or selection goes again", () => {
  const { layer, sends } = layerWithMap();
  layer.setBiomes([zone("a", 0), zone("b", 5)], "a");
  layer.setBiomes([zone("a", 0), zone("b", 5)], "a");
  assert.equal(sends.length, 1);
  layer.setBiomes([zone("a", 0), zone("b", 5)], "b");
  layer.setBiomes([zone("a", 0), zone("b", 6)], "b");
  assert.equal(sends.length, 3);
});

test("a call before the map is ready is not remembered as sent", () => {
  const { layer, sends } = layerWithMap();
  layer.ready = false;
  layer.setBiomes([zone("a", 0)], null);
  layer.ready = true;
  layer.setBiomes([zone("a", 0)], null);
  assert.equal(sends.length, 1);
});

test("dragging a corner draws only the edited outline, at most once a frame, and saves every zone once", async () => {
  const frames = [], biomeSends = [], edits = [];
  const config = { types: {}, zones: { a: zone("a", 0), b: zone("b", 5) } };
  const layer = { frame: {}, toScreen: (x, y) => [x * 100, y * 100], fromScreen: (x, y) => [x / 100, y / 100], setBiomes: (z) => biomeSends.push(z), setRouteEdit: (line, nodes) => edits.push({ line, nodes }) };
  const editor = new BiomeEditor({ getLayer: () => layer, getBiomes: () => config, saveBiomes: async (fn) => { Object.assign(config, fn(config)); }, request: (fn) => frames.push(fn), cancel: () => {} });
  editor.active = true;
  editor.select("a");
  const sentBefore = biomeSends.length;
  editor.drag = editor.node = 1;
  const ev = (x, y) => ({ clientX: x, clientY: y, preventDefault() {}, stopImmediatePropagation() {} });
  for (let i = 0; i < 10; i++) editor.move(ev(100 + i * 5, 0));
  assert.equal(biomeSends.length, sentBefore, "no zone goes to the map while dragging");
  assert.equal(frames.length, 1, "ten pointer moves, one frame");
  frames.shift()();
  const last = edits.at(-1);
  assert.deepEqual(last.line.at(-1), last.line[0], "the edited outline, closed");
  assert.deepEqual(last.nodes[1], [1.45, 0]);
  globalThis.game = { user: { isGM: true } };
  await editor.up(ev(145, 0));
  assert.deepEqual(config.zones.a.pts[1], [1.45, 0], "the corner is saved where it was let go");
  assert.equal(biomeSends.length, sentBefore + 1, "every zone goes to the map once, after the save");
});

test("a new zone's fill leaves out the corner following the pointer; the edit line has it", () => {
  const frames = [], biomeSends = [], edits = [];
  const layer = { frame: {}, toScreen: (x, y) => [x, y], fromScreen: (x, y) => [x, y], setBiomes: (z) => biomeSends.push(z), setRouteEdit: (line) => edits.push(line) };
  const editor = new BiomeEditor({ getLayer: () => layer, getBiomes: () => ({ types: {}, zones: {} }), request: (fn) => frames.push(fn), cancel: () => {} });
  editor.active = true; editor.draft = true; editor.coords = [[0, 0], [1, 0]];
  editor.draw();
  const sent = biomeSends.length;
  editor.move({ clientX: 5, clientY: 5, preventDefault() {}, stopImmediatePropagation() {} });
  frames.shift()();
  assert.equal(biomeSends.length, sent, "moving the pointer sends no zones");
  assert.deepEqual(edits.at(-1), [[0, 0], [1, 0], [5, 5]]);
});
