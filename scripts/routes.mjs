// A world's roads and trails as the map draws them: the shipped routes with the
// GM's edits applied (moved nodes, renamed, retyped, deleted, added). Pure: no Foundry.
//
// Edits: { edited: { [id]: { kind, name, coordinates } }, added: { [id]: { kind, name,
// coordinates, from, to } }, deleted: [id] }. Coordinates are [lon, lat] pairs.

export const ROUTE_KINDS = { road: "Road", trail: "Trail" };

export function applyRouteEdits(base, edits = {}) {
  const { edited = {}, added = {}, deleted = [] } = edits;
  const gone = new Set(deleted);
  const features = [];
  for (const f of base?.features ?? []) {
    const id = f.properties.id;
    // A route the GM added that the module now ships (an adopted export) is drawn once, as added.
    if (gone.has(id) || added[id]) continue;
    const e = edited[id];
    features.push(e ? feature(id, { ...f.properties, ...e, edited: true }, e.coordinates ?? f.geometry.coordinates) : f);
  }
  for (const [id, a] of Object.entries(added)) if (!gone.has(id)) features.push(feature(id, { ...a, added: true }, a.coordinates));
  return { type: "FeatureCollection", features };
}

function feature(id, props, coordinates) {
  const { coordinates: _c, ...rest } = props;
  return { type: "Feature", properties: { ...rest, id, kind: rest.kind ?? "road", name: rest.name ?? null }, geometry: { type: "LineString", coordinates } };
}

/** Edits that turn `base` into `target` (an imported or exported FeatureCollection). */
export function editsBetween(base, target) {
  const byId = new Map((base?.features ?? []).map((f) => [f.properties.id, f]));
  const edits = { edited: {}, added: {}, deleted: [] };
  const seen = new Set();
  for (const f of target?.features ?? []) {
    if (f.geometry?.type !== "LineString" || f.geometry.coordinates.length < 2) continue;
    const id = f.properties?.id ?? `route-added-${seen.size}-${Math.random().toString(36).slice(2, 8)}`;
    seen.add(id);
    const { kind = "road", name = null, from, to } = f.properties ?? {};
    const b = byId.get(id);
    if (!b) { edits.added[id] = { kind, name, coordinates: f.geometry.coordinates, ...(from ? { from } : {}), ...(to ? { to } : {}) }; continue; }
    const same = b.properties.kind === kind && (b.properties.name ?? null) === name && JSON.stringify(b.geometry.coordinates) === JSON.stringify(f.geometry.coordinates);
    if (!same) edits.edited[id] = { kind, name, coordinates: f.geometry.coordinates };
  }
  for (const id of byId.keys()) if (!seen.has(id)) edits.deleted.push(id);
  return edits;
}

/** Length of a [lon, lat] line in the sheet's miles, given a projection to sheet pixels. */
export function lineMiles(coordinates, toSheet, milesPerPixel) {
  let m = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const a = toSheet(...coordinates[i - 1]), b = toSheet(...coordinates[i]);
    m += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return m * milesPerPixel;
}

/** Nearest point on a polyline (screen points [x, y]): { index (segment start), t, distance, point }. */
export function nearestOnLine(points, p) {
  let best = null;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i], [bx, by] = points[i + 1];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2));
    const q = [ax + t * dx, ay + t * dy], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (!best || d < best.distance) best = { index: i, t, distance: d, point: q };
  }
  return best;
}

function segDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l));
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}

/**
 * Check the road network. features: route GeoJSON features; places: [{ id, name, kind, class,
 * lon, lat }]; toSheet(lon, lat): sheet pixels. Returns:
 *  deadEnds   [{ route, end, at: [lon, lat], near }]: an end on no other route and at no place
 *  nearMisses [{ place, route, px }]: a settlement close to a route that does not reach it
 * isEdge(sheetPoint): ends there leave the map and are not dead ends.
 *  components: count of separate connected networks (islands count as their own)
 */
export function networkReport(features, places, toSheet, { endPx = 1.5, placePx = 3, missPx = 30, isEdge = null } = {}) {
  const routes = features.map((f) => ({ id: f.properties.id, name: f.properties.name, pts: f.geometry.coordinates.map((c) => toSheet(...c)), lonlat: f.geometry.coordinates }));
  const stops = places.filter((p) => !p.hidden && (p.kind === "settlement" || p.kind === "site")).map((p) => ({ p, at: toSheet(p.lon, p.lat) }));
  const towns = stops.filter((s) => s.p.kind === "settlement" || ["Fortification", "Keep", "Fort"].includes(s.p.class));
  const lineDist = (q, r) => { let d = Infinity; for (let i = 1; i < r.pts.length; i++) d = Math.min(d, segDistance(q, r.pts[i - 1], r.pts[i])); return d; };
  const nearestName = (q) => { let b = null, bd = Infinity; for (const s of stops) { const d = Math.hypot(s.at[0] - q[0], s.at[1] - q[1]); if (d < bd) { bd = d; b = s.p.name; } } return b; };
  // union-find over routes for components
  const parent = routes.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const deadEnds = [];
  routes.forEach((r, i) => {
    for (const [end, q] of [[0, r.pts[0]], [1, r.pts.at(-1)]]) {
      let touched = false;
      routes.forEach((o, j) => { if (j !== i && lineDist(q, o) < endPx) { touched = true; parent[find(i)] = find(j); } });
      const atPlace = stops.some((s) => Math.hypot(s.at[0] - q[0], s.at[1] - q[1]) < placePx);
      if (!touched && !atPlace && !isEdge?.(q)) deadEnds.push({ route: r.id, name: r.name, end, at: end ? r.lonlat.at(-1) : r.lonlat[0], near: nearestName(q) });
    }
  });
  // Routes sharing a place are connected through it.
  for (const s of stops) {
    const on = routes.map((r, i) => (lineDist(s.at, r) < placePx ? i : -1)).filter((i) => i >= 0);
    for (const i of on.slice(1)) parent[find(i)] = find(on[0]);
  }
  const nearMisses = [];
  for (const t of towns) {
    let best = null, bd = Infinity;
    for (const r of routes) { const d = lineDist(t.at, r); if (d < bd) { bd = d; best = r; } }
    if (bd >= placePx && bd < missPx) nearMisses.push({ place: t.p.id, name: t.p.name, route: best.id, px: +bd.toFixed(1) });
  }
  return { deadEnds, nearMisses, components: new Set(routes.map((_, i) => find(i))).size };
}

/**
 * Fewer nodes, same shape (Douglas-Peucker): nodes closer than `tolerance` sheet px to the line
 * through their neighbours go. The ends and any node in `keep` (indices) stay.
 */
export function simplifyLine(coordinates, toSheet, tolerance = 1.5, keep = []) {
  if (coordinates.length < 3) return coordinates.map((c) => [...c]);
  const pts = coordinates.map((c) => toSheet(...c)), mark = new Uint8Array(pts.length);
  mark[0] = mark[pts.length - 1] = 1;
  for (const k of keep) if (k >= 0 && k < pts.length) mark[k] = 1;
  const stack = [];
  // Split at kept nodes first, so each run is simplified on its own.
  let prev = 0;
  for (let i = 1; i < pts.length; i++) if (mark[i]) { stack.push([prev, i]); prev = i; }
  while (stack.length) {
    const [a, b] = stack.pop();
    let bi = -1, bd = tolerance;
    for (let i = a + 1; i < b; i++) { const d = segDistance(pts[i], pts[a], pts[b]); if (d > bd) { bd = d; bi = i; } }
    if (bi >= 0) { mark[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  return coordinates.filter((_, i) => mark[i]).map((c) => [...c]);
}

/**
 * A smooth curve through a line's nodes (centripetal Catmull-Rom), so a few nodes make a curving
 * road. It passes through every node, so junctions and places stay where they are. Segments
 * already short (dense traced roads) are left as they are. toSheet/fromSheet: the projection.
 */
export function smoothLine(coordinates, toSheet, fromSheet, stepPx = 3) {
  if (coordinates.length < 3) return coordinates;
  const P = coordinates.map((c) => toSheet(...c));
  const out = [coordinates[0]];
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const k = (a, b) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  for (let i = 0; i < P.length - 1; i++) {
    const p1 = P[i], p2 = P[i + 1], n = Math.min(24, Math.floor(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / stepPx));
    if (n >= 2) {
      const p0 = P[i - 1] ?? [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]], p3 = P[i + 2] ?? [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]];
      const t0 = 0, t1 = k(p0, p1), t2 = t1 + k(p1, p2), t3 = t2 + k(p2, p3);
      for (let j = 1; j < n; j++) {
        const t = t1 + (t2 - t1) * j / n;
        const A1 = lerp(p0, p1, (t - t0) / (t1 - t0)), A2 = lerp(p1, p2, (t - t1) / (t2 - t1)), A3 = lerp(p2, p3, (t - t2) / (t3 - t2));
        const B1 = lerp(A1, A2, (t - t0) / (t2 - t0)), B2 = lerp(A2, A3, (t - t1) / (t3 - t1));
        out.push(fromSheet(...lerp(B1, B2, (t - t1) / (t2 - t1))));
      }
    }
    out.push(coordinates[i + 1]);
  }
  return out;
}

/** Every route drawn as a curve through its nodes. */
export function smoothRoutes(fc, toSheet, fromSheet) {
  if (!fc) return fc;
  return { ...fc, features: fc.features.map((f) => ({ ...f, geometry: { ...f.geometry, coordinates: smoothLine(f.geometry.coordinates, toSheet, fromSheet) } })) };
}
/** Two lines joined end to end at their closest ends: { coordinates, gap } (gap in sheet px). */
export function joinLines(a, b, toSheet) {
  const A = [a, [...a].reverse()], B = [b, [...b].reverse()];
  let best = null;
  for (const x of A) for (const y of B) {
    const p = toSheet(...x.at(-1)), q = toSheet(...y[0]), d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (!best || d < best.gap) best = { gap: d, coordinates: d < 0.5 ? [...x, ...y.slice(1)] : [...x, ...y] };
  }
  return best;
}