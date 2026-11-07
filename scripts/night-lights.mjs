// Settlement lights at night, drawn as real light on Foundry's lighting layer, so they glow
// through the scene's darkness (as a light source does) and sit under tokens. Each light is a
// warm radial glow sized to the settlement, steady (not animated): each a little brighter or dimmer
// than the next, from its id.
import { latLonToScene } from "./geo.mjs";

const SIZE = { City: 1, Town: 0.62, Village: 0.42, Hamlet: 0.3 };
const LIT = new Set(["Fortification", "Keep", "Fort", "Castle", "Temple", "Inn"]);

let glowTexture = null;
function glow() {
  if (glowTexture) return glowTexture;
  const S = 128, c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d"), grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, "rgba(255,214,150,1)");
  grad.addColorStop(0.2, "rgba(255,170,90,0.7)");
  grad.addColorStop(0.55, "rgba(255,120,45,0.22)");
  grad.addColorStop(1, "rgba(255,100,30,0)");
  g.fillStyle = grad; g.fillRect(0, 0, S, S);
  return (glowTexture = PIXI.Texture.from(c));
}

export class NightLights {
  constructor() { this.root = null; this.lights = []; this.tick = () => this.#update(); }

  /** places: the region's places (edits applied); frame: the map's projection on the scene. */
  draw(places, frame) {
    this.destroy();
    if (!frame) return;
    this.root = new PIXI.Container();
    this.root.eventMode = "none";
    // Light: the illumination layer brightens what it covers, like a light source. If that layer
    // is not available, an additive glow above the scene stands in.
    const lights = canvas.effects?.illumination?.lights;
    if (lights) lights.addChild(this.root);
    else { this.root.blendMode = PIXI.BLEND_MODES.ADD; canvas.interface?.addChildAt?.(this.root, 0); }
    for (const p of places) {
      if (p.hidden || /^Ruins?\b/i.test(p.name) || p.symbol === "ruin") continue;
      const size = SIZE[p.class] ?? (p.kind === "settlement" ? 0.34 : LIT.has(p.class) ? 0.22 : 0);
      if (!size) continue;
      const at = latLonToScene(frame, p.lat, p.lon);
      const s = new PIXI.Sprite(glow());
      s.anchor.set(0.5); s.position.set(at.x, at.y);
      s.blendMode = PIXI.BLEND_MODES.ADD;
      this.root.addChild(s);
      const seed = [...String(p.id)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 6283, 7) / 1000;
      this.lights.push({ s, size, bright: 0.82 + 0.12 * Math.sin(seed * 5) + 0.06 * Math.sin(seed) });
    }
    if (this.lights.length) canvas.app.ticker.add(this.tick);
    this.#update();
  }

  #update() {
    if (!this.root) return;
    // How dark the scene is: lights fade in from dusk.
    const dark = canvas.environment?.darknessLevel ?? canvas.scene?.environment?.darknessLevel ?? 0;
    const on = Math.max(0, Math.min(1, (dark - 0.3) / 0.4)) * (this.force ?? 1);
    this.root.visible = on > 0.01 && !globalThis.document?.hidden;
    if (!this.root.visible) return;
    const now = performance.now();
    if (now - (this.updatedAt ?? -Infinity) < 100) return;
    this.updatedAt = now;
    const zoom = canvas.stage.scale.x;
    const screen = canvas.app.renderer?.screen, transform = canvas.stage.worldTransform;
    const a = screen && transform?.applyInverse({x:0,y:0}), b = screen && transform?.applyInverse({x:screen.width,y:screen.height});
    // Real size on the map: a city glows about 6 miles across (the scene's grid is 100 px a
    // square), smaller places less. Zoomed out they shrink to points, never under 3 screen px;
    // zoomed in they stop growing at 60.
    const pxPerMile = (canvas.scene?.grid?.size ?? 100) / (canvas.scene?.grid?.distance || 20);
    for (const l of this.lights) {
      const radius = Math.max(3, Math.min(60, 3.2 * pxPerMile * l.size * zoom)) / zoom;
      l.s.visible = !a || !b || (l.s.position.x+radius >= a.x && l.s.position.x-radius <= b.x && l.s.position.y+radius >= a.y && l.s.position.y-radius <= b.y);
      if (!l.s.visible) continue;
      if (l.radius !== radius) { l.s.width = l.s.height = radius * 2; l.radius = radius; }
      // Only when dusk or dawn changes it: a steady light is not written again.
      const alpha = on * l.bright * 0.6;
      if (l.alpha !== alpha) { l.s.alpha = alpha; l.alpha = alpha; }
    }
  }

  destroy() {
    canvas.app?.ticker?.remove(this.tick);
    this.root?.destroy({ children: true });
    this.root = null;
    this.lights = [];
    this.updatedAt = null;
  }
}
