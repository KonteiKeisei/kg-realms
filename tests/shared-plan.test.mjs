// 0.96.3: the GM's client works out the route once and saves it with the journey; players draw it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TravelHud } from "../scripts/ui-hud.mjs";
import { freezeBiomeTravel } from "../scripts/biomes.mjs";
import { sourceToLonLat } from "../scripts/source-map.mjs";
import { gmGame, testScene } from "./helpers/journey.mjs";

function setup() {
  gmGame(); globalThis.foundry = { utils: { escapeHTML: String, deepClone: structuredClone } };
  const a = sourceToLonLat(1000, 1000), b = sourceToLonLat(2200, 1000), config = { types: { plains: { offroad: .6 } } };
  const state = { start: { lon: a[0], lat: a[1], name: "Start" }, waypoints: [{ lon: b[0], lat: b[1], name: "End" }], trip: { departed: 0, decisions: [], resumed: {}, halts: [], biomeTravel: freezeBiomeTravel(config) } };
  const scene = testScene(state), actor = { name: "Hero", type: "character", items: [], system: { attributes: { movement: { walk: 30 } } } };
  let routeLoads = 0;
  const create = () => {
    const hud = new TravelHud({ headless: true, getScene: () => scene, getRoutes: () => { routeLoads++; return { features: [] }; }, getTerrain: async () => null, getBiomes: () => config, getPlaces: () => [], getEncounters: () => [], getWaterways: () => ({}) });
    hud.members = () => [actor]; hud.stops = () => [state.start, ...state.waypoints]; hud.tick = async () => {};
    return hud;
  };
  return { state, scene, create, loads: () => routeLoads };
}
const asPlayer = () => { const gm = game.user; game.user = { id: "player", isGM: false, active: true }; game.users.push(game.user); return gm; };

test("the GM's client saves the finished route once; a second refresh sends nothing", async () => {
  const x = setup(), gm = x.create();
  await gm.refresh();
  assert.ok(x.state.sharedPlan?.json, "the plan is saved with the journey");
  const writes = x.scene.writes.length;
  await gm.refresh();
  assert.equal(x.scene.writes.length, writes);
});

test("a player draws the GM's route without working out roads", async () => {
  const x = setup(), gm = x.create();
  await gm.refresh();
  const hours = gm.result.hours, loads = x.loads();
  asPlayer();
  const player = x.create();
  await player.refresh();
  assert.equal(player.result.hours, hours);
  assert.equal(x.loads(), loads, "no road graph built on the player's side");
});

test("a changed route waits for the GM's new plan; with no GM online the player works it out", async () => {
  const x = setup(), gm = x.create();
  await gm.refresh();
  const gmUser = asPlayer();
  x.state.waypoints = [{ ...x.state.waypoints[0], lon: x.state.waypoints[0].lon + 0.5 }];
  const player = x.create();
  await player.refresh();
  assert.equal(player.result, null, "waits for the GM");
  gmUser.active = false;
  await player.refresh();
  assert.ok(player.result, "no GM online: worked out here");
});
