'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const appPath=path.join(root,'dist','app.js');
const htmlPath=path.join(root,'dist','index.html');
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
app=mustReplace(app,
  '  let scene, floorOverlayLayer, favoritePage=0;',
  '  let scene, favoritePage=0;',
  'floor overlay state');

app=mustReplace(app,
/  function renderFloorOverlay\(\)\{[\s\S]*?\n  \}\n  function setFloorMode/,
`  function syncOfficialFloorLayers(){
    if(activeMap?.id!=='campus'||!scene)return;
    const first=scene.querySelector('#official-1f-overlay');
    const second=scene.querySelector('#official-2f-overlay');
    if(first){if(floorMode==='2f')first.setAttribute('display','none');else first.removeAttribute('display');}
    if(second){if(floorMode==='2f')second.removeAttribute('display');else second.setAttribute('display','none');}
  }
  function setFloorMode`,
  'replace floor masks with real layers');

app=mustReplace(app,
`    syncFloorSwitchUI();
    updateSelection();
    renderTransform();`,
`    syncFloorSwitchUI();
    syncOfficialFloorLayers();
    updateSelection();
    renderTransform();`,
  'set floor mode');

app=mustReplace(app,
  '      renderFloorOverlay();renderLabels();renderFacilities();renderVisitMarkers();navigation?.update();',
  '      syncOfficialFloorLayers();renderLabels();renderFacilities();renderVisitMarkers();navigation?.update();',
  'transform floor sync');

app=mustReplace(app,
  "    floorOverlayLayer=svgEl('g',{'data-layer':'floor-overlay'});scene.append(floorOverlayLayer);\n",
  '',
  'remove mask layer');

app=mustReplace(app,
  '    syncFloorSwitchUI();updateSelection();renderFloorOverlay();navigation?.mapChanged();',
  '    syncFloorSwitchUI();syncOfficialFloorLayers();updateSelection();navigation?.mapChanged();',
  'set map floor sync');

if(app.includes('floorOverlayLayer')||app.includes('renderFloorOverlay'))throw new Error('old mask implementation remains');
if(!app.includes("scene.querySelector('#official-1f-overlay')")||!app.includes("scene.querySelector('#official-2f-overlay')"))throw new Error('real floor layer switch missing');
fs.writeFileSync(appPath,app);

let html=fs.readFileSync(htmlPath,'utf8');
html=html.replace(/meta name="tgs-travel-version" content="[^"]+"/,'meta name="tgs-travel-version" content="2026.09.18.3"');
html=html.replace('./app.js?v=8','./app.js?v=9');
fs.writeFileSync(htmlPath,html);

let sw=fs.readFileSync(swPath,'utf8');
sw=sw.replace(/const VERSION = '[^']+';/,"const VERSION = '2026.09.18.3';");
fs.writeFileSync(swPath,sw);
console.log('real 1F/2F SVG layer switching applied');
