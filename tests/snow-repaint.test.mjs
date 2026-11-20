import { test } from "node:test";
import assert from "node:assert/strict";
import { SnowCover, snowConfig } from "../scripts/snow.mjs";

const months = Array.from({ length: 12 }, () => ({ days: 30 }));

function setup() {
  const clock = { month: 2, dayOfMonth: 10, hour: 8 };
  globalThis.game = { time: { calendar: { monthsArray: months }, get components() { return clock; } } };
  const snow = new SnowCover(), map = { repaints: 0, triggerRepaint() { this.repaints++; } };
  Object.assign(snow, { map, sheet: { height: 1000, milesPerPixel: 1 }, config: snowConfig({}) });
  return { snow, map, clock };
}

test("a clock tick within the same day neither recomputes nor repaints the snow", () => {
  const { snow, map, clock } = setup();
  snow.setDate();
  const lines = snow.lines;
  clock.hour = 9; snow.setDate();
  clock.hour = 23; snow.setDate();
  assert.equal(map.repaints, 1);
  assert.equal(snow.lines, lines);
});

test("a new day, new settings, a preview and a new map each repaint", () => {
  const { snow, map, clock } = setup();
  snow.setDate();
  clock.dayOfMonth = 11; snow.setDate();
  assert.equal(map.repaints, 2);
  snow.setConfig(snowConfig({}));
  assert.equal(map.repaints, 3);
  snow.preview(0.5);
  assert.equal(map.repaints, 4);
  snow.preview(null);
  assert.equal(map.repaints, 5);
  const other = { repaints: 0, triggerRepaint() { this.repaints++; } };
  snow.map = other; snow.setDate();
  assert.equal(other.repaints, 1);
});
