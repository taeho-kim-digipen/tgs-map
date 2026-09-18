'use strict';

const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const write=(rel,text)=>fs.writeFileSync(path.join(root,rel),text);
function replaceOne(text,from,to,label){
  if(!text.includes(from))throw new Error(`patch target not found: ${label}`);
  return text.replace(from,to);
}

let app=read('dist/app.js');

app=replaceOne(app,
`    for(const b of data.booths.map(b=>geometryOf(b,mapId)).filter(Boolean)){\n      const path=svgEl('path',{d:b.path,class:'booth','data-booth':b.id,tabindex:0,role:'button','aria-label':\`${'${b.name}'}, ${'${b.code}'}. 길게 누르거나 Enter 키로 관심 표시. 두 번 누르거나 Shift Enter 키로 경로 안내.\`, 'aria-pressed':favorites.has(b.id)});`,
`    const boothPriority=b=>({halls911:0,main:0,school:2,indie9:4,business9:4,selected80:5}[b.sourceMap||b.map]??1);\n    const interactiveBooths=data.booths.map(b=>geometryOf(b,mapId)).filter(Boolean).sort((a,b)=>boothPriority(a)-boothPriority(b));\n    for(const b of interactiveBooths){\n      const path=svgEl('path',{d:b.path,class:'booth','data-booth':b.id,tabindex:0,role:'button','pointer-events':'all','aria-label':b.name+', '+b.code+'. 길게 누르거나 Enter 키로 관심 표시. 두 번 누르거나 Shift Enter 키로 경로 안내.', 'aria-pressed':favorites.has(b.id)});`,
'inset hitbox stacking');

app=replaceOne(app,
`      const isCompact=(activeMap.id==='campus'&&tier==='medium')||(scale<.9&&favorites.size>7);\n      label.textContent=isCompact?'★':\`★ ${'${nameOf(b)}'}\`;if(isCompact)label.classList.add('compact');`,
`      const inset=activeMap.id==='campus'&&['indie9','business9','selected80'].includes(b.sourceMap);\n      const isCompact=inset||(activeMap.id==='campus'&&tier==='medium')||(scale<.9&&favorites.size>7);\n      label.textContent=inset?'★ '+String(b.code).replace(/^09-/,''):isCompact?'★':'★ '+nameOf(b);\n      if(isCompact)label.classList.add('compact');if(inset)label.classList.add('inset');\n      label.dataset.booth=id;label.classList.add('interactive');`,
'inset labels');

app=replaceOne(app,
`    const open=document.createElement('button');open.type='button';open.className='booth-peek-open';open.textContent='보기';open.setAttribute('aria-label',\`${'${nameOf(b)}'} 상세정보 보기\`);open.addEventListener('click',()=>showDetail(id));\n    card.append(info,open);card.hidden=false;`,
`    const route=document.createElement('button');route.type='button';route.className='booth-peek-route';route.textContent='경로';route.setAttribute('aria-label',nameOf(b)+'까지 경로 안내');route.addEventListener('click',()=>navigation?.toggleBooth(id));\n    const open=document.createElement('button');open.type='button';open.className='booth-peek-open';open.textContent='보기';open.setAttribute('aria-label',nameOf(b)+' 상세정보 보기');open.addEventListener('click',()=>showDetail(id));\n    card.append(info,route,open);card.hidden=false;`,
'booth peek route button');

app=replaceOne(app,
`    const note=document.createElement('p');note.textContent=f.note;panel.append(head,note);panel.hidden=false;`,
`    const note=document.createElement('p');note.textContent=f.note;\n    const routeAction=document.createElement('button');routeAction.className='route-button';routeAction.textContent=navigation?'이 시설까지 찾아가기':'위치 안내 준비 중';routeAction.disabled=!navigation;routeAction.addEventListener('click',()=>navigation?.toggleFacility(id));\n    panel.append(head,note,routeAction);panel.hidden=false;`,
'facility route button');

app=replaceOne(app,
`      if(activeMap.id==='campus'&&tier!=='full')button.classList.add('is-muted');\n      const title=c.items.length>1?\`${'${categories[c.category].label}'} ${'${c.items.length}'}곳 · 확대\`:c.items[0].name;`,
`      if(activeMap.id==='campus'&&tier!=='full')button.classList.add('is-muted');\n      if(c.items.length===1&&navigation?.targetFacilityId?.()===c.items[0].id)button.classList.add('nav-destination');\n      const title=c.items.length>1?categories[c.category].label+' '+c.items.length+'곳 · 확대':c.items[0].name;`,
'facility destination highlight');

app=replaceOne(app,
`          targetChanged:()=>updateSelection(),`,
`          targetChanged:()=>{updateSelection();renderFacilities();},`,
'target refresh');

write('dist/app.js',app);

let nav=read('dist/navigation/tgs-navigation.js');
nav=replaceOne(nav,
`  const booths=new Map(data.booths.map(b=>[b.id,campus?.placements[b.id]?{...b,...campus.placements[b.id],map:'campus'}:b]));`,
`  const booths=new Map(data.booths.map(b=>[b.id,campus?.placements[b.id]?{...b,...campus.placements[b.id],map:'campus',kind:'booth'}:{...b,kind:'booth'}]));\n  const facilities=new Map(data.facilities.map(f=>{const p=campus?.facilityPlacements?.[f.id],x=p?.x??f.x,y=p?.y??f.y,map=p?'campus':f.map;return [f.id,{...f,...(p||{}),x,y,map,kind:'facility',bounds:[x-1.4,y-1.4,x+1.4,y+1.4]}];}));`,
'facility targets');

nav=replaceOne(nav,
`  function toggleBooth(id){\n    const b=booths.get(id);if(!b)return;\n    if(target?.id===id){stop();return;}\n    // Both permission requests originate in this double tap / button event.\n    sensors.start();cancel();route=null;lastOriginKey='';target=b;choosing=false;fitNext=false;following=true;zoomNext=true;lastCenter='';collapsed=false;\n    config.enter(b.map);following=true;describeBooth(b);$('nav-card').hidden=false;config.targetChanged(id);\n    if(origin?.mapId!==b.map)origin=null;\n    const c=calibrationFor(b.map);if(c&&reading.fresh){const p=N.locate(reading.fix,c),g=grid(b.map),i=N.cellAt(g,p);if(i>=0)origin={mapId:b.map,...p,manual:false};}\n    status(origin?'통로를 따라 경로를 찾고 있어요.':'이 도면에서 내 위치를 먼저 맞춰 주세요.');\n    controls();if(origin){center(true);zoomNext=false;}recalculate();buttons();renderSoon();$('nav-stop').focus?.({preventScroll:true});\n  }`,
`  function describeFacility(f){\n    const labels={entrance:'입구',locker:'보관함',food:'식사',charge:'배터리',info:'안내소',restroom:'화장실',event:'이벤트'};\n    $('nav-code').textContent=(f.floor||'')+' · '+(labels[f.category]||f.category);$('nav-name').textContent=f.name;\n    $('nav-exhibits').textContent=f.note||'편의시설 위치';$('nav-sources').replaceChildren();\n    if(/^https:\\/\\//.test(data.source||'')){const a=document.createElement('a');a.href=data.source;a.target='_blank';a.rel='noopener';a.textContent='TGS 공식 배치도 ↗';$('nav-sources').append(a);}\n    $('nav-more').open=false;\n  }\n  function startTarget(next,describe){\n    if(target?.id===next.id&&target?.kind===next.kind){stop();return;}\n    sensors.start();cancel();route=null;lastOriginKey='';target=next;choosing=false;fitNext=false;following=true;zoomNext=true;lastCenter='';collapsed=false;\n    config.enter(next.map);following=true;describe(next);$('nav-card').hidden=false;config.targetChanged(next.kind==='booth'?next.id:null);\n    if(origin?.mapId!==next.map)origin=null;\n    const c=calibrationFor(next.map);if(c&&reading.fresh){const p=N.locate(reading.fix,c),g=grid(next.map),i=N.cellAt(g,p);if(i>=0)origin={mapId:next.map,...p,manual:false};}\n    status(origin?'통로를 따라 경로를 찾고 있어요.':'이 도면에서 내 위치를 먼저 맞춰 주세요.');\n    controls();if(origin){center(true);zoomNext=false;}recalculate();buttons();renderSoon();$('nav-stop').focus?.({preventScroll:true});\n  }\n  function toggleBooth(id){const b=booths.get(id);if(b)startTarget(b,describeBooth);}\n  function toggleFacility(id){const f=facilities.get(id);if(f)startTarget(f,describeFacility);}`,
'generic target navigation');

nav=replaceOne(nav,
`      status(route.usesBridge?'2F 연결교 이용 · 표시된 계단으로 이동하세요.':target.floor===2?'목적지는 2F · 에스플러네이드입니다.':origin.manual?'직접 맞춘 내 위치 · 통로 안내':'부스까지 통로를 따라 이동하세요.');`,
`      status(route.usesBridge?'2F 연결교 이용 · 표시된 계단으로 이동하세요.':target.floor===2?'목적지는 2F · 에스플러네이드입니다.':origin.manual?'직접 맞춘 내 위치 · 통로 안내':target.kind==='facility'?'시설까지 통로를 따라 이동하세요.':'부스까지 통로를 따라 이동하세요.');`,
'facility route status');

nav=replaceOne(nav,
`  return {toggleBooth,stop,choose,isChoosing:()=>choosing,isActive:()=>!!target,targetId:()=>target?.id||null,update:renderSoon,`,
`  return {toggleBooth,toggleFacility,stop,choose,isChoosing:()=>choosing,isActive:()=>!!target,targetId:()=>target?.kind==='booth'?target.id:null,targetFacilityId:()=>target?.kind==='facility'?target.id:null,update:renderSoon,`,
'navigation public API');
write('dist/navigation/tgs-navigation.js',nav);

let css=read('dist/style.css');
if(!css.includes('/* inset-facility-nav-v1 */'))css+=`\n/* inset-facility-nav-v1 */\n.map-label.interactive{pointer-events:auto;cursor:pointer}.map-label.inset{max-width:72px;padding:2px 4px;font-size:10px;line-height:1.1;border-width:1px}.map-label.inset:after{bottom:-4px;border-left-width:3px;border-right-width:3px;border-top-width:4px}.booth-peek-route{flex:0 0 auto;min-width:52px;min-height:38px;border:1px solid #263d40;border-radius:7px;background:#fff;color:#263d40;font-weight:750}.facility-marker.nav-destination{outline:4px solid #823dde;outline-offset:3px;box-shadow:0 0 0 3px #fff,0 4px 18px #44216b4a}\n@media(max-height:520px) and (orientation:landscape){.booth-peek-route{min-height:34px}}\n`;
write('dist/style.css',css);

let html=read('dist/index.html');
html=html.replace(/<meta name="tgs-travel-version" content="[^"]+">/,'<meta name="tgs-travel-version" content="2026.09.18.5">');
html=html.replace(/\.\/style\.css\?v=\d+/,'./style.css?v=10');
html=html.replace(/\.\/navigation\/tgs-navigation\.js\?v=\d+/,'./navigation/tgs-navigation.js?v=8');
html=html.replace(/\.\/app\.js\?v=\d+/,'./app.js?v=11');
write('dist/index.html',html);

let sw=read('dist/sw.js');
sw=sw.replace(/const VERSION = '[^']+';/,"const VERSION = '2026.09.18.5';");
write('dist/sw.js',sw);

console.log('patched inset booth taps, compact labels, booth quick-route, and facility navigation');
