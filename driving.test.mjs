import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareRouteGeometry,readRoutePosition} from './driving.mjs';

const points = [
  {lat:36.35,lng:127.38},
  {lat:36.36,lng:127.38},
  {lat:36.36,lng:127.38},
  {lat:36.37,lng:127.38}
];
const route = prepareRouteGeometry(points);

test('GPS projects onto the remaining portion of the Kakao route',()=>{
  assert.equal(route.segments.length,2);
  const result = readRoutePosition(route,{lat:36.36,lng:127.38},12,2400);
  assert.equal(result.state,'on-route');
  assert.ok(Math.abs(result.remaining - 1200) < 1);
});

test('distance is withheld when the GPS is inaccurate or the route has been left',()=>{
  assert.deepEqual(readRoutePosition(route,{lat:36.36,lng:127.384},12,2400),{state:'off-route',remaining:null});
  assert.deepEqual(readRoutePosition(route,{lat:36.36,lng:127.38},120,2400),{state:'inaccurate',remaining:null});
});

test('arrival requires a credible fix close to the destination along the route',()=>{
  assert.deepEqual(readRoutePosition(route,{lat:36.3699,lng:127.38},8,2400),{state:'arrived',remaining:0});
  assert.equal(readRoutePosition(route,{lat:36.3699,lng:127.38},55,2400).state,'on-route');
  assert.equal(readRoutePosition(route,{lat:36.371,lng:127.38},8,2400).state,'off-route');
});
