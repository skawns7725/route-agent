import test from 'node:test';
import assert from 'node:assert/strict';
import {createParkingLookup, createPlaceLookup, naverPlaceUrl} from './place-search.mjs';

const Status = {OK:'OK', ZERO_RESULT:'ZERO_RESULT', ERROR:'ERROR'};
const sdkFor = (keywordSearch,addressSearch)=>({services:{
  Status,
  Places:class { keywordSearch = keywordSearch; },
  Geocoder:class { addressSearch = addressSearch; }
}});

test('uses Kakao place details and rejects results without valid coordinates', async ()=>{
  const lookup = createPlaceLookup(sdkFor((keyword,reply)=>{
    assert.equal(keyword,'서울역');
    reply([
      {place_name:'서울역',road_address_name:'서울 중구 한강대로 405', x:'126.97',y:'37.55',
        category_name:'교통,수송 > 기차역',phone:'02-123-4567'},
      {place_name:'잘못된 결과',x:'',y:'37.55'}
    ],Status.OK);
  }));
  assert.deepEqual(await lookup('서울역'),[
    {name:'서울역', address:'서울 중구 한강대로 405',lng:126.97,lat:37.55,category:'기차역',phone:'02-123-4567'}
  ]);
});

test('falls back to address search for zero results and preserves provider errors', async ()=>{
  const address = '서울 중구 한강대로 405';
  const lookup = createPlaceLookup(sdkFor((_,reply)=>reply([],Status.ZERO_RESULT),(keyword,reply)=>{
    assert.equal(keyword,address);
    reply([{address_name:address,x:'126.97',y:'37.55'}],Status.OK);
  }));
  assert.equal((await lookup(address))[0].name,address);
  const failing = createPlaceLookup(sdkFor((_,reply)=>reply([],Status.ERROR)));
  await assert.rejects(failing(address),/장소를 가져오지/);
});

test('uses an encoded place name and address for the Naver Map destination', ()=>{
  const place = {name:'카페 A&B',address:'서울 중구 한강대로 405'};
  const url = new URL(naverPlaceUrl(place));
  assert.equal(url.origin,'https://map.naver.com');
  assert.equal(decodeURIComponent(url.pathname),'/p/search/카페 A&B 서울 중구 한강대로 405');
  assert.equal(decodeURIComponent(new URL(naverPlaceUrl({name:place.address,address:place.address})).pathname),
    '/p/search/서울 중구 한강대로 405');
});

test('finds parking around the destination and keeps distance zero separate from missing distance', async ()=>{
  const calls = [];
  class Places {
    categorySearch(code,callback,options) {
      calls.push({code,options});
      callback([
        {place_name:'공영주차장', road_address_name:'서울 중구 테스트로 10', x:'126.97', y:'37.55', distance:'0'},
        {place_name:'거리 미제공', x:'126.98', y:'37.55', distance:''},
        {place_name:'잘못된 좌표', x:'', y:'37.55', distance:'35'}
      ],Status.OK);
    }
  }
  const lookup = createParkingLookup({
    LatLng:class { constructor(lat,lng) {this.lat = lat; this.lng = lng;} },
    services:{Status,Places,SortBy:{DISTANCE:'distance'}}
  });
  const results = await lookup({lat:37.55,lng:126.97});
  assert.equal(calls[0].code,'PK6');
  assert.equal(calls[0].options.location.lat,37.55);
  assert.equal(calls[0].options.location.lng,126.97);
  assert.equal(calls[0].options.radius,1000);
  assert.equal(calls[0].options.sort,'distance');
  assert.deepEqual(results.map(({name,distance})=>[name,distance]),[
    ['공영주차장',0],['거리 미제공',null]
  ]);
  await assert.rejects(lookup({lat:91,lng:126.97}),/도착지 위치/);
  assert.equal(calls.length,1);
});

test('distinguishes no nearby parking from a provider lookup error', async ()=>{
  class LatLng {}
  const destination = {lat:37.55,lng:126.97};
  const withStatus = status=>createParkingLookup({LatLng,services:{
    Status,SortBy:{DISTANCE:'distance'},
    Places:class { categorySearch(_,callback) {callback([],status);} }
  }});
  assert.deepEqual(await withStatus(Status.ZERO_RESULT)(destination),[]);
  await assert.rejects(withStatus(Status.ERROR)(destination),/주차장을 가져오지/);
});
