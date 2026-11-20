import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareRouteGeometry} from './driving.mjs';
import {matchCrossings, nextCrossing, currentSignalRows} from './next-signal.mjs';

const point = (lat, lng = 126.98) => ({lat, lng});
const geometry = prepareRouteGeometry([point(37.55), point(37.552), point(37.554)]);
const crossings = [
  {id:'2', ...point(37.553)},
  {id:'side-road', ...point(37.551,126.981)},
  {id:'1', ...point(37.551), hasSignals:false}
];

test('selects the next intersection in route order and excludes side roads', () => {
  const matches = matchCrossings(geometry, crossings);
  assert.deepEqual(matches.map(crossing => crossing.id), ['1','2']);
  assert.equal(nextCrossing(matches, 0).id, '1');
  assert.equal(nextCrossing(matches, matches[0].meters).id, '1');
  assert.equal(nextCrossing(matches, matches[0].meters + 1).id, '2');
  assert.equal(nextCrossing(matches, 150).id, '2');
  assert.equal(nextCrossing(matches, 400), null);
});

test('recognizes a right turn without substituting the straight signal', () => {
  const turn = prepareRouteGeometry([point(37.55), point(37.552), point(37.552,126.982)]);
  const [crossing] = matchCrossings(turn, [{id:'1', ...point(37.552)}]);
  const now = Date.now();
  assert.equal(crossing.movement, '우회전');
  assert.deepEqual(currentSignalRows(crossing, {
    fresh:true, observedAt:new Date(now).toISOString(),
    signals:[{direction:'남쪽', movement:'직진', state:'보호 진행', seconds:20}]
  }, now), []);
});

test('shows only the entering side and planned turn and suppresses stale signals', () => {
  const turn = prepareRouteGeometry([point(37.55), point(37.552), point(37.552,126.978)]);
  const [crossing] = matchCrossings(turn, [{id:'1', ...point(37.552)}]);
  const collected = Date.parse('2026-11-19T12:00:00+09:00');
  const snapshot = {fresh:true, observedAt:new Date(collected).toISOString(), signals:[
    {direction:'북쪽', movement:'좌회전', state:'정지', seconds:30},
    {direction:'남쪽', movement:'좌회전', state:'보호 진행', seconds:26},
    {direction:'동쪽', movement:'좌회전', state:'비보호 진행', seconds:2},
    {direction:'남쪽', movement:'직진', state:'보호 진행', seconds:30}
  ]};
  assert.equal(crossing.approach,'남쪽');
  assert.deepEqual(currentSignalRows(crossing, snapshot, collected+7000), [snapshot.signals[1]]);
  assert.deepEqual(currentSignalRows(crossing, snapshot, collected+15000), []);
  assert.deepEqual(currentSignalRows(crossing, {...snapshot, fresh:false}, collected+7000), []);
});

test('allows the same crossing to be shown on a later pass of the route', () => {
  const outAndBack = prepareRouteGeometry([point(37.55), point(37.554), point(37.55)]);
  const matches = matchCrossings(outAndBack, [{id:'1', ...point(37.552)}]);
  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map(crossing=>crossing.approach), ['남쪽','북쪽']);
  assert.ok(nextCrossing(matches,350).meters > 600);
});
