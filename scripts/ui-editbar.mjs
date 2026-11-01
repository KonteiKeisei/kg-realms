// The editing bar: one bar across the top of the map whenever the GM is editing (the map editor,
// a journey's route or encounters, a local map's places), with a gold frame round the map, so it is
// always plain that editing is on, what a click does now, what Esc does, and how to finish.
// A short note can follow the pointer (what a click does there), and the pointer becomes a crosshair
// while a click places something. One bar for every editor: the last to show it owns it.

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/**
 * The open map between Foundry's interface, measured from its own elements as Calendaria docks to
 * them: the top is the bottom of the scene navigation, the left the right of the scene controls,
 * the right the left of the sidebar, and the bottom the top of the hotbar. An element that is hidden, or not there (a UI module that
 * replaces it), counts for nothing. (Probing the screen for open map was fooled by whatever
 * floats over it: the pause banner, a clock, other modules' panels.) `ignore` is no longer used.
 */
export function uiBounds(ignore = null) {
  const W = window.innerWidth, H = window.innerHeight;
  const rect = (...ids) => {
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const b = el.getBoundingClientRect();
      if (b.width > 0 && b.height > 0) return b;
    }
    return null;
  };
  const nav = rect("scene-navigation", "navigation"), controls = rect("scene-controls", "controls"), sidebar = rect("sidebar"), hotbar = rect("hotbar");
  // A sidebar narrower than a third of the screen and on the right is the sidebar (not a moved one).
  let right = sidebar && sidebar.left > W * 0.5 ? sidebar.left : W;
  let left = controls && controls.right < W * 0.3 ? controls.right : 0;
  // Foundry 13's middle interface column is exactly the map between the left and right columns
  // (the right one can hold more than the sidebar): keep within it too.
  const middle = rect("ui-middle");
  if (middle && middle.right > W * 0.5) right = Math.min(right, middle.right);
  if (middle && middle.left < W * 0.3) left = Math.max(left, middle.left);
  const top = nav && nav.bottom < H * 0.3 ? nav.bottom : 0;
  const bottom = hotbar && hotbar.top > H * 0.5 ? Math.min(H, hotbar.top) : H;
  return { left, right, top, bottom };
}

class EditBar {
  constructor() {
    this.owner = null;
    this.el = null;
    this.frame = null;
    this.tipEl = null;
    this.noteEl = null;
    this.state = null;
    this.anchored = new Set(); // editor panels placed under the bar, against the sidebar
    this.onMove = (e) => this.#follow(e);
    this.onLayout = () => this.place({ measure: true });
    // Foundry's interface moves (sidebar collapsed, navigation redrawn, window resized): follow it.
    for (const hook of ["collapseSidebar", "renderSceneNavigation", "renderSceneControls", "canvasReady"]) globalThis.Hooks?.on(hook, () => requestAnimationFrame(this.onLayout));
    globalThis.window?.addEventListener?.("resize", this.onLayout);
  }

  /** An editor panel to keep under the bar and clear of the sidebar (or let go of, with false). */
  anchor(el, on = true) {
    if (!el) return;
    if (on) { this.anchored.add(el); el.classList.add("kgr-anchored"); } else this.anchored.delete(el);
    this.place({ measure: on });
  }

  /** Put the bar at the top of the open map, centred in it, and the panels under it, against its right side. */
  place({ measure = false } = {}) {
    // Foundry's own elements, measured afresh each time (cheap).
    this.bounds = uiBounds();
    const b = this.bounds;
    let below = b.top + 8;
    if (this.el) {
      this.el.style.top = `${b.top + 8}px`;
      this.el.style.left = `${(b.left + b.right) / 2}px`;
      this.el.style.maxWidth = `${Math.max(320, b.right - b.left - 32)}px`;
      below = this.el.getBoundingClientRect().bottom + 8;
    }
    if (this.noteEl) this.noteEl.style.left = `${b.left + 16}px`;
    for (const el of this.anchored) {
      if (!el.isConnected) { this.anchored.delete(el); continue; }
      el.style.top = `${below}px`;
      el.style.right = `${Math.max(8, window.innerWidth - b.right + 12)}px`;
      // A panel given a height of its own (its grip) keeps it.
      if (!el.classList.contains("kgr-sized")) el.style.maxHeight = `calc(100vh - ${Math.round(below) + 16}px)`;
    }
  }

  /**
   * Show the bar for an editor. opts: { title, mode, hint, esc, done, onDone, tip, crosshair, note }.
   * Later calls by the same owner update it.
   */
  show(owner, opts) {
    this.owner = owner;
    this.state = { ...opts };
    if (!this.el) {
      this.el = document.createElement("div");
      this.el.className = "kgr-ui kgr-editbar";
      this.el.setAttribute("role", "status");
      this.el.addEventListener("click", (e) => { if (e.target.closest("[data-act=done]")) this.state?.onDone?.(); });
      this.frame = document.createElement("div");
      this.frame.className = "kgr-editframe";
      this.tipEl = document.createElement("div");
      this.tipEl.className = "kgr-ui kgr-edittip";
      this.noteEl = document.createElement("div");
      this.noteEl.className = "kgr-ui kgr-editnote";
      document.body.append(this.frame, this.el, this.tipEl, this.noteEl);
      window.addEventListener("pointermove", this.onMove, { passive: true });
      this.bounds = null; // measure the open map afresh for this editing session
    }
    this.#draw();
  }

  /** Update what the bar says (only for the editor that owns it). */
  update(owner, opts) {
    if (owner !== this.owner || !this.el) return;
    this.state = { ...this.state, ...opts };
    this.#draw();
  }

  /** The editor finished: the bar goes, unless another editor has taken it since. */
  hide(owner) {
    if (owner !== this.owner) return;
    this.owner = null;
    this.state = null;
    window.removeEventListener("pointermove", this.onMove);
    for (const el of [this.el, this.frame, this.tipEl, this.noteEl]) el?.remove();
    this.el = this.frame = this.tipEl = this.noteEl = null;
    this.place();
    if (canvas?.app?.view) canvas.app.view.style.cursor = "";
  }

  get active() { return !!this.owner; }

  #draw() {
    const s = this.state;
    this.el.innerHTML = `<i class="fa-solid fa-pen-ruler"></i><b>${esc(s.title)}</b>${s.mode ? `<span class="mode">${esc(s.mode)}</span>` : ""}
      <span class="hint">${esc(s.hint ?? "")}</span>
      <span class="keys">${s.esc ? `<b>Esc</b> ${esc(s.esc)}` : ""}${s.undo ? ` · <b>Ctrl+Z</b> undoes` : ""}</span>
      <button type="button" data-act="done" class="primary">${esc(s.done ?? "Done editing")}</button>`;
    this.noteEl.hidden = !s.note;
    this.noteEl.textContent = s.note ?? "";
    this.tipEl.hidden = !s.tip;
    this.tipEl.textContent = s.tip ?? "";
    if (canvas?.app?.view) canvas.app.view.style.cursor = s.crosshair ? "crosshair" : "";
    this.place();
  }

  /** The pointer note follows the pointer over the map only. */
  #follow(e) {
    if (!this.tipEl || !this.state?.tip) return;
    const over = e.target === canvas?.app?.view;
    this.tipEl.style.display = over ? "" : "none";
    if (!over) return;
    this.tipEl.style.left = `${e.clientX + 18}px`;
    this.tipEl.style.top = `${e.clientY + 18}px`;
  }
}

export const editBar = new EditBar();
