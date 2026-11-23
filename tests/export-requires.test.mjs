// An exported world module requires the oldest KG Realms that reads it, a released version, never the
// version that happened to export it: a module exported from a test build (0.97.2-harvest-test) was
// switched off by Foundry on every released KG Realms below it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../scripts/homebrew/export.mjs", import.meta.url), "utf8");
const changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const reads = /export const EXPORT_READS_FROM = "([^"]+)";/.exec(src)?.[1];

test("the export requires a fixed, released KG Realms version", () => {
  assert.match(reads ?? "", /^\d+\.\d+\.\d+$/, "a plain release number, no test suffix");
  assert.ok(changelog.includes(`## ${reads}:`), `${reads} is a release in the changelog`);
});

test("the exporting version is not written as the requirement", () => {
  const manifest = src.slice(src.indexOf("// The module."), src.indexOf("const sceneTemplates=sceneTemplateCatalog"));
  assert.match(manifest, /const minimum = hasOptionalSceneBehaviors.*\? "0\.99\.4" : EXPORT_READS_FROM;/);
  assert.ok(!/kg\??\.version/.test(manifest), "no kg.version in the manifest's requirement");
});
