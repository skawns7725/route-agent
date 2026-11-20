const assert = require('node:assert/strict');
const test = require('node:test');
const {handleTrafficSignals} = require('./traffic-signals.cjs');

const seoul = '1100000000';
const daejeon = '3000000000';
const recent = '20261119133802';
const current = '2026-11-19T04:38:05Z';
const request = path => handleTrafficSignals(
  new URL(path, 'http://localhost'), (status, payload) => ({status, payload})
);
const reply = (code, items, totalCount = 0) => Response.json({
  header:{resultCode:code}, body:{totalCount,numOfRows:1,items:{item:items}}
});

test('uses live API shape and codes, paginates, and matches signals by intersection ID', async t => {
  const previousKey = process.env.TRAFFIC_SIGNAL_SERVICE_KEY;
  process.env.TRAFFIC_SIGNAL_SERVICE_KEY = 'test+key';
  t.after(() => {
    if (previousKey === undefined) delete process.env.TRAFFIC_SIGNAL_SERVICE_KEY;
    else process.env.TRAFFIC_SIGNAL_SERVICE_KEY = previousKey;
  });
  t.mock.method(Date, 'now', () => Date.parse(current));
  const fetch = t.mock.method(globalThis, 'fetch', async raw => {
    const url = new URL(raw);
    assert.equal(url.searchParams.get('serviceKey'), 'test+key');
    if (url.pathname.endsWith('/getTrsnList1')) {
      assert.equal(url.searchParams.get('SIGNGU_NM'), '유성구');
      return Response.json({response:{header:{resultCode:'00'},body:{totalCount:1,numOfRows:1,items:{item:[{
        SIGNGU_NM:'유성구', TFCLGHTMANAGENO:'22302', LATITUDE:36.4, LONGITUDE:127.4,
        LNMADR:'유성구 테스트 10', ROAD_ROUTE_NM:'한밭대로', TFCLGHTSE:'02',
        TFCLGHTCOLORKND:'02', REFERENCEDATE:'2022-12-10'
      }]}}}});
    }
    const region = url.searchParams.get('stdgCd');
    if (region === daejeon) return reply('K3', []);
    if (url.pathname.endsWith('/crsrd_map_info')) {
      const id = url.searchParams.get('pageNo');
      return reply('K0', [{stdgCd:region, crsrdId:id, crsrdNm:'교차로 '+id, mapCtptIntLat:'37.5', mapCtptIntLot:'127'}], 2);
    }
    return reply('K0', {
      stdgCd:region, crsrdId:'2', totDt:recent,
      ntStsgSttsNm:'protected-Movement-Allowed', ntStsgRmndCs:'1234',
      ntBssgSttsNm:'stop-And-Remain', ntBssgRmndCs:'36001',
      ntPdsgSttsNm:'stop-And-Remain', ntPdsgRmndCs:'0'
    }, 1);
  });

  const districts = await request('/api/intersections?region='+seoul);
  assert.equal(districts.status, 200);
  assert.deepEqual(districts.payload.intersections.map(row => [row.id,row.hasSignals]), [['1',false],['2',true]]);
  const snapshot = await request('/api/traffic-signals?region='+seoul+'&id=2');
  assert.equal(snapshot.payload.observedAt, '2026-11-19T04:38:02.000Z');
  assert.equal(snapshot.payload.fresh, true);
  assert.deepEqual(snapshot.payload.signals.map(row => [row.movement,row.seconds]), [['직진',12.34],['보행',0],['버스',null]]);
  assert.equal(fetch.mock.callCount(), 3);
  assert.deepEqual((await request('/api/traffic-signals?region='+seoul+'&id=1')).payload.signals, []);

  t.mock.method(Date, 'now', () => Date.parse('2026-11-19T04:38:20Z'));
  const stale = await request('/api/traffic-signals?region='+seoul+'&id=2');
  assert.equal(stale.payload.fresh, false);
  assert.ok(stale.payload.signals.every(row => row.seconds === null));
  assert.deepEqual(await request('/api/intersections?region='+daejeon), {status:200,payload:{intersections:[]}});
  assert.equal((await request('/api/traffic-signals?region='+seoul+'&id=../')).status, 400);
  assert.equal((await request('/api/traffic-light-facilities?district=invalid')).status, 400);
  const local = await request('/api/traffic-light-facilities?district='+encodeURIComponent('유성구'));
  assert.equal(local.status, 200);
  assert.deepEqual(local.payload.facilities, [{
    id:'22302:36.4:127.4', managementId:'22302', name:'유성구 테스트 10',
    lat:36.4, lng:127.4, road:'한밭대로', type:'보행등', lenses:'2색등', referenceDate:'2022-12-10'
  }]);
});
