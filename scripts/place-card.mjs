// The place card: one window for every place (realm places, places on local maps) and encounter.
// For players it shows what they may know; for the GM everything, and the card is also the editor:
// Edit turns it into its form in place, Save or Discard turns it back. No journal ever opens: a
// place's text lives on the place (What is known, for everyone; GM notes, for the GM), and
// secret blocks in What is known stay with the GM until revealed. One window, reused.
import { CATEGORIES, VISIBILITY } from "./local-places.mjs";
import { journalFromDrop } from "./journal-link.mjs";
import { tradeSection, priceDetail } from "./ui-trade.mjs";
import {ICON_PACKS,iconPack,iconPackOverride,resolvedIconPack,paintIconPackPreview} from './local-icon-packs.mjs';
import {placeReference, findPlaceLinks, placeToken, capturePlaceEditor, insertPlaceToken} from './place-links.mjs';
import { shellTabs } from "./ui-shell.mjs";

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const ID = "kgr-place-card";
const TE = () => foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;

/** Text as HTML: kept as it is when it is HTML, else paragraphs. */
export function asHtml(text) {
  const t = String(text ?? "").trim();
  if (!t) return "";
  return /<[a-z][\s\S]*>/i.test(t) ? t : t.split(/\n{2,}/).map((p) => `<p>${foundry.utils.escapeHTML(p)}</p>`).join("");
}

/** Journal text as a GM-only secret block, for players to see only what the GM reveals. */
export function asSecret(html) {
  return html ? `<section class="secret" id="secret-${foundry.utils.randomID()}">${html}</section>` : "";
}

/** The first paragraph of some HTML, plain; for players without the secrets they may not see. */
export function firstParagraph(html, gm = game.user.isGM, max = 320) {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = html ?? "";
  if (!gm) for (const s of div.querySelectorAll("section.secret:not(.revealed)")) s.remove();
  const p = [...div.querySelectorAll("p")].map((x) => x.textContent.trim()).find(Boolean) ?? div.textContent.trim();
  return p.length > max ? `${p.slice(0, max - 3)}…` : p;
}

// Foundry's content links in text: @UUID[Actor.x]{Name}, @Actor[x]{Name}, @Compendium[...], ...
const LINK = /@(\w+)\[([^\]]+)\](?:\{([^}]*)\})?/g;
const LINK_ICONS = { Actor: "fa-user", Item: "fa-suitcase", JournalEntry: "fa-book-open", JournalEntryPage: "fa-book-open", Scene: "fa-map", RollTable: "fa-table-list", Macro: "fa-code", Cards: "fa-cards", Playlist: "fa-music" };
function linkChip(type, target, label) {
  if (type === 'Place' && placeReference(target)) return `<span class="kgr-link"><i class="fa-solid fa-map-location-dot"></i>${esc(label || 'Place')}</span>`;
  const uuid = type === "UUID" || type === "Compendium" ? target : `${type}.${target}`;
  let doc = null;
  try { doc = fromUuidSync(uuid, { strict: false }); } catch { /* not loaded */ }
  const kind = doc?.documentName ?? (type === "UUID" ? uuid.split(".").at(-2) : type);
  const name = label || doc?.name || target.split(".").pop();
  return `<span class="kgr-link"><i class="fa-solid ${LINK_ICONS[kind] ?? "fa-link"}"></i>${foundry.utils.escapeHTML(name)}</span>`;
}

/** HTML with its content links drawn as inline chips (for previews that are not enriched). */
export const inlineLinks = (html) => String(html ?? "").replace(LINK, (m, type, target, label) => linkChip(type, target, label));

/**
 * The first paragraph of some text as safe HTML for a hover card: plain words, cut at about 320
 * characters, with content links as chips (not their @UUID code).
 */
export function excerptHtml(html, gm = game.user.isGM) {
  const text = /<[a-z][\s\S]*>/i.test(String(html ?? "")) ? firstParagraph(html, gm, Infinity) : String(html ?? "").trim();
  let out = "", shown = 0, last = 0;
  const add = (s) => { const room = 320 - shown; if (room <= 0) return false; const t = s.length > room ? `${s.slice(0, room - 1)}…` : s; out += foundry.utils.escapeHTML(t); shown += t.length; return s.length <= room; };
  for (const m of text.matchAll(LINK)) {
    if (!add(text.slice(last, m.index))) return out;
    const chip = linkChip(m[1], m[2], m[3]);
    out += chip;
    shown += (m[3] || m[2]).length;
    last = m.index + m[0].length;
  }
  add(text.slice(last));
  return out;
}

/**
 * Card text without repeated secret blocks (the same text twice): the first stays, revealed if any
 * copy was. Returns the text as it was when nothing repeats.
 */
export function withoutRepeats(html) {
  if (!html || !/class="secret/.test(html)) return html;
  const div = document.createElement("div");
  div.innerHTML = html;
  const seen = new Map();
  let changed = false;
  for (const sec of div.querySelectorAll("section.secret")) {
    const key = sec.textContent.replace(/\s+/g, " ").trim();
    if (!key) continue;
    const first = seen.get(key);
    if (!first) { seen.set(key, sec); continue; }
    if (sec.classList.contains("revealed")) first.classList.add("revealed");
    sec.remove();
    changed = true;
  }
  return changed ? div.innerHTML : html;
}

/** The visibility of a record: hidden, rumoured or discovered (old records: the hidden box). */
export const visibilityOf = (r) => r?.visibility ?? (r?.hidden ? "hidden" : "discovered");

/**
 * Kinds of card. Each turns a reference into a card's data and saves edits:
 *   get(ref): { name, type, subtitle, img, known, gmNotes, rumours, visibility, scene, actor,
 *               enter: { label, scene } | null, fields: [...] (edit form), canDelete, rows }
 *   save(ref, fields), remove(ref)
 */
export class PlaceCards {
  constructor() {
    this.kinds = {};
    this.app = null;
  }

  register(kind, def) { this.kinds[kind] = def; }

  /** Open (or retarget) the card. ref: { kind, ... }. edit: open straight into the form (GM). */
  async open(ref, { edit = false, warnMissing = false } = {}) {
    const def = this.kinds[ref?.kind];
    if (!def) return;
    const data = await def.get(ref);
    if (!data) { if (warnMissing) ui.notifications.warn('KG Realms: this place no longer exists.'); return; }
    if (!game.user.isGM && visibilityOf(data) === "hidden") return ui.notifications.info("Nothing is known about this place.");
    const App = cardClass();
    if (this.app?.rendered) {
      if (this.app.dirty && !(await this.app.confirmDiscard())) return;
      this.app.target(ref, edit && game.user.isGM);
      await this.app.render({ force: true });
      if (this.app.minimized) await this.app.maximize();
      this.app.bringToFront?.();
      return this.app;
    }
    this.app = new App({ cards: this, ref, edit: edit && game.user.isGM });
    return this.app.render({ force: true });
  }

  /** A record changed elsewhere: redraw the card if it shows it. */
  refresh() { if (this.app?.rendered && !this.app.editing) this.app.render(); }
}

/** The edit form's boxes, in order, and what each visibility gives players. */
const GROUPS = [["identity", "Identity"], ["who", "Who sees it"], ["text", "Text"], ["links", "Links"], ["map", "On the map"], ["", ""]];
/** The edit form's tabs and the groups on each (Trade, between On the map and Links, is added when there is a market). */
const FORM_TABS = [["text", "Text", "fa-pen-nib", ["identity", "who", "text", ""]], ["map", "On the map", "fa-location-dot", ["map"]], ["links", "Links", "fa-link", ["links"]]];
const VIS_HINT = {
  hidden: "Players see nothing: no marker, no card, not in search.",
  rumoured: "Players see its name, its type and the rumours below. Nothing else.",
  discovered: "Players see the card: art, What is known, and any secret blocks you reveal."
};

/** A rich text field's preview on the form. */
const preview = (html) => (html ? `<div class="kgc-text">${inlineLinks(html)}</div>` : `<span class="kgc-empty">Nothing written yet.</span>`);

/** What to drop on a document field, in words. */
const DROP_WHAT = { Scene: "a scene from the Scenes sidebar", Actor: "an actor", JournalEntry: "a journal or page" };

/** An actor, scene or journal field's drop box: the linked one with a clear button, or where to drop one. */
function docBox(f, v) {
  const doc = !v ? null : f.doc === "Scene" ? game.scenes.get(v) : fromUuidSync(v, { strict: false });
  const name = doc?.name ?? (v ? `Missing ${f.doc.toLowerCase()}` : "");
  return `<input type="hidden" name="${f.name}" value="${esc(v)}">${name
    ? `<span><i class="fa-solid ${f.icon}"></i> ${esc(name)}</span><button type="button" data-act="clear" title="Unlink"><i class="fa-solid fa-xmark"></i></button>`
    : `<span><i class="fa-solid ${f.icon}"></i> Drop ${DROP_WHAT[f.doc] ?? "it"} here</span>`}`;
}

/** A list field (several actors, or several pictures): each with a remove button, and where to add more. */
function listBox(f, list) {
  const items = list.map((v, i) => {
    if (f.type === "images") return `<span class="kgc-item kgc-pic" style="background-image:url('${esc(foundry.utils.getRoute(v))}')" title="${esc(v.split("/").pop())}"><button type="button" data-act="list-remove" data-i="${i}" aria-label="Remove"><i class="fa-solid fa-xmark"></i></button></span>`;
    const doc = fromUuidSync(v, { strict: false });
    return `<span class="kgc-item"><i class="fa-solid ${f.icon}"></i> ${esc(doc?.name ?? "Missing")}<button type="button" data-act="list-remove" data-i="${i}" aria-label="Remove"><i class="fa-solid fa-xmark"></i></button></span>`;
  }).join("");
  const add = f.type === "images" ? `<button type="button" data-act="list-add" class="kgc-add"><i class="fa-solid fa-plus"></i> Add a picture</button>` : `<span class="kgc-add-hint"><i class="fa-solid ${f.icon}"></i> Drop ${list.length ? "more actors" : "actors"} here</span>`;
  return `<input type="hidden" name="${f.name}" value="${esc(JSON.stringify(list))}">${items}${add}`;
}

/**
 * An encounter's actors (click to open, drag onto the scene) and pictures (click to view), for the
 * GM: on its card and in the encounter box (ui-encounter-box.mjs). Empty when it has none.
 */
/**
 * Open a pinned journal to read, not to edit: a journal entry in its own view, or for a pinned
 * page its journal, turned to that page (a page's own sheet is its editor).
 */
export async function openPinned(uuid) {
  const doc = uuid ? await fromUuid(uuid).catch(() => null) : null;
  if (!doc) return ui.notifications.warn("KG Realms: the pinned journal is missing.");
  const entry = doc.documentName === "JournalEntryPage" ? doc.parent : doc, pageId = doc.documentName === "JournalEntryPage" ? doc.id : undefined;
  return entry?.sheet?.render({ force: true, ...(pageId ? { pageId } : {}) });
}

/** Open a linked document's sheet (an actor), loading it from its compendium if it is not loaded yet. */
export async function openDoc(uuid) {
  const doc = uuid ? await fromUuid(uuid).catch(() => null) : null;
  if (!doc?.sheet) return ui.notifications.warn("KG Realms: the linked document is missing.");
  return doc.sheet.render(true);
}

export function assetStrip(d) {
  const actors = (d.actors ?? []).map((u, i) => { const a = fromUuidSync(u, { strict: false }); return a ? `<button class="kgc-asset" data-act="actor-n" data-i="${i}" draggable="true" data-drag-type="Actor" data-drag-uuid="${esc(u)}" title="Open, or drag onto the scene"><img src="${esc(a.img ?? "")}" alt=""> ${esc(a.name)}</button>` : ""; }).join("");
  const pics = (d.images ?? []).map((p, i) => `<button class="kgc-asset kgc-pic" data-act="pic" data-i="${i}" style="background-image:url('${esc(foundry.utils.getRoute(p))}')" aria-label="Picture ${i + 1}" title="View it"></button>`).join("");
  if (!actors && !pics) return "";
  return `<section class="kgc-sect kgc-assets"><h4>Encounter</h4>${actors ? `<div class="kgc-asset-row">${actors}</div>` : ""}${pics ? `<div class="kgc-asset-row">${pics}</div>` : ""}</section>`;
}

/** Dragging an asset (an actor) out of a card or box onto the canvas. */
export function assetDrag(e) {
  const el = e.target.closest?.("[data-drag-uuid]");
  if (!el) return;
  e.dataTransfer.setData("text/plain", JSON.stringify({ type: el.dataset.dragType, uuid: el.dataset.dragUuid }));
}

/**
 * The full-size text editor, themed like the card: Foundry's editor filling a resizable window.
 * Resolves with the text on Done, or null if closed without it. One window per field.
 */
const textWindows = new Map();
function textWindow({ id, title, value, hint, getPlaces }) {
  const open = textWindows.get(id);
  if (open?.rendered) { open.bringToFront?.(); return open.promise; }
  const { ApplicationV2 } = foundry.applications.api;
  class TextWindow extends ApplicationV2 {
    static DEFAULT_OPTIONS = { tag: "div", classes: ["kgr-ui", "kgr-text-window"], window: { icon: "fa-solid fa-pen-nib", resizable: true }, position: { width: 860, height: 720 } };
    get title() { return title; }
    async _renderHTML() {
      const editor = customElements.get("prose-mirror") ? `<prose-mirror name="text" value="${esc(value)}"></prose-mirror>` : `<textarea name="text">${esc(value)}</textarea>`;
      return `<div class="kgt-links"><button type="button" data-act="place-picker" aria-expanded="false"><i class="fa-solid fa-link"></i> Insert place link</button><span class="hint">Links open another place's card.</span>
        <div class="kgt-place-picker" hidden><div class="kgt-place-search"><input type="search" aria-label="Find a place to link" placeholder="Find a place, e.g. Iron Flagon Inn" autocomplete="off"><button type="button" data-act="close-picker" aria-label="Close place search"><i class="fa-solid fa-xmark"></i></button></div><div class="kgt-place-results" role="listbox" aria-label="Places"></div><p class="hint" role="status" data-place-status>Loading places...</p></div></div>
        <div class="kgt-body">${editor}</div><footer class="kgc-foot">${hint ? `<span class="kgt-hint">${hint}</span>` : ""}<span class="sp"></span>
        <button data-act="cancel"><i class="fa-solid fa-xmark"></i> Cancel</button><button data-act="ok" class="main"><i class="fa-solid fa-check"></i> Done</button></footer>`;
    }
    _replaceHTML(html, content) {
      // The custom element dispatches this event synchronously while it is connected.
      if (!content.kgtPlugins) {
        content.kgtPlugins = true;
        content.addEventListener('plugins', e => capturePlaceEditor(e, view => { this.editorView = view; }));
      }
      content.innerHTML = html;
      if (content.kgtBound) return;
      content.kgtBound = true;
      content.addEventListener("input", () => { this.changed = true; });
      content.addEventListener('pointerdown', e => {
        if (!e.target.closest('[data-act="place-picker"]')) return;
        const el = content.querySelector('textarea[name="text"]');
        if (el) this.textSelection = {start: el.selectionStart, end: el.selectionEnd};
      });
      const search = content.querySelector('.kgt-place-search input');
      search.addEventListener('input', e => { e.stopPropagation(); this.#searchPlaces(content); });
      search.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); this.#hidePicker(content); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault(); const count = this.matches?.length ?? 0;
          if (count) { this.activePlace = ((this.activePlace ?? 0) + (e.key === 'ArrowDown' ? 1 : -1) + count) % count; this.#highlightPlace(content); }
        } else if (e.key === 'Enter') { e.preventDefault(); this.#insertPlace(content, this.activePlace ?? 0); }
      });
      content.addEventListener("click", (e) => {
        const button = e.target.closest('[data-act]'), act = button?.dataset.act;
        if (act === 'place-picker') { this.#showPicker(content); return; }
        if (act === 'close-picker') { this.#hidePicker(content); return; }
        if (act === 'insert-place') { this.#insertPlace(content, Number(button.dataset.i)); return; }
        if (act === "ok") {
          const el = content.querySelector('[name="text"]');
          this.result = String(el?.value ?? el?.querySelector(".ProseMirror")?.innerHTML ?? "").trim();
          this.close();
        } else if (act === "cancel") { this.changed = false; this.close(); }
      });
    }
    async #showPicker(content) {
      const picker = content.querySelector('.kgt-place-picker');
      if (!picker.hidden) return this.#hidePicker(content);
      picker.hidden = false;
      content.querySelector('[data-act="place-picker"]').setAttribute('aria-expanded', 'true');
      content.querySelector('.kgt-place-search input').focus();
      if (!this.placeChoices) {
        try { this.placeChoices = await getPlaces?.() ?? []; }
        catch (error) {
          console.error('kg-realms | place search:', error);
          if (this.rendered) content.querySelector('[data-place-status]').textContent = 'Places could not be loaded. Close this search and try again.';
          return;
        }
      }
      if (this.rendered) this.#searchPlaces(content);
    }
    #hidePicker(content) {
      content.querySelector('.kgt-place-picker').hidden = true;
      content.querySelector('[data-act="place-picker"]').setAttribute('aria-expanded', 'false');
    }
    #searchPlaces(content) {
      const query = content.querySelector('.kgt-place-search input').value;
      this.matches = findPlaceLinks(query, this.placeChoices ?? []);
      this.activePlace = 0;
      content.querySelector('.kgt-place-results').innerHTML = this.matches.map((p, i) => `<button type="button" role="option" aria-selected="${i === 0}" data-act="insert-place" data-i="${i}"><i class="fa-solid fa-map-location-dot"></i><span>${esc(p.name)}<small>${esc(p.where)}</small></span></button>`).join('');
      content.querySelector('[data-place-status]').textContent = !query.trim() ? 'Search realm locations and places on local maps.' : this.matches.length ? 'Choose a place to insert its link at the cursor. Arrow keys and Enter also work.' : 'No matching places.';
    }
    #highlightPlace(content) {
      for (const row of content.querySelectorAll('[data-act="insert-place"]')) row.setAttribute('aria-selected', Number(row.dataset.i) === this.activePlace ? 'true' : 'false');
      content.querySelector('[aria-selected="true"]')?.scrollIntoView({block: 'nearest'});
    }
    #insertPlace(content, index) {
      const place = this.matches?.[index];
      if (!place) return;
      if (!insertPlaceToken(content.querySelector('[name="text"]'), this.editorView, placeToken(place.ref, place.name), this.textSelection)) {
        ui.notifications.warn('KG Realms: wait for the text editor to finish opening, then choose the place again.');
        return;
      }
      this.changed = true;
      this.textSelection = null;
      this.#hidePicker(content);
    }
    async close(options) {
      if (this.result === undefined && this.changed) {
        const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Unsaved text" }, content: "<p>Close the editor and lose these changes?</p>", rejectClose: false });
        if (!ok) return this;
        this.changed = false;
      }
      return super.close(options);
    }
    _onClose(options) { super._onClose?.(options); textWindows.delete(id); this.resolve(this.result ?? null); }
  }
  const app = new TextWindow({ id: `kgr-text-${foundry.utils.randomID()}` });
  app.promise = new Promise((resolve) => { app.resolve = resolve; });
  textWindows.set(id, app);
  app.render({ force: true });
  return app.promise;
}

let CardClass = null;
function cardClass() {
  if (CardClass) return CardClass;
  const { ApplicationV2 } = foundry.applications.api;
  CardClass = class PlaceCardApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: ID, tag: "div", classes: ["kgr-ui", "kgr-place-card"],
      window: { title: "Place", icon: "fa-solid fa-map-location-dot", resizable: true },
      position: { width: 480, height: "auto" }
    };

    constructor(options) {
      super(options);
      this.cards = options.cards;
      this.target(options.ref, options.edit);
      this.iconPackSceneHook=globalThis.Hooks?.on('updateScene',scene=>this.#refreshIconDefault(scene));
      this.iconPackWorldHook=globalThis.Hooks?.on('kgRealmsIconPackChanged',()=>this.#refreshIconDefault(game.scenes.get(this.ref?.scene)));
    }

    // Opened straight into editing (an edit button, a new place): Save or Cancel closes the card,
    // since the card itself was never asked for. Edit pressed on an open card goes back to it.
    target(ref, edit = false) { this.ref = ref; this.editing = !!edit; this.editOnly = !!edit; this.dirty = false; this.draft = null; this.viewTab = "about"; this.formTab = "text"; }
    get title() { return this.data?.name ?? "Place"; }
    get def() { return this.cards.kinds[this.ref.kind]; }

    async confirmDiscard() {
      return foundry.applications.api.DialogV2.confirm({ window: { title: "Unsaved changes" }, content: "<p>Discard the changes to this card?</p>", rejectClose: false });
    }

    async close(options) {
      if (this.dirty && !(await this.confirmDiscard())) return this;
      this.dirty = false;
      this.draft = null;
      if(this.iconPackSceneHook!=null)globalThis.Hooks?.off('updateScene',this.iconPackSceneHook);this.iconPackSceneHook=null;
      if(this.iconPackWorldHook!=null)globalThis.Hooks?.off('kgRealmsIconPackChanged',this.iconPackWorldHook);this.iconPackWorldHook=null;
      return super.close(options);
    }

    async _renderHTML() {
      const d = await this.def.get(this.ref);
      this.data = d;
      if (!d) return `<div class="kgc"><p>This place is gone.</p></div>`;
      const gm = game.user.isGM, vis = visibilityOf(d);
      if (!gm && vis === "hidden") return `<div class="kgc"><p>Nothing is known about this place.</p></div>`;
      return this.editing && gm ? this.#formHtml(d) : this.#viewHtml(d, vis, gm);
    }

    async #viewHtml(d, vis, gm) {
      const rumoured = !gm && vis === "rumoured";
      const enrich = async (html) => (html ? TE().enrichHTML(html, { secrets: gm }) : "");
      const known = rumoured ? "" : await enrich(d.known);
      const notes = gm ? await enrich(d.gmNotes) : "";
      const rumours = await enrich(asHtml(d.rumours));
      const sect = (title, body, cls = "") => (body ? `<section class="kgc-sect ${cls}"><h4>${title}</h4><div class="kgc-text">${body}</div></section>` : "");
      const art = !rumoured && d.img ? `<div class="kgc-art" data-act="art" style="background-image:url('${esc(foundry.utils.getRoute(d.img))}')" title="${gm ? "Show it" : "Open it"}"></div>` : "";
      const badge = `<span class="kgc-badge"><i class="fa-solid ${d.icon ?? "fa-location-dot"}"></i> ${esc(d.type ?? "Place")}</span>`;
      const audience = gm && vis !== "discovered" ? `<span class="kgc-vis ${vis}"><i class="fa-solid fa-eye-slash"></i> ${esc(VISIBILITY[vis])} to players</span>` : "";
      const rows = (d.rows ?? []).filter(([, v]) => v != null && v !== "").map(([k, v]) => `<div class="kgc-row"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("");
      const actor = d.actor ? fromUuidSync(d.actor, { strict: false }) : null;
      const canActor = actor && (gm || actor.testUserPermission?.(game.user, "LIMITED"));
      // Scenes: the GM's alone. Players read the card; the GM decides where everyone is.
      const scene = gm && d.enter?.scene ? game.scenes.get(d.enter.scene) : null;
      const foot = [
        // The main button takes everyone (activates the scene); the small one is a look for the GM alone.
        scene ? `<button data-act="enter-all" class="main" title="Activate it: everyone goes there"><i class="fa-solid fa-users"></i> ${esc(d.enter.label)}</button><button data-act="enter" title="View it (only you)"><i class="fa-solid fa-eye"></i> View</button>` : "",
        d.locate ? `<button data-act="locate" title="Show it on the map"><i class="fa-solid fa-location-crosshairs"></i></button>` : "",
        canActor ? `<button data-act="actor"><i class="fa-solid fa-user"></i> ${esc(actor.name)}</button>` : "",
        gm && d.journal ? `<button data-act="journal" title="Open the pinned journal"><i class="fa-solid fa-book-open"></i> Journal</button>` : "",
        gm && d.url ? `<button data-act="wiki" title="Wiki article"><i class="fa-solid fa-arrow-up-right-from-square"></i></button>` : "",
        ...(gm ? d.gmActions ?? [] : []).map((a) => `<button data-act="x-${esc(a.act)}"><i class="fa-solid ${esc(a.icon)}"></i> ${esc(a.label)}</button>`),
        `<span class="sp"></span>`,
        gm && d.img ? `<button data-act="share" title="Show the art to players"><i class="fa-solid fa-image"></i></button>` : "",
        gm ? `<button data-act="edit"><i class="fa-solid fa-pen-to-square"></i> Edit</button>` : ""
      ].join("");
      // The GM's assets (encounters): its actors, to open or drag onto the scene, and its pictures.
      const assets = gm ? assetStrip(d) : "";
      // Tabs (0.65.2): About (what players can know), Trade (its market), GM notes (the GM's alone:
      // notes, the rumours players hear, encounter assets). Only tabs with something in them show.
      const about = `${rows ? `<div class="kgc-rows">${rows}</div>` : ""}
        ${rumoured ? sect("Rumours", rumours || "<p>Only rumours so far.</p>") : sect("What is known", known)}
        ${!rumoured && !known && !rows ? `<p class="kgc-empty">${gm ? "Nothing written yet. Edit to add what is known." : "Little is known about this place."}</p>` : ""}`;
      const trade = !rumoured ? tradeSection(d.trade, gm) : "";
      const gmTab = gm ? `${assets}${vis === "rumoured" && d.rumours ? sect("Rumours (what players hear)", rumours, "kgc-gm") : ""}${sect("GM notes", notes, "kgc-gm")}` : "";
      const panes = [["about", "About", "fa-scroll", about], ["trade", "Trade", "fa-scale-balanced", trade], ["gm", "GM notes", "fa-user-secret", gmTab.trim()]].filter(([k, , , body]) => k === "about" || body);
      if (!panes.some(([k]) => k === this.viewTab)) this.viewTab = "about";
      const tabs = panes.length > 1 ? shellTabs(panes.map(([k, l, i]) => [k, l, i]), this.viewTab, { attr: "data-card-tab", label: "Card" }) : "";
      return `<div class="kgc">
        ${art}
        <header class="kgc-head">${badge}${audience}<h2>${esc(d.name)}</h2>${d.subtitle ? `<p class="kgc-sub">${esc(d.subtitle)}</p>` : ""}</header>
        ${tabs}
        ${panes.map(([k, , , body]) => `<div class="kgc-pane" data-pane="${k}" ${k === this.viewTab ? "" : "hidden"}>${body}</div>`).join("")}
      </div><footer class="kgc-foot">${foot}</footer>`;
    }

    #formHtml(d) {
      const form = { ...(d.form ?? {}), ...(this.draft ?? {}) };
      const field = (f) => {
        const v = form[f.name] ?? "";
        const label = `<label>${esc(f.label)}</label>`;
        if (f.type === "select"||f.type==='icon-pack') return `<div class="kgc-field">${label}<select name="${f.name}">${f.options.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>${f.type==='icon-pack'?`<div class="kgr-icon-pack-preview" data-icon-pack-preview data-default-pack="${iconPack(f.defaultPack)}" role="img" aria-label="Place icon preview"></div>`:''}</div>`;
        if (f.type === "check") return `<div class="kgc-field check"><label><input type="checkbox" name="${f.name}" ${v ? "checked" : ""}> ${esc(f.label)}</label></div>`;
        if (f.type === "number") return `<div class="kgc-field">${label}<input type="number" name="${f.name}" value="${esc(v)}" ${f.attrs ?? ""}></div>`;
        // Art: a thumbnail to click, not a file path.
        if (f.type === "image") return `<div class="kgc-field kgc-art-field"><input type="hidden" name="${f.name}" value="${esc(v)}">
          <button type="button" class="kgc-thumb" data-act="pick" data-field="${f.name}" aria-label="Choose the art" style="${v ? `background-image:url('${esc(foundry.utils.getRoute(v))}')` : ""}"><span>${v ? "Change art" : "Choose art"}</span></button>
          <button type="button" class="kgc-art-clear" data-act="clear-art" data-field="${f.name}" ${v ? "" : "hidden"}>Remove</button></div>`;
        // Who sees it: three visible choices, and a line saying what players get with the one chosen.
        if (f.type === "visibility") return `<div class="kgc-field wide"><input type="hidden" name="${f.name}" value="${esc(v)}">
          <div class="kgc-seg" role="radiogroup" aria-label="${esc(f.label)}">${f.options.map(([k, l]) => `<button type="button" role="radio" aria-checked="${k === v}" class="${k === v ? "on" : ""}" data-act="vis" data-field="${f.name}" data-value="${esc(k)}">${esc(l)}</button>`).join("")}</div>
          <p class="hint kgc-vis-hint">${VIS_HINT[v] ?? ""}</p></div>`;
        // Rich text: a preview, and a button for the full-size editor (textWindow).
        if (f.type === "rich") return `<div class="kgc-field wide rich">${label}<input type="hidden" name="${f.name}" value="${esc(v)}">
          <div class="kgc-preview" data-act="write" data-field="${f.name}" title="Edit the text">${preview(v)}</div>
          <div class="kgc-inline"><button type="button" data-act="write" data-field="${f.name}"><i class="fa-solid fa-pen-nib"></i> Edit text</button>${f.hint ? `<p class="hint">${f.hint}</p>` : ""}</div></div>`;
        if (f.type === "textarea") return `<div class="kgc-field wide">${label}<textarea name="${f.name}" rows="${f.rows ?? 3}" placeholder="${esc(f.placeholder ?? "")}">${esc(v)}</textarea></div>`;
        if (f.type === "doc") return `<div class="kgc-field wide">${label}<div class="kgc-drop" data-drop="${f.doc}" data-field="${f.name}">${docBox(f, v)}</div></div>`;
        if (f.type === "docs" || f.type === "images") return `<div class="kgc-field wide">${label}<div class="kgc-drop kgc-list" data-drop="${f.doc ?? "image"}" data-field="${f.name}">${listBox(f, Array.isArray(v) ? v : [])}</div></div>`;
        return `<div class="kgc-field ${f.wide ? "wide" : ""}">${label}<input type="text" name="${f.name}" value="${esc(v)}" placeholder="${esc(f.placeholder ?? "")}"></div>`;
      };
      // One box per group: what the place is, who sees it, its text, its links, its marker.
      const box = (g, title) => {
        const list = (d.fields ?? []).filter((f) => (f.group ?? "") === g);
        if (!list.length) return "";
        const art = list.find((f) => f.type === "image"), rest = list.filter((f) => f !== art);
        const inner = art ? `<div class="kgc-ident">${field(art)}<div class="kgc-grid">${rest.map(field).join("")}</div></div>` : `<div class="kgc-grid">${rest.map(field).join("")}</div>`;
        // The Text box takes a dropped journal page: its text is copied into What is known.
        const drop = g === "text" ? ` data-drop="journal"` : "";
        const note = g === "text" ? `<p class="hint">Drop a journal page on this box to copy its text into What is known, hidden until you reveal it.</p>` : "";
        return title ? `<fieldset class="kgc-group"${drop}><legend>${title}</legend>${inner}${note}</fieldset>` : inner;
      };
      // The boxes in tabs (0.65.2): Text (identity, who sees it, the text), On the map, Trade, Links.
      // Every field stays in the form (hidden tabs are only hidden), so Save takes them all.
      const panes = FORM_TABS.map(([k, label, icon, groups]) => [k, label, icon, GROUPS.filter(([g]) => groups.includes(g)).map(([g, t]) => box(g, t)).join("")]);
      const trade = d.trade ? `<div class="kgc-form-trade">${tradeSection(d.trade, true)}<p class="hint">Trade is saved on its own: Edit trade opens the trade editor.</p></div>` : "";
      const shown = [...panes.slice(0, 2), ["trade", "Trade", "fa-scale-balanced", trade], panes[2]].filter(([k, , , body]) => k === "text" || body);
      if (!shown.some(([k]) => k === this.formTab)) this.formTab = "text";
      const tabs = shown.length > 1 ? shellTabs(shown.map(([k, l, i]) => [k, l, i]), this.formTab, { attr: "data-card-tab", label: "Edit" }) : "";
      const boxes = `${tabs}${shown.map(([k, , , body]) => `<div class="kgc-pane" data-pane="${k}" ${k === this.formTab ? "" : "hidden"}>${body}</div>`).join("")}`;
      return `<form class="kgc kgc-form" autocomplete="off">${boxes}</form><footer class="kgc-foot">
        ${d.canDelete ? `<button data-act="delete" class="danger"><i class="fa-solid fa-trash"></i> ${esc(d.deleteLabel ?? "Delete")}</button>` : ""}
        <span class="sp"></span>${this.dirty ? `<span class="kgc-dirty"><i class="fa-solid fa-circle"></i> unsaved</span>` : ""}
        <button data-act="discard"><i class="fa-solid fa-rotate-left"></i> ${this.dirty ? "Discard" : "Cancel"}</button>
        <button data-act="save" class="main"><i class="fa-solid fa-check"></i> Save</button>
      </footer>`;
    }

    _replaceHTML(html, content) {
      content.innerHTML = html;
      const title = this.element?.querySelector(".window-title");
      if (title) title.textContent = this.data?.name ?? "Place";
      // The content element is kept from render to render: listen once.
      if (!content.kgcBound) {
        content.kgcBound = true;
        content.addEventListener("click", (e) => this.#click(e));
        content.addEventListener("input", () => this.#markDirty());
        content.addEventListener("change", () => this.#markDirty());
        content.addEventListener("dragover", (e) => { if (e.target.closest?.("[data-drop]")) e.preventDefault(); });
        content.addEventListener("dragstart", assetDrag);
        content.addEventListener("drop", (e) => this.#drop(e));
      }
      this.#decorate(content);
    }

    #decorate(root) {
      if(this.editing){
        const preview=root.querySelector('[data-icon-pack-preview]'),select=root.querySelector('select[name="iconPack"]'),category=root.querySelector('select[name="category"]');
        if(preview&&select){const draw=()=>this.#paintIconPreview(root);select.addEventListener('change',draw);category?.addEventListener('change',draw);draw();}
      }
      // GM: reveal or hide each secret block of What is known, in place.
      if (game.user.isGM && !this.editing) {
        // One button per block: Foundry's own Reveal button (it is not wired up outside Foundry's
        // sheets) becomes ours, or one is added; a label says who sees the block now.
        root.querySelectorAll(".kgc-sect:not(.kgc-gm) section.secret").forEach((sec, i) => {
          const shown = sec.classList.contains("revealed");
          const b = sec.querySelector(":scope > button.reveal") ?? document.createElement("button");
          b.type = "button";
          b.className = "reveal kgc-reveal-btn";
          b.dataset.act = "reveal";
          b.dataset.i = i;
          b.innerHTML = shown ? '<i class="fa-solid fa-eye-slash"></i> Hide' : '<i class="fa-solid fa-eye"></i> Reveal';
          b.title = shown ? "Hide this from players again" : "Show this to players";
          const label = document.createElement("span");
          label.className = "kgc-reveal";
          label.innerHTML = shown ? '<i class="fa-solid fa-eye"></i> Shown to players' : '<i class="fa-solid fa-eye-slash"></i> GM only';
          sec.prepend(label, b);
        });
      }
    }

    #refreshIconDefault(scene){
      if(!this.editing||this.ref?.kind!=='local'||!scene||this.ref.scene!==scene.id)return;
      const preview=this.element?.querySelector('[data-icon-pack-preview]'),select=this.element?.querySelector('select[name="iconPack"]');if(!preview||!select)return;
      const pack=resolvedIconPack(scene.getFlag('kg-realms','localMap'));if(preview.dataset.defaultPack===pack)return;preview.dataset.defaultPack=pack;
      const inherited=[...select.options].find(o=>o.value==='');if(inherited)inherited.textContent=`Use map default (${ICON_PACKS[pack]})`;
      this.#paintIconPreview(this.element);
    }

    #paintIconPreview(root){
      const preview=root.querySelector('[data-icon-pack-preview]'),select=root.querySelector('select[name="iconPack"]'),category=root.querySelector('select[name="category"]');
      if(preview&&select)paintIconPackPreview(preview,iconPackOverride(select.value)??iconPack(preview.dataset.defaultPack),[(CATEGORIES[category?.value]??CATEGORIES.other).glyph]);
    }

    #markDirty() {
      if (!this.editing || this.dirty) return;
      this.dirty = true;
      const foot = this.element?.querySelector(".kgc-foot");
      if (foot && !foot.querySelector(".kgc-dirty")) {
        const s = document.createElement("span");
        s.className = "kgc-dirty";
        s.innerHTML = '<i class="fa-solid fa-circle"></i> unsaved';
        foot.querySelector(".sp")?.after(s);
        const d = foot.querySelector('[data-act="discard"]');
        if (d) d.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Discard';
      }
    }

    /** The form's values, by field type. */
    #values() {
      const form = this.element.querySelector("form.kgc-form"), out = {};
      for (const f of this.data.fields ?? []) {
        const el = form.querySelector(`[name="${f.name}"]`);
        if (!el) continue;
        if (f.type === "check") out[f.name] = el.checked;
        else if (f.type === "docs" || f.type === "images") { try { out[f.name] = JSON.parse(el.value || "[]"); } catch { out[f.name] = []; } }
        else if (f.type === "number") out[f.name] = el.value === "" ? null : Number(el.value);
        else out[f.name] = String(el.value ?? "").trim();
      }
      return out;
    }

    async #click(e) {
      // A tab: shown in place (no redraw, so edits in the form stay).
      const tab = e.target.closest("[data-card-tab]");
      if (tab) {
        e.preventDefault();
        const k = tab.dataset.cardTab, root = tab.closest(".kgc");
        this[this.editing ? "formTab" : "viewTab"] = k;
        for (const t of root.querySelectorAll("[data-card-tab]")) { const on = t.dataset.cardTab === k; t.classList.toggle("on", on); t.setAttribute("aria-selected", on); }
        for (const p of root.querySelectorAll(":scope > .kgc-pane")) p.hidden = p.dataset.pane !== k;
        return;
      }
      const b = e.target.closest("[data-act]");
      if (!b) return;
      e.preventDefault();
      const act = b.dataset.act, d = this.data;
      if (act === "trade-edit") { if (game.user.isGM) return this.def.editTrade?.(this.ref); return; }
      if (act === "trade-price" || act === "trade-price-close") {
        const box = this.element.querySelector(".kgt-price-detail"), row = d.trade?.rows.find(r => r.key === b.dataset.tradeKey && (game.user.isGM || !r.hidden));
        if (!box) return;
        box.hidden = !row;
        box.innerHTML = row ? priceDetail(row, d.trade.scale) : "";
        if (row) box.scrollIntoView({ block: "nearest" });
        return;
      }
      if (act === "edit") { this.editing = true; this.editOnly = false; this.dirty = false; this.draft = null; return this.render(); }
      if (act === "discard") {
        if (this.dirty && !(await this.confirmDiscard())) return;
        this.editing = false; this.dirty = false; this.draft = null;
        return this.editOnly ? this.close() : this.render();
      }
      if (act === "save") {
        const values = this.#values();
        this.editing = false; this.dirty = false; this.draft = null;
        await this.def.save(this.ref, values);
        return this.editOnly ? this.close() : this.render();
      }
      if (act.startsWith("x-")) { await this.def.act?.(this.ref, act.slice(2)); return this.rendered && this.render(); }
      if (act === "delete") {
        const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: d.deleteLabel ?? "Delete" }, content: `<p>${esc(d.deleteLabel ?? "Delete")} <b>${esc(d.name)}</b>?</p>${d.deleteNote ? `<p class="hint">${esc(d.deleteNote)}</p>` : ""}`, rejectClose: false });
        if (!ok) return;
        this.dirty = false;
        await this.def.remove(this.ref);
        return this.close();
      }
      if (act === "pick" || act === "clear-art") {
        const box = b.closest(".kgc-art-field"), input = box.querySelector("input"), thumb = box.querySelector(".kgc-thumb");
        const set = (path) => {
          input.value = path;
          thumb.style.backgroundImage = path ? `url('${foundry.utils.getRoute(path)}')` : "";
          thumb.querySelector("span").textContent = path ? "Change art" : "Choose art";
          box.querySelector(".kgc-art-clear").hidden = !path;
          this.#markDirty();
        };
        if (act === "clear-art") return set("");
        return new foundry.applications.apps.FilePicker.implementation({ type: "image", current: input.value, callback: set }).render(true);
      }
      if (act === "vis") {
        const box = b.closest(".kgc-field");
        box.querySelector("input").value = b.dataset.value;
        for (const x of box.querySelectorAll("[data-act=vis]")) { x.classList.toggle("on", x === b); x.setAttribute("aria-checked", x === b); }
        box.querySelector(".kgc-vis-hint").textContent = VIS_HINT[b.dataset.value] ?? "";
        return this.#markDirty();
      }
      if (act === "clear") {
        const box = b.closest("[data-drop]"), f = this.data.fields.find((x) => x.name === box.dataset.field);
        box.innerHTML = docBox(f, "");
        return this.#markDirty();
      }
      // List fields: take one out, or (pictures) add one with the file picker.
      if (act === "list-remove" || act === "list-add") {
        const box = b.closest("[data-drop]"), f = this.data.fields.find((x) => x.name === box.dataset.field);
        const list = JSON.parse(box.querySelector("input").value || "[]");
        const put = (l) => { box.innerHTML = listBox(f, l); this.#markDirty(); };
        if (act === "list-remove") { list.splice(Number(b.dataset.i), 1); return put(list); }
        return new foundry.applications.apps.FilePicker.implementation({ type: "image", callback: (path) => path && put([...list, path]) }).render(true);
      }
      if (act === "journal") return openPinned(d.journal);
      if (act === "actor-n") return openDoc(d.actors?.[Number(b.dataset.i)]);
      if (act === "pic") {
        const P = foundry.applications.apps.ImagePopout;
        return new P({ src: d.images[Number(b.dataset.i)], window: { title: d.name } }).render(true);
      }
      if (act === "write") return this.#write(b.dataset.field);
      if (act === "art") {
        const P = foundry.applications.apps.ImagePopout;
        return new P({ src: d.img, window: { title: d.name } }).render(true);
      }
      if (act === "share") {
        const P = foundry.applications.apps.ImagePopout;
        const pop = new P({ src: d.img, window: { title: d.name }, uuid: null });
        await pop.render(true);
        return pop.shareImage?.();
      }
      if (act === "enter" || act === "enter-all") {
        // Once there, the card is done.
        await this.def.enter?.(this.ref, act === "enter-all");
        return this.close();
      }
      if (act === "locate") return this.def.locate?.(this.ref);
      if (act === "actor") return openDoc(d.actor);
      if (act === "wiki") return window.open(d.url, "_blank", "noopener");
      if (act === "reveal") return this.#reveal(Number(b.dataset.i));
    }

    /** Reveal (or hide again) the i-th secret block of What is known. */
    async #reveal(i) {
      const div = document.createElement("div");
      div.innerHTML = this.data.known ?? "";
      const sec = div.querySelectorAll("section.secret")[i];
      if (!sec) return;
      sec.classList.toggle("revealed");
      await this.def.save(this.ref, { known: div.innerHTML });
      return this.render();
    }

    /** A rich text field in the full-size editor; Done puts the text back in the form (still unsaved). */
    async #write(name) {
      const f = this.data.fields.find((x) => x.name === name), input = this.element.querySelector(`input[name="${name}"]`);
      if (!f || !input) return;
      const ref = {...this.ref}, refKey = JSON.stringify(ref);
      const html = await textWindow({ id: `${refKey}:${name}`, title: `${this.data.name}: ${f.label.replace(/\s*\(.*\)$/, "")}`, value: input.value, hint: f.hint, getPlaces: () => this.cards.placeChoices?.(ref) });
      // The card may have been drawn again (or closed, or saved) while the editor was open.
      const now = this.rendered && this.editing && JSON.stringify(this.ref) === refKey ? this.element.querySelector(`input[name="${name}"]`) : null;
      if (html == null || !now || html === now.value) return;
      now.value = html;
      const box = this.element.querySelector(`.kgc-preview[data-field="${name}"]`);
      if (box) box.innerHTML = preview(html);
      this.#markDirty();
    }

    async #drop(e) {
      const box = e.target.closest?.("[data-drop]");
      if (!box) return;
      e.preventDefault();
      // An actor or a scene from the sidebar (or an actor from a compendium).
      const f = this.data.fields.find((x) => x.name === box.dataset.field);
      if (f?.type === "docs") {
        let data = null;
        try { data = TE().getDragEventData(e); } catch { /* not a document */ }
        if (data?.type !== f.doc || !data.uuid) return ui.notifications.warn(`KG Realms: drop ${DROP_WHAT[f.doc] ?? "a document"}.`);
        const list = JSON.parse(box.querySelector("input").value || "[]");
        if (!list.includes(data.uuid)) list.push(data.uuid);
        box.innerHTML = listBox(f, list);
        return this.#markDirty();
      }
      if (f?.type === "doc") {
        let data = null;
        try { data = TE().getDragEventData(e); } catch { /* not a document */ }
        const what = DROP_WHAT[f.doc] ?? "a document";
        // A journal field takes a whole journal or one of its pages.
        const fits = data?.type === f.doc || (f.doc === "JournalEntry" && data?.type === "JournalEntryPage");
        if (!fits || !data.uuid) return ui.notifications.warn(`KG Realms: drop ${what}.`);
        const doc = fromUuidSync(data.uuid, { strict: false });
        let value = data.uuid;
        if (f.doc === "Scene") {
          if (!doc || data.uuid.startsWith("Compendium.")) return ui.notifications.warn("KG Realms: import the scene into the world first, then drop it from the Scenes sidebar.");
          if (doc.id === f.except) return ui.notifications.warn("KG Realms: a place cannot link the scene it is on.");
          value = doc.id;
        }
        box.innerHTML = docBox(f, value);
        return this.#markDirty();
      }
      // A journal page's text, copied into What is known as a secret block. The journal is not linked.
      const uuid = journalFromDrop(e);
      if (!uuid) return ui.notifications.warn("KG Realms: drop a journal page.");
      const doc = await fromUuid(uuid);
      const html = doc?.text?.content ?? doc?.pages?.contents?.map((p) => p.text?.content ?? "").join("") ?? "";
      if (!html) return ui.notifications.warn("KG Realms: that journal has no text.");
      // The form as it stands, with the text added: drawn again, still unsaved.
      const values = this.#values();
      this.draft = { ...values, known: `${values.known ?? ""}${asSecret(html)}` };
      this.dirty = true;
      await this.render();
      ui.notifications.info(`KG Realms: ${doc.name} copied in, hidden from players until you reveal it.`);
    }
  };
  return CardClass;
}
