import {test} from 'node:test';
import assert from 'node:assert/strict';
import {joinRoads} from '../scripts/city/routing.mjs';

test('settlement roads join end to end by their nearest ends, sharing a meeting point once', () => {
  // b starts where a ends: one point in common.
  assert.deepEqual(joinRoads([[0,0],[10,0]],[[10,0],[20,0]]), {gap:0,points:[[0,0],[10,0],[20,0]]});
  // b runs the other way: it is reversed to continue a.
  assert.deepEqual(joinRoads([[0,0],[10,0]],[[30,0],[12,0]]).points, [[0,0],[10,0],[12,0],[30,0]]);
  // a's start is nearest: a is reversed, so the joined road still runs continuously.
  const j=joinRoads([[50,0],[60,0]],[[0,0],[45,0]]);
  assert.equal(j.gap,5);assert.deepEqual(j.points,[[60,0],[50,0],[45,0],[0,0]]);
});
