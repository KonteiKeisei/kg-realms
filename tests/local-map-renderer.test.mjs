import "./helpers/worlds.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {LOCAL_MAP_ASSETS} from "../../kg-realms-faerun/scripts/local-map-assets.mjs";
import {mapAsset, resolveMapAsset, chunkPlacement, filterLocalSource, filterLocalPreload, createLocalMapManager} from "../scripts/local-map-renderer.mjs";

class Rectangle { constructor(x, y, width, height) {Object.assign(this, {x, y, width, height});} }
class Texture {
  constructor(base, frame) {
    this.baseTexture = base;
    this.width = frame?.width ?? base.width;
    this.height = frame?.height ?? base.height;
    this.frame = frame;
    this.valid = true;
  }
  destroy(base) {assert.equal(base, false); this.baseTexture = null;}
}
Texture.EMPTY = new Texture({width: 1, height: 1, valid: true});
class Mesh {
  constructor({texture, name, object}) {
    Object.assign(this, {texture, name, object, destroyed: false});
    this.position = {set: (x, y) => {this.x = x; this.y = y;}};
    this.anchor = {set() {}};
  }
  destroy() {this.destroyed = true; this.texture = null;}
}

function fixture(id = "neverwinter", {enabled = true, loader, resolve, max = 4096} = {}) {
  const asset = LOCAL_MAP_ASSETS.find(a => a.id === id), sources = [], pins = [], unpins = [], reports = [];
  const scene = {id: "arbitrary-id", background: {src: asset.source}, flags: {"kg-realms": {localMap: {placeId: asset.placeId}}}};
  const primary = {children: [], background: {transform: {}, visible: false, elevation: 0, sortLayer: 0, zIndex: -Infinity, alpha: 1, tint: 0xffffff},
    addChild(mesh) {this.children.push(mesh); mesh.parent = this;}, removeChild(mesh) {this.children.splice(this.children.indexOf(mesh), 1); mesh.parent = null;}};
  const canvas = {scene, primary, sceneTextures: {}, loadTexturesOptions: {additionalSources: []},
    dimensions: {sceneX: 1300, sceneY: 1300, sceneWidth: 5200, sceneHeight: 5200},
    app: {renderer: {gl: {MAX_TEXTURE_SIZE: 3379, getParameter: () => max}}}};
  class SceneManager {constructor(scene) {this.scene = scene;}}
  const Manager = createLocalMapManager({SceneManager, canvas, PIXI: {Texture, Rectangle}, Mesh,
    enabled: () => enabled, ...(resolve ? {resolve} : {}), loadTexture: async src => {
      sources.push(src);
      if (loader) return loader(src);
      const tile = LOCAL_MAP_ASSETS.flatMap(a => a.tiles).find(t => t.src === src);
      return new Texture({width: tile.textureWidth, height: tile.textureHeight, valid: true, resource: {_levelBuffers: [{levelBuffer: new Uint8Array(8)}]}});
    }, pin: src => pins.push(src), unpin: src => unpins.push(src), report: r => reports.push(r)});
  return {asset, scene, canvas, primary, sources, pins, unpins, reports, manager: new Manager(scene)};
}

test("catalogue retains the five baseline maps and adds a separate Waterdeep LOD catalogue", () => {
  assert.equal(LOCAL_MAP_ASSETS.length, 6);
  assert.equal(LOCAL_MAP_ASSETS.reduce((n, a) => n + a.tiles.length, 0), 16);
  for (const asset of LOCAL_MAP_ASSETS) {
    if(asset.lodManifest){assert.equal(asset.id,'waterdeep');continue;}
    assert.equal(asset.tiles.reduce((n, t) => n + t.width * t.height, 0), asset.width * asset.height);
    for (const tile of asset.tiles) {
      assert.ok(tile.textureWidth <= 4096 && tile.textureHeight <= 4096);
      assert.equal(tile.textureWidth % 4, 0);
      assert.equal(tile.textureHeight % 4, 0);
      assert.ok(tile.frameX + tile.width <= tile.textureWidth);
      assert.ok(tile.frameY + tile.height <= tile.textureHeight);
      const bytes = readFileSync(new URL(`../${tile.src.replace(/^modules\/kg-realms(-faerun)?\//, "")}`, import.meta.url));
      assert.equal(bytes.readUInt32LE(20), tile.textureWidth);
      assert.equal(bytes.readUInt32LE(24), tile.textureHeight);
      assert.equal(bytes.readUInt32LE(40), 1);
    }
  }
});

test("seasonal paths select the right artwork and custom maps stay native", () => {
  const summer = fixture("luskan-summer").scene;
  assert.equal(mapAsset(summer).id, "luskan-summer");
  summer.background.src = LOCAL_MAP_ASSETS.find(a => a.id === "luskan-winter").source;
  assert.equal(mapAsset(summer).id, "luskan-winter");
  summer.background.src = "worlds/private/my-luskan.webp";
  assert.equal(mapAsset(summer), null);
  summer.background.src = "";
  assert.equal(mapAsset(summer).id, "luskan-summer");
  summer.flags["kg-realms"].localMap.world = "another-world";
  assert.equal(mapAsset(summer), null);
});

test("single-level backgrounds are resolved without reading deprecated scene fields", () => {
  const asset = LOCAL_MAP_ASSETS[0];
  const scene = {levels: {contents: [{background: {src: asset.source}}]}};
  Object.defineProperty(scene, "background", {get() {throw Error("Deprecated");}});
  assert.equal(mapAsset(scene).id, asset.id);
});

test("ready draws cropped chunks using scene padding and scale, without moving documents", async () => {
  const f = fixture();
  const original = JSON.stringify(f.scene);
  await f.manager._onInit();
  assert.equal(f.canvas.loadTexturesOptions.additionalSources.length, 6);
  await f.manager._onDraw();
  assert.equal(f.primary.children.length, 0, "no access to stale primary objects before drawing");
  assert.equal(f.canvas.sceneTextures.background, Texture.EMPTY);
  await f.manager._onReady();
  assert.equal(f.primary.children.length, 6);
  assert.equal(f.reports.at(-1).state, "ktx2");
  assert.ok(f.sources.every(s => s.endsWith(".ktx2")));
  for (const [i, mesh] of f.primary.children.entries()) {
    const tile = f.asset.tiles[i], at = chunkPlacement(tile, f.asset, f.canvas.dimensions);
    assert.deepEqual({x: mesh.x, y: mesh.y, width: mesh.width, height: mesh.height}, at);
    assert.equal(mesh.texture.frame.x, 2);
    assert.equal(mesh.texture.frame.y, 2);
    assert.equal(mesh.texture.width, tile.width);
    assert.equal(mesh.sortLayer, 0);
    assert.equal(mesh.zIndex, -Infinity);
  }
  assert.equal(JSON.stringify(f.scene), original);
});

test("non-block-aligned artwork keeps its exact native crop and displayed size", async () => {
  const f = fixture("helms-hold-winter");
  await f.manager._onInit(); await f.manager._onDraw(); await f.manager._onReady();
  const mesh = f.primary.children[0];
  assert.equal(mesh.texture.width, 3423);
  assert.equal(mesh.texture.baseTexture.width, 3428);
  assert.equal(mesh.width, 5200);
  assert.equal(mesh.height, 5200);
});

test("WebP mode does not preload or suppress anything", async () => {
  const f = fixture("neverwinter", {enabled: false});
  await f.manager._onInit(); await f.manager._onDraw(); await f.manager._onReady();
  assert.deepEqual(f.sources, []);
  assert.deepEqual(f.pins, []);
  assert.equal(f.canvas.sceneTextures.background, undefined);
});

test("failed chunk stays blank without requesting the source WebP", async () => {
  const f = fixture("neverwinter", {loader: () => {throw Error("HTTP 404");}});
  await f.manager._onInit(); await f.manager._onDraw(); await f.manager._onReady();
  assert.equal(f.primary.children.length, 0);
  assert.equal(f.reports.at(-1).state, "failed");
  assert.equal(f.canvas.sceneTextures.background, Texture.EMPTY);
  assert.ok(f.sources.every(s => s.endsWith(".ktx2")));
});

test("teardown releases frames and pins, including meshes already destroyed by Foundry", async () => {
  const f = fixture();
  await f.manager._onInit(); await f.manager._onDraw(); await f.manager._onReady();
  const frame = f.primary.children[0].texture, base = frame.baseTexture;
  f.primary.children[0].destroy();
  await f.manager._onTearDown();
  assert.equal(frame.baseTexture, null);
  assert.equal(base.valid, true);
  assert.deepEqual(f.unpins, f.pins);
});

test("late texture loads cannot populate a departed scene", async () => {
  const resolves = [];
  const f = fixture("helms-hold-summer", {loader: () => new Promise(r => resolves.push(r))});
  await f.manager._onInit();
  const pending = f.manager._onDraw();
  await f.manager._onTearDown();
  resolves[0](new Texture({width: 3428, height: 3428, valid: true}));
  await pending;
  await f.manager._onReady();
  assert.equal(f.primary.children.length, 0);
  assert.deepEqual(f.unpins, f.pins);
});

test("source filter preserves the loader receiver and unrelated requests", async () => {
  const calls = [], loader = {async loadTexture(src, arg) {calls.push({self: this, src, arg}); return src;}};
  const original = loader.loadTexture;
  const restore = filterLocalSource(loader, src => src === "source.webp");
  assert.equal(await loader.loadTexture("source.webp"), null);
  assert.equal(await loader.loadTexture("other.webp", 4), "other.webp");
  assert.equal(calls[0].self, loader);
  assert.equal(calls[0].arg, 4);
  restore();
  assert.equal(loader.loadTexture, original);
});

test("preloading a non-viewed city loads its chunks without changing the scene", async () => {
  const f = fixture("luskan-winter");
  const original = JSON.stringify(f.scene), calls = [];
  const Loader = {async loadSceneTextures(scene, opts) {calls.push({scene, opts, self: this}); return "done";}};
  const restore = filterLocalPreload(Loader, mapAsset);
  assert.equal(await Loader.loadSceneTextures(f.scene, {additionalSources: ["token.webp"], expireCache: false}), "done");
  assert.equal(calls[0].scene.background.src, null);
  assert.equal(calls[0].opts.additionalSources.length, 5);
  assert.equal(calls[0].opts.expireCache, false);
  assert.equal(calls[0].self, Loader);
  assert.equal(JSON.stringify(f.scene), original);
  restore();
});

test("preloading unrelated maps uses the original scene without a facade", async () => {
  let received;
  const Loader = {async loadSceneTextures(scene) {received = scene;}};
  filterLocalPreload(Loader, mapAsset);
  const scene = {background: {src: "worlds/custom.webp"}};
  await Loader.loadSceneTextures(scene);
  assert.equal(received, scene);
});

test("custom multi-level maps are not claimed by the baseline renderer", () => {
  const f = fixture();
  f.scene.levels = {size: 2, contents: []};
  assert.equal(mapAsset(f.scene), null);
});

test("explicit WebP selection also works when the background field is empty", async () => {
  const asset = LOCAL_MAP_ASSETS.find(a => a.id === "neverwinter");
  const f = fixture("neverwinter", {enabled: false,
    loader: () => new Texture({width: asset.width, height: asset.height, valid: true})});
  f.scene.background.src = "";
  await f.manager._onInit(); await f.manager._onDraw(); await f.manager._onReady();
  assert.deepEqual(f.sources, [asset.source]);
  assert.equal(f.reports.at(-1).state, "webp");
  assert.deepEqual(f.pins, []);
  assert.equal(f.primary.background.width, 5200);
});

test("the user's blank Luskan scene resolves the winter asset from seasonal rules", async () => {
  const winter = LOCAL_MAP_ASSETS.find(a => a.id === "luskan-winter");
  const scene = {id: "YSdOI7jJVp7sHwIU", background: {src: null}, flags: {"kg-realms": {localMap: {
    placeId: winter.placeId, seasons: {summer: "modules/kg-realms/assets/maps/luskan-summer.webp", winter: winter.source}
  }}}};
  assert.equal((await resolveMapAsset(scene, async () => winter.source)).id, "luskan-winter");
  assert.equal((await resolveMapAsset(scene, async () => scene.flags["kg-realms"].localMap.seasons.summer)).id, "luskan-summer");
  assert.equal(scene.background.src, null);
});

test("asynchronous seasonal preloads request only the selected season", async () => {
  const f = fixture("luskan-summer");
  f.scene.background.src = null;
  const winter = LOCAL_MAP_ASSETS.find(a => a.id === "luskan-winter");
  let sources;
  const Loader = {async loadSceneTextures(scene, opts) {sources = opts.additionalSources;}};
  filterLocalPreload(Loader, scene => resolveMapAsset(scene, async () => winter.source));
  await Loader.loadSceneTextures(f.scene);
  assert.equal(sources.length, 4);
  assert.ok(sources.every(src => src.includes("luskan-winter-")));
  assert.equal(f.scene.background.src, null);
});

test("season resolution leaves custom maps alone and rejects another city's asset", async () => {
  const f = fixture("luskan-summer");
  const hold = LOCAL_MAP_ASSETS.find(a => a.city === "helms-hold");
  assert.equal((await resolveMapAsset(f.scene, async () => hold.source)).id, "luskan-summer");
  f.scene.background.src = "worlds/custom/map.webp";
  assert.equal(await resolveMapAsset(f.scene, async () => hold.source), null);
});

test("blank seasonal scenes draw only winter KTX2 chunks when winter is selected", async () => {
  const winter = LOCAL_MAP_ASSETS.find(a => a.id === "luskan-winter");
  const f = fixture("luskan-summer", {resolve: scene => resolveMapAsset(scene, async () => winter.source)});
  f.scene.background.src = null;
  await f.manager._onInit(); await f.manager._onDraw(); await f.manager._onReady();
  assert.equal(f.reports.at(-1).asset, "luskan-winter");
  assert.ok(f.sources.every(src => src.includes("luskan-winter-")));
  assert.equal(f.scene.background.src, null);
});

test("a departed scene cannot acquire pins after a slow seasonal lookup", async () => {
  let resolve;
  const f = fixture("luskan-summer", {resolve: () => new Promise(r => {resolve = r;})});
  const init = f.manager._onInit();
  await f.manager._onTearDown();
  resolve(LOCAL_MAP_ASSETS.find(a => a.id === "luskan-winter"));
  await init;
  assert.equal(f.manager.asset, null);
  assert.deepEqual(f.pins, []);
});
