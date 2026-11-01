import { test } from "node:test";
import assert from "node:assert/strict";
import { hiddenByFiner } from "../scripts/terrain/lod-cache.mjs";

const view = { x0: 0, y0: 0, x1: 100, y1: 100 };
const coarse = { lod: 0, x: 0, y: 0, width: 200, height: 200 };
const quarter = (x, y, lod = 1) => ({ lod, x, y, width: 100, height: 100 });

test("a coarse tile under finer tiles that fill the view is not drawn", () => {
  assert.equal(hiddenByFiner(coarse, [quarter(0, 0)], view), true);
});

test("a coarse tile still shows through gaps where finer tiles are not loaded", () => {
  const halfView = { x0: 0, y0: 0, x1: 150, y1: 100 };
  assert.equal(hiddenByFiner(coarse, [quarter(0, 0)], halfView), false);
  assert.equal(hiddenByFiner(coarse, [quarter(0, 0), quarter(100, 0)], halfView), true);
});

test("two finer levels that each cover part do not add up to cover it", () => {
  const halfView = { x0: 0, y0: 0, x1: 150, y1: 100 };
  assert.equal(hiddenByFiner(coarse, [quarter(0, 0, 1), { lod: 2, x: 100, y: 0, width: 50, height: 100 }], halfView), false);
});
