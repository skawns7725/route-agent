const storageKey = 'route-agent:saved-places:v1';
const limits = {favorites:20,recent:5};
const namedGroups = new Set(['home','work']);

export function normalizeSavedPlace(place) {
  if (!place || place.ephemeral || place.name === '현재 위치') return null;
  const {lat,lng,name,address} = place;
  if (typeof name !== 'string' || !name.trim() ||
      !Number.isFinite(lat) || lat < 32 || lat > 40 ||
      !Number.isFinite(lng) || lng < 124 || lng > 132) return null;
  return {lat,lng,name:name.trim().slice(0,150),address:typeof address === 'string' ? address.trim().slice(0,200) : ''};
}

function samePlace(a,b) {
  return a?.lat === b.lat && a?.lng === b.lng;
}

export function readSavedPlaces(storage) {
  let value;
  try { value = JSON.parse(storage.getItem(storageKey)); } catch { /* Unavailable or invalid storage. */ }
  return {
    home:normalizeSavedPlace(value?.home),
    work:normalizeSavedPlace(value?.work),
    favorites:readList('favorites'),
    recent:readList('recent')
  };

  function readList(group) {
    return (Array.isArray(value?.[group]) ? value[group] : [])
      .slice(0,limits[group]).map(normalizeSavedPlace).filter(Boolean);
  }
}

export function savePlace(book, group, place) {
  const entry = normalizeSavedPlace(place);
  if (!entry) return book;
  if (namedGroups.has(group)) return {...book,[group]:entry};
  if (!Object.hasOwn(limits,group)) return book;
  return {...book,[group]:[entry,...book[group].filter(other=>!samePlace(other,entry))].slice(0,limits[group])};
}

export function removePlace(book, group, place) {
  if (namedGroups.has(group)) return {...book,[group]:null};
  if (!Object.hasOwn(limits,group)) return book;
  return {...book,[group]:book[group].filter(other=>!samePlace(other,place))};
}

export function writeSavedPlaces(storage,book) {
  try {
    storage.setItem(storageKey,JSON.stringify(book));
    return true;
  } catch { return false; }
}
