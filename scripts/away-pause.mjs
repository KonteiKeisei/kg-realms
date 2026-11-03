// Time away from a realm map (0.70): while the table is on another scene (a settlement, an
// encounter, anywhere), every journey on a realm map that is not the active scene stands still. The
// pause is a halt on the journey marked away, opened when the realm map stops being the active scene
// and closed when it is the active scene again; the journey then carries on as if no time had passed.
// A party split while away keeps its realm map journey (the party that travelled on); the parties
// split from it are placed beside it on the realm map when the table comes back.
import { familyActors, partyMeta, sceneParties, journeyScenes } from "./party-groups.mjs";

const ID = "kg-realms";

/**
 * A journey's halts with the away pause brought up to date. away: whether its realm map is not the
 * active scene. Returns the new halts, or null when nothing changes.
 */
export function awayHalts(halts = [], away, now) {
  const open = halts.find((h) => h.away && h.to == null);
  if (away && !open) return [...halts, { from: now, to: null, away: true }];
  if (!away && open) return halts.map((h) => (h === open ? { ...h, to: Math.max(h.from, now) } : h));
  return null;
}

/** Whether a journey is under way (departed and not yet arrived at its end). */
const underWay = (state) => !!state?.trip?.departed && !state?.done;

/**
 * Bring every realm map's journeys up to date with the active scene (the primary GM).
 * isRealm(scene): a realm map; write(scene, transform): the journey writer (journey-write.mjs).
 */
export async function reconcileAway({ isRealm, write, sameMap = (a,b)=>a===b, now = game.time.worldTime }) {
  const active = game.scenes.active;
  for (const real of game.scenes) {
    if (!isRealm(real)) continue;
    const away = !sameMap(real,active);
    for (const scene of journeyScenes(real)) {
      const state = scene.getFlag(ID, "journey");
      if (!underWay(state)) continue;
      const halts = awayHalts(state.trip.halts ?? [], away, now);
      if (halts) await write(scene, (s) => s.trip ? { trip: { ...s.trip, halts: awayHalts(s.trip.halts ?? [], away, now) ?? s.trip.halts } } : null);
    }
  }
}

/**
 * A realm map coming back into play: any party split from one travelling here while the table was
 * away (a group of the same family with no token on any realm map) is placed beside it.
 */
export async function placeSplitParties(scene, { isRealm }) {
  const here = sceneParties(scene), placed = [];
  for (const token of here) {
    for (const actor of familyActors(token.actor)) {
      if (partyMeta(actor)?.retired || !actor.system?.members?.length) continue;
      const onRealm = game.scenes.some((s) => isRealm(s) && Array.from(s.tokens ?? []).some((t) => t.actorId === actor.id));
      if (onRealm || placed.includes(actor.id)) continue;
      const g = scene.grid.size, data = foundry.utils.deepClone(token.toObject());
      delete data._id; delete data._stats; delete data.delta;
      const n = placed.length + 1;
      Object.assign(data, { actorId: actor.id, actorLink: true, name: actor.name, x: token.x + (token.width ?? 1) * g * n + 12 * n, y: token.y });
      data.flags = { ...(data.flags ?? {}), [ID]: { ...(data.flags?.[ID] ?? {}), partyFamily: partyMeta(actor)?.family ?? actor.id } };
      await scene.createEmbeddedDocuments("Token", [data]);
      placed.push(actor.id);
    }
  }
  if (placed.length) ui.notifications.info(`KG Realms: ${placed.map((id) => game.actors.get(id)?.name).join(", ")} split off while you were away, and ${placed.length === 1 ? "is" : "are"} now on the realm map beside ${here.length === 1 ? here[0].name : "their party"}.`);
  return placed;
}
