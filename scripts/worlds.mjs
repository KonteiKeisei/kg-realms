// The worlds KG Realms can draw (0.71): each one registered by the module that ships its data, so the
// engine holds no world of its own. A world module registers on KG Realms' "kgRealmsRegisterWorlds"
// hook (fired at init), or through the API: game.modules.get("kg-realms").api.registerWorld(def).
//
// def: { id, title, module, root?, trade?, ... }
//  - id: the world's id, as stored in scenes and flags ("toril");
//  - module: the module that ships it; its data is at modules/<module>/data/worlds/<id>/ unless root;
//  - root: another folder for its data (a path under modules/ or the user data folder);
//  - assetBase: the folder its terrain tiles' paths start from (default modules/<module>; a homebrew
//    world made in a game world keeps them beside its data);
//  - anything else is the world's own settings (its map sheet, defaults), read where they are used.

const ENGINE = "kg-realms";
const worlds = new Map();

/** Register (or replace) a world. Returns its definition. */
export function registerWorld(def) {
  if (!def?.id || typeof def.id !== "string" || !/^[\w-]+$/.test(def.id)) throw new Error("KG Realms: a world needs an id of letters, digits, - or _.");
  const module = typeof def.module === "string" && /^[\w-]+$/.test(def.module) ? def.module : ENGINE;
  const root = typeof def.root === "string" && def.root ? def.root.replace(/\/+$/, "") : `modules/${module}/data/worlds/${def.id}`;
  const assetBase = typeof def.assetBase === "string" && def.assetBase ? def.assetBase.replace(/\/+$/, "") : `modules/${module}`;
  const world = Object.freeze({ title: def.id, ...def, module, root, assetBase });
  worlds.set(world.id, world);
  return world;
}

/** A registered world's definition, or null. */
export const worldDef = (id) => worlds.get(id) ?? null;
/** Every registered world. */
export const allWorlds = () => [...worlds.values()];
/** The first registered world (the default for new scenes), or null. */
export const defaultWorld = () => worlds.values().next().value ?? null;

/** The default world's id ("toril" while none is registered, for worlds made before the registry). */
export const defaultWorldId = () => defaultWorld()?.id ?? "toril";

/** A world's data folder (no trailing slash): registered, else the engine's own for that id. */
export function worldRoot(id) { return worlds.get(id)?.root ?? `modules/${ENGINE}/data/worlds/${id}`; }

/** A file in a world's data folder, as a path relative to the Foundry root (not yet routed). */
export function worldPath(id, rel) { return `${worldRoot(id)}/${String(rel).replace(/^\/+/, "")}`; }

/** A file in a world's data folder, routed (for fetch and URLs). */
export function worldUrl(id, rel) {
  const p = worldPath(id, rel);
  return globalThis.foundry?.utils?.getRoute ? foundry.utils.getRoute(p) : p;
}

/** The modules whose assets a world's data may name (the engine, and every world's own module). */
export function assetModules() { return new Set([ENGINE, ...[...worlds.values()].map((w) => w.module)]); }

/** Ask world modules to register theirs (KG Realms' init). */
export function collectWorlds(api) {
  globalThis.Hooks?.callAll?.("kgRealmsRegisterWorlds", api);
}
