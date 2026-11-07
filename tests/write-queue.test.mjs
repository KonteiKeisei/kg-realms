import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { writeQueue } from "../scripts/write-queue.mjs";

// A world setting read, changed and written whole, with a slow server round trip.
function fakeSetting() {
  let value = {};
  return {
    get: () => structuredClone(value),
    set: async (next) => { await new Promise((r) => setTimeout(r, 5)); value = structuredClone(next); }
  };
}
const save = (setting, key) => async () => { const all = setting.get(); all[key] = true; await setting.set(all); };

test("overlapping saves through the queue keep every change", async () => {
  const setting = fakeSetting(), queue = writeQueue();
  await Promise.all([queue(save(setting, "a")), queue(save(setting, "b")), queue(save(setting, "c"))]);
  assert.deepEqual(setting.get(), { a: true, b: true, c: true });
});

test("without the queue the same saves lose changes (the race the queue prevents)", async () => {
  const setting = fakeSetting();
  await Promise.all([save(setting, "a")(), save(setting, "b")()]);
  assert.notDeepEqual(setting.get(), { a: true, b: true });
});

test("each caller gets its own result or error, and a failure does not stop later saves", async () => {
  const setting = fakeSetting(), queue = writeQueue();
  const failed = queue(async () => { throw new Error("server refused"); });
  const after = queue(async () => { await save(setting, "after")(); return "saved"; });
  await assert.rejects(failed, /server refused/);
  assert.equal(await after, "saved");
  assert.deepEqual(setting.get(), { after: true });
});

test("a save queued while another runs starts only after it finishes", async () => {
  const queue = writeQueue(), order = [];
  const first = queue(async () => {
    order.push("first start");
    // As a setting's onChange does: start another save without waiting for it.
    queue(async () => { order.push("second"); });
    await new Promise((r) => setTimeout(r, 5));
    order.push("first end");
  });
  await first;
  await queue(async () => {});
  assert.deepEqual(order, ["first start", "first end", "second"]);
});

test("place, road and waterway saves in main.mjs go through their queues", () => {
  const src = fs.readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(src, /function saveEdits\(world, fn\) \{\s*return placeWrites\(/);
  assert.match(src, /function saveRouteEdits\(world, fn\) \{\s*return routeWrites\(/);
  assert.match(src, /function saveWaterways\(world, fn\) \{\s*return waterwayWrites\(/);
});
