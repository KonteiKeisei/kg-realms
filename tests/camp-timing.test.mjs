import { test } from "node:test";
import assert from "node:assert/strict";
import { replayTrip } from "../scripts/travel.mjs";
import { CampPanel } from "../scripts/ui-camp.mjs";

const stopped = 6.5 * 3600, clicked = (18 * 60 + 39) * 60;
const plan = { hours: 40, encounters: [], stays: [] };
const trip = (decision) => ({ departed: stopped - 8 * 3600, decisions: [decision], resumed: {}, halts: [] });

test("an evening rest begins when selected, rather than at the morning travel stop", () => {
  const p = replayTrip(trip({ rest: 16, started: clicked }), plan, clicked);
  assert.equal(p.status, "resting");assert.equal(p.since, clicked);
  assert.equal(p.until, 86400 + (10 * 60 + 39) * 60);
  assert.equal(p.until - p.since, 16 * 3600);
});

test("older saved camps retain their recorded schedule until explicitly changed", () => {
  const p = replayTrip(trip({ rest: 16 }), plan, clicked);
  assert.equal(p.since, stopped);assert.equal(p.until, 22.5 * 3600);
});

test("a rest start cannot move before the travel stop or begin before its recorded time", () => {
  const early = replayTrip(trip({ rest: 16, started: stopped - 3600 }), plan, stopped + 1);
  assert.equal(early.since, stopped);
  const before = replayTrip(trip({ rest: 16, started: clicked }), plan, clicked - 3600);
  assert.equal(before.status, "decide");assert.equal(before.until, clicked);
});

test("a camp encounter extends the actual rest end by the time held", () => {
  const t = trip({ rest: 16, started: clicked });
  t.resumed.e = clicked + 5 * 3600;
  const p = replayTrip(t, { ...plan, encounters: [{ id: "e", hour: 8, rest: { night: 1, at: 4 } }] }, clicked + 6 * 3600);
  assert.equal(p.since, clicked);assert.equal(p.until, clicked + 17 * 3600);
});

test("camp setup previews the current-time start and includes the next day's date", () => {
  globalThis.foundry={utils:{escapeHTML:String}};
  globalThis.game={user:{isGM:true},settings:{get:()=>false},modules:new Map()};
  const hud={state:{rest:16,watch:{}},clock:clicked,members:()=>[],ruleText:()=>({forced:""}),
    dateText:t=>`Day ${Math.floor(t/86400)+1}, ${String(Math.floor(t/3600)%24).padStart(2,"0")}:${String(Math.floor(t/60)%60).padStart(2,"0")}`};
  const html=new CampPanel(hud).html({status:"decide",night:1,since:stopped,limit:8,dayHours:8});
  assert.match(html,/Camp ends at Day 2, 10:39/);assert.doesNotMatch(html,/22:30/);
});
