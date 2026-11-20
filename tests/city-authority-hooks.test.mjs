import { test } from "node:test";
import assert from "node:assert/strict";
import { CityFleet } from "../scripts/city/fleet.mjs";
import { CityTransit } from "../scripts/city/transit.mjs";

// Install with stand-ins for Foundry's hooks and settings; return the hooks it registered.
function installed(make) {
  const hooks = new Map();
  globalThis.Hooks = { on: (name, fn) => { (hooks.get(name) ?? hooks.set(name, []).get(name)).push(fn); } };
  globalThis.game = { settings: { register() {} } };
  const subject = make();
  subject.install();
  const fire = (name, ...args) => { for (const fn of hooks.get(name) ?? []) fn(...args); };
  return { subject, fire };
}

for (const [name, make, method] of [["settlement trips (several parties)", () => new CityFleet(), "changed"], ["a settlement trip", () => new CityTransit(), "drive"]]) {
  test(`${name}: camp messages, scene switches and other user flags are ignored`, () => {
    const { subject, fire } = installed(make);
    let runs = 0; subject[method] = () => { runs++; };
    fire("updateUser", {}, { flags: { "kg-realms": { campMessage: "{}" } } });
    fire("updateUser", {}, { viewedScene: "s2" });
    fire("updateUser", {}, { character: "a1" });
    fire("updateUser", {}, { flags: { "other-module": { x: 1 } } });
    assert.equal(runs, 0);
  });

  test(`${name}: a role change, or a GM connecting or leaving, hands the trips over`, () => {
    const { subject, fire } = installed(make);
    let runs = 0; subject[method] = () => { runs++; };
    fire("updateUser", {}, { role: 4 });
    fire("userConnected", {}, true);
    fire("userConnected", {}, false);
    assert.equal(runs, 3);
  });
}
