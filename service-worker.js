// BloomBooks service worker — NOT REGISTERED, and not guilty.
//
// This file was suspected of breaking Google Sheets sync on iPhone and was
// unregistered during the investigation. It was subsequently cleared: the
// real cause was iOS Safari aborting requests fired in the instant the OAuth
// popup closes, and the fix is fetchRetry() in utils.js. Sync works with this
// worker absent, and there is no evidence it ever misbehaved.
//
// index.html does not register it and actively removes any installed copy, so
// this code does not currently run. That is a leftover of the diagnosis, not
// a verdict. The only real argument for leaving it off is that offline access
// never worked anyway -- the worker failed to install on every attempt before
// 2026-07-31 (its APP_SHELL listed two icon PNGs that did not exist, and
// cache.addAll is all-or-nothing), so nothing was ever cached or served.
//
// Re-enabling it is reasonable. What it needs is its own change, tested on a
// real iPhone in a normal (non-private) tab, rather than being switched back
// on alongside anything else -- sync is what the app is for, and it has only
// just started working there.
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
