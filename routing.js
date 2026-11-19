const labels = {
  fast:'빠른 길',
  short:'짧은 길',
  traffic:'정체 적은 길',
  free:'무료도로'
};
const slotLabels = {start:'출발지',via:'경유지',end:'도착지'};
const formatDistance = meters => (meters/1000).toLocaleString('ko-KR',{maximumFractionDigits:1})+' km';
const formatDuration = seconds => seconds < 60 ? '1분 미만' : '약 '+Math.round(seconds/60)+'분';

function routePoints(route) {
  const points = [];
  for (const section of route.sections) {
    for (const road of section.roads || []) {
      const coordinates = road.vertexes || [];
      for (let i=0;i+1<coordinates.length;i+=2) {
        const [lng,lat] = [coordinates[i],coordinates[i+1]];
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const previous = points.at(-1);
        if (previous?.lat !== lat || previous?.lng !== lng) points.push({lat,lng});
      }
    }
  }
  return points;
}

function routeFare(toll) {
  if (!Number.isFinite(toll)) return '통행료 미제공';
  return '통행료 '+toll.toLocaleString('ko-KR')+'원';
}

export function initRouting({map,setRoadRoute,startDrive,startSimulation,openPanel}) {
  const root = document.getElementById('routeContent');
  root.innerHTML = `
    <div class="route-toolbar inline-actions">
      <button class="secondary" id="routeSeoul" type="button" disabled>서울시청 → 서울역 검색</button>
      <button class="secondary" id="routeUlsan" type="button" disabled>태화로터리 → 울산시청 검색</button>
      <button class="secondary" id="routeGps" type="button">현 위치에서 출발</button>
      <button class="secondary" id="routeSwap" type="button">출발·도착 바꾸기</button>
    </div>
    <form id="routeForm">
      <div class="route-fields" id="routeFields"></div>
      <div class="inline-actions">
        <button class="secondary" id="routeVia" type="button" aria-expanded="false" aria-controls="route-via">경유지 추가</button>
        <button class="primary" id="routeSearch" type="submit" disabled>경로 비교</button>
      </div>
    </form>
    <p class="status" id="routeStatus" role="status">카카오 지도가 연결되면 장소를 검색할 수 있어요.</p>
    <div class="route-options" id="routeOptions" aria-label="경로 비교 결과"></div>
    <p class="muted" id="routeSource" hidden></p>
    <details id="routeDetails" hidden>
      <summary>도로 구간</summary>
      <ol class="route-steps" id="routeSteps"></ol>
    </details>
    <div class="inline-actions">
      <button class="primary" id="routeSimulation" type="button" hidden>이 경로로 모의 주행</button>
      <button class="secondary" id="routeDrive" type="button" hidden>GPS 주행 시작</button>
    </div>
  `;
  const find = id => document.getElementById(id);
  const status = find('routeStatus');
  const compare = find('routeSearch');
  const options = find('routeOptions');
  const details = find('routeDetails');
  const steps = find('routeSteps');
  const source = find('routeSource');
  const drive = find('routeDrive');
  const simulate = find('routeSimulation');
  const gpsButton = find('routeGps');
  const viaButton = find('routeVia');
  const slots = {};
  let places, geocoder, sdk, controller, selectedRoute = null;
  let gpsPending = false;

  function tripMarkers() {
    return Object.values(slots).filter(slot => slot.place).map(slot => ({
      lat:slot.place.lat, lng:slot.place.lng, label:slotLabels[slot.id]+' · '+slot.place.name
    }));
  }

  function clearResults() {
    controller?.abort();
    controller = null;
    selectedRoute = null;
    compare.disabled = !sdk;
    options.replaceChildren();
    steps.replaceChildren();
    details.hidden = true;
    drive.hidden = true;
    simulate.hidden = true;
    source.hidden = true;
    map.setRoute({points:[],markers:tripMarkers()});
    setRoadRoute(null);
  }

  function cancelLookup(slot) {
    slot.version++;
    clearTimeout(slot.timer);
    slot.results.replaceChildren();
  }

  function choosePlace(slot, place, focusMap = true) {
    cancelLookup(slot);
    slot.place = place;
    slot.input.value = place.name;
    clearResults();
    status.textContent = slots.start.place && slots.end.place
      ? '경로 비교를 눌러 자동차 경로를 조회하세요.'
      : '출발지와 도착지를 지정해 주세요.';
    if (focusMap) map.focusPoint(place);
  }

  function showPlaceResults(slot, data, resultStatus, version) {
    if (version !== slot.version) return;
    slot.results.replaceChildren();
    if (resultStatus !== sdk.services.Status.OK || !data.length) {
      slot.results.textContent = resultStatus === sdk.services.Status.ERROR
        ? '장소를 가져오지 못했어요. 다시 검색해 주세요.' : '검색 결과가 없어요.';
      return;
    }
    for (const item of data.slice(0,5)) {
      const lat = Number(item.y), lng = Number(item.x);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const address = item.road_address_name || item.address_name;
      const name = item.place_name || address;
      if (!name) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'route-place-option';
      button.textContent = address && name !== address ? name+' · '+address : name;
      button.addEventListener('click',() => {
        choosePlace(slot,{lat,lng,name});
        slot.input.focus();
      });
      slot.results.append(button);
    }
  }

  function searchPlace(slot) {
    cancelLookup(slot);
    if (!sdk) return;
    const keyword = slot.input.value.trim();
    if (keyword.length < 2) return;
    const version = slot.version;
    slot.results.textContent = '장소 검색 중…';
    places.keywordSearch(keyword,(data,resultStatus) => {
      if (version !== slot.version) return;
      if (resultStatus !== sdk.services.Status.ZERO_RESULT) {
        showPlaceResults(slot,data,resultStatus,version);
        return;
      }
      geocoder.addressSearch(keyword,(addresses,addressStatus) =>
        showPlaceResults(slot,addresses,addressStatus,version));
    });
  }

  for (const [id,label] of Object.entries(slotLabels)) {
    const row = document.createElement('div');
    row.id = 'route-'+id;
    row.hidden = id === 'via';
    const field = document.createElement('label');
    field.className = 'field';
    field.textContent = label;
    const input = document.createElement('input');
    input.placeholder = id === 'start' ? '장소 이름 또는 주소' : id === 'via' ? '경유할 장소 검색' : '목적지 검색';
    input.autocomplete = 'off';
    const results = document.createElement('div');
    results.className = 'route-place-results';
    results.setAttribute('role','status');
    field.append(input);
    row.append(field,results);
    find('routeFields').append(row);
    const slot = slots[id] = {id,row,input,results,place:null,version:0};
    input.addEventListener('input',() => {
      slot.place = null;
      cancelLookup(slot);
      clearResults();
      if (!sdk) return;
      status.textContent = '검색 결과에서 장소를 선택해 주세요.';
      slot.timer = setTimeout(() => searchPlace(slot),250);
    });
    input.addEventListener('keydown',event => {
      if (event.key === 'ArrowDown') {
        const result = results.querySelector('button');
        if (!result) return;
        event.preventDefault();
        result.focus();
      }
      if (event.key === 'Enter' && !slot.place) {
        event.preventDefault();
        searchPlace(slot);
      }
    });
  }

  viaButton.addEventListener('click',() => {
    const slot = slots.via;
    slot.row.hidden = !slot.row.hidden;
    viaButton.setAttribute('aria-expanded',String(!slot.row.hidden));
    viaButton.textContent = slot.row.hidden ? '경유지 추가' : '경유지 삭제';
    if (!slot.row.hidden) {
      slot.input.focus();
      return;
    }
    cancelLookup(slot);
    slot.place = null;
    slot.input.value = '';
    clearResults();
  });
  find('routeSwap').addEventListener('click',() => {
    const {start,end} = slots;
    cancelLookup(start);
    cancelLookup(end);
    [start.place,end.place] = [end.place,start.place];
    [start.input.value,end.input.value] = [end.input.value,start.input.value];
    clearResults();
  });

  function focusGps() {
    openPanel('route');
    if (gpsPending) return;
    const start = slots.start;
    const useSearch = message => {
      status.textContent = message;
      start.input.focus();
    };
    if (!navigator.geolocation) {
      useSearch('현재 위치를 사용할 수 없어요. 출발지를 검색해 주세요.');
      return;
    }
    const version = start.version;
    gpsPending = true;
    gpsButton.disabled = true;
    status.textContent = '현재 위치 확인 중…';
    const finish = () => {
      gpsPending = false;
      gpsButton.disabled = false;
      return start.version === version;
    };
    navigator.geolocation.getCurrentPosition(({coords}) => {
      if (!finish()) return;
      const {latitude:lat,longitude:lng} = coords;
      if (lat<32 || lat>40 || lng<124 || lng>132) {
        useSearch('국내 경로를 조회할 수 있도록 출발지를 검색해 주세요.');
        return;
      }
      choosePlace(start,{lat,lng,name:'현재 위치'});
      slots.end.input.focus();
    }, () => {
      if (finish()) useSearch('현재 위치에 접근할 수 없어요. 장소 이름이나 주소로 출발지를 검색해 주세요.');
    }, {timeout:10000,maximumAge:0});
  }

  function selectRoute(option, buttons) {
    const {route,kind} = option;
    const points = routePoints(route);
    if (points.length < 2) {
      status.textContent = '경로를 지도에 표시할 좌표가 부족해요.';
      return;
    }
    const name = labels[kind];
    const tripLabel = slots.start.place.name+' → '+slots.end.place.name;
    selectedRoute = {name,tripLabel,points,durationSeconds:route.summary.duration,distanceMeters:route.summary.distance};
    setRoadRoute(selectedRoute);
    map.setRoute({points,markers:tripMarkers()});
    map.focusRoute(points);
    for (const [button,current] of buttons) button.setAttribute('aria-pressed',String(current === option));
    steps.replaceChildren();
    for (const section of route.sections) {
      for (const road of section.roads || []) {
        if (!road.distance) continue;
        const item = document.createElement('li');
        const speed = road.traffic_state && road.traffic_speed > 0
          ? ' · 교통 속도 '+Math.round(road.traffic_speed)+' km/h' : '';
        item.textContent = (road.name || '도로명 미제공')+' · '+Math.round(road.distance)+' m'+speed;
        steps.append(item);
      }
    }
    details.hidden = !steps.childElementCount;
    details.open = false;
    drive.hidden = false;
    simulate.hidden = false;
  }

  function showOptions(data) {
    const buttons = new Map();
    const congested = data.options.find(option => option.kind === 'traffic')?.route;
    for (const option of data.options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'route-option';
      const name = document.createElement('span');
      name.className = 'route-option-name';
      name.textContent = labels[option.kind];
      const metrics = document.createElement('span');
      metrics.className = 'route-option-metrics';
      if (option.route) {
        const {summary} = option.route;
        metrics.textContent = [
          formatDuration(summary.duration), formatDistance(summary.distance), routeFare(summary.fare?.toll)
        ].join(' · ');
        if (option.kind === 'traffic') {
          metrics.textContent += ' · 정체·지체 '+Math.round(option.traffic.share*100)+'%';
        }
        buttons.set(button,option);
        button.setAttribute('aria-pressed','false');
        button.addEventListener('click',() => selectRoute(option,buttons));
      } else {
        button.disabled = true;
        metrics.textContent = option.error || '이 조건의 경로를 찾지 못했어요.';
      }
      button.append(name,metrics);
      options.append(button);
    }
    const first = buttons.values().next().value;
    if (first) selectRoute(first,buttons);
    const time = new Date(data.fetchedAt);
    source.textContent = '카카오모빌리티 조회 '+time.toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul'})+
      (congested ? ' · 정체 비율은 교통 상태가 확인된 거리 기준' : '');
    source.hidden = false;
  }

  find('routeForm').addEventListener('submit',async event => {
    event.preventDefault();
    if (!sdk || controller) return;
    const {start,via,end} = slots;
    if (!start.place || !end.place || (!via.row.hidden && via.input.value.trim() && !via.place)) {
      status.textContent = '검색 결과에서 출발지·도착지와 입력한 경유지를 선택해 주세요.';
      return;
    }
    const coordinates = place => place.lng+','+place.lat;
    const trip = [start.place,via.place,end.place].filter(Boolean).map(coordinates);
    if (new Set(trip).size !== trip.length) {
      status.textContent = '서로 다른 장소를 선택해 주세요.';
      return;
    }
    clearResults();
    const request = controller = new AbortController();
    const params = new URLSearchParams({origin:trip[0],destination:trip.at(-1)});
    if (trip.length === 3) params.set('via',trip[1]);
    compare.disabled = true;
    status.textContent = '카카오모빌리티에서 경로를 비교하는 중…';
    try {
      const response = await fetch('/api/route-comparison?'+params,{
        signal:AbortSignal.any([request.signal,AbortSignal.timeout(12000)])
      });
      const data = await response.json();
      if (controller !== request) return;
      if (!response.ok) throw Error(data.error || '경로를 가져오지 못했어요.');
      status.textContent = '지도에 표시할 경로를 선택해 주세요.';
      showOptions(data);
    } catch (error) {
      if (controller === request) status.textContent = error.name === 'TimeoutError'
        ? '경로 조회가 지연되고 있어요. 다시 시도해 주세요.'
        : (error.message || '경로를 가져오지 못했어요.');
    } finally {
      if (controller === request) {
        controller = null;
        compare.disabled = false;
      }
    }
  });
  gpsButton.addEventListener('click',focusGps);
  drive.addEventListener('click',startDrive);
  simulate.addEventListener('click',startSimulation);
  const seoul = find('routeSeoul');
  const ulsan = find('routeUlsan');
  function searchTrip(origin,destination) {
    for (const [id,query] of [['start',origin],['via',''],['end',destination]]) {
      const slot = slots[id];
      cancelLookup(slot);
      slot.place = null;
      slot.input.value = query;
    }
    slots.via.row.hidden = true;
    viaButton.setAttribute('aria-expanded','false');
    viaButton.textContent = '경유지 추가';
    clearResults();
    status.textContent = '출발지와 도착지의 검색 결과를 선택해 주세요.';
    searchPlace(slots.start);
    searchPlace(slots.end);
  }
  seoul.onclick = ()=>searchTrip('서울시청','서울역');
  ulsan.onclick = ()=>searchTrip('태화로터리','울산시청');
  map.onReady(({sdk:maps}) => {
    sdk = maps;
    places = new sdk.services.Places();
    geocoder = new sdk.services.Geocoder();
    compare.disabled = false;
    seoul.disabled = false;
    ulsan.disabled = false;
    if (!gpsPending) status.textContent = '장소를 검색하거나 현재 위치를 출발지로 지정해 주세요.';
    for (const slot of Object.values(slots)) if (slot.input.value && !slot.place) searchPlace(slot);
  });
  return {
    focusGps,
    routeSummary:() => selectedRoute
      ? selectedRoute.name+', '+formatDistance(selectedRoute.distanceMeters)+', '+formatDuration(selectedRoute.durationSeconds)+' 예상이에요.'
      : null
  };
}
