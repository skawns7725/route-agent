export function initSignals({map, closePanel}){
const el=id=>document.getElementById(id);
 const signalRegion=el('signalRegion'), signalCrossing=el('signalCrossing');
const signalStatus=el('signalStatus'), signalRows=el('signalRows'), refreshSignal=el('refreshSignal');
const showSignalMap=el('showSignalMap'), signalDistrict=el('signalDistrict'), facilityFilter=el('facilityFilter');
const isDaejeon=()=>signalRegion.value==='3000000000';
for(const [code,name] of [
 ['11','서울'],['30','대전'],['26','부산'],['27','대구'],['28','인천'],['29','광주'],['31','울산'],
 ['36','세종'],['41','경기'],['51','강원'],['43','충북'],['44','충남'],['52','전북'],['46','전남'],
 ['47','경북'],['48','경남'],['50','제주']
]) signalRegion.add(new Option(name,code+'00000000'));

const signalIntersections=new Map();
let signalRequest=0, signalExpiry;
async function requestSignal(path, params){
 const response=await fetch(path+'?'+new URLSearchParams(params),{signal:AbortSignal.timeout(12000)});
 const data=await response.json();
 if(!response.ok)throw Error(data.error);
 return data;
}
function resetSignalDetails(){
 clearTimeout(signalExpiry);
 signalRows.replaceChildren();
}
function populateFacilityOptions(){
 const previous=signalCrossing.value;
 const keyword=facilityFilter.value.trim().replace(/\s/g,'').toLowerCase();
 const matches=[...signalIntersections.values()].filter(facility=>
  [facility.name,facility.road,facility.managementId].some(value=>value.replace(/\s/g,'').toLowerCase().includes(keyword)));
 signalCrossing.replaceChildren(new Option('신호등 선택',''));
 for(const facility of matches.slice(0,100)){
  signalCrossing.add(new Option(facility.name+' · '+(facility.type||'유형 미제공')+' · '+facility.managementId,facility.id));
 }
 signalCrossing.disabled=!matches.length;
 signalCrossing.value=matches.slice(0,100).some(facility=>facility.id===previous)?previous:'';
 if(previous&&!signalCrossing.value){
  resetSignalDetails();
  updateSignalMarker();
 }
 signalStatus.textContent=!matches.length?'검색 조건에 맞는 신호등이 없어요.'
  :matches.length>100?`신호등 ${matches.length.toLocaleString('ko-KR')}건 중 100건 표시 · 주소나 관리번호로 좁혀 보세요.`
  :`신호등 ${matches.length.toLocaleString('ko-KR')}건`;
}
function updateSignalMarker(){
 const crossing=signalIntersections.get(signalCrossing.value);
 map.setObservedPoint(crossing || null);
 showSignalMap.hidden=!map.connected()||!crossing;
}
showSignalMap.onclick=()=>{
 const crossing=signalIntersections.get(signalCrossing.value);
 if(crossing) map.focusPoint(crossing);
 if(matchMedia('(max-width: 720px)').matches) closePanel();
};
map.onReady(updateSignalMarker);
async function loadSignalIntersections(){
 const token=++signalRequest;
 const local=isDaejeon();
 el('signalDistrictRow').hidden=!local;
 el('facilityFilterRow').hidden=!local;
 el('signalCrossingLabel').textContent=local?'신호등':'교차로';
 el('signalSource').href='https://www.data.go.kr/data/'+(local?'15110706':'15157604')+'/openapi.do';
 el('signalSourceNote').textContent=local?'대전광역시 설치 현황 · 실시간 잔여시간 미제공':'신호 정보는 제공 시점의 참고값입니다. 실제 신호를 따르세요.';
 resetSignalDetails();
 signalIntersections.clear();
 signalCrossing.replaceChildren(new Option(local?'신호등 선택':'교차로 선택',''));
 signalCrossing.disabled=true;
 facilityFilter.disabled=true;
 refreshSignal.disabled=true;
 updateSignalMarker();
 signalStatus.textContent=local?'신호등 목록을 불러오는 중…':'교차로 목록을 불러오는 중…';
 try{
  if(local){
   const data=await requestSignal('/api/traffic-light-facilities',{district:signalDistrict.value});
   if(token!==signalRequest)return;
   data.facilities.sort((a,b)=>a.name.localeCompare(b.name,'ko'));
   for(const facility of data.facilities)signalIntersections.set(facility.id,facility);
   facilityFilter.disabled=false;
   populateFacilityOptions();
   return;
  }
  const data=await requestSignal('/api/intersections',{region:signalRegion.value});
  if(token!==signalRequest)return;
  data.intersections.sort((a,b)=>Number(b.hasSignals)-Number(a.hasSignals)||a.name.localeCompare(b.name,'ko'));
  for(const crossing of data.intersections){
   signalIntersections.set(crossing.id,crossing);
   signalCrossing.add(new Option(crossing.name+(crossing.hasSignals?' · 신호 응답 있음':''),crossing.id));
  }
  signalCrossing.disabled=!signalIntersections.size;
  signalStatus.textContent=signalIntersections.size?'교차로를 선택하면 신호 정보를 조회합니다.':'이 지역에서 제공되는 교차로 정보가 없어요. 다른 지역을 선택해 주세요.';
 }catch(error){
  if(token===signalRequest)signalStatus.textContent=error.message||'교차로 목록을 가져오지 못했어요.';
 }finally{
  if(token===signalRequest)refreshSignal.disabled=false;
 }
}
async function loadSignalDetails(){
 const token=++signalRequest;
 const id=signalCrossing.value;
 resetSignalDetails();
 updateSignalMarker();
 if(!id){
  refreshSignal.disabled=false;
  if(isDaejeon())populateFacilityOptions();
  else signalStatus.textContent='교차로를 선택해 주세요.';
  return;
 }
 if(isDaejeon()){
  const facility=signalIntersections.get(id);
  const record=document.createElement('p');
  record.textContent=[
   facility.name,
   facility.road,
   facility.type,
   facility.lenses,
   '관리번호 '+facility.managementId,
   facility.referenceDate&&'자료 기준 '+facility.referenceDate
  ].filter(Boolean).join(' · ');
  record.className='facility-record';
  signalRows.append(record);
  return;
 }
 refreshSignal.disabled=true;
 signalStatus.textContent='신호 정보를 조회하는 중…';
 try{
  const data=await requestSignal('/api/traffic-signals',{region:signalRegion.value,id});
  if(token!==signalRequest)return;
  if(!data.signals.length){
   signalStatus.textContent='이 교차로의 현재 신호를 확인할 수 없어요.';
   return;
  }
  const observed=Date.parse(data.observedAt);
  const observedLabel=Number.isFinite(observed)
   ?'집계 '+new Date(observed).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul'})
   :'집계 시각 미제공';
  const remainingMs=observed+15000-Date.now();
  const current=Boolean(data.fresh&&remainingMs>0);
  const queriedLabel=new Date().toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul'});
  const render=fresh=>{
   signalStatus.textContent=fresh
    ? observedLabel+' · 조회 '+queriedLabel
    : '현재 신호를 확인할 수 없어요. 다시 조회해 주세요. '+observedLabel+' · 조회 '+queriedLabel;
   signalRows.replaceChildren();
   if(!fresh)return;
   const list=document.createElement('ul');
   list.className='signal-list';
   for(const signal of data.signals){
    const item=document.createElement('li');
    const label=document.createElement('span');
    label.textContent=signal.direction+' '+signal.movement;
    const value=document.createElement('strong');
    value.textContent=signal.state+(signal.seconds!==null?' · '+signal.seconds+'초':'');
    item.append(label,value);
    list.append(item);
   }
   signalRows.append(list);
  };
  render(current);
  if(current)signalExpiry=setTimeout(()=>render(false),remainingMs);
 }catch(error){
  if(token===signalRequest)signalStatus.textContent=error.message||'신호 정보를 가져오지 못했어요.';
 }finally{
  if(token===signalRequest)refreshSignal.disabled=false;
 }
}

signalRegion.onchange=signalDistrict.onchange=()=>{
 facilityFilter.value='';
 loadSignalIntersections();
};
facilityFilter.oninput=populateFacilityOptions;
signalCrossing.onchange=loadSignalDetails;
refreshSignal.onclick=()=>!isDaejeon()&&signalCrossing.value?loadSignalDetails():loadSignalIntersections();

return ()=>{if(!signalRequest)loadSignalIntersections();};
}
