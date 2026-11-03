import test from "node:test";
import assert from "node:assert/strict";
import { TravelHud } from "../scripts/ui-hud.mjs";
import { sourceProjection, applySourceMap, SOURCE_MAP } from "../scripts/source-map.mjs";
import { homebrewSheet } from "../scripts/homebrew/plan.mjs";
import { gmGame } from "./helpers/journey.mjs";

test("concurrent planners retain their own distances and coordinates across an awaited load", async () => {
  gmGame(); globalThis.canvas = { scene: null, tokens: { placeables: [] } };
  const original = structuredClone(SOURCE_MAP);
  const a = homebrewSheet(1000, 800, 100), b = homebrewSheet(8000, 4000, 2000);
  const make = sheet => {
    const p = sourceProjection(sheet);
    const stops = [100, 900].map(x => { const [lon, lat] = p.toLonLat(x, 100); return {lon, lat}; });
    const state = { start: stops[0], waypoints: [stops[1]], legModes: ["direct"] };
    let ready;
    const hud = new TravelHud({ headless: true, getScene: () => ({ getFlag: () => state }), getSourceMap: () => p.sourceMap,
      getLayer: () => null, getPlaces: () => [], getRoutes: () => ({features: []}), getWaterways: () => ({}),
      getEncounters: () => [], getTerrain: () => new Promise(resolve => { ready = resolve; }) });
    const scene = { getFlag: () => state }; hud.getScene = () => scene;
    hud.stops = () => stops; hud.speed = () => ({feet:30}); hud.favoredTerrains = () => []; hud.tick = () => {};
    return {hud, release: () => ready(null)};
  };
  try {
    const first = make(a), second = make(b);
    const pa = first.hud.refresh(), pb = second.hud.refresh();
    applySourceMap(b); first.release(); await pa;
    applySourceMap(a); second.release(); await pb;
    assert.ok(Math.abs(first.hud.result.miles - 80) < 1e-6);
    assert.ok(Math.abs(second.hud.result.miles - 200) < 1e-6);
    assert.deepEqual(first.hud.toSource(...first.hud.toLonLat(100,100)).map(Math.round),[100,100]);
    assert.equal(SOURCE_MAP.milesPerPixel, a.milesPerPixel);
  } finally { applySourceMap(original); }
});
