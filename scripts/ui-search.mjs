// Search a region's world (Ctrl+F): places and regions by name, nearest-in-scene first among
// equals. Picking one pans there and blinks it; a region pans to fit it. On a settlement map,
// its named streets too: picking one fits the whole street on screen and lights it up.

import { latLonToScene } from "./geo.mjs";
import { searchWorld } from "./places.mjs";
import { iconFor } from "./ui-card.mjs";
import { CATEGORIES } from "./local-places.mjs";

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

export class RealmSearch {
  /**
   * getLayer(): the RealmLayer; getData(): { places, regions, locals } (locals: places on local maps,
   * { name, map, sceneId, noteId, category }); goToLocal(item): open its map, centred on it.
   */
  constructor({ getLayer, getData, goToLocal, getStreets = () => [], showStreet = null }) {
    Object.assign(this, { getLayer, getData, goToLocal, getStreets, showStreet });
    this.el = null;
    this.results = [];
    this.active = 0;
    this.onKeyDown = (e) => {
      if (!this.el) return;
      const toggle = (e.ctrlKey || e.metaKey) && !e.altKey && e.code === "KeyF";
      if (e.key !== "Escape" && !toggle) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.close();
    };
  }

  toggle() {
    if (this.el) this.close();
    else this.open();
  }

  close() {
    window.removeEventListener("keydown", this.onKeyDown, true);
    this.el?.remove();
    this.el = null;
  }

  open() {
    this.close();
    this.el = document.createElement("div");
    this.el.className = "kgr-ui kgr-panel kgr-search";
    this.el.innerHTML = `
      <div class="bar"><i class="fa-solid fa-magnifying-glass"></i><input type="text" placeholder="Search places" autocomplete="off" spellcheck="false"><button type="button" class="close" aria-label="Close search" title="Close search"><i class="fa-solid fa-xmark"></i></button></div>
      <div class="list"></div>`;
    document.body.append(this.el);
    window.addEventListener("keydown", this.onKeyDown, true);
    this.el.querySelector(".close").addEventListener("click", () => this.close());
    const input = this.el.querySelector("input");
    input.addEventListener("input", () => this.#run(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); this.#select(this.active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); this.#select(this.active - 1); }
      else if (e.key === "Enter") { e.preventDefault(); this.#pick(this.results[this.active]); }
      e.stopPropagation();
    });
    input.focus();
  }

  #inScene(item) {
    if (item.noteId) return true;
    const layer = this.getLayer();
    const b = layer?.options?.bounds;
    if (!b) return false;
    const lat = item.lat ?? (item.bounds.north + item.bounds.south) / 2, lon = item.lon ?? (item.bounds.west + item.bounds.east) / 2;
    return lat <= b.north && lat >= b.south && lon >= b.west && lon <= b.east;
  }

  #run(query) {
    const data = this.getData();
    this.results = searchWorld(query, data).map((r) => ({ ...r, here: this.#inScene(r.item) }))
      .sort((a, b) => ((a.type === "local") - (b.type === "local")) || (b.here - a.here) || (b.score - a.score));
    // The settlement's named streets, after its places: a name starting with the words typed first.
    const q = query.trim().toLowerCase().replace(/^the\s+/, "");
    if (q) this.results.push(...(this.getStreets?.() ?? []).map((s) => { const n = s.name.toLowerCase().replace(/^the\s+/, ""); return n.includes(q) ? { type: "street", item: s, here: true, score: n.startsWith(q) ? 2 : 1 } : null; })
      .filter(Boolean).sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name)).slice(0, 12));
    this.active = 0;
    const list = this.el.querySelector(".list");
    if (!query.trim()) { list.innerHTML = ""; return; }
    if (!this.results.length) { list.innerHTML = `<div class="empty">Nothing named "${esc(query)}".</div>`; return; }
    list.innerHTML = this.results.map((r, i) => {
      const it = r.item;
      const icon = r.type === "street" ? "fa-road" : r.type === "region" ? "fa-flag" : r.type === "local" ? (CATEGORIES[it.category] ?? CATEGORIES.other).icon : iconFor(it);
      const kind = { avenue: "Avenue", street: "Street", lane: "Lane", alley: "Alley" }[it.kind] ?? "Street";
      const where = r.type === "street" ? kind : r.type === "region" ? it.class : r.type === "local" ? `${(CATEGORIES[it.category] ?? CATEGORIES.other).label}, in ${it.map}` : [it.class, it.location?.split("→").pop()?.trim()].filter(Boolean).join(", ");
      return `<div class="row ${i === 0 ? "active" : ""} ${r.here ? "" : "away"}" data-i="${i}">
        <span class="ic ${it.gold ? "gold" : ""}"><i class="fa-solid ${icon}"></i></span>
        <span class="name">${esc(it.name)}</span>
        <span class="where">${esc(where ?? "")}${r.here ? "" : " · off this map"}</span></div>`;
    }).join("");
    for (const row of list.querySelectorAll(".row")) row.addEventListener("click", () => this.#pick(this.results[Number(row.dataset.i)]));
  }

  #select(i) {
    if (!this.results.length) return;
    this.active = (i + this.results.length) % this.results.length;
    for (const row of this.el.querySelectorAll(".row")) row.classList.toggle("active", Number(row.dataset.i) === this.active);
    this.el.querySelector(".row.active")?.scrollIntoView({ block: "nearest" });
  }

  async #pick(r) {
    if (!r) return;
    if (r.type === "local") { this.close(); return this.goToLocal?.(r.item); }
    if (r.type === "street") { this.close(); return this.showStreet?.(r.item.name); }
    const layer = this.getLayer();
    if (!r.here || !layer?.frame) return ui.notifications.info(`${r.item.name} is not on this map.`);
    this.close();
    const it = r.item;
    if (r.type === "region") {
      const a = latLonToScene(layer.frame, it.bounds.north, it.bounds.west), b = latLonToScene(layer.frame, it.bounds.south, it.bounds.east);
      const { width, height } = canvas.app.renderer.screen;
      const scale = Math.min(width / Math.abs(b.x - a.x), height / Math.abs(b.y - a.y)) * 0.85;
      return canvas.animatePan({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, scale: Math.max(canvas.dimensions.scale?.min ?? 0.05, scale), duration: 700 });
    }
    const at = latLonToScene(layer.frame, it.lat, it.lon);
    // Close enough that towns are named (map zoom 6.5 or more).
    const want = (512 * 2 ** 6.5) / layer.frame.k;
    await canvas.animatePan({ x: at.x, y: at.y, scale: Math.max(canvas.stage.scale.x, want), duration: 700 });
    layer.flash({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [it.lon, it.lat] } }] });
  }
}
