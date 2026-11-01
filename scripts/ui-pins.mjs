// The GM's pin editor. Drag a place's marker to move it; click a marker to select it (its kind
// and map marker are set here) and open its place card, where everything else about it is edited.
// Edits are saved with the other place edits, so the hover card, search and journeys follow them.
//
// Pointer events are heard before Foundry's own (canvas-input.mjs), and taken only when they start
// on a place, so panning the map still works everywhere else and Foundry draws no selection box.

import { onCanvas } from "./canvas-input.mjs";
import { markerCatalog, iconFor } from "./map-symbols.mjs";
import { latLonToScene } from "./geo.mjs";
import { placeLayer, placeShape, placeOutline, recordIndex, areaKind, canBeBiome, hierarchyOf, partOfChoices, MAP_LAYERS, LAYER_NAMES, SHAPES, insideRing, interiorPoint } from "./map-layers.mjs";
import { biomeTypes, biomeForClass, zoneForPlace } from "./biomes.mjs";
import { borderSelect, borderHome, followOf } from "./borders.mjs";
import { ruleTooltip } from "./travel-rules.mjs";
// Drawing an area's border (0.77): how near (screen px) a click to the first corner closes it, and
// how near a click must be to a corner or an edge to take it.
const CLOSE_PX = 12, NODE_PX = 9, EDGE_PX = 7;

const DRAG_PX = 4;
const KEY = [["faerun-city", "City"], ["faerun-town", "Town"], ["faerun-village", "Village"], ["faerun-keep", "Castle"], ["faerun-ruin", "Ruin"], ["faerun-peak", "Peak"], ["faerun-dungeon", "Dungeon"], ["faerun-tower", "Tower"], ["faerun-site", "Site"]];
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
// The list of places (0.75): a section for each kind, a group for each class inside it.
const KINDS = [["settlement", "Settlements"], ["site", "Sites"], ["domain", "Domains"], ["territory", "Territories"], ["natural", "Natural features"]];
const OPEN_KEY = "kgr-places-open";

export class PinEditor {
  /** getLayer, getPlaces, getPlace(id), saveEdits(fn) (place edits: { edits, added }), preview(places). */
  constructor(options) {
    Object.assign(this, options);
    this.active = false;
    this.selected = null;
    this.press = null;     // { id, start: [x, y], moved }
    this.panel = null;
    this.handlers = { pointerdown: (e) => this.#down(e), pointermove: (e) => this.#move(e), pointerup: (e) => this.#up(e), dblclick: (e) => { if (this.drawing) { this.#stop(e); this.#finishBorder(false); } } };
    this.undoStack = [];
    this.lastClick = null;
    // Esc steps back one level: stop adding, then let go of the place, then leave the editor.
    this.onKey = (e) => {
      if (!this.active || e.target?.closest?.("input, textarea, select, [contenteditable]")) return;
      if (e.key === "Escape") {
        e.preventDefault(); e.stopImmediatePropagation();
        if (this.drawing) { this.drawing = null; this.#overlay(); return this.#render(); }
        if (this.placing || this.picking || this.adding) { this.placing = this.picking = this.adding = false; return this.#render(); }
        if (this.selected) return this.select(null);
        return this.onLeave?.();
      }
      if (e.key === "Enter" && this.drawing) { e.preventDefault(); e.stopImmediatePropagation(); return this.#finishBorder(false); }
      if ((e.key === "Delete" || e.key === "Backspace") && this.corner != null && !this.drawing) { e.preventDefault(); e.stopImmediatePropagation(); return this.#removeCorner(this.corner); }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === "KeyZ") { e.preventDefault(); e.stopImmediatePropagation(); this.#undo(); }
    };
  }

  /** What the editing bar says on this tab. */
  status() {
    const p = this.selected ? this.getPlace(this.selected) : null;
    if (this.placing) return { hint: "Click the map where the new place goes", esc: "cancels adding", tip: "Click to put the new place here", crosshair: true };
    if (this.drawing) return { hint: `Drawing ${p?.name ?? "the"} border · click to add corners · click the first corner to close it · Enter or double-click leaves the ends apart`, esc: "cancels drawing", tip: this.drawing.pts.length > 2 ? "Click the first corner to close the border" : "Click to add a corner", crosshair: true };
    if (p && this.#editable(p)) return { hint: `${p.name} · drag a corner to move it · click an edge to add one · right-click a corner to remove it`, esc: "lets go of it", tip: "" };
    if (p) return { hint: `${p.name} · drag to move it · double-click for its card`, esc: "lets go of it", tip: "" };
    return { hint: "Drag a place to move it · click to select · double-click for its card", esc: "leaves editing", tip: "" };
  }

  /** Every place edit goes through here first, so Ctrl+Z can step back. */
  #remember() {
    const now = this.getEdits?.();
    if (!now) return;
    this.undoStack.push(foundry.utils.deepClone(now));
    if (this.undoStack.length > 40) this.undoStack.shift();
  }

  async #undo() {
    const prev = this.undoStack.pop();
    if (!prev) return ui.notifications.info("KG Realms: nothing to undo on the places.");
    await this.saveEdits(() => prev);
    if (this.selected && !this.getPlace(this.selected)) this.selected = null;
    this.#render();
  }

  toggle(on = !this.active) { on ? this.open() : this.close(); }

  async open() {
    if (this.active || !game.user.isGM || !this.getLayer()?.frame) return;
    this.active = true;
    this.catalog = await markerCatalog(foundry.utils.getRoute("modules/kg-realms") + "/");
    this.offCanvas = onCanvas(this.handlers);
    window.addEventListener("keydown", this.onKey, { capture: true });
    this.#render();
  }

  close() {
    if (!this.active) return;
    this.active = false;
    this.offCanvas?.(); this.offCanvas = null;
    window.removeEventListener("keydown", this.onKey, { capture: true });
    this.selected = this.press = null;
    this.placing = false;
    this.drawing = this.editing = this.cornerDrag = null; this.corner = null;
    this.getLayer()?.setAreaEdit?.(null);
    this.panel?.remove();
    this.panel = null;
  }

  #global(e) { const r = canvas.app.view.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  #stop(e) { e.preventDefault(); e.stopImmediatePropagation(); }

  #placeAt(g) {
    const layer = this.getLayer();
    const scene = canvas.stage.worldTransform.applyInverse({ x: g[0], y: g[1] });
    return layer.placeAt(scene, 10);
  }

  #down(e) {
    if (!this.active) return;
    const g = this.#global(e);
    // Right-click a corner of the selected outline: removed.
    if (e.button === 2) { const i = this.#cornerAt(g); if (i >= 0 && !this.drawing) { this.#stop(e); this.#removeCorner(i); } return; }
    if (e.button !== 0) return;
    if (this.placing) { this.#stop(e); return this.#addPlace(g); }
    if (this.drawing) { this.#stop(e); return this.#addCorner(g); }
    if (this.selected && placeShape(this.getPlace(this.selected)) !== "point") {
      // The place's own point (its name's place): dragged as a marker is.
      const p = this.getPlace(this.selected), s = this.getLayer().toScreen(p.lon, p.lat);
      if (s && Math.hypot(s[0] - g[0], s[1] - g[1]) < 13) { this.#stop(e); this.press = { id: p.id, start: g, moved: false }; return; }
    }
    if (this.selected && this.#editable(this.getPlace(this.selected))) {
      const i = this.#cornerAt(g);
      if (i >= 0) { this.#stop(e); this.corner = i; this.cornerDrag = { i, moved: false }; this.#overlay(); return this.onStatus?.(); }
      const at = this.#edgeAt(g);
      if (at >= 0) { this.#stop(e); const o = this.#editPts(); o.pts.splice(at + 1, 0, this.getLayer().fromScreen(...g)); this.editing = o; this.corner = at + 1; this.cornerDrag = { i: at + 1, moved: true }; return this.#overlay(); }
    }
    const id = this.#placeAt(g);
    if (!id) return;
    this.#stop(e);
    this.press = { id, start: g, moved: false };
  }

  #move(e) {
    if (!this.active) return;
    if (this.drawing) { this.hover = this.getLayer().fromScreen(...this.#global(e)); return this.#overlay(); }
    if (this.cornerDrag) {
      this.#stop(e);
      const o = this.editing ?? this.#editPts();
      o.pts[this.cornerDrag.i] = this.getLayer().fromScreen(...this.#global(e));
      this.editing = o; this.cornerDrag.moved = true;
      return this.#overlay();
    }
    if (!this.press) return;
    this.#stop(e);
    const g = this.#global(e);
    if (!this.press.moved && Math.hypot(g[0] - this.press.start[0], g[1] - this.press.start[1]) < DRAG_PX) return;
    this.press.moved = true;
    const [lon, lat] = this.getLayer().fromScreen(...g);
    this.press.at = [lon, lat];
    if (!this.frame) this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.press?.at) this.preview(this.press.id, this.press.at);
    });
  }

  async #up(e) {
    if (!this.active) return;
    if (this.cornerDrag) {
      this.#stop(e);
      const { moved } = this.cornerDrag, o = this.editing;
      this.cornerDrag = null;
      if (moved && o) await this.#saveOutline(this.selected, o.pts, o.closed);
      return;
    }
    if (!this.press) return;
    this.#stop(e);
    const { id, moved, at } = this.press;
    this.press = null;
    if (moved && at) {
      await this.#save(id, { lon: +at[0].toFixed(6), lat: +at[1].toFixed(6) });
      this.lastClick = null;
      return this.select(id);
    }
    // A click selects; a second click on the same place soon after opens its card, as on the map.
    const now = Date.now(), again = this.lastClick?.id === id && now - this.lastClick.t < 450;
    this.lastClick = again ? null : { id, t: now };
    this.select(id);
    if (again) this.openCard?.(id);
  }

  select(id) {
    this.selected = id; this.placing = false; this.drawing = null; this.editing = null; this.corner = null; this.cornerDrag = null;
    // The map shows the layer the place is on, so its area and name can be seen (0.77.1).
    const p = id ? this.getPlace(id) : null;
    this.selectedLayer = p ? placeLayer(p) ?? "places" : null;
    if (p) this.showLayer?.(this.selectedLayer);
    this.#render(); this.#overlay();
  }

  /* ------------------------------------------------------------------ area borders (0.77) */

  /** The selected place's outline as the map draws it ({ pts, closed, fromRecord }), or null. */
  #outline(p) { return p ? placeOutline(p, recordIndex(this.getRegions?.() ?? [])) : null; }
  /** An outline to edit here: one following a shoreline is reshaped on the shoreline. */
  #editable(p) { return p?.shoreLine ? null : this.#outline(p); }
  /** A copy of the selected outline to change (the edit in progress, if any). */
  #editPts() { const o = this.editing ?? this.#editable(this.getPlace(this.selected)); return o ? { pts: o.pts.map((c) => [...c]), closed: !!o.closed } : { pts: [], closed: false }; }
  #cornerAt(g) {
    const o = this.editing ?? this.#editable(this.selected ? this.getPlace(this.selected) : null), layer = this.getLayer();
    if (!o) return -1;
    let best = -1, bd = NODE_PX;
    o.pts.forEach((c, i) => { const s = layer.toScreen(c[0], c[1]), d = Math.hypot(s[0] - g[0], s[1] - g[1]); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  #edgeAt(g) {
    const o = this.editing ?? this.#editable(this.getPlace(this.selected)), layer = this.getLayer();
    if (!o || o.pts.length < 2) return -1;
    const s = o.pts.map((c) => layer.toScreen(c[0], c[1])), n = o.closed ? s.length : s.length - 1;
    let best = -1, bd = EDGE_PX;
    for (let i = 0; i < n; i++) {
      const a = s[i], b = s[(i + 1) % s.length], dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((g[0] - a[0]) * dx + (g[1] - a[1]) * dy) / l)), d = Math.hypot(a[0] + dx * t - g[0], a[1] + dy * t - g[1]);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  #addCorner(g) {
    const d = this.drawing, layer = this.getLayer();
    if (d.pts.length > 2) { const f = layer.toScreen(...d.pts[0]); if (Math.hypot(f[0] - g[0], f[1] - g[1]) < CLOSE_PX) return this.#finishBorder(true); }
    d.pts.push(layer.fromScreen(...g));
    this.#overlay(); this.onStatus?.();
  }
  async #finishBorder(closed) {
    const d = this.drawing;
    if (!d) return;
    if (d.pts.length < 2) return ui.notifications.info("KG Realms: a border needs at least two corners. Esc cancels.");
    this.drawing = null; this.hover = null;
    await this.#saveOutline(this.selected, d.pts, closed && d.pts.length > 2);
  }
  async #removeCorner(i) {
    const o = this.#editPts();
    if (o.pts.length <= (o.closed ? 3 : 2)) return ui.notifications.warn(`KG Realms: ${o.closed ? "a closed border needs at least three corners" : "a line needs at least two corners"}. Use Remove border instead.`);
    o.pts.splice(i, 1); this.corner = null;
    await this.#saveOutline(this.selected, o.pts, o.closed);
  }
  async #saveOutline(id, pts, closed) {
    if (!id) return;
    const p = this.getPlace(id);
    const shape = closed ? "area" : (placeShape(p) === "point" ? "line" : placeShape(p) === "area" && pts.length < 3 ? "line" : placeShape(p));
    this.editing = null;
    const fields = { area: pts.map(([lon, lat]) => [+lon.toFixed(6), +lat.toFixed(6)]), areaClosed: !!closed, shape: closed ? "area" : shape };
    if (closed && pts.length > 2 && !insideRing(pts, [p.lon, p.lat])) { const [lon, lat] = interiorPoint(pts); Object.assign(fields, { lon: +lon.toFixed(6), lat: +lat.toFixed(6) }); }
    await this.#save(id, fields);
    await this.#followBorder(id, closed ? fields.area : null);
    this.#render(); this.#overlay();
  }
  /** A biome zone made from this place keeps to its border, and goes when the border stops closing. */
  async #followBorder(id, pts) {
    const zoneId = this.getPlace(id)?.biomeZone;
    if (!zoneId || !this.getBiomes?.()?.zones?.[zoneId]) return;
    if (pts) return this.saveBiomes((c) => ({ ...c, zones: { ...c.zones, [zoneId]: { ...c.zones[zoneId], pts: structuredClone(pts) } } }));
    await this.#dropZone(id);
    ui.notifications.info("KG Realms: its biome zone was removed, because a biome needs a closed border.");
  }
  async #dropZone(id) {
    const zoneId = this.getPlace(id)?.biomeZone;
    if (zoneId) await this.saveBiomes((c) => { const zones = { ...c.zones }; delete zones[zoneId]; return { ...c, zones }; });
    await this.#save(id, { biomeZone: null });
  }
  /** A territory's Part of, by choice; and where any place sits, worked out from borders and links. */
  #hierarchyRow(p) {
    const places = this.getPlaces?.() ?? [], here = hierarchyOf(p, places, { showHidden: true }), names = (list) => list.map((t) => esc(t.name)).join(", ");
    const rule = ruleTooltip("<p><strong>Domain</strong> The top level: a country or an empire. Nothing is above it.</p><p><strong>Territory</strong> Anything below a domain, at any depth, of any type: a state, a county within it, a region.</p><p><strong>Part of</strong> The domain or territory this one belongs to. Everything inside it then knows the whole chain.</p><p><strong>Automatic</strong> Settlements, sites and natural features work out what they are in from drawn borders. They need no link.</p>");
    const parent = placeLayer(p) === "realms" && p.kind !== "domain" ? `<div class="row"><span>Part of ${rule}</span></div><div class="row"><select name="part-of" aria-label="Part of"><option value="">Nothing above it</option>${partOfChoices(p, places).map((t) => `<option value="${esc(t.id)}" ${t.id === p.partOf ? "selected" : ""}>${esc(t.name)}${t.class ? ` (${esc(t.class)})` : ""}</option>`).join("")}</select></div>` : "";
    const within = here.within.length ? `<p class="hint">Part of: ${names(here.within)}.</p>` : "";
    const crosses = here.crosses.length ? `<p class="hint">Crosses: ${names(here.crosses)}.</p>` : "";
    return parent + within + crosses;
  }

  /** The choice to share an outline instead of drawing a border: for natural features and areas, never forced. */
  #shoreRow(p) {
    const choices = this.getBorderChoices?.(`place:${p.id}`, p.name) ?? [];
    if ((p.kind !== "natural" && p.kind !== "territory" && p.kind !== "domain" && placeLayer(p) === "places") || (!choices.length && !followOf(p))) return "";
    const rule = ruleTooltip("<p><strong>Follow</strong> The place's border is another's: a shoreline, a biome zone or another place. One outline, drawn once, whichever came first. Reshape that one and everything following it moves.</p><p><strong>Its own border</strong> Draw one here. Leaving a shared border keeps a copy to change on its own.</p>");
    const gone = p.shoreGone ? `<p class="hint">The outline it followed has been deleted.</p>` : "";
    return `<div class="row"><span>Border ${rule}</span></div><div class="row">${borderSelect('name="area-shore"', choices, followOf(p) ?? "", esc)}</div>${gone}`;
  }

  /** The Biome row: a closed border on land can drive travel and camps, as a biome zone that follows it. */
  #biomeRow(p, o) {
    // Its shape, layer, type or border changed so it can no longer be one: its zone goes with it.
    if (p.biomeZone && !canBeBiome(p) && this.droppingZone !== p.id) {
      this.droppingZone = p.id;
      queueMicrotask(async () => {
        try { await this.#dropZone(p.id); ui.notifications.info(`KG Realms: the biome zone of ${p.name} was removed: a biome zone needs a land area with a closed border on the Geography layer.`); }
        finally { this.droppingZone = null; }
      });
    }
    if (String(p.followRef ?? "").startsWith("biome:")) return `<p class="hint">Its border comes from a biome zone, so that zone is its biome.</p>`;
    if (placeLayer(p) === "geo" && areaKind(p) === "water" && o?.closed && /^(lake|lagoon|pond|mere|tarn|loch)$/i.test(p.class ?? "")) return `<p class="hint">Weather here is that of the biome around this water.</p>`;
    if (placeLayer(p) !== "geo" || areaKind(p) !== "land" || !this.getBiomes) return "";
    const rule = ruleTooltip("<p><strong>Biome zone</strong> Makes this area count as a biome: travel speed off road, on roads and on trails, and the Forage, Conceal and Alarm DCs for camps.</p><p><strong>Border</strong> The zone follows this place's border as you reshape it, and takes its name.</p><p><strong>Biomes tab</strong> Set its speeds and DCs there. Its corners are this border's: reshape them here.</p><p><strong>When</strong> Journeys already under way keep the settings they left with.</p>");
    if (!p.area || !o?.closed) return `<div class="row"><span>Biome ${rule}</span></div><p class="hint">Draw and close a border to make this area a biome zone.</p>`;
    const config = this.getBiomes(), zone = p.biomeZone ? config.zones?.[p.biomeZone] : null, types = biomeTypes(config);
    if (zone && zone.name !== p.name) queueMicrotask(() => this.saveBiomes((c) => (c.zones?.[p.biomeZone] ? { ...c, zones: { ...c.zones, [p.biomeZone]: { ...c.zones[p.biomeZone], name: p.name } } } : c)));
    const on = zone?.type ?? (this.biomeChoice?.id === p.id ? this.biomeChoice.type : null) ?? biomeForClass(p.class) ?? "plains";
    const pick = `<select name="area-biome" aria-label="Biome type">${Object.entries(types).map(([k, t]) => `<option value="${esc(k)}" ${k === on ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>`;
    return `<div class="row"><span>Biome ${rule}</span></div><div class="row">${pick}${zone ? `<button data-act="biome-drop" class="danger"><i class="fa-solid fa-trash"></i> Remove biome zone</button>` : `<button data-act="biome-make"><i class="fa-solid fa-seedling"></i> Make biome zone</button>`}</div>${zone ? `<p class="hint">This area is a biome zone. It follows the border.</p>` : ""}`;
  }
  /** What the map shows for the selected place's border: the one being drawn, edited, or kept. */
  #overlay() {
    const layer = this.getLayer();
    if (!layer?.setAreaEdit) return;
    if (!this.active) return layer.setAreaEdit(null);
    if (this.drawing) return layer.setAreaEdit(this.hover ? [...this.drawing.pts, this.hover] : this.drawing.pts, false, null);
    if (!this.selected) return layer.setAreaEdit(null);
    const p = this.selected ? this.getPlace(this.selected) : null;
    const o = this.editing ?? (p ? this.#editable(p) : null);
    const label = p && placeShape(p) !== "point" ? { at: [p.lon, p.lat], name: p.name } : null;
    layer.setAreaEdit(o?.pts ?? null, !!o?.closed, this.corner, label);
  }

  /** A new place where the GM clicked, then open it for editing. */
  async #addPlace(g) {
    this.placing = false;
    const [lon, lat] = this.getLayer().fromScreen(...g);
    const id = `added-${foundry.utils.randomID()}`;
    const kind = this.newKind ?? "settlement";
    const CLASS = { settlement: "Town", site: "Site", domain: "Kingdom", territory: "Region", natural: "Feature" };
    this.#remember();
    await this.saveEdits((w) => {
      w.added ??= {};
      w.added[id] = { id, name: "New place", kind, class: CLASS[kind], rank: 4, level: "surface", lon: +lon.toFixed(6), lat: +lat.toFixed(6) };
      return w;
    });
    this.select(id);
    this.openCard?.(id, { edit: true });
  }

  async #save(id, fields) {
    this.#remember();
    await this.saveEdits((w) => {
      if (w.added?.[id]) w.added[id] = { ...w.added[id], ...fields };
      else { w.edits ??= {}; w.edits[id] = { ...(w.edits[id] ?? {}), ...fields }; }
      for (const k of Object.keys(fields)) if (fields[k] === null) { delete w.edits?.[id]?.[k]; delete w.added?.[id]?.[k]; }
      if (w.edits?.[id] && !Object.keys(w.edits[id]).length) delete w.edits[id];
      return w;
    });
  }

  #render() {
    if (!this.active) return;
    if (!this.panel) {
      this.panel = document.createElement("div");
      this.panel.className = this.host ? "kgr-tab kgr-pins" : "kgr-ui kgr-panel kgr-roads kgr-pins";
      (this.host ?? document.body).append(this.panel);
      this.panel.addEventListener("click", (e) => this.#click(e));
      this.panel.addEventListener("change", (e) => this.#change(e));
      // A section opened draws its rows; it stays open (toggle does not bubble: listen as it goes down).
      this.panel.addEventListener("toggle", (e) => {
        const d = e.target, key = d.dataset?.placeOpen;
        if (!key) return;
        const was = this.#open().has(key);
        this.#setOpen(key, d.open);
        if (d.open && !was && !d.querySelector(".kgr-enc-list-row, .kgr-enc-group")) this.#redrawList();
      }, true);
      this.panel.addEventListener("input", (e) => { if (e.target.name === "place-filter") { this.filter = e.target.value; this.#redrawList(); } });
    }
    const p = this.selected ? this.getPlace(this.selected) : null;
    const body = p ? `
      <p class="kgr-sel node"><i class="fa-solid fa-location-dot"></i> <b>${esc(p.name)}</b> (${esc(p.class ?? "place")}). Drag its marker to move it.</p>
      <div class="row"><button data-act="card"><i class="fa-solid fa-id-card"></i> Open its card</button></div>
      ${this.#areaRows(p)}
      <div class="row"><label>Kind <select name="kind">${[["settlement", "Settlement"], ["site", "Site"], ["domain", "Domain"], ["territory", "Territory"], ["natural", "Natural feature"]].map(([v, l]) => `<option value="${v}" ${p.kind === v ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
      <div class="row"><label>Marker</label><button data-act="markers" class="marker-current" title="Choose a marker">${this.#thumb(p.marker ? (p.marker.startsWith("faerun-") ? p.marker : "mk-" + p.marker) : iconFor(p))} Change</button>${p.marker ? `<button data-act="marker-default">Default</button>` : ""}</div>
      ${this.picking ? this.#markerGrid(p) : ""}
      <div class="row">${p.edited && !p.added ? `<button data-act="reset-pos"><i class="fa-solid fa-location-crosshairs"></i> Reset position</button><button data-act="reset" class="danger"><i class="fa-solid fa-rotate-left"></i> Reset all edits</button>` : ""}<button data-act="done">Done</button></div>
      <div class="row"><button data-act="remove-place" class="danger" title="${p.added ? "Delete this place you added" : "Gone from this world: off the map, out of search and journeys. It can be restored below the list of places, with its edits."}"><i class="fa-solid fa-eraser"></i> ${p.added ? "Delete place" : "Remove from the map"}</button></div>`
      : `<p class="hint">Click a place to select it (its kind and map marker show here). Double-click it for its card: name, art, what is known, scene, who sees it.</p>${Object.keys(this.getMarkers()).length ? `<h4 class="kgr-own">Your markers</h4><div class="kgr-own-list">${Object.entries(this.getMarkers()).map(([k, m]) => `<span title="${esc(m.name)}"><img src="${esc(foundry.utils.getRoute(m.src))}" alt=""> ${esc(m.name)}</span>`).join("")}</div><p class="hint">Click a place, then Change, to give it one of these.</p>` : ""}${this.#removedRow()}`;
    const tools = `<div class="row"><button data-act="add-place" class="${this.placing ? "on" : ""}"><i class="fa-solid fa-location-dot"></i> Add place</button><button data-act="add-marker"><i class="fa-solid fa-plus"></i> Add marker</button></div>${this.placing ? `<p class="kgr-sel node"><i class="fa-solid fa-location-crosshairs"></i> Click the map where the new place goes. Kind: <select name="new-kind"><option value="settlement" ${!["site", "domain", "territory", "natural"].includes(this.newKind) ? "selected" : ""}>Settlement</option><option value="site" ${this.newKind === "site" ? "selected" : ""}>Site</option><option value="domain" ${this.newKind === "domain" ? "selected" : ""}>Domain</option><option value="territory" ${this.newKind === "territory" ? "selected" : ""}>Territory</option><option value="natural" ${this.newKind === "natural" ? "selected" : ""}>Natural feature</option></select> Esc cancels.</p>` : ""}${this.adding ? this.#addForm() : ""}`;
    const files = `<div class="kgr-file-row"><button data-act="export" title="Save every place edit and your markers to a file"><i class="fa-solid fa-file-export"></i> Export places</button><button data-act="import" title="Load place edits from a file"><i class="fa-solid fa-file-import"></i> Import places</button></div>`;
    this.panel.innerHTML = `${tools}${body}${this.placing || this.adding ? "" : `<div class="kgr-enc-list kgr-place-list"><span class="cap">On this map (${this.getPlaces().length})</span><input type="search" name="place-filter" placeholder="Find a place" value="${esc(this.filter ?? "")}" aria-label="Find a place"><div class="kgr-place-groups">${this.#list()}</div></div>`}${files}`;
    this.onStatus?.();
  }

  /** Which sections of the list are open (kept on this computer). */
  #open() {
    if (!this.openGroups) { try { this.openGroups = new Set(JSON.parse(localStorage.getItem(OPEN_KEY) ?? "[]")); } catch { this.openGroups = new Set(); } }
    return this.openGroups;
  }
  #setOpen(key, on) {
    const s = this.#open();
    if (on) s.add(key); else s.delete(key);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...s])); } catch { /* storage off */ }
  }

  /** Every place on this map: by kind, then by class, A to Z. A filter opens every match. */
  #list() {
    const q = (this.filter ?? "").trim().toLowerCase(), open = this.#open();
    const places = this.getPlaces().filter((p) => !q || String(p.name ?? "").toLowerCase().includes(q));
    if (!places.length) return `<p class="hint">${q ? "No place by that name." : "No places yet. Add place puts one on the map."}</p>`;
    const known = new Set(KINDS.map(([k]) => k));
    return [...KINDS, ["other", "Other"]].map(([kind, label]) => {
      const list = places.filter((p) => (known.has(p.kind) ? p.kind : "other") === kind);
      if (!list.length) return "";
      const key = `kind:${kind}`, sel = list.some((p) => p.id === this.selected), isOpen = !!q || sel || open.has(key);
      const classes = [...new Set(list.map((p) => p.class || "Unsorted"))].sort((a, b) => a.localeCompare(b));
      const inner = isOpen ? classes.map((c) => {
        const rows = list.filter((p) => (p.class || "Unsorted") === c).sort((a, b) => String(a.name).localeCompare(String(b.name)));
        const gkey = `${kind}|${c}`, gOpen = !!q || rows.some((p) => p.id === this.selected) || open.has(gkey);
        return `<details class="kgr-enc-group" data-place-open="${esc(gkey)}" ${gOpen ? "open" : ""}><summary><span>${esc(c)}</span><small>${rows.length}</small></summary>${gOpen ? rows.map((p) => `<div class="kgr-enc-list-row ${p.id === this.selected ? "on" : ""}"><button type="button" data-act="list-pick" data-id="${esc(p.id)}"><span>${esc(p.name || "Unnamed")}</span>${p.hidden || p.visibility === "hidden" ? "<small>Hidden from players</small>" : ""}</button><button type="button" data-act="list-locate" data-id="${esc(p.id)}" aria-label="Find ${esc(p.name)} on the map" title="Find it on the map"><i class="fa-solid fa-location-crosshairs"></i></button></div>`).join("") : ""}</details>`;
      }).join("") : "";
      return `<details data-place-open="${key}" ${isOpen ? "open" : ""}><summary>${label}<small>${list.length}</small></summary>${inner}</details>`;
    }).join("");
  }

  /** Centre the map on a place. */
  #locate(id) {
    const p = this.getPlace(id), layer = this.getLayer();
    if (!p || !layer?.frame || !Number.isFinite(p.lat)) return;
    layer.showSpot(p.lon, p.lat, 400);
  }

  /** Shape, Layer and the border (map-layers.mjs): which layer the place is on, a point or an area. */
  #areaRows(p) {
    const shape = placeShape(p), layer = placeLayer(p), o = this.#outline(p);
    const seg = (act, list, on) => `<div class="kgr-seg-row">${list.map(([v, l]) => `<button type="button" data-act="${act}" data-v="${v}" class="${v === on ? "on" : ""}" aria-pressed="${v === on}">${l}</button>`).join("")}</div>`;
    const shapeRule = ruleTooltip("<p><strong>Point</strong> A single place on the map: a marker and its name.</p><p><strong>Area</strong> A border that closes, with a light wash of colour inside: a kingdom, a forest, a sea.</p><p><strong>Line</strong> A line with two ends, named along it: a river, a strait, a mountain spine, a border line.</p><p><strong>Default</strong> Its type decides; this changes it for this place only.</p>");
    const layerRule = ruleTooltip("<p><strong>Places</strong> Settlements, sites, peaks: where a party can stand.</p><p><strong>Realms</strong> Kingdoms, empires and regions: who holds the land.</p><p><strong>Geography</strong> Forests, ranges, deserts, seas, lakes and rivers: what the land and water are.</p><p><strong>Showing</strong> The map shows one layer at a time (the layers rail on the travel panel). A place shows only on its own layer.</p>");
    const follow = this.#shoreRow(p);
    const border = p.shoreLine ? `<p class="hint">Its border is shared: ${o?.pts.length ?? 0} corners, ${o?.closed ? "closed" : "ends apart"}. Reshape it in ${borderHome(p.followRef)}.</p>` : shape === "point" ? "" : this.drawing
      ? `<p class="kgr-sel node"><i class="fa-solid fa-draw-polygon"></i> Click the map to add corners. Click the first corner to close the border; Enter or double-click leaves its ends apart. Esc cancels.</p><div class="row"><button data-act="border-finish"><i class="fa-solid fa-check"></i> Finish as a line</button><button data-act="border-cancel">Cancel</button></div>`
      : `<p class="hint">${o ? `${o.pts.length} corners, ${o.closed ? "closed" : "ends apart"}${o.fromRecord ? " (the world's rectangle: draw or reshape it)" : ""}.` : "No border yet: its name shows at its point on its layer."}</p>
        <div class="row"><button data-act="border-draw"><i class="fa-solid fa-draw-polygon"></i> ${o && !o.fromRecord ? "Redraw border" : "Draw border"}</button>${o && !o.fromRecord && shape === "area" ? `<button data-act="border-toggle">${o.closed ? "Open the shape" : "Close the shape"}</button>` : ""}${p.area ? `<button data-act="border-remove" class="danger">Remove border</button>` : ""}</div>`;
    return `<div class="kgr-area-rows">${p.shoreLine ? "" : `<div class="row"><span>Shape ${shapeRule}</span></div>${seg("shape", Object.entries(SHAPES), shape)}`}
      <div class="row"><span>Layer ${layerRule}</span></div>${seg("layer", MAP_LAYERS.map((k) => [k, LAYER_NAMES[k]]), layer ?? "places")}${this.drawing ? "" : this.#hierarchyRow(p)}${this.drawing ? "" : follow}${border}${this.drawing ? "" : this.#biomeRow(p, o)}</div>`;
  }

  /** The places removed from this world (the world has moved on), to bring one back. */
  #removedRow() {
    const gone = (this.getRemoved?.() ?? []).sort((a, b) => a.name.localeCompare(b.name));
    if (!gone.length) return "";
    return `<h4 class="kgr-own">Removed from this world (${gone.length})</h4>
      <div class="row"><select name="restore">${gone.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}${g.class ? ` (${esc(g.class)})` : ""}</option>`).join("")}</select><button data-act="restore-place"><i class="fa-solid fa-trash-arrow-up"></i> Restore</button></div>`;
  }

  /** Only the list, so the filter keeps its place as it is typed. */
  #redrawList() { const box = this.panel?.querySelector(".kgr-place-groups"); if (box) box.innerHTML = this.#list(); }

  async #click(e) {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    const id = this.selected;
    if (act === "shape" || act === "layer") {
      const v = e.target.closest("[data-v]").dataset.v, p = this.getPlace(id);
      if (!p) return;
      if (act === "shape" && v !== "point" && placeLayer(p) === "places") await this.#save(id, { shape: v, layer: "realms" });
      else await this.#save(id, { [act]: v });
      this.#render(); return this.#overlay();
    }
    if (act === "border-draw") { this.drawing = { pts: [] }; this.editing = null; this.#render(); this.#overlay(); return this.onStatus?.(); }
    if (act === "border-finish") return this.#finishBorder(false);
    if (act === "border-cancel") { this.drawing = null; this.#render(); return this.#overlay(); }
    if (act === "border-toggle") { const o = this.#editPts(); if (!o.closed && o.pts.length < 3) return ui.notifications.warn("KG Realms: a closed border needs at least three corners."); return this.#saveOutline(id, o.pts, !o.closed); }
    if (act === "border-remove") { await this.#save(id, { area: null, areaClosed: null }); await this.#followBorder(id, null); this.#render(); return this.#overlay(); }
    if (act === "biome-make") {
      const p = this.getPlace(id), o = this.#outline(p), type = this.panel?.querySelector('[name="area-biome"]')?.value ?? "plains";
      if (!p?.area || !o?.closed) return;
      const zoneId = `bio-${foundry.utils.randomID()}`;
      await this.saveBiomes((c) => ({ ...c, zones: { ...c.zones, [zoneId]: zoneForPlace(p, type, p.area) } }));
      await this.#save(id, { biomeZone: zoneId });
      return this.#render();
    }
    if (act === "biome-drop") { await this.#dropZone(id); return this.#render(); }
    if (act === "list-pick") { const pick = e.target.closest("[data-id]").dataset.id; this.select(pick); return this.#locate(pick); }
    if (act === "list-locate") return this.#locate(e.target.closest("[data-id]").dataset.id);
    if (act === "remove-place") {
      const p = this.getPlace(id);
      if (!p) return;
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: p.added ? "Delete place" : "Remove from the map" }, content: p.added ? `<p>Delete <b>${esc(p.name)}</b>, a place you added?${p.biomeZone ? " Its biome zone is removed too." : ""}</p>` : `<p>Remove <b>${esc(p.name)}</b> from this world? It goes from the map, search and journeys.</p><p class="hint">Restore it any time from the Places tab (Removed from this world), with its edits.</p>${p.biomeZone ? "<p>Its biome zone is removed too.</p>" : ""}`, rejectClose: false });
      if (!ok) return;
      this.selected = null;
      // A place gone from the map stops being a biome. Make it again after restoring the place.
      if (p.biomeZone) await this.#dropZone(id);
      await this.saveEdits((w) => {
        if (w.added?.[id]) { delete w.added[id]; delete w.edits?.[id]; return w; }
        w.edits = { ...(w.edits ?? {}), [id]: { ...(w.edits?.[id] ?? {}), removed: true } };
        return w;
      });
      return this.#render();
    }
    if (act === "restore-place") {
      const pick = this.panel.querySelector('[name="restore"]')?.value;
      if (pick) await this.restorePlace?.(pick);
      return this.#render();
    }
    if (act === "close") return this.onClose?.() ?? this.close();
    if (act === "done") return this.select(null);
    if (act === "card") return this.openCard?.(id);
    if (act === "markers") { this.picking = !this.picking; return this.#render(); }
    if (act === "delete-marker") {
      const key = e.target.closest("[data-marker]").dataset.marker;
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Delete marker" }, content: `<p>Delete the marker <b>${esc(this.getMarkers()[key]?.name)}</b>? Places using it go back to their default marker.</p>`, rejectClose: false });
      if (!ok) return;
      await this.saveMarkers((m) => { const c = { ...m }; delete c[key]; return c; });
      return this.#render();
    }
    if (act === "pick-marker") { this.picking = false; await this.#save(id, { marker: e.target.closest("[data-marker]").dataset.marker }); return this.#render(); }
    if (act === "marker-default") { await this.#save(id, { marker: null }); return this.#render(); }
    if (act === "add-marker") { this.adding = !this.adding; return this.#render(); }
    if (act === "add-place") { this.placing = !this.placing; this.selected = null; return this.#render(); }
    if (act === "add-browse") {
      const input = this.panel.querySelector('[name="new-src"]');
      return new foundry.applications.apps.FilePicker.implementation({ type: "image", current: input.value, callback: (path) => { input.value = path; } }).render(true);
    }
    if (act === "add-save") {
      const name = this.panel.querySelector('[name="new-name"]').value.trim(), src = this.panel.querySelector('[name="new-src"]').value.trim();
      if (!name || !src) return ui.notifications.warn("KG Realms: a new marker needs a name and an image.");
      const key = `custom-${foundry.utils.randomID(8)}`;
      await this.saveMarkers((m) => ({ ...m, [key]: { name, src } }));
      this.adding = false;
      if (id) await this.#save(id, { marker: key });
      ui.notifications.info(id ? `KG Realms: marker "${name}" added and given to ${this.getPlace(id)?.name}.` : `KG Realms: marker "${name}" added. Click a place, then Change, to use it (under Your markers).`);
      return this.#render();
    }
    if (act === "export") return this.exportPlaces?.();
    if (act === "import") return this.importPlaces?.();
    if (act === "reset-pos") { await this.#save(id, { lon: null, lat: null }); return this.#render(); }
    if (act === "reset") {
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Reset place" }, content: "<p>Remove every edit to this place (name, position, description, image, links)?</p>", rejectClose: false });
      if (!ok) return;
      this.#remember();
      await this.saveEdits((w) => { delete w.edits?.[id]; return w; });
      return this.#render();
    }
  }

  async #change(e) {
    const t = e.target, id = this.selected;
    if (t.name === "new-kind") { this.newKind = t.value; return; }
    if (!id || !t.name) return;
    if (t.name === "kind") await this.#save(id, { kind: t.value, kindChosen: true });
    if (t.name === "part-of") { await this.#save(id, { partOf: t.value || null }); return this.#render(); }
    if (t.name === "area-shore") {
      const p = this.getPlace(id);
      if (!p) return;
      if (t.value && p.area && !p.shoreLine) {
        const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Share a border" }, content: `<p>Replace the border of <b>${esc(p.name)}</b> with the one chosen? Ctrl+Z undoes this.</p>`, rejectClose: false });
        if (!ok) { t.value = ""; return; }
      }
      // Leaving a shoreline keeps a copy of its outline as the place's own.
      await this.#save(id, t.value ? { follow: t.value, shore: null, area: null, areaClosed: null, shape: null } : { follow: null, shore: null, ...(p.shoreLine ? { area: p.area.map((c) => [...c]), areaClosed: !!p.areaClosed, shape: p.shape } : {}) });
      const now = this.getPlace(id);
      await this.#followBorder(id, canBeBiome(now) ? now.area : null);
      this.#render(); return this.#overlay();
    }
    if (t.name === "area-biome") {
      const zoneId = this.getPlace(id)?.biomeZone;
      this.biomeChoice = { id, type: t.value };
      if (zoneId) await this.saveBiomes((c) => (c.zones?.[zoneId] ? { ...c, zones: { ...c.zones, [zoneId]: { ...c.zones[zoneId], type: t.value } } } : c));
    }
  }

  #thumb(icon) {
    if (!icon) return '<span class="kgr-thumb none"></span>';
    if (icon.startsWith("faerun-")) return `<span class="kgr-thumb key">${esc(KEY.find(([k]) => k === icon)?.[1] ?? "")}</span>`;
    const key = icon.slice(3), own = this.getMarkers()[key];
    return `<img class="kgr-thumb" src="${esc(own ? foundry.utils.getRoute(own.src) : foundry.utils.getRoute(`modules/kg-realms/data/markers/${key}.png`))}" alt="">`;
  }

  #markerGrid(p) {
    const cell = (marker, label, inner, del = false) => `<button class="kgr-marker ${p.marker === marker ? "on" : ""}" data-act="pick-marker" data-marker="${esc(marker)}" title="${esc(label)}">${inner}${del ? `<i class="fa-solid fa-xmark del" data-act="delete-marker"></i>` : ""}</button>`;
    const own = Object.entries(this.getMarkers());
    const groups = {};
    for (const m of this.catalog ?? []) (groups[m.group] ??= []).push(m);
    return `<div class="kgr-markers">
      <h4>Map key</h4><div class="grid">${KEY.map(([k, label]) => cell(k, label, `<span class="kgr-thumb key">${label}</span>`)).join("")}</div>
      ${own.length ? `<h4>Your markers</h4><div class="grid">${own.map(([k, m]) => cell(k, m.name, `<img src="${esc(foundry.utils.getRoute(m.src))}" alt="">`, true)).join("")}</div>` : ""}
      ${Object.entries(groups).map(([g, list]) => `<h4>${esc(g)}</h4><div class="grid">${list.map((m) => cell(m.id, m.name, `<img src="${esc(foundry.utils.getRoute(`modules/kg-realms/data/markers/${m.file}`))}" alt="">`)).join("")}</div>`).join("")}
    </div>`;
  }

  #addForm() {
    return `<div class="kgr-add"><div class="row"><label>Name <input type="text" name="new-name" placeholder="Harbour, Ruin, Shrine..."></label></div>
      <div class="row"><label>Image <input type="text" name="new-src" placeholder="Path to a PNG or WebP"></label><button data-act="add-browse"><i class="fa-solid fa-file-image"></i></button></div>
      <p class="hint">A contrasting outline is added automatically.${this.selected ? " The selected place takes the new marker." : ""}</p>
      <div class="row"><button data-act="add-save"><i class="fa-solid fa-check"></i> Add marker</button></div></div>`;
  }

  refresh() {
    if (!this.active) return;
    const p = this.selected ? this.getPlace(this.selected) : null;
    if (this.selected && !p) { this.selected = null; this.drawing = null; this.editing = null; this.corner = null; this.cornerDrag = null; }
    // A new type can put it on another layer (a new Lake starts as a Region): the map goes with it.
    if (p && (placeLayer(p) ?? "places") !== this.selectedLayer) { this.selectedLayer = placeLayer(p) ?? "places"; this.showLayer?.(this.selectedLayer); }
    this.#render(); this.#overlay();
  }

  /** The camera moved: nothing in the panel follows it any more. */
  refreshView() {}
}
