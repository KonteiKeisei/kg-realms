import { test } from "node:test";
import assert from "node:assert/strict";
import { expandParties } from "../scripts/monks-members.mjs";

const actor = (id, name = id) => ({ id, name });
const sean = actor("sean", "Sean"), leo = actor("leo", "Leonard"), pierre = actor("pierre", "Pierre");
const groupA = actor("gA", "Leonard and Pierre"), groupB = actor("gB", "Sean");
const partyRowA = { id: "tA", token: { id: "tA", name: "Leonard and Pierre" }, actor: groupA, cssClass: "" };
const bouncer = { id: "tN", token: { id: "tN", name: "Bouncer" }, actor: actor("npc", "Bouncer"), cssClass: "" };
const zed = { id: "tZ", token: { id: "tZ", name: "Zed" }, actor: actor("zed", "Zed"), cssClass: "" };
const A = { tokenId: "tA", name: "Leonard and Pierre", members: [leo, pierre] };
const B = { tokenId: "tB", name: "Sean", members: [sean] };
const isParty = (e) => e.actor === groupA || e.actor === groupB;
const ids = (rows) => rows.map((e) => e.id);

test("each party becomes its people, placed where the party's name sorts", () => {
  const out = expandParties([bouncer, partyRowA, zed], { parties: [B, A], isParty });
  assert.deepEqual(ids(out), ["tN", "leo", "pierre", "sean", "tZ"]);
  const [, first, second, third] = out;
  assert.equal(first.token, null);
  assert.equal(first.actor, leo);
  assert.deepEqual(first.kgParty, { tokenId: "tA", name: "Leonard and Pierre" });
  assert.match(first.cssClass, /only-actor kg-member kg-party-start/);
  assert.doesNotMatch(second.cssClass, /kg-party-start/);
  assert.match(third.cssClass, /kg-party-start/);
  assert.equal(first.kgNew, true);
});

test("a party Monk's left off the bar still shows its people", () => {
  const out = expandParties([bouncer], { parties: [A], isParty });
  assert.deepEqual(ids(out), ["tN", "leo", "pierre"]);
});

test("someone with a token of their own keeps it; each person once", () => {
  const ownToken = { id: "tP", token: { id: "tP", name: "Pierre" }, actor: pierre, cssClass: "" };
  const both = { tokenId: "tB", name: "Sean", members: [sean, leo] };
  const out = expandParties([ownToken], { parties: [A, both], isParty });
  assert.deepEqual(ids(out), ["leo", "tP", "sean"]);
  assert.equal(out[1], ownToken);
  assert.equal(out[1].kgParty, undefined);
});

test("someone already listed without a token joins their party", () => {
  const listed = { id: "leo", token: null, actor: leo, cssClass: "only-actor", stats: { hp: 9 } };
  const out = expandParties([listed, bouncer], { parties: [A], isParty });
  assert.deepEqual(ids(out), ["tN", "leo", "pierre"]);
  assert.equal(out[1], listed);
  assert.equal(out[1].kgNew, undefined);
  assert.deepEqual(out[1].kgParty, { tokenId: "tA", name: "Leonard and Pierre" });
  assert.equal(out[1].cssClass, "only-actor kg-member kg-party-start");
});

test("people this user may not see are left out, and an empty party leaves nothing", () => {
  const out = expandParties([partyRowA], { parties: [A, B], isParty, show: (a) => a === sean });
  assert.deepEqual(ids(out), ["sean"]);
});

test("a scene without parties keeps Monk's bar as it was", () => {
  const entries = [bouncer, zed];
  assert.deepEqual(expandParties(entries, { parties: [], isParty }), entries);
});
