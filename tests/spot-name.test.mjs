import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spotName } from "../scripts/map-layers.mjs";

const square = (x, y, r) => [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];
const realm = { id: "r", name: "Thay", class: "Kingdom", lon: 0, lat: 0, area: square(0, 0, 10) };
const forest = { id: "f", name: "Rawlinswood", class: "Forest", lon: 0, lat: 0, area: square(0, 0, 5) };
const peaks = { id: "m", name: "Spine", class: "Mountains", lon: 3, lat: 3, area: square(3, 3, 1) };
const bay = { id: "b", name: "Turquoise Bay", class: "Bay", lon: 20, lat: 20, area: square(20, 20, 5) };
const sea = { id: "s", name: "The Torrose", class: "Sea", lon: 20, lat: 20, area: square(20, 20, 9) };
const town = (name, miles) => ({ id: name, name, kind: "settlement", class: "City", miles });
const poi = (name, miles) => ({ id: name, name, kind: "site", class: "Ruins", miles });
const at = (lon, lat, places) => spotName(lon, lat, places, (p) => p.miles ?? 999);

test("all of it: region, geography, near", () => {
  assert.equal(at(1, 1, [realm, forest, town("Arine", 20)]), "In Thay, in Rawlinswood near Arine");
});
test("water is on, land is in", () => {
  assert.equal(at(20, 20, [bay, town("Wakeflow", 30)]), "On Turquoise Bay near Wakeflow");
  assert.equal(at(1, 1, [forest, town("Arine", 30)]), "In Rawlinswood near Arine");
});
test("what is not there leaves no gap", () => {
  assert.equal(at(1, 1, [realm, town("Arine", 30)]), "In Thay near Arine");
  assert.equal(at(1, 1, [realm, forest]), "In Thay, in Rawlinswood");
  assert.equal(at(1, 1, [realm]), "In Thay");
  assert.equal(at(50, 50, [realm, poi("Colosseum of Titus", 10)]), "Near Colosseum of Titus");
  assert.equal(at(50, 50, [realm]), "Wilderness");
  assert.equal(at(50, 50, []), "Wilderness");
});
test("a settlement takes near before a closer landmark", () => {
  assert.equal(at(50, 50, [poi("Colosseum", 6), town("Arine", 50)]), "Near Arine");
  assert.equal(at(50, 50, [poi("Colosseum", 6), town("Far", 70)]), "Near Colosseum");
});
test("in a town: the town and its realm", () => {
  assert.equal(at(1, 1, [realm, forest, town("Arine", 2)]), "In Arine, Thay");
  assert.equal(at(50, 50, [town("Arine", 2)]), "In Arine");
});
test("where borders nest, the smallest wins", () => {
  assert.equal(at(3, 3, [realm, forest, peaks]), "In Thay, in Spine");
  assert.equal(at(20, 20, [sea, bay]), "On Turquoise Bay");
  assert.equal(at(28, 28, [sea, bay]), "On The Torrose");
});
test("only what players may know, and only closed borders the GM drew", () => {
  assert.equal(at(1, 1, [{ ...realm, hidden: true }, { ...forest, hidden: true }, { ...town("Secret", 3), hidden: true }]), "Wilderness");
  assert.equal(at(1, 1, [{ ...forest, areaClosed: false }]), "Wilderness");
  assert.equal(at(1, 1, [{ id: "x", name: "Thay", class: "Kingdom", lon: 1, lat: 1, miles: 1 }]), "Wilderness", "a realm with no border says nothing");
  assert.equal(at(1, 1, [{ id: "rd", name: "King's Road", class: "Road", miles: 1 }]), "Wilderness");
});
test("a long name stays in two lines, with the rest in its tooltip", () => {
  const css = readFileSync(new URL("../styles/realms.css", import.meta.url), "utf8");
  assert.match(css, /location-title button\.nm \{[^}]*line-clamp: 2/);
  assert.ok(readFileSync(new URL("../scripts/ui-hud.mjs", import.meta.url), "utf8").includes('title="${esc(n.name)}: show on the map"'));
});

test("the whole chain: nested borders, and what a territory is part of", () => {
  const empire = { id: "e", name: "Salvae Empire", kind: "territory", class: "Empire", lon: 0, lat: 0 };
  const empiria = { id: "m", name: "Empiria", kind: "territory", class: "Region", partOf: "e", lon: 0, lat: 0, area: square(0, 0, 10) };
  assert.equal(at(1, 1, [empire, empiria, forest, town("Arine", 20)]), "In Empiria, Salvae Empire, in Rawlinswood near Arine");
  assert.equal(at(1, 1, [empire, empiria, town("Arine", 2)]), "In Arine, Empiria, Salvae Empire");
  assert.equal(at(1, 1, [{ ...empire, hidden: true }, empiria]), "In Empiria", "a hidden domain says nothing");
  assert.equal(at(50, 50, [empire, empiria]), "Wilderness", "outside its border");
  const outer = { id: "o", name: "The Heartlands", kind: "territory", class: "Region", lon: 0, lat: 0, area: square(0, 0, 30) };
  assert.equal(at(1, 1, [outer, realm]), "In Thay, The Heartlands", "borders nest with no link");
});
