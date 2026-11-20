const assert = require('node:assert/strict');
const {test} = require('node:test');
const {handleRoutes} = require('./route-provider.cjs');

const origin = '127.37,36.35';
const destination = '127.50,36.32';
const via = '127.42,36.34';
const trip = new URLSearchParams({origin,destination,via});

const route = (duration,distance,toll,segments) => ({
  result_code:0,
  summary:{duration,distance,fare:{toll}},
  sections:[{roads:segments.map(([distance,traffic_state]) => ({
    distance,traffic_state,vertexes:[127.37,36.35,127.50,36.32]
  }))}]
});

function request(path, params = trip) {
  return handleRoutes(new URL(path+'?'+params,'http://localhost'),(status,body) => ({status,body}));
}

function setKey(t,key) {
  const before = process.env.KAKAO_MOBILITY_REST_KEY;
  if (key) process.env.KAKAO_MOBILITY_REST_KEY = key;
  else delete process.env.KAKAO_MOBILITY_REST_KEY;
  t.after(() => {
    if (before === undefined) delete process.env.KAKAO_MOBILITY_REST_KEY;
    else process.env.KAKAO_MOBILITY_REST_KEY = before;
  });
}

test('compares the configured route priorities and only labels confirmed zero-toll routes free',async t => {
  setKey(t,'test-rest-key');
  const fast = route(120,4000,500,[[2000,1],[2000,4]]);
  const short = route(210,3000,600,[[1000,2],[2000,4]]);
  const traffic = route(170,4500,600,[[1000,3],[2500,4],[1000,0]]);
  const insufficient = route(160,4200,700,[[200,4],[4000,0]]);
  const unconfirmed = route(170,4100,undefined,[[1000,2],[3100,4]]);
  const free = route(220,4400,0,[[1200,2],[3200,4]]);
  const upstream = t.mock.method(globalThis,'fetch',async (address,{headers,signal}) => {
    const url = new URL(address);
    const {searchParams} = url;
    assert.equal(url.origin,'https://apis-navi.kakaomobility.com');
    assert.equal(headers.Authorization,'KakaoAK test-rest-key');
    assert.ok(signal instanceof AbortSignal);
    assert.equal(searchParams.get('origin'),origin);
    assert.equal(searchParams.get('destination'),destination);
    assert.equal(searchParams.get('waypoints'),via);
    const priority = searchParams.get('priority');
    const avoid = searchParams.get('avoid');
    const routes = avoid === 'toll' ? [fast,unconfirmed,free]
      : priority === 'TIME' ? [traffic,fast]
      : priority === 'DISTANCE' ? [fast,short] : [insufficient,traffic];
    return Response.json({routes});
  });

  const result = await request('/api/route-comparison');
  assert.equal(result.status,200);
  assert.deepEqual(result.body.options.map(({kind,route}) => [kind,route.summary]),[
    ['fast',fast.summary],['short',short.summary],['traffic',traffic.summary],['free',free.summary]
  ]);
  assert.equal(result.body.options[2].traffic.congested,0);
  assert.equal(result.body.options[2].traffic.surveyed,3500);
  assert.deepEqual(upstream.mock.calls.map(({arguments:[address]}) => {
    const query = new URL(address).searchParams;
    return [query.get('priority'),query.get('avoid')];
  }),[['TIME',null],['DISTANCE',null],['RECOMMEND',null],['TIME','toll']]);
});

test('handles partial comparison results and keeps the existing /api/routes response',async t => {
  setKey(t,'test-rest-key');
  const fast = route(120,4000,500,[[4000,0]]);
  t.mock.method(globalThis,'fetch',async address => {
    const query = new URL(address).searchParams;
    if (query.get('priority') === 'DISTANCE') return Response.json({}, {status:429});
    if (query.get('priority') === 'RECOMMEND' && !query.has('avoid')) return Response.json({routes:[]});
    return Response.json({routes:[fast]});
  });
  const {status,body} = await request('/api/route-comparison');
  assert.equal(status,200);
  assert.equal(body.options[0].route.summary.duration,120);
  assert.match(body.options[1].error,/한도/);
  assert.match(body.options[2].error,/부족/);
  assert.match(body.options[3].error,/통행료 0원/);
  const legacy = await request('/api/routes',new URLSearchParams(trip.toString()+'&avoidTolls=true'));
  assert.equal(legacy.status,200);
  assert.deepEqual(legacy.body.routes,[fast]);
});

test('rejects invalid coordinates and reports a missing server credential without fetching',async t => {
  setKey(t,null);
  const mockedFetch = t.mock.method(globalThis,'fetch',() => assert.fail('unexpected upstream request'));
  assert.equal((await request('/api/route-comparison','origin=0,0&destination=127,36')).status,400);
  assert.equal((await request('/api/route-comparison')).status,503);
  assert.equal(mockedFetch.mock.callCount(),0);
});

test('preserves the order of five waypoints and rejects unsupported lists',async t => {
  setKey(t,'test-rest-key');
  const coords = ['127.42,36.34','127.43,36.34','127.44,36.34','127.45,36.34','127.46,36.34'];
  const params = new URLSearchParams({origin,destination});
  for (const point of coords) params.append('via',point);
  const upstream = t.mock.method(globalThis,'fetch',async address => {
    assert.equal(new URL(address).searchParams.get('waypoints'),coords.join('|'));
    return Response.json({routes:[route(120,4000,0,[[4000,4]])]});
  });
  assert.equal((await request('/api/route-comparison',params)).status,200);
  assert.equal(upstream.mock.callCount(),4);
  assert.equal((await request('/api/routes',new URLSearchParams({origin,destination,via:coords.join('|')}))).status,200);
  params.append('via','127.47,36.34');
  assert.equal((await request('/api/route-comparison',params)).status,400);
  assert.equal((await request('/api/routes',new URLSearchParams({origin,destination,via:'127.42,36.34|0,0'}))).status,400);
  assert.equal(upstream.mock.callCount(),5);
});

test('fetches a future summary with the requested departure time in Korea and no route geometry',async t => {
  setKey(t,'test-rest-key');
  t.mock.method(Date,'now',() => Date.parse('2026-11-20T14:45:52Z'));
  const expectedDepartures = ['202611210015','202611210045'];
  const upstream = t.mock.method(globalThis,'fetch',async (address,{headers}) => {
    const url = new URL(address);
    assert.equal(url.pathname,'/v1/future/directions');
    assert.equal(url.searchParams.get('departure_time'),expectedDepartures.shift());
    assert.equal(url.searchParams.get('waypoints'),via);
    assert.equal(url.searchParams.get('priority'),'TIME');
    assert.equal(url.searchParams.get('alternatives'),'false');
    assert.equal(url.searchParams.get('summary'),'true');
    assert.equal(headers.Authorization,'KakaoAK test-rest-key');
    return Response.json({routes:[null,{result_code:0,summary:{duration:840,distance:4000}}]});
  });
  const params = new URLSearchParams(trip);
  params.set('minutes','30');
  const result = await request('/api/future-route',params);
  assert.equal(result.status,200);
  assert.equal(result.body.departureAt,'2026-11-20T15:15:00.000Z');
  assert.equal(result.body.durationSeconds,840);
  assert.equal(result.body.distanceMeters,4000);
  assert.ok(Number.isFinite(Date.parse(result.body.fetchedAt)));

  params.set('minutes','60');
  const later = await request('/api/future-route',params);
  assert.equal(later.status,200);
  assert.equal(later.body.departureAt,'2026-11-20T15:45:00.000Z');

  params.set('minutes','-30');
  assert.equal((await request('/api/future-route',params)).status,400);
  params.delete('minutes');
  assert.equal((await request('/api/future-route',params)).status,400);
  assert.equal(upstream.mock.callCount(),2);
});
