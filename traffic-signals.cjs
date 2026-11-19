const nationwide = 'https://apis.data.go.kr/B551982/rti';
const daejeon = 'https://apis.data.go.kr/6300000/GetTrsnListService1/getTrsnList1';
const districts = new Set(['대덕구','동구','서구','유성구','중구']);
const facilityTypes = {'01':'차량등','02':'보행등','03':'버스 신호등','04':'자전거 신호등','05':'차량 보조등','06':'경보등','07':'가변등','99':'기타'};
const lensTypes = {'01':'1색등','02':'2색등','03':'3색등','04':'4색등','99':'기타'};
const regionCodes = new Set(['11', '26', '27', '28', '29', '30', '31', '36', '41', '43', '44', '46', '47', '48', '50', '51', '52'].map(code => code + '00000000'));
const directions = {nt:'북쪽', ne:'북동쪽', et:'동쪽', se:'남동쪽', st:'남쪽', sw:'남서쪽', wt:'서쪽', nw:'북서쪽'};
const movements = {Stsg:'직진', Ltsg:'좌회전', Utsg:'유턴', Pdsg:'보행', Bssg:'버스', Bcsg:'자전거'};
const states = new Map([
  ['stop-And-Remain', '정지'],
  ['stop-Then-Proceed', '일시정지 후 진행'],
  ['protected-Movement-Allowed', '보호 진행'],
  ['permissive-Movement-Allowed', '비보호 진행'],
  ['protected-clearance', '보호 진행 종료'],
  ['permissive-clearance', '비보호 진행 종료'],
  ['caution-Conflicting-Traffic', '주의'],
  ['dark', '소등']
]);
const pageSize = 1000;
const cache = new Map();

async function fetchPages(endpoint, filters, key) {
  const rows = [];
  const signal = AbortSignal.timeout(10000);
  // Bound upstream work even when the provider reports an inconsistent count.
  for (let pageNo = 1; pageNo <= 20; pageNo++) {
    const params = new URLSearchParams({serviceKey:key, type:'json', pageNo, numOfRows:pageSize, ...filters});
    const reply = await fetch(endpoint + '?' + params, {signal, redirect:'error'});
    if (!reply.ok) throw new Error('Signal upstream error');
    const payload = await reply.json();
    const response = payload.response ?? payload;
    const code = String(response?.header?.resultCode);
    if (['K3','03','3'].includes(code)) return rows;
    if (!['K0','00','0'].includes(code)) throw new Error('Signal API rejected the request');
    const body = response.body;
    if (!body || !/^\d+$/.test(String(body.totalCount))) throw new Error('Invalid signal payload');
    const count = Number(body.totalCount);
    if (count === 0) return rows;
    const items = Array.isArray(body.items) ? body.items : body.items?.item;
    const page = Array.isArray(items) ? items : items && typeof items === 'object' ? [items] : [];
    if (!page.length) throw new Error('Missing signal rows');
    rows.push(...page.filter(row => row && typeof row === 'object'));
    // Use the provider's effective page size if it caps numOfRows.
    const size = Number(body.numOfRows) || page.length;
    if (pageNo * size >= count) return rows;
  }
  throw new Error('Signal response exceeds page limit');
}

function cachedRows(endpoint, filters, key, ttl) {
  const cacheKey = endpoint + '?' + new URLSearchParams(filters);
  const current = cache.get(cacheKey);
  if (current && current.expiresAt > Date.now()) return current.rows;
  const entry = {expiresAt:Infinity};
  entry.rows = fetchPages(endpoint, filters, key).then(rows => {
    entry.expiresAt = Date.now() + ttl;
    return rows;
  }, error => {
    cache.delete(cacheKey);
    throw error;
  });
  cache.set(cacheKey, entry);
  return entry.rows;
}

function regionRows(operation, region, key, ttl) {
  return cachedRows(nationwide + '/' + operation, {stdgCd:region,type:'JSON'}, key, ttl)
    .then(rows => rows.filter(row => String(row.stdgCd) === region));
}

function coordinates(lat, lng) {
  return lat >= 32 && lat <= 40 && lng >= 124 && lng <= 132;
}

function facilitiesInDistrict(rows, district) {
  const facilities = new Map();
  for (const row of rows) {
    if (row.SIGNGU_NM !== district) continue;
    const id = String(row.TFCLGHTMANAGENO ?? '').trim();
    const lat = Number(row.LATITUDE);
    const lng = Number(row.LONGITUDE);
    if (!id || !coordinates(lat, lng)) continue;
    const address = String(row.LNMADR || '').trim();
    const road = String(row.ROAD_ROUTE_NM || '').trim();
    const type = facilityTypes[row.TFCLGHTSE] || '';
    const lenses = lensTypes[row.TFCLGHTCOLORKND] || '';
    const referenceDate = String(row.REFERENCEDATE || '');
    const recordId = [id,lat,lng].join(':');
    facilities.set(recordId, {id:recordId, managementId:id, name:address || road || '신호등 '+id, lat, lng, road, type, lenses, referenceDate});
  }
  return [...facilities.values()];
}

function collectedAt(value) {
  const date = String(value).replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3 $4:$5:$6');
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/.exec(date);
  if (!match) return null;
  const timestamp = Date.parse(match[1] + 'T' + match[2] + '.' + (match[3] || '').padEnd(3,'0') + '+09:00');
  return Number.isFinite(timestamp) ? timestamp : null;
}

function signalSnapshot(rows, id) {
  const matches = rows.filter(row => String(row.crsrdId) === id);
  if (!matches.length) return {observedAt:null, signals:[]};
  const row = matches.reduce((latest, candidate) =>
    (collectedAt(candidate.totDt) ?? 0) > (collectedAt(latest.totDt) ?? 0) ? candidate : latest);
  const timestamp = collectedAt(row.totDt);
  const fresh = timestamp !== null && Date.now() - timestamp <= 15000 && timestamp <= Date.now() + 2000;
  const signals = [];
  for (const [prefix, direction] of Object.entries(directions)) {
    for (const [field, movement] of Object.entries(movements)) {
      const state = states.get(row[prefix + field + 'SttsNm']);
      if (!state) continue;
      const raw = String(row[prefix + field + 'RmndCs'] ?? '');
      const remaining = Number(raw);
      signals.push({direction, movement, state, seconds:fresh && /^\d+$/.test(raw) && remaining < 36000 ? remaining / 100 : null});
    }
  }
  return {observedAt:timestamp === null ? null : new Date(timestamp).toISOString(), fresh, signals};
}

async function handleTrafficSignals(url, json) {
  const region = url.searchParams.get('region');
  const id = url.searchParams.get('id');
  const district = url.searchParams.get('district');
  const facilities = url.pathname === '/api/traffic-light-facilities';
  const intersections = url.pathname === '/api/intersections';
  if (facilities ? !districts.has(district) : !regionCodes.has(region) || (!intersections && !/^\d{1,18}$/.test(id || ''))) {
    return json(400, {error:'지역과 교차로를 확인해 주세요.'});
  }
  const configuredKey = process.env.TRAFFIC_SIGNAL_SERVICE_KEY?.trim();
  if (!configuredKey) return json(503, {error:'서버에 공공데이터포털 신호등 인증키가 설정되지 않았어요.'});
  try {
    const key = configuredKey.includes('%') ? decodeURIComponent(configuredKey) : configuredKey;
    if (facilities) {
      const rows = await cachedRows(daejeon, {SIGNGU_NM:district}, key, 30 * 60 * 1000);
      return json(200, {facilities:facilitiesInDistrict(rows, district)});
    }
    if (!intersections) {
      const rows = await regionRows('tl_drct_info', region, key, 5000);
      return json(200, signalSnapshot(rows, id));
    }
    const [rows, signalRows] = await Promise.all([
      regionRows('crsrd_map_info', region, key, 30 * 60 * 1000),
      regionRows('tl_drct_info', region, key, 5000).catch(() => [])
    ]);
    const signalIds = new Set(signalRows.map(row => String(row.crsrdId)));
    const byId = new Map();
    for (const row of rows) {
      const id = String(row.crsrdId ?? '');
      const lat = Number(row.mapCtptIntLat);
      const lng = Number(row.mapCtptIntLot);
      if (!/^\d{1,18}$/.test(id) || !coordinates(lat, lng)) continue;
      byId.set(id, {id, name:String(row.crsrdNm || '교차로 ' + id), lat, lng, hasSignals:signalIds.has(id)});
    }
    return json(200, {intersections:[...byId.values()]});
  } catch {
    return json(502, {error:'공공데이터포털에서 정보를 가져오지 못했어요. 인증키 설정을 확인하거나 잠시 후 다시 시도해 주세요.'});
  }
}

module.exports = {handleTrafficSignals};
