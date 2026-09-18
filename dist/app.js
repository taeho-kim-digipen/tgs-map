'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const viewport = $('viewport'), svg = $('map');
  const NS = 'http://www.w3.org/2000/svg';
  const STORAGE_KEY = 'tgs2026-interest-booths-v1';
  const DAY_PLAN_KEY = 'tgs2026-interest-days-v1';
  const DAY_FILTER_KEY = 'tgs2026-interest-day-filter-v1';
  const EVENT_DAYS = ['19','20','21'];
  const DAY_LABELS = {19:'19 토',20:'20 일',21:'21 월'};
  let contentItems=[], data, activeMap, activeView, byId, favorites = new Set(), storageOkay = true;
  let dayPlans={19:new Set(),20:new Set(),21:new Set()}, favoriteDayFilter='all';
  let visitBooths=[], lastSvgViewport='';
  let tx = 0, ty = 0, scale = 1, minScale = .1, maxScale = 20;
  let focused = null, toastTimer, frame = 0, holdTimer, gesture, lastTap, singleTapTimer;
  let navigation=null, beforeNavigation=null, controlsHidden=false;
  const pointers = new Map();
  let boothNodes = new Map();
  let scene, favoritePage=0;
  const vectorMaps=new Map();
  let modePreference='auto';
  const PLAN_MIGRATION_KEY='tgs2026-planned-booths-v2';
  const INTEREST_MIGRATION_KEY='tgs2026-interest-add-20260918-bushiroad-razbam';
  const FLOOR_UI_VERSION='v3';
  let campusViewBounds=new Map();
  let floorRegions={first:[],second:[]};
  let floorMode='all';
  let visitFilter='all';
  try{modePreference=localStorage.getItem('tgs2026-screen-mode')||'auto';}catch{}
  if(!['auto','portrait','landscape','pc'].includes(modePreference))modePreference='auto';
  const categories={
    entrance:{label:'입구',color:'#d84822',path:'M14 3h6v18h-6M3 12h11m-4-4 4 4-4 4'},
    locker:{label:'보관함',color:'#684cc4',path:'M4 5h16v16H4zM9 5V2h6v3M8 10h8M12 10v5'},
    food:{label:'식사',color:'#bb620d',path:'M5 2v7m3-7v7M3 6h7v3a3.5 3.5 0 0 1-7 0M6.5 12v10M18 2v20m0-20c-6 2-6 10 0 10'},
    charge:{label:'배터리',color:'#148a60',path:'M8 3h8v3H8zM6 6h12v16H6zM13 9l-4 5h4l-2 5 5-6h-4z'},
    info:{label:'안내소',color:'#16738e',path:'M12 10v9m-3 0h6M12 5v1'},
    event:{label:'이벤트',color:'#1f63c6',path:'M12 2l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2-4.5-4.4 6.2-.9L12 2z'},
    restroom:{label:'화장실',color:'#516883',path:'M8 5a2 2 0 1 0-4 0 2 2 0 0 0 4 0M3 10h6v6H3zM5 16v6m3-6v6M19 5a2 2 0 1 0-4 0 2 2 0 0 0 4 0M17 10l-4 8h8zM16 18v4m3-4v4'}
  };
  let resultItems=[],resultPage=0,resultHeading='',resultsOpen=false;
  const favoritesPerPage=()=>$('app').dataset.mode==='pc'?4:viewport.clientWidth>=700?4:3;
  // Use the layout viewport for orientation; the visual viewport can shrink for the keyboard.
  const layoutLandscape=()=>window.innerWidth>window.innerHeight;
  function syncScreen(){
    const visual=window.visualViewport;
    if(visual && Math.abs(visual.scale-1)>.01)return;
    const standalone=!!navigator.standalone||!!window.matchMedia?.('(display-mode: standalone)').matches;
    const editing=/^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName||'');
    // Home-screen Safari can report a stale, shorter visual viewport after launch.
    // Use its full layout height except while the keyboard is editing an input.
    const height=standalone&&!editing?window.innerHeight:(visual?.height||window.innerHeight),width=visual?.width||window.innerWidth;
    if(!(height>0&&width>0))return;
    const app=$('app'),landscape=layoutLandscape();
    const mode=modePreference==='auto'?(width>=1100?'pc':landscape?'landscape':'portrait'):modePreference;
    app.dataset.mode=mode;app.dataset.rotation='none';app.style.transform='none';app.style.left='0px';app.style.top='0px';
    let w=width,h=height;
    if(mode==='pc'){
      w=Math.max(1100,width);h=Math.max(640,height);const ratio=Math.min(width/w,height/h);
      app.style.transform=`scale(${ratio})`;app.style.left=`${(width-w*ratio)/2}px`;app.style.top=`${(height-h*ratio)/2}px`;
    }else if(modePreference!=='auto' && ((mode==='landscape'&&!landscape)||(mode==='portrait'&&landscape))){
      w=height;h=width;const clockwise=mode==='landscape';
      app.dataset.rotation=clockwise?'clockwise':'counterclockwise';
      app.style.transform=clockwise?`translate(${width}px, 0) rotate(90deg)`:`translate(0, ${height}px) rotate(-90deg)`;
    }
    app.style.height=standalone&&!editing&&mode!=='pc'&&app.dataset.rotation==='none'?'100dvh':`${h}px`;app.style.width=standalone&&mode!=='pc'&&app.dataset.rotation==='none'?'100%':`${w}px`;
  }
  syncScreen();
  window.addEventListener('resize',syncScreen);
  window.visualViewport?.addEventListener('resize',syncScreen);
  window.addEventListener('pageshow',syncScreen);
  document.addEventListener('focusin',()=>requestAnimationFrame(syncScreen));
  document.addEventListener('focusout',()=>requestAnimationFrame(syncScreen));
  const svgEl = (tag, attrs) => {
    const el = document.createElementNS(NS, tag);
    for (const [key,value] of Object.entries(attrs)) el.setAttribute(key,String(value));
    return el;
  };
  const nameOf = b => b.shortName || b.name;
  const locationOf = b => b.locationLabel||`${b.hall}홀`;
  const geometryOf=(b,mapId=activeMap?.id)=>!b?null:mapId==='campus'&&b.campus?(b.campusGeometry||(b.campusGeometry={...b,...b.campus,map:'campus',sourceMap:b.campus.sourceMap||b.map})):b.map===mapId?b:null;
  const campusFloorOf=item=>String(item?.floor||'').toUpperCase().startsWith('2')?'2f':'1f';
  function detailTier(){
    if(!activeMap||activeMap.id!=='campus')return 'full';
    if(scale<minScale*1.55)return 'overview';
    if(scale<minScale*2.5)return 'medium';
    return 'full';
  }
  function syncFloorSwitchUI(){
    const wrap=$('floor-switch');if(!wrap)return;
    const active=activeMap?.id==='campus';wrap.hidden=!active;
    for(const button of wrap.querySelectorAll?.('button')||[])button.setAttribute('aria-pressed',String(active&&button.dataset.floor===floorMode));
  }
  function syncOfficialFloorLayers(){
    if(activeMap?.id!=='campus'||!scene)return;
    const first=scene.querySelector('#official-1f-overlay');
    const second=scene.querySelector('#official-2f-overlay');
    if(first){if(floorMode==='2f')first.setAttribute('display','none');else first.removeAttribute('display');}
    if(second){if(floorMode==='2f')second.removeAttribute('display');else second.setAttribute('display','none');}
  }
  function setFloorMode(mode,{silent=false}={}){
    if(activeMap?.id!=='campus'){floorMode='all';syncFloorSwitchUI();return;}
    floorMode=mode==='2f'?'2f':'1f';
    $('map-floor').textContent=floorMode==='2f'?'2F · 센트럴몰':'1F · 메인 전시관';
    syncFloorSwitchUI();
    syncOfficialFloorLayers();
    updateSelection();
    renderTransform();
    if(!silent)announce(floorMode==='2f'?'2층만 표시':'1층만 표시');
  }
  function visitIcon(kind){
    const icon=svgEl('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.8,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'});
    const paths={demo:'M7 7h10a4 4 0 0 1 3.9 3.1l1 5.6a2.5 2.5 0 0 1-4.2 2.3L15 15H9l-2.7 3a2.5 2.5 0 0 1-4.2-2.3l1-5.6A4 4 0 0 1 7 7ZM7 9.5v5M4.5 12h5M16 11h.01M19 13h.01',ticket:'M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4V6Zm12 0v2m0 3v2m0 3v2',sale:'M5 7h14l1 14H4L5 7Zm3 0V5a4 4 0 0 1 8 0v2',unknown:'M9.2 8.5a3 3 0 0 1 5.8 1c0 2-3 2-3 4M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z'};
    icon.append(svgEl('path',{d:paths[kind]}));return icon;
  }
  const visitOf = b => data.details?.booths?.[b.id]||{};
  const needsTicket = info => ['required','partial','reservation'].includes(info.ticket);
  const matchesVisit = b => visitFilter==='all'||visitFilter==='off'||(visitFilter==='demo'?visitOf(b).demo==='yes':visitFilter==='ticket'?needsTicket(visitOf(b)):visitOf(b).sales==='yes');
  const coords = e => {
    const ctm=svg.getScreenCTM?.();
    if(ctm&&svg.createSVGPoint){const point=svg.createSVGPoint();point.x=e.clientX;point.y=e.clientY;const local=point.matrixTransform(ctm.inverse());return {x:local.x,y:local.y};}
    const r=viewport.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};
  };
  const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const midpoint = (a,b) => ({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const normal = text=>String(text||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const boothAliases={
    '05-N01':'반다이 남코 반남 건담 로그오빗 로그오빗 로그오밋 에이스컴뱃 rogue orbit ace combat',
    '06-C01':'부시로드 bushiroad', '03-C06':'라잠 razbam vrgineers f15 f-15 f35 f-35 시뮬레이터',
    '07-C03':'NC 엔씨 엔씨소프트 아스트라 Astra', '07-C04':'넥슨 nexon 마비노기 파레이돌리아 project rx',
    '07-S01':'캡콤 바이오하자드 슈팅레인지', '04-C04':'애니플렉스 아니플렉스',
    '04-N01':'세가 아틀러스 아틀라스', '03-S01':'스퀘어에닉스 스퀘어 에닉스',
    '06-S01':'소니 플레이스테이션 플스', '05-S01':'코나미', '03-N07':'코에이 테크모',
    '02-S09':'스마일게이트','02-N12':'넷마블','03-C03':'한국 공동관 코리아 파빌리온',
    '08-C13':'프로젝트문 프로젝트 문','08-S01':'산리오','06-N04':'해피넷',
    '07-N08':'구글플레이 구글 플레이','07-N06':'계명대학교 계명대','04-C03':'마인크래프트',
    '04-S02':'포켓페어','04-S01':'레벨파이브 레벨5','05-C06':'게임프리크',
    '07-N01':'호리','08-N18':'엠에스아이','08-C16':'소프맙 소프맵','08-C19':'아우터플레인'
  };
  function facilityIcon(category){
    const icon=svgEl('svg',{viewBox:'0 0 24 24',width:19,height:19,fill:'none',stroke:'currentColor','stroke-width':1.7,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'});
    icon.append(svgEl('path',{d:categories[category].path}));return icon;
  }
  function resultLimit(){const pc=$('app').dataset.mode==='pc';return clamp(Math.floor((viewport.clientHeight-(pc?158:106))/54),1,pc?7:5);}
  function closeResults(clear=true){
    resultsOpen=false;$('search-results').hidden=true;$('app').classList.remove('search-open');
    if(clear)$('booth-search').value='';
  }
  function openResults(items,title){resultItems=items;resultPage=0;resultHeading=title;resultsOpen=true;closeDetail();$('app').classList.add('search-open');renderResults();}
  function renderResults(){
    if(!resultsOpen)return;
    const size=resultLimit(),pages=Math.max(1,Math.ceil(resultItems.length/size));resultPage=clamp(resultPage,0,pages-1);
    $('search-results').hidden=false;$('results-title').textContent=`${resultHeading} · ${resultItems.length}`;$('results-list').replaceChildren();
    if(!resultItems.length){const p=document.createElement('p');p.className='empty';p.textContent='일치하는 부스나 시설이 없습니다.';$('results-list').append(p);}
    for(const item of resultItems.slice(resultPage*size,(resultPage+1)*size)){
      const button=document.createElement('button');button.className='result-item';
      const info=document.createElement('span'),name=document.createElement('strong'),meta=document.createElement('small');
      name.textContent=item.name;meta.textContent=item.category?`${item.floor} · ${categories[item.category].label}`:`${locationOf(item)} · ${item.code}`;
      info.append(name,meta);button.append(info);
      const kind=document.createElement('span');kind.className='result-kind';kind.textContent=item.category?categories[item.category].label:favorites.has(item.id)?'★':'부스';button.append(kind);
      button.addEventListener('click',()=>{closeResults(false);$('booth-search').blur();if(item.category)focusFacility(item.id);else focusBooth(item.id);});
      $('results-list').append(button);
    }
    $('results-page').textContent=`${resultPage+1} / ${pages}`;$('results-prev').disabled=resultPage===0;$('results-next').disabled=resultPage===pages-1;
  }
  function search(){
    if(!data)return;const raw=$('booth-search').value.trim();if(!raw){resultItems=[];closeResults(false);return;}
    const q=normal(raw),code=raw.match(/^0?(\d{1,2})\s*[- ]?\s*([a-z])\s*[- ]?\s*(\d{1,3})$/i);
    const exact=code?`${code[1].padStart(2,'0')}-${code[2].toUpperCase()}${code[3].padStart(2,'0')}`:null;
    if(!q){openResults([],'검색 결과');return;}
    const indieCode=raw.match(/^e\s*[- ]?\s*(\d{1,2})$/i);
    const selectedCode=indieCode?`E-${indieCode[1].padStart(2,'0')}`:null;
    const booths=data.booths.filter(b=>b.id===exact||b.id===selectedCode||b.searchText.includes(q));
    booths.sort((a,b)=>(a.id===(exact||selectedCode)?-1:b.id===(exact||selectedCode)?1:0));
    const facilities=data.facilities.filter(f=>normal(`${f.name} ${categories[f.category].label} ${f.floor} ${f.note} ${f.category==='locker'?'락커 코인로커':f.category==='food'?'푸드코트 식당 카페':f.category==='charge'?'보조배터리 충전 charge spot':f.category==='info'?'인포메이션 information':''}`).includes(q));
    openResults([...booths,...facilities],'검색 결과');
  }
  function renderFacilities(){
    if(!activeMap||!data)return;
    const layer=$('facility-markers');layer.replaceChildren();const fragment=document.createDocumentFragment(),clusters=[];const tier=detailTier();
    const radius=activeMap.id==='campus'?(tier==='overview'?52:tier==='medium'?38:27):27;
    for(const original of data.facilities){
      const facility=geometryOf(original);if(!facility)continue;
      if(activeMap.id==='campus'){
        if(campusFloorOf(original)!==floorMode)continue;
        if(tier==='overview'){
          if(floorMode==='1f'&&!['entrance','event'].includes(original.category))continue;
          if(floorMode==='2f'&&!['entrance','locker','info'].includes(original.category))continue;
          if(original.category==='restroom')continue;
        }else if(tier==='medium'&&original.category==='restroom')continue;
      }
      const x=tx+facility.x*scale,y=ty+facility.y*scale;
      if(x< -15||x>viewport.clientWidth+15||y< -15||y>viewport.clientHeight+15)continue;
      const cluster=clusters.find(c=>c.category===facility.category&&Math.hypot(c.x-x,c.y-y)<radius);
      if(cluster){const n=cluster.items.length;cluster.x=(cluster.x*n+x)/(n+1);cluster.y=(cluster.y*n+y)/(n+1);cluster.items.push(facility);}
      else clusters.push({category:facility.category,x,y,items:[facility]});
    }
    for(const c of clusters){
      const button=document.createElement('button');button.className=`facility-marker ${c.category}`;button.style.left=`${c.x}px`;button.style.top=`${c.y}px`;button.style.backgroundColor=categories[c.category].color;
      if(activeMap.id==='campus'&&tier!=='full')button.classList.add('is-muted');
      if(c.items.length===1&&navigation?.targetFacilityId?.()===c.items[0].id)button.classList.add('nav-destination');
      const title=c.items.length>1?categories[c.category].label+' '+c.items.length+'곳 · 확대':c.items[0].name;
      button.setAttribute('aria-label',title);button.title=title;button.append(facilityIcon(c.category));
      if(c.items.length>1){const count=document.createElement('span');count.className='cluster-count';count.textContent=c.items.length;button.append(count);}
      button.addEventListener('click',()=>{
        closeResults(false);
        if(c.items.length===1)focusFacility(c.items[0].id);
        else{closeDetail();activeView=null;const xs=c.items.map(f=>f.x),ys=c.items.map(f=>f.y);fitBounds([Math.min(...xs)-12,Math.min(...ys)-12,Math.max(...xs)+12,Math.max(...ys)+12],55);}
      });fragment.append(button);
    }
    layer.append(fragment);
  }
  function focusFacility(id){
    const original=data.facilities.find(f=>f.id===id);const f=geometryOf(original)||original;if(!f)return;
    closeResults(false);closeDetail();if(activeMap.id!==f.map)setMap(f.map);activeView=null;
    if(activeMap.id==='campus')setFloorMode(campusFloorOf(original),{silent:true});
    for(const el of $('hall-nav').children)el.setAttribute('aria-pressed',String(el.dataset.view===f.map));
    fitBounds([f.x-42,f.y-30,f.x+42,f.y+30],45);
    const panel=$('detail');panel.replaceChildren();
    const head=document.createElement('div');head.className='detail-head';const text=document.createElement('div'),code=document.createElement('div'),title=document.createElement('h2');
    code.className='booth-code';code.textContent=`${f.floor} / ${categories[f.category].label}`;title.textContent=f.name;text.append(code,title);
    const close=document.createElement('button');close.className='icon-button detail-close';close.textContent='✕';close.setAttribute('aria-label','시설 정보 닫기');close.addEventListener('click',closeDetail);head.append(text,close);
    const note=document.createElement('p');note.textContent=f.note;
    const routeAction=document.createElement('button');routeAction.className='route-button';routeAction.textContent=navigation?'이 시설까지 찾아가기':'위치 안내 준비 중';routeAction.disabled=!navigation;routeAction.addEventListener('click',()=>navigation?.toggleFacility(id));
    panel.append(head,note,routeAction);panel.hidden=false;
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY,JSON.stringify([...favorites])); }
    catch { storageOkay=false; $('storage-status').textContent='저장 실패 · 현재 창에서만 유지'; }
  }
  function loadDayPlans(){
    dayPlans={19:new Set(),20:new Set(),21:new Set()};
    try{
      const raw=localStorage.getItem(DAY_PLAN_KEY);
      if(raw!==null){
        const saved=JSON.parse(raw);
        for(const day of EVENT_DAYS)if(Array.isArray(saved?.[day]))dayPlans[day]=new Set(saved[day].filter(id=>byId.has(id)&&favorites.has(id)));
      }
      const savedFilter=localStorage.getItem(DAY_FILTER_KEY);if(savedFilter==='all'||EVENT_DAYS.includes(savedFilter))favoriteDayFilter=savedFilter;
    }catch{dayPlans={19:new Set(),20:new Set(),21:new Set()};favoriteDayFilter='all';}
  }
  function saveDayPlans(){
    try{
      localStorage.setItem(DAY_PLAN_KEY,JSON.stringify(Object.fromEntries(EVENT_DAYS.map(day=>[day,[...dayPlans[day]]]))));
      localStorage.setItem(DAY_FILTER_KEY,favoriteDayFilter);
    }catch{storageOkay=false;$('storage-status').textContent='저장 실패 · 현재 창에서만 유지';}
  }
  const daysFor=id=>EVENT_DAYS.filter(day=>dayPlans[day].has(id));
  const favoriteVisible=id=>favorites.has(id)&&(favoriteDayFilter==='all'||dayPlans[favoriteDayFilter].has(id));
  const visibleFavoriteIds=()=>[...favorites].filter(favoriteVisible);
  function renderFavoriteDayFilter(){
    const wrap=$('favorite-day-filter');if(!wrap)return;
    const counts={all:favorites.size,...Object.fromEntries(EVENT_DAYS.map(day=>[day,[...dayPlans[day]].filter(id=>favorites.has(id)).length]))};
    for(const button of wrap.querySelectorAll?.('button')||[]){
      const day=button.dataset.day, count=button.querySelector?.('[data-day-count]');
      if(count)count.textContent=String(counts[day]??0);
      button.setAttribute('aria-pressed',String(day===favoriteDayFilter));
    }
  }
  function setFavoriteDayFilter(day){
    if(day!=='all'&&!EVENT_DAYS.includes(day))return;
    favoriteDayFilter=day;favoritePage=0;saveDayPlans();renderFavorites();updateSelection();
  }
  function toggleBoothDay(id,day){
    if(!byId.has(id)||!EVENT_DAYS.includes(day))return;
    const add=!dayPlans[day].has(id);
    if(add&&!favorites.has(id)){favorites.add(id);save();}
    if(add)dayPlans[day].add(id);else dayPlans[day].delete(id);
    saveDayPlans();renderFavorites();updateSelection();
    if(focused===id){if($('detail').hidden)renderBoothPeek(id);else showDetail(id);}
    announce(`${nameOf(byId.get(id))} · ${DAY_LABELS[day]} ${add?'추가':'해제'}`);
  }
  function announce(message) {
    clearTimeout(toastTimer); $('toast').textContent=message; $('toast').classList.add('show');
    toastTimer=setTimeout(()=>$('toast').classList.remove('show'),2200);
  }
  function toggle(id, selected) {
    if (!byId.has(id)) throw new Error('알 수 없는 부스입니다.');
    const b=byId.get(id), add=typeof selected==='boolean'?selected:!favorites.has(id);
    if (add) favorites.add(id); else {favorites.delete(id);for(const day of EVENT_DAYS)dayPlans[day].delete(id);}
    save(); saveDayPlans(); renderFavorites(); updateSelection();
    if(focused===id){if($('detail').hidden)renderBoothPeek(id);else showDetail(id);}
    announce(`${nameOf(b)} · ${add?'관심 등록':'관심 해제'}${storageOkay?'':' (저장 실패)'}`);
    return {id,selected:add};
  }
  function updateSelection() {
    for (const [id,node] of boothNodes) {
      const b=byId.get(id),info=visitOf(b),enabled=visitFilter!=='off';
      const hiddenFloor=activeMap?.id==='campus'&&floorMode==='2f';
      node.classList.toggle('hidden-floor',hiddenFloor);
      node.classList.toggle('visit-demo-outline',enabled&&!hiddenFloor&&info.demo==='yes');
      node.classList.toggle('visit-ticket-outline',enabled&&!hiddenFloor&&needsTicket(info));
      node.classList.toggle('visit-sale-outline',enabled&&!hiddenFloor&&info.sales==='yes'&&!needsTicket(info));
      node.classList.toggle('visit-muted',!hiddenFloor&&!matchesVisit(b));
      node.classList.toggle('selected',!hiddenFloor&&favoriteVisible(id));
      node.classList.toggle('focused',!hiddenFloor&&focused===id);
      node.classList.toggle('nav-destination',!hiddenFloor&&navigation?.targetId()===id);
      node.setAttribute('aria-pressed',String(!hiddenFloor&&favorites.has(id)));
      node.setAttribute('tabindex',hiddenFloor?'-1':'0');
    }
    renderLabels();renderVisitMarkers();
  }
  function renderFavorites() {
    $('favorite-count').textContent=String(favorites.size);
    renderFavoriteDayFilter();
    $('favorite-list').replaceChildren();
    const ids=visibleFavoriteIds(),pageSize=favoritesPerPage(),pages=Math.max(1,Math.ceil(ids.length/pageSize));
    favoritePage=clamp(favoritePage,0,pages-1);
    $('favorite-pages').hidden=pages===1;
    $('storage-status').hidden=pages>1;
    $('favorite-page').textContent=`${favoritePage+1} / ${pages}`;
    $('favorites-prev').disabled=favoritePage===0;
    $('favorites-next').disabled=favoritePage>=pages-1;
    if (!ids.length) {
      const p=document.createElement('p');p.className='empty';
      p.textContent=favoriteDayFilter==='all'?'관심 있는 부스를 지도에서 꾹 눌러보세요.':`${DAY_LABELS[favoriteDayFilter]}에 지정한 관심 부스가 없습니다.`;
      $('favorite-list').append(p);return;
    }
    for(const id of ids.slice(favoritePage*pageSize,(favoritePage+1)*pageSize)){
      const b=byId.get(id);if(!b)continue;
      const button=document.createElement('button');button.className='favorite-chip';button.setAttribute('aria-label',`${nameOf(b)}, ${b.code}, 위치 보기`);
      const star=document.createElement('span');star.className='chip-star';star.textContent='★';star.setAttribute('aria-hidden','true');
      const text=document.createElement('span'),title=document.createElement('strong'),meta=document.createElement('small');
      const assigned=daysFor(id);title.textContent=nameOf(b);
      meta.textContent=`${locationOf(b)} · ${b.code}${assigned.length?' · '+assigned.map(day=>DAY_LABELS[day].replace(' ','')).join('·'):' · 날짜 미지정'}`;
      text.append(title,meta);button.append(star,text);button.addEventListener('click',()=>focusBooth(id));
      $('favorite-list').append(button);
    }
  }
  function renderLabels() {
    if(!activeMap)return;
    const layer=$('labels');layer.replaceChildren();const fragment=document.createDocumentFragment();
    if(activeMap.id==='campus'&&floorMode==='2f')return;
    const tier=detailTier();if(activeMap.id==='campus'&&tier==='overview')return;
    const labels=[];
    for(const id of visibleFavoriteIds()){
      const b=geometryOf(byId.get(id));if(!b)continue;
      const r=b.bounds,x=tx+(r[0]+r[2])/2*scale,y=ty+r[1]*scale;
      if(x<0||x>viewport.clientWidth||y<-15||y>viewport.clientHeight+30)continue;
      const label=document.createElement('span');label.className='map-label';
      const inset=activeMap.id==='campus'&&['indie9','business9','selected80'].includes(b.sourceMap);
      const isCompact=inset||(activeMap.id==='campus'&&tier==='medium')||(scale<.9&&favorites.size>7);
      label.textContent=inset?'★ '+String(b.code).replace(/^09-/,''):isCompact?'★':'★ '+nameOf(b);
      if(isCompact)label.classList.add('compact');if(inset)label.classList.add('inset');
      label.dataset.booth=id;label.classList.add('interactive');
      let labelY=y-4;
      for(let tries=0;tries<5&&labels.some(p=>Math.abs(p.x-x)<130&&Math.abs(p.y-labelY)<26);tries++)labelY-=27;
      labelY=Math.max(27,labelY);labels.push({x,y:labelY});
      label.style.left=`${clamp(x,22,viewport.clientWidth-22)}px`;label.style.top=`${labelY}px`;fragment.append(label);
    }
    layer.append(fragment);
  }
  function renderVisitMarkers(){
    const layer=$('visit-markers');layer.replaceChildren();const fragment=document.createDocumentFragment();if(!activeMap||visitFilter==='off')return;
    if(activeMap.id==='campus'&&(floorMode==='2f'||detailTier()!=='full'))return;
    const occupied=[];
    for(const source of visitBooths){const b=geometryOf(source);if(!b||!matchesVisit(b))continue;
      const info=visitOf(b),marks=[];
      if(info.demo==='yes')marks.push('demo');
      if(needsTicket(info))marks.push('ticket');
      if(info.sales==='yes')marks.push('sale');
      if(!marks.length)continue;
      const r=b.bounds,x=tx+r[2]*scale-2,y=ty+r[1]*scale+2,width=marks.length*19+5;
      if(x<width||y<0||x>viewport.clientWidth||y>viewport.clientHeight-22)continue;
      if(occupied.some(p=>x-width<p.x&&x>p.left&&Math.abs(p.y-y)<23))continue;
      occupied.push({x,left:x-width,y});const marker=document.createElement('span');marker.className='visit-marker';
      marker.dataset.booth=b.id;
      marker.style.left=`${x}px`;marker.style.top=`${y}px`;
      for(const kind of marks){const badge=document.createElement('span');badge.className=`visit-badge visit-${kind}`;badge.append(visitIcon(kind));marker.append(badge);}
      fragment.append(marker);
    }
    layer.append(fragment);
  }
  function constrain() {
    const w=viewport.clientWidth,h=viewport.clientHeight,mw=activeMap.width*scale,mh=activeMap.height*scale;
    tx=mw<w?(w-mw)/2:clamp(tx,w-mw-45,45);
    ty=mh<h?(h-mh)/2:clamp(ty,h-mh-45,45);
  }
  function renderTransform() {
    if(frame)return;
    frame=requestAnimationFrame(()=>{
      frame=0;
      const w=viewport.clientWidth,h=viewport.clientHeight,viewBox=`0 0 ${w} ${h}`;
      if(viewBox!==lastSvgViewport){svg.setAttribute('viewBox',viewBox);lastSvgViewport=viewBox;}
      scene?.setAttribute('transform',`translate(${tx} ${ty}) scale(${scale})`);
      renderLabels();renderFacilities();renderVisitMarkers();navigation?.update();
    });
  }
  function fitBounds(bounds,padding=24) {
    const w=viewport.clientWidth,h=viewport.clientHeight;
    scale=clamp(Math.min((w-padding*2)/(bounds[2]-bounds[0]),(h-padding*2)/(bounds[3]-bounds[1])),minScale,maxScale);
    tx=w/2-(bounds[0]+bounds[2])/2*scale;ty=h/2-(bounds[1]+bounds[3])/2*scale;
    constrain();renderTransform();
  }
  function zoom(factor,point={x:viewport.clientWidth/2,y:viewport.clientHeight/2}) {
    activeView=null;navigation?.interact();
    const next=clamp(scale*factor,minScale,maxScale),ratio=next/scale;
    tx=point.x-(point.x-tx)*ratio;ty=point.y-(point.y-ty)*ratio;scale=next;
    constrain();renderTransform();
  }
  function setMap(mapId) {
    activeMap=data.maps.find(m=>m.id===mapId);if(!activeMap)throw new Error('지도를 찾을 수 없습니다.');
    $('campus-credit').hidden=mapId!=='campus';
    minScale=Math.min(viewport.clientWidth/activeMap.width,viewport.clientHeight/activeMap.height)*.8;
    maxScale=activeMap.maxScale||32;
    svg.setAttribute('viewBox',`0 0 ${viewport.clientWidth} ${viewport.clientHeight}`);svg.setAttribute('width','100%');svg.setAttribute('height','100%');
    svg.replaceChildren();boothNodes=new Map();
    scene=svgEl('g',{'data-scene':'map'});svg.append(scene);
    scene.append(svgEl('rect',{x:0,y:0,width:activeMap.width,height:activeMap.height,fill:'white','pointer-events':'none'}));
    const base=document.importNode(vectorMaps.get(mapId),true);
    base.setAttribute('x','0');base.setAttribute('y','0');
    base.setAttribute('width',activeMap.width);base.setAttribute('height',activeMap.height);
    base.setAttribute('class','official-map');base.setAttribute('pointer-events','none');
    base.setAttribute('aria-hidden','true');base.setAttribute('focusable','false');
    base.setAttribute('overflow','hidden');scene.append(base);
    const boothPriority=b=>({halls911:0,main:0,school:2,indie9:4,business9:4,selected80:5}[b.sourceMap||b.map]??1);
    const interactiveBooths=data.booths.map(b=>geometryOf(b,mapId)).filter(Boolean).sort((a,b)=>boothPriority(a)-boothPriority(b));
    for(const b of interactiveBooths){
      const path=svgEl('path',{d:b.path,class:'booth','data-booth':b.id,tabindex:0,role:'button','pointer-events':'all','aria-label':b.name+', '+b.code+'. 길게 누르거나 Enter 키로 관심 표시. 두 번 누르거나 Shift Enter 키로 경로 안내.', 'aria-pressed':favorites.has(b.id)});
      path.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.shiftKey){e.preventDefault();navigation?.toggleBooth(b.id);}else if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle(b.id);}if(e.key==='Escape')closeDetail();});
      path.addEventListener('focus',()=>{if(!pointers.size){focused=b.id;updateSelection();}});
      boothNodes.set(b.id,path);scene.append(path);
    }
    for(const target of activeMap.links||[]){
      const rect=svgEl('rect',{x:target.bounds[0],y:target.bounds[1],width:target.bounds[2]-target.bounds[0],height:target.bounds[3]-target.bounds[1],fill:'transparent','data-view':target.view,tabindex:0,role:'button','aria-label':target.label});
      rect.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectView(target.view);}});scene.append(rect);
    }
    if(activeMap.id==='campus'){
      if(floorMode==='all')floorMode='1f';
      $('map-floor').textContent=floorMode==='2f'?'2F · 센트럴몰':'1F · 메인 전시관';
    }else{
      floorMode='all';
      $('map-floor').textContent=activeMap.floor;
    }
    syncFloorSwitchUI();syncOfficialFloorLayers();updateSelection();navigation?.mapChanged();
  }
  function selectView(id) {
    const view=data.views.find(v=>v.id===id);if(!view)return;
    closeResults(false);
    cancelHold();closeDetail();activeView=id;
    const campusBounds=campusViewBounds.get(id);
    if(campusBounds){
      if(!activeMap||activeMap.id!=='campus')setMap('campus');
      if(id==='concourse')setFloorMode('2f',{silent:true});
      else if(id!=='campus')setFloorMode('1f',{silent:true});
      fitBounds(campusBounds,id==='campus'?18:34);
    }else{
      if(!activeMap||activeMap.id!==view.map)setMap(view.map);
      fitBounds(view.bounds);
    }
    for(const el of $('hall-nav').children)el.setAttribute('aria-pressed',String(el.dataset.view===id));
    if($('app').dataset.mode!=='pc')Array.from($('hall-nav').children).find(el=>el.dataset.view===id)?.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'smooth'});
  }
  function focusBooth(id) {
    const original=byId.get(id),b=geometryOf(original)||original;if(!b)return;
    closeResults(false);
    if(activeMap.id!==b.map)setMap(b.map);
    if(activeMap.id==='campus')setFloorMode('1f',{silent:true});
    activeView=null;for(const el of $('hall-nav').children)el.setAttribute('aria-pressed','false');
    const r=b.bounds,cx=(r[0]+r[2])/2,cy=(r[1]+r[3])/2;
    const bw=Math.max(70,r[2]-r[0]+34),bh=Math.max(60,r[3]-r[1]+40);
    fitBounds([cx-bw/2,cy-bh/2,cx+bw/2,cy+bh/2],55);selectBooth(id);
  }
  function ensureBoothPeek(){
    let card=$('booth-peek');if(card)return card;
    card=document.createElement('section');card.id='booth-peek';card.className='booth-peek';card.hidden=true;card.setAttribute('aria-live','polite');viewport.append(card);return card;
  }
  function hideBoothPeek(){const card=$('booth-peek');if(card)card.hidden=true;}
  function renderBoothPeek(id){
    const b=byId.get(id);if(!b)return;const card=ensureBoothPeek();card.replaceChildren();
    const info=document.createElement('div');info.className='booth-peek-info';
    const title=document.createElement('strong');title.textContent=nameOf(b);
    const meta=document.createElement('small'),assigned=daysFor(id);meta.textContent=`${locationOf(b)} · ${b.code}${assigned.length?' · '+assigned.map(day=>DAY_LABELS[day].replace(' ','')).join('·'):''}`;info.append(title,meta);
    const route=document.createElement('button');route.type='button';route.className='booth-peek-route';route.textContent='경로';route.setAttribute('aria-label',nameOf(b)+'까지 경로 안내');route.addEventListener('click',()=>navigation?.toggleBooth(id));
    const open=document.createElement('button');open.type='button';open.className='booth-peek-open';open.textContent='보기';open.setAttribute('aria-label',nameOf(b)+' 상세정보 보기');open.addEventListener('click',()=>showDetail(id));
    card.append(info,route,open);card.hidden=false;
  }
  function selectBooth(id){
    const b=byId.get(id);if(!b)return;focused=id;$('detail').hidden=true;renderBoothPeek(id);updateSelection();
  }
  function showDetail(id) {
    const b=byId.get(id);if(!b)return;focused=id;hideBoothPeek();const panel=$('detail');panel.replaceChildren();
    const head=document.createElement('div');head.className='detail-head';
    const info=document.createElement('div'),code=document.createElement('div'),title=document.createElement('h2');
    code.className='booth-code';code.textContent=`${locationOf(b)} / ${b.code}`;title.textContent=b.name;info.append(code,title);
    const close=document.createElement('button');close.className='icon-button detail-close';close.textContent='✕';close.setAttribute('aria-label','부스 정보 닫기');close.addEventListener('click',()=>selectBooth(id));head.append(info,close);panel.append(head);
    if(b.note){const p=document.createElement('p');p.textContent=b.note;panel.append(p);}
    const visit=visitOf(b),status=document.createElement('div');status.className='visit-status';
    const states=[['demo',visit.demo==='yes'?'시연 있음':visit.demo==='no'?'시연 없음':'시연 미확인'],['ticket',needsTicket(visit)?(visit.ticket==='partial'?'일부 정리권':visit.ticket==='reservation'?'예약·정리권':'정리권 필요'):visit.ticket==='none'?'정리권 불필요':'정리권 미확인'],['sale',visit.sales==='yes'?'판매 있음':visit.sales==='no'?'판매 없음':'판매 미확인']];
    for(const [kind,label] of states){const badge=document.createElement('span');badge.className=`visit-badge visit-${label.includes('미확인')?'unknown':kind}`;const text=document.createElement('span');text.textContent=label;badge.append(visitIcon(kind),text);status.append(badge);}panel.append(status);
    function section(title,content){const wrap=document.createElement('section');wrap.className='visit-section';const h=document.createElement('h3');h.textContent=title;wrap.append(h);if(Array.isArray(content)){const list=document.createElement('ul');for(const value of content){const li=document.createElement('li');li.textContent=value;list.append(li);}wrap.append(list);}else{const p=document.createElement('p');p.textContent=content;wrap.append(p);}panel.append(wrap);return wrap;}
    section('전시·시연 내용',visit.activities?.length?visit.activities:'게임·프로그램 세부 내용은 아직 확인되지 않았습니다. 아래 공식 출전사 이름과 도면을 참고해 주세요.');
    if(!visit.activities?.length&&b.exhibitors?.length)section('공식 출전사',b.exhibitors);
    section('정리권·참가 방법',visit.ticketNote||'정리권 필요 여부와 배부 시간은 미확인입니다. 현장 또는 출전사의 최신 공지를 확인해 주세요.');
    const goodsSection=section('굿즈·배포 특전',visit.goods||'품목·배포 조건 미확인');
    for(const item of contentItems.filter(item=>item.booth===b.id&&item.image)){
      const src=String(item.image);if(!/^(https?:\/\/|\.\.?\/|images\/)/i.test(src))continue;
      const figure=document.createElement('figure'),img=document.createElement('img');img.src=src;img.alt=[item.game,item.goods].filter(Boolean).join(' · ');img.loading='lazy';img.style.maxWidth='100%';img.style.height='auto';
      const caption=document.createElement('figcaption');caption.textContent=[item.game,item.goods,item.condition].filter(Boolean).join(' · ');
      img.addEventListener('error',()=>{img.hidden=true;caption.textContent+=' (이미지를 불러오지 못했습니다)';});figure.style.margin='8px 0';figure.append(img,caption);goodsSection.append(figure);
    }
    const sales=section('판매 정보',visit.salesNote||(b.area==='merchandise'?'공식 지도에 상품판매 구역으로 표시된 부스입니다. 품목·가격·구매 제한은 미확인입니다.':'이 부스에서의 판매 여부·품목·가격은 미확인입니다.'));
    for(const related of visit.relatedBooths||[]){const other=byId.get(related);if(!other)continue;const button=document.createElement('button');button.className='related-booth';button.textContent=`${locationOf(other)} ${other.code} · 관련 부스 보기`;button.addEventListener('click',()=>focusBooth(other.id));sales.append(button);}
    const source=document.createElement('p');source.className='visit-source';source.textContent=visit.checkedAt?`공식 정보 확인: ${visit.checkedAt} · 당일 잔여 정리권·재고를 표시하는 정보는 아닙니다.`:'표시 없음은 시연·판매 없음이라는 뜻이 아닙니다.';panel.append(source);
    const links=document.createElement('div');links.className='visit-links';
    for(const item of visit.sources||[{label:'공식 배치도',url:data.source}]){if(!/^https:\/\//.test(item.url))continue;const a=document.createElement('a');a.href=item.url;a.target='_blank';a.rel='noopener';a.textContent=`${item.label} ↗`;links.append(a);}panel.append(links);
    const routeAction=document.createElement('button');routeAction.className='route-button';routeAction.textContent=navigation?'이 부스까지 경로 안내':'위치 안내 준비 중';routeAction.disabled=!navigation;routeAction.addEventListener('click',()=>navigation?.toggleBooth(id));panel.append(routeAction);
    const action=document.createElement('button');action.className=`interest-button ${favorites.has(id)?'is-selected':''}`;action.textContent=favorites.has(id)?'★ 관심 부스 해제':'☆ 관심 부스로 등록';action.setAttribute('aria-pressed',String(favorites.has(id)));action.addEventListener('click',()=>toggle(id));panel.append(action);
    const picker=document.createElement('div');picker.className='booth-day-picker';
    const pickerLabel=document.createElement('strong');pickerLabel.textContent='방문일';picker.append(pickerLabel);
    for(const day of EVENT_DAYS){const dayButton=document.createElement('button');dayButton.type='button';dayButton.textContent=DAY_LABELS[day];dayButton.dataset.day=day;dayButton.setAttribute('aria-pressed',String(dayPlans[day].has(id)));dayButton.addEventListener('click',()=>toggleBoothDay(id,day));picker.append(dayButton);}
    const pickerHint=document.createElement('small');pickerHint.textContent='여러 날짜 선택 가능 · 날짜를 누르면 관심 부스로도 등록됩니다.';picker.append(pickerHint);panel.append(picker);
    panel.hidden=false;updateSelection();
  }
  function closeDetail(){focused=null;$('detail').hidden=true;hideBoothPeek();updateSelection();}
  function cancelHold(){clearTimeout(holdTimer);holdTimer=null;$('press-indicator').classList.remove('active');}
  function beginHold(id,p){
    if(!id||navigation?.isChoosing())return;
    const indicator=$('press-indicator');indicator.style.left=`${p.x}px`;indicator.style.top=`${p.y}px`;indicator.classList.add('active');
    holdTimer=setTimeout(()=>{if(!gesture||gesture.moved||pointers.size!==1)return;gesture.held=true;closeDetail();toggle(id);if(navigator.vibrate)navigator.vibrate(12);cancelHold();},500);
  }
  viewport.addEventListener('contextmenu',e=>e.preventDefault());
  viewport.addEventListener('pointerdown',e=>{
    if(e.target.closest('button,a,input,select,summary,.detail,.booth-peek,.zoom-controls,.search-results,.nav-card'))return;
    if(e.pointerType==='mouse'&&e.button!==0)return;
    e.preventDefault();clearTimeout(singleTapTimer);const p=coords(e);pointers.set(e.pointerId,p);
    try{viewport.setPointerCapture(e.pointerId);}catch{} // Window listeners retain the drag if WebKit declines capture.
    if(pointers.size===1){
      const id=e.target.closest('[data-booth]')?.dataset.booth;
      gesture={start:p,tx,ty,id,view:e.target.closest('[data-view]')?.dataset.view,moved:false,held:false};
      beginHold(id,p);
    }else{
      activeView=null;navigation?.interact();cancelHold();const [a,b]=[...pointers.values()];gesture={pinch:true,startDistance:dist(a,b),startScale:scale,center:midpoint(a,b),tx,ty,moved:true};
    }
  });
  function movePointer(e){
    if(!pointers.has(e.pointerId)||!gesture)return;e.preventDefault();pointers.set(e.pointerId,coords(e));
    if(pointers.size>=2){
      const [a,b]=[...pointers.values()],mid=midpoint(a,b);if(!gesture.pinch)return;
      scale=clamp(gesture.startScale*dist(a,b)/Math.max(1,gesture.startDistance),minScale,maxScale);
      const ratio=scale/gesture.startScale;tx=mid.x-(gesture.center.x-gesture.tx)*ratio;ty=mid.y-(gesture.center.y-gesture.ty)*ratio;
      constrain();renderTransform();return;
    }
    const p=coords(e);
    if(gesture.pinch)return;
    if(dist(p,gesture.start)>8){gesture.moved=true;activeView=null;navigation?.interact();cancelHold();}
    if(gesture.moved){tx=gesture.tx+p.x-gesture.start.x;ty=gesture.ty+p.y-gesture.start.y;constrain();renderTransform();}
  }
  viewport.addEventListener('pointermove',movePointer,{passive:false});
  window.addEventListener('pointermove',e=>{if(!viewport.contains?.(e.target))movePointer(e);},{passive:false});
  function finishPointer(e,cancelled=false){
    if(!pointers.has(e.pointerId))return;
    const g=gesture,p=coords(e);cancelHold();pointers.delete(e.pointerId);
    try{if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);}catch{}
    if(pointers.size===1){const rem=[...pointers.values()][0];gesture={start:rem,tx,ty,moved:true,held:true};return;}
    if(pointers.size){return;}
    gesture=null;
    if(cancelled||!g||g.moved||g.held||g.pinch){clearTimeout(singleTapTimer);lastTap=null;return;}
    if(navigation?.choose({x:(p.x-tx)/scale,y:(p.y-ty)/scale})){lastTap=null;clearTimeout(singleTapTimer);return;}
    const now=Date.now();
    if(lastTap&&now-lastTap.time<320&&dist(lastTap.p,p)<30&&lastTap.id===g.id&&lastTap.map===activeMap.id){
      clearTimeout(singleTapTimer);lastTap=null;
      if(g.id){closeDetail();navigation?.toggleBooth(g.id);}
      else if(!navigation?.isActive()){closeDetail();zoom(1.8,p);}
      return;
    }
    clearTimeout(singleTapTimer);lastTap={time:now,p,id:g.id,map:activeMap.id};
    if(navigation?.isActive())return;
    if(g.view){selectView(g.view);return;}
    if(g.id)singleTapTimer=setTimeout(()=>{if(!navigation?.isActive())selectBooth(g.id);},330);else closeDetail();
  }
  viewport.addEventListener('pointerup',e=>finishPointer(e));
  viewport.addEventListener('pointercancel',e=>finishPointer(e,true));
  window.addEventListener('pointerup',e=>finishPointer(e));
  window.addEventListener('pointercancel',e=>finishPointer(e,true));
  viewport.addEventListener('lostpointercapture',e=>{if(pointers.has(e.pointerId))finishPointer(e,true);});
  viewport.addEventListener('wheel',e=>{if(e.target.closest('.detail,.search-results,.nav-card'))return;e.preventDefault();cancelHold();zoom(Math.exp(-e.deltaY*.002),coords(e));},{passive:false});
  window.addEventListener('blur',()=>{cancelHold();pointers.clear();gesture=null;});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelHold();pointers.clear();gesture=null;}});
  $('zoom-in').addEventListener('click',()=>zoom(1.5));$('zoom-out').addEventListener('click',()=>zoom(1/1.5));$('fit').addEventListener('click',()=>selectView(data.views.find(v=>v.map===activeMap?.id)?.id||'all'));
  $('floor-switch')?.addEventListener('click',e=>{const button=e.target.closest('button[data-floor]');if(!button||activeMap?.id!=='campus')return;setFloorMode(button.dataset.floor);});
  $('map-controls-toggle').addEventListener('click',()=>{
    if(navigation?.isActive()){navigation.toggleControls();return;}
    controlsHidden=!controlsHidden;activeView=null;
    $('app').classList.toggle('controls-hidden',controlsHidden);
    $('map-controls-toggle').setAttribute('aria-label',controlsHidden?'하단 메뉴 펼치기':'하단 메뉴 숨기기');
    $('map-controls-toggle').setAttribute('aria-expanded',String(!controlsHidden));
  });
  $('visit-filter').addEventListener('change',()=>{visitFilter=$('visit-filter').value;updateSelection();});
  for(const kind of ['demo','ticket','sale','unknown'])$('legend-'+kind).append(visitIcon(kind));
  $('favorites-prev').addEventListener('click',()=>{favoritePage--;renderFavorites();});
  $('favorites-next').addEventListener('click',()=>{favoritePage++;renderFavorites();});
  $('display-mode').value=modePreference;
  $('display-mode').addEventListener('change',()=>{modePreference=$('display-mode').value;try{localStorage.setItem('tgs2026-screen-mode',modePreference);}catch{}syncScreen();});
  $('booth-search').addEventListener('input',search);
  $('booth-search').addEventListener('focus',()=>{if($('booth-search').value.trim())search();});
  $('booth-search').addEventListener('keydown',e=>{if(e.key==='Escape'){closeResults();$('booth-search').blur();}if(e.key==='Enter'){e.preventDefault();search();$('booth-search').blur();if(resultItems.length===1){const item=resultItems[0];if(item.category)focusFacility(item.id);else focusBooth(item.id);}}});
  $('close-results').addEventListener('click',()=>{closeResults();$('booth-search').blur();});
  $('results-prev').addEventListener('click',()=>{resultPage--;renderResults();});
  $('results-next').addEventListener('click',()=>{resultPage++;renderResults();});
  $('info-button').addEventListener('click',()=>$('info-dialog').showModal());$('close-info').addEventListener('click',()=>$('info-dialog').close());
  $('info-dialog').addEventListener('click',e=>{if(e.target===$('info-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
  let oldSize;
  new ResizeObserver(()=>{
    if(!activeMap)return;const w=viewport.clientWidth,h=viewport.clientHeight;
    renderFavorites();
    renderResults();
    minScale=Math.min(w/activeMap.width,h/activeMap.height)*.8;
    if(navigation?.isActive()){navigation.resize();}
    else if(activeView){const campusBounds=campusViewBounds.get(activeView),view=data.views.find(v=>v.id===activeView);if(campusBounds)fitBounds(campusBounds,activeView==='campus'?18:34);else if(view)fitBounds(view.bounds);}
    else if(oldSize){tx+=(w-oldSize.w)/2;ty+=(h-oldSize.h)/2;constrain();renderTransform();}
    oldSize={w,h};
  }).observe(viewport);

  function registerTools(){
    if(!document.modelContext?.registerTool)return;
    const lifecycle=new AbortController();
    const list={name:'list_tgs_booths',description:'List official TGS 2026 Hall 1–11 and selected-indie booths, their codes and current interest state.',inputSchema:{type:'object',properties:{selectedOnly:{type:'boolean'}},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute(input){if(!input||typeof input!=='object'||Object.keys(input).some(k=>k!=='selectedOnly')||(input.selectedOnly!==undefined&&typeof input.selectedOnly!=='boolean'))throw new Error('Invalid input');return data.booths.filter(b=>!input.selectedOnly||favorites.has(b.id)).map(b=>({id:b.id,name:b.name,hall:b.hall,selected:favorites.has(b.id)}));}};
    const set={name:'set_tgs_interest_booths',description:'Add or remove interest marks on specified TGS 2026 booths and save the same local preferences as the visible map.',inputSchema:{type:'object',properties:{boothIds:{type:'array',items:{type:'string'},minItems:1},selected:{type:'boolean'}},required:['boothIds','selected'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute(input){if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['boothIds','selected'].includes(k))||!Array.isArray(input.boothIds)||!input.boothIds.length||input.boothIds.some(id=>typeof id!=='string'||!byId.has(id))||typeof input.selected!=='boolean')throw new Error('Invalid booth IDs or selected state');return [...new Set(input.boothIds)].map(id=>toggle(id,input.selected));}};
    for(const tool of [list,set])try{Promise.resolve(document.modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}
    window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});
  }

  async function init(){
    try{
      const response=await fetch('./map-data.json?v=8');if(!response.ok)throw new Error('data');data=await response.json();
      const contentResponse=await fetch('./data.json');if(!contentResponse.ok)throw Error('content');
      contentItems=await contentResponse.json();if(!Array.isArray(contentItems))throw Error('content');
      data.details=data.details||{};data.details.booths={};
      for(const item of contentItems){
        const b=data.booths.find(b=>b.id===item.booth||b.code===item.booth||b.name===item.booth||b.shortName===item.booth);if(!b)continue;
        item.booth=b.id;
        const old=data.details.booths[b.id]||{},games=String(item.game||'').split('\n').filter(Boolean),goods=[item.goods,item.condition].filter(Boolean).join(' · ');
        const {booth,game,image,condition,goods:ignored,...extra}=item;
        data.details.booths[b.id]={...old,...extra,activities:[...new Set([...(old.activities||[]),...games])],goods:[old.goods,goods].filter(Boolean).join('\n')};
      }
      visitBooths=data.booths.filter(b=>data.details.booths[b.id]);

      const campusResponse=await fetch('./navigation/campus.json?v=2');if(!campusResponse.ok)throw Error('campus');const campus=await campusResponse.json();
      data.maps.push(campus);data.views.unshift({id:'campus',label:'멧세 전체',map:'campus',bounds:[45,25,620,600]});
      for(const b of data.booths){b.campus=campus.placements[b.id];if(b.campus)b.campusGeometry={...b,...b.campus,map:'campus',sourceMap:b.campus.sourceMap||b.map};}
      for(const f of data.facilities){f.campus=campus.facilityPlacements[f.id];if(f.campus)f.campusGeometry={...f,...f.campus,map:'campus',sourceMap:f.map};}
      const unionBounds=(rects,pad=8)=>{if(!rects.length)return null;return [Math.min(...rects.map(r=>r[0]))-pad,Math.min(...rects.map(r=>r[1]))-pad,Math.max(...rects.map(r=>r[2]))+pad,Math.max(...rects.map(r=>r[3]))+pad];};
      const boothCampusBounds=(predicate,pad=8)=>unionBounds(data.booths.filter(b=>b.campus?.bounds&&predicate(b)).map(b=>b.campus.bounds),pad);
      campusViewBounds=new Map([
        ['campus',[20,15,660,620]],
        ['all',boothCampusBounds(b=>b.hall>=1&&b.hall<=8,10)],
        ['h78',boothCampusBounds(b=>b.hall>=7&&b.hall<=8,9)],
        ['h46',boothCampusBounds(b=>b.hall>=4&&b.hall<=6,9)],
        ['h13',boothCampusBounds(b=>b.hall>=1&&b.hall<=3,9)],
        ['school',boothCampusBounds(b=>b.map==='school',7)],
        ['halls911',boothCampusBounds(b=>b.hall>=9,10)],
        ['indie9',boothCampusBounds(b=>b.map==='indie9',7)],
        ['selected80',boothCampusBounds(b=>b.map==='selected80',7)],
        ['business9',boothCampusBounds(b=>b.map==='business9',7)]
      ]);
      const concourseBounds=[45,168,635,275];campusViewBounds.set('concourse',concourseBounds);
      const h911Bounds=campusViewBounds.get('halls911');if(h911Bounds)h911Bounds[1]=Math.min(h911Bounds[1],342);
      for(const [key,value] of [...campusViewBounds])if(!value)campusViewBounds.delete(key);
      floorRegions={first:[boothCampusBounds(b=>['main','school'].includes(b.map),16),boothCampusBounds(b=>['halls911','indie9','selected80','business9'].includes(b.map),16)].filter(Boolean),second:[concourseBounds]};
      byId=new Map(data.booths.map(b=>[b.id,b]));
      for(const b of data.booths)b.searchText=normal(`${b.name} ${b.shortName||''} ${b.officialName} ${b.code} ${boothAliases[b.id]||''} ${(b.exhibitors||[]).join(' ')} ${(visitOf(b).activities||[]).join(' ')} ${visitOf(b).goods||''} ${b.locationLabel||''}`);
      try{const raw=localStorage.getItem(STORAGE_KEY);if(raw!==null){const list=JSON.parse(raw);if(!Array.isArray(list))throw new Error('storage');favorites=new Set(list.filter(id=>byId.has(id)));}else{favorites=new Set(data.defaults.filter(id=>byId.has(id)));save();}}
      try{if(localStorage.getItem(INTEREST_MIGRATION_KEY)!=='1'){let changed=false;for(const id of ['06-C01','03-C06'])if(byId.has(id)&&!favorites.has(id)){favorites.add(id);changed=true;}if(changed)save();localStorage.setItem(INTEREST_MIGRATION_KEY,'1');}}catch{}
      catch{favorites=new Set(data.defaults.filter(id=>byId.has(id)));storageOkay=false;$('storage-status').textContent='현재 창에서만 유지';}
      try{if(localStorage.getItem(PLAN_MIGRATION_KEY)!=='1'){for(const id of data.defaults)if(byId.has(id))favorites.add(id);save();localStorage.setItem(PLAN_MIGRATION_KEY,'1');}}catch{}
      loadDayPlans();
      for(const button of $('favorite-day-filter').querySelectorAll('button'))button.addEventListener('click',()=>setFavoriteDayFilter(button.dataset.day));
      for(const v of data.views){const b=document.createElement('button');b.textContent=v.label;b.dataset.view=v.id;b.setAttribute('aria-pressed','false');b.addEventListener('click',()=>selectView(v.id));$('hall-nav').append(b);}
      for(const [id,category] of Object.entries(categories)){const button=document.createElement('button');button.style.setProperty('--facility-color',category.color);button.append(facilityIcon(id));const label=document.createElement('span');label.textContent=category.label;button.append(label);button.setAttribute('aria-label',`${category.label} 위치 찾기`);button.addEventListener('click',()=>{const items=data.facilities.filter(f=>f.category===id);$('booth-search').blur();if(items.length===1)focusFacility(items[0].id);else openResults(items,category.label);});$('facility-nav').append(button);}
      const source=$('source-info'),p=document.createElement('p');p.textContent=`공식 영문 배치도 · 2026년 9월 공개본 · ${data.booths.length}개 부스 구역`;
      const p2=document.createElement('p');p2.textContent='홀 버튼은 멧세 전체 지도 안에서 해당 위치로 이동합니다. 우측의 1층·2층 버튼으로 층별 지도와 시설만 골라 볼 수 있으며, 축소 상태에서는 아이콘을 자동으로 줄여 표시합니다.';
      const a=document.createElement('a');a.href=data.source;a.target='_blank';a.rel='noopener';a.textContent='TGS 공식 지도 원본 보기 ↗';source.append(p,p2,a);
      const loadVectorMap=async m=>{
        if(vectorMaps.has(m.id))return;
        const response=await fetch(m.image);if(!response.ok)throw new Error('vector map');
        const parsed=new DOMParser().parseFromString(await response.text(),'image/svg+xml');
        if(parsed.querySelector('parsererror')||parsed.documentElement.localName!=='svg')throw new Error('invalid vector map');
        vectorMaps.set(m.id,parsed.documentElement);
      };
      await loadVectorMap(campus);
      renderFavorites();selectView('campus');$('load-status').hidden=true;registerTools();
      const defer=window.requestIdleCallback?cb=>window.requestIdleCallback(cb,{timeout:2200}):cb=>setTimeout(cb,450);
      defer(()=>{Promise.all(data.maps.filter(m=>m.id!=='campus').map(loadVectorMap)).catch(()=>{});});
      try{
      if(window.TGSMapNavigation&&window.TGSNavigation&&window.TGSNavigationSensors){
        const response=await fetch('./navigation/walkable.json');if(!response.ok)throw Error('navigation map');
        const walkable=await response.json(),campusGrid=await fetch('./navigation/campus-grid.json?v=2');if(!campusGrid.ok)throw Error('campus grid');walkable.maps.campus=await campusGrid.json();
        navigation=window.TGSMapNavigation.create({data,walkable,announce,mapId:()=>activeMap.id,showCampus:()=>selectView('campus'),
          toScreen:p=>({x:tx+p.x*scale,y:ty+p.y*scale}),
          describeBooth:b=>{const v=visitOf(b);return [v.activities?.join(' · ')||'전시 내용 미확인',v.ticketNote||'정리권 정보 미확인',v.goods||'굿즈 정보 미확인',v.salesNote||'판매 정보 미확인',v.checkedAt?'공식 정보 확인: '+v.checkedAt:''].filter(Boolean).join('\n');},
          boothSources:b=>visitOf(b).sources||[{label:'공식 배치도',url:data.source}],
          targetChanged:()=>{updateSelection();renderFacilities();},
          enter:mapId=>{clearTimeout(singleTapTimer);lastTap=null;closeResults();closeDetail();$('booth-search').blur();if(!beforeNavigation)beforeNavigation={map:activeMap.id,view:activeView,tx,ty,scale};activeView=null;if(activeMap.id!==mapId)setMap(mapId);$('app').classList.add('navigation-active');},
          exit:()=>{$('app').classList.remove('navigation-active','nav-controls-hidden');$('map-controls-toggle').setAttribute('aria-label',controlsHidden?'하단 메뉴 펼치기':'하단 메뉴 숨기기');$('map-controls-toggle').setAttribute('aria-expanded',String(!controlsHidden));const saved=beforeNavigation;beforeNavigation=null;requestAnimationFrame(()=>{if(saved&&activeMap.id===saved.map){activeView=saved.view;tx=saved.tx;ty=saved.ty;scale=saved.scale;constrain();renderTransform();}else selectView(data.views.find(v=>v.map===activeMap.id).id);});},
          center:(p,{zoomIn=false,cardHeight=0}={})=>{
            const w=viewport.clientWidth,h=viewport.clientHeight,side=$('app').dataset.mode!=='portrait';
            const freeW=side?Math.max(w*.5,w-390):w,freeH=side?h:Math.max(h*.4,h-cardHeight);
            if(zoomIn)scale=clamp(Math.min(freeW,freeH)/65,minScale,maxScale);
            tx=freeW/2-p.x*scale;ty=freeH*.55-p.y*scale;renderTransform();
          },
          frameRotation:()=>$('app').dataset.rotation==='clockwise'?90:$('app').dataset.rotation==='counterclockwise'?-90:0,
          fit:(points,bounds,cardHeight)=>{
            const xs=points.map(p=>p.x),ys=points.map(p=>p.y);xs.push(bounds[0],bounds[2]);ys.push(bounds[1],bounds[3]);
            const x0=Math.min(...xs)-3,x1=Math.max(...xs)+3,y0=Math.min(...ys)-3,y1=Math.max(...ys)+3;
            const w=viewport.clientWidth,h=viewport.clientHeight,side=$('app').dataset.mode!=='portrait';
            const freeW=side?Math.max(w*.5,w-390):w,freeH=side?h:Math.max(h*.4,h-cardHeight);
            scale=clamp(Math.min((freeW-70)/Math.max(10,x1-x0),(freeH-90)/Math.max(10,y1-y0)),minScale,maxScale);
            tx=freeW/2-(x0+x1)/2*scale;ty=freeH/2-(y0+y1)/2*scale;renderTransform();
          }
        });
        $('nav-more').addEventListener('toggle',()=>navigation.resize());
      }else throw Error('navigation unavailable');
      }catch(error){$('location-button').disabled=true;$('location-button').textContent='위치 안내를 불러오지 못함';}
    }catch(error){$('load-status').textContent='지도를 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.';}
  }
  init();
})();
