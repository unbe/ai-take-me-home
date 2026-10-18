/**
 * sw.js - Service Worker for Take Me Home PWA
 * Provides offline caching for core assets and satisfies PWA installability requirements.
 *
 * NOTE: When bumping version in js/version.js, also bump APP_VERSION here!
 */

const APP_VERSION = '1.3';
const CACHE_NAME = `takemehome-v${APP_VERSION}`;

const PRECACHE_ASSETS = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/version.js',
  'js/storage.js',
  'js/geo.js',
  'js/map.js',
  'js/overpass.js',
  'js/elevation.js',
  'js/transit.js',
  'js/tiers.js',
  'js/util.js',
  'manifest.json',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Precache asset failed:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Deleting obsolete cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Bypassing API calls from cache (live transit, elevation, Overpass must always be fresh)
  if (
    url.hostname.includes('overpass') ||
    url.hostname.includes('transitous') ||
    url.hostname.includes('open-meteo') ||
    url.hostname.includes('sbb.ch') ||
    url.hostname.includes('transport.opendata.ch')
  ) {
    return;
  }

  // Network-first strategy for app shell
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('./') || caches.match('index.html');
          }
          return new Response('Offline', { status: 503, statusText: 'Offline' });
        });
      })
  );
});
