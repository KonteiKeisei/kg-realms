// The harvest run (0.96): once the harvest window is set up, the harvest is carried out the way the
// camp's activities are, in the same step view, for the GM and the players alike. One step for each
// creature, then Done. On a creature's step the GM requests the rolls; each person's row shows their
// face, whether they lead or help, and their roll button with its bonus (the GM rolls for anyone with
// no player online); the GM can allow a reroll, or rule any part a success or failure with a reason;
// Confirm results settles that creature's results. Finish gives every confirmed creature's parts to
// its leader, marks it taken, moves the clock on by the longest share and logs it all; calling the
// harvest off before that gives and marks nothing. A practice run is the GM's alone: rolled quietly,
// nothing kept.
//
// The GM's client holds the run and sends it to the players; a player's roll comes back to the GM,
// who takes it only from a user who owns that character.
//
// 0.96.4: who leads, who helps, with which skill, and which parts are set on each creature's own step,
// in this shared view, by the GM or any player in the party, until the GM requests that step's rolls.
// The view is a window like the others: dragged by its header, below Foundry's windows so the roll
// dialogs open on top. A roll waiting on its dialog holds only that roll's button.
import { ruleTooltip, ruleParagraphs } from "../travel-rules.mjs";
import { harvestCheck, harvestYield, rollAmount, coins, minutesText, workMinutes, HARVEST_SKILLS } from "./catalog.mjs";
import { giveYield } from "./items.mjs";
import { movable, placeKept } from "../ui-shell.mjs";

const MODULE_ID = "kg-realms";
const SOCKET = `module.${MODULE_ID}`;
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const setting = (k) => { try { return game.settings.get(MODULE_ID, k); } catch { return undefined; } };
const skillMod = (actor, k) => Number(actor?.system?.skills?.[k]?.total ?? actor?.system?.skills?.[k]?.mod ?? 0) || 0;
const signed = (n) => `${n >= 0 ? "+" : ""}${n}`;
const SHORT = { sur: "Sur", med: "Med", slt: "Sle" };
const first = (name) => String(name ?? "?").split(" ")[0];
const showDC = () => setting("showPerceptionDC") !== false;
const playersOf = (actor) => Array.from(game.users ?? []).filter((u) => u.active && !u.isGM && actor?.testUserPermission?.(u, "OWNER"));

export const RUN_RULES = {
  step: ruleParagraphs([["The rolls", "The leader rolls once for the creature, checked against each part's own DC. The helper rolls once too: on each part the helper's roll beats, the leader gets +1; on each it misses, −1."], ["Success", "The part, in the amount rolled."], ["Failure", "Nothing, and it can be tried again. Fail by 5 or more and it is ruined. Meat: a quarter, mangled."], ["GM", "Rule any part a success or failure, with a recorded reason. Until the results are confirmed, the GM can change who leads or helps; whoever changed rolls again."]]),
  done: ruleParagraphs([["Finish", "The parts go to each leader's sheet and the creatures are marked taken. Calling the harvest off before this gives and marks nothing."], ["Time", "Players work at the same time: the clock moves on by the longest share. The party stays where it is."], ["Log", "A chat card for the GM, and the Harvests journal."]])
};

/** A face: the portrait, or initials (the camp's). */
function face(a, size = 42) {
  const ini = esc(String(a?.name ?? "?").split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase());
  return `<span class="cs-face" style="width:${size}px;height:${size}px">${a?.img ? `<img src="${esc(a.img)}" alt="">` : ini}</span>`;
}

/** The system's skill roll: with its dialog and chat card (dialog false: straight through), or quiet. Null if cancelled. */
export async function skillRoll(actor, skill, { dc = null, flavor = "Harvest", chat = true, dialog = true } = {}) {
  try {
    if (foundry.utils.isNewerVersion(game.system.version, "3.99")) {
      const r = await actor.rollSkill({ skill, ...(dc != null && chat ? { target: dc } : {}) }, chat && dialog ? {} : { configure: false }, chat ? { data: { flavor } } : { create: false });
      const roll = Array.isArray(r) ? r[0] : r;
      return Number.isFinite(roll?.total) ? roll.total : null;
    }
    const roll = await actor.rollSkill(skill, chat ? { ...(dc != null ? { targetValue: dc } : {}), flavor, ...(dialog ? {} : { fastForward: true }) } : { fastForward: true, chatMessage: false });
    return Number.isFinite(roll?.total) ? roll.total : null;
  } catch (err) {
    console.warn(`${MODULE_ID} | harvest: the system's skill roll failed, rolling d20 + bonus instead:`, err);
    const roll = await new Roll("1d20 + @mod", { mod: skillMod(actor, skill) }).evaluate();
    if (chat) await roll.toMessage({ flavor, speaker: ChatMessage.getSpeaker({ actor }) });
    return roll.total;
  }
}

/**
 * Recompute a step from its setup: the parts ticked (all minus skip), each with the DC for the leader's
 * and the helper's skill, and the time. A step: { all: [part with dcs: { sur, med, slt }], skip: [key],
 * lead, help }.
 */
export function applySetup(s) {
  const skip = new Set(s.skip ?? []);
  s.parts = (s.all ?? []).filter((p) => !skip.has(p.key)).map((p) => ({ ...p, dcLead: s.lead ? p.dcs[s.lead.skill] : null, dcHelp: s.help ? p.dcs[s.help.skill] : null }));
  s.minutes = workMinutes(s.parts);
  return s;
}

/** The best skill for someone on a step: the most over the DC of its first part. mods: { sur, med, slt }. */
export function bestSkill(mods, all) {
  const p = all?.[0];
  if (!p) return "sur";
  return Object.keys(HARVEST_SKILLS).sort((a, b) => ((mods?.[b] ?? 0) - p.dcs[b]) - ((mods?.[a] ?? 0) - p.dcs[a]))[0];
}

/**
 * Change a step's setup (before its rolls are asked for). change: { field: "lead" | "help" | "skill" |
 * "part", value, role, key, on }. party: [{ id, name, img, mods }]. Returns whether anything changed.
 */
export function changeSetup(s, change, party, { gm = false } = {}) {
  // The party sets it up until the GM asks for the rolls; the GM can still change who leads or helps
  // (and their skill) until the results are confirmed. Whoever changed rolls again; the parts are fixed.
  if (!s || s.done || (s.asked && (!gm || change?.field === "part"))) return false;
  // A roll belongs to the person and the skill they rolled: it moves with them (a leader and helper
  // swapped keep theirs), and anyone new, or on another skill, rolls again.
  const slotKey = (slot) => (slot ? `${slot.id}|${slot.skill}` : null);
  const had = new Map(["lead", "help"].filter((r) => s[r] && s.rolls?.[r] != null).map((r) => [slotKey(s[r]), s.rolls[r]]));
  const changed = changeSlots(s, change, party);
  if (changed && s.asked) for (const role of ["lead", "help"]) { const kept = had.get(slotKey(s[role])); if (kept != null) s.rolls[role] = kept; else delete s.rolls[role]; }
  return changed;
}
function changeSlots(s, change, party) {
  const who = (id) => { const m = party.find((x) => x.id === id); return m ? { id: m.id, name: m.name, img: m.img, skill: bestSkill(m.mods, s.all) } : null; };
  const { field, value } = change ?? {};
  if (field === "lead") {
    const old = s.lead;
    s.lead = value ? who(value) : null;
    if (value && !s.lead) return false;
    if (s.help && s.lead && s.help.id === s.lead.id) s.help = old && old.id !== s.lead.id ? old : null;
  } else if (field === "help") {
    if (value && value === s.lead?.id) return false;
    s.help = value ? who(value) : null;
    if (value && !s.help) return false;
  } else if (field === "skill") {
    const slot = change.role === "help" ? s.help : s.lead;
    if (!slot || !HARVEST_SKILLS[value]) return false;
    slot.skill = value;
  } else if (field === "part") {
    if (!s.all.some((p) => p.key === change.key)) return false;
    const skip = new Set(s.skip ?? []);
    if (change.on) skip.delete(change.key); else skip.add(change.key);
    s.skip = [...skip];
  } else return false;
  applySetup(s);
  return true;
}

/**
 * The checks of a creature's step: one roll for the leader and one for the helper, each checked against
 * every part's own DC (so a roller's optional bonuses are asked about once per creature, not once per
 * part). [{ id ("lead" | "help"), role, actor, skill, dc (when every part has the same DC, else null),
 * part (the parts' names) }]. None until someone leads, or once the GM has ruled on every part.
 */
export function stepChecks(s) {
  const open = s.lead ? s.parts.filter((p) => !s.overrides?.[p.key]) : [];
  if (!open.length) return [];
  const names = open.map((p) => p.name).join(", ");
  const one = (role, slot) => { const dcs = new Set(open.map((p) => (role === "lead" ? p.dcLead : p.dcHelp))); return { id: role, role, actor: slot.id, skill: slot.skill, dc: dcs.size === 1 ? [...dcs][0] : null, part: names }; };
  return [one("lead", s.lead), ...(s.help ? [one("help", s.help)] : [])];
}

/** Whether a step's results can be confirmed: the leader has rolled, or the GM has ruled on every part. */
export const stepReady = (s) => s.asked && !!s.lead && s.parts.length > 0 && (s.rolls.lead != null || s.parts.every((p) => s.overrides[p.key]));

/**
 * A confirmed step's rows: each part's roll (with help), its DC and what it gave. amount(dice) rolls
 * the amount. Rows: { part, kind, name, perLb, roll, helped, dc, outcome, qty, cut, gp, by, ruling }.
 */
export function stepRows(s, amount = rollAmount) {
  return s.parts.map((p) => {
    const o = s.overrides[p.key];
    let check;
    if (o) check = { total: null, helped: 0, success: !!o.success, ruined: false };
    else {
      // The leader's one roll (and the helper's) against this part's own DC.
      const help = s.help && s.rolls.help != null ? { total: s.rolls.help, dc: p.dcHelp } : null;
      check = harvestCheck(s.rolls.lead, help, p.dcLead);
    }
    const y = harvestYield({ ...p, part: p.kind }, check, amount(p.dice));
    return { part: p.key, kind: p.kind, name: p.name, perLb: p.perLb, roll: o ? "GM" : check.total, helped: check.helped, dc: p.dcLead, outcome: y.outcome, qty: y.qty, cut: y.name, gp: y.qty * y.unitGp, unitGp: y.unitGp, key: y.key, by: s.lead.name, ruling: o ?? null };
  });
}

/** One row's result in words. */
export function outcomeText(r) {
  const unit = r.perLb ? " lb" : "";
  if (r.outcome === "got") return `${r.qty}${unit}, ${coins(r.gp)}`;
  if (r.outcome === "mangled") return `${r.cut}: ${r.qty}${unit}, cannot be sold`;
  if (r.outcome === "ruined") return "Ruined";
  if (r.kind === "meat" || r.kind === "greens") return "Too little left to keep";
  return r.roll === "GM" ? "Nothing" : `Failed by ${r.dc - r.roll}: nothing`;
}

export class HarvestRun {
  /** gm: { hud, onFinished(entries, seconds, practice), onChange() } on the GM's client; null for a player. */
  // saving: results being given or the harvest being finished. rolling: the checks whose rolls are
  // under way on this client (a roll dialog left open holds only its own button, nothing else).
  constructor(gm = null) { this.gm = gm; this.el = null; this.run = null; this.min = false; this.reasons = {}; this.saving = false; this.rolling = new Set(); }

  get authority() { return !!this.gm && game.user.isGM; }
  get step() { return this.run?.steps[this.run.at] ?? null; }

  /* ---------------------------------------------------------------- the GM's side */

  /** Start a run from the harvest window's plan. */
  start({ steps, practice, scene, party = [] }) {
    this.run = { session: foundry.utils.randomID(), practice, scene, party, start: game.time.worldTime, at: 0, steps: steps.map((s) => applySetup({ ...s, skip: [...(s.skip ?? [])], asked: false, rolls: {}, overrides: {}, done: false, rows: null })), finished: false };
    this.min = false; this.reasons = {}; this.rolling.clear();
    this.#changed();
  }

  /** Close the run (the window closed, or it was called off): everyone's view goes. */
  end() {
    if (this.authority && this.run && !this.run.practice) game.socket.emit(SOCKET, { type: "harvest-close", session: this.run.session });
    this.run = null;
    this.close();
    this.gm?.onChange?.();
  }

  /** Send the run to the players (not a practice run) and draw it. */
  #changed() {
    if (this.authority && this.run && !this.run.practice) game.socket.emit(SOCKET, { type: "harvest-run", run: this.run });
    this.render();
    this.gm?.onChange?.();
  }

  /** A message: on the GM's client a player's roll (or a request to be sent the run again); on a player's, the run. */
  receive(m, userId) {
    if (this.authority) {
      const r = this.run;
      if (!r || r.practice) return;
      if (m?.type === "harvest-again") return game.socket.emit(SOCKET, { type: "harvest-run", run: r });
      // A player changing who does what on a creature: anyone who plays a character in the party.
      if (m?.type === "harvest-setup" && m.session === r.session) {
        const user = game.users.get(userId ?? m.user);
        const inParty = user && (user.isGM || r.party.some((p) => game.actors.get(p.id)?.testUserPermission(user, "OWNER")));
        if (inParty && m.step === r.at && changeSetup(r.steps[m.step], m.change, r.party)) this.#changed();
        else game.socket.emit(SOCKET, { type: "harvest-run", run: r });
        return;
      }
      if (m?.type !== "harvest-roll" || m.session !== r.session) return;
      const s = r.steps[m.step], ch = s ? stepChecks(s).find((c) => c.id === m.id) : null, actor = ch ? game.actors.get(ch.actor) : null;
      const user = game.users.get(userId ?? m.user);
      if (!s || !s.asked || s.done || !ch || s.rolls[ch.id] != null || !Number.isFinite(m.total) || !actor || !user || !actor.testUserPermission(user, "OWNER")) return;
      s.rolls[ch.id] = m.total;
      return this.#changed();
    }
    if (game.user.isGM) return;
    if (m?.type === "harvest-run") {
      const mine = (m.run?.party ?? []).some((p) => game.actors.get(p.id)?.isOwner) || m.run?.steps?.some((s) => [s.lead, s.help].some((p) => p && game.actors.get(p.id)?.isOwner));
      if (!mine && !this.run) return;
      if (!this.run || this.run.session !== m.run.session) { this.min = false; ui.notifications.info("KG Realms: the harvest begins."); }
      this.run = m.run;
      return this.render();
    }
    if (m?.type === "harvest-close" && this.run?.session === m.session) { this.run = null; this.close(); }
  }

  /** On joining or reloading: ask the GM for the run, if there is one. */
  static askAgain() { game.socket.emit(SOCKET, { type: "harvest-again", user: game.user.id }); }

  /**
   * Confirm a creature's results: worked out and kept with the run, nothing given yet. The parts go to
   * the leaders' sheets and the creatures are marked taken only when the GM finishes the harvest
   * (#finish); calling it off before then gives and marks nothing.
   */
  async #confirm() {
    const s = this.step;
    if (!s || s.done || !stepReady(s) || this.saving) return;
    this.saving = true;
    try {
      const scale = Number(this.gm?.hud?.priceScale) || 1;
      s.rows = stepRows(s).map((r) => ({ ...r, gp: r.gp * scale, unitGp: r.unitGp * scale }));
      s.done = true;
      // Straight on to the next creature, or to Done after the last.
      this.run.at += 1;
    } catch (err) {
      console.error(`${MODULE_ID} | harvest:`, err);
      ui.notifications.error(`KG Realms: the results could not be given: ${err.message}. See the console (F12).`);
    } finally { this.saving = false; this.#changed(); }
  }

  /** The clock: the longest leader's share of the creatures done. */
  #seconds() {
    const out = {};
    for (const s of this.run.steps.filter((x) => x.done)) out[s.lead.id] = (out[s.lead.id] ?? 0) + s.minutes;
    return Math.max(0, ...Object.values(out)) * 60;
  }

  /** A confirmed creature's parts to its leader's sheet, and the creature's token marked taken. */
  async #give(s) {
    const lead = game.actors.get(s.lead.id);
    if (!lead) throw new Error(`${s.lead.name} is no longer in the world`);
    for (const r of s.rows) if (r.qty) await giveYield(lead, { key: r.key, name: r.cut, unitGp: r.unitGp, qty: r.qty, part: r.kind, at: game.time.worldTime });
    const token = s.tokenId ? game.scenes.find((sc) => sc.tokens.get(s.tokenId))?.tokens.get(s.tokenId) : null;
    const marks = Object.fromEntries(s.rows.filter((r) => r.outcome !== "nothing").map((r) => [r.part, { outcome: r.outcome, qty: r.qty, by: r.by }]));
    if (token && Object.keys(marks).length) await token.setFlag(MODULE_ID, "harvested", { ...(token.getFlag(MODULE_ID, "harvested") ?? {}), ...marks });
  }

  async #finish() {
    const r = this.run;
    if (!r || this.saving) return;
    this.saving = true; this.render();
    try {
      // Only now: each confirmed creature's parts are given and it is marked taken. A creature already
      // given (a finish that failed part way and is tried again) is not given twice.
      if (!r.practice) for (const s of r.steps.filter((x) => x.done && !x.given)) { await this.#give(s); s.given = true; }
      const seconds = this.#seconds();
      const entries = r.steps.filter((s) => s.done).map((s) => ({ creature: s.cid, tokenId: s.tokenId, name: s.name, leader: s.lead.name, helper: s.help?.name ?? null, rows: s.rows, minutes: s.minutes, practice: r.practice }));
      await this.gm.onFinished(entries, seconds, r.practice);
      this.saving = false;
      this.end();
    } catch (err) {
      this.saving = false;
      console.error(`${MODULE_ID} | harvest:`, err);
      ui.notifications.error(`KG Realms: the harvest could not be finished: ${err.message}. See the console (F12).`);
      this.render();
    }
  }

  /* ---------------------------------------------------------------- rolls, either side */

  /** Who rolls for an actor on this client: its player; the GM when no player is online, or on a practice run. */
  rollsFor(actor) {
    if (!actor) return false;
    if (this.run?.practice) return game.user.isGM;
    return game.user.isGM ? !playersOf(actor).length : !!actor.isOwner;
  }

  async #roll(stepIndex, ids, { dialog = true } = {}) {
    const r = this.run, s = r?.steps[stepIndex];
    ids = ids.filter((id) => !this.rolling.has(id));
    if (!s || !s.asked || s.done || !ids.length) return;
    ids.forEach((id) => this.rolling.add(id));
    this.render();
    try {
      for (const id of ids) {
        const ch = stepChecks(s).find((c) => c.id === id), actor = ch ? game.actors.get(ch.actor) : null;
        // The step may have moved on (confirmed, skipped, a reroll allowed) while a dialog was open.
        if (!ch || !actor || s.rolls[id] != null || s.done || r !== this.run) continue;
        const flavor = `Harvest: ${s.name} (${ch.part}), ${HARVEST_SKILLS[ch.skill].label}${ch.role === "help" ? ", helping" : ""}`;
        const total = await skillRoll(actor, ch.skill, { dc: showDC() || game.user.isGM ? ch.dc : null, flavor, chat: !r.practice, dialog: dialog && ids.length === 1 });
        if (total == null) break;
        if (s.done || r !== this.run || s.rolls[id] != null) continue;
        if (this.authority) s.rolls[id] = total;
        else { s.rolls[id] = total; game.socket.emit(SOCKET, { type: "harvest-roll", session: r.session, step: stepIndex, id, total, user: game.user.id }); }
      }
    } catch (err) {
      console.error(`${MODULE_ID} | harvest roll:`, err);
      ui.notifications.error(`KG Realms: the harvest check did not roll: ${err.message}`);
    } finally {
      ids.forEach((id) => this.rolling.delete(id));
      if (!this.run) return;
      if (this.authority) this.#changed(); else this.render();
    }
  }

  /* ---------------------------------------------------------------- the view */

  close() { this.el?.remove(); this.el = null; this.html = null; }

  render() {
    if (!this.run) return this.close();
    if (!this.el) {
      this.el = document.createElement("div");
      this.el.className = "kgr-ui kgr-harvest-run";
      this.el.setAttribute("role", "region");
      this.el.setAttribute("aria-label", "Harvest");
      this.el.innerHTML = `<div class="cs-body"></div>`;
      this.el.addEventListener("click", (e) => { const b = e.target.closest("[data-hr]"); if (b && b.tagName === "BUTTON") this.#click(b); });
      this.el.addEventListener("input", (e) => { const t = e.target; if (t.dataset?.hr === "reason") this.reasons[`${this.run?.at}|${t.dataset.key}`] = t.value; });
      this.el.addEventListener("change", (e) => { const t = e.target.closest?.("[data-hr-set]"); if (t) this.#setup(t); });
      this.el.addEventListener("focusout", () => setTimeout(() => { if (this.held && this.el && !this.el.contains(document.activeElement)) { this.held = false; this.render(); } }, 0));
      // Dragged by its header like every panel. It sits centred by a transform: take that off first,
      // where it stands, so the drag starts from the right place.
      this.el.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || !e.target.closest("header") || e.target.closest("button, input, select, a")) return;
        const r = this.el.getBoundingClientRect();
        Object.assign(this.el.style, { transform: "none", left: `${r.left}px`, top: `${r.top}px` });
      }, true);
      movable(this.el, "harvest-run", { redock: () => this.#place() });
      document.body.append(this.el);
    }
    // Keep a reason being typed: redraw once it loses focus.
    const f = document.activeElement;
    if (this.el.contains(f) && f.tagName === "INPUT" && f.dataset?.hr === "reason" && this.drawnAt === this.run.at) { this.held = true; return; }
    this.drawnAt = this.run.at;
    this.el.classList.toggle("min", this.min);
    const html = this.min ? this.#minBar() : this.#html();
    if (html !== this.html) { this.el.querySelector(".cs-body").innerHTML = html; this.html = html; }
    this.#place();
  }

  /** Where it was dragged to (kept per user), or centred at the top. */
  #place() {
    if (!this.el) return;
    if (placeKept(this.el, "harvest-run")) this.el.style.transform = "none";
    else Object.assign(this.el.style, { left: "", top: "", transform: "" });
  }

  #minBar() {
    const s = this.step;
    return `<header class="cs-bar" title="Drag to move. Double-click to put it back."><i class="fa-solid fa-scissors"></i><span class="grow">The harvest · ${esc(s?.name ?? "Done")}</span><button data-hr="show" class="primary">Show</button></header>`;
  }

  /** A setup control changed: the GM applies it; a player sends it to the GM. */
  #setup(t) {
    const r = this.run, s = this.step;
    // After the rolls are asked for, only the GM running it changes who leads or helps.
    if (!r || !s || s.done || (s.asked && !this.authority)) return;
    const change = { field: t.dataset.hrSet, value: t.type === "checkbox" ? null : t.value, role: t.dataset.role, key: t.dataset.key, on: t.type === "checkbox" ? t.checked : undefined };
    if (this.authority) { if (changeSetup(s, change, r.party, { gm: true })) this.#changed(); else this.render(); return; }
    // Show it straight away; the GM's copy comes back and settles it.
    changeSetup(s, change, r.party);
    this.render();
    game.socket.emit(SOCKET, { type: "harvest-setup", session: r.session, step: r.at, change, user: game.user.id });
  }

  /** Whether this user can change who does what: the GM running it, or a player with a character in the party. */
  #canSet() {
    const r = this.run;
    if (!r) return false;
    if (game.user.isGM) return this.authority;
    return !r.practice && (r.party ?? []).some((p) => game.actors.get(p.id)?.isOwner);
  }

  /** Who does what on this creature: open to the party until the GM requests its rolls, and to the GM until the results are confirmed. */
  #setupBox(s) {
    const r = this.run, can = this.#canSet() && !s.done && (!s.asked || this.authority), party = r.party ?? [];
    const mods = (id) => party.find((p) => p.id === id)?.mods ?? {};
    const people = (sel, skipId, none) => `${none ? `<option value="">${none}</option>` : ""}${party.filter((p) => p.id !== skipId).map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? "selected" : ""}>${esc(p.name)}</option>`).join("")}`;
    const skills = (slot) => Object.entries(HARVEST_SKILLS).map(([k, sk]) => {
      const dc = s.all[0]?.dcs[k];
      return `<option value="${k}" ${k === slot.skill ? "selected" : ""}>${esc(sk.label)} ${signed(mods(slot.id)[k] ?? 0)}${dc != null && (game.user.isGM || showDC()) ? ` (DC ${dc}${s.all.length > 1 ? "+" : ""})` : ""}</option>`;
    }).join("");
    const dis = can ? "" : "disabled";
    const row = (label, field, slot, skipId, none) => `<div class="hr-setup-row"><span>${label}</span><select data-hr-set="${field}" aria-label="${label}" ${dis}>${people(slot?.id, skipId, none)}</select>${slot ? `<select data-hr-set="skill" data-role="${field}" aria-label="${label}: skill" ${dis}>${skills(slot)}</select>` : "<span></span>"}</div>`;
    // Which parts to take is ticked on each part's own row (#partsTable).
    return `<section class="hr-setup ${can ? "" : "locked"}">${row("Leads", "lead", s.lead, null, s.lead ? "" : "Nobody yet")}${row("Helps", "help", s.help, s.lead?.id, "Nobody")}</section>`;
  }

  #html() {
    const r = this.run, gm = game.user.isGM, n = r.steps.length, at = r.at, s = this.step;
    const chips = (r.practice ? `<span class="cs-chip practice">Practice: nothing is kept</span>` : "")
      + r.steps.map((x, k) => `<span class="cs-chip ${k < at || x.done ? "done" : ""} ${k === at ? "on" : ""}">${esc(x.name)}</span>`).join("")
      + `<span class="cs-chip ${at === n ? "on" : ""}">Done</span>`;
    const body = s ? this.#creature(s) : this.#done();
    let go = "", advance = "";
    if (gm && this.authority) {
      if (s) {
        // Confirm results moves on by itself; this only skips a creature nobody is harvesting.
        const next = r.steps[at + 1];
        go = `<button data-hr="skip">${next ? `Skip to ${esc(next.name)}` : "Skip to the end"}</button>`;
        advance = "No world time advances yet. The clock moves on when the harvest is done.";
      } else {
        const seconds = this.#seconds();
        go = `<button data-hr="finish" class="primary" ${this.saving ? "disabled" : ""}>${r.practice ? "End practice" : seconds ? `Finish: advance ${minutesText(seconds / 60)}` : "Finish"}</button>`;
        advance = r.practice ? "A practice run: no time passes and nothing is kept." : seconds ? `Advance ${minutesText(seconds / 60)} to ${this.gm.hud?.dateText?.(game.time.worldTime + seconds) ?? "then"}. The party stays here.` : "Nothing was harvested: no world time advances.";
      }
    }
    return `<header class="cs-carousel-head" title="Drag to move. Double-click to put it back."><div><span class="cs-context">Harvest${r.scene ? ` · ${esc(r.scene)}` : ""}</span><span class="cs-context" role="status" aria-live="polite">Step ${Math.min(at + 1, n + 1)} of ${n + 1}</span></div><button data-hr="min" class="cs-min" aria-label="Minimise the harvest">-</button></header>
      <div class="cs-chips" aria-label="Harvest progress">${chips}</div>${body}${advance ? `<p class="cs-clock-advance">${esc(advance)}</p>` : ""}
      <div class="cs-foot">${go}${gm ? "" : '<span class="cs-note">The GM moves the harvest on.</span>'}</div>`;
  }

  /**
   * The parts as one table. Its first row is the creature's rolls: the leader's one roll and the
   * helper's, in their own columns, each checked against every part's DC. Then a row for each part,
   * with its DC, whether each roll beat it, and its result under its name. The leader and helper are
   * set once, above (#setupBox). Before the GM asks for the rolls each part has its tick (take it or
   * not); after, only the ticked ones show.
   */
  #partsTable(s, mine) {
    const gm = game.user.isGM, seen = gm || showDC(), r = this.run, asked = s.asked || s.done;
    const can = this.#canSet() && !asked, gmRuns = gm && this.authority && !s.done;
    const lead = s.lead ? game.actors.get(s.lead.id) ?? s.lead : null, help = s.help ? game.actors.get(s.help.id) ?? s.help : null;
    // A part's DC for the leader or helper: worked out on the ticked parts, else from its DCs by skill.
    const dcOf = (p, role) => { const slot = role === "lead" ? s.lead : s.help; return (role === "lead" ? p.dcLead : p.dcHelp) ?? (slot ? p.dcs?.[slot.skill] : null); };
    const head = (who, slot) => `<th scope="col" title="${esc(who.name)}: ${esc(HARVEST_SKILLS[slot.skill]?.label ?? "")} ${signed(skillMod(who, slot.skill))}">${esc(first(who.name))} <small>${SHORT[slot.skill]} ${signed(skillMod(who, slot.skill))}</small></th>`;
    // A person's one roll for the creature: its button, waiting, or the total (and the GM's reroll).
    const needed = stepChecks(s).length > 0;
    const rollCell = (who, role) => {
      const id = role, total = s.rolls[id], slot = role === "lead" ? s.lead : s.help;
      const label = `${SHORT[slot.skill]} ${signed(skillMod(who, slot.skill))}`;
      if (total != null) return `<span class="hr-roll">${total}</span>${gmRuns ? `<button data-hr="reroll" data-id="${esc(id)}" class="hr-icon" title="Allow a reroll" aria-label="Allow ${esc(who.name)} a reroll"><i class="fa-solid fa-rotate-right"></i></button>` : ""}`;
      if (s.done || !needed) return `<span class="cs-meta">-</span>`;
      if (!s.asked) return `<span class="cs-meta">Waiting</span>`;
      if (this.rollsFor(who)) { mine.push(id); return `<button data-hr="roll" data-id="${esc(id)}" class="primary hr-rollbtn" title="Roll ${esc(label)}, once for every part" ${this.rolling.has(id) ? "disabled" : ""}><i class="fa-solid fa-dice-d20"></i> ${this.rolling.has(id) ? "Rolling…" : "Roll"}</button>`; }
      return `<span class="cs-meta">Waiting</span>${gmRuns ? `<button data-hr="roll" data-id="${esc(id)}" class="hr-icon" title="Roll ${esc(label)} for ${esc(who.name)}, once for every part" aria-label="Roll for ${esc(who.name)}" ${this.rolling.has(id) ? "disabled" : ""}><i class="fa-solid fa-dice-d20"></i></button>` : ""}`;
    };
    // On a part's row: whether that roll beat this part's DC (shown when DCs are).
    const cell = (p, role) => {
      const total = s.rolls[role];
      if (s.overrides[p.key] || total == null || !seen) return "";
      const ok = total >= dcOf(p, role);
      return `<span class="hr-vs ${ok ? "ok" : "no"}" title="${total} against DC ${dcOf(p, role)}"><i class="fa-solid fa-${ok ? "check" : "xmark"}"></i></span>`;
    };
    // Under the part's name: the amount and time, then where its check stands or how it went.
    const line = (p) => {
      const o = s.overrides[p.key], row = s.rows?.find((x) => x.part === p.key);
      if (row) { const ok = ["got", "mangled"].includes(row.outcome); return `<small class="hr-out ${ok ? "ok" : "no"}"><b>${row.outcome === "got" ? "Success" : row.outcome === "mangled" ? "Failure, but meat" : row.outcome === "ruined" ? "Ruined" : "Failure"}.</b> ${row.roll === "GM" ? "" : `${row.roll}${seen ? ` against DC ${row.dc}` : ""}. `}${esc(outcomeText(row))}.${row.ruling ? ` Reason: ${esc(row.ruling.reason || "GM ruling")}.` : ""}</small>`; }
      if (o) return `<small class="hr-out">Ruled a ${o.success ? "success" : "failure"} by the GM${o.reason ? `: ${esc(o.reason)}` : ""}.${gmRuns ? ` <button data-hr="unrule" data-key="${esc(p.key)}" class="hr-link">Clear</button>` : ""}</small>`;
      const lt = s.rolls.lead, ht = help ? s.rolls.help : null;
      if (lt != null && ht != null) { const ok = ht >= p.dcHelp; return `<small class="hr-out">Total ${lt + (ok ? 1 : -1)}: ${lt} ${ok ? "+" : "−"} 1</small>`; }
      return "";
    };
    const shown = asked ? s.parts : s.all, cols = 3 + (lead ? 1 : 0) + (help ? 1 : 0) + (seen ? 1 : 0);
    const rows = shown.map((p) => {
      const taking = !(s.skip ?? []).includes(p.key);
      const tick = asked ? "" : `<input type="checkbox" data-hr-set="part" data-key="${esc(p.key)}" ${taking ? "checked" : ""} ${can ? "" : "disabled"} aria-label="Take ${esc(p.name)}">`;
      const ruling = gmRuns && !s.overrides[p.key] && taking && lead;
      const open = ruling && this.ruling === `${r.at}|${p.key}`;
      const main = `<tr class="${taking ? "" : "off"}"><td class="hr-tick">${tick}</td><th scope="row"><span>${esc(p.name)}</span> <small>${esc(p.amountText)} · ${minutesText(p.minutes)}</small>${taking ? line(p) : ""}</th>${seen ? `<td class="hr-dc">${taking && lead ? `${dcOf(p, "lead")}${help ? `<small>/${dcOf(p, "help")}</small>` : ""}` : ""}</td>` : ""}${lead ? `<td>${taking ? cell(p, "lead") : ""}</td>` : ""}${help ? `<td>${taking ? cell(p, "help") : ""}</td>` : ""}<td class="hr-tick">${ruling ? `<button data-hr="ruling" data-key="${esc(p.key)}" class="hr-icon ${open ? "on" : ""}" title="Override: rule a success or failure" aria-label="Override ${esc(p.name)}" aria-expanded="${open}"><i class="fa-solid fa-gavel"></i></button>` : ""}</td></tr>`;
      return main + (open ? `<tr class="hr-ruling"><td colspan="${cols}">${this.#overrideUI(s, p)}</td></tr>` : "");
    }).join("");
    const heads = `<tr><th></th><th scope="col">Part</th>${seen ? `<th scope="col" title="${help ? "The leader's DC / the helper's DC" : "The DC"}">DC</th>` : ""}${lead ? head(lead, s.lead) : ""}${help ? head(help, s.help) : ""}<th></th></tr>`;
    // The creature's rolls: one each, checked against every part below.
    const rollRow = lead ? `<tr class="hr-rollrow"><td></td><th scope="row">Roll <small>once, for every part</small></th>${seen ? "<td></td>" : ""}<td>${rollCell(lead, "lead")}</td>${help ? `<td>${rollCell(help, "help")}</td>` : ""}<td></td></tr>` : "";
    return `<table class="hr-table">${heads}${rollRow}${rows}</table>${help ? `<p class="cs-note hr-help-note">${esc(first(help.name))} helps: on each part ${esc(first(help.name))}'s roll beats, ${esc(first(lead.name))} gets +1; on each it misses, −1.</p>` : ""}`;
  }

  /** A creature's step: who does it, then its parts with their rolls and results. */
  #creature(s) {
    const gm = game.user.isGM, mine = [];
    const setup = this.#setupBox(s);
    if (!s.lead || !s.parts.length) {
      const why = !s.lead ? "Nobody leads this creature yet. Pick a leader above, or skip it." : "No parts are ticked. Tick at least one, or skip it.";
      return `<div class="cs-title hr-title"><b>${esc(s.name)} ${ruleTooltip(RUN_RULES.step)}</b><span class="cs-meta">${esc(s.desc)}.</span></div>${setup}${this.#partsTable(s, mine)}<p class="cs-note">${why}</p>`;
    }
    const lead = game.actors.get(s.lead.id) ?? s.lead, help = s.help ? game.actors.get(s.help.id) ?? s.help : null;
    const parts = this.#partsTable(s, mine);
    const meta = `${esc(s.desc)}. About ${minutesText(s.minutes)}.${s.asked || s.done ? ` ${esc(lead.name)} leads${help ? `, ${esc(help.name)} helps` : ""}.` : ""}`;
    let actions = "";
    if (gm && this.authority && !s.done) {
      if (!s.asked) actions = `<button data-hr="ask" class="primary">${this.run.practice ? "Start the checks" : "Request rolls"}</button>`;
      else {
        const left = stepChecks(s).filter((c) => s.rolls[c.id] == null && !s.overrides[c.key] && !this.rolling.has(c.id)).map((c) => c.id);
        const next = this.run.steps[this.run.at + 1];
        actions = `<button data-hr="confirm" class="primary" ${stepReady(s) && !this.saving ? "" : "disabled"}><i class="fa-solid fa-check"></i> Confirm results, then ${esc(next ? next.name : "Done")}</button>${left.length ? `<button data-hr="roll-all" data-ids="${esc(left.join(","))}">Roll the rest${this.run.practice ? "" : " for them"} (${left.length})</button>` : ""}`;
      }
    } else if (!gm && !s.asked && !s.done) {
      actions = `<span class="cs-note">The GM requests the rolls when you're ready.</span>`;
    } else if (!gm && s.asked && !s.done) {
      const free = mine.filter((id) => !this.rolling.has(id));
      actions = `${free.length > 1 ? `<button data-hr="roll-all" data-ids="${esc(free.join(","))}">Roll all mine (${free.length})</button>` : ""}<span class="cs-note">Waiting for GM confirmation.</span>`;
    }
    return `<div class="cs-title hr-title"><b>${esc(s.name)} ${ruleTooltip(RUN_RULES.step)}</b><span class="cs-meta">${meta}</span></div>${setup}${parts}<div class="cs-actions">${actions}</div>`;
  }

  /** The GM's ruling for a part: a reason, and success or failure (automatic before any roll), as camp tasks have. */
  #overrideUI(s, p) {
    const draft = this.reasons[`${this.run.at}|${p.key}`] ?? "";
    return `<fieldset class="camp-override hr-override"><legend>Override</legend><label>Reason <input type="text" data-hr="reason" data-key="${esc(p.key)}" maxlength="500" value="${esc(draft)}" placeholder="For example: a skinning knife of fine make"></label><div class="row"><button data-hr="rule" data-key="${esc(p.key)}" data-result="success" class="ruling-success">${s.asked ? "Success" : "Automatic success"}</button><button data-hr="rule" data-key="${esc(p.key)}" data-result="failure" class="ruling-failure">Failure</button></div></fieldset>`;
  }

  #done() {
    const r = this.run, done = r.steps.filter((s) => s.done), skipped = r.steps.filter((s) => !s.done);
    const total = done.reduce((t, s) => t + s.rows.reduce((u, x) => u + (x.outcome === "got" ? x.gp : 0), 0), 0);
    const table = (s) => `<div class="cs-summary"><b>${esc(s.name)}</b> · ${esc(s.lead.name)} leads${s.help ? `, ${esc(s.help.name)} helps` : ""}<ul>${s.rows.map((x) => `<li>${esc(x.name)}: ${esc(outcomeText(x))}.</li>`).join("")}</ul></div>`;
    return `<div class="cs-title"><b>The harvest is done ${ruleTooltip(RUN_RULES.done)}</b><span class="cs-meta">${done.length} of ${r.steps.length} creatures harvested, worth ${coins(total)}${skipped.length ? `. Skipped: ${esc(skipped.map((s) => s.name).join(", "))}` : ""}.</span></div>${done.map(table).join("")}`;
  }

  async #click(b) {
    const a = b.dataset.hr, s = this.step;
    if (a === "min") { this.min = true; return this.render(); }
    if (a === "show") { this.min = false; return this.render(); }
    if (a === "roll") return this.#roll(this.run.at, [b.dataset.id]);
    if (a === "roll-all") return this.#roll(this.run.at, b.dataset.ids.split(",").filter(Boolean), { dialog: false });
    if (!this.authority) return;
    if (a === "ask" && s && s.lead && s.parts.length) {
      s.asked = true;
      if (!this.run.practice) {
        const offline = [...new Set([s.lead, s.help].filter(Boolean).map((p) => game.actors.get(p.id)).filter((x) => x && !playersOf(x).length).map((x) => x.name))];
        if (offline.length) ui.notifications.info(`KG Realms: no player online for ${offline.join(", ")}. Roll for them in the harvest.`);
      }
      return this.#changed();
    }
    if (a === "ruling" && s) { const key = `${this.run.at}|${b.dataset.key}`; this.ruling = this.ruling === key ? null : key; return this.render(); }
    if (a === "reroll" && s) { delete s.rolls[b.dataset.id]; return this.#changed(); }
    if (a === "rule" && s) {
      const reason = (this.reasons[`${this.run.at}|${b.dataset.key}`] ?? "").trim().slice(0, 500) || "GM ruling";
      s.overrides[b.dataset.key] = { success: b.dataset.result === "success", reason, automatic: !s.asked, by: game.user.id };
      if (!s.asked) s.asked = true;
      return this.#changed();
    }
    if (a === "unrule" && s) { delete s.overrides[b.dataset.key]; return this.#changed(); }
    if (a === "confirm") return this.#confirm();
    if (a === "next" && s?.done) { this.run.at += 1; return this.#changed(); }
    if (a === "skip" && s && !s.done) { this.run.at += 1; return this.#changed(); }
    if (a === "finish" && !s) return this.#finish();
  }
}
