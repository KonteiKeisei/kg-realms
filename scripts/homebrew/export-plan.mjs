// What a world module export holds (0.79), worked out without Foundry: the scenes a world reaches, the
// files its JSON and card text name, and their new paths in the module. Files a world's data names are
// found by walking every value, so a new field that holds a picture is carried without a change here.

const IMAGE = "webp|png|jpe?g|gif|svg|avif|apng|bmp|tiff?";
const VIDEO = "webm|mp4|m4v|ogv";
const AUDIO = "mp3|ogg|oga|wav|flac|m4a|opus";
const HAS_EXT = new RegExp(`\\.(${IMAGE}|${VIDEO}|${AUDIO})(\\?[^\\s"'<>]*)?$`, "i");
const IS_AUDIO = new RegExp(`\\.(${AUDIO})(\\?|$)`, "i");
/** Whole values that are a path: a file name at the end and nothing of a sentence or of HTML. */
const looksLikeFile = (s) => HAS_EXT.test(s) && !/[<>\n"]/.test(s);
/** A file named inside card text: <img src>, <a href>, <video poster>, url(...). */
const IN_HTML = /(?:\b(?:src|href|poster)\s*=\s*)(["'])(.*?)\1|url\(\s*(&quot;|&#39;|["'])?(.*?)\3?\s*\)/gi;
/** Fields that name a file without using it (what an image used to be; a page on the web). */
const NOT_USED = new Set(["originalImg", "originalSrc", "url", "descrSource", "sourceReference"]);

const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");

/**
 * Where a file named in data is: "local" (in Foundry's Data, to be copied), "external" (on the web,
 * to be fetched if it allows), "keep" (Foundry's own or the engine's, there wherever the module is
 * installed), or null (not a file). path is decoded, with no route, query or leading slash.
 */
export function fileRef(raw, { origin = "", prefix = "" } = {}) {
  let s = String(raw ?? "").trim();
  if (!s || /^data:/i.test(s) || s.startsWith("#")) return null;
  if (origin && s.startsWith(`${origin}/`)) s = s.slice(origin.length);
  if (/^(https?:)?\/\//i.test(s)) return { kind: "external", path: s };
  s = s.replace(/[?#].*$/, "").replace(/^\/+/, "");
  if (prefix && s.startsWith(`${prefix}/`)) s = s.slice(prefix.length + 1);
  const path = decode(s);
  if (/^(icons|ui|systems|canvas|sounds)\//.test(path) || path.startsWith("modules/kg-realms/") || path.startsWith("modules/calendaria/")) return { kind: "keep", path };
  return { kind: "local", path };
}

/** Walk a value's strings with their key path: visit(string, path) returns its replacement, or nothing. */
function walk(value, visit, path = []) {
  if (typeof value === "string") return visit(value, path) ?? value;
  if (Array.isArray(value)) return value.map((v, i) => walk(v, visit, [...path, i]));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, NOT_USED.has(k) ? v : walk(v, visit, [...path, k])]));
  return value;
}

/** Each file a value names, as raw text as it appears: raw -> folder (folderFor(path, raw) from the key path). */
export function scanFiles(value, folderFor, found = new Map()) {
  const add = (raw, path) => { if (raw && !found.has(raw)) found.set(raw, folderFor(path, raw)); };
  walk(value, (s, path) => {
    if (s.includes("<") || s.includes("url(")) { for (const m of s.matchAll(IN_HTML)) { const raw = m[2] ?? m[4]; if (raw && HAS_EXT.test(raw)) add(raw, path); } }
    else if (looksLikeFile(s)) add(s, path);
  });
  return found;
}

/** The value with every file named in `paths` (raw -> new path) changed, in whole values and in card text. */
export function rewriteFiles(value, paths) {
  return walk(value, (s) => {
    if (paths.has(s)) return paths.get(s);
    if (!s.includes("<") && !s.includes("url(")) return s;
    return s.replace(IN_HTML, (all, q, raw, q2, raw2) => {
      const from = raw ?? raw2;
      return from && paths.has(from) ? all.replace(from, paths.get(from)) : all;
    });
  });
}

/** Card art and markers go to assets/poi-img, sound to assets/audio. */
export const cardFolder = (path, raw) => (IS_AUDIO.test(raw) ? "assets/audio" : "assets/poi-img");
/** In a scene: its pins' cards are card art; its map, tiles and everything else go with the maps. */
export const sceneFolder = (path, raw) => (IS_AUDIO.test(raw) ? "assets/audio" : path.includes("notes") ? "assets/poi-img" : "assets/maps");

/**
 * Gives each file its place in the module. Two different files of one name are kept apart ("a-2.webp");
 * the same file named twice is one file. claim(folder, path, size, crc) returns its module path.
 */
export function assetNamer(moduleId) {
  const taken = new Map();
  return (folder, path, size, crc) => {
    const base = decode(path.split("/").pop()).replace(/[\\:*?"<>|]/g, "-"), dot = base.lastIndexOf("."), stem = dot > 0 ? base.slice(0, dot) : base, ext = dot > 0 ? base.slice(dot) : "";
    for (let n = 1; ; n++) {
      const name = n === 1 ? base : `${stem}-${n}${ext}`, rel = `${folder}/${name}`, was = taken.get(rel.toLowerCase());
      if (was && (was.size !== size || was.crc !== crc)) continue;
      if (!was) taken.set(rel.toLowerCase(), { size, crc });
      return { rel, ref: `modules/${moduleId}/${encodePath(rel)}` };
    }
  };
}

/** A place as a module ships it: everything but what applyEdits adds as it reads. */
export function placeForExport(place) {
  const { edited, added, original, removed, ...rest } = place;
  return rest;
}

const REALM_FLAG = "kg-realms";
/**
 * Every scene a world reaches: its realm scenes and settlement maps, the scenes its places and pins
 * link to, and theirs. Returns { scenes: [the docs, as plain objects], missing: [ids linked but gone] }.
 */
export function scenesOfWorld(all, places, world) {
  const byId = new Map(all.map((s) => [s._id, s])), keep = new Map(), missing = new Set(), queue = [];
  const reach = (id) => { if (!id || keep.has(id)) return; const s = byId.get(id); if (!s) { missing.add(id); return; } keep.set(id, s); queue.push(s); };
  for (const s of all) { const f = s.flags?.[REALM_FLAG]; if (f?.world === world || f?.localMap?.world === world) reach(s._id); }
  for (const p of places) reach(p.scene);
  while (queue.length) {
    const s = queue.pop(), f = s.flags?.[REALM_FLAG] ?? {};
    for (const n of s.notes ?? []) reach(n.flags?.[REALM_FLAG]?.local?.scene);
    reach(f.localMap?.parent);
    reach(f.returnTo?.scene);
  }
  return { scenes: [...keep.values()], missing: [...missing] };
}

/** This table's own use of a scene, which is not the world's: its party, its journey, its backup. */
const PLAY_FLAGS = ["journey", "partyJourneys", "partyFocus", "cityAsk", "homebrewOriginal"];
/**
 * A scene as a module ships it, marked with the id it must keep so places and pins still find it.
 * keepToken(token) says which tokens go: the players' party stays at this table.
 */
export function sceneForExport(doc, world, keepToken = () => true) {
  const { _stats, folder, thumb, active, ownership, ...rest } = doc;
  const own = { ...(doc.flags?.[REALM_FLAG] ?? {}), moduleScene: { world, id: doc._id } };
  for (const k of PLAY_FLAGS) delete own[k];
  return {
    ...rest, tokens: (doc.tokens ?? []).filter(keepToken), active: false, journal: null, playlist: null, playlistSound: null,
    notes: (doc.notes ?? []).map((n) => ({ ...n, entryId: null, pageId: null })),
    flags: { ...doc.flags, [REALM_FLAG]: own }
  };
}

/** Each kind of document a module's compendiums hold, and its compendium's name. */
export const PACK_NAMES = { Actor: "actors", Item: "items", JournalEntry: "journals", RollTable: "tables", Macro: "macros", Playlist: "playlists", Cards: "cards", Scene: "scenes" };
const PACK_LABELS = { Actor: "Actors", Item: "Items", JournalEntry: "Journals", RollTable: "Tables", Macro: "Macros", Playlist: "Playlists", Cards: "Cards", Scene: "Scenes" };
const TYPES = Object.keys(PACK_NAMES).join("|");
/** A document's own link: from a compendium, or in this game world. Anything after it (a page, an embedded item) is left on. */
const UUID = new RegExp(`Compendium\\.[\\w-]+\\.[\\w-]+\\.(?:${TYPES})\\.[A-Za-z0-9]{16}|\\b(?:${TYPES})\\.[A-Za-z0-9]{16}`, "g");
/** What a link's document is: { type, id }. */
export function uuidParts(uuid) { const p = uuid.split("."); return { type: p.at(-2), id: p.at(-1) }; }
/** A link to something every copy of this game system has, which stays as it is. */
export const inSystem = (uuid, systemId) => uuid.startsWith(`Compendium.${systemId}.`);

/** Every document a value links to, on cards, in card text, or in any other field. */
export function uuidsIn(value, systemId = "", found = new Set()) {
  walk(value, (s) => { for (const m of s.matchAll(UUID)) if (!inSystem(m[0], systemId)) found.add(m[0]); });
  return found;
}
/** The value with each link in `map` (old -> new) changed, wherever it stands. */
export function rewriteUuids(value, map) {
  return walk(value, (s) => s.replace(UUID, (m) => map.get(m) ?? m));
}
/** A document as a compendium holds it: not this table's folder, owners or history. */
export function docForPack(doc) {
  const { _stats, folder, ownership, ...rest } = doc;
  return rest;
}
/** Where a document's art goes in the module. Scenes are sorted by sceneFolder; sound always to assets/audio. */
export const packFolder = (type) => (path, raw) => (IS_AUDIO.test(raw) ? "assets/audio" : `assets/${PACK_NAMES[type] ?? "poi-img"}`);
/**
 * module.json's compendiums. GMs only, because scenes and journals hold secrets; Foundry's Actor and
 * Item compendiums must name a game system. Each path's folder is in the zip, empty, for Foundry to fill.
 */
export function modulePacks(title, types, systemId) {
  const short = String(title).replace(/^kg\s*realms\s*:\s*/i, "");
  const packs = types.map((type) => ({ name: PACK_NAMES[type], label: `${short}: ${PACK_LABELS[type]}`, path: `packs/${PACK_NAMES[type]}`, type, ...(type === "Actor" || type === "Item" ? { system: systemId } : {}), ownership: { PLAYER: "NONE", TRUSTED: "NONE", ASSISTANT: "OWNER" } }));
  return { packs, packFolders: packs.length ? [{ name: short, sorting: "m", packs: packs.map((p) => p.name) }] : [] };
}

/** Keeps only the custom markers a world's places or pins use. */
export function markersUsed(markers, value) {
  const used = new Set();
  walk(value, (s, path) => { if (path.at(-1) === "marker" && s) used.add(s); });
  return Object.fromEntries(Object.entries(markers ?? {}).filter(([id]) => used.has(id)));
}

/**
 * The game world's Calendaria calendar as a module ships it: always the whole calendar, whichever
 * kind it is, so it can be set anywhere. kind: "built-in", "edited" (built in, changed by the GM) or "custom".
 */
export function calendarForExport(active, manager, displayFormats) {
  const data = active?.toObject?.(), id = data?.metadata?.id;
  if (!id) return null;
  const kind = manager.isCustomCalendar(id) ? "custom" : manager.hasDefaultOverride(id) ? "edited" : "built-in";
  return { id, name: data.name ?? id, kind, data, ...(displayFormats ? { displayFormats } : {}) };
}
export const calendarLabel = (c) => `${c.name} (${c.kind})`;
/**
 * What setting a calendar takes in a game world, given what is there: "switch" (it is there as it
 * should be), "override" (a built-in one, edited), "create" or "update" (a custom one).
 * A built-in calendar this copy of Calendaria does not have is created from the whole calendar.
 */
export function calendarAction(calendar, { known, custom, override }) {
  const data = !!calendar.data;
  if (calendar.kind === "custom") return !data ? "switch" : custom ? "update" : "create";
  if (!known) return data ? "create" : "unknown";
  return data && (calendar.kind === "edited" || override) ? "override" : "switch";
}

/** The export's report: what went in, and everything that did not, in plain words. */
export function exportReport({ title, version, moduleId, counts, calendar, missing, external, scenesMissing, gone, skippedTokens }) {
  const lines = [`${title} ${version} (${moduleId})`, "", "In the module:"];
  for (const [what, n] of Object.entries(counts)) if (n) lines.push(`  ${n} ${what}`);
  lines.push(calendar ? `  Calendar: ${calendarLabel(calendar)}` : "  No calendar: Calendaria is not active in this game world.");
  const list = (head, items) => { if (items?.length) lines.push("", `${head} (${items.length}):`, ...items.map((i) => `  ${i}`)); };
  list("Files that could not be read, still linked to their old path", missing);
  list("Files on the web that could not be fetched, still linked to the web", external);
  list("Linked scenes that no longer exist", scenesMissing);
  list("Links to documents that could not be found, left as they were", gone);
  if (skippedTokens) lines.push("", `Player tokens left out of the scenes: ${skippedTokens}.`);
  return lines.join("\n") + "\n";
}
