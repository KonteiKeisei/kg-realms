import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { borderOf, borderChoices, borderHome, borderSelect, followOf, waterwaysWithBorders, zonesWithBorders } from "../scripts/borders.mjs";
import { withFollowedBorders, placeFromZone, canBeBiome } from "../scripts/map-layers.mjs";
import { biomeLookup } from "../scripts/biomes.mjs";
import { TERRAIN } from "../scripts/travel.mjs";

const loop = [[0, 0], [10, 0], [10, 10], [0, 10]], other = [[20, 20], [30, 20], [30, 30]];
const index = () => ({
  shores: { s: { kind: "shore", name: "Lake Oban", pts: loop, closed: true }, o: { kind: "shore", name: "Coast", pts: [[0, 0], [5, 5]] }, r: { kind: "river", name: "Rauvin", pts: loop } },
  zones: { z: { name: "Darkwood", type: "forest", pts: other }, f: { name: "Followed", type: "plains", pts: [], follow: "shore:s" } },
  places: { p: { name: "Giamela", area: other }, q: { name: "Mine", area: loop, areaClosed: false }, n: { name: "No border" } }
});

test("a link leads to its outline, from any of the three, in any order", () => {
  const i = index();
  assert.deepEqual(borderOf("shore:s", i), { pts: loop, closed: true });
  assert.deepEqual(borderOf("biome:z", i), { pts: other, closed: true });
  assert.deepEqual(borderOf("place:p", i), { pts: other, closed: true });
  assert.equal(borderOf("place:q", i).closed, false);
  assert.deepEqual(borderOf("biome:f", i), { pts: loop, closed: true }, "through a link");
  for (const gone of ["shore:r", "shore:x", "biome:x", "place:x", "place:n", "nonsense", null]) assert.equal(borderOf(gone, i), null, String(gone));
});

test("a circle of links leads nowhere rather than hanging", () => {
  const i = index();
  i.zones.a = { pts: other, follow: "place:b" }; i.places.b = { area: other, follow: "biome:a" };
  assert.equal(borderOf("biome:a", i), null);
});

test("the outlines offered: its own name first; not itself, nothing leading back to it, nothing with no outline", () => {
  const i = index(), list = borderChoices(i, "place:q", "Darkwood");
  assert.equal(list[0].ref, "biome:z"); assert.equal(list[0].same, true);
  const refs = list.map((c) => c.ref);
  assert.ok(!refs.includes("place:q"), "itself"); assert.ok(!refs.includes("place:n"), "no outline"); assert.ok(!refs.includes("shore:r"), "a river");
  assert.ok(refs.includes("shore:s") && refs.includes("place:p") && refs.includes("biome:f"));
  assert.ok(!borderChoices(i, "shore:s").some((c) => c.ref === "biome:f"), "that one follows it");
  i.zones.made = { pts: loop, place: "p" };
  assert.ok(!borderChoices(i, "place:p").some((c) => c.ref === "biome:made"), "a zone made from this place");
  assert.ok(!borderChoices(i, "biome:z", "", { closedOnly: true }).some((c) => c.ref === "shore:o"), "a biome needs a closed outline");
});

test("a biome made first: a place and a shoreline follow it", () => {
  const i = index();
  const place = { id: "new", ...placeFromZone("z", i.zones.z) };
  assert.equal(place.name, "Darkwood"); assert.equal(place.class, "Forest"); assert.equal(place.layer, "geo");
  const [p] = withFollowedBorders([place], i);
  assert.equal(p.area, other, "the zone's outline, not a copy"); assert.equal(p.shape, "area"); assert.equal(p.followRef, "biome:z");
  assert.equal(canBeBiome(p), true);
  i.shores.t = { kind: "shore", name: "Darkwood", pts: [[0, 0], [0, 0]], follow: "biome:z" };
  assert.deepEqual(waterwaysWithBorders(i.shores, i).t.pts, other); assert.equal(waterwaysWithBorders(i.shores, i).t.closed, true);
});

test("a place or shoreline made first: a biome follows it, and travel reads it", () => {
  const i = index();
  i.zones.fromShore = { type: "arctic", pts: [], follow: "shore:s", holes: [[[1, 1], [2, 1], [2, 2]]] };
  const config = zonesWithBorders({ zones: i.zones }, i);
  assert.deepEqual(config.zones.fromShore.pts, loop); assert.equal(config.zones.fromShore.holes, undefined);
  assert.equal(biomeLookup(config, () => TERRAIN[1])(5, 5).type, "arctic");
});

test("reshaping the source moves all that follow", () => {
  const i = index();
  i.shores.s.pts = other;
  assert.deepEqual(borderOf("biome:f", i).pts, other);
  assert.equal(withFollowedBorders([{ id: "a", class: "Lake", lon: 25, lat: 25, follow: "shore:s" }], i)[0].area, other);
});

test("what a source takes away is said, not hidden", () => {
  const i = index();
  i.zones.lost = { type: "forest", pts: loop, follow: "shore:o" };
  const z = zonesWithBorders({ zones: i.zones }, i).zones.lost;
  assert.equal(z.disabled, true, "ends apart: it cannot be a biome"); assert.equal(z.followGone, true);
  i.shores.lost = { kind: "shore", pts: loop, follow: "place:x" };
  assert.equal(waterwaysWithBorders(i.shores, i).lost.followGone, true); assert.equal(waterwaysWithBorders(i.shores, i).lost.pts, loop);
  i.shores.back = { kind: "shore", pts: loop, follow: "biome:z", followGone: true };
  assert.equal(waterwaysWithBorders(i.shores, i).back.followGone, undefined, "the outline came back");
  assert.equal(withFollowedBorders([{ id: "a", lon: 1, lat: 1, follow: "biome:x" }], i)[0].shoreGone, true);
});

test("nothing links by itself, and 0.84's places keep their link", () => {
  const i = index(), own = { id: "x", lon: 1, lat: 1, name: "Lake Oban" }, zones = { zones: { z: i.zones.z } };
  assert.equal(withFollowedBorders([own], i)[0], own);
  assert.equal(zonesWithBorders(zones, i), zones);
  const ways = { s: i.shores.s };
  assert.equal(waterwaysWithBorders(ways, i), ways);
  assert.equal(followOf({ shore: "s" }), "shore:s"); assert.equal(followOf({ follow: "biome:z", shore: "s" }), "biome:z"); assert.equal(followOf({}), null);
});

test("the Border select lists its own name first, and says where to reshape", () => {
  const html = borderSelect('name="x"', [{ ref: "shore:s", group: "Shorelines", label: "Lake Oban", closed: true, same: true }, { ref: "biome:z", group: "Biome zones", label: "Dark<wood", closed: false }], "biome:z", (s) => String(s).replace(/</g, "&lt;"));
  assert.ok(html.indexOf("Same name") < html.indexOf("Biome zones"));
  assert.ok(html.includes('<option value="">Its own border</option>')); assert.ok(html.includes('value="biome:z" selected')); assert.ok(html.includes("Dark&lt;wood (ends apart)"));
  assert.equal(borderHome("shore:s"), "the Waterways tab"); assert.equal(borderHome("biome:z"), "the Biomes tab"); assert.equal(borderHome("place:p"), "the Places tab");
});

test("all three editors offer it, and none edits a shared outline's corners", () => {
  const read = (f) => readFileSync(new URL(`../scripts/${f}`, import.meta.url), "utf8");
  assert.ok(read("ui-pins.mjs").includes("#editable(p) { return p?.shoreLine ? null"));
  assert.ok(read("ui-pins.mjs").includes("getBorderChoices"));
  assert.ok(read("ui-waterways.mjs").includes("this.selected && !this.#following()")); assert.ok(read("ui-waterways.mjs").includes('name="new-shore-from"'));
  assert.ok(read("ui-biomes.mjs").includes("this.selected&&!this.all().zones?.[this.selected]?.follow")); assert.ok(read("ui-biomes.mjs").includes('data-bio="make-place"'));
});
