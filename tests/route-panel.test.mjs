import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { boatOptions, buildSea, journeyFeatures, pathCrossing, planSea, shoreWater, voyageParts, WAY_LABELS } from "../scripts/waterways.mjs";

const blank = () => ({ data: new Uint8Array(500 * 400).fill(1), width: 500, height: 400, cell: 4 });
const seaOf = (lines) => { const shores = lines.filter((w) => w.kind === "shore"); return buildSea(shoreWater(blank(), shores), lines, { milesPerPixel: 0.5 }); };
const island = { id: "c", kind: "shore", closed: true, water: "outside", pts: [[400, 300], [1600, 300], [1600, 1300], [400, 1300]] };
const oban = { id: "r", kind: "river", name: "Oban", pts: [[1000, 800], [1000, 280]] };
const opts = { mph: 2, reach: 36, milesPerPixel: 0.5 };
const keys = (list) => list.map((o) => o.key);

test("two ports on open water: a sea route, and no river route", () => {
  assert.deepEqual(keys(boatOptions(seaOf([island]), [1000, 300], [1600, 800], { ...opts, ports: true })), ["sea"]);
});

test("a stop on a river to the port at its mouth: a river route", () => {
  const list = boatOptions(seaOf([island, oban]), [1000, 700], [1000, 300], { ...opts, ports: false });
  assert.deepEqual(keys(list), ["river"]);
  assert.deepEqual(voyageParts(list[0].plan, 18).map((p) => p.kind), ["river"]);
});

test("a stop on a river to a port round the coast: river and sea, as one choice with two parts", () => {
  const list = boatOptions(seaOf([island, oban]), [1000, 700], [1600, 800], { ...opts, ports: false });
  assert.deepEqual(keys(list), ["both"]);
  const parts = voyageParts(list[0].plan, 18);
  assert.deepEqual(parts.map((p) => p.kind), ["river", "sea"]);
  assert.deepEqual(parts[0].names, ["Oban"]);
});

test("two ports joined by a river as well as the sea get both choices", () => {
  const list = boatOptions(seaOf([island, oban]), [1000, 300], [1000, 800], { ...opts, ports: true });
  assert.ok(keys(list).includes("sea") && keys(list).includes("river"), String(keys(list)));
});

test("sea means no river, river means no open water", () => {
  const sea = seaOf([island, oban]);
  assert.equal(planSea(sea, [1000, 700], [1000, 300], { mph: 2, reach: 36, ways: "sea" }), null, "that stop is on no open water");
  assert.equal(planSea(sea, [1000, 300], [1600, 800], { mph: 2, reach: 36, ways: "river" }), null, "that port is on no river");
});

test("the parts of a voyage: the short way from a town to the river is part of the river", () => {
  const plan = { legs: [{ kind: "sea", miles: 5, hours: 2 }, { kind: "river", name: "Oban", miles: 50, hours: 10 }, { kind: "sea", miles: 100, hours: 50 }, { kind: "lane", name: "Run", miles: 20, hours: 10 }] };
  assert.deepEqual(voyageParts(plan, 18), [{ kind: "river", miles: 55, hours: 12, names: ["Oban"] }, { kind: "sea", miles: 120, hours: 60, names: ["Run"] }]);
  assert.deepEqual(voyageParts(null), []);
  assert.deepEqual(Object.values(WAY_LABELS), ["Sea route", "River route", "River and sea"]);
});

test("a road crossing a river is found where it first crosses", () => {
  const hit = pathCrossing([[0, 0], [10, 0], [20, 0], [30, 0]], [[15, -5], [15, 5]]);
  assert.deepEqual(hit, { at: [15, 0], index: 1 });
  assert.equal(pathCrossing([[0, 0], [10, 0]], [[15, -5], [15, 5]]), null);
  assert.equal(pathCrossing([[0, 0], [10, 0]], [[0, 1], [10, 1]]), null, "side by side");
});

test("the panel: the end first, Add stop, handles, a choice per leg, bypass", () => {
  const hud = readFileSync(new URL("../scripts/ui-hud.mjs", import.meta.url), "utf8");
  for (const s of ["Where to?", "Pick on the map", "Add stop", "stop-grip", "How does the party get to", "the destination", "the next stop", "data-act=\"bypass\"", "data-act=\"stop-here\"", "Stop here", "The road crosses", "Take the river route from the crossing", "Stay on the road"]) assert.ok(hud.includes(s), s);
  for (const s of ["Earlier", "Go on from here", "By boat", "e.shiftKey && w.length"]) assert.ok(!hud.includes(s), s);
  assert.ok(hud.includes("legWays"));
  const rules = readFileSync(new URL("../scripts/travel-rules.mjs", import.meta.url), "utf8");
  assert.ok(rules.includes('"River and sea"'));
});

test("the journey's line: blue by water, and whole where land meets water", () => {
  const f = journeyFeatures([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]], [false, false, true, true, false]);
  assert.deepEqual(f.map((x) => x.properties.water), [false, true, false]);
  assert.deepEqual(f.map((x) => x.geometry.coordinates), [[[0, 0], [1, 0]], [[1, 0], [2, 0], [3, 0]], [[3, 0], [4, 0]]]);
  assert.deepEqual(journeyFeatures(null, null), []);
  assert.equal(journeyFeatures([[0, 0], [1, 1]], null)[0].properties.water, false, "no water list: all by land");
  const map = readFileSync(new URL("../scripts/source-map.mjs", import.meta.url), "utf8");
  assert.ok(map.includes("['case',['get','water'],night?'#b0e2f2':'#8fdcff',"));
});

test("the panel's layout: the plan scrolls, what now is pinned, with plain labels", () => {
  const hud = readFileSync(new URL("../scripts/ui-hud.mjs", import.meta.url), "utf8");
  assert.ok(hud.includes('<div class="body">${main}</div>${pinned}${foot}'));
  for (const s of ["Not started", "Pause travel", "Skip to next encounter", "Skip to next camp", "Undo route change", "Resume travel", "Waiting for you", "as time moves on", "route point", "placed on the map", "New journey", "No camp while the crew sails on"]) assert.ok(hud.includes(s), s);
  for (const s of ["Not set off", "Stop travel", "#nowBox", "#buttons", "#statusLine"]) assert.ok(!hud.includes(s), s);
  const camp = readFileSync(new URL("../scripts/ui-camp.mjs", import.meta.url), "utf8");
  assert.ok(camp.includes('return this.watch.setup !== p.night || this.watch.scene ? "decide" : "setup"'));
  assert.ok(camp.includes('run ? "" : tasks + this.#rollLog'), "the camp scene runs the night: the panel keeps a summary");
});

test("an opened row keeps its tools in view: the leg's options take only the room they need", () => {
  const css = readFileSync(new URL("../styles/realms.css", import.meta.url), "utf8");
  assert.ok(css.includes(".kgr-travel .tr-detail .leg-how { flex: 0 0 auto;"), "an older rule gives .leg-how flex: 1 0 100%, which pushes Stay and Remove out of the row");
  const hud = readFileSync(new URL("../scripts/ui-hud.mjs", import.meta.url), "utf8");
  assert.ok(hud.includes("Remove this stop"));
});
