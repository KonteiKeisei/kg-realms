// The terrain renderer: one tile of baked "satellite" ground, from the fields (tools/terrain/
// fields.mjs), the elevation model and the ground textures. Each pixel gets a height (the DEM
// plus generated relief by landform, and stamped peaks), a material blend (climate, land cover,
// slope, height, the coast, fields around settlements), sun and valley shading, and water drawn
// by depth with a pale shore. Pure apart from its inputs: run in worker threads by bake.mjs.

import { makeNoise, spherePoint } from "./noise.mjs";
import { northernTerrain, tundraWeight } from "./parchment.mjs";
import { pickCoarse, sampleCoarse } from "./grid.mjs";

const D2R = Math.PI / 180;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

/* ---------------------------------------- */
/*  Palette: each material's colour          */
/* ---------------------------------------- */

// Target colours (sRGB 0..1) the textures are tinted to, so the photos only bring their pattern.
const C = (hex) => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
export const MATERIALS = {
  grass: { tex: "grass", color: C("#6f8048"), km: 30 },
  lush: { tex: "grass", color: C("#4f7a35"), km: 30 },
  // (Not the dry-dirt photo: its parallel ridges read as a grid over a whole steppe.)
  steppe: { tex: "grass", color: C("#a59a5c"), km: 34 },
  meadowDry: { tex: "grass", color: C("#8d8a52"), km: 30 },
  tundra: { tex: "scree", color: C("#7d7d68"), km: 30 },
  temperate: { tex: "forest", color: C("#3e5a2c"), km: 18 },
  boreal: { tex: "forest", color: C("#2f4632"), km: 16 },
  tropical: { tex: "forest", color: C("#2f5a24"), km: 18 },
  swamp: { tex: "grass", color: C("#4a5636"), km: 14 },
  sand: { tex: "sand", color: C("#d6bd86"), km: 45 },
  desert: { tex: "sand", color: C("#c2a06c"), km: 45 },
  rock: { tex: "rock", color: C("#7c7468"), km: 22 },
  scree: { tex: "scree", color: C("#948b7c"), km: 26 },
  snow: { tex: "snow", color: C("#eef1f4"), km: 30 },
  beach: { tex: "beach", color: C("#d9c9a0"), km: 12 },
  rice: { tex: "soil", color: C("#6d8a4a"), km: 10 },
  blackened: { tex: "scree", color: C("#3c3833"), km: 20 }
};
/** Crop colours of the fields around settlements. */
const CROPS = [C("#8a9a4e"), C("#a99f5e"), C("#7c8f43"), C("#94845e"), C("#a2a266"), C("#6e8540"), C("#b3a46c")];
const URBAN = C("#6e655c");
const WATER = { deep: C("#173650"), mid: C("#24506b"), shallow: C("#3f7f8a"), warm: C("#48a0a2"), shore: C("#a8c8c0"), river: C("#3b6f84"), ice: C("#dfe8ee") };

/* ---------------------------------------- */
/*  Textures                                 */
/* ---------------------------------------- */

/**
 * textures: { material: { size, data (RGB bytes), mean: [r, g, b], meanLum } }, each material's
 * texture scaled so a texel is about one baked pixel at the material's km.
 * Returns colour of material m at metres (mx, my): the material's colour, patterned by its
 * texture (or by noise when generated only), sampled twice at two scales to hide repeats.
 */
export function makeShader(textures, noise, generated, metresPerPixel = 160) {
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  function texel(t, u, v) {
    const s = t.size;
    let x = (u - Math.floor(u)) * s - 0.5, y = (v - Math.floor(v)) * s - 0.5;
    if (x < 0) x += s; if (y < 0) y += s;
    const xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi;
    const x1 = (xi + 1) % s, y1 = (yi + 1) % s, d = t.data;
    const o00 = (yi * s + xi) * 3, o10 = (yi * s + x1) * 3, o01 = (y1 * s + xi) * 3, o11 = (y1 * s + x1) * 3;
    const out = [0, 0, 0];
    for (let c = 0; c < 3; c++) out[c] = ((d[o00 + c] * (1 - tx) + d[o10 + c] * tx) * (1 - ty) + (d[o01 + c] * (1 - tx) + d[o11 + c] * tx) * ty) / 255;
    return out;
  }
  return function shade(m, mx, my, out) {
    const mat = MATERIALS[m];
    let k;
    if (generated || !textures[m]) {
      // Noise only: two scales of brightness variation around the colour.
      const n = noise.fbm(mx / (mat.km * 180), my / (mat.km * 180), 0.5, 4) * 0.5 + noise.fbm(mx / (mat.km * 40), my / (mat.km * 40), 7.3, 3) * 0.35;
      k = 1 + n * 0.45;
      out[0] = mat.color[0] * k; out[1] = mat.color[1] * k; out[2] = mat.color[2] * k;
      return out;
    }
    const source = textures[m];
    const desired = mat.km * 1000 / metresPerPixel;
    const t = source.mips?.find((p) => p.size >= desired) ?? source;
    const L = mat.km * 1000;
    // Overlapping patches with different offsets and rotations. The weights and coordinates
    // are global, so patches blend across archive tile edges without a repeating photo grid.
    const u = mx / L + noise.simplex(mx / (L * 2.7), my / (L * 2.7), 2.1) * 0.4;
    const v = my / L + noise.simplex(mx / (L * 2.7), my / (L * 2.7), 4.7) * 0.4;
    const ix = Math.floor(u), iy = Math.floor(v);
    const sx = smooth(0, 1, u - ix), sy = smooth(0, 1, v - iy);
    const a = [0, 0, 0];
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      let h = Math.imul(ix + dx, 374761393) ^ Math.imul(iy + dy, 668265263);
      h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
      const rotation = h & 3;
      const ru = rotation === 0 ? u : rotation === 1 ? -v : rotation === 2 ? -u : v;
      const rv = rotation === 0 ? v : rotation === 1 ? u : rotation === 2 ? -v : -u;
      const sample = texel(t, ru + ((h >>> 2) & 32767) / 32768, rv + ((h >>> 17) & 32767) / 32768);
      const weight = (dx ? sx : 1 - sx) * (dy ? sy : 1 - sy);
      for (let c = 0; c < 3; c++) a[c] += sample[c] * weight;
    }
    // Keep variance stable where several patches blend, preventing a lattice of soft squares.
    const variance = Math.sqrt(((1 - sx) ** 2 + sx ** 2) * ((1 - sy) ** 2 + sy ** 2));
    for (let c = 0; c < 3; c++) a[c] = source.mean[c] + (a[c] - source.mean[c]) / variance;
    const l = lum(...a) / source.meanLum;
    k = Math.max(0.45, Math.min(1.7, 1 + (l - 1) * 1.15));
    // The photo's own hue a little, the palette mostly.
    for (let c = 0; c < 3; c++) out[c] = mix(mat.color[c] * k, a[c] * (mat.color[c] / source.mean[c]), 0.25);
    return out;
  };
}

/* ---------------------------------------- */
/*  Heights                                  */
/* ---------------------------------------- */

/** Catmull-Rom sample of the DEM (equirectangular, Int16 metres) at a lon/lat. */
function demAt(dem, lon, lat) {
  const x = (lon - (dem.west ?? -180)) / dem.res - 0.5, y = ((dem.north ?? 90) - lat) / dem.res - 0.5;
  const xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi;
  const w = dem.width, h = dem.height, d = dem.data;
  const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const row = (yy) => {
    const r = Math.max(0, Math.min(h - 1, yy)) * w;
    const v = (xx) => { const val = d[r + Math.max(0, Math.min(w - 1, xx))]; return val === dem.nodata ? 0 : val; };
    return cr(v(xi - 1), v(xi), v(xi + 1), v(xi + 2), tx);
  };
  return cr(row(yi - 1), row(yi), row(yi + 1), row(yi + 2), ty);
}

/**
 * The height (metres) at a lon/lat, land or water: the DEM, generated relief by the landform
 * (ridged in mountains, rolling in hills), fading to the shore, and stamped peaks.
 */
export function makeHeight({ dem, fields, coarse, noise, peaks }) {
  return function height(lon, lat, land) {
    let base = demAt(dem, lon, lat);
    const northern = northernTerrain(lon, lat);
    if (northern === "lake") return 0;
    if (northern === "ice") return 2;
    const shore = sampleCoarse(fields.shore, coarse, lon, lat);
    if (!land) {
      // Water: the DEM's sea floor where it has one, else deepening away from the shore.
      const byShore = -(4 + 900 * smooth(0, 60, -shore));
      // (Not the elevation model's sea floor: at 4 km a cell it steps visibly.)
      return Math.min(-2, byShore);
    }
    const [px, py, pz] = spherePoint(lon, lat, 1);
    const wetland = fields.wetland ? sampleCoarse(fields.wetland, coarse, lon, lat) : 0;
    const bogHeight = wetland > .001 ? 3 + 2 * noise.fbm(px / 2, py / 2, pz / 2, 3) : 3;
    if (wetland > .995) return Math.max(1, bogHeight);
    let amp = sampleCoarse(fields.amp, coarse, lon, lat);
    let r = sampleCoarse(fields.ridge, coarse, lon, lat);
    // Painted hills keep rounded rough relief even where the atlas DEM disagrees.
    // A hard hill/mountain cutoff created kilometre-high walls around relief polygons.
    // A monotonic cap follows the reference landform. A band-shaped hill cap
    // depressed only the perimeter of a range, producing an artificial moat.
    base = Math.min(base, 100 + amp * .5);
    // High ground in the DEM is mountainous whatever the landform says.
    const high = smooth(1100, 2800, base);
    r = Math.max(r, high * 0.85);
    amp = Math.max(amp, high * 1300);
    const coast = smooth(0.2, 9, shore);
    // Domain-warped coordinates: ranges bend rather than run in noise's straight lines.
    const wx = noise.fbm(px / 90, py / 90, pz / 90, 3) * 0.35, wy = noise.fbm(px / 90 + 5.2, py / 90 + 1.3, pz / 90, 3) * 0.35;
    const s = 1 / 55;
    const rid = noise.ridged((px + wx * 55) * s, (py + wy * 55) * s, pz * s, 7);
    const hills = noise.fbm(px / 22, py / 22, pz / 22, 6);
    const fine = noise.fbm(px / 4, py / 4, pz / 4, 4);
    let h = Math.max(2, base) + amp * coast * (r * rid * 1.2 + (1 - r) * hills * 0.6) + 14 * fine * coast;
    for (const p of peaks) {
      const dx = (lon - p.lon) * Math.cos(p.lat * D2R) * 111.32, dy = (lat - p.lat) * 111.32;
      const d = Math.hypot(dx, dy);
      if (d > p.radius) continue;
      const t = d / p.radius;
      let bump = Math.pow(1 - t, p.sharp ?? 1.6);
      // A volcano's crater, a twin peak's second summit.
      if (p.crater) bump -= Math.max(0, 1 - d / (p.radius * p.crater)) * 0.35;
      if (p.twin) {
        const ex = (lon - p.twin.lon) * Math.cos(p.lat * D2R) * 111.32, ey = (lat - p.twin.lat) * 111.32;
        bump = Math.max(bump, Math.pow(Math.max(0, 1 - Math.hypot(ex, ey) / (p.radius * 0.6)), 1.6) * p.twin.share);
      }
      h += Math.max(0, p.height - h * (1 - bump)) * bump * 0.9;
    }
    if(northern==='tundra'){
      const [x,y,z]=spherePoint(lon,lat,1),d=Math.hypot((lon+77.2722508)*66,(lat-53.4518293)*111);
      const low=90+22*noise.fbm(x/35,y/35,z/35,3)+600*Math.exp(-d*d/16);
      h=mix(h,low,tundraWeight(lon,lat));
    }
    const valley = fields.valley ? sampleCoarse(fields.valley, coarse, lon, lat) : 0;
    h = mix(h, Math.min(h, 35), valley);
    return Math.max(1, mix(h, bogHeight, wetland));
  };
}

/* ---------------------------------------- */
/*  A tile                                   */
/* ---------------------------------------- */

/** Pixels rendered around each tile for its neighbours: normals, valley shading and the shore. */
const BORDER = 16;
/** Texture and noise space: metres on the map at 40°N, the same for every tile (no seams). */
const WORLD_M = 40075016.686 * Math.cos(40 * D2R);
/** Shallows and beaches look this many pixels across the shore. */
const SHORE_PX = 16;
/** Metres per canvas pixel for noise and textures (a constant, so tiles agree). */
const MPX = WORLD_M / (512 * 384);
/** How far (pixels) the coast is pushed about by noise. */
const COAST_WARP = 0;
/** And by a slower wander (pixels), bending long straight runs of the atlas's coast. */
const COAST_WANDER = 0;

/** Pixels from each cell to the nearest cell on the other side of the shore, up to SHORE_PX. */
export function shoreDistance(land, N) {
  const d = new Float32Array(N * N);
  for (let i = 0; i < d.length; i++) {
    const x = i % N, y = (i / N) | 0, v = land[i];
    const edge = (x > 0 && land[i - 1] !== v) || (x < N - 1 && land[i + 1] !== v) || (y > 0 && land[i - N] !== v) || (y < N - 1 && land[i + N] !== v);
    d[i] = edge ? 1 : SHORE_PX;
  }
  const D = Math.SQRT2;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    let v = d[i];
    if (x > 0 && land[i - 1] === land[i]) v = Math.min(v, d[i - 1] + 1);
    if (y > 0) {
      if (land[i - N] === land[i]) v = Math.min(v, d[i - N] + 1);
      if (x > 0 && land[i - N - 1] === land[i]) v = Math.min(v, d[i - N - 1] + D);
      if (x < N - 1 && land[i - N + 1] === land[i]) v = Math.min(v, d[i - N + 1] + D);
    }
    d[i] = v;
  }
  for (let y = N - 1; y >= 0; y--) for (let x = N - 1; x >= 0; x--) {
    const i = y * N + x;
    let v = d[i];
    if (x < N - 1 && land[i + 1] === land[i]) v = Math.min(v, d[i + 1] + 1);
    if (y < N - 1) {
      if (land[i + N] === land[i]) v = Math.min(v, d[i + N] + 1);
      if (x < N - 1 && land[i + N + 1] === land[i]) v = Math.min(v, d[i + N + 1] + D);
      if (x > 0 && land[i + N - 1] === land[i]) v = Math.min(v, d[i + N - 1] + D);
    }
    d[i] = Math.min(SHORE_PX, v);
  }
  return d;
}

/**
 * Render tile (tx, ty) of the canvas: RGB bytes, tile x tile.
 * ctx: { canvas (grid.canvasOf), coarse, fields { landBits, cover, climate, seaice, amp, ridge,
 * shore }, dem { data, width, height, res, nodata }, textures, rivers (segments by tile),
 * settlements, peaks, climates (codes), generated }
 */
export function renderTile(ctx, tx, ty) {
  const { canvas, coarse, fields } = ctx;
  const S = canvas.tile, B = BORDER, N = S + 2 * B;
  const noise = ctx.noise ??= makeNoise(7);
  const height = ctx.height ??= makeHeight({ dem: ctx.dem, fields, coarse, noise, peaks: ctx.peaks ?? [] });
  const shade = ctx.shade ??= makeShader(ctx.textures ?? {}, noise, !!ctx.generated, canvas.metresPerPixel(40));
  const ox = (tx - canvas.x0) * S - B, oy = (ty - canvas.y0) * S - B;
  const base = ctx.baseCanvas ?? canvas;
  const factor = (2 ** canvas.z * S) / (2 ** base.z * base.tile);
  const mxOf = (gx) => ((gx + canvas.x0 * S) / factor - base.x0 * base.tile) * MPX;
  const myOf = (gy) => ((gy + canvas.y0 * S) / factor - base.y0 * base.tile) * MPX;

  // Land and heights with a border, for normals and the shore.
  const land = new Uint8Array(N * N), H = new Float32Array(N * N), LON = new Float64Array(N), LAT = new Float64Array(N);
  for (let i = 0; i < N; i++) { LON[i] = canvas.toLonLat(ox + i + 0.5, 0)[0]; LAT[i] = canvas.toLonLat(0, oy + i + 0.5)[1]; }
  // The coast as the atlas draws it is straight segments: read the land mask through a small
  // fractal offset (about a kilometre, with finer wiggles), so shores get bays, points and crinkles.
  const bitAt = (gx, gy) => (gx >= 0 && gy >= 0 && gx < canvas.W && gy < canvas.H ? (fields.landBits[(gy * canvas.W + gx) >> 3] >> ((gy * canvas.W + gx) & 7)) & 1 : 0);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const gx = ox + x, gy = oy + y;
    const mx = mxOf(gx), my = myOf(gy);
    // Two scales: a slow wander that bends the atlas's long straight runs, and the crinkle.
    const wx = COAST_WARP || COAST_WANDER ? noise.fbm(mx / 30000, my / 30000, 41.7, 3) * COAST_WANDER + noise.fbm(mx / 9000, my / 9000, 11.3, 5) * COAST_WARP : 0;
    const wy = COAST_WARP || COAST_WANDER ? noise.fbm(mx / 30000, my / 30000, 57.1, 3) * COAST_WANDER + noise.fbm(mx / 9000, my / 9000, 23.9, 5) * COAST_WARP : 0;
    const bit = ctx.landAt ? ctx.landAt(LON[x], LAT[y]) : bitAt(Math.round(gx + wx), Math.round(gy + wy));
    land[y * N + x] = bit;
    H[y * N + x] = height(LON[x], LAT[y], bit);
  }
  // Distance to the other side of the shore, in pixels (for beaches and shallows): a chamfer
  // distance over the tile and its border, so neighbouring tiles agree near their edges.
  const near = shoreDistance(land, N);
  if (ctx.captureElevation) {
    const elevation = ctx.elevation = new Uint8Array(S * S * 3);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = (y + B) * N + x + B;
      const v = Math.round(((land[i] ? H[i] : 0) + 10000) * 10), o = (y * S + x) * 3;
      elevation[o] = v >> 16; elevation[o + 1] = (v >> 8) & 255; elevation[o + 2] = v & 255;
    }
  }
  if (ctx.nearAt) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) near[y * N + x] = ctx.nearAt(LON[x], LAT[y]);
  // Valley shading: height against its neighbourhood's.
  const R = 3;
  const out = new Uint8Array(S * S * 3);
  const col = [0, 0, 0], tmp = [0, 0, 0];
  const mpp = canvas.metresPerPixel(LAT[B + (S >> 1)]);
  const sunAz = 315 * D2R, sunEl = 38 * D2R;
  const L = [Math.sin(sunAz) * Math.cos(sunEl), -Math.cos(sunAz) * Math.cos(sunEl), Math.sin(sunEl)];
  const flat = L[2];
  const EXAG = 2.6;
  const climates = ctx.climates;

  for (let y = B; y < B + S; y++) {
    const lat = LAT[y];
    const snowline = 5000 - 70 * Math.max(0, Math.abs(lat) - 18);
    for (let x = B; x < B + S; x++) {
      const i = y * N + x, lon = LON[x], h = H[i];
      const mx = mxOf(ox + x), my = myOf(oy + y);
      // Normal from the height's slope (exaggerated so relief reads at this scale).
      const dzdx = ((H[i + 1] - H[i - 1]) / (2 * mpp)) * EXAG, dzdy = ((H[i + N] - H[i - N]) / (2 * mpp)) * EXAG;
      const nl = Math.hypot(dzdx, dzdy, 1);
      const nx = -dzdx / nl, ny = -dzdy / nl, nz = 1 / nl;
      const slope = Math.hypot(dzdx, dzdy) / EXAG;
      const diffuse = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      let light = (0.48 + 0.62 * diffuse) / (0.48 + 0.62 * flat);
      let mean = 0;
      for (let k = -R; k <= R; k++) mean += H[i + k] + H[i + k * N];
      mean /= 2 * (2 * R + 1);
      light *= Math.max(0.78, Math.min(1.08, 1 + (h - mean) / 900));

      // Domain-warped lookups: the coarse fields' cell edges never show.
      const wl = noise.simplex(mx / 2600, my / 2600, 3.1) * 0.012, wt = noise.simplex(mx / 2600, my / 2600, 9.7) * 0.012;
      if (!land[i]) {
        // Water: deeper colour away from the shore, warm seas turquoise, a pale line at the beach.
        const code = climates[pickCoarse(fields.climate, coarse, lon + wl, lat + wt) - 1] ?? "C";
        // Depth: the fine distance to the shore close in (the coarse depth steps at 1 km), the
        // elevation model's sea floor further out.
        const depth = Math.max(0, -h);
        const shallow = Math.max(smooth(SHORE_PX, 1, near[i] + noise.simplex(mx / 1500, my / 1500, 6.6) * 3) * 0.85, smooth(12, SHORE_PX, near[i]) * smooth(60, 8, depth) * 0.5);
        const warm = code[0] === "A" || code[0] === "B" ? 1 : 0;
        for (let c = 0; c < 3; c++) {
          const deep = mix(WATER.deep[c], WATER.mid[c], smooth(1500, 60, depth));
          col[c] = mix(deep, mix(WATER.shallow[c], WATER.warm[c], warm * 0.7), shallow);
        }
        const wave = 1 + noise.fbm(mx / 900, my / 300, 1.7, 3) * 0.05;
        for (let c = 0; c < 3; c++) col[c] *= wave;
        if (near[i] <= 1) for (let c = 0; c < 3; c++) col[c] = mix(col[c], WATER.shore[c], 0.35);
        if (pickCoarse(fields.seaice, coarse, lon + wl, lat + wt)) {
          const ice = smooth(-0.2, 0.4, noise.fbm(mx / 7000, my / 7000, 2.2, 4));
          for (let c = 0; c < 3; c++) col[c] = mix(col[c], WATER.ice[c] * (0.92 + 0.08 * light), ice);
        }
      } else {
        const code = climates[pickCoarse(fields.climate, coarse, lon + wl, lat + wt) - 1] ?? "Cfb";
        const cover = pickCoarse(fields.cover, coarse, lon + wl * 0.6, lat + wt * 0.6);
        // The ground of the climate.
        let base = "grass";
        if (code[0] === "A") base = "lush";
        else if (code.startsWith("BW")) base = "desert";
        else if (code.startsWith("BS")) base = "steppe";
        else if (code[1] === "s") base = "meadowDry";
        else if (code === "ET") base = "tundra";
        else if (code === "EF") base = "snow";
        shade(base, mx, my, col);
        // Large-scale variety, as seen from high up: greener and drier stretches tens of km across.
        if (base === "grass" || base === "lush" || base === "meadowDry") {
          const v = noise.fbm(mx / 45000, my / 45000, 3.3, 4);
          shade(v > 0 ? "meadowDry" : "lush", mx, my, tmp);
          const t = Math.min(1, Math.abs(v) * 1.6) * 0.55;
          for (let c = 0; c < 3; c++) col[c] = mix(col[c], tmp[c], t);
        }
        // Fields around settlements, on open ground: a calm patchwork, lighter and yellower.
        let urban = 0;
        if (cover === 0 && base !== "desert" && base !== "snow" && slope < 0.12) {
          const { farm, town } = farmland(ctx, lon, lat, noise, mx, my);
          urban = town;
          if (farm > 0) {
            const cell = noise.cells(mx / 2600, my / 2600);
            const crop = CROPS[Math.floor(cell.id * CROPS.length)];
            const hedge = smooth(0.0, 0.06, cell.d2 - cell.d1);
            const k = (0.92 + 0.08 * hedge) * (1 + noise.simplex(mx / 600, my / 600, 4.4) * 0.04);
            for (let c = 0; c < 3; c++) col[c] = mix(col[c], mix(col[c], crop[c], 0.75) * k, farm);
          }
        }
        // Land cover over it.
        const coverMat = [null, "temperate", "boreal", code[0] === "A" ? "tropical" : "temperate", "swamp", "sand", "snow", "rice", "blackened", "steppe"][cover];
        if (coverMat) {
          shade(coverMat, mx, my, tmp);
          if (cover <= 3 && fields.forestCold) {
            const cold = sampleCoarse(fields.forestCold, coarse, lon, lat), tropical = sampleCoarse(fields.forestTropical, coarse, lon, lat);
            const temperate = Math.max(0, 1 - cold - tropical), forest = [0, 0, 0], scratch = [0, 0, 0];
            for (const [material, weight] of [['temperate', temperate], ['boreal', cold], ['tropical', tropical]]) {
              if (weight < .001) continue;
              shade(material, mx, my, scratch); for (let c = 0; c < 3; c++) forest[c] += scratch[c] * weight;
            }
            for (let c = 0; c < 3; c++) tmp[c] = forest[c];
          }
          // Forest edges break up instead of following the polygon.
          // Forest edges break up instead of following the outline; grassland fades into meadow.
          const edge = cover <= 3 ? smooth(-0.35, 0.15, noise.fbm(mx / 1800, my / 1800, 5.5, 3) + 0.25)
            : cover === 9 ? 0.55 + 0.45 * smooth(-0.4, 0.4, noise.fbm(mx / 5000, my / 5000, 8.2, 4)) : 1;
          for (let c = 0; c < 3; c++) col[c] = mix(col[c], tmp[c], edge);
          // Dunes: long ridges, bent.
          if (cover === 5) {
            // Ridges bent by the wind's eddies, fading in and out, never a regular pattern.
            const phase = (mx * 0.8 + my * 0.6) / 700 + noise.fbm(mx / 6000, my / 6000, 2, 3) * 9;
            light *= 1 + 0.045 * Math.sin(phase) * smooth(-0.3, 0.4, noise.simplex(mx / 15000, my / 15000, 6.1));
          }
          // Marsh: dark pools and channels among the reeds.
          if (cover === 4) {
            const pool = smooth(0.15, 0.35, noise.fbm(mx / 1600, my / 1600, 13.3, 4));
            for (let c = 0; c < 3; c++) col[c] = mix(col[c], WATER.river[c] * 0.75, pool * 0.8);
          }
        }
        // Rock where it is steep or high, snow above the snowline.
        // ... and in mountains generally: bare rock and scree on the ridges, grass in the valleys.
        const ridgeW = sampleCoarse(fields.ridge, coarse, lon, lat);
        const crest = ridgeW * smooth(mean - 40, mean + 160, h + noise.fbm(mx / 2500, my / 2500, 4.9, 3) * 120);
        const rocky = Math.max(smooth(0.18, 0.42, slope), smooth(snowline - 1400, snowline - 300, h) * 0.85, Math.min(0.92, ridgeW * 0.55 + crest * 0.45));
        if (rocky > 0.01) {
          shade(slope > 0.3 ? "rock" : "scree", mx, my, tmp);
          for (let c = 0; c < 3; c++) col[c] = mix(col[c], tmp[c], rocky);
        }
        const snow = smooth(snowline - 150, snowline + 350, h + noise.fbm(mx / 3000, my / 3000, 8.8, 3) * 350) * smooth(1.2, 0.6, slope);
        if (snow > 0.01) {
          shade("snow", mx, my, tmp);
          for (let c = 0; c < 3; c++) col[c] = mix(col[c], tmp[c], snow);
        }
        // Beaches on low, gentle shores of milder climates.
        if (near[i] <= 2 && h < 30 && slope < 0.08 && code[0] !== "E") {
          shade("beach", mx, my, tmp);
          const b = near[i] <= 1 ? 0.75 : 0.35;
          for (let c = 0; c < 3; c++) col[c] = mix(col[c], tmp[c], b);
        }
        // The towns themselves: roofs and streets, grey-brown, denser at the centre.
        if (urban > 0) {
          const grain = 0.85 + 0.3 * noise.cells(mx / 220, my / 220).id;
          for (let c = 0; c < 3; c++) col[c] = mix(col[c], URBAN[c] * grain, urban);
        }
        for (let c = 0; c < 3; c++) col[c] *= light;
      }
      const o = ((y - B) * S + (x - B)) * 3;
      for (let c = 0; c < 3; c++) out[o + c] = Math.max(0, Math.min(255, Math.round(Math.pow(Math.max(0, col[c]), 1) * 255)));
    }
  }
  // Rivers on land only: an atlas river's mouth can lie past the painted map's coast.
  const onLand = (x, y) => land[(y + B) * N + (x + B)] === 1;
  drawRivers(ctx, out, tx, ty, mpp, onLand);
  return out;
}

/** Town size (km across the built-up area) by class. */
const TOWN_KM = { City: 4.5, Town: 1.6, Village: 0.7 };

/**
 * Near settlements: { farm (0..1), the fields around them, ragged at the edge; town (0..1), the
 * built-up area itself }.
 */
function farmland(ctx, lon, lat, noise, mx, my) {
  const list = ctx.nearSettlements;
  if (!list?.length) return { farm: 0, town: 0 };
  let farm = 0, town = 0;
  for (const s of list) {
    const dx = (lon - s.lon) * Math.cos(lat * D2R) * 111.32, dy = (lat - s.lat) * 111.32;
    const d = Math.hypot(dx, dy);
    if (d >= s.reach * 1.4) continue;
    const ragged = s.reach * (1 + noise.fbm(mx / 9000, my / 9000, s.lon, 3) * 0.45);
    farm = Math.max(farm, smooth(ragged, ragged * 0.55, d));
    const r = (TOWN_KM[s.class] ?? 0.4) * (1 + noise.fbm(mx / 1500, my / 1500, s.lat, 3) * 0.35);
    town = Math.max(town, smooth(r, r * 0.4, d));
  }
  return { farm: farm * 0.9, town: town * 0.9 };
}

/** Rivers over the tile: water lines as wide as the river (at least a pixel), soft-edged. */
function drawRivers(ctx, out, tx, ty, mpp, onLand) {
  const segs = ctx.riverSegments?.get(`${tx}/${ty}`);
  if (!segs) return;
  const { canvas } = ctx, S = canvas.tile;
  const ox = (tx - canvas.x0) * S, oy = (ty - canvas.y0) * S;
  for (const [ax, ay, bx, by, widthM] of segs) {
    const w = Math.max(0.9, widthM / mpp) / 2;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - ox - w - 1)), x1 = Math.min(S - 1, Math.ceil(Math.max(ax, bx) - ox + w + 1));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - oy - w - 1)), y1 = Math.min(S - 1, Math.ceil(Math.max(ay, by) - oy + w + 1));
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + ox + 0.5, py = y + oy + 0.5;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      const a = Math.max(0, Math.min(1, w + 0.5 - d));
      if (a <= 0 || !onLand(x, y)) continue;
      const o = (y * S + x) * 3;
      for (let c = 0; c < 3; c++) out[o + c] = Math.round(mix(out[o + c], WATER.river[c] * 255, a * 0.9));
    }
  }
}
