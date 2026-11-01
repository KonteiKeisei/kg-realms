import "./helpers/worlds.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {LocalMaps} from "../scripts/local-maps.mjs";

function seasonalScene(src = null) {
  return {id: "luskan", background: {src}, width: 8192, height: 6620,
    flags: {"kg-realms": {localMap: {world: "toril", placeId: "cbe600f2-1f0f-4599-8c6f-436645c9bcac",
      seasons: {summer: "modules/kg-realms-faerun/assets/maps/luskan-summer.webp", winter: "modules/kg-realms-faerun/assets/maps/luskan-winter.webp"}}}},
    getFlag(scope, key) {return this.flags[scope]?.[key];}};
}

test("calendar and snowy-weather selections are shared with player-side rendering", async () => {
  const scene = seasonalScene();
  let winter = true, snow = false;
  globalThis.game = {user: {isGM: false}};
  globalThis.CALENDARIA = {managers: {WeatherManager: {getCurrentWeather: () => ({id: snow ? "snow" : "clear"})}}};
  const maps = new LocalMaps({enabled: () => true, isWinter: async () => winter});
  assert.ok((await maps.seasonSource(scene)).endsWith("winter.webp"));
  winter = false;
  assert.ok((await maps.seasonSource(scene)).endsWith("summer.webp"));
  snow = true;
  assert.ok((await maps.seasonSource(scene)).endsWith("winter.webp"));
  assert.equal(scene.background.src, null);
  delete globalThis.CALENDARIA; delete globalThis.game;
});

test("season changes never repopulate bundled Scene Background fields", async () => {
  const scene = seasonalScene(), updates = [];
  scene.update = async update => updates.push(update);
  const gm = {id: "gm", isGM: true, active: true};
  globalThis.game = {user: gm, users: [gm], scenes: [scene], settings: {get: () => ""}};
  const maps = new LocalMaps({enabled: () => true, isWinter: async () => true});
  await maps.applySeasons();
  assert.deepEqual(updates, []);
  assert.equal(scene.background.src, null);
  delete globalThis.game;
});

test("baseline background retirement is idempotent and preserves custom images and coordinates", async () => {
  const baseline = seasonalScene("modules/kg-realms-faerun/assets/maps/luskan-summer.webp");
  const custom = {...seasonalScene("worlds/private/custom.webp"), id: "custom"};
  const updates = [];
  for (const scene of [baseline, custom]) scene.update = async change => {
    updates.push({id: scene.id, change}); scene.background.src = change["background.src"];
  };
  const gm = {id: "gm", isGM: true, active: true};
  globalThis.game = {user: gm, users: [gm], scenes: [baseline, custom], settings: {get: () => ""}};
  const maps = new LocalMaps({enabled: () => false, presetsDone: () => []});
  maps.presets = async () => [];
  await maps.applyPresets(); await maps.applyPresets();
  assert.deepEqual(updates, [{id: "luskan", change: {"background.src": null}}]);
  assert.equal(custom.background.src, "worlds/private/custom.webp");
  assert.equal(baseline.width, 8192); assert.equal(baseline.height, 6620);
  delete globalThis.game;
});

test("all new baseline scene presets leave the background image empty", () => {
  for (const name of ["luskan", "helms-hold", "neverwinter"]) {
    const preset = JSON.parse(readFileSync(new URL(`../data/worlds/toril/local/${name}.json`, import.meta.url), "utf8"));
    assert.equal(preset.scene.background.src, null);
  }
});

test("breadcrumb navigation activates by default, while the left-arrow action only views", async () => {
  const calls = [], scene = {id: "parent", view: async () => calls.push("view"), activate: async () => calls.push("activate")};
  globalThis.game = {user: {isGM: true}};
  const maps = new LocalMaps({}), step = {scene, focus: {scene: "parent", placeId: "luskan"}};
  await maps.navigateTrail(step);
  await maps.navigateTrail(step, {viewOnly: true});
  assert.deepEqual(calls, ["activate", "view"]);
  assert.deepEqual(maps.focus, step.focus);
  delete globalThis.game;
});

test("activating an already active scene brings only connected players who are elsewhere", async () => {
  const calls = [], players = [
    {id: "away", active: true, isGM: false, viewedScene: "parent"},
    {id: "here", active: true, isGM: false, viewedScene: "current"},
    {id: "offline", active: false, isGM: false, viewedScene: "parent"},
    {id: "other-gm", active: true, isGM: true, viewedScene: "parent"}
  ];
  const scene = {id: "current", active: true, activate: async () => calls.push("activate"), pullUsers: users => calls.push(users.map(u => u.id))};
  globalThis.game = {user: {isGM: true}, users: players};
  await new LocalMaps({}).navigateTrail({scene, focus: null});
  assert.deepEqual(calls, ["activate", ["away"]]);
  delete globalThis.game;
});
