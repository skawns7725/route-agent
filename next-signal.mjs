import {prepareRouteGeometry, projectOnSegment} from './driving.mjs';

const navigationRegions = ['1100000000','3100000000'];
const directions = ['북쪽','북동쪽','동쪽','남동쪽','남쪽','남서쪽','서쪽','북서쪽'];
const corridorMeters = 24;
const liveRange = 350;
const liveAge = 15000;
const refreshInterval = 5000;

function bearingBetween(geometry, from, to) {
  let east = 0, north = 0;
  for (const segment of geometry.segments) {
    if (segment.offset >= to) break;
    const overlap = Math.min(to, segment.offset + segment.size) - Math.max(from, segment.offset);
    if (overlap <= 0) continue;
    east += segment.x * overlap / segment.size;
    north += segment.y * overlap / segment.size;
  }
  return Math.atan2(east,north) * 180 / Math.PI;
}

function movementsAt(geometry, meters) {
  const inbound = bearingBetween(geometry, meters - 30, meters - 5);
  const outbound = bearingBetween(geometry, meters + 5, meters + 30);
  const turn = (outbound - inbound + 540) % 360 - 180;
  const index = Math.round(inbound / 45);
  // Provider directions name the side of the intersection the vehicle enters from.
  const approach = Math.abs(index * 45 - inbound) <= 19 ? directions[(index + 12) % 8] : null;
  const movement = Math.abs(turn) >= 150 ? '유턴'
    : Math.abs(turn) <= 28 ? '직진' : turn <= -45 ? '좌회전' : turn >= 45 ? '우회전' : null;
  return {approach,movement};
}

export function matchCrossings(geometry, crossings) {
  const matches = [];
  for (const crossing of crossings) {
    let closest;
    let lastNearby = -Infinity;
    function addPass() {
      if (closest) matches.push({...crossing, ...closest, ...movementsAt(geometry,closest.meters)});
    }
    for (const segment of geometry.segments) {
      const projection = projectOnSegment(crossing,segment);
      if (projection.separation > corridorMeters ||
          projection.meters < 12 || geometry.length - projection.meters < 12) continue;
      if (projection.meters - lastNearby > 2 * corridorMeters) {
        addPass();
        closest = null;
      }
      if (!closest || projection.separation < closest.separation) closest = projection;
      lastNearby = projection.meters;
    }
    addPass();
  }
  return matches.sort((a,b)=>a.meters-b.meters);
}

export function nextCrossing(crossings, meters) {
  return crossings.find(crossing=>crossing.meters >= meters) ?? null;
}

export function currentSignalRows(crossing, snapshot, now) {
  const age = now - Date.parse(snapshot?.observedAt);
  if (!snapshot?.fresh || !(age >= -2000 && age < liveAge) || !crossing.movement) return [];
  return snapshot.signals.filter(row=>crossing.approach === row.direction &&
    crossing.movement === row.movement &&
    (row.seconds === null || age < row.seconds * 1000));
}

async function request(path, params, sessionSignal) {
  const signal = AbortSignal.any([sessionSignal,AbortSignal.timeout(12000)]);
  const response = await fetch(path+'?'+new URLSearchParams(params),{signal});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '실시간 신호를 가져오지 못했어요.');
  return data;
}

export function initNextSignal({map, card}) {
  const name = card.querySelector('strong');
  const distance = card.querySelector('[data-distance]');
  const approach = card.querySelector('[data-approach]');
  const status = card.querySelector('[role=status]');
  const rows = card.querySelector('ul');
  let active;
  const catalogs = new Map();

  function setText(node,value) {
    if (node.textContent !== value) node.textContent = value;
  }

  function render(session) {
    const crossing = session.crossing;
    setText(name,crossing?.name || '다음 교차로 신호');
    setText(approach,crossing?.approach && crossing.movement ? crossing.approach+' 진입 · '+crossing.movement : '');
    const meters = crossing ? Math.max(0,crossing.meters-session.meters) : null;
    setText(distance,meters === null ? '' : meters >= 1000
      ? (meters/1000).toFixed(1)+' km' : Math.round(meters)+' m');

    const now = Date.now();
    const available = crossing ? currentSignalRows(crossing,session.snapshot,now) : [];
    let message = '';
    if (session.meters === null) message = '경로 위 현재 위치를 확인하고 있어요.';
    else if (session.error) message = session.error;
    else if (!session.crossings) message = '경로의 신호 교차로를 확인하고 있어요.';
    else if (!crossing) message = '전방 경로와 연결된 신호 교차로가 없어요.';
    else if (crossing.movement === '우회전') message = '공공데이터에서 우회전 전용 신호를 제공하지 않아요.';
    else if (!crossing.approach || !crossing.movement) message = '이 경로의 진입 방면 신호를 확인할 수 없어요.';
    else if (meters > liveRange) message = '교차로 350 m 이내에서 현재 신호를 조회해요.';
    else if (available.length) {
      const collected = new Date(session.snapshot.observedAt).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul'});
      message = `공공데이터 ${collected} 집계 · 현장 신호 우선`;
    } else if ((session.pending || session.nextRequest === 0) && !session.snapshot) message = '현재 신호를 확인하고 있어요.';
    else message = '이 교차로의 현재 신호를 확인할 수 없어요.';
    setText(status,message);

    const caption = available.map(row=>[row.state,
      row.seconds === null ? '' : '집계 시 '+row.seconds+'초'].filter(Boolean).join(' · '));
    const rowKey = caption.join('|');
    if (rowKey !== session.caption) {
      session.caption = rowKey;
      rows.replaceChildren(...caption.map((text,index)=>{
        const item = document.createElement('li');
        item.dataset.state = available[index].state;
        item.textContent = text;
        return item;
      }));
    }
    rows.hidden = !caption.length;
  }

  function updateCrossing(session) {
    const crossing = session.crossings && session.meters !== null
      ? nextCrossing(session.crossings,session.meters) : null;
    if (crossing !== session.crossing) {
      session.crossing = crossing;
      session.pending?.abort();
      session.pending = session.snapshot = null;
      session.nextRequest = 0;
      map.setNextSignal(crossing);
    }
    render(session);
    refresh(session);
  }

  async function refresh(session) {
    const {crossing} = session;
    if (!crossing?.movement || crossing.movement === '우회전' || !crossing.approach ||
        crossing.meters - session.meters > liveRange ||
        session.pending || Date.now() < session.nextRequest || document.hidden) return;
    const controller = new AbortController();
    session.pending = controller;
    render(session);
    try {
      const snapshot = await request('/api/traffic-signals',{region:crossing.region,id:crossing.id},controller.signal);
      if (session.pending === controller) session.snapshot = snapshot;
    } catch {
      if (session.pending === controller && !controller.signal.aborted) session.snapshot = null;
    } finally {
      if (active === session && session.pending === controller) {
        session.pending = null;
        session.nextRequest = Date.now() + refreshInterval;
        render(session);
      }
    }
  }

  function stop(owner) {
    if (active?.owner !== owner) return;
    clearInterval(active.timer);
    active.controller.abort();
    active.pending?.abort();
    active = null;
    card.hidden = true;
    map.setNextSignal(null);
  }

  async function loadCatalog(session, geometry) {
    const results = await Promise.allSettled(navigationRegions.map(async region=>{
      const cached = catalogs.get(region);
      if (cached && Date.now() < cached.expires) return cached.crossings;
      const result = await request('/api/intersections',{region},session.controller.signal);
      const crossings = result.intersections.map(crossing=>({...crossing,region}));
      if (active === session) catalogs.set(region,{crossings,expires:Date.now()+30*60*1000});
      return crossings;
    }));
    if (active !== session) return;
    const loaded = results.filter(result=>result.status === 'fulfilled');
    if (!loaded.length) {
      session.error = results[0].reason.message || '교차로를 불러오지 못했어요.';
      render(session);
      return;
    }
    session.crossings = matchCrossings(geometry,loaded.flatMap(result=>result.value));
    updateCrossing(session);
  }

  function start(owner, route, dock) {
    if (active) stop(active.owner);
    const geometry = route.segments ? route : prepareRouteGeometry(route.points);
    const session = {owner,controller:new AbortController(),meters:null,crossing:null,
      nextRequest:0,caption:null};
    active = session;
    dock.prepend(card);
    card.hidden = false;
    render(session);
    session.timer = setInterval(()=>{
      render(session);
      refresh(session);
    },500);
    loadCatalog(session,geometry);
    return geometry.length;
  }

  return {
    start, stop,
    update(owner,meters) {
      if (active?.owner !== owner || active.meters === meters) return;
      active.meters = meters;
      updateCrossing(active);
    }
  };
}
