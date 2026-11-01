// Homebrew realm worlds (0.74): the pure parts. A GM's map picture becomes a world's map sheet,
// placed flat in the web map's pixel space at its native zoom, so one picture pixel is one sheet
// pixel and travel (sheet pixels times miles per pixel) has no distortion. The picture is cut into
// KTX2 tiles laid out exactly as tools/build-terrain-pack.mjs lays out Toril's.

/** Browsers cannot hold a canvas larger than this on a side: bigger pictures are shrunk to it. */
export const MAX_PICTURE = 16384;
/** Foundry uploads only listed file types; KTX2 is not one. Tiles keep their bytes under a binary type. */
export const TILE_SUFFIX = ".ktx2.fbx";
const TILE = 512;

/** A world id from its name: lowercase letters, digits and dashes, not one of `taken`. */
export function worldIdFrom(name, taken = []) {
  const base = String(name ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "world";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

const lonOf = (x, size) => (x / size) * 360 - 180;
const latOf = (y, size) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI;

/**
 * How many times larger than the picture its web map world is. Realm scenes stop zooming out while
 * the world is still 2.6 screens wide (main.mjs), so the whole picture fits on screen only when the
 * world is well over twice its size (0.74.2; Toril's is about five times).
 */
export const WORLD_MARGIN = 4;

/**
 * The map sheet for a picture `width` x `height` px that is `miles` across: centred in a web map
 * world at least WORLD_MARGIN times its size (kept well away from the poles), tile aligned.
 */
export function homebrewSheet(width, height, miles) {
  width = Math.round(width); height = Math.round(height);
  if (!(width > 0 && height > 0 && miles > 0)) throw Error("A map needs a size and a width in miles.");
  const nativeZoom = Math.max(0, Math.ceil(Math.log2((WORLD_MARGIN * Math.max(width, height)) / TILE)));
  const worldSize = TILE * 2 ** nativeZoom;
  const x = Math.floor((worldSize - width) / 2 / TILE) * TILE, y = Math.floor((worldSize - height) / 2 / TILE) * TILE;
  return {
    width, height, tileSize: TILE, nativeZoom, detailZoom: nativeZoom, maxZoom: 22, minZoom: 0, x, y, worldSize,
    milesPerPixel: miles / width,
    bounds: { west: lonOf(x, worldSize), north: latOf(y, worldSize), east: lonOf(x + width, worldSize), south: latOf(y + height, worldSize), mapWidthMiles: miles }
  };
}

/**
 * The detail levels and tiles for a sheet. An overview at a quarter size (when the picture is big
 * enough to need one) and the picture at full size. Each tile carries where to cut it from the
 * picture (`crop`, in that level's pixels, with a 2 px border copied from its neighbours).
 */
export function planTiles(sheet) {
  const n = sheet.nativeZoom, big = Math.max(sheet.width, sheet.height) > 4096;
  const levels = big ? [[n - 2, 2044], [n, 1020]] : [[n, 1020]];
  return levels.map(([z, SIZE]) => {
    const scale = 2 ** (z - n), width = Math.round(sheet.width * scale), height = Math.round(sheet.height * scale);
    const lod = { z, width, height, scale, tiles: [] };
    for (let py = 0; py < height; py += SIZE) for (let px = 0; px < width; px += SIZE) {
      const pw = Math.min(SIZE, width - px), ph = Math.min(SIZE, height - py);
      const tw = Math.ceil((pw + 4) / 4) * 4, th = Math.ceil((ph + 4) / 4) * 4, id = `z${z}-${px}-${py}`;
      const left = Math.max(0, px - 2), top = Math.max(0, py - 2), right = Math.min(width, px + pw + 2), bottom = Math.min(height, py + ph + 2);
      lod.tiles.push({
        id, lod: z, x: px / scale, y: py / scale,
        width: Math.min(pw / scale, sheet.width - px / scale), height: Math.min(ph / scale, sheet.height - py / scale),
        textureWidth: tw, textureHeight: th, frameX: 2, frameY: 2,
        frameWidth: Math.min(pw, (sheet.width - px / scale) * scale), frameHeight: Math.min(ph, (sheet.height - py / scale) * scale),
        path: `assets/terrain/${id}${TILE_SUFFIX}`,
        crop: { left, top, right, bottom, padLeft: px === 0 ? 2 : 0, padTop: py === 0 ? 2 : 0, scale }
      });
    }
    return lod;
  });
}

/**
 * A made world's index and pack placed on the current sheet rules, or null when they already are.
 * Tiles keep their files (found by hash) and sheet positions; only their detail levels move with the
 * native zoom. The caller sets the pack's fingerprint. Anything placed in longitude and latitude
 * would shift, so callers only do this for worlds with nothing on them.
 */
export function resheet(index, pack) {
  const old = index.sourceMap, sheet = homebrewSheet(old.width, old.height, old.bounds.mapWidthMiles);
  if (sheet.nativeZoom === old.nativeZoom && sheet.worldSize === old.worldSize && sheet.x === old.x && sheet.y === old.y) return null;
  const dz = sheet.nativeZoom - old.nativeZoom;
  const lods = pack.lods.map((l) => ({ ...l, z: l.z + dz, tiles: l.tiles.map((t) => ({ ...t, lod: t.lod + dz })) }));
  return { index: { ...index, sourceMap: sheet, mainMap: { bounds: sheet.bounds } }, pack: { ...pack, sourceMap: sheet, lods } };
}

/** The pack manifest (terrain-pack.json) once every tile has its `ktxBytes` and `hash`. */
export function packManifest(id, sheet, lods, fingerprint) {
  const clean = lods.map((l) => ({ ...l, tiles: l.tiles.map(({ crop, ...t }) => t) }));
  return { schema: 1, id: `${id}-terrain`, version: "1", codec: "ETC1S quality 255", sourceMap: sheet, lods: clean, totalBytes: clean.flatMap((l) => l.tiles).reduce((n, t) => n + t.ktxBytes, 0), fingerprint };
}

/** The world's routes file. Foundry refuses to upload .geojson files, so homebrew worlds use .json. */
export const ROUTES_FILE = "routes.json";

/** The world's index.json: the sheet and nothing on it yet. */
export function emptyIndex(id, name, sheet) {
  return { world: id, name, source: "", notice: "", homebrew: true, regions: [], places: [], mainMap: { bounds: sheet.bounds }, sourceMap: sheet, routes: ROUTES_FILE };
}

/** The map width in miles a scene's grid already gives (40 miles per 100 px on 8,192 px is 3,277), or null. */
export function milesFromGrid(width, grid) {
  if (!/^mi(les?)?\.?$/i.test(String(grid?.units ?? "").trim()) || !(grid?.size > 0) || !(grid?.distance > 0) || !(width > 0)) return null;
  return Math.round((width / grid.size) * grid.distance);
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** A zip of `files` ({ name, bytes }), stored without compression (the tiles are compressed already). */
export function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), bytes = f.bytes instanceof Uint8Array ? f.bytes : enc.encode(String(f.bytes)), crc = crc32(bytes);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true);
    local.setUint32(14, crc, true); local.setUint32(18, bytes.length, true); local.setUint32(22, bytes.length, true); local.setUint16(26, name.length, true);
    const head = new DataView(new ArrayBuffer(46));
    head.setUint32(0, 0x02014b50, true); head.setUint16(4, 20, true); head.setUint16(6, 20, true); head.setUint16(8, 0x0800, true);
    head.setUint32(16, crc, true); head.setUint32(20, bytes.length, true); head.setUint32(24, bytes.length, true); head.setUint16(28, name.length, true); head.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), name, bytes); central.push(new Uint8Array(head.buffer), name);
    offset += 30 + name.length + bytes.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0; for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

/** An exported world module's id from its title. */
export const moduleIdFrom = (title) => `kg-realms-${worldIdFrom(String(title ?? "").replace(/^kg\s*realms\s*:?\s*/i, ""))}`;

/** The script an exported world module runs: it registers the world with KG Realms. */
export function moduleScript(moduleId, def, { snow } = {}) {
  const world = { id: def.id, title: def.title, module: moduleId, mapName: def.mapName ?? def.title, terrainPack: "terrain-pack.json" };
  // Its snow as the GM set it (the Snow tab, 0.75) becomes the module's own.
  if (snow && Object.keys(snow).length) world.snow = snow;
  return `// ${def.title} for KG Realms: registers the world as KG Realms starts.\nHooks.once("kgRealmsRegisterWorlds", ({ registerWorld }) => registerWorld(${JSON.stringify(world)}));\n`;
}
