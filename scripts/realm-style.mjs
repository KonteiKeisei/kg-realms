import {sourceMapStyle} from './source-map.mjs';
// MapLibre style for a fantasy world's tiles (the Toril GIS layers, as the Toril Explorer serves
// them). Two looks from one set of layers: day (a parchment atlas) and night (ink on dark).
// Zooms here are MapLibre's own, so labels thin out by how much of the world is on screen,
// whatever the scene's scale. Pure: no Foundry.

/* ---------------------------------------- */
/*  Palettes                                 */
/* ---------------------------------------- */

const SHARED = {
  /** Points of interest: glowing gold, as KG Cities' landmarks. */
  gold: "#f2c14e", goldLit: "#ffe08a", goldDark: "#5c3f0e", goldGlow: "#ffc94a",
  flash: "#fffbe8", flashGlow: "#ffd166"
};

export const PALETTES = {
  day: {
    ...SHARED,
    ocean: "#9fbfc2", oceanDeep: "#8cb0b6", seaIce: "#e6eef0",
    land: "#eadcb8", ice: "#f4f2ea",
    temperate: "#bcc58f", boreal: "#a9b68e", tropical: "#a3b878", swamp: "#b2b88f", sand: "#ead198", glacier: "#f6f5f0",
    rice: "#cfd39a", blackened: "#8c7f70",
    shadow: "#5b4630", highlight: "#fff8e4", accent: "#8a6a45",
    coast: "#5d4a35", lake: "#9fbfc2", river: "#6e95a6", road: "#8b5a3a", cliff: "#6d5640",
    regionLine: "#9b5a44", graticule: "#8a7a62",
    label: "#3b2a1a", halo: "#f3e9cf", regionLabel: "#8a3f2c", natureLabel: "#5e4a33", waterLabel: "#3f6878",
    city: "#3b2a1a", cityFill: "#f3e9cf", site: "#7a3e2e"
  },
  night: {
    ...SHARED,
    ocean: "#0f1a2a", oceanDeep: "#0b1422", seaIce: "#3e4b5c",
    land: "#1f2635", ice: "#4a5568",
    temperate: "#233a33", boreal: "#24363a", tropical: "#21402f", swamp: "#28372f", sand: "#3b3528", glacier: "#4f5b6d",
    rice: "#2c3a2c", blackened: "#14161c",
    shadow: "#05080e", highlight: "#7c8aa6", accent: "#0b0f18",
    coast: "#7f98b6", lake: "#16304a", river: "#3f6d8a", road: "#a07a4d", cliff: "#8a93a6",
    regionLine: "#c9a86a", graticule: "#3c4a62",
    label: "#ece6d4", halo: "#0d121c", regionLabel: "#d6b06c", natureLabel: "#b3c0d4", waterLabel: "#8fb3d1",
    city: "#ece6d4", cityFill: "#1f2635", site: "#d08a6a"
  }
};

/** Opacity of the elevation shading, by look. */
const RELIEF = { day: 0.55, night: 0.7 };

/* ---------------------------------------- */
/*  Expressions                              */
/* ---------------------------------------- */

const REGULAR = ["Noto Sans Regular"];
const MEDIUM = ["Noto Sans Medium"];
const ITALIC = ["Noto Sans Italic"];
const NAME = ["coalesce", ["get", "label_en"], ["get", "name_en"], ["get", "name"]];
const CLASS = ["get", "feature_class"];
/** Named, and not the atlas's "unnamed" (its nameless hills and woods). */
const NAMED = ["all", ["has", "name_en"], ["!=", ["downcase", ["to-string", ["get", "name_en"]]], "unnamed"]];
const is = (...c) => ["in", CLASS, ["literal", c]];
const exp = (stops, base = 1.6) => ["interpolate", ["exponential", base], ["zoom"], ...stops.flat()];
const fade = (from, to, a = 0, b = 1) => ["interpolate", ["linear"], ["zoom"], from, a, to, b];
/**
 * A size by zoom that differs by settlement class: MapLibre allows one zoom curve per
 * expression, so the class is matched at each stop. stops: [[zoom, city, town, other]].
 */
const byClass = (stops, base = 1.6) => ["interpolate", ["exponential", base], ["zoom"],
  ...stops.flatMap(([z, city, town, other]) => [z, ["match", ["get", "class"], "City", city, "Town", town, other]])];

const waterZoom = (sqMiles = 0) => (sqMiles > 1e6 ? 0 : sqMiles > 1e5 ? 2.5 : sqMiles > 2e4 ? 4 : sqMiles > 2000 ? 5.5 : 7);

/* ---------------------------------------- */
/*  The style                                */
/* ---------------------------------------- */

/**
 * tiles: { surface, global, underdark, dem } URL templates; glyphs: font URL template;
 * look: "day" | "night"; level: "surface" | "underdark"; places: GeoJSON of the world's places
 * (scripts/places.mjs), with { id, name, kind, class, rank, gold, hidden, edited }; regions:
 * the world index's regions of this level (their label points).
 */
export function buildStyle({ tiles, glyphs, look = "day", level = "surface", attribution = "", relief = true, regions = [], terrain = null, groundGeometry = null, detail = null, borders = false, sourceMap = null, ground = 'atlas', markerScale = 1, labelScale = 1, dim = true, mapLights = false }) {
  if(sourceMap)return sourceMapStyle({tiles,glyphs,sourceMap,attribution,ground,markerScale,labelScale,look,dim,mapLights});
  const P = { ...(PALETTES[look] ?? PALETTES.day) };
  const empty = { type: "FeatureCollection", features: [] };
  const surface = level !== "underdark";
  const src = surface ? "surface" : "underdark";
  const pre = surface ? "srf" : "udk";
  const layer = (name) => `${pre}_${name}`;
  return {
    version: 8,
    glyphs,
    state: { editing: { default: false } },
    sources: {
      surface: { type: "vector", tiles: [tiles.surface], minzoom: 0, maxzoom: 6, attribution },
      global: { type: "vector", tiles: [tiles.global], minzoom: 0, maxzoom: 6 },
      ...(surface ? {} : { underdark: { type: "vector", tiles: [tiles.underdark], minzoom: 0, maxzoom: 6 } }),
      ...(relief && surface && !(groundGeometry && detail) ? { dem: { type: "raster-dem", tiles: [tiles.dem], tileSize: 256, minzoom: 0, maxzoom: 6, encoding: "mapbox" } } : {}),
      ...(relief && surface && detail ? { 'ground-relief': { type: 'raster-dem', tiles: [tiles.relief], tileSize: 256, minzoom: 2, maxzoom: detail.maxZoom, bounds: detail.bounds, encoding: 'mapbox' } } : {}),
      ...(relief && surface && detail ? { 'ground-tint': { type: 'raster', tiles: [tiles.tint], tileSize: 256, minzoom: 2, maxzoom: detail.maxZoom, bounds: detail.bounds } } : {}),
      places: { type: "geojson", data: empty },
      regions: {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: regions.filter((r) => r.label && r.level === level).map((r) => ({
            type: "Feature", geometry: { type: "Point", coordinates: r.label },
            // Waters are named from a zoom by their size: oceans first, small lakes last.
            properties: { name: r.name, feature_class: r.class, rank: r.rank ?? 2, water: !!r.water, minzoom: waterZoom(r.sqMiles) }
          }))
        }
      },
      flash: { type: "geojson", data: empty },
      ...(groundGeometry && surface ? Object.fromEntries(Object.entries(groundGeometry).map(([k, data]) => [`ground-${k}`, { type: "geojson", data, tolerance: 0.1, maxzoom: 14 }])) : {})
    },
    layers: [
      ...(surface ? surfaceGround(P, look, relief && !groundGeometry) : underdarkGround(P)),
      ...(surface && groundGeometry ? sharedGround(P, look, relief, detail) : []),
      // Named regions: a faint dashed border, under the water and roads' names.
      {
        id: "region-lines", type: "line", ...(surface && groundGeometry?.borders ? { source: "ground-borders" } : { source: src, "source-layer": layer("con_named_regions_pg") }),
        layout: { "line-join": "round", 'line-cap': 'round', visibility: borders ? 'visible' : 'none' },
        paint: { "line-color": '#ffffff', "line-opacity": .8, "line-width": exp([[3, .8], [7, 1.2], [10, 1.6]]), "line-dasharray": [.1, 3] }
      },
      ...(surface ? [
        ...(groundGeometry?.trails ? [{ id: 'trails', type: 'line', source: 'ground-trails', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#393b37', 'line-opacity': .85, 'line-width': exp([[4, .7], [9, 1.5], [13, 2.2]]), 'line-dasharray': [.2, 2.8] } }] : []),
        { id: 'roads-casing', type: 'line', ...(groundGeometry?.roads ? { source: 'ground-roads' } : { source: 'surface', 'source-layer': 'srf_civ_pathways_ln' }), filter: is('Primary Road'), layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#d2cdbd', 'line-opacity': .9, 'line-width': exp([[3, 1.2], [6, 2.8], [9, 4], [12, 5.6]]) } },
        {
          id: "roads", type: "line", ...(groundGeometry?.roads ? { source: "ground-roads" } : { source: "surface", "source-layer": "srf_civ_pathways_ln" }), filter: is("Primary Road"),
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": '#292c2b', "line-opacity": 0.95, "line-width": exp([[3, 0.6], [6, 1.4], [9, 2.4], [12, 4]]) }
        },
        { id: "cliffs", type: "line", layout: { visibility: "none" }, ...(groundGeometry?.cliffs ? { source: "ground-cliffs" } : { source: "surface", "source-layer": "srf_nat_linear_landmarks_ln" }), paint: { "line-color": P.cliff, "line-width": exp([[4, 1], [9, 2.5]]) } },
        {
          id: "graticule", type: "line", source: "global", "source-layer": "glb_con_graticule_md_ln", maxzoom: 5,
          paint: { "line-color": P.graticule, "line-opacity": fade(2, 5, 0.35, 0), "line-width": 0.6 }
        }
      ] : []),
      ...flashLayers(P),
      ...placeLayers(P),
      ...labelLayers(P, src, layer, surface, groundGeometry),
      ...(surface && groundGeometry?.frame ? [{id:'reference-frame',type:'fill',source:'ground-frame',paint:{'fill-color':'#191919','fill-antialias':false}}] : [])
    ]
  };
}

/** Both looks use the bake's coast and waterways; water covers the DEM's sea-floor shading. */
function sharedGround(P, look, relief, detail) {
  return [
    { id: "shared-water-base", type: "fill", source: "ground-water", paint: { "fill-color": P.ocean, "fill-antialias": false } },
    { id: "shared-land", type: "fill", source: "ground-land", paint: { "fill-color": P.land } },
    { id: "shared-cover", type: "fill", source: "ground-cover", paint: { "fill-color": ["match", CLASS,
      "Temperate Forest", P.temperate, "Boreal Forest", P.boreal, "Tropical Forest", P.tropical,
      "Swamp", P.swamp, "Sand", P.sand, "Glacier", P.glacier, "Ricefield", P.rice,
      "Blackened Earth", P.blackened, "Grassland", P.sand, "Tundra", "#d7dbd0", "Floating Ice", P.seaIce, P.land], "fill-opacity": 0.9 } },
    ...(relief && detail ? [{ id: 'shared-mountain-color', type: 'raster', source: 'ground-tint', paint: { 'raster-fade-duration': 0 } }] : []),
    ...(relief ? [{ id: "shared-relief", type: "hillshade", source: detail ? "ground-relief" : "dem", paint: {
      "hillshade-shadow-color": P.shadow, "hillshade-highlight-color": P.highlight, "hillshade-accent-color": P.accent,
      "hillshade-exaggeration": RELIEF[look] ?? 0.55, "hillshade-illumination-direction": 315
    } }] : []),
    { id: 'shared-ice-white', type: 'fill', source: 'ground-cover', filter: is('Glacier', 'Ice Sheet', 'Floating Ice'),
      paint: { 'fill-color': '#f7fafb', 'fill-opacity': .93 } },
    { id: 'shared-tundra', type: 'fill', source: 'ground-cover', filter: is('Tundra'),
      paint: { 'fill-color': '#d7dbd0', 'fill-opacity': .85 } },
    { id: "shared-rivers", type: "line", source: "ground-rivers", layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": P.river, "line-width": exp([[2, 0.4], [5, 1], [8, 2], [12, 4]]), "line-opacity": fade(1, 3, 0.4, 1) } },
    { id: "shared-water", type: "fill", source: "ground-water", paint: { "fill-color": P.ocean, "fill-antialias": false } },
    { id: "shared-coast", type: "line", source: "ground-land", layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": '#8d9492', "line-width": exp([[1, 0.4], [5, .7], [9, .9], [12, 1.3]]), "line-opacity": .55 } }
  ];
}

function surfaceGround(P, look, relief) {
  const S = "surface";
  return [
    { id: "background", type: "background", paint: { "background-color": P.ocean } },
    // The sea's areas (one of them spans the world under the land), all one colour: their
    // classes (coastal, oceanic) drew as hard-edged boxes.
    { id: "ocean", type: "fill", source: S, "source-layer": "srf_nat_ocean_pg", paint: { "fill-color": P.ocean, "fill-antialias": false } },
    {
      id: "land", type: "fill", source: S, "source-layer": "srf_nat_land_pg",
      paint: { "fill-color": ["match", CLASS, "Floating Ice", P.ice, P.land] }
    },
    // No climate tint: the atlas's climate zones are blocky and run out over the sea.
    {
      id: "land-cover", type: "fill", source: S, "source-layer": "srf_nat_land_cover_pg",
      paint: {
        "fill-color": ["match", CLASS,
          "Temperate Forest", P.temperate, "Boreal Forest", P.boreal, "Tropical Forest", P.tropical,
          ["Swamp", "Marsh", "Wetland"], P.swamp, "Sand", P.sand, ["Glacier", "Ice Sheet"], P.glacier,
          "Ricefield", P.rice, "Blackened Earth", P.blackened, P.land],
        "fill-opacity": 0.9
      }
    },
    // Forest edges inked, as an atlas draws them.
    {
      id: "forest-edges", type: "line", source: S, "source-layer": "srf_nat_land_cover_pg", minzoom: 4,
      filter: is("Temperate Forest", "Boreal Forest", "Tropical Forest"),
      paint: { "line-color": P.natureLabel, "line-opacity": fade(4, 6, 0, 0.35), "line-width": 0.8 }
    },
    ...(relief ? [{
      id: "relief", type: "hillshade", source: "dem",
      paint: {
        "hillshade-shadow-color": P.shadow, "hillshade-highlight-color": P.highlight, "hillshade-accent-color": P.accent,
        "hillshade-exaggeration": RELIEF[look] ?? 0.55, "hillshade-illumination-direction": 315
      }
    }] : []),
    { id: "sea-ice", type: "fill", source: S, "source-layer": "srf_nat_sea_ice_pg", paint: { "fill-color": P.seaIce, "fill-opacity": 0.85 } },
    { id: "lakes", type: "fill", source: S, "source-layer": "srf_nat_lakes_pg", paint: { "fill-color": P.lake } },
    { id: "lake-islands", type: "fill", source: S, "source-layer": "srf_nat_lake_islands_pg", paint: { "fill-color": P.land } },
    {
      id: "rivers", type: "line", source: S, "source-layer": "srf_nat_rivers_ln",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": P.river, "line-width": exp([[2, 0.4], [5, 1], [8, 2], [12, 4]]), "line-opacity": fade(1, 3, 0.4, 1) }
    },
    {
      id: "coast", type: "line", source: S, "source-layer": "coastlines_pg",
      layout: { "line-join": "round" },
      paint: { "line-color": P.coast, "line-width": exp([[1, 0.4], [5, 1], [9, 1.8], [12, 2.6]]), "line-opacity": 0.85 }
    }
  ];
}

function underdarkGround(P) {
  const U = "underdark";
  return [
    // The surface's coasts faintly underneath, for bearings.
    { id: "background", type: "background", paint: { "background-color": P.shadow } },
    { id: "surface-land", type: "fill", source: "surface", "source-layer": "srf_nat_land_pg", paint: { "fill-color": P.land, "fill-opacity": 0.25 } },
    { id: "domains", type: "fill", source: U, "source-layer": "udk_nat_domains_pg", paint: { "fill-color": P.land, "fill-opacity": 0.9 } },
    { id: "cover", type: "fill", source: U, "source-layer": "udk_nat_underground_cover_pg", paint: { "fill-color": P.swamp, "fill-opacity": 0.6 } },
    { id: "landforms", type: "fill", source: U, "source-layer": "udk_nat_landforms_pg", paint: { "fill-color": P.sand, "fill-opacity": 0.5 } },
    { id: "domain-edges", type: "line", source: U, "source-layer": "udk_nat_domains_pg", paint: { "line-color": P.coast, "line-width": exp([[2, 0.5], [8, 1.8]]) } },
    { id: "lakes", type: "fill", source: U, "source-layer": "udk_nat_lakes_pg", paint: { "fill-color": P.lake } }
  ];
}

/** Settlements and sites from the world's place list (so the GM's edits apply), with the gold glow. */
function placeLayers(P) {
  const kind = (k) => ["==", ["get", "kind"], k];
  const shown = ["!", ["get", "hidden"]];
  const radius = byClass([[3, 2.6, 1.5, 1.2], [6, 4.5, 3.2, 2.2], [10, 7, 5, 3.5]]);
  const glowRadius = byClass([[3, 8, 5, 4], [6, 14, 10, 7], [10, 22, 16, 11]]);
  return [
    {
      id: "place-glow", type: "circle", source: "places", filter: ["all", shown, ["get", "gold"]],
      paint: { "circle-color": P.goldGlow, "circle-opacity": 0.5, "circle-radius": glowRadius, "circle-blur": 1 }
    },
    {
      id: "settlements", type: "symbol", source: "places", filter: ["all", shown, kind("settlement"), ["<=", ["get", "minzoom"], ["zoom"]]],
      layout: { 'icon-image': ['concat', 'faerun-', ['get', 'symbol']], 'icon-size': exp([[3, .45], [6, .65], [10, 1]]), 'icon-allow-overlap': true }
    },
    {
      id: "sites", type: "symbol", source: "places", filter: ["all", shown, ["!", kind("settlement")], ["<=", ["get", "minzoom"], ["zoom"]]],
      layout: { 'icon-image': ['concat', 'faerun-', ['get', 'symbol']], 'icon-size': exp([[5, .5], [8, .7], [11, 1]]), 'icon-allow-overlap': true }
    },
    {
      id: "places-hidden", type: "circle", source: "places", filter: ["all", ["global-state", "editing"], ["get", "hidden"]],
      paint: { "circle-color": "rgba(0,0,0,0)", "circle-radius": 4, "circle-stroke-color": "#e0707a", "circle-stroke-width": 1.2 }
    }
  ];
}

function labelLayers(P, src, layer, surface, groundGeometry) {
  const shown = ["!", ["get", "hidden"]];
  const placeSize = byClass([[3, 12, 10, 9.5], [6, 15, 12.5, 11], [10, 19, 15, 13]], 1.3);
  return [
    {
      // Seas, bays and oceans: one label each, at the world index's label point.
      id: "water-labels", type: "symbol", source: "regions", filter: ["all", ["==", ["get", "water"], true], ["<=", ["get", "minzoom"], ["zoom"]]],
      layout: {
        "text-field": ["get", "name"], "text-font": ITALIC, "text-letter-spacing": 0.2, "text-max-width": 8,
        "text-size": ["interpolate", ["exponential", 1.3], ["zoom"], 1, ["case", [">", ["get", "minzoom"], 3], 10, 12], 5, ["case", [">", ["get", "minzoom"], 3], 12, 16], 8, ["case", [">", ["get", "minzoom"], 3], 14, 20]],
        "symbol-sort-key": ["get", "minzoom"]
      },
      paint: { "text-color": P.waterLabel, "text-halo-color": P.halo, "text-halo-width": 0.8 }
    },
    {
      id: "river-labels", type: "symbol", ...(surface && groundGeometry?.rivers ? { source: "ground-rivers", filter: ["!=", ["get", "name"], ""] } : { source: "surface", "source-layer": "srf_nat_rivers_ln", filter: NAMED }), minzoom: 5.5,
      layout: { "symbol-placement": "line", "symbol-spacing": 420, "text-field": surface && groundGeometry?.rivers ? ["get", "name"] : NAME, "text-font": ITALIC, "text-size": 11, "text-letter-spacing": 0.08, "text-max-angle": 30 },
      paint: { "text-color": P.waterLabel, "text-halo-color": P.halo, "text-halo-width": 1 }
    },
    ...(surface ? [{
      // Mountains, hills, forests, deserts: italic, letter-spaced, as an atlas names them.
      id: "nature-labels", type: "symbol", ...(groundGeometry?.nature ? { source: "ground-nature" } : { source: "surface", "source-layer": "srf_nat_land_regions_pg" }), minzoom: 4, filter: NAMED,
      layout: { "text-field": NAME, "text-font": ITALIC, "text-size": exp([[4, 10], [7, 13], [10, 16]], 1.3), "text-letter-spacing": 0.18, "text-max-width": 7, "text-transform": "uppercase", "symbol-sort-key": ["get", "feature_rank"] },
      paint: { "text-color": P.natureLabel, "text-halo-color": P.halo, "text-halo-width": 1, "text-opacity": fade(4, 4.6) }
    }, {
      id: "forest-labels", type: "symbol", ...(groundGeometry?.forests ? { source: "ground-forests" } : { source: "surface", "source-layer": "srf_nat_land_cover_pg" }), minzoom: 4.5,
      filter: ["all", NAMED, is("Temperate Forest", "Boreal Forest", "Tropical Forest", "Swamp", "Marsh", "Sand")],
      layout: { "text-field": NAME, "text-font": ITALIC, "text-size": exp([[4.5, 10], [8, 13]], 1.3), "text-letter-spacing": 0.12, "text-max-width": 7 },
      paint: { "text-color": P.natureLabel, "text-halo-color": P.halo, "text-halo-width": 1, "text-opacity": fade(4.5, 5) }
    }] : []),
    {
      id: "place-labels", type: "symbol", source: "places", filter: ["all", shown, ["==", ["get", "kind"], "settlement"], ["<=", ["get", "minzoom"], ["zoom"]]],
      layout: {
        "text-field": ["get", "name"], "text-font": ["match", ["get", "class"], "City", ["literal", MEDIUM], ["literal", REGULAR]], "text-size": placeSize,
        "text-variable-anchor": ["left", "right", "top", "bottom"], "text-radial-offset": 0.7, "text-justify": "auto", "text-max-width": 8,
        "symbol-sort-key": ["get", "rank"]
      },
      paint: {
        "text-color": ["case", ["get", "gold"], P.goldLit, ["all", ["global-state", "editing"], ["get", "edited"]], "#c45a9a", P.label],
        "text-halo-color": ["case", ["get", "gold"], "rgba(60, 40, 10, 0.85)", P.halo], "text-halo-width": 1.4
      }
    },
    {
      // Unnamed sites (the atlas's nameless ruins and forts) are marked but not labelled.
      id: "site-labels", type: "symbol", source: "places", filter: ["all", shown, ["!=", ["get", "kind"], "settlement"], ["!", ["get", "unnamed"]], ["<=", ["+", ["get", "minzoom"], 0.5], ["zoom"]]],
      layout: {
        "text-field": ["get", "name"], "text-font": ITALIC, "text-size": exp([[5, 10], [10, 12.5]], 1.3),
        "text-variable-anchor": ["left", "right", "top", "bottom"], "text-radial-offset": 0.7, "text-max-width": 8, "symbol-sort-key": ["get", "rank"]
      },
      paint: { "text-color": ["case", ["get", "gold"], P.goldLit, P.site], "text-halo-color": ["case", ["get", "gold"], "rgba(60, 40, 10, 0.85)", P.halo], "text-halo-width": 1.2 }
    },
    {
      // Kingdoms and regions: large, spaced capitals, fading as one zooms in past them. One label
      // each, at the world index's label point (the tiles cut a region into many pieces).
      id: "region-labels", type: "symbol", source: "regions", filter: ["!=", ["get", "water"], true],
      layout: {
        "text-field": ["get", "name"], "text-font": MEDIUM, "text-transform": "uppercase", "text-letter-spacing": 0.32, "text-max-width": 9,
        "text-size": ["interpolate", ["exponential", 1.3], ["zoom"], 2, ["match", CLASS, "Macroregion", 12, 9], 5, ["match", CLASS, "Macroregion", 20, 15], 8, ["match", CLASS, "Macroregion", 26, 22]],
        "symbol-sort-key": ["get", "rank"], "text-padding": 20
      },
      paint: {
        "text-color": P.regionLabel, "text-halo-color": P.halo, "text-halo-width": 1.2,
        "text-opacity": ["interpolate", ["linear"], ["zoom"], 2, ["match", CLASS, "Macroregion", 1, 0], 3, 1, 7.5, 1, 9, 0.35]
      }
    }
  ];
}

function flashLayers(P) {
  const exp2 = (stops) => exp(stops);
  return [
    { id: "flash-glow", type: "circle", source: "flash", paint: { "circle-color": P.flashGlow, "circle-opacity": 0, "circle-radius": exp2([[3, 14], [8, 24], [12, 36]]), "circle-blur": 1 } },
    { id: "flash-ring", type: "circle", source: "flash", paint: { "circle-color": "rgba(0,0,0,0)", "circle-radius": exp2([[3, 8], [8, 13], [12, 18]]), "circle-stroke-color": P.flash, "circle-stroke-width": 2.5, "circle-stroke-opacity": 0 } }
  ];
}
