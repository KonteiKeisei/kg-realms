import { test } from "node:test";
import assert from "node:assert/strict";
import { RealmLayer } from "../scripts/realm-layer.mjs";

function setup(isGM = true) {
  globalThis.game = { user: { isGM } };
  const writes = [];
  const map = { style: { _loaded: true }, isStyleLoaded: () => true, setGlobalStateProperty() {}, getSource: (id) => ({ setData: (d) => writes.push([id, d]) }) };
  const layer = new RealmLayer(); layer.ready = true; layer.map = map;
  let glows = 0; layer.onJourneyChanged = () => { glows++; };
  return { layer, writes, glows: () => glows };
}
const line = [[0, 0], [1, 1], [2, 1]];
const marks = (x) => [{ at: [x, 1], name: "Party", kind: "here" }, { at: [2, 2], name: "Wolves", kind: "encounter" }];

test("the same journey twice updates the map and the night glow once", () => {
  const { layer, writes, glows } = setup();
  layer.setJourney(line, marks(1), [false, false, false]);
  layer.setJourney(line.map((p) => [...p]), marks(1), [false, false, false]);
  assert.equal(writes.length, 2, "journey and journey-camps, once");
  assert.equal(glows(), 1);
});

test("a moved party marker or a different line updates the map", () => {
  const { layer, writes } = setup();
  layer.setJourney(line, marks(1));
  layer.setJourney(line, marks(1.5));
  layer.setJourney([...line, [3, 3]], marks(1.5));
  assert.equal(writes.length, 6);
});

test("losing GM status redraws without the encounter markers", () => {
  const { layer, writes } = setup(true);
  layer.setJourney(line, marks(1));
  game.user.isGM = false;
  layer.setJourney(...layer.journey);
  assert.equal(writes.length, 4);
  assert.deepEqual(writes.at(-1)[1].features.map((f) => f.properties.kind), ["here"]);
});

test("a call before the map is ready is not remembered as drawn", () => {
  const { layer, writes } = setup();
  layer.ready = false;
  layer.setJourney(line, marks(1));
  layer.ready = true;
  layer.setJourney(line, marks(1));
  assert.equal(writes.length, 2);
});

test("a new map style (day to night) puts the same journey back", () => {
  const { layer, writes } = setup();
  layer.options = { look: "day" };
  layer.map.setStyle = () => {};
  globalThis.location ??= { origin: "http://localhost:30000" };
  globalThis.foundry ??= { utils: { getRoute: (p) => `/${p}` } };
  layer.setJourney(line, marks(1));
  layer.setLook("night");
  assert.equal(writes.length, 4);
});
