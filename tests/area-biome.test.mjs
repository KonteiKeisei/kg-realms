import { test } from "node:test";
import assert from "node:assert/strict";
import { biomeForClass, zoneForPlace, biomeLookup, DEFAULT_BIOMES } from "../scripts/biomes.mjs";
import { TERRAIN } from "../scripts/travel.mjs";
import { readFileSync } from "node:fs";

test("a land area's class gives its biome type; one that says nothing about the going gives none", () => {
  for (const [c, want] of [["Forest", "forest"], ["Jungle", "jungle"], ["Mountains", "mountains"], ["Hills", "hills"], ["Desert", "desert"], ["Swamp", "swamp"], ["Marsh", "wetlands"], ["Glacier", "glacier"], ["Tundra", "tundra"], ["Plain", "plains"], ["Steppe", "steppe"]]) {
    assert.equal(biomeForClass(c), want, c);
    assert.ok(DEFAULT_BIOMES[want], want);
  }
  for (const c of ["Valley", "Islands", "Bay", "City", "", null]) assert.equal(biomeForClass(c), null, String(c));
});

test("a zone made from an area drives what the biome lookup answers there", () => {
  const pts = [[0, 0], [10, 0], [10, 10], [0, 10]], place = { id: "p1", name: "Darkwood", area: pts };
  const zone = zoneForPlace(place, "forest", pts);
  assert.deepEqual(Object.keys(zone).sort(), ["name", "overrides", "place", "pts", "type"]);
  assert.equal(zone.name, "Darkwood"); assert.equal(zone.place, "p1"); assert.notEqual(zone.pts, pts, "its own copy");
  const at = biomeLookup({ zones: { z: zone } }, () => TERRAIN[1]);
  assert.equal(at(5, 5).zoneId, "z"); assert.equal(at(5, 5).name, "Darkwood"); assert.equal(at(5, 5).type, "forest");
  assert.equal(at(50, 50).zoneId, null);
});

test("a set water side reads as set: green, and says how to change it", () => {
  const src = readFileSync(new URL("../scripts/ui-waterways.mjs", import.meta.url), "utf8");
  assert.ok(src.includes("Water side set")); assert.ok(src.includes("Click again to change the water side")); assert.ok(src.includes("kgr-water-set"));
  assert.ok(readFileSync(new URL("../styles/realms.css", import.meta.url), "utf8").includes(".kgr-water-set"));
});
