// Local maps in Foundry: a scene that is the map of one realm place, with its places as map Notes
// flagged kg-realms.local (so a city scene carries its places when exported). This file draws
// them (a badge for the category, the place's name), shows a hover card, opens a place's card on a
// double-click, keeps hidden places from players, and turns an existing scene with journal pins
// into a local map (the pins' journal text goes into the places' cards; no journal stays linked).
import { CATEGORIES, VISIBILITY, categoryFor, cleanLabel, scaleCheck, across, localRecord, localAssetEdits, markerAtZoom, alwaysShown } from "./local-places.mjs";
import { worldUrl, defaultWorldId } from "./worlds.mjs";
import { asHtml, asSecret, excerptHtml } from "./place-card.mjs";
import { LocalEditor } from "./ui-local.mjs";
import { isPrimaryGM } from "./authority.mjs";
import { settlementAmbience } from "./scene-ambience.mjs";
import {settlementEntrances} from './settlement-entry.mjs';
import { mapAsset } from "./local-map-renderer.mjs";
import { dockSceneTrail, observeMapUi } from "./ui-docking.mjs";
import {ICON_PACKS,iconPackOverride,worldIconPack,resolvedIconPack,iconPackOptions,markerCanvas,markerFontFamily} from './local-icon-packs.mjs';

const MODULE_ID = "kg-realms";
/** How long the zoom stays still before which places show is decided again (the settle delay). */
const SETTLE_MS = 450;
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const KINDS_WITH_MAPS = new Set(["settlement", "site"]);

/** The local map record of a scene: { world, placeId, name, unplaced: [{ journal, name, category }], markerScale }, or null. */
export const localMapOf = (scene) => scene?.getFlag?.(MODULE_ID, "localMap") ?? null;
/** Where a place's own scene (a tavern map, a battlemap) goes back to: { scene, note, name, map }, or null. */
export const returnOf = (scene) => scene?.getFlag?.(MODULE_ID, "returnTo") ?? null;
/** A note's local place record, or null. */
export const localOf = (note) => {
  const doc = note?.document ?? note;
  return doc?.getFlag?.(MODULE_ID, "local") ?? null;
};

/** A journal page's (or entry's) text, read once to copy it into a card. */
function pageHtml(doc) {
  if (!doc) return "";
  return doc.documentName === "JournalEntry" ? doc.pages.contents.map((p) => p.text?.content ?? "").join("") : doc.text?.content ?? "";
}

/**
 * A scene's background picture. Foundry 14 keeps it on the scene's Levels (the starting level here;
 * Scene#background is deprecated there); earlier versions on the scene itself.
 */
const onLevels = (scene) => (game.release?.generation ?? 13) >= 14 && !!scene?.levels;
const startLevel = (scene) => scene.initialLevel ?? scene.firstLevel ?? scene.levels.contents?.[0] ?? null;
export function backgroundOf(scene) {
  if (onLevels(scene)) return startLevel(scene)?.background?.src ?? null;
  return scene?.background?.src ?? null;
}
export async function setBackground(scene, src, color = null) {
  if (onLevels(scene)) {
    const level = startLevel(scene);
    if (level) return level.update({ "background.src": src, ...(color ? { "background.color": color } : {}) });
    return scene.createEmbeddedDocuments("Level", [{ name: scene.name, background: { src, ...(color ? { color } : {}) } }]);
  }
  return scene.update({ "background.src": src, ...(color ? { backgroundColor: color } : {}) });
}

/** Calendaria's weather on a scene is snow of some kind. */
const SNOWY = new Set(["snow", "sleet", "blizzard", "ice-storm"]);
function snowing(scene) {
  try {
    const w = globalThis.CALENDARIA?.managers?.WeatherManager?.getCurrentWeather?.(null, scene);
    return SNOWY.has(w?.id);
  } catch { return false; }
}

/* ------------------------------------------------------------------ markers */

const textures = new Map(); // Bounded by four packs, thirteen categories and two visibility states.
let fontReady = null;

async function loadFont() {
  fontReady ??= document.fonts.load(`900 48px ${markerFontFamily()}`, "").catch(() => null);
  return fontReady;
}

function markerTexture(category, rumoured, pack) {
  category = Object.hasOwn(CATEGORIES, category) ? category : 'other';
  const key = `${pack}|${category}|${rumoured ? 1 : 0}`;
  if (!textures.has(key)) textures.set(key, PIXI.Texture.from(markerCanvas(CATEGORIES[category].glyph, pack, rumoured)));
  return textures.get(key);
}

export class LocalMaps {
  /**
   * getRealmPlaces(world): the realm's places with the GM's edits; savePlaceEdit(world, id, fields);
   * realmScenes(): the realm scenes, to go back to.
   */
  constructor(deps) {
    Object.assign(this, deps);
    this.card = null;
    this.bar = null;
    this.focus = null; // { scene, note } or { scene, placeId }: where to centre once that scene is drawn
    this.editor = new LocalEditor(this);
    this.editor.onClose = () => { const t = ui.controls?.controls?.notes?.tools?.kgRealmsLocal; if (t) t.active = false; ui.controls?.render(); };
  }

  localMapOf(scene) { return localMapOf(scene); }
  localOf(note) { return localOf(note); }

  async setIconPack(scene,value){
    if(!game.user.isGM||!localMapOf(scene))return;
    await scene.setFlag(MODULE_ID,'localMap.iconPack',iconPackOverride(value));this.refreshMarkers(scene,true);
  }

  install() {
    const Note = foundry.canvas.placeables.Note;
    const self = this;
    // Players see a local place unless it is hidden, whatever its journal's permissions; the GM always.
    let vis = null;
    for (let proto = Note.prototype; proto && !vis; proto = Object.getPrototypeOf(proto)) vis = Object.getOwnPropertyDescriptor(proto, "isVisible");
    if (vis?.get) Object.defineProperty(Note.prototype, "isVisible", {
      configurable: true,
      get() {
        const rec = localOf(this);
        if (!rec) return vis.get.call(this);
        if (game.user.isGM) return true;
        return rec.visibility !== "hidden";
      }
    });
    // Foundry lets a note be double-clicked only if the user may view its journal entry, and local
    // places link none: they may be "viewed" (their card opened) by the GM, and by players unless hidden.
    const canView = Note.prototype._canView;
    Note.prototype._canView = function (user) {
      const rec = localOf(this);
      if (!rec) return canView.call(this, user);
      return user.isGM || rec.visibility !== "hidden";
    };
    // Double-click: the place's card. Not Foundry's own note sheet, never a journal.
    const dbl = Note.prototype._onClickLeft2;
    Note.prototype._onClickLeft2 = function (event) {
      const rec = localOf(this);
      if (!rec) return dbl.call(this, event);
      return self.open(this);
    };
    Hooks.on("drawNote", (note) => this.#style(note));
    Hooks.on("canvasPan", () => this.fitAllToZoom());
    Hooks.on("refreshNote", (note) => this.#style(note));
    Hooks.on('updateNote', (doc) => { if(doc.parent === canvas.scene){const note=doc.object??canvas.notes?.get(doc.id);if(note)this.#style(note);} });
    // The hover card waits as the realm map's does (the Place card hover delay setting).
    Hooks.on("hoverNote", (note, hovered) => {
      clearTimeout(this.hoverTimer);
      if (!hovered) return this.#hideCard();
      this.hoverTimer = setTimeout(() => { if (note.hover && !note.destroyed) this.#showCard(note); }, Math.max(0, Number(this.hoverDelayMs?.()) || 0));
    });
    Hooks.on("canvasTearDown", () => {
      this.#hideCard();this.markerAppearance=null;this.markerEpoch=(this.markerEpoch??0)+1;clearTimeout(this.settleTimer);this.settledZoom=null;
      for(const note of canvas.notes?.placeables??[])if(note.kgrMarker&&!note.kgrMarker.destroyed){note.kgrMarker.visible=false;note.kgrMarker.texture=PIXI.Texture.EMPTY;}
      for(const texture of textures.values())texture.destroy(true);textures.clear();
    });
    // On a local map its places always show (each place's visibility decides who sees it), not only
    // when the user has turned on Foundry's notes display.
    const showNotes = () => { if (localMapOf(canvas.scene) && canvas.notes?.objects) canvas.notes.objects.visible = true; };
    Hooks.on("canvasReady", showNotes);
    Hooks.on("deactivateNotesLayer", showNotes);
    Hooks.on("deactivateCanvasLayer", showNotes);
    Hooks.on("canvasReady", () => { const scene=canvas.scene,epoch=this.markerEpoch=(this.markerEpoch??0)+1;return loadFont().then(() => { if(canvas.scene!==scene||this.markerEpoch!==epoch)return;const previous=[...textures.values()];textures.clear();this.refreshMarkers(scene,true);for(const texture of previous)texture.destroy(true); }); });
    // The Scenes sidebar: a badge on local maps, and Make local map / Local map settings.
    Hooks.on("renderSceneDirectory", (app, html) => this.#badges(html));
    // The way back: a bar on a place's own scene (to the local map) and on a local map (to the realm).
    Hooks.on("canvasReady", () => { this.#drawBar(); this.#centre(); this.ensureEntrance().catch(error => console.warn('kg-realms | entrance setup:', error)); });
    Hooks.on("canvasTearDown", () => { this.editor.close(); this.#removeBar(); });
    Hooks.on("updateScene", (scene, changes) => { if(scene!==canvas.scene)return;if(foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`))this.#drawBar();this.refreshMarkers(scene); });
    // The GM's Local places tool, with the Journal Notes tools, on a local map.
    Hooks.on("getSceneControlButtons", (controls) => {
      if (!game.user.isGM || !localMapOf(canvas.scene) || !controls.notes) return;
      controls.notes.tools.kgRealmsLocal = {
        name: "kgRealmsLocal", title: "Local places (add, move, edit, link scenes)", icon: "fa-solid fa-map-location-dot",
        order: 101, toggle: true, active: this.editor.active, onChange: (event, active) => this.editor.toggle(active)
      };
    });
    for (const hook of ["getSceneContextOptions", "getSceneDirectoryEntryContext"]) Hooks.on(hook, (app, options) => this.#contextOptions(options));
  }

  /* ---------------------------------------------------------------- drawing */

  refreshMarkers(scene=globalThis.canvas?.scene,force=false){
    if(!scene||scene!==globalThis.canvas?.scene)return;const map=localMapOf(scene),key=`${scene.id}|${resolvedIconPack(map)}|${Number(map?.markerScale)||1}`;
    if(!force&&this.markerAppearance===key)return;this.markerAppearance=key;
    for(const note of canvas.notes?.placeables??[])this.#style(note);
  }

  /**
   * A local place's marker: its own sprite on the note, over Foundry's note icon, which stays (unseen)
   * for clicks, dragging and selection.
   */
  #style(note) {
    if(note.destroyed||!note.document)return;
    const rec = localOf(note), icon = note.controlIcon;
    if (!rec) { if (note.kgrMarker && !note.kgrMarker.destroyed) note.kgrMarker.visible = false;if(note.kgrMarkerHalo&&!note.kgrMarkerHalo.destroyed)note.kgrMarkerHalo.visible=false; if (icon) icon.alpha = 1; if (note.tooltip && !note.tooltip.destroyed) note.tooltip.renderable = true; return; }
    if (!icon) return;
    // No name label on a place's marker (its card has the name): Foundry's hover label is hidden.
    if (note.tooltip && !note.tooltip.destroyed) { note.tooltip.visible = false; note.tooltip.renderable = false; }
    const rumoured = rec.visibility === "rumoured" && !game.user.isGM;
    const scale = Number(localMapOf(note.document.parent)?.markerScale ?? 1) || 1;
    const pack = resolvedIconPack(localMapOf(note.document.parent), rec);
    let m = note.kgrMarker;
    if (!m || m.destroyed) {
      m = note.kgrMarker = new PIXI.Sprite();
      m.anchor.set(0.5);
      m.eventMode = "none";
      note.addChild(m);
    }
    m.visible = true;
    m.texture = markerTexture(rec.category, rumoured, pack);
    icon.alpha = pack==='current'&&(note.controlled||note.hover) ? 0.35 : 0;
    // Hidden places: the GM sees them faded.
    m.alpha = rec.visibility === "hidden" ? 0.45 : 1;
    if (rumoured && note.tooltip) note.tooltip.text = `${rec.name} (rumoured)`;
    this.#fitZoom(note, rec, scale, pack);
  }

  /**
   * Size a place's marker for the zoom (local-places.mjs markerAtZoom): with the map, within limits
   * on screen; zoomed far out only the always shown places stay. Foundry's own icon, which takes the
   * clicks, is sized to match.
   */
  #fitZoom(note, rec = localOf(note), scale = Number(localMapOf(note.document?.parent)?.markerScale ?? 1) || 1, pack = resolvedIconPack(localMapOf(note.document?.parent), rec)) {
    const icon = note.controlIcon, m = note.kgrMarker;
    if (!rec || !icon || !m || m.destroyed || note.destroyed) return;
    const size = note.document.iconSize || 48, base = size * scale, zoom = canvas.stage?.scale?.x || 1;
    const busy = note.controlled || note.hover || note._dragPassthrough || note.isPreview;
    // Sized for the zoom as it changes; shown or hidden by the zoom once it has settled (fitAllToZoom).
    const fit = markerAtZoom(base, zoom, { always: alwaysShown(rec) || busy });
    fit.visible = markerAtZoom(base, this.settledZoom ?? zoom, { always: alwaysShown(rec) || busy }).visible;
    // Foundry's icon sits with its corner at the note's position less half its size: keep its centre.
    const k = scale * fit.factor, cx = icon.x + size * icon.scale.x / 2, cy = icon.y + size * icon.scale.y / 2;
    icon.scale.set(k); icon.position.set(cx - size * k / 2, cy - size * k / 2);
    m.width = m.height = base * fit.factor; m.position.set(cx, cy);
    note.visible = (note.isVisible ?? true) && fit.visible;
    const selected = pack !== 'current' && (note.controlled || note.hover); let halo = note.kgrMarkerHalo;
    if (selected) {
      if (!halo || halo.destroyed) { halo = note.kgrMarkerHalo = new PIXI.Graphics(); halo.eventMode = 'none'; note.addChildAt(halo, note.getChildIndex(m)); }
      halo.clear().lineStyle(Math.max(1, base * fit.factor * .035), 0xeed596, .8).drawCircle(cx, cy, base * fit.factor * .51);
    }
    if (halo && !halo.destroyed) halo.visible = !!selected;
  }

  /** On zoom: every place's marker, once a frame at most. */
  fitAllToZoom() {
    if (!localMapOf(canvas?.scene)) return;
    // near: only the places on or near the screen (while the view moves); else all of them.
    const all = (near = false) => {
      let box = null;
      if (near) { const { width, height } = canvas.app.renderer.screen, t = canvas.stage.worldTransform, a = t.applyInverse({ x: 0, y: 0 }), b = t.applyInverse({ x: width, y: height }), m = (b.x - a.x) * 0.25; box = [a.x - m, a.y - m, b.x + m, b.y + m]; }
      for (const note of canvas.notes?.placeables ?? []) { if (box && (note.x < box[0] || note.x > box[2] || note.y < box[1] || note.y > box[3])) continue; if (note.kgrMarker && localOf(note)) this.#fitZoom(note); }
    };
    // The settle delay: which places show is decided once the zoom has been still a moment, and every
    // place (not only those near the screen) is sized for it then.
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => { this.settledZoom = canvas.stage?.scale?.x || 1; all(); }, SETTLE_MS);
    if (this.settledZoom == null) this.settledZoom = canvas.stage?.scale?.x || 1;
    if (this.zoomFrame) return;
    this.zoomFrame = requestAnimationFrame(() => { this.zoomFrame = 0; all(true); });
  }
  /* ---------------------------------------------------------------- hover card */

  #showCard(note) {
    const rec = localOf(note);
    if (!rec) return;
    this.#hideCard();
    const gm = game.user.isGM, rumoured = rec.visibility === "rumoured" && !gm;
    const text = rumoured ? (excerptHtml(rec.rumours) || "Only rumours so far.") : (excerptHtml(rec.known) || excerptHtml(rec.summary));
    const img = rumoured ? null : (rec.img || null);
    const cat = CATEGORIES[rec.category] ?? CATEGORIES.other;
    const badge = `<span class="badge"><i class="fa-solid ${cat.icon}"></i>${esc(cat.label)}</span>`;
    const map = localMapOf(note.document.parent);
    const target = rec.scene && gm ? game.scenes.get(rec.scene) : null;
    const foot = [
      `<span><i class="fa-solid fa-id-card"></i> Double-click for the card</span>`,
      target ? `<span><i class="fa-solid fa-film"></i> ${esc(target.name)}</span>` : ""
    ].filter(Boolean).join("");
    const el = document.createElement("div");
    el.className = `kgr-ui kgr-panel kgr-card ${img ? "" : "small"}`;
    el.innerHTML = `
      ${img ? `<div class="art" style="background-image:url('${esc(foundry.utils.getRoute(img))}')">${badge}</div>` : ""}
      <div class="body ${img ? "" : "top"}">
        ${img ? "" : `<div>${badge}</div>`}
        <h3>${esc(rec.name)}</h3>
        ${map?.name ? `<p class="sub">${esc(map.name)}</p>` : ""}
        ${rec.privateEntry ? '<p class="kgr-entry-warning">Private entrance. Entry may be prohibited without permission.</p>' : ""}
        ${text ? `<p>${text}</p>` : ""}
        ${gm && rec.visibility !== "discovered" ? `<div class="meta"><span><i class="fa-solid fa-eye-slash"></i>${esc(VISIBILITY[rec.visibility])} to players</span></div>` : ""}
        ${gm && rec.gmNotes ? `<p class="hint">${excerptHtml(rec.gmNotes)}</p>` : ""}
      </div>
      ${foot ? `<div class="foot">${foot}</div>` : ""}`;
    document.body.append(el);
    this.card = el;
    const r = canvas.app.view.getBoundingClientRect(), p = canvas.stage.worldTransform.apply(note.center);
    const w = el.offsetWidth || 360, h = el.offsetHeight || 260;
    let left = r.left + p.x + 30, top = r.top + p.y + 20;
    if (left + w > window.innerWidth - 8) left = r.left + p.x - w - 30;
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  #hideCard() { this.card?.remove(); this.card = null; }

  /** Open a local place's card. */
  open(note, { edit = false } = {}) {
    const doc = note.document ?? note;
    this.#hideCard();
    return this.openCard?.({ kind: "local", scene: doc.parent.id, note: doc.id }, { edit });
  }

  /* ---------------------------------------------------------------- sidebar */

  #badges(html) {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;
    for (const li of root.querySelectorAll("[data-entry-id], [data-document-id]")) {
      const scene = game.scenes.get(li.dataset.entryId ?? li.dataset.documentId);
      const map = localMapOf(scene);
      li.querySelector(".kgr-local-badge")?.remove();
      if (!map) continue;
      const b = document.createElement("span");
      b.className = "kgr-local-badge";
      b.title = `Local map of ${map.name}`;
      b.innerHTML = `<i class="fa-solid fa-map-location-dot"></i>`;
      (li.querySelector(".entry-name, .document-name, h4, a") ?? li).append(b);
    }
  }

  #contextOptions(options) {
    if (!Array.isArray(options)) return;
    const scene = (li) => { const el = li instanceof HTMLElement ? li : li?.[0]; return game.scenes.get(el?.dataset?.entryId ?? el?.dataset?.documentId); };
    options.push(
      { name: "Make local map", icon: '<i class="fa-solid fa-map-location-dot"></i>', condition: (li) => game.user.isGM && !localMapOf(scene(li)) && !scene(li)?.getFlag(MODULE_ID, "world"), callback: (li) => this.make(scene(li)) },
      { name: "Local map settings", icon: '<i class="fa-solid fa-map-location-dot"></i>', condition: (li) => game.user.isGM && !!localMapOf(scene(li)), callback: (li) => this.settings(scene(li)) }
    );
  }

  /* ---------------------------------------------------------------- making a local map */

  /** One prompt at a time. A required gate is placed before dock setup can begin. */
  ensureEntrance(scene = globalThis.canvas?.scene, {editorOpen = false, afterPlacement = false} = {}) {
    const map=localMapOf(scene);
    if(!isPrimaryGM()||!map?.placeId||scene!==globalThis.canvas?.scene||this.editor.placing)return Promise.resolve();
    if(this.entranceCheck)return this.entranceCheck;
    const valid=()=>isPrimaryGM()&&scene===globalThis.canvas?.scene&&localMapOf(scene)?.placeId===map.placeId;
    const work=Promise.resolve().then(async()=>{
      if(!valid()||this.editor.placing)return;
      const land=settlementEntrances(scene,{arrival:'land'}).length;
      const prompted=this.entrancePrompts??=new Set();
      if(!land){
        const key=`${scene.id}:land`;if(prompted.has(key))return;prompted.add(key);
        const place=await foundry.applications.api.DialogV2.confirm({
          window:{title:`${map.name}: add an entrance`},
          content:'<p>This settlement needs at least one gate or road in, so the GM can choose where the party enters.</p><p>Click the map to place its first land entrance. Give it a name on its card.</p>',
          yes:{label:'Place gate or road in',icon:'fa-solid fa-door-open'},no:{label:'Later',icon:'fa-solid fa-xmark'},rejectClose:false
        });
        if(place&&valid()&&!this.editor.placing&&!settlementEntrances(scene,{arrival:'land'}).length)this.editor.startEntrance('land');
        return;
      }
      if(!(editorOpen||afterPlacement)||settlementEntrances(scene,{arrival:'sea'}).length)return;
      const needsDock=await this.needsDock?.(scene);
      if(!needsDock||!valid()||this.editor.active===false||this.editor.placing||!settlementEntrances(scene,{arrival:'land'}).length||settlementEntrances(scene,{arrival:'sea'}).length)return;
      const key=`${scene.id}:dock`;if(prompted.has(key))return;prompted.add(key);
      const place=await foundry.applications.api.DialogV2.confirm({
        window:{title:`${map.name}: add a dock entrance`},
        content:'<p>Boat travel is available at this settlement, but it has no dock entrance.</p><p>Place a dock where arriving passengers should disembark. Mark additional harbours as <strong>A way in</strong> on their cards to offer more than one dock.</p>',
        yes:{label:'Place dock entrance',icon:'fa-solid fa-anchor'},no:{label:'Later',icon:'fa-solid fa-xmark'},rejectClose:false
      });
      if(place&&valid()&&this.editor.active!==false&&!this.editor.placing&&!settlementEntrances(scene,{arrival:'sea'}).length)this.editor.startEntrance('dock');
    });
    this.entranceCheck=work.finally(()=>{if(this.entranceCheck===pending)this.entranceCheck=null;});
    const pending=this.entranceCheck;return pending;
  }

  editorOpened(scene) {
    this.entrancePrompts?.delete(`${scene.id}:land`);
    this.entrancePrompts?.delete(`${scene.id}:dock`);
    this.ensureEntrance(scene,{editorOpen:true}).catch(error=>console.warn('kg-realms | entrance setup:',error));
  }

  entrancePlaced(scene) {
    return this.ensureEntrance(scene,{afterPlacement:true});
  }

  /** Choose the realm place a scene maps, then convert its journal pins into local places. */
  async make(scene, world = defaultWorldId()) {
    if (!scene || !game.user.isGM) return;
    // A place's own scene (linked from a local place): it becomes that place's local map.
    const back = returnOf(scene), from = back ? game.scenes.get(back.scene) : null;
    if (from && localMapOf(from)) {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: `Make ${scene.name} a local map` },
        content: `<p>Make <b>${esc(scene.name)}</b> the local map of <b>${esc(back.name)}</b>, in ${esc(localMapOf(from).name)}? Its journal pins become its places.</p>`,
        rejectClose: false
      });
      if (!ok) return;
      const report = await this.convert(scene, { id: null, name: back.name }, localMapOf(from).world, { parent: { scene: from.id, note: back.note, name: back.name }, promptEntrance: false });
      ui.notifications.info(`KG Realms: ${scene.name} is now the local map of ${back.name}. ${report.converted} place${report.converted === 1 ? "" : "s"} from its pins.`);
      await this.settings(scene);
      return this.ensureEntrance(scene);
    }
    const places = (await this.getRealmPlaces(world)).filter((p) => p && KINDS_WITH_MAPS.has(p.kind) && !p.hidden && typeof p.name === "string" && p.name.trim());
    if (!places.length) return ui.notifications.warn("KG Realms: this realm has no named, visible settlements or sites to link. Name a place on the realm map first.");
    const guess = places.find((p) => p.scene === scene.id) ?? places.find((p) => p.name.toLowerCase() === scene.name.toLowerCase());
    const sorted = [...places].sort((a, b) => a.name.localeCompare(b.name));
    const pins = scene.notes.filter((n) => !localOf(n) && (n.entryId || n.pageId)).length;
    const id = await foundry.applications.api.DialogV2.prompt({
      window: { title: `Make ${scene.name} a local map` },
      content: `<p>Which place on the realm map is this the map of?</p>
        <div class="form-group"><label>Place</label><input type="text" name="place" list="kgr-local-places" value="${esc(guess?.name ?? "")}" placeholder="Start typing a name" autofocus>
        <datalist id="kgr-local-places">${sorted.map((p) => `<option value="${esc(p.name)}">${esc(p.class ?? "")}</option>`).join("")}</datalist></div>
        <p class="hint">${pins ? `Its ${pins} journal pin${pins === 1 ? "" : "s"} will become local places, linked to their journal pages, with a category from each pin's icon.` : "It has no journal pins yet; places can be added once it is a local map."}</p>`,
      ok: { label: "Make local map", callback: (ev, b) => b.form.elements.place.value.trim() },
      rejectClose: false
    }).catch(() => null);
    if (!id) return;
    const place = sorted.find((p) => p.name.toLowerCase() === id.toLowerCase());
    if (!place) return ui.notifications.warn(`KG Realms: no place called ${id} on the realm map.`);
    const report = await this.convert(scene, place, world, {promptEntrance: false});
    ui.notifications.info(`KG Realms: ${scene.name} is now the local map of ${place.name}. ${report.converted} place${report.converted === 1 ? "" : "s"} from its pins${report.unplaced ? `, ${report.unplaced} journal page${report.unplaced === 1 ? "" : "s"} not yet on the map` : ""}.`);
    await this.settings(scene);
    return this.ensureEntrance(scene);
  }

  /** The journal page a pin points to: by its ids, then the same page id in any journal, then by name. */
  #pageFor(note, name) {
    const direct = note.entryId && note.pageId ? game.journal.get(note.entryId)?.pages.get(note.pageId) : null;
    if (direct) return direct;
    if (note.pageId) for (const j of game.journal) { const p = j.pages.get(note.pageId); if (p) return p; }
    if (!note.pageId && note.entryId) { const e = game.journal.get(note.entryId); if (e) return e; }
    const want = name.toLowerCase();
    for (const j of game.journal) { const p = j.pages.find((x) => x.name.toLowerCase() === want); if (p) return p; }
    return null;
  }

  /**
   * Turn a scene's journal pins into local places, with each pin's journal text in its card as a
   * GM-only secret block (the pin no longer links the journal), link the scene and the realm place
   * both ways, and list the journal's other pages as not yet placed (the page named for the place
   * goes into the realm place's card). Returns { converted, unplaced }.
   */
  async convert(scene, place, world = defaultWorldId(), { parent = null, promptEntrance = true } = {}) {
    const updates = [], journals = new Set(), used = new Set();
    for (const note of scene.notes) {
      if (localOf(note)) continue;
      const { name: label, order } = cleanLabel(note.text || "");
      const doc = this.#pageFor(note, label);
      const page = doc?.documentName === "JournalEntryPage" ? doc : null;
      const name = page?.name ?? doc?.name ?? (label || "Place");
      if (page) { journals.add(page.parent); used.add(page.id); }
      const rec = localRecord({ name, category: categoryFor(note.texture?.src, name), order, known: asSecret(pageHtml(doc)), img: page?.type === "image" ? page.src : "" });
      updates.push({ _id: note.id, text: name, "texture.tint": "#ffffff", entryId: null, pageId: null, [`flags.${MODULE_ID}.local`]: rec });
    }
    if (updates.length) await scene.updateEmbeddedDocuments("Note", updates);
    // The journal's other pages: the place's own overview, and places not yet on the map.
    const unplaced = [], want = place.name.toLowerCase();
    let overview = null;
    for (const j of journals) for (const p of j.pages) {
      if (used.has(p.id)) continue;
      if (!overview && (p.name.toLowerCase() === want || p.name.toLowerCase() === scene.name.toLowerCase())) { overview = p; continue; }
      unplaced.push({ name: p.name, category: categoryFor("", p.name), known: asSecret(pageHtml(p)) });
    }
    const prev = localMapOf(scene) ?? {};
    await scene.setFlag(MODULE_ID, "localMap", { markerScale: 1, ...prev, world, placeId: place.id, name: place.name, ...(parent ? { parent } : {}), unplaced: [...(prev.unplaced ?? []), ...unplaced] });
    const known = overview && place.known == null ? `${asHtml(place.summary || place.descr)}${asSecret(pageHtml(overview))}` : null;
    if (place.id) await this.savePlaceEdit(world, place.id, { scene: scene.id, ...(known ? { known } : {}) });
    if (promptEntrance) await this.ensureEntrance(scene);
    return { converted: updates.length, unplaced: unplaced.length, overview: overview?.name ?? null };
  }

  /* ---------------------------------------------------------------- settings */

  /** The local map's settings: its place, its scale (with a suggestion), marker size, places not yet on the map, unlink. */
  async settings(scene) {
    const map = localMapOf(scene);
    if (!map || !game.user.isGM) return;
    const place = map.placeId ? (await this.getRealmPlaces(map.world)).find((p) => p.id === map.placeId) : null;
    const grid = scene.grid, check = scaleCheck({ width: scene.width, gridSize: grid.size, distance: grid.distance, units: grid.units }, place?.class);
    const scaleLine = `${grid.size} px = ${grid.distance} ${esc(grid.units || "")}: the map is ${across(check.acrossFt)} across.`;
    const suggest = check.suggest ? `<p class="hint"><i class="fa-solid fa-triangle-exclamation"></i> A ${esc((place?.class ?? "place").toLowerCase())} is usually about ${across(check.expectFt)} across. Suggested: ${grid.size} px = ${check.suggest.distance} ${check.suggest.units}.</p>
      <label class="checkbox"><input type="checkbox" name="applyScale"> Use the suggested scale</label>` : "";
    const unplaced = map.unplaced ?? [];
    const result = await foundry.applications.api.DialogV2.wait({
      window: { title: `Local map: ${scene.name}` },
      content: `<p><b>${esc(scene.name)}</b> is the local map of <b>${esc(map.name)}</b>${place ? ` (${esc(place.class ?? "")})` : ""}.</p>
        <div class="form-group"><label>Scale</label><p>${scaleLine}</p></div>${suggest}
        <div class="form-group"><label>Marker size</label><input type="range" name="markerScale" min="0.5" max="3" step="0.1" value="${map.markerScale ?? 1}"></div>
        <div class="form-group"><label>Icon pack</label><select name="iconPack">${[['',`Use world default (${ICON_PACKS[worldIconPack()]})`],...iconPackOptions()].map(([value,label])=>`<option value="${value}" ${(iconPackOverride(map.iconPack)??'')===value?'selected':''}>${label}</option>`).join('')}</select><p class="hint">Default for places on this map. Individual cards can override it.</p></div>
        ${unplaced.length ? `<p><b>Not yet on the map (${unplaced.length}):</b> ${unplaced.map((u) => esc(u.name)).join(", ")}. Place them from the Local places panel.</p>` : ""}`,
      buttons: [
        { action: "save", label: "Save", icon: "fa-solid fa-check", default: true, callback: (e, b) => ({ save: true, markerScale: Number(b.form.elements.markerScale.value) || 1, iconPack:iconPackOverride(b.form.elements.iconPack.value), applyScale: !!b.form.elements.applyScale?.checked }) },
        { action: "unlink", label: "Unlink", icon: "fa-solid fa-link-slash", callback: () => ({ unlink: true }) }
      ],
      rejectClose: false
    }).catch(() => null);
    if (!result) return;
    if (result.unlink) {
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: "Unlink local map" }, content: `<p>Stop ${esc(scene.name)} being the local map of ${esc(map.name)}? Its pins stay as they are.</p>`, rejectClose: false });
      if (!ok) return;
      await scene.unsetFlag(MODULE_ID, "localMap");
      if (map.placeId && place?.scene === scene.id) await this.savePlaceEdit(map.world, map.placeId, { scene: null });
      return;
    }
    await scene.setFlag(MODULE_ID, "localMap", { ...localMapOf(scene), markerScale: result.markerScale, iconPack: iconPackOverride(result.iconPack) });
    if (result.applyScale && check.suggest) await scene.update({ "grid.distance": check.suggest.distance, "grid.units": check.suggest.units });
    this.refreshMarkers(scene,true);
  }

  /* ---------------------------------------------------------------- a place's own scene */

  /**
   * A local place now links `next` (a tavern's map, a battlemap) instead of `prev`: the new scene
   * remembers the way back to this place; the old one forgets it, if it pointed here.
   */
  async linkScene(note, prev, next) {
    const doc = note.document ?? note, rec = localOf(doc), here = doc.parent;
    const old = prev ? game.scenes.get(prev) : null;
    if (old && returnOf(old)?.note === doc.id) await old.unsetFlag(MODULE_ID, "returnTo");
    const target = next ? game.scenes.get(next) : null;
    if (target) await target.setFlag(MODULE_ID, "returnTo", { scene: here.id, note: doc.id, name: rec?.name ?? doc.text, map: localMapOf(here)?.name ?? here.name });
  }

  /** A place is deleted: its scene forgets the way back to it. */
  async unlinkScene(note) {
    const doc = note.document ?? note, rec = localOf(doc);
    if (rec?.scene) await this.linkScene(doc, rec.scene, null);
  }

  /** Go to a place's own scene (GM: view it; Shift-held choices are offered by the bar there). */
  async goTo(sceneId, note) {
    const scene = game.scenes.get(sceneId);
    if (!scene) return ui.notifications.warn("KG Realms: that scene is missing.");
    const doc = note?.document ?? note;
    // A scene linked before the way back existed gets it now.
    if (doc && !returnOf(scene)) await this.linkScene(doc, null, sceneId);
    return scene.view();
  }

  /* ---------------------------------------------------------------- the way back */

  /**
   * Where a scene goes back to: { to: scene, place: the place there, focus }, or null. A place's own
   * scene goes to its local map; a local map belonging to a place goes to that place's map; a local
   * map of a realm place goes to the realm map.
   */
  parentOf(scene) {
    const regional = this.regionalParent?.(scene);
    if (regional?.to && regional.to.id !== scene.id) return regional;
    const back = returnOf(scene), map = localMapOf(scene);
    const up = map?.parent ?? (back ? { scene: back.scene, note: back.note, name: back.name } : null);
    if (up) {
      const to = game.scenes.get(up.scene);
      if (to) return { to, place: up.name ?? map?.name, focus: { scene: to.id, note: up.note } };
    }
    if (map?.placeId) {
      const to = this.realmSceneFor?.(map.world);
      if (to) return { to, place: map.name, focus: { scene: to.id, placeId: map.placeId } };
    }
    return null;
  }

  /** From the realm map down to the current scene: [{ scene, label, focus }], the last being here. */
  trail(scene = canvas.scene) {
    const steps = [], seen = new Set([scene.id]);
    let at = scene;
    for (let p = this.parentOf(at); p && !seen.has(p.to.id) && steps.length < 8; p = this.parentOf(at)) {
      seen.add(p.to.id);
      steps.unshift({ scene: p.to, focus: p.focus });
      at = p.to;
    }
    const label = (s) => localMapOf(s)?.name ?? s.name;
    return [...steps.map((x) => ({ ...x, label: label(x.scene) })), { scene, label: label(scene), focus: null }];
  }

  refreshNavigation() { this.#drawBar(); }

  #drawBar() {
    this.#removeBar();
    // The GM decides which scene everyone is on: the way back is the GM's alone.
    if (!game.user.isGM) return;
    const steps = this.trail();
    if (steps.length < 2) return;
    const up = steps.at(-2);
    const el = document.createElement("div");
    el.className = "kgr-ui kgr-backbar";
    el.setAttribute("role", "navigation");
    el.setAttribute("aria-label", "Map scenes");
    el.innerHTML = `<button type="button" data-step="${steps.length - 2}" data-view="1" class="up" title="View ${esc(up.label)} without moving players" aria-label="View ${esc(up.label)} without moving players"><i class="fa-solid fa-arrow-left"></i></button>
      <div class="crumbs">${steps.map((x, i) => i === steps.length - 1 ? `<span class="here" title="${esc(x.label)}">${esc(x.label)}</span>` : `<button type="button" data-step="${i}" class="crumb" title="Activate ${esc(x.label)} for all players">${esc(x.label)}</button><i class="fa-solid fa-angle-right sep"></i>`).join("")}</div>
      <button type="button" data-step="${steps.length - 1}" class="all" title="Activate ${esc(steps.at(-1).label)} for all players" aria-label="Activate current scene for all players"><i class="fa-solid fa-users"></i></button>`;
    el.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-step]");
      if (!b) return;
      const step = steps[Number(b.dataset.step)];
      await this.navigateTrail(step, {viewOnly: b.dataset.view === "1"});
    });
    document.body.append(el);
    this.bar = el;
    const place = () => { if (this.bar === el) dockSceneTrail(el); };
    place();
    this.stopBarUi = observeMapUi(place);
  }
  #removeBar() { this.stopBarUi?.(); this.stopBarUi = null; this.bar?.remove(); this.bar = null; }

  async navigateTrail(step, {viewOnly = false} = {}) {
    if (!game.user.isGM || !step?.scene) return;
    this.focus = step.focus;
    if (viewOnly) return step.scene.view();
    const alreadyActive = step.scene.active;
    const result = await step.scene.activate();
    if (alreadyActive) {
      const away = Array.from(game.users ?? []).filter(u => u.active && !u.isGM && u.viewedScene !== step.scene.id);
      if (away.length) step.scene.pullUsers(away);
    }
    return result;
  }

  /** Back on a local map: centre on the place we came from. (The realm map centres itself once drawn.) */
  #centre() {
    const f = this.focus;
    if (!f || f.scene !== canvas.scene?.id || !f.note) return;
    this.focus = null;
    const note = canvas.notes?.get(f.note);
    if (note) canvas.animatePan({ x: note.center.x, y: note.center.y, duration: 400 });
  }

  /** Go to a local place (from search): on its map, centre on it; the GM goes to its map; players get its card. */
  async goToPlace(sceneId, noteId) {
    const scene = game.scenes.get(sceneId);
    if (!scene) return;
    if (canvas.scene?.id === sceneId) {
      const note = canvas.notes?.get(noteId);
      if (note) await canvas.animatePan({ x: note.center.x, y: note.center.y, scale: Math.max(canvas.stage.scale.x, 1), duration: 500 });
      return;
    }
    if (!game.user.isGM) return this.openCard?.({ kind: "local", scene: sceneId, note: noteId });
    this.focus = { scene: sceneId, note: noteId };
    return scene.view();
  }

  /** The realm map asks, once it is drawn, whether to centre on a place: its id, or null. */
  takeRealmFocus(sceneId) {
    const f = this.focus;
    if (!f || f.scene !== sceneId || !f.placeId) return null;
    this.focus = null;
    return f.placeId;
  }

  /* ---------------------------------------------------------------- seasons */

  /** Shared by the renderer and GM updates, including scenes with no background field. */
  async seasonSource(scene) {
    const map = localMapOf(scene), seasons = map?.seasons;
    if (!seasons?.summer || !seasons?.winter || !this.enabled?.()) return null;
    const winter = (await this.isWinter?.(map.world, map.placeId)) || snowing(scene);
    return winter ? seasons.winter : seasons.summer;
  }

  /**
   * A local map with a summer and a winter picture (its localMap flag's seasons: { summer, winter })
   * shows the winter one while its place is under the realm map's snow, or while it is snowing
   * (Calendaria's weather). Bundled maps resolve this directly on every client;
   * only legacy custom seasonal maps still require a GM background update.
   */
  async applySeasons() {
    if (!isPrimaryGM()) return;
    if (this.seasonsBusy) { this.seasonsAgain = true; return; }
    this.seasonsBusy = true;
    try {
      for (const scene of game.scenes ?? []) {
        const src = await this.seasonSource(scene);
        if (!src || mapAsset(scene)) continue;
        if (backgroundOf(scene) !== src) await setBackground(scene, src);
      }
    } catch (err) { console.warn("kg-realms | seasonal local maps:", err); }
    this.seasonsBusy = false;
    if (this.seasonsAgain) { this.seasonsAgain = false; this.applySeasons(); }
  }

  /* ---------------------------------------------------------------- presets that ship with the module */

  /** The presets a world ships with: [{ id, placeId, name, file, places }]. */
  async presets(world = defaultWorldId()) {
    this.presetList ??= {};
    this.presetList[world] ??= fetch(worldUrl(world, "local/index.json")).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    return this.presetList[world];
  }

  async presetFor(placeId, world = defaultWorldId()) { return (await this.presets(world)).find((p) => p.placeId === placeId) ?? null; }

  /** The scene a preset belongs on in this world, if there is one: its own id, the place's linked scene, or one of the same name and size. */
  #presetScene(preset, place) {
    const byId = preset.sceneId ? game.scenes.get(preset.sceneId) : null;
    if (byId) return byId;
    const linked = !preset.standalone && place?.scene ? game.scenes.get(place.scene) : null;
    if (linked) return linked;
    return game.scenes.find((s) => s.name.toLowerCase() === preset.scene.name.toLowerCase() && s.width === preset.scene.width && s.height === preset.scene.height) ?? null;
  }

  /**
   * Set up a place's local map from the module's preset: on its scene in this world (made if there is
   * none and `create`), each place with its text in its card (from the GM's own pin's journal page
   * when the scene has one, else the preset's), as a GM-only secret block. No journal is made or
   * linked. Places already there are kept as they are. Returns a report, or null.
   */
  async applyPreset(entry, { create = false, world = defaultWorldId(), scene: targetScene = null } = {}) {
    if (!game.user.isGM) return null;
    const preset = await fetch(worldUrl(world, `local/${entry.file}`)).then((r) => r.json());
    const place = (await this.getRealmPlaces(world)).find((p) => p.id === preset.placeId);
    let scene = targetScene ?? this.#presetScene(preset, place);
    if (!scene && !create) return null;
    if (!scene) {
      const s = preset.scene;
      // Foundry 14: the picture goes on the scene's level once it exists, not on the scene.
      const v14 = (game.release?.generation ?? 13) >= 14;
      const background = mapAsset({background: s.background}) ? {...s.background, src: null} : s.background;
      scene = await Scene.create({ name: s.name, width: s.width, height: s.height, padding: s.padding, grid: s.grid, initial: s.initial, ...(v14 ? {} : { background, backgroundColor: s.backgroundColor ?? undefined }), tokenVision: s.tokenVision, environment: { ...s.environment, dark: settlementAmbience(entry.id).dark }, flags: { [MODULE_ID]: { darkAmbience: settlementAmbience(entry.id).revision } } });
      if (v14 && background) await setBackground(scene, background.src ?? null, s.backgroundColor ?? null);
    }
    // A preset place's text: its own (known), else the preset journal's page of that name (older presets).
    const pages = new Map((preset.journal?.pages ?? []).map((p) => [p.name.toLowerCase(), p.content]));
    const textOf = (item) => item.known ?? asSecret(pages.get(String(item.page ?? item.name ?? "").toLowerCase()) ?? "");
    // Places: pins already on the scene for a preset place are converted where they stand (with
    // the text of the page the GM's pin points to, if any); places already converted are left
    // alone; the rest are made at the preset's positions.
    // A preset with movePins puts the scene's old pins where the preset has them (the GM's pins were
    // stray), and drops their duplicates.
    const have = new Map(), extra = [];
    for (const n of scene.notes) {
      const key = (localOf(n)?.name ?? cleanLabel(n.text ?? "").name).toLowerCase();
      if (!have.has(key)) have.set(key, n); else if (!localOf(n)) extra.push({ key, n });
    }
    const updates = [], creates = [], drops = [];
    for (const { x, y, iconSize, page, known, ...rec } of preset.places) {
      const key = rec.name.toLowerCase(), n = have.get(key);
      if (n && localOf(n)) {
        const own = localOf(n);
        const changes = localAssetEdits(own, preset.assetReplacements);
        const hasText = [own.known, own.summary, own.descr].some(t => String(t ?? "").replace(/<[^>]*>|&nbsp;/g, " ").trim());
        // New source summaries fill empty cards without moving pins or replacing GM notes.
        if (!hasText && textOf({known, page, name:rec.name})) Object.assign(changes, {known:textOf({known, page, name:rec.name}), summary:rec.summary ?? ""});
        // New source art goes onto cards with none; a GM's own picture is kept.
        if (!own.img && rec.img) changes.img = rec.img;
        if (Object.keys(changes).length) updates.push({_id:n.id, ...Object.fromEntries(Object.entries(changes).map(([field, value]) => [`flags.${MODULE_ID}.local.${field}`, value]))});
        continue;
      }
      const own = n ? pageHtml(this.#pageFor(n, rec.name)) : "";
      // The text of the page the GM's own pin points to, else the preset's: never both (the same page twice).
      const r = localRecord({ ...rec, journal: null, known: own ? asSecret(own) : textOf({ known, page, name: rec.name }) });
      Object.assign(r, localAssetEdits(r, preset.assetReplacements));
      if (n) updates.push({ _id: n.id, text: r.name, "texture.tint": "#ffffff", entryId: null, pageId: null, ...(preset.movePins ? { x, y, iconSize: iconSize ?? n.iconSize } : {}), [`flags.${MODULE_ID}.local`]: r });
      else creates.push({ x, y, iconSize: iconSize ?? 64, text: r.name, fontSize: 32, textAnchor: 1, global: true, texture: { src: "icons/svg/book.svg", tint: "#ffffff" }, flags: { [MODULE_ID]: { local: r } } });
      if (preset.movePins) drops.push(...extra.filter((e) => e.key === key).map((e) => e.n.id));
    }
    if (updates.length) await scene.updateEmbeddedDocuments("Note", updates);
    if (creates.length) await scene.createEmbeddedDocuments("Note", creates);
    if (drops.length) await scene.deleteEmbeddedDocuments("Note", drops);
    const unplaced = preset.unplaced.map((u) => ({ name: u.name, category: u.category, known: textOf(u) }))
      .filter((u) => !scene.notes.some((n) => localOf(n)?.name.toLowerCase() === u.name.toLowerCase()));
    const prev = localMapOf(scene) ?? {};
    const retired = new Set((preset.retired ?? []).map(name => name.toLowerCase()));
    const placed = new Set([...have.keys(), ...preset.places.map(p => p.name.toLowerCase())]);
    const pending = new Map([...(prev.unplaced ?? []), ...unplaced].filter(p => !placed.has(p.name.toLowerCase()) && !retired.has(p.name.toLowerCase())).map(p => [p.name.toLowerCase(), p]));
    // Preserve a GM's existing unplaced text when the preset contains the same name.
    for (const p of prev.unplaced ?? []) if (!placed.has(p.name.toLowerCase()) && !retired.has(p.name.toLowerCase())) pending.set(p.name.toLowerCase(), p);
    await scene.setFlag(MODULE_ID, "localMap", { markerScale: preset.markerScale ?? 1, ...(preset.iconPack ? {iconPack: preset.iconPack} : {}), ...prev, world, placeId: preset.placeId, name: preset.name, presetId:entry.id, presetRevision: entry.revision ?? preset.version ?? 1, unplaced: [...pending.values()], ...(preset.seasons ? { seasons: preset.seasons } : {}) });
    // The preset's settlement roads, on a scene that has none of its own. A scene with roads gets the
    // preset's new ones once per roads revision, beside its own: its roads are kept as they are, and a
    // road the GM deletes afterwards stays deleted.
    const sceneRoads = scene.getFlag(MODULE_ID, "cityRoads");
    if (preset.roads?.roads?.length && !sceneRoads?.roads?.length) await scene.setFlag(MODULE_ID, "cityRoads", structuredClone(preset.roads));
    else if (preset.roads?.roads?.length && (prev.roadsRevision ?? 1) < (preset.roads.revision ?? 1)) {
      const ids = new Set(sceneRoads.roads.map((r) => r.id)), extra = preset.roads.roads.filter((r) => !ids.has(r.id));
      if (extra.length) await scene.setFlag(MODULE_ID, "cityRoads", { ...sceneRoads, revision: (sceneRoads.revision ?? 0) + 1, roads: [...sceneRoads.roads, ...structuredClone(extra)] });
    }
    if (preset.roads?.revision) await scene.setFlag(MODULE_ID, "localMap", { ...localMapOf(scene), roadsRevision: preset.roads.revision });
    // The place's own text (the city's overview) goes into the realm place's card, if it has none yet.
    const overview = preset.overviewKnown ?? (preset.overview ? asSecret(pages.get(preset.overview.toLowerCase()) ?? "") : "");
    const known = overview && place && place.known == null ? `${asHtml(place.summary || place.descr)}${overview}` : null;
    if (place && (!preset.standalone || !place.scene || !game.scenes.get(place.scene) || place.scene===scene.id)) await this.savePlaceEdit(world, place.id, { scene: scene.id, ...(known ? { known } : {}) });
    this.ensureEntrance(scene).catch(error => console.warn('kg-realms | entrance setup:', error));
    if (entry.effects) await this.applyEffects?.(scene, entry.effects, world).catch(error => console.warn(`kg-realms | ${scene.name} effects:`, error));
    return { scene, places: updates.length + creates.length, created: creates.length };
  }

  /**
   * Once per scene: the module's new picture for a local map (map: { src, from: [w, h], to: [w, h] },
   * the same drawing at a new size). A scene still at the old picture's size takes the new size, and
   * its pins and tokens move to the same spots on the map (the scene's padding allowed for). A scene
   * the GM resized only takes the picture.
   */
  async #takeMap(scene, map) {
    if (mapAsset({background: {src: map.src}})) {
      if (mapAsset(scene) && backgroundOf(scene)) await setBackground(scene, null);
      if (localMapOf(scene)?.map !== map.src) await scene.setFlag(MODULE_ID, "localMap", {...localMapOf(scene), map: map.src});
      return;
    }
    if (localMapOf(scene)?.map === map.src) return;
    const [w0, h0] = map.from ?? [], [w1, h1] = map.to ?? [];
    if (backgroundOf(scene) !== map.src && scene.width === w0 && scene.height === h0 && w1 && h1) {
      const pad = scene.padding ?? 0, g = scene.grid?.size ?? 100, off = (w) => Math.ceil((w * pad) / g) * g;
      const fx = w1 / w0, fy = h1 / h0, at = (x, y) => ({ x: Math.round((x - off(w0)) * fx + off(w1)), y: Math.round((y - off(h0)) * fy + off(h1)) });
      await scene.update({ width: w1, height: h1 });
      for (const name of ["Note", "Token"]) {
        const ups = scene.getEmbeddedCollection(name).map((d) => ({ _id: d.id, ...at(d.x, d.y) }));
        if (ups.length) await scene.updateEmbeddedDocuments(name, ups);
      }
    }
    if (backgroundOf(scene) !== map.src) await setBackground(scene, map.src);
    await scene.setFlag(MODULE_ID, "localMap", { ...localMapOf(scene), map: map.src });
  }

  /**
   * Once per world (GM): every preset whose place has no local map yet, and whose scene this world
   * has (the GM's own Neverwinter scene), is set up there. A preset is done once, so unlinking stays.
   */
  async applyPresets(world = defaultWorldId()) {
    if (!isPrimaryGM() || !game.scenes) return;
    const was = this.presetsDone?.();
    const done = new Set(Array.isArray(was) ? was : []);
    const set = [];
    let list = [];
    try { list = await this.presets(world); } catch (err) { console.warn("kg-realms | local map presets:", err); return; }
    for (const entry of list) {
      const have = game.scenes.find((s) => entry.standalone ? localMapOf(s)?.presetId===entry.id : localMapOf(s)?.placeId === entry.placeId);
      // A local map set up before its preset had seasonal pictures gets them.
      if (have && entry.seasons && !localMapOf(have).seasons) await have.setFlag(MODULE_ID, "localMap", { ...localMapOf(have), seasons: entry.seasons });
      // A local map the module has a new picture for gets it.
      if (have && entry.map?.src) await this.#takeMap(have, entry.map).catch((err) => console.warn(`kg-realms | ${entry.name}'s new map:`, err));
      if (have && entry.effects) await this.applyEffects?.(have, entry.effects, world).catch(error => console.warn(`kg-realms | ${entry.name} effects:`, error));
      if (have && entry.revision && (localMapOf(have).presetRevision ?? 0) < entry.revision) {
        const report = await this.applyPreset(entry, {world, scene: have}).catch(error => console.warn(`kg-realms | ${entry.name} defaults:`, error));
        if (report) set.push(`${entry.name} (${report.created} added places)`);
      }
      if (done.has(entry.id) || have) continue;
      const report = await this.applyPreset(entry, { world, create:!!entry.create }).catch((err) => { console.warn(`kg-realms | preset ${entry.name}:`, err); return null; });
      if (!report) continue;
      done.add(entry.id);
      set.push(`${entry.name} (${report.places} places, on ${report.scene.name})`);
    }
    if (set.length) {
      await this.savePresetsDone?.([...done]);
      ui.notifications.info(`KG Realms: local maps set up from the module: ${set.join(", ")}.`);
    }
    // Bundled local maps are selected from flags and module data. Retire only
    // known baseline background identifiers, without touching custom artwork.
    for (const scene of game.scenes) {
      if (localMapOf(scene) && mapAsset(scene) && backgroundOf(scene)) await setBackground(scene, null);
    }
    await this.applySeasons();
  }

  async applySceneEffects(world = defaultWorldId()) {
    if (!isPrimaryGM()) return;
    for (const entry of await this.presets(world)) {
      if (!entry.effects) continue;
      for (const scene of game.scenes) {
        if (localMapOf(scene)?.world === world && localMapOf(scene)?.placeId === entry.placeId) {
          await this.applyEffects?.(scene, entry.effects, world).catch(error => console.warn(`kg-realms | ${scene.name} effects:`, error));
        }
      }
    }
  }
}
