export const exampleRoute = {
  name: '용운동 → 충남대',
  durationSeconds: 88,
  points: [
    [36.328,127.453], [36.330,127.444], [36.337,127.438], [36.337,127.426],
    [36.345,127.418], [36.345,127.401], [36.355,127.391], [36.355,127.375],
    [36.362,127.362], [36.362,127.350], [36.369,127.344]
  ].map(([lat,lng]) => ({lat,lng}))
};

const signalCycle = 42;
const redSeconds = 18;
const testSignals = [
  {fraction:0.18, phaseAtFreeArrival:5},
  {fraction:0.51, phaseAtFreeArrival:21},
  {fraction:0.76, phaseAtFreeArrival:33}
];

function metersBetween(a, b) {
  const radians = Math.PI/180;
  const distance = Math.sin((b.lat-a.lat)*radians/2)**2
    + Math.cos(a.lat*radians)*Math.cos(b.lat*radians)*Math.sin((b.lng-a.lng)*radians/2)**2;
  return 6371000*2*Math.asin(Math.min(1,Math.sqrt(distance)));
}

function positionAt(path, meters) {
  let first = 0;
  let last = path.length-1;
  while (first+1 < last) {
    const middle = Math.floor((first+last)/2);
    if (path[middle].meters <= meters) first = middle;
    else last = middle;
  }
  const a = path[first];
  const b = path[last];
  const fraction = Math.max(0,Math.min(1,(meters-a.meters)/(b.meters-a.meters)));
  return {lat:a.lat+(b.lat-a.lat)*fraction,lng:a.lng+(b.lng-a.lng)*fraction};
}

function signalPhase(elapsed, offset) {
  return ((elapsed+offset)%signalCycle+signalCycle)%signalCycle;
}

export function createDrive(route, {testSignalStops = true} = {}) {
  const path = [];
  let distance = 0;
  for (const point of route?.points || []) {
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)
      || Math.abs(point.lat)>90 || Math.abs(point.lng)>180) continue;
    const previous = path.at(-1);
    const segment = previous ? metersBetween(previous,point) : 0;
    if (previous && segment === 0) continue;
    distance += segment;
    path.push({lat:point.lat,lng:point.lng,meters:distance});
  }
  if (path.length < 2) return null;
  const movingSeconds = Number.isFinite(route.durationSeconds) && route.durationSeconds>0
    ? route.durationSeconds : Math.max(1,Math.round(distance/(40/3.6)));
  let totalWait = 0;
  const checkpoints = (testSignalStops ? testSignals : []).map(({fraction,phaseAtFreeArrival},index) => {
    const freeArrival = movingSeconds*fraction;
    const offset = phaseAtFreeArrival-freeArrival;
    const arrival = freeArrival+totalWait;
    const phase = signalPhase(arrival,offset);
    const waiting = Math.max(0,redSeconds-phase);
    totalWait += waiting;
    return {
      ...positionAt(path,distance*fraction),
      label:'시험 교차로 '+(index+1), offset, arrival, departure:arrival+waiting
    };
  });
  return {
    name:route.tripLabel || route.name || '선택한 도로 경로',
    path,
    points:path.map(({lat,lng}) => ({lat,lng})),
    sections:route.sections,
    destination:route.destination,
    distanceMeters:Number.isFinite(route.distanceMeters) && route.distanceMeters>0 ? route.distanceMeters : distance,
    checkpoints, movingSeconds, totalSeconds:movingSeconds+totalWait
  };
}

export function sampleDrive(drive, time) {
  const elapsed = Math.min(drive.totalSeconds,Math.max(0,time));
  let waitSeconds = 0;
  let currentStop = null;
  let stationaryPosition = null;
  let greenDeparture = null;
  const waits = [];
  const stops = drive.checkpoints.map(({lat,lng,label,offset,arrival,departure}) => {
    const seconds = Math.max(0,Math.min(elapsed,departure)-arrival);
    const waiting = elapsed>=arrival && elapsed<departure;
    waitSeconds += seconds;
    if (waiting) {
      currentStop = label;
      stationaryPosition = {lat,lng};
    }
    if (departure>arrival && elapsed>=departure && elapsed-departure<3) greenDeparture = label;
    waits.push({label,seconds,reached:elapsed>=arrival,waiting});
    const red = waiting || signalPhase(elapsed,offset)<redSeconds-1e-9;
    return {lat,lng,label,state:red?'red':'green'};
  });
  const stage = elapsed>=drive.totalSeconds?'arrived':currentStop?'waiting':'driving';
  const meters = drive.path.at(-1).meters*(elapsed-waitSeconds)/drive.movingSeconds;
  return {
    elapsed, stage, currentStop, greenDeparture, waitSeconds, waits, stops,
    position:stage==='arrived'?drive.points.at(-1):stationaryPosition||positionAt(drive.path,meters),
    progress:elapsed/drive.totalSeconds
  };
}

export function createPlaybackClock(duration) {
  let elapsed = 0;
  let started = null;
  let rate = 1;
  function reading(now) {
    return Math.min(duration,elapsed+(started===null?0:(now-started)*rate/1000));
  }
  return {
    get playing() {return started!==null;},
    get rate() {return rate;},
    reading,
    play(now) {if (started===null && elapsed<duration) started = now;},
    pause(now) {elapsed = reading(now); started = null;},
    setRate(nextRate, now) {
      const playing = started!==null;
      elapsed = reading(now);
      started = playing?now:null;
      rate = nextRate;
    },
    reset() {started = null; elapsed = 0;}
  };
}

function formatTime(seconds) {
  const rounded = Math.floor(seconds);
  const minutes = Math.floor(rounded/60);
  return minutes ? minutes+'분 '+rounded%60+'초' : rounded+'초';
}

export function initSimulation({map,openPanel,nextSignal,navigation}) {
  const content = document.getElementById('simulationContent');
  const dock = document.getElementById('playback');
  content.innerHTML = `
    <div class="simulation-actions">
      <button class="button primary" id="playExample" type="button">예시 경로 재생</button>
      <button class="primary" id="playRoadRoute" type="button" disabled>선택한 도로 경로 재생</button>
    </div>
    <p id="simulationRouteHint" class="status">경로 탭에서 출발지와 도착지를 선택하고 경로를 조회해 주세요.</p>
    <p class="muted">카카오 도로 재생 중에는 다음 교차로의 실제 신호를 지도에 함께 표시해요.</p>
    <div class="simulation-result" id="simulationResult" hidden>
      <h3 id="simulationResultTitle">재생 결과</h3>
      <ul id="simulationWaits"></ul>
      <p id="simulationOutcome" role="status"></p>
    </div>`;
  dock.innerHTML = `
    <div class="playback-row">
      <div class="playback-info">
        <span class="status-chip">모의 주행</span>
        <strong id="playbackRoute"></strong>
        <p id="playbackState" role="status"></p>
      </div>
      <div class="playback-stats">
        <span>가상 경과 <strong id="playbackElapsed">0초</strong></span>
        <span id="playbackWaitStat" hidden>가상 대기 <strong id="playbackWait">0초</strong></span>
      </div>
    </div>
    <progress class="playback-progress" id="playbackProgress" aria-label="모의 주행 진행률" max="1" value="0"></progress>
    <div class="playback-row">
      <div class="playback-controls">
        <button class="button primary" id="playbackToggle" type="button">일시정지</button>
        <button class="secondary" id="playbackRestart" type="button">처음부터</button>
        <button class="secondary" id="playbackClose" type="button">재생 종료</button>
      </div>
      <div class="playback-speeds" aria-label="재생 배속" role="group">
        ${[1,2,4,8].map(rate => `<button class="secondary" type="button" data-rate="${rate}" aria-pressed="${rate===1}">${rate}×</button>`).join('')}
      </div>
    </div>`;
  dock.hidden = true;

  const element = id => document.getElementById(id);
  const roadButton = element('playRoadRoute');
  const stats = element('simulationResult');
  const waits = element('simulationWaits');
  const outcome = element('simulationOutcome');
  const routeLabel = element('playbackRoute');
  const stage = element('playbackState');
  const elapsedLabel = element('playbackElapsed');
  const waitLabel = element('playbackWait');
  const progress = element('playbackProgress');
  const toggle = element('playbackToggle');
  const restart = element('playbackRestart');
  const speedButtons = [...dock.querySelectorAll('[data-rate]')];

  let drive = null;
  let clock = null;
  let selectedRoad = null;
  let offlineRun = false;
  let signalRouteLength = 0;
  let frame = 0;
  let speed = 1;
  let waitRows = [];

  function setText(node, text) {
    if (node.textContent!==text) node.textContent = text;
  }

  function render(now) {
    if (!drive) return;
    const snapshot = sampleDrive(drive,clock.reading(now));
    const arrived = snapshot.stage==='arrived';
    navigation.update('simulation',snapshot.progress,{
      seconds:drive.totalSeconds-snapshot.elapsed,arrived,announce:!offlineRun && clock.playing,elapsed:snapshot.elapsed
    });
    if (arrived) clock.pause(now);
    if (!offlineRun) {
      if (arrived) nextSignal.stop('simulation');
      else nextSignal.update('simulation',snapshot.progress * signalRouteLength);
    }
    map.setSimulation({
      points:drive.points, position:snapshot.position, stops:snapshot.stops,
      offline:offlineRun
    });
    progress.value = snapshot.progress;
    setText(elapsedLabel,formatTime(snapshot.elapsed));
    setText(waitLabel,formatTime(snapshot.waitSeconds));
    setText(toggle,clock.playing?'일시정지':'재생');
    toggle.disabled = arrived;
    const status = arrived?'가상 주행 도착'
      : !clock.playing?'일시정지'
      : snapshot.stage==='waiting'?snapshot.currentStop+' · 적색 대기'
      : snapshot.greenDeparture?snapshot.greenDeparture+' · 녹색 출발':'가상 차량 주행 중';
    setText(stage,status);
    for (const [index,wait] of snapshot.waits.entries()) {
      setText(waitRows[index],wait.label+' · '+(
        wait.waiting?formatTime(wait.seconds)+' 대기 중'
          : wait.reached?formatTime(wait.seconds)+' 대기':'미도달'
      ));
    }
    setText(outcome,arrived ? '모의 도착 · 가상 '+formatTime(snapshot.elapsed)+
      (offlineRun ? ' · 대기 '+formatTime(snapshot.waitSeconds) : '') : '');
  }

  function tick() {
    frame = 0;
    render(performance.now());
    if (clock.playing) frame = requestAnimationFrame(tick);
  }

  function start(nextDrive, offline) {
    if (!nextDrive) return false;
    cancelAnimationFrame(frame);
    map.clearSimulation?.();
    drive = nextDrive;
    offlineRun = offline;
    if (offline) nextSignal.stop('simulation');
    clock = createPlaybackClock(drive.totalSeconds);
    const now = performance.now();
    clock.setRate(speed,now);
    clock.play(now);
    dock.hidden = false;
    stats.hidden = false;
    routeLabel.textContent = drive.name+(offline ? ' · 오프라인 예시' : ' · 카카오 도로 경로');
    element('playbackWaitStat').hidden = !offline;
    element('simulationResultTitle').textContent = offline ? '교차로별 가상 대기' : '재생 결과';
    waits.hidden = !offline;
    waitRows = drive.checkpoints.map(() => document.createElement('li'));
    waits.replaceChildren(...waitRows);
    openPanel?.('simulation',{playing:true});
    if (!offline) {
      signalRouteLength = nextSignal.start('simulation', drive, dock);
    }
    navigation.start('simulation',drive,dock);
    tick();
    return true;
  }

  function playExample() {return start(createDrive(exampleRoute),true);}
  function playRoadRoute() {return map.connected() && start(selectedRoad,false);}
  function stop() {
    if (!drive) return;
    cancelAnimationFrame(frame);
    frame = 0;
    nextSignal.stop('simulation');
    navigation.stop('simulation');
    drive = clock = null;
    dock.hidden = true;
    stats.hidden = true;
    map.clearSimulation();
  }

  element('playExample').onclick = playExample;
  roadButton.onclick = playRoadRoute;
  element('playbackClose').onclick = stop;
  toggle.onclick = () => {
    const now = performance.now();
    if (clock.playing) {
      clock.pause(now);
      cancelAnimationFrame(frame);
      frame = 0;
      render(now);
    } else {
      clock.play(now);
      tick();
    }
  };
  restart.onclick = () => {
    const now = performance.now();
    const arrived = clock.reading(now)>=drive.totalSeconds;
    const resume = clock.playing || arrived;
    cancelAnimationFrame(frame);
    clock.reset();
    if (arrived && !offlineRun) signalRouteLength = nextSignal.start('simulation', drive, dock);
    navigation.start('simulation',drive,dock);
    if (resume) clock.play(now);
    tick();
  };
  for (const button of speedButtons) {
    button.onclick = () => {
      speed = Number(button.dataset.rate);
      clock.setRate(speed,performance.now());
      for (const option of speedButtons) option.setAttribute('aria-pressed',String(option===button));
    };
  }

  return {
    playExample,
    playRoadRoute,
    stop,
    stopOffline() {if (offlineRun) stop();},
    setRoadRoute(route) {
      if (drive && !offlineRun) stop();
      selectedRoad = createDrive(route,{testSignalStops:false});
      roadButton.disabled = !selectedRoad;
      element('simulationRouteHint').textContent = selectedRoad
        ? '선택한 경로 · '+selectedRoad.name
        : '경로 탭에서 출발지와 도착지를 선택하고 경로를 조회해 주세요.';
    }
  };
}
