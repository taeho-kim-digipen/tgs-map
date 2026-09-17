const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const path=require('path');
const root=path.resolve(__dirname,'../dist')+path.sep;
const mapData=JSON.parse(fs.readFileSync(root+'map-data.json','utf8'));
async function boot(saved,withNavigation=false,contentOverride){
 let clock=0,nextTimer=1;const timers=new Map(),stored=new Map(saved?[['tgs2026-interest-booths-v1',saved]]:[]);
 class Element{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.attrs={};this.dataset={};this.style={setProperty(k,v){this[k]=v;}};this.value='';this.listeners={};this.hidden=false;this.className='';this.clientWidth=430;this.clientHeight=600;this.capture=new Set();
   this.classList={add:(...s)=>this.className=[...new Set([...this.className.split(' '),...s])].join(' '),remove:(...s)=>this.className=this.className.split(' ').filter(c=>!s.includes(c)).join(' '),contains:s=>this.className.split(' ').includes(s),toggle:(s,b)=>{if(b)this.classList.add(s);else this.classList.remove(s);}};}
  setAttribute(k,v){this.attrs[k]=String(v);if(k==='class')this.className=String(v);if(k.startsWith('data-'))this.dataset[k.slice(5)]=String(v);}
  getAttribute(k){return this.attrs[k];}
  removeAttribute(k){delete this.attrs[k];}
  hasAttribute(k){return Object.hasOwn(this.attrs,k);}
  contains(e){return e===this||this.children.some(child=>child.contains(e));}
  cloneNode(deep){const n=new Element(this.tagName);n.localName=this.localName;for(const [k,v] of Object.entries(this.attrs))n.setAttribute(k,v);if(deep)for(const c of this.children)n.append(c.cloneNode(true));return n;}
  append(...c){for(const el of c){this.children.push(el);el.parent=this;}}
  replaceChildren(...c){this.children=[];this.append(...c);}
  addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);}
  fire(k,properties={}){const event={target:this,preventDefault(){},...properties};for(const fn of this.listeners[k]||[])fn(event);}
  closest(selector){for(const sel of selector.split(',')){if(sel==='button'&&this.tagName==='button')return this;if(sel.startsWith('.')&&this.className.split(' ').includes(sel.slice(1)))return this;if(sel.startsWith('[data-')&&this.attrs[sel.slice(1,-1)]!==undefined)return this;}return this.parent?.closest(selector)||null;}
  getBoundingClientRect(){return {left:0,top:0,right:this.clientWidth,bottom:this.clientHeight,width:this.clientWidth,height:this.clientHeight};}
  setPointerCapture(id){this.capture.add(id);}hasPointerCapture(id){return this.capture.has(id);}releasePointerCapture(id){this.capture.delete(id);}
  showModal(){this.open=true;}close(){this.open=false;}blur(){}
 }
 const ids=new Map([...fs.readFileSync(root+'index.html','utf8').matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)].map(m=>{const e=new Element(m[1]);if(/\bhidden\b/.test(m[2])){e.setAttribute('hidden','');if(m[1]!=='svg')e.hidden=true;}if(m[1]==='svg')delete e.hidden;return [m[3],e];}));
 // A stable path geometry exercises edge styling; SVG hidden attributes are kept independently.
 ids.get('nav-edge-line').getTotalLength=()=>2000;
 ids.get('nav-edge-line').getPointAtLength=t=>({x:215+200*Math.sin(t/2000*2*Math.PI),y:300-285*Math.cos(t/2000*2*Math.PI)});
 const documentEvents={};
 const resizeCallbacks=[];
 const doc={importNode:e=>e.cloneNode(true),getElementById:id=>ids.get(id),createElement:t=>new Element(t),createElementNS:(_,t)=>new Element(t),addEventListener:(type,fn)=>(documentEvents[type]??=[]).push(fn),hidden:false};
 const ctx={document:doc,window:{innerWidth:430,innerHeight:932,visualViewport:{width:430,height:932,scale:1,addEventListener(){}},addEventListener(){}},navigator:{},console,atob,AbortController,ResizeObserver:class{observe(){}},requestAnimationFrame:f=>{Promise.resolve().then(f);return 1;},setTimeout:(fn,ms)=>{const id=nextTimer++;timers.set(id,{fn,at:clock+ms});return id;},clearTimeout:id=>timers.delete(id),Date:class extends Date{static now(){return clock;}},localStorage:{getItem:k=>stored.has(k)?stored.get(k):null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},DOMParser:class{parseFromString(text){const el=new Element('svg');el.localName='svg';el.setAttribute('viewBox',text.match(/viewBox="([^"]+)/)[1]);return {documentElement:el,querySelector:()=>null};}},fetch:async path=>({ok:true,json:async()=>contentOverride&&path==='./data.json'?JSON.parse(JSON.stringify(contentOverride)):JSON.parse(fs.readFileSync(root+path.replace('./','').split('?')[0],'utf8')),text:async()=>fs.readFileSync(root+path.replace('./',''),'utf8')}),Image:class{set src(v){Promise.resolve().then(()=>this.onload());}}};
 ctx.ResizeObserver=class{constructor(fn){resizeCallbacks.push(fn);}observe(){}};
 const events=()=>{const listeners={};return {addEventListener(type,fn){(listeners[type]??=[]).push(fn);},fire(type,e){for(const fn of listeners[type]||[])fn(e);}};};
 Object.assign(ctx.window,events(),{screen:{orientation:{type:'landscape-primary'}}});
 Object.assign(ctx.window.visualViewport,events());
 vm.createContext(ctx);
 let sensorReceive, sensorState={active:false,fix:null,heading:null,fresh:false,status:'idle'};
 if(withNavigation){
  vm.runInContext(fs.readFileSync(root+'navigation/core.js','utf8'),ctx);
  ctx.window.TGSNavigationSensors={createSensors:receive=>{sensorReceive=receive;return {start:()=>{sensorState.active=true;receive(sensorState);return Promise.resolve();},stop:()=>{sensorState={active:false,fix:null,heading:null,fresh:false,status:'idle'};receive(sensorState);},requestCompass:()=>Promise.resolve()};}};
  vm.runInContext(fs.readFileSync(root+'navigation/tgs-navigation.js','utf8'),ctx);
 }
 vm.runInContext(fs.readFileSync(root+'app.js','utf8'),ctx);
 await new Promise(setImmediate);await new Promise(setImmediate);
 function tick(ms){clock+=ms;for(const[id,t]of [...timers])if(t.at<=clock){timers.delete(id);t.fn();}}
 function path(id){return ids.get('map').children[0].children.find(e=>e.dataset.booth===id);}
 function pointer(type,id,target,x=100,y=100){ids.get('viewport').fire(type,{pointerId:id,pointerType:'touch',clientX:x,clientY:y,target});}
 return {ids,stored,tick,path,pointer,resize:()=>resizeCallbacks.forEach(fn=>fn()),emitSensor:value=>{sensorState={...sensorState,...value};sensorReceive(sensorState);},key:key=>(documentEvents.keydown||[]).forEach(fn=>fn({key,preventDefault(){}})),document:doc,navigator:ctx.navigator,window:ctx.window,favorites:()=>JSON.parse(stored.get('tgs2026-interest-booths-v1')||'[]')};
}
if(require.main===module)(async()=>{
 const app=await boot();app.ids.get('hall-nav').children.find(e=>e.dataset.view==='all').fire('click');assert.equal(app.ids.get('load-status').hidden,true,'map loaded');assert.equal(app.favorites().length,3,'default interests');
 assert.equal(app.ids.get('app').style.width,'430px');assert.equal(app.ids.get('app').style.height,'932px');
 assert.equal(app.ids.get('app').dataset.mode,'portrait','portrait window ignores landscape monitor orientation');
 assert.equal(app.ids.get('map').children[0].children.filter(e=>e.dataset.booth).length,160,'main booth targets');
 const target=app.path('07-S01');assert(target);
 app.pointer('pointerdown',1,target);app.tick(510);app.pointer('pointerup',1,target);assert(app.favorites().includes('07-S01'),'hold adds');assert.equal(app.ids.get('favorite-list').children.length,3);assert.equal(app.ids.get('favorite-pages').hidden,false);app.ids.get('favorites-next').fire('click');assert.equal(app.ids.get('favorite-list').children.length,1);assert.equal(app.ids.get('favorite-page').textContent,'2 / 2');
 app.pointer('pointerdown',1,target);app.tick(510);app.pointer('pointerup',1,target);assert(!app.favorites().includes('07-S01'),'hold removes');
 app.pointer('pointerdown',1,target);app.tick(200);app.pointer('pointermove',1,target,130,100);app.tick(400);app.pointer('pointerup',1,target,130,100);assert(!app.favorites().includes('07-S01'),'drag cancels hold');
 app.pointer('pointerdown',1,target);app.pointer('pointerdown',2,target,180,100);app.tick(700);app.pointer('pointerup',2,target,180,100);app.pointer('pointerup',1,target);assert(!app.favorites().includes('07-S01'),'pinch cancels hold');
 app.pointer('pointerdown',1,target);app.pointer('pointercancel',1,target);app.tick(700);assert(!app.favorites().includes('07-S01'),'cancel stops hold');
 app.pointer('pointerdown',1,target);app.tick(50);app.pointer('pointerup',1,target);app.tick(340);assert.equal(app.ids.get('detail').hidden,false,'short tap opens information');assert.equal(app.favorites().length,3,'short tap does not toggle');
 app.ids.get('hall-nav').children.find(e=>e.dataset.view==='school').fire('click');assert.equal(app.ids.get('map').children[0].children.filter(e=>e.dataset.booth).length,67,'school booth targets');
 const school=app.path('01-N01');app.pointer('pointerdown',1,school);app.tick(510);app.pointer('pointerup',1,school);assert(app.favorites().includes('01-N01'),'school hold works');
 const empty=await boot('[]');assert.equal(empty.ids.get('favorite-count').textContent,'0','empty saved list stays empty');
 const restored=await boot(JSON.stringify(app.favorites()));assert.equal(restored.ids.get('favorite-count').textContent,'4','saved list restores');
 const content=e=>[e.textContent,...e.children.map(content)].filter(Boolean).join(' ');
 const search=q=>{app.ids.get('booth-search').value=q;app.ids.get('booth-search').fire('input');return content(app.ids.get('results-list'));};
 assert.match(search('넥슨'),/07-C04/,'Korean name search');
 assert.match(search('7-c4'),/NEXON/,'relaxed booth number search');assert.equal(app.ids.get('results-list').children.length,1);
 app.ids.get('results-list').children[0].fire('click');assert.match(content(app.ids.get('detail')),/07-C04/);assert.equal(app.ids.get('search-results').hidden,true);
 assert.match(search('엔씨'),/Astrae Oratio/);assert.match(search('bandai'),/05-N01/);
 assert.match(search('보조배터리'),/Charge SPOT/);app.ids.get('results-list').children[0].fire('click');assert.match(app.ids.get('map-floor').textContent,/2F/);assert.match(content(app.ids.get('detail')),/Charge SPOT/);assert.equal(app.ids.get('map').children[0].children.filter(e=>e.dataset.booth).length,0,'facility floor has no invented booths');
 assert.match(search('impossible-no-matching-booth'),/없습니다/);assert.match(search('--'),/없습니다/);
 app.ids.get('facility-nav').children[1].fire('click');assert.equal(app.ids.get('results-list').children.length,5,'all five lockers');
 app.ids.get('facility-nav').children[0].fire('click');assert.equal(app.ids.get('results-list').children.length,4,'entrance and exit conditions');
 app.ids.get('results-list').children[0].fire('click');assert.match(content(app.ids.get('detail')),/9:30–10:00/);
 assert.match(search('07'),/07/);assert.equal(app.ids.get('results-list').children.length,5);app.ids.get('results-next').fire('click');assert.match(app.ids.get('results-page').textContent,/2 \/ /,'results page navigation');
 app.ids.get('close-results').fire('click');assert.equal(app.ids.get('booth-search').value,'');app.ids.get('booth-search').fire('keydown',{key:'Enter'});assert.equal(app.ids.get('search-results').hidden,true,'empty enter does not reopen previous results');
 const mode=app.ids.get('display-mode'),frame=app.ids.get('app');
 app.window.visualViewport.height=320;app.window.visualViewport.fire('resize');
 assert.equal(frame.dataset.mode,'portrait','keyboard changes visible height without changing portrait layout');assert.equal(frame.style.height,'320px');assert.equal(frame.style.transform,'none');
 mode.value='landscape';mode.fire('change');assert.equal(frame.style.width,'320px');assert.equal(frame.style.height,'430px');assert.match(frame.style.transform,/rotate\(90deg\)/,'forced landscape still rotates while keyboard is open');
 app.window.visualViewport.height=932;app.window.visualViewport.fire('resize');
 mode.value='landscape';mode.fire('change');assert.equal(frame.dataset.mode,'landscape');assert.equal(frame.style.width,'932px');assert.equal(frame.style.height,'430px');assert.match(frame.style.transform,/rotate\(90deg\)/);assert.equal(app.stored.get('tgs2026-screen-mode'),'landscape');
 mode.value='portrait';mode.fire('change');assert.equal(frame.style.width,'430px');assert.equal(frame.style.height,'932px');assert.equal(frame.style.transform,'none');
 mode.value='pc';mode.fire('change');assert.equal(frame.dataset.mode,'pc');assert.equal(frame.style.width,'1100px');assert.match(frame.style.transform,/scale/);
 app.window.innerWidth=932;app.window.innerHeight=430;app.window.visualViewport.width=932;app.window.visualViewport.height=430;
 app.window.screen.orientation.type='portrait-primary';
 mode.value='auto';mode.fire('change');assert.equal(frame.dataset.mode,'landscape');assert.equal(frame.style.width,'932px');assert.equal(frame.style.height,'430px');assert.equal(frame.style.transform,'none');
 app.window.visualViewport.height=240;app.window.visualViewport.fire('resize');assert.equal(frame.dataset.mode,'landscape','landscape window ignores portrait monitor and keyboard height');assert.equal(frame.style.height,'240px');assert.equal(frame.style.transform,'none');
 app.window.visualViewport.height=430;app.window.visualViewport.fire('resize');
 mode.value='portrait';mode.fire('change');assert.equal(frame.style.width,'430px');assert.equal(frame.style.height,'932px');assert.match(frame.style.transform,/rotate\(-90deg\)/);
 app.window.innerWidth=1440;app.window.innerHeight=900;app.window.visualViewport.width=1440;app.window.visualViewport.height=900;mode.value='auto';mode.fire('change');assert.equal(frame.dataset.mode,'pc');assert.equal(frame.style.width,'1440px');assert.equal(frame.style.height,'900px');assert.equal(frame.style.transform,'scale(1)');
 // New official maps share the same hold, search, detail and fit interactions.
 for(const [view,count] of [['halls911',151],['indie9',36],['selected80',79],['business9',64]]){
  app.ids.get('hall-nav').children.find(e=>e.dataset.view===view).fire('click');
  assert.equal(app.ids.get('map').children[0].children.filter(e=>e.dataset.booth).length,count,view);
  app.ids.get('fit').fire('click');assert.equal(app.ids.get('map').children[0].children.filter(e=>e.dataset.booth).length,count,'fit keeps current map');
 }
 assert.match(search('E2'),/E-02/);app.ids.get('results-list').children[0].fire('click');
 assert.match(content(app.ids.get('detail')),/SELECTED INDIE 80/);assert.match(content(app.ids.get('detail')),/시연 미확인/);
 assert.doesNotMatch(content(app.ids.get('detail')),/시연 없음/,'unknown is not no');
 const indie=app.path('E-02');app.pointer('pointerdown',1,indie);app.tick(501);app.pointer('pointerup',1,indie);assert(app.favorites().includes('E-02'));
 assert((await boot(JSON.stringify(app.favorites()))).favorites().includes('E-02'),'new-hall interests restore with existing key');
 search('05-N01');app.ids.get('results-list').children[0].fire('click');
 assert.match(content(app.ids.get('detail')),/일부 정리권/);assert.match(content(app.ids.get('detail')),/굿즈·배포 특전/);
 const related=app.ids.get('detail').children.flatMap(e=>e.children).find(e=>e.className==='related-booth');assert(related);related.fire('click');
 assert.match(content(app.ids.get('detail')),/11-W17/);assert.match(content(app.ids.get('detail')),/판매 있음/);
 assert.match(search('ACE COMBAT'),/05-N01/,'exhibit title search');
 app.ids.get('results-list').children[0].fire('click');
 const filter=app.ids.get('visit-filter');filter.value='ticket';filter.fire('change');
 assert(!app.path('05-N01').className.includes('visit-muted'));assert(app.path('07-C04').className.includes('visit-muted'));
 assert(app.path('07-C04').className.includes('selected'),'filter preserves interest state');
 assert(app.ids.get('visit-markers').children.every(e=>e.children.every(b=>b.children[0].tagName==='svg')),'map markers use vector icons');
 filter.value='off';filter.fire('change');assert.equal(app.ids.get('visit-markers').children.length,0);
 const phone=await boot();phone.navigator.standalone=true;phone.window.visualViewport.height=839;phone.window.visualViewport.fire('resize');
 assert.equal(phone.ids.get('app').style.height,'100dvh','standalone height follows CSS viewport, not a stale pixel reading');
 assert.equal(phone.ids.get('app').style.width,'100%');
 phone.window.innerHeight=760;phone.window.visualViewport.height=740;phone.window.visualViewport.fire('resize');assert.equal(phone.ids.get('app').style.height,'100dvh','stale standalone JS readings cannot shrink CSS viewport');
 phone.document.activeElement={tagName:'INPUT'};phone.window.visualViewport.height=450;phone.window.visualViewport.fire('resize');
 assert.equal(phone.ids.get('app').style.height,'450px','standalone keyboard still fits visible space');
 const maps=new Map(mapData.maps.map(m=>[m.id,m]));assert.equal(new Set(mapData.booths.map(b=>b.id)).size,557);
 for(const b of mapData.booths){const m=maps.get(b.map),[x0,y0,x1,y1]=b.bounds;assert(x0>=0&&y0>=0&&x1<=m.width&&y1<=m.height&&x1>x0&&y1>y0,b.id);}
 for(const f of mapData.facilities){const m=maps.get(f.map);assert(f.x>=0&&f.y>=0&&f.x<=m.width&&f.y<=m.height,f.id);}
 assert.equal(mapData.facilities.length,68);
 console.log('PASS: 557 official booth bounds; 68 facility bounds; 7 maps; holds, saved interests, search, facilities, sourced details, filters and icons; portrait/landscape/PC sizing and standalone keyboard recovery. Simulated DOM only.');
})().catch(e=>{console.error(e);process.exitCode=1;});

module.exports={boot};
