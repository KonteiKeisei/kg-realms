import { placeLayer } from './map-layers.mjs';

// Scene placement is independent of the place's editable territory outline.
const mapName = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  .replace(/^(?:regional\s+)?map\s+(?:of\s+)?(?:the\s+)?/, '').replace(/^the\s+/, '').trim();

/** Resolve a stable place ID, or recognise older links that only stored their outline or map name. */
export function regionalPlace(link, places) {
  if (Object.hasOwn(link, 'placeId')) return places.find(p => p.id === link.placeId) ?? null;
  const outlined = link.outline && places.find(p => p.id === link.outline);
  if (outlined) return outlined;
  const title = mapName(link.title);
  if (!title) return null;
  const matches = places.filter(p => placeLayer(p) === 'realms' && [p.name, p.original].some(name => mapName(name) === title));
  return matches.length === 1 ? matches[0] : null;
}
