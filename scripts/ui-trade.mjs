import {RealmDialog} from "./ui-theme.mjs";
import { TRADE_GROUPS, AVAILABILITY, tradePrice, tradeCoin, economyScale, tradeBasePrice, unscaleTradeBase, visibleTradeRows } from "./trade.mjs";
const esc = s => foundry.utils.escapeHTML(String(s ?? ""));
const icon = r => r.group === "specialties" ? "fa-wand-magic-sparkles" : ({ Food: "fa-wheat-awn", Drink: "fa-wine-bottle", "Raw material": "fa-tree", Luxury: "fa-gem" })[r.cat] ?? "fa-box-open";

export function tradeSection(market, gm = game.user.isGM, { compact = false } = {}) {
  const visible = visibleTradeRows(market, gm);
  if (!market || (!gm && !visible.length && !market.houses.length)) return "";
  const groups = Object.entries(TRADE_GROUPS).map(([group, label]) => {
    const rows = visible.filter(r => r.group === group);
    if (!rows.length) return "";
    return `<section class="kgt-group"><h5>${label}</h5><div class="kgt-pills">${rows.map(r => {
      const tip = `<p><strong>${esc(r.name)}</strong></p><p><strong>${tradeCoin(tradePrice(r, market.scale))}</strong> per ${esc(r.unit)}. ${esc(r.availability)}.</p><p>${tradeCoin(tradeBasePrice(r, market.scale))} economy-adjusted base x ${r.mod} local.</p>${r.supplier ? `<p>Supplier: ${esc(r.supplier)}.</p>` : ""}${r.desc ? `<p>${esc(r.desc)}</p>` : ""}${gm && r.hidden ? "<p>Hidden from players. GM only.</p>" : ""}${gm && r.source ? `<p>${esc(r.source)}</p>` : ""}`;
      return `<button type="button" class="kgt-pill ${r.hidden ? "kgt-hidden" : ""}" data-trade-key="${esc(r.key)}" data-group="${group}" data-act="trade-price" data-tooltip="${esc(tip)}" data-tooltip-direction="UP"><i class="fa-solid ${r.hidden ? "fa-eye-slash" : icon(r)}" aria-hidden="true"></i><span class="kgt-good-name">${esc(r.name)}</span><span class="kgt-pill-price">${tradeCoin(tradePrice(r, market.scale))}</span></button>`;
    }).join("")}${compact ? `<button type="button" class="kgt-more" data-act="trade-more" aria-label="More ${label.toLowerCase()} on the full card" data-tooltip="More ${label.toLowerCase()} on the full card" hidden>...</button>` : ""}</div></section>`;
  }).join("");
  return `<section class="kgt-trade ${compact ? "kgt-compact" : ""}"><hr class="kgt-divider"><header class="kgt-heading"><h4><i class="fa-solid fa-coins"></i> Trade</h4>${gm ? `<button type="button" data-act="trade-edit"><i class="fa-solid fa-pen"></i> Edit trade</button>` : ""}</header><p class="kgt-meta">Economy x${market.scale} <span>Local price per listed unit</span></p>${groups}${market.houses.length ? `<p class="kgt-houses">Trading houses<br><strong>${market.houses.map(esc).join(" / ")}</strong></p>` : ""}${!groups && gm ? '<p class="hint">No trade information yet. Add goods or choose a settlement profile.</p>' : ""}${compact ? "" : '<div class="kgt-price-detail" hidden aria-live="polite"></div>'}</section>`;
}

/** Keep complete pills on one row and reserve room for the full-card link. No timers or writes. */
export function fitTradeRows(root) {
  for (const row of root.querySelectorAll(".kgt-compact .kgt-pills")) {
    const more = row.querySelector(".kgt-more"), pills = [...row.querySelectorAll(".kgt-pill")];
    if (!more) continue;
    for (const pill of pills) { pill.hidden = false; pill.style.maxWidth = ""; }
    more.hidden = true;
    const width = row.clientWidth, gap = Number.parseFloat(getComputedStyle(row).columnGap) || 0;
    if (!width) continue;
    const widths = pills.map(p => p.getBoundingClientRect().width);
    if (widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, pills.length - 1) <= width) continue;
    more.hidden = false;
    const available = Math.max(0, width - more.getBoundingClientRect().width - gap);
    let used = 0;
    for (let i = 0; i < pills.length; i++) {
      if (!i || used + gap + widths[i] <= available) {
        pills[i].style.maxWidth = `${available}px`; used += Math.min(widths[i], available) + (i ? gap : 0);
      } else { for (let j = i; j < pills.length; j++) pills[j].hidden = true; break; }
    }
  }
}

export function priceDetail(row, scale) {
  return `<strong>${esc(row.name)}</strong><span class="kgt-price">${tradeCoin(tradePrice(row, scale))} <small>per ${esc(row.unit)}</small></span><span>${esc(row.availability)}${row.supplier ? ` / Supplier: ${esc(row.supplier)}` : ""}</span><small>${tradeCoin(tradeBasePrice(row, scale))} economy-adjusted base x ${row.mod} local</small>${row.desc ? `<p>${esc(row.desc)}</p>` : ""}<button type="button" data-act="trade-price-close" aria-label="Close price details"><i class="fa-solid fa-xmark"></i></button>`;
}

const windows = new Map();
export function refreshTradeEditors() {
  for (const app of windows.values()) if (app.rendered) {
    serviceScale(app);
    app.element.querySelectorAll("[data-row]").forEach(box => {
      const row = app.draft.rows[Number(box.dataset.row)]; if (!row) return;
      box.querySelector(".kgt-edit-price").textContent = tradeCoin(tradePrice(row, app.market.scale));
      const input = box.querySelector('[name="base"]'); input.value = tradeBasePrice(row, app.market.scale); input.dataset.economyScale = app.market.scale;
    });
    const hint = app.element.querySelector(".kgt-economy-hint"); if (hint) hint.textContent = economyHint(app.market.scale);
  }
}
function serviceScale(app) { app.market.scale = app.service.getScale ? economyScale(app.service.getScale()) : 1; }
const economyHint = scale => `Base prices include this world's economy multiplier (x${scale}). The local multiplier applies once. Only this place changes.`;
let Editor;
export async function openTradeEditor({ service, world, place, changed }) {
  if (!game.user.isGM) return;
  const key = `${world}|${place.id}`, existing = windows.get(key);
  if (existing?.rendered) { existing.bringToFront?.(); return existing; }
  const market = await service.get(world, place);
  if (!Editor) {
    Editor = class TradeEditor extends foundry.applications.api.ApplicationV2 {
      static DEFAULT_OPTIONS = { tag: "div", classes: ["kgr-ui", "kgr-trade-editor"], window: { icon: "fa-solid fa-coins", resizable: true }, position: { width: 660, height: "auto" } };
      constructor(options) { super(options); Object.assign(this, options.context); this.draft = structuredClone({ rows: this.market.rows, houses: this.market.houses, profile: this.market.profile }); this.dirty = false; }
      get title() { return `Trade: ${this.place.name}`; }
      async _renderHTML() {
        const options = this.market.data.settlements ?? [], catalog = [...(this.market.data.goods ?? []), ...(this.market.data.signature_goods ?? [])];
        return `<div class="kgt-editor-body"><div class="kgt-profile"><label>Starting profile<select name="profile"><option value="">Custom market</option>${options.map(p => `<option value="${esc(p.id)}" ${this.draft.profile === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label><button data-act="profile">Use profile defaults</button></div><p class="hint kgt-economy-hint">${economyHint(this.market.scale)}</p><div class="kgt-edit-rows">${this.draft.rows.map((r, i) => this.rowHtml(r, i)).join("")}</div><div class="kgt-add"><label>Good to add<select name="catalog"><option value="">Custom good</option>${catalog.map(g => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("")}</select></label><button data-act="add"><i class="fa-solid fa-plus"></i> Add good</button></div><label class="kgt-houses-edit">Trading houses (one per line)<textarea name="houses" rows="3">${esc(this.draft.houses.join("\n"))}</textarea></label><p class="kgt-error" role="alert"></p></div><footer class="kgc-foot"><button data-act="reset">Restore defaults</button><span class="sp"></span><button data-act="cancel">Cancel</button><button data-act="save" class="main"><i class="fa-solid fa-check"></i> Save trade</button></footer>`;
      }
      rowHtml(r, i) {
        const input = (name, label, type = "text", attrs = "") => `<label>${label}<input name="${name}" type="${type}" value="${esc(name === "base" ? tradeBasePrice(r, this.market.scale) : r[name])}" ${name === "base" ? `data-economy-scale="${this.market.scale}"` : ""} ${attrs}></label>`;
        return `<details class="kgt-edit-good" data-row="${i}" ${this.openRow === i ? "open" : ""}><summary><span class="kgt-edit-name">${r.hidden ? '<i class="fa-solid fa-eye-slash" aria-label="Hidden from players"></i> ' : ""}${esc(r.name)}</span><span class="kgt-edit-price">${tradeCoin(tradePrice(r, this.market.scale))}</span></summary><div class="kgt-good-fields">${input("name", "Name", "text", 'maxlength="120" required')}${input("unit", "Unit", "text", 'maxlength="100" required')}<label>Trade role<select name="group">${Object.entries(TRADE_GROUPS).map(([k, v]) => `<option value="${k}" ${r.group === k ? "selected" : ""}>${v}</option>`).join("")}</select></label><label>Availability<select name="availability">${AVAILABILITY.map(v => `<option ${r.availability === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>${input("base", "Base price (gp), economy adjusted", "number", 'min="0" step="any" required')}${input("mod", "Local multiplier", "number", 'min="0" step="any" required')}${input("supplier", "Supplier", "text", 'maxlength="200"')}${input("desc", "Description", "text", 'maxlength="3000"')}<label class="kgt-visibility"><input name="hidden" type="checkbox" ${r.hidden ? "checked" : ""}><span>Hide this good from players<small>GM cards keep it visible with an eye-off icon.</small></span></label><button data-act="remove" class="danger">Remove good</button></div></details>`;
      }
      _replaceHTML(html, content) {
        content.innerHTML = html;
        if (content.kgtBound) return;
        content.kgtBound = true;
        content.addEventListener("input", e => this.input(e.target));
        content.addEventListener("change", e => this.input(e.target));
        content.addEventListener("click", e => { const b = e.target.closest("[data-act]"); if (b) { e.preventDefault(); this.click(b); } });
      }
      input(el) {
        if (!el.name) return;
        if (el.name === "profile" || el.name === "catalog") return;
        this.dirty = true;
        if (el.name === "houses") { this.draft.houses = el.value.split("\n").map(s => s.trim()).filter(Boolean); return; }
        const box = el.closest("[data-row]"); if (!box) return;
        const row = this.draft.rows[Number(box.dataset.row)];
        row[el.name] = el.name === "base" ? unscaleTradeBase(el.value, Number(el.dataset.economyScale) || this.market.scale) : el.name === "mod" ? Number(el.value) : el.name === "hidden" ? el.checked : el.value;
        row.source = "GM override";
        box.querySelector(".kgt-edit-name").innerHTML = `${row.hidden ? '<i class="fa-solid fa-eye-slash" aria-label="Hidden from players"></i> ' : ""}${esc(row.name)}`;
        box.querySelector(".kgt-edit-price").textContent = tradeCoin(tradePrice(row, this.market.scale));
      }
      async click(button) {
        if (this.working || !game.user.isGM) return;
        const act = button.dataset.act, root = this.element;
        if (act === "cancel") return this.close();
        if (act === "remove") { const i = Number(button.closest("[data-row]").dataset.row); this.draft.rows.splice(i, 1); this.dirty = true; return this.render(); }
        if (act === "add") {
          const id = root.querySelector('[name="catalog"]').value, p = this.service.profile(this.market.data, this.place, this.draft.profile);
          const row = this.service.row(this.market.data, p, id) ?? { name: "New trade good", group: "exports", unit: "1 lb", base: 1, mod: 1, availability: "Stocked", supplier: "", desc: "", source: "GM entry" };
          row.key = `good-${foundry.utils.randomID()}`; this.draft.rows.push(row); this.openRow = this.draft.rows.length - 1; this.dirty = true; return this.render();
        }
        if (act === "profile") {
          if (this.dirty && !await this.confirmDiscard()) return;
          const id = root.querySelector('[name="profile"]').value;
          this.draft = this.service.defaults(this.market.data, this.service.profile(this.market.data, this.place, id)); this.dirty = true; return this.render();
        }
        if (act !== "save" && act !== "reset") return;
        if (act === "reset" && !await RealmDialog.confirm({ window: { title: "Restore trade defaults" }, content: "<p>Remove this place's trade overrides and restore its original profile?</p>", rejectClose: false })) return;
        if (act === "save") for (const input of root.querySelectorAll("input,select,textarea")) if (!input.reportValidity()) return;
        this.working = true; button.disabled = true;
        try { await this.service.save(this.world, this.place.id, act === "reset" ? null : this.draft, this.market.revision); this.dirty = false; await this.changed?.(); this.working = false; await this.close(); }
        catch (error) { root.querySelector(".kgt-error").textContent = error.message; }
        finally { this.working = false; button.disabled = false; }
      }
      confirmDiscard() { return RealmDialog.confirm({ window: { title: "Unsaved trade changes" }, content: "<p>Discard these trade changes?</p>", rejectClose: false }); }
      async close(options) { if (this.working) return this; if (this.dirty && !await this.confirmDiscard()) return this; return super.close(options); }
      _onClose(options) { super._onClose?.(options); windows.delete(this.key); }
    };
  }
  const app = new Editor({ context: { service, world, place, changed, market, key } }); windows.set(key, app); await app.render({ force: true }); return app;
}
