const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createDevServer} = require('../scripts/serve.cjs');
const {validateBackup, makeBackup} = require('../dist/travel.js');
const root = path.resolve(__dirname, '../dist');
const workerSource = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const clientSource = fs.readFileSync(path.join(root, 'travel.js'), 'utf8');

function workerHarness(base, fetcher = fetch) {
  const handlers = {}, stores = new Map();
  let skipped = false, claimed = false;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const data = stores.get(name);
      return {async put(key, response) { data.set(String(key), response.clone()); },
        async match(key) { return data.get(String(key))?.clone(); }};
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); }
  };
  const context = {
    self:{registration:{scope:base},addEventListener:(name,fn) => {handlers[name]=fn;},
      skipWaiting:async () => {skipped=true;},clients:{claim:async () => {claimed=true;}}},
    caches, Request, Response, URL, fetch:fetcher
  };
  vm.runInNewContext(workerSource, context);
  const life = async name => { let work; handlers[name]({waitUntil:promise => {work=promise;}}); await work; };
  const message = async type => {
    let result, work;
    handlers.message({data:{type},ports:[{postMessage:value => {result=value;}}],waitUntil:promise => {work=promise;}});
    await work; return result;
  };
  const request = async (url, method='GET') => {
    let response;
    handlers.fetch({request:new Request(url,{method}),respondWith:promise => {response=promise;}});
    return response;
  };
  return {context,stores,life,message,request,get skipped(){return skipped;},get claimed(){return claimed;}};
}

async function checkClientOffline(version='2026.09.17.1') {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id,{dataset:{},textContent:'',disabled:false,addEventListener(){}});
    return elements.get(id);
  };
  let registrations = 0;
  class Channel {
    constructor() {
      this.port1={onmessage:null,close(){}};
      this.port2={postMessage:value => queueMicrotask(() => this.port1.onmessage({data:value}))};
    }
  }
  const controller={postMessage:(message,ports) => ports[0].postMessage({ready:true,version,saved:18,total:18})};
  vm.runInNewContext(clientSource, {
    document:{getElementById:element,querySelector:selector => selector.startsWith('meta')?{content:'2026.09.17.1'}:null},window:{isSecureContext:true},
    navigator:{serviceWorker:{controller,register:async () => {registrations++;throw new Error('offline');}}},
    MessageChannel:Channel,setTimeout,clearTimeout,console
  });
  await new Promise(setImmediate);
  assert.equal(registrations,0,'existing offline controller must not depend on a new network registration');
  assert.equal(element('offline-status').dataset.state,version==='2026.09.17.1'?'ready':'error','old cache must not claim new maps are ready');
  assert.equal(element('offline-save').disabled,false);
}

(async () => {
  const ids = new Set(JSON.parse(fs.readFileSync(path.join(root,'map-data.json'))).booths.map(booth => booth.id));
  assert.deepEqual(validateBackup(makeBackup([]),ids),[],'an empty saved list stays empty');
  assert.deepEqual(validateBackup(makeBackup(['07-C04','07-C04']),ids),['07-C04']);
  assert.throws(() => validateBackup({format:'tgs2026-interests',version:1,boothIds:['99-X99']},ids));
  assert.throws(() => validateBackup({format:'other',version:1,boothIds:[]},ids));
  assert.throws(() => validateBackup({format:'tgs2026-interests',version:1,boothIds:'07-C04'},ids));
  await checkClientOffline();
  await checkClientOffline('2026.09.11.1');

  const server = createDevServer({root,liveReload:false});
  await new Promise((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base = `http://127.0.0.1:${server.address().port}/`;
  try {
    const worker = workerHarness(base);
    await worker.life('install');
    assert.equal(worker.skipped,true);
    await worker.life('activate');
    assert.equal(worker.claimed,true);
    assert.equal((await worker.message('TGS_TRAVEL_STATUS')).ready,true);
    // Model a browser with only four connections: unread bodies must not hold
    // those connections while install waits for the complete bundle's headers.
    let inFlight = 0;
    const waiting = [];
    const limited = workerHarness(base, async request => {
      if (inFlight >= 4) await new Promise(resolve => waiting.push(resolve));
      inFlight++;
      const response = await fetch(request);
      const read = response.arrayBuffer.bind(response);
      response.arrayBuffer = async () => {
        try { return await read(); }
        finally { inFlight--; waiting.shift()?.(); }
      };
      return response;
    });
    let timeout;
    try {
      await Promise.race([limited.life('install'), new Promise((_,reject) => {
        timeout = setTimeout(() => reject(new Error('install held unread download streams')), 8000);
      })]);
    } finally { clearTimeout(timeout); }
    assert.equal(limited.skipped,true);
    worker.context.fetch = async () => {throw new Error('network disconnected');};
    for (const url of ['', 'app.js?v=4', 'style.css?v=4','travel.js','visit.css','campus.svg','navigation/campus.json','navigation/campus-grid.json','navigation/core.js','navigation/sensors.js','navigation/tgs-navigation.js','navigation/route-worker.js','navigation/navigation.css','navigation/walkable.json','map-data.json?v=4','main-official.svg','school-official.svg','concourse-official.svg','halls911-official.svg','indie9-official.svg','selected80-official.svg','business9-official.svg']) {
      const response = await worker.request(base+url);
      assert.equal(response.status,200,`offline response: ${url}`);
      assert.ok((await response.arrayBuffer()).byteLength > 0);
    }
    assert.equal(await worker.request('https://example.com/'),undefined,'external requests remain outside this worker');
    assert.equal(await worker.request(base+'unknown-file'),undefined);
    assert.equal(await worker.request(base,'POST'),undefined);
    const cache = [...worker.stores.values()][0];
    cache.delete(base+'school-official.svg');
    assert.equal((await worker.message('TGS_TRAVEL_STATUS')).ready,false,'missing school map is not ready');
    assert.equal((await worker.message('TGS_TRAVEL_PREPARE')).ready,false,'offline repair failure stays not ready');
    worker.context.fetch = fetch;
    assert.equal((await worker.message('TGS_TRAVEL_PREPARE')).ready,true,'online repair fills the missing map');

    const unauthorized = workerHarness(base, async request => {
      if (request.url.endsWith('school-official.svg')) {
        const response = new Response('<html>Login</html>',{headers:{'Content-Type':'text/html'}});
        Object.defineProperty(response,'url',{value:base+'login'});
        return response;
      }
      return fetch(request);
    });
    await assert.rejects(unauthorized.life('install'),'a login page must fail installation');
    assert.equal(unauthorized.skipped,false);
    assert.equal((await unauthorized.message('TGS_TRAVEL_STATUS')).ready,false);
    const injected = workerHarness(base, async request => {
      const response=await fetch(request);
      if (request.url !== base) return response;
      const html = new Response((await response.text())+'<script data-tgs-dev-version="probe"></script>',{headers:{'Content-Type':'text/html'}});
      Object.defineProperty(html,'url',{value:base});
      return html;
    });
    await assert.rejects(injected.life('install'),'development HTML cannot be cached as a travel release');
    assert.equal(injected.skipped,false);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
  console.log('PASS: complete offline bundle; query-string assets; missing-cache detection and repair; login/development HTML rejection; offline-ready client; validated interest backups. Node/worker simulation, not iPhone hardware.');
})().catch(error => {console.error(error);process.exitCode=1;});
