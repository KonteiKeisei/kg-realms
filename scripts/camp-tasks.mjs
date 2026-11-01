// Advanced watches: each character's activity during setup. Pure: no Foundry.
// One task each (doing one, a character can neither do nor help with another):
//  - Watch: no extra setup work. Workers may also watch, with disadvantage on watch checks.
//    Several on one shift: +5 to the check for each one past the first.
//    No one on watch: no check at all; the camp is surprised (unless alarms are set).
//  - Forage: search for food within 100 feet of the camp (Wisdom (Survival)). Leader with Help.
//  - Conceal the camp: camouflage, tracks cleared (Survival or Stealth). Each success counts as one
//    more watcher for the night's encounter dice: they stack.
//  - Set alarms: tripwires and the like (Survival or Sleight of Hand). Leader with Help. Success:
//    the night's Perception DC is 5 lower, and the camp cannot be surprised.
// Leader with Help: one leader rolls; each helper rolls too, and each success adds 1 to the leader's
// total, each failure takes 1 off.

export const TASKS = {
  watch: { label: "No setup work", icon: "fa-eye" },
  forage: { label: "Forage", icon: "fa-drumstick-bite", skills: ["sur"], help: true, setting: "taskForage", dc: 15 },
  conceal: { label: "Conceal the camp", icon: "fa-tree", skills: ["sur", "ste"], stack: true, setting: "taskConceal", dc: 10 },
  alarm: { label: "Set alarms", icon: "fa-bell", skills: ["sur", "slt"], help: true, setting: "taskAlarm", dc: 12 }
};

/** The night's Perception DC is this much lower when the alarms are set; and this much per extra watcher on a shift. */
export const ALARM_DC = 5, SHIFT_BONUS = 5;

/** Completed work survives a changed assignment, but never carries over from another camp. */
export function setupWork(watch, actor, plannedTask = null) {
  for (const key of ["forage", "conceal", "alarm"]) {
    const c = watch?.campId && watch.checks?.campId === watch.campId ? watch.checks[key] : null;
    if (watch?.campId && c?.campId === watch.campId && (c.rolls?.[actor]?.total != null || (c.done && c.workers?.includes(actor)))) return key;
  }
  return TASKS[plannedTask]?.skills ? plannedTask : null;
}

export function pastTaskSummary(key, result = {}) {
  if (key === "conceal") return `The camp was ${result.successes ? "concealed" : "not concealed"}. +${result.successes ?? 0} to the watch dice.`;
  if (key === "alarm") return `Alarms were ${result.success ? "set" : "not set"}.`;
  return result.success ? "Food was found." : "No food was found.";
}

/**
 * A Leader with Help check: rolls { id: { total } }, the leader's id, the DC. The leader's total,
 * +1 for each helper who made the DC and -1 for each who did not. Returns { total, base, helps:
 * [{ id, ok }], success } or null while the leader has not rolled.
 */
export function leaderWithHelp(rolls, leader, dc) {
  const lead = rolls?.[leader];
  if (lead?.total == null) return null;
  const helps = Object.entries(rolls).filter(([id, r]) => id !== leader && r?.total != null).map(([id, r]) => ({ id, ok: r.total >= dc }));
  const total = lead.total + helps.reduce((s, h) => s + (h.ok ? 1 : -1), 0);
  return { total, base: lead.total, helps, success: total >= dc };
}

/** Concealment: how many of the concealers made the DC (each one more watcher for the encounter dice). */
export function concealed(rolls, dc) {
  return Object.values(rolls ?? {}).filter((r) => r?.total != null && r.total >= dc).length;
}
