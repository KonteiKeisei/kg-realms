import { test } from "node:test";
import assert from "node:assert/strict";
import { shoreWater, waterSideOf } from "../scripts/waterways.mjs";

const WATER = 8;
const blank = (w = 50, h = 50) => ({ data: new Uint8Array(w * h).fill(1), width: w, height: h, cell: 10 });
const at = (g, x, y) => g.data[Math.floor(y / g.cell) * g.width + Math.floor(x / g.cell)];

test("a shoreline across the map makes the side it names water", () => {
  // Drawn west to east across the middle: left of it is north (smaller y).
  const line = [[-20, 250], [520, 250]];
  const north = shoreWater(blank(), [{ pts: line, water: "left" }]);
  assert.equal(at(north, 250, 50), WATER);
  assert.equal(at(north, 250, 450), 1);
  const south = shoreWater(blank(), [{ pts: line, water: "right" }]);
  assert.equal(at(south, 250, 50), 1);
  assert.equal(at(south, 250, 450), WATER);
});

test("a loop is an island or a lake, whichever way it was drawn", () => {
  const square = [[150, 150], [350, 150], [350, 350], [150, 350], [150, 150]];
  for (const pts of [square, [...square].reverse()]) {
    const island = shoreWater(blank(), [{ pts, closed: true, water: "outside" }]);
    assert.equal(at(island, 250, 250), 1, "the island is land");
    assert.equal(at(island, 20, 20), WATER, "the sea round it is water");
    const lake = shoreWater(blank(), [{ pts, closed: true, water: "inside" }]);
    assert.equal(at(lake, 250, 250), WATER, "the lake is water");
    assert.equal(at(lake, 20, 20), 1, "the land round it stays land");
  }
});

test("a loop whose last point is not repeated still closes", () => {
  const lake = shoreWater(blank(), [{ pts: [[150, 150], [350, 150], [350, 350], [150, 350]], closed: true, water: "inside" }]);
  assert.equal(at(lake, 250, 250), WATER);
  assert.equal(at(lake, 20, 20), 1);
});

test("shorelines without a water side change nothing, and the given grid is never changed", () => {
  const g = blank();
  assert.equal(shoreWater(g, [{ pts: [[0, 0], [500, 500]] }]), g);
  const before = g.data.slice();
  shoreWater(g, [{ pts: [[-20, 250], [520, 250]], water: "left" }]);
  assert.deepEqual(g.data, before);
});

test("land marked on the map's own water becomes land", () => {
  const g = blank(); g.data.fill(WATER);
  const out = shoreWater(g, [{ pts: [[150, 150], [350, 150], [350, 350], [150, 350], [150, 150]], closed: true, water: "outside" }]);
  assert.equal(at(out, 250, 250), 1);
  assert.equal(at(out, 20, 20), WATER);
});

test("a shoreline whose water runs round an open end is named as leaking; a sealed one is not", () => {
  // Stops short of the map's edge at both ends: the sea flows round into the land side.
  const short = shoreWater(blank(), [{ id: "short", pts: [[100, 250], [400, 250]], water: "left" }]);
  assert.deepEqual(short.leaks, ["short"]);
  const across = shoreWater(blank(), [{ id: "across", pts: [[-20, 250], [520, 250]], water: "left" }]);
  assert.deepEqual(across.leaks, []);
  const loop = shoreWater(blank(), [{ id: "loop", pts: [[150, 150], [350, 150], [350, 350], [150, 350], [150, 150]], closed: true, water: "outside" }]);
  assert.deepEqual(loop.leaks, []);
});

test("a click picks the water side of a line or a loop", () => {
  const line = [[0, 100], [200, 100]];
  assert.equal(waterSideOf(line, false, [100, 20]), "left");
  assert.equal(waterSideOf(line, false, [100, 180]), "right");
  const loop = [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]];
  assert.equal(waterSideOf(loop, true, [50, 50]), "inside");
  assert.equal(waterSideOf(loop, true, [150, 50]), "outside");
});
