// Skill challenges (0.97.0): the challenge under way, in one panel for the GM and the players.
//
// The run is kept on its scene, in the flag `challengeRun` (as JSON text, so a write replaces it whole).
// Everyone looking at that scene sees the panel. Only a GM changes the run; a player's roll and spell
// request go to the primary GM over the module socket, who checks them (the player owns that character,
// it may act, the option is offered and unused) and writes the run. Each change is made on the run as
// it stands in the scene, one at a time, so two arriving together can't undo each other.
//
// A player's view (0.98.2): the tracks, the stages by number, and who has acted. No read-aloud text,
// no approaches, no spells: nothing that guides them. When the GM calls for rolls on an approach, its
// skills or checks show for their own character that hasn't acted, with their bonus (a used one
// crossed out, the DC if the challenge shows DCs), and "Use a spell instead". The GM's: everything,
// with every DC, a Call button on each approach, each character's state, rulings on spell requests,
// roll for or skip anyone, a success or failure of their own, next stage and end early. At the end,
// the result for everyone; the outcome's text and effects, and the buttons to apply them, for the GM.
//
// A test run (the builder's "Test this challenge"): the GM's view of the draft, kept nowhere, rolls
// quiet, effects not applied, with a switch to see the players' view of it.
import { shellHead, movable, placeKept } from "../ui-shell.mjs";
import { isPrimaryGM } from "../authority.mjs";
import {
  RESULTS, SPELL_EFFECTS, optionLabel, startRun, currentStage, actedIn, canAct, rollTerms, recordRoll, requestSpell,
  ruleSpell, gmMark, gmOverride, skipActor, canAdvance, everyoneActed, nextStage, endEarly, contributions,
  calledApproaches, isCalled, callApproach
} from "./model.mjs";
import { applyEffect, effectLine, postSummary } from "./effects.mjs";

const ID = "kg-realms";
const SOCKET = `module.${ID}`;
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const signed = (n) => `${n >= 0 ? "+" : ""}${n}`;
const playersOf = (actor) => Array.from(game.users ?? []).filter((u) => u.active && !u.isGM && actor?.testUserPermission?.(u, "OWNER"));

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

/** The run on a scene, or null. */
export function sceneRun(scene) {
  const raw = scene?.getFlag?.(ID, "challengeRun");
  if (!raw) return null;
  try { return typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
}

export class ChallengeRun {
  constructor() {
    this.el = null; this.min = false; this.previewRun = null; this.asPlayer = false; this.actingFor = null; this.spellFor = null; this.overrideFor = null;
    this.busy = new Set(); this.queue = Promise.resolve(); this.html = "";
  }

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
    this.previewRun = null; this.asPlayer = false; this.min = false; this.actingFor = null;
    await scene.setFlag(ID, "challengeRun", JSON.stringify(run));
    // The hook is the GM's to read out: the card everyone sees has only the name and the goal.
    ChatMessage.create({ speaker: { alias: run.name }, content: `<div class="kgr-challenge-card"><h3>${esc(run.name)}</h3><p><small>Skill challenge: ${run.goal.succ} successes before ${run.goal.fail} failures.</small></p></div>` });
    this.render();
  }

  /** A test run of the builder's draft for this GM: the GM's view, kept nowhere, nothing applied. */
  preview(challenge, party) {
    this.previewRun = startRun(challenge, party, { scene: canvas?.scene?.id ?? "", runId: "preview" });
    this.asPlayer = false; this.min = false; this.actingFor = null; this.overrideFor = null; this.spellFor = null;
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
    if (this.previewRun) { this.previewRun = null; this.asPlayer = false; this.actingFor = null; this.overrideFor = null; this.close(); return this.render(); }
    if (game.user.isGM && scene?.getFlag(ID, "challengeRun") !== undefined) await scene.unsetFlag(ID, "challengeRun");
    this.close();
  }

  /** A player's message, on the primary GM's client. */
  receive(m, userId) {
    if (!isPrimaryGM() || typeof m?.scene !== "string") return;
    const scene = game.scenes.get(m.scene), user = game.users.get(userId ?? m.user), actor = game.actors.get(m.actor);
    if (!scene || !user || !actor || !actor.testUserPermission(user, "OWNER")) return;
    if (m.type === "challenge-roll") {
      // A player rolls only on an approach the GM is calling for.
      return this.change((run) => run.id === m.run && run.stage === m.stage && isCalled(run, m.approach) && recordRoll(run, { actor: actor.id, approach: m.approach, option: m.option, total: Number(m.total) }), scene, { live: true });
    }
    if (m.type === "challenge-spell") {
      return this.change((run) => run.id === m.run && requestSpell(run, { actor: actor.id, spell: m.spell, text: m.text }), scene, { live: true }).then((ok) => {
        if (ok) ui.notifications.info(`KG Realms: ${actor.name} asks for ${m.spell} to count.`);
      });
    }
  }

  /* ---------------------------------------------------------------- rolling, either side */

  /** Who rolls for a character on this client: its online player; the GM when there's none, or always when picking for them. */
  #rollsHere(actor) {
    if (!actor) return false;
    if (this.previewRun) return game.user.isGM;
    if (game.user.isGM) return this.actingFor === actor.id || !playersOf(actor).length;
    return actor.isOwner;
  }

  async #roll(actorId, approach, option) {
    const run = this.run, actor = game.actors.get(actorId), stage = currentStage(run);
    if (!run || !actor || !stage || this.busy.has(actorId) || !canAct(run, actorId, option).ok) return;
    const terms = rollTerms(run, actorId, approach);
    this.busy.add(actorId); this.render();
    try {
      const showDC = game.user.isGM || run.rules.showDC;
      // The roll's card is public: the stage by number, never its title.
      const flavor = `${run.name}: stage ${run.stage + 1}, ${optionLabel(option)}${terms.advantage ? " (advantage)" : ""}`;
      const total = await rollOption(actor, option, { dc: showDC ? terms.dc : null, advantage: terms.advantage, flavor, chat: !this.previewRun, dialog: true });
      if (total == null) return;
      const msg = { actor: actorId, approach, option, total };
      if (game.user.isGM) await this.change((r) => r.id === run.id && r.stage === run.stage && recordRoll(r, msg));
      else game.socket.emit(SOCKET, { type: "challenge-roll", scene: this.scene.id, run: run.id, stage: run.stage, user: game.user.id, ...msg });
      if (this.actingFor === actorId) this.actingFor = null;
    } catch (err) {
      console.error(`${ID} | skill challenge roll:`, err);
      ui.notifications.error(`KG Realms: the roll did not go through: ${err.message}`);
    } finally { this.busy.delete(actorId); this.render(); }
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
      this.el.addEventListener("change", (e) => { const t = e.target; if (t.dataset?.scGive !== undefined) this.change((r) => { r.gives[t.dataset.scGive] = t.value; return true; }); });
      movable(this.el, "challenge-run", { redock: () => this.#place() });
      document.body.append(this.el);
    }
    // Don't redraw over a spell request being typed (its text fields only: a button keeps focus after a click).
    const f = document.activeElement;
    if (this.el.contains(f) && f.matches?.("[data-sc-spellform] input, [data-sc-keep] input")) {
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
    return `<div class="sc-tracks"><div class="sc-track"><span class="sc-lbl">Successes <b class="ok">${run.succ} / ${run.goal.succ}</b></span><span role="img" aria-label="${run.succ} of ${run.goal.succ} successes">${pips(run.succ, run.goal.succ, "ok")}</span></div>
      <div class="sc-track"><span class="sc-lbl">Failures <b class="no">${run.fail} / ${run.goal.fail}</b></span><span role="img" aria-label="${run.fail} of ${run.goal.fail} failures">${pips(run.fail, run.goal.fail, "no")}</span></div></div>`;
  }

  #html(run) {
    if (this.min) return this.#head(run);
    const banner = this.isPreview ? `<p class="sc-preview"><i class="fa-solid fa-flask"></i> <span>Test run: rolls are quiet, and nothing is saved, posted or applied.${this.asPlayer ? " This is what the players see." : ""}</span>
      <button type="button" data-sc="view-as">${this.asPlayer ? "Back to the GM's view" : "See the players' view"}</button></p>` : "";
    return `${this.#head(run)}<div class="sc-body">${banner}${run.result ? this.#outcome(run) : this.#stage(run)}</div>`;
  }

  #stage(run) {
    const gm = this.gmView, stage = currentStage(run), acted = actedIn(run);
    const rounds = run.stages.map((s, i) => {
      const acts = run.acts.filter((a) => a.stage === i && a.success != null);
      const sub = i < run.stage ? `${acts.filter((a) => a.success).length} ✓ ${acts.filter((a) => !a.success).length} ✗` : i === run.stage ? "now" : "";
      return `<div class="sc-round ${i < run.stage ? "done" : i === run.stage ? "now" : ""}"><b>${gm ? esc(s.title) : `Stage ${i + 1}`}</b><small>${esc(sub)}</small></div>`;
    }).join("");
    // The GM's alone: the read-aloud text, the approaches (with a Call button each) and the spells.
    let gmOnly = "";
    if (gm) {
      const approaches = stage.approaches.map((a, j) => {
        const on = isCalled(run, j);
        return `<div class="sc-appr ${on ? "called" : ""}"><b>${esc(a.options.map(optionLabel).join(" or "))}</b><span class="sc-dc">DC ${a.dc}</span><span>${esc(a.text)}</span>
          <button type="button" data-sc="call" data-appr="${j}" class="sc-call ${on ? "on" : ""}" aria-pressed="${on}" title="${on ? "Players can roll this now: click to stop calling for it" : "Call for these rolls: the players see these skills and can roll them"}"><i class="fa-solid ${on ? "fa-bullhorn" : "fa-hand-pointer"}"></i> ${on ? "Calling" : "Call for rolls"}</button></div>`;
      }).join("");
      const spells = stage.spells.length ? `<p class="sc-note"><i class="fa-solid fa-wand-sparkles"></i> Spells that count here: ${esc(stage.spells.join(", "))} (${esc(SPELL_EFFECTS[stage.spellEffect].toLowerCase())}).${stage.spellNote ? ` ${esc(stage.spellNote)}` : ""}</p>` : "";
      gmOnly = `${run.stage === 0 && run.hook ? `<p class="sc-read">${esc(run.hook)}</p>` : ""}${stage.read ? `<p class="sc-read">${esc(stage.read)}</p>` : ""}
      <div class="sc-sec"><span class="sc-lbl">Approaches <small>(players see only what you call for)</small></span>${approaches}</div>${spells}`;
    }
    return `${this.#tracks(run)}<div class="sc-rounds">${rounds}</div>
      ${gmOnly}
      ${this.#mine(run)}
      <div class="sc-sec"><span class="sc-lbl">The party</span>${run.party.map((p) => this.#person(run, p, acted)).join("")}</div>
      ${gm ? this.#gmBar(run) : ""}`;
  }

  /** The approach picker for one character on this client: their own, or the one the GM picks for. */
  #picker(run, actor) {
    const stage = currentStage(run), terms = (j) => rollTerms(run, actor.id, j), boost = run.boosts?.[actor.id];
    const gm = this.gmView, showDC = gm || run.rules.showDC, busy = this.busy.has(actor.id);
    // The GM rolling for someone picks from every approach; a player only from those called for, by skill name alone.
    const shown = gm ? stage.approaches.map((_, j) => j) : calledApproaches(run);
    if (!shown.length && !gm) return `<div class="sc-mine"><b class="sc-turn">${esc(actor.name)}</b><p class="sc-wait"><i class="fa-solid fa-hourglass-half"></i> Waiting for the GM to call for a roll.</p>${this.#spellAsk(run, actor, boost)}</div>`;
    const rows = shown.map((j) => [stage.approaches[j], j]).map(([a, j]) => `<div class="sc-pick"><span>${esc(gm ? a.text || a.options.map(optionLabel).join(" or ") : a.options.map(optionLabel).join(" or "))}${showDC ? ` <b class="sc-dc">DC ${terms(j).dc}</b>` : ""}</span><span class="sc-opts">${a.options.map((o) => {
      const used = run.rules.noRepeat && (run.used[actor.id] ?? []).includes(o);
      return `<button type="button" data-sc="roll" data-actor="${actor.id}" data-appr="${j}" data-option="${o}" ${used || busy ? "disabled" : ""} class="${used ? "used" : ""}" title="${used ? `${esc(optionLabel(o))} is already used in this challenge` : ""}">${esc(optionLabel(o))} <b>${signed(optionBonus(actor, o))}</b>${used ? " <small>used</small>" : ""}</button>`;
    }).join("")}</span></div>`).join("");
    const boostNote = boost ? `<p class="sc-boost"><i class="fa-solid fa-wand-sparkles"></i> ${esc(boost.spell)}: your next roll is ${boost.adv ? "with advantage" : `at DC −${boost.dc}`}.</p>` : "";
    return `<div class="sc-mine"><b class="sc-turn">${gm && this.actingFor === actor.id ? `Rolling for ${esc(actor.name)}` : `Your move, ${esc(actor.name)}`}</b>${boostNote}${rows}${this.#spellAsk(run, actor, boost)}${gm && this.actingFor ? `<button type="button" data-sc="act-for" data-actor="">Done</button>` : ""}</div>`;
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
    if (this.gmView) {
      const actor = this.actingFor ? game.actors.get(this.actingFor) : null;
      return actor && canAct(run, actor.id).ok ? this.#picker(run, actor) : "";
    }
    // A player (or the GM testing, in the players' view): their characters in the challenge that can act now, and the state of the others.
    // A test shows the first character's view, as their player would see it.
    const mine = (this.isPreview ? run.party.slice(0, 1) : run.party).map((p) => game.actors.get(p.id)).filter((a) => a && (this.isPreview || a.isOwner));
    if (!mine.length) return "";
    return mine.map((actor) => {
      if (run.requests?.[actor.id]) return `<p class="sc-wait"><i class="fa-solid fa-hourglass-half"></i> ${esc(actor.name)}: waiting for the GM to rule on ${esc(run.requests[actor.id].spell)}.</p>`;
      if (!canAct(run, actor.id).ok) {
        const act = run.acts.find((a) => a.stage === run.stage && a.actor === actor.id);
        return act ? `<p class="sc-done">${esc(actor.name)}: ${esc(this.#actText(act, run.rules.showDC))}</p>` : "";
      }
      return this.#rollsHere(actor) || this.isPreview ? this.#picker(run, actor) : "";
    }).join("");
  }

  #actText(a, showDC) {
    if (a.kind === "spell") return `${a.note}: automatic success`;
    if (a.kind === "gm") return `${a.success ? "Success" : "Failure"} (GM)${a.note ? `: ${a.note}` : ""}`;
    if (a.kind === "skip") return "Skipped this stage";
    return `${optionLabel(a.option)} ${a.total}${showDC ? ` vs DC ${a.dc}` : ""}: ${a.success ? "success" : "failure"}`;
  }

  #person(run, p, acted) {
    const gm = this.gmView, actor = game.actors.get(p.id), act = run.acts.find((a) => a.stage === run.stage && a.actor === p.id), req = run.requests?.[p.id];
    const used = (run.used[p.id] ?? []).map(optionLabel).join(", ");
    const face = p.img ? `<img src="${esc(p.img)}" alt="">` : esc(p.name.slice(0, 1));
    let state;
    const other = gm ? `<button type="button" data-sc="override" data-actor="${p.id}" title="They did something the stage doesn't list: you decide">Something else</button>` : "";
    if (!act && gm && this.overrideFor === p.id) state = `<div class="sc-override" data-sc-keep data-sc-override="${p.id}">
        <input name="note" maxlength="300" placeholder="What they did instead (shown on the card)">
        <span class="sc-override-btns"><button type="button" data-sc="override-ok" data-actor="${p.id}" data-ok="1" class="primary">Success</button><button type="button" data-sc="override-ok" data-actor="${p.id}" data-ok="0">Failure</button><button type="button" data-sc="override-cancel">Cancel</button></span></div>`;
    else if (act) state = `<span class="sc-roll ${act.success === true ? "ok" : act.success === false ? "no" : ""}">${esc(this.#actText(act, gm || run.rules.showDC))}</span>`;
    else if (req) state = gm ? `<span class="sc-ask"><b>Asks for ${esc(req.spell)}</b>${req.text ? `<small>“${esc(req.text)}”</small>` : ""}</span>
        <button type="button" data-sc="rule" data-actor="${p.id}" data-d="allow" class="primary">Allow: ${{ auto: "success", dc2: "DC −2", adv: "advantage" }[currentStage(run).spellEffect]}</button>
        ${currentStage(run).spellEffect !== "dc2" ? `<button type="button" data-sc="rule" data-actor="${p.id}" data-d="dc2">DC −2</button>` : ""}
        <button type="button" data-sc="rule" data-actor="${p.id}" data-d="deny">Not enough</button>${other}` : `<span class="sc-muted">Waiting for the GM to rule on ${esc(req.spell)}</span>`;
    else if (this.busy.has(p.id)) state = `<span class="sc-muted">Rolling…</span>`;
    else state = `<span class="sc-muted">${actor && playersOf(actor).length ? "Choosing…" : "No player online"}</span>${gm ? `<button type="button" data-sc="act-for" data-actor="${p.id}">Roll for them</button>${other}<button type="button" data-sc="skip" data-actor="${p.id}">Skip</button>` : ""}`;
    return `<div class="sc-person ${acted.has(p.id) ? "acted" : ""}"><span class="cs-face">${face}</span><span class="sc-who"><b>${esc(p.name)}</b><small>${used ? `Used: ${esc(used)}` : "Nothing used yet"}</small></span><span class="sc-state">${state}</span></div>`;
  }

  #gmBar(run) {
    const last = run.stage >= run.stages.length - 1, waiting = run.party.length - actedIn(run).size;
    const blocked = !canAdvance(run);
    return `<div class="sc-gmbar"><span class="sc-marknote" data-sc-keep><input name="marknote" maxlength="300" placeholder="Note for a group mark (optional)"></span><button type="button" data-sc="mark" data-ok="1">+ Success</button><button type="button" data-sc="mark" data-ok="0">+ Failure</button>
      <span class="sc-muted grow">${everyoneActed(run) ? "Everyone has acted this stage." : `${waiting} still to act${blocked ? ": everyone must act first" : ""}.`}</span>
      <button type="button" data-sc="end-early">End early</button>
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
      case "roll": return this.#roll(a, Number(b.dataset.appr), b.dataset.option);
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
      case "view-as": this.asPlayer = !this.asPlayer; this.actingFor = null; this.overrideFor = null; this.spellFor = null; return this.render();
      case "call": {
        const j = Number(b.dataset.appr);
        return this.change((r) => callApproach(r, j, !isCalled(r, j)));
      }
      case "act-for": this.actingFor = a || null; return this.render();
      case "rule": return this.change((r) => ruleSpell(r, a, b.dataset.d));
      case "skip": return this.change((r) => skipActor(r, a));
      case "mark": {
        const note = this.el.querySelector("[name=marknote]")?.value?.trim() ?? "";
        document.activeElement?.blur?.();
        return this.change((r) => gmMark(r, b.dataset.ok === "1", note));
      }
      case "override": this.overrideFor = a; this.actingFor = null; this.render(); return this.el.querySelector(`[data-sc-override="${a}"] [name=note]`)?.focus();
      case "override-cancel": this.overrideFor = null; document.activeElement?.blur?.(); return this.render();
      case "override-ok": {
        const note = this.el.querySelector(`[data-sc-override="${a}"] [name=note]`)?.value?.trim() ?? "";
        this.overrideFor = null; document.activeElement?.blur?.();
        return this.change((r) => gmOverride(r, a, b.dataset.ok === "1", note));
      }
      case "next": return this.change((r) => nextStage(r) && true);
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
