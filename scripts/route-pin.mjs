// Route edits during a journey (0.96.7): the way already travelled can't change. The route is worked
// out from where the journey set off, and the party's place on it comes from the hours travelled, so
// an edit to the leg the party is on used to redraw that leg from its start and move the party.
//
// keepTravelled() takes an edit (lists of waypoints and per-leg values, indexed as the journey has
// them) and where the party is: on leg `cur` (which ends at waypoint `cur`), partway along it or at
// its start. An edit to anything already behind the party is refused. An edit that would change the
// leg the party is on first puts a stop where the party stands (`pin`), so the leg so far ends there,
// unchanged, and the edit applies to the way on from it.

export const LEG_KEYS = ["stays", "legModes", "legMethods", "legVessels", "legFares", "legWays"];
/** The lists that shape where a leg goes (not how long a stop lasts, or its fare). */
const SHAPE_KEYS = ["waypoints", "legModes", "legMethods", "legVessels", "legWays"];
const KEYS = ["waypoints", ...LEG_KEYS];
const blank = (k) => (k === "stays" ? 0 : null);
const at = (list, i, k) => list?.[i] ?? blank(k);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const pad = (list, n, k) => { const x = [...(list ?? [])]; while (x.length < n) x.push(blank(k)); return x; };

/**
 * old: the journey's lists now. changes: the edit. where: { cur, mid, pin } (pin: the stop to put
 * where the party stands, when mid). Returns { changes, pinned } or { refused: true }.
 */
export function keepTravelled(old, changes, { cur, mid, pin }) {
  if (!Number.isInteger(cur) || cur < 0) return { changes, pinned: false };
  // Nothing behind the party may change. Its stay where it stands now (at the start of its leg) may.
  for (const k of KEYS) {
    if (!(k in changes)) continue;
    for (let i = 0; i < cur; i++) {
      if (k === "stays" && !mid && i === cur - 1) continue;
      if (!same(at(old[k], i, k), at(changes[k], i, k))) return { refused: true };
    }
  }
  const reshaped = SHAPE_KEYS.some((k) => k in changes && !same(at(old[k], cur, k), at(changes[k], cur, k)));
  if (!mid || !pin || !reshaped) return { changes, pinned: false };
  // The leg so far ends where the party stands, as it was; the edit goes on from there.
  const out = { ...changes };
  for (const k of KEYS) {
    const base = pad(k in changes ? changes[k] : old[k], cur, k);
    const first = k === "waypoints" ? pin : k === "stays" ? 0 : at(old[k], cur, k);
    // A fare stays with the half already being travelled.
    const rest = base.slice(cur);
    if (k === "legFares" && rest.length && same(rest[0], at(old[k], cur, k))) rest[0] = null;
    out[k] = [...pad(old[k], cur, k).slice(0, cur), first, ...rest];
  }
  return { changes: out, pinned: true };
}
