import {prepareRouteGeometry, projectOnSegment} from './driving.mjs';

const junctionTypes = new Set([5,6,7,8,9,10,11,12,14,15,16,17,42,43,44,45,46,47,48,49,82,83,86]);
const arrival = 101;
const waypoint = 1000;

export function buildNavigationPlan(route) {
  const geometry = prepareRouteGeometry(route.points);
  const steps = [];
  for (const section of route.sections ?? []) {
    if (!Array.isArray(section?.guides)) continue;
    for (const guide of section.guides) {
      const {x:lng,y:lat,type} = guide ?? {};
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || type === 100) continue;
      const text = type === arrival ? '목적지 도착' : typeof guide.guidance === 'string' && guide.guidance.trim();
      if (!text) continue;
      const previous = steps.at(-1);
      let best;
      for (const segment of geometry.segments) {
        if (previous && segment.offset + segment.size < previous.meters - 3) continue;
        const candidate = projectOnSegment({lat,lng},segment);
        if (previous && candidate.meters < previous.meters - 3) continue;
        if (!best || candidate.separation < best.separation) best = candidate;
      }
      if (!best || best.separation > 60) continue;
      const meters = Math.max(previous?.meters ?? 0,best.meters);
      if (previous?.type === type && previous.text === text && meters - previous.meters < 4) continue;
      const roadName = section.roads?.[guide.road_index]?.name;
      const road = typeof roadName === 'string' ? roadName.trim() : '';
      steps.push({meters,text,road,type,junction:junctionTypes.has(type)});
    }
  }
  return {
    steps,length:geometry.length,
    distance:route.distanceMeters ?? geometry.length,
    seconds:route.totalSeconds ?? route.durationSeconds
  };
}

export function readNavigation(plan,progress,secondsRemaining,estimatedAt) {
  const fraction = Math.min(1,Math.max(0,progress));
  const offset = fraction * plan.length;
  const index = plan.steps.findIndex(step=>step.meters >= offset);
  const step = index === -1 || fraction === 1 ? null : plan.steps[index];
  const estimate = secondsRemaining ?? (Number.isFinite(plan.seconds) ? (1-fraction)*plan.seconds : null);
  const seconds = Number.isFinite(estimate) && estimate >= 0 ? estimate : null;
  return {
    step,index,
    junctions:plan.steps.slice(Math.max(0,index)).filter(item=>item.junction && item.meters >= offset &&
      item.meters - offset <= 2000).slice(0,3),
    stepDistance:step ? Math.max(0,step.meters - offset) : null,
    passedWaypoints:plan.steps.filter(item=>item.type === waypoint && item.meters < offset).length,
    remaining:(1-fraction)*plan.distance,
    seconds,
    arrivalAt:seconds !== null && Number.isFinite(estimatedAt) ? estimatedAt + seconds*1000 : null
  };
}

const metersText = meters=>meters >= 1000 ? (meters/1000).toFixed(1)+' km' : Math.round(meters)+' m';
const minutesText = seconds=>seconds === 0 ? '0분' : seconds < 60 ? '1분 미만' : '약 '+Math.ceil(seconds/60)+'분';
const arrivalClock = new Intl.DateTimeFormat('ko-KR',{hour:'numeric',minute:'2-digit'});

export function initNavigationGuide({card,speak,searchParking}) {
  const turn = card.querySelector('strong');
  const distance = card.querySelector('[data-guide-distance]');
  const road = card.querySelector('[data-guide-road]');
  const stats = card.querySelector('[data-guide-stats]');
  const etaRow = card.querySelector('[data-guide-eta-row]');
  const eta = etaRow.querySelector('time');
  const branches = card.querySelector('[data-guide-branches]');
  const parking = card.querySelector('[data-guide-parking]');
  const list = card.querySelector('[data-guide-list]');
  const steps = list.querySelector('ol');
  let session;
  function text(node,value) {
    if (node.textContent !== value) node.textContent = value;
  }
  function showArrivalTime(timestamp) {
    etaRow.hidden = timestamp === null;
    if (timestamp === null) {
      eta.removeAttribute('datetime');
      text(eta,'');
      return;
    }
    const time = new Date(Math.floor(timestamp/1000)*1000);
    const stamp = time.toISOString();
    if (eta.getAttribute('datetime') !== stamp) {
      eta.setAttribute('datetime',stamp);
      text(eta,arrivalClock.format(time));
    }
  }
  function stop(owner) {
    if (session?.owner !== owner) return;
    session = null;
    card.hidden = true;
  }
  parking.onclick = ()=>{if (session?.destination) searchParking(session.destination,parking);};
  return {
    start(owner,route,dock) {
      session = {owner,plan:buildNavigationPlan(route),destination:route.destination,lastAnnouncement:null,progress:0,
        passedWaypoints:0,nearAnnounced:false,arrivalAnnounced:false};
      dock.prepend(card);
      card.hidden = false;
      text(turn,owner === 'gps' ? 'GPS 위치를 확인하고 있어요.' : '경로 안내를 준비하고 있어요.');
      text(distance,'');
      text(road,'');
      text(stats,'');
      text(branches,'');
      parking.hidden = !session.destination;
      showArrivalTime(null);
      list.hidden = session.plan.steps.length === 0;
      list.open = false;
      steps.replaceChildren(...session.plan.steps.map(step=>{
        const item = document.createElement('li');
        item.textContent = [step.text,step.road].filter(Boolean).join(' · ');
        return item;
      }));
    },
    stop,
    currentInstruction() {return session?.instruction || '';},
    passedWaypoints(owner) {return session?.owner === owner ? session.passedWaypoints : 0;},
    update(owner,progress,{seconds,arrived = false,announce = false,elapsed,distanceTraveled,estimatedAt = Date.now()} = {}) {
      if (session?.owner !== owner) return;
      if (progress === null) {
        session.instruction = '';
        text(turn,'경로 위 현재 위치를 확인하고 있어요.');
        for (const node of [distance,road,stats,branches]) text(node,'');
        showArrivalTime(null);
        return;
      }
      session.progress = Math.max(session.progress,progress);
      const state = readNavigation(session.plan,session.progress,seconds,estimatedAt);
      session.passedWaypoints = state.passedWaypoints;
      const {step,stepDistance} = state;
      session.instruction = arrived || !step ? '' : metersText(stepDistance)+' 앞 '+step.text+(step.road ? ', '+step.road : '');
      const index = step && !arrived ? state.index : -1;
      if (index !== session.highlight) {
        steps.children[session.highlight]?.removeAttribute('aria-current');
        steps.children[index]?.setAttribute('aria-current','step');
        session.highlight = index;
      }
      text(turn,arrived ? '목적지 도착' : step?.text || '다음 방향 정보 없음');
      text(distance,step ? metersText(stepDistance) : '');
      text(road,step?.road || '');
      const upcoming = state.junctions.filter(item=>item !== step);
      text(branches,arrived || !upcoming.length ? '' : '이어지는 분기 · '+upcoming
        .map(item=>[item.text,item.road].filter(Boolean).join(' ')).join(' → '));
      if (arrived) {
        showArrivalTime(null);
        text(stats,[metersText(distanceTraveled ?? session.plan.distance),Number.isFinite(elapsed) ? minutesText(elapsed) : '']
          .filter(Boolean).join(' · '));
        if (announce && !session.arrivalAnnounced && speak('목적지에 도착했습니다.')) session.arrivalAnnounced = true;
        return;
      }
      text(stats,'남은 '+metersText(state.remaining)+
        (state.seconds === null ? '' : ' · '+minutesText(state.seconds)));
      showArrivalTime(state.arrivalAt);
      if (announce && step && stepDistance <= (step.type === arrival ? 500 : 300) &&
          session.lastAnnouncement !== state.index &&
          speak(session.instruction)) {
        session.lastAnnouncement = state.index;
        if (step.type === arrival) session.nearAnnounced = true;
      } else if (announce && (!step || stepDistance > 300) && session.destination && state.remaining <= 500 && !session.nearAnnounced &&
          speak('목적지까지 '+metersText(state.remaining)+' 남았습니다.')) {
        session.nearAnnounced = true;
      }
    }
  };
}
