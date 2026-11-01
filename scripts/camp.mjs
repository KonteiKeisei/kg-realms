// Making camp: who sleeps how, the watch order, and foraging. Pure: no Foundry.
//
// A long rest is 8 hours, 6 or more asleep and up to 2 of light activity such as keeping watch.
// New camps have 4 hours of setup, 8 hours of rest/watches, then 4 hours of packing.
// Extra camp hours wait after rest, before packing. Saved older camps retain their timing.
// Those who sleep less can watch longer:
// an elf or drow trances 4 hours and can watch the other 4; a warforged does not sleep (6 hours of
// rest, awake) and can keep watch all night.

export const SLEEP = {
  full: { label: "Sleeps", hint: "Needs 8 h of rest: can watch 2 h", watch: 2 },
  trance: { label: "Trance", hint: "Trances 4 h: can watch 4 h", watch: 4 },
  none: { label: "Doesn't sleep", hint: "Rests 6 h awake: can watch all night", watch: 8 }
};

/** Foraging (within 100 feet of the camp): the Wisdom (Survival) DC by what the land offers. */
export const FORAGE = [
  { dc: 10, label: "Bountiful", hint: "forest or farmland in season, rivers and lakes" },
  { dc: 15, label: "Limited", hint: "hills, open plains, a lean season" },
  { dc: 20, label: "Very little", hint: "mountains, scrub, deep winter" },
  { dc: 25, label: "Scarce", hint: "desert, bare coast, the Underdark" },
  { dc: 30, label: "Desolate", hint: "glacial tundra, blighted land" }
];

/** The hours of the night the watches cover. */
export const WATCH_HOURS = 8;

/** New camps use 4 h setup, 8 h rest, then extra waiting and 4 h packing. */
export function campPhases(hours = 16, { legacy = false } = {}) {
  const total = Math.max(legacy ? 1 : 16, Math.min(72, Number(hours) || 16));
  const sleep = Math.min(WATCH_HOURS, total), setup = legacy ? total - sleep : 4;
  return { version: legacy ? 1 : 2, total, setup, sleep, wait: legacy ? 0 : total - 16,
    pack: legacy ? 0 : 4, watchEnd: setup + sleep, packFrom: legacy ? total : total - 4 };
}

/** Absolute phase bounds. An encounter hold extends the rest and every later boundary. */
export function campSchedule(phases, started, held = 0) {
  const at = (hours) => started + hours * 3600;
  return { started, setupEnd: at(phases.setup), restStart: at(phases.setup),
    restEnd: at(phases.watchEnd) + held, packStart: at(phases.packFrom) + held,
    end: at(phases.total) + held, held };
}

/**
 * How a character sleeps, from its sheet: a race or species, or a feature, named for it.
 * actor: { race (name), items: [{ name }] }. "none" for warforged (Sentry's Rest), "trance" for
 * elves, drow and the like (Trance), else "full".
 */
export function sleepOf({ race = "", items = [] } = {}) {
  const names = items.map((i) => String(i.name ?? "").toLowerCase()), r = String(race).toLowerCase();
  if (/warforged/.test(r) || names.some((n) => /sentry'?s rest|warforged/.test(n))) return "none";
  if (/\b(elf|elven|drow|eladrin|shadar-kai)\b/.test(r) || names.includes("trance")) return "trance";
  return "full";
}

/**
 * The watches: members [{ id, sleep }] in watch order, hours { id: hours } set by hand (0 sleeps
 * through; unset, the default). By default one who does not sleep keeps the whole night; otherwise
 * each in turn takes as much as they can (2 h, or 4 h trancing) until the night is covered.
 * joins { id: true }: that member watches with the watch before theirs: from its start, for their
 * own hours (a trancing elf with one who sleeps: 4 h beside 2 h). The watch lasts until the last of
 * them stops, and the next begins then.
 * Returns { watches: [{ id, from, to, with: [id], ends: { id: hour } }] (hours into the night; ends:
 * when each on it stops), sleepers: [id], covered, window }.
 */
export function planWatches(members, hours = {}, window = WATCH_HOURS, joins = {}) {
  const set = (id) => Number.isFinite(hours[id]);
  const wake = members.find((m) => m.sleep === "none" && !set(m.id) && !joins[m.id]);
  let at = 0;
  const watches = [], sleepers = [];
  for (const m of members) {
    const shared = joins[m.id] && watches.length ? watches.at(-1) : null, start = shared ? shared.from : at;
    // By hand; else all night (one who does not sleep), or as long as they can (2 h, 4 h trancing).
    const own = Math.min(SLEEP[m.sleep]?.watch ?? 2, window - start);
    let h = set(m.id) ? Math.max(0, Math.min(window, hours[m.id])) : shared ? own : wake ? (m === wake ? window : 0) : own;
    h = Math.min(h, window - start);
    if (h <= 0) { sleepers.push(m.id); continue; }
    if (shared) { shared.with.push(m.id); shared.ends[m.id] = start + h; shared.to = Math.max(shared.to, start + h); }
    else watches.push({ id: m.id, from: start, to: start + h, with: [], ends: { [m.id]: start + h } });
    at = watches.at(-1).to;
  }
  return { watches, sleepers, covered: at, window };
}

/** Those on a watch still awake at an hour into the night (in watch order). */
export function awakeAt(w, hour) {
  return [w.id, ...(w.with ?? [])].filter((id) => hour >= w.from - 1e-6 && hour < (w.ends?.[id] ?? w.to) - 1e-6);
}

/** The best at Survival among members [{ id, survival }]: its id, or null. */
export function bestForager(members) {
  let best = null;
  for (const m of members) if (!best || (m.survival ?? -99) > (best.survival ?? -99)) best = m;
  return best?.id ?? null;
}
