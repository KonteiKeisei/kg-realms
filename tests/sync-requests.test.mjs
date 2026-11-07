import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { requestCoalescer } from "../scripts/sync-requests.mjs";

// A fake clock: schedule() runs callbacks when tick() passes their time.
function clock() {
  let t = 0; const due = [];
  return {
    now: () => t,
    schedule: (fn, ms) => { due.push({ at: t + ms, fn }); },
    tick(ms) { t += ms; for (const d of due.filter((d) => d.at <= t)) { due.splice(due.indexOf(d), 1); d.fn(); } },
    pending: () => due.length
  };
}

test("a burst of requests gives one answer at once and one follow-up when the window ends", () => {
  const c = clock(), calls = [];
  const ask = requestCoalescer((...a) => calls.push([c.now(), ...a]), { windowMs: 2000, now: c.now, schedule: c.schedule });
  ask("u1:s1", "u1", "s1");
  assert.deepEqual(calls, [[0, "u1", "s1"]], "the first is answered at once");
  for (let i = 0; i < 10; i++) { c.tick(100); ask("u1:s1", "u1", "s1"); }
  assert.equal(calls.length, 1, "the rest wait");
  assert.equal(c.pending(), 1, "as one follow-up");
  c.tick(1000);
  assert.deepEqual(calls.map(([t]) => t), [0, 2000], "answered when the window ends");
  assert.equal(c.pending(), 0);
});

test("nothing is dropped: a request inside the follow-up's window gets its own follow-up", () => {
  const c = clock(), calls = [];
  const ask = requestCoalescer(() => calls.push(c.now()), { windowMs: 2000, now: c.now, schedule: c.schedule });
  ask("k"); c.tick(500); ask("k"); c.tick(1500);
  assert.deepEqual(calls, [0, 2000]);
  c.tick(100); ask("k");
  assert.deepEqual(calls, [0, 2000], "inside the new window: waits");
  c.tick(1900);
  assert.deepEqual(calls, [0, 2000, 4000]);
});

test("a quiet request after the window is answered at once; players and scenes are separate", () => {
  const c = clock(), calls = [];
  const ask = requestCoalescer((k) => calls.push([c.now(), k]), { windowMs: 2000, now: c.now, schedule: c.schedule });
  ask("u1:s1", "u1:s1"); ask("u2:s1", "u2:s1"); ask("u1:s2", "u1:s2");
  assert.equal(calls.length, 3, "different players or scenes never wait on each other");
  c.tick(5000); ask("u1:s1", "u1:s1");
  assert.deepEqual(calls.at(-1), [5000, "u1:s1"]);
  assert.equal(c.pending(), 0);
});

test("the follow-up uses the latest request's arguments", () => {
  const c = clock(), calls = [];
  const ask = requestCoalescer((v) => calls.push(v), { windowMs: 2000, now: c.now, schedule: c.schedule });
  ask("k", 1); ask("k", 2); ask("k", 3); c.tick(2000);
  assert.deepEqual(calls, [1, 3]);
});

test("the GM answers players' sync requests through the coalescer, checking again when answering", () => {
  const src = fs.readFileSync(new URL("../scripts/main.mjs", import.meta.url), "utf8");
  assert.match(src, /const answerSync = requestCoalescer\(\(userId, sceneId\) => \{[^}]*isPrimaryGM\(\) && user\?\.active && scene && regionOf\(scene\)\) syncJourney\(scene, \{ force: true \}\)/);
  assert.match(src, /answerSync\(`\$\{from\}:\$\{m\.scene\}`, from, m\.scene\)/);
});
