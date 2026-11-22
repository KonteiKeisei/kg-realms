// Route edits during a journey (0.96.7): the way already travelled can't change. The route is worked
// out from where the journey set off, and the party's place on it comes from the hours travelled, so
// an edit to the leg the party is on used to redraw that leg from its start and move the party.
//
// keepTravelled() takes an edit (lists of waypoints and per-leg values, indexed as the journey has
// them) and where the party is: on leg `cur` (which ends at waypoint `cur`), partway along it or at
// its start. An edit to anything already behind the party is refused. An edit that would change the
// leg the party is on first puts a stop where the party stands (`pin`), so the leg so far ends there,
// unchanged, and the edit applies to the way on from it.

// legTravel (0.97.3): the route-wide travel settings a leg already travelled was worked out with.
export const LEG_KEYS = ["stays", "legModes", "legMethods", "legVessels", "legFares", "legWays", "legTravel"];
/** Route-wide settings that time every leg: changing one mid-journey must not retime the way travelled. */
export const TRAVEL_KEYS = ["pace", "hours", "method", "methodMph", "coachMph"];
/** The lists that shape where a leg goes (not how long a stop lasts, or its fare). */
const SHAPE_KEYS = ["waypoints", "legModes", "legMethods", "legVessels", "legWays"];
const KEYS = ["waypoints", ...LEG_KEYS];
const blank = (k) => (k === "stays" ? 0 : null);
const at = (list, i, k) => list?.[i] ?? blank(k);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
// A stop's name is not the route (0.97.8): renaming one already passed is allowed.
const place = (w) => (w && typeof w === "object" ? (({ name, named, roadTitle, ...rest }) => rest)(w) : w);
const sameAt = (k, a, b) => (k === "waypoints" ? same(place(a), place(b)) : same(a, b));
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
      if (!sameAt(k, at(old[k], i, k), at(changes[k], i, k))) return { refused: true };
    }
  }
  const reshaped = SHAPE_KEYS.some((k) => k in changes && !sameAt(k, at(old[k], cur, k), at(changes[k], cur, k)));
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

/**
 * A change to pace, hours on the road or the way of travel during a journey (0.97.3). The party's
 * place comes from the hours travelled, so a slower pace used to turn the same hours into fewer miles
 * and move the party back, past camps already made. Now the legs behind the party (and the leg so
 * far, ended by a stop where it stands) keep the settings they were travelled with, in legTravel, and
 * the change applies from the party on. Returns { changes, pinned, frozen }.
 */
export function freezeTravel(old, changes, { cur, mid, pin }) {
  if (!Number.isInteger(cur) || cur < 0) return { changes, pinned: false, frozen: false };
  if (!TRAVEL_KEYS.some((k) => k in changes && !same(old[k], changes[k]))) return { changes, pinned: false, frozen: false };
  const pinned = !!(mid && pin);
  const lists = {};
  for (const k of KEYS) {
    const base = pad(old[k], cur, k);
    lists[k] = pinned ? [...base.slice(0, cur), k === "waypoints" ? pin : k === "stays" ? 0 : at(old[k], cur, k), ...base.slice(cur)] : [...(old[k] ?? [])];
  }
  // The leg so far is leg cur once a stop ends it there; otherwise the party is at the start of leg cur.
  const upto = pinned ? cur : cur - 1;
  const was = Object.fromEntries(TRAVEL_KEYS.map((k) => [k, old[k] ?? null]));
  const travel = pad(lists.legTravel, upto + 1, "legTravel");
  for (let i = 0; i <= upto; i++) travel[i] ??= was;
  const out = { ...changes, ...(pinned ? lists : {}), legTravel: travel };
  return { changes: out, pinned, frozen: true };
}
