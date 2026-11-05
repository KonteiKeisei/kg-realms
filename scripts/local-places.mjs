// Local maps: a scene that is the map of one realm place (Neverwinter's city map), and the places
// on it (inns, temples, districts). Pure: no Foundry. The Foundry side is local-maps.mjs.

import {iconPackOverride} from './local-icon-packs.mjs';

/** Only migrated image references, leaving prose, secret blocks and custom artwork intact. */
export function localAssetEdits(record, replacements = {}) {
  if (!Object.keys(replacements).length) return {};
  const decode = value => { try { return decodeURIComponent(value); } catch { return value; } };
  const paths = new Map(Object.entries(replacements).map(([old, target]) => [decode(old), target]));
  const image = src => paths.get(decode(src)) ?? src;
  const changes = {};
  if (record.img && image(record.img) !== record.img) changes.img = image(record.img);
  if (Array.isArray(record.images)) {
    const images = record.images.map(image);
    if (images.some((src, i) => src !== record.images[i])) changes.images = images;
  }
  for (const field of ['known', 'summary', 'gmNotes', 'rumours']) {
    if (typeof record[field] !== 'string') continue;
    const text = record[field].replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']*)\2/gi, (_, prefix, quote, src) => prefix + quote + image(src) + quote);
    if (text !== record[field]) changes[field] = text;
  }
  return changes;
}
/** Categories of local place: label and Font Awesome badge. */
export const CATEGORIES = {
  district: { label: "District", icon: "fa-map-location-dot", glyph: "" },
  civic: { label: "Civic building", icon: "fa-building-columns", glyph: "" },
  shop: { label: "Shop or market", icon: "fa-shop", glyph: "" },
  inn: { label: "Inn or tavern", icon: "fa-beer-mug-empty", glyph: "" },
  temple: { label: "Temple or shrine", icon: "fa-place-of-worship", glyph: "" },
  guild: { label: "Guild or faction", icon: "fa-users", glyph: "" },
  landmark: { label: "Landmark", icon: "fa-monument", glyph: "" },
  harbour: { label: "Harbour or river", icon: "fa-anchor", glyph: "" },
  graveyard: { label: "Graveyard", icon: "fa-cross", glyph: "" },
  danger: { label: "Danger", icon: "fa-skull", glyph: "" },
  gate: { label: "Gate or road in", icon: "fa-dungeon", glyph: "" },
  ruin: { label: "Ruin", icon: "fa-landmark", glyph: "" },
  other: { label: "Other", icon: "fa-location-dot", glyph: "" }
};

export const VISIBILITY = { hidden: "Hidden", rumoured: "Rumoured", discovered: "Discovered" };

export function localPlaceType(rec){
  if(['dock','land'].includes(rec?.entryType)&&(rec.entry||rec.category==='gate'))return rec.entryType==='dock'?'dock':'gate';
  return rec?.category==='gate'?'gate':rec?.entry?(rec.category==='harbour'?'dock':'gate'):'place';
}
export function changeLocalPlaceType(rec,type){
  if(!['place','gate','dock'].includes(type))throw Error('Choose Place, Gate or Dock.');
  const out={...rec};
  if(localPlaceType(rec)==='place')out.placeCategory=rec.category==='gate'?'other':rec.category;
  if(type==='gate')Object.assign(out,{category:'gate',entry:true,entryType:'land'});
  else if(type==='dock')Object.assign(out,{category:'harbour',entry:true,entryType:'dock'});
  else Object.assign(out,{category:rec.placeCategory??(rec.category==='gate'?'other':rec.category),entry:false,entryType:null,privateEntry:false});
  return out;
}
export function localSourceKeys(rec){return [...(rec.id?[`id:${rec.id}`]:[]),`name:${String(rec.sourceName??rec.name??'').trim().toLowerCase()}`];}
export function deletedLocalPlace(map,rec){const gone=new Set(map?.deletedPlaces??[]);return localSourceKeys(rec).some(key=>gone.has(key));}

/** Places shown at every zoom: the ways in, the landmarks and the wards (with ways in and key places). */
export const ALWAYS_SHOWN = new Set(["gate", "landmark", "district"]);
export const alwaysShown = (rec) => !!rec && (ALWAYS_SHOWN.has(rec.category) || !!rec.keyPlace || !!rec.entry);
/**
 * A marker at a zoom: it grows and shrinks with the map, but stays between min and max pixels on
 * screen; zoomed out until it would be smaller than hideBelow, it goes, unless always shown.
 * base: its size on the scene (pixels). Returns { visible, factor } (factor: times its scene size).
 */
export function markerAtZoom(base, zoom, { always = false, min = 24, max = 64, hideBelow = 18 } = {}) {
  const screen = Math.max(0.01, base * zoom);
  return { visible: always || screen >= hideBelow, factor: Math.min(max, Math.max(min, screen)) / screen };
}

// Foundry's own note icons (icons/svg/<name>.svg), as the GM chose them for the old pins.
const BY_ICON = {
  sword: "shop", coins: "shop", "hanging-sign": "inn", tankard: "inn", book: "temple", castle: "civic",
  tower: "landmark", obelisk: "graveyard", cave: "danger", waterfall: "harbour", house: "district", city: "guild",
  anchor: "harbour", temple: "temple", skull: "danger", ruins: "ruin", door: "gate", bridge: "gate", tankard2: "inn"
};
// Words in a name that settle it, checked before the icon.
const BY_NAME = [
  [/\b(inn|tavern|alehouse|taproom|festhall|leviathan)\b/i, "inn"],
  [/\b(temple|shrine|house of knowledge|chapel|cathedral)\b/i, "temple"],
  [/\b(graveyard|cemetery|crypt|tomb|necropolis)\b/i, "graveyard"],
  [/\b(gate|bridge)\b/i, "gate"],
  [/\b(harbou?r|docks?|wharf|pier|river)\b/i, "harbour"],
  [/\b(shop|market|arms|armou?r|maps|trade house|auction|smith|emporium)\b/i, "shop"],
  [/\b(hall of justice|castle|palace|keep|garrison|barracks)\b/i, "civic"],
  [/\b(society|guild|order|faction)\b/i, "guild"],
  [/\b(chasm|lair|pit)\b/i, "danger"],
  [/\b(ruins?)\b/i, "ruin"]
];

/** A category for a pin, from its name, then its icon's file name. */
export function categoryFor(iconSrc = "", name = "") {
  for (const [re, cat] of BY_NAME) if (re.test(name)) return cat;
  const file = String(iconSrc).split("/").pop().replace(/\.(svg|png|webp|jpg)$/i, "");
  return BY_ICON[file] ?? "other";
}

/** A pin's label without its number: "20.Shining Knight" -> { name: "Shining Knight", order: 20 }. */
export function cleanLabel(text = "") {
  const m = String(text).match(/^\s*(\d+)\s*[.):-]\s*(.+)$/);
  return m ? { name: m[2].trim(), order: Number(m[1]) } : { name: String(text).trim(), order: null };
}

// How wide places of each kind usually are, in miles.
const SPAN = { City: 1.5, Town: 0.6, Village: 0.25, Hamlet: 0.12, Fortification: 0.15, Keep: 0.1, Fort: 0.1, Castle: 0.15 };

/** A neat grid distance: steps of 5 below 50, of 10 below 500, of 50 above. */
function neat(v) { const step = v < 50 ? 5 : v < 500 ? 10 : 50; return Math.max(step, Math.round(v / step) * step); }

/**
 * The scene's width in feet, and a suggested scale when it is far off for the kind of place
 * (a city 350 ft across): { acrossFt, suggest: { distance, units } | null, expectFt }.
 */
export function scaleCheck({ width, gridSize = 100, distance = 5, units = "ft" }, placeClass) {
  const perFt = /^mi/i.test(units) ? 5280 : /^m$|metre|meter/i.test(units) ? 3.28084 : /^km/i.test(units) ? 3280.84 : 1;
  const acrossFt = (width / gridSize) * distance * perFt;
  const span = SPAN[placeClass];
  if (!span) return { acrossFt, suggest: null, expectFt: null };
  const expectFt = span * 5280;
  if (acrossFt > expectFt / 3 && acrossFt < expectFt * 3) return { acrossFt, suggest: null, expectFt };
  const per = expectFt / (width / gridSize);
  return { acrossFt, expectFt, suggest: per >= 2640 ? { distance: Math.round((per / 5280) * 100) / 100, units: "mi" } : { distance: neat(per), units: "ft" } };
}

/** "1.4 mi" or "350 ft". */
export function across(ft) { return ft >= 2640 ? `${(ft / 5280).toFixed(1)} mi` : `${Math.round(ft).toLocaleString()} ft`; }

/** A blank local place record. */
export function localRecord(fields = {}) {
  return { name: "", category: "other", visibility: "discovered", summary: "", img: "", journal: null, scene: null, actor: null, gmNotes: "", order: null, entry: false, entryType: null, privateEntry: false, ...fields, iconPack: iconPackOverride(fields.iconPack) };
}
