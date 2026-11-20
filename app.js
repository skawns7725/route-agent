import {createMap} from './map-view.js';
import {initRouting} from './routing.js';
import {initSignals} from './signals.js';
import {exampleRoute, initSimulation} from './simulation.js';
import {initDriving} from './driving.mjs';
import {initNextSignal} from './next-signal.mjs';
import {initNavigationParking, initPlaceSearch} from './place-search.mjs';
import {initNavigationGuide} from './navigation-guide.mjs';

const el = id=>document.getElementById(id);
const workspace = el('workspace');
const panel = el('toolPanel');
const playback = el('playback');
const drivingDock = el('drivingDock');
const sampleShortcut = el('sampleShortcut');
const buttons = [...document.querySelectorAll('[data-panel]')];
const views = [...panel.querySelectorAll('[data-view]')];
const settingsKey = 'route-agent.settings';
const settings = readSettings();
const map = createMap(exampleRoute.points,{
  mapType:settings.mapType,traffic:settings.traffic,onTrafficChange:enabled=>saveSettings({traffic:enabled})
});
const compact = matchMedia('(width < 768px)');
const scrollPositions = new Map();
let activePanel = null;
let microphone = null;
let navigationOwner = null;
let explorationPanel, explorationFocus, simulationDrive;

function readSettings() {
  let saved;
  try {
    saved = JSON.parse(window.localStorage.getItem(settingsKey));
  } catch { /* Storage can be blocked or contain invalid JSON. */ }
  return {
    voice:saved?.voice === true,
    volume:Number.isInteger(saved?.volume) && saved.volume >= 0 && saved.volume <= 100 ? saved.volume : 80,
    mapType:saved?.mapType === 'hybrid' ? 'hybrid' : 'road',
    traffic:saved?.traffic === true,
    route:['fast','short','traffic','free'].includes(saved?.route) ? saved.route : 'fast',
    vehicleName:typeof saved?.vehicleName === 'string' ? saved.vehicleName.trim().slice(0,40) : '',
    fuel:['gas','diesel','lpg','hybrid','ev','other'].includes(saved?.fuel) ? saved.fuel : '',
    signalAlert:saved?.signalAlert !== false,
    arrivalAlert:saved?.arrivalAlert !== false
  };
}

function saveSettings(change) {
  Object.assign(settings,change);
  const status = el('settingsStatus');
  try {
    window.localStorage.setItem(settingsKey,JSON.stringify(settings));
    status.textContent = '';
  } catch {
    status.textContent = '이 브라우저에 설정을 저장하지 못했어요. 현재 화면에서는 적용돼요.';
  }
}

const navigationScreen = document.createElement('section');
navigationScreen.className = 'navigation-screen';
navigationScreen.classList.toggle('signal-alert-off',!settings.signalAlert);
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
    <button type="button" data-navigation-exit>주행 종료</button>
  </div>`;
workspace.append(navigationScreen);
const navigationCards = navigationScreen.querySelector('[data-navigation-cards]');
const navigationSource = navigationScreen.querySelector('[data-navigation-source]');
const navigationSpeed = navigationScreen.querySelector('[data-navigation-speed]');
const navigationVoice = navigationScreen.querySelector('[data-navigation-voice]');
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
  start(owner,route) {return settings.signalAlert ? liveSignal.start(owner,route,navigationCards) : 0;}
};
const guide = initNavigationGuide({
  card:el('navigationGuide'),
  speak:text=>settings.voice && (settings.arrivalAlert || text !== '목적지에 도착했습니다.') && say(text),
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
const routeOptions = el('routeOptions');
let firstComparedOption;
new MutationObserver(()=>{
  // Apply the preference when comparison results arrive, leaving later manual choices alone.
  if (routeOptions.firstElementChild === firstComparedOption) return;
  firstComparedOption = routeOptions.firstElementChild;
  if (!firstComparedOption) return;
  const preferredLabel = [...el('settingsRoute').options].find(option=>option.value === settings.route)?.textContent;
  const preferred = [...routeOptions.children].find(button=>!button.disabled &&
    button.querySelector('.route-option-name')?.textContent === preferredLabel);
  if (preferred?.getAttribute('aria-pressed') === 'false') preferred.click();
}).observe(routeOptions,{childList:true});
const placeSearch = initPlaceSearch({
  map,
  chooseRoutePlace:routing.chooseMapPlace,
  onSearch() {if (compact.matches) setPanel(null,false);}
});
const loadSignals = initSignals({map,closePanel});
el('routeDrive').textContent = el('routeSummaryDrive').textContent = '주행 시작';
navigationExit.onclick = ()=>{
  if (navigationOwner === 'simulation') simulation.stop();
  else if (navigationOwner === 'gps') driving.stop();
};

for (const button of buttons) {
  button.setAttribute('aria-label',button.title);
  button.onclick = ()=>openPanel(button.dataset.panel);
}
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
voiceEnabled.checked = settings.voice;
voiceVolume.value = String(settings.volume);
el('voiceVolumeValue').value = settings.volume+'%';

const mapType = el('settingsMapType');
const routePreference = el('settingsRoute');
const vehicleName = el('settingsVehicleName');
const fuel = el('settingsFuel');
const signalAlert = el('settingsSignalAlert');
const arrivalAlert = el('settingsArrivalAlert');
mapType.value = settings.mapType;
routePreference.value = settings.route;
vehicleName.value = settings.vehicleName;
fuel.value = settings.fuel;
signalAlert.checked = settings.signalAlert;
arrivalAlert.checked = settings.arrivalAlert;
mapType.onchange = ()=>{
  saveSettings({mapType:mapType.value});
  map.setMapType(settings.mapType);
};
routePreference.onchange = ()=>saveSettings({route:routePreference.value});
vehicleName.onchange = ()=>{
  vehicleName.value = vehicleName.value.trim().slice(0,40);
  saveSettings({vehicleName:vehicleName.value});
};
fuel.onchange = ()=>saveSettings({fuel:fuel.value});
signalAlert.onchange = ()=>{
  saveSettings({signalAlert:signalAlert.checked});
  navigationScreen.classList.toggle('signal-alert-off',!settings.signalAlert);
};
arrivalAlert.onchange = ()=>saveSettings({arrivalAlert:arrivalAlert.checked});

let utterance;
function say(text, status = el('voiceStatus')) {
  status.textContent = text;
  if (!speech || !window.SpeechSynthesisUtterance) {
    status.textContent = '이 브라우저에서는 음성 재생을 사용할 수 없어요.';
    return false;
  }
  const voice = new SpeechSynthesisUtterance(text);
  voice.lang = 'ko-KR';
  voice.volume = settings.volume / 100;
  utterance = voice;
  voice.onerror = ()=>{
    if (utterance === voice) status.textContent = '음성을 재생할 수 없어요. 기기 음성 설정을 확인해 주세요.';
  };
  speech.cancel();
  speech.speak(voice);
  return true;
}
voiceEnabled.onchange = ()=>{
  saveSettings({voice:voiceEnabled.checked});
  if (!settings.voice) {
    utterance = null;
    speech?.cancel();
  }
  el('settingsVoiceStatus').textContent = settings.voice ? '주행 음성 안내 켜짐' : '주행 음성 안내 꺼짐';
  syncNavigationVoice();
};
function syncNavigationVoice() {
  navigationVoice.setAttribute('aria-label','주행 음성 안내');
  navigationVoice.setAttribute('aria-pressed',String(settings.voice));
  navigationVoice.textContent = settings.voice ? '음성 켜짐' : '음성 꺼짐';
}
navigationVoice.onclick = ()=>{
  voiceEnabled.checked = !voiceEnabled.checked;
  voiceEnabled.onchange();
};
voiceVolume.oninput = ()=>{
  settings.volume = Number(voiceVolume.value);
  el('voiceVolumeValue').value = settings.volume+'%';
};
voiceVolume.onchange = ()=>saveSettings({volume:Number(voiceVolume.value)});
el('voicePreview').onclick = ()=>say('삼백 미터 앞에서 좌회전하세요.',el('settingsVoiceStatus'));
function readRoute() {
  say(routing.routeSummary() || '경로 패널에서 출발지와 도착지를 선택하고 경로를 조회해 주세요.');
}
function command(raw) {
  const text = raw.trim();
  if (!text) return;
  if (/경로|안내|소요/.test(text)) readRoute();
  else say('“경로 읽어 줘”라고 말해 주세요.');
}
el('readRoute').onclick = readRoute;
el('voiceForm').onsubmit = event=>{
  event.preventDefault();
  const input = el('voiceInput');
  command(input.value);
  input.value = '';
};
mic.onclick = ()=>{
  if (microphone) {microphone.abort();return;}
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    el('voiceStatus').textContent = '이 브라우저에서는 텍스트 명령을 사용할 수 있어요.';
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = 'ko-KR';
  recognition.onresult = event=>command(event.results[0][0].transcript);
  recognition.onerror = event=>{
    if (event.error !== 'aborted') el('voiceStatus').textContent = '마이크를 사용할 수 없어요. 텍스트로 명령을 입력해 주세요.';
  };
  recognition.onend = ()=>{
    microphone = null;
    mic.setAttribute('aria-pressed','false');
    mic.textContent = '마이크로 말하기';
  };
  try {
    recognition.start();
    microphone = recognition;
    mic.setAttribute('aria-pressed','true');
    mic.textContent = '마이크 중지';
  } catch {
    el('voiceStatus').textContent = '마이크를 시작하지 못했어요. 텍스트로 명령을 입력해 주세요.';
  }
};

if (!compact.matches) setPanel('route',false);
map.connect();
