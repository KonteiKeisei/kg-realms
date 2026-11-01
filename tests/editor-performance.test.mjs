import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditorFrame} from '../scripts/editor-frame.mjs';
import {TravelHud} from '../scripts/ui-hud.mjs';
import {gmGame, testScene} from './helpers/journey.mjs';

test('pointer previews coalesce to one frame, flush the final state, and cancel on close',()=>{
  const callbacks=new Map();let serial=0,draws=0,latest=0,painted;
  const frame=new EditorFrame(()=>{draws++;painted=latest;},fn=>{callbacks.set(++serial,fn);return serial;},id=>callbacks.delete(id));
  for(let i=1;i<=200;i++){latest=i;frame.schedule();}
  assert.equal(callbacks.size,1);callbacks.values().next().value();callbacks.clear();
  assert.equal(draws,1);assert.equal(painted,200);
  latest=201;frame.schedule();frame.flush();assert.equal(callbacks.size,0);assert.equal(painted,201);
  frame.schedule();frame.clear();assert.equal(callbacks.size,0);assert.equal(draws,2);
  frame.flush();assert.equal(draws,2,'release does not redraw an already-current preview');
});

test('hidden editor refreshes preserve the current journey and skip expensive planning',async()=>{
  gmGame();const scene=testScene({waypoints:[]});globalThis.canvas={scene};
  const hud=new TravelHud({getTerrain:()=>{throw Error('Rebuilt the sea during an edit');},getRoutes:()=>{throw Error('Rebuilt the graph during an edit');}});
  hud.el={};hud.suspended=true;hud.result={savedPlan:true};const previous=hud.result;
  for(let i=0;i<20;i++)await hud.refresh();
  assert.equal(hud.result,previous);assert.equal(hud.refreshPending,true);
});

test('leaving the editor consumes all deferred planning requests once',async()=>{
  gmGame();globalThis.canvas={scene:testScene({})};
  const hud=new TravelHud({});hud.render=()=>{};hud.suspended=true;hud.refreshPending=true;let refreshes=0;
  hud.refresh=async()=>{refreshes++;hud.refreshPending=false;};
  await hud.suspend(false);await hud.suspend(false);assert.equal(refreshes,1);
});

test('a clock tick or explicit sync forces fresh planning even while the editor is open',async()=>{
  gmGame();globalThis.canvas={scene:testScene({})};const hud=new TravelHud({});hud.suspended=true;hud.refreshPending=true;
  let options;hud.refresh=async opts=>{options=opts;hud.refreshPending=false;};
  await hud.tick();assert.deepEqual(options,{force:true});
});
