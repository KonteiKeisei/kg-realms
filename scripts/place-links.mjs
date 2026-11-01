// Place-card references use stable IDs, so renaming a place does not break its links.
import { fold } from './places.mjs';

export const PLACE_LINK = /@Place\[([^\]\s]+)\](?:\{([^}]*)\})?/g;

export function placeTarget(ref) {
  const parts = ref?.kind === 'local' ? ['local', ref.scene, ref.note]
    : ref?.kind === 'realm' ? ['realm', ref.world, ref.id] : null;
  if (!parts || parts.some(p => typeof p !== 'string' || !p || p.length > 256)) return null;
  return parts.map(encodeURIComponent).join(':');
}

export function placeReference(target) {
  if (typeof target !== 'string' || target.length > 2304) return null;
  let parts;
  try { parts = target.split(':').map(decodeURIComponent); } catch { return null; }
  if (parts.length !== 3 || parts.some(p => !p || p.length > 256)) return null;
  const [kind, a, b] = parts;
  return kind === 'local' ? {kind, scene: a, note: b}
    : kind === 'realm' ? {kind, world: a, id: b} : null;
}

export function placeToken(ref, name) {
  const target = placeTarget(ref);
  if (!target) throw Error('Invalid place reference');
  return `@Place[${target}]{${String(name ?? 'Place').replace(/[{}\r\n]/g, ' ')}}`;
}

/** Search a snapshot of the world's place index and local Notes, without network calls per key. */
export function findPlaceLinks(query, entries, limit = 30) {
  const q = fold(query).trim();
  if (!q) return [];
  return entries.filter(e => placeTarget(e.ref)).map(e => {
    const n = fold(e.name);
    const score = n === q ? 100 : n.startsWith(q) ? 80
      : n.split(/[\s'-]+/).some(w => w.startsWith(q)) ? 60 : n.includes(q) ? 40
      : fold(e.where).includes(q) ? 20 : 0;
    return {...e, score};
  }).filter(e => e.score).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || String(a.where).localeCompare(String(b.where))).slice(0, limit);
}

/** Foundry's enrichment runs after secret removal. Links also work outside the place-card window. */
export function registerPlaceLinks(cards) {
  CONFIG.TextEditor.enrichers.push({
    pattern: PLACE_LINK,
    enricher: match => {
      const ref = placeReference(match[1]);
      if (!ref) return null;
      const a = document.createElement('a');
      a.className = 'kgr-link kgr-place-link';
      a.href = '#';
      a.dataset.kgrPlace = placeTarget(ref);
      a.title = 'Open place card';
      const icon = document.createElement('i');
      icon.className = 'fa-solid fa-map-location-dot';
      a.append(icon, document.createTextNode(match[2] || 'Place'));
      return a;
    }
  });
  document.addEventListener('click', e => {
    const a = e.target.closest?.('a[data-kgr-place]');
    if (!a || a.closest('prose-mirror, [contenteditable="true"]')) return;
    e.preventDefault();
    e.stopPropagation();
    const ref = placeReference(a.dataset.kgrPlace);
    if (ref) cards.open(ref, {warnMissing: true}).catch(error => {
      console.error('kg-realms | place link:', error);
      ui.notifications.warn('KG Realms: this place card could not be opened.');
    });
  });
}

/** Capture the documented ProseMirror plugins event before its custom element initializes. */
export function capturePlaceEditor(event, setView) {
  const Plugin = globalThis.foundry?.prosemirror?.Plugin;
  if (!Plugin) return;
  event.plugins.kgRealmsPlaceLinks = new Plugin({view(view) {
    setView(view);
    return {destroy() { setView(null); }};
  }});
}

export function insertPlaceToken(editor, view, token, selection) {
  if (view && !view.isDestroyed) {
    const {from, to} = view.state.selection;
    view.dispatch(view.state.tr.insertText(token, from, to).scrollIntoView());
    view.focus();
    return true;
  }
  if (editor?.tagName === 'TEXTAREA') {
    const {start, end} = selection ?? {start: editor.selectionStart, end: editor.selectionEnd};
    editor.setRangeText(token, start, end, 'end');
    editor.dispatchEvent(new Event('input', {bubbles: true}));
    editor.focus();
    return true;
  }
  return false;
}
