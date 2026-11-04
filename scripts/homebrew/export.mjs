// Export a made world as a module (0.80): everything the world is, so it works in any game world.
// The map and its tiles; places, roads, rivers, biomes, encounters, trade and snow with every edit
// applied; each scene the world reaches, with its pins, lights, walls and tokens; every actor, journal,
// item and table those link to; and every picture and sound all of that names, copied into the module
// with its links changed. What cannot be carried is listed in the export's report, never dropped quietly.
//
// A browser cannot write Foundry's compendium databases, so the zip holds their documents as JSON and
// empty compendium folders, and KG Realms fills them when a GM first loads the module. Updating a
// module replaces its folder, so a compendium found short is filled again.
import { worldUrl, worldDef, allWorlds } from "../worlds.mjs";
import { applyRouteEdits } from "../routes.mjs";
import { sceneTemplateCatalog } from '../scene-template-plan.mjs';
import {regionalPlace} from '../regional-place.mjs';
import { TILE_SUFFIX, moduleIdFrom, moduleScript, exportWorldDefinition, ROUTES_FILE, zipEntry, zipParts, crc32, zipCanBuild } from "./plan.mjs";
import { fileRef, scanFiles, rewriteFiles, cardFolder, sceneFolder, packFolder, assetNamer, placeForExport, scenesOfWorld, sceneForExport, sceneLinks, wildcardPlace, uuidsIn, uuidParts, rewriteUuids, docForPack, modulePacks, PACK_NAMES, markersUsed, exportReport, calendarForExport, calendarLabel, calendarAction, keepsOwnCalendar, startingDate } from "./export-plan.mjs";

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
const local = (path) => foundry.utils.getRoute(path.split('/').map(part=>{try{part=decodeURIComponent(part);}catch{}return encodeURIComponent(part);}).join('/'));

/** The game world's calendar now, or null without Calendaria. */
function currentCalendar() {
  const C = globalThis.CALENDARIA;
  if (!game.modules.get("calendaria")?.active || !C?.api?.getActiveCalendar) return null;
  let formats = null;
  try { formats = game.settings.get("calendaria", "displayFormats"); } catch { /* an older Calendaria */ }
  return calendarForExport(C.api.getActiveCalendar(), C.managers.CalendarManager, formats, game.time?.worldTime ?? 0);
}

/**
 * The documents reached from `seeds`, and those they link to in turn: { docs: "Type.id" -> plain
 * object, aliases: each link -> "Type.id", gone: links to nothing }. Links into this game system's
 * own compendiums stay as they are.
 */
async function gatherDocuments(seeds, systemId, known = new Map(), scene = null) {
  const docs = new Map(known), aliases = new Map(), gone = [], queue = [...seeds];
  while (queue.length) {
    const uuid = queue.pop();
    if (aliases.has(uuid)) continue;
    const { type, id } = uuidParts(uuid), key = `${type}.${id}`;
    aliases.set(uuid, key);
    if (docs.has(key)) continue;
    const doc = await fromUuid(uuid).catch(() => null);
    if (!doc) { aliases.delete(uuid); gone.push(uuid); continue; }
    const raw = doc.toObject();
    // A scene reached only by a link goes as every other scene does, and brings what it needs.
    const plain = type === "Scene" && scene ? scene.prepare(raw) : raw;
    if (type === "Scene" && scene) queue.push(...scene.links(raw));
    docs.set(key, plain);
    queue.push(...uuidsIn(plain, systemId));
  }
  return { docs, aliases, gone };
}

/** The world as a module: { name, parts, report, problems }. onStep(message, 0 to 1) tells how far along it is. */
export async function buildExport(def, { moduleId, title, version, rootScene }, onStep = () => {}) {
  const records=[],seen=new Set(),links=[],queue=[{def,data:await worldData(def.id)}];
  const sourceScenes=new Map();
  const sceneAvailable=async(id,owner)=>{
    if(game.scenes.get(id))return true;
    for(const source of allWorlds().filter(w=>w.module===owner.module))for(const pack of source.packs??[])if(pack.type==='Scene'){
      const key=`${source.id}/${pack.file}`;
      if(!sourceScenes.has(key)){const response=await fetch(worldUrl(source.id,pack.file),{cache:'no-store'});if(!response.ok)throw Error(`${pack.file}: HTTP ${response.status}`);sourceScenes.set(key,await response.json());}
      if(sourceScenes.get(key).some(s=>s._id===id))return true;
    }
    return false;
  };
  while(queue.length){
    const record=queue.shift();
    if(seen.has(record.def.id))throw Error(`Regional map links contain a cycle or duplicate: ${record.def.id}`);
    seen.add(record.def.id);records.push(record);
    const bundled=allWorlds().flatMap(w=>w.regionalMaps?.links??[]).filter(l=>l.parent===record.def.id);
    const linked=new Map([...bundled,...(record.data.regionalLinks??[])].map(l=>[l.world,l]));
    for(const link of linked.values()){
      const child=worldDef(link.world),scene=child&&await sceneAvailable(link.scene,child),parent=await sceneAvailable(link.parentScene,worldDef(record.def.id)??record.def);
      if(!child||!scene||!parent)throw Error(`Regional map ${link.title??link.world} is missing its registered data or linked scene. Repair it before exporting.`);
      const data=await worldData(child.id),state=allWorlds().map(w=>w.regionalMaps?.state?.[child.id]).find(Boolean);
      if(state&&!Object.keys(data.regionalEdits?.edits??{}).length&&!Object.keys(data.regionalEdits?.added??{}).length)data.regionalEdits=structuredClone(state.placeEdits??{});
      if(data.regionalSnow===undefined&&state?.snow!==undefined)data.regionalSnow=state.snow;
      links.push(structuredClone(link));queue.push({def:child,data});
    }
  }
  const shared={claim:assetNamer(moduleId),written:new Set()},built=[];
  for(const [i,record] of records.entries())built.push(await buildWorldExport(record.def,{moduleId,title,version},(message,pct)=>onStep(`${record.def.title??record.def.id}: ${message}`,(i+pct)/records.length),{...shared,data:record.data,namespace:links.length?record.def.id:null,regional:i>0,rootScene:i?links.find(l=>l.world===record.def.id)?.scene:rootScene,parentScene:links.find(l=>l.world===record.def.id)?.parentScene}));
  for(const link of links){
    const bundle=built.find(b=>b.registration.id===link.world),node=bundle?.registration.sceneTemplates.scenes.find(n=>n.id===link.scene);
    const place=regionalPlace(link,records.find(r=>r.def.id===link.parent)?.data.places??[]);
    if(node&&place&&!node.bindings.some(b=>b.world===link.parent&&b.place===place.id))node.bindings.push({world:link.parent,place:place.id});
  }
  if(!links.length)return built[0];
  const regionalMaps={schema:1,links,state:Object.fromEntries(records.slice(1).map((r,i)=>[r.def.id,{placeEdits:built[i+1].relink(r.data.regionalEdits??{}),snow:r.data.regionalSnow}]))};
  const root=built[0],world={...root.registration,regionalMaps};
  const manifest={...root.manifest,...modulePacks(title,[...new Set(built.flatMap(b=>b.manifest.packs?.map(p=>p.type)??[]))],game.system?.id??'')};
  const replaced=new Set([`${moduleId}/module.json`,`${moduleId}/scripts/main.mjs`,`${moduleId}/export-report.txt`]),entries=new Map();
  for(const bundle of built)for(const entry of bundle.entries)if(!replaced.has(entry.name)){
    if(entries.has(entry.name)&&!entry.name.endsWith('/'))throw Error(`Duplicate file in Regional export: ${entry.name}`);
    entries.set(entry.name,entry);
  }
  const add=(name,bytes)=>{const entry=zipEntry(name,bytes);entry.body=new Blob([bytes]);entries.set(name,entry);};
  const {id:_,title:__,module:___,...options}=world;
  add(`${moduleId}/module.json`,json(manifest));
  add(`${moduleId}/scripts/main.mjs`,encoder.encode(moduleScript(moduleId,{...worldDef(def.id),...def,id:world.id,title:world.title},{...options,additionalWorlds:built.slice(1).map(b=>b.registration)})));
  const report=`Regional maps included: ${records.length-1}\nCoverage, alignment, crossings, local marker edits and Regional snow settings are restored after the linked scenes are imported.\n\n${built.map(b=>b.report).join('\n\n')}`;
  add(`${moduleId}/export-report.txt`,encoder.encode(report));
  const all=[...entries.values()];if(!zipCanBuild(all))throw Error('This realm and its Regional maps exceed the browser archive limits.');
  return {name:root.name,parts:zipParts(all),report,problems:built.reduce((n,b)=>n+b.problems,0)};
}

async function buildWorldExport(def, { moduleId, title, version }, onStep, context = {}) {
  def = { ...worldDef(def.id), ...def };
  const assetBase = def.assetBase ?? `modules/${def.module}`;
  const dir = `${moduleId}/data/worlds/${def.id}`, entries = [], systemId = game.system?.id ?? "";
  const add = async (name, bytes) => {
    const e = zipEntry(name, bytes);
    // Held by the browser, which may keep it on disk, so a large world fits.
    e.body = new Blob([bytes]);
    entries.push(e);
  };
  const get = async (rel) => { const r = await fetch(worldUrl(def.id, rel), { cache: "no-store" }); if (!r.ok) throw Error(`${rel}: HTTP ${r.status}`); return r; };
  const getJson = (rel) => get(rel).then((r) => r.json());
  const optionalJson=async(rel,fallback)=>{const response=await fetch(worldUrl(def.id,rel),{cache:'no-store'});if(response.status===404)return fallback;if(!response.ok)throw Error(`${rel}: HTTP ${response.status}`);return response.json();};

  onStep("Reading the world's data", 0);
  const data = context.data ?? await worldData(def.id);
  const index = await getJson("index.json"), pack = await getJson(def.terrainPack ?? "terrain-pack.json");
  // A companion's biome grid is world-relative data, not card artwork. Keep its path.
  if (index.terrain?.file) {
    const response = await get(index.terrain.file);
    await add(`${dir}/${index.terrain.file}`, new Uint8Array(await response.arrayBuffer()));
  }
  const routesFile = index.routes ?? ROUTES_FILE;
  const places = data.places.map(placeForExport);
  const baseRoutes = index.routes?await getJson(routesFile):await optionalJson(routesFile,{type:'FeatureCollection',features:[]});
  const routes = applyRouteEdits(baseRoutes, data.routeEdits);
  routes.features = routes.features.map((f) => { const { edited, added, ...properties } = f.properties ?? {}; return { ...f, properties }; });
  const trade = await optionalJson("trade.json",{settlements:[],goods:[],signature_goods:[],houses:[],tags:{},matches:{}});
  const presets = await optionalJson("local/index.json",[]);

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
  const calendar = currentCalendar();
  if (calendar) files.set("calendar.json", calendar);

  // The scenes. The players' own tokens stay at this table.
  onStep("Gathering the scenes", 0.02);
  const isPlayers = (token) => { const a = game.actors?.get(token.actorId); return !!a && (a.type === "group" || a.hasPlayerOwner); };
  // Un-generated source templates still belong in a re-export. Local scenes take precedence.
  const sourceScenes=[];
  for(const sourcePack of def.packs??[])if(sourcePack.type==='Scene')sourceScenes.push(...await getJson(sourcePack.file));
  const allScenes=new Map(sourceScenes.map(s=>[s._id,s]));
  for(const s of game.scenes.map(s=>s.toObject()))allScenes.set(s._id,s);
  const { scenes: sceneDocs, missing: scenesMissing } = scenesOfWorld([...allScenes.values()], places, def.id);
  const scenes = sceneDocs.map((s) => sceneForExport(s, s.flags?.[ID]?.world ?? s.flags?.[ID]?.localMap?.world ?? def.id, (t) => !isPlayers(t)));
  let skippedTokens = sceneDocs.reduce((n, s) => n + (s.tokens ?? []).filter(isPlayers).length, 0);
  const markers = markersUsed(data.markers, [places, scenes]);

  // Everything those link to, and what that links to.
  onStep("Gathering actors, journals and items", 0.04);
  const known=new Map(scenes.map(s=>[`Scene.${s._id}`,s]));
  for(const sourcePack of def.packs??[])if(sourcePack.type!=='Scene')for(const raw of await getJson(sourcePack.file)){
    const key=`${sourcePack.type}.${raw._id}`,live=await fromUuid(key).catch(()=>null);
    known.set(key,docForPack(live?.toObject?.()??raw));
  }
  const seeds = uuidsIn([...files.values(), ...known.values()], systemId);
  const keepToken = (t) => !isPlayers(t);
  for (const s of sceneDocs) for (const link of sceneLinks(s, keepToken)) if (!link.startsWith("Scene.") || !scenes.some((x) => `Scene.${x._id}` === link)) seeds.add(link);
  const { docs, aliases, gone } = await gatherDocuments(seeds, systemId, known, {
    prepare: (raw) => { skippedTokens += (raw.tokens ?? []).filter(isPlayers).length; return sceneForExport(raw, def.id, keepToken); },
    links: (raw) => sceneLinks(raw, keepToken)
  });
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
  if (calendar) scanFiles(calendar, () => "assets/calendar", named);
  scanFiles([...files].map(([rel, value]) => rel === "index.json" ? { ...value, terrain: undefined } : value), cardFolder, named);
  scanFiles(markers, cardFolder, named);
  for (const [type, list] of groups) scanFiles(list, type === "Scene" ? sceneFolder : packFolder(type), named);

  const where = { origin: location.origin, prefix: (foundry.utils.getRoute("") ?? "").replace(/^\/+|\/+$/g, "") };
  const claim = context.claim ?? assetNamer(moduleId), paths = new Map(), written = context.written ?? new Set(), missing = [], external = [];
  // Compressed local maps are selected by registry metadata, even with a blank scene background.
  const localMapAssets = structuredClone(def.localMapAssets ?? []);
  const inlineAssets=new Set();
  for(const scene of groups.get('Scene')??[]){
    const assets=[scene.flags?.[ID]?.localMap?.tileAsset,...(scene.tiles??[]).map(t=>t.flags?.[ID]?.tileAsset)].filter(Boolean);
    for(const asset of assets){inlineAssets.add(asset.id);if(!localMapAssets.some(a=>a.id===asset.id))localMapAssets.push(structuredClone(asset));}
  }
  for (const asset of localMapAssets) {
    const catalogue = asset.lodManifest ? await fetch(local(asset.lodManifest)).then(r => {
      if (!r.ok) throw Error(`local map catalogue ${asset.lodManifest}: HTTP ${r.status}`);
      return r.json();
    }) : null;
    const localTiles = catalogue?.lods?.flatMap(l => l.tiles) ?? asset.tiles ?? [];
    for (const tile of localTiles) {
      const response = await fetch(local(tile.src));
      if (!response.ok) throw Error(`local map tile ${tile.src}: HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const placed = claim(`assets/maps/ktx2/${asset.city}`, tile.src.replace(/\.ktx2\.fbx$/i,'.ktx2'), bytes.length, crc32(bytes));
      if (!written.has(placed.rel)) { written.add(placed.rel); await add(`${moduleId}/${placed.rel}`, bytes); }
      paths.set(tile.src, placed.ref); tile.src = placed.ref;
    }
    if (catalogue) {
      // Catalogue tile paths are kept in the city's allowed KTX2 directory.
      const rel = `local/${asset.id}-lods.json`;
      await add(`${dir}/${rel}`, json(catalogue));
      const path = `modules/${dir}/${rel}`;
      paths.set(asset.lodManifest, path); asset.lodManifest = path;
      for (const tile of asset.tiles ?? []) if (paths.has(tile.src)) tile.src = paths.get(tile.src);
    }
    if (asset.source && localTiles.length) {
      if(/^data:/i.test(asset.source)){delete asset.dataRoot;continue;}
      // Some packages retain the original image; others use its name only as renderer identity.
      let ref = `modules/${moduleId}/assets/maps/${context.namespace?`${def.id}-`:''}${asset.id}-source.webp`;
      if (named.has(asset.source)||inlineAssets.has(asset.id)) {
        const response = await fetch(/^(?:https?:|blob:)/i.test(asset.source)?asset.source:local(asset.source)).catch(() => null);
        if(!response?.ok&&inlineAssets.has(asset.id))throw Error(`The source picture for ${asset.id} could not be read. Restore it before exporting.`);
        if (response?.ok) {
          const bytes = new Uint8Array(await response.arrayBuffer());
          const mime=response.headers?.get?.('content-type')??'',extension=/png/i.test(mime)?'png':/jpe?g/i.test(mime)?'jpg':/svg/i.test(mime)?'svg':'webp';
          const sourceName=/\.(?:webp|png|jpe?g|gif|svg|avif)(?:[?#]|$)/i.test(asset.source)?asset.source.split(/[?#]/)[0]:`${asset.id}-source.${extension}`;
          const placed = claim("assets/maps", sourceName, bytes.length, crc32(bytes));
          if (!written.has(placed.rel)) { written.add(placed.rel); await add(`${moduleId}/${placed.rel}`, bytes); }
          ref = placed.ref;
        }
      }
      paths.set(asset.source, ref); named.delete(asset.source); asset.source = ref;
    }
    delete asset.dataRoot;
  }
  for(const scene of groups.get('Scene')??[]){for(const asset of [scene.flags?.[ID]?.localMap?.tileAsset,...(scene.tiles??[]).map(t=>t.flags?.[ID]?.tileAsset)].filter(Boolean))delete asset.dataRoot;}
  let done = 0;
  for (const [raw, folder] of named) {
    onStep(`Copying pictures (${++done} / ${named.size})`, 0.05 + 0.4 * (done / named.size));
    const ref = fileRef(raw, where);
    if (!ref || ref.kind === "keep") continue;
    try {
      if (ref.kind === "local" && ref.path.includes("*")) {
        const FP = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
        const found = (await FP.browse("data", ref.path, { wildcard: true }))?.files ?? [];
        if (!found.length) throw Error("no files match it");
        const { dir: into, link } = wildcardPlace(moduleId, folder, ref.path);
        for (const file of found) {
          const decoded = decodeURIComponent(file), res = await fetch(local(decoded));
          if (!res.ok) throw Error(`${decoded}: HTTP ${res.status}`);
          const bytes = new Uint8Array(await res.arrayBuffer()), placed = claim(into, decoded, bytes.length, crc32(bytes));
          if (!written.has(placed.rel)) { written.add(placed.rel); await add(`${moduleId}/${placed.rel}`, bytes); }
        }
        paths.set(raw, link);
        continue;
      }
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
    const res = await fetch(local(`${assetBase}/${tile.path}`));
    if (!res.ok) throw Error(`the map tile ${tile.path} could not be read (HTTP ${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    tile.path = context.namespace ? `assets/terrain/v0-export-${context.namespace}/${tile.path.split('/').pop().replace(TILE_SUFFIX,'.ktx2')}` : tile.path.replace(TILE_SUFFIX, ".ktx2");
    await add(`${moduleId}/${tile.path}`, bytes);
  }
  pack.fingerprint = await sha256(encoder.encode(JSON.stringify(pack.lods)));
  await add(`${dir}/terrain-pack.json`, json(pack));

  // The module.
  const kg = game.modules.get(ID);
  const minimum=kg?.version&&(Number(kg.version.split('.')[0])>0||Number(kg.version.split('.')[1])>=94)?kg.version:'0.94.0';
  const manifest={ id: moduleId, title, description: `${def.title}, a world for KG Realms.`, version, authors: [{ name: game.user.name }], compatibility: { minimum: "13", verified: String(game.release?.generation??13), maximum:'14' }, relationships: { requires: [{ id: ID, type: "module", compatibility: { minimum } }], ...(calendar ? { recommends: [{ id: "calendaria", type: "module", reason: `Sets this world's calendar: ${calendar.name}.` }] } : {}) }, esmodules: ["scripts/main.mjs"], ...modulePacks(title, [...groups.keys()], systemId) };
  const sceneTemplates=sceneTemplateCatalog(def.id,groups.get('Scene')??[],places,{...context,presets});
  const options={snow:data.snow,markers:finalMarkers,rules:def.rules,packs:packList,localMapAssets:localMapAssets.filter(a=>!a.tileId),sceneTemplates,calendar:calendar?{file:'calendar.json',name:calendar.name,signature:crc32(json(calendar.data))}:null};
  const registration=exportWorldDefinition(moduleId,def,options);
  await add(`${moduleId}/module.json`, encoder.encode(JSON.stringify(manifest, null, 2)));
  await add(`${moduleId}/scripts/main.mjs`, encoder.encode(moduleScript(moduleId, def, options)));

  const report = exportReport({
    title, version, moduleId, calendar, skippedTokens, scenesMissing, gone, missing, external,
    counts: { "places": places.length, "roads": routes.features.length, "rivers and shores": Object.keys(data.waterways).length, "encounters": Object.keys(data.encounters).length, "scenes": counts.scenes, "actors": counts.actors, "journals": counts.journals, "items": counts.items, "tables": counts.tables, "macros": counts.macros, "playlists": counts.playlists, "card decks": counts.cards, "pictures and sounds": written.size, "custom markers": Object.keys(markers).length, "map tiles": tiles.length }
  });
  await add(`${moduleId}/export-report.txt`, encoder.encode(report));
  if (!zipCanBuild(entries)) throw Error('This realm exceeds the browser archive limits.');
  onStep("Building the zip", 0.97);
  return { name: `${moduleId} v${version}.zip`, parts: zipParts(entries), report, problems: missing.length + external.length + scenesMissing.length + gone.length,entries,manifest,registration,relink };
}

let regionalRestore=Promise.resolve();
/** Adopt exported links once their scenes exist; never replace this game's existing links or edits. */
export function restoreModuleRegionalMaps(){
  const work=regionalRestore.catch(()=>{}).then(async()=>{
    if(game.user!==game.users?.activeGM||!game.settings?.get||!game.settings?.set)return;
    const links=structuredClone(game.settings.get(ID,'regionalMaps')??{}),edits=structuredClone(game.settings.get(ID,'placeEdits')??{}),snow=structuredClone(game.settings.get(ID,'regionalSnow')??{});
    let changed=false,changedEdits=false,changedSnow=false;
    for(const world of allWorlds()){
      const bundle=world.regionalMaps;if(bundle?.schema!==1)continue;
      for(const link of bundle.links??[]){
        if(links[link.world])continue;
        const child=game.scenes.get(link.scene),parent=game.scenes.get(link.parentScene);
        if(child?.getFlag?.(ID,'world')!==link.world||parent?.getFlag?.(ID,'world')!==link.parent)continue;
        links[link.world]=structuredClone(link);changed=true;
        const state=bundle.state?.[link.world];
        if(state?.placeEdits&&!Object.keys(edits[link.world]?.edits??{}).length&&!Object.keys(edits[link.world]?.added??{}).length){edits[link.world]=structuredClone(state.placeEdits);changedEdits=true;}
        if(state?.snow!==undefined&&!Object.hasOwn(snow,link.world)){snow[link.world]=state.snow;changedSnow=true;}
      }
    }
    if(changedEdits)await game.settings.set(ID,'placeEdits',edits);
    if(changedSnow)await game.settings.set(ID,'regionalSnow',snow);
    if(changed)await game.settings.set(ID,'regionalMaps',links);
  });
  regionalRestore=work;return work;
}

export async function exportModule(def, rootScene) {
  if (!def) return;
  const here = currentCalendar();
  const values = await foundry.applications.api.DialogV2.wait({
    window: { title: "Export as module", icon: "fa-solid fa-file-export" }, position: { width: 460 }, rejectClose: false,
    content: `<div class="form-group"><label>Module title</label><input name="title" type="text" value="KG Realms: ${esc(def.title)}"></div>
      <div class="form-group"><label>Module id ${q("The folder name in Data/modules: lowercase letters, digits and dashes.")}</label><input name="id" type="text" value="${esc(moduleIdFrom(def.title))}" pattern="[a-z0-9-]+"></div>
      <div class="form-group"><label>Version</label><input name="version" type="text" value="1.0.0"></div>
      <p class="notes">The zip holds the whole world: its map, places, roads, rivers, biomes, encounters, trade and snow with every edit, each linked Regional map and its placement, each scene it links to, every actor, journal and item those link to, and all their pictures, moved into the module and linked up. ${q("Pictures on cards and markers go to assets/poi-img, scene maps to assets/maps, and actor, journal and item art to their own folders. Links into your game system's own compendiums stay as they are. Your players' tokens stay out of the scenes.")}</p>
      <p class="notes">Calendar: ${esc(here ? calendarLabel(here) : "none, Calendaria is not active")}. ${q("The calendar this game world uses now, complete, whether built in, edited or your own, and today's in-game date. When a GM first loads the module, the calendar is added if need be and set as active. The date is used only where the clock has not started. A campaign already running on another calendar keeps its own.")}</p>
      <p class="notes">Afterwards you get a report of anything that could not be carried. It is also in the zip, as export-report.txt.</p>
      <p class="notes">After enabling the module, choose maps from its hierarchy checklist. Generate the realm and any Regional or local maps now, or generate a linked map from its place card later. ${q("Complete scene snapshots keep their map tiles, walls, lights, pins, roads and linked documents. Existing generated scenes keep their edits.")}</p>`,
    buttons: [{ action: "go", label: "Download zip", icon: "fa-solid fa-download", default: true, callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object }, { action: "cancel", label: "Cancel" }]
  });
  if (!values || typeof values !== "object") return;
  const moduleId = /^[a-z0-9-]+$/.test(values.id ?? "") ? values.id : moduleIdFrom(def.title), title = String(values.title || `KG Realms: ${def.title}`), version = String(values.version || "1.0.0");
  const note = ui.notifications.info(`KG Realms: building ${title}...`, { permanent: true, progress: true });
  try {
    const built = await buildExport(def, { moduleId, title, version, rootScene }, (message, pct) => note?.update?.({ message: `KG Realms: ${message}`, pct }));
    if(built.problems){
      await foundry.applications.api.DialogV2.prompt({window:{title:'Export needs repair'},position:{width:620},content:`<p>The module was not downloaded. Fix the missing files or document links listed below, then export again.</p><pre class="kgr-export-problems">${esc(built.report)}</pre>`,ok:{label:'Close'},rejectClose:false});
      return;
    }
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
    if (added) ui.notifications.info(`KG Realms: ${world.title}'s maps and documents are ready (${added} documents). Use Generate in the Scenes sidebar to choose maps.`, { permanent: true });
  }
}

/**
 * Each world module's calendar, set by the first GM to load it, and again only if a new version of
 * the module brings a different one, so a GM who changes calendar afterwards keeps their choice.
 * Runs once Calendaria is ready. Foundry reloads to finish, as Calendaria's own switch asks.
 */
export async function applyModuleCalendars() {
  if (game.user !== game.users.activeGM) return;
  const applied = foundry.utils.deepClone(game.settings.get(ID, "calendarsApplied") ?? {});
  const C = globalThis.CALENDARIA, ready = !!game.modules.get("calendaria")?.active && !!C?.managers?.CalendarManager;
  let changed = false, needReload = false;
  for (const world of allWorlds().filter((w) => w.calendar)) {
    const want = world.calendar, signature = String(want.signature ?? want.id);
    if (applied[world.id] === signature) continue;
    if (!ready) {
      if (applied[world.id] === `missing:${signature}`) continue;
      ui.notifications.warn(`KG Realms: ${world.title} uses the calendar ${want.name ?? want.id}. Enable Calendaria and it will be set.`, { permanent: true });
      applied[world.id] = `missing:${signature}`; changed = true;
      continue;
    }
    try {
      let calendar = { kind: "built-in", ...want };
      if (want.file) {
        const res = await fetch(worldUrl(world.id, want.file), { cache: "no-store" });
        if (!res.ok) throw Error(`${want.file}: HTTP ${res.status}`);
        calendar = await res.json();
      }
      const M = C.managers.CalendarManager, id = calendar.id, worldTime = game.time?.worldTime ?? 0, activeId = M.getActiveCalendar?.()?.metadata?.id;
      if (keepsOwnCalendar(activeId, id, worldTime)) {
        ui.notifications.info(`KG Realms: ${world.title} uses the calendar ${calendar.name ?? id}. This game world's campaign is already running on another, so it is left as it is. Calendaria's settings can change it.`, { permanent: true });
        applied[world.id] = signature; changed = true;
        continue;
      }
      const action = calendarAction(calendar, { known: !!M.getCalendar(id), custom: M.isCustomCalendar(id), override: M.hasDefaultOverride(id) });
      let target = id;
      if (action === "unknown") throw Error(`this copy of Calendaria has no calendar "${id}"`);
      if (action === "create") { const made = await M.createCustomCalendar(id, foundry.utils.deepClone(calendar.data)); if (!made) throw Error("Calendaria could not add it"); target = made.metadata?.id ?? (id.startsWith("custom-") ? id : `custom-${id}`); }
      if (action === "update" && !await M.updateCustomCalendar(id, foundry.utils.deepClone(calendar.data))) throw Error("Calendaria could not update it");
      if (action === "override" && !await M.saveDefaultOverride(id, foundry.utils.deepClone(calendar.data))) throw Error("Calendaria could not save it");
      // Already there, as it should be: nothing to change, and nothing to reload for.
      const moved = action !== "switch" || activeId !== target;
      if (moved && !await C.api.switchCalendar(target)) throw Error("Calendaria could not switch to it");
      if (moved && calendar.displayFormats) await game.settings.set("calendaria", "displayFormats", calendar.displayFormats);
      if (moved) needReload = true;
      const date = startingDate(calendar, worldTime);
      if (date?.worldTime) await game.time.set(date.worldTime);
      if (date?.year != null) {
        await C.api.jumpToDate({ year: date.year, month: 1, day: 1 });
        const year = (game.time?.components?.year ?? NaN) + (M.getActiveCalendar?.()?.years?.yearZero ?? 0);
        if (year !== date.year) ui.notifications.warn(`KG Realms: ${world.title} should start in year ${date.year}, but Calendaria shows ${year}. Set the date in Calendaria.`, { permanent: true });
      }
      applied[world.id] = signature; changed = true;
      if (moved || date) ui.notifications.info(`KG Realms: the calendar is now ${calendar.name ?? id}${date?.year != null ? `, year ${date.year}` : date ? ", at the date it was exported" : ""}, for ${world.title}. You can change it in Calendaria's settings; this will not set it again.`, { permanent: true });
    } catch (err) {
      console.error(`${ID} | calendar of ${world.id}`, err);
      ui.notifications.error(`KG Realms: could not set the calendar of ${world.title}: ${err?.message ?? err}. It will try again next load.`, { permanent: true });
    }
  }
  if (changed) await game.settings.set(ID, "calendarsApplied", applied);
  if (needReload) await foundry.applications.settings?.SettingsConfig?.reloadConfirm?.({ world: true });
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
  if(scene.pack||options?.pack)return;
  const from = scene.flags?.[ID]?.moduleScene;
  if (!from) return;
  if (userId !== game.user.id) return restoreModuleRegionalMaps();
  try {
    if (scene.id !== from.id && !game.scenes.get(from.id)) {
      const data = { ...scene.toObject(), _id: from.id };
      await scene.delete();
      await scene.constructor.create(data, { keepId: true });
      return;
    }
    const world = allWorlds().find((w) => w.id === from.world);
    if (!world) return;
    if(world.sceneTemplates?.schema===1){
      const {prepareSceneDocuments,openSceneChecklist}=await import('../module-scenes.mjs');
      await prepareSceneDocuments(world,scene.toObject?.()??scene);await restoreModuleRegionalMaps();
      if(!options?.kgRealmsSceneSetup&&scene.flags[ID].world)await openSceneChecklist(world);
      return;
    }
    for (const t of scene.tokens ?? []) if (t.actorId) await bringIn(world, "Actor", t.actorId, game.actors);
    if(options?.kgRealmsSceneSetup)return restoreModuleRegionalMaps();
    if (!scene.flags[ID].world) return;
    const pack = game.packs.get(`${world.module}.scenes`), index = await pack?.getIndex();
    for (const entry of index ?? []) if (entry._id !== from.id) await bringIn(world, "Scene", entry._id, game.scenes, scene.folder?.id ?? scene.folder ?? null);
    await restoreModuleRegionalMaps();
  } catch (err) {
    console.error(`${ID} | bringing in ${scene.name}`, err);
    ui.notifications.error(`KG Realms: could not bring in everything for ${scene.name}: ${err?.message ?? err}`, { permanent: true });
  }
}
