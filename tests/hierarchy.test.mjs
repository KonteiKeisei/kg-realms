import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hierarchyOf, partOfChoices } from "../scripts/map-layers.mjs";

const square = (x, y, r) => [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];
const T = (id, name, extra = {}) => ({ id, name, kind: "territory", class: "Region", lon: 0, lat: 0, ...extra });
const empire = T("e", "Salvae Empire", { kind: "domain", class: "Empire", lon: 100, lat: 100 });
const empiria = T("m", "Empiria", { partOf: "e", area: square(0, 0, 10) });
const south = T("s", "Southmark", { partOf: "e", lon: 30, lat: 0, area: square(30, 0, 10) });
const all = [empire, empiria, south];
const names = (list) => list.map((p) => p.name);

test("Empiria is part of the Salvae Empire, by its link", () => {
  assert.deepEqual(names(hierarchyOf(empiria, all).within), ["Salvae Empire"]);
  assert.deepEqual(names(hierarchyOf(empire, all).within), []);
});

test("a settlement or site inside knows the whole chain, with no link of its own", () => {
  for (const kind of ["settlement", "site"]) assert.deepEqual(names(hierarchyOf({ id: "a", name: "Arine", kind, class: "City", lon: 1, lat: 1 }, all).within), ["Empiria", "Salvae Empire"], kind);
  assert.deepEqual(names(hierarchyOf({ id: "b", name: "Far", kind: "site", class: "Ruins", lon: 500, lat: 500 }, all).within), []);
});

test("three levels, and a border inside a larger one with no link", () => {
  const province = T("p", "Hollow March", { partOf: "m", area: square(2, 2, 2), lon: 2, lat: 2 });
  assert.deepEqual(names(hierarchyOf({ id: "a", kind: "site", class: "Keep", lon: 2, lat: 2 }, [...all, province]).within), ["Hollow March", "Empiria", "Salvae Empire"]);
  const inner = T("i", "Vale", { area: square(1, 1, 1), lon: 1, lat: 1 });
  assert.deepEqual(names(hierarchyOf(inner, all.concat(inner)).within), ["Empiria", "Salvae Empire"], "knows from the border around it");
  assert.deepEqual(names(hierarchyOf(empiria, all.concat(inner)).within), ["Salvae Empire"], "not from one inside it");
});

test("a natural feature within one territory is part of it; one across a boundary says what it crosses", () => {
  const wood = { id: "w", name: "Darkwood", kind: "natural", class: "Forest", lon: 1, lat: 1, area: square(1, 1, 2) };
  const inside = hierarchyOf(wood, all);
  assert.deepEqual(names(inside.within), ["Empiria", "Salvae Empire"]); assert.deepEqual(inside.crosses, []);
  const river = { id: "r", name: "Torrose", kind: "natural", class: "River", lon: 15, lat: 0, area: [[0, 0], [15, 0], [30, 0]], areaClosed: false };
  const across = hierarchyOf(river, all);
  assert.deepEqual(names(across.within), [], "the point between them is in neither");
  assert.deepEqual(names(across.crosses), ["Empiria", "Salvae Empire", "Southmark"]);
  const both = hierarchyOf({ ...river, area: [[0, 0], [30, 0]] }, all);
  assert.deepEqual(names(both.within), ["Salvae Empire"], "both ends are the empire's"); assert.deepEqual(names(both.crosses), ["Empiria", "Southmark"]);
  assert.deepEqual(names(hierarchyOf({ id: "l", name: "Lake", kind: "natural", class: "Lake", lon: 1, lat: 1 }, all).within), ["Empiria", "Salvae Empire"], "no outline: by its point");
});

test("players do not learn of hidden territories; the GM does", () => {
  const list = [T("e", "Secret Empire", { hidden: true, lon: 100, lat: 100 }), empiria];
  const site = { id: "a", kind: "site", class: "Keep", lon: 1, lat: 1 };
  assert.deepEqual(names(hierarchyOf(site, list).within), ["Empiria"]);
  assert.deepEqual(names(hierarchyOf(site, list, { showHidden: true }).within), ["Empiria", "Secret Empire"]);
});

test("the choices for Part of cannot go round in a circle, and a circle in saved data cannot hang", () => {
  assert.deepEqual(names(partOfChoices(empire, all)), [], "both others are part of it");
  assert.deepEqual(names(partOfChoices(empiria, all)), ["Salvae Empire", "Southmark"]);
  const a = T("a", "A", { partOf: "b" }), b = T("b", "B", { partOf: "a" });
  assert.deepEqual(names(hierarchyOf({ id: "x", kind: "territory", class: "Region", partOf: "a", lon: 0, lat: 0 }, [a, b]).within), ["A", "B"]);
  assert.deepEqual(names(hierarchyOf(a, [a, b]).within), ["B"]);
});

test("nothing depends on being linked, and a deleted parent is no trouble", () => {
  assert.deepEqual(hierarchyOf({ id: "x", kind: "site", class: "Keep", lon: 1, lat: 1 }, []), { within: [], crosses: [] });
  assert.deepEqual(names(hierarchyOf(T("c", "C", { partOf: "gone", lon: 500, lat: 500 }), all).within), []);
  assert.deepEqual(hierarchyOf(null, all), { within: [], crosses: [] });
});

test("the card and the editor show it", () => {
  const read = (f) => readFileSync(new URL(`../scripts/${f}`, import.meta.url), "utf8");
  assert.ok(read("card-kinds.mjs").includes('["Part of", shown(places.within)], ["Crosses", shown(places.crosses)]'));
  assert.ok(read("ui-pins.mjs").includes('name="part-of"')); assert.ok(read("ui-pins.mjs").includes("Nothing above it"));
});

test("a domain is the top: nothing is above it, even from an old link or a border around it", () => {
  const big = T("b", "Bigger", { kind: "domain", area: square(0, 0, 500) });
  const dom = T("d", "Domain", { kind: "domain", partOf: "e", area: square(0, 0, 5) });
  assert.deepEqual(hierarchyOf(dom, [big, empire, dom]).within, []);
  const inside = { id: "a", kind: "site", class: "Keep", lon: 1, lat: 1 };
  assert.deepEqual(names(hierarchyOf(inside, [dom, empire]).within), ["Domain"], "and the chain stops there");
});

test("a county in a state in a country: territories nest to any depth, of any type", () => {
  const usa = T("u", "Republic", { kind: "domain", class: "Country", lon: 100, lat: 100 });
  const state = T("s", "Vermont", { class: "State", partOf: "u", area: square(0, 0, 10) });
  const county = T("c", "Windsor", { class: "County", partOf: "s", lon: 1, lat: 1, area: square(1, 1, 2) });
  assert.deepEqual(names(hierarchyOf({ id: "x", kind: "settlement", class: "Town", lon: 1, lat: 1 }, [usa, state, county]).within), ["Windsor", "Vermont", "Republic"]);
  assert.deepEqual(names(hierarchyOf(county, [usa, state, county]).within), ["Vermont", "Republic"]);
  assert.deepEqual(names(partOfChoices(county, [usa, state, county])), ["Republic", "Vermont"]);
});
