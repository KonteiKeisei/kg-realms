import { simplifyLine } from "./routes.mjs";
const area = ring => ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - p[1] * q[0]; }, 0) / 2;

/** Flood only the selected map terrain, then trace its grid edges. Run in the editor worker. */
export function traceBiome(grid, at, code, { maxCells = 500000, search = 6, tolerance = .8 } = {}) {
  const { data, width, height, cell } = grid ?? {};
  if (!data || data.length !== width * height || !(cell > 0) || code === 8) throw Error("No land biome grid is available for tracing.");
  const cx = Math.floor(at[0] / cell), cy = Math.floor(at[1] / cell);
  if (cx < 0 || cy < 0 || cx >= width || cy >= height) throw Error("Click inside the map.");
  let seed = -1, distance = Infinity;
  for (let y = Math.max(0, cy - search); y <= Math.min(height - 1, cy + search); y++) for (let x = Math.max(0, cx - search); x <= Math.min(width - 1, cx + search); x++) {
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (data[y * width + x] === code && d < distance) { seed = y * width + x; distance = d; }
  }
  if (seed < 0) throw Error("No matching terrain near this point. Choose its biome type and click farther inside the area.");
  const seen = new Uint8Array(width * height), queue = new Uint32Array(Math.min(maxCells + 1, data.length));
  let head = 0, count = 1; queue[0] = seed; seen[seed] = 1;
  const add = i => { if (!seen[i] && data[i] === code) { if (count >= maxCells) throw Error("This connected area is too large to trace. Draw a smaller zone manually."); seen[i] = 1; queue[count++] = i; } };
  while (head < count) {
    const i = queue[head++], x = i % width, y = Math.floor(i / width);
    if (x) add(i - 1); if (x + 1 < width) add(i + 1); if (y) add(i - width); if (y + 1 < height) add(i + width);
  }
  const edges = new Map(), stride = width + 1;
  const edge = (x, y, ex, ey, dir) => { const start = y * stride + x, e = { end: ey * stride + ex, dir }; if (!edges.has(start)) edges.set(start, []); edges.get(start).push(e); };
  for (let n = 0; n < count; n++) {
    const i = queue[n], x = i % width, y = Math.floor(i / width);
    if (!y || !seen[i - width]) edge(x, y, x + 1, y, 0);
    if (x + 1 === width || !seen[i + 1]) edge(x + 1, y, x + 1, y + 1, 1);
    if (y + 1 === height || !seen[i + width]) edge(x + 1, y + 1, x, y + 1, 2);
    if (!x || !seen[i - 1]) edge(x, y + 1, x, y, 3);
  }
  const rings = [];
  while (edges.size) {
    const start = edges.keys().next().value, ring = []; let cursor = start, previous = -1;
    do {
      ring.push([cursor % stride, Math.floor(cursor / stride)]);
      const choices = edges.get(cursor); if (!choices?.length) throw Error("The map boundary could not be closed. Draw this zone manually.");
      const priorities = [(previous + 1) % 4, previous, (previous + 3) % 4, (previous + 2) % 4];
      const rank = dir => previous < 0 ? dir : priorities.indexOf(dir);
      choices.sort((a, b) => rank(a.dir) - rank(b.dir));
      const next = choices.shift(); if (!choices.length) edges.delete(cursor);
      cursor = next.end; previous = next.dir;
    } while (cursor !== start);
    if (ring.length >= 3) rings.push(ring);
  }
  rings.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
  const simplify = ring => {
    const closed = simplifyLine([...ring, ring[0]], (x, y) => [x, y], tolerance).slice(0, -1);
    return (closed.length >= 3 ? closed : ring).map(([x, y]) => [x * cell, y * cell]);
  };
  const pts = simplify(rings[0]), holes = rings.slice(1).filter(r => Math.abs(area(r)) >= 4).map(simplify);
  if (pts.length + holes.reduce((sum, r) => sum + r.length, 0) > 10000) throw Error("This outline is too detailed. Draw a simpler zone manually.");
  return { pts, holes, cells: count, code };
}
