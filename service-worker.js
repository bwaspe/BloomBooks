// BloomBooks service worker — NOT REGISTERED. Do not re-enable without
// reading this first.
//
// index.html deliberately does not register this file, and actively
// unregisters any previously installed copy. On iOS Safari, a service worker
// controlling the page made every authenticated Google Sheets call fail
// before it left the device: the app synced correctly in a Private Browsing
// tab (where iOS disables service workers) and failed in a normal tab with
// one registered.
//
// The Authorization header on our Sheets requests forces a CORS preflight,
// and preflights are specified to bypass service workers entirely. Safari
// mishandles that, so the request dies in the preflight with no HTTP status,
// surfacing as a bare network error. Registering a fetch handler at all puts
// the worker in that path, so narrowing what it caches does not help — this
// file cannot be re-enabled as-is without breaking sync on iPhone.
//
// If offline access is wanted later, it needs a different approach that keeps
// the worker out of the request path for api calls, and it must be tested on
// a real iPhone in a normal (non-private) tab before shipping.
//
// Bump this on every deploy so clients pick up fresh app-shell files.
const CACHE_VERSION = 'bloombooks-v3';

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
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  // addAll() is all-or-nothing: one 404 rejects the whole promise and the
  // worker never installs, silently costing offline support entirely.
  // Cache each file on its own so a single missing asset can't do that.
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('SW: could not cache', url, err);
          })
        )
      )
    )
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
