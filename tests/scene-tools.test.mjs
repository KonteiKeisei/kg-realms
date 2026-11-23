import test from "node:test";
import assert from "node:assert/strict";
import { sceneEditorTools } from "../scripts/scene-tools.mjs";

test("Realms adds one group and leaves native controls alone", () => {
  const native = { select: { name: "select" } };
  const controls = { tokens: { tools: native }, notes: { tools: {} } };
  const scene = { id: "realm" };
  let editing = false;
  sceneEditorTools(controls, { scene, isGM: true, map: true, canTravel: true, edit: on => { editing = on; } });
  assert.equal(controls.tokens.tools, native);
  assert.deepEqual(controls.notes.tools, {});
  assert.deepEqual(Object.keys(controls.kgRealms.tools), ["travel", "edit", "search"]);
  controls.kgRealms.tools.edit.onChange({}, true);
  assert.equal(editing, true);
});

test("tools are scoped by scene and permissions", () => {
  const scene = { id: "scene" }, controls = {};
  sceneEditorTools(controls, { scene, isGM: true });
  assert.equal(controls.kgRealms, undefined);
  sceneEditorTools(controls, { scene, map: true, isGM: false, canTravel: true });
  assert.deepEqual(Object.keys(controls.kgRealms.tools), ["travel", "search"]);
  sceneEditorTools(controls, { scene, map: true, isGM: true, canTravel: false, challenge() {} });
  assert.deepEqual(Object.keys(controls.kgRealms.tools), ["edit", "search", "challenge"]);
  sceneEditorTools(controls, { scene, isGM: true, challenge() {} });
  assert.deepEqual(Object.keys(controls.kgRealms.tools), ["challenge"]);
});
