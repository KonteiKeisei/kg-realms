// Harvested parts as items (0.96): made on the spot as ordinary dnd5e items, no compendium. Meat and
// greens are food (consumables), everything else a material (loot). Each carries a key in its flags
// ("meat:rare", "scales-red:legendary", "meat:mangled"), and a new harvest stacks onto any item with the
// same key, so all rare edible meat is one stack whatever it came from.
import { PARTS, LB_PER_RATION, preserve, spoil } from "./catalog.mjs";

const MODULE_ID = "kg-realms";
const FOOD = new Set(["meat", "greens"]);
const v4 = () => foundry.utils.isNewerVersion(game.system?.version ?? "0", "3.99");

/** A price in gp as dnd5e's { value, denomination }, in the coin that keeps it whole. */
export function priceOf(gp) {
  const cp = Math.round(Math.max(0, gp) * 100);
  if (cp % 100 === 0) return { value: cp / 100, denomination: "gp" };
  if (cp % 10 === 0) return { value: cp / 10, denomination: "sp" };
  return { value: cp, denomination: "cp" };
}

/** The flag record on a harvested item, or null. */
export const harvestFlag = (item) => item?.flags?.[MODULE_ID]?.harvest ?? item?.getFlag?.(MODULE_ID, "harvest") ?? null;
/** Whether an item is harvested food (meat or greens, mangled or not), which Provisioning turns into rations. */
export const isFood = (item) => !!harvestFlag(item)?.food;

/**
 * New item data for a part's yield: { key, name, unitGp (already at the world's prices), qty, part,
 * at (world time of the kill, for spoilage) }.
 */
export function itemData(y) {
  const def = PARTS[y.part] ?? PARTS.bones, food = FOOD.has(y.part);
  const weight = v4() ? { value: def.lb, units: "lb" } : def.lb;
  const what = food ? (y.unitGp ? "Fresh from a harvest. Edible; Provisioning at camp turns 3 lb into a ration." : "Edible but badly cut: no merchant will buy it. Provisioning at camp still turns 3 lb into a ration.")
    : `Harvested from a creature. Sold by the ${def.unit ?? "piece"}${def.perLb ? " (a pound each)" : ""}.`;
  return {
    name: y.name, type: food ? "consumable" : "loot", img: def.icon,
    system: {
      description: { value: `<p>${what}</p>` },
      quantity: y.qty, weight, price: priceOf(y.unitGp),
      type: food ? { value: "food", subtype: "" } : { value: "material", subtype: "" },
      ...(food ? { uses: { max: "", spent: 0, autoDestroy: true } } : {})
    },
    flags: { [MODULE_ID]: { harvest: { key: y.key, food, batches: food ? [{ at: y.at, lb: y.qty }] : [] } } }
  };
}

/** Give an actor a yield: onto its stack of the same key, or a new item. Returns the item. */
export async function giveYield(actor, y) {
  if (!y.qty) return null;
  const have = actor.items.find((i) => harvestFlag(i)?.key === y.key);
  if (!have) return (await actor.createEmbeddedDocuments("Item", [itemData(y)]))?.[0] ?? null;
  const f = harvestFlag(have) ?? {};
  await have.update({
    "system.quantity": (Number(have.system?.quantity) || 0) + y.qty,
    [`flags.${MODULE_ID}.harvest.batches`]: f.food ? [...(f.batches ?? []), { at: y.at, lb: y.qty }] : []
  });
  return have;
}

/** An item's batches as they stand: its flag's, trimmed to its quantity (someone may have eaten some). */
function batchesOf(item) {
  const qty = Number(item.system?.quantity) || 0, list = [...(harvestFlag(item)?.batches ?? [])].sort((a, b) => a.at - b.at);
  let extra = list.reduce((s, b) => s + b.lb, 0) - qty;
  // Eaten from the oldest first; any not on the flag (added by hand) count as fresh now.
  while (extra > 0 && list.length) { const b = list[0], take = Math.min(b.lb, extra); b.lb -= take; extra -= take; if (!b.lb) list.shift(); }
  if (extra < 0) list.push({ at: game.time.worldTime, lb: -extra });
  return list;
}

/** Set an item's batches and quantity together; an emptied stack is deleted. */
async function setBatches(item, batches) {
  const qty = batches.reduce((s, b) => s + b.lb, 0);
  if (qty <= 0) return item.delete();
  return item.update({ "system.quantity": qty, [`flags.${MODULE_ID}.harvest.batches`]: batches });
}

/**
 * Provisioning: each actor's own harvested food becomes rations in their own pack, oldest first, up
 * to `capacity` pounds in all. rationUuid: the world's ration item. Returns { lb, rations, by: [{ actor, rations }] }.
 */
export async function provision(actors, capacity, rationUuid) {
  const src = rationUuid ? await fromUuid(rationUuid).catch(() => null) : null;
  if (!src) throw new Error("the ration item is not set (Advanced watches settings), so no rations can be made");
  let left = capacity, lb = 0, rations = 0;
  const by = [];
  for (const actor of actors) {
    if (left < LB_PER_RATION) break;
    const stacks = actor.items.filter(isFood).map((item) => ({ item, batches: batchesOf(item) }));
    const flat = stacks.flatMap((s, si) => s.batches.map((b, bi) => ({ ...b, si, bi }))).sort((a, b) => a.at - b.at);
    const p = preserve(flat, left);
    if (!p.rations) continue;
    for (const u of p.used) { const f = flat[u.index]; stacks[f.si].batches[f.bi].lb -= u.lb; }
    for (const s of stacks) await setBatches(s.item, s.batches.filter((b) => b.lb > 0));
    await addRations(actor, src, rationUuid, p.rations);
    left -= p.lb; lb += p.lb; rations += p.rations;
    by.push({ actor, rations: p.rations });
  }
  return { lb, rations, by };
}

/** Pounds of harvested food an actor carries. */
export const foodOn = (actor) => actor.items.filter(isFood).reduce((s, i) => s + (Number(i.system?.quantity) || 0), 0);

async function addRations(actor, src, uuid, n) {
  const have = actor.items.find((i) => i._stats?.compendiumSource === uuid || i.getFlag?.("core", "sourceId") === uuid || (i.name === src.name && i.type === src.type));
  if (have) return have.update({ "system.quantity": (Number(have.system?.quantity) || 0) + n });
  const data = src.toObject();
  data.system = { ...(data.system ?? {}), quantity: n };
  data._stats = { ...(data._stats ?? {}), compendiumSource: uuid };
  return actor.createEmbeddedDocuments("Item", [data]);
}

/**
 * Spoilage (the world setting): fresh food older than its days goes off, on every character. Returns
 * [{ actor, item, lb }] for what spoiled. Only the GM runs it.
 */
export async function spoilFood(actors, now = game.time.worldTime) {
  const out = [];
  for (const actor of actors) for (const item of actor.items.filter(isFood)) {
    const s = spoil(batchesOf(item), now);
    if (!s.lost) continue;
    out.push({ actor, item, name: item.name, lb: s.lost });
    await setBatches(item, s.good);
  }
  return out;
}
