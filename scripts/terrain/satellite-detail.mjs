// Close-zoom satellite tiles, synthesized on demand by a small pool of workers
// (satellite-worker.mjs) from the archive's last authored zoom.
export class SatelliteDetail {
  /** url: the tapestry archive; base: its last authored zoom. */
  constructor(url, { base = 9, workers = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 4) - 2)) } = {}) {
    this.base = base;
    this.pending = new Map();
    this.next = 0;
    this.pool = Array.from({ length: workers }, () => {
      const w = new Worker(new URL("./satellite-worker.mjs", import.meta.url), { type: "module" });
      w.ready = new Promise((resolve) => { w.onmessage = ({ data }) => { if (data.ready) resolve(); else this.#done(data); }; });
      w.postMessage({ init: { url, base } });
      return w;
    });
    this.cache = new Map();
  }

  #done({ id, bytes, error }) {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (error) p.reject(new Error(error)); else p.resolve(bytes ?? null);
  }

  /** The tile's bytes (WebP), or null outside the map. */
  async tile(z, x, y, signal) {
    const key = `${z}/${x}/${y}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const w = this.pool[this.next++ % this.pool.length];
    await w.ready;
    if (signal?.aborted) return null;
    const id = ++this.seq || (this.seq = 1);
    const bytes = await new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); w.postMessage({ id, z, x, y }); });
    this.cache.set(key, bytes);
    if (this.cache.size > 400) this.cache.delete(this.cache.keys().next().value);
    return bytes;
  }

  destroy() { for (const w of this.pool) w.terminate(); this.pool = []; }
}
