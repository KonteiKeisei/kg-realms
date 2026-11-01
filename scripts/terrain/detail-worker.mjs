import { northernTerrain, mountainTint } from './parchment.mjs';
import { decodeModel, modelContext } from './model.mjs';
import { makeHeight } from './render.mjs';
import { makeNoise } from './noise.mjs';
self.onmessage = async ({ data: d }) => {
  try {
    if (!['relief','tint'].includes(d.mode)) throw new Error('Unsupported parchment tile mode');
    const model = decodeModel(new Uint8Array(d.model)), ctx = modelContext(model, d.z), S = ctx.canvas.tile, B = 16;
    // Rasterize the same curved polygon used by parchment at the requested LOD.
    const mask = new OffscreenCanvas(S + 2 * B, S + 2 * B), c = mask.getContext('2d', { willReadFrequently: true });
    const factor = 2 ** (d.z - model.meta.base.z) * S / model.meta.base.tile;
    const parentX = Math.floor(d.x / 2 ** (d.z - model.meta.base.z)), parentY = Math.floor(d.y / 2 ** (d.z - model.meta.base.z));
    const ox = (d.x - parentX * 2 ** (d.z - model.meta.base.z)) * S, oy = (d.y - parentY * 2 ** (d.z - model.meta.base.z)) * S;
    c.beginPath();
    for (const ring of model.meta.rings) {
      c.moveTo(ring[0][0] * factor - ox + B, ring[0][1] * factor - oy + B);
      for (const [x, y] of ring.slice(1)) c.lineTo(x * factor - ox + B, y * factor - oy + B);
      c.closePath();
    }
    c.fillStyle = '#fff'; c.fill('evenodd');
    const pixels = c.getImageData(0, 0, S + 2 * B, S + 2 * B).data;
    const gx = (d.x - ctx.canvas.x0) * S - B, gy = (d.y - ctx.canvas.y0) * S - B;
    ctx.landAt = (lon, lat) => { const [px, py] = ctx.canvas.toPixel(lon, lat); return pixels[(Math.max(0, Math.min(S + 2 * B - 1, Math.floor(py - gy))) * (S + 2 * B) + Math.max(0, Math.min(S + 2 * B - 1, Math.floor(px - gx)))) * 4 + 3] >= 128; };
    let rgb;
    if (['relief','tint'].includes(d.mode)) {
      const noise = makeNoise(7), height = makeHeight({ ...ctx, noise });
      rgb = new Uint8Array(S * S * 3);
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const [lon, lat] = ctx.canvas.toLonLat((d.x - ctx.canvas.x0) * S + x + 0.5, (d.y - ctx.canvas.y0) * S + y + 0.5);
        const h = ctx.landAt(lon, lat) ? height(lon, lat, true) : 0;
        const v = Math.max(0, Math.min(16777215, Math.round((h + 10000) * 10))), i = (y * S + x) * 3;
        rgb[i] = v >> 16; rgb[i + 1] = (v >> 8) & 255; rgb[i + 2] = v & 255;
      }
    }
    const image = new OffscreenCanvas(S, S), dc = image.getContext('2d'), rgba = new Uint8ClampedArray(S * S * 4);
    for (let i = 0; i < S * S; i++) { rgba.set(rgb.subarray(i * 3, i * 3 + 3), i * 4); rgba[i * 4 + 3] = 255; }
    if (d.mode === 'tint') for (let i=0;i<S*S;i++) {
      const h=((rgb[i*3]<<16)+(rgb[i*3+1]<<8)+rgb[i*3+2])/10-10000;
      rgba.set(mountainTint(h),i*4);
    }
    dc.putImageData(new ImageData(rgba, S, S), 0, 0);
    const bytes = await (await image.convertToBlob({ type: 'image/png' })).arrayBuffer();
    self.postMessage({ id: d.id, bytes }, [bytes]);
  } catch (err) { self.postMessage({ id: d.id, error: err.message }); }
};
