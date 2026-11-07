import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSea, planSea, portVoyage } from "../scripts/waterways.mjs";

// A terrain grid (4 px cells, water = 8): a west sea and an east sea split by a land wall, and a
// small lake shut in by land in the west.
function grid() {
  const width = 150, height = 90, data = new Uint8Array(width * height).fill(8);
  for (let y = 0; y < height; y++) for (let x = 60; x < 90; x++) data[y * width + x] = 1;
  // The sea grid is three terrain cells to one, and a sea cell is wet if any of its nine is: the
  // lake's land ring is thick enough to stay land at that scale.
  for (let y = 3; y < 33; y++) for (let x = 3; x < 33; x++) data[y * width + x] = (x >= 14 && x < 23 && y >= 14 && y < 23) ? 8 : 1;
  return { data, width, height, cell: 4 };
}
const west = [45 * 4, 50 * 4], west2 = [40 * 4, 75 * 4], east = [120 * 4, 50 * 4], lake = [18 * 4, 18 * 4];
const river = { kind: "river", name: "Join", pts: [[56 * 4, 60 * 4], [75 * 4, 60 * 4], [94 * 4, 60 * 4]] };

// The same search with no labels: what planSea gave before the regions.
const unlabelled = (sea) => ({ ...sea, region: undefined });
const counting = (sea) => { let reads = 0; const links = new Proxy(sea.links, { get(t, k) { if (k === "get") reads++; const v = Reflect.get(t, k); return typeof v === "function" ? v.bind(t) : v; } }); return { sea: { ...sea, links }, reads: () => reads }; };

test("water no boat can cross gives no route at once, without searching the map", () => {
  const sea = buildSea(grid(), [], { milesPerPixel: 0.5 });
  assert.notEqual(sea.region[sea.cellOf(west)], sea.region[sea.cellOf(east)]);
  assert.notEqual(sea.region[sea.cellOf(west)], sea.region[sea.cellOf(lake)]);
  const probe = counting(sea);
  assert.equal(planSea(probe.sea, west, east, { mph: 4 }), null);
  assert.equal(probe.reads(), 0, "no cell was searched");
  assert.equal(planSea(unlabelled(sea), west, east, { mph: 4 }), null, "the full search agrees");
  assert.equal(planSea(sea, west, lake, { mph: 4 }), null);
});

test("two waters joined only by a river still route, by the river", () => {
  const sea = buildSea(grid(), [river], { milesPerPixel: 0.5 });
  assert.equal(sea.region[sea.cellOf(west)], sea.region[sea.cellOf(east)]);
  const plan = planSea(sea, west, east, { mph: 4 });
  assert.ok(plan && plan.legs.some((l) => l.kind === "river"));
  assert.deepEqual(plan, planSea(unlabelled(sea), west, east, { mph: 4 }));
});

test("routes that exist come out exactly as before", () => {
  for (const ways of [[], [river]]) {
    const sea = buildSea(grid(), ways, { milesPerPixel: 0.5 });
    for (const [a, b] of [[west, west2], [west2, west], [west, east], [east, west2], [lake, lake]]) for (const opts of [{ mph: 4 }, { mph: 2, ways: "sea" }, { mph: 3, ways: "river" }]) {
      assert.deepEqual(planSea(sea, a, b, opts), planSea(unlabelled(sea), a, b, opts), JSON.stringify([a, b, opts, ways.length]));
    }
  }
});

test("ports on separate waters still get their voyage (the over-land fallback is unchanged)", () => {
  const sea = buildSea(grid(), [], { milesPerPixel: 0.5 });
  const now = portVoyage(sea, west, east, { mph: 4 }), before = portVoyage(unlabelled(sea), west, east, { mph: 4 });
  assert.ok(now.miles > 0);
  assert.deepEqual(now, before);
});
