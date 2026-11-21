import assert from 'node:assert/strict';
import test from 'node:test';
import {initDriving,prepareRouteGeometry,readRoutePosition,readAutoReroute} from './driving.mjs';

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

test('automatic rerouting uses two consecutive off-route fixes up to 75 m accuracy',()=>{
  const accuracy = 75;
  const {state} = readRoutePosition(route,{lat:36.36,lng:127.384},accuracy,2400);
  const first = readAutoReroute({state,accuracy,previousFixes:0,elapsed:Infinity});
  assert.deepEqual(first,{fixes:1,retry:false});
  assert.deepEqual(readAutoReroute({state,accuracy,previousFixes:first.fixes,elapsed:Infinity}),
    {fixes:2,retry:true});
  for (const update of [{accuracy:75.1},{state:'on-route'},{state:'inaccurate'}]) {
    assert.deepEqual(readAutoReroute({state,accuracy,previousFixes:1,elapsed:Infinity,...update}),
      {fixes:0,retry:false});
  }
});

test('automatic rerouting waits ten seconds between attempts and skips pending requests',()=>{
  const fix = {state:'off-route',accuracy:45,previousFixes:1};
  assert.equal(readAutoReroute({...fix,elapsed:9999}).retry,false);
  assert.equal(readAutoReroute({...fix,elapsed:10000,pending:true}).retry,false);
  assert.equal(readAutoReroute({...fix,elapsed:10000,pending:false}).retry,true);
});

test('GPS reroutes from the latest fix, retains the old route on failure and skips passed waypoints',async t=>{
  const nodes = new Map();
  const getElementById = id=>{
    if (!nodes.has(id)) nodes.set(id,{hidden:true});
    return nodes.get(id);
  };
  let update;
  for (const [key,value] of Object.entries({
    document:{getElementById},
    window:{addEventListener() {}},
    navigator:{geolocation:{watchPosition(callback) {update = callback; return 1;},clearWatch() {}}}
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{value,configurable:true});
    t.after(()=>original ? Object.defineProperty(globalThis,key,original) : delete globalThis[key]);
  }
  const original = {name:'원래 경로',points,waypoints:[points[1]]};
  const current = {lat:36.36,lng:127.384};
  const replacement = {name:'새 경로',points:[current,points.at(-1)],waypoints:[]};
  const drawn = [];
  const guides = [];
  let settle;
  const driving = initDriving({
    map:{connected:()=>true,setLivePosition() {},setRoute:route=>drawn.push(route)},
    openPanel() {},onSpeed() {},onDepartureNotice() {},
    prepareDeparture:async()=>({}),
    nextSignal:{start() {},update() {},stop() {}},
    navigation:{start:(_owner,route)=>guides.push(route),update() {},stop() {},passedWaypoints:()=>1},
    rerouteFrom:(position,{passedWaypoints})=>{
      assert.deepEqual(position,current);
      assert.equal(passedWaypoints,1);
      return new Promise((resolve,reject)=>{settle = {resolve,reject};});
    }
  });
  const fix = ({lat,lng},accuracy)=>update({coords:{latitude:lat,longitude:lng,accuracy},timestamp:Date.now()});
  const status = ()=>getElementById('driveStatus').textContent;
  try {
    for (const succeeds of [false,true]) {
      settle = undefined;
      driving.setRoute(original);
      assert.equal(await driving.start(),true);
      fix(points[1],10);
      fix({lat:current.lat,lng:127.383},60);
      assert.equal(settle,undefined);
      fix(current,60);
      assert.match(status(),/현재 위치에서 새 경로를 찾고 있어요/);
      fix(current,120);
      assert.match(status(),/현재 위치에서 새 경로를 찾고 있어요/);
      if (succeeds) settle.resolve(replacement);
      else settle.reject(new Error('network'));
      await Promise.resolve();
      assert.equal(drawn.length,succeeds ? 1 : 0);
      assert.equal(guides.at(-1),succeeds ? replacement : original);
      assert.match(status(),succeeds ? /경로로 안내하고 있어요/ : /기존 경로를 유지해요/);
      driving.stop({restore:false});
    }
  } finally {
    driving.stop({restore:false});
  }
});
