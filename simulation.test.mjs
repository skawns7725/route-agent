import assert from 'node:assert/strict';
import test from 'node:test';
import {createDrive, createPlaybackClock, sampleDrive} from './simulation.js';

const points = [{lat:36.33,lng:127.40}, {lat:36.33,lng:127.42}, {lat:36.33,lng:127.46}];

test('a test intersection holds the vehicle at a fixed point until green', () => {
  const drive = createDrive({points,durationSeconds:100});
  const first = drive.checkpoints[0];
  assert.equal(first.arrival,18);
  assert.equal(first.departure,31);
  const stopped = sampleDrive(drive,25);
  assert.equal(stopped.stage,'waiting');
  assert.equal(stopped.waitSeconds,7);
  assert.deepEqual(stopped.position,sampleDrive(drive,30).position);
  assert.equal(stopped.stops[0].state,'red');

  const moving = sampleDrive(drive,32);
  assert.equal(moving.stage,'driving');
  assert.equal(moving.stops[0].state,'green');
  assert.ok(moving.position.lng > stopped.position.lng);
  const finished = sampleDrive(drive,1000);
  assert.equal(finished.stage,'arrived');
  assert.deepEqual(finished.position,points.at(-1));
  assert.equal(finished.elapsed,drive.movingSeconds+finished.waitSeconds);
  assert.equal(finished.waitSeconds,finished.waits.reduce((total, stop) => total+stop.seconds,0));
});

test('playback rates and pauses keep identical virtual outcomes', () => {
  const drive = createDrive({points,durationSeconds:100});
  const normal = createPlaybackClock(drive.totalSeconds);
  const faster = createPlaybackClock(drive.totalSeconds);
  normal.play(0);
  faster.play(0);
  faster.setRate(2,0);
  assert.equal(faster.reading(1000),2);
  faster.setRate(4,1000);
  assert.equal(faster.reading(2000),6);
  faster.setRate(8,2000);
  assert.equal(faster.reading(3000),14);
  faster.pause(3000);
  assert.equal(faster.reading(9000),14);
  faster.play(9000);
  assert.deepEqual(sampleDrive(drive,faster.reading(12000)),sampleDrive(drive,normal.reading(38000)));

  const normalEnd = sampleDrive(drive,normal.reading(180000));
  const fastEnd = sampleDrive(drive,faster.reading(60000));
  assert.deepEqual(normalEnd,fastEnd);
  faster.reset();
  assert.equal(faster.reading(60000),0);
  assert.equal(faster.playing,false);
});

test('uses route geometry length and rejects an undrivable path', () => {
  assert.equal(createDrive({points:[points[0],points[0]]}),null);
  const drive = createDrive({points,durationSeconds:100});
  assert.ok(drive.distanceMeters>5000);
  const atNineSeconds = sampleDrive(drive,9);
  assert.ok(Math.abs(atNineSeconds.position.lng-127.4054)<0.0001);
});

test('a Kakao road route replays its geometry with the provider duration and no test signal stops', () => {
  const drive = createDrive({
    points, durationSeconds:120, distanceMeters:5600, tripLabel:'서울시청 → 서울역'
  },{testSignalStops:false});
  const midpoint = sampleDrive(drive,60);
  assert.equal(drive.name,'서울시청 → 서울역');
  assert.equal(drive.totalSeconds,120);
  assert.equal(midpoint.stage,'driving');
  assert.equal(midpoint.waitSeconds,0);
  assert.deepEqual(midpoint.stops,[]);
  assert.ok(Math.abs(midpoint.position.lng-127.43)<0.0001);
  const arrival = sampleDrive(drive,120);
  assert.equal(arrival.stage,'arrived');
  assert.deepEqual(arrival.position,points.at(-1));
});
