const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const {handleTrafficSignals} = require('./traffic-signals.cjs');
const {handleRoutes} = require('./route-provider.cjs');

const signalPaths = new Set(['/api/intersections','/api/traffic-signals','/api/traffic-light-facilities']);
const routePaths = new Set(['/api/routes','/api/route-comparison','/api/future-route']);
const assets = new Map([
  ['/','route-agent-demo.html'], ['/route-agent-demo.html','route-agent-demo.html'],
  ...['app.js','map-view.js','signals.js','simulation.js','routing.js','driving.mjs','next-signal.mjs','navigation-guide.mjs','place-search.mjs','saved-places.mjs','map.css'].map(name=>['/'+name,name])
]);
const types = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css'};

function json(res, status, payload) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(payload));
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const send = (status,payload)=>json(res,status,payload);
  if (req.method !== 'GET') return send(405,{error:'지원하지 않는 요청입니다.'});
  if (url.pathname === '/api/map-config') {
    return send(200,{javascriptKey:process.env.KAKAO_MAP_JAVASCRIPT_KEY?.trim() || ''});
  }
  if (signalPaths.has(url.pathname) || routePaths.has(url.pathname)) {
    if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') {
      return send(403,{error:'앱 화면에서 다시 조회해 주세요.'});
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

http.createServer(handler).listen(Number(process.env.PORT || 8080),'127.0.0.1');
