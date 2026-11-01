import {groupActor} from './party-groups.mjs';
import {matchesPartyToken} from './party-token.mjs';
import {isPrimaryGM} from './authority.mjs';

const MODULE = 'kg-realms';
const esc = text => foundry.utils.escapeHTML(String(text ?? ''));
const wrap = token => token.document ? token : {document: token, actor: token.actor};
const tokensOf = scene => Array.from(scene?.tokens ?? []).map(wrap).filter(groupActor);
const collective = token => /\bparty\b/i.test(token.document.name ?? '') || token.actor?.type === 'group' || token.document.getFlag?.(MODULE, 'partyMarker');

/** Gates are land entrances; only explicitly marked harbours are dock entrances. */
export function entranceType(rec) {
  if (!rec) return null;
  if (['dock','land'].includes(rec.entryType) && (rec.entry || rec.category === 'gate')) return rec.entryType;
  if (rec.category === 'gate') return 'land';
  return rec.entry ? (rec.category === 'harbour' ? 'dock' : 'land') : null;
}

export function settlementEntrances(scene, {landOnly = false, arrival = null} = {}) {
  const type = landOnly ? 'land' : arrival === 'sea' ? 'dock' : arrival === 'land' ? 'land' : null;
  return Array.from(scene?.notes ?? []).flatMap(note => {
    const rec = note.getFlag(MODULE, 'local'), kind = entranceType(rec);
    return kind && (!type || type === kind) && Number.isFinite(note.x) && Number.isFinite(note.y)
      ? [{id: note.id, name: rec.name || note.text || 'Entrance', x: note.x, y: note.y, type: kind, private: rec.privateEntry === true}]
      : [];
  });
}

/** Use the incoming leg at a boundary, not the next leg or the round-the-clock sailing flag. */
export function settlementArrivalMode(result, hour) {
  if (!Number.isFinite(hour)) return 'land';
  const leg = result?.legs?.find(l => l.start < hour + 1e-9 && hour <= l.start + l.hours + 1e-9);
  if (leg) return leg.sea ? 'sea' : 'land';
  const sample = result?.track?.findLast(p => !p.timingBoundary && p.hour < hour - 1e-9 && p.kind);
  return ['sea','river','wind','lane'].includes(sample?.kind) ? 'sea' : 'land';
}

export async function chooseSettlementGate(scene, {arrival = 'land'} = {}) {
  if (!isPrimaryGM()) return null;
  const gates = settlementEntrances(scene, {arrival}), sea = arrival === 'sea';
  if (!gates.length) {
    ui.notifications.warn(`KG Realms: ${scene.name} has no ${sea ? 'dock entrances. Add a harbour marker and mark it as A way in' : 'gates or marked land entrances. Add a gate'} in the local editor. Travel remains paused.`);
    return null;
  }
  // One dock needs no picker. Private access is still confirmed immediately before placement.
  if (sea && gates.length === 1) return gates[0].id;
  const result = await foundry.applications.api.DialogV2.wait({
    window: {title: `Enter ${scene.name}${sea ? ' by water' : ''}`}, position: {width: 460}, rejectClose: false,
    content: `<p>Choose where the party ${sea ? 'docks in' : 'enters'} <strong>${esc(scene.name)}</strong>.</p><div class="form-group"><label for="kgr-entry-gate">${sea ? 'Dock' : 'Gate or entrance'}</label><div class="form-fields"><select id="kgr-entry-gate" name="gate" required><option value="">Choose an entrance</option>${gates.map(g => `<option value="${esc(g.id)}">${esc(g.name)}${g.private ? ' (Private)' : ''}</option>`).join('')}</select></div></div><p class="kgr-entry-warning" data-private-entry hidden role="status">This entrance is private. Entry may be prohibited without permission.</p><p class="hint">Activate places the party token at this entrance and opens the scene for everyone. Travel stays paused until you resume it on the main map.</p>`,
    buttons: [
      {action: 'enter', label: 'Activate at chosen entrance', icon: 'fa-solid fa-users', disabled: true, callback: (_event, button) => ({gate: button.form.elements.gate.value})},
      {action: 'cancel', label: 'Not now', icon: 'fa-solid fa-xmark', callback: () => false}
    ],
    render: (_event, dialog) => {
      const select = dialog.element.querySelector('select[name="gate"]'), button = dialog.element.querySelector('[data-action="enter"]'), warning = dialog.element.querySelector('[data-private-entry]');
      select.addEventListener('change', () => { const gate = gates.find(g => g.id === select.value);button.disabled = !gate;warning.hidden = !gate?.private; });
    }
  });
  return isPrimaryGM() && settlementEntrances(scene, {arrival}).some(g => g.id === result?.gate) ? result.gate : null;
}

async function resolve(uuid) {
  if (!uuid) return null;
  try { return await fromUuid(uuid); } catch { return null; }
}

async function worldActor(actor, valid) {
  if (!actor?.pack) return actor;
  const existing = Array.from(game.actors ?? []).find(a => a._stats?.compendiumSource === actor.uuid || a.flags?.core?.sourceId === actor.uuid);
  if (existing) return existing;
  if (!valid()) return null;
  return game.actors.importFromCompendium(game.packs.get(actor.pack), actor.id, {}, {renderSheet: false});
}

/** Resolve one collective party marker. Individual character tokens are never used as the fallback. */
async function arrivalMarker(scene, sourceScene, globalActor, valid) {
  const target = tokensOf(scene), source = tokensOf(sourceScene);
  if(sourceScene?.partyId){
    const id=sourceScene.partyId,existing=target.find(t=>t.actor.id===id),traveling=source.find(t=>t.actor.id===id);
    if(existing)return{existing:existing.document};if(traveling)return{source:traveling.document};const actor=game.actors.get(id);return actor?.type==='group'?{actor}:null;
  }
  for (const uuid of [scene.getFlag(MODULE, 'partyToken'), globalActor]) {
    if (!uuid) continue;
    const existing = target.find(t => matchesPartyToken(t, uuid));
    if (existing) return {existing: existing.document};
    const traveling = source.find(t => matchesPartyToken(t, uuid));
    if (traveling) return {source: traveling.document};
    const ref = await resolve(uuid);
    if (!valid()) return null;
    if (ref?.documentName === 'Actor' && ref.type === 'group') return {actor: await worldActor(ref, valid)};
    if (ref?.documentName === 'Token' && ref.parent?.id === scene.id && ref.actor?.type === 'group') return {existing: ref};
  }
  const existing = target.find(collective);
  if (existing) return {existing: existing.document};
  const sourceOverride = sourceScene?.getFlag(MODULE, 'partyToken');
  const traveling = (sourceOverride && source.find(t => matchesPartyToken(t, sourceOverride))) || source.find(collective);
  if (traveling) return {source: traveling.document};
  const ref = await resolve(sourceOverride);
  if (!valid()) return null;
  if(ref?.documentName==='Actor'&&ref.type==='group')return{actor:await worldActor(ref,valid)};
  ui.notifications.warn('KG Realms: designate a group actor for the party before entering the settlement.');return null;
}

export function gateTokenPosition(scene, gate, token) {
  const grid = scene.grid?.size ?? 100, d = scene.dimensions;
  const w = (token.width ?? 1) * grid, h = (token.height ?? 1) * grid;
  const left = d.sceneX ?? 0, top = d.sceneY ?? 0;
  return {
    x: Math.round(Math.max(left, Math.min(left + d.sceneWidth - w, gate.x - w / 2))),
    y: Math.round(Math.max(top, Math.min(top + d.sceneHeight - h, gate.y - h / 2)))
  };
}

const entriesInFlight = new Map();
/** Create or reuse exactly one party token, finish its placement, then activate for the players. */
export async function enterSettlement(scene, gateId, {sourceScene, globalActor = '', valid = () => true, arrival = null} = {}) {
  if (!isPrimaryGM() || !valid()) return false;
  const entryKey=`${scene.id}:${sourceScene?.partyId??'main'}`;
  if (entriesInFlight.has(entryKey)) return entriesInFlight.get(entryKey);
  const work = (async () => {
    let gate = settlementEntrances(scene, {arrival}).find(g => g.id === gateId);
    if (!gate) { ui.notifications.warn('KG Realms: that entrance is no longer available. Choose another entrance.'); return false; }
    let privateApproved = false;
    const approve = async () => {
      for (;;) {
        if (!isPrimaryGM() || !valid()) return null;
        const entry = settlementEntrances(scene, {arrival}).find(g => g.id === gateId);
        if (!entry) { ui.notifications.warn('KG Realms: that entrance was removed or changed. Choose another entrance.'); return null; }
        if (!entry.private || privateApproved) return entry;
        const ok = await foundry.applications.api.DialogV2.confirm({window:{title:'Private entrance'},content:`<p><strong>${esc(entry.name)}</strong> is private. Entry may be prohibited without permission.</p><p>Place the party here anyway?</p>`,yes:{label:'Use private entrance'},no:{label:'Choose another entrance'},rejectClose:false});
        if (ok !== true) return null;
        privateApproved = true;
      }
    };
    gate = await approve();if (!gate) return false;
    const marker = await arrivalMarker(scene, sourceScene, globalActor, valid);
    if (!marker || !isPrimaryGM() || !valid()) return false;
    let token = marker.existing, data;
    if (!token) {
      if (marker.source) data = marker.source.toObject();
      else if (marker.actor) data = (await marker.actor.getTokenDocument({}, {parent: scene})).toObject();
      else return false;
    }
    gate = await approve();if (!gate || !isPrimaryGM() || !valid()) return false;
    // No asynchronous work between this final entrance check and its token write.
    const current = settlementEntrances(scene, {arrival}).find(g => g.id === gateId);
    if (!current || (current.private && !privateApproved)) return false;
    if (token) {
      await scene.updateEmbeddedDocuments('Token', [{_id: token.id, ...gateTokenPosition(scene, current, token)}], {animate: false});
    } else {
      delete data._id; delete data._stats;
      Object.assign(data, gateTokenPosition(scene, current, data));
      [token] = await scene.createEmbeddedDocuments('Token', [data]);
      if (!token) throw Error('The settlement party token could not be created.');
    }
    if (!isPrimaryGM() || !valid()) return false;
    // A scene-specific designation keeps the newly placed marker identifiable, including actorless ones.
    const designation = scene.getFlag(MODULE, 'partyToken');
    const represented = wrap(token);
    if (!designation || !matchesPartyToken(represented, designation)) await scene.setFlag(MODULE, 'partyToken', token.uuid);
    if (!isPrimaryGM() || !valid()) return false;
    await scene.activate();
    return true;
  })();
  entriesInFlight.set(entryKey, work);
  try { return await work; } finally { entriesInFlight.delete(entryKey); }
}
