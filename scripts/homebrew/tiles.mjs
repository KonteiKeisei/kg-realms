// Homebrew realm worlds (0.74): cutting a picture into tiles and encoding them, in the browser.
// No Foundry here, so tools/homebrew-preview.html can run it on its own.

/** Encoder workers (ktx2-worker.mjs), `base` being the module folder's URL. */
export class TileEncoder {
  constructor(count, base) {
    this.workers = Array.from({ length: count }, () => new Worker(`${base}/scripts/homebrew/ktx2-worker.mjs`));
    this.pending = new Map(); this.next = 0;
    this.ready = Promise.all(this.workers.map((w) => new Promise((resolve, reject) => {
      w.onmessage = ({ data }) => {
        if (data.type === "ready") return data.error ? reject(Error(`the tile encoder could not start: ${data.error}`)) : resolve();
        const job = this.pending.get(data.id); this.pending.delete(data.id);
        if (data.error) job?.reject(Error(data.error)); else job?.resolve(data.bytes);
      };
      w.onerror = (e) => reject(Error(`the tile encoder failed: ${e.message ?? "unknown error"}`));
      w.postMessage({ type: "init", loader: `${base}/lib/basis/basis_encoder.js`, wasm: `${base}/lib/basis/basis_encoder.wasm` });
    })));
  }
  /** One tile's KTX2 file from its RGBA pixels (the buffer is handed to the worker). */
  encode(worker, rgba, width, height) {
    const id = this.next++;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.workers[worker].postMessage({ id, rgba, width, height }, [rgba]); });
  }
  stop() { for (const w of this.workers) w.terminate(); for (const j of this.pending.values()) j.reject(Error("stopped")); this.pending.clear(); }
}

/** One tile's pixels (an RGBA ArrayBuffer): its part of the picture at its level's scale, the border copied outward. */
export function cutTile(bitmap, tile) {
  const { left, top, right, bottom, padLeft, padTop, scale } = tile.crop;
  const w = right - left, h = bottom - top, tw = tile.textureWidth, th = tile.textureHeight;
  const canvas = new OffscreenCanvas(tw, th), ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, left / scale, top / scale, w / scale, h / scale, padLeft, padTop, w, h);
  // Past the picture's edge: its outermost pixels, repeated (as sharp's "copy" extend does).
  const padRight = tw - w - padLeft, padBottom = th - h - padTop;
  if (padLeft) ctx.drawImage(canvas, padLeft, padTop, 1, h, 0, padTop, padLeft, h);
  if (padRight > 0) ctx.drawImage(canvas, padLeft + w - 1, padTop, 1, h, padLeft + w, padTop, padRight, h);
  if (padTop) ctx.drawImage(canvas, 0, padTop, tw, 1, 0, 0, tw, padTop);
  if (padBottom > 0) ctx.drawImage(canvas, 0, padTop + h - 1, tw, 1, 0, padTop + h, tw, padBottom);
  return ctx.getImageData(0, 0, tw, th).data.buffer;
}

/** A KTX2 file's header: its size, level count and supercompression (1: Basis LZ, as Toril's). */
export function ktx2Header(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const magic = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x);
  return { magic, width: v.getUint32(20, true), height: v.getUint32(24, true), levels: v.getUint32(40, true), scheme: v.getUint32(44, true) };
}
