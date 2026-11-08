// Eventpages service worker: app shell offline. Same-origin files are network-first, so deploys show up on the next open.
// Bump VERSION on every deploy anyway: it clears old caches and triggers the in-page 'Updated' prompt.
const VERSION = 'ep-2026-11-08g';
const SHELL = ['./', './index.html', './app.js', './styles.css', './airports.js', './examples.js', './osm-snapshots.js', './qrcode.js', './i18n.js', './supabase-config.js', './google-config.js',
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
  // no-cache: revalidate with the server (cheap 304s) instead of trusting the browser's HTTP cache
  try { const r = await fetch(req, { cache: 'no-cache' }); if (r.ok) c.put(req, r.clone()); return r; }
  catch { return (await c.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await c.match('./index.html') : null) || Response.error(); }
};
const staleWhileRevalidate = async (req, ev) => {
  const c = await caches.open(VERSION); const hit = await c.match(req);
  const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
  if (hit) { ev.waitUntil(net.catch(() => {})); return hit; }
  return net;
};
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin && /\/(proposal|supabase|google|ai)\//.test(url.pathname)) return; // proposal and setup pages are not part of the app: never cached
  const same = url.origin === self.location.origin && url.pathname.startsWith(new URL('./', self.registration.scope).pathname);
  if (req.mode === 'navigate' || (same && /\/$|\.html$/.test(url.pathname))) { e.respondWith(networkFirst(req)); return; }
  // our own files: network first so a new deploy shows up on the next open; the cache is the offline fallback
  if (same) { e.respondWith(networkFirst(req)); return; }
  if (STATIC_HOSTS.some(re => re.test(req.url))) { e.respondWith(staleWhileRevalidate(req, e)); return; }
  // everything else (weather, Overpass, Nominatim, tiles): straight to the network
});
