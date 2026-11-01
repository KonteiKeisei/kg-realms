// Street names on a settlement map: each named street's name, faded, written along its band, as a
// printed city map letters them. Names are sized for the kind of street (in feet, so any map's scale
// fits), follow the zoom up to a reading size, and go when zoomed out too far to read.
// Also: find a street by name, fit its whole length on screen, and light it up for a moment.
import { createMapRoot } from "../canvas-util.mjs";

const ID = "kg-realms";
const FONT = "kgr-street-names";
/** Letter height in feet for each kind of street. */
const LETTER_FT = { avenue: 24, street: 17, lane: 12, alley: 9 };
const SHOW_PX = 9, FULL_PX = 12, MAX_PX = 20; // on screen: appears, fully shown, largest
const GAP_PX = 520; // on screen, between repeats of one name along a long street
const SETTLE_MS = 450; // the zoom still this long before the names are laid out for it

/** Same-named pieces joined end to end into runs (a piece meets one other of its name: one run). */
export function streetRuns(roads, tol = 3) {
  const byName = new Map();
  // Only streets given a name of their own: not unnamed ones, nor the road editor's "New alley" and kin.
  for (const r of roads ?? []) { const n = String(r.name ?? "").trim(); if (!n || /^new (avenue|street|lane|alley|road)$/i.test(n) || (r.points?.length ?? 0) < 2) continue; if (!byName.has(n)) byName.set(n, []); byName.get(n).push(r); }
  const runs = [];
  const key = (p) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;
  for (const [name, list] of byName) {
    const ends = new Map(); list.forEach((r, i) => { for (const p of [r.points[0], r.points.at(-1)]) { const k = key(p); if (!ends.has(k)) ends.set(k, []); ends.get(k).push(i); } });
    const used = new Uint8Array(list.length);
    const next = (p, from) => { const at = ends.get(key(p)) ?? []; const others = at.filter((j) => j !== from && !used[j]); return at.length === 2 && others.length === 1 ? others[0] : -1; };
    for (let i = 0; i < list.length; i++) {
      if (used[i]) continue; used[i] = 1;
      let pts = [...list[i].points], kind = list[i].kind;
      for (let j; (j = next(pts.at(-1), -1)) >= 0;) { used[j] = 1; const q = list[j].points; pts = [...pts, ...(key(q[0]) === key(pts.at(-1)) ? q : [...q].reverse()).slice(1)]; }
      for (let j; (j = next(pts[0], -1)) >= 0;) { used[j] = 1; const q = list[j].points; pts = [...(key(q.at(-1)) === key(pts[0]) ? q : [...q].reverse()).slice(0, -1), ...pts]; }
      runs.push({ name, kind, points: pts });
    }
  }
  return runs;
}

/** A polyline's length, and the point and direction at a distance along it. */
function measure(points) {
  const cum = [0]; for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const at = (s) => {
    s = Math.max(0, Math.min(cum.at(-1), s)); let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
    const a = points[i - 1], b = points[i], l = cum[i] - cum[i - 1] || 1, t = (s - cum[i - 1]) / l;
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  };
  return { length: cum.at(-1), at };
}

/**
 * The line a name follows over a stretch of a street (width long, centred at a distance along it):
 * the street smoothed, so the name follows its gentle bends but never a jag or a sharp corner. Null
 * where the street turns too sharply, or the smooth line strays more than tol from the street.
 * Returns { length, at(s) } like a run, s from 0 to the stretch's length.
 */
export function smoothLine(run, centre, width, tol) {
  const N = 24, reach = width * 0.5, raw = [];
  for (let i = 0; i <= N; i++) { const p = run.at(centre - width / 2 - reach + (width + 2 * reach) * i / N); raw.push([p.x, p.y]); }
  // A wide moving average: a third of the name's length either side.
  const r = Math.max(1, Math.round(N * (width / 3) / (width + 2 * reach))), smooth = raw.map((_, i) => { let x = 0, y = 0, n = 0; for (let j = Math.max(0, i - r); j <= Math.min(N, i + r); j++) { x += raw[j][0]; y += raw[j][1]; n++; } return [x / n, y / n]; });
  const first = Math.round(N * reach / (width + 2 * reach)), last = N - first, pts = smooth.slice(first, last + 1);
  for (let i = first; i <= last; i++) if (Math.hypot(smooth[i][0] - raw[i][0], smooth[i][1] - raw[i][1]) > tol) return null;
  let total = 0;
  for (let i = 2; i < pts.length; i++) {
    const a1 = Math.atan2(pts[i - 1][1] - pts[i - 2][1], pts[i - 1][0] - pts[i - 2][0]), a2 = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
    const turn = Math.abs(((a2 - a1 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    if (turn > 0.17) return null; total += turn;
  }
  if (total > 0.9) return null;
  return measure(pts);
}
export class StreetNames {
  constructor() { this.root = null; this.glow = null; this.laidAt = 0; }

  install() {
    Hooks.on("canvasReady", () => this.draw());
    Hooks.on("canvasTearDown", () => this.clear());
    Hooks.on("updateScene", (scene, changes) => { if (scene === canvas.scene && foundry.utils.hasProperty(changes, `flags.${ID}.cityRoads`)) this.draw(); });
    Hooks.on("canvasPan", () => this.#onZoom());
  }

  clear() {
    if (this.frame) cancelAnimationFrame(this.frame); this.frame = 0; clearTimeout(this.settle);
    if (this.cullFrame) cancelAnimationFrame(this.cullFrame); this.cullFrame = 0;
    this.root?.destroy({ children: true }); this.root = null; this.runs = []; this.laidAt = 0;
    this.#stopGlow();
  }

  /** The scene's named streets, as runs, and their letters at the current zoom. */
  draw() {
    this.clear();
    const scene = canvas.scene, data = scene?.getFlag(ID, "cityRoads");
    if (!canvas.ready || !scene?.getFlag(ID, "localMap") || !data?.roads?.length) return;
    this.runs = streetRuns(data.roads).map((r) => ({ ...r, ...measure(r.points) }));
    if (!this.runs.length) return;
    if (!PIXI.BitmapFont.available[FONT]) PIXI.BitmapFont.from(FONT, { fontFamily: "Signika, sans-serif", fontSize: 64, fontWeight: "600", fill: "#f6ecd4", stroke: "#1a130c", strokeThickness: 7, lineJoin: "round" }, { chars: [[" ", "~"], "’éèêâûôçÉ"], resolution: 1, padding: 4 });
    // Over the map art, under tiles, drawings, notes and tokens; not clipped (names may run to the edge).
    this.root = createMapRoot(); const mask = this.root.mask; this.root.mask = null; mask?.destroy();
    this.root.sort = (canvas.primary.background?.sort ?? 0) + 100; canvas.primary.sortDirty = true;
    this.feet = (canvas.scene.grid?.size ?? 100) / (canvas.scene.grid?.distance || 5);
    this.#lay();
  }

  /**
   * The settle delay: while the zoom changes the names simply scale with the map; once it has been
   * still a moment they are laid out again for it (which show, their size, how often they repeat).
   */
  #onZoom() {
    if (!this.root) return;
    // Names off the screen are not drawn: checked once a frame as the view moves.
    if (!this.cullFrame) this.cullFrame = requestAnimationFrame(() => { this.cullFrame = 0; this.#cull(); });
    clearTimeout(this.settle);
    this.settle = setTimeout(() => { if (this.frame) return; this.frame = requestAnimationFrame(() => { this.frame = 0; this.#lay(); }); }, SETTLE_MS);
  }

  /** Letters for the zoom: re-laid when their size on screen would change by more than a tenth. */
  #lay() {
    if (!this.root || this.root.destroyed) return;
    const zoom = canvas.stage.scale.x || 1, font = PIXI.BitmapFont.available[FONT];
    // The fade: by the size of a street (letter) on screen.
    const sizeKey = Math.round(Math.log(zoom) * 10);
    if (sizeKey === this.laidAt && this.root.children.length) return this.#fade(zoom);
    this.laidAt = sizeKey;
    for (const c of this.root.removeChildren()) c.destroy({ children: true });
    for (const run of this.runs) {
      const world = (LETTER_FT[run.kind] ?? LETTER_FT.street) * this.feet, screen = world * zoom;
      if (screen < SHOW_PX) continue;
      const height = Math.min(world, MAX_PX / zoom), k = height / font.lineHeight * 1.25;
      const chars = [...run.name].map((ch) => font.chars[ch.charCodeAt(0)] ?? font.chars[63]);
      const width = chars.reduce((s, c) => s + (c?.xAdvance ?? 0) * k, 0);
      if (run.length < width * 1.15) continue;
      const count = Math.max(1, Math.floor(run.length / (width + GAP_PX / zoom)));
      for (let n = 0; n < count; n++) {
        // Each repeat on its own, so a long street's names leave the screen one by one. A name is set on
        // one straight line, never bent round a corner: it goes where the street runs straight for its
        // whole length, the nearest such place to its share of the street; with none, it is left out.
        const from = run.length * n / count, to = run.length * (n + 1) / count, ideal = (from + to) / 2;
        let line = null, at = 0;
        for (let step = 0; step <= 12 && !line; step++) for (const sign of step ? [1, -1] : [1]) {
          const centre = ideal + sign * step * (to - from) / 26;
          if (centre - width / 2 < from || centre + width / 2 > to) continue;
          line = smoothLine(run, centre, width, height * 0.9); if (line) break;
        }
        if (!line || line.length < width * 0.9) continue;
        const label = new PIXI.Container(); label.kgrKind = run.kind;
        // Upright: written left to right whichever way the street was drawn; centred on the line.
        const mid = line.at(line.length / 2), flip = Math.cos(mid.angle) < 0;
        let s = flip ? (line.length + width) / 2 : (line.length - width) / 2;
        for (const c of chars) {
          if (!c) continue; const adv = c.xAdvance * k, p = line.at(flip ? s - adv / 2 : s + adv / 2);
          // The glyph's box from the line's middle (its offsets keep letters on one baseline), turned with the line.
          const rot = flip ? p.angle + Math.PI : p.angle, ux = Math.cos(rot), uy = Math.sin(rot), lx = -adv / 2 + c.xOffset * k, ly = c.yOffset * k - font.lineHeight * k / 2;
          const sp = new PIXI.Sprite(c.texture); sp.scale.set(k); sp.rotation = rot;
          sp.position.set(p.x + lx * ux - ly * uy, p.y + lx * uy + ly * ux);
          label.addChild(sp); s += flip ? -adv : adv;
        }
        // Its box on the scene, for leaving it undrawn while off the screen.
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; const pad = height * 2;
        for (const sp of label.children) { x0 = Math.min(x0, sp.x); y0 = Math.min(y0, sp.y); x1 = Math.max(x1, sp.x); y1 = Math.max(y1, sp.y); }
        label.kgrBox = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
        this.root.addChild(label);
      }
    }
    this.#fade(zoom);
    this.#cull();
  }

  /** Each name drawn only while its box is on or near the screen. */
  #cull() {
    if (!this.root || this.root.destroyed) return;
    const { width, height } = canvas.app.renderer.screen, t = canvas.stage.worldTransform, a = t.applyInverse({ x: 0, y: 0 }), b = t.applyInverse({ x: width, y: height }), m = (b.x - a.x) * 0.1;
    for (const label of this.root.children) { const k = label.kgrBox; label.renderable = !k || (k[2] >= a.x - m && k[0] <= b.x + m && k[3] >= a.y - m && k[1] <= b.y + m); }
  }

  #fade(zoom) {
    for (const label of this.root.children) {
      const screen = (LETTER_FT[label.kgrKind] ?? LETTER_FT.street) * this.feet * zoom;
      label.alpha = 0.6 * Math.max(0, Math.min(1, (screen - SHOW_PX) / (FULL_PX - SHOW_PX)));
    }
  }

  /** The scene's street names, for search: [{ name, kind, length }], one per name. */
  names() {
    const by = new Map(); for (const r of this.runs ?? []) { const e = by.get(r.name) ?? { name: r.name, kind: r.kind, length: 0 }; e.length += r.length; by.set(r.name, e); }
    return [...by.values()];
  }

  /** Fit the whole of a named street on screen and light it up for a few seconds. */
  async show(name, { ms = 4000 } = {}) {
    const runs = (this.runs ?? []).filter((r) => r.name === name);
    if (!runs.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of runs) for (const [x, y] of r.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const { width, height } = canvas.app.renderer.screen, pad = 1.25;
    const fit = Math.min(width / Math.max(200, (x1 - x0) * pad), height / Math.max(200, (y1 - y0) * pad));
    const scale = Math.max(canvas.dimensions?.scale?.min ?? 0.05, Math.min(canvas.dimensions?.scale?.max ?? 3, fit));
    this.#glow(runs, ms);
    await canvas.animatePan({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, scale, duration: 700 });
  }

  #glow(runs, ms) {
    this.#stopGlow();
    const g = this.glow = new PIXI.Graphics(); g.eventMode = "none"; canvas.interface.addChild(g);
    const draw = () => {
      const zoom = canvas.stage.scale.x || 1; g.clear();
      for (const [w, a] of [[16, 0.25], [7, 0.95]]) { g.lineStyle({ width: w / zoom, color: 0xffd36b, alpha: a, cap: "round", join: "round" }); for (const r of runs) { g.moveTo(...r.points[0]); for (const p of r.points.slice(1)) g.lineTo(...p); } }
    };
    const start = performance.now();
    this.glowTick = () => {
      const t = (performance.now() - start) / ms;
      if (t >= 1 || g.destroyed) return this.#stopGlow();
      draw(); g.alpha = (t < 0.75 ? 0.75 + 0.25 * Math.sin(t * Math.PI * 6) : (1 - t) / 0.25);
    };
    canvas.app.ticker.add(this.glowTick);
  }

  #stopGlow() {
    if (this.glowTick) canvas.app?.ticker?.remove(this.glowTick); this.glowTick = null;
    this.glow?.destroy(); this.glow = null;
  }
}
