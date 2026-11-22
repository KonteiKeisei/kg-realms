// The party on Site maps (0.96.9). Every scene is one of four levels: Realm, Region, Place (a local
// map) and Site (a scene marked Site, or any scene with no KG level: a cave, a tavern, a battlemap).
// On a Site map the party is its members' own tokens, each with their own vision and rotation:
//  - when the party token is placed there, each member gets a token around it (one already on the
//    scene is kept) and the party token is hidden. It stays as the party's anchor for travel, the
//    HUD and Monk's TokenBar, and follows the leader.
//  - linked, the members follow whoever is moved, in a line along the ground the leader crossed.
//    Unlinking (deploy) lets everyone move on their own; linking again joins them up.
//  - Split and merge change who is linked to whom, since the linked set is the party's members.
//  - A scene set to use the party token instead (Scene Config) brings the party token back.
import {RealmDialog} from './ui-theme.mjs';
import {isPrimaryGM} from './authority.mjs';
import {sceneContextEntry} from './foundry-compat.mjs';
import {groupMembers} from './party-groups.mjs';
import {LEVEL_NAMES, levelOf, partyModeOf, normalRestore, deploySpots, centroid, snapSquare, followPlan} from './party-battlemap-layout.mjs';
const ID = 'kg-realms', esc = (s) => foundry.utils.escapeHTML(String(s ?? ''));

const regionalLinks = () => { try { return game.settings.get(ID, 'regionalMaps') ?? {}; } catch { return {}; } };
/** A scene's level: 'realm', 'region', 'place' or 'site'. */
export const sceneLevel = (scene) => levelOf(scene?.flags?.[ID], regionalLinks());
/** How the party shows on a scene: 'members' (their own tokens, linked) or 'token' (the party token). */
export const scenePartyMode = (scene) => partyModeOf(scene?.flags?.[ID], regionalLinks());
const isGroupDoc = (doc) => doc?.actor?.type === 'group';
const sizeOf = (doc, size) => ({ w: (doc.width ?? 1) * size, h: (doc.height ?? 1) * size });
const centerOf = (p, doc, size) => { const s = sizeOf({ width: p.width ?? doc.width, height: p.height ?? doc.height }, size); return { x: p.x + s.w / 2, y: p.y + s.h / 2 }; };
const rectOf = (t, size) => ({ x: t.x, y: t.y, ...sizeOf(t, size) });

/** The party tokens on a scene standing in as their members (hidden anchors). */
export const siteParties = (scene) => Array.from(scene?.tokens ?? []).filter((t) => isGroupDoc(t) && t.getFlag(ID, 'siteParty'));
/** A party's members' own tokens on its scene. */
export function memberTokens(party) {
  const ids = new Set(groupMembers(party.actor).map((a) => a.id));
  return Array.from(party.parent?.tokens ?? []).filter((t) => !isGroupDoc(t) && ids.has(t.actorId));
}
/** The party a member's token belongs to on its scene, or null. */
export function partyOf(doc) {
  if (!doc?.actorId || isGroupDoc(doc)) return null;
  return siteParties(doc.parent).find((p) => groupMembers(p.actor).some((a) => a.id === doc.actorId)) ?? null;
}

export class SiteParty {
  constructor({ busy = () => false, editParties = null } = {}) {
    Object.assign(this, { busy, editParties });
    // Tokens this code is moving (a count: one may be sent on again before its last walk ends), the
    // moves of one update gathered together, and each party's follows, one after another.
    this.moving = new Map(); this.batches = new Map(); this.queues = new Map();
  }

  install() {
    // The party token placed on a Site map: its members take its place.
    Hooks.on('createToken', (doc) => { if (isPrimaryGM() && isGroupDoc(doc) && scenePartyMode(doc.parent) === 'members' && !doc.getFlag(ID, 'siteParty')) setTimeout(() => this.arrive(doc).catch((e) => this.#fail(e)), 0); });
    Hooks.on('moveToken', (doc, movement, operation) => this.#moved(doc, movement, operation));
    Hooks.on('canvasReady', () => { if (isPrimaryGM()) this.cleanup(canvas.scene).catch((e) => console.warn(`${ID} | site party cleanup:`, e)); });
    // The scene's level or party setting changed: bring the members out, or the party token back.
    // Only a change of level or of this setting: journeys and places write other flags all the time.
    Hooks.on('updateScene', (scene, changes) => {
      const f = changes?.flags?.[ID]; if (!f || !isPrimaryGM()) return;
      if (['siteMap', '-=siteMap', 'sitePartyMode', '-=sitePartyMode', 'localMap', '-=localMap', 'world'].some((k) => k in f)) this.syncScene(scene).catch((e) => this.#fail(e));
    });
    Hooks.on('renderTokenHUD', (app, html) => this.hud(app, html));
    for (const hook of ['getSceneContextOptions', 'getSceneDirectoryEntryContext']) Hooks.on(hook, (_app, options) => this.contextOptions(options));
  }
  #fail(e) { console.error(`${ID} | site party:`, e); ui.notifications.error(`KG Realms: ${e.message}`); }

  async syncScene(scene) {
    const members = scenePartyMode(scene) === 'members';
    for (const doc of Array.from(scene.tokens).filter(isGroupDoc)) {
      if (members && !doc.getFlag(ID, 'siteParty')) await this.arrive(doc);
      else if (!members && doc.getFlag(ID, 'siteParty')) await this.regroup(doc);
    }
  }

  /** Each member gets a token around the party token (one already here is kept); the party token is hidden. */
  async arrive(doc) {
    const scene = doc?.parent, actor = doc?.actor;
    if (!isPrimaryGM() || !scene?.tokens.get(doc.id) || doc.getFlag(ID, 'siteParty')) return;
    if (this.busy(actor.id)) return ui.notifications.warn(`KG Realms: ${actor.name} is on a settlement trip. Stop it, then use "Bring out the members" on the party token.`);
    const members = groupMembers(actor);
    if (!members.length) return;
    const size = scene.grid.size, present = new Set(Array.from(scene.tokens).filter((t) => !isGroupDoc(t)).map((t) => t.actorId));
    const datas = [];
    for (const a of members.filter((m) => !present.has(m.id))) datas.push((await a.getTokenDocument({ hidden: doc.hidden })).toObject());
    const center = centerOf(doc, doc, size), occupied = Array.from(scene.tokens).map((t) => rectOf(t, size));
    const spots = deploySpots({ center, size, members: datas.map((d) => sizeOf(d, size)), occupied, blocked: this.#blocked(scene), snap: this.#snap(scene) });
    datas.forEach((d, i) => { delete d._id; d.x = spots[i].x; d.y = spots[i].y; foundry.utils.setProperty(d, `flags.${ID}.siteMember`, actor.id); });
    if (datas.length) await scene.createEmbeddedDocuments('Token', datas, { kgrFollow: true });
    await doc.update({ hidden: true, [`flags.${ID}.siteParty`]: { linked: true, wasHidden: !!doc.hidden } }, { animate: false, kgrFollow: true });
  }

  /** The party token comes back among its members; the tokens made for them go. */
  async regroup(doc) {
    const scene = doc.parent, state = doc.getFlag(ID, 'siteParty'), size = scene.grid.size, actor = doc.actor;
    if (!isPrimaryGM() || !state) return;
    const mine = memberTokens(doc), made = mine.filter((t) => t.getFlag(ID, 'siteMember'));
    const madeIds = new Set(made.map((t) => t.id));
    const fighting = this.#fighting(scene, madeIds);
    if (fighting.length && !await RealmDialog.confirm({ window: { title: `The party token: ${actor.name}` }, content: `<p>${fighting.map((c) => esc(c.name)).join(', ')} ${fighting.length === 1 ? 'is' : 'are'} in a running combat. Bringing the party token back removes ${fighting.length === 1 ? 'that token' : 'those tokens'} from it. Go ahead?</p>`, rejectClose: false })) return;
    const mid = centroid(mine.map((t) => rectOf(t, size))), update = { hidden: !!state.wasHidden, [`flags.${ID}.siteParty`]: null };
    if (mid) { const s = sizeOf(doc, size), c = this.#snap(scene)(mid, s); update.x = c.x - s.w / 2; update.y = c.y - s.h / 2; }
    if (made.length) await scene.deleteEmbeddedDocuments('Token', [...madeIds]);
    await doc.update(update, { animate: false, kgrFollow: true });
  }

  /** Linked: the members follow whoever leads. Unlinked (deployed): everyone moves on their own. */
  async setLinked(party, linked) {
    if (!isPrimaryGM()) return ui.notifications.warn('KG Realms: the primary GM links and unlinks the party.');
    const state = party?.getFlag(ID, 'siteParty'); if (!state) return;
    await party.update({ [`flags.${ID}.siteParty`]: { ...state, linked } }, { animate: false, kgrFollow: true });
    ui.notifications.info(`KG Realms: ${party.name} ${linked ? 'linked: the members follow whoever leads' : 'deployed: everyone moves on their own'}.`);
  }

  /** Earlier 0.96.9 test builds: a battlemap look put back to normal, a deployed party unlinked. */
  async cleanup(scene) {
    for (const doc of Array.from(scene?.tokens ?? [])) {
      const f = doc.flags?.[ID] ?? {};
      const restore = normalRestore(f.normalLook, doc);
      if (restore) await doc.update(restore, { animate: false, kgrFollow: true });
      if (f.deployed && isGroupDoc(doc)) await doc.update({ [`flags.${ID}.deployed`]: null, [`flags.${ID}.siteParty`]: { linked: false, wasHidden: !!f.deployed.wasHidden } }, { animate: false, kgrFollow: true });
      if (f.deployedFrom) { const p = scene.tokens.get(f.deployedFrom); await doc.update({ [`flags.${ID}.deployedFrom`]: null, ...(p?.actorId ? { [`flags.${ID}.siteMember`]: p.actorId } : {}) }, { animate: false, kgrFollow: true }); }
    }
  }

  /* ------------------------------------------------------------ follow the leader */

  #fighting(scene, ids) { return game.combats.filter((c) => c.started && (c.scene?.id ?? c.sceneId) === scene.id).flatMap((c) => Array.from(c.combatants)).filter((c) => ids.has(c.tokenId)); }

  /** Moves in one update arrive one by one: gather them, then lead. Several of one party moved together lead no one. */
  #moved(doc, movement, operation) {
    if (!isPrimaryGM() || operation?.kgrFollow || this.moving.has(doc.id) || isGroupDoc(doc)) return;
    if (scenePartyMode(doc.parent) !== 'members' || ['undo', 'paste'].includes(movement?.method)) return;
    const party = partyOf(doc);
    if (!party?.getFlag(ID, 'siteParty')?.linked) return;
    let batch = this.batches.get(operation);
    if (!batch) { batch = []; this.batches.set(operation, batch); setTimeout(() => { this.batches.delete(operation); this.#lead(batch).catch((e) => console.warn(`${ID} | follow the leader:`, e)); }, 0); }
    batch.push({ doc, movement, party });
  }

  async #lead(batch) {
    const byParty = new Map();
    for (const m of batch) { const list = byParty.get(m.party.id) ?? []; list.push(m); byParty.set(m.party.id, list); }
    for (const [id, moves] of byParty) {
      if (moves.length !== 1) continue;
      // A party's follows run one after another: arrow keys or a long drag send several moves.
      const run = (this.queues.get(id) ?? Promise.resolve()).then(() => this.#follow(moves[0])).catch((e) => console.warn(`${ID} | follow the leader:`, e));
      this.queues.set(id, run);
      run.finally(() => { if (this.queues.get(id) === run) this.queues.delete(id); });
    }
  }

  async #follow({ doc, movement, party }) {
    const scene = doc.parent, size = scene?.grid.size;
    if (!scene?.tokens.get(doc.id) || !party.getFlag(ID, 'siteParty')?.linked) return;
    const others = memberTokens(party).filter((t) => t.id !== doc.id);
    if (!others.length || this.#fighting(scene, new Set([doc.id, ...others.map((t) => t.id)])).length) return;
    const origin = centerOf(movement.origin ?? doc, doc, size);
    const path = (movement.passed?.waypoints ?? []).map((w) => centerOf(w, doc, size));
    if (!path.length) path.push(centerOf(doc, doc, size));
    const snap = this.#snap(scene);
    const { moves, stuck } = followPlan({ origin, path, followers: others.map((t) => ({ id: t.id, center: centerOf(t, t, size) })), spacing: size, snap: (p) => snap(p, { w: size, h: size }), blocked: this.#blocked(scene) });
    await Promise.all(moves.map(({ id, path: steps }) => this.#walk(scene.tokens.get(id), steps, size)));
    if (stuck.length) ui.notifications.info(`KG Realms: ${stuck.map((id) => scene.tokens.get(id)?.name).filter(Boolean).join(', ')} could not follow ${doc.name}: a wall is in the way. Move ${stuck.length === 1 ? 'them' : 'each'} next to the party once.`);
    // The hidden party token keeps up with its leader.
    const end = path.at(-1), s = sizeOf(party, size);
    await party.update({ x: end.x - s.w / 2, y: end.y - s.h / 2 }, { animate: false, kgrFollow: true }).catch(() => null);
  }

  async #walk(doc, steps, size) {
    if (!doc || !steps.length) return;
    const s = sizeOf(doc, size), waypoints = steps.map((c) => ({ x: Math.round(c.x - s.w / 2), y: Math.round(c.y - s.h / 2) }));
    this.moving.set(doc.id, (this.moving.get(doc.id) ?? 0) + 1);
    try {
      // Every step is ground the leader crossed, or a joining step already checked against walls.
      if (typeof doc.move === 'function') await doc.move(waypoints, { method: 'api', autoRotate: true, showRuler: false, constrainOptions: { ignoreWalls: true, ignoreCost: true }, kgrFollow: true });
      else await doc.update(waypoints.at(-1), { kgrFollow: true });
    } finally { const n = (this.moving.get(doc.id) ?? 1) - 1; if (n > 0) this.moving.set(doc.id, n); else this.moving.delete(doc.id); }
  }

  /* ------------------------------------------------------------ grid */

  #snap(scene) {
    const grid = globalThis.canvas?.scene === scene ? canvas.grid : scene.grid, size = scene.grid.size;
    if (scene.grid.type === CONST.GRID_TYPES.GRIDLESS) return (p) => p;
    if (grid.isHexagonal) return (p) => grid.getCenterPoint(p);
    return (p, m) => snapSquare(p, m ?? { w: size, h: size }, size);
  }
  #blocked(scene) {
    return (from, to) => {
      if (globalThis.canvas?.scene !== scene) return false;
      try { return !!CONFIG.Canvas.polygonBackends?.move?.testCollision(from, to, { type: 'move', mode: 'any' }); } catch { return false; }
    };
  }

  /* ------------------------------------------------------------ controls */

  hud(app, html) {
    const t = app.object ?? app.document?.object, root = html instanceof HTMLElement ? html : html?.[0], doc = t?.document;
    if (!game.user.isGM || !root || !doc || root.querySelector('[data-kgr-site]')) return;
    const col = root.querySelector('.col.right') ?? root, button = (icon, title, run) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'control-icon'; b.dataset.kgrSite = 'true'; b.dataset.tooltip = title; b.setAttribute('aria-label', title);
      b.innerHTML = `<i class="${icon}"></i>`;
      b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); Promise.resolve(run()).catch((err) => this.#fail(err)); });
      col.append(b);
    };
    const linkButton = (party) => party.getFlag(ID, 'siteParty').linked
      ? button('fa-solid fa-link-slash', `Deploy ${party.name}: unlink, everyone moves on their own`, () => this.setLinked(party, false))
      : button('fa-solid fa-link', `Link ${party.name}: the members follow whoever leads`, () => this.setLinked(party, true));
    if (isGroupDoc(doc)) {
      if (doc.getFlag(ID, 'siteParty')) linkButton(doc);
      else if (scenePartyMode(doc.parent) === 'members') button('fa-solid fa-people-group', 'Bring out the members', () => this.arrive(doc));
      return;
    }
    const party = partyOf(doc);
    if (!party) return;
    linkButton(party);
    // The party token is hidden here: split and merge from a member. Members of two parties selected: merge.
    if (this.editParties) button('fa-solid fa-people-arrows', `Split or merge ${party.name}`, () => {
      const parties = [...new Map([party, ...(canvas.tokens?.controlled ?? []).map((c) => isGroupDoc(c.document) ? c.document : partyOf(c.document))].filter(Boolean).map((p) => [p.id, p])).values()];
      return this.editParties(parties);
    });
  }

  /** Scene Config: the Site map mark and how the party shows here, saved with the scene. */
  sceneConfig(root, scene) {
    if (!root || !scene || root.querySelector('[data-kgr-site-config]') || scene.getFlag(ID, 'world')) return;
    const basics = root.querySelector('.tab[data-tab="basics"][data-group="sheet"]') ?? root.querySelector('.tab[data-tab="basics"]');
    const target = basics ?? root.querySelector('form') ?? root, mode = scene.getFlag(ID, 'sitePartyMode') === 'token' ? 'token' : 'members';
    const field = document.createElement('fieldset'); field.dataset.kgrSiteConfig = 'true';
    field.innerHTML = `<legend>KG Realms map level</legend>
      <p class="hint">This scene is a <b>${LEVEL_NAMES[sceneLevel(scene)]}</b> map.${scene.getFlag(ID, 'localMap') ? '' : ' A scene with no KG level counts as a Site.'}</p>
      ${scene.getFlag(ID, 'localMap') ? `<div class="form-group"><label>Site map</label><div class="form-fields"><input type="checkbox" name="flags.${ID}.siteMap" ${scene.getFlag(ID, 'siteMap') ? 'checked' : ''}></div><p class="hint">A cave, a ruin, a battlemap. It keeps its places and its way back.</p></div>` : ''}
      <div class="form-group"><label>The party on a Site map</label><select name="flags.${ID}.sitePartyMode"><option value="members" ${mode === 'members' ? 'selected' : ''}>Its members' own tokens, linked</option><option value="token" ${mode === 'token' ? 'selected' : ''}>The party token</option></select><p class="hint">Linked members follow whoever leads, each with their own vision. Deploy unlinks them.</p></div>`;
    target.append(field);
  }

  contextOptions(options) {
    if (!Array.isArray(options)) return;
    const scene = (li) => { const el = li instanceof HTMLElement ? li : li?.[0]; return game.scenes.get(el?.dataset?.entryId ?? el?.dataset?.documentId); };
    options.push(...[
      { name: 'Make site map', icon: '<i class="fa-solid fa-dungeon"></i>', condition: (li) => game.user.isGM && sceneLevel(scene(li)) === 'place', callback: (li) => scene(li)?.setFlag(ID, 'siteMap', true) },
      { name: 'Unmark site map', icon: '<i class="fa-solid fa-dungeon"></i>', condition: (li) => game.user.isGM && !!scene(li)?.getFlag(ID, 'siteMap') && !!scene(li)?.getFlag(ID, 'localMap'), callback: (li) => scene(li)?.unsetFlag(ID, 'siteMap') }
    ].map(sceneContextEntry));
  }
}
