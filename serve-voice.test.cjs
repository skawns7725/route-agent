const {randomUUID} = require('node:crypto');
const {once} = require('node:events');
const {createServer} = require('node:http');
const {test,before,after} = require('node:test');
const assert = require('node:assert/strict');
const {handler} = require('./serve.cjs');

const request = globalThis.fetch;
const key = randomUUID();
const previousKey = process.env.GEMINI_API_KEY;
const server = createServer(handler);
let origin;

before(async ()=>{
  process.env.GEMINI_API_KEY = key;
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  origin = 'http://127.0.0.1:'+server.address().port;
});
after(async ()=>{
  if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = previousKey;
  await new Promise(resolve=>server.close(resolve));
});

function post(data,headers = {}) {
  return request(origin+'/api/voice-command',{
    method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)
  });
}

function candidate(output) {
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[
    {thought:true,text:'internal thought'},{text:JSON.stringify(output)}
  ]}}]});
}

test('sends bounded route context to Gemini v1beta and returns the structured command',async t=>{
  const result = {action:'set_destination',place:'서울역',message:'서울역을 찾을게요.'};
  const upstream = t.mock.method(globalThis,'fetch',async (url,options)=>{
    assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    assert.equal(options.headers['x-goog-api-key'] === key,true);
    assert.equal(options.redirect,'error');
    const body = JSON.parse(options.body);
    assert.equal(body.generationConfig.responseMimeType,'application/json');
    assert.deepEqual(body.generationConfig.responseJsonSchema.required,['action','place','message']);
    assert.equal(body.generationConfig.responseJsonSchema.properties.action.enum.length,7);
    assert.equal(body.systemInstruction.parts.length,1);
    const {text,context} = JSON.parse(body.contents[0].parts[0].text);
    assert.equal(text,'서울역으로 가자');
    assert.deepEqual(context,{origin:'서울시청',destination:'',routeState:'editing',waypoints:['광화문'],
      savedPlaces:{home:'집 근처',work:'',favorites:['시청'],recent:[]}});
    return candidate(result);
  });
  const response = await post({text:' 서울역으로 가자 ',context:{origin:'서울시청',routeState:'editing',
    waypoints:['광화문'],savedPlaces:{home:'집 근처',favorites:['시청']},lat:37.58,requestSecret:'drop'}},
  {Origin:origin,'Sec-Fetch-Site':'same-origin'});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),result);
  assert.equal(upstream.mock.callCount(),1);
});

test('rejects cross-origin, empty text, invalid JSON and oversized input without using the API',async t=>{
  const upstream = t.mock.method(globalThis,'fetch',async()=>{throw Error('unexpected upstream call');});
  assert.equal((await post({text:'test'},{Origin:'https://outside.example'})).status,403);
  assert.equal((await post({text:'test'},{'Sec-Fetch-Site':'same-site'})).status,403);
  assert.equal((await post({text:'  '})).status,400);
  assert.equal((await request(origin+'/api/voice-command',{method:'POST',body:'{'})).status,400);
  assert.equal((await post({text:'x'.repeat(17000)})).status,413);
  assert.equal(upstream.mock.callCount(),0);
});

test('reports a missing key without attempting generation',async t=>{
  delete process.env.GEMINI_API_KEY;
  t.after(()=>{process.env.GEMINI_API_KEY = key;});
  const upstream = t.mock.method(globalThis,'fetch',async()=>{throw Error('unexpected upstream call');});
  const response = await post({text:'안내 다시 읽어 줘'});
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{action:'unknown',place:null,message:'Gemini API 키를 설정해 주세요'});
  assert.equal(upstream.mock.callCount(),0);
});

test('returns 429 for the quota and omits upstream error details',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({error:{message:key}},{status:429}));
  const response = await post({text:'경로 읽어 줘'});
  assert.equal(response.status,429);
  assert.deepEqual(await response.json(),{action:'unknown',place:null,message:'Gemini API 사용 한도를 초과했어요.'});
});

test('rejects unsupported actions and replies whose place does not match the action',async t=>{
  const upstream = t.mock.method(globalThis,'fetch',async()=>candidate({action:'change_settings',place:null,message:'test'}));
  assert.equal((await post({text:'경로 읽어 줘'})).status,502);
  upstream.mock.mockImplementation(async()=>candidate({action:'add_waypoint',place:null,message:'test'}));
  assert.equal((await post({text:'여기 들르자'})).status,502);
  upstream.mock.mockImplementation(async()=>candidate({action:'repeat_instruction',place:null,message:'다음 안내를 확인할게요.'}));
  assert.equal((await post({text:'다시 말해줘'})).status,200);
});
