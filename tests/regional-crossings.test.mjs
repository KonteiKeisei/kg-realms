// Crossings for every kind of line (0.97.7): roads and trails as before, and now rivers, shorelines,
// sea routes and winds, each where it crosses a Regional map's outline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { regionalEntrances, followCrossingWaters, adjustedEntrances } from '../scripts/regional-placement.mjs';
import { homebrewSheet } from '../scripts/homebrew/plan.mjs';
import { sourceProjection } from '../scripts/source-map.mjs';
import { RegionalMaps } from '../scripts/regional-service.mjs';
import { gmGame } from './helpers/journey.mjs';

const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-4, `${m ?? ''} ${a} != ${b}`);
function fixture() {
  const parent = { id: 'realm', sourceMap: homebrewSheet(1000, 500, 1000) }, data = { id: 'dale', sourceMap: homebrewSheet(300, 300, 150) };
  const root = sourceProjection(parent.sourceMap), child = sourceProjection(data.sourceMap);
  const link = { world: 'dale', parent: 'realm', title: 'Icewind Dale', scene: 'detail', parentScene: 'overview', footprint: [[100, 100], [130, 100], [130, 130], [100, 130]].map((p) => root.toLonLat(...p)), anchors: [{ parent: [100, 100], region: [0, 0] }, { parent: [130, 100], region: [300, 0] }, { parent: [100, 130], region: [0, 300] }] };
  const across = (y) => [root.toLonLat(80, y), root.toLonLat(150, y)];
  return { parent, data, root, child, link, across };
}
const noRoads = { type: 'FeatureCollection', features: [] };

test('a river, shoreline, sea route and wind each cross the outline with their kind and name', () => {
  const { parent, data, link, across } = fixture();
  const ww = { r: { kind: 'river', name: 'Floods of Cyrriane', pts: across(105) }, s: { kind: 'shore', name: 'Gulf coast', pts: across(110) }, l: { kind: 'lane', name: 'Grain run', pts: across(115) }, w: { kind: 'wind', name: 'West wind', pts: across(120) } };
  const out = regionalEntrances(noRoads, link, parent.sourceMap, data.sourceMap, ww);
  assert.equal(out.length, 8, 'each crosses in and out');
  for (const [id, label] of [['r', 'River'], ['s', 'Shoreline'], ['l', 'Sea route'], ['w', 'Wind or current']]) {
    const mine = out.filter((e) => e.route === `water-${id}`);
    assert.equal(mine.length, 2);assert.ok(mine.every((e) => e.kind === label && e.line === 'water'));
  }
  assert.equal(out.find((e) => e.route === 'water-r').name, 'River crossing 1: Floods of Cyrriane');
  near(out.find((e) => e.route === 'water-r').region[0], 0, 'enters at the left edge');
});

test('roads keep their crossings and names as before', () => {
  const { parent, data, link, across } = fixture();
  const roads = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { id: 'great', kind: 'road', name: 'Great Road' }, geometry: { type: 'LineString', coordinates: across(115) } }] };
  const out = regionalEntrances(roads, link, parent.sourceMap, data.sourceMap);
  assert.deepEqual(out.map((e) => e.id), ['regional-entry:dale:great:0', 'regional-entry:dale:great:1']);
  assert.deepEqual(out.map((e) => e.name), ['Road crossing 1: Great Road', 'Road crossing 2: Great Road']);
});

test('crossing ids stay the same when worked out again, so adjustments keep', () => {
  const { parent, data, link, across, child } = fixture(), ww = { r: { kind: 'river', name: 'R', pts: across(105) } };
  const a = regionalEntrances(noRoads, link, parent.sourceMap, data.sourceMap, ww), b = regionalEntrances(noRoads, link, parent.sourceMap, data.sourceMap, { ...ww, x: { kind: 'lane', pts: across(125) } });
  assert.deepEqual(a.map((e) => e.id), b.filter((e) => e.route === 'water-r').map((e) => e.id));
  const moved = child.toLonLat(0, 60), adjusted = adjustedEntrances(b, { [a[0].id]: { lon: moved[0], lat: moved[1] } }, data.sourceMap);
  assert.deepEqual(adjusted.find((e) => e.id === a[0].id).regionLL, moved);
});

test('a Regional map\'s waterway tied to crossings ends where they are', () => {
  const ww = { mine: { kind: 'river', pts: [[0, 0], [1, 1], [2, 2]], from: 'a', to: 'b' }, free: { kind: 'river', pts: [[5, 5], [6, 6]] } };
  const out = followCrossingWaters(ww, [{ id: 'a', regionLL: [-1, -1] }, { id: 'b', regionLL: [9, 9] }]);
  assert.deepEqual(out.mine.pts, [[-1, -1], [1, 1], [9, 9]]);
  assert.deepEqual(out.free, ww.free);
});

test('crossing markers show only while the map editor is open', () => {
  gmGame();const { parent, data, link, across } = fixture(), settings = { regionalMaps: { dale: link } };game.settings.get = (_m, k) => settings[k];
  let editing = false;
  const service = new RegionalMaps({ rawPlaces: () => [], getEdits: () => ({ edits: {} }), showCrossings: () => editing });
  service.indexes = { realm: parent, dale: data };service.entryPoints.dale = regionalEntrances(noRoads, link, parent.sourceMap, data.sourceMap, { r: { kind: 'river', name: 'R', pts: across(105) } });
  assert.equal(service.places('dale').filter((p) => p.regionalEntry).length, 0);
  editing = true;
  assert.equal(service.places('dale').filter((p) => p.regionalEntry).length, 2);
  assert.equal(service.places('realm').filter((p) => p.regionalEntry).length, 2, 'on the realm too, at the realm side');
});

test('the waterways editor ties a line drawn from or to a crossing; the realm\'s waterways feed the crossings', () => {
  const ui = readFileSync(new URL('../scripts/ui-waterways.mjs', import.meta.url), 'utf8'), main = readFileSync(new URL('../scripts/main.mjs', import.meta.url), 'utf8');
  assert.ok(ui.includes('const crossing = this.#crossingAt(g);') && ui.includes('...(from ? { from } : {}), ...(to ? { to } : {})'));
  assert.ok(main.includes('getWaterways:async(id)=>{await loadShippedWaterways(id);return waterwaysOf(id);}'));
  assert.ok(main.includes('followCrossingWaters(ww, regional.entrances(world))'));
  assert.ok(main.includes('showCrossings:()=>game.user.isGM&&!!editor?.active'));
});
