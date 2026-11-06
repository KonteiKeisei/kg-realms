import {RealmDialog} from "./ui-theme.mjs";
// The GM's Local places panel on a local map, with its own marker editing, in the panel shell
// (ui-shell.mjs), with three tabs:
//  Places:    Place, Gate and Dock (click the map, and the card opens to be filled in); the places on
//             the map in sections (ways in, the rest), with a find box; and the places not yet on the
//             map (from the journal the map was made from), placed with a click.
//  Roads:     the settlement's roads (city/road-editor.mjs, drawn in this panel).
//  Map style: the map's icon pack and its settings.
// The footer: Travel here, and export and import of the scene's places as JSON. Places are edited on
// their own cards (click a row, or double-click a marker); markers are moved by dragging them.
import { CATEGORIES, localRecord, categoryFor,localPlaceType } from "./local-places.mjs";
import { asSecret } from "./place-card.mjs";
import { editBar } from "./ui-editbar.mjs";
import { onCanvas } from "./canvas-input.mjs";
import { EditorFrame } from "./editor-frame.mjs";
import { shellHead, shellTabs, shellSection, movable, placeKept, isLocked, toggleLocked, panelState, setPanelState, applyMin } from "./ui-shell.mjs";
import { entranceType } from "./settlement-entry.mjs";
import {ICON_PACKS,iconPackOverride,worldIconPack,resolvedIconPack,iconPackOptions,paintIconPackPreview} from './local-icon-packs.mjs';

const MODULE_ID = "kg-realms";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const TABS = { places: ["Places", "fa-location-dot"], roads: ["Roads", "fa-road"], style: ["Map style", "fa-palette"] };

export class LocalEditor {
  /** maps: the LocalMaps (localMapOf, localOf, open, settings, roadEditor). */
  constructor(maps) {
    this.maps = maps;
    this.active = false;
    this.el = null;
    this.tab = "places";
    this.filter = "";
    this.shut = new Set();   // sections folded away
    this.placing = null;   // { name, category, known, index } waiting for a click on the map
    this.onDown = (e) => this.#down(e);
    this.onMove = (e) => this.#move(e);
    this.onUp = (e) => this.#up(e);
    this.onCancel = e => { if (e?.pointerId == null || this.press?.pointerId === e.pointerId) this.#cancelDrag(); };
    this.previewFrame = new EditorFrame(() => this.#previewDrag());
    // Esc steps back: stop placing, then leave editing. (On the Roads tab, the road editor's own.)
    this.onKey = (e) => {
      if (e.key !== "Escape" || this.tab === "roads" || e.target?.closest?.("input, textarea, select, [contenteditable]")) return;
      e.stopPropagation();
      if (this.press) { e.preventDefault(); this.#cancelDrag(); return; }
      if (this.placing) { this.placing = null; return this.render(); }
      this.close();
    };
  }

  get scene() { return canvas.scene; }
  get map() { return this.maps.localMapOf(this.scene); }
  get roads() { return this.maps.roadEditor?.() ?? null; }
  #notes() { return (this.scene?.notes.contents ?? []).filter((n) => this.maps.localOf(n)); }

  toggle(on = !this.active) { on ? this.open() : this.close(); }

  startEntrance(type = 'land') {
    if (!game.user.isGM || !this.map) return;
    this.open({ tab: "places" });
    this.placing = {name: type === 'dock' ? 'Dock entrance' : 'Gate or road in', category: type === 'dock' ? 'harbour' : 'gate', entry: true, entryType: type === 'dock' ? 'dock' : 'land', known: ''};
    this.render();
  }

  /** Open (on a tab), or go to that tab if open. */
  open({ tab } = {}) {
    if (!game.user.isGM || !this.map) return;
    if (this.active) { if (tab && tab !== this.tab) this.#setTab(tab); return; }
    if (tab && TABS[tab]) this.tab = tab;
    this.active = true;
    this.editScene = this.scene;
    this.el = document.createElement("div");
    this.el.className = "kgr-ui kgr-panel kgr-editor kgr-local-editor";
    document.body.append(this.el);
    this.el.addEventListener("click", (e) => this.#click(e));
    this.el.addEventListener('change',async e=>{
      if(e.target.matches('[data-place-type]')){const select=e.target,note=this.scene.notes.get(select.dataset.note);select.disabled=true;try{await this.maps.changePlaceType(note,select.value);}catch(error){ui.notifications.error(`KG Realms: ${error.message}`);}this.render();return;}
      if(!e.target.matches('[data-map-icon-pack]'))return;const select=e.target,scene=this.scene;select.disabled=true;
      try{await this.maps.setIconPack(scene,select.value);this.render();}catch(err){ui.notifications.error(`KG Realms: could not save icon pack (${err.message}).`);select.disabled=false;}
    });
    // The find box filters the rows in place (no redraw while typing).
    this.el.addEventListener("input", (e) => { if (e.target.matches("[data-local-filter]")) { this.filter = e.target.value; this.#applyFilter(); } });
    this.el.addEventListener("keydown", (e) => { const row = e.target.closest?.(".kgr-local-row[data-note]"); if (row && e.target === row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); const note = this.scene.notes.get(row.dataset.note); if (note) this.maps.open(note); } });
    this.el.addEventListener("toggle", (e) => { const k = e.target.dataset?.sec; if (k && !e.target.closest(".kgr-sh-host")) this.shut[e.target.open ? "delete" : "add"](k); }, true);
    // Movable by its header like every panel; double-click the header to put it back under the bar.
    movable(this.el, "local", { moved: () => { editBar.anchor(this.el, false); this.el.classList.remove("kgr-anchored"); }, redock: () => this.render() });
    this.offCanvas = onCanvas({ pointerdown: this.onDown, pointermove: this.onMove, pointerup: this.onUp, pointercancel: this.onCancel, lostpointercapture: this.onCancel });
    window.addEventListener("blur", this.onCancel);
    document.addEventListener("keydown", this.onKey, { capture: true });
    this.hooks = [
      ["createNote", Hooks.on("createNote", () => this.render())],
      ["deleteNote", Hooks.on("deleteNote", () => this.render())],
      ["updateNote", Hooks.on("updateNote", () => this.render())],
      ["updateUser", Hooks.on("updateUser", user => { if (user.id === game.user.id && !game.user.isGM) this.close(); })],
      ["updateScene", Hooks.on("updateScene", (s) => { if (s === this.scene) this.render(); })]
    ];
    this.render();
    this.maps.editorOpened?.(this.scene);
  }

  close() {
    if (!this.active) return;
    this.#cancelDrag();
    this.active = false;
    if (this.roads?.active) this.roads.close();
    this.offCanvas?.(); this.offCanvas = null;
    window.removeEventListener("blur", this.onCancel);
    document.removeEventListener("keydown", this.onKey, { capture: true });
    for (const [name, id] of this.hooks ?? []) Hooks.off(name, id);
    this.hooks = null;
    editBar.anchor(this.el, false);
    this.el?.remove();
    this.el = null;
    this.placing = null;
    this.lastMarkerClick = null;
    this.editScene = null;
    this.renderedTab = null;
    editBar.hide(this);
    this.onClose?.();
  }

  #setTab(tab) {
    if (!TABS[tab] || tab === this.tab) return;
    this.#cancelDrag();
    if (this.tab === "roads" && this.roads?.active) this.roads.close();
    this.tab = tab;
    this.placing = null;
    this.render();
  }

  render() {
    if (!this.el) return;
    if (this.editScene !== this.scene || !game.user.isGM) return this.close();
    const map = this.map;
    if (!map) return this.close();
    const tab = this.tab, notes = this.#notes();
    const roadsCount = this.scene.getFlag(MODULE_ID, "cityRoads")?.roads?.length ?? 0;
    const head = shellHead({ icon: "fa-map-location-dot", eyebrow: "Local places", title: map.name, lock: { attr: 'data-act="lock"', on: isLocked("local") }, min: { attr: 'data-act="min"', on: !!panelState("local").min }, close: { attr: 'data-act="close"' } });
    const tabs = shellTabs([["places", TABS.places[0], TABS.places[1], notes.length], ["roads", TABS.roads[0], TABS.roads[1], roadsCount], ["style", TABS.style[0], TABS.style[1]]], tab, { attr: "data-local-tab", label: "Local places" });
    if (tab === "roads") {
      // The road editor draws into its host: kept across redraws (its scroll and fields stay).
      const host = this.renderedTab === "roads" ? this.el.querySelector(":scope > .kgr-sh-host") : null;
      if (host) {
        this.el.querySelector(":scope > header")?.replaceWith(this.#fragment(head));
        this.el.querySelector(":scope > nav")?.replaceWith(this.#fragment(tabs));
      } else {
        this.el.innerHTML = `${head}${tabs}<div class="kgr-sh-host kgr-city-roads"></div>`;
        const roads = this.roads, at = this.el.querySelector(":scope > .kgr-sh-host");
        if (roads) {
          roads.onStatus = (st) => this.#bar(st);
          roads.onLeave = () => this.close();
          roads.open(this.scene, { host: at });
        } else at.innerHTML = `<div class="body"><p class="hint">Settlement roads are not available.</p></div>`;
      }
    } else {
      const body = this.el.querySelector(":scope > .body"), scroll = this.renderedTab === tab ? body?.scrollTop ?? 0 : 0;
      this.el.innerHTML = `${head}${tabs}<div class="body">${tab === "style" ? this.#style(map) : this.#places(map, notes)}</div>
        <div class="kgr-sh-foot"><button data-act="travel" title="Plan a trip in this settlement"><i class="fa-solid fa-horse"></i> Travel here</button><span class="kgr-sh-sp"></span><button data-act="import"><i class="fa-solid fa-file-import"></i> Import</button><button data-act="export"><i class="fa-solid fa-file-export"></i> Export</button></div>`;
      const nb = this.el.querySelector(":scope > .body");
      if (nb) nb.scrollTop = scroll;
      if (tab === "style") paintIconPackPreview(this.el.querySelector('[data-icon-pack-preview]'),resolvedIconPack(map),[CATEGORIES.inn.glyph,CATEGORIES.shop.glyph,CATEGORIES.harbour.glyph]);
      this.#applyFilter();
      this.#bar();
    }
    this.renderedTab = tab;
    // Where it was left, else under the editing bar; minimised or whole.
    if (placeKept(this.el, "local")) { editBar.anchor(this.el, false); this.el.classList.remove("kgr-anchored"); } else editBar.anchor(this.el);
    this.el.classList.toggle("locked", isLocked("local"));
    applyMin(this.el, panelState("local").min);
  }

  #fragment(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }

  /** The Places tab: quick adds, then the places in sections, with a find box. */
  #places(map, notes) {
    const unplaced = map.unplaced ?? [];
    const status = this.placing
      ? `<p class="kgr-sel node"><i class="fa-solid fa-location-crosshairs"></i> Click the map to place <b>${esc(this.placing.name)}</b>. Esc cancels.</p>`
      : `<p class="hint">Click a place for its card (or double-click its marker). Drag a marker to move it.</p>`;
    const recs = notes.map((n) => ({ n, rec: this.maps.localOf(n) })).sort((a, b) => a.rec.name.localeCompare(b.rec.name));
    const row = ({ n, rec }) => {
      const cat = CATEGORIES[rec.category] ?? CATEGORIES.other, way = entranceType(rec);
      const chips = [way ? `<span class="kgr-sh-chip">${way === "dock" ? "Dock" : "Land"}</span>` : "", rec.privateEntry ? `<span class="kgr-sh-chip warn">Private</span>` : "", rec.visibility === "hidden" ? `<span class="kgr-sh-chip">Hidden</span>` : rec.visibility === "rumoured" ? `<span class="kgr-sh-chip">Rumoured</span>` : ""].join("");
      return `<div class="kgr-sh-row kgr-local-row" data-note="${esc(n.id)}" data-name="${esc(rec.name.toLowerCase())}" role="button" tabindex="0" title="Open its card"><span class="kgr-sh-ico"><i class="fa-solid ${cat.icon}"></i></span><span class="kgr-sh-main"><b>${esc(rec.name)}</b><small>${esc(cat.label)}</small></span>${chips}<select data-place-type data-note="${esc(n.id)}" aria-label="Place type for ${esc(rec.name)}" style="width:90px">${[['place','Place'],['gate','Gate'],['dock','Dock']].map(([id,label])=>`<option value="${id}" ${localPlaceType(rec)===id?'selected':''}>${label}</option>`).join('')}</select><button data-act="locate" data-note="${esc(n.id)}" title="Show it on the map"><i class="fa-solid fa-crosshairs"></i> Locate</button><button data-act="delete-place" data-note="${esc(n.id)}" title="Delete permanently" aria-label="Delete ${esc(rec.name)} permanently"><i class="fa-solid fa-trash"></i></button></div>`;
    };
    const ways = recs.filter((x) => entranceType(x.rec)), rest = recs.filter((x) => !entranceType(x.rec));
    const waiting = unplaced.map((u, i) => { const cat = CATEGORIES[u.category] ?? CATEGORIES.other; return `<div class="kgr-sh-row" data-name="${esc(String(u.name).toLowerCase())}"><span class="kgr-sh-ico"><i class="fa-solid ${cat.icon}"></i></span><span class="kgr-sh-main"><b>${esc(u.name)}</b><small>${esc(cat.label)}</small></span><button data-act="place" data-i="${i}" title="Place it on the map"><i class="fa-solid fa-location-crosshairs"></i> Place</button><button data-act="drop-unplaced" data-i="${i}" title="Remove from the list" aria-label="Remove ${esc(u.name)} from the list"><i class="fa-solid fa-xmark"></i></button></div>`; }).join("");
    return `<div class="kgr-sh-grid3"><button data-act="add" class="primary"><i class="fa-solid fa-plus"></i> Place</button><button data-act="gate"><i class="fa-solid fa-door-open"></i> Gate</button><button data-act="dock"><i class="fa-solid fa-anchor"></i> Dock</button></div>
      ${status}
      <label class="kgr-sh-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><input type="search" data-local-filter placeholder="Find a place" aria-label="Find a place" value="${esc(this.filter)}"></label>
      ${shellSection("Ways in", ways.map(row).join("") || `<p class="hint">No gate or dock yet: Gate or Dock above.</p>`, { count: ways.length, open: !this.shut.has("ways"), key: "ways" })}
      ${shellSection("Placed", rest.map(row).join("") || `<p class="hint">No places yet: Place above, then click the map.</p>`, { count: rest.length, open: !this.shut.has("placed"), key: "placed" })}
      ${unplaced.length ? shellSection("Not yet on the map", waiting, { count: unplaced.length, open: !this.shut.has("unplaced"), key: "unplaced" }) : ""}${map.presetId&&map.deletedPlaces?.length?'<button data-act="restore-source">Restore deleted source places</button>':''}`;
  }

  /** The Map style tab: the icon pack, and the map's settings. */
  #style(map) {
    return `<label class="kgr-sh-field">Icon pack<select id="kgr-map-icon-pack" data-map-icon-pack>${[['',`Use world default (${ICON_PACKS[worldIconPack()]})`],...iconPackOptions()].map(([value,label])=>`<option value="${value}" ${(iconPackOverride(map.iconPack)??'')===value?'selected':''}>${label}</option>`).join('')}</select></label>
      <div class="kgr-icon-pack-preview" data-icon-pack-preview role="img" aria-label="Icon pack preview"></div>
      <p class="hint">Applies to places using the map default. Override it in a place's card.</p>
      <button data-act="settings" title="Local map settings"><i class="fa-solid fa-gear"></i> Map settings</button>`;
  }

  /** Hide the rows the find box does not match. */
  #applyFilter() {
    const q = this.filter.trim().toLowerCase();
    for (const r of this.el?.querySelectorAll(".kgr-sh-row[data-name]") ?? []) r.hidden = !!q && !r.dataset.name.includes(q);
  }

  /** The editing bar: what a click does now, and how to finish (the Roads tab adds its own). */
  #bar(st = {}) {
    const map = this.map;
    if (!map) return;
    const bar = {
      title: `Editing ${map.name}`, mode: TABS[this.tab]?.[0] ?? "Local places", done: "Done editing", onDone: () => this.close(),
      hint: this.placing ? `Click the map to place ${this.placing.name}` : "Click a place for its card · drag a marker to move it",
      esc: this.placing ? "cancels placing" : "leaves editing", tip: this.placing ? `Click to place ${this.placing.name}` : "", crosshair: !!this.placing,
      ...st
    };
    if (editBar.owner === this) editBar.update(this, bar); else editBar.show(this, bar);
  }

  async #click(e) {
    if(e.target.closest('[data-place-type]'))return;
    // The Roads tab's own buttons are the road editor's.
    if (e.target.closest(".kgr-sh-host")) return;
    const tabBtn = e.target.closest("[data-local-tab]");
    if (tabBtn) return this.#setTab(tabBtn.dataset.localTab);
    const actEl = e.target.closest("[data-act]"), act = actEl?.dataset.act, i = Number(e.target.closest("[data-i]")?.dataset.i);
    if (!act) {
      // A place's row: its card.
      const row = e.target.closest(".kgr-local-row[data-note]"), note = row && this.scene.notes.get(row.dataset.note);
      if (note) return this.maps.open(note);
      return;
    }
    const map = this.map;
    if (act === "close") return this.close();
    if (act === "lock") { await toggleLocked("local"); return this.render(); }
    if (act === "min") { await setPanelState("local", { min: !panelState("local").min }); return this.render(); }
    if (act === "settings") return this.maps.settings(this.scene);
    if (act === "travel") { this.close(); return this.maps.travel?.(); }
    if (act === "locate") { const note = this.scene.notes.get(actEl.dataset.note); if (note) canvas.animatePan({ x: note.x, y: note.y, duration: 400 }); return; }
    if(act==='delete-place'){const note=this.scene.notes.get(actEl.dataset.note);if(note&&await RealmDialog.confirm({window:{title:'Delete place permanently'},content:`<p>Delete ${esc(this.maps.localOf(note).name)} from this world? It will not return when the companion reloads.</p>`,rejectClose:false}))await this.maps.deletePlace(note);return;}
    if(act==='restore-source'){if(await RealmDialog.confirm({window:{title:'Restore deleted source places'},content:'<p>Restore deleted places from the companion preset? Existing places and your edits are kept.</p>',rejectClose:false}))await this.maps.restoreSourcePlaces(this.scene);this.render();return;}
    if (act === "gate" || act === "dock") return this.startEntrance(act === "dock" ? "dock" : "land");
    if (act === "add") { this.placing = { name: "New place", category: "other", known: "" }; return this.render(); }
    if (act === "place") { this.placing = { ...map.unplaced[i], index: i }; return this.render(); }
    if (act === "drop-unplaced") return this.maps.deleteUnplaced(this.scene,i);
    if (act === "export") return this.#export();
    if (act === "import") return this.#import();
  }

  #canEdit() { return this.active && game.user.isGM && this.tab === "places" && this.editScene === this.scene && !!this.map; }

  #point(e) {
    const r = canvas.app.view.getBoundingClientRect();
    return canvas.stage.worldTransform.applyInverse({x:e.clientX-r.left,y:e.clientY-r.top});
  }

  #hit(at) {
    const zoom = canvas.stage.scale.x || 1, scale = Number(this.map?.markerScale) || 1;
    let best = null;
    for (const note of this.#notes()) {
      if (note.object?.destroyed || note.object?.visible === false) continue;
      const width = note.object?.kgrMarker?.width ?? (note.iconSize || 64) * scale;
      const radius = Math.max(width / 2, 12 / zoom), distance = Math.hypot(note.x-at.x,note.y-at.y);
      if (distance <= radius && (!best || distance < best.distance)) best = {note,distance};
    }
    return best?.note;
  }

  #stop(e) { e.preventDefault(); e.stopImmediatePropagation(); }

  async #down(e) {
    if (!this.#canEdit() || e.button !== 0 || this.press || this.saving) return;
    if (this.placing) return this.#placeNew(e);
    const at = this.#point(e), note = this.#hit(at);
    if (!note) { this.lastMarkerClick = null; return; }
    this.#stop(e);
    const object = note.object;
    this.press = {note,object,scene:this.scene,at,start:[e.clientX,e.clientY],origin:{x:note.x,y:note.y},offset:{x:(object?.position.x ?? note.x)-note.x,y:(object?.position.y ?? note.y)-note.y},pointerId:e.pointerId,moved:false};
    if (object) object.kgrPlaceDragging = true;
    this.maps.hideMarkerCard?.();
    this.maps.refreshMarker?.(note);
    try { canvas.app.view.setPointerCapture?.(e.pointerId); } catch { /* synthetic or already released pointer */ }
  }

  #validPress(p) {
    return this.#canEdit() && p.scene === this.scene && this.scene.notes.get(p.note.id) === p.note && p.note.x === p.origin.x && p.note.y === p.origin.y;
  }

  #move(e) {
    const p = this.press;
    if (!p || (p.pointerId != null && e.pointerId != null && p.pointerId !== e.pointerId)) return;
    if (!this.#validPress(p)) return this.#cancelDrag();
    this.#stop(e);
    if (!p.moved && Math.hypot(e.clientX-p.start[0],e.clientY-p.start[1]) < 4) return;
    const at = this.#point(e);
    p.moved = true;
    p.target = {x:Math.round(p.origin.x+at.x-p.at.x),y:Math.round(p.origin.y+at.y-p.at.y)};
    this.previewFrame.schedule();
  }

  #previewDrag() {
    const p = this.press;
    if (!p || !p.target || !this.#validPress(p)) return this.#cancelDrag();
    if (p.object && !p.object.destroyed) p.object.position.set(p.target.x+p.offset.x,p.target.y+p.offset.y);
  }

  #restore(p) {
    if (p.object && !p.object.destroyed) {
      p.object.kgrPlaceDragging = false;
      p.object.position.set(p.note.x+p.offset.x,p.note.y+p.offset.y);
      this.maps.refreshMarker?.(p.note);
    }
  }

  #cancelDrag() {
    const p = this.press;
    this.press = null;
    this.previewFrame.clear();
    if (!p) return;
    this.#restore(p);
    try { canvas.app.view.releasePointerCapture?.(p.pointerId); } catch { /* scene teardown may release capture first */ }
  }

  async #up(e) {
    const p = this.press;
    if (!p || e.button !== 0 || (p.pointerId != null && e.pointerId != null && p.pointerId !== e.pointerId)) return;
    this.#move(e);
    if (this.press !== p) return;
    this.previewFrame.clear();
    this.press = null;
    try { canvas.app.view.releasePointerCapture?.(p.pointerId); } catch { /* pointer already released */ }
    if (!p.moved) {
      this.#restore(p);
      const now = Date.now(), last = this.lastMarkerClick;
      this.lastMarkerClick = {id:p.note.id,at:now};
      if (last?.id === p.note.id && now-last.at < 450) { this.lastMarkerClick=null; return this.maps.open(p.note); }
      return;
    }
    this.lastMarkerClick = null;
    this.saving = p;
    try { await p.note.update(p.target); }
    catch (error) { ui.notifications.error(`KG Realms: could not move this place (${error.message}).`); }
    finally { this.#restore(p); this.saving = null; }
  }

  /** The click that places a new place (or one from the list), then its card opens to be filled in. */
  async #placeNew(e) {
    e.preventDefault(); e.stopImmediatePropagation();
    const r = canvas.app.view.getBoundingClientRect();
    const at = canvas.stage.worldTransform.applyInverse({ x: e.clientX - r.left, y: e.clientY - r.top });
    const p = this.placing, map = this.map;
    this.placing = null;
    // An entry from before journals went out still names its page: its text comes along, once.
    const old = p.journal ? fromUuidSync(p.journal, { strict: false }) : null;
    const known = p.known ?? asSecret(old?.text?.content ?? "");
    const rec = localRecord({ name: p.name, category: p.category ?? categoryFor("", p.name), entry: !!p.entry, entryType: p.entryType ?? null, privateEntry: !!p.privateEntry, known });
    const [created] = await this.scene.createEmbeddedDocuments("Note", [{
      x: Math.round(at.x), y: Math.round(at.y), text: rec.name, iconSize: 64, fontSize: 32, textAnchor: 1, global: true,
      texture: { src: "icons/svg/book.svg", tint: "#ffffff" }, flags: { [MODULE_ID]: { local: rec } }
    }]);
    if (p.index != null) await this.scene.setFlag(MODULE_ID, "localMap", { ...map, unplaced: map.unplaced.filter((_, k) => k !== p.index) });
    this.render();
    if (created) {
      await this.maps.open(created, { edit: true });
      await this.maps.entrancePlaced?.(created.parent ?? this.scene);
    }
  }

  #export() {
    const places = this.#notes().map((n) => ({ x: n.x, y: n.y, iconSize: n.iconSize, ...this.maps.localOf(n) }));
    const data = { type: "kg-realms-local-places", scene: this.scene.name, map: {...this.map,iconPack:iconPackOverride(this.map.iconPack)}, places };
    foundry.utils.saveDataToFile(JSON.stringify(data, null, 1), "application/json", `${this.scene.name}-local-places.json`);
  }

  #import() {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      try {
        const data = JSON.parse(await input.files[0].text());
        if (data?.type !== "kg-realms-local-places" || !Array.isArray(data.places)) throw new Error("not a KG Realms local places export");
        const ok = await RealmDialog.confirm({ window: { title: "Import local places" }, content: `<p>Add or update ${data.places.length} places on ${esc(this.scene.name)}? Places with the same name are updated; the rest are added.</p>`, rejectClose: false });
        if (!ok) return;
        const byName = new Map(this.#notes().map((n) => [this.maps.localOf(n).name.toLowerCase(), n]));
        const updates = [], creates = [];
        for (const { x, y, iconSize, ...rec } of data.places) {
          const r = localRecord({ ...rec, journal: null }), have = byName.get(r.name.toLowerCase());
          if (have) updates.push({ _id: have.id, x, y, iconSize: iconSize ?? have.iconSize, text: r.name, [`flags.${MODULE_ID}.local`]: r });
          else creates.push({ x, y, iconSize: iconSize ?? 64, text: r.name, fontSize: 32, textAnchor: 1, global: true, texture: { src: "icons/svg/book.svg", tint: "#ffffff" }, flags: { [MODULE_ID]: { local: r } } });
        }
        if (updates.length) await this.scene.updateEmbeddedDocuments("Note", updates);
        if (creates.length) await this.scene.createEmbeddedDocuments("Note", creates);
        if(Object.hasOwn(data.map??{},'iconPack'))await this.maps.setIconPack(this.scene,data.map.iconPack);
        ui.notifications.info(`KG Realms: ${updates.length} places updated, ${creates.length} added.`);
      } catch (err) { ui.notifications.error(`KG Realms: could not import (${err.message}).`); }
    });
    input.click();
  }
}
