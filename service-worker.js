const VERSION = 'v1';
const APP = 'app-' + VERSION, TILES = 'tiles-' + VERSION, EXT = 'ext-' + VERSION;
const CORE = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
const EXTERNAL = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Onest:wght@400;500;600;700&family=Unbounded:wght@500;700&display=swap'
];
const MAX_TILES = 3000;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    await (await caches.open(APP)).addAll(CORE);
    const ext = await caches.open(EXT);
    for (const url of EXTERNAL) {
      try {
        const res = await fetch(url, { mode: 'cors' });
        if (!res.ok) continue;
        await ext.put(url, res.clone());
        if (url.includes('fonts.googleapis.com')) {
          const urls = [...(await res.text()).matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]);
          await Promise.all(urls.map(u => ext.add(u).catch(() => {})));
        }
      } catch {}
    }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = [APP, TILES, EXT];
    for (const k of await caches.keys()) if (!keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(cacheFirst(req, TILES));
  } else if (url.origin === location.origin) {
    e.respondWith(networkFirst(req));
  } else if (/unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url.hostname)) {
    e.respondWith(cacheFirst(req, EXT));
  }
});

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  } catch {
    return name === TILES ? new Response('', { status: 504 }) : Response.error();
  }
}

async function networkFirst(req) {
  const cache = await caches.open(APP);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req)) || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
  }
}

self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'cache-tiles') return;
  e.waitUntil(downloadTiles(e.data.urls.filter(u => u.startsWith('https://tile.openstreetmap.org/')).slice(0, MAX_TILES), e.source));
});

async function downloadTiles(urls, client) {
  const cache = await caches.open(TILES);
  let done = 0, failed = 0, i = 0;
  const total = urls.length;
  const worker = async () => {
    while (i < total) {
      const u = urls[i++];
      try {
        if (!(await cache.match(u))) {
          const res = await fetch(u, { mode: 'cors' });
          if (!res.ok) throw 0;
          await cache.put(u, res);
        }
      } catch { failed++; }
      done++;
      if (done % 20 === 0 || done === total) client.postMessage({ type: 'tiles', done, total, failed });
    }
  };
  await Promise.all([worker(), worker()]);
}
