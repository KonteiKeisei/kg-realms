export const ROUTE_FIELDS = ["waypoints", "stays", "legModes", "legMethods", "legVessels", "method", "methodMph", "pace", "hours", "start"];

/** Camp checks and progress never change the route geometry. */
export function needsRouteRefresh(changes) {
  return Object.keys(changes ?? {}).some((key) => ROUTE_FIELDS.includes(key.split(".")[0]));
}

export function journeyKey(state) {
  return state?.trip ? `${state.trip.departed}|${JSON.stringify(state.start ?? null)}` : null;
}

/** Moving time is deliberately absent: it is not a new announced stop each second. */
export function progressKey(state, p) {
  return `${journeyKey(state)}|${p.status}|${p.stop ?? ""}|${p.encounter?.id ?? ""}|${p.status === "moving" ? "" : Math.round(p.since ?? 0)}`;
}

/**
 * Whether a scene update (an updateScene hook's changes) moves a journey's party and nothing else:
 * only `flags.kg-realms.journey.now` or `flags.kg-realms.partyJourneys.<party>.now`, besides
 * Foundry's own `_id` and `_stats`. Anything else in the update (encounters, the route, a camp, the
 * scene's name, another module's flag) makes it a real change. Reads nested and dotted keys alike.
 */
export function onlyJourneyProgress(changes) {
  if (!changes || typeof changes !== "object") return false;
  const leaves = [];
  const walk = (value, path) => {
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length) {
      for (const [key, child] of Object.entries(value)) walk(child, [...path, ...key.split(".")]);
    } else leaves.push(path);
  };
  walk(changes, []);
  const progress = (p) => p[0] === "flags" && p[1] === "kg-realms" && (
    (p[2] === "journey" && p[3] === "now") ||
    (p[2] === "partyJourneys" && p.length >= 5 && p[4] === "now"));
  let moved = false;
  for (const p of leaves) {
    if (p[0] === "_id" || p[0] === "_stats") continue;
    if (!progress(p)) return false;
    moved = true;
  }
  return moved;
}

export function snapshotNeeded(old, snap, { force = false } = {}) {
  return force || !old || old.told !== snap.told || old.status !== snap.status || old.sailing !== snap.sailing
    || Math.abs((old.hour ?? 0) - snap.hour) >= 0.05 || old.until !== snap.until;
}
