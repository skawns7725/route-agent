const endpoint = 'https://apis-navi.kakaomobility.com/v1/directions';
const comparisonRequests = [
  {kind:'fast', priority:'TIME'},
  {kind:'short', priority:'DISTANCE'},
  {kind:'traffic', priority:'RECOMMEND'},
  {kind:'free', priority:'TIME', avoidTolls:true}
];
const knownTraffic = new Set([1,2,3,4,6]);
const congestedTraffic = new Set([1,2,6]);

function validPoint(value) {
  if (!value || !/^\d+(?:\.\d+)?,\d+(?:\.\d+)?$/.test(value)) return false;
  const [lng, lat] = value.split(',').map(Number);
  return lng >= 124 && lng <= 132 && lat >= 32 && lat <= 40;
}

function routeRoads(route) {
  return (route.sections || []).flatMap(section => section.roads || []);
}

function usableRoute(route) {
  const {duration, distance} = route.summary || {};
  return route.result_code === 0 && Number.isFinite(duration) && duration > 0 &&
    Number.isFinite(distance) && distance > 0 &&
    routeRoads(route).some(road => Array.isArray(road.vertexes) && road.vertexes.length >= 4);
}

function measureTraffic(route) {
  let surveyed = 0;
  let congested = 0;
  for (const {distance, traffic_state:state} of routeRoads(route)) {
    if (!Number.isFinite(distance) || distance <= 0 || !knownTraffic.has(state)) continue;
    surveyed += distance;
    if (congestedTraffic.has(state)) congested += distance;
  }
  if (!surveyed) return null;
  return {
    surveyed,
    congested,
    coverage:Math.min(1,surveyed / route.summary.distance),
    share:congested / surveyed
  };
}

async function requestRoutes(trip, key, {priority, avoidTolls}) {
  const params = new URLSearchParams({
    origin:trip.origin, destination:trip.destination, priority,
    alternatives:'true', summary:'false', roadevent:'0'
  });
  if (trip.via) params.set('waypoints', trip.via);
  if (avoidTolls) params.set('avoid','toll');
  try {
    const reply = await fetch(endpoint+'?'+params,{
      headers:{Authorization:'KakaoAK '+key},
      signal:AbortSignal.timeout(10000)
    });
    if (reply.status === 401 || reply.status === 403) {
      return {status:502, error:'카카오모빌리티 API 인증 또는 사용 권한을 확인해 주세요.'};
    }
    if (reply.status === 429) return {status:503, error:'길찾기 API 조회 한도를 초과했어요.'};
    if (!reply.ok) throw Error('route provider');
    const data = await reply.json();
    const routes = (data.routes || []).filter(usableRoute);
    if (!routes.length) return {status:422, error:'조건에 맞는 자동차 경로를 찾지 못했어요.'};
    return {status:200, routes};
  } catch {
    return {status:502, error:'교통 반영 경로를 가져오지 못했어요. 다시 시도해 주세요.'};
  }
}

const byTime = (a,b) => a.summary.duration-b.summary.duration || a.summary.distance-b.summary.distance;
const byDistance = (a,b) => a.summary.distance-b.summary.distance || a.summary.duration-b.summary.duration;

async function compareRoutes(trip, key, json) {
  const responses = await Promise.all(comparisonRequests.map(mode => requestRoutes(trip,key,mode)));
  const available = responses.flatMap(response => response.routes || []);
  if (!available.length) {
    const failure = responses.find(response => response.status !== 422) || responses[0];
    return json(failure.status,{error:failure.error});
  }

  const traffic = available.map(route => ({route,traffic:measureTraffic(route)}))
    .filter(candidate => candidate.traffic?.coverage >= 0.5)
    .sort((a,b) => a.traffic.share-b.traffic.share || b.traffic.coverage-a.traffic.coverage || byTime(a.route,b.route))[0];
  const free = available.filter(route => route.summary.fare?.toll === 0).sort(byTime)[0];
  const fastest = responses[0].routes && [...responses[0].routes].sort(byTime)[0];
  const shortest = responses[1].routes && [...responses[1].routes].sort(byDistance)[0];

  function option(kind, route, error) {
    return route ? {kind, route, traffic:measureTraffic(route)} : {kind, error};
  }
  return json(200,{
    fetchedAt:new Date().toISOString(),
    options:[
      option('fast',fastest,responses[0].error),
      option('short',shortest,responses[1].error),
      option('traffic',traffic?.route,'비교에 필요한 교통 정보가 부족해요.'),
      option('free',free,responses[3].error || '통행료 0원이 확인된 경로가 없어요.')
    ]
  });
}

async function handleRoutes(url, json) {
  const {origin, destination, via, avoidTolls} = Object.fromEntries(url.searchParams);
  if (!validPoint(origin) || !validPoint(destination) || (via && !validPoint(via))) {
    return json(400, {error:'출발·도착·경유 좌표를 확인해 주세요.'});
  }
  const key = process.env.KAKAO_MOBILITY_REST_KEY?.trim();
  if (!key) return json(503, {error:'서버에 카카오모빌리티 길찾기 키가 설정되지 않았어요.'});
  const trip = {origin, destination, via};
  if (url.pathname === '/api/route-comparison') return compareRoutes(trip,key,json);

  const {status,routes,error} = await requestRoutes(trip,key,{priority:'RECOMMEND',avoidTolls:avoidTolls === 'true'});
  return json(status,routes ? {routes,fetchedAt:new Date().toISOString()} : {error});
}

module.exports = {handleRoutes};
