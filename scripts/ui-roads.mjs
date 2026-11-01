// The GM's road editor. Click a road or trail to select it and show its nodes; drag a node
// to move it, click the line to add a node, right-click a node to remove it. "New road" and
// "New trail" draw a route click by click, snapping to places and to other routes' nodes;
// double-click, right-click or Enter finishes (a right-drag pans the map and keeps drawing). Export
// and import the whole network as GeoJSON.
//
// Pointer events are heard before Foundry's own (canvas-input.mjs), and taken only when the editor
// acts on them; panning and everything else pass through.

import { latLonToScene } from "./geo.mjs";
import { onCanvas, RightClick } from "./canvas-input.mjs";
import {EditorFrame} from './editor-frame.mjs';
import { nearestOnLine, lineMiles, editsBetween, simplifyLine, smoothLine, joinLines, ROUTE_KINDS } from "./routes.mjs";
import { lonLatToSource, sourceToLonLat, SOURCE_MAP } from "./source-map.mjs";
import { RIVER_HAZARDS, isRiverHazard, isHazard, hazardSubtype, hazardDefaults, normalizeEncounter, encounterFile, readEncounterFile } from "./river-hazards.mjs";

/** How far (sheet px) a node may lie from the simplified line: about half a mile. */
const SIMPLIFY_PX = 1.5;

const HIT_PX = 9, SNAP_PX = 12;
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

export class RoadEditor {
  /**
   * getLayer(): the RealmLayer; getRoutes(): the routes with edits applied; getBase(): the shipped
   * routes; getPlaces(): places with edits; getEdits(): this world's route edits; saveEdits(fn):
   * replace them with fn(edits).
   */
  constructor(options) {
    Object.assign(this, options);
    this.active = false;
    this.selected = null;   // route id
    this.coords = null;     // working coordinates of the selected route or the draft
    this.draft = null;      // { kind, from, to } while drawing a new route
    this.drag = null;       // node index being dragged
    this.node = null;       // selected node index (Delete removes it)
    this.undo = [];         // earlier route edits, newest last (Ctrl+Z)
    this.encounter = null;  // selected encounter id
    this.placing = false;   // next click places an encounter
    this.hover = null;      // cursor [lon, lat] while drawing
    this.panel = null;
    this.right = new RightClick();
    this.previewFrame = new EditorFrame(() => this.#draw());
    this.handlers = {
      pointerdown: (e) => this.#down(e), pointermove: (e) => this.#move(e), pointerup: (e) => this.#up(e),
      dblclick: (e) => this.#dbl(e), contextmenu: (e) => { if (this.active) e.preventDefault(); }
    };
    this.onKey = (e) => this.#key(e);
  }

  toggle(on = !this.active) { on ? this.open() : this.close(); }

  /** What the editing bar says on this tab now: a click's effect, Esc's, and a note at the pointer. */
  status() {
    if (this.joining) return { hint: "Click the road or trail to join onto this one", esc: "cancels joining", tip: "Click a road to join it", crosshair: true };
    if (this.draft) return { hint: `Drawing a new ${this.draft.kind} · click to add nodes · Enter or double-click finishes`, esc: `cancels the new ${this.draft.kind}`, tip: "Click to add a node · Enter finishes", crosshair: true };
    if (this.placing) return { hint: RIVER_HAZARDS[this.placingKind]?`Click a river to place ${RIVER_HAZARDS[this.placingKind].toLowerCase()}`:"Click the map to place it; it snaps onto a road nearby", esc: "cancels placing", tip: "Click to place the encounter", crosshair: true };
    if (this.encounter) {
      const e = this.getEncounters()[this.encounter];
      return { hint: `${e?.name ?? "Encounter"} · Del deletes it`, esc: "lets go of it", tip: "" };
    }
    const f = this.selected ? this.getRoutes().features.find((x) => x.properties.id === this.selected) : null;
    if (f) {
      const name = f.properties.name || `Unnamed ${f.properties.kind ?? "road"}`;
      return this.node !== null
        ? { hint: `${name} · node ${this.node + 1} of ${this.coords?.length ?? 0}`, esc: "lets go of the node", tip: "Drag to move · Del removes this node · click the line to add one" }
        : { hint: `${name} · drag a node · click the line to add one`, esc: "lets go of the road", tip: "Click a node to select it · click the line to add one" };
    }
    return this.focus === "encounters"
      ? { hint: "Click an encounter to edit it, or New encounter to place one", esc: "leaves editing", tip: "" }
      : { hint: "Click a road or trail to edit it, or draw a new one", esc: "leaves editing", tip: "" };
  }

  /** Every change goes through here, so Ctrl+Z can step back. */
  async #commit(fn) {
    this.undo.push(foundry.utils.deepClone(this.getEdits()));
    if (this.undo.length > 50) this.undo.shift();
    await this.saveEdits(fn);
  }

  /** An encounter change, remembered for Ctrl+Z like the road edits. */
  async #commitEnc(fn) {
    this.undo.push({ encounters: foundry.utils.deepClone(this.getEncounters?.() ?? {}) });
    if (this.undo.length > 50) this.undo.shift();
    await this.saveEncounters(fn);
  }

  async #undo() {
    const prev = this.undo.pop();
    if (!prev) return ui.notifications.info("KG Realms: nothing to undo.");
    if (prev.encounters) {
      await this.saveEncounters(() => prev.encounters);
      if (this.encounter && !prev.encounters[this.encounter]) this.encounter = null;
      return this.#render();
    }
    await this.saveEdits(() => prev);
    this.node = null;
    this.refresh();
  }

  open() {
    if (this.active || !game.user.isGM || !this.getLayer()?.frame) return;
    this.active = true;
    this.offCanvas = onCanvas(this.handlers);
    window.addEventListener("keydown", this.onKey, { capture: true });
    this.#render();
  }

  close() {
    if (!this.active) return;
    this.previewFrame.clear();
    this.active = false;
    this.offCanvas?.(); this.offCanvas = null;
    window.removeEventListener("keydown", this.onKey, { capture: true });
    this.selected = this.coords = this.draft = this.drag = this.hover = this.encounter = null;
    this.placing = false;
    this.moreOpen = false;
    this.getLayer()?.setRouteEdit(null, null);
    this.panel?.remove();
    this.panel = null;
  }

  /* ------------------------------------------------------------------ geometry */

  #global(e) {
    const r = canvas.app.view.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  #screen(coords) {
    const layer = this.getLayer();
    return coords.map(([lon, lat]) => layer.toScreen(lon, lat));
  }

  /** The route under a screen point: { id, hit } or null. */
  #routeAt(g) {
    let best = null;
    for (const f of this.getRoutes().features) {
      const hit = nearestOnLine(this.#screen(f.geometry.coordinates), g);
      if (hit && hit.distance < HIT_PX && (!best || hit.distance < best.hit.distance)) best = { id: f.properties.id, hit };
    }
    return best;
  }

  #nodeAt(g) {
    if (!this.coords) return -1;
    const pts = this.#screen(this.coords);
    let bi = -1, bd = HIT_PX;
    pts.forEach((p, i) => { const d = Math.hypot(p[0] - g[0], p[1] - g[1]); if (d < bd) { bd = d; bi = i; } });
    return bi;
  }

  /** A screen point as [lon, lat], snapped to a place or another route's node close by. */
  #snap(g, skipIndex = -1) {
    const layer = this.getLayer();
    let best = null, bd = SNAP_PX;
    for (const p of this.getPlaces()) {
      if (p.hidden || p.kind === "natural") continue;
      const s = layer.toScreen(p.lon, p.lat), d = Math.hypot(s[0] - g[0], s[1] - g[1]);
      if (d < bd) { bd = d; best = { at: [p.lon, p.lat], place: p.id }; }
    }
    if (!best) for (const f of this.getRoutes().features) {
      if (f.properties.id === this.selected) continue;
      for (const c of f.geometry.coordinates) {
        const s = layer.toScreen(...c), d = Math.hypot(s[0] - g[0], s[1] - g[1]);
        if (d < bd) { bd = d; best = { at: [...c], place: null }; }
      }
    }
    if (!best && this.coords) this.coords.forEach((c, i) => {
      if (i === skipIndex) return;
      const s = layer.toScreen(...c), d = Math.hypot(s[0] - g[0], s[1] - g[1]);
      if (d < bd * 0.5) { bd = d; best = { at: [...c], place: null }; }
    });
    return best ?? { at: layer.fromScreen(...g), place: null };
  }

  /* ------------------------------------------------------------------ events */

  #stop(e) { e.preventDefault(); e.stopImmediatePropagation(); }

  #down(e) {
    if (!this.active) return;
    const g = this.#global(e);
    // Right-click finishes a road or removes a node; a right-drag pans the map (Foundry's) and keeps drawing.
    if (e.button === 2) {
      if (this.draft) return this.right.down(e, () => this.#finish());
      const i = this.#nodeAt(g);
      if (i >= 0) this.right.down(e, () => this.#removeNode(i));
      return;
    }
    if (this.draft) {
      this.#stop(e);
      if (e.button !== 0) return;
      const s = this.#snap(g);
      if (!this.coords.length) this.draft.from = s.place;
      this.draft.to = s.place;
      this.coords.push(s.at);
      return this.#draw();
    }
    if (e.button !== 0) return;
    if (this.placing) { this.#stop(e); return this.#placeEncounter(g); }
    // The Encounters tab picks encounters and nothing else; the Roads tab leaves encounters alone.
    if (this.focus === "encounters") {
      const enc = this.#encounterAt(g);
      if (enc) { this.#stop(e); return this.selectEncounter(enc); }
      if (this.encounter) { this.encounter = null; this.#render(); }
      return;
    }
    if (this.joining) {
      this.#stop(e);
      const other = this.#routeAt(g);
      if (!other || other.id === this.selected) return ui.notifications.info("KG Realms: click another road or trail to join it to this one. Esc cancels.");
      return this.#join(other.id);
    }
    if (this.selected) {
      const i = this.#nodeAt(g);
      if (i >= 0) { this.#stop(e); this.drag = i; this.dragChanged = false; this.node = i; this.#draw(); this.#render(); return; }
      const hit = nearestOnLine(this.#screen(this.coords), g);
      if (hit && hit.distance < HIT_PX) {
        this.#stop(e);
        this.coords.splice(hit.index + 1, 0, this.getLayer().fromScreen(...hit.point));
        this.drag = hit.index + 1;
        this.dragChanged = true;
        this.node = hit.index + 1;
        this.#render();
        return this.#draw();
      }
    }
    const route = this.#routeAt(g);
    if (route) { this.#stop(e); return this.select(route.id); }
    if (this.selected) this.select(null);
  }

  #move(e) {
    if (!this.active) return;
    const g = this.#global(e);
    if (this.drag !== null) {
      this.#stop(e);
      const next = this.#snap(g, this.drag).at, previous = this.coords[this.drag];
      this.dragChanged ||= next[0] !== previous[0] || next[1] !== previous[1];
      this.coords[this.drag] = next;
      return this.previewFrame.schedule();
    }
    if (this.draft) { this.hover = this.#snap(g).at; this.previewFrame.schedule(); }
  }

  async #up(e) {
    if (!this.active) return;
    if (e.button === 2) return this.right.up(e);
    if (this.drag === null) return;
    this.#stop(e);
    this.drag = null;
    this.previewFrame.flush();
    if (this.dragChanged) { this.dragChanged = false; await this.#save(); }
  }

  #dbl(e) {
    if (!this.active || !this.draft) return;
    this.#stop(e);
    // The double-click's second press added a duplicate node.
    if (this.coords.length > 1) {
      const [a, b] = this.coords.slice(-2);
      if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) this.coords.pop();
    }
    this.#finish();
  }

  #key(e) {
    if (!this.active || e.target?.closest?.("input, textarea, select")) return;
    // Esc steps back one level: stop joining, drawing or placing; then let go of the node, then of the road
    // or encounter; then leave the editor.
    if (e.key === "Escape") {
      this.#stop(e);
      if (this.joining) { this.joining = false; return this.#render(); }
      if (this.draft) return this.#cancelDraft();
      if (this.placing) { this.placing = false; return this.#render(); }
      if (this.node !== null && this.selected) { this.node = null; this.#draw(); return this.#render(); }
      if (this.selected || this.encounter) return this.select(null);
      return this.onLeave?.();
    }
    else if ((e.key === "Delete" || e.key === "Backspace") && this.encounter) { this.#stop(e); this.#deleteEncounter(); }
    else if (e.key === "Enter" && this.draft) { this.#stop(e); this.#finish(); }
    // Delete removes the selected node only. Whole routes are deleted from the panel, with a confirmation.
    else if ((e.key === "Delete" || e.key === "Backspace") && this.selected && !this.draft) {
      this.#stop(e);
      if (this.node !== null) this.#removeNode(this.node);
      else ui.notifications.info("KG Realms: no node selected. Click a node first (it turns blue). To delete the whole route, use Delete route in the panel.");
    }
    else if (e.code === "KeyZ" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !this.draft) { this.#stop(e); this.#undo(); }
  }

  /* ------------------------------------------------------------------ edits */

  select(id) {
    this.draft = null;
    this.node = null;
    this.encounter = null;
    this.placing = false;
    this.joining = false;
    this.selected = id;
    const f = id ? this.getRoutes().features.find((x) => x.properties.id === id) : null;
    this.coords = f ? f.geometry.coordinates.map((c) => [...c]) : null;
    this.#draw();
    this.#render();
  }

  startDraft(kind) {
    this.selected = null;
    this.draft = { kind, from: null, to: null };
    this.coords = [];
    this.hover = null;
    this.#draw();
    this.#render();
  }

  #cancelDraft() {
    this.draft = null; this.coords = null; this.hover = null;
    this.#draw(); this.#render();
  }

  async #finish() {
    const d = this.draft;
    if (!d) return;
    if (this.coords.length < 2) return this.#cancelDraft();
    const id = `route-added-${foundry.utils.randomID()}`;
    const coordinates = this.coords;
    this.draft = null; this.hover = null;
    await this.#commit((w) => { w.added ??= {}; w.added[id] = { kind: d.kind, name: null, coordinates, ...(d.from ? { from: d.from } : {}), ...(d.to ? { to: d.to } : {}) }; return w; });
    this.select(id);
  }

  #removeNode(i) {
    if (!this.coords || this.coords.length <= 2) return ui.notifications.warn("KG Realms: a route needs at least two nodes. Delete the route instead.");
    this.coords.splice(i, 1);
    this.node = null;
    this.#draw();
    this.#render();
    this.#save();
  }

  async #save(fields = {}) {
    const id = this.selected;
    if (!id) return;
    const current = this.getRoutes().features.find((x) => x.properties.id === id);
    const props = { kind: current?.properties.kind ?? "road", name: current?.properties.name ?? null, ...fields };
    const coordinates = this.coords;
    await this.#commit((w) => {
      if (w.added?.[id]) w.added[id] = { ...w.added[id], ...props, coordinates };
      else { w.edited ??= {}; w.edited[id] = { ...props, coordinates }; }
      return w;
    });
    this.#render();
  }

  /**
   * Nodes that must stay put when simplifying: where other routes meet this one (shared nodes,
   * or another route's end on this line) and at places.
   */
  #anchors(id, coords, index = this.#junctions()) {
    const pts = coords.map((c) => lonLatToSource(...c)), keep = new Set();
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), box = [Math.min(...xs) - 3, Math.min(...ys) - 3, Math.max(...xs) + 3, Math.max(...ys) + 3];
    const nearestIdx = (q, lim) => { if (q[0] < box[0] || q[1] < box[1] || q[0] > box[2] || q[1] > box[3]) return -1; let bi = -1, bd = lim; pts.forEach((p, i) => { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d < bd) { bd = d; bi = i; } }); return bi; };
    for (const e of index.ends) if (e.id !== id) { const i = nearestIdx(e.at, 3); if (i >= 0) keep.add(i); }
    coords.forEach((x, i) => { const ids = index.shared.get(`${x[0].toFixed(7)},${x[1].toFixed(7)}`); if (ids && [...ids].some((o) => o !== id)) keep.add(i); });
    for (const q of index.places) { const i = nearestIdx(q, 1); if (i >= 0) keep.add(i); }
    return [...keep];
  }

  /** Every route's ends, every node by position (which routes use it), and the places. */
  #junctions() {
    const ends = [], shared = new Map();
    for (const f of this.getRoutes().features) {
      const id = f.properties.id, c = f.geometry.coordinates;
      ends.push({ id, at: lonLatToSource(...c[0]) }, { id, at: lonLatToSource(...c.at(-1)) });
      for (const x of c) { const k = `${x[0].toFixed(7)},${x[1].toFixed(7)}`; if (!shared.has(k)) shared.set(k, new Set()); shared.get(k).add(id); }
    }
    const places = this.getPlaces().filter((p) => !p.hidden && p.kind !== "natural").map((p) => lonLatToSource(p.lon, p.lat));
    return { ends, shared, places };
  }
  async #simplify() {
    if (!this.coords) return;
    const before = this.coords.length;
    this.coords = simplifyLine(this.coords, lonLatToSource, SIMPLIFY_PX, this.#anchors(this.selected, this.coords));
    this.node = null;
    this.#draw();
    await this.#save();
    ui.notifications.info(`KG Realms: ${before} nodes down to ${this.coords.length}.`);
  }

  async #simplifyAll() {
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Simplify every road" }, content: "<p>Take out the excess nodes on every road and trail? Junctions and places stay put, and the roads draw as curves through what is left. Ctrl+Z undoes it.</p>", rejectClose: false });
    if (!ok) return;
    const routes = this.getRoutes().features, index = this.#junctions();
    let before = 0, after = 0;
    const out = routes.map((f) => {
      const c = f.geometry.coordinates, s = simplifyLine(c, lonLatToSource, SIMPLIFY_PX, this.#anchors(f.properties.id, c, index));
      before += c.length; after += s.length;
      return { f, s, changed: s.length !== c.length };
    });
    await this.#commit((w) => {
      for (const { f, s, changed } of out) {
        if (!changed) continue;
        const id = f.properties.id, props = { kind: f.properties.kind ?? "road", name: f.properties.name ?? null };
        if (w.added?.[id]) w.added[id] = { ...w.added[id], coordinates: s };
        else { w.edited ??= {}; w.edited[id] = { ...(w.edited[id] ?? props), ...props, coordinates: s }; }
      }
      return w;
    });
    this.select(this.selected);
    ui.notifications.info(`KG Realms: ${before.toLocaleString()} nodes down to ${after.toLocaleString()}.`);
  }

  /** Join another road to the selected one, end to end: one road, the selected one's name and kind. */
  async #join(otherId) {
    const id = this.selected, routes = this.getRoutes().features;
    const me = routes.find((x) => x.properties.id === id), other = routes.find((x) => x.properties.id === otherId);
    if (!me || !other) return;
    const j = joinLines(this.coords, other.geometry.coordinates, lonLatToSource);
    const miles = j.gap * SOURCE_MAP.milesPerPixel;
    if (miles > 3) {
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Join roads" }, content: `<p>The nearest ends are ${miles.toFixed(1)} miles apart. Join them with a straight piece of road?</p>`, rejectClose: false });
      if (!ok) return;
    }
    this.joining = false;
    const name = me.properties.name ?? other.properties.name ?? null, kind = me.properties.kind ?? "road";
    this.coords = j.coordinates;
    await this.#commit((w) => {
      if (w.added?.[id]) w.added[id] = { ...w.added[id], name, kind, coordinates: j.coordinates };
      else { w.edited ??= {}; w.edited[id] = { kind, name, coordinates: j.coordinates }; }
      if (w.added?.[otherId]) { w.trash = { ...(w.trash ?? {}), [otherId]: w.added[otherId] }; delete w.added[otherId]; }
      else { delete w.edited?.[otherId]; w.deleted = [...new Set([...(w.deleted ?? []), otherId])]; }
      return w;
    });
    this.select(id);
    ui.notifications.info(`KG Realms: joined into one ${kind}${name ? `, ${name}` : ""}.`);
  }

  async #deleteRoute() {
    const id = this.selected;
    if (!id) return;
    const f = this.getRoutes().features.find((x) => x.properties.id === id);
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Delete route" }, content: `<p>Delete the whole ${esc(f?.properties.kind ?? "route")}${f?.properties.name ? ` <b>${esc(f.properties.name)}</b>` : ""}? It can be restored from the editor's Restore list.</p>`, rejectClose: false });
    if (!ok) return;
    this.select(null);
    await this.#commit((w) => {
      if (w.added?.[id]) { w.trash = { ...(w.trash ?? {}), [id]: w.added[id] }; delete w.added[id]; }
      else { delete w.edited?.[id]; w.deleted = [...new Set([...(w.deleted ?? []), id])]; }
      return w;
    });
  }

  async #reset() {
    const id = this.selected;
    await this.#commit((w) => { delete w.edited?.[id]; return w; });
    this.select(id);
  }

  /** Routes deleted in this world: shipped ones and the GM's own. */
  #deletedList() {
    const e = this.getEdits(), base = this.getBase();
    const shipped = (e.deleted ?? []).map((id) => ({ id, f: base.features.find((x) => x.properties.id === id) })).filter((x) => x.f).map(({ id, f }) => ({ id, label: f.properties.name ?? `${f.properties.kind} ${id.replace("route-", "#")}` }));
    const own = Object.entries(e.trash ?? {}).map(([id, a]) => ({ id, label: a.name ?? `new ${a.kind}` }));
    return [...shipped, ...own];
  }

  async #restore(id) {
    await this.#commit((w) => {
      if (w.trash?.[id]) { w.added = { ...(w.added ?? {}), [id]: w.trash[id] }; delete w.trash[id]; }
      w.deleted = (w.deleted ?? []).filter((x) => x !== id);
      return w;
    });
    this.select(id);
  }

  /* ------------------------------------------------------------------ encounters */

  #encounterAt(g) {
    const layer = this.getLayer();
    let best = null, bd = 12;
    for (const [id, e] of Object.entries(this.getEncounters?.() ?? {})) {
      const s = layer.toScreen(e.lon, e.lat), d = Math.hypot(s[0] - g[0], s[1] - g[1]);
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }

  selectEncounter(id) {
    this.selected = null; this.coords = null; this.draft = null; this.node = null; this.placing = false;
    this.encounter = id;
    this.#draw(); this.#render();
  }

  async #placeEncounter(g) {
    // Snap onto the nearest route close by, so it sits on the way.
    let at = this.getLayer().fromScreen(...g);
    const hit = this.#routeAt(g);
    if (hit) at = this.getLayer().fromScreen(...hit.hit.point);
    let river=null;
    if(RIVER_HAZARDS[this.placingKind]){
      const choices=Object.entries(this.getWaterways?.()??{}).filter(([,w])=>w.kind==="river"&&w.pts?.length>1).map(([id,w])=>({id,hit:nearestOnLine(this.#screen(w.pts),g)})).filter(q=>q.hit&&q.hit.distance<30).sort((a,b)=>a.hit.distance-b.hit.distance);
      if(!choices.length)return ui.notifications.warn("KG Realms: click near a river drawn in Waterways to place this hazard.");
      river=choices[0].id;at=this.getLayer().fromScreen(...choices[0].hit.point);
    }
    const id = `enc-${foundry.utils.randomID()}`;
    this.placing = false;
    await this.#commitEnc((w) => ({ ...w, [id]: { lon: at[0], lat: at[1], ...(river?{...hazardDefaults(this.placingKind),river}:{name:"Encounter",dc:13,radius:3,notes:""}) } }));
    this.selectEncounter(id);
  }

  async #saveEncounter(fields) {
    const id = this.encounter;
    await this.#commitEnc((w) => w[id]?({ ...w, [id]: { ...normalizeEncounter(w[id]), ...fields } }):w);
    this.#render();
  }

  async #deleteEncounter() {
    const id = this.encounter, e = this.getEncounters()[id];
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Delete encounter" }, content: `<p>Delete the encounter <b>${esc(e?.name)}</b>?</p>`, rejectClose: false });
    if (!ok) return;
    this.encounter = null;
    await this.#commitEnc((w) => { const c = { ...w }; delete c[id]; return c; });
    this.#render();
  }

  /**
   * Every road and trail on this map (0.75): a section for each kind, named ones A to Z, the
   * unnamed stretches together in their own group. Click one to select it and centre the map on it.
   */
  #roadList() {
    const all = this.getRoutes().features ?? [];
    if (!all.length) return "";
    this.encOpen ??= new Set(["kind:hazard", "kind:encounter"]);
    const placeName = (id) => this.getPlaces().find((p) => p.id === id)?.name;
    const row = (f) => {
      const id = f.properties.id, ends = [f.properties.from, f.properties.to].map(placeName).filter(Boolean);
      const miles = lineMiles(f.geometry.coordinates, lonLatToSource, SOURCE_MAP.milesPerPixel);
      return `<div class="kgr-enc-list-row ${id === this.selected ? "on" : ""}"><button type="button" data-act="road-pick" data-id="${esc(id)}"><span>${esc(f.properties.name || `Unnamed ${(ROUTE_KINDS[f.properties.kind] ?? "road").toLowerCase()}`)}</span><small>${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi${ends.length ? ` · ${esc(ends.join(" to "))}` : ""}</small></button><button type="button" data-act="road-locate" data-id="${esc(id)}" aria-label="Find it on the map" title="Find it on the map"><i class="fa-solid fa-location-crosshairs"></i></button></div>`;
    };
    const kinds = [...Object.keys(ROUTE_KINDS), ...new Set(all.map((f) => f.properties.kind).filter((k) => k && !(k in ROUTE_KINDS)))];
    return `<div class="kgr-enc-list"><span class="cap">On this map (${all.length})</span>${kinds.map((kind) => {
      const list = all.filter((f) => (f.properties.kind ?? "road") === kind);
      if (!list.length) return "";
      const key = `road:${kind}`, sel = list.some((f) => f.properties.id === this.selected), open = sel || this.encOpen.has(key);
      const named = list.filter((f) => f.properties.name).sort((a, b) => a.properties.name.localeCompare(b.properties.name)), unnamed = list.filter((f) => !f.properties.name);
      const ukey = `road:${kind}|unnamed`, uOpen = unnamed.some((f) => f.properties.id === this.selected) || this.encOpen.has(ukey);
      const label = { road: "Roads", trail: "Trails" }[kind] ?? (ROUTE_KINDS[kind] ?? kind);
      return `<details data-enc-open="${key}" ${open ? "open" : ""}><summary>${esc(label)}<small>${list.length}</small></summary>${open ? named.map(row).join("") + (unnamed.length ? `<details class="kgr-enc-group" data-enc-open="${ukey}" ${uOpen ? "open" : ""}><summary><span>Unnamed</span><small>${unnamed.length}</small></summary>${uOpen ? unnamed.map(row).join("") : ""}</details>` : "") : ""}</details>`;
    }).join("")}</div>`;
  }

  /** Centre the map on a road's middle. */
  #locateRoad(id) {
    const f = this.getRoutes().features.find((x) => x.properties.id === id), layer = this.getLayer();
    if (!f || !layer?.frame) return;
    const c = f.geometry.coordinates[Math.floor(f.geometry.coordinates.length / 2)];
    canvas.animatePan?.({ ...latLonToScene(layer.frame, c[1], c[0]), duration: 400 });
  }

  encounterList() {
    const all=Object.entries(this.getEncounters?.()??{});this.encOpen??=new Set(["kind:hazard","kind:encounter"]);
    if(!all.length)return '<p class="hint">No encounters placed yet.</p>';
    return `<div class="kgr-enc-list"><span class="cap">On this map (${all.length})</span>${["encounter","hazard"].map(kind=>{
      const entries=all.filter(([,e])=>(isHazard(e)?"hazard":"encounter")===kind);if(!entries.length)return "";
      const selected=entries.some(([id])=>id===this.encounter),key=`kind:${kind}`;
      const groups=[...new Set(entries.map(([,e])=>String(e.group??"").trim()))].sort((a,b)=>a.localeCompare(b));
      return `<details data-enc-open="${key}" ${this.encOpen.has(key)||selected?"open":""}><summary>${kind==="hazard"?"Hazards":"Encounters"}<small>${entries.length}</small></summary>${groups.map(group=>{
        const rows=entries.filter(([,e])=>String(e.group??"").trim()===group).sort((a,b)=>(a[1].name??"").localeCompare(b[1].name??"")),gkey=`${kind}|${group}`;
        return `<details class="kgr-enc-group" data-enc-open="${esc(gkey)}" ${this.encOpen.has(gkey)||rows.some(([id])=>id===this.encounter)||!group?"open":""}><summary><span>${esc(group||"Ungrouped")}</span><small>${rows.length}</small>${group?`<button type="button" data-act="enc-group-rename" data-group="${esc(group)}" aria-label="Rename group"><i class="fa-solid fa-pen"></i></button>`:""}</summary>${rows.map(([id,e])=>`<div class="kgr-enc-list-row ${id===this.encounter?"on":""}"><button type="button" data-act="enc-select" data-id="${esc(id)}"><span>${esc(e.name||"Encounter")}</span><small>${isHazard(e)?esc(RIVER_HAZARDS[hazardSubtype(e)]??hazardSubtype(e)??"Hazard"):"Encounter"}${isHazard(e)?` / ${e.visibility==="discovered"?"Discovered":"Hidden"}`:""}</small></button><button type="button" data-act="enc-locate" data-id="${esc(id)}" aria-label="Locate ${esc(e.name||"encounter")}"><i class="fa-solid fa-location-crosshairs"></i></button></div>`).join("")}</details>`;
      }).join("")}</details>`;
    }).join("")}</div>`;
  }
  exportEncounters(){foundry.utils.saveDataToFile(JSON.stringify(encounterFile(this.getEncounters?.()??{},this.getWorld?.()),null,2),"application/json","encounters.json");}
  async importEncounterData(data){const entries=readEncounterFile(data);await this.#commitEnc(old=>({...old,...entries}));this.#render();return Object.keys(entries).length;}
  importEncounters(){const input=document.createElement("input");input.type="file";input.accept=".json,application/json";input.onchange=async()=>{try{const data=JSON.parse(await input.files[0].text()),entries=readEncounterFile(data);if(!await foundry.applications.api.DialogV2.confirm({window:{title:"Import encounters"},content:`<p>Import ${Object.keys(entries).length} encounters? Matching IDs are updated; other encounters remain.</p>`,rejectClose:false}))return;await this.importEncounterData(data);}catch(error){ui.notifications.warn(`KG Realms: ${error.message}`);}};input.click();}

  export() {
    const features = this.getRoutes().features.map((f) => {
      const { edited, added, ...props } = f.properties;
      props.miles = +lineMiles(f.geometry.coordinates, lonLatToSource, SOURCE_MAP.milesPerPixel).toFixed(1);
      return { type: "Feature", properties: props, geometry: f.geometry };
    });
    foundry.utils.saveDataToFile(JSON.stringify({ type: "FeatureCollection", features }), "application/json", "routes.geojson");
  }

  import() {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".geojson,.json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (data?.type !== "FeatureCollection") throw new Error("not a GeoJSON FeatureCollection");
        const edits = editsBetween(this.getBase(), data);
        await this.#commit(() => edits);
        this.select(null);
        ui.notifications.info(`KG Realms: imported ${data.features.length} routes.`);
      } catch (err) {
        ui.notifications.error(`KG Realms: could not import routes (${err.message}).`);
      }
    });
    input.click();
  }

  /* ------------------------------------------------------------------ drawing */

  #draw() {
    const layer = this.getLayer();
    if (!layer) return;
    if (!this.coords) return layer.setRouteEdit(null, null);
    const line = this.draft && this.hover ? [...this.coords, this.hover] : this.coords;
    layer.setRouteEdit(line.length > 1 ? smoothLine(line, lonLatToSource, sourceToLonLat) : null, this.coords, this.node);
  }

  #render() {
    if (!this.active) return;
    if (!this.panel) {
      this.panel = document.createElement("div");
      this.panel.className = this.host ? "kgr-tab kgr-roads-tab" : "kgr-ui kgr-panel kgr-roads";
      (this.host ?? document.body).append(this.panel);
      this.panel.addEventListener("click", (e) => this.#click(e));
      this.panel.addEventListener("change", (e) => this.#change(e));
      this.panel.addEventListener("toggle",e=>{const key=e.target.dataset?.encOpen;if(!key)return;this.encOpen??=new Set();const was=this.encOpen.has(key);if(e.target.open)this.encOpen.add(key);else this.encOpen.delete(key);if(key.startsWith("road:")&&e.target.open&&!was&&!e.target.querySelector(".kgr-enc-list-row"))this.#render();},true);
    }
    const f = this.selected ? this.getRoutes().features.find((x) => x.properties.id === this.selected) : null;
    const miles = this.coords?.length > 1 ? lineMiles(this.coords, lonLatToSource, SOURCE_MAP.milesPerPixel) : 0;
    const placeName = (id) => this.getPlaces().find((p) => p.id === id)?.name;
    let body;
    const enc = this.encounter ? normalizeEncounter(this.getEncounters()[this.encounter]) : null;
    if (this.joining) {
      body = `<p class="kgr-sel node"><i class="fa-solid fa-link"></i> Click the road or trail to join to this one. It becomes part of this road, with this road's name. Esc cancels.</p><div class="row"><button data-act="join-cancel">Cancel</button></div>`;
    } else if (this.placing) {
      body = `<p class="kgr-sel node"><i class="fa-solid fa-location-crosshairs"></i> ${RIVER_HAZARDS[this.placingKind]?`Click a river to place ${RIVER_HAZARDS[this.placingKind].toLowerCase()}. It stays on the map and is hidden until discovered.`:"Click the map to place an encounter (it snaps onto a road nearby)."} Esc cancels.</p>`;
    } else if (enc) {
      body = `<div class="kgr-enc-box"><span class="cap">Selected encounter</span>
        <div class="row"><label>Name <input type="text" name="enc-name" value="${esc(enc.name)}"></label></div>
        <label>Encounter type<select name="enc-kind"><option value="encounter" ${isHazard(enc)?"":"selected"}>Encounter</option><option value="hazard" ${isHazard(enc)?"selected":""}>Hazard</option></select></label>
        ${isHazard(enc)?`<label>Hazard subtype<select name="enc-subtype">${Object.entries(RIVER_HAZARDS).map(([id,name])=>`<option value="${id}" ${id===hazardSubtype(enc)?"selected":""}>${name}</option>`).join("")}</select></label>`:""}
        <label>Group<input name="enc-group" value="${esc(enc.group??"")}" list="kgr-enc-groups" placeholder="Ungrouped"></label><datalist id="kgr-enc-groups">${[...new Set(Object.values(this.getEncounters()).map(e=>e.group).filter(Boolean))].map(g=>`<option value="${esc(g)}"></option>`).join("")}</datalist>
        ${isRiverHazard(enc)?`<p class="hint">Permanent ${RIVER_HAZARDS[hazardSubtype(enc)].toLowerCase()}. Only journeys following its river encounter it.</p><label>River<select name="enc-river">${Object.entries(this.getWaterways?.()??{}).filter(([,w])=>w.kind==="river").map(([id,w])=>`<option value="${esc(id)}" ${id===enc.river?"selected":""}>${esc(w.name||"Unnamed river")}</option>`).join("")}</select></label><label><input type="checkbox" name="enc-discover" ${enc.autoDiscover!==false?"checked":""}> Discover on first encounter</label><label>Visibility<select name="enc-visibility"><option value="hidden" ${(enc.visibility??"hidden")==="hidden"?"selected":""}>Hidden</option><option value="discovered" ${enc.visibility==="discovered"?"selected":""}>Discovered</option></select></label>`:""}
        <div class="kgr-enc-fields">
          <label for="kgr-enc-dc">Perception DC</label><span class="kgr-enc-in"><input id="kgr-enc-dc" type="number" name="enc-dc" min="0" max="30" value="${enc.dc ?? ""}" placeholder="none"><small>to notice it first</small></span>
          <label for="kgr-enc-radius">Range</label><span class="kgr-enc-in"><input id="kgr-enc-radius" type="number" name="enc-radius" min="0.5" max="50" step="0.5" value="${enc.radius ?? 3}"><small>miles from the route</small></span>
          <label for="kgr-enc-perception">Noticed by</label><select id="kgr-enc-perception" name="enc-perception"><option value="active" ${enc.perception !== "passive" ? "selected" : ""}>Wisdom (Perception) checks</option><option value="passive" ${enc.perception === "passive" ? "selected" : ""}>Passive Perception only</option></select>
        </div>
        <div class="row"><button data-act="enc-card" class="grow"><i class="fa-solid fa-id-card"></i> Open card</button><button data-act="enc-delete" class="danger"><i class="fa-solid fa-trash"></i> Delete</button><button data-act="deselect">Done</button></div></div>`;
    } else if (this.focus === "encounters") {
      body = `<p class="hint">Click an encounter on the map to edit it, or New encounter to place one. Every journey that passes within its reach meets it; fast pace takes 5 off passive Perception.</p>`;
    } else if (this.draft) {
      body = `<p class="hint">Drawing a new ${this.draft.kind}. Click to add nodes; a click near a place or another route snaps to it. Double-click, right-click or Enter finishes; Esc cancels.</p>
        <div class="row"><button data-act="finish"><i class="fa-solid fa-check"></i> Finish</button><button data-act="cancel"><i class="fa-solid fa-xmark"></i> Cancel</button></div>`;
    } else if (f) {
      const ends = [f.properties.from, f.properties.to].map(placeName).filter(Boolean);
      // What to do with a road is on the editing bar and at the pointer; the panel holds its details.
      body = `<div class="kgr-enc-box"><span class="cap">Selected ${esc(f.properties.kind ?? "road")}</span>
        <div class="row"><label>Name <input type="text" name="name" value="${esc(f.properties.name ?? "")}" placeholder="Unnamed"></label>
          <label>Kind <select name="kind">${Object.entries(ROUTE_KINDS).map(([k, v]) => `<option value="${k}" ${k === f.properties.kind ? "selected" : ""}>${v}</option>`).join("")}</select></label></div>
        <span class="hint">${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi${ends.length ? ` · ${esc(ends.join(" to "))}` : ""} · ${this.coords.length} nodes${this.node !== null ? ` · node ${this.node + 1} selected` : ""}</span>
        <div class="row"><button data-act="simplify" class="grow" title="Take out nodes that do not change the shape"><i class="fa-solid fa-wand-magic-sparkles"></i> Simplify</button><button data-act="join" class="grow" title="Join another road or trail onto this one (a road in several pieces)"><i class="fa-solid fa-link"></i> Join a road</button><button data-act="delete" class="danger" title="Delete the whole road (it can be restored)"><i class="fa-solid fa-trash"></i> Delete</button></div>
        ${f.properties.edited ? `<div class="row"><button data-act="reset"><i class="fa-solid fa-rotate-left"></i> Reset to the original</button></div>` : ""}</div>`;
    } else {
      body = `<p class="hint">Click a road or trail to edit it, or draw a new one.</p>`;
    }
    const gone = this.#deletedList();
    const roadsTab = this.focus !== "encounters";
    const restore = roadsTab && gone.length && !this.draft ? `<div class="row"><label>Deleted <select name="restore">${gone.map((g) => `<option value="${esc(g.id)}">${esc(g.label)}</option>`).join("")}</select></label><button data-act="restore"><i class="fa-solid fa-trash-arrow-up"></i> Restore</button></div>` : "";
    // The everyday tools at the top; the whole-map ones (simplify every road, the roads file) in a
    // plain row at the bottom, always in view.
    const tools = roadsTab
      ? `<div class="row kgr-tools"><button data-act="new-road"><i class="fa-solid fa-plus"></i> New road</button><button data-act="new-trail"><i class="fa-solid fa-plus"></i> New trail</button><span class="sp"></span>
          <button data-act="undo" title="Undo (Ctrl+Z)"><i class="fa-solid fa-rotate-left"></i> Undo</button></div>`
      : `<div class="row kgr-tools"><button data-act="new-enc" class="primary"><i class="fa-solid fa-plus"></i> Encounter</button><button data-act="new-hazard"><i class="fa-solid fa-plus"></i> Hazard</button><select name="new-hazard-subtype" aria-label="New hazard subtype">${Object.entries(RIVER_HAZARDS).map(([k,v])=>`<option value="${k}" ${k===(this.newHazard??"rapids")?"selected":""}>${v}</option>`).join("")}</select></div>`;
    const files = roadsTab ? `<div class="kgr-file-row"><button data-act="simplify-all" title="Take out excess nodes on every road and trail"><i class="fa-solid fa-wand-magic-sparkles"></i> Simplify every road</button>
      <button data-act="export" title="Save every road and trail to a file"><i class="fa-solid fa-file-export"></i> Export roads</button><button data-act="import" title="Load roads and trails from a file"><i class="fa-solid fa-file-import"></i> Import roads</button></div>` : "";
    this.panel.innerHTML = `${tools}${body}${restore}${roadsTab && !this.draft && !this.joining ? this.#roadList() : ""}${files}${roadsTab?"":this.encounterList()+'<div class="kgr-file-row"><button data-act="enc-export">Export encounters</button><button data-act="enc-import">Import encounters</button></div>'}`;
    this.onStatus?.();
  }

  #click(e) {
    const button=e.target.closest("[data-act]"),act=button?.dataset.act;
    if (!act) return;
    if (act === "more") { this.moreOpen = !this.moreOpen; return this.#render(); }
    if(act==="enc-select")return this.selectEncounter(button.dataset.id);
    if(act==="road-pick"){this.select(button.dataset.id);return this.#locateRoad(button.dataset.id);}
    if(act==="road-locate")return this.#locateRoad(button.dataset.id);
    if(act==="enc-locate"){const x=this.getEncounters()[button.dataset.id],layer=this.getLayer();if(x&&layer.frame){const p=latLonToScene(layer.frame,x.lat,x.lon);canvas.animatePan?.({...p,duration:400});}return;}
    if(act==="enc-group-rename"){e.preventDefault();e.stopPropagation();const group=button.dataset.group;return foundry.applications.api.DialogV2.prompt({window:{title:"Rename encounter group"},content:`<label>Group name<input name="group" value="${esc(group)}"></label>`,ok:{label:"Rename",callback:(_e,b)=>b.form.elements.group.value.trim()},rejectClose:false}).then(name=>{if(name==null)return;return this.#commitEnc(all=>Object.fromEntries(Object.entries(all).map(([id,x])=>[id,x.group===group?{...x,group:name}:x]))).then(()=>this.#render());});}
    if(act==="enc-export")return this.exportEncounters();if(act==="enc-import")return this.importEncounters();
    if (["simplify-all", "export", "import"].includes(act)) this.moreOpen = false;
    ({
      "new-road": () => this.startDraft("road"), "new-trail": () => this.startDraft("trail"),
      export: () => this.export(), import: () => this.import(), close: () => this.onClose?.() ?? this.close(),
      "new-enc": () => { this.select(null); this.placingKind=null;this.placing = true; this.#render(); },
      "new-hazard":()=>{this.select(null);this.placingKind=this.newHazard??"rapids";this.placing=true;this.#render();},
      "new-rapids":()=>{this.select(null);this.placingKind="rapids";this.placing=true;this.#render();},"new-waterfall":()=>{this.select(null);this.placingKind="waterfall";this.placing=true;this.#render();},
      "enc-delete": () => this.#deleteEncounter(), "enc-card": () => this.openEncounter?.(this.encounter),
      finish: () => this.#finish(), cancel: () => this.#cancelDraft(), undo: () => this.#undo(),
      restore: () => { const id = this.panel.querySelector('[name="restore"]')?.value; if (id) this.#restore(id); },
      simplify: () => this.#simplify(), "simplify-all": () => this.#simplifyAll(), join: () => { this.joining = true; this.node = null; this.#render(); }, "join-cancel": () => { this.joining = false; this.#render(); },
      delete: () => this.#deleteRoute(), reset: () => this.#reset(), deselect: () => this.select(null)
    })[act]?.();
  }

  #change(e) {
    const t = e.target;
    if(t.name==="new-hazard-subtype"){this.newHazard=t.value;if(this.placing&&this.placingKind){this.placingKind=t.value;this.#render();}return;}
    if (this.encounter) {
      if(t.name==="enc-group")this.#saveEncounter({group:t.value.trim().slice(0,120)});
      if(t.name==="enc-kind")this.#saveEncounter(t.value==="hazard"?{kind:"hazard",subtype:"rapids",permanent:true,autoDiscover:true,visibility:"hidden"}:{kind:"encounter",subtype:null,river:null,permanent:false});
      if(t.name==="enc-subtype"&&RIVER_HAZARDS[t.value])this.#saveEncounter({kind:"hazard",subtype:t.value,permanent:true});
      if(t.name==="enc-river")this.#saveEncounter({river:t.value});
      if(t.name==="enc-discover")this.#saveEncounter({autoDiscover:t.checked});
      if(t.name==="enc-visibility")this.#saveEncounter({visibility:t.value==="discovered"?"discovered":"hidden"});
      if (t.name === "enc-name") this.#saveEncounter({ name: t.value.trim() || "Encounter" });
      if (t.name === "enc-dc") this.#saveEncounter({ dc: t.value === "" ? null : Number(t.value) });
      if (t.name === "enc-radius") this.#saveEncounter({ radius: Math.max(0.5, Number(t.value) || 3) });
      if (t.name === "enc-perception") this.#saveEncounter({ perception: t.value === "passive" ? "passive" : "active" });
      return;
    }
    if (!this.selected) return;
    if (t.name === "name") this.#save({ name: t.value.trim() || null });
    if (t.name === "kind") this.#save({ kind: t.value });
  }

  /** Redraw after the routes changed elsewhere (another GM, an import). */
  refresh() {
    if (!this.active) return;
    if (this.selected && this.drag === null) {
      const f = this.getRoutes().features.find((x) => x.properties.id === this.selected);
      if (!f) this.selected = null;
      this.coords = f ? f.geometry.coordinates.map((c) => [...c]) : (this.draft ? this.coords : null);
    }
    this.#draw();
    this.#render();
  }
}
