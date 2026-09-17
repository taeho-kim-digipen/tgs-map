const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const N=require('../dist/navigation/core.js'),{boot}=require('./check-interactions.cjs');
const data=require('../dist/map-data.json'),spec=require('../dist/navigation/walkable.json');
const flush=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
const close=(a,b)=>assert(Math.abs(a-b)<1e-5,`${a} != ${b}`);

async function check(){
  // A wall forces a detour; diagonal touching corners are not passages.
  const walls=[[8,0,10,16],[16,6,19,10]],g=N.makeGrid({width:24,height:24,cell:1,clearance:0,walkable:[[0,0,24,24]],obstacles:walls});
  const route=N.routeToBooth(g,{x:3.5,y:3.5},walls[1]);
  assert(route.line.some(p=>p.y>=16),'route detours around wall');
  for(let i=1;i<route.cellPath.length;i++)assert(N.visible(g,route.cellPath[i-1],route.cellPath[i]),'smoothed segment stays inside free cells');
  assert.throws(()=>N.routeToBooth(N.makeGrid({width:24,height:24,cell:1,clearance:0,walkable:[[0,0,24,24]],obstacles:[[8,0,10,24],walls[1]]}),{x:3.5,y:3.5},walls[1]),/no-path/);
  assert.throws(()=>N.routeToBooth(g,{x:-1,y:5},walls[1]),/outside/);
  const corner=N.makeGrid({width:2,height:2,cell:1,clearance:0,walkable:[[0,0,1,1],[1,1,2,2]]});assert(!N.visible(corner,0,3));
  // A route must reach each actual booth's outside edge and never cut a booth.
  let checked=0;
  for(const m of process.argv.includes('--interactions-only')?[]:data.maps){
    const s=spec.maps[m.id];if(!s)continue;const booths=data.booths.filter(b=>b.map===m.id);
    const grid=N.makeGrid({...s,width:m.width,height:m.height,obstacles:[...s.obstacles,...booths.map(b=>b.bounds)]});
    const origin=N.point(grid,grid.allowed.indexOf(1));
    for(const b of booths){const r=N.routeToBooth(grid,origin,b.bounds);for(let i=1;i<r.cellPath.length;i++)assert(N.visible(grid,r.cellPath[i-1],r.cellPath[i]),b.id);const p=r.line.at(-1);assert(!(p.x>b.bounds[0]&&p.x<b.bounds[2]&&p.y>b.bounds[1]&&p.y<b.bounds[3]),b.id+' ends inside booth');checked++;}
  }
  if(!process.argv.includes('--interactions-only'))assert.equal(checked,557);
  // Real campus registration and inter-hall path use the bridge, never blocked cells.
  const campus=require('../dist/navigation/campus.json'),cg=N.makeGrid(require('../dist/navigation/campus-grid.json'));
  const cp=N.point(cg,N.snap(cg,{x:100,y:100},20));
  const registered=N.locate(campus.geo.origin,campus.geo);close(registered.x,430);close(registered.y,250);
  for(const id of ['07-C04','11-W17','09-C55','E-02']){
    const r=N.routeToBooth(cg,cp,campus.placements[id].bounds);
    for(let j=1;j<r.cellPath.length;j++)assert(N.visible(cg,r.cellPath[j-1],r.cellPath[j]),'campus wall crossing '+id);
    if(id!=='07-C04')assert(r.line.some(p=>p.y>campus.bridgeBounds[1]&&p.y<campus.bridgeBounds[3]),'missing bridge '+id);
  }
  assert.equal(N.campusRestricted(Date.parse('2026-09-19T00:59:00Z')),true);assert.equal(N.campusRestricted(Date.parse('2026-09-19T01:00:00Z')),false);assert.equal(N.campusRestricted(Date.parse('2026-09-18T00:30:00Z')),false);
  assert.equal(N.proximity(150).color,'#ff3b30');assert.equal(N.proximity(31).color,'#ff9500');assert.equal(N.proximity(30).color,'#34c759');
  close(N.proximity(10000).fraction,.08);close(N.proximity(0).fraction,.55);assert(N.proximity(50).fraction>N.proximity(100).fraction);
  assert.equal(N.compass({alpha:10,absolute:false}),null);assert.equal(N.compass({webkitCompassHeading:350},90),80);assert.equal(N.compass({webkitCompassHeading:0,webkitCompassAccuracy:80}),null);
  const a={x:40,y:80,fix:{latitude:35,longitude:140,accuracy:2}},b={x:140,y:80,fix:{latitude:35,longitude:140.001,accuracy:2}};
  const c=N.calibration(a,b);const mapped=N.locate(b.fix,c);close(mapped.x,140);close(mapped.y,80);close(N.headingOnMap(90,c),90);
  const turned=N.calibration(a,{...b,x:40,y:180});close(N.headingOnMap(0,turned),90);
  assert.throws(()=>N.calibration(a,{...a,x:41}),/calibration-short/);
  assert.throws(()=>N.calibration(a,{...b,fix:{...b.fix,accuracy:100}}),/calibration-fix/);
  assert(!N.validFix({coords:{latitude:NaN,longitude:140,accuracy:1},timestamp:Date.now()}));
  assert(!N.validFix({coords:{latitude:35,longitude:140,accuracy:1},timestamp:Date.now()-60000}));

  // Sensor permission is requested in the user event; hidden / stopped streams cannot update.
  let now=100000,receive,receiveError,changes=[],requests=0,cleared=0;const listeners={},documentListeners={};
  const env={TGSNavigation:N,isSecureContext:true,screen:{orientation:{angle:90}},document:{hidden:false,addEventListener:(k,f)=>documentListeners[k]=f},navigator:{geolocation:{watchPosition:(ok,error,options)=>{receive=ok;receiveError=error;assert.equal(options.maximumAge,0);return 7;},clearWatch:()=>cleared++}},DeviceOrientationEvent:{requestPermission:()=>{requests++;return Promise.resolve('granted');}},addEventListener:(k,f)=>listeners[k]=f,removeEventListener:k=>delete listeners[k],setInterval:()=>9,clearInterval(){}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/navigation/sensors.js'),'utf8'),{window:env,Date:class extends Date{static now(){return now;}},Promise});
  const sensors=env.TGSNavigationSensors.createSensors(s=>changes.push(s),env);const start=sensors.start();assert.equal(requests,1);await start;
  // Core validation uses its own clock, so only use a currently valid fix here.
  now=Date.now();receive({coords:{latitude:35,longitude:140,accuracy:5},timestamp:now});assert.equal(changes.at(-1).fresh,true);
  listeners.deviceorientation({webkitCompassHeading:350});assert.equal(changes.at(-1).heading,80);
  env.document.hidden=true;documentListeners.visibilitychange();assert.equal(changes.at(-1).fresh,false);const oldReceive=receive;
  oldReceive({coords:{latitude:34,longitude:139,accuracy:1},timestamp:now+1});assert.equal(changes.at(-1).fix.latitude,35);
  env.document.hidden=false;documentListeners.visibilitychange();receiveError({code:1});assert.equal(changes.at(-1).status,'denied');assert.equal(changes.at(-1).fix,null);sensors.stop();assert(cleared>0);

  // Run the real app, adapter and core together using a simulated DOM.
  const app=await boot(undefined,true);await flush();
  const tap=(id,p)=>{const node=id?app.path(id):app.ids.get('map');app.pointer('pointerdown',1,node,p?.x,p?.y);app.tick(40);app.pointer('pointerup',1,node,p?.x,p?.y);};
  const double=id=>{tap(id);app.tick(90);tap(id);};
  double('07-S01');await flush();assert.equal(app.ids.get('nav-card').hidden,false,'double booth starts navigation');assert(app.ids.get('app').classList.contains('navigation-active'));
  assert.equal(app.ids.get('detail').hidden,true,'no ordinary details while guiding');assert.equal(app.ids.get('nav-name').textContent,'캡콤');
  app.tick(400);tap();app.tick(90);tap();await flush();assert.equal(app.ids.get('nav-name').textContent,'캡콤','background never changes destination');
  app.ids.get('nav-locate').fire('click');
  const scene=app.ids.get('map').children[0],t=scene.getAttribute('transform').match(/translate\(([-.\d]+) ([-.\d]+)\) scale\(([-.\d]+)\)/).slice(1).map(Number);
  const campusGrid=N.makeGrid(require('../dist/navigation/campus-grid.json')),startPoint=N.point(campusGrid,N.snap(campusGrid,{x:100,y:100},20));
  tap(null,{x:t[0]+startPoint.x*t[2],y:t[1]+startPoint.y*t[2]});await flush();
  assert(app.ids.get('nav-route-line').getAttribute('d').startsWith('M'),'route appears after current location placement');
  assert.equal(app.ids.get('nav-edge').hasAttribute('hidden'),false,'real SVG hidden attribute removed for route');
  assert.match(app.ids.get('nav-edge-line').style.stroke,/^#/,'edge color actually rendered');
  assert.equal(app.ids.get('nav-arrow').style.display,'none','no false heading before calibration');
  double('07-C04');await flush();assert.equal(app.ids.get('nav-name').textContent,'넥슨','different booth switches destination');
  double('07-C04');await flush();assert.equal(app.ids.get('nav-card').hidden,true,'same booth toggles guidance off');assert.equal(app.ids.get('nav-route-line').getAttribute('d'),'');assert(!app.ids.get('app').classList.contains('navigation-active'));
  app.tick(400);double('07-S01');await flush();app.key('Escape');await flush();assert.equal(app.ids.get('nav-card').hidden,true,'keyboard exit works');
  // Enlarged map drag survives a resize, a failed pointer capture, and a pinch.
  const sceneNow=()=>app.ids.get('map').children[0].getAttribute('transform');
  app.resize();await flush();app.ids.get('zoom-in').fire('click');app.ids.get('zoom-in').fire('click');await flush();
  const beforeDrag=sceneNow(),vp=app.ids.get('viewport');
  vp.setPointerCapture=()=>{throw Error('capture unavailable');};
  tap();app.tick(400);
  app.pointer('pointerdown',1,app.path('07-C04'),200,200);app.pointer('pointermove',1,app.path('07-C04'),140,160);app.pointer('pointerup',1,app.path('07-C04'),140,160);await flush();
  assert.notEqual(sceneNow(),beforeDrag,'zoomed SVG drag changes map transform');
  const afterDrag=sceneNow();app.resize();await flush();assert.equal(sceneNow(),afterDrag,'resize does not undo user pan');
  app.pointer('pointerdown',1,app.path('07-C04'),100,100);
  app.pointer('pointerdown',2,app.path('07-C04'),200,100);
  app.pointer('pointermove',2,app.path('07-C04'),280,100);await flush();
  const pinched=sceneNow();assert.notEqual(pinched,afterDrag,'pinch zoom remains enabled');
  app.pointer('pointerup',2,app.path('07-C04'),280,100);
  app.pointer('pointermove',1,app.path('07-C04'),70,120);app.pointer('pointerup',1,app.path('07-C04'),70,120);await flush();
  assert.notEqual(sceneNow(),pinched,'remaining finger can continue dragging');
  const beforeOutside=sceneNow();app.pointer('pointerdown',5,app.path('07-C04'),100,100);
  app.window.fire('pointermove',{pointerId:5,clientX:150,clientY:160,target:{},preventDefault(){}});
  app.window.fire('pointerup',{pointerId:5,clientX:150,clientY:160,target:{},preventDefault(){}});await flush();
  assert.notEqual(sceneNow(),beforeOutside,'window fallback completes drag without capture');
  app.ids.get('map-controls-toggle').fire('click');assert(app.ids.get('app').classList.contains('controls-hidden'));
  assert.equal(app.ids.get('map-controls-toggle').getAttribute('aria-expanded'),'false');
  app.ids.get('map-controls-toggle').fire('click');assert(!app.ids.get('app').classList.contains('controls-hidden'));

  // Exercise actual sensor callbacks, arrow rotation, follow/pan and rendered three-color edge.
  const geo=campus.geo,k=6371000*Math.PI/180;
  const fixAt=p=>{const x=p.x-geo.x,y=p.y-geo.y,d=geo.a**2+geo.b**2,e=(geo.a*x+geo.b*y)/d,s=(-geo.b*x+geo.a*y)/d;return {latitude:geo.origin.latitude-s/k,longitude:geo.origin.longitude+e/(k*Math.cos(geo.origin.latitude*Math.PI/180)),accuracy:4,timestamp:Date.now()};};
  const live=p=>app.emitSensor({active:true,fresh:true,fix:fixAt(p),heading:90,status:'tracking',permission:'granted'});
  app.tick(400);double('11-W17');await flush();live(cp);await flush();
  assert.equal(app.ids.get('nav-arrow').style.display,'','known heading shows location arrow');
  assert.equal(app.ids.get('nav-edge-line').style.stroke,'#ff3b30');
  const farSpan=Number(app.ids.get('nav-edge-line').style.strokeDasharray.split(' ')[0]);
  assert.equal(app.ids.get('nav-recenter').getAttribute('aria-pressed'),'true');
  const atLive=sceneNow();app.pointer('pointerdown',1,app.path('07-C04'),200,200);app.pointer('pointermove',1,app.path('07-C04'),130,180);app.pointer('pointerup',1,app.path('07-C04'),130,180);await flush();
  assert.equal(app.ids.get('nav-recenter').getAttribute('aria-pressed'),'false');assert.notEqual(sceneNow(),atLive);
  const userPan=sceneNow();live(cp);await flush();assert.equal(sceneNow(),userPan,'GPS updates do not fight user pan');
  app.ids.get('nav-recenter').fire('click');await flush();assert.equal(app.ids.get('nav-recenter').getAttribute('aria-pressed'),'true');assert.notEqual(sceneNow(),userPan);
  const trip=N.routeToBooth(cg,cp,campus.placements['11-W17'].bounds).line;
  function remaining(m){for(let j=trip.length-1;j>0;j--){const a=trip[j],b=trip[j-1],d=Math.hypot(b.x-a.x,b.y-a.y);if(m<=d)return N.point(cg,N.snap(cg,{x:a.x+(b.x-a.x)*m/d,y:a.y+(b.y-a.y)*m/d},1));m-=d;}return cp;}
  live(remaining(70));await flush();assert.equal(app.ids.get('nav-edge-line').style.stroke,'#ff9500');
  const midSpan=Number(app.ids.get('nav-edge-line').style.strokeDasharray.split(' ')[0]);
  live(remaining(10));await flush();assert.equal(app.ids.get('nav-edge-line').style.stroke,'#34c759');
  const nearSpan=Number(app.ids.get('nav-edge-line').style.strokeDasharray.split(' ')[0]);assert(farSpan<midSpan&&midSpan<nearSpan);
  app.ids.get('map-controls-toggle').fire('click');assert(app.ids.get('app').classList.contains('nav-controls-hidden'));assert(!app.ids.get('nav-card').hidden,'destination stays visible when buttons hidden');
  assert(!app.ids.get('nav-edge').hasAttribute('hidden'),'edge remains visible when controls hidden');
  app.ids.get('map-controls-toggle').fire('click');assert(!app.ids.get('app').classList.contains('nav-controls-hidden'));
  app.ids.get('nav-overview').fire('click');assert.equal(app.ids.get('nav-recenter').getAttribute('aria-pressed'),'false');
  app.ids.get('nav-stop').fire('click');await flush();assert(app.ids.get('nav-edge').hasAttribute('hidden'),'SVG edge hidden on stop');
  assert.equal(app.favorites().length,3,'routing does not change saved interests');
  app.stored.set('tgs2026-navigation-calibration-v1','{}');app.ids.get('nav-reset').fire('click');await flush();assert(!app.stored.has('tgs2026-navigation-calibration-v1'),'only calibration reset');assert.equal(app.favorites().length,3);
  assert(![...app.stored.keys()].some(k=>/trace|history|track/i.test(k)),'no movement history');
  console.log('PASS: '+(process.argv.includes('--interactions-only')?'interaction/sensor subset':'557 booth approach paths')+'; obstacle detours/corner blocking, discrete proximity colors, compass/calibration, permission lifecycle, double tap start/switch/clear, no arbitrary destination or movement history. Simulated sensors/DOM, not field GPS.');
}
check().catch(error=>{console.error(error);process.exitCode=1;});
