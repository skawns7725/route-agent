const metersPerDegree = 111195;
const maximumAccuracy = 100;
const freshnessMs = 20000;
const arrivalRadius = 40;
const rerouteInterval = 30000;

function localMeters(point, origin) {
  const longitudeScale = Math.cos(origin.lat * Math.PI / 180);
  return {
    x:(point.lng - origin.lng) * metersPerDegree * longitudeScale,
    y:(point.lat - origin.lat) * metersPerDegree
  };
}

export function prepareRouteGeometry(points) {
  const segments = [];
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1];
    const vector = localMeters(points[i], start);
    const size = Math.hypot(vector.x, vector.y);
    if (!Number.isFinite(size) || size === 0) continue;
    segments.push({start, ...vector, size, offset:length});
    length += size;
  }
  return {segments, length, end:points.at(-1)};
}

export function projectOnSegment(point, segment) {
  const local = localMeters(point, segment.start);
  const fraction = Math.max(0, Math.min(1, (local.x * segment.x + local.y * segment.y) / segment.size ** 2));
  return {
    separation:Math.hypot(local.x - fraction * segment.x, local.y - fraction * segment.y),
    meters:segment.offset + fraction * segment.size
  };
}

export function readRoutePosition(geometry, point, accuracy, distanceMeters) {
  if (!geometry?.segments.length || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > maximumAccuracy) {
    return {state:'inaccurate', remaining:null};
  }
  let nearest = Infinity;
  let metersAlong = 0;
  for (const segment of geometry.segments) {
    const {separation, meters} = projectOnSegment(point, segment);
    if (separation < nearest) {
      nearest = separation;
      metersAlong = meters;
    }
  }
  if (nearest > Math.max(50,accuracy * 1.5)) return {state:'off-route', remaining:null};
  const geometricRemaining = Math.max(0,geometry.length - metersAlong);
  const toDestination = localMeters(point,geometry.end);
  if (accuracy <= arrivalRadius && geometricRemaining <= arrivalRadius &&
      Math.hypot(toDestination.x,toDestination.y) <= arrivalRadius) {
    return {state:'arrived', remaining:0};
  }
  const total = Number.isFinite(distanceMeters) && distanceMeters > 0 ? distanceMeters : geometry.length;
  return {state:'on-route', remaining:total * geometricRemaining / geometry.length, metersAlong,
    signalPositionReliable:nearest <= 24 && accuracy <= 40};
}

function distanceText(meters) {
  if (meters === null) return '—';
  return meters >= 1000
    ? (meters / 1000).toLocaleString('ko-KR',{maximumFractionDigits:1}) + 'km'
    : Math.round(meters) + 'm';
}

export function initDriving({map, openPanel, nextSignal, navigation, rerouteFrom, onSpeed}) {
  const content = document.getElementById('drivingContent');
  const dock = document.getElementById('drivingDock');
  content.innerHTML = `
    <p id="driveRouteHint" class="status"></p>
    <button id="driveStart" class="primary" type="button" disabled>주행 시작</button>
    <p id="drivePanelStatus" class="status" role="status"></p>
  `;
  dock.innerHTML = `
    <div class="playback-row">
      <div class="playback-info">
        <span class="status-chip">실제 GPS 주행</span>
        <strong id="driveRouteName"></strong>
        <p id="driveStatus" role="status"></p>
      </div>
      <div class="playback-stats">
        <span>남은 경로 <strong id="driveRemaining">—</strong></span>
        <span>속도 <strong id="driveSpeed">—</strong></span>
        <span>GPS 오차 <strong id="driveAccuracy">—</strong></span>
      </div>
    </div>
    <div class="playback-controls">
      <button id="driveRecenter" class="secondary" type="button" disabled>내 위치 보기</button>
      <button id="driveReroute" class="secondary" type="button" disabled>교통 반영 재탐색</button>
      <button id="driveStop" class="secondary" type="button">주행 종료</button>
    </div>
  `;
  const el = id=>document.getElementById(id);
  const button = el('driveStart');
  const recenter = el('driveRecenter');
  const rerouteButton = el('driveReroute');
  const stopButton = el('driveStop');
  const statuses = [el('drivePanelStatus'),el('driveStatus')];
  let route, geometry, watchId, point, expiry;
  let originalRoute, rerouteRequest, reliablePoint;
  let startedAt = 0;
  let lastRerouteAt = -Infinity;
  let offRouteFixes = 0;
  let passedWaypoints = 0;
  let completedDistance = 0;
  let legDistance = 0;
  let session = 0;
  let watching = false;

  function status(text) {
    for (const node of statuses) if (node.textContent !== text) node.textContent = text;
  }

  function readings({remaining = null, speed = null, accuracy = null} = {}) {
    onSpeed(speed);
    el('driveRemaining').textContent = distanceText(remaining);
    el('driveSpeed').textContent = Number.isFinite(speed) && speed >= 0 ? Math.round(speed * 3.6) + 'km/h' : '—';
    el('driveAccuracy').textContent = Number.isFinite(accuracy) && accuracy >= 0 ? '±' + Math.ceil(accuracy) + 'm' : '—';
  }

  function discardPosition() {
    nextSignal.update('gps', null);
    navigation.update('gps',null);
    clearTimeout(expiry);
    point = null;
    reliablePoint = null;
    offRouteFixes = 0;
    rerouteButton.disabled = true;
    recenter.disabled = true;
    map.setLivePosition(null,{follow:false});
  }

  function finish(text, arrived = false) {
    nextSignal.stop('gps');
    rerouteRequest?.abort();
    rerouteRequest = null;
    if (!arrived) navigation.stop('gps');
    session++;
    watching = false;
    if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
    watchId = undefined;
    discardPosition();
    if (arrived) navigation.update('gps',1,{arrived:true,announce:true,elapsed:(performance.now()-startedAt)/1000,
      distanceTraveled:completedDistance+(route.distanceMeters ?? geometry.length)});
    readings({remaining:arrived ? 0 : null});
    button.disabled = !geometry;
    stopButton.textContent = '닫기';
    status(text);
  }

  function stop({restore = true} = {}) {
    finish(route ? 'GPS 주행이 종료됐어요.' : '');
    if (restore && originalRoute && originalRoute !== route) {
      route = originalRoute;
      geometry = prepareRouteGeometry(route.points);
      showMapRoute(route);
    }
    dock.hidden = true;
  }

  function setRoute(nextRoute) {
    if (nextRoute !== route && (watching || !dock.hidden)) stop({restore:false});
    route = nextRoute;
    originalRoute = nextRoute;
    const nextGeometry = route && prepareRouteGeometry(route.points);
    geometry = nextGeometry?.length > 0 ? nextGeometry : null;
    el('driveRouteHint').textContent = geometry ? '선택한 경로 · ' + route.name : '경로를 비교한 뒤 주행할 도로 경로를 선택해 주세요.';
    button.disabled = !geometry || watching;
    if (!watching) status('');
  }

  function showMapRoute(value) {
    const markers = [
      {...(value.origin || value.points[0]),label:'출발지'},
      ...(value.waypoints || []).map((point,index)=>({...point,label:'경유지 '+(index+1)})),
      {...(value.destination || value.points.at(-1)),label:'도착지'}
    ];
    map.setRoute({points:value.points,markers});
  }

  async function findUpdatedRoute() {
    if (!watching || !reliablePoint || rerouteRequest) return;
    const request = new AbortController();
    rerouteRequest = request;
    rerouteButton.disabled = true;
    lastRerouteAt = performance.now();
    status('현재 위치에서 교통을 반영해 경로를 찾고 있어요.');
    try {
      const next = await rerouteFrom(reliablePoint,{passedWaypoints,signal:request.signal});
      if (rerouteRequest !== request || !watching) return;
      const shape = prepareRouteGeometry(next.points);
      if (!shape.length) throw new Error('경로 좌표가 없어요.');
      completedDistance += legDistance;
      legDistance = 0;
      route = next;
      geometry = shape;
      offRouteFixes = 0;
      showMapRoute(route);
      nextSignal.start('gps',geometry,dock);
      navigation.start('gps',route,dock);
      status('교통을 반영한 경로로 안내하고 있어요.');
    } catch (error) {
      if (rerouteRequest === request) status(error.message || '새 경로를 찾지 못했어요.');
    } finally {
      if (rerouteRequest === request) {
        rerouteRequest = null;
        rerouteButton.disabled = !reliablePoint;
      }
    }
  }

  function update(position) {
    const {latitude:lat,longitude:lng,speed,accuracy,heading} = position.coords;
    const age = Date.now() - position.timestamp;
    if (!Number.isFinite(age) || age >= freshnessMs || age < -5000 || !Number.isFinite(lat) || !Number.isFinite(lng) ||
        Math.abs(lat) > 90 || Math.abs(lng) > 180) return;

    const current = {lat,lng};
    const result = readRoutePosition(geometry,current,accuracy,route.distanceMeters);
    if (result.state === 'arrived') {
      finish('목적지 근처에 도착했어요.',true);
      return;
    }
    readings({remaining:result.remaining,speed:result.state === 'inaccurate' ? null : speed,accuracy});
    nextSignal.update('gps', result.signalPositionReliable ? result.metersAlong : null);
    clearTimeout(expiry);
    if (result.state === 'inaccurate') {
      discardPosition();
      status('GPS 정확도가 낮아 현재 위치와 남은 경로를 확인할 수 없어요.');
    } else {
      point = current;
      reliablePoint = accuracy <= 40 ? current : null;
      rerouteButton.disabled = !reliablePoint || Boolean(rerouteRequest);
      recenter.disabled = false;
      map.setLivePosition(point,{heading,accuracy});
      if (result.state === 'on-route') {
        offRouteFixes = 0;
        const progress = result.metersAlong / geometry.length;
        legDistance = Math.max(legDistance,progress * (route.distanceMeters ?? geometry.length));
        navigation.update('gps', result.signalPositionReliable ? progress : null,{announce:true,estimatedAt:position.timestamp});
        passedWaypoints = Math.max(passedWaypoints,
          (originalRoute.waypoints?.length ?? 0) - (route.waypoints?.length ?? 0) + navigation.passedWaypoints('gps'));
      } else {
        navigation.update('gps',null);
        offRouteFixes = reliablePoint ? offRouteFixes+1 : 0;
        if (offRouteFixes >= 2 && performance.now()-lastRerouteAt >= rerouteInterval) void findUpdatedRoute();
      }
      if (!rerouteRequest) status(result.state === 'off-route'
        ? '선택한 경로에서 벗어났어요. 새 경로를 조회할 수 있어요.'
        : '실제 GPS 위치를 표시하고 있어요.');
    }
    expiry = setTimeout(()=>{
      discardPosition();
      readings();
      status('최근 GPS 위치를 받지 못했어요.');
    },freshnessMs - Math.max(age,0));
  }

  function start() {
    if (watching || !geometry) return false;
    if (!map.connected() || !navigator.geolocation) {
      status('카카오 지도에 연결하고 위치 권한을 허용한 뒤 주행을 시작해 주세요.');
      return false;
    }
    const token = ++session;
    watching = true;
    startedAt = performance.now();
    lastRerouteAt = -Infinity;
    passedWaypoints = completedDistance = legDistance = 0;
    button.disabled = true;
    dock.hidden = false;
    stopButton.textContent = '주행 종료';
    el('driveRouteName').textContent = route.name;
    readings();
    status('GPS 위치를 확인하고 있어요.');
    openPanel('driving',{playing:true});
    nextSignal.start('gps', geometry, dock);
    navigation.start('gps',route,dock);

    try {
      const id = navigator.geolocation.watchPosition(position=>{
        if (token === session) update(position);
      },error=>{
        if (token !== session) return;
        if (error.code === 1) {
          finish('위치 권한을 허용한 뒤 GPS 주행을 다시 시작해 주세요.');
          return;
        }
        discardPosition();
        readings();
        status('GPS 위치를 확인할 수 없어요. 위치 수신을 다시 기다리고 있어요.');
      },{enableHighAccuracy:true,maximumAge:0,timeout:12000});
      if (token === session) watchId = id;
      else navigator.geolocation.clearWatch(id);
    } catch {
      finish('GPS 주행을 시작할 수 없어요. 기기의 위치 설정을 확인해 주세요.');
      return false;
    }
    return true;
  }

  button.onclick = start;
  stopButton.onclick = stop;
  recenter.onclick = ()=>{if (point) map.setLivePosition(point,{follow:true});};
  rerouteButton.onclick = findUpdatedRoute;
  window.addEventListener('pagehide',stop);
  setRoute(null);
  return {setRoute,start,stop,isActive:()=>watching};
}
