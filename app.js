import {createMap} from './map-view.js';
import {initRouting} from './routing.js';
import {initSignals} from './signals.js';
import {exampleRoute, initSimulation} from './simulation.js';
import {initDriving} from './driving.mjs';
import {initNextSignal} from './next-signal.mjs';
import {initPlaceSearch} from './place-search.mjs';
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
  if (playing && name === 'driving') simulation.stop();
  if (playing && name === 'simulation' && !drivingDock.hidden) driving.stop();
  if (playing && compact.matches) {
    setPanel(null,false);
    el(name === 'driving' ? 'driveStop' : 'playbackToggle').focus({preventScroll:true});
    return;
  }
  setPanel(name);
}
const closePanel = ()=>setPanel(null);
const nextSignal = initNextSignal({map,card:el('nextSignal')});
const navigation = initNavigationGuide({
  card:el('navigationGuide'),speak:text=>el('voiceEnabled').checked && say(text),
  searchParking:destination=>placeSearch.searchParking(destination)
});
const simulation = initSimulation({map,openPanel,nextSignal,navigation});
const driving = initDriving({
  map,openPanel,nextSignal,navigation,
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
map.onReady(()=>{
  simulation.stopOffline();
});

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
  if (event.key === 'Escape' && activePanel) closePanel();
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
function say(text) {
  const status = el('voiceStatus');
  status.textContent = text;
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
};
voiceVolume.oninput = ()=>{el('voiceVolumeValue').value = voiceVolume.value+'%';};
el('voicePreview').onclick = ()=>say('삼백 미터 앞에서 좌회전하세요.');
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
