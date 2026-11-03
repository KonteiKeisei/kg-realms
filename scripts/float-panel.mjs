// What the floating panels (the travel panel, the map editor) share: a grip along the bottom edge
// to make the panel taller or shorter to suit the screen, kept per client; and the panel's place,
// dragged by its header while unlocked, also kept per client.

const MIN_H = 160;

/**
 * A panel's height: h px (its content scrolls inside), or 0 for as tall as its content (up to the
 * screen). Kept within the screen.
 */
export function applyHeight(el, h) {
  if (!el) return;
  if (h > 0) {
    const top = el.getBoundingClientRect().top;
    const available = Math.max(0, window.innerHeight - top - 8);
    el.style.height = `${Math.min(available, Math.max(MIN_H, h))}px`;
    el.style.maxHeight = "none";
  } else { el.style.height = ""; el.style.maxHeight = ""; }
  el.classList.toggle("kgr-sized", h > 0);
}

/**
 * Give a panel a grip on its bottom edge: drag it to set the panel's height (save(h) keeps it);
 * double-click it to go back to fitting the content (save(0)). Call again after the panel redraws
 * its content: the grip is put back if it went.
 */
export function heightGrip(el, save) {
  if (!el || el.querySelector(":scope > .kgr-grip")) return;
  const grip = document.createElement("div");
  grip.className = "kgr-grip";
  grip.title = "Drag to make the panel taller or shorter; double-click to fit it to its content";
  grip.setAttribute("aria-hidden", "true");
  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const top = el.getBoundingClientRect().top;
    const move = (ev) => applyHeight(el, ev.clientY - top);
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      el.classList.remove("resizing");
      save(Math.round(el.getBoundingClientRect().height));
    };
    el.classList.add("resizing");
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  });
  grip.addEventListener("dblclick", (e) => { e.stopPropagation(); applyHeight(el, 0); save(0); });
  el.append(grip);
}

/**
 * Drag a panel by its header (not its buttons or fields) while unlocked; keep it on screen.
 * save(x, y) keeps where it was let go.
 */
export function dragByHeader(el, { locked, save }) {
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || locked() || !e.target.closest("header") || e.target.closest("button, [data-act], input, select, a")) return;
    e.preventDefault();
    const r = el.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
    Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, right: "auto" });
    const move = (ev) => { const [x, y] = clampTo(el, r.left + ev.clientX - sx, r.top + ev.clientY - sy); el.style.left = `${x}px`; el.style.top = `${y}px`; };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      el.classList.remove("dragging");
      save(parseInt(el.style.left) || 0, parseInt(el.style.top) || 0);
    };
    el.classList.add("dragging");
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  });
}

/** x, y kept so the panel stays on screen (its header at least). */
export function clampTo(el, x, y) {
  const w = el?.offsetWidth || 400, h = el?.offsetHeight || 200;
  return [Math.max(0, Math.min(x, window.innerWidth - w)), Math.max(0, Math.min(y, window.innerHeight - Math.min(h + 8, window.innerHeight)))];
}
