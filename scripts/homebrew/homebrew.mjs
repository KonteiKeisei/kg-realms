// Homebrew realm worlds (0.74): the GM right-clicks a scene with a map picture and chooses "Make
// realm world". The scene is backed up, the picture is cut into KTX2 tiles in the browser (Basis
// Universal, lib/basis), and a world with nothing on it yet is saved in Foundry's Data folder
// (KG Realms Data/World/<id>/) and registered on every load from a world setting.
// The scene then draws as a realm map. Afterwards: settings, revert to the backup, export as module.
import { isPrimaryGM } from "../authority.mjs";
import { runMapBuild } from "./map-build.mjs";
import { backgroundOf, setBackground } from "../local-maps.mjs";
import { registerWorld, worldDef, allWorlds, worldUrl } from "../worlds.mjs";
import { forgetWorld, DATA_VERSION } from "../generator.mjs";
import { REALM_DARK_AMBIENCE, REALM_AMBIENCE_REVISION } from "../scene-ambience.mjs";
import { TileEncoder, cutTile, ktx2Header } from "./tiles.mjs";
import { exportModule, fillModulePacks, sceneFromModule, applyModuleCalendars, restoreModuleRegionalMaps } from "./export.mjs";
import {promptInstalledScenes,registerSceneSetup,adoptPackagedScenes} from '../module-scenes.mjs';
import { startBiomeClimates } from "../biome-weather.mjs";
import { MAX_PICTURE, TILE_SUFFIX, worldIdFrom, homebrewSheet, planTiles, packManifest, emptyIndex, ROUTES_FILE, milesFromGrid, resheet, DATA_HOME, dataFolder, inGameWorld, freeFolder, filesToMove, copyFiles, detailLevels, nextTileFolder } from "./plan.mjs";

const ID = "kg-realms";
const SETTING = "homebrewWorlds";
const BACKUPS = "KG Realms backups";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const q = (tip) => `<span class="kgr-rule" tabindex="0" data-tooltip="${esc(tip)}" data-tooltip-class="kgr-rule-tip" aria-label="${esc(tip)}">?</span>`;
const FilePickerImpl = () => foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
const saved = () => foundry.utils.deepClone(game.settings.get(ID, SETTING) ?? {});
const sceneOf = (li) => { const el = li instanceof HTMLElement ? li : li?.[0]; return game.scenes.get(el?.dataset?.entryId ?? el?.dataset?.documentId); };
const isVideo = (src) => /\.(webm|mp4|m4v|ogv)(\?|$)/i.test(src ?? "");
let reloading = false;

/** Init: the setting, then every saved homebrew world registered (before world modules, which win). */
export function registerHomebrew() {
  game.settings.register(ID, SETTING, { scope: "world", config: false, type: Object, default: {} });
  registerSceneSetup();
  Hooks.on("createScene", sceneFromModule);
  // A world's map was rebuilt: everyone reloads, so nobody keeps drawing the old one.
  Hooks.on("updateScene", (scene, changes) => {
    if (changes.flags?.[ID]?.mapVersion == null || reloading) return;
    reloading = true;
    ui.notifications.info("KG Realms: the map was rebuilt. Reloading...");
    foundry.utils.debouncedReload();
  });
  game.settings.register(ID, "calendarsApplied", { scope: "world", config: false, type: Object, default: {} });
  // Calendaria finishes starting after "ready", and says so.
  // The module's calendar first, so the biome climates go on the calendar the world will use.
  Hooks.once("calendaria.ready", async () => {
    await applyModuleCalendars().catch((err) => console.error(`${ID} | calendars`, err));
    await startBiomeClimates().catch((err) => console.error(`${ID} | biome climates`, err));
  });
  for (const def of Object.values(game.settings.get(ID, SETTING) ?? {})) {
    try { registerWorld(def); } catch (err) { console.warn(`${ID} | homebrew world ${def?.id}:`, err); }
  }
  for (const hook of ["getSceneContextOptions", "getSceneDirectoryEntryContext"]) Hooks.on(hook, (app, options) => contextOptions(options));
  Hooks.once("ready", async () => {
    await adoptPackagedScenes();
    if (game.user !== game.users.activeGM) return;
    await moveWorlds();
    await fillModulePacks();
    await restoreModuleRegionalMaps();
    await promptInstalledScenes();
    if (!game.modules.get("calendaria")?.active) await applyModuleCalendars();
    await resheetWorlds().catch((err) => console.warn(`${ID} | moving homebrew worlds`, err));
    await fillWorlds().catch((err) => console.warn(`${ID} | homebrew world files`, err));
  });
}

/** The folders in a folder of the Data folder, by name; none when it is not there yet. */
async function foldersIn(dir) {
  const listing = await FilePickerImpl().browse("data", dir).catch(() => null);
  return (listing?.dirs ?? []).map((d) => decodeURIComponent(d).split("/").pop());
}
/** Every file under a folder, relative to it; none if it cannot be listed (the pack still names the tiles). */
async function filesIn(root, at = root) {
  const listing = await FilePickerImpl().browse("data", at).catch(() => null);
  const here = (listing?.files ?? []).map((f) => decodeURIComponent(f).slice(root.length + 1));
  const below = await Promise.all((listing?.dirs ?? []).map((d) => filesIn(root, decodeURIComponent(d))));
  return [...here, ...below.flat()];
}
const readBytes = async (path) => {
  const res = await fetch(foundry.utils.getRoute(path), { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw Error(`${path}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

/**
 * 0.78: worlds made earlier move out of their game world's folder. Every file is read back before
 * the world switches to the new folder, and a failure leaves it reading the old one (and says so),
 * to try again next load. Foundry cannot delete files, so the old folder is left for the GM.
 */
async function moveWorlds() {
  for (const def of Object.values(saved())) {
    if (!inGameWorld(def) || !worldDef(def.id)) continue;
    let note = null;
    try {
      const pack = JSON.parse(new TextDecoder().decode(await readBytes(`${def.root}/terrain-pack.json`)));
      const routes = JSON.parse(new TextDecoder().decode(await readBytes(`${def.root}/index.json`))).routes ?? ROUTES_FILE;
      // A folder holding this same map is an earlier move that stopped: carry on in it.
      const taken = await foldersIn(DATA_HOME);
      const same = taken.includes(def.id) && await readBytes(`${dataFolder(def.id)}/terrain-pack.json`).then((b) => b && JSON.parse(new TextDecoder().decode(b)).fingerprint === pack.fingerprint).catch(() => false);
      const to = dataFolder(same ? def.id : freeFolder(def.id, taken));
      const files = filesToMove(pack, await filesIn(def.root), routes);
      note = ui.notifications.info(`KG Realms: moving ${def.title} to Data/${to}. Leave this window open.`, { permanent: true });
      for (const dir of new Set(files.map((f) => f.path.split("/").slice(0, -1).join("/")))) await ensureDir(dir ? `${to}/${dir}` : to);
      await copyFiles(files, {
        read: (rel) => readBytes(`${def.root}/${rel}`),
        write: async (rel, bytes) => {
          const parts = rel.split("/"), name = parts.pop(), dir = [to, ...parts].join("/");
          const path = await upload(dir, name, bytes, name.endsWith(".json") ? "application/json" : "application/octet-stream");
          return readBytes(path);
        }
      });
      const all = saved(); all[def.id] = { ...all[def.id], root: to, assetBase: to, movedFrom: def.root };
      await game.settings.set(ID, SETTING, all);
      registerWorld(all[def.id]); forgetWorld(def.id);
      ui.notifications.info(`KG Realms: ${def.title} now lives in Data/${to}. Check it, then you can delete the old folder, Data/${def.root}.`, { permanent: true });
      if (canvas.scene?.getFlag(ID, "world") === def.id) canvas.draw();
    } catch (err) {
      console.error(`${ID} | moving ${def.id}`, err);
      ui.notifications.error(`KG Realms: could not move ${def.title} to Data/${DATA_HOME}: ${err?.message ?? err}. It keeps working from its old folder, and the move will try again next time you load.`, { permanent: true });
    } finally {
      if (note) ui.notifications.remove?.(note);
    }
  }
}

/** A made world's optional files, empty: KG Realms reads none as none, but the browser logs every missing file. */
async function writeEmptyFiles(def) {
  await ensureDir(`${def.root}/local`);
  await uploadJson(def.root, "encounters.json", { version: 2, world: def.id, encounters: {} });
  await uploadJson(`${def.root}/local`, "index.json", []);
}
/** 0.75.3: worlds made before it get those files, once (any already there are kept). */
async function fillWorlds() {
  for (const def of Object.values(saved())) {
    if (def.files >= 2 || !worldDef(def.id)) continue;
    const missing = async (rel) => (await fetch(worldUrl(def.id, rel), { cache: "no-store" }).catch(() => null))?.status === 404;
    if (await missing("encounters.json") && await missing("local/index.json")) await writeEmptyFiles(def);
    const all = saved(); if (all[def.id]) { all[def.id].files = 2; await game.settings.set(ID, SETTING, all); }
  }
}

/** Anything saved in this game world's edit settings for a world (places, roads, rivers, biomes). */
const hasContent = (v) => Array.isArray(v) ? v.some(hasContent) : v && typeof v === "object" ? Object.values(v).some(hasContent) : v != null && v !== false && v !== "";
const hasEdits = (id) => ["placeEdits", "routeEdits", "waterways", "biomes"].some((key) => hasContent(game.settings.get(ID, key)?.[id]));

/**
 * 0.74.2: worlds made by 0.74.0 and 0.74.1 sat in a web map world only twice the picture's size,
 * so their scenes could not zoom out to the whole map. Worlds with nothing on them yet are moved
 * to the current sheet rules; their tiles are kept.
 */
async function resheetWorlds() {
  for (const def of Object.values(saved())) {
    if (!worldDef(def.id)) continue;
    const get = async (rel) => (await fetch(worldUrl(def.id, rel), { cache: "no-store" })).json();
    const next = resheet(await get("index.json"), await get("terrain-pack.json"));
    if (!next) continue;
    if (hasEdits(def.id) || next.index.places?.length) { console.warn(`${ID} | ${def.title} cannot zoom out to its whole map; it already has places or roads, so it is left as it is.`); continue; }
    next.pack.fingerprint = await sha256(new TextEncoder().encode(JSON.stringify(next.pack.lods)));
    await uploadJson(def.root, "terrain-pack.json", next.pack);
    await uploadJson(def.root, "index.json", next.index);
    forgetWorld(def.id);
    for (const s of game.scenes.filter((s) => s.getFlag(ID, "world") === def.id)) await s.update({ [`flags.${ID}.bounds`]: next.index.sourceMap.bounds });
    ui.notifications.info(`KG Realms: ${def.title} can now zoom out to its whole map.`);
    if (canvas.scene?.getFlag(ID, "world") === def.id) canvas.draw();
  }
}

function contextOptions(options) {
  if (!Array.isArray(options)) return;
  const gm = () => game.user.isGM;
  options.push(
    { name: "Make realm world", icon: '<i class="fa-solid fa-earth-europe"></i>', condition: (li) => { const s = sceneOf(li); return gm() && !!s?.background?.src && !isVideo(s.background.src) && !s.getFlag(ID, "world") && !s.getFlag(ID, "localMap"); }, callback: (li) => makeRealmWorld(sceneOf(li)) },
    { name: "Make regional map", icon: '<i class="fa-solid fa-map-location-dot"></i>', condition: li=>{const s=sceneOf(li);return gm()&&!!s?.background?.src&&!isVideo(s.background.src)&&!s.getFlag(ID,"world")&&!s.getFlag(ID,"localMap");}, callback: async li=>{const scene=sceneOf(li);await makeRealmWorld(scene,{regional:true});if(scene?.getFlag(ID,"world")){await scene.setFlag(ID,"regionalMap",true);await game.modules.get(ID).api.regionalMaps.configure(scene);}} },
    { name: "Realm world settings", icon: '<i class="fa-solid fa-gear"></i>', condition: (li) => gm() && !!homebrewOf(sceneOf(li)), callback: (li) => worldSettings(sceneOf(li)) },
    { name: "Revert to backup", icon: '<i class="fa-solid fa-rotate-left"></i>', condition: (li) => gm() && !!sceneOf(li)?.getFlag(ID, "homebrewOriginal"), callback: (li) => revert(sceneOf(li)) },
    { name: "Export as module", icon: '<i class="fa-solid fa-file-export"></i>', condition: (li) => gm() && !!exportWorldOf(sceneOf(li)), callback: (li) => exportModule(exportWorldOf(sceneOf(li)),sceneOf(li)?.id) }
  );
}

/** Companion realms and made maps can both export this world's edited content. */
function exportWorldOf(scene) {
  const id = scene?.getFlag(ID, "world");
  return id ? worldDef(id) ?? homebrewOf(scene) : null;
}

/** The homebrew world a realm scene draws, if it is one saved in this game world. */
function homebrewOf(scene) {
  const id = scene?.getFlag(ID, "world");
  return id && saved()[id] ? worldDef(id) ?? saved()[id] : null;
}

/* ------------------------------------------------------------------ files */

export async function ensureDir(path) {
  const FP = FilePickerImpl();
  let at = "";
  for (const part of path.split("/")) {
    at = at ? `${at}/${part}` : part;
    try { await FP.createDirectory("data", at, {}); } catch (err) { if (!/exist/i.test(String(err?.message ?? err))) throw err; }
  }
}

export async function upload(dir, name, bytes, type) {
  const file = new File([bytes], name, { type });
  const result = await FilePickerImpl().upload("data", dir, file, {}, { notify: false });
  if (!result || result.error || result.status === 'error' || typeof result.path !== 'string' || !result.path) throw Error(result?.message ?? result?.error ?? `The server did not confirm saving ${name}.`);
  return result.path;
}
const uploadJson = (dir, name, value) => upload(dir, name, JSON.stringify(value), "application/json");

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) throw Error("this browser cannot check files here (Foundry needs to be opened over https or on localhost)");
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((n) => n.toString(16).padStart(2, "0")).join("");
}

/** Foundry must keep a tile's bytes exactly: save a small one and read it back first. */
async function checkUploads(dir) {
  const probe = new Uint8Array([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const path = await upload(dir, `probe${TILE_SUFFIX}`, probe, "application/octet-stream");
  const back = new Uint8Array(await (await fetch(foundry.utils.getRoute(path), { cache: "no-store" })).arrayBuffer());
  if (back.length !== probe.length || back.some((b, i) => b !== probe[i])) throw Error("this Foundry server changed a saved map tile. Map tiles cannot be stored here.");
}

/* ------------------------------------------------------------------ encoding */

/* ------------------------------------------------------------------ progress window */

// Made on first use: Foundry's application classes are not there when this file loads in tests.
let BuildWindowClass = null;
export const BuildWindow = function (...args) { BuildWindowClass ??= buildWindowClass(); return new BuildWindowClass(...args); };
const buildWindowClass = () => class extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = { id: "kgr-realm-build", classes: ["kg-realms-build"], window: { title: "Making realm world", icon: "fa-solid fa-earth-europe" }, position: { width: 420 } };
  constructor(name, onStop, { title = `Making ${name}`, id, steps = [["backup", "Back up the scene"], ["read", "Read the picture"], ["tiles", "Make map tiles"], ["save", "Save the world"], ["scene", "Turn the scene into a realm map"]] } = {}) {
    super({ window: { title }, ...(id?{id}:{}) });
    this.onStop = onStop;
    this.steps = steps.map(([key, label]) => ({ key, label, state: "todo", note: "" }));
    this.done = 0; this.total = 0; this.started = Date.now(); this.message = "";
  }
  set(key, state, note = "") { const s = this.steps.find((x) => x.key === key); if (s) Object.assign(s, { state, note }); this.render(); }
  async _renderHTML() {
    const icon = { done: "fa-solid fa-check", now: "fa-solid fa-circle-half-stroke", todo: "fa-regular fa-circle", failed: "fa-solid fa-xmark" };
    const pct = this.total ? Math.min(this.done < this.total ? 99 : 100, Math.round((100 * this.done) / this.total)) : 0;
    const left = this.done && this.total > this.done && Number.isFinite(this.tilesStarted) ? Math.round(((Date.now() - this.tilesStarted) / this.done) * (this.total - this.done) / 1000) : null;
    const detail = this.progressDetails;
    return `<div class="kgr-build">
      <ol class="kgr-build-steps">${this.steps.map((s) => `<li class="${s.state}"><i class="${icon[s.state]}"></i><span>${esc(s.label)}</span><em>${esc(s.note)}</em></li>`).join("")}</ol>
      ${detail ? `<div class="kgr-build-source"><strong>${esc(detail.label)}</strong><span class="kgr-build-file" title="${esc(detail.path)}">${esc(detail.file)}</span><span>${esc(detail.note)}</span><span>${detail.total ? `Chunks saved and verified: ${detail.done} / ${detail.total}` : "Waiting for chunk plan"}</span><div class="kgr-build-bar" role="progressbar" aria-label="Current source chunks" aria-valuenow="${detail.done}" aria-valuemin="0" aria-valuemax="${detail.total || 1}"><span style="width:${detail.total ? 100 * detail.done / detail.total : 0}%"></span></div></div><p class="kgr-build-overall">${esc(detail.overall)}</p>` : ""}
      <div class="kgr-build-bar" role="progressbar" aria-label="Overall build progress" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
      <p class="kgr-build-note">${esc(this.message || (left != null ? `About ${left < 90 ? `${left} seconds` : `${Math.round(left / 60)} minutes`} left` : "Foundry stays usable while this runs. Closing this window does not stop it."))}</p>
      ${this.finished ? "" : `<div class="kgr-build-actions"><button type="button" data-stop>Stop</button></div>`}
    </div>`;
  }
  _replaceHTML(result, content) { content.innerHTML = result; content.querySelector("[data-stop]")?.addEventListener("click", () => this.onStop()); }
};

/* ------------------------------------------------------------------ make */

async function makeRealmWorld(scene,{regional=false}={}) {
  if (!scene) return;
  const all = saved(), again = Object.values(all).find((d) => d.scene === scene.id && worldDef(d.id));
  const values = await foundry.applications.api.DialogV2.wait({
    window: { title: regional?"Make regional map":"Make realm world", icon: regional?"fa-solid fa-map-location-dot":"fa-solid fa-earth-europe" }, position: { width: 440 }, rejectClose: false,
    content: `<div class="kgr-make-world">
      <div class="form-group"><label>${regional?"Regional map name":"World name"}</label><input name="name" type="text" value="${esc(again?.title ?? scene.name)}" required></div>
      <div class="form-group"><label>Map width in miles ${q("How far it is from the left edge of the picture to the right. Travel times and the day's distance on the route sheet use it. You can change it later in the world's settings.")}</label><input name="miles" type="number" min="1" step="any" value="${again?.miles ?? milesFromGrid(scene.width, scene.grid) ?? 1000}" required></div>
      ${again ? `<div class="form-group"><label class="checkbox"><input name="reuse" type="checkbox" checked> Use the map tiles already made for ${esc(again.title)}</label></div>` : ""}
      <p class="notes">${regional?"First build the detailed map tiles. Next, choose its parent realm and place an aspect-matched rectangle. Parent POIs inside that outline will appear on the regional map; review their positions and trace its detailed roads.":"Nothing is read from the picture: the realm starts empty and you add places, roads, rivers and areas with the editors."} The scene is copied to the "${BACKUPS}" folder first. The map's files are saved in Data/${DATA_HOME}.</p>
      <p class="notes">Pictures over ${MAX_PICTURE.toLocaleString()} px on a side are shrunk to fit (a browser limit); the picture file is never changed.</p>
    </div>`,
    buttons: [{ action: "make", label: regional?"Build regional map":"Make realm world", icon: regional?"fa-solid fa-map-location-dot":"fa-solid fa-earth-europe", default: true, callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object }, { action: "cancel", label: "Cancel" }]
  });
  if (!values || typeof values !== "object") return;
  const name = String(values.name ?? "").trim() || scene.name, miles = Number(values.miles);
  if (!(miles > 0)) return ui.notifications.warn("KG Realms: the map width in miles must be more than 0.");
  if (again && values.reuse) return convertScene(scene, again.id, { name, miles });
  return build(scene, name, miles);
}

async function build(scene, name, miles) {
  let stopped = false, encoder = null, backup = null;
  const win = new BuildWindow(name, () => { stopped = true; win.message = "Stopping..."; win.render(); encoder?.stop(); });
  win.render({ force: true });
  const halt = () => { if (stopped) throw Error("stopped"); };
  let step = "backup";
  try {
    win.set("backup", "now");
    backup = await backupScene(scene);
    win.set("backup", "done", BACKUPS);
    step = "read"; win.set("read", "now"); halt();
    const blob = await (await fetch(foundry.utils.getRoute(scene.background.src))).blob();
    let bitmap = await createImageBitmap(blob);
    if (Math.max(bitmap.width, bitmap.height) > MAX_PICTURE) {
      const k = MAX_PICTURE / Math.max(bitmap.width, bitmap.height), w = Math.round(bitmap.width * k), h = Math.round(bitmap.height * k);
      bitmap.close(); bitmap = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
    }
    win.set("read", "done", `${bitmap.width.toLocaleString()} x ${bitmap.height.toLocaleString()}`);

    step = "tiles"; halt();
    const id = worldIdFrom(name, [...allWorlds().map((w) => w.id), ...Object.keys(saved()), ...await foldersIn(DATA_HOME)]);
    const root = dataFolder(id), tileDir = `${root}/assets/terrain`;
    await ensureDir(tileDir);
    await checkUploads(tileDir);
    const sheet = homebrewSheet(bitmap.width, bitmap.height, miles), lods = planTiles(sheet), tiles = lods.flatMap((l) => l.tiles);
    encoder = await encodeTiles(bitmap, tiles, tileDir, win, halt, (e) => { encoder = e; });
    encoder.stop(); encoder = null; bitmap.close();
    win.set("tiles", "done", `${tiles.length} tiles`);

    step = "save"; win.set("save", "now"); halt();
    const clean = lods.map((l) => ({ ...l, tiles: l.tiles.map(({ crop, ...t }) => t) }));
    const pack = packManifest(id, sheet, lods, await sha256(new TextEncoder().encode(JSON.stringify(clean))));
    await uploadJson(root, "terrain-pack.json", pack);
    await uploadJson(root, "index.json", emptyIndex(id, name, sheet));
    await uploadJson(root, ROUTES_FILE, { type: "FeatureCollection", features: [] });
    await uploadJson(root, "waterways.json", { waterways: {} });
    await uploadJson(root, "biomes.json", {});
    await writeEmptyFiles({ id, root });
    const def = { id, title: name, module: ID, root, assetBase: root, mapName: name, terrainPack: "terrain-pack.json", homebrew: true, miles, scene: scene.id, backup: backup.id, made: new Date().toISOString(), files: 2 };
    const all = saved(); all[id] = def; await game.settings.set(ID, SETTING, all);
    registerWorld(def);
    win.set("save", "done", root);

    step = "scene"; win.set("scene", "now");
    await convertScene(scene, id, { name, miles, backup });
    win.set("scene", "done");
    win.finished = true; win.message = `${name} is ready. Open the scene to start building it.`; win.render();
    ui.notifications.info(`KG Realms: ${name} is ready. The original scene is in "${BACKUPS}".`);
  } catch (err) {
    encoder?.stop();
    win.set(step, "failed");
    win.finished = true;
    if (backup && step !== "scene") await backup.delete().catch(() => {});
    if (stopped) { win.message = "Stopped. The scene is unchanged."; win.render(); return; }
    console.error(`${ID} | making a realm world`, err);
    const memory = /memory|allocation|RangeError/i.test(String(err?.message ?? err));
    win.message = memory ? "The browser ran out of memory. Shrink the picture (for example to 8,000 px on its long side) and try again. The scene is unchanged." : `Could not make the world: ${err?.message ?? err}. The scene is unchanged.`;
    win.render();
  }
}

/** Cut a picture into its tiles, encode them and save them, on as many workers as can be spared. Returns the encoder. */
async function encodeTiles(bitmap, tiles, tileDir, win, halt, started) {
  win.total = tiles.length; win.tilesStarted = Date.now(); win.set("tiles", "now", `0 / ${tiles.length}`);
  const count = Math.max(1, Math.min(3, (navigator.hardwareConcurrency ?? 2) - 1));
  const encoder = new TileEncoder(count, `${location.origin}${foundry.utils.getRoute(`modules/${ID}`)}`);
  started(encoder);
  await encoder.ready;
  let next = 0;
  await Promise.all(Array.from({ length: count }, async (_, worker) => {
    while (next < tiles.length) {
      halt();
      const tile = tiles[next++];
      const bytes = await encoder.encode(worker, cutTile(bitmap, tile), tile.textureWidth, tile.textureHeight);
      halt();
      const head = ktx2Header(bytes);
      if (!head.magic || head.width !== tile.textureWidth || head.height !== tile.textureHeight || head.levels !== 1) throw Error(`the encoder made a bad tile (${tile.id})`);
      tile.ktxBytes = bytes.byteLength; tile.hash = await sha256(bytes);
      await upload(tileDir, `${tile.id}${TILE_SUFFIX}`, bytes, "application/octet-stream");
      win.done++; win.set("tiles", "now", `${win.done} / ${tiles.length}`);
    }
  }));
  return encoder;
}

async function backupScene(scene) {
  let folder = game.folders.find((f) => f.type === "Scene" && f.name === BACKUPS);
  folder ??= await Folder.implementation.create({ name: BACKUPS, type: "Scene", color: "#5a4a36" });
  return scene.clone({ name: `${scene.name} (backup)`, folder: folder.id, active: false, navigation: false }, { save: true });
}

/** The scene drawn as the world's realm map: its picture becomes the realm's ground. */
async function convertScene(scene, id, { miles, backup = null }) {
  const def = worldDef(id) ?? saved()[id];
  const index = await (await fetch(worldUrl(id, "index.json"), { cache: "no-store" })).json();
  const milesPer100 = (miles / scene.width) * 100;
  const original = scene.getFlag(ID, "homebrewOriginal") ?? { background: scene._source.background?.src ?? null, grid: foundry.utils.deepClone(scene._source.grid), backgroundColor: scene._source.backgroundColor, backup: backup?.id ?? def?.backup ?? null };
  await scene.update({
    "background.src": null, backgroundColor: "#000000",
    grid: { type: CONST.GRID_TYPES.GRIDLESS, size: 100, distance: Number(milesPer100.toFixed(4)), units: "mi" },
    "environment.dark": REALM_DARK_AMBIENCE,
    [`flags.${ID}`]: { world: id, level: "surface", bounds: index.sourceMap.bounds, milesPer100, version: DATA_VERSION, darkAmbience: REALM_AMBIENCE_REVISION, homebrewOriginal: original }
  });
}

/* ------------------------------------------------------------------ a better picture */

/**
 * The scene config of a made realm map: a button under Foundry's own Background Image, which makes the
 * map's tiles from the picture there. The field is Foundry's, so it saves with the scene as always.
 * Once the tiles are made it is emptied again: the tiles are the map's picture.
 */
export function sceneMapPicture(root, scene) {
  if (!root || !scene || !homebrewOf(scene) || root.querySelector("[data-kgr-map-picture]")) return;
  const field = root.querySelector('[name$="background.src"]');
  const used = scene.getFlag(ID, "homebrewOriginal")?.background ?? "";
  const row = document.createElement("div");
  row.dataset.kgrMapPicture = "true";
  row.className = "form-group";
  row.innerHTML = `<label>Map tiles ${q("Makes this realm map's tiles from the picture in Background Image. It is fitted to this map's shape, and a bigger picture keeps its detail when you zoom in. Places, roads, rivers and everything else stay where they are, on top of the new art.")}</label><div class="form-fields"><button type="button" data-map-regen><i class="fa-solid fa-arrows-rotate"></i> Regenerate map tiles from this picture</button></div><p class="hint">Choose the new picture in Background Image, then click this. The current map keeps working until the tiles are ready, then everyone's game reloads.${used ? ` Tiles last made from: ${esc(used)}` : ""}</p>`;
  row.querySelector("[data-map-regen]").addEventListener("click", () => {
    const src = String(field?.value ?? "").trim() || backgroundOf(scene) || used;
    if (!src) return ui.notifications.warn("KG Realms: choose a picture in Background Image first.");
    regenerateMap(scene, src);
  });
  const native = field?.closest(".form-group");
  if (native) native.after(row);
  else (root.querySelector('.tab[data-tab="basics"]') ?? root.querySelector("form") ?? root).prepend(row);
}

async function regenerateMap(scene, src) {
  if (!isPrimaryGM()) return ui.notifications.warn("KG Realms: the primary GM must regenerate map tiles.");
  const id = homebrewOf(scene)?.id;
  if (!id) return;
  try { return await runMapBuild(id, () => rebuildMap(scene, src)); }
  catch (error) { ui.notifications.warn(`KG Realms: ${error.message}`); }
}

async function rebuildMap(scene, src) {
  const def = homebrewOf(scene);
  if (!def || !src) return;
  if (isVideo(src)) return ui.notifications.warn("KG Realms: a video cannot be made into map tiles. Choose a picture.");
  const read = async (rel) => (await fetch(worldUrl(def.id, rel), { cache: "no-store" })).json();
  let blob, bitmap, index, oldPack;
  try {
    index = await read("index.json"); oldPack = await read("terrain-pack.json");
    const res = await fetch(foundry.utils.getRoute(src), { cache: "no-store" });
    if (!res.ok) throw Error(`HTTP ${res.status}`);
    blob = await res.blob(); bitmap = await createImageBitmap(blob);
  } catch (err) { console.error(`${ID} | reading a new map picture`, err); return ui.notifications.error(`KG Realms: could not read the picture ${src}: ${err?.message ?? err}`); }
  // The picture is fitted to the map as it is: only the tiles change, nothing else has to. A bigger
  // picture keeps its detail, in finer levels of tiles on the same sheet.
  const sheet = index.sourceMap, detail = detailLevels(sheet, bitmap.width, bitmap.height), f = 2 ** detail;
  bitmap.close();
  const size = (w, h) => `${w.toLocaleString()} x ${h.toLocaleString()}`;
  const go = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Regenerate map tiles", icon: "fa-solid fa-arrows-rotate" }, position: { width: 460 }, rejectClose: false,
    content: `<p>Replace the tiles of <b>${esc(def.title)}</b> with this picture, fitted to the map's shape and kept at ${size(sheet.width * f, sheet.height * f)}.</p>
      <p>Places, roads, rivers and everything else stay exactly where they are. When it finishes, everyone's game reloads.</p>`
  });
  if (!go) return;
  let stopped = false, encoder = null, step = "read", published = false;
  const win = new BuildWindow(def.title, () => { stopped = true; win.message = "Stopping..."; win.render(); encoder?.stop(); }, { title: `New map tiles: ${def.title}`, steps: [["read", "Read the picture"], ["tiles", "Make map tiles"], ["save", "Switch the map to them"]] });
  win.render({ force: true });
  const halt = () => { if (stopped) throw Error("stopped"); };
  try {
    win.set("read", "now");
    bitmap = await createImageBitmap(blob, { resizeWidth: sheet.width * f, resizeHeight: sheet.height * f, resizeQuality: "high" });
    win.set("read", "done", size(bitmap.width, bitmap.height));
    step = "tiles"; halt();
    // A folder of their own: the map in use is not touched until every new tile is saved.
    const folder = nextTileFolder(oldPack, crypto.randomUUID()), tileDir = `${def.root}/${folder}`;
    await ensureDir(tileDir);
    await checkUploads(tileDir);
    const lods = planTiles(sheet, { folder, detail }), tiles = lods.flatMap((l) => l.tiles);
    encoder = await encodeTiles(bitmap, tiles, tileDir, win, halt, (e) => { encoder = e; });
    encoder.stop(); encoder = null; bitmap.close();
    win.set("tiles", "done", `${tiles.length} tiles`);
    step = "save"; win.set("save", "now"); halt();
    const clean = lods.map((l) => ({ ...l, tiles: l.tiles.map(({ crop, ...t }) => t) }));
    const pack = packManifest(def.id, sheet, lods, await sha256(new TextEncoder().encode(JSON.stringify(clean))));
    if (!isPrimaryGM()) throw Error("GM authority changed. Ask the primary GM to rebuild the map.");
    const latest = await read("terrain-pack.json");
    if (latest.fingerprint !== oldPack.fingerprint) throw Error("The map changed during this build. Rebuild from the current map.");
    await uploadJson(def.root, "terrain-pack.json", pack);
    published = true;
    win.set("save", "done");
    win.finished = true; win.message = "Done. Reloading..."; win.render();
    forgetWorld(def.id);
    // The tiles are the map's picture now: the field goes back to empty, and the scene never draws it too.
    if (backgroundOf(scene)) await setBackground(scene, null);
    await scene.update({ [`flags.${ID}.homebrewOriginal.background`]: src, [`flags.${ID}.mapVersion`]: Date.now() });
  } catch (err) {
    encoder?.stop();
    bitmap?.close();
    win.set(step, "failed");
    win.finished = true;
    if (published) { win.message = `The new tiles were saved, but the scene could not refresh: ${err?.message ?? err}. Reload the game to use the new map.`; win.render(); return; }
    if (stopped) { win.message = "Stopped. The map is unchanged."; win.render(); return; }
    console.error(`${ID} | regenerating map tiles`, err);
    const memory = /memory|allocation|RangeError/i.test(String(err?.message ?? err));
    win.message = memory ? "The browser ran out of memory. Shrink the picture (for example to 8,000 px on its long side) and try again. The map is unchanged." : `Could not make the tiles: ${err?.message ?? err}. The map is unchanged.`;
    win.render();
  }
}

/* ------------------------------------------------------------------ afterwards */

async function revert(scene) {
  const original = scene.getFlag(ID, "homebrewOriginal"), def = homebrewOf(scene);
  const yes = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Revert to backup" }, rejectClose: false,
    content: `<p>Put ${esc(scene.name)} back as it was before it became a realm map: its picture and grid.</p><p>${esc(def?.title ?? "The world")} and its map tiles stay saved, so making it a realm world again skips making tiles. Journeys on this scene are cleared.</p>`
  });
  if (!yes) return;
  await scene.update({ "background.src": original.background, grid: original.grid, backgroundColor: original.backgroundColor ?? "#999999", [`flags.-=${ID}`]: null });
  ui.notifications.info(`KG Realms: ${scene.name} is back as it was.${original.backup ? ` Its backup is still in "${BACKUPS}".` : ""}`);
}

async function worldSettings(scene) {
  const def = homebrewOf(scene); if (!def) return;
  const regional=!!(scene.getFlag(ID,"regionalMap")||game.settings.get(ID,"regionalMaps")?.[def.id]);
  const values = await foundry.applications.api.DialogV2.wait({
    window: { title: `${def.title}: settings`, icon: "fa-solid fa-gear" }, position: { width: 420 }, rejectClose: false,
    content: `<div class="form-group"><label>${regional?"Regional map name":"World name"}</label><input name="name" type="text" value="${esc(def.title)}"></div>
      <div class="form-group"><label>Map width in miles ${q("How far it is from the left edge of the picture to the right. Travel times and the day's distance on the route sheet use it.")}</label><input name="miles" type="number" min="1" step="any" value="${def.miles}"></div>`,
    buttons: [{ action: "save", label: "Save", default: true, callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object }, { action: "cancel", label: "Cancel" }]
  });
  if (!values || typeof values !== "object") return;
  const name = String(values.name ?? "").trim() || def.title, miles = Number(values.miles) > 0 ? Number(values.miles) : def.miles;
  const index = await (await fetch(worldUrl(def.id, "index.json"), { cache: "no-store" })).json();
  const pack = await (await fetch(worldUrl(def.id, "terrain-pack.json"), { cache: "no-store" })).json();
  index.name = name; index.sourceMap.milesPerPixel = miles / index.sourceMap.width; index.sourceMap.bounds.mapWidthMiles = miles; index.mainMap = { bounds: index.sourceMap.bounds };
  pack.sourceMap = index.sourceMap;
  await uploadJson(def.root, "index.json", index);
  await uploadJson(def.root, "terrain-pack.json", pack);
  const next = { ...saved()[def.id], title: name, mapName: name, miles };
  const all = saved(); all[def.id] = next; await game.settings.set(ID, SETTING, all);
  registerWorld(next); forgetWorld(def.id);
  for (const s of game.scenes.filter((s) => s.getFlag(ID, "world") === def.id && s.getFlag(ID, "homebrewOriginal"))) {
    const milesPer100 = (miles / s.width) * 100;
    await s.update({ "grid.distance": Number(milesPer100.toFixed(4)), [`flags.${ID}.milesPer100`]: milesPer100, [`flags.${ID}.bounds`]: index.sourceMap.bounds });
  }
  ui.notifications.info(`KG Realms: ${name} saved.`);
  if (canvas.scene?.getFlag(ID, "world") === def.id) canvas.draw();
}
