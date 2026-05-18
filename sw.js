const CACHE_NAME = 'egg-butler-v17';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/db.js',
  '/prediction.js',
  '/charts.js',
  '/assets/dandan-portrait.jpeg',
  '/assets/app-icon.png',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/apple-touch-icon.png',
  '/assets/icons/favicon-32.png',
  '/assets/icons/favicon-16.png',
  '/utils/cloudBackup.js',
  '/manifest.webmanifest',
  '/views/dashboard.js',
  '/views/record.js',
  '/views/history.js',
  '/views/analytics.js',
  '/utils/time.js',
  '/utils/activityDay.js',
  '/utils/dom.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  if (event.request.url.includes('cdn.jsdelivr.net')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return fetch(event.request).then((response) => {
          cache.put(event.request, response.clone());
          return response;
        }).catch(() => caches.match(event.request));
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request).then((fetchResponse) => {
      if (event.request.url.startsWith(self.location.origin)) {
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, fetchResponse.clone());
        });
      }
      return fetchResponse;
    }).catch(() => {
      return caches.match(event.request).then((response) => {
        if (response) return response;
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return undefined;
      });
    })
  );
});
