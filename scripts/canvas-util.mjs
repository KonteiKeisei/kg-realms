/**
 * A container for map art in the primary canvas group, sorted just above the scene
 * background and below tiles, drawings and tokens, and clipped to the scene rectangle.
 * It is lit and fogged like the rest of the scene.
 */
export function createMapRoot() {
  const rect = canvas.dimensions.sceneRect;
  const root = new PIXI.Container();
  root.sortableChildren = true;
  root.eventMode = "none";
  const mask = new PIXI.Graphics().beginFill(0xffffff).drawRect(rect.x, rect.y, rect.width, rect.height).endFill();
  root.addChild(mask);
  root.mask = mask;

  const bg = canvas.primary.background;
  root.elevation = bg?.elevation ?? -Infinity;
  root.sortLayer = bg?.sortLayer ?? 0;
  root.sort = Number.isFinite(bg?.sort) ? bg.sort + 1 : -1e9;
  root.zIndex = bg?.zIndex ?? 0;
  canvas.primary.addChild(root);
  return root;
}

/**
 * A container for the map's names and markers, in the interface group: above the scene's
 * effects (FXMaster region filters and weather ripple the map under it, never its names), clipped
 * to the scene rectangle, drawn before the rest of the interface (0.76).
 */
export function createLabelRoot() {
  const rect = canvas.dimensions.sceneRect;
  const root = new PIXI.Container();
  root.eventMode = "none";
  const mask = new PIXI.Graphics().beginFill(0xffffff).drawRect(rect.x, rect.y, rect.width, rect.height).endFill();
  root.addChild(mask);
  root.mask = mask;
  root.zIndex = -1000;
  canvas.interface.addChildAt(root, 0);
  return root;
}

/**
 * The scene-space rectangle and centre the screen currently shows. toLocal recomputes the
 * stage transform first: canvasPan fires before the next render would have done so.
 */
export function screenInScene() {
  const { width, height } = canvas.app.renderer.screen;
  const a = canvas.stage.toLocal(new PIXI.Point(0, 0));
  const b = canvas.stage.toLocal(new PIXI.Point(width, height));
  return { width, height, scale: canvas.stage.scale.x, x0: a.x, y0: a.y, x1: b.x, y1: b.y, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
}
