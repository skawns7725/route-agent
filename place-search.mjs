async function fetchPlaces(path, params, message) {
  try {
    const response = await fetch(path+'?'+new URLSearchParams(params),{signal:AbortSignal.timeout(10000)});
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data?.places)) return data.places;
    }
  } catch {
    // Keep connection and response errors in the same user-facing state.
  }
  throw new Error(message);
}

export function createPlaceLookup() {
  return keyword=>fetchPlaces('/api/places',{keyword},'장소를 가져오지 못했어요. 다시 검색해 주세요.');
}

export function createParkingLookup() {
  return async destination=>{
    const {lat,lng} = destination ?? {};
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new Error('도착지 위치를 확인할 수 없어요.');
    }
    return fetchPlaces('/api/parking',{lat,lng},'주차장을 가져오지 못했어요. 다시 검색해 주세요.');
  };
}

export function naverPlaceUrl({name,address}) {
  const query = [name,address !== name ? address : ''].filter(Boolean).join(' ');
  return 'https://map.naver.com/p/search/'+encodeURIComponent(query);
}

export function initPlaceSearch({map, chooseRoutePlace, onSearch}) {
  const el = id=>document.getElementById(id);
  const form = el('mapSearchForm');
  const input = el('mapSearchInput');
  const submit = el('mapSearchSubmit');
  const results = el('mapSearchResults');
  const status = el('mapSearchStatus');
  const list = el('mapSearchList');
  const details = el('mapPlaceDetails');
  const title = el('mapPlaceName');
  const category = el('mapPlaceCategory');
  const address = el('mapPlaceAddress');
  const phone = el('mapPlacePhone');
  const reviews = el('mapPlaceReviews');
  let lookup, parkingLookup, selection, markers = [], generation = 0;
  const fromDestination = place=>Number.isFinite(place.distance) ? `도착지와 직선 ${place.distance.toLocaleString('ko-KR')}m` : '';

  function hideDetails() {
    selection = null;
    details.hidden = true;
    map.selectPlaceMarker(null);
  }

  function closeSearch() {
    generation++;
    hideDetails();
    results.hidden = true;
    list.replaceChildren();
    map.showPlaceMarkers([]);
  }

  function select(index) {
    const place = markers[index];
    selection = index;
    results.hidden = true;
    title.textContent = place.name;
    category.textContent = [place.category,fromDestination(place), 'distance' in place ? '요금 정보 미제공' : ''].filter(Boolean).join(' · ');
    category.hidden = !category.textContent;
    address.textContent = place.address;
    address.hidden = !place.address || place.address === place.name;
    phone.textContent = place.phone;
    phone.hidden = !place.phone;
    reviews.href = naverPlaceUrl(place);
    details.hidden = false;
    map.selectPlaceMarker(index);
    map.focusPoint(place);
    title.focus({preventScroll:true});
  }

  function showResults(places) {
    markers = places;
    list.replaceChildren(...places.map((place,index)=>{
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      const label = document.createElement('strong');
      label.textContent = place.name;
      const caption = document.createElement('small');
      caption.textContent = [place.category,place.address === place.name ? '' : place.address,fromDestination(place)]
        .filter(Boolean).join(' · ');
      caption.hidden = !caption.textContent;
      button.append(label,caption);
      button.onclick = ()=>select(index);
      item.append(button);
      return item;
    }));
    map.showPlaceMarkers(places,select);
    if (places.length === 1) map.focusPoint(places[0]);
    else if (places.length) map.focusRoute(places);
  }

  async function runLookup(fetchPlaces,parkingDestination = '') {
    onSearch();
    closeSearch();
    const current = generation;
    results.hidden = false;
    status.textContent = parkingDestination
      ? `${parkingDestination} 반경 1km에서 주차장을 찾고 있어요…`
      : '카카오 지도에서 찾고 있어요…';
    if (parkingDestination) {
      status.tabIndex = -1;
      status.focus({preventScroll:true});
    }
    try {
      const places = await fetchPlaces();
      if (generation !== current) return;
      showResults(places);
      status.textContent = parkingDestination
        ? (places.length
          ? `${parkingDestination} 반경 1km · 주차장 ${places.length}곳`
          : `${parkingDestination} 반경 1km에 검색된 주차장이 없어요.`)
        : (places.length ? `검색 결과 ${places.length}곳` : '검색 결과가 없어요.');
    } catch {
      if (generation === current) status.textContent = parkingDestination
        ? '주차장을 가져오지 못했어요. 다시 검색해 주세요.'
        : '장소를 가져오지 못했어요. 다시 검색해 주세요.';
    }
  }

  form.onsubmit = event=>{
    event.preventDefault();
    const query = input.value.trim();
    if (lookup && query) runLookup(()=>lookup(query));
  };

  el('mapSearchDismiss').onclick = ()=>{
    closeSearch();
    input.focus();
  };
  el('mapPlaceBack').onclick = ()=>{
    const index = selection;
    hideDetails();
    results.hidden = false;
    list.children[index]?.querySelector('button').focus({preventScroll:true});
  };
  el('mapPlaceClose').onclick = ()=>{
    closeSearch();
    input.focus();
  };
  for (const [id,slot] of [['mapPlaceStart','start'],['mapPlaceEnd','end']]) {
    el(id).onclick = ()=>{
      const place = markers[selection];
      if (!place) return;
      closeSearch();
      chooseRoutePlace(slot,place);
    };
  }
  el('mapSearch').addEventListener('keydown',event=>{
    if (event.key !== 'Escape' || (results.hidden && details.hidden)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!details.hidden) el('mapPlaceBack').click();
    else el('mapSearchDismiss').click();
  });
  map.onReady(()=>{
    lookup = createPlaceLookup();
    parkingLookup = createParkingLookup();
    input.disabled = submit.disabled = false;
  });
  return {
    searchParking(destination) {
      if (parkingLookup && destination) return runLookup(()=>parkingLookup(destination),destination.name || '도착지');
    }
  };
}
