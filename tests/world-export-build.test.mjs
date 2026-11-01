import { test } from "node:test";
import assert from "node:assert/strict";
import { registerWorld } from "../scripts/worlds.mjs";
import { buildExport, setExportData, importModuleScenes } from "../scripts/homebrew/export.mjs";

// A whole export against a small game world: Foundry's parts are stand-ins, the zip is real.
const ROOT = "KG Realms Data/World/t";
const tile = { path: "assets/terrain/z0.ktx2.fbx" };
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
  "worlds/game/maps/town.webp": "TOWNMAP"
}));

function install() {
  const scenes = [
    { _id: "town00000000000a", name: "Town", tokens: [{ actorId: "a" }], background: { src: "worlds/game/maps/town.webp" }, lights: [{ x: 1 }],
      notes: [{ _id: "n", entryId: "e", texture: { src: "icons/svg/book.svg" }, flags: { "kg-realms": { local: { name: "Shop", img: "worlds/game/art/shop.webp", actor: "Actor.x" } } } }],
      flags: { "kg-realms": { localMap: { world: "t", placeId: "p1" }, journey: { a: 1 } } } },
    { _id: "other00000000000", name: "Unrelated", tokens: [], notes: [], flags: {} }
  ].map((d) => ({ ...d, toObject: () => structuredClone(d) }));
  const created = [];
  const route = (p) => `/${p}`;
  globalThis.location = { origin: "http://localhost:30000" };
  globalThis.foundry = { utils: { getRoute: route } };
  globalThis.fetch = async (url) => {
    const body = served.get(decodeURIComponent(String(url).replace(/^\//, "")));
    if (body === undefined) return { ok: false, status: 404, json: async () => { throw Error("404"); } };
    return { ok: true, status: 200, json: async () => JSON.parse(body), arrayBuffer: async () => new TextEncoder().encode(body).buffer };
  };
  const settings = new Map();
  globalThis.game = {
    scenes: Object.assign(scenes, { get: (id) => scenes.find((s) => s._id === id) }), modules: { get: () => ({ version: "0.79.0" }) }, user: { name: "GM" }, folders: { find: () => null },
    settings: { get: (m, k) => settings.get(k), set: async (m, k, v) => settings.set(k, v) }
  };
  globalThis.ui = { notifications: { info: () => {}, error: (m) => { throw Error(m); } } };
  globalThis.Folder = { implementation: { create: async (d) => ({ id: "folder", ...d }) } };
  globalThis.Scene = { implementation: { create: async (d, o) => { created.push({ d, o }); return d; } } };
  return { created, settings };
}

setExportData(async () => ({
  places: [{ id: "p1", name: "Arine", edited: true, added: true, original: "x", img: "worlds/game/art/Arine%20Keep.webp", known: `<p><img src="worlds/game/art/inline.png"> gone: <img src="worlds/game/art/lost.png"></p>`, scene: "town00000000000a", marker: "own", actors: ["Actor.y"] }],
  routeEdits: { edited: {}, added: {}, deleted: [] }, waterways: { w1: { kind: "river", pts: [[0, 0]] } }, biomes: { b: 1 }, encounters: { e1: { name: "Bandits" } }, tradeEdits: { p1: { goods: [] } }, snow: { north: { on: true } },
  markers: { own: { name: "Mine", src: "worlds/game/art/mark.webp" }, unused: { name: "No", src: "worlds/game/art/none.webp" } }
}));

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

test("a world's export holds everything, linked up to its new paths", async () => {
  install();
  registerWorld({ id: "t", title: "T", root: ROOT, assetBase: ROOT });
  const built = await buildExport({ id: "t", title: "T", root: ROOT, assetBase: ROOT, rules: { seasons: [] } }, { moduleId: "kg-realms-t", title: "KG Realms: T", version: "1.0.0" });
  const files = await readZip(built.parts), M = "kg-realms-t", D = `${M}/data/worlds/t`;

  // Art moved, each to its folder, with its name.
  assert.equal(files.get(`${M}/assets/poi-img/Arine Keep.webp`), "ARINE");
  assert.equal(files.get(`${M}/assets/poi-img/inline.png`), "INLINE");
  assert.equal(files.get(`${M}/assets/poi-img/shop.webp`), "SHOP");
  assert.equal(files.get(`${M}/assets/poi-img/mark.webp`), "MARK");
  assert.equal(files.get(`${M}/assets/maps/town.webp`), "TOWNMAP");
  assert.equal(files.get(`${M}/assets/terrain/z0.ktx2`), "TILE");
  assert.ok(![...files.keys()].some((f) => f.includes("none.webp")), "an unused marker's art stays out");

  // Links.
  const index = JSON.parse(files.get(`${D}/index.json`)), p = index.places[0];
  assert.equal(p.img, `modules/${M}/assets/poi-img/Arine%20Keep.webp`);
  assert.equal(p.originalImg, "worlds/game/art/Arine%20Keep.webp");
  assert.ok(p.known.includes(`src="modules/${M}/assets/poi-img/inline.png"`));
  assert.ok(p.known.includes(`src="worlds/game/art/lost.png"`), "a file that could not be read keeps its link");
  assert.equal(p.edited, undefined); assert.equal(index.homebrew, undefined);
  assert.equal(p.scene, "town00000000000a");

  // Every JSON.
  assert.equal(JSON.parse(files.get(`${D}/routes.json`)).features.length, 1);
  assert.ok(JSON.parse(files.get(`${D}/waterways.json`)).waterways.w1);
  assert.deepEqual(JSON.parse(files.get(`${D}/biomes.json`)), { b: 1 });
  assert.ok(JSON.parse(files.get(`${D}/encounters.json`)).encounters.e1);
  assert.ok(JSON.parse(files.get(`${D}/trade.json`)).edits.p1);
  assert.equal(files.get(`${D}/local/index.json`), "[]");
  const pack = JSON.parse(files.get(`${D}/terrain-pack.json`));
  assert.equal(pack.lods[0].tiles[0].path, "assets/terrain/z0.ktx2");

  // The scene: this world's only, linked up, without this table's play.
  assert.deepEqual(JSON.parse(files.get(`${D}/scenes/index.json`)).map((s) => s.id), ["town00000000000a"]);
  const scene = JSON.parse(files.get(`${D}/scenes/town00000000000a.json`));
  assert.equal(scene.background.src, `modules/${M}/assets/maps/town.webp`);
  assert.equal(scene.notes[0].flags["kg-realms"].local.img, `modules/${M}/assets/poi-img/shop.webp`);
  assert.equal(scene.notes[0].texture.src, "icons/svg/book.svg");
  assert.deepEqual(scene.tokens, []); assert.equal(scene.lights.length, 1); assert.equal(scene.flags["kg-realms"].journey, undefined);

  // The module, and no old path anywhere but the record of what a picture was and the one that was lost.
  const script = files.get(`${M}/scripts/main.mjs`);
  assert.ok(script.includes(`modules/${M}/assets/poi-img/mark.webp`)); assert.ok(script.includes('"scenes":true')); assert.ok(script.includes('"snow"'));
  assert.equal(JSON.parse(files.get(`${M}/module.json`)).relationships.requires[0].compatibility.minimum, "0.79.0");
  for (const [name, text] of files) if (name.endsWith(".json") && !name.endsWith("index.json")) assert.ok(!text.includes("worlds/game/"), `${name} names an old path`);

  // The report names what did not come, and it is in the zip.
  assert.equal(built.problems, 1);
  for (const part of ["1 scenes", "worlds/game/art/lost.png: HTTP 404", "Actor.x", "Actor.y", "Tokens left out of the scenes: 1"]) assert.ok(built.report.includes(part), part);
  assert.equal(files.get(`${M}/export-report.txt`), built.report);
});

test("a module's scenes come into a game world once, keeping their ids; one the GM has is left alone", async () => {
  const { created, settings } = install();
  registerWorld({ id: "t", title: "T", root: "modules/m/data/worlds/t", scenes: true });
  served.set("modules/m/data/worlds/t/scenes/index.json", JSON.stringify([{ id: "new", name: "New", file: "new.json" }, { id: "town00000000000a", name: "Town", file: "town.json" }]));
  served.set("modules/m/data/worlds/t/scenes/new.json", JSON.stringify({ _id: "new", name: "New" }));
  await importModuleScenes();
  assert.equal(created.length, 1);
  assert.equal(created[0].d._id, "new"); assert.equal(created[0].d.folder, "folder"); assert.equal(created[0].o.keepId, true);
  assert.ok(settings.get("moduleScenesDone").includes("t/new")); assert.ok(settings.get("moduleScenesDone").includes("t/town00000000000a"));
  await importModuleScenes();
  assert.equal(created.length, 1, "deleted or not, it never comes back");
});
