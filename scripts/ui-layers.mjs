// The realm map's layers rail (0.77): a tab on the travel panel's left edge that unfolds into the
// map's layers (map-layers.mjs): Places, Realms, Geography. Each viewer chooses for themselves (kept
// in this browser); the GM's choice is never pushed to players. It follows the travel panel as the
// panel moves, resizes or redraws, and stands at the screen's right edge when there is no panel.

import { MAP_LAYERS, LAYER_NAMES } from "./map-layers.mjs";

const KEY = "kgr-map-layer", OPEN = "kgr-map-layers-open";
const ICONS = {
  fold: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 8l10 5 10-5-10-5Z"/><path d="m2 13 10 5 10-5"/><path d="m2 18 10 5 10-5" opacity=".5"/></svg>',
  places: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg>',
  realms: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 6 17 4l3 9-6 7-9-3Z"/><g fill="currentColor"><circle cx="5" cy="6" r="2"/><circle cx="17" cy="4" r="2"/><circle cx="20" cy="13" r="2"/><circle cx="14" cy="20" r="2"/><circle cx="5" cy="17" r="2"/></g></svg>',
  geo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m2 19 6-10 4 6 3-4 7 8Z"/><path d="M3 22c2-1.5 4-1.5 6 0s4 1.5 6 0 4-1.5 6 0" opacity=".7"/></svg>'
};
const TIPS = {
  places: "Places: settlements, keeps, ruins, temples, peaks. Single points you can travel to.",
  realms: "Realms: kingdoms, empires and regions, with their borders. Who holds the land.",
  geo: "Geography: forests, mountain ranges, deserts, seas, lakes and rivers. What the land and water are."
};
const read = (k, fallback) => { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage off */ } };

/** This viewer's chosen layer (Places until they choose). */
export function chosenLayer() { const v = read(KEY, "places"); return MAP_LAYERS.includes(v) ? v : "places"; }

export class LayersRail {
  /** getPanel(): the travel panel's element (or null); onChange(layer). */
  constructor({ getPanel, onChange }) { Object.assign(this, { getPanel, onChange }); this.el = null; }

  get open() { return read(OPEN, "0") === "1"; }

  mount() {
    this.unmount();
    this.el = document.createElement("nav");
    this.el.className = "kgr-ui kgr-layers-rail";
    this.el.setAttribute("aria-label", "Map layers");
    document.body.append(this.el);
    this.el.addEventListener("click", (e) => this.#click(e.target.closest("[data-layer], [data-fold]")));
    this.render();
    // Follow the panel: its moves (style), redraws and size.
    this.watch = new MutationObserver(() => this.follow());
    this.sized = new ResizeObserver(() => this.follow());
    this.onResize = () => this.follow();
    window.addEventListener("resize", this.onResize);
    this.follow();
  }

  unmount() {
    this.watch?.disconnect(); this.sized?.disconnect();
    if (this.onResize) window.removeEventListener("resize", this.onResize);
    this.el?.remove(); this.el = null; this.panel = null;
  }

  render() {
    if (!this.el) return;
    const on = chosenLayer(), open = this.open;
    this.el.classList.toggle("open", open);
    this.el.innerHTML = `<button type="button" data-fold class="fold ${open ? "" : "on"}" aria-expanded="${open}" aria-label="${open ? "Fold the layers" : "Map layers"}" data-tooltip="${open ? "Fold the layers" : `Map layers: ${LAYER_NAMES[on]}`}" data-tooltip-direction="LEFT">${ICONS.fold}</button>`
      + (open ? MAP_LAYERS.map((k) => `<button type="button" data-layer="${k}" class="${k === on ? "on" : ""}" aria-pressed="${k === on}" aria-label="${LAYER_NAMES[k]}" data-tooltip="${TIPS[k]}" data-tooltip-direction="LEFT">${ICONS[k]}</button>`).join("") : "");
  }

  /** Show a layer (the map editor selected a place on it). */
  setLayer(k) {
    if (!MAP_LAYERS.includes(k) || k === chosenLayer()) return;
    write(KEY, k);
    this.render();
    this.onChange?.(k);
  }

  #click(b) {
    if (!b) return;
    if (b.dataset.fold !== undefined) { write(OPEN, this.open ? "0" : "1"); return this.render(); }
    const k = b.dataset.layer;
    if (!MAP_LAYERS.includes(k) || k === chosenLayer()) return;
    write(KEY, k);
    this.render();
    this.onChange?.(k);
  }

  /** Stand on the travel panel's left edge, a little below its top; else at the screen's right. */
  follow() {
    if (!this.el) return;
    const panel = this.getPanel?.() ?? null;
    if (panel !== this.panel) {
      this.watch.disconnect(); this.sized.disconnect();
      this.panel = panel;
      if (panel) { this.watch.observe(panel, { attributes: true, attributeFilter: ["style", "hidden", "class"] }); this.sized.observe(panel); }
    }
    const shown = panel && !panel.hidden && panel.isConnected;
    if (shown) {
      const r = panel.getBoundingClientRect();
      Object.assign(this.el.style, { left: "auto", right: `${window.innerWidth - r.left - 1}px`, top: `${r.top + 18}px` });
    } else {
      const sidebar = document.getElementById("sidebar")?.getBoundingClientRect();
      Object.assign(this.el.style, { left: "auto", right: `${(sidebar ? window.innerWidth - sidebar.left : 0) + 8}px`, top: "90px" });
    }
    this.el.classList.toggle("on-panel", !!shown);
  }
}
