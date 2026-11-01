import { test } from "node:test";
import assert from "node:assert/strict";
import { CampPanel } from "../scripts/ui-camp.mjs";

function preview(isGM = true) {
  globalThis.foundry = { utils: { escapeHTML: (s) => s, randomID: () => "fresh-camp" } };
  globalThis.game = { user: { id: "gm", isGM }, users: [{ id:"gm",isGM:true,active:true }], settings: { get: () => true }, modules: new Map(),
    time: { calendar: { timeToComponents: (t) => ({ hour: Math.floor(t / 3600) % 24, minute: 0 }) } } };
  const state = { rest: 16, watch: {} }, renders = [];
  const hud = { state, leader: true, clock: 18 * 3600, members: () => [], ruleText: () => ({ forced: "Travel rule" }),
    progress: () => ({ night: 2 }), render: () => renders.push(true) };
  return { panel: new CampPanel(hud), state, renders };
}

test("the rest choice shows one-hour travel and keeps GM actions off the player view", () => {
  const { panel } = preview();
  const p = { status: "decide", night: 2, limit: 8, dayHours: 8, since: 18 * 3600 };
  const html = panel.html(p);
  assert.match(html, /Push on for 1 hour/);
  assert.match(html, /Constitution save DC 11/);
  assert.match(html, /Ready at 10:00/);
  assert.match(html, /Setup/);assert.match(html, /Rest and watches/);assert.match(html, /Break camp/);
  assert.doesNotMatch(panel.html({ ...p, limit: 4 }), /Forced march: Constitution save DC/);
  game.user.isGM = false;
  const player = panel.html(p);
  assert.doesNotMatch(player, /data-act="push"|data-camp="setup"|name="rest"/);
});

test("browsing setup stages stays local and each new camp starts at the first setup stage", async () => {
  const { panel, state, renders } = preview(false);
  const before = structuredClone(state);
  await panel.click({ dataset: { camp: "view", view: "watches" } });
  assert.equal(panel.setupView, "watches");
  assert.equal(renders.length, 1);
  assert.deepEqual(state, before);
  game.user.isGM = true;
  let written;
  panel.write = async (changes) => { written = changes; };
  panel.setupView = "night";
  await panel.click({ dataset: { camp: "setup" } });
  assert.equal(panel.setupView, "tasks");
  assert.equal(written.phases.setup,4);assert.equal(written.phases.sleep,8);assert.equal(written.phases.pack,4);assert.equal(written.phases.campId,"fresh-camp");
  assert.deepEqual(written.checks,{night:2,campId:"fresh-camp"});assert.deepEqual(written.reveals,{});assert.equal(written.recovery,null);
});

test("a prior camp scene cannot bypass fresh setup when a journey reuses its night number",()=>{
  const {panel,state}=preview();
  state.watch={setup:2,campId:"old",scene:{night:2,step:"done"},checks:{night:2,campId:"old",forage:{done:true}}};
  const html=panel.html({status:"decide",night:2,since:18*3600,limit:8,dayHours:8});
  assert.match(html,/data-camp="setup"/);assert.doesNotMatch(html,/data-act="camp"/);
  state.watch.scene.step="w0";
  assert.match(panel.html({status:"decide",night:2,since:18*3600,limit:8,dayHours:8}),/data-camp="setup"/);
});
