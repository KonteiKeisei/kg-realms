// Regional sections (0.97.7): each realm line through a Regional map gets a section there, from crossing
// to crossing, that the GM can reshape or delete; a line of their own drawn between two crossings of the
// same realm line is recognised as that line's section.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { regionalEntrances, regionalSections, settleSections, settleWaterSections } from '../scripts/regional-placement.mjs';
import { applyRouteEdits } from '../scripts/routes.mjs';
import { homebrewSheet } from '../scripts/homebrew/plan.mjs';
import { sourceProjection } from '../scripts/source-map.mjs';
import { RegionalMaps } from '../scripts/regional-service.mjs';
import { gmGame } from './helpers/journey.mjs';

const near = (a, b, m) => assert.ok(Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6, `${m ?? ''} ${a} != ${b}`);
function fixture() {
  const parent = { id: 'realm', sourceMap: homebrewSheet(1000, 500, 1000) }, data = { id: 'dale', sourceMap: homebrewSheet(300, 300, 150) };
  const root = sourceProjection(parent.sourceMap);
  const link = { world: 'dale', parent: 'realm', title: 'Icewind Dale', scene: 'detail', parentScene: 'overview', footprint: [[100, 100], [130, 100], [130, 130], [100, 130]].map((p) => root.toLonLat(...p)), anchors: [{ parent: [100, 100], region: [0, 0] }, { parent: [130, 100], region: [300, 0] }, { parent: [100, 130], region: [0, 300] }] };
  const road = (id, pts, name = 'Great Road', kind = 'road') => ({ type: 'Feature', properties: { id, kind, name }, geometry: { type: 'LineString', coordinates: pts.map((p) => root.toLonLat(...p)) } });
  return { parent, data, link, root, road, args: (routes, ww = {}) => [routes, link, parent.sourceMap, data.sourceMap, ww] };
}
const fc = (...features) => ({ type: 'FeatureCollection', features });

test('a realm road through the outline gets a section from where it enters to where it leaves', () => {
  const { road, args } = fixture(), routes = fc(road('great', [[80, 115], [115, 112], [150, 115]]));
  const entries = regionalEntrances(...args(routes)), { roads } = regionalSections(...args(routes));
  assert.equal(roads.length, 1);
  const s = roads[0];
  assert.equal(s.properties.id, 'section:great:0');
  assert.deepEqual([s.properties.of, s.properties.name, s.properties.kind, s.properties.section], ['great', 'Great Road', 'road', true]);
  assert.equal(s.properties.from, entries[0].id);assert.equal(s.properties.to, entries[1].id);
  assert.equal(s.geometry.coordinates.length, 3, 'its bend inside comes along');
  near(s.geometry.coordinates[0], entries[0].regionLL, 'starts at the crossing');
  near(s.geometry.coordinates.at(-1), entries[1].regionLL, 'ends at the other');
});

test('a road that ends inside runs from its crossing to its end; one that goes in and out twice gets two', () => {
  const { road, args } = fixture();
  const ends = regionalSections(...args(fc(road('spur', [[80, 115], [115, 115]], 'Spur', 'trail')))).roads;
  assert.equal(ends.length, 1);assert.ok(ends[0].properties.from && !ends[0].properties.to);assert.equal(ends[0].properties.kind, 'trail');
  const twice = regionalSections(...args(fc(road('wind', [[80, 105], [120, 105], [120, 90], [125, 90], [125, 125], [150, 125]])))).roads;
  assert.deepEqual(twice.map((f) => f.properties.id), ['section:wind:0', 'section:wind:1']);
});

test('rivers, shorelines, sea routes and winds get sections too, keeping their own details', () => {
  const { root, args } = fixture(), across = (y) => [root.toLonLat(80, y), root.toLonLat(150, y)];
  const { waters } = regionalSections(...args(fc(), { r: { kind: 'river', name: 'Floods', pts: across(105), width: 3 }, l: { kind: 'lane', name: 'Grain run', pts: across(120) } }));
  assert.deepEqual(Object.keys(waters).sort(), ['section-l-0', 'section-r-0']);
  assert.deepEqual([waters['section-r-0'].kind, waters['section-r-0'].name, waters['section-r-0'].width, waters['section-r-0'].of], ['river', 'Floods', 3, 'water-r']);
  assert.ok(waters['section-r-0'].from && waters['section-r-0'].to && waters['section-r-0'].section);
});

test('a line drawn between two crossings of the same realm line becomes its section, and the converted one goes', () => {
  const { road, args } = fixture(), routes = fc(road('great', [[80, 115], [150, 115]]), road('north', [[115, 80], [115, 150]], 'North Way'));
  const entries = regionalEntrances(...args(routes)), base = fc(...regionalSections(...args(routes)).roads);
  const [g0, g1] = entries.filter((e) => e.route === 'great').map((e) => e.id), [n0] = entries.filter((e) => e.route === 'north').map((e) => e.id);
  const mine = { type: 'Feature', properties: { id: 'mine', kind: 'road', from: g1, to: g0 }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } };
  const other = { type: 'Feature', properties: { id: 'link', kind: 'road', name: 'Cut', from: g0, to: n0 }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } };
  const out = settleSections(fc(...base.features, mine, other), entries);
  const ids = out.features.map((f) => f.properties.id);
  assert.ok(!ids.includes('section:great:0'), 'the redrawn stretch replaces the converted one');
  assert.ok(ids.includes('section:north:0'), 'the other line keeps its section');
  const redrawn = out.features.find((f) => f.properties.id === 'mine');
  assert.deepEqual([redrawn.properties.of, redrawn.properties.name], ['great', 'Great Road']);
  const cut = out.features.find((f) => f.properties.id === 'link');
  assert.equal(cut.properties.of, undefined, 'between two different realm lines it stays its own');
  assert.equal(cut.properties.name, 'Cut');
});

test('the same for waterways', () => {
  const { root, args } = fixture(), across = (y) => [root.toLonLat(80, y), root.toLonLat(150, y)], ww = { r: { kind: 'river', name: 'Floods', pts: across(105) } };
  const entries = regionalEntrances(...args(fc(), ww)), { waters } = regionalSections(...args(fc(), ww));
  const out = settleWaterSections({ ...waters, mine: { kind: 'river', pts: [[0, 0], [1, 1]], from: entries[1].id, to: entries[0].id } }, entries);
  assert.equal(out['section-r-0'], undefined);
  assert.deepEqual([out.mine.of, out.mine.name], ['water-r', 'Floods']);
});

test('a section follows the realm until reshaped; a reshaped one keeps its shape; a deleted one stays gone', () => {
  const { road, args } = fixture(), before = fc(road('great', [[80, 115], [150, 115]])), after = fc(road('great', [[80, 110], [115, 125], [150, 110]]));
  const a = regionalSections(...args(before)).roads, b = regionalSections(...args(after)).roads;
  assert.notDeepEqual(a[0].geometry.coordinates, b[0].geometry.coordinates, 'unedited, it moves with the realm road');
  const shape = [[1, 1], [2, 2], [3, 3]];
  const edited = applyRouteEdits(fc(...b), { edited: { 'section:great:0': { coordinates: shape } }, added: {}, deleted: [] });
  assert.deepEqual(edited.features[0].geometry.coordinates, shape);assert.equal(edited.features[0].properties.name, 'Great Road');
  assert.equal(applyRouteEdits(fc(...b), { edited: {}, added: {}, deleted: ['section:great:0'] }).features.length, 0);
});

test('the Regional map service adds sections under the map\'s own roads and settles them', () => {
  gmGame();const { parent, data, link, road, args } = fixture(), settings = { regionalMaps: { dale: link } };game.settings.get = (_m, k) => settings[k];
  const routes = fc(road('great', [[80, 115], [150, 115]]));
  const service = new RegionalMaps({ rawPlaces: () => [], getEdits: () => ({ edits: {} }) });
  service.indexes = { realm: parent, dale: data };service.entryPoints.dale = regionalEntrances(...args(routes));service.sections.dale = regionalSections(...args(routes));
  const own = fc({ type: 'Feature', properties: { id: 'lane', kind: 'trail' }, geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } });
  const base = service.withSections('dale', own);
  assert.deepEqual(base.features.map((f) => f.properties.id), ['lane', 'section:great:0']);
  assert.equal(service.withSections('realm', own), own, 'the realm map is unchanged');
  assert.equal(service.followRoutes('dale', base).features.length, 2);
});

test('the map, travel and waterways all read Regional maps with their sections', () => {
  const main = readFileSync(new URL('../scripts/main.mjs', import.meta.url), 'utf8');
  assert.ok(main.includes('regional.followRoutes(id,applyRouteEdits(regional.withSections(id,file),routeEditsOf(id)))'), 'travel networks');
  assert.ok(main.includes('current.routesBase = file && regional.withSections(region.world, file);'), 'the map and the road editor');
  assert.ok(main.includes('const out = { ...regional.waterSections(world), ...(shippedWaterways.get(world) ?? {}) };'));
  assert.ok(main.includes('regional.settleWaters(world, followCrossingWaters(ww, regional.entrances(world)))'));
});
