// Skill challenges (0.97.0): what an ending does, applied by the GM from the ending's view.
//  - An item: a copy on the character the GM picks.
//  - Damage: a chat card with dnd5e's own save and damage buttons ([[/save]] and [[/damage]]), so each
//    player rolls their save and the damage is applied the usual way (halved where it says so).
//  - Exhaustion: added to every character in the challenge, up to 6.
//  - Time: the world clock moves on.
//  - A journal entry: linked on the summary card.
import { RESULTS, ABILITIES, contributions } from "./model.mjs";

const ID = "kg-realms";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/** One line describing an effect. */
export function effectLine(e) {
  if (e.kind === "item") return `Item: ${e.name}`;
  if (e.kind === "journal") return `Journal: ${e.name}`;
  if (e.kind === "damage") return `${e.formula} ${e.type} damage${e.save ? `, DC ${e.dc} ${ABILITIES[e.save]} save for half` : ""}`;
  if (e.kind === "exhaustion") return `Exhaustion +${e.levels} for everyone`;
  if (e.kind === "time") return `${e.hours} hour${e.hours === 1 ? "" : "s"} pass`;
  return "";
}

const actorsOf = (run) => run.party.map((p) => game.actors.get(p.id)).filter(Boolean);

export async function giveItem(e, actorId) {
  const actor = game.actors.get(actorId), src = await fromUuid(e.uuid);
  if (!actor) throw new Error("that character is no longer in the world");
  if (!src) throw new Error(`${e.name} is not in this world`);
  const data = src.toObject();
  delete data._id;
  await actor.createEmbeddedDocuments("Item", [data]);
  return `${src.name} to ${actor.name}`;
}

export async function postDamage(e, run) {
  const save = e.save ? `[[/save ${e.save} ${e.dc}]] ` : "";
  await ChatMessage.create({
    speaker: { alias: run.name },
    content: `<div class="kgr-challenge-card"><p><b>${esc(run.name)}</b>: ${esc(RESULTS[run.result] ?? "")}</p><p>${save}[[/damage ${esc(e.formula)} ${esc(e.type)}]]</p><p><small>${esc(run.party.map((p) => p.name).join(", "))}${e.save ? ": roll the save, then the GM applies the damage, halved on a success." : ""}</small></p></div>`
  });
  return "damage card posted";
}

export async function addExhaustion(e, run) {
  const done = [];
  for (const actor of actorsOf(run)) {
    const now = Number(actor.system?.attributes?.exhaustion ?? 0) || 0;
    await actor.update({ "system.attributes.exhaustion": Math.min(6, now + e.levels) });
    done.push(actor.name);
  }
  return `exhaustion for ${done.join(", ")}`;
}

export async function passTime(e) {
  await game.time.advance(e.hours * 3600);
  return `${e.hours} hours passed`;
}

/** Apply one effect. gives: { index: actorId } for items. */
export async function applyEffect(e, run, { actorId = null } = {}) {
  if (e.kind === "item") return giveItem(e, actorId);
  if (e.kind === "damage") return postDamage(e, run);
  if (e.kind === "exhaustion") return addExhaustion(e, run);
  if (e.kind === "time") return passTime(e);
  return null;
}

/** The ending's summary card: the result, its text, who did what, and the effects (journals linked). */
export async function postSummary(run) {
  const o = run.outcomes[run.result] ?? { text: "", effects: [] };
  const who = contributions(run).filter((c) => c.marks).map((c) => `${esc(c.name)} ${c.marks}${c.spells.length || c.others.length ? ` (${esc([...c.spells, ...c.others].join("; "))})` : ""}`).join(" · ");
  const effects = o.effects.map((e) => `<li>${e.kind === "journal" ? `@UUID[${esc(e.uuid)}]{${esc(e.name)}}` : esc(effectLine(e))}</li>`).join("");
  await ChatMessage.create({
    speaker: { alias: run.name },
    content: `<div class="kgr-challenge-card"><h3>${esc(run.name)}: ${esc(RESULTS[run.result] ?? "")}</h3><p>${run.succ} success${run.succ === 1 ? "" : "es"}, ${run.fail} failure${run.fail === 1 ? "" : "s"}.</p>${o.text ? `<p>${esc(o.text)}</p>` : ""}${effects ? `<ul>${effects}</ul>` : ""}${who ? `<p><small>${who}</small></p>` : ""}</div>`
  });
}
