/* ICT Snow Removal service worker. Bump VERSION on every release so old caches get cleared. */
var VERSION = 'ict-snow-v2';
var SHELL_CACHE = VERSION + '-shell';
var ASSET_CACHE = VERSION + '-assets';

var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.ico',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/logo.png',
  './icons/logo-on-dark.png'
];
var CDN = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/images/layers.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/layers-2x.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil((async function () {
    var shell = await caches.open(SHELL_CACHE);
    await shell.addAll(SHELL.map(function (u) { return new Request(u, { cache: 'reload' }); }));
    var assets = await caches.open(ASSET_CACHE);
    // CDN files are best effort: a CDN hiccup must not block the install.
    await Promise.all(CDN.map(function (u) {
      return fetch(new Request(u, { mode: 'cors', credentials: 'omit' }))
        .then(function (r) { if (r.ok) return assets.put(u, r); })
        .catch(function () {});
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.map(function (k) {
      if (k.indexOf('ict-snow-') === 0 && k !== SHELL_CACHE && k !== ASSET_CACHE) return caches.delete(k);
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('message', function (e) {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

function isPage(req, url) {
  return req.mode === 'navigate' ||
    (url.origin === self.location.origin && /\/(index\.html)?$/.test(url.pathname));
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // App page: network first so updates show right away, cached copy when offline.
  if (isPage(req, url)) {
    e.respondWith((async function () {
      var cache = await caches.open(SHELL_CACHE);
      try {
        var fresh = await fetch(req, { cache: 'no-store' });
        if (fresh && fresh.ok) cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (err) {
        return (await cache.match('./index.html')) || (await cache.match('./')) ||
          new Response('<h1>Offline</h1><p>Open ICT Snow Removal once with signal to use it offline.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  // Same-origin static files (manifest, icons) and the pinned Leaflet CDN: cache first.
  var sameOrigin = url.origin === self.location.origin;
  var leaflet = url.origin === 'https://unpkg.com' && url.pathname.indexOf('/leaflet@1.9.4/') === 0;
  if (sameOrigin || leaflet) {
    e.respondWith((async function () {
      var hit = await caches.match(req, { ignoreVary: true });
      if (hit) return hit;
      var res = await fetch(req);
      if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
        var cache = await caches.open(sameOrigin ? SHELL_CACHE : ASSET_CACHE);
        cache.put(req, res.clone());
      }
      return res;
    })());
    return;
  }

  // Everything else (map tiles, Nominatim address search, Overpass building lookups)
  // goes straight to the network and is never stored by this worker.
});
