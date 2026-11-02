import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const scripts = (dir) => readdirSync(new URL("../" + dir, import.meta.url), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? scripts(dir + "/" + e.name) : e.name.endsWith(".mjs") ? [dir + "/" + e.name] : []);

test("one fold symbol everywhere: drawn on every summary, and no other", () => {
  const css = read("styles/realms.css");
  assert.ok(css.includes('.kgr-ui summary::before { content: "\\f0da"'));
  assert.ok(css.includes(".kgr-ui details[open] > summary::before { transform: rotate(90deg); }"));
  assert.equal(css.match(/summary::before/g).length, 2, "those two rules alone: nothing draws its own, like + and -");
  for (const f of scripts("scripts")) {
    const t = read(f);
    assert.ok(!/<summary[^>]*><i class="fa-solid fa-(caret|chevron)/.test(t), f + " draws its own on a summary");
  }
});

test("a fold button uses the same caret, right when shut and down when open", () => {
  const shell = read("scripts/ui-shell.mjs");
  assert.ok(shell.includes('fa-caret-${open ? "down" : "right"}'));
  const ride = read("scripts/city/ride-view.mjs");
  assert.ok(!ride.includes("fa-chevron-up") && !ride.includes("fa-chevron-down"));
});
