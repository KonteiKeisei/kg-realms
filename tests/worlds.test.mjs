import { test } from "node:test";
import assert from "node:assert/strict";
import { registerWorld, worldDef, worldPath, worldRoot, assetModules, allWorlds } from "../scripts/worlds.mjs";
import { lodSrcAllowed } from "../scripts/local-map-lods.mjs";

test("a world's data lives in the module that registers it", () => {
  registerWorld({ id: "test-homebrew", title: "Homebrew", module: "kg-realms-homebrew" });
  assert.equal(worldRoot("test-homebrew"), "modules/kg-realms-homebrew/data/worlds/test-homebrew");
  assert.equal(worldPath("test-homebrew", "local/index.json"), "modules/kg-realms-homebrew/data/worlds/test-homebrew/local/index.json");
  assert.equal(worldDef("test-homebrew").title, "Homebrew");
  assert.ok(allWorlds().some((w) => w.id === "test-homebrew"));
});

test("an unregistered world falls back to the engine's own folder", () => {
  assert.equal(worldRoot("nowhere"), "modules/kg-realms/data/worlds/nowhere");
});

test("a world may name its own folder, and a bad id is refused", () => {
  registerWorld({ id: "test-rooted", module: "kg-realms-x", root: "worlds/mine/realm/" });
  assert.equal(worldPath("test-rooted", "index.json"), "worlds/mine/realm/index.json");
  assert.throws(() => registerWorld({ id: "../up" }));
});

test("settlement map tiles may come only from the engine or a registered world's module", () => {
  registerWorld({ id: "test-faerun", module: "kg-realms-faerun" });
  assert.ok(assetModules().has("kg-realms-faerun"));
  assert.equal(lodSrcAllowed("modules/kg-realms-faerun/assets/maps/ktx2/waterdeep/waterdeep-l0-0-0.ktx2", "waterdeep"), true);
  assert.equal(lodSrcAllowed("modules/kg-realms/assets/maps/ktx2/waterdeep/a.ktx2", "waterdeep"), true);
  assert.equal(lodSrcAllowed("modules/someone-else/assets/maps/ktx2/waterdeep/a.ktx2", "waterdeep"), false);
  assert.equal(lodSrcAllowed("modules/kg-realms-faerun/assets/maps/ktx2/luskan/a.ktx2", "waterdeep"), false);
});
