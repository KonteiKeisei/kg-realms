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
  if (/^(icons|ui|systems|canvas|sounds)\//.test(path) || path.startsWith("modules/kg-realms/")) return { kind: "keep", path };
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
/** A scene as a module ships it: no tokens (their actors stay in this game world), no thumbnail or journey. */
export function sceneForExport(doc) {
  const { _stats, folder, thumb, active, ownership, tokens, ...rest } = doc;
  const own = { ...(doc.flags?.[REALM_FLAG] ?? {}) };
  for (const k of PLAY_FLAGS) delete own[k];
  return {
    ...rest, tokens: [], active: false, journal: null, playlist: null, playlistSound: null,
    notes: (doc.notes ?? []).map((n) => ({ ...n, entryId: null, pageId: null })),
    flags: { ...doc.flags, [REALM_FLAG]: own }
  };
}

/** What the export leaves behind because it lives elsewhere in the game world: actors and journals named on cards and pins. */
export function linkedDocuments(value) {
  const actors = new Set(), journals = new Set();
  walk(value, (s, path) => {
    const key = path.findLast((k) => typeof k === "string");
    if ((key === "actor" || key === "actors") && s) actors.add(s);
    if ((key === "journal" || key === "page" || key === "entryId") && s) journals.add(s);
    for (const m of s.matchAll(/@UUID\[([^\]]+)\]/g)) (/Actor\./.test(m[1]) ? actors : journals).add(m[1]);
  });
  return { actors: [...actors], journals: [...journals] };
}

/** Keeps only the custom markers a world's places or pins use. */
export function markersUsed(markers, value) {
  const used = new Set();
  walk(value, (s, path) => { if (path.at(-1) === "marker" && s) used.add(s); });
  return Object.fromEntries(Object.entries(markers ?? {}).filter(([id]) => used.has(id)));
}

/** The export's report: what went in, and everything that did not, in plain words. */
export function exportReport({ title, version, moduleId, counts, missing, external, scenesMissing, linked, skippedTokens }) {
  const lines = [`${title} ${version} (${moduleId})`, "", "In the module:"];
  for (const [what, n] of Object.entries(counts)) lines.push(`  ${n} ${what}`);
  const list = (head, items) => { if (items?.length) lines.push("", `${head} (${items.length}):`, ...items.map((i) => `  ${i}`)); };
  list("Files that could not be read, still linked to their old path", missing);
  list("Files on the web that could not be fetched, still linked to the web", external);
  list("Linked scenes that no longer exist", scenesMissing);
  list("Actors linked on cards, not in the module", linked?.actors);
  list("Journals linked on cards and pins, not in the module", linked?.journals);
  if (skippedTokens) lines.push("", `Tokens left out of the scenes: ${skippedTokens} (their actors stay in this game world).`);
  return lines.join("\n") + "\n";
}
