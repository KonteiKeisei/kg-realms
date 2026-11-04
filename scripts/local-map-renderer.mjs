// Chunked KTX2 rendering for the bundled local maps. Scene geometry and the
// local-map flags select the artwork; the WebP is not fetched in KTX2 mode.
import { allWorlds } from "./worlds.mjs";
import {resolveLocalLods,LocalMapLodSurface} from './local-map-lods.mjs';

const ID = "kg-realms";
// The settlement maps each registered world ships (its definition's localMapAssets, worlds.mjs), by
// picture and by place; rebuilt when the registered worlds change.
let indexKey = null, bySourceMap = new Map(), defaultsMap = new Map();
function index() {
  const worlds = allWorlds(), key = worlds.map((w) => `${w.id}:${w.localMapAssets?.length ?? 0}`).join("|");
  if (key !== indexKey) {
    indexKey = key;
    const all = worlds.flatMap((w) => (w.localMapAssets ?? []).map((a) => (a.world ? a : { ...a, world: w.id })));
    bySourceMap = new Map(all.map((a) => [assetPath(a.source), a]));
    defaultsMap = new Map(all.filter((a) => !a.id.endsWith("-winter")).map((a) => [a.placeId, a]));
  }
  return { bySource: bySourceMap, defaults: defaultsMap };
}

export function assetPath(src) {
  if (!src) return "";
  try { return decodeURIComponent(new URL(String(src), "https://local.invalid/").pathname).replace(/^\/+/, ""); }
  catch { return ""; }
}

export function sceneBackground(scene) {
  if (scene?.levels) {
    const level = scene.initialLevel ?? scene.firstLevel ?? scene.levels.contents?.[0];
    return level?.background?.src ?? "";
  }
  return scene?.background?.src ?? "";
}

export function mapAsset(scene, assets = index().bySource, fallback = index().defaults) {
  if ((scene?.levels?.size ?? scene?.levels?.contents?.length ?? 0) > 1) return null;
  const src = sceneBackground(scene);
  const own=scene?.getFlag?.(ID,'localMap')??scene?.flags?.[ID]?.localMap;
  if(own?.tileAsset&&(!src||assetPath(src)===assetPath(own.tileAsset.source)))return own.tileAsset;
  if (src) return assets.get(assetPath(src)) ?? null; // Keep a GM's custom map.
  const local = scene?.getFlag?.(ID, "localMap") ?? scene?.flags?.[ID]?.localMap;
  if (!local) return null;
  if(local.map)return assets.get(assetPath(local.map))??null;
  const selected=fallback.get(local.placeId);
  // A map only for its own world's places.
  if(selected&&local.world&&selected.world!==local.world)return null;
  return selected?.presetId&&selected.presetId!==local.presetId?null:selected??null;
}

export async function resolveMapAsset(scene, seasonSource) {
  const base = mapAsset(scene);
  if (!base || !seasonSource) return resolveLocalLods(base);
  const src = await seasonSource(scene);
  const seasonal = index().bySource.get(assetPath(src));
  return resolveLocalLods(seasonal?.city === base.city ? seasonal : base);
}

export function chunkPlacement(tile, asset, dimensions) {
  const sx = dimensions.sceneWidth / asset.width, sy = dimensions.sceneHeight / asset.height;
  return {x: dimensions.sceneX + tile.x * sx, y: dimensions.sceneY + tile.y * sy,
    width: tile.width * sx, height: tile.height * sy};
}

export function filterLocalSource(loader, skip) {
  const original = loader.loadTexture;
  async function filtered(src, ...args) { return skip(src) ? null : original.call(this, src, ...args); }
  loader.loadTexture = filtered;
  return () => { if (loader.loadTexture === filtered) loader.loadTexture = original; };
}

/** Foundry 13 preloads scenes without constructing their SceneManager. */
export function filterLocalPreload(Loader, select) {
  const original = Loader.loadSceneTextures;
  async function load(scene, options = {}) {
    const asset = await select(scene);
    if (!asset) return original.call(this, scene, options);
    const view = new Proxy(scene, {get(target, key) {
      if (key === "background") return {...target.background, src: null};
      const value = Reflect.get(target, key, target);
      return typeof value === "function" && key !== "constructor" ? value.bind(target) : value;
    }});
    return original.call(this, view, {...options,
      additionalSources: [...(options.additionalSources ?? []), ...asset.tiles.map(t => t.src)]});
  }
  Loader.loadSceneTextures = load;
  return () => { if (Loader.loadSceneTextures === load) Loader.loadSceneTextures = original; };
}

export function createLocalMapManager({SceneManager, canvas, PIXI, resolve = mapAsset,
  enabled, loadTexture, Mesh, pin = () => {}, unpin = () => {}, report}) {
  return class LocalMapManager extends SceneManager {
    asset = null;
    #textures = [];
    #meshes = [];
    #frames = new Map();
    #pinned = new Set();
    #generation = 0;
    #error = null;
    #webp = null;
    #webpTexture = null;
    #lodSurface = null;

    async _onInit() {
      const generation = ++this.#generation;
      const selected = await resolve(this.scene);
      if (generation !== this.#generation || canvas.scene?.id !== this.scene.id) return;
      if(selected?.lods){this.asset=selected;return;}
      if (!enabled()) {
        if (selected && !sceneBackground(this.scene)) {
          this.#webp = selected;
          canvas.loadTexturesOptions.additionalSources.push(selected.source);
        }
        return;
      }
      this.asset = selected;
      this.#error = null;
      if (!this.asset) return;
      const sources = this.asset.tiles.map(t => t.src);
      for (const src of sources) { pin(src); this.#pinned.add(src); }
      canvas.loadTexturesOptions.additionalSources.push(...sources);
    }

    // Foundry 14 can also prepare textures for levels which are not viewed.
    _loadTextures(textures, additionalSources, level) {
      if (!enabled()) return;
      const asset = this.asset ?? index().bySource.get(assetPath(level?.background?.src)) ?? mapAsset(this.scene);
      if (!asset) return;
      textures.background = PIXI.Texture.EMPTY;
      additionalSources.push(...asset.tiles.map(t => t.src));
    }

    async _onDraw() {
      if(this.asset?.lods){canvas.sceneTextures.background=PIXI.Texture.EMPTY;return;}
      if (this.#webp) {
        const generation = this.#generation;
        try {
          const texture = await loadTexture(this.#webp.source);
          if (generation !== this.#generation || canvas.scene?.id !== this.scene.id) return;
          this.#webpTexture = texture;
          canvas.sceneTextures.background = this.#webpTexture ?? PIXI.Texture.EMPTY;
        } catch (error) { if (generation === this.#generation) this.#error = error.message; }
        return;
      }
      if (!this.asset || !enabled()) return;
      const generation = this.#generation;
      // Set this before awaiting. A failed load must never reveal or load WebP.
      canvas.sceneTextures.background = PIXI.Texture.EMPTY;
      try {
        const max = canvas.app.renderer.gl.getParameter(canvas.app.renderer.gl.MAX_TEXTURE_SIZE);
        const loaded = await Promise.all(this.asset.tiles.map(async tile => {
          if (tile.textureWidth > max || tile.textureHeight > max) throw new Error(`GPU texture limit ${max}px is too small for this map's chunks.`);
          const texture = await loadTexture(tile.src);
          if (!(texture instanceof PIXI.Texture) || !texture.valid || !texture.baseTexture?.valid ||
              texture.width !== tile.textureWidth || texture.height !== tile.textureHeight) {
            throw new Error(`Invalid map texture: ${tile.src}`);
          }
          return texture;
        }));
        if (generation !== this.#generation || canvas.scene?.id !== this.scene.id) return;
        this.#textures = loaded;
      } catch (error) {
        if (generation === this.#generation) this.#error = error.message;
      }
    }

    async _onReady() {
      if(this.asset?.lods){
        this.#lodSurface=new LocalMapLodSurface({asset:this.asset,canvas,PIXI,Mesh,mode:'ktx2',budgetBytes:(Number(game.settings.get(ID,'localMapBudget'))||128)*1048576,report});
        await this.#lodSurface.start();return;
      }
      if (this.#webp) {
        const bg = canvas.primary?.background;
        if (this.#error || !this.#webpTexture?.valid || !bg || bg.destroyed || !bg.transform) {
          return this.#fail(this.#error ?? "The original map image is unavailable.");
        }
        bg.texture = this.#webpTexture;
        bg.width = canvas.dimensions.sceneWidth;
        bg.height = canvas.dimensions.sceneHeight;
        bg.visible = true;
        canvas.primary.renderDirty = true;
        report({sceneId: this.scene.id, state: "webp", asset: this.#webp.id, chunks: 0});
        return;
      }
      if (!this.asset || !enabled()) return;
      if (this.#error || this.#textures.length !== this.asset.tiles.length) {
        return this.#fail(this.#error ?? "The map textures did not finish loading.");
      }
      const primary = canvas.primary, background = primary?.background;
      if (!background || background.destroyed || !background.transform) return this.#fail("The primary background is unavailable.");
      const created = [];
      try {
        for (const [i, tile] of this.asset.tiles.entries()) {
          const frame = new PIXI.Rectangle(tile.frameX, tile.frameY, tile.width, tile.height);
          const texture = new PIXI.Texture(this.#textures[i].baseTexture, frame);
          let mesh;
          try { mesh = new Mesh({texture, name: `kg-realms-${this.asset.id}-${i}`, object: background.object ?? primary}); }
          catch (error) { texture.destroy(false); throw error; }
          this.#frames.set(mesh, texture);
          created.push(mesh);
          mesh.anchor.set(0, 0);
          const at = chunkPlacement(tile, this.asset, canvas.dimensions);
          mesh.position.set(at.x, at.y);
          mesh.width = at.width;
          mesh.height = at.height;
          mesh.elevation = background.elevation;
          mesh.sortLayer = background.sortLayer;
          mesh.sort = background.sort ?? 0;
          mesh.zIndex = background.zIndex;
          mesh.alpha = background.alpha;
          mesh.tint = background.tint;
          mesh.textureAlphaThreshold = 0;
          mesh.hoverFade = false;
          primary.addChild(mesh);
        }
        background.visible = false;
        primary.sortDirty = primary.renderDirty = true;
        this.#meshes = created;
        const bytes = this.#textures.reduce((n, t) => n + (t.baseTexture.resource?._levelBuffers ?? [])
          .reduce((sum, b) => sum + (b.levelBuffer?.byteLength ?? 0), 0), 0);
        report({sceneId: this.scene.id, state: "ktx2", asset: this.asset.id, chunks: created.length,
          texturePayloadMiB: bytes ? +(bytes / 1048576).toFixed(2) : null});
      } catch (error) {
        for (const mesh of created) this.#destroy(mesh);
        this.#fail(error.message);
      }
    }

    #fail(error) { report({sceneId: this.scene.id, state: "failed", asset: this.asset?.id, error}); }

    #destroy(mesh) {
      const frame = this.#frames.get(mesh);
      if (!mesh.destroyed) {
        mesh.parent?.removeChild(mesh);
        mesh.destroy({children: true, texture: false, baseTexture: false});
      }
      if (frame?.baseTexture) frame.destroy(false); // Only our crop frame, never Foundry's cached base.
      this.#frames.delete(mesh);
    }

    async _onTearDown() {
      this.#generation++;
      this.#lodSurface?.stop();this.#lodSurface=null;
      for (const mesh of this.#meshes) this.#destroy(mesh);
      this.#meshes = [];
      this.#textures = [];
      for (const src of this.#pinned) unpin(src);
      this.#pinned.clear();
      this.asset = null;
      this.#webp = this.#webpTexture = null;
    }

    get selectedAsset() { return this.asset ?? this.#webp; }
  };
}

export class LocalMapRenderer {
  #Manager;
  #status = {state: "idle"};
  #refresh = false;
  #warned = new Set();
  #seasonSource;
  #seasonUpdate = null;
  #seasonAgain = false;
  #date = "";

  constructor({seasonSource} = {}) { this.#seasonSource = seasonSource; }

  #resolve(scene) { return resolveMapAsset(scene, this.#seasonSource); }

  status() { return {...this.#status}; }

  install() {
    game.settings.register(ID,'localMapBudget',{name:'Local map texture budget',hint:'Background GPU texture payload for maps with several detail levels. Optimized placed tiles share up to half this amount in additional display textures. Native previews, other scene graphics and decoder memory are additional.',scope:'client',config:true,type:Number,default:128,choices:{64:'64 MiB',128:'128 MiB',256:'256 MiB'},requiresReload:true});
    // KTX2 only (0.65.6): the bundled maps no longer ship their WebP pictures.
    const enabled = () => true;
    const Loader = foundry.canvas.TextureLoader;
    if (!foundry.canvas.SceneManager || !Loader?.loader || !CONFIG.Canvas.managedScenes) return;
    this.#Manager = createLocalMapManager({SceneManager: foundry.canvas.SceneManager, canvas, PIXI,
      enabled, Mesh: foundry.canvas.primary.PrimarySpriteMesh,
      resolve: scene => this.#resolve(scene),
      loadTexture: src => foundry.canvas.loadTexture(src),
      pin: src => Loader.pinSource(src), unpin: src => Loader.unpinSource(src),
      report: value => {
        this.#status = value;
        if (value.error) {
          console.error("kg-realms | local map KTX2", value);
          ui.notifications.error(`KG Realms: ${value.error}`);
        }
      }});
    filterLocalSource(Loader.loader, src => {
      const manager = canvas.manager;
      return enabled() && manager instanceof this.#Manager && !!manager.asset &&
        assetPath(src) === assetPath(manager.asset.source);
    });
    if ((game.release?.generation ?? 13) === 13) filterLocalPreload(Loader, async scene => {
      if (!enabled()) return null;
      const owner = CONFIG.Canvas.managedScenes[scene.id];
      return !owner || owner === this.#Manager ? this.#resolve(scene) : null;
    });
    const refresh = () => this.#register(enabled);
    Hooks.on("setup", refresh);
    Hooks.on("createScene", refresh);
    Hooks.on("updateScene", (scene, changes = {}) => {
      this.#register(enabled, {defer: "background" in changes || "background.src" in changes});
      if (scene === canvas.scene && (changes.flags?.[ID]?.localMap?.seasons || changes.flags?.[ID]?.localMap?.tileAsset ||
          Object.keys(changes).some(key => key.startsWith(`flags.${ID}.localMap.seasons`)||key.startsWith(`flags.${ID}.localMap.tileAsset`)))) this.refreshSeason();
    });
    Hooks.on("canvasReady", () => {
      if (this.#refresh && CONFIG.Canvas.managedScenes[canvas.scene?.id] === this.#Manager &&
          canvas.manager?.constructor !== this.#Manager) {
        this.#refresh = false;
        queueMicrotask(() => {
          if (CONFIG.Canvas.managedScenes[canvas.scene?.id] === this.#Manager) {
            canvas.draw().catch(error => console.error("kg-realms | local map redraw", error));
          }
        });
      } else this.#refresh = false;
      queueMicrotask(() => this.refreshSeason());
    });
    Hooks.on("updateWorldTime", () => {
      const c = game.time?.components, key = `${c?.year}/${c?.month}/${c?.dayOfMonth}`;
      if (key !== this.#date) { this.#date = key; this.refreshSeason(); }
    });
    Hooks.on("calendaria.weatherChange", () => this.refreshSeason());
    Hooks.on("ready", refresh);
  }

  refreshSeason() {
    if (!this.#Manager) return Promise.resolve();
    if (this.#seasonUpdate) { this.#seasonAgain = true; return this.#seasonUpdate; }
    this.#seasonUpdate = (async () => {
      do {
        this.#seasonAgain = false;
        const scene = canvas.scene, manager = canvas.manager;
        if (!(manager instanceof this.#Manager) || !canvas.ready || canvas.loading) return;
        const selected = await this.#resolve(scene);
        if (canvas.scene !== scene || canvas.manager !== manager || canvas.loading) return;
        if (selected && selected.id !== manager.selectedAsset?.id) await canvas.draw();
      } while (this.#seasonAgain);
    })().catch(error => console.warn("kg-realms | local map season", error))
      .finally(() => { this.#seasonUpdate = null; });
    return this.#seasonUpdate;
  }

  #register(enabled, {defer = false} = {}) {
    for (const scene of game.scenes ?? []) {
      if (!mapAsset(scene) || (!enabled() && sceneBackground(scene))) {
        if (CONFIG.Canvas.managedScenes[scene.id] === this.#Manager) delete CONFIG.Canvas.managedScenes[scene.id];
        continue;
      }
      const existing = CONFIG.Canvas.managedScenes[scene.id];
      if (existing && existing !== this.#Manager) {
        if (!this.#warned.has(scene.id)) {
          this.#warned.add(scene.id);
          console.warn(`kg-realms | ${scene.name} already has a scene renderer. Disable the Neverwinter test module if it is still enabled.`);
        }
        continue;
      }
      CONFIG.Canvas.managedScenes[scene.id] = this.#Manager;
      if (canvas.scene?.id === scene.id && !(canvas.manager instanceof this.#Manager)) {
        this.#refresh = true;
        if (!defer && canvas.ready && !canvas.loading) {
          this.#refresh = false;
          canvas.draw().catch(error => console.error("kg-realms | local map redraw", error));
        }
      }
    }
  }
}
