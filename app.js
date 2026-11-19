import {createMap} from './map-view.js';
import {initRouting} from './routing.js';
import {initSignals} from './signals.js';
import {exampleRoute, initSimulation} from './simulation.js';

const el = id=>document.getElementById(id);
const workspace = el('workspace');
const panel = el('toolPanel');
const railToggle = el('railToggle');
const playback = el('playback');
const sampleShortcut = el('sampleShortcut');
const buttons = [...document.querySelectorAll('[data-panel]')];
const views = [...panel.querySelectorAll('[data-view]')];
const map = createMap(exampleRoute.points);
let activePanel = null;
let microphone = null;

function setPanel(name, focus = true) {
  if (activePanel === name) return;
  const oldPanel = activePanel;
  activePanel = name;
  panel.hidden = name === null;
  workspace.classList.toggle('panel-open',Boolean(name));
  for (const view of views) view.hidden = view.dataset.view !== name;
  for (const button of buttons) button.setAttribute('aria-expanded',String(button.dataset.panel === name));
  if (oldPanel === 'voice' && name !== 'voice') microphone?.abort();
  if (name === 'signals') loadSignals();
  if (focus && name) panel.querySelector('[data-view]:not([hidden]) h1')?.focus({preventScroll:true});
  else if (focus) buttons.find(button=>button.dataset.panel===oldPanel)?.focus();
  panel.scrollTop = 0;
  map.redraw();
}
function openPanel(name, {playing = false} = {}) {
  if (playing && matchMedia('(max-width: 720px)').matches) {
    setPanel(null,false);
    el('playbackToggle').focus({preventScroll:true});
    return;
  }
  setPanel(name);
}
const closePanel = ()=>setPanel(null);
const simulation = initSimulation({map,openPanel});
const routing = initRouting({map,openPanel,setRoadRoute:simulation.setRoadRoute});
const loadSignals = initSignals({map,closePanel});

for (const button of buttons) {
  button.setAttribute('aria-label',button.title);
  button.onclick = ()=>setPanel(activePanel === button.dataset.panel ? null : button.dataset.panel);
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
new ResizeObserver(()=>{
  workspace.style.setProperty('--dock-height',playback.hidden ? '0px' : playback.offsetHeight+4+'px');
  sampleShortcut.hidden = !playback.hidden;
  map.redraw();
}).observe(playback);

const speech = window.speechSynthesis;
const mic = el('mic');
function say(text) {
  el('voiceStatus').textContent = text;
  if (!speech || !window.SpeechSynthesisUtterance) return;
  const voice = new SpeechSynthesisUtterance(text);
  voice.lang = 'ko-KR';
  speech.cancel();
  speech.speak(voice);
}
function readRoute() {
  say(routing.routeSummary() || '경로 패널에서 출발지와 도착지를 선택하고 경로를 조회해 주세요.');
}
function command(raw) {
  const text = raw.trim();
  if (!text) return;
  if (/예시|샘플/.test(text)) {say('예시 주행을 시작합니다.');simulation.playExample();}
  else if (/경로|안내|소요/.test(text)) readRoute();
  else say('“경로 읽어 줘” 또는 “예시 주행 시작”이라고 말해 주세요.');
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

if (matchMedia('(min-width: 721px)').matches) setPanel('route',false);
map.connect();
