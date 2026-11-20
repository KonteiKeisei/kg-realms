import { test } from "node:test";
import assert from "node:assert/strict";
import { dayGate } from "../scripts/day-gate.mjs";

test("clock ticks within one day pass once; the next day passes again", () => {
  const gate = dayGate();
  const at = (dayOfMonth, hour) => ({ year: 1492, month: 2, dayOfMonth, hour });
  assert.equal(gate(at(10, 8)), true, "the first tick after loading");
  assert.equal(gate(at(10, 9)), false);
  assert.equal(gate(at(10, 23)), false);
  assert.equal(gate(at(11, 0)), true);
  assert.equal(gate({ year: 1493, month: 2, dayOfMonth: 11 }), true, "the same day a year on");
});
