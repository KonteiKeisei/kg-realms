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

export function snapshotNeeded(old, snap, { force = false } = {}) {
  return force || !old || old.told !== snap.told || old.status !== snap.status || old.sailing !== snap.sailing
    || Math.abs((old.hour ?? 0) - snap.hour) >= 0.05 || old.until !== snap.until;
}
