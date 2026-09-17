'use strict';
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const write=(p,s)=>fs.writeFileSync(path.join(root,p),s);
function repl(text,from,to,label){if(!text.includes(from))throw new Error('missing patch target: '+label);return text.replace(from,to);}

// Force 1F -> 2F movement through the official stair openings only.
let py=read('scripts/build-campus.py');
py=repl(py,
`stairs=[]\nfor p in REG['mainStairs']:\n q=xy(main_transform,p)\n end=[q[0],OY-77.8];walk.append(LineString([q,end]).buffer(2.3));stairs.append({'x':q[0],'y':(q[1]+end[1])/2,'label':'1F ↔ 2F'})\nfor id in REG['walkingWayIds']:walk.append(LineString(ways[id]['points']).buffer(2.5))`,
`stairs=[];main_stair_xs=[]\nfor p in REG['mainStairs']:\n q=xy(main_transform,p)\n end=[q[0],OY-77.8];walk.append(LineString([q,end]).buffer(2.3));stairs.append({'x':q[0],'y':(q[1]+end[1])/2,'label':'1F ↔ 2F'});main_stair_xs.append(q[0])\n# The south edge of Halls 1-8 is 1F. The Central Mall immediately outside is 2F.\n# Keep a solid floor boundary between them and punch holes ONLY at the official TO-2F stairs.\n# This prevents A* from stepping straight from a 1F aisle onto the 2F bridge.\nmain_edge_y=main_target[3]\ntransition_barrier=box(main_target[0]-2,main_edge_y-1.5,main_target[2]+2,OY-80.0)\nstair_openings=unary_union([box(x-2.8,main_edge_y-3,x+2.8,OY-76.5) for x in main_stair_xs])\nblocked.append(transition_barrier.difference(stair_openings))\nfor id in REG['walkingWayIds']:walk.append(LineString(ways[id]['points']).buffer(2.5))`,
'1F/2F stair barrier');
write('scripts/build-campus.py',py);

// Draw explicit stair/floor-change markers on any route that crosses a floor connector.
let nav=read('dist/navigation/tgs-navigation.js');
nav=repl(nav,
`    const d=points.map((p,i)=>\`${'${i?\'L\':\'M\'}'}${'${p.x.toFixed(2)}'} ${'${p.y.toFixed(2)}'}\`).join(' ');\n    $('nav-route-halo').setAttribute('d',d);$('nav-route-line').setAttribute('d',d);\n    const p=origin?.mapId===config.mapId()?config.toScreen(origin):null,marker=$('nav-position');`,
`    const d=points.map((p,i)=>\`${'${i?\'L\':\'M\'}'}${'${p.x.toFixed(2)}'} ${'${p.y.toFixed(2)}'}\`).join(' ');\n    $('nav-route-halo').setAttribute('d',d);$('nav-route-line').setAttribute('d',d);\n    let transitions=$('nav-transitions');\n    if(!transitions){transitions=document.createElementNS('http://www.w3.org/2000/svg','g');transitions.id='nav-transitions';overlay.append(transitions);}\n    transitions.replaceChildren();\n    if(route&&target?.map==='campus'&&config.mapId()==='campus'&&Array.isArray(campus?.stairs)){\n      const segmentDistance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy;if(!l)return Math.hypot(p.x-a.x,p.y-a.y);const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)),x=a.x+t*dx,y=a.y+t*dy;return Math.hypot(p.x-x,p.y-y);};\n      for(const stair of campus.stairs){\n        let used=false;for(let i=1;i<route.line.length;i++)if(segmentDistance(stair,route.line[i-1],route.line[i])<4.2){used=true;break;}\n        if(!used)continue;\n        const q=config.toScreen(stair),g=document.createElementNS('http://www.w3.org/2000/svg','g');g.setAttribute('transform',\`translate(${'${q.x}'} ${'${q.y}'})\`);g.setAttribute('pointer-events','none');\n        const c=document.createElementNS('http://www.w3.org/2000/svg','circle');c.setAttribute('r','17');c.setAttribute('fill','#fff');c.setAttribute('stroke','#7c3aed');c.setAttribute('stroke-width','4');\n        const icon=document.createElementNS('http://www.w3.org/2000/svg','text');icon.setAttribute('text-anchor','middle');icon.setAttribute('y','6');icon.setAttribute('font-size','19');icon.setAttribute('font-weight','900');icon.setAttribute('fill','#5b21b6');icon.textContent='↕';\n        const label=document.createElementNS('http://www.w3.org/2000/svg','text');label.setAttribute('text-anchor','middle');label.setAttribute('y','35');label.setAttribute('font-size','12');label.setAttribute('font-weight','800');label.setAttribute('paint-order','stroke');label.setAttribute('stroke','#fff');label.setAttribute('stroke-width','4');label.setAttribute('fill','#4c1d95');label.textContent='계단 · 층 이동';\n        g.append(c,icon,label);transitions.append(g);\n      }\n    }\n    const p=origin?.mapId===config.mapId()?config.toScreen(origin):null,marker=$('nav-position');`,
'floor transition markers');
write('dist/navigation/tgs-navigation.js',nav);

let html=read('dist/index.html');
html=html.replace(/meta name="tgs-travel-version" content="[^"]+"/,'meta name="tgs-travel-version" content="2026.09.18.8"');
html=html.replace(/\.\/navigation\/tgs-navigation\.js\?v=\d+/,'./navigation/tgs-navigation.js?v=9');
write('dist/index.html',html);
let sw=read('dist/sw.js');sw=sw.replace(/const VERSION = '[^']+';/,"const VERSION = '2026.09.18.8';");write('dist/sw.js',sw);
console.log('patched floor-aware routing + stair transition markers');
