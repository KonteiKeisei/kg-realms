import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { levelOf, partyModeOf, normalRestore, deploySpots, centroid, snapSquare, ringOffsets, followPlan } from "../scripts/party-battlemap-layout.mjs";

test("every scene has a level: realm, region, place or site", () => {
  assert.equal(levelOf({ world: "faerun" }), "realm");
  assert.equal(levelOf({ world: "sword-coast", regionalMap: true }), "region");
  assert.equal(levelOf({ world: "sword-coast" }, { "sword-coast": { parent: "faerun" } }), "region", "a linked regional map");
  assert.equal(levelOf({ localMap: { name: "Phandalin" } }), "place");
  assert.equal(levelOf({ localMap: { name: "Wave Echo Cave" }, siteMap: true }), "site", "a local map marked Site");
  assert.equal(levelOf({ returnTo: { scene: "x" } }), "site", "a place's own scene");
  assert.equal(levelOf(undefined), "site", "a scene with no KG level");
  assert.equal(levelOf({ world: "faerun", siteMap: true }), "realm", "a travel map is never a Site");
});

test("on Site maps the party is its members, unless the scene asks for the party token", () => {
  assert.equal(partyModeOf({}), "members");
  assert.equal(partyModeOf({ localMap: {}, siteMap: true }), "members");
  assert.equal(partyModeOf({ sitePartyMode: "token" }), "token");
  assert.equal(partyModeOf({ localMap: {} }), "token", "a Place keeps the party token");
  assert.equal(partyModeOf({ world: "faerun" }), "token");
});

test("a token from an earlier test build gets its normal look back", () => {
  const normal = { width: 1, height: 1, lockRotation: true, texture: { src: "party.webp", scaleX: 1, scaleY: 1 } };
  const now = { width: 2, height: 2, lockRotation: false, texture: { src: "c.webp", scaleX: -1, scaleY: 1 } };
  assert.deepEqual(normalRestore(normal, now), { width: 1, height: 1, lockRotation: true, "texture.src": "party.webp", "texture.scaleX": 1, "flags.kg-realms.normalLook": null });
  assert.equal(normalRestore(null, now), null);
});

test("members arrive on free squares around the party token, nearest first", () => {
  assert.deepEqual(ringOffsets(1)[0], [0, 0]);
  assert.equal(ringOffsets(1).length, 9);
  const snap = (p, m) => snapSquare(p, m, 100), m = { w: 100, h: 100 }, party = { x: 500, y: 500, w: 100, h: 100 };
  const spots = deploySpots({ center: { x: 550, y: 550 }, size: 100, members: [m, m, m], occupied: [party], snap });
  assert.equal(new Set(spots.map((s) => `${s.x},${s.y}`)).size, 3, "no two on one square");
  assert.ok(spots.every((s) => (s.x !== 500 || s.y !== 500) && Math.abs(s.x - 500) <= 100 && Math.abs(s.y - 500) <= 100), "next to the party token, not on it");
  const walled = deploySpots({ center: { x: 550, y: 550 }, size: 100, members: [m, m], occupied: [party], blocked: (_f, to) => to.x > 550, snap });
  assert.ok(walled.every((s) => s.x <= 500), "not through a wall");
  const large = deploySpots({ center: { x: 550, y: 550 }, size: 100, members: [{ w: 200, h: 200 }], snap });
  assert.equal(large[0].x % 100, 0, "a large token on grid lines");
  assert.deepEqual(centroid([{ x: 0, y: 0, w: 100, h: 100 }, { x: 200, y: 0, w: 100, h: 100 }]), { x: 150, y: 50 });
});

const c = (x, y) => ({ x: x * 100 + 50, y: y * 100 + 50 });
const snap = (p) => snapSquare(p, { w: 100, h: 100 }, 100);

test("followers line up behind the leader along its path", () => {
  // In a corridor: the leader at (2,0) walks east to (6,0); B and C stand behind it at (1,0) and (0,0).
  const { moves: plan } = followPlan({ origin: c(2, 0), path: [c(3, 0), c(4, 0), c(5, 0), c(6, 0)], followers: [{ id: "C", center: c(0, 0) }, { id: "B", center: c(1, 0) }], spacing: 100, snap });
  const end = Object.fromEntries(plan.map((p) => [p.id, p.path.at(-1)]));
  assert.deepEqual(end.B, c(5, 0), "the nearest one step behind");
  assert.deepEqual(end.C, c(4, 0), "the next behind it");
  const b = plan.find((p) => p.id === "B").path;
  assert.deepEqual(b[0], c(2, 0), "walking the leader's route, from where it started");
});

test("around a corner a follower takes the corner, not the shortcut", () => {
  // The leader goes from (0,0) south to (0,3), then east to (3,3). A wall would block the diagonal.
  const { moves: plan } = followPlan({ origin: c(0, 0), path: [c(0, 1), c(0, 2), c(0, 3), c(1, 3), c(2, 3), c(3, 3)], followers: [{ id: "B", center: c(0, -1) }], spacing: 100, snap });
  const steps = plan[0].path;
  assert.deepEqual(steps.at(-1), c(2, 3));
  assert.ok(steps.some((p) => p.x === c(0, 3).x && p.y === c(0, 3).y), "through the corner square");
  for (let i = 1; i < steps.length; i++) assert.ok(Math.hypot(steps[i].x - steps[i - 1].x, steps[i].y - steps[i - 1].y) <= 100.5, "one square at a time, along the trail");
});

test("one long straight move: followers spread out along it on the grid", () => {
  const { moves: plan } = followPlan({ origin: c(0, 0), path: [c(8, 0)], followers: [{ id: "B", center: c(-1, 0) }, { id: "C", center: c(-2, 0) }], spacing: 100, snap });
  const end = Object.fromEntries(plan.map((p) => [p.id, p.path.at(-1)]));
  assert.deepEqual(end.B, c(7, 0)); assert.deepEqual(end.C, c(6, 0));
});

test("a short step: those already close behind stay put, nobody lands on another", () => {
  const { moves: plan } = followPlan({ origin: c(1, 0), path: [c(2, 0)], followers: [{ id: "B", center: c(1, 1) }, { id: "C", center: c(0, 0) }], spacing: 100, snap });
  const spots = [c(2, 0), ...plan.map((p) => p.path.at(-1))];
  assert.equal(new Set(spots.map((p) => `${p.x},${p.y}`)).size, spots.length, "every token on its own square");
  assert.deepEqual(followPlan({ origin: c(0, 0), path: [], followers: [{ id: "B", center: c(1, 0) }], spacing: 100 }), { moves: [], stuck: [] });
});

test("a member who would cross a wall to join the trail stays where they are", () => {
  // After a deploy, B stands on the far side of a wall at x = 250 from where the leader starts.
  const wall = (a, b) => (a.x < 250) !== (b.x < 250);
  const { moves, stuck } = followPlan({ origin: c(3, 0), path: [c(4, 0), c(5, 0)], followers: [{ id: "B", center: c(1, 0) }, { id: "C", center: c(3, 1) }], spacing: 100, snap, blocked: wall });
  assert.deepEqual(stuck, ["B"]);
  assert.deepEqual(moves.map((m) => m.id), ["C"], "the others still follow");
  for (const m of moves) for (let i = 1; i < m.path.length; i++) assert.ok(!wall(m.path[i - 1], m.path[i]));
});

test("the controls, hooks and Scene Config are wired", () => {
  const src = readFileSync(new URL("../scripts/party-battlemap.mjs", import.meta.url), "utf8");
  assert.ok(src.includes("Hooks.on('moveToken'"), "following uses Foundry's movement hook");
  assert.ok(src.includes("operation?.kgrFollow") && src.includes("this.moving.has(doc.id)") && src.includes("this.moving.set(doc.id, (this.moving.get(doc.id) ?? 0) + 1)"), "its own moves lead no one, counted");
  assert.ok(src.includes("this.queues.get(id) ?? Promise.resolve()"), "one party's follows one after another");
  assert.ok(src.includes("if (moves.length !== 1) continue;"), "several of one party moved together lead no one");
  assert.ok(src.includes("this.#fighting(scene"), "no following in a running combat");
  assert.ok(src.includes("'Bring out the members'") && src.includes("Deploy ${party.name}") && src.includes("Link ${party.name}") && src.includes("Split or merge ${party.name}"));
  assert.ok(src.includes("flags.${ID}.siteMap") && src.includes("flags.${ID}.sitePartyMode") && src.includes("'Make site map'"));
  assert.ok(!src.includes("Hooks.on('canvasReady', () => { if (isPrimaryGM()) this.syncScene"), "no sweep of every scene on load");
  const main = readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.ok(main.includes("siteParty.sceneConfig(root, scene)") && main.includes("siteParty.install()"));
  const manager = readFileSync(new URL("../scripts/party-manager.mjs", import.meta.url), "utf8");
  assert.ok(manager.includes("delete data.flags[ID].siteParty") && manager.includes("data.hidden=!!site.wasHidden"), "a split party's token starts as the original was");
});
