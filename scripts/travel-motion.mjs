/** KG Transit's artwork-only hop, limited to an active movement animation. */
export class TravelBounce {
  constructor() { this.moves = new Map(); this.lifted = new Map(); this.tick = () => this.frame(); }
  start(doc, duration) {
    if (duration < 5000 || doc.parent?.id !== canvas.scene?.id) return;
    this.moves.set(doc.id, { doc, end: performance.now() + duration });
    if (!this.on) { this.on = true; canvas.app?.ticker.add(this.tick); }
  }
  frame() {
    const now = performance.now(), seen = new Set();
    let i = 0;
    for (const [id, move] of this.moves) {
      if (move.end <= now || move.doc.parent?.id !== canvas.scene?.id) { this.moves.delete(id); continue; }
      const mesh = move.doc.object?.mesh;
      if (!mesh || mesh.destroyed || !mesh.scale.y) continue;
      seen.add(mesh);
      const hop = Math.abs(Math.sin((now / 1000 * 2.1 + i++ * .37) * Math.PI)) * (canvas.scene.grid.size ?? 100) * .035;
      const lift = hop / mesh.scale.y;
      mesh.pivot.y += lift - (this.lifted.get(mesh) ?? 0);
      this.lifted.set(mesh, lift);
    }
    for (const [mesh, lift] of this.lifted) if (!seen.has(mesh)) { if (!mesh.destroyed) mesh.pivot.y -= lift; this.lifted.delete(mesh); }
    if (!this.moves.size) this.stop();
  }
  stop() {
    canvas.app?.ticker.remove(this.tick);
    for (const [mesh, lift] of this.lifted) if (!mesh.destroyed) mesh.pivot.y -= lift;
    this.lifted.clear(); this.moves.clear(); this.on = false;
  }
}
