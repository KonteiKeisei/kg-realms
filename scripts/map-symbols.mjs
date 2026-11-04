// Place markers. Two kinds of image, both drawn with a contrasting halo so they read on any
// terrain (a white edge around dark marks, a dark edge around light ones):
//  - "faerun-<shape>": the Faerun map key (city, town, village, castle, ruin, peak, dungeon,
//    tower, site), drawn on a canvas;
//  - "mk-<id>": picture markers, the shipped catalog (data/markers/catalog.json) and the GM's
//    own (a world setting), loaded from their image files.
const SHAPES = ['city', 'town', 'village', 'keep', 'ruin', 'dungeon', 'peak', 'tower', 'site'];

/** Draw a key symbol on a 48 px canvas, then a halo of the opposite tone around it. */
function keySymbol(shape) {
  const S = 48, c0 = document.createElement('canvas'); c0.width = c0.height = S;
  const c = c0.getContext('2d'), ink = '#151515', paper = '#fbf6e6';
  c.translate(4, 4);
  const circle = (r, fill, stroke, w = 3) => { c.beginPath(); c.arc(20, 20, r, 0, Math.PI * 2); if (fill) { c.fillStyle = fill; c.fill(); } if (stroke) { c.strokeStyle = stroke; c.lineWidth = w; c.stroke(); } };
  if (shape === 'city') { circle(12, ink); circle(8.5, paper); circle(5.5, ink); }
  else if (shape === 'town') { circle(9, ink); }
  else if (shape === 'village') { circle(7.5, paper, ink, 3); }
  else if (shape === 'keep') { c.fillStyle = paper; c.fillRect(11, 11, 18, 18); c.strokeStyle = ink; c.lineWidth = 3; c.strokeRect(11, 11, 18, 18); }
  else if (shape === 'ruin') { c.fillStyle = ink; c.fillRect(11, 11, 18, 18); }
  else if (shape === 'dungeon') { c.fillStyle = ink; c.beginPath(); c.moveTo(8, 11); c.lineTo(32, 11); c.lineTo(20, 31); c.closePath(); c.fill(); }
  else if (shape === 'peak') { c.fillStyle = paper; c.strokeStyle = ink; c.lineWidth = 3; c.beginPath(); c.moveTo(20, 8); c.lineTo(32, 30); c.lineTo(8, 30); c.closePath(); c.fill(); c.stroke(); }
  else if (shape === 'tower') { c.fillStyle = ink; c.fillRect(15, 12, 10, 19); c.fillRect(12, 8, 4, 6); c.fillRect(18, 8, 4, 6); c.fillRect(24, 8, 4, 6); }
  else { c.strokeStyle = ink; c.lineWidth = 4.5; c.lineCap = 'round'; c.beginPath(); c.moveTo(12, 12); c.lineTo(28, 28); c.moveTo(28, 12); c.lineTo(12, 28); c.stroke(); }
  return withHalo(c0);
}

/** A copy of an image fitted to `size`, with a 3 px halo in the tone opposite to its ink. */
export function withHalo(src, size = 48) {
  const out = document.createElement('canvas'); out.width = out.height = size;
  const o = out.getContext('2d', { willReadFrequently: true });
  const w = src.width, h = src.height, k = (size - 8) / Math.max(w, h);
  const dw = w * k, dh = h * k, dx = (size - dw) / 2, dy = (size - dh) / 2;
  const probe = document.createElement('canvas'); probe.width = probe.height = size;
  const p = probe.getContext('2d', { willReadFrequently: true }); p.drawImage(src, dx, dy, dw, dh);
  const px = p.getImageData(0, 0, size, size).data;
  let sum = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 128) { sum += px[i] + px[i + 1] + px[i + 2]; n += 3; }
  const halo = n && sum / n < 150 ? '#ffffff' : '#141414';
  const tint = document.createElement('canvas'); tint.width = tint.height = size;
  const t = tint.getContext('2d'); t.drawImage(probe, 0, 0); t.globalCompositeOperation = 'source-in'; t.fillStyle = halo; t.fillRect(0, 0, size, size);
  for (let a = 0; a < 16; a++) o.drawImage(tint, Math.cos(a * Math.PI / 8) * 3, Math.sin(a * Math.PI / 8) * 3);
  o.drawImage(probe, 0, 0);
  return o.getImageData(0, 0, size, size);
}

let catalog = null;
/** The shipped picture markers: [{ id, name, file, group }]. */
export function markerCatalog(base) {
  catalog ??= fetch(`${base}data/markers/catalog.json`).then((r) => r.json()).catch(() => []);
  return catalog;
}

/**
 * Install marker images on a MapLibre map. base: the module's URL root; custom(): the GM's
 * markers { [id]: { name, src } }. Returns { preload(placesGeoJSON) }, which loads the places' picture markers.
 */
export function installMapSymbols(map, { base = '', custom = () => ({}) } = {}) {
  // Loaded images are kept, so a new style (day to night) gets them back at once.
  const loaded = new Map(), pending = new Set();
  let relayout = null;
  const put = (id, data) => { if (!map.hasImage(id)) map.addImage(id, data, { pixelRatio: 2 }); };
  const add = async (id) => {
    if (map.hasImage(id)) return;
    if (loaded.has(id)) return put(id, loaded.get(id));
    if (id.startsWith('faerun-')) { loaded.set(id, keySymbol(id.slice(7))); return put(id, loaded.get(id)); }
    if (id === 'kgr-camp' || id === 'kgr-camp-done') {
      if (pending.has(id)) return;
      pending.add(id);
      try { loaded.set(id, await campIcon(id === 'kgr-camp-done')); put(id, loaded.get(id)); } finally { pending.delete(id); }
      return;
    }
    if (!id.startsWith('mk-') || pending.has(id)) return;
    pending.add(id);
    try {
      const key = id.slice(3), own = custom()[key];
      const src = own?.src ?? `${base}data/markers/${key}.png`;
      // Fetched like the map's tiles (an <img> with crossOrigin fails silently behind some hosts' redirects).
      const res = await fetch(src);
      if (!res.ok) throw new Error(`${res.status} ${src}`);
      const img = await createImageBitmap(await res.blob());
      loaded.set(id, own ? withHalo(img, 64) : imageData(img));
      put(id, loaded.get(id));
      // MapLibre lays a tile out without an image that arrives late: lay the places out again.
      clearTimeout(relayout);
      relayout = setTimeout(() => { const s = map.getSource('places'), d = s?._data?.geojson ?? s?._data; if (d && typeof d === 'object') s.setData(d); }, 50);
    } catch (err) { console.warn(`kg-realms | marker ${id} could not be loaded; the place shows its map-key symbol.`, err); }
    finally { pending.delete(id); }
  };
  map.on('styleimagemissing', ({ id }) => add(id));
  const restore = () => { for (const s of SHAPES) add(`faerun-${s}`); add('kgr-camp'); add('kgr-camp-done'); for (const id of loaded.keys()) add(id); };
  map.on('style.load', restore);
  map.on('styledata', restore);
  // Picture markers are asked for here, not by the map: the style falls back to the key symbol
  // until a picture arrives, so the map never asks for a missing one.
  return { preload: (fc) => { for (const f of fc?.features ?? []) { const id = f.properties?.icon; if (id?.startsWith('mk-')) add(id); } } };
}

/**
 * The camp site marker: Font Awesome's campground (as Foundry loads it), dark ink with a cream
 * outline like the map's own markers; grey once the party has passed that night.
 */
async function campIcon(done) {
  const probe = document.createElement('i');
  probe.className = 'fa-solid fa-campground';
  probe.style.cssText = 'position:absolute;visibility:hidden';
  document.body.append(probe);
  const family = getComputedStyle(probe).fontFamily || '"Font Awesome 6 Free"';
  probe.remove();
  const S = 64, font = `900 ${S * 0.78}px ${family}`;
  try { await document.fonts.load(font, '\uf6bb'); } catch { /* drawn with what is there */ }
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d');
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = 8; g.strokeStyle = done ? 'rgba(244,236,216,0.75)' : '#f4ecd8';
  g.strokeText('\uf6bb', S / 2, S / 2 + 2);
  g.fillStyle = done ? '#77736a' : '#1a1408';
  g.fillText('\uf6bb', S / 2, S / 2 + 2);
  return g.getImageData(0, 0, S, S);
}

function imageData(img) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, img.width, img.height);
}

/** The map-key shape of a place (from its printed marker, else its class), or '' for none. */
export function symbolFor(place) {
  if (place.sourceSymbol) return { hamlet: 'village', poi: 'site' }[place.sourceSymbol] ?? place.sourceSymbol;
  if (['Road', 'Trail', 'Area', 'Region', 'Macroregion', 'Sea', 'Lake', 'River', 'Forest', 'Mountains', 'Hills', 'Hill', 'Marsh', 'Swamp', 'Moor', 'Desert', 'Glacier', 'Island', 'Islands', 'Valley', 'Plain'].includes(place.class) || place.kind === 'natural' || place.kind === 'territory' || place.kind === 'domain') return '';
  if (place.class === 'City') return 'city';
  if (place.class === 'Town') return 'town';
  if (place.kind === 'settlement') return 'village';
  if (['Fortification', 'Keep', 'Fort', 'Castle'].includes(place.class)) return 'keep';
  if (['Ruins', 'Ruin'].includes(place.class)) return 'ruin';
  if (['Cave', 'Cavern', 'Tomb', 'Mine', 'Dungeon', 'Lair'].includes(place.class)) return 'dungeon';
  if (['Volcano', 'Peak', 'Mountain'].includes(place.class)) return 'peak';
  if (place.class === 'Tower') return 'tower';
  return 'site';
}

// Default picture markers for some kinds of site, where the catalog has a fitting symbol.
const BY_CLASS = { Battlefield: 'swords', Temple: 'temple', Shipwreck: 'anchor-grey', Lair: 'skull', Mine: 'cave', Cave: 'cave', Cavern: 'cave' };

/** The map image for a place: its chosen marker, a picture default, or its key symbol. */
export function iconFor(place) {
  if (place.marker) return place.marker.startsWith('faerun-') ? place.marker : `mk-${place.marker}`;
  if (BY_CLASS[place.class]) return `mk-${BY_CLASS[place.class]}`;
  if (place.kind === 'settlement' && /^Port\b/.test(place.name ?? '')) return 'mk-anchor';
  const s = symbolFor(place);
  return s ? `faerun-${s}` : '';
}
