import { sendCampMessage, validWatchChanges } from "./camp-messages.mjs";
import { groupMembers } from "./party-groups.mjs";
import {partyScene,focusedScene} from './party-groups.mjs';
import { ruleTooltip } from "./travel-rules.mjs";
// Making camp, in the travel panel: at the end of a day's travel (the GM's and the players' view)
// and through the night's rest.
//  - Forage and hunt (the Forage at camp setting): one character's Wisdom (Survival) check against
//    a DC the GM picks by what the land offers; on a success each character gets a ration (the
//    module's ration item), or with none set the result is only shown.
//  - The watch order: the party in order, each with the hours they watch (by how they sleep). The
//    GM and the players arrange it together, one at a time: whoever is arranging it holds it, the
//    panel's border takes their colour and says so, and the others wait. The GM can take it over,
//    or lock the players out.
//  - The night (GM): which watch a camp encounter comes in (or one at random), and the scene each
//    watch happens on. Which watch is only the GM's to know.
//  - Through the night: each new watch brings the watcher's portrait up for everyone. An encounter
//    at random rolls as each watch begins: a die one larger than the watches left (1d4, 1d3, 1d2
//    for three watches), a 1 brings it. Players see the rolls unless the GM hides them; never the
//    encounter's name.
//  - Checks a player makes (the watcher's Wisdom (Perception), the forager's Wisdom (Survival)):
//    the GM asks, the player rolls the system's own check with the DC on it (so Tenacity can be
//    spent on its chat card), and the GM confirms the result or allows a reroll.
// Players' changes use their User document; the primary GM validates and writes the journey.
import { SLEEP, FORAGE, WATCH_HOURS, sleepOf, planWatches, awakeAt, campPhases, campSchedule } from "./camp.mjs";
import { TASKS, ALARM_DC, SHIFT_BONUS, leaderWithHelp, concealed, setupWork, pastTaskSummary } from "./camp-tasks.mjs";
import { promptCompletedCampRest } from "./rest-recovery.mjs";
import { isPrimaryGM } from "./authority.mjs";
import { journeyKey } from "./journey-state.mjs";
import { captureScroll, restoreScroll } from "./panel-scroll.mjs";
import { campRequest, matchingCampRequest, rollCampRequest, campRollButton, skillBonus } from "./camp-rolls.mjs";
import { writeJourney } from "./journey-write.mjs";
import { dockOverMap, observeMapUi } from "./ui-docking.mjs";
import { WATCH_ROLL_MS, ambientWatchResult } from "./watch-outcomes.mjs";
import { rollingWatchHtml, watchResultsHtml } from "./watch-roll-view.mjs";
import { CAMP_RESOLUTIONS, encounterTimeRemaining, interruptedCampPhases } from "./camp-resolution.mjs";

const MODULE_ID = "kg-realms";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const HOLD_MS = 2 * 60 * 1000; // a hold left idle this long lapses
const commands = new Set();
const SHARED_ACTIONS = new Set(["watch-continue", "task-override", "check-override", "scene-next", "scene-break", "camp-recover", "recovery-skip", "scene-hold", "scene-carry", "setup", "unsetup", "random-enc", "task-ask", "task-confirm", "task-reroll", "ask", "reroll", "confirm", "enc-drop", "scene-clear"]);
const COLOURS = ["#d9a441", "#9fe1ff", "#e8c38a", "#b8e08a", "#e0a0d0", "#a0b8ff"];
const SKILLS = {
  prc: { name: "perception", label: "Wisdom (Perception)", short: "Perception" },
  sur: { name: "survival", label: "Wisdom (Survival)", short: "Survival" },
  ste: { name: "stealth", label: "Dexterity (Stealth)", short: "Stealth" },
  slt: { name: "sleightOfHand", label: "Dexterity (Sleight of Hand)", short: "Sleight of Hand" }
};
const skillMod = (actor, k) => Number(actor?.system?.skills?.[k]?.total ?? actor?.system?.skills?.[k]?.mod ?? 0) || 0;

const tenacity = () => !!game.modules.get("tenacity")?.active;
/** A rule's "?" with its text on hover, as the travel panel's (the edition from its Rules setting). */
const rule = ruleTooltip;
/** Whether players see the DC of the checks the module asks for: always while Tenacity is active (spends are made against it). */
export function showDC() {
  if (tenacity()) return true;
  try { return game.settings.get(MODULE_ID, "showPerceptionDC") !== false; } catch { return true; }
}
/** The player who rolls for an actor: an active, non-GM owner (else the GM rolls it). */
const playerOf = (actor) => game.users.find((u) => u.active && !u.isGM && actor?.testUserPermission?.(u, "OWNER")) ?? null;
/** Whether this user rolls for the actor. */
const rollsFor = (actor) => (game.user.isGM ? !playerOf(actor) : !!actor?.isOwner);
/**
 * Put an overlay (the camp scene, the watch banner) over the canvas only: just after Foundry's
 * canvas in the page, at its layer, so the interface, the windows and the roll dialogs stay on top.
 */
function overCanvas(el) {
  const board = document.getElementById("board");
  if (!board?.parentElement) { document.body.append(el); return; }
  board.after(el);
  const z = parseInt(getComputedStyle(board).zIndex, 10);
  el.style.zIndex = String(Number.isFinite(z) ? z : 0);
}

export class CampPanel {
  constructor(hud) { this.hud = hud; this.practice = null; }

  /* ------------------------------------------------------------------ where the camp lives */
  // A camp's state is the journey's (the scene's flag, the game clock), or a practice night's
  // (in memory, its own clock: the map editor's Practice tab), which changes nothing in the world.

  /** The camp's state: the journey, or the practice night's. */
  get st() { return this.practice?.state ?? this.hud.state; }
  /** The time now: the game clock, or the practice night's. */
  get now() { return this.practice ? this.practice.clock : this.hud.clock; }
  /** Where the journey stands: the travel panel's, or the practice night's. */
  prog() { return this.practice ? this.#practiceProgress() : this.hud.progress(); }
  /** Save changes to the camp's state (the GM): the journey, or the practice night. */
  async save(changes) {
    if (!this.practice) {
      if (this.commandContext && !this.commandContext.valid()) return;
      return this.hud.save(changes, { undoable: false, ...(this.commandContext ? { scene: this.commandContext.scene, expectedTrip: this.commandContext.trip, expectedCamp: this.commandContext.campId } : {}) });
    }
    if (this.practice.view) return;
    Object.assign(this.practice.state, foundry.utils.deepClone(changes));
    return this.#practiceChanged();
  }
  /** Move time on: the game clock, or the practice night's. */
  async advance(dt) {
    if (!this.practice) {
      if (!isPrimaryGM() || (this.commandContext && !this.commandContext.valid())) return;
      return this.hud.advanceClock(dt);
    }
    if (this.practice.view) return;
    this.practice.clock += dt;
    return this.#practiceChanged();
  }

  /**
   * A practice night (the map editor's Practice tab, the GM): first the camp is made, as at the end
   * of a day's travel (the rest's hours, the tasks and their DCs, the watch order and shared shifts,
   * the night's encounters and scenes), starting from the journey's; then the camp scene plays it,
   * on a clock of its own. Every roll is made here, with no chat card; nothing is kept, no ration
   * given. players: they see the scene too (sent to them as it goes; they cannot act in it).
   */
  startPractice({ players = false } = {}) {
    const real = this.hud.state, w = real.watch ?? {};
    const campId = foundry.utils.randomID();
    const state = {
      name: real.name, rest: real.rest ?? 16, trip: { resumed: {} }, encounters: [],
      watch: foundry.utils.deepClone({ order: w.order, hours: w.hours, sleep: w.sleep, join: w.join, tasks: w.tasks, scenes: w.scenes, setup: 1, campId, phases: { ...campPhases(real.rest), campId }, checks: { night: 1, campId }, asks: {}, reveals: {}, encWatch: {} })
    };
    this.practice = { state, players: !!players, setup: true };
    this.#practiceClock();
    this.sceneMin = false;
    return this.#practiceChanged();
  }

  /** The practice night's clock: the camp made so that the first watch begins on the next hour. */
  #practiceClock() {
    const P = this.practice, rest = P.state.rest;
    P.camped = Math.ceil(game.time.worldTime / 3600) * 3600 - campPhases(rest).setup * 3600;
    P.clock = P.camped;
  }

  /** The practice camp is made: its encounters take their hours (or wait on the watch dice), and the camp scene comes up. */
  async beginPractice() {
    const P = this.practice;
    if (!P?.setup || P.view) return;
    await this.settleEncounters(1);
    P.setup = false;
    this.sceneMin = false;
    return this.write({ scene: { night: 1, step: "camp", hold: false } });
  }

  /** The practice camp being made (the Practice tab shows it), else "". */
  practiceSetupHtml() { return this.practice?.setup && !this.practice.view ? this.#making(this.prog()) : ""; }

  /** End the practice night (for the players too); the camp is the journey's again. */
  endPractice() {
    if (!this.practice) return;
    const sent = this.practice.players && !this.practice.view;
    this.practice = null;
    if (sent) sendCampMessage({ type: "practice", end: true });
    this.renderScene(this.hud.progress());
    this.onPracticeEnd?.();
  }

  /** The practice night changed: the scene is drawn again (and sent to the players); Break camp ends it. */
  #practiceChanged() {
    const P = this.practice;
    if (!P) return;
    if (P.players && !P.view && !P.setup) sendCampMessage({ type: "practice", data: { state: P.state, clock: P.clock, camped: P.camped } });
    if (P.state.watch?.scene?.step === "done") return this.endPractice();
    this.renderScene(this.prog());
    this.onPracticeChange?.();
  }

  /** The practice night as the journey's progress would be: resting, or at an encounter (night 1). */
  #practiceProgress() {
    const P = this.practice, s = P.state, pl = this.plan(), resumed = s.trip?.resumed ?? {};
    // The camp still being made: as at the end of a day's travel.
    if (P.setup) return { status: "decide", night: 1, hour: 0, since: P.camped, dayHours: 0 };
    let held = 0, active = null;
    const encs = (s.encounters ?? []).filter((e) => e.rest && !e.rest.pending && !e.rest.quiet).sort((a, b) => a.rest.at - b.rest.at);
    for (const e of encs) {
      const t = P.camped + e.rest.at * 3600 + held;
      if (t > P.clock) break;
      if (resumed[e.id] == null) { active = { e, t }; break; }
      held += Math.max(0, resumed[e.id] - t);
    }
    if (active) return { status: "encounter", camp: true, night: 1, hour: 0, since: active.t, campStart: P.camped, encounter: active.e };
    return { status: "resting", night: 1, hour: 0, since: P.camped, until: s.trip?.campEnds?.[1]?.at ?? (P.camped + pl.rest * 3600 + held) };
  }

  /** Whether this user rolls for the actor: as ever; in a practice night the GM rolls for everyone, and those watching roll for no one. */
  rollsFor(actor) { return this.practice ? game.user.isGM && !this.practice.view : rollsFor(actor); }

  /** A practice roll (no chat card): 1d20 + the actor's skill. */
  async #practiceRoll(actor, skill, disadvantage = false) {
    const mod = skillMod(actor, skill);
    return (await new Roll(`${disadvantage ? "2d20kl" : "1d20"} + @mod`, { mod }).evaluate()).total;
  }

  #setting(k) { try { return game.settings.get(MODULE_ID, k); } catch { return undefined; } }
  get watch() { return this.st.watch ?? {}; }

  /** The party, in watch order: [{ id, name, img, pp, survival, sleep, actor }]. */
  members() {
    const w = this.watch, list = this.hud.members().map((a) => {
      const race = a.items?.find((i) => i.type === "race")?.name ?? a.system?.details?.race?.name ?? a.system?.details?.race ?? "";
      return {
        id: a.id, name: a.name, img: a.img, actor: a,
        pp: Number(a.system?.skills?.prc?.passive ?? 10),
        survival: Number(a.system?.skills?.sur?.total ?? a.system?.skills?.sur?.mod ?? 0),
        sleep: w.sleep?.[a.id] ?? sleepOf({ race: typeof race === "string" ? race : "", items: [...(a.items ?? [])] })
      };
    });
    const order = w.order ?? [];
    return list.sort((x, y) => { const i = order.indexOf(x.id), j = order.indexOf(y.id); return (i < 0 ? 999 : i) - (j < 0 ? 999 : j); });
  }

  /** Advanced watches (the setting): each character picks a task in camp. */
  get advanced() { return !!this.#setting("advancedWatches"); }
  /** No setup work is always available; activities follow the Advanced watches settings. */
  taskOn(k) { return k === "watch" || (this.advanced && !!TASKS[k] && !!this.#setting(TASKS[k].setting)); }
  /** A member's task: as picked (Advanced watches), else Watch. */
  taskOf(id) { const t = this.watch.tasks?.[id]; return this.advanced && t && this.taskOn(t) ? t : "watch"; }
  /** Everyone remains available in the watch order; hours of zero explicitly opt out. */
  watchers() { return this.members(); }
  fatigue(id) { return setupWork(this.watch, id, this.taskOf(id)); }

  /** Only the actor's own active watch is tiring, never setup, packing, another watch or an old camp. */
  fatiguedOnWatch(id, p = this.prog()) {
    if (!this.watch.campId || this.watch.scene?.night !== p?.night || this.#stepWatch(this.watch.scene?.step) == null || !this.fatigue(id)) return false;
    const n = this.#tonight(p), w = n?.cur >= 0 ? n.pl.watches[n.cur] : null;
    return !!w && this.#awake(w, n.into).includes(id);
  }

  /** The night's watches: { watches, sleepers, covered, window }, plus the rest's length. */
  plan() {
    const w = this.watch;
    const stored = !!w.phases && w.phases.campId === w.campId && (w.scene ? w.scene.step !== "done" : w.setup != null);
    const phases = stored ? w.phases : campPhases(this.st.rest, { legacy: !!w.scene && w.scene.step !== "done" });
    const hours = { ...w.hours };
    // Older Rest selections display as No setup work. Retain their implicit opt-out until
    // watch hours are explicitly chosen, so removing the option cannot assign a new watch.
    for (const m of this.watchers()) if (this.advanced && w.tasks?.[m.id] === "rest" && !Number.isFinite(hours[m.id])) hours[m.id] = 0;
    return { ...planWatches(this.watchers(), hours, phases.sleep, w.join ?? {}), ...phases, rest: phases.total };
  }

  schedule(p = this.prog()) {
    const pl = this.plan(), started = p?.camp ? p.campStart : p?.since;
    if (!Number.isFinite(started)) return null;
    let held = p.status === "resting" ? Math.max(0, (p.until ?? started + pl.rest * 3600) - started - pl.rest * 3600) : 0;
    if (p.camp) {
      const e = (this.st.encounters ?? []).find((e) => e.id === p.encounter?.id) ?? p.encounter;
      held = Math.max(0, p.since - started - (e?.rest?.at ?? 0) * 3600) + Math.max(0, this.now - p.since);
    }
    return campSchedule(pl, started, held);
  }

  #duration(seconds) {
    const minutes = Math.max(0, Math.round(seconds / 60)), h = Math.floor(minutes / 60), m = minutes % 60;
    return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
  }

  #range(from, to) { return `${this.#dateTime(from)} to ${this.#dateTime(to)} (${this.#duration(to - from)})`; }

  phaseStatus(p = this.prog()) {
    if (!p || !(p.status === "resting" || p.camp)) return null;
    const s = this.schedule(p), pl = this.plan(), step = this.watch.scene?.step;
    if (!s || pl.version !== 2) return { label: "Camped", detail: "This camp keeps its earlier saved timing." };
    if (step === "recovery") return { label: "Rest complete", detail: `Recovery is separate from packing. Departure: ${this.#dateTime(s.end)}.` };
    if (this.now < s.setupEnd) return { label: "Setup", detail: `${this.#duration(s.setupEnd - this.now)} remaining. Rest begins ${this.#dateTime(s.restStart)}.` };
    if (this.now < s.restEnd) return { label: "Rest and watches", detail: `${this.#duration(s.restEnd - this.now)} remaining in the rest window.` };
    if (this.now < s.packStart) return { label: "Waiting", detail: `${this.#duration(s.packStart - this.now)} until packing begins. Rest is complete.` };
    return { label: "Packing", detail: `${this.#duration(s.end - this.now)} until departure at ${this.#dateTime(s.end)}.` };
  }

  #phaseName(step) {
    return step === "camp" || TASKS[step] ? "setup" : ["wait", "pack", "done"].includes(step) ? "break" : "rest";
  }

  #phaseSummary(p, step = null) {
    const pl = p.status === "decide" ? campPhases(this.st.rest) : this.plan(); if (pl.version !== 2) return '<p class="cs-note">This camp uses its earlier saved timing. New camps use 4 h setup, 8 h rest and 4 h packing.</p>';
    const s = p.status === "decide" ? campSchedule(pl, this.practice ? p.since : this.now) : this.schedule(p);
    if (!s) return "";
    const active = step ? this.#phaseName(step) : "setup";
    const one = (key, label, from, to, info) => `<div class="camp-phase ${key === active ? "current" : ""}"><b>${label}</b><span>${esc(this.#range(from, to))}</span><small>${info}</small></div>`;
    return `<div class="camp-phases" aria-label="Camp schedule">${one("setup", "Setup", s.started, s.setupEnd, "Activities happen together; this is not sleep.")}${one("rest", "Rest and watches", s.restStart, s.restEnd, pl.interrupted ? "Rest was interrupted. No recovery was granted." : s.held ? `8 h rest plus ${this.#duration(s.held)} interruption.` : "Watch shifts share this rest window.")}${one("break", "Break camp", s.restEnd, s.end, pl.wait ? `${pl.wait} h waiting, then 4 h packing.` : "Packing, breakfast and preparation to depart.")}</div>`;
  }

  async #advanceTo(time) { const seconds = Math.ceil(time - this.now); if (seconds > 0) await this.advance(seconds); }

  watchTimes(p, i) {
    const pl = this.plan(), s = this.schedule(p), w = i < 0 ? { from: 0, to: pl.window } : pl.watches[i];
    if (!s || !w) return null;
    if (pl.version !== 2) return { from: s.restStart + s.held + w.from * 3600, to: s.restStart + s.held + w.to * 3600, held: 0 };
    let held = 0, before = 0, during = 0;
    const encs = (this.st.encounters ?? []).filter((e) => e.rest?.night === p.night && !e.rest.pending && !e.rest.quiet).sort((a, b) => a.rest.at - b.rest.at);
    for (const e of encs) {
      const at = s.started + e.rest.at * 3600 + held, end = this.st.trip?.resumed?.[e.id] ?? (p.encounter?.id === e.id ? this.now : at);
      const wait = Math.max(0, end - at), index = e.rest.watch ?? this.#watchOf(e.rest.at, pl);
      if (index < i) before += wait; else if (index === i) during += wait;
      held += wait;
    }
    return { from: s.restStart + w.from * 3600 + before, to: s.restStart + w.to * 3600 + before + during, held: during };
  }

  #nextAdvance(p, next) {
    const s = this.schedule(p), i = this.#stepWatch(next), n = this.#tonight(p);
    let target = this.now;
    if (i != null) target = n.start + (i < 0 ? 0 : n.pl.watches[i].from) * 3600;
    else if (next === "recovery") target = s.restEnd;
    else if (next === "pack") target = s.packStart;
    else if (next === "done") target = s.end;
    const seconds = Math.max(0, target - this.now);
    return seconds ? `Advance ${this.#duration(seconds)} to ${this.#dateTime(target)}.` : "No world time advances.";
  }

  /** Tonight's task checks: { night, forage, conceal, alarm }, each { dc, leader, asked, rolls, rerolls, done, result }. */
  defaultTaskDc(key) { return (this.watch.biome??this.hud.currentBiome?.())?.dc?.[key]??TASKS[key]?.dc; }
  #checks(night) {
    const c = this.watch.checks, campId = this.watch.campId;
    if (!campId || c?.campId !== campId || c.night !== night) return { night, campId };
    const clean = { ...c };
    for (const key of ["forage", "conceal", "alarm"]) if (clean[key]?.campId !== campId && (clean[key]?.asked || clean[key]?.done || Object.keys(clean[key]?.rolls ?? {}).length)) delete clean[key];
    return clean;
  }

  async #ensureCamp(night) {
    if (this.watch.campId && this.watch.checks?.campId === this.watch.campId && this.watch.checks.night === night && this.watch.scene?.step !== "done") return;
    const campId = foundry.utils.randomID();
    const phases = { ...campPhases(this.st.rest, { legacy: !!this.watch.scene && this.watch.scene.step !== "done" }), campId };
    await this.write({ campId, phases, biome:this.practice?null:this.hud.currentBiome?.()??null, checks: { night, campId }, asks: {}, reveals: {}, resolutions: [], recovery: null });
  }
  /** The camp's results that change the night: watchers the concealment adds, whether the alarms are set. */
  campEffects(night) {
    const c = this.#checks(night);
    return { conceal: c.conceal?.done ? c.conceal.result?.successes ?? 0 : 0, alarm: !!(c.alarm?.done && c.alarm.result?.success) };
  }

  /** Who holds the watch order now (a user, while their hold is fresh), or null. */
  holder(w = this.watch) {
    const l = w.lock;
    if (!l?.user) return null;
    const u = game.users.get(l.user);
    return u?.active && Date.now() - (l.at ?? 0) < HOLD_MS ? u : null;
  }
  /** Whether this user may change the watch order now. */
  canEdit() {
    if (game.user.isGM) return true;
    if (this.watch.gmLock) return false;
    const h = this.holder();
    return !h || h.isSelf;
  }

  /* ------------------------------------------------------------------ writing */

  /** Change the watch: the GM writes it; a player asks the GM's client (over the socket). */
  async write(changes) {
    if (this.practice) return this.save({ watch: { ...this.watch, ...changes } });
    if (game.user.isGM) return this.save(Object.fromEntries(Object.entries(changes).map(([key, value]) => [`watch.${key}`, value])));
    return this.request({ changes });
  }
  /** Take hold of the watch order (a player), or let it go. */
  hold(on) {
    const lock = on ? { user: game.user.id, at: Date.now() } : null;
    if (game.user.isGM) return this.write({ lock });
    return this.request({ hold: on ? "take" : "release" });
  }
  /**
   * Authenticated User document messages. On every client: a watch change banner a GM sent (the practice night). On the
   * GM's client (the one active GM): a player's change to a journey's watch, if they may make it.
   */
  request(data) { return sendCampMessage({ type: "watch", scene: this.hud.scene.id, partyId: this.hud.scene.partyId, trip: journeyKey(this.st), campId: this.watch.campId ?? null, ...data }); }

  onMessage(m, userId) {
    this.socketQueue = (this.socketQueue ?? Promise.resolve()).then(() => this.#onMessage(m, userId)).catch((err) => console.warn("kg-realms | camp request:", err));
    return this.socketQueue;
  }
  async #onMessage(m, userId) {
    if (m?.type === "banner") { if (game.users.get(userId)?.isGM) showBanner(m.data); return; }
    // A GM's practice night, shown to the players (who watch it; they cannot act in it).
    if (m?.type === "practice") {
      const from = userId;
      if (!game.users.get(from)?.isGM || from === game.user.id || (this.practice && !this.practice.view)) return;
      if (m.end) { this.practice = null; this.renderScene(this.hud.progress()); return; }
      this.practice = { ...m.data, view: true };
      this.renderScene(this.prog());
      return;
    }
    if (m?.type !== "watch" || !isPrimaryGM()) return;
    const scene = partyScene(game.scenes.get(m.scene),m.partyId), j = scene?.getFlag(MODULE_ID, "journey");
    const sender = game.users.get(userId);
    if (!sender?.active || !j || m.trip !== journeyKey(j) || m.campId !== (j.watch?.campId ?? null) || (scene.partyId&&focusedScene(scene.realScene)!==scene)) return;
    const members = scene === this.hud.scene ? this.hud.members() : (this.hud.partyTokens?.(scene) ?? []).flatMap(t => groupMembers(t.actor));
    const ids = new Set(members.map(a => a.id));
    const w = j.watch ?? {}, h = this.holder(w);
    const put = (changes) => writeJourney(scene, (fresh) => ({ watch: { ...fresh.watch, ...changes } }), { trip: journeyKey(j), campId: w.campId });
    // A player's pick of task for a character of theirs (no hold: each picks their own).
    if (m.taskSet) {
      const user = sender, actor = game.actors.get(m.taskSet.id);
      if (ids.has(m.taskSet.id) && actor?.testUserPermission?.(user, "OWNER") && this.taskOn(m.taskSet.task)) await put({ tasks: { ...(w.tasks ?? {}), [m.taskSet.id]: m.taskSet.task } });
      return;
    }
    if (w.gmLock) return;
    if (m.hold === "take") { if (!h || h.id === userId) await put({ lock: { user: userId, at: Date.now() } }); return; }
    if (m.hold === "release") { if (h?.id === userId) await put({ lock: null }); return; }
    // Changes only from whoever holds it (a hold is taken by the first change).
    if (h && h.id !== userId) return;
    if (!validWatchChanges(m.changes, ids)) return;
    const c = m.changes;
    await put({ ...c, lock: { user: userId, at: Date.now() } });
  }

  /* ------------------------------------------------------------------ drawing */

  /** The clock time (HH:MM) at world time t. */
  #clock(t) {
    const c = game.time.calendar?.timeToComponents?.(t) ?? {};
    return `${String(c.hour ?? 0).padStart(2, "0")}:${String(c.minute ?? 0).padStart(2, "0")}`;
  }

  /** Include the calendar date so a next-morning rest cannot look like a same-night finish. */
  #dateTime(t) {
    if (!Number.isFinite(t)) return "Awaiting the GM's schedule";
    if (this.hud.dateText) return this.hud.dateText(t, "datetime24");
    const c = game.time.calendar?.timeToComponents?.(t);
    return c?.dayOfMonth != null ? `${c.year ?? ""}-${(c.month ?? 0) + 1}-${c.dayOfMonth + 1}, ${this.#clock(t)}` : this.#clock(t);
  }

  /** The watches as a bar across the night, coloured per watcher, with a "now" mark (0 to 1) or none, and the watch now (index) picked out. */
  #bar(pl, members, nowAt = null, start = null, cur = -1) {
    const name = (id) => members.find((m) => m.id === id)?.name.split(" ")[0] ?? "?";
    const ticks = start == null ? "" : `<div class="camp-ticks">${[0, 0.25, 0.5, 0.75, 1].map((f) => `<span>${this.#clock(start + f * pl.window * 3600)}</span>`).join("")}</div>`;
    const parts = pl.watches.map((w, i) => `<span class="${i === cur ? "cur" : cur >= 0 && i > cur ? "later" : ""}" style="flex:${w.to - w.from};background:${COLOURS[i % COLOURS.length]}">${esc([w.id, ...(w.with ?? [])].map(name).join(" & "))}</span>`).join("");
    const gap = pl.window - pl.covered > 1e-6 ? `<span class="camp-gap" style="flex:${pl.window - pl.covered}">no one</span>` : "";
    const now = nowAt != null ? `<i class="camp-now" style="left:${(nowAt * 100).toFixed(1)}%"></i>` : "";
    return `${ticks}<div class="camp-bar">${parts}${gap}${now}</div>`;
  }

  /** The panel for this moment of the journey, or "" when there is no camp. p: the journey's progress. */
  /** Which part of camp the journey is at: "decide", "setup", "night", "sea", or null. */
  stage(p) {
    if (!p || this.practice) return null;
    if (p.status === "decide") return this.watch.setup !== p.night || this.watch.scene ? "decide" : "setup";
    if (p.status === "resting" || (p.status === "encounter" && p.camp)) return "night";
    return p.sailing && this.#setting("watchesAtSea") ? "sea" : null;
  }

  html(p) {
    // A practice night is in the camp scene only; the travel panel stays the journey's.
    if (!p || this.practice) return "";
    if (p.status === "decide") return this.#making(p);
    if (p.status === "resting" || (p.status === "encounter" && p.camp)) return this.#night(p);
    if (p.sailing && this.#setting("watchesAtSea")) return this.#atSea();
    return "";
  }

  /**
   * The end of a day's travel: first the choice (make camp, or push on); once camp is made, the
   * tasks (Advanced watches), the watch order, the camp plan (GM), and Begin camp setup.
   */
  #making(p) {
    const gm = game.user.isGM, w = this.watch, R = this.hud.ruleText();
    if (w.setup !== p.night || w.scene) {
      const hours = Math.max(16, Math.min(72, Number(this.st.rest) || 16));
      const progress = this.#phaseSummary(p, "camp");
      const forced = p.limit + 1 > 8;
      return `<div class="camp camp-dock"><div class="camp-dock-heading"><small>NIGHT ${p.night} · REST AND WATCHES</small><h4>End of the day: make camp or push on?</h4><span>${(Math.round((p.dayHours ?? 0) * 10) / 10)} h on the road today</span></div>
        <div class="camp-dock-current"><b>Travel has stopped. Camp has not begun.</b><p>${gm ? "Review the camp schedule, or travel one more hour. Setup begins when you choose Begin camp setup." : "Waiting for the GM to make camp or push on."}</p>
          ${gm ? `<label class="camp-hours">Hours in camp <input type="number" name="rest" min="16" max="72" value="${hours}"></label><small>Camp ends at ${esc(this.#dateTime((this.practice ? p.since ?? this.now : this.now) + hours * 3600))}</small>` : ""}</div>
        ${progress}${gm ? `<div class="now-main camp-go"><button data-camp="setup" class="primary"><i class="fa-solid fa-campground"></i> Make camp</button><button data-act="push" ${this.hud.leader ? "" : "disabled"} title="Travel one more hour, stopping at an encounter or arrival if either comes first"><i class="fa-solid fa-person-walking-arrow-right"></i> Push on for 1 hour</button></div>
        <p class="hint camp-rules">${forced ? `Forced march: Constitution save DC ${10 + (p.limit + 1 - 8)} per character at the end of the hour, or gain exhaustion.` : "The extra hour stays within eight hours of travel today."} ${rule(R.forced)}</p>` : ""}</div>`;
    }
    const members = this.members(), watchers = this.watchers(), pl = this.plan();
    // Begin camp setup records the actual world time; planning previews that same start.
    const restStart = this.practice ? p.since ?? this.now : this.now, start = restStart + (pl.setup ?? pl.rest - pl.window) * 3600;
    const tasks = this.advanced ? this.#tasks(p, members) : "";
    const steps = tasks ? 2 : 1, joins = w.join ?? {};
    const rows = watchers.map((m, i) => {
      const wt = pl.watches.find((x) => x.ends?.[m.id] != null), s = SLEEP[m.sleep], joined = !!(wt && wt.id !== m.id);
      // Each keeps their own hours, a shared watch's from its start.
      const mine = wt ? wt.ends[m.id] - wt.from : 0;
      const when = wt ? `${this.#clock(start + wt.from * 3600)} to ${this.#clock(start + wt.ends[m.id] * 3600)}` : "sleeps through";
      const edit = this.canEdit();
      const join = i > 0 ? (() => { const above = esc(watchers[i - 1].name.split(" ")[0]);
        return `<div class="camp-row-join"><label class="camp-join"><input type="checkbox" data-camp="join" data-id="${m.id}" ${joins[m.id] ? "checked" : ""} ${edit ? "" : "disabled"}> Watch with ${above}</label>${rule(R.shift)}</div>`; })() : "";
      return `<li class="camp-row ${wt ? "on" : "off"} ${joined ? "joined" : ""} ${wt && this.fatigue(m.id) ? "camp-fatigued" : ""}" data-id="${m.id}" ${edit ? 'draggable="true"' : ""}>
        ${edit ? `<span class="grip" aria-hidden="true"><i class="fa-solid fa-grip-vertical"></i></span>` : ""}<span class="n">${wt ? (joined ? "+" : pl.watches.indexOf(wt) + 1) : ""}</span>
        <img src="${esc(m.img)}" alt="">
        <span class="who"><b data-tooltip="${esc(m.name)}">${esc(m.name)}</b><small class="sleep-${m.sleep}" data-tooltip="${esc(s.hint)}">${esc(s.label)} · ${esc(when)}</small></span>
        <span class="pp" title="Passive Perception">PP ${m.pp}</span>
        <label class="hrs">${edit ? `<input type="number" data-camp="hours" data-id="${m.id}" min="0" max="${pl.window}" step="0.5" value="${mine}" aria-label="Hours on watch">` : `${mine}`} h</label>
        ${edit ? `<span class="mv"><button data-camp="up" data-i="${i}" title="Earlier" ${i === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-up"></i></button><button data-camp="down" data-i="${i}" title="Later" ${i === watchers.length - 1 ? "disabled" : ""}><i class="fa-solid fa-arrow-down"></i></button></span>` : ""}
        <label class="camp-duty"><input type="checkbox" data-camp="watch-duty" data-id="${m.id}" ${wt ? "checked" : ""} ${edit ? "" : "disabled"}> Take a watch${wt ? "" : " (off)"}</label>
        ${wt ? this.#fatigueNote([m.id]) : ""}${join}
      </li>`;
    }).join("");
    const short = !pl.watches.length ? `<p class="warn-line"><i class="fa-solid fa-circle-exclamation"></i> No one keeps watch: an encounter tonight takes the camp by surprise${this.taskOn("alarm") ? ", unless the alarms are set" : ""}.</p>`
      : pl.covered < pl.window - 1e-6 ? `<p class="warn-line"><i class="fa-solid fa-circle-exclamation"></i> The watches cover ${pl.covered} of ${pl.window} h. Add hours, or someone to watch.</p>` : "";
    const h = this.holder(), mine = h?.isSelf, practice = !!this.practice;
    const holdLine = practice ? "" : !gm && !this.canEdit() ? `<p class="hint">${w.gmLock ? "The GM is arranging the watch." : `${esc(h?.name)} is arranging the watch. Wait for them to finish.`}</p>`
      : !gm ? `<div class="row camp-hold">${mine ? `<span class="grow">You are arranging the watch.</span><button data-camp="release" class="primary">Done</button>` : `<span class="grow">Drag to arrange, or use the arrows.</span>`}</div>` : "";
    const gmHold = gm && !practice ? `<div class="row camp-hold"><label class="grow"><input type="checkbox" data-camp="gmlock" ${w.gmLock ? "checked" : ""}> Only I arrange the watch</label>${h && !h.isSelf ? `<button data-camp="takeover" title="End ${esc(h.name)}'s turn">Take over</button>` : ""}</div>` : "";
    const watch = `<section class="camp-step"><h4><span class="step">${steps}</span> Watch order ${rule(`${R.watch} ${R.shift} ${R.sleep}`)}<span class="sp"></span><small>${practice ? "Only you, for the practice" : gm ? "Players can arrange it too" : "Shared with the party"}</small></h4>
      ${this.#bar(pl, members, null, start)}
      ${rows ? `<ol class="camp-list" data-camp-list>${rows}</ol>` : ""}${short}${holdLine}${gmHold}</section>`;
    const night = gm ? this.#nightSetup(p, pl, members, steps + 1) : "";
    if (practice) {
      const hours = `<section class="camp-step"><label class="camp-hours">Camp for <input type="number" data-camp="practice-rest" min="16" max="72" value="${pl.rest}"> hours</label></section>`;
      const begin = `<div class="now-main camp-go"><button data-camp="practice-begin" class="primary"><i class="fa-solid fa-moon"></i> <span>Begin the practice night <span class="camp-duration">(${pl.rest} h)</span></span></button><button data-camp="practice-end"><i class="fa-solid fa-xmark"></i> Discard</button></div>
        <p class="hint camp-rules">The long rest ${rule(R.rest)}</p>`;
      return `<div class="camp">${hours}${tasks}${watch}${night}${begin}</div>`;
    }
    const views = gm ? (this.advanced ? ["tasks", "watches", "night"] : ["watches", "night"]) : (this.advanced ? ["tasks", "watches"] : ["watches"]);
    const view = views.includes(this.setupView) ? this.setupView : views[0];
    const stage = { tasks, watches: watch, night }[view];
    const next = views[views.indexOf(view) + 1];
    const labels = { tasks: "Tasks", watches: "Watches", night: "Camp plan" };
    // The setup's steps, numbered; those behind marked done (each step's one main button leads on).
    const at = views.indexOf(view);
    const nav = `<nav class="camp-dock-nav kgr-camp-steps" aria-label="Camp setup">${views.map((v, i) => `<button type="button" data-camp="view" data-view="${v}" class="${v === view ? "current" : i < at ? "done" : ""}" ${v === view ? 'aria-current="step"' : ""}><span class="num">${i < at ? '<i class="fa-solid fa-check"></i>' : i + 1}</span>${labels[v]}</button>`).join("")}</nav>`;
    const go = gm ? `<div class="now-main camp-go">${next ? `<button data-camp="view" data-view="${next}" class="primary">Review ${labels[next].toLowerCase()}</button>` : `<button data-act="camp" class="primary"><i class="fa-solid fa-campground"></i> <span>Begin camp setup <span class="camp-duration">(${pl.rest} h)</span></span></button>`}<button data-camp="unsetup" title="Back to the choice: make camp or push on"><i class="fa-solid fa-arrow-left"></i> Back</button></div>
      ${!next ? `<p class="hint camp-rules">The long rest ${rule(R.rest)}</p>` : ""}`
      : `<p class="hint">Waiting for the GM to begin camp setup.</p>`;
    return `<div class="camp camp-dock"><div class="camp-dock-heading"><small>NIGHT ${p.night} · REST AND WATCHES</small><h4>${labels[view]}</h4><span>Camp for ${pl.rest} hours. Camp ends at ${esc(this.#dateTime(restStart + pl.rest * 3600))}</span></div>${this.#phaseSummary(p, "camp")}${nav}${stage}${go}</div>`;
  }

  /**
   * The camp's tasks (Advanced watches): each character's pick (theirs to make, or the GM's), then
   * each task with someone on it, its check and its result.
   */
  #tasks(p, members) {
    const gm = game.user.isGM, R = this.hud.ruleText(), keys = Object.keys(TASKS).filter((k) => this.taskOn(k));
    const rows = members.map((m) => {
      const t = this.taskOf(m.id), mine = gm || m.actor?.isOwner;
      return `<li class="camp-task-row"><img src="${esc(m.img)}" alt=""><b class="grow">${esc(m.name)}</b>
        <select data-camp="task" data-id="${m.id}" ${mine ? "" : "disabled"} aria-label="${esc(m.name)}'s task">${keys.map((k) => `<option value="${k}" ${k === t ? "selected" : ""}>${esc(TASKS[k].label)}</option>`).join("")}</select></li>`;
    }).join("");
    const checks = ["forage", "conceal", "alarm"].filter((k) => this.taskOn(k)).map((k) => this.#taskCheck(k, p, members)).join("");
    return `<section class="camp-step"><h4><span class="step">1</span> Camp tasks ${rule(R.tasks)}<span class="sp"></span><small>One setup activity each. Watch duty is separate.</small></h4>${this.watch.biome?`<p class="hint">Biome: ${esc(this.watch.biome.name)}. Task DCs start from this biome's settings; the GM can override them.</p>`:""}
      <ul class="camp-tasks">${rows}</ul>${checks}</section>`;
  }

  /**
   * One task's check: the GM sets the DC (and the leader, Leader with Help) and asks; each on the
   * task rolls (the system's own check, the DC on it); the GM allows rerolls and confirms. Foraging's
   * success hands out the rations.
   */
  #taskCheck(key, p, members) {
    const gm = game.user.isGM, T = TASKS[key], R = this.hud.ruleText(), who = members.filter((m) => this.taskOf(m.id) === key);
    if (!who.length) return "";
    const c = this.#checks(p.night)[key] ?? {}, dc = c.dc ?? this.defaultTaskDc(key), seen = gm || showDC();
    const best = [...who].sort((a, b) => Math.max(...T.skills.map((s) => skillMod(b.actor, s))) - Math.max(...T.skills.map((s) => skillMod(a.actor, s))))[0];
    const leader = T.help ? (who.some((m) => m.id === c.leader) ? c.leader : best.id) : null;
    const skills = T.skills.map((s) => SKILLS[s].label).join(" or ");
    const tip = { forage: R.forage, conceal: R.conceal, alarm: R.alarm }[key];
    const head = `<div class="camp-task-head"><i class="fa-solid ${T.icon}"></i><b>${esc(T.label)}</b> ${rule(tip)}<span class="grow"></span><small>${esc(skills)}${seen ? ` · DC ${dc}` : ""}</small></div>`;
    if (c.done) return `<div class="camp-task done">${head}${this.#taskResult(key, c, who)}</div>`;
    // Before asking (GM): the DC and the leader.
    if (!c.asked) {
      if (!gm) return `<div class="camp-task">${head}<span class="hint">${who.map((m) => esc(m.name.split(" ")[0])).join(", ")}: waiting for the GM to ask for the checks.</span></div>`;
      const dcField = key === "forage" ? `<label>What the land offers<select data-camp="task-dc" data-key="${key}">${FORAGE.some(x=>x.dc===dc)?"":`<option value="${dc}" selected>DC ${dc} · biome or GM override</option>`}${FORAGE.map((x) => `<option value="${x.dc}" ${x.dc === dc ? "selected" : ""}>DC ${x.dc} · ${esc(x.label)}</option>`).join("")}</select></label>`
        : `<label>DC <input type="number" data-camp="task-dc" data-key="${key}" min="1" max="40" value="${dc}" style="width:4em"></label>`;
      const lead = T.help && who.length > 1 ? `<label>Leader<select data-camp="task-leader" data-key="${key}">${who.map((m) => `<option value="${m.id}" ${m.id === leader ? "selected" : ""}>${esc(m.name)}${m.id === best.id ? " (best)" : ""}</option>`).join("")}</select></label>` : "";
      return `<div class="camp-task">${head}<div class="camp-task-fields">${dcField}${lead}</div>
        <small class="hint">Resolve this activity in the camp panel. The GM can request rolls or set an automatic outcome.</small></div>`;
    }
    // Asked: each one's roll, or their roll buttons (whoever rolls for them).
    const spend = tenacity() ? " Failed the check? Spend Tenacity from the roll's chat card." : "";
    const lines = who.map((m) => {
      const r = c.rolls?.[m.id], role = T.help ? (m.id === leader ? "leads" : "helps") : "";
      const result = r?.total != null ? `<b>${r.total}</b> <small>${esc(SKILLS[r.skill]?.short ?? "")}</small>${seen ? ` <span class="${r.total >= dc ? "ok" : "no"}">${r.total >= dc ? "success" : "failure"}</span>` : ""}${gm ? `<button data-camp="task-reroll" data-key="${key}" data-id="${m.id}" title="Allow a reroll"><i class="fa-solid fa-rotate-right"></i></button>` : ""}`
        : this.rollsFor(m.actor) ? this.#taskButtons(key, m.id)
        : `<small>waiting</small>`;
      return `<li><img src="${esc(m.img)}" alt=""><span class="grow">${esc(m.name)}${role ? ` <small>${role}</small>` : ""}</span>${result}</li>`;
    }).join("");
    let sum = "";
    if (T.help) {
      const lw = leaderWithHelp(c.rolls ?? {}, leader, dc);
      sum = lw ? `<p class="camp-task-sum">${lw.base}${lw.helps.map((h) => ` ${h.ok ? "+" : "−"} 1`).join("")} = <b>${lw.total}</b>${seen ? ` against DC ${dc}: <span class="${lw.success ? "ok" : "no"}">${lw.success ? "success" : "failure"}</span>` : ""}</p>` : "";
    } else if (T.stack) {
      const n = concealed(c.rolls, dc), rolled = Object.values(c.rolls ?? {}).filter((r) => r?.total != null).length;
      sum = rolled ? `<p class="camp-task-sum">${n} of ${rolled} succeeded: <b>+${n}</b> to the watch count for tonight's encounter dice.</p>` : "";
    }
    const anyRolled = Object.values(c.rolls ?? {}).some((r) => r?.total != null), ready = T.help ? c.rolls?.[leader]?.total != null : anyRolled;
    const confirm = gm ? `<div class="row"><button data-camp="task-confirm" data-key="${key}" class="primary grow" ${ready ? "" : "disabled"}><i class="fa-solid fa-check"></i> Confirm result</button></div>` : `<small class="hint">${spend.trim()} The GM confirms the result, or allows a reroll.</small>`;
    return `<div class="camp-task">${head}<ul class="camp-task-rolls">${lines}</ul>${sum}${confirm}</div>`;
  }

  /** A confirmed task's result line. */
  #taskResult(key, c, who) {
    const r = c.result ?? {}, seen = game.user.isGM || showDC();
    const success = key === "conceal" ? r.successes > 0 : !!r.success;
    const line = !c.override && r.total != null ? `${r.total}${seen ? ` against DC ${c.dc}` : ""}. ` : "";
    const effect = key === "conceal" ? (success ? `The camp was concealed. Add ${r.successes} to the watch encounter dice.` : "The camp could not be hidden.")
      : key === "forage" ? (success ? `Food was found for everyone.${c.given ? ` ${c.given} rations handed out.` : ""}` : "No food found.")
      : success ? `Alarms were set. Perception DC was ${ALARM_DC} lower; the camp cannot be surprised.` : "The alarms did not work.";
    return `<div class="camp-result ${success ? "ok" : "no"}"><span class="grow"><strong>${c.override?.automatic ? "Automatic " : ""}${success ? "Success" : "Failure"}.</strong> ${line}${effect}${c.override ? `<span class="camp-ruling-reason"><strong>Reason:</strong> ${esc(c.override.reason)}</span>` : ""}</span></div>`;
  }

  #overrideUI(key, kind = "task", automatic = false) {
    if (!game.user.isGM) return "";
    if (this.overrideReasonCamp !== this.watch.campId) { this.overrideReasons = {}; this.overrideReasonCamp = this.watch.campId; }
    const draft = this.overrideReasons?.[`${kind}:${key}`] ?? "";
    return `<fieldset class="camp-override"><legend>Override</legend><label>Reason <input type="text" data-camp="override-reason" data-kind="${kind}" data-key="${key}" maxlength="500" value="${esc(draft)}" placeholder="For example: Alarm scroll covers the camp"></label><div class="row"><button data-camp="${kind}-override" data-camp-id="${esc(this.watch.campId)}" data-key="${key}" data-result="success" class="ruling-success">${automatic ? "Automatic success" : "Success"}</button><button data-camp="${kind}-override" data-camp-id="${esc(this.watch.campId)}" data-key="${key}" data-result="failure" class="ruling-failure">Failure</button></div></fieldset>`;
  }

  async #overrideResult(key, kind, success) {
    const night = this.prog()?.night, reason = (this.overrideReasons?.[`${kind}:${key}`] ?? "").trim().slice(0, 500) || "GM ruling";
    if (kind === "task") {
      if (!TASKS[key]?.skills || this.sceneNow(this.prog())?.step !== key) return;
      const all = this.#checks(night), c = all[key] ?? {}; if (c.done) return;
      const who = this.members().filter((m) => this.taskOf(m.id) === key);
      const result = TASKS[key].stack ? { successes: success ? who.length : 0 } : { success };
      const given = success && key === "forage" && !this.practice ? await this.#giveRations(this.members().map((m) => m.actor)) : 0;
      return this.write({ checks: { ...all, [key]: { ...c, campId: this.watch.campId, dc: c.dc ?? this.defaultTaskDc(key), workers: who.map((m) => m.id), done: true, result, given, override: { success, reason, automatic: !c.asked, by: game.user.id, at: this.now } } } });
    }
    const p = this.prog(), n = this.#tonight(p), w = n?.cur >= 0 ? n.pl.watches[n.cur] : null;
    if (!w || p.status !== "encounter") return;
    const c = this.#ask("watch", night); if (c?.done) return;
    const actor = this.#company(p, w).checker;
    return this.write({ asks: { ...this.watch.asks, watch: { ...c, actor, skill: "prc", campId: this.watch.campId, night, enc: p.encounter.id, done: true, success, override: { success, reason, automatic: !c?.asked, by: game.user.id, at: this.now } } } });
  }

  /** The GM asks those on a task for their checks (the camp scene, at the task's step): each rolls there. */
  async #taskAsk(key, night) {
    await this.#ensureCamp(night);
    const T = TASKS[key], all = this.#checks(night), c = all[key] ?? {}, who = this.members().filter((m) => this.taskOf(m.id) === key);
    const dc = c.dc ?? this.defaultTaskDc(key), best = [...who].sort((a, b) => Math.max(...T.skills.map((s) => skillMod(b.actor, s))) - Math.max(...T.skills.map((s) => skillMod(a.actor, s))))[0];
    const leader = T.help ? (who.some((m) => m.id === c.leader) ? c.leader : best?.id) : null;
    const requests = Object.fromEntries(who.map((m) => [m.id, foundry.utils.randomID()]));
    await this.write({ checks: { ...all, night, [key]: { ...c, campId: this.watch.campId, workers: who.map((m) => m.id), requests, dc, leader, asked: Date.now(), rolls: {}, rerolls: {}, done: false, result: null } } });
    // Rolled in the camp scene (its buttons), and each player is whispered a roll button too, which
    // reaches them whatever scene they are on. (A practice night asks no one in the chat.)
    if (this.practice) return;
    for (const m of who) {
      const player = playerOf(m.actor);
      if (!player) continue;
      const text = `<b>${esc(m.name)}</b>: ${esc(T.label.toLowerCase())}. Make a ${T.skills.map((s) => SKILLS[s].label).join(" or ")} check${T.help ? (m.id === leader ? " (you lead)" : " (you help)") : ""}.`;
      const buttons = T.skills.map((skill) => campRollButton(campRequest(this.st, this.hud.scene.id, key, m.id, skill), `${SKILLS[skill].short}${showDC() ? ` · DC ${dc}` : ""} ${skillBonus(m.actor, skill)}`)).join(" <span class=\"cs-skill-or\">-or-</span> ");
      ChatMessage.create({ content: `<p><i class="fa-solid fa-campground"></i> ${text}</p><p>${buttons}</p>`, speaker: { alias: this.st.name || "Journey" }, whisper: [...game.users.filter((u) => u.isGM).map((u) => u.id), player.id] });
    }
  }

  /** Roll a task's check for a member: the system's own, with the DC on it when players may see it. */
  async #taskRoll(key, id, skill) {
    const night = this.prog()?.night, c = this.#checks(night)[key], actor = game.actors.get(id);
    // The GM may roll for anyone (a player who cannot).
    if (!c?.asked || c.done || c.rolls?.[id]?.total != null || !actor || !(this.rollsFor(actor) || game.user.isGM) || !TASKS[key].skills.includes(skill)) return;
    // A practice night: rolled here, no chat card.
    if (this.practice) {
      const total = await this.#practiceRoll(actor, skill), all = this.#checks(night);
      return this.write({ checks: { ...all, [key]: { ...c, rolls: { ...(c.rolls ?? {}), [id]: { total, skill } } } } });
    }
    const s = SKILLS[skill], dc = showDC() ? c.dc : undefined, flavor = `${s.label} check: ${TASKS[key].label.toLowerCase()}`;
    try {
      await rollCampRequest(campRequest(this.st, this.hud.scene.id, key, id, skill), { showDC: showDC(), flavor });
    } catch (err) { console.warn("kg-realms | the check did not roll:", err); }
  }

  /** The GM confirms a task: Leader with Help's sum, or concealment's successes; foraging hands out its rations. */
  async #taskConfirm(key) {
    const night = this.prog()?.night, all = this.#checks(night), c = all[key];
    if (!c?.asked || c.done) return;
    // Each roll as its chat card stands now (after any spend).
    const rolls = Object.fromEntries(Object.entries(c.rolls ?? {}).map(([id, r]) => [id, { ...r, total: game.messages.get(r.msg)?.rolls?.[0]?.total ?? r.total }]));
    let result, given = 0;
    if (TASKS[key].stack) result = { successes: concealed(rolls, c.dc) };
    else {
      const lw = leaderWithHelp(rolls, c.leader, c.dc);
      if (!lw) return;
      result = { total: lw.total, success: lw.success };
      // (A practice night gives no rations.)
      if (key === "forage" && lw.success && !this.practice) given = await this.#giveRations(this.members().map((x) => x.actor));
    }
    await this.write({ checks: { ...all, [key]: { ...c, rolls, done: true, result, given } } });
  }

  /* ------------------------------------------------------------------ checks */

  /** A check asked of a player (key "forage" or "watch") tonight, or null. */
  #ask(key, night) {
    const a = this.watch.asks?.[key];
    return this.watch.campId && a && a.night === night && a.campId === this.watch.campId ? a : null;
  }

  /**
   * A check as it stands: asked (the roller's prompt; the GM waits), rolled (the GM confirms or
   * allows a reroll; the roller waits), confirmed. who: the member making it.
   */
  #check(key, a, who) {
    const gm = game.user.isGM, actor = who?.actor ?? game.actors.get(a.actor), first = esc((who?.name ?? actor?.name ?? "They").split(" ")[0]);
    const label = SKILLS[a.skill]?.label ?? "Ability", dcText = gm || showDC() ? ` · DC ${a.dc}` : "";
    const spend = tenacity() ? "Failed the check? Spend Tenacity from the roll's chat card. " : "";
    if (a.done) {
      if (a.override) return `<div class="camp-result ${a.success ? "ok" : "no"}"><span><strong>${a.override.automatic ? "Automatic " : ""}${a.success ? "Success" : "Failure"}.</strong><span class="camp-ruling-reason"><strong>Reason:</strong> ${esc(a.override.reason)}</span></span></div>`;
      const seen = gm || showDC() ? ` against DC ${a.dc}` : "";
      return `<div class="camp-result ${a.success ? "ok" : "no"}"><span class="grow"><b>${first} rolled ${a.total}</b>${seen}: ${a.success ? "success" : "failure"}.</span></div>`;
    }
    if (a.total == null) {
      if (this.rollsFor(actor)) {
        const lead = key === "watch" ? `<b class="camp-ask-lead">Something stirs beyond the firelight.</b>` : `<b class="camp-ask-lead">The land may feed you tonight.</b>`;
        return `<div class="camp-ask">${lead}<span>${gm ? `${first} has no player here: roll it for them.` : `Make a ${label} check.`}</span>
          <button data-camp="roll" data-key="${key}" class="primary"><i class="fa-solid fa-dice-d20"></i> Roll ${esc(label.replace(/^Wisdom \((.*)\)$/, "$1"))}${dcText}${a.disadvantage ? " · disadvantage" : ""} ${skillBonus(actor, a.skill)}</button>
          <small>${spend}The GM confirms the result, or allows a reroll.</small></div>`;
      }
      return gm ? `<div class="camp-wait"><i class="fa-solid fa-hourglass-half"></i><span class="grow">Waiting for ${first}'s ${label} check (DC ${a.dc}).</span><button data-camp="ask" data-key="${key}" title="Ask again">Ask again</button><button data-camp="roll" data-key="${key}" title="Roll it for them (their player cannot)">Roll for them</button></div>` : "";
    }
    // Rolled: the total follows the chat card (a Tenacity spend raises it) until the GM confirms.
    if (gm) {
      const ok = a.total >= a.dc;
      return `<div class="camp-result ${ok ? "ok" : "no"}"><span class="grow"><b>${first} rolled ${a.total}</b> against DC ${a.dc}: ${ok ? "success" : "failure"}.${a.n > 1 ? ` <small>Roll ${a.n}.</small>` : ""}</span></div>
        <div class="row"><button data-camp="confirm" data-key="${key}" class="primary grow"><i class="fa-solid fa-check"></i> Confirm result</button><button data-camp="reroll" data-key="${key}" class="grow"><i class="fa-solid fa-rotate-right"></i> Allow reroll</button></div>`;
    }
    return this.rollsFor(actor) ? `<div class="camp-wait"><i class="fa-solid fa-hourglass-half"></i><span class="grow">You rolled ${a.total}${showDC() ? ` against DC ${a.dc}` : ""}. ${spend}Waiting for the GM to confirm.</span></div>` : "";
  }

  /** The GM asks a member for a check: the panel prompts whoever rolls for them, and a whisper carries a roll button too. */
  async #askFor(key, { actor, skill, dc, night, enc = null }) {
    await this.#ensureCamp(night);
    const prev = this.#ask(key, night), a = { night, campId: this.watch.campId, requestId: foundry.utils.randomID(), actor, skill, dc, enc, n: (prev?.n ?? 0) + 1, asked: Date.now(), msg: null, total: null, done: false, success: null, disadvantage: key === "watch" && !!this.fatigue(actor) };
    await this.write({ asks: { ...(this.watch.asks ?? {}), [key]: a } });
    const doc = game.actors.get(actor), player = playerOf(doc), s = SKILLS[skill];
    // A practice night asks no one in the chat.
    if (!doc || !s || this.practice) return;
    const roll = campRollButton(campRequest(this.st, this.hud.scene.id, key, actor, skill), `Roll ${s.short}${showDC() ? ` · DC ${dc}` : ""}${a.disadvantage ? " · disadvantage" : ""} ${skillBonus(doc, skill)}`);
    const text = key === "watch" ? `<b>${esc(doc.name)}</b>, on watch: something stirs beyond the firelight. Make a ${s.label} check${a.disadvantage ? " with disadvantage (tired from setup work)" : ""}.` : `<b>${esc(doc.name)}</b>: make a ${s.label} check to forage and hunt.`;
    ChatMessage.create({ content: `<p><i class="fa-solid fa-campground"></i> ${text}</p><p>${roll}</p>`, speaker: { alias: this.st.name || "Journey" }, whisper: [...game.users.filter((u) => u.isGM).map((u) => u.id), ...(player ? [player.id] : [])] });
  }

  /** Roll an asked check: the system's own check, with the DC on it when players may see it (Tenacity spends against it). */
  async #roll(key) {
    const a = this.#ask(key, this.prog()?.night), actor = game.actors.get(a?.actor);
    if (!a || a.done || a.total != null || !actor || !(this.rollsFor(actor) || game.user.isGM)) return;
    if (this.practice) { const total = await this.#practiceRoll(actor, a.skill, a.disadvantage); return this.write({ asks: { ...(this.watch.asks ?? {}), [key]: { ...a, total } } }); }
    const s = SKILLS[a.skill], dc = showDC() ? a.dc : undefined, flavor = key === "watch" ? `${s.label} check, on watch` : `${s.label} check, foraging and hunting`;
    try {
      await rollCampRequest(campRequest(this.st, this.hud.scene.id, key, a.actor, a.skill), { showDC: showDC(), flavor });
    } catch (err) { console.warn("kg-realms | the check did not roll:", err); }
  }

  /**
   * Only a roll tagged for the current camp and exact request counts. Later changes to that same
   * card (a Tenacity spend) count until confirmed. No actor/skill/timestamp matching across camps.
   */
  onRoll(msg) {
    this.rollQueue = (this.rollQueue ?? Promise.resolve()).then(() => this.#onRoll(msg)).catch((err) => console.warn("kg-realms | camp roll:", err));
    return this.rollQueue;
  }
  async #onRoll(msg) {
    if (!isPrimaryGM() || !msg?.rolls?.length) return;
    const tag = msg.flags?.[MODULE_ID]?.campRoll, actorId = msg.speaker?.actor;
    if (!tag || tag.actor !== actorId || !Number.isFinite(msg.rolls[0].total)) return;
    const scene = partyScene(game.scenes.get(tag.scene),tag.partyId);
    if (!scene || (scene.partyId&&focusedScene(scene.realScene)!==scene)) return;
    await writeJourney(scene, (j) => {
      if (!matchingCampRequest(j, tag)) return null;
      const total = msg.rolls[0].total;
      if (tag.key === "watch") {
        const a = j.watch.asks.watch;
        if ((a.msg && a.msg !== msg.id) || (a.msg === msg.id && a.total === total)) return null;
        return { "watch.asks.watch": { ...a, msg: msg.id, total } };
      }
      const c = j.watch.checks[tag.key], had = c.rolls?.[actorId];
      if ((had && had.msg !== msg.id) || had?.total === total) return null;
      return { [`watch.checks.${tag.key}.rolls.${actorId}`]: { total, msg: msg.id, skill: tag.skill, campId: tag.campId, requestId: tag.requestId } };
    }, { campId: tag.campId });
  }

  /** The GM confirms the watcher's check: read from its chat card as it stands now (after any spend). */
  async #confirm(key) {
    const night = this.prog()?.night, a = this.#ask(key, night);
    if (!a || a.total == null || a.done) return;
    const total = game.messages.get(a.msg)?.rolls?.[0]?.total ?? a.total, success = total >= a.dc;
    return this.write({ asks: { ...(this.watch.asks ?? {}), [key]: { ...a, total, done: true, success } } });
  }

  /** The night (GM): the camp's encounters by watch, and where the watches happen. */
  #nightSetup(p, pl, members, step = 2) {
    const w = this.watch, encs = ((this.practice ? this.st.encounters : this.hud.plan?.encounters) ?? []).filter((e) => e.rest && e.rest.night === p.night);
    const name = (id) => members.find((m) => m.id === id)?.name ?? "?";
    const opts = (cur) => [...pl.watches.map((x, i) => `<option value="${i}" ${String(cur) === String(i) ? "selected" : ""}>Watch ${i + 1}, ${esc(name(x.id))}</option>`), `<option value="random" ${cur === "random" ? "selected" : ""}>At random</option>`].join("");
    const encRows = encs.map((e) => `<div class="camp-enc"><i class="fa-solid fa-triangle-exclamation"></i><b class="grow">${esc(e.name)}</b>${pl.watches.length ? `<label>Begins in <select data-camp="enc-watch" data-id="${esc(e.id)}">${opts(w.encWatch?.[e.id] ?? this.#watchOf(e.rest.at, pl))}</select></label>` : `<small>at random</small>`}${e.generic ? `<button data-camp="enc-drop" data-id="${esc(e.id)}" title="Not tonight after all"><i class="fa-solid fa-xmark"></i></button>` : ""}</div>`).join("");
    // Random encounter tonight? Yes: the random encounter table (Advanced watches settings) is rolled
    // now, in secret, and its result joins the camp's encounters, coming at random with the watch dice.
    let table = "";
    try { table = game.settings.get(MODULE_ID, "campEncounterTable") || ""; } catch { /* not registered */ }
    const ask = `<div class="camp-randq"><span class="grow">Random encounter tonight?</span><button data-camp="random-enc" class="primary"><i class="fa-solid fa-dice"></i> Yes</button></div>
      <small class="hint">${table ? "Rolls the random encounter table (in secret) and adds it here." : "Adds an encounter, Something in the night: set a random encounter table in the Advanced watches settings to roll one."} ${this.practice ? "Each Yes adds another; pick the watch each begins in." : "Or drag one of the journey's encounters onto this camp in Add encounters."}</small>`;
    const { conceal } = this.campEffects(p.night), n = pl.watches.length;
    const dice = n ? pl.watches.map((x, i) => `1d${n - i + 1 + conceal}`).join(", ") : `1d${1 + conceal}, once`;
    const random = encs.some((e) => (w.encWatch?.[e.id] ?? (e.generic ? "random" : null)) === "random" || !n) ? `<p class="hint">At random ${rule(this.hud.ruleText().campRolls)}: ${n ? "as each watch begins, roll a die one larger than the watches left" : "no one keeps watch, so the night rolls once"}${conceal ? `, ${conceal} more for the concealment` : ""} (${dice}). A 1 brings the encounter; if none comes up, the night is quiet.</p>` : "";
    const scene = (sid) => (sid ? game.scenes.get(sid)?.name ?? "Missing scene" : null);
    const all = scene(w.scenes?.all);
    const per = pl.watches.map((x, i) => { const s = scene(w.scenes?.[i]); return `<span class="camp-scene-w ${s ? "set" : ""}" data-camp-drop="scene" data-key="${i}" title="Drop a scene for watch ${i + 1}">${i + 1} · ${esc(s ?? "same")}${s ? `<button data-camp="scene-clear" data-key="${i}" aria-label="Clear"><i class="fa-solid fa-xmark"></i></button>` : ""}</span>`; }).join("");
    return `<section class="camp-step"><h4><span class="step">${step}</span> The night <span class="sp"></span><small>Only you</small></h4>
      ${encRows}${ask}${random}
      <span class="cap">Where the watches happen</span>
      <div class="camp-scene ${all ? "set" : ""}" data-camp-drop="scene" data-key="all">${all ? `<i class="fa-solid fa-map"></i> <span class="grow">${esc(all)}</span><small>every watch</small><button data-camp="scene-clear" data-key="all" aria-label="Clear"><i class="fa-solid fa-xmark"></i></button>` : `<i class="fa-solid fa-map"></i> <span class="grow">Drop a scene for the camp</span>`}</div>
      ${pl.watches.length > 1 ? `<div class="camp-scenes">${per}</div>` : ""}
      <p class="hint">A watch can have its own scene, encounter or not.</p></section>`;
  }

  /** Which watch an hour into the rest falls in (index), else 0. */
  #watchOf(at, pl) {
    const into = (at ?? 0) - (pl.setup ?? pl.rest - pl.window);
    const i = pl.watches.findIndex((x) => into >= x.from && into < x.to);
    return i < 0 ? 0 : i;
  }

  /**
   * Tonight's watches against the clock, while the party rests (or meets an encounter in camp):
   * { pl, start (world time the first watch begins, after any time the encounters so far took),
   * into (hours from then), cur (the watch now, or -1) }, else null. In an encounter the watch is
   * the encounter's own.
   */
  #tonight(p) {
    if (!p || !(p.status === "resting" || (p.status === "encounter" && p.camp))) return null;
    const pl = this.plan(), lead = (pl.setup ?? pl.rest - pl.window) * 3600;
    let restStart, held, t;
    if (p.status === "resting") {
      // since: when camp was made; until: its end, pushed back by the encounters met so far.
      restStart = p.since; held = Math.max(0, (p.until ?? 0) - p.since - pl.rest * 3600); t = this.now;
    } else {
      const e = (this.st.encounters ?? []).find((x) => x.id === p.encounter?.id) ?? p.encounter;
      restStart = p.campStart; held = Math.max(0, p.since - (restStart ?? 0) - (e?.rest?.at ?? 0) * 3600); t = p.since;
    }
    if (restStart == null) return null;
    const start = restStart + held + lead, into = (t - start) / 3600;
    const cur = into >= 0 ? pl.watches.findIndex((x) => into >= x.from - 1e-6 && into < x.to - 1e-6) : -1;
    return { pl, start, into, cur };
  }

  /** Through the night: the watch now, the encounter rolls, the watcher's check, (GM) what is ahead and the watch's scene. */
  #night(p) {
    const gm = game.user.isGM, members = this.members(), n = this.#tonight(p);
    if (!n) return "";
    const { pl, start, into, cur } = n, nowAt = Math.max(0, Math.min(1, into / pl.window));
    const w = cur >= 0 ? pl.watches[cur] : null, m = w && members.find((x) => x.id === this.#awake(w, into)[0]);
    const watchLine = pl.version === 2 ? `<p class="now-line"><b>${esc(this.phaseStatus(p).label)}</b>. ${esc(this.phaseStatus(p).detail)}</p>` : into < 0 ? `<p class="now-line">The camp is awake: the watches begin at ${this.#clock(start)}.</p>`
      : w ? `<div class="camp-cur"><img src="${esc(m?.img)}" alt=""><span class="grow"><small class="camp-cur-n">Watch ${cur + 1} of ${pl.watches.length}${m?.actor?.isOwner && !gm ? " · you" : ""}</small><b>${esc(m?.name)}</b><small>${this.#clock(start + w.from * 3600)} to ${this.#clock(start + w.to * 3600)} · passive Perception ${m?.pp}</small></span></div>`
      : `<p class="now-line">No one is on watch now.</p>`;
    const sid = w ? this.watch.scenes?.[cur] ?? this.watch.scenes?.all : this.watch.scenes?.all;
    const sc = sid ? game.scenes.get(sid) : null;
    const go = gm && sc ? `<div class="now-main"><button data-camp="scene-go" data-id="${sc.id}" class="primary"><i class="fa-solid fa-users"></i> Go to ${esc(sc.name)}</button><button data-camp="scene-view" data-id="${sc.id}" title="View it (only you)"><i class="fa-solid fa-eye"></i></button></div>` : "";
    // What is still ahead tonight (GM): an encounter at random shows its hour only once its watch has rolled it.
    const resumed = this.st.trip?.resumed ?? {};
    const ahead = gm && p.status === "resting" ? (this.st.encounters ?? []).filter((e) => e.rest && e.rest.night === p.night && !e.rest.quiet && !resumed[e.id]) : [];
    const encs = ahead.map((e) => {
      const hidden = e.rest.rolls?.length && !(e.rest.watch != null && e.rest.watch <= cur);
      return `<div class="camp-enc"><i class="fa-solid fa-triangle-exclamation"></i><span class="grow"><b>${esc(e.name)}</b> ${hidden ? "if a watch rolls a 1" : `at ${this.#clock(start + ((e.rest.at ?? 0) * 3600 - (pl.setup ?? pl.rest - pl.window) * 3600))}`}</span><small>only you</small></div>`;
    }).join("");
    // While the camp scene runs it holds the checks and the encounter; the panel keeps a summary.
    const run = this.sceneNow(p);
    const check = !run && p.status === "encounter" ? this.#watchCheck(p, w, m) : "";
    const ch = this.#checks(p.night), done = ["forage", "conceal", "alarm"].filter((k) => ch[k]?.done);
    const tasks = done.length ? `<div class="camp-rolls"><div class="camp-rolls-head"><b>Completed camp tasks</b></div><div class="camp-task-sum">${done.map((k) => `<span class="camp-task-status ${(k === "conceal" ? ch[k].result?.successes > 0 : ch[k].result?.success) ? "ok" : "no"}"><i class="fa-solid ${TASKS[k].icon}"></i> ${esc(pastTaskSummary(k, ch[k].result))}</span>`).join("<br>")}</div></div>` : "";
    const scene = run ? `<div class="row camp-hold"><span class="grow"><i class="fa-solid fa-campground"></i> The camp scene is ${run.hold && p.status === "encounter" ? "holding for this encounter" : "running the night"}: ${esc(this.#stepLabel(run.step))}. Watches, rolls and encounters happen there.</span>${this.sceneMin ? `<button data-camp="scene-show">Show the camp scene</button>` : ""}</div>` : "";
    return `<div class="camp camp-night">${this.#strip(p, n)}${this.#bar(pl, members, into >= 0 ? nowAt : null, start, cur)}${watchLine}${scene}${run ? "" : tasks + this.#rollLog(p, n, members)}${encs}${check}${go}</div>`;
  }

  /**
   * Where the night is, as steps (0.65.3): Setup, each watch, Packing; those behind done, the
   * current one lit. n: as #tonight() gives.
   */
  #strip(p, n) {
    const { pl, into, cur } = n, s = pl.version === 2 ? this.schedule(p) : null, last = pl.watches.length + 1;
    const at = this.watch.scene?.step === "recovery" || (s && this.now >= s.restEnd) || into >= pl.window ? last
      : (s && this.now < s.setupEnd) || into < 0 ? 0 : cur >= 0 ? cur + 1 : 0;
    const steps = ["Setup", ...pl.watches.map((_, i) => `Watch ${i + 1}`), "Packing"];
    return `<ol class="kgr-camp-strip" aria-label="Camp steps">${steps.map((l, i) => `<li class="${i < at ? "done" : i === at ? "on" : ""}" ${i === at ? 'aria-current="step"' : ""}>${i < at ? '<i class="fa-solid fa-check" aria-hidden="true"></i>' : ""}${esc(l)}</li>`).join("")}</ol>`;
  }

  /** Tonight's encounter rolls, a watch at a time as each begins, and the watcher's check once confirmed. Players see them unless the GM hides them. */
  #rollLog(p, n, members) {
    const gm = game.user.isGM, hide = !!this.#setting("hideEncounterRolls");
    const encs = (this.st.encounters ?? []).filter((e) => e.rest?.night === p.night && e.rest.rolls?.length);
    const a = this.#ask("watch", p.night);
    if (!encs.length && !a?.done) return "";
    if (!gm && hide) return "";
    const name = (i) => esc(members.find((m) => m.id === n.pl.watches[i]?.id)?.name.split(" ")[0] ?? "?");
    // Each roll, as its watch has begun (w: its watch; -1, the night with no one on watch).
    const rows = encs.flatMap((e) => e.rest.rolls.map((r, k) => {
      const wi = r.w ?? k, none = wi < 0;
      if (none ? n.into < 0 : wi > n.cur && !this.sceneNow(p)) return "";
      return `<span class="${r.roll === 1 ? "hit" : ""}">${none ? "The night" : `Watch ${wi + 1}`}</span><span class="${r.roll === 1 ? "hit" : ""}">${none ? "no one on watch" : name(wi)}: ${r.roll === 1 ? `<b>${gm ? esc(e.name) : "encounter"}</b>` : "quiet"}</span><span class="${r.roll === 1 ? "hit" : ""}">1d${r.die}: ${r.roll}</span>`;
    })).join("");
    const seen = gm || showDC();
    const result = a?.done ? `<span></span><span>${name(n.cur)}'s Wisdom (Perception) check: <b>${a.total}</b>${seen ? ` against DC ${a.dc}` : ""}, <span class="${a.success ? "ok" : "hit"}">${a.success ? "success" : "failure"}</span></span><span></span>` : "";
    const box = gm ? `<label class="camp-hide"><input type="checkbox" data-camp="hide-rolls" ${hide ? "checked" : ""}> Hide Encounter Rolls and Results <span class="grow"></span><small>${hide ? "Only you see them" : "Players see them"}</small></label>` : "";
    return `<div class="camp-rolls"><div class="camp-rolls-head"><b>Encounter rolls</b> ${rule(this.hud.ruleText().campRolls)}<span class="grow"></span><small>A 1 brings it</small></div>${box}<div class="camp-rolls-grid">${rows}${result}</div></div>`;
  }

  /** Those on a watch awake at an hour into the night (a shared watch: some may have stopped), else its first. */
  #awake(w, hour) { const ids = hour == null ? [] : awakeAt(w, hour); return ids.length ? ids : [w.id]; }

  /**
   * Who is with the watcher for an encounter (GM): the others on the watch the GM has ticked, at first
   * those awake at its hour. A shared watch where some had stopped by then: the GM says whether
   * they are up for it. { hour, checker, rest: [others on the watch], with: [those ticked] }.
   */
  #company(p, w) {
    const hour = this.#tonight(p)?.into, awake = this.#awake(w, hour), checker = awake[0];
    const rest = [w.id, ...(w.with ?? [])].filter((id) => id !== checker);
    const d = this.wakeDraft?.enc === p.encounter?.id ? this.wakeDraft.ids : null;
    return { hour, checker, rest, with: d ?? awake.filter((id) => id !== checker) };
  }

  /**
   * The watcher's DC from the encounter's: less 5 when the alarms are set and 5 for each other one
   * with them on the watch. { dc, parts: ["− 5 (alarms)", ...] }.
   */
  #watchDc(base, night, others) {
    const { alarm } = this.campEffects(night), parts = [];
    if (alarm) parts.push(`− ${ALARM_DC} (alarms)`);
    if (others) parts.push(`− ${SHIFT_BONUS * others} (${others} more on watch)`);
    return { dc: Math.max(1, base - (alarm ? ALARM_DC : 0) - SHIFT_BONUS * others), parts };
  }

  /** An encounter in camp: the GM asks the one on watch for a Wisdom (Perception) check against a DC; the watcher rolls it. */
  #watchCheck(p, w, m) {
    const gm = game.user.isGM, a = this.#ask("watch", p.night), mine = a && a.enc === p.encounter?.id ? a : null;
    // No one on watch: no check. The camp is surprised, unless the alarms are set.
    if (!w || !m) {
      const { alarm } = this.campEffects(p.night);
      return `<div class="camp-check"><b class="camp-ask-lead">${alarm ? "The alarms wake the camp." : "No one was on watch."}</b><span>${alarm ? "No one is surprised." : "The camp is taken by surprise."} ${rule(this.hud.ruleText().tasks)}</span></div>`;
    }
    if (!mine) {
      if (!gm) return "";
      const c = this.#company(p, w), members = this.members(), short = (id) => esc(members.find((x) => x.id === id)?.name.split(" ")[0] ?? "?");
      const e = (this.st.encounters ?? []).find((x) => x.id === p.encounter?.id) ?? p.encounter, base = this.dcDraft ?? e?.dc ?? 15, adj = this.#watchDc(base, p.night, c.with.length);
      const first = esc(m.name.split(" ")[0]), more = c.with.length ? ` (with ${c.with.map(short).join(" and ")})` : "";
      const R = this.hud.ruleText(), n = this.#tonight(p);
      // The others on a shared watch: is each up for this? (Ticked: awake at its hour; one whose hours had ended is the GM's call.)
      const company = c.rest.length ? `<div class="camp-company"><small>Who is awake with ${first}? Each one: DC ${SHIFT_BONUS} lower.</small>${c.rest.map((id) => {
        const end = w.ends?.[id], stopped = n && end != null && c.hour != null && c.hour >= end - 1e-6;
        return `<label><input type="checkbox" data-camp="watch-with" data-id="${id}" ${c.with.includes(id) ? "checked" : ""}> ${short(id)}${stopped ? ` <small class="warn">stopped at ${this.#clock(n.start + end * 3600)}: still up for this?</small>` : ""}</label>`;
      }).join("")}</div>` : "";
      return `<div class="camp-check">${this.sceneNow(p) ? "" : this.#fatigueNote([c.checker])}<div class="camp-dcrow"><label>Perception DC <input type="number" data-camp="watch-dc" min="1" max="40" value="${base}"></label><small>${e?.dc != null ? "from its card" : "set it here"}</small>${rule(`${R.watch} ${R.shift}${this.advanced ? ` ${R.alarm}` : ""}`)}</div>
        ${company}${adj.parts.length ? `<small class="camp-task-sum">DC ${base} ${adj.parts.join(" ")} = <b>${adj.dc}</b></small>` : ""}
        <button data-camp="ask" data-key="watch" class="primary"><i class="fa-solid fa-dice-d20"></i> Ask ${first}${more} for a Wisdom (Perception) check</button>${this.#overrideUI("watch", "check", true)}</div>`;
    }
    // Once confirmed, the result stands with the night's rolls.
    if (mine.done) return "";
    const body = this.#check("watch", mine, m);
    return body ? `<div class="camp-check">${body}${this.#overrideUI("watch", "check")}</div>` : "";
  }

  /**
   * After each redraw: when the watch has changed since the last one this client saw, the new
   * watcher's portrait comes up for everyone. Nothing on the first draw (a reload mid-watch).
   */
  watchChanged(p) {
    const n = this.#tonight(p), key = n && n.cur >= 0 ? `${p.night}|${n.cur}` : null, was = this.shownWatch;
    this.shownWatch = key;
    // While the camp scene runs, it shows each watch itself.
    if (was === undefined || !key || key === was || this.sceneNow(p)) return;
    const d = this.bannerData(n);
    if (d) showBanner(d);
  }

  /**
   * What the watch change banner shows, as plain data (it may go to the players over the socket):
   * the watcher, who takes the watch and when, and the night's watches. n: as #tonight() gives,
   * { pl, start, into, cur }.
   */
  bannerData(n) {
    const members = this.members(), w = n.pl.watches[n.cur], m = w && members.find((x) => x.id === w.id), total = n.pl.watches.length;
    if (!m) return null;
    const first = (id) => members.find((x) => x.id === id)?.name.split(" ")[0] ?? "?";
    const also = (w.with ?? []).map((id) => members.find((x) => x.id === id)?.name).filter(Boolean);
    return {
      img: m.img ?? "", name: also.length ? `${m.name} and ${also.join(" and ")}` : m.name, n: n.cur + 1, total, colour: COLOURS[n.cur % COLOURS.length],
      when: `${this.#clock(n.start + w.from * 3600)} to ${this.#clock(n.start + w.to * 3600)}`,
      line: total === 1 ? "The camp settles in for the night." : n.cur === 0 ? "The camp settles. The others sleep." : n.cur === total - 1 ? `The final watch begins. Rest ends at ${this.#clock(n.start + n.pl.window * 3600)}.` : "The fire burns low. The others sleep.",
      ticks: [0, 0.25, 0.5, 0.75, 1].map((f) => this.#clock(n.start + f * n.pl.window * 3600)),
      parts: n.pl.watches.map((x, i) => ({ name: [x.id, ...(x.with ?? [])].map(first).join(" & "), hours: x.to - x.from, colour: COLOURS[i % COLOURS.length] })),
      gap: Math.max(0, n.pl.window - n.pl.covered), cur: n.cur, nowAt: Math.max(0, Math.min(1, n.into / n.pl.window))
    };
  }

  /** The night's watches as a bar (for the practice night): see #bar. */
  barHtml(pl, nowAt = null, start = null, cur = -1) { return this.#bar(pl, this.members(), nowAt, start, cur); }
  /** A world time as HH:MM. */
  clockText(t) { return this.#clock(t); }

  /** At sea, with watches at sea on: the watch order through the voyage's nights. */
  #atSea() {
    const members = this.members(), pl = this.plan();
    return `<div class="camp"><section class="camp-step"><h4>Night watch at sea</h4>${this.#bar(pl, members)}<p class="hint">The same watch order as in camp.</p></section></div>`;
  }

  /* ------------------------------------------------------------------ actions */

  async click(btn) {
    if (!SHARED_ACTIONS.has(btn.dataset.camp)) return this.#click(btn);
    if (!game.user.isGM || (!this.practice && !isPrimaryGM())) return;
    const practice = this.practice, scene = this.hud.scene, trip = journeyKey(this.st), campId = this.watch.campId, epoch = this.hud.lifecycleEpoch;
    const key = practice ? this : `${scene?.id}|${trip}`;
    if (commands.has(key)) return;
    const valid = () => practice ? this.practice === practice : this.hud.scene === scene && this.hud.lifecycleEpoch === epoch && isPrimaryGM() && journeyKey(this.st) === trip && (!campId || this.watch.campId === campId);
    commands.add(key); this.commandContext = { scene, trip, campId, valid };
    btn.disabled = true;
    try { if (valid()) return await this.#click(btn); }
    finally {
      commands.delete(key); this.commandContext = null; if (btn.isConnected) btn.disabled = false;
      if (!practice && btn.dataset.camp === "scene-next") this.hud.onCampWorkEnded?.(scene);
    }
  }

  async #click(btn) {
    const act = btn.dataset.camp, w = this.watch, members = this.members();
    const ids = members.map((m) => m.id), i = Number(btn.dataset.i);
    if (act === "view") { this.setupView = btn.dataset.view; return this.hud.render(); }
    if (act === "up" || act === "down") {
      // Within the watchers (Advanced watches: those who picked Watch), in the party's whole order.
      if (!this.canEdit()) return;
      const list = this.watchers(), j = act === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= list.length) return;
      const a = ids.indexOf(list[i].id), b = ids.indexOf(list[j].id);
      [ids[a], ids[b]] = [ids[b], ids[a]];
      return this.write({ order: ids });
    }
    if (act === "release") return this.hold(false);
    // The camp scene, minimised or shown again (this client only).
    if (act === "scene-min" || act === "scene-show") { this.sceneMin = act === "scene-min"; return this.renderScene(this.prog()); }
    // A check asked of this user (or of a character no player is here for, the GM).
    if (act === "roll") return this.#roll(btn.dataset.key);
    if (act === "task-roll") return this.#taskRoll(btn.dataset.key, btn.dataset.id, btn.dataset.skill);
    if (!game.user.isGM || (!this.practice && !isPrimaryGM())) return;
    const night = this.prog()?.night, key = btn.dataset.key;
    if (act === "practice-end") return this.endPractice();
    if (act === "practice-begin") return this.beginPractice();
    // The camp scene (GM): on to the next step, hold for an encounter, carry on after it, break camp.
    if (act === "scene-next") return this.#sceneGo(btn.dataset.step);
    if (act === "watch-continue") {
      const p = this.prog(), i = this.#stepWatch(this.sceneNow(p)?.step), r = this.watch.reveals?.[i];
      if (!r?.done || r.seen || r.id !== btn.dataset.reveal || r.campId !== this.watch.campId) return;
      await this.write({ reveals: { ...this.watch.reveals, [i]: { ...r, seen: true } } });
      return this.#watchBegins(this.prog(), i);
    }
    if (act === "scene-break") return this.#breakCamp();
    if (act === "task-override" || act === "check-override") { if (btn.dataset.campId && btn.dataset.campId !== this.watch.campId) return; return this.#overrideResult(btn.dataset.key, act === "task-override" ? "task" : "check", btn.dataset.result === "success"); }
    if (act === "camp-recover" || act === "recovery-skip") return this.#recover(act === "recovery-skip");
    if (act === "scene-hold") { await this.write({ scene: { ...(w.scene ?? {}), hold: true } }); return this.hud.openHeldEncounter?.(this.prog()); }
    if (act === "scene-carry") {
      return this.#resolveCampEncounter();
    }
    // Make camp: a new camp starts clean. (Its results are kept by night number, and nights count
    // from 1 again when a route is redone: an old night 1's checks would otherwise carry over.)
    if (act === "setup") { this.overrideReasons = {}; const campId = foundry.utils.randomID(); this.setupView = this.advanced ? "tasks" : "watches"; return this.write({ setup: night, campId, phases: { ...campPhases(this.st.rest), campId }, biome:this.practice?null:this.hud.currentBiome?.()??null, checks: { night, campId }, asks: {}, reveals: {}, resolutions: [], recovery: null, scene: null }); }
    if (act === "unsetup") { this.setupView = null; return this.write({ setup: null }); }
    if (act === "takeover") return this.write({ lock: null });
    if (act === "random-enc") return this.#randomEncounter(night);
    if (act === "enc-drop") return this.save({ encounters: (this.st.encounters ?? []).filter((e) => e.id !== btn.dataset.id) });
    if (act === "task-ask") { if (this.sceneNow(this.prog())?.step !== key || this.#checks(night)[key]?.asked || this.#checks(night)[key]?.done) return; return this.#taskAsk(key, night); }
    if (act === "task-confirm") return this.#taskConfirm(key);
    if (act === "task-reroll") {
      const all = this.#checks(night), c = all[key];
      if (!c || c.done) return;
      const rolls = { ...(c.rolls ?? {}), [btn.dataset.id]: null };
      const requests = { ...c.requests, [btn.dataset.id]: foundry.utils.randomID() };
      await this.write({ checks: { ...all, [key]: { ...c, requests, rolls, rerolls: { ...(c.rerolls ?? {}), [btn.dataset.id]: Date.now() } } } });
      if (!this.practice) {
        const actor = game.actors.get(btn.dataset.id), player = playerOf(actor);
        if (!actor) return;
        const buttons = TASKS[key].skills.map((skill) => campRollButton(campRequest(this.st, this.hud.scene.id, key, actor.id, skill), `Roll ${SKILLS[skill].short} ${skillBonus(actor, skill)}`)).join(" <span class=\"cs-skill-or\">-or-</span> ");
        await ChatMessage.create({ content: `<p>${esc(actor.name)}: a new ${esc(TASKS[key].label)} roll was requested.</p>${buttons}`, whisper: [...game.users.filter((u) => u.isGM).map((u) => u.id), ...(player ? [player.id] : [])] });
      }
      return;
    }
    if (act === "ask" || act === "reroll") {
      // The watch: the one on watch when the encounter came, against the DC set for it, less the
      // alarms' 5 and 5 for each other on the shift (Advanced watches).
      const p = this.prog(), n = this.#tonight(p), at = n && n.cur >= 0 ? n.pl.watches[n.cur] : null;
      if (!at || p.status !== "encounter") return;
      // A reroll, or asking again before a roll came, keeps the DC asked.
      const was = this.#ask("watch", night), keep = was && was.enc === p.encounter?.id && !was.done && (act === "reroll" || this.dcDraft == null);
      // The first on the watch still awake makes the check; 5 off for each the GM has with them.
      const c = this.#company(p, at);
      const dc = keep ? was.dc : this.#watchDc(this.dcDraft ?? p.encounter?.dc ?? 15, night, c.with.length).dc;
      this.dcDraft = null;
      return this.#askFor("watch", { actor: c.checker, skill: "prc", dc, night, enc: p.encounter?.id ?? null });
    }
    if (act === "confirm") return this.#confirm(key);
    if (act === "scene-clear") { const scenes = { ...(w.scenes ?? {}) }; delete scenes[btn.dataset.key]; return this.write({ scenes }); }
    if (act === "scene-go") return game.scenes.get(btn.dataset.id)?.activate();
    if (act === "scene-view") return game.scenes.get(btn.dataset.id)?.view();
  }

  change(el) {
    const w = this.watch, act = el.dataset.camp;
    if (["encounter-resolution", "encounter-duration", "escape-distance"].includes(act)) {
      const draft = this.#resolutionDraft(this.prog());
      if (act === "encounter-resolution") { draft.kind = el.value; el.blur?.(); this.renderScene(this.prog()); }
      else if (act === "encounter-duration") draft.minutes = Math.max(0, Math.min(10080, Number(el.value) || 0));
      else draft.distance = Math.max(.1, Math.min(100, Number(el.value) || 5));
      return;
    }
    if (act === "override-reason") { if (this.overrideReasonCamp !== this.watch.campId) this.overrideReasons = {}; this.overrideReasonCamp = this.watch.campId; (this.overrideReasons ??= {})[`${el.dataset.kind}:${el.dataset.key}`] = el.value; return; }
    if (act === "hours" || act === "watch-duty") {
      if (!this.canEdit()) return;
      // Hours set by hand for each member (the others keep theirs as planned now).
      const pl = this.plan(), hours = Object.fromEntries(this.members().map((m) => { const x = pl.watches.find((y) => y.ends?.[m.id] != null); return [m.id, x ? x.ends[m.id] - x.from : 0]; }));
      const id = el.dataset.id, m = this.members().find((m) => m.id === id);
      hours[id] = act === "watch-duty" ? (el.checked ? SLEEP[m?.sleep]?.watch ?? 2 : 0) : Math.max(0, Number(el.value) || 0);
      if (act === "watch-duty" && el.checked && !planWatches(this.watchers(), hours, pl.window, w.join ?? {}).watches.some((x) => x.ends?.[id] != null)) ui.notifications.info("KG Realms: the rest window is already covered. Move this person earlier in the watch order, share the preceding watch, or reduce another watch's hours.");
      return this.write({ hours });
    }
    // Sharing the shift above (a change to the watch order, held like the rest of it).
    if (act === "join") { if (!this.canEdit()) return; return this.write({ join: { ...(w.join ?? {}), [el.dataset.id]: el.checked } }); }
    // A character's task: their player's (or the GM's) to pick.
    if (act === "task") {
      if (!this.taskOn(el.value)) return;
      const id = el.dataset.id, actor = game.actors.get(id);
      if (game.user.isGM) return this.write({ tasks: { ...(w.tasks ?? {}), [id]: el.value } });
      if (actor?.isOwner) return this.request({ taskSet: { id, task: el.value } });
      return;
    }
    if (!game.user.isGM || (!this.practice && !isPrimaryGM())) return;
    // The practice camp's hours (its clock follows: the first watch on the next hour).
    if (act === "practice-rest") {
      const P = this.practice;
      if (!P?.setup || P.view) return;
      P.state.rest = Math.max(16, Math.min(72, Number(el.value) || 16));
      P.state.watch.phases = { ...campPhases(P.state.rest), campId: P.state.watch.campId };
      this.#practiceClock();
      return this.#practiceChanged();
    }
    if (act === "gmlock") return this.write({ gmLock: el.checked, lock: el.checked ? null : w.lock ?? null });
    // Kept from one encounter to the next (a world setting).
    if (act === "hide-rolls") return game.settings.set(MODULE_ID, "hideEncounterRolls", el.checked);
    if (act === "watch-dc") { this.dcDraft = Math.max(1, Number(el.value) || 15); return; }
    // Who is awake with the watcher (a shared watch): the DC follows (this client, until asked).
    if (act === "watch-with") {
      const p = this.prog(), n = this.#tonight(p), w = n && n.cur >= 0 ? n.pl.watches[n.cur] : null;
      if (!w || p.status !== "encounter") return;
      const ids = new Set(this.#company(p, w).with);
      if (el.checked) ids.add(el.dataset.id); else ids.delete(el.dataset.id);
      this.wakeDraft = { enc: p.encounter?.id, ids: [...ids] };
      this.renderScene(p);
      if (!this.practice) this.hud.render();
      return;
    }
    const night = this.prog()?.night, all = this.#checks(night), key = el.dataset.key;
    if (act === "task-dc") return this.write({ checks: { ...all, night, [key]: { ...(all[key] ?? {}), dc: Math.max(0, Math.min(40, Number.isFinite(Number(el.value)) ? Number(el.value) : this.defaultTaskDc(key))) } } });
    if (act === "task-leader") return this.write({ checks: { ...all, night, [key]: { ...(all[key] ?? {}), leader: el.value } } });
    if (act === "enc-watch") return this.write({ encWatch: { ...(w.encWatch ?? {}), [el.dataset.id]: el.value === "random" ? "random" : Number(el.value) } });
  }

  /** Reordering by dragging a row onto another. */
  dragStart(e) {
    const row = e.target.closest?.(".camp-row[draggable]");
    if (!row || !this.canEdit()) return false;
    e.dataTransfer.setData("text/kgr-watch", row.dataset.id);
    e.dataTransfer.effectAllowed = "move";
    if (!game.user.isGM && !this.holder()?.isSelf) this.hold(true);
    return true;
  }
  dragOver(e) { if (e.target.closest?.(".camp-row") && [...(e.dataTransfer?.types ?? [])].includes("text/kgr-watch")) { e.preventDefault(); return true; } return false; }
  async drop(e) {
    const id = e.dataTransfer?.getData("text/kgr-watch");
    // A scene from the sidebar on the camp, or on one watch.
    const sceneBox = e.target.closest?.("[data-camp-drop=scene]");
    if (sceneBox && game.user.isGM) {
      e.preventDefault();
      let data = null; try { data = foundry.applications.ux.TextEditor.implementation.getDragEventData(e); } catch { /* not a document */ }
      const scene = data?.type === "Scene" ? await fromUuid(data.uuid) : null;
      if (!scene || data.uuid.startsWith("Compendium.")) return ui.notifications.warn("KG Realms: drop a scene from the Scenes sidebar.");
      return this.write({ scenes: { ...(this.watch.scenes ?? {}), [sceneBox.dataset.key]: scene.id } });
    }
    const onto = e.target.closest?.(".camp-row");
    if (!id || !onto || !this.canEdit()) return false;
    e.preventDefault();
    const ids = this.members().map((m) => m.id), from = ids.indexOf(id), to = ids.indexOf(onto.dataset.id);
    if (from < 0 || to < 0 || from === to) return true;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    await this.write({ order: ids });
    return true;
  }

  /**
   * Random encounter tonight (GM): the random encounter table (Advanced watches settings) rolled in
   * secret, no chat card; its result joins the journey's encounters in tonight's camp, coming at
   * random with the watch dice. Its name, picture and any actor it links to go with it. With no
   * table, Something in the night.
   */
  async #randomEncounter(night) {
    const s = this.st, at = this.practice ? [0, 0] : this.hud.whereNow?.(), pl = this.plan();
    if (!at) return ui.notifications.warn("KG Realms: the party's place is not known yet.");
    let name = "Something in the night", img = "", actors = [], notes = "";
    let uuid = "";
    try { uuid = game.settings.get(MODULE_ID, "campEncounterTable") || ""; } catch { /* not registered */ }
    if (uuid) {
      const table = await fromUuid(uuid).catch(() => null);
      if (!table?.roll) ui.notifications.warn("KG Realms: the random encounter table is missing. Set it again in the Advanced watches settings.");
      else {
        const draw = await table.roll();
        const r = draw?.results?.[0];
        if (r) {
          const text = String(r.name || r.text || r.description || "").replace(/<[^>]+>/g, "").trim();
          if (text) name = text;
          img = r.img && !/\/icons\/svg\/d20/.test(r.img) ? r.img : "";
          const doc = r.documentUuid ?? (r.documentCollection && r.documentId ? `${r.documentCollection.includes(".") ? `Compendium.${r.documentCollection}.Actor` : r.documentCollection}.${r.documentId}` : null);
          if (doc && /(^|\.)Actor\./.test(doc)) actors = [doc];
          notes = `Rolled on ${table.name}: ${draw.roll?.total ?? "?"}.`;
        }
      }
    }
    const id = foundry.utils.randomID();
    const enc = { id, name, dc: 15, radius: 2, lon: at[0], lat: at[1], img, actors, notes, generic: true, rest: { night, at: Math.round(pl.rest / 2) } };
    await this.save({ encounters: [...(s.encounters ?? []), enc], watch: { ...this.watch, encWatch: { ...(this.watch.encWatch ?? {}), [id]: "random" } } });
  }

  /** One ration (the module's ration item) for each character. Returns how many were given. */
  async #giveRations(actors) {
    const uuid = this.#setting("rationItem");
    if (!uuid) return 0;
    const src = await fromUuid(uuid).catch(() => null);
    if (!src) { ui.notifications.warn("KG Realms: the ration item is missing. Set it again in the module settings."); return 0; }
    let n = 0;
    for (const a of actors) {
      const have = a.items.find((i) => i._stats?.compendiumSource === uuid || i.getFlag?.("core", "sourceId") === uuid || (i.name === src.name && i.type === src.type));
      if (have) await have.update({ "system.quantity": (Number(have.system?.quantity) || 0) + 1 });
      else { const data = src.toObject(); data.system = { ...(data.system ?? {}), quantity: 1 }; data._stats = { ...(data._stats ?? {}), compendiumSource: uuid }; await a.createEmbeddedDocuments("Item", [data]); }
      n++;
    }
    return n;
  }

  /**
   * As the rest begins (GM): each camp encounter of the night gets its hour into the rest. Set to a
   * watch: the middle of it (or, that watch not there tonight, its fallback hour). At random: it
   * waits on the watch dice (pending), which the camp scene rolls as each watch begins, so the
   * camp's tasks (concealment) count.
   */
  async settleEncounters(night) {
    await this.#ensureCamp(night);
    const pl = this.plan(), w = this.watch, s = this.st, n = pl.watches.length;
    const lead = pl.setup ?? pl.rest - pl.window, list = [];
    for (const e of s.encounters ?? []) {
      if (!e.rest || (e.rest.night ?? 0) !== night) { list.push(e); continue; }
      const { rolls, quiet, pending, watch, ...previous } = e.rest, base = { ...previous, campId: w.campId }, pick = w.encWatch?.[e.id] ?? (e.generic ? "random" : undefined);
      if (pick === "random" || (!n && e.generic)) { list.push({ ...e, rest: { ...base, pending: true, rolls: [] } }); continue; }
      const i = Number.isFinite(pick) && pick < n ? pick : null;
      if (i == null) { list.push({ ...e, rest: base }); continue; }
      const x = pl.watches[i];
      list.push({ ...e, rest: { ...base, at: Math.round((lead + (x.from + x.to) / 2) * 2) / 2, watch: i } });
    }
    await this.save({ encounters: list });
  }

  /* ------------------------------------------------------------------ the camp scene */
  // When the rest begins the camp scene comes up over the map for everyone: the camp, everyone by
  // task (Watch last, in watch order, a shared shift together); then each task's checks, rolled in
  // the scene and confirmed by the GM; then each watch: its die (an encounter at random), and an
  // encounter's watcher's check, its scene to activate or view, and the camp held while it is run;
  // then the end of rest, and Break camp. The GM moves it on; the clock moves with it. The travel panel keeps
  // the setup, and a summary while in camp. Its state is the journey's watch.scene: { night, step,
  // hold }; setup tasks, watches, recovery, optional waiting, packing, done. "dawn" remains a legacy ID.

  /** Tonight's steps. */
  #steps() {
    const out = ["camp"];
    if (this.advanced) for (const k of ["forage", "conceal", "alarm"]) if (this.taskOn(k) && this.members().some((m) => this.taskOf(m.id) === k)) out.push(k);
    const n = this.plan().watches.length;
    if (n) for (let i = 0; i < n; i++) out.push(`w${i}`); else out.push("night");
    if (this.plan().version === 2) { out.push("recovery"); if (this.plan().wait > 0) out.push("wait"); out.push("pack"); }
    else out.push("dawn");
    return out;
  }
  /** A step's watch index (-1: the night with no one on watch), else null. */
  #stepWatch(step) { return step === "night" ? -1 : /^w\d+$/.test(step ?? "") ? Number(step.slice(1)) : null; }
  #stepLabel(step) {
    const i = this.#stepWatch(step);
    return i != null ? (i < 0 ? "Rest without a watch" : `Watch ${i + 1}`) : { camp: "Setup camp", forage: "Forage", conceal: "Conceal", alarm: "Alarms", recovery: "Rest complete", wait: "Wait before packing", pack: "Pack up", dawn: "Rest ends" }[step] ?? step;
  }

  /** The scene now: { night, step, hold, steps, at }, while it runs tonight; else null. */
  sceneNow(p) {
    const s = this.watch.scene;
    if (!p || !s || s.night !== p.night || s.step === "done") return null;
    if (!(p.status === "resting" || (p.status === "encounter" && p.camp))) return null;
    const steps = this.#steps();
    return { ...s, steps, at: Math.max(0, steps.indexOf(s.step)) };
  }

  /** The rest has begun (GM): the scene comes up, at the camp. */
  async openScene(night) { await this.#ensureCamp(night); this.sceneMin = false; return this.write({ scene: { night, step: "camp", hold: false } }); }

  /** Move the scene on to a step (GM): a task's checks are asked; a watch begins (its die, the clock). */
  async #sceneGo(step) {
    let p = this.prog();
    const sc = this.sceneNow(p);
    if (!p || !sc || sc.steps[sc.at + 1] !== step) return;
    if (this.#awaitingWatchResult(this.#stepWatch(sc.step))) return;
    if (sc.step === "recovery") return;
    if (TASKS[sc.step] && !this.#checks(p.night)[sc.step]?.done) return;
    if (this.commandContext && !this.commandContext.valid()) return;
    const i = this.#stepWatch(step);
    if (this.plan().version === 2) {
      const s = this.schedule(p), n = this.#tonight(p);
      if (i != null) await this.#advanceTo(n.start + (i < 0 ? 0 : n.pl.watches[i].from) * 3600);
      else if (step === "recovery") await this.#advanceTo(s.restEnd);
      else if (step === "pack") await this.#advanceTo(s.packStart);
      if (this.commandContext && !this.commandContext.valid()) return;
      p = this.prog();
    }
    if (i != null) await this.#watchBegins(p, i);
    await this.write({ scene: { ...(this.watch.scene ?? {}), night: p.night, step, hold: false } });
  }

  /**
   * A watch begins (GM; i -1: the night, no one on watch): each encounter waiting on the dice rolls
   * this watch's die, 1d(watches left + 1 + concealment); a 1 brings it at a random time in this
   * watch. Then the clock goes to an encounter in this watch (the journey stops there), else to the
   * watch's start. clock false: the dice only (the clock moved on by itself).
   */
  async #watchBegins(p, i, { clock = true, valid = () => true } = {}) {
    const n = this.#tonight(p);
    if (!n) return;
    if (!(await this.revealWatch(p, i, valid))) return;
    const pl = n.pl, lead = pl.setup ?? pl.rest - pl.window, { conceal } = this.campEffects(p.night), last = i < 0 || i === pl.watches.length - 1;
    const list = [...(this.st.encounters ?? [])];
    let changed = false;
    for (let k = 0; k < list.length; k++) {
      const e = list[k];
      if (!e.rest?.pending || e.rest.night !== p.night || (e.rest.rolls ?? []).some((r) => r.w === i)) continue;
      const die = (i < 0 ? 1 : pl.watches.length - i + 1) + conceal, roll = (await new Roll(`1d${die}`).evaluate()).total;
      if (!valid() || (this.commandContext && !this.commandContext.valid())) return;
      const rolls = [...(e.rest.rolls ?? []), { die, roll, w: i }];
      if (roll === 1) {
        const from = i < 0 ? 0 : pl.watches[i].from, to = i < 0 ? pl.window : pl.watches[i].to;
        const into = from + Math.random() * Math.max(0, to - from - 0.25);
        list[k] = { ...e, rest: { ...e.rest, rolls, pending: false, watch: i, at: lead + Math.floor(into * 4) / 4 } };
      } else list[k] = { ...e, rest: { ...e.rest, rolls, ...(last ? { pending: false, quiet: true } : {}) } };
      changed = true;
    }
    const reveal = this.watch.reveals?.[i];
    if (!valid() || (this.commandContext && !this.commandContext.valid())) return;
    if (reveal && !reveal.done) {
      const results = list.flatMap((e) => e.rest?.night === p.night ? (e.rest.rolls ?? []).filter((r) => r.w === i).map((r) => ({ die: r.die, roll: r.roll, encounter: e.id })) : []);
      if (!results.length) {
        const scheduled = list.some((e) => e.rest?.night === p.night && e.rest.watch === i && !e.rest.pending && !e.rest.quiet && this.st.trip?.resumed?.[e.id] == null);
        const die = scheduled ? 1 : (i < 0 ? 1 : pl.watches.length - i + 1) + conceal;
        const roll = (await new Roll(`1d${die}`).evaluate()).total;
        if (!valid() || (this.commandContext && !this.commandContext.valid())) return;
        results.push(scheduled ? { die, roll, scheduled: true } : ambientWatchResult(die, roll));
      }
      const reveals = { ...this.watch.reveals, [i]: { ...reveal, done: true, results } };
      await this.save({ ...(changed ? { encounters: list } : {}), ...(this.practice ? { watch: { ...this.watch, reveals } } : { "watch.reveals": reveals }) });
    } else if (changed) await this.save({ encounters: list });
    if (!clock) return;
    if (this.#awaitingWatchResult(i)) return;
    const resumed = this.st.trip?.resumed ?? {};
    const times = list.filter((e) => e.rest?.night === p.night && !e.rest.pending && !e.rest.quiet && e.rest.watch === i && resumed[e.id] == null).map((e) => n.start + ((e.rest.at ?? 0) - lead) * 3600);
    const target = times.length ? Math.min(...times) : n.start + (i < 0 ? 0 : pl.watches[i].from) * 3600;
    const dt = Math.ceil(target - this.now);
    if (dt > 0) await this.advance(dt);
  }

  #awaitingWatchResult(i) {
    const r = i != null ? this.watch.reveals?.[i] : null;
    return !!r && r.campId === this.watch.campId && r.done && !r.seen && r.results?.some((x) => x.roll === 1 && !x.harmless);
  }

  /** One shared reveal per watch. Reloads and a GM handover resume it instead of rolling again. */
  async revealWatch(p, i, valid = () => true) {
    const campId = this.watch.campId;
    let reveal = this.watch.reveals?.[i];
    if (reveal?.campId !== campId) reveal = null;
    if (reveal?.done) return true;
    if (!reveal) {
      const pl = this.plan(), die = (i < 0 ? 1 : pl.watches.length - i + 1) + this.campEffects(p.night).conceal;
      const count = Math.max(1, (this.st.encounters ?? []).filter((e) => e.rest?.night === p.night && e.rest.pending).length);
      reveal = { id: foundry.utils.randomID(), campId, until: Date.now() + WATCH_ROLL_MS, dice: Array(count).fill(die), done: false };
      await this.write({ reveals: { ...this.watch.reveals, [i]: reveal }, scene: { ...this.watch.scene, night: p.night, step: i < 0 ? "night" : `w${i}`, hold: false } });
    }
    await this.waitForWatch(Math.max(0, Math.min(WATCH_ROLL_MS, reveal.until - Date.now())));
    return valid() && (!this.commandContext || this.commandContext.valid()) && this.watch.campId === campId && this.watch.reveals?.[i]?.id === reveal.id;
  }
  waitForWatch(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

  /** End of rest: finish the clock, then request the party's recovery. */
  async #breakCamp() {
    if ((!this.practice && !this.hud.leader) || this.breakingCamp) return;
    const p = this.prog();
    const step = this.sceneNow(p)?.step;
    if (!["dawn", "pack"].includes(step)) return;
    if (!Number.isFinite(p.until)) return ui.notifications.warn("KG Realms: the rest end time is missing. Recovery has not been requested.");
    this.breakingCamp = true;
    try {
      const practice = !!this.practice;
      const actors = !practice ? this.members().map((m) => m.actor) : [];
      const dt = Math.ceil((p?.until ?? 0) - this.now);
      if (p?.status === "resting" && dt > 0) await this.advance(dt);
      await this.write({ setup: null, scene: { ...(this.watch.scene ?? {}), step: "done", hold: false } });
      if (step === "dawn" && !practice && game.modules.get("rest-recovery")?.active) {
        const api = game.restrecovery;
        const requested = promptCompletedCampRest(api, actors,
          { start: p?.since, end: p?.until, calendar: game.time.calendar });
        if (!requested) ui.notifications.warn("KG Realms: Rest Recovery could not request the party's rest. World time is already at the end of the rest. Check Rest Recovery before prompting a rest manually, since its regular prompt may advance time again.");
      }
    } finally { this.breakingCamp = false; }
  }

  async #recover(skip = false) {
    const p = this.prog(), s = this.schedule(p), campId = this.watch.campId;
    if (this.sceneNow(p)?.step !== "recovery" || !s) return;
    const next = this.plan().wait > 0 ? "wait" : "pack";
    if (this.watch.recovery?.campId === campId && this.watch.recovery.done) return this.write({ scene: { ...this.watch.scene, step: next } });
    const active = !this.practice && game.modules.get("rest-recovery")?.active;
    if (active && !skip) {
      // Record the attempt before the external API call. A handover never automatically repeats it.
      if (this.watch.recovery?.state === "requesting") return ui.notifications.warn("KG Realms: a recovery request was already started. Check Rest Recovery before continuing without another request.");
      await this.write({ recovery: { campId, state: "requesting", at: this.now, done: false } });
      if (this.commandContext && !this.commandContext.valid()) return;
      try {
        const result = await promptCompletedCampRest(game.restrecovery, this.members().map((m) => m.actor), { start: s.started, end: s.restEnd, calendar: game.time.calendar });
        if (!result) throw new Error("Rest Recovery did not accept the party request.");
      } catch (err) {
        await this.write({ recovery: { campId, state: "failed", done: false } });
        ui.notifications.warn(`KG Realms: ${err.message} No world time was advanced. Correct the party/API and retry, or continue without recovery.`);
        return;
      }
    }
    await this.write({ recovery: { campId, state: active && !skip ? "requested" : "skipped", done: true, at: this.now }, scene: { ...this.watch.scene, step: next } });
  }

  /** Shared catch-up also runs on a headless primary GM, so a handover cannot strand a reveal. */
  followClock(p) {
    const sc = p ? this.sceneNow(p) : null;
    if (!sc || this.hud.canSync?.() === false) return;
    const commandKey = `${this.hud.scene?.id}|${this.hud.scene?.partyId??''}|${journeyKey(this.st)}`;
    if (!this.practice && isPrimaryGM() && p.status === "resting" && !this.following && !commands.has(commandKey)) {
      if (this.plan().version === 2 && this.#phaseName(sc.step) === "setup" && this.#steps().some((key) => TASKS[key] && !this.#checks(p.night)[key]?.done)) return;
      const n = this.#tonight(p), at = this.#stepWatch(sc.step);
      if (this.#awaitingWatchResult(at)) return;
      const reveal = at != null ? this.watch.reveals?.[at] : null;
      const resumeReveal = !!reveal && reveal.campId === this.watch.campId && !reveal.done;
      if (resumeReveal || (n && n.cur >= 0 && (at == null ? sc.at < sc.steps.indexOf("w0") : at < n.cur) && sc.steps.includes(`w${n.cur}`) && n.into > 0)) {
        this.following = true;
        commands.add(commandKey);
        const scene = this.hud.scene, trip = journeyKey(this.st), campId = this.watch.campId, epoch = this.hud.lifecycleEpoch;
        const valid = () => this.hud.scene === scene && this.hud.lifecycleEpoch === epoch && isPrimaryGM() && this.hud.canSync?.() !== false && journeyKey(this.st) === trip && this.watch.campId === campId;
        this.commandContext = { scene, trip, campId, valid };
        (async () => {
          if (resumeReveal) await this.#watchBegins(p, at, { valid });
          else {
            let step = `w${n.cur}`;
            for (let i = Math.max(0, at ?? 0); i <= n.cur && valid(); i++) {
              await this.#watchBegins(p, i, { clock: false, valid });
              if (this.#awaitingWatchResult(i)) { step = `w${i}`; break; }
            }
            if (valid()) await this.write({ scene: { ...this.watch.scene, step, hold: false } });
          }
        })()
          .catch((err) => console.warn("kg-realms | the camp scene could not follow the clock:", err)).finally(() => { this.following = false; this.commandContext = null; commands.delete(commandKey); this.hud.onCampWorkEnded?.(scene); });
      }
    }
  }

  /**
   * The scene over the map, drawn after each redraw of the travel panel (everyone). Held for an
   * encounter: a slim bar. Minimised (this client): a slim bar to bring it back. The GM's client
   * follows the clock when it moved on by itself: watches passed are rolled, and the scene goes to
   * the watch now.
   */
  renderScene(p) {
    // A practice night draws its own, whatever the travel panel is doing.
    if (this.practice) p = this.prog();
    const sc = p ? this.sceneNow(p) : null;
    let el = document.querySelector(".kgr-camp-scene");
    if (!sc) { this.sceneDock?.(); this.sceneDock = null; el?.remove(); this.sceneHtmlNow = null; this.sceneStage = null; this.sceneHeld = false; return; }
    const commandKey = `${this.hud.scene?.id}|${this.hud.scene?.partyId??''}|${journeyKey(this.st)}`;
    if (isPrimaryGM() && !this.watch.campId && !this.identifying && !commands.has(commandKey)) {
      this.identifying = true;
      this.#ensureCamp(p.night).then(() => { this.identifying = false; this.renderScene(this.prog()); }).catch((err) => { this.identifying = false; console.warn("kg-realms | camp identity:", err); });
      return;
    }
    this.followClock(p);
    if (!el) {
      el = document.createElement("div");
      el.className = "kgr-ui kgr-camp-scene";
      el.setAttribute("role", "region");
      el.setAttribute("aria-label", "Camp watch");
      el.innerHTML = `<div class="cs-body"></div>`;
      el.addEventListener("click", (e) => { const b = e.target.closest("[data-camp]"); if (b && b.tagName === "BUTTON") this.click(b); });
      el.addEventListener("change", (e) => { if (e.target.dataset?.camp) this.change(e.target); });
      el.addEventListener("focusout", () => setTimeout(() => {
        if (this.sceneHeld && el.isConnected && !el.contains(document.activeElement)) this.renderScene(this.prog());
      }, 0));
      overCanvas(el);
      this.sceneDock?.();
      this.sceneDock = observeMapUi(() => this.placeScene());
      this.sceneHtmlNow = null;
    }
    // Keep an in-progress DC edit. A new watch or encounter releases it so the scene can follow.
    const f = document.activeElement;
    const stage = `${p.status}|${p.night ?? ""}|${sc.step}|${sc.hold ? 1 : 0}|${p.encounter?.id ?? ""}`;
    if (el.contains(f) && /^(INPUT|SELECT)$/.test(f.tagName) && !["checkbox", "radio"].includes(f.type)) {
      if (stage === this.sceneStage) { this.sceneHeld = true; this.placeScene(); return; }
      f.blur();
    }
    this.sceneStage = stage;
    this.sceneHeld = false;
    const held = !!(sc.hold && p.status === "encounter"), min = !!this.sceneMin && !held;
    el.classList.toggle("held", held);
    el.classList.toggle("min", min);
    // Only when it changed (the clock redraws the panel often: a die would spin again each time).
    const html = held ? this.#sceneHeld(p) : min ? this.#sceneMinBar(sc) : this.#sceneHtml(p, sc);
    if (html !== this.sceneHtmlNow) {
      const scroll = captureScroll(el, [".cs-body", ".cs-chips"]);
      el.querySelector(".cs-body").innerHTML = html;
      this.sceneHtmlNow = html;
      const strip = el.querySelector(".cs-chips"), active = strip?.querySelector(".on");
      if (active) strip.scrollLeft = Math.max(0, active.offsetLeft - strip.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2);
      restoreScroll(el, scroll.filter((s) => s.selector !== ".cs-chips"));
    }
    this.placeScene();
  }

  placeScene() {
    const el = document.querySelector(".kgr-camp-scene");
    if (el) dockOverMap(el);
  }

  #sceneMinBar(sc) {
    return `<div class="cs-bar"><i class="fa-solid fa-campground"></i><span class="grow">The camp · ${esc(this.#stepLabel(sc.step))}</span><button data-camp="scene-show" class="primary">Show</button></div>`;
  }

  /** Held for an encounter: who is on it (the GM sees its name), its scene, and Carry on (GM). */
  #sceneHeld(p) {
    const gm = game.user.isGM, e = (this.st.encounters ?? []).find((x) => x.id === p.encounter?.id) ?? p.encounter;
    const sc = e?.scene ? game.scenes.get(e.scene) : null;
    return `<div class="cs-bar held"><i class="fa-solid fa-hourglass-half"></i><span class="grow"><b>Holding for encounter resolution</b>${gm && e?.name ? ` · ${esc(e.name)}` : ""}</span>
      ${gm && sc ? `<button data-camp="scene-go" data-id="${sc.id}"><i class="fa-solid fa-users"></i> Go to ${esc(sc.name)}</button><button data-camp="scene-view" data-id="${sc.id}" title="View it (only you)"><i class="fa-solid fa-eye"></i></button>` : ""}
      </div>${gm ? this.#resolutionUI(p) : '<p class="cs-note">The GM is resolving the encounter.</p>'}`;
  }

  #resolutionDraft(p) {
    const key = `${this.watch.campId}|${p?.encounter?.id}|${p?.since}`;
    if (this.encounterDraft?.key !== key) this.encounterDraft = { key, kind: "continue", minutes: Math.max(0, Math.ceil((this.now - (p?.since ?? this.now)) / 60)), distance: 5 };
    return this.encounterDraft;
  }

  #resolutionUI(p) {
    const d = this.#resolutionDraft(p), elapsed = Math.max(0, Math.round((this.now - p.since) / 60));
    return `<section class="camp-resolution"><label>Total encounter duration <input type="number" min="0" max="10080" step="1" data-camp="encounter-duration" value="${d.minutes}"> minutes</label><small>${elapsed} minutes already passed on the world clock. Only any remaining duration will be added.</small><label>After the encounter <select data-camp="encounter-resolution">${Object.entries(CAMP_RESOLUTIONS).map(([key, r]) => `<option value="${key}" ${key === d.kind ? "selected" : ""}>${r.label}</option>`).join("")}</select></label><p>${CAMP_RESOLUTIONS[d.kind]?.text ?? CAMP_RESOLUTIONS.continue.text}</p>${d.kind === "abandon" ? `<label>Flee distance <input type="number" min="0.1" max="100" step="0.5" data-camp="escape-distance" value="${d.distance}"> miles</label>` : ""}<button data-camp="scene-carry" class="primary">Conclude encounter</button></section>`;
  }

  async #resolveCampEncounter() {
    const p = this.prog(); if (p?.status !== "encounter" || !p.camp) return;
    const practice = !!this.practice;
    const d = this.#resolutionDraft(p), kind = CAMP_RESOLUTIONS[d.kind] ? d.kind : "continue", start = p.campStart;
    const escape = kind === "abandon" && !this.practice ? await this.hud.planCampEscape?.(d.distance) : null;
    if (kind === "abandon" && !this.practice && !escape) return ui.notifications.warn("KG Realms: no landward escape was found at that distance. Choose another distance before abandoning camp.");
    if (this.commandContext && !this.commandContext.valid()) return;
    const extra = encounterTimeRemaining(this.now, p.since, d.minutes); if (extra) await this.advance(extra);
    if (this.commandContext && !this.commandContext.valid()) return;
    let trip = { ...this.st.trip, resumed: { ...this.st.trip?.resumed, [p.encounter.id]: this.now } };
    const resolution = { encounter: p.encounter.id, kind, duration: this.now - p.since, at: this.now };
    let watch = { ...this.watch, resolutions: [...(this.watch.resolutions ?? []), resolution], scene: { ...this.watch.scene, hold: false } };
    const encounters = kind === "continue" ? this.st.encounters : (this.st.encounters ?? []).map((e) => e.rest?.night === p.night && e.id !== p.encounter.id && trip.resumed[e.id] == null ? { ...e, rest: { ...e.rest, pending: false, quiet: true, skipped: true } } : e);
    if (kind === "interrupted") {
      const phases = { ...interruptedCampPhases(this.plan(), start, this.now), campId: this.watch.campId };
      trip.campEnds = { ...trip.campEnds, [p.night]: { at: start + phases.total * 3600, restComplete: false } };
      watch = { ...watch, phases, recovery: { campId: watch.campId, done: true, state: "interrupted" }, scene: { ...watch.scene, step: "pack" } };
    } else if (kind === "abandon") {
      trip.campEnds = { ...trip.campEnds, [p.night]: { at: this.now, restComplete: false, abandoned: true } };
      if (!this.practice) trip = { ...trip, escape: { ...escape, hour: p.hour, campId: watch.campId }, halts: [...(trip.halts ?? []), { from: this.now, to: null }] };
      watch.scene = { ...watch.scene, step: "done" }; watch.setup = null;
    }
    this.hud.motionDuration = 8000;
    try { await this.save({ trip, watch, encounters }); if (!practice) await this.hud.tick?.({ force: true }); }
    finally { this.hud.motionDuration = null; }
    if (kind === "complete") {
      if (this.plan().version !== 2) {
        const old = this.plan(), phases = { ...old, version: 2, total: old.rest + 4, pack: 4, packFrom: old.rest, watchEnd: old.rest, wait: 0, campId: this.watch.campId };
        const end = this.prog().until + 4 * 3600;
        await this.save({ trip: { ...this.st.trip, campEnds: { ...this.st.trip.campEnds, [p.night]: { at: end, restComplete: true } } }, watch: { ...this.watch, phases } });
      }
      await this.#advanceTo(this.schedule(this.prog()).restEnd);
      await this.write({ scene: { ...this.watch.scene, step: "recovery", hold: false } });
    }
  }

  /** A face: the portrait, or initials. */
  #face(m, size = 54, watch = false) {
    const ini = esc((m?.name ?? "?").split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase());
    const tired = watch && this.fatigue(m?.id);
    return `<span class="cs-face ${tired ? "camp-fatigued" : ""}" ${tired ? 'title="Tired from setup work: disadvantage on watch checks"' : ""} style="width:${size}px;height:${size}px">${m?.img ? `<img src="${esc(m.img)}" alt="">` : ini}</span>`;
  }

  #fatigueNote(ids) {
    const members = this.members();
    return ids.map((id) => {
      const work = this.fatigue(id); if (!work) return "";
      const name = members.find((m) => m.id === id)?.name ?? "Watcher";
      const activity = { forage: "foraging", conceal: "concealing the camp", alarm: "setting alarms" }[work];
      return `<span class="cs-fatigue-note">${esc(name)}: tired from ${activity}. Disadvantage on watch checks.</span>`;
    }).join("");
  }

  #sceneHtml(p, sc) {
    const gm = game.user.isGM, step = sc.step, i = this.#stepWatch(step), phased = this.plan().version === 2;
    const phase = this.#phaseName(step);
    const failed = (key) => { const c = TASKS[key] ? this.#checks(p.night)[key] : null; return c?.done && (key === "conceal" ? !c.result?.successes : !c.result?.success); };
    const chips = (this.practice ? `<span class="cs-chip practice">Practice: nothing is kept</span>` : "") + sc.steps.map((s, k) => phased && this.#phaseName(s) !== phase ? "" : `<span class="cs-chip ${k < sc.at ? `done ${failed(s) ? "failed" : ""}` : k === sc.at ? "on" : ""}">${esc(this.#stepLabel(s))}</span>`).join("");
    const reveal = i != null ? this.watch.reveals?.[i] : null, rolling = !!reveal && reveal.campId === this.watch.campId && !reveal.done;
    const waiting = this.#awaitingWatchResult(i), hidden = !gm && !!this.#setting("hideEncounterRolls");
    let body;
    if (rolling) body = rollingWatchHtml(reveal, reveal.dice ?? [Math.max(1, this.plan().watches.length - i + 1)], { hidden });
    else if (waiting) body = watchResultsHtml(reveal.results, { hidden });
    else if (p.status === "encounter" && p.camp) body = this.#sceneEncounter(p);
    else if (step === "camp") body = this.#sceneCamp(p);
    else if (TASKS[step]) body = this.#sceneTask(step, p);
    else if (i != null) body = this.#sceneWatch(p, i);
    else if (["recovery", "wait", "pack"].includes(step)) body = this.#scenePhaseEnd(p, step);
    else body = this.#sceneRestEnd(p);
    const next = sc.steps[sc.at + 1], c = TASKS[step] ? this.#checks(p.night)[step] : null;
    let go = "", advance = "";
    if (gm && waiting) go = `<button data-camp="watch-continue" data-reveal="${esc(reveal.id)}" class="primary">Continue to encounter</button>`;
    else if (gm && p.status !== "encounter" && !rolling) {
      if (step === "pack" || step === "dawn") {
        go = `<button data-camp="scene-break" class="primary" ${Number.isFinite(p.until) ? "" : "disabled"}>${phased ? "Finish packing and depart" : "Break camp and request rest"}</button>`;
        advance = this.#nextAdvance(p, "done");
      } else if (step === "recovery") {
        const rr = !this.practice && game.modules.get("rest-recovery")?.active;
        go = `<button data-camp="camp-recover" class="primary">${rr ? "Request party recovery and continue" : "Continue to break camp"}</button>`;
        if (["failed", "requesting"].includes(this.watch.recovery?.state)) go += '<button data-camp="recovery-skip">Continue without another recovery request</button>';
        advance = "No world time advances. Recovery is requested once; packing is separate.";
      } else {
        go = `<button data-camp="scene-next" data-step="${esc(next)}" class="primary" ${TASKS[step] && !c?.done ? "disabled" : ""}>${step === "wait" ? "Start packing" : `Next: ${esc(this.#stepLabel(next))}`}</button>`;
        advance = this.#nextAdvance(p, next);
        if (TASKS[next]) advance += " Setup activities share the setup period.";
      }
    }
    const stop = gm && this.practice && !this.practice.view ? '<button data-camp="practice-end">End practice</button>' : "";
    return `<div class="cs-carousel-head"><div><span class="cs-context">Camp ${p.night}</span><span class="cs-context" role="status" aria-live="polite">${phased ? `${{ setup: "Setup", rest: "Rest and watches", break: "Break camp" }[phase]}. ` : ""}Step ${sc.at + 1} of ${sc.steps.length}</span></div><button data-camp="scene-min" class="cs-min" aria-label="Minimise the camp carousel">-</button></div>${this.#phaseSummary(p, step)}<div class="cs-chips" aria-label="Phase progress">${chips}</div>${body}${advance ? `<p class="cs-clock-advance">${esc(advance)}</p>` : ""}<div class="cs-foot">${go}${stop}${gm ? "" : '<span class="cs-note">The GM advances camp time.</span>'}</div>`;
  }

  #watchTiming(p, i) {
    const t = this.watchTimes(p, i);
    return t ? `${this.#range(t.from, t.to)}. Elapsed: ${this.#duration(Math.max(0, Math.min(this.now, t.to) - t.from))}. Remaining: ${this.#duration(Math.max(0, t.to - Math.max(this.now, t.from)))}.${t.held ? ` Includes ${this.#duration(t.held)} of interruption.` : ""}` : "";
  }

  #scenePhaseEnd(p, step) {
    const s = this.schedule(p), pl = this.plan();
    if (step === "wait") return `<div class="cs-title"><b>Wait before packing</b><span class="cs-meta">${esc(this.#range(s.restEnd, s.packStart))}. Rest is complete. Extra camp time delays packing and departure.</span></div>`;
    if (step === "pack") return `<div class="cs-title"><b>Pack up camp</b><span class="cs-meta">${esc(this.#range(s.packStart, s.end))}. Breakfast, break down camp and prepare to travel.</span></div>`;
    let profile = "";try { profile = game.restrecovery?.getActiveProfile?.() ?? ""; } catch {}
    return `<div class="cs-title"><b>Rest complete</b><span class="cs-meta">${esc(this.#range(s.restStart, s.restEnd))}. ${pl.sleep} h of rest, including watches.</span></div><p class="cs-recovery">${!this.practice && game.modules.get("rest-recovery")?.active ? `Rest Recovery${profile ? `: ${esc(profile)}` : ""}. Request the party's recovery now, without advancing the clock.` : "Recovery is complete when your table applies it. Packing still takes four hours."}</p>`;
  }

  /** The camp: everyone by task, Watch last in watch order (a shared shift together). */
  #sceneCamp(p) {
    const members = this.members(), pl = this.plan(), start = (p.since ?? this.now) + (pl.setup ?? pl.rest - pl.window) * 3600;
    const groups = this.advanced ? ["forage", "conceal", "alarm"].filter((k) => this.taskOn(k)).map((k) => {
      const who = members.filter((m) => this.taskOf(m.id) === k);
      if (!who.length) return "";
      const c = this.#checks(p.night)[k] ?? {}, lead = TASKS[k].help ? c.leader ?? null : null;
      const R = this.hud.ruleText(), tip = { forage: R.forage, conceal: R.conceal, alarm: R.alarm }[k];
      return `<div class="cs-group"><span class="cs-group-head"><i class="fa-solid ${TASKS[k].icon}"></i><b>${esc(TASKS[k].label)}</b>${tip ? rule(tip) : ""}${TASKS[k].help ? "<small>Leader with Help</small>" : ""}</span>
        ${who.map((m) => `<span class="cs-who">${this.#face(m, m.id === lead ? 54 : 44)}<span><b>${esc(m.name)}</b><small>${m.id === lead ? "leads" : TASKS[k].help && lead ? "helps" : (TASKS[k].skills ?? []).map((s) => SKILLS[s].short).join(" or ")}</small></span></span>`).join("")}</div>`;
    }).join("") : "";
    const RT = this.hud.ruleText();
    const watch = `<div class="cs-group watch"><span class="cs-group-head"><i class="fa-solid fa-eye"></i><b>Watch</b>${rule(`${RT.watch} ${RT.shift} ${RT.sleep}`)}<small>in watch order</small></span>
      ${pl.watches.length ? pl.watches.map((w, k) => { const all = [w.id, ...(w.with ?? [])].map((id) => members.find((m) => m.id === id)).filter(Boolean);
        return `<span class="cs-who"><span class="cs-n">${k + 1}</span><span class="cs-stack">${all.map((m) => this.#face(m, 44, true)).join("")}</span><span><b>${esc(all.map((m) => m.name.split(" ")[0]).join(" & "))}</b><small>${this.#clock(start + w.from * 3600)} to ${this.#clock(start + w.to * 3600)}${this.#until(w, start, members)}</small>${this.#fatigueNote(all.map((m) => m.id))}</span></span>`; }).join("")
        : `<span class="cs-none">No one keeps watch tonight.</span>`}</div>`;
    return `<div class="cs-title"><b>The camp is made</b><i>${pl.version === 2 ? "Setup activities share the four-hour setup period." : "This camp keeps its earlier saved schedule."} Rolls do not advance the clock. ${rule(this.advanced ? RT.tasks : RT.rest)}</i></div><div class="cs-groups">${groups}${watch}</div>`;
  }

  /** A shared watch's earlier stops, as " · Kavu until 08:08" (start: world time the watches begin). */
  #until(w, start, members) {
    return [w.id, ...(w.with ?? [])].filter((id) => (w.ends?.[id] ?? w.to) < w.to - 1e-6)
      .map((id) => ` · ${esc(members.find((m) => m.id === id)?.name.split(" ")[0] ?? "?")} until ${this.#clock(start + w.ends[id] * 3600)}`).join("");
  }

  /** Explicit alternatives share one request, so choosing either skill consumes the same roll. */
  #taskButtons(key, id, { forThem = false } = {}) {
    const actor = game.actors.get(id);
    const buttons = TASKS[key].skills.map((skill) => `<button data-camp="task-roll" data-key="${key}" data-id="${id}" data-skill="${skill}" class="${forThem ? "cs-small" : "primary"}"><i class="fa-solid fa-dice-d20"></i> Roll ${esc(SKILLS[skill].short)}${forThem ? " for them" : ""} ${skillBonus(actor, skill)}</button>`);
    return `<span class="cs-skill-options" role="group" aria-label="Choose one skill">${buttons.join('<span class="cs-skill-or">-or-</span>')}</span>`;
  }

  /** One result summary; actor rows retain choices and roles without repeating the final total. */
  #sceneTask(key, p) {
    const gm = game.user.isGM, T = TASKS[key], members = this.members(), who = members.filter((m) => this.taskOf(m.id) === key);
    const c = this.#checks(p.night)[key] ?? {}, dc = c.dc ?? this.defaultTaskDc(key), seen = gm || showDC(), leader = c.leader;
    const sub = `${key === "forage" ? "Within 100 feet of camp. " : ""}${T.skills.map((s) => SKILLS[s].label).join(" -or- ")}${seen && !c.done ? `. DC ${dc}` : ""}`;
    const faces = who.map((m) => {
      const r = c.rolls?.[m.id], lead = T.help && m.id === leader;
      const res = r?.total != null ? c.done ? T.skills.length > 1 ? `<span class="cs-meta">${esc(SKILLS[r.skill]?.short ?? "")}</span>` : ""
        : `<span class="cs-roll">Rolled ${r.total}</span>${gm ? `<button data-camp="task-reroll" data-key="${key}" data-id="${m.id}" class="cs-small"><i class="fa-solid fa-rotate-right"></i> Allow reroll</button>` : ""}`
        : c.done ? `<span class="cs-meta">No roll</span>` : !c.asked ? `<span class="cs-meta">Waiting for the GM</span>` : this.rollsFor(m.actor) ? this.#taskButtons(key, m.id)
        : `<span class="cs-meta">Waiting for a roll</span>${gm ? this.#taskButtons(key, m.id, { forThem: true }) : ""}`;
      return `<div class="cs-person ${lead ? "lead" : ""}">${this.#face(m, 42)}<span class="cs-person-name">${esc(m.name)}</span>${T.help && who.length > 1 ? `<span class="cs-meta">${lead ? "Leader" : "Helping"}</span>` : ""}${res}</div>`;
    }).join("");
    let sum = "";
    if (!c.done && T.help) {
      const lw = leaderWithHelp(c.rolls ?? {}, leader, dc);
      if (lw?.helps.length) sum = `Total ${lw.total}: ${lw.base}${lw.helps.map((h) => ` ${h.ok ? "+" : "-"} 1`).join("")}`;
    } else if (!c.done && T.stack && who.length > 1) {
      const rolled = Object.values(c.rolls ?? {}).filter((r) => r?.total != null).length;
      if (rolled) sum = `${concealed(c.rolls, dc)} of ${rolled} checks succeeded.`;
    }
    const spend = tenacity() ? "Use the roll's chat card to spend Tenacity. " : "";
    const done = c.done ? `<div class="cs-result">${this.#taskResult(key, c, who)}</div>` : "";
    const ready = T.help ? c.rolls?.[leader]?.total != null : Object.values(c.rolls ?? {}).some((r) => r?.total != null);
    const confirm = gm && !c.done && c.asked ? `<button data-camp="task-confirm" data-key="${key}" class="primary" ${ready ? "" : "disabled"}><i class="fa-solid fa-check"></i> Confirm result</button>` : "";
    const R = this.hud.ruleText(), tip = { forage: R.forage, conceal: R.conceal, alarm: R.alarm }[key];
    return `<div class="cs-title"><b>${esc(T.label)} ${rule(tip)}</b><span class="cs-meta">${esc(sub)}</span></div><div class="cs-people">${faces}</div>
      ${sum ? `<p class="cs-sum">${sum}</p>` : ""}${done}<div class="cs-actions">${gm && !c.done && !c.asked ? `<button data-camp="task-ask" data-key="${key}" class="primary">Request rolls</button>` : ""}${confirm}${!c.done ? this.#overrideUI(key, "task", !c.asked) : ""}${!gm && !c.done ? `<span class="cs-note">${spend}Waiting for GM confirmation.</span>` : ""}</div>`;
  }

  /** A watch: who keeps it, its die, and how it went. */
  #sceneWatch(p, i) {
    const gm = game.user.isGM, hide = !gm && !!this.#setting("hideEncounterRolls"), members = this.members(), n = this.#tonight(p), pl = n?.pl ?? this.plan();
    const w = i >= 0 ? pl.watches[i] : null, all = w ? [w.id, ...(w.with ?? [])].map((id) => members.find((m) => m.id === id)).filter(Boolean) : [];
    const encs = (this.st.encounters ?? []).filter((e) => e.rest?.night === p.night);
    const rolls = encs.flatMap((e) => (e.rest.rolls ?? []).filter((r) => r.w === i).map((r) => ({ e, r })));
    const met = encs.filter((e) => e.rest.watch === i && !e.rest.pending && !e.rest.quiet && (this.st.trip?.resumed ?? {})[e.id] != null);
    const RT = this.hud.ruleText();
    const results = this.watch.reveals?.[i]?.results ?? rolls.map(({ r }) => r);
    const dice = results.length ? watchResultsHtml(results, { hidden: hide }) : "";
    const how = met.length ? `<p class="cs-sum">The encounter is over. The watch goes on.</p>` : `<p class="cs-sum">${i < 0 ? "No one keeps watch. The night passes." : "A quiet watch."}</p>`;
    const head = i < 0 ? `<div class="cs-title"><b>No one keeps watch</b></div>`
      : `<div class="cs-watch ${all.some((m) => this.fatigue(m.id)) ? "camp-fatigued" : ""}"><span class="cs-stack big">${all.map((m) => this.#face(m, 150, true)).join("")}</span><b>${esc(all.map((m) => m.name).join(" and "))} ${all.length > 1 ? "take" : "takes"} the watch ${rule(`${RT.watch} ${RT.shift} ${RT.sleep}`)}</b>${n ? `<span class="cs-meta">${esc(this.#watchTiming(p, i))}</span>` : ""}${this.#fatigueNote(all.map((m) => m.id))}</div>`;
    return `${head}${dice}${results.length && !met.length ? "" : how}`;
  }

  /** An encounter in camp: the watcher's check, then its scene to activate or view, and the hold (GM). */
  #sceneEncounter(p) {
    const gm = game.user.isGM, members = this.members(), n = this.#tonight(p), w = n && n.cur >= 0 ? n.pl.watches[n.cur] : null;
    // Those on the watch still awake when it came (a shared watch: some may have stopped); the first makes the check.
    const all = w ? this.#awake(w, n.into).map((id) => members.find((x) => x.id === id)).filter(Boolean) : [], m = all[0];
    const e = (this.st.encounters ?? []).find((x) => x.id === p.encounter?.id) ?? p.encounter, a = this.#ask("watch", p.night), done = !w || (a?.enc === e?.id && a?.done);
    const sc = e?.scene ? game.scenes.get(e.scene) : null;
    const after = gm && done ? `<div class="cs-actions">${sc ? `<button data-camp="scene-go" data-id="${sc.id}" class="primary"><i class="fa-solid fa-users"></i> Activate ${esc(sc.name)}</button><button data-camp="scene-view" data-id="${sc.id}"><i class="fa-solid fa-eye"></i> View it (only you)</button>` : ""}<button data-camp="scene-hold" class="${sc ? "" : "primary"}"><i class="fa-solid fa-hourglass-half"></i> Hold for the encounter</button></div>` : "";
    return `<div class="cs-watch ${all.some((m) => this.fatigue(m.id)) ? "camp-fatigued" : ""}">${all.length ? `<span class="cs-stack big">${all.map((x) => this.#face(x, 130, true)).join("")}</span>` : ""}<small>${w ? `Watch ${n.cur + 1}` : "The night"}</small><b class="cs-alarm">${gm && e?.name ? esc(e.name) : "Something stirs beyond the firelight"}</b>${this.#fatigueNote(all.map((m) => m.id))}</div>
      <div class="cs-check">${w && a?.enc === e?.id && a?.done ? this.#check("watch", a, m) : this.#watchCheck(p, w, m)}</div>${after}`;
  }

  /** End of rest: camp results and the actual completion time. */
  #sceneRestEnd(p) {
    const gm = game.user.isGM, members = this.members(), c = this.#checks(p.night), pl = this.plan();
    const tasks = ["forage", "conceal", "alarm"].filter((k) => c[k]?.done).map((k) => `<li><i class="fa-solid ${TASKS[k].icon}"></i> ${esc(pastTaskSummary(k, c[k].result))}</li>`).join("");
    const hide = !gm && !!this.#setting("hideEncounterRolls");
    const watches = hide ? "" : (this.st.encounters ?? []).filter((e) => e.rest?.night === p.night).flatMap((e) => (e.rest.rolls ?? []).map((r) => `<li><i class="fa-solid fa-eye"></i> ${r.w < 0 ? "The night" : `Watch ${r.w + 1}, ${esc(members.find((m) => m.id === pl.watches[r.w]?.id)?.name.split(" ")[0] ?? "?")}`}: 1d${r.die}: ${r.roll}, ${r.roll === 1 ? (gm ? esc(e.name) : "an encounter") : "quiet"}</li>`)).join("");
    let profile = "";
    try { profile = game.restrecovery?.getActiveProfile?.() ?? ""; } catch { /* older Rest Recovery */ }
    const recovery = gm && !this.practice && game.modules.get("rest-recovery")?.active
      ? `<p class="cs-recovery"><b>Rest Recovery${profile ? `: ${esc(profile)}` : ""}</b><span>Break camp finishes the clock, then requests the party's long rest using the active profile.</span></p>` : "";
    const duration = Number.isFinite(p.until) && Number.isFinite(p.since) ? Math.round((p.until - p.since) / 360) / 10 : null;
    return `<div class="cs-title rest-end"><b>Rest ends at ${esc(this.#dateTime(p.until))}</b><span class="cs-meta">Started ${esc(this.#dateTime(p.since))}${duration != null ? `. ${duration} hours in camp.` : "."} ${rule(this.hud.ruleText().rest)}</span></div>${tasks || watches ? `<ul class="cs-summary">${tasks}${watches}</ul>` : ""}${recovery}`;
  }

  /** The panel's border in the colour of whoever holds the watch order, and a note saying so. */
  decorate(el) {
    const h = this.holder();
    el.classList.toggle("camp-held", !!h);
    el.style.setProperty("--kgr-held", h ? h.color?.css ?? String(h.color ?? "#d9a441") : "");
    el.querySelector(":scope > .camp-holder")?.remove();
    if (!h) return;
    const tag = document.createElement("div");
    tag.className = "camp-holder";
    tag.textContent = `${h.isSelf ? "You are" : `${h.name} is`} editing watch order...`;
    el.append(tag);
  }
}

/**
 * Show the watch change banner from its data (CampPanel#bannerData): the portrait comes up over
 * the map, then fades; a click sends it away. Everything in it is escaped or checked, since the
 * data may have come over the socket.
 */
export function showBanner(d) {
  if (!d?.name) return;
  const colour = (c) => (/^#[0-9a-f]{3,8}$/i.test(String(c)) ? c : "#9fe1ff"), num = (v, f = 0) => (Number.isFinite(Number(v)) ? Number(v) : f);
  const parts = (Array.isArray(d.parts) ? d.parts : []).map((p, i) => `<span class="${i === num(d.cur, -1) ? "cur" : i > num(d.cur, -1) ? "later" : ""}" style="flex:${Math.max(0, num(p.hours))};background:${colour(p.colour)}">${esc(p.name)}</span>`).join("");
  const gap = num(d.gap) > 1e-6 ? `<span class="camp-gap" style="flex:${num(d.gap)}">no one</span>` : "";
  const ticks = (Array.isArray(d.ticks) ? d.ticks : []).map((t) => `<span>${esc(t)}</span>`).join("");
  document.querySelector(".kgr-watch-banner")?.remove();
  const el = document.createElement("div");
  el.className = "kgr-ui kgr-watch-banner";
  el.setAttribute("role", "status");
  el.style.setProperty("--kgr-watch", colour(d.colour));
  // Behind it all, the Watch background setting: a video loops at 30% volume, a picture stands still.
  let bg = "";
  try { bg = String(game.settings.get(MODULE_ID, "watchBackground") ?? ""); } catch { /* not registered */ }
  const media = bg ? (/\.(webm|mp4|m4v|ogv|ogg)$/i.test(bg) ? `<video class="wb-bg" src="${esc(foundry.utils.getRoute(bg))}" autoplay loop playsinline></video>` : `<img class="wb-bg" src="${esc(foundry.utils.getRoute(bg))}" alt="">`) : "";
  el.classList.toggle("with-bg", !!media);
  el.innerHTML = `${media}<div class="wb-portrait"><img src="${esc(d.img)}" alt=""></div>
    <div class="wb-card"><span class="wb-n">Watch ${num(d.n, 1)} of ${num(d.total, 1)}</span><b class="wb-name">${esc(d.name)}</b><span class="wb-when">takes the watch · ${esc(d.when)}</span></div>
    <i class="wb-line">${esc(d.line)}</i>
    <div class="wb-bar"><div class="camp-ticks">${ticks}</div><div class="camp-bar">${parts}${gap}<i class="camp-now" style="left:${(Math.max(0, Math.min(1, num(d.nowAt))) * 100).toFixed(1)}%"></i></div></div>`;
  const video = el.querySelector("video.wb-bg");
  if (video) {
    video.volume = 0.3;
    // A browser that will not play it with sound (no click yet this session) plays it silent.
    video.play?.().catch(() => { video.muted = true; video.play().catch(() => {}); });
  }
  const close = () => { el.classList.add("out"); setTimeout(() => { video?.pause(); el.remove(); }, 700); };
  el.addEventListener("click", close);
  overCanvas(el);
  setTimeout(close, 5200);
}

/**
 * The Advanced watches settings window: Advanced watches on or off, each camp task on or off
 * (Foraging, Concealment, Alarms; Watch is always there), the ration item foraging hands out, and
 * the random encounter table a camp's random encounter is rolled on. Each saves as it changes.
 */
export function advancedWatchesMenu() {
  const { ApplicationV2 } = foundry.applications.api;
  const get = (k) => game.settings.get(MODULE_ID, k);
  return class AdvancedWatchesMenu extends ApplicationV2 {
    static DEFAULT_OPTIONS = { id: "kgr-advanced-watches", tag: "div", classes: ["kgr-ui", "kgr-advanced-menu"], window: { title: "KG Realms: Advanced watches", icon: "fa-solid fa-campground" }, position: { width: 480, height: "auto" } };
    async _renderHTML() {
      const on = !!get("advancedWatches");
      const drop = async (key, kind, icon, empty) => {
        const uuid = get(key), doc = uuid ? await fromUuid(uuid).catch(() => null) : null;
        return `<div class="kgr-ration-drop" data-drop="${key}" data-kind="${kind}">${doc ? `<img src="${esc(doc.img ?? "")}" alt=""><span class="grow"><b>${esc(doc.name)}</b><small>${esc(uuid.startsWith("Compendium.") ? uuid.split(".").slice(1, 3).join(".") : `World ${kind === "RollTable" ? "table" : "item"}`)}</small></span><button data-act="clear" data-key="${key}" aria-label="Clear"><i class="fa-solid fa-xmark"></i></button>` : `<i class="fa-solid ${icon}"></i><span class="grow">${empty}</span>`}</div>`;
      };
      const task = (k, label, hint) => `<label class="kgr-adv-task ${on ? "" : "off"}"><input type="checkbox" data-set="${TASKS[k].setting}" ${get(TASKS[k].setting) ? "checked" : ""} ${on ? "" : "disabled"}><span><b>${label}</b><small>${hint}</small></span></label>`;
      return `<div class="kgr-ration kgr-advanced">
        <label class="kgr-adv-main"><input type="checkbox" data-set="advancedWatches" ${on ? "checked" : ""}><span><b>Advanced watches</b><small>Each character may do one setup activity and also keep watch. Setup workers have disadvantage on checks during their own watch, shown with an orange outline. Take a watch can be unchecked for anyone. Off: no setup activities; watch duty remains optional.</small></span></label>
        <div class="kgr-adv-tasks">
          ${task("forage", "Foraging", "Search for food within 100 feet of the camp: Wisdom (Survival), DC by what the land offers. Leader with Help. Success: each character is given a ration (below).")}
          ${task("conceal", "Concealment", "Camouflage and clear tracks: Wisdom (Survival) or Dexterity (Stealth). Each success counts as one more watcher for the night's encounter dice.")}
          ${task("alarm", "Alarms", "Tripwires and the like: Wisdom (Survival) or Dexterity (Sleight of Hand). Leader with Help. Success: the night's Perception DC 5 lower, and no surprise.")}
        </div>
        <h4>Ration item</h4><p>Given to each character when foraging succeeds. With none set, only the result is shown.</p>
        ${await drop("rationItem", "Item", "fa-drumstick-bite", "Drop a ration item here, from a compendium or the Items sidebar")}
        <h4>Random encounter table</h4><p>Random encounter tonight? in the camp rolls this table, in secret, and adds the result as the night's encounter (its name, picture, and an actor it links to). With none set, Something in the night.</p>
        ${await drop("campEncounterTable", "RollTable", "fa-dice", "Drop a roll table here, from a compendium or the Roll Tables sidebar")}
      </div>`;
    }
    _replaceHTML(html, content) {
      content.innerHTML = html;
      if (content.kgrBound) return;
      content.kgrBound = true;
      content.addEventListener("change", async (e) => { const k = e.target.dataset?.set; if (!k) return; await game.settings.set(MODULE_ID, k, e.target.checked); this.render(); });
      content.addEventListener("dragover", (e) => e.preventDefault());
      content.addEventListener("drop", async (e) => {
        const box = e.target.closest("[data-drop]");
        if (!box) return;
        e.preventDefault();
        let data = null; try { data = foundry.applications.ux.TextEditor.implementation.getDragEventData(e); } catch { /* not a document */ }
        if (data?.type !== box.dataset.kind || !data.uuid) return ui.notifications.warn(`KG Realms: drop ${box.dataset.kind === "RollTable" ? "a roll table" : "an item"}.`);
        await game.settings.set(MODULE_ID, box.dataset.drop, data.uuid);
        this.render();
      });
      content.addEventListener("click", async (e) => { const b = e.target.closest("[data-act=clear]"); if (b) { await game.settings.set(MODULE_ID, b.dataset.key, ""); this.render(); } });
    }
  };
}
