// The one panel shell (0.65): what every KG Realms panel shares, so they look and behave alike.
//  - The header: an icon, an eyebrow (what this is), a title (which one), then the window controls,
//    always in this order: lock, minimise, close (a panel shows only those it has).
//  - Tabs: one segmented style everywhere.
//  - Placement: a panel opens in its usual spot; dragged by its header (while unlocked) it stays
//    where it was put, per user; double-click the header to put it back. Minimised, only the header
//    shows.
// Each panel keeps its own buttons' actions: the shell only draws them.
import { dragByHeader, clampTo } from "./float-panel.mjs";

const ID = "kg-realms";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/**
 * A panel's header. icon: a Font Awesome name ("fa-route"). lock / min / close: that control, as
 * { attr: 'data-act="lock"', on } (on: locked, or minimised), or null for none. extra: more
 * buttons, before the controls (a view switch, a sound toggle).
 */
export function shellHead({ icon = "", eyebrow = "", title = "", lock = null, min = null, close = null, extra = "" } = {}) {
  const ctl = (c, fa, label, title) => c ? `<button type="button" ${c.attr} class="kgr-sh-ctl ${c.on ? "on" : ""}" title="${esc(c.title ?? title ?? label)}" aria-label="${esc(label)}"${c.on != null ? ` aria-pressed="${!!c.on}"` : ""}><i class="fa-solid ${fa}"></i></button>` : "";
  return `<header class="kgr-sh">${icon ? `<span class="kgr-sh-icon" aria-hidden="true"><i class="fa-solid ${icon}"></i></span>` : ""}<div class="kgr-sh-text">${eyebrow ? `<div class="kgr-sh-eyebrow">${esc(eyebrow)}</div>` : ""}<div class="kgr-sh-title">${esc(title)}</div></div><div class="kgr-sh-ctls">${extra}${ctl(lock, lock?.on ? "fa-lock" : "fa-lock-open", lock?.on ? "Unlock position" : "Lock position", lock?.on ? "Locked in place: unlock to move it by its header" : "Drag the header to move it; lock to keep it there")}${ctl(min, min?.on ? "fa-chevron-down" : "fa-minus", min?.on ? "Restore" : "Minimise")}${ctl(close, "fa-xmark", "Close")}</div></header>`;
}

/** Tabs: [[key, label, iconOrNull, countOrNull]], the open one, and the attribute the panel listens for. */
export function shellTabs(tabs, current, { attr = "data-tab", label = "Sections", stacked = false } = {}) {
  return `<nav class="kgr-sh-tabs ${stacked ? "stacked" : ""}" role="tablist" aria-label="${esc(label)}">${tabs.map(([k, l, icon, n]) => `<button type="button" role="tab" ${attr}="${esc(k)}" class="${k === current ? "on" : ""}" aria-selected="${k === current}">${icon ? `<i class="fa-solid ${icon}" aria-hidden="true"></i>` : ""}<span>${esc(l)}</span>${n != null ? `<small>${esc(n)}</small>` : ""}</button>`).join("")}</nav>`;
}

/** A collapsible section: a header with a count, then its content. key: kept open or shut per panel. */
export function shellSection(title, body, { count = null, open = true, key = "", action = "" } = {}) {
  return `<details class="kgr-sh-sec" ${open ? "open" : ""} ${key ? `data-sec="${esc(key)}"` : ""}><summary><i class="fa-solid fa-chevron-right" aria-hidden="true"></i><span>${esc(title)}</span>${count != null ? `<small class="kgr-sh-count">${esc(count)}</small>` : ""}${action ? `<span class="kgr-sh-sp"></span>${action}` : ""}</summary><div class="kgr-sh-secbody">${body}</div></details>`;
}

/* ------------------------------------------------------------------ placement */

/** The client setting holding every panel's place: { key: { x, y, locked, min } }. */
export function registerShell() {
  game.settings.register(ID, "panelPlaces", { scope: "client", config: false, type: Object, default: {} });
}
const all = () => { try { return game.settings.get(ID, "panelPlaces") ?? {}; } catch { return {}; } };
/** A panel's kept place and state. */
export const panelState = (key) => all()[key] ?? {};
/** Keep part of a panel's state. */
export function setPanelState(key, patch) { return game.settings.set(ID, "panelPlaces", { ...all(), [key]: { ...panelState(key), ...patch } }).catch(() => {}); }
export const isLocked = (key) => !!panelState(key).locked;
export const toggleLocked = (key) => setPanelState(key, { locked: !isLocked(key) });

/**
 * Put a panel where it was left (kept on screen) and return true; else return false, for the panel
 * to dock itself in its usual spot.
 */
export function placeKept(el, key) {
  const p = panelState(key);
  if (!el || !(p.x >= 0 && p.y >= 0)) return false;
  const [x, y] = clampTo(el, p.x, p.y);
  Object.assign(el.style, { left: `${x}px`, top: `${y}px`, right: "auto" });
  return true;
}

/**
 * Make a panel movable by its header (while unlocked), its place kept under key. moved(): it left
 * its usual spot (stop docking it). redock(): put it back there (double-click the header).
 */
export function movable(el, key, { moved = () => {}, redock = () => {} } = {}) {
  dragByHeader(el, { locked: () => isLocked(key), save: (x, y) => { setPanelState(key, { x, y }); moved(); } });
  el.addEventListener("dblclick", async (e) => {
    if (!e.target.closest?.("header") || e.target.closest("button, input, select, a") || isLocked(key)) return;
    await setPanelState(key, { x: -1, y: -1 });
    redock();
  });
}

/** Show a panel minimised (its header only) or whole. */
export function applyMin(el, on) { el?.classList.toggle("kgr-min", !!on); }
