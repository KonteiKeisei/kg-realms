import { RegionalMaps } from "./regional-service.mjs";
import { receiveCampMessage } from "./camp-messages.mjs";
import { PartyTokenFit } from "./party-token-fit.mjs";
import { registerShell } from "./ui-shell.mjs";
import { worldUrl, registerWorld, allWorlds, collectWorlds, defaultWorldId, worldDef } from "./worlds.mjs";
import { registerHomebrew, sceneMapPicture } from "./homebrew/homebrew.mjs";
import { setExportData } from "./homebrew/export.mjs";
import { calendarSwitchedClimates, setSceneClimate, followClimate } from "./biome-weather.mjs";
import { flagsNeedRedraw, lakeBiome } from "./biome-climate.mjs";
// The worlds first (worlds.mjs), before anything that loads one: the GM's homebrew worlds saved in
// this game world (homebrew/), then each world module's on the kgRealmsRegisterWorlds hook (KG Realms:
// Faerûn registers Toril). A module registering the same id replaces the homebrew copy.
Hooks.once("init", () => { registerHomebrew(); collectWorlds({ registerWorld }); });
import {bypassPartyEncounter} from './party-encounters.mjs';
import {writeJourney} from './journey-write.mjs';
import {journeyKey} from './journey-state.mjs';
import {focusedScene,partyScene,journeyScenes,sceneParties,partyLabel} from './party-groups.mjs';
import {PartyManager} from './party-manager.mjs';
import {PartyPortraits,PartyInterface} from './party-ui.mjs';
import { latLonToScene, makeFrame, sceneToLatLon, aspect, worldFloor } from "./geo.mjs";
import { isPrimaryGM, primaryGMChoices, userChangeMatters } from "./authority.mjs";
import { needsRouteRefresh, ROUTE_FIELDS } from "./journey-state.mjs";
import { TravelBounce } from "./travel-motion.mjs";
import { rollCampRequest, applyWatchFatigue } from "./camp-rolls.mjs";
import { partyPicker, scenePartyPicker } from "./party-token.mjs";
import {registerIconPackSetting} from './local-icon-packs.mjs';
import {registerPlaceLinks} from './place-links.mjs';
import {adoptEncounterDefaults} from './encounter-defaults.mjs';
import {LocalMapEffects, enableLocalMapFx, waterRegionSettingUI} from './local-map-effects.mjs';
import {SettlementTravelUI} from './city/ui.mjs';
import { RealmLayer } from "./realm-layer.mjs";
import { MapAssets } from './terrain/map-assets.mjs';
import { MAX_SIDE, SCALE, REGION_SCENE_FLAGS, fittingScale, generateRegion, loadWorld, maxSide, openGenerator, sceneSizeAt } from "./generator.mjs";
import { applyEdits, placesGeoJSON, moduleMarkers, dropWaterDuplicates } from "./places.mjs";
import { PlaceCard } from "./ui-card.mjs";
import { RealmSearch } from "./ui-search.mjs";
import { StreetNames } from "./city/street-names.mjs";
import { reconcileAway, placeSplitParties } from "./away-pause.mjs";
import { scaledDrawingShape } from "./scene-resize.mjs";
import { installWeatherFilter, enforceWeatherFilter } from "./weather-filter.mjs";
import { NightLights } from "./night-lights.mjs";
import { applySceneAmbience } from "./scene-ambience.mjs";
import { JourneyLight } from "./journey-light.mjs";
import { LocalMaps } from "./local-maps.mjs";
import { LocalMapRenderer } from "./local-map-renderer.mjs";
import { SnowCover, snowLines, snowConfig, yearFraction, TORIL_SNOW } from "./snow.mjs";
import { areasGeoJSON, outlinedIds, placeLayer, withFollowedBorders, placeFromShore, placeFromZone, inlandWaters, canBeBiome } from "./map-layers.mjs";
import { borderChoices, followOf, waterwaysWithBorders, zonesWithBorders } from "./borders.mjs";
import { LayersRail, chosenLayer } from "./ui-layers.mjs";
import { shoreWater } from "./waterways.mjs";
const snow = new SnowCover();
const nightLights = new NightLights();
const journeyLight = new JourneyLight(() => currentLook(), () => layer.map?.getZoom() ?? 0);
const travelBounce = new TravelBounce();
const localMapRenderer = new LocalMapRenderer({seasonSource: scene => localMaps.seasonSource(scene)});
const mapAssets=new MapAssets({onChange:terrain=>layer.setTerrain(terrain)});
Hooks.once("init", () => {localMapRenderer.install();mapAssets.install();});
Hooks.on('renderSettingsConfig', (_app, html) => waterRegionSettingUI(html?.[0] ?? html));
import { applyRouteEdits, smoothRoutes } from "./routes.mjs";
import { RoadEditor } from "./ui-roads.mjs";
import { PinEditor } from "./ui-pins.mjs";
import { MapEditor } from "./ui-editor.mjs";
import { PracticeTab } from "./ui-practice.mjs";
import { SnowTab } from "./ui-snow.mjs";
import { WaterwayEditor } from "./ui-waterways.mjs";
import { BiomeEditor } from "./ui-biomes.mjs";
import { biomeLookup, biomeTypes, biomeFlag, onlyBiomeFlagChanged, mergeBiomeConfig, biomeEdits } from "./biomes.mjs";
import { hazardVisible, isRiverHazard, isHazard, hazardSubtype } from "./river-hazards.mjs";
import { EncounterBox } from "./ui-encounter-box.mjs";
import { advancedWatchesMenu } from "./ui-camp.mjs";
import { seasonOf, buildSea, automaticPort, terrainHarbours } from "./waterways.mjs";
import { TravelHud } from "./ui-hud.mjs";
import { SOURCE_MAP, lonLatToSource, sourceToLonLat, applySourceMap, sourceProjection } from "./source-map.mjs";
import { PlaceCards } from "./place-card.mjs";
import { registerKinds } from "./card-kinds.mjs";
import { TradeMarkets } from "./trade.mjs";
import { refreshTradeEditors, openTradeEditor } from "./ui-trade.mjs";
import { importJournals, removeRepeats } from "./journals.mjs";

const MODULE_ID = "kg-realms";
const localMapEffects = new LocalMapEffects();
/** Deepest zoom on a realm scene (Foundry's own limit is 3). */
const REALM_MAX_ZOOM = 8;
const LOOKS = { auto: "auto", night: "night", day: "day" };
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

const layer = new RealmLayer();
layer.onJourneyChanged = (coords) => journeyLight.setPath(coords);
/** Custom markers adopted into the module (data/markers/defaults.json). */
// Shipped default markers: the engine's, then each world's own (its definition's markers).
let defaultMarkers = {};
const shippedMarkers = () => Object.assign({}, defaultMarkers, ...allWorlds().map((w) => w.markers ?? {}));
Hooks.once("init", () => fetch(foundry.utils.getRoute("modules/kg-realms/data/markers/defaults.json")).then((r) => r.json()).then((m) => { defaultMarkers = m ?? {}; }).catch(() => {}));
const setting = (key) => game.settings.get(MODULE_ID, key);
/** The region scene flag: { world, level, bounds, milesPer100, version }, or null. */
const regionOf = (scene) => (scene?.getFlag(MODULE_ID, "world") ? scene.flags[MODULE_ID] : null);
let current = null; // { scene, region, world (the index), places (edits applied) }

const regional = new RegionalMaps({
  loadWorld, getLayer:()=>layer, getEdits:id=>editsOf(id),
  rawPlaces:(id,places)=>applyEdits(places,editsOf(id),"surface"),
  getTerrain:async(id,data)=>{await loadShippedWaterways(id);await loadShippedBiomes(id);return terrainFor(id,data);},
  getBiomes:id=>biomesOf(id),
  getRoutes:async(id,data)=>{if(!data.routes)return {type:"FeatureCollection",features:[]};const response=await fetch(worldUrl(id,data.routes));if(!response.ok)throw Error(`${id} roads: HTTP ${response.status}`);const routes=applyRouteEdits(await response.json(),routeEditsOf(id)),p=sourceProjection(data.sourceMap);return data.sourceMap?smoothRoutes(routes,p.toSource,p.toLonLat):routes;},
  revision:()=>[setting("placeEdits"),setting("routeEdits"),setting("biomes"),setting("waterways")],
  onChange:()=>{backgroundJourneys.clear();if(canvas.ready)drawRegion();}
});
Hooks.once("init",()=>regional.init());
const travelWorld=()=>regional.links[current?.region.world]?.parent??current?.region.world;
const travelScene=()=>regional.rootScene(current?.scene??canvas.scene)??current?.scene??canvas.scene;
const travelPlaces=()=>{const id=travelWorld();return id&&regional.indexes[id]?regional.destinations(id):current?.places??[];};

/* ---------------------------------------- */
/*  Places and the GM's edits                */
/* ---------------------------------------- */

// The GM's edits are a world setting holding every world, keyed by world id:
// { [world]: { edits: { [placeId]: {...} }, added: { [id]: {...} } } }.
const editsOf = (world) => (setting("placeEdits") ?? {})[world] ?? { edits: {}, added: {} };
/** One place's edits in a world (null removes a field), as the place editor saves them. */
async function savePlaceEdit(world, id, fields) {
  await saveEdits(world, (w) => {
    if (w.added?.[id]) w.added[id] = { ...w.added[id], ...fields };
    else { w.edits ??= {}; w.edits[id] = { ...(w.edits[id] ?? {}), ...fields }; }
    for (const k of Object.keys(fields)) if (fields[k] === null) { delete w.edits?.[id]?.[k]; delete w.added?.[id]?.[k]; }
    if (w.edits?.[id] && !Object.keys(w.edits[id]).length) delete w.edits[id];
    return w;
  });
}
// Place cards: one window for every place and encounter, and its editor (place-card.mjs).
const cards = new PlaceCards();
let tradeWrites = Promise.resolve();
const trade = new TradeMarkets({
  getEdits: world => (setting("tradeEdits") ?? {})[world] ?? {},
  getScale: () => setting("priceScale"),
  saveEdits(world, id, value, revision) {
    tradeWrites = tradeWrites.catch(() => {}).then(async () => {
      if (!game.user.isGM) throw Error("Only a GM can edit trade.");
      const all = foundry.utils.deepClone(setting("tradeEdits") ?? {}), own = all[world] ??= {};
      if (JSON.stringify(own[id] ?? null) !== revision) throw Error("Trade changed while this editor was open. Close and reopen it before saving.");
      if (value == null) delete own[id]; else own[id] = value;
      await game.settings.set(MODULE_ID, "tradeEdits", all);
    });
    return tradeWrites;
  }
});
const openCard = (ref, options) => cards.open(ref, options);
/** A world's index, with its map sheet in use unless a realm map of another world is on screen. */
const worldWithSheet = async (id) => { const data = await loadWorld(id); if (!current || current.region.world === id) applySourceMap(data.sourceMap); return data; };
const realmPlaces = async (world) => {await regional.prepare(world);return current?.region.world===world?current.places:regional.places(world);};
// Local maps: a settlement's (or site's) own scene with its places on it (local-maps.mjs).
const localMaps = new LocalMaps({
  roadEditor:()=>cityTravel.editor,
  travel:()=>cityTravel.open(),
  needsDock: scene => localMapNeedsDock(scene),
  applyEffects: (scene, entry, world) => localMapEffects.apply(scene, entry, world),
  getRealmPlaces: async (world) => applyEdits((await loadWorld(world)).places, editsOf(world), "surface"),
  savePlaceEdit,
  openCard,
  hoverDelayMs: () => setting("hoverDelayMs"),
  // Seasonal local map pictures follow the Seasonal snow setting and the realm map's snow line:
  // winter while the place is nearer the full cover than the bare ground.
  enabled: () => setting("seasonalSnow"),
  isWinter: async (world, placeId) => {
    const p = placeId ? (await realmPlaces(world)).find((x) => x.id === placeId) : null;
    if (!p) return false;
    await worldWithSheet(world);
    const lines = snowToday(world);
    if (!lines) return false;
    const y = lonLatToSource(p.lon, p.lat)[1];
    return (!!lines.north && y < (lines.north.full + lines.north.bare) / 2) || (!!lines.south && y > (lines.south.full + lines.south.bare) / 2);
  },
  // Presets the module ships (Neverwinter...), set up once per world.
  presetsDone: () => setting("localPresetsDone") ?? [],
  savePresetsDone: (ids) => game.settings.set(MODULE_ID, "localPresetsDone", ids),
  // The realm map to go back to from a local map: the active one if it is of that world, else the first.
  realmSceneFor: (world) => { const all = game.scenes.filter((s) => regionOf(s)?.world === world && (regionOf(s).level ?? "surface") === "surface"); return all.find((s) => s.active) ?? all[0] ?? null; }
});
const cityTravel=new SettlementTravelUI({localMaps});
const partyManager=new PartyManager({before:scene=>syncJourney(scene,{force:true}),busy:id=>cityTravel.fleet.busy(id),
 // A party splitting mid settlement trip: the trip stops where the party is (unused fares refunded), rather than refusing.
 stopTravel:id=>cityTravel.fleet.worker(id).stop('The party split.'),
 isRealm:s=>!!regionOf(s),changed:async scene=>{if(scene===canvas.scene){if(hud.el)hud.mount();await syncJourney(scene,{force:true});}}});
cityTravel.partyManager=partyManager;
const partyPortraits=new PartyPortraits(),partyInterface=new PartyInterface(partyManager);
const partyTokenFit=new PartyTokenFit({isParty:t=>sceneParties(canvas.scene).some(p=>p.id===t.document?.id||p===t.document||p===t)});
Hooks.once('init',()=>{partyPortraits.install();partyInterface.install();partyTokenFit.install();});
Hooks.once("init", () => {localMaps.install();cityTravel.install();});
// Biome climates (biome-climate.mjs): added to each calendar, and the settlement takes its place's.
Hooks.once("init", () => game.settings.register(MODULE_ID, "biomeClimatesAdded", { scope: "world", config: false, type: Object, default: {} }));
Hooks.on("calendaria.calendarSwitched", calendarSwitchedClimates);
Hooks.on("updateScene", followClimate);
Hooks.on("canvasReady", async (cv) => {
  const scene = cv.scene, map = scene?.getFlag(MODULE_ID, "localMap");
  if (!map?.placeId || !map.world || game.user !== game.users.activeGM) return;
  try {
    const place = (await realmPlaces(map.world)).find((p) => p.id === map.placeId);
    if (!place || !Number.isFinite(place.lat)) return;
    await loadShippedBiomes(map.world);
    const data = await worldWithSheet(map.world);
    const query = biomeLookup(biomesOf(map.world), (await import("./travel.mjs")).terrainLookup(await terrainFor(map.world, data)), lonLatToSource);
    const [x, y] = lonLatToSource(place.lon, place.lat);
    await setSceneClimate(scene, await biomeOrLake(map.world, query(x, y), x, y, query));
  } catch (err) { console.warn("kg-realms | settlement weather:", err); }
});
Hooks.once("ready", async () => {
  await enableLocalMapFx().catch(error => console.warn('kg-realms | Could not enable FXMaster world effects:', error));
  await installEncounterDefaults();
  for (const w of allWorlds()) await localMaps.applyPresets(w.id);
  await importOldJournals();
  await removeCardRepeats();
});
/** Once per world (the active GM): cards given the same text twice (0.31.0 to 0.36.0) keep one copy. */
async function removeCardRepeats() {
  if (!isPrimaryGM() || !game.scenes || setting("cardRepeatsRemoved")) return;
  try {
    const n = await removeRepeats({
      worlds: () => Object.keys(setting("placeEdits") ?? {}), editsOf, savePlaceEdit,
      encounterWorlds: () => Object.keys(setting("encounters") ?? {}), saveEncounters
    });
    await game.settings.set(MODULE_ID, "cardRepeatsRemoved", true);
    if (n) ui.notifications.info(`KG Realms: ${n} card${n === 1 ? "" : "s"} had the same text twice; each now has it once.`);
  } catch (err) { console.warn("kg-realms | repeated card text:", err); }
}
/** Journals out, once per world (the active GM): linked journal text goes into the cards (journals.mjs). */
async function importOldJournals() {
  if (!isPrimaryGM() || !game.scenes || setting("journalsImported")) return;
  try {
    const n = await importJournals({
      worlds: () => Object.keys(setting("placeEdits") ?? {}), realmPlaces, editsOf, savePlaceEdit,
      encounterWorlds: () => Object.keys(setting("encounters") ?? {}), saveEncounters
    });
    await game.settings.set(MODULE_ID, "journalsImported", true);
    if (n) ui.notifications.info(`KG Realms: journal text copied into ${n} place and encounter card${n === 1 ? "" : "s"}, hidden from players until you reveal it. Nothing links to a journal any more; the journals are still in the world.`, { permanent: true });
  } catch (err) { console.warn("kg-realms | journal import:", err); }
}
// Snow starting or stopping (Calendaria) changes seasonal local maps.
Hooks.on("calendaria.weatherChange", () => localMaps.applySeasons());
// The card follows changes to what it shows (another GM's edit, a save, a reveal).
for (const hook of ["updateNote", "deleteNote", "updateScene"]) Hooks.on(hook, () => cards.refresh());

async function saveEdits(world, fn) {
  const all = foundry.utils.deepClone(setting("placeEdits") ?? {});
  const before=structuredClone(all[world]??{edits:{},added:{}});
  all[world] = regional.reconcileEdits(world,before,fn(structuredClone(before)),all);
  await game.settings.set(MODULE_ID, "placeEdits", all);
}

/**
 * A world's places with the GM's edits, less any the waterways name: a river, lake or sea drawn as a
 * waterway carries its own name on the map, so the printed label's place goes. Settlements stay
 * (a town may share its river's name). Names match without case, punctuation or a leading "the"
 * (Serpents Tail Stream is Serpent's Tail Stream). A place that is a water itself (a river, stream,
 * lake) also matches with "River" anywhere in it (Rauvin River, the River Rauvin), or spelt a
 * letter or two apart (The Winding Wwater, Winding Water). A site never does (Ascore, the ruin on
 * the Ascore River).
 */
function placesFor(world, places, level) {
  const named = Object.values(waterwaysOf(world)).filter((w) => w.kind !== "wind" && w.name).map((w) => w.name);
  const base=level==="surface"&&regional.indexes[world]?regional.places(world):applyEdits(places,editsOf(world),level);
  return dropWaterDuplicates(withFollowedBorders(base, borderIndex(world)), named);
}

/** The places on the map: their points, and the borders and names of the areas among them (map-layers.mjs). */
function drawPlaces(list) {
  const regions = current?.world?.regions ?? [];
  layer.setPlaces(placesGeoJSON(list, outlinedIds(list, regions)));
  layer.setAreas(areasGeoJSON(list, regions));
}
function refreshPlaces() {
  if (!current) return;
  current.places = placesFor(current.region.world, current.world.places, current.region.level);
  drawPlaces(current.places);
  nightLights.draw(current.places, layer.frame);
  pins.refresh();
}
const hazardPlaces = world => Object.entries(encountersOf(world)).filter(([,e])=>isHazard(e)&&hazardVisible(e,game.user.isGM)).map(([id,e])=>({...e,id:`river-hazard:${id}`,class:hazardSubtype(e)==="rapids"?"Rapids":hazardSubtype(e)==="waterfall"?"Waterfall":"Hazard",kind:"natural",hidden:false}));
// An encounter marker the GM hovers (realm-layer.mjs placeAt): its card, as a place's.
const encounterPlace = id => { if (!game.user.isGM || !current) return null; const e = encountersOf(current.region.world)[id.slice(10)]; return e ? { ...e, id, class: "Encounter", kind: "natural", hidden: false } : null; };
const getPlace = id => id?.startsWith("river-hazard:") ? hazardPlaces(current?.region.world).find(p=>p.id===id)??null : id?.startsWith("encounter:") ? encounterPlace(id) : current?.places.find(p=>p.id===id)??null;

// Road edits, like place edits: a world setting keyed by world id,
// { [world]: { edited: { [id]: {...} }, added: { [id]: {...} }, deleted: [id] } }.
const routeEditsOf = (world) => (setting("routeEdits") ?? {})[world] ?? { edited: {}, added: {}, deleted: [] };
async function saveRouteEdits(world, fn) {
  const all = foundry.utils.deepClone(setting("routeEdits") ?? {});
  all[world] = fn(foundry.utils.deepClone(all[world] ?? { edited: {}, added: {}, deleted: [] }));
  await game.settings.set(MODULE_ID, "routeEdits", all);
}
/** Roads as drawn and travelled: curves through the nodes the editor keeps. */
const curved = (fc) => (fc && current?.world?.sourceMap ? smoothRoutes(fc, lonLatToSource, sourceToLonLat) : fc);
function refreshRoutes() {
  if (!current?.routesBase) return;
  current.routes = applyRouteEdits(current.routesBase, routeEditsOf(current.region.world));
  current.drawn = curved(current.routes);
  layer.setRoutes(current.drawn);
  journeyLight.setRoutes(current.drawn);
  roads.refresh();
  hud.refresh();
}
// Encounters: a world setting { [world]: { [id]: { lon, lat, name, dc, radius (mi), notes } } }, GM only.
const encountersOf = (world) => (setting("encounters") ?? {})[world] ?? {};
let encounterWrites=Promise.resolve();
function saveEncounters(world, fn) {
  encounterWrites=encounterWrites.catch(()=>{}).then(async()=>{
    if(!game.user.isGM)return;
    const all = foundry.utils.deepClone(setting("encounters") ?? {});
    all[world] = fn(foundry.utils.deepClone(all[world] ?? {}));
    await game.settings.set(MODULE_ID, "encounters", all);
  });
  return encounterWrites;
}
// A world module export (homebrew/export.mjs): the world as this game world has it, every edit applied.
setExportData(async (world) => {
  await loadShippedWaterways(world); await loadShippedBiomes(world);
  const index = await loadWorld(world), edits = editsOf(world);
  const levels = new Set([...index.places, ...Object.values(edits.added ?? {})].map((p) => p.level ?? "surface"));
  return {
    places: [...levels].flatMap((level) => applyEdits(index.places, edits, level)),
    routeEdits: routeEditsOf(world), waterways: waterwaysOf(world), biomes: biomesOf(world), encounters: encountersOf(world),
    tradeEdits: (setting("tradeEdits") ?? {})[world] ?? {}, snow: (setting("snow") ?? {})[world], markers: setting("customMarkers") ?? {}
  };
});
/** Each world's shipped encounters (its encounters.json, if it has one), adopted once (the primary GM). */
async function installEncounterDefaults() {
  if (!isPrimaryGM()) return;
  for (const { id } of allWorlds()) {
    try {
      const response = await fetch(worldUrl(id, "encounters.json"));
      if (response.status === 404) continue;
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const defaults = await response.json();
      encounterWrites = encounterWrites.catch(() => {}).then(async () => {
        if (!isPrimaryGM()) return;
        const all = foundry.utils.deepClone(setting('encounters') ?? {}), history = foundry.utils.deepClone(setting('encounterDefaultsApplied') ?? {});
        const next = adoptEncounterDefaults(defaults, all[id], history[id]);
        if (JSON.stringify(next.history) === JSON.stringify(history[id])) return;
        all[id] = next.records;
        history[id] = next.history;
        await game.settings.set(MODULE_ID, 'encounters', all);
        await game.settings.set(MODULE_ID, 'encounterDefaultsApplied', history);
      });
      await encounterWrites;
    } catch (error) { console.warn(`kg-realms | ${id} encounter defaults:`, error); }
  }
}function refreshEncounters() {
  if (!current) return;
  layer.setEncounters(Object.fromEntries(Object.entries(encountersOf(current.region.world)).filter(([,e])=>hazardVisible(e,game.user.isGM))));
  roads.refresh();
  hud.refreshProgress();
}
const shippedBiomes=new Map();
async function loadShippedBiomes(world){if(!borderPlaces.has(world)){borderPlaces.set(world,{});loadWorld(world).then(data=>borderPlaces.set(world,Object.fromEntries((data.places??[]).filter(p=>p.area||p.follow||p.shore).map(p=>[p.id,p])))).catch(()=>borderPlaces.delete(world));}if(!shippedBiomes.has(world)){const work=(async()=>{const r=await fetch(worldUrl(world, "biomes.json"));if(r.status===404)return{};if(!r.ok)throw Error(`Biome defaults: HTTP ${r.status}`);return r.json();})().catch(error=>{console.warn("kg-realms | biome defaults:",error);return{unavailable:true};});shippedBiomes.set(world,work);work.then(data=>shippedBiomes.set(world,data)).catch(()=>shippedBiomes.delete(world));}return shippedBiomes.get(world);}
const storedBiomes = world => mergeBiomeConfig(shippedBiomes.get(world) instanceof Promise?{}:shippedBiomes.get(world),(setting("biomes")??{})[world]??{});
const biomesOf = world => zonesWithBorders(storedBiomes(world),borderIndex(world));
let biomeWrites=Promise.resolve();
function saveBiomes(world,fn){
  biomeWrites=biomeWrites.catch(()=>{}).then(async()=>{if(!game.user.isGM)return;const shipped=await loadShippedBiomes(world);if(shipped.unavailable)throw Error("Biome defaults could not load. Reload before saving biome edits.");const all=foundry.utils.deepClone(setting("biomes")??{}),next=fn(foundry.utils.deepClone(mergeBiomeConfig(shipped,all[world])));all[world]=biomeEdits(shipped,next);await game.settings.set(MODULE_ID,"biomes",all);});return biomeWrites;
}
async function discoverHazard(world,id){
  if(!isPrimaryGM())return;
  return saveEncounters(world,all=>{const e=all[id];return e&&isHazard(e)&&e.autoDiscover!==false&&(e.visibility??"hidden")==="hidden"?{...all,[id]:{...e,visibility:"discovered"}}:all;});
}
// Waterways: the module's (data/worlds/<world>/waterways.json: rivers, shorelines, and the winds
// and currents) always, with the GM's changes on top. The world setting keeps only the changes:
// { [world]: { [id]: { kind, name, pts: [[lon, lat]], current, factor, seasons } | null } }, a
// line of the GM's own or one of the module's as changed, null for one of the module's deleted.
// A line the GM leaves as the module has it keeps following the module's next releases.
const shippedWaterways = new Map();
// What the module has since corrected on its lines (a spelling, a river's current): { [id]: { field: the old value } }.
const shippedWas = new Map();
async function loadShippedWaterways(world) {
  if (shippedWaterways.has(world)) return shippedWaterways.get(world);
  shippedWaterways.set(world, {});
  try {
    const r = await fetch(worldUrl(world, "waterways.json"));
    if (r.ok) { const data = await r.json(); shippedWaterways.set(world, data.waterways ?? {}); shippedWas.set(world, { ...Object.fromEntries(Object.entries(data.renames ?? {}).map(([id, name]) => [id, { name }])), ...(data.was ?? {}) }); }
  } catch { /* none shipped */ }
  return shippedWaterways.get(world);
}
function storedWaterways(world) {
  const out = { ...(shippedWaterways.get(world) ?? {}) };
  for (const [id, w] of Object.entries((setting("waterways") ?? {})[world] ?? {})) { if (w) out[id] = w; else delete out[id]; }
  return out;
}
/** Everything with an outline, as stored, for shared borders (borders.mjs). The world's own places with their edits on top. */
const borderPlaces = new Map();
function borderIndex(world) {
  const edits = editsOf(world), places = { ...(borderPlaces.get(world) ?? {}) };
  for (const [id, e] of Object.entries(edits.edits ?? {})) places[id] = e.removed ? null : { ...(places[id] ?? {}), ...e };
  for (const [id, p] of Object.entries(edits.added ?? {})) places[id] = { ...p, ...(edits.edits?.[id] ?? {}) };
  for (const id of Object.keys(places)) if (!places[id]) delete places[id];
  return { shores: storedWaterways(world), zones: storedBiomes(world).zones ?? {}, places };
}
function waterwaysOf(world) { return waterwaysWithBorders(storedWaterways(world), borderIndex(world)); }
/** fn(the waterways as they are) gives them as they should be; only what differs from the module's is kept. */
async function saveWaterways(world, fn) {
  const shipped = await loadShippedWaterways(world), next = fn(foundry.utils.deepClone(waterwaysOf(world))) ?? {};
  const own = {};
  for (const [id, w] of Object.entries(next)) if (!shipped[id] || JSON.stringify(shipped[id]) !== JSON.stringify(w)) own[id] = w;
  for (const id of Object.keys(shipped)) if (!(id in next)) own[id] = null;
  const all = foundry.utils.deepClone(setting("waterways") ?? {});
  all[world] = own;
  await game.settings.set(MODULE_ID, "waterways", all);
}
/**
 * Each load (the active GM): a world's own copy of one of the module's lines that is now just the
 * module's (the GM's export became the module's default), or differs from it only where the copy
 * still holds what the module has since corrected (an old spelling, a river's old current), is let
 * go, so the line follows the module from then on. A value the GM set themselves stays.
 */
async function tidyWaterways() {
  const all = foundry.utils.deepClone(setting("waterways") ?? {});
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  let dropped = 0;
  for (const [world, own] of Object.entries(all)) {
    if (!own) continue;
    const shipped = await loadShippedWaterways(world), was = shippedWas.get(world) ?? {};
    for (const [id, w] of Object.entries(own)) {
      const s = shipped[id];
      if (!w || !s) continue;
      const fields = [...new Set([...Object.keys(w), ...Object.keys(s)])].filter((k) => !same(k === "name" ? w[k] ?? "" : w[k], k === "name" ? s[k] ?? "" : s[k]));
      if (fields.every((k) => was[id] && k in was[id] && same(w[k], was[id][k]))) { delete own[id]; dropped++; }
    }
  }
  if (dropped) await game.settings.set(MODULE_ID, "waterways", all);
}

/**
 * Once (v0.49.0): a world's waterways used to replace the module's. Now they go on top of it, so
 * the lines that were the module's come out of the world's own: the traced rivers and joined
 * shorelines of v0.45.0 (gone from the module), and the winds and currents (now the module's,
 * named). The GM's own rivers and shorelines stay as they were.
 */
async function migrateWaterways() {
  if (!isPrimaryGM()) return;
  if (setting("waterwaysOnTop")) return tidyWaterways();
  const all = foundry.utils.deepClone(setting("waterways") ?? {});
  let dropped = 0;
  for (const [world, own] of Object.entries(all)) {
    if (!own) continue;
    const shipped = await loadShippedWaterways(world);
    for (const [id, w] of Object.entries(own)) {
      const made = /^ww-(river|shore)-\d+$/.test(id) || id.startsWith("ww-default-");
      const wind = w?.kind === "wind" && shipped[id];
      const same = w && shipped[id] && JSON.stringify(shipped[id]) === JSON.stringify(w);
      if (made || wind || same) { delete own[id]; dropped++; }
    }
  }
  if (dropped) await game.settings.set(MODULE_ID, "waterways", all);
  await game.settings.set(MODULE_ID, "waterwaysOnTop", true);
  await tidyWaterways();
  if (dropped) ui.notifications.info(`KG Realms: waterways now come from the module, with your own on top. ${dropped} of this world's lines were the module's and now follow it.`);
}
/** The season now: the calendar's own season when it names one, else by the month. */
function currentSeason() {
  const c = game.time.components, cal = game.time.calendar;
  const v = cal?.seasons?.values, list = Array.isArray(v) ? v : Object.values(v ?? {});
  const name = c?.season != null && list[c.season]?.name ? game.i18n.localize(list[c.season].name) : "";
  return seasonOf(yearFraction(c, cal), name);
}
const terrainLoads = new Map(), shoreGrids = new Map();
/** A made world has no terrain grid of its own: plains everywhere, about 2,048 cells across at most. */
function blankTerrain(sheet) {
  const cell = Math.max(4, Math.ceil(Math.max(sheet.width, sheet.height) / 2048)), width = Math.ceil(sheet.width / cell), height = Math.ceil(sheet.height / cell);
  return { data: new Uint8Array(width * height).fill(1), width, height, cell };
}
/** A world's terrain grid with the water its shorelines mark (a shoreline's water side, 0.75). */
async function terrainFor(worldId, world) {
  const base = await baseTerrain(worldId, world);
  const { toSource } = sourceProjection(world.sourceMap);
  if (!base) return null;
  const shores = Object.entries(waterwaysOf(worldId)).filter(([, w]) => w?.kind === "shore" && w.water && w.pts?.length > 1).map(([id, w]) => ({ id, water: w.water, closed: !!w.closed, pts: w.pts.map((c) => toSource(c[0], c[1])) }));
  if (!shores.length) return base;
  const key = JSON.stringify(shores), was = shoreGrids.get(worldId);
  if (was?.base === base && was.key === key) return was.grid;
  const grid = shoreWater(base, shores);
  shoreGrids.set(worldId, { base, key, grid });
  return grid;
}
async function baseTerrain(worldId, world) {
  if (!world?.terrain && world?.sourceMap) {
    if (!terrainLoads.has(worldId)) terrainLoads.set(worldId, Promise.resolve(blankTerrain(world.sourceMap)));
    return terrainLoads.get(worldId);
  }
  if (!world?.terrain) return null;
  if (!terrainLoads.has(worldId)) {
    const pending = (async () => {
      const bmp = await createImageBitmap(await (await fetch(worldUrl(worldId, world.terrain.file))).blob());
      try {
        const c = new OffscreenCanvas(bmp.width, bmp.height), g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(bmp, 0, 0);
        const rgba = g.getImageData(0, 0, bmp.width, bmp.height).data, data = new Uint8Array(bmp.width * bmp.height);
        for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4];
        return { data, width: bmp.width, height: bmp.height, cell: world.terrain.cell };
      } finally { bmp.close?.(); }
    })();
    terrainLoads.set(worldId, pending);
    pending.catch(() => { if (terrainLoads.get(worldId) === pending) terrainLoads.delete(worldId); });
  }
  return terrainLoads.get(worldId);
}
const localPortIndexes = new Map();
async function localMapNeedsDock(scene) {
  const map=scene?.getFlag(MODULE_ID,'localMap');if(!map?.placeId)return false;
  const places=await realmPlaces(map.world),place=places.find(p=>p.id===map.placeId);
  if(!place)return false;if(place.port!=null)return place.port===true;
  if(place.kind!=='settlement')return false;
  const world=await loadWorld(map.world);await loadShippedWaterways(map.world);
  const grid=await terrainFor(map.world,world);if(!grid)return false;
  const waterways=waterwaysOf(map.world),mpp=SOURCE_MAP.milesPerPixel;
  const ports=terrainHarbours(grid,places,lonLatToSource,mpp),key=JSON.stringify([waterways,ports]);
  let index=localPortIndexes.get(map.world);
  if(index?.grid!==grid||index.key!==key){
    const sea=current?.region.world===map.world&&hud.seaKey===JSON.stringify(waterways)&&hud.seaGrid===grid?hud.sea:buildSea(grid,Object.entries(waterways).map(([id,w])=>({id,...w,pts:(w.pts??[]).map(c=>lonLatToSource(c[0],c[1]))})),{milesPerPixel:mpp,ports,portsOnly:true});
    index={grid,key,sea};localPortIndexes.set(map.world,index);
  }
  return automaticPort(place,index.sea,lonLatToSource,mpp);
}

async function loadTerrain() {
  const region = current;
  if (!region?.world.terrain && !region?.world.sourceMap) return null;
  // The shipped waterways come with the terrain: both are read before the first route by water.
  await loadShippedWaterways(region.region.world);
  await loadShippedBiomes(region.region.world);
  if (current !== region) return null;
  const grid = await terrainFor(region.region.world, region.world);
  return current === region ? grid : null;
}
async function focusParty(id,scene=canvas.scene){
 if(!isPrimaryGM()||!sceneParties(scene).some(t=>t.actor.id===id))return;
 await syncJourney(scene,{force:true});await scene.setFlag(MODULE_ID,'partyFocus',id);
}
/** A lake has the weather of the land around it. Its outlines are worked out once per change to them. */
let inlandMemo = null;
async function biomeOrLake(world, biome, x, y, query) {
  if (biome || !query) return biome;
  const places = await realmPlaces(world), own = setting("waterways");
  const { toSource } = sourceProjection((await loadWorld(world)).sourceMap);
  if (inlandMemo?.places !== places || inlandMemo?.own !== own || inlandMemo?.world !== world) inlandMemo = { places, own, world, rings: inlandWaters(places, waterwaysOf(world)).map((r) => r.map((c) => toSource(c[0], c[1]))) };
  return lakeBiome(x, y, inlandMemo.rings, query);
}
const onBiome = async (scene, biome, here, query) => {
  try {
    const regionalWorld=biome?.world&&biome.world!==regionOf(scene)?.world?biome.world:null;
    await setSceneClimate(scene,regionalWorld?biome:here?await biomeOrLake(regionOf(scene)?.world,biome,here[0],here[1],query):biome);
    const detail=regionalWorld?game.scenes.get(regional.links[regionalWorld]?.scene):null;
    if(detail)await setSceneClimate(detail,biome);
  }
  catch (err) { console.warn("kg-realms | biome weather:", err); }
};
/** A biome zone on a place that follows a shoreline goes where the shoreline goes, and goes if it stops being able to be one. */
async function syncShoreZones() {
  if (!current || !isPrimaryGM()) return;
  const world = current.region.world, zones = storedBiomes(world).zones ?? {}, linked = current.places.filter((p) => p.shoreLine && p.biomeZone);
  const change = linked.filter((p) => zones[p.biomeZone] && (!canBeBiome(p) || JSON.stringify(zones[p.biomeZone].pts) !== JSON.stringify(p.area)));
  if (!change.length) return;
  await saveBiomes(world, (c) => {
    const next = { ...c.zones };
    for (const p of change) { if (canBeBiome(p)) next[p.biomeZone] = { ...next[p.biomeZone], pts: structuredClone(p.area) }; else delete next[p.biomeZone]; }
    return { ...c, zones: next };
  });
  const gone = change.filter((p) => !canBeBiome(p));
  for (const p of gone) await savePlaceEdit(world, p.id, { biomeZone: null });
  if (gone.length) ui.notifications.info(`KG Realms: removed the biome zone of ${gone.map((p) => p.name).join(", ")}: its shoreline no longer closes.`);
}
const hud = new TravelHud({
  onBiome,
  getScene:()=>focusedScene(travelScene()),
  getSourceMap:()=>regional.indexes[travelWorld()]?.sourceMap??current?.world.sourceMap,
  getRegionalNetwork:()=>regional.network(travelWorld()),
  getTokenFrame:scene=>regional.frame(scene)??layer.frame,
  onTravelPosition:(scene,at,ids)=>regional.syncPosition(scene,at,ids),
  openRegionalView:world=>regional.openView(world,travelScene()),
  onPartyFocus:id=>focusParty(id,travelScene()),
  getBiomes:()=>current?biomesOf(travelWorld()):{},getWorld:()=>travelWorld(),discoverHazard:id=>{const ref=regional.recordRef(travelWorld(),id);return current&&discoverHazard(ref.world,ref.id);},
  onCampWorkEnded: (scene) => campWorkEnded(scene),
  getLayer: () => regional.viewLayer(layer,current?.region.world),
  getPlaces: travelPlaces,
  getDestinations:()=>regional.destinations(travelWorld()),
  getRoutes: () => regional.networks.get(travelWorld())?.network.routes ?? (regional.links[current?.region.world]?{type:"FeatureCollection",features:[]}:current?.drawn??current?.routes??{type:"FeatureCollection",features:[]}),
  getEncounters: () => current?regional.encounters(travelWorld(),encountersOf):[],
  getTerrain: () => travelWorld()===current?.region.world?loadTerrain():terrainFor(travelWorld(),regional.indexes[travelWorld()]),
  getWaterways: () => (current ? waterwaysOf(travelWorld()) : {}),
  // The world's own rules lore (its definition's rules: { seasons: [[label, text]] }).
  getWorldRules: () => (current ? worldDef(travelWorld())?.rules ?? null : null),
  getSeason: () => currentSeason(),
  onSyncNeeded: (sceneId) => game.socket.emit(`module.${MODULE_ID}`, { type: "request-sync", scene: sceneId, user: game.user.id }),
  // Towns and sites with a local map: travel stops there to ask whether the party is staying.
  getTowns: () => travelPlaces().flatMap((p) => {
    const scene = p.scene ? game.scenes.get(p.scene) : null, map = scene?.getFlag(MODULE_ID, "localMap");
    if (!map || map.placeId !== p.id || p.hidden) return [];
    const mpp = hud.sourceMap.milesPerPixel ?? 1;
    return [{ id: `town-${p.id}`, kind: "town", name: p.name, placeId: p.id, sceneId: scene.id, at: hud.toSource(p.lon, p.lat), radius: (p.kind === "settlement" ? 1.5 : 0.75) / (regional.indexes[p.regionalWorld]?.sourceMap?.milesPerPixel??mpp), ...regional.metricFor(travelWorld(),p.regionalWorld) }];
  }),  // Encounters placed in the map editor, edited from the travel panel's Encounters tab.
  saveWorldEncounter: (id, fields) => {if(!current)return;const ref=regional.recordRef(travelWorld(),id);return saveEncounters(ref.world,w=>w[ref.id]?{...w,[ref.id]:{...w[ref.id],...fields}}:w);},
  // An encounter's card: the journey's own (own) or one placed in the map editor.
  openEncounter: (id, own, options) => {if(!current)return;const ref=regional.recordRef(travelWorld(),id);return openCard(own?{kind:'journey',scene:hud.scene.id,partyId:hud.scene?.partyId,id}:{kind:'encounter',...ref},options);},
  // Route editing and the map editor never run together.
  onEditStart: () => { if (editor.active) editor.onClose(); }
});
// No timer: off-map progress is computed only for an observed journey or an explicit request.
// Cached headless planners share terrain bytes, never build a map, and never render a HUD.
const backgroundJourneys = new Map(), routeLoads = new Map();
async function syncJourney(scene, { force = false } = {}) {
 if(!scene?.partyId){const views=journeyScenes(scene);if(views.some(s=>s?.partyId))return Promise.all(views.map(s=>syncJourney(s,{force})));}
  if (!isPrimaryGM() || !regionOf(scene) || !scene.getFlag(MODULE_ID, "journey")?.trip) return;
  if (hud.scene === scene && hud.el) return hud.tick({ force });
  let entry = backgroundJourneys.get(`${scene.id}:${scene.partyId??''}`);
  if (!entry) { entry = {}; backgroundJourneys.set(`${scene.id}:${scene.partyId??''}`, entry); }
  entry.force ||= force;
  if (entry.busy) { entry.again = true; return entry.busy; }
  entry.busy = (async () => {
    do {
      entry.again = false;
      const forceNow = entry.force; entry.force = false;
      const region = regionOf(scene), state = scene.getFlag(MODULE_ID, "journey");
      if (!isPrimaryGM() || !state?.trip) return;
      const world = await loadWorld(region.world);
      await regional.prepare(region.world);
      const { sourceMap, toSource, toLonLat } = sourceProjection(world.sourceMap);
      await loadShippedWaterways(region.world);
      await loadShippedBiomes(region.world);
      if (!isPrimaryGM()) return;
      if (!routeLoads.has(region.world)) routeLoads.set(region.world, fetch(worldUrl(region.world, world.routes)).then((r) => { if (!r.ok) throw new Error(`Routes: HTTP ${r.status}`); return r.json(); }).catch((e) => { routeLoads.delete(region.world); throw e; }));
      const base = await routeLoads.get(region.world);
      const worldKey = JSON.stringify([region.world, sourceMap]);
      if (entry.worldKey !== worldKey) { entry.hud = null; entry.key = null; entry.worldKey = worldKey; }
      if (!entry.hud) {
        const bounds = world.sourceMap?.bounds ?? region.bounds, d = scene.dimensions;
        let rect = d.sceneRect ?? { x: d.sceneX, y: d.sceneY, width: d.sceneWidth, height: d.sceneHeight };
        if (world.sourceMap) { const ratio = aspect(bounds), width = Math.min(rect.width, rect.height / ratio), height = width * ratio; rect = { x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2, width, height }; }
        const frame = makeFrame(bounds, rect);
        entry.hud = new TravelHud({ headless: true, onBiome, getRegionalNetwork:()=>regional.network(region.world), onTravelPosition:(scene,at,ids)=>regional.syncPosition(scene,at,ids), getSourceMap: () => sourceMap, getScene: () => scene, getLayer: () => ({ frame }),
          getBiomes:()=>biomesOf(region.world),getWorld:()=>region.world,discoverHazard:id=>{const ref=regional.recordRef(region.world,id);return discoverHazard(ref.world,ref.id);},
          onCampWorkEnded: (scene) => campWorkEnded(scene),
          canSync: () => !(hud.scene===scene&&hud.el),
          onBackgroundEncounter:(worker,p)=>backgroundEncounter(worker,p),
          openEncounter:(id,own,options)=>openCard(own?{kind:'journey',scene:scene.id,partyId:scene.partyId,id}:{kind:'encounter',...regional.recordRef(region.world,id)},options),
          getPlaces: () => entry.places, getRoutes: () => entry.routes,
          getTerrain: () => terrainFor(region.world, world), getWaterways: () => waterwaysOf(region.world), getSeason: currentSeason,
          getEncounters: () => regional.encounters(region.world,encountersOf),
          getTowns: () => entry.places.flatMap((p) => { const local = p.scene ? game.scenes.get(p.scene)?.getFlag(MODULE_ID, "localMap") : null; return local?.placeId === p.id && !p.hidden ? [{ id: `town-${p.id}`, kind: "town", name: p.name, sceneId: p.scene, at: toSource(p.lon, p.lat), radius: (p.kind === "settlement" ? 1.5 : .75) / (regional.indexes[p.regionalWorld]?.sourceMap?.milesPerPixel??world.sourceMap?.milesPerPixel??1),...regional.metricFor(region.world,p.regionalWorld) }] : []; })
        });
      }
      entry.hud.unfocused=!!scene.partyId&&focusedScene(scene.realScene)!==scene;
      const key = JSON.stringify([ROUTE_FIELDS.map((k) => state[k]), state.trip?.walking, state.trip?.biomeTravel, routeEditsOf(region.world), editsOf(region.world), waterwaysOf(region.world), biomesOf(region.world), setting("regionalMaps"), setting("travelRules"), entry.hud.speed().feet, entry.hud.favoredTerrains(), currentSeason()]);
      const projection = JSON.stringify([state.trip, state.encounters, state.rest, encountersOf(region.world)]);
      entry.hud.forceSnapshot ||= forceNow;
      if (key !== entry.key) {
        entry.places = regional.destinations(region.world);
        const routes = applyRouteEdits(base, routeEditsOf(region.world));
        entry.routes = world.sourceMap ? smoothRoutes(routes, toSource, toLonLat) : routes;
        await entry.hud.refresh();
        entry.key = key; entry.projection = projection;
      } else if (entry.projection !== projection) { await entry.hud.refreshProgress(); entry.projection = projection; }
      else await entry.hud.tick({ force: forceNow });
    } while (entry.again && isPrimaryGM());
  })().catch((err) => console.warn("kg-realms | requested journey sync:", err)).finally(() => { entry.busy = null; });
  return entry.busy;
}

const backgroundNotices=new Set();let backgroundDialogs=Promise.resolve();
function backgroundEncounter(worker,p){
 const scene=worker.scene,key=`${scene.id}:${scene.partyId}:${journeyKey(worker.state)}:${p.encounter.id}:${p.since}`;
 if(backgroundNotices.has(key))return;backgroundNotices.add(key);if(backgroundNotices.size>256)backgroundNotices.delete(backgroundNotices.values().next().value);
 backgroundDialogs=backgroundDialogs.catch(()=>{}).then(async()=>{
  if(!isPrimaryGM()||!sceneParties(scene.realScene).some(t=>t.actor.id===scene.partyId)||worker.progress()?.encounter?.id!==p.encounter.id)return;
  const e=p.encounter,escape=foundry.utils.escapeHTML;
  const result=await foundry.applications.api.DialogV2.wait({window:{title:`${partyLabel(scene)}: encounter`},position:{width:500},rejectClose:false,
   content:`<p><strong>${escape(partyLabel(scene))}</strong> stopped at <strong>${escape(e.name??'an encounter')}</strong>.</p><p>The other party continues to use the shared clock. This party waits here until you resolve its encounter.</p><label>Reason for bypassing<textarea name="resolution" rows="3" placeholder="How was the encounter resolved?"></textarea></label>`,
   buttons:[{action:'run',label:'Run encounter',callback:()=>({run:true})},{action:'bypass',label:'Bypass encounter',disabled:true,callback:(_e,b)=>({reason:b.form.elements.resolution.value.trim()})},{action:'later',label:'Leave waiting',callback:()=>null}],
   render:(_e,dialog)=>{const box=dialog.element.querySelector('[name="resolution"]'),button=dialog.element.querySelector('[data-action="bypass"]');box.addEventListener('input',()=>button.disabled=!box.value.trim());}
  });
  if(!result||!isPrimaryGM()||worker.progress()?.encounter?.id!==e.id)return;
  if(result.run){await focusParty(scene.partyId,scene.realScene);if(!isPrimaryGM())return;await worker.openHeldEncounter(p);if(e.kind!=='town'&&e.dc!=null&&e.perception!=='passive'&&!p.camp)await worker.requestPerception(e);return;}
  if(!result.reason)return;
  if(!await bypassPartyEncounter(scene,e,result.reason,{trip:journeyKey(worker.state)}))return;
  await ChatMessage.create({content:`<p><strong>${escape(partyLabel(scene))}</strong> bypassed ${escape(e.name??'an encounter')}: ${escape(result.reason)}</p>`,whisper:ChatMessage.getWhisperRecipients?.('GM').map(u=>u.id)});
  await syncJourney(scene,{force:true});
 });
}

function syncViewedJourneys() {
  if (!isPrimaryGM()) return;
  const viewed = new Set(Array.from(game.users).filter((u) => u.active).map((u) => u.viewedScene));
  for(const scene of game.scenes)if(scene.getFlag(MODULE_ID,'partyJourneys')&&journeyScenes(scene).some(s=>s.getFlag(MODULE_ID,'journey')?.trip))viewed.add(scene.id);
  for(const id of [...viewed]){const owner=regional.rootScene(game.scenes.get(id));if(owner)viewed.add(owner.id);}
  for (const id of viewed) { const scene = game.scenes.get(id); if (scene && (scene !== canvas.scene || scene.getFlag(MODULE_ID,'partyJourneys'))) syncJourney(scene); }
}

function campWorkEnded(scene) {
  if (!isPrimaryGM()) return;
  if ((scene.realScene??scene) === canvas.scene && hud.el) hud.tick();
  else if (Array.from(game.users).some((u) => u.active && u.viewedScene === scene.id)) syncJourney(scene);
}

function authorityChanged() {
  const config = game.settings.settings?.get(`${MODULE_ID}.primaryGM`);
  if (config) config.choices = primaryGMChoices();
  if (hud.el && hud.state.trip) {
    if (isPrimaryGM()) hud.tick({ force: true });
    else hud.onSyncNeeded?.(hud.scene.id);
  }
  syncViewedJourneys();
}
Hooks.once("ready", authorityChanged);
for (const event of ["userConnected", "createUser", "deleteUser"]) Hooks.on(event, () => authorityChanged());
// Any module's user flag write fires updateUser: only changes to who is GM, who is here, where
// they are looking, or a GM's name (the Primary GM list) matter.
Hooks.on("updateUser", (user, changes) => { if (userChangeMatters(changes)) authorityChanged(); });

const planner = { open: () => hud.toggle() };
// On a scene an encounter links to: the encounter's small box (its assets, and back to the journey).
const encounterBox = new EncounterBox({ worldEncounters: () => setting("encounters") ?? {}, openCard: (ref) => openCard(ref), onJourneyChanged: (scene) => syncJourney(scene, { force: true }) });
const refreshEncounterBox = () => (regionOf(canvas.scene) ? encounterBox.close() : encounterBox.refresh());
const pins = new PinEditor({
  getLayer: () => layer,
  getPlaces: () => current?.places ?? [],
  getPlace: (id) => getPlace(id),
  // The world's own area records (Toril's regions, as rectangles) for areas with no border drawn yet.
  getRegions: () => current?.world?.regions ?? [],
  // A place selected in the editor: the map shows its layer.
  showLayer: (name) => layersRail.setLayer(name),
  // The outlines a place can follow.
  getBorderChoices: (self, name) => (current ? borderChoices(borderIndex(current.region.world), self, name) : []),
  // A geography area can be a biome zone (0.82).
  getBiomes: () => (current ? biomesOf(current.region.world) : null),
  saveBiomes: (fn) => current && saveBiomes(current.region.world, fn),
  openCard: (id, options) => current && openCard({ kind: "realm", world: current.region.world, id }, options),
  getEdits: () => (current ? editsOf(current.region.world) : null),
  saveEdits: (fn) => saveEdits(current.region.world, fn),
  // Places the GM removed from this world, to bring back.
  getRemoved: () => (current ? applyEdits(current.world.places, editsOf(current.region.world), current.region.level, { removed: true }) : []),
  restorePlace: (id) => current && saveEdits(current.region.world, (w) => { if (w.edits?.[id]) { const { removed, ...rest } = w.edits[id]; w.edits = { ...w.edits, [id]: rest }; } return w; }),
  getMarkers: () => moduleMarkers(shippedMarkers(), setting("customMarkers") ?? {}),
  saveMarkers: async (fn) => game.settings.set(MODULE_ID, "customMarkers", fn(foundry.utils.deepClone(setting("customMarkers") ?? {}))),
  // Every place as the map shows it (edits applied), with the raw edits and custom markers, so
  // the export can be imported again or adopted as the module's default.
  exportPlaces: () => {
    if (!current) return;
    const keep = ["id", "name", "kind", "kindChosen", "class", "rank", "lon", "lat", "shape", "layer", "area", "areaClosed", "shore", "follow", "biomeZone", "partOf", "color", "summary", "img", "scene", "gold", "hidden", "visibility", "known", "rumours", "gmNotes", "actor", "marker", "added"];
    const places = current.places.map((p) => Object.fromEntries(keep.filter((k) => p[k] !== undefined && (p[k] !== false || k === "areaClosed")).map((k) => [k, p[k]])));
    const data = { type: "kg-realms-places", world: current.region.world, version: game.modules.get(MODULE_ID).version, edits: editsOf(current.region.world), customMarkers: setting("customMarkers") ?? {}, places };
    foundry.utils.saveDataToFile(JSON.stringify(data, null, 1), "application/json", `${current.region.world}-places.json`);
  },
  importPlaces: () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      try {
        const data = JSON.parse(await input.files[0].text());
        if (data?.type !== "kg-realms-places" || !data.edits) throw new Error("not a KG Realms places export");
        const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Import places" }, content: `<p>Replace this world's place edits with the ${Object.keys(data.edits.edits ?? {}).length} edited and ${Object.keys(data.edits.added ?? {}).length} added places in the file?</p>`, rejectClose: false });
        if (!ok) return;
        await saveEdits(current.region.world, () => data.edits);
        if (data.customMarkers) await game.settings.set(MODULE_ID, "customMarkers", { ...(setting("customMarkers") ?? {}), ...data.customMarkers });
        ui.notifications.info("KG Realms: places imported.");
      } catch (err) { ui.notifications.error(`KG Realms: could not import places (${err.message}).`); }
    });
    input.click();
  },
  // While a marker is dragged, only this client's map moves it.
  preview: (id, [lon, lat]) => {
    if (!current) return;
    drawPlaces(current.places.map((p) => (p.id === id ? { ...p, lon, lat } : p)));
  },
  onClose: () => {
    const tool = ui.controls?.controls?.notes?.tools?.kgRealmsPins;
    if (tool) tool.active = false;
    pins.close();
    ui.controls?.render();
  }
});
const roads = new RoadEditor({
  getWorld:()=>current?.region.world,
  getWaterways:()=>current?waterwaysOf(current.region.world):{},
  getLayer: () => layer,
  getRoutes: () => current?.routes ?? { type: "FeatureCollection", features: [] },
  getBase: () => current?.routesBase ?? { type: "FeatureCollection", features: [] },
  getPlaces: () => current?.places ?? [],
  getEdits: () => (current ? routeEditsOf(current.region.world) : { edited: {}, added: {}, deleted: [] }),
  saveEdits: (fn) => saveRouteEdits(current.region.world, fn),
  getEncounters: () => (current ? encountersOf(current.region.world) : {}),
  saveEncounters: (fn) => saveEncounters(current.region.world, fn),
  openEncounter: (id) => current && openCard({ kind: "encounter", world: current.region.world, id }),
  onClose: () => {
    const tool = ui.controls?.controls?.notes?.tools?.kgRealmsRoads;
    if (tool) tool.active = false;
    roads.close();
    ui.controls?.render();
  }
});

const water = new WaterwayEditor({
  getLayer: () => layer,
  // The place that follows a shoreline; making one, or linking one of its name (the GM's choice).
  shorePlace: (id) => current?.places.find((p) => followOf(p) === `shore:${id}`) ?? null,
  getBorderChoices: (self, name) => (current ? borderChoices(borderIndex(current.region.world), self, name) : []),
  makeShorePlace: async (id) => {
    if (!current) return;
    const world = current.region.world, w = waterwaysOf(world)[id], name = String(w?.name ?? "").trim();
    if (!name) return ui.notifications.warn("KG Realms: name the shoreline first: the place takes its name.");
    const same = current.places.find((p) => !followOf(p) && String(p.name).trim().toLowerCase() === name.toLowerCase());
    if (same && await foundry.applications.api.DialogV2.confirm({ window: { title: `${name}: link a place` }, content: `<p>A place called <b>${foundry.utils.escapeHTML(same.name)}</b> (${foundry.utils.escapeHTML(same.class ?? "")}) already exists. Link it to this shoreline? Its border will follow the shoreline. Choose No to make a new place instead.</p>`, rejectClose: false })) {
      await savePlaceEdit(world, same.id, { follow: `shore:${id}`, area: null, areaClosed: null, shape: null });
      return ui.notifications.info(`KG Realms: ${same.name} now follows this shoreline.`);
    }
    const placeId = `added-${foundry.utils.randomID()}`;
    await saveEdits(world, (e) => { e.added = { ...(e.added ?? {}), [placeId]: { id: placeId, ...placeFromShore(id, w) } }; return e; });
    ui.notifications.info(`KG Realms: made the place ${name}, on the Geography layer. Set its card and type in the Places tab.`);
  },
  getWaterways: () => (current ? waterwaysOf(current.region.world) : {}),
  saveWaterways: (fn) => saveWaterways(current.region.world, fn),
  // Shorelines whose water leaks round an open end (shoreWater), by id.
  getLeaks: () => (current ? shoreGrids.get(current.region.world)?.grid?.leaks ?? [] : []),
  prepare: () => current && terrainFor(current.region.world, current.world),
  getSeason: () => currentSeason(),
  // The map's water as the travel panel's route finder has it, for Show the map's water.
  getSea: () => hud.sea
});
const biomes = new BiomeEditor({
  // Outlines a zone can follow, and the place made from or following it.
  getBorderChoices:(self,name)=>current?borderChoices(borderIndex(current.region.world),self,name,{closedOnly:true}):[],
  zonePlace:id=>current?.places.find(p=>p.biomeZone===id||followOf(p)===`biome:${id}`)??null,
  makeZonePlace:async id=>{
    if(!current)return;const world=current.region.world,z=biomesOf(world).zones?.[id];if(!z)return;
    const placeId=`added-${foundry.utils.randomID()}`;
    await saveEdits(world,e=>{e.added={...(e.added??{}),[placeId]:{id:placeId,...placeFromZone(id,z)}};return e;});
    ui.notifications.info(`KG Realms: made the place ${z.name}, on the Geography layer. Its border follows this zone.`);
  },
  getLayer:()=>layer,getBiomes:()=>current?biomesOf(current.region.world):{},getTerrain:loadTerrain,saveBiomes:fn=>current&&saveBiomes(current.region.world,fn)});
// The Snow tab: this world's snow (snowOf), shown on the map as it changes.
const snowTab = new SnowTab({
  snow, getWorld: () => current?.region.world, getSnow: () => snowOf(current?.region.world),
  saveSnow: (fn) => current && saveSnow(current.region.world, fn),
  getSheet: () => ({ width: SOURCE_MAP.width, height: SOURCE_MAP.height, milesPerPixel: SOURCE_MAP.milesPerPixel }),
  getMonths: () => { const c = game.time.calendar, list = c?.monthsArray ?? (Array.isArray(c?.months?.values) ? c.months.values : Object.values(c?.months?.values ?? {})); return list.length ? list.map((m, i) => game.i18n.localize(m?.name ?? `Month ${i + 1}`)) : Array.from({ length: 12 }, (_, i) => `Month ${i + 1}`); },
  hasTerrain: () => !!current?.world?.terrain
});
const editor = new MapEditor({ pins, roads, water, biomes, snow: snowTab, practice: new PracticeTab({ camp: hud.camp }) });
/** Open or close the map editor: the travel panel steps aside, and the edit-only map markings show meanwhile. */
function setMapEditor(on) {
  if (!game.user.isGM || !current) return;
  if (!on) return editor.onClose();
  if (editor.active) return;
  editor.note = hud.stops?.().length > 1 ? "Travel panel hidden while you edit the map" : "";
  hud.suspend(true);
  layer.setEditing(true);
  editor.open();
  const tool = ui.controls?.controls?.tokens?.tools?.kgRealmsEditor;
  if (tool) { tool.active = true; ui.controls?.render(); }
}
editor.onClose = () => {
  hud.suspend(false);
  layer.setEditing(false);
  const tool = ui.controls?.controls?.tokens?.tools?.kgRealmsEditor;
  if (tool) tool.active = false;
  editor.close();
  ui.controls?.render();
};
const card = new PlaceCard({
  isBlocked: () => editor.active || hud.editing, hoverDelayMs: () => setting("hoverDelayMs"), getPlace,
  getTrade: p => current && !/^(river-hazard|encounter):/.test(p.id) ? trade.get(current.region.world, p) : null,
  editTrade: p => current && openTradeEditor({ service: trade, world: current.region.world, place: p, changed: () => cards.refresh() }),
  openCard: id => current && openCard({kind:/^(river-hazard|encounter):/.test(id)?"encounter":"realm",world:current.region.world,id:id.replace(/^(river-hazard|encounter):/,"")})
});
registerKinds(cards, {
  realmPlaces, savePlaceEdit, localMaps, trade, cityTravel,
  // A coastal or riverside settlement is a port unless the GM says otherwise.
  autoPort: (p) => hud.autoPort(p),
  // A place the GM added goes for good; one the module ships is marked removed (kept with its
  // edits, so restoring it in the Places tab brings it back as it was).
  removePlace: (world, id) => saveEdits(world, (w) => {
    if (w.added?.[id]) { delete w.added[id]; delete w.edits?.[id]; return w; }
    w.edits = { ...(w.edits ?? {}), [id]: { ...(w.edits?.[id] ?? {}), removed: true } };
    return w;
  }),
  presetFor: (p) => localMaps.presetFor(p.id, current?.region.world ?? defaultWorldId()),
  setupLocal: (entry) => localMaps.applyPreset(entry, { create: true, world: current?.region.world ?? defaultWorldId() }),
  // Show a spot on the realm map, when one is drawn.
  locate: (lon, lat, place) => { if (!layer.frame || !regionOf(canvas.scene)) return; showLayerOf(place); layer.showSpot(lon, lat, 400); },
  encounters: (world) => encountersOf(world),
  saveEncounters: (world, fn) => saveEncounters(world, fn)
});
/** Places on local maps, for search: every local map of a world, or one scene's. Hidden ones only for the GM. */
function localItems({ world = null, scene = null } = {}) {
  const out = [];
  for (const s of scene ? [scene] : game.scenes) {
    const map = s.getFlag(MODULE_ID, "localMap");
    if (!map || (world && map.world !== world)) continue;
    for (const n of s.notes) {
      const r = n.getFlag(MODULE_ID, "local");
      if (!r) continue;
      out.push({ name: r.name, map: map.name, category: r.category, visibility: game.user.isGM ? "discovered" : r.visibility, sceneId: s.id, noteId: n.id });
    }
  }
  return out;
}
/** The map shows the layer a place is on; encounters and hazards show on them all. */
const showLayerOf = (place) => { const name = place && !String(place.id ?? "").startsWith("river-hazard:") && place.kind !== "encounter" ? placeLayer(place) : null; if (name) layersRail.setLayer(name); };
const search = new RealmSearch({
  getLayer: () => layer,
  showLayer: showLayerOf,
  getData: () => current
    ? { places: [...(regional.links[current.region.world]?current.places:regional.destinations(current.region.world)),...hazardPlaces(current.region.world)], regions: (current.world.regions ?? []).filter((r) => r.level === current.region.level), locals: localItems({ world: current.region.world }) }
    : { places: [], regions: [], locals: localItems({ scene: canvas.scene }) },
  goToLocal: (item) => localMaps.goToPlace(item.sceneId, item.noteId),
  // On a settlement map: its named streets too.
  getStreets: () => current ? [] : streetNames.names(),
  showStreet: (name) => streetNames.show(name)
});
const streetNames = new StreetNames();
streetNames.install();

// Time away from a realm map (away-pause.mjs): its journeys stand still while another scene is the
// active one, and parties split while away join it beside their party when the table comes back.
const awayQueue = { task: Promise.resolve() };
function syncAway(changedScene = null) {
  if (!isPrimaryGM()) return;
  awayQueue.task = awayQueue.task.catch(() => {}).then(async () => {
    await reconcileAway({ isRealm: (s) => !!regionOf(s), sameMap:(a,b)=>(regional.rootScene(a)?.id??a?.id)===(regional.rootScene(b)?.id??b?.id), write: (s, fn) => writeJourney(s, fn) });
    const active = game.scenes.active;
    if (active && regionOf(active) && (!changedScene || changedScene === active)) await placeSplitParties(active, { isRealm: (s) => !!regionOf(s) });
  }).catch((err) => console.warn("kg-realms | away pause:", err));
}
Hooks.once("ready", () => syncAway());
Hooks.on("updateScene", (scene, changes) => { if ("active" in changes) syncAway(scene); });

/* ---------------------------------------- */
/*  Day and night                            */
/* ---------------------------------------- */

function worldHour() {
  const c = game.time.calendar?.timeToComponents?.(game.time.worldTime);
  return c?.hour ?? 12;
}

function currentLook() {
  const look = setting("look");
  if (look !== LOOKS.auto) return look;
  // Follow the scene's darkness (Foundry's, or Calendaria's when it syncs darkness).
  const dark = canvas?.environment?.darknessLevel ?? canvas?.scene?.environment?.darknessLevel;
  if (Number.isFinite(dark)) return dark >= 0.5 ? LOOKS.night : LOOKS.day;
  const h = worldHour();
  return h >= setting("dayStart") && h < setting("nightStart") ? LOOKS.day : LOOKS.night;
}

/* ---------------------------------------- */
/*  Settings                                 */
/* ---------------------------------------- */

Hooks.once("init", () => {
  registerPlaceLinks(cards);
  const register = (key, data) => game.settings.register(MODULE_ID, key, data);
  registerShell();
  registerIconPackSetting(()=>{localMaps.refreshMarkers(globalThis.canvas?.scene,true);localMaps.editor.render();});
  // KTX2 only (0.65.6): kept registered, hidden, so an old choice reads harmlessly; nothing consults it.
  register("localMapRenderer", { scope: "client", config: false, type: String, default: "ktx2" });
  register("primaryGM", { name: "Primary GM", hint: "Owns journey time, movement, shared camp actions and player requests. If the selected GM is offline, the first connected GM in the user list takes over.", scope: "world", config: true, type: String, default: "", choices: primaryGMChoices(), onChange: () => authorityChanged() });
  register("partyActor", { name: "Party token actor", hint: "Drop a group actor from the Actors sidebar or a compendium. Its members are the travelling characters and NPCs. Scene overrides take priority; split parties have separate tokens and travel state.", scope: "world", config: true, type: String, default: "", onChange: () => { if (hud.el) hud.refresh(); syncViewedJourneys(); } });
  const redraw = () => drawRegion();
  register("look", {
    name: "Day and night", hint: "Follow the world clock (Calendaria's, when installed), or keep the map always in day or night. At night the map darkens and settlements light up.",
    scope: "world", config: true, type: String, default: LOOKS.auto,
    choices: { [LOOKS.auto]: "Follow the clock", [LOOKS.day]: "Always day", [LOOKS.night]: "Always night" },
    onChange: () => layer.setLook(currentLook())
  });
  register("dayStart", { name: "Day starts at", hint: "Hour (0 to 23).", scope: "world", config: true, type: Number, default: 6, range: { min: 0, max: 23, step: 1 }, onChange: () => layer.setLook(currentLook()) });
  register("nightStart", { name: "Night starts at", hint: "Hour (0 to 23).", scope: "world", config: true, type: Number, default: 19, range: { min: 0, max: 23, step: 1 }, onChange: () => layer.setLook(currentLook()) });
  register("maxSide", {
    name: "Largest scene side", hint: "The most pixels a region scene may be across or down. A scale that would make a scene larger is made coarser, and scenes already larger are shrunk as the world loads. How large a scene a machine draws well varies; lower this if large scenes crash or stutter.",
    scope: "world", config: true, type: Number, default: MAX_SIDE, range: { min: 8000, max: 80000, step: 1000 }
  });
  register("relief", { name: "Mountain shading", hint: "Shade the land by its height (the atlas's elevation model).", scope: "client", config: false, type: Boolean, default: true, onChange: redraw });
  register('borders', { name: 'Country and region borders', hint: 'Show country and region boundaries as white dotted lines.', scope: 'client', config: false, type: Boolean, default: false, onChange: redraw });
  register("markerScale", { name: "Map marker size", hint: "Scale of place markers on the map (1 is the default).", scope: "client", config: true, type: Number, default: 1, range: { min: 0.5, max: 2.5, step: 0.1 }, onChange: redraw });
  register("labelScale", { name: "Map label size", hint: "Scale of place names on the map (1 is the default).", scope: "client", config: true, type: Number, default: 1, range: { min: 0.5, max: 2.5, step: 0.1 }, onChange: redraw });
  register("hoverDelayMs", { name: "Place card hover delay (ms)", hint: "How long to hold the pointer over a visible place label or marker before its card appears.", scope: "client", config: true, type: Number, default: 750, range: { min: 0, max: 1500, step: 50 } });
  // Names above effects (0.76): names, markers and the journey drawn above the scene's effects, so a
  // region's water filter ripples the sea but not its name. Off: one map, as before (a little lighter).
  register("namesAbove", { name: "Names above effects", hint: "Draws the realm map's names, markers and the journey above the scene's effects (FXMaster region filters, weather), so they stay readable while the land and water under them ripple. Off: everything is drawn as one picture, under the effects, which is a little lighter on the computer.", scope: "client", config: true, type: Boolean, default: true, onChange: redraw });
  register("highDpi", { name: "Sharp map on high-DPI screens", hint: "Draws the map at your screen's full resolution when its scaling is 150% or more.", scope: "client", config: true, type: Boolean, default: true, onChange: redraw });
  register("placeEdits", { scope: "world", config: false, type: Object, default: {}, onChange: () => { regional.networks.clear(); backgroundJourneys.clear(); card.hide(); refreshPlaces(); cards.refresh(); water.refresh(); biomes.refresh(); syncShoreZones().catch((err) => console.warn("kg-realms | shared biome zones:", err)); } });
  register("journalsImported", { scope: "world", config: false, type: Boolean, default: false });
  register("cardRepeatsRemoved", { scope: "world", config: false, type: Boolean, default: false });
  // Travel panel placement, per user (client): -1 until first placed.
  register("seasonalSnow", { name: "Seasonal snow", hint: "Snow on the realm map follows the calendar: full cover near a pole in winter, a patchy band drawing back through spring, the high peaks in summer. Each world's snow lines are set on the map editor's Snow tab. Local maps with a winter picture (Helm's Hold) show it in winter and while it snows.", scope: "world", config: true, type: Boolean, default: true, onChange: () => { attachSnow(); localMaps.applySeasons(); localMapRenderer.refreshSeason(); } });
  register("travelRules", { name: "Travel rules", hint: "2014: off the road, forest, swamp, mountains and ice halve the distance. 2024: terrain caps the pace.", scope: "world", config: true, type: String, default: "2014", choices: { "2014": "D&D 2014", "2024": "D&D 2024" }, onChange: () => hud.refresh() });
  // Prices: the world's money against the book's, from ÷10 ("d10") to ×10 ("x10"), in steps of one.
  const scales = Object.fromEntries([...[10, 9, 8, 7, 6, 5, 4, 3, 2].map((n) => [`d${n}`, `÷${n}${n === 10 ? " (a tenth of the book price)" : ""}`]), ["x1", "×1 (the book price)"], ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => [`x${n}`, `×${n}`])]);
  register("priceScale", { name: "Prices", hint: "Local trade prices and default ship and coach fares use this multiplier. A fare you haggle on a leg stays as you set it.", scope: "world", config: true, type: String, default: "x1", choices: scales, onChange: () => { card.hide(); hud.refresh(); cards.refresh(); refreshTradeEditors(); } });
  register("tradeEdits", { scope: "world", config: false, type: Object, default: {}, onChange: () => { card.hide(); cards.refresh(); } });
  register("travelHudX", { scope: "client", config: false, type: Number, default: -1 });
  register("travelHudY", { scope: "client", config: false, type: Number, default: -1 });
  register("travelHudLocked", { scope: "client", config: false, type: Boolean, default: false });
  // The panels' heights (their grips; 0 fits the content), and where the map editor was left.
  register("travelHudH", { scope: "client", config: false, type: Number, default: 0 });
  register("mapEditorX", { scope: "client", config: false, type: Number, default: -1 });
  register("mapEditorY", { scope: "client", config: false, type: Number, default: -1 });
  register("mapEditorLocked", { scope: "client", config: false, type: Boolean, default: false });
  register("mapEditorH", { scope: "client", config: false, type: Number, default: 0 });
  // Window theme: the colours of every KG Realms window (styles/realms.css).
  // Older choices (Parchment, Foundry) are gone: they fall back to Chocolate.
  const THEMES = { travel: "Chocolate (dark brown and gold)", oxblood: "Oxblood (dark red and gold)", royal: "Royal Blue (blue and gold)", emerald: "Emerald (green and gold)", amethyst: "Amethyst (purple and silver)", iron: "Iron (slate and ember)", holy: "Holy White (light, ivory and old gold)" };
  const applyTheme = (t) => { for (const k of Object.keys(THEMES)) document.body.classList.toggle(`kgr-theme-${k}`, k === t); };
  register("windowTheme", { name: "Window theme", hint: "The colours of KG Realms windows: the travel panel, place cards, editors, search.", scope: "client", config: true, type: String, default: "travel", choices: THEMES, onChange: applyTheme });
  applyTheme(setting("windowTheme"));  register("localPresetsDone", { scope: "world", config: false, type: Array, default: [] });
  register("lookMigrated", { scope: "world", config: false, type: Boolean, default: false });
  register("customMarkers", { scope: "world", config: false, type: Object, default: {}, onChange: () => { pins.refresh(); drawRegion(); } });
  register("routeEdits", { scope: "world", config: false, type: Object, default: {}, onChange: () => refreshRoutes() });
  register("encounters", { scope: "world", config: false, type: Object, default: {}, onChange: () => { refreshEncounters(); cards.refresh(); syncViewedJourneys(); if (canvas.ready) refreshEncounterBox(); } });
  register("encounterDefaultsApplied", {scope:"world", config:false, type:Object, default:{}});
  register("localMapFxEnabled", {scope:"world", config:false, type:Boolean, default:false});
  register("localMapWaterRegions", {name:"Water regions (FXMaster+)",hint:"Performance intensive. Disable if maps load slowly or water effects cause lag.",scope:"world",config:true,type:Boolean,default:true,onChange:async()=>{await enableLocalMapFx().catch(error=>console.warn('kg-realms | Could not enable FXMaster world effects:',error));for(const w of allWorlds())await localMaps.applySceneEffects(w.id);}});
  register("biomes", {scope:"world",config:false,type:Object,default:{},onChange:()=>{refreshPlaces();water.refresh();biomes.refresh();hud.refresh();syncViewedJourneys();syncShoreZones().catch(err=>console.warn("kg-realms | shared biome zones:",err));}});
  register("waterways", { scope: "world", config: false, type: Object, default: {}, onChange: async () => { refreshPlaces(); if(current)layer.setRiverNames(waterwaysOf(current.region.world)); await hud.refresh(); if (current) await terrainFor(current.region.world, current.world).catch(() => null); water.refresh(); refreshSnowGrid(); syncShoreZones().catch((err) => console.warn("kg-realms | shoreline biome zones:", err)); } });
  // Each world's snow (the Snow tab, snow.mjs): { [world]: { north, south, reversed, midwinter, mountains, hills } }.
  register("snow", { scope: "world", config: false, type: Object, default: {}, onChange: () => { if (current) snow.setConfig(snowOf(current.region.world)); snowTab.refresh(); localMaps.applySeasons(); } });
  register("waterwaysOnTop", { scope: "world", config: false, type: Boolean, default: false });
  // Making camp (ui-camp.mjs).
  // Before Advanced watches (0.56.0) foraging had a setting of its own: kept only to carry it over.
  register("forageAtCamp", { scope: "world", config: false, type: Boolean, default: false });
  // Advanced watches (ui-camp.mjs): its own window, Advanced watches in the module settings.
  for (const k of ["advancedWatches", "taskForage", "taskConceal", "taskAlarm"]) register(k, { scope: "world", config: false, type: Boolean, default: false, onChange: () => hud.render() });
  register("campEncounterTable", { scope: "world", config: false, type: String, default: "" });
  register("advancedMigrated", { scope: "world", config: false, type: Boolean, default: false });
  register("rationItem", { scope: "world", config: false, type: String, default: "" });
  game.settings.registerMenu(MODULE_ID, "advancedWatchesMenu", { name: "Advanced watches", label: "Advanced watches", hint: "Camp tasks for the hour before sleep (Watch, Foraging, Concealment, Alarms), the ration item foraging hands out, and the random encounter table for a night in camp.", icon: "fa-solid fa-campground", type: advancedWatchesMenu(), restricted: true });
  register("watchesAtSea", { name: "Watches at sea", hint: "Off: aboard a crewed ship the crew keeps watch and the party sleeps through. On: the party keeps its watch order on a voyage's nights too.", scope: "world", config: true, type: Boolean, default: false, onChange: () => hud.render() });
  register("showPerceptionDC", { name: "Show Perception DC", hint: "Players see the DC of the checks the travel panel asks for (the watcher's Wisdom (Perception) check, the party's at an encounter on the road, and the forager's Wisdom (Survival) check), and the roll's chat card shows success or failure.", scope: "world", config: true, type: Boolean, default: true, onChange: () => hud.render() });
  register("watchBackground", { name: "Watch background", hint: "The picture or video behind the watch change banner, when a new watch begins. A video loops, at 30% volume. Empty: none.", scope: "world", config: true, type: String, filePicker: "imagevideo", default: `modules/${MODULE_ID}/assets/media/kgrestbg.webm` });
  // The GM's checkbox in camp, kept from one encounter to the next.
  register("hideEncounterRolls", { scope: "world", config: false, type: Boolean, default: false, onChange: () => hud.render() });

  game.keybindings.register(MODULE_ID, "search", {
    name: "Search the map", hint: "Find a place or region on a KG Realms map.",
    editable: [{ key: "KeyF", modifiers: ["Control"] }],
    onDown: () => {
      if (!regionOf(canvas.scene) && !canvas.scene?.getFlag(MODULE_ID, "localMap")) return false;
      search.toggle();
      return true;
    }
  });
  game.keybindings.register(MODULE_ID, "mapEditor", {
    name: "Map editor", hint: "Open or close the realm map's editor (places, roads, encounters, waterways). GM only.",
    editable: [{ key: "KeyE" }], restricted: true,
    onDown: () => {
      if (!game.user.isGM || !regionOf(canvas.scene)) return false;
      setMapEditor(!editor.active);
      return true;
    }
  });

  // Realm scenes always zoom out until the whole map fits the screen by its longest side (Foundry's
  // own limit, dimensions.scale.min, is lowered as Zoom/Pan Options does). Further out, the map's
  // whole world (Mercator, at MapLibre's zoom) would no longer reach past the screen's edges when
  // the camera sits at the scene's edge; MapLibre then centres the world instead of following the
  // camera and the map slides against the scene, so zooming stops there.
  // Realm scenes zoom in past Foundry's usual 3x, to the map's finest detail.
  const baseMaxZoom = CONFIG.Canvas.maxZoom ?? 3;
  Hooks.on("canvasInit", (c) => { CONFIG.Canvas.maxZoom = regionOf(c.scene) ? REALM_MAX_ZOOM : baseMaxZoom; });
  const Canvas = foundry.canvas.Canvas;
  const constrain = Canvas.prototype._constrainView;
  Canvas.prototype._constrainView = function (view = {}) {
    const dims = this.dimensions, realm = regionOf(this.scene) && layer.frame;
    if (realm && dims?.scale) {
      const { width, height } = this.app.renderer.screen;
      const fit = Math.min(width / (dims.sceneWidth ?? dims.width), height / (dims.sceneHeight ?? dims.height)) * 0.95;
      dims.scale.min = Math.min(dims.scale.min, fit);
    }
    const out = constrain.call(this, view);
    if (!out || !realm) return out;
    const { width, height } = this.app.renderer.screen;
    const least = worldFloor(layer.frame, dims, width, height);
    return out.scale < least ? { ...out, scale: least } : out;
  };

  layer.onError = (err) => {
    console.warn(`${MODULE_ID} |`, err);
    if (game.user.isGM) ui.notifications.error(`KG Realms: ${err.message}`);
  };

  game.modules.get(MODULE_ID).api = {
    get layer() { return layer; },
    generate: () => openGenerator(),
    /** Local maps: make(scene), settings(scene), convert(scene, place). */
    localMaps,
    parties:{groups:(scene=canvas.scene)=>sceneParties(scene),focus:(id,scene=canvas.scene)=>focusParty(id,scene),split:token=>partyInterface.open(token.document??token),merge:(left,right)=>partyInterface.open(left.document??left,right.document??right)},
    localMapRenderer: { status: () => localMapRenderer.status() },
    settlementTransit:{open:(target,scene=canvas.scene)=>cityTravel.open(scene,target),editRoads:()=>cityTravel.openRoads(),preview:(target,mode='walk',scene=canvas.scene)=>cityTravel.fleet.selected(scene).preview(scene,target,mode),start:(target,options,scene=canvas.scene)=>cityTravel.fleet.selected(scene).start(scene,target,options),status:()=>structuredClone(cityTravel.fleet.state())},
    mapAssets,
    /** Place cards: cards.open({ kind: "realm", world, id } | { kind: "local", scene, note } | { kind: "encounter", world, id }, { edit }). */
    cards,
    biomes: {
      actor:actor=>foundry.utils.deepClone(actor?.getFlag(MODULE_ID,"biome")??null),
      get party(){return foundry.utils.deepClone(hud.currentBiome());},
      types:(world=current?.region.world??defaultWorldId())=>foundry.utils.deepClone(biomeTypes(biomesOf(world))),
      zones:(world=current?.region.world??defaultWorldId())=>foundry.utils.deepClone(biomesOf(world).zones??{}),
      async at(lon,lat,{world=current?.region.world??defaultWorldId()}={}){await loadShippedBiomes(world);const data=await worldWithSheet(world),grid=await terrainFor(world,data),query=biomeLookup(biomesOf(world),(await import("./travel.mjs")).terrainLookup(grid),lonLatToSource);return biomeFlag(query(...lonLatToSource(lon,lat)),{world});},
      sync:()=>hud.syncBiome()
    },
    /** Make a region scene without the dialog: { world, level, bounds, milesPer100, grid, name, view }. */
    generateRegion,
    /** Worlds (worlds.mjs): register one from its own module, and list those registered. */
    regionalMaps: {configure:scene=>regional.configure(scene??canvas.scene), links:()=>structuredClone(regional.links)},
    registerWorld,
    worlds: () => allWorlds(),
    world: (id = defaultWorldId()) => loadWorld(id),
    regionOf,
    latLonToScene: (lat, lon) => (layer.frame ? latLonToScene(layer.frame, lat, lon) : null),
    sceneToLatLon: (x, y) => (layer.frame ? sceneToLatLon(layer.frame, { x, y }) : null),
    /** A lat/lon to scene projection for any region scene, drawn or not. */
    projector(scene) {
      const r = regionOf(scene);
      const rect = scene?.dimensions?.sceneRect;
      if (!r || !rect) return null;
      const frame = makeFrame(r.bounds, rect);
      return (lat, lon) => latLonToScene(frame, lat, lon);
    }
  };
});

/* ---------------------------------------- */
/*  Weather off on region scenes             */
/* ---------------------------------------- */

// Region scenes made before 0.1.1 have Calendaria's weather on, and its sprites over a scene tens of
// thousands of pixels across crash the client as the world loads. At setup (the world's data is
// loaded, the scene not yet drawn) each region scene without a Calendaria weather choice is set to
// off in memory, so this load draws it without weather; the GM saves it once the world is ready.
// A GM who turns weather back on in Calendaria's scene settings keeps it.
//
// Scenes larger than the "Largest scene side" setting are
// shrunk the same way, before they are drawn: a coarser scale, the same area of the world (the map
// is drawn from it, so it stays right), and the scene's tokens, notes, drawings, tiles, lights and
// sounds moved with it.
//
// The changes are made in memory at setup and written once the world is ready, with diff off:
// Foundry otherwise compares against memory, finds nothing changed, and saves nothing.
const repairs = []; // { scene, data, embedded: { Token: [{ _id, ... }], ... }, weather, shrunk }
let repaired = false;
/**
 * Once, the first time the canvas draws (the world's scenes are loaded by then, and nothing is
 * drawn yet; the "setup" hook comes before the scenes are loaded).
 */
function repairScenes() {
  if (repaired || !game.scenes) return;
  repaired = true;
  for (const scene of game.scenes) {
    const region = regionOf(scene);
    if (!region) continue;
    const data = {}, embedded = {};
    // Weather is no longer turned off on region scenes; heavy effects are filtered instead.
    const weather = false;
    const expanded = region.world === "toril" && region.level === "surface" && region.version < 2
      && region.bounds.west === -82 && region.bounds.east === -27 && region.bounds.south === 6 && region.bounds.north === 58;
    const bounds = expanded ? { ...region.bounds, west: -84 } : region.bounds;
    // Every realm scene is kept at the one scale (generator.mjs SCALE).
    const shrunk = region.milesPer100 !== SCALE || Math.max(scene.width, scene.height) > maxSide();
    if (shrunk || expanded) {
      const miles = SCALE;
      const { width, height } = sceneSizeAt(bounds, miles);
      const size = scene.grid.size, pad = scene.padding;
      const offset = (w, h) => [Math.ceil((w * pad) / size) * size, Math.ceil((h * pad) / size) * size];
      const [ox, oy] = offset(scene.width, scene.height), [nx, ny] = offset(width, height);
      const oldFrame = makeFrame(region.bounds, { x: ox, y: oy, width: scene.width, height: scene.height });
      const newFrame = makeFrame(bounds, { x: nx, y: ny, width, height });
      const f = newFrame.kx / oldFrame.kx;
      const fy = newFrame.ky / oldFrame.ky;
      const at = (x, y) => {
        const ll = sceneToLatLon(oldFrame, { x, y }), p = latLonToScene(newFrame, ll.lat, ll.lon);
        return [p.x, p.y];
      };
      foundry.utils.mergeObject(data, {
        width, height, grid: { distance: miles },
        initial: { x: width / 2, y: height / 2, scale: Math.max(0.05, Math.min(1, 1600 / Math.max(width, height))) },
        flags: { [MODULE_ID]: { milesPer100: miles, ...(expanded ? { bounds, version: 2 } : {}) } }
      });
      for (const [name, coll, sized] of [["Token", scene.tokens, false], ["Note", scene.notes, false], ["Drawing", scene.drawings, true], ["Tile", scene.tiles, true], ["AmbientLight", scene.lights, false], ["AmbientSound", scene.sounds, false]]) {
        if (!coll?.size) continue;
        embedded[name] = coll.contents.map((d) => {
          const [x, y] = at(d.x, d.y);
          const u = { _id: d.id, x, y };
          if (sized && d.width != null) Object.assign(u, { width: d.width * f, height: d.height * fy });
          if (sized && d.shape?.width != null) u.shape = scaledDrawingShape(d.shape, f, fy);
          return u;
        });
      }
    }
    if (!weather && !shrunk && !expanded) continue;
    scene.updateSource(data);
    for (const [name, list] of Object.entries(embedded)) for (const u of list) scene.getEmbeddedDocument(name, u._id)?.updateSource(u);
    repairs.push({ scene, data, embedded, weather, shrunk, expanded });
  }
}
Hooks.once("init", () => {
  const Canvas = foundry.canvas.Canvas;
  const draw = Canvas.prototype.draw;
  Canvas.prototype.draw = function (...args) {
    try { repairScenes(); } catch (err) { console.error(`${MODULE_ID} | repairing region scenes`, err); }
    return draw.apply(this, args);
  };
});
// KG Realms is the engine: with no world module installed there is nothing to draw.
Hooks.once("ready", () => {
  if (game.user.isGM && !allWorlds().length) ui.notifications.warn("KG Realms has no world to draw. Install and enable a world module, such as KG Realms: Faerûn, or right-click a scene with a map picture and choose Make realm world.", { permanent: true });
});
Hooks.once("ready", () => {
  applySceneAmbience((s) => !!regionOf(s), (s) => !!s.getFlag(MODULE_ID, "localMap"))
    .catch((err) => console.error(`${MODULE_ID} | setting scene ambience`, err));
});
Hooks.once("ready", async () => {
  repairScenes();
  if (!game.user.isGM || !repairs.length) return;
  for (const { scene, data, embedded } of repairs) {
    await scene.update(data, { diff: false, render: false });
    for (const [name, list] of Object.entries(embedded)) await scene.updateEmbeddedDocuments(name, list, { diff: false, render: false });
  }
  const shrunk = repairs.filter((r) => r.shrunk).map((r) => `${r.scene.name} (now 100 px = ${r.scene.getFlag(MODULE_ID, "milesPer100")} mi)`);
  const weather = repairs.filter((r) => r.weather).length;
  const expanded = repairs.filter((r) => r.expanded).length;
  if (shrunk.length) ui.notifications.info(`KG Realms: converted to 100 px = ${SCALE} mi, with tokens, notes, drawings, tiles, lights and sounds moved to the same places on the map: ${shrunk.map((r) => r.split(" (")[0]).join(", ")}.`, { permanent: true });
  // The canvas was drawn while the scene was being changed: draw it again from the saved scene.
  if (repairs.some((r) => (r.shrunk || r.expanded) && r.scene === canvas.scene)) await canvas.draw();
  if (expanded) ui.notifications.info(`KG Realms: extended ${expanded} full Faerûn scene(s) west to include the Moonshae Isles.`);
  if (weather) ui.notifications.info(`KG Realms: weather effects turned off on ${weather} region scene(s). Turn them back on in a scene's Calendaria settings if you want them.`);
});

/* ---------------------------------------- */
/*  Drawing                                  */
/* ---------------------------------------- */

async function drawRegion() {
  teardown();
  const scene = canvas.scene;
  const region = regionOf(scene);
  if (!canvas.ready || !region) return;
  let world;
  try {
    world = await loadWorld(region.world);
    await regional.prepare(region.world);
    // This world's map sheet, for everything drawn from here (source-map.mjs).
    applySourceMap(world.sourceMap);
  } catch (err) {
    return layer.onError(err);
  }
  // The module's waterways, under the world's own (the waterways editor and the travel panel).
  await loadShippedWaterways(region.world);
  await loadShippedBiomes(region.world);
  if (canvas.scene !== scene) return;
  current = { scene, region, world, places: [] };
  current.places = placesFor(region.world, world.places, region.level);
  layer.places = placesGeoJSON(current.places, outlinedIds(current.places, world.regions));
  layer.areas = areasGeoJSON(current.places, world.regions);
  layer.mapLayer = chosenLayer();
  if (world.routes) {
    current.routesBase = await fetch(worldUrl(region.world, world.routes)).then((r) => r.json()).catch(() => null);
    if (current?.scene !== scene) return;
    current.routes = current.routesBase ? applyRouteEdits(current.routesBase, routeEditsOf(region.world)) : null;
    current.drawn = curved(current.routes);
    layer.routes = current.drawn;
  }
  const terrain=await mapAssets.prepare({world:region.world,sourceMap:world.sourceMap});
  if(current?.scene!==scene)return;
  await layer.draw({
    terrain,
    world: region.world, level: region.level, bounds: world.sourceMap?.bounds ?? region.bounds,
    look: currentLook(), relief: setting("relief"), regions: world.regions, ground: 'tapestry', borders: setting('borders'),
    sharp: setting("highDpi") && window.devicePixelRatio >= 1.5,
    namesAbove: setting("namesAbove") !== false,
    markerScale: setting("markerScale"), labelScale: setting("labelScale"),
    // The map darkens itself only for "always night"; following the clock, Foundry's darkness does it.
    dim: () => setting("look") === LOOKS.night, customMarkers: () => moduleMarkers(shippedMarkers(), setting("customMarkers") ?? {}),
    attribution: world.source,
      detail: world.detail,
      sourceMap: world.sourceMap,
      groundGeometry: world.ground ? Object.fromEntries(["land", "water", "cover", "rivers", "borders", "roads", "trails", "cliffs", "nature", "forests", "frame"].filter((k) => world.ground[k]).map((k) => [k, worldUrl(region.world, world.ground[k])])) : null
  });
  if (current?.scene !== scene) return;
  mapAssets.afterDraw();
  refreshEncounters();
  layer.setRiverNames(waterwaysOf(current.region.world));
  journeyLight.attach(layer.frame);
  journeyLight.setRoutes(current.drawn);
  hud.mount();
  layersRail.mount();
  nightLights.draw(current.places, layer.frame);
  attachSnow();
  // The edit-only markings (hidden places ringed, edited names coloured) show only in the map editor.
  layer.setEditing(false);
  card.attach(layer);
  // Back from a local map: centre on its place.
  const focusId = localMaps.takeRealmFocus(scene.id), focus = focusId ? getPlace(focusId) : null;
  if (focus) { const c = latLonToScene(layer.frame, focus.lat, focus.lon); canvas.animatePan({ x: c.x, y: c.y, scale: Math.max(canvas.stage.scale.x, 1.5), duration: 500 }); }
}

/**
 * A world's snow (snow.mjs): the GM's settings for it (the Snow tab) over what its module ships
 * (its definition's snow; Toril's month-by-month line from KG Realms: Faerûn).
 */
function snowOf(worldId) {
  const def = worldDef(worldId);
  return snowConfig((setting("snow") ?? {})[worldId], def?.snow ?? (worldId === "toril" ? TORIL_SNOW : undefined));
}
async function saveSnow(worldId, fn) {
  const all = foundry.utils.deepClone(setting("snow") ?? {});
  all[worldId] = fn(foundry.utils.deepClone(all[worldId] ?? {}));
  await game.settings.set(MODULE_ID, "snow", all);
}
const monthCount = () => { const c = game.time.calendar; return c?.monthsArray?.length || (Array.isArray(c?.months?.values) ? c.months.values.length : Object.keys(c?.months?.values ?? {}).length) || 12; };
/** Today's snow lines on a world's map (the drawn world's sheet), or null when snow is off. */
function snowToday(worldId) {
  if (!setting("seasonalSnow") || !SOURCE_MAP?.height) return null;
  return snowLines(yearFraction(game.time.components, game.time.calendar), snowOf(worldId), { height: SOURCE_MAP.height, milesPerPixel: SOURCE_MAP.milesPerPixel, months: monthCount() });
}

/** Seasonal snow on the map, from the world's terrain grid, its snow settings and the date. */
async function attachSnow() {
  snow.detach();
  const region = current, world = region?.world;
  if (!world?.sourceMap || !layer.map || !setting("seasonalSnow")) return;
  const grid = await terrainFor(region.region.world, world).catch((err) => { console.warn("kg-realms | seasonal snow is off:", err); return null; });
  if (!grid || current !== region || !layer.map) return;
  snow.attach(layer, {
    grid, config: snowOf(region.region.world), sheet: { height: world.sourceMap.height, milesPerPixel: world.sourceMap.milesPerPixel },
    toSheet: (lon, lat) => lonLatToSource(lon, lat),
    // "Always night" darkens the map itself; judge colours as they are by day.
    gain: () => (setting("look") === LOOKS.night ? 1 / 0.42 : 1)
  }).catch((err) => console.warn("kg-realms | seasonal snow is off:", err));
}
/** Shorelines changed: snow follows the new water. */
async function refreshSnowGrid() {
  const region = current;
  if (!region?.world?.sourceMap || !snow.map) return;
  const grid = await terrainFor(region.region.world, region.world).catch(() => null);
  if (grid && current === region) snow.setGrid(grid);
}

// The layers rail on the travel panel's edge (ui-layers.mjs): which layer the map shows, this viewer's own.
const layersRail = new LayersRail({ getPanel: () => hud.el, onChange: (name) => layer.setMapLayer(name) });

function teardown() {
  travelBounce.stop();
  journeyLight.destroy();
  nightLights.destroy();
  snow.detach();
  editor.close();
  hud.unmount();
  layersRail.unmount();
  card.detach();
  search.close();
  layer.destroy();
  current = null;
}

Hooks.on("canvasReady", () => { drawRegion(); enforceWeatherFilter(regionOf); refreshEncounterBox(); });
Hooks.once("ready", () => installWeatherFilter(regionOf));
Hooks.on("updateUser", (user, changes, _options, userId) => receiveCampMessage(user, changes, userId, (message, sender) => hud.camp.onMessage(message, sender)));
// Explicit journey sync requests are read-only requests; only the primary GM writes state.
Hooks.once("ready", () => game.socket.on(`module.${MODULE_ID}`, (m, userId) => {
  if (m?.type === "request-sync") {
    const user = game.users.get(userId ?? m.user), scene = game.scenes.get(m.scene);
    if (isPrimaryGM() && user?.active && scene && regionOf(scene)) syncJourney(scene, { force: true });
    return;
  }
  // Camp changes arrive through authenticated User document updates.
}));
Hooks.once("ready", () => migrateWaterways().catch((err) => console.warn(`${MODULE_ID} | waterways migration:`, err)));
// A check the camp asked for, rolled (or raised by a Tenacity spend): the GM's panel follows its chat card.
Hooks.on("createChatMessage", (m) => hud.camp.onRoll(m));
Hooks.on("updateChatMessage", (m) => hud.camp.onRoll(m));
// Read-only, only when a check is made. Works on encounter scenes too, without routing or polling.
function* activeCampChecks() {
  for (const real of game.scenes) for(const scene of journeyScenes(real)) {
    if(scene.partyId&&focusedScene(real)!==scene)continue;
    const j = scene.getFlag(MODULE_ID, "journey"), p = j?.now;
    if (!j?.trip || !j.watch?.campId || !p || !(p.status === "resting" || p.camp) || !/^w\d+$/.test(j.watch.scene?.step ?? "")) continue;
    const probe = new TravelHud({ getScene: () => scene, headless: true });
    yield { camp: probe.camp, progress: p };
  }
}
Hooks.on("dnd5e.preRollAbilityCheckV2", (config) => { applyWatchFatigue(config, activeCampChecks()); });
Hooks.on("renderChatMessageHTML", (message, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  root?.querySelectorAll("[data-kgr-camp-roll]").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try { await rollCampRequest(JSON.parse(button.dataset.kgrCampRoll), { showDC: game.modules.get("tenacity")?.active || setting("showPerceptionDC") }); }
    catch (err) { console.warn("kg-realms | camp roll request:", err); }
    finally { if (button.isConnected) button.disabled = false; }
  }));
});
// Show Perception DC is always on while Tenacity is active: the box is ticked and locked, and says why.
Hooks.on("renderSettingsConfig", (app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (game.user.isGM) partyPicker(root?.querySelector(`[name="${MODULE_ID}.partyActor"]`));
  const gm = root?.querySelector(`[name="${MODULE_ID}.primaryGM"]`);
  if (gm) {
    const value = setting("primaryGM");
    gm.replaceChildren(...Object.entries(primaryGMChoices()).map(([id, name]) => new Option(name, id, false, id === value)));
  }
  if (!game.modules.get("tenacity")?.active) return;
  const input = root?.querySelector(`[name="${MODULE_ID}.showPerceptionDC"]`);
  if (!input || input.disabled) return;
  input.checked = true;
  input.disabled = true;
  const note = document.createElement("p");
  note.className = "hint";
  note.textContent = "Always on: Tenacity is active, so players can see what a spend needs.";
  input.closest(".form-group")?.append(note);
});
Hooks.on("renderSceneConfig", (app, html) => {
  if (!game.user.isGM) return;
  const scene = app.document ?? app.object, root = html instanceof HTMLElement ? html : html?.[0];
  scenePartyPicker(root, scene);
  sceneMapPicture(root, scene);
});
// Once (0.56.0): a world that foraged at camp keeps foraging, now a task of Advanced watches.
Hooks.once("ready", async () => {
  if (!isPrimaryGM() || setting("advancedMigrated")) return;
  if (setting("forageAtCamp")) { await game.settings.set(MODULE_ID, "advancedWatches", true); await game.settings.set(MODULE_ID, "taskForage", true); }
  await game.settings.set(MODULE_ID, "advancedMigrated", true);
});
// A character's speed or load changed (an item picked up or dropped): the travel panel's speed and
// its encumbered warning follow.
const partyChanged = foundry.utils.debounce(() => {
  syncViewedJourneys();
  if (!hud.el) return;
  // A speed other than the route was worked out with changes its days; else only the line.
  if (hud.routeFeet != null && (hud.speed().feet !== hud.routeFeet || JSON.stringify(hud.favoredTerrains()) !== hud.routeFavored)) hud.refresh(); else hud.render();
}, 200);
Hooks.on("updateUser", (_user, changes) => { if ("character" in changes) partyChanged(); });
const partyMoved = foundry.utils.debounce(() => { if(!current)return;if(hud.el&&!hud.state.trip)hud.refresh();else hud.syncBiome(); }, 120);
for (const h of ["updateActor", "createItem", "updateItem", "deleteItem", "createActiveEffect", "deleteActiveEffect"]) Hooks.on(h, (doc,changes) => { if(h==="updateActor"&&onlyBiomeFlagChanged(changes))return;const a = doc?.documentName === "Actor" ? doc : doc?.parent ?? doc?.actor; if (a?.type === "character" || a?.type === "group") partyChanged(); });
Hooks.once("ready", async () => {
  if (!game.user.isGM || setting("lookMigrated")) return;
  if (setting("look") === LOOKS.day) await game.settings.set(MODULE_ID, "look", LOOKS.auto);
  await game.settings.set(MODULE_ID, "lookMigrated", true);
});
Hooks.on("canvasTearDown", () => teardown());
Hooks.on("canvasPan", () => { layer.update(); editor.viewChanged(); });
Hooks.on("updateScene", (scene, changes) => {
  const own=changes.flags?.[MODULE_ID]??{};
  if('partyFocus' in own && (scene===canvas.scene||scene.id===hud.scene?.id)){hud.mount();syncJourney(scene,{force:true});return;}
  if('partyJourneys' in own){
    if((scene===canvas.scene||scene.id===hud.scene?.id)&&hud.el){const change=own.partyJourneys?.[hud.scene.partyId];if(change){if(needsRouteRefresh(change))hud.refresh();else if(Object.keys(change).some(k=>k!=='now'))hud.refreshProgress();else hud.tick();}else hud.render();}
    if(isPrimaryGM()&&Object.values(own.partyJourneys??{}).some(v=>Object.keys(v??{}).some(k=>k!=='now')))syncJourney(scene);
    refreshEncounterBox();return;
  }
  // A journey's encounters, or where it waits, changed: the encounter box on another scene follows.
  if (scene !== canvas.scene && foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.journey`)) {
    refreshEncounterBox();
    const j = changes.flags[MODULE_ID].journey ?? {};
    if (Object.keys(j).some((k) => k !== "now") && Array.from(game.users).some((u) => u.active && u.viewedScene === scene.id)) syncJourney(scene);
  }
  if ((scene === canvas.scene || scene.id===hud.scene?.id) && foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.journey`)) {
    // The GM's progress note alone needs a redraw, not a new plan.
    const j = changes.flags[MODULE_ID].journey ?? {};
    if (needsRouteRefresh(j)) return hud.refresh();
    return Object.keys(j).some((k) => ["encounters", "trip", "rest"].includes(k)) ? hud.refreshProgress() : hud.tick();
  }
  if (scene === canvas.scene && flagsNeedRedraw(own)) drawRegion();
});
Hooks.on("updateToken", (doc, changes, options) => {
  if (options?.kgRealmsTravel) travelBounce.start(doc, options.animation?.duration ?? 0);
  if (doc.parent !== canvas.scene || !("x" in changes || "y" in changes) || hud.state.trip) return;
  if (hud.partyTokens()[0]?.document?.id === doc.id) partyMoved();
});
Hooks.on("lightingRefresh", () => { if (setting("look") === LOOKS.auto && layer.options && layer.options.look !== currentLook()) layer.setLook(currentLook()); });
Hooks.on("updateWorldTime", () => {
  if (setting("look") === LOOKS.auto) layer.setLook(currentLook());
  // The snow line moves with the date, and seasonal local maps with it.
  snow.setDate();
  localMaps.applySeasons();
  // The party travels with the clock.
  if (current && hud.el && (!isPrimaryGM()||!current.scene.getFlag(MODULE_ID,'partyJourneys'))) hud.tick();
  if (isPrimaryGM()) syncViewedJourneys();
});

/* ---------------------------------------- */
/*  Scene controls and the Scenes sidebar    */
/* ---------------------------------------- */

Hooks.on("getSceneControlButtons", (controls) => {
  // A local map: search its places.
  if (!regionOf(canvas.scene) && canvas.scene?.getFlag(MODULE_ID, "localMap") && controls.tokens) {
    controls.tokens.tools.kgRealmsSearch = { name: "kgRealmsSearch", title: "Search this map's places (Ctrl+F)", icon: "fa-solid fa-magnifying-glass-location", order: 100, button: true, onChange: () => search.toggle() };
    return;
  }
  if (!regionOf(canvas.scene)) return;
  if (controls.tokens) {
    controls.tokens.tools.kgRealmsSearch = {
      name: "kgRealmsSearch", title: "Search the map (Ctrl+F)", icon: "fa-solid fa-magnifying-glass-location",
      order: 100, button: true, onChange: () => search.toggle()
    };
    controls.tokens.tools.kgRealmsTravel = {
      name: "kgRealmsTravel", title: "Travel", icon: "fa-solid fa-person-hiking",
      order: 101, button: true, onChange: () => planner.open()
    };
    if(game.user.isGM) controls.tokens.tools.kgRealmsRegions={name:"kgRealmsRegions",title:"Regional maps: link and configure detailed maps",icon:"fa-solid fa-map-location-dot",order:104,button:true,onChange:()=>regional.manage(canvas.scene).catch(e=>ui.notifications.error(e.message))};
    // The GM's map editor, beside Search and Travel (E opens and closes it too).
    if (game.user.isGM) controls.tokens.tools.kgRealmsEditor = {
      name: "kgRealmsEditor", title: "Map editor: places, roads, encounters (E)", icon: "fa-solid fa-pen-ruler",
      order: 102, toggle: true, active: editor.active, onChange: (event, active) => setMapEditor(active)
    };
  }
});

Hooks.on("renderSceneDirectory", (app, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector(".kg-realms-generate-button")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "kg-realms-generate-button";
  const one = allWorlds().length === 1 ? allWorlds()[0] : null;
  button.innerHTML = `<i class="fa-solid fa-map"></i> Generate ${one ? (one.mapName ?? one.title) : "world map"}`;
  button.addEventListener("click", () => openGenerator());
  const actions = root.querySelector(".header-actions") ?? root.querySelector(".directory-header") ?? root;
  actions.append(button);
});
