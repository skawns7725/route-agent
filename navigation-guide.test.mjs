import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildNavigationPlan, readNavigation} from './navigation-guide.mjs';

const points = [{lat:37,lng:127},{lat:37.002,lng:127},{lat:37.004,lng:127}];
const route = {points,distanceMeters:440,durationSeconds:120,sections:[{
  roads:[{name:'진입로'},{name:'큰길'}],
  guides:[
    {x:127,y:37,type:100,guidance:'출발지',road_index:0},
    {x:127,y:37.001,type:1,guidance:'좌회전',road_index:0},
    {x:127,y:37.002,type:6,guidance:'오른쪽 방향',road_index:1},
    {x:127,y:37.004,type:101,guidance:'목적지',road_index:-1}
  ]
}]};

test('shows ordered real directions and advances after passing a maneuver',()=>{
  const plan = buildNavigationPlan(route);
  assert.deepEqual(plan.steps.map(step=>step.text),['좌회전','오른쪽 방향','목적지 도착']);
  assert.equal(readNavigation(plan,.2).step.road,'진입로');
  assert.equal(readNavigation(plan,.35).step.text,'오른쪽 방향');
  assert.equal(readNavigation(plan,.6).step.text,'목적지 도착');
  assert.equal(readNavigation(plan,1).remaining,0);
});

test('keeps branch guidance and explicitly represents missing direction metadata',()=>{
  const plan = buildNavigationPlan(route);
  assert.equal(readNavigation(plan,.4).step.junction,true);
  assert.deepEqual(buildNavigationPlan({points}).steps,[]);
  assert.equal(readNavigation(plan,.5).seconds,60);
});

test('recalculates the arrival timestamp from each observation and remaining estimate',()=>{
  const plan = buildNavigationPlan(route);
  const first = Date.parse('2026-11-20T19:08:00+09:00');
  const second = first + 30_000;
  assert.equal(readNavigation(plan,.2,900,first).arrivalAt,first+900_000);
  assert.equal(readNavigation(plan,.3,780,second).arrivalAt,second+780_000);
  assert.equal(readNavigation(plan,.3,780,first+120_000).arrivalAt,first+900_000);
});

test('counts a waypoint once when Kakao repeats it at a section boundary',()=>{
  const stop = {x:127,y:37.002,type:1000,guidance:'경유지',road_index:-1};
  const plan = buildNavigationPlan({points,sections:[{guides:[stop]},{guides:[
    {...stop,road_index:0},
    {x:127,y:37.003,type:2,guidance:'우회전',road_index:0}
  ]}]});
  assert.equal(readNavigation(plan,.45).passedWaypoints,0);
  assert.equal(readNavigation(plan,.6).passedWaypoints,1);
  assert.equal(readNavigation(plan,.6).step.text,'우회전');
});
