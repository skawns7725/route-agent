import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readRecentSearches,recordRecentSearch,removeRecentSearch,writeRecentSearches} from './recent-searches.mjs';

const place = index => ({lat:37,lng:127+index/1000,name:'장소 '+index});

test('recent searches round-trip with the newest 20 places and promote duplicates by coordinate',() => {
  const values = new Map();
  const storage = {getItem:key => values.get(key),setItem:(key,value) => values.set(key,value)};
  let entries = [];
  for (let index=0;index<22;index++) entries = recordRecentSearch(entries,place(index),index);
  entries = recordRecentSearch(entries,{...place(5),name:'새 이름'},22);

  assert.equal(writeRecentSearches(storage,entries),true);
  entries = readRecentSearches(storage);
  assert.equal(entries.length,20);
  assert.equal(entries[0].name,'새 이름');
  assert.equal(entries[0].searchedAt,22);
  assert.equal(entries[1].name,'장소 21');
  assert.equal(entries.at(-1).name,'장소 2');
  assert.equal(entries.filter(entry => entry.lng === place(5).lng).length,1);

  writeRecentSearches(storage,removeRecentSearch(entries,place(5)));
  assert.equal(readRecentSearches(storage).length,19);
  writeRecentSearches(storage,[]);
  assert.deepEqual(readRecentSearches(storage),[]);
});

test('recent searches tolerate corrupt storage and skip ephemeral locations',() => {
  const storage = {getItem:() => 'corrupt'};
  assert.deepEqual(readRecentSearches(storage),[]);
  assert.equal(writeRecentSearches(storage,[]),false);
  assert.deepEqual(recordRecentSearch([],{...place(0),ephemeral:true},0),[]);
});
