import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readSavedPlaces,savePlace,removePlace,writeSavedPlaces} from './saved-places.mjs';

const place = (i=0)=>({lat:37.5+i/100,lng:127.1,name:'장소 '+i,address:'서울',phone:'비저장'});

test('stores only explicit searched places in the limited local schema',()=>{
  let raw;
  const storage = {getItem:()=>raw,setItem:(_,value)=>{raw=value;}};
  let book = readSavedPlaces(storage);
  assert.equal(savePlace(book,'home',{...place(),name:'현재 위치',ephemeral:true}),book);
  book = savePlace(book,'home',place());
  assert.ok(writeSavedPlaces(storage,book));
  assert.deepEqual(readSavedPlaces(storage).home,{lat:37.5,lng:127.1,name:'장소 0',address:'서울'});
  assert.equal(removePlace(book,'home',book.home).home,null);
});

test('keeps only five manually added recent destinations and deduplicates coordinates',()=>{
  let book=readSavedPlaces(null);
  for (let i=0;i<6;i++) book=savePlace(book,'recent',place(i));
  book=savePlace(book,'recent',place(1));
  assert.deepEqual(book.recent.map(({name})=>name),['장소 1','장소 5','장소 4','장소 3','장소 2']);
  assert.equal(removePlace(book,'recent',place(3)).recent.length,4);
});

test('handles corrupt or denied device-local storage',()=>{
  assert.deepEqual(readSavedPlaces({getItem:()=>'{invalid'}),{home:null,work:null,favorites:[],recent:[]});
  assert.equal(writeSavedPlaces({setItem(){throw Error('Denied');}},{}),false);
});
