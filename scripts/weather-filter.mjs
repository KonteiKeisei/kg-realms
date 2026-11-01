// Weather effects on a realm map: only light presets run, for performance. Calendaria plays its
// weather through FXMaster's preset API (presets.switch); on a region scene any other preset
// stops the scene's effects instead.
export const ALLOWED_FX = new Set(["partly-cloudy", "cloudy", "overcast", "drizzle", "rain", "snow"]);

const presetsApi = () => globalThis.FXMASTER?.api?.presets ?? globalThis.game?.modules?.get?.("fxmaster")?.api?.presets ?? null;

async function stopAll(api) {
  for (const name of api.listActive?.() ?? []) await api.stop(name, { silent: true });
}

/** Wrap FXMaster's preset switch once. isRealm(scene) says whether a scene is a realm map. */
export function installWeatherFilter(isRealm) {
  const api = presetsApi();
  if (!api?.switch || api.switch.kgRealms) return;
  const original = api.switch.bind(api);
  const filtered = async function (name, options = {}) {
    if (isRealm(globalThis.canvas?.scene) && !ALLOWED_FX.has(name)) return stopAll(api);
    return original(name, options);
  };
  filtered.kgRealms = true;
  api.switch = filtered;
}

/** On entering a realm map, stop any effect that is not allowed there. */
export async function enforceWeatherFilter(isRealm) {
  const api = presetsApi();
  if (!api || !isRealm(globalThis.canvas?.scene)) return;
  const active = api.listActive?.() ?? [];
  if (active.some((n) => !ALLOWED_FX.has(n))) await stopAll(api);
}

