// Skill challenges (0.97.0): the GM's builder, on a theater or battlemap scene.
//
// One window per scene: Setup (name, hook, goal, rules), each stage (read-aloud text, approaches with
// their skills or checks and DC, spell shortcuts), and the three outcomes (text, then items, journals,
// damage with a save, exhaustion and time). Saved to the scene's flags as `challenge`. Import and
// Export move a challenge between scenes and worlds as a JSON file; an import's items and journals are
// kept by their links, and any this world doesn't have are named so the GM can drop in its own.
import { shellHead } from "../ui-shell.mjs";
import { movable, placeKept } from "../ui-shell.mjs";
import { RealmDialog } from "../ui-theme.mjs";
import {
  SKILLS, ABILITIES, SPELL_EFFECTS, STAGE_ENDS, RESULTS, optionLabel, blankStage, blankApproach, blankChallenge,
  normalizeChallenge, challengeProblems, exportChallenge, exportFileName, importChallenge, challengeLinks
} from "./model.mjs";

const ID = "kg-realms";
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const OPTION_GROUPS = [["Skills", Object.keys(SKILLS).map((k) => `skill:${k}`)], ["Ability checks", Object.keys(ABILITIES).map((k) => `check:${k}`)]];
const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];

/** The challenge kept on a scene, or null. */
export function sceneChallenge(scene) {
  const raw = scene?.getFlag?.(ID, "challenge");
  return raw ? normalizeChallenge(raw) : null;
}

/** Replace the scene's challenge (setFlag would merge into the old one and keep removed keys). */
export async function saveSceneChallenge(scene, challenge) {
  if (scene.getFlag(ID, "challenge") !== undefined) await scene.unsetFlag(ID, "challenge");
  await scene.setFlag(ID, "challenge", normalizeChallenge(challenge));
}

export class ChallengeBuilder {
  /** runner: the ChallengeRun (start, preview, active run). party(scene): the party's actors. */
  constructor({ runner, party }) {
    this.runner = runner; this.partyOf = party;
    this.el = null; this.scene = null; this.draft = null; this.view = "setup"; this.dirty = false; this.missing = new Set();
  }

  async open(scene) {
    if (!game.user.isGM || !scene) return;
    if (this.el && this.scene?.id === scene.id) return this.el.querySelector("header")?.focus?.();
    if (this.dirty && !(await this.#confirmDiscard())) return;
    this.scene = scene;
    this.draft = sceneChallenge(scene) ?? blankChallenge(`${scene.name}: skill challenge`);
    this.view = "setup"; this.dirty = false;
    this.render();
    this.#checkLinks();
  }

  close() { this.el?.remove(); this.el = null; this.scene = null; this.draft = null; this.dirty = false; }

  /* ---------------------------------------------------------------- the window */

  render() {
    if (!this.draft) return this.close();
    if (!this.el) {
      this.el = document.createElement("section");
      this.el.className = "kgr-ui kgr-panel kgr-challenge-builder";
      this.el.setAttribute("aria-label", "Skill challenge builder");
      this.el.addEventListener("click", (e) => { const b = e.target.closest("[data-cb]"); if (b) { e.preventDefault(); this.#click(b); } });
      this.el.addEventListener("input", (e) => this.#field(e.target, false));
      this.el.addEventListener("change", (e) => this.#field(e.target, true));
      this.el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.dataset?.cbSpell !== undefined) { e.preventDefault(); this.#addSpell(e.target); } });
      this.el.addEventListener("dragover", (e) => { if (e.target.closest("[data-cb-drop]")) e.preventDefault(); });
      this.el.addEventListener("drop", (e) => this.#drop(e));
      movable(this.el, "challenge-builder", { redock: () => this.#place() });
      document.body.append(this.el);
    }
    const scroll = this.el.querySelector(".cb-main")?.scrollTop ?? 0;
    this.el.innerHTML = this.#html();
    const main = this.el.querySelector(".cb-main");
    if (main) main.scrollTop = scroll;
    this.#place();
  }

  #place() { if (this.el && !placeKept(this.el, "challenge-builder")) Object.assign(this.el.style, { left: "", top: "" }); }

  #html() {
    const d = this.draft, running = this.runner.activeRun(this.scene);
    const nav = (key, label, sub) => `<button type="button" data-cb="view" data-view="${key}" class="cb-nav ${this.view === key ? "on" : ""}" aria-current="${this.view === key}"><b>${esc(label)}</b><small>${esc(sub)}</small></button>`;
    const range = (s) => { const dcs = s.approaches.map((a) => a.dc); return dcs.length ? (Math.min(...dcs) === Math.max(...dcs) ? `DC ${dcs[0]}` : `DC ${Math.min(...dcs)}–${Math.max(...dcs)}`) : "no approaches"; };
    const rail = `<nav class="cb-rail" aria-label="Challenge parts">
      <span class="cb-lbl">Challenge</span>${nav("setup", "Setup", `Goal ${d.goal.succ} before ${d.goal.fail}`)}
      <span class="cb-lbl">Stages</span>${d.stages.map((s, i) => nav(`stage:${i}`, s.title || `Stage ${i + 1}`, `${s.approaches.length} approach${s.approaches.length === 1 ? "" : "es"} · ${range(s)}${s.spells.length ? ` · ${s.spells.length} spell${s.spells.length === 1 ? "" : "s"}` : ""}`)).join("")}
      <button type="button" data-cb="add-stage" class="cb-add">+ Add stage</button>
      <span class="cb-lbl">Ending</span>${nav("end", "Outcomes", "Full, partial and failure")}
    </nav>`;
    let main;
    if (this.view === "end") main = this.#endHtml();
    else if (this.view.startsWith("stage:")) main = this.#stageHtml(Number(this.view.split(":")[1]));
    else main = this.#setupHtml();
    const problems = challengeProblems(d);
    const status = running ? `<span class="cb-status run"><i class="fa-solid fa-circle-play"></i> Running now: ${esc(running.name)}</span>`
      : problems.length ? `<span class="cb-status warn" title="${esc(problems.join("\n"))}"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(problems[0])}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ""}</span>`
      : `<span class="cb-status">${d.stages.length} stage${d.stages.length === 1 ? "" : "s"} · ${d.stages.reduce((n, s) => n + s.approaches.length, 0)} approaches · ${d.goal.succ} successes before ${d.goal.fail} failures${this.dirty ? " · unsaved changes" : ""}</span>`;
    return `${shellHead({ icon: "fa-dice-d20", eyebrow: "Skill challenge builder", title: d.name || "Skill challenge", close: { attr: 'data-cb="close"' }, extra: `<span class="cb-scene" title="Runs on this scene"><i class="fa-solid fa-image"></i> ${esc(this.scene?.name)}</span>` })}
      <div class="cb-grid">${rail}<div class="cb-main">${main}</div></div>
      <footer class="cb-foot">${status}
        <span class="cb-io">
          <button type="button" data-cb="import" title="Load a challenge from a .json file, replacing this one"><i class="fa-solid fa-file-import"></i> Import</button>
          <button type="button" data-cb="export" title="Save this challenge as a .json file"><i class="fa-solid fa-file-export"></i> Export</button>
          <input type="file" accept=".json,application/json" data-cb-file hidden>
        </span>
        <button type="button" data-cb="preview" ${problems.length || running ? "disabled" : ""} title="${running ? "Finish or close the running challenge first" : "Run through it as the GM, with a switch to the players' view: rolls are quiet and nothing is saved, posted or applied"}"><i class="fa-solid fa-flask"></i> Test this challenge</button>
        <button type="button" data-cb="save">Save</button>
        ${running ? `<button type="button" data-cb="open-run" class="primary">Open the running challenge</button>` : `<button type="button" data-cb="start" class="primary" ${problems.length ? "disabled" : ""}>Start challenge</button>`}
      </footer>`;
  }

  #setupHtml() {
    const d = this.draft;
    const rule = (k, title, hint) => `<label class="cb-rule"><input type="checkbox" data-f="rules.${k}" ${d.rules[k] ? "checked" : ""}><span><b>${title}</b><small>${hint}</small></span></label>`;
    return `<div class="cb-two">
        <label class="cb-field"><span class="cb-lbl">Name</span><input type="text" data-f="name" value="${esc(d.name)}"></label>
        <label class="cb-field"><span class="cb-lbl">A stage ends when</span><select data-f="stageEnd">${Object.entries(STAGE_ENDS).map(([k, v]) => `<option value="${k}" ${d.stageEnd === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
      </div>
      <label class="cb-field"><span class="cb-lbl">Hook · read aloud when it starts</span><textarea rows="4" data-f="hook">${esc(d.hook)}</textarea></label>
      <div class="cb-box"><span class="cb-lbl">Goal</span>
        <div class="cb-goal"><input type="number" min="1" max="50" data-f="goal.succ" value="${d.goal.succ}" aria-label="Successes needed"><span>successes before</span>
        <input type="number" min="1" max="50" data-f="goal.fail" value="${d.goal.fail}" aria-label="Failures allowed"><span>failures. Partial success from</span>
        <input type="number" min="0" max="50" data-f="goal.partial" value="${d.goal.partial}" aria-label="Partial success from"><span>successes when the last stage ends (0: none).</span></div>
      </div>
      <div class="cb-box"><span class="cb-lbl">Rules</span>
        ${rule("noRepeat", "No repeats", "A character can use each skill or check only once in the whole challenge.")}
        ${rule("spells", "Spells can count", "Players can ask for a spell to count; the stage's spell effect applies once the GM allows it.")}
        ${rule("showDC", "Show DCs to players", "Players see each approach's DC before they choose.")}
        ${rule("everyone", "Everyone must act", "A stage can't end until every character has acted or the GM has skipped them.")}
      </div>`;
  }

  #stageHtml(i) {
    const s = this.draft.stages[i];
    if (!s) { this.view = "setup"; return this.#setupHtml(); }
    const p = `stages.${i}`;
    const optionSelect = (j) => `<select data-cb-add-option="${i}.${j}" aria-label="Add a skill or check"><option value="">+ Add</option>${OPTION_GROUPS.map(([label, keys]) => `<optgroup label="${label}">${keys.filter((k) => !s.approaches[j].options.includes(k)).map((k) => `<option value="${k}">${esc(optionLabel(k))}</option>`).join("")}</optgroup>`).join("")}</select>`;
    const approaches = s.approaches.map((a, j) => `<div class="cb-appr">
        <div class="cb-opts">${a.options.map((o) => `<span class="cb-chip">${esc(optionLabel(o))}<button type="button" data-cb="del-option" data-at="${i}.${j}" data-option="${o}" aria-label="Remove ${esc(optionLabel(o))}">×</button></span>`).join("")}${optionSelect(j)}</div>
        <input type="number" min="1" max="40" data-f="${p}.approaches.${j}.dc" value="${a.dc}" aria-label="DC">
        <input type="text" data-f="${p}.approaches.${j}.text" value="${esc(a.text)}" placeholder="What it does in the scene" aria-label="What it does">
        <button type="button" data-cb="del-approach" data-at="${i}.${j}" class="cb-x" aria-label="Remove this approach">×</button>
      </div>`).join("");
    return `<div class="cb-two cb-stagehead">
        <label class="cb-field"><span class="cb-lbl">Stage title</span><input type="text" data-f="${p}.title" value="${esc(s.title)}"></label>
        <label class="cb-field"><span class="cb-lbl">Roughly</span><input type="text" data-f="${p}.time" value="${esc(s.time)}" placeholder="30 seconds"></label>
      </div>
      <label class="cb-field"><span class="cb-lbl">Read aloud when this stage starts</span><textarea rows="3" data-f="${p}.read">${esc(s.read)}</textarea></label>
      <div class="cb-apprs"><div class="cb-appr head"><span class="cb-lbl">Skills or checks (any one)</span><span class="cb-lbl">DC</span><span class="cb-lbl">What it does in the scene</span><span></span></div>${approaches}
        <button type="button" data-cb="add-approach" data-at="${i}" class="cb-add">+ Add approach</button></div>
      <div class="cb-box"><div class="cb-row"><span class="cb-lbl">Spell shortcuts</span><select data-f="${p}.spellEffect" aria-label="What an allowed spell does">${Object.entries(SPELL_EFFECTS).map(([k, v]) => `<option value="${k}" ${s.spellEffect === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></div>
        <div class="cb-opts">${s.spells.map((x, k) => `<span class="cb-chip"><i class="fa-solid fa-wand-sparkles"></i>${esc(x)}<button type="button" data-cb="del-spell" data-at="${i}.${k}" aria-label="Remove ${esc(x)}">×</button></span>`).join("")}
          <input type="text" data-cb-spell="${i}" placeholder="Add a spell, then Enter (or drop one)" aria-label="Add a spell" data-cb-drop="spell:${i}"></div>
        <input type="text" data-f="${p}.spellNote" value="${esc(s.spellNote)}" placeholder="A note for the GM (Plant Growth counts only against the briar)" aria-label="Spell note">
        <small class="cb-hint">Players can also ask for spells not listed here; the GM decides.</small></div>
      <div class="cb-stage-tools"><button type="button" data-cb="move-stage" data-at="${i}" data-by="-1" ${i === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-up"></i> Earlier</button>
        <button type="button" data-cb="move-stage" data-at="${i}" data-by="1" ${i === this.draft.stages.length - 1 ? "disabled" : ""}><i class="fa-solid fa-arrow-down"></i> Later</button>
        <button type="button" data-cb="del-stage" data-at="${i}" class="cb-danger" ${this.draft.stages.length === 1 ? "disabled" : ""}><i class="fa-solid fa-trash"></i> Remove stage</button></div>`;
  }

  #endHtml() {
    const d = this.draft;
    const when = { full: `${d.goal.succ} successes`, partial: d.goal.partial ? `${d.goal.partial}–${d.goal.succ - 1} successes at the end` : "off (partial 0)", fail: `${d.goal.fail} failures${d.goal.partial ? `, or under ${d.goal.partial} at the end` : ""}` };
    const effect = (k, e, j) => {
      const at = `${k}.${j}`, miss = e.uuid && this.missing.has(e.uuid) ? ` <span class="cb-miss" title="Not in this world: drop the right one onto this outcome, then remove this">not found</span>` : "";
      const del = `<button type="button" data-cb="del-effect" data-at="${at}" aria-label="Remove">×</button>`;
      const f = (name) => `outcomes.${k}.effects.${j}.${name}`;
      if (e.kind === "item") return `<span class="cb-chip effect"><i class="fa-solid fa-gem"></i>Item: ${esc(e.name)}${miss}${del}</span>`;
      if (e.kind === "journal") return `<span class="cb-chip effect"><i class="fa-solid fa-book-open"></i>Journal: ${esc(e.name)}${miss}${del}</span>`;
      if (e.kind === "damage") return `<span class="cb-chip effect edit"><i class="fa-solid fa-burst"></i>Damage <input type="text" data-f="${f("formula")}" value="${esc(e.formula)}" aria-label="Damage formula" size="7">
        <select data-f="${f("type")}" aria-label="Damage type">${DAMAGE_TYPES.map((t) => `<option ${t === e.type ? "selected" : ""}>${t}</option>`).join("")}</select>
        <select data-f="${f("save")}" aria-label="Save"><option value="">no save</option>${Object.entries(ABILITIES).map(([a, l]) => `<option value="${a}" ${a === e.save ? "selected" : ""}>${l} save</option>`).join("")}</select>
        ${e.save ? `DC <input type="number" min="1" max="40" data-f="${f("dc")}" value="${e.dc}" aria-label="Save DC"> for half` : ""}${del}</span>`;
      if (e.kind === "exhaustion") return `<span class="cb-chip effect edit"><i class="fa-solid fa-bed"></i>Exhaustion <input type="number" min="1" max="6" data-f="${f("levels")}" value="${e.levels}" aria-label="Exhaustion levels"> level${e.levels === 1 ? "" : "s"}${del}</span>`;
      if (e.kind === "time") return `<span class="cb-chip effect edit"><i class="fa-solid fa-clock"></i>Time +<input type="number" min="1" data-f="${f("hours")}" value="${e.hours}" aria-label="Hours"> hours${del}</span>`;
      return "";
    };
    return Object.entries(RESULTS).map(([k, title]) => `<div class="cb-outcome ${k}" data-cb-drop="outcome:${k}">
        <div class="cb-row"><b>${title}</b><span class="cb-chip">${esc(when[k])}</span></div>
        <textarea rows="3" data-f="outcomes.${k}.text" aria-label="${title}: what happens">${esc(d.outcomes[k].text)}</textarea>
        <div class="cb-opts"><span class="cb-lbl">Then</span>${d.outcomes[k].effects.map((e, j) => effect(k, e, j)).join("")}
          <button type="button" data-cb="add-effect" data-kind="damage" data-at="${k}">+ Damage</button>
          <button type="button" data-cb="add-effect" data-kind="exhaustion" data-at="${k}">+ Exhaustion</button>
          <button type="button" data-cb="add-effect" data-kind="time" data-at="${k}">+ Time</button>
          <span class="cb-hint">Drop items or journal entries here.</span></div>
      </div>`).join("");
  }

  /* ---------------------------------------------------------------- editing */

  #field(t, commit) {
    const path = t?.dataset?.f;
    if (path === undefined) {
      if (commit && t?.dataset?.cbAddOption) this.#addOption(t);
      if (commit && t?.dataset?.cbFile !== undefined) this.#importFile(t);
      return;
    }
    let v = t.type === "checkbox" ? t.checked : t.value;
    if (t.type === "number") v = Number(v);
    foundry.utils.setProperty(this.draft, path, v);
    this.dirty = true;
    // Structure or labels on the rail change: redraw (a select or checkbox, or leaving a text field).
    if (commit && (t.tagName === "SELECT" || t.type === "checkbox" || /title|name|goal|dc/.test(path))) { this.draft = normalizeChallenge(this.draft); this.render(); }
  }

  #addOption(sel) {
    const [i, j] = sel.dataset.cbAddOption.split(".").map(Number), a = this.draft.stages[i]?.approaches[j];
    if (a && sel.value && !a.options.includes(sel.value)) { a.options.push(sel.value); this.dirty = true; }
    this.render();
  }

  #addSpell(input) {
    const s = this.draft.stages[Number(input.dataset.cbSpell)], name = input.value.trim();
    if (s && name && !s.spells.includes(name)) { s.spells.push(name); this.dirty = true; }
    this.render();
    this.el.querySelector(`[data-cb-spell="${input.dataset.cbSpell}"]`)?.focus();
  }

  async #drop(e) {
    const zone = e.target.closest("[data-cb-drop]");
    if (!zone) return;
    e.preventDefault();
    let data;
    try { data = (foundry.applications?.ux?.TextEditor?.implementation ?? TextEditor).getDragEventData(e); } catch { return; }
    const [kind, at] = zone.dataset.cbDrop.split(":");
    const doc = data?.uuid ? await fromUuid(data.uuid) : null;
    if (kind === "spell") {
      const s = this.draft.stages[Number(at)];
      if (doc?.documentName === "Item" && s && !s.spells.includes(doc.name)) { s.spells.push(doc.name); this.dirty = true; this.render(); }
      return;
    }
    const outcome = this.draft.outcomes[at];
    if (!outcome || !doc) return;
    if (doc.documentName === "Item") outcome.effects.push({ kind: "item", uuid: doc.uuid, name: doc.name, img: doc.img });
    else if (doc.documentName === "JournalEntry" || doc.documentName === "JournalEntryPage") outcome.effects.push({ kind: "journal", uuid: doc.uuid, name: doc.name });
    else return ui.notifications.warn("KG Realms: drop an item or a journal entry onto an outcome.");
    this.missing.delete(doc.uuid);
    this.dirty = true;
    this.render();
  }

  async #click(b) {
    const d = this.draft, at = b.dataset.at;
    const [i, j] = String(at ?? "").split(".");
    switch (b.dataset.cb) {
      case "close": if (!this.dirty || await this.#confirmDiscard()) this.close(); return;
      case "view": this.view = b.dataset.view; return this.render();
      case "add-stage": d.stages.push(blankStage(d.stages.length + 1)); this.view = `stage:${d.stages.length - 1}`; break;
      case "del-stage": d.stages.splice(Number(i), 1); this.view = `stage:${Math.max(0, Number(i) - 1)}`; break;
      case "move-stage": { const from = Number(i), to = from + Number(b.dataset.by); if (to < 0 || to >= d.stages.length) return; [d.stages[from], d.stages[to]] = [d.stages[to], d.stages[from]]; this.view = `stage:${to}`; break; }
      case "add-approach": d.stages[Number(i)]?.approaches.push(blankApproach()); break;
      case "del-approach": d.stages[Number(i)]?.approaches.splice(Number(j), 1); break;
      case "del-option": { const a = d.stages[Number(i)]?.approaches[Number(j)]; if (a) a.options = a.options.filter((o) => o !== b.dataset.option); break; }
      case "del-spell": d.stages[Number(i)]?.spells.splice(Number(j), 1); break;
      case "add-effect": d.outcomes[at]?.effects.push(b.dataset.kind === "damage" ? { kind: "damage", formula: "2d6", type: "bludgeoning", save: "dex", dc: 15 } : b.dataset.kind === "exhaustion" ? { kind: "exhaustion", levels: 1 } : { kind: "time", hours: 8 }); break;
      case "del-effect": d.outcomes[i]?.effects.splice(Number(j), 1); break;
      case "import": return this.el.querySelector("[data-cb-file]")?.click();
      case "export": return this.#export();
      case "save": return this.#save();
      case "preview": return this.#test();
      case "start": return this.#start();
      case "open-run": return this.runner.show();
      default: return;
    }
    this.dirty = true;
    this.draft = normalizeChallenge(d);
    this.render();
  }

  /* ---------------------------------------------------------------- files, saving, starting */

  #export() {
    const file = exportChallenge(this.draft, { system: `${game.system.id} ${game.system.version}` });
    foundry.utils.saveDataToFile(JSON.stringify(file, null, 2), "application/json", exportFileName(this.draft));
  }

  async #importFile(input) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const { challenge, error } = importChallenge(await file.text());
    if (error) return ui.notifications.error(`KG Realms: ${error}`);
    const ok = await RealmDialog.confirm({ window: { title: "Import a skill challenge" }, content: `<p>Replace <b>${esc(this.draft.name)}</b> in this builder with <b>${esc(challenge.name)}</b> (${challenge.stages.length} stage${challenge.stages.length === 1 ? "" : "s"})?</p><p>Nothing is saved to the scene until you press Save.</p>` });
    if (!ok) return;
    this.draft = challenge; this.view = "setup"; this.dirty = true;
    this.render();
    await this.#checkLinks({ tell: true });
  }

  /** Which items and journals the challenge links to aren't in this world. */
  async #checkLinks({ tell = false } = {}) {
    const links = challengeLinks(this.draft), missing = [];
    for (const l of links) { let doc = null; try { doc = await fromUuid(l.uuid); } catch { /* bad link */ } if (!doc) missing.push(l); }
    this.missing = new Set(missing.map((l) => l.uuid));
    if (this.el) this.render();
    if (tell && missing.length) ui.notifications.warn(`KG Realms: not in this world: ${missing.map((l) => l.name || l.uuid).join(", ")}. They're kept on their outcomes, marked "not found": drop in your own and remove those.`, { permanent: true });
  }

  async #save() {
    try {
      await saveSceneChallenge(this.scene, this.draft);
      this.draft = sceneChallenge(this.scene); this.dirty = false;
      ui.notifications.info(`KG Realms: saved "${this.draft.name}" on ${this.scene.name}.`);
      this.render();
      return true;
    } catch (err) {
      console.error(`${ID} | skill challenge save:`, err);
      ui.notifications.error(`KG Realms: the challenge could not be saved: ${err.message}`);
      return false;
    }
  }

  #party() { return this.partyOf(this.scene).map((a) => ({ id: a.id, name: a.name, img: a.img })); }

  /**
   * A test run of the draft as it stands, saved or not. As a real start (0.98.4): nobody takes part
   * until the GM adds them in the panel, from the scene's characters or any a player owns.
   */
  #test() {
    if (challengeProblems(this.draft).length || this.runner.activeRun(this.scene)) return;
    this.runner.preview(normalizeChallenge(this.draft), this.#party());
  }

  async #start() {
    if (challengeProblems(this.draft).length) return;
    const party = this.#party();
    if (!(await this.#save())) return;
    if (!this.scene.active) {
      const go = await RealmDialog.confirm({ window: { title: "Start the skill challenge" }, content: `<p>Players see the challenge on <b>${esc(this.scene.name)}</b>. Activate that scene for everyone now?</p>` });
      if (go) await this.scene.activate();
    }
    await this.runner.start(this.scene, this.draft, party);
  }

  #confirmDiscard() {
    return RealmDialog.confirm({ window: { title: "Unsaved changes" }, content: `<p>Discard the unsaved changes to <b>${esc(this.draft?.name)}</b>?</p>` });
  }
}
