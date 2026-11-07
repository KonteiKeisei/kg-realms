// The harvest window (0.96): one harvest session, for the GM. Every downed creature on the scene, and
// any dropped in from a compendium; the party on the left (the party token's members and the
// characters with tokens on the scene, each once), dragged onto creatures (the first leads, a second
// helps by the leader rule). Each part is its own check.
//
// Request rolls sends each player their checks (their own Harvest checks panel, each roll with its
// bonus); the GM rolls for anyone with no player online. With every roll in, Harvest gives the leader
// the parts, moves the clock on by the longest share (the party stays put), and logs it in the window,
// a chat card and the Harvests journal. A practice run rolls everything quietly here and changes
// nothing. Closing the window ends the session.
import { shellHead, shellTabs, movable, placeKept, isLocked, toggleLocked, applyMin } from "../ui-shell.mjs";
import { uiBounds } from "../ui-editbar.mjs";
import { ruleTooltip, ruleParagraphs } from "../travel-rules.mjs";
import { sceneParties, groupMembers } from "../party-groups.mjs";
import { creatureProfile, partsFor, dcFor, harvestCheck, harvestYield, rollAmount, diceText, coins, minutesText, workMinutes, tierOf, SIZES, PARTS, DEFAULT_DCS, HARVEST_SKILLS, TIERS } from "./catalog.mjs";
import { giveYield } from "./items.mjs";

const MODULE_ID = "kg-realms";
export const HARVEST_SOCKET = `module.${MODULE_ID}`;
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const rule = (t) => ruleTooltip(t);
const setting = (k) => { try { return game.settings.get(MODULE_ID, k); } catch { return undefined; } };
const skillMod = (actor, k) => Number(actor?.system?.skills?.[k]?.total ?? actor?.system?.skills?.[k]?.mod ?? 0) || 0;
const signed = (n) => `${n >= 0 ? "+" : ""}${n}`;
const first = (name) => String(name ?? "?").split(" ")[0];
const SHORT = { sur: "Sur", med: "Med", slt: "Sle" };
/** Whether players see the DCs of the checks they are asked for (the world's Show Perception DC). */
const showDC = () => setting("showPerceptionDC") !== false;
/** The players who would roll for an actor: active, not GMs, owners. */
const playersOf = (actor) => Array.from(game.users ?? []).filter((u) => u.active && !u.isGM && actor?.testUserPermission?.(u, "OWNER"));

export const HARVEST_RULES = {
  who: ruleParagraphs([["Who", "The party token's members and the characters with a token on this scene, each once. Drag a player onto a creature: the first one leads and makes every check. One more can help."], ["Help", "The helper rolls too, against their own DC. A success adds 1 to the leader's roll; a failure takes 1 off."], ["Gets the parts", "The leader. Players stay in this list, free to work on other creatures."]]),
  harvest: ruleParagraphs([["Checks", "One check for each part: Survival, Medicine or Sleight of Hand."], ["Success", "The part, in the amount rolled."], ["Failure", "Nothing, and the part can be tried again. Fail by 5 or more and it is ruined."], ["Meat", "A knife can't make meat inedible. A failed meat check still gives a quarter of it, rounded down, as mangled meat: edible and good for rations, but nobody buys it."], ["Downed", "A creature at 0 hit points, dead or defeated."]]),
  dc: ruleParagraphs([["DC", "Base DC + half the creature's CR, rounded down + the part's difficulty."], ["Skill", "Survival takes 4 off the DC, Medicine 2, Sleight of Hand nothing."], ["GM", "The DCs tab changes the base DC, what each skill takes off, and every part's difficulty, for this world."]]),
  rarity: ruleParagraphs([["Rarity", "By the creature's CR. Common 0 to 1, uncommon 2 to 4, rare 5 to 10, very rare 11 to 16, legendary 17 or more."], ["Value", "Each rarity is worth more: ×1, ×2, ×5, ×15 and ×40. The world's Prices setting applies too."], ["Stacking", "Items are named by rarity and kind, never by the creature, so like stacks with like."]]),
  time: ruleParagraphs([["Time", "Each part takes time by the creature's size: Tiny 5 minutes, Small 10, Medium 20, Large 40, Huge 80, Gargantuan 120. Meat and hide take twice as long."], ["Together", "Players work at the same time, so the clock moves on by the longest share. A helper adds no time."], ["Travel", "The party stays where it is while it harvests."]]),
  rolls: ruleParagraphs([["Request rolls", "Each player gets their checks in a Harvest checks panel, with their bonus on each roll. Their rolls post to the chat as usual."], ["No player online", "Roll for them here."], ["Harvest", "Once every roll is in. Nothing is given until then."]]),
  practice: ruleParagraphs([["Practice run", "Rolls every check quietly here, without asking the players, and shows the results in the Log tab only."], ["Nothing changes", "No chat card, no items, no time passes, no parts marked as taken, and nothing in the journal."]])
};

/** Whether a token's creature is down: 0 hit points, dead or defeated. NPCs only. */
export function isDowned(token) {
  const doc = token?.document ?? token, actor = doc?.actor;
  if (!actor || actor.type !== "npc") return false;
  const hp = actor.system?.attributes?.hp;
  if (hp && Number(hp.value) <= 0 && Number(hp.max) > 0) return true;
  if (actor.statuses?.has?.("dead") || doc.hasStatusEffect?.("dead")) return true;
  return !!game.combat?.combatants?.find((c) => c.tokenId === doc.id && c.defeated);
}

/** The party for a harvest on a scene: the party tokens' members and the player characters with a token there, each once. */
export function harvestParty(scene) {
  const out = new Map();
  const add = (a) => { const w = (a?.id && game.actors?.get?.(a.id)) || a; if (w?.id && w.type !== "group") out.set(w.id, w); };
  for (const t of sceneParties(scene)) groupMembers(t.actor).forEach(add);
  for (const t of Array.from(scene?.tokens ?? [])) if (t.actor?.type === "character" && t.actor.hasPlayerOwner) add(t.actor);
  return [...out.values()];
}

/**
 * A skill check with the system's own roll. chat: a chat card and the roll dialog, as any check
 * (dc on it when players may see it); else quiet. Returns the total, or null if the roller cancelled.
 */
export async function systemRoll(actor, skill, { dc = null, flavor = "Harvest", chat = true } = {}) {
  try {
    if (foundry.utils.isNewerVersion(game.system.version, "3.99")) {
      const r = await actor.rollSkill({ skill, ...(dc != null ? { target: dc } : {}) }, chat ? {} : { configure: false }, chat ? { data: { flavor } } : { create: false });
      const roll = Array.isArray(r) ? r[0] : r;
      return Number.isFinite(roll?.total) ? roll.total : null;
    }
    const roll = await actor.rollSkill(skill, chat ? { ...(dc != null ? { targetValue: dc } : {}), flavor } : { fastForward: true, chatMessage: false });
    return Number.isFinite(roll?.total) ? roll.total : null;
  } catch (err) {
    console.warn(`${MODULE_ID} | harvest: the system's skill roll failed, rolling d20 + bonus instead:`, err);
    const roll = await new Roll("1d20 + @mod", { mod: skillMod(actor, skill) }).evaluate();
    if (chat) await roll.toMessage({ flavor, speaker: ChatMessage.getSpeaker({ actor }) });
    return roll.total;
  }
}

export class HarvestWindow {
  constructor({ hud }) { this.hud = hud; this.el = null; }

  get dcs() {
    const s = setting("harvestDCs") ?? {};
    return { ...DEFAULT_DCS, ...s, parts: { ...DEFAULT_DCS.parts, ...(s.parts ?? {}) } };
  }
  get people() { return !!setting("harvestHumanoidMeat"); }
  get priceScale() { return Number(this.hud?.priceScale) || 1; }

  /** Open (or bring up) the window; a token to open on, from its token HUD. */
  async open(token = null) {
    if (!game.user.isGM) return;
    if (!this.el) this.#start();
    this.#scan();
    if (token) { const c = this.creatures.find((x) => x.tokenId === (token.document ?? token).id); if (c) this.openId = c.id; }
    this.tab = "creatures";
    this.render();
  }

  #start() {
    this.creatures = []; this.log = []; this.runs = []; this.tab = "creatures"; this.openId = null; this.practice = false; this.busy = false; this.request = null;
    this.sceneId = canvas.scene?.id ?? null;
    this.el = document.createElement("section");
    this.el.className = "kgr-ui kgr-panel kgr-harvest";
    document.body.append(this.el);
    movable(this.el, "harvest", { redock: () => this.#place() });
    this.el.addEventListener("click", (e) => this.#click(e));
    this.el.addEventListener("change", (e) => this.#change(e));
    this.el.addEventListener("dragstart", (e) => { const p = e.target.closest?.("[data-pc]"); if (p) { e.dataTransfer.setData("text/plain", JSON.stringify({ kgrHarvester: p.dataset.pc })); p.classList.add("dragging"); } });
    this.el.addEventListener("dragend", (e) => e.target.closest?.("[data-pc]")?.classList.remove("dragging"));
    this.el.addEventListener("dragover", (e) => { const t = e.target.closest?.("[data-drop]"); if (t) { e.preventDefault(); t.classList.add("hot"); } });
    this.el.addEventListener("dragleave", (e) => e.target.closest?.("[data-drop]")?.classList.remove("hot"));
    this.el.addEventListener("drop", (e) => this.#drop(e));
  }

  /** Closing ends the session (and any roll request): a new one starts on the next open. */
  close() {
    if (this.request) this.#endRequest();
    this.el?.remove(); this.el = null; this.creatures = []; this.log = []; this.runs = [];
  }

  /** The party on this scene: its party tokens' members and its player characters, each once. */
  party() { return harvestParty(canvas.scene); }

  /** Downed creatures on the scene not yet listed. Returns how many were added. */
  #scan() {
    const before = this.creatures.length;
    for (const t of canvas.tokens?.placeables ?? []) {
      if (!isDowned(t) || this.creatures.some((c) => c.tokenId === t.document.id)) continue;
      this.#add(t.actor, { tokenId: t.document.id, name: t.document.name, img: t.document.texture?.src, source: "on this scene" });
    }
    return this.creatures.length - before;
  }
  #newOnScene() { return (canvas.tokens?.placeables ?? []).filter((t) => isDowned(t) && !this.creatures.some((c) => c.tokenId === t.document.id)).length; }

  #add(actor, { tokenId = null, name = actor.name, img = actor.img, source }) {
    const profile = creatureProfile(actor);
    profile.name = actor.name;
    const id = foundry.utils.randomID();
    this.creatures.push({ id, tokenId, name, img, source, profile, crew: { leader: null, helper: null }, skip: new Set() });
    return id;
  }

  /** A creature's parts as they stand: each with whether it was already taken (on its token). */
  partsOf(c) {
    const taken = c.tokenId ? canvas.scene?.tokens.get(c.tokenId)?.getFlag(MODULE_ID, "harvested") ?? {} : {};
    const session = Object.fromEntries(this.log.filter((l) => !l.practice && l.creature === c.id).flatMap((l) => l.rows.filter((r) => r.outcome !== "nothing").map((r) => [r.part, r])));
    return partsFor(c.profile, { people: this.people, dcs: this.dcs }).map((p) => ({ ...p, taken: taken[p.key] ?? session[p.key] ?? null }));
  }
  /** The parts the leader will work on: picked and not yet taken. */
  workOf(c) { return this.partsOf(c).filter((p) => !p.taken && !c.skip.has(p.key)); }
  #ready() { return this.creatures.filter((c) => c.crew.leader && this.workOf(c).length); }

  /**
   * What a harvest would roll, fixed when the rolls are asked for: [{ cid, name, tokenId, lead: { id,
   * skill }, help, parts: [part + dcLead, dcHelp] }], and each check [{ id, cid, key, actor, skill, dc,
   * role, part, creature, total }].
   */
  #plan() {
    const plan = this.#ready().map((c) => {
      const lead = { ...c.crew.leader }, help = c.crew.helper ? { ...c.crew.helper } : null;
      return { cid: c.id, name: c.name, tokenId: c.tokenId, lead, help, parts: this.workOf(c).map((p) => ({ ...p, dcLead: dcFor(p, lead.skill, this.dcs), dcHelp: help ? dcFor(p, help.skill, this.dcs) : null })) };
    });
    const checks = plan.flatMap((c) => c.parts.flatMap((p) => [
      { id: `${c.cid}|${p.key}|lead`, cid: c.cid, key: p.key, actor: c.lead.id, skill: c.lead.skill, dc: p.dcLead, role: "leads", part: p.name, creature: c.name, total: null },
      ...(c.help ? [{ id: `${c.cid}|${p.key}|help`, cid: c.cid, key: p.key, actor: c.help.id, skill: c.help.skill, dc: p.dcHelp, role: "helps", part: p.name, creature: c.name, total: null }] : [])
    ]));
    return { plan, checks };
  }
  /** Each leader's share of the time, in minutes, for a plan: { actorId: minutes }. */
  #shares(plan) {
    const out = {};
    for (const c of plan) out[c.lead.id] = (out[c.lead.id] ?? 0) + workMinutes(c.parts);
    return out;
  }

  /* ------------------------------------------------------------------ render */

  render() {
    if (!this.el) return;
    const scene = game.scenes.get(this.sceneId);
    const tabs = shellTabs([["creatures", "Creatures", "fa-paw", this.creatures.length], ["log", "Log", "fa-scroll", this.runs.length || null], ["dcs", "DCs", "fa-sliders"]], this.tab);
    const body = this.tab === "log" ? this.#logTab() : this.tab === "dcs" ? this.#dcsTab() : this.#creaturesTab();
    this.el.innerHTML = shellHead({ icon: "fa-scissors", eyebrow: "Harvest", title: scene?.name ?? "Harvest", lock: { attr: 'data-act="lock"', on: isLocked("harvest") }, min: { attr: 'data-act="min"', on: !!this.min, title: this.min ? "Show the harvest" : "Minimise" }, close: { attr: 'data-act="close"', title: "Close: ends this harvest" } })
      + tabs + `<div class="hv-body">${body}</div>` + this.#pinned() + this.#foot();
    this.el.classList.toggle("locked", isLocked("harvest"));
    applyMin(this.el, this.min);
    this.#place();
  }

  #place() {
    if (!this.el || placeKept(this.el, "harvest")) return;
    const b = uiBounds((el) => el === this.el || this.el.contains(el));
    Object.assign(this.el.style, { left: `${Math.max(b.left + 12, (b.left + b.right) / 2 - 380)}px`, top: `${b.top + 12}px` });
  }

  #creaturesTab() {
    const party = this.party();
    const pcs = party.map((a) => `<div class="hv-pc" draggable="${this.request ? "false" : "true"}" data-pc="${a.id}"><span class="hv-grip" aria-hidden="true"><i class="fa-solid fa-grip-vertical"></i></span><img src="${esc(a.img)}" alt=""><div><b>${esc(a.name)}</b><small>${Object.keys(HARVEST_SKILLS).map((k) => `${SHORT[k]} ${signed(skillMod(a, k))}`).join(" · ")}</small>${playersOf(a).length ? "" : `<small class="hv-off">No player online: you roll</small>`}</div></div>`).join("")
      || `<p class="hint">No party on this scene. Put the party token, or the characters' tokens, on the scene.</p>`;
    const list = this.creatures.map((c) => this.#creature(c)).join("")
      || `<p class="hint">No downed creatures on this scene. A creature is downed at 0 hit points, or when it is dead or defeated.</p>`;
    return `<div class="hv-panes">
      <div class="hv-left"><div class="hv-cap">Party<span class="sp"></span>${rule(HARVEST_RULES.who)}</div>${pcs}
        <span class="hint">Drag a player onto a creature. The first leads, a second can help. Players stay here, free for other creatures.</span></div>
      <div class="hv-right"><div class="hv-cap">Downed creatures<span class="sp"></span>${rule(HARVEST_RULES.harvest)}</div>${list}
        ${this.request ? "" : `<div class="hv-drop" data-drop="compendium">Drop a creature from a compendium or the Actors sidebar here, for a kill off the map</div>`}</div>
    </div>`;
  }

  /** A check's state in the open request: its roll, or who it waits on. */
  #checkState(id) {
    const ch = this.request?.checks.find((x) => x.id === id);
    if (!ch) return "";
    if (ch.total != null) return `<b class="hv-rolled ${ch.total >= ch.dc ? "ok" : "no"}">${ch.total}</b>`;
    return `<small class="hv-wait">waiting</small>`;
  }

  #creature(c) {
    const open = this.openId === c.id, parts = this.partsOf(c), work = this.workOf(c), tier = tierOf(c.profile.cr), locked = !!this.request;
    const lead = c.crew.leader ? game.actors.get(c.crew.leader.id) : null, help = c.crew.helper ? game.actors.get(c.crew.helper.id) : null;
    const size = SIZES[c.profile.size]?.label ?? "Medium";
    const right = !parts.length ? `<b>Nothing to take</b>` : !lead ? `<b>Nobody yet</b>drop a player` : work.length ? `<b>${work.length} part${work.length === 1 ? "" : "s"}</b>about ${minutesText(workMinutes(work))} · ${esc(first(lead.name))} leads` : `<b>All taken</b>`;
    const head = `<div class="hv-row" data-act="fold" data-id="${c.id}" role="button" tabindex="0" aria-expanded="${open}"><img src="${esc(c.img)}" alt=""><div><b>${esc(c.name)}</b><small>${size} ${esc(c.profile.type || "creature")} · CR ${esc(c.profile.cr)} · ${esc(tier.label.toLowerCase())} · ${esc(c.source)}</small></div><div class="hv-r">${right}</div><i class="fa-solid fa-caret-${open ? "down" : "right"}" aria-hidden="true"></i></div>`;
    if (!open) return `<div class="hv-cr ${lead && work.length ? "ready" : ""}" data-drop="creature" data-id="${c.id}">${head}</div>`;
    const slot = (role, who, pick) => {
      if (!who) return `<div class="hv-slot empty">${role === "leader" ? "Drop the leader here" : "Drop a helper here"}</div>`;
      const opts = Object.entries(HARVEST_SKILLS).map(([k, s]) => { const off = s.off ? Number(this.dcs[s.off]) || 0 : 0; return `<option value="${k}" ${k === pick ? "selected" : ""}>${s.label} ${signed(skillMod(who, k))}${off ? ` (DC −${off})` : ""}</option>`; }).join("");
      return `<div class="hv-slot"><div class="hv-who"><img src="${esc(who.img)}" alt=""><b>${esc(who.name)}</b><span class="hv-role">${role === "leader" ? "Leads" : "Helps"}</span>${locked ? "" : `<button type="button" class="hv-x" data-act="unassign" data-id="${c.id}" data-role="${role}" aria-label="Take ${esc(who.name)} off"><i class="fa-solid fa-xmark"></i></button>`}</div>
        <select data-act="skill" data-id="${c.id}" data-role="${role}" aria-label="${esc(who.name)}'s skill" ${locked ? "disabled" : ""}>${opts}</select>${role === "helper" && lead ? `<span class="hint">Success: ${esc(first(lead.name))} +1. Failure: −1.</span>` : ""}</div>`;
    };
    const ls = c.crew.leader?.skill ?? "sur", hs = c.crew.helper?.skill;
    // Each roll with the roller's bonus for it, as on the watches.
    const bonus = (who, skill, dc, id) => who ? `<span class="hv-bon" title="${esc(who.name)}: ${HARVEST_SKILLS[skill].label} ${signed(skillMod(who, skill))} against DC ${dc}"><img src="${esc(who.img)}" alt="">${SHORT[skill]} ${signed(skillMod(who, skill))} <small>DC ${dc}</small>${id ? this.#checkState(id) : ""}</span>` : "";
    const rows = parts.map((p) => {
      const amount = p.perLb ? `${diceText(p.dice)} lb` : p.max > 1 && p.dice[1] > 1 ? `${diceText(p.dice)}, max ${p.max}` : String(p.max);
      const each = p.unitGp * this.priceScale, price = p.perLb ? `${coins(each)} a lb` : `${coins(each)} each`;
      const from = p.from ? `From ${esc(p.from)} · ` : "";
      const taken = p.taken ? `<small class="${p.taken.outcome === "ruined" ? "no" : "ok"}">${p.taken.outcome === "ruined" ? "Ruined" : `${p.taken.outcome === "mangled" ? "Mangled" : "Taken"}${p.taken.by ? ` by ${esc(p.taken.by)}` : ""}${p.taken.qty ? `: ${p.taken.qty}${p.perLb ? " lb" : ""}` : ""}`}</small>` : `<small>${from}${price}</small>`;
      const doing = !p.taken && !c.skip.has(p.key);
      const rolls = doing && lead ? `<span class="hv-rolls">${bonus(lead, ls, dcFor(p, ls, this.dcs), locked && `${c.id}|${p.key}|lead`)}${help ? bonus(help, hs, dcFor(p, hs, this.dcs), locked && `${c.id}|${p.key}|help`) : ""}</span>` : `<span class="hv-dc">${p.taken ? "" : `DC ${dcFor(p, ls, this.dcs)}`}</span>`;
      return `<label class="hv-pt"><input type="checkbox" data-act="pick" data-id="${c.id}" data-key="${esc(p.key)}" ${p.taken || locked ? "disabled" : ""} ${!p.taken && !c.skip.has(p.key) ? "checked" : ""} aria-label="${esc(p.name)}"><div>${esc(p.name)} ${taken}</div>${rolls}<span class="hv-tm">${p.taken ? "" : minutesText(p.minutes)}</span><span class="hv-amt">${p.taken ? "done" : amount}</span></label>`;
    }).join("") || `<p class="hint">This creature gives nothing to harvest${c.profile.type === "humanoid" || c.profile.type === "giant" ? ". Eating humanoids and giants is off in the module settings" : ""}.</p>`;
    return `<div class="hv-cr open ${lead && work.length ? "ready" : ""}" data-drop="creature" data-id="${c.id}">${head}
      <div class="hv-crew">${slot("leader", lead, c.crew.leader?.skill)}${slot("helper", help, c.crew.helper?.skill)}</div>
      <div class="hv-det"><div class="hv-cap">Parts<span class="sp"></span>${rule(HARVEST_RULES.dc)}${rule(HARVEST_RULES.rarity)}</div>${rows}
      ${c.source !== "on this scene" && !locked ? `<button type="button" class="hv-link" data-act="remove" data-id="${c.id}">Take off the list</button>` : ""}</div></div>`;
  }

  #logTab() {
    if (!this.runs.length) return `<p class="hint">Nothing harvested yet. Each harvest and practice run is logged here, for this session.</p>`;
    const one = (l) => `<div class="hv-cap">${esc(l.name)} · ${esc(l.leader)} leads${l.helper ? `, ${esc(l.helper)} helps` : ""}</div>
      <table class="hv-table"><thead><tr><th>Part</th><th>Roll</th><th>DC</th><th>Got</th></tr></thead><tbody>${l.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.roll}${r.helped ? ` (${r.helped > 0 ? "+1" : "−1"})` : ""}</td><td>${r.dc}</td><td class="${r.outcome === "got" ? "ok" : r.outcome === "ruined" ? "no" : ""}">${esc(this.#outcomeText(r))}</td></tr>`).join("")}</tbody></table>`;
    // Newest run first; its creatures in the order they were harvested.
    return [...this.runs].reverse().map((run) => `<div class="hv-run"><div class="hv-run-head">${run.practice ? `<span class="hv-practice">Practice run</span>` : `<b>Harvest</b>`}<small>${esc(run.when)} · took ${minutesText(run.minutes)}${run.practice ? " (no time passed)" : ""} · worth ${coins(run.gp)}</small></div>${run.entries.map(one).join("")}</div>`).join("");
  }
  #outcomeText(r) {
    const unit = r.perLb ? " lb" : "";
    if (r.outcome === "got") return `${r.qty}${unit}, ${coins(r.gp)}`;
    if (r.outcome === "mangled") return `${r.cut}: ${r.qty}${unit}, cannot be sold`;
    if (r.outcome === "ruined") return "Ruined";
    return r.kind === "meat" || r.kind === "greens" ? "Too little left to keep" : `Failed by ${r.dc - r.roll}: nothing`;
  }

  #dcsTab() {
    const d = this.dcs, num = (attr, v, label) => `<input type="number" ${attr} value="${esc(v)}" min="-10" max="40" aria-label="${esc(label)}">`;
    const groups = [["meat", "Meat"], ["greens", "Wild greens"], ...Object.keys(PARTS).filter((k) => !["meat", "greens"].includes(k)).map((k) => [k, PARTS[k].label.charAt(0).toUpperCase() + PARTS[k].label.slice(1)])];
    const was = (k) => Number(d.parts[k]) !== PARTS[k].diff ? `<span class="hv-changed">was ${PARTS[k].diff}</span>` : "";
    return `<div class="hv-cap">The DC<span class="sp"></span>${rule(HARVEST_RULES.dc)}</div><p class="hint">Base + half the creature's CR + the part's difficulty. Survival takes ${d.survival} off, Medicine ${d.medicine}.</p>
      <table class="hv-table"><thead><tr><th>Setting</th><th>Value</th></tr></thead><tbody>
        <tr><td>Base DC</td><td>${num('data-dc="base"', d.base, "Base DC")}</td></tr>
        <tr><td>Survival takes off</td><td>${num('data-dc="survival"', d.survival, "Survival")}</td></tr>
        <tr><td>Medicine takes off</td><td>${num('data-dc="medicine"', d.medicine, "Medicine")}</td></tr></tbody></table>
      <div class="hv-cap">Each part's difficulty</div>
      <table class="hv-table"><thead><tr><th>Part</th><th>Difficulty</th></tr></thead><tbody>${groups.map(([k, l]) => `<tr><td>${esc(l)}</td><td>${num(`data-part="${k}"`, d.parts[k], l)} ${was(k)}</td></tr>`).join("")}</tbody></table>
      <div class="hv-cap">Rarity by CR<span class="sp"></span>${rule(HARVEST_RULES.rarity)}</div><p class="hint">${TIERS.map((t) => `${t.label} ×${t.mult}`).join(" · ")}. These stay fixed for now.</p>`;
  }

  /** What happens now, and the one main button. */
  #pinned() {
    if (this.tab === "dcs") return `<div class="hv-pin"><p class="hv-tell">Changes apply to every harvest in this world.</p><button type="button" class="primary" data-act="save-dcs" ${this.request ? "disabled" : ""}>Save DCs</button></div>`;
    if (this.request) return this.#pinnedRequest();
    const { plan, checks } = this.#plan(), shares = this.#shares(plan), names = Object.entries(shares).filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1]);
    const by = names.map(([id]) => first(game.actors.get(id)?.name));
    const practice = `<label class="hv-practice-box"><input type="checkbox" data-act="practice" ${this.practice ? "checked" : ""}> Practice run ${rule(HARVEST_RULES.practice)}</label>`;
    if (!plan.length) {
      return `<div class="hv-pin"><div class="hv-pos"><b>${this.runs.length ? "Harvest done" : "Nobody on a creature yet"}</b><span class="sp"></span>${practice}</div><p class="hv-tell">${this.runs.length ? "Closing the window ends this harvest. Drag players onto creatures to harvest more." : "Drag a player from the party onto a creature to lead its harvest."}</p><button type="button" class="primary" disabled>Request rolls</button></div>`;
    }
    const time = names.length ? `Takes about ${minutesText(names[0][1])}${by.length > 1 ? `, ${esc(by[0])}'s share` : ""}.` : "";
    const tell = this.practice ? `${time} A practice run rolls here, quietly. The results show in the Log tab only. Nothing is given or marked, nothing goes in the chat or the journal, and no time passes.` : `${time} Each player rolls their own checks. The clock moves on and the party stays here. ${rule(HARVEST_RULES.time)}`;
    const n = plan.length, label = this.practice ? `Practice run: ${n} creature${n === 1 ? "" : "s"}` : `Request ${checks.length} roll${checks.length === 1 ? "" : "s"}`;
    return `<div class="hv-pin"><div class="hv-pos"><b>${n} creature${n === 1 ? "" : "s"} ready</b><small>${checks.length} check${checks.length === 1 ? "" : "s"}</small><span class="sp"></span>${practice}${this.practice ? "" : rule(HARVEST_RULES.rolls)}</div>
      <p class="hv-tell">${tell}</p><button type="button" class="primary" data-act="${this.practice ? "practice-run" : "request"}" ${this.busy ? "disabled" : ""}>${this.busy ? "Rolling…" : label}</button></div>`;
  }

  /** While the players roll: who is still to roll, and Harvest once every roll is in. */
  #pinnedRequest() {
    const r = this.request, left = r.checks.filter((c) => c.total == null), n = r.plan.length;
    const people = [...new Set(r.checks.map((c) => c.actor))].map((id) => {
      const a = game.actors.get(id), mine = r.checks.filter((c) => c.actor === id), todo = mine.filter((c) => c.total == null).length;
      const who = playersOf(a);
      return `<span class="hv-person ${todo ? "" : "done"}"><img src="${esc(a?.img)}" alt=""><b>${esc(first(a?.name))}</b><small>${todo ? `${todo} of ${mine.length} to roll${who.length ? ` · ${esc(who.map((u) => u.name).join(", "))}` : " · no player online"}` : "all rolled"}</small>${todo ? `<button type="button" data-act="roll-for" data-actor="${id}">Roll for them</button>` : ""}</span>`;
    }).join("");
    const minutes = Math.max(0, ...Object.values(this.#shares(r.plan)));
    return `<div class="hv-pin"><div class="hv-pos"><b>${left.length ? `Waiting for rolls: ${r.checks.length - left.length} of ${r.checks.length} in` : "Every roll is in"}</b><span class="sp"></span>${rule(HARVEST_RULES.rolls)}</div>
      <div class="hv-people">${people}</div>
      <p class="hv-tell">${left.length ? "Each player rolls from their Harvest checks panel. Roll for anyone who can't." : `Takes about ${minutesText(minutes)}. The clock moves on and the party stays here.`}</p>
      <button type="button" class="primary" data-act="finish" ${left.length || this.busy ? "disabled" : ""}>${this.busy ? "Harvesting…" : `Harvest ${n} creature${n === 1 ? "" : "s"}`}</button></div>`;
  }

  #foot() {
    if (this.tab === "dcs") return `<div class="kgr-sh-foot"><button type="button" data-act="reset-dcs" ${this.request ? "disabled" : ""}>Reset to defaults</button></div>`;
    if (this.request) return `<div class="kgr-sh-foot"><button type="button" data-act="cancel-request">Cancel the rolls</button><span class="kgr-sh-sp"></span></div>`;
    const fresh = this.#newOnScene();
    return `<div class="kgr-sh-foot"><span class="kgr-sh-sp"></span><button type="button" data-act="scan" ${fresh ? "" : "disabled"}>Add downed creatures${fresh ? ` (${fresh} new)` : ""}</button></div>`;
  }

  /* ------------------------------------------------------------------ input */

  async #click(ev) {
    const b = ev.target.closest("[data-act]");
    if (b?.tagName === "INPUT" || b?.tagName === "SELECT" || ev.target.closest(".kgr-rule")) return;
    const tab = ev.target.closest("[data-tab]");
    if (tab) { this.tab = tab.dataset.tab; return this.render(); }
    if (!b) return;
    const act = b.dataset.act, c = this.creatures.find((x) => x.id === b.dataset.id);
    if (act === "close") return this.close();
    if (act === "lock") { await toggleLocked("harvest"); return this.render(); }
    if (act === "min") { this.min = !this.min; return this.render(); }
    if (act === "fold" && c) { this.openId = this.openId === c.id ? null : c.id; return this.render(); }
    if (this.#lockedOut(act)) return;
    if (act === "unassign" && c) { if (b.dataset.role === "leader") { c.crew.leader = c.crew.helper; c.crew.helper = null; } else c.crew.helper = null; return this.render(); }
    if (act === "remove" && c) { this.creatures = this.creatures.filter((x) => x !== c); return this.render(); }
    if (act === "scan") { this.#scan(); return this.render(); }
    if (act === "practice-run") return this.#practiceRun();
    if (act === "request") return this.#request();
    if (act === "roll-for") return this.#rollFor(b.dataset.actor);
    if (act === "cancel-request") { this.#endRequest(); ui.notifications.info("KG Realms: the harvest rolls were called off. Nothing was harvested."); return this.render(); }
    if (act === "finish") return this.#finish();
    if (act === "save-dcs") return this.#saveDcs();
    if (act === "reset-dcs") { await game.settings.set(MODULE_ID, "harvestDCs", {}); ui.notifications.info("KG Realms: harvest DCs are back to their defaults."); return this.render(); }
  }

  /** While the rolls are out, who harvests what is fixed. */
  #lockedOut(act) {
    if (!this.request || !["unassign", "remove", "skill", "pick", "assign", "add", "practice", "save-dcs", "reset-dcs"].includes(act)) return false;
    ui.notifications.warn("KG Realms: the rolls are out. Cancel the rolls to change who harvests what.");
    return true;
  }

  #change(ev) {
    const t = ev.target, c = this.creatures.find((x) => x.id === t.dataset.id);
    if (this.#lockedOut(t.dataset.act)) return this.render();
    if (t.dataset.act === "practice") { this.practice = t.checked; return this.render(); }
    if (t.dataset.act === "skill" && c?.crew[t.dataset.role]) { c.crew[t.dataset.role].skill = t.value; return this.render(); }
    if (t.dataset.act === "pick" && c) { if (t.checked) c.skip.delete(t.dataset.key); else c.skip.add(t.dataset.key); return this.render(); }
  }

  async #saveDcs() {
    const n = (v, d) => (Number.isFinite(Number(v)) && String(v).trim() !== "" ? Number(v) : d);
    const d = this.dcs, out = { base: d.base, survival: d.survival, medicine: d.medicine, parts: { ...d.parts } };
    for (const i of this.el.querySelectorAll("[data-dc]")) out[i.dataset.dc] = n(i.value, d[i.dataset.dc]);
    for (const i of this.el.querySelectorAll("[data-part]")) out.parts[i.dataset.part] = n(i.value, d.parts[i.dataset.part]);
    await game.settings.set(MODULE_ID, "harvestDCs", out);
    ui.notifications.info("KG Realms: harvest DCs saved.");
    this.render();
  }

  /** The best skill for an actor on this harvest: the highest bonus once the DC's adjustment is added. */
  #bestSkill(actor) {
    const d = this.dcs;
    return Object.entries(HARVEST_SKILLS).map(([k, s]) => [k, skillMod(actor, k) + (s.off ? Number(d[s.off]) || 0 : 0)]).sort((a, b) => b[1] - a[1])[0][0];
  }

  async #drop(ev) {
    const zone = ev.target.closest?.("[data-drop]");
    if (!zone) return;
    ev.preventDefault();
    zone.classList.remove("hot");
    let data = null;
    try { data = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch { data = null; }
    if (this.#lockedOut(data?.kgrHarvester ? "assign" : "add")) return;
    // A player onto a creature.
    if (data?.kgrHarvester) {
      const c = this.creatures.find((x) => x.id === zone.dataset.id), actor = game.actors.get(data.kgrHarvester);
      if (!c || !actor) return ui.notifications.warn("KG Realms: drop the player onto a creature in the list.");
      if (c.crew.leader?.id === actor.id || c.crew.helper?.id === actor.id) return;
      const slot = { id: actor.id, skill: this.#bestSkill(actor) };
      if (!c.crew.leader) c.crew.leader = slot;
      else if (!c.crew.helper) c.crew.helper = slot;
      else return ui.notifications.warn(`KG Realms: ${c.name} already has a leader and a helper. Take one off first.`);
      this.openId = c.id;
      return this.render();
    }
    // A creature from a compendium or the Actors sidebar.
    if (data?.type === "Actor" && data.uuid) {
      const actor = await fromUuid(data.uuid).catch(() => null);
      if (!actor) return ui.notifications.error("KG Realms: that creature could not be loaded.");
      if (actor.type !== "npc") return ui.notifications.warn("KG Realms: only creatures (NPCs) can be harvested.");
      this.openId = this.#add(actor, { source: data.uuid.startsWith("Compendium.") ? "from a compendium" : "from the Actors sidebar" });
      return this.render();
    }
    ui.notifications.warn("KG Realms: drop a creature (an Actor) or a player from the party here.");
  }

  /* ------------------------------------------------------------------ the rolls */

  /** Ask the players for their checks: each gets their own in a Harvest checks panel. */
  async #request() {
    const { plan, checks } = this.#plan();
    if (!plan.length) return;
    this.request = { session: foundry.utils.randomID(), plan, checks };
    this.#emitAsk();
    const offline = [...new Set(checks.map((c) => c.actor))].filter((id) => !playersOf(game.actors.get(id)).length).map((id) => first(game.actors.get(id)?.name));
    ui.notifications.info(`KG Realms: harvest rolls sent to the players.${offline.length ? ` No player online for ${offline.join(", ")}: roll for them in the harvest window.` : ""}`);
    this.render();
  }
  /** (Again, for a player who reloads: their panel comes back with what they still have to roll.) */
  #emitAsk() {
    const r = this.request;
    if (!r) return;
    const dc = showDC();
    game.socket.emit(HARVEST_SOCKET, { type: "harvest-ask", session: r.session, gm: game.user.id, scene: game.scenes.get(this.sceneId)?.name ?? "", checks: r.checks.filter((c) => c.total == null).map((c) => ({ id: c.id, actor: c.actor, skill: c.skill, dc: dc ? c.dc : null, role: c.role, part: c.part, creature: c.creature })) });
  }
  #endRequest() {
    if (this.request) game.socket.emit(HARVEST_SOCKET, { type: "harvest-close", session: this.request.session });
    this.request = null;
  }

  /** A message from a player: a roll in this request (from a user who owns the actor), or a request to be asked again. */
  receive(m, userId) {
    const r = this.request;
    if (!r) return;
    if (m?.type === "harvest-again") return this.#emitAsk();
    if (m?.type !== "harvest-roll" || m.session !== r.session) return;
    const user = game.users.get(userId ?? m.user);
    const ch = r.checks.find((c) => c.id === m.id), actor = ch ? game.actors.get(ch.actor) : null;
    if (!ch || ch.total != null || !Number.isFinite(m.total) || !actor || !user || !actor.testUserPermission(user, "OWNER")) return;
    ch.total = m.total;
    this.render();
  }

  /** The GM rolls a player's remaining checks (no player online, or they can't), with the system's cards. */
  async #rollFor(actorId) {
    const r = this.request, actor = game.actors.get(actorId);
    if (!r || !actor || this.busy) return;
    this.busy = true; this.render();
    try {
      for (const ch of r.checks.filter((c) => c.actor === actorId && c.total == null)) {
        const total = await systemRoll(actor, ch.skill, { dc: ch.dc, flavor: `Harvest: ${ch.part} (${ch.creature}), ${HARVEST_SKILLS[ch.skill].label}` });
        if (total == null) break;
        ch.total = total;
      }
      game.socket.emit(HARVEST_SOCKET, { type: "harvest-rolled", session: r.session, done: r.checks.filter((c) => c.total != null).map((c) => c.id) });
    } finally { this.busy = false; this.render(); }
  }

  /** Every roll in: the parts, the clock and the log. */
  async #finish() {
    const r = this.request;
    if (!r || r.checks.some((c) => c.total == null) || this.busy) return;
    this.busy = true; this.render();
    try {
      const totals = Object.fromEntries(r.checks.map((c) => [c.id, c.total]));
      await this.#resolve(r.plan, (id) => totals[id], false);
      this.#endRequest();
      this.tab = "log";
    } catch (err) {
      console.error(`${MODULE_ID} | harvest failed:`, err);
      ui.notifications.error(`KG Realms: the harvest failed: ${err.message}. See the console (F12).`);
    } finally { this.busy = false; this.render(); }
  }

  /** A practice run: every check rolled quietly here, nothing applied. */
  async #practiceRun() {
    if (this.busy) return;
    const { plan, checks } = this.#plan();
    if (!plan.length) return;
    this.busy = true; this.render();
    try {
      const totals = {};
      for (const ch of checks) totals[ch.id] = await systemRoll(game.actors.get(ch.actor), ch.skill, { chat: false });
      await this.#resolve(plan, (id) => totals[id], true);
      this.tab = "log";
    } catch (err) {
      console.error(`${MODULE_ID} | practice harvest failed:`, err);
      ui.notifications.error(`KG Realms: the practice run failed: ${err.message}. See the console (F12).`);
    } finally { this.busy = false; this.render(); }
  }

  /** Work out a harvest from its rolls (totalOf(checkId)); a real one gives, marks, logs and moves the clock. */
  async #resolve(plan, totalOf, practice) {
    const at = game.time.worldTime, entries = [];
    for (const c of plan) {
      const lead = game.actors.get(c.lead.id), help = c.help ? game.actors.get(c.help.id) : null;
      if (!lead) throw new Error(`${c.name}'s leader is no longer in the world`);
      const rows = c.parts.map((p) => {
        const helpRoll = help ? { total: totalOf(`${c.cid}|${p.key}|help`), dc: p.dcHelp } : null;
        const check = harvestCheck(totalOf(`${c.cid}|${p.key}|lead`), helpRoll, p.dcLead), y = harvestYield(p, check, rollAmount(p.dice));
        return { part: p.key, kind: p.part, name: p.name, perLb: p.perLb, roll: check.total, helped: check.helped, dc: p.dcLead, outcome: y.outcome, qty: y.qty, cut: y.name, gp: y.qty * y.unitGp * this.priceScale, yield: { ...y, part: p.part, unitGp: y.unitGp * this.priceScale, at }, by: lead.name };
      });
      entries.push({ creature: c.cid, tokenId: c.tokenId, name: c.name, leader: lead.name, helper: help?.name ?? null, leadActor: lead, rows, minutes: workMinutes(c.parts), practice });
    }
    const seconds = Math.max(0, ...Object.values(this.#shares(plan))) * 60, when = this.hud?.dateText?.(at) ?? "";
    if (!practice) await this.#apply(entries, seconds);
    for (const e of entries) { delete e.leadActor; this.log.push(e); }
    this.runs.push({ practice, when, minutes: seconds / 60, entries, gp: entries.reduce((s, e) => s + e.rows.reduce((t, r) => t + (r.outcome === "got" ? r.gp : 0), 0), 0) });
  }

  /** A real harvest: the parts to each leader, the parts marked on the tokens, the card, the journal, the clock. */
  async #apply(entries, seconds) {
    for (const e of entries) {
      for (const r of e.rows) if (r.qty) await giveYield(e.leadActor, r.yield);
      const token = e.tokenId ? canvas.scene?.tokens.get(e.tokenId) : null;
      const marks = Object.fromEntries(e.rows.filter((r) => r.outcome !== "nothing").map((r) => [r.part, { outcome: r.outcome, qty: r.qty, by: r.by }]));
      if (token && Object.keys(marks).length) await token.setFlag(MODULE_ID, "harvested", { ...(token.getFlag(MODULE_ID, "harvested") ?? {}), ...marks });
    }
    const html = this.#report(entries, seconds);
    await ChatMessage.create({ content: html, speaker: { alias: "Harvest" }, whisper: game.users.filter((u) => u.isGM).map((u) => u.id) });
    await this.#journal(html).catch((err) => { console.warn(`${MODULE_ID} | harvest journal:`, err); ui.notifications.warn("KG Realms: the harvest is done, but the Harvests journal could not be written. See the console (F12)."); });
    if (seconds > 0) {
      await this.hud?.holdFor?.(seconds, "harvest");
      await game.time.advance(seconds);
    }
  }

  #report(entries, seconds) {
    const total = entries.reduce((s, e) => s + e.rows.reduce((t, r) => t + (r.outcome === "got" ? r.gp : 0), 0), 0);
    const one = (e) => `<p><b>${esc(e.name)}</b>: ${esc(e.leader)} leads${e.helper ? `, ${esc(e.helper)} helps` : ""}.</p><ul>${e.rows.map((r) => `<li>${esc(r.name)}: ${r.roll} against DC ${r.dc}. ${esc(this.#outcomeText(r))}.</li>`).join("")}</ul>`;
    return `<div class="kgr-harvest-card"><p><i class="fa-solid fa-scissors"></i> <b>Harvest</b>, ${esc(this.hud?.dateText?.(game.time.worldTime) ?? "")}. Took ${minutesText(seconds / 60)}, worth ${coins(total)}.</p>${entries.map(one).join("")}</div>`;
  }

  /** The Harvests journal: a page for each day, each harvest added to the day's page. */
  async #journal(html) {
    let entry = game.journal.find((j) => j.getFlag(MODULE_ID, "harvests"));
    if (!entry) entry = await JournalEntry.create({ name: "Harvests", flags: { [MODULE_ID]: { harvests: true } } });
    const day = this.hud?.dateText?.(game.time.worldTime, "dateLong") || `Day ${Math.floor(game.time.worldTime / 86400) + 1}`;
    const page = entry.pages.find((p) => p.name === day);
    if (page) return page.update({ "text.content": `${page.text?.content ?? ""}${html}` });
    return entry.createEmbeddedDocuments("JournalEntryPage", [{ name: day, type: "text", text: { content: html, format: 1 } }]);
  }
}

/**
 * A player's Harvest checks panel: the checks the GM asked of their characters, each with its bonus
 * (and DC, when players may see it). Each roll is the system's own, with its chat card; the total goes
 * to the GM. It closes when the GM harvests or calls the rolls off.
 */
export class HarvestChecks {
  constructor() { this.el = null; this.ask = null; }

  receive(m, userId) {
    if (game.user.isGM) return;
    if (m?.type === "harvest-ask") {
      const mine = (m.checks ?? []).filter((c) => game.actors.get(c.actor)?.isOwner);
      if (!mine.length) return;
      const kept = this.ask?.session === m.session ? this.ask.checks : [];
      this.ask = { session: m.session, gm: userId ?? m.gm, scene: m.scene, checks: mine.map((c) => kept.find((k) => k.id === c.id) ?? { ...c, total: null }) };
      if (!kept.length) ui.notifications.info("KG Realms: the GM asks for harvest checks.");
      return this.render();
    }
    if (!this.ask || m?.session !== this.ask.session) return;
    if (m.type === "harvest-close") return this.close();
    // The GM rolled some for us.
    if (m.type === "harvest-rolled") { for (const c of this.ask.checks) if (m.done?.includes(c.id) && c.total == null) c.total = "GM"; return this.render(); }
  }

  close() { this.el?.remove(); this.el = null; this.ask = null; }

  render() {
    if (!this.ask) return this.close();
    if (!this.el) {
      this.el = document.createElement("section");
      this.el.className = "kgr-ui kgr-panel kgr-harvest-checks";
      document.body.append(this.el);
      movable(this.el, "harvest-checks", { redock: () => this.#place() });
      this.el.addEventListener("click", (e) => this.#click(e));
    }
    const left = this.ask.checks.filter((c) => c.total == null);
    const rows = this.ask.checks.map((c) => {
      const a = game.actors.get(c.actor), bonus = skillMod(a, c.skill);
      const done = c.total != null;
      return `<div class="kgr-sh-row hv-ask ${done ? "on" : ""}"><img src="${esc(a?.img)}" alt=""><div class="kgr-sh-main"><b>${esc(c.part)}</b><small>${esc(first(a?.name))} ${esc(c.role)} · ${esc(c.creature)}</small></div>
        ${done ? `<span class="hv-rolled">${c.total === "GM" ? "GM rolled" : `Rolled ${c.total}`}</span>` : `<button type="button" data-act="roll" data-id="${esc(c.id)}"><i class="fa-solid fa-dice-d20"></i> ${esc(HARVEST_SKILLS[c.skill]?.label ?? c.skill)} (${signed(bonus)})${c.dc != null ? ` · DC ${c.dc}` : ""}</button>`}</div>`;
    }).join("");
    this.el.innerHTML = shellHead({ icon: "fa-scissors", eyebrow: "Harvest checks", title: this.ask.scene || "Harvest", lock: { attr: 'data-act="lock"', on: isLocked("harvest-checks") } })
      + `<div class="hv-body">${rows}</div><div class="hv-pin"><p class="hv-tell">${left.length ? `${left.length} check${left.length === 1 ? "" : "s"} to roll. Each one is the system's own roll, with its card in the chat.` : "All rolled. The GM finishes the harvest."}</p><button type="button" class="primary" data-act="roll-all" ${left.length && !this.busy ? "" : "disabled"}>${this.busy ? "Rolling…" : left.length ? `Roll all ${left.length}` : "Waiting for the GM"}</button></div>`;
    this.el.classList.toggle("locked", isLocked("harvest-checks"));
    this.#place();
  }

  #place() {
    if (!this.el || placeKept(this.el, "harvest-checks")) return;
    const b = uiBounds((el) => el === this.el || this.el.contains(el));
    Object.assign(this.el.style, { left: `${b.left + 12}px`, top: `${b.top + 12}px` });
  }

  async #click(ev) {
    const b = ev.target.closest("[data-act]");
    if (!b || this.busy) return;
    if (b.dataset.act === "lock") { await toggleLocked("harvest-checks"); return this.render(); }
    if (b.dataset.act === "roll") return this.#roll([this.ask.checks.find((c) => c.id === b.dataset.id)], true);
    if (b.dataset.act === "roll-all") return this.#roll(this.ask.checks.filter((c) => c.total == null), false);
  }

  /** Roll checks (dialog: the system's roll dialog for one; Roll all goes straight through) and send each total to the GM. */
  async #roll(list, dialog) {
    this.busy = true; this.render();
    try {
      for (const c of list) {
        if (!c || c.total != null) continue;
        const actor = game.actors.get(c.actor);
        if (!actor?.isOwner) continue;
        const flavor = `Harvest: ${c.part} (${c.creature}), ${HARVEST_SKILLS[c.skill]?.label ?? c.skill}`;
        const total = dialog ? await systemRoll(actor, c.skill, { dc: c.dc, flavor }) : await fastRoll(actor, c.skill, c.dc, flavor);
        if (total == null) break;
        c.total = total;
        game.socket.emit(HARVEST_SOCKET, { type: "harvest-roll", session: this.ask.session, id: c.id, total, user: game.user.id });
      }
    } catch (err) {
      console.error(`${MODULE_ID} | harvest check:`, err);
      ui.notifications.error(`KG Realms: the harvest check did not roll: ${err.message}`);
    } finally { this.busy = false; this.render(); }
  }

  /** On joining (or reloading) while the GM has rolls out: ask to be sent them again. */
  static askAgain() { game.socket.emit(HARVEST_SOCKET, { type: "harvest-again", session: null, user: game.user.id }); }
}

/** The system's roll with its chat card but no dialog (Roll all). */
async function fastRoll(actor, skill, dc, flavor) {
  try {
    if (foundry.utils.isNewerVersion(game.system.version, "3.99")) {
      const r = await actor.rollSkill({ skill, ...(dc != null ? { target: dc } : {}) }, { configure: false }, { data: { flavor } });
      const roll = Array.isArray(r) ? r[0] : r;
      return Number.isFinite(roll?.total) ? roll.total : null;
    }
    const roll = await actor.rollSkill(skill, { fastForward: true, ...(dc != null ? { targetValue: dc } : {}), flavor });
    return Number.isFinite(roll?.total) ? roll.total : null;
  } catch { return systemRoll(actor, skill, { dc, flavor }); }
}
