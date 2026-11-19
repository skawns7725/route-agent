import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaceLookup, naverPlaceUrl} from './place-search.mjs';

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
