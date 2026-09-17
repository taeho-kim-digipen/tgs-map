'use strict';

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

function read(rel){ return fs.readFileSync(path.join(root, rel), 'utf8'); }
function write(rel, text){ fs.writeFileSync(path.join(root, rel), text); }
function replaceOne(text, from, to, label){
  if (!text.includes(from)) throw new Error(`patch target not found: ${label}`);
  return text.replace(from, to);
}

// 1) Re-register every Hall 1-8 booth/facility to the SAME transform used by
// the full official main-floor SVG. Previously booth hitboxes used three
// independently stretched panel transforms while the visible map used one
// continuous transform, so boxes drifted left/right across the halls.
let py = read('scripts/build-campus.py');
py = replaceOne(py,
`transforms={id:p['transform']for id,p in panels.items()}\nfor p in REG['insets']:transforms[p['map']]=transform(p['from'],rect(transforms[p['parent']],p['to']))`,
`transforms={id:p['transform']for id,p in panels.items()}\ndef envelope(rects):return [min(r[0] for r in rects),min(r[1] for r in rects),max(r[2] for r in rects),max(r[3] for r in rects)]\nmain_panels=[p for p in REG['panels'] if p['map']=='main']\nmain_source=envelope([p['from'] for p in main_panels])\nmain_target=envelope([rect(transforms[p['id']],p['from']) for p in main_panels])\nmain_transform=transform(main_source,main_target)\nconcourse_map=next(m for m in D['maps'] if m['id']=='concourse')\nconcourse_source=[main_source[0],0,main_source[2],concourse_map['height']]\nconcourse_target=[main_target[0],OY-87,main_target[2],OY-87+concourse_map['height']*.72]\nconcourse_transform=transform(concourse_source,concourse_target)\nfor p in REG['insets']:transforms[p['map']]=transform(p['from'],rect(transforms[p['parent']],p['to']))`,
'global main transform');

py = replaceOne(py,
`def for_booth(b):\n if b['map']=='main':return transforms['main78' if b['hall']>=7 else 'main46' if b['hall']>=4 else 'main13']\n return transforms[b['map']]`,
`def for_booth(b):\n if b['map']=='main':return main_transform\n return transforms[b['map']]`,
'booth transform');

py = replaceOne(py,
`for id,p in panels.items():\n t=p['transform'];src=p['from']\n # The 9–11 ground lobby lies west of the exhibition floor, separately from 2F esplanade.\n if id=='halls911':src=[42,14,205,683]\n walk.append(box(*rect(t,src)))`,
`for id,p in panels.items():\n t=main_transform if p['map']=='main' else p['transform'];src=p['from']\n # The 9–11 ground lobby lies west of the exhibition floor, separately from 2F esplanade.\n if id=='halls911':src=[42,14,205,683]\n walk.append(box(*rect(t,src)))`,
'walk panel transform');

py = replaceOne(py,
`for left,right in [('main78','main46'),('main46','main13')]:\n for a,b in [(47,55),(97,105),(145,153)]:\n  y0=xy(transforms[left],[0,a])[1];y1=xy(transforms[left],[0,b])[1]\n  walk.append(box(panels[left]['to'][2]+OX-.5,y0,panels[right]['to'][0]+OX+.5,y1))`,
`for left,right in [('main78','main46'),('main46','main13')]:\n lrect=rect(main_transform,panels[left]['from']);rrect=rect(main_transform,panels[right]['from'])\n for a,b in [(47,55),(97,105),(145,153)]:\n  y0=xy(main_transform,[0,a])[1];y1=xy(main_transform,[0,b])[1]\n  walk.append(box(lrect[2]-.5,y0,rrect[0]+.5,y1))`,
'cross passages');

py = replaceOne(py,
`blocked.append(box(*rect(transforms['main13'],[803,32,906,73])))`,
`blocked.append(box(*rect(main_transform,[803,32,906,73])))`,
'stage transform');

py = replaceOne(py,
`for p in REG['mainStairs']:\n id='main78' if p[0]<240 else 'main46' if p[0]<580 else 'main13';q=xy(transforms[id],p)`,
`for p in REG['mainStairs']:\n q=xy(main_transform,p)`,
'main stairs transform');

py = replaceOne(py,
`for f in D['facilities']:\n if f['map'] in ['main','concourse']:\n  t=transforms['main78' if f['x']<245 else 'main46' if f['x']<580 else 'main13'];p=xy(t,[f['x'],f['y']])\n  if f['map']=='concourse':p[1]=OY-87+f['y']*.72\n elif f['map'] in transforms:p=xy(transforms[f['map']],[f['x'],f['y']])\n else:continue`,
`for f in D['facilities']:\n if f['map']=='main':p=xy(main_transform,[f['x'],f['y']])\n elif f['map']=='concourse':p=xy(concourse_transform,[f['x'],f['y']])\n elif f['map'] in transforms:p=xy(transforms[f['map']],[f['x'],f['y']])\n else:continue`,
'facility transforms');
write('scripts/build-campus.py', py);

// 2) Tap = select/location only. Details open ONLY through the small "보기" card.
let app = read('dist/app.js');
app = replaceOne(app,
`    if (focused===id) showDetail(id);`,
`    if(focused===id){if($('detail').hidden)renderBoothPeek(id);else showDetail(id);}`,
'toggle refresh');

app = replaceOne(app,
`    fitBounds([cx-bw/2,cy-bh/2,cx+bw/2,cy+bh/2],55);showDetail(id);\n  }\n  function showDetail(id) {`,
`    fitBounds([cx-bw/2,cy-bh/2,cx+bw/2,cy+bh/2],55);selectBooth(id);\n  }\n  function ensureBoothPeek(){\n    let card=$('booth-peek');if(card)return card;\n    card=document.createElement('section');card.id='booth-peek';card.className='booth-peek';card.hidden=true;card.setAttribute('aria-live','polite');viewport.append(card);return card;\n  }\n  function hideBoothPeek(){const card=$('booth-peek');if(card)card.hidden=true;}\n  function renderBoothPeek(id){\n    const b=byId.get(id);if(!b)return;const card=ensureBoothPeek();card.replaceChildren();\n    const info=document.createElement('div');info.className='booth-peek-info';\n    const title=document.createElement('strong');title.textContent=nameOf(b);\n    const meta=document.createElement('small');meta.textContent=\`${'${locationOf(b)}'} · ${'${b.code}'}\`;info.append(title,meta);\n    const open=document.createElement('button');open.type='button';open.className='booth-peek-open';open.textContent='보기';open.setAttribute('aria-label',\`${'${nameOf(b)}'} 상세정보 보기\`);open.addEventListener('click',()=>showDetail(id));\n    card.append(info,open);card.hidden=false;\n  }\n  function selectBooth(id){\n    const b=byId.get(id);if(!b)return;focused=id;$('detail').hidden=true;renderBoothPeek(id);updateSelection();\n  }\n  function showDetail(id) {`,
'focus/select flow');

app = replaceOne(app,
`    const b=byId.get(id);if(!b)return;focused=id;const panel=$('detail');panel.replaceChildren();`,
`    const b=byId.get(id);if(!b)return;focused=id;hideBoothPeek();const panel=$('detail');panel.replaceChildren();`,
'hide peek on detail');

app = replaceOne(app,
`close.addEventListener('click',closeDetail);head.append(info,close);panel.append(head);`,
`close.addEventListener('click',()=>selectBooth(id));head.append(info,close);panel.append(head);`,
'detail close returns to peek');

app = replaceOne(app,
`  function closeDetail(){focused=null;$('detail').hidden=true;updateSelection();}`,
`  function closeDetail(){focused=null;$('detail').hidden=true;hideBoothPeek();updateSelection();}`,
'clear selection');

app = replaceOne(app,
`    if(e.target.closest('button,a,input,select,summary,.detail,.zoom-controls,.search-results,.nav-card'))return;`,
`    if(e.target.closest('button,a,input,select,summary,.detail,.booth-peek,.zoom-controls,.search-results,.nav-card'))return;`,
'peek pointer guard');

app = replaceOne(app,
`    if(g.id)singleTapTimer=setTimeout(()=>{if(!navigation?.isActive())showDetail(g.id);},330);else closeDetail();`,
`    if(g.id)singleTapTimer=setTimeout(()=>{if(!navigation?.isActive())selectBooth(g.id);},330);else closeDetail();`,
'single tap selection');

write('dist/app.js', app);

// 3) Compact selection card styling. It sits above the bottom map controls so the booth stays visible.
let css = read('dist/style.css');
if(!css.includes('/* booth-peek-v1 */')) css += `\n/* booth-peek-v1 */\n.booth-peek{position:absolute;left:50%;bottom:74px;transform:translateX(-50%);z-index:11;width:min(330px,calc(100% - 150px));min-height:52px;padding:8px 9px 8px 12px;display:flex;align-items:center;gap:10px;background:#fff;border:1px solid #cbd7d0;border-radius:10px;box-shadow:0 5px 20px #17352d2b;pointer-events:auto}.booth-peek[hidden]{display:none}.booth-peek-info{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}.booth-peek-info strong{font-size:14px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.booth-peek-info small{font-size:12px;color:#64786d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.booth-peek-open{flex:0 0 auto;min-width:58px;min-height:38px;border:0;border-radius:7px;background:#263d40;color:#fff;font-weight:750}.booth.focused{fill:#1687ff1c;stroke:#087cff;stroke-width:3;stroke-dasharray:none;vector-effect:non-scaling-stroke}.booth.focused.selected{stroke:#087cff}\n@media(max-height:520px) and (orientation:landscape){.booth-peek{bottom:48px;width:min(300px,calc(100% - 120px));min-height:44px;padding:6px 7px 6px 10px}.booth-peek-open{min-height:34px}}\n`;
write('dist/style.css', css);

// 4) New cache/version so iPhone Safari cannot keep the old tap behavior or old campus geometry.
let html = read('dist/index.html');
html = html.replace(/<meta name="tgs-travel-version" content="[^"]+">/, '<meta name="tgs-travel-version" content="2026.09.18.4">');
html = html.replace(/\.\/style\.css\?v=\d+/, './style.css?v=9');
html = html.replace(/\.\/app\.js\?v=\d+/, './app.js?v=10');
html = html.replace('짧게 누르면 부스 정보가 나옵니다. 부스를 두 번 누르면 경로 안내, 같은 부스를 다시 두 번 누르면 안내가 해제됩니다.','짧게 누르면 부스 위치만 선택됩니다. 선택 후 작은 카드의 <b>보기</b>를 눌러야 상세 정보가 열립니다. 부스를 두 번 누르면 경로 안내, 같은 부스를 다시 두 번 누르면 안내가 해제됩니다.');
write('dist/index.html', html);

let sw = read('dist/sw.js');
sw = sw.replace(/const VERSION = '[^']+';/, "const VERSION = '2026.09.18.4';");
write('dist/sw.js', sw);

console.log('patched booth alignment, selection-only tap flow, and cache version');
