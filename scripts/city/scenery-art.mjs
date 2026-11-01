// Shared KG Transit scenery drawing source. City transit calls only its fantasy layers.
// Canvas-drawn scenery for the ride. Outdoors there are two layers per side: the near row
// of buildings, trees or rock beside the track (transparent above, so the far layer shows),
// and the far skyline or landscape. Underground there are tunnel walls and station
// platforms. Every texture tiles seamlessly side to side. Outdoor layers are drawn in
// daylight colours, then tinted for dusk or night, with lit windows and lamps added on top.

/** Interior art size and vanishing point, in art pixels (the stage everything is drawn in). */
export const STAGE_SIZE = { w: 1672, h: 941, vpX: 836, vpY: 440 };
export const NEAR = { w: 2800, h: 941 };
export const FAR = { w: 4200, h: 1700, horizon: 1440 };

const STORY = 74;

/**
 * What each theme changes in the shared drawing helpers: lamp light, lit-window colours,
 * which modern details exist at all, shop names and rooftop ads.
 */
const KITS = {
  modern: {
    lamp: ["rgba(255,170,70,0.9)", "rgba(255,150,60,0.35)"], lamp_r: 120,
    window: [["#ffe2a0", "#e89a48"], ["#a7c4ff", "#5d7fc4"]], tv: 0.12,
    antennas: true, ac: true, fireEscapes: true, ads: true, poles: "wood",
    shops: ["MARKET", "PHARMACY", "BOOKS", "PIZZA", "CLEANERS", "HARDWARE", "GROCERY", "DELI", "BAKERY", "SHOES", "TV & RADIO", "DONUTS", "LAUNDRY", "BARBER", "TAVERN", "DINER", "FLORIST", "HOTEL"]
  },
  industrial: {
    lamp: ["rgba(255,236,190,0.95)", "rgba(255,220,150,0.35)"], lamp_r: 90,
    window: [["#ffe8b0", "#d8a050"]], tv: 0,
    antennas: false, ac: false, fireEscapes: true, ads: false, poles: "telegraph",
    shops: ["DRAPER", "IRONMONGER", "TAILOR", "APOTHECARY", "TOBACCONIST", "PROVISIONS", "SADDLER", "PRINTER", "CHANDLER", "BAKER", "PUBLIC HOUSE", "HATTER"]
  },
  fantasy: {
    lamp: ["rgba(255,200,110,0.95)", "rgba(255,180,90,0.4)"], lamp_r: 80,
    window: [["#ffd890", "#d88a38"]], tv: 0,
    antennas: false, ac: false, fireEscapes: false, ads: false, poles: "none",
    shops: ["⚒", "♣", "✦", "☾", "♜", "⚓", "❦"]
  },
  future: {
    lamp: ["rgba(120,240,255,0.95)", "rgba(80,200,255,0.35)"], lamp_r: 110,
    window: [["#e8f6ff", "#9ad8ff"], ["#ff8ae8", "#c040c0"], ["#9affd8", "#30b090"]], tv: 0,
    antennas: false, ac: false, fireEscapes: false, ads: true, poles: "light",
    shops: ["NOODLES", "SYNTH", "24/7", "CLINIC", "ARCADE", "NEXUS", "HOTEL", "RAMEN", "DATA", "VAULT", "BAR"]
  }
};

/** Neon colours for the future theme's signs, strips and holograms. */
const NEON = ["#2ef2ff", "#ff3fd8", "#9cff3a", "#ffb02e", "#7a5cff"];

export function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")];
}

/** Small deterministic random generator, so a texture looks the same every time. */
export function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const range = (rand, a, b) => a + rand() * (b - a);

/** [r, g, b] from "#rrggbb" or "rgb(r,g,b)". */
function rgbOf(color) {
  return color.startsWith("#")
    ? [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)]
    : color.match(/\d+/g).slice(0, 3).map(Number);
}

function shade(color, amount) {
  return `rgb(${rgbOf(color).map((v) => Math.max(0, Math.min(255, Math.round(v + amount)))).join(",")})`;
}

function mix(a, b, t) {
  const [x, y] = [rgbOf(a), rgbOf(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`;
}

// ================================================================ sky

const SKY = {
  day: { top: "#4f86c0", mid: "#8fb5d8", horizon: "#d5e3ea", haze: "#b9cbd6", water: "#4f7390", ground: "#58584f" },
  dusk: { top: "#1f2450", mid: "#7a4f78", horizon: "#f1a466", haze: "#9a6a72", water: "#4a3d55", ground: "#2e2a30" },
  night: { top: "#02030a", mid: "#0b1124", horizon: "#1e2a44", haze: "#1a2236", water: "#0a1020", ground: "#0b0c10" }
};

// Grey skies under heavy cloud; at night the overcast glows faintly with the city's lights.
const GREY = {
  overcast: {
    day: { top: "#7d8590", mid: "#9aa1a8", horizon: "#b8bcc0", haze: "#a9aeb3" },
    dusk: { top: "#3a3540", mid: "#6a5a60", horizon: "#a07a6a", haze: "#7a6a6a" },
    night: { top: "#0b0d12", mid: "#1a1a20", horizon: "#3a2e2a", haze: "#2a2426" }
  },
  storm: {
    day: { top: "#4f565e", mid: "#6b7178", horizon: "#868b90", haze: "#7a7f84" },
    dusk: { top: "#24222a", mid: "#403a42", horizon: "#6a5650", haze: "#4a4244" },
    night: { top: "#07080b", mid: "#121318", horizon: "#2a2220", haze: "#1e1a1c" }
  }
};

/** Cloud puffs per sky: how many, how opaque, how dark. */
const CLOUDS = {
  clear: { count: 3, alpha: 0.3, dark: 0 },
  partly: { count: 12, alpha: 0.55, dark: 0 },
  cloudy: { count: 26, alpha: 0.7, dark: 0.15 },
  overcast: { count: 40, alpha: 0.45, dark: 0.25 },
  storm: { count: 44, alpha: 0.6, dark: 0.55 }
};

export function skyColors(tod, sky = "clear") {
  return { ...SKY[tod], ...(GREY[sky]?.[tod] ?? {}) };
}

function drawSky(g, w, horizon, tod, sky, rand) {
  const s = skyColors(tod, sky);
  const grad = g.createLinearGradient(0, 0, 0, horizon);
  grad.addColorStop(0, s.top);
  grad.addColorStop(0.55, s.mid);
  grad.addColorStop(1, s.horizon);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, horizon + 4);

  if (tod === "night" && (sky === "clear" || sky === "partly")) {
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(255,255,240,${range(rand, 0.25, 0.9)})`;
      const r = rand() < 0.1 ? 1.6 : 1;
      g.fillRect(rand() * w, rand() * horizon * 0.7, r, r);
    }
  }
  // Soft clouds, wrapped across the tile edge so it repeats cleanly.
  const c = CLOUDS[sky] ?? CLOUDS.clear;
  const lit = tod === "day" ? [255, 255, 255] : tod === "dusk" ? [255, 190, 150] : [70, 66, 72];
  const col = lit.map((v) => Math.round(v * (1 - c.dark) + 70 * c.dark)).join(",");
  for (let i = 0; i < c.count; i++) {
    const cx = rand() * w;
    const cy = range(rand, horizon * 0.1, horizon * 0.85);
    const scale = range(rand, 0.7, 1.8) * (cy / horizon + 0.3) * (sky === "overcast" || sky === "storm" ? 1.6 : 1);
    for (const dx of [0, -w, w]) {
      for (let k = 0; k < 7; k++) {
        const x = cx + dx + range(rand, -160, 160) * scale;
        const y = cy + range(rand, -25, 25) * scale;
        const r = range(rand, 50, 110) * scale;
        const puff = g.createRadialGradient(x, y, 0, x, y, r);
        puff.addColorStop(0, `rgba(${col},${c.alpha * (tod === "night" ? 0.6 : 1)})`);
        puff.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = puff;
        g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
  }
}

// ================================================================ materials

const BRICKS = ["#8a4a36", "#7b3f2e", "#9a5a3f", "#6f3b2c", "#a0644a"];
const STONE = ["#6b4a3a", "#5e4033", "#7a5644"];
const CLAPBOARD = ["#d9d4c4", "#b9c0c4", "#d8cc9c", "#a9b8a0", "#9fb3c8", "#c9b39a", "#e6e1d6"];
const TRIM = ["#efeadc", "#f4f1e8", "#2f3d33", "#e8e2d0"];
const PLASTER = ["#e8dcc0", "#efe6cf", "#dccaa4", "#e3d3b8", "#d9c7a8"];

function brickPattern(g, base, rand) {
  const [c, p] = makeCanvas(24, 10);
  p.fillStyle = shade(base, 38);
  p.fillRect(0, 0, 24, 10);
  for (const [x, y] of [[0, 0], [12, 0], [-6, 5], [6, 5], [18, 5]]) {
    p.fillStyle = shade(base, range(rand, -14, 12));
    p.fillRect(x, y, 11, 4);
  }
  return g.createPattern(c, "repeat");
}

function stonePattern(g, base, rand) {
  const [c, p] = makeCanvas(60, 36);
  p.fillStyle = shade(base, 20);
  p.fillRect(0, 0, 60, 36);
  for (const [x, y, w] of [[0, 0, 28], [30, 0, 28], [-14, 18, 28], [16, 18, 26], [44, 18, 28]]) {
    p.fillStyle = shade(base, range(rand, -16, 10));
    p.fillRect(x + 1, y + 1, w, 16);
  }
  return g.createPattern(c, "repeat");
}

function clapboard(g, x, y, w, h, base) {
  g.fillStyle = base;
  g.fillRect(x, y, w, h);
  g.fillStyle = "rgba(0,0,0,0.13)";
  for (let yy = y + 4; yy < y + h; yy += 6) g.fillRect(x, yy, w, 1.4);
  g.fillStyle = "rgba(255,255,255,0.08)";
  for (let yy = y + 1; yy < y + h; yy += 6) g.fillRect(x, yy, w, 1);
}

/** A window. Records it so night can light some of them. */
function windowAt(ctx, x, y, w, h, trim, { panes = "sash" } = {}) {
  const { g, rand } = ctx;
  g.fillStyle = trim;
  g.fillRect(x - 2, y - 2, w + 4, h + 4);
  const glass = g.createLinearGradient(x, y, x + w * 0.6, y + h);
  glass.addColorStop(0, "#a9bfd2");
  glass.addColorStop(0.45, "#4c5d6c");
  glass.addColorStop(1, "#262f38");
  g.fillStyle = glass;
  g.fillRect(x, y, w, h);
  const blind = rand() < 0.35 ? range(rand, 0.2, 0.6) : 0;
  if (blind) {
    g.fillStyle = pick(rand, ["#e9dfc4", "#d8c9a0", "#f0ece0", "#c9b48a"]);
    g.fillRect(x, y, w, h * blind);
  }
  g.fillStyle = trim;
  if (panes === "sash") g.fillRect(x, y + h / 2 - 1, w, 2);
  if (panes === "lead") {
    // Small leaded panes for old and fantasy houses.
    for (let yy = y + 6; yy < y + h; yy += 7) g.fillRect(x, yy, w, 1);
    for (let xx = x + 5; xx < x + w; xx += 6) g.fillRect(xx, y, 1, h);
  }
  if (panes === "sash" && ctx.kit.ac && rand() < 0.08 && h > 30) {
    // An air conditioner hanging out the window.
    g.fillStyle = "#b8b4aa";
    g.fillRect(x + 1, y + h / 2 + 2, w - 2, h * 0.28);
    g.fillStyle = "#77736b";
    g.fillRect(x + 3, y + h / 2 + 5, w - 6, 2);
  }
  ctx.windows.push({ x, y, w, h, blind });
}

function cornice(g, x, y, w, color) {
  g.fillStyle = shade(color, -10);
  g.fillRect(x - 4, y, w + 8, 12);
  g.fillStyle = shade(color, 18);
  g.fillRect(x - 4, y + 12, w + 8, 3);
  g.fillStyle = shade(color, -30);
  for (let xx = x; xx < x + w; xx += 8) g.fillRect(xx, y + 15, 4, 4);
}

function chimney(g, x, top, rand) {
  g.fillStyle = shade(pick(rand, BRICKS), -10);
  g.fillRect(x, top - 26, 14, 26);
  g.fillStyle = "#2c2622";
  g.fillRect(x - 2, top - 30, 18, 5);
}

function antenna(g, x, top) {
  g.strokeStyle = "#2a2a2a";
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x, top);
  g.lineTo(x, top - 46);
  for (const [y, half] of [[-40, 16], [-32, 12], [-24, 9]]) {
    g.moveTo(x - half, top + y);
    g.lineTo(x + half, top + y);
  }
  g.stroke();
}

function storefront(ctx, x, w, street) {
  const { g, rand } = ctx;
  const top = street - STORY + 8;
  g.fillStyle = "#2b2622";
  g.fillRect(x, top, w, street - top);
  for (let xx = x + 6; xx < x + w - 20; xx += 44) {
    const pane = Math.min(38, x + w - 6 - xx);
    g.fillStyle = "#1b2128";
    g.fillRect(xx, top + 26, pane, street - top - 30);
    ctx.shops.push({ x: xx, y: top + 26, w: pane, h: street - top - 30 });
  }
  g.fillStyle = pick(rand, ["#7d1e1a", "#1d3d6b", "#215a33", "#2a2a2a", "#8a6a14"]);
  g.fillRect(x + 4, top, w - 8, 16);
  g.fillStyle = "#f3eee0";
  g.font = "bold 12px Helvetica, Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(pick(rand, ctx.kit.shops), x + w / 2, top + 8.5, w - 16);
  const stripe = pick(rand, ["#a8322a", "#2d5a3d", "#2a4a7a", "#7a5a2a"]);
  for (let xx = x + 6, i = 0; xx < x + w - 6; xx += 10, i++) {
    g.fillStyle = i % 2 ? "#ece6d6" : stripe;
    g.beginPath();
    g.moveTo(xx, top + 17); g.lineTo(xx + 10, top + 17); g.lineTo(xx + 12, top + 28); g.lineTo(xx + 2, top + 28);
    g.fill();
  }
}

function fireEscape(g, x, top, stories) {
  g.strokeStyle = "#151515";
  g.fillStyle = "#151515";
  g.lineWidth = 1.5;
  for (let s = 0; s < stories; s++) {
    const y = top + STORY * (s + 1) - 6;
    g.fillRect(x - 6, y, 58, 3);
    g.beginPath();
    for (let xx = x - 6; xx <= x + 52; xx += 6) { g.moveTo(xx, y); g.lineTo(xx, y - 14); }
    g.moveTo(x - 6, y - 14); g.lineTo(x + 52, y - 14);
    g.moveTo(x + 4, y); g.lineTo(x + 40, y - STORY + 3);
    g.stroke();
  }
}

// ================================================================ signs

/** Steel scaffolding under a rooftop sign: legs, rails and cross-bracing. */
function scaffold(g, x, top, w, h, color) {
  g.strokeStyle = color;
  g.lineWidth = Math.max(1.5, w / 90);
  g.beginPath();
  for (let i = 0; i <= 4; i++) {
    const lx = x + (w * i) / 4;
    g.moveTo(lx, top); g.lineTo(lx, top + h);
    if (i < 4) {
      const nx = x + (w * (i + 1)) / 4;
      g.moveTo(lx, top); g.lineTo(nx, top + h);
      g.moveTo(nx, top); g.lineTo(lx, top + h);
    }
  }
  g.moveTo(x, top + h * 0.5); g.lineTo(x + w, top + h * 0.5);
  g.stroke();
}

/** A painted billboard on its scaffold, floodlit at night. */
function billboard(ctx, x, base, w, h, { bg, fg, lines, font = "Georgia, serif" }) {
  const { g, tod } = ctx;
  const top = base - h * 1.7;
  scaffold(g, x + w * 0.05, top + h, w * 0.9, h * 0.7, tod === "day" ? "#3a3a3e" : "#1a1a1e");
  g.fillStyle = bg;
  g.fillRect(x, top, w, h);
  g.fillStyle = fg;
  g.textBaseline = "middle";
  g.textAlign = "left";
  const size = Math.round((h * 0.8) / lines.length);
  lines.forEach((line, i) => {
    g.font = `bold ${size}px ${font}`;
    g.fillText(line, x + w * 0.06, top + h * 0.12 + size * (i + 0.5), w * 0.88);
  });
  g.fillStyle = "rgba(0,0,0,0.12)";
  g.fillRect(x, top + h * 0.92, w, h * 0.08);
  ctx.lamps.push({ x: x + w / 2, y: top + h * 1.05 });
}

/** Rooftop billboards for the city. */
const ADS = [
  { bg: "#123b7a", fg: "#ffffff", lines: ["DAILY STAR", "Read all about it"], font: "Helvetica, Arial, sans-serif" },
  { bg: "#f6f1e4", fg: "#b2122a", lines: ["FRESH", "MILK"], font: "Helvetica, Arial, sans-serif" },
  { bg: "#c8202a", fg: "#fff6e0", lines: ["Ice cold", "COLA"], font: "Georgia, serif" },
  { bg: "#2c5aa0", fg: "#ffe14a", lines: ["RADIO", "101 FM"], font: "Helvetica, Arial, sans-serif" },
  { bg: "#0f2f22", fg: "#f4e9c8", lines: ["City Savings", "Bank"], font: "Georgia, serif" },
  { bg: "#1c1c1c", fg: "#f2c418", lines: ["MOTOR", "OIL"], font: "Helvetica, Arial, sans-serif" },
  { bg: "#f2ead8", fg: "#3a2a1a", lines: ["Furniture", "SALE"], font: "Georgia, serif" }
];

function rooftopAd(ctx, x, w, roof) {
  billboard(ctx, x, roof, w, w * 0.42, pick(ctx.rand, ADS));
}

// ================================================================ buildings

function rowhouse(ctx, x, w, street, { stories, shops = true, brownstone = false, ads = true } = {}) {
  const { g, rand } = ctx;
  const n = stories ?? Math.floor(range(rand, 3, 6));
  const top = street - n * STORY - 16;
  const base = brownstone ? pick(rand, STONE) : pick(rand, BRICKS);
  g.fillStyle = brownstone ? base : brickPattern(g, base, rand);
  g.fillRect(x, top, w, street - top);
  if (brownstone) {
    g.fillStyle = "rgba(0,0,0,0.08)";
    for (let yy = top; yy < street; yy += 18) g.fillRect(x, yy, w, 1);
  }
  const edge = g.createLinearGradient(x, 0, x + w, 0);
  edge.addColorStop(0, "rgba(255,240,220,0.06)");
  edge.addColorStop(1, "rgba(0,0,0,0.14)");
  g.fillStyle = edge;
  g.fillRect(x, top, w, street - top);
  cornice(g, x, top, w, brownstone ? base : shade(base, -25));

  const trim = pick(rand, TRIM);
  const cols = Math.max(1, Math.floor(w / 46));
  const gap = w / cols;
  const bay = brownstone && w > 120 && rand() < 0.7;
  const groundShop = shops && rand() < 0.6;
  const floors = groundShop ? n - 1 : n;
  for (let f = 0; f < floors; f++) {
    const y = top + 24 + f * STORY;
    for (let c = 0; c < cols; c++) {
      const wx = x + c * gap + gap / 2 - 11;
      g.fillStyle = brownstone ? shade(base, 22) : "#c9bfa6";
      g.fillRect(wx - 3, y - 6, 28, 5);
      g.fillRect(wx - 4, y + 44, 30, 4);
      windowAt(ctx, wx, y, 22, 42, trim);
    }
    if (bay) {
      const bx = x + 6;
      const bw = gap * 2 - 12;
      g.fillStyle = "rgba(255,240,220,0.10)";
      g.fillRect(bx, y - 10, bw, STORY - 6);
      g.fillStyle = "rgba(0,0,0,0.22)";
      g.fillRect(bx + bw - 6, y - 10, 6, STORY - 6);
    }
  }
  if (groundShop) storefront(ctx, x + 2, w - 4, street);
  if (ctx.kit.fireEscapes && rand() < 0.3 && w > 110 && !bay) fireEscape(g, x + w - 70, top + 10, Math.max(1, floors - 1));
  if (ads && ctx.kit.ads && w > 170 && rand() < 0.14) rooftopAd(ctx, x + 10, Math.min(220, w - 20), top);
  else {
    if (rand() < 0.6) chimney(g, x + range(rand, 10, w - 30), top, rand);
    if (ctx.kit.antennas && rand() < 0.5) antenna(g, x + range(rand, 20, w - 20), top);
  }
  // Painted advertisements on the brick, the industrial era's billboard.
  if (ctx.theme === "industrial" && !brownstone && w > 150 && rand() < 0.25) paintedAd(ctx, x + 12, top + 26, w - 24);
  ctx.roofs.push({ x, w, y: top });
}

/** A wooden three-storey house with stacked porches. */
function woodHouse(ctx, x, w, street) {
  const { g, rand } = ctx;
  const top = street - 3 * STORY;
  const color = pick(rand, CLAPBOARD);
  const trim = pick(rand, ["#f4f1e8", "#efeadc", "#ffffff"]);
  clapboard(g, x, top, w, street - top, color);
  const porchLeft = rand() < 0.5;
  const pw = 52;
  const px = porchLeft ? x : x + w - pw;
  for (let f = 0; f < 3; f++) {
    const y = top + f * STORY;
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(px, y + 4, pw, STORY - 4);
    g.fillStyle = trim;
    g.fillRect(px, y + STORY - 4, pw, 4);
    g.fillRect(px, y + STORY - 26, pw, 3);
    for (let k = 0; k <= 3; k++) g.fillRect(px + k * (pw - 4) / 3, y + 4, 4, STORY - 6);
    for (let k = 0; k < pw; k += 6) g.fillRect(px + k, y + STORY - 24, 1.5, 20);
  }
  const wallX = porchLeft ? x + pw : x;
  const wallW = w - pw;
  for (let f = 0; f < 3; f++) {
    const y = top + 14 + f * STORY;
    const cols = Math.max(1, Math.floor(wallW / 40));
    for (let c = 0; c < cols; c++) windowAt(ctx, wallX + 10 + c * (wallW - 20) / cols + 4, y, 20, 40, trim);
  }
  if (rand() < 0.45) {
    g.fillStyle = shade("#4a4440", range(rand, -10, 10));
    g.beginPath(); g.moveTo(x - 6, top); g.lineTo(x + w / 2, top - 48); g.lineTo(x + w + 6, top); g.fill();
  } else {
    g.fillStyle = trim;
    g.fillRect(x - 5, top - 12, w + 10, 12);
    g.fillStyle = "rgba(0,0,0,0.25)";
    for (let k = x; k < x + w; k += 14) g.fillRect(k, top - 2, 5, 6);
  }
  if (ctx.kit.antennas && rand() < 0.7) antenna(g, x + range(rand, 15, w - 15), top - 6);
  ctx.roofs.push({ x, w, y: top });
}

function warehouse(ctx, x, w, street) {
  const { g, rand } = ctx;
  const n = Math.floor(range(rand, 2, 5));
  const top = street - n * STORY;
  const concrete = rand() < 0.4;
  const base = concrete ? pick(rand, ["#9a978e", "#8b877d", "#a8a296"]) : pick(rand, BRICKS);
  g.fillStyle = concrete ? base : brickPattern(g, base, rand);
  g.fillRect(x, top, w, street - top);
  g.fillStyle = "rgba(0,0,0,0.12)";
  g.fillRect(x + w - 8, top, 8, street - top);
  for (let f = 0; f < n; f++) {
    const y = top + 18 + f * STORY;
    for (let wx = x + 14; wx < x + w - 30; wx += 34) {
      if (rand() < 0.15) {
        g.fillStyle = "#3a2f26";
        g.fillRect(wx, y, 22, 30);
      } else {
        windowAt(ctx, wx, y, 22, 30, "#3c3833");
      }
    }
  }
  if (!concrete && rand() < 0.7) {
    g.fillStyle = "rgba(240,235,220,0.45)";
    g.font = "bold 30px Georgia, serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(pick(rand, ["STORAGE", "FURNITURE", "PACKING CO.", "MOVING & STORAGE", "COFFEE", "SHOE CO.", "BAKING CO.", "WOOLEN MILLS", "IRON WORKS"]), x + w / 2, top + 30, w - 30);
  }
  if (rand() < 0.5) waterTank(g, x + range(rand, 20, w - 70), top);
  if (rand() < 0.3) {
    g.fillStyle = shade(base, -20);
    g.fillRect(x + w - 40, top - 160, 22, 160);
  }
  ctx.roofs.push({ x, w, y: top });
}

function waterTank(g, x, top) {
  g.strokeStyle = "#2a2622";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(x + 6, top); g.lineTo(x + 10, top - 26);
  g.moveTo(x + 44, top); g.lineTo(x + 40, top - 26);
  g.stroke();
  g.fillStyle = "#6b5a46";
  g.fillRect(x + 4, top - 70, 42, 46);
  g.fillStyle = "rgba(0,0,0,0.25)";
  for (let y = top - 66; y < top - 24; y += 10) g.fillRect(x + 4, y, 42, 2);
  g.fillStyle = "#4b4038";
  g.beginPath(); g.moveTo(x, top - 70); g.lineTo(x + 25, top - 92); g.lineTo(x + 50, top - 70); g.fill();
}

function oilTank(ctx, x, w, street) {
  const { g, rand } = ctx;
  const h = range(rand, 120, 170);
  const body = g.createLinearGradient(x, 0, x + w, 0);
  body.addColorStop(0, "#9c9a92");
  body.addColorStop(0.4, "#d6d3c9");
  body.addColorStop(1, "#77756e");
  g.fillStyle = body;
  g.fillRect(x, street - h, w, h);
  g.beginPath(); g.ellipse(x + w / 2, street - h, w / 2, 14, 0, Math.PI, 0); g.fill();
  g.strokeStyle = "rgba(60,60,60,0.5)";
  g.lineWidth = 1;
  for (let y = street - h + 18; y < street; y += 24) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + w, y); g.stroke(); }
  ctx.roofs.push({ x, w, y: street - h - 10 });
}

function house(ctx, x, w, street) {
  const { g, rand } = ctx;
  const base = street - 14;
  const top = base - 2 * STORY + 10;
  clapboard(g, x, top, w, base - top, pick(rand, ["#f1ede2", "#e7dcc0", "#c9ccc6", "#b0442f", "#e9e4d4", "#9db0a3"]));
  const shutter = pick(rand, ["#1f3326", "#202020", "#5a1f1a"]);
  for (let f = 0; f < 2; f++) {
    const y = top + 16 + f * STORY * 0.9;
    for (let c = 0; c < 3; c++) {
      const wx = x + 18 + c * (w - 36) / 3 + 6;
      g.fillStyle = shutter;
      g.fillRect(wx - 9, y - 2, 6, 40);
      g.fillRect(wx + 23, y - 2, 6, 40);
      windowAt(ctx, wx, y, 20, 36, "#f4f1e8");
    }
  }
  g.fillStyle = pick(rand, ["#3d3a38", "#4f3b30", "#2f3437"]);
  g.beginPath(); g.moveTo(x - 10, top + 2); g.lineTo(x + w / 2, top - 62); g.lineTo(x + w + 10, top + 2); g.fill();
  chimney(g, x + w * 0.7, top - 20, rand);
  ctx.roofs.push({ x, w, y: top - 62 });
}

/** Downtown: a glass or concrete office tower, taller than the window shows. */
function officeTower(ctx, x, w, street) {
  const { g, rand } = ctx;
  const top = street - range(rand, 500, 760);
  const glassy = rand() < 0.55;
  if (glassy) {
    const glass = g.createLinearGradient(x, 0, x + w, 0);
    const tint = pick(rand, [["#5f7f9a", "#9fbbd0"], ["#3d5a4f", "#86a89a"], ["#6a6a72", "#b3b6bf"], ["#7a6248", "#c2a882"]]);
    glass.addColorStop(0, tint[0]);
    glass.addColorStop(0.5, tint[1]);
    glass.addColorStop(1, tint[0]);
    g.fillStyle = glass;
    g.fillRect(x, top, w, street - top);
    g.fillStyle = "rgba(20,25,30,0.55)";
    for (let y = top + 10; y < street; y += 22) g.fillRect(x, y, w, 2);
    for (let xx = x; xx < x + w; xx += 30) g.fillRect(xx, top, 1.5, street - top);
    for (let y = top + 12; y < street - 30; y += 22) {
      for (let xx = x + 2; xx < x + w - 26; xx += 30) ctx.windows.push({ x: xx, y, w: 26, h: 18, blind: 0 });
    }
  } else {
    const base = pick(rand, ["#b8b2a6", "#a7a39a", "#c4bdb0", "#8f8a82"]);
    g.fillStyle = base;
    g.fillRect(x, top, w, street - top);
    for (let y = top + 14; y < street - 20; y += 34) {
      for (let xx = x + 8; xx < x + w - 20; xx += 26) windowAt(ctx, xx, y, 16, 22, shade(base, -30), { panes: "none" });
    }
    g.fillStyle = "rgba(0,0,0,0.12)";
    g.fillRect(x + w - 10, top, 10, street - top);
  }
  // Lobby at street level.
  g.fillStyle = "#1e2226";
  g.fillRect(x, street - 60, w, 60);
  ctx.shops.push({ x: x + 6, y: street - 54, w: w - 12, h: 48 });
  ctx.roofs.push({ x, w, y: top });
}

/** Fantasy: a timber-framed house with a jettied upper floor, steep roof and a hanging sign. */
function timberHouse(ctx, x, w, street) {
  const { g, rand } = ctx;
  const floors = Math.floor(range(rand, 2, 4));
  const groundTop = street - STORY;
  const plaster = pick(rand, PLASTER);
  const beam = pick(rand, ["#3b2a1c", "#4a3322", "#2e2218"]);
  // Stone ground floor, plaster-and-timber floors above, each jutting out a little.
  g.fillStyle = stonePattern(g, pick(rand, ["#8a8070", "#7a7466", "#958b78"]), rand);
  g.fillRect(x + 4, groundTop, w - 8, STORY);
  g.fillStyle = beam;
  g.fillRect(x + w / 2 - 14, groundTop + 18, 28, STORY - 18);
  let top = groundTop;
  for (let f = 0; f < floors; f++) {
    const jut = (f + 1) * 5;
    const fx = x + 4 - jut;
    const fw = w - 8 + jut * 2;
    top -= STORY;
    g.fillStyle = plaster;
    g.fillRect(fx, top, fw, STORY);
    g.strokeStyle = beam;
    g.lineWidth = 5;
    g.strokeRect(fx, top, fw, STORY);
    g.beginPath();
    for (let bx = fx + fw / 4; bx < fx + fw - 4; bx += fw / 4) { g.moveTo(bx, top); g.lineTo(bx, top + STORY); }
    // Diagonal braces between the posts.
    g.moveTo(fx, top + STORY); g.lineTo(fx + fw / 4, top);
    g.moveTo(fx + fw, top + STORY); g.lineTo(fx + fw * 0.75, top);
    g.stroke();
    for (let c = 1; c < 3; c++) windowAt(ctx, fx + (fw * c) / 3 - 10, top + 18, 20, 30, beam, { panes: "lead" });
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(fx, top + STORY - 4, fw, 4);
  }
  // Steep roof with a dormer and a chimney.
  const roofW = w + floors * 10;
  const rx = x + w / 2 - roofW / 2;
  const peak = top - range(rand, 90, 140);
  g.fillStyle = pick(rand, ["#5a3a2a", "#4a3a34", "#6a4a3a", "#3a3a40"]);
  g.beginPath(); g.moveTo(rx - 6, top + 4); g.lineTo(x + w / 2, peak); g.lineTo(rx + roofW + 6, top + 4); g.fill();
  g.fillStyle = "rgba(0,0,0,0.15)";
  for (let y = peak + 10; y < top; y += 9) g.fillRect(rx, y, roofW, 1.5);
  if (rand() < 0.6) {
    const dx = x + w / 2 - 14;
    const dy = (peak + top) / 2;
    g.fillStyle = plaster;
    g.fillRect(dx, dy, 28, 26);
    g.fillStyle = shade(plaster, -60);
    g.beginPath(); g.moveTo(dx - 4, dy); g.lineTo(dx + 14, dy - 16); g.lineTo(dx + 32, dy); g.fill();
    windowAt(ctx, dx + 7, dy + 6, 14, 16, beam, { panes: "lead" });
  }
  chimney(g, x + w * 0.72, (peak + top) / 2 + 10, rand);
  // Hanging shop sign on a wrought-iron bracket, and a lantern by the door.
  if (rand() < 0.6) {
    const sx = x + 10;
    const sy = groundTop - 8;
    g.strokeStyle = "#1a1a1a";
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + 40, sy); g.stroke();
    g.fillStyle = pick(rand, ["#7a2a1e", "#22466a", "#2e5a2e", "#6a5320"]);
    g.fillRect(sx + 14, sy + 4, 26, 20);
    g.fillStyle = "#e9d9a8";
    g.font = "bold 13px Georgia, serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(pick(rand, ["⚒", "♣", "✦", "☾", "♜", "⚓", "❦"]), sx + 27, sy + 14);
  }
  g.fillStyle = "#1a1a1a";
  g.fillRect(x + w / 2 + 18, groundTop + 18, 8, 12);
  ctx.lamps.push({ x: x + w / 2 + 22, y: groundTop + 24, warm: true });
  ctx.roofs.push({ x: rx, w: roofW, y: peak });
}

/** A round stone tower with a conical roof, for fantasy streets. */
function stoneTower(ctx, x, w, street) {
  const { g, rand } = ctx;
  const top = street - range(rand, 300, 420);
  const body = g.createLinearGradient(x, 0, x + w, 0);
  body.addColorStop(0, "#6d675c");
  body.addColorStop(0.4, "#a59d8c");
  body.addColorStop(1, "#5a554c");
  g.fillStyle = body;
  g.fillRect(x, top, w, street - top);
  g.fillStyle = "rgba(0,0,0,0.15)";
  for (let y = top + 8; y < street; y += 16) g.fillRect(x, y, w, 1.5);
  for (let y = top + 40; y < street - 60; y += 90) windowAt(ctx, x + w / 2 - 6, y, 12, 26, "#3a342c", { panes: "none" });
  g.fillStyle = pick(rand, ["#3a3a46", "#4a2e2a", "#2e3a4a"]);
  g.beginPath(); g.moveTo(x - 10, top); g.lineTo(x + w / 2, top - w * 1.4); g.lineTo(x + w + 10, top); g.fill();
  g.strokeStyle = "#2a2a2a";
  g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(x + w / 2, top - w * 1.4); g.lineTo(x + w / 2, top - w * 1.4 - 24); g.stroke();
  g.fillStyle = pick(rand, ["#b03030", "#d8b020", "#3060b0"]);
  g.beginPath(); g.moveTo(x + w / 2, top - w * 1.4 - 24); g.lineTo(x + w / 2 + 16, top - w * 1.4 - 19); g.lineTo(x + w / 2, top - w * 1.4 - 14); g.fill();
  ctx.roofs.push({ x, w, y: top - w * 1.4 });
}

function barn(ctx, x, w, ground) {
  const { g, rand } = ctx;
  const h = range(rand, 110, 150);
  const red = pick(rand, ["#8e2f24", "#7a2a22", "#9a4a2a", "#6a6a62"]);
  g.fillStyle = red;
  g.fillRect(x, ground - h, w, h);
  g.fillStyle = "rgba(0,0,0,0.12)";
  for (let xx = x + 8; xx < x + w; xx += 10) g.fillRect(xx, ground - h, 1.5, h);
  // Gambrel roof.
  g.fillStyle = "#3e3a36";
  g.beginPath();
  g.moveTo(x - 8, ground - h);
  g.lineTo(x + w * 0.18, ground - h - 50);
  g.lineTo(x + w / 2, ground - h - 74);
  g.lineTo(x + w * 0.82, ground - h - 50);
  g.lineTo(x + w + 8, ground - h);
  g.fill();
  g.strokeStyle = "#efe6d6";
  g.lineWidth = 4;
  const dx = x + w / 2 - 30;
  g.strokeRect(dx, ground - 80, 60, 80);
  g.beginPath(); g.moveTo(dx, ground - 80); g.lineTo(dx + 60, ground); g.moveTo(dx + 60, ground - 80); g.lineTo(dx, ground); g.stroke();
  ctx.roofs.push({ x, w, y: ground - h - 74 });
}

function silo(ctx, x, ground) {
  const { g } = ctx;
  const body = g.createLinearGradient(x, 0, x + 44, 0);
  body.addColorStop(0, "#8a8478");
  body.addColorStop(0.4, "#c8c0ae");
  body.addColorStop(1, "#77716a");
  g.fillStyle = body;
  g.fillRect(x, ground - 230, 44, 230);
  g.beginPath(); g.ellipse(x + 22, ground - 230, 22, 18, 0, Math.PI, 0); g.fill();
}

/**
 * A tree. Broadleaf canopies turn in autumn and go bare in winter; pines stay green
 * (with snow on them in winter).
 */
function tree(ctx, x, base, h, { pine = false } = {}) {
  const { g, rand, season } = ctx;
  g.fillStyle = "#3b2e24";
  g.fillRect(x - 4, base - h * 0.45, 8, h * 0.45);
  if (pine) {
    const green = pick(rand, ["#26402c", "#2e4a30", "#1f3a2a"]);
    for (let k = 0; k < 4; k++) {
      const y = base - h * 0.25 - k * h * 0.2;
      const half = h * (0.28 - k * 0.05);
      g.fillStyle = shade(green, k * 6);
      g.beginPath(); g.moveTo(x - half, y); g.lineTo(x, y - h * 0.32); g.lineTo(x + half, y); g.fill();
      if (season === "winter") {
        g.fillStyle = "rgba(240,244,248,0.85)";
        g.beginPath(); g.moveTo(x - half * 0.5, y - h * 0.16); g.lineTo(x, y - h * 0.32); g.lineTo(x + half * 0.5, y - h * 0.16); g.fill();
      }
    }
    return;
  }
  if (season === "winter") {
    g.strokeStyle = "#3e3530";
    const branch = (bx, by, len, angle, depth) => {
      const ex = bx + Math.cos(angle) * len;
      const ey = by + Math.sin(angle) * len;
      g.lineWidth = Math.max(0.8, depth * 1.4);
      g.beginPath(); g.moveTo(bx, by); g.lineTo(ex, ey); g.stroke();
      if (depth > 0) for (const d of [-0.5, 0.45]) branch(ex, ey, len * 0.7, angle + d + range(rand, -0.2, 0.2), depth - 1);
    };
    branch(x, base - h * 0.45, h * 0.3, -Math.PI / 2, 4);
    return;
  }
  const leaf = season === "fall" ? pick(rand, ["#b5651d", "#c9822b", "#9c3b1f", "#c6a032"]) : pick(rand, ["#3f6b2f", "#4c7a36", "#355f2c"]);
  for (let k = 0; k < 9; k++) {
    const cx = x + range(rand, -h * 0.28, h * 0.28);
    const cy = base - h * 0.55 - range(rand, 0, h * 0.4);
    const r = range(rand, h * 0.14, h * 0.24);
    const ball = g.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    ball.addColorStop(0, shade(leaf, 30));
    ball.addColorStop(1, shade(leaf, -30));
    g.fillStyle = ball;
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  }
}

/**
 * Poles with wires sagging between them; spacing divides the tile width. The theme decides
 * what they are: wooden power poles, tall telegraph poles, none, or slim light pylons.
 */
function poles(ctx, street, { spacing = 350, top = 150, trolley = false } = {}) {
  const { g, w } = ctx;
  const style = ctx.kit.poles;
  if (style === "none") return;
  if (style === "light") return lightPylons(ctx, street, spacing, top);
  if (style === "telegraph") return telegraphPoles(ctx, street, spacing, top - 40);
  const heights = trolley ? [top + 30] : [top + 8, top + 22, top + 44];
  for (let x = 0; x < w; x += spacing) {
    g.fillStyle = trolley ? "#3a3d3a" : "#5a4a3a";
    g.fillRect(x - 4, top, 8, street - top);
    if (!trolley) {
      g.fillRect(x - 26, top + 6, 52, 5);
      g.fillStyle = "#cfd6d0";
      for (const dx of [-22, -8, 8, 22]) g.fillRect(x + dx - 1.5, top, 3, 6);
      g.fillStyle = "#2b2b2b";
      g.fillRect(x + 6, top + 14, 20, 5);
    } else {
      g.fillRect(x, top + 26, 60, 4);
    }
    ctx.lamps.push({ x: x + (trolley ? 0 : 18), y: top + 18 });
  }
  g.strokeStyle = "#1a1a1a";
  g.lineWidth = 1.4;
  for (const y of heights) {
    for (let x = 0; x < w; x += spacing) {
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + spacing / 2, y + 22, x + spacing, y); g.stroke();
    }
  }
}

/** Tall telegraph poles strung with many wires, and an ornate gas lamp between each pair. */
function telegraphPoles(ctx, street, spacing, top) {
  const { g, w } = ctx;
  for (let x = 0; x < w; x += spacing) {
    g.fillStyle = "#4a3c30";
    g.fillRect(x - 4, top, 8, street - top);
    for (const [y, half] of [[top + 6, 34], [top + 22, 28]]) {
      g.fillRect(x - half, y, half * 2, 5);
      g.fillStyle = "#d8d0c0";
      for (let dx = -half + 4; dx <= half - 4; dx += 10) g.fillRect(x + dx - 1.5, y - 6, 3, 6);
      g.fillStyle = "#4a3c30";
    }
    gasLamp(ctx, x + spacing / 2, street);
  }
  g.strokeStyle = "#1a1a1a";
  g.lineWidth = 1;
  for (const y of [top + 2, top + 8, top + 14, top + 20, top + 26]) {
    for (let x = 0; x < w; x += spacing) {
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + spacing / 2, y + 18, x + spacing, y); g.stroke();
    }
  }
}

/** A cast-iron gas lamp on a fluted post. */
function gasLamp(ctx, x, street) {
  const { g } = ctx;
  const top = street - 150;
  g.fillStyle = "#1e2420";
  g.fillRect(x - 3, top + 18, 6, 132);
  g.fillRect(x - 8, street - 14, 16, 14);
  g.beginPath(); g.moveTo(x - 10, top + 18); g.lineTo(x - 6, top); g.lineTo(x + 6, top); g.lineTo(x + 10, top + 18); g.fill();
  g.fillStyle = "#f6e8b8";
  g.fillRect(x - 6, top + 3, 12, 13);
  ctx.lamps.push({ x, y: top + 9 });
}

/** Future streets: slim pylons with a glowing strip and a cable of light between them. */
function lightPylons(ctx, street, spacing, top) {
  const { g, w, rand } = ctx;
  const glow = pick(rand, NEON.slice(0, 2));
  for (let x = 0; x < w; x += spacing) {
    g.fillStyle = "#1c2128";
    g.fillRect(x - 3, top, 6, street - top);
    g.fillStyle = glow;
    g.fillRect(x - 1, top + 10, 2, street - top - 30);
    g.fillRect(x - 18, top, 36, 4);
    ctx.lamps.push({ x, y: top + 2, color: glow });
  }
  g.strokeStyle = glow;
  g.globalAlpha = 0.7;
  g.lineWidth = 1.5;
  for (let x = 0; x < w; x += spacing) {
    g.beginPath(); g.moveTo(x, top + 2); g.quadraticCurveTo(x + spacing / 2, top + 16, x + spacing, top + 2); g.stroke();
  }
  g.globalAlpha = 1;
}

function chainLink(ctx, street) {
  const { g, w } = ctx;
  g.strokeStyle = "rgba(60,62,60,0.8)";
  g.lineWidth = 1;
  for (let x = 0; x < w; x += 8) {
    g.beginPath(); g.moveTo(x, street - 46); g.lineTo(x + 23, street); g.moveTo(x + 23, street - 46); g.lineTo(x, street); g.stroke();
  }
  g.fillStyle = "#4a4c4a";
  for (let x = 0; x < w; x += 140) g.fillRect(x, street - 50, 4, 50);
  g.fillRect(0, street - 50, w, 3);
}

function woodFence(ctx, ground) {
  const { g, w } = ctx;
  g.fillStyle = "#6a5440";
  for (let x = 0; x < w; x += 70) g.fillRect(x, ground - 46, 6, 46);
  g.fillRect(0, ground - 40, w, 4);
  g.fillRect(0, ground - 22, w, 4);
}

/** Lay buildings left to right to fill the tile exactly. */
function streetOf(ctx, street, chooser, { gapMin = 0, gapMax = 0 } = {}) {
  const { rand, w } = ctx;
  let x = 0;
  while (x < w - 60) {
    const [kind, minW, maxW] = chooser();
    let bw = range(rand, minW, maxW);
    if (x + bw > w - 40) bw = w - x;
    if (bw < 60) break;
    kind(ctx, x, bw, street);
    x += bw + range(rand, gapMin, gapMax);
  }
}

function emptyLot() {}

// ================================================================ night and dusk

function tint(ctx) {
  const { g, tod, rand, sky } = ctx;
  if (sky === "overcast" || sky === "storm") {
    g.save();
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = sky === "storm" ? "rgba(40,46,56,0.38)" : "rgba(70,78,90,0.24)";
    g.fillRect(0, 0, ctx.w, ctx.h);
    g.restore();
  }
  if (tod !== "day") {
    g.save();
    g.globalCompositeOperation = "source-atop";
    if (tod === "night") {
      g.fillStyle = "rgba(8,12,28,0.84)";
      g.fillRect(0, 0, ctx.w, ctx.h);
    } else {
      g.fillStyle = "rgba(60,30,50,0.42)";
      g.fillRect(0, 0, ctx.w, ctx.h);
      g.fillStyle = "rgba(255,140,80,0.12)";
      g.fillRect(0, 0, ctx.w, ctx.h);
    }
    g.restore();
  }
  if (tod === "day" && ctx.theme !== "future") return;
  // The future is lit even by day: some windows and every neon stays on.
  const share = tod === "night" ? 0.42 : tod === "dusk" ? 0.22 : 0.1;
  const kit = ctx.kit;
  for (const win of ctx.windows) {
    if (rand() > (ctx.theme === "future" ? share + 0.25 : share)) continue;
    const colors = rand() < kit.tv ? kit.window[1] : kit.window.length > 2 && rand() < 0.3 ? pick(rand, kit.window.slice(1)) : kit.window[0];
    const glow = g.createLinearGradient(win.x, win.y, win.x, win.y + win.h);
    glow.addColorStop(0, colors[0]);
    glow.addColorStop(1, colors[1]);
    g.fillStyle = glow;
    g.fillRect(win.x, win.y, win.w, win.h);
    if (win.blind) {
      g.fillStyle = "rgba(240,200,130,0.75)";
      g.fillRect(win.x, win.y, win.w, win.h * win.blind);
    }
  }
  for (const shop of ctx.shops) {
    if (rand() > (tod === "night" ? 0.6 : 0.8)) continue;
    g.fillStyle = "rgba(255,236,190,0.85)";
    g.fillRect(shop.x, shop.y, shop.w, shop.h);
  }
  // Lamps in the theme's light: sodium, gas, lantern or neon. A lamp can carry its own colour.
  g.save();
  g.globalCompositeOperation = "lighter";
  const lampScale = tod === "day" ? 0.35 : 1;
  for (const lamp of ctx.lamps) {
    const r = lamp.warm ? 70 : kit.lamp_r;
    const glow = g.createRadialGradient(lamp.x, lamp.y, 2, lamp.x, lamp.y, r);
    const [core, halo] = lamp.color ? neonGlow(lamp.color) : lamp.warm ? KITS.fantasy.lamp : kit.lamp;
    glow.addColorStop(0, withAlpha(core, lampScale));
    glow.addColorStop(0.2, withAlpha(halo, lampScale));
    glow.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = glow;
    g.fillRect(lamp.x - r, lamp.y - r, r * 2, r * 2);
  }
  // Neon signs and strips, drawn after the tint so they stay bright.
  for (const sign of ctx.neon) sign();
  g.restore();
}

function neonGlow(hex) {
  const [r, g, b] = rgbOf(hex);
  return [`rgba(${r},${g},${b},0.95)`, `rgba(${r},${g},${b},0.35)`];
}

function withAlpha(rgba, k) {
  return rgba.replace(/,\s*([\d.]+)\)$/, (_, a) => `,${(Number(a) * k).toFixed(3)})`);
}

function snowOnRoofs(ctx) {
  if (ctx.season !== "winter") return;
  ctx.g.fillStyle = "rgba(240,244,248,0.92)";
  for (const r of ctx.roofs) ctx.g.fillRect(r.x - 4, r.y - 4, r.w + 8, 5);
}

// ================================================================ near layers

/** Beach huts and pavilions for the coast. */
function pavilion(ctx, x, street) {
  const { g } = ctx;
  const w = 220;
  g.fillStyle = "#e8e2d2";
  for (const px of [x + 8, x + w / 2 - 4, x + w - 16]) g.fillRect(px, street - 110, 8, 110);
  g.fillStyle = "#5a6b5e";
  g.beginPath(); g.moveTo(x - 14, street - 108); g.lineTo(x + w / 2, street - 170); g.lineTo(x + w + 14, street - 108); g.fill();
  g.fillStyle = "#e8e2d2";
  g.fillRect(x - 14, street - 112, w + 28, 6);
  ctx.roofs.push({ x, w, y: street - 170 });
}

function gantryCrane(ctx, x, ground) {
  const { g } = ctx;
  const color = "#c9922a";
  g.strokeStyle = color;
  g.lineWidth = 7;
  g.beginPath();
  g.moveTo(x, ground); g.lineTo(x + 20, ground - 330);
  g.moveTo(x + 140, ground); g.lineTo(x + 120, ground - 330);
  g.moveTo(x - 120, ground - 330); g.lineTo(x + 360, ground - 330);
  g.moveTo(x + 20, ground - 330); g.lineTo(x + 70, ground - 400); g.lineTo(x + 120, ground - 330);
  g.moveTo(x + 70, ground - 400); g.lineTo(x + 360, ground - 330);
  g.moveTo(x + 70, ground - 400); g.lineTo(x - 120, ground - 330);
  g.stroke();
  g.lineWidth = 2;
  g.beginPath();
  for (let k = 0; k < 6; k++) { const y = ground - 40 - k * 50; g.moveTo(x + 4, y); g.lineTo(x + 136, y - 40); }
  g.moveTo(x + 240, ground - 330); g.lineTo(x + 240, ground - 180);
  g.stroke();
  g.fillStyle = "#3a3a3a";
  g.fillRect(x + 222, ground - 180, 36, 14);
  ctx.lamps.push({ x: x + 70, y: ground - 400 });
}

function crates(ctx, x, ground) {
  const { g, rand } = ctx;
  for (let row = 0; row < 3; row++) {
    for (let k = 0; k < 4 - row; k++) {
      if (rand() < 0.15) continue;
      const cx = x + k * 64 + row * 32;
      const cy = ground - (row + 1) * 40;
      const color = pick(rand, ["#2a5a8a", "#a8322a", "#c98a2a", "#3a6a3a", "#6a6a6a", "#8a4a2a"]);
      g.fillStyle = color;
      g.fillRect(cx, cy, 62, 38);
      g.fillStyle = "rgba(0,0,0,0.25)";
      for (let xx = cx + 6; xx < cx + 60; xx += 7) g.fillRect(xx, cy + 2, 2, 34);
    }
  }
}

function shipHull(ctx, x, ground, w) {
  const { g, rand } = ctx;
  const hull = pick(rand, ["#2a2e36", "#7a2a22", "#2a4a6a", "#1e3a2a"]);
  g.fillStyle = hull;
  g.beginPath();
  g.moveTo(x, ground - 140); g.lineTo(x + w, ground - 140); g.lineTo(x + w - 40, ground - 20); g.lineTo(x + 20, ground - 20);
  g.fill();
  g.fillStyle = "#b8b4aa";
  g.fillRect(x, ground - 146, w, 8);
  g.fillStyle = "#e8e4dc";
  g.fillRect(x + w * 0.6, ground - 240, w * 0.25, 96);
  for (let yy = ground - 230; yy < ground - 160; yy += 20) {
    for (let xx = x + w * 0.6 + 8; xx < x + w * 0.85 - 12; xx += 16) windowAt(ctx, xx, yy, 8, 8, "#e8e4dc", { panes: "none" });
  }
  g.fillStyle = hull;
  g.fillRect(x + w * 0.66, ground - 290, 22, 50);
  g.fillStyle = "rgba(255,255,255,0.6)";
  for (let xx = x + 20; xx < x + w - 20; xx += 30) { g.beginPath(); g.arc(xx, ground - 110, 3, 0, Math.PI * 2); g.fill(); }
  ctx.roofs.push({ x, w, y: ground - 146 });
}

function rockFace(ctx, top, bottom) {
  const { g, rand, w } = ctx;
  g.fillStyle = "#6a645a";
  g.beginPath();
  g.moveTo(0, bottom);
  for (let x = 0; x <= w; x += 40) g.lineTo(x, top + Math.sin((x / w) * Math.PI * 6) * 30 + range(rand, -20, 20));
  g.lineTo(w, bottom);
  g.fill();
  for (let i = 0; i < 160; i++) {
    const x = rand() * w;
    const y = range(rand, top + 20, bottom);
    g.fillStyle = `rgba(${rand() < 0.5 ? "0,0,0" : "255,250,240"},${range(rand, 0.06, 0.16)})`;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + range(rand, 20, 70), y + range(rand, -10, 10)); g.lineTo(x + range(rand, 10, 40), y + range(rand, 12, 30)); g.fill();
  }
}

const NEAR_AREAS = {
  city(ctx) {
    const street = 580;
    streetOf(ctx, street, () => [(c, x, w, s) => rowhouse(c, x, w, s, { brownstone: c.rand() < 0.4, stories: Math.floor(range(c.rand, 4, 6)) }), 150, 260]);
    for (let x = 90; x < ctx.w - 90; x += 175) if (ctx.rand() < 0.6) tree(ctx, x + range(ctx.rand, -20, 20), street + 30, range(ctx.rand, 230, 300));
    poles(ctx, street + 30, { spacing: 280, top: 210, trolley: true });
  },
  downtown(ctx) {
    const street = 620;
    streetOf(ctx, street, () => (ctx.rand() < 0.75 ? [officeTower, 200, 360] : [(c, x, w, s) => rowhouse(c, x, w, s, { stories: 6, ads: false }), 160, 220]), { gapMin: 6, gapMax: 40 });
    poles(ctx, street, { spacing: 400, top: 380, trolley: true });
  },
  town(ctx) {
    const street = 560;
    streetOf(ctx, street, () => {
      const r = ctx.rand();
      if (r < 0.62) return [woodHouse, 140, 180];
      if (r < 0.85) return [(c, x, w, s) => rowhouse(c, x, w, s, { stories: 3 }), 150, 260];
      return [(c, x, w, s) => tree(c, x + w / 2, s, 220), 80, 120];
    }, { gapMin: 10, gapMax: 34 });
    for (let x = 120; x < ctx.w - 120; x += range(ctx.rand, 300, 700)) tree(ctx, x, 570, range(ctx.rand, 180, 260));
    poles(ctx, street, { top: 130 });
  },
  fantasy(ctx) {
    ctx.fantasy = true;
    const street = 570;
    streetOf(ctx, street, () => (ctx.rand() < 0.86 ? [timberHouse, 130, 190] : [stoneTower, 70, 90]), { gapMin: 4, gapMax: 22 });
    // Lamp posts with lanterns along the street.
    const { g } = ctx;
    for (let x = 160; x < ctx.w; x += 460) {
      g.fillStyle = "#1c1c1c";
      g.fillRect(x - 3, street - 150, 6, 150);
      g.fillRect(x - 3, street - 150, 26, 4);
      g.fillStyle = "#e8c070";
      g.fillRect(x + 16, street - 146, 12, 16);
      ctx.lamps.push({ x: x + 22, y: street - 138, warm: true });
    }
  },
  elevated(ctx) {
    // From an elevated railway: close facades at second-floor height and the el's own girder.
    const street = 820;
    streetOf(ctx, street, () => [(c, x, w, s) => rowhouse(c, x, w, s, { stories: Math.floor(range(c.rand, 4, 7)), shops: false, brownstone: c.rand() < 0.25 }), 160, 280], { gapMin: 0, gapMax: 6 });
    const { g, w } = ctx;
    g.fillStyle = "#33483b";
    g.fillRect(0, 488, w, 70);
    g.strokeStyle = "#22322a";
    g.lineWidth = 5;
    for (let x = 0; x < w; x += 40) { g.beginPath(); g.moveTo(x, 496); g.lineTo(x + 40, 550); g.moveTo(x + 40, 496); g.lineTo(x, 550); g.stroke(); }
    g.fillStyle = "#2a3a31";
    g.fillRect(0, 488, w, 9);
    g.fillRect(0, 548, w, 10);
    g.fillStyle = "#56705f";
    for (let x = 6; x < w; x += 14) { g.fillRect(x, 491, 3, 3); g.fillRect(x, 551, 3, 3); }
    for (let x = 0; x < w; x += 700) {
      g.fillStyle = "#2c3d33";
      g.fillRect(x, 330, 26, 230);
      ctx.lamps.push({ x: x + 13, y: 340 });
    }
  },
  industrial(ctx) {
    const street = 560;
    streetOf(ctx, street, () => (ctx.rand() < 0.7 ? [warehouse, 280, 620] : [oilTank, 180, 240]), { gapMin: 20, gapMax: 120 });
    chainLink(ctx, street + 10);
    poles(ctx, street, { top: 160, spacing: 400 });
  },
  dockside(ctx) {
    const quay = 560;
    const { g, w, rand } = ctx;
    // Ships tied up, cranes over them, crates and bollards along the quay.
    for (let x = 60; x < w - 700; x += range(rand, 900, 1300)) shipHull(ctx, x, quay + 30, range(rand, 520, 700));
    for (let x = 300; x < w - 400; x += 1400) gantryCrane(ctx, x, quay);
    for (let x = 900; x < w - 300; x += range(rand, 700, 1100)) crates(ctx, x, quay);
    g.fillStyle = "#5a5852";
    g.fillRect(0, quay, w, 24);
    g.fillStyle = "#2a2a2a";
    for (let x = 40; x < w; x += 180) { g.fillRect(x, quay - 14, 16, 16); g.fillRect(x - 3, quay - 18, 22, 5); }
    for (let x = 0; x < w; x += 350) ctx.lamps.push({ x, y: quay - 160 });
    for (let x = 0; x < w; x += 350) { g.fillStyle = "#3a3d3a"; g.fillRect(x - 3, quay - 160, 6, 160); }
  },
  suburb(ctx) {
    const street = 560;
    streetOf(ctx, street, () => (ctx.rand() < 0.45 ? [house, 160, 220] : [emptyLot, 120, 260]), { gapMin: 60, gapMax: 160 });
    for (let x = 40; x < ctx.w - 40; x += range(ctx.rand, 70, 150)) tree(ctx, x, street + 40, range(ctx.rand, 220, 360));
    const { g } = ctx;
    for (let x = 0; x < ctx.w; x += 18) {
      g.fillStyle = shade("#8a877e", range(ctx.rand, -25, 15));
      g.beginPath(); g.ellipse(x + 9, street + 22, 11, 8, 0, 0, Math.PI * 2); g.fill();
    }
  },
  countryside(ctx) {
    const ground = 540;
    const { g, w, rand } = ctx;
    // A farmhouse, a barn and silo, haystacks, a few trees and a fence along the line.
    for (let x = 200; x < w - 600; x += range(rand, 1000, 1400)) {
      if (rand() < 0.5) { barn(ctx, x, 200, ground); silo(ctx, x + 230, ground); } else house(ctx, x, 190, ground + 14);
    }
    for (let x = 60; x < w - 60; x += range(rand, 260, 520)) tree(ctx, x, ground + 20, range(rand, 200, 300));
    for (let x = 500; x < w - 100; x += range(rand, 500, 900)) {
      g.fillStyle = ctx.season === "winter" ? "#c9c2b0" : "#c9a54a";
      g.beginPath(); g.ellipse(x, ground - 20, 34, 26, 0, Math.PI, 0); g.fill();
    }
    woodFence(ctx, ground + 14);
  },
  forest(ctx) {
    const ground = 560;
    const { w, rand } = ctx;
    // Dense woods right up to the line: pines and broadleaf trees in two rows.
    for (let x = -20; x < w + 20; x += range(rand, 40, 80)) tree(ctx, x, ground - 30, range(rand, 340, 460), { pine: rand() < 0.6 });
    for (let x = 0; x < w; x += range(rand, 50, 90)) tree(ctx, x, ground + 30, range(rand, 260, 380), { pine: rand() < 0.5 });
  },
  mountains(ctx) {
    // A rock cutting beside the line, with pines clinging to the top.
    const { w, rand } = ctx;
    rockFace(ctx, range(rand, 180, 260), 941);
    for (let x = 20; x < w; x += range(rand, 90, 200)) tree(ctx, x, 220 + range(rand, -20, 30), range(rand, 140, 220), { pine: true });
  },
  coast(ctx) {
    const street = 540;
    const { g, rand, w } = ctx;
    for (let x = 80; x < w - 260;) {
      if (rand() < 0.5) pavilion(ctx, x, street); else woodHouse(ctx, x, 150, street);
      x += range(rand, 380, 700);
    }
    g.fillStyle = "#c9b98f";
    g.fillRect(0, street, w, 60);
    g.strokeStyle = "#6f7a4a";
    g.lineWidth = 1.2;
    for (let x = 0; x < w; x += 5) { g.beginPath(); g.moveTo(x, street + 4); g.lineTo(x + range(rand, -6, 6), street - range(rand, 10, 30)); g.stroke(); }
    g.fillStyle = "#8a7454";
    for (let x = 0; x < w; x += 24) g.fillRect(x, street - 34, 4, 38);
    g.fillRect(0, street - 30, w, 3);
    poles(ctx, street, { top: 200, spacing: 700 });
  },
  bridge(ctx) {
    // A steel truss bridge: girders and diagonals rushing past over the water.
    const { g, w } = ctx;
    const deck = 520;
    const topChord = 120;
    const bay = 350;
    g.strokeStyle = "#3d4a52";
    g.lineWidth = 12;
    g.beginPath();
    g.moveTo(0, topChord); g.lineTo(w, topChord);
    g.moveTo(0, deck); g.lineTo(w, deck);
    for (let x = 0; x < w; x += bay) {
      g.moveTo(x, topChord); g.lineTo(x, deck);
      g.moveTo(x, topChord); g.lineTo(x + bay / 2, deck);
      g.moveTo(x + bay, topChord); g.lineTo(x + bay / 2, deck);
    }
    g.stroke();
    g.fillStyle = "#56656e";
    for (let x = 0; x < w; x += bay) { g.fillRect(x - 10, topChord - 10, 20, 20); g.fillRect(x - 10, deck - 10, 20, 20); }
    g.fillStyle = "#2c353b";
    g.fillRect(0, deck, w, 40);
    g.fillStyle = "#4a5258";
    for (let x = 0; x < w; x += 24) g.fillRect(x, deck - 52, 4, 52);
    g.fillRect(0, deck - 54, w, 5);
    for (let x = bay / 2; x < w; x += bay * 2) ctx.lamps.push({ x, y: topChord + 30 });
  }
};

// ================================================================ theme pieces

/** A faded advertisement painted straight onto a brick wall. */
function paintedAd(ctx, x, y, w) {
  const { g, rand } = ctx;
  const lines = pick(rand, [["OXO", "CUBES"], ["BOVRIL"], ["PEARS", "SOAP"], ["BEECHAM'S", "PILLS"], ["COCOA"], ["DRINK", "STOUT"], ["LIVERY", "STABLES"]]);
  g.fillStyle = "rgba(30,24,20,0.35)";
  g.fillRect(x, y, w, 26 * lines.length + 10);
  g.fillStyle = "rgba(240,230,205,0.55)";
  g.font = "bold 22px Georgia, serif";
  g.textAlign = "center";
  g.textBaseline = "top";
  lines.forEach((t, i) => g.fillText(t, x + w / 2, y + 6 + i * 26, w - 10));
}

/** A tall brick chimney with a plume of smoke leaning downwind. */
function smokestack(ctx, x, base, h, { plume = true } = {}) {
  const { g, rand } = ctx;
  const top = base - h;
  g.fillStyle = brickPattern(g, "#6a3a2a", rand);
  g.beginPath(); g.moveTo(x - 16, base); g.lineTo(x - 10, top); g.lineTo(x + 10, top); g.lineTo(x + 16, base); g.fill();
  g.fillStyle = "#2a201a";
  g.fillRect(x - 13, top - 6, 26, 8);
  if (!plume) return;
  for (let i = 0; i < 9; i++) {
    const px = x + i * 26 + range(rand, -6, 6);
    const py = top - 20 - i * 14 + range(rand, -8, 8);
    const r = 14 + i * 7;
    const puff = g.createRadialGradient(px, py, 0, px, py, r);
    const tone = 60 + i * 9;
    puff.addColorStop(0, `rgba(${tone},${tone - 4},${tone - 8},${0.55 - i * 0.05})`);
    puff.addColorStop(1, `rgba(${tone},${tone},${tone},0)`);
    g.fillStyle = puff;
    g.fillRect(px - r, py - r, r * 2, r * 2);
  }
}

/** A gasometer: a riveted drum inside an iron lattice frame. */
function gasometer(ctx, x, w, base) {
  const { g } = ctx;
  const h = w * 0.7;
  g.fillStyle = "#5a5650";
  g.fillRect(x + 10, base - h * 0.8, w - 20, h * 0.8);
  g.fillStyle = "rgba(0,0,0,0.2)";
  for (let y = base - h * 0.8 + 10; y < base; y += 16) g.fillRect(x + 10, y, w - 20, 2);
  g.strokeStyle = "#2e2a26";
  g.lineWidth = 4;
  g.beginPath();
  for (let k = 0; k <= 5; k++) { const px = x + (w * k) / 5; g.moveTo(px, base); g.lineTo(px, base - h); }
  g.moveTo(x, base - h); g.lineTo(x + w, base - h);
  g.moveTo(x, base - h * 0.5); g.lineTo(x + w, base - h * 0.5);
  g.stroke();
  ctx.roofs.push({ x, w, y: base - h });
}

/** A steamship tied up: dark hull, white superstructure, funnels with smoke. */
function steamShip(ctx, x, ground, w) {
  const { g } = ctx;
  g.fillStyle = "#1e1c1c";
  g.beginPath(); g.moveTo(x, ground - 130); g.lineTo(x + w, ground - 130); g.lineTo(x + w - 30, ground - 20); g.lineTo(x + 20, ground - 20); g.fill();
  g.fillStyle = "#8a2a20";
  g.fillRect(x + 20, ground - 40, w - 50, 14);
  g.fillStyle = "#e8e2d2";
  g.fillRect(x + w * 0.3, ground - 190, w * 0.4, 60);
  for (let xx = x + w * 0.3 + 8; xx < x + w * 0.7 - 10; xx += 16) windowAt(ctx, xx, ground - 178, 8, 8, "#e8e2d2", { panes: "none" });
  for (const fx of [x + w * 0.4, x + w * 0.55]) {
    g.fillStyle = "#c8a030";
    g.fillRect(fx, ground - 270, 30, 80);
    g.fillStyle = "#1a1a1a";
    g.fillRect(fx, ground - 270, 30, 14);
    smokestack(ctx, fx + 15, ground - 270, 0, { plume: true });
  }
  g.strokeStyle = "#2a2622";
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(x + 30, ground - 130); g.lineTo(x + 40, ground - 300); g.lineTo(x + w - 40, ground - 130); g.stroke();
  ctx.roofs.push({ x, w, y: ground - 130 });
}

/** A timber derrick crane on the quay. */
function derrick(ctx, x, ground) {
  const { g } = ctx;
  g.strokeStyle = "#4a3a2a";
  g.lineWidth = 8;
  g.beginPath(); g.moveTo(x, ground); g.lineTo(x + 20, ground - 260); g.moveTo(x + 50, ground); g.lineTo(x + 20, ground - 260); g.stroke();
  g.lineWidth = 6;
  g.beginPath(); g.moveTo(x + 20, ground - 200); g.lineTo(x + 220, ground - 300); g.stroke();
  g.lineWidth = 2;
  g.strokeStyle = "#1a1a1a";
  g.beginPath(); g.moveTo(x + 20, ground - 260); g.lineTo(x + 220, ground - 300); g.lineTo(x + 220, ground - 170); g.stroke();
  g.fillStyle = "#6a4a2a";
  g.fillRect(x + 205, ground - 170, 30, 24);
}

/** A sailing ship at the quay: hull, masts and furled sails. */
function sailingShip(ctx, x, ground, w) {
  const { g, rand } = ctx;
  g.fillStyle = pick(rand, ["#4a2e1e", "#3a2618", "#5a3a22"]);
  g.beginPath(); g.moveTo(x - 20, ground - 120); g.lineTo(x + w + 30, ground - 135); g.lineTo(x + w - 20, ground - 20); g.lineTo(x + 20, ground - 20); g.fill();
  g.fillStyle = "#d8b860";
  g.fillRect(x, ground - 110, w, 6);
  for (let xx = x + 40; xx < x + w - 20; xx += 60) { g.fillStyle = "#1a1a1a"; g.fillRect(xx, ground - 90, 14, 12); }
  for (const [mx, mh] of [[x + w * 0.25, 360], [x + w * 0.55, 420], [x + w * 0.82, 320]]) {
    g.fillStyle = "#3a2a1a";
    g.fillRect(mx - 4, ground - 120 - mh, 8, mh);
    for (const [yy, half] of [[mh * 0.25, 70], [mh * 0.5, 60], [mh * 0.75, 48]]) {
      g.fillRect(mx - half, ground - 120 - mh + yy, half * 2, 5);
      g.fillStyle = "#e6dcc4";
      g.beginPath(); g.ellipse(mx, ground - 120 - mh + yy + 6, half * 0.9, 8, 0, 0, Math.PI); g.fill();
      g.fillStyle = "#3a2a1a";
    }
  }
  g.strokeStyle = "rgba(30,24,18,0.8)";
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(x - 20, ground - 120); g.lineTo(x + w * 0.25, ground - 480); g.lineTo(x + w * 0.55, ground - 540); g.lineTo(x + w * 0.82, ground - 440); g.lineTo(x + w + 30, ground - 135); g.stroke();
  ctx.roofs.push({ x, w, y: ground - 135 });
}

/** A windmill: tapered tower, cap and four sails. */
function windmill(ctx, x, ground, h = 300) {
  const { g, rand } = ctx;
  g.fillStyle = pick(rand, ["#e8e0cc", "#cfc4ac", "#8a7a64"]);
  g.beginPath(); g.moveTo(x - 50, ground); g.lineTo(x - 30, ground - h); g.lineTo(x + 30, ground - h); g.lineTo(x + 50, ground); g.fill();
  g.fillStyle = "#4a3a2c";
  g.beginPath(); g.moveTo(x - 36, ground - h); g.lineTo(x, ground - h - 40); g.lineTo(x + 36, ground - h); g.fill();
  windowAt(ctx, x - 8, ground - h * 0.6, 16, 22, "#4a3a2c", { panes: "none" });
  g.save();
  g.translate(x, ground - h - 10);
  g.rotate(range(rand, 0, Math.PI / 2));
  for (let k = 0; k < 4; k++) {
    g.rotate(Math.PI / 2);
    g.fillStyle = "#3a2e22";
    g.fillRect(-3, 0, 6, 160);
    g.fillStyle = "rgba(230,220,200,0.85)";
    g.fillRect(4, 30, 26, 126);
  }
  g.restore();
  ctx.roofs.push({ x: x - 36, w: 72, y: ground - h - 40 });
}

/** A thatched cottage with whitewashed walls. */
function cottage(ctx, x, w, ground) {
  const { g, rand } = ctx;
  const top = ground - 100;
  g.fillStyle = pick(rand, ["#ece4d0", "#e2d6bc", "#d8cfbf"]);
  g.fillRect(x, top, w, 100);
  g.fillStyle = "#3a2a1a";
  g.fillRect(x + w / 2 - 12, top + 40, 24, 60);
  windowAt(ctx, x + 14, top + 34, 20, 22, "#3a2a1a", { panes: "lead" });
  windowAt(ctx, x + w - 34, top + 34, 20, 22, "#3a2a1a", { panes: "lead" });
  g.fillStyle = pick(rand, ["#a08850", "#8a7444", "#b09858"]);
  g.beginPath();
  g.moveTo(x - 16, top + 10);
  g.quadraticCurveTo(x + w / 2, top - 110, x + w + 16, top + 10);
  g.fill();
  g.fillStyle = "rgba(0,0,0,0.15)";
  for (let y = top - 50; y < top + 10; y += 8) g.fillRect(x - 8, y, w + 16, 1.5);
  chimney(g, x + w * 0.75, top - 30, rand);
  ctx.roofs.push({ x, w, y: top - 60 });
}

/** A stone forge: heavy walls, a chimney, and furnace mouths glowing from inside. */
function forge(ctx, x, w, street) {
  const { g, rand } = ctx;
  const h = range(rand, 170, 240);
  g.fillStyle = stonePattern(g, "#6a6258", rand);
  g.fillRect(x, street - h, w, h);
  g.fillStyle = "#3a3028";
  g.beginPath(); g.moveTo(x - 10, street - h); g.lineTo(x + w / 2, street - h - 60); g.lineTo(x + w + 10, street - h); g.fill();
  for (let fx = x + 24; fx < x + w - 50; fx += 90) {
    g.fillStyle = "#140c08";
    g.beginPath(); g.moveTo(fx, street); g.lineTo(fx, street - 50); g.arc(fx + 25, street - 50, 25, Math.PI, 0); g.lineTo(fx + 50, street); g.fill();
    const mouth = { x: fx + 25, y: street - 40 };
    ctx.neon.push(() => {
      const glow = g.createRadialGradient(mouth.x, mouth.y, 2, mouth.x, mouth.y, 70);
      glow.addColorStop(0, "rgba(255,170,60,0.95)");
      glow.addColorStop(0.3, "rgba(255,110,30,0.45)");
      glow.addColorStop(1, "rgba(255,80,20,0)");
      g.fillStyle = glow;
      g.fillRect(mouth.x - 70, mouth.y - 70, 140, 140);
    });
  }
  smokestack(ctx, x + w - 40, street - h, 150);
  // Brass pipes along the wall.
  g.strokeStyle = "#b08840";
  g.lineWidth = 6;
  g.beginPath(); g.moveTo(x, street - h + 30); g.lineTo(x + w, street - h + 30); g.moveTo(x + w * 0.3, street - h + 30); g.lineTo(x + w * 0.3, street - 70); g.stroke();
  ctx.roofs.push({ x, w, y: street - h - 60 });
}

/** A crenellated stone parapet with lantern posts, for fantasy bridges and viaducts. */
function stoneParapet(ctx, top) {
  const { g, w, rand } = ctx;
  g.fillStyle = stonePattern(g, "#7a7062", rand);
  g.fillRect(0, top, w, 120);
  g.fillStyle = "#6a6052";
  for (let x = 0; x < w; x += 70) g.fillRect(x, top - 26, 40, 28);
  for (let x = 175; x < w; x += 700) {
    g.fillStyle = "#1c1c1c";
    g.fillRect(x - 3, top - 130, 6, 104);
    g.fillRect(x - 3, top - 130, 22, 4);
    g.fillStyle = "#e8c070";
    g.fillRect(x + 12, top - 126, 12, 16);
    ctx.lamps.push({ x: x + 18, y: top - 118, warm: true });
  }
}

/** A future tower: dark glass, a grid of lit windows, neon edges and a glowing sign. */
function neonTower(ctx, x, w, street, { tall = false } = {}) {
  const { g, rand } = ctx;
  const top = street - (tall ? range(rand, 600, 820) : range(rand, 300, 520));
  const body = g.createLinearGradient(x, 0, x + w, 0);
  body.addColorStop(0, "#14181f");
  body.addColorStop(0.5, "#232a35");
  body.addColorStop(1, "#11141a");
  g.fillStyle = body;
  g.fillRect(x, top, w, street - top);
  for (let y = top + 12; y < street - 40; y += 18) {
    for (let xx = x + 6; xx < x + w - 14; xx += 16) {
      g.fillStyle = "rgba(120,160,200,0.18)";
      g.fillRect(xx, y, 10, 10);
      ctx.windows.push({ x: xx, y, w: 10, h: 10, blind: 0 });
    }
  }
  const edge = pick(rand, NEON);
  ctx.neon.push(() => {
    g.fillStyle = edge;
    g.fillRect(x, top, 3, street - top);
    g.fillRect(x + w - 3, top, 3, street - top);
    g.fillRect(x, top, w, 3);
  });
  if (rand() < 0.75) holoSign(ctx, x + w * 0.15, top + range(rand, 40, (street - top) * 0.5), w * 0.7);
  ctx.shops.push({ x: x + 6, y: street - 46, w: w - 12, h: 40 });
  g.fillStyle = "#0c0e12";
  g.fillRect(x, street - 50, w, 50);
  ctx.roofs.push({ x, w, y: top });
}

/** A neon sign: a glowing word in a glowing frame. */
function holoSign(ctx, x, y, w) {
  const { g, rand } = ctx;
  const color = pick(rand, NEON);
  const word = pick(rand, ctx.kit.shops);
  const vertical = rand() < 0.35;
  ctx.neon.push(() => {
    g.save();
    g.strokeStyle = color;
    g.fillStyle = color;
    g.shadowColor = color;
    g.shadowBlur = 18;
    g.lineWidth = 3;
    g.font = "bold 26px 'Courier New', monospace";
    g.textBaseline = "middle";
    g.textAlign = "center";
    if (vertical) {
      const h = word.length * 28 + 16;
      g.strokeRect(x, y, 40, h);
      [...word].forEach((ch, i) => g.fillText(ch, x + 20, y + 22 + i * 28));
    } else {
      g.strokeRect(x, y, w, 44);
      g.fillText(word, x + w / 2, y + 23, w - 12);
    }
    g.restore();
  });
}

/** Stacked capsule homes with round windows. */
function capsuleStack(ctx, x, w, street) {
  const { g, rand } = ctx;
  const rows = Math.floor(range(rand, 4, 7));
  const pods = Math.max(1, Math.floor(w / 60));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < pods; c++) {
      const px = x + c * (w / pods);
      const py = street - (r + 1) * 64;
      g.fillStyle = pick(rand, ["#d8dde2", "#c4ccd4", "#e6e2da", "#b8c2cc"]);
      g.fillRect(px + 2, py + 2, w / pods - 4, 60);
      g.fillStyle = "#1a2028";
      g.beginPath(); g.arc(px + (w / pods) / 2, py + 30, 14, 0, Math.PI * 2); g.fill();
      ctx.windows.push({ x: px + (w / pods) / 2 - 10, y: py + 20, w: 20, h: 20, blind: 0 });
    }
  }
  ctx.roofs.push({ x, w, y: street - rows * 64 });
}

/** A dome home with a ring of light. */
function domeHome(ctx, x, w, ground) {
  const { g } = ctx;
  const r = w / 2;
  g.fillStyle = "#dfe6ea";
  g.beginPath(); g.ellipse(x + r, ground, r, r * 0.8, 0, Math.PI, 0); g.fill();
  g.fillStyle = "rgba(0,0,0,0.12)";
  g.beginPath(); g.ellipse(x + r * 1.2, ground, r * 0.8, r * 0.7, 0, Math.PI, 0); g.fill();
  windowAt(ctx, x + r - 30, ground - r * 0.45, 60, 18, "#9aa6ae", { panes: "none" });
  const ring = pick(ctx.rand, NEON.slice(0, 2));
  ctx.neon.push(() => {
    g.strokeStyle = ring;
    g.lineWidth = 3;
    g.beginPath(); g.ellipse(x + r, ground - 6, r * 0.98, 8, 0, 0, Math.PI * 2); g.stroke();
  });
  ctx.roofs.push({ x, w, y: ground - r * 0.8 });
}

/** A wind turbine: tall white mast and three blades. */
function windTurbine(ctx, x, ground, h = 420) {
  const { g, rand } = ctx;
  g.fillStyle = "#e8ecee";
  g.beginPath(); g.moveTo(x - 7, ground); g.lineTo(x - 3, ground - h); g.lineTo(x + 3, ground - h); g.lineTo(x + 7, ground); g.fill();
  g.fillRect(x - 10, ground - h - 6, 28, 12);
  g.save();
  g.translate(x, ground - h);
  g.rotate(range(rand, 0, Math.PI));
  for (let k = 0; k < 3; k++) {
    g.rotate((Math.PI * 2) / 3);
    g.beginPath(); g.moveTo(-4, 0); g.lineTo(0, -h * 0.42); g.lineTo(5, 0); g.fill();
  }
  g.restore();
  ctx.lamps.push({ x, y: ground - h - 4, color: "#ff3030" });
}

/** Rows of solar panels catching the sky. */
function solarField(ctx, ground) {
  const { g, w } = ctx;
  for (let x = 0; x < w; x += 70) {
    const panel = g.createLinearGradient(x, ground - 60, x + 60, ground - 20);
    panel.addColorStop(0, "#5a7a9a");
    panel.addColorStop(1, "#1a2a44");
    g.fillStyle = panel;
    g.beginPath(); g.moveTo(x, ground - 20); g.lineTo(x + 14, ground - 60); g.lineTo(x + 64, ground - 60); g.lineTo(x + 50, ground - 20); g.fill();
    g.fillStyle = "#2a2e32";
    g.fillRect(x + 28, ground - 22, 4, 22);
  }
}

/** Future industry: tanks, pipes, vents and glowing warning strips. */
function fabricator(ctx, x, w, street) {
  const { g, rand } = ctx;
  const h = range(rand, 160, 280);
  g.fillStyle = "#3a4048";
  g.fillRect(x, street - h, w, h);
  g.fillStyle = "rgba(255,255,255,0.05)";
  for (let y = street - h; y < street; y += 24) g.fillRect(x, y, w, 2);
  for (let k = 0; k < 2; k++) {
    const tx = x + 20 + k * (w / 2);
    g.fillStyle = "#8a96a2";
    g.fillRect(tx, street - h - 90, 60, 90);
    g.beginPath(); g.ellipse(tx + 30, street - h - 90, 30, 10, 0, Math.PI, 0); g.fill();
    const c = pick(rand, NEON);
    ctx.neon.push(() => { g.fillStyle = c; g.fillRect(tx + 6, street - h - 60, 48, 4); });
  }
  g.strokeStyle = "#6a747e";
  g.lineWidth = 8;
  g.beginPath(); g.moveTo(x, street - h + 40); g.lineTo(x + w, street - h + 40); g.stroke();
  // Warning stripes at the base.
  for (let xx = x; xx < x + w; xx += 24) {
    g.fillStyle = (xx / 24) % 2 < 1 ? "#e8b020" : "#1a1a1a";
    g.fillRect(xx, street - 20, 12, 20);
  }
  ctx.roofs.push({ x, w, y: street - h - 90 });
}

/** The theme-specific versions of each scene; anything missing falls back to NEAR_AREAS. */
const NEAR_THEMED = {
  industrial: {
    city(ctx) {
      const street = 580;
      streetOf(ctx, street, () => [(c, x, w, s) => rowhouse(c, x, w, s, { brownstone: c.rand() < 0.3, stories: Math.floor(range(c.rand, 3, 5)) }), 150, 260]);
      poles(ctx, street, { spacing: 350, top: 170 });
    },
    downtown(ctx) {
      const street = 620;
      streetOf(ctx, street, () => [(c, x, w, s) => rowhouse(c, x, w, s, { brownstone: c.rand() < 0.6, stories: Math.floor(range(c.rand, 6, 9)), ads: false }), 180, 300], { gapMin: 0, gapMax: 10 });
      poles(ctx, street, { spacing: 350, top: 200 });
    },
    elevated(ctx) {
      NEAR_AREAS.elevated(ctx);
    },
    industrial(ctx) {
      const street = 560;
      const { rand, w } = ctx;
      streetOf(ctx, street, () => (rand() < 0.7 ? [warehouse, 280, 560] : [(c, x, bw, s) => gasometer(c, x, bw, s), 200, 260]), { gapMin: 30, gapMax: 140 });
      for (let x = 160; x < w - 100; x += range(rand, 380, 700)) smokestack(ctx, x, street - 60, range(rand, 300, 420));
      poles(ctx, street, { spacing: 400, top: 180 });
    },
    dockside(ctx) {
      const quay = 560;
      const { g, w, rand } = ctx;
      for (let x = 60; x < w - 700; x += range(rand, 900, 1300)) steamShip(ctx, x, quay + 30, range(rand, 520, 680));
      for (let x = 500; x < w - 300; x += 1400) derrick(ctx, x, quay);
      g.fillStyle = "#4a4640";
      g.fillRect(0, quay, w, 24);
      for (let x = 120; x < w; x += 233) {
        g.fillStyle = "#5a4028";
        g.beginPath(); g.ellipse(x, quay - 18, 14, 18, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#2a2018";
        g.fillRect(x - 14, quay - 26, 28, 3);
        g.fillRect(x - 14, quay - 12, 28, 3);
      }
      for (let x = 175; x < w; x += 350) gasLamp(ctx, x, quay);
    },
    suburb(ctx) {
      const street = 560;
      streetOf(ctx, street, () => (ctx.rand() < 0.5 ? [house, 160, 220] : [emptyLot, 100, 220]), { gapMin: 60, gapMax: 140 });
      for (let x = 60; x < ctx.w - 60; x += range(ctx.rand, 120, 220)) tree(ctx, x, street + 40, range(ctx.rand, 220, 320));
      poles(ctx, street, { spacing: 700, top: 160 });
    },
    countryside(ctx) {
      NEAR_AREAS.countryside(ctx);
      poles(ctx, 560, { spacing: 700, top: 180 });
    },
    coast(ctx) {
      NEAR_AREAS.coast(ctx);
    }
  },

  fantasy: {
    city(ctx) {
      NEAR_AREAS.fantasy(ctx);
    },
    downtown(ctx) {
      const street = 600;
      streetOf(ctx, street, () => (ctx.rand() < 0.65 ? [timberHouse, 140, 200] : [stoneTower, 80, 110]), { gapMin: 0, gapMax: 12 });
    },
    town(ctx) {
      const street = 570;
      streetOf(ctx, street, () => (ctx.rand() < 0.55 ? [timberHouse, 130, 180] : [cottage, 140, 180]), { gapMin: 10, gapMax: 40 });
      for (let x = 200; x < ctx.w - 200; x += range(ctx.rand, 400, 700)) tree(ctx, x, street + 20, range(ctx.rand, 200, 260));
    },
    elevated(ctx) {
      // On a stone viaduct above the timber town.
      const street = 820;
      streetOf(ctx, street, () => [timberHouse, 140, 200], { gapMin: 0, gapMax: 10 });
      stoneParapet(ctx, 500);
    },
    industrial(ctx) {
      const street = 560;
      streetOf(ctx, street, () => (ctx.rand() < 0.7 ? [forge, 260, 420] : [timberHouse, 140, 180]), { gapMin: 20, gapMax: 80 });
    },
    dockside(ctx) {
      const quay = 560;
      const { g, w, rand } = ctx;
      for (let x = 60; x < w - 600; x += range(rand, 800, 1200)) sailingShip(ctx, x, quay + 30, range(rand, 460, 600));
      for (let x = 700; x < w - 300; x += 1400) derrick(ctx, x, quay);
      g.fillStyle = "#5a4630";
      g.fillRect(0, quay, w, 24);
      g.fillStyle = "#3a2a1a";
      for (let x = 0; x < w; x += 140) g.fillRect(x, quay, 12, 60);
      for (let x = 350; x < w; x += 700) {
        g.fillStyle = "#1c1c1c";
        g.fillRect(x - 3, quay - 140, 6, 140);
        g.fillStyle = "#e8c070";
        g.fillRect(x - 6, quay - 150, 12, 14);
        ctx.lamps.push({ x, y: quay - 143, warm: true });
      }
    },
    suburb(ctx) {
      const street = 560;
      streetOf(ctx, street, () => (ctx.rand() < 0.5 ? [cottage, 140, 190] : [emptyLot, 100, 220]), { gapMin: 50, gapMax: 140 });
      for (let x = 40; x < ctx.w - 40; x += range(ctx.rand, 90, 180)) tree(ctx, x, street + 40, range(ctx.rand, 200, 320));
      woodFence(ctx, street + 14);
    },
    countryside(ctx) {
      const ground = 540;
      const { w, rand } = ctx;
      for (let x = 300; x < w - 300; x += range(rand, 900, 1300)) windmill(ctx, x, ground, range(rand, 260, 340));
      for (let x = 900; x < w - 400; x += range(rand, 1100, 1500)) cottage(ctx, x, 160, ground);
      for (let x = 60; x < w - 60; x += range(rand, 300, 600)) tree(ctx, x, ground + 20, range(rand, 200, 280));
      woodFence(ctx, ground + 14);
    },
    coast(ctx) {
      const street = 540;
      const { g, rand, w } = ctx;
      for (let x = 100; x < w - 260; x += range(rand, 420, 760)) cottage(ctx, x, 150, street);
      g.fillStyle = "#c9b98f";
      g.fillRect(0, street, w, 60);
    },
    bridge(ctx) {
      stoneParapet(ctx, 470);
    }
  },

  future: {
    city(ctx) {
      const street = 600;
      streetOf(ctx, street, () => [neonTower, 150, 240], { gapMin: 4, gapMax: 30 });
      poles(ctx, street, { spacing: 350, top: 260 });
    },
    downtown(ctx) {
      const street = 640;
      streetOf(ctx, street, () => [(c, x, w, s) => neonTower(c, x, w, s, { tall: true }), 220, 360], { gapMin: 10, gapMax: 50 });
      // Skybridges between the towers.
      const { g, w, rand } = ctx;
      for (let y = 200; y < 440; y += 120) {
        g.fillStyle = "rgba(160,200,230,0.35)";
        g.fillRect(0, y, w, 16);
        const c = pick(rand, NEON);
        ctx.neon.push(() => { g.fillStyle = c; g.fillRect(0, y + 14, w, 2); });
      }
    },
    town(ctx) {
      const street = 580;
      streetOf(ctx, street, () => (ctx.rand() < 0.7 ? [capsuleStack, 180, 280] : [neonTower, 140, 200]), { gapMin: 10, gapMax: 40 });
      poles(ctx, street, { spacing: 350, top: 240 });
    },
    elevated(ctx) {
      // On a maglev guideway between towers.
      const street = 820;
      streetOf(ctx, street, () => [neonTower, 170, 260], { gapMin: 6, gapMax: 30 });
      const { g, w, rand } = ctx;
      g.fillStyle = "#d8dee4";
      g.fillRect(0, 492, w, 56);
      g.fillStyle = "rgba(0,0,0,0.15)";
      g.fillRect(0, 530, w, 18);
      const c = pick(rand, NEON.slice(0, 2));
      ctx.neon.push(() => { g.fillStyle = c; g.fillRect(0, 500, w, 3); });
    },
    industrial(ctx) {
      const street = 560;
      streetOf(ctx, street, () => [fabricator, 280, 480], { gapMin: 30, gapMax: 120 });
      poles(ctx, street, { spacing: 400, top: 260 });
    },
    dockside(ctx) {
      NEAR_AREAS.dockside(ctx);
      const { g, w } = ctx;
      for (let x = 0; x < w; x += 350) ctx.lamps.push({ x, y: 400, color: NEON[0] });
      ctx.neon.push(() => { g.fillStyle = NEON[1]; g.fillRect(0, 556, w, 3); });
    },
    suburb(ctx) {
      const street = 560;
      streetOf(ctx, street, () => (ctx.rand() < 0.55 ? [(c, x, bw, s) => domeHome(c, x, bw, s), 160, 220] : [emptyLot, 100, 200]), { gapMin: 50, gapMax: 140 });
      for (let x = 60; x < ctx.w - 60; x += range(ctx.rand, 160, 300)) tree(ctx, x, street + 40, range(ctx.rand, 180, 260));
      poles(ctx, street, { spacing: 700, top: 300 });
    },
    countryside(ctx) {
      solarField(ctx, 560);
      for (let x = 200; x < ctx.w; x += 700) windTurbine(ctx, x, 540, range(ctx.rand, 380, 460));
    },
    coast(ctx) {
      NEAR_AREAS.coast(ctx);
      const { g, w } = ctx;
      ctx.neon.push(() => { g.fillStyle = NEON[0]; g.fillRect(0, 538, w, 3); });
    },
    bridge(ctx) {
      // A cable-stayed bridge: a tall pylon, fans of cables, a lit deck.
      const { g, w } = ctx;
      const deck = 520;
      for (const px of [700, 2100]) {
        g.fillStyle = "#cfd6dc";
        g.fillRect(px - 16, 0, 32, deck + 40);
        g.strokeStyle = "rgba(200,210,220,0.9)";
        g.lineWidth = 2;
        for (let k = 1; k <= 8; k++) {
          g.beginPath(); g.moveTo(px, 40 + k * 18); g.lineTo(px - k * 80, deck); g.moveTo(px, 40 + k * 18); g.lineTo(px + k * 80, deck); g.stroke();
        }
      }
      g.fillStyle = "#2a3038";
      g.fillRect(0, deck, w, 40);
      ctx.neon.push(() => { g.fillStyle = NEON[0]; g.fillRect(0, deck, w, 3); g.fillStyle = NEON[1]; g.fillRect(0, deck + 36, w, 2); });
    }
  }
};

export function drawNear(area, theme, tod, season, variant, sky = "clear") {
  const [c, g] = makeCanvas(NEAR.w, NEAR.h);
  const ctx = {
    g, w: NEAR.w, h: NEAR.h, rand: seeded(hash(`${theme}:${area}:${variant}`)), tod, sky, season, theme,
    kit: KITS[theme] ?? KITS.modern, windows: [], shops: [], lamps: [], roofs: [], neon: []
  };
  (NEAR_THEMED[theme]?.[area] ?? NEAR_AREAS[area] ?? NEAR_AREAS.city)(ctx);
  snowOnRoofs(ctx);
  tint(ctx);
  return c;
}

// ================================================================ far layers

/** Distinctive but generic tower silhouettes for skylines. Returns aviation-beacon spots. */
function skylineTower(g, kind, x, base, color, tod) {
  switch (kind) {
    case "spire": {
      g.fillStyle = color;
      g.fillRect(x, base - 520, 80, 520);
      g.fillRect(x + 12, base - 580, 56, 60);
      g.beginPath(); g.moveTo(x + 18, base - 580); g.lineTo(x + 40, base - 700); g.lineTo(x + 62, base - 580); g.fill();
      return [[x + 40, base - 700]];
    }
    case "slab": {
      g.fillStyle = tod === "day" ? mix(color, "#9db6c9", 0.35) : color;
      g.fillRect(x, base - 600, 60, 600);
      g.fillStyle = "rgba(255,255,255,0.12)";
      g.fillRect(x + 4, base - 596, 6, 596);
      g.fillStyle = color;
      g.fillRect(x + 28, base - 640, 3, 40);
      return [[x + 29, base - 640]];
    }
    case "deco": {
      g.fillStyle = color;
      for (const [inset, h] of [[0, 380], [10, 440], [20, 490], [30, 530]]) g.fillRect(x + inset, base - h, 90 - inset * 2, h);
      g.fillRect(x + 43, base - 600, 4, 70);
      return [[x + 45, base - 600]];
    }
    case "dome": {
      g.fillStyle = color;
      g.fillRect(x, base - 160, 160, 160);
      g.fillRect(x + 50, base - 210, 60, 50);
      g.beginPath(); g.ellipse(x + 80, base - 210, 40, 40, 0, Math.PI, 0); g.fill();
      g.fillRect(x + 77, base - 270, 6, 24);
      return [];
    }
    case "clock": {
      g.fillStyle = color;
      g.fillRect(x, base - 360, 46, 360);
      g.beginPath(); g.moveTo(x - 2, base - 360); g.lineTo(x + 23, base - 440); g.lineTo(x + 48, base - 360); g.fill();
      g.fillStyle = tod === "day" ? "#e9e2c8" : "#ffe7a8";
      g.beginPath(); g.arc(x + 23, base - 330, 8, 0, Math.PI * 2); g.fill();
      return [];
    }
    default: {
      g.fillStyle = color;
      const h = 260 + (Math.round(x) % 7) * 40;
      g.fillRect(x, base - h, 64, h);
      return [];
    }
  }
}

function cityBand(ctx, base, { landmarks = [], density = 1, tallMax = 300 } = {}) {
  const { g, rand, w, tod } = ctx;
  const s = ctx.colors;
  const far = mix(s.haze, tod === "night" ? "#0d1220" : "#6d7682", 0.55);
  const mid = mix(s.haze, tod === "night" ? "#080a12" : "#4f565e", 0.75);
  const beacons = [];
  const lights = [];
  for (let x = 0; x < w; x += range(rand, 40, 120) / density) {
    const h = range(rand, 80, tallMax);
    const bw = range(rand, 30, 70);
    g.fillStyle = far;
    g.fillRect(x, base - h, bw, h);
    if (tod === "day") {
      g.fillStyle = "rgba(255,255,255,0.08)";
      for (let y = base - h + 6; y < base; y += 9) g.fillRect(x + 2, y, bw - 4, 3);
      g.fillStyle = "rgba(255,255,255,0.12)";
      g.fillRect(x, base - h, 3, h);
    }
    for (let k = 0; k < h * bw / 400; k++) lights.push([x + rand() * bw, base - rand() * h]);
  }
  for (const [kind, x] of landmarks) beacons.push(...skylineTower(g, kind, x, base, far, tod));
  for (let x = -20; x < w; x += range(rand, 30, 80)) {
    const h = range(rand, 30, 90);
    const bw = range(rand, 40, 90);
    g.fillStyle = mid;
    if (rand() < 0.3) {
      g.beginPath(); g.moveTo(x, base + 30 - h); g.lineTo(x + bw / 2, base + 30 - h - 26); g.lineTo(x + bw, base + 30 - h); g.lineTo(x + bw, base + 40); g.lineTo(x, base + 40); g.fill();
    } else {
      g.fillRect(x, base + 30 - h, bw, h + 10);
    }
    for (let k = 0; k < bw / 18; k++) lights.push([x + rand() * bw, base + 30 - rand() * h]);
  }
  g.fillStyle = mix(mid, "#000000", 0.25);
  g.fillRect(0, base + 36, w, ctx.h - base - 36);
  if (tod !== "day") {
    for (const [lx, ly] of lights) {
      if (rand() > (tod === "night" ? 0.5 : 0.2)) continue;
      g.fillStyle = rand() < 0.8 ? "rgba(255,214,140,0.9)" : "rgba(200,220,255,0.8)";
      g.fillRect(lx, ly, 2.5, 2.5);
    }
    for (const [bx, by] of beacons) {
      const glow = g.createRadialGradient(bx, by, 0, bx, by, 14);
      glow.addColorStop(0, "rgba(255,40,30,1)");
      glow.addColorStop(1, "rgba(255,40,30,0)");
      g.fillStyle = glow;
      g.fillRect(bx - 14, by - 14, 28, 28);
    }
  }
}

function water(ctx, top) {
  const { g, rand, w, h, tod } = ctx;
  const s = ctx.colors;
  const grad = g.createLinearGradient(0, top, 0, h);
  grad.addColorStop(0, mix(s.horizon, s.water, 0.5));
  grad.addColorStop(1, mix(s.water, "#000000", 0.35));
  g.fillStyle = grad;
  g.fillRect(0, top, w, h - top);
  for (let i = 0; i < 700; i++) {
    const y = top + Math.pow(rand(), 1.6) * (h - top);
    g.fillStyle = tod === "night" ? `rgba(255,210,140,${range(rand, 0.05, 0.3)})` : `rgba(255,255,255,${range(rand, 0.06, 0.28)})`;
    g.fillRect(rand() * w, y, range(rand, 8, 50) * (0.4 + (y - top) / (h - top)), 1.5);
  }
}

/** Rolling hills in one or more ranges. */
function hills(ctx, ranges, colorFor) {
  const { g, rand, w, h, tod } = ctx;
  const s = ctx.colors;
  ranges.forEach(([lift, t, amp, waves], i) => {
    g.fillStyle = mix(s.haze, tod === "night" ? "#06080c" : colorFor(i), t);
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 20) {
      const y = FAR.horizon - lift - amp * (0.5 + 0.5 * Math.sin((x / w) * Math.PI * 2 * waves + lift)) - range(rand, 0, 10);
      g.lineTo(x, y);
    }
    g.lineTo(w, h);
    g.fill();
  });
}

const CITY_SETS = [
  [["spire", 600], ["slab", 780], ["deco", 2100], ["clock", 2400], ["generic", 2520], ["dome", 3300]],
  [["clock", 500], ["deco", 760], ["generic", 900], ["slab", 2300], ["spire", 2480], ["dome", 3600]],
  [["slab", 300], ["spire", 470], ["dome", 1700], ["clock", 2000], ["deco", 2150], ["generic", 3100]]
];

const FAR_KINDS = {
  city(ctx) {
    cityBand(ctx, FAR.horizon + 10, { landmarks: CITY_SETS[ctx.variant % CITY_SETS.length] });
  },
  downtown(ctx) {
    cityBand(ctx, FAR.horizon + 10, { density: 2, tallMax: 520, landmarks: [...CITY_SETS[ctx.variant % CITY_SETS.length], ["slab", 1200], ["spire", 3000], ["deco", 3700]] });
  },
  fantasy(ctx) {
    // A castle on its hill above the roofs: curtain wall, keep, towers with pennants, spires.
    const { g, rand, w, tod } = ctx;
    const s = ctx.colors;
    const far = mix(s.haze, tod === "night" ? "#0a0d18" : "#6a6e74", 0.55);
    const mid = mix(s.haze, tod === "night" ? "#06080e" : "#4a4e54", 0.75);
    hills(ctx, [[120, 0.5, 90, 1]], () => "#5a6a50");
    const cx = 1400 + ctx.variant * 700;
    const hillTop = FAR.horizon - 260;
    g.fillStyle = far;
    g.fillRect(cx - 260, hillTop - 80, 520, 90);
    for (let x = cx - 260; x < cx + 260; x += 20) g.fillRect(x, hillTop - 92, 12, 12);
    g.fillRect(cx - 70, hillTop - 260, 140, 200);
    for (const [tx, th] of [[cx - 280, 200], [cx + 240, 220], [cx - 120, 300], [cx + 90, 330]]) {
      g.fillRect(tx, hillTop - th, 40, th);
      g.beginPath(); g.moveTo(tx - 8, hillTop - th); g.lineTo(tx + 20, hillTop - th - 70); g.lineTo(tx + 48, hillTop - th); g.fill();
      g.fillStyle = "#a8322a";
      g.beginPath(); g.moveTo(tx + 20, hillTop - th - 90); g.lineTo(tx + 44, hillTop - th - 84); g.lineTo(tx + 20, hillTop - th - 78); g.fill();
      g.strokeStyle = far;
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(tx + 20, hillTop - th - 70); g.lineTo(tx + 20, hillTop - th - 92); g.stroke();
      g.fillStyle = far;
    }
    if (tod !== "day") {
      for (let i = 0; i < 40; i++) {
        g.fillStyle = "rgba(255,200,110,0.9)";
        g.fillRect(cx - 260 + rand() * 520, hillTop - rand() * 300, 3, 4);
      }
    }
    // Spires and steep roofs of the town below.
    for (let x = -20; x < w; x += range(rand, 30, 70)) {
      const h = range(rand, 40, 110);
      const bw = range(rand, 30, 70);
      g.fillStyle = mid;
      g.fillRect(x, FAR.horizon + 30 - h, bw, h + 10);
      g.beginPath(); g.moveTo(x - 4, FAR.horizon + 30 - h); g.lineTo(x + bw / 2, FAR.horizon + 30 - h - bw * 0.8); g.lineTo(x + bw + 4, FAR.horizon + 30 - h); g.fill();
      if (rand() < 0.05) {
        g.fillRect(x + bw / 2 - 8, FAR.horizon - h - 40, 16, 60);
        g.beginPath(); g.moveTo(x + bw / 2 - 10, FAR.horizon - h - 40); g.lineTo(x + bw / 2, FAR.horizon - h - 200); g.lineTo(x + bw / 2 + 10, FAR.horizon - h - 40); g.fill();
      }
      if (tod !== "day" && rand() < 0.4) {
        g.fillStyle = "rgba(255,200,110,0.85)";
        g.fillRect(x + rand() * bw, FAR.horizon + 30 - rand() * h, 3, 4);
      }
    }
    g.fillStyle = mix(mid, "#000000", 0.25);
    g.fillRect(0, FAR.horizon + 36, w, ctx.h - FAR.horizon - 36);
  },
  harbor(ctx) {
    // Open water with ships at anchor, cranes along a far quay, and the city beyond.
    const { g, rand, w, tod } = ctx;
    cityBand(ctx, FAR.horizon - 30, { landmarks: CITY_SETS[ctx.variant % CITY_SETS.length].slice(0, 3) });
    water(ctx, FAR.horizon + 10);
    const hull = mix(ctx.colors.haze, tod === "night" ? "#05070c" : "#2a2e36", 0.6);
    for (let x = 200; x < w - 400; x += range(rand, 600, 1100)) {
      g.fillStyle = hull;
      g.beginPath();
      g.moveTo(x, FAR.horizon + 40); g.lineTo(x + 260, FAR.horizon + 40); g.lineTo(x + 240, FAR.horizon + 70); g.lineTo(x + 20, FAR.horizon + 70);
      g.fill();
      g.fillRect(x + 170, FAR.horizon + 6, 50, 34);
      g.fillRect(x + 190, FAR.horizon - 14, 12, 20);
    }
    g.strokeStyle = hull;
    g.lineWidth = 4;
    for (let x = 500; x < w; x += 1300) {
      g.beginPath();
      g.moveTo(x, FAR.horizon); g.lineTo(x + 10, FAR.horizon - 140);
      g.moveTo(x + 70, FAR.horizon); g.lineTo(x + 60, FAR.horizon - 140);
      g.moveTo(x - 60, FAR.horizon - 140); g.lineTo(x + 200, FAR.horizon - 140);
      g.stroke();
    }
  },
  hills(ctx) {
    const leaf = ctx.season === "winter" ? "#6b6258" : ctx.season === "fall" ? "#8a5a2c" : "#4a6040";
    hills(ctx, [[60, 0.75, 50, 3], [10, 0.45, 35, 3]], () => leaf);
    const { g, tod } = ctx;
    g.fillStyle = tod === "night" ? "#2a2e38" : "#efece4";
    const sx = 1800 + ctx.variant * 600;
    g.fillRect(sx, FAR.horizon - 150, 26, 90);
    g.beginPath(); g.moveTo(sx - 2, FAR.horizon - 150); g.lineTo(sx + 13, FAR.horizon - 230); g.lineTo(sx + 28, FAR.horizon - 150); g.fill();
  },
  farmland(ctx) {
    // Patchwork fields rolling away, hedgerows and a distant farmstead.
    const { g, rand, w, tod, season } = ctx;
    const s = ctx.colors;
    hills(ctx, [[80, 0.7, 40, 2]], () => (season === "winter" ? "#8a8478" : "#5a7040"));
    const crops = season === "winter" ? ["#d8d4cc", "#c9c4b8", "#e2ded6"] : season === "fall" ? ["#b08a3a", "#8a6a3a", "#9a7a4a", "#6a6a3a"] : ["#7a9a4a", "#9aaa5a", "#c9b04a", "#6a8a3a"];
    let y = FAR.horizon - 20;
    for (let band = 0; band < 6; band++) {
      const bh = 12 + band * 14;
      for (let x = 0; x < w;) {
        const fw = range(rand, 200, 600);
        g.fillStyle = mix(s.haze, tod === "night" ? "#080a0c" : pick(rand, crops), 0.85 - band * 0.05);
        g.fillRect(x, y, fw + 1, bh + 1);
        g.fillStyle = "rgba(30,40,20,0.35)";
        g.fillRect(x, y, 3, bh);
        x += fw;
      }
      y += bh;
    }
    g.fillStyle = mix(s.haze, tod === "night" ? "#06080c" : "#5a3a2a", 0.6);
    const fx = 900 + ctx.variant * 900;
    g.fillRect(fx, FAR.horizon - 60, 70, 40);
    g.beginPath(); g.moveTo(fx - 6, FAR.horizon - 60); g.lineTo(fx + 35, FAR.horizon - 90); g.lineTo(fx + 76, FAR.horizon - 60); g.fill();
    g.fillRect(fx + 90, FAR.horizon - 100, 22, 80);
  },
  mountains(ctx) {
    // Peaks with snow caps (bigger in winter) behind a forested foothill range.
    const { g, rand, w, tod, season } = ctx;
    const s = ctx.colors;
    const rock = mix(s.haze, tod === "night" ? "#0a0c12" : "#6a6e78", 0.45);
    const peaks = [];
    for (let x = -200; x < w + 200; x += range(rand, 380, 700)) peaks.push([x, range(rand, 380, 720)]);
    for (const [px, ph] of peaks) {
      const half = ph * range(rand, 0.9, 1.3);
      g.fillStyle = rock;
      g.beginPath(); g.moveTo(px - half, FAR.horizon); g.lineTo(px, FAR.horizon - ph); g.lineTo(px + half, FAR.horizon); g.fill();
      const cap = season === "winter" ? 0.55 : 0.28;
      g.fillStyle = tod === "night" ? "rgba(180,190,210,0.5)" : "rgba(245,248,252,0.95)";
      g.beginPath();
      g.moveTo(px - half * cap, FAR.horizon - ph * (1 - cap));
      g.lineTo(px, FAR.horizon - ph);
      g.lineTo(px + half * cap, FAR.horizon - ph * (1 - cap));
      g.lineTo(px + half * cap * 0.4, FAR.horizon - ph * (1 - cap * 0.7));
      g.lineTo(px, FAR.horizon - ph * (1 - cap));
      g.lineTo(px - half * cap * 0.5, FAR.horizon - ph * (1 - cap * 0.6));
      g.fill();
    }
    hills(ctx, [[0, 0.5, 70, 4]], () => (season === "winter" ? "#3a4a40" : "#2e4a32"));
  },
  sea(ctx) {
    const { g, rand, w } = ctx;
    water(ctx, FAR.horizon);
    g.fillStyle = mix(ctx.colors.haze, "#2a3036", 0.5);
    for (let x = 300 + ctx.variant * 500; x < w - 400; x += range(rand, 1200, 1800)) {
      g.beginPath(); g.ellipse(x, FAR.horizon + 2, range(rand, 120, 300), range(rand, 12, 26), 0, Math.PI, 0); g.fill();
    }
    // A lighthouse on a far headland.
    const lx = 2600 + ctx.variant * 300;
    g.fillStyle = mix(ctx.colors.haze, "#e8e2d6", 0.5);
    g.fillRect(lx, FAR.horizon - 90, 16, 90);
    if (ctx.tod !== "day") {
      const glow = g.createRadialGradient(lx + 8, FAR.horizon - 94, 0, lx + 8, FAR.horizon - 94, 40);
      glow.addColorStop(0, "rgba(255,240,180,1)");
      glow.addColorStop(1, "rgba(255,240,180,0)");
      g.fillStyle = glow;
      g.fillRect(lx - 32, FAR.horizon - 134, 80, 80);
    }
  },
  river(ctx) {
    const shore = FAR.horizon - 10;
    cityBand(ctx, shore, { landmarks: CITY_SETS[(ctx.variant + 1) % CITY_SETS.length] });
    water(ctx, shore + 40);
  }
};

/** The industrial skyline: low brick, smoking chimneys, gasometers, steeples and a clock tower. */
function industrialBand(ctx, base) {
  const { g, rand, w, tod } = ctx;
  const s = ctx.colors;
  const far = mix(s.haze, tod === "night" ? "#0d0c10" : "#5a5048", 0.6);
  const mid = mix(s.haze, tod === "night" ? "#08080a" : "#3e3630", 0.78);
  const lights = [];
  for (let x = 0; x < w; x += range(rand, 40, 100)) {
    const h = range(rand, 60, 170);
    const bw = range(rand, 40, 90);
    g.fillStyle = far;
    g.fillRect(x, base - h, bw, h);
    for (let k = 0; k < h * bw / 600; k++) lights.push([x + rand() * bw, base - rand() * h]);
  }
  for (let x = 200 + ctx.variant * 300; x < w; x += range(rand, 500, 900)) {
    g.fillStyle = far;
    g.fillRect(x, base - 260, 18, 260);
    for (let i = 0; i < 8; i++) {
      const px = x + 9 + i * 22, py = base - 270 - i * 16, r = 18 + i * 8;
      const puff = g.createRadialGradient(px, py, 0, px, py, r);
      puff.addColorStop(0, `rgba(80,74,68,${0.45 - i * 0.045})`);
      puff.addColorStop(1, "rgba(80,74,68,0)");
      g.fillStyle = puff;
      g.fillRect(px - r, py - r, r * 2, r * 2);
    }
  }
  for (let x = 900 + ctx.variant * 400; x < w; x += 1700) {
    g.strokeStyle = far;
    g.lineWidth = 4;
    g.beginPath();
    for (let k = 0; k <= 4; k++) { g.moveTo(x + k * 40, base); g.lineTo(x + k * 40, base - 150); }
    g.moveTo(x, base - 150); g.lineTo(x + 160, base - 150);
    g.stroke();
    g.fillStyle = far;
    g.fillRect(x + 6, base - 120, 148, 120);
  }
  skylineTower(g, "clock", 2400 - ctx.variant * 500, base, far, tod);
  for (let x = 600; x < w; x += 1300) {
    g.fillStyle = far;
    g.beginPath(); g.moveTo(x - 10, base - 120); g.lineTo(x, base - 260); g.lineTo(x + 10, base - 120); g.fill();
    g.fillRect(x - 14, base - 120, 28, 120);
  }
  for (let x = -20; x < w; x += range(rand, 30, 70)) {
    const h = range(rand, 30, 80);
    const bw = range(rand, 40, 80);
    g.fillStyle = mid;
    g.fillRect(x, base + 30 - h, bw, h + 10);
    for (let k = 0; k < 2; k++) g.fillRect(x + rand() * bw, base + 30 - h - 14, 6, 14);
    for (let k = 0; k < bw / 24; k++) lights.push([x + rand() * bw, base + 30 - rand() * h]);
  }
  g.fillStyle = mix(mid, "#000000", 0.25);
  g.fillRect(0, base + 36, w, ctx.h - base - 36);
  if (tod !== "day") {
    for (const [lx, ly] of lights) {
      if (rand() > (tod === "night" ? 0.4 : 0.15)) continue;
      g.fillStyle = "rgba(255,226,160,0.85)";
      g.fillRect(lx, ly, 2.5, 2.5);
    }
  }
}

/** The future skyline: dark mega-towers with lit edges, window grids and air traffic. */
function neonBand(ctx, base) {
  const { g, rand, w, tod } = ctx;
  const s = ctx.colors;
  const day = tod === "day";
  for (const [tallMin, tallMax, depth] of [[200, 560, 0.55], [300, 820, 0.3]]) {
    for (let x = 0; x < w; x += range(rand, 50, 140)) {
      const h = range(rand, tallMin, tallMax);
      const bw = range(rand, 40, 110);
      g.fillStyle = mix(s.haze, day ? "#3a4a5a" : "#0a0c14", depth + 0.2);
      if (rand() < 0.3) {
        g.beginPath(); g.moveTo(x, base); g.lineTo(x, base - h); g.lineTo(x + bw * 0.6, base - h - 40); g.lineTo(x + bw, base - h); g.lineTo(x + bw, base); g.fill();
      } else {
        g.fillRect(x, base - h, bw, h);
      }
      if (day) {
        g.fillStyle = "rgba(200,230,255,0.12)";
        g.fillRect(x + 3, base - h, 4, h);
      } else {
        for (let y = base - h + 8; y < base; y += 10) {
          for (let xx = x + 3; xx < x + bw - 4; xx += 7) if (rand() < 0.35) {
            g.fillStyle = rand() < 0.8 ? "rgba(190,230,255,0.75)" : pick(rand, NEON);
            g.fillRect(xx, y, 3, 3);
          }
        }
      }
      const edge = pick(rand, NEON);
      g.fillStyle = edge;
      g.globalAlpha = day ? 0.45 : 0.9;
      g.fillRect(x, base - h, bw, 2);
      if (rand() < 0.5) g.fillRect(x + bw - 2, base - h, 2, h);
      g.globalAlpha = 1;
      if (rand() < 0.3) {
        g.fillStyle = "#ff3030";
        g.fillRect(x + bw / 2 - 2, base - h - 30, 4, 4);
      }
    }
  }
  // Air traffic: streaks of light above the towers.
  if (!day) {
    for (let i = 0; i < 90; i++) {
      g.fillStyle = pick(rand, ["rgba(255,255,255,0.8)", "rgba(255,80,80,0.8)", NEON[0]]);
      g.fillRect(rand() * w, base - range(rand, 300, 900), range(rand, 6, 30), 1.5);
    }
  }
  g.fillStyle = mix(s.haze, "#05060a", 0.85);
  g.fillRect(0, base + 20, w, ctx.h - base - 20);
}

function turbineRow(ctx, base, color) {
  const { g, w } = ctx;
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 3;
  for (let x = 200 + ctx.variant * 120; x < w; x += 360) {
    const h = 150 + ((x / 40) % 3) * 20;
    g.beginPath(); g.moveTo(x, base); g.lineTo(x, base - h); g.stroke();
    for (let k = 0; k < 3; k++) {
      const a = (k * Math.PI * 2) / 3 + x;
      g.beginPath(); g.moveTo(x, base - h); g.lineTo(x + Math.cos(a) * 60, base - h + Math.sin(a) * 60); g.stroke();
    }
    if (ctx.tod !== "day") { g.fillStyle = "#ff3030"; g.fillRect(x - 2, base - h - 4, 4, 4); g.fillStyle = color; }
  }
}

function sailSilhouettes(ctx, base) {
  const { g, rand, w } = ctx;
  g.fillStyle = mix(ctx.colors.haze, ctx.tod === "night" ? "#06080c" : "#3a3028", 0.55);
  for (let x = 300; x < w - 300; x += range(rand, 600, 1000)) {
    g.beginPath(); g.moveTo(x, base); g.lineTo(x + 180, base); g.lineTo(x + 160, base + 24); g.lineTo(x + 20, base + 24); g.fill();
    for (const [mx, mh] of [[x + 50, 150], [x + 100, 180], [x + 140, 130]]) {
      g.fillRect(mx - 2, base - mh, 4, mh);
      g.beginPath(); g.moveTo(mx - 30, base - mh + 20); g.lineTo(mx + 30, base - mh + 20); g.lineTo(mx + 24, base - mh + 70); g.lineTo(mx - 24, base - mh + 70); g.fill();
    }
  }
}

/** Theme versions of the far layers; anything missing falls back to FAR_KINDS. */
const FAR_THEMED = {
  industrial: {
    city(ctx) { industrialBand(ctx, FAR.horizon + 10); },
    downtown(ctx) { industrialBand(ctx, FAR.horizon + 10); cityBand(ctx, FAR.horizon + 10, { density: 0.4, tallMax: 200, landmarks: [["deco", 1600 + ctx.variant * 400]] }); },
    harbor(ctx) { industrialBand(ctx, FAR.horizon - 30); water(ctx, FAR.horizon + 10); },
    river(ctx) { industrialBand(ctx, FAR.horizon - 10); water(ctx, FAR.horizon + 30); }
  },
  fantasy: {
    downtown(ctx) { FAR_KINDS.fantasy(ctx); },
    city(ctx) { FAR_KINDS.fantasy(ctx); },
    harbor(ctx) { FAR_KINDS.fantasy(ctx); water(ctx, FAR.horizon + 10); sailSilhouettes(ctx, FAR.horizon + 4); },
    river(ctx) { FAR_KINDS.fantasy(ctx); water(ctx, FAR.horizon + 30); },
    hills(ctx) { FAR_KINDS.hills(ctx); }
  },
  future: {
    city(ctx) { neonBand(ctx, FAR.horizon + 10); },
    downtown(ctx) { neonBand(ctx, FAR.horizon + 10); },
    harbor(ctx) { neonBand(ctx, FAR.horizon - 20); water(ctx, FAR.horizon + 10); },
    river(ctx) { neonBand(ctx, FAR.horizon - 10); water(ctx, FAR.horizon + 30); },
    hills(ctx) { FAR_KINDS.hills(ctx); turbineRow(ctx, FAR.horizon - 40, mix(ctx.colors.haze, "#e8ecee", 0.5)); },
    farmland(ctx) { FAR_KINDS.farmland(ctx); turbineRow(ctx, FAR.horizon - 10, mix(ctx.colors.haze, "#e8ecee", 0.5)); },
    sea(ctx) { FAR_KINDS.sea(ctx); turbineRow(ctx, FAR.horizon, mix(ctx.colors.haze, "#e8ecee", 0.4)); },
    mountains(ctx) { FAR_KINDS.mountains(ctx); turbineRow(ctx, FAR.horizon - 30, mix(ctx.colors.haze, "#d8dce0", 0.5)); }
  }
};

/** Each era's air: industrial smog by day and an orange glow by night, a magenta glow over the future. */
function themeSky(ctx) {
  const { g, w, tod, theme } = ctx;
  const haze = (color) => {
    const grad = g.createLinearGradient(0, FAR.horizon - 700, 0, FAR.horizon + 40);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, color);
    g.fillStyle = grad;
    g.fillRect(0, FAR.horizon - 700, w, 740);
  };
  if (theme === "industrial") haze(tod === "night" ? "rgba(200,110,40,0.35)" : "rgba(150,120,80,0.45)");
  if (theme === "future" && tod !== "day") haze("rgba(200,40,200,0.35)");
  if (theme === "future" && tod === "day") haze("rgba(80,200,220,0.18)");
}

export function drawFar(kind, theme, tod, season, variant, sky = "clear") {
  const [c, g] = makeCanvas(FAR.w, FAR.h);
  const ctx = { g, w: FAR.w, h: FAR.h, rand: seeded(hash(`${theme}:${kind}:${variant}:${tod}`)), tod, sky, season, variant, theme, colors: skyColors(tod, sky) };
  drawSky(g, FAR.w, FAR.horizon, tod, sky, ctx.rand);
  themeSky(ctx);
  (FAR_THEMED[theme]?.[kind] ?? FAR_KINDS[kind] ?? FAR_KINDS.city)(ctx);
  return c;
}

// ================================================================ tunnels

/** Lamp light by theme, for tunnels and platforms. */
const TUNNEL_LAMP = {
  modern: { glow: "255,232,170", lamp: "#fffbe8" },
  industrial: { glow: "255,214,140", lamp: "#ffe8b0" },
  fantasy: { glow: "255,190,110", lamp: "#ffd890" },
  future: { glow: "90,230,255", lamp: "#c8f8ff" }
};

/**
 * Tunnel walls: one lamp per tile, which also drives the light sweeping through the car.
 * Styles: concrete, brick, rock (a cave, timber-propped) and cyber (dark panels and light
 * strips). The theme sets the colour of the light.
 */
export function drawTunnel(style, theme = "modern") {
  const W = 520, H = STAGE_SIZE.h;
  const [c, g] = makeCanvas(W, H);
  const rand = seeded(hash(`tunnel:${style}`));
  const light = TUNNEL_LAMP[theme] ?? TUNNEL_LAMP.modern;
  if (style === "cyber") {
    g.fillStyle = "#07090d";
    g.fillRect(0, 0, W, H);
    // Panels with seams, and glowing strips running the length of the tunnel.
    g.fillStyle = "#10141b";
    for (let x = 4; x < W; x += 130) for (let y = 30; y < H; y += 150) g.fillRect(x, y, 122, 140);
    for (const [y, color, w] of [[150, NEON[0], 3], [330, NEON[1], 2], [520, NEON[0], 3]]) {
      g.fillStyle = color;
      g.globalAlpha = 0.85;
      g.fillRect(0, y, W, w);
      g.globalAlpha = 0.25;
      g.fillRect(0, y - 6, W, w + 12);
      g.globalAlpha = 1;
    }
    // The tile's light: a vertical bar instead of a lamp.
    const glow = g.createRadialGradient(W / 2, 260, 6, W / 2, 260, 230);
    glow.addColorStop(0, `rgba(${light.glow},0.6)`);
    glow.addColorStop(1, `rgba(${light.glow},0)`);
    g.fillStyle = glow;
    g.fillRect(W / 2 - 240, 20, 480, 480);
    g.fillStyle = light.lamp;
    g.fillRect(W / 2 - 4, 120, 8, 280);
    return c;
  }
  if (style === "brick") {
    g.fillStyle = brickPattern(g, "#5a3326", rand);
    g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(0,0,0,0.45)";
    g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(0, 0, 30, H);
  } else if (style === "rock") {
    g.fillStyle = "#3a352e";
    g.fillRect(0, 0, W, H);
    for (let i = 0; i < 140; i++) {
      const x = rand() * W;
      const y = rand() * H;
      g.fillStyle = `rgba(${rand() < 0.5 ? "0,0,0" : "200,180,150"},${range(rand, 0.06, 0.22)})`;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + range(rand, 20, 80), y + range(rand, -20, 20)); g.lineTo(x + range(rand, 10, 50), y + range(rand, 15, 50)); g.fill();
    }
    g.fillStyle = "#3a2a1c";
    g.fillRect(40, 0, 24, H);
    g.fillRect(40, 150, 200, 18);
  } else {
    const wall = g.createLinearGradient(0, 0, 0, H);
    wall.addColorStop(0, "#1a1815");
    wall.addColorStop(0.4, "#34302a");
    wall.addColorStop(1, "#141210");
    g.fillStyle = wall;
    g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(0, 0, 38, H);
    g.fillStyle = "rgba(255,240,210,0.06)";
    g.fillRect(38, 0, 10, H);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(0,0,0,${0.08 + rand() * 0.12})`;
      g.fillRect(rand() * W, rand() * H, 6 + rand() * 50, 3 + rand() * 30);
    }
  }
  if (style !== "rock") {
    for (const [y, w, col] of [[300, 7, "#141210"], [318, 5, "#1d1a16"], [334, 4, "#141210"], [560, 9, "#100f0d"]]) {
      g.strokeStyle = col;
      g.lineWidth = w;
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
  }
  const glow = g.createRadialGradient(W / 2, 200, 6, W / 2, 200, 210);
  glow.addColorStop(0, `rgba(${light.glow},0.85)`);
  glow.addColorStop(0.35, `rgba(${light.glow},0.25)`);
  glow.addColorStop(1, `rgba(${light.glow},0)`);
  g.fillStyle = glow;
  g.fillRect(W / 2 - 220, 0, 440, 420);
  g.fillStyle = light.lamp;
  // A lantern or gas mantle in the old styles, a fluorescent tube in the modern ones.
  if (style === "rock" || theme === "fantasy" || theme === "industrial") g.fillRect(W / 2 - 8, 184, 16, 26);
  else g.fillRect(W / 2 - 40, 190, 80, 20);
  return c;
}

// ================================================================ stations underground

/** An underground platform wall with the station's name, in the theme's platform style. */
export function drawStation(style, name, color) {
  const label = String(name).toUpperCase();
  const W = 1400, H = STAGE_SIZE.h;
  const [c, g] = makeCanvas(W, H);
  const rand = seeded(hash(`station:${style}`));
  let signBg = "#111";
  let signFg = "#fff";
  let font = "bold 46px Helvetica, Arial, sans-serif";
  let glowSign = false;
  if (style === "neon") {
    g.fillStyle = "#0a0d12";
    g.fillRect(0, 0, W, H);
    g.fillStyle = "#141a22";
    for (let x = 0; x < W; x += 175) g.fillRect(x + 4, 0, 167, H);
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "rgba(120,220,255,0.12)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    signBg = "rgba(0,0,0,0.6)";
    signFg = NEON[0];
    font = "bold 44px 'Courier New', monospace";
    glowSign = true;
  } else if (style === "brick") {
    // Victorian: cream tiles below a brick vault, enamel signs.
    g.fillStyle = brickPattern(g, "#8a4a36", rand);
    g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(0, 0, W, H);
    g.fillStyle = "#e8e0c8";
    g.fillRect(0, 380, W, H - 380);
    g.strokeStyle = "rgba(90,80,60,0.25)";
    g.lineWidth = 2;
    for (let x = 0; x <= W; x += 28) { g.beginPath(); g.moveTo(x, 380); g.lineTo(x, H); g.stroke(); }
    signBg = "#f2ead8";
    signFg = "#1a1a1a";
    font = "bold 44px Georgia, serif";
  } else if (style === "vault") {
    g.fillStyle = stonePattern(g, "#7a7062", rand);
    g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(0,0,0,0.3)";
    g.fillRect(0, 0, W, H);
    g.strokeStyle = "#4a4236";
    g.lineWidth = 16;
    for (const cx of [W * 0.25, W * 0.75]) {
      g.beginPath(); g.arc(cx, 380, 300, Math.PI, 0); g.stroke();
      const glow = g.createRadialGradient(cx, 150, 4, cx, 150, 160);
      glow.addColorStop(0, "rgba(255,200,110,0.7)");
      glow.addColorStop(1, "rgba(255,200,110,0)");
      g.fillStyle = glow;
      g.fillRect(cx - 160, 0, 320, 320);
      g.fillStyle = "#e8c070";
      g.fillRect(cx - 7, 140, 14, 20);
    }
    signBg = "#2a2016";
    signFg = "#e8d9a8";
    font = "bold 44px Georgia, serif";
  } else {
    g.fillStyle = "#cfc6af";
    g.fillRect(0, 0, W, H);
    g.strokeStyle = "rgba(90,80,60,0.25)";
    g.lineWidth = 2;
    for (let x = 0; x <= W; x += 28) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let y = 0; y <= H; y += 14) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  }
  if (style !== "vault" && style !== "neon") {
    const wash = g.createLinearGradient(0, 0, 0, H);
    wash.addColorStop(0, "rgba(255,255,240,0.35)");
    wash.addColorStop(0.5, "rgba(255,255,240,0)");
    wash.addColorStop(1, "rgba(0,0,0,0.45)");
    g.fillStyle = wash;
    g.fillRect(0, 0, W, H);
  }
  // Line-colour band (glowing in the future) and two name signs per tile.
  g.save();
  if (glowSign) { g.shadowColor = color; g.shadowBlur = 20; }
  g.fillStyle = color;
  g.fillRect(0, 410, W, glowSign ? 8 : 34);
  g.restore();
  g.font = font;
  const text = g.measureText(label).width;
  for (const cx of [W * 0.25, W * 0.75]) {
    const w = text + 70;
    g.fillStyle = signBg;
    g.fillRect(cx - w / 2, 230, w, 84);
    g.save();
    if (glowSign) {
      g.shadowColor = signFg;
      g.shadowBlur = 16;
      g.strokeStyle = signFg;
      g.lineWidth = 2;
      g.strokeRect(cx - w / 2, 230, w, 84);
    }
    g.fillStyle = signFg;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, cx, 274);
    g.restore();
  }
  return c;
}

// ================================================================ stations above ground

/**
 * An open-air platform: canopy, columns, lamps, benches and the station's name boards, in
 * the theme's style. Transparent above the canopy and between its columns, so the far layer
 * (the skyline or countryside around the station) shows through.
 */
export function drawPlatformAbove(theme, name, color, tod, season, sky = "clear") {
  const [c, g] = makeCanvas(NEAR.w, NEAR.h);
  const ctx = {
    g, w: NEAR.w, h: NEAR.h, rand: seeded(hash(`platform:${theme}:${name}`)), tod, sky, season, theme,
    kit: KITS[theme] ?? KITS.modern, windows: [], shops: [], lamps: [], roofs: [], neon: []
  };
  const label = String(name).toUpperCase();
  const style = PLATFORM_STYLES[theme] ?? PLATFORM_STYLES.modern;
  const canopyTop = 70;
  const canopyBottom = 120;
  const floor = 540;
  const bay = 350;

  // Back wall or windbreak, then benches.
  style.backWall(ctx, 360, floor);
  for (let x = 120; x < ctx.w; x += bay * 2) style.bench(ctx, x, floor);
  // Columns holding up the canopy.
  for (let x = 0; x < ctx.w; x += bay) style.column(ctx, x, canopyBottom, floor);
  style.canopy(ctx, canopyTop, canopyBottom);
  // Lamps under the canopy and name boards between the columns.
  for (let x = bay / 2; x < ctx.w; x += bay) style.lamp(ctx, x, canopyBottom + 10);
  for (let x = bay; x < ctx.w; x += bay * 2) style.sign(ctx, x + bay / 2, canopyBottom + 60, label, color);
  // Platform edge in the line colour.
  g.fillStyle = "#6a6660";
  g.fillRect(0, floor, ctx.w, 30);
  g.fillStyle = style.edge ?? "#e8c020";
  g.fillRect(0, floor, ctx.w, 6);
  ctx.roofs.push({ x: 0, w: ctx.w, y: canopyTop });
  snowOnRoofs(ctx);
  tint(ctx);
  return c;
}

/** Name board shared by the old styles: a framed board with the name in serif or sans. */
function nameBoard(ctx, cx, y, label, { bg, fg, frame, font, glow }) {
  const { g } = ctx;
  g.font = font;
  const w = Math.min(320, g.measureText(label).width + 50);
  g.strokeStyle = frame;
  g.lineWidth = 3;
  g.beginPath(); g.moveTo(cx - w / 3, y - 40); g.lineTo(cx - w / 3, y); g.moveTo(cx + w / 3, y - 40); g.lineTo(cx + w / 3, y); g.stroke();
  g.fillStyle = bg;
  g.fillRect(cx - w / 2, y, w, 50);
  g.strokeRect(cx - w / 2, y, w, 50);
  const draw = () => {
    g.save();
    if (glow) { g.shadowColor = fg; g.shadowBlur = 14; }
    g.fillStyle = fg;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, cx, y + 26, w - 16);
    g.restore();
  };
  if (glow) ctx.neon.push(draw);
  else draw();
}

const PLATFORM_STYLES = {
  modern: {
    backWall(ctx, top, floor) {
      const { g, w } = ctx;
      g.fillStyle = "rgba(180,200,215,0.35)";
      g.fillRect(0, top, w, floor - top);
      g.fillStyle = "#5a5e62";
      for (let x = 0; x < w; x += 175) g.fillRect(x, top, 4, floor - top);
      g.fillRect(0, top, w, 4);
    },
    bench(ctx, x, floor) {
      const { g } = ctx;
      g.fillStyle = "#3a4048";
      g.fillRect(x, floor - 44, 110, 8);
      g.fillRect(x, floor - 70, 110, 6);
      g.fillRect(x + 8, floor - 44, 6, 44);
      g.fillRect(x + 96, floor - 44, 6, 44);
    },
    column(ctx, x, top, floor) {
      ctx.g.fillStyle = "#6a7078";
      ctx.g.fillRect(x - 7, top, 14, floor - top);
    },
    canopy(ctx, top, bottom) {
      const { g, w } = ctx;
      g.fillStyle = "#8a9096";
      g.fillRect(0, top, w, bottom - top);
      g.fillStyle = "#5a6066";
      g.fillRect(0, bottom - 10, w, 10);
    },
    lamp(ctx, x, y) {
      ctx.g.fillStyle = "#f4f6f0";
      ctx.g.fillRect(x - 40, y - 6, 80, 8);
      ctx.lamps.push({ x, y });
    },
    sign(ctx, cx, y, label, color) {
      nameBoard(ctx, cx, y, label, { bg: color, fg: "#ffffff", frame: "#3a4048", font: "bold 30px Helvetica, Arial, sans-serif" });
    }
  },
  industrial: {
    edge: "#e8e0c8",
    backWall(ctx, top, floor) {
      const { g, w, rand } = ctx;
      g.fillStyle = brickPattern(g, "#7a4030", rand);
      g.fillRect(0, top + 40, w, floor - top - 40);
      g.fillStyle = "#3a2a20";
      g.fillRect(0, top + 36, w, 8);
      // Enamel advertising plates on the wall.
      for (let x = 260; x < w; x += 700) {
        g.fillStyle = pick(rand, ["#1e3a6a", "#7a1e1a", "#1e5a2e"]);
        g.fillRect(x, top + 70, 90, 60);
        g.fillStyle = "#f0e8d0";
        g.font = "bold 16px Georgia, serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(pick(rand, ["TEA", "COCOA", "SOAP", "INK"]), x + 45, top + 100);
      }
    },
    bench(ctx, x, floor) {
      const { g } = ctx;
      g.fillStyle = "#6a4a2a";
      g.fillRect(x, floor - 44, 110, 8);
      g.fillRect(x, floor - 76, 110, 6);
      g.fillRect(x, floor - 64, 110, 6);
      g.fillStyle = "#1e2420";
      g.fillRect(x + 6, floor - 76, 8, 76);
      g.fillRect(x + 96, floor - 76, 8, 76);
    },
    column(ctx, x, top, floor) {
      const { g } = ctx;
      g.fillStyle = "#2a3a2e";
      g.fillRect(x - 6, top, 12, floor - top);
      g.fillRect(x - 12, floor - 20, 24, 20);
      // Cast-iron brackets.
      g.strokeStyle = "#2a3a2e";
      g.lineWidth = 4;
      g.beginPath(); g.arc(x - 30, top, 30, 0, Math.PI / 2); g.arc(x + 30, top, 30, Math.PI / 2, Math.PI); g.stroke();
    },
    canopy(ctx, top, bottom) {
      const { g, w } = ctx;
      g.fillStyle = "#3a3632";
      g.fillRect(0, top, w, bottom - top - 16);
      // Sawtooth wooden valance along the edge.
      g.fillStyle = "#e8e0c8";
      for (let x = 0; x < w; x += 24) {
        g.beginPath(); g.moveTo(x, bottom - 16); g.lineTo(x + 24, bottom - 16); g.lineTo(x + 12, bottom + 6); g.fill();
      }
    },
    lamp(ctx, x, y) {
      const { g } = ctx;
      g.fillStyle = "#1e2420";
      g.fillRect(x - 2, y - 20, 4, 24);
      g.beginPath(); g.moveTo(x - 12, y + 4); g.lineTo(x - 7, y - 6); g.lineTo(x + 7, y - 6); g.lineTo(x + 12, y + 4); g.fill();
      g.fillStyle = "#f6e8b8";
      g.fillRect(x - 7, y + 4, 14, 14);
      ctx.lamps.push({ x, y: y + 10 });
    },
    sign(ctx, cx, y, label) {
      nameBoard(ctx, cx, y, label, { bg: "#f2ead8", fg: "#1a2a4a", frame: "#1e2420", font: "bold 30px Georgia, serif" });
    }
  },
  fantasy: {
    edge: "#8a7a5a",
    backWall(ctx, top, floor) {
      const { g, w, rand } = ctx;
      g.fillStyle = stonePattern(g, "#7a7062", rand);
      g.fillRect(0, top + 60, w, floor - top - 60);
      for (let x = 30; x < w; x += 300) { g.fillStyle = "#5a6a3a"; g.beginPath(); g.ellipse(x, top + 62, 40, 16, 0, Math.PI, 0); g.fill(); }
    },
    bench(ctx, x, floor) {
      const { g } = ctx;
      g.fillStyle = "#5a3e26";
      g.fillRect(x, floor - 40, 110, 14);
      g.fillRect(x + 8, floor - 40, 12, 40);
      g.fillRect(x + 90, floor - 40, 12, 40);
    },
    column(ctx, x, top, floor) {
      const { g } = ctx;
      g.fillStyle = "#5a3e26";
      g.fillRect(x - 9, top, 18, floor - top);
      g.fillStyle = "#4a321e";
      g.beginPath(); g.moveTo(x - 9, top + 30); g.lineTo(x - 50, top); g.lineTo(x - 40, top); g.lineTo(x - 9, top + 18); g.fill();
      g.beginPath(); g.moveTo(x + 9, top + 30); g.lineTo(x + 50, top); g.lineTo(x + 40, top); g.lineTo(x + 9, top + 18); g.fill();
    },
    canopy(ctx, top, bottom) {
      const { g, w } = ctx;
      g.fillStyle = "#5a3a2a";
      g.fillRect(0, top, w, bottom - top);
      g.fillStyle = "rgba(0,0,0,0.25)";
      for (let y = top + 6; y < bottom; y += 10) g.fillRect(0, y, w, 2);
      for (let x = 0; x < w; x += 16) { g.fillStyle = "rgba(0,0,0,0.15)"; g.fillRect(x, bottom - 4, 8, 6); }
    },
    lamp(ctx, x, y) {
      const { g } = ctx;
      g.strokeStyle = "#1c1c1c";
      g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y - 10); g.lineTo(x, y + 6); g.stroke();
      g.fillStyle = "#1c1c1c";
      g.fillRect(x - 8, y + 6, 16, 4);
      g.fillStyle = "#e8c070";
      g.fillRect(x - 6, y + 10, 12, 16);
      ctx.lamps.push({ x, y: y + 18, warm: true });
    },
    sign(ctx, cx, y, label) {
      nameBoard(ctx, cx, y, label, { bg: "#4a3220", fg: "#e8d9a8", frame: "#2a1e12", font: "bold 28px Georgia, serif" });
    }
  },
  future: {
    edge: NEON[0],
    backWall(ctx, top, floor) {
      const { g, w } = ctx;
      g.fillStyle = "rgba(140,200,230,0.18)";
      g.fillRect(0, top, w, floor - top);
      ctx.neon.push(() => { g.fillStyle = NEON[0]; g.fillRect(0, top, w, 2); g.fillRect(0, floor - 60, w, 2); });
    },
    bench(ctx, x, floor) {
      const { g } = ctx;
      g.fillStyle = "#e8ecf0";
      g.beginPath(); g.ellipse(x + 55, floor - 40, 55, 10, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#9aa4ae";
      g.fillRect(x + 50, floor - 40, 10, 40);
    },
    column(ctx, x, top, floor) {
      const { g } = ctx;
      g.fillStyle = "#d8dee4";
      g.fillRect(x - 4, top, 8, floor - top);
    },
    canopy(ctx, top, bottom) {
      const { g, w } = ctx;
      g.fillStyle = "#e8ecf0";
      g.fillRect(0, top + 10, w, bottom - top - 30);
      ctx.neon.push(() => { g.fillStyle = NEON[0]; g.fillRect(0, bottom - 22, w, 3); });
    },
    lamp(ctx, x, y) {
      ctx.lamps.push({ x, y: y - 10, color: NEON[0] });
    },
    sign(ctx, cx, y, label, color) {
      nameBoard(ctx, cx, y, label, { bg: "rgba(0,0,0,0.55)", fg: NEON[0], frame: color, font: "bold 28px 'Courier New', monospace", glow: true });
    }
  }
};

/** Backdrops seen through the end door, by platform or tunnel style. */
export const STATION_BACKDROPS = {
  tile: "radial-gradient(circle at 50% 47%, #8a826e 0, #2a2720 35%)",
  brick: "radial-gradient(circle at 50% 47%, #7a5040 0, #24180f 35%)",
  vault: "radial-gradient(circle at 50% 47%, #8a6a40 0, #1a140c 35%)",
  neon: "radial-gradient(circle at 50% 47%, #1a4a60 0, #05070c 35%)"
};

export const TUNNEL_BACKDROPS = {
  concrete: "radial-gradient(circle at 50% 47%, #1d1a15 0, #050505 30%)",
  brick: "radial-gradient(circle at 50% 47%, #24140e 0, #050303 30%)",
  rock: "radial-gradient(circle at 50% 47%, #2a1e12 0, #050403 30%)",
  cyber: "radial-gradient(circle at 50% 47%, #0a2a3a 0, #020306 30%)"
};
