import { test } from "node:test";
import assert from "node:assert/strict";
import { JourneyLight } from "../scripts/journey-light.mjs";
import { makeFrame } from "../scripts/geo.mjs";

test("the night journey is drawn above scene darkness and follows its path", () => {
  class Graphics {
    constructor() { this.strokes = []; }
    clear() { this.strokes.length = 0; }
    lineStyle(width, color, alpha) { this.strokes.push({ width, color, alpha, points: [] }); }
    moveTo(x, y) { this.strokes.at(-1).points.push([x, y]); }
    lineTo(x, y) { this.strokes.at(-1).points.push([x, y]); }
    destroy() {}
  }
  const attached = [];
  globalThis.PIXI = { Graphics, BLEND_MODES: { ADD: 1 } };
  globalThis.canvas = {
    interface: { addChildAt: (child, index) => { attached.push([child, index]); } },
    app: { ticker: { add() {}, remove() {} }, renderer: { screen: { width: 200, height: 200 } } },
    stage: { scale: { x: 1 }, worldTransform: { applyInverse: (p) => ({ x: p.x, y: p.y }) } }
  };
  let look = "night";
  let mapZoom = 5;
  const light = new JourneyLight(() => look, () => mapZoom);
  light.attach(makeFrame({ west: 0, east: 2, south: 0, north: 2 }, { x: 0, y: 0, width: 200, height: 200 }));
  light.setPath([[0.2, 0.2], [1.8, 1.8]]);
  light.setRoutes({ features: [
    { properties: { kind: "road" }, geometry: { type: "LineString", coordinates: [[0.2, 0.2], [1.8, 1.8]] } },
    { properties: { kind: "trail" }, geometry: { type: "LineString", coordinates: [[0.2, 1.8], [1.8, 0.2]] } }
  ] });
  assert.deepEqual(attached.map(([, index]) => index), [0, 1]);
  assert.equal(light.graphics.visible, true);
  assert.equal(light.graphics.strokes.length, 3);
  assert.ok(light.graphics.strokes.every((stroke) => stroke.points.length === 2 && stroke.alpha <= 0.24));
  assert.equal(light.routeGraphics.visible, true);
  assert.equal(light.routeGraphics.strokes.length, 4);
  mapZoom = 3;
  light.update();
  assert.equal(light.routeGraphics.strokes.length, 2);
  look = "day";
  light.update();
  assert.equal(light.graphics.visible, false);
  assert.equal(light.routeGraphics.visible, false);
  light.setPath(null);
  light.destroy();
});
