/**
 * An editor's Ctrl+Z history, each step tagged with the map (world) it was taken on. A step is only
 * ever undone on that map: the editors are shared by every map, and undoing one map's step on another
 * wrote the first map's saved state over the second's (0.97.4: a realm's every added place lost to
 * its regional map's place edits).
 */
export class MapUndo {
  constructor(limit = 40) { this.limit = limit; this.steps = []; }
  push(world, state) {
    this.steps.push({ world, state });
    if (this.steps.length > this.limit) this.steps.shift();
  }
  /** The latest step taken on this map, taken off the history; null when this map has none. */
  pop(world) {
    for (let i = this.steps.length - 1; i >= 0; i--) if (this.steps[i].world === world) return this.steps.splice(i, 1)[0].state;
    return null;
  }
  has(world) { return this.steps.some((s) => s.world === world); }
  /** Whether there are steps, but only from other maps (to say why Ctrl+Z does nothing here). */
  elsewhere(world) { return !this.has(world) && this.steps.length > 0; }
}

/** What an editor says when Ctrl+Z has nothing to undo on this map. */
export function nothingToUndo(undo, world, what = "") {
  ui.notifications.info(undo.elsewhere(world)
    ? `KG Realms: nothing to undo${what} on this map. Earlier changes were made on another map: open it to undo them there.`
    : `KG Realms: nothing to undo${what}.`);
}
