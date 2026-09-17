'use strict';

const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const write=(rel,text)=>fs.writeFileSync(path.join(root,rel),text);
function replaceOne(text,from,to,label){
  if(!text.includes(from))throw new Error(`optimization target not found: ${label}`);
  return text.replace(from,to);
}

let app=read('dist/app.js');

app=replaceOne(app,
"  let contentItems=[], data, activeMap, activeView, byId, favorites = new Set(), storageOkay = true;\n  let tx = 0, ty = 0, scale = 1, minScale = .1, maxScale = 20;",
"  let contentItems=[], data, activeMap, activeView, byId, favorites = new Set(), storageOkay = true;\n  let visitBooths=[], lastSvgViewport='';\n  let tx = 0, ty = 0, scale = 1, minScale = .1, maxScale = 20;",
'cached runtime state');

app=replaceOne(app,
"  const geometryOf=(b,mapId=activeMap?.id)=>!b?null:mapId==='campus'&&b.campus?{...b,...b.campus,map:'campus'}:b.map===mapId?b:null;",
"  const geometryOf=(b,mapId=activeMap?.id)=>!b?null:mapId==='campus'&&b.campus?(b.campusGeometry||(b.campusGeometry={...b,...b.campus,map:'campus',sourceMap:b.campus.sourceMap||b.map})):b.map===mapId?b:null;",
'campus geometry cache');

app=replaceOne(app,
"    const layer=$('facility-markers');layer.replaceChildren();const clusters=[];const tier=detailTier();",
"    const layer=$('facility-markers');layer.replaceChildren();const fragment=document.createDocumentFragment(),clusters=[];const tier=detailTier();",
'facility fragment');
app=replaceOne(app,
"      });layer.append(button);\n    }\n  }\n  function focusFacility(id){",
"      });fragment.append(button);\n    }\n    layer.append(fragment);\n  }\n  function focusFacility(id){",
'facility batch append');

app=replaceOne(app,
"    const layer=$('labels');layer.replaceChildren();",
"    const layer=$('labels');layer.replaceChildren();const fragment=document.createDocumentFragment();",
'label fragment');
app=replaceOne(app,
"      label.style.left=`${clamp(x,22,viewport.clientWidth-22)}px`;label.style.top=`${labelY}px`;layer.append(label);\n    }\n  }\n  function renderVisitMarkers(){",
"      label.style.left=`${clamp(x,22,viewport.clientWidth-22)}px`;label.style.top=`${labelY}px`;fragment.append(label);\n    }\n    layer.append(fragment);\n  }\n  function renderVisitMarkers(){",
'label batch append');

app=replaceOne(app,
"    const layer=$('visit-markers');layer.replaceChildren();if(!activeMap||visitFilter==='off')return;",
"    const layer=$('visit-markers');layer.replaceChildren();const fragment=document.createDocumentFragment();if(!activeMap||visitFilter==='off')return;",
'visit fragment');
app=replaceOne(app,
"    for(const b of data.booths.map(b=>geometryOf(b)).filter(b=>b&&matchesVisit(b))){",
"    for(const source of visitBooths){const b=geometryOf(source);if(!b||!matchesVisit(b))continue;",
'visit booth subset');
app=replaceOne(app,
"      layer.append(marker);\n    }\n  }\n  function constrain() {",
"      fragment.append(marker);\n    }\n    layer.append(fragment);\n  }\n  function constrain() {",
'visit batch append');

app=replaceOne(app,
"      const w=viewport.clientWidth,h=viewport.clientHeight;\n      svg.setAttribute('viewBox',`0 0 ${w} ${h}`);\n      scene?.setAttribute('transform',`translate(${tx} ${ty}) scale(${scale})`);\n      syncOfficialFloorLayers();renderLabels();renderFacilities();renderVisitMarkers();navigation?.update();",
"      const w=viewport.clientWidth,h=viewport.clientHeight,viewBox=`0 0 ${w} ${h}`;\n      if(viewBox!==lastSvgViewport){svg.setAttribute('viewBox',viewBox);lastSvgViewport=viewBox;}\n      scene?.setAttribute('transform',`translate(${tx} ${ty}) scale(${scale})`);\n      renderLabels();renderFacilities();renderVisitMarkers();navigation?.update();",
'lightweight transform frame');

app=replaceOne(app,
"      data.details=data.details||{};data.details.booths={};\n      for(const item of contentItems){",
"      data.details=data.details||{};data.details.booths={};\n      for(const item of contentItems){",
'detail setup anchor');
app=replaceOne(app,
"        data.details.booths[b.id]={...old,...extra,activities:[...new Set([...(old.activities||[]),...games])],goods:[old.goods,goods].filter(Boolean).join('\\n')};\n      }\n\n      const campusResponse=await fetch('./navigation/campus.json');",
"        data.details.booths[b.id]={...old,...extra,activities:[...new Set([...(old.activities||[]),...games])],goods:[old.goods,goods].filter(Boolean).join('\\n')};\n      }\n      visitBooths=data.booths.filter(b=>data.details.booths[b.id]);\n\n      const campusResponse=await fetch('./navigation/campus.json');",
'visit subset init');

app=replaceOne(app,
"      for(const b of data.booths)b.campus=campus.placements[b.id];for(const f of data.facilities)f.campus=campus.facilityPlacements[f.id];",
"      for(const b of data.booths){b.campus=campus.placements[b.id];if(b.campus)b.campusGeometry={...b,...b.campus,map:'campus',sourceMap:b.campus.sourceMap||b.map};}\n      for(const f of data.facilities){f.campus=campus.facilityPlacements[f.id];if(f.campus)f.campusGeometry={...f,...f.campus,map:'campus',sourceMap:f.map};}",
'precompute campus geometry');

const oldLoad=`      await Promise.all(data.maps.map(async m=>{\n        const response=await fetch(m.image);if(!response.ok)throw new Error('vector map');\n        const parsed=new DOMParser().parseFromString(await response.text(),'image/svg+xml');\n        if(parsed.querySelector('parsererror')||parsed.documentElement.localName!=='svg')throw new Error('invalid vector map');\n        vectorMaps.set(m.id,parsed.documentElement);\n      }));\n      renderFavorites();selectView('campus');$('load-status').hidden=true;registerTools();`;
const newLoad=`      const loadVectorMap=async m=>{\n        if(vectorMaps.has(m.id))return;\n        const response=await fetch(m.image);if(!response.ok)throw new Error('vector map');\n        const parsed=new DOMParser().parseFromString(await response.text(),'image/svg+xml');\n        if(parsed.querySelector('parsererror')||parsed.documentElement.localName!=='svg')throw new Error('invalid vector map');\n        vectorMaps.set(m.id,parsed.documentElement);\n      };\n      await loadVectorMap(campus);\n      renderFavorites();selectView('campus');$('load-status').hidden=true;registerTools();\n      const defer=window.requestIdleCallback?cb=>window.requestIdleCallback(cb,{timeout:2200}):cb=>setTimeout(cb,450);\n      defer(()=>{Promise.all(data.maps.filter(m=>m.id!=='campus').map(loadVectorMap)).catch(()=>{});});`;
app=replaceOne(app,oldLoad,newLoad,'lazy secondary SVG load');

write('dist/app.js',app);

// The official PDF-derived overlays are now the visible booth drawings. Remove
// the old synthetic booth rectangles/text from the current campus SVG so iOS
// does not paint hundreds of duplicate shapes underneath them.
let campus=read('dist/campus.svg');
const before=campus.length;
const boothColors=['cadfeb','eed2e3','cbdfe5','cce7da','acdce9','eedfc9'];
for(const color of boothColors){
  const re=new RegExp(`<rect[^>]*fill="#${color}"[^>]*stroke="#719095"[^>]*/>`, 'g');
  campus=campus.replace(re,'');
}
campus=campus.replace(/<g fill="#193638" font-family="Arial,sans-serif" pointer-events="none">[\s\S]*?<\/g>/,'');
write('dist/campus.svg',campus);
console.log('campus svg bytes removed:',before-campus.length);

// Prevent future campus regeneration from re-adding the duplicate synthetic
// booth artwork. Placements and routing obstacles are still generated exactly
// as before.
let build=read('scripts/build-campus.py');
build=replaceOne(build,
`svg.extend(booth_shapes);svg.append('<g fill="#193638" font-family="Arial,sans-serif" pointer-events="none">');svg.extend(booth_text);svg.append('</g>')`,
`# Booth hitboxes/placements are emitted to campus.json and app.js. The visible booth artwork comes from the official PDF overlay, so do not duplicate hundreds of synthetic SVG booth nodes here.`,
'disable duplicate campus booth artwork');
write('scripts/build-campus.py',build);

let css=read('dist/style.css');
if(!css.includes('/* mobile-runtime-opt-v1 */'))css+=`\n/* mobile-runtime-opt-v1 */\n#world,#facility-markers,#labels,#visit-markers{contain:layout paint style}.facility-markers,.labels,.visit-markers{transform:translateZ(0)}#map{will-change:contents}\n`;
write('dist/style.css',css);

let html=read('dist/index.html');
html=html.replace(/<meta name="tgs-travel-version" content="[^"]+">/,'<meta name="tgs-travel-version" content="2026.09.18.7">');
html=html.replace(/\.\/style\.css\?v=\d+/,'./style.css?v=11');
html=html.replace(/\.\/app\.js\?v=\d+/,'./app.js?v=12');
write('dist/index.html',html);

let sw=read('dist/sw.js');
sw=sw.replace(/const VERSION = '[^']+';/,"const VERSION = '2026.09.18.7';");
write('dist/sw.js',sw);

console.log('mobile runtime optimization applied');
