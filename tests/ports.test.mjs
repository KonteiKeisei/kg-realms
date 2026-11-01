import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { portForStop, PORT_STOP_MI, MARKED_PORT_REACH_MI } from "../scripts/waterways.mjs";

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

test("a marked port reaches water from well inland; the panel uses all this", () => {
  assert.ok(MARKED_PORT_REACH_MI >= 100);
  const hud = readFileSync(new URL("../scripts/ui-hud.mjs", import.meta.url), "utf8");
  assert.ok(hud.includes("p?.port === true")); assert.ok(hud.includes("MARKED_PORT_REACH_MI : HARBOUR_MI"));
  assert.ok(hud.includes("this.portAt({ lon, lat, name: n.name })"));
});
