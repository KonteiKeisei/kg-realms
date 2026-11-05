import {RealmDialog} from "./ui-theme.mjs";
import { aspect } from "./geo.mjs";
import { worldUrl, defaultWorldId, allWorlds } from "./worlds.mjs";
import {openSceneChecklist} from './module-scenes.mjs';
import { SOURCE_MAP } from './source-map.mjs';
import { REALM_DARK_AMBIENCE, REALM_AMBIENCE_REVISION } from "./scene-ambience.mjs";

const MODULE_ID = "kg-realms";
/** Bumped when the scene flag changes shape. */
export const DATA_VERSION = 3;
/**
 * The one scale: 100 px = 20 miles. The map is drawn from its tiles at screen resolution whatever
 * the scene size, so a small scene (about 19,000 px across) loses no detail, and it keeps weather
 * particles, lighting and vision cheap. Realm scenes may zoom past Foundry's 3x to reach full detail.
 */
export const SCALE = 20;
export const SCALES = [SCALE];
/**
 * The largest scene side, in pixels, by default: the "Largest scene side" setting (what a given
 * machine draws well varies; very large scenes with weather effects on have crashed clients).
 */
export const MAX_SIDE = 80000;
/** The setting's value when Foundry is running, else the default. */
export const maxSide = () => Number(globalThis.game?.settings?.get?.(MODULE_ID, "maxSide")) || MAX_SIDE;
/** The finest scale (miles per 100 px) at or above `want` that keeps a scene of these bounds within the largest side. */
export function fittingScale(bounds, want = SCALES[0], limit = maxSide()) {
  return SCALES.find((s) => s >= want && Math.max(...Object.values(sceneSizeAt(bounds, s))) <= limit) ?? SCALES.at(-1);
}
const METRES_PER_MILE = 1609.344;

export const WORLDS = { toril: { id: "toril", name: "Toril (Forgotten Realms)" } };
/** Whole continents, each with its own scale: Faerûn from the Moonshaes to Thay, Chult to the Great Glacier. */
export const CONTINENTS = {
  // High-resolution reference coverage, including one native tile of padding.
  faerun: { name: "Faerûn", level: "surface", bounds: SOURCE_MAP.bounds, milesPer100: SCALE }
};

const indexes = new Map();
/** Forget a world's index so the next load reads it again (a homebrew world's settings changed). */
export function forgetWorld(id) { indexes.delete(id); }

/** A world's index: { regions, places, notice, source }. */
export async function loadWorld(id = defaultWorldId()) {
  if(!allWorlds().length)throw Error('No realm map is available. Create a realm map from a scene picture or enable a companion realm module.');
  if (!indexes.has(id)) {
    // Revalidated: a homebrew world's index is rewritten in place (its settings, 0.74.2's move).
    indexes.set(id, fetch(worldUrl(id, "index.json"), { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error('The realm map data could not be loaded. Enable its companion module or recreate the realm map.');
      return r.json();
    }));
  }
  return indexes.get(id).catch((err) => { indexes.delete(id); throw err; });
}

/** Width and height of a lat/lon box in miles (width at its middle latitude). */
export function boxMiles(b) {
  if(b.mapWidthMiles)return {wide:b.mapWidthMiles,tall:b.mapWidthMiles*aspect(b)};
  const mid = ((b.north + b.south) / 2) * (Math.PI / 180);
  const wide = ((b.east - b.west) * Math.cos(mid) * 111320) / METRES_PER_MILE;
  return { wide, tall: ((b.north - b.south) * 111320) / METRES_PER_MILE };
}

/** Scene size in pixels at so many miles per 100 px, shaped like the box on the map. */
export function sceneSizeAt(bounds, milesPer100) {
  const { wide } = boxMiles(bounds);
  const width = Math.round((wide / milesPer100) * 100);
  return { width, height: Math.round(width * aspect(bounds)) };
}

/** The finest scale on the list that keeps the scene's longer side under MAX_SIDE. */
export function autoScale(bounds) {
  return fittingScale(bounds);
}

/* ---------------------------------------- */
/*  Dialog                                   */
/* ---------------------------------------- */

/** The whole-map dialog's text: the scene a world's main map makes. */
export function faerunGeneratorContent(bounds = SOURCE_MAP.bounds, mapName = "Faerun") {
  const { width, height } = sceneSizeAt(bounds, SCALE);
  return `<p>Generate the ${mapName} map: ${width.toLocaleString()} x ${height.toLocaleString()} px, 100 px = ${SCALE} mi.</p>`;
}

/** A world's main map: its name (its definition's mapName, else its title) and its area. */
export function mainMapOf(def, index) {
  return { name: def?.mapName ?? def?.title ?? "World", bounds: index?.mainMap?.bounds ?? index?.faerun?.bounds ?? index?.sourceMap?.bounds ?? CONTINENTS.faerun.bounds };
}

export const generatorWorlds = () => allWorlds().filter(w=>w.module!==MODULE_ID&&!w.homebrew&&w.sceneTemplates?.role!=='regional'&&globalThis.game?.modules?.get(w.module)?.active);

export function renderGeneratorButton(root){
  if(!root)return;
  const available=generatorWorlds(),existing=root.querySelector('.kg-realms-generate-button');
  if(!game.user.isGM||!available.length){existing?.remove();return;}
  const button=existing??document.createElement('button');button.type='button';button.className='kg-realms-generate-button';
  const one=available.length===1?available[0]:null;
  button.innerHTML=`<i class="fa-solid fa-map"></i> Generate ${foundry.utils.escapeHTML(one?(one.mapName??one.title):'world map')}`;
  if(!existing){button.addEventListener('click',()=>openGenerator());(root.querySelector('.header-actions')??root.querySelector('.directory-header')??root).append(button);}
}

export async function openGenerator() {
  if (!game.user.isGM) return;
  // With several worlds registered, the GM picks one; else the one there is (worlds.mjs).
  const worlds = generatorWorlds();
  if (!worlds.length) return ui.notifications.warn('KG Realms: enable a companion realm module to generate its maps. To make your own realm, right-click a scene with a map picture and choose Make realm world.');
  let def = worlds[0];
  if (worlds.length > 1) {
    const id = await RealmDialog.wait({
      window: { title: "Generate a world map", icon: "fa-solid fa-map" }, rejectClose: false,
      content: `<p>Which world?</p>`,
      buttons: worlds.map((w, i) => ({ action: w.id, label: w.mapName ?? w.title, default: i === 0, callback: () => w.id }))
    });
    def = worlds.find((w) => w.id === id); if (!def) return;
  }
  if(def.sceneTemplates?.schema===1&&def.sceneTemplates.root){try{return await openSceneChecklist(def);}catch(error){ui.notifications.error(`KG Realms: ${error.message}`);return null;}}
  let index;
  try { index = await loadWorld(def.id); }
  catch (err) { return ui.notifications.error(`KG Realms: ${err.message}`); }
  const { name, bounds } = mainMapOf(def, index);
  const result = await RealmDialog.wait({
    window: { title: `Generate ${name}`, icon: 'fa-solid fa-map' },
    classes: ['kg-realms-generate'], content: faerunGeneratorContent(bounds, name), rejectClose: false,
    position: { width: 420 },
    buttons: [
      { action: 'go', label: 'Generate scene', icon: 'fa-solid fa-map', default: true, callback: () => SCALE },
      { action: 'cancel', label: 'Cancel' }
    ]
  });
  if (result !== SCALE) return;
  const scale = SCALE;
  return generateRegion({ world: def.id, level: 'surface', bounds, milesPer100: scale, grid: 'none', name: `${name} (${scale} mi per 100 px)` });
}
/* ---------------------------------------- */
/*  Scene                                    */
/* ---------------------------------------- */

/** A new region scene: gridless (or hexes/squares) at the chosen scale, the map drawn live. */
/**
 * Flags for a region scene beyond KG Realms' own: Calendaria's weather effects off. A scene tens of
 * thousands of pixels across fills with weather sprites and can crash the client; the GM can turn
 * them back on in the scene's Calendaria settings.
 */
// Calendaria weather stays on; heavy effects are filtered on realm maps (weather-filter.mjs).
export const REGION_SCENE_FLAGS = {};

export async function generateRegion({ world = defaultWorldId(), level = "surface", bounds, milesPer100, grid = "none", name, view = false }) {
  // Never larger than Foundry can draw: a coarser scale when the asked one would be.
  milesPer100 = fittingScale(bounds, milesPer100);
  const { width, height } = sceneSizeAt(bounds, milesPer100);
  const type = { none: CONST.GRID_TYPES.GRIDLESS, hex: CONST.GRID_TYPES.HEXODDQ, square: CONST.GRID_TYPES.SQUARE }[grid] ?? CONST.GRID_TYPES.GRIDLESS;
  const scene = await Scene.implementation.create({
    name, width, height, padding: 0.1,
    backgroundColor: "#000000",
    grid: { type, size: 100, distance: milesPer100, units: "mi", alpha: 0.25, color: "#3b2a1a" },
    tokenVision: false,
    fog: { exploration: false },
    weather: "",
    environment: { dark: REALM_DARK_AMBIENCE },
    initial: { x: width / 2, y: height / 2, scale: Math.max(0.05, Math.min(1, 1600 / Math.max(width, height))) },
    flags: { ...REGION_SCENE_FLAGS, [MODULE_ID]: { world, level, bounds, milesPer100, version: DATA_VERSION, darkAmbience: REALM_AMBIENCE_REVISION } }
  });
  // Not opened: a large scene is the GM's to open when ready (the Scenes sidebar).
  ui.notifications.info(`KG Realms: scene "${scene.name}" created (${width.toLocaleString()} x ${height.toLocaleString()} px, 100 px = ${milesPer100} mi). Open it from the Scenes sidebar.`);
  if (view) await scene.view();
  return scene;
}
