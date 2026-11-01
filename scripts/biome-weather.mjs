// The party's biome chooses Calendaria's climate zone (0.83): see biome-climate.mjs.
import { shippedClimates, climateZone, seasonKind, climateOf, zoneChange } from "./biome-climate.mjs";

const ID = "kg-realms", CAL = "calendaria", OVERRIDE = "climateZoneOverride";
const calendaria = () => (game.modules.get(CAL)?.active && globalThis.CALENDARIA?.managers?.WeatherManager ? globalThis.CALENDARIA : null);
const isPrimary = () => game.user === game.users.activeGM;

/** The names Calendaria may look a season up by: its stored name, translated, and the bare word. */
function seasonKeys(calendar) {
  const list = Object.values(calendar.seasons?.values ?? {}), out = [];
  list.forEach((s, i) => {
    const kind = seasonKind(s.name, i, list.length);
    const names = new Set([s.name, game.i18n?.localize?.(s.name), String(s.name ?? "").split(".").pop()].filter(Boolean));
    for (const key of names) out.push({ key, kind });
  });
  return out;
}

/**
 * Adds the biome climates the active calendar has not had yet. Each is added once per calendar, so
 * one the GM edits stays edited and one the GM deletes stays deleted.
 */
async function addClimates() {
  const C = calendaria();
  if (!C || !isPrimary()) return;
  const M = C.managers.CalendarManager, active = M.getActiveCalendar(), calendarId = active?.metadata?.id;
  if (!calendarId) return;
  const added = foundry.utils.deepClone(game.settings.get(ID, "biomeClimatesAdded") ?? {}), had = new Set(added[calendarId] ?? []);
  const data = active.toObject(), zones = (data.weather ??= { activeZone: null, zones: {} }).zones ??= {};
  const present = new Set(Object.values(zones).map((z) => z.id)), keys = seasonKeys(data);
  const missing = Object.entries(shippedClimates()).filter(([id]) => !had.has(id));
  if (!missing.length) return;
  let adding = 0;
  for (const [id, climate] of missing) {
    had.add(id);
    if (present.has(id)) continue;
    zones[foundry.utils.randomID()] = climateZone(id, climate, keys, () => foundry.utils.randomID());
    adding++;
  }
  try {
    if (adding) {
      const saved = C.api.isBundledCalendar(calendarId) ? await M.saveDefaultOverride(calendarId, data) : await M.updateCustomCalendar(calendarId, data);
      if (!saved) throw Error("Calendaria could not save them");
    }
    added[calendarId] = [...had];
    await game.settings.set(ID, "biomeClimatesAdded", added);
    if (adding) ui.notifications.info(`KG Realms: added ${adding} biome climates to the calendar. Edit them under Calendaria's Zone Climate.`);
  } catch (err) {
    console.error(`${ID} | biome climates`, err);
    ui.notifications.error(`KG Realms: could not add the biome climates to the calendar: ${err?.message ?? err}. It will try again next load.`, { permanent: true });
  }
}

// One at a time, on whichever calendar is active by then: two at once could add a climate twice.
let adding = Promise.resolve(), started = false;
export const installBiomeClimates = () => (adding = adding.catch(() => {}).then(addClimates));
/** Calendaria has finished starting, and any module's calendar is set: climates can go in from now on. */
export function startBiomeClimates() { started = true; return installBiomeClimates(); }
/** Calendaria announces its calendar while it is still starting: only a later switch counts. */
export function calendarSwitchedClimates() { if (started) installBiomeClimates().catch((err) => console.warn(`${ID} | biome climates:`, err)); }

/** Sets a scene's weather to a biome's climate: the primary GM, once per change. biome: null is open water. */
export async function setSceneClimate(scene, biome) {
  const C = calendaria();
  if (!C || !scene || !isPrimary()) return;
  const W = C.managers.WeatherManager, zones = W.getCalendarZones().map((z) => z.id);
  const want = zoneChange({ current: scene.getFlag(CAL, OVERRIDE) ?? null, lastSet: scene.getFlag(ID, "climateSet") ?? null, want: climateOf(biome), zones });
  if (!want) return;
  // The weather there, if the day's has not been rolled for it yet, before anyone looks. As part of
  // the day's plan, not a GM's override, so Calendaria keeps its forecast.
  if (!W.getCurrentWeather(want) && game.settings.get(CAL, "autoGenerateWeather")) await W.generateAndSetWeather({ zoneId: want, _fromPlan: true });
  await scene.update({ [`flags.${CAL}.${OVERRIDE}`]: want, [`flags.${ID}.climateSet`]: want });
}

/** On every client: a scene's zone changed, so what shows (the sky, its effects, the calendar's weather) follows. */
export function followClimate(scene, changes) {
  const zoneId = changes?.flags?.[CAL]?.[OVERRIDE];
  const C = calendaria();
  if (!zoneId || !C || scene !== globalThis.canvas?.scene) return;
  Hooks.callAll("calendaria.weatherChange", { previous: null, current: C.managers.WeatherManager.getCurrentWeather(zoneId), zoneId });
}
