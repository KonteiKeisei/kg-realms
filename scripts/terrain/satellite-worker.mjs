// Synthesizes satellite terrain tiles closer than the archive's last authored zoom.
// The authored tiles give colour; this adds coastline and river edges sharper than
// their pixels, fine relief with hillshade, and water ripples. Every value is a
// function of global position, so neighbouring tiles join without seams.
import { Archive } from "../pmtiles.mjs";

let archive = null, base = 9;
const decoded = new Map();          // "x/y" -> Promise<Uint8ClampedArray|null> (RGBA 512x512)
const ORDER = [];
const TS = 512;

function parent(x, y) {
  const key = `${x}/${y}`;
  if (!decoded.has(key)) {
    decoded.set(key, archive.tile(base, x, y).then(async (bytes) => {
      if (!bytes?.length) return null;
      const bmp = await createImageBitmap(new Blob([bytes], { type: "image/webp" }));
      const c = new OffscreenCanvas(TS, TS), g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      return g.getImageData(0, 0, TS, TS).data;
    }).catch(() => null));
    ORDER.push(key);
    while (ORDER.length > 48) decoded.delete(ORDER.shift());
  }
  return decoded.get(key);
}

// ------------------------------------------------------------------ noise
function hash(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function grad(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const dot = (ox, oy) => { const t = hash(x0 + ox, y0 + oy, seed) * 6.283185307; return Math.cos(t) * (fx - ox) + Math.sin(t) * (fy - oy); };
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = dot(0, 0), b = dot(1, 0), c = dot(0, 1), d = dot(1, 1);
  return (a + (b - a) * u + (c - a + (a - b + d - c) * u) * v) * 1.45;
}
// Octaves from `wl` (in base-zoom pixels) down to `smallest`, each rotated.
function fbm(x, y, wl, smallest, seed, gain = 0.5) {
  let t = 0, amp = 1, norm = 0;
  for (let o = 0; wl >= smallest && o < 8; o++, wl /= 2, amp *= gain) {
    const a = (seed * 0.618 + o * 0.73) % 6.283, c = Math.cos(a), s = Math.sin(a);
    t += amp * grad((x * c - y * s) / wl + o * 17.3, (x * s + y * c) / wl - o * 9.1, seed + o * 101);
    norm += amp;
  }
  return norm ? t / norm : 0;
}
function ridged(x, y, wl, smallest, seed, gain = 0.55) {
  let t = 0, amp = 1, norm = 0, w = 1;
  for (let o = 0; wl >= smallest && o < 8; o++, wl /= 2, amp *= gain) {
    let n = 1 - Math.abs(grad(x / wl + o * 5.1, y / wl - o * 3.7, seed + o * 131));
    n = n * n * w; w = Math.min(1, n * 1.6);
    t += amp * n; norm += amp;
  }
  return norm ? t / norm : 0;
}

// ------------------------------------------------------------------ tile
/** RGBA pixels of tile z/x/y, or null outside the map. getParent(x, y) resolves the
 *  base-zoom tile's RGBA pixels (512x512) or null. */
export async function synthesize(z, x, y, base, getParent) {
  const parent = getParent;
  const D = z - base, k = 2 ** D;                 // tile px per base px
  const px0 = Math.floor((x * TS) / k) - 3, py0 = Math.floor((y * TS) / k) - 3;
  const span = Math.ceil(TS / k) + 7;
  // Base-zoom window around this tile, assembled from up to four parent tiles.
  const win = new Float32Array(span * span * 3);
  const tiles = new Map();
  for (let ty = Math.floor(py0 / TS); ty <= Math.floor((py0 + span) / TS); ty++)
    for (let tx = Math.floor(px0 / TS); tx <= Math.floor((px0 + span) / TS); tx++) tiles.set(`${tx}/${ty}`, await parent(tx, ty));
  if ([...tiles.values()].every((t) => !t)) return null;
  for (let j = 0; j < span; j++) for (let i = 0; i < span; i++) {
    const gx = px0 + i, gy = py0 + j, t = tiles.get(`${Math.floor(gx / TS)}/${Math.floor(gy / TS)}`);
    const o = (j * span + i) * 3;
    if (!t) { win[o] = win[o + 1] = win[o + 2] = 23; continue; }
    const q = ((gy - Math.floor(gy / TS) * TS) * TS + (gx - Math.floor(gx / TS) * TS)) * 4;
    win[o] = t[q]; win[o + 1] = t[q + 1]; win[o + 2] = t[q + 2];
  }
  // Cubic B-spline sample of the window: smooth, so the authored tiles' compression
  // blocks never show when enlarged; detail comes from the noise below.
  const cr = (p0, p1, p2, p3, t) => { const t2 = t * t, t3 = t2 * t; return ((1 - t) ** 3 * p0 + (3 * t3 - 6 * t2 + 4) * p1 + (-3 * t3 + 3 * t2 + 3 * t + 1) * p2 + t3 * p3) / 6; };
  const col = new Float32Array(3);
  function sample(bx, by) {
    const fx = bx - px0 - 0.5, fy = by - py0 - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    for (let c = 0; c < 3; c++) {
      const row = new Array(4);
      for (let m = -1; m <= 2; m++) {
        const r = (iy + m) * span;
        row[m + 1] = cr(win[(r + ix - 1) * 3 + c], win[(r + ix) * 3 + c], win[(r + ix + 1) * 3 + c], win[(r + ix + 2) * 3 + c], tx);
      }
      col[c] = cr(row[0], row[1], row[2], row[3], ty);
    }
    return col;
  }
  // Base-zoom luminance contrast nearby: how rugged the authored terrain is.
  // Interpolated between base pixels, so it never steps at their edges.
  const rugAt = new Float32Array(span * span);
  for (let j = 1; j < span - 1; j++) for (let i = 1; i < span - 1; i++) {
    let s1 = 0, s2 = 0;
    for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) { const o = ((j + v) * span + i + u) * 3, l = (win[o] + win[o + 1] + win[o + 2]) / 3; s1 += l; s2 += l * l; }
    rugAt[j * span + i] = Math.sqrt(Math.max(0, s2 / 9 - (s1 / 9) ** 2));
  }
  function rugged(bx, by) {
    const fx = bx - px0 - 0.5, fy = by - py0 - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    const a = rugAt[iy * span + ix], b = rugAt[iy * span + ix + 1], c = rugAt[(iy + 1) * span + ix], d = rugAt[(iy + 1) * span + ix + 1];
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return a + (b - a) * sx + (c - a + (a - b + d - c) * sx) * sy;
  }


  const N = TS + 2, smallest = 0.6 / k;
  const height = new Float32Array(N * N), rgb = new Float32Array(N * N * 3), water = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const bx = (x * TS + i - 1 + 0.5) / k, by = (y * TS + j - 1 + 0.5) / k;   // base-zoom px
    const c = sample(bx, by), o = j * N + i;
    const r = c[0], g = c[1], b = c[2];
    // Water reads as clearly bluer than red and not greener than blue.
    const wet = Math.min(1, Math.max(0, ((b - r) - 20) / 14)) * Math.min(1, Math.max(0, (b - g + 14) / 10));
    const edge = 0.5 + 0.16 * fbm(bx, by, 1.2, smallest, 9);
    const aa = 0.5 / k + 0.04;
    const w = Math.min(1, Math.max(0, (wet - edge + aa) / (2 * aa)));
    water[o] = w;
    const rug = Math.min(1, rugged(bx, by) / 38);
    // Heights in base-pixel units. Fine octaves shrink faster than their wavelength,
    // so plains stay gentle at every zoom and only rugged ground keeps sharp ridges.
    const h = rug * rug * 0.9 * ridged(bx, by, 2, smallest, 31, 0.48) + 0.12 * fbm(bx, by, 3, smallest, 41, 0.45);
    height[o] = h * (1 - w);
    rgb[o * 3] = r; rgb[o * 3 + 1] = g; rgb[o * 3 + 2] = b;
  }
  const out = new Uint8ClampedArray(TS * TS * 4);
  const relief = 1.6 * k;                         // tile-px differences to base-px slope
  for (let j = 1; j <= TS; j++) for (let i = 1; i <= TS; i++) {
    const o = j * N + i, bx = (x * TS + i - 1 + 0.5) / k, by = (y * TS + j - 1 + 0.5) / k;
    const dx = (height[o + 1] - height[o - 1]) * relief, dy = (height[o + N] - height[o - N]) * relief;
    const len = Math.hypot(dx, dy, 1);
    let shade = (0.55 * dx + 0.55 * dy + 0.63) / len / 0.63;      // light from the northwest
    shade = 0.62 + 0.38 * Math.min(1.6, Math.max(0, shade));
    const w = water[o];
    // Colour detail: vegetation patches everywhere, tree crowns where the ground is forest.
    const lumBase = (rgb[o * 3] + rgb[o * 3 + 1] + rgb[o * 3 + 2]) / 3;
    const forest = Math.min(1, Math.max(0, (rgb[o * 3 + 1] - rgb[o * 3] - 6) / 8)) * Math.min(1, Math.max(0, (78 - lumBase) / 14));
    const patches = 1.4 * fbm(bx, by, 1.4, smallest, 61, 0.62) + 0.5 * fbm(bx, by, 0.15, smallest, 62, 0.7);
    const crowns = Math.max(0, fbm(bx, by, 0.09, smallest, 63, 0.4));
    const grain = (1 + 0.09 * patches) * (1 - forest * (0.35 * crowns - 0.06));
    let r = rgb[o * 3] * shade * grain, g = rgb[o * 3 + 1] * shade * grain, b = rgb[o * 3 + 2] * shade * grain;
    // Water: the authored colour where it is open water, a calm slate at new edges, ripples.
    const ripple = 1 + 0.05 * fbm(bx * 0.7, by * 1.6, 0.6, smallest, 72);
    const wr = (w > 0 && rgb[o * 3 + 2] - rgb[o * 3] > 25 ? rgb[o * 3] : 24) * ripple, wg = (w > 0 && rgb[o * 3 + 2] - rgb[o * 3] > 25 ? rgb[o * 3 + 1] : 54) * ripple, wb = (w > 0 && rgb[o * 3 + 2] - rgb[o * 3] > 25 ? rgb[o * 3 + 2] : 64) * ripple;
    // A thin darker rim where land meets water.
    const rim = 1 - 0.22 * Math.max(0, 1 - Math.abs(w - 0.5) * 2);
    r = (r * (1 - w) + wr * w) * rim; g = (g * (1 - w) + wg * w) * rim; b = (b * (1 - w) + wb * w) * rim;
    const q = ((j - 1) * TS + i - 1) * 4;
    out[q] = r; out[q + 1] = g; out[q + 2] = b; out[q + 3] = 255;
  }
  return out;
}

async function render(z, x, y) {
  const out = await synthesize(z, x, y, base, parent);
  if (!out) return null;
  const canvas = new OffscreenCanvas(TS, TS);
  canvas.getContext("2d").putImageData(new ImageData(out, TS, TS), 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.86 });
  return new Uint8Array(await blob.arrayBuffer());
}

if (typeof WorkerGlobalScope !== "undefined") self.onmessage = async ({ data }) => {
  if (data.init) { archive = new Archive(data.init.url); base = data.init.base; await archive.init(); self.postMessage({ ready: true }); return; }
  const { id, z, x, y } = data;
  try { const bytes = await render(z, x, y); self.postMessage({ id, bytes }, bytes ? [bytes.buffer] : []); }
  catch (err) { self.postMessage({ id, error: String(err?.message ?? err) }); }
};
