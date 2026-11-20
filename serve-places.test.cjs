const {randomUUID} = require('node:crypto');
const {once} = require('node:events');
const http = require('node:http');
const {test,before,after} = require('node:test');
const assert = require('node:assert/strict');
const {handler} = require('./serve.cjs');

const request = globalThis.fetch;
const server = http.createServer(handler);
const keyName = 'KAKAO_MOBILITY_REST_KEY';
const testKey = randomUUID();
let baseUrl;
let originalKey;

before(async ()=>{
  originalKey = process.env[keyName];
  process.env[keyName] = testKey;
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  baseUrl = 'http://127.0.0.1:'+server.address().port;
});

after(async ()=>{
  if (originalKey === undefined) delete process.env[keyName];
  else process.env[keyName] = originalKey;
  await new Promise((resolve,reject)=>server.close(error=>error ? reject(error) : resolve()));
});

function mockLocal(t, findDocuments) {
  return t.mock.method(globalThis,'fetch',async (url,options)=>{
    assert.equal(url.origin,'https://dapi.kakao.com');
    assert.equal(options.headers.Authorization,'KakaoAK '+testKey);
    assert.equal(options.redirect,'error');
    return Response.json({documents:findDocuments(url)});
  });
}

test('normalizes Kakao keyword results and keeps the REST credential server-side',async t=>{
  const upstream = mockLocal(t,url=>{
    assert.equal(url.pathname,'/v2/local/search/keyword.json');
    assert.equal(url.searchParams.get('query'),'서울시청 & 카페');
    return [
      {place_name:'서울시청',road_address_name:'서울 중구 세종대로 110',address_name:'서울 중구 태평로1가 31',
        x:'126.978',y:'37.566',category_name:'공공기관 > 시청',phone:'02-123-4567'},
      {place_name:'좌표 누락',x:'',y:'37.566'},
      {place_name:'좌표 범위 오류',x:'180.1',y:'37.566'},
      null
    ];
  });
  const response = await request(baseUrl+'/api/places?'+new URLSearchParams({keyword:' 서울시청 & 카페 '}),{
    headers:{'Sec-Fetch-Site':'same-origin',Origin:baseUrl}
  });
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{places:[
    {name:'서울시청',address:'서울 중구 세종대로 110',lat:37.566,lng:126.978,category:'시청',phone:'02-123-4567'}
  ]});
  assert.equal(upstream.mock.callCount(),1);
});

test('falls back to Kakao address search only after a successful empty keyword response',async t=>{
  const address = '서울 중구 세종대로 110';
  const upstream = mockLocal(t,url=>{
    assert.equal(url.searchParams.get('query'),address);
    if (url.pathname === '/v2/local/search/keyword.json') return [];
    assert.equal(url.pathname,'/v2/local/search/address.json');
    return [{address_name:address,x:'126.978',y:'37.566'}];
  });
  const response = await request(baseUrl+'/api/places?'+new URLSearchParams({keyword:address}));
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{places:[
    {name:address,address,lat:37.566,lng:126.978,category:'',phone:''}
  ]});
  assert.equal(upstream.mock.callCount(),2);
});

test('looks up up to ten parking results within 1 km and preserves a distance of zero',async t=>{
  mockLocal(t,url=>{
    assert.equal(url.pathname,'/v2/local/search/category.json');
    assert.deepEqual(Object.fromEntries(url.searchParams),
      {category_group_code:'PK6',x:'129.31',y:'35.53',radius:'1000',sort:'distance',size:'10'});
    return [
      {place_name:'공영주차장',x:'129.31',y:'35.53',distance:'0'},
      {place_name:'거리 미제공',x:'129.32',y:'35.53',distance:''},
      {place_name:'좌표 누락',y:'35.53',distance:'25'}
    ];
  });
  const response = await request(baseUrl+'/api/parking?lat=35.53&lng=129.31');
  assert.equal(response.status,200);
  const {places} = await response.json();
  assert.deepEqual(places.map(({name,distance})=>[name,distance]),[['공영주차장',0],['거리 미제공',null]]);
});

test('collapses parking records by name and address or exact coordinates',async t=>{
  const address = '서울 중구 한강대로 405';
  const original = {place_name:'커넥트플레이스 마켓존 주차장',road_address_name:address,x:'126.97',y:'37.55',distance:'75'};
  mockLocal(t,()=>[
    original,
    {...original,x:'126.9701'},
    {...original,x:'126.9702'},
    {...original,place_name:'별칭 주차장',x:'126.97020',road_address_name:'서울 중구 다른 주소'},
    {...original,place_name:'별도 주차장',x:'126.971',distance:'90'},
    {...original,road_address_name:'서울 중구 별도 주소',x:'126.972',distance:'155'}
  ]);
  const response = await request(baseUrl+'/api/parking?lat=37.55&lng=126.97');
  assert.equal(response.status,200);
  const {places} = await response.json();
  assert.deepEqual(places.map(({name,address,distance})=>[name,address,distance]),[
    [original.place_name,address,75],
    ['별도 주차장',address,90],
    [original.place_name,'서울 중구 별도 주소',155]
  ]);
});

test('rejects foreign origins and invalid input before attempting Kakao requests',async t=>{
  const upstream = t.mock.method(globalThis,'fetch',async()=>{throw new Error('unexpected upstream call');});
  const search = '/api/places?keyword=test';
  const parking = '/api/parking?lat=35.53&lng=129.31';
  for (const path of [search,parking]) {
    assert.equal((await request(baseUrl+path,{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
    assert.equal((await request(baseUrl+path,{headers:{Origin:'https://other.example'}})).status,403);
  }
  for (const path of ['/api/places?keyword=+','/api/parking?lat=&lng=0','/api/parking?lat=91&lng=0']) {
    assert.equal((await request(baseUrl+path)).status,400);
  }
  assert.equal(upstream.mock.callCount(),0);
});

test('returns a safe error when Kakao rejects authorization, without address fallback',async t=>{
  const upstream = t.mock.method(globalThis,'fetch',async()=>Response.json({providerMessage:testKey},{status:401}));
  const response = await request(baseUrl+'/api/places?keyword=test');
  assert.equal(response.status,502);
  assert.deepEqual(await response.json(),{error:'장소를 가져오지 못했어요.'});
  assert.equal(upstream.mock.callCount(),1);
});

test('returns a service error when the existing REST key is unset',async t=>{
  delete process.env[keyName];
  t.after(()=>{process.env[keyName] = testKey;});
  const upstream = t.mock.method(globalThis,'fetch',async()=>{throw new Error('unexpected upstream call');});
  const response = await request(baseUrl+'/api/places?keyword=test');
  assert.equal(response.status,503);
  assert.equal(upstream.mock.callCount(),0);
});
