import {RealmDialog} from "./ui-theme.mjs";
// The map editor's Snow tab (0.75): this world's snow. Snow at the north, the south or both; for
// each, how far across the map it reaches at the depth of winter and how far it draws back by the
// height of summer, and how wide its patchy edge is; the month the north's winter is deepest (the
// south's falls half a year later unless its seasons run with the north's); how much further out
// high ground holds it. Saved for this world only. The map shows the snow as it changes, and a
// month can be picked to see the snow then without changing the date.

import { ruleTooltip } from "./travel-rules.mjs";
import { simpleFromMonths } from "./snow.mjs";

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

export class SnowTab {
  /** getWorld(), getSnow() (this world's snow, merged), saveSnow(fn), getSheet() ({ height, milesPerPixel, width }), getMonths() ([name]), snow (the SnowCover), hasTerrain() (the world ships a terrain grid). */
  constructor(options) {
    Object.assign(this, options);
    this.active = false;
    this.panel = null;
    this.previewMonth = "";
  }

  status() { return { hint: "Snow: where this world's snow lies through the year", esc: "leaves editing", tip: "" }; }

  open() {
    if (this.active || !game.user.isGM) return;
    this.active = true;
    this.panel = document.createElement("div");
    this.panel.className = "kgr-tab kgr-snow-tab";
    (this.host ?? document.body).append(this.panel);
    this.panel.addEventListener("change", (e) => this.#change(e.target));
    this.panel.addEventListener("input", (e) => this.#input(e.target));
    this.panel.addEventListener("click", (e) => this.#click(e.target.closest("[data-act]")?.dataset.act));
    this.key = (e) => { if (e.key === "Escape" && !e.target?.closest?.("input, textarea, select")) { e.preventDefault(); e.stopImmediatePropagation(); this.onLeave?.(); } };
    window.addEventListener("keydown", this.key, true);
    this.#render();
    this.#preview();
  }

  close() {
    if (!this.active) return;
    this.active = false;
    window.removeEventListener("keydown", this.key, true);
    this.panel?.remove(); this.panel = null;
    this.previewMonth = "";
    this.snow?.preview(null);
  }

  refresh() { if (this.active && !this.panel?.contains(document.activeElement)) this.#render(); }

  #miles(frac) { const s = this.getSheet(); return Math.round(frac * s.height * s.milesPerPixel); }

  #pole(key, cfg) {
    const p = cfg[key], name = key === "north" ? "north" : "south", edge = key === "north" ? "top" : "bottom";
    const rule = ruleTooltip(`<p><strong>Deepest winter</strong> How far snow reaches from the ${edge} edge of the map at the depth of winter, as a share of the map's height. Full cover up to there, then the patchy edge.</p><p><strong>Height of summer</strong> How far it has drawn back by midsummer (0: gone, apart from high ground).</p><p><strong>Patchy edge</strong> How wide the band of patchy snow between full cover and bare ground is.</p><p><strong>Between</strong> The snow moves smoothly between the two through the year, a little each day.</p>`);
    const on = `<label class="kgr-snow-on"><input type="checkbox" name="${key}-on" ${p.on ? "checked" : ""}> Snow at the ${name} pole</label>`;
    if (!p.on) return `<fieldset class="kgr-snow-pole">${on}</fieldset>`;
    if (Array.isArray(p.months)) return `<fieldset class="kgr-snow-pole">${on}<p class="hint">This world's module sets the ${name}'s snow line month by month.</p><div class="row"><button type="button" data-act="${key}-own"><i class="fa-solid fa-sliders"></i> Set my own</button></div></fieldset>`;
    const range = (field, label) => `<label class="kgr-snow-range"><span>${label}</span><input type="range" name="${key}-${field}" min="0" max="1" step="0.01" value="${p[field]}"><output>${Math.round(p[field] * 100)}% · ${this.#miles(p[field]).toLocaleString()} mi</output></label>`;
    return `<fieldset class="kgr-snow-pole"><div class="kgr-snow-head">${on}${rule}</div>
      ${range("winter", "Deepest winter reaches")}
      ${range("summer", "Height of summer reaches")}
      <label class="kgr-snow-field"><span>Patchy edge</span><input type="number" name="${key}-band" min="0" max="5000" step="10" value="${p.band}"><small>mi wide</small></label>
    </fieldset>`;
  }

  #render() {
    if (!this.active || !this.panel) return;
    const regional=this.isRegional?.(),enabled=this.getEnabled?.()??true;
    const toggle=regional?`<label class="kgr-snow-on"><input type="checkbox" name="regional-enabled" ${enabled?'checked':''}> Enable snow line on this regional map</label><p class="hint">Off by default. This regional map uses its own snow settings, independent of the realm.</p>`:'';
    if(regional&&!enabled){this.panel.innerHTML=toggle;this.onStatus?.();return;}
    const cfg = this.getSnow(), months = this.getMonths();
    const southRule = ruleTooltip("<p><strong>Reversed</strong> The south's winter falls half a year after the north's, as on Earth: its snow is deepest when the north's is least.</p><p><strong>Not reversed</strong> Both poles have winter at the same time.</p>");
    const highRule = ruleTooltip("<p><strong>High ground</strong> Mountains and hills (from the map's terrain and the biomes you paint) keep snow further from the pole than open ground, and keep it longer into summer.</p>");
    const monthOptions = months.map((m, i) => `<option value="${i}">${esc(m)}</option>`).join("");
    this.panel.innerHTML = `${toggle}
      <p class="hint">Where this world's snow lies through the year. Changes show on the map as you make them and are saved for this world only.</p>
      ${this.#pole("north", cfg)}
      ${this.#pole("south", cfg)}
      ${cfg.north.on || cfg.south.on ? `<div class="row"><label>Deepest winter in the ${cfg.north.on ? "north" : "south"} <select name="midwinter">${months.map((m, i) => `<option value="${i}" ${i === this.#deepest(cfg) ? "selected" : ""}>${esc(m)}</option>`).join("")}</select></label></div>` : ""}
      ${cfg.north.on && cfg.south.on ? `<label class="kgr-snow-on"><input type="checkbox" name="reversed" ${cfg.reversed !== false ? "checked" : ""}> The south's seasons are reversed ${southRule}</label>` : ""}
      <fieldset class="kgr-snow-pole"><div class="kgr-snow-head"><span class="kgr-snow-on">High ground holds snow further out</span>${highRule}</div>
        <label class="kgr-snow-field"><span>Mountains</span><input type="number" name="mountains" min="0" max="2000" step="10" value="${cfg.mountains ?? 0}"><small>mi</small></label>
        <label class="kgr-snow-field"><span>Hills</span><input type="number" name="hills" min="0" max="2000" step="10" value="${cfg.hills ?? 0}"><small>mi</small></label>
      </fieldset>
      ${this.hasTerrain?.() ? "" : `<p class="hint"><i class="fa-solid fa-water"></i> Snow lies on land only. This map knows its water from your shorelines: on the Waterways tab, give each shoreline its water side.</p>`}
      <div class="row"><label>See the snow in <select name="preview"><option value="">Today's date</option>${monthOptions}</select></label></div>
      <div class="kgr-file-row"><button type="button" data-act="reset" title="Back to this world's own snow (its module's, or the defaults)"><i class="fa-solid fa-rotate-left"></i> Back to the world's own</button></div>`;
    const preview = this.panel.querySelector('[name="preview"]');
    if (preview) preview.value = this.previewMonth;
    this.onStatus?.();
  }

  /**
   * The month the picker shows: the north's deepest winter, or with snow at the south only, the
   * south's own (half a year after the north's when its seasons are reversed).
   */
  #deepest(cfg) {
    const n = this.getMonths().length || 12, m = cfg.midwinter ?? 0;
    return !cfg.north.on && cfg.south.on && cfg.reversed !== false ? (m + Math.round(n / 2)) % n : m;
  }
  /** The month picked, stored as the north's deepest winter (snowLines counts from it). */
  #midwinterFrom(picked, cfg) {
    const n = this.getMonths().length || 12;
    return !cfg.north.on && cfg.south.on && cfg.reversed !== false ? (picked - Math.round(n / 2) + n) % n : picked;
  }

  /** The map shows the snow in the month picked, or at today's date. */
  #preview() {
    if(this.isRegional?.()&&this.getEnabled?.()===false){this.snow?.preview(null);return;}
    const n = this.getMonths().length || 12;
    this.snow?.preview(this.previewMonth === "" ? null : (Number(this.previewMonth) + 0.5) / n);
  }

  /** A slider moving: the map and its label follow before it is saved. */
  #input(t) {
    const m = /^(north|south)-(winter|summer)$/.exec(t.name ?? "");
    if (!m) return;
    const v = Number(t.value), out = t.parentElement.querySelector("output");
    if (out) out.textContent = `${Math.round(v * 100)}% · ${this.#miles(v).toLocaleString()} mi`;
    const cfg = this.getSnow();
    cfg[m[1]] = { ...cfg[m[1]], [m[2]]: v };
    this.snow?.setConfig(cfg);
  }

  async #change(t) {
    if (!t.name) return;
    if(t.name==="regional-enabled"){await this.setEnabled?.(t.checked);this.#render();return this.#preview();}
    if (t.name === "preview") { this.previewMonth = t.value; return this.#preview(); }
    const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
    const pole = /^(north|south)-(on|winter|summer|band)$/.exec(t.name);
    await this.saveSnow((own) => {
      if (pole) {
        const [, k, f] = pole;
        own[k] = { ...(own[k] ?? {}), [f]: f === "on" ? t.checked : f === "band" ? num(t.value, 0, 5000) : num(t.value, 0, 1) };
      } else if (t.name === "reversed") own.reversed = t.checked;
      else if (t.name === "midwinter") own.midwinter = this.#midwinterFrom(Number(t.value) || 0, this.getSnow());
      else if (t.name === "mountains" || t.name === "hills") own[t.name] = num(t.value, 0, 2000);
      return own;
    });
  }

  async #click(act) {
    if (!act) return;
    if (act === "reset") {
      const ok = await RealmDialog.confirm({ window: { title: "Snow" }, content: "<p>Go back to this world's own snow, as its module sets it (or the defaults)?</p>", rejectClose: false });
      if (ok) await this.saveSnow(() => ({}));
      return;
    }
    const own = /^(north|south)-own$/.exec(act);
    if (own) {
      // Start from the module's month-by-month line, as near as two lines and a band can say it.
      const cfg = this.getSnow(), s = this.getSheet(), simple = simpleFromMonths(cfg[own[1]].months, s.height, s.milesPerPixel);
      await this.saveSnow((o) => ({ ...o, midwinter: o.midwinter ?? simple.midwinter, [own[1]]: { ...(o[own[1]] ?? {}), on: true, winter: simple.winter, summer: simple.summer, band: simple.band } }));
    }
  }
}
