import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseHTML } from "linkedom";

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const required = () => [...read("tools/package.py").match(/REQUIRED_MEDIA = \[([\s\S]*?)\]/)[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

test("every media file the module loads is on the packager's required list", () => {
  const list = required(), ride = read("scripts/city/ride-view.mjs");
  // The carriage ride builds its pictures' names: city-carriage-<view>.jpg for each view.
  assert.match(ride, /const media='modules\/kg-realms\/assets\/media\/'/);
  assert.match(ride, /for\(const view of \['passenger','driver'\]\)/);
  assert.match(ride, /\$\{media\}city-carriage-\$\{view\}\.jpg/);
  for (const view of ["passenger", "driver"]) assert.ok(list.includes(`assets/media/city-carriage-${view}.jpg`), view);
  // Any other media path named in the code must be required too.
  for (const f of fs.readdirSync(new URL("../scripts/", import.meta.url), { recursive: true }).filter((f) => f.endsWith(".mjs"))) {
    for (const m of read(`scripts/${f}`).matchAll(/assets\/media\/([\w.-]+\.\w+)/g)) assert.ok(list.includes(`assets/media/${m[1]}`), `${f}: ${m[1]}`);
  }
});

test("the required pictures are in this checkout and kept by git", () => {
  for (const m of required()) assert.ok(fs.existsSync(new URL(`../${m}`, import.meta.url)), m);
  const ignore = read(".gitignore");
  assert.match(ignore, /^!assets\/media\/city-carriage-driver\.jpg$/m);
  assert.match(ignore, /^!assets\/media\/city-carriage-passenger\.jpg$/m);
});

test("the watch background and its bundled video are gone", () => {
  for (const f of ["scripts/main.mjs", "scripts/ui-camp.mjs", "styles/realms.css", "tools/package.py"]) {
    assert.doesNotMatch(read(f), /kgrestbg|watchBackground|wb-bg|with-bg/, f);
  }
  assert.doesNotMatch(read("tools/package.py"), /assets\/media\/\*\.webm/);
});

test("the watch change banner still shows, with no background behind it", async () => {
  const { document, window } = parseHTML("<html><body><div id='board'></div></body></html>");
  Object.assign(globalThis, { document, getComputedStyle: () => ({ zIndex: "0" }), foundry: { utils: { escapeHTML: (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`) } } });
  globalThis.window ??= window;
  const { showBanner } = await import("../scripts/ui-camp.mjs");
  showBanner({ n: 2, total: 4, name: "Mira", img: "mira.webp", when: "at 2 am", line: "Quiet", colour: "#c80", ticks: ["8 pm", "6 am"], parts: [], nowAt: 0.4 });
  const el = document.querySelector(".kgr-watch-banner");
  assert.ok(el, "the banner is shown");
  assert.match(el.textContent, /Watch 2 of 4/);
  assert.equal(el.querySelector("video, .wb-bg"), null);
});
