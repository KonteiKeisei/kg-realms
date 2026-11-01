import { test } from "node:test";
import assert from "node:assert/strict";
import { simplifyLine, smoothLine, joinLines } from "../scripts/routes.mjs";
const id = (x, y) => [x, y];

test("simplify drops nodes on a straight run and keeps corners", () => {
  const line = [[0, 0], [1, 0.1], [2, 0], [3, -0.1], [4, 0], [4, 1], [4, 2], [4, 3]];
  assert.deepEqual(simplifyLine(line, id, 0.5), [[0, 0], [4, 0], [4, 3]]);
  assert.deepEqual(simplifyLine(line, id, 0.5, [2]), [[0, 0], [2, 0], [4, 0], [4, 3]]);
});

test("smooth curves pass through every node", () => {
  const line = [[0, 0], [30, 0], [30, 30]];
  const out = smoothLine(line, id, id);
  assert.ok(out.length > 10);
  for (const p of line) assert.ok(out.some((q) => q[0] === p[0] && q[1] === p[1]));
  // Dense lines are left alone.
  const dense = [[0, 0], [1, 0], [2, 1]];
  assert.deepEqual(smoothLine(dense, id, id), dense);
});

test("join meets two roads at their closest ends", () => {
  const j = joinLines([[0, 0], [5, 0]], [[9, 0], [5, 0]], id);
  assert.equal(j.gap, 0);
  assert.deepEqual(j.coordinates, [[0, 0], [5, 0], [9, 0]]);
});