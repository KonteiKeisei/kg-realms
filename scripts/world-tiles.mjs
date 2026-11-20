// A companion world's own map tiles (0.97.5). A world module's tiles live in its module folder, which
// Foundry replaces on every update, so tiles the GM regenerates for it are saved in this game world's
// folder under KG Realms Data instead, and read from there in place of the module's. Made-here worlds
// keep theirs in their own data folder as before (homebrew.mjs).
//
// The world setting worldTiles: { [world id]: { folder, src, made, moduleVersion, modulePack } }:
// folder holds terrain-pack.json and the tiles its paths name; modulePack is the fingerprint of the
// module's tile list the tiles replaced (a module update with new tiles is noticed once).
import { worldPath } from "./worlds.mjs";

const ID = "kg-realms", KEY = "worldTiles";
export const TILE_HOME = "KG Realms Data/World Tiles";

export function registerWorldTiles(onChange) {
  game.settings.register(ID, KEY, { scope: "world", config: false, type: Object, default: {}, onChange: () => onChange?.() });
}

const records = () => { try { return game.settings.get(ID, KEY) ?? {}; } catch { return {}; } };
/** A world's own tiles record, or null when it uses its module's. */
export const ownTiles = (id) => records()[id] ?? null;

/** The folder a world's own tiles go in: this game world's, so two game worlds never share them. */
export const ownTilesFolder = (id, gameWorld = globalThis.game?.world?.id ?? "world") => `${TILE_HOME}/${gameWorld}/${id}`;

/**
 * Where a world's map tiles are: { pack (terrain-pack.json, a path from the Foundry root), base (the
 * folder tile paths start from), own (the record, or null) }. Every reader of the tiles goes through
 * this: the map, the map files download, regenerating, and Export as module.
 */
export function terrainSource(world, own = ownTiles(world?.id)) {
  if (own?.folder && !world?.homebrew) return { pack: `${own.folder}/terrain-pack.json`, base: own.folder, own };
  return { pack: worldPath(world.id, world.terrainPack ?? "terrain-pack.json"), base: world.assetBase ?? `modules/${world.module}`, own: null };
}

/** A path from the Foundry root as a URL to fetch (routed when Foundry is there). */
export const routed = (path) => (globalThis.foundry?.utils?.getRoute ? foundry.utils.getRoute(path) : path);

/** Save a world's own tiles record; null goes back to the module's tiles (the files stay). */
export async function setOwnTiles(id, record) {
  const all = foundry.utils.deepClone(records());
  if (record) all[id] = record; else delete all[id];
  await game.settings.set(ID, KEY, all);
}
