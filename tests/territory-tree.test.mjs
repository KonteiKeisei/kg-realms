import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { territoryTree } from "../scripts/map-layers.mjs";

const square = (x, y, r) => [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];
const T = (id, name, extra = {}) => ({ id, name, kind: "territory", class: "Region", lon: 0, lat: 0, ...extra });
const shape = (nodes) => nodes.map((n) => (n.children.length ? [n.place.name, shape(n.children)] : n.place.name));

test("a country holds its states, and they their counties", () => {
  const list = [T("c", "Windsor", { partOf: "s" }), T("s", "Vermont", { partOf: "u" }), T("m", "Maine", { partOf: "u" }), T("u", "Republic", { kind: "domain", class: "Country" })];
  assert.deepEqual(shape(territoryTree(list)), [["Republic", ["Maine", ["Vermont", ["Windsor"]]]]]);
});

test("domains come first, then what is part of nothing, by name", () => {
  const list = [T("z", "Zed"), T("a", "Alpha"), T("d", "Middle", { kind: "domain" })];
  assert.deepEqual(shape(territoryTree(list)), ["Middle", "Alpha", "Zed"]);
});

test("a border inside a larger one nests with no link", () => {
  const big = T("b", "Heartlands", { area: square(0, 0, 50) }), small = T("s", "Vale", { lon: 1, lat: 1, area: square(1, 1, 2) });
  assert.deepEqual(shape(territoryTree([small, big])), [["Heartlands", ["Vale"]]]);
});

test("only domains and territories; the hidden show for the GM here; a circle in saved data loses nothing", () => {
  assert.deepEqual(territoryTree([{ id: "t", kind: "settlement", class: "City", lon: 0, lat: 0 }]), []);
  assert.deepEqual(shape(territoryTree([T("h", "Secret", { hidden: true, kind: "domain" }), T("i", "Inner", { partOf: "h" })])), [["Secret", ["Inner"]]]);
  const names = (nodes) => nodes.flatMap((n) => [n.place.name, ...names(n.children)]);
  assert.deepEqual(names(territoryTree([T("a", "A", { partOf: "b" }), T("b", "B", { partOf: "a" })])).sort(), ["A", "B"]);
  assert.deepEqual(names(territoryTree([T("c", "C", { partOf: "gone" })])), ["C"]);
});

test("the list uses it, flat while searching", () => {
  const src = readFileSync(new URL("../scripts/ui-pins.mjs", import.meta.url), "utf8");
  assert.ok(src.includes("Domains and territories")); assert.ok(src.includes("territoryTree(this.getPlaces())")); assert.ok(src.includes('if (kind === "territory") return "";'));
});
