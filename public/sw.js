// Service worker for the control PWA.
//
// Deliberately conservative: the app shell is cached so it opens instantly and
// survives a flaky venue wifi, but every /api/ call goes to the network. Menu
// data must never be served stale — a bartender marking a keg kicked has to see
// the truth, not a cached copy.

const VERSION = 'v2';
const SHELL = 'shell-' + VERSION;

const SHELL_FILES = [
  '/',
  '/admin/admin.css',
  '/admin/app.js',
  '/admin/core.js',
  '/admin/icons.js',
  '/admin/view-menu.js',
  '/admin/view-design.js',
  '/admin/view-system.js',
  '/shared/theme.js',
  '/manifest.webmanifest',
  '/icons/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the API or the event stream.
  if (url.pathname.startsWith('/api/')) return;

  // Uploaded images are content-addressed: cache them forever.
  if (url.pathname.startsWith('/u/')) {
    event.respondWith(
      caches.open(SHELL).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      })
    );
    return;
  }

  // Shell: network first so updates land, cache as the offline fallback.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put(request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(request);
        if (hit) return hit;
        if (request.mode === 'navigate') return caches.match('/');
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      })
  );
});
