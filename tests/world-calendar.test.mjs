import { test } from "node:test";
import assert from "node:assert/strict";
import { registerWorld } from "../scripts/worlds.mjs";
import { calendarForExport, calendarAction, calendarLabel, keepsOwnCalendar, startingDate, fileRef, exportReport } from "../scripts/homebrew/export-plan.mjs";
import { moduleScript } from "../scripts/homebrew/plan.mjs";
import { applyModuleCalendars } from "../scripts/homebrew/export.mjs";

const cal = (id, extra = {}) => ({ toObject: () => ({ name: id, metadata: { id }, months: { values: {} }, ...extra }) });
const manager = ({ custom = false, override = false } = {}) => ({ isCustomCalendar: () => custom, hasDefaultOverride: () => override });

test("the whole calendar is captured, whichever kind it is", () => {
  const plain = calendarForExport(cal("harptos"), manager(), { a: { gm: "x", player: "y" } });
  assert.equal(plain.kind, "built-in"); assert.equal(plain.id, "harptos"); assert.ok(plain.data.months); assert.ok(plain.displayFormats.a);
  assert.equal(calendarForExport(cal("harptos"), manager({ override: true })).kind, "edited");
  assert.equal(calendarForExport(cal("custom-trorune"), manager({ custom: true })).kind, "custom");
  assert.equal(calendarLabel(plain), "harptos (built-in)");
  assert.equal(calendarForExport(null, manager()), null);
});

test("what setting a calendar takes, given what the game world has", () => {
  const data = { months: {} }, there = { known: true, custom: false, override: false };
  assert.equal(calendarAction({ kind: "built-in", data }, there), "switch");
  assert.equal(calendarAction({ kind: "built-in" }, there), "switch", "a module may name a built-in one and nothing more");
  assert.equal(calendarAction({ kind: "edited", data }, there), "override");
  assert.equal(calendarAction({ kind: "built-in", data }, { ...there, override: true }), "override", "the GM's edits to it give way to the module's");
  assert.equal(calendarAction({ kind: "built-in", data }, { ...there, known: false }), "create", "a Calendaria without it still gets it");
  assert.equal(calendarAction({ kind: "built-in" }, { ...there, known: false }), "unknown");
  assert.equal(calendarAction({ kind: "custom", data }, { known: false, custom: false, override: false }), "create");
  assert.equal(calendarAction({ kind: "custom", data }, { known: true, custom: true, override: false }), "update");
});

test("Calendaria's own pictures stay linked; the module and report carry the calendar", () => {
  assert.equal(fileRef("modules/calendaria/assets/moon-phases/01_newmoon.svg").kind, "keep");
  assert.equal(fileRef("worlds/game/my-moon.webp").kind, "local");
  const world = JSON.parse(moduleScript("m", { id: "t", title: "T" }, { calendar: { file: "calendar.json", name: "Trorune", signature: 5 } }).match(/registerWorld\((.*)\)\);/)[1]);
  assert.deepEqual(world.calendar, { file: "calendar.json", name: "Trorune", signature: 5 });
  const report = (calendar) => exportReport({ title: "T", version: "1", moduleId: "m", counts: {}, calendar });
  assert.ok(report({ name: "Trorune", kind: "custom" }).includes("Calendar: Trorune (custom)"));
  assert.ok(report(null).includes("No calendar"));
});

function install({ active = true, known = ["gregorian", "harptos"], custom = {}, override = {}, makeFails = false } = {}) {
  const calls = [], settings = new Map([["calendarsApplied", {}]]), notes = { info: [], warn: [], error: [] };
  const gm = {};
  const files = new Map();
  globalThis.game = {
    user: gm, users: { activeGM: gm }, modules: { get: () => (active ? { active: true } : undefined) },
    settings: { get: (m, k) => settings.get(k), set: async (m, k, v) => { calls.push(["set", k]); settings.set(k, v); } }
  };
  globalThis.ui = { notifications: { info: (m) => notes.info.push(m), warn: (m) => notes.warn.push(m), error: (m) => notes.error.push(m) } };
  globalThis.foundry = { utils: { getRoute: (p) => `/${p}`, deepClone: (v) => structuredClone(v) }, applications: { settings: { SettingsConfig: { reloadConfirm: async (o) => { calls.push(["reload", o.world]); } } } } };
  globalThis.fetch = async (url) => { const b = files.get(String(url).replace(/^\//, "")); return b ? { ok: true, status: 200, json: async () => JSON.parse(b) } : { ok: false, status: 404 }; };
  globalThis.CALENDARIA = {
    api: { switchCalendar: async (id) => { calls.push(["switch", id]); return known.includes(id) || id.startsWith("custom-"); } },
    managers: { CalendarManager: {
      getCalendar: (id) => (known.includes(id) || custom[id] ? {} : null), isCustomCalendar: (id) => !!custom[id], hasDefaultOverride: (id) => !!override[id],
      createCustomCalendar: async (id, d) => { calls.push(["create", id]); return makeFails ? null : { metadata: { id: id.startsWith("custom-") ? id : `custom-${id}` } }; },
      updateCustomCalendar: async (id) => { calls.push(["update", id]); return {}; },
      saveDefaultOverride: async (id) => { calls.push(["override", id]); return {}; }
    } }
  };
  return { calls, settings, notes, files };
}
let n = 0;
const world = (calendar) => { const id = `cal${++n}`; registerWorld({ id, title: id.toUpperCase(), module: id, root: `modules/${id}/w`, calendar }); return id; };
const only = (id, settings) => settings.get("calendarsApplied")[id];

test("a custom calendar is added and set, its formats follow, and it is set only once", async () => {
  const { calls, settings, notes, files } = install();
  const id = world({ file: "calendar.json", name: "Trorune", signature: 7 });
  files.set(`modules/${id}/w/calendar.json`, JSON.stringify({ id: "custom-trorune", name: "Trorune", kind: "custom", data: { months: {} }, displayFormats: { a: 1 } }));
  await applyModuleCalendars();
  assert.deepEqual(calls.filter(([k]) => k !== "set" ).slice(0, 2), [["create", "custom-trorune"], ["switch", "custom-trorune"]]);
  assert.ok(calls.some(([k, v]) => k === "set" && v === "displayFormats"));
  assert.ok(calls.some(([k]) => k === "reload"), "Foundry reloads to finish");
  assert.equal(only(id, settings), "7");
  assert.equal(notes.error.length, 0);
  assert.ok(notes.info.some((m) => m.includes("Trorune")));
  calls.length = 0;
  await applyModuleCalendars();
  assert.equal(calls.length, 0, "a GM who changes calendar afterwards keeps their choice");
});

test("a new version of the module with a different calendar sets it again", async () => {
  const { calls, settings, files } = install({ custom: { "custom-t": {} } });
  const id = world({ file: "calendar.json", name: "T", signature: 8 });
  files.set(`modules/${id}/w/calendar.json`, JSON.stringify({ id: "custom-t", name: "T", kind: "custom", data: {} }));
  settings.set("calendarsApplied", { [id]: "7" });
  await applyModuleCalendars();
  assert.deepEqual(calls.slice(0, 2), [["update", "custom-t"], ["switch", "custom-t"]]);
});

test("a module naming a built-in calendar just switches to it, as Faerun's Harptos would", async () => {
  const { calls, settings, notes } = install();
  const id = world({ id: "harptos", name: "Harptos" });
  await applyModuleCalendars();
  assert.ok(calls.some(([k, v]) => k === "switch" && v === "harptos"));
  assert.ok(!calls.some(([k]) => k === "create" || k === "override"));
  assert.equal(only(id, settings), "harptos");
  assert.ok(!notes.error.some((m) => m.includes(id.toUpperCase())), "worlds of earlier tests are still registered: only this one counts");
});

test("without Calendaria the GM is told once; enabling it later sets the calendar", async () => {
  const first = install({ active: false });
  const id = world({ id: "harptos", name: "Harptos" });
  await applyModuleCalendars();
  assert.ok(first.notes.warn.some((m) => m.includes("Harptos") && m.includes("Enable Calendaria")));
  const count = first.notes.warn.length;
  await applyModuleCalendars();
  assert.equal(first.notes.warn.length, count, "not at every load");
  assert.equal(only(id, first.settings), "missing:harptos");

  const second = install();
  second.settings.set("calendarsApplied", { [id]: "missing:harptos" });
  await applyModuleCalendars();
  assert.ok(second.calls.some(([k, v]) => k === "switch" && v === "harptos"));
  assert.equal(only(id, second.settings), "harptos");
});

test("a calendar that cannot be set says why and tries again next load", async () => {
  const { calls, settings, notes, files } = install({ makeFails: true });
  const id = world({ file: "calendar.json", name: "T", signature: 9 });
  files.set(`modules/${id}/w/calendar.json`, JSON.stringify({ id: "custom-x", name: "T", kind: "custom", data: {} }));
  await applyModuleCalendars();
  assert.ok(notes.error.some((m) => m.includes(id.toUpperCase()) && m.includes("try again")));
  assert.notEqual(only(id, settings), "9");
  assert.ok(!calls.some(([k]) => k === "switch" ) || calls.filter(([k, v]) => k === "switch" && v === "custom-x").length === 0);
});

test("only the first GM sets it", async () => {
  const { calls } = install();
  world({ id: "harptos", name: "Harptos" });
  game.users.activeGM = {};
  await applyModuleCalendars();
  assert.equal(calls.length, 0);
});

test("the date goes with the calendar, and is used only where the clock has not started", () => {
  assert.equal(calendarForExport(cal("harptos"), manager(), null, 5000).worldTime, 5000);
  assert.equal(calendarForExport(cal("harptos"), manager(), null, 0).worldTime, undefined);
  assert.deepEqual(startingDate({ worldTime: 5000 }, 0), { worldTime: 5000 });
  assert.deepEqual(startingDate({ startYear: 1497 }, 0), { year: 1497 });
  assert.equal(startingDate({ startYear: 1497 }, 86400), null, "a date already set stays");
  assert.equal(startingDate({ worldTime: 5000 }, 86400), null);
  assert.equal(startingDate({}, 0), null);
});

test("a campaign running on another calendar keeps it; Calendaria's default gives way", () => {
  assert.equal(keepsOwnCalendar("custom-mine", "harptos", 86400), true);
  assert.equal(keepsOwnCalendar("harptos", "harptos", 86400), false, "already on it");
  assert.equal(keepsOwnCalendar("gregorian", "harptos", 86400), false, "the default was never chosen");
  assert.equal(keepsOwnCalendar("custom-mine", "harptos", 0), false, "nothing has happened on it yet");
});

function faerun({ active = "gregorian", worldTime = 0, year = -4, yearZero = 1501 } = {}) {
  const made = install();
  game.time = { worldTime, components: { year }, set: async (t) => { made.calls.push(["time", t]); game.time.worldTime = t; } };
  CALENDARIA.managers.CalendarManager.getActiveCalendar = () => ({ metadata: { id: active }, years: { yearZero } });
  CALENDARIA.api.jumpToDate = async (d) => { made.calls.push(["jump", d]); };
  return made;
}
const harptos = () => world({ id: "harptos", name: "Harptos", startYear: 1497 });

test("Faerun on a new game world: Harptos, year 1497", async () => {
  const { calls, notes } = faerun();
  harptos();
  await applyModuleCalendars();
  assert.ok(calls.some(([k, v]) => k === "switch" && v === "harptos"));
  const jump = calls.find(([k]) => k === "jump");
  assert.deepEqual(jump[1], { year: 1497, month: 1, day: 1 });
  assert.ok(calls.some(([k]) => k === "reload"));
  assert.ok(notes.info.some((m) => m.includes("Harptos, year 1497")));
  assert.equal(notes.warn.length, 0);
});

test("Faerun on a legacy install: its date and calendar stay, with no reload", async () => {
  const { calls, notes } = faerun({ active: "harptos", worldTime: 86400, year: -2 });
  const id = harptos();
  await applyModuleCalendars();
  const own = calls.filter(([k]) => ["switch", "jump", "time", "reload"].includes(k) );
  assert.deepEqual(own.filter(([k, v]) => k !== "switch" || v === "harptos"), [], "the date is set already");
  assert.ok(!notes.info.some((m) => m.includes(id.toUpperCase()) && m.includes("now")));
});

test("Faerun already on Harptos with the clock at zero gets year 1497, with no reload", async () => {
  const { calls } = faerun({ active: "harptos" });
  harptos();
  await applyModuleCalendars();
  assert.ok(calls.some(([k]) => k === "jump"));
});

test("a campaign already running on its own calendar is left alone, and told", async () => {
  const { calls, notes, settings } = faerun({ active: "custom-mine", worldTime: 86400 });
  const id = harptos();
  await applyModuleCalendars();
  assert.ok(!calls.some(([k, v]) => k === "switch" && v === "harptos"));
  assert.ok(notes.info.some((m) => m.includes(id.toUpperCase()) && m.includes("already running")));
  assert.equal(settings.get("calendarsApplied")[id], "harptos");
});

test("an exported date is set on a new game world", async () => {
  const { calls, files } = faerun();
  const id = world({ file: "calendar.json", name: "T", signature: 11 });
  files.set(`modules/${id}/w/calendar.json`, JSON.stringify({ id: "custom-z", name: "T", kind: "custom", data: {}, worldTime: 777 }));
  await applyModuleCalendars();
  assert.ok(calls.some(([k, v]) => k === "time" && v === 777));
});

test("a year Calendaria does not land on is reported, not silently wrong", async () => {
  const { notes } = faerun({ year: 0 });
  const id = harptos();
  await applyModuleCalendars();
  assert.ok(notes.warn.some((m) => m.includes(id.toUpperCase()) && m.includes("1497") && m.includes("1501")));
});
