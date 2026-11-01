// Noise for the terrain bake: 3D simplex noise (after Stefan Gustavson's public-domain version),
// sampled on the sphere so detail has the same size everywhere and never seams, with fractal
// sums for hills, ridges for mountains, and cells for fields. Pure and seeded.

const F3 = 1 / 3, G3 = 1 / 6;
const GRAD = new Float32Array([1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1]);

/** A seeded noise source. */
export function makeNoise(seed = 1) {
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256).map((_, i) => i);
  let s = seed >>> 0 || 1;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const mod12 = new Uint8Array(512).map((_, i) => perm[i] % 12);

  /** Simplex noise in -1..1. */
  function simplex(x, y, z) {
    const sk = (x + y + z) * F3;
    const i = Math.floor(x + sk), j = Math.floor(y + sk), k = Math.floor(z + sk);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
    else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
    else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let n = 0;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 > 0) { const g = mod12[ii + perm[jj + perm[kk]]] * 3; t0 *= t0; n += t0 * t0 * (GRAD[g] * x0 + GRAD[g + 1] * y0 + GRAD[g + 2] * z0); }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 > 0) { const g = mod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; t1 *= t1; n += t1 * t1 * (GRAD[g] * x1 + GRAD[g + 1] * y1 + GRAD[g + 2] * z1); }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 > 0) { const g = mod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; t2 *= t2; n += t2 * t2 * (GRAD[g] * x2 + GRAD[g + 1] * y2 + GRAD[g + 2] * z2); }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 > 0) { const g = mod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; t3 *= t3; n += t3 * t3 * (GRAD[g] * x3 + GRAD[g + 1] * y3 + GRAD[g + 2] * z3); }
    return 32 * n;
  }

  /** Fractal sum, about -1..1: octaves of simplex at doubling frequency, halving weight. */
  function fbm(x, y, z, octaves = 5, lacunarity = 2, gain = 0.5) {
    let sum = 0, amp = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * simplex(x, y, z);
      norm += amp;
      amp *= gain; x *= lacunarity; y *= lacunarity; z *= lacunarity;
    }
    return sum / norm;
  }

  /**
   * Ridged multifractal, 0..1: sharp crests where the noise crosses zero, each octave weighted by
   * the one before, so ridges branch into finer ridges and valleys stay smooth.
   */
  function ridged(x, y, z, octaves = 7, lacunarity = 2.05, gain = 0.5) {
    let sum = 0, amp = 0.5, weight = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      let r = 1 - Math.abs(simplex(x, y, z));
      r *= r * weight;
      weight = Math.min(1, Math.max(0, r * 2));
      sum += r * amp;
      norm += amp;
      amp *= gain; x *= lacunarity; y *= lacunarity; z *= lacunarity;
    }
    return sum / norm;
  }

  /** Hash of an integer cell to 0..1 (for field colours and cell jitter). */
  function hash3(i, j, k) {
    let h = (i * 374761393 + j * 668265263 + k * 2147483647 + seed * 144665) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /**
   * Cells (Worley) in 2D: { id, d1, d2 } for the nearest jittered point: d2 - d1 small near a
   * cell's edge (a field boundary or hedge).
   */
  function cells(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let d1 = 9, d2 = 9, id = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy;
      const px = cx + hash3(cx, cy, 1), py = cy + hash3(cx, cy, 2);
      const d = Math.hypot(px - x, py - y);
      if (d < d1) { d2 = d1; d1 = d; id = hash3(cx, cy, 3); } else if (d < d2) d2 = d;
    }
    return { id, d1, d2 };
  }

  return { simplex, fbm, ridged, cells, hash3 };
}

/** A point on the unit sphere scaled to kilometres (Toril is Earth-sized), for isotropic noise. */
export function spherePoint(lon, lat, scaleKm) {
  const R = 6371 / scaleKm;
  const a = (lon * Math.PI) / 180, b = (lat * Math.PI) / 180, c = Math.cos(b);
  return [R * c * Math.cos(a), R * c * Math.sin(a), R * Math.sin(b)];
}
