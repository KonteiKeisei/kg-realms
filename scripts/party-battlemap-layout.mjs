// Pure maths for the party on Site maps (0.96.9): which level a scene is, whether the party there is
// its members' own tokens, where those tokens stand, and how they follow whoever leads.

export const LEVELS = Object.freeze(['realm', 'region', 'place', 'site']);
export const LEVEL_NAMES = Object.freeze({ realm: 'Realm', region: 'Region', place: 'Place', site: 'Site' });

/**
 * A scene's level from its KG Realms flags: a realm or regional map (`world`), a scene marked Site
 * (`siteMap`), a local map (`localMap`, a Place), and anything else (a cave, a battlemap) a Site.
 */
export function levelOf(flags, regionalLinks = {}) {
  const f = flags ?? {};
  if (f.world) return f.regionalMap || regionalLinks?.[f.world] ? 'region' : 'realm';
  if (f.siteMap) return 'site';
  if (f.localMap) return 'place';
  return 'site';
}

/** How the party shows on a scene: 'members' (its members' own tokens, linked) on Site maps unless the scene asks for 'token'. */
export function partyModeOf(flags, regionalLinks = {}) {
  if (levelOf(flags, regionalLinks) !== 'site') return 'token';
  return flags?.sitePartyMode === 'token' ? 'token' : 'members';
}

/** What to set on a token an earlier 0.96.9 build gave a battlemap look, to put its normal look back, or null. */
export function normalRestore(normal, current) {
  if (!normal) return null;
  const want = { width: normal.width, height: normal.height, lockRotation: normal.lockRotation, 'texture.src': normal.texture?.src, 'texture.scaleX': normal.texture?.scaleX, 'texture.scaleY': normal.texture?.scaleY };
  const read = (k) => k.split('.').reduce((o, p) => o?.[p], current), out = {};
  for (const [k, v] of Object.entries(want)) if (v != null && read(k) !== v) out[k] = v;
  out['flags.kg-realms.normalLook'] = null;
  return out;
}

const overlaps = (a, b) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;

/** Grid steps around the middle, nearest first, ring by ring: [[dx, dy]]. */
export function ringOffsets(maxRing = 8) {
  const out = [];
  for (let r = 0; r <= maxRing; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) out.push([dx || 0, dy || 0]);
  return out.sort((a, b) => Math.hypot(...a) - Math.hypot(...b) || Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
}

/**
 * Free spots for members around a centre: one { x, y, w, h } (top-left and pixel size) per member
 * { w, h }. A spot may not overlap a token already there or one placed before it, and
 * `blocked(from, to)` (walls) may rule one out. `snap(point, member)` puts a centre on the grid.
 * A member with nowhere free stands in the middle.
 */
export function deploySpots({ center, size, members, occupied = [], blocked = () => false, snap = (p) => p, maxRing = 8 }) {
  const taken = [...occupied], out = [], offsets = ringOffsets(maxRing);
  for (const m of members) {
    let spot = null;
    for (const [dx, dy] of offsets) {
      const c = snap({ x: center.x + dx * size, y: center.y + dy * size }, m), rect = { x: c.x - m.w / 2, y: c.y - m.h / 2, w: m.w, h: m.h };
      if (taken.some((t) => overlaps(t, rect))) continue;
      if ((dx || dy) && blocked(center, c)) continue;
      spot = rect; break;
    }
    spot ??= { x: center.x - m.w / 2, y: center.y - m.h / 2, w: m.w, h: m.h };
    taken.push(spot); out.push(spot);
  }
  return out;
}

/** The middle of some token rectangles { x, y, w, h }, or null. */
export function centroid(rects) {
  if (!rects.length) return null;
  const s = rects.reduce((a, r) => ({ x: a.x + r.x + r.w / 2, y: a.y + r.y + r.h / 2 }), { x: 0, y: 0 });
  return { x: s.x / rects.length, y: s.y / rects.length };
}

/** A square-grid centre for a token of pixel size w x h: its top-left on a grid line. */
export function snapSquare(p, m, size) {
  const x = Math.round((p.x - m.w / 2) / size) * size, y = Math.round((p.y - m.h / 2) / size) * size;
  return { x: x + m.w / 2, y: y + m.h / 2 };
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Follow the leader. The leader went from `origin` through `path` (centres it actually passed). The
 * others line up behind it along one trail: their own spots (farthest from the leader first), where
 * the leader started, then its path. Follower k (1 = nearest) goes to `spacing * k` back from the
 * leader's end, walking the trail's points from its own spot, so it only crosses ground someone in
 * the party stood on. A point between two trail points is put on the grid by `snap`. The steps
 * joining the members' own spots to the leader's start are new ground: `blocked(a, b)` (walls) is
 * asked about each, and a member who would cross one stays where they are (`stuck`).
 * Returns { moves: [{ id, path: [centres] }], stuck: [ids] }.
 */
export function followPlan({ origin, path, followers, spacing, snap = (p) => p, blocked = () => false }) {
  if (!followers.length || !path.length) return { moves: [], stuck: [] };
  const order = [...followers].sort((a, b) => dist(a.center, origin) - dist(b.center, origin));
  const trail = [];
  const push = (p, owner = null) => { const last = trail.at(-1); if (last && dist(last.p, p) < 0.5) { if (owner) last.owner ??= owner; return; } trail.push({ p: { x: p.x, y: p.y }, owner }); };
  for (const f of [...order].reverse()) push(f.center, f.id);
  push(origin); const start = trail.length - 1; for (const p of path) push(p);
  // Each joining step, from one member's spot to the next and on to the leader's start: open or walled.
  const walled = trail.map((t, i) => i < start && !!blocked(t.p, trail[i + 1].p));
  // Distance back from the trail's end, at each point.
  const back = new Array(trail.length).fill(0);
  for (let i = trail.length - 2; i >= 0; i--) back[i] = back[i + 1] + dist(trail[i].p, trail[i + 1].p);
  const out = [], used = [path.at(-1)], stuck = [];
  order.forEach((f, k) => {
    const want = spacing * (k + 1), from = trail.findIndex((t) => t.owner === f.id);
    if (from < 0 || back[from] <= want + 0.5) { used.push(f.center); return; } // already that close behind: stays
    if (walled.slice(from, start).some(Boolean)) { stuck.push(f.id); used.push(f.center); return; }
    // The trail segment holding the spot `want` back from the end.
    let j = from; while (j < trail.length - 1 && back[j + 1] >= want) j++;
    const a = trail[j].p, b = trail[j + 1]?.p ?? a, seg = back[j] - (back[j + 1] ?? 0), t = seg > 0 ? (back[j] - want) / seg : 0;
    let target = snap({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    // Never two on one spot: one already taken goes back to the last trail point before it.
    if (used.some((u) => dist(u, target) < spacing * 0.5)) target = a;
    if (used.some((u) => dist(u, target) < spacing * 0.5) || dist(target, f.center) < 0.5) { used.push(f.center); return; }
    used.push(target);
    const steps = trail.slice(from + 1, j + 1).map((x) => x.p);
    if (!steps.length || dist(steps.at(-1), target) >= 0.5) steps.push(target);
    out.push({ id: f.id, path: steps });
  });
  return { moves: out, stuck };
}
