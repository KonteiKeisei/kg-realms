// Travel by water on the Faerun sheet. Pure: no Foundry. Sheet pixels inside, miles outside.
//
// The sea is the map's own water (terrain code 8), read on a coarse grid. The GM's waterways
// change it: a shoreline is a wall no boat crosses, a river is a line with a current (faster
// downstream, slower up), a trade wind or an ocean current reaches 250 miles either side of its
// line while it blows (in its seasons), where ships sailing with it go faster and against it half
// as fast, and a sea route is a lane ships prefer. Elsewhere ships keep to the
// coast, crossing open water by the shortest way to the next coast. A boat leaves and lands at
// ports: the route finder looks for water near each end.
//
// Vessel speeds after the D&D 5e vehicle table (the same in 2014 and 2024). Crewed ships sail
// round the clock; rowed boats travel the party's day.

export const VESSELS = {
  rowboat: { label: "Rowboat", mph: 1.5, crewed: false },
  keelboat: { label: "Keelboat", mph: 1, crewed: false },
  sailing: { label: "Sailing ship", mph: 2, crewed: true },
  warship: { label: "Warship", mph: 2.5, crewed: true },
  longship: { label: "Longship", mph: 3, crewed: true },
  galley: { label: "Galley", mph: 4, crewed: true }
};
export const WATERWAY_KINDS = {
  shore: { label: "Shoreline", icon: "fa-water", color: "#ffc94a" },
  river: { label: "River", icon: "fa-water", color: "#4ad0ff" },
  wind: { label: "Wind or current", icon: "fa-wind", color: "#6fd36f" },
  lane: { label: "Sea route", icon: "fa-anchor", color: "#e8d9b0" }
};
export const SEASONS = ["spring", "summer", "autumn", "winter"];
export const TRADE_WIND = 1.5;
export const RIVER_CURRENT = 3;
/**
 * How far a wind or current reaches either side of its line (miles), and a ship's speed sailing
 * straight against it. In between, the effect goes with how squarely the ship sails with it or into
 * it (the cosine): straight with it its factor, across it none, straight into it half. So beating
 * to and fro never beats sailing straight.
 */
export const WIND_BAND_MI = 250, AGAINST_WIND = 0.5;
/** A wind's effect this small or less counts as open sea in the voyage's legs. */
const FELT = 0.05;
const WATER = 8;

/**
 * The season: from the calendar's own season name when it says one, else by the month, the
 * Harptos way (Ches to Mirtul spring, Kythorn to Eleasis summer, Eleint to Uktar autumn).
 */
export function seasonOf(yearFrac, name = "") {
  const n = String(name).toLowerCase();
  if (/spring|vernal/.test(n)) return "spring";
  if (/summer|high/.test(n)) return "summer";
  if (/autumn|fall|harvest/.test(n)) return "autumn";
  if (/winter|frost/.test(n)) return "winter";
  const m = Math.floor((yearFrac ?? 0) * 12);
  return m >= 2 && m <= 4 ? "spring" : m >= 5 && m <= 7 ? "summer" : m >= 8 && m <= 10 ? "autumn" : "winter";
}

/**
 * Which side of a shoreline a sheet point lies on: "inside" or "outside" a closed one (its last
 * point is its first), else "left" or "right" of it as drawn (sheet y runs down the map).
 */
export function waterSideOf(pts, closed, p) {
  if (closed) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside ? "inside" : "outside";
  }
  let best = Infinity, cross = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
    const d = Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
    if (d < best) { best = d; cross = dx * (p[1] - a[1]) - dy * (p[0] - a[0]); }
  }
  // Sheet y runs down: a negative cross product is on the left of the line's direction.
  return cross < 0 ? "left" : "right";
}

/**
 * The terrain grid with the water the GM's shorelines mark. Each shoreline with a water side
 * (shores: [{ pts (sheet px), closed, water: "left" | "right" | "inside" | "outside" }]) is a wall;
 * the open ground either side of every wall is flooded, and each region takes the side its walls
 * mostly say: water, or land. Regions no marked shoreline touches keep the map's own terrain. A
 * shoreline must run off the map's edge, close into a loop, or meet another, or the water runs
 * round its end. Returns a new grid ({ data, width, height, cell }); the given one is unchanged.
 */
export function shoreWater(grid, shores) {
  const marked = (shores ?? []).filter((s) => s?.water && s.pts?.length > 1);
  if (!grid || !marked.length) return grid;
  const { width: W, height: H, cell } = grid, N = W * H;
  const wall = new Uint8Array(N), seedWater = [], seedLand = [], sides = marked.map(() => ({ water: [], land: [] }));
  const cellAt = (x, y) => { const cx = Math.floor(x / cell), cy = Math.floor(y / cell); return cx < 0 || cy < 0 || cx >= W || cy >= H ? -1 : cy * W + cx; };
  for (const [si, s] of marked.entries()) {
    const pts = s.closed && (s.pts[0][0] !== s.pts.at(-1)[0] || s.pts[0][1] !== s.pts.at(-1)[1]) ? [...s.pts, s.pts[0]] : s.pts;
    for (const p of resample(pts, cell / 2)) { const c = cellAt(p[0], p[1]); if (c >= 0) wall[c] = 1; }
    // Inside a loop is on its right when it runs clockwise on the map (sheet y down), else its left.
    let side = s.water;
    if (side === "inside" || side === "outside") {
      let area = 0;
      for (let i = 1; i < pts.length; i++) area += pts[i - 1][0] * pts[i][1] - pts[i][0] * pts[i - 1][1];
      const insideRight = area > 0;
      side = (side === "inside") === insideRight ? "right" : "left";
    }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (!len) continue;
      // The left of the line's direction, sheet y down.
      const lx = dy / len, ly = -dx / len, off = cell * 1.6, n = Math.max(1, Math.ceil(len / (cell * 2)));
      for (let k = 0; k <= n; k++) {
        const x = a[0] + (dx * k) / n, y = a[1] + (dy * k) / n;
        const left = cellAt(x + lx * off, y + ly * off), right = cellAt(x - lx * off, y - ly * off);
        (side === "left" ? seedWater : seedLand).push(left);
        (side === "left" ? seedLand : seedWater).push(right);
        sides[si].water.push(side === "left" ? left : right);
        sides[si].land.push(side === "left" ? right : left);
      }
    }
  }
  // The open regions between the walls (4-way, so a diagonal wall holds).
  const label = new Int32Array(N).fill(-1), queue = new Int32Array(N);
  let regions = 0;
  for (let i = 0; i < N; i++) {
    if (wall[i] || label[i] >= 0) continue;
    let head = 0, tail = 0; queue[tail++] = i; label[i] = regions;
    while (head < tail) {
      const c = queue[head++], x = c % W;
      if (x > 0 && !wall[c - 1] && label[c - 1] < 0) { label[c - 1] = regions; queue[tail++] = c - 1; }
      if (x < W - 1 && !wall[c + 1] && label[c + 1] < 0) { label[c + 1] = regions; queue[tail++] = c + 1; }
      if (c >= W && !wall[c - W] && label[c - W] < 0) { label[c - W] = regions; queue[tail++] = c - W; }
      if (c + W < N && !wall[c + W] && label[c + W] < 0) { label[c + W] = regions; queue[tail++] = c + W; }
    }
    regions++;
  }
  const votes = new Int32Array(regions);
  for (const c of seedWater) if (c >= 0 && !wall[c]) votes[label[c]]++;
  for (const c of seedLand) if (c >= 0 && !wall[c]) votes[label[c]]--;
  const data = new Uint8Array(grid.data);
  for (let i = 0; i < N; i++) {
    if (wall[i]) continue;
    const v = votes[label[i]];
    if (v > 0) data[i] = WATER;
    else if (v < 0 && data[i] === WATER) data[i] = 1;
  }
  // A shoreline whose water side and land side are one open region leaks: the water runs round an
  // open end (or through a gap) into the land it was meant to hold back. Its id (or index) is listed.
  const regionsOf = (cells) => new Set(cells.filter((c) => c >= 0 && !wall[c]).map((c) => label[c]));
  const leaks = marked.flatMap((s, si) => { const w = regionsOf(sides[si].water); return [...regionsOf(sides[si].land)].some((r) => w.has(r)) ? [s.id ?? si] : []; });
  return { ...grid, data, leaks };
}

/** Points every `step` px along a polyline, ends included. */
function resample(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
}

/**
 * The sea as a graph. grid: the terrain grid { data, width, height, cell (sheet px) };
 * waterways: [{ id, kind, name, pts: [[x, y]] (sheet px), current, factor, seasons }];
 * milesPerPixel. Built once per change of the waterways; planSea() asks it for a route.
 */
export function buildSea(grid, waterways, { milesPerPixel, coarse = 3, ports = [], portsOnly = false } = {}) {
  if (!grid) return null;
  const cs = grid.cell * coarse, W = Math.ceil(grid.width / coarse), H = Math.ceil(grid.height / coarse);
  const water = new Uint8Array(W * H);
  for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) {
    if (grid.data[y * grid.width + x] === WATER) water[Math.floor(y / coarse) * W + Math.floor(x / coarse)] = 1;
  }
  const cellOf = (p) => { const cx = Math.floor(p[0] / cs), cy = Math.floor(p[1] / cs); return cx < 0 || cy < 0 || cx >= W || cy >= H ? -1 : cy * W + cx; };
  // Shorelines wall the water off: every cell they pass through is land, except where a river
  // crosses (a shoreline drawn across an estuary must not shut the river's mouth), and except open
  // water: a shoreline walls only water within two cells of the map's land (channels, inlets, a
  // ragged coast), so a rough line straying out to sea never shuts it.
  const landNear = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (water[y * W + x]) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) landNear[ny * W + nx] = 1; }
  }
  const riverCells = new Set();
  const open = (p, r) => { const c = cellOf(p); if (c < 0) return; const x = c % W, y = (c / W) | 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) riverCells.add((y + dy) * W + x + dx); };
  for (const w of waterways) if (w.kind === "river" && w.pts.length > 1) {
    for (const p of resample(w.pts, cs / 3)) open(p, 2);
    // A river's ends open wider: its mouth may stop a little short of the sea.
    open(w.pts[0], 4); open(w.pts.at(-1), 4);
  }
  // A port's harbour (ports: [x, y] sheet px) is never walled off: a shoreline drawn past a port
  // up a river mouth or behind a sandbar must not shut its ships in.
  for (const p of ports) open(p, 4);
  for (const w of waterways) if (w.kind === "shore" && w.pts.length > 1) for (const p of resample(w.pts, cs / 3)) { const c = cellOf(p); if (c >= 0 && landNear[c] && !riverCells.has(c)) water[c] = 0; }
  // Lines: their own nodes after the grid's, each joined to the water cell it lies in.
  const nodes = [], lines = [];
  const N = W * H;
  for (const w of waterways) {
    // A river boats cannot use (navigable: false, a torrent like the Iceflow) is no way for them.
    // Winds and currents are not ways either: they reach the sea round them (below).
    if (w.kind === "shore" || w.kind === "wind" || w.pts.length < 2 || (w.kind === "river" && w.navigable === false)) continue;
    const pts = resample(w.pts, cs), first = N + nodes.length;
    for (const p of pts) nodes.push({ at: p, line: lines.length });
    lines.push({ ...w, first, count: pts.length });
  }
  const links = new Map(); // node -> [{ to, miles, kind, line, dir }]
  const link = (a, b, edge) => { if (!links.has(a)) links.set(a, []); links.get(a).push({ to: b, ...edge }); };
  const centre = (c) => [((c % W) + 0.5) * cs, (Math.floor(c / W) + 0.5) * cs];
  const nearWater = (p, reach) => {
    const out = [], cx = Math.floor(p[0] / cs), cy = Math.floor(p[1] / cs);
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H || !water[y * W + x]) continue;
      const c = y * W + x, q = centre(c);
      out.push({ c, px: Math.hypot(q[0] - p[0], q[1] - p[1]) });
    }
    return out;
  };
  // Local-map setup needs only port availability, not path links, offshore distances or wind fields.
  if (portsOnly) return {W,H,cs,water,nodes,lines,nearWater,milesPerPixel};
  // How far each water cell lies from land (cells, 8-way), for keeping ships near the coast.
  const offshore = new Uint16Array(W * H).fill(65535), queue = [];
  for (let i = 0; i < W * H; i++) if (!water[i]) { offshore[i] = 0; queue.push(i); }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % W, y = (i / W) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const k = ny * W + nx;
      if (offshore[k] > offshore[i] + 1) { offshore[k] = offshore[i] + 1; queue.push(k); }
    }
  }
  lines.forEach((l, li) => {
    for (let k = 0; k < l.count; k++) {
      const id = l.first + k, at = nodes[id - N].at;
      if (k + 1 < l.count) {
        const miles = Math.hypot(nodes[id + 1 - N].at[0] - at[0], nodes[id + 1 - N].at[1] - at[1]) * milesPerPixel;
        link(id, id + 1, { miles, kind: l.kind, line: li, dir: 1 });
        link(id + 1, id, { miles, kind: l.kind, line: li, dir: -1 });
      }
      // A river reaches the sea (and other water) at its ends and wherever it runs through water.
      const ends = k === 0 || k === l.count - 1;
      for (const w of nearWater(at, ends ? 4 : 0)) {
        const miles = w.px * milesPerPixel;
        link(id, w.c, { miles, kind: "sea" });
        link(w.c, id, { miles, kind: "sea" });
      }
    }
  });
  // Rivers that meet: a node within a cell of another line's node joins it.
  const byCell = new Map();
  nodes.forEach((n, i) => { const c = cellOf(n.at); if (!byCell.has(c)) byCell.set(c, []); byCell.get(c).push(N + i); });
  for (const ids of byCell.values()) for (const a of ids) for (const b of ids) {
    if (a === b || nodes[a - N].line === nodes[b - N].line) continue;
    link(a, b, { miles: Math.hypot(nodes[a - N].at[0] - nodes[b - N].at[0], nodes[a - N].at[1] - nodes[b - N].at[1]) * milesPerPixel, kind: "sea" });
  }
  // Each wind's reach: the water cells within WIND_BAND_MI of its line, with their distance to it
  // and the wind's way at the nearest point. (Seeds every few cells along the line; the distance
  // is good to a cell or two, which at 250 miles is nothing.)
  const band = Math.ceil(WIND_BAND_MI / (cs * milesPerPixel)), reachOf = [];
  for (const wl of waterways) {
    if (wl.kind !== "wind" || wl.pts.length < 2) continue;
    const cells = new Map(), pts = resample(wl.pts, cs), step = 3;
    for (let i = 0; i < pts.length; i += step) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const dx = (b[0] - a[0]) / len, dy = (b[1] - a[1]) / len, cx = Math.floor(pts[i][0] / cs), cy = Math.floor(pts[i][1] / cs);
      for (let y = Math.max(0, cy - band); y <= Math.min(H - 1, cy + band); y++) for (let x = Math.max(0, cx - band); x <= Math.min(W - 1, cx + band); x++) {
        const c = y * W + x;
        if (!water[c]) continue;
        const d = Math.hypot(x - cx, y - cy);
        if (d > band) continue;
        const was = cells.get(c);
        if (!was || d < was[0]) cells.set(c, [d, dx, dy]);
      }
    }
    reachOf.push({ wind: wl, cells });
  }
  return { W, H, cs, water, offshore, nodes, lines, links, N, milesPerPixel, cellOf, centre, nearWater, reachOf, winds: new Map() };
}

/**
 * The winds blowing in a season, per water cell: the nearest blowing wind (its index in
 * sea.reachOf; -1: none) and its way there. Worked out once per season.
 */
function windsIn(sea, season) {
  if (sea.winds.has(season)) return sea.winds.get(season);
  const n = sea.W * sea.H, line = new Int16Array(n).fill(-1), dist = new Float32Array(n).fill(Infinity), wx = new Float32Array(n), wy = new Float32Array(n);
  sea.reachOf.forEach(({ wind: l, cells }, li) => {
    if (l.seasons && !l.seasons.includes(season)) return;
    for (const [c, [d, dx, dy]] of cells) if (d < dist[c]) { dist[c] = d; line[c] = li; wx[c] = dx; wy[c] = dy; }
  });
  const out = { line, wx, wy };
  sea.winds.set(season, out);
  return out;
}

/** Whether a straight run between two sheet points stays on water, no farther from land than `off` cells. */
function clear(sea, a, b, off = Infinity) {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (sea.cs / 2)));
  for (let i = 0; i <= n; i++) { const c = sea.cellOf([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]); if (c < 0 || !sea.water[c] || sea.offshore[c] > off) return false; }
  return true;
}

/**
 * The fastest way by water from sheet point `from` to `to` (each a port, or any point by the
 * water). vessel: { mph }; season: the current season, for trade winds and currents. reach: how far from each
 * end the water may start, in px. Returns { legs: [{ kind: "sea" | "river" | "wind" | "lane",
 * name, pts, miles, mph }], miles, hours } or null when no water joins the two.
 */
export function planSea(sea, from, to, { mph = 2, season = "summer", reach = 40, debug = false } = {}) {
  if (!sea) return null;
  const { W, H, cs, water, offshore, nodes, lines, links, N, milesPerPixel: mpp } = sea;
  // Ships keep to the coast where no wind or current carries them: open water within about 14
  // miles of land costs nothing extra, and farther out counts up to a quarter longer when the way
  // is chosen, so a crossing takes the shortest course to the next coast. (Only the choice: the
  // voyage's time is the real distance at the real speed.)
  const near = Math.round(14 / (cs * mpp));
  const offshoreCost = (k) => 1 + 0.25 * Math.min(1, Math.max(0, (offshore[k] - near) / near));
  const r = Math.max(1, Math.ceil(reach / cs));
  const blowing = (l) => !l.seasons || l.seasons.includes(season);
  const wind = windsIn(sea, season);
  // A move across open water (cell k to k2, dx dy) in the nearest blowing wind: its speed scaled
  // by how squarely it sails with the wind or into it. { mult, line, dir }, or null where none is felt.
  const windOn = (k2, dx, dy) => {
    const li = wind.line[k2];
    if (li < 0) return null;
    const a = (dx * wind.wx[k2] + dy * wind.wy[k2]) / Math.hypot(dx, dy);
    const mult = a >= 0 ? 1 + ((sea.reachOf[li].wind.factor ?? TRADE_WIND) - 1) * a : 1 + (1 - AGAINST_WIND) * a;
    return Math.abs(mult - 1) <= FELT ? null : { mult, windOf: li, dir: a >= 0 ? 1 : -1 };
  };
  // Speed of an edge: open water (with the wind there, if any), or a line in its direction (dir 1) or against it.
  const speed = (e) => {
    if (e.kind === "sea") return mph;
    if (e.mult) return mph * e.mult;
    const l = lines[e.line];
    if (e.kind === "wind") return !blowing(l) ? mph : e.dir > 0 ? mph * (l.factor ?? TRADE_WIND) : mph * AGAINST_WIND;
    if (e.kind === "river") { const c = l.current ?? RIVER_CURRENT; return e.dir > 0 ? mph + c : Math.max(0.5, mph - c); }
    return mph / 0.97; // a sea route: the way ships know, a little better than open water
  };
  let top = 1;
  for (const l of lines) top = Math.max(top, l.kind === "river" ? (mph + (l.current ?? RIVER_CURRENT)) / mph : 1);
  for (const { wind: l } of sea.reachOf) top = Math.max(top, l.factor ?? TRADE_WIND);
  const vmax = mph * top;
  // The ends: water cells and line nodes close by.
  const START = N + nodes.length, GOAL = START + 1;
  const goalLinks = new Map();
  const ends = (p) => {
    const out = sea.nearWater(p, r).map((w) => ({ id: w.c, miles: w.px * mpp }));
    nodes.forEach((n, i) => { const d = Math.hypot(n.at[0] - p[0], n.at[1] - p[1]); if (d <= reach) out.push({ id: N + i, miles: d * mpp }); });
    return out;
  };
  const starts = ends(from);
  for (const e of ends(to)) goalLinks.set(e.id, Math.min(goalLinks.get(e.id) ?? Infinity, e.miles));
  if (!starts.length || !goalLinks.size) return null;
  const at = (id) => (id < N ? sea.centre(id) : id < START ? nodes[id - N].at : id === START ? from : to);
  const h = (id) => { const p = at(id); return Math.hypot(p[0] - to[0], p[1] - to[1]) * mpp / vmax; };
  const g = new Map(), prev = new Map(), heap = [];
  const push = (k, f) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const t = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const a = 2 * i + 1, b = a + 1; let m = i; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return t; };
  const relax = (from, to, cost, edge) => { const d = g.get(from) + cost; if (d < (g.get(to) ?? Infinity)) { g.set(to, d); prev.set(to, { from, edge }); push(to, d + (to === GOAL ? 0 : h(to))); } };
  g.set(START, 0);
  for (const s of starts) relax(START, s.id, s.miles / mph, { kind: "sea" });
  const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let guard = 0; heap.length && guard < 4e6; guard++) {
    const [f, k] = pop();
    if (k === GOAL) break;
    if (f - (k === GOAL ? 0 : h(k)) > (g.get(k) ?? Infinity) + 1e-9) continue;
    const gl = goalLinks.get(k);
    if (gl !== undefined) relax(k, GOAL, gl / mph, { kind: "sea" });
    if (k < N) {
      const x = k % W, y = Math.floor(k / W);
      for (const [dx, dy] of D8) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || !water[ny * W + nx]) continue;
        // No cutting a corner of land.
        if (dx && dy && (!water[y * W + nx] || !water[ny * W + x])) continue;
        // A wind carries a ship out to sea: no keeping to the coast while it is behind her.
        const k2 = ny * W + nx, w = windOn(k2, dx, dy), miles = (dx && dy ? Math.SQRT2 : 1) * cs * mpp;
        relax(k, k2, w ? miles / (mph * w.mult) * (w.mult > 1 ? 1 : offshoreCost(k2)) : miles / mph * offshoreCost(k2), w ? { kind: "wind", ...w } : { kind: "sea" });
      }
    }
    for (const e of links.get(k) ?? []) relax(k, e.to, e.miles / speed(e), e);
  }
  if (!prev.has(GOAL)) return null;
  // Back from the goal: each step, its kind and line.
  const steps = [];
  for (let k = GOAL; prev.has(k); k = prev.get(k).from) steps.unshift({ a: prev.get(k).from, b: k, e: prev.get(k).edge });
  const legs = [];
  // Each leg keeps the time its steps took (in a wind the speed changes step by step).
  for (const s of steps) {
    const l = s.e.windOf != null ? sea.reachOf[s.e.windOf].wind : s.e.line != null ? lines[s.e.line] : null;
    let kind = s.e.kind === "sea" ? "sea" : s.e.kind;
    if (kind === "wind" && !blowing(l)) kind = "sea";
    const name = kind === "sea" ? null : l?.name ?? null, v = speed(s.e), against = kind === "wind" && v < mph;
    const a = at(s.a), b = at(s.b), miles = Math.hypot(b[0] - a[0], b[1] - a[1]) * mpp;
    const last = legs.at(-1);
    const joins = last && last.kind === kind && last.name === name && last.waterway === l?.id && (kind === "wind" ? !!last.against === against : Math.abs(last.mph - v) < 1e-6);
    if (joins) { last.pts.push(b); last.stepMiles += miles; last.stepHours += miles / v; }
    else legs.push({ kind, name, waterway: l?.id, mph: v, pts: [a, b], stepMiles: miles, stepHours: miles / v, ...(against ? { against: true } : {}) });
  }
  // Open water as straight runs where the way is clear, not cell by cell.
  // A short cut may go no farther from land than the way it replaces (ships keep to the coast).
  for (const leg of legs) {
    if ((leg.kind !== "sea" && leg.kind !== "wind") || leg.pts.length < 3) continue;
    const out = [leg.pts[0]];
    const offAt = leg.pts.map((p) => { const c = sea.cellOf(p); return c < 0 ? 0 : sea.offshore[c]; });
    let i = 0;
    while (i < leg.pts.length - 1) {
      let j = Math.min(leg.pts.length - 1, i + 1);
      for (let k = leg.pts.length - 1; k > i + 1; k--) {
        let off = 0; for (let m = i; m <= k; m++) off = Math.max(off, offAt[m]);
        if (clear(sea, leg.pts[i], leg.pts[k], Math.max(off, 2))) { j = k; break; }
      }
      out.push(leg.pts[j]);
      i = j;
    }
    leg.pts = out;
  }
  // A straightened leg is a little shorter than its steps: its time shrinks in proportion, at the
  // speed its steps averaged.
  let miles = 0, hours = 0;
  for (const leg of legs) {
    let px = 0;
    for (let i = 1; i < leg.pts.length; i++) px += Math.hypot(leg.pts[i][0] - leg.pts[i - 1][0], leg.pts[i][1] - leg.pts[i - 1][1]);
    leg.miles = px * mpp;
    leg.hours = leg.stepMiles > 0 ? leg.stepHours * (leg.miles / leg.stepMiles) : leg.miles / leg.mph;
    if (leg.hours > 0) leg.mph = Math.round((leg.miles / leg.hours) * 100) / 100;
    delete leg.stepMiles; delete leg.stepHours;
    miles += leg.miles;
    hours += leg.hours;
  }
  return { legs: legs.filter((l) => l.miles > 0.01), miles, hours, ...(debug ? { steps } : {}) };
}

/**
 * The edge of the water the route finder uses (the map's sea less the shorelines' walls), as line
 * segments in sheet px: each run of cell edges between water and land along a row or column is
 * one segment. For showing the GM what boats can reach.
 */
export function coastSegments(sea) {
  if (!sea) return [];
  const { W, H, cs, water } = sea, out = [];
  // Past the map's edge counts as whatever lies at the edge, so the border itself is no coast.
  const wet = (x, y) => water[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))] === 1;
  // Horizontal edges: between row y-1 and row y.
  for (let y = 0; y <= H; y++) {
    let run = null;
    for (let x = 0; x <= W; x++) {
      const edge = x < W && wet(x, y - 1) !== wet(x, y);
      if (edge && run == null) run = x;
      if (!edge && run != null) { out.push([[run * cs, y * cs], [x * cs, y * cs]]); run = null; }
    }
  }
  // Vertical edges: between column x-1 and column x.
  for (let x = 0; x <= W; x++) {
    let run = null;
    for (let y = 0; y <= H; y++) {
      const edge = y < H && wet(x - 1, y) !== wet(x, y);
      if (edge && run == null) run = y;
      if (!edge && run != null) { out.push([[x * cs, run * cs], [x * cs, y * cs]]); run = null; }
    }
  }
  return out;
}

/** Whether a sheet point lies within `px` of the map's water (a coastal or river place). */
export function nearSea(sea, p, px = 12) {
  if (!sea) return false;
  return sea.nearWater(p, Math.max(1, Math.ceil(px / sea.cs))).length > 0;
}

/** Shared settlement port rule, used by travel and by local-map entrance setup. */
export function automaticPort(place, sea, toSheet, milesPerPixel) {
  if (!place || place.kind !== 'settlement' || !sea) return false;
  const at = toSheet(place.lon, place.lat);
  return nearSea(sea, at, 6 / milesPerPixel) || sea.nodes.some(n => sea.lines[n.line].kind === 'river' && Math.hypot(n.at[0]-at[0], n.at[1]-at[1])*milesPerPixel < 3);
}

/** Settlement harbours that shoreline editing must leave open, as in the route planner. */
export function terrainHarbours(grid, places, toSheet, milesPerPixel) {
  if (!grid) return [];
  const r=Math.ceil(6/milesPerPixel/grid.cell);
  return places.filter(p=>!p.hidden && p.port!==false && (p.port || p.kind==='settlement')).map(p=>toSheet(p.lon,p.lat)).filter(at=>{
    const cx=Math.floor(at[0]/grid.cell),cy=Math.floor(at[1]/grid.cell);
    for(let y=cy-r;y<=cy+r;y++)for(let x=cx-r;x<=cx+r;x++)if(x>=0&&y>=0&&x<grid.width&&y<grid.height&&grid.data[y*grid.width+x]===WATER)return true;
    return false;
  });
}
