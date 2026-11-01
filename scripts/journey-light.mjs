// Keep planned routes, roads and trails readable above Foundry's scene darkness. The map
// sprite itself is darkened by Foundry, so lines drawn only inside MapLibre fade with it.
import { latLonToScene } from "./geo.mjs";
const SETTLE_MS = 450;

function trace(graphics, points) {
  graphics.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) graphics.lineTo(points[i].x, points[i].y);
}

function traceDashes(graphics, points, dash, gap) {
  let drawing = true, left = dash;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!length) continue;
    let at = 0;
    while (at < length) {
      const step = Math.min(left, length - at);
      if (drawing) {
        const start = at / length, end = (at + step) / length;
        graphics.moveTo(a.x + (b.x - a.x) * start, a.y + (b.y - a.y) * start);
        graphics.lineTo(a.x + (b.x - a.x) * end, a.y + (b.y - a.y) * end);
      }
      at += step;
      left -= step;
      if (left < 0.0001) { drawing = !drawing; left = drawing ? dash : gap; }
    }
  }
}

export class JourneyLight {
  constructor(look, mapZoom = () => 10) {
    this.look = look;
    this.mapZoom = mapZoom;
    this.tick = () => this.update();
    this.points = [];
    this.routes = [];
    this.zoom = null;
    this.routeZoom = null;
  }

  attach(frame) {
    this.destroy();
    this.frame = frame;
    this.routeGraphics = new PIXI.Graphics();
    this.routeGraphics.eventMode = "none";
    this.routeGraphics.blendMode = PIXI.BLEND_MODES.ADD;
    canvas.interface.addChildAt(this.routeGraphics, 0);
    this.graphics = new PIXI.Graphics();
    this.graphics.eventMode = "none";
    this.graphics.blendMode = PIXI.BLEND_MODES.ADD;
    canvas.interface.addChildAt(this.graphics, 1);
    canvas.app.ticker.add(this.tick);
  }

  setRoutes(geojson) {
    this.routes = this.frame ? (geojson?.features ?? []).filter((feature) => feature.geometry?.type === "LineString")
      .map((feature) => {
        const points = feature.geometry.coordinates.map(([lon, lat]) => latLonToScene(this.frame, lat, lon));
        const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
        return { kind: feature.properties?.kind, points, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
      }).filter((route) => route.points.length > 1) : [];
    this.routeZoom = null;
    this.update();
  }

  /**
   * Whether the roads' glow needs drawing again (0.69.2): once the zoom has been still for a moment
   * (in between, the lines drawn last scale with the map), or when the view leaves the stretch drawn.
   */
  #routesStale(zoom, band) {
    const now = performance.now();
    if (this.lastZoom !== zoom) { this.lastZoom = zoom; this.zoomedAt = now; }
    if (this.routeZoom === null || this.routeBand !== band) return true;
    if (Math.abs(this.routeZoom - zoom) / zoom >= 0.04 && now - this.zoomedAt >= SETTLE_MS) return true;
    const v = this.#view(0), d = this.drawnBox;
    return !d || v[0] < d[0] || v[1] < d[1] || v[2] > d[2] || v[3] > d[3];
  }

  /** The scene rectangle on screen, grown by a share of its size on each side. */
  #view(grow) {
    const { width, height } = canvas.app.renderer.screen, t = canvas.stage.worldTransform;
    const a = t.applyInverse({ x: 0, y: 0 }), b = t.applyInverse({ x: width, y: height }), gx = (b.x - a.x) * grow, gy = (b.y - a.y) * grow;
    return [a.x - gx, a.y - gy, b.x + gx, b.y + gy];
  }

  setPath(coords) {
    this.points = this.frame && coords?.length > 1
      ? coords.map(([lon, lat]) => latLonToScene(this.frame, lat, lon)) : [];
    this.zoom = null;
    this.update();
  }

  update() {
    if (!this.graphics) return;
    const night = this.look() === "night";
    const zoom = canvas.stage.scale.x || 1;
    const band = this.mapZoom() >= 4 ? 2 : this.mapZoom() >= 2 ? 1 : 0;
    this.routeGraphics.visible = night && band > 0 && this.routes.length > 0;
    if (this.routeGraphics.visible && this.#routesStale(zoom, band)) {
      this.routeZoom = zoom;
      this.routeBand = band;
      this.routeGraphics.clear();
      // Only the roads near the screen (a screen's width round it), and trail dashes sized to the
      // nearest doubling of the zoom, so zooming in does not multiply them without end.
      const box = this.drawnBox = this.#view(1), near = (r) => r.box[2] >= box[0] && r.box[0] <= box[2] && r.box[3] >= box[1] && r.box[1] <= box[3];
      const dashZoom = 2 ** Math.round(Math.log2(zoom));
      for (const kind of ["road", "trail"]) {
        if (kind === "trail" && band < 2) continue;
        const routes = this.routes.filter((route) => route.kind === kind && near(route));
        const strokes = kind === "road" ? [[6, 0xff5f43, 0.09], [1.4, 0xff8a68, 0.23]]
          : [[5, 0xff6548, 0.07], [1.2, 0xff9270, 0.19]];
        for (const [width, color, alpha] of strokes) {
          this.routeGraphics.lineStyle(width / zoom, color, alpha);
          for (const route of routes) {
            if (kind === "trail") traceDashes(this.routeGraphics, route.points, 9 / dashZoom, 6 / dashZoom);
            else trace(this.routeGraphics, route.points);
          }
        }
      }
    }
    this.graphics.visible = night && this.points.length > 1;
    if (!this.graphics.visible) return;
    if (this.zoom !== null && Math.abs(this.zoom - zoom) / zoom < 0.04) return;
    this.zoom = zoom;
    this.graphics.clear();
    for (const [width, color, alpha] of [[12, 0xffbe56, 0.06], [5, 0xffd478, 0.11], [1.2, 0xffedbd, 0.24]]) {
      this.graphics.lineStyle(width / zoom, color, alpha);
      trace(this.graphics, this.points);
    }
  }

  destroy() {
    canvas.app?.ticker?.remove(this.tick);
    this.routeGraphics?.destroy();
    this.routeGraphics = null;
    this.graphics?.destroy();
    this.graphics = null;
    this.frame = null;
    this.points = [];
    this.routes = [];
    this.zoom = null;
    this.routeZoom = null;
    this.drawnBox = null;
  }
}
