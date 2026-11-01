import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tokenFitFactor, fitMesh, PartyTokenFit } from "../scripts/party-token-fit.mjs";
import { spotRealms } from "../scripts/map-layers.mjs";

const mesh = (x = 1, y = 1) => ({ scale: { x, y, set(a, b) { this.x = a; this.y = b; } } });

test("a token keeps its size until it would be too small on screen, then holds it", () => {
  assert.equal(tokenFitFactor(100, 1), 1);
  assert.equal(tokenFitFactor(100, 0.4), 1);
  assert.equal(tokenFitFactor(100, 0.2), 2);
  assert.ok(Math.abs(100 * 0.05 * tokenFitFactor(100, 0.05) - 40) < 1e-9, "40 px on screen");
  assert.equal(tokenFitFactor(100, 0.001), 60, "within limits");
  assert.equal(tokenFitFactor(0, 0.1), 1);
});

test("fitting scales from Foundry's size, not from its own last result", () => {
  const m = mesh(0.5, 0.5);
  let s = fitMesh(m, 2);
  assert.equal(m.scale.x, 1);
  s = fitMesh(m, 3, s);
  assert.equal(m.scale.x, 1.5, "not compounded");
  s = fitMesh(m, 1, s);
  assert.equal(m.scale.x, 0.5, "and back");
});

test("if Foundry resets the size, that becomes the new base", () => {
  const m = mesh(0.5, 0.5);
  let s = fitMesh(m, 2);
  m.scale.set(0.8, 0.8);
  s = fitMesh(m, 2, s);
  assert.equal(m.scale.x, 1.6);
});

test("only the party, only on a realm map, and it goes back when zoomed in", () => {
  const scene = { world: true, getFlag: () => (scene.world ? "t" : null) };
  globalThis.canvas = { scene, stage: { scale: { x: 0.1 } } };
  const part = () => ({ destroyed: false, pivot: { set(a, b) { this.v = [a, b]; } }, position: { set(a, b) { this.v = [a, b]; } }, scale: { set(a) { this.v = a; } } });
  const make = () => ({ w: 100, h: 100, mesh: mesh(), border: part(), kgrPartyPortraits: part(), hitArea: { x: 0, y: 0, width: 100, height: 100 } });
  const fit = new PartyTokenFit({ isParty: (t) => t.party });
  const party = { ...make(), party: true }, npc = { ...make(), party: false };
  fit.fit(party); fit.fit(npc);
  assert.equal(party.mesh.scale.x, 4); assert.equal(npc.mesh.scale.x, 1); assert.equal(npc.kgrFitState, undefined);
  assert.equal(party.kgrPartyPortraits.scale.v, 4); assert.deepEqual(party.kgrPartyPortraits.pivot.v, [50, 50]);
  assert.equal(party.hitArea.width, 400); assert.equal(party.hitArea.x, -150, "clickable as drawn, centred");
  canvas.stage.scale.x = 1; fit.fit(party);
  assert.equal(party.mesh.scale.x, 1); assert.equal(party.hitArea.width, 100); assert.equal(party.hitArea.x, 0);
  canvas.stage.scale.x = 0.1; scene.world = false;
  const elsewhere = { ...make(), party: true }; fit.fit(elsewhere);
  assert.equal(elsewhere.mesh.scale.x, 1, "not on a settlement map");
});

test("a stop shows the domains and territories around it", () => {
  const square = (x, y, r) => [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]];
  const list = [{ id: "e", name: "Salvae Empire", kind: "domain", class: "Empire", lon: 90, lat: 90 }, { id: "m", name: "Empiria", kind: "territory", class: "Region", partOf: "e", lon: 0, lat: 0, area: square(0, 0, 10) }];
  assert.equal(spotRealms(1, 1, list), "Empiria, Salvae Empire");
  assert.equal(spotRealms(50, 50, list), "");
  assert.equal(spotRealms(1, 1, [list[0], { ...list[1], hidden: true }]), "Salvae Empire", "a hidden territory is left out; the visible domain above it still shows");
  const hud = readFileSync(new URL("../scripts/ui-hud.mjs", import.meta.url), "utf8");
  assert.ok(hud.includes('class="stop-where"'));
});
