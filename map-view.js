const center = {lat:36.348,lng:127.397};
const routeColor = '#2563eb';
const zoomSpeeds = [30, 60, 90];

function courseBetween(from, to, minimumMeters) {
  const north = (to.lat - from.lat) * 111195;
  const east = (to.lng - from.lng) * 111195 * Math.cos(from.lat * Math.PI / 180);
  if (Math.hypot(east,north) < minimumMeters) return null;
  return Math.atan2(east,north) * 180 / Math.PI;
}
const river = [[127.32,36.403],[127.342,36.393],[127.367,36.392],[127.387,36.402],[127.409,36.393],[127.431,36.373],[127.433,36.361],[127.418,36.346],[127.420,36.334],[127.435,36.311],[127.462,36.299]];
const arterialRoads = [
  [[127.309,36.350],[127.338,36.351],[127.361,36.351],[127.384,36.356],[127.416,36.357],[127.453,36.355],[127.484,36.354]],
  [[127.314,36.375],[127.343,36.374],[127.364,36.375],[127.389,36.369],[127.419,36.368],[127.450,36.369],[127.486,36.374]],
  [[127.302,36.319],[127.339,36.325],[127.360,36.327],[127.384,36.328],[127.411,36.327],[127.447,36.324],[127.478,36.329]],
  [[127.346,36.300],[127.346,36.324],[127.350,36.349],[127.347,36.375],[127.353,36.407]],
  [[127.380,36.291],[127.380,36.323],[127.381,36.349],[127.385,36.373],[127.391,36.414]],
  [[127.408,36.296],[127.407,36.321],[127.407,36.349],[127.413,36.373],[127.421,36.414]],
  [[127.466,36.292],[127.455,36.319],[127.448,36.349],[127.450,36.380],[127.460,36.415]],
  [[127.302,36.396],[127.334,36.389],[127.352,36.385],[127.372,36.376],[127.398,36.359],[127.428,36.342],[127.455,36.334],[127.493,36.312]]
];
const parks = [
  [[127.315,36.395],[127.324,36.374],[127.307,36.361],[127.297,36.376],[127.302,36.397]],
  [[127.361,36.395],[127.357,36.386],[127.368,36.381],[127.383,36.385],[127.387,36.394]],
  [[127.447,36.396],[127.433,36.387],[127.440,36.379],[127.461,36.383],[127.469,36.392]],
  [[127.466,36.331],[127.478,36.335],[127.496,36.321],[127.487,36.303],[127.474,36.306]],
  [[127.347,36.326],[127.358,36.314],[127.350,36.297],[127.323,36.303],[127.325,36.318]],
  [[127.391,36.349],[127.391,36.342],[127.400,36.339],[127.407,36.347],[127.401,36.353]],
  [[127.425,36.316],[127.412,36.308],[127.425,36.291],[127.443,36.301],[127.438,36.311]]
];
const labels = [
  ['유성구',127.333,36.38],['갑천',127.370,36.397],['둔산동',127.389,36.379],['서구',127.356,36.333],
  ['대전광역시',127.383,36.346],['대덕구',127.467,36.386],['중구',127.397,36.311],['동구',127.451,36.311]
];

function offlineMap(canvas, preview) {
  const ctx = canvas.getContext('2d');
  let width = 0, height = 0, zoom = 1, panX = 0, panY = 0, frame = 0, snapshot = null, drag, camera;
  let cameraScale;
  const workspace = document.getElementById('workspace');
  function point(lng, lat) {
    if (camera) {
      return [
        width/2 + (lng-camera.point.lng)*cameraScale*.82,
        height/2 + (camera.point.lat-lat)*cameraScale
      ];
    }
    const compact = matchMedia('(width < 768px)').matches;
    const tablet = matchMedia('(768px <= width < 1024px)').matches;
    const panel = workspace.classList.contains('panel-open');
    const scale = Math.min(width / (compact ? .137 : .173),height / .113) * zoom;
    return [
      width * (tablet && panel ? .71 : .5) + (lng-center.lng)*scale*.82 + panX,
      height * (compact ? panel ? .29 : .43 : .50) - (lat-center.lat)*scale + panY
    ];
  }
  function begin(points) {
    ctx.beginPath();
    for (const [i,[lng,lat]] of points.entries()) {
      const [x,y] = point(lng,lat);
      if (i === 0) ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
    }
  }
  function stroke(points, color, weight, dash = []) {
    begin(points);
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = weight;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  function pin(location, color, text, radius, offset = 0) {
    const [x,projectedY] = point(location.lng,location.lat);
    const y = projectedY + offset;
    ctx.beginPath();
    ctx.arc(x,y,radius,0,Math.PI*2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (!text) return;
    ctx.font = '700 13px "Malgun Gothic", sans-serif';
    ctx.textAlign = width < 440 && x > width - 75 ? 'right' : 'left';
    ctx.strokeStyle = '#fffffff5';
    ctx.lineWidth = 4;
    const anchor = x + (ctx.textAlign === 'right' ? -11 : 11);
    ctx.strokeText(text,anchor,y-10);
    ctx.fillStyle = '#263f35';
    ctx.fillText(text,anchor,y-10);
  }
  function render() {
    frame = 0;
    if (!ctx || canvas.hidden) return;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    if (!width || !height) return;
    // Base zoom on the viewport rather than the oversized perspective surface.
    if (camera) cameraScale = Math.min(workspace.clientWidth/.137,workspace.clientHeight/.113) * 2 ** (5-camera.level);
    const dpr = Math.min(window.devicePixelRatio || 1,2,camera ? 4096/Math.max(width,height) : Infinity);
    if (canvas.width !== Math.round(width*dpr) || canvas.height !== Math.round(height*dpr)) {
      canvas.width = Math.round(width*dpr);
      canvas.height = Math.round(height*dpr);
    }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.fillStyle = '#e8ede4';
    ctx.fillRect(0,0,width,height);
    for (const [i,park] of parks.entries()) {
      begin(park);
      ctx.closePath();
      ctx.fillStyle = i % 2 ? '#d0e3c9' : '#d9e8d2';
      ctx.fill();
    }
    // Offset the two sets of local streets to give the schematic neighborhood blocks.
    for (let i=0;i<47;i++) {
      const x = 127.255+i*.006;
      const shift = Math.sin(i*1.7)*.005;
      stroke([[x-.01,36.54],[x-.009,36.438],[x+shift,36.388],[x,36.355],[x+shift,36.327],[x+.01,36.273],[x+.007,36.16]], '#f9fbf6', i%4===0?2.8:1.35);
    }
    for (let i=-22;i<55;i++) {
      const y = 36.276+i*.005;
      const [,screenY] = point(center.lng,y);
      if (screenY < -70 || screenY > height+70) continue;
      const shift = Math.sin(i*1.4)*.005;
      stroke([[127.251,y-.008],[127.338,y],[127.378,y+shift],[127.442,y],[127.505,y+shift],[127.546,y+.005]], '#fbfcf9', i%4===0?2.8:1.35);
    }
    stroke(river,'#d4e6dd',18);
    stroke(river,'#b3d6db',10);
    arterialRoads.forEach((road,i)=>{
      stroke(road,'#d4d9c1',i===7?7:5);
      stroke(road,i===7?'#faf1d8':'#fffefa',i===7?5:3.4);
    });
    for (const [name,lng,lat] of labels) {
      const [x,y] = point(lng,lat);
      ctx.textAlign = 'center';
      ctx.font = name === '대전광역시' ? '700 18px "Malgun Gothic", sans-serif' : '600 12px "Malgun Gothic", sans-serif';
      ctx.strokeStyle = '#eff4ec';
      ctx.lineWidth = 3;
      ctx.strokeText(name,x,y);
      ctx.fillStyle = '#586d61';
      ctx.fillText(name,x,y);
    }
    const route = snapshot?.points || preview;
    if (!route.length) return;
    const geometry = route.map(p=>[p.lng,p.lat]);
    stroke(geometry,'#fff',8);
    stroke(geometry,routeColor,snapshot?5:3.5,snapshot?[]:[5,6]);
    pin(route[0],'#294d43','용운동',5);
    pin(route.at(-1),'#247b68','충남대',5);
    if (!snapshot) return;
    for (const stop of snapshot.stops) pin(stop,stop.state==='red'?'#b52d34':'#237a58','',5,-12);
    if (snapshot.position && !camera) pin(snapshot.position,'#334fd0','모의 차량',8);
  }
  function redraw() {
    if (!frame) frame = requestAnimationFrame(render);
  }
  function scrollZoom(delta) {
    zoom = Math.max(.65,Math.min(3,zoom*(delta > 0 ? 1.22 : .82)));
    redraw();
  }
  canvas.addEventListener('pointerdown',event=>{
    drag = {id:event.pointerId,x:event.clientX,y:event.clientY,panX,panY};
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove',event=>{
    if (drag?.id !== event.pointerId) return;
    panX = drag.panX+event.clientX-drag.x;
    panY = drag.panY+event.clientY-drag.y;
    redraw();
  });
  for (const name of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(name,()=>{drag=null;});
  new ResizeObserver(redraw).observe(canvas);
  return {
    redraw,zoom:scrollZoom,
    setSnapshot(value){snapshot=value;redraw();},
    setCamera(value){camera=value;redraw();}
  };
}

export function createMap(preview,{mapType = 'road',traffic = false,onTrafficChange} = {}) {
  const canvas = document.getElementById('exampleMap');
  const live = document.getElementById('atlasMap');
  const credit = document.getElementById('mapCredit');
  const header = document.getElementById('tileState');
  const placeholder = document.getElementById('mapPlaceholder');
  const placeholderStatus = document.getElementById('mapPlaceholderStatus');
  const retry = document.getElementById('retryMap');
  const zoomControls = document.querySelector('.map-zoom');
  const switchButton = document.getElementById('mapSwitch');
  const trafficButton = document.getElementById('mapTrafficToggle');
  const workspace = document.getElementById('workspace');
  const offline = offlineMap(canvas,preview);
  const listeners = [];
  let sdk, instance, liveMode = false, exampleMode = false, connecting = false, route, observation;
  let routeLine, routeMarkers = [], observedMarker, gpsMarker, simulatedMarker, nextSignalMarker;
  let placeMarkers = [];
  let followingGps = false;
  let trafficEnabled = traffic;
  let navigationOwner = null, navigationPoint, bearingPoint, heading, exploreCamera;
  let navigationSpeed = null, navigationLevel = 3;
  let vehicle, sdkCredit, sdkCreditAnchor;

  new ResizeObserver(() => {
    if (liveMode) {
      instance.relayout();
      if (navigationPoint) instance.setCenter(latLng(navigationPoint));
    }
  }).observe(live);

  function updateSdkCredit() {
    if (!sdkCredit) return;
    if (liveMode && navigationOwner) {
      if (sdkCredit.parentElement === workspace) return;
      sdkCredit.replaceWith(sdkCreditAnchor);
      sdkCredit.classList.add('map-sdk-credit');
      workspace.append(sdkCredit);
    } else if (sdkCreditAnchor.parentNode) {
      sdkCreditAnchor.replaceWith(sdkCredit);
      sdkCredit.classList.remove('map-sdk-credit');
    }
  }

  function chooseMode(mode) {
    liveMode = mode === 'live' && Boolean(instance);
    exampleMode = mode === 'example';
    live.hidden = !liveMode;
    canvas.hidden = !exampleMode;
    credit.hidden = !exampleMode;
    placeholder.hidden = liveMode || exampleMode;
    zoomControls.hidden = !liveMode && !exampleMode;
    if (trafficButton) trafficButton.disabled = !liveMode || sdk.MapTypeId?.TRAFFIC == null;
    document.getElementById('mapMode').textContent = exampleMode ? '오프라인 예시' : '카카오 지도';
    switchButton.hidden = !exampleMode || !instance;
    workspace.classList.toggle('map-live',liveMode);
    workspace.classList.toggle('map-ready',Boolean(instance));
    updateSdkCredit();
    if (liveMode) instance.relayout();
    if (exampleMode) offline.redraw();
  }
  const latLng = point=>new sdk.LatLng(point.lat,point.lng);
  function line(points, options) {
    return new sdk.Polyline({map:instance,path:points.map(latLng),strokeOpacity:.95,...options});
  }
  function redrawRoute() {
    if (!instance) return;
    routeLine?.setMap(null);
    routeMarkers.forEach(marker=>marker.setMap(null));
    routeMarkers = (route?.markers || []).map(marker=>new sdk.Marker({map:instance,position:latLng(marker),title:marker.label}));
    routeLine = route?.points.length > 1 ? line(route.points,{strokeColor:routeColor,strokeWeight:6}) : null;
  }
  function redrawObservation() {
    if (!instance) return;
    observedMarker?.setMap(null);
    observedMarker = observation && !navigationOwner
      ? new sdk.Marker({map:instance,position:latLng(observation),title:observation.name || '실제 신호 위치'}) : null;
  }
  function aimCamera(point, {points, gpsHeading, accuracy = 0} = {}) {
    if (heading == null && points?.length > 1) {
      for (let index = 1; index < points.length; index++) {
        heading = courseBetween(points[0],points[index],1);
        if (heading !== null) break;
      }
    }
    if (Number.isFinite(gpsHeading) && gpsHeading >= 0 && gpsHeading < 360 && navigationSpeed >= 2 && accuracy <= 40) {
      heading = gpsHeading;
      bearingPoint = point;
    } else if (!bearingPoint) bearingPoint = point;
    else if (navigationSpeed !== 0 && accuracy <= 40) {
      const course = courseBetween(bearingPoint,point,Math.max(.8,accuracy));
      if (course !== null) {
        heading = course;
        bearingPoint = point;
      }
    }
    // Keep the current zoom just beyond each speed threshold to avoid GPS jitter.
    const kmh = Number.isFinite(navigationSpeed) ? navigationSpeed * 3.6 : 0;
    while (navigationLevel < 6 && kmh >= zoomSpeeds[navigationLevel-3] + 3) navigationLevel++;
    while (navigationLevel > 3 && kmh < zoomSpeeds[navigationLevel-4] - 3) navigationLevel--;
    navigationPoint = point;
    vehicle.hidden = false;
    const angle = heading ?? 0;
    workspace.style.setProperty('--navigation-heading',angle+'deg');
    if (exampleMode) {
      offline.setCamera({point,level:navigationLevel});
    } else if (liveMode) {
      if (instance.getLevel() !== navigationLevel) instance.setLevel(navigationLevel);
      instance.setCenter(latLng(point));
    }
  }
  function setNavigationMode(owner) {
    if (owner === navigationOwner) return;
    if (!vehicle) {
      vehicle = document.createElement('span');
      vehicle.className = 'navigation-vehicle';
      vehicle.setAttribute('role','img');
      vehicle.setAttribute('aria-label','주행 위치');
      workspace.append(vehicle);
    }
    if (!navigationOwner && instance) exploreCamera = {center:instance.getCenter(),level:instance.getLevel()};
    navigationOwner = owner;
    navigationPoint = bearingPoint = heading = null;
    navigationSpeed = null;
    navigationLevel = 3;
    followingGps = false;
    vehicle.hidden = true;
    workspace.classList.toggle('navigation-map',Boolean(owner));
    workspace.style.removeProperty('--navigation-heading');
    offline.setCamera(null);
    updateSdkCredit();
    if (!instance) return;
    instance.relayout();
    instance.setDraggable(!owner);
    instance.setZoomable(!owner);
    redrawObservation();
    for (const {overlay} of placeMarkers) overlay.setMap(owner ? null : instance);
    if (!owner && exploreCamera) {
      instance.setLevel(exploreCamera.level);
      instance.setCenter(exploreCamera.center);
      exploreCamera = null;
    } else if (owner === 'gps' && route?.points.length) {
      aimCamera(route.points[0],{points:route.points});
      vehicle.hidden = true;
      bearingPoint = null;
    }
  }
  function zoom(delta) {
    if (liveMode) instance.setLevel(Math.max(1,Math.min(14,instance.getLevel()-delta)));
    else offline.zoom(delta);
  }
  function setMapType(type) {
    mapType = type;
    const id = sdk?.MapTypeId?.[type === 'hybrid' ? 'HYBRID' : 'ROADMAP'];
    if (id != null) instance.setMapTypeId(id);
  }
  document.getElementById('zoomIn').onclick = ()=>zoom(1);
  document.getElementById('zoomOut').onclick = ()=>zoom(-1);
  switchButton.onclick = ()=>chooseMode('live');
  if (trafficButton) {
    trafficButton.setAttribute('aria-pressed',String(trafficEnabled));
    trafficButton.onclick = ()=>{
      if (trafficButton.disabled) return;
      const id = sdk.MapTypeId.TRAFFIC;
      trafficEnabled = !trafficEnabled;
      if (trafficEnabled) instance.addOverlayMapTypeId(id);
      else instance.removeOverlayMapTypeId(id);
      trafficButton.setAttribute('aria-pressed',String(trafficEnabled));
      onTrafficChange?.(trafficEnabled);
    };
  }
  chooseMode('pending');

  function setConnectionStatus(message, retryable = false) {
    header.textContent = message;
    placeholderStatus.textContent = message;
    retry.hidden = !retryable;
  }

  async function connect() {
    if (connecting || instance) return;
    connecting = true;
    setConnectionStatus('지도 연결 확인 중');
    try {
      const reply = await fetch('/api/map-config',{signal:AbortSignal.timeout(5000)});
      if (!reply.ok) throw Error('지도 설정을 확인하지 못했어요.');
      const {javascriptKey} = await reply.json();
      if (!javascriptKey) {
        setConnectionStatus('서버에 카카오 지도 키를 설정해 주세요.',true);
        workspace.classList.add('map-unavailable');
        return;
      }
      const script = document.createElement('script');
      const url = 'https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&libraries=services&appkey='+encodeURIComponent(javascriptKey);
      await new Promise((resolve,reject)=>{
        const timer = setTimeout(()=>reject(Error('카카오 지도 연결 시간이 초과됐어요.')),10000);
        script.onerror = ()=>{clearTimeout(timer);reject(Error('카카오 지도에 연결할 수 없어요.'));};
        script.onload = ()=>{
          if (!window.kakao?.maps?.load) {clearTimeout(timer);reject(Error('카카오 지도 SDK를 불러오지 못했어요.'));return;}
          window.kakao.maps.load(()=>{clearTimeout(timer);resolve();});
        };
        script.src = url;
        document.head.append(script);
      });
      sdk = window.kakao.maps;
      instance = new sdk.Map(live,{center:new sdk.LatLng(37.564,126.978),level:8});
      setMapType(mapType);
      if (trafficEnabled && sdk.MapTypeId?.TRAFFIC != null) instance.addOverlayMapTypeId(sdk.MapTypeId.TRAFFIC);
      // Keep the SDK's real attribution upright outside the transformed map.
      const logo = live.querySelector?.('img[alt^="Kakao"][src*="/mapjsapi/images/"]');
      sdkCredit = logo?.closest('a')?.parentElement?.parentElement;
      if (sdkCredit) sdkCreditAnchor = document.createComment('Kakao map attribution');
      sdk.event.addListener(instance,'dragstart',()=>{followingGps=false;});
      chooseMode(exampleMode ? 'example' : 'live');
      workspace.classList.remove('map-unavailable');
      setConnectionStatus('카카오 지도 연결됨');
      redrawRoute();
      redrawObservation();
      for (const listener of listeners.splice(0)) listener({sdk,instance});
    } catch {
      setConnectionStatus('카카오 지도 연결을 확인해 주세요.',true);
      workspace.classList.add('map-unavailable');
    } finally {
      connecting = false;
    }
  }
  retry.onclick = connect;
  return {
    connect,
    connected:()=>Boolean(instance),
    onReady(listener){if (instance) listener({sdk,instance}); else listeners.push(listener);},
    redraw:offline.redraw,
    setNavigationMode,
    setMapType,
    setNavigationSpeed(speed){navigationSpeed=speed;},
    setRoute(value){route=value;redrawRoute();},
    setObservedPoint(value){observation=value;redrawObservation();},
    showPlaceMarkers(places,onSelect) {
      for (const {overlay} of placeMarkers) overlay.setMap(null);
      placeMarkers = [];
      if (!instance) return;
      placeMarkers = places.map((place,index)=>{
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'map-place-marker';
        button.textContent = String(index+1);
        button.setAttribute('aria-label',place.name+' 지도 마커');
        button.setAttribute('aria-pressed','false');
        button.onclick = ()=>onSelect(index);
        const overlay = new sdk.CustomOverlay({
          map:navigationOwner ? null : instance,content:button,position:latLng(place),yAnchor:1,zIndex:6,clickable:true
        });
        return {button,overlay};
      });
    },
    selectPlaceMarker(index) {
      placeMarkers.forEach(({button,overlay},position)=>{
        const selected = index === position;
        button.setAttribute('aria-pressed',String(selected));
        overlay.setZIndex(selected ? 7 : 6);
      });
    },
    setNextSignal(crossing) {
      nextSignalMarker?.setMap(null);
      nextSignalMarker = null;
      if (!instance || !crossing) return;
      const icon = document.createElement('span');
      icon.className = 'map-next-signal';
      icon.setAttribute('role','img');
      icon.setAttribute('aria-label','다음 교차로: '+crossing.name);
      icon.textContent = '🚦';
      nextSignalMarker = new sdk.CustomOverlay({map:instance,content:icon,position:latLng(crossing),yAnchor:.5,zIndex:4});
    },
    focusPoint(point) {
      if (!instance || navigationOwner) return;
      followingGps = false;
      chooseMode('live');
      instance.setLevel(4);
      instance.panTo(latLng(point));
    },
    focusRoute(points) {
      if (!instance || navigationOwner || !points.length) return;
      followingGps = false;
      chooseMode('live');
      const bounds = new sdk.LatLngBounds();
      points.forEach(point=>bounds.extend(latLng(point)));
      const viewport = live.getBoundingClientRect();
      const panel = document.getElementById('toolPanel').getBoundingClientRect();
      const compact = matchMedia('(width < 768px)').matches;
      const panelOverlap = panel.width && panel.right > viewport.left;
      const left = 32 + (!compact && panelOverlap ? panel.right - viewport.left : 0);
      let bottom = 32;
      const bottomOverlays = compact
        ? ['toolPanel','routeSummary','playback','drivingDock']
        : ['routeSummary','playback','drivingDock'];
      for (const id of bottomOverlays) {
        const overlay = document.getElementById(id).getBoundingClientRect();
        if (overlay.height) bottom = Math.max(bottom,viewport.bottom - overlay.top + 16);
      }
      instance.setBounds(bounds,80,64,Math.min(bottom,viewport.height * .72),Math.min(left,viewport.width * .68));
    },
    setLivePosition(point, {follow = false, heading:gpsHeading, accuracy} = {}) {
      if (navigationOwner === 'gps') {
        gpsMarker?.setMap(null);
        gpsMarker = null;
        if (point) aimCamera(point,{gpsHeading,accuracy,points:route?.points});
        else {
          navigationPoint = bearingPoint = null;
          vehicle.hidden = true;
        }
        return;
      }
      if (!instance || !point) {
        gpsMarker?.setMap(null);
        gpsMarker = null;
        return;
      }
      const position = latLng(point);
      if (!gpsMarker) {
        const dot = document.createElement('span');
        dot.className = 'map-live-position';
        dot.setAttribute('role','img');
        dot.setAttribute('aria-label','현재 GPS 위치');
        gpsMarker = new sdk.CustomOverlay({map:instance,content:dot,position,yAnchor:.5,zIndex:5});
      } else gpsMarker.setPosition(position);
      if (follow) {
        followingGps = true;
        chooseMode('live');
        instance.setLevel(4);
      }
      if (followingGps) instance.panTo(position);
    },
    setSimulation(value) {
      if (value.offline) {
        if (!exampleMode) chooseMode('example');
        if (navigationOwner === 'simulation') aimCamera(value.position,{points:value.points});
        offline.setSnapshot(value);
        return;
      }
      if (!instance) return;
      if (navigationOwner === 'simulation') {
        if (!liveMode) chooseMode('live');
        aimCamera(value.position,{points:value.points});
        return;
      }
      const position = latLng(value.position);
      if (!simulatedMarker) {
        this.focusRoute(value.points);
        const marker = document.createElement('span');
        marker.className = 'map-simulated-vehicle';
        marker.textContent = '모의 차량';
        simulatedMarker = new sdk.CustomOverlay({map:instance,content:marker,position,yAnchor:.5,zIndex:5});
      } else simulatedMarker.setPosition(position);
    },
    clearSimulation(){
      simulatedMarker?.setMap(null);
      simulatedMarker = null;
      offline.setSnapshot(null);
      if (exampleMode) chooseMode(instance ? 'live' : 'pending');
    }
  };
}
