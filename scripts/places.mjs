import { placeKind, placeClass } from "./map-layers.mjs";
import { symbolFor, iconFor } from './map-symbols.mjs';
import { placeLayer } from './map-layers.mjs';
// Preserve bundled marker art when a world still carries its original server path.
export function moduleMarkers(defaults = {}, custom = {}) {
  const out = {...defaults, ...custom};
  for (const [id, marker] of Object.entries(custom)) {
    const bundled = defaults[id];
    if (bundled?.originalSrc && marker?.src === bundled.originalSrc) out[id] = {...marker, src:bundled.src};
  }
  return out;
}
// A world's places (settlements, sites, natural landmarks) as the map draws them: the world
// index's list with the GM's edits applied (renamed, hidden, made a point of interest, linked to
// a scene or journal page, or added). Pure: no Foundry.

/** MapLibre zoom from which a place shows, by kind and class: cities first, then towns, then the rest. */
export function placeMinZoom(p) {
  if (p.kind === "settlement") return p.class === "City" ? 3 : p.class === "Town" ? 4.5 : 6;
  if (p.kind === "site") return p.rank <= 4 ? 5 : 5.5;
  return 5.5;
}

/**
 * The places of one level ("surface" or "underdark"), edits applied: [{ ...place, name, gold,
 * hidden, edited, scene, page, summary }]. edits: { [id]: { name?, hidden?, gold?, scene?, page?,
 * summary?, img?, removed? } }; added: { [id]: { id, name, kind, class, lon, lat, level, ... } }.
 * A place the GM removed (the world has moved on: it is gone by then) is left out, unless
 * `removed` is asked for (the list to restore from).
 */
export function applyEdits(places, { edits = {}, added = {} } = {}, level = "surface", { removed = false } = {}) {
  const out = [];
  // A place the GM added that the module now ships (an adopted export) is one place, not two.
  for (const p of [...places.filter((x) => !added[x.id]), ...Object.values(added)]) {
    if ((p.level ?? "surface") !== level) continue;
    const e = { ...(added[p.id] ?? {}), ...(edits[p.id] ?? {}) };
    if (!!e.removed !== removed) continue;
    const merged={...p,...e},displayClass=placeClass(merged);
    const linked = !!(e.scene || e.page);
    out.push({
      ...p,
      ...e,
      kind: placeKind(merged),
      ...(displayClass!==merged.class?{class:displayClass}:{}),
      // A server-side image migration changes the shipped path. A world edit still carrying
      // the same old path should follow it; a newly selected world image keeps precedence.
      ...(p.originalImg && e.img === p.originalImg ? { img: p.img } : {}),
      name: e.name || p.name,
      original: p.name,
      // A place the GM linked to a scene or page glows gold unless they turned it off.
      gold: e.gold ?? linked,
      // Hidden, Rumoured or Discovered (the place card's Players); older edits only have hidden.
      visibility: e.visibility ?? (e.hidden ? "hidden" : "discovered"),
      hidden: e.visibility ? e.visibility === "hidden" : !!e.hidden,
      edited: Object.keys(e).length > 0 || !!added[p.id],
      added: !!added[p.id]
    });
  }
  return out;
}

/**
 * GeoJSON for the map's "places" source. The atlas's unnamed places (nameless ruins and forts) are
 * left off unless the GM has named or edited one. Each carries its map layer (map-layers.mjs) and
 * whether it has an outline (`outlined`: those ids), whose name the areas source draws instead.
 */
export function placesGeoJSON(list, outlined = new Set()) {
  return {
    type: "FeatureCollection",
    features: list.filter((p) => !p.unnamed || p.edited).map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      properties: { layer: placeLayer(p) ?? 'none', outlined: outlined.has(p.id), labelPolygons:p.labelPolygons??[], printed:!!p.labelPolygons?.length, added: !!p.added, symbol: symbolFor(p), icon: iconFor(p), fallback: symbolFor(p) ? `faerun-${symbolFor(p)}` : '', id: p.id, name: p.name, kind: p.kind, class: p.class, rank: p.rank ?? 5, gold: !!p.gold, hidden: !!p.hidden, edited: !!p.edited, unnamed: !!p.unnamed && !p.edited, minzoom: placeMinZoom(p), seed: [...String(p.id)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 6283, 7) / 1000 }
    }))
  };
}

/** Lower-case, accents off, for matching "Faerun" to "Faerûn". */
export const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Search places and regions by name (and other names): best first. Each result:
 * { type: "place" | "region", item, score }.
 */
/**
 * Search places and regions by name; `locals` are places on local maps ({ name, map, visibility }),
 * which always come after the realm's own places and regions, however well they match.
 */
export function searchWorld(query, { places = [], regions = [], locals = [] }, limit = 30) {
  const q = fold(query).trim();
  if (!q) return [];
  const score = (name, alt = "") => {
    const n = fold(name);
    if (n === q) return 100;
    if (n.startsWith(q)) return 80;
    if (n.split(/[\s'-]+/).some((w) => w.startsWith(q))) return 60;
    if (n.includes(q)) return 40;
    if (fold(alt).includes(q)) return 30;
    return 0;
  };
  const rank = { City: 3, Town: 2, Village: 1 };
  const results = [
    ...places.filter((p) => !p.hidden && !(p.unnamed && !p.edited)).map((p) => ({ type: "place", item: p, score: score(p.name, p.alt) + (rank[p.class] ?? 0) + (p.gold ? 4 : 0) })),
    ...regions.map((r) => ({ type: "region", item: r, score: score(r.name) + 5 }))
  ].filter((r) => r.score >= 30);
  const realm = results.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name)).slice(0, limit);
  const inside = locals.filter((l) => l.visibility !== "hidden").map((l) => ({ type: "local", item: l, score: Math.max(score(l.name), score(l.map) >= 80 ? 30 : 0) }))
    .filter((r) => r.score >= 30).sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name)).slice(0, limit);
  return [...realm, ...inside];
}

/**
 * A shipped place left out where a named waterway already carries its name, so it does not show twice.
 * A place the GM added or changed always stays: they meant it, even if a river or shore has that name.
 */
export function dropWaterDuplicates(places, named) {
  const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/^the\s+/, "").replace(/\s+/g, " ").trim();
  const core = (s) => norm(s).replace(/\b(river|the)\b/g, "").replace(/\s+/g, " ").trim();
  const exact = new Set(named.map(norm)), cores = [...new Set(named.map(core))];
  const isWater = (p) => p.kind === "natural" && (/^(river|lake|sea|bay)$/i.test(p.class ?? "") || /\b(river|stream|creek|run|water|flow|lake|brook)\b/i.test(p.name));
  const close = (c) => cores.some((n) => n === c || (n.length >= 5 && editDistance(c, n) <= (n.length >= 8 ? 2 : 1)));
  return places.filter((p) => p.kind === "settlement" || p.added || p.edited || !(exact.has(norm(p.name)) || (isWater(p) && close(core(p.name)))));
}
/** Letters to change, add or drop to turn a into b. */
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}
