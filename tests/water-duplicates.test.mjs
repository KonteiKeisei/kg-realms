import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dropWaterDuplicates } from "../scripts/places.mjs";

const names = (list) => list.map((p) => p.name);

test("a place you added stays, even with a shore or river of its name", () => {
  const own = { name: "Lake Oban", kind: "natural", class: "Lake", added: true, edited: true };
  assert.deepEqual(names(dropWaterDuplicates([own], ["Lake Oban"])), ["Lake Oban"]);
  assert.deepEqual(names(dropWaterDuplicates([{ ...own, name: "Lake Obann" }], ["Lake Oban"])), ["Lake Obann"], "or nearly its name");
});

test("a shipped place you changed stays", () => {
  assert.deepEqual(names(dropWaterDuplicates([{ name: "Rauvin River", kind: "natural", class: "River", edited: true }], ["River Rauvin"])), ["Rauvin River"]);
});

test("a shipped place a waterway already names is still left out, so it does not show twice", () => {
  const river = { name: "Rauvin River", kind: "natural", class: "River" };
  assert.deepEqual(dropWaterDuplicates([river], ["River Rauvin"]), []);
  assert.deepEqual(dropWaterDuplicates([{ name: "The Winding Wwater", kind: "natural", class: "River" }], ["Winding Water"]), []);
  assert.deepEqual(dropWaterDuplicates([{ name: "Serpents Tail Stream", kind: "natural", class: "River" }], ["Serpent's Tail Stream"]), []);
});

test("settlements and sites near a river's name are not taken for it", () => {
  assert.equal(dropWaterDuplicates([{ name: "Ascore", kind: "settlement" }], ["Ascore"]).length, 1);
  assert.equal(dropWaterDuplicates([{ name: "Ascore", kind: "site", class: "Ruins" }], ["Ascore River"]).length, 1);
  assert.equal(dropWaterDuplicates([{ name: "Darkwood", kind: "natural", class: "Forest" }], ["Rauvin"]).length, 1);
});

test("the editor lets go of a place that is gone, and follows one that moves layer", () => {
  const src = readFileSync(new URL("../scripts/ui-pins.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const body = src.slice(src.indexOf("  refresh() {"), src.indexOf("/** The camera moved"));
  assert.ok(body.includes("if (this.selected && !p)")); assert.ok(body.includes("this.#overlay()")); assert.ok(body.includes("this.showLayer?.(this.selectedLayer)"));
});
