// The realm map's layers (0.77): Places (single points: settlements, sites, peaks), Realms (who holds
// the land: kingdoms, regions) and Geography (what the land and water are: forests, ranges, seas,
// lakes). The map shows one layer at a time; the journey, roads and rivers show on all of them.
// A place's type gives its layer and shape (a point, an area, or a line); either can be set on the
// place itself. An area is drawn as a border (closed) or a line with two ends (a strait, a range's
// spine). Pure: no Foundry.

import { borderOf, followOf } from "./borders.mjs";

export const MAP_LAYERS = ["places", "realms", "geo"];
export const LAYER_NAMES = { places: "Places", realms: "Realms", geo: "Geography" };
export const SHAPES = { point: "Point", area: "Area", line: "Line" };

const words = (list) => new Set(list.map((s) => s.toLowerCase()));
/** Who holds the land. */
const REALM = words(["Region", "Macroregion", "Kingdom", "Empire", "Country", "Nation", "Realm", "Province", "Duchy", "Barony", "County", "March", "Principality", "Republic", "Dominion", "Domain", "Territory", "State", "Lands", "City-state", "Confederation", "Theocracy", "Satrapy", "Khanate", "Tribe Lands"]);
/** What the land and water are. */
const LAND = words(["Feature", "Forest", "Wood", "Woods", "Jungle", "Mountains", "Range", "Hills", "Highlands", "Desert", "Wastes", "Badlands", "Marsh", "Swamp", "Bog", "Fen", "Glacier", "Ice", "Tundra", "Steppe", "Moor", "Plain", "Plains", "Grassland", "Valley", "Canyon", "Islands", "Archipelago", "Coast", "Peninsula", "Cape"]);
const WATER = words(["Sea", "Ocean", "Coastal Sea", "Water/Coastal sea", "Water/Oceanic expanse", "Bay", "Gulf", "Strait", "Sound", "Channel", "Fjord", "Lagoon", "Lake", "Reef", "Shoal", "River"]);
/** Names roads already carry along their line: on no layer. */
const NONE = words(["Road", "Trail"]);
/** Types drawn as a line by default (named along it). */
const LINES = words(["River", "Strait", "Channel", "Canyon", "Range"]);

const cls = (p) => String(p?.class ?? "").toLowerCase();

/** The top level: a country or empire. Everything below one, at any depth, is a territory, whatever its type: a state, a county, a region. */
const DOMAIN = words(["Domain", "Empire", "Kingdom", "Country", "Nation", "Realm", "Republic", "Dominion", "Theocracy", "Confederation", "Khanate", "Principality", "City-state"]);
/**
 * What sort of thing a place is. Realms were once natural features: one of a realm's types still is
 * unless the GM has said otherwise (kindChosen), and reads as a domain or a territory by its type,
 * wherever it was saved. So does the single kind of 0.86, once GM-chosen or not.
 */
export const placeKind = (p) => {
  if (p?.kindChosen) return p.kind;
  if (p?.kind === "natural" && REALM.has(cls(p))) return DOMAIN.has(cls(p)) ? "domain" : "territory";
  if (p?.kind === "territory" && DOMAIN.has(cls(p))) return "domain";
  return p?.kind;
};

/** The layer a place is drawn on: its own choice, else its kind's or type's; null for none (road names). */
export function placeLayer(p) {
  if (MAP_LAYERS.includes(p?.layer)) return p.layer;
  const c = cls(p);
  if (NONE.has(c)) return null;
  if (p?.kind === "territory" || p?.kind === "domain") return "realms";
  // Told it is a natural feature, whatever its type's word usually means (The Steppes, a Region).
  if (p?.kindChosen && p?.kind === "natural" && REALM.has(c)) return "geo";
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

const isShore = (w) => w?.kind === "shore" && Array.isArray(w.pts) && w.pts.length > 1;
/**
 * Places that follow a shared outline (their own choice: borders.mjs) take it as their border, so there
 * is one outline to draw and it stays in step. A name outside a closed outline moves inside it. An
 * outline since deleted leaves the place as it was, marked shoreGone.
 */
export function withFollowedBorders(places, index) {
  return places.map((p) => {
    const ref = followOf(p);
    if (!ref) return p;
    const b = borderOf(ref, index);
    if (!b) return { ...p, shoreGone: true };
    const at = b.closed && !insideRing(b.pts, [p.lon, p.lat]) ? interiorPoint(b.pts) : [p.lon, p.lat];
    return { ...p, area: b.pts, areaClosed: b.closed, shape: b.closed ? "area" : "line", lon: at[0], lat: at[1], shoreLine: true, followRef: ref };
  });
}
export const withShoreBorders = (places, waterways = {}) => withFollowedBorders(places, { shores: waterways });
/** A new place for a biome zone: named as it is, of the type its biome means. */
const BIOME_CLASS = { forest: "Forest", jungle: "Jungle", taiga: "Forest", mountains: "Mountains", hills: "Hills", desert: "Desert", badlands: "Badlands", wetlands: "Marsh", swamp: "Swamp", glacier: "Glacier", arctic: "Ice", tundra: "Tundra", plains: "Plain", savanna: "Grassland", steppe: "Steppe", coast: "Coast", volcanic: "Mountains" };
export function placeFromZone(id, zone) {
  const at = interiorPoint(zone.pts);
  return { name: String(zone.name ?? "").trim() || "New place", kind: "natural", class: BIOME_CLASS[zone.type] ?? "Region", rank: 4, level: "surface", layer: "geo", follow: `biome:${id}`, lon: +at[0].toFixed(6), lat: +at[1].toFixed(6) };
}
/** A new place for a shoreline: a lake if its water is inside, islands if outside, a coast if its ends are apart. */
export function placeFromShore(id, w) {
  const closed = !!w.closed && w.pts.length > 2, at = closed ? interiorPoint(w.pts) : w.pts[Math.floor(w.pts.length / 2)];
  const cls = !closed ? "Coast" : w.water === "outside" ? "Islands" : "Lake";
  return { name: String(w.name ?? "").trim() || "New place", kind: "natural", class: cls, rank: 4, level: "surface", layer: "geo", shore: id, lon: +at[0].toFixed(6), lat: +at[1].toFixed(6) };
}
/** The inland waters on a map, as outlines: closed shorelines with their water inside, and lakes with a closed border. */
export function inlandWaters(places = [], waterways = {}) {
  const shores = Object.values(waterways).filter((w) => isShore(w) && w.closed && w.water === "inside" && w.pts.length > 2).map((w) => w.pts);
  const lakes = places.filter((p) => !p.shoreLine && /^(lake|lagoon|pond|mere|tarn|loch)$/i.test(p.class ?? "") && placeOutline(p)?.closed && !placeOutline(p).fromRecord).map((p) => p.area);
  return [...shores, ...lakes];
}

/** Whether a place can be a biome zone: land on the Geography layer, with a closed border drawn for it. */
export const canBeBiome = (p) => !!p?.area && placeLayer(p) === "geo" && areaKind(p) === "land" && !!placeOutline(p)?.closed;

/** A territory's chain upward by its links: itself, then what it is part of, and so on. A domain is the top; a circle stops. */
function upward(t, byId) {
  const out = [], seen = new Set();
  for (let at = t; at && !seen.has(at.id); at = at.partOf && at.kind !== "domain" ? byId.get(at.partOf) : null) { seen.add(at.id); out.push(at); }
  return out;
}
const territoriesOf = (places) => (places ?? []).filter((p) => placeLayer(p) === "realms");
/** Territories whose drawn border holds a spot, smallest first. */
function territoriesAt(lon, lat, places) {
  return territoriesOf(places).map((p) => [p, placeOutline(p)]).filter(([, o]) => o?.closed && insideRing(o.pts, [lon, lat])).sort((a, b) => ringSize(a[1].pts) - ringSize(b[1].pts)).map(([p]) => p);
}
/** Territories in order, each followed by what it is part of; each once. */
function withParents(list, byId) {
  const out = new Map();
  for (const t of list) for (const up of upward(t, byId)) if (!out.has(up.id)) out.set(up.id, up);
  return [...out.values()];
}
/**
 * Where a place sits in the realms: { within, crosses }, innermost first. A settlement or site knows by
 * its point: every drawn border around it, and what those are part of. A territory knows by its link,
 * or failing that by the larger borders around it. A natural feature with an outline may cross
 * boundaries: within is what holds all of it, crosses is what holds only some of it.
 */
export function hierarchyOf(place, places, { showHidden = false } = {}) {
  const byId = new Map(territoriesOf(places).map((t) => [t.id, t])), seen = (t) => showHidden || !t.hidden;
  const result = (within, crosses = []) => ({ within: within.filter(seen), crosses: crosses.filter(seen) });
  if (!place) return result([]);
  if (place.kind === "domain") return result([]);
  if (placeLayer(place) === "realms") {
    if (place.partOf && byId.has(place.partOf)) return result(upward(byId.get(place.partOf), byId).filter((t) => t.id !== place.id));
    const own = placeOutline(place), mine = own?.closed ? ringSize(own.pts) : 0;
    const below = new Set([...byId.values()].filter((t) => upward(t, byId).some((u) => u.id === place.id)).map((t) => t.id));
    const around = territoriesAt(place.lon, place.lat, places).filter((t) => !below.has(t.id) && ringSize(placeOutline(t).pts) > mine);
    return result(withParents(around, byId));
  }
  const outline = placeLayer(place) === "geo" ? placeOutline(place) : null;
  if (!outline) return result(withParents(territoriesAt(place.lon, place.lat, places), byId));
  const step = Math.max(1, Math.floor(outline.pts.length / 64)), samples = outline.pts.filter((_, i) => i % step === 0);
  const sets = samples.map(([lon, lat]) => withParents(territoriesAt(lon, lat, places), byId));
  const every = (sets[0] ?? []).filter((t) => sets.every((s) => s.some((u) => u.id === t.id)));
  const some = new Map(sets.flat().filter((t) => !every.some((u) => u.id === t.id)).map((t) => [t.id, t]));
  return result(every, [...some.values()].sort((a, b) => String(a.name).localeCompare(String(b.name))));
}
const KIND_WORDS = { settlement: "settlement", site: "site", natural: "natural feature", territory: "territory", domain: "domain" };
/** A realm's name as it reads in a sentence: the Salvae Empire, the Heartlands, Empiria. */
function realmName(t) {
  const name = String(t.name ?? "").trim();
  if (/^the\s/i.test(name)) return `the ${name.slice(4).trim()}`;
  const type = String(t.class ?? "").trim();
  return type && new RegExp(`\\b${type.replace(/[^\w\s-]/g, "")}\\b`, "i").test(name) ? `the ${name}` : name;
}
const andList = (names) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);
/**
 * A place's line on its card: "A settlement in Empiria, a territory of the Salvae Empire". Null when
 * it is part of nothing, so a card says nothing rather than only what kind it is.
 */
export function hierarchyLine(place, { within = [], crosses = [] } = {}) {
  if (!within.length && !crosses.length) return null;
  const noun = KIND_WORDS[place?.kind] ?? "place", article = /^[aeiou]/i.test(noun) ? "An" : "A";
  const isRealm = place?.kind === "territory" || place?.kind === "domain";
  let line = `${article} ${noun}`;
  within.forEach((t, i) => {
    if (i === 0) line += ` ${isRealm ? "of" : "in"} ${realmName(t)}`;
    else line += `, ${/^[aeiou]/i.test(KIND_WORDS[within[i - 1].kind] ?? "territory") ? "an" : "a"} ${KIND_WORDS[within[i - 1].kind] ?? "territory"} of ${realmName(t)}`;
  });
  if (crosses.length) line += `${within.length ? "," : ""} crossing ${andList(crosses.map(realmName))}`;
  return line;
}

/**
 * The domains and territories as a tree: [{ place, children }], domains first, then by name. Each sits
 * under the nearest thing it is part of, by its link or by the borders around it. Whatever cannot
 * reach the top (a circle in saved data) stands at the top rather than vanishing.
 */
export function territoryTree(places) {
  const list = territoriesOf(places), nodes = new Map(list.map((p) => [p.id, { place: p, children: [] }])), roots = [], placed = new Set();
  const order = (a, b) => (b.place.kind === "domain") - (a.place.kind === "domain") || String(a.place.name).localeCompare(String(b.place.name));
  const parents = new Map(list.map((p) => [p.id, hierarchyOf(p, places, { showHidden: true }).within[0]?.id ?? null]));
  for (const p of list) { const up = parents.get(p.id); if (up && nodes.has(up)) nodes.get(up).children.push(nodes.get(p.id)); else roots.push(nodes.get(p.id)); }
  const reach = (n) => { placed.add(n.place.id); n.children = n.children.filter((c) => !placed.has(c.place.id)).sort(order); n.children.forEach(reach); };
  roots.forEach(reach);
  for (const p of list) if (!placed.has(p.id)) { const n = nodes.get(p.id); roots.push(n); reach(n); }
  return roots.sort(order);
}

/** What a territory can be part of, a domain or another territory: not itself, nothing already part of it. */
export function partOfChoices(place, places) {
  const list = territoriesOf(places), byId = new Map(list.map((t) => [t.id, t]));
  return list.filter((t) => !upward(t, byId).some((u) => u.id === place.id)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

const ringSize = (ring) => Math.abs(ring.reduce((sum, a, i) => { const b = ring[(i + 1) % ring.length]; return sum + a[0] * b[1] - a[1] * b[0]; }, 0));
/**
 * What to call a spot, from what the GM has drawn and placed: "In Thay, in Rawlinswood near Arine",
 * "On Turquoise Bay near Wakeflow". What is not there is left out, with nothing in its place. In a
 * town it is that town and its realm. Only borders the GM drew count (a world's rectangles are too
 * rough to say which side of a coast a party is on); where they nest, the smallest wins. A settlement
 * takes "near" before any other place. milesTo(place) gives its distance from the spot.
 */
function spotParts(lon, lat, places, milesTo) {
  let town = null, td = 5, settlement = null, sd = 60, poi = null, pd = 60, geo = null;
  for (const p of places ?? []) {
    if (p.hidden || (p.unnamed && !p.edited)) continue;
    const layer = placeLayer(p);
    if (!layer) continue;
    if (layer === "realms") continue;
    if (layer !== "places") {
      const o = placeOutline(p);
      if (!o?.closed || !insideRing(o.pts, [lon, lat])) continue;
      const size = ringSize(o.pts);
      if (!geo || size < geo.size) geo = { p, size };
      continue;
    }
    const d = milesTo(p);
    if (p.kind === "settlement") {
      if (d < td) { td = d; town = p; }
      if (d < sd) { sd = d; settlement = p; }
    } else if (d < pd) { pd = d; poi = p; }
  }
  // Every territory around it, innermost first, with what those are part of. Hidden ones say nothing.
  const byId = new Map(territoriesOf(places).map((t) => [t.id, t]));
  const realms = withParents(territoriesAt(lon, lat, places), byId).filter((t) => !t.hidden && !(t.unnamed && !t.edited)).map((t) => t.name).join(", ");
  return { town, geo, realms, near: (settlement ?? poi)?.name ?? null };
}
export function spotName(lon, lat, places, milesTo) {
  const { town, geo, realms, near } = spotParts(lon, lat, places, milesTo);
  if (town) return realms ? `In ${town.name}, ${realms}` : `In ${town.name}`;
  const where = [realms && `in ${realms}`, geo && `${areaKind(geo.p) === "water" ? "on" : "in"} ${geo.p.name}`].filter(Boolean).join(", ");
  const text = where && near ? `${where} near ${near}` : where || (near ? `near ${near}` : "Wilderness");
  return text[0].toUpperCase() + text.slice(1);
}
/** A spot's short name, for a journey's title: the town, else the water or land it is on, else what it is near. */
export function spotTitle(lon, lat, places, milesTo) {
  const { town, geo, realms, near } = spotParts(lon, lat, places, milesTo);
  return town?.name ?? geo?.p.name ?? near ?? (realms ? realms.split(", ")[0] : "Wilderness");
}

/** Which places have an outline drawn on the map (their names come from the areas, not the places source). */
export function outlinedIds(places, regions = []) {
  const records = recordIndex(regions);
  return new Set((places ?? []).filter((p) => placeLayer(p) && placeLayer(p) !== "places" && placeOutline(p, records)).map((p) => p.id));
}
