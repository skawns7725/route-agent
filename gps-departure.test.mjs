import test from 'node:test';
import assert from 'node:assert/strict';
import {metersBetween,departureCorrection} from './gps-departure.mjs';

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

test('manual departures use the same distance and accuracy limits',()=>{
  const manual = {lat:origin.lat,lng:origin.lng,name:'서울시청'};
  assert.equal(departureCorrection(manual,fixAt(150)),'correct');
  assert.equal(departureCorrection(manual,fixAt(100)),'keep');
  assert.equal(departureCorrection(manual,fixAt(150,101)),'unavailable');
  assert.equal(departureCorrection(manual,null),'unavailable');
});
