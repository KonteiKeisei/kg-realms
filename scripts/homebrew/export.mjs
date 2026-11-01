// Export a made world as a module (0.79): everything the world is, so it works in any game world.
// The map and its tiles; places, roads, rivers, biomes, encounters, trade and snow with every edit
// applied; each scene the world reaches, with its pins, lights and walls; and every picture and
// sound those name, copied into the module with their links changed. What cannot be carried is
// listed in the export's report, never dropped quietly.
import { worldUrl, allWorlds } from "../worlds.mjs";
import { applyRouteEdits } from "../routes.mjs";
import { TILE_SUFFIX, moduleIdFrom, moduleScript, ROUTES_FILE, zipEntry, zipParts, crc32, zipFits } from "./plan.mjs";
import { fileRef, scanFiles, rewriteFiles, cardFolder, sceneFolder, assetNamer, placeForExport, scenesOfWorld, sceneForExport, linkedDocuments, markersUsed, exportReport } from "./export-plan.mjs";

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

/** The world as a module: { name, parts, report }. onStep(message, 0 to 1) tells how far along it is. */
export async function buildExport(def, { moduleId, title, version }, onStep = () => {}) {
  const dir = `${moduleId}/data/worlds/${def.id}`, entries = [];
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

  // The scenes.
  onStep("Gathering the scenes", 0.03);
  const { scenes: docs, missing: scenesMissing } = scenesOfWorld(game.scenes.map((s) => s.toObject()), places, def.id);
  const scenes = docs.map(sceneForExport);
  const skippedTokens = docs.reduce((n, s) => n + (s.tokens?.length ?? 0), 0);
  const linked = linkedDocuments([places, docs.map((s) => s.notes ?? []), data.encounters]);

  // The markers the world's places and pins use.
  const markers = markersUsed(data.markers, [places, scenes]);

  // Every file those name, and where it goes.
  const named = new Map();
  scanFiles([...files.values()], cardFolder, named);
  scanFiles(markers, cardFolder, named);
  scanFiles(scenes, sceneFolder, named);

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
  const finalMarkers = rewriteFiles(markers, paths);
  for (const [id, m] of Object.entries(markers)) if (paths.has(m.src)) finalMarkers[id].originalSrc = m.src;

  for (const [rel, value] of files) if (rel !== "index.json") await add(`${dir}/${rel}`, json(rewriteFiles(value, paths)));
  const final = rewriteFiles(files.get("index.json"), paths);
  await add(`${dir}/index.json`, json(final));

  // The scenes, one file each, and the list the engine brings in from.
  const sceneList = [];
  for (const scene of scenes) {
    const file = `${scene._id}.json`;
    await add(`${dir}/scenes/${file}`, json(rewriteFiles(scene, paths)));
    sceneList.push({ id: scene._id, name: scene.name, file });
  }
  await add(`${dir}/scenes/index.json`, json(sceneList));

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
  await add(`${moduleId}/module.json`, encoder.encode(JSON.stringify({ id: moduleId, title, description: `${def.title}, a world for KG Realms.`, version, authors: [{ name: game.user.name }], compatibility: { minimum: "13", verified: "14" }, relationships: { requires: [{ id: ID, type: "module", compatibility: { minimum: kg?.version ?? "0.79.0" } }] }, esmodules: ["scripts/main.mjs"] }, null, 2)));
  await add(`${moduleId}/scripts/main.mjs`, encoder.encode(moduleScript(moduleId, def, { snow: data.snow, markers: finalMarkers, rules: def.rules, scenes: true })));

  const report = exportReport({
    title, version, moduleId, skippedTokens, scenesMissing, linked, missing, external,
    counts: { "places": places.length, "roads": routes.features.length, "rivers and shores": Object.keys(data.waterways).length, "encounters": Object.keys(data.encounters).length, "scenes": scenes.length, "pictures and sounds": written.size, "custom markers": Object.keys(markers).length, "map tiles": tiles.length }
  });
  await add(`${moduleId}/export-report.txt`, encoder.encode(report));
  if (!zipFits(entries)) throw Error("this world is too large for one zip (over 4 GB). Shrink the map or its pictures and try again.");
  onStep("Building the zip", 0.97);
  return { name: `${moduleId} v${version}.zip`, parts: zipParts(entries), report, problems: missing.length + external.length + scenesMissing.length };
}

export async function exportModule(def) {
  if (!def) return;
  const values = await foundry.applications.api.DialogV2.wait({
    window: { title: "Export as module", icon: "fa-solid fa-file-export" }, position: { width: 460 }, rejectClose: false,
    content: `<div class="form-group"><label>Module title</label><input name="title" type="text" value="KG Realms: ${esc(def.title)}"></div>
      <div class="form-group"><label>Module id ${q("The folder name in Data/modules: lowercase letters, digits and dashes.")}</label><input name="id" type="text" value="${esc(moduleIdFrom(def.title))}" pattern="[a-z0-9-]+"></div>
      <div class="form-group"><label>Version</label><input name="version" type="text" value="1.0.0"></div>
      <p class="notes">The zip holds the whole world: its map, places, roads, rivers, biomes, encounters, trade and snow with every edit, each scene it links to, and every picture on its cards and scenes, moved into the module and linked up. ${q("Pictures on cards and markers go to assets/poi-img, scene maps to assets/maps. Tokens stay out of the scenes, because their actors stay in this game world.")}</p>
      <p class="notes">Afterwards you get a report of anything that could not be carried. It is also in the zip, as export-report.txt.</p>
      <p class="notes">Once the module is installed and enabled, the world reads from it. In a new game world its scenes are added to the Scenes sidebar the first time a GM loads it.</p>`,
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

/**
 * A world module's scenes, brought into a game world once each (the first GM to load it). A scene keeps
 * its id, so the links between places, pins and scenes hold; one already here is left as it is, and
 * one the GM deletes stays deleted. A scene that fails says so and is tried again next load.
 */
export async function importModuleScenes() {
  const done = new Set(game.settings.get(ID, "moduleScenesDone") ?? []);
  const added = [];
  for (const world of allWorlds().filter((w) => w.scenes)) {
    try {
      const res = await fetch(worldUrl(world.id, "scenes/index.json"), { cache: "no-store" });
      if (!res.ok) throw Error(`scenes/index.json: HTTP ${res.status}`);
      let folder = null;
      for (const entry of await res.json()) {
        const key = `${world.id}/${entry.id}`;
        if (done.has(key)) continue;
        if (!game.scenes.get(entry.id)) {
          const r = await fetch(worldUrl(world.id, `scenes/${entry.file}`), { cache: "no-store" });
          if (!r.ok) throw Error(`${entry.name}: HTTP ${r.status}`);
          folder ??= game.folders.find((f) => f.type === "Scene" && f.name === world.title) ?? await Folder.implementation.create({ name: world.title, type: "Scene" });
          await Scene.implementation.create({ ...await r.json(), folder: folder.id }, { keepId: true });
          added.push(entry.name);
        }
        done.add(key);
      }
    } catch (err) {
      console.error(`${ID} | scenes of ${world.id}`, err);
      ui.notifications.error(`KG Realms: could not add the scenes of ${world.title}: ${err?.message ?? err}. It will try again next load.`, { permanent: true });
    }
  }
  await game.settings.set(ID, "moduleScenesDone", [...done]);
  if (added.length) ui.notifications.info(`KG Realms: added ${added.length} scene${added.length === 1 ? "" : "s"} to the Scenes sidebar: ${added.join(", ")}.`);
}
