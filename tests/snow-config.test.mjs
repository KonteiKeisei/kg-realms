import { test } from "node:test";
import assert from "node:assert/strict";
import { snowConfig, snowLines, simpleFromMonths, SNOW_DEFAULTS, TORIL_SNOW, SNOW_LINE, snowLineAt } from "../scripts/snow.mjs";

const sheet = { height: 10000, milesPerPixel: 0.5, months: 12 };
const mid = (m) => (m + 0.5) / 12;

test("a world with no snow settings has snow at the north only", () => {
  const cfg = snowConfig(undefined, undefined);
  assert.equal(cfg.north.on, true);
  assert.equal(cfg.south.on, false);
  const l = snowLines(mid(0), cfg, sheet);
  assert.ok(l.north && !l.south);
});

test("the north's snow reaches furthest at midwinter and draws back by midsummer", () => {
  const cfg = snowConfig({ north: { winter: 0.5, summer: 0.1, band: 500 } });
  const winter = snowLines(mid(0), cfg, sheet).north, summer = snowLines(mid(6), cfg, sheet).north;
  assert.ok(Math.abs(winter.bare - 5000) < 1, "half way down in midwinter");
  assert.ok(Math.abs(summer.bare - 1000) < 1, "a tenth of the way in midsummer");
  assert.ok(Math.abs(winter.bare - winter.full - 1000) < 1, "a 500 mile band is 1,000 px");
});

test("the deepest winter month can be any month", () => {
  const cfg = snowConfig({ midwinter: 3, north: { winter: 0.5, summer: 0.1 } });
  assert.ok(Math.abs(snowLines(mid(3), cfg, sheet).north.bare - 5000) < 1);
  assert.ok(Math.abs(snowLines(mid(9), cfg, sheet).north.bare - 1000) < 1);
});

test("the south's snow grows up from the bottom edge, its winter half a year later unless set otherwise", () => {
  const cfg = snowConfig({ south: { on: true, winter: 0.3, summer: 0.05, band: 250 } });
  const north = snowLines(mid(0), cfg, sheet), south = snowLines(mid(6), cfg, sheet).south;
  assert.ok(Math.abs(south.bare - 7000) < 1, "midwinter in the south comes in the north's midsummer");
  assert.ok(south.full > south.bare, "full cover is nearer the bottom edge");
  assert.ok(Math.abs(north.south.bare - 9500) < 1, "the north's midwinter is the south's midsummer");
  const same = snowLines(mid(0), snowConfig({ reversed: false, south: { on: true, winter: 0.3, summer: 0.05 } }), sheet).south;
  assert.ok(Math.abs(same.bare - 7000) < 1, "not reversed: both poles' winter at once");
});

test("a world can have snow at the south only, or at neither pole", () => {
  const south = snowLines(mid(6), snowConfig({ north: { on: false }, south: { on: true, winter: 0.3, summer: 0.05 } }), sheet);
  assert.equal(south.north, null);
  assert.ok(south.south && Math.abs(south.south.bare - 7000) < 1);
  const none = snowLines(mid(0), snowConfig({ north: { on: false } }), sheet);
  assert.equal(none.north, null);
  assert.equal(none.south, null);
});

test("high ground holds snow further out, in miles", () => {
  const l = snowLines(0, snowConfig({ mountains: 100, hills: 25 }), sheet);
  assert.equal(l.mountain, 200);
  assert.equal(l.hill, 50);
});

test("Toril keeps its month-by-month line until the GM sets their own", () => {
  const cfg = snowConfig(undefined, TORIL_SNOW);
  assert.deepEqual(snowLines(mid(0), cfg, sheet).north, snowLineAt(mid(0), SNOW_LINE));
  assert.ok(Array.isArray(snowConfig({ north: { on: true } }, TORIL_SNOW).north.months), "switching a pole on keeps the module's line");
  const own = snowConfig({ north: { winter: 0.3 } }, TORIL_SNOW);
  assert.equal(own.north.months, undefined, "a reach of their own replaces it");
  const simple = simpleFromMonths(SNOW_LINE, 9150, 0.294);
  assert.equal(simple.midwinter, 0);
  assert.ok(simple.winter > simple.summer && simple.band > 0);
});

test("defaults are not changed by a world's settings", () => {
  snowConfig({ north: { winter: 0.9 } });
  assert.equal(SNOW_DEFAULTS.north.winter, 0.4);
});
