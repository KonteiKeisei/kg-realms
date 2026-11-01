import { test } from "node:test";
import assert from "node:assert/strict";
import { traceBiome } from "../scripts/biome-trace.mjs";
import { biomeLookup, pointInBiome } from "../scripts/biomes.mjs";
const grid = rows => ({ data: Uint8Array.from(rows.flat()), width: rows[0].length, height: rows.length, cell: 4 });
test("a click traces only the connected forest, including a seed on its thick outline", () => {
  const g = grid([[1,1,1,1,1,1,1],[1,2,2,1,2,2,1],[1,2,2,1,2,2,1],[1,1,1,1,1,1,1]]);
  const r = traceBiome(g, [0, 4], 2); assert.equal(r.cells, 4); assert.equal(r.pts.length, 4); assert.ok(pointInBiome([6, 6], r.pts)); assert.ok(!pointInBiome([18, 6], r.pts));
});
test("traced forest clearings remain holes in rendering and biome inference", () => {
  const rows = Array.from({ length: 10 }, () => Array(10).fill(2)); for (let y = 3; y < 6; y++) for (let x = 3; x < 6; x++) rows[y][x] = 1;
  const r = traceBiome(grid(rows), [4, 4], 2); assert.equal(r.cells, 91); assert.equal(r.holes.length, 1);
  const q = biomeLookup({ zones: { wood: { name: "Wood", type: "forest", pts: r.pts, holes: r.holes } } });
  assert.equal(q(6, 6).zoneId, "wood"); assert.equal(q(18, 18).type, "plains");
});
test("map edges close correctly and diagonal-only forests stay separate", () => {
  const r = traceBiome(grid([[2,1],[1,2]]), [1,1], 2); assert.equal(r.cells, 1); assert.equal(r.pts.length, 4); assert.ok(pointInBiome([2,2], r.pts));
});
test("tracing is bounded and rejects water, missing terrain and a distant wrong biome", () => {
  assert.throws(() => traceBiome(null, [0,0], 2), /grid/);
  assert.throws(() => traceBiome(grid([[8]]), [0,0], 8), /grid/);
  assert.throws(() => traceBiome(grid([[1,1],[1,1]]), [0,0], 1, { maxCells: 2 }), /too large/);
  assert.throws(() => traceBiome(grid([[1]]), [0,0], 2), /No matching/);
  assert.throws(() => traceBiome(grid([[1]]), [-1,0], 1), /inside/);
});
