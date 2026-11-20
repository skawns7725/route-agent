import test from 'node:test';
import assert from 'node:assert/strict';
import {createMap} from './map-view.js';

test('enables and removes the Kakao traffic overlay through the map control', async t=>{
  const overlays = [];
  const attributes = new Map();
  const button = {disabled:true,setAttribute:(name,value)=>attributes.set(name,value)};
  const elements = new Map([
    ['exampleMap',{getContext:()=>null,addEventListener(){}}],
    ['mapTrafficToggle',button],
    ['workspace',{classList:{toggle(){},remove(){},add(){}}}]
  ]);
  const replaceGlobal = (name,value)=>{
    const descriptor = Object.getOwnPropertyDescriptor(globalThis,name);
    Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
    t.after(()=>{
      if (descriptor) Object.defineProperty(globalThis,name,descriptor);
      else delete globalThis[name];
    });
  };
  replaceGlobal('document',{
    getElementById(id) {
      if (!elements.has(id)) elements.set(id,{});
      return elements.get(id);
    },
    querySelector:()=>({}),
    createElement:()=>({}),
    head:{append:script=>queueMicrotask(()=>script.onload())}
  });
  replaceGlobal('window',{kakao:{maps:{
    load:onReady=>onReady(),
    Map:class {
      relayout() {}
      addOverlayMapTypeId(id) {overlays.push(['add',id]);}
      removeOverlayMapTypeId(id) {overlays.push(['remove',id]);}
    },
    LatLng:class {},
    event:{addListener(){}},
    MapTypeId:{TRAFFIC:7}
  }}});
  replaceGlobal('ResizeObserver',class {observe(){}});
  t.mock.method(globalThis,'fetch',async()=>({ok:true,json:async()=>({javascriptKey:'test-key'})}));
  const map = createMap([]);
  assert.equal(button.disabled,true);
  button.onclick();
  assert.deepEqual(overlays,[]);
  await map.connect();
  assert.equal(button.disabled,false);
  button.onclick();
  assert.equal(attributes.get('aria-pressed'),'true');
  button.onclick();
  assert.equal(attributes.get('aria-pressed'),'false');
  assert.deepEqual(overlays,[['add',7],['remove',7]]);
});
