/** Request character recovery after a camp whose time has already passed. */
export function promptCompletedCampRest(api, actors, { start, end, calendar } = {}) {
  if (typeof api?.promptRest !== "function") return false;
  const ids = [...new Set(actors.map((actor) => actor?.id).filter(Boolean))];
  if (!ids.length) return false;

  // promptRest creates a chat request. D&D 5e's handleRestRequest sets advanceTime:false
  // for each response. RR's normal prompt UI advances time separately before creating
  // its request. No global RR setting or active profile is changed by this helper.
  // Its newDay flag still needs to describe the night KG Realms has already played.
  let newDay = true;
  if (calendar?.timeToComponents && Number.isFinite(start) && Number.isFinite(end)) {
    const before = calendar.timeToComponents(start), after = calendar.timeToComponents(end);
    if (before && after) newDay = before.year !== after.year || before.month !== after.month || before.dayOfMonth !== after.dayOfMonth;
  }
  return api.promptRest(ids, true, newDay);
}
