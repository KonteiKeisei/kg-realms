import { test } from "node:test";
import assert from "node:assert/strict";
import { streetRuns, smoothLine } from "../scripts/city/street-names.mjs";

// A street east 100 then south 100: a corner at 100.
const corner = { at: (s) => s <= 100 ? { x: s, y: 0, angle: 0 } : { x: 100, y: s - 100, angle: Math.PI / 2 } };

// A street that never runs straight: a wide gentle arc, with a little jitter as traced streets have.
const arc = { at: (s) => { const R = 400, t = s / R, j = Math.sin(s * 1.7) * 1.5; return { x: Math.sin(t) * (R + j), y: (1 - Math.cos(t)) * (R + j), angle: t }; } };

test("a name never goes round a corner, and follows a gentle bend smoothly", () => {
  assert.equal(smoothLine(corner, 100, 60, 8), null);
  const flat = smoothLine(corner, 40, 60, 8);
  assert.ok(flat && flat.length > 55);
  const bend = smoothLine(arc, 300, 120, 12);
  assert.ok(bend, "a curving street still gets its name");
  // No wiggle: the direction changes steadily along the name.
  const turns = []; for (let s = 10; s < bend.length; s += 10) turns.push(bend.at(s).angle - bend.at(s - 10).angle);
  assert.ok(turns.every((d) => d > -0.02 && d < 0.1), JSON.stringify(turns));
});

test("pieces of one street join end to end, either way round, and stop where it branches", () => {
  const roads = [
    { name: "Selduth Street", kind: "street", points: [[0, 0], [100, 0]] },
    { name: "Selduth Street", kind: "street", points: [[200, 0], [100, 0]] }, // drawn the other way
    { name: "Selduth Street", kind: "street", points: [[200, 0], [300, 0]] },
    { name: "Fish Street", kind: "lane", points: [[300, 0], [300, 100]] },
    { name: "", kind: "lane", points: [[0, 0], [0, 50]] },
    { name: "New alley", kind: "alley", points: [[0, 0], [0, -50]] }
  ];
  const runs = streetRuns(roads);
  assert.equal(runs.length, 2);
  const selduth = runs.find((r) => r.name === "Selduth Street");
  assert.deepEqual(selduth.points, [[0, 0], [100, 0], [200, 0], [300, 0]]);
  // Three pieces meeting at one point: a branch, so not joined through.
  const branched = streetRuns([...roads.slice(0, 3), { name: "Selduth Street", kind: "street", points: [[100, 0], [100, 80]] }]);
  assert.equal(branched.filter((r) => r.name === "Selduth Street").length, 3);
});
