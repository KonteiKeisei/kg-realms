import { pointAtHour } from "./travel.mjs";
import { favoredBiomeMultiplier } from "./favored-terrain.mjs";

const positive = (n, fallback) => Number.isFinite(n) && n > 0 ? n : fallback;

/** Walking changes use the unchanged route's original travel hours as their reference. */
export function walkingHistory(value, feet = 30) {
  const baseFeet = positive(value?.baseFeet, positive(feet, 30));
  const changes = (value?.changes ?? []).filter((c) => Number.isFinite(c.hour) && c.hour >= 0 && Number.isFinite(c.feet) && c.feet > 0).map((c) => ({ ...c })).sort((a, b) => a.hour - b.hour);
  return { baseFeet, ...(Array.isArray(value?.favored) ? { favored: [...value.favored] } : {}), changes };
}

/** Invert the timed track at the party's current travel hour, including inside a sample. */
export function baseTravelHour(track, hour) {
  if (!track?.length) return hour;
  let lo = 0, hi = track.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (track[mid].hour < hour) lo = mid + 1; else hi = mid; }
  const b = track[lo], a = track[Math.max(0, lo - 1)];
  const t = Math.max(0, Math.min(1, (hour - a.hour) / Math.max(1e-9, b.hour - a.hour)));
  return (a.baseHour ?? a.hour) + ((b.baseHour ?? b.hour) - (a.baseHour ?? a.hour)) * t;
}

/** Retain travelled timing and geometry. Apply walking and favored-biome changes from their boundaries. */
export function retimeWalking(result, value, { terrainAt } = {}) {
  const hasFavored = value?.favored?.length || value?.changes?.some(c => c.favored?.length);
  if (!result || (!value?.changes?.length && !hasFavored)) return result;
  const { baseFeet, changes, favored: initialFavored = [] } = walkingHistory(value);
  const boundaries = [...new Set([0, result.hours, ...result.legs.flatMap((l) => [l.start, l.start + l.hours]), ...changes.map((c) => c.hour), ...(hasFavored ? result.track.map(p => p.hour) : [])].filter((h) => h >= 0 && h <= result.hours))].sort((a, b) => a - b);
  let clock = 0, feet = baseFeet, favored = initialFavored, change = 0, leg = 0, sample = 0;
  const knots = boundaries.map((h, i) => {
    while (change < changes.length && changes[change].hour <= h + 1e-9) { const c = changes[change++]; feet = c.feet; if (Array.isArray(c.favored)) favored = c.favored; }
    while (leg + 1 < result.legs.length && result.legs[leg + 1].start <= h + 1e-9) leg++;
    const l = result.legs[leg];
    let ratio = !l?.sea && (l?.method ?? "foot") === "foot" ? baseFeet / feet : 1;
    while (sample + 1 < result.track.length && result.track[sample + 1].hour <= h + 1e-9) sample++;
    const p = result.track[sample];
    if (favored.length && terrainAt && !l?.sea && l?.method !== "flying" && !["river", "sea", "wind", "lane"].includes(p?.kind)) {
      const biome = (p.terrain ?? terrainAt(...p.at))?.biome, key = p.kind === "road" || p.kind === "trail" ? p.kind : "offroad", before = biome?.[key] ?? 1;
      ratio *= before / favoredBiomeMultiplier(before, biome?.type, favored);
    }
    const knot = { base: h, hour: clock, ratio };
    clock += Math.max(0, (boundaries[i + 1] ?? h) - h) * ratio;
    return knot;
  });
  const timeAt = (h) => {
    let lo = 0, hi = knots.length - 1;
    while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (knots[mid].base <= h) lo = mid; else hi = mid - 1; }
    const k = knots[lo]; return k.hour + (h - k.base) * k.ratio;
  };
  const track = result.track.map((p) => ({ ...p, baseHour: p.hour, hour: timeAt(p.hour) }));
  // An explicit sample at each change preserves the exact position when it happens between
  // existing samples. Otherwise interpolation would spread the slowdown into travelled ground.
  for (const c of changes) if (c.hour < result.hours && !track.some((p) => Math.abs(p.baseHour - c.hour) < 1e-9)) {
    const i = track.findIndex((p) => p.baseHour > c.hour);
    const at = pointAtHour(result.track, c.hour);
    const sample=result.track.findLast(p=>p.hour<=c.hour);
    track.splice(i < 0 ? track.length : i, 0, { kind:sample?.kind, waterway:sample?.waterway, terrain:sample?.terrain, worldId:sample?.worldId, regionTitle:sample?.regionTitle, miles: (()=>{const next=result.track.find(p=>p.hour>c.hour);const t=(c.hour-(sample?.hour??0))/Math.max(1e-9,(next?.hour??c.hour)-(sample?.hour??0));return sample?.miles==null?undefined:sample.miles+((next?.miles??sample.miles)-sample.miles)*t;})(), at, baseHour: c.hour, hour: timeAt(c.hour), leg: Math.max(0, result.legs.findLastIndex((l) => l.start <= c.hour)), timingBoundary: true });
  }
  const legs = result.legs.map((l) => {
    const start = timeAt(l.start), hours = timeAt(l.start + l.hours) - start;
    return { ...l, start, hours, days: Math.max(1, Math.ceil(hours / (l.sched.hoursPerDay ?? 8) - 1e-9)), sched: { ...l.sched, hours, samples: l.sched.samples.map((p) => ({ ...p, hour: timeAt(l.start + p.hour) - start })) } };
  });
  return { ...result, track, legs, hours: timeAt(result.hours), legEnds: result.legEnds.map(timeAt), sail: result.sail.map((s) => ({ from: timeAt(s.from), to: timeAt(s.to) })) };
}
