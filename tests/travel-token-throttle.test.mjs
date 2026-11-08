// 0.96.1: the party's tokens go to every client, so on the move they are sent at most every 2 seconds.
import test from "node:test";
import assert from "node:assert/strict";
import { tokenMoveDue } from "../scripts/ui-hud.mjs";

test("on the move, a token update waits until 2 seconds have passed", () => {
  assert.equal(tokenMoveDue({ status: "moving", lastStatus: "moving", since: 500 }), false);
  assert.equal(tokenMoveDue({ status: "moving", lastStatus: "moving", since: 2000 }), true);
});

test("stops, encounters, camps and arrival move the tokens at once", () => {
  for (const status of ["encounter", "decide", "stay", "halted", "resting", "arrived"]) assert.equal(tokenMoveDue({ status, lastStatus: "moving", since: 10 }), true);
  assert.equal(tokenMoveDue({ status: "moving", lastStatus: "stay", since: 10 }), true);
});

test("a forced update or a jump in the clock is never held back", () => {
  assert.equal(tokenMoveDue({ force: true, status: "moving", lastStatus: "moving", since: 0 }), true);
});
