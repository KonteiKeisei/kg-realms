import { test } from "node:test";
import assert from "node:assert/strict";
import { TravelHud, pushedHourAdvance } from "../scripts/ui-hud.mjs";

test("pushing one hour stops the clock at an encounter or arrival", () => {
  const start = 1_000_000;
  assert.equal(pushedHourAdvance(start, start, { status: "decide", since: start + 3600 }), 3600);
  assert.equal(pushedHourAdvance(start, start, { status: "encounter", since: start + 1200 }), 1200);
  assert.equal(pushedHourAdvance(start, start, { status: "arrived", since: start + 900 }), 900);
  assert.equal(pushedHourAdvance(start + 4000, start, { status: "decide", since: start + 3600 }), 0);
  assert.equal(pushedHourAdvance(start + 4000, start, { status: "decide", since: start + 7600 }), 3600);
});

test("an older terrain request cannot redraw after a newer route refresh", async () => {
  const scene = { getFlag: () => ({ waypoints: [] }) };
  globalThis.canvas = { scene, tokens: { placeables: [] } };
  globalThis.game = { user: { isGM: false } };
  const pending = [];
  const hud = new TravelHud({ getLayer: () => null, getTerrain: () => new Promise((resolve) => pending.push(resolve)) });
  hud.el = {};
  let redraws = 0;
  hud.tick = () => { redraws++; };

  const older = hud.refresh(), newer = hud.refresh();
  pending[1](null);
  await newer;
  pending[0](null);
  await older;
  assert.equal(redraws, 1);

  const leaving = hud.refresh();
  canvas.scene = { getFlag: () => ({ waypoints: [] }) };
  pending[2](null);
  await leaving;
  assert.equal(redraws, 1);
});
