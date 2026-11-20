import { test } from "node:test";
import assert from "node:assert/strict";
import { cityHudChange } from "../scripts/city/hud.mjs";

const party = { id: "party", type: "group" }, hero = { id: "hero", type: "character" }, other = { id: "other", type: "group" };
const here = { tokens: [] }, elsewhere = { tokens: [] };
const token = (actor, scene = here) => ({ parent: scene, actor, actorId: actor?.id });
here.tokens.push(token(party), token(hero));
elsewhere.tokens.push(token(other, elsewhere));

test("a character's token moving or its actor changing leaves the HUD alone", () => {
  assert.equal(cityHudChange("updateToken", token(hero), here), false);
  assert.equal(cityHudChange("createToken", token({ id: "wolf", type: "npc" }), here), false);
  assert.equal(cityHudChange("updateActor", hero, here), false, "HP, items, conditions");
});

test("a party token moving, created or deleted redraws the HUD", () => {
  assert.equal(cityHudChange("updateToken", token(party), here), true);
  assert.equal(cityHudChange("createToken", token(party), here), true);
  assert.equal(cityHudChange("deleteToken", token(null), here), true, "an actor that can no longer be read");
});

test("a party actor here changing (a member joins) redraws; one on another scene does not", () => {
  assert.equal(cityHudChange("updateActor", party, here), true);
  assert.equal(cityHudChange("updateActor", other, here), false);
  assert.equal(cityHudChange("updateToken", token(other, elsewhere), here), false);
});

test("places on this map redraw; places on another map do not", () => {
  assert.equal(cityHudChange("updateNote", { parent: here }, here), true);
  assert.equal(cityHudChange("deleteNote", { parent: elsewhere }, here), false);
  assert.equal(cityHudChange("updateNote", { parent: here }, null), false, "no scene viewed");
});
