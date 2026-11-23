// Skill challenges (0.97.0): the challenge under way, in one panel for the GM and the players.
//
// The run is kept on its scene, in the flag `challengeRun` (as JSON text, so a write replaces it whole).
// Everyone looking at that scene sees the panel. Only a GM changes the run; a player's roll and spell
// request go to the primary GM over the module socket, who checks them (the player owns that character,
// it may act, the option is offered and unused) and writes the run. Each change is made on the run as
// it stands in the scene, one at a time, so two arriving together can't undo each other.
//
// A player's view (0.98.2): the tracks, the stages by number, and who has acted. No read-aloud text,
// no approaches, no spells: nothing that guides them. Their own character's set-up rolls show as
// skill buttons with their bonus (a used one crossed out, the DC if the challenge shows DCs), and
// "Use a spell instead". The GM's: everything, with every DC; each approach a card to drag onto a
// character, and a Something else card (0.98.6); each character's set-up rolls (roll one, or Roll
// all), rulings on spell requests, skip, a success or failure of their own, next stage and end early.
// At the end, the result for everyone; the outcome's text and effects, and applying them, for the GM.
//
// Who takes part (0.98.4): nobody at the start. The GM adds the main party's player characters with a
// click (0.98.5), or anyone else by dragging an actor or a group from the Actors directory onto the
// panel, and can take them out again; a skip can be taken back for the stage.
//
// A test run (the builder's "Test this challenge"): the GM's view of the draft, kept nowhere, rolls
// quiet, effects not applied, with a switch to see the players' view of it.
import { shellHead, movable, placeKept } from "../ui-shell.mjs";
import { isPrimaryGM } from "../authority.mjs";
import {
  RESULTS, SPELL_EFFECTS, SKILLS, ABILITIES, optionLabel, startRun, currentStage, actedIn, canAct, requestSpell,
  ruleSpell, gmMark, skipActor, canAdvance, everyoneActed, nextStage, endEarly, contributions,
  addMember, removeMember, unskipActor, stillToAct,
  pendingRolls, pendingFor, assignRoll, unassignRoll, pendingTerms, canRollPending, rollPending, gmRule
} from "./model.mjs";
import { applyEffect, effectLine, postSummary } from "./effects.mjs";
import { sceneParties, groupMembers, partyMeta } from "../party-groups.mjs";

const ID = "kg-realms";
const SOCKET = `module.${ID}`;
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const signed = (n) => `${n >= 0 ? "+" : ""}${n}`;
const playersOf = (actor) => Array.from(game.users ?? []).filter((u) => u.active && !u.isGM && actor?.testUserPermission?.(u, "OWNER"));
/** The drag type of an approach card or the Something else card (never text/plain: Foundry's own drops ignore it). */
const CARD = "application/x-kgr-sc-card";
const ALL_OPTIONS = [...Object.keys(SKILLS).map((k) => `skill:${k}`).sort((a, b) => optionLabel(a).localeCompare(optionLabel(b))), ...Object.keys(ABILITIES).map((k) => `check:${k}`)];

/** The bonus an actor rolls an option with. */
export function optionBonus(actor, key) {
  const [type, k] = String(key).split(":");
  if (type === "skill") return Number(actor?.system?.skills?.[k]?.total ?? actor?.system?.skills?.[k]?.mod ?? 0) || 0;
  const ab = actor?.system?.abilities?.[k];
  return Number(ab?.check?.total ?? ab?.checkBonus ?? ab?.mod ?? 0) || 0;
}

/** The system's roll for an option, with its dialog and card. The total, or null if cancelled. */
export async function rollOption(actor, key, { dc = null, advantage = false, flavor = "", chat = true, dialog = true } = {}) {
  const [type, k] = String(key).split(":");
  try {
    if (foundry.utils.isNewerVersion(game.system.version, "3.99")) {
      const config = { ...(type === "skill" ? { skill: k } : { ability: k }), ...(dc != null ? { target: dc } : {}), ...(advantage ? { advantage: true } : {}) };
      const r = await (type === "skill" ? actor.rollSkill(config, dialog ? {} : { configure: false }, chat ? { data: { flavor } } : { create: false }) : actor.rollAbilityCheck(config, dialog ? {} : { configure: false }, chat ? { data: { flavor } } : { create: false }));
      const roll = Array.isArray(r) ? r[0] : r;
      return Number.isFinite(roll?.total) ? roll.total : null;
    }
    const opts = { ...(dc != null ? { targetValue: dc } : {}), ...(advantage ? { advantage: true } : {}), flavor, ...(dialog ? {} : { fastForward: true }), ...(chat ? {} : { chatMessage: false }) };
    const roll = await (type === "skill" ? actor.rollSkill(k, opts) : actor.rollAbilityTest(k, opts));
    return Number.isFinite(roll?.total) ? roll.total : null;
  } catch (err) {
    console.warn(`${ID} | skill challenge: the system's roll failed, rolling d20 + bonus instead:`, err);
    const roll = await new Roll(advantage ? "2d20kh + @mod" : "1d20 + @mod", { mod: optionBonus(actor, key) }).evaluate();
    if (chat) await roll.toMessage({ flavor, speaker: ChatMessage.getSpeaker({ actor }) });
    return roll.total;
  }
}

/**
 * The main party's player characters (0.98.5): the members of the party tokens on the scene; with
 * none there, of dnd5e's primary party; with none set, of party 1 of the KG parties; else the group
 * with the most player characters in it. Only characters
 * a player owns: not a wagon or a hireling.
 */
export function mainPartyCharacters(scene) {
  let groups = sceneParties(scene).map((t) => t.actor);
  if (!groups.length) {
    let primary = null;
    try { primary = game.settings.get("dnd5e", "primaryParty")?.actor ?? null; } catch { /* not this system's setting */ }
    if (primary?.type === "group") groups = [primary];
  }
  if (!groups.length) {
    const kg = Array.from(game.actors ?? []).filter((a) => a.type === "group" && partyMeta(a) && !partyMeta(a).retired).sort((a, b) => (partyMeta(a).number ?? 1) - (partyMeta(b).number ?? 1));
    if (kg.length) groups = [kg[0]];
  }
  if (!groups.length) {
    // A plain group of player characters, the one with the most of them.
    const scored = Array.from(game.actors ?? []).filter((a) => a.type === "group").map((g) => [g, groupMembers(g).filter((a) => a.type === "character" && a.hasPlayerOwner).length]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    if (scored.length) groups = [scored[0][0]];
  }
  const out = new Map();
  for (const g of groups) for (const a of groupMembers(g)) if (a.type === "character" && a.hasPlayerOwner) out.set(a.id, a);
  return [...out.values()];
}

/** The run on a scene, or null. */
export function sceneRun(scene) {
  const raw = scene?.getFlag?.(ID, "challengeRun");
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
}

export class ChallengeRun {
  constructor() {
    this.el = null; this.min = false; this.previewRun = null; this.asPlayer = false; this.spellFor = null;
    // The Something else form open on a character's row (0.98.6), and what's in it, kept across redraws.
    this.elseFor = null; this.elseForm = null;
    // Set-up rolls being rolled here, by id; a card drag under way (a redraw would end it).
    this.busy = new Set(); this.dragging = false; this.renderLater = false; this.rollingAll = false;
    this.queue = Promise.resolve(); this.html = "";
  }

  #resetLocal() { this.spellFor = null; this.elseFor = null; this.elseForm = null; }
  // viewAs (the test's players' view: whose player) is kept across switching views, and reset with a new test.

  /** The run under way on a scene (the viewed one by default). */
  activeRun(scene = canvas?.scene) { return sceneRun(scene); }
  get scene() { return canvas?.scene ?? null; }
  get run() { return this.previewRun ?? sceneRun(this.scene); }
  /** A test run: kept nowhere. */
  get isPreview() { return !!this.previewRun; }
  /** Whether this client sees the GM's view: a GM, unless testing and looking at the players' view. */
  get gmView() { return !!game.user.isGM && !(this.previewRun && this.asPlayer); }

  /* ---------------------------------------------------------------- the GM's side: changing the run */

  async start(scene, challenge, party) {
    const run = startRun(challenge, party, { now: game.time.worldTime, scene: scene.id, runId: foundry.utils.randomID() });
    this.previewRun = null; this.asPlayer = false; this.min = false; this.#resetLocal();
    await scene.setFlag(ID, "challengeRun", JSON.stringify(run));
    // The hook is the GM's to read out: the card everyone sees has only the name and the goal.
    ChatMessage.create({ speaker: { alias: run.name }, content: `<div class="kgr-challenge-card"><h3>${esc(run.name)}</h3><p><small>Skill challenge: ${run.goal.succ} successes before ${run.goal.fail} failures.</small></p></div>` });
    this.render();
  }

  /** A test run of the builder's draft for this GM: the GM's view, kept nowhere, nothing applied. */
  preview(challenge, party) {
    this.previewRun = startRun(challenge, party, { scene: canvas?.scene?.id ?? "", runId: "preview" });
    this.asPlayer = false; this.viewAs = null; this.min = false; this.#resetLocal();
    this.render();
  }

  show() { this.min = false; this.render(); }

  /**
   * Change the run (a GM only): fn(run) changes it and returns something truthy, or null to leave it.
   * On the scene's current run, one change at a time. A test run takes the change instead, unless it is
   * for the scene's run (`live`: a player's message, which a GM's test must not swallow).
   */
  change(fn, scene = this.scene, { live = false } = {}) {
    if (!game.user.isGM) return Promise.resolve(null);
    if (this.previewRun && !live) { const out = fn(this.previewRun); this.render(); return Promise.resolve(out); }
    const job = this.queue.then(async () => {
      const run = sceneRun(scene);
      if (!run) return null;
      const out = fn(run);
      if (out) await scene.setFlag(ID, "challengeRun", JSON.stringify(run));
      return out;
    }).catch((err) => { console.error(`${ID} | skill challenge:`, err); ui.notifications.error(`KG Realms: the challenge could not be updated: ${err.message}`); return null; });
    this.queue = job;
    return job;
  }

  async end(scene = this.scene) {
    if (this.previewRun) { this.previewRun = null; this.asPlayer = false; this.#resetLocal(); this.close(); return this.render(); }
    if (game.user.isGM && scene?.getFlag(ID, "challengeRun") !== undefined) await scene.unsetFlag(ID, "challengeRun");
    this.close();
  }

  /** A player's message, on the primary GM's client. */
  receive(m, userId) {
    if (!isPrimaryGM() || typeof m?.scene !== "string") return;
    const scene = game.scenes.get(m.scene), user = game.users.get(userId ?? m.user);
    if (!scene || !user) return;
    if (m.type === "challenge-roll") {
      // A player rolls only a roll the GM set up, for a character that player owns: the character, the
      // skills and the DC come from the run, not the message.
      return this.change((run) => {
        const p = run.id === m.run && pendingRolls(run).find((x) => x.id === m.pending);
        if (!p || !game.actors.get(p.actor)?.testUserPermission(user, "OWNER")) return null;
        return rollPending(run, p.id, { option: m.option, total: Number(m.total) });
      }, scene, { live: true });
    }
    const actor = game.actors.get(m.actor);
    if (!actor || !actor.testUserPermission(user, "OWNER")) return;
    if (m.type === "challenge-spell") {
      return this.change((run) => run.id === m.run && requestSpell(run, { actor: actor.id, spell: m.spell, text: m.text }), scene, { live: true }).then((ok) => {
        if (ok) ui.notifications.info(`KG Realms: ${actor.name} asks for ${m.spell} to count.`);
      });
    }
  }

  /* ---------------------------------------------------------------- rolling, either side */

  /**
   * Roll a set-up roll with one of its skills: the system's roll (with its dialog, unless Roll all),
   * then the GM records it, or a player sends it to the GM. Returns whether it was rolled.
   */
  async #rollPending(pendingId, option, { dialog = true } = {}) {
    const run = this.run, p = pendingRolls(run).find((x) => x.id === pendingId), actor = game.actors.get(p?.actor);
    if (!run || !p || !actor || this.busy.has(pendingId) || !canRollPending(run, p, option)) return false;
    const terms = pendingTerms(run, p);
    this.busy.add(pendingId); this.render();
    try {
      const showDC = game.user.isGM || run.rules.showDC;
      // The roll's card is public: the stage by number and the skill, never the stage's title or the approach's text.
      const flavor = `${run.name}: stage ${run.stage + 1}, ${optionLabel(option)}${terms.advantage ? " (advantage)" : ""}`;
      const total = await rollOption(actor, option, { dc: showDC ? terms.dc : null, advantage: terms.advantage, flavor, chat: !this.previewRun, dialog });
      if (total == null) return false;
      if (game.user.isGM) return !!(await this.change((r) => r.id === run.id && rollPending(r, pendingId, { option, total })));
      game.socket.emit(SOCKET, { type: "challenge-roll", scene: this.scene.id, run: run.id, pending: pendingId, option, total, user: game.user.id });
      return true;
    } catch (err) {
      console.error(`${ID} | skill challenge roll:`, err);
      ui.notifications.error(`KG Realms: the roll did not go through: ${err.message}`);
      return false;
    } finally { this.busy.delete(pendingId); this.render(); }
  }

  /** The skill Roll all uses for a set-up roll: the character's best that isn't used up, or null. */
  #bestOption(run, p) {
    const actor = game.actors.get(p.actor);
    return p.options.filter((o) => canRollPending(run, p, o)).sort((a, b) => optionBonus(actor, b) - optionBonus(actor, a))[0] ?? null;
  }

  /** The GM rolls every set-up roll not yet rolled, one after another, each with the character's best skill; stops at the end. */
  async #rollAll() {
    if (this.rollingAll) return;
    this.rollingAll = true;
    const skipped = [];
    try {
      for (const id of pendingRolls(this.run).map((p) => p.id)) {
        const run = this.run;
        if (!run || run.result) break;
        const p = pendingRolls(run).find((x) => x.id === id);
        if (!p || this.busy.has(id)) continue;
        const option = this.#bestOption(run, p);
        if (!option) { skipped.push(run.party.find((m) => m.id === p.actor)?.name ?? "someone"); continue; }
        await this.#rollPending(id, option, { dialog: false });
      }
    } finally { this.rollingAll = false; this.render(); }
    if (skipped.length) ui.notifications.warn(`KG Realms: not rolled, every skill on it is used up: ${skipped.join(", ")}. Take it off or set up another.`);
  }

  #askSpell(actorId) {
    const run = this.run, form = this.el?.querySelector(`[data-sc-spellform="${actorId}"]`);
    const spell = form?.querySelector("[name=spell]")?.value?.trim(), text = form?.querySelector("[name=text]")?.value?.trim() ?? "";
    if (!run || !spell) return ui.notifications.warn("KG Realms: name the spell first.");
    this.spellFor = null;
    if (game.user.isGM) return this.change((r) => requestSpell(r, { actor: actorId, spell, text }));
    game.socket.emit(SOCKET, { type: "challenge-spell", scene: this.scene.id, run: run.id, user: game.user.id, actor: actorId, spell, text });
    this.render();
  }

  /* ---------------------------------------------------------------- the view */

  close() { this.el?.remove(); this.el = null; this.html = ""; }

  render() {
    const run = this.run;
    if (!run) return this.close();
    if (!this.el) {
      this.el = document.createElement("section");
      this.el.className = "kgr-ui kgr-panel kgr-challenge-run";
      this.el.setAttribute("aria-label", "Skill challenge");
      this.el.addEventListener("click", (e) => { const b = e.target.closest("[data-sc]"); if (b && !b.disabled) { e.preventDefault(); this.#click(b); } });
      this.el.addEventListener("change", (e) => {
        const t = e.target;
        if (t.dataset?.scGive !== undefined) this.change((r) => { r.gives[t.dataset.scGive] = t.value; return true; });
        if (t.dataset?.scViewas !== undefined) { this.viewAs = t.value; this.spellFor = null; t.blur(); this.render(); }
      });
      // The Something else form's fields, kept on this client as they're typed, so a redraw keeps them.
      const keepElse = (e) => { const t = e.target; if (t.closest?.("[data-sc-else]") && this.elseForm && t.name) this.elseForm[t.name] = t.value; };
      this.el.addEventListener("input", keepElse);
      this.el.addEventListener("change", keepElse);
      const dropOk = () => game.user.isGM && this.gmView && !this.run?.result;
      const isCard = (e) => Array.from(e.dataTransfer?.types ?? []).includes(CARD);
      const clearTargets = () => this.el.querySelectorAll(".sc-target").forEach((x) => x.classList.remove("sc-target"));
      // An approach card, or the Something else card, dragged onto a character (0.98.6).
      this.el.addEventListener("dragstart", (e) => {
        const card = e.target.closest?.("[data-sc-card]");
        if (!card || !dropOk()) return;
        e.dataTransfer.setData(CARD, card.dataset.scCard);
        e.dataTransfer.effectAllowed = "copy";
        this.dragging = true; this.el.classList.add("sc-carding");
      });
      this.el.addEventListener("dragend", () => {
        this.dragging = false; this.el.classList.remove("sc-carding"); clearTargets();
        if (this.renderLater) { this.renderLater = false; this.render(); }
      });
      // The GM drops an actor (or a group) from the Actors directory anywhere on the panel to add them.
      this.el.addEventListener("dragover", (e) => {
        if (!dropOk()) return;
        if (isCard(e)) {
          const row = e.target.closest?.("[data-sc-person]");
          clearTargets();
          if (!row) return;
          e.preventDefault(); e.dataTransfer.dropEffect = "copy"; row.classList.add("sc-target");
          return;
        }
        e.preventDefault(); this.el.classList.add("sc-dropping");
      });
      this.el.addEventListener("dragleave", (e) => { if (!this.el.contains(e.relatedTarget)) { this.el.classList.remove("sc-dropping"); clearTargets(); } });
      this.el.addEventListener("drop", (e) => {
        this.el.classList.remove("sc-dropping"); clearTargets();
        if (!dropOk()) return;
        e.preventDefault();
        if (isCard(e)) return this.#dropCard(e.dataTransfer.getData(CARD), e.target.closest?.("[data-sc-person]")?.dataset.scPerson);
        this.#drop(e).catch((err) => { console.error(`${ID} | skill challenge drop:`, err); ui.notifications.error(`KG Realms: that could not be added: ${err.message}`); });
      });
      movable(this.el, "challenge-run", { redock: () => this.#place() });
      document.body.append(this.el);
    }
    // Not in the middle of dragging a card: a redraw would drop it. Once it ends.
    if (this.dragging) { this.renderLater = true; return; }
    // Don't redraw over a spell request or a note being typed (its fields only: a button keeps focus after a click).
    const f = document.activeElement;
    if (this.el.contains(f) && f.matches?.("[data-sc-spellform] input, [data-sc-keep] input, [data-sc-keep] select")) {
      if (!this.waitBlur) { this.waitBlur = true; f.addEventListener("blur", () => { this.waitBlur = false; this.render(); }, { once: true }); }
      return;
    }
    this.el.classList.toggle("kgr-min", this.min);
    const html = this.#html(run);
    if (html !== this.html) { this.el.innerHTML = html; this.html = html; }
    this.#place();
  }

  #place() { if (this.el && !placeKept(this.el, "challenge-run")) Object.assign(this.el.style, { left: "", top: "" }); }

  #head(run) {
    const stage = currentStage(run);
    const where = `stage ${run.stage + 1} of ${run.stages.length}`;
    const eyebrow = `${this.isPreview ? "Test" : "Skill challenge"} · ${run.result ? "complete" : this.gmView ? `${stage?.title ?? ""} · ${where}` : where}`;
    return shellHead({ icon: "fa-dice-d20", eyebrow, title: run.name, min: { attr: 'data-sc="min"', on: this.min }, close: game.user.isGM ? { attr: 'data-sc="close"', title: this.isPreview ? "End the test" : "Close the challenge for everyone" } : null });
  }

  #tracks(run, small = false) {
    const pips = (n, of, cls) => Array.from({ length: of }, (_, i) => `<span class="sc-pip ${cls} ${i < n ? "on" : ""}"></span>`).join("");
    if (small) return `<span class="sc-tracks small"><span role="img" aria-label="${run.succ} of ${run.goal.succ} successes">${pips(run.succ, run.goal.succ, "ok")}</span><span role="img" aria-label="${run.fail} of ${run.goal.fail} failures">${pips(run.fail, run.goal.fail, "no")}</span></span>`;
    // A manual result belongs to its track and consumes the optional note beside the tracks.
    const mark = (ok) => this.gmView && !run.result ? `<button type="button" data-sc="mark" data-ok="${ok ? 1 : 0}" class="sc-mark" title="Add a ${ok ? "success" : "failure"} that is nobody's roll">+ ${ok ? "Success" : "Failure"}</button>` : "";
    return `<div class="sc-tracks"><div class="sc-track"><span class="sc-lbl">Successes <b class="ok">${run.succ} / ${run.goal.succ}</b></span><span role="img" aria-label="${run.succ} of ${run.goal.succ} successes">${pips(run.succ, run.goal.succ, "ok")}</span>${mark(true)}</div>
      <div class="sc-track"><span class="sc-lbl">Failures <b class="no">${run.fail} / ${run.goal.fail}</b></span><span role="img" aria-label="${run.fail} of ${run.goal.fail} failures">${pips(run.fail, run.goal.fail, "no")}</span>${mark(false)}</div></div>`;
  }

  #html(run) {
    if (this.min) return this.#head(run);
    // In the players' view of a test, which character's player is looking (0.98.8).
    const seen = this.#viewedAs(run);
    const pick = this.asPlayer && run.party.length ? `<label class="sc-viewas">As the player of <select data-sc-viewas>${run.party.map((p) => `<option value="${p.id}" ${p.id === seen?.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>` : "";
    const banner = this.isPreview ? `<p class="sc-preview"><i class="fa-solid fa-flask"></i> <span>Test run: rolls are quiet, and nothing is saved, posted or applied.${this.asPlayer ? ` This is what ${run.party.length ? "that character's player sees" : "the players see"}.` : ""}</span>
      ${pick}<button type="button" data-sc="view-as">${this.asPlayer ? "Back to the GM's view" : "See the players' view"}</button></p>` : "";
    return `${this.#head(run)}<div class="sc-body">${banner}${run.result ? this.#outcome(run) : this.#stage(run)}</div>`;
  }

  #stage(run) {
    const gm = this.gmView, stage = currentStage(run), acted = actedIn(run);
    const rounds = run.stages.map((s, i) => {
      const acts = run.acts.filter((a) => a.stage === i && a.success != null);
      const sub = i < run.stage ? `${acts.filter((a) => a.success).length} ✓ ${acts.filter((a) => !a.success).length} ✗` : i === run.stage ? "now" : "";
      return `<div class="sc-round ${i < run.stage ? "done" : i === run.stage ? "now" : ""}"><b>${gm ? esc(s.title) : `Stage ${i + 1}`}</b><small>${esc(sub)}</small></div>`;
    }).join("");
    // The GM's alone: the read-aloud text, the approach cards (dragged onto a character) and the spells.
    let gmOnly = "";
    if (gm) {
      const grip = `<i class="fa-solid fa-grip-vertical sc-grip" aria-hidden="true"></i>`;
      const approaches = stage.approaches.map((a, j) => `<div class="sc-appr sc-card" draggable="true" data-sc-card="${j}" title="Drag onto a character to set up this roll for them"><b>${grip}${esc(a.options.map(optionLabel).join(" or "))}</b><span class="sc-dc">DC ${a.dc}</span><span>${esc(a.text)}</span></div>`).join("");
      const other = `<div class="sc-appr sc-card sc-else-card" draggable="true" data-sc-card="else" title="Drag onto a character: a success or failure you decide, or a roll you set up"><b>${grip}Something else</b><span></span><span>They try something the stage doesn't list: decide it, or set up a roll of your own.</span></div>`;
      const spells = stage.spells.length ? `<p class="sc-note"><i class="fa-solid fa-wand-sparkles"></i> Spells that count here: ${esc(stage.spells.join(", "))} (${esc(SPELL_EFFECTS[stage.spellEffect].toLowerCase())}).${stage.spellNote ? ` ${esc(stage.spellNote)}` : ""}</p>` : "";
      gmOnly = `${run.stage === 0 && run.hook ? `<p class="sc-read">${esc(run.hook)}</p>` : ""}${stage.read ? `<p class="sc-read">${esc(stage.read)}</p>` : ""}
      <div class="sc-sec"><span class="sc-lbl">Approaches <small>(drag a card onto a character: their player sees only the skills, never the text)</small></span>${approaches}${other}</div>${spells}`;
    }
    const markNote = gm ? '<label class="sc-marknote" data-sc-keep>Note for the next manual result (optional)<input name="marknote" maxlength="300"></label>' : "";
    return `${this.#tracks(run)}${markNote}<div class="sc-rounds">${rounds}</div>
      ${gmOnly}
      ${this.#mine(run)}
      <div class="sc-sec"><span class="sc-lbl">Taking part</span>${run.party.map((p) => this.#person(run, p, acted)).join("") || `<p class="sc-wait">${gm ? "Nobody yet: add who takes part below." : "The GM is choosing who takes part."}</p>`}</div>
      ${gm ? this.#addable(run) : ""}
      ${gm ? this.#gmBar(run) : ""}`;
  }

  /**
   * Who the GM can add with a click (0.98.5): the player characters of the main party, less those
   * already in. Anyone else is dragged in from the Actors directory.
   */
  #candidates(run) {
    const seen = new Set(run.party.map((p) => p.id));
    return mainPartyCharacters(game.scenes?.get(run.scene) ?? canvas?.scene).filter((a) => !seen.has(a.id)).map((a) => ({ id: a.id, name: a.name, img: a.img }));
  }

  /** The main party's members not yet in, as one row of chips, and where to drop anyone else. */
  #addable(run) {
    const list = this.#candidates(run);
    const chips = list.map((p) => `<button type="button" data-sc="add" data-actor="${p.id}" class="sc-chip" title="Add ${esc(p.name)}"><span class="cs-face">${p.img ? `<img src="${esc(p.img)}" alt="">` : esc(String(p.name ?? "?").slice(0, 1))}</span><span>${esc(p.name)}</span><i class="fa-solid fa-plus"></i></button>`).join("");
    return `<div class="sc-sec sc-adds" data-sc-drop><span class="sc-lbl">Add from the party${list.length > 1 ? ` <button type="button" data-sc="add-all" class="sc-addall">Add all ${list.length}</button>` : ""}</span>
      ${chips ? `<div class="sc-chips">${chips}</div>` : ""}
      <p class="sc-drop"><i class="fa-solid fa-hand-holding"></i> ${list.length ? "Anyone else: drag" : run.party.length ? "Everyone in the party is in. Anyone else: drag" : "No party found on this scene. Drag"} an actor (or a group) from the Actors directory onto this panel.</p></div>`;
  }

  /** An actor (or a group's members) dropped on the panel, by the GM: added to the challenge. */
  async #drop(event) {
    let data;
    try { data = JSON.parse(event.dataTransfer?.getData("text/plain") || "{}"); } catch { return; }
    if (data?.type !== "Actor") return;
    const actor = data.uuid ? await fromUuid(data.uuid) : game.actors.get(data.id);
    if (!actor) return;
    if (actor.pack) return ui.notifications.warn(`KG Realms: ${actor.name} is in a compendium. Import it into the world first.`);
    const people = actor.type === "group" ? groupMembers(actor) : [actor];
    if (!people.length) return ui.notifications.warn(`KG Realms: ${actor.name} has nobody in it.`);
    const list = people.map((a) => ({ id: a.id, name: a.name, img: a.img }));
    const added = await this.change((r) => list.map((p) => addMember(r, p)).some(Boolean));
    if (!added) ui.notifications.info(`KG Realms: ${people.length === 1 ? `${people[0].name} is` : "they are"} already taking part.`);
  }

  /**
   * A set-up roll's skill buttons, each with the character's bonus (a used one crossed out). For the GM
   * on the character's row, and for the player in their own box: skill names and the DC, nothing else.
   */
  #rollButtons(run, p) {
    const actor = game.actors.get(p.actor), busy = this.busy.has(p.id) || this.rollingAll;
    return p.options.map((o) => {
      const used = run.rules.noRepeat && (run.used[p.actor] ?? []).includes(o);
      return `<button type="button" data-sc="roll" data-pending="${p.id}" data-option="${o}" ${used || busy ? "disabled" : ""} class="${used ? "used" : ""}" title="${used ? `${esc(optionLabel(o))} is already used in this challenge` : `Roll ${esc(optionLabel(o))}`}">${esc(optionLabel(o))} <b>${signed(optionBonus(actor, o))}</b>${used ? " <small>used</small>" : ""}</button>`;
    }).join("");
  }

  /** A player's own character: the rolls the GM set up for them, and asking for a spell. */
  #picker(run, actor) {
    const boost = run.boosts?.[actor.id], showDC = run.rules.showDC, mine = pendingFor(run, actor.id);
    const boostNote = boost ? `<p class="sc-boost"><i class="fa-solid fa-wand-sparkles"></i> ${esc(boost.spell)}: your next roll is ${boost.adv ? "with advantage" : `at DC −${boost.dc}`}.</p>` : "";
    const rows = mine.map((p) => `<div class="sc-pick"><span>${this.busy.has(p.id) ? "Rolling… " : ""}${showDC ? `<b class="sc-dc">DC ${pendingTerms(run, p).dc}</b>` : ""}</span><span class="sc-opts">${this.#rollButtons(run, p)}</span></div>`).join("");
    const acts = run.acts.filter((a) => a.stage === run.stage && a.actor === actor.id).map((a) => `<p class="sc-done">${esc(this.#actText(a, showDC))}</p>`).join("");
    const wait = mine.length ? "" : `<p class="sc-wait"><i class="fa-solid fa-hourglass-half"></i> ${run.requests?.[actor.id] ? `Waiting for the GM to rule on ${esc(run.requests[actor.id].spell)}.` : "Waiting for the GM to call for a roll."}</p>`;
    const spell = canAct(run, actor.id).ok && !run.requests?.[actor.id] ? this.#spellAsk(run, actor, boost) : "";
    return `<div class="sc-mine"><b class="sc-turn">${mine.length ? `Your move, ${esc(actor.name)}` : esc(actor.name)}</b>${boostNote}${acts}${rows}${wait}${spell}</div>`;
  }

  /** "Use a spell instead", and its form. The stage's spells are suggested to the GM only. */
  #spellAsk(run, actor, boost) {
    if (!run.rules.spells || boost) return "";
    if (this.spellFor !== actor.id) return `<button type="button" data-sc="spell" data-actor="${actor.id}" class="sc-spellbtn"><i class="fa-solid fa-wand-sparkles"></i> Use a spell instead (the GM decides)</button>`;
    const list = this.gmView ? currentStage(run).spells : [];
    return `<div class="sc-spellform" data-sc-spellform="${actor.id}"><label><span class="sc-lbl">Spell</span><input name="spell" ${list.length ? `list="sc-spells-${actor.id}"` : ""} placeholder="Which spell">${list.length ? `<datalist id="sc-spells-${actor.id}">${list.map((s) => `<option value="${esc(s)}"></option>`).join("")}</datalist>` : ""}</label>
          <label><span class="sc-lbl">How it helps</span><input name="text" placeholder="What you do with it"></label>
          <span class="sc-row"><button type="button" data-sc="send-spell" data-actor="${actor.id}" class="primary">Ask the GM</button><button type="button" data-sc="spell-cancel">Cancel</button></span></div>`;
  }

  #mine(run) {
    if (this.gmView) return "";
    // A player (or the GM testing, in the players' view): their own characters in the challenge.
    // A test shows the one the GM picked, as their player would see it.
    const mine = (this.isPreview ? [this.#viewedAs(run)].filter(Boolean) : run.party).map((p) => game.actors.get(p.id)).filter((a) => a && (this.isPreview || a.isOwner));
    return mine.map((actor) => this.#picker(run, actor)).join("");
  }

  /** The character whose player the GM is looking as, in a test's players' view: the one picked, else the first. */
  #viewedAs(run) { return run.party.find((p) => p.id === this.viewAs) ?? run.party[0] ?? null; }

  /** The Something else form on a character's row: decide it (Success or Failure), or set up a roll; a note either way. */
  #elseForm(run, p) {
    const f = this.elseForm ?? { mode: "auto", option: "", dc: "15", note: "" }, roll = f.mode === "roll";
    const tab = (mode, label) => `<button type="button" data-sc="else-mode" data-mode="${mode}" class="${f.mode === mode ? "on" : ""}" aria-pressed="${f.mode === mode}">${label}</button>`;
    const pick = roll ? `<label class="sc-else-field"><span class="sc-lbl">Skill or check</span><select name="option"><option value="">Choose…</option>${ALL_OPTIONS.map((o) => `<option value="${o}" ${f.option === o ? "selected" : ""}>${esc(optionLabel(o))}</option>`).join("")}</select></label>
        <label class="sc-else-field dc"><span class="sc-lbl">DC</span><input name="dc" type="number" min="1" max="40" value="${esc(f.dc)}"></label>` : "";
    const go = roll ? `<button type="button" data-sc="else-roll" data-actor="${p.id}" class="primary">Set up the roll</button>`
      : `<button type="button" data-sc="else-ok" data-actor="${p.id}" data-ok="1" class="primary">Success</button><button type="button" data-sc="else-ok" data-actor="${p.id}" data-ok="0">Failure</button>`;
    return `<div class="sc-else" data-sc-keep data-sc-else="${p.id}"><span class="sc-else-tabs" role="group" aria-label="Something else">${tab("auto", "Automatic")}${tab("roll", "Roll")}</span>${pick}
      <input name="note" maxlength="300" value="${esc(f.note)}" placeholder="${roll ? "What they're trying (for you, not shown to players)" : "What they did (shown on the card)"}">
      <span class="sc-else-btns">${go}<button type="button" data-sc="else-cancel">Cancel</button></span></div>`;
  }

  #actText(a, showDC) {
    if (a.kind === "spell") return `${a.note}: automatic success`;
    if (a.kind === "gm") return `${a.success ? "Success" : "Failure"} (GM)${a.note ? `: ${a.note}` : ""}`;
    if (a.kind === "skip") return "Skipped this stage";
    return `${optionLabel(a.option)} ${a.total}${showDC ? ` vs DC ${a.dc}` : ""}: ${a.success ? "success" : "failure"}`;
  }

  /**
   * A character's row: what they did this stage, and for the GM the rolls set up for them (each rolled
   * with a skill button, or taken off), a spell request to rule on, the Something else form, Skip, and
   * taking them out. The GM drops a card on the row to set up a roll. Players see only what was done.
   */
  #person(run, p, acted) {
    const gm = this.gmView, actor = game.actors.get(p.id), req = run.requests?.[p.id];
    const acts = run.acts.filter((a) => a.stage === run.stage && a.actor === p.id), mine = pendingFor(run, p.id);
    const used = (run.used[p.id] ?? []).map(optionLabel).join(", ");
    const face = p.img ? `<img src="${esc(p.img)}" alt="">` : esc(p.name.slice(0, 1));
    const done = acts.map((a) => `<span class="sc-roll ${a.success === true ? "ok" : a.success === false ? "no" : ""}">${esc(this.#actText(a, gm || run.rules.showDC))}</span>${gm && a.kind === "skip" ? `<button type="button" data-sc="unskip" data-actor="${p.id}" title="Take back the skip: they can act this stage">Undo skip</button>` : ""}`).join("");
    let lines = "";
    if (gm) {
      const stage = currentStage(run);
      lines += mine.map((x) => {
        const what = x.approach != null ? stage.approaches[x.approach]?.options.map(optionLabel).join(" or ") ?? "Roll" : `Something else${x.text ? `: ${x.text}` : ""}`;
        return `<div class="sc-set"><span class="sc-set-what" title="${esc(x.approach != null ? stage.approaches[x.approach]?.text ?? "" : x.text)}"><i class="fa-solid fa-dice-d20"></i> ${esc(what)} <b class="sc-dc">DC ${pendingTerms(run, x).dc}</b>${this.busy.has(x.id) ? ` <span class="sc-muted">rolling…</span>` : ""}</span>
          <span class="sc-opts">${this.#rollButtons(run, x)}</span><button type="button" data-sc="unset" data-pending="${x.id}" class="sc-unset" title="Take this roll off" aria-label="Take this roll off"><i class="fa-solid fa-xmark"></i></button></div>`;
      }).join("");
      if (req) lines += `<div class="sc-set"><span class="sc-ask"><b>Asks for ${esc(req.spell)}</b>${req.text ? `<small>“${esc(req.text)}”</small>` : ""}</span>
        <span class="sc-opts"><button type="button" data-sc="rule" data-actor="${p.id}" data-d="allow" class="primary">Allow: ${{ auto: "success", dc2: "DC −2", adv: "advantage" }[currentStage(run).spellEffect]}</button>
        ${currentStage(run).spellEffect !== "dc2" ? `<button type="button" data-sc="rule" data-actor="${p.id}" data-d="dc2">DC −2</button>` : ""}
        <button type="button" data-sc="rule" data-actor="${p.id}" data-d="deny">Not enough</button></span></div>`;
      if (this.elseFor === p.id) lines += this.#elseForm(run, p);
    }
    let state = done;
    if (!done && !mine.length && !req) state = gm ? `<span class="sc-muted sc-hint">${actor && playersOf(actor).length ? "Drop a card here" : "No player online: drop a card, roll it here"}</span>` : "";
    if (!gm && !done && mine.length) state = `<span class="sc-muted">Has a roll to make</span>`;
    if (!gm && !done && req) state = `<span class="sc-muted">Asked for a spell</span>`;
    const skip = gm && !acts.length && !mine.length ? `<button type="button" data-sc="skip" data-actor="${p.id}" class="sc-skip" title="Nothing from them this stage">Skip</button>` : "";
    const remove = gm ? `<button type="button" data-sc="remove" data-actor="${p.id}" class="sc-remove" title="Take ${esc(p.name)} out of the challenge: what they already did still counts" aria-label="Remove ${esc(p.name)}"><i class="fa-solid fa-xmark"></i></button>` : "";
    const assign = gm ? `<div class="sc-lines"><label class="sc-assign" data-sc-keep><span>Approach</span><select data-sc-approach aria-label="Approach for ${esc(p.name)}">
      ${currentStage(run).approaches.map((approach, index) => `<option value="${index}">${esc(approach.options.map(optionLabel).join(" or "))} (DC ${approach.dc})</option>`).join("")}
      <option value="else">Something else</option></select><button type="button" data-sc="assign" data-actor="${p.id}">Assign</button></label></div>` : "";
    return `<div class="sc-person ${acted.has(p.id) ? "acted" : ""}" ${gm ? `data-sc-person="${p.id}"` : ""}><span class="cs-face">${face}</span><span class="sc-who"><b>${esc(p.name)}</b><small>${used ? `Used: ${esc(used)}` : "Nothing used yet"}</small></span><span class="sc-state">${state}${skip}${remove}</span>${lines ? `<div class="sc-lines">${lines}</div>` : ""}${assign}</div>`;
  }

  /** A card dropped on a character: an approach set up for them, or the Something else form opened on their row. */
  #dropCard(card, actorId) {
    const run = this.run;
    if (!run || !actorId || !run.party.some((p) => p.id === actorId)) return;
    if (card === "else") {
      this.elseFor = actorId; this.elseForm = { mode: "auto", option: "", dc: "15", note: "" };
      this.render();
      return this.el?.querySelector(`[data-sc-else="${actorId}"] [name=note]`)?.focus();
    }
    const j = Number(card);
    if (!Number.isInteger(j)) return;
    return this.change((r) => assignRoll(r, actorId, { approach: j }));
  }

  #gmBar(run) {
    const last = run.stage >= run.stages.length - 1, waiting = stillToAct(run).length, set = pendingRolls(run).length;
    const blocked = !canAdvance(run);
    const state = !run.party.length ? "Nobody is taking part." : `${everyoneActed(run) ? "Everyone has acted this stage." : `${waiting} still to act${blocked ? ": everyone must act first" : ""}.`}${set ? ` ${set} roll${set === 1 ? "" : "s"} set up, not rolled.` : ""}`;
    const rollAll = set ? `<button type="button" data-sc="roll-all" class="sc-rollall" ${this.rollingAll ? "disabled" : ""} title="Roll every set-up roll now, each with the character's best skill on it, no dialogs"><i class="fa-solid fa-dice"></i> ${this.rollingAll ? "Rolling…" : `Roll all ${set}`}</button>` : "";
    return `<div class="sc-gmbar"><span class="sc-muted grow">${state}</span>${rollAll}
      <details><summary>More actions</summary><button type="button" data-sc="end-early">End early</button></details>
      <button type="button" data-sc="next" class="primary" ${blocked ? "disabled" : ""}>${last ? "Finish" : "Next stage"}</button></div>`;
  }

  #outcome(run) {
    // Players see the result and who did what. The outcome's text and its effects are the GM's to give.
    const gm = this.gmView, test = game.user.isGM && this.isPreview, o = run.outcomes[run.result] ?? { text: "", effects: [] };
    const who = contributions(run).map((c) => `${esc(c.name)} ${c.marks || "–"}${c.spells.length ? ` (${esc(c.spells.join(", "))})` : ""}`).join(" · ");
    const effects = o.effects.map((e, i) => {
      const done = run.applied?.[i];
      let action = "";
      if (gm && e.kind !== "journal") {
        const give = e.kind === "item" ? `<label class="sc-give">Give to <select data-sc-give="${i}">${run.party.map((p) => `<option value="${p.id}" ${run.gives?.[i] === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>` : "";
        const label = { item: "Give", damage: "Post save and damage", exhaustion: "Apply", time: "Advance the clock" }[e.kind];
        action = `${give}<button type="button" data-sc="apply" data-i="${i}" ${done ? "disabled" : ""}>${done ? (test ? "Tried" : "Done") : test ? `${label} (test)` : label}</button>`;
      }
      return `<div class="sc-effect ${done ? "done" : ""}"><span><b>${esc(effectLine(e))}</b></span>${action}</div>`;
    }).join("");
    return `<div class="sc-result ${run.result}"><b>${esc(RESULTS[run.result])}</b>${this.#tracks(run, true)}<small>${run.succ} success${run.succ === 1 ? "" : "es"}, ${run.fail} failure${run.fail === 1 ? "" : "s"}</small></div>
      ${gm && o.text ? `<p class="sc-read big">${esc(o.text)}</p>` : ""}
      ${gm && effects ? `<div class="sc-sec"><span class="sc-lbl">${run.result === "fail" ? "Consequences" : "Rewards"}</span>${effects}</div>` : ""}
      <div class="sc-sec"><span class="sc-lbl">Who did what</span><span class="sc-muted">${who}</span></div>
      ${gm && !test ? `<div class="sc-gmbar"><span class="sc-muted grow">Players see the result until you close it.</span><button type="button" data-sc="summary">Post to chat</button><button type="button" data-sc="apply-all" class="primary">Apply the rest and close</button></div>` : ""}
      ${test ? `<div class="sc-gmbar"><span class="sc-muted grow">End of the test: nothing was applied.</span><button type="button" data-sc="close" class="primary">End the test</button></div>` : ""}`;
  }

  /* ---------------------------------------------------------------- clicks */

  async #apply(run, i) {
    const e = run.outcomes[run.result]?.effects?.[i];
    if (!e || run.applied?.[i] || e.kind === "journal") return;
    // A test applies nothing: no item given, no damage posted, the clock left alone.
    if (this.previewRun) {
      await this.change((r) => { r.applied[i] = true; return true; });
      return ui.notifications.info(`KG Realms: test, not applied: ${effectLine(e)}.`);
    }
    try {
      const done = await applyEffect(e, run, { actorId: run.gives?.[i] ?? run.party[0]?.id });
      await this.change((r) => { r.applied[i] = true; return true; });
      if (done) ui.notifications.info(`KG Realms: ${done}.`);
    } catch (err) {
      console.error(`${ID} | skill challenge effect:`, err);
      ui.notifications.error(`KG Realms: ${effectLine(e)} could not be applied: ${err.message}`);
    }
  }

  async #click(b) {
    const run = this.run, a = b.dataset.actor;
    if (!run) return;
    switch (b.dataset.sc) {
      case "min": this.min = !this.min; return this.render();
      case "roll": return this.#rollPending(b.dataset.pending, b.dataset.option);
      case "spell": this.spellFor = a; this.render(); return this.el.querySelector(`[data-sc-spellform="${a}"] [name=spell]`)?.focus();
      case "spell-cancel": this.spellFor = null; document.activeElement?.blur?.(); return this.render();
      case "send-spell": return this.#askSpell(a);
      case "close": {
        if (this.isPreview) return this.end();
        const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Close the skill challenge" }, content: `<p>Close <b>${esc(run.name)}</b> for everyone? ${run.result ? "Effects not yet applied are left unapplied." : "It hasn't finished: nothing from its outcomes is applied."}</p>` });
        return ok ? this.end() : null;
      }
    }
    if (!game.user.isGM) return;
    switch (b.dataset.sc) {
      case "assign": {
        if (!this.gmView || run.result) return;
        const card = b.closest(".sc-person")?.querySelector("[data-sc-approach]")?.value;
        if (card != null) return this.#dropCard(card, a);
        return;
      }
      case "view-as": this.asPlayer = !this.asPlayer; this.#resetLocal(); return this.render();
      case "unset": return this.change((r) => unassignRoll(r, b.dataset.pending));
      case "roll-all": return this.#rollAll();
      case "else-mode": if (this.elseForm) this.elseForm.mode = b.dataset.mode; return this.render();
      case "else-cancel": this.elseFor = null; this.elseForm = null; document.activeElement?.blur?.(); return this.render();
      case "else-ok": {
        const note = this.elseForm?.note?.trim() ?? "";
        this.elseFor = null; this.elseForm = null; document.activeElement?.blur?.();
        return this.change((r) => gmRule(r, a, b.dataset.ok === "1", note));
      }
      case "else-roll": {
        const f = this.elseForm ?? {};
        if (!f.option) return ui.notifications.warn("KG Realms: choose the skill or check first.");
        this.elseFor = null; this.elseForm = null; document.activeElement?.blur?.();
        return this.change((r) => assignRoll(r, a, { options: [f.option], dc: Number(f.dc), text: (f.note ?? "").trim() }));
      }
      case "add": {
        const p = this.#candidates(run).find((x) => x.id === a);
        return p ? this.change((r) => addMember(r, p)) : null;
      }
      case "add-all": {
        const list = this.#candidates(run);
        return this.change((r) => list.map((p) => addMember(r, p)).some(Boolean));
      }
      case "remove": {
        if (this.elseFor === a) { this.elseFor = null; this.elseForm = null; }
        return this.change((r) => removeMember(r, a));
      }
      case "unskip": return this.change((r) => unskipActor(r, a));
      case "rule": return this.change((r) => ruleSpell(r, a, b.dataset.d));
      case "skip": return this.change((r) => skipActor(r, a));
      case "mark": {
        const note = this.el.querySelector("[name=marknote]")?.value?.trim() ?? "";
        document.activeElement?.blur?.();
        return this.change((r) => gmMark(r, b.dataset.ok === "1", note));
      }
      case "next": {
        const set = pendingRolls(run).length;
        if (set) {
          const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Move on" }, content: `<p>${set} roll${set === 1 ? " is" : "s are"} set up and not rolled. Move on anyway? ${set === 1 ? "It is" : "They are"} dropped.</p>` });
          if (!ok) return null;
        }
        this.elseFor = null; this.elseForm = null;
        return this.change((r) => nextStage(r) && true);
      }
      case "end-early": {
        const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "End the challenge early" }, content: `<p>End it now with ${run.succ} successes and ${run.fail} failures? The outcome follows from those.</p>` });
        return ok ? this.change((r) => endEarly(r) && true) : null;
      }
      case "apply": return this.#apply(run, Number(b.dataset.i));
      case "summary": return this.isPreview ? null : postSummary(run);
      case "apply-all": {
        if (this.isPreview) return this.end();
        const effects = run.outcomes[run.result]?.effects ?? [];
        for (let i = 0; i < effects.length; i++) if (!run.applied?.[i] && effects[i].kind !== "journal") await this.#apply(sceneRun(this.scene) ?? run, i);
        await postSummary(sceneRun(this.scene) ?? run);
        return this.end();
      }
    }
  }
}
