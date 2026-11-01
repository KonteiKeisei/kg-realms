import { ruleTooltip } from "./travel-rules.mjs";
// The map editor's Waterways tab: shorelines, rivers, trade winds and currents, and sea routes, which the travel
// panel's ships use (waterways.mjs). The map's own sea is water already; a shoreline walls off
// water no boat should cross. A line's direction is the order it was drawn in: a river flows that
// way, a trade wind or current runs that way. Click a line to select it, drag a node, click the line to add a
// node, right-click a node to remove it. Esc steps back; Ctrl+Z undoes.
import { onCanvas, RightClick } from "./canvas-input.mjs";
import {EditorFrame} from './editor-frame.mjs';
import { nearestOnLine, lineMiles, joinLines } from "./routes.mjs";
import { lonLatToSource, sourceToLonLat, SOURCE_MAP } from "./source-map.mjs";
import { WATERWAY_KINDS, SEASONS, TRADE_WIND, RIVER_CURRENT, coastSegments, waterSideOf } from "./waterways.mjs";

// A shoreline's water side (0.75), as the panel names it.
const SIDES = { left: "Left of the line as drawn", right: "Right of the line as drawn", inside: "Inside the loop", outside: "Outside the loop" };
// How near (screen px) a click to a shoreline's first point closes it into a loop.
const CLOSE_PX = 12;

const HIT_PX = 9;
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const cap = (s) => s[0].toUpperCase() + s.slice(1);

export class WaterwayEditor {
  /** getShipped(): the module's waterways for this world (async); getSea(): the travel panel's sea (the map's water, for Show the map's water); getLayer(); getWaterways(): { [id]: { kind, name, pts: [[lon, lat]], current, factor, seasons } }; saveWaterways(fn); getSeason(). */
  constructor(options) {
    Object.assign(this, options);
    this.active = false;
    this.selected = null;
    this.coords = null;
    this.draft = null;  // { kind } while drawing
    this.drag = null;
    this.node = null;
    this.hover = null;
    this.undo = [];
    this.panel = null;
    this.right = new RightClick();
    this.previewFrame = new EditorFrame(() => this.#draw());
    this.handlers = {
      pointerdown: (e) => this.#down(e), pointermove: (e) => this.#move(e), pointerup: (e) => this.#up(e),
      dblclick: (e) => this.#dbl(e), contextmenu: (e) => { if (this.active) e.preventDefault(); }
    };
    this.onKey = (e) => this.#key(e);
  }

  status() {
    const k = (this.draft ?? (this.selected ? this.all()[this.selected] : null))?.kind;
    const what = k ? WATERWAY_KINDS[k].label.toLowerCase() : "";
    if (this.draft) return { hint: `Drawing a ${what} · click to add points${k === "river" || k === "wind" ? ", in the direction it flows" : ""}${k === "shore" ? " · click its first point to close a loop" : ""} · Enter or double-click finishes`, esc: `cancels the ${what}`, tip: k === "shore" && this.coords?.length > 2 ? "Click the first point to close the loop · Enter finishes" : "Click to add a point · Enter finishes", crosshair: true };
    if (this.pickingSide) return { hint: "Click the map on the water side of this shoreline", esc: "cancels", tip: "Click the water side", crosshair: true };
    if (this.joining) return { hint: `Click another ${what} to join onto this one`, esc: "cancels joining", tip: `Click a ${what} to join it`, crosshair: true };
    const w = this.selected ? this.all()[this.selected] : null;
    if (w) return this.node !== null
      ? { hint: `${w.name || WATERWAY_KINDS[w.kind].label} · point ${this.node + 1} of ${this.coords.length}`, esc: "lets go of the point", tip: "Drag to move · Del removes this point" }
      : { hint: `${w.name || WATERWAY_KINDS[w.kind].label} · drag a point · click the line to add one`, esc: "lets go of it", tip: "Click a point to select it · click the line to add one" };
    return { hint: "Click a waterway to edit it, or draw a new one", esc: "leaves editing", tip: "" };
  }

  all() { return this.getWaterways() ?? {}; }

  async #commit(fn) {
    this.undo.push(foundry.utils.deepClone(this.all()));
    if (this.undo.length > 50) this.undo.shift();
    await this.saveWaterways(fn);
  }

  async #undo() {
    const prev = this.undo.pop();
    if (!prev) return ui.notifications.info("KG Realms: nothing to undo.");
    await this.saveWaterways(() => prev);
    if (this.selected && !prev[this.selected]) this.selected = null;
    this.node = null;
    this.refresh();
  }

  open() {
    if (this.active || !game.user.isGM || !this.getLayer()?.frame) return;
    this.active = true;
    this.offCanvas = onCanvas(this.handlers);
    window.addEventListener("keydown", this.onKey, { capture: true });
    this.#draw();
    this.#render();
    Promise.resolve(this.prepare?.()).then(() => { if (this.active) this.#render(); }).catch(() => {});
  }

  /** Whether a shoreline's water leaks round an open end (shoreWater, worked out with the terrain). */
  #leaks(id) { return (this.getLeaks?.() ?? []).includes(id); }

  close() {
    if (!this.active) return;
    this.previewFrame.clear();
    this.active = false;
    this.offCanvas?.(); this.offCanvas = null;
    window.removeEventListener("keydown", this.onKey, { capture: true });
    this.selected = this.coords = this.draft = this.drag = this.hover = this.node = null;
    this.getLayer()?.setWaterways(null);
    this.getLayer()?.setRouteEdit(null, null);
    this.panel?.remove();
    this.panel = null;
  }

  /* ------------------------------------------------------------------ geometry */

  #global(e) { const r = canvas.app.view.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  #screen(coords) { const layer = this.getLayer(); return coords.map(([lon, lat]) => layer.toScreen(lon, lat)); }
  #lineAt(g) {
    let best = null;
    for (const [id, w] of Object.entries(this.all())) {
      if (w.pts.length < 2) continue;
      const hit = nearestOnLine(this.#screen(w.pts), g);
      if (hit && hit.distance < HIT_PX && (!best || hit.distance < best.hit.distance)) best = { id, hit };
    }
    return best;
  }
  #nodeAt(g) {
    if (!this.coords) return -1;
    let bi = -1, bd = HIT_PX;
    this.#screen(this.coords).forEach((p, i) => { const d = Math.hypot(p[0] - g[0], p[1] - g[1]); if (d < bd) { bd = d; bi = i; } });
    return bi;
  }

  /* ------------------------------------------------------------------ events */

  #stop(e) { e.preventDefault(); e.stopImmediatePropagation(); }

  async #down(e) {
    if (!this.active) return;
    const g = this.#global(e), layer = this.getLayer();
    // Right-click finishes a line or removes a node; a right-drag pans the map (Foundry's) and keeps
    // drawing, so a long river is drawn in one go across the map.
    if (e.button === 2) {
      if (this.draft) return this.right.down(e, () => this.#finish());
      const i = this.#nodeAt(g);
      if (i >= 0) this.right.down(e, () => this.#removeNode(i));
      return;
    }
    if (this.draft) {
      this.#stop(e);
      if (e.button !== 0) return;
      if (this.draft.kind === "shore" && this.coords.length > 2) {
        const first = layer.toScreen(...this.coords[0]);
        if (Math.hypot(first[0] - g[0], first[1] - g[1]) < CLOSE_PX) { this.coords.push([...this.coords[0]]); return this.#finish({ closed: true }); }
      }
      this.coords.push(layer.fromScreen(...g));
      return this.#draw();
    }
    if (this.pickingSide && e.button === 0) {
      this.#stop(e);
      const w = this.all()[this.selected];
      if (!w) { this.pickingSide = false; return this.#render(); }
      const water = waterSideOf(w.pts.map((c) => lonLatToSource(c[0], c[1])), !!w.closed, lonLatToSource(...layer.fromScreen(...g)));
      this.pickingSide = false;
      this.showWater = true;
      await this.#save({ water });
      return this.#draw();
    }
    if (e.button !== 0) return;
    if (this.joining) {
      this.#stop(e);
      const other = this.#lineAt(g), me = this.all()[this.selected];
      if (!other || other.id === this.selected || this.all()[other.id]?.kind !== me?.kind) return ui.notifications.info(`KG Realms: click another ${WATERWAY_KINDS[me?.kind]?.label.toLowerCase() ?? "waterway"} to join it to this one. Esc cancels.`);
      return this.#join(other.id);
    }
    if (this.selected) {
      const i = this.#nodeAt(g);
      if (i >= 0) { this.#stop(e); this.drag = i; this.dragChanged = false; this.node = i; this.#draw(); return this.#render(); }
      const hit = nearestOnLine(this.#screen(this.coords), g);
      if (hit && hit.distance < HIT_PX) {
        this.#stop(e);
        this.coords.splice(hit.index + 1, 0, layer.fromScreen(...hit.point));
        this.drag = this.node = hit.index + 1;
        this.dragChanged = true;
        this.#draw();
        return this.#render();
      }
    }
    const line = this.#lineAt(g);
    if (line) { this.#stop(e); return this.select(line.id); }
    if (this.selected) this.select(null);
  }

  #move(e) {
    if (!this.active) return;
    const g = this.#global(e);
    if (this.drag !== null) {
      this.#stop(e);
      const next = this.getLayer().fromScreen(...g), previous = this.coords[this.drag];
      this.dragChanged ||= next[0] !== previous[0] || next[1] !== previous[1];
      this.coords[this.drag] = next;
      if (this.#closed() && (this.drag === 0 || this.drag === this.coords.length - 1)) { this.coords[0] = next; this.coords[this.coords.length - 1] = [...next]; }
      return this.previewFrame.schedule();
    }
    if (this.draft) { this.hover = this.getLayer().fromScreen(...g); this.previewFrame.schedule(); }
  }

  async #up(e) {
    if (!this.active) return;
    if (e.button === 2) return this.right.up(e);
    if (this.drag === null) return;
    this.#stop(e);
    this.drag = null;
    this.previewFrame.flush();
    if (this.dragChanged) { this.dragChanged = false; await this.#save({ pts: this.coords }); }
  }

  #dbl(e) {
    if (!this.active || !this.draft) return;
    this.#stop(e);
    if (this.coords.length > 1) { const [a, b] = this.coords.slice(-2); if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-7) this.coords.pop(); }
    this.#finish();
  }

  #key(e) {
    if (!this.active || e.target?.closest?.("input, textarea, select")) return;
    if (e.key === "Escape") {
      this.#stop(e);
      if (this.joining) { this.joining = false; return this.#render(); }
      if (this.pickingSide) { this.pickingSide = false; return this.#render(); }
      if (this.draft) return this.#cancelDraft();
      if (this.node !== null && this.selected) { this.node = null; this.#draw(); return this.#render(); }
      if (this.selected) return this.select(null);
      return this.onLeave?.();
    }
    if (e.key === "Enter" && this.draft) { this.#stop(e); return this.#finish(); }
    if ((e.key === "Delete" || e.key === "Backspace") && this.selected && this.node !== null) { this.#stop(e); return this.#removeNode(this.node); }
    if (e.code === "KeyZ" && (e.ctrlKey || e.metaKey) && !e.shiftKey && !this.draft) { this.#stop(e); this.#undo(); }
  }

  /* ------------------------------------------------------------------ edits */

  select(id) {
    this.draft = null; this.node = null; this.hover = null; this.joining = false; this.pickingSide = false;
    this.selected = id;
    const w = id ? this.all()[id] : null;
    this.coords = w ? w.pts.map((c) => [...c]) : null;
    this.#draw();
    this.#render();
  }

  startDraft(kind) {
    this.selected = null; this.node = null;
    this.draft = { kind };
    this.coords = [];
    this.#draw();
    this.#render();
  }

  #cancelDraft() { this.draft = null; this.coords = null; this.hover = null; this.#draw(); this.#render(); }

  async #finish({ closed = false } = {}) {
    const d = this.draft;
    if (!d) return;
    if (this.coords.length < 2) return this.#cancelDraft();
    const id = `ww-${foundry.utils.randomID()}`, pts = this.coords;
    const extra = d.kind === "river" ? { current: RIVER_CURRENT } : d.kind === "wind" ? { factor: TRADE_WIND, seasons: [...SEASONS] } : closed ? { closed: true } : {};
    this.draft = null; this.hover = null;
    await this.#commit((all) => ({ ...all, [id]: { kind: d.kind, name: "", pts, ...extra } }));
    this.select(id);
    // A new shoreline: which side is water, next.
    if (d.kind === "shore") { this.pickingSide = true; this.#render(); }
  }

  /** Close a shoreline into a loop (its last point joins its first), or open it again. */
  async #loop(on) {
    const w = this.all()[this.selected];
    if (!w || w.kind !== "shore") return;
    const pts = (this.coords ?? w.pts).map((c) => [...c]);
    if (on) { if (pts.length < 3) return ui.notifications.warn("KG Realms: a loop needs at least three points."); pts.push([...pts[0]]); }
    else pts.pop();
    this.coords = pts;
    // Inside and outside mean nothing on an open line: the side is asked again.
    await this.#save({ pts, closed: on || undefined, water: undefined });
    this.pickingSide = true;
    this.#draw(); this.#render();
  }

  /** Whether the selected line is a shoreline closed into a loop. */
  #closed() { return !!(this.selected && this.all()[this.selected]?.closed); }

  #removeNode(i) {
    if (this.coords.length <= (this.#closed() ? 4 : 2)) return ui.notifications.warn(`KG Realms: ${this.#closed() ? "a loop needs at least three points" : "a waterway needs at least two points"}. Delete it instead.`);
    if (this.#closed() && (i === 0 || i === this.coords.length - 1)) { this.coords.shift(); this.coords.pop(); this.coords.push([...this.coords[0]]); }
    else this.coords.splice(i, 1);
    this.node = null;
    this.#draw();
    this.#save({ pts: this.coords });
  }

  async #save(fields) {
    const id = this.selected;
    if (!id) return;
    await this.#commit((all) => ({ ...all, [id]: { ...all[id], ...fields } }));
    this.#render();
  }

  async #delete() {
    const id = this.selected, w = this.all()[id];
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: `Delete ${WATERWAY_KINDS[w.kind].label.toLowerCase()}` }, content: `<p>Delete ${w.name ? `<b>${esc(w.name)}</b>` : `this ${esc(WATERWAY_KINDS[w.kind].label.toLowerCase())}`}? Ctrl+Z undoes it.</p>`, rejectClose: false });
    if (!ok) return;
    this.select(null);
    await this.#commit((all) => { const c = { ...all }; delete c[id]; return c; });
    this.#render();
  }

  /**
   * Join another waterway of the same kind to the selected one. The selected line's nearer end goes
   * to the other line's nearest node. When that node is one of its ends the two become one line, the
   * selected one's name and settings (a river or wind keeps its own direction; the other is turned
   * to match). When it is a node in the middle of its run, the selected line ends on it and both
   * stay: a tributary into its river, or a wind or route feeding another part way along.
   */
  async #join(otherId) {
    const id = this.selected, all = this.all(), me = all[id], other = all[otherId];
    if (!me || !other) return;
    const mine = this.coords ?? me.pts, toSheet = (lon, lat) => lonLatToSource(lon, lat);
    const mpp = SOURCE_MAP.milesPerPixel;
    // The other line's node nearest either end of this one.
    let near = null;
    for (const [end, p] of [["start", mine[0]], ["end", mine.at(-1)]]) {
      const a = toSheet(...p);
      other.pts.forEach((c, k) => { const b = toSheet(...c), d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (!near || d < near.d) near = { end, k, d }; });
    }
    if (near && near.k > 0 && near.k < other.pts.length - 1) {
      const miles = near.d * mpp;
      if (miles > 3) {
        const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Join" }, content: `<p>The nearest node is ${miles.toFixed(1)} miles away. Join to it with a straight piece?</p>`, rejectClose: false });
        if (!ok) return;
      }
      const node = [...other.pts[near.k]], pts = near.end === "end" ? [...mine, node] : [node, ...mine];
      // Replace an end lying almost on the node rather than adding a stub.
      if (miles < 0.3) pts.splice(near.end === "end" ? pts.length - 2 : 1, 1);
      this.joining = false;
      this.coords = pts;
      await this.#commit((w) => ({ ...w, [id]: { ...w[id], pts } }));
      this.select(id);
      return ui.notifications.info(`KG Realms: joined to ${other.name || `the ${WATERWAY_KINDS[other.kind].label.toLowerCase()}`} part way along.`);
    }
    let j = joinLines(mine, other.pts, toSheet);
    if (["river", "wind"].includes(me.kind)) {
      // Keep this line's direction: the other goes after it or before it, whichever ends are nearer.
      const d = (p, q) => { const a = toSheet(...p), b = toSheet(...q); return Math.hypot(a[0] - b[0], a[1] - b[1]); };
      const o = other.pts, ro = [...o].reverse(), cands = [
        { gap: d(mine.at(-1), o[0]), coordinates: [...mine, ...o] }, { gap: d(mine.at(-1), ro[0]), coordinates: [...mine, ...ro] },
        { gap: d(o.at(-1), mine[0]), coordinates: [...o, ...mine] }, { gap: d(ro.at(-1), mine[0]), coordinates: [...ro, ...mine] }
      ];
      j = cands.sort((a, b) => a.gap - b.gap)[0];
    }
    const miles = j.gap * SOURCE_MAP.milesPerPixel;
    if (miles > 3) {
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Join" }, content: `<p>The nearest ends are ${miles.toFixed(1)} miles apart. Join them with a straight piece?</p>`, rejectClose: false });
      if (!ok) return;
    }
    this.joining = false;
    this.coords = j.coordinates;
    await this.#commit((w) => { const c = { ...w, [id]: { ...w[id], name: w[id].name || other.name || "", pts: j.coordinates } }; delete c[otherId]; return c; });
    this.select(id);
    ui.notifications.info(`KG Realms: joined into one ${WATERWAY_KINDS[me.kind].label.toLowerCase()}.`);
  }

  /**
   * The module's waterways are always in use, with this world's changes on top. This takes the
   * changes off: the module's lines as they come, and none of the world's own (after asking;
   * Ctrl+Z puts them back).
   */
  async #useShipped() {
    const shipped = await this.getShipped?.();
    const n = Object.keys(shipped ?? {}).length;
    if (!n) return ui.notifications.info("KG Realms: the module has no waterways for this world.");
    const all = this.all(), own = Object.keys(all).filter((id) => !shipped[id]).length;
    const changed = Object.keys(shipped).filter((id) => JSON.stringify(all[id]) !== JSON.stringify(shipped[id])).length;
    if (!own && !changed) return ui.notifications.info("KG Realms: this world's waterways are already the module's.");
    const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Back to the module's waterways" }, content: `<p>Go back to the module's ${n} waterways? ${[own ? `${own} line${own === 1 ? "" : "s"} of this world's own will be removed` : "", changed ? `${changed} of the module's, changed or deleted here, will be as the module has them` : ""].filter(Boolean).join(", and ")}. Ctrl+Z puts them back.</p>`, rejectClose: false });
    if (!ok) return;
    this.select(null);
    await this.#commit(() => foundry.utils.deepClone(shipped));
    ui.notifications.info(`KG Realms: the module's ${n} waterways.`);
  }

  /** The edge of the water boats can use, as [lon, lat] segments (worked out once per change of the water). */
  #coast() {
    const sea = this.getSea?.();
    if (!sea) return null;
    if (this.coastFor !== sea) { this.coastFor = sea; this.coastCache = coastSegments(sea).map((s) => s.map((p) => sourceToLonLat(p[0], p[1]))); }
    return this.coastCache;
  }

  export() {
    foundry.utils.saveDataToFile(JSON.stringify({ type: "kg-realms-waterways", version: game.modules.get("kg-realms").version, waterways: this.all() }, null, 1), "application/json", "waterways.json");
  }

  import() {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      try {
        const data = JSON.parse(await input.files[0].text());
        if (data?.type !== "kg-realms-waterways" || typeof data.waterways !== "object") throw new Error("not a KG Realms waterways file");
        await this.#commit(() => data.waterways);
        this.select(null);
        ui.notifications.info(`KG Realms: imported ${Object.keys(data.waterways).length} waterways.`);
      } catch (err) { ui.notifications.error(`KG Realms: could not import waterways (${err.message}).`); }
    });
    input.click();
  }

  /* ------------------------------------------------------------------ drawing */

  #draw() {
    const layer = this.getLayer();
    if (!layer || !this.active) return;
    const list = Object.entries(this.all()).map(([id, w]) => ({ id, ...w, pts: id === this.selected && this.coords ? this.coords : w.pts }));
    if (this.draft && this.coords?.length) list.push({ id: "draft", kind: this.draft.kind, name: "", pts: this.hover ? [...this.coords, this.hover] : this.coords });
    layer.setWaterways(list, this.selected ?? (this.draft ? "draft" : null), this.showWater ? this.#coast() : null);
    layer.setRouteEdit(null, this.coords ?? null, this.node);
  }

  /** The group names in use for a kind of waterway (a river and its tributaries, say), sorted. */
  #groups(kind) {
    return [...new Set(Object.values(this.all()).filter((x) => x.kind === kind && x.group).map((x) => x.group))].sort((a, b) => a.localeCompare(b));
  }

  /** Which sections of the list are open: kept per GM in this browser. Keys "kind:<kind>" and "group:<kind>:<name>". */
  get #open() {
    if (!this.openSections) { try { this.openSections = new Set(JSON.parse(localStorage.getItem("kgr-ww-open") ?? "[]")); } catch { this.openSections = new Set(); } }
    return this.openSections;
  }
  #setOpen(key, on) {
    const s = this.#open;
    if (on) s.add(key); else s.delete(key);
    try { localStorage.setItem("kgr-ww-open", JSON.stringify([...s])); } catch { /* storage off */ }
  }

  /**
   * The waterways on this map, a collapsible section for each kind (rivers, shorelines, winds and
   * currents, sea routes), the GM's groups inside each (a river with its tributaries), then the rest.
   * The section and group of the selected line open with it.
   */
  #list(all) {
    const PLURAL = { river: "Rivers", shore: "Shorelines", wind: "Winds and currents", lane: "Sea routes" };
    const sel = this.selected ? all[this.selected] : null;
    const label = (x) => x.name || `Unnamed ${WATERWAY_KINDS[x.kind].label.toLowerCase()}`;
    const meta = (x) => (x.kind === "wind" ? (!x.seasons || x.seasons.length === 4 ? "All year" : x.seasons.length ? x.seasons.map(cap).join(", ") : "Never") : x.kind === "river" ? (x.navigable === false ? "No boats" : `${x.current ?? RIVER_CURRENT} mph`) : WATERWAY_KINDS[x.kind].label);
    const row = ([id, x]) => `<button data-act="pick" data-id="${esc(id)}" class="${id === this.selected ? "on" : ""}"><span class="sw" style="background:${WATERWAY_KINDS[x.kind].color}"></span><span class="grow">${esc(label(x))}</span>${x.kind === "shore" && this.#leaks(id) ? '<i class="fa-solid fa-triangle-exclamation kgr-leak" title="Its water leaks round an open end into the land"></i>' : ""}<small>${meta(x)}</small></button>`;
    // In a group the line named for it (the main river: "Dessarin River" in Dessarin) comes first, then the rest by name.
    const main = (x, g) => !!g && (x.name ?? "").toLowerCase().includes(g.toLowerCase());
    const order = (g) => (a, b) => main(b[1], g) - main(a[1], g) || label(a[1]).localeCompare(label(b[1]));
    const sections = ["river", "shore", "wind", "lane"].map((kind) => {
      const rows = Object.entries(all).filter(([, x]) => x.kind === kind);
      if (!rows.length) return "";
      const kKey = `kind:${kind}`, kOpen = this.#open.has(kKey) || sel?.kind === kind;
      const groups = this.#groups(kind).map((g) => {
        const inG = rows.filter(([, x]) => x.group === g).sort(order(g)), gKey = `group:${kind}:${g}`, gOpen = this.#open.has(gKey) || (sel?.kind === kind && sel.group === g);
        return `<details class="kgr-ww-group" data-key="${esc(gKey)}" ${gOpen ? "open" : ""}><summary><i class="fa-solid fa-caret-right"></i><i class="fa-regular fa-folder${gOpen ? "-open" : ""}"></i><span class="grow">${esc(g)}</span><small>${inG.length}</small><span class="kgr-ww-rename" role="button" tabindex="0" data-act="group-rename" data-kind="${kind}" data-group="${esc(g)}" title="Rename this group, or ungroup it"><i class="fa-solid fa-pen"></i></span></summary>${inG.map(row).join("")}</details>`;
      }).join("");
      const loose = rows.filter(([, x]) => !x.group).sort(order(null)).map(row).join("");
      return `<details class="kgr-ww-kind" data-key="${kKey}" ${kOpen ? "open" : ""}><summary><i class="fa-solid fa-caret-right"></i><span class="sw" style="background:${WATERWAY_KINDS[kind].color}"></span><span class="grow">${PLURAL[kind]}</span><small>${rows.length}</small></summary><div class="kgr-ww-body">${groups}${loose}</div></details>`;
    }).join("");
    return `<div class="kgr-water-list"><span class="cap">On this map</span>${sections}</div>`;
  }

  /** Rename a group (every line in it), or ungroup them with an empty name. */
  async #renameGroup(kind, from) {
    const to = await foundry.applications.api.DialogV2.prompt({
      window: { title: "Rename group" },
      content: `<label>Name <input type="text" name="name" value="${esc(from)}" autofocus></label><p class="hint">Leave it empty to ungroup its lines.</p>`,
      ok: { label: "Rename", callback: (ev, b) => b.form?.elements.name?.value.trim() ?? from },
      rejectClose: false
    }).catch(() => null);
    if (to == null || to === from) return;
    const keep = this.#open.has(`group:${kind}:${from}`);
    await this.#commit((all) => Object.fromEntries(Object.entries(all).map(([id, x]) => [id, x.kind === kind && x.group === from ? (to ? { ...x, group: to } : (({ group, ...rest }) => rest)(x)) : x])));
    if (keep && to) this.#setOpen(`group:${kind}:${to}`, true);
    this.#render();
  }

  #render() {
    if (!this.active) return;
    if (!this.panel) {
      this.panel = document.createElement("div");
      this.panel.className = "kgr-tab kgr-water-tab";
      (this.host ?? document.body).append(this.panel);
      this.panel.addEventListener("click", (e) => this.#click(e));
      this.panel.addEventListener("change", (e) => this.#change(e));
      // A section opened or closed stays so (toggle does not bubble: listen as it goes down).
      this.panel.addEventListener("toggle", (e) => { const d = e.target; if (d.matches?.("details[data-key]")) this.#setOpen(d.dataset.key, d.open); }, true);
    }
    const all = this.all(), w = this.selected ? all[this.selected] : null, season = this.getSeason?.() ?? "";
    const tools = `<div class="kgr-water-tools">${Object.entries(WATERWAY_KINDS).map(([k, v]) => `<button data-act="new" data-kind="${k}" class="${this.draft?.kind === k ? "on" : ""}" title="Draw a ${v.label.toLowerCase()}"><i class="fa-solid ${v.icon}"></i> ${v.label}</button>`).join("")}</div>`;
    let body;
    if (this.draft) {
      body = `<p class="hint">Click to add points${["river", "wind"].includes(this.draft.kind) ? " in the direction it flows" : ""}. Double-click, right-click or Enter finishes; Esc cancels.</p>
        <div class="row"><button data-act="finish"><i class="fa-solid fa-check"></i> Finish</button><button data-act="cancel"><i class="fa-solid fa-xmark"></i> Cancel</button></div>`;
    } else if (w) {
      const miles = lineMiles(this.coords ?? w.pts, lonLatToSource, SOURCE_MAP.milesPerPixel);
      const k = WATERWAY_KINDS[w.kind];
      const dir = (() => { const a = lonLatToSource(...w.pts[0]), b = lonLatToSource(...w.pts.at(-1)), ang = Math.atan2(-(b[1] - a[1]), b[0] - a[0]) * 180 / Math.PI; return ["east", "north-east", "north", "north-west", "west", "south-west", "south", "south-east"][((Math.round(ang / 45) % 8) + 8) % 8]; })();
      const rule = ruleTooltip;
      const blows = !w.seasons || w.seasons.includes(season);
      body = `<div class="kgr-enc-box"><span class="cap">Selected ${esc(k.label.toLowerCase())}</span>
        <div class="row"><label>Name <input type="text" name="name" value="${esc(w.name ?? "")}" placeholder="Unnamed"></label></div>
        <div class="row"><label>Group <input type="text" name="group" list="kgr-ww-groups" value="${esc(w.group ?? "")}" placeholder="None (type a name to make one)"></label></div>
        <datalist id="kgr-ww-groups">${this.#groups(w.kind).map((g) => `<option value="${esc(g)}"></option>`).join("")}</datalist>
        ${w.kind === "river" || w.kind === "wind" ? `<div class="row"><span class="grow">${w.kind === "river" ? "Flows" : "Blows"} ${dir}</span><button data-act="reverse" title="Turn it round">Reverse</button></div>` : ""}
        ${w.kind === "river" ? `<div class="row"><label>Current <input type="number" name="current" min="0" max="10" step="0.5" value="${w.current ?? RIVER_CURRENT}"> mph</label>${rule("<p><strong>Boat speed</strong> Add current speed downstream. Subtract it upstream, to a minimum of 0.5 mph.</p><p><strong>Suggested current (mph)</strong> Slow river: 1.5. Light stream: 2. Navigable river: 2.5-3. Swift or white water: 3.5-4.5. Torrent: 8.</p>")}</div>
          <label class="kgr-water-show"><input type="checkbox" name="navigable" ${w.navigable === false ? "" : "checked"}> Boats can use it</label>
          ${w.note ? `<span class="hint">${esc(w.note)}</span>` : ""}` : ""}
        ${w.kind === "wind" ? `<div class="row"><label>Speed <input type="number" name="factor" min="1" max="3" step="0.1" value="${w.factor ?? TRADE_WIND}"> times a ship's speed</label>${rule("<p><strong>Range</strong> 250 miles to either side of the line.</p><p><strong>Direction</strong> With the wind: use this multiplier. Against it: half speed. Across it: normal speed. Intermediate headings scale between these values.</p><p><strong>Seasons</strong> Outside the selected seasons, treat it as open sea.</p>")}</div>
          <div class="kgr-seasons"><span>Blows in</span>${SEASONS.map((s) => `<label><input type="checkbox" name="season" value="${s}" ${!w.seasons || w.seasons.includes(s) ? "checked" : ""}> ${cap(s)}</label>`).join("")}</div>
          <span class="hint">Now ${esc(season)}: ${blows ? "blowing" : "not blowing, open sea"}.</span>` : ""}
        ${w.kind === "shore" ? this.#shoreRows(w) : w.kind === "lane" ? `<span class="hint">Ships keep to it where it is about as quick.</span>` : ""}
        <span class="hint">${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi · ${(this.coords ?? w.pts).length} points${this.node !== null ? ` · point ${this.node + 1} selected` : ""}</span>
        ${this.joining ? `<p class="hint"><i class="fa-solid fa-link"></i> Click another ${esc(k.label.toLowerCase())} to join onto this one. Esc cancels.</p><div class="row"><button data-act="join-cancel">Cancel joining</button></div>`
          : `<div class="row"><button data-act="join" title="Join another ${esc(k.label.toLowerCase())} onto this one, end to end"><i class="fa-solid fa-link"></i> Join</button><button data-act="delete" class="danger"><i class="fa-solid fa-trash"></i> Delete</button><span class="sp"></span><button data-act="deselect">Done</button></div>`}</div>`;
    } else {
      body = `<p class="hint">A shoreline is a wall no boat crosses. Give it a water side and it also says where the sea or a lake is: the water runs out from that side to the next shoreline or the map's edge. A map made from your own picture knows its water only this way. Close a shoreline into a loop for an island or a lake. Turn on Show the map's water to see it.</p>`;
    }
    const leaking = Object.entries(all).filter(([id, x]) => x.kind === "shore" && this.#leaks(id)).length;
    const leakNote = leaking && !w ? `<p class="warn kgr-leak-warn"><i class="fa-solid fa-triangle-exclamation"></i> ${leaking} shoreline${leaking === 1 ? "'s water leaks" : "s' water leaks"} into the land (marked in the list). Select one to see how to fix it.</p>` : "";
    const water = `<label class="kgr-water-show"><input type="checkbox" name="show-water" ${this.showWater ? "checked" : ""}> Show the map's water <small>(the edge boats can reach)</small></label>`;
    const list = Object.keys(all).length ? this.#list(all) : "";
    const files = `<div class="kgr-file-row"><button data-act="undo" title="Undo (Ctrl+Z)"><i class="fa-solid fa-rotate-left"></i> Undo</button><button data-act="shipped" title="Undo every change this world made to the module's waterways, and remove its own lines"><i class="fa-solid fa-water"></i> Back to the module's waterways</button><button data-act="export" title="Save every waterway to a file"><i class="fa-solid fa-file-export"></i> Export</button><button data-act="import" title="Load waterways from a file"><i class="fa-solid fa-file-import"></i> Import</button></div>`;
    this.panel.innerHTML = `${tools}${leakNote}${water}${body}${this.draft ? "" : list}${files}`;
    this.onStatus?.();
  }

  /** A shoreline's water side and loop controls. */
  #shoreRows(w) {
    const rule = ruleTooltip("<p><strong>Water side</strong> The side of the shoreline that is sea or lake. The water runs out from it until it meets another shoreline or the map's edge, so a shoreline should end off the map's edge, join another, or close into a loop (an island or a lake).</p><p><strong>Uses</strong> Ships sail only on water; snow lies only on land.</p><p><strong>Not set</strong> The shoreline is only a wall no boat crosses; the map's own water stays as it is.</p>");
    const sides = w.closed ? ["inside", "outside"] : ["left", "right"];
    const leak = this.selected && this.#leaks(this.selected) ? `<p class="warn kgr-leak-warn"><i class="fa-solid fa-triangle-exclamation"></i> Its water leaks: the sea runs round an open end (or through a gap) into the land on its other side, and that land counts as water for ships, roads and snow. Run its ends off the map's edge, join them to another shoreline, close it into a loop, or set its water side to Not set.</p>` : "";
    return `${leak}<span class="hint">No boat crosses it.${w.closed ? " A loop: an island or a lake." : ""}</span>
      <div class="row"><label>Water side <select name="water"><option value="">Not set</option>${sides.map((s) => `<option value="${s}" ${w.water === s ? "selected" : ""}>${SIDES[s]}</option>`).join("")}</select></label>${rule}</div>
      ${this.pickingSide ? `<p class="kgr-sel node"><i class="fa-solid fa-hand-pointer"></i> Click the map on the water side of this shoreline. Esc cancels.</p>` : ""}
      <div class="row">${w.water && !this.pickingSide ? `<button data-act="pick-side" class="kgr-water-set" data-tooltip="Click again to change the water side"><i class="fa-solid fa-check"></i> Water side set</button>` : `<button data-act="pick-side" class="${this.pickingSide ? "on" : ""}"><i class="fa-solid fa-hand-pointer"></i> Click the water side</button>`}${w.closed ? `<button data-act="unloop" title="Take out the join between its last point and its first"><i class="fa-solid fa-link-slash"></i> Open the loop</button>` : (this.coords ?? w.pts).length > 2 ? `<button data-act="loop" title="Join its last point to its first: an island or a lake"><i class="fa-solid fa-circle-notch"></i> Close into a loop</button>` : ""}</div>`;
  }

  #click(e) {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    // The pencil sits in a section's summary: renaming must not also open or close it.
    if (act === "group-rename") { e.preventDefault(); e.stopPropagation(); return this.#renameGroup(b.dataset.kind, b.dataset.group); }
    if (act === "new") return this.startDraft(b.dataset.kind);
    if (act === "pick") return this.select(b.dataset.id);
    ({
      finish: () => this.#finish(), cancel: () => this.#cancelDraft(), undo: () => this.#undo(), export: () => this.export(), import: () => this.import(),
      delete: () => this.#delete(), deselect: () => this.select(null), shipped: () => this.#useShipped(),
      join: () => { this.joining = true; this.node = null; this.#draw(); this.#render(); }, "join-cancel": () => { this.joining = false; this.#render(); },
      "pick-side": () => { this.pickingSide = !this.pickingSide; this.#render(); }, loop: () => this.#loop(true), unloop: () => this.#loop(false),
      reverse: () => { this.coords = [...(this.coords ?? this.all()[this.selected].pts)].reverse(); this.#draw(); this.#save({ pts: this.coords }); }
    })[act]?.();
  }

  #change(e) {
    const t = e.target, w = this.selected ? this.all()[this.selected] : null;
    if (t.name === "show-water") { this.showWater = t.checked; if (t.checked && !this.getSea?.()) ui.notifications.info("KG Realms: the map's water is still loading; try again in a moment."); return this.#draw(); }
    if (!w) return;
    if (t.name === "name") this.#save({ name: t.value.trim() });
    if (t.name === "water") { if (t.value) this.showWater = true; this.#save({ water: t.value || undefined }); this.#draw(); }
    // A group is only a name the lines share: typing a new one makes it.
    if (t.name === "group") { const g = t.value.trim(); if (g) this.#setOpen(`group:${w.kind}:${g}`, true); this.#save({ group: g || undefined }); }
    if (t.name === "current") this.#save({ current: Math.max(0, Math.min(10, Number(t.value) || 0)) });
    if (t.name === "navigable") this.#save({ navigable: t.checked ? undefined : false });
    if (t.name === "factor") this.#save({ factor: Math.max(1, Math.min(3, Number(t.value) || TRADE_WIND)) });
    if (t.name === "season") this.#save({ seasons: [...this.panel.querySelectorAll('[name="season"]:checked')].map((x) => x.value) });
  }

  /** Redraw after the waterways changed elsewhere. */
  refresh() {
    if (!this.active) return;
    if (this.selected && this.drag === null) {
      const w = this.all()[this.selected];
      if (!w) this.selected = null;
      this.coords = w ? w.pts.map((c) => [...c]) : (this.draft ? this.coords : null);
    }
    this.#draw();
    this.#render();
  }
}
