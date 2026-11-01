import { installMapSymbols } from './map-symbols.mjs';
import { worldUrl } from "./worlds.mjs";
import { createMapRoot, createLabelRoot, screenInScene } from "./canvas-util.mjs";
import { TILE_SIZE, makeFrame, sceneToLatLon, latLonToScene, aspect } from "./geo.mjs";
import { Archive } from "./pmtiles.mjs";
import { buildStyle } from "./realm-style.mjs";
import { TerrainDetail } from "./terrain/detail.mjs";
import { SatelliteDetail } from "./terrain/satellite-detail.mjs";
import { isRiverHazard, hazardSubtype } from "./river-hazards.mjs";
import { riverLabelFeatures, riverLabelLayer } from "./river-labels.mjs";

/** Render this much extra on each side so short pans never show an empty edge. */
const MARGIN = 0.15;
/** How long the zoom stays still before what shows by zoom is decided again (the settle delay). */
export const SETTLE_MS = 450;
const PROTOCOL = "kgrealms";
/**
 * Above the scene's effects (0.76): with "Names above effects" on, the map is drawn twice. The ground
 * (terrain, water, borders, roads, rivers) goes under the scene's effects, so a region's water filter
 * ripples it; names and markers, the journey, encounter markers and the search flash go on a second
 * map drawn above them, so they stay readable.
 */
const TOP_SOURCES = new Set(["journey", "journey-camps", "encounters", "flash", "area-edit", "area-edit-nodes"]);
export const onTop = (layer) => layer.type === "symbol" || TOP_SOURCES.has(layer.source);

/** Open world archives by key ("toril-surface"), read by the MapLibre protocol below. */
const archives = new Map();
const details = new Map();
/** Close-zoom satellite tiles per world, made on demand past the archive's last zoom. */
const satellite = new Map();
let protocolAdded = false;
let maplibre = null;

async function loadMapLibre() {
  maplibre ??= await import("../lib/maplibre/maplibre-gl.mjs");
  if (!protocolAdded) {
    // kgrealms://<key>/<z>/<x>/<y>: a tile from that world file.
    maplibre.addProtocol(PROTOCOL, async (params, abortController) => {
      const [key, z, x, y] = params.url.slice(PROTOCOL.length + 3).split("/");
      const close = satellite.get(key);
      if (close && +z > close.base) {
        const bytes = await close.tile(+z, +x, +y, abortController?.signal).catch(() => null);
        return { data: bytes ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : new ArrayBuffer(0) };
      }
      const detail = details.get(key);
      const bytes = detail && (+z > detail.options.baseZoom || ((key.endsWith('-relief') || key.endsWith('-tint')) && +z > (detail.options.reliefBaseMaxZoom ?? detail.options.baseZoom)))
        ? await detail.tile(+z, +x, +y, key.endsWith('-tint') ? 'tint' : 'relief', abortController?.signal)
        : await archives.get(key)?.tile(+z, +x, +y).catch(() => null);
      return { data: bytes ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : new ArrayBuffer(0) };
    });
    protocolAdded = true;
  }
  return maplibre;
}

/** An archive of a world, opened once and shared by every scene of it. */
export function worldArchive(world, file) {
  const key = `${world}-${file}`;
  if (!archives.has(key)) archives.set(key, new Archive(worldUrl(world, `${file}.pmtiles`)));
  return archives.get(key);
}

/**
 * A world region on the canvas. A hidden MapLibre map follows the Foundry camera, and every frame
 * it draws is copied into one sprite on the canvas (as KG Cities does): MapLibre does the level of
 * detail, tile caching and label placement. With names above effects, a second map (`labels`) draws
 * what onTop() picks into a sprite above the scene's effects; both follow one camera.
 */
export class RealmLayer {
  constructor() {
    this.root = null;
    this.frame = null;
    this.map = null;
    this.labels = null;
    this.el = null;
    this.labelEl = null;
    this.sprite = null;
    this.labelSprite = null;
    this.camera = null;
    this.generation = 0;
    this.ready = false;
    this.onError = null;
    this.onResize = () => this.update();
    this.places = null;
    this.editing = false;
    this.options = null;
  }

  /** The roads and trails (GeoJSON) to draw. */
  setRoutes(geojson) {
    this.routes = geojson;
    this.#apply("routes", (map) => map.getSource("routes")?.setData(this.routes));
  }

  /** A planned journey's path ([lon, lat] list), or null to clear it. */
  setJourney(coords, camps = []) {
    this.journey = [coords, camps];
    this.onJourneyChanged?.(coords);
    this.#apply("journey", (map) => {
      const [line, marks] = this.journey;
      map.getSource("journey")?.setData({ type: "FeatureCollection", features: line ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } }] : [] });
      map.getSource("journey-camps")?.setData({ type: "FeatureCollection", features: (marks ?? []).map((c) => ({ type: "Feature", properties: { label: c.label ?? "", name: c.name ?? "", kind: c.kind ?? "camp", selected: !!c.selected }, geometry: { type: "Point", coordinates: c.at } })) });
    });
  }

  /** Encounter markers, prefiltered for the viewer: { [id]: { lon, lat, name } }. */
  setEncounters(map) {
    this.encounters = map;
    this.hasRiverHazards=Object.values(map??{}).some(isRiverHazard);
    this.#apply("encounters", (map) => map.getSource("encounters")?.setData({ type: "FeatureCollection", features: Object.entries(this.encounters ?? {}).map(([id, e]) => ({ type: "Feature", properties: { id, name: e.name, kind:hazardSubtype(e)??e.kind??"encounter",hazard:isRiverHazard(e) }, geometry: { type: "Point", coordinates: [e.lon, e.lat] } })) }));
  }

  /** Named biome polygons are an editor overlay; location inference does not depend on drawing. */
  setBiomes(zones, selected = null) {
    this.biomes = zones ? [zones, selected] : null;
    this.#apply("biomes", (map) => {
      if (!map.getSource("biome-zones")) {
      map.addSource("biome-zones", { type: "geojson", data: { type:"FeatureCollection",features:[] } });
      this.#addLayer(map, {id:"biome-zone-fill",type:"fill",source:"biome-zones",paint:{"fill-color":["get","color"],"fill-opacity":["case",["get","selected"],.28,.13]}});
      this.#addLayer(map, {id:"biome-zone-line",type:"line",source:"biome-zones",paint:{"line-color":["get","color"],"line-width":["case",["get","selected"],3,1.5]}});
      this.#addLayer(map, {id:"biome-zone-labels",type:"symbol",source:"biome-zones",layout:{"text-field":["get","name"],"text-font":["Noto Sans Medium"],"text-size":13},paint:{"text-color":"#ffffff","text-halo-color":"#161b1d","text-halo-width":2}});
      }
      map.getSource("biome-zones").setData({type:"FeatureCollection",features:(this.biomes?.[0]??[]).filter(z=>z.pts?.length>=3&&!z.disabled).map(z=>({type:"Feature",properties:{id:z.id,name:z.name??"",color:z.color??"#699489",selected:z.id===this.biomes[1]},geometry:{type:"Polygon",coordinates:[z.pts,...(Array.isArray(z.holes)?z.holes:[])].filter(r=>r?.length>=3).map(r=>[...r,r[0]])}}))});
    });
  }

  /** The road editor's overlay: the selected or new line, and its nodes. */
  setRouteEdit(line, nodes, selected = null) {
    this.routeEdit = [line, nodes, selected];
    const fc = (features) => ({ type: "FeatureCollection", features });
    this.#apply("routeEdit", (map) => {
      const [l, n, sel] = this.routeEdit;
      map.getSource("route-edit")?.setData(fc(l ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: l } }] : []));
      map.getSource("route-nodes")?.setData(fc((n ?? []).map((c, i, a) => ({ type: "Feature", properties: { end: i === 0 || i === a.length - 1, selected: i === sel }, geometry: { type: "Point", coordinates: c } }))));
    });
  }
  /**
   * The map editor's waterways: [{ id, kind, name, pts: [[lon, lat]] }] (null clears), the selected
   * id, and the edge of the map's water as segments ([[lon, lat], [lon, lat]]), or null.
   */
  setWaterways(list, selected = null, coast = null) {
    this.waterways = list ? [list, selected, coast] : null;
    this.#apply("waterways", (map) => {
      const [l, sel, edge] = this.waterways ?? [[], null, null];
      const features = l.filter((w) => w.pts?.length > 1).map((w) => ({ type: "Feature", properties: { kind: w.kind, name: w.name ?? "", selected: w.id === sel }, geometry: { type: "LineString", coordinates: w.pts } }));
      if (edge?.length) features.unshift({ type: "Feature", properties: { kind: "coast", name: "", selected: false }, geometry: { type: "MultiLineString", coordinates: edge } });
      map.getSource("waterways")?.setData({ type: "FeatureCollection", features });
      if (map.getLayer("river-labels")) map.setLayoutProperty("river-labels", "visibility", list ? "none" : "visible");
    });
  }

  setRiverNames(waterways) {
    this.riverNames = waterways;
    this.#apply("riverNames", (map) => {
      if (!map.getSource("river-labels")) map.addSource("river-labels", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      this.#addLayer(map, riverLabelLayer());
      map.getSource("river-labels").setData(riverLabelFeatures(this.riverNames));
      if (map.getLayer("river-labels")) map.setLayoutProperty("river-labels", "visibility", this.waterways ? "none" : "visible");
    });
  }

  /** A [lon, lat] as canvas screen coordinates (the stage's global space), or null. */
  toScreen(lon, lat) {
    if (!this.frame) return null;
    const p = latLonToScene(this.frame, lat, lon);
    const g = canvas.stage.worldTransform.apply(p);
    return [g.x, g.y];
  }

  /** Canvas screen coordinates as [lon, lat], or null. */
  fromScreen(x, y) {
    if (!this.frame) return null;
    const p = canvas.stage.worldTransform.applyInverse({ x, y });
    const ll = sceneToLatLon(this.frame, p);
    return [ll.lon, ll.lat];
  }

  /** The areas (map-layers.mjs areasGeoJSON): { areas: borders and lines, labels: their names' points }. */
  setAreas(geo) {
    this.areas = geo;
    this.#apply("areas", (map) => {
      map.getSource("areas")?.setData(this.areas?.areas ?? { type: "FeatureCollection", features: [] });
      map.getSource("area-labels")?.setData(this.areas?.labels ?? { type: "FeatureCollection", features: [] });
    });
  }

  /** The map editor's area border: the outline ([lon, lat] list, closed or not), its corners, the selected one. */
  setAreaEdit(pts, closed = false, selected = null, label = null) {
    this.areaEdit = pts?.length || label ? [pts ?? [], closed, selected, label] : null;
    this.#apply("areaEdit", (map) => {
      const [p, c, sel, name] = this.areaEdit ?? [[], false, null, null];
      const line = p.length > 1 ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: c ? [...p, p[0]] : p } }] : [];
      map.getSource("area-edit")?.setData({ type: "FeatureCollection", features: line });
      // The place's own point: where its name sits, a handle to drag it by.
      const handle = name?.at ? [{ type: "Feature", properties: { handle: true, name: name.name ?? "", first: false, selected: false }, geometry: { type: "Point", coordinates: name.at } }] : [];
      map.getSource("area-edit-nodes")?.setData({ type: "FeatureCollection", features: [...p.map((at, i) => ({ type: "Feature", properties: { handle: false, name: "", first: i === 0, selected: i === sel }, geometry: { type: "Point", coordinates: at } })), ...handle] });
    });
  }

  /** The layer the map shows (map-layers.mjs): "places", "realms" or "geo". This viewer's own. */
  setMapLayer(name) {
    this.mapLayer = name;
    this.#whenLoaded((map) => { try { map.setGlobalStateProperty("mapLayer", name); } catch { /* an old style without it */ } });
  }

  setPlaces(geojson) {
    this.places = geojson;
    this.symbols?.preload(geojson);
    this.#whenLoaded((map) => {
      // The GM sees hidden places, faded, so their cards can be opened (players never get them).
      map.setGlobalStateProperty("gm", !!globalThis.game?.user?.isGM);
      map.getSource("places")?.setData(this.places);
    });
  }

  setEditing(editing) {
    this.editing = editing;
    this.#whenLoaded((map) => map.setGlobalStateProperty("editing", editing));
  }

  setLook(look) {
    if (!this.ready || this.options.look === look) return;
    this.options.look = look;
    for (const map of this.#maps()) map.setStyle(this.#style(this.#partOf(map)), { diff: true });
    this.#whenLoaded((map) => {
      map.setGlobalStateProperty("editing", this.editing);
      map.setGlobalStateProperty("gm", !!globalThis.game?.user?.isGM);
      if (this.mapLayer) map.setGlobalStateProperty("mapLayer", this.mapLayer);
      if (this.places) map.getSource("places")?.setData(this.places);
    });
    if (this.areas) this.setAreas(this.areas);
    // A new style starts with empty overlays: put the roads, route and encounters back.
    if (this.routes) this.setRoutes(this.routes);
    if (this.journey) this.setJourney(...this.journey);
    if (this.encounters) this.setEncounters(this.encounters);
    if (this.waterways) this.setWaterways(...this.waterways);
    if (this.riverNames) this.setRiverNames(this.riverNames);
    if (this.biomes) this.setBiomes(...this.biomes);
  }

  /** Swap terrain without rebuilding the HUD, overlays or scene documents. */
  async setTerrain(terrain) {
    if(!this.map||!this.options)return;
    const map=this.map;
    if(!terrain&&this.options.sourceMap)await worldArchive(this.options.world,'tapestry').init().catch(()=>{throw new Error("the realm map's compressed terrain could not load on this client (press Ctrl+Shift+M to check the map files)");});
    if(this.map!==map)return;
    this.options.terrain=terrain;
    if(this.map.getLayer('kgr-terrain'))this.map.removeLayer('kgr-terrain');
    for(const m of this.#maps())m.setStyle(this.#style(this.#partOf(m)),{diff:true});
    this.#whenLoaded((m)=>{if(m===this.map)this.#mountTerrain();m.setGlobalStateProperty('editing',this.editing);m.setGlobalStateProperty('gm',!!globalThis.game?.user?.isGM);});
    if(this.routes)this.setRoutes(this.routes);
    if(this.journey)this.setJourney(...this.journey);
    if(this.encounters)this.setEncounters(this.encounters);
    if(this.waterways)this.setWaterways(...this.waterways);
    if(this.riverNames)this.setRiverNames(this.riverNames);
    if(this.biomes)this.setBiomes(...this.biomes);
    if(this.areas)this.setAreas(this.areas);
    if(this.mapLayer)this.setMapLayer(this.mapLayer);
  }

  #mountTerrain() {
    if(!this.options?.terrain||!this.map?.getLayer('tapestry')||this.map.getLayer('kgr-terrain')||this.mountingTerrain)return;
    this.mountingTerrain=true;
    try{this.map.addLayer(this.options.terrain.makeLayer(),'tapestry');}
    finally{this.mountingTerrain=false;}
  }

  /** The maps drawn: the ground, and (names above effects) the labels. */
  #maps() { return [this.map, this.labels].filter(Boolean); }
  /** Which part of the style a map draws: everything, the ground, or what goes above effects. */
  #partOf(map) { return !this.labels ? "all" : map === this.labels ? "top" : "ground"; }
  /** A layer added later (biome zones, river names) goes on the map that draws its part. */
  #addLayer(map, layer) {
    const part = this.#partOf(map);
    if (map.getLayer?.(layer.id) || (part !== "all" && onTop(layer) !== (part === "top"))) return;
    map.addLayer(layer);
  }

  #whenLoaded(fn) {
    if (!this.ready) return;
    for (const map of this.#maps()) {
      if (map.isStyleLoaded()) fn(map);
      else map.once("idle", () => { if (this.#maps().includes(map)) fn(map); });
    }
  }

  /**
   * Overlay data goes to the map as soon as the style has its sources (tiles still loading do not
   * matter). Each overlay is applied from its latest data, so an update that had to wait can
   * never land after, and undo, a newer one.
   */
  #apply(key, fn) {
    if (!this.ready) return;
    for (const map of this.#maps()) {
      const pending = (map.kgrPending ??= new Map());
      pending.set(key, fn);
      if (map.style?._loaded || map.isStyleLoaded()) { pending.delete(key); fn(map); continue; }
      if (map.kgrWaiting) continue;
      map.kgrWaiting = true;
      const flush = () => {
        if (!this.#maps().includes(map)) return;
        if (!(map.style?._loaded || map.isStyleLoaded())) return map.once("styledata", flush);
        map.kgrWaiting = false;
        const all = [...pending.values()];
        pending.clear();
        for (const f of all) f(map);
      };
      map.once("styledata", flush);
    }
  }

  #pixel(scenePoint) {
    const { x, y, w, h } = this.camera;
    return [((scenePoint.x - x) / w) * this.el.clientWidth, ((scenePoint.y - y) / h) * this.el.clientHeight];
  }

  /** A place whose marker or name MapLibre actually drew near the pointer. */
  placeAt(scenePoint, radius = 10) {
    if (!this.ready || !this.camera) return null;
    const [px, py] = this.#pixel(scenePoint), box = [[px - radius, py - radius], [px + radius, py + radius]];
    // Rendered features under the pointer, from whichever map draws each layer.
    const query = (ids) => this.#maps().flatMap((m) => { const layers = ids.filter((id) => m.getLayer(id)); return layers.length ? m.queryRenderedFeatures(box, { layers }) : []; });
    const hazardLayers=["encounter-marks","encounter-labels"];
    // Encounters: river hazards for everyone who can see them; for the GM, every encounter marker too.
    const gm=!!globalThis.game?.user?.isGM;if(this.hasRiverHazards||gm){const hits=query(hazardLayers);const hazard=hits.find(f=>f.properties.hazard===true);if(hazard)return`river-hazard:${hazard.properties.id}`;if(gm&&hits.length)return`encounter:${hits[0].properties.id}`;}
    // Transparent settlement/site circles cover every catalogued place, even
    // when its symbol was hidden by zoom or a label collision. They remain in
    // the style for editor use, but must not open hover cards.
    const ids = this.options.sourceMap
      ? ["poi-labels-overview", "poi-labels-regional", "poi-labels-local", "area-names", "area-line-names", ...(this.editing ? ["places-hidden"] : [])]
      : ["place-labels", "site-labels", "settlements", "sites", "places-hidden"];
    const hits = query(ids);
    if (!hits.length) return null;
    const p = this.map.project.bind(this.map);
    hits.sort((a, b) => {
      const pa = p(a.geometry.coordinates), pb = p(b.geometry.coordinates);
      return Math.hypot(pa.x - px, pa.y - py) - Math.hypot(pb.x - px, pb.y - py);
    });
    return hits[0].properties.id;
  }

  /** Blink a ring on some points (GeoJSON) for a few seconds, then fade. Only on this screen. */
  flash(geojson, { seconds = 3.5, fade = 1 } = {}) {
    if (!this.ready) return;
    clearInterval(this.flashTimer);
    const map = this.labels ?? this.map;
    if (!map) return;
    const go = () => {
      map.getSource("flash")?.setData(geojson);
      const start = performance.now();
      this.flashTimer = setInterval(() => {
        const t = (performance.now() - start) / 1000;
        const envelope = t < seconds ? 1 : Math.max(0, 1 - (t - seconds) / fade);
        const a = envelope * (0.35 + 0.65 * (0.5 + 0.5 * Math.cos(t * 2 * Math.PI * 1.6)));
        map.setPaintProperty("flash-glow", "circle-opacity", 0.8 * a);
        map.setPaintProperty("flash-ring", "circle-stroke-opacity", a);
        if (envelope <= 0) {
          clearInterval(this.flashTimer);
          map.getSource("flash")?.setData({ type: "FeatureCollection", features: [] });
        }
      }, 50);
    };
    if (map.isStyleLoaded()) go(); else map.once("idle", go);
  }

  /** A slow breathing glow on the points of interest, only while some glow. */
  #startPulse() {
    const start = performance.now();
    // Night lights flicker: advance the style's phase about ten times a second. Only while the lights
    // are in the style: each step redraws the whole map.
    this.flicker = setInterval(() => {
      if (this.options?.look !== "night" || !this.#maps().some((m) => m.isStyleLoaded() && m.getLayer("night-glow"))) return;
      for (const m of this.#maps()) if (m.isStyleLoaded()) m.setGlobalStateProperty("phase", (performance.now() - start) / 1000);
    }, 100);
    this.pulse = setInterval(() => {
      if (!this.places?.features.some((f) => f.properties.gold)) return;
      const t = (Math.sin(((performance.now() - start) / 2600) * 2 * Math.PI) + 1) / 2;
      for (const m of this.#maps()) if (m.isStyleLoaded() && m.getLayer("place-glow")) m.setPaintProperty("place-glow", "circle-opacity", 0.25 + 0.45 * t);
    }, 100);
  }

  #style(part = "all") {
    const o = this.options;
    const tile = (file) => `${PROTOCOL}://${o.world}-${file}/{z}/{x}/{y}`;
    const style = buildStyle({
      tiles: { routes: o.sourceMap ? (this.routes ?? { type: 'FeatureCollection', features: [] }) : null, tapestry:tile('tapestry'), surface: tile("surface"), global: tile("global"), underdark: tile("underdark"), dem: tile("dem"), terrain: tile("terrain"), relief: tile("relief"), tint: tile("tint") },
      sourceMap:o.sourceMap, markerScale:o.markerScale ?? 1, labelScale:o.labelScale ?? 1, dim: o.dim?.() ?? true,
      detail: o.detail,
      borders: o.borders,
      glyphs: `${location.origin}${foundry.utils.getRoute("modules/kg-realms/data/fonts/{fontstack}/{range}.pbf")}`,
      look: o.look, level: o.level, relief: o.relief, attribution: o.attribution ?? "", regions: o.regions ?? [], groundGeometry: o.groundGeometry, ground:o.ground
    });
    if (this.places) style.sources.places.data = this.places;
    if (this.areas && style.sources.areas) { style.sources.areas.data = this.areas.areas; style.sources['area-labels'].data = this.areas.labels; }
    if (this.mapLayer && style.state?.mapLayer) style.state.mapLayer.default = this.mapLayer;
    // Hide the raster in the initial style, before MapLibre can request WebP tiles.
    if(o.terrain){const ground=style.layers.find(l=>l.id==='tapestry');if(ground)ground.layout={...ground.layout,visibility:'none'};}
    if (part === "ground") style.layers = style.layers.filter((l) => !onTop(l));
    if (part === "top") style.layers = style.layers.filter(onTop);
    return style;
  }

  /** Draw a region. options: { world, level, bounds (the scene's lat/lon box), look, relief, regions (the index's) }. */
  async draw(options) {
    this.destroy();
    const generation = this.generation;
    this.options = { ...options };
    let rect=canvas.dimensions.sceneRect;
    if(options.sourceMap){
      const ratio=aspect(options.bounds),width=Math.min(rect.width,rect.height/ratio),height=width*ratio;
      rect={x:rect.x+(rect.width-width)/2,y:rect.y+(rect.height-height)/2,width,height};
    }
    this.frame = makeFrame(options.bounds, rect);

    let maplibregl;
    try {
      maplibregl = await loadMapLibre();
      const files = options.sourceMap ? (options.terrain?[]:['tapestry']) : ["surface", "global", ...(options.level === "underdark" ? ["underdark"] : []), ...(options.relief && !(options.detail && options.groundGeometry) ? ["dem"] : [])];
      await Promise.all(files.map((f) => worldArchive(options.world, f).init().catch((err) => {
        // Toril ships only its KTX2 terrain now: without it there is no ground to draw.
        throw f === 'tapestry' ? new Error("the realm map's compressed terrain could not load on this client (press Ctrl+Shift+M to check the map files)") : err;
      })));
      if (!options.terrain&&options.sourceMap?.closeZoom && !satellite.has(`${options.world}-tapestry`)) {
        const url = new URL(worldUrl(options.world, "tapestry.pmtiles"), location.origin).href;
        satellite.set(`${options.world}-tapestry`, new SatelliteDetail(url, { base: options.sourceMap.detailZoom ?? 9 }));
      }
      if (options.detail && options.level !== 'underdark') {
        const key = `${options.world}-relief`;
        if (!details.has(key)) {
          const detail = new TerrainDetail(new URL(worldUrl(options.world, ""), location.origin).href, options.detail);
          await detail.archive.init();
          details.set(key, detail); details.set(`${options.world}-relief`, detail); details.set(`${options.world}-tint`, detail);
        }
        if (options.relief) { await worldArchive(options.world, 'relief').init(); await worldArchive(options.world, 'tint').init(); }
      }
    } catch (err) {
      if (generation === this.generation) this.onError?.(err);
      return;
    }
    if (generation !== this.generation) return;

    this.el = document.createElement("div");
    this.el.className = "kg-realms-render";
    document.body.append(this.el);
    this.#sizeElement();

    const split = !!options.namesAbove;
    this.map = new maplibregl.Map({
      container: this.el,
      style: this.#style(split ? "ground" : "all"),
      interactive: false,
      attributionControl: false,
      renderWorldCopies: false,
      pixelRatio: options.sharp ? Math.min(window.devicePixelRatio, 2) : 1,
      // The drawing is copied into Foundry as soon as it is drawn (#copy), so it need not be kept for
      // later. Smoothing only where the map is drawn at screen resolution: at double, edges are fine
      // without it. Labels appear without a fade (the settle delay times them instead).
      canvasContextAttributes: { antialias: !(options.sharp && window.devicePixelRatio >= 2), preserveDrawingBuffer: false },
      fadeDuration: 0,
      minZoom: 0,
      maxZoom: 22
    });
    if (split) {
      this.labelEl = document.createElement("div");
      this.labelEl.className = "kg-realms-render";
      document.body.append(this.labelEl);
      this.labelEl.style.width = this.el.style.width; this.labelEl.style.height = this.el.style.height;
      this.labels = new maplibregl.Map({
        container: this.labelEl, style: this.#style("top"), interactive: false, attributionControl: false, renderWorldCopies: false,
        pixelRatio: options.sharp ? Math.min(window.devicePixelRatio, 2) : 1,
        canvasContextAttributes: { antialias: !(options.sharp && window.devicePixelRatio >= 2), preserveDrawingBuffer: false },
        fadeDuration: 0, minZoom: 0, maxZoom: 22
      });
    }
    const custom = () => this.options?.customMarkers?.() ?? {}, base = foundry.utils.getRoute('modules/kg-realms') + '/';
    this.symbols = installMapSymbols(this.labels ?? this.map, { base, custom });
    if (this.labels) installMapSymbols(this.map, { base, custom });
    this.map.on("render", () => this.#copy(this.map, this.sprite));
    this.labels?.on("render", () => this.#copy(this.labels, this.labelSprite));
    this.map.on('styledata',()=>this.#mountTerrain());
    let warned = false;
    for (const m of this.#maps()) {
      // A new style starts from its defaults: give it the settled zoom (else zoom gated layers hide).
      m.on('style.load',()=>{if(this.settledZoom!=null)m.setGlobalStateProperty?.('settledZoom',this.settledZoom);});
      m.on("error", (e) => {
        if (warned) return;
        warned = true;
        console.warn("kg-realms | map tiles failed to load (further tile errors are not logged):", e.error ?? e);
      });
    }

    this.root = createMapRoot();
    this.sprite = new PIXI.Sprite(new PIXI.Texture(new PIXI.BaseTexture(this.map.getCanvas())));
    this.sprite.visible = false;
    this.root.addChild(this.sprite);
    if (this.labels) {
      this.labelRoot = createLabelRoot();
      this.labelSprite = new PIXI.Sprite(new PIXI.Texture(new PIXI.BaseTexture(this.labels.getCanvas())));
      this.labelSprite.visible = false;
      this.labelRoot.addChild(this.labelSprite);
    }

    window.addEventListener("resize", this.onResize);
    this.ready = true;
    if (this.places) this.setPlaces(this.places);
    if (this.areas) this.setAreas(this.areas);
    if (this.mapLayer) this.setMapLayer(this.mapLayer);
    this.setEditing(this.editing);
    this.#startPulse();
    this.update();
  }

  destroy() {
    this.generation++;
    this.ready = false;
    clearInterval(this.pulse);
    clearInterval(this.flicker);
    clearInterval(this.flashTimer);
    clearTimeout(this.settleTimer);
    this.pulse = this.flashTimer = null;
    this.settledZoom = null;
    this.elSize = null;
    window.removeEventListener("resize", this.onResize);
    this.map?.remove();
    this.map = null;
    this.labels?.remove();
    this.labels = null;
    this.el?.remove();
    this.el = null;
    this.labelEl?.remove();
    this.labelEl = null;
    this.sprite?.destroy({ texture: true, baseTexture: true });
    this.sprite = null;
    this.labelSprite?.destroy({ texture: true, baseTexture: true });
    this.labelSprite = null;
    this.root?.destroy({ children: true });
    this.root = null;
    this.labelRoot?.destroy({ children: true });
    this.labelRoot = null;
    this.camera = null;
  }

  /** Point MapLibre where Foundry is looking. Cheap: call on every canvasPan. */
  update() {
    if (!this.ready) return;
    const view = screenInScene();
    if (this.#sizeElement()) for (const m of this.#maps()) m.resize();
    const center = sceneToLatLon(this.frame, { x: view.cx, y: view.cy });
    // MapLibre zoom z draws the world 512 * 2^z CSS pixels wide.
    const zoom = Math.log2((view.scale * this.frame.k) / (TILE_SIZE * 2));
    for (const m of this.#maps()) m.jumpTo({ center: [center.lon, center.lat], zoom });
    this.#settle(zoom);
    const [ew, eh] = this.elSize;
    const w = ew / view.scale;
    const h = (eh / view.scale) * (this.frame.ky / this.frame.kx);
    this.camera = { x: view.cx - w / 2, y: view.cy - h / 2, w, h };
  }

  /**
   * The hidden map's size follows the screen's: kept here rather than read back from the page, which
   * would make the browser lay the page out again on every pan.
   */
  #sizeElement() {
    const { width, height } = canvas.app.renderer.screen;
    const w = Math.ceil(width * (1 + 2 * MARGIN));
    const h = Math.ceil(height * (1 + 2 * MARGIN));
    if (this.elSize?.[0] === w && this.elSize?.[1] === h) return false;
    this.elSize = [w, h];
    for (const el of [this.el, this.labelEl]) if (el) { el.style.width = `${w}px`; el.style.height = `${h}px`; }
    return true;
  }

  /**
   * The settle delay: what shows by zoom (names, places, roads) is decided once the zoom has been
   * still for SETTLE_MS, by the style's "settledZoom", not live while zooming (source-map.mjs).
   */
  #settle(zoom) {
    const put = (z) => { this.settledZoom = z; for (const m of this.#maps()) { try { m.setGlobalStateProperty?.("settledZoom", z); } catch { /* before the style loads: style.load gives it */ } } };
    if (this.settledZoom == null) return put(zoom);
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      if (!this.map || Math.abs(zoom - this.settledZoom) < 0.01) return;
      put(zoom);
    }, SETTLE_MS);
  }

  #copy(map, sprite) {
    if (!this.ready || !this.camera || !map || !sprite) return;
    const src = map.getCanvas();
    let base = sprite.texture.baseTexture;
    if (base.realWidth !== src.width || base.realHeight !== src.height) {
      sprite.texture.destroy(true);
      sprite.texture = new PIXI.Texture(new PIXI.BaseTexture(src));
      base = sprite.texture.baseTexture;
    } else {
      base.update();
    }
    // Upload now, while MapLibre's drawing is still there: the browser may clear it once shown.
    try { canvas.app?.renderer?.texture?.bind(base, 0); } catch (err) { console.warn("kg-realms | map copy:", err); }
    const { x, y, w, h } = this.camera;
    sprite.position.set(x, y);
    sprite.width = w;
    sprite.height = h;
    sprite.visible = true;
  }
}
