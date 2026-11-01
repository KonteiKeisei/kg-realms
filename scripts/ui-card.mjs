// The hover card on a region's places, for everyone: a quick preview. A double-click on a place
// opens its place card (place-card.mjs), for the GM and players alike.

import { metres, sceneToLatLon } from "./geo.mjs";
import { sourceMiles } from './source-map.mjs';
import { excerptHtml } from "./place-card.mjs";
import { tradeSection, fitTradeRows } from "./ui-trade.mjs";

const CLICK_PX = 6;
const CLICK_MS = 500;
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const ICONS = {
  City: "fa-city", Town: "fa-house-chimney", Village: "fa-house", Fortification: "fa-chess-rook", Ruins: "fa-dungeon",
  Battlefield: "fa-khanda", Mine: "fa-hammer", Temple: "fa-place-of-worship", Tomb: "fa-skull", Inn: "fa-beer-mug-empty",
  Cave: "fa-mountain", Cavern: "fa-mountain", Volcano: "fa-volcano", Portal: "fa-circle-notch", Shipwreck: "fa-anchor",
  Rapids:"fa-water",Waterfall:"fa-water",Oasis: "fa-tree", "Water Source": "fa-droplet", Pass: "fa-route", Bay: "fa-water", Island: "fa-umbrella-beach"
  ,Forest:"fa-tree",Mountains:"fa-mountain",Hills:"fa-mountain",River:"fa-water",Lake:"fa-water",Sea:"fa-water",Ocean:"fa-water",Marsh:"fa-water",Swamp:"fa-water",Desert:"fa-sun",Glacier:"fa-snowflake",Region:"fa-map",Road:"fa-route",Trail:"fa-route",Lair:"fa-dungeon",Hamlet:"fa-house",Keep:"fa-chess-rook",Fort:"fa-chess-rook",Ruin:"fa-dungeon",Islands:"fa-umbrella-beach"
};
export const iconFor = (p) => ICONS[p.class] ?? (p.kind === "settlement" ? "fa-house" : "fa-location-dot");
const MILES = 1609.344;
/** A place's local map scene (its linked scene, made its local map), and how many places it shows. */
function localMap(p) {
  const scene = p.scene ? game.scenes.get(p.scene) : null, map = scene?.getFlag("kg-realms", "localMap");
  if (!map || map.placeId !== p.id) return null;
  const places = scene.notes.filter((n) => { const r = n.getFlag("kg-realms", "local"); return r && (game.user.isGM || r.visibility !== "hidden"); }).length;
  return { scene, places };
}

const DOUBLE_MS = 450;

export class PlaceCard {
  /** getPlace(id): the place with edits; openCard(id): its place card. */
  constructor({ getPlace, openCard, getTrade, editTrade, isBlocked, hoverDelayMs = () => 750 }) {
    Object.assign(this, { getPlace, openCard, getTrade, editTrade, isBlocked, hoverDelayMs });
    this.lastClick = null;
    this.layer = null;
    this.el = null;
    this.cue = null;
    this.cursorBefore = null;
    this.hovered = null;
    this.click = null;
    this.frame = 0;
    this.hoverTimer = null;
    this.candidate = null;
    this.pointerAt = null;
    this.pointerGlobal = null;
    this.onMove = (e) => this.#move(e);
    this.onLeave = () => this.#scheduleHide();
    this.onDown = (e) => this.#down(e);
    this.onUp = (e) => this.#up(e);
  }

  attach(layer) {
    this.detach();
    this.layer = layer;
    canvas.stage.on("pointermove", this.onMove);
    canvas.stage.on("pointerdown", this.onDown);
    canvas.stage.on("pointerup", this.onUp);
    canvas.stage.on("pointerleave", this.onLeave);
  }

  detach() {
    canvas?.stage?.off("pointermove", this.onMove);
    canvas?.stage?.off("pointerdown", this.onDown);
    canvas?.stage?.off("pointerup", this.onUp);
    canvas?.stage?.off("pointerleave", this.onLeave);
    this.hide();
    this.layer = null;
  }

  hide() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    clearTimeout(this.hoverTimer);
    clearTimeout(this.hideTimer);
    this.hideTimer = null;
    this.resize?.disconnect(); this.resize = null;
    this.hoverTimer = null;
    this.candidate = null;
    this.#clearCue();
    if (this.cursorBefore !== null) {
      canvas.app.view.style.cursor = this.cursorBefore;
      this.cursorBefore = null;
    }
    this.el?.remove();
    this.el = null;
    this.hovered = null;
    this.onCard = false;
  }

  #scheduleHide() {
    if (this.onCard || this.el?.contains?.(document.activeElement)) return;
    if (!this.el) return this.hide();
    if (!this.hideTimer) this.hideTimer = setTimeout(() => { this.hideTimer = null; this.hide(); }, 300);
  }

  /**
   * The topmost element under the pointer. The native event's target is already that element
   * (Pixi listens on the document), so no hit test is needed; elementFromPoint forces a layout and
   * walks the whole page. Without a native target, the hit test is the fallback.
   */
  #topAt(event) {
    const target = event.nativeEvent?.target;
    if (target?.nodeType === 1) return target;
    const c = event.client ?? event.nativeEvent;
    return c ? document.elementFromPoint(c.clientX ?? c.x, c.clientY ?? c.y) : null;
  }

  /** The pointer is on bare map: no window, sidebar or HUD above it, and no token under it. */
  #onMap(top) {
    if (top && top !== canvas.app.view) return false;
    for (const layer of [canvas.tokens, canvas.notes, canvas.drawings, canvas.tiles, canvas.templates]) if (layer?.hover) return false;
    return true;
  }

  #move(event) {
    if (this.isBlocked?.()) return this.hide();
    const top = this.#topAt(event);
    this.pointerOnMap = false;
    if (top && this.el?.contains?.(top)) { clearTimeout(this.hideTimer); this.hideTimer = null; return; }
    if (!this.#onMap(top)) return this.#scheduleHide();
    this.pointerOnMap = true;
    const global = { x: event.global.x, y: event.global.y };
    const at = event.getLocalPosition(canvas.stage);
    this.pointerAt = at;
    this.pointerGlobal = global;
    // Pixi reuses its event objects: keep where the pointer was on the page, not the event.
    const c = event.client ?? event.nativeEvent;
    this.pointerClient = c ? { x: c.clientX ?? c.x, y: c.clientY ?? c.y } : null;
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.isBlocked?.()) return this.hide();
      // The latest move's answer: no second hit test.
      if (!this.pointerOnMap) return;
      const id = this.layer?.placeAt(this.pointerAt, 7) ?? null;
      const p = id ? this.getPlace(id) : null;
      if (!p || (p.hidden && !game.user.isGM)) return this.#scheduleHide();
      clearTimeout(this.hideTimer); this.hideTimer = null;
      if (this.hovered === id) return this.#show(p, this.pointerGlobal);
      if (this.candidate === id) return this.#positionCue(this.pointerGlobal);
      this.hide();
      this.candidate = id;
      const delay = Math.max(0, Number(this.hoverDelayMs()) || 0);
      this.#showCue(p, this.pointerGlobal, delay);
      this.hoverTimer = setTimeout(() => {
        this.hoverTimer = null;
        // Once per hover, a real hit test: a window may have opened under the pointer since.
        const c = this.pointerClient, top = c ? document.elementFromPoint(c.x, c.y) : null;
        if (this.candidate !== id || !this.layer || this.isBlocked?.() || !this.pointerOnMap || !this.#onMap(top)) return this.hide();
        if (!this.pointerAt || this.layer.placeAt(this.pointerAt, 7) !== id) return this.hide();
        this.#show(p, this.pointerGlobal);
      }, delay);
    });
  }

  #showCue(p, global, delay) {
    if (this.cursorBefore === null) {
      this.cursorBefore = canvas.app.view.style.cursor || "";
      canvas.app.view.style.cursor = "pointer";
    }
    this.cue = document.createElement("div");
    this.cue.className = "kgr-ui kgr-hover-cue";
    this.cue.innerHTML = `<strong>${esc(p.name)}</strong><span>Place card opening</span>`;
    this.cue.style.setProperty("--kgr-hover-delay", `${delay}ms`);
    document.body.append(this.cue);
    this.#positionCue(global);
  }

  #positionCue(global) {
    if (!this.cue) return;
    const rect = canvas.app.view.getBoundingClientRect();
    const w = this.cue.offsetWidth || 180, h = this.cue.offsetHeight || 46;
    let left = rect.left + global.x + 18, top = rect.top + global.y + 18;
    if (left + w > window.innerWidth - 8) left = rect.left + global.x - w - 18;
    if (top + h > window.innerHeight - 8) top = rect.top + global.y - h - 18;
    this.cue.style.left = `${Math.max(8, left)}px`;
    this.cue.style.top = `${Math.max(8, top)}px`;
  }

  #clearCue() {
    this.cue?.remove();
    this.cue = null;
  }

  /** Miles from the user's selected token (or their character's), or null. */
  #distance(p) {
    const token = canvas.tokens?.controlled[0] ?? game.user.character?.getActiveTokens()[0];
    if (!token || !this.layer?.frame) return null;
    const origin = sceneToLatLon(this.layer.frame, token.center);
    const m = this.layer.options.sourceMap ? sourceMiles(origin, p) : metres(origin, p) / MILES;
    return m < 1 ? "under a mile" : `${m < 10 ? m.toFixed(1) : Math.round(m).toLocaleString()} mi`;
  }

  #show(p, global) {
    this.#clearCue();
    if (!this.el) {
      this.el = document.createElement("div");
      document.body.append(this.el);
      this.el.addEventListener?.("pointerenter", () => { this.onCard = true; clearTimeout(this.hideTimer); this.hideTimer = null; });
      this.el.addEventListener?.("pointerleave", () => { this.onCard = false; this.#scheduleHide(); });
      this.el.addEventListener?.("focusin", () => { clearTimeout(this.hideTimer); this.hideTimer = null; });
      this.el.addEventListener?.("focusout", event => { if (!this.el?.contains(event.relatedTarget)) this.#scheduleHide(); });
      this.el.addEventListener?.("click", event => {
        const action = event.target.closest("[data-act]")?.dataset.act;
        if (!action) return;
        event.preventDefault(); event.stopPropagation();
        const p = this.getPlace(this.hovered);
        if (action === "trade-edit") { if (p && game.user.isGM) { this.hide(); this.editTrade?.(p); } }
        else if (action === "trade-more" || action === "trade-price") this.open(this.hovered);
      });
      this.el.addEventListener?.("dblclick", event => { event.preventDefault(); event.stopPropagation(); this.open(this.hovered); });
    }
    if (this.hovered !== p.id) {
      this.hovered = p.id;
      const rumoured = !game.user.isGM && p.visibility === "rumoured";
      const excerpt = rumoured ? (excerptHtml(p.rumours) || "Only rumours so far.") : (excerptHtml(p.known) || excerptHtml(p.summary) || excerptHtml(p.descr));
      const img = rumoured ? null : p.img;
      const distance = this.#distance(p);
      const where = [p.location, p.level === "underdark" ? "Underdark" : null].filter(Boolean).join(" · ");
      const meta = [
        where ? `<span><i class="fa-solid fa-map"></i>${esc(where)}</span>` : "",
        distance ? `<span><i class="fa-solid fa-person-walking"></i>${esc(distance)} away</span>` : "",
        p.factions ? `<span class="wide"><i class="fa-solid fa-flag"></i>${esc(p.factions.split(",").slice(0, 4).join(", "))}</span>` : ""
      ].join("");
      const badge = `<span class="badge ${p.gold ? "gold" : ""}"><i class="fa-solid ${iconFor(p)}"></i>${esc(p.class ?? "Place")}</span>`;
      this.el.className = `kgr-ui kgr-panel kgr-card ${img ? "" : "small"}`;
      this.el.innerHTML = `
        ${img ? `<div class="art" style="background-image:url('${esc(foundry.utils.getRoute(img))}')">${badge}</div>` : ""}
        <div class="body ${img ? "" : "top"}">
          ${img ? "" : `<div>${badge}</div>`}
          <h3 class="${p.gold ? "gold" : ""}">${esc(p.name)}</h3>
          ${p.alt ? `<p class="sub">${esc(p.alt)}</p>` : ""}
          ${excerpt ? `<p>${excerpt}</p>` : ""}
          ${meta ? `<div class="meta">${meta}</div>` : ""}
          <div class="kgr-hover-trade"></div>
        </div>
        ${this.#foot(p)}`;
      if (!rumoured && this.getTrade) {
        const el = this.el, gm = game.user.isGM;
        Promise.resolve().then(() => this.getTrade(p)).then(market => {
          if (this.el !== el || this.hovered !== p.id || gm !== game.user.isGM) return;
          if (!market) return;
          const box = el.querySelector(".kgr-hover-trade"); if (!box) return;
          box.innerHTML = tradeSection(market, gm, { compact: true });
          fitTradeRows(el); this.#position(this.pointerGlobal ?? global);
          if (typeof ResizeObserver !== "undefined") {
            let width = el.clientWidth;
            this.resize = new ResizeObserver(() => { if (el.clientWidth !== width) { width = el.clientWidth; fitTradeRows(el); } this.#position(this.pointerGlobal ?? global); });
            this.resize.observe(el);
          }
          document.fonts?.ready.then(() => { if (this.el === el) { fitTradeRows(el); this.#position(this.pointerGlobal ?? global); } });
        }).catch(error => console.warn("kg-realms | hover trade:", error));
      }
    }
    this.#position(global);
  }

  #position(global) {
    if (!this.el || !global) return;
    const rect = canvas.app.view.getBoundingClientRect();
    const w = this.el.offsetWidth || 360, h = this.el.offsetHeight || 300;
    let left = rect.left + global.x + 20, top = rect.top + global.y + 20;
    if (left + w > window.innerWidth - 8) left = rect.left + global.x - w - 20;
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    this.el.style.left = `${Math.max(8, left)}px`;
    this.el.style.top = `${top}px`;
  }

  #foot(p) {
    const open = `<span><i class="fa-solid fa-id-card"></i> Double-click for the card</span>`;
    if (!game.user.isGM) return `<div class="foot">${open}</div>`;
    const scene = p.scene ? game.scenes.get(p.scene) : null;
    const gm = p.visibility && p.visibility !== "discovered" ? `<span class="badge gm">${p.visibility === "hidden" ? "Hidden from" : "Rumoured to"} players</span>` : "";
    const local = localMap(p);
    const text = local ? `<span><i class="fa-solid fa-map-location-dot"></i> Local map, ${local.places} place${local.places === 1 ? "" : "s"}</span>`
      : scene ? `<span><i class="fa-solid fa-film"></i> ${esc(scene.name)}</span>` : "";
    return `<div class="foot">${open}${text}${gm}</div>`;
  }

  #down(event) {
    if (event.button !== 0) return;
    this.click = { x: event.global.x, y: event.global.y, t: Date.now() };
  }

  #up(event) {
    const c = this.click;
    this.click = null;
    if (!c || !this.layer || this.isBlocked?.() || !this.#onMap(this.#topAt(event))) return;
    if (Math.hypot(event.global.x - c.x, event.global.y - c.y) > CLICK_PX || Date.now() - c.t > CLICK_MS) return;
    const at = event.getLocalPosition(canvas.stage);
    const id = this.layer.placeAt(at);
    if (!id) { this.lastClick = null; return; }
    // A second click on the same place, soon after the first: its card.
    const last = this.lastClick, now = Date.now();
    if (last?.id === id && now - last.t < DOUBLE_MS) { this.lastClick = null; return this.open(id); }
    this.lastClick = { id, t: now };
  }

  /** The place's card. */
  open(id) {
    const p = this.getPlace(id);
    if (!p || (p.hidden && !game.user.isGM)) return;
    this.hide();
    return this.openCard?.(id);
  }
}
