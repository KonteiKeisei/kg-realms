import { test } from "node:test";
import assert from "node:assert/strict";
import { registerWorld } from "../scripts/worlds.mjs";
import { buildExport, setExportData, fillModulePacks, sceneFromModule } from "../scripts/homebrew/export.mjs";

// A whole export against a small game world: Foundry's parts are stand-ins, the zip is real.
const ROOT = "KG Realms Data/World/t";
const tile = { path: "assets/terrain/z0.ktx2.fbx" };
const NPC = "npc0000000000000", PC = "pc00000000000000", BOOK = "book000000000000", SWORD = "sword00000000000", LOST = "lost000000000000", TOWN = "town000000000000", REALM = "realm00000000000";
const served = new Map(Object.entries({
  [`${ROOT}/index.json`]: JSON.stringify({ world: "t", name: "T", homebrew: true, places: [], routes: "routes.json", sourceMap: { width: 10 } }),
  [`${ROOT}/terrain-pack.json`]: JSON.stringify({ lods: [{ tiles: [tile] }], fingerprint: "old" }),
  [`${ROOT}/routes.json`]: JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { id: "r1" }, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } }] }),
  [`${ROOT}/local/index.json`]: "[]",
  [`${ROOT}/${tile.path}`]: "TILE",
  "worlds/game/art/Arine Keep.webp": "ARINE",
  "worlds/game/art/shop.webp": "SHOP",
  "worlds/game/art/inline.png": "INLINE",
  "worlds/game/art/mark.webp": "MARK",
  "worlds/game/maps/town.webp": "TOWNMAP",
  "worlds/game/art/npc.webp": "NPCART",
  "worlds/game/art/book.webp": "BOOKART"
}));
const plain = (d) => ({ ...d, toObject: () => structuredClone(d) });

function install({ packs = new Map() } = {}) {
  const scenes = [
    { _id: TOWN, name: "Town", tokens: [{ actorId: NPC }, { actorId: PC }], background: { src: "worlds/game/maps/town.webp" }, lights: [{ x: 1 }],
      notes: [{ _id: "n", entryId: BOOK, texture: { src: "icons/svg/book.svg" }, flags: { "kg-realms": { local: { name: "Shop", img: "worlds/game/art/shop.webp", actor: `Actor.${NPC}` } } } }],
      flags: { "kg-realms": { localMap: { world: "t", placeId: "p1" }, journey: { a: 1 } } } },
    { _id: "other00000000000", name: "Unrelated", tokens: [], notes: [], flags: {} }
  ].map(plain);
  const world = new Map([
    [`Actor.${NPC}`, plain({ _id: NPC, name: "Innkeep", type: "npc", img: "worlds/game/art/npc.webp", folder: "f", _stats: {}, items: [{ _id: "i", name: "Mug" }], biography: `<p>@UUID[Item.${SWORD}]{Sword} and @UUID[Compendium.dnd5e.spells.Item.${NPC}]{Spell}</p>` })],
    [`JournalEntry.${BOOK}`, plain({ _id: BOOK, name: "Lore", pages: [{ _id: "p", src: "worlds/game/art/book.webp" }] })],
    [`Item.${SWORD}`, plain({ _id: SWORD, name: "Sword", img: "icons/svg/sword.svg" })],
    [`Actor.${PC}`, plain({ _id: PC, name: "Hero", type: "character" })]
  ]);
  const created = [];
  globalThis.location = { origin: "http://localhost:30000" };
  globalThis.foundry = { utils: { getRoute: (p) => `/${p}` } };
  globalThis.fetch = async (url) => {
    const body = served.get(decodeURIComponent(String(url).replace(/^\//, "")));
    if (body === undefined) return { ok: false, status: 404, json: async () => { throw Error("404"); } };
    return { ok: true, status: 200, json: async () => JSON.parse(body), arrayBuffer: async () => new TextEncoder().encode(body).buffer };
  };
  globalThis.fromUuid = async (uuid) => world.get(uuid) ?? null;
  const actors = new Map([[PC, { type: "character", hasPlayerOwner: true }], [NPC, { type: "npc", hasPlayerOwner: false }]]);
  globalThis.game = {
    system: { id: "dnd5e" }, user: { id: "gm", name: "GM" }, modules: { get: () => ({ version: "0.80.0" }) }, actors,
    scenes: Object.assign(scenes, { get: (id) => scenes.find((s) => s._id === id) }), packs: { get: (id) => packs.get(id) }
  };
  const errors = [], infos = [];
  globalThis.ui = { notifications: { info: (m) => infos.push(m), error: (m) => errors.push(m) } };
  globalThis.getDocumentClass = (type) => ({ create: async (d, o) => { created.push({ type, d, o }); return d; }, createDocuments: async (list, o) => { created.push({ type, list, o }); return list; } });
  return { created, errors, infos };
}

const realData = async () => ({
  places: [{ id: "p1", name: "Arine", edited: true, added: true, original: "x", img: "worlds/game/art/Arine%20Keep.webp", known: `<p><img src="worlds/game/art/inline.png"> gone: <img src="worlds/game/art/lost.png"> @UUID[Actor.${LOST}]{Lost}</p>`, scene: TOWN, marker: "own", actors: [`Actor.${NPC}`] }],
  routeEdits: { edited: {}, added: {}, deleted: [] }, waterways: { w1: { kind: "river", pts: [[0, 0]] } }, biomes: { b: 1 }, encounters: { e1: { name: "Bandits" } }, tradeEdits: { p1: { goods: [] } }, snow: { north: { on: true } },
  markers: { own: { name: "Mine", src: "worlds/game/art/mark.webp" }, unused: { name: "No", src: "worlds/game/art/none.webp" } }
});
setExportData(realData);

test('world settings carry carriage audio and native Calendaria weather assets into a standalone export',async()=>{
  install();registerWorld({id:'t',title:'T',root:ROOT,assetBase:ROOT});
  game.settings={settings:new Map([['kg-realms.cityCarriageSound',{}]]),get:()=> 'worlds/game/audio/carriage.ogg'};
  served.set('worlds/game/audio/carriage.ogg','CARRIAGE AUDIO');served.set('worlds/game/audio/storm.ogg','STORM AUDIO');
  const native={version:'1.4.0',settings:{customWeatherPresets:[{name:'Storm',soundFx:'worlds/game/audio/storm.ogg'}],darknessSyncAllScenes:true}};
  const built=await buildExport({id:'t',title:'T',root:ROOT,assetBase:ROOT},{moduleId:'configured-export',title:'T',version:'1',calendariaSettings:native});
  const files=await readZip(built.parts),config=JSON.parse(files.get('configured-export/data/worlds/t/configuration.json'));
  assert.equal(config.engine.cityCarriageSound,'modules/configured-export/assets/audio/carriage.ogg');assert.equal(files.get('configured-export/assets/audio/carriage.ogg'),'CARRIAGE AUDIO');
  assert.equal(config.calendaria.settings.customWeatherPresets[0].soundFx,'modules/configured-export/assets/audio/storm.ogg');assert.equal(files.get('configured-export/assets/audio/storm.ogg'),'STORM AUDIO');assert.equal(config.calendaria.settings.darknessSyncAllScenes,true);
  const registration=JSON.parse(files.get('configured-export/scripts/main.mjs').match(/registerWorld\((.*)\)\);/)[1]);assert.equal(registration.configuration.file,'configuration.json');
  assert.equal(native.settings.customWeatherPresets[0].soundFx,'worlds/game/audio/storm.ogg','the native export payload is not mutated');
  for(const [name,text]of files)served.set(`modules/${name}`,text);
  const source=registerWorld(registration);game.settings={settings:new Map(),get:()=>undefined};
  const again=await buildExport(source,{moduleId:'reconfigured-export',title:'T',version:'2'}),second=await readZip(again.parts),copied=JSON.parse(second.get('reconfigured-export/data/worlds/t/configuration.json'));
  assert.equal(copied.engine.cityCarriageSound,'modules/reconfigured-export/assets/audio/carriage.ogg');assert.equal(copied.calendaria.settings.customWeatherPresets[0].soundFx,'modules/reconfigured-export/assets/audio/storm.ogg');
});

test('import history on linked documents and embedded items does not become an export dependency', async () => {
  install();
  const history='Compendium.world.old-imports.Item.history000000000';
  const actor=await fromUuid(`Actor.${NPC}`), raw=actor.toObject();
  raw._stats={compendiumSource:history,duplicateSource:history};
  raw.items[0]._stats={compendiumSource:history};
  const withHistory={...raw,toObject:()=>structuredClone(raw)}, resolve=fromUuid,requests=[];
  globalThis.fromUuid=async uuid=>{requests.push(uuid);return uuid===`Actor.${NPC}`?withHistory:resolve(uuid);};
  const scene=game.scenes.get(TOWN), sceneRaw=scene.toObject();
  sceneRaw.tokens[0]._stats={compendiumSource:history};
  scene.toObject=()=>structuredClone(sceneRaw);
  registerWorld({id:'t',title:'T',root:ROOT,assetBase:ROOT});
  const built=await buildExport({id:'t',title:'T',root:ROOT,assetBase:ROOT},{moduleId:'exported-history',title:'T',version:'1.0.0',includeCardActors:true});
  assert.equal(requests.includes(history),false,'an unavailable source compendium is not fetched');
  assert.equal(built.problems,2,'genuine missing card image and actor still block export');
  assert.doesNotMatch(built.report,/old-imports/);
  const missing=built.diagnostics.flatMap(world=>world.issues).find(issue=>issue.uuid===`Actor.${LOST}`);
  assert.ok(missing);
  assert.ok(missing.uses.some(use=>use.file==='index.json'&&use.field==='places[0].known'));
  assert.match(built.report,/index.json: places\[0\]\.known/);
  const files=await readZip(built.parts), actors=JSON.parse(files.get('exported-history/data/worlds/t/packs/actors.json'));
  assert.equal(actors[0].items[0].name,'Mug');
  assert.ok(actors[0].biography.includes(`Compendium.exported-history.items.Item.${SWORD}`),'real item content remains included');
  assert.deepEqual(raw._stats,{compendiumSource:history,duplicateSource:history},'live import history is unchanged');
  setExportData(async()=>{const data=await realData();data.places[0].known='<p>Map description.</p>';return data;});
  try {
    const complete=await buildExport({id:'t',title:'T',root:ROOT,assetBase:ROOT},{moduleId:'exported-history',title:'T',version:'1.0.0',includeCardActors:true});
    assert.equal(complete.problems,0,'an otherwise complete world exports despite unavailable historical source compendiums');
  } finally { setExportData(realData); }
});

test('a companion realm exports its terrain grid and compressed local maps without source-module dependencies', async () => {
  install();
  const source='modules/example-companion',root=`${source}/data/worlds/companion-export`;
  const tilePath='assets/terrain/tile.ktx2',catalogue=`${root}/local/town-lods.json`;
  const localTile=`${source}/assets/maps/ktx2/town/z0.ktx2`;
  const map={id:'town',city:'town',placeId:'p1',width:10,height:10,source:`${source}/assets/maps/town.webp`,lodManifest:catalogue};
  const single={id:'yard',city:'yard',placeId:'p2',source:`${source}/assets/maps/yard.webp`,tiles:[{src:`${source}/assets/maps/ktx2/yard/chunk.ktx2`}]};
  const def=registerWorld({id:'companion-export',title:'Example Realm',module:'example-companion',terrainPack:'realm-pack.json',localMapAssets:[map,single]});
  served.set(`${root}/index.json`,JSON.stringify({world:def.id,places:[],routes:'roads.json',terrain:{file:'terrain.png',cell:4}}));
  served.set(`${root}/realm-pack.json`,JSON.stringify({lods:[{tiles:[{path:tilePath}]}]}));
  served.set(`${root}/roads.json`,JSON.stringify({type:'FeatureCollection',features:[]}));
  served.set(`${root}/terrain.png`,'BIOME GRID');
  served.set(`${source}/${tilePath}`,'REALM TILE');
  served.set(catalogue,JSON.stringify({schema:1,id:'town',width:10,height:10,lods:[{tiles:[{src:localTile}]}]}));
  served.set(localTile,'LOCAL TILE');
  served.set(single.tiles[0].src,'SINGLE CHUNK');
  served.set(single.source,'RETAINED ORIGINAL');
  game.scenes.push(plain({_id:'yard000000000000',tokens:[],notes:[],background:{src:single.source},flags:{'kg-realms':{localMap:{world:def.id,placeId:'p2'}}}}));
  const built=await buildExport({id:def.id},{moduleId:'exported-realm',title:'Edited Realm',version:'1.0.0',includeCardActors:true});
  const files=await readZip(built.parts),base='exported-realm/data/worlds/companion-export';
  assert.equal(files.get(`${base}/terrain.png`),'BIOME GRID');
  assert.equal(JSON.parse(files.get(`${base}/index.json`)).terrain.file,'terrain.png');
  assert.equal(files.get(`exported-realm/${tilePath}`),'REALM TILE');
  const world=JSON.parse(files.get('exported-realm/scripts/main.mjs').match(/registerWorld\((.*)\)\);/)[1]);
  const asset=world.localMapAssets[0];
  assert.equal(asset.source,'modules/exported-realm/assets/maps/town-source.webp');
  const local=JSON.parse(files.get(asset.lodManifest.replace(/^modules\//,'')));
  const src=local.lods[0].tiles[0].src;
  assert.match(src,/^modules\/exported-realm\/assets\/maps\/ktx2\/town\//);
  assert.equal(files.get(src.replace(/^modules\//,'')),'LOCAL TILE');
  assert.equal(files.get(world.localMapAssets[1].tiles[0].src.replace(/^modules\//,'')),'SINGLE CHUNK');
  assert.equal(files.get(world.localMapAssets[1].source.replace(/^modules\//,'')),'RETAINED ORIGINAL');
  assert.equal(built.problems,2,'the fixture has one missing card image and one missing linked actor');
  assert.ok(!built.report.includes('terrain.png: HTTP 404'));
  assert.equal(map.source,`${source}/assets/maps/town.webp`,'registered source metadata is unchanged');
  served.delete(`${root}/terrain.png`);
  await assert.rejects(()=>buildExport({id:def.id},{moduleId:'exported-realm',title:'Edited Realm',version:'1.0.0'}),/terrain.png: HTTP 404/);
});

/** A stored zip's files, read back by its central directory: name -> text. */
async function readZip(parts) {
  const b = new Uint8Array(await new Blob(parts).arrayBuffer()), v = new DataView(b.buffer), dec = new TextDecoder();
  let end = b.length - 22; while (v.getUint32(end, true) !== 0x06054b50) end--;
  const count = v.getUint16(end + 10, true), files = new Map();
  let at = v.getUint32(end + 16, true);
  for (let i = 0; i < count; i++) {
    const size = v.getUint32(at + 24, true), nameLen = v.getUint16(at + 28, true), offset = v.getUint32(at + 42, true);
    const name = dec.decode(b.subarray(at + 46, at + 46 + nameLen)), start = offset + 30 + v.getUint16(offset + 26, true);
    files.set(name, dec.decode(b.subarray(start, start + size)));
    at += 46 + nameLen;
  }
  return files;
}

test("a world's export holds everything, linked up to its new paths and compendiums", async () => {
  install();
  registerWorld({ id: "t", title: "T", root: ROOT, assetBase: ROOT });
  const built = await buildExport({ id: "t", title: "T", root: ROOT, assetBase: ROOT, rules: { seasons: [] } }, { moduleId: "kg-realms-t", title: "KG Realms: T", version: "1.0.0",includeCardActors:true,includeTravel:true });
  const files = await readZip(built.parts), M = "kg-realms-t", D = `${M}/data/worlds/t`;
  const pack = (name) => JSON.parse(files.get(`${D}/packs/${name}.json`));

  // Art moved, each to its folder, with its name.
  assert.equal(files.get(`${M}/assets/poi-img/Arine Keep.webp`), "ARINE");
  assert.equal(files.get(`${M}/assets/poi-img/inline.png`), "INLINE");
  assert.equal(files.get(`${M}/assets/poi-img/shop.webp`), "SHOP");
  assert.equal(files.get(`${M}/assets/poi-img/mark.webp`), "MARK");
  assert.equal(files.get(`${M}/assets/maps/town.webp`), "TOWNMAP");
  assert.equal(files.get(`${M}/assets/actors/npc.webp`), "NPCART");
  assert.equal(files.get(`${M}/assets/journals/book.webp`), "BOOKART");
  assert.equal(files.get(`${M}/assets/terrain/z0.ktx2`), "TILE");
  assert.ok(![...files.keys()].some((f) => f.includes("none.webp")), "an unused marker's art stays out");

  // Places link to their art and to the compendiums.
  const index = JSON.parse(files.get(`${D}/index.json`)), p = index.places[0];
  assert.equal(p.img, `modules/${M}/assets/poi-img/Arine%20Keep.webp`);
  assert.equal(p.originalImg, "worlds/game/art/Arine%20Keep.webp");
  assert.ok(p.known.includes(`src="modules/${M}/assets/poi-img/inline.png"`));
  assert.ok(p.known.includes(`src="worlds/game/art/lost.png"`), "a file that could not be read keeps its link");
  assert.ok(p.known.includes(`@UUID[Actor.${LOST}]`), "a link to nothing is left as it was");
  assert.deepEqual(p.actors, [`Compendium.${M}.actors.Actor.${NPC}`]);
  assert.equal(p.edited, undefined); assert.equal(index.homebrew, undefined);
  assert.equal(p.scene, TOWN, "scene links stay ids: the scene keeps its id when it comes in");

  // Every JSON.
  assert.equal(JSON.parse(files.get(`${D}/routes.json`)).features.length, 1);
  assert.ok(JSON.parse(files.get(`${D}/waterways.json`)).waterways.w1);
  assert.deepEqual(JSON.parse(files.get(`${D}/biomes.json`)), { b: 1 });
  assert.ok(JSON.parse(files.get(`${D}/encounters.json`)).encounters.e1);
  assert.ok(JSON.parse(files.get(`${D}/trade.json`)).edits.p1);
  assert.equal(files.get(`${D}/local/index.json`), "[]");
  assert.equal(JSON.parse(files.get(`${D}/terrain-pack.json`)).lods[0].tiles[0].path, "assets/terrain/z0.ktx2");

  // This scene keeps its NPC and the explicitly selected journey, excluding player tokens.
  assert.deepEqual(pack("scenes").map((s) => s._id), [TOWN]);
  const scene = pack("scenes")[0];
  assert.equal(scene.background.src, `modules/${M}/assets/maps/town.webp`);
  assert.equal(scene.notes[0].flags["kg-realms"].local.img, `modules/${M}/assets/poi-img/shop.webp`);
  assert.equal(scene.notes[0].flags["kg-realms"].local.actor, `Compendium.${M}.actors.Actor.${NPC}`);
  assert.equal(scene.notes[0].texture.src, "icons/svg/book.svg");
  assert.deepEqual(scene.tokens, [{ actorId: NPC }]); assert.equal(scene.lights.length, 1); assert.deepEqual(scene.flags["kg-realms"].journey,{a:1});
  assert.deepEqual(scene.flags["kg-realms"].moduleScene, { world: "t", id: TOWN });

  // The documents, and what they link to in turn; the game system's own stay.
  const actor = pack("actors")[0];
  assert.deepEqual(pack("actors").map((a) => a._id), [NPC], "the players' actors stay at this table");
  assert.equal(actor.img, `modules/${M}/assets/actors/npc.webp`); assert.equal(actor.folder, undefined); assert.equal(actor.items.length, 1);
  assert.ok(actor.biography.includes(`@UUID[Compendium.${M}.items.Item.${SWORD}]`));
  assert.ok(actor.biography.includes(`@UUID[Compendium.dnd5e.spells.Item.${NPC}]`));
  assert.deepEqual(pack("items").map((a) => a._id), [SWORD]);
  assert.equal(pack("journals")[0].pages[0].src, `modules/${M}/assets/journals/book.webp`);

  // The module: its compendiums, with their empty folders, and what fills them.
  const manifest = JSON.parse(files.get(`${M}/module.json`));
  assert.equal(manifest.relationships.requires[0].compatibility.minimum, "0.94.0");
  assert.deepEqual(manifest.packs.map((x) => x.name).sort(), ["actors", "items", "journals", "scenes"]);
  assert.equal(manifest.packs.find((x) => x.name === "actors").system, "dnd5e");
  for (const x of manifest.packs) assert.ok(files.has(`${M}/${x.path}/`), `${x.path}'s folder`);
  const script = files.get(`${M}/scripts/main.mjs`);
  assert.ok(script.includes(`modules/${M}/assets/poi-img/mark.webp`)); assert.ok(script.includes('"packs":[')); assert.ok(script.includes('"snow"'));
  assert.ok(script.includes('"file":"packs/actors.json"'));
  for (const [name, text] of files) if (name.endsWith(".json") && !name.endsWith("/index.json")) assert.ok(!text.includes("worlds/game/"), `${name} names an old path`);

  // The report names what did not come, and it is in the zip.
  assert.equal(built.problems, 2);
  for (const part of ["1 scenes", "1 actors", "1 journals", "1 items", "worlds/game/art/lost.png: HTTP 404", `Actor.${LOST}`, "Player tokens left out of the scenes: 1"]) assert.ok(built.report.includes(part), part);
  assert.equal(files.get(`${M}/export-report.txt`), built.report);
});

const fakePack = (name, have = []) => {
  const calls = [];
  return { collection: `m.${name}`, locked: true, calls, getIndex: async () => new Set(have), configure: async (c) => { calls.push(c.locked); }, getDocument: async (id) => plain({ _id: id, name: id, tokens: [], flags: {} }) };
};
const moduleWorld = (id, packs) => { registerWorld({ id, title: id.toUpperCase(), module: id, root: `modules/m/data/worlds/${id}`, packs }); };

test("compendiums fill with only what they are short of, and lock again", async () => {
  const actors = fakePack("actors", ["a1"]), scenes = fakePack("scenes", ["s1"]);
  const { created, infos, errors } = install({ packs: new Map([["fill1.actors", actors], ["fill1.scenes", scenes]]) });
  moduleWorld("fill1", [{ name: "actors", type: "Actor", file: "packs/actors.json" }, { name: "scenes", type: "Scene", file: "packs/scenes.json" }]);
  served.set("modules/m/data/worlds/fill1/packs/actors.json", JSON.stringify([{ _id: "a1" }, { _id: "a2" }]));
  served.set("modules/m/data/worlds/fill1/packs/scenes.json", JSON.stringify([{ _id: "s1" }]));
  await fillModulePacks();
  const made = created.filter((c) => c.list);
  assert.equal(made.length, 1); assert.deepEqual(made[0].list.map((d) => d._id), ["a2"]);
  assert.equal(made[0].o.pack, "m.actors"); assert.equal(made[0].o.keepId, true);
  assert.deepEqual(actors.calls, [false, true], "unlocked, then locked");
  assert.deepEqual(scenes.calls, [], "a full compendium is not touched");
  assert.ok(!errors.some((m) => m.includes("FILL1")), errors.join()); assert.ok(infos.some((m) => m.includes("1 documents")));
});

test("a compendium that cannot be filled says so, and locks again if writing failed", async () => {
  const { errors } = install({ packs: new Map() });
  moduleWorld("fill2", [{ name: "actors", type: "Actor", file: "packs/actors.json" }]);
  await fillModulePacks();
  assert.ok(errors.some((m) => m.includes("actors compendium") && m.includes("try again")), errors.join());

  const actors = fakePack("actors");
  const second = install({ packs: new Map([["fill2.actors", actors]]) });
  served.set("modules/m/data/worlds/fill2/packs/actors.json", JSON.stringify([{ _id: "a1" }]));
  globalThis.getDocumentClass = () => ({ createDocuments: async () => { throw Error("no room"); } });
  await fillModulePacks();
  assert.deepEqual(actors.calls, [false, true]);
  assert.ok(second.errors.some((m) => m.includes("no room")));
});

test('partial Foundry compendium creation counts only actual documents and reports the rejected scene',async()=>{
  const pack=fakePack('scenes'),f=install({packs:new Map([['partialfill.scenes',pack]])});
  moduleWorld('partialfill',[{name:'scenes',type:'Scene',file:'packs/scenes.json'}]);
  served.set('modules/m/data/worlds/partialfill/packs/scenes.json',JSON.stringify([{_id:'good',name:'Good scene'},{_id:'bad',name:'Rejected scene'}]));
  globalThis.getDocumentClass=()=>({createDocuments:async rows=>rows.filter(row=>row._id==='good')});
  await fillModulePacks();
  assert.ok(f.errors.some(message=>/Rejected scene.*did not create/.test(message)));
  assert.ok(f.infos.some(message=>/PARTIALFILL: 1 documents imported/.test(message)));
  assert.ok(!f.infos.some(message=>/PARTIALFILL's maps and documents are ready/.test(message)));assert.deepEqual(pack.calls,[false,true]);
});

test("a scene dragged in takes the id its links know; a realm map brings its settlements and a scene its actors", async () => {
  const scenes = fakePack("scenes"), actors = fakePack("actors");
  const SETTLE = "settle0000000000";
  scenes.getIndex = async () => [{ _id: REALM }, { _id: SETTLE }, { _id: "here000000000000" }];
  const { created } = install({ packs: new Map([["drag.scenes", scenes], ["drag.actors", actors]]) });
  moduleWorld("drag", []);
  game.scenes.push(plain({ _id: "here000000000000", name: "Here", tokens: [], flags: {} }));

  // Given a new id by Foundry: put back under its own.
  const remade = [];
  const dragged = { id: "newid00000000000", name: "Realm", tokens: [], flags: { "kg-realms": { world: "drag", moduleScene: { world: "drag", id: REALM } } }, toObject() { return { name: "Realm" }; }, delete: async () => { dragged.deleted = true; }, constructor: { create: async (d, o) => remade.push({ d, o }) } };
  await sceneFromModule(dragged, {}, "gm");
  assert.equal(dragged.deleted, true); assert.equal(remade[0].d._id, REALM); assert.equal(remade[0].o.keepId, true);
  assert.equal(created.length, 0, "the settlements wait for the scene to arrive under its own id");

  // Under its own id: its settlements come, those already here stay.
  const arrived = { id: REALM, name: "Realm", folder: "fold", tokens: [], flags: { "kg-realms": { world: "drag", moduleScene: { world: "drag", id: REALM } } } };
  game.scenes.push(plain({ _id: REALM, name: "Realm", tokens: [], flags: {} }));
  await sceneFromModule(arrived, {}, "gm");
  game.scenes.pop();
  const scenesMade = created.filter((c) => c.type === "Scene");
  assert.deepEqual(scenesMade.map((c) => c.d._id), [SETTLE]); assert.equal(scenesMade[0].o.keepId, true); assert.equal(scenesMade[0].d.folder, "fold");

  // A settlement brings its tokens' actors, and no other scenes.
  created.length = 0;
  game.scenes.push(plain({ _id: TOWN, name: "Town", tokens: [], flags: {} }));
  const newActor = "newactor00000000";
  await sceneFromModule({ id: TOWN, name: "Town", tokens: [{ actorId: newActor }, { actorId: PC }], flags: { "kg-realms": { localMap: {}, moduleScene: { world: "drag", id: TOWN } } } }, {}, "gm");
  assert.deepEqual(created.map((c) => [c.type, c.d._id]), [["Actor", newActor]], "the actor here already stays");

  // Another GM's import is theirs to handle.
  created.length = 0;
  await sceneFromModule({ id: "x", tokens: [{ actorId: newActor }], flags: { "kg-realms": { moduleScene: { world: "drag", id: "y" } } } }, {}, "someone else");
  assert.equal(created.length, 0);
});

test("the game world's calendar goes in whole, its own pictures with it, and the module sets it", async () => {
  install();
  served.set("worlds/game/art/my-moon.webp", "MOON");
  game.modules.get = (id) => ({ version: "0.81.0", active: id === "calendaria" });
  game.settings = { get: (m, k) => (k === "displayFormats" ? { hud: { gm: "a", player: "b" } } : undefined) };
  const data = { name: "Trorune", metadata: { id: "custom-trorune" }, moons: { m1: { phases: { a: { icon: "worlds/game/art/my-moon.webp" }, b: { icon: "modules/calendaria/assets/moon-phases/01_newmoon.svg" } } } } };
  globalThis.CALENDARIA = { api: { getActiveCalendar: () => ({ toObject: () => data }) }, managers: { CalendarManager: { isCustomCalendar: () => true, hasDefaultOverride: () => false } } };
  const built = await buildExport({ id: "t", title: "T", root: ROOT, assetBase: ROOT }, { moduleId: "kg-realms-t", title: "KG Realms: T", version: "1.0.0" });
  delete globalThis.CALENDARIA;
  const files = await readZip(built.parts), M = "kg-realms-t", D = `${M}/data/worlds/t`;
  const calendar = JSON.parse(files.get(`${D}/calendar.json`));
  assert.equal(calendar.id, "custom-trorune"); assert.equal(calendar.kind, "custom"); assert.ok(calendar.displayFormats.hud);
  assert.equal(calendar.data.moons.m1.phases.a.icon, `modules/${M}/assets/calendar/my-moon.webp`);
  assert.equal(calendar.data.moons.m1.phases.b.icon, "modules/calendaria/assets/moon-phases/01_newmoon.svg");
  assert.equal(files.get(`${M}/assets/calendar/my-moon.webp`), "MOON");
  const world = JSON.parse(files.get(`${M}/scripts/main.mjs`).match(/registerWorld\((.*)\)\);/)[1]);
  assert.equal(world.calendar.file, "calendar.json"); assert.equal(world.calendar.name, "Trorune"); assert.ok(Number.isFinite(world.calendar.signature));
  const manifest = JSON.parse(files.get(`${M}/module.json`));
  assert.equal(manifest.relationships.recommends[0].id, "calendaria");
  assert.ok(built.report.includes("Calendar: Trorune (custom)"));
});

test("a scene reached only by a link is prepared like any other, wildcard art goes in, and nothing else breaks", async () => {
  install();
  const LINKED = "linked0000000000", GUARD = "guard00000000000", VIEW = "view000000000000";
  const scenes = game.scenes;
  const add = (d) => { const doc = plain(d); scenes.push(doc); return doc; };
  add({ _id: LINKED, name: "Crypt", active: true, folder: "f", _stats: {}, tokens: [{ actorId: GUARD }, { actorId: PC }], notes: [{ flags: { "kg-realms": { local: { name: "Door", scene: VIEW } } } }], flags: { "kg-realms": { journey: { a: 1 } } } });
  add({ _id: VIEW, name: "Vault", tokens: [], notes: [], flags: {} });
  const realFrom = globalThis.fromUuid;
  const guard = plain({ _id: GUARD, name: "Guard", type: "npc", img: "worlds/game/tokens/guards/g*.webp", prototypeToken: { texture: { src: "worlds/game/tokens/guards/g*.webp" } } });
  globalThis.fromUuid = async (u) => (u === `Scene.${LINKED}` ? scenes.get(LINKED) : u === `Scene.${VIEW}` ? scenes.get(VIEW) : u === `Actor.${GUARD}` ? guard : realFrom(u));
  game.actors.set(GUARD, { type: "npc", hasPlayerOwner: false });
  served.set("worlds/game/tokens/guards/g1.webp", "G1"); served.set("worlds/game/tokens/guards/g2.webp", "G2");
  const browsed = [];
  foundry.applications = { apps: { FilePicker: { implementation: { browse: async (src, path, o) => { browsed.push([src, path, o.wildcard]); return path.includes("guards") ? { files: ["worlds/game/tokens/guards/g1.webp", "worlds/game/tokens/guards/g2.webp"] } : { files: [] }; } } } } };
  const data = await realData();
  setExportData(async () => ({ ...data, places: [{ ...data.places[0], known: `${data.places[0].known} @UUID[Scene.${LINKED}]{Crypt}` }] }));
  const built = await buildExport({ id: "t", title: "T", root: ROOT, assetBase: ROOT }, { moduleId: "kg-realms-t", title: "KG Realms: T", version: "1.0.0" });
  setExportData(realData);
  const files = await readZip(built.parts), M = "kg-realms-t", D = `${M}/data/worlds/t`;
  const list = JSON.parse(files.get(`${D}/packs/scenes.json`)), crypt = list.find((s) => s._id === LINKED);
  assert.ok(crypt); assert.equal(crypt.active, false); assert.equal(crypt.folder, undefined); assert.equal(crypt._stats, undefined);
  assert.deepEqual(crypt.tokens, [{ actorId: GUARD }], "the players stay"); assert.equal(crypt.flags["kg-realms"].journey, undefined);
  assert.deepEqual(crypt.flags["kg-realms"].moduleScene, { world: "t", id: LINKED });
  assert.ok(list.some((s) => s._id === VIEW), "and the scene its pin leads to");
  const actor = JSON.parse(files.get(`${D}/packs/actors.json`)).find((a) => a._id === GUARD);
  assert.ok(actor, "its token's actor comes too");
  assert.equal(actor.prototypeToken.texture.src, `modules/${M}/assets/actors/guards/g*.webp`);
  assert.equal(files.get(`${M}/assets/actors/guards/g1.webp`), "G1"); assert.equal(files.get(`${M}/assets/actors/guards/g2.webp`), "G2");
  assert.deepEqual(browsed[0], ["data", "worlds/game/tokens/guards/g*.webp", true]);
  assert.ok(built.report.includes("Player tokens left out of the scenes: 2"), built.report);
  assert.ok(!built.report.includes("g*.webp"), "not reported missing");
});
