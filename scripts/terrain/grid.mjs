// The terrain bake's geometry: the area baked in detail (Faerûn), its tiles and pixels in Web
// Mercator at zoom 9 drawn at 384 px (about 175 m a pixel in the south, finer northward), and the
// coarse grid (0.01°, about 1 km) the soft fields live on. Pure.

export const Z = 9;
export const TILE = 384;
/** Faerûn and its seas: the Moonshaes and Chult to the Great Glacier, the Sword Coast to Thay. */
export const AREA = { west: -84, east: -24, south: 3, north: 60 };
export const COARSE_STEP = 0.01;

const D2R = Math.PI / 180;
const worldX = (lon) => (lon + 180) / 360;
const worldY = (lat) => { const s = Math.sin(lat * D2R); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
const lonOf = (wx) => wx * 360 - 180;
const latOf = (wy) => Math.atan(Math.sinh(Math.PI * (1 - 2 * wy))) / D2R;

/** The baked area's tile range and pixel canvas. */
export function canvasOf(area = AREA, z = Z, tile = TILE) {
  const n = 2 ** z;
  const x0 = Math.floor(worldX(area.west) * n), x1 = Math.floor(worldX(area.east) * n - 1e-9);
  const y0 = Math.floor(worldY(area.north) * n), y1 = Math.floor(worldY(area.south) * n - 1e-9);
  const W = (x1 - x0 + 1) * tile, H = (y1 - y0 + 1) * tile;
  return {
    z, tile, n, x0, x1, y0, y1, W, H,
    /** Canvas pixel (fractional) of a lon/lat. */
    toPixel: (lon, lat) => [(worldX(lon) * n - x0) * tile, (worldY(lat) * n - y0) * tile],
    /** Lon/lat of a canvas pixel position. */
    toLonLat: (px, py) => [lonOf((x0 + px / tile) / n), latOf((y0 + py / tile) / n)],
    /** Metres a pixel spans at a latitude. */
    metresPerPixel: (lat) => (40075016.686 * Math.cos(lat * D2R)) / (n * tile)
  };
}

/** The coarse grid over the area: equirectangular, row 0 at the north. */
export function coarseOf(area = AREA, step = COARSE_STEP) {
  const cols = Math.round((area.east - area.west) / step), rows = Math.round((area.north - area.south) / step);
  return {
    cols, rows, step, area,
    toCell: (lon, lat) => [(lon - area.west) / step, (area.north - lat) / step],
    toLonLat: (cx, cy) => [area.west + cx * step, area.north - cy * step]
  };
}

/** Bilinear sample of a coarse Float32/Uint field at a lon/lat (clamped to the grid). */
export function sampleCoarse(field, coarse, lon, lat) {
  const [fx, fy] = coarse.toCell(lon, lat);
  const x = Math.max(0, Math.min(coarse.cols - 1.001, fx - 0.5)), y = Math.max(0, Math.min(coarse.rows - 1.001, fy - 0.5));
  const xi = Math.floor(x), yi = Math.floor(y), tx = x - xi, ty = y - yi, c = coarse.cols;
  const a = field[yi * c + xi], b = field[yi * c + xi + 1], d = field[(yi + 1) * c + xi], e = field[(yi + 1) * c + xi + 1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
}

/** The categorical value of a coarse field at a lon/lat (nearest cell). */
export function pickCoarse(field, coarse, lon, lat) {
  const [fx, fy] = coarse.toCell(lon, lat);
  const x = Math.max(0, Math.min(coarse.cols - 1, Math.floor(fx))), y = Math.max(0, Math.min(coarse.rows - 1, Math.floor(fy)));
  return field[y * coarse.cols + x];
}

/* ---------------------------------------- */
/*  Polygons onto grids                      */
/* ---------------------------------------- */

/**
 * Even-odd scanline fill of rings (each [[x, y], ...] in grid units) over rows 0..height-1, sampling
 * at row centres: span(row, xa, xb) for each covered run [xa, xb) of whole cells.
 */
export function fillRings(rings, height, width, span) {
  const edges = [];
  let top = Infinity, bottom = -Infinity;
  for (const r of rings) {
    for (let i = 0, n = r.length; i < n; i++) {
      const [ax, ay] = r[i], [bx, by] = r[(i + 1) % n];
      if (ay === by) continue;
      const [x0, y0, x1, y1] = ay < by ? [ax, ay, bx, by] : [bx, by, ax, ay];
      const r0 = Math.max(0, Math.ceil(y0 - 0.5)), r1 = Math.min(height - 1, Math.ceil(y1 - 0.5) - 1);
      if (r1 < r0) continue;
      edges.push({ r0, r1, x0, y0, k: (x1 - x0) / (y1 - y0) });
      if (r0 < top) top = r0;
      if (r1 > bottom) bottom = r1;
    }
  }
  if (!edges.length) return;
  edges.sort((a, b) => a.r0 - b.r0);
  let next = 0;
  let active = [];
  const xs = [];
  for (let row = top; row <= bottom; row++) {
    while (next < edges.length && edges[next].r0 <= row) active.push(edges[next++]);
    active = active.filter((e) => e.r1 >= row);
    xs.length = 0;
    const yc = row + 0.5;
    for (const e of active) xs.push(e.x0 + (yc - e.y0) * e.k);
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.max(0, Math.ceil(xs[i] - 0.5)), xb = Math.min(width, Math.ceil(xs[i + 1] - 0.5));
      if (xb > xa) span(row, xa, xb);
    }
  }
}

/** Set (value 1) or clear (0) bits [xa, xb) of row in a bitmask of rows `width` bits wide. */
export function setBits(bits, width, row, xa, xb, value = 1) {
  const base = row * width;
  let a = base + xa;
  const b = base + xb;
  while (a < b && (a & 7)) { if (value) bits[a >> 3] |= 1 << (a & 7); else bits[a >> 3] &= ~(1 << (a & 7)); a++; }
  const fullEnd = b & ~7;
  if (a < fullEnd) { bits.fill(value ? 0xff : 0, a >> 3, fullEnd >> 3); a = fullEnd; }
  while (a < b) { if (value) bits[a >> 3] |= 1 << (a & 7); else bits[a >> 3] &= ~(1 << (a & 7)); a++; }
}

export const getBit = (bits, width, x, y) => (bits[(y * width + x) >> 3] >> ((y * width + x) & 7)) & 1;

/** A GeoJSON geometry's polygons, each a list of rings of [lon, lat]. */
export function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

/** A GeoJSON geometry's lines, each [[lon, lat], ...]. */
export function linesOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

/**
 * Distance from every cell to the nearest cell where target(i) is true, in cells (two-pass chamfer,
 * 1 and √2 steps). Returns Float32Array.
 */
export function distanceField(cols, rows, target) {
  const INF = 1e9, d = new Float32Array(cols * rows);
  for (let i = 0; i < d.length; i++) d[i] = target(i) ? 0 : INF;
  const D = Math.SQRT2;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + 1);
    if (y > 0) {
      v = Math.min(v, d[i - cols] + 1);
      if (x > 0) v = Math.min(v, d[i - cols - 1] + D);
      if (x < cols - 1) v = Math.min(v, d[i - cols + 1] + D);
    }
    d[i] = v;
  }
  for (let y = rows - 1; y >= 0; y--) for (let x = cols - 1; x >= 0; x--) {
    const i = y * cols + x;
    let v = d[i];
    if (x < cols - 1) v = Math.min(v, d[i + 1] + 1);
    if (y < rows - 1) {
      v = Math.min(v, d[i + cols] + 1);
      if (x < cols - 1) v = Math.min(v, d[i + cols + 1] + D);
      if (x > 0) v = Math.min(v, d[i + cols - 1] + D);
    }
    d[i] = v;
  }
  return d;
}

/** Box blur of a Float32 field, radius r cells, in place (three passes approximate a Gaussian). */
export function blur(field, cols, rows, r, passes = 3) {
  const tmp = new Float32Array(field.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < rows; y++) {
      let acc = 0;
      const o = y * cols;
      for (let x = -r; x <= r; x++) acc += field[o + Math.min(cols - 1, Math.max(0, x))];
      for (let x = 0; x < cols; x++) {
        tmp[o + x] = acc / (2 * r + 1);
        acc += field[o + Math.min(cols - 1, x + r + 1)] - field[o + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < cols; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(rows - 1, Math.max(0, y)) * cols + x];
      for (let y = 0; y < rows; y++) {
        field[y * cols + x] = acc / (2 * r + 1);
        acc += tmp[Math.min(rows - 1, y + r + 1) * cols + x] - tmp[Math.max(0, y - r) * cols + x];
      }
    }
  }
  return field;
}
