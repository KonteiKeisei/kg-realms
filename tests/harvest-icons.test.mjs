// Every icon a harvested item gets must be one Foundry ships (public/icons). Checked against the
// installed Foundry when it is there; skipped on a machine without it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { PARTS } from "../scripts/harvest/catalog.mjs";

globalThis.foundry ??= { utils: { isNewerVersion: () => true } };
const { OLD_HARVEST_ICONS, repairHarvestIcons } = await import("../scripts/harvest/items.mjs");
const PUBLIC = [process.env.FOUNDRY_PUBLIC, "C:/Program Files/Foundry Virtual Tabletop/resources/app/public", "/opt/foundryvtt/resources/app/public"].find((p) => p && existsSync(path.join(p, "icons")));

test("every harvested part's icon exists in Foundry", { skip: !PUBLIC && "Foundry is not installed here" }, () => {
  const missing = Object.entries(PARTS).filter(([, p]) => !existsSync(path.join(PUBLIC, p.icon))).map(([k, p]) => `${k}: ${p.icon}`);
  assert.deepEqual(missing, []);
});

test("each old missing icon is repaired to one that exists", { skip: !PUBLIC && "Foundry is not installed here" }, () => {
  for (const [old, now] of Object.entries(OLD_HARVEST_ICONS)) {
    assert.equal(existsSync(path.join(PUBLIC, old)), false, `${old} was missing`);
    assert.ok(existsSync(path.join(PUBLIC, now)), `${now} exists`);
  }
});

test("only harvested items with an old icon are repaired", async () => {
  const updates = [];
  const item = (id, img, harvest = true) => ({ id, img, flags: harvest ? { "kg-realms": { harvest: { key: "x" } } } : {} });
  const actor = { items: [item("a", "icons/commodities/claws/claw-black.webp"), item("b", "icons/commodities/claws/claw-black.webp", false), item("c", "icons/commodities/bones/bone-simple-white.webp")], updateEmbeddedDocuments: async (_t, u) => updates.push(...u) };
  assert.equal(await repairHarvestIcons([actor]), 1);
  assert.deepEqual(updates, [{ _id: "a", img: "icons/commodities/claws/claw-brown-black.webp" }]);
});
