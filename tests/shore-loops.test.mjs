import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSea, planSea, shoreWater } from "../scripts/waterways.mjs";

const WATER = 8;
const blank = () => ({ data: new Uint8Array(500 * 400).fill(1), width: 500, height: 400, cell: 4 });
const at = (g, x, y) => g.data[Math.floor(y / 4) * 500 + Math.floor(x / 4)];
const square = (x, y, r) => [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];
// A coast with a deep, wiggling edge, so its two sides' sample points cross over each other.
const wiggly = () => {
  const pts = [];
  for (let x = 400; x < 1600; x += 6) pts.push([x, 300 + (Math.floor(x / 6) % 2 ? 14 : -14)]);
  for (let y = 300; y < 1300; y += 6) pts.push([1600 + (Math.floor(y / 6) % 2 ? 14 : -14), y]);
  for (let x = 1600; x > 400; x -= 6) pts.push([x, 1300 + (Math.floor(x / 6) % 2 ? 14 : -14)]);
  for (let y = 1300; y > 300; y -= 6) pts.push([400 + (Math.floor(y / 6) % 2 ? 14 : -14), y]);
  return pts;
};

test("a closed coast never leaks, however it wiggles: outside is sea, inside is land", () => {
  for (const pts of [wiggly(), wiggly().reverse()]) {
    const g = shoreWater(blank(), [{ id: "c", closed: true, water: "outside", pts }]);
    assert.deepEqual(g.leaks, []);
    assert.equal(at(g, 100, 100), WATER, "open ocean");
    assert.equal(at(g, 1000, 800), 1, "the land");
  }
});

test("inside the loop makes the water the inside", () => {
  const g = shoreWater(blank(), [{ id: "l", closed: true, water: "inside", pts: square(1000, 800, 200) }]);
  assert.equal(at(g, 1000, 800), WATER);
  assert.equal(at(g, 100, 100), 1, "what lies outside stays as the map has it");
});

test("the smallest loop has the say: a lake in the land, an island in the lake", () => {
  const g = shoreWater(blank(), [
    { id: "c", closed: true, water: "outside", pts: square(1000, 800, 600) },
    { id: "l", closed: true, water: "inside", pts: square(1000, 800, 200) },
    { id: "i", closed: true, water: "outside", pts: square(1000, 800, 50) }
  ]);
  assert.equal(at(g, 100, 100), WATER, "ocean");
  assert.equal(at(g, 600, 800), 1, "land");
  assert.equal(at(g, 900, 800), WATER, "lake");
  assert.equal(at(g, 1000, 800), 1, "island");
});

test("a bad point in a loop does not spoil it", () => {
  const g = shoreWater(blank(), [{ id: "c", closed: true, water: "outside", pts: [...square(1000, 800, 400), [NaN, 5]] }]);
  assert.equal(at(g, 100, 100), WATER);
  assert.equal(at(g, 1000, 800), 1);
});

test("a ship uses the ocean round a closed coast, not the land", () => {
  const shores = [{ id: "c", kind: "shore", closed: true, water: "outside", pts: wiggly() }];
  const sea = buildSea(shoreWater(blank(), shores), shores, { milesPerPixel: 0.5 });
  const p = planSea(sea, [1000, 300], [1000, 1300], { mph: 2, reach: 36 });
  assert.ok(p && p.miles > 1000, "round the coast: " + p?.miles);
  for (const l of p.legs) for (const q of l.pts) assert.ok(q[1] < 340 || q[1] > 1260 || q[0] < 440 || q[0] > 1560, "never inland: " + q);
});

test("an open shoreline still leaks round its end, and says so", () => {
  const g = shoreWater(blank(), [{ id: "o", water: "left", pts: [[600, 600], [1400, 600]] }]);
  assert.deepEqual(g.leaks, ["o"]);
});
