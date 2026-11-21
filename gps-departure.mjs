export function metersBetween(a, b) {
  const radians = Math.PI/180;
  const distance = Math.sin((b.lat-a.lat)*radians/2)**2
    + Math.cos(a.lat*radians)*Math.cos(b.lat*radians)*Math.sin((b.lng-a.lng)*radians/2)**2;
  return 6371000*2*Math.asin(Math.min(1,Math.sqrt(distance)));
}

export function departureCorrection(origin, fix) {
  if (origin?.ephemeral !== true || origin.name !== '현재 위치') return 'keep';
  if (!fix || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > 100 ||
      !Number.isFinite(fix.lat) || Math.abs(fix.lat) > 90 ||
      !Number.isFinite(fix.lng) || Math.abs(fix.lng) > 180) return 'unavailable';
  return metersBetween(origin,fix) > 100 ? 'correct' : 'keep';
}

export function gpsOriginDecision(coords,requestVersion,currentVersion) {
  if (requestVersion !== currentVersion) return {kind:'ignore'};
  const {latitude:lat,longitude:lng} = coords ?? {};
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return {kind:'unavailable'};
  if (lat < 32 || lat > 40 || lng < 124 || lng > 132) return {kind:'outside-region'};
  return {kind:'use',place:{lat,lng,name:'현재 위치',ephemeral:true}};
}
