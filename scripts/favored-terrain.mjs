// Read chosen terrain from ranger features, without treating a rules options list as a choice.
const normalize = text => String(text ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const aliases = {
  plains: ["plain", "plains", "grassland", "grasslands"], forest: ["forest", "forests", "woodland", "woodlands"],
  mountains: ["mountain", "mountains"], hills: ["hill", "hills"], desert: ["desert", "deserts"],
  wetlands: ["wetland", "wetlands", "swamp", "swamps", "marsh", "marshes", "bog", "bogs", "mire", "mires"],
  tundra: ["tundra", "arctic"], glacier: ["glacier", "glaciers", "arctic"], taiga: ["taiga", "boreal forest"]
};
const list = value => Array.isArray(value) ? value : value?.contents ?? [...(value?.values?.() ?? [])];
const feature = /\b(?:favou?red terrains?|natural explorer)\b/i;
const chooser = /\b(?:choose|select|one of|such as|options?|following types?)\b/i;
const selected = /\b(?:favou?red terrains?|chosen terrains?|selected terrains?)\s*(?::|=|\bis\b|\bare\b)\s*(.*)/i;
const cache = new WeakMap();

function choices(item) {
  const name = String(item.name ?? ""), description = item.system?.description?.value ?? "";
  const signature = `${name}|${item.system?.identifier ?? ""}|${description}`;
  if (cache.get(item)?.signature === signature) return cache.get(item).choices;
  const id = String(item.system?.identifier ?? "").replace(/[-_]/g, " ");
  const out = [];
  if (item.type === "feat" && feature.test(`${name} ${id}`)) {
    const suffix = name.replace(feature, "").replace(/^[\s:()\[\],-]+|[\s()\[\]]+$/g, "");
    if (suffix && !chooser.test(suffix)) out.push(suffix);
    const plain = String(description).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<\/?(?:p|div|br|li|h[1-6]|ul|ol|tr|td)\b[^>]*>/gi, "\n").replace(/<[^>]*(?:>|$)/g, "")
      .replace(/&(?:nbsp|amp);/gi, " ").replace(/&#160;/g, " ").replace(/&#58;/g, ":");
    const lines = plain.split(/[\n\r]+/).map(s => s.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      if (chooser.test(lines[i])) continue;
      const prose = /\b(?:you (?:have )?(?:chosen|selected)|i (?:have )?(?:chosen|selected))\s+(.+?)(?:\s+as\b|[.!?]|$)/i.exec(lines[i]);
      if (prose) out.push(prose[1]);
      const match = selected.exec(lines[i]);
      if (!match) continue;
      if (match[1]) out.push(match[1].split(/[.!?]/)[0]);
      else for (let j = i + 1; j < lines.length && !/[.!?:]/.test(lines[j]) && !chooser.test(lines[j]); j++) out.push(lines[j]);
    }
    // A feature containing just "Forest" or "Forest, Mountains" is also a chosen entry.
    if (!chooser.test(plain) && normalize(plain).split(" ").length <= 8 && !/[.!?:]/.test(plain)) out.push(plain);
  }
  const value = out.map(normalize).filter(Boolean);
  cache.set(item, { signature, choices: value });
  return value;
}

/** Exact phrases and ordinary terrain synonyms, scoped to actual party rangers. */
export function partyFavoredBiomes(actors, types = {}) {
  const matched = new Set();
  const names = Object.entries(types).map(([id, t]) => [id, [...new Set([id, t.name, ...(aliases[id] ?? [])].map(normalize).filter(Boolean))]]);
  for (const actor of actors) {
    const items = list(actor.items);
    const ranger = actor.classes?.ranger ?? items.find(i => i.type === "class" && normalize(i.system?.identifier || i.name) === "ranger");
    if (!ranger || Number(ranger.system?.levels ?? 1) < 1) continue;
    const text = items.flatMap(choices);
    for (const [id, terms] of names) if (terms.some(term => text.some(s => (` ${s} `).includes(` ${term} `)))) matched.add(id);
  }
  return [...matched].sort();
}

/** Halve only the lost fraction of a biome's speed. Bonuses and normal speed stay unchanged. */
export function favoredBiomeMultiplier(multiplier, type, favored = []) {
  return multiplier >= 0 && multiplier < 1 && favored.includes(type) ? 1 - (1 - multiplier) / 2 : multiplier;
}
