import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { categoryFor, cleanLabel, scaleCheck } from "../scripts/local-places.mjs";

test("a pin's label loses its number, which becomes its order", () => {
  assert.deepEqual(cleanLabel("20.Shining Knight Arms and Armor"), { name: "Shining Knight Arms and Armor", order: 20 });
  assert.deepEqual(cleanLabel("21. Old Kraken Society building"), { name: "Old Kraken Society building", order: 21 });
  assert.deepEqual(cleanLabel("Castle Never"), { name: "Castle Never", order: null });
});

test("categories come from the name first, then the pin's icon", () => {
  assert.equal(categoryFor("icons/svg/hanging-sign.svg", "Moonstone Mask"), "inn");
  assert.equal(categoryFor("icons/svg/tankard.svg", "The Driftwood Tavern"), "inn");
  assert.equal(categoryFor("icons/svg/book.svg", "House Of Knowledge"), "temple");
  assert.equal(categoryFor("icons/svg/obelisk.svg", "Neverdeath Graveyard"), "graveyard");
  assert.equal(categoryFor("icons/svg/sword.svg", "Shining Knight Arms and Armor"), "shop");
  assert.equal(categoryFor("icons/svg/tower.svg", "Shard of the Moon"), "landmark");
  assert.equal(categoryFor("icons/svg/house.svg", "Fishers Float"), "district");
  assert.equal(categoryFor("icons/svg/city.svg", "Old Kraken Society building"), "guild");
  assert.equal(categoryFor("icons/svg/unknown.svg", "Somewhere"), "other");
});

test("a city drawn 350 ft across gets a suggested scale; a sensible one does not", () => {
  const nw = scaleCheck({ width: 7000, gridSize: 100, distance: 5, units: "ft" }, "City");
  assert.equal(Math.round(nw.acrossFt), 350);
  assert.deepEqual(nw.suggest, { distance: 110, units: "ft" });
  assert.equal(scaleCheck({ width: 7000, gridSize: 100, distance: 110, units: "ft" }, "City").suggest, null);
  assert.equal(scaleCheck({ width: 3000, gridSize: 100, distance: 5, units: "ft" }, "Ruins").suggest, null);
});

// The GM's Neverwinter export, when it is on this machine: every pin gets a sensible category.
const NW = "C:/Users/Konte/Downloads/fvtt-Scene-neverwinter-48AkdWTDurdKRgXv.json";
test("Neverwinter's pins all read as a place with a category", { skip: !existsSync(NW) }, () => {
  const scene = JSON.parse(readFileSync(NW, "utf8"));
  const read = scene.notes.map((n) => ({ ...cleanLabel(n.text), cat: categoryFor(n.texture?.src, cleanLabel(n.text).name) }));
  assert.equal(read.length, 20);
  assert.ok(read.every((r) => r.name && r.cat !== "other"), read.filter((r) => r.cat === "other").map((r) => r.name).join(", "));
});

test("search: realm places come before local places, even when a local place matches better", async () => {
  const { searchWorld } = await import("../scripts/places.mjs");
  const places = [{ name: "Neverwinter", class: "City", lon: 0, lat: 0 }, { name: "Neverwinter Wood", class: "Forest", lon: 0, lat: 0 }];
  const locals = [{ name: "Neverwinter River and Harbor", map: "Neverwinter", visibility: "discovered" }, { name: "Neverdeath Graveyard", map: "Neverwinter", visibility: "discovered" }, { name: "Never seen", map: "Neverwinter", visibility: "hidden" }];
  const r = searchWorld("never", { places, locals });
  assert.deepEqual(r.map((x) => x.type), ["place", "place", "local", "local"]);
  // Exact local match still after a weaker realm match.
  const r2 = searchWorld("neverdeath graveyard", { places: [{ name: "Neverdeath Graveyard Road", class: "Road" }], locals });
  assert.deepEqual(r2.map((x) => x.type), ["place", "local"]);
  // A local map's name finds its places too, after everything else.
  assert.ok(searchWorld("neverwinter", { places: [], locals }).every((x) => x.type === "local"));
});
