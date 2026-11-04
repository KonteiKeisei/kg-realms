// Seasonal snow on the realm map. Snow lines move with the calendar: full cover near a pole, bare
// ground further out, a ragged band of patchy snow between. Each world sets its own (0.75): snow
// at the north, the south or both, how far it reaches in winter and summer. A MapLibre layer
// drawn right after the painted map whitens it per pixel, by biome (terrain.png), keeping the map's
// ink; the roads, route, labels and markers are drawn after it, untouched. Mountains and hills
// hold snow further south.

/**
 * The snow line through the year, at the middle of each Harptos month (0 Hammer ... 11 Nightal):
 * [full, bare], sheet y (px, south is larger). Full cover north of `full`, bare ground south of
 * `bare`. Landmarks: Bryn Shander 400, Luskan 777, Neverwinter 1189, Waterdeep 2189,
 * Daggerford 2410, Baldur's Gate 3834.
 */
export const SNOW_LINE = [
  [2189, 3834], // Hammer: Waterdeep under snow, patchy to Baldur's Gate and Cormyr
  [900, 2410],  // Alturiak: full to the Neverwinter Wood, patchy to Daggerford
  [777, 2189],  // Ches: full to Luskan, patchy to Waterdeep
  [400, 1189],  // Tarsakh: full in Icewind Dale, patchy to Neverwinter
  [230, 650],   // Mirtul: full on the Reghed Glacier, patchy to the Spine
  [100, 400],   // Kythorn: the far north only
  [0, 300],     // Flamerule
  [50, 380],    // Eleasis
  [400, 777],   // Eleint: Icewind Dale under snow, patchy to Luskan
  [777, 1300],  // Marpenoth: full to Luskan, patchy past Neverwinter
  [1189, 2189], // Uktar: full to Neverwinter, patchy to Waterdeep
  [1900, 2900]  // Nightal: full nearly to Waterdeep, patchy past Daggerford
];

/** How much further south (sheet px) snow lies on high ground: mountains about 200 miles, hills 60. */
export const HIGH_GROUND = { 4: 700, 3: 200 };

/** The snow line at a point in the year (0 to 1, from the start of Hammer): { full, bare }. */
export function snowLineAt(yearFrac, line = SNOW_LINE) {
  const n = line.length, m = (((yearFrac * n - 0.5) % n) + n) % n;
  const i = Math.floor(m), t = m - i, a = line[i], b = line[(i + 1) % n];
  const s = t * t * (3 - 2 * t);
  return { full: a[0] + (b[0] - a[0]) * s, bare: a[1] + (b[1] - a[1]) * s };
}

/**
 * A world's snow (0.75), saved for each world: a pole's snow reaches `winter` of the way across the
 * map from its edge at the depth of winter and draws back to `summer` at the height of summer
 * (fractions of the map's height), with a patchy edge `band` miles wide. `midwinter`: the month
 * (0 = the calendar's first) the north's snow reaches furthest; the south's is half a year later
 * when `reversed`, as on Earth. High ground holds snow `mountains` and `hills` miles further out.
 * A world module may ship a pole's line month by month instead (`months`: [full, bare] sheet px,
 * as SNOW_LINE): Toril does.
 */
export const SNOW_DEFAULTS = Object.freeze({
  north: Object.freeze({ on: true, winter: 0.4, summer: 0.04, band: 250 }),
  south: Object.freeze({ on: false, winter: 0.4, summer: 0.04, band: 250 }),
  reversed: true, midwinter: 0, mountains: 200, hills: 60
});
/** Toril's snow before world modules shipped their own (KG Realms: Faerûn 1.0.1 and earlier). */
export const TORIL_SNOW = Object.freeze({ north: { on: true, months: SNOW_LINE }, south: { on: false }, mountains: 206, hills: 59 });

/** A world's snow: its saved settings over what its module ships, over the defaults. */
export function snowConfig(saved, shipped) {
  const base = shipped ?? {}, own = saved ?? {};
  const pole = (k) => {
    const p = { ...SNOW_DEFAULTS[k], ...(base[k] ?? {}), ...(own[k] ?? {}) };
    // Settings of its own replace a shipped month-by-month line.
    if (own[k] && ["winter", "summer", "band"].some((f) => f in own[k]) && !own[k].months) delete p.months;
    return p;
  };
  return { ...SNOW_DEFAULTS, ...base, ...own, north: pole("north"), south: pole("south") };
}

/** A month-by-month line as simple settings (to start editing Toril's): its reach in winter and summer, its band. */
export function simpleFromMonths(months, height, milesPerPixel) {
  const bares = months.map((m) => m[1]), most = Math.max(...bares);
  return {
    winter: +(most / height).toFixed(3), summer: +(Math.min(...bares) / height).toFixed(3),
    band: Math.round((months.reduce((n, m) => n + (m[1] - m[0]), 0) / months.length) * milesPerPixel),
    midwinter: bares.indexOf(most)
  };
}

/**
 * The snow lines at a point in the year: north and south { full, bare } in sheet px (null where a
 * pole has no snow), and how much further out high ground holds it (sheet px).
 */
export function snowLines(yearFrac, cfg, { height, milesPerPixel, months = 12 }) {
  const mpp = milesPerPixel || 1, n = Math.max(1, months);
  const winterness = (shift) => (1 + Math.cos(2 * Math.PI * (yearFrac - ((cfg.midwinter ?? 0) + 0.5) / n - shift))) / 2;
  const reach = (p, shift) => {
    const w = winterness(shift), r = Math.max(0, (p.summer ?? 0) + ((p.winter ?? 0) - (p.summer ?? 0)) * w);
    return { bare: r * height, band: Math.max(1, (p.band ?? 0) / mpp) };
  };
  let north = null, south = null;
  if (cfg.north?.on) {
    if (Array.isArray(cfg.north.months)) north = snowLineAt(yearFrac, cfg.north.months);
    else { const r = reach(cfg.north, 0); north = { full: r.bare - r.band, bare: r.bare }; }
  }
  if (cfg.south?.on) {
    const shift = cfg.reversed === false ? 0 : 0.5;
    if (Array.isArray(cfg.south.months)) { const l = snowLineAt(yearFrac - shift, cfg.south.months); south = { full: height - l.full, bare: height - l.bare }; }
    else { const r = reach(cfg.south, shift); south = { full: height - r.bare + r.band, bare: height - r.bare }; }
  }
  return { north, south, mountain: (cfg.mountains ?? 0) / mpp, hill: (cfg.hills ?? 0) / mpp };
}

/** Point in the year from the world clock: month and day of month, as Calendaria keeps them. */
export function yearFraction(components, calendar) {
  if (!components) return 0;
  const months = calendar?.monthsArray ?? (Array.isArray(calendar?.months?.values) ? calendar.months.values : Object.values(calendar?.months?.values ?? {}));
  const n = months.length || 12, month = components.month ?? 0;
  const days = months[month]?.days || 30;
  return Math.max(0, Math.min(0.9999, (month + ((components.dayOfMonth ?? 0) + 0.5) / days) / n));
}

const FRAG = `
precision highp float;
uniform sampler2D uSampler; // the map as drawn so far (the painted map only)
uniform sampler2D uTerrain;
uniform vec2 uSize;        // drawing buffer, px
uniform float uPr;          // device px per CSS px
uniform mat3 uToSheet;
uniform vec2 uTerrainSize;
uniform float uCell;
uniform vec2 uNorth;       // full, bare (sheet y); snow towards smaller y
uniform vec2 uSouth;       // full, bare (sheet y); snow towards larger y
uniform vec2 uPoles;       // north on, south on
uniform float uFoot;
uniform float uGain;
uniform float uMountain;
uniform float uHill;
uniform float uDebug;

const vec3 SNOW = vec3(0.95, 0.97, 1.0);
const vec3 SHADOW = vec3(0.62, 0.70, 0.84);

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Noise of a given period (sheet px), faded to its mean where it would be finer than the screen shows.
float octave(vec2 s, float period) {
  float w = clamp((period / max(uFoot, 1e-4) - 1.5) / 2.0, 0.0, 1.0);
  return mix(0.5, vnoise(s / period), w);
}
vec3 colAt(vec2 off) {
  // off: CSS px, screen-down; the buffer runs bottom-up.
  vec4 c = texture2D(uSampler, (gl_FragCoord.xy + vec2(off.x, -off.y) * uPr) / uSize);
  return clamp(c.rgb / max(c.a, 1e-4) * uGain, 0.0, 1.0);
}
float inkOf(vec3 c) { return clamp((0.34 - dot(c, vec3(0.299, 0.587, 0.114))) / 0.2, 0.0, 1.0); }

void main() {
  vec4 src = texture2D(uSampler, gl_FragCoord.xy / uSize);
  gl_FragColor = src;
  if (src.a < 0.01) return;
  vec2 g = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y) / uPr; // CSS px, top-left
  vec2 s = (uToSheet * vec3(g, 1.0)).xy;
  vec2 tuv = s / (uCell * uTerrainSize);
  if (tuv.x < 0.0 || tuv.y < 0.0 || tuv.x > 1.0 || tuv.y > 1.0) return;
  float code = floor(texture2D(uTerrain, tuv).r * 255.0 + 0.5);
  if (uDebug > 0.5) { gl_FragColor = vec4(mix(src.rgb, vec3(fract(code * 0.37), fract(code * 0.61), fract(code * 0.83)), 0.6), 1.0); return; }
  if (code < 0.5 || code > 6.5 && code < 8.5) return; // no snow on water or glacier
  float high = code == 4.0 ? uMountain : code == 3.0 ? uHill : 0.0;
  // Each pole's snow runs out from its edge of the map; high ground holds it further out.
  float tn = uPoles.x * clamp((uNorth.y - (s.y - high)) / max(uNorth.y - uNorth.x, 1.0), 0.0, 1.0);
  float ts = uPoles.y * clamp(((s.y + high) - uSouth.y) / max(uSouth.x - uSouth.y, 1.0), 0.0, 1.0);
  float t = max(tn, ts);
  float am = t * t * (3.0 - 2.0 * t);
  if (am <= 0.001) return;
  vec3 a = clamp(src.rgb / src.a * uGain, 0.0, 1.0);
  float lum = dot(a, vec3(0.299, 0.587, 0.114));
  float ink = inkOf(a);
  // Drifts: snow piles against strokes, shadowed on their lee (south-east) side.
  float lee = 0.0;
  lee += inkOf(colAt(vec2(3.0, 3.0)));
  lee += inkOf(colAt(vec2(1.5, 3.0)));
  lee += inkOf(colAt(vec2(3.0, 1.5)));
  lee += inkOf(colAt(vec2(4.5, 3.0)));
  lee += inkOf(colAt(vec2(3.0, 4.5)));
  lee /= 5.0;
  float drift = clamp(lee * 1.6 - ink, 0.0, 1.0);
  // The snow line breaks up: snow holds in broad hollows and goes from open ground first.
  float field = octave(s, 26.0) * 0.55 + octave(s, 8.0) * 0.3 + octave(s, 2.6) * 0.15;
  field = clamp(0.5 + (field - 0.5) * 1.8, 0.0, 1.0);
  float cover = clamp((am - 0.05 + (field - 0.5) * 0.9) / 0.85, 0.0, 1.0);
  cover = clamp(cover + drift * clamp(am * 2.2, 0.0, 1.0) * 0.55, 0.0, 0.93);
  if (code == 6.0) {
    // Desert: wind strips the snow off the sand in streaks.
    float st = vnoise(vec2(s.x / 40.0, s.y / 3.0));
    cover *= 1.0 - clamp(am * 1.5 - 0.5, 0.0, 1.0) * (1.0 - clamp(0.55 + (st - 0.5) * 2.4, 0.35, 1.0));
  }
  cover *= 1.0 - ink;
  float shade = clamp(drift * 0.9 + (0.75 - lum) * 0.5, 0.0, 1.0);
  vec3 col = mix(SNOW, SHADOW, shade);
  if (code == 5.0) col = col * 0.75 + vec3(0.70, 0.86, 0.90) * 0.25; // swamp: frozen
  float through = code == 4.0 ? 0.18 : code == 9.0 ? 0.12 : (code == 2.0 || code == 5.0) ? 0.0 : 0.10;
  col = mix(col, a, through);
  vec3 outc = mix(a, col, cover);
  if (code == 2.0) {
    // Forest: crowns go dark evergreen, snow caps them and fills the gaps.
    float crown = (ink + inkOf(colAt(vec2(1.0, 0.0))) + inkOf(colAt(vec2(-1.0, 0.0))) + inkOf(colAt(vec2(0.0, 1.0))) + inkOf(colAt(vec2(0.0, -1.0)))) / 5.0;
    float below = (inkOf(colAt(vec2(0.0, 2.0))) + inkOf(colAt(vec2(1.0, 2.0))) + inkOf(colAt(vec2(-1.0, 2.0)))) / 3.0;
    float cap = clamp(below - crown, 0.0, 1.0) * am;
    float tree = clamp(crown * 1.6, 0.0, 1.0) * clamp(am * 1.5, 0.0, 1.0);
    outc = mix(outc, vec3(0.18, 0.32, 0.30), tree * (0.75 - 0.1 * am));
    outc = mix(outc, SNOW, cap);
    if (ink > 0.5) outc = a * (1.0 - 0.1 * am);
  }
  outc = mix(outc, vec3(0.86, 0.92, 1.0), 0.10 * am);
  gl_FragColor = vec4(outc / uGain * src.a, src.a);
}`;

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const LAYER_ID = "kgr-seasonal-snow";

/** A MapLibre custom layer: copies what is drawn so far (the painted map) and draws it back with snow. */
export class SnowCover {
  constructor() {
    this.map = null;
    this.lines = { north: null, south: null, mountain: 0, hill: 0 };
    this.config = SNOW_DEFAULTS;
    this.onStyle = () => this.#ensure();
  }

  /**
   * Put snow on a realm layer's map. grid: the terrain grid ({ data (one code per cell), width,
   * height, cell (sheet px) }); config: the world's snow (snowConfig); sheet: { height,
   * milesPerPixel }; toSheet(lon, lat): sheet px; gain(): brightness to undo before judging
   * colours (the map's own night dimming).
   */
  async attach(layer, { grid, config, sheet, toSheet, gain = () => 1 }) {
    this.detach();
    const map = layer?.map;
    if (!map || !grid) return;
    Object.assign(this, { map, grid, cell: grid.cell, toSheet, gain, sheet, config: config ?? SNOW_DEFAULTS, gridDirty: true });
    this.setDate();
    const self = this;
    this.layer = {
      id: LAYER_ID, type: "custom", renderingMode: "2d",
      onAdd(m, gl) { self.#setup(gl); },
      onRemove(m, gl) { self.#teardown(gl); },
      render(gl) { self.#render(gl); }
    };
    map.on("styledata", this.onStyle);
    this.#ensure();
  }

  /** The layer sits right above the painted map: before the first layer that is not raster. */
  #ensure() {
    const map = this.map;
    if (!map || !this.layer || map.getLayer(LAYER_ID)) return;
    const layers = map.getStyle?.()?.layers ?? [];
    if (!layers.length) return;
    const before = layers.find((l) => l.type !== "raster" && l.type !== "background" && l.id !== 'kgr-terrain' && l.id !== LAYER_ID)?.id;
    try { map.addLayer(this.layer, before); } catch { /* style still loading: styledata comes again */ }
  }

  /** Move the snow lines to the world's current date (or the Snow tab's preview month). */
  setDate() {
    const cal = game.time.calendar, months = cal?.monthsArray?.length ?? (Array.isArray(cal?.months?.values) ? cal.months.values.length : Object.keys(cal?.months?.values ?? {}).length) ?? 12;
    const frac = this.previewFrac ?? yearFraction(game.time.components, cal);
    if (this.sheet) this.lines = snowLines(frac, this.config, { height: this.sheet.height, milesPerPixel: this.sheet.milesPerPixel, months: months || 12 });
    this.map?.triggerRepaint();
  }

  /** The world's snow settings changed. */
  setConfig(config) { this.config = config ?? SNOW_DEFAULTS; this.setDate(); }

  /** The terrain changed (a shoreline's water side): the new grid is sent to the map's GPU at the next frame. */
  setGrid(grid) { if (!grid || grid === this.grid) return; this.grid = grid; this.cell = grid.cell; this.gridDirty = true; this.map?.triggerRepaint(); }

  /** Show the snow at a point in the year (0 to 1) while the Snow tab is open; null: the world's date. */
  preview(frac) { this.previewFrac = frac ?? undefined; this.setDate(); }

  #setup(gl) {
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.program = p;
    this.loc = {};
    for (const n of ["uSampler", "uTerrain", "uSize", "uPr", "uToSheet", "uTerrainSize", "uCell", "uNorth", "uSouth", "uPoles", "uFoot", "uGain", "uMountain", "uHill", "uDebug"]) this.loc[n] = gl.getUniformLocation(p, n);
    this.aPos = gl.getAttribLocation(p, "aPos");
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const tex = (nearest) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); const f = nearest ? gl.NEAREST : gl.LINEAR; gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
    this.copy = tex(true);
    this.copySize = [0, 0];
    this.terrain = tex(true);
    this.gridDirty = true;
  }

  /** The terrain grid into its texture, one byte per cell (read as red). */
  #uploadGrid(gl) {
    const g = this.grid;
    gl.bindTexture(gl.TEXTURE_2D, this.terrain);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, g.width, g.height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, g.data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.gridDirty = false;
  }

  #teardown(gl) {
    for (const t of [this.copy, this.terrain]) if (t) gl.deleteTexture(t);
    if (this.quad) gl.deleteBuffer(this.quad);
    if (this.program) gl.deleteProgram(this.program);
    this.copy = this.terrain = this.quad = this.program = null;
  }

  #render(gl) {
    const map = this.map;
    if (!this.program || !map) return;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, pr = w / (map.getCanvas().clientWidth || w);
    // CSS px to sheet px: three unprojected points (the map is flat, north up).
    const at = (x, y) => { const ll = map.unproject([x, y]); return this.toSheet(ll.lng, ll.lat); };
    const o = at(0, 0), ex = at(100, 0), ey = at(0, 100);
    const xx = (ex[0] - o[0]) / 100, yx = (ex[1] - o[1]) / 100, xy = (ey[0] - o[0]) / 100, yy = (ey[1] - o[1]) / 100;
    // The picture so far, to read from.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.copy);
    if (this.copySize[0] !== w || this.copySize[1] !== h) { gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, w, h, 0); this.copySize = [w, h]; }
    else gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, w, h);
    gl.activeTexture(gl.TEXTURE1);
    if (this.gridDirty) this.#uploadGrid(gl);
    gl.bindTexture(gl.TEXTURE_2D, this.terrain);
    gl.useProgram(this.program);
    const L = this.loc;
    gl.uniform1i(L.uSampler, 0);
    gl.uniform1i(L.uTerrain, 1);
    gl.uniform2f(L.uSize, w, h);
    gl.uniform1f(L.uPr, pr);
    gl.uniformMatrix3fv(L.uToSheet, false, new Float32Array([xx, yx, 0, xy, yy, 0, o[0], o[1], 1]));
    gl.uniform2f(L.uTerrainSize, this.grid.width, this.grid.height);
    gl.uniform1f(L.uCell, this.cell);
    const { north, south } = this.lines;
    gl.uniform2f(L.uNorth, north?.full ?? 0, north?.bare ?? 0);
    gl.uniform2f(L.uSouth, south?.full ?? 0, south?.bare ?? 0);
    gl.uniform2f(L.uPoles, north ? 1 : 0, south ? 1 : 0);
    gl.uniform1f(L.uFoot, Math.sqrt(Math.abs(xx * yy - xy * yx)) / pr);
    gl.uniform1f(L.uGain, this.gain?.() ?? 1);
    gl.uniform1f(L.uMountain, this.lines.mountain);
    gl.uniform1f(L.uHill, this.lines.hill);
    gl.uniform1f(L.uDebug, this.debug ? 1 : 0);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    // Our own vertex state, not MapLibre's (it rebinds its own after custom layers).
    gl.bindVertexArray?.(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(this.aPos);
  }

  detach() {
    const map = this.map;
    if (map) {
      map.off("styledata", this.onStyle);
      try { if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID); } catch { /* map gone */ }
    }
    this.map = this.layer = null;
  }
}
/** Detailed regional maps opt in independently of the realm snow switch. */
export function mapSnowEnabled(world,regionalLinks,regionalSettings,realmEnabled){return regionalLinks?.[world]?regionalSettings?.[world]?.enabled===true:!!realmEnabled;}
