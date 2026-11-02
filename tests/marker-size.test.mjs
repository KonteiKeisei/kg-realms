import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("a picture marker is the size of the circle for the same kind of place", () => {
  const map = readFileSync(new URL("../scripts/source-map.mjs", import.meta.url), "utf8");
  const m = /picScale=\['case',pic,\['match',\['get','symbol'\],'city',([\d.]+),([\d.]+)\],1\]/.exec(map);
  assert.ok(m, "the scale is there");
  assert.equal(64 * Number(m[1]), 28.8, "a city's picture, against its 30 px circle");
  assert.equal(64 * Number(m[2]), 24, "any other, against its 24 px circle");
  assert.equal(map.split("picScale").length - 1, 5, "at every zoom");
});
