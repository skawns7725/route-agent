import {createMap} from './map-view.js';
import {initRouting} from './routing.js';
import {initSignals} from './signals.js';
import {exampleRoute, initSimulation} from './simulation.js';
import {initDriving} from './driving.mjs';
import {initNextSignal} from './next-signal.mjs';
import {createPlaceLookup, initNavigationParking, initPlaceSearch} from './place-search.mjs';
import {readSavedPlaces} from './saved-places.mjs';
import {initNavigationGuide} from './navigation-guide.mjs';

const el = id=>document.getElementById(id);
const workspace = el('workspace');
const panel = el('toolPanel');
const railToggle = el('railToggle');
const playback = el('playback');
const drivingDock = el('drivingDock');
const sampleShortcut = el('sampleShortcut');
const buttons = [...document.querySelectorAll('[data-panel]')];
const views = [...panel.querySelectorAll('[data-view]')];
const map = createMap(exampleRoute.points);
const compact = matchMedia('(width < 768px)');
const scrollPositions = new Map();
let activePanel = null;
let microphone = null;
let navigationOwner = null;
let explorationPanel, explorationFocus, simulationDrive;

const navigationScreen = document.createElement('section');
navigationScreen.className = 'navigation-screen';
navigationScreen.setAttribute('aria-label','주행 모드');
navigationScreen.hidden = true;
navigationScreen.innerHTML = `
  <div class="navigation-cards" data-navigation-cards>
    <p class="navigation-no-signal">전방 교차로 · 실제 신호 <strong>정보 없음</strong></p>
  </div>
  <section class="navigation-parking" aria-labelledby="navigationParkingTitle" hidden>
    <div class="navigation-parking-heading">
      <h2 id="navigationParkingTitle">도착지 주변 주차장</h2>
      <button type="button" aria-label="주차장 목록 닫기">닫기</button>
    </div>
    <p role="status"></p>
    <ul></ul>
  </section>
  <div class="navigation-controls">
    <div><span data-navigation-source></span><strong data-navigation-speed>—</strong></div>
    <button type="button" data-navigation-voice aria-pressed="false">음성 꺼짐</button>
    <button type="button" data-navigation-command aria-label="Gemini 음성 명령" aria-pressed="false">음성 명령</button>
    <button type="button" data-navigation-exit>주행 종료</button>
    <span data-navigation-voice-status role="status" hidden></span>
  </div>`;
workspace.append(navigationScreen);
const navigationCards = navigationScreen.querySelector('[data-navigation-cards]');
const navigationSource = navigationScreen.querySelector('[data-navigation-source]');
const navigationSpeed = navigationScreen.querySelector('[data-navigation-speed]');
const navigationVoice = navigationScreen.querySelector('[data-navigation-voice]');
const navigationCommand = navigationScreen.querySelector('[data-navigation-command]');
const navigationVoiceStatus = navigationScreen.querySelector('[data-navigation-voice-status]');
navigationCommand.parentElement.style.gridTemplateColumns = 'minmax(0,1fr) auto auto auto';
navigationVoiceStatus.style.gridColumn = '1 / -1';
const navigationExit = navigationScreen.querySelector('[data-navigation-exit]');
const navigationParking = initNavigationParking({sheet:navigationScreen.querySelector('.navigation-parking')});
const signalCard = el('nextSignal');
const unavailableSignal = document.createElement('strong');
unavailableSignal.className = 'navigation-signal-unavailable';
unavailableSignal.textContent = '정보 없음';
signalCard.querySelector('ul').after(unavailableSignal);

function showSpeed(speed) {
  const label = Number.isFinite(speed) && speed >= 0 ? Math.round(speed * 3.6)+' km/h' : '—';
  if (navigationSpeed.textContent !== label) navigationSpeed.textContent = label;
  map.setNavigationSpeed(speed);
}

function setNavigationMode(owner) {
  if (navigationOwner === owner) return;
  if (owner) {
    explorationPanel = activePanel;
    explorationFocus = document.activeElement;
    setPanel(null,false);
  }
  navigationOwner = owner;
  navigationScreen.hidden = !owner;
  workspace.classList.toggle('navigation-mode',Boolean(owner));
  map.setNavigationMode(owner);
  showSpeed(null);
  if (owner) {
    navigationSource.textContent = owner === 'simulation' ? '모의 주행' : '현재 속도';
    syncNavigationVoice();
    navigationExit.focus({preventScroll:true});
  } else {
    microphone?.abort();
    navigationVoiceStatus.hidden = true;
    navigationParking.close(false);
    setPanel(explorationPanel,false);
    queueMicrotask(()=>{
      if (navigationOwner) return;
      if (explorationFocus?.isConnected && explorationFocus.getClientRects().length) {
        explorationFocus.focus({preventScroll:true});
      } else (buttons.find(button=>button.dataset.panel === explorationPanel) || buttons[0]).focus();
    });
  }
}

function setPanel(name, focus = true) {
  if (activePanel === name) return;
  const oldPanel = activePanel;
  if (oldPanel) scrollPositions.set(oldPanel, panel.scrollTop);
  activePanel = name;
  panel.hidden = name === null;
  workspace.classList.toggle('panel-open',Boolean(name));
  for (const view of views) view.hidden = view.dataset.view !== name;
  for (const button of buttons) button.setAttribute('aria-expanded',String(button.dataset.panel === name));
  if (oldPanel === 'voice' && name !== 'voice') microphone?.abort();
  if (name === 'signals') loadSignals();
  if (focus && name) panel.querySelector('[data-view]:not([hidden]) h1')?.focus({preventScroll:true});
  else if (focus) (buttons.find(button => button.dataset.panel === oldPanel) || buttons[0]).focus();
  panel.scrollTop = scrollPositions.get(name) ?? 0;
  map.redraw();
}
function openPanel(name, {playing = false} = {}) {
  if (playing) {
    if (name === 'driving') simulation.stop();
    else if (!drivingDock.hidden) driving.stop();
    setNavigationMode(name === 'driving' ? 'gps' : 'simulation');
    return;
  }
  if (!navigationOwner) setPanel(name);
}
const closePanel = ()=>setPanel(null);
const liveSignal = initNextSignal({map,card:signalCard});
const nextSignal = {
  ...liveSignal,
  start(owner,route) {return liveSignal.start(owner,route,navigationCards);}
};
const guide = initNavigationGuide({
  card:el('navigationGuide'),speak:text=>el('voiceEnabled').checked && say(text,el('voiceStatus')),
  searchParking:(destination,button)=>navigationParking.open(destination,button)
});
const navigation = {
  ...guide,
  start(owner,route) {
    if (owner === 'simulation') simulationDrive = route;
    guide.start(owner,route,navigationCards);
  },
  update(owner,progress,options = {}) {
    if (owner === 'simulation' && navigationOwner === owner && simulationDrive) {
      const {elapsed, arrived} = options;
      const waiting = simulationDrive.checkpoints.some(stop=>elapsed >= stop.arrival && elapsed < stop.departure);
      showSpeed(arrived || waiting ? 0 : simulationDrive.distanceMeters / simulationDrive.movingSeconds);
    }
    guide.update(owner,progress,options);
  },
  stop(owner) {
    guide.stop(owner);
    if (owner === 'simulation') simulationDrive = null;
    if (navigationOwner === owner) setNavigationMode(null);
  }
};
const simulation = initSimulation({map,openPanel,nextSignal,navigation});
const driving = initDriving({
  map,openPanel,nextSignal,navigation,onSpeed:showSpeed,
  rerouteFrom:(position,options)=>routing.rerouteFrom(position,options)
});
const routing = initRouting({
  map,openPanel,startDrive:driving.start,startSimulation:simulation.playRoadRoute,
  searchParking:destination=>placeSearch.searchParking(destination),
  setRoadRoute(route) {
    driving.setRoute(route);
    simulation.setRoadRoute(route);
  }
});
const placeSearch = initPlaceSearch({
  map,
  chooseRoutePlace:routing.chooseMapPlace,
  onSearch() {if (compact.matches) setPanel(null,false);}
});
const loadSignals = initSignals({map,closePanel});
el('routeDrive').textContent = el('routeSummaryDrive').textContent = '주행 시작';
function stopGuidance() {
  if (navigationOwner === 'simulation') simulation.stop();
  else if (navigationOwner === 'gps') driving.stop();
}
navigationExit.onclick = ()=>{
  voiceCommandRequest?.abort();
  stopGuidance();
};

for (const button of buttons) {
  button.setAttribute('aria-label',button.title);
  button.onclick = ()=>setPanel(button.dataset.panel);
}
railToggle.onclick = ()=>{
  const expanded = workspace.classList.toggle('rail-expanded');
  railToggle.setAttribute('aria-expanded',String(expanded));
  railToggle.setAttribute('aria-label',expanded ? '사이드바 접기' : '사이드바 펼치기');
  railToggle.title = expanded ? '사이드바 접기' : '사이드바 펼치기';
  map.redraw();
};
el('closePanel').onclick = closePanel;
document.addEventListener('keydown',event=>{
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  if (navigationParking.close()) event.preventDefault();
  else if (activePanel) closePanel();
});
el('gpsButton').onclick = ()=>routing.focusGps();
sampleShortcut.onclick = ()=>simulation.playExample();
const dockLayout = new ResizeObserver(()=>{
  const dock = drivingDock.hidden ? playback : drivingDock;
  workspace.style.setProperty('--dock-height',dock.hidden ? '0px' : dock.offsetHeight+4+'px');
  sampleShortcut.hidden = !dock.hidden;
  map.redraw();
});
dockLayout.observe(playback);
dockLayout.observe(drivingDock);

const speech = window.speechSynthesis;
const mic = el('mic');
const voiceEnabled = el('voiceEnabled');
const voiceVolume = el('voiceVolume');
let utterance;
function say(text, status = showVoiceStatus(text)) {
  if (status.textContent !== text) status.textContent = text;
  if (!speech || !window.SpeechSynthesisUtterance) {
    status.textContent = '이 브라우저에서는 음성 재생을 사용할 수 없어요.';
    return false;
  }
  const voice = new SpeechSynthesisUtterance(text);
  voice.lang = 'ko-KR';
  voice.volume = Number(voiceVolume.value) / 100;
  utterance = voice;
  voice.onerror = ()=>{
    if (utterance === voice) status.textContent = '음성을 재생할 수 없어요. 기기 음성 설정을 확인해 주세요.';
  };
  speech.cancel();
  speech.speak(voice);
  return true;
}
voiceEnabled.onchange = ()=>{
  if (!voiceEnabled.checked) {
    utterance = null;
    speech?.cancel();
  }
  el('voiceStatus').textContent = voiceEnabled.checked ? '주행 음성 안내 켜짐' : '주행 음성 안내 꺼짐';
  syncNavigationVoice();
};
function syncNavigationVoice() {
  navigationVoice.setAttribute('aria-label','주행 음성 안내');
  navigationVoice.setAttribute('aria-pressed',String(voiceEnabled.checked));
  navigationVoice.textContent = voiceEnabled.checked ? '음성 켜짐' : '음성 꺼짐';
}
navigationVoice.onclick = ()=>{
  voiceEnabled.checked = !voiceEnabled.checked;
  voiceEnabled.onchange();
};
voiceVolume.oninput = ()=>{el('voiceVolumeValue').value = voiceVolume.value+'%';};
el('voicePreview').onclick = ()=>say('삼백 미터 앞에서 좌회전하세요.');
function readRoute() {
  say(routing.routeSummary() || '경로 패널에서 출발지와 도착지를 선택하고 경로를 조회해 주세요.');
}
function showVoiceStatus(text) {
  const status = navigationOwner ? navigationVoiceStatus : el('voiceStatus');
  status.textContent = text;
  status.hidden = false;
  return status;
}

function savedPlaceBook() {
  try { return readSavedPlaces(window.localStorage); }
  catch { return readSavedPlaces(); }
}

function voiceContext(book) {
  return {
    origin:el('route-start').querySelector('input').value,
    destination:el('route-end').querySelector('input').value,
    routeState:navigationOwner || (routing.routeSummary() ? 'ready' : 'editing'),
    waypoints:[...el('route-via').querySelectorAll('input')].map(input=>input.value),
    savedPlaces:{home:book.home?.name,work:book.work?.name,
      favorites:book.favorites.map(place=>place.name),recent:book.recent.map(place=>place.name)}
  };
}

const lookupVoicePlace = createPlaceLookup();
let voiceCommandRequest;

function waitForRouteUi(node,read,start,signal) {
  return new Promise(resolve=>{
    if (signal.aborted) {resolve(undefined);return;}
    const observer = new MutationObserver(()=>{
      const result = read();
      if (result !== undefined) finish(result);
    });
    const timeout = setTimeout(()=>finish(),13000);
    const abort = ()=>finish();
    function finish(result) {
      clearTimeout(timeout);
      observer.disconnect();
      signal.removeEventListener('abort',abort);
      resolve(result);
    }
    signal.addEventListener('abort',abort,{once:true});
    observer.observe(node,{childList:true,subtree:true});
    try { start(); } catch { finish(); }
  });
}

async function chooseVoiceWaypoint(place,signal) {
  el('routeVia').click();
  const row = el('route-via').lastElementChild;
  const input = row.querySelector('input');
  const results = row.querySelector('.route-place-results');
  const label = place.address && place.name !== place.address ? place.name+' · '+place.address : place.name;
  input.value = place.name;
  const button = await waitForRouteUi(results,()=>{
    const choices = [...results.querySelectorAll('.route-place-option')];
    if (choices.length) {
      const matches = choices.filter(option=>option.textContent === label);
      return matches.length === 1 ? matches[0] : null;
    }
    return /검색 결과가 없어요|가져오지 못했어요/.test(results.textContent) ? null : undefined;
  },()=>input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true})),signal);
  if (signal.aborted) return;
  if (button?.isConnected && input.value === place.name) {
    button.click();
    say(place.name+'을 경유지로 추가했어요. 경로를 다시 비교해 주세요.');
  } else say('경유지를 확정하지 못했어요. 경로 화면에서 검색 결과를 선택해 주세요.');
}

async function applyVoicePlace(action,name,book,signal) {
  const waypoint = action === 'add_waypoint';
  if (waypoint && el('routeVia').disabled) return say('경유지는 최대 다섯 곳까지 추가할 수 있어요.');
  if (!map.connected()) return say('카카오 지도가 연결되면 장소를 지정할 수 있어요.');
  let place = name === '집' ? book.home : name === '회사' ? book.work : null;
  if (!place && (name === '집' || name === '회사')) return say('저장한 '+name+' 장소가 없어요. 경로 화면에서 먼저 저장해 주세요.');
  if (!place) {
    try {
      const places = await lookupVoicePlace(name);
      if (signal.aborted) return;
      const exact = places.filter(item=>item.name === name || item.address === name);
      place = exact.length === 1 ? exact[0] : places.length === 1 ? places[0] : null;
      if (!place) return say(places.length ? '같은 이름의 장소가 여럿 있어요. 지역이나 주소도 말해 주세요.'
        : '장소를 찾지 못했어요. 이름이나 주소를 다시 말해 주세요.');
    } catch {
      if (!signal.aborted) say('장소를 가져오지 못했어요. 다시 시도해 주세요.');
      return;
    }
  }
  if (signal.aborted) return;
  if (waypoint && el('routeVia').disabled) return say('경유지는 최대 다섯 곳까지 추가할 수 있어요.');
  if (navigationOwner) stopGuidance();
  openPanel('route');
  if (waypoint) return chooseVoiceWaypoint(place,signal);
  routing.chooseMapPlace('end',place);
  say(place.name+'을 도착지로 설정했어요. 경로를 다시 비교해 주세요.');
}

async function avoidTraffic(signal) {
  if (navigationOwner === 'gps' && driving.isActive()) {
    const button = el('driveReroute');
    if (button.disabled) return say('현재 위치가 확인되면 교통 반영 경로를 다시 요청해 주세요.');
    await button.onclick();
    if (!signal.aborted && navigationOwner === 'gps') say(el('driveStatus').textContent);
    return;
  }
  if (navigationOwner) return say('모의 주행을 종료하고 경로 화면에서 정체가 적은 길을 다시 찾을 수 있어요.');
  if (!routing.routeSummary()) return say('출발지와 도착지를 지정하고 경로를 먼저 비교해 주세요.');
  if (el('routeSearch').disabled) return say('현재 경로 비교가 끝난 뒤 다시 요청해 주세요.');
  openPanel('route');
  const results = el('routeOptions');
  const result = await waitForRouteUi(results,()=>{
    const traffic = [...results.querySelectorAll('.route-option')].find(button=>
      button.querySelector('.route-option-name')?.textContent === '정체 적은 길');
    if (traffic) return traffic.disabled ? null : traffic;
    return undefined;
  },()=>el('routeForm').requestSubmit(),signal);
  if (signal.aborted) return;
  if (result) {
    result.click();
    readRoute();
  } else say('정체가 적은 경로를 확인하지 못했어요.');
}

async function command(raw) {
  const text = raw.trim().slice(0,500);
  if (!text) return;
  voiceCommandRequest?.abort();
  const request = voiceCommandRequest = new AbortController();
  const {signal} = request;
  const book = savedPlaceBook();
  showVoiceStatus('음성 명령을 확인하고 있어요.');
  let result;
  try {
    const response = await fetch('/api/voice-command',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({text,context:voiceContext(book)}),
      signal:AbortSignal.any([signal,AbortSignal.timeout(9500)])
    });
    if (!response.ok) throw Error('voice command unavailable');
    result = await response.json();
  } catch {
    if (signal.aborted) return;
    if (/경로|안내|소요/.test(text)) readRoute();
    else say('“경로 읽어 줘”라고 말해 주세요.');
    return;
  }
  if (signal.aborted) return;
  try {
    switch (result?.action) {
      case 'set_destination':
      case 'add_waypoint':
        if (typeof result.place === 'string' && result.place) await applyVoicePlace(result.action,result.place,book,signal);
        else say('장소 이름이나 주소를 다시 말해 주세요.');
        break;
      case 'avoid_traffic_reroute': await avoidTraffic(signal); break;
      case 'read_route': readRoute(); break;
      case 'repeat_instruction': say(guide.currentInstruction() || '반복할 주행 안내가 없어요.'); break;
      case 'stop_guidance':
        if (!navigationOwner) say('진행 중인 주행 안내가 없어요.');
        else {
          stopGuidance();
          say('주행 안내를 종료했어요.');
        }
        break;
      default: say(result?.message || '음성 명령을 이해하지 못했어요.');
    }
  } catch {
    if (!signal.aborted) say('음성 명령을 적용하지 못했어요. 다시 시도해 주세요.');
  }
}
el('readRoute').onclick = readRoute;
el('voiceForm').onsubmit = event=>{
  event.preventDefault();
  const input = el('voiceInput');
  command(input.value);
  input.value = '';
};
el('voiceStatus').textContent = '명령 내용과 장소 이름이 Gemini로 전송돼요.';
function startMicrophone(button) {
  if (microphone) {microphone.abort();return;}
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showVoiceStatus('이 브라우저에서는 음성 패널에서 텍스트 명령을 사용할 수 있어요.');
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = 'ko-KR';
  recognition.onresult = event=>command(event.results[0][0].transcript);
  recognition.onerror = event=>{
    if (event.error !== 'aborted') showVoiceStatus('마이크를 사용할 수 없어요. 텍스트로 명령을 입력해 주세요.');
  };
  recognition.onend = ()=>{
    microphone = null;
    button.setAttribute('aria-pressed','false');
    button.textContent = button === mic ? '마이크로 말하기' : '음성 명령';
  };
  try {
    recognition.start();
    microphone = recognition;
    button.setAttribute('aria-pressed','true');
    button.textContent = '마이크 중지';
  } catch {
    showVoiceStatus('마이크를 시작하지 못했어요. 텍스트로 명령을 입력해 주세요.');
  }
}
mic.onclick = ()=>startMicrophone(mic);
navigationCommand.onclick = ()=>startMicrophone(navigationCommand);

if (!compact.matches) setPanel('route',false);
map.connect();
