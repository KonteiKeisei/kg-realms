// Shared borders (0.85): an outline defined once, on a shoreline, a biome zone or a place, can be used
// by the others in any order. What follows keeps a link ("shore:<id>", "biome:<id>", "place:<id>"), not
// a copy, so reshaping the one reshapes them all. Links are chosen by the GM; none is made by itself.
//
// index: { shores: waterways, zones: biome zones, places: places with their own fields }, each by id,
// as stored: what follows another is read through the link here. Pure: no Foundry.

const REFS = { shore: "shores", biome: "zones", place: "places" };
const isShore = (w) => w?.kind === "shore";
const lineOf = (pts) => Array.isArray(pts) && pts.length > 1;

/** What an item follows: a link it was given. (Places made in 0.84 keep theirs in .shore.) */
export const followOf = (item) => item?.follow || (item?.shore ? `shore:${item.shore}` : null);
/** What an item takes its outline from, for spotting circles: its link, or the place a biome zone was made from. */
const dependsOn = (item) => followOf(item) || (item?.place ? `place:${item.place}` : null);

function itemOf(ref, index) {
  const at = String(ref ?? "").indexOf(":");
  if (at < 0) return null;
  const kind = ref.slice(0, at), item = index[REFS[kind]]?.[ref.slice(at + 1)];
  return !item || (kind === "shore" && !isShore(item)) ? null : item;
}

/** The outline a link leads to: { pts, closed }, through any links on the way; null if it leads nowhere. */
export function borderOf(ref, index, seen = new Set()) {
  if (seen.has(ref)) return null;
  seen.add(ref);
  const item = itemOf(ref, index);
  if (!item) return null;
  const next = followOf(item);
  if (next) return borderOf(next, index, seen);
  if (ref.startsWith("biome:")) return item.disabled || !lineOf(item.pts) || item.pts.length < 3 ? null : { pts: item.pts, closed: true };
  if (ref.startsWith("place:")) return lineOf(item.area) ? { pts: item.area, closed: item.areaClosed !== false && item.area.length > 2 } : null;
  return lineOf(item.pts) ? { pts: item.pts, closed: !!item.closed && item.pts.length > 2 } : null;
}

/** Whether taking an outline from ref would lead back to self. */
function circles(ref, self, index) {
  const seen = new Set();
  for (let at = ref; at && !seen.has(at); at = dependsOn(itemOf(at, index))) {
    if (at === self) return true;
    seen.add(at);
  }
  return false;
}

/**
 * The outlines an item can follow: { ref, group, label, closed, same }, with those of its name first in
 * each group. Not itself, nothing that would lead back to it, and nothing with no outline yet.
 */
export function borderChoices(index, self = "", name = "", { closedOnly = false } = {}) {
  const fold = (s) => String(s ?? "").trim().toLowerCase(), want = fold(name), out = [];
  const add = (kind, group, unnamed) => {
    for (const [id, item] of Object.entries(index[REFS[kind]] ?? {})) {
      const ref = `${kind}:${id}`, border = borderOf(ref, index);
      if (ref === self || !border || circles(ref, self, index) || (closedOnly && !border.closed)) continue;
      out.push({ ref, group, label: String(item.name ?? "").trim() || unnamed, closed: border.closed, same: !!want && fold(item.name) === want });
    }
  };
  add("shore", "Shorelines", "Unnamed shoreline");
  add("biome", "Biome zones", "Unnamed zone");
  add("place", "Places", "Unnamed place");
  return out.sort((a, b) => b.same - a.same || a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
}

/** Which tab reshapes the outline a link leads to, for telling the GM where to go. */
export const borderHome = (ref) => (String(ref).startsWith("shore:") ? "the Waterways tab" : String(ref).startsWith("biome:") ? "the Biomes tab" : "the Places tab");

/** The Border select, for all three editors. Those of its own name go first, then by kind. */
export function borderSelect(attrs, choices, value, esc) {
  const groups = new Map();
  for (const c of choices) { const key = c.same ? "Same name" : c.group; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(c); }
  const options = [...groups].map(([group, list]) => `<optgroup label="${esc(group)}">${list.map((c) => `<option value="${esc(c.ref)}" ${c.ref === value ? "selected" : ""}>Follow: ${esc(c.label)}${c.closed ? "" : " (ends apart)"}</option>`).join("")}</optgroup>`).join("");
  return `<select ${attrs} aria-label="Border"><option value="">Its own border</option>${options}</select>`;
}

/** Waterways as used: a shoreline that follows takes the outline it leads to. followGone where that has gone. */
export function waterwaysWithBorders(waterways, index) {
  if (!Object.values(waterways).some((w) => w?.follow)) return waterways;
  const out = {};
  for (const [id, w] of Object.entries(waterways)) {
    if (!w?.follow) { out[id] = w; continue; }
    // followGone is only ever what is true now: an edit can save it, and the outline can come back.
    const b = borderOf(w.follow, index), { followGone, ...rest } = w;
    out[id] = b ? { ...rest, pts: b.pts, closed: b.closed || undefined } : { ...rest, followGone: true };
  }
  return out;
}

/** Biome zones as used: one that follows takes the outline it leads to, and stops counting if that does not close. */
export function zonesWithBorders(config, index) {
  const zones = config?.zones ?? {};
  if (!Object.values(zones).some((z) => z?.follow)) return config;
  const out = {};
  for (const [id, z] of Object.entries(zones)) {
    if (!z?.follow) { out[id] = z; continue; }
    const b = borderOf(z.follow, index), { holes, ...rest } = z;
    out[id] = b?.closed ? { ...rest, pts: b.pts } : { ...z, disabled: true, followGone: true };
  }
  return { ...config, zones: out };
}
