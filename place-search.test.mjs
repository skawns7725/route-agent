import test from 'node:test';
import assert from 'node:assert/strict';
import {createParkingLookup, createPlaceLookup, matchPresetPlace, naverPlaceUrl, routePresets} from './place-search.mjs';

const seoulStation = {
  name:'서울역',address:'서울 중구 한강대로 405',lng:126.97,lat:37.55,category:'기차역',phone:'02-123-4567'
};

test('place lookup uses the same-origin proxy and encodes the keyword', async t=>{
  const fetchMock = t.mock.method(globalThis,'fetch',async url=>{
    assert.equal(url,'/api/places?keyword=%EC%84%9C%EC%9A%B8%EC%97%AD+%26+%EC%B6%9C%EA%B5%AC');
    return new Response(JSON.stringify({places:[seoulStation]}));
  });
  assert.deepEqual(await createPlaceLookup()('서울역 & 출구'),[seoulStation]);
  assert.equal(fetchMock.mock.callCount(),1);
});

test('parking lookup sends coordinates to the proxy and rejects invalid destinations before fetching', async t=>{
  const parking = {...seoulStation,name:'공영주차장',distance:0};
  const fetchMock = t.mock.method(globalThis,'fetch',async url=>{
    assert.equal(url,'/api/parking?lat=37.55&lng=126.97');
    return new Response(JSON.stringify({places:[parking]}));
  });
  const lookup = createParkingLookup();
  assert.deepEqual(await lookup({lat:37.55,lng:126.97}),[parking]);
  await assert.rejects(lookup({lat:91,lng:126.97}),/도착지 위치/);
  assert.equal(fetchMock.mock.callCount(),1);
});

test('distinguishes an empty proxy result from a failed search', async t=>{
  const destination = {lat:37.55,lng:126.97};
  const fetchMock = t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({places:[]})));
  assert.deepEqual(await createParkingLookup()(destination),[]);
  fetchMock.mock.mockImplementation(async()=>new Response('upstream error',{status:502}));
  await assert.rejects(createParkingLookup()(destination),/주차장을 가져오지/);
});

test('uses an encoded place name and address for the Naver Map destination', ()=>{
  const place = {name:'카페 A&B',address:'서울 중구 한강대로 405'};
  const url = new URL(naverPlaceUrl(place));
  assert.equal(url.origin,'https://map.naver.com');
  assert.equal(decodeURIComponent(url.pathname),'/p/search/카페 A&B 서울 중구 한강대로 405');
  assert.equal(decodeURIComponent(new URL(naverPlaceUrl({name:place.address,address:place.address})).pathname),
    '/p/search/서울 중구 한강대로 405');
});

test('matches both presets by name and address regardless of result order', ()=>{
  const cityHall = {name:'서울특별시청',address:'서울특별시 중구 세종대로 110'};
  const rotary = {name:'태화로터리',address:'울산광역시 남구 신정동 1507-5'};
  const ulsanHall = {name:'울산광역시청',address:'울산 남구 중앙로 201'};
  const cases = [
    [routePresets.seoul[0],cityHall,{...cityHall,name:'서울특별시청별관'}],
    [routePresets.seoul[1],seoulStation,{...seoulStation,name:'서울역 1번출구'}],
    [routePresets.ulsan[0],rotary,{...rotary,name:'태화로터리정류소'}],
    [routePresets.ulsan[1],ulsanHall,{...ulsanHall,name:'울산광역시청 본관 시민홀'}]
  ];
  for (const [target,place,nearby] of cases) {
    assert.equal(matchPresetPlace([nearby,{...place,address:'다른 주소'},place],target),place);
    assert.equal(matchPresetPlace([nearby],target),null);
  }
});

test('leaves missing and conflicting preset matches unresolved', ()=>{
  const target = routePresets.seoul[1];
  const station = {...seoulStation,name:'서울역 경부선(고속철도)',address:'서울  용산구 한강대로 405'};
  assert.equal(matchPresetPlace([],target),null);
  assert.equal(matchPresetPlace([station,{...station}],target),station);
  assert.equal(matchPresetPlace([station,{...station,lat:37.56}],target),null);
});
