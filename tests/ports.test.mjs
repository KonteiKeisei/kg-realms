import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { portForStop, PORT_STOP_MI, portVoyage, planSea, buildSea, shoreWater, riverAt, riverLabel, RIVER_STOP_MI } from "../scripts/waterways.mjs";

const toSheet = (lon, lat) => [lon, lat];
const arine = { id: "a", name: "Arine", lon: 0, lat: 0, port: true }, wakeflow = { id: "w", name: "Wakeflow", lon: 500, lat: 0, port: true };
const ports = [arine, wakeflow];

test("a party in town is at its port: within the same 5 miles as being in that town", () => {
  assert.equal(PORT_STOP_MI, 5);
  assert.equal(portForStop({ lon: 4.5, lat: 0 }, ports, toSheet, 1), arine);
  assert.equal(portForStop({ lon: 6, lat: 0 }, ports, toSheet, 1), null);
  assert.equal(portForStop({ lon: 45, lat: 0 }, ports, toSheet, 0.1), arine, "by miles, on any map");
});

test("a stop named for a port is at it, even if the place has moved since", () => {
  assert.equal(portForStop({ lon: 480, lat: 0, name: "Wakeflow" }, ports, toSheet, 1), wakeflow);
  assert.equal(portForStop({ lon: 480, lat: 0, name: "Road" }, ports, toSheet, 1), null);
});

test("the nearest wins, and no stop means no port", () => {
  const near = { id: "n", name: "Near", lon: 2, lat: 0 };
  assert.equal(portForStop({ lon: 1.5, lat: 0 }, [arine, near], toSheet, 1), near);
  assert.equal(portForStop(null, ports, toSheet, 1), null);
  assert.equal(portForStop({ lon: 0, lat: 0 }, [], toSheet, 1), null);
});

// A sheet of 2000 x 1600 px. mpp 0.5.
const blank = () => ({ data: new Uint8Array(500 * 400).fill(1), width: 500, height: 400, cell: 4 });
const seaOf = (shores) => { const list = shores.map((s) => ({ kind: "shore", ...s })); return buildSea(shoreWater(blank(), list.filter((s) => s.kind === "shore")), list, { milesPerPixel: 0.5 }); };
const voyage = (sea, a, b) => portVoyage(sea, a, b, { mph: 2, reach: 36, milesPerPixel: 0.5 });
// Land in the middle of the sheet, water all round.
const island = { id: "c", closed: true, water: "outside", pts: [[400, 300], [1600, 300], [1600, 1300], [400, 1300]] };

test("a port on the coast heads straight out and sails round", () => {
  const p = voyage(seaOf([island]), [1000, 300], [1000, 1300]);
  assert.ok(p.miles > 500 && p.miles < 1200, String(p.miles));
  assert.ok(p.legs.every((l) => l.kind === "sea" || l.kind === "wind"));
});

test("a port inland with no river goes in a straight line to the nearest water", () => {
  const sea = seaOf([island]), from = [1000, 500], p = voyage(sea, from, [1000, 1300]);
  assert.equal(planSea(sea, from, [1000, 1300], { mph: 2, reach: 36 }), null, "not by the ordinary rule");
  assert.deepEqual(p.legs[0].pts[0], from);
  const out = p.legs[0].pts[1];
  assert.ok(out[1] < 300, "north: the nearest coast, " + out);
  assert.ok(Math.abs(out[0] - 1000) < 40, "straight up, " + out);
});

test("a port inland on a river goes down the river", () => {
  const river = { id: "r", kind: "river", name: "Oban", pts: [[1000, 700], [1000, 280]] };
  const p = voyage(seaOf([island, river]), [1000, 700], [1000, 1300]);
  assert.ok(p.legs.some((l) => l.kind === "river" && l.name === "Oban"), JSON.stringify(p.legs.map((l) => l.kind)));
});

test("water cut in two still sails, the least way over the land between", () => {
  const shores = [{ id: "n", water: "left", pts: [[0, 700], [2000, 700]] }, { id: "s", water: "left", pts: [[2000, 800], [0, 800]] }];
  const sea = seaOf(shores), a = [1000, 700], b = [1000, 800];
  assert.equal(planSea(sea, a, b, { mph: 2, reach: 8 }), null);
  const p = voyage(sea, a, b);
  assert.ok(p.miles < 100, "straight over the thin land, not round it: " + p.miles);
});

test("no water on the map at all: still a voyage, port to port", () => {
  const sea = buildSea(blank(), [], { milesPerPixel: 0.5 });
  const p = voyage(sea, [100, 100], [500, 100]);
  assert.equal(Math.round(p.miles), 200);
  assert.equal(p.hours, 100);
  assert.equal(voyage(null, [100, 100], [500, 100]).miles, 200, "or no terrain at all");
});

test("the panel names the port and never says a port cannot sail", () => {
  const hud = readFileSync(new URL("../scripts/ui-hud.mjs", import.meta.url), "utf8");
  const go = readFileSync(new URL("../scripts/travel.mjs", import.meta.url), "utf8");
  assert.ok(!hud.includes("No water joins")); assert.ok(!hud.includes("seaFailed")); assert.ok(!go.includes("seaFailed"));
  assert.ok(hud.includes("Port of ${p.name}: sea travel available"));
  assert.ok(hud.includes("port of ${p.name}"));
  assert.ok(hud.includes("portVoyage(this.sea, from, to, opts)"));
});

const oban = { kind: "river", name: "Oban", pts: [[0, 0], [100, 0]] };
test("a stop on a drawn river can board a boat on it", () => {
  assert.equal(RIVER_STOP_MI, 3);
  assert.equal(riverAt({ lon: 50, lat: 2 }, { oban }, toSheet, 1), oban, "beside the middle of a stretch, not only at its points");
  assert.equal(riverAt({ lon: 50, lat: 4 }, { oban }, toSheet, 1), null);
  assert.equal(riverAt({ lon: 50, lat: 0 }, { oban: { ...oban, navigable: false } }, toSheet, 1), null, "a torrent takes no boat");
  assert.equal(riverAt({ lon: 50, lat: 0 }, { s: { ...oban, kind: "shore" } }, toSheet, 1), null, "only rivers");
  assert.equal(riverAt(null, { oban }, toSheet, 1), null);
});

test("a river reads as a river", () => {
  assert.equal(riverLabel(oban), "the river Oban");
  assert.equal(riverLabel({ name: "Oban River" }), "the Oban River");
  assert.equal(riverLabel({ name: "The River Oban" }), "the River Oban");
  assert.equal(riverLabel({}), "the river");
});

test("from a stop on the river a boat goes down it to the port it runs through", () => {
  const river = { id: "r", kind: "river", name: "Oban", pts: [[1000, 700], [1000, 300]] };
  const p = voyage(seaOf([island, river]), [1000, 500], [1000, 300]);
  assert.ok(p.legs.some((l) => l.kind === "river" && l.name === "Oban"));
  assert.ok(p.miles < 120, String(p.miles));
});
