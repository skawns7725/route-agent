const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {handleTrafficSignals} = require('./traffic-signals.cjs');

const provider = 'https://apis-navi.kakaomobility.com/v1/directions';
function validPoint(value) {
  if (!value || !/^\d+(?:\.\d+)?,\d+(?:\.\d+)?$/.test(value)) return false;
  const [lng, lat] = value.split(',').map(Number);
  return lng >= 124 && lng <= 132 && lat >= 32 && lat <= 40;
}
function json(res, status, payload) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(payload));
}
async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET') return json(res, 405, {error:'지원하지 않는 요청입니다.'});
  if (url.pathname === '/api/map-config') {
    return json(res, 200, {javascriptKey:process.env.KAKAO_MAP_JAVASCRIPT_KEY?.trim() || ''});
  }
  if (['/api/intersections','/api/traffic-signals','/api/traffic-light-facilities'].includes(url.pathname)) {
    if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') {
      return json(res, 403, {error:'앱 화면에서 다시 조회해 주세요.'});
    }
    return handleTrafficSignals(url, (status, payload) => json(res, status, payload));
  }
  if (url.pathname === '/api/routes') {
    if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') {
      return json(res, 403, {error:'앱 화면에서 다시 조회해 주세요.'});
    }
    const {origin, destination, via, avoidTolls} = Object.fromEntries(url.searchParams);
    if (!validPoint(origin) || !validPoint(destination) || (via && !validPoint(via))) {
      return json(res, 400, {error:'출발·도착·경유 좌표를 확인해 주세요.'});
    }
    const key = process.env.KAKAO_MOBILITY_REST_KEY?.trim();
    if (!key) return json(res, 503, {error:'서버에 카카오모빌리티 길찾기 키가 설정되지 않았어요.'});
    const params = new URLSearchParams({origin,destination,priority:'RECOMMEND',alternatives:'true',summary:'false',roadevent:'0'});
    if (via) params.set('waypoints',via);
    if (avoidTolls === 'true') params.set('avoid','toll');
    try {
      const reply = await fetch(provider+'?'+params, {headers:{Authorization:'KakaoAK '+key},signal:AbortSignal.timeout(10000)});
      if (reply.status === 401 || reply.status === 403) return json(res,502,{error:'카카오모빌리티 API 인증 또는 사용 권한을 확인해 주세요.'});
      if (reply.status === 429) return json(res,503,{error:'길찾기 API 조회 한도를 초과했어요.'});
      if (!reply.ok) throw Error('route provider');
      const data = await reply.json();
      const routes = (data.routes || []).filter(r=>r.result_code===0 && r.sections?.some(s=>s.roads?.length));
      if (!routes.length) return json(res,422,{error:'조건에 맞는 자동차 경로를 찾지 못했어요.'});
      return json(res,200,{routes,fetchedAt:new Date().toISOString()});
    } catch {
      return json(res,502,{error:'교통 반영 경로를 가져오지 못했어요. 다시 시도해 주세요.'});
    }
  }
  if (!['/','/route-agent-demo.html'].includes(url.pathname)) return json(res,404,{error:'페이지를 찾을 수 없어요.'});
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  fs.createReadStream(path.join(__dirname,'route-agent-demo.html')).pipe(res);
}
http.createServer(handler).listen(Number(process.env.PORT || 8080),'127.0.0.1');
