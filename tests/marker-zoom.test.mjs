import { test } from "node:test";
import assert from "node:assert/strict";
import { markerAtZoom, alwaysShown } from "../scripts/local-places.mjs";

test("markers follow the zoom between their on-screen limits", () => {
  const near = markerAtZoom(120, 0.3); // 36 px: as drawn
  assert.equal(near.visible, true); assert.equal(near.factor, 1);
  const close = markerAtZoom(120, 2); // 240 px would be huge: held at 64
  assert.equal(Math.round(120 * 2 * close.factor), 64);
  const far = markerAtZoom(120, 0.17); // 20.4 px: shown, raised to 24
  assert.equal(far.visible, true); assert.equal(Math.round(120 * 0.17 * far.factor), 24);
});

test("zoomed far out, only always shown places stay", () => {
  assert.equal(markerAtZoom(120, 0.1).visible, false);
  assert.equal(markerAtZoom(120, 0.1, { always: true }).visible, true);
  for (const category of ["gate", "landmark", "district"]) assert.equal(alwaysShown({ category }), true, category);
  assert.equal(alwaysShown({ category: "inn" }), false);
  assert.equal(alwaysShown({ category: "inn", keyPlace: true }), true);
  assert.equal(alwaysShown({ category: "harbour", entry: true }), true);
});
