const CACHE_PREFIX = 'batchline-shell-';
const CACHE = CACHE_PREFIX + '__BUILD_REVISION__';
const SHELL = [
  '/', '/manifest.webmanifest', '/app/icon-192.png', '/app/icon-512.png', '/app/style.css',
  '/app/main.js', '/app/benchmark-data.js', '/app/csv.js', '/app/engine.js', '/app/demo.js', '/app/store.js'
];
const assets = new Set(SHELL.slice(1));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL.map(path => new Request(path, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match('/')) ?? fetch(request)));
  } else if (assets.has(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.pathname)) ?? fetch(request)));
  }
});
