// Web Mercator, tile math and US units. Pure: no Foundry.
//
// "World" coordinates are normalised Web Mercator: x and y run 0..1 across the whole
// globe, y pointing south. A tile at zoom z covers 1 / 2^z of the world on each side.
// A "frame" stretches a lat/lon bounding box exactly over the scene rectangle:
// scene = origin + (kx, ky) * world.

export const TILE_SIZE = 256;
const MAX_LAT = 85.05112878;
const D2R = Math.PI / 180;

export function toWorld(lat, lon) {
  const s = Math.sin(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * D2R);
  return { x: (lon + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) };
}

export function fromWorld(x, y) {
  return { lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / D2R, lon: x * 360 - 180 };
}

/** World rectangle of a lat/lon box. */
export function worldBounds({ north, south, west, east }) {
  const nw = toWorld(north, west);
  const se = toWorld(south, east);
  return { x0: nw.x, y0: nw.y, x1: se.x, y1: se.y };
}

/** Height over width of a lat/lon box, as it appears on the map. */
export function aspect(bounds) {
  const w = worldBounds(bounds);
  return (w.y1 - w.y0) / (w.x1 - w.x0);
}

/**
 * Stretch the box exactly over rect ({ x, y, width, height }): its corners are the scene
 * corners. When the shapes match, kx equals ky. k is the horizontal scale, used for zoom.
 */
export function makeFrame(bounds, rect) {
  const world = worldBounds(bounds);
  const kx = rect.width / (world.x1 - world.x0);
  const ky = rect.height / (world.y1 - world.y0);
  return { k: kx, kx, ky, ox: rect.x - kx * world.x0, oy: rect.y - ky * world.y0, world };
}

export function worldToScene(frame, { x, y }) {
  return { x: frame.ox + frame.kx * x, y: frame.oy + frame.ky * y };
}

export function sceneToWorld(frame, { x, y }) {
  return { x: (x - frame.ox) / frame.kx, y: (y - frame.oy) / frame.ky };
}

export function latLonToScene(frame, lat, lon) {
  return frame.project ? frame.project(lat,lon) : worldToScene(frame, toWorld(lat, lon));
}

export function sceneToLatLon(frame, p) {
  if(frame.unproject)return frame.unproject(p);
  const w = sceneToWorld(frame, p);
  return fromWorld(w.x, w.y);
}

/** Fractional tile zoom at which one tile pixel is one screen pixel, at this canvas scale. */
export function idealTileZoom(frame, canvasScale) {
  return Math.log2((canvasScale * frame.k) / TILE_SIZE);
}

/** Canvas scale at which tile zoom z shows at one tile pixel per screen pixel. */
export function canvasScaleForTileZoom(frame, z) {
  return (TILE_SIZE * 2 ** z) / frame.k;
}

/** Inclusive tile index range covering a world rectangle at zoom z. */
export function tileRange(z, rect) {
  const n = 2 ** z;
  const clamp = (v) => Math.max(0, Math.min(n - 1, v));
  return {
    x0: clamp(Math.floor(rect.x0 * n)), y0: clamp(Math.floor(rect.y0 * n)),
    x1: clamp(Math.floor(rect.x1 * n - 1e-9)), y1: clamp(Math.floor(rect.y1 * n - 1e-9))
  };
}

export function tileCount(range) {
  return (range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1);
}

/** World rectangle of one tile. */
export function tileWorldRect(z, x, y) {
  const n = 2 ** z;
  return { x0: x / n, y0: y / n, x1: (x + 1) / n, y1: (y + 1) / n };
}

export function intersect(a, b) {
  const r = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
}

/**
 * The least canvas scale at which the map's whole world still reaches past every screen edge,
 * wherever the camera sits on the canvas (0..canvas.width, 0..canvas.height, padding included).
 * frame: makeFrame's (the world spans ox..ox+kx, oy..oy+ky in scene px); screen in CSS px.
 */
export function worldFloor(frame, canvas, screenWidth, screenHeight, margin = 1.1) {
  const room = (o, k, size) => Math.min(-o, o + k - size);
  const rx = room(frame.ox, frame.kx, canvas.width), ry = room(frame.oy, frame.ky, canvas.height);
  // A world no wider than the canvas: the old rule, the world at least 2.6 screens across.
  if (!(rx > 0 && ry > 0)) return (2.6 * Math.max(screenWidth, screenHeight)) / frame.k;
  return margin * Math.max(screenWidth / (2 * rx), screenHeight / (2 * ry));
}

/** Deepest zoom at which the whole world rectangle fits in at most maxTiles tiles. */
export function overviewZoom(rect, maxTiles, minZoom = 0, maxZoom = 22) {
  let best = minZoom;
  for (let z = minZoom; z <= maxZoom; z++) {
    if (tileCount(tileRange(z, rect)) > maxTiles) break;
    best = z;
  }
  return best;
}

/* ---------------------------------------- */
/*  Distances and units                      */
/* ---------------------------------------- */

export const FEET_PER_METRE = 3.28084;
export const METRES_PER_MILE = 1609.344;

/** Metres between two { lat, lon } points (equirectangular, fine at city scale). */
export function metres(a, b) {
  const k = D2R;
  const x = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * k);
  const y = b.lat - a.lat;
  return Math.hypot(x, y) * k * 6371000;
}

/** "350 ft", "0.4 mi", "12 mi": feet under a tenth of a mile. */
export function formatDistance(m) {
  const mi = m / METRES_PER_MILE;
  if (mi < 0.1) return `${Math.round((m * FEET_PER_METRE) / 10) * 10} ft`;
  return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}

/** A lat/lon box of so many miles [wide, tall] around a [lon, lat] centre. */
export function boxAround([lon, lat], [wideMiles, tallMiles]) {
  const dLat = (tallMiles * METRES_PER_MILE) / 111320 / 2;
  const dLon = (wideMiles * METRES_PER_MILE) / (111320 * Math.cos(lat * D2R)) / 2;
  return { north: lat + dLat, south: lat - dLat, west: lon - dLon, east: lon + dLon };
}

/**
 * Scene size in pixels for a lat/lon box at a real scale (feet per pixel), shaped like the box
 * on the map so the frame is not stretched (kx equals ky).
 */
export function sceneSize(bounds, feetPerPixel) {
  const mid = (bounds.north + bounds.south) / 2;
  const widthFeet = metres({ lat: mid, lon: bounds.west }, { lat: mid, lon: bounds.east }) * FEET_PER_METRE;
  const width = Math.round(widthFeet / feetPerPixel);
  return { width, height: Math.round(width * aspect(bounds)) };
}