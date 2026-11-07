import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { onlyJourneyProgress } from "../scripts/journey-state.mjs";

const now = { hour: 12.35, status: "moving", told: "k" };
const stats = { _id: "scene1", _stats: { modifiedTime: 1 } };

test("a travelling party's position update alone counts as progress (one party and split parties)", () => {
  assert.equal(onlyJourneyProgress({ ...stats, flags: { "kg-realms": { journey: { now } } } }), true);
  assert.equal(onlyJourneyProgress({ flags: { "kg-realms": { partyJourneys: { abc: { now } } } } }), true);
  assert.equal(onlyJourneyProgress({ flags: { "kg-realms": { partyJourneys: { abc: { now }, def: { now } } } } }), true);
  assert.equal(onlyJourneyProgress({ flags: { "kg-realms": { journey: { now: null } } } }), true, "a cleared position");
  // Dotted keys, as an update is written, read the same.
  assert.equal(onlyJourneyProgress({ "flags.kg-realms.journey.now.hour": 3 }), true);
  assert.equal(onlyJourneyProgress({ "flags.kg-realms.partyJourneys.abc.now": now }), true);
});

test("anything else in the update makes it a real change", () => {
  const withNow = (extra) => ({ ...stats, ...extra, flags: { ...(extra.flags ?? {}), "kg-realms": { journey: { now }, ...(extra.flags?.["kg-realms"] ?? {}) } } });
  assert.equal(onlyJourneyProgress(withNow({ flags: { "kg-realms": { journey: { now, encounters: [] } } } })), false, "encounters");
  assert.equal(onlyJourneyProgress({ flags: { "kg-realms": { journey: { now, waypoints: [] } } } }), false, "the route");
  assert.equal(onlyJourneyProgress({ flags: { "kg-realms": { journey: { now, watch: { campId: "c" } } } } }), false, "a camp");
  assert.equal(onlyJourneyProgress({ flags: { "kg-realms": { partyJourneys: { abc: { now, trip: null } } } } }), false, "a party's trip");
  assert.equal(onlyJourneyProgress(withNow({ name: "Renamed" })), false, "the scene's name");
  assert.equal(onlyJourneyProgress({ flags: { "kg-realms": { journey: { now }, localMap: { placeId: "p" } } } }), false, "a local-map link");
  assert.equal(onlyJourneyProgress({ flags: { "kg-realms": { journey: { now } }, "other-module": { x: 1 } } }), false, "another module");
  assert.equal(onlyJourneyProgress({ "flags.kg-realms.journey.now.hour": 3, "flags.kg-realms.journey.trip": null }), false, "dotted keys too");
});

test("no change, or only Foundry's bookkeeping, is not progress", () => {
  assert.equal(onlyJourneyProgress(null), false);
  assert.equal(onlyJourneyProgress({}), false);
  assert.equal(onlyJourneyProgress(stats), false);
});

test("open cards and the scene bar skip position-only scene updates", () => {
  const read = (f) => fs.readFileSync(new URL(`../scripts/${f}`, import.meta.url), "utf8");
  assert.match(read("main.mjs"), /hook === "updateScene" && onlyJourneyProgress\(changes\)\) return; cards\.refresh\(\)/);
  assert.match(read("local-maps.mjs"), /Hooks\.on\("updateScene", \(scene, changes\) => \{ if\(scene!==canvas\.scene\|\|onlyJourneyProgress\(changes\)\)return;/);
});
