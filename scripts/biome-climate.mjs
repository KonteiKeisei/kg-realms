// Biomes and Calendaria's weather (0.83). Each biome preset has a climate: which weather can happen
// there, how often in each season, how warm and how windy. They are added to the game world's calendar
// as Calendaria climate zones, where the GM can edit them, and the party's biome chooses the zone, so a
// party that walks into the arctic gets arctic weather. Calendaria still does the rolling.
//
// Temperatures are degrees Celsius, as Calendaria stores them. Weights are relative within a season.

export const SEA_CLIMATE = "kgr-sea";
/** Calendaria's untouched zone id for a biome preset. */
export const climateIdFor = (biomeType) => `kgr-${biomeType}`;

const c = (name, description, wind, t, w) => ({ name, description, wind, t, w });
/** spring, summer, autumn, winter: [coldest, warmest]; then the weather weights for each. */
export const BIOME_CLIMATES = {
  plains: c("Plains", "Open temperate land: big skies, wind and summer storms.", [1, 4],
    { spring: [4, 17], summer: [17, 32], autumn: [4, 18], winter: [-10, 4] }, {
      spring: { "partly-cloudy": 5, clear: 4, cloudy: 3, rain: 3, drizzle: 2, windy: 3, thunderstorm: 1 },
      summer: { clear: 7, "partly-cloudy": 5, windy: 2, thunderstorm: 3, "heat-wave": 1, hail: 1, tornado: 0.3 },
      autumn: { "partly-cloudy": 4, clear: 4, cloudy: 3, overcast: 2, rain: 2, windy: 3, fog: 1 },
      winter: { overcast: 4, cloudy: 3, clear: 3, snow: 4, windy: 3, sleet: 1, blizzard: 1 } }),
  forest: c("Forest", "Sheltered temperate woodland: mild, damp and often misty.", [0, 2],
    { spring: [4, 16], summer: [14, 27], autumn: [4, 16], winter: [-6, 4] }, {
      spring: { "partly-cloudy": 4, cloudy: 4, rain: 4, drizzle: 4, mist: 3, clear: 3, sunshower: 1 },
      summer: { "partly-cloudy": 5, clear: 5, cloudy: 3, rain: 2, thunderstorm: 2, mist: 1, sunshower: 1 },
      autumn: { cloudy: 4, overcast: 3, rain: 4, drizzle: 3, fog: 3, mist: 3, "autumn-leaves": 3, clear: 2 },
      winter: { overcast: 4, cloudy: 3, snow: 4, fog: 3, sleet: 1, clear: 2 } }),
  desert: c("Desert", "Scorching days, cold nights and almost no rain.", [1, 4],
    { spring: [12, 34], summer: [22, 46], autumn: [10, 34], winter: [0, 22] }, {
      spring: { clear: 9, "partly-cloudy": 2, windy: 3, "dust-devil": 2, sandstorm: 2 },
      summer: { clear: 9, "heat-wave": 4, windy: 2, "dust-devil": 3, sandstorm: 3 },
      autumn: { clear: 9, "partly-cloudy": 2, windy: 3, "dust-devil": 2, sandstorm: 2, rain: 0.3 },
      winter: { clear: 8, "partly-cloudy": 3, windy: 3, sandstorm: 1, rain: 0.5, cloudy: 1 } }),
  tundra: c("Tundra", "Treeless cold ground: a short bright summer and a long hard winter.", [2, 5],
    { spring: [-14, 2], summer: [1, 14], autumn: [-12, 2], winter: [-38, -16] }, {
      spring: { snow: 4, overcast: 3, windy: 4, clear: 2, sleet: 2 },
      summer: { "partly-cloudy": 5, clear: 4, cloudy: 3, drizzle: 2, windy: 3, fog: 1 },
      autumn: { overcast: 4, snow: 4, sleet: 2, windy: 4, clear: 1 },
      winter: { snow: 5, blizzard: 4, windy: 4, overcast: 2, clear: 2, "ice-storm": 1 } }),
  taiga: c("Taiga", "Dark northern forest: heavy snow and brief warm summers.", [0, 3],
    { spring: [-8, 8], summer: [8, 24], autumn: [-6, 8], winter: [-32, -10] }, {
      spring: { snow: 3, overcast: 4, cloudy: 3, drizzle: 2, clear: 2, sleet: 2 },
      summer: { "partly-cloudy": 5, clear: 4, cloudy: 3, rain: 3, thunderstorm: 1, mist: 1, "wildfire-smoke": 0.5 },
      autumn: { overcast: 4, cloudy: 3, rain: 2, snow: 3, fog: 2, sleet: 2 },
      winter: { snow: 7, overcast: 3, blizzard: 2, clear: 2, "ice-storm": 1 } }),
  hills: c("Hills", "Rolling high ground: changeable, breezy and quick to cloud over.", [1, 4],
    { spring: [2, 14], summer: [13, 26], autumn: [2, 14], winter: [-9, 3] }, {
      spring: { "partly-cloudy": 4, cloudy: 4, windy: 4, rain: 3, drizzle: 2, mist: 2, clear: 2 },
      summer: { "partly-cloudy": 5, clear: 5, windy: 3, cloudy: 2, thunderstorm: 2, rain: 1 },
      autumn: { cloudy: 4, windy: 4, overcast: 3, rain: 3, fog: 3, clear: 2 },
      winter: { snow: 4, overcast: 4, windy: 4, sleet: 2, fog: 2, clear: 2 } }),
  wetlands: c("Wetlands", "Marsh and fen: damp, still and thick with fog.", [0, 2],
    { spring: [6, 18], summer: [16, 30], autumn: [6, 18], winter: [-3, 8] }, {
      spring: { drizzle: 4, rain: 4, mist: 5, fog: 4, cloudy: 4, "partly-cloudy": 2, clear: 1 },
      summer: { "partly-cloudy": 4, mist: 3, thunderstorm: 3, rain: 3, clear: 3, cloudy: 2, sunshower: 1 },
      autumn: { fog: 6, "rolling-fog": 2, mist: 4, drizzle: 4, rain: 3, overcast: 3 },
      winter: { fog: 5, overcast: 4, drizzle: 3, sleet: 2, snow: 2, mist: 2 } }),
  mountains: c("Mountains", "High peaks: thin air, fierce wind and snow at any time of year.", [2, 5],
    { spring: [-10, 6], summer: [0, 16], autumn: [-10, 6], winter: [-28, -8] }, {
      spring: { snow: 5, windy: 4, overcast: 3, clear: 3, sleet: 2, blizzard: 1 },
      summer: { clear: 5, "partly-cloudy": 4, windy: 4, thunderstorm: 3, hail: 2, snow: 1, mist: 1 },
      autumn: { snow: 4, windy: 4, overcast: 3, clear: 3, sleet: 2, fog: 2 },
      winter: { snow: 6, blizzard: 4, windy: 4, clear: 2, "ice-storm": 1 } }),
  glacier: c("Glacier", "Moving ice: bitter cold, glare and whiteouts.", [2, 5],
    { spring: [-24, -8], summer: [-12, 2], autumn: [-26, -10], winter: [-48, -24] }, {
      spring: { snow: 5, windy: 4, blizzard: 3, clear: 3, overcast: 2 },
      summer: { clear: 5, snow: 3, windy: 4, overcast: 2, fog: 1 },
      autumn: { snow: 5, blizzard: 4, windy: 4, overcast: 2, clear: 2 },
      winter: { blizzard: 7, snow: 5, windy: 4, "ice-storm": 2, "permafrost-surge": 1, clear: 1 } }),
  arctic: c("Arctic", "The far frozen north or south: blizzards most of the year.", [2, 5],
    { spring: [-22, -4], summer: [-6, 8], autumn: [-24, -6], winter: [-46, -22] }, {
      spring: { snow: 5, overcast: 3, windy: 4, clear: 2, blizzard: 3 },
      summer: { clear: 4, "partly-cloudy": 3, snow: 3, overcast: 2, windy: 3, fog: 1, blizzard: 1 },
      autumn: { snow: 5, blizzard: 4, overcast: 3, windy: 4, clear: 1 },
      winter: { blizzard: 7, snow: 5, windy: 4, "ice-storm": 2, overcast: 2, clear: 1 } }),
  jungle: c("Jungle", "Hot, dripping rainforest: a downpour most afternoons.", [0, 2],
    { spring: [22, 33], summer: [24, 36], autumn: [22, 33], winter: [20, 31] }, {
      spring: { rain: 5, thunderstorm: 4, "partly-cloudy": 3, sunshower: 3, mist: 3, cloudy: 2 },
      summer: { monsoon: 4, rain: 5, thunderstorm: 5, sunshower: 3, mist: 2, cloudy: 2 },
      autumn: { rain: 5, thunderstorm: 4, "partly-cloudy": 3, sunshower: 3, mist: 3, cloudy: 2 },
      winter: { "partly-cloudy": 5, rain: 3, sunshower: 3, clear: 3, mist: 3, thunderstorm: 2 } }),
  swamp: c("Swamp", "Warm standing water: muggy air, biting fog and sudden storms.", [0, 2],
    { spring: [14, 26], summer: [24, 36], autumn: [14, 27], winter: [4, 16] }, {
      spring: { mist: 5, fog: 4, rain: 4, drizzle: 3, "partly-cloudy": 3, sunshower: 1 },
      summer: { thunderstorm: 4, rain: 3, mist: 4, "partly-cloudy": 4, "heat-wave": 1, "spore-cloud": 0.3 },
      autumn: { fog: 5, "rolling-fog": 2, mist: 4, rain: 3, overcast: 3, drizzle: 2 },
      winter: { fog: 5, overcast: 4, drizzle: 4, mist: 3, clear: 1 } }),
  savanna: c("Savanna", "Tropical grassland: a long dry season, then the rains.", [1, 3],
    { spring: [20, 34], summer: [22, 36], autumn: [20, 33], winter: [16, 30] }, {
      spring: { "partly-cloudy": 5, clear: 4, thunderstorm: 3, rain: 3, windy: 2 },
      summer: { thunderstorm: 5, rain: 5, monsoon: 2, "partly-cloudy": 3, sunshower: 2, clear: 2 },
      autumn: { "partly-cloudy": 5, clear: 5, rain: 2, windy: 2, thunderstorm: 1 },
      winter: { clear: 9, "partly-cloudy": 3, windy: 3, "dust-devil": 2, "wildfire-smoke": 1 } }),
  steppe: c("Steppe", "Dry grass under a huge sky: hot summers, savage winters, always wind.", [2, 5],
    { spring: [2, 18], summer: [18, 36], autumn: [0, 18], winter: [-24, -4] }, {
      spring: { windy: 5, "partly-cloudy": 4, clear: 4, rain: 2, thunderstorm: 1 },
      summer: { clear: 7, windy: 4, "partly-cloudy": 3, thunderstorm: 2, "dust-devil": 2, "heat-wave": 1 },
      autumn: { windy: 5, clear: 4, "partly-cloudy": 4, overcast: 2, rain: 1 },
      winter: { windy: 5, snow: 4, clear: 3, blizzard: 3, overcast: 2 } }),
  badlands: c("Badlands", "Bare, broken rock: dry heat, dust and rare violent storms.", [1, 4],
    { spring: [8, 26], summer: [20, 40], autumn: [6, 26], winter: [-6, 12] }, {
      spring: { clear: 7, "partly-cloudy": 3, windy: 4, "dust-devil": 2, thunderstorm: 1 },
      summer: { clear: 8, "heat-wave": 3, "dust-devil": 3, windy: 3, thunderstorm: 2, sandstorm: 1 },
      autumn: { clear: 7, "partly-cloudy": 3, windy: 4, "dust-devil": 2 },
      winter: { clear: 6, overcast: 3, windy: 4, snow: 1, cloudy: 2 } }),
  coast: c("Coast", "Where land meets sea: sea fog, rain and onshore wind.", [1, 4],
    { spring: [6, 16], summer: [15, 26], autumn: [8, 18], winter: [0, 9] }, {
      spring: { "partly-cloudy": 4, windy: 4, cloudy: 3, rain: 3, drizzle: 3, fog: 3, clear: 3 },
      summer: { clear: 6, "partly-cloudy": 5, windy: 3, fog: 2, rain: 1, thunderstorm: 1 },
      autumn: { windy: 5, rain: 4, overcast: 3, fog: 3, cloudy: 3, thunderstorm: 1 },
      winter: { overcast: 4, rain: 4, windy: 5, fog: 2, sleet: 2, snow: 1 } }),
  volcanic: c("Volcanic", "Living fire under the ground: ash on the wind and hot, acrid air.", [1, 3],
    { spring: [14, 30], summer: [20, 38], autumn: [14, 30], winter: [8, 24] }, {
      spring: { ashfall: 5, overcast: 3, "partly-cloudy": 3, clear: 2, thunderstorm: 2, "acid-rain": 1 },
      summer: { ashfall: 5, "heat-wave": 3, clear: 3, "partly-cloudy": 2, thunderstorm: 2, "wildfire-smoke": 2 },
      autumn: { ashfall: 5, overcast: 3, "partly-cloudy": 3, clear: 2, thunderstorm: 2, "acid-rain": 1 },
      winter: { ashfall: 5, overcast: 4, clear: 2, rain: 2, "acid-rain": 1 } })
};
/** Open water, where no biome reaches: a party at sea. */
const SEA = c("Open Sea", "Out of sight of land: wind, swell, and storms with nothing to stop them.", [2, 5],
  { spring: [6, 16], summer: [14, 26], autumn: [8, 18], winter: [0, 10] }, {
    spring: { windy: 5, "partly-cloudy": 4, cloudy: 3, rain: 3, fog: 2, clear: 3 },
    summer: { clear: 6, "partly-cloudy": 5, windy: 4, thunderstorm: 2, fog: 1, hurricane: 0.5 },
    autumn: { windy: 6, rain: 4, overcast: 3, thunderstorm: 3, fog: 2, hurricane: 1 },
    winter: { windy: 6, overcast: 4, rain: 4, thunderstorm: 2, sleet: 2, snow: 1 } });

/** Which of the four a calendar's season is: by its name, else by its place in a year of four, else null. */
export function seasonKind(name, index = -1, count = 0) {
  const n = String(name ?? "").toLowerCase();
  if (/spring|vernal|thaw/.test(n)) return "spring";
  if (/summer|estival/.test(n)) return "summer";
  if (/autumn|fall|harvest/.test(n)) return "autumn";
  if (/winter|hibern/.test(n)) return "winter";
  return count === 4 && index >= 0 ? ["spring", "summer", "autumn", "winter"][index] : null;
}

const SEASONS = ["spring", "summer", "autumn", "winter"];
/** Weights as the percent chances Calendaria shows, summing to about 100. */
const chances = (weights) => {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(weights).map(([id, w]) => [id, { id, chance: Math.round((w / total) * 1000) / 10, enabled: true }]));
};

/**
 * A climate as a Calendaria zone, for this calendar's seasons. seasons: { key, kind }, one for each
 * name Calendaria may look a season up by. Only the weather listed is enabled, which is what limits
 * what the zone can roll. Its day length stays the calendar's.
 */
export function climateZone(id, climate, seasons, key = (s) => s) {
  const year = SEASONS.map((s) => climate.t[s]);
  const avg = (i) => Math.round(year.reduce((sum, r) => sum + r[i], 0) / year.length);
  const temperatures = { _default: { min: avg(0), max: avg(1) } }, seasonOverrides = {};
  for (const { key: name, kind } of seasons) {
    if (!kind) continue;
    const [min, max] = climate.t[kind];
    temperatures[name] = { min, max };
    seasonOverrides[name] = { temperatures: { min, max }, presets: chances(climate.w[kind]) };
  }
  const used = [...new Set(SEASONS.flatMap((s) => Object.keys(climate.w[s])))];
  return {
    id, name: `Biome: ${climate.name}`, description: climate.description, brightnessMultiplier: 1,
    environmentBase: null, environmentDark: null, windSpeedRange: { min: climate.wind[0], max: climate.wind[1] }, windDirections: {},
    shortestDay: null, longestDay: null, colorShift: null, temperatures,
    presets: Object.fromEntries(used.map((p) => [key(p), { id: p, enabled: true, tempMin: null, tempMax: null }])), seasonOverrides
  };
}

/** Every climate this engine ships, by zone id. */
export const shippedClimates = () => ({ ...Object.fromEntries(Object.entries(BIOME_CLIMATES).map(([k, v]) => [climateIdFor(k), v])), [SEA_CLIMATE]: SEA });

/** The zone a spot on the map should use: its biome's chosen climate, or the sea's where no biome reaches. */
export const climateOf = (biome) => (biome ? biome.climate ?? climateIdFor(biome.type) : SEA_CLIMATE);
/**
 * Whether to change a realm scene's zone. The GM's own choice in Calendaria's scene settings stands:
 * "none" (no weather here), or any zone we did not set ourselves.
 */
export function zoneChange({ current, lastSet, want, zones }) {
  if (!want || !zones.includes(want) || current === want) return null;
  if (current === "none" || (current && current !== lastSet)) return null;
  return want;
}
