'use strict';
// real-floor-switch-2026-09-18
const VERSION = '2026.09.18.7';
const BASE = self.registration.scope;
const PREFIX = 'tgs2026-travel:' + new URL(BASE).pathname + ':';
const CACHE = PREFIX + VERSION;
const FILES = ['./', './app.js', './style.css', './travel.js', './travel.css', './visit.css', './map-data.json', './data.json',
  './main-official.svg', './school-official.svg', './concourse-official.svg',
  './halls911-official.svg', './indie9-official.svg', './selected80-official.svg', './business9-official.svg',
  './campus.svg','./navigation/campus.json','./navigation/campus-grid.json','./navigation/core.js','./navigation/sensors.js','./navigation/tgs-navigation.js','./navigation/route-worker.js','./navigation/navigation.css','./navigation/walkable.json',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
const URLS = FILES.map(file => new URL(file, BASE).href);

async function verifiedResponse(url) {
  const response = await fetch(new Request(url, {cache:'reload', credentials:'same-origin'}));
  const target = new URL(url), final = new URL(response.url);
  if (!response.ok || final.origin !== target.origin || final.pathname !== target.pathname) throw new Error('Map asset unavailable');
  const type = (response.headers.get('Content-Type') || '').toLowerCase();
  if (url === URLS[0]) {
    const html = await response.clone().text();
    if (!type.includes('text/html') || !html.includes('name="tgs-travel-version"') || html.includes('data-tgs-dev-version')) throw new Error('Not a travel map page');
  } else if (target.pathname.endsWith('.svg')) {
    if (!type.includes('image/svg+xml') || !(await response.clone().text()).includes('<svg')) throw new Error('Not a map image');
  } else if (target.pathname.endsWith('.json') || target.pathname.endsWith('.webmanifest')) {
    if (!type.includes('json')) throw new Error('Not map data');
    await response.clone().json();
  } else if (target.pathname.endsWith('.js') && !/javascript|ecmascript/.test(type)) throw new Error('Not a map script');
  else if (target.pathname.endsWith('.css') && !type.includes('text/css')) throw new Error('Not a stylesheet');
  else if (target.pathname.endsWith('.png') && !type.includes('image/png')) throw new Error('Not an icon');
  return new Response(await response.arrayBuffer(), {status:response.status, statusText:response.statusText, headers:response.headers});
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const responses = await Promise.all(URLS.map(verifiedResponse));
    const cache = await caches.open(CACHE);
    try {
      await Promise.all(responses.map((response, index) => cache.put(URLS[index], response)));
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== new URL(BASE).origin) return;
  const canonical = url.origin + url.pathname;
  const isEntry = canonical === URLS[0] || canonical === new URL('index.html', BASE).href;
  const cacheKey = isEntry ? URLS[0] : URLS.find(asset => asset === canonical);
  if (!cacheKey) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    try {
      const response = await verifiedResponse(cacheKey);
      await cache.put(cacheKey, response.clone());
      return response;
    } catch (error) {
      if (isEntry) return new Response('TGS map is not available offline yet.', {status:503, headers:{'Content-Type':'text/plain; charset=utf-8'}});
      throw error;
    }
  })());
});

self.addEventListener('message', event => {
  const reply = payload => event.source?.postMessage(payload);
  if (event.data?.type === 'TGS_TRAVEL_STATUS') {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE);
      const keys = new Set((await cache.keys()).map(request => request.url));
      const missing = URLS.filter(url => !keys.has(url));
      reply({type:'TGS_TRAVEL_STATUS', version:VERSION, ready:missing.length === 0, saved:URLS.length - missing.length, total:URLS.length, missing});
    })());
  }
  if (event.data?.type === 'TGS_TRAVEL_PREPARE') {
    event.waitUntil((async () => {
      try {
        const responses = await Promise.all(URLS.map(verifiedResponse));
        const cache = await caches.open(CACHE);
        await Promise.all(responses.map((response, index) => cache.put(URLS[index], response)));
        reply({type:'TGS_TRAVEL_STATUS', version:VERSION, ready:true, saved:URLS.length, total:URLS.length, missing:[]});
      } catch (error) {
        reply({type:'TGS_TRAVEL_STATUS', version:VERSION, ready:false, error:error.message || String(error)});
      }
    })());
  }
});
