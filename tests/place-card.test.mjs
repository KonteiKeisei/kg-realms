import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEdits } from "../scripts/places.mjs";
import {placeLayer} from '../scripts/map-layers.mjs';

test('legacy area labels preserve kinds, coordinates, borders and links without rewriting saved records',()=>{
  const base=[{id:'territory',name:'North',class:'Region',kind:'territory',lon:1,lat:2,area:[[0,0],[1,0],[1,1]],scene:'detail'},{id:'natural',name:'The Steppes',class:'Macroregion',kind:'natural',kindChosen:true,lon:3,lat:4},{id:'domain',name:'Kingdom',class:'Kingdom',kind:'domain',lon:5,lat:6}];
  const edits={edits:{territory:{lon:10}},added:{}},before=structuredClone({base,edits});
  const out=applyEdits(base,edits);
  assert.equal(out[0].class,'Area');assert.equal(out[0].kind,'territory');assert.equal(out[0].lon,10);assert.equal(out[0].scene,'detail');assert.deepEqual(out[0].area,base[0].area);
  assert.equal(out[1].class,'Area');assert.equal(out[1].kind,'natural');assert.equal(placeLayer(out[1]),'geo');
  assert.equal(out[2].class,'Kingdom');assert.equal(out[2].kind,'domain');assert.equal(placeLayer({class:'Area'}),'realms');
  assert.deepEqual({base,edits},before);
});

test("a place's visibility: Hidden, Rumoured or Discovered, with older hidden edits still hidden", () => {
  const base = [{ id: "a", name: "Neverwinter", hidden: true }, { id: "b", name: "Port Llast" }, { id: "c", name: "Saltmarsh" }, { id: "d", name: "Luskan" }];
  const out = applyEdits(base, { edits: { b: { hidden: true }, c: { visibility: "rumoured" }, d: { visibility: "hidden", hidden: true } } });
  const by = Object.fromEntries(out.map((p) => [p.id, p]));
  // The atlas's own hidden flag does not hide a place: only the GM's edits do.
  assert.equal(by.a.hidden, false);
  assert.equal(by.a.visibility, "discovered");
  assert.equal(by.b.visibility, "hidden");
  assert.equal(by.b.hidden, true);
  assert.equal(by.c.visibility, "rumoured");
  assert.equal(by.c.hidden, false, "a rumoured place is on the map for players");
  assert.equal(by.d.hidden, true);
});

test("hover text shows content links as their names, not their @UUID code", async () => {
  globalThis.foundry = { utils: { escapeHTML: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;") } };
  globalThis.fromUuidSync = (uuid) => (uuid === "Actor.oJWYxRaEGomhZ7cR" ? { name: "Jarlaxle Baenre", documentName: "Actor" } : null);
  const { excerptHtml, inlineLinks } = await import("../scripts/place-card.mjs");
  const text = "A headquarters for @UUID[Actor.oJWYxRaEGomhZ7cR]{Jarlaxle Baenre's} Bregan D'aerthe, near @Actor[oJWYxRaEGomhZ7cR].";
  const out = excerptHtml(text, true);
  assert.ok(!out.includes("@UUID") && !out.includes("@Actor"), out);
  assert.ok(out.includes('<span class="kgr-link"><i class="fa-solid fa-user"></i>Jarlaxle Baenre&#39;s</span>') || out.includes("Jarlaxle Baenre's</span>"), out);
  assert.ok(out.includes("<i class=\"fa-solid fa-user\"></i>Jarlaxle Baenre</span>"), "a link without a label takes the document's name");
  assert.ok(inlineLinks("<p>See @UUID[JournalEntry.x.JournalEntryPage.y]{the docks}</p>").includes('fa-book-open"></i>the docks</span>'));
  // Long text is cut, never inside a link.
  const long = excerptHtml(`${"word ".repeat(70)}@UUID[Actor.oJWYxRaEGomhZ7cR]{Jarlaxle}`, true);
  assert.ok(long.endsWith("…") && !long.includes("@UUID"));
  delete globalThis.foundry; delete globalThis.fromUuidSync;
});

test("card text: plain text becomes paragraphs, HTML stays, journal text becomes a GM-only secret block", async () => {
  globalThis.foundry = { utils: { escapeHTML: (s) => String(s).replace(/</g, "&lt;"), randomID: () => "abc123" } };
  const { asHtml, asSecret } = await import("../scripts/place-card.mjs");
  assert.equal(asHtml("One.\n\nTwo < three"), "<p>One.</p><p>Two &lt; three</p>");
  assert.equal(asHtml("<p>Kept</p>"), "<p>Kept</p>");
  assert.equal(asHtml(""), "");
  assert.equal(asSecret("<p>Menu</p>"), '<section class="secret" id="secret-abc123"><p>Menu</p></section>');
  assert.equal(asSecret(""), "");
  delete globalThis.foundry;
});
