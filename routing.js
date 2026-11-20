import {readRecentSearches,recordRecentSearch,removeRecentSearch,writeRecentSearches} from './recent-searches.mjs';
import {departureCorrection} from './gps-departure.mjs';
import {createPlaceLookup} from './place-search.mjs';
import {normalizeSavedPlace,readSavedPlaces,savePlace,removePlace,writeSavedPlaces} from './saved-places.mjs';

const labels = {
  fast:'빠른 길',
  short:'짧은 길',
  traffic:'정체 적은 길',
  free:'무료도로'
};
const slotLabels = {start:'출발지',end:'도착지'};
const savedLabels = {home:'집',work:'회사',favorites:'즐겨찾기',recent:'최근 목적지'};
const waypointLimit = 5;
const formatDistance = meters => (meters/1000).toLocaleString('ko-KR',{maximumFractionDigits:1})+' km';
const formatDuration = seconds => seconds < 60 ? '1분 미만' : '약 '+Math.round(seconds/60)+'분';
const formatRecentDate = new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric'});
const formatClock = new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',hour:'numeric',minute:'2-digit'});
const coordinates = ({lng,lat})=>lng+','+lat;

function tripParams(origin,destination,waypoints) {
  const params = new URLSearchParams({origin:coordinates(origin),destination:coordinates(destination)});
  for (const place of waypoints) params.append('via',coordinates(place));
  return params;
}

async function requestRoute(path,params,signal) {
  const response = await fetch(path+'?'+params,{
    signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000)
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || '경로를 가져오지 못했어요.');
  return data;
}

function navigationRoute(route,{kind,name,tripLabel,origin,destination,waypoints}) {
  const points = routePoints(route);
  if (points.length < 2) return null;
  return {kind,name,tripLabel,points,sections:route.sections,durationSeconds:route.summary.duration,
    distanceMeters:route.summary.distance,origin,destination,waypoints};
}

function routePoints(route) {
  const points = [];
  for (const section of route.sections || []) {
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

function actionButton(label,action) {
  const button = document.createElement('button');
  button.className = 'secondary';
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click',action);
  return button;
}

export function initRouting({map,setRoadRoute,startDrive,startSimulation,openPanel,searchParking,routePreference}) {
  const root = document.getElementById('routeContent');
  root.innerHTML = `
    <form id="routeForm">
      <div class="route-fields" id="routeFields"></div>
      <div class="route-modes" role="group" aria-label="이동 수단">
        <button type="button" aria-pressed="true"><span aria-hidden="true">🚘</span>자동차</button>
        <button type="button" disabled><span aria-hidden="true">🚇</span>대중교통</button>
        <button type="button" disabled><span aria-hidden="true">🚶</span>도보</button>
        <button type="button" disabled><span aria-hidden="true">🚲</span>자전거</button>
      </div>
      <div class="route-toolbar inline-actions">
        <button class="secondary" id="routeSeoul" type="button" disabled>서울시청 → 서울역 검색</button>
        <button class="secondary" id="routeUlsan" type="button" disabled>태화로터리 → 울산시청 검색</button>
        <button class="secondary" id="routeGps" type="button">현 위치에서 출발</button>
        <button class="secondary" id="routeSwap" type="button">출발·도착 바꾸기</button>
      </div>
      <div class="inline-actions">
        <button class="secondary" id="routeVia" type="button" aria-controls="route-via" aria-describedby="routeViaCount">경유지 추가</button>
        <span id="routeViaCount" class="muted">0 / 5개</span>
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
      <button class="secondary" id="routeParking" type="button" hidden>도착지 주변 주차장</button>
      <button class="secondary" id="routeFuture" type="button" aria-controls="routeFutureList" hidden>출발 시간 비교</button>
    </div>
    <p id="routeFutureStatus" class="status" role="status" hidden></p>
    <ul id="routeFutureList" class="route-future-list" aria-label="출발 시간별 빠른 길" hidden></ul>
    <details>
      <summary>저장한 장소</summary>
      <div class="field-grid">
        <label class="field">저장할 장소 <select id="routeSaveSource"><option value="end">도착지</option><option value="start">출발지</option></select></label>
        <label class="field">분류 <select id="routeSaveGroup"><option value="favorites">즐겨찾기</option><option value="home">집</option><option value="work">회사</option><option value="recent">최근 목적지</option></select></label>
      </div>
      <div class="inline-actions"><button class="secondary" id="routeSavePlace" type="button" disabled>이 기기에 저장</button></div>
      <p id="routeSavedStatus" class="status" role="status"></p>
      <ul id="routeSavedList" class="route-saved-list"></ul>
    </details>
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
  const fields = find('routeFields');
  const viaFields = document.createElement('div');
  viaFields.id = 'route-via';
  viaFields.className = 'route-fields route-via-fields';
  viaFields.hidden = true;
  const parking = find('routeParking');
  const future = find('routeFuture');
  const futureStatus = find('routeFutureStatus');
  const futureList = find('routeFutureList');
  const savedStatus = find('routeSavedStatus');
  const savedList = find('routeSavedList');
  const saveButton = find('routeSavePlace');
  const saveSource = find('routeSaveSource');
  const saveGroup = find('routeSaveGroup');
  const summaryCard = find('routeSummary');
  summaryCard.innerHTML = `
    <div class="route-summary-copy">
      <strong id="routeSummaryTrip"></strong>
      <div class="route-summary-metrics" id="routeSummaryMetrics"></div>
    </div>
    <div class="route-summary-actions">
      <button class="secondary" id="routeSummaryDetails" type="button" aria-controls="routeDetails">경로 상세</button>
      <button class="primary" id="routeSummaryDrive" type="button">GPS 주행 시작</button>
    </div>
  `;
  const summaryTrip = find('routeSummaryTrip');
  const summaryMetrics = find('routeSummaryMetrics');
  const summaryDetails = find('routeSummaryDetails');
  const summaryDrive = find('routeSummaryDrive');
  const slots = {};
  const waypoints = [];
  let nextWaypointId = 1;
  let lookup, sdk, controller, futureRequest, fastest, selectedRoute = null;
  let gpsPending = false;
  let departureRequest;
  let storage;
  try { storage = window.localStorage; } catch { /* Device storage can be blocked. */ }
  let savedPlaces = readSavedPlaces(storage);
  let recentSearches = readRecentSearches(storage);
  let historyInMemory = false;

  function changeHistory(update) {
    const current = historyInMemory ? recentSearches : readRecentSearches(storage);
    recentSearches = update(current);
    historyInMemory = !writeRecentSearches(storage,recentSearches);
  }

  function tripSlots() {
    return [slots.start,...waypoints,slots.end];
  }

  function tripMarkers() {
    return tripSlots().filter(slot => slot.place).map(slot => ({
      lat:slot.place.lat, lng:slot.place.lng, label:slot.label.textContent+' · '+slot.place.name
    }));
  }

  function clearResults() {
    departureRequest?.abort();
    controller?.abort();
    controller = null;
    selectedRoute = null;
    futureRequest?.abort();
    futureRequest = null;
    fastest = null;
    future.hidden = true;
    future.disabled = false;
    futureStatus.hidden = true;
    futureList.hidden = true;
    futureList.replaceChildren();
    parking.hidden = !searchParking || !slots.end.place;
    updateSaveButton();
    compare.disabled = !sdk;
    options.replaceChildren();
    steps.replaceChildren();
    details.hidden = true;
    drive.hidden = true;
    simulate.hidden = true;
    source.hidden = true;
    summaryCard.hidden = true;
    map.setRoute({points:[],markers:tripMarkers()});
    setRoadRoute(null);
  }

  function updateSaveButton() {
    saveButton.disabled = !normalizeSavedPlace(slots[saveSource.value]?.place);
    saveGroup.querySelector('option[value="recent"]').disabled = saveSource.value !== 'end';
    if (saveSource.value !== 'end' && saveGroup.value === 'recent') saveGroup.value = 'favorites';
  }

  function setSavedPlaces(next,message) {
    if (!writeSavedPlaces(storage,next)) {
      savedStatus.textContent = '이 브라우저에서 장소를 저장하거나 삭제할 수 없어요.';
      return;
    }
    savedPlaces = next;
    renderSavedPlaces();
    savedStatus.textContent = message;
  }

  function renderSavedPlaces() {
    const groups = Object.keys(savedLabels).flatMap(group=>
      (Array.isArray(savedPlaces[group]) ? savedPlaces[group] : [savedPlaces[group]])
        .filter(Boolean).map(place=>({group,place})));
    savedList.hidden = !groups.length;
    savedList.replaceChildren(...groups.map(({group,place})=>{
      const item = document.createElement('li');
      item.className = 'route-saved-entry';
      const name = document.createElement('strong');
      name.textContent = savedLabels[group]+' · '+place.name;
      const address = document.createElement('div');
      address.className = 'muted';
      address.textContent = place.address;
      address.hidden = !place.address;
      const controls = document.createElement('div');
      controls.className = 'inline-actions';
      const start = actionButton('출발지로',()=>choosePlace(slots.start,place));
      const end = actionButton('도착지로',()=>choosePlace(slots.end,place));
      const remove = actionButton('삭제',()=>{
        setSavedPlaces(removePlace(readSavedPlaces(storage),group,place),place.name+'을(를) 이 기기에서 삭제했어요.');
        saveSource.focus();
      });
      for (const button of [start,end,remove]) button.setAttribute('aria-label',name.textContent+' '+button.textContent);
      controls.append(start,end,remove);
      item.append(name,address,controls);
      return item;
    }));
  }

  saveSource.addEventListener('change',updateSaveButton);
  saveButton.addEventListener('click',()=>{
    const group = saveGroup.value;
    const place = slots[saveSource.value].place;
    const current = readSavedPlaces(storage);
    const next = savePlace(current,group,place);
    if (next !== current) setSavedPlaces(next,savedLabels[group]+'에 '+place.name+'을(를) 저장했어요.');
  });
  savedStatus.textContent = '선택한 장소만 이 브라우저에 저장해요.';
  renderSavedPlaces();

  function cancelLookup(slot) {
    slot.version++;
    clearTimeout(slot.timer);
    slot.results.replaceChildren();
  }

  function choosePlace(slot, place, focusMap = true) {
    cancelLookup(slot);
    if (slot.history) slot.history.hidden = true;
    slot.place = place;
    slot.input.value = place.name;
    clearResults();
    status.textContent = slots.start.place && slots.end.place
      ? '경로 비교를 눌러 자동차 경로를 조회하세요.'
      : '출발지와 도착지를 지정해 주세요.';
    if (focusMap) map.focusPoint(place);
  }

  function showPlaceResults(slot, places) {
    slot.results.replaceChildren();
    if (!places.length) {
      slot.results.textContent = '검색 결과가 없어요.';
      return;
    }
    for (const place of places.slice(0,5)) {
      const {name,address} = place;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'route-place-option';
      button.textContent = address && name !== address ? name+' · '+address : name;
      button.addEventListener('click',() => {
        if (slot.history) changeHistory(entries => recordRecentSearch(entries,place));
        slot.input.focus();
        choosePlace(slot,place);
      });
      slot.results.append(button);
    }
  }

  async function searchPlace(slot) {
    cancelLookup(slot);
    if (!sdk) return;
    const keyword = slot.input.value.trim();
    if (keyword.length < 2) return;
    const version = slot.version;
    slot.results.textContent = '장소 검색 중…';
    try {
      const places = await lookup(keyword);
      if (version === slot.version) showPlaceResults(slot,places);
    } catch {
      if (version === slot.version) slot.results.textContent = '장소를 가져오지 못했어요. 다시 검색해 주세요.';
    }
  }

  function pickHistoryPlace(slot,place) {
    choosePlace(slot,place);
    const missing = tripSlots().find(candidate => !candidate.place);
    if (missing) {
      missing.input.focus();
      return;
    }
    compare.focus();
    compareTrip();
  }

  function renderHistory(slot,focusSelector) {
    const book = readSavedPlaces(storage);
    const saved = [book.home,book.work,...book.favorites,...book.recent].filter(Boolean);
    const history = slot.history;
    history.innerHTML = `
      <div class="route-quick-chips" aria-label="빠른 장소"></div>
      <div class="route-search-tabs" role="group" aria-label="검색 분류"></div>
      <div class="route-history-content"></div>
    `;
    const chips = history.querySelector('.route-quick-chips');
    const tabs = history.querySelector('.route-search-tabs');
    const content = history.querySelector('.route-history-content');
    const openTab = tab => {
      slot.historyTab = tab;
      renderHistory(slot,'[data-tab="'+tab+'"]');
    };

    for (const [key,label] of [['home','집'],['work','회사']]) {
      const place = book[key];
      const chip = actionButton(label,() => pickHistoryPlace(slot,place));
      chip.disabled = !place;
      chips.append(chip);
    }
    if (saved.length) chips.append(actionButton('저장된 장소',() => openTab('places')));

    for (const [key,label] of [['recent','최근검색'],['places','장소'],['routes','경로']]) {
      const tab = actionButton(label,() => openTab(key));
      tab.dataset.tab = key;
      tab.setAttribute('aria-pressed',String(slot.historyTab === key));
      tabs.append(tab);
    }

    if (slot.historyTab === 'places') {
      const unique = new Set();
      for (const place of saved) {
        const key = coordinates(place);
        if (unique.has(key)) continue;
        unique.add(key);
        content.append(actionButton(place.name,() => pickHistoryPlace(slot,place)));
      }
      if (!saved.length) content.textContent = '저장된 장소가 없어요.';
    } else if (slot.historyTab === 'routes') {
      const current = options.querySelector('[aria-pressed="true"]');
      if (current) {
        content.append(actionButton(selectedRoute.tripLabel,() => current.focus()));
      } else {
        content.textContent = '비교한 경로가 없어요.';
      }
    } else if (recentSearches.length) {
      const clear = actionButton('전체 삭제',() => {
        changeHistory(() => []);
        renderHistory(slot,'[data-tab="recent"]');
      });
      clear.classList.add('route-history-clear');
      const list = document.createElement('ul');
      for (const [index,place] of recentSearches.entries()) {
        const item = document.createElement('li');
        const pick = actionButton(place.name,() => {
          changeHistory(entries => recordRecentSearch(entries,place));
          pickHistoryPlace(slot,place);
        });
        pick.classList.add('route-history-pick');
        const date = document.createElement('time');
        date.dateTime = new Date(place.searchedAt).toISOString();
        date.textContent = formatRecentDate.format(place.searchedAt).replaceAll(' ','');
        const remove = actionButton('×',() => {
          changeHistory(entries => removeRecentSearch(entries,place));
          const next = Math.min(index,recentSearches.length-1);
          renderHistory(slot,next < 0 ? '[data-tab="recent"]' : '[data-remove="'+next+'"]');
        });
        remove.dataset.remove = index;
        remove.setAttribute('aria-label',place.name+' 최근검색 삭제');
        item.append(pick,date,remove);
        list.append(item);
      }
      content.append(clear,list);
    } else {
      content.textContent = '최근 검색한 장소가 없어요.';
    }
    if (focusSelector) history.querySelector(focusSelector)?.focus();
  }

  function createSlot(id,labelText) {
    const row = document.createElement('div');
    row.id = 'route-'+id;
    const endpoint = id === 'start' || id === 'end';
    row.classList.toggle('route-endpoint',endpoint);
    const field = document.createElement('label');
    field.className = 'field';
    const label = document.createElement('span');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.placeholder = id === 'start' ? '내 위치' : id === 'end' ? '목적지 검색' : '경유할 장소 검색';
    input.autocomplete = 'off';
    input.maxLength = 150;
    const results = document.createElement('div');
    results.className = 'route-place-results';
    results.setAttribute('role','status');
    field.append(label,input);
    row.append(field,results);
    const slot = {row,label,input,results,place:null,version:0};
    if (endpoint) {
      const history = document.createElement('div');
      history.className = 'route-search-history';
      history.hidden = true;
      slot.history = history;
      row.append(history);
      const openHistory = () => {
        if ((!slot.place && input.value.trim()) || !history.hidden) return;
        slot.historyTab = 'recent';
        recentSearches = historyInMemory ? recentSearches : readRecentSearches(storage);
        renderHistory(slot);
        history.hidden = false;
      };
      input.addEventListener('focus',openHistory);
      input.addEventListener('click',openHistory);
      row.addEventListener('focusout',event => {
        if (event.relatedTarget && !row.contains(event.relatedTarget)) history.hidden = true;
      });
      row.addEventListener('keydown',event => {
        if (event.key !== 'Escape' || history.hidden) return;
        event.preventDefault();
        event.stopPropagation();
        input.focus();
        history.hidden = true;
      });
      slot.openHistory = openHistory;
    }
    input.addEventListener('input',() => {
      slot.place = null;
      cancelLookup(slot);
      clearResults();
      if (slot.history) {
        if (input.value.trim()) slot.history.hidden = true;
        else slot.openHistory();
      }
      if (!sdk) return;
      status.textContent = '검색 결과에서 장소를 선택해 주세요.';
      slot.timer = setTimeout(() => searchPlace(slot),250);
    });
    input.addEventListener('keydown',event => {
      if (event.key === 'ArrowDown') {
        const result = slot.history && !slot.history.hidden
          ? slot.history.querySelector('.route-history-pick, .route-search-tabs button')
          : results.querySelector('button');
        if (!result) return;
        event.preventDefault();
        result.focus();
      }
      if (event.key === 'Enter' && !slot.place) {
        event.preventDefault();
        searchPlace(slot);
      }
      if (event.key === 'Escape' && results.hasChildNodes()) {
        event.preventDefault();
        event.stopPropagation();
        cancelLookup(slot);
      }
    });
    results.addEventListener('keydown',event => {
      const buttons = [...results.querySelectorAll('button')];
      const current = buttons.indexOf(event.target);
      if (current < 0) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancelLookup(slot);
        input.focus();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = current + (event.key === 'ArrowDown' ? 1 : -1);
        if (next < 0) input.focus();
        else buttons[next]?.focus();
      }
    });
    return slot;
  }

  slots.start = createSlot('start',slotLabels.start);
  slots.end = createSlot('end',slotLabels.end);
  fields.append(slots.start.row,viaFields,slots.end.row);
  document.addEventListener('pointerdown',event => {
    for (const slot of [slots.start,slots.end]) {
      if (!slot.row.contains(event.target)) slot.history.hidden = true;
    }
  });

  function updateWaypoints() {
    viaFields.hidden = !waypoints.length;
    viaButton.disabled = waypoints.length >= waypointLimit;
    find('routeViaCount').textContent = waypoints.length+' / '+waypointLimit+'개';
    waypoints.forEach((slot,index)=>{
      slot.label.textContent = '경유지 '+(index+1);
      slot.up.disabled = index === 0;
      slot.down.disabled = index === waypoints.length-1;
      for (const button of [slot.up,slot.down,slot.remove]) {
        button.setAttribute('aria-label',slot.label.textContent+' '+button.textContent);
      }
      viaFields.append(slot.row);
    });
  }

  function moveWaypoint(slot,change) {
    const index = waypoints.indexOf(slot);
    const next = index+change;
    if (next < 0 || next >= waypoints.length) return;
    [waypoints[index],waypoints[next]] = [waypoints[next],waypoints[index]];
    updateWaypoints();
    clearResults();
    status.textContent = '경유지 순서를 변경했어요. 경로를 다시 비교해 주세요.';
    const control = change < 0 ? slot.up : slot.down;
    (control.disabled ? slot.input : control).focus();
  }

  function removeWaypoint(slot) {
    const index = waypoints.indexOf(slot);
    waypoints.splice(index,1);
    cancelLookup(slot);
    slot.row.remove();
    updateWaypoints();
    clearResults();
    status.textContent = '경유지를 삭제했어요.';
    (waypoints[index]?.input || waypoints.at(-1)?.input || viaButton).focus();
  }

  viaButton.addEventListener('click',() => {
    if (waypoints.length >= waypointLimit) return;
    const slot = createSlot('via-'+nextWaypointId++,'경유지');
    const controls = document.createElement('div');
    controls.className = 'inline-actions route-waypoint-controls';
    slot.up = actionButton('위로',()=>moveWaypoint(slot,-1));
    slot.down = actionButton('아래로',()=>moveWaypoint(slot,1));
    slot.remove = actionButton('삭제',()=>removeWaypoint(slot));
    controls.append(slot.up,slot.down,slot.remove);
    slot.row.append(controls);
    waypoints.push(slot);
    updateWaypoints();
    clearResults();
    status.textContent = '경유지를 검색해 선택하거나 삭제해 주세요.';
    slot.input.focus();
  });
  find('routeSwap').addEventListener('click',() => {
    const {start,end} = slots;
    cancelLookup(start);
    cancelLookup(end);
    start.history.hidden = end.history.hidden = true;
    [start.place,end.place] = [end.place,start.place];
    [start.input.value,end.input.value] = [end.input.value,start.input.value];
    waypoints.reverse();
    updateWaypoints();
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
      choosePlace(start,{lat,lng,name:'현재 위치',ephemeral:true});
      slots.end.input.focus();
    }, () => {
      if (finish()) useSearch('현재 위치에 접근할 수 없어요. 장소 이름이나 주소로 출발지를 검색해 주세요.');
    }, {timeout:10000,maximumAge:0});
  }

  async function prepareDeparture() {
    const original = selectedRoute;
    const origin = original?.origin;
    if (origin?.ephemeral !== true || origin.name !== '현재 위치') return {};
    status.textContent = '출발지의 현재 위치를 확인하고 있어요…';
    const fix = await new Promise(resolve=>{
      if (!navigator.geolocation) return resolve(null);
      const timer = setTimeout(()=>resolve(null),10000);
      const finish = value=>{
        clearTimeout(timer);
        resolve(value);
      };
      try {
        navigator.geolocation.getCurrentPosition(
          ({coords:{latitude:lat,longitude:lng,accuracy}})=>finish({lat,lng,accuracy}),
          ()=>finish(null),
          {enableHighAccuracy:true,maximumAge:0,timeout:10000}
        );
      } catch {
        finish(null);
      }
    });
    if (selectedRoute !== original) return null;
    const decision = departureCorrection(origin,fix);
    if (decision === 'keep') {
      status.textContent = '지도에 표시할 경로를 선택해 주세요.';
      return {};
    }
    if (decision === 'unavailable') {
      const notice = '현재 위치를 확인할 수 없어 설정한 출발지로 안내해요.';
      status.textContent = notice;
      return {notice,allowWithoutGps:true};
    }

    status.textContent = '현재 위치에서 새 경로를 찾고 있어요…';
    const request = departureRequest = new AbortController();
    const updated = {...origin,lat:fix.lat,lng:fix.lng};
    const {destination,waypoints:stops,kind} = original;
    try {
      const data = await requestRoute('/api/route-comparison',tripParams(updated,destination,stops),request.signal);
      if (selectedRoute !== original) return null;
      const choice = data.options.find(option=>option.kind === kind);
      if (!choice?.route || routePoints(choice.route).length < 2) throw Error();
      slots.start.place = updated;
      departureRequest = null;
      clearResults();
      showOptions(data,kind);
      const notice = '출발지를 현재 위치로 수정했어요. 경로를 다시 찾았어요.';
      status.textContent = notice;
      return {notice};
    } catch {
      if (selectedRoute !== original) return null;
      const notice = '현재 위치에서 새 경로를 찾지 못해 설정한 출발지로 안내해요.';
      status.textContent = notice;
      return {notice};
    } finally {
      if (departureRequest === request) departureRequest = null;
    }
  }

  function selectRoute(option, buttons) {
    const {route,kind} = option;
    const {place:origin} = slots.start;
    const {place:destination} = slots.end;
    const name = labels[kind];
    const tripLabel = origin.name+' → '+destination.name;
    const nextRoute = navigationRoute(route,{kind,name,tripLabel,origin,destination,waypoints:waypoints.map(slot=>slot.place)});
    if (!nextRoute) {
      status.textContent = '경로를 지도에 표시할 좌표가 부족해요.';
      return;
    }
    selectedRoute = nextRoute;
    setRoadRoute(selectedRoute);
    map.setRoute({points:selectedRoute.points,markers:tripMarkers()});
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
    summaryTrip.textContent = tripLabel;
    const duration = document.createElement('strong');
    duration.className = 'route-summary-duration';
    duration.textContent = formatDuration(route.summary.duration);
    summaryMetrics.replaceChildren(duration, ' · '+[formatDistance(route.summary.distance), routeFare(route.summary.fare?.toll), name].join(' · '));
    summaryDetails.hidden = details.hidden;
    summaryCard.hidden = false;
    map.focusRoute(selectedRoute.points);
  }

  function showOptions(data, preferredKind) {
    const buttons = new Map();
    const congested = data.options.find(option => option.kind === 'traffic')?.route;
    const usable = data.options.filter(option => option.route && routePoints(option.route).length >= 2);
    const recommended = usable.find(option => option.kind === 'fast') || usable[0];
    for (const option of data.options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'route-option';
      const name = document.createElement('span');
      name.className = 'route-option-name';
      name.textContent = option === recommended ? '추천 경로 · '+labels[option.kind] : labels[option.kind];
      const metrics = document.createElement('span');
      metrics.className = 'route-option-metrics';
      const timing = document.createElement('span');
      timing.className = 'route-option-timing';
      if (option.route) {
        const {summary} = option.route;
        const duration = document.createElement('strong');
        duration.textContent = formatDuration(summary.duration).replace(/^약 /,'');
        timing.append(duration,' ',formatDistance(summary.distance).replace(' km','km'));
        metrics.textContent = routeFare(summary.fare?.toll);
        if (option === recommended && option.traffic) metrics.textContent = '실시간 교통 반영 · '+metrics.textContent;
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
      button.append(name);
      if (option.route) button.append(timing);
      button.append(metrics);
      if (option === recommended) {
        const card = document.createElement('div');
        card.className = 'route-recommended';
        const play = actionButton('▶',() => {
          selectRoute(option,buttons);
          startDrive();
        });
        play.className = 'primary route-play';
        play.setAttribute('aria-label','추천 경로 GPS 주행 시작');
        card.append(button,play);
        options.prepend(card);
      } else {
        options.append(button);
      }
    }
    const first = usable.find(option => option.kind === preferredKind) || usable[0];
    if (first) selectRoute(first,buttons);
    const time = new Date(data.fetchedAt);
    const fast = data.options.find(option=>option.kind === 'fast')?.route;
    fastest = fast && {durationSeconds:fast.summary.duration,departureAt:data.fetchedAt};
    future.hidden = !selectedRoute;
    source.textContent = '카카오모빌리티 조회 '+time.toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul'})+
      (congested ? ' · 정체 비율은 교통 상태가 확인된 거리 기준' : '');
    source.hidden = false;
  }

  find('routeForm').addEventListener('submit',event => {
    event.preventDefault();
    compareTrip();
  });

  async function compareTrip() {
    if (!sdk || controller) return;
    const {start,end} = slots;
    const places = tripSlots().map(slot=>slot.place);
    if (places.some(place=>!place)) {
      status.textContent = '검색 결과에서 출발지·도착지와 입력한 경유지를 선택해 주세요.';
      return;
    }
    if (new Set(places.map(coordinates)).size !== places.length) {
      status.textContent = '서로 다른 장소를 선택해 주세요.';
      return;
    }
    clearResults();
    const request = controller = new AbortController();
    const params = tripParams(start.place,end.place,waypoints.map(slot=>slot.place));
    compare.disabled = true;
    status.textContent = '카카오모빌리티에서 경로를 비교하는 중…';
    try {
      const data = await requestRoute('/api/route-comparison',params,request.signal);
      if (controller !== request) return;
      status.textContent = '지도에 표시할 경로를 선택해 주세요.';
      showOptions(data,routePreference());
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
  }
  parking.addEventListener('click',()=>{if (slots.end.place) searchParking?.(slots.end.place);});

  function futureItem(label,value,error) {
    const item = document.createElement('li');
    const departure = Date.parse(value?.departureAt);
    if (!Number.isFinite(departure) || !Number.isFinite(value?.durationSeconds)) {
      item.textContent = label+' · '+(error || '예상 소요 시간을 확인할 수 없어요.');
      return item;
    }
    const arrival = departure+value.durationSeconds*1000;
    item.textContent = label+' · '+formatDuration(value.durationSeconds)+' · '+formatClock.format(departure)+' 출발 / '+formatClock.format(arrival)+' 도착 예상';
    return item;
  }

  future.addEventListener('click',async()=>{
    if (!selectedRoute || futureRequest) return;
    const {origin,destination,waypoints:stops} = selectedRoute;
    const request = futureRequest = new AbortController();
    futureList.replaceChildren(futureItem('현재 조회값',fastest));
    futureList.hidden = false;
    futureStatus.hidden = false;
    futureStatus.textContent = '30분 뒤와 1시간 뒤의 빠른 길을 조회하고 있어요.';
    future.disabled = true;
    try {
      const departures = [[30,'30분 뒤'],[60,'1시간 뒤']];
      const items = await Promise.all(departures.map(async ([minutes,label])=>{
        const params = tripParams(origin,destination,stops);
        params.set('minutes',String(minutes));
        try {
          const data = await requestRoute('/api/future-route',params,request.signal);
          return futureItem(label,data);
        } catch (error) {
          return futureItem(label,null,error.name === 'TimeoutError' ? '조회 시간이 초과됐어요.' : error.message);
        }
      }));
      if (futureRequest === request) {
        futureList.append(...items);
        futureStatus.textContent = '카카오모빌리티 빠른 길 기준. 출발 시간에 따라 경로도 달라질 수 있어요.';
      }
    } finally {
      if (futureRequest === request) {
        futureRequest = null;
        future.disabled = false;
      }
    }
  });

  gpsButton.addEventListener('click',focusGps);
  drive.addEventListener('click',startDrive);
  summaryDrive.addEventListener('click',startDrive);
  summaryDetails.addEventListener('click',() => {
    openPanel('route');
    details.open = true;
    details.querySelector('summary').focus();
  });
  simulate.addEventListener('click',startSimulation);
  const seoul = find('routeSeoul');
  const ulsan = find('routeUlsan');
  function searchTrip(origin,destination) {
    for (const waypoint of waypoints) {
      cancelLookup(waypoint);
      waypoint.row.remove();
    }
    waypoints.length = 0;
    updateWaypoints();
    for (const [id,query] of [['start',origin],['end',destination]]) {
      const slot = slots[id];
      cancelLookup(slot);
      slot.history.hidden = true;
      slot.place = null;
      slot.input.value = query;
    }
    clearResults();
    status.textContent = '출발지와 도착지의 검색 결과를 선택해 주세요.';
    searchPlace(slots.start);
    searchPlace(slots.end);
  }
  seoul.onclick = ()=>searchTrip('서울시청','서울역');
  ulsan.onclick = ()=>searchTrip('태화로터리','울산시청');
  map.onReady(({sdk:maps}) => {
    sdk = maps;
    lookup = createPlaceLookup(sdk);
    compare.disabled = false;
    seoul.disabled = false;
    ulsan.disabled = false;
    if (!gpsPending) status.textContent = '장소를 검색하거나 현재 위치를 출발지로 지정해 주세요.';
    for (const slot of tripSlots()) if (slot.input.value && !slot.place) searchPlace(slot);
  });
  return {
    focusGps,prepareDeparture,
    savedHome:()=>savedPlaces.home,
    chooseMapPlace(slot,place,{fromSearch = false} = {}) {
      if (fromSearch) changeHistory(entries => recordRecentSearch(entries,place));
      openPanel('route');
      choosePlace(slots[slot],place,false);
      const other = slots[slot === 'start' ? 'end' : 'start'];
      (other.place ? compare : other.input).focus({preventScroll:true});
    },
    async rerouteFrom(position,{passedWaypoints=0,waypoints:remaining,signal}={}) {
      if (!selectedRoute) throw Error('다시 계산할 경로가 없어요.');
      const {kind,tripLabel,destination,waypoints:stops} = selectedRoute;
      const nextStops = remaining ?? stops.slice(passedWaypoints);
      const params = tripParams(position,destination,nextStops);
      if (kind === 'free') params.set('avoidTolls','true');
      const data = await requestRoute('/api/routes',params,signal);
      const route = kind === 'free'
        ? data.routes?.find(candidate=>candidate.summary?.fare?.toll === 0)
        : data.routes?.[0];
      const next = route && navigationRoute(route,{
        kind,name:'다시 계산한 경로',tripLabel,origin:position,destination,waypoints:nextStops
      });
      if (!next) throw Error('현재 위치에서 목적지까지 유효한 경로를 찾지 못했어요.');
      return next;
    },
    routeSummary:() => selectedRoute
      ? selectedRoute.name+', '+formatDistance(selectedRoute.distanceMeters)+', '+formatDuration(selectedRoute.durationSeconds)+' 예상이에요.'
      : null
  };
}
