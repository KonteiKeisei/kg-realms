// The realm map's layers (0.77): Places (single points: settlements, sites, peaks), Realms (who holds
// the land: kingdoms, regions) and Geography (what the land and water are: forests, ranges, seas,
// lakes). The map shows one layer at a time; the journey, roads and rivers show on all of them.
// A place's type gives its layer and shape (a point, an area, or a line); either can be set on the
// place itself. An area is drawn as a border (closed) or a line with two ends (a strait, a range's
// spine). Pure: no Foundry.

export const MAP_LAYERS = ["places", "realms", "geo"];
export const LAYER_NAMES = { places: "Places", realms: "Realms", geo: "Geography" };
export const SHAPES = { point: "Point", area: "Area", line: "Line" };

const words = (list) => new Set(list.map((s) => s.toLowerCase()));
/** Who holds the land. */
const REALM = words(["Region", "Macroregion", "Kingdom", "Empire", "Country", "Nation", "Realm", "Province", "Duchy", "Barony", "County", "March", "Principality", "Republic", "Dominion", "Domain", "Territory", "State", "Lands", "City-state", "Confederation", "Theocracy", "Satrapy", "Khanate", "Tribe Lands"]);
/** What the land and water are. */
const LAND = words(["Forest", "Wood", "Woods", "Jungle", "Mountains", "Range", "Hills", "Highlands", "Desert", "Wastes", "Badlands", "Marsh", "Swamp", "Bog", "Fen", "Glacier", "Ice", "Tundra", "Steppe", "Moor", "Plain", "Plains", "Grassland", "Valley", "Canyon", "Islands", "Archipelago", "Coast", "Peninsula", "Cape"]);
const WATER = words(["Sea", "Ocean", "Coastal Sea", "Water/Coastal sea", "Water/Oceanic expanse", "Bay", "Gulf", "Strait", "Sound", "Channel", "Fjord", "Lagoon", "Lake", "Reef", "Shoal", "River"]);
/** Names roads already carry along their line: on no layer. */
const NONE = words(["Road", "Trail"]);
/** Types drawn as a line by default (named along it). */
const LINES = words(["River", "Strait", "Channel", "Canyon", "Range"]);

const cls = (p) => String(p?.class ?? "").toLowerCase();

/** The layer a place is drawn on: its own choice, else its type's; null for none (road names). */
export function placeLayer(p) {
  if (MAP_LAYERS.includes(p?.layer)) return p.layer;
  const c = cls(p);
  if (NONE.has(c)) return null;
  if (REALM.has(c)) return "realms";
  if (LAND.has(c) || WATER.has(c)) return "geo";
  return "places";
}

/** Whether a Geography place is water (blue) or land (green); realms are "realm"; places "place". */
export function areaKind(p) {
  const layer = placeLayer(p);
  if (layer === "realms") return "realm";
  if (layer === "geo") return WATER.has(cls(p)) ? "water" : "land";
  return "place";
}

/** A place's shape: its own choice, else a point for Places and an area (or a line) for the others. */
export function placeShape(p) {
  if (SHAPES[p?.shape]) return p.shape;
  if (placeLayer(p) === "places") return "point";
  return LINES.has(cls(p)) ? "line" : "area";
}

/** Whether [x, y] lies inside a ring of [x, y] points (closed or not). */
export function insideRing(ring, p) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/**
 * A point well inside a ring, for its name: the middle of the widest stretch across it, on the
 * line through its centre (a bay or a crescent's centre can lie outside it).
 */
export function interiorPoint(ring) {
  const ys = ring.map((p) => p[1]), lo = Math.min(...ys), hi = Math.max(...ys);
  let best = null;
  for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
    const y = lo + (hi - lo) * f, xs = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) { const w = xs[k + 1] - xs[k]; if (!best || w > best.w) best = { w, at: [(xs[k] + xs[k + 1]) / 2, y] }; }
  }
  return best?.at ?? ring[0];
}

/** The fold used to match a place to the world's own area records (Toril's regions) by name. */
const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * A place's outline as [lon, lat] points and whether it closes: the one drawn for it, else (an area
 * with none drawn yet) its world's area record of the same name, as a rectangle. Null when it has none.
 */
export function placeOutline(p, records = new Map()) {
  if (placeShape(p) === "point") return null;
  if (Array.isArray(p.area) && p.area.length >= 2) return { pts: p.area, closed: p.areaClosed !== false && p.area.length >= 3 && placeShape(p) === "area" };
  const r = placeShape(p) === "area" ? records.get(fold(p.name)) : null;
  const b = r?.bounds;
  if (!b || ![b.west, b.east, b.south, b.north].every(Number.isFinite)) return null;
  return { pts: [[b.west, b.north], [b.east, b.north], [b.east, b.south], [b.west, b.south]], closed: true, fromRecord: true };
}

/** The world's area records by folded name (Toril's index regions: lakes, seas, regions with bounds). */
export function recordIndex(regions = []) {
  const m = new Map();
  for (const r of regions ?? []) if (r?.name && r.bounds && !m.has(fold(r.name))) m.set(fold(r.name), r);
  return m;
}

/** A steady colour for a realm from its name, when it has none of its own. */
export function realmColor(p) {
  if (/^#[0-9a-f]{6}$/i.test(p?.color ?? "")) return p.color;
  const hues = ["#b5523a", "#7b4fa0", "#3f7d6e", "#a3772c", "#4f6fa8", "#9c3f63", "#5f8a3a", "#8a5a2b"];
  let h = 7; for (const ch of String(p?.id ?? p?.name ?? "")) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return hues[h % hues.length];
}

/**
 * The map's area sources: { areas, labels }. areas: each area's border (Polygon) or line
 * (LineString); labels: a point for each area's name, at the place's own point. Areas with no
 * outline yet are left to the places source, which shows their name on their layer.
 */
export function areasGeoJSON(places, regions = []) {
  const records = recordIndex(regions), areas = [], labels = [];
  for (const p of places ?? []) {
    if (p.unnamed && !p.edited) continue;
    const layer = placeLayer(p);
    if (!layer || layer === "places") continue;
    const o = placeOutline(p, records);
    if (!o) continue;
    const props = { id: p.id, name: p.name ?? "", layer, kind: areaKind(p), color: areaKind(p) === "realm" ? realmColor(p) : "", rank: p.rank ?? 5, hidden: !!p.hidden };
    const ring = o.closed ? [...o.pts, o.pts[0]] : o.pts;
    areas.push({ type: "Feature", properties: { ...props, closed: o.closed }, geometry: o.closed ? { type: "Polygon", coordinates: [ring] } : { type: "LineString", coordinates: ring } });
    if (o.closed && Number.isFinite(p.lon) && Number.isFinite(p.lat)) labels.push({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: [p.lon, p.lat] } });
  }
  return { areas: { type: "FeatureCollection", features: areas }, labels: { type: "FeatureCollection", features: labels } };
}

const ringSize = (ring) => Math.abs(ring.reduce((sum, a, i) => { const b = ring[(i + 1) % ring.length]; return sum + a[0] * b[1] - a[1] * b[0]; }, 0));
/**
 * What to call a spot, from what the GM has drawn and placed: "In Thay, in Rawlinswood near Arine",
 * "On Turquoise Bay near Wakeflow". What is not there is left out, with nothing in its place. In a
 * town it is that town and its realm. Only borders the GM drew count (a world's rectangles are too
 * rough to say which side of a coast a party is on); where they nest, the smallest wins. A settlement
 * takes "near" before any other place. milesTo(place) gives its distance from the spot.
 */
export function spotName(lon, lat, places, milesTo) {
  let town = null, td = 5, settlement = null, sd = 60, poi = null, pd = 60, realm = null, geo = null;
  for (const p of places ?? []) {
    if (p.hidden || (p.unnamed && !p.edited)) continue;
    const layer = placeLayer(p);
    if (!layer) continue;
    if (layer !== "places") {
      const o = placeOutline(p);
      if (!o?.closed || !insideRing(o.pts, [lon, lat])) continue;
      const size = ringSize(o.pts), best = layer === "realms" ? realm : geo, found = { p, size };
      if (!best || size < best.size) { if (layer === "realms") realm = found; else geo = found; }
      continue;
    }
    const d = milesTo(p);
    if (p.kind === "settlement") {
      if (d < td) { td = d; town = p; }
      if (d < sd) { sd = d; settlement = p; }
    } else if (d < pd) { pd = d; poi = p; }
  }
  if (town) return realm ? `In ${town.name}, ${realm.p.name}` : `In ${town.name}`;
  const where = [realm && `in ${realm.p.name}`, geo && `${areaKind(geo.p) === "water" ? "on" : "in"} ${geo.p.name}`].filter(Boolean).join(", ");
  const near = (settlement ?? poi)?.name;
  const text = where && near ? `${where} near ${near}` : where || (near ? `near ${near}` : "Wilderness");
  return text[0].toUpperCase() + text.slice(1);
}

/** Which places have an outline drawn on the map (their names come from the areas, not the places source). */
export function outlinedIds(places, regions = []) {
  const records = recordIndex(regions);
  return new Set((places ?? []).filter((p) => placeLayer(p) && placeLayer(p) !== "places" && placeOutline(p, records)).map((p) => p.id));
}
