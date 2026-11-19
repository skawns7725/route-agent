function normalizePlace(item) {
  const address = (item.road_address_name || item.address_name || '').trim();
  const name = (item.place_name || address).trim();
  const lat = Number(item.y);
  const lng = Number(item.x);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
      !String(item.y ?? '').trim() || !String(item.x ?? '').trim() ||
      Math.abs(lat) > 90 || Math.abs(lng) > 180 || !name) return null;
  return {
    lat,lng,name,address,
    category:(item.category_name || '').split('>').at(-1).trim(),
    phone:(item.phone || '').trim()
  };
}

export function createPlaceLookup(sdk) {
  const {Status,Places,Geocoder} = sdk.services;
  const places = new Places();
  const geocoder = new Geocoder();
  return keyword=>new Promise((resolve,reject)=>{
    function finish(items,status) {
      if (status === Status.ZERO_RESULT) return resolve([]);
      if (status !== Status.OK) return reject(new Error('장소를 가져오지 못했어요. 다시 검색해 주세요.'));
      resolve(Array.isArray(items) ? items.map(normalizePlace).filter(Boolean) : []);
    }
    places.keywordSearch(keyword,(items,status)=>{
      if (status === Status.ZERO_RESULT) geocoder.addressSearch(keyword,finish);
      else finish(items,status);
    });
  });
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
  let lookup, selection, markers = [], generation = 0;

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
    category.textContent = place.category;
    category.hidden = !place.category;
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
      caption.textContent = place.address === place.name ? place.category
        : [place.category,place.address].filter(Boolean).join(' · ');
      caption.hidden = !caption.textContent;
      button.append(label,caption);
      button.onclick = ()=>select(index);
      item.append(button);
      return item;
    }));
    map.showPlaceMarkers(places,select);
    if (places.length === 1) map.focusPoint(places[0]);
    else if (places.length) map.focusRoute(places);
    status.textContent = places.length ? '검색 결과 '+places.length+'곳' : '검색 결과가 없어요.';
  }

  form.onsubmit = async event=>{
    event.preventDefault();
    const query = input.value.trim();
    if (!lookup || !query) return;
    onSearch();
    closeSearch();
    const current = generation;
    results.hidden = false;
    status.textContent = '카카오 지도에서 찾고 있어요…';
    try {
      const places = await lookup(query);
      if (generation === current) showResults(places);
    } catch {
      if (generation === current) status.textContent = '장소를 가져오지 못했어요. 다시 검색해 주세요.';
    }
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
  map.onReady(({sdk})=>{
    lookup = createPlaceLookup(sdk);
    input.disabled = submit.disabled = false;
  });
}
