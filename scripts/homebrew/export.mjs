// Export a made world as a module (0.80): everything the world is, so it works in any game world.
// The map and its tiles; places, roads, rivers, biomes, encounters, trade and snow with every edit
// applied; each scene the world reaches, with its pins, lights, walls and tokens; every actor, journal,
// item and table those link to; and every picture and sound all of that names, copied into the module
// with its links changed. What cannot be carried is listed in the export's report, never dropped quietly.
//
// A browser cannot write Foundry's compendium databases, so the zip holds their documents as JSON and
// empty compendium folders, and KG Realms fills them when a GM first loads the module. Updating a
// module replaces its folder, so a compendium found short is filled again.
import { worldUrl, allWorlds } from "../worlds.mjs";
import { applyRouteEdits } from "../routes.mjs";
import { TILE_SUFFIX, moduleIdFrom, moduleScript, ROUTES_FILE, zipEntry, zipParts, crc32, zipFits } from "./plan.mjs";
import { fileRef, scanFiles, rewriteFiles, cardFolder, sceneFolder, packFolder, assetNamer, placeForExport, scenesOfWorld, sceneForExport, uuidsIn, uuidParts, rewriteUuids, docForPack, modulePacks, PACK_NAMES, markersUsed, exportReport } from "./export-plan.mjs";

const ID = "kg-realms";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const q = (tip) => `<span class="kgr-rule" tabindex="0" data-tooltip="${esc(tip)}" data-tooltip-class="kgr-rule-tip" aria-label="${esc(tip)}">?</span>`;
const encoder = new TextEncoder();
const json = (value) => encoder.encode(JSON.stringify(value));

// The game world's own data for a world, as the engine sees it (main.mjs gives this).
let worldData = null;
export const setExportData = (fn) => { worldData = fn; };

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) throw Error("this browser cannot check files here (Foundry needs to be opened over https or on localhost)");
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((n) => n.toString(16).padStart(2, "0")).join("");
}
const local = (path) => foundry.utils.getRoute(path.split("/").map(encodeURIComponent).join("/"));

/**
 * The documents reached from `seeds`, and those they link to in turn: { docs: "Type.id" -> plain
 * object, aliases: each link -> "Type.id", gone: links to nothing }. Links into this game system's
 * own compendiums stay as they are.
 */
async function gatherDocuments(seeds, systemId, known = new Map()) {
  const docs = new Map(known), aliases = new Map(), gone = [], queue = [...seeds];
  while (queue.length) {
    const uuid = queue.pop();
    if (aliases.has(uuid)) continue;
    const { type, id } = uuidParts(uuid), key = `${type}.${id}`;
    aliases.set(uuid, key);
    if (docs.has(key)) continue;
    const doc = await fromUuid(uuid).catch(() => null);
    if (!doc) { aliases.delete(uuid); gone.push(uuid); continue; }
    const plain = doc.toObject();
    docs.set(key, plain);
    queue.push(...uuidsIn(plain, systemId));
  }
  return { docs, aliases, gone };
}

/** The world as a module: { name, parts, report, problems }. onStep(message, 0 to 1) tells how far along it is. */
export async function buildExport(def, { moduleId, title, version }, onStep = () => {}) {
  const dir = `${moduleId}/data/worlds/${def.id}`, entries = [], systemId = game.system?.id ?? "";
  const add = async (name, bytes) => {
    const e = zipEntry(name, bytes);
    // Held by the browser, which may keep it on disk, so a large world fits.
    e.body = new Blob([bytes]);
    entries.push(e);
  };
  const get = async (rel) => { const r = await fetch(worldUrl(def.id, rel), { cache: "no-store" }); if (!r.ok) throw Error(`${rel}: HTTP ${r.status}`); return r; };
  const getJson = (rel) => get(rel).then((r) => r.json());

  onStep("Reading the world's data", 0);
  const data = await worldData(def.id);
  const index = await getJson("index.json"), pack = await getJson("terrain-pack.json");
  const routesFile = index.routes ?? ROUTES_FILE;
  const places = data.places.map(placeForExport);
  const baseRoutes = await getJson(routesFile).catch(() => ({ type: "FeatureCollection", features: [] }));
  const routes = applyRouteEdits(baseRoutes, data.routeEdits);
  routes.features = routes.features.map((f) => { const { edited, added, ...properties } = f.properties ?? {}; return { ...f, properties }; });
  const trade = await getJson("trade.json").catch(() => ({ settlements: [], goods: [], signature_goods: [], houses: [], tags: {}, matches: {} }));
  const presets = await getJson("local/index.json").catch(() => []);

  // Every JSON file, by its path in the world's data folder.
  const files = new Map([
    ["index.json", { ...index, homebrew: undefined, places, routes: routesFile }],
    [routesFile, routes],
    ["waterways.json", { waterways: data.waterways }],
    ["biomes.json", data.biomes],
    ["encounters.json", { version: 2, world: def.id, encounters: data.encounters }],
    ["trade.json", { ...trade, edits: data.tradeEdits }],
    ["local/index.json", presets]
  ]);
  for (const entry of presets) for (const rel of [entry.file, entry.effects?.file]) if (rel) files.set(`local/${rel}`, await getJson(`local/${rel}`));

  // The scenes. The players' own tokens stay at this table.
  onStep("Gathering the scenes", 0.02);
  const isPlayers = (token) => { const a = game.actors?.get(token.actorId); return !!a && (a.type === "group" || a.hasPlayerOwner); };
  const { scenes: sceneDocs, missing: scenesMissing } = scenesOfWorld(game.scenes.map((s) => s.toObject()), places, def.id);
  const scenes = sceneDocs.map((s) => sceneForExport(s, def.id, (t) => !isPlayers(t)));
  const skippedTokens = sceneDocs.reduce((n, s) => n + (s.tokens ?? []).filter(isPlayers).length, 0);
  const markers = markersUsed(data.markers, [places, scenes]);

  // Everything those link to, and what that links to.
  onStep("Gathering actors, journals and items", 0.04);
  const seeds = uuidsIn([...files.values(), scenes], systemId);
  for (const s of scenes) for (const t of s.tokens ?? []) if (t.actorId) seeds.add(`Actor.${t.actorId}`);
  for (const s of sceneDocs) for (const n of s.notes ?? []) if (n.entryId) seeds.add(`JournalEntry.${n.entryId}`);
  const { docs, aliases, gone } = await gatherDocuments(seeds, systemId, new Map(scenes.map((s) => [`Scene.${s._id}`, s])));
  // Which compendium each document goes in, by kind.
  const groups = new Map();
  for (const [key, doc] of docs) {
    const type = key.split(".")[0];
    if (!PACK_NAMES[type]) continue;
    if (!groups.has(type)) groups.set(type, []);
    groups.get(type).push(type === "Scene" ? doc : docForPack(doc));
  }
  const newUuid = (key) => { const [type, id] = key.split("."); return `Compendium.${moduleId}.${PACK_NAMES[type]}.${type}.${id}`; };
  const uuids = new Map([...aliases].map(([from, key]) => [from, newUuid(key)]));

  // Every file those name, and where it goes.
  const named = new Map();
  scanFiles([...files.values()], cardFolder, named);
  scanFiles(markers, cardFolder, named);
  for (const [type, list] of groups) scanFiles(list, type === "Scene" ? sceneFolder : packFolder(type), named);

  const where = { origin: location.origin, prefix: (foundry.utils.getRoute("") ?? "").replace(/^\/+|\/+$/g, "") };
  const claim = assetNamer(moduleId), paths = new Map(), written = new Set(), missing = [], external = [];
  let done = 0;
  for (const [raw, folder] of named) {
    onStep(`Copying pictures (${++done} / ${named.size})`, 0.05 + 0.4 * (done / named.size));
    const ref = fileRef(raw, where);
    if (!ref || ref.kind === "keep") continue;
    try {
      const res = await fetch(ref.kind === "external" ? ref.path : local(ref.path));
      if (!res.ok) throw Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const placed = claim(folder, ref.kind === "external" ? new URL(ref.path).pathname : ref.path, bytes.length, crc32(bytes));
      if (!written.has(placed.rel)) { written.add(placed.rel); await add(`${moduleId}/${placed.rel}`, bytes); }
      paths.set(raw, placed.ref);
    } catch (err) {
      (ref.kind === "external" ? external : missing).push(`${raw}: ${err?.message ?? err}`);
    }
  }

  // The links, changed. A place keeps what its picture was, so a game world's own edit still naming it follows.
  for (const p of places) if (paths.has(p.img)) p.originalImg = p.img;
  const relink = (value) => rewriteUuids(rewriteFiles(value, paths), uuids);
  const finalMarkers = relink(markers);
  for (const [id, m] of Object.entries(markers)) if (paths.has(m.src)) finalMarkers[id].originalSrc = m.src;
  for (const [rel, value] of files) await add(`${dir}/${rel}`, json(relink(value)));

  // The compendiums: their documents, and the empty folders Foundry fills.
  const packList = [], counts = {};
  for (const [type, list] of groups) {
    const name = PACK_NAMES[type], file = `packs/${name}.json`;
    await add(`${dir}/${file}`, json(relink(list)));
    await add(`${moduleId}/packs/${name}/`, new Uint8Array());
    packList.push({ name, type, file, count: list.length });
    counts[name] = list.length;
  }

  // The map's tiles.
  const tiles = pack.lods.flatMap((l) => l.tiles);
  done = 0;
  for (const tile of tiles) {
    onStep(`Copying map tiles (${++done} / ${tiles.length})`, 0.45 + 0.5 * (done / tiles.length));
    const res = await fetch(local(`${def.assetBase}/${tile.path}`));
    if (!res.ok) throw Error(`the map tile ${tile.path} could not be read (HTTP ${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    tile.path = tile.path.replace(TILE_SUFFIX, ".ktx2");
    await add(`${moduleId}/${tile.path}`, bytes);
  }
  pack.fingerprint = await sha256(encoder.encode(JSON.stringify(pack.lods)));
  await add(`${dir}/terrain-pack.json`, json(pack));

  // The module.
  const kg = game.modules.get(ID);
  await add(`${moduleId}/module.json`, encoder.encode(JSON.stringify({ id: moduleId, title, description: `${def.title}, a world for KG Realms.`, version, authors: [{ name: game.user.name }], compatibility: { minimum: "13", verified: "14" }, relationships: { requires: [{ id: ID, type: "module", compatibility: { minimum: kg?.version ?? "0.80.0" } }] }, esmodules: ["scripts/main.mjs"], ...modulePacks(title, [...groups.keys()], systemId) }, null, 2)));
  await add(`${moduleId}/scripts/main.mjs`, encoder.encode(moduleScript(moduleId, def, { snow: data.snow, markers: finalMarkers, rules: def.rules, packs: packList })));

  const report = exportReport({
    title, version, moduleId, skippedTokens, scenesMissing, gone, missing, external,
    counts: { "places": places.length, "roads": routes.features.length, "rivers and shores": Object.keys(data.waterways).length, "encounters": Object.keys(data.encounters).length, "scenes": counts.scenes, "actors": counts.actors, "journals": counts.journals, "items": counts.items, "tables": counts.tables, "macros": counts.macros, "playlists": counts.playlists, "card decks": counts.cards, "pictures and sounds": written.size, "custom markers": Object.keys(markers).length, "map tiles": tiles.length }
  });
  await add(`${moduleId}/export-report.txt`, encoder.encode(report));
  if (!zipFits(entries)) throw Error("this world is too large for one zip (over 4 GB). Shrink the map or its pictures and try again.");
  onStep("Building the zip", 0.97);
  return { name: `${moduleId} v${version}.zip`, parts: zipParts(entries), report, problems: missing.length + external.length + scenesMissing.length + gone.length };
}

export async function exportModule(def) {
  if (!def) return;
  const values = await foundry.applications.api.DialogV2.wait({
    window: { title: "Export as module", icon: "fa-solid fa-file-export" }, position: { width: 460 }, rejectClose: false,
    content: `<div class="form-group"><label>Module title</label><input name="title" type="text" value="KG Realms: ${esc(def.title)}"></div>
      <div class="form-group"><label>Module id ${q("The folder name in Data/modules: lowercase letters, digits and dashes.")}</label><input name="id" type="text" value="${esc(moduleIdFrom(def.title))}" pattern="[a-z0-9-]+"></div>
      <div class="form-group"><label>Version</label><input name="version" type="text" value="1.0.0"></div>
      <p class="notes">The zip holds the whole world: its map, places, roads, rivers, biomes, encounters, trade and snow with every edit, each scene it links to, every actor, journal and item those link to, and all their pictures, moved into the module and linked up. ${q("Pictures on cards and markers go to assets/poi-img, scene maps to assets/maps, and actor, journal and item art to their own folders. Links into your game system's own compendiums stay as they are. Your players' tokens stay out of the scenes.")}</p>
      <p class="notes">Afterwards you get a report of anything that could not be carried. It is also in the zip, as export-report.txt.</p>
      <p class="notes">When a GM first loads the module, KG Realms fills its compendiums. ${q("Compendiums are GM only, because scenes and journals hold secrets. Updating a module replaces its compendiums, so they are filled again and any edits made inside them are lost: import a document to your game world to change it.")} Drag the realm map in from them and its settlements come with it.</p>`,
    buttons: [{ action: "go", label: "Download zip", icon: "fa-solid fa-download", default: true, callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object }, { action: "cancel", label: "Cancel" }]
  });
  if (!values || typeof values !== "object") return;
  const moduleId = /^[a-z0-9-]+$/.test(values.id ?? "") ? values.id : moduleIdFrom(def.title), title = String(values.title || `KG Realms: ${def.title}`), version = String(values.version || "1.0.0");
  const note = ui.notifications.info(`KG Realms: building ${title}...`, { permanent: true, progress: true });
  try {
    const built = await buildExport(def, { moduleId, title, version }, (message, pct) => note?.update?.({ message: `KG Realms: ${message}`, pct }));
    foundry.utils.saveDataToFile(new Blob(built.parts, { type: "application/zip" }), "application/zip", built.name);
    await foundry.applications.api.DialogV2.prompt({
      window: { title: `${title}: exported` }, position: { width: 560 },
      content: `<p>${built.problems ? `<strong>Downloading, with ${built.problems} problem${built.problems === 1 ? "" : "s"} listed below.</strong>` : "Downloading."} Extract it into Data/modules and enable it.</p><pre style="max-height:320px;overflow:auto;white-space:pre-wrap;font-size:12px">${esc(built.report)}</pre>`,
      ok: { label: "Close" }, rejectClose: false
    });
  } catch (err) {
    console.error(`${ID} | export`, err);
    ui.notifications.error(`KG Realms: could not export ${def.title}: ${err?.message ?? err}`, { permanent: true });
  } finally {
    if (note) ui.notifications.remove?.(note);
  }
}

const IN_ONE_GO = 100;
/**
 * A world module's compendiums, filled from its JSON by the first GM to load it: only what each is
 * short of, so an update (which empties them) fills them again and nothing is written otherwise. A
 * compendium that cannot be filled says so, and is tried again next load.
 */
export async function fillModulePacks() {
  for (const world of allWorlds().filter((w) => w.packs?.length)) {
    let added = 0;
    for (const { name, type, file } of world.packs) {
      const pack = game.packs.get(`${world.module}.${name}`);
      try {
        if (!pack) throw Error(`Foundry did not load its ${name} compendium. Reload, and if it is still missing check that Data/modules/${world.module}/packs/${name} exists.`);
        const index = await pack.getIndex();
        const res = await fetch(worldUrl(world.id, file), { cache: "no-store" });
        if (!res.ok) throw Error(`${file}: HTTP ${res.status}`);
        const short = (await res.json()).filter((d) => !index.has(d._id));
        if (!short.length) continue;
        const locked = pack.locked;
        if (locked) await pack.configure({ locked: false });
        try {
          const cls = getDocumentClass(type);
          for (let i = 0; i < short.length; i += IN_ONE_GO) await cls.createDocuments(short.slice(i, i + IN_ONE_GO), { pack: pack.collection, keepId: true });
        } finally {
          if (locked) await pack.configure({ locked: true });
        }
        added += short.length;
      } catch (err) {
        console.error(`${ID} | filling ${world.module}.${name}`, err);
        ui.notifications.error(`KG Realms: could not fill the ${name} compendium of ${world.title}: ${err?.message ?? err} It will try again next load.`, { permanent: true });
      }
    }
    if (added) ui.notifications.info(`KG Realms: ${world.title}'s compendiums are ready (${added} documents). Drag its realm map in from them, and its settlements come with it.`, { permanent: true });
  }
}

/** A document from a module's compendium, into this game world under its own id, unless it is here. */
async function bringIn(world, type, id, collection, folder) {
  if (collection?.get(id)) return false;
  const pack = game.packs.get(`${world.module}.${PACK_NAMES[type]}`);
  const doc = await pack?.getDocument(id);
  if (!doc) return false;
  await getDocumentClass(type).create({ ...doc.toObject(), ...(folder ? { folder } : {}) }, { keepId: true });
  return true;
}

/**
 * A scene arriving from a module's compendium. It takes the id places and pins know it by (Foundry
 * gives an import a new one), its tokens' actors come too, and a realm map brings its settlements.
 */
export async function sceneFromModule(scene, options, userId) {
  const from = scene.flags?.[ID]?.moduleScene;
  if (!from || userId !== game.user.id) return;
  try {
    if (scene.id !== from.id && !game.scenes.get(from.id)) {
      const data = { ...scene.toObject(), _id: from.id };
      await scene.delete();
      await scene.constructor.create(data, { keepId: true });
      return;
    }
    const world = allWorlds().find((w) => w.id === from.world);
    if (!world) return;
    for (const t of scene.tokens ?? []) if (t.actorId) await bringIn(world, "Actor", t.actorId, game.actors);
    if (!scene.flags[ID].world) return;
    const pack = game.packs.get(`${world.module}.scenes`), index = await pack?.getIndex();
    for (const entry of index ?? []) if (entry._id !== from.id) await bringIn(world, "Scene", entry._id, game.scenes, scene.folder?.id ?? scene.folder ?? null);
  } catch (err) {
    console.error(`${ID} | bringing in ${scene.name}`, err);
    ui.notifications.error(`KG Realms: could not bring in everything for ${scene.name}: ${err?.message ?? err}`, { permanent: true });
  }
}
