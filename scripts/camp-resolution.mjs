export const CAMP_RESOLUTIONS = {
  continue: { label: "Continue watches as normal", text: "Add the encounter's duration to this watch. The remaining watches and rest continue." },
  complete: { label: "End watches, complete rest", text: "Skip the remaining watches and advance to the end of rest. Apply recovery, then break camp. No more encounters this camp." },
  interrupted: { label: "Rest interrupted, pack up", text: "End rest now without recovery. Spend four hours breaking camp, then leave." },
  abandon: { label: "Abandon camp", text: "End rest without recovery or packing. Flee in a random direction and stop travel. The GM decides what was left behind." }
};

export function encounterTimeRemaining(now, started, totalMinutes) {
  return Math.max(0, Math.max(0, Number(totalMinutes) || 0) * 60 - Math.max(0, now - started));
}

export function interruptedCampPhases(plan, started, ended) {
  const restEnd = Math.max(plan.setup, (ended - started) / 3600);
  return { ...plan, version: 2, watchEnd: restEnd, packFrom: restEnd, total: restEnd + 4, wait: 0, pack: 4, interrupted: true };
}

/** Try a random heading, then other headings at the same distance; never silently reduce it. */
export function randomCampEscape(from, miles, milesPerPixel, valid = () => true, random = Math.random, pointForBearing = null) {
  const distance = Math.max(.1, Math.min(100, Number(miles) || 5)), radius = distance / milesPerPixel, angle = random() * Math.PI * 2;
  for (let i = 0; i < 32; i++) {
    const bearing = angle + i * 2.399963229728653;
    const at = pointForBearing ? pointForBearing(bearing,distance) : [from[0] + Math.cos(bearing) * radius, from[1] + Math.sin(bearing) * radius];
    if (Array.from({ length: 8 }, (_, k) => [from[0] + (at[0] - from[0]) * (k + 1) / 8, from[1] + (at[1] - from[1]) * (k + 1) / 8]).every(valid)) return { at, distance, bearing: ((bearing * 180 / Math.PI) % 360 + 360) % 360 };
  }
  return null;
}
