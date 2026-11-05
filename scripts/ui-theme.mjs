// Appearance only. Native dialogs retain their options, callbacks and return values.
export const WINDOW_THEMES = Object.freeze({
  slate: "Blue Slate (frosted blue and amber)",
  travel: "Chocolate (dark brown and gold)",
  oxblood: "Oxblood (dark red and gold)",
  royal: "Royal Blue (blue and gold)",
  emerald: "Emerald (green and gold)",
  amethyst: "Amethyst (purple and silver)",
  iron: "Iron (slate and ember)",
  holy: "Holy White (light, ivory and old gold)"
});

export function applyWindowTheme(value) {
  const theme = Object.hasOwn(WINDOW_THEMES, value) ? value : "slate";
  for (const key of Object.keys(WINDOW_THEMES)) document.body.classList.toggle(`kgr-theme-${key}`, key === theme);
}

export function applyGlassOpacity(value) {
  const n = Number(value);
  document.body.style.setProperty("--kgr-glass-opacity", `${Number.isFinite(n) ? Math.max(20, Math.min(100, n)) : 75}%`);
}

export function applyGlassBlur(value) {
  const n = Number(value);
  document.body.style.setProperty("--kgr-glass-blur", `${Number.isFinite(n) ? Math.max(0, Math.min(18, n)) : 8}px`);
}

export function registerWindowAppearance(register) {
  register("windowTheme", { name: "Window theme", hint: "The colours of all KG Realms windows, cards, editors and dialogs.", scope: "client", config: true, type: String, default: "slate", choices: WINDOW_THEMES, onChange: applyWindowTheme });
  register("windowOpacity", { name: "Window glass opacity", hint: "Lower values show more of the map through KG Realms windows. Buttons and fields stay darker for readability.", scope: "client", config: true, type: Number, range: { min: 20, max: 100, step: 5 }, default: 75, onChange: applyGlassOpacity });
  register("windowBlur", { name: "Window glass blur", hint: "Blur the map behind KG Realms windows. Set to 0 to disable backdrop blur.", scope: "client", config: true, type: Number, range: { min: 0, max: 18, step: 1 }, default: 8, onChange: applyGlassBlur });
  applyWindowTheme(game.settings.get("kg-realms", "windowTheme"));
  applyGlassOpacity(game.settings.get("kg-realms", "windowOpacity"));
  applyGlassBlur(game.settings.get("kg-realms", "windowBlur"));
}

export function dialogAppearance(options = {}) {
  return { ...options, classes: [...new Set([...(options.classes ?? []), "kgr-ui"])] };
}

export const RealmDialog = Object.freeze(Object.fromEntries(["wait", "confirm", "prompt"].map(method => [method, (options, ...args) => {
  const Dialog = foundry.applications.api.DialogV2;
  return Dialog[method](dialogAppearance(options), ...args);
}])));
