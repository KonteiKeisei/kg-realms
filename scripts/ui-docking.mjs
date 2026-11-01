import { uiBounds } from "./ui-editbar.mjs";

/** The scene trail follows the same measured navigation/sidebar boundaries as the editor. */
export function dockSceneTrail(el) {
  const b = uiBounds();
  Object.assign(el.style, {top: `${Math.max(48, b.top + 8)}px`,
    left: `${(b.left + b.right) / 2}px`, maxWidth: `${Math.max(96, b.right - b.left - 24)}px`});
}

/** Use the available map height. Scroll only when the content cannot fit in the viewport. */
export function dockOverMap(el) {
  const b = uiBounds(), gap = 12;
  const width = Math.max(0, Math.min(680, b.right - b.left - gap * 2));
  // Some scene pickers use a full-height wrapper, which uiBounds intentionally ignores.
  // Keep a minimum top clearance for their visible toolbar as well as measured navigation.
  const top = Math.max(64, b.top + 20);
  const height = Math.max(0, b.bottom - top - gap);
  Object.assign(el.style, {
    left: `${(b.left + b.right) / 2}px`, top: `${top}px`, bottom: "auto",
    width: `${width}px`, maxHeight: `${height}px`
  });
  el.style.setProperty("--kgr-camp-height", `${height}px`);
}

const IDS = ["scene-navigation", "navigation", "scene-controls", "controls", "sidebar", "hotbar"];
const EVENTS = ["collapseSidebar", "renderSidebar", "renderSceneNavigation", "renderSceneControls", "renderHotbar", "canvasReady"];

/** Observe Foundry's own UI only while the carousel exists. Coalesce changes before paint, without polling. */
export function observeMapUi(place) {
  let pending = null, stopped = false, watched = new Set();
  const schedule = () => {
    if (stopped || pending !== null) return;
    pending = requestAnimationFrame(() => { pending = null; bind(); place(); });
  };
  const resize = globalThis.ResizeObserver ? new ResizeObserver(schedule) : null;
  const mutations = globalThis.MutationObserver ? new MutationObserver(schedule) : null;
  const bind = () => {
    const next = new Set(IDS.map((id) => document.getElementById(id)).filter(Boolean));
    if (next.size === watched.size && [...next].every((el) => watched.has(el))) return;
    resize?.disconnect(); mutations?.disconnect();
    for (const el of watched) el.removeEventListener("transitionend", schedule);
    watched = next;
    for (const el of watched) {
      resize?.observe(el);
      mutations?.observe(el, { attributes: true, attributeFilter: ["style", "class", "hidden"] });
      el.addEventListener("transitionend", schedule);
    }
  };
  const hooks = EVENTS.map((name) => [name, globalThis.Hooks?.on(name, schedule)]);
  window.addEventListener("resize", schedule);
  bind();
  return () => {
    stopped = true;
    if (pending !== null) cancelAnimationFrame(pending);
    resize?.disconnect(); mutations?.disconnect();
    for (const el of watched) el.removeEventListener("transitionend", schedule);
    for (const [name, id] of hooks) if (id != null) globalThis.Hooks?.off(name, id);
    window.removeEventListener("resize", schedule);
  };
}
