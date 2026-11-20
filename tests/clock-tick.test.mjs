import { test } from "node:test";
import assert from "node:assert/strict";
import { TravelHud } from "../scripts/ui-hud.mjs";

function hudFor(isGM) {
  globalThis.game = { user: { isGM } };
  const hud = new TravelHud({ getLayer: () => null });
  const calls = { draw: 0, render: 0, refresh: 0 };
  hud.draw = () => { calls.draw++; };
  hud.render = () => { calls.render++; };
  hud.refresh = () => { calls.refresh++; };
  return { hud, calls };
}

test("a player's clock tick redraws the panel, not the map", () => {
  const { hud, calls } = hudFor(false);
  hud.clockTick();
  assert.deepEqual(calls, { draw: 0, render: 1, refresh: 0 });
});

test("a GM's clock tick still redraws the map and the panel", () => {
  const { hud, calls } = hudFor(true);
  hud.clockTick();
  assert.deepEqual(calls, { draw: 1, render: 1, refresh: 0 });
});

test("a route refresh waiting on a player's client still runs on a clock tick", () => {
  const { hud, calls } = hudFor(false);
  hud.refreshPending = true;
  hud.clockTick();
  assert.equal(calls.refresh, 1);
});
