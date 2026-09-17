'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const appPath=path.join(root,'dist','app.js');
const htmlPath=path.join(root,'dist','index.html');
const stylePath=path.join(root,'dist','style.css');
const swPath=path.join(root,'dist','sw.js');

function mustReplace(text,search,replacement,label){
  if(search instanceof RegExp){
    if(!search.test(text))throw new Error(`patch target missing: ${label}`);
    return text.replace(search,replacement);
  }
  if(!text.includes(search))throw new Error(`patch target missing: ${label}`);
  return text.replace(search,replacement);
}

let app=fs.readFileSync(appPath,'utf8');
if(!app.includes("const FLOOR_UI_VERSION='v3';")){
  app=mustReplace(app,
`  let boothNodes = new Map();
  let scene, favoritePage=0;
  const vectorMaps=new Map();
  let modePreference='auto';
  const PLAN_MIGRATION_KEY='tgs2026-planned-booths-v2';
  let campusViewBounds=new Map();
  let visitFilter='all';`,
`  let boothNodes = new Map();
  let scene, floorOverlayLayer, favoritePage=0;
  const vectorMaps=new Map();
  let modePreference='auto';
  const PLAN_MIGRATION_KEY='tgs2026-planned-booths-v2';
  const FLOOR_UI_VERSION='v3';
  let campusViewBounds=new Map();
  let floorRegions={first:[],second:[]};
  let floorMode='all';
  let visitFilter='all';`,
  'state globals');

  app=mustReplace(app,
`  const nameOf = b => b.shortName || b.name;
  const locationOf = b => b.locationLabel||\`${b.hall}홀\`;
  const geometryOf=(b,mapId=activeMap?.id)=>!b?null:mapId==='campus'&&b.campus?{...b,...b.campus,map:'campus'}:b.map===mapId?b:null;`,
`  const nameOf = b => b.shortName || b.name;
  const locationOf = b => b.locationLabel||\`${b.hall}홀\`;
  const geometryOf=(b,mapId=activeMap?.id)=>!b?null:mapId==='campus'&&b.campus?{...b,...b.campus,map:'campus'}:b.map===mapId?b:null;
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
    for(const button of wrap.querySelectorAll('button'))button.setAttribute('aria-pressed',String(active&&button.dataset.floor===floorMode));
  }
  function renderFloorOverlay(){
    if(!floorOverlayLayer)return;
    floorOverlayLayer.replaceChildren();
    if(activeMap?.id!=='campus'||floorMode==='all')return;
    const masks=floorMode==='2f'?floorRegions.first:floorRegions.second;
    const label=floorMode==='2f'?'1F':'2F';
    for(const bounds of masks||[]){
      if(!bounds)continue;
      const [x0,y0,x1,y1]=bounds;
      floorOverlayLayer.append(svgEl('rect',{x:x0,y:y0,width:x1-x0,height:y1-y0,class:'floor-mask'}));
      floorOverlayLayer.append(svgEl('rect',{x:x0,y:y0,width:x1-x0,height:y1-y0,rx:6,ry:6,class:'floor-mask-outline'}));
      const text=svgEl('text',{x:x0+10,y:y0+19,class:'floor-mask-label'});text.textContent=\`${label} 숨김\`;floorOverlayLayer.append(text);
    }
  }
  function setFloorMode(mode,{silent=false}={}){
    if(activeMap?.id!=='campus'){floorMode='all';syncFloorSwitchUI();return;}
    floorMode=mode==='2f'?'2f':'1f';
    $('map-floor').textContent=floorMode==='2f'?'2F · 센트럴몰':'1F · 메인 전시관';
    syncFloorSwitchUI();
    updateSelection();
    renderTransform();
    if(!silent)announce(floorMode==='2f'?'2층만 표시':'1층만 표시');
  }`,
  'floor helpers');

  app=mustReplace(app,
/  function renderFacilities\(\)\{[\s\S]*?\n  \}\n  function focusFacility/,
`  function renderFacilities(){
    if(!activeMap||!data)return;
    const layer=$('facility-markers');layer.replaceChildren();const clusters=[];const tier=detailTier();
    const radius=activeMap.id==='campus'?(tier==='overview'?52:tier==='medium'?38:27):27;
    for(const original of data.facilities){
      const facility=geometryOf(original);if(!facility)continue;
      if(activeMap.id==='campus'){
        if(campusFloorOf(original)!==floorMode)continue;
        if(tier==='overview'){
          if(floorMode==='1f'&&original.category!=='entrance')continue;
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
      const button=document.createElement('button');button.className=\`facility-marker ${c.category}\`;button.style.left=\`${c.x}px\`;button.style.top=\`${c.y}px\`;button.style.backgroundColor=categories[c.category].color;
      if(activeMap.id==='campus'&&tier!=='full')button.classList.add('is-muted');
      const title=c.items.length>1?\`${categories[c.category].label} ${c.items.length}곳 · 확대\`:c.items[0].name;
      button.setAttribute('aria-label',title);button.title=title;button.append(facilityIcon(c.category));
      if(c.items.length>1){const count=document.createElement('span');count.className='cluster-count';count.textContent=c.items.length;button.append(count);}
      button.addEventListener('click',()=>{
        closeResults(false);
        if(c.items.length===1)focusFacility(c.items[0].id);
        else{closeDetail();activeView=null;const xs=c.items.map(f=>f.x),ys=c.items.map(f=>f.y);fitBounds([Math.min(...xs)-12,Math.min(...ys)-12,Math.max(...xs)+12,Math.max(...ys)+12],55);}
      });layer.append(button);
    }
  }
  function focusFacility`,
  'facility density');

  app=mustReplace(app,
`    closeResults(false);closeDetail();if(activeMap.id!==f.map)setMap(f.map);activeView=null;
    for(const el of $('hall-nav').children)el.setAttribute('aria-pressed',String(el.dataset.view===f.map));`,
`    closeResults(false);closeDetail();if(activeMap.id!==f.map)setMap(f.map);activeView=null;
    if(activeMap.id==='campus')setFloorMode(campusFloorOf(original),{silent:true});
    for(const el of $('hall-nav').children)el.setAttribute('aria-pressed',String(el.dataset.view===f.map));`,
  'facility floor focus');

  app=mustReplace(app,
/  function updateSelection\(\) \{[\s\S]*?\n  \}\n  function renderFavorites/,
`  function updateSelection() {
    for (const [id,node] of boothNodes) {
      const b=byId.get(id),info=visitOf(b),enabled=visitFilter!=='off';
      const hiddenFloor=activeMap?.id==='campus'&&floorMode==='2f';
      node.classList.toggle('hidden-floor',hiddenFloor);
      node.classList.toggle('visit-demo-outline',enabled&&!hiddenFloor&&info.demo==='yes');
      node.classList.toggle('visit-ticket-outline',enabled&&!hiddenFloor&&needsTicket(info));
      node.classList.toggle('visit-sale-outline',enabled&&!hiddenFloor&&info.sales==='yes'&&!needsTicket(info));
      node.classList.toggle('visit-muted',!hiddenFloor&&!matchesVisit(b));
      node.classList.toggle('selected',!hiddenFloor&&favorites.has(id));
      node.classList.toggle('focused',!hiddenFloor&&focused===id);
      node.classList.toggle('nav-destination',!hiddenFloor&&navigation?.targetId()===id);
      node.setAttribute('aria-pressed',String(!hiddenFloor&&favorites.has(id)));
      node.setAttribute('tabindex',hiddenFloor?'-1':'0');
    }
    renderLabels();renderVisitMarkers();
  }
  function renderFavorites`,
  'floor booth visibility');

  app=mustReplace(app,
/  function renderLabels\(\) \{[\s\S]*?\n  \}\n  function renderVisitMarkers/,
`  function renderLabels() {
    if(!activeMap)return;
    const layer=$('labels');layer.replaceChildren();
    if(activeMap.id==='campus'&&floorMode==='2f')return;
    const tier=detailTier();if(activeMap.id==='campus'&&tier==='overview')return;
    const labels=[];
    for(const id of favorites){
      const b=geometryOf(byId.get(id));if(!b)continue;
      const r=b.bounds,x=tx+(r[0]+r[2])/2*scale,y=ty+r[1]*scale;
      if(x<0||x>viewport.clientWidth||y<-15||y>viewport.clientHeight+30)continue;
      const label=document.createElement('span');label.className='map-label';
      const isCompact=(activeMap.id==='campus'&&tier==='medium')||(scale<.9&&favorites.size>7);
      label.textContent=isCompact?'★':\`★ ${nameOf(b)}\`;if(isCompact)label.classList.add('compact');
      let labelY=y-4;
      for(let tries=0;tries<5&&labels.some(p=>Math.abs(p.x-x)<130&&Math.abs(p.y-labelY)<26);tries++)labelY-=27;
      labelY=Math.max(27,labelY);labels.push({x,y:labelY});
      label.style.left=\`${clamp(x,22,viewport.clientWidth-22)}px\`;label.style.top=\`${labelY}px\`;layer.append(label);
    }
  }
  function renderVisitMarkers`,
  'label density');

  app=mustReplace(app,
/  function renderVisitMarkers\(\)\{[\s\S]*?\n  \}\n  function constrain/,
`  function renderVisitMarkers(){
    const layer=$('visit-markers');layer.replaceChildren();if(!activeMap||visitFilter==='off')return;
    if(activeMap.id==='campus'&&(floorMode==='2f'||detailTier()!=='full'))return;
    const occupied=[];
    for(const b of data.booths.map(b=>geometryOf(b)).filter(b=>b&&matchesVisit(b))){
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
      marker.style.left=\`${x}px\`;marker.style.top=\`${y}px\`;
      for(const kind of marks){const badge=document.createElement('span');badge.className=\`visit-badge visit-${kind}\`;badge.append(visitIcon(kind));marker.append(badge);}
      layer.append(marker);
    }
  }
  function constrain`,
  'visit marker density');

  app=mustReplace(app,
`      scene?.setAttribute('transform',\`translate(${tx} ${ty}) scale(${scale})\`);
      renderLabels();renderFacilities();renderVisitMarkers();navigation?.update();`,
`      scene?.setAttribute('transform',\`translate(${tx} ${ty}) scale(${scale})\`);
      renderFloorOverlay();renderLabels();renderFacilities();renderVisitMarkers();navigation?.update();`,
  'floor overlay render');

  app=mustReplace(app,
/  function setMap\(mapId\) \{[\s\S]*?\n  \}\n  function selectView/,
`  function setMap(mapId) {
    activeMap=data.maps.find(m=>m.id===mapId);if(!activeMap)throw new Error('지도를 찾을 수 없습니다.');
    $('campus-credit').hidden=mapId!=='campus';
    minScale=Math.min(viewport.clientWidth/activeMap.width,viewport.clientHeight/activeMap.height)*.8;
    maxScale=activeMap.maxScale||32;
    svg.setAttribute('viewBox',\`0 0 ${viewport.clientWidth} ${viewport.clientHeight}\`);svg.setAttribute('width','100%');svg.setAttribute('height','100%');
    svg.replaceChildren();boothNodes=new Map();
    scene=svgEl('g',{'data-scene':'map'});svg.append(scene);
    scene.append(svgEl('rect',{x:0,y:0,width:activeMap.width,height:activeMap.height,fill:'white','pointer-events':'none'}));
    const base=document.importNode(vectorMaps.get(mapId),true);
    base.setAttribute('x','0');base.setAttribute('y','0');
    base.setAttribute('width',activeMap.width);base.setAttribute('height',activeMap.height);
    base.setAttribute('class','official-map');base.setAttribute('pointer-events','none');
    base.setAttribute('aria-hidden','true');base.setAttribute('focusable','false');
    base.setAttribute('overflow','hidden');scene.append(base);
    floorOverlayLayer=svgEl('g',{'data-layer':'floor-overlay'});scene.append(floorOverlayLayer);
    for(const b of data.booths.map(b=>geometryOf(b,mapId)).filter(Boolean)){
      const path=svgEl('path',{d:b.path,class:'booth','data-booth':b.id,tabindex:0,role:'button','aria-label':\`${b.name}, ${b.code}. 길게 누르거나 Enter 키로 관심 표시. 두 번 누르거나 Shift Enter 키로 경로 안내.\`, 'aria-pressed':favorites.has(b.id)});
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
    syncFloorSwitchUI();updateSelection();renderFloorOverlay();navigation?.mapChanged();
  }
  function selectView`,
  'setMap floor support');

  app=mustReplace(app,
/  function selectView\(id\) \{[\s\S]*?\n  \}\n  function focusBooth/,
`  function selectView(id) {
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
  function focusBooth`,
  'selectView floor support');

  app=mustReplace(app,
`    if(activeMap.id!==b.map)setMap(b.map);
    activeView=null;for(const el of $('hall-nav').children)el.setAttribute('aria-pressed','false');`,
`    if(activeMap.id!==b.map)setMap(b.map);
    if(activeMap.id==='campus')setFloorMode('1f',{silent:true});
    activeView=null;for(const el of $('hall-nav').children)el.setAttribute('aria-pressed','false');`,
  'booth floor focus');

  app=mustReplace(app,
`  $('zoom-in').addEventListener('click',()=>zoom(1.5));$('zoom-out').addEventListener('click',()=>zoom(1/1.5));$('fit').addEventListener('click',()=>selectView(data.views.find(v=>v.map===activeMap?.id)?.id||'all'));`,
`  $('zoom-in').addEventListener('click',()=>zoom(1.5));$('zoom-out').addEventListener('click',()=>zoom(1/1.5));$('fit').addEventListener('click',()=>selectView(data.views.find(v=>v.map===activeMap?.id)?.id||'all'));
  $('floor-switch')?.addEventListener('click',e=>{const button=e.target.closest('button[data-floor]');if(!button||activeMap?.id!=='campus')return;setFloorMode(button.dataset.floor);});`,
  'floor switch listener');

  app=mustReplace(app,
`    else if(activeView){const view=data.views.find(v=>v.id===activeView);if(view)fitBounds(view.bounds);}`,
`    else if(activeView){const campusBounds=campusViewBounds.get(activeView),view=data.views.find(v=>v.id===activeView);if(campusBounds)fitBounds(campusBounds,activeView==='campus'?18:34);else if(view)fitBounds(view.bounds);}`,
  'resize active campus view');

  app=mustReplace(app,
/      const unionBounds=\(rects,pad=8\)=>\{[\s\S]*?      for\(const \[key,value\] of \[\.\.\.campusViewBounds\]\)if\(!value\)campusViewBounds\.delete\(key\);/,
`      const unionBounds=(rects,pad=8)=>{if(!rects.length)return null;return [Math.min(...rects.map(r=>r[0]))-pad,Math.min(...rects.map(r=>r[1]))-pad,Math.max(...rects.map(r=>r[2]))+pad,Math.max(...rects.map(r=>r[3]))+pad];};
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
      for(const [key,value] of [...campusViewBounds])if(!value)campusViewBounds.delete(key);
      floorRegions={first:[boothCampusBounds(b=>['main','school'].includes(b.map),16),boothCampusBounds(b=>['halls911','indie9','selected80','business9'].includes(b.map),16)].filter(Boolean),second:[concourseBounds]};`,
  'campus and floor regions');

  app=app.replace("      const p2=document.createElement('p');p2.textContent='방문 계획에서 정한 부스들은 처음 한 번 관심 부스로 자동 추가됩니다. 홀 버튼은 별도 지도로 바꾸지 않고 멧세 전체 지도에서 해당 위치로 이동합니다.';",
  "      const p2=document.createElement('p');p2.textContent='홀 버튼은 멧세 전체 지도 안에서 해당 위치로 이동합니다. 우측의 1층·2층 버튼으로 층별 지도와 시설만 골라 볼 수 있으며, 축소 상태에서는 아이콘을 자동으로 줄여 표시합니다.';");
}
fs.writeFileSync(appPath,app);

let html=fs.readFileSync(htmlPath,'utf8');
if(!html.includes('id="floor-switch"')){
  html=mustReplace(html,
`      <div class="zoom-controls"><button id="zoom-in" aria-label="지도 확대">＋</button><button id="zoom-out" aria-label="지도 축소">−</button><button id="fit" aria-label="전체 지도 보기"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5"/></svg></button></div>`,
`      <div id="floor-switch" class="floor-switch" hidden aria-label="층 선택"><button data-floor="1f" aria-pressed="true">1층</button><button data-floor="2f" aria-pressed="false">2층</button></div>
      <div class="zoom-controls"><button id="zoom-in" aria-label="지도 확대">＋</button><button id="zoom-out" aria-label="지도 축소">−</button><button id="fit" aria-label="전체 지도 보기"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5"/></svg></button></div>`,
  'floor switch markup');
}
html=html.replace(/meta name="tgs-travel-version" content="[^"]+"/, 'meta name="tgs-travel-version" content="2026.09.18.2"');
html=html.replace(/\.\/style\.css\?v=\d+/, './style.css?v=8');
html=html.replace(/\.\/app\.js\?v=\d+/, './app.js?v=9');
fs.writeFileSync(htmlPath,html);

let style=fs.readFileSync(stylePath,'utf8');
if(!style.includes('.floor-switch{'))style+=`\n.floor-switch{position:absolute;right:67px;top:13px;display:flex;flex-direction:column;gap:6px;z-index:4}.floor-switch[hidden]{display:none}.floor-switch button{min-width:52px;height:34px;border:1px solid #d4ded7;border-radius:9px;background:#fffffff2;color:#304842;font-size:13px;font-weight:750;box-shadow:0 3px 14px #17332f16}.floor-switch button[aria-pressed=true]{background:#263d40;color:#fff;border-color:#263d40}.booth.hidden-floor{pointer-events:none}.booth.hidden-floor.selected,.booth.hidden-floor.focused,.booth.hidden-floor.nav-destination{fill:transparent;stroke:transparent}.floor-mask{fill:#e7ede9;opacity:.96;pointer-events:none}.floor-mask-outline{fill:none;stroke:#becbc2;stroke-width:2;stroke-dasharray:6 5;pointer-events:none}.floor-mask-label{fill:#6a7e74;font-size:12px;font-weight:700;pointer-events:none}.facility-marker.is-muted{opacity:.72;transform:translate(-50%,-50%) scale(.9)}\n#app[data-mode=portrait] .floor-switch{top:10px;right:58px}#app[data-mode=landscape] .floor-switch{top:7px;right:124px;flex-direction:row}#app[data-mode=landscape] .floor-switch button{height:32px;min-width:46px;border-radius:8px}#app[data-mode=pc] .floor-switch{top:16px;right:70px}\n`;
fs.writeFileSync(stylePath,style);

let sw=fs.readFileSync(swPath,'utf8');
sw=mustReplace(sw,/const VERSION = '[^']+';/,"const VERSION = '2026.09.18.2';",'service worker version');
fs.writeFileSync(swPath,sw);

console.log('Applied floor switch + zoom-density UI v3');
