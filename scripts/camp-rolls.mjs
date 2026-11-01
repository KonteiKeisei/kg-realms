import {partyScene,focusedScene} from './party-groups.mjs';
import { TASKS } from "./camp-tasks.mjs";
const MODULE = "kg-realms", rolling = new Set();

export function skillBonus(actor, skill) {
  const n = Number(actor?.system?.skills?.[skill]?.total ?? actor?.system?.skills?.[skill]?.mod ?? 0) || 0;
  return `(${n >= 0 ? "+" : ""}${n})`;
}

/** A roll belongs to one request in one camp, not to whichever night has the same number. */
export function campRequest(state, scene, key, actor, skill) {
  const w = state?.watch, campId = w?.campId;
  if (!campId || w.scene?.step === "done") return null;
  const c = key === "watch" ? w.asks?.watch : w.checks?.campId === campId ? w.checks?.[key] : null;
  if (!c || c.campId !== campId || c.done) return null;
  const requestId = key === "watch" ? c.requestId : c.requests?.[actor];
  const valid = key === "watch" ? c.actor === actor && c.skill === skill : w.tasks?.[actor] === key && TASKS[key]?.skills?.includes(skill);
  return valid && requestId ? { scene, campId, requestId, key, actor, skill, ...(state.partyId?{partyId:state.partyId}:{}) } : null;
}

export function matchingCampRequest(state, tag) {
  const current = tag && campRequest(state, tag.scene, tag.key, tag.actor, tag.skill);
  return !!current && current.campId === tag.campId && current.requestId === tag.requestId;
}

export async function rollCampRequest(tag, { showDC = true, flavor = "Camp check" } = {}) {
  const scene = partyScene(game.scenes.get(tag?.scene),tag?.partyId), state = scene?.getFlag(MODULE, "journey");
  if (scene?.partyId && focusedScene(scene.realScene)!==scene)return ui.notifications.info('Focus this party before making its camp checks.');
  if (!matchingCampRequest(state, tag)) return ui.notifications.info("KG Realms: this camp roll request has ended. Use the current camp's roll button.");
  const actor = game.actors.get(tag.actor), w = state.watch;
  const c = tag.key === "watch" ? w.asks.watch : w.checks[tag.key];
  if (!actor || !(game.user.isGM || actor.isOwner) || (tag.key === "watch" ? c.total != null : c.rolls?.[tag.actor]?.total != null)) return;
  const id = `${tag.scene}|${tag.requestId}`;
  if (rolling.has(id)) return;
  rolling.add(id);
  try {
    const dc = showDC ? c.dc : undefined, flags = { [MODULE]: { campRoll: tag } };
    const fatigue = tag.key === "watch" && c.disadvantage ? { disadvantage: true } : {};
    if (foundry.utils.isNewerVersion(game.system.version, "3.99")) return await actor.rollSkill({ skill: tag.skill, target: dc, ...fatigue }, {}, { data: { flavor, flags } });
    return await actor.rollSkill(tag.skill, { targetValue: dc, flavor, messageData: { flags }, ...fatigue });
  } finally { rolling.delete(id); }
}

/** The system's ability-check hook also covers skills and tools, including actor-sheet checks. */
export function applyWatchFatigue(config, camps) {
  if (!config?.subject?.id) return;
  for (const { camp, progress } of camps) if (camp.fatiguedOnWatch(config.subject.id, progress)) {
    config.disadvantage = true;
    return;
  }
}

export function campRollButton(tag, label) {
  const esc = foundry.utils.escapeHTML;
  return `<button type="button" data-kgr-camp-roll="${esc(JSON.stringify(tag))}">${esc(label)}</button>`;
}
