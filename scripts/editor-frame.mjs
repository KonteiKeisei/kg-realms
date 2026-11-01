/** Coalesce pointer previews, while clicks and the final saved coordinates remain immediate. */
export class EditorFrame {
  constructor(draw, request = fn => requestAnimationFrame(fn), cancel = id => cancelAnimationFrame(id)) {
    Object.assign(this, {draw, request, cancel});
    this.pending = null;
  }
  schedule() {
    if (this.pending !== null) return;
    this.pending = this.request(() => { this.pending = null; this.draw(); });
  }
  flush() { if (this.pending === null) return; this.clear(); this.draw(); }
  clear() { if (this.pending !== null) this.cancel(this.pending); this.pending = null; }
}
