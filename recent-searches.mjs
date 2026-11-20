import {normalizeSavedPlace} from './saved-places.mjs';

const key = 'route-agent:recent-searches:v1';
const limit = 20;

export function removeRecentSearch(entries,place) {
  return entries.filter(entry => entry.lat !== place.lat || entry.lng !== place.lng);
}

export function recordRecentSearch(entries,place,searchedAt = Date.now()) {
  const entry = normalizeSavedPlace(place);
  if (!entry) return entries;
  return [{...entry,searchedAt},...removeRecentSearch(entries,entry)].slice(0,limit);
}

export function readRecentSearches(storage) {
  try {
    const entries = JSON.parse(storage.getItem(key));
    if (!Array.isArray(entries)) return [];
    return entries.filter(entry => Number.isFinite(entry?.searchedAt) && Math.abs(entry.searchedAt) <= 8.64e15)
      .sort((a,b) => a.searchedAt-b.searchedAt)
      .reduce((recent,entry) => recordRecentSearch(recent,entry,entry.searchedAt),[]);
  } catch {
    return [];
  }
}

export function writeRecentSearches(storage,entries) {
  try {
    storage.setItem(key,JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}
