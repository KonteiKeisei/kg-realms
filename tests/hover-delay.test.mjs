import { test } from "node:test";
import assert from "node:assert/strict";
import { PlaceCard } from "../scripts/ui-card.mjs";

test("a visible place waits before opening and leaving cancels the card", async () => {
  const handlers = new Map();
  const view = { style: { cursor: "" }, getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  globalThis.canvas = {
    stage: { on: (name, fn) => handlers.set(name, fn), off: (name) => handlers.delete(name) },
    app: { view }, tokens: { controlled: [] }
  };
  globalThis.document = {
    elementFromPoint: () => view,
    createElement: () => ({ style: { setProperty() {} }, remove() {}, offsetWidth: 200, offsetHeight: 100 }),
    body: { append() {} }
  };
  globalThis.window = { innerWidth: 1000, innerHeight: 800 };
  globalThis.game = { user: { isGM: false, character: null } };
  globalThis.foundry = { utils: { escapeHTML: String } };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  let hit = "place";
  const card = new PlaceCard({ getPlace: () => ({ id: "place", name: "Test", class: "Town" }), hoverDelayMs: () => 40 });
  card.attach({ placeAt: (_at, radius) => { assert.equal(radius, 7); return hit; }, frame: null });
  const move = { global: { x: 100, y: 100 }, client: { clientX: 100, clientY: 100 }, getLocalPosition: () => ({ x: 100, y: 100 }) };
  handlers.get("pointermove")(move);
  await new Promise((resolve) => setTimeout(resolve, 12));
  assert.equal(card.hovered, null);
  assert.equal(card.cue?.className, "kgr-ui kgr-hover-cue");
  assert.match(card.cue?.innerHTML, /Test.*Place card opening/);
  assert.equal(view.style.cursor, "pointer");
  await new Promise((resolve) => setTimeout(resolve, 55));
  assert.equal(card.hovered, "place");
  assert.equal(card.cue, null);
  card.hide();
  handlers.get("pointermove")(move);
  await new Promise((resolve) => setTimeout(resolve, 12));
  hit = null;
  handlers.get("pointermove")(move);
  await new Promise((resolve) => setTimeout(resolve, 55));
  assert.equal(card.hovered, null);
  assert.equal(card.cue, null);
  assert.equal(view.style.cursor, "");
  card.detach();
});
