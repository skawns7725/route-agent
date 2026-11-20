const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {handleTrafficSignals} = require('./traffic-signals.cjs');
const {handleRoutes} = require('./route-provider.cjs');

const signalPaths = new Set(['/api/intersections','/api/traffic-signals','/api/traffic-light-facilities']);
const routePaths = new Set(['/api/routes','/api/route-comparison','/api/future-route']);
const placePaths = new Set(['/api/places','/api/parking']);
const parkingRadius = 1000;
const assets = new Map([
  ['/','route-agent-demo.html'], ['/route-agent-demo.html','route-agent-demo.html'],
  ...['app.js','map-view.js','signals.js','simulation.js','routing.js','driving.mjs','gps-departure.mjs','next-signal.mjs','navigation-guide.mjs','place-search.mjs','saved-places.mjs','recent-searches.mjs','map.css'].map(name=>['/'+name,name])
]);
const types = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css'};

function json(res, status, payload) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(payload));
}

const cleanText = value => typeof value === 'string' ? value.trim() : '';

function coordinate(value, limit) {
  if (!String(value ?? '').trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

function normalizePlace(item) {
  const address = cleanText(item?.road_address_name) || cleanText(item?.road_address?.address_name) ||
    cleanText(item?.address_name);
  const name = cleanText(item?.place_name) || address;
  const lat = coordinate(item?.y,90);
  const lng = coordinate(item?.x,180);
  if (!name || lat === null || lng === null) return null;
  return {name,address,lat,lng,category:cleanText(item.category_name).split('>').at(-1).trim(),phone:cleanText(item.phone)};
}

function uniqueParking(places) {
  const samePlace = (a,b)=>(a.lat === b.lat && a.lng === b.lng) ||
    (a.address && a.address === b.address && a.name === b.name);
  const groups = [];
  for (const place of places) {
    const matches = groups.filter(group=>group.some(record=>samePlace(record,place)));
    const [first,...duplicates] = matches;
    if (!first) {
      groups.push([place]);
      continue;
    }
    first.push(place);
    for (const group of duplicates) {
      first.push(...group);
      groups.splice(groups.indexOf(group),1);
    }
  }
  return groups.map(([first])=>first);
}

async function localDocuments(search, params, key, signal) {
  const url = new URL('https://dapi.kakao.com/v2/local/search/'+search+'.json');
  url.search = new URLSearchParams(params);
  const response = await fetch(url,{headers:{Authorization:'KakaoAK '+key},signal,redirect:'error'});
  if (!response.ok) throw new Error('카카오 로컬 API 요청 실패');
  const data = await response.json();
  if (!Array.isArray(data?.documents)) throw new Error('카카오 로컬 API 응답 형식 오류');
  return data.documents;
}

async function handlePlaceSearch(url, send) {
  const parking = url.pathname === '/api/parking';
  let params;
  if (parking) {
    const lat = coordinate(url.searchParams.get('lat'),90);
    const lng = coordinate(url.searchParams.get('lng'),180);
    if (lat === null || lng === null) return send(400,{error:'도착지 위치를 확인할 수 없어요.'});
    params = {category_group_code:'PK6',x:lng,y:lat,radius:parkingRadius,sort:'distance',size:10};
  } else {
    const query = cleanText(url.searchParams.get('keyword'));
    if (!query || query.length > 150) return send(400,{error:'검색어를 1~150자로 입력해 주세요.'});
    params = {query};
  }
  const key = process.env.KAKAO_MOBILITY_REST_KEY?.trim();
  if (!key) return send(503,{error:'서버의 카카오 REST 키 설정을 확인해 주세요.'});

  try {
    const signal = AbortSignal.timeout(8000);
    let documents = await localDocuments(parking ? 'category' : 'keyword',params,key,signal);
    if (!parking && !documents.length) documents = await localDocuments('address',params,key,signal);
    const places = [];
    for (const item of documents) {
      const place = normalizePlace(item);
      if (!place) continue;
      if (parking) {
        const raw = String(item.distance ?? '').trim();
        place.distance = /^\d+$/.test(raw) && Number(raw) <= parkingRadius ? Number(raw) : null;
      }
      places.push(place);
    }
    return send(200,{places:parking ? uniqueParking(places) : places});
  } catch {
    return send(502,{error:parking ? '주차장을 가져오지 못했어요.' : '장소를 가져오지 못했어요.'});
  }
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const send = (status,payload)=>json(res,status,payload);
  if (req.method !== 'GET') return send(405,{error:'지원하지 않는 요청입니다.'});
  if (url.pathname === '/api/map-config') {
    return send(200,{javascriptKey:process.env.KAKAO_MAP_JAVASCRIPT_KEY?.trim() || ''});
  }
  if (signalPaths.has(url.pathname) || routePaths.has(url.pathname) || placePaths.has(url.pathname)) {
    if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') {
      return send(403,{error:'앱 화면에서 다시 조회해 주세요.'});
    }
    if (placePaths.has(url.pathname)) {
      const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      if (req.headers.origin && req.headers.origin !== protocol+'://'+req.headers.host) {
        return send(403,{error:'앱 화면에서 다시 조회해 주세요.'});
      }
      return handlePlaceSearch(url,send);
    }
    return signalPaths.has(url.pathname) ? handleTrafficSignals(url,send) : handleRoutes(url,send);
  }
  const asset = assets.get(url.pathname);
  if (!asset) return send(404,{error:'페이지를 찾을 수 없어요.'});
  try {
    const bytes = await fs.readFile(path.join(__dirname,asset));
    res.writeHead(200,{'Content-Type':types[path.extname(asset)]+'; charset=utf-8','Cache-Control':'no-cache'});
    res.end(bytes);
  } catch {
    send(500,{error:'화면을 불러오지 못했어요.'});
  }
}

if (require.main === module) {
  http.createServer(handler).listen(Number(process.env.PORT || 8080),'127.0.0.1');
}
module.exports = {handler};
