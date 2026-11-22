// Skill challenges (0.97.0): the rules, with no Foundry calls, so they can be tested on their own.
//
// A challenge is built on a scene (a theater or battlemap: any Site or local map) and kept in its
// flags as `challenge`. Starting it copies it into a run, kept in the same scene's flags as
// `challengeRun`: the primary GM's client is the only one that changes the run; players send their
// rolls and spell requests to it. The party needs `goal.succ` successes before `goal.fail` failures,
// across stages run in order. Each stage offers approaches: one or more skills or ability checks at
// one DC. Rules: a character uses each skill once in the whole challenge (noRepeat); a listed spell
// can count, with the GM's say (spells); players see DCs (showDC); everyone acts before a stage ends
// (everyone). The ending: full success at the goal, failure at the failure limit, and when the last
// stage ends without either, partial success from `goal.partial` successes, else failure.

export const SKILLS = Object.freeze({
  acr: "Acrobatics", ani: "Animal Handling", arc: "Arcana", ath: "Athletics", dec: "Deception", his: "History",
  ins: "Insight", itm: "Intimidation", inv: "Investigation", med: "Medicine", nat: "Nature", prc: "Perception",
  prf: "Performance", per: "Persuasion", rel: "Religion", slt: "Sleight of Hand", ste: "Stealth", sur: "Survival"
});
export const ABILITIES = Object.freeze({ str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" });
export const SPELL_EFFECTS = Object.freeze({ auto: "Grants an automatic success", dc2: "Lowers the DC by 2", adv: "Gives advantage" });
export const STAGE_ENDS = Object.freeze({ acted: "every character has acted", gm: "the GM moves on" });
export const RESULTS = Object.freeze({ full: "Full success", partial: "Partial success", fail: "Failure" });

const int = (v, d, lo = 0, hi = 99) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const str = (v, max = 4000) => String(v ?? "").slice(0, max);
const id = () => Math.random().toString(36).slice(2, 10);

/** An option key: "skill:nat" or "check:str". */
export function optionLabel(key) {
  const [type, k] = String(key ?? "").split(":");
  if (type === "skill") return SKILLS[k] ?? k;
  if (type === "check") return `${ABILITIES[k] ?? k} check`;
  return String(key ?? "");
}
export const validOption = (key) => { const [type, k] = String(key ?? "").split(":"); return (type === "skill" && k in SKILLS) || (type === "check" && k in ABILITIES); };

export const blankApproach = () => ({ id: id(), options: [], dc: 15, text: "" });
export const blankStage = (n = 1) => ({ id: id(), title: `Round ${n}`, time: "", read: "", approaches: [blankApproach()], spells: [], spellEffect: "auto", spellNote: "" });
export const blankOutcome = () => ({ text: "", effects: [] });

export function blankChallenge(name = "New skill challenge") {
  return {
    name, hook: "",
    goal: { succ: 8, fail: 3, partial: 5 },
    rules: { noRepeat: true, spells: true, showDC: true, everyone: false },
    stageEnd: "acted",
    stages: [blankStage(1)],
    outcomes: { full: blankOutcome(), partial: blankOutcome(), fail: blankOutcome() }
  };
}

function normalizeEffect(e) {
  if (!e || typeof e !== "object") return null;
  if (e.kind === "item" && e.uuid) return { kind: "item", uuid: str(e.uuid, 300), name: str(e.name, 200), img: str(e.img, 500) };
  if (e.kind === "journal" && e.uuid) return { kind: "journal", uuid: str(e.uuid, 300), name: str(e.name, 200) };
  if (e.kind === "damage") return { kind: "damage", formula: str(e.formula || "1d6", 60), type: str(e.type || "bludgeoning", 30), save: e.save in ABILITIES ? e.save : "", dc: int(e.dc, 15, 1, 40) };
  if (e.kind === "exhaustion") return { kind: "exhaustion", levels: int(e.levels, 1, 1, 6) };
  if (e.kind === "time") return { kind: "time", hours: int(e.hours, 1, 1, 24 * 30) };
  return null;
}

/** A challenge from stored or edited data, every field checked and defaulted. */
export function normalizeChallenge(raw) {
  const b = blankChallenge(), r = raw && typeof raw === "object" ? raw : {};
  const goal = { succ: int(r.goal?.succ, b.goal.succ, 1, 50), fail: int(r.goal?.fail, b.goal.fail, 1, 50), partial: 0 };
  goal.partial = int(r.goal?.partial, Math.min(b.goal.partial, goal.succ), 0, goal.succ);
  const stages = (Array.isArray(r.stages) ? r.stages : b.stages).slice(0, 20).map((s, i) => ({
    id: str(s?.id || id(), 20), title: str(s?.title || `Round ${i + 1}`, 200), time: str(s?.time, 60), read: str(s?.read),
    approaches: (Array.isArray(s?.approaches) ? s.approaches : []).slice(0, 20).map((a) => ({
      id: str(a?.id || id(), 20), options: [...new Set((Array.isArray(a?.options) ? a.options : []).filter(validOption))].slice(0, 6),
      dc: int(a?.dc, 15, 1, 40), text: str(a?.text, 500)
    })),
    spells: (Array.isArray(s?.spells) ? s.spells : []).map((x) => str(typeof x === "string" ? x : x?.name, 120)).filter(Boolean).slice(0, 20),
    spellEffect: s?.spellEffect in SPELL_EFFECTS ? s.spellEffect : "auto", spellNote: str(s?.spellNote, 500)
  }));
  const outcome = (o) => ({ text: str(o?.text), effects: (Array.isArray(o?.effects) ? o.effects : []).map(normalizeEffect).filter(Boolean).slice(0, 20) });
  return {
    name: str(r.name || b.name, 200), hook: str(r.hook), goal,
    rules: { noRepeat: r.rules?.noRepeat !== false, spells: r.rules?.spells !== false, showDC: r.rules?.showDC !== false, everyone: !!r.rules?.everyone },
    stageEnd: r.stageEnd in STAGE_ENDS ? r.stageEnd : "acted",
    stages: stages.length ? stages : b.stages,
    outcomes: { full: outcome(r.outcomes?.full), partial: outcome(r.outcomes?.partial), fail: outcome(r.outcomes?.fail) }
  };
}

/* ------------------------------------------------------------------ files */

export const FILE_FORMAT = "kg-realms-skill-challenge";
export const FILE_SCHEMA = 1;

/** A challenge as a file: the format, its schema, when, and the challenge. */
export function exportChallenge(challenge, { exportedAt = new Date().toISOString(), system = "" } = {}) {
  return { format: FILE_FORMAT, schema: FILE_SCHEMA, exportedAt, system, challenge: normalizeChallenge(challenge) };
}

/** A safe file name for a challenge. */
export const exportFileName = (challenge) => `${String(challenge?.name || "skill-challenge").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "skill-challenge"}.json`;

/**
 * A challenge from a file's text: { challenge } or { error }. Takes this module's export, or a bare
 * challenge object (a hand-written file). A newer schema than this version knows is refused.
 */
export function importChallenge(text) {
  let data;
  try { data = JSON.parse(String(text ?? "")); } catch { return { error: "That file isn't valid JSON." }; }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { error: "That file doesn't hold a skill challenge." };
  if (data.format !== undefined && data.format !== FILE_FORMAT) return { error: "That file isn't a KG Realms skill challenge." };
  if (data.format === FILE_FORMAT && Number(data.schema) > FILE_SCHEMA) return { error: "That file was made by a newer KG Realms. Update the module to import it." };
  const raw = data.format === FILE_FORMAT ? data.challenge : data;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.stages)) return { error: "That file doesn't hold a skill challenge." };
  return { challenge: normalizeChallenge(raw) };
}

/** The item and journal links in a challenge's outcomes: [{ kind, uuid, name, outcome }]. */
export function challengeLinks(challenge) {
  return Object.entries(challenge?.outcomes ?? {}).flatMap(([outcome, o]) => (o?.effects ?? []).filter((e) => e.uuid).map((e) => ({ kind: e.kind, uuid: e.uuid, name: e.name, outcome })));
}

/** Problems that stop a challenge starting: [text]. */
export function challengeProblems(c) {
  const out = [];
  if (!c.stages.length) out.push("Add a stage.");
  c.stages.forEach((s, i) => {
    if (!s.approaches.length) out.push(`${s.title || `Stage ${i + 1}`}: add an approach.`);
    s.approaches.forEach((a, j) => { if (!a.options.length) out.push(`${s.title || `Stage ${i + 1}`}, approach ${j + 1}: pick a skill or check.`); });
  });
  return out;
}

/** A run from a challenge and its party ([{ id, name, img }]). */
export function startRun(challenge, party, { now = 0, scene = "", runId = id() } = {}) {
  const c = normalizeChallenge(challenge);
  return {
    id: runId, scene, name: c.name, hook: c.hook, goal: c.goal, rules: c.rules, stageEnd: c.stageEnd, stages: c.stages, outcomes: c.outcomes,
    party: (party ?? []).map((p) => ({ id: str(p.id, 40), name: str(p.name, 120), img: str(p.img, 500) })),
    stage: 0, acts: [], used: {}, requests: {}, boosts: {}, calls: [], succ: 0, fail: 0, result: null, applied: {}, gives: {}, started: now
  };
}

export const currentStage = (run) => run?.stages?.[run.stage] ?? null;

/**
 * The approaches of this stage the GM is calling for rolls on (0.98.2): players see and roll only these.
 * A run kept before 0.98.2 has none.
 */
export const calledApproaches = (run) => (Array.isArray(run?.calls) ? run.calls : []).filter((j) => Number.isInteger(j) && !!currentStage(run)?.approaches?.[j]);
export const isCalled = (run, approachIndex) => calledApproaches(run).includes(Number(approachIndex));

/** The GM calls for rolls on an approach this stage (on = true), or stops calling for it. */
export function callApproach(run, approachIndex, on = true) {
  const j = Number(approachIndex);
  if (run?.result || !currentStage(run)?.approaches?.[j]) return false;
  const calls = new Set(calledApproaches(run));
  if (on) calls.add(j); else calls.delete(j);
  run.calls = [...calls].sort((x, y) => x - y);
  return true;
}
/** The characters who have acted in a stage (rolled, had a spell count, or were skipped). */
export const actedIn = (run, stage = run.stage) => new Set(run.acts.filter((a) => a.stage === stage && a.actor).map((a) => a.actor));
const member = (run, actorId) => run.party.find((p) => p.id === actorId) ?? null;

/** Whether a character can act now, and with that option: { ok, reason }. */
export function canAct(run, actorId, option = null) {
  if (!run || run.result) return { ok: false, reason: "The challenge is over." };
  if (!member(run, actorId)) return { ok: false, reason: "Not in this challenge." };
  if (actedIn(run).has(actorId)) return { ok: false, reason: "Already acted this stage." };
  if (option && run.rules.noRepeat && (run.used[actorId] ?? []).includes(option)) return { ok: false, reason: `${optionLabel(option)} is already used.` };
  return { ok: true, reason: "" };
}

/** The DC and advantage a character rolls an approach at, with any spell boost from the GM. */
export function rollTerms(run, actorId, approachIndex) {
  const a = currentStage(run)?.approaches?.[approachIndex];
  if (!a) return null;
  const boost = run.boosts?.[actorId] ?? null;
  return { dc: Math.max(1, a.dc - (boost?.dc ?? 0)), advantage: !!boost?.adv };
}

function settle(run) {
  if (run.succ >= run.goal.succ) run.result = "full";
  else if (run.fail >= run.goal.fail) run.result = "fail";
  return run;
}

/** A character's roll for an approach. Returns the act, or null when it isn't allowed. */
export function recordRoll(run, { actor, approach, option, total }) {
  const stage = currentStage(run), a = stage?.approaches?.[approach];
  if (!a || !a.options.includes(option) || !Number.isFinite(total) || !canAct(run, actor, option).ok) return null;
  const terms = rollTerms(run, actor, approach), success = total >= terms.dc;
  const act = { stage: run.stage, actor, name: member(run, actor).name, kind: "roll", approach, option, total, dc: terms.dc, success, note: "" };
  run.acts.push(act);
  run.used[actor] = [...(run.used[actor] ?? []), option];
  delete run.boosts[actor];
  if (success) run.succ += 1; else run.fail += 1;
  settle(run);
  return act;
}

/** A player asks for a spell to count. */
export function requestSpell(run, { actor, spell, text }) {
  if (!run.rules.spells || !canAct(run, actor).ok || !String(spell ?? "").trim()) return false;
  run.requests[actor] = { spell: str(spell, 120), text: str(text, 500) };
  return true;
}

/** The GM's ruling on a spell request: "allow" (the stage's spell effect), "dc2", "adv" or "deny". */
export function ruleSpell(run, actor, decision) {
  const req = run.requests?.[actor];
  if (!req || !member(run, actor)) return null;
  delete run.requests[actor];
  const effect = decision === "allow" ? currentStage(run)?.spellEffect ?? "auto" : decision;
  if (effect === "auto") {
    const act = { stage: run.stage, actor, name: member(run, actor).name, kind: "spell", approach: null, option: null, total: null, dc: null, success: true, note: req.spell };
    run.acts.push(act);
    run.succ += 1;
    settle(run);
    return act;
  }
  if (effect === "dc2") run.boosts[actor] = { dc: 2, spell: req.spell };
  else if (effect === "adv") run.boosts[actor] = { adv: true, spell: req.spell };
  return { boost: effect };
}

/** The GM adds a success or failure that is nobody's roll. */
export function gmMark(run, success, note = "") {
  if (run.result) return null;
  const act = { stage: run.stage, actor: null, name: "GM", kind: "gm", approach: null, option: null, total: null, dc: null, success: !!success, note: str(note, 300) };
  run.acts.push(act);
  if (success) run.succ += 1; else run.fail += 1;
  settle(run);
  return act;
}

/**
 * The GM rules on something a character did that isn't one of the approaches: a success or failure
 * with the GM's note, as that character's act this stage. No skill is used up.
 */
export function gmOverride(run, actor, success, note = "") {
  if (!canAct(run, actor).ok) return null;
  const act = { stage: run.stage, actor, name: member(run, actor).name, kind: "gm", approach: null, option: null, total: null, dc: null, success: !!success, note: str(note, 300) };
  run.acts.push(act);
  delete run.requests[actor];
  delete run.boosts[actor];
  if (success) run.succ += 1; else run.fail += 1;
  settle(run);
  return act;
}

/** The GM moves a character on without a roll this stage. */
export function skipActor(run, actor) {
  if (!canAct(run, actor).ok) return null;
  const act = { stage: run.stage, actor, name: member(run, actor).name, kind: "skip", approach: null, option: null, total: null, dc: null, success: null, note: "" };
  run.acts.push(act);
  delete run.requests[actor];
  return act;
}

/** Whether every character has acted this stage. */
export const everyoneActed = (run) => run.party.every((p) => actedIn(run).has(p.id));

/** Whether the stage can end: always for the GM unless "everyone" is on and someone hasn't acted. */
export const canAdvance = (run) => !run.result && (!run.rules.everyone || everyoneActed(run));

/** The ending from the counts when the challenge runs out of stages (or the GM ends it early). */
export function endingFor(run) {
  if (run.succ >= run.goal.succ) return "full";
  if (run.fail >= run.goal.fail) return "fail";
  return run.succ >= run.goal.partial && run.goal.partial > 0 ? "partial" : "fail";
}

/** On to the next stage, or the ending after the last. */
export function nextStage(run) {
  if (run.result) return run;
  run.requests = {}; run.boosts = {}; run.calls = [];
  if (run.stage >= run.stages.length - 1) { run.result = endingFor(run); return run; }
  run.stage += 1;
  return run;
}

/** End now, from the counts so far. */
export function endEarly(run) {
  if (!run.result) run.result = endingFor(run);
  return run;
}

/** Each character's contribution, for the ending: [{ id, name, marks: "✓✗", spells: [name] }]. */
export function contributions(run) {
  return run.party.map((p) => {
    const mine = run.acts.filter((a) => a.actor === p.id && a.kind !== "skip");
    return { id: p.id, name: p.name, marks: mine.map((a) => (a.success ? "✓" : "✗")).join(""), spells: mine.filter((a) => a.kind === "spell").map((a) => a.note), others: mine.filter((a) => a.kind === "gm" && a.note).map((a) => a.note) };
  });
}
