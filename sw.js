// Eventpages service worker: app shell offline. Bump VERSION on every deploy that changes the shell.
const VERSION = 'ep-2026-11-07c';
const SHELL = ['./', './index.html', './app.js', './styles.css', './airports.js', './examples.js', './osm-snapshots.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
// Static third-party libraries and fonts the page needs to render. Data APIs (weather, Overpass, geocoding, map tiles) are never cached here.
const STATIC_HOSTS = [/^https:\/\/unpkg\.com\/leaflet@/, /^https:\/\/cdn\.jsdelivr\.net\/npm\/lz-string@/, /^https:\/\/fonts\.googleapis\.com\//, /^https:\/\/fonts\.gstatic\.com\//];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
const networkFirst = async (req) => {
  const c = await caches.open(VERSION);
  try { const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }
  catch { return (await c.match(req, { ignoreSearch: true })) || (await c.match('./index.html')) || Response.error(); }
};
const staleWhileRevalidate = async (req, ev) => {
  const c = await caches.open(VERSION); const hit = await c.match(req);
  const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
  if (hit) { ev.waitUntil(net.catch(() => {})); return hit; }
  return net;
};
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); const same = url.origin === self.location.origin && url.pathname.startsWith(new URL('./', self.registration.scope).pathname);
  if (req.mode === 'navigate' || (same && /\/$|\.html$/.test(url.pathname))) { e.respondWith(networkFirst(req)); return; }
  if (same || STATIC_HOSTS.some(re => re.test(req.url))) { e.respondWith(staleWhileRevalidate(req, e)); return; }
  // everything else (weather, Overpass, Nominatim, tiles): straight to the network
});
