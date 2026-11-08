/** Request character recovery after a camp whose time has already passed. */
export function promptCompletedCampRest(api, actors) {
  if (typeof api?.promptRest !== "function") return false;
  const ids = [...new Set(actors.map((actor) => actor?.id).filter(Boolean))];
  if (!ids.length) return false;

  // promptRest creates a chat request. D&D 5e's handleRestRequest sets advanceTime:false
  // for each response. RR's normal prompt UI advances time separately before creating
  // its request. No global RR setting or active profile is changed by this helper.
  // A camp is the party's daily long rest, so it is always a new day for Rest Recovery:
  // that is what makes it ask each character for food and water and run its daily
  // recovery. (0.96.6: before, a rest that began and ended on one calendar date, such as
  // 05:04 to 13:04, was sent as no new day, and Rest Recovery skipped food and water.)
  return api.promptRest(ids, true, true);
}
