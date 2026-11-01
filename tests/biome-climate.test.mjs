import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BIOME_CLIMATES, SEA_CLIMATE, climateIdFor, climateZone, seasonKind, shippedClimates, climateOf, zoneChange } from "../scripts/biome-climate.mjs";
import { DEFAULT_BIOMES, biomeTypes, biomeZone, biomeLookup } from "../scripts/biomes.mjs";
import { TERRAIN } from "../scripts/travel.mjs";

// Calendaria's own weather ids (its weather-presets.mjs, 1.0.17).
const CALENDARIA_WEATHER = "clear partly-cloudy cloudy overcast drizzle rain fog mist windy sunshower snow sleet heat-wave thunderstorm blizzard hail tornado hurricane ice-storm monsoon ashfall sandstorm luminous-sky sakura-bloom autumn-leaves rolling-fog wildfire-smoke dust-devil black-sun ley-surge aether-haze nullfront permafrost-surge gravewind veilfall arcane-winds acid-rain blood-rain meteor-shower spore-cloud divine-light plague-miasma".split(" ");
const FOUR = ["Spring", "Summer", "Autumn", "Winter"].map((key) => ({ key, kind: key.toLowerCase() }));

test("every biome preset has a climate, and every one is sound", () => {
  assert.deepEqual(Object.keys(BIOME_CLIMATES).sort(), Object.keys(DEFAULT_BIOMES).sort());
  for (const [id, c] of Object.entries(shippedClimates())) {
    assert.ok(c.wind[0] <= c.wind[1] && c.wind[0] >= 0 && c.wind[1] <= 5, id);
    for (const s of ["spring", "summer", "autumn", "winter"]) {
      assert.ok(c.t[s][0] < c.t[s][1], `${id} ${s} range`);
      assert.ok(Object.keys(c.w[s]).length >= 4, `${id} ${s} has choices`);
      for (const [w, n] of Object.entries(c.w[s])) { assert.ok(CALENDARIA_WEATHER.includes(w), `${id}: ${w}`); assert.ok(n > 0); }
    }
    assert.ok(c.t.summer[1] > c.t.winter[1], `${id}: summer warmer than winter`);
  }
});

test("the weather fits the place: no blizzards in the desert, no heat waves on ice", () => {
  const can = (id, w) => ["spring", "summer", "autumn", "winter"].some((s) => BIOME_CLIMATES[id].w[s][w]);
  assert.ok(can("arctic", "blizzard") && !can("arctic", "heat-wave") && !can("arctic", "rain"));
  assert.ok(can("desert", "sandstorm") && !can("desert", "snow") && !can("desert", "blizzard"));
  assert.ok(can("jungle", "monsoon") && !can("jungle", "snow"));
  assert.ok(can("volcanic", "ashfall"));
  assert.ok(BIOME_CLIMATES.arctic.t.winter[1] < 0);
  assert.ok(BIOME_CLIMATES.desert.t.summer[1] > 40);
});

test("a climate becomes a zone Calendaria can roll from, limited to its own weather", () => {
  let n = 0;
  const zone = climateZone("kgr-arctic", BIOME_CLIMATES.arctic, FOUR, () => `k${++n}`);
  assert.equal(zone.id, "kgr-arctic"); assert.equal(zone.name, "Biome: Arctic");
  assert.deepEqual(zone.seasonOverrides.Winter.temperatures, { min: -46, max: -22 });
  assert.deepEqual(zone.temperatures.Summer, { min: -6, max: 8 });
  const enabled = Object.values(zone.presets).filter((p) => p.enabled).map((p) => p.id);
  assert.ok(enabled.includes("blizzard")); assert.ok(!enabled.includes("rain"), "what it may not roll is not listed");
  for (const s of FOUR) {
    const total = Object.values(zone.seasonOverrides[s.key].presets).reduce((sum, p) => sum + p.chance, 0);
    assert.ok(Math.abs(total - 100) < 1.5, `${s.key} totals ${total}`);
    for (const p of Object.values(zone.seasonOverrides[s.key].presets)) assert.ok(enabled.includes(p.id));
  }
  assert.equal(zone.shortestDay, null, "the calendar keeps its day length");
});

test("seasons are matched by name, or by place in a year of four; a strange one uses the zone's defaults", () => {
  assert.equal(seasonKind("CALENDARIA.Season.Spring"), "spring");
  assert.equal(seasonKind("Fall"), "autumn"); assert.equal(seasonKind("Deep Winter"), "winter");
  assert.equal(seasonKind("Sun's Height", 1, 4), "summer");
  assert.equal(seasonKind("The Long Dark", 1, 3), null);
  const zone = climateZone("x", BIOME_CLIMATES.plains, [{ key: "The Long Dark", kind: null }], (s) => s);
  assert.deepEqual(zone.seasonOverrides, {}); assert.ok(zone.temperatures._default.min < zone.temperatures._default.max);
});

test("each biome takes its own climate by default; both a type and one zone can choose another", () => {
  const types = biomeTypes({});
  for (const id of Object.keys(DEFAULT_BIOMES)) assert.equal(types[id].climate, climateIdFor(id));
  assert.equal(biomeTypes({ types: { forest: { climate: "temperate" } } }).forest.climate, "temperate");
  assert.equal(biomeTypes({ types: { mine: { name: "Mine" } } }).mine.climate, "kgr-plains");
  assert.equal(biomeZone({ type: "forest", climate: "tropical" }, types).climate, "tropical");
  assert.equal(biomeZone({ type: "forest" }, types).climate, "kgr-forest");
});

test("a party entering an arctic biome asks for arctic weather; at sea, the sea's", () => {
  const pts = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const at = biomeLookup({ zones: { z: { type: "arctic", pts } } }, () => TERRAIN[1]);
  assert.equal(climateOf(at(5, 5)), "kgr-arctic");
  assert.equal(climateOf(at(50, 50)), "kgr-plains");
  assert.equal(climateOf(biomeLookup({}, () => TERRAIN[8])(1, 1)), SEA_CLIMATE);
});

test("the zone changes with the party, but a GM's own choice stands", () => {
  const zones = ["kgr-arctic", "kgr-forest", "temperate"];
  assert.equal(zoneChange({ current: null, lastSet: null, want: "kgr-arctic", zones }), "kgr-arctic");
  assert.equal(zoneChange({ current: "kgr-forest", lastSet: "kgr-forest", want: "kgr-arctic", zones }), "kgr-arctic");
  assert.equal(zoneChange({ current: "kgr-arctic", lastSet: "kgr-arctic", want: "kgr-arctic", zones }), null, "no change, no write");
  assert.equal(zoneChange({ current: "temperate", lastSet: "kgr-forest", want: "kgr-arctic", zones }), null, "the GM set this one");
  assert.equal(zoneChange({ current: "none", lastSet: null, want: "kgr-arctic", zones }), null, "the GM turned weather off here");
  assert.equal(zoneChange({ current: null, lastSet: null, want: "kgr-gone", zones }), null, "a deleted zone is not asked for");
});

test("the Biomes tab offers the climate for a type and for one zone", () => {
  const src = readFileSync(new URL("../scripts/ui-biomes.mjs", import.meta.url), "utf8");
  assert.ok(src.includes('climateRow("type",t.climate)')); assert.ok(src.includes('climateRow("zone",z.climate??""'));
});
