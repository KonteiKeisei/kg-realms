// Harvesting (0.96): what a dead creature gives, read from its own sheet as it is (its type, size, CR,
// attacks and their damage types, senses, traits and spells), so any creature works, homebrew
// included, with no list of monsters. Pure: no Foundry, so the tests can run it.
//
// Items are named by what they are, never by the creature: "Rare red dragon scales", "Uncommon claws".
// Each carries a rarity from the creature's CR, so items of one name have one value, and like stacks
// with like. Meat is edible or not; a failed meat check gives a quarter of it, mangled (edible, no sale).

/** The rarity of a creature's parts, by its CR: D&D's own words, and how much more they are worth. */
export const TIERS = [
  { key: "common", label: "Common", maxCr: 1, mult: 1 },
  { key: "uncommon", label: "Uncommon", maxCr: 4, mult: 2 },
  { key: "rare", label: "Rare", maxCr: 10, mult: 5 },
  { key: "veryRare", label: "Very rare", maxCr: 16, mult: 15 },
  { key: "legendary", label: "Legendary", maxCr: Infinity, mult: 40 }
];
export const tierOf = (cr) => TIERS.find((t) => (Number(cr) || 0) <= t.maxCr);

/**
 * By size: meat and bones (a roll: n dice of d sides, plus), how many hides, and the minutes a part
 * takes (meat and hide take twice as long).
 */
export const SIZES = {
  tiny: { label: "Tiny", meat: [1, 2, 0], bones: [1, 2, 0], hides: 1, minutes: 5 },
  sm: { label: "Small", meat: [2, 6, 0], bones: [1, 4, 0], hides: 1, minutes: 10 },
  med: { label: "Medium", meat: [5, 10, 10], bones: [2, 6, 5], hides: 1, minutes: 20 },
  lg: { label: "Large", meat: [10, 20, 50], bones: [5, 10, 20], hides: 2, minutes: 40 },
  huge: { label: "Huge", meat: [20, 50, 200], bones: [10, 20, 50], hides: 4, minutes: 80 },
  grg: { label: "Gargantuan", meat: [40, 100, 1000], bones: [20, 50, 200], hides: 8, minutes: 120 }
};

/** Creature types whose flesh can be eaten (a plant's is wild greens); humanoids and giants only by the world setting. */
export const EDIBLE = new Set(["beast", "dragon", "monstrosity", "plant"]);
export const PEOPLE = new Set(["humanoid", "giant"]);
/** Subtypes that make any creature inedible, whatever its type. */
export const INEDIBLE_SUBTYPES = ["undead", "fiend", "construct"];
/** A pound of edible meat, before rarity and the world's prices. */
export const MEAT_GP = 0.05;
/** Pounds of meat or greens, mangled or not, for one ration. */
export const LB_PER_RATION = 3;

/** Each part: its label, the DC it adds (the GM can change these), its value in gp and its weight in lb, each. */
export const PARTS = {
  meat: { label: "edible meat", diff: 0, gp: MEAT_GP, lb: 1, perLb: true, icon: "icons/consumables/meat/steak-raw-red-pink.webp" },
  greens: { label: "wild greens", diff: 0, gp: MEAT_GP, lb: 1, perLb: true, icon: "icons/consumables/vegetable/leaf-green.webp" },
  hide: { label: "hide", diff: 2, gp: 0.5, lb: 10, icon: "icons/commodities/leather/leather-bolt-brown.webp" },
  monsterHide: { label: "monster hide", diff: 2, gp: 2, lb: 12, icon: "icons/commodities/leather/leather-scales-brown.webp" },
  scales: { label: "dragon scales", diff: 4, gp: 50, lb: 15, icon: "icons/commodities/leather/scales-red.webp" },
  aberrantHide: { label: "aberrant hide", diff: 3, gp: 5, lb: 10, icon: "icons/commodities/biological/skin-purple.webp" },
  fiendHide: { label: "fiend hide", diff: 3, gp: 10, lb: 10, icon: "icons/commodities/leather/leather-scales-red.webp" },
  celestialSkin: { label: "celestial skin", diff: 4, gp: 25, lb: 8, icon: "icons/commodities/biological/skin-white.webp" },
  feySkin: { label: "fey skin", diff: 3, gp: 8, lb: 6, icon: "icons/commodities/biological/skin-green.webp" },
  giantHide: { label: "giant's hide", diff: 2, gp: 3, lb: 20, icon: "icons/commodities/leather/leather-bolt-tan.webp" },
  bark: { label: "bark", diff: 1, gp: 0.5, lb: 10, icon: "icons/commodities/wood/bark-brown.webp" },
  plating: { label: "plating", diff: 4, gp: 10, lb: 20, icon: "icons/commodities/metal/plate-steel.webp" },
  graveSkin: { label: "grave-cloth skin", diff: 3, gp: 3, lb: 6, icon: "icons/commodities/biological/skin-grey.webp" },
  bones: { label: "bones", diff: 0, gp: 0.1, lb: 1, perLb: true, icon: "icons/commodities/bones/bone-simple-white.webp" },
  claws: { label: "claws", diff: 2, gp: 0.5, lb: 0.2, dice: [1, 4], icon: "icons/commodities/claws/claw-black.webp" },
  talons: { label: "talons", diff: 2, gp: 0.5, lb: 0.2, dice: [1, 4], icon: "icons/commodities/claws/claw-bird-black.webp" },
  fangs: { label: "fangs", diff: 2, gp: 0.3, lb: 0.1, dice: [1, 6], icon: "icons/commodities/bones/tooth-fang-white.webp" },
  horn: { label: "horns", diff: 3, gp: 2, lb: 2, dice: [1, 2], icon: "icons/commodities/biological/horn-grey.webp" },
  stinger: { label: "stinger", diff: 4, gp: 3, lb: 1, dice: [1, 1], icon: "icons/commodities/biological/stinger-black.webp" },
  tailSpikes: { label: "tail spikes", diff: 3, gp: 0.5, lb: 0.5, dice: [1, 6], icon: "icons/commodities/bones/spike-bone-white.webp" },
  venom: { label: "venom gland", diff: 5, gp: 10, lb: 0.5, dice: [1, 3], icon: "icons/consumables/potions/vial-cork-green.webp" },
  gland: { label: "gland", diff: 6, gp: 25, lb: 2, dice: [1, 1], icon: "icons/commodities/biological/organ-sac-red.webp" },
  eyes: { label: "eyes", diff: 3, gp: 2, lb: 0.2, dice: [1, 2], icon: "icons/commodities/biological/eye-blue.webp" },
  feathers: { label: "feathers", diff: 0, gp: 0.1, lb: 0.5, dice: [1, 6], unit: "bundle", icon: "icons/commodities/materials/feather-white.webp" },
  wings: { label: "wing membrane", diff: 4, gp: 5, lb: 3, dice: [1, 2], icon: "icons/commodities/biological/wing-bat-brown.webp" },
  silk: { label: "silk gland", diff: 3, gp: 5, lb: 1, dice: [1, 1], icon: "icons/commodities/cloth/thread-spindle-white.webp" },
  ink: { label: "ink sac", diff: 2, gp: 1, lb: 1, dice: [1, 1], icon: "icons/consumables/potions/vial-cork-black.webp" },
  arcane: { label: "arcane gland", diff: 5, gp: 15, lb: 1, dice: [1, 1], icon: "icons/commodities/biological/organ-sac-purple.webp" },
  blood: { label: "blood", diff: 3, gp: 5, lb: 0.5, dice: [1, 4], unit: "vial", icon: "icons/consumables/potions/vial-cork-red.webp" },
  sap: { label: "sap", diff: 3, gp: 5, lb: 0.5, dice: [1, 4], unit: "vial", icon: "icons/consumables/potions/vial-cork-amber.webp" },
  heart: { label: "heart", diff: 6, gp: 30, lb: 3, dice: [1, 1], icon: "icons/commodities/biological/organ-heart-red.webp" },
  essence: { label: "essence", diff: 4, gp: 10, lb: 0.5, dice: [1, 3], unit: "vial", icon: "icons/consumables/potions/vial-cork-blue.webp" },
  core: { label: "core", diff: 5, gp: 40, lb: 5, dice: [1, 1], icon: "icons/commodities/gems/gem-rough-ball-purple.webp" }
};

/** Mangled meat and bruised greens: a failed check's quarter. Edible, but nobody buys them. */
export const SPOILED_CUT = { meat: { key: "meat:mangled", name: "Mangled meat" }, greens: { key: "greens:bruised", name: "Bruised greens" } };

/** Dragon colours read from a dragon's name, for its scales. */
const DRAGON_COLOURS = ["red", "blue", "green", "black", "white", "brass", "bronze", "copper", "gold", "silver", "shadow", "dracolich", "faerie", "deep", "moonstone", "sapphire", "emerald", "topaz", "amethyst", "crystal", "lunar", "solar"];
/** Breath and gland elements by damage type. */
const ELEMENT = { fire: "fire", cold: "frost", lightning: "storm", thunder: "storm", acid: "acid", poison: "poison", necrotic: "necrotic", radiant: "radiant", force: "force", psychic: "psychic" };
/** Undead with no body to skin. */
const INCORPOREAL = /\b(ghost|specter|spectre|wraith|shadow|banshee|poltergeist|will-o|wisp|phantom|allip|spirit)\b/i;

const list = (x) => (x == null ? [] : Array.isArray(x) ? x : x instanceof Set ? [...x] : typeof x.values === "function" && !(typeof x === "string") ? [...x.values()] : typeof x === "object" ? Object.values(x) : [x]);
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The damage types an item deals, from any dnd5e version's damage data. */
export function damageTypesOf(item) {
  const out = new Set(), sys = item?.system ?? {};
  const add = (part) => {
    if (!part) return;
    if (Array.isArray(part)) { if (part[1]) out.add(String(part[1])); return; }
    for (const t of list(part.types)) out.add(String(t));
    if (part.type) out.add(String(part.type));
  };
  for (const p of list(sys.damage?.parts)) add(p);
  add(sys.damage?.base);
  for (const a of list(sys.activities)) { for (const p of list(a?.damage?.parts)) add(p); }
  return [...out].map((t) => t.toLowerCase());
}

/**
 * A creature's profile from its actor (any dnd5e version; a plain object with the same shape works):
 * { name, type, subtype, size, cr, attacks: [{ name, types, natural }], senses, perceptive, fly,
 *   spellcaster, legendary, immunities, traits: [names] }.
 */
export function creatureProfile(actor) {
  const sys = actor?.system ?? {}, details = sys.details ?? {}, attrs = sys.attributes ?? {};
  const t = details.type ?? {}, type = String((typeof t === "string" ? t : t.value === "custom" ? t.custom : t.value) ?? "").toLowerCase();
  const subtype = String(typeof t === "string" ? "" : t.subtype ?? "").toLowerCase();
  const sensesRaw = attrs.senses?.ranges ?? attrs.senses ?? {};
  const senses = Object.fromEntries(["darkvision", "blindsight", "tremorsense", "truesight"].map((k) => [k, num(sensesRaw[k])]));
  const prc = sys.skills?.prc ?? {};
  const items = list(actor?.items);
  const attacks = items.filter((i) => i?.type === "weapon" || ["mwak", "rwak", "msak", "rsak"].includes(i?.system?.actionType) || list(i?.system?.activities).some((a) => a?.type === "attack") || /breath/i.test(i?.name ?? ""))
    .map((i) => ({ name: String(i.name ?? ""), types: damageTypesOf(i), natural: i.type !== "weapon" || /natural/i.test(String(i.system?.type?.value ?? i.system?.weaponType ?? "")) }));
  return {
    name: String(actor?.name ?? "Creature"), type, subtype,
    size: SIZES[sys.traits?.size] ? sys.traits.size : "med",
    cr: num(details.cr),
    attacks, senses,
    perceptive: num(prc.value ?? prc.proficient) >= 1,
    fly: num(attrs.movement?.fly) > 0,
    spellcaster: items.some((i) => i?.type === "spell" || /spellcasting/i.test(i?.name ?? "")),
    legendary: num(sys.resources?.legact?.max ?? sys.resources?.legact?.value) > 0 || items.some((i) => /legendary (action|resistance)/i.test(i?.name ?? "")),
    immunities: list(sys.traits?.di?.value).map((x) => String(x).toLowerCase()),
    traits: items.filter((i) => i?.type === "feat").map((i) => String(i.name ?? ""))
  };
}

/** Whether a creature's flesh can be eaten (rules: { people } lets humanoids and giants be eaten). */
export function edible(profile, { people = false } = {}) {
  if (INEDIBLE_SUBTYPES.some((s) => profile.subtype.includes(s))) return false;
  return EDIBLE.has(profile.type) || (people && PEOPLE.has(profile.type));
}

/** A dragon's colour from its name ("Young Red Dragon": red), or "". */
export function dragonColour(name) {
  const words = String(name).toLowerCase();
  return DRAGON_COLOURS.find((c) => new RegExp(`\\b${c}\\b`).test(words)) ?? "";
}

/** The hide a creature gives (a PARTS key, and for a dragon its colour), or null. */
export function hideOf(p) {
  if (p.type === "beast") return { part: "hide" };
  if (p.type === "monstrosity") return { part: "monsterHide" };
  if (p.type === "dragon") return { part: "scales", colour: dragonColour(p.name) };
  if (p.type === "aberration") return { part: "aberrantHide" };
  if (p.type === "fiend") return { part: "fiendHide" };
  if (p.type === "celestial") return { part: "celestialSkin" };
  if (p.type === "fey") return { part: "feySkin" };
  if (p.type === "giant") return { part: "giantHide" };
  if (p.type === "plant") return { part: "bark" };
  if (p.type === "construct") return { part: "plating" };
  if (p.type === "undead" && !INCORPOREAL.test(p.name)) return { part: "graveSkin" };
  return null;
}

/**
 * Everything a creature gives, before anyone tries: [{ key (one stack's identity), part, name, dc
 * (before the skill's adjustment), minutes, dice: [n, d, plus] for the amount, max, unitGp (at
 * Prices x1), lb (each), perLb, icon, from (why it has it) }]. rules: { people, dcs } (dcs: the
 * world's DC settings, see DEFAULT_DCS).
 */
export function partsFor(profile, { people = false, dcs = DEFAULT_DCS } = {}) {
  const tier = tierOf(profile.cr), size = SIZES[profile.size] ?? SIZES.med, out = [];
  const diffOf = (part) => num(dcs.parts?.[part] ?? PARTS[part].diff);
  const base = num(dcs.base ?? DEFAULT_DCS.base) + Math.floor(profile.cr / 2);
  const add = (part, { label = PARTS[part].label, key = part, dice = PARTS[part].dice, plus = 0, big = false, from = "" } = {}) => {
    const def = PARTS[part];
    const d = dice ?? [1, 1];
    const n = d[0], sides = d[1], extra = d[2] ?? plus;
    out.push({
      key: `${key}:${tier.key}`, part, name: `${tier.label} ${label}`, dc: base + diffOf(part), minutes: size.minutes * (big ? 2 : 1),
      dice: [n, sides, extra], max: n * sides + extra, unitGp: def.gp * tier.mult, lb: def.lb, perLb: !!def.perLb, icon: def.icon, tier: tier.key, from
    });
  };
  // Meat, or a plant's wild greens: edible or not at all.
  if (edible(profile, { people })) add(profile.type === "plant" ? "greens" : "meat", { dice: size.meat, big: true });
  // The hide: a bigger creature gives more of it, not a better one.
  const hide = hideOf(profile);
  if (hide) {
    const label = hide.colour ? `${hide.colour} dragon scales` : PARTS[hide.part].label;
    add(hide.part, { label, key: hide.colour ? `scales-${hide.colour}` : hide.part, dice: [size.hides, 1, 0], big: true });
  }
  // Bones, by the pound: anything with a body to have them.
  if (!["elemental", "ooze", "plant", "construct"].includes(profile.type) && !(profile.type === "undead" && INCORPOREAL.test(profile.name))) add("bones", { dice: size.bones });
  // From its attacks.
  const natural = profile.attacks.filter((a) => a.natural);
  const has = (re, type = null) => natural.find((a) => re.test(a.name) && (!type || a.types.includes(type)));
  const talon = has(/\btalons?\b/i);
  const claw = talon ?? has(/\b(claws?|rake|scythe|slash)\b/i) ?? natural.find((a) => a.types.includes("slashing") && !/\b(tail|horn|gore|wing)\b/i.test(a.name));
  if (claw) add(talon ? "talons" : "claws", { from: claw.name });
  const bite = has(/\b(bite|beak|fangs?|maw|jaws?|mandibles?)\b/i) ?? natural.find((a) => a.types.includes("piercing") && !/\b(tail|sting|horn|gore|tusk|spike)\b/i.test(a.name));
  if (bite) add("fangs", { from: bite.name });
  const horn = has(/\b(gore|ram|horns?|tusks?|antlers?|butt)\b/i);
  if (horn) add("horn", { from: horn.name });
  const sting = has(/\bsting(er)?\b/i);
  if (sting) add("stinger", { from: sting.name });
  const tail = has(/\btail\b/i, "piercing");
  if (tail) add("tailSpikes", { from: tail.name });
  const venom = profile.attacks.find((a) => a.types.includes("poison") && !/breath/i.test(a.name));
  if (venom) add("venom", { from: venom.name });
  const breath = profile.attacks.find((a) => /breath/i.test(a.name));
  if (breath) {
    const element = breath.types.map((t) => ELEMENT[t]).find(Boolean) ?? "breath";
    add("gland", { label: `${element} gland`, key: `gland-${element}`, from: breath.name });
  }
  // From what it is and does.
  if (profile.perceptive || profile.senses.darkvision >= 120 || profile.senses.truesight > 0 || profile.senses.blindsight > 0) add("eyes", { from: profile.perceptive ? "Perception" : "keen senses" });
  if (profile.fly && !["elemental", "ooze", "construct", "undead"].includes(profile.type)) {
    const membrane = ["dragon", "fiend", "monstrosity"].includes(profile.type) || /\b(bat|wasp|bee|fly|beetle|moth|insect|dragonfly|stirge)\b/i.test(profile.name);
    add(membrane ? "wings" : "feathers", { from: "a flying speed" });
  }
  if (profile.traits.some((t) => /\bweb\b/i.test(t))) add("silk", { from: "webs" });
  if (profile.traits.some((t) => /ink cloud/i.test(t))) add("ink", { from: "Ink Cloud" });
  if (profile.spellcaster) add("arcane", { from: "spellcasting" });
  if (profile.cr >= 5 || ["dragon", "fiend", "celestial", "fey"].includes(profile.type)) {
    if (!["construct", "elemental", "ooze"].includes(profile.type) && !(profile.type === "undead")) add(profile.type === "plant" ? "sap" : "blood", { from: profile.cr >= 5 ? "CR 5 or more" : profile.type });
  }
  if ((profile.cr >= 5 || profile.legendary) && !["construct", "elemental", "ooze", "plant"].includes(profile.type) && !(profile.type === "undead" && INCORPOREAL.test(profile.name))) add("heart", { from: profile.legendary ? "legendary" : "CR 5 or more" });
  if (profile.type === "elemental") {
    const im = profile.immunities, n = profile.name.toLowerCase();
    const element = im.includes("fire") || /fire|magma|flame|salamander/.test(n) ? "ember" : im.includes("cold") || /water|ice|frost/.test(n) ? "frost" : im.includes("lightning") || im.includes("thunder") || /air|storm|wind/.test(n) ? "storm" : "earth";
    add("essence", { label: `${element} essence`, key: `essence-${element}`, from: "elemental" });
  }
  if (profile.type === "ooze") add("essence", { label: "ooze residue", key: "residue", from: "ooze" });
  if (profile.type === "undead") add("essence", INCORPOREAL.test(profile.name) ? { label: "ectoplasm", key: "ectoplasm", from: "undead" } : { label: "grave dust", key: "grave-dust", from: "undead" });
  if (profile.type === "construct") add("core", { label: "animating core", from: "construct" });
  return out;
}

/** The world's DC settings, by default: base DC, what Survival and Medicine take off, and each part's difficulty. */
export const DEFAULT_DCS = Object.freeze({ base: 10, survival: 4, medicine: 2, parts: Object.freeze(Object.fromEntries(Object.entries(PARTS).map(([k, v]) => [k, v.diff]))) });
/** The skills a harvester can use: their dnd5e key and what each takes off the DC. */
export const HARVEST_SKILLS = { sur: { label: "Survival", off: "survival" }, med: { label: "Medicine", off: "medicine" }, slt: { label: "Sleight of Hand", off: null } };
/** A part's DC for a skill. */
export function dcFor(part, skill, dcs = DEFAULT_DCS) {
  const off = HARVEST_SKILLS[skill]?.off;
  return Math.max(1, part.dc - (off ? num(dcs[off] ?? DEFAULT_DCS[off]) : 0));
}

/**
 * One part's check, by the leader with help: total (the leader's roll), helper (the helper's roll and
 * their DC, or null), dc. Returns { total, success, ruined }. A helper's success is +1, a failure -1.
 */
export function harvestCheck(lead, help, dc) {
  const helped = help ? (help.total >= help.dc ? 1 : -1) : 0, total = lead + helped;
  return { total, helped, success: total >= dc, ruined: total <= dc - 5 };
}

/**
 * What a part gives for a check: rolled (the amount rolled, 1 to max) and the check's result. Meat
 * and greens can't be ruined: a failure gives a quarter, rounded down, mangled. Returns { qty, key,
 * name, unitGp, outcome: "got" | "mangled" | "nothing" | "ruined" }.
 */
export function harvestYield(part, check, rolled) {
  if (check.success) return { qty: rolled, key: part.key, name: part.name, unitGp: part.unitGp, outcome: "got" };
  if (part.part === "meat" || part.part === "greens") {
    const qty = Math.floor(rolled / 4), cut = SPOILED_CUT[part.part];
    return { qty, key: cut.key, name: cut.name, unitGp: 0, outcome: qty ? "mangled" : "nothing" };
  }
  return { qty: 0, key: part.key, name: part.name, unitGp: part.unitGp, outcome: check.ruined ? "ruined" : "nothing" };
}

/** A roll of dice [n, d, plus] with rnd() in [0, 1). */
export function rollAmount([n, d, plus = 0], rnd = Math.random) {
  let t = plus;
  for (let i = 0; i < n; i++) t += 1 + Math.floor(rnd() * d);
  return t;
}
/** "10d20+50" for a part's amount. */
export const diceText = ([n, d, plus = 0]) => (d === 1 ? String(n + plus) : `${n}d${d}${plus ? `+${plus}` : ""}`);

/** Minutes a leader spends on what they take: each part's time, added up. */
export const workMinutes = (parts) => parts.reduce((s, p) => s + p.minutes, 0);

/** A value in gp as D&D coins: "2 gp 5 sp", "4 cp", "nothing". */
export function coins(gp) {
  let cp = Math.round(Math.max(0, gp) * 100);
  if (!cp) return "nothing";
  const g = Math.floor(cp / 100); cp -= g * 100;
  const s = Math.floor(cp / 10); cp -= s * 10;
  return [g ? `${g.toLocaleString()} gp` : "", s ? `${s} sp` : "", cp ? `${cp} cp` : ""].filter(Boolean).join(" ");
}

/** "1 h 20 min", "40 min", "26 h". */
export function minutesText(m) {
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return h ? `${h} h${r ? ` ${r} min` : ""}` : `${r} min`;
}

/**
 * Preserving meat (the camp task): batches [{ at, lb }] of meat and greens on hand, oldest first, and
 * how many pounds can be preserved. Returns { used: [{ index, lb }], lb, rations } (whole rations
 * only: leftover pounds under LB_PER_RATION stay as they are).
 */
export function preserve(batches, capacity) {
  const total = Math.min(capacity, batches.reduce((s, b) => s + b.lb, 0)), rations = Math.floor(total / LB_PER_RATION);
  let left = rations * LB_PER_RATION;
  const used = [];
  batches.forEach((b, index) => { if (left <= 0) return; const lb = Math.min(b.lb, left); used.push({ index, lb }); left -= lb; });
  return { used, lb: rations * LB_PER_RATION, rations };
}

/** Days fresh meat keeps when the spoilage setting is on. */
export const SPOIL_DAYS = 3;
/** Batches [{ at, lb }] split into what has spoiled by `now` (world seconds) and what is still good. */
export function spoil(batches, now, days = SPOIL_DAYS) {
  const limit = now - days * 86400, good = [], gone = [];
  for (const b of batches) (b.at < limit ? gone : good).push(b);
  return { good, gone, lost: gone.reduce((s, b) => s + b.lb, 0) };
}
