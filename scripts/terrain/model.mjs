import { canvasOf, coarseOf, sampleCoarse } from './grid.mjs';
import { CLIMATES } from './fields-codes.mjs';

/** Binary model envelope: JSON descriptor and independently aligned typed-array sections. */
export function encodeModel(meta, arrays) {
  meta.arrays = Object.fromEntries(Object.entries(arrays).map(([k, a]) => [k, [a.constructor.name, a.byteLength]]));
  const json = new TextEncoder().encode(JSON.stringify(meta));
  const result = new Uint8Array(4 + json.length + Object.values(arrays).reduce((n, a) => n + a.byteLength, 0));
  new DataView(result.buffer).setUint32(0, json.length, true);
  result.set(json, 4);
  let at = 4 + json.length;
  for (const a of Object.values(arrays)) { result.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), at); at += a.byteLength; }
  return result;
}
export function decodeModel(bytes) {
  const n = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + n)));
  const types = { Uint8Array, Int16Array, Float32Array };
  const arrays = {};
  let at = 4 + n;
  for (const [k, [type, length]] of Object.entries(meta.arrays)) {
    arrays[k] = new types[type](bytes.slice(at, at + length).buffer); at += length;
  }
  return { meta, arrays };
}

export function modelContext(model, z, tile = 256) {
  const { meta: m, arrays: a } = model;
  for(const [key,scale]of Object.entries(m.fieldScales??{})) {
    if(!(a[key] instanceof Float32Array))a[key]=Float32Array.from(a[key],v=>v/scale);
  }
  const canvas = canvasOf(m.base.area, z, tile), baseCanvas = canvasOf(m.base.area, m.base.z, m.base.tile);
  const coarse = coarseOf(m.coarse.area, m.coarse.step);
  const signed = (lon, lat) => sampleCoarse(a.distance, m.maskGrid, lon, lat) / (m.distanceScale ?? 1);
  // The signed shore grid is Mercator rather than equirectangular.
  m.maskGrid = { cols: m.mask.N, rows: m.mask.N, toCell: (lon, lat) => {
    const [x, y] = baseCanvas.toPixel(lon, lat); return [x - m.mask.ox, y - m.mask.oy];
  } };
  return { canvas, baseCanvas, coarse, climates: CLIMATES, fields: a,
    dem: { ...m.dem, data: a.dem }, peaks: m.peaks, nearSettlements: m.settlements,
    landAt: (lon, lat) => signed(lon, lat) >= 0,
    nearAt: (lon, lat) => Math.min(16, Math.abs(signed(lon, lat)) + 0.5) };
}

/** Clip a ring to a rectangle; preserves even-odd fill for islands and lake holes. */
export function clipRing(ring, bounds) {
  let pts = ring.slice(0, -1);
  for (const [axis, edge, greater] of [[0, bounds[0], true], [0, bounds[2], false], [1, bounds[1], true], [1, bounds[3], false]]) {
    const next = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ain = greater ? a[axis] >= edge : a[axis] <= edge, bin = greater ? b[axis] >= edge : b[axis] <= edge;
      if (ain) next.push(a);
      if (ain !== bin) { const t = (edge - a[axis]) / (b[axis] - a[axis]); next.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]); }
    }
    pts = next;
  }
  if (pts.length > 2) pts.push(pts[0]);
  return pts;
}
