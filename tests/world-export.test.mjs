import { test } from "node:test";
import assert from "node:assert/strict";
import { fileRef, scanFiles, rewriteFiles, cardFolder, sceneFolder, assetNamer, placeForExport, scenesOfWorld, sceneForExport, linkedDocuments, markersUsed, exportReport } from "../scripts/homebrew/export-plan.mjs";
import { zipEntry, zipParts, zipStore, zipFits, moduleScript } from "../scripts/homebrew/plan.mjs";

test("a file named in data is found wherever it is, and links to the engine and Foundry stay", () => {
  assert.deepEqual(fileRef("Sword%20Coast/Images/hok.webp"), { kind: "local", path: "Sword Coast/Images/hok.webp" });
  assert.deepEqual(fileRef("/worlds/mine/a.png?v=2"), { kind: "local", path: "worlds/mine/a.png" });
  assert.deepEqual(fileRef("/foundry/worlds/mine/a.png", { prefix: "foundry" }), { kind: "local", path: "worlds/mine/a.png" });
  assert.deepEqual(fileRef("http://localhost:30000/worlds/a.png", { origin: "http://localhost:30000" }), { kind: "local", path: "worlds/a.png" });
  assert.equal(fileRef("https://example.com/a.png").kind, "external");
  for (const keep of ["icons/svg/book.svg", "modules/kg-realms/data/markers/gate.png", "systems/dnd5e/x.webp"]) assert.equal(fileRef(keep).kind, "keep", keep);
  assert.equal(fileRef("data:image/png;base64,AAAA"), null);
  assert.equal(fileRef("modules/other-module/art/a.webp").kind, "local", "another module's art goes with the world");
});

test("every picture is found: card fields, galleries, card text, and any new field", () => {
  const place = { img: "art/a.webp", images: ["art/b%20c.png"], known: `<p>Text about a.webp</p><img src="art/d.jpg"><a href="art/e.webp">e</a><div style="background:url(&quot;art/f.png&quot;)"></div>`, summary: "A city of 3.webp people, said plainly", someNewField: { deep: "art/g.webm" }, name: "Arine", url: "https://wiki/x.png", originalImg: "old/o.webp", sound: "art/h.mp3" };
  const found = scanFiles(place, cardFolder);
  assert.deepEqual([...found.keys()].sort(), ["art/a.webp", "art/b%20c.png", "art/d.jpg", "art/e.webp", "art/f.png", "art/g.webm", "art/h.mp3"]);
  assert.equal(found.get("art/a.webp"), "assets/poi-img");
  assert.equal(found.get("art/h.mp3"), "assets/audio");
});

test("in a scene, its map goes to assets/maps and its pins' art to assets/poi-img", () => {
  const scene = { background: { src: "maps/town.webp" }, levels: [{ background: { src: "maps/level.webp" } }], tiles: [{ texture: { src: "maps/roof.webp" } }], sounds: [{ path: "s/wind.ogg" }], notes: [{ flags: { "kg-realms": { local: { img: "art/shop.webp" } } } }] };
  const found = scanFiles(scene, sceneFolder);
  assert.equal(found.get("maps/town.webp"), "assets/maps");
  assert.equal(found.get("maps/level.webp"), "assets/maps");
  assert.equal(found.get("maps/roof.webp"), "assets/maps");
  assert.equal(found.get("s/wind.ogg"), "assets/audio");
  assert.equal(found.get("art/shop.webp"), "assets/poi-img");
});

test("links change everywhere a file is named, and only there", () => {
  const paths = new Map([["art/a.webp", "modules/m/assets/poi-img/a.webp"], ["art/f.png", "modules/m/assets/poi-img/f.png"]]);
  const out = rewriteFiles({ img: "art/a.webp", images: ["art/a.webp", "art/other.webp"], known: `<img src="art/a.webp"> art/a.webp stays in words <i style="background:url(art/f.png)"></i>`, originalImg: "art/a.webp", n: 3 }, paths);
  assert.equal(out.img, "modules/m/assets/poi-img/a.webp");
  assert.deepEqual(out.images, ["modules/m/assets/poi-img/a.webp", "art/other.webp"]);
  assert.equal(out.known, `<img src="modules/m/assets/poi-img/a.webp"> art/a.webp stays in words <i style="background:url(modules/m/assets/poi-img/f.png)"></i>`);
  assert.equal(out.originalImg, "art/a.webp");
  assert.equal(out.n, 3);
});

test("files get one place each: two files of one name kept apart, one file named twice kept once", () => {
  const claim = assetNamer("kg-realms-trorune");
  const first = claim("assets/poi-img", "worlds/x/Baldur's Gate.webp", 10, 111);
  assert.equal(first.rel, "assets/poi-img/Baldur's Gate.webp");
  assert.equal(first.ref, "modules/kg-realms-trorune/assets/poi-img/Baldur's%20Gate.webp");
  assert.equal(claim("assets/poi-img", "other/Baldur's%20Gate.webp", 10, 111).rel, first.rel, "the same file");
  assert.equal(claim("assets/poi-img", "other/Baldur's Gate.webp", 20, 222).rel, "assets/poi-img/Baldur's Gate-2.webp", "a different file");
  assert.equal(claim("assets/maps", "worlds/x/Baldur's Gate.webp", 20, 222).rel, "assets/maps/Baldur's Gate.webp", "another folder");
});

test("a world's scenes: its own, what its places and pins link to, and theirs", () => {
  const f = (flags) => ({ flags: { "kg-realms": flags } });
  const all = [
    { _id: "realm", ...f({ world: "t" }) },
    { _id: "town", ...f({ localMap: { world: "t" } }), notes: [{ flags: { "kg-realms": { local: { scene: "inn" } } } }, { flags: { "kg-realms": { local: { scene: "gone" } } } }] },
    { _id: "inn", notes: [{ flags: { "kg-realms": { local: { scene: "cellar" } } } }] },
    { _id: "cellar", ...f({ returnTo: { scene: "inn" } }) },
    { _id: "linked" },
    { _id: "elsewhere", ...f({ world: "other" }) },
    { _id: "backup" }
  ];
  const { scenes, missing } = scenesOfWorld(all, [{ scene: "linked" }, { scene: null }], "t");
  assert.deepEqual(scenes.map((s) => s._id).sort(), ["cellar", "inn", "linked", "realm", "town"]);
  assert.deepEqual(missing, ["gone"]);
});

test("a scene ships its pins, lights and walls, without this table's tokens, journey or backup", () => {
  const doc = { _id: "a", name: "Town", _stats: {}, folder: "f", thumb: "worlds/x/thumb.webp", active: true, ownership: { x: 3 }, tokens: [{ actorId: "z" }], lights: [{}], walls: [{}], journal: "j", notes: [{ entryId: "e", pageId: "p", flags: { "kg-realms": { local: { name: "Inn" } } } }],
    flags: { fxmaster: { on: 1 }, "kg-realms": { localMap: { world: "t" }, cityRoads: { roads: [] }, journey: {}, partyJourneys: {}, partyFocus: "p", cityAsk: {}, homebrewOriginal: {} } } };
  const out = sceneForExport(doc);
  assert.deepEqual(out.tokens, []); assert.equal(out.active, false); assert.equal(out.journal, null);
  for (const gone of ["_stats", "folder", "thumb", "ownership"]) assert.ok(!(gone in out), gone);
  assert.equal(out.lights.length, 1); assert.equal(out.walls.length, 1);
  assert.equal(out.notes[0].entryId, null); assert.equal(out.notes[0].flags["kg-realms"].local.name, "Inn");
  assert.deepEqual(Object.keys(out.flags["kg-realms"]).sort(), ["cityRoads", "localMap"]);
  assert.deepEqual(out.flags.fxmaster, { on: 1 });
  assert.ok(doc.flags["kg-realms"].journey, "the game world's scene is untouched");
});

test("what stays behind is named: linked actors and journals", () => {
  const { actors, journals } = linkedDocuments([{ actor: "Actor.a", actors: ["Actor.b"], journal: "J.1", known: "<p>@UUID[Actor.c]{C} and @UUID[JournalEntry.d]{D}</p>" }, { actor: "", journal: null }]);
  assert.deepEqual(actors.sort(), ["Actor.a", "Actor.b", "Actor.c"]);
  assert.deepEqual(journals.sort(), ["J.1", "JournalEntry.d"]);
});

test("a place ships without what applyEdits adds, and only the markers used go", () => {
  assert.deepEqual(placeForExport({ id: "a", edited: true, added: true, original: "A", removed: false, area: [[0, 0]] }), { id: "a", area: [[0, 0]] });
  assert.deepEqual(Object.keys(markersUsed({ m1: { src: "a.webp" }, m2: { src: "b.webp" } }, [{ marker: "m1" }])), ["m1"]);
});

test("the report says what went in and everything that did not", () => {
  const text = exportReport({ title: "T", version: "1", moduleId: "m", counts: { scenes: 2 }, missing: ["a.webp: HTTP 404"], external: [], scenesMissing: ["gone"], linked: { actors: ["Actor.a"], journals: [] }, skippedTokens: 3 });
  for (const part of ["2 scenes", "a.webp: HTTP 404", "gone", "Actor.a", "Tokens left out of the scenes: 3"]) assert.ok(text.includes(part), part);
  assert.ok(!text.includes("on the web"), "no heading for an empty list");
});

test("a zip in pieces matches one built whole, and a file's body may be a Blob", async () => {
  const files = [{ name: "a/b.txt", bytes: "hello" }, { name: "a/ç.bin", bytes: new Uint8Array([1, 2, 3]) }];
  const whole = zipStore(files);
  const entries = files.map((f) => zipEntry(f.name, f.bytes));
  for (const e of entries) e.body = new Blob([e.body]);
  const fromParts = new Uint8Array(await new Blob(zipParts(entries)).arrayBuffer());
  assert.deepEqual(fromParts, whole);
  assert.equal(zipFits(entries), true);
  assert.equal(zipFits([{ name: "x", size: 2 ** 32 }]), false);
});

test("the module's script registers the world with its markers, lore, snow and scenes", () => {
  const script = moduleScript("kg-realms-t", { id: "t", title: "T" }, { snow: { north: 1 }, markers: { m: { src: "modules/kg-realms-t/assets/poi-img/a.webp" } }, rules: { seasons: [] }, scenes: true });
  const world = JSON.parse(script.match(/registerWorld\((.*)\)\);/)[1]);
  assert.equal(world.module, "kg-realms-t");
  assert.equal(world.scenes, true);
  assert.deepEqual(world.snow, { north: 1 });
  assert.ok(world.markers.m); assert.ok(world.rules);
});
