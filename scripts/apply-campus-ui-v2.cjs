'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const appPath=path.join(root,'dist','app.js');
const dataPath=path.join(root,'dist','map-data.json');
const swPath=path.join(root,'dist','sw.js');
const htmlPath=path.join(root,'dist','index.html');

function mustReplace(text,search,replacement,label){
  if(search instanceof RegExp){
    if(!search.test(text))throw new Error(`patch target missing: ${label}`);
    return text.replace(search,replacement);
  }
  if(!text.includes(search))throw new Error(`patch target missing: ${label}`);
  return text.replace(search,replacement);
}

let app=fs.readFileSync(appPath,'utf8');
app=mustReplace(app,
"  let modePreference='auto';\n  let visitFilter='all';",
"  let modePreference='auto';\n  const PLAN_MIGRATION_KEY='tgs2026-planned-booths-v2';\n  let campusViewBounds=new Map();\n  let visitFilter='all';",
'mode globals');

app=mustReplace(app,
/  function selectView\(id\) \{[\s\S]*?\n  \}\n  function focusBooth/,
`  function selectView(id) {
    const view=data.views.find(v=>v.id===id);if(!view)return;
    closeResults(false);
    cancelHold();closeDetail();activeView=id;
    const campusBounds=campusViewBounds.get(id);
    if(campusBounds){
      if(!activeMap||activeMap.id!=='campus')setMap('campus');
      fitBounds(campusBounds,id==='campus'?18:34);
    }else{
      if(!activeMap||activeMap.id!==view.map)setMap(view.map);
      fitBounds(view.bounds);
    }
    for(const el of $('hall-nav').children)el.setAttribute('aria-pressed',String(el.dataset.view===id));
    if($('app').dataset.mode!=='pc')Array.from($('hall-nav').children).find(el=>el.dataset.view===id)?.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'smooth'});
  }
  function focusBooth`,
'selectView');

app=mustReplace(app,
"      for(const b of data.booths)b.campus=campus.placements[b.id];for(const f of data.facilities)f.campus=campus.facilityPlacements[f.id];\n      byId=new Map(data.booths.map(b=>[b.id,b]));",
`      for(const b of data.booths)b.campus=campus.placements[b.id];for(const f of data.facilities)f.campus=campus.facilityPlacements[f.id];
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
      const concourseRects=data.facilities.filter(f=>f.map==='concourse'&&f.campus).map(f=>[f.campus.x-10,f.campus.y-10,f.campus.x+10,f.campus.y+10]);
      const concourseBounds=unionBounds(concourseRects,10);if(concourseBounds)campusViewBounds.set('concourse',concourseBounds);
      for(const [key,value] of [...campusViewBounds])if(!value)campusViewBounds.delete(key);
      byId=new Map(data.booths.map(b=>[b.id,b]));`,
'campus view bounds');

app=mustReplace(app,
"      catch{favorites=new Set(data.defaults.filter(id=>byId.has(id)));storageOkay=false;$('storage-status').textContent='현재 창에서만 유지';}\n      for(const v of data.views){",
`      catch{favorites=new Set(data.defaults.filter(id=>byId.has(id)));storageOkay=false;$('storage-status').textContent='현재 창에서만 유지';}
      try{if(localStorage.getItem(PLAN_MIGRATION_KEY)!=='1'){for(const id of data.defaults)if(byId.has(id))favorites.add(id);save();localStorage.setItem(PLAN_MIGRATION_KEY,'1');}}catch{}
      for(const v of data.views){`,
'favorites migration');

app=app.replace("      const p2=document.createElement('p');p2.textContent='반다이남코·넥슨·아스트라에 오라티오는 이전 방문 계획에 따라 처음부터 표시됩니다. 1홀 학교 구역은 원본의 별도 확대도로 볼 수 있습니다.';",
"      const p2=document.createElement('p');p2.textContent='방문 계획에서 정한 부스들은 처음 한 번 관심 부스로 자동 추가됩니다. 홀 버튼은 별도 지도로 바꾸지 않고 멧세 전체 지도에서 해당 위치로 이동합니다.';");

fs.writeFileSync(appPath,app);

const planned=['05-N01','07-C04','07-C03','07-S01','06-S01','04-N01','05-S01','03-N07','03-N04','04-C04','03-C01','08-N06','06-N04','09-E104','08-N07','09-E66'];
const data=JSON.parse(fs.readFileSync(dataPath,'utf8'));
const valid=new Set(data.booths.map(b=>b.id));
data.defaults=planned.filter(id=>valid.has(id));
if(data.defaults.length!==planned.length)throw new Error(`planned booth missing: ${planned.filter(id=>!valid.has(id)).join(', ')}`);
fs.writeFileSync(dataPath,JSON.stringify(data));

let sw=fs.readFileSync(swPath,'utf8');
sw=mustReplace(sw,/const VERSION = '[^']+';/,"const VERSION = '2026.09.18.1';",'service worker version');
fs.writeFileSync(swPath,sw);

let html=fs.readFileSync(htmlPath,'utf8');
html=mustReplace(html,/meta name="tgs-travel-version" content="[^"]+"/, 'meta name="tgs-travel-version" content="2026.09.18.1"','html version');
html=html.replace('./app.js?v=7','./app.js?v=8');
fs.writeFileSync(htmlPath,html);

console.log('campus UI v2 applied; planned favorites:',data.defaults.length);
