import { test } from "node:test";
import assert from "node:assert/strict";

// The panel drawn for real, in every state of a journey, with Foundry stood in for.
const flags = {};
const scene = { id: "s", partyId: null, getFlag: (_, k) => flags[k], setFlag: async () => {}, tokens: [], grid: { size: 100 }, realScene: null };
const el = () => { const e = { innerHTML: "", hidden: false, style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, contains: () => false, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {}, append() {}, remove() {}, setAttribute() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 700 }), scrollTop: 0, offsetWidth: 360, offsetHeight: 700 }; return e; };
globalThis.foundry = { utils: { escapeHTML: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;"), randomID: () => "id", deepClone: (x) => structuredClone(x), getRoute: (x) => x } };
globalThis.game = { user: { isGM: true, id: "u", active: true }, users: [], settings: { get: () => undefined, set: async () => {}, register() {} }, time: { worldTime: 0 }, i18n: { localize: (x) => x }, scenes: { get: () => null }, modules: { get: () => ({ version: "0" }) } };
globalThis.ui = { notifications: { info() {}, warn() {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, callAll() {} };
globalThis.window = globalThis.window ?? { innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1 };
globalThis.document = globalThis.document ?? { createElement: el, body: el(), activeElement: null, addEventListener() {}, querySelector: () => null, getElementById: () => null };
globalThis.localStorage = globalThis.localStorage ?? { getItem: () => null, setItem() {} };
globalThis.canvas = { scene, tokens: { placeables: [] }, stage: { scale: { x: 1 } } };

const { TravelHud } = await import("../scripts/ui-hud.mjs");
const { setSourceMap } = await import("../scripts/source-map.mjs").catch(() => ({}));

const at = (x) => [x, 100];
const places = [{ id: "a", name: "Arine", lon: 0, lat: 0, port: true, kind: "settlement" }, { id: "w", name: "Wakeflow", lon: 10, lat: 0, port: true, kind: "settlement" }, { id: "k", name: "Karackas", lon: 20, lat: 0, port: true, kind: "settlement" }];
const seaPlan = { legs: [{ kind: "river", name: "Oban", miles: 50, hours: 10, pts: [] }, { kind: "sea", miles: 950, hours: 475, pts: [] }], miles: 1000, hours: 485 };
const sheet = {
  nodes: [{ name: "Arine", at: at(0), miles: 0, hour: 0, stop: 0 }, { name: "Brusel", at: at(5), miles: 500, hour: 240 }, { name: "Wakeflow", at: at(10), miles: 1000, hour: 485, stop: 1 }, { name: "Karackas", at: at(20), miles: 1500, hour: 1000, stop: 2 }],
  segments: [{ leg: 0, kind: "sea", via: "Open sea", miles: 500, hours: 240 }, { leg: 0, kind: "sea", via: "Open sea", miles: 500, hours: 245 }, { leg: 1, kind: "road", via: "King's Road", miles: 500, hours: 515 }]
};
const result = {
  legs: [{ from: at(0), to: at(10), plan: seaPlan, miles: 1000, hours: 485, start: 0, sea: true }, { from: at(10), to: at(20), plan: { legs: [{ kind: "road", miles: 500, hours: 515 }], miles: 500, hours: 515 }, miles: 500, hours: 515, start: 485, sea: false }],
  legEnds: [485, 1000], miles: 1500, hours: 1000, ground: { road: 500, trail: 0, offroad: 0, water: 1000 }, track: [{ at: at(0), hour: 0, leg: 0 }, { at: at(10), hour: 485, leg: 0 }, { at: at(20), hour: 1000, leg: 1 }], days: [], path: [], sail: []
};
const wps = [{ lon: 10, lat: 0, name: "Wakeflow", stop: true, bypassed: [{ lon: 5, lat: 0, name: "Brusel" }] }, { lon: 20, lat: 0, name: "Karackas", stop: true }];
const encounter = { id: "e", name: "Big Owlbear", dc: 14, kind: "encounter", actors: [], images: [] };
const states = {
  moving: { status: "moving", hour: 100, dayHours: 5 }, sailing: { status: "moving", hour: 100, sailing: true }, stay: { status: "stay", hour: 485, until: 3600 }, halted: { status: "halted", hour: 300 }, away: { status: "halted", hour: 300, away: true },
  town: { status: "encounter", hour: 485, encounter: { id: "t", kind: "town", name: "Wakeflow", sceneId: "x" } }, encounter: { status: "encounter", hour: 100, encounter }, campEnc: { status: "encounter", hour: 100, camp: true, encounter },
  decide: { status: "decide", hour: 100, limit: 8, night: 1 }, resting: { status: "resting", hour: 100, night: 1, until: 3600 }, arrived: { status: "arrived", hour: 1000 }
};
const newHud = (over = {}) => {
  const hud = new TravelHud({ getLayer: () => null, getPlaces: () => places, getRoutes: () => ({ features: [] }), getEncounters: () => [], getTerrain: async () => null, getWaterways: () => ({}), getSeason: () => "summer", ...over });
  hud.el = el(); hud.plan = { encounters: [], stops: [], segments: [] }; hud.result = result; hud.sheet = sheet; hud.trackMiles = [0, 1000, 1500];
  hud.camp = { stage: (p) => ({ decide: "decide", resting: "night" }[p?.status] ?? (p?.camp ? "night" : null)), html: () => "<div>camp</div>", phaseStatus: () => ({ label: "Camped" }), watchChanged() {}, renderScene() {}, decorate() {} };
  hud.seaNodes = new Map([[0, "Port of Arine: sea travel available"]]);
  hud.legChoices = [{ land: { miles: 1200, hours: 600 }, boat: [{ key: "sea", plan: seaPlan }, { key: "both", plan: seaPlan }], vessel: { crewed: true, mph: 2 } }, null];
  hud.riverOffers = [{ leg: 1, river: { name: "Oban" }, at: at(15), landMiles: 400, landHours: 100, plan: { miles: 49, hours: 12 } }];
  hud.shipHints = []; hud.openLegs = new Set([0, 1]); hud.openPlaces = new Set([0]);
  hud.members = () => []; hud.party = () => []; hud.speed = () => ({ feet: 30, who: "Pikle", burden: "", burdened: [] }); hud.currentBiome = () => ({ name: "Plains" }); hud.favoredTerrains = () => [];
  return hud;
};

const draw = (hud, progress) => { hud.progress = () => progress; hud.panelHtml = null; hud.render(); return hud.el.innerHTML; };

for (const gm of [true, false]) test(`the panel draws in every state of a journey (${gm ? "GM" : "player"})`, () => {
  game.user.isGM = gm;
  flags.journey = { waypoints: wps, stays: [2, 0], legModes: ["sea", null], start: { lon: 0, lat: 0, name: "Arine" }, trip: { started: 0 } };
  for (const [name, p] of Object.entries(states)) {
    const html = draw(newHud(), p);
    assert.ok(html.includes('class="body"'), name);
    if (gm) assert.ok(html.includes('class="tr-pin"'), name + " has its pinned part");
    assert.ok(!html.includes("undefined"), `${name} shows undefined`);
    assert.ok(!html.includes("NaN"), `${name} shows NaN`);
  }
});

test("each state puts the right thing in the pinned part", () => {
  game.user.isGM = true;
  flags.journey = { waypoints: wps, stays: [0, 0], legModes: ["sea", null], start: { lon: 0, lat: 0, name: "Arine" }, trip: { started: 0 } };
  const pinned = (p) => { const h = draw(newHud(), p); return h.slice(h.indexOf('class="tr-pin"')); };
  assert.match(pinned(states.moving), /Pause travel[\s\S]*/);
  assert.match(pinned(states.moving), /Skip to next camp/);
  assert.match(pinned(states.moving), /as time moves on/);
  assert.match(pinned(states.sailing), /No camp while the crew sails on/);
  assert.match(pinned(states.town), /Stop in Wakeflow/);
  assert.match(pinned(states.encounter), /Conclude Encounter/);
  assert.match(pinned(states.halted), /Resume travel/);
  assert.match(pinned(states.arrived), /New journey/);
  assert.match(pinned(states.decide), /camp/);
  assert.doesNotMatch(pinned(states.resting), /Pause travel/);
});

test("before setting off: Start travel, and what it does; with no route, where to", () => {
  game.user.isGM = true;
  flags.journey = { waypoints: wps, stays: [0, 0], legModes: ["sea", null], start: { lon: 0, lat: 0, name: "Arine" } };
  const planned = draw(newHud(), null);
  assert.match(planned, /Not started/); assert.match(planned, /Start travel/); assert.match(planned, /move time on/); assert.match(planned, /The journey/);
  assert.match(planned, /Sea route|River and sea/); assert.match(planned, /Bypass|Brusel/); assert.match(planned, /The road crosses the river Oban/);
  flags.journey = { waypoints: [], stays: [], start: { lon: 0, lat: 0, name: "Arine" } };
  const hud = newHud(); hud.result = null; hud.sheet = null; hud.stops = () => [{ lon: 0, lat: 0, name: "Arine" }];
  const empty = draw(hud, null);
  assert.match(empty, /Where to\?/); assert.match(empty, /Pick on the map/); assert.match(empty, /Choose where to go/);
  assert.doesNotMatch(empty, /Start travel<\/button>/);
});

test("a player following progress does not see the stops ahead", () => {
  game.user.isGM = false;
  flags.journey = { waypoints: wps, stays: [0, 0], legModes: ["sea", null], show: "progress", start: { lon: 0, lat: 0, name: "Arine" }, trip: { started: 0 } };
  const html = draw(newHud(), states.moving);
  assert.doesNotMatch(html, /Karackas|Wakeflow/); assert.doesNotMatch(html, /Next:/);
  game.user.isGM = true;
});

test("a route point shows, closed or open, above the stop it leads to", () => {
  game.user.isGM = true;
  flags.journey = { waypoints: [{ lon: 5, lat: 0, name: "Near Valdoram" }, { lon: 10, lat: 0, name: "Wakeflow", stop: true }, { lon: 20, lat: 0, name: "Karackas", stop: true }], stays: [0, 0, 0], legModes: [null, null, null], start: { lon: 0, lat: 0, name: "Arine" } };
  const two = { ...sheet, nodes: sheet.nodes.map((n) => (n.stop > 0 ? { ...n, stop: n.stop + 1 } : n)) };
  for (const open of [[], [0]]) {
    const hud = newHud(); hud.sheet = two; hud.openLegs = new Set(open);
    const html = draw(hud, null), point = html.indexOf("Near Valdoram"), stop = html.indexOf('<b title="Wakeflow"'), next = html.indexOf('<b title="Karackas"');
    assert.ok(point >= 0 && point < stop && stop < next, "in order: " + [point, stop, next]);
    assert.ok(html.includes('aria-label="Remove this route point"'));
    assert.ok(!html.includes("route points</button>"), "not folded away");
  }
});
