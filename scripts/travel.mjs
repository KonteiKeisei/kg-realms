// Overland travel on the Faerun sheet, after the D&D 5e (2014) travel rules.
// Pure: no Foundry. Distances are in sheet pixels internally, miles outside.
//
//  Pace     mph  mi/day  effect
//  fast      4    30     -5 to passive Wisdom (Perception)
//  normal    3    24
//  slow      2    18     can travel stealthily
//
// Roads and trails are simple terrain (full pace) and need no navigation check.
// Off-road, difficult terrain (dense forest, swamp, mountains, ice) halves the
// distance covered; the navigator's Wisdom (Survival) DC depends on the terrain.
// House rule (optional): trails through rough country move at 3/4 pace.

import { isRiverHazard, riverHazardHours } from "./river-hazards.mjs";
export const PACES = {
  fast: { label: "Fast", mph: 4, perception: -5, stealth: false },
  normal: { label: "Normal", mph: 3, perception: 0, stealth: false },
  slow: { label: "Slow", mph: 2, perception: 0, stealth: true }
};

/**
 * How the party travels overland. On foot: the slowest walker sets the speed (30 ft, 3 mph at
 * normal pace). Mounted: the travel pace table (24 miles a day at normal pace). A wagon or a coach
 * goes only by road and trail: a stop must be beside one, and the hop to it is at slow pace. A wagon
 * keeps the travel pace. A coach changes horses at stations, so it is faster on roads (a house rule:
 * the book gives it wagon speed), and keeps the travel pace on trails. A flying mount goes straight,
 * over any ground or water, at its own speed. Custom: a speed the GM sets. By water, see VESSELS.
 */
export const METHODS = {
  foot: { label: "On foot", short: "On foot" },
  mounted: { label: "Mounted", short: "Mounted" },
  wagon: { label: "Wagon or caravan", short: "Wagon", offroad: "slow", roadsOnly: true },
  coach: { label: "Coach", short: "Coach", offroad: "slow", roadsOnly: true, roadMph: 6, fare: true },
  flying: { label: "Flying mount", short: "Flying", flying: true },
  custom: { label: "Custom speed", short: "Custom" }
};
/**
 * What a wagon or coach ride is worth: the party pays, rides free, or is paid to guard it. Rates are in
 * copper a mile for each party member. A ride is a deal, so the GM sets it. Pay is about a skilled
 * hireling's 2 gp a day at each one's daily distance.
 */
export const RIDE_DEALS = { terms: { wagon: "free", coach: "fare" }, fares: { wagon: 2, coach: 3 }, pays: { wagon: 8, coach: 4 } };
/** The price of a leg for one party member, in gp: { gp, paid } (paid: they are paid it). Null: no money changes hands. */
export function ridePrice(miles, method, { terms, fares, pays } = {}, scale = 1) {
  const term = { ...RIDE_DEALS.terms, ...terms }[method];
  if (term === "fare") return { gp: miles * { ...RIDE_DEALS.fares, ...fares }[method] / 100 * scale, paid: false };
  if (term === "paid") return { gp: miles * { ...RIDE_DEALS.pays, ...pays }[method] / 100 * scale, paid: true };
  return null;
}

/** Kinds of going on water (waterways.mjs plans them). */
export const WATER_KINDS = new Set(["sea", "river", "wind", "lane"]);

// Terrain codes in data/worlds/<world>/terrain.png (from the map's painted biomes).
export const TERRAIN = {
  1: { name: "plains", difficult: false, lostDC: 5, rough: false, cap: "fast" },
  2: { name: "forest", difficult: true, lostDC: 15, rough: true, cap: "normal" },
  3: { name: "hills", difficult: false, lostDC: 10, rough: true, cap: "normal" },
  4: { name: "mountains", difficult: true, lostDC: 15, rough: true, cap: "slow" },
  5: { name: "swamp", difficult: true, lostDC: 15, rough: true, cap: "slow" },
  6: { name: "desert", difficult: false, lostDC: 10, rough: false, cap: "normal" },
  7: { name: "glacier", difficult: true, lostDC: 10, rough: true, cap: "slow" },
  8: { name: "water", difficult: true, lostDC: 15, rough: true, water: true, cap: "slow" },
  9: { name: "grassland", difficult: false, lostDC: 5, rough: false, cap: "fast" }
};
const PLAINS = TERRAIN[1];

/** A terrain lookup from a decoded grid: { data (one byte per cell), width, height, cell (sheet px per cell) }. */
export function terrainLookup(grid) {
  if (!grid) return () => PLAINS;
  return (x, y) => {
    const cx = Math.floor(x / grid.cell), cy = Math.floor(y / grid.cell);
    if (cx < 0 || cy < 0 || cx >= grid.width || cy >= grid.height) return PLAINS;
    return TERRAIN[grid.data[cy * grid.width + cx]] ?? PLAINS;
  };
}

/** Speed factor of a leg kind over a terrain. */
const EASE = { slow: "normal", normal: "fast", fast: "fast" };
/**
 * Fraction of the chosen pace kept over a terrain. rules "2014": difficult terrain halves
 * off-road travel. rules "2024": each terrain caps the pace (grassland fast, forest and hills
 * normal, mountains and swamp slow); a road lifts the cap, a trail eases it one step.
 */
export function speedFactor(kind, terrain, opts = {}) {
  const base = terrainSpeedFactor(kind, terrain, opts), key = kind === "road" || kind === "trail" ? kind : "offroad";
  return base * (terrain.biome?.[key] ?? 1);
}
function terrainSpeedFactor(kind, terrain, { trailRule = false, rules = "2014", pace = "normal" } = {}) {
  if (rules === "2024") {
    if (kind === "road") return 1;
    let cap = terrain.cap ?? "fast";
    if (kind === "trail") cap = EASE[cap];
    return Math.min(PACES[pace].mph, PACES[cap].mph) / PACES[pace].mph;
  }
  if (kind === "road") return 1;
  if (kind === "trail") return trailRule && terrain.rough ? 0.75 : 1;
  return terrain.difficult ? 0.5 : 1;
}

const key = (p) => `${Math.round(p[0] * 2)},${Math.round(p[1] * 2)}`;

/**
 * The travel graph of routes (GeoJSON features), in sheet pixels via toSheet(lon, lat).
 * Route ends lying on another route's segment split it there, so junctions connect.
 */
export function buildGraph(features, toSheet, labels = [], {precision = 2} = {}) {
  const key=p=>`${Math.round(p[0]*precision)},${Math.round(p[1]*precision)}`;
  const lines = features.filter((f) => f.geometry?.coordinates?.length > 1)
    .map((f) => ({ id: f.properties.id, kind: f.properties.kind === "trail" ? "trail" : "road", name: f.properties.name ?? null, resolution: Number.isFinite(f.properties.regionalResolution)&&f.properties.regionalResolution>0?Math.max(1e-8,f.properties.regionalResolution):1, pts: f.geometry.coordinates.map((c) => toSheet(...c)) }));
  // Split segments where another route's end touches them.
  const ends = lines.flatMap((l) => [l.pts[0], l.pts.at(-1)]);
  for (const l of lines) {
    for (const e of ends) {
      for (let i = 1; i < l.pts.length; i++) {
        const a = l.pts[i - 1], b = l.pts[i], dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy || 1e-9;
        const t = ((e[0] - a[0]) * dx + (e[1] - a[1]) * dy) / len2;
        if (t <= 0.001 || t >= 0.999) continue;
        if (Math.hypot(a[0] + t * dx - e[0], a[1] + t * dy - e[1]) < 1.5 * l.resolution) { l.pts.splice(i, 0, [...e]); break; }
      }
    }
  }
  // Nodes every few pixels along each route, so a journey joins a road where it passes.
  for (const l of lines) {
    const out = [l.pts[0]];
    for (let i = 1; i < l.pts.length; i++) {
      const a = l.pts[i - 1], b = l.pts[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (6 * l.resolution)));
      for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
    }
    l.pts = out;
  }
  const nodes = new Map(); // key -> { at, edges: [{ to, px, kind, route, name, pts }] }
  const node = (p) => { const k = key(p); if (!nodes.has(k)) nodes.set(k, { k, at: p, edges: [] }); return nodes.get(k); };
  for (const l of lines) {
    for (let i = 1; i < l.pts.length; i++) {
      const a = node(l.pts[i - 1]), b = node(l.pts[i]);
      if (a === b) continue;
      const px = Math.hypot(b.at[0] - a.at[0], b.at[1] - a.at[1]);
      a.edges.push({ to: b.k, px, kind: l.kind, route: l.id, name: l.name });
      b.edges.push({ to: a.k, px, kind: l.kind, route: l.id, name: l.name });
    }
  }
  // A route that stops short of the network (a gap in the traced roads) is linked to the
  // nearest point of another route within LINK px by a cross-country step.
  const LINK = 60, cell = new Map(), ck = (p) => `${Math.floor(p[0] / LINK)},${Math.floor(p[1] / LINK)}`;
  lines.forEach((l, li) => l.pts.forEach((p) => { const k = ck(p); if (!cell.has(k)) cell.set(k, []); cell.get(k).push({ p, li }); }));
  let links = 0;
  lines.forEach((l, li) => {
    for (const e of [l.pts[0], l.pts.at(-1)]) {
      const en = nodes.get(key(e));
      if (!en || en.edges.length > 1) continue;              // already a junction
      let best = null, bd = LINK * l.resolution;
      const [cx, cy] = [Math.floor(e[0] / LINK), Math.floor(e[1] / LINK)];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const q of cell.get(`${cx + dx},${cy + dy}`) ?? []) {
        if (q.li === li) continue;
        const d = Math.hypot(q.p[0] - e[0], q.p[1] - e[1]);
        if (d < bd && d < LINK * lines[q.li].resolution) { bd = d; best = q.p; }
      }
      if (!best || bd < 0.5 * l.resolution) continue;
      const bn = nodes.get(key(best));
      en.edges.push({ to: bn.k, px: bd, kind: "offroad", route: null, name: null });
      bn.edges.push({ to: en.k, px: bd, kind: "offroad", route: null, name: null });
      links++;
    }
  });
  const graph = { nodes, lines, links, key };
  nameRoads(graph, labels);
  return graph;
}

/**
 * Road names for the stretches that have none. The map names a road once (a label), so each
 * label names the stretch (between junctions) nearest it, within 12 px, and a name carries on
 * through junctions to the stretch that goes straight on. labels: [{ name, at: [x, y] }].
 */
export function nameRoads(graph, labels) {
  const { nodes, lines } = graph;
  const key=graph.key??(p=>`${Math.round(p[0]*2)},${Math.round(p[1]*2)}`);
  const degree = (p) => (nodes.get(key(p))?.edges ?? []).filter((e) => e.kind !== "offroad").length;
  const stretches = [];
  for (const l of lines) {
    let cur = { l, pts: [l.pts[0]], name: l.name };
    for (let i = 1; i < l.pts.length; i++) {
      cur.pts.push(l.pts[i]);
      if (i < l.pts.length - 1 && degree(l.pts[i]) > 2) { stretches.push(cur); cur = { l, pts: [l.pts[i]], name: l.name }; }
    }
    stretches.push(cur);
  }
  for (const lab of labels) {
    let best = null, bd = 12;
    for (const st of stretches) for (const p of st.pts) { const d = Math.hypot(p[0] - lab.at[0], p[1] - lab.at[1]); if (d < bd) { bd = d; best = st; } }
    if (best && !best.name) best.name = lab.name;
  }
  // Ends meeting at each junction, with the direction leaving it.
  const ends = new Map();
  const dir = (pts) => { const a = pts[0], b = pts[Math.min(pts.length - 1, 5)], d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / d, (b[1] - a[1]) / d]; };
  for (const st of stretches) for (const [p, pts] of [[st.pts[0], st.pts], [st.pts.at(-1), [...st.pts].reverse()]]) {
    const k = key(p);
    if (!ends.has(k)) ends.set(k, []);
    ends.get(k).push({ st, d: dir(pts) });
  }
  for (let pass = 0, changed = true; changed && pass < 200; pass++) {
    changed = false;
    for (const list of ends.values()) for (const a of list) {
      if (a.st.name) continue;
      let best = null, bd = -0.8; // straight on: within about 35 degrees
      for (const b of list) if (b.st !== a.st && b.st.name) { const dot = a.d[0] * b.d[0] + a.d[1] * b.d[1]; if (dot < bd) { bd = dot; best = b; } }
      if (best) { a.st.name = best.st.name; changed = true; }
    }
  }
  for (const st of stretches) {
    if (!st.name) continue;
    for (let i = 1; i < st.pts.length; i++) {
      const a = nodes.get(key(st.pts[i - 1])), b = nodes.get(key(st.pts[i]));
      if (!a || !b) continue;
      for (const e of a.edges) if (e.to === b.k && e.route === st.l.id) e.name = st.name;
      for (const e of b.edges) if (e.to === a.k && e.route === st.l.id) e.name = st.name;
    }
  }
}

/** Time (hours) to cross a straight off-road leg at 1 mph equivalents, sampling terrain every few px. */
function offroadCost(a, b, terrainAt, milesPerPixel, opts = {}) {
  const px = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(px / 6));
  // A place on the water's edge (a port, a town on the shore) may sit in a water cell: water this
  // close to either end does not block the way (0.75.4). Water further along still does.
  const edge = Math.max(12, 2 / (milesPerPixel || 1));
  let cost = 0, water = false;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, T = terrainAt(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    if (T.water && Math.min(t, 1 - t) * px > edge) water = true;
    cost += (px / n) * milesPerPixel / speedFactor("offroad", T, opts);
  }
  return { cost, water };
}

/** How far a stop can be from a road and still count as beside it, for a wagon: 3 miles, or a marker's width on a large map. */
export const roadReachMiles = (milesPerPixel) => Math.max(3, 24 * milesPerPixel);
/** Miles from a sheet point to the nearest road or trail. Infinity with none. */
export function roadGapMiles(graph, p, milesPerPixel) {
  let best = Infinity;
  for (const n of graph.nodes.values()) for (const e of n.edges) {
    if (e.kind === "offroad") continue;
    const b = graph.nodes.get(e.to)?.at, a = n.at;
    if (!b) continue;
    const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]));
  }
  return best * milesPerPixel;
}

/**
 * Plan a journey from sheet point `from` to `to`.
 * options: { mode: "best" | "roads" | "direct" | "roadsOnly" (never across country: null if a road cannot do it), trailRule, terrainAt, milesPerPixel, hookPx (how far to leave
 * the network), hooks (network nodes tried at each end) }.
 * Returns { legs: [{ kind, name, pts, miles, terrain }], miles, normalHours } or null.
 */
export function planJourney(graph, from, to, { mode = "best", trailRule = false, rules = "2014", pace = "normal", terrainAt = () => PLAINS, milesPerPixel, hookPx = 400, hooks = 12, offroadBias = 1.4, segments = null } = {}) {
  const opts = { trailRule, rules, pace };
  // When choosing the way, going off-road counts more (rough going, no road to follow).
  // "roads": off-road counts double, so short hops go straight and long trips take the road.
  const bias = mode === "direct" ? 1 : mode === "roads" ? 2 : offroadBias;
  const metricCost = (a,b,kind) => {
    if (!segments) return null;
    let cost=0,water=false;
    for(const s of segments(a,b)) { const n=Math.max(1,Math.ceil(Math.hypot(s.nativeTo[0]-s.nativeFrom[0],s.nativeTo[1]-s.nativeFrom[1]) / 6));
      for(let i=0;i<n;i++){const t=(i+.5)/n,T=terrainAt(s.from[0]+(s.to[0]-s.from[0])*t,s.from[1]+(s.to[1]-s.from[1])*t);water ||= !!T.water;cost+=s.miles/n/speedFactor(kind,T,opts);}
    }return {cost,water};
  };
  const offroadCostB = (a, b) => { const c = metricCost(a,b,"offroad") ?? offroadCost(a, b, terrainAt, milesPerPixel, opts); return { ...c, cost: c.cost * bias }; };
  const mpp = milesPerPixel;
  const direct = () => {
    const { cost, water } = offroadCostB(from, to);
    return water && mode !== "direct" ? null : { cost, legs: [{ kind: "offroad", pts: [from, to] }] };
  };
  if (mode === "roadsOnly" && (roadGapMiles(graph, from, mpp) > roadReachMiles(mpp) || roadGapMiles(graph, to, mpp) > roadReachMiles(mpp))) return null;
  if (mode === "direct" || !graph.nodes.size) return finish(direct());
  // Network nodes near each end, joined off-road.
  const all = [...graph.nodes.values()];
  const near = (p) => all.map((n) => ({ n, d: Math.hypot(n.at[0] - p[0], n.at[1] - p[1]) }))
    .filter((x) => x.d <= hookPx).sort((a, b) => a.d - b.d).slice(0, hooks);
  const starts = near(from), goals = near(to);
  if (!starts.length || !goals.length) return mode === "roadsOnly" ? null : finish(direct());
  const goalCost = new Map(goals.map(({ n }) => { const c = offroadCostB(n.at, to); return [n.k, c.water ? Infinity : c.cost]; }));
  // Dijkstra over hours (at 1 mph scale; pace scales all legs alike).
  const dist = new Map(), prev = new Map(), heap = [];
  // Binary min-heap of [cost, key].
  const push = (k, d) => { heap.push([d, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (const { n } of starts) {
    const c = offroadCostB(from, n.at);
    if (c.water) continue;
    if (c.cost < (dist.get(n.k) ?? Infinity)) { dist.set(n.k, c.cost); prev.set(n.k, null); push(n.k, c.cost); }
  }
  let best = null;
  while (heap.length) {
    const [d, k] = pop();
    if (d > (dist.get(k) ?? Infinity)) continue;
    if (best && d >= best.cost) break;
    const gc = goalCost.get(k);
    if (gc !== undefined && d + gc < (best?.cost ?? Infinity)) best = { cost: d + gc, k };
    const n = graph.nodes.get(k);
    for (const e of n.edges) {
      const mid = graph.nodes.get(e.to).at, T = terrainAt((n.at[0] + mid[0]) / 2, (n.at[1] + mid[1]) / 2);
      const metric = metricCost(n.at,mid,e.kind);
      if (metric?.water && e.kind === "offroad") continue;
      const nd = d + (metric?.cost ?? (e.px * mpp) / speedFactor(e.kind, T, opts)) * (e.kind === "offroad" ? bias : 1);
      if (nd < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, nd); prev.set(e.to, { k, e }); push(e.to, nd); }
    }
  }
  const viaNet = best;
  if (!viaNet && mode === "roadsOnly") return null;
  const straight = mode === "best" || mode === "roads" ? direct() : null;
  if (!viaNet || (straight && straight.cost < viaNet.cost)) return finish(straight ?? (viaNet ? null : direct()));
  // Walk back into legs, merging consecutive edges of one route.
  const steps = [];
  for (let k = viaNet.k; prev.get(k); k = prev.get(k).k) steps.unshift({ from: prev.get(k).k, to: k, e: prev.get(k).e });
  const first = steps.length ? graph.nodes.get(steps[0].from).at : graph.nodes.get(viaNet.k).at;
  const legs = [{ kind: "offroad", pts: [from, first] }];
  for (const s of steps) {
    const last = legs.at(-1), at = graph.nodes.get(s.to).at;
    if (last.route === s.e.route && last.name === s.e.name) last.pts.push(at);
    else legs.push({ kind: s.e.kind, route: s.e.route, name: s.e.name, pts: [graph.nodes.get(s.from).at, at] });
  }
  legs.push({ kind: "offroad", pts: [graph.nodes.get(viaNet.k).at, to] });
  return finish({ cost: viaNet.cost, legs: legs.filter((l) => polyPx(l.pts) > 0.5) });

  function finish(r) {
    if (!r) return null;
    if (segments) {
      const legs=r.legs.flatMap(l=>l.pts.slice(1).flatMap((b,i)=>segments(l.pts[i],b).map(s=>({...l,pts:[s.from,s.to],miles:s.miles,worldId:s.worldId,regionTitle:s.regionTitle,nativePts:[s.nativeFrom,s.nativeTo],terrain:terrainAt((s.from[0]+s.to[0])/2,(s.from[1]+s.to[1])/2).name}))));
      return {legs,miles:legs.reduce((n,l)=>n+l.miles,0),normalHours:r.cost};
    }
    const legs = r.legs.map((l) => {
      const px = polyPx(l.pts), mid = l.pts[Math.floor(l.pts.length / 2)];
      return { ...l, miles: px * mpp, terrain: terrainAt(...mid).name };
    });
    return { legs, miles: legs.reduce((s, l) => s + l.miles, 0), normalHours: r.cost };
  }
}

export function metricPlan(plan, segments) {
  const legs=plan.legs.flatMap(l=>l.pts.slice(1).flatMap((b,i)=>segments(l.pts[i],b).map(s=>({...l,pts:[s.from,s.to],miles:s.miles,worldId:s.worldId,regionTitle:s.regionTitle,nativePts:[s.nativeFrom,s.nativeTo]}))));
  return {...plan,legs,miles:legs.reduce((n,l)=>n+l.miles,0)};
}

export function polyPx(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

/**
 * The journey as days at a pace. hoursPerDay defaults to 8 (longer is a forced march).
 * Encounters [{ id, name, at: [x, y], dc, radius (px) }] on the path are placed on their day.
 * Returns { days: [{ day, miles, hours, encounters }], hours, days count, forcedMarchHours }.
 */
export function schedule(plan, { pace = "normal", hoursPerDay = 8, terrainAt = () => PLAINS, trailRule = false, rules = "2014", milesPerPixel, encounters = [], baseMph = 3, speedAt = null } = {}) {
  // Party speed: normal pace is a tenth of the slowest walking speed (30 ft: 3 mph); fast and slow scale it.
  const mph = baseMph * PACES[pace].mph / 3;
  // mph over a piece of the way: a boat's own speed, else the method's (speedAt), else the party's.
  const speed = (leg, T) => leg.mph ?? speedAt?.(leg.kind, T) ?? mph * speedFactor(leg.kind, T, { trailRule, rules, pace });
  // Hours along the path, sampled.
  const samples = []; // { at, hour, v (mph) }
  let hour = 0, miles = 0;
  for (const leg of plan.legs) {
    for (let i = 1; i < leg.pts.length; i++) {
      const a = leg.pts[i - 1], b = leg.pts[i], px = Math.hypot(b[0] - a[0], b[1] - a[1]), distance = leg.nativePts ? leg.miles * px / (polyPx(leg.pts) || 1) : px * milesPerPixel, n = Math.max(1, Math.ceil(leg.nativePts ? Math.max(distance,Math.hypot(leg.nativePts.at(-1)[0]-leg.nativePts[0][0],leg.nativePts.at(-1)[1]-leg.nativePts[0][1])/6) : px / 6));
      for (let j = 0; j < n; j++) {
        const p = [a[0] + (b[0] - a[0]) * (j + 0.5) / n, a[1] + (b[1] - a[1]) * (j + 0.5) / n];
        const T=terrainAt(...p), v = speed(leg, T);
        const at = leg.nativePts ? [a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n] : p;
        samples.push({ at, hour, kind: leg.kind, waterway: leg.waterway, v, ...(leg.nativePts?{miles,worldId:leg.worldId,regionTitle:leg.regionTitle,terrain:T}: {}) });
        hour += distance / n / v; miles += distance / n;
      }
    }
  }
  if(plan.legs.some(l=>l.nativePts)){
    const last=plan.legs.at(-1);samples.push({at:last.pts.at(-1),hour,miles,worldId:last.worldId,regionTitle:last.regionTitle,terrain:terrainAt(...last.pts.at(-1)),kind:last.kind,v:0});
  }
  const total = hour;
  const dayCount = Math.max(1, Math.ceil(total / hoursPerDay - 1e-9));
  const days = Array.from({ length: dayCount }, (_, i) => ({ day: i + 1, hours: Math.min(hoursPerDay, total - i * hoursPerDay), miles: 0, encounters: [] }));
  for (let i = 0; i < samples.length; i++) {
    const next = samples[i + 1]?.hour ?? total, d = Math.min(dayCount - 1, Math.floor(samples[i].hour / hoursPerDay));
    days[d].miles += (next - samples[i].hour) * samples[i].v;
  }
  for (const e of encounters) {
    let best = null;
    for (const s of samples) { const d = encounterDistance(e,s.at); if (d <= (e.radius ?? 15) && (!best || d < best.d)) best = { d, s }; }
    if (best) {
      const di = Math.min(dayCount - 1, Math.floor(best.s.hour / hoursPerDay));
      days[di].encounters.push({ ...e, hourOfDay: best.s.hour - di * hoursPerDay });
    }
  }
  for (const d of days) d.encounters.sort((a, b) => a.hourOfDay - b.hourOfDay);
  // Camps: where each day's travel ends (a long rest before the next day).
  const camps = days.slice(0, -1).map((d) => ({ day: d.day, hour: d.day * hoursPerDay, at: pointAtHour(samples, d.day * hoursPerDay) }));
  return { days, hours: total, pace, hoursPerDay, forcedMarch: hoursPerDay > 8, samples, camps };
}

/** The path position (sheet pixels) reached after `hour` travel hours. */
export function pointAtHour(samples, hour) {
  if (!samples.length) return null;
  if (hour <= samples[0].hour) return samples[0].at;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].hour >= hour) {
      const a = samples[i - 1], b = samples[i], t = (hour - a.hour) / Math.max(1e-9, b.hour - a.hour);
      return [a.at[0] + (b.at[0] - a.at[0]) * t, a.at[1] + (b.at[1] - a.at[1]) * t];
    }
  }
  return samples.at(-1).at;
}

/**
 * Who notices an encounter: each character's passive Perception, adjusted for pace, against its DC.
 * party: [{ name, passive }]. Returns [{ name, passive, adjusted, notices }].
 */
export function perceptionAgainst(party, dc, pace) {
  const mod = PACES[pace]?.perception ?? 0;
  return party.map((c) => ({ ...c, adjusted: c.passive + mod, notices: dc == null ? null : c.passive + mod >= dc }));
}

/** Forced march (beyond 8 hours): Constitution save DC for each extra hour, 11, 12, ... */
export function forcedMarchDCs(hoursPerDay) {
  return Array.from({ length: Math.max(0, Math.ceil(hoursPerDay) - 8) }, (_, i) => 10 + i + 1);
}

/**
 * A journey through waypoints (sheet points), each leg planned on its own; stays[i] is the days
 * spent at waypoint i + 1 before going on. Every leg starts at the start of a day.
 * Returns { legs: [{ from, to, plan, sched, days, miles }], days: [{ day, type: "travel" | "stay",
 * leg, miles, hours, start, end, encounters }], path: [{ at, day }], miles, ground: { road, trail, offroad } }
 * or null when a leg has no way over land.
 */
/**
 * mph over ground of a kind for a travel method. method: { key (METHODS), baseMph (on foot), mph
 * (custom or flying) }. Returns a speedAt(kind, terrain) for schedule().
 */
export function methodSpeed(method, { pace = "normal", rules = "2014", trailRule = false } = {}) {
  const k = method?.key ?? "foot", M = METHODS[k] ?? METHODS.foot, f = PACES[pace].mph / 3;
  if (k === "flying") return () => method.mph ?? 8;
  const base = k === "foot" ? (method?.baseMph ?? 3) * f : k === "custom" ? (method?.mph ?? 3) : 3 * f;
  // A coach's own speed, on roads only (its stations are there): the GM's, or the default. Pace scales it.
  const road = M.roadMph ? (method?.roadMph ?? M.roadMph) * f : base;
  return (kind, T) => {
    const v = (kind === "road" ? road : base) * speedFactor(kind, T, { trailRule, rules, pace });
    return M.offroad && kind === "offroad" ? Math.min(v, PACES.slow.mph * speedFactor(kind, T, { trailRule, rules, pace: "slow" })) : v;
  };
}

/**
 * legs[i] (optional) says how each leg goes: { method (as methodSpeed takes), sea: { vessel:
 * { mph, crewed } } }. A sea leg is planned by seaPlan(from, to, vessel); when no water joins its
 * ends it goes overland. A crewed ship sails round the clock: its stretch of the journey is in
 * `sail` ([{ from, to }] travel hours), where the party does not stop to camp.
 */
export function itinerary(graph, waypoints, { stays = [], legModes = [], legs: how = [], seaPlan = null, mode = "best", rules = "2014", pace = "normal", hoursPerDay = 8, trailRule = false, terrainAt = () => PLAINS, milesPerPixel, encounters = [], baseMph = 3, segments = null } = {}) {
  const legs = [], days = [], path = [], ground = { road: 0, trail: 0, offroad: 0, water: 0 }, track = [], legEnds = [], sail = [];
  let clock = 0;
  for (let i = 0; i + 1 < waypoints.length; i++) {
    const from = waypoints[i], to = waypoints[i + 1], h = how[i] ?? {};
    let plan = null, sched = null, perDay = hoursPerDay;
    if (h.sea && seaPlan) {
      plan = seaPlan(from, to, h.sea.vessel);
      if (plan) {
        if (segments) plan = metricPlan(plan,segments);
        if (h.sea.vessel?.crewed) perDay = 24;
        sched = schedule(plan, { pace, hoursPerDay: perDay, terrainAt, milesPerPixel, encounters });
      }
    }
    const flying = h.method?.key === "flying";
    // legModes: "direct" across country; null, "road" (the ship turned down) or "sea" (not port to port): the roads.
    const m = METHODS[h.method?.key]?.roadsOnly ? "roadsOnly" : flying || legModes[i] === "direct" ? "direct" : mode;
    let bySea = !!plan, autoSea = false;
    if (!plan) {
      plan = planJourney(graph, from, to, { mode: m, rules, pace, trailRule, terrainAt: flying ? () => PLAINS : terrainAt, milesPerPixel, hookPx: 2000, segments });
      // No way overland (an island, a port cut off by water): by boat, if water joins the two (0.75.5).
      if (!plan && !flying && h.seaFallback && seaPlan) {
        plan = seaPlan(from, to, h.seaFallback.vessel);
        if (plan) {
          bySea = autoSea = true;
          if (segments) plan = metricPlan(plan,segments);
          if (h.seaFallback.vessel?.crewed) perDay = 24;
          sched = schedule(plan, { pace, hoursPerDay: perDay, terrainAt, milesPerPixel, encounters });
        }
      }
      if (!plan) return null;
      if (!autoSea) sched = schedule(plan, { pace, hoursPerDay, terrainAt: flying ? () => PLAINS : terrainAt, trailRule, rules, milesPerPixel, encounters, baseMph, speedAt: h.method ? methodSpeed(h.method, { pace, rules, trailRule }) : null });
    }
    if (perDay >= 24) sail.push({ from: clock, to: clock + sched.hours });
    const first = days.length;
    for (const d of sched.days) {
      const endHour = Math.min(sched.hours, d.day * perDay);
      days.push({ day: days.length + 1, type: "travel", leg: i, miles: d.miles, hours: d.hours,
        start: pointAtHour(sched.samples, (d.day - 1) * perDay), end: pointAtHour(sched.samples, endHour), encounters: d.encounters });
    }
    for (const sm of sched.samples) path.push({ at: sm.at, day: first + Math.floor(sm.hour / perDay) + 1 });
    for (const sm of sched.samples) track.push({ ...sm, ...(segments?{miles:legs.reduce((n,l)=>n+l.miles,0)+(sm.miles??0)}:{}), hour: clock + sm.hour, leg: i });
    const startHour = clock;
    clock += sched.hours;
    legEnds.push(clock);
    for (const l of plan.legs) ground[WATER_KINDS.has(l.kind) ? "water" : l.kind] += l.miles;
    for (let k = 0; k < (stays[i] ?? 0); k++) days.push({ day: days.length + 1, type: "stay", leg: i, miles: 0, hours: 0, start: to, end: to, encounters: [] });
    legs.push({ from, to, plan, sched, days: sched.days.length, miles: plan.miles, hours: sched.hours, start: startHour, mode: m, method: h.method?.key ?? "foot", sea: bySea, autoSea, crewed: perDay >= 24 });
  }
  path.push({ at: waypoints.at(-1), day: days.length });
  track.push({ at: waypoints.at(-1), hour: clock, leg: legs.length - 1, ...(segments?{worldId:track.at(-1)?.worldId,regionTitle:track.at(-1)?.regionTitle,terrain:track.at(-1)?.terrain,miles:legs.reduce((n,l)=>n+l.miles,0)}:{}) });
  return { legs, days, path, track, legEnds, sail, hours: clock, miles: legs.reduce((s, l) => s + l.miles, 0), ground };
}

export function encounterDistance(e,p) {
  const dx=p[0]-e.at[0],dy=p[1]-e.at[1],m=e.nativeMetric;
  return m ? Math.hypot(m[0]*dx+m[2]*dy,m[1]*dx+m[3]*dy) : Math.hypot(dx,dy);
}

/** Travel hour at which the track passes each encounter (nearest point within its radius, px). */
export function encounterHours(track, encounters) {
  const out = [];
  for (const e of encounters) {
    if (isRiverHazard(e)) { out.push(...riverHazardHours(track,e)); continue; }
    let best = null;
    for (const s of track) { if (s.timingBoundary) continue; const d = encounterDistance(e,s.at); if (d <= (e.radius ?? 15) && (!best || d < best.d)) best = { d, s }; }
    if (best) out.push({ ...e, hour: best.s.hour });
  }
  return out.sort((a, b) => a.hour - b.hour);
}

/**
 * Where a journey stands at world time `now` (seconds), replayed from when it set off.
 * The party travels until it has done `hoursPerDay` hours since its last rest, then stops for
 * the GM's choice: decisions[k] is { rest: hours, started?: worldSeconds } or { push: true, started?: worldSeconds } (one
 * more hour). It stops at each encounter until resumed[id] (world time the GM carried on),
 * stays at stops as planned, and stands still through halts [{ from, to }] (to null: still halted).
 * plan: { hours (total travel hours), encounters: [{ id, hour }], stays: [{ hour, seconds }] }.
 * autoRest: hours to rest at undecided stops instead of waiting (the choices made are returned).
 * Returns { hour, status, since, until, encounter, dayHours, limit, stop, made }; status is
 * "moving", "halted", "resting", "stay", "decide", "encounter" or "arrived".
 */
/** Where a travel hour stands against the plan's round-the-clock sailing: { inSail, toStart, toEnd }. */
function sailAt(plan, h) {
  let toStart = Infinity;
  for (const r of plan?.sail ?? []) {
    if (h >= r.from - 1e-9 && h < r.to - 1e-9) return { inSail: true, toStart: Infinity, toEnd: r.to - h };
    if (r.from > h) toStart = Math.min(toStart, r.from - h);
  }
  return { inSail: false, toStart, toEnd: Infinity };
}

export function replayTrip(trip, plan, now, { hoursPerDay = 8, autoRest = null, autoResume = false, skipCamp = false } = {}) {
  const halts = [...(trip.halts ?? [])].sort((a, b) => a.from - b.from);
  const decisions = [...(trip.decisions ?? [])], resumed = trip.resumed ?? {}, made = [];
  // Encounters met on the way, by travel hour; and encounters met in camp (rest: { night, at }):
  // on that night of the journey (the n-th camp made), its hours into the rest. One set before
  // nights were counted (no night) comes at the first camp at or after its travel hour.
  const all = plan.encounters ?? [], encs = all.filter((e) => !e.rest), campEncs = all.filter((e) => e.rest).sort((a, b) => a.hour - b.hour);
  const stays = (plan.stays ?? []).filter((s) => s.seconds > 0);
  let t = trip.departed, h = 0, day = 0, limit = hoursPerDay, ei = 0, si = 0, stop = 0, night = 0;
  const camps = [], met = new Set();
  // autoResume (a projection of the whole journey): encounters are over at once, halts end at once.
  const resumedAt = (id, at) => (autoResume ? resumed[id] ?? at : resumed[id]);
  // Aboard a crewed ship the party sails on through the night: no stop to camp until it lands.
  const out = (status, extra = {}) => ({ hour: h, status, since: t, dayHours: day, limit, stop, night, camps, made, sailing: sailAt(plan, h).inSail, ...extra });
  for (let guard = 0; guard < 100000; guard++) {
    // Halted now?
    const halt = halts.find((x) => x.from <= t && (x.to == null || x.to > t));
    if (halt) {
      if (!autoResume && (halt.to == null || halt.to > now)) return out("halted", { since: halt.from, until: halt.to, away: !!halt.away });
      t = halt.to ?? t; if (halt.to == null) halts.splice(halts.indexOf(halt), 1); continue;
    }
    if (t >= now) return out("moving");
    const sea = sailAt(plan, h);
    const toEnd = plan.hours - h, toLimit = sea.inSail ? Infinity : limit - day;
    const toEnc = ei < encs.length ? Math.max(0, encs[ei].hour - h) : Infinity;
    const toStay = si < stays.length ? Math.max(0, stays[si].hour - h) : Infinity;
    const dh = Math.max(0, Math.min(toEnd, toLimit, toEnc, toStay, sea.toStart, sea.toEnd));
    const te = t + dh * 3600, tired = sea.inSail ? 0 : 1;
    const nextHalt = halts.find((x) => x.from > t && x.from < te);
    const until = Math.min(now, nextHalt ? nextHalt.from : Infinity);
    if (until < te) { const d = (until - t) / 3600; h += d; day += d * tired; t = until; continue; }
    h += dh; day += dh * tired; t = te;
    if (toEnc <= dh) {
      // An encounter on the way: the party waits for the GM. The time it takes is not travel, so the
      // day's hours on the road are what they were, and the night's camp is where it was.
      const e = encs[ei++], r = resumedAt(e.id, t);
      if (r == null || r > now) return out("encounter", { encounter: e });
      t = Math.max(t, r); continue;
    }
    if (toEnd <= dh) return out("arrived");
    if (toStay <= dh) {
      const st = stays[si++], end = t + st.seconds;
      day = 0; limit = hoursPerDay;
      if (end > now) return out("stay", { until: end });
      t = end; continue;
    }
    // Landing: the party slept aboard, so its day starts fresh. Boarding: it sails on.
    if (sea.toEnd <= dh) { day = 0; limit = hoursPerDay; continue; }
    if (sea.toStart <= dh && toLimit > dh) continue;
    // The day's travel is done.
    let dec = decisions[stop];
    if (!dec && autoRest != null) { dec = { rest: autoRest }; decisions[stop] = dec; made.push(dec); }
    if (!dec) return out("decide", { night: night + 1 });
    if (Number.isFinite(dec.started)) {
      const started = Math.max(t, dec.started);
      if (started > now) return out("decide", { night: night + 1, until: started });
      t = started;
    }
    stop++;
    if (dec.push) { limit += 1; continue; }
    night++;
    camps.push(h);
    const campEnd = trip.campEnds?.[night];
    let end = campEnd?.at ?? (t + (dec.rest ?? 16) * 3600);
    day = 0; limit = hoursPerDay;
    // Encounters in this camp: each comes its hours into the rest, the party waits for the GM to
    // carry on, and the rest goes on for the time it had left. One whose watch rolls never came up
    // (rest.quiet), or not yet rolled (rest.pending: the camp scene rolls it as its watch begins),
    // does not come. skipCamp (Next encounter): camp encounters are the watches' to bring, so time
    // passes them by.
    const camped = t, here = campEncs.filter((e) => !met.has(e.id) && !e.rest.quiet && !e.rest.pending && !skipCamp && (e.rest.night != null ? e.rest.night === night : e.hour <= h + 0.5))
      .sort((a, b) => (a.rest.at ?? 0) - (b.rest.at ?? 0));
    let held = 0; // seconds the rest has stood still for encounters so far
    for (const e of here) {
      const at = Math.min(end, camped + Math.max(0, e.rest.at ?? 0) * 3600 + held);
      if (at > now) return out("resting", { until: end, since: camped });
      const r = resumedAt(e.id, at);
      if (r == null || r > now) return out("encounter", { encounter: e, since: at, camp: true, campStart: camped });
      met.add(e.id);
      const wait = Math.max(0, r - at);
      held += wait; if (!campEnd) end += wait; t = Math.max(at, r);
    }
    if (end > now) return out("resting", { until: end, since: camped });
    t = end;
  }
  return out("moving");
}

/**
 * Where each night's camp falls (travel hours), as the journey has gone so far and as it will go:
 * the journey replayed to its end with encounters over at once and the GM resting `rest` hours at
 * each undecided stop. An encounter that held the party up moves the camps after it.
 */
export function projectCamps(trip, plan, { hoursPerDay = 8, rest = 16 } = {}) {
  return replayTrip(trip, plan, Infinity, { hoursPerDay, autoRest: rest, autoResume: true }).camps;
}

/**
 * The journey as a route sheet: the points where something changes (a place on the way, joining
 * or leaving a road, one road meeting another, a stop to stay at) and the going between them.
 * itin: from itinerary(); stops: [{ name, keep }] for each waypoint (keep: a place or a stay, so
 * it is listed; other clicks only shape the path); places: [{ name, at, settlement }] that can be
 * passed or name a point. Returns { nodes: [{ name, miles, hour, stop }], segments: [{ via,
 * kind, miles, hours, leg }] } with segments[i] between nodes[i] and nodes[i + 1].
 */
export function routeSheet(itin, { stops = [], places = [], milesPerPixel }) {
  const mpp = milesPerPixel;
  // The path as pieces in order, each knowing its distance from the start (px).
  const pieces = [];
  let run = 0;
  const legEnds = [];
  itin.legs.forEach((leg, li) => {
    for (const p of leg.plan.legs) { const rawPx = polyPx(p.pts), px = p.nativePts ? p.miles / mpp : rawPx; pieces.push({ ...p, leg: li, pxScale: px / (rawPx || 1), d0: run, d1: run + px }); run += px; }
    legEnds.push(run);
  });
  const total = run;
  // A short step off a road and back onto the same road (to reach a point that only shapes the
  // path, or across a gap in the traced roads) is not leaving it: it counts as that road.
  for (let j = 1; j + 1 < pieces.length; j++) {
    const a = pieces[j - 1], p = pieces[j];
    if (p.kind !== "offroad" || (p.d1 - p.d0) * mpp > 3) continue;
    let k = j + 1;
    while (k < pieces.length && pieces[k].kind === "offroad") k++;
    // All of the off-road run between the two stretches of road, not each piece, must be short.
    if ((pieces[k - 1].d1 - p.d0) * mpp > 3) { j = k - 1; continue; }
    const b = pieces[k];
    if (b && a.kind !== "offroad" && b.kind === a.kind && b.name === a.name) for (let q = j; q < k; q++) Object.assign(pieces[q], { kind: a.kind, name: a.name });
  }
  // Hour at a distance along, from the track.
  const track = itin.track ?? [];
  const trackD = [];
  track.forEach((t, i) => trackD.push(Number.isFinite(t.miles) ? t.miles / mpp : i ? trackD[i - 1] + Math.hypot(t.at[0] - track[i - 1].at[0], t.at[1] - track[i - 1].at[1]) : 0));
  const scale = total / (trackD.at(-1) || 1);
  const hourAt = (d) => {
    const x = d / (scale || 1);
    const i = trackD.findIndex((v) => v >= x);
    if (i <= 0) return i === 0 ? 0 : itin.hours ?? 0;
    const f = (x - trackD[i - 1]) / Math.max(1e-9, trackD[i] - trackD[i - 1]);
    return track[i - 1].hour + (track[i].hour - track[i - 1].hour) * f;
  };
  const pointAt = (d) => {
    for (const p of pieces) if (d <= p.d1 + 1e-9) {
      let r = (d - p.d0) / (p.pxScale || 1);
      for (let i = 1; i < p.pts.length; i++) { const a = p.pts[i - 1], b = p.pts[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (r <= l) { const t = l ? r / l : 0; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; } r -= l; }
      return p.pts.at(-1);
    }
    return pieces.at(-1)?.pts.at(-1) ?? [0, 0];
  };
  const nearPlace = (at, mi) => { let best = null, bd = mi / mpp; for (const q of places) { const d = Math.hypot(q.at[0] - at[0], q.at[1] - at[1]); if (d < bd) { bd = d; best = q; } } return best; };
  const roadName = (p) => p.name ?? ({ trail: "the trail", sea: "open sea", river: "the river", wind: "the trade wind", lane: "the sea route" }[p.kind] ?? "the road");
  const wet = (p) => WATER_KINDS.has(p.kind);
  const events = []; // { d, name, rank, stop }
  events.push({ d: 0, name: stops[0]?.name ?? "Start", rank: 9, stop: 0 });
  events.push({ d: total, name: stops.at(-1)?.name ?? "End", rank: 9, stop: stops.length - 1 });
  // Regional entry/exit is part of one itinerary, never an implied arrival.
  for(let j=1;j<pieces.length;j++)if(pieces[j-1].worldId!==pieces[j].worldId&&(pieces[j-1].regionTitle||pieces[j].regionTitle)){
    const region=pieces[j].regionTitle;
    events.push({d:pieces[j].d0,name:region?`Enter ${region}`:`Leave ${pieces[j-1].regionTitle}`,rank:7});
  }
  // Where the going changes.
  for (let j = 1; j < pieces.length; j++) {
    const a = pieces[j - 1], b = pieces[j];
    if (a.kind === b.kind && (a.kind === "offroad" || a.name === b.name)) continue;
    const at = pieces[j].pts[0], place = nearPlace(at, 3);
    let name;
    if (wet(a) || wet(b)) name = place ? place.name : !wet(a) ? "Set sail" : !wet(b) ? "Go ashore" : b.kind !== "sea" ? `Join ${roadName(b)}` : `Leave ${roadName(a)}`;
    else if (b.kind === "offroad") name = place ? place.name : `Leave ${roadName(a)}`;
    else if (a.kind === "offroad") name = place ? place.name : (b.name ?? (b.kind === "trail" ? "Trail" : "Road"));
    else name = place ? place.name : `${b.name ?? a.name ?? "Road"} crossroads`;
    events.push({ d: a.d1, name, rank: place ? 3 : 2 });
  }
  // Places on the way: settlements within 2 miles of the path, other places within 1.
  for (const q of places) {
    const lim = (q.settlement ? 2 : 1) / mpp;
    let best = null, bd = lim;
    for (const p of pieces) {
      let acc = p.d0;
      for (let i = 1; i < p.pts.length; i++) {
        const a = p.pts[i - 1], b = p.pts[i], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9, l = Math.sqrt(l2);
        const t = Math.max(0, Math.min(1, ((q.at[0] - a[0]) * dx + (q.at[1] - a[1]) * dy) / l2));
        const d = Math.hypot(a[0] + t * dx - q.at[0], a[1] + t * dy - q.at[1]);
        if (d < bd) { bd = d; best = acc + t * l * (p.pxScale || 1); }
        acc += l * (p.pxScale || 1);
      }
    }
    if (best != null) events.push({ d: best, name: q.name, rank: q.settlement ? 5 : 4 });
  }
  // Stops that are places or stays.
  stops.forEach((s, i) => { if (i > 0 && i < stops.length - 1 && s.keep) events.push({ d: legEnds[i - 1], name: s.name, rank: 8, stop: i }); });
  // In order; points within a mile of each other are one, named by the most important.
  events.sort((a, b) => a.d - b.d);
  const nodes = [];
  const close = 1 / mpp;
  for (const e of events) {
    const last = nodes.at(-1);
    if (last && e.d - last.d < close && !(last.stop != null && e.stop != null && last.stop !== e.stop)) {
      if (e.rank > last.rank) { last.name = e.name; last.rank = e.rank; }
      if (e.stop != null) last.stop = e.stop;
      if (e.rank === 9) last.d = e.d;
      continue;
    }
    nodes.push({ ...e });
  }
  // The going between nodes: the kind of ground covered most, and its road's name.
  const segments = [];
  for (let i = 1; i < nodes.length; i++) {
    const d0 = nodes[i - 1].d, d1 = nodes[i].d, by = new Map();
    let leg = 0;
    for (const p of pieces) {
      const o = Math.min(d1, p.d1) - Math.max(d0, p.d0);
      if (o <= 0) continue;
      const k = p.kind === "offroad" ? `offroad|${p.terrain ?? ""}` : `${p.kind}|${roadName(p)}`;
      by.set(k, (by.get(k) ?? 0) + o);
      leg = p.leg;
    }
    const [k] = [...by.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["offroad|"];
    const [kind, what] = k.split("|");
    const via = kind === "offroad" ? `Overland${what && what !== "plains" ? `, ${what}` : ""}` : what.replace(/^the /, "").replace(/^./, (c) => c.toUpperCase());
    segments.push({ via, kind, miles: (d1 - d0) * mpp, hours: hourAt(d1) - hourAt(d0), leg });
  }
  return { nodes: nodes.map((n) => ({ name: n.name, miles: n.d * mpp, hour: hourAt(n.d), stop: n.stop ?? null, at: pointAt(n.d) })), segments };
}
/**
 * Hours from setting off until travel hour `hour` is reached, on the plan's own schedule: a day's
 * travel (hoursPerDay), then camp for `rest` hours, and each planned stay (plan.stays: { hour,
 * seconds }) spent where it falls; a stay ends the day's travel, as the trip itself does.
 * Encounters, whose length is not known ahead, are not counted.
 */
export function elapsedAt(plan, hour, opts = {}) { return walkPlan(plan, hour, opts).t; }

/** Travel hours at which the party makes camp, up to `hour` (none while a crewed ship sails on). */
export function campHours(plan, hour, opts = {}) { return walkPlan(plan, hour, opts).camps; }

function walkPlan(plan, hour, { hoursPerDay = 8, rest = 16 } = {}) {
  const stays = (plan?.stays ?? []).filter((s) => s.seconds > 0).sort((a, b) => a.hour - b.hour);
  let t = 0, h = 0, day = 0, si = 0;
  const camps = [];
  for (let guard = 0; guard < 100000 && h < hour - 1e-9; guard++) {
    const sea = sailAt(plan, h);
    const toStay = si < stays.length ? stays[si].hour - h : Infinity;
    const step = Math.max(0, Math.min(hour - h, sea.inSail ? Infinity : hoursPerDay - day, toStay, sea.toStart, sea.toEnd));
    h += step; t += step;
    if (!sea.inSail) day += step;
    if (h >= hour - 1e-9) break;
    if (si < stays.length && stays[si].hour - h <= 1e-9) { t += stays[si++].seconds / 3600; day = 0; continue; }
    if (sea.toEnd <= step + 1e-9) { day = 0; continue; }
    if (!sea.inSail && day >= hoursPerDay - 1e-9) { t += rest; day = 0; camps.push(h); }
  }
  return { t, camps };
}
