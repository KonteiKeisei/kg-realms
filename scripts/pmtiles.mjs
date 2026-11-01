// PMTiles v3: one file holding every map tile of a city, read by byte ranges.
// https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md
// Pure: browser or Node 18+ (CompressionStream, fetch).

const HEADER_BYTES = 127;
const ROOT_MAX = 16384 - HEADER_BYTES;
const COMPRESSION = { none: 1, gzip: 2 };
/** Tile types by name: vector tiles, or images (the baked terrain). */
export const TILE_TYPES = { mvt: 1, png: 2, jpeg: 3, webp: 4 };

/* ---------------------------------------- */
/*  Tile ids: zoom levels in order, Hilbert  */
/*  curve within a level                     */
/* ---------------------------------------- */

export function zxyToTileId(z, x, y) {
  let acc = 0;
  for (let i = 0; i < z; i++) acc += 4 ** i;
  const n = 2 ** z;
  let d = 0;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) { x = s - 1 - x; y = s - 1 - y; }
      [x, y] = [y, x];
    }
  }
  return acc + d;
}

export function tileIdToZxy(id) {
  let z = 0, start = 0;
  while (id >= start + 4 ** z) { start += 4 ** z; z++; }
  let t = id - start, x = 0, y = 0;
  for (let s = 1; s < 2 ** z; s *= 2) {
    const rx = 1 & Math.floor(t / 2), ry = 1 & (t ^ rx);
    if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } [x, y] = [y, x]; }
    x += s * rx; y += s * ry; t = Math.floor(t / 4);
  }
  return { z, x, y };
}

/* ---------------------------------------- */
/*  Bytes                                    */
/* ---------------------------------------- */

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
export const gzip = (bytes) => pipe(bytes, new CompressionStream("gzip"));
export const gunzip = (bytes) => pipe(bytes, new DecompressionStream("gzip"));
/** Gzip data starts 1f 8b. */
export const isGzip = (b) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;

function writeVarint(out, v) {
  while (v >= 0x80) { out.push((v % 0x80) | 0x80); v = Math.floor(v / 0x80); }
  out.push(v);
}

function readVarint(buf, pos) {
  let v = 0, mul = 1, b;
  do { b = buf[pos.i++]; v += (b & 0x7f) * mul; mul *= 0x80; } while (b & 0x80);
  return v;
}

/** Entries { tileId, offset, length, runLength } sorted by tileId, as directory bytes (uncompressed). */
function encodeDirectory(entries) {
  const out = [];
  writeVarint(out, entries.length);
  let last = 0;
  for (const e of entries) { writeVarint(out, e.tileId - last); last = e.tileId; }
  for (const e of entries) writeVarint(out, e.runLength);
  for (const e of entries) writeVarint(out, e.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i], p = entries[i - 1];
    writeVarint(out, i > 0 && e.offset === p.offset + p.length ? 0 : e.offset + 1);
  }
  return new Uint8Array(out);
}

function decodeDirectory(buf) {
  const pos = { i: 0 };
  const n = readVarint(buf, pos);
  const entries = Array.from({ length: n }, () => ({ tileId: 0, offset: 0, length: 0, runLength: 0 }));
  let last = 0;
  for (const e of entries) { last += readVarint(buf, pos); e.tileId = last; }
  for (const e of entries) e.runLength = readVarint(buf, pos);
  for (const e of entries) e.length = readVarint(buf, pos);
  for (let i = 0; i < n; i++) {
    const v = readVarint(buf, pos);
    entries[i].offset = v === 0 && i > 0 ? entries[i - 1].offset + entries[i - 1].length : v - 1;
  }
  return entries;
}

/* ---------------------------------------- */
/*  Writing                                  */
/* ---------------------------------------- */

const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * An archive from tiles [{ z, x, y, data }] (data: gzipped MVT bytes, or image bytes with
 * meta.tileType "webp", "png" or "jpeg"). Identical tiles (open water, empty land) are stored
 * once. Returns the file's bytes.
 * meta: { bounds: { north, south, west, east }, minZoom, maxZoom, center: [lon, lat, zoom], metadata, tileType }
 */
export async function writeArchive(tiles, meta) {
  const sorted = tiles.map((t) => ({ ...t, tileId: zxyToTileId(t.z, t.x, t.y) })).sort((a, b) => a.tileId - b.tileId);
  const byHash = new Map();
  const chunks = [];
  const entries = [];
  let offset = 0;
  for (const t of sorted) {
    const h = hex(await crypto.subtle.digest("SHA-1", t.data));
    let at = byHash.get(h);
    if (at === undefined) {
      at = { offset, length: t.data.length };
      byHash.set(h, at);
      chunks.push(t.data);
      offset += t.data.length;
    }
    const prev = entries.at(-1);
    // Runs of the same tile at consecutive ids share one entry.
    if (prev && prev.offset === at.offset && prev.tileId + prev.runLength === t.tileId) prev.runLength++;
    else entries.push({ tileId: t.tileId, offset: at.offset, length: at.length, runLength: 1 });
  }

  // A root directory, with leaf directories when it would not fit in the first 16 KiB.
  let root = await gzip(encodeDirectory(entries));
  let leaves = new Uint8Array(0);
  for (let leafSize = 4096; root.length > ROOT_MAX; leafSize *= 2) {
    const leafBytes = [], rootEntries = [];
    let leafOffset = 0;
    for (let i = 0; i < entries.length; i += leafSize) {
      const leaf = await gzip(encodeDirectory(entries.slice(i, i + leafSize)));
      rootEntries.push({ tileId: entries[i].tileId, offset: leafOffset, length: leaf.length, runLength: 0 });
      leafBytes.push(leaf);
      leafOffset += leaf.length;
    }
    root = await gzip(encodeDirectory(rootEntries));
    leaves = concat(leafBytes);
  }
  const metadata = await gzip(new TextEncoder().encode(JSON.stringify(meta.metadata ?? {})));
  const data = concat(chunks);

  const header = new ArrayBuffer(HEADER_BYTES);
  const v = new DataView(header);
  new Uint8Array(header).set(new TextEncoder().encode("PMTiles"), 0);
  v.setUint8(7, 3);
  const u64 = (at, n) => v.setBigUint64(at, BigInt(n), true);
  const rootOffset = HEADER_BYTES;
  const metaOffset = rootOffset + root.length;
  const leafOffset = metaOffset + metadata.length;
  const dataOffset = leafOffset + leaves.length;
  u64(8, rootOffset); u64(16, root.length);
  u64(24, metaOffset); u64(32, metadata.length);
  u64(40, leafOffset); u64(48, leaves.length);
  u64(56, dataOffset); u64(64, data.length);
  u64(72, sorted.length); u64(80, entries.length); u64(88, byHash.size);
  v.setUint8(96, 1); // clustered
  const type = TILE_TYPES[meta.tileType ?? "mvt"];
  v.setUint8(97, COMPRESSION.gzip);
  // Images are compressed already; vector tiles come gzipped.
  v.setUint8(98, type === TILE_TYPES.mvt ? COMPRESSION.gzip : COMPRESSION.none);
  v.setUint8(99, type);
  v.setUint8(100, meta.minZoom);
  v.setUint8(101, meta.maxZoom);
  const e7 = (d) => Math.round(d * 1e7);
  const b = meta.bounds;
  v.setInt32(102, e7(b.west), true); v.setInt32(106, e7(b.south), true);
  v.setInt32(110, e7(b.east), true); v.setInt32(114, e7(b.north), true);
  const [clon, clat, cz] = meta.center ?? [(b.west + b.east) / 2, (b.south + b.north) / 2, meta.minZoom];
  v.setUint8(118, cz); v.setInt32(119, e7(clon), true); v.setInt32(123, e7(clat), true);
  return concat([new Uint8Array(header), root, metadata, leaves, data]);
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/* ---------------------------------------- */
/*  Reading                                  */
/* ---------------------------------------- */

/**
 * Reads tiles from an archive by byte ranges. source: a URL (fetched with Range requests, or
 * whole when the server ignores them) or the archive's bytes.
 */
export class Archive {
  constructor(source) {
    this.source = source;
    this.bytes = source instanceof Uint8Array ? source : null;
    this.header = null;
    this.leaves = new Map();
    this.failures = 0;
    this.wholeFile = null;
  }

  async #range(offset, length) {
    if (this.bytes) return this.bytes.subarray(offset, offset + length);
    if (typeof this.source?.readRange === 'function') return this.source.readRange(offset, length);
    if (this.wholeFile) { await this.wholeFile; return this.bytes.subarray(offset, offset + length); }
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(this.source, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        // A server that ignores Range sends the whole file: keep it and read from memory.
        if (res.status === 200 && buf.length > length) { this.bytes = buf; return buf.subarray(offset, offset + length); }
        this.failures = 0;
        return buf;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
    // Part requests keep failing (some proxies drop them): read the whole file once instead.
    if (++this.failures >= 3 && typeof this.source === "string") {
      await this.#loadWhole();
      return this.bytes.subarray(offset, offset + length);
    }
    throw new Error(`could not read the map archive at ${this.source} (${lastErr?.message ?? "no answer"})`);
  }

  #loadWhole() {
    this.wholeFile ??= fetch(this.source, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.bytes = new Uint8Array(await res.arrayBuffer());
      })
      .catch((err) => { this.wholeFile = null; throw new Error(`could not read the city map at ${this.source} (${err.message})`); });
    return this.wholeFile;
  }

  async #inflate(buf) {
    return this.header.internalCompression === COMPRESSION.gzip ? gunzip(buf) : buf;
  }

  /** Read the header and root directory, once: concurrent callers share the same read. */
  init() {
    this.opening ??= this.#open().catch((err) => { this.opening = null; throw err; });
    return this.opening;
  }

  async #open() {
    const isArchive = (b) => b.length >= 8 && new TextDecoder().decode(b.subarray(0, 7)) === "PMTiles" && b[7] === 3;
    let first = await this.#range(0, 16384);
    if (!isArchive(first) && !this.bytes && typeof this.source === "string") {
      // Some hosts (proxies, CDNs) answer a part request with something else: take the whole file.
      const res = await fetch(this.source, { cache: "no-store" }).catch((err) => { throw new Error(`could not reach the city map at ${this.source} (${err.message})`); });
      const whole = new Uint8Array(await res.arrayBuffer());
      if (!isArchive(whole)) {
        const head = new TextDecoder().decode(whole.subarray(0, 60)).replace(/\s+/g, " ").trim();
        throw new Error(`the city map file did not load (HTTP ${res.status}, ${res.headers.get("content-type") ?? "no type"}, ${whole.length} bytes, starts "${head}"). Generate the city again with "Download again" ticked; if this repeats, the server may limit upload size or rewrite the file.`);
      }
      this.bytes = whole;
      first = whole.subarray(0, 16384);
    }
    if (!isArchive(first)) throw new Error("the city map file is not a map archive; generate the city again with \"Download again\" ticked");
    const v = new DataView(first.buffer, first.byteOffset, first.byteLength);
    const u64 = (at) => Number(v.getBigUint64(at, true));
    const e7 = (at) => v.getInt32(at, true) / 1e7;
    this.header = {
      rootOffset: u64(8), rootLength: u64(16), metaOffset: u64(24), metaLength: u64(32),
      leafOffset: u64(40), dataOffset: u64(56),
      internalCompression: v.getUint8(97), tileCompression: v.getUint8(98),
      minZoom: v.getUint8(100), maxZoom: v.getUint8(101),
      bounds: { west: e7(102), south: e7(106), east: e7(110), north: e7(114) }
    };
    const h = this.header;
    const rootBytes = h.rootOffset + h.rootLength <= first.length ? first.subarray(h.rootOffset, h.rootOffset + h.rootLength) : await this.#range(h.rootOffset, h.rootLength);
    this.root = decodeDirectory(await this.#inflate(rootBytes));
    return h;
  }

  async metadata() {
    await this.init();
    const h = this.header;
    const bytes = await this.#inflate(await this.#range(h.metaOffset, h.metaLength));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  /** Flatten the archive directories without loading its imagery. */
  async entries() {
    await this.init();
    const walk = async (dir) => {
      const out = [];
      for (const e of dir) {
        if (e.runLength) out.push(e);
        else out.push(...await walk(decodeDirectory(await this.#inflate(await this.#range(this.header.leafOffset + e.offset, e.length)))));
      }
      return out;
    };
    return walk(this.root);
  }

  /** The tile's MVT bytes (uncompressed), or null where the archive has none. */
  async tile(z, x, y) {
    await this.init();
    const id = zxyToTileId(z, x, y);
    let dir = this.root;
    for (let depth = 0; depth < 4; depth++) {
      const e = find(dir, id);
      if (!e) return null;
      if (e.runLength > 0) {
        const bytes = await this.#range(this.header.dataOffset + e.offset, e.length);
        return this.header.tileCompression === COMPRESSION.gzip || isGzip(bytes) ? gunzip(bytes) : bytes;
      }
      const key = e.offset;
      if (!this.leaves.has(key)) this.leaves.set(key, this.#range(this.header.leafOffset + e.offset, e.length).then((b) => this.#inflate(b)).then(decodeDirectory));
      dir = await this.leaves.get(key);
    }
    return null;
  }
}

/** The entry covering a tile id: an exact or run match, or the leaf directory it falls in. */
function find(entries, id) {
  let lo = 0, hi = entries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = id - entries[mid].tileId;
    if (c > 0) lo = mid + 1;
    else if (c < 0) hi = mid - 1;
    else return entries[mid];
  }
  if (hi >= 0) {
    const e = entries[hi];
    if (e.runLength === 0) return e;
    if (id - e.tileId < e.runLength) return e;
  }
  return null;
}
