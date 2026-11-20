// The way back to the realm map from an encounter's or a camp's scene is the top bar's (LocalMaps
// parentOf), not buttons in the encounter box or the camp view; a practice night can go to its watch
// scene and keep running there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.foundry ??= { utils: { escapeHTML: (s) => String(s), randomID: () => "id" } };
const { LocalMaps } = await import("../scripts/local-maps.mjs");
const { PracticeTab } = await import("../scripts/ui-practice.mjs");
const { CampPanel } = await import("../scripts/ui-camp.mjs");

const scene = (id) => ({ id, name: id, getFlag: () => null, flags: {} });

test("an encounter's or camp's scene goes back to the realm map in the top bar", () => {
  const realm = scene("realm"), fight = scene("fight");
  globalThis.game = { scenes: { get: () => null } };
  const maps = new LocalMaps({ encounterParent: (s) => (s === fight ? { to: realm, place: "Overturned Transport", focus: null } : null) });
  assert.equal(maps.parentOf(fight).to, realm);
  assert.deepEqual(maps.trail(fight).map((x) => x.label), ["realm", "fight"]);
  assert.equal(maps.parentOf(scene("elsewhere")), null);
});

test("the encounter box has no navigation of its own: Conclude stays, the map buttons go", () => {
  const box = readFileSync(new URL("../scripts/ui-encounter-box.mjs", import.meta.url), "utf8");
  assert.ok(box.includes('data-act="carry-on"'));
  assert.ok(!box.includes('data-act="map-all"') && !box.includes('data-act="map"'));
  const camp = readFileSync(new URL("../scripts/ui-camp.mjs", import.meta.url), "utf8");
  assert.ok(!camp.includes("realm-go") && !camp.includes("#realmNav"), "the camp view's realm buttons are the top bar's now");
});

test("closing the Practice tab ends the practice, unless it went to its watch scene", () => {
  let ended = 0;
  const camp = { endPractice: () => ended++, keepPractice: false };
  const tab = new PracticeTab({ camp });
  tab.active = true; tab.close();
  assert.equal(ended, 1);
  camp.keepPractice = true; tab.active = true; tab.close();
  assert.equal(ended, 1, "kept, going to its watch scene");
  assert.equal(camp.keepPractice, false, "only that once");
});

test("a watch's scene: its own, else the night's; a practice reads its own copy", () => {
  const scenes = { s1: scene("s1"), s2: scene("s2") };
  globalThis.game = { scenes: { get: (id) => scenes[id] ?? null } };
  const camp = new CampPanel({ state: { watch: { scenes: { 0: "s1", all: "s2" } } } });
  assert.equal(camp.watchScene(0)?.id, "s1");
  assert.equal(camp.watchScene(2)?.id, "s2");
  assert.equal(camp.watchScene(null), null);
  camp.practice = { state: { watch: { scenes: { 1: "s2" } } } };
  assert.equal(camp.watchScene(1)?.id, "s2");
  assert.equal(camp.watchScene(0), null);
});
