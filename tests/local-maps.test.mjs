import "./helpers/worlds.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const SCENE = "C:/Users/Konte/Downloads/fvtt-Scene-neverwinter-48AkdWTDurdKRgXv.json";
const JOURNAL = "C:/Users/Konte/Downloads/fvtt-JournalEntry-neverwinter-U8nPKrgXdogRO66m.json";
const have = existsSync(SCENE) && existsSync(JOURNAL);

// Just enough of Foundry's documents to run the conversion on the GM's real export.
function world() {
  const j = JSON.parse(readFileSync(JOURNAL, "utf8")), entryId = "U8nPKrgXdogRO66m";
  const entry = { id: entryId, name: j.name, documentName: "JournalEntry", uuid: `JournalEntry.${entryId}` };
  const pages = j.pages.map((p) => ({ id: p._id, name: p.name, documentName: "JournalEntryPage", type: p.type, text: p.text, parent: entry, uuid: `JournalEntry.${entryId}.JournalEntryPage.${p._id}` }));
  const coll = (list) => Object.assign([...list], { get: (id) => list.find((x) => x.id === id), find: (fn) => list.find(fn) });
  entry.pages = coll(pages);
  const journal = coll([entry]);
  const s = JSON.parse(readFileSync(SCENE, "utf8"));
  const notes = s.notes.map((n) => ({ ...n, id: n._id, flags: n.flags ?? {}, getFlag(scope, key) { return this.flags?.[scope]?.[key]; } }));
  const scene = { id: s._id ?? "nw", name: s.name, notes, flags: {}, updates: [],
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
    async setFlag(scope, key, v) { (this.flags[scope] ??= {})[key] = v; },
    async updateEmbeddedDocuments(type, list) {
      for (const u of list) {
        const n = notes.find((x) => x.id === u._id);
        for (const [k, v] of Object.entries(u)) {
          if (k.startsWith("flags.")) { const [, scope, key] = k.split("."); (n.flags[scope] ??= {})[key] = v; } else if (k !== "_id") n[k] = v;
        }
      }
    } };
  return { journal, scene };
}

test("Neverwinter's journal pins become local places, with their pages' text in their cards", { skip: !have }, async () => {
  const { journal, scene } = world();
  globalThis.game = { journal };
  globalThis.foundry = { utils: { randomID: () => "r" + Math.random().toString(36).slice(2, 10), escapeHTML: (s) => s } };
  const { LocalMaps } = await import("../scripts/local-maps.mjs");
  const edits = [];
  const lm = new LocalMaps({ getRealmPlaces: async () => [], savePlaceEdit: async (...a) => edits.push(a) });
  const place = { id: "label-neverwinter", name: "Neverwinter", class: "City", kind: "settlement" };
  const report = await lm.convert(scene, place);
  assert.equal(report.converted, 20);
  const recs = scene.notes.map((n) => n.flags["kg-realms"].local);
  // Every pin found its page, though the pins point at an older copy of the journal: its text is in
  // the card as a GM-only secret block, and the pin no longer links the journal.
  assert.ok(recs.every((r) => r.known.startsWith('<section class="secret"')), recs.filter((r) => !r.known).map((r) => r.name).join(", "));
  assert.ok(recs.every((r) => r.journal === null));
  assert.ok(scene.notes.every((n) => n.entryId === null && n.pageId === null));
  const by = Object.fromEntries(recs.map((r) => [r.name, r]));
  assert.equal(by["Shining Knight Arms and Armor"].category, "shop");
  assert.equal(by["Shining Knight Arms and Armor"].order, 20);
  assert.equal(by["The Beached Leviathan"].category, "inn");
  assert.equal(by["Neverdeath Graveyard"].category, "graveyard");
  // The overview page goes to the realm place; Castle Never and Seafoam Manor wait to be placed.
  assert.equal(report.overview, "Neverwinter");
  const map = scene.flags["kg-realms"].localMap;
  assert.deepEqual(map.unplaced.map((u) => u.name).sort(), ["Castle Never", "Seafoam Manor"]);
  assert.equal(map.placeId, "label-neverwinter");
  assert.equal(edits[0][1], "label-neverwinter");
  assert.equal(edits[0][2].scene, scene.id);
  assert.ok(edits[0][2].known.includes('<section class="secret"'));
  assert.equal(edits[0][2].page, undefined);
  // Converting again does nothing twice.
  const again = await lm.convert(scene, place);
  assert.equal(again.converted, 0);
  delete globalThis.game; delete globalThis.foundry;
});
test("a place's own scene remembers the way back, and forgets it when unlinked", async () => {
  const { LocalMaps, returnOf } = await import("../scripts/local-maps.mjs");
  const flags = (o) => Object.assign(o, { flags: {}, getFlag(s, k) { return this.flags[s]?.[k]; }, async setFlag(s, k, v) { (this.flags[s] ??= {})[k] = v; }, async unsetFlag(s, k) { delete this.flags[s]?.[k]; } });
  const city = flags({ id: "nw", name: "Neverwinter" });
  city.flags["kg-realms"] = { localMap: { name: "Neverwinter" } };
  const tavern = flags({ id: "lev", name: "Beached Leviathan map" }), fight = flags({ id: "fight", name: "Dock brawl" });
  globalThis.game = { scenes: { get: (id) => [city, tavern, fight].find((s) => s.id === id) } };
  const note = { id: "n1", text: "The Beached Leviathan", parent: city, getFlag: () => ({ name: "The Beached Leviathan" }) };
  const lm = new LocalMaps({});
  await lm.linkScene(note, null, "lev");
  assert.deepEqual(returnOf(tavern), { scene: "nw", note: "n1", name: "The Beached Leviathan", map: "Neverwinter" });
  await lm.linkScene(note, "lev", "fight");
  assert.equal(returnOf(tavern), null);
  assert.equal(returnOf(fight).note, "n1");
  delete globalThis.game;
});

test("the trail runs from the realm map down through nested local maps", async () => {
  const { LocalMaps } = await import("../scripts/local-maps.mjs");
  const mk = (id, name, flags = {}) => ({ id, name, flags: { "kg-realms": flags }, getFlag(s, k) { return this.flags[s]?.[k]; }, testUserPermission: () => true });
  const realm = mk("realm", "Faerun", { world: "toril" });
  const city = mk("nw", "Neverwinter city map", { localMap: { world: "toril", placeId: "label-neverwinter", name: "Neverwinter" } });
  const inn = mk("lev", "Leviathan decks", { returnTo: { scene: "nw", note: "n1", name: "The Beached Leviathan", map: "Neverwinter" }, localMap: { world: "toril", placeId: null, name: "The Beached Leviathan", parent: { scene: "nw", note: "n1", name: "The Beached Leviathan" } } });
  const hold = mk("hold", "The Hold", { returnTo: { scene: "lev", note: "n9", name: "The Hold", map: "The Beached Leviathan" } });
  const all = [realm, city, inn, hold];
  globalThis.game = { scenes: { get: (id) => all.find((s) => s.id === id) } };
  const lm = new LocalMaps({ realmSceneFor: () => realm });
  assert.deepEqual(lm.trail(hold).map((x) => x.label), ["Faerun", "Neverwinter", "The Beached Leviathan", "The Hold"]);
  assert.deepEqual(lm.trail(hold).map((x) => x.focus), [{ scene: "realm", placeId: "label-neverwinter" }, { scene: "nw", note: "n1" }, { scene: "lev", note: "n9" }, null]);
  assert.equal(lm.trail(realm).length, 1);
  delete globalThis.game;
});

test("the module's Neverwinter preset sets up the GM's own Neverwinter scene, its places carrying their text", { skip: !have }, async () => {
  const { journal, scene } = world();
  const { LocalMaps } = await import("../scripts/local-maps.mjs");
  const { readFileSync: rf } = await import("node:fs");
  const coll = (list) => Object.assign(list, { get: (id) => list.find((x) => x.id === id), find: (fn) => Array.prototype.find.call(list, fn), some: (fn) => Array.prototype.some.call(list, fn) });
  scene.id = "48AkdWTDurdKRgXv"; scene.width = 7000; scene.height = 5409;
  scene.notes.contents = scene.notes;
  journal[0].pages.forEach((p) => { p.id = p.id; });
  const created = [];
  scene.createEmbeddedDocuments = async (type, list) => { created.push(...list); };
  globalThis.game = { user: { isGM: true }, users: {}, scenes: coll([scene]), journal: coll([...journal]) };
  globalThis.foundry = { utils: { getRoute: (p) => p, randomID: () => "r" + Math.random().toString(36).slice(2, 10), escapeHTML: (s) => s } };
  globalThis.fetch = async (url) => ({ ok: true, json: async () => JSON.parse(rf(new URL(`../${url.replace(/^modules\/kg-realms(-faerun)?\//, "")}`, import.meta.url), "utf8")) });
  const edits = [];
  const places = [{ id: "7e243b80-8918-42fa-b60e-03cec8bdb184", name: "Neverwinter", kind: "settlement", scene: "48AkdWTDurdKRgXv" }];
  const lm = new LocalMaps({ getRealmPlaces: async () => places, savePlaceEdit: async (...a) => edits.push(a) });
  const entry = (await lm.presets("toril")).find((p) => p.name === "Neverwinter");
  const report = await lm.applyPreset(entry);
  assert.equal(report.places, 42);
  assert.equal(created.length, 22, "the original pins are converted where they stand; the newly placed defaults are added");
  assert.equal(created.filter(n => n.flags['kg-realms'].local.category === 'gate').length, 4);
  const recs = scene.notes.map((n) => n.flags["kg-realms"].local);
  // The text of the GM's own pages, in each card; no journal linked or made.
  assert.ok(recs.every((r) => r.journal === null && r.known.startsWith('<section class="secret"')));
  // Once: the GM's page, not the preset's copy as well.
  assert.ok(recs.every((r) => r.known.match(/<section class="secret"/g).length === 1), recs.filter((r) => r.known.match(/<section class="secret"/g).length !== 1).map((r) => r.name).join(", "));
  assert.ok(scene.notes.every((n) => n.entryId === null));
  assert.ok(recs.find((r) => r.name === "Neverwinter River and Harbor").entry);
  assert.equal(scene.flags["kg-realms"].localMap.placeId, "7e243b80-8918-42fa-b60e-03cec8bdb184");
  assert.equal(scene.flags["kg-realms"].localMap.unplaced.length,0);
  assert.ok(edits[0][2].known.includes('<section class="secret"'));
  delete globalThis.game; delete globalThis.foundry; delete globalThis.fetch;
});
