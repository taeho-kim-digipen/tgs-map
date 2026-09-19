/* TGS adapter; core.js and sensors.js can also be used with another map renderer. */
(function(root){
'use strict';
function create(config){
  const N=root.TGSNavigation,$=id=>document.getElementById(id),data=config.data;
  const maps=new Map(data.maps.map(m=>[m.id,m])),campus=maps.get('campus');
  const booths=new Map(data.booths.map(b=>[b.id,campus?.placements[b.id]?{...b,...campus.placements[b.id],map:'campus',kind:'booth'}:{...b,kind:'booth'}]));
  const facilities=new Map(data.facilities.map(f=>{const p=campus?.facilityPlacements?.[f.id],x=p?.x??f.x,y=p?.y??f.y,map=p?'campus':f.map;return [f.id,{...f,...(p||{}),x,y,map,kind:'facility',bounds:[x-1.4,y-1.4,x+1.4,y+1.4]}];}));
  const grids=new Map(),sentMaps=new Set(),pending=new Map();
  const STORAGE='tgs2026-navigation-calibration-v1';
  let calibrationByMap={},firstAnchor=null,origin=null,target=null,route=null,choosing=false,routeToken=0,worker=null,reading={},lastOriginKey='',lastRouteOrigin=null,fitNext=false,frame=0;
  let following=false,zoomNext=false,collapsed=false,lastCenter='',outsideVenue=false,mapRotation=0;
  // SVGElement.hidden is not a reflected property in Safari. Change the actual attribute.
  function edgeVisible(value){const el=$('nav-edge');if(value)el.removeAttribute('hidden');else el.setAttribute('hidden','');}
  const angleDelta=(to,from)=>((to-from+540)%360)-180;
  function syncMapRotation(forceNorth=false){
    if(!config.setMapRotation)return;
    const c=origin&&calibrationFor(origin.mapId),heading=reading.heading;
    if(forceNorth||!following||!origin||!c||heading===null||heading===undefined){
      mapRotation=0;config.setMapRotation(0,null);return;
    }
    const desired=-(N.headingOnMap(heading,c)-(config.frameRotation?.()||0));
    const delta=angleDelta(desired,mapRotation);
    // Damp compass noise so the floor plan turns smoothly instead of twitching.
    mapRotation+=delta*(Math.abs(delta)>35?.42:.24);
    if(Math.abs(angleDelta(desired,mapRotation))<.35)mapRotation=desired;
    config.setMapRotation(mapRotation,origin);
  }
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
    const id=routeToken,startSnapRadius=b.map==='campus'?18:undefined;
    if(!worker)return Promise.resolve().then(()=>id===routeToken?N.routeToBooth(grid(b.map),from,b.bounds,startSnapRadius):null);
    return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});const request={id,mapId:b.map,from,bounds:b.bounds,startSnapRadius};if(!sentMaps.has(b.map)){request.config=gridConfig(b.map);sentMaps.add(b.map);}worker.postMessage(request);});
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
    $('nav-compass').textContent=reading.permission==='denied'?'방향 권한 다시 요청':'내가 보는 방향으로';
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
  function follow(zoomIn=true){following=true;zoomNext=zoomIn;lastCenter='';if(origin){center(zoomIn);zoomNext=false;}syncMapRotation();buttons();}
  const sensors=root.TGSNavigationSensors.createSensors(value=>{
    reading=value;
    const mapId=target?.map||(campus?'campus':config.mapId()),c=calibrationFor(mapId);
    if(c&&value.fresh&&!choosing){
      const raw=N.locate(value.fix,c),g=grid(mapId),cell=N.cellAt(g,raw);
      // Smooth small GPS jumps so the map/marker does not flash or shake while walking.
      let p=raw;
      if(origin&&origin.mapId===mapId&&!origin.manual){
        const jump=Math.hypot(raw.x-origin.x,raw.y-origin.y),softLimit=Math.max(4,(c.unitsPerMeter||1)*10);
        if(jump<softLimit){const alpha=.38;p={x:origin.x+(raw.x-origin.x)*alpha,y:origin.y+(raw.y-origin.y)*alpha};}
      }
      // Never clamp a remote GPS fix onto a hall or snap it across a booth.
      outsideVenue=cell<0||(cell>=0&&!g.allowed[cell]);
      origin={mapId,...p,manual:false};
    }else if(origin&&!origin.manual&&!value.fresh)origin=null;
    if(target){
      if(!origin||origin.mapId!==target.map){cancel();route=null;lastOriginKey='';lastRouteOrigin=null;status(value.status==='denied'?'위치 권한이 꺼져 있어요. 내 위치를 직접 맞춰 주세요.':outsideVenue?'멧세 밖의 위치예요. 지도에서 내 위치를 맞출 수 있어요.':c?'현재 위치를 확인 중이에요. 통로에서 위치를 맞출 수 있어요.':'이 도면에서 내 위치를 먼저 맞춰 주세요.');}
      else recalculate();
    }
    if(following&&origin&&!outsideVenue){center(zoomNext);zoomNext=false;}
    syncMapRotation();
    buttons();renderSoon();
  });
  function describeBooth(b){
    $('nav-code').textContent=`${b.locationLabel||b.hall+'홀'} · ${b.code}`;$('nav-name').textContent=b.shortName||b.name;
    // Reuse the app's sourced booth description; never turn unknown into "none".
    const text=config.describeBooth(b);$('nav-exhibits').textContent=text;
    $('nav-sources').replaceChildren();for(const item of config.boothSources(b)){if(!/^https:\/\//.test(item.url))continue;const a=document.createElement('a');a.href=item.url;a.target='_blank';a.rel='noopener';a.textContent=item.label+' ↗';$('nav-sources').append(a);}
    $('nav-more').open=false;
  }
  function describeFacility(f){
    const labels={entrance:'입구',locker:'보관함',food:'식사',charge:'배터리',info:'안내소',restroom:'화장실',event:'이벤트'};
    $('nav-code').textContent=(f.floor||'')+' · '+(labels[f.category]||f.category);$('nav-name').textContent=f.name;
    $('nav-exhibits').textContent=f.note||'편의시설 위치';$('nav-sources').replaceChildren();
    if(/^https:\/\//.test(data.source||'')){const a=document.createElement('a');a.href=data.source;a.target='_blank';a.rel='noopener';a.textContent='TGS 공식 배치도 ↗';$('nav-sources').append(a);}
    $('nav-more').open=false;
  }
  function startTarget(next,describe){
    if(target?.id===next.id&&target?.kind===next.kind){stop();return;}
    sensors.start();cancel();route=null;lastOriginKey='';lastRouteOrigin=null;target=next;choosing=false;fitNext=false;following=true;zoomNext=true;lastCenter='';collapsed=false;
    config.enter(next.map);following=true;describe(next);$('nav-card').hidden=false;config.targetChanged(next.kind==='booth'?next.id:null);
    if(origin?.mapId!==next.map)origin=null;
    const c=calibrationFor(next.map);if(c&&reading.fresh){const p=N.locate(reading.fix,c),g=grid(next.map),i=N.cellAt(g,p);outsideVenue=i<0||(i>=0&&!g.allowed[i]);origin={mapId:next.map,...p,manual:false};}
    status(origin?'통로를 따라 경로를 찾고 있어요.':'이 도면에서 내 위치를 먼저 맞춰 주세요.');
    controls();if(origin){center(true);zoomNext=false;}syncMapRotation();recalculate();buttons();renderSoon();$('nav-stop').focus?.({preventScroll:true});
  }
  function toggleBooth(id){const b=booths.get(id);if(b)startTarget(b,describeBooth);}
  function toggleFacility(id){const f=facilities.get(id);if(f)startTarget(f,describeFacility);}
  function stop(){
    cancel();target=null;route=null;choosing=false;firstAnchor=null;lastOriginKey='';lastRouteOrigin=null;following=false;zoomNext=false;lastCenter='';collapsed=false;
    $('nav-card').hidden=true;edgeVisible(false);$('nav-pick-hint').hidden=true;
    sensors.stop();origin=null;syncMapRotation(true);config.targetChanged(null);config.exit();buttons();renderSoon();
  }
  function beginPick(){
    if(choosing){choosing=false;buttons();return;}
    if(campus&&config.mapId()!=='campus')config.showCampus();
    if(!config.walkable.maps[config.mapId()]){config.announce('부스가 있는 전시관 지도에서 내 위치를 맞춰 주세요.');return;}
    sensors.start();choosing=true;following=false;syncMapRotation(true);buttons();
  }
  function choose(p){
    if(!choosing)return false;
    const mapId=config.mapId(),g=grid(mapId),i=N.cellAt(g,p);
    if(i<0||!g.allowed[i]){config.announce('부스 바깥의 통로를 눌러 주세요.');return true;}
    const snapped=N.point(g,i);origin={mapId,...snapped,manual:true};choosing=false;lastOriginKey='';lastRouteOrigin=null;fitNext=false;
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
    const g=grid(target.map),cell=N.cellAt(g,origin),key=target.id+':'+cell,c=calibrationFor(target.map);
    const minMove=Math.max(g.cell*4,(c?.unitsPerMeter||0)*1.8);
    if(lastRouteOrigin&&lastRouteOrigin.mapId===origin.mapId&&lastRouteOrigin.targetId===target.id&&Math.hypot(origin.x-lastRouteOrigin.x,origin.y-lastRouteOrigin.y)<minMove)return;
    if(key===lastOriginKey&&route)return;
    lastOriginKey=key;lastRouteOrigin={mapId:origin.mapId,targetId:target.id,x:origin.x,y:origin.y};
    cancel();const token=routeToken,b=target,p={x:origin.x,y:origin.y},previousRoute=route;
    // Keep the previous route visible during recalculation. Clearing it here caused a visible blink on every GPS update.
    try{
      let result;
      try{result=await requestRoute(p,b);}catch(e){if(e.message!=='worker')throw e;result=await requestRoute(p,b);}
      if(token!==routeToken||!target||!result)return;route=result;
      route.usesBridge=target.map==='campus'&&route.line.some(p=>p.y>campus.bridgeBounds[1]&&p.y<campus.bridgeBounds[3]);
      status(route.usesBridge?'2F 연결교 이용 · 표시된 계단으로 이동하세요.':route.startSnapDistance>2?'실외 위치를 가까운 보행 경로에 연결해 안내 중입니다.':target.floor===2?'목적지는 2F · 에스플러네이드입니다.':origin.manual?'직접 맞춘 내 위치 · 통로 안내':target.kind==='facility'?'시설까지 통로를 따라 이동하세요.':'부스까지 통로를 따라 이동하세요.');
      if(fitNext){fitNext=false;fit();}renderSoon();
    }catch(e){
      if(token!==routeToken)return;
      route=previousRoute||null;
      status(e.message==='off-path'||e.message==='outside'?'경로선을 새로 만들 수 없는 위치예요. 기존 경로와 화면 가장자리 방향 하이라이트를 유지합니다.':'연결된 통로를 다시 찾지 못했어요. 기존 경로와 방향 하이라이트를 유지합니다.');
      renderSoon();
    }
  }
  function fit(){if(!target)return;const pts=route?.line?.length?route.line:[{x:target.bounds[0],y:target.bounds[1]},{x:target.bounds[2],y:target.bounds[3]}];config.fit(pts,target.bounds,$('nav-card').getBoundingClientRect().height+24);}
  function renderSoon(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;render();});}
  function render(){
    const viewport=$('viewport'),w=viewport.clientWidth,h=viewport.clientHeight,overlay=$('nav-overlay');overlay.setAttribute('viewBox',`0 0 ${w} ${h}`);
    const points=route&&target?.map===config.mapId()?route.line.map(config.toScreen):[];
    const d=points.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
    $('nav-route-halo').setAttribute('d',d);$('nav-route-line').setAttribute('d',d);
    let transitions=$('nav-transitions');
    if(!transitions){transitions=document.createElementNS('http://www.w3.org/2000/svg','g');transitions.id='nav-transitions';overlay.append(transitions);}
    transitions.replaceChildren();
    if(route&&target?.map==='campus'&&config.mapId()==='campus'&&Array.isArray(campus?.stairs)){
      const segmentDistance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;if(!l)return Math.hypot(p.x-a.x,p.y-a.y);const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)),x=a.x+t*dx,y=a.y+t*dy;return Math.hypot(p.x-x,p.y-y);};
      for(const stair of campus.stairs){
        let used=false;for(let i=1;i<route.line.length;i++)if(segmentDistance(stair,route.line[i-1],route.line[i])<4.2){used=true;break;}
        if(!used)continue;
        const q=config.toScreen(stair),g=document.createElementNS('http://www.w3.org/2000/svg','g');g.setAttribute('transform',`translate(${q.x} ${q.y})`);g.setAttribute('pointer-events','none');
        const c=document.createElementNS('http://www.w3.org/2000/svg','circle');c.setAttribute('r','17');c.setAttribute('fill','#fff');c.setAttribute('stroke','#7c3aed');c.setAttribute('stroke-width','4');
        const icon=document.createElementNS('http://www.w3.org/2000/svg','text');icon.setAttribute('text-anchor','middle');icon.setAttribute('y','6');icon.setAttribute('font-size','19');icon.setAttribute('font-weight','900');icon.setAttribute('fill','#5b21b6');icon.textContent='↕';
        const label=document.createElementNS('http://www.w3.org/2000/svg','text');label.setAttribute('text-anchor','middle');label.setAttribute('y','35');label.setAttribute('font-size','12');label.setAttribute('font-weight','800');label.setAttribute('paint-order','stroke');label.setAttribute('stroke','#fff');label.setAttribute('stroke-width','4');label.setAttribute('fill','#4c1d95');label.textContent='계단 · 층 이동';
        g.append(c,icon,label);transitions.append(g);
      }
    }
    const p=origin?.mapId===config.mapId()?config.toScreen(origin):null,marker=$('nav-position');
    marker.style.display=p?'':'none';if(p)marker.setAttribute('transform',`translate(${p.x} ${p.y})`);
    const c=calibrationFor(config.mapId()),known=p&&c&&reading.heading!==null&&reading.heading!==undefined;
    $('nav-arrow').style.display=known?'':'none';$('nav-dot').style.display=known?'none':'';
    if(known)$('nav-arrow').setAttribute('transform',`rotate(${N.headingOnMap(reading.heading,c)-(config.frameRotation?.()||0)+mapRotation})`);
    $('nav-position-label').textContent=origin?.manual?'맞춘 내 위치':'내 위치';
    const end=points.at(-1);$('nav-end').style.display=end?'':'none';if(end){$('nav-end').setAttribute('cx',end.x);$('nav-end').setAttribute('cy',end.y);}
    const restricted=route?.usesBridge&&N.campusRestricted();
    $('nav-route-line').classList.toggle('restricted',!!restricted);
    if(restricted)status('일반공개일 홀 사이 이동은 10시부터 가능해요.');
    else if(route?.usesBridge)status('2F 연결교 이용 · 표시된 계단으로 이동하세요.');
    const showEdge=!!target&&!!p&&!document.hidden&&!restricted;
    edgeVisible(showEdge);if(!showEdge)return;
    const map=maps.get(target.map),targetPoint={x:(target.bounds[0]+target.bounds[2])/2,y:(target.bounds[1]+target.bounds[3])/2};
    const direct=Math.hypot(targetPoint.x-origin.x,targetPoint.y-origin.y);
    const routeUnits=route?.length??direct,remaining=c?routeUnits/c.unitsPerMeter:routeUnits;
    const thresholds=c?undefined:{far:Math.min(map.width,map.height)*.65,near:Math.min(map.width,map.height)*.10,arrival:Math.min(map.width,map.height)*.025};
    const state=N.proximity(remaining,thresholds),aim=config.toScreen(targetPoint);
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
  $('nav-recenter').addEventListener('click',()=>{sensors.start();follow(true);syncMapRotation();});
  $('nav-overview').addEventListener('click',()=>{following=false;syncMapRotation(true);buttons();fit();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&target){e.preventDefault();stop();}});
  return {toggleBooth,toggleFacility,stop,choose,isChoosing:()=>choosing,isActive:()=>!!target,targetId:()=>target?.kind==='booth'?target.id:null,targetFacilityId:()=>target?.kind==='facility'?target.id:null,update:renderSoon,
    interact:()=>{following=false;fitNext=false;syncMapRotation(true);buttons();},
    toggleControls:()=>{collapsed=!collapsed;controls();lastCenter='';if(following)center();renderSoon();},
    resize:()=>{lastCenter='';if(following)center(zoomNext);renderSoon();},
    mapChanged:()=>{choosing=false;following=false;lastCenter='';syncMapRotation(true);if(firstAnchor?.mapId!==config.mapId())firstAnchor=null;buttons();renderSoon();}};
}
root.TGSMapNavigation={create};
})(typeof window==='undefined'?globalThis:window);
