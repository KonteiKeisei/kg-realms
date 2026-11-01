import { isPrimaryGM } from "./authority.mjs";
import { journeyKey } from "./journey-state.mjs";
const queues = new WeakMap();
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// Foundry merges object flags. Empty checks/rolls must delete old children, rather than merge them back in.
function replaceFields(out, path, value, previous) {
  if (!record(value)) { out[path] = value; return; }
  if (record(previous)) for (const key of Object.keys(previous)) if (!(key in value)) out[`${path}.-=${key}`] = null;
  const entries = Object.entries(value);
  if (!entries.length && !record(previous)) out[path] = {};
  for (const [key, child] of entries) replaceFields(out, `${path}.${key}`, child, previous?.[key]);
}

/** All shared journey writes read fresh state after preceding writes have completed. */
export function writeJourney(scene, transform, { trip, campId, valid = () => true } = {}) {
  const task = (queues.get(scene) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (!isPrimaryGM() || !valid()) return;
    const state = scene.getFlag("kg-realms", "journey") ?? {};
    if (trip !== undefined && journeyKey(state) !== trip) return;
    if (campId !== undefined && state.watch?.campId !== campId) return;
    const patch = transform(state);
    if (!patch || !isPrimaryGM() || !valid()) return;
    const updates = {};
    for (const [key, value] of Object.entries(patch)) {
      const previous = key.split(".").reduce((at, part) => at?.[part], state);
      replaceFields(updates, `flags.kg-realms.journey.${key}`, value, previous);
    }
    if (Object.keys(updates).length) return scene.update(updates);
  });
  queues.set(scene, task);
  return task;
}
