import { test } from "node:test";
import assert from "node:assert/strict";
import { isKgParty, addPartyRule } from "../scripts/monks-bar.mjs";

const group = (flags = {}) => ({ type: "group", flags });

test("a group counts as a party only with a KG record until a module adds a rule", () => {
  assert.equal(isKgParty(group()), false);
  assert.equal(isKgParty(group({ "kg-realms": { party: { number: 2 } } })), true);
  addPartyRule((a) => a.type === "group"); // as KG Realms does: any group actor is a party
  assert.equal(isKgParty(group()), true);
  assert.equal(isKgParty(group({ "kg-realms": { party: { retired: true } } })), false);
  assert.equal(isKgParty({ type: "character", flags: {} }), false);
});
