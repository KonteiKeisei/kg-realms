import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { placeKind, placeLayer, placeShape, areaKind } from "../scripts/map-layers.mjs";
import { applyEdits } from "../scripts/places.mjs";
import { symbolFor, iconFor } from "../scripts/map-symbols.mjs";

test("empires and regions are territories, wherever they were saved", () => {
  for (const c of ["Empire", "Kingdom", "Region", "Macroregion", "Duchy", "Province", "Territory", "Domain"]) assert.equal(placeKind({ kind: "natural", class: c }), "territory", c);
  for (const c of ["Forest", "Lake", "Peak", "Feature"]) assert.equal(placeKind({ kind: "natural", class: c }), "natural", c);
  assert.equal(placeKind({ kind: "settlement", class: "City" }), "settlement");
});

test("existing places change kind but not where they show", () => {
  const empire = { id: "a", name: "Salvae Empire", kind: "natural", class: "Region", rank: 3, lon: 1, lat: 1 };
  const before = placeLayer(empire);
  const [read] = applyEdits([empire], {});
  assert.equal(read.kind, "territory"); assert.equal(placeLayer(read), before); assert.equal(before, "realms");
  assert.equal(placeShape(read), "area"); assert.equal(areaKind(read), "realm");
});

test("a territory of any type is on the Realms layer", () => {
  assert.equal(placeLayer({ kind: "territory", class: "Hegemony" }), "realms");
  assert.equal(placeLayer({ kind: "territory", class: "Hegemony", layer: "geo" }), "geo", "its own choice wins");
});

test("you can say a region is really a natural feature, and it stays one", () => {
  const steppes = { id: "s", name: "The Steppes", kind: "natural", class: "Region", kindChosen: true };
  assert.equal(placeKind(steppes), "natural");
  assert.equal(placeLayer(steppes), "geo");
  assert.equal(applyEdits([{ id: "s", name: "The Steppes", kind: "natural", class: "Region" }], { edits: { s: { kind: "natural", kindChosen: true } } })[0].kind, "natural");
});

test("a new natural feature starts on Geography, a new territory on Realms", () => {
  assert.equal(placeLayer({ kind: "natural", class: "Feature" }), "geo");
  assert.equal(placeLayer({ kind: "territory", class: "Region" }), "realms");
});

test("a territory has no marker, unless one is chosen", () => {
  assert.equal(symbolFor({ kind: "territory", class: "Hegemony" }), "");
  assert.equal(iconFor({ kind: "territory", class: "Hegemony" }), "");
  assert.equal(iconFor({ kind: "territory", class: "Empire", marker: "shield-red" }), "mk-shield-red");
});

test("a territory is no travel stop or road target; the panel offers it", () => {
  const read = (f) => readFileSync(new URL(`../scripts/${f}`, import.meta.url), "utf8");
  assert.ok(read("ui-hud.mjs").includes('p.kind !== "natural" && p.kind !== "territory"'));
  assert.ok(read("ui-roads.mjs").includes('p.kind !== "natural" && p.kind !== "territory"'));
  assert.ok(read("ui-pins.mjs").includes('["territory", "Territory/Domain"]'));
  assert.ok(read("ui-pins.mjs").includes('["territory", "Territories/Domains"]'));
  assert.ok(read("ui-pins.mjs").includes("kindChosen: true"));
  assert.ok(!read("routes.mjs").includes("territory"), "routes only ever stop at settlements and sites");
});
