import test from 'node:test';
import assert from 'node:assert/strict';
import {metersBetween,departureCorrection,gpsOriginDecision} from './gps-departure.mjs';

const origin = {lat:0,lng:0,name:'현재 위치',ephemeral:true};
const fixAt = (meters,accuracy = 100)=>({
  lat:meters / 6371000 * 180 / Math.PI,lng:0,accuracy
});

test('Haversine distance uses both coordinates and returns meters',()=>{
  assert.equal(metersBetween(origin,origin),0);
  const point = {lat:37.5665,lng:126.978};
  const nearby = {lat:37.5675,lng:126.979};
  assert.ok(Math.abs(metersBetween(point,nearby)-141.91) < 0.1);
});

test('GPS departure moves only when displaced by more than 100 m',()=>{
  assert.equal(departureCorrection(origin,fixAt(99.9)),'keep');
  assert.equal(departureCorrection(origin,fixAt(100)),'keep');
  assert.equal(departureCorrection(origin,fixAt(100.1)),'correct');
});

test('GPS accuracy must be 100 m or better',()=>{
  assert.equal(departureCorrection(origin,fixAt(150,100)),'correct');
  for (const accuracy of [100.1,NaN,-1,Infinity,null]) {
    assert.equal(departureCorrection(origin,fixAt(150,accuracy)),'unavailable');
  }
  assert.equal(departureCorrection(origin,null),'unavailable');
});

test('manual departures stay fixed even with the current-location label',()=>{
  assert.equal(departureCorrection({...origin,ephemeral:false},fixAt(150)),'keep');
  assert.equal(departureCorrection({...origin,name:'서울시청'},fixAt(150)),'keep');
});

test('accepts a usable GPS origin as temporary current location',()=>{
  assert.deepEqual(gpsOriginDecision({latitude:36.35,longitude:127.38},0,0),{
    kind:'use',place:{lat:36.35,lng:127.38,name:'현재 위치',ephemeral:true}
  });
});

test('preserves the default map on GPS failure or unusable coordinates',()=>{
  for (const coords of [undefined,{latitude:NaN,longitude:127.38},{latitude:36.35,longitude:Infinity}]) {
    assert.deepEqual(gpsOriginDecision(coords,0,0),{kind:'unavailable'});
  }
  assert.deepEqual(gpsOriginDecision({latitude:35.68,longitude:139.69},0,0),{kind:'outside-region'});
});

test('ignores late GPS success or failure after the departure field changed',()=>{
  assert.deepEqual(gpsOriginDecision({latitude:36.35,longitude:127.38},0,1),{kind:'ignore'});
  assert.deepEqual(gpsOriginDecision(undefined,0,1),{kind:'ignore'});
});
