/* TGS adapter; core.js and sensors.js can also be used with another map renderer. */
(function(root){
'use strict';
function create(config){
  const N=root.TGSNavigation,$=id=>document.getElementById(id),data=config.data;
  const maps=new Map(data.maps.map(m=>[m.id,m])),campus=maps.get('campus');
  const booths=new Map(data.booths.map(b=>[b.id,campus?.placements[b.id]?{...b,...campus.placements[b.id],map:'campus'}:b]));
  const grids=new Map(),sentMaps=new Set(),pending=new Map();
  const STORAGE='tgs2026-navigation-calibration-v1';
  let calibrationByMap={},firstAnchor=null,origin=null,target=null,route=null,choosing=false,routeToken=0,worker=null,reading={},lastOriginKey='',fitNext=false,frame=0;
  let following=false,zoomNext=false,collapsed=false,lastCenter='',outsideVenue=false;
  // SVGElement.hidden is not a reflected property in Safari. Change the actual attribute.
  function edgeVisible(value){const el=$('nav-edge');if(value)el.removeAttribute('hidden');else el.setAttribute('hidden','');}
  function validCalibration(c){return c&&['x','y','a','b','unitsPerMeter','northAngle'].every(k=>Number.isFinite(c[k]))&&c.unitsPerMeter>0&&c.unitsPerMeter<100&&c.origin&&Number.isFinite(c.origin.latitude)&&Math.abs(c.origin.latitude)<=90&&Number.isFinite(c.origin.longitude)&&Math.abs(c.origin.longitude)<=180&&Math.abs(Math.hypot(c.a,c.b)-c.unitsPerMeter)<1e-6;}
  try{const saved=JSON.parse(localStorage.getItem(STORAGE));if(saved?.version===1)for(const [id,c] of Object.entries(saved.maps||{}))if(maps.has(id)&&validCalibration(c))calibrationByMap[id]=c;}catch{}
  function saveCalibration(){try{localStorage.setItem(STORAGE,JSON.stringify({version:1,maps:calibrationByMap}));}catch{config.announce('위치 보정은 현재 창에서만 유지됩니다.');}}
  const calibrationFor=id=>{const builtin=maps.get(id)?.geo,saved=calibrationByMap[id];if(saved&&builtin){const delta=N.project(saved.origin,builtin.origin);if(Math.hypot(delta.x,delta.y)>2000)return builtin;}return saved||builtin;};
  function gridConfig(mapId){const m=maps.get(mapId),s=config.walkable.maps[mapId];if(!s)throw Error('unsupported-map');return {...s,width:m.width,height:m.height,obstacles:[...(s.obstacles||[]),...data.booths.filter(b=>b.map===mapId).map(b=>b.bounds)]};}
  function grid(mapId){if(!grids.has(mapId))grids.set(mapId,N.makeGrid(gridConfig(mapId)));return grids.get(mapId);}
  function setupWorker(){
    if(!root.Worker)return;
    try{worker=new Worker('./navigation/route-worker.js');worker.onmessage=e=>{const p=pending.get(e.data.id);if(!p)return;pending.delete(e.data.id);e.data.error?p.reject(Error(e.data.error)):p.resolve(e.data.result);};worker.onerror=()=>{worker.terminate();worker=null;sentMaps.clear();for(const p of pending.values())p.reject(Error('worker'));pending.clear();};}catch{worker=null;}
  }
  setupWorker();
  function cancel(){routeToken++;for(const p of pending.values())p.resolve(null);pending.clear();}
  function requestRoute(from,b){
    const id=routeToken;
    if(!worker)return Promise.resolve().then(()=>id===routeToken?N.routeToBooth(grid(b.map),from,b.bounds):null);
    return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});const request={id,mapId:b.map,from,bounds:b.bounds};if(!sentMaps.has(b.map)){request.config=gridConfig(b.map);sentMaps.add(b.map);}worker.postMessage(request);});
  }
  function status(text){$('nav-status').textContent=text;}
  function buttons(){
    const mapId=config.mapId(),pendingAnchor=firstAnchor?.mapId===mapId;
    for(const id of ['nav-locate','location-button'])$(id).textContent=choosing?'위치 선택 취소':pendingAnchor?'GPS 보정 완료':'내 위치 맞추기';
    if(!target&&!reading.active)$('location-button').textContent='◎ 내 위치';
    $('nav-compass').hidden=!target||reading.heading!==null&&reading.heading!==undefined;
    $('nav-pick-hint').hidden=!choosing;
    $('nav-pick-hint').textContent=pendingAnchor?'다른 곳으로 이동한 뒤, 지금 서 있는 통로를 눌러 주세요.':'지금 서 있는 통로를 눌러 내 위치를 맞추세요.';
    $('nav-recenter').textContent=following?'◎ 따라가는 중':'◎ 내 위치 따라가기';
    $('nav-recenter').setAttribute('aria-pressed',String(following));
    $('nav-compass').textContent=reading.permission==='denied'?'방향 권한 다시 요청':'방향 켜기';
  }
  function controls(){
    $('app').classList.toggle('nav-controls-hidden',collapsed);
    $('map-controls-toggle').setAttribute('aria-label',collapsed?'안내 버튼 펼치기':'안내 버튼 숨기기');
    $('map-controls-toggle').setAttribute('aria-expanded',String(!collapsed));
  }
  function center(zoomIn=false){
    if(!origin||origin.mapId!==config.mapId()||choosing)return;
    const key=[origin.x,origin.y,config.mapId()].join(':');
    if(!zoomIn&&key===lastCenter)return;lastCenter=key;
    config.center(origin,{zoomIn,cardHeight:target?$('nav-card').getBoundingClientRect().height+24:0});
  }
  function follow(zoomIn=true){following=true;zoomNext=zoomIn;lastCenter='';if(origin){center(zoomIn);zoomNext=false;}buttons();}
  const sensors=root.TGSNavigationSensors.createSensors(value=>{
    reading=value;
    const mapId=target?.map||(campus?'campus':config.mapId()),c=calibrationFor(mapId);
    if(c&&value.fresh&&!choosing){
      const p=N.locate(value.fix,c),g=grid(mapId),cell=N.cellAt(g,p);
      // Never clamp a remote GPS fix onto a hall or snap it across a booth.
      outsideVenue=cell<0;
      if(cell>=0)origin={mapId,...p,manual:false};
      else if(origin&&!origin.manual)origin=null;
    }else if(origin&&!origin.manual&&!value.fresh)origin=null;
    if(target){
      if(!origin||origin.mapId!==target.map){cancel();route=null;lastOriginKey='';status(value.status==='denied'?'위치 권한이 꺼져 있어요. 내 위치를 직접 맞춰 주세요.':outsideVenue?'멧세 밖의 위치예요. 지도에서 내 위치를 맞출 수 있어요.':c?'현재 위치를 확인 중이에요. 통로에서 위치를 맞출 수 있어요.':'이 도면에서 내 위치를 먼저 맞춰 주세요.');}
      else recalculate();
    }
    if(following&&origin){center(zoomNext);zoomNext=false;}
    buttons();renderSoon();
  });
  function describeBooth(b){
    $('nav-code').textContent=`${b.locationLabel||b.hall+'홀'} · ${b.code}`;$('nav-name').textContent=b.shortName||b.name;
    // Reuse the app's sourced booth description; never turn unknown into "none".
    const text=config.describeBooth(b);$('nav-exhibits').textContent=text;
    $('nav-sources').replaceChildren();for(const item of config.boothSources(b)){if(!/^https:\/\//.test(item.url))continue;const a=document.createElement('a');a.href=item.url;a.target='_blank';a.rel='noopener';a.textContent=item.label+' ↗';$('nav-sources').append(a);}
    $('nav-more').open=false;
  }
  function toggleBooth(id){
    const b=booths.get(id);if(!b)return;
    if(target?.id===id){stop();return;}
    // Both permission requests originate in this double tap / button event.
    sensors.start();cancel();route=null;lastOriginKey='';target=b;choosing=false;fitNext=false;following=true;zoomNext=true;lastCenter='';collapsed=false;
    config.enter(b.map);following=true;describeBooth(b);$('nav-card').hidden=false;config.targetChanged(id);
    if(origin?.mapId!==b.map)origin=null;
    const c=calibrationFor(b.map);if(c&&reading.fresh){const p=N.locate(reading.fix,c),g=grid(b.map),i=N.cellAt(g,p);if(i>=0)origin={mapId:b.map,...p,manual:false};}
    status(origin?'통로를 따라 경로를 찾고 있어요.':'이 도면에서 내 위치를 먼저 맞춰 주세요.');
    controls();if(origin){center(true);zoomNext=false;}recalculate();buttons();renderSoon();$('nav-stop').focus?.({preventScroll:true});
  }
  function stop(){
    cancel();target=null;route=null;choosing=false;firstAnchor=null;lastOriginKey='';following=false;zoomNext=false;lastCenter='';collapsed=false;
    $('nav-card').hidden=true;edgeVisible(false);$('nav-pick-hint').hidden=true;
    sensors.stop();origin=null;config.targetChanged(null);config.exit();buttons();renderSoon();
  }
  function beginPick(){
    if(choosing){choosing=false;buttons();return;}
    if(campus&&config.mapId()!=='campus')config.showCampus();
    if(!config.walkable.maps[config.mapId()]){config.announce('부스가 있는 전시관 지도에서 내 위치를 맞춰 주세요.');return;}
    sensors.start();choosing=true;following=false;buttons();
  }
  function choose(p){
    if(!choosing)return false;
    const mapId=config.mapId(),g=grid(mapId),i=N.cellAt(g,p);
    if(i<0||!g.allowed[i]){config.announce('부스 바깥의 통로를 눌러 주세요.');return true;}
    const snapped=N.point(g,i);origin={mapId,...snapped,manual:true};choosing=false;lastOriginKey='';fitNext=false;
    const builtin=maps.get(mapId)?.geo,atVenue=!builtin||reading.fix&&Math.hypot(...Object.values(N.project(reading.fix,builtin.origin)))<2000;
    const fix=atVenue&&reading.fresh&&reading.fix?.accuracy<=20?reading.fix:null;
    if(fix){
      const anchor={mapId,...snapped,fix:{...fix}},existing=calibrationFor(mapId);
      if(firstAnchor?.mapId===mapId){
        try{calibrationByMap[mapId]=N.calibration(firstAnchor,anchor);firstAnchor=null;saveCalibration();origin.manual=false;config.announce('이 도면에 GPS 위치를 연결했어요.');}
        catch(e){config.announce(e.message==='calibration-short'?'조금 더 이동한 뒤 현재 위치를 한 번 더 맞춰 주세요.':'GPS가 안정되면 다시 맞춰 주세요.');}
      }else if(existing){calibrationByMap[mapId]={...existing,origin:{...fix},x:snapped.x,y:snapped.y};saveCalibration();origin.manual=false;config.announce('내 위치를 다시 맞췄어요.');}
      else{firstAnchor=anchor;config.announce('내 위치를 맞췄어요. 다른 통로로 이동한 뒤 GPS 보정을 완료하세요.');}
    }else config.announce('지정한 위치에서 안내합니다. GPS가 잡히면 위치를 다시 맞춰 주세요.');
    follow(true);recalculate();buttons();renderSoon();return true;
  }
  async function recalculate(){
    if(!target||!origin||origin.mapId!==target.map)return;
    const g=grid(target.map),key=target.id+':'+N.cellAt(g,origin);if(key===lastOriginKey)return;
    lastOriginKey=key;cancel();const token=routeToken,b=target,p={x:origin.x,y:origin.y};route=null;renderSoon();
    try{
      let result;
      try{result=await requestRoute(p,b);}catch(e){if(e.message!=='worker')throw e;result=await requestRoute(p,b);}
      if(token!==routeToken||!target||!result)return;route=result;
      route.usesBridge=target.map==='campus'&&route.line.some(p=>p.y>campus.bridgeBounds[1]&&p.y<campus.bridgeBounds[3]);
      status(route.usesBridge?'2F 연결교 이용 · 표시된 계단으로 이동하세요.':target.floor===2?'목적지는 2F · 에스플러네이드입니다.':origin.manual?'직접 맞춘 내 위치 · 통로 안내':'부스까지 통로를 따라 이동하세요.');
      if(fitNext){fitNext=false;fit();}renderSoon();
    }catch(e){if(token!==routeToken)return;route=null;status(e.message==='off-path'?'통로에서 내 위치를 다시 맞춰 주세요.':'연결된 통로를 찾지 못했어요. 내 위치를 다시 맞춰 주세요.');renderSoon();}
  }
  function fit(){if(!target)return;const pts=route?.line?.length?route.line:[{x:target.bounds[0],y:target.bounds[1]},{x:target.bounds[2],y:target.bounds[3]}];config.fit(pts,target.bounds,$('nav-card').getBoundingClientRect().height+24);}
  function renderSoon(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;render();});}
  function render(){
    const viewport=$('viewport'),w=viewport.clientWidth,h=viewport.clientHeight,overlay=$('nav-overlay');overlay.setAttribute('viewBox',`0 0 ${w} ${h}`);
    const points=route&&target?.map===config.mapId()?route.line.map(config.toScreen):[];
    const d=points.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
    $('nav-route-halo').setAttribute('d',d);$('nav-route-line').setAttribute('d',d);
    const p=origin?.mapId===config.mapId()?config.toScreen(origin):null,marker=$('nav-position');
    marker.style.display=p?'':'none';if(p)marker.setAttribute('transform',`translate(${p.x} ${p.y})`);
    const c=calibrationFor(config.mapId()),known=p&&c&&reading.heading!==null&&reading.heading!==undefined;
    $('nav-arrow').style.display=known?'':'none';$('nav-dot').style.display=known?'none':'';
    if(known)$('nav-arrow').setAttribute('transform',`rotate(${N.headingOnMap(reading.heading,c)-(config.frameRotation?.()||0)})`);
    $('nav-position-label').textContent=origin?.manual?'맞춘 내 위치':'내 위치';
    const end=points.at(-1);$('nav-end').style.display=end?'':'none';if(end){$('nav-end').setAttribute('cx',end.x);$('nav-end').setAttribute('cy',end.y);}
    const restricted=route?.usesBridge&&N.campusRestricted();
    $('nav-route-line').classList.toggle('restricted',!!restricted);
    if(restricted)status('일반공개일 홀 사이 이동은 10시부터 가능해요.');
    else if(route?.usesBridge)status('2F 연결교 이용 · 표시된 계단으로 이동하세요.');
    const showEdge=!!target&&!!route&&!!p&&!document.hidden&&!restricted;
    edgeVisible(showEdge);if(!showEdge)return;
    const map=maps.get(target.map),remaining=c?route.length/c.unitsPerMeter:route.length;
    const thresholds=c?undefined:{far:Math.min(map.width,map.height)*.65,near:Math.min(map.width,map.height)*.10,arrival:Math.min(map.width,map.height)*.025};
    const state=N.proximity(remaining,thresholds),aim=config.toScreen({x:(target.bounds[0]+target.bounds[2])/2,y:(target.bounds[1]+target.bounds[3])/2});
    drawEdge(state,aim.x-p.x,aim.y-p.y);$('nav-card').style.setProperty('--nav-signal',state.color);
  }
  function drawEdge(state,dx,dy){
    const el=$('nav-edge'),w=$('app').clientWidth,h=$('app').clientHeight,inset=12,r=26;
    el.setAttribute('viewBox',`0 0 ${w} ${h}`);
    const path=$('nav-edge-line'),d=`M ${inset+r} ${inset} H ${w-inset-r} Q ${w-inset} ${inset} ${w-inset} ${inset+r} V ${h-inset-r} Q ${w-inset} ${h-inset} ${w-inset-r} ${h-inset} H ${inset+r} Q ${inset} ${h-inset} ${inset} ${h-inset-r} V ${inset+r} Q ${inset} ${inset} ${inset+r} ${inset} Z`;
    path.setAttribute('d',d);if(typeof path.getTotalLength!=='function')return;
    const rx=w/2-inset,ry=h/2-inset,factor=Math.min(rx/Math.max(Math.abs(dx),1e-9),ry/Math.max(Math.abs(dy),1e-9));
    const x=w/2+dx*factor,y=h/2+dy*factor,len=path.getTotalLength();let best=0,distance=Infinity;
    for(let i=0;i<180;i++){const t=len*i/180,q=path.getPointAtLength(t),value=(q.x-x)**2+(q.y-y)**2;if(value<distance){best=t;distance=value;}}
    const span=len*state.fraction;
    for(const [id,width] of [['nav-edge-bloom',28+36*state.close],['nav-edge-soft',12+16*state.close],['nav-edge-line',5+5*state.close]]){
      const layer=$(id);layer.setAttribute('d',d);layer.style.stroke=state.color;layer.style.strokeWidth=width;layer.style.strokeDasharray=`${span} ${len-span}`;layer.style.strokeDashoffset=-(best-span/2);
    }
  }
  $('nav-reset').addEventListener('click',()=>{stop();calibrationByMap={};try{localStorage.removeItem(STORAGE);}catch{}config.announce('위치 추적을 멈추고 보정 정보를 지웠어요.');});
  $('nav-stop').addEventListener('click',stop);$('nav-locate').addEventListener('click',beginPick);$('location-button').addEventListener('click',()=>{if(reading.active){beginPick();return;}if(campus)config.showCampus();sensors.start();follow(true);config.announce('현재 위치를 확인합니다. 위치가 어긋나면 내 위치 맞추기를 눌러 주세요.');});
  $('nav-compass').addEventListener('click',()=>sensors.requestCompass());
  $('nav-recenter').addEventListener('click',()=>{sensors.start();follow(true);});
  $('nav-overview').addEventListener('click',()=>{following=false;buttons();fit();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&target){e.preventDefault();stop();}});
  return {toggleBooth,stop,choose,isChoosing:()=>choosing,isActive:()=>!!target,targetId:()=>target?.id||null,update:renderSoon,
    interact:()=>{following=false;fitNext=false;buttons();},
    toggleControls:()=>{collapsed=!collapsed;controls();lastCenter='';if(following)center();renderSoon();},
    resize:()=>{lastCenter='';if(following)center(zoomNext);renderSoon();},
    mapChanged:()=>{choosing=false;following=false;lastCenter='';if(firstAnchor?.mapId!==config.mapId())firstAnchor=null;buttons();renderSoon();}};
}
root.TGSMapNavigation={create};
})(typeof window==='undefined'?globalThis:window);
