// The GM's map editor: one panel, one button. Tabs switch what clicks on the map do:
//  Places:     add, move and mark places (each place's card holds the rest).
//  Roads:      roads and trails.
//  Encounters: encounters placed on the map, met by any journey that passes within reach.
//  Waterways:  shorelines, rivers, trade winds and currents, and sea routes, for travel by boat.
//  Practice:   demonstrations that change nothing (ui-practice.mjs), the practice night first.
// Places is the pin editor; Roads and Encounters are the road editor with its focus set. Only the
// open tab listens to the map. While it is open the editing bar (ui-editbar.mjs) says so: what a
// click does on this tab now, what Esc does, and Done to leave.
import { editBar } from "./ui-editbar.mjs";
import { applyHeight, heightGrip, dragByHeader, clampTo } from "./float-panel.mjs";
import { shellHead, shellTabs, applyMin, panelState, setPanelState } from "./ui-shell.mjs";

const MODULE_ID = "kg-realms";
const get = (k) => { try { return game.settings.get(MODULE_ID, k); } catch { return undefined; } };
const set = (k, v) => game.settings.set(MODULE_ID, k, v).catch(() => {});

const TABS = { places: ["fa-map-pin", "Places"], roads: ["fa-route", "Roads"], encounters: ["fa-triangle-exclamation", "Encounters"], waterways: ["fa-water", "Waterways"], biomes: ["fa-tree", "Biomes"], snow: ["fa-snowflake", "Snow"], practice: ["fa-flask", "Practice"] };

export class MapEditor {
  constructor({ pins, roads, water, biomes, snow, practice }) {
    this.tabs = Object.fromEntries(Object.entries({ places: pins, roads, encounters: roads, waterways: water, biomes, snow, practice }).filter(([,v])=>v));
    this.active = false;
    this.tab = "places";
    this.el = null;
    this.note = "";
    for (const t of new Set(Object.values(this.tabs))) {
      t.onClose = () => this.onClose?.();
      // A tab with nothing left to step back from: Esc leaves the editor.
      t.onLeave = () => this.onClose?.();
      t.onStatus = () => editBar.update(this, this.#bar());
    }
  }

  toggle(on = !this.active) { on ? this.open() : this.close(); }

  async open() {
    if (this.active || !game.user.isGM) return;
    this.active = true;
    this.el = document.createElement("div");
    this.el.className = "kgr-ui kgr-panel kgr-editor";
    this.el.innerHTML = `${this.#head()}
      ${shellTabs(Object.entries(TABS).filter(([k]) => this.tabs[k]).map(([k, [icon, label]]) => [k, label, icon]), this.tab, { label: "Map editor", stacked: true }).replace("kgr-sh-tabs", "kgr-sh-tabs kgr-editor-tabs")}
      <div class="body"></div>`;
    applyMin(this.el, panelState("mapEditor").min);
    document.body.append(this.el);
    this.el.querySelector("nav").addEventListener("click", (e) => { const t = e.target.closest("[data-tab]")?.dataset.tab; if (t) this.show(t); });
    // The window controls: lock, minimise, close (the shell's header, redrawn as they change).
    this.el.addEventListener("click", async (e) => {
      const act = e.target.closest("[data-shell]")?.dataset.shell;
      if (act === "close") return this.onClose?.() ?? this.close();
      if (act === "lock") { await set("mapEditorLocked", !get("mapEditorLocked")); return this.#lockButton(); }
      if (act === "min") { const on = !panelState("mapEditor").min; await setPanelState("mapEditor", { min: on }); applyMin(this.el, on); return this.#lockButton(); }
    });
    this.#lockButton();
    // Where it goes: where it was put (dragged by its header while unlocked), else under the bar
    // against the sidebar. Its height: as set with its grip, else to fit.
    dragByHeader(this.el, { locked: () => !!get("mapEditorLocked"), save: (x, y) => { set("mapEditorX", x); set("mapEditorY", y); this.#placed(); } });
    heightGrip(this.el, (h) => set("mapEditorH", h));
    editBar.show(this, this.#bar());
    this.#position();
    this.onResize = () => this.#position();
    window.addEventListener("resize", this.onResize);
    await this.show(this.tab);
  }

  /** The header (ui-shell.mjs): the open tab's name as the title. */
  #head() {
    return shellHead({ icon: "fa-pen-ruler", eyebrow: "Map editor", title: TABS[this.tab]?.[1] ?? "", lock: { attr: 'data-shell="lock"', on: !!get("mapEditorLocked") }, min: { attr: 'data-shell="min"', on: !!panelState("mapEditor").min }, close: { attr: 'data-shell="close"', title: "Done editing" } });
  }

  /** Redraw the header (the lock, minimise and title follow their state). */
  #lockButton() {
    const h = this.el?.querySelector("header");
    if (!h) return;
    h.outerHTML = this.#head();
    this.el.classList.toggle("locked", !!get("mapEditorLocked"));
  }

  /** Put the panel where it was left, or (never moved) under the editing bar; at its kept height. */
  #position() {
    if (!this.el) return;
    const x = get("mapEditorX"), y = get("mapEditorY");
    if (x >= 0 && y >= 0) {
      this.#placed();
      const [cx, cy] = clampTo(this.el, x, y);
      Object.assign(this.el.style, { left: `${cx}px`, top: `${cy}px`, right: "auto" });
    } else editBar.anchor(this.el);
    applyHeight(this.el, get("mapEditorH") ?? 0);
  }

  /** Moved by hand: no longer kept under the editing bar. */
  #placed() {
    editBar.anchor(this.el, false);
    this.el.classList.remove("kgr-anchored");
  }

  async show(tab) {
    if (!this.active) return;
    for (const t of new Set(Object.values(this.tabs))) t.close();
    this.tab = tab;
    for (const b of this.el.querySelectorAll("[data-tab]")) { b.classList.toggle("on", b.dataset.tab === tab); b.setAttribute("aria-selected", String(b.dataset.tab === tab)); }
    this.#lockButton();
    const t = this.tabs[tab];
    t.focus = tab;
    t.host = this.el.querySelector(".body");
    await t.open();
    editBar.update(this, this.#bar());
  }

  /** What the editing bar says for the open tab, from the tab's own state. */
  #bar() {
    const st = this.tabs[this.tab]?.status?.() ?? {};
    return { title: "Editing the map", mode: TABS[this.tab][1], done: "Done editing", undo: true, note: this.note, onDone: () => this.onClose?.() ?? this.close(), ...st };
  }

  close() {
    if (!this.active) return;
    this.active = false;
    for (const t of new Set(Object.values(this.tabs))) t.close();
    if (this.onResize) window.removeEventListener("resize", this.onResize);
    editBar.anchor(this.el, false);
    this.el?.remove();
    this.el = null;
    editBar.hide(this);
  }

  /** The camera moved. */
  viewChanged() { if (this.active && this.tab === "places") this.tabs.places.refreshView?.(); }
}
