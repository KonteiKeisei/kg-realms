// The map editors' pointer events on the canvas, heard before Foundry's own. Foundry (PIXI) listens
// on the canvas element itself, so a listener there runs after it, too late to keep Foundry from
// starting its drag-select box under a node being dragged. Listening on the window, as the event
// comes down, runs first: an editor that takes the event stops it there.
// Presses (pointerdown, dblclick, contextmenu) count only on the canvas; moves and releases count
// anywhere, so a drag that ends over a window still ends.

const ON_CANVAS = new Set(["pointerdown", "dblclick", "contextmenu"]);

/** Listen with handlers { type: fn }; returns a function that stops listening. */
export function onCanvas(handlers) {
  const list = Object.entries(handlers).map(([type, fn]) => [type, (e) => { if (!ON_CANVAS.has(type) || e.target === canvas.app?.view) fn(e); }]);
  for (const [type, fn] of list) window.addEventListener(type, fn, type==="wheel"?{capture:true,passive:false}:{ capture: true });
  return () => { for (const [type, fn] of list) window.removeEventListener(type, fn, { capture: true }); };
}

/**
 * A right-click that is a click, not a drag (Foundry pans the map with a right-drag): call on the
 * right button's pointerdown with the action, and on its pointerup; the action runs on release if
 * the pointer moved less than a few pixels.
 */
export class RightClick {
  down(e, action) { this.at = { x: e.clientX, y: e.clientY, action }; }
  up(e) {
    const a = this.at;
    this.at = null;
    if (!a || e.button !== 2) return false;
    if (Math.hypot(e.clientX - a.x, e.clientY - a.y) > 5) return false;
    a.action();
    return true;
  }
}
