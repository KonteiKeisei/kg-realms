// The party token on a realm map stays findable when zoomed out (0.88.2): below a size on screen it is
// drawn larger, around its middle. Only its picture and portraits change: where it stands, its size in
// the scene and everything saved stay as they are.

const ID = "kg-realms";
/** How much larger to draw a token of `px` scene pixels at a zoom, to be at least `min` on screen. */
export function tokenFitFactor(px, zoom, { min = 40, max = 60 } = {}) {
  const screen = px * zoom;
  return screen > 0 && screen < min ? Math.min(max, min / screen) : 1;
}

/** A mesh's scale times a factor. Foundry sets the scale itself at times: what differs from ours is its new base. */
export function fitMesh(mesh, factor, state = {}) {
  if (!mesh?.scale) return state;
  const moved = !state.applied || Math.abs(mesh.scale.x - state.applied.x) > 1e-6 || Math.abs(mesh.scale.y - state.applied.y) > 1e-6;
  const base = moved ? { x: mesh.scale.x, y: mesh.scale.y } : state.base;
  const applied = { x: base.x * factor, y: base.y * factor };
  mesh.scale.set(applied.x, applied.y);
  return { base, applied };
}

export class PartyTokenFit {
  constructor({ isParty }) { this.isParty = isParty; }
  install() {
    for (const hook of ["drawToken", "refreshToken"]) Hooks.on(hook, (t) => this.fit(t));
    Hooks.on("canvasPan", () => this.queue());
    Hooks.on("canvasReady", () => this.queue());
  }
  queue() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; for (const t of canvas.tokens?.placeables ?? []) this.fit(t); });
  }
  fit(token) {
    if (!token || token.destroyed || !token.mesh || token.mesh.destroyed) return;
    token.kgrFitNow ??= () => this.fit(token);
    const zoom = canvas.stage?.scale?.x || 1, w = token.w ?? 0, h = token.h ?? 0;
    const wanted = canvas.scene?.getFlag?.(ID, "world") && this.isParty(token) ? tokenFitFactor(Math.max(w, h), zoom) : 1;
    // Nothing to undo on a token that has never been fitted.
    if (wanted === 1 && !token.kgrFitState) return;
    token.kgrFitState = fitMesh(token.mesh, wanted, token.kgrFitState ?? {});
    token.kgrFitFactor = wanted;
    // What is drawn on the token itself grows from its middle too.
    for (const part of [token.kgrPartyPortraits, token.border]) {
      if (!part || part.destroyed) continue;
      part.pivot.set(w / 2, h / 2); part.position.set(w / 2, h / 2); part.scale.set(wanted);
    }
    // Clickable as drawn.
    if (token.hitArea?.width != null) {
      const pad = (wanted - 1) / 2;
      token.hitArea.x = 0 - w * pad; token.hitArea.y = 0 - h * pad; token.hitArea.width = w * wanted; token.hitArea.height = h * wanted;
    }
  }
}
