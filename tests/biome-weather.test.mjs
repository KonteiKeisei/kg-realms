import { test } from "node:test";
import assert from "node:assert/strict";
import { installBiomeClimates, setSceneClimate, followClimate } from "../scripts/biome-weather.mjs";
import { shippedClimates } from "../scripts/biome-climate.mjs";

function install({ bundled = true, zones = {}, saved = true, weather = {} } = {}) {
  const calls = [], settings = new Map([["biomeClimatesAdded", {}], ["autoGenerateWeather", true]]), gm = {}, notes = { info: [], error: [] };
  const data = { metadata: { id: "harptos" }, seasons: { values: { a: { name: "CALENDARIA.Season.Spring" }, b: { name: "CALENDARIA.Season.Summer" }, c: { name: "CALENDARIA.Season.Autumn" }, d: { name: "CALENDARIA.Season.Winter" } } }, weather: { activeZone: "temperate", zones } };
  let n = 0;
  globalThis.foundry = { utils: { deepClone: (v) => structuredClone(v), randomID: () => `r${++n}` } };
  globalThis.game = { user: gm, users: { activeGM: gm }, modules: { get: () => ({ active: true }) }, i18n: { localize: (s) => s.split(".").pop() }, settings: { get: (m, k) => settings.get(k), set: async (m, k, v) => settings.set(k, v) } };
  globalThis.ui = { notifications: { info: (m) => notes.info.push(m), error: (m) => notes.error.push(m) } };
  const list = () => Object.values(data.weather.zones);
  globalThis.CALENDARIA = {
    api: { isBundledCalendar: () => bundled },
    managers: {
      CalendarManager: { getActiveCalendar: () => ({ metadata: data.metadata, toObject: () => structuredClone(data) }),
        saveDefaultOverride: async (id, d) => { calls.push(["override", id]); if (saved) data.weather = d.weather; return saved ? {} : null; },
        updateCustomCalendar: async (id, d) => { calls.push(["update", id]); data.weather = d.weather; return {}; } },
      WeatherManager: { getCalendarZones: list, getCurrentWeather: (id) => weather[id] ?? null, generateAndSetWeather: async (o) => { calls.push(["roll", o.zoneId]); weather[o.zoneId] = { id: "snow" }; } }
    }
  };
  return { calls, settings, notes, data, weather };
}
const COUNT = Object.keys(shippedClimates()).length;
const scene = (flags = {}) => { const s = { flags: { calendaria: {}, "kg-realms": {}, ...flags }, getFlag(m, k) { return s.flags[m]?.[k]; }, updates: [], async update(u) { s.updates.push(u); for (const [k, v] of Object.entries(u)) { const [, m, f] = k.split("."); s.flags[m][f] = v; } } }; return s; };

test("the biome climates join the calendar once, with its seasons", async () => {
  const { calls, data, settings, notes } = install();
  await installBiomeClimates();
  assert.deepEqual(calls, [["override", "harptos"]], "one save, however many zones");
  const zones = Object.values(data.weather.zones);
  assert.equal(zones.length, COUNT);
  const arctic = zones.find((z) => z.id === "kgr-arctic");
  for (const key of ["CALENDARIA.Season.Winter", "Winter"]) assert.ok(arctic.seasonOverrides[key], key);
  assert.equal(data.weather.activeZone, "temperate", "the GM's active zone stays");
  assert.ok(notes.info[0].includes(String(COUNT)));
  calls.length = 0;
  await installBiomeClimates();
  assert.deepEqual(calls, []);
  assert.equal(settings.get("biomeClimatesAdded").harptos.length, COUNT);
});

test("a climate the GM edited or deleted is left that way; a custom calendar saves as one", async () => {
  const { data, calls, settings } = install({ bundled: false, zones: { mine: { id: "kgr-arctic", name: "Mine" } } });
  await installBiomeClimates();
  assert.deepEqual(calls, [["update", "harptos"]]);
  assert.equal(Object.values(data.weather.zones).find((z) => z.id === "kgr-arctic").name, "Mine", "its edit stands");
  assert.equal(Object.values(data.weather.zones).filter((z) => z.id === "kgr-arctic").length, 1);
  for (const k of Object.keys(data.weather.zones)) if (data.weather.zones[k].id === "kgr-forest") delete data.weather.zones[k];
  calls.length = 0;
  await installBiomeClimates();
  assert.deepEqual(calls, [], "a deleted one does not come back");
  assert.ok(settings.get("biomeClimatesAdded").harptos.includes("kgr-forest"));
});

test("if Calendaria will not save them it says so, and tries again", async () => {
  const { notes, settings } = install({ saved: false });
  await installBiomeClimates();
  assert.ok(notes.error.some((m) => m.includes("try again")));
  assert.deepEqual(settings.get("biomeClimatesAdded"), {});
});

test("a party entering an arctic biome: the scene takes arctic weather, rolled if the day's is not", async () => {
  const { calls } = install({ zones: { a: { id: "kgr-arctic" }, s: { id: "kgr-sea" }, f: { id: "kgr-forest" } } });
  const s = scene();
  await setSceneClimate(s, { type: "arctic", climate: "kgr-arctic" });
  assert.deepEqual(calls, [["roll", "kgr-arctic"]]);
  assert.deepEqual(s.updates, [{ "flags.calendaria.climateZoneOverride": "kgr-arctic", "flags.kg-realms.climateSet": "kgr-arctic" }]);
  await setSceneClimate(s, { type: "arctic", climate: "kgr-arctic" });
  assert.equal(s.updates.length, 1, "no write while it stays");
  await setSceneClimate(s, null);
  assert.equal(s.flags.calendaria.climateZoneOverride, "kgr-sea");
});

test("auto weather off: the zone follows but nothing is rolled; only the first GM writes; no Calendaria, nothing", async () => {
  const a = install({ zones: { a: { id: "kgr-arctic" } } });
  a.settings.set("autoGenerateWeather", false);
  const s = scene();
  await setSceneClimate(s, { type: "arctic" });
  assert.deepEqual(a.calls, []); assert.equal(s.flags.calendaria.climateZoneOverride, "kgr-arctic");
  install({ zones: { a: { id: "kgr-arctic" } } });
  game.users.activeGM = {};
  const other = scene();
  await setSceneClimate(other, { type: "arctic" });
  assert.deepEqual(other.updates, []);
  install({ zones: { a: { id: "kgr-arctic" } } });
  game.modules.get = () => undefined;
  const third = scene();
  await setSceneClimate(third, { type: "arctic" });
  assert.deepEqual(third.updates, []);
  await installBiomeClimates();
});

test("every client's view follows, on the scene it is looking at", () => {
  install({ weather: { "kgr-arctic": { id: "snow" } } });
  const heard = [];
  globalThis.Hooks = { callAll: (...a) => heard.push(a) };
  const s = {};
  globalThis.canvas = { scene: s };
  followClimate(s, { flags: { calendaria: { climateZoneOverride: "kgr-arctic" } } });
  assert.equal(heard[0][0], "calendaria.weatherChange"); assert.deepEqual(heard[0][1].current, { id: "snow" }); assert.equal(heard[0][1].zoneId, "kgr-arctic");
  followClimate({}, { flags: { calendaria: { climateZoneOverride: "kgr-arctic" } } });
  followClimate(s, { name: "x" });
  assert.equal(heard.length, 1);
});
