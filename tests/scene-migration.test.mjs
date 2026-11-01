import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFrame, latLonToScene, sceneToLatLon } from "../scripts/geo.mjs";
import { sceneSizeAt } from "../scripts/generator.mjs";

test("preset expansion and shrinking preserve drawing geography and scale polygon points", async () => {
  const hooks = {}, notices = [];
  globalThis.Hooks = { once: (name, fn) => (hooks[name] ??= []).push(fn), on: () => {} };
  const merge = (target, source) => {
    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === "object" && !Array.isArray(value)) merge(target[key] ??= {}, value);
      else target[key] = value;
    }
    return target;
  };
  globalThis.foundry = { utils: { mergeObject: merge, debounce: (fn) => fn } };
  const rectOf = (s) => ({ x: Math.ceil(s.width * s.padding / s.grid.size) * s.grid.size, y: Math.ceil(s.height * s.padding / s.grid.size) * s.grid.size, width: s.width, height: s.height });
  const makeScene = (name, bounds, size) => {
    const scene = { name, ...size, padding: 0.1, grid: { size: 100, distance: 10 },
      flags: { "kg-realms": { world: "toril", level: "surface", bounds: { ...bounds }, milesPer100: 10, version: 1 }, calendaria: { weatherFxOverride: "off" } },
      getFlag: (scope, key) => scene.flags[scope]?.[key], updateSource: (data) => merge(scene, data),
      update: async (data, options) => { assert.equal(options.diff, false); merge(scene, data); },
      getEmbeddedDocument: () => drawing, updateEmbeddedDocuments: async (name, updates) => { assert.equal(name, "Drawing"); merge(drawing, updates[0]); }
    };
    const frame = makeFrame(bounds, rectOf(scene));
    const ll = { lat: (bounds.north + bounds.south) / 2, lon: (bounds.east + bounds.west) / 2 };
    const p = latLonToScene(frame, ll.lat, ll.lon);
    const drawing = { id: name, x: p.x, y: p.y, shape: { width: 200, height: 100, points: [0, 0, 200, 0, 100, 100] }, updateSource: (data) => merge(drawing, data) };
    scene.drawings = { size: 1, contents: [drawing] };
    return { scene, drawing, ll, frame };
  };
  const bounds = { west: -82, east: -27, south: 6, north: 58 };
  const expanded = makeScene("Faerun", bounds, sceneSizeAt(bounds, 10));
  const customBounds = { west: -75, east: -65, south: 40, north: 50 };
  const shrunk = makeScene("Custom", customBounds, { width: 80000, height: 100000 });
  globalThis.game = { scenes: [expanded.scene, shrunk.scene], user: { isGM: true }, settings: { get: () => 40000 } };
  globalThis.canvas = { scene: null };
  globalThis.ui = { notifications: { info: (s) => notices.push(s), warn: (s) => notices.push(s) } };
  await import("../scripts/main.mjs");
  const repair = hooks.ready.find((fn) => fn.toString().includes("repairScenes();"));
  assert.ok(repair, "the scene repair ready hook is registered");
  await repair();
  assert.equal(expanded.scene.flags["kg-realms"].bounds.west, -84);
  assert.equal(expanded.scene.flags["kg-realms"].version, 2);
  assert.deepEqual(shrunk.scene.flags["kg-realms"].bounds, customBounds);
  assert.ok(Math.max(shrunk.scene.width, shrunk.scene.height) <= 40000);
  for (const example of [expanded, shrunk]) {
    const frame = makeFrame(example.scene.flags["kg-realms"].bounds, rectOf(example.scene));
    const ll = sceneToLatLon(frame, example.drawing);
    assert.ok(Math.abs(ll.lon - example.ll.lon) < 1e-9 && Math.abs(ll.lat - example.ll.lat) < 1e-9);
    assert.ok(Math.abs(example.drawing.shape.points[2] - 200 * frame.kx / example.frame.kx) < 1e-9);
    assert.ok(Math.abs(example.drawing.shape.points[5] - 100 * frame.ky / example.frame.ky) < 1e-9);
  }
  assert.ok(notices.some((s) => s.includes("Moonshae")));
});
