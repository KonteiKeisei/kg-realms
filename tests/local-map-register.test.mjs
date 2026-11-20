import { test } from "node:test";
import assert from "node:assert/strict";
import { affectsLocalMap } from "../scripts/local-map-renderer.mjs";

class ForcedDeletion {}

test("journey snapshots, the weather and other modules' flags leave local maps alone", () => {
  assert.equal(affectsLocalMap({ _id: "s", flags: { "kg-realms": { journey: { now: { hour: 3 } } } } }), false);
  assert.equal(affectsLocalMap({ "flags.kg-realms.journey.now.hour": 3 }), false);
  assert.equal(affectsLocalMap({ flags: { calendaria: { climateOverride: "arctic" }, "kg-realms": { climateSet: "arctic" } } }), false);
  assert.equal(affectsLocalMap({ flags: { "other-module": { localMap: 1 } } }), false);
  assert.equal(affectsLocalMap({ darkness: 0.5, _stats: { modifiedTime: 1 } }), false);
  assert.equal(affectsLocalMap({}), false);
  assert.equal(affectsLocalMap(undefined), false);
});

test("a background, levels or local map flag change re-registers", () => {
  assert.equal(affectsLocalMap({ background: { src: "a.webp" } }), true);
  assert.equal(affectsLocalMap({ "background.src": "a.webp" }), true);
  assert.equal(affectsLocalMap({ levels: [{ _id: "l", background: { src: "a.webp" } }] }), true);
  assert.equal(affectsLocalMap({ initialLevel: "l2" }), true);
  assert.equal(affectsLocalMap({ flags: { "kg-realms": { localMap: { placeId: "p" } } } }), true);
  assert.equal(affectsLocalMap({ flags: { "kg-realms": { localMap: { tileAsset: { source: "x" } } } } }), true);
  assert.equal(affectsLocalMap({ "flags.kg-realms.localMap.tileAsset": { source: "x" } }), true);
});

test("removing the local map flag re-registers, as v13 and v14 write it", () => {
  assert.equal(affectsLocalMap({ flags: { "kg-realms": { "-=localMap": null } } }), true);
  assert.equal(affectsLocalMap({ "flags.kg-realms.-=localMap": null }), true);
  assert.equal(affectsLocalMap({ flags: { "kg-realms": { localMap: new ForcedDeletion() } } }), true);
  assert.equal(affectsLocalMap({ flags: { "-=kg-realms": null } }), true);
  assert.equal(affectsLocalMap({ flags: { "kg-realms": new ForcedDeletion() } }), true);
});
