import { test } from "node:test";
import assert from "node:assert/strict";
import { awayHalts } from "../scripts/away-pause.mjs";
import { replayTrip } from "../scripts/travel.mjs";

test("leaving the realm map opens an away pause, coming back closes it, once each", () => {
  const left = awayHalts([], true, 1000);
  assert.deepEqual(left, [{ from: 1000, to: null, away: true }]);
  assert.equal(awayHalts(left, true, 1500), null, "already paused");
  const back = awayHalts(left, false, 4600);
  assert.deepEqual(back, [{ from: 1000, to: 4600, away: true }]);
  assert.equal(awayHalts(back, false, 5000), null, "already running");
});

test("a GM's own stop is left alone by the away pause", () => {
  const stopped = [{ from: 200, to: null }];
  const left = awayHalts(stopped, true, 1000);
  assert.equal(left.length, 2);
  const back = awayHalts(left, false, 3000);
  assert.deepEqual(back[0], { from: 200, to: null }, "the GM's stop stays open");
  assert.equal(back[1].to, 3000);
});

test("time away does not move the party: the journey carries on as if none had passed", () => {
  const plan = { hours: 10, legs: [], encounters: [], stays: [] };
  const hour = 3600;
  const trip = (halts) => ({ departed: 0, decisions: [], resumed: {}, halts });
  const before = replayTrip(trip([]), plan, 2 * hour, { hoursPerDay: 8 });
  const away = replayTrip(trip([{ from: 2 * hour, to: null, away: true }]), plan, 6 * hour, { hoursPerDay: 8 });
  assert.equal(away.status, "halted"); assert.equal(away.away, true);
  assert.ok(Math.abs(away.hour - before.hour) < 1e-6, "no progress while away");
  const back = replayTrip(trip([{ from: 2 * hour, to: 6 * hour, away: true }]), plan, 7 * hour, { hoursPerDay: 8 });
  assert.ok(Math.abs(back.hour - 3) < 1e-6, `three hours travelled in all (${back.hour})`);
});
