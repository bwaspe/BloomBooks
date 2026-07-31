// BloomBooks service worker
// Bump this on every deploy so clients pick up fresh app-shell files.
const CACHE_VERSION = 'bloombooks-v1';

// Only same-origin app-shell files are cached. Google auth/API calls,
// Chart.js, and fonts are always fetched live — caching those would
// risk breaking sign-in or serving stale library code.
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './utils.js',
  './sync.js',
  './ledger.js',
  './reports.js',
  './import-trainer.js',
  './cost-tracker.js',
  './init.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle GET requests to our own origin. Everything else
  // (Google sign-in, Sheets API, Chart.js CDN, fonts) goes straight
  // to the network untouched.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Network-first for the app shell so you always get the latest
  // code when online, with a cache fallback for offline access.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
