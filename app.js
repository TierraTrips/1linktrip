/* 1LinkTrip — static event microsite builder. No backend: events live in the URL hash. */
(() => {
'use strict';

// ---------- small utilities ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;
const clone = (o) => JSON.parse(JSON.stringify(o));
const pad = (n) => String(n).padStart(2, '0');
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const LS = {
  get(k, d = null) { try { const v = localStorage.getItem('ep:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ep:' + k, JSON.stringify(v)); } catch { /* quota */ } },
  del(k) { try { localStorage.removeItem('ep:' + k); } catch {} }
};

function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- dates (all event times are wall-clock in the venue's time zone) ----------
const asUTC = (s) => new Date((s.length === 10 ? s + 'T00:00' : s) + ':00Z');
const LOCALES = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', pt: 'pt-BR', de: 'de-DE', it: 'it-IT', ja: 'ja-JP' };
const fmt = (s, o) => { try { return new Intl.DateTimeFormat(LOCALES[LANG] || LANG || 'en-US', { timeZone: 'UTC', ...o }).format(asUTC(s)); } catch { return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...o }).format(asUTC(s)); } };
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (s, n) => { const d = asUTC(s.slice(0, 10)); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const todayYMD = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const daysBetween = (a, b) => Math.round((asUTC(b.slice(0, 10)) - asUTC(a.slice(0, 10))) / 864e5);
const fmtTime = (hm) => { if (!hm) return ''; const [h, m] = hm.split(':').map(Number); return LANG === 'en' ? `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}` : `${pad(h)}:${pad(m)}`; };

function dateRange(start, end) {
  if (!start) return t('Date to be announced');
  const s = start.slice(0, 10), e = (end || start).slice(0, 10);
  if (s === e) return fmt(s, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  if (LANG !== 'en') { try { return new Intl.DateTimeFormat(LOCALES[LANG], { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).formatRange(asUTC(s), asUTC(e)); } catch { /* fall through */ } }
  const sy = s.slice(0, 4), ey = e.slice(0, 4), sm = s.slice(5, 7), em = e.slice(5, 7);
  if (sy === ey && sm === em) return `${fmt(s, { month: 'short', day: 'numeric' })}–${fmt(e, { day: 'numeric' })}, ${sy}`;
  if (sy === ey) return `${fmt(s, { month: 'short', day: 'numeric' })} – ${fmt(e, { month: 'short', day: 'numeric' })}, ${sy}`;
  return `${fmt(s, { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmt(e, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
function timeRange(start, end) {
  if (!start || start.length < 16) return '';
  const st = fmtTime(start.slice(11, 16));
  if (!end || end.length < 16) return st;
  return `${st} – ${fmtTime(end.slice(11, 16))}`;
}
// offset (ms) of tz at a given UTC instant
function tzOffset(utcMs, tz) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - utcMs;
  } catch { return 0; }
}
function wallToUTC(s, tz) {
  const guess = asUTC(s).getTime();
  if (!tz) return new Date(guess);
  let t = guess - tzOffset(guess, tz);
  t = guess - tzOffset(t, tz);
  return new Date(t);
}
const icsStamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// ---------- geo ----------
function distM(a1, o1, a2, o2) {
  const R = 6371e3, r = Math.PI / 180, dA = (a2 - a1) * r, dO = (o2 - o1) * r;
  const x = Math.sin(dA / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const IMPERIAL = new Set(['us', 'gb', 'lr', 'mm']);
function fmtDist(m, cc) {
  if (IMPERIAL.has(cc)) { const mi = m / 1609.34; return mi < 0.1 ? `${Math.round(m * 3.281 / 10) * 10} ft` : `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`; }
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}
const walkMin = (m) => Math.max(1, Math.round(m * 1.25 / 80)); // straight-line x1.25 detour, 80 m/min
const walkTxt = (m) => t('{n} min walk', { n: walkMin(m) });

function nearestAirports(lat, lon) {
  const all = (window.AIRPORTS || []).map(a => ({ iata: a[0], name: a[1], city: a[2], cc: a[3], lat: a[4], lon: a[5], large: !!a[6], d: distM(lat, lon, a[4], a[5]) }));
  const large = all.filter(a => a.large && a.d < 220e3).sort((a, b) => a.d - b.d).slice(0, 3);
  const medium = all.filter(a => !a.large && a.d < 110e3).sort((a, b) => a.d - b.d);
  // regional fields only fill in when there are fewer than three big airports, or sit far closer than the nearest big one
  const out = large.concat(medium.filter(m => large.length < 2 || m.d < (large[0]?.d ?? Infinity) * 0.35)).sort((a, b) => a.d - b.d);
  return out.slice(0, 3);
}
function searchAirports(q) {
  q = q.trim().toLowerCase(); if (!q) return [];
  const res = [];
  for (const a of window.AIRPORTS || []) {
    const code = a[0].toLowerCase(), city = (a[2] || '').toLowerCase(), name = a[1].toLowerCase();
    let s = 0;
    if (code === q) s = 100; else if (city.startsWith(q)) s = 60; else if (name.startsWith(q)) s = 50; else if (city.includes(q) || name.includes(q)) s = 30;
    if (s) res.push([s + (a[6] ? 10 : 0), a]);
  }
  return res.sort((x, y) => y[0] - x[0]).slice(0, 6).map(x => x[1]);
}
const airportByCode = (c) => (window.AIRPORTS || []).find(a => a[0] === c);

// ---------- fetching with caching ----------
const memo = new Map();
async function getJSON(url, { ttl = 3600e3, init, timeout = 20000, key } = {}) {
  key = key || url + (init && init.body ? '|' + init.body : '');
  if (memo.has(key)) return memo.get(key);
  const p = (async () => {
    const cached = LS.get('c:' + key);
    if (cached && (Date.now() - cached.t < ttl || navigator.onLine === false)) return cached.d;
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(url, { ...init, signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { if (cached && !/HTTP 4/.test(e.message)) return cached.d; throw e; }
    finally { clearTimeout(tm); }
  })();
  memo.set(key, p);
  p.catch(() => memo.delete(key));
  return p;
}
function cacheSet(key, d) { LS.set('c4:' + key, { t: Date.now(), d }); }

// ---------- external integrations ----------
// Address and venue search: Google Places (Text Search) first; Nominatim only when Google has no key or refuses it.
async function geocode(q) {
  if (GKEY && !gpBroken) {
    try { return await gGeocode(q); }
    catch (e) { if (/places 4(00|03|29)/.test(e.message)) gpBroken = true; }
  }
  return osmGeocode(q);
}
let lastNominatim = 0;
async function osmGeocode(q) {
  const wait = 1100 - (Date.now() - lastNominatim); if (wait > 0) await sleep(wait); // Nominatim: max 1 req/s
  lastNominatim = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&accept-language=en&q=${enc(q)}`;
  const data = await getJSON(url, { ttl: 864e5 * 7 });
  return data.map(r => {
    const a = r.address || {};
    const city = a.city || a.town || a.village || a.municipality || a.hamlet || a.suburb || a.county || '';
    const street = [a.house_number, a.road].filter(Boolean).join(' ');
    const name = r.name || street || city;
    if (!city && r.name && /^(state|region|province|county|island|archipelago|administrative)$/.test(r.addresstype || r.type || '')) a.city = r.name; // a region as a trip destination
    const address = [street && street !== name ? street : '', city, a.state, a.postcode].filter(Boolean).join(', ') || r.display_name;
    return { name, address, display: r.display_name, lat: +(+r.lat).toFixed(5), lon: +(+r.lon).toFixed(5), city: city || a.city || '', region: a.state || '', country: a.country || '', cc: (a.country_code || '').toLowerCase() };
  });
}
async function lookupTZ(lat, lon) {
  const d = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&timezone=auto&forecast_days=1&daily=weather_code`, { ttl: 864e5 * 30 });
  return d.timezone;
}

const WMO = (c) => c === 0 ? ['Clear', 'sun'] : c <= 2 ? ['Partly cloudy', 'part'] : c === 3 ? ['Overcast', 'cloud'] : c <= 48 ? ['Fog', 'fog']
  : c <= 57 ? ['Drizzle', 'rain'] : c <= 67 ? ['Rain', 'rain'] : c <= 77 ? ['Snow', 'snow'] : c <= 82 ? ['Showers', 'rain'] : c <= 86 ? ['Snow showers', 'snow'] : ['Thunderstorms', 'storm'];
const ICONS = {
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
  part: '<circle cx="9" cy="9" r="3.4"/><path d="M9 2.6v1.4M2.6 9h1.4M4.5 4.5l1 1M13.5 4.5l-1 1"/><path d="M8.5 19.5h9a3.5 3.5 0 0 0 .3-7 5 5 0 0 0-9.4 1.4A2.8 2.8 0 0 0 8.5 19.5z"/>',
  cloud: '<path d="M7 18.5h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.4 1.8A3.2 3.2 0 0 0 7 18.5z"/>',
  fog: '<path d="M4 9h16M2.5 13h19M4 17h16"/>',
  rain: '<path d="M7 15h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.4 1.8A3.2 3.2 0 0 0 7 15z"/><path d="M8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5"/>',
  snow: '<path d="M7 14.5h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.4 1.8A3.2 3.2 0 0 0 7 14.5z"/><path d="M8 18.5h.01M12 20h.01M16 18.5h.01M10 21.5h.01M14 21.5h.01" stroke-width="2.4"/>',
  storm: '<path d="M7 14.5h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.4 1.8A3.2 3.2 0 0 0 7 14.5z"/><path d="M12.5 15.5l-2 3.5h3l-2 3.5"/>'
};
const icon = (k) => `<svg class="wx-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ICONS.cloud}</svg>`;

async function weatherFor(cfg) {
  const { lat, lon } = cfg.venue; const tz = cfg.tz || 'auto';
  const s = cfg.start.slice(0, 10); let e = (cfg.end || cfg.start).slice(0, 10);
  if (daysBetween(s, e) > 6) e = addDays(s, 6);
  const today = todayYMD(), horizon = addDays(today, 15);
  const vars = 'temperature_2m_max,temperature_2m_min,weather_code';
  if (s <= horizon && e >= addDays(today, -60)) {
    const ee = e > horizon ? horizon : e;
    const ss = s < addDays(today, -60) ? addDays(today, -60) : s;
    const d = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=${vars},precipitation_probability_max&temperature_unit=fahrenheit&timezone=${enc(tz)}&start_date=${ss}&end_date=${ee}`, { ttl: 3 * 3600e3 });
    return { kind: s < today ? 'recent' : 'forecast', partial: e > horizon, days: d.daily.time.map((t, i) => ({ date: t, hi: d.daily.temperature_2m_max[i], lo: d.daily.temperature_2m_min[i], code: d.daily.weather_code[i], pop: d.daily.precipitation_probability_max?.[i] })) };
  }
  if (e < addDays(today, -60)) {
    const d = await getJSON(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&daily=${vars},precipitation_sum&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=${enc(tz)}&start_date=${s}&end_date=${e}`, { ttl: 864e5 * 30 });
    return { kind: 'past', days: d.daily.time.map((t, i) => ({ date: t, hi: d.daily.temperature_2m_max[i], lo: d.daily.temperature_2m_min[i], code: d.daily.weather_code[i], precip: d.daily.precipitation_sum[i] })) };
  }
  // Beyond the 16-day forecast: typical weather from the same dates in the previous five complete years.
  const cutoff = addDays(today, -7); const years = [];
  for (let y = +s.slice(0, 4) - 1; years.length < 5 && y > 1990; y--) {
    const ys = `${y}${s.slice(4)}`, ye = `${y + (e.slice(0, 4) - s.slice(0, 4))}${e.slice(4)}`;
    if (ye <= cutoff) years.push([ys, ye, y]);
  }
  const runs = await Promise.all(years.map(([a, b]) => getJSON(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=${enc(tz)}&start_date=${a}&end_date=${b}`, { ttl: 864e5 * 30 }).catch(() => null)));
  const ok = runs.filter(Boolean); if (!ok.length) throw new Error('no history');
  const n = daysBetween(s, e) + 1; const days = [];
  for (let i = 0; i < n; i++) {
    const his = [], los = [], wet = [];
    ok.forEach(r => { const hi = r.daily.temperature_2m_max[i], lo = r.daily.temperature_2m_min[i], p = r.daily.precipitation_sum[i]; if (hi != null) his.push(hi); if (lo != null) los.push(lo); if (p != null) wet.push(p >= 0.04); });
    const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
    days.push({ date: addDays(s, i), hi: avg(his), lo: avg(los), wet: wet.filter(Boolean).length, of: wet.length });
  }
  const yrs = years.filter((_, i) => runs[i]).map(y => y[2]);
  return { kind: 'typical', from: Math.min(...yrs), to: Math.max(...yrs), days };
}

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
function osmQuery(lat, lon) {
  const A = (r) => `(around:${r},${lat},${lon})`;
  return `[out:json][timeout:60];(
nwr["amenity"~"^(restaurant|cafe|bar|pub|fast_food)$"]["name"]${A(900)};
nwr["amenity"="pharmacy"]["name"]${A(1200)};
nwr["shop"~"^(supermarket|convenience|greengrocer)$"]["name"]${A(800)};
nwr["tourism"~"^(hotel|hostel|guest_house|motel)$"]["name"]${A(2500)};
nwr["railway"~"^(station|halt|tram_stop)$"]${A(1500)};
node["public_transport"="station"]${A(1500)};
node["highway"="bus_stop"]${A(400)};
nwr["amenity"="bicycle_rental"]${A(700)};
nwr["amenity"="ferry_terminal"]${A(2000)};
nwr["tourism"~"^(attraction|museum|gallery|viewpoint|zoo|aquarium|theme_park)$"]["name"]${A(3000)};
);out center tags;`;
}
const osmKey = (lat, lon) => `osm:${(+lat).toFixed(4)},${(+lon).toFixed(4)}`;
// Hotels, sights and stations around the venue: Google Places first; the OpenStreetMap servers only when Google has no key or refuses it.
async function nearby(lat, lon) {
  if (GKEY && !gpBroken) {
    try { return await gNearbyAll(lat, lon); }
    catch (e) { if (/places 4(00|03|29)/.test(e.message)) gpBroken = true; }
  }
  return osmNearby(lat, lon);
}
async function osmNearby(lat, lon) {
  const key = osmKey(lat, lon);
  const snap = window.OSM_SNAPSHOTS && window.OSM_SNAPSHOTS[key]; if (snap) return snap;
  const c = LS.get('c4:' + key); if (c && Date.now() - c.t < 864e5) return c.d;
  if (memo.has(key)) return memo.get(key);
  const q = osmQuery(lat, lon);
  // Public servers, gently hedged: ask the next server only if the current one fails or is still busy after 12 s.
  const p = new Promise((resolve, reject) => {
    let i = 0, pending = 0, done = false, lastErr;
    const next = () => {
      if (done) return;
      if (i >= OVERPASS.length) { if (!pending) reject(lastErr || new Error('Overpass unavailable')); return; }
      const ep = OVERPASS[i++]; pending++; const hedge = setTimeout(next, 12000);
      getJSON(ep, { key: key + ep, ttl: 0, timeout: 90000, init: { method: 'POST', body: 'data=' + enc(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } })
        .then(d => { clearTimeout(hedge); if (done) return; done = true; const out = classify(d.elements || [], lat, lon); cacheSet(key, out); resolve(out); })
        .catch(e => { clearTimeout(hedge); lastErr = e; pending--; next(); });
    };
    next();
  });
  memo.set(key, p); p.catch(() => memo.delete(key));
  return p;
}
function classify(els, lat, lon) {
  const food = [], places = [], hotels = [], sights = [], transit = { subway: [], rail: [], tram: [], bus: [], bike: [], ferry: [] };
  for (const el of els) {
    const t = el.tags || {}; const la = el.lat ?? el.center?.lat, lo = el.lon ?? el.center?.lon; if (la == null) continue;
    const d = distM(lat, lon, la, lo);
    const base = { name: t.name || '', wheelchair: t.wheelchair || '', lat: la, lon: lo, d, website: t.website || t['contact:website'] || '', street: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') };
    const more = { city: t['addr:city'] || '', hours: t.opening_hours || '', phone: t.phone || t['contact:phone'] || '' };
    if (/^(restaurant|cafe|bar|pub|fast_food)$/.test(t.amenity)) {
      const diet = {}; ['gluten_free', 'vegan', 'vegetarian', 'halal', 'kosher'].forEach(k => { if (t['diet:' + k]) diet[k] = t['diet:' + k]; });
      const cuisines = (t.cuisine || '').split(';').map(x => x.trim().toLowerCase()).filter(Boolean).slice(0, 4);
      food.push({ ...base, ...more, kind: t.amenity === 'pub' ? 'bar' : t.amenity, cuisine: cuisines.slice(0, 2).map(x => x.replace(/_/g, ' ')).join(', '), cuisines, diet,
        price: t['price:range'] || t.price_range || '', outdoor: t.outdoor_seating || '', takeaway: t.takeaway || '' });
    } else if (t.amenity === 'pharmacy') {
      places.push({ ...base, ...more, kind: 'pharmacy' });
    } else if (/^(supermarket|convenience|greengrocer)$/.test(t.shop)) {
      places.push({ ...base, ...more, kind: 'grocery' });
    } else if (/^(attraction|museum|gallery|viewpoint|zoo|aquarium|theme_park)$/.test(t.tourism)) {
      sights.push({ ...base, kind: t.tourism.replace('_', ' ') });
    } else if (t.tourism) {
      hotels.push({ ...base, kind: t.tourism.replace('_', ' '), stars: t.stars || '' });
    } else if (t.amenity === 'bicycle_rental') {
      transit.bike.push({ ...base, name: t.name || [t.network || t.operator, t.ref].filter(Boolean).join(' ') || 'Bike rental', line: t.network || t.operator || '' });
    } else if (t.amenity === 'ferry_terminal') {
      transit.ferry.push({ ...base, name: t.name || 'Ferry terminal', line: t.operator || '' });
    } else if (t.highway === 'bus_stop') {
      if (t.name) transit.bus.push({ ...base, line: t.route_ref || '' });
    } else if (t.name) {
      const line = t.line || t.route_ref || t.network || '';
      const subway = t.station === 'subway' || t.subway === 'yes';
      const tram = t.railway === 'tram_stop' || t.station === 'light_rail' || t.light_rail === 'yes' || t.tram === 'yes';
      if (subway) transit.subway.push({ ...base, line });
      else if (tram) transit.tram.push({ ...base, line });
      else if (t.railway === 'station' || t.railway === 'halt' || t.train === 'yes') transit.rail.push({ ...base, line });
    }
  }
  const dedupe = (arr, n) => { const seen = new Set(); return arr.sort((a, b) => a.d - b.d).filter(x => { const k = x.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, n); };
  const r = { food: dedupe(food, 150), places: dedupe(places, 40), hotels: dedupe(hotels, 30), sights: dedupe(sights, 12), transit: {} };
  for (const k in transit) r.transit[k] = dedupe(transit[k], k === 'bus' ? 4 : 3);
  return r;
}

// ---------- deep links ----------
const enDay = (d) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(asUTC(d)).replace(',', '');
const L = {
  gflights: (to, from, d1, d2) => `https://www.google.com/travel/flights?q=${enc(`Flights to ${to}${from ? ' from ' + from : ''} on ${d1} through ${d2}`)}`,
  kayak: (from, to, d1, d2) => `https://www.kayak.com/flights/${from}-${to}/${d1}/${d2}`,
  // Google Hotels only honours dates written into the query
  ghotels: (q, d1, d2) => `https://www.google.com/travel/hotels?q=${enc(`${q} hotels ${enDay(d1)} to ${enDay(d2)}`)}`,
  booking: (q, d1, d2, n) => `https://www.booking.com/searchresults.html?ss=${enc(q)}&checkin=${d1}&checkout=${d2}&group_adults=${n}&no_rooms=1`,
  airbnb: (q, d1, d2, n) => `https://www.airbnb.com/s/${enc(q.replace(/, /g, '--').replace(/ /g, '-'))}/homes?checkin=${d1}&checkout=${d2}&adults=${n}`,
  gyg: (q, d1, d2) => `https://www.getyourguide.com/s/?q=${enc(q)}&date_from=${d1}&date_to=${d2}`,
  airbnbExp: (q, d1, d2) => `https://www.airbnb.com/s/${enc(q.replace(/, /g, '--').replace(/ /g, '-'))}/experiences?checkin=${d1}&checkout=${d2}`,
  kayakCars: (iata, d1, d2) => `https://www.kayak.com/cars/${iata}/${d1}/${d2}`,
  rome2rio: (from, to) => `https://www.rome2rio.com/map/${enc(from.replace(/ /g, '-'))}/${enc(to.replace(/ /g, '-'))}`,
  transit: (from, v) => `https://www.google.com/maps/dir/?api=1&origin=${enc(from)}&destination=${v.lat},${v.lon}&travelmode=transit`,
  route: (a, v) => `https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lon}&destination=${v.lat},${v.lon}&travelmode=driving`,
  dir: (v, mode) => `https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lon}&travelmode=${mode}`,
  place: (name, extra) => `https://www.google.com/maps/search/?api=1&query=${enc([name, extra].filter(Boolean).join(', '))}`,
  uber: (v, name) => `https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff%5Blatitude%5D=${v.lat}&dropoff%5Blongitude%5D=${v.lon}&dropoff%5Bnickname%5D=${enc(name)}`,
  lyft: (v) => `https://lyft.com/ride?id=lyft&destination%5Blatitude%5D=${v.lat}&destination%5Blongitude%5D=${v.lon}`,
  opentable: (name, v, date, n) => `https://www.opentable.com/s?term=${enc(name)}&latitude=${v.lat}&longitude=${v.lon}&covers=${n}${date ? `&dateTime=${date}T19%3A00` : ''}`,
  gcal: (cfg, url) => {
    const w = eventSpan(cfg); const dates = w.allDay ? `${w.s.replace(/-/g, '')}/${w.e.replace(/-/g, '')}` : `${icsStamp(w.s)}/${icsStamp(w.e)}`;
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${enc(cfg.title)}&dates=${dates}&details=${enc((cfg.tagline ? cfg.tagline + '\n\n' : '') + url)}&location=${enc(venueLine(cfg.venue))}${cfg.tz ? '&ctz=' + enc(cfg.tz) : ''}`;
  }
};
const LYFT_CC = new Set(['us', 'ca']);
const TRAINLINE_CC = new Set(['gb', 'fr', 'de', 'it', 'es', 'nl', 'be', 'at', 'ch', 'pt', 'ie', 'dk', 'se', 'cz', 'pl', 'lu']);
const venueLine = (v) => v ? [v.name, v.address && !v.address.startsWith(v.name) ? v.address : (v.address && v.address !== v.name ? v.address : '')].filter(Boolean).join(', ') : '';
const placeLabel = (v) => [v.city, v.cc === 'us' ? v.region : v.country].filter(Boolean).join(', ');

// brand lockup: one tilted chain link (three solid sides, the fourth a dotted coral leg back to the start dot), then "1LinkTrip" with a coral 1
const BRAND = '<svg class="brand-mark" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><g transform="rotate(-45 20 20)"><path d="M13 27.2 H27 A7.2 7.2 0 0 0 27 12.8 H13" fill="none" stroke="#0F4A50" stroke-width="4.2" stroke-linecap="round"/><path d="M13 12.8 A7.2 7.2 0 0 0 13 27.2" fill="none" stroke="#E35B47" stroke-width="3.4" stroke-linecap="round" stroke-dasharray="0.1 4.4"/><circle cx="13" cy="27.2" r="3.6" fill="#0F4A50"/></g></svg><span class="wm"><span class="one">1</span>LinkTrip</span>';
// ---------- event model ----------
const FONTS = {
  field: { label: 'Classic', css: "'Newsreader', Georgia, serif", gf: null },
  grotesk: { label: 'Modern', css: "'Bricolage Grotesque', system-ui, sans-serif", gf: 'Bricolage+Grotesque:opsz,wght@12..96,400..800' },
  serif: { label: 'Elegant', css: "'Fraunces', Georgia, serif", gf: 'Fraunces:opsz,wght@9..144,400..800' },
  classic: { label: 'Formal', css: "'Cormorant Garamond', Georgia, serif", gf: 'Cormorant+Garamond:wght@500;600;700' },
  condensed: { label: 'Bold', css: "'Big Shoulders Display', 'Arial Narrow', sans-serif", gf: 'Big+Shoulders+Display:wght@600..900' },
  wide: { label: 'Wide', css: "'Unbounded', system-ui, sans-serif", gf: 'Unbounded:wght@400..800' }
};
const TYPES = ['Wedding', 'Conference', 'Concert', 'Performance', 'Race', 'Hyrox', 'Sporting event', 'Festival', 'Bachelor party', 'Bachelorette party', 'Birthday', 'Reunion', 'Retreat', 'Meetup', 'Party', 'Other', 'Trip'];
const TYPE_LABEL = { Trip: 'Vacation / Trip' };
// a trip has a destination instead of a venue, a day-by-day itinerary instead of a schedule, and no RSVP
const isTrip = (cfg) => cfg && cfg.type === 'Trip';
// ---------- type-specific details: fields appear in the editor only for that type; on the page only if filled ----------
// field: [key, label, kind, placeholder]; kinds: text, url, date, time, datetime, place {q,lat,lon}, links [{label,url}], lines
const TYPE_FIELDS = {
  Trip: { name: 'Trip details', fields: [['stops', 'Other stops', 'lines', 'One place per line, e.g. Sintra'], ['companions', 'Travelling together', 'text', 'Names']] },
  Wedding: { name: 'Wedding details', fields: [
    ['rsvp', 'RSVP link', 'url', 'https://…'], ['rsvpBy', 'RSVP by', 'date'], ['dress', 'Dress code', 'text', 'Beach formal'],
    ['registry', 'Registry', 'links'],
    ['blockHotel', 'Room block hotel', 'text', 'Hotel name'], ['blockUrl', 'Room block booking link', 'url', 'https://…'],
    ['blockCode', 'Room block code', 'text', 'Group code'], ['blockBy', 'Book the room block by', 'date']] },
  Race: { name: 'Race day', fields: [
    ['startAt', 'Start', 'place', 'Start line location'], ['finishAt', 'Finish', 'place', 'Finish line location'],
    ['packet', 'Packet pickup', 'text', 'Where'], ['packetWhen', 'Packet pickup time', 'datetime'],
    ['course', 'Course map', 'url', 'Link, GPX or image URL'], ['spots', 'Spectator spots', 'lines', 'One per line'],
    ['closures', 'Road closures', 'text', 'Which roads, and when'], ['closuresUrl', 'Road closures link', 'url', 'https://…']] },
  Concert: { name: 'Show info', fields: [
    ['doors', 'Doors', 'time'], ['opener', 'Opener', 'text', 'Act name'], ['openerAt', 'Opener on at', 'time'],
    ['headliner', 'Headliner', 'text', 'Act name'], ['headlinerAt', 'Headliner on at', 'time'],
    ['setlist', 'Setlist', 'url', 'https://…'], ['bags', 'Bag policy', 'text', 'Clear bags only'],
    ['parking', 'Parking', 'text'], ['pickup', 'Rideshare pickup spot', 'text']] },
  Performance: { name: 'Show info', fields: [
    ['performer', 'Performer', 'text', 'Name'], ['doors', 'Doors', 'time'], ['showtime', 'Showtime', 'time'],
    ['callTime', 'Performer call time', 'time'], ['slot', 'Performer\'s slot', 'text', 'Act 2, no. 14'], ['program', 'Program or run order', 'url', 'https://…'],
    ['tickets', 'Tickets', 'url', 'https://…'], ['flowers', 'Flowers and gifts', 'text', 'Welcome after the show'],
    ['photo', 'Photo and video policy', 'text', 'No flash, no video'], ['parking', 'Parking', 'text']] },
  Hyrox: { name: 'Race day', fields: [
    ['division', 'Division', 'text', 'Open, Pro, Doubles or Relay'], ['wave', 'Wave start', 'time'],
    ['checkin', 'Check-in and wristband pickup', 'text', 'Where'], ['checkinWhen', 'Check-in time', 'datetime'],
    ['bagdrop', 'Bag drop', 'text', 'Where, what to leave'], ['spectators', 'Spectator info', 'text', 'Tickets, where to watch'],
    ['results', 'Live results', 'url', 'https://…'], ['parking', 'Parking', 'text']] },
  'Sporting event': { name: 'Game day', fields: [
    ['seating', 'Seating chart', 'url', 'https://…'], ['teams', 'Teams', 'links'],
    ['tailgate', 'Tailgating', 'text'], ['parking', 'Parking', 'text'], ['bags', 'Bag policy', 'text', 'Clear bags only']] },
  Conference: { name: 'Attending', fields: [
    ['badge', 'Badge pickup', 'text', 'Where'], ['badgeWhen', 'Badge pickup time', 'datetime'],
    ['agenda', 'Full agenda', 'url', 'https://…'], ['speakers', 'Speakers', 'lines', 'One per line: Name, talk']] }
};
const typeSpec = (cfg) => TYPE_FIELDS[cfg.type] || null;
const typeData = (cfg) => (cfg.x && cfg.x[cfg.type]) || {};
const filled = (kind, val) => kind === 'links' ? (val || []).some(l => l.label && l.url) : kind === 'place' ? !!(val && val.q) : !!(val && String(val).trim());
const hasTypeInfo = (cfg) => { const sp = typeSpec(cfg), d = typeData(cfg); return !!sp && sp.fields.some(([k, , kind]) => filled(kind, d[k])); };
const LAGOON = '#0F4A50'; // default accent (brand Lagoon); replaced the earlier Forest #1F3A2E
const SWATCHES = [LAGOON, '#0B7A75', '#FF6B35', '#C2185B', '#6D28D9', '#B8860B', '#1F2937', '#2E7D32'];

const packEvent = (c) => LZString.compressToEncodedURIComponent(JSON.stringify(c));
function unpackEvent(s) { try { const j = LZString.decompressFromEncodedURIComponent(s); return j ? normalize(JSON.parse(j)) : null; } catch { return null; } }
const shareURL = (c) => `${location.origin}${location.pathname}#e=${packEvent(c)}`;

function loadFont(key) {
  const f = FONTS[key]; if (!f || !f.gf || document.querySelector(`link[data-font="${key}"]`)) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.dataset.font = key;
  l.href = `https://fonts.googleapis.com/css2?family=${f.gf}&display=swap`; document.head.appendChild(l);
}
function onAccent(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#fff';
  const n = parseInt(m[1], 16), ch = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return lum > 0.36 ? '#111318' : '#ffffff';
}
const themeStyle = (t) => `--accent:${t.accent};--on-accent:${onAccent(t.accent)};--display:${FONTS[t.font]?.css || FONTS.field.css}`;

// ---------- ICS ----------
function icsText(cfg, url) {
  const escI = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const fold = (line) => { const out = []; let cur = ''; for (const ch of line) { if (new Blob([cur + ch]).size > 74) { out.push(cur); cur = ' ' + ch; } else cur += ch; } out.push(cur); return out.join('\r\n'); };
  const now = icsStamp(new Date()); const uidBase = Math.abs([...cfg.title + cfg.start].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7));
  const ev = (uid, title, s, e, desc) => ['BEGIN:VEVENT', `UID:${uid}-${uidBase}@eventpages`, `DTSTAMP:${now}`, ...(typeof s === 'string' ? [`DTSTART;VALUE=DATE:${s.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${e.replace(/-/g, '')}`] : [`DTSTART:${icsStamp(s)}`, `DTEND:${icsStamp(e)}`]), `SUMMARY:${escI(title)}`, `LOCATION:${escI(venueLine(cfg.venue))}`, `DESCRIPTION:${escI(desc)}`, `URL:${url}`, 'END:VEVENT'];
  const { s, e } = eventSpan(cfg);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//1LinkTrip//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escI(cfg.title)}`];
  lines.push(...ev('main', cfg.title, s, e, [cfg.tagline, url].filter(Boolean).join('\n\n')));
  cfg.schedule.filter(x => x.date && x.time && x.title).forEach((x, i) => {
    const st = wallToUTC(`${x.date}T${x.time}`, cfg.tz);
    lines.push(...ev('s' + i, `${x.title} · ${cfg.title}`, st, new Date(st.getTime() + 3600e3), [x.note, url].filter(Boolean).join('\n\n')));
  });
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n');
}
function downloadICS(cfg) {
  const blob = new Blob([icsText(cfg, location.href)], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = (cfg.title || 'event').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '.ics';
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------- event page rendering ----------
const ext = (href, label, cls = 'btn') => `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
const arrow = '<svg class="arr" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 11L11 5M6 5h5v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
let renderSeq = 0;
const maps = new Set();

const loading = (what) => `<div class="skel" role="status"><span></span><span></span><span></span><em>${t('Loading {w}…', { w: what })}</em><em class="slow">${t('The map servers are busy. This can take up to a minute.')}</em></div>`;

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

function typeInfoHTML(cfg, opt = {}) {
  const sp = typeSpec(cfg), d = typeData(cfg); if (!sp) return '';
  const v = cfg.venue; const lab = Object.fromEntries(sp.fields.map(([k, l]) => [k, l]));
  const has = (k) => { const f = sp.fields.find(x => x[0] === k); return f && filled(f[2], d[k]); };
  const dt = (s) => s ? (s.length > 10 ? `${fmt(s.slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmtTime(s.slice(11, 16))}` : fmt(s, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })) : '';
  const linkRow = (label, url, sub) => `<li><a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><b>${esc(t(label))}</b><span>${esc(sub || hostOf(url))}</span>${arrow}</a></li>`;
  const noteRow = (label, text) => `<li class="note"><b>${esc(t(label))}</b><span>${esc(text)}</span></li>`;
  const placeURL = (p) => p.lat != null ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}` : L.place(p.q, v ? placeLabel(v) : '');
  const rows = []; const out = [];
  // time-line style rows (concert running order)
  const tl = [];
  if (has('callTime')) tl.push([d.callTime, t('Performer call time')]);
  if (has('doors')) tl.push([d.doors, t('Doors')]);
  if (has('showtime')) tl.push([d.showtime, t('Showtime')]);
  if (has('wave')) tl.push([d.wave, t('Wave start')]);
  if (has('openerAt') || has('opener')) tl.push([d.openerAt || '', d.opener || t(lab.opener)]);
  if (has('headlinerAt') || has('headliner')) tl.push([d.headlinerAt || '', d.headliner || t(lab.headliner)]);
  if (tl.length) out.push(`<ol class="tl">${tl.sort((a, b) => (a[0] || '99').localeCompare(b[0] || '99')).map(([tm, n]) => `<li><time>${esc(fmtTime(tm)) || '—'}</time><div><b>${esc(n)}</b></div></li>`).join('')}</ol>`);
  for (const [k, label, kind] of sp.fields) {
    if (['stops', 'doors', 'opener', 'openerAt', 'headliner', 'headlinerAt', 'rsvpBy', 'blockHotel', 'blockUrl', 'blockCode', 'blockBy', 'packetWhen', 'badgeWhen', 'checkinWhen', 'callTime', 'showtime', 'wave', 'closuresUrl', 'spots', 'speakers'].includes(k) || !filled(kind, d[k])) continue;
    const val = d[k];
    if (k === 'rsvp') rows.push(linkRow('RSVP', val, d.rsvpBy ? t('Reply by {d}', { d: dt(d.rsvpBy) }) : ''));
    else if (k === 'course' && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(val)) out.push(`<a class="course-img" href="${esc(val)}" target="_blank" rel="noopener noreferrer"><img src="${esc(val)}" alt="${t('Course map')}" loading="lazy" referrerpolicy="no-referrer"></a>`);
    else if (k === 'course') rows.push(linkRow('Course map', val, /\.gpx(\?|$)/i.test(val) ? t('GPX file') : ''));
    else if (k === 'closures') rows.push(d.closuresUrl ? linkRow('Road closures', d.closuresUrl, val) : noteRow('Road closures', val));
    else if (k === 'packet' || k === 'badge' || k === 'checkin') { const w = d[k + 'When']; rows.push(`<li><a href="${esc(L.place(val, v ? placeLabel(v) : ''))}" target="_blank" rel="noopener noreferrer"><b>${esc(t(label))}</b><span>${esc([val, dt(w)].filter(Boolean).join(' · '))}</span>${arrow}</a></li>`); }
    else if (kind === 'place') rows.push(`<li><a href="${esc(placeURL(val))}" target="_blank" rel="noopener noreferrer"><b>${esc(t(label))}</b><span>${esc(val.q)}</span>${arrow}</a></li>`);
    else if (kind === 'links') val.filter(l => l.label && l.url).forEach(l => rows.push(linkRow(label === 'Teams' || l.label.toLowerCase() === label.toLowerCase() ? l.label : `${label} · ${l.label}`, l.url)));
    else if (kind === 'url') rows.push(linkRow(label, val));
    else rows.push(noteRow(label, val));
  }
  if (!has('packet') && has('packetWhen')) rows.push(noteRow('Packet pickup', dt(d.packetWhen)));
  if (!has('badge') && has('badgeWhen')) rows.push(noteRow('Badge pickup', dt(d.badgeWhen)));
  if (!has('checkin') && has('checkinWhen')) rows.push(noteRow('Check-in and wristband pickup', dt(d.checkinWhen)));
  if (!has('rsvp') && has('rsvpBy')) rows.push(noteRow('RSVP', t('Reply by {d}', { d: dt(d.rsvpBy) })));
  if (!has('closures') && has('closuresUrl')) rows.push(linkRow('Road closures', d.closuresUrl));
  if (rows.length) out.push(`<ul class="links">${rows.join('')}</ul>`);
  if (!opt.skipBlock && ['blockHotel', 'blockUrl', 'blockCode', 'blockBy'].some(has)) {
    const sub = [d.blockCode ? t('Code {c}', { c: d.blockCode }) : '', d.blockBy ? t('Book by {d}', { d: dt(d.blockBy) }) : ''].filter(Boolean).join(' · ');
    out.push(`<h3 class="sub-h">${t('Room block')}</h3><ul class="links">${d.blockUrl ? linkRow(d.blockHotel || t('Book the room block'), d.blockUrl, sub || hostOf(d.blockUrl)) : noteRow(d.blockHotel || 'Room block', sub)}</ul>`);
  }
  const lines = (k) => String(d[k] || '').split('\n').map(x => x.trim()).filter(Boolean);
  if (has('stops')) out.push(`<h3 class="sub-h">${esc(t(lab.stops))}</h3><ul class="links">${lines('stops').map(x => `<li><a href="${esc(L.place(x, v ? (v.country || '') : ''))}" target="_blank" rel="noopener noreferrer"><b>${esc(x)}</b><span>Google Maps</span>${arrow}</a></li>`).join('')}</ul>`);
  if (has('spots')) out.push(`<h3 class="sub-h">${esc(t(lab.spots))}</h3><ul class="links">${lines('spots').map(x => `<li><a href="${esc(L.place(x, v ? placeLabel(v) : ''))}" target="_blank" rel="noopener noreferrer"><b>${esc(x)}</b><span>Google Maps</span>${arrow}</a></li>`).join('')}</ul>`);
  if (has('speakers')) out.push(`<h3 class="sub-h">${esc(t(lab.speakers))}</h3><ul class="links">${lines('speakers').map(x => { const [n, ...r] = x.split(/\s+[—–-]\s+|,\s+/); return `<li class="note"><b>${esc(n)}</b>${r.length ? `<span>${esc(r.join(', '))}</span>` : ''}</li>`; }).join('')}</ul>`);
  return out.join('');
}
// ---------- my itinerary (guest-side, stays in this browser) ----------
// parseReservation is the single seam: today heuristics, later a server/AI importer can replace it with the same output shape.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const AIRLINES = {
  UA: ['United', 'https://www.united.com/en/us/manageres/mytrips'], AA: ['American', 'https://www.aa.com/reservation/view/find-your-trip'],
  DL: ['Delta', 'https://www.delta.com/my-trips/search'], WN: ['Southwest', 'https://www.southwest.com/air/manage-reservation/'],
  B6: ['JetBlue', 'https://www.jetblue.com/manage-trips'], AS: ['Alaska', 'https://www.alaskaair.com/booking/reservation-lookup'],
  AC: ['Air Canada', 'https://www.aircanada.com/us/en/aco/home/book/manage-bookings.html'], BA: ['British Airways', 'https://www.britishairways.com/travel/managebooking/public/en_us'],
  AM: ['Aeromexico', 'https://www.aeromexico.com/en-us/manage-your-booking'], LH: ['Lufthansa', 'https://www.lufthansa.com/us/en/my-bookings'],
  NK: ['Spirit', ''], F9: ['Frontier', ''], Y4: ['Volaris', ''], VB: ['Viva Aerobus', ''], AF: ['Air France', ''], KL: ['KLM', ''], HA: ['Hawaiian', ''], WS: ['WestJet', '']
};
const AIRLINE_NAMES = Object.entries(AIRLINES).map(([c, [n]]) => [c, n]);
const VENDORS = [
  [/airbnb/i, 'stay', 'Airbnb'], [/vrbo/i, 'stay', 'Vrbo'],
  [/hertz/i, 'car', 'Hertz'], [/\bavis\b/i, 'car', 'Avis'], [/enterprise rent|enterprise\.com|\benterprise\b.*(rental|car)/i, 'car', 'Enterprise'], [/budget (rent|car)|budget\.com/i, 'car', 'Budget'],
  [/national car|nationalcar\.com/i, 'car', 'National'], [/\bsixt\b/i, 'car', 'Sixt'], [/\balamo\b/i, 'car', 'Alamo'], [/thrifty/i, 'car', 'Thrifty'], [/\bturo\b/i, 'car', 'Turo'],
  [/opentable/i, 'food', 'OpenTable'], [/\bresy\b/i, 'food', 'Resy'], [/exploretock|\btock\b/i, 'food', 'Tock'],
  [/amtrak/i, 'train', 'Amtrak'], [/eurostar/i, 'train', 'Eurostar'], [/trainline/i, 'train', 'Trainline'], [/\bsncf\b/i, 'train', 'SNCF'], [/\brenfe\b/i, 'train', 'Renfe'], [/via rail/i, 'train', 'VIA Rail'],
  [/marriott/i, 'hotel', 'Marriott'], [/hilton/i, 'hotel', 'Hilton'], [/hyatt/i, 'hotel', 'Hyatt'], [/\bihg\b|holiday inn/i, 'hotel', 'IHG'], [/booking\.com/i, 'hotel', 'Booking.com'], [/hotels\.com/i, 'hotel', 'Hotels.com'], [/expedia/i, 'hotel', 'Expedia']
];
const ITIN_KINDS = { flight: 'Flight', hotel: 'Hotel', stay: 'Rental home', car: 'Rental car', food: 'Restaurant', train: 'Train', other: 'Other' };

function parseReservation(text, refDate) {
  const raw = String(text || ''); const r = { kind: '', name: '', start: '', end: '', address: '', confNo: '', link: '', flight: '', note: '' };
  if (!raw.trim()) return r;
  const lines = raw.split(/\r?\n/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const url = raw.match(/https?:\/\/[^\s<>"')]+/i); if (url) r.link = url[0].replace(/[.,;]+$/, '');
  const host = r.link ? hostOf(r.link) : '';
  // vendor + kind
  const vendor = VENDORS.find(([re]) => re.test(raw) || (host && re.test(host)));
  const fl = raw.match(/\b(?:flight|flt)\s*(?:number|no\.?|#)?\s*:?\s*([A-Z0-9]{2})\s?(\d{1,4})\b/i) || raw.match(/\b(UA|AA|DL|WN|B6|AS|AC|BA|AM|LH|NK|F9|Y4|VB|AF|KL|HA|WS)\s?(\d{1,4})\b/);
  if (fl && AIRLINES[fl[1].toUpperCase()]) { r.kind = 'flight'; r.flight = fl[1].toUpperCase() + ' ' + fl[2]; }
  else if (fl && /\bflight\b/i.test(raw)) { r.kind = 'flight'; r.flight = fl[1].toUpperCase() + ' ' + fl[2]; }
  else if (vendor) r.kind = vendor[1];
  else if (/\b(rental car|car rental|pick[- ]?up location|drop[- ]?off)\b/i.test(raw)) r.kind = 'car';
  else if (/\b(table for|party of|reservation at|covers?)\b/i.test(raw)) r.kind = 'food';
  else if (/\b(train|coach \d|platform|rail)\b/i.test(raw)) r.kind = 'train';
  else if (/\b(check[- ]?in|check[- ]?out|hotel|room|nights?)\b/i.test(raw)) r.kind = 'hotel';
  // name
  const lab = (re) => { for (const l of lines) { const m = l.match(re); if (m && m[1].trim()) return m[1].trim(); } return ''; };
  if (r.kind === 'flight') { const a = AIRLINES[r.flight.split(' ')[0]]; r.name = [a ? a[0] : '', r.flight].filter(Boolean).join(' '); }
  else r.name = lab(/^(?:hotel|property|restaurant|listing|accommodation|venue)\s*(?:name)?\s*[:\-–]\s*(.+)$/i)
    || ((raw.match(/\b(?:reservation|table|booking|stay) at ([A-Z][^\n,.!]{2,60})/) || [])[1] || '').replace(/\s+(is|has been|was)\b.*$/i, '').trim()
    || (r.kind === 'hotel' ? lines.find(l => l.length < 70 && /\b(hotel|inn|resort|suites|lodge)\b/i.test(l) && !/confirm|reservation|check/i.test(l)) || '' : '')
    || (r.kind === 'car' ? lab(/^pick[- ]?up location\s*[:\-–]\s*(.+)$/i) : '')
    || (vendor ? vendor[2] : '');
  // confirmation number
  for (const cm of raw.matchAll(/\b(?:confirmation|conf\.|booking|reservation|record locator|pnr|itinerary)\b\s*(?:number|no\.?|code|#|id)?\s*[:#]?\s*#?\s*([A-Z0-9][A-Z0-9-]{4,})\b/gi)) {
    if (/\d/.test(cm[1]) || /^[A-Z]{6}$/.test(cm[1])) { r.confNo = cm[1].toUpperCase(); break; }
  }
  // address: labelled, else a street-looking line
  const ai = lines.findIndex(l => /^(address|location)\s*:?$/i.test(l));
  r.address = lab(/^(?:address|location|pick[- ]?up location)\s*[:\-–]\s*(.+\d.+)$/i)
    || (ai >= 0 && lines[ai + 1] && lines[ai + 1].length < 120 ? lines[ai + 1] : '')
    || lines.find(l => /^(carretera|calle|avenida|av\.|rue|via|camino)\b|\bkm\s*\d/i.test(l) && /\d/.test(l) && l.length < 120 && !/confirm|reserv/i.test(l))
    || lines.find(l => /^\d+[A-Za-z]?\s+[\w .'-]+\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|way|ln|lane|pl|place|plaza|pkwy|parkway|hwy|highway|carretera|calle|av\.?)\b/i.test(l) && l.length < 120) || '';
  // dates and times
  const ref = refDate ? asUTC(refDate) : new Date();
  const mk = (y, mo, d) => { if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return ''; if (!y) { const cands = [ref.getUTCFullYear() - 1, ref.getUTCFullYear(), ref.getUTCFullYear() + 1].map(yy => `${yy}-${pad(mo)}-${pad(d)}`); return cands.sort((a, b) => Math.abs(asUTC(a) - ref) - Math.abs(asUTC(b) - ref))[0]; } return `${y < 100 ? 2000 + y : y}-${pad(mo)}-${pad(d)}`; };
  const DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?|\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?(?:\s+(\d{4}))?|\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/gi;
  const datesIn = (l) => [...l.matchAll(DATE_RE)].map(m => m[1] ? mk(+m[1], +m[2], +m[3]) : m[4] ? mk(+m[6] || 0, MONTHS.indexOf(m[4].toLowerCase()) + 1, +m[5]) : m[8] ? mk(+m[9] || 0, MONTHS.indexOf(m[8].toLowerCase()) + 1, +m[7]) : mk(+m[12], +m[10], +m[11])).filter(Boolean);
  const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?(?![a-z])|\b(noon)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/gi;
  const timesIn = (l) => [...l.matchAll(TIME_RE)].map(m => { if (m[4]) return '12:00'; if (m[3]) { let h = +m[1] % 12; if (/p/i.test(m[3])) h += 12; return `${pad(h)}:${m[2] || '00'}`; } return `${pad(+m[5])}:${m[6]}`; });
  const dateIn = (l) => datesIn(l)[0] || '', timeIn = (l) => timesIn(l)[0] || '';
  const START = /check[- ]?in|pick[- ]?up(?! location)|\bdepart(s|ure|ing)?\b|\bleaves?\b|boarding|reservation (date|time)|^date\b|^when\b|^time\b/i;
  const END = /check[- ]?out|drop[- ]?off|\breturn\b|\barriv(al|es|e|ing)\b|^until\b/i;
  const labelled = (l) => START.test(l) || END.test(l);
  const grab = (isStart) => {
    const re = isStart ? START : END; let lastDate = '';
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]; const m = l.match(re);
      if (!m) { lastDate = dateIn(l) || lastDate; continue; }
      const sm = l.match(START), em = l.match(END);
      const both = sm && em; const col = both && !isStart && sm.index < em.index ? 1 : 0;
      // the part of the line that belongs to this label
      let seg = l.slice(m.index); if (both) { const other = isStart ? em : sm; if (other.index > m.index) seg = l.slice(m.index, other.index); }
      const next = [lines[i + 1], lines[i + 2]].filter(x => x && !labelled(x));
      const d = dateIn(seg) || (next.map(datesIn).find(x => x.length > col) || [])[col] || lastDate;
      const t = timeIn(seg) || (next.map(timesIn).find(x => x.length > col) || [])[col] || '';
      if (d) return d + (t ? 'T' + t : '');
      lastDate = dateIn(l) || lastDate;
    }
    return '';
  };
  r.start = grab(true); r.end = grab(false);
  if (!r.start) { // fall back to the first dated line, second dated line as the end
    const ds = []; lines.forEach(l => { const d = dateIn(l); if (d) ds.push(d + (timeIn(l) ? 'T' + timeIn(l) : '')); });
    if (ds[0]) r.start = ds[0]; if (!r.end && ds[1] && ds[1] !== ds[0]) r.end = ds[1];
  }
  if (r.end && r.start && r.end < r.start) r.end = '';
  return r;
}
const itinKey = (cfg) => 'itin:' + eventKey(cfg).slice(6);
const itinLoad = (cfg) => LS.get(itinKey(cfg), []) || [];
// "Flying into": the guest's arrival airport, one of the airports near the venue. One saved value per event (ap:<key>).
// Default: their saved pick → a flight in their bookings that lands at one of them → the closest large airport → the closest.
const apKey = (cfg) => 'ap:' + eventKey(cfg).slice(6);
const airFor = (cfg) => cfg.venue ? nearestAirports(cfg.venue.lat, cfg.venue.lon) : [];
function flightArrival(air, items) {
  const low = (x) => String(x || '').toLowerCase();
  const hit = (s) => air.find(a => new RegExp(`\\b${a.iata}\\b`).test(String(s || '')) || low(s).includes(low(a.name)) || (a.city && low(s).includes(low(a.city))));
  const fl = (items || []).filter(x => x && x.kind === 'flight').sort((a, b) => String(a.start || '').localeCompare(String(b.start || '')));
  for (const x of fl) { const m = String(x.note || '').match(/→\s*([^·]+)/); const a = (x.to && hit(x.to)) || (m && hit(m[1])); if (a) return a; }
  for (const x of fl) { const a = hit([x.name, x.address, x.note].join(' ')); if (a) return a; }
  return null;
}
function pickAirport(air, saved, items) {
  if (!air || !air.length) return null;
  return air.find(a => a.iata === saved) || flightArrival(air, items) || air.find(a => a.large) || air[0];
}
const chosenAirport = (cfg, air = airFor(cfg)) => pickAirport(air, LS.get(apKey(cfg)), itinLoad(cfg));
const canAddTrip = (cfg) => !!(cfg.tools && cfg.tools.mytrip && cfg.start);
// a prefilled booking card in My trip (the guest adds the confirmation later)
const addTripBtn = (cfg, kind, place, label) => canAddTrip(cfg) ? `<div class="add-trip"><button type="button" class="mini-b" data-addtrip="${kind}" data-at-place="${esc(place)}" data-at-label="${esc(label)}">+ ${t('Add to my trip')}</button></div>` : '';
function airportSelHTML(cfg, air, ap, always) {
  if (!ap || (air.length < 2 && !always)) return '';
  const v = cfg.venue;
  if (air.length < 2) return `<p class="ap-sel"><span>${t('Flying into')}</span> <b>${esc(ap.iata)}</b> ${esc(ap.name)}</p>`;
  return `<label class="pf-sel ap-sel"><span>${t('Flying into')}</span><select data-ap-sel>${air.map(a => `<option value="${esc(a.iata)}"${a.iata === ap.iata ? ' selected' : ''}>${esc(`${a.iata} · ${a.city || a.name} · ${fmtDist(a.d, v.cc)}`)}</option>`).join('')}</select></label>`;
}
const flightLinks = (f) => { const code = (f || '').replace(/\s+/g, '').toUpperCase(); if (!/^[A-Z0-9]{2}\d{1,4}$/.test(code)) return {}; const a = AIRLINES[code.slice(0, 2)]; return { status: `https://www.flightaware.com/live/flight/${code}`, manage: a && a[1] ? a[1] : '' }; };
function itinFormHTML(x, i, air = []) {
  const k = x.kind || '';
  const f = (key, label, type = 'text', ph = '', cls = '') => `<div class="field ${cls}"><label for="it-${key}">${t(label)}</label><input id="it-${key}" type="${type === 'datetime-local' && isDate(x[key] || '') ? 'date' : type}" data-it="${key}" value="${esc(x[key] || '')}"${ph ? ` placeholder="${esc(ph)}"` : ''}></div>`;
  return `<form class="itin-form" onsubmit="return false">
    <div class="trip">
      <div class="field"><label for="it-kind">${t('Type')}</label><select id="it-kind" data-it="kind"><option value="">${t('Choose')}</option>${Object.entries(ITIN_KINDS).map(([v, l]) => `<option value="${v}" ${v === k ? 'selected' : ''}>${t(l)}</option>`).join('')}</select></div>
      ${f('flight', 'Flight number', 'text', 'UA 1234').replace('<div class="field', `<div${k === 'flight' ? '' : ' hidden'} class="field`)}
      ${f('to', 'Arriving at', 'text', air[0] ? air[0].iata : 'CUN').replace('<div class="field', `<div${k === 'flight' ? '' : ' hidden'} class="field`).replace('<input ', '<input list="it-to-list" autocapitalize="characters" ')}<datalist id="it-to-list">${air.map(a => `<option value="${esc(a.iata)}">${esc(a.name)}</option>`).join('')}</datalist>
      ${f('name', 'Name')}
      ${f('start', k === 'flight' ? 'Departs' : 'Starts', 'datetime-local')}${f('end', k === 'flight' ? 'Arrives' : 'Ends', 'datetime-local')}
      ${f('address', 'Address', 'text', '', 'wide')}
      ${f('confNo', 'Confirmation')}${f('link', 'Link', 'url', 'https://…')}
      ${f('note', 'Note', 'text', k === 'flight' ? t('Confirmation code, last name') : '', 'wide')}
    </div>
    <div class="btns"><button type="button" class="btn primary" data-itin-save="${i == null ? '' : i}">${t('Save')}</button><button type="button" class="btn ghost" data-itin-cancel>${t('Cancel')}</button>${i != null ? `<button type="button" class="btn ghost" data-itin-del="${i}">${t('Remove')}</button>` : ''}</div>
  </form>`;
}
function itinICS(cfg) {
  const items = itinLoad(cfg).filter(x => x.start); const now = icsStamp(new Date());
  const esc2 = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const loc = (s) => s.replace(/[-:]/g, '') + (s.length === 16 ? '00' : '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//1LinkTrip//Itinerary//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc2('My trip · ' + cfg.title)}`];
  items.forEach((x, i) => {
    const allDay = x.start.length === 10; const fLinks = x.kind === 'flight' ? flightLinks(x.flight) : {};
    let end = x.end || (allDay ? addDays(x.start, 1) : null);
    if (!allDay && (!end || end.length === 10)) end = new Date(asUTC(x.start).getTime() + 3600e3).toISOString().slice(0, 16);
    lines.push('BEGIN:VEVENT', `UID:itin-${i}-${x.start.replace(/\D/g, '')}@eventpages`, `DTSTAMP:${now}`,
      allDay ? `DTSTART;VALUE=DATE:${x.start.replace(/-/g, '')}` : `DTSTART:${loc(x.start)}`,
      allDay ? `DTEND;VALUE=DATE:${end.slice(0, 10).replace(/-/g, '')}` : `DTEND:${loc(end)}`,
      `SUMMARY:${esc2(x.name || ITIN_KINDS[x.kind] || 'Reservation')}`, `LOCATION:${esc2(x.address)}`,
      `DESCRIPTION:${esc2([x.confNo ? 'Confirmation ' + x.confNo : '', x.note, fLinks.status, x.link].filter(Boolean).join('\n'))}`, 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'my-itinerary.ics';
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
// ---------- packing list (guest-side) ----------
// One table of rules. Each: [id, label (text or ctx => text), when(ctx) => bool]. Extend here.
const isT = (...ts) => (c) => ts.includes(c.type);
const PACK_RULES = [
  ['clothes', c => t('Clothes for {n} days', { n: c.days }), c => c.days > 1],
  ['toiletries', 'Toiletries', c => c.days > 1],
  ['charger', 'Phone charger', () => true],
  ['meds', 'Medications', () => true],
  ['passport', 'Passport', c => c.intl],
  ['adapter', c => c.plugs ? t('Plug adapter, type {p}', { p: c.plugs }) : t('Plug adapter'), c => c.adapter],
  ['photoid', 'Photo ID', c => c.mode.fly && !c.intl],
  ['boarding', 'Boarding pass', c => c.mode.fly],
  ['liquids', 'Liquids bag', c => c.mode.fly],
  ['license', "Driver's license", c => c.mode.rental || c.mode.drive],
  ['ccard', 'Credit card for the rental', c => c.mode.rental],
  ['traintix', 'Train tickets', c => c.mode.train],
  ['transitcard', 'Transit or contactless card', c => c.mode.transit],
  ['umbrella', 'Umbrella or rain jacket', c => c.wx.rain],
  ['coat', 'Winter coat, hat and gloves', c => c.wx.cold],
  ['layers', 'Warm layers', c => c.wx.cool],
  ['sunscreen', 'Sunscreen', c => c.wx.hot || c.beach],
  ['sunglasses', 'Sunglasses', c => c.wx.hot || c.beach],
  ['swimsuit', 'Swimsuit', c => c.beach],
  ['outfit', c => c.td.dress ? t('Outfit: {d}', { d: c.td.dress.split(/[.;]/)[0].trim() }) : t('Wedding outfit'), isT('Wedding')],
  ['gift', 'Card or gift', isT('Wedding')],
  ['runshoes', 'Running shoes', isT('Race')],
  ['racekit', 'Race-day kit', isT('Race')],
  ['bibpins', 'Safety pins for your bib', isT('Race')],
  ['gels', 'Energy gels', isT('Race')],
  ['trainshoes', 'Training shoes', isT('Hyrox')],
  ['gloves', 'Gloves', isT('Hyrox')],
  ['towel', 'Towel', isT('Hyrox')],
  ['waterbottle', 'Water bottle', isT('Hyrox')],
  ['changeclothes', 'Change of clothes', isT('Hyrox')],
  ['flowers', 'Flowers for the performer', c => c.type === 'Performance' && !/no flowers|flowers (are )?not/i.test(c.td.flowers || '')],
  ['clearbag', 'Clear bag', c => /clear/i.test(c.td.bags || '')],
  ['tickets', 'Tickets', isT('Concert', 'Sporting event', 'Festival', 'Performance')],
  ['earplugs', 'Earplugs', isT('Concert', 'Festival')],
  ['teamgear', 'Team gear', isT('Sporting event')],
  ['laptop', 'Laptop and charger', isT('Conference')],
  ['bizcards', 'Business cards', isT('Conference')],
  ['powerbank', 'Portable charger', isT('Festival', 'Concert', 'Conference', 'Race', 'Hyrox')]
];
// IEC plug types per country (lowercase ISO code)
const PLUGS = { us: 'AB', ca: 'AB', mx: 'AB', jp: 'AB', co: 'AB', pe: 'ABC', th: 'ABCO', tw: 'AB', ph: 'ABC', gb: 'G', ie: 'G', mt: 'G', cy: 'G', hk: 'G', sg: 'G', my: 'G', ae: 'G',
  fr: 'CE', be: 'CE', pl: 'CE', cz: 'CE', sk: 'CE', de: 'CF', nl: 'CF', es: 'CF', pt: 'CF', at: 'CF', se: 'CF', no: 'CF', fi: 'CF', gr: 'CF', is: 'CF', tr: 'CF', hr: 'CF', hu: 'CF', ro: 'CF', kr: 'CF', ru: 'CF', dk: 'CFK',
  it: 'CFL', ch: 'CJ', cl: 'CL', au: 'I', nz: 'I', ar: 'CI', cn: 'ACI', in: 'CDM', za: 'CDMN', br: 'CN', il: 'CH' };
const packKey = (cfg) => 'pack:' + eventKey(cfg).slice(6);
function packContext(cfg, art) {
  const v = cfg.venue; const tr = tripDates(cfg);
  const sel = art ? $$('.mode-bar [aria-pressed="true"]', art).map(b => b.dataset.tmode).filter(k => k !== 'all') : [];
  const o = LS.get('origin'); const oa = o && airportByCode(o);
  const home = oa ? String(oa[3]).toLowerCase() : ((navigator.language || '').split('-')[1] || '').toLowerCase();
  const intl = !!(v && v.cc && home && home !== v.cc);
  const hp = PLUGS[home], vp = v && PLUGS[v.cc];
  const adapter = intl && (!hp || !vp || ![...vp].some(x => hp.includes(x)));
  const w = art && art._wx; const wx = { rain: false, cold: false, cool: false, hot: false };
  if (w && w.days && w.days.length) {
    const lo = Math.min(...w.days.map(d => d.lo)), hi = Math.max(...w.days.map(d => d.hi));
    wx.rain = w.days.some(d => w.kind === 'typical' ? d.wet / (d.of || 1) >= 0.3 : (d.pop != null ? d.pop >= 40 : d.code >= 51 && d.code <= 99 && !(d.code >= 71 && d.code <= 77)));
    wx.cold = lo < 40; wx.cool = !wx.cold && lo < 60; wx.hot = hi >= 85;
  }
  return { type: cfg.type, td: typeData(cfg), days: Math.max(1, daysBetween(tr.arrive, tr.leave) + 1), mode: Object.fromEntries(sel.map(k => [k, true])),
    intl, adapter, plugs: adapter && vp ? [...vp].join('/') : '', wx, beach: !!(v && /\b(beach|playa|plage|praia|spiaggia|strand)\b/i.test(`${v.name} ${v.address || ''}`)) };
}
function packItems(cfg, art) {
  const st = LS.get(packKey(cfg), {}) || {}; const removed = st.removed || {}; const ctx = packContext(cfg, art);
  const host = String(cfg.bring || '').split('\n').map(s => s.trim()).filter(Boolean).map((text, i) => ({ id: 'h:' + text.toLowerCase(), text, host: true }));
  const auto = PACK_RULES.filter(([, , when]) => { try { return when(ctx); } catch { return false; } }).map(([id, label]) => ({ id, text: typeof label === 'function' ? label(ctx) : t(label) }));
  const own = (st.custom || []).map(x => ({ id: x.id, text: x.text }));
  return { st, host: host.filter(x => !removed[x.id]), rest: auto.concat(own).filter(x => !removed[x.id]) };
}
function packListHTML(cfg, art) {
  const { st, host, rest } = packItems(cfg, art); const done = st.done || {};
  const li = (x) => `<li class="${done[x.id] ? 'done' : ''}"><label><input type="checkbox" data-pack="${esc(x.id)}" ${done[x.id] ? 'checked' : ''}><span>${esc(x.text)}</span></label><button type="button" class="pack-x" data-pack-del="${esc(x.id)}" aria-label="${t('Remove')} ${esc(x.text)}">×</button></li>`;
  return `${host.length ? `<h3 class="sub-h">${t('From the host')}</h3><ul class="pack">${host.map(li).join('')}</ul>${rest.length ? `<h3 class="sub-h">${t('Also pack')}</h3>` : ''}` : ''}<ul class="pack">${rest.map(li).join('')}</ul>`;
}
function wirePacking(cfg, art) {
  const sec = art.querySelector('#sec-packing'); if (!sec) return;
  const list = sec.querySelector('[data-slot="pack-list"]'); const save = (st) => LS.set(packKey(cfg), st);
  const render = () => {
    list.innerHTML = packListHTML(cfg, art);
    const sum = sec.querySelector('[data-slot="pack-sum"]'); if (!sum) return;
    const { st, host, rest } = packItems(cfg, art); const all = host.concat(rest); const n = all.filter(x => (st.done || {})[x.id]).length;
    sum.innerHTML = `${esc(t('{n} of {m} packed', { n, m: all.length }))}<i><b style="width:${all.length ? Math.round(100 * n / all.length) : 0}%"></b></i>`;
  };
  art._pack = render; render();
  sec.addEventListener('change', (e) => { const id = e.target.dataset.pack; if (id == null) return; const st = LS.get(packKey(cfg), {}) || {}; st.done = st.done || {}; e.target.checked ? st.done[id] = true : delete st.done[id]; save(st); e.target.closest('li').classList.toggle('done', e.target.checked); render(); });
  sec.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pack-del]'); if (b) { const id = b.dataset.packDel; const st = LS.get(packKey(cfg), {}) || {}; if (id.startsWith('c:')) st.custom = (st.custom || []).filter(x => x.id !== id); else (st.removed = st.removed || {})[id] = true; save(st); render(); return; }
    if (e.target.closest('[data-pack-add]')) add();
  });
  const inp = sec.querySelector('.pack-add input');
  const add = () => { const text = inp.value.trim(); if (!text) return; const st = LS.get(packKey(cfg), {}) || {}; (st.custom = st.custom || []).push({ id: 'c:' + Date.now().toString(36), text }); save(st); inp.value = ''; render(); inp.focus(); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
}

// ---------- shopping list (guest-side): things to buy at the destination, optional city (route stop) and note ----------
// Stored per trip in localStorage like packing; signed-in guests' lists sync with the rest of My trip.
const shopKey = (cfg) => 'shop:' + eventKey(cfg).slice(6);
const shopLoad = (cfg) => LS.get(shopKey(cfg), []) || [];
const shopSave = (cfg, xs) => { LS.set(shopKey(cfg), xs); if (typeof syncPush === 'function' && LS.get('signedIn')) syncPush(cfg); };
function shopSecHTML(cfg) {
  const ss = stopsOf(cfg);
  return `<section class="ev-sec" id="sec-shop"><details class="pack-wrap"><summary><h2 class="sec-h">${t('Shopping list')}</h2><span class="pack-sum" data-slot="shop-sum"></span></summary><div data-slot="shop-list"></div>
    <div class="shop-add"><input data-shop-text placeholder="${t('Add something to buy')}" aria-label="${t('Add something to buy')}" maxlength="80">${ss.length > 1 ? `<select data-shop-city aria-label="${t('City')}"><option value="">${t('Any city')}</option>${ss.map(x => `<option value="${esc(x.name)}">${esc(x.name)}</option>`).join('')}</select>` : ''}<input data-shop-note placeholder="${t('Note (optional)')}" aria-label="${t('Note (optional)')}" maxlength="120"><button type="button" class="btn" data-shop-add>${t('Add')}</button></div></details></section>`;
}
function shopListHTML(cfg) {
  const xs = shopLoad(cfg); if (!xs.length) return `<p class="muted small">${t('Nothing on the list yet.')}</p>`;
  const order = xs.filter(x => !x.done).concat(xs.filter(x => x.done)); // checked items sink to the bottom
  return `<ul class="pack shop">${order.map(x => `<li class="${x.done ? 'done' : ''}"><label><input type="checkbox" data-shop="${esc(x.id)}" ${x.done ? 'checked' : ''}><span class="shop-t"><span>${esc(x.text)}</span>${x.city ? ` <em class="shop-city">${esc(x.city)}</em>` : ''}${x.note ? `<small>${esc(x.note)}</small>` : ''}</span></label><button type="button" class="pack-x" data-shop-del="${esc(x.id)}" aria-label="${t('Remove')} ${esc(x.text)}">×</button></li>`).join('')}</ul>`;
}
function wireShopping(cfg, art) {
  const sec = art.querySelector('#sec-shop'); if (!sec) return;
  const list = sec.querySelector('[data-slot="shop-list"]'), sum = sec.querySelector('[data-slot="shop-sum"]');
  const render = () => { list.innerHTML = shopListHTML(cfg); const xs = shopLoad(cfg); const n = xs.filter(x => x.done).length;
    sum.innerHTML = xs.length ? `${esc(t('{n} of {m} bought', { n, m: xs.length }))}<i><b style="width:${Math.round(100 * n / xs.length)}%"></b></i>` : ''; };
  art._shop = render; render();
  sec.addEventListener('change', (e) => { const id = e.target.dataset.shop; if (id == null) return; const xs = shopLoad(cfg); const x = xs.find(y => y.id === id); if (!x) return; x.done = e.target.checked; shopSave(cfg, xs); render(); });
  const txt = sec.querySelector('[data-shop-text]'), note = sec.querySelector('[data-shop-note]'), city = sec.querySelector('[data-shop-city]');
  const add = () => { const text = txt.value.trim(); if (!text) { txt.focus(); return; } const xs = shopLoad(cfg);
    xs.push({ id: 'sh' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), text: text.slice(0, 80), city: city ? city.value : '', note: note.value.trim().slice(0, 120), done: false });
    shopSave(cfg, xs); txt.value = ''; note.value = ''; render(); txt.focus(); };
  sec.addEventListener('click', (e) => {
    const b = e.target.closest('[data-shop-del]'); if (b) { shopSave(cfg, shopLoad(cfg).filter(x => x.id !== b.dataset.shopDel)); render(); return; }
    if (e.target.closest('[data-shop-add]')) add();
  });
  [txt, note].forEach(i => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }));
}

// ---------- booking providers: every outbound booking link goes through bookingLink() ----------
// mode: 'link' opens the provider's site; 'inapp' is reserved for a future in-app booking flow per provider.
const PROVIDERS = {
  gflights: { name: 'Google Flights', kinds: ['flights'], mode: 'link', url: (p) => L.gflights(p.to, p.from, p.d1, p.d2) },
  kayak: { name: 'Kayak', kinds: ['flights'], mode: 'link', url: (p) => L.kayak(p.from, p.to, p.d1, p.d2) },
  kayakCars: { name: 'Kayak', kinds: ['cars'], mode: 'link', url: (p) => L.kayakCars(p.iata, p.d1, p.d2) },
  ghotels: { name: 'Google Hotels', kinds: ['hotels'], mode: 'link', url: (p) => L.ghotels(p.q, p.d1, p.d2) },
  booking: { name: 'Booking.com', kinds: ['hotels'], mode: 'link', url: (p) => L.booking(p.q, p.d1, p.d2, p.n) },
  airbnb: { name: 'Airbnb', kinds: ['hotels'], mode: 'link', url: (p) => L.airbnb(p.q, p.d1, p.d2, p.n) },
  gyg: { name: 'GetYourGuide', kinds: ['tours'], mode: 'link', url: (p) => L.gyg(p.q, p.d1, p.d2) },
  airbnbExp: { name: 'Airbnb', kinds: ['tours'], mode: 'link', url: (p) => L.airbnbExp(p.q, p.d1, p.d2) },
  opentable: { name: 'OpenTable', kinds: ['restaurants'], mode: 'link', url: (p) => L.opentable(p.name, p.venue, p.date, p.n) },
};
function bookingLink(kind, provider, params) {
  const P = PROVIDERS[provider]; if (!P || !P.kinds.includes(kind)) throw new Error(`no ${kind} provider ${provider}`);
  return { provider, name: P.name, mode: P.mode, url: P.url(params) };
}
// a booking row/button; when a provider switches to 'inapp' this is the one place that changes
const bookExt = (kind, provider, params, label, cls = 'row-link') => { const b = bookingLink(kind, provider, params); return ext(b.url, label, cls); };

function tripDates(cfg) {
  const s = cfg.start.slice(0, 10), e = (cfg.end || cfg.start).slice(0, 10);
  const st = LS.get('trip:' + s + ':' + e) || {}; const ok = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  const today = todayYMD();
  let arrive = ok(st.arrive) ? st.arrive : addDays(s, -1), leave = ok(st.leave) ? st.leave : addDays(e, 1);
  if (arrive < today && s >= today) arrive = today;
  if (leave <= arrive) leave = addDays(arrive, 1);
  return { arrive, leave, guests: Math.min(16, Math.max(1, +st.guests || 2)) };
}
// ---------- travel mode filter (multi-select; nothing picked = everything) ----------
const TRAVEL_MODES = [['fly', 'Flying'], ['train', 'Train'], ['rental', 'Rental car'], ['drive', 'Driving'], ['transit', 'Transit']];
const eventKey = (cfg) => 'modes:' + Math.abs([...(cfg.title || '') + (cfg.start || '') + (cfg.venue ? cfg.venue.name : '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36);
const RAIL_CC = new Set(['jp', 'kr', 'cn', 'tw', 'in', 'ca', 'au']);
const hasTrains = (v, cfg) => v.cc === 'us' || TRAINLINE_CC.has(v.cc) || RAIL_CC.has(v.cc) || (cfg && stopsOf(cfg).length > 1);
function travelModes(cfg, air) {
  const v = cfg.venue;
  return TRAVEL_MODES.filter(([k]) => k === 'fly' ? air.length > 0 : k === 'train' ? hasTrains(v, cfg) : true);
}
function modeBarHTML(cfg, air) {
  const ms = travelModes(cfg, air); if (ms.length < 2) return '';
  return `<div class="chips mode-bar" role="group" aria-label="${t('How are you getting there?')}"><button type="button" class="chip on" data-tmode="all" aria-pressed="true">${t('All')}</button>${ms.map(([k, l]) => `<button type="button" class="chip" data-tmode="${k}" aria-pressed="false">${t(l)}</button>`).join('')}</div>`;
}
function flightsHTML(cfg, air, ap = chosenAirport(cfg, air)) {
  const tr = tripDates(cfg); const o = LS.get('origin'); const v = cfg.venue;
  if (!air.length) return `<p class="muted">${t('No airports with scheduled flights within 220 km of the venue.')}</p>`;
  const multi = air.length > 1;
  return `<h3 class="sub-h">${t('Nearest airports')}</h3><ul class="airports">${air.map(a => { const on = ap && a.iata === ap.iata; return `<li class="${multi && on ? 'on' : ''}">
    <div class="ap-code">${esc(a.iata)}</div>
    <div class="ap-info"><b>${esc(a.name)}</b><span>${esc(t('{d} from the venue', { d: fmtDist(a.d, v.cc) }))}${a.large ? '' : ' · ' + t('regional')}</span></div>
    <div class="btns">
      ${multi ? `<button type="button" class="chip ap-pick${on ? ' on' : ''}" data-ap="${esc(a.iata)}" aria-pressed="${on}">${on ? '✓ ' + t('Flying in here') : t('Fly in here')}</button>` : ''}
      ${o === a.iata ? `<span class="muted small">${t('That is your home airport.')}</span>` : `${bookExt('flights', 'gflights', { to: a.iata, from: o, d1: tr.arrive, d2: tr.leave }, 'Google Flights', 'btn')}
      ${o ? bookExt('flights', 'kayak', { from: o, to: a.iata, d1: tr.arrive, d2: tr.leave }, 'Kayak', 'btn') : ''}`}
      ${canAddTrip(cfg) ? `<button type="button" class="mini-b" data-addtrip="flight" data-iata="${esc(a.iata)}" data-at-place="${esc(a.name)}" data-at-label="${esc(t('Flight to {a}', { a: a.iata }))}">+ ${t('Add to my trip')}</button>` : ''}
    </div></li>`; }).join('')}</ul>
    ${ap ? `<div class="row-links ap-transfer">${ext(L.route(ap, v), `${esc(t('From {a} to the venue', { a: ap.iata }))} <small>${esc(fmtDist(ap.d, v.cc))} · Google Maps</small>`, 'row-link')}</div>` : ''}
    ${o ? '' : `<p class="muted small">${t('Add the airport you are flying from to compare fares on Kayak too.')}</p>`}
    ${airlinePickHTML(cfg, air, ap)}`;
}
function trainsHTML(cfg) {
  const v = cfg.venue; const o = LS.get('origin'); const oa = o && airportByCode(o);
  const from = oa ? (oa[2] || oa[1]) : '';
  const to = v.city || v.name;
  const items = [];
  if (from) items.push(ext(L.transit(from, v), `${esc(t('Train and bus from {a}', { a: from }))} <small>Google Maps</small>`, 'row-link'));
  if (from) items.push(ext(L.rome2rio(from, to), `${esc(t('Every way from {a} to {b}', { a: from, b: to }))} <small>Rome2Rio</small>`, 'row-link'));
  if (v.cc === 'us') items.push(ext('https://www.amtrak.com/home', `${t('Trains across the US')} <small>Amtrak</small>`, 'row-link'));
  if (TRAINLINE_CC.has(v.cc)) items.push(ext('https://www.thetrainline.com/', `${t('Trains and coaches in Europe')} <small>Trainline</small>`, 'row-link'));
  return `${routeTrainsHTML(cfg)}<h3 class="sub-h">${t('Train and bus')}</h3><div class="row-links">${items.join('')}</div>${from ? '' : `<p class="muted small">${t('Add where you are coming from to see train and bus routes on Rome2Rio.')}</p>`}`;
}
function rentalHTML(cfg, air, ap = chosenAirport(cfg, air)) {
  const tr = tripDates(cfg); const v = cfg.venue;
  const items = (ap ? [ap] : []).map(a => bookExt('cars', 'kayakCars', { iata: a.iata, d1: tr.arrive, d2: tr.leave }, `${esc(t('Rental cars near {a}', { a: `${a.name} (${a.iata})` }))} <small>Kayak</small>`));
  items.push(ext(L.place('car rental', placeLabel(v) || v.name), `${esc(t('Rental desks near the venue'))} <small>Google Maps</small>`, 'row-link'));
  const d = (x) => fmt(x, { month: 'short', day: 'numeric' });
  return `<h3 class="sub-h">${t('Rental car')}</h3>${airportSelHTML(cfg, air, ap)}<p class="muted small">${esc(t('Pick up {a} (arrival) · return {b} (departure)', { a: d(tr.arrive), b: d(tr.leave) }))}</p>${GKEY ? `<div data-slot="car-counters"></div>` : ''}<div class="row-links">${items.join('')}</div>${addTripBtn(cfg, 'car', ap ? ap.name : (placeLabel(v) || v.name), ap ? t('Rental car at {a}', { a: ap.iata }) : t('Rental car'))}`;
}
// hotels stay at the venue; a far-off arrival airport gets one extra link for late arrivals and early departures
const AP_FAR = 40e3;
function stayLinks(cfg, ap = chosenAirport(cfg)) {
  const tr = tripDates(cfg); const v = cfg.venue; const q = placeLabel(v) || v.name; const n = tr.guests || 2;
  const near = ap && ap.d > AP_FAR ? bookExt('hotels', 'ghotels', { q: ap.name, d1: tr.arrive, d2: tr.leave, n }, `${esc(t('Hotels near {a}', { a: `${ap.name} (${ap.iata})` }))} <small>Google Hotels</small>`) : '';
  const nearAdd = near ? addTripBtn(cfg, 'hotel', ap.name, t('Hotel near {a}', { a: ap.iata })) : '';
  if (stopsOf(cfg).length > 1) return routeStaysHTML(cfg) + near + nearAdd;
  const p = { q, d1: tr.arrive, d2: tr.leave, n };
  return [bookExt('hotels', 'ghotels', p, `${esc(t('Hotels in {c}', { c: v.city || q }))} <small>Google Hotels</small>`),
    bookExt('hotels', 'booking', p, `${t('Hotels and apartments')} <small>Booking.com</small>`),
    bookExt('hotels', 'airbnb', p, `${t('Homes and apartments')} <small>Airbnb</small>`),
    addTripBtn(cfg, 'hotel', q, t('Hotel in {c}', { c: v.city || q })), near, nearAdd].join('');
}
function toursHTML(cfg) {
  return `<div class="row-links" data-slot="tour-links">${tourLinks(cfg)}</div>
    <h3 class="sub-h">${t('Sights near the venue')}</h3>
    <div data-slot="sights">${loading(t('sights'))}</div>`;
}
function tourLinks(cfg) {
  const tr = tripDates(cfg); const v = cfg.venue; const q = v.city || placeLabel(v) || v.name; const qa = placeLabel(v) || q;
  return [bookExt('tours', 'gyg', { q, d1: tr.arrive, d2: tr.leave }, `${esc(t('Tours in {c}', { c: q }))} <small>GetYourGuide</small>`),
    bookExt('tours', 'airbnbExp', { q: qa, d1: tr.arrive, d2: tr.leave }, `${t('Experiences with locals')} <small>Airbnb</small>`)].join('');
}
function sightsHTML(cfg, data) {
  const v = cfg.venue; const xs = data.sights || [];
  if (!xs.length) return `<p class="muted">${t('No museums, viewpoints or attractions are mapped within 3 km of the venue.')}</p>${ext(L.place('things to do', placeLabel(v)), t('Search on Google Maps'), 'btn')}`;
  const art = data.__art;
  if (art) return nearListRegister(art, 'sights', cfg, xs.slice(0, 30).map(x => ({ ...x, rating: (x.g && x.g.rating) || 0, count: (x.g && x.g.count) || 0 })), (x, fold) => `<li${fold ? ' class="more"' : ''}>
    <div><b>${esc(x.name)}</b><span>${esc([t(x.kind), x.rating ? `★ ${x.rating.toFixed(1)}` : ''].filter(Boolean).join(' · '))}</span>
      <div class="mini"><button type="button" class="mini-b" ${x.g && x.g.gid ? `data-gpid="${esc(x.g.gid)}"` : `data-place="${esc(placeKey(x))}"`}>${t('Details')}</button>${x.website ? ext(x.website, t('Website'), 'mini-b') : ''}</div></div>
    <span class="dist">${esc(fmtDist(x.d, v.cc))}<small>${x.d < 2000 ? walkTxt(x.d) : t('from the venue')}</small></span></li>`, { more: 8, walkLabel: t('Walking distance') });
  return `<ul class="plist rich">${xs.slice(0, 8).map(x => `<li>
    <div><b>${esc(x.name)}</b><span>${esc(t(x.kind))}</span>
      <div class="mini"><button type="button" class="mini-b" ${x.g && x.g.gid ? `data-gpid="${esc(x.g.gid)}"` : `data-place="${esc(placeKey(x))}"`}>${t('Details')}</button>${x.website ? ext(x.website, t('Website'), 'mini-b') : ''}</div></div>
    <span class="dist">${esc(fmtDist(x.d, v.cc))}<small>${x.d < 2000 ? walkTxt(x.d) : t('from the venue')}</small></span></li>`).join('')}</ul>`;
}
const TRANSIT_LABELS = { subway: 'Subway & metro', rail: 'Rail', tram: 'Light rail & tram', bus: 'Bus stops', bike: 'Bike share & rental', ferry: 'Ferry' };
function transitHTML(cfg, data) {
  const v = cfg.venue; const groups = Object.entries(data.transit).filter(([, xs]) => xs.length);
  if (!groups.length) return `<p class="muted">${t('No mapped stations or stops within walking distance. Rideshare or driving is the way in.')}</p>`;
  return `<div class="tgroups">${groups.map(([k, xs]) => `<div class="tgroup"><h3 class="sub-h">${t(TRANSIT_LABELS[k])}</h3><ul class="plist">${xs.map(x => `<li>
    <div><b>${esc(x.name)}</b>${x.line ? `<span>${esc(x.line.split(';').join(' · '))}</span>` : ''}</div>
    <a class="dist" href="${esc(`https://www.google.com/maps/dir/?api=1&origin=${x.lat},${x.lon}&destination=${v.lat},${v.lon}&travelmode=walking`)}" target="_blank" rel="noopener noreferrer" title="${t('Walking directions to the venue')}">${esc(fmtDist(x.d, v.cc))}<small>${walkTxt(x.d)}</small></a></li>`).join('')}</ul></div>`).join('')}</div>`;
}
function foodHTML(cfg, data, filter = 'all') {
  const v = cfg.venue; const tr = tripDates(cfg); const date = cfg.start.slice(0, 10);
  const counts = { all: data.food.length }; data.food.forEach(f => counts[f.kind] = (counts[f.kind] || 0) + 1);
  if (!data.food.length) return `<p class="muted">${t('No restaurants, cafés or bars are mapped within 900 m of the venue.')}</p>${ext(L.place('restaurants', placeLabel(v)), t('Search on Google Maps'), 'btn')}`;
  const list = data.food.filter(f => filter === 'all' || f.kind === filter).slice(0, 12);
  const chip = (k, l) => counts[k] ? `<button class="chip ${filter === k ? 'on' : ''}" data-food="${k}">${l} <span>${counts[k]}</span></button>` : '';
  return `<div class="chips">${chip('all', t('All'))}${chip('restaurant', t('Restaurants'))}${chip('cafe', t('Cafés'))}${chip('bar', t('Bars'))}</div>
  <ul class="plist rich">${list.map((f, i) => `<li${i >= 5 ? ' class="more"' : ''}>
    <div><b>${esc(f.name)}</b><span>${esc([t(f.kind === 'cafe' ? 'café' : f.kind), f.cuisine].filter(Boolean).join(' · '))}</span>
      <div class="mini">${ext(L.place(f.name, f.street ? `${f.street}, ${v.city}` : placeLabel(v)), 'Google Maps', 'mini-b')}${f.kind !== 'cafe' ? bookExt('restaurants', 'opentable', { name: f.name, venue: v, date, n: tr.guests || 2 }, t('Reserve') + ' · OpenTable', 'mini-b') : ''}${f.website ? ext(f.website, t('Website'), 'mini-b') : ''}</div></div>
    <span class="dist">${esc(fmtDist(f.d, v.cc))}<small>${walkTxt(f.d)}</small></span></li>`).join('')}${list.length > 5 ? `<li class="more-li"><button type="button" class="btn sm" data-more>${t('Show {n} more', { n: list.length - 5 })}</button></li>` : ''}</ul>`;
}
// ---- compact search + chips + sort for long guest lists (rental counters, hotels, sights); same look as the places filters ----
// lfBarHTML draws the bar once; only the list under it re-renders while typing, so the search box keeps focus.
const withArt = (d, art) => { const o = Object.create(d); Object.defineProperty(o, '__art', { value: art }); return o; };
function lfBarHTML(key, f, { ph, chips = [], sorts = [] }) {
  return `<div class="lf" data-lf="${key}" role="group" aria-label="${esc(t('Filters'))}"><div class="gp-search lf-q"><input type="search" data-lf-q value="${esc(f.q || '')}" placeholder="${esc(ph)}" aria-label="${esc(ph)}" enterkeyhint="search" autocomplete="off"></div>
    <div class="chips lf-chips">${chips.map(([id, label, on]) => `<button type="button" class="chip ${on ? 'on' : ''}" data-lf-chip="${esc(id)}" aria-pressed="${!!on}">${esc(label)}</button>`).join('')}${sorts.length > 1 ? `<label class="pf-sel lf-sort"><span class="sr">${esc(t('Sort by'))}</span><select data-lf-sort>${sorts.map(([k, l]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>` : ''}</div></div>`;
}
const lfMatch = (q, ...xs) => { const n = (x) => String(x || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, ''); const w = n(q).trim().split(/\s+/).filter(Boolean); const hay = n(xs.join(' ')); return w.every(x => hay.includes(x)); };
const lfSort = (rows, sort) => sort === 'rating' ? rows.slice().sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.count || 0) - (a.count || 0) || a.d - b.d) : rows.slice().sort((a, b) => a.d - b.d);
const lfCount = (n, active, total) => `<p class="pf-count muted small" role="status" aria-live="polite">${esc(n === 1 ? t('1 place') : t('{n} places', { n }))}${active ? ` · <button type="button" class="link" data-lf-clear>${t('Clear filters')}</button>` : ''}</p>`;
// one delegated handler per page: lists register { f, list(), chip(id), clear() } under art._lf[key]
function lfWire(art) {
  if (art._lfWired) return; art._lfWired = true; art._lf = art._lf || {};
  const L0 = (el) => { const box = el.closest('[data-lf-box]'); return box ? [box, art._lf[box.dataset.lfBox]] : [null, null]; };
  const paint = (box, x) => { const out = box.querySelector('[data-lf-list]'); if (out) out.innerHTML = x.list(); };
  art.addEventListener('input', (e) => { if (!e.target.matches('[data-lf-q]')) return; const [box, x] = L0(e.target); if (!x) return; x.f.q = e.target.value.slice(0, 60); paint(box, x); });
  art.addEventListener('change', (e) => { if (!e.target.matches('[data-lf-sort]')) return; const [box, x] = L0(e.target); if (!x) return; x.f.sort = e.target.value; paint(box, x); });
  art.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lf-chip],[data-lf-clear]'); if (!b) return; const [box, x] = L0(b); if (!x) return;
    if (b.dataset.lfChip) x.chip(b.dataset.lfChip); else { x.clear(); const q = box.querySelector('[data-lf-q]'); if (q) q.value = ''; const so = box.querySelector('[data-lf-sort]'); if (so) so.value = x.f.sort; }
    box.querySelectorAll('[data-lf-chip]').forEach(c => { const on = !!x.on(c.dataset.lfChip); c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
    paint(box, x);
  });
}
// hotels and sights near the venue (OpenStreetMap or Google): search by name, within walking distance, sort by distance or rating
function nearListRegister(art, key, cfg, rows, rowHTML, { more, walkLabel }) {
  art._lf = art._lf || {}; const prev = art._lf[key]; const f = prev ? prev.f : { q: '', walk: false, sort: 'dist' };
  const hasRating = rows.some(r => r.rating);
  const x = art._lf[key] = { f, hasRating,
    on: (id) => id === 'walk' ? f.walk : false,
    chip: (id) => { if (id === 'walk') f.walk = !f.walk; },
    clear: () => { f.q = ''; f.walk = false; f.sort = 'dist'; },
    list: () => {
      const xs = lfSort(rows.filter(r => (!f.q || lfMatch(f.q, r.name, r.kind ? t(r.kind) : '')) && (!f.walk || r.d <= 1500)), hasRating ? f.sort : 'dist');
      const active = !!(f.q || f.walk); const fold = !active && xs.length > more + 1;
      return `${active ? lfCount(xs.length, true) : ''}${xs.length ? `<ul class="plist rich">${xs.map((r, i) => rowHTML(r, fold && i >= more)).join('')}${fold ? `<li class="more-li"><button type="button" class="btn sm" data-more>${t('Show {n} more', { n: xs.length - more })}</button></li>` : ''}</ul>` : `<p class="muted">${t('Nothing matches these filters.')} <button type="button" class="link" data-lf-clear>${t('Clear filters')}</button></p>`}`;
    } };
  lfWire(art);
  return `<div data-lf-box="${key}">${rows.length > more ? lfBarHTML(key, f, { ph: t('Search by name'), chips: [['walk', walkLabel, f.walk]], sorts: hasRating ? [['dist', t('Distance')], ['rating', t('Rating')]] : [] }) : ''}<div data-lf-list>${x.list()}</div></div>`;
}
function hotelsHTML(cfg, data) {
  const v = cfg.venue; const tr = tripDates(cfg);
  if (!data.hotels.length) return `<p class="muted">${t('No hotels are mapped within 3 km of the venue. Try the searches above.')}</p>`;
  const art = data.__art; const rows0 = data.hotels.slice(0, 30).map(h => ({ ...h, rating: (h.g && h.g.rating) || h.rating || 0, count: (h.g && h.g.count) || h.count || 0 }));
  if (art) return nearListRegister(art, 'hotels', cfg, rows0, (h, fold) => `<li${fold ? ' class="more"' : ''}>
    <div><b>${esc(h.name)}</b><span>${esc([t(h.kind), h.stars ? `${h.stars}★` : '', h.rating ? `★ ${h.rating.toFixed(1)}` : ''].filter(Boolean).join(' · '))}</span>
      <div class="mini">${(() => { const a = hotelBookAction(cfg, h); return ext(a.url, a.label, 'mini-b'); })()}<button type="button" class="mini-b" ${h.g && h.g.gid ? `data-gpid="${esc(h.g.gid)}"` : `data-place="${esc(placeKey(h))}"`}>${t('Details')}</button>${h.website ? ext(h.website, t('Website'), 'mini-b') : ''}</div></div>
    <span class="dist">${esc(fmtDist(h.d, v.cc))}<small>${h.d < 2000 ? walkTxt(h.d) : t('from the venue')}</small></span></li>`, { more: 3, walkLabel: t('Walking distance') });
  const hs = data.hotels.slice(0, 8);
  return `<ul class="plist rich">${hs.map((h, i) => `<li${i >= 3 ? ' class="more"' : ''}>
    <div><b>${esc(h.name)}</b><span>${esc([t(h.kind), h.stars ? `${h.stars}★` : ''].filter(Boolean).join(' · '))}</span>
      <div class="mini">${(() => { const a = hotelBookAction(cfg, h); return ext(a.url, a.label, 'mini-b'); })()}<button type="button" class="mini-b" ${h.g && h.g.gid ? `data-gpid="${esc(h.g.gid)}"` : `data-place="${esc(placeKey(h))}"`}>${t('Details')}</button>${h.website ? ext(h.website, t('Website'), 'mini-b') : ''}</div></div>
    <span class="dist">${esc(fmtDist(h.d, v.cc))}<small>${h.d < 2000 ? walkTxt(h.d) : t('from the venue')}</small></span></li>`).join('')}${hs.length > 3 ? `<li class="more-li"><button type="button" class="btn sm" data-more>${t('All {n} hotels', { n: hs.length })}</button></li>` : ''}</ul>`;
}
function weatherHTML(w, cfg) {
  const heads = { forecast: t('Forecast'), recent: t('Recent weather'), past: t('What the weather was'), typical: t('Typical for these dates · {a}–{b} average', { a: w.from, b: w.to }) };
  const r = Math.round;
  return `<p class="wx-head"><span class="lbl">${esc(heads[w.kind])}</span>${w.partial ? `<span class="muted small">${t('Later days appear as they come into the 16-day forecast.')}</span>` : ''}</p>
  <div class="wx">${w.days.map(d => {
    const [label, ic] = w.kind === 'typical' ? (d.wet / (d.of || 1) >= 0.5 ? ['Often wet', 'rain'] : d.wet ? ['Mostly dry', 'part'] : ['Usually dry', 'sun']) : WMO(d.code);
    return `<div class="wx-d"><span class="wx-date">${esc(fmt(d.date, { weekday: 'short' }))}<small>${esc(fmt(d.date, { month: 'short', day: 'numeric' }))}</small></span>${icon(ic)}
      <span class="wx-t"><b>${r(d.hi)}°</b><span>${r(d.lo)}°F</span></span>
      <span class="wx-x">${w.kind === 'typical' ? t('Rain {n} of {m} yrs', { n: d.wet, m: d.of }) : w.kind === 'past' ? `${d.precip ? d.precip.toFixed(2) + ' in' : t('Dry')}` : d.pop != null ? t('{n}% rain', { n: d.pop }) : esc(t(label))}</span>
      <span class="wx-l">${esc(t(label))}</span></div>`;
  }).join('')}</div>`;
}

async function shareEvent(cfg, opts) {
  const url = opts.shareUrl || location.href;
  if (navigator.share) { try { await navigator.share({ title: cfg.title, text: cfg.tagline || cfg.title, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  copy(url);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Link copied'); }
  catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Link copied'); } catch { toast('Copy failed. Select the link and copy it.'); } ta.remove(); }
}

// ---------- landing ----------
function renderLanding() {
  LANG = 'en'; document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr';
  document.title = '1LinkTrip — one link for your guests’ whole trip';
  const draft = LS.get('draft');
  $('#app').innerHTML = `
  <main class="land home">
    <header class="land-top"><a class="brand" href="#">${BRAND}</a><span class="land-nav">${LS.get('signedIn') ? '<a class="link" href="#mine">My pages</a>' : '<a class="link" href="#mine">Sign in</a>'}<button type="button" class="btn sm" id="share-app" aria-label="Share"><svg class="share-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 15V3.5M7.5 8 12 3.5 16.5 8"/><path d="M8 11H6.5A1.5 1.5 0 0 0 5 12.5v7A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-7a1.5 1.5 0 0 0-1.5-1.5H16"/></svg><span class="share-lbl">Share</span></button><a class="btn primary top-cta" href="#setup" aria-hidden="true" tabindex="-1">Create a page</a></span></header>
    <section class="land-hero">
      <div class="land-copy">
        <h1>One link for your guests’ whole trip.</h1>
        <p class="lede">Add your event and venue. Guests get your schedule, directions and places to stay.</p>
        <div class="btns"><a class="btn primary big" id="hero-cta" href="#setup">Create a page</a></div>
        <p class="muted small">Free, no account needed. <a class="link" href="#examples">See examples</a></p>
      </div>
    </section>
    ${myPagesHTML()}
    <section class="land-what">
      <h2>What your guests get</h2>
      <dl>
        <div><dt>Weather</dt><dd>The forecast for your dates.</dd></div>
        <div><dt>Map</dt><dd>The venue and what’s around it.</dd></div>
        <div><dt>Flights</dt><dd>The nearest airports and fares.</dd></div>
        <div><dt>Getting around</dt><dd>Directions, transit, rideshare and rental cars.</dd></div>
        <div><dt>Hotels</dt><dd>Places to stay near the venue.</dd></div>
        <div><dt>Food</dt><dd>Restaurants and bars in the area.</dd></div>
        <div><dt>Things to do</dt><dd>Tours, sights and activities.</dd></div>
        <div><dt>Event details</dt><dd>RSVP, dress code, packet pickup and more.</dd></div>
        <div><dt>Full itinerary</dt><dd>Their bookings and your schedule in one place.</dd></div>
      </dl>
    </section>
  </main>`;
  wireLanding(); wireHomeHeader();
}
// One "Create a page" at a time: the header button shows only while the hero button is scrolled off-screen.
// The header turns sticky with a bottom rule once the page scrolls (styles in home.css).
let homeIO = null;
function homeScroll() { const top = $('.land.home .land-top'); if (top) top.classList.toggle('scrolled', scrollY > 4); }
addEventListener('scroll', homeScroll, { passive: true });
function wireHomeHeader() {
  if (homeIO) { homeIO.disconnect(); homeIO = null; }
  $('#share-app')?.addEventListener('click', async () => { // share 1LinkTrip itself (installed home-screen app has no browser share icon)
    const url = siteBase();
    if (navigator.share) { try { await navigator.share({ title: '1LinkTrip', text: 'One link for your guests’ whole trip.', url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
    copy(url);
  });
  const top = $('.land.home .land-top'), cta = top && top.querySelector('.top-cta'), hero = $('#hero-cta'); if (!cta || !hero) return;
  const set = (show) => { top.classList.toggle('show-cta', show); cta.setAttribute('aria-hidden', show ? 'false' : 'true'); cta.tabIndex = show ? 0 : -1; };
  if (!('IntersectionObserver' in window)) { set(true); return; }
  homeIO = new IntersectionObserver((es) => set(!es[es.length - 1].isIntersecting), { rootMargin: `-${top.offsetHeight}px 0px 0px 0px`, threshold: 0 });
  homeIO.observe(hero); homeScroll();
}
// ---------- viewer ----------
// ---------- builder ----------
async function pinPlace(k, btn) {
  const c = B.cfg; const x = c.x[c.type] || {}; const p = x[k]; if (!p || !p.q || p.q.trim().length < 3) { toast('Type a place first'); return; }
  btn.disabled = true; btn.textContent = 'Finding…';
  try {
    const near = c.venue ? `${p.q}, ${c.venue.city || ''}` : p.q;
    let r = await geocode(near); if (!r.length && near !== p.q) r = await geocode(p.q);
    if (!r.length) { toast('No match. Add a street or landmark.'); btn.textContent = 'Pin on map'; }
    else { x[k] = { q: p.q, lat: r[0].lat, lon: r[0].lon }; btn.textContent = 'Pinned'; changed(); }
  } catch { toast('Search is unavailable right now'); btn.textContent = 'Pin on map'; }
  btn.disabled = false;
}
// ================= messages: guest ↔ host threads, guest groups, updates for chosen groups (schema-3; hidden until installed) =================
// Who may read what is enforced on the server (supabase/schema-3.sql). The page only shows what those rules return.
let msgReadyP = null;
function msgReady() {
  if (!SB) return Promise.resolve(false);
  const c = LS.get('msgReady'); if (c && Date.now() - c.t < (c.ok ? 3600e3 : 300e3)) return Promise.resolve(c.ok);
  // 200 = the tables exist; 404 (not installed yet), 401/403 or offline = keep everything hidden
  return msgReadyP || (msgReadyP = fetchTimeout(`${SB.url}/rest/v1/event_groups?select=id&limit=1`, { headers: { apikey: SB.key, Accept: 'application/json' } }, 8000)
    .then(r => r.status === 200).catch(() => false).then(ok => { LS.set('msgReady', { t: Date.now(), ok }); msgReadyP = null; return ok; }));
}
const msgReadyNow = () => { const c = LS.get('msgReady'); return !!(c && c.ok); };
let notifyP = null;
function notifyReady() {
  const c = LS.get('notifyReady'); if (c && Date.now() - c.t < (c.ok ? 3600e3 : 600e3)) return Promise.resolve(c.ok);
  return notifyP || (notifyP = fetchTimeout(`${SB.url}/functions/v1/notify`, {}, 8000).then(r => r.status === 200 || r.status === 401).catch(() => false)
    .then(ok => { LS.set('notifyReady', { t: Date.now(), ok }); notifyP = null; return ok; }));
}
// email is the extra; the message or update is already saved and shows in the app either way
async function notifyEmail(kind, id) {
  try {
    if (!id || !SB || !(await notifyReady())) return;
    const c = await sb(); const { data } = await c.auth.getSession(); const tok = data && data.session && data.session.access_token; if (!tok) return;
    await fetchTimeout(`${SB.url}/functions/v1/notify`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, apikey: SB.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, id }) }, 15000);
  } catch { /* in-app delivery already happened */ }
}
// where a guest returns after signing in on a hosted page: the same page and tab
const hostedBack = (art) => { const p = art && art.querySelector('.ev-panel:not([hidden])'); const k = p ? p.dataset.panel : 'event'; return '?e=' + enc(new URLSearchParams(location.search).get('e') || '') + (k && k !== 'event' ? '#t=' + k : ''); };
const msgSignInHTML = () => `<div class="bk-signin gm-signin"><p><b>${t('Sign in first.')}</b></p>${signInFormHTML('')}</div>`;
const msgListHTML = (rows, cfg, host) => rows.length ? `<ul class="msg-list">${rows.map(r => {
  const mine = host ? r.from_host : !r.from_host; const who = r.from_host ? (host ? t('You') : (cfg.host || t('Host'))) : (host ? (r.guest_name || r.guest_email || t('Guest')) : t('You'));
  return `<li class="msg ${mine ? 'out' : 'in'}"><span class="who">${esc(who)} · <time>${esc(fmtStamp(r.created_at))}</time></span><p>${esc(r.body)}</p></li>`; }).join('')}</ul>` : '';
const msgComposeHTML = (key, label, btn) => `<div class="msg-compose"><textarea id="gm-${key}" rows="2" maxlength="2000" aria-label="${esc(label)}" placeholder="${esc(label)}"></textarea><button type="button" class="btn primary" data-gm-send="${key}">${esc(btn)}</button></div><p class="hint" data-gm-msg role="status" aria-live="polite"></p>`;

// ---------- guest side: "Message the host" on the Event tab, "Messages" on My trip, group picker in RSVP ----------
async function myGuestUser() { if (!LS.get('signedIn')) return null; try { return await sbUser(); } catch { return null; } }
async function setMyGroup(eventId, gid, user) {
  const c = await sb(); const email = String(user.email || '').toLowerCase(); if (!email) return;
  await c.from('event_group_members').delete().eq('event_id', eventId).eq('email', email).eq('added_by', 'guest');
  if (gid) await c.from('event_group_members').insert({ event_id: eventId, group_id: gid, email, added_by: 'guest' });
}
function wireGuestMsgs(cfg, art, hosted) {
  msgReady().then(async (ok) => {
    if (!ok || !document.body.contains(art)) return;
    const G = { user: null, rows: [], anns: [], groups: [], picks: [] };
    art._gm = G;
    // groups a guest may pick at RSVP (public list; host-only groups stay hidden)
    rest(`event_groups?event_id=eq.${enc(hosted.id)}&self_pick=eq.true&select=id,name,sort&order=sort.asc,name.asc`).then(rows => { G.picks = rows || []; art._fillPick && art._fillPick(); }).catch(() => {});
    G.user = await myGuestUser();
    const pend = LS.get('grpPick:' + hosted.id);
    if (G.user && pend) setMyGroup(hosted.id, pend, G.user).then(() => { LS.del('grpPick:' + hosted.id); load(); }).catch(() => {});
    const evBody = art.querySelector('.ev-panel[data-panel="event"] .ev-body'); const tripBody = art.querySelector('.ev-panel[data-panel="mytrip"] .ev-body');
    const on = !!cfg.guestMessages;
    if (on && evBody && !art.querySelector('#sec-gm')) {
      const html = sec('gm', t('Message the host'), '<div data-slot="gm-ev"></div>');
      const after = evBody.querySelector('#sec-rsvp'); if (after) after.insertAdjacentHTML('afterend', html); else evBody.insertAdjacentHTML('beforeend', html);
    }
    if (tripBody && G.user && !art.querySelector('#sec-gmt')) tripBody.insertAdjacentHTML('afterbegin', `<div data-slot="gm-trip-wrap"></div>`);
    const seenKey = 'msgSeen:' + hosted.id;
    const paint = () => {
      const ev = art.querySelector('[data-slot="gm-ev"]'); const wrap = art.querySelector('[data-slot="gm-trip-wrap"]');
      // a refresh never loses what the guest is typing
      const keep = $$('[data-gm-send]', art).map(b => { const ta = art.querySelector('#gm-' + b.dataset.gmSend); return ta && [ta.id, ta.value, document.activeElement === ta, ta.selectionStart]; }).filter(Boolean);
      const gname = (ids) => (ids || []).map(id => (G.groups.find(g => g.id === id) || {}).name).filter(Boolean).join(', ');
      const anns = G.anns.length ? `<ul class="ann-list gm-anns">${G.anns.map(a => `<li><time>${esc(fmtStamp(a.created_at))}${gname(a.group_ids) ? ' · ' + esc(gname(a.group_ids)) : ''}</time><p>${esc(a.body)}</p></li>`).join('')}</ul>` : '';
      const thread = msgListHTML(G.rows, cfg, false);
      if (ev) {
        if (!G.user) ev.innerHTML = msgSignInHTML();
        else if (!wrap) ev.innerHTML = `${anns}${thread}${msgComposeHTML('ev', t('Write a message'), t('Send'))}`; // no My trip tab: the whole thread lives here
        else ev.innerHTML = `${msgComposeHTML('ev', t('Write a message'), t('Send'))}${G.rows.length ? `<button type="button" class="btn sm" data-tab-go="mytrip">${esc(t('Messages'))} (${G.rows.length})</button>` : ''}`;
      }
      if (wrap) {
        const show = G.user && (on || G.rows.length || G.anns.length);
        wrap.innerHTML = show ? sec('gmt', t('Messages'), `${anns}${thread}${on ? msgComposeHTML('trip', t('Write a message'), t('Send')) : ''}`, 'gm-sec') : '';
      }
      keep.forEach(([id, v, f, pos]) => { const ta = art.querySelector('#' + id); if (!ta) return; ta.value = v; if (f) { ta.focus(); try { ta.setSelectionRange(pos, pos); } catch {} } });
      const newest = G.rows.filter(r => r.from_host).concat(G.anns).map(r => r.created_at).sort().pop() || '';
      const tab = art.querySelector('[data-tab-go="mytrip"][role="tab"]'); if (tab) tab.classList.toggle('has-new', !!newest && newest > (LS.get(seenKey) || ''));
      const tp = art.querySelector('.ev-panel[data-panel="mytrip"]'); if (tp && !tp.hidden && newest) { LS.set(seenKey, newest); if (tab) tab.classList.remove('has-new'); }
    };
    const load = async () => {
      if (!G.user) { paint(); return; }
      try {
        const c = await sb();
        const [m, a, g] = await Promise.all([
          c.from('event_messages').select('id,from_host,body,created_at').eq('event_id', hosted.id).eq('guest', G.user.id).order('created_at', { ascending: true }).limit(200),
          c.from('announcements').select('id,body,created_at,group_ids').eq('event_id', hosted.id).order('created_at', { ascending: false }).limit(30),
          c.from('event_groups').select('id,name').eq('event_id', hosted.id)]);
        if (m.error && tableMissing(m.error)) { LS.set('msgReady', { t: Date.now(), ok: false }); return; }
        G.rows = m.data || []; G.anns = (a.data || []).filter(x => (x.group_ids || []).length); G.groups = g.data || [];
      } catch { /* keep what is shown */ }
      if (document.body.contains(art)) paint();
    };
    paint(); load(); art._gmLoad = load;
    // simple refresh: on opening My trip, on coming back to the app, and every 30 s while My trip is open
    (art._showFns = art._showFns || []).push((k) => { if (k === 'mytrip') { load(); } });
    if (document._gmVis) document.removeEventListener('visibilitychange', document._gmVis); // one listener, for the page on screen
    document._gmVis = () => { if (!document.hidden && document.body.contains(art)) load(); }; document.addEventListener('visibilitychange', document._gmVis);
    const iv = setInterval(() => { if (!document.body.contains(art)) return clearInterval(iv); const tp = art.querySelector('.ev-panel[data-panel="mytrip"]'); if (!document.hidden && tp && !tp.hidden) load(); }, 30000);
    art.addEventListener('click', async (e) => {
      const sio = e.target.closest('.gm-signin [data-si-oauth]'); if (sio) { oauthSignIn(sio.dataset.siOauth); LS.set('afterSignIn', hostedBack(art)); return; }
      const b = e.target.closest('.gm-signin [data-si="send"], [data-gm-send]'); if (!b) return;
      if (b.dataset.si === 'send') { LS.set('afterSignIn', hostedBack(art)); signInSubmit(b.closest('.gm-signin')); return; }
      const box = b.closest('.ev-sec, [data-slot="gm-ev"]'); const ta = box.querySelector('textarea'); const hint = box.querySelector('[data-gm-msg]');
      const body = (ta.value || '').trim().slice(0, 2000); if (!body) { ta.focus(); return; }
      b.disabled = true; hint.textContent = t('Sending…');
      try {
        const c = await sb(); const mine = LS.get('rsvp:' + hosted.id) || {}; const md = G.user.user_metadata || {};
        const { data, error } = await c.from('event_messages').insert({ event_id: hosted.id, body, guest_name: (mine.name || md.full_name || md.name || '').slice(0, 120) || null }).select('id,from_host,body,created_at').single();
        if (error) throw error;
        G.rows.push(data); ta.value = ''; paint(); notifyEmail('message', data.id);
        const h2 = art.querySelector(`[data-gm-send="${b.dataset.gmSend}"]`)?.closest('.ev-sec, [data-slot="gm-ev"]')?.querySelector('[data-gm-msg]'); if (h2) h2.textContent = t('Sent');
      } catch (err) {
        if (isNetErr(err)) { const mine = LS.get('rsvp:' + hosted.id) || {}; outboxAdd({ kind: 'msg', row: { event_id: hosted.id, body, guest_name: (mine.name || '').slice(0, 120) || null } }); G.rows.push({ id: 'q' + Date.now(), from_host: false, body, created_at: new Date().toISOString() }); ta.value = ''; paint(); hint.textContent = t('Saved on this device. It will be sent when you’re back online.'); return; }
        b.disabled = false; hint.textContent = t('Couldn’t send. Try again.');
      }
    });
    art.addEventListener('keydown', (e) => { if (e.target.id === 'si-email' && e.target.closest('.gm-signin') && e.key === 'Enter') { e.preventDefault(); LS.set('afterSignIn', hostedBack(art)); signInSubmit(e.target.closest('.gm-signin')); } });
  });
}
const groupPickHTML = (picks, cur) => picks.length ? `<div class="field"><label for="rs-group">${t('Group')}</label><select id="rs-group"><option value="">${t('Choose')}</option>${picks.map(g => `<option value="${esc(g.id)}" ${g.id === cur ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></div>` : '';

// ---------- host side: groups editor (builder card + My pages), inbox, Send to ----------
const parseEmails = (s) => [...new Set(String(s || '').toLowerCase().match(/[^\s,;<>"'()]+@[^\s,;<>"'()]+\.[a-z]{2,}/g) || [])].slice(0, 500);
async function loadGroups(c, eventId) {
  const [g, m] = await Promise.all([c.from('event_groups').select('id,name,self_pick,sort').eq('event_id', eventId).order('sort', { ascending: true }).order('name', { ascending: true }),
    c.from('event_group_members').select('group_id,email,added_by').eq('event_id', eventId).order('email', { ascending: true })]);
  if (g.error) throw g.error;
  return (g.data || []).map(x => ({ ...x, members: (m.data || []).filter(y => y.group_id === x.id) }));
}
function groupsEdHTML(groups) {
  return `<div class="grp-ed">${groups.map(g => `<div class="grp-card" data-gid="${esc(g.id)}">
      <div class="grp-h"><b>${esc(g.name)}</b><span class="muted small">${esc(g.members.length === 1 ? t('1 person') : t('{n} people', { n: g.members.length }))}</span></div>
      <label class="tool"><input type="checkbox" data-g-pick="${esc(g.id)}" ${g.self_pick ? 'checked' : ''}><span class="sw" aria-hidden="true"></span>${t('Guests can pick')}</label>
      <details class="grp-more"><summary>${t('Emails')}</summary>
        ${g.members.length ? `<ul class="grp-mem">${g.members.map(m => `<li><span>${esc(m.email)}</span><button type="button" class="link" data-g-rm="${esc(g.id)}" data-email="${esc(m.email)}" aria-label="${esc(t('Remove'))} ${esc(m.email)}">×</button></li>`).join('')}</ul>` : ''}
        <textarea rows="3" data-g-paste="${esc(g.id)}" aria-label="${esc(t('Emails, one per line'))}" placeholder="${esc(t('Emails, one per line'))}"></textarea>
        <div class="btns"><button type="button" class="btn sm" data-g-add="${esc(g.id)}">${t('Add emails')}</button><button type="button" class="link" data-g-del="${esc(g.id)}">${t('Delete group')}</button></div>
      </details></div>`).join('')}
    <div class="search grp-new"><input data-g-name maxlength="60" aria-label="${esc(t('Group name'))}" placeholder="${esc(t('Group name'))}"><button type="button" class="btn" data-g-new>${t('Add')}</button></div>
    <p class="hint" data-g-hint role="status" aria-live="polite"></p></div>`;
}
// one wiring for both places; `after` re-renders the host view once something changed
function wireGroupsEd(root, c, eventId, after) {
  if (root._gWired) return; root._gWired = true;
  const hint = (s) => { const h = root.querySelector('[data-g-hint]'); if (h) h.textContent = s; };
  root.addEventListener('change', async (e) => {
    const i = e.target.closest('[data-g-pick]'); if (!i) return;
    const { error } = await c.from('event_groups').update({ self_pick: i.checked }).eq('id', i.dataset.gPick); if (error) { hint(error.message); return; } after();
  });
  root.addEventListener('keydown', (e) => { if (e.target.matches('[data-g-name]') && e.key === 'Enter') { e.preventDefault(); root.querySelector('[data-g-new]').click(); } });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
    if ('gNew' in d) { const inp = root.querySelector('[data-g-name]'); const name = (inp.value || '').trim().slice(0, 60); if (!name) { inp.focus(); return; }
      b.disabled = true; const n = root.querySelectorAll('.grp-card').length;
      const { error } = await c.from('event_groups').insert({ event_id: eventId, name, sort: n }); b.disabled = false;
      if (error) { hint(error.code === '23505' ? t('You already have that group.') : error.message); return; } after(); }
    else if (d.gAdd) { const ta = root.querySelector(`[data-g-paste="${CSS.escape(d.gAdd)}"]`); const emails = parseEmails(ta.value); if (!emails.length) { ta.focus(); return; }
      b.disabled = true; const { error } = await c.from('event_group_members').upsert(emails.map(email => ({ event_id: eventId, group_id: d.gAdd, email, added_by: 'host' })), { onConflict: 'group_id,email', ignoreDuplicates: true }); b.disabled = false;
      if (error) { hint(error.message); return; } after(); }
    else if (d.gRm) { await c.from('event_group_members').delete().eq('group_id', d.gRm).eq('email', d.email); after(); }
    else if (d.gDel) { if (!confirm(t('Delete this group?'))) return; await c.from('event_groups').delete().eq('id', d.gDel); after(); }
  });
}
const sendToHTML = (groups) => groups.length ? `<div class="send-to"><span class="lbl-s">${t('Send to')}</span><div class="chips" role="group" aria-label="${esc(t('Send to'))}"><button type="button" class="chip on" data-st-all aria-pressed="true">${t('Everyone')}</button>${groups.map(g => `<button type="button" class="chip" data-st-g="${esc(g.id)}" aria-pressed="false">${esc(g.name)}</button>`).join('')}</div></div>` : '';
function wireSendTo(root) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-st-all],[data-st-g]'); if (!b) return;
    const all = root.querySelector('[data-st-all]'); const gs = $$('[data-st-g]', root);
    const set = (x, on) => { x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); };
    if ('stAll' in b.dataset) { set(all, true); gs.forEach(x => set(x, false)); return; }
    set(b, !b.classList.contains('on')); const any = gs.some(x => x.classList.contains('on')); set(all, !any);
  });
}
const sendToIds = (root) => $$('[data-st-g].on', root).map(x => x.dataset.stG);
function inboxHTML(rows, seen) {
  const th = new Map(); rows.forEach(r => { if (!th.has(r.guest)) th.set(r.guest, []); th.get(r.guest).push(r); });
  const list = [...th.entries()].map(([g, xs]) => ({ g, xs, last: xs[xs.length - 1], who: xs.find(x => !x.from_host) || {} })).sort((a, b) => b.last.created_at.localeCompare(a.last.created_at));
  if (!list.length) return `<p class="muted">${t('No messages yet.')}</p>`;
  return `<div class="inbox">${list.map(({ g, xs, last, who }) => { const unread = !last.from_host && last.created_at > ((seen || {})[g] || '');
    return `<details class="thr" data-thr="${esc(g)}"><summary><span class="thr-who"><b>${esc(who.guest_name || who.guest_email || t('Guest'))}</b>${who.guest_name && who.guest_email ? ` <span class="muted small">${esc(who.guest_email)}</span>` : ''}</span>${unread ? `<i class="dot" aria-label="${esc(t('New'))}"></i>` : ''}<span class="thr-last">${esc(last.body.slice(0, 90))}</span></summary>
      ${msgListHTML(xs, {}, true)}${msgComposeHTML('h-' + g, t('Reply'), t('Reply'))}</details>`; }).join('')}</div>`;
}

// ---------- router ----------
function renderBroken() {
  $('#app').innerHTML = `<main class="land"><header class="land-top"><a class="brand" href="#">${BRAND}</a></header><section class="broken"><h1>This link is incomplete.</h1><p class="lede">The event is stored inside the link, and part of it is missing. Ask whoever sent it to copy the whole link again.</p><a class="btn primary" href="#">Go to 1LinkTrip</a></section></main>`;
}

// ================= v2: defaults, guest tabs, editor gallery, setup flow =================
// guest-interface strings go through t(); host content never does
let LANG = 'en';
const I18N = window.EP_I18N || {};
const t = (s, vars) => { let r = (I18N[LANG] && I18N[LANG][s]) || s; if (vars) r = r.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? ''); return r; };

const TOOLS = [['weather', 'Weather'], ['travel', 'Travel'], ['stay', 'Stay'], ['nearby', 'Nearby'], ['tours', 'Things to do'], ['mytrip', 'My trip'], ['packing', 'Packing list'], ['shopping', 'Shopping list']];
const TYPE_DEFAULTS = {
  Trip: { theme: { accent: '#1E7FA8', font: 'serif', mode: 'light' }, off: [], order: ['route', 'schedule', 'about', 'details', 'weather', 'access', 'rsvp'] },
  Wedding: { theme: { accent: '#0B7A75', font: 'serif', mode: 'light' }, off: [] },
  Race: { theme: { accent: '#2E7D32', font: 'wide', mode: 'light' }, off: ['tours'] },
  Conference: { theme: { accent: LAGOON, font: 'field', mode: 'light' }, off: ['packing'] },
  Concert: { theme: { accent: '#FF6B35', font: 'condensed', mode: 'dark' }, off: ['stay'] },
  Performance: { theme: { accent: '#6D28D9', font: 'classic', mode: 'light' }, off: ['stay'] },
  Hyrox: { theme: { accent: '#FFD100', font: 'condensed', mode: 'dark' }, off: ['tours'] },
  Festival: { theme: { accent: '#FF6B35', font: 'condensed', mode: 'dark' }, off: [] },
  'Sporting event': { theme: { accent: '#C2185B', font: 'condensed', mode: 'dark' }, off: ['stay', 'packing'] }
};
const typeDefaults = (type) => TYPE_DEFAULTS[type] || { theme: { accent: LAGOON, font: 'field', mode: 'light' }, off: [] };
const defaultTools = (type) => Object.fromEntries(TOOLS.map(([k]) => [k, k === 'shopping' ? type === 'Trip' : !typeDefaults(type).off.includes(k)])); // shopping list: trips only by default
const TYPE_ICONS = {
  Wedding: '<circle cx="9" cy="14" r="5"/><circle cx="15" cy="14" r="5"/><path d="M10 5l2-2 2 2-2 2z"/>',
  Race: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  Conference: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
  Concert: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  Performance: '<path d="M3 4h18M4 4v3c0 2 2 3 4 3M20 4v3c0 2-2 3-4 3"/><path d="M12 8l-4 10h8z"/><path d="M3 21h18"/>',
  Hyrox: '<path d="M2 12h3M19 12h3"/><rect x="5" y="7" width="3" height="10" rx="1"/><rect x="16" y="7" width="3" height="10" rx="1"/><path d="M8 12h8"/>',
  Festival: '<path d="M3 20L12 4l9 16z"/><path d="M12 4v16M9 20l3-6 3 6"/>',
  'Sporting event': '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M5.6 5.6c3.4 3.4 3.4 9.4 0 12.8M18.4 5.6c-3.4 3.4-3.4 9.4 0 12.8"/>',
  Trip: '<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V4h6v3M4 12h16"/>',
  Party: '<path d="M4 20l5-14 9 9z"/><path d="M14 3v2M19 8h2M17.5 4.5l-1.4 1.4"/>',
};
const SETUP_TYPES = [['Wedding', 'Wedding', 'RSVP, room block, dress code', '#0B7A75'], ['Race', 'Race', 'Start, finish, packet pickup', '#2E7D32'],
  ['Conference', 'Conference', 'Badges, agenda, speakers', LAGOON], ['Concert', 'Concert', 'Doors, set times, bag policy', '#FF6B35'],
  ['Festival', 'Festival', 'Stages, multi-day', '#B8860B'], ['Sporting event', 'Game day', 'Seats, tailgating, parking', '#C2185B'],
  ['Performance', 'Performance', 'Recital, show, call time', '#6D28D9'], ['Hyrox', 'Hyrox', 'Wave, check-in, bag drop', '#FFD100'],
  ['Party', 'Something else', 'Party, reunion, retreat', '#1F2937'], ['Trip', 'Vacation / Trip', 'Day by day, stays, packing', '#1E7FA8']];
// "Add to your page" cards: [id, title, subtitle, field keys]
const TYPE_CARDS = {
  Trip: [['route', 'Route', 'Cities and dates', []], ['companions', 'Travelling together', 'Who is coming', ['companions']]],
  Wedding: [['rsvp', 'RSVP', 'Link, reply-by', ['rsvp', 'rsvpBy']], ['block', 'Room block', 'Hotel, code, deadline', ['blockHotel', 'blockUrl', 'blockCode', 'blockBy']],
    ['dress', 'Dress code', 'Attire', ['dress']], ['registry', 'Registry', 'Links', ['registry']]],
  Race: [['startfinish', 'Start and finish', 'Map pins', ['startAt', 'finishAt']], ['packet', 'Packet pickup', 'Where and when', ['packet', 'packetWhen']],
    ['course', 'Course map', 'Link, GPX or image', ['course']], ['spots', 'Spectator spots', 'Where to cheer', ['spots']], ['closures', 'Road closures', 'Roads, times', ['closures', 'closuresUrl']]],
  Concert: [['settimes', 'Set times', 'Doors, opener, headliner', ['doors', 'opener', 'openerAt', 'headliner', 'headlinerAt']], ['bags', 'Bag policy', 'What’s allowed', ['bags']],
    ['parking', 'Parking and pickup', 'Lots, rideshare', ['parking', 'pickup']], ['setlist', 'Setlist', 'Link', ['setlist']]],
  'Sporting event': [['seating', 'Seating chart', 'Link', ['seating']], ['teams', 'Teams', 'Links', ['teams']], ['tailgate', 'Tailgating and parking', 'Lots and times', ['tailgate', 'parking']], ['bags', 'Bag policy', 'What’s allowed', ['bags']]],
  Performance: [['showtimes', 'Show times', 'Call time, doors, showtime', ['performer', 'callTime', 'doors', 'showtime', 'slot']], ['program', 'Program and tickets', 'Run order, tickets', ['program', 'tickets']],
    ['etiquette', 'Flowers and photos', 'Gifts, photo rules', ['flowers', 'photo']], ['parking', 'Parking', 'Where to park', ['parking']]],
  Hyrox: [['wave', 'Wave and division', 'Start time, division', ['wave', 'division']], ['checkin', 'Check-in', 'Wristband pickup', ['checkin', 'checkinWhen']],
    ['bagdrop', 'Bag drop', 'Where, what to leave', ['bagdrop']], ['spectators', 'Spectators', 'Tickets, parking', ['spectators', 'parking']], ['results', 'Live results', 'Link', ['results']]],
  Conference: [['badge', 'Badge pickup', 'Where and when', ['badge', 'badgeWhen']], ['speakers', 'Speakers', 'One per line', ['speakers']], ['agenda', 'Full agenda', 'Link', ['agenda']]]
};
const TYPE_GROUP = { Trip: 'For trips', Wedding: 'For weddings', Race: 'For races', Hyrox: 'For Hyrox', Concert: 'For concerts', Performance: 'For performances', 'Sporting event': 'For game day', Conference: 'For conferences' };
const COMMON_CARDS = [['schedule', 'Schedule', 'Times and places'], ['notes', 'Notes for guests', 'Kids, parking, FAQ'], ['about', 'About', 'Host, description'],
  ['bring', 'Must-bring items', 'Required items'], ['custom', 'Custom section', 'Your own heading and info'], ['langs', 'Guest languages', 'Translations']];
const CARD_ICONS = {
  rsvp: '<path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/>', block: '<path d="M3 20V9l9-5 9 5v11"/><path d="M9 20v-6h6v6"/>', dress: '<path d="M9 3l3 3 3-3 3 4-3 2v12H9V9L6 7z"/>',
  registry: '<rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8v13M3 12h18M12 8S8 3 6 5s6 3 6 3 8-1 6-3-6 3-6 3"/>', startfinish: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  packet: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>', course: '<path d="M4 18c3 0 3-6 6-6s3 6 6 6 2-3 4-3"/><circle cx="4" cy="18" r="1.5"/><circle cx="20" cy="15" r="1.5"/>',
  spots: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', closures: '<path d="M12 3l8 17H4z"/><path d="M8 13h8"/>',
  settimes: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', bags: '<path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>', parking: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M10 17V7h3a3 3 0 0 1 0 6h-3"/>',
  setlist: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>', seating: '<path d="M4 10h16M4 15h16M9 5v15M15 5v15"/><rect x="4" y="5" width="16" height="15" rx="2"/>',
  teams: '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M2 20c0-3 3-5 6-5s6 2 6 5M14 15c3 0 8 1 8 5"/>', tailgate: '<path d="M3 15l2-6h14l2 6v4H3z"/><circle cx="7" cy="17" r="1.5"/><circle cx="17" cy="17" r="1.5"/>',
  badge: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M8 17h8"/>', speakers: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  showtimes: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', program: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  etiquette: '<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M9 7l1.5-3h3L15 7"/>',
  wave: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>', checkin: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M8 17h8"/>',
  bagdrop: '<path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>', spectators: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  results: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  agenda: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>', schedule: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', notes: '<path d="M5 3h14v18H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>', look: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-6-5-9 8"/>',
  bring: '<path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>', custom: '<path d="M4 5h16M4 10h10M4 15h7"/><path d="M17 13v8M13 17h8"/>', access: '<circle cx="12" cy="4.5" r="1.5"/><path d="M12 7v6h5l2 6M12 10H7"/><path d="M9 13a5 5 0 1 0 6 6"/>'
};
const cardIcon = (id) => `<svg viewBox="0 0 24 24" aria-hidden="true">${CARD_ICONS[id] || CARD_ICONS.notes}</svg>`;

function blankEvent(type) {
  const s = addDays(todayYMD(), 30); type = type || 'Party';
  return { v: 2, type, title: '', tagline: '', host: '', description: '', start: s, end: '', tz: '', venue: null, cover: '',
    theme: { ...typeDefaults(type).theme }, tools: defaultTools(type), off: type === 'Trip' ? { rsvp: true } : {}, schedule: [], notes: [], x: {}, bring: '', custom: [] };
}
// the organizer's own sections: cfg.custom = [{ id, title, text, label, url, img }]; on the page as section 'c-<id>'
const blankCustom = () => ({ id: Math.random().toString(36).slice(2, 8), title: '', text: '', label: '', url: '', img: '' });
const customSid = (x) => 'c-' + x.id;
function normCustom(xs) {
  const seen = new Set(); const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
  return (Array.isArray(xs) ? xs : []).filter(x => x && typeof x === 'object').slice(0, 20).map((x, i) => {
    let id = typeof x.id === 'string' && /^[a-z0-9]{1,12}$/.test(x.id) ? x.id : 's' + i; while (seen.has(id)) id += 'x'; seen.add(id);
    return { id, title: str(x.title, 80), text: str(x.text, 3000), label: str(x.label, 80), url: str(x.url, 800), img: str(x.img, 800) };
  }).filter(x => x.title || x.text || x.label || x.url || x.img);
}
// Old links (v1) carried a `sections` list and a generic `links` list. Map them onto tools, notes and type cards so they open as before.
function normalize(c) {
  c = c || {}; const legacy = !(c.v >= 2);
  const b = blankEvent(c.type);
  if (legacy) {
    const secs = c.sections || []; const on = (id) => { const s = secs.find(x => x.id === id); return s ? !!s.on : undefined; };
    const d = defaultTools(c.type);
    const anyOf = (...ids) => { const vals = ids.map(on); return vals.some(x => x === true) ? true : vals.every(x => x === undefined) ? undefined : false; };
    c.tools = secs.length ? { weather: on('weather') ?? d.weather, travel: on('travel') ?? d.travel, stay: on('stay') ?? d.stay, nearby: anyOf('food', 'map', 'around') ?? d.nearby,
      tours: on('tours') ?? false, mytrip: on('itinerary') ?? true, packing: on('packing') ?? true } : d;
    c.off = { about: on('about') === false, schedule: on('schedule') === false, details: on('typeinfo') === false, notes: on('links') === false };
    const x = (c.x = c.x && typeof c.x === 'object' ? c.x : {}); const notes = [];
    for (const l of c.links || []) {
      if (!l || !l.label || !(l.url || l.note)) continue;
      if (c.type === 'Wedding') {
        const w = (x.Wedding = x.Wedding || {});
        if (/^rsvp$/i.test(l.label) && l.url && !w.rsvp) { w.rsvp = l.url; continue; }
        if (/^dress code$/i.test(l.label) && l.note && !w.dress) { w.dress = l.note; continue; }
        if (/^registry$/i.test(l.label) && l.url) { (w.registry = w.registry || []).push({ label: 'Registry', url: l.url }); continue; }
      }
      notes.push({ label: l.label, url: l.url || '', text: l.note || '' });
    }
    c.notes = (c.notes || []).concat(notes); delete c.sections; delete c.links; c.v = 2;
  }
  c = { ...b, ...c, theme: { ...b.theme, ...(c.theme || {}) } };
  if (/^#1f3a2e$/i.test(c.theme.accent || '')) c.theme.accent = LAGOON; // pages saved with the old Forest default
  c.tools = { ...defaultTools(c.type), ...(c.tools || {}) };
  c.off = c.off || {}; c.notes = Array.isArray(c.notes) ? c.notes : []; c.schedule = Array.isArray(c.schedule) ? c.schedule : [];
  c.x = c.x && typeof c.x === 'object' ? c.x : {}; c.bring = typeof c.bring === 'string' ? c.bring : '';
  c.custom = normCustom(c.custom);
  if (c.files !== undefined) { c.files = normFiles(c.files); if (!c.files.length) delete c.files; } // attached documents (only on pages that have some)
  c.lang = typeof c.lang === 'string' && /^[a-z]{2,3}$/.test(c.lang) ? c.lang : 'en';
  c.langs = Array.isArray(c.langs) ? c.langs.filter(l => typeof l === 'string' && /^[a-z]{2,3}$/.test(l) && l !== c.lang).slice(0, 12) : [];
  if (c.tr && typeof c.tr === 'object') { const tr = {}; for (const [l, m] of Object.entries(c.tr)) { if (!/^[a-z]{2,3}$/.test(l) || !m || typeof m !== 'object') continue; tr[l] = {}; for (const [k, e] of Object.entries(m)) if (e && typeof e.t === 'string' && typeof e.h === 'string') tr[l][k] = { h: e.h, t: e.t.slice(0, 6000), ...(e.o ? { o: true } : {}) }; } c.tr = tr; } else c.tr = {};
  c.stops = Array.isArray(c.stops) ? c.stops.filter(x => x && typeof x === 'object').slice(0, 20) : [];
  delete c.osm; // hosted pages store a nearby-places snapshot beside the config; it never travels in links or drafts
  return c;
}

// ---------- guest view ----------
const TABS = [['event', 'Event'], ['travel', 'Travel'], ['nearby', 'Nearby'], ['mytrip', 'My trip']];
const TAB_ICONS = {
  event: '<path d="M6 21V4"/><path d="M6 4h12l-2.5 4.5L18 13H6"/>',
  travel: '<path d="M2 16l20-6-3-3-6 2-6-5-2 1 4 6-4 1-2-2-1 1z"/>',
  nearby: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  mytrip: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 2v4M16 2v4M8 12l2.5 2.5L16 9"/>'
};
function tabsFor(cfg) {
  const v = cfg.venue, T = cfg.tools;
  return TABS.filter(([k]) => k === 'event' || (k === 'travel' && v && (T.travel || T.stay)) || (k === 'nearby' && v && (T.nearby || T.tours)) || (k === 'mytrip' && cfg.start && (T.mytrip || T.packing || T.shopping)));
}
const sec = (id, title, body, cls = '') => body ? `<section class="ev-sec ${cls}" id="sec-${id}" data-sec="${id}"><h2 class="sec-h">${esc(title)}</h2><div class="sec-b">${body}</div></section>` : '';
function notesHTML(cfg) {
  const ns = cfg.notes.filter(x => x.label && (x.url || x.text)); if (!ns.length) return '';
  return `<ul class="links">${ns.map(x => x.url
    ? `<li><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer"><b>${esc(x.label)}</b><span>${esc(x.text || hostOf(x.url))}</span>${arrow}</a></li>`
    : `<li class="note"><b>${esc(x.label)}</b><span>${esc(x.text)}</span></li>`).join('')}</ul>`;
}
function customSecHTML(cfg, sid) {
  const x = (cfg.custom || []).find(y => customSid(y) === sid); if (!x || !(x.title || '').trim() || cfg.off[sid]) return '';
  const img = httpsUrl(x.img), url = httpsUrl(x.url);
  const body = (img ? `<img class="cs-img" src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : '')
    + (x.text || '').split(/\n\s*\n/).filter(p => p.trim()).map(p => `<p>${esc(p.trim()).replace(/\n/g, '<br>')}</p>`).join('')
    + (url ? `<ul class="links"><li><a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><b>${esc((x.label || '').trim() || hostOf(url))}</b>${(x.label || '').trim() ? `<span>${esc(hostOf(url))}</span>` : ''}${arrow}</a></li></ul>` : '')
    + docsHTML(cfg, [sid]);
  return sec(sid, x.title, body, 'cs');
}
function needToKnowHTML(cfg) {
  const parts = [];
  if (!cfg.off.details) parts.push(typeInfoHTML(cfg, { skipBlock: !!(cfg.venue && cfg.tools.stay) }));
  if (!cfg.off.notes) parts.push(notesHTML(cfg));
  parts.push(docsHTML(cfg, detailDocSecs(cfg).filter(k => k === 'notes' ? !cfg.off.notes : !cfg.off.details)));
  return parts.filter(Boolean).join('');
}
function aboutHTML(cfg) {
  if (cfg.off.about || !(cfg.description || cfg.host)) return '';
  return `${cfg.host ? `<p class="host"><span class="lbl">${t('Hosted by')}</span> ${esc(cfg.host)}</p>` : ''}${cfg.description.split(/\n\s*\n/).filter(Boolean).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}`;
}
const scheduleSecHTML = (cfg) => sec('schedule', t(schedTitle(cfg)), scheduleHTML(cfg) + (cfg.off.schedule ? '' : docsHTML(cfg, ['schedule'])) + (routeInItin(cfg) && !cfg.off.route ? docsHTML(cfg, ['route']).replace(/^<ul class="docs/, '<ul class="route-docs docs') : ''));
// trips show their route (cities + dates) as the Itinerary's legs instead of a separate Route section
const routeInItin = (cfg) => isTrip(cfg) && stopsOf(cfg).length > 0;
// which leg a day belongs to: the stop whose stay covers it (leave day → next stop), else the nearest dated stop; -1 when no stop has dates
function legOf(ss, d) {
  const i = ss.findIndex(s => s.from && s.to && d >= s.from && d < s.to); if (i >= 0) return i;
  let best = -1, dist = Infinity;
  ss.forEach((s, j) => { if (!s.from) return; const e = s.to && s.to > s.from ? s.to : s.from; const x = d < s.from ? daysBetween(d, s.from) : d > e ? daysBetween(e, d) : 0; if (x < dist || (x === dist && d >= s.from)) { best = j; dist = x; } });
  return best;
}
// the Itinerary for a trip: one block per route stop (tap → Nearby for that stop), its days under it; undated days last
function legsHTML(cfg, ss, days, dayHTML) {
  const by = ss.map(() => []), rest = []; const nb = tabsFor(cfg).some(x => x[0] === 'nearby');
  days.forEach(e => { const i = e[0] ? legOf(ss, e[0]) : -1; (i >= 0 ? by[i] : rest).push(e); });
  const head = (s, i) => { const inner = `<span class="route-n">${i + 1}</span><span><b>${esc(s.name)}</b>${stopRange(s) ? `<small>${esc(stopRange(s))}</small>` : ''}</span>`;
    return s.lat != null && nb ? `<button type="button" class="route-stop leg-h" data-route-stop="${i}">${inner}</button>` : `<div class="route-stop leg-h">${inner}</div>`; };
  return `<ol class="route legs">${ss.map((s, i) => `<li class="leg">${head(s, i)}${by[i].length ? `<div class="leg-days">${by[i].map(dayHTML).join('')}</div>` : ''}</li>`).join('')}</ol>${rest.map(dayHTML).join('')}`;
}
// one schedule: the organizer's items, with the guest's own bookings mixed in
function scheduleHTML(cfg) {
  const fit = (d) => isTrip(cfg) && d ? fitTripDate(cfg.start, cfg.end, d, false) : d || '';
  const evs = cfg.off.schedule ? [] : cfg.schedule.filter(x => x.title).map(x => { const d = fit(x.date); return { ev: true, start: d + (d && x.time ? 'T' + x.time : ''), name: x.title, note: x.note, kind: x.kind || '' }; });
  const mine = cfg.tools.mytrip ? itinLoad(cfg).map((x, i) => ({ ...x, i })).concat(planLoad(cfg).filter(x => x.day).map(x => ({ kind: '', name: x.name, start: x.day + (x.time ? 'T' + x.time : ''), confNo: x.booked ? x.conf : '', note: x.note }))) : [];
  const legs = routeInItin(cfg) && !cfg.off.route ? stopsOf(cfg) : null;
  if (!evs.length && !mine.length && !legs) return '';
  const view = mine.length ? (LS.get('schedview:' + itinKey(cfg)) || 'all') : 'all';
  const key = (x) => x.ev && isTrip(cfg) ? (x.start || '9999').slice(0, 10) : (x.start || '9999');
  const all = (view === 'event' ? evs : evs.concat(mine)).sort((a, b) => (a.start || '9999').slice(0, 10).localeCompare((b.start || '9999').slice(0, 10)) || key(a).localeCompare(key(b)));
  const days = {}; all.forEach(x => (days[(x.start || '').slice(0, 10)] = days[(x.start || '').slice(0, 10)] || []).push(x));
  const tm = (s) => fmtTime((s || '').slice(11, 16));
  const dayHTML = ([d, xs]) => `<div class="day"><h3 class="day-h">${d ? `${isTrip(cfg) && cfg.start && d >= cfg.start.slice(0, 10) ? `<span class="dayn">${esc(t('Day {n}', { n: daysBetween(cfg.start, d) + 1 }))}</span> ` : ''}${esc(fmt(d, { weekday: 'long', month: 'short', day: 'numeric' }))}${!legs && stopsOf(cfg).length > 1 && stopFor(cfg, d) ? ` <span class="day-city">${esc(stopFor(cfg, d).name)}</span>` : ''}` : t(isTrip(cfg) ? 'Unscheduled' : 'Anytime')}</h3><ol class="tl">${xs.map(x => {
    // trips: one clean line per item; its details open with a tap
    const more = (title, body) => body ? `<details class="tl-d"><summary><b>${title}</b><i class="tl-dot" aria-hidden="true"></i><span class="sr">${t('Details')}</span></summary><span>${body}</span></details>` : `<b>${title}</b>`;
    if (x.ev && isTrip(cfg)) return `<li class="${x.kind ? 'k-' + esc(x.kind) : ''}"><time>${esc(tm(x.start))}</time><div>${more(esc(x.name), x.note ? esc(x.note) : '')}</div></li>`;
    if (x.ev) return `<li class="${x.kind ? 'k-' + esc(x.kind) : ''}"><time>${esc(tm(x.start)) || (isTrip(cfg) ? '' : '—')}</time><div><b>${esc(x.name)}${x.kind && x.kind !== 'activity' ? ` <em class="kind">${esc(t(PLAN_KINDS[x.kind] || ''))}</em>` : ''}</b>${x.note ? `<span>${esc(x.note)}</span>` : ''}</div></li>`;
    const fl = x.kind === 'flight' ? flightLinks(x.flight) : {};
    const until = x.end ? (x.end.slice(0, 10) !== (x.start || '').slice(0, 10) ? t('until {d}', { d: fmt(x.end.slice(0, 10), { month: 'short', day: 'numeric' }) }) : t('until {d}', { d: tm(x.end) })) : '';
    if (isTrip(cfg)) { const det = esc([t(ITIN_KINDS[x.kind] || ''), until, x.confNo ? t('Conf. {n}', { n: x.confNo }) : ''].filter(Boolean).join(' · ')) + (fl.status ? ' ' + ext(fl.status, t('Flight status') + ' ↗', 'tl-link') : '');
      return `<li class="mine"><time>${esc(tm(x.start)) || '—'}</time><div>${more(`${esc(x.name || t(ITIN_KINDS[x.kind] || 'Booking'))} <em class="yours">${t('Yours')}</em>`, det)}</div></li>`; }
    return `<li class="mine"><time>${esc(tm(x.start)) || '—'}</time><div><b>${esc(x.name || t(ITIN_KINDS[x.kind] || 'Booking'))} <em class="yours">${t('Yours')}</em></b><span>${esc([t(ITIN_KINDS[x.kind] || ''), until, x.confNo ? t('Conf. {n}', { n: x.confNo }) : ''].filter(Boolean).join(' · '))}</span>${fl.status ? ext(fl.status, t('Flight status') + ' ↗', 'tl-link') : ''}</div></li>`;
  }).join('')}</ol></div>`;
  return `${mine.length ? `<div class="seg2 sched-seg" role="group"><button type="button" data-sched="all" class="${view === 'all' ? 'on' : ''}" aria-pressed="${view === 'all'}">${t('Everything')}</button><button type="button" data-sched="event" class="${view === 'event' ? 'on' : ''}" aria-pressed="${view === 'event'}">${t('Event only')}</button></div>` : ''}
  ${legs ? legsHTML(cfg, legs, Object.entries(days), dayHTML) : Object.entries(days).map(dayHTML).join('')}`;
}
function stubSideHTML(cfg, ap) {
  const v = cfg.venue;
  return ap ? `<span class="lbl">${t('Fly into')}</span><b class="code">${esc(ap.iata)}</b><small>${esc(t('{d} away', { d: fmtDist(ap.d, v.cc) }))}</small>` : (cfg.start ? `<span class="lbl">${esc(fmt(cfg.start.slice(0, 10), { weekday: 'short' }))}</span><b class="code">${esc(fmt(cfg.start.slice(0, 10), { month: 'short' }).toUpperCase())}</b><small class="big-day">${esc(fmt(cfg.start.slice(0, 10), { day: 'numeric' }))}</small>` : `<span class="lbl">${t('Date')}</span><b class="code">TBA</b>`);
}
function ticketHTML(cfg, air) {
  const v = cfg.venue; const d = typeData(cfg);
  const rsvp = cfg.type === 'Wedding' && d.rsvp && !cfg.off.details;
  const sameDay = cfg.start && cfg.start.slice(0, 10) === (cfg.end || '').slice(0, 10);
  const dirModes = [['driving', 'Drive'], ['transit', 'Transit'], ['walking', 'Walk'], ['bicycling', 'Bike']];
  return `<section class="stub" aria-label="${t('Event summary')}">
      <div class="stub-main">
        <div class="stub-cell"><span class="lbl">${t('Date')}</span><b>${esc(dateRange(cfg.start, cfg.end))}</b>${countdown(cfg) ? `<small class="cd">${esc(countdown(cfg))}</small>` : ''}</div>
        ${cfg.start && cfg.start.length >= 16 ? `<div class="stub-cell"><span class="lbl">${sameDay || !cfg.end ? t('Time') : t('Starts')}</span><b>${esc(sameDay ? timeRange(cfg.start, cfg.end) : fmtTime(cfg.start.slice(11, 16)))}</b></div>` : ''}
        <div class="stub-cell wide"><span class="lbl">${t(isTrip(cfg) ? 'Destination' : 'Venue')}</span><b>${v ? esc(v.name) : t('To be announced')}</b>${v && v.address && v.address !== v.name ? `<small>${esc(v.address)}</small>` : ''}</div>
      </div>
      <div class="stub-tear" aria-hidden="true"></div>
      <div class="stub-side">
        ${stubSideHTML(cfg, v ? chosenAirport(cfg, air) : null)}
      </div>
      <div class="stub-actions">
        ${rsvp ? ext(d.rsvp, t('RSVP'), 'btn primary') : ''}
        ${cfg.start ? `<details class="menu"><summary class="btn ${rsvp ? '' : 'primary'}">${t('Add to calendar')}</summary><div class="menu-pop"><button type="button" data-act="ics">${t('Apple or Outlook (.ics)')}</button>${ext(L.gcal(cfg, location.href), 'Google Calendar', '')}</div></details>` : ''}
        ${v ? `<details class="menu"><summary class="btn">${t('Directions')}</summary><div class="menu-pop">${dirModes.map(([m, l]) => ext(L.dir(v, m), t(l), '')).join('')}${ext(L.uber(v, v.name), 'Uber', '')}${LYFT_CC.has(v.cc) ? ext(L.lyft(v), 'Lyft', '') : ''}</div></details>` : ''}
        <button class="btn" data-act="share">${t('Share')}</button>
      </div>
    </section>`;
}
function tripBarHTML(cfg) {
  const tr = tripDates(cfg); const o = LS.get('origin'); const oa = o && airportByCode(o);
  return `<div class="tripbar">
    ${cfg.tools.travel ? `<div class="field origin"><label for="ep-origin">${t('From')}</label><div class="ac"><input id="ep-origin" autocomplete="off" placeholder="${t('City or airport code')}" value="${oa ? esc(`${oa[2] || oa[1]} (${oa[0]})`) : ''}"><ul class="ac-list" hidden></ul></div></div>` : ''}
    <div class="field"><label for="ep-arrive">${t('Arrival')}</label><input type="date" id="ep-arrive" data-k="arrive" value="${tr.arrive}"></div>
    <div class="field"><label for="ep-leave">${t('Departure')}</label><input type="date" id="ep-leave" data-k="leave" value="${tr.leave}"></div>
    <div class="field narrow"><label for="ep-guests">${t('Guests')}</label><input type="number" id="ep-guests" min="1" max="16" data-k="guests" value="${tr.guests}"></div>
  </div>`;
}
function travelTabHTML(cfg, air) {
  const v = cfg.venue; const T = cfg.tools; const out = [];
  out.push(`<div class="ev-sec trip-sec">${tripBarHTML(cfg)}${T.travel ? modeBarHTML(cfg, air) : ''}${canAddTrip(cfg) ? `<div class="btns add-bk"><button type="button" class="btn primary" data-addbooking>+ ${t('Add a booking')}</button></div>` : ''}</div>`);
  if (T.travel) out.push(sec('travel', t('Getting there'), `
    <div data-slot="flights" data-mode="fly"></div>
    ${hasTrains(v, cfg) ? '<div data-slot="trains" data-mode="train"></div>' : ''}
    <div data-slot="rental" data-mode="rental"></div>
    <div data-mode="drive"><h3 class="sub-h">${t('Driving')}</h3><div class="row-links">${ext(L.place('parking near ' + v.name, placeLabel(v)), `${t('Parking near the venue')} <small>Google Maps</small>`, 'row-link')}</div></div>
    <div data-mode="transit"><h3 class="sub-h">${t('Transit')}</h3><div data-slot="transit">${loading(t('nearby stations'))}</div></div>`));
  if (T.stay) out.push(sec('stay', t('Where to stay'), `${roomBlockHTML(cfg)}<div class="row-links" data-slot="stay-links">${stayLinks(cfg)}</div>
    <h3 class="sub-h">${t('Hotels near the venue')}</h3><div data-slot="hotels">${loading(t('hotels'))}</div>`));
  return out.join('');
}
function roomBlockHTML(cfg) {
  if (cfg.type !== 'Wedding' || cfg.off.details) return '';
  const d = typeData(cfg); if (!(d.blockHotel || d.blockUrl || d.blockCode || d.blockBy)) return '';
  const sub = [d.blockCode ? t('Code {c}', { c: d.blockCode }) : '', d.blockBy ? t('Book by {d}', { d: fmt(d.blockBy, { month: 'short', day: 'numeric' }) }) : ''].filter(Boolean).join(' · ');
  const inner = `<span><b>${esc(d.blockHotel || t('Room block'))}</b> <em class="badge">${t('Room block')}</em><small class="sub">${esc(sub)}</small></span>${d.blockUrl ? `<small>${t('Book')} ↗</small>` : ''}`;
  return `<div class="row-links block-row">${d.blockUrl ? `<a class="row-link hl" href="${esc(d.blockUrl)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : `<div class="row-link hl">${inner}</div>`}</div>`;
}
function nearbyTabHTML(cfg) {
  const T = cfg.tools; const out = [];
  if (T.nearby) out.push(sec('map', t('Map'), `<div class="map-off" data-slot="map-off"></div><div class="hotel-bar" data-slot="hotel"></div><div class="map-wrap"><div class="map" data-slot="map" role="region" aria-label="${t('Map of the venue and surroundings')}"></div><div class="map-key" data-slot="map-key"></div><div class="map-legend" data-slot="legend"></div></div>`));
  if (T.nearby) out.push(sec('food', t('Places nearby'), `<div data-slot="food">${loading(t('places to eat'))}</div>`));
  if (T.tours) out.push(sec('tours', t('Things to do'), toursHTML(cfg)));
  return out.join('');
}
function bookingsHTML(cfg) {
  const items = itinLoad(cfg); const air = cfg.tools && cfg.tools.travel ? airFor(cfg) : [];
  return `${air.length ? `<div class="ap-mine" data-slot="ap-mine">${airportSelHTML(cfg, air, chosenAirport(cfg, air), true)}</div>` : ''}${items.length ? `<ul class="plist rich bookings">${items.map((x, i) => {
    const fl = x.kind === 'flight' ? flightLinks(x.flight) : {};
    const when = x.start ? fmt(x.start.slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' }) + (x.start.length > 10 ? ' · ' + fmtTime(x.start.slice(11, 16)) : '') : '';
    const links = [fl.status ? ext(fl.status, t('Flight status'), 'mini-b') : '', fl.manage ? ext(fl.manage, t('Manage booking'), 'mini-b') : '', x.link ? ext(x.link, t('Open booking'), 'mini-b') : '', x.address ? ext(L.place(x.address), 'Google Maps', 'mini-b') : ''].join('');
    return `<li><div><b>${esc(x.name || t(ITIN_KINDS[x.kind] || 'Booking'))}</b><span>${esc([t(ITIN_KINDS[x.kind] || ''), when, x.confNo ? t('Conf. {n}', { n: x.confNo }) : ''].filter(Boolean).join(' · '))}</span>${x.note ? `<span>${esc(x.note)}</span>` : ''}<div class="mini">${links}<button type="button" class="mini-b" data-itin-edit="${i}">${t('Edit')}</button></div></div></li>`;
  }).join('')}</ul>` : ''}
  <div class="btns itin-btns"><button type="button" class="btn primary" data-itin-add>+ ${t('Add a booking')}</button>${items.length ? `<button type="button" class="btn" data-itin-ics>${t('Add to calendar')}</button>` : ''}</div><div data-slot="itin-form"></div>`;
}
function myTripTabHTML(cfg) {
  const T = cfg.tools; const out = [];
  if (T.mytrip) out.push(sec('plan', t('Your itinerary'), planHTML(cfg)));
  if (T.mytrip && cfg.venue) out.push(sec('spots', t('Saved spots'), spotsHTML(cfg)));
  if (T.mytrip) out.push(sec('itinerary', t('Your bookings'), bookingsHTML(cfg)));
  if (T.shopping) out.push(shopSecHTML(cfg));
  if (T.packing) out.push(`<section class="ev-sec" id="sec-packing"><details class="pack-wrap"><summary><h2 class="sec-h">${t('Packing list')}</h2><span class="pack-sum" data-slot="pack-sum"></span></summary><div data-slot="pack-list"></div><div class="pack-add"><input placeholder="${t('Add an item')}" aria-label="${t('Add an item')}" maxlength="80"><button type="button" class="btn" data-pack-add>${t('Add')}</button></div></details>${docsHTML(cfg, ['bring'])}</section>`);
  return out.join('');
}
function eventTabHTML(cfg) {
  const parts = {
    route: () => routeInItin(cfg) ? '' : sec('route', t('Route'), routeGuestHTML(cfg) + (cfg.off.route ? '' : docsHTML(cfg, ['route']))),
    about: () => sec('about', t('About'), aboutHTML(cfg) + (cfg.off.about ? '' : docsHTML(cfg, ['about']))),
    details: () => sec('details', t('Need to know'), needToKnowHTML(cfg)),
    rsvp: () => '<div data-slot="rsvp-wrap"></div>',
    access: () => `<div data-slot="access-wrap">${accessHTML(cfg, null)}</div>`,
    schedule: () => `<div data-slot="schedule-wrap">${scheduleSecHTML(cfg)}</div>`,
    weather: () => cfg.venue && cfg.start && cfg.tools.weather ? sec('weather', t('Weather'), `<div data-slot="weather"><div class="skel" role="status"><span></span><span></span><em>${t('Loading weather…')}</em></div></div>`) : '',
  };
  // trips: the route lives inside the Itinerary, which takes whichever of the two slots comes first
  const o = sectionOrder(cfg); if (routeInItin(cfg) && o.indexOf('route') < o.indexOf('schedule')) { o.splice(o.indexOf('schedule'), 1); o.splice(o.indexOf('route'), 1, 'schedule'); }
  return o.map(id => parts[id] ? parts[id]() : customSecHTML(cfg, id)).join('');
}
// A trip whose destination is a country or region ("Japan") has no useful point for maps, searches or airports: use the
// first route stop's point instead (the destination name stays as written). Stops without a map point are found by city.
const isCoarseVenue = (v) => !!v && (!v.city || (!!v.country && v.name.trim().toLowerCase() === v.country.trim().toLowerCase()));
function tripView(cfg) {
  if (!isTrip(cfg)) return cfg; const v = cfg.venue; const s = stopsOf(cfg).find(x => x.lat != null);
  if (!s || (v && !isCoarseVenue(v))) return cfg;
  return { ...cfg, venue: { ...(v || {}), name: v ? v.name : s.name, address: s.address || s.name, lat: s.lat, lon: s.lon, city: s.city || s.name, region: s.region || '', country: s.country || (v && v.country) || '', cc: s.cc || (v && v.cc) || '', pinName: s.name, zoom: 13 } };
}
const tripCC = (cfg) => (cfg.venue && cfg.venue.cc) || (stopsOf(cfg).find(x => x.cc) || {}).cc || '';
// a city-level point for a route stop: never a country, inside the trip's country, a city/town result preferred
async function geocodeCity(name, country, cc) {
  const q = [name, country].filter(Boolean).join(', '); if (!q) return null; const k = 'sgeo:' + q.toLowerCase().slice(0, 120);
  const c = LS.get(k); if (c) return c.miss ? null : c;
  let xs; try { xs = await geocode(q); } catch { return null; }
  const ok = (xs || []).filter(x => x.lat != null && !(x.types || []).some(ty => ty === 'country' || ty === 'continent') && !(cc && x.cc && x.cc !== cc));
  const r = ok.find(x => (x.types || []).some(ty => /^(locality|postal_town|sublocality|administrative_area_level_[12]|colloquial_area)$/.test(ty))) || ok.find(x => !(x.types || []).length) || null;
  const out = r ? { name, address: r.address || r.name, lat: r.lat, lon: r.lon, city: r.city || name, region: r.region || '', country: r.country || country || '', cc: r.cc || cc || '' } : null;
  LS.set(k, out || { miss: 1 }); return out;
}
async function repairStops(cfg) {
  const ss = stopsOf(cfg).filter(s => s.lat == null); if (!ss.length || !isTrip(cfg)) return false;
  const cc = tripCC(cfg), country = (cfg.venue && cfg.venue.country) || (stopsOf(cfg).find(x => x.country) || {}).country || ''; let n = 0;
  for (const s of ss) { const r = await geocodeCity(s.name, s.country || country, s.cc || cc); if (r) { Object.assign(s, { address: s.address || r.address, lat: r.lat, lon: r.lon, city: s.city || r.city, region: s.region || r.region, country: s.country || r.country, cc: s.cc || r.cc }); n++; } }
  return n > 0;
}
function renderEvent(cfg, root, opts = {}) {
  if (!opts.repaired && isTrip(cfg) && stopsOf(cfg).some(s => s.lat == null)) {
    const seq0 = renderSeq + 1; repairStops(cfg).then(ok => { if (ok && renderSeq === seq0 && document.body.contains(root)) { const p = root.querySelector('.ev-panel:not([hidden])'); renderEvent(cfg, root, { ...opts, repaired: true, tab: p ? p.dataset.panel : opts.tab }); } }).catch(() => {});
  }
  if (!opts.src) opts = { ...opts, src: cfg }; // "Edit a copy" and the language picker keep the page as written
  cfg = tripView(cfg);
  const seq = ++renderSeq;
  maps.forEach(m => { try { m.remove(); } catch {} }); maps.clear();
  loadFont(cfg.theme.font);
  const v = cfg.venue; const air = v ? nearestAirports(v.lat, v.lon) : [];
  const tabs = tabsFor(cfg); const cur = tabs.some(([k]) => k === opts.tab) ? opts.tab : 'event';
  const panel = (k, body, head) => `<div class="ev-panel" data-panel="${k}"${k === cur ? '' : ' hidden'}>${head || ''}<div class="ev-body">${body}</div></div>`;
  const tabHead = (k) => `<header class="tab-h"><span class="lbl">${esc(cfg.title || t('Untitled event'))}</span><h1>${t(TABS.find(x => x[0] === k)[1])}</h1></header>`;
  root.innerHTML = `
  <article class="ev ${cfg.theme.mode === 'dark' ? 'dark' : ''} ${tabs.length > 1 ? 'has-tabs' : ''} ${opts.preview ? 'is-preview' : ''}" style="${themeStyle(cfg.theme)}" lang="${LANG}">
    ${tabs.length > 1 ? `<nav class="ev-tabs" role="tablist" aria-label="${t('Page sections')}">${tabs.map(([k, l]) => `<button type="button" role="tab" data-tab-go="${k}" aria-selected="${k === cur}"><svg viewBox="0 0 24 24" aria-hidden="true">${TAB_ICONS[k]}</svg><span>${t(l)}</span></button>`).join('')}</nav>` : ''}
    <div class="ev-panel" data-panel="event"${cur === 'event' ? '' : ' hidden'}>
      <header class="ev-hero ${cfg.cover ? 'has-cover' : ''}">
        ${cfg.cover ? `<img class="ev-cover" src="${esc(cfg.cover)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
        <div class="ev-hero-in">
          <p class="ev-kicker">${esc(t(cfg.type || 'Event'))}${v && v.city ? ` · ${esc(v.city)}` : ''}</p>
          <h1 class="ev-title">${esc(cfg.title || t('Untitled event'))}</h1>
          ${cfg.tagline ? `<p class="ev-tagline">${esc(cfg.tagline)}</p>` : ''}
        </div>
      </header>
      ${ticketHTML(cfg, air)}
      <div class="ev-body">${eventTabHTML(cfg)}</div>
    </div>
    ${tabs.some(x => x[0] === 'travel') ? panel('travel', travelTabHTML(cfg, air), tabHead('travel')) : ''}
    ${tabs.some(x => x[0] === 'nearby') ? panel('nearby', nearbyTabHTML(cfg), tabHead('nearby')) : ''}
    ${tabs.some(x => x[0] === 'mytrip') ? panel('mytrip', offlineRowHTML(cfg, opts) + myTripTabHTML(cfg), tabHead('mytrip')) : ''}
    <footer class="ev-foot">
      ${opts.preview ? '' : `<p class="lang-row">${langSelectHTML(opts.src || cfg)}</p><a href="#edit=${packEvent(opts.src || cfg)}">${t('Edit a copy of this page')}</a> · <a href="#">${t('Make your own')}</a>`}
      <p data-slot="attrib">${attribHTML(new Set())}</p>
    </footer>
  </article>`;
  const art = root.querySelector('.ev');
  art._srcs = new Set();
  // a source is credited once it actually supplies the map or places (OpenStreetMap only when Google is unavailable)
  art._useSrc = (k) => { art._srcs.add(k); const el = art.querySelector('[data-slot="attrib"]'); if (el) el.innerHTML = attribHTML(art._srcs); };
  art.addEventListener('click', (e) => { const b = e.target.closest('[data-gpid]'); if (b && art._openGPlace) art._openGPlace(b.dataset.gpid); });
  wireEvent(cfg, art, seq, air, opts); wireOffline(cfg, art, opts);
  if (opts.hosted && typeof wireHosted === 'function') wireHosted(cfg, art, opts.hosted, opts);
  art.addEventListener('click', (e) => { const b = e.target.closest('[data-route-stop]'); if (!b || !art.querySelector('[data-panel="nearby"]')) return; showTab(art, 'nearby', opts); const c2 = art.querySelector(`[data-gp-stop="${b.dataset.routeStop}"]`); if (c2) c2.click(); });
}
function showTab(art, k, opts = {}) {
  $$('.ev-panel', art).forEach(p => { p.hidden = p.dataset.panel !== k; });
  $$('[data-tab-go]', art).forEach(b => b.setAttribute('aria-selected', String(b.dataset.tabGo === k)));
  if (k === 'nearby') maps.forEach(m => { try { m.invalidateSize(); } catch {} });
  (art._showFns || []).forEach(f => { try { f(k); } catch {} });
  if (!opts.preview && /^#(e|ex)=/.test(location.hash)) { const base = location.hash.split('&t=')[0]; history.replaceState(null, '', k === 'event' ? base : `${base}&t=${k}`); }
  if (!opts.preview) window.scrollTo(0, 0); else art.closest('.b-preview, .su-preview')?.scrollTo(0, 0);
}

function wireEvent(cfg, art, seq, air, opts) {
  const v = cfg.venue; const T = cfg.tools; const alive = () => seq === renderSeq && document.body.contains(art);
  const slot = (n) => art.querySelector(`[data-slot="${n}"]`);
  const renderSchedule = () => { const w = slot('schedule-wrap'); if (w) w.innerHTML = scheduleSecHTML(cfg); };
  art._renderSchedule = renderSchedule;
  art.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act],[data-food],[data-tmode],[data-tab-go],[data-sched],[data-more]'); if (!a) return;
    if (a.dataset.tabGo) showTab(art, a.dataset.tabGo, opts);
    else if (a.dataset.tmode) { const k = a.dataset.tmode; const sel = new Set(LS.get(eventKey(cfg), [])); k === 'all' ? sel.clear() : sel.has(k) ? sel.delete(k) : sel.add(k); LS.set(eventKey(cfg), [...sel]); applyModes(); }
    else if (a.dataset.sched) { LS.set('schedview:' + itinKey(cfg), a.dataset.sched); renderSchedule(); }
    else if (a.dataset.more != null) { a.closest('ul').querySelectorAll('.more').forEach(x => x.classList.remove('more')); a.closest('li').remove(); }
    else if (a.dataset.act === 'ics') { a.closest('details')?.removeAttribute('open'); downloadICS(cfg); }
    else if (a.dataset.act === 'share') shareEvent(cfg, opts);
    else if (a.dataset.food) { const s = slot('food'); s.innerHTML = foodHTML(cfg, art._osm, a.dataset.food); }
  });
  // one open menu at a time; tapping elsewhere closes it
  art.addEventListener('toggle', (e) => { if (e.target.matches('details.menu') && e.target.open) $$('details.menu[open]', art).forEach(d => { if (d !== e.target) d.open = false; }); }, true);
  if (!document._menuCloser) { document._menuCloser = true; document.addEventListener('click', (e) => { if (!e.target.closest('details.menu')) $$('details.menu[open]').forEach(d => { d.open = false; }); }); }
  wireItin(cfg, art); wirePacking(cfg, art); wireShopping(cfg, art);
  if (!v) wirePlan(cfg, art, null);
  art.querySelector('[data-lang]')?.addEventListener('change', (e) => setGuestLang(e.target.value));
  if (!v) return;

  const applyModes = () => {
    const bar = art.querySelector('.mode-bar');
    const avail = bar && !bar.hidden ? $$('[data-tmode]', bar).filter(b => !b.hidden).map(b => b.dataset.tmode) : [];
    const sel = new Set((LS.get(eventKey(cfg), []) || []).filter(k => avail.includes(k)));
    if (bar) $$('[data-tmode]', bar).forEach(b => { const on = b.dataset.tmode === 'all' ? !sel.size : sel.has(b.dataset.tmode); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    $$('[data-mode]', art).forEach(el => { el.hidden = !!sel.size && !el.dataset.mode.split(' ').some(k => sel.has(k)); });
    art._pack && art._pack();
  };
  art._applyModes = applyModes;
  // rental counters come from Google: fetch them only once the Travel tab is actually open
  const loadCounters = () => { const cs = slot('rental') && slot('rental').querySelector('[data-slot="car-counters"]'); const pnl = art.querySelector('[data-panel="travel"]');
    const ap = chosenAirport(cfg, air); if (!cs || gpBroken || (pnl && pnl.hidden)) return; gpCarsAll(cfg, ap).then(rows => { if (rows.length && document.body.contains(cs)) cs.innerHTML = carCountersHTML(cfg, ap, rows, art); }).catch(() => {}); };
  (art._showFns = art._showFns || []).push((k) => { if (k === 'travel') loadCounters(); });
  const refreshTrip = () => {
    const ap = chosenAirport(cfg, air);
    if (slot('flights')) slot('flights').innerHTML = flightsHTML(cfg, air, ap);
    if (slot('trains')) slot('trains').innerHTML = trainsHTML(cfg);
    if (slot('rental')) { slot('rental').innerHTML = rentalHTML(cfg, air, ap); loadCounters(); }
    if (slot('stay-links')) slot('stay-links').innerHTML = stayLinks(cfg, ap);
    const side = art.querySelector('.stub-side'); if (side && ap) side.innerHTML = stubSideHTML(cfg, ap);
    if (ap) $$('[data-ap-sel]', art).forEach(s => { if (s.value !== ap.iata) s.value = ap.iata; });
    if (slot('tour-links')) slot('tour-links').innerHTML = tourLinks(cfg);
    if (art._osm && slot('hotels')) slot('hotels').innerHTML = hotelsHTML(cfg, withArt(art._osm, art));
    $$('[data-k]', art).forEach(i => { const tr = tripDates(cfg); if (document.activeElement !== i && tr[i.dataset.k] != null) i.value = tr[i.dataset.k]; });
    art._pack && art._pack();
  };
  // "Flying into": one saved pick per event; the flights list, rental and My trip pickers all write it
  let apLast = (chosenAirport(cfg, air) || {}).iata;
  const setAirport = (iata, el) => {
    if (!air.some(a => a.iata === iata)) return;
    const box = el && el.closest('[data-slot]'); const name = box && box.dataset.slot; const top = el ? el.getBoundingClientRect().top : 0;
    const q = el && el.matches('[data-ap-sel]') ? '[data-ap-sel]' : `[data-ap="${iata}"]`;
    LS.set(apKey(cfg), iata); apLast = iata; refreshTrip();
    const n = name && slot(name) && slot(name).querySelector(q); if (n) window.scrollBy(0, n.getBoundingClientRect().top - top); // keep the control under the finger
  };
  art._apRefresh = () => { const ap = chosenAirport(cfg, air); if (ap && ap.iata !== apLast) { apLast = ap.iata; refreshTrip(); } };
  art.addEventListener('click', (e) => { const b = e.target.closest('[data-ap]'); if (b) setAirport(b.dataset.ap, b); });
  art.addEventListener('change', (e) => { const s = e.target.closest('[data-ap-sel]'); if (s) setAirport(s.value, s); });
  art.addEventListener('click', (e) => {
    if (!e.target.closest('[data-addbooking]') || !art._itinAdd) return;
    showTab(art, 'mytrip', opts); art._itinAdd();
    const f = art.querySelector('#sec-itinerary [data-slot="itin-form"]'); if (f) f.scrollIntoView({ block: 'start' });
  });
  art.addEventListener('click', (e) => {
    const b = e.target.closest('[data-addtrip]'); if (!b || !art._itinOpen) return;
    const tr = tripDates(cfg); const k = b.dataset.addtrip;
    if (b.dataset.iata) setAirport(b.dataset.iata);
    showTab(art, 'mytrip', opts);
    art._itinOpen({ kind: k, name: b.dataset.atLabel || '', address: b.dataset.atPlace || '', start: tr.arrive, end: k === 'flight' ? '' : tr.leave });
    const f = art.querySelector('#sec-itinerary [data-slot="itin-form"]'); if (f) f.scrollIntoView({ block: 'start' });
  });
  const tripKey = 'trip:' + cfg.start.slice(0, 10) + ':' + (cfg.end || cfg.start).slice(0, 10);
  art.addEventListener('change', (e) => { const sel = e.target.closest('[data-airline]'); if (!sel) return; LS.set('airline', sel.value); refreshTrip(); });
  art.addEventListener('change', (e) => {
    const i = e.target; const k = i.dataset.k; if (!k || !i.closest('.tripbar')) return;
    const tr = tripDates(cfg); tr[k] = k === 'guests' ? Math.max(1, Math.min(16, +i.value || 2)) : i.value;
    if (tr.leave <= tr.arrive) tr.leave = addDays(tr.arrive, 1);
    LS.set(tripKey, tr); refreshTrip();
  });
  const oi = art.querySelector('#ep-origin');
  if (oi) {
    const list = oi.nextElementSibling;
    const pick = (a) => { LS.set('origin', a[0]); oi.value = `${a[2] || a[1]} (${a[0]})`; list.hidden = true; refreshTrip(); };
    oi.addEventListener('input', () => {
      const res = searchAirports(oi.value.replace(/\(.*\)/, ''));
      if (!oi.value.trim()) { LS.del('origin'); refreshTrip(); }
      list.innerHTML = res.map((a, i) => `<li><button type="button" data-i="${i}"><b>${esc(a[0])}</b> ${esc(a[2] || '')} <span>${esc(a[1])}</span></button></li>`).join('');
      list.hidden = !res.length; list._res = res;
    });
    list.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pick(list._res[+b.dataset.i]); });
    oi.addEventListener('keydown', (e) => { if (e.key === 'Enter' && list._res && list._res[0] && !list.hidden) { e.preventDefault(); pick(list._res[0]); } if (e.key === 'Escape') list.hidden = true; });
    oi.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 200));
  }
  refreshTrip(); applyModes();

  if (cfg.start && (slot('weather') || art._pack)) {
    weatherFor(cfg).then(w => { if (!alive()) return; art._wx = w; if (slot('weather')) slot('weather').innerHTML = weatherHTML(w, cfg); art._pack && art._pack(); })
      .catch(() => { if (alive() && slot('weather')) slot('weather').innerHTML = `<p class="muted">${navigator.onLine === false ? `<b>${t('Offline')}</b> · ${t('The forecast needs a connection.')}` : t('Weather is unavailable right now. Try reloading the page.')}</p>`; });
  }
  const mapCtl = wireMap(cfg, art, opts);
  wirePlan(cfg, art, mapCtl);
  wireHotel(cfg, art, mapCtl);
  // Google Places first; if it is refused (quota, key) the OpenStreetMap list takes over, now or when its data arrives
  let gmode = false;
  const osmFood = (d) => { const s0 = slot('food'); if (!s0 || !alive()) return; art._useSrc('osm'); if (mapCtl) mapCtl.setData(d); wirePlaces(cfg, art, d, mapCtl ? mapCtl.setFood : null); };
  // "Search this area" on the OpenStreetMap list (no Google, or Google refused): the same lists around the new center
  if (mapCtl) mapCtl.onArea((a) => {
    if (gmode || !slot('food')) return; slot('food').innerHTML = loading(t('places to eat'));
    osmNearby(a.lat, a.lon).then(d => { if (!alive() || gmode) return; mapCtl.setData(d); wirePlaces(cfg, art, d, mapCtl.setFood, { lat: a.lat, lon: a.lon }); })
      .catch(() => { if (alive() && slot('food')) slot('food').innerHTML = `<p class="muted">${t('Nearby places could not be loaded right now.')}</p>`; });
  });
  gmode = wireGPlaces(cfg, art, mapCtl, () => {
    gmode = false; if (mapCtl) mapCtl.osmMode(); const s0 = slot('food'); if (s0) s0.innerHTML = loading(t('places to eat'));
    // Google's nearby data has no restaurants list (the Google list handled that), so fetch the OpenStreetMap one
    if (art._osm && art._osm.src === 'google') osmNearby(v.lat, v.lon).then(osmFood).catch(() => { if (alive() && slot('food')) slot('food').innerHTML = `<p class="muted">${t('Nearby places could not be loaded right now.')}</p>${ext(L.place('restaurants near ' + v.name, placeLabel(v)), t('Search on Google Maps'), 'btn')}`; });
    else if (art._osm && s0) osmFood(art._osm);
  });
  if (T.nearby || T.stay || T.travel || T.tours) {
    nearby(v.lat, v.lon).then(d => {
      if (!alive()) return; art._osm = d; art._useSrc(d.src === 'google' ? 'google' : 'osm');
      const ft = art.querySelector('.ev-foot p'); if (ft && d.snapshot) ft.insertAdjacentHTML('beforeend', ` · ${esc(t('Nearby places as mapped on {d}', { d: d.snapshot }))}`);
      if (slot('hotels')) slot('hotels').innerHTML = hotelsHTML(cfg, withArt(d, art));
      if (slot('sights')) slot('sights').innerHTML = sightsHTML(cfg, withArt(d, art));
      if (slot('transit')) slot('transit').innerHTML = transitHTML(cfg, d);
      if (slot('access-wrap')) slot('access-wrap').innerHTML = accessHTML(cfg, d);
      if (!Object.values(d.transit).some(xs => xs.length)) { const tb = art.querySelector('[data-tmode="transit"]'); if (tb) { tb.hidden = true; const bar = tb.parentElement; if ($$('[data-tmode]:not([hidden])', bar).length < 3) bar.hidden = true; } }
      applyModes();
      if (mapCtl) mapCtl.setData(d);
      art._focusPlace = (p) => mapCtl && mapCtl.focus(p);
      if (slot('food') && !gmode) { if (d.src === 'google') osmNearby(v.lat, v.lon).then(osmFood).catch(() => {}); else wirePlaces(cfg, art, d, mapCtl ? mapCtl.setFood : null); }
    }).catch(() => {
      if (!alive()) return;
      const msg = (what, q) => `<p class="muted">${t('Nearby places could not be loaded right now.')}</p>${ext(L.place(q, placeLabel(v)), t('Search on Google Maps'), 'btn')}`;
      if (slot('food')) slot('food').innerHTML = msg('restaurants', 'restaurants near ' + v.name);
      if (slot('hotels')) slot('hotels').innerHTML = msg('hotels', 'hotels near ' + v.name);
      if (slot('sights')) slot('sights').innerHTML = msg('sights', 'things to do near ' + v.name);
      if (slot('transit')) slot('transit').innerHTML = `<p class="muted">${t('Nearby stations could not be loaded right now.')}</p>${ext(L.dir(v, 'transit'), t('Transit directions'), 'btn')}`;
    });
  }
}

// "Add a booking": one sheet — paste text or a link / upload a screenshot or PDF / enter it yourself. Anything read
// lands as cards to check before saving.
const bkChooserHTML = () => `<div class="itin-sheet" data-sheet="choose"><div class="add-choices">
    <button type="button" class="add-choice" data-itin-mode="paste">${t('Paste confirmation text or link')}</button>
    <button type="button" class="add-choice" data-itin-mode="file" hidden>${t('Upload a screenshot or PDF')}</button>
    <button type="button" class="add-choice" data-itin-mode="manual">${t('Enter it yourself')}</button></div>
    <div class="btns"><button type="button" class="btn ghost" data-itin-cancel>${t('Cancel')}</button></div></div>`;
const bkPasteHTML = () => `<div class="itin-sheet" data-sheet="paste"><div class="field wide"><label for="it-paste">${t('Confirmation')}</label><textarea id="it-paste" rows="5" placeholder="${t('Paste a confirmation email or link')}"></textarea></div>
    <div class="btns"><button type="button" class="btn primary" data-itin-read>${t('Read it')}</button><button type="button" class="btn" data-itin-ai hidden>✦ ${t('Read with AI')}</button><button type="button" class="btn ghost" data-itin-cancel>${t('Cancel')}</button></div>
    <p class="hint" data-ai-msg role="status" aria-live="polite"></p><div data-signin-slot></div></div>`;
const bkFileHTML = () => `<div class="itin-sheet" data-sheet="file"><label class="btn primary file-pick">${t('Choose a screenshot or PDF')}<input type="file" accept="image/*,application/pdf" multiple data-itin-file hidden></label>
    <div class="btns"><button type="button" class="btn ghost" data-itin-cancel>${t('Cancel')}</button></div>
    <p class="hint" data-ai-msg role="status" aria-live="polite"></p><div data-signin-slot></div></div>`;
const bkSignInHTML = () => `<div class="bk-signin"><p><b>${t('Sign in to read it automatically.')}</b></p>${signInFormHTML('')}</div>`;
function bkReviewHTML(xs) {
  const inp = (x, i, k, label, type = 'text') => `<div class="field${k === 'name' || k === 'address' ? ' wide' : ''}${type === 'when' && !isDate(x[k] || '') ? ' when-f' : ''}"><label for="rv${i}-${k}">${t(label)}</label><input id="rv${i}-${k}" type="${type === 'when' ? (isDate(x[k] || '') ? 'date' : 'datetime-local') : type}" data-rv="${i}" data-rk="${k}" value="${esc(x[k] || '')}"></div>`;
  return `<div class="itin-sheet" data-sheet="review"><ul class="rv-list">${xs.map((x, i) => `<li class="rv-card">
    <div class="trip">
      <div class="field"><label for="rv${i}-kind">${t('Type')}</label><select id="rv${i}-kind" data-rv="${i}" data-rk="kind"><option value="">${t('Choose')}</option>${Object.entries(ITIN_KINDS).map(([v, l]) => `<option value="${v}" ${v === x.kind ? 'selected' : ''}>${t(l)}</option>`).join('')}</select></div>
      ${x.kind === 'flight' ? inp(x, i, 'flight', 'Flight number') : inp(x, i, 'confNo', 'Confirmation')}
      ${inp(x, i, 'name', 'Name')}
      ${inp(x, i, 'start', x.kind === 'flight' ? 'Departs' : 'Starts', 'when')}${inp(x, i, 'end', x.kind === 'flight' ? 'Arrives' : 'Ends', 'when')}
      ${x.kind === 'flight' ? inp(x, i, 'to', 'Arriving at') + inp(x, i, 'confNo', 'Confirmation') : inp(x, i, 'address', 'Address')}
    </div><button type="button" class="mini-b" data-rv-del="${i}">${t('Remove')}</button></li>`).join('')}</ul>
    <div class="btns"><button type="button" class="btn primary" data-rv-save>${esc(t('Save all ({n})', { n: xs.length }))}</button><button type="button" class="btn ghost" data-itin-cancel>${t('Cancel')}</button></div></div>`;
}
const blobB64 = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error(t('Couldn’t read it.'))); r.readAsDataURL(b); });
async function bookingFile(f) { // photos are shrunk on the phone before upload; PDFs go as they are
  if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '')) { if (f.size > 9e6) throw new Error(t('That PDF is too large.')); return { media_type: 'application/pdf', data: await blobB64(f) }; }
  if (!/^image\//.test(f.type)) throw new Error(t('Use a photo, screenshot or PDF.'));
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(t('Use a photo, screenshot or PDF.'))); i.src = url; });
    const k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
    return { media_type: 'image/jpeg', data: await blobB64(blob) };
  } finally { URL.revokeObjectURL(url); }
}
const flightName = (f) => { const code = String(f || '').replace(/\s+/g, '').toUpperCase(); const m = code.match(/^([A-Z0-9]{2})(\d{1,4})$/); if (!m) return ''; const a = AIRLINES[m[1]]; return a ? `${a[0]} ${m[1]} ${m[2]}` : ''; };
function wireItin(cfg, art) {
  const s = art.querySelector('#sec-itinerary'); if (!s) return;
  const body = s.querySelector('.sec-b'); let draft = null, editing = null, review = [], autoName = '';
  const air = cfg.venue ? airFor(cfg) : [];
  const rerender = () => { body.innerHTML = bookingsHTML(cfg); art._renderSchedule && art._renderSchedule(); art._planChanged && art._planChanged(); art._apRefresh && art._apRefresh(); if (LS.get('signedIn')) syncPush(cfg); };
  const formSlot = () => body.querySelector('[data-slot="itin-form"]');
  const sheet = (html) => { const slot = formSlot(); slot.innerHTML = html; body.querySelector('.itin-btns')?.setAttribute('hidden', ''); return slot; };
  // a saved flight that lands at one of the nearby airports becomes the "Flying into" pick
  const arrivalPick = (xs) => { const a = flightArrival(air, xs); if (a) LS.set(apKey(cfg), a.iata); };
  const saveNew = (add) => { LS.set(itinKey(cfg), itinLoad(cfg).concat(add)); arrivalPick(add); rerender(); if (add.length > 1) toast(t('Added {n} bookings', { n: add.length })); };
  const fileOk = () => LS.get('signedIn') ? aiModes().then(m => m.includes('file')) : aiReady();
  const openChooser = () => { const slot = sheet(bkChooserHTML()); fileOk().then(ok => { const b = slot.querySelector('[data-itin-mode="file"]'); if (b && ok) b.hidden = false; }).catch(() => {}); };
  const openReview = (xs) => { review = xs.map(x => ({ ...x })); if (!review.length) return openChooser(); sheet(bkReviewHTML(review)); };
  const askSignIn = (slot) => { const el = slot.querySelector('[data-signin-slot]'); if (el) el.innerHTML = bkSignInHTML(); };
  const openForm = (x, i) => {
    draft = { ...x }; editing = i; autoName = ''; const slot = sheet(itinFormHTML(draft, i, air));
    slot.querySelector('#it-name').focus();
    placeAutocomplete(slot.querySelector('#it-address'), { bias: () => cfg.venue, onPick: (id, tok) => gpVenue(id, tok).then(r => { draft.address = r.address; if (!draft.name) draft.name = r.name; fill(); }).catch(() => {}) });
  };
  const fill = () => { const slot = formSlot(); slot.querySelectorAll('[data-it]').forEach(el => { if (document.activeElement !== el) el.value = draft[el.dataset.it] || ''; });
    ['flight', 'to'].forEach(k => { slot.querySelector(`[data-it="${k}"]`).closest('.field').hidden = draft.kind !== 'flight'; });
    slot.querySelector('label[for="it-start"]').textContent = t(draft.kind === 'flight' ? 'Departs' : 'Starts'); slot.querySelector('label[for="it-end"]').textContent = t(draft.kind === 'flight' ? 'Arrives' : 'Ends');
    slot.querySelector('#it-note').placeholder = draft.kind === 'flight' ? t('Confirmation code, last name') : '';
    ['start', 'end'].forEach(k => { const el = slot.querySelector('#it-' + k); const ty = isDate(draft[k] || '') ? 'date' : 'datetime-local'; if (el.type !== ty) { el.type = ty; el.value = draft[k] || ''; } }); };
  art._itinOpen = (x) => { openForm(x, null); fill(); const c = body.querySelector('#it-confNo'); if (c) c.focus({ preventScroll: true }); };
  art._itinAdd = () => openChooser();
  art._itinReview = (xs) => openReview(xs);
  const runAI = (b, slot, req) => {
    const msg = slot.querySelector('[data-ai-msg]');
    if (!LS.get('signedIn')) { askSignIn(slot); return; }
    b.disabled = true; msg.textContent = t('Reading…');
    aiImport(req).then(j => {
      const add = aiItemsToBookings(j.data && j.data.items); b.disabled = false;
      if (!add.length) { msg.textContent = t('No reservations found. Enter it yourself.'); return; }
      openReview(add);
    }).catch(e => { b.disabled = false; if (e.signin) { msg.textContent = ''; askSignIn(slot); } else msg.textContent = e.message || t('Couldn’t read it.'); });
  };
  body.addEventListener('click', (e) => {
    const sio = e.target.closest('[data-si-oauth]'); if (sio) { oauthSignIn(sio.dataset.siOauth); return; }
    const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
    if (d.si === 'send') { signInSubmit(b.closest('.bk-signin')); return; }
    if ('itinAdd' in d) openChooser();
    else if (d.itinMode === 'paste') { const slot = sheet(bkPasteHTML()); slot.querySelector('#it-paste').focus(); aiReady().then(ok => { const a = slot.querySelector('[data-itin-ai]'); if (a && ok) a.hidden = false; }); }
    else if (d.itinMode === 'file') { const slot = sheet(bkFileHTML()); if (!LS.get('signedIn')) askSignIn(slot); }
    else if (d.itinMode === 'manual') { openForm({}, null); fill(); }
    else if ('itinRead' in d) { const txt = (body.querySelector('#it-paste') || {}).value || ''; const p = parseReservation(txt, cfg.start);
      if (!txt.trim()) { body.querySelector('[data-ai-msg]').textContent = t('Paste the whole confirmation first.'); return; }
      if (p.kind === 'flight' && !p.name) p.name = flightName(p.flight); openReview([p]); }
    else if ('itinAi' in d) {
      const slot = formSlot(); const txt = (slot.querySelector('#it-paste') || {}).value || '';
      if (txt.trim().length < 20) { slot.querySelector('[data-ai-msg]').textContent = t('Paste the whole confirmation first.'); return; }
      runAI(b, slot, { text: txt, kind: 'confirmation' });
    }
    else if ('rvDel' in d) { review.splice(+d.rvDel, 1); openReview(review); }
    else if ('rvSave' in d) {
      const add = review.filter(x => x.name || x.flight || x.start).map(x => ({ ...x, name: x.name || (x.kind === 'flight' ? flightName(x.flight) || String(x.flight || '').toUpperCase() : '') }));
      if (!add.length) { toast(t('Add a name or a date')); return; }
      saveNew(add);
    }
    else if ('itinEdit' in d) { openForm(itinLoad(cfg)[+d.itinEdit], +d.itinEdit); fill(); }
    else if ('itinCancel' in d) rerender();
    else if ('itinDel' in d) { const xs = itinLoad(cfg); xs.splice(+d.itinDel, 1); LS.set(itinKey(cfg), xs); rerender(); }
    else if ('itinSave' in d) {
      if (!draft.name && !draft.flight && !draft.start) { toast(t('Add a name or a date')); return; }
      if (draft.kind === 'flight' && draft.flight && !draft.name) draft.name = flightName(draft.flight) || draft.flight.toUpperCase();
      if (draft.kind !== 'flight') draft.to = '';
      if (editing == null) return saveNew([draft]);
      const xs = itinLoad(cfg); const was = xs[editing] || {}; xs[editing] = draft; LS.set(itinKey(cfg), xs); if ((was.to || '') !== (draft.to || '') || was.kind !== draft.kind) arrivalPick([draft]); rerender();
    }
    else if ('itinIcs' in d) itinICS(cfg);
  });
  body.addEventListener('change', (e) => {
    const f = e.target.closest('[data-itin-file]'); if (!f || !f.files || !f.files.length) return;
    const slot = formSlot(); const msg = slot.querySelector('[data-ai-msg]'); const label = slot.querySelector('.file-pick');
    if (!LS.get('signedIn')) { askSignIn(slot); f.value = ''; return; }
    msg.textContent = t('Reading…'); label.classList.add('busy');
    Promise.all([...f.files].slice(0, 6).map(bookingFile)).then(files => runAI({ set disabled(v) { label.classList.toggle('busy', v); } }, slot, { mode: 'file', files }))
      .catch(err => { label.classList.remove('busy'); msg.textContent = err.message || t('Couldn’t read it.'); }).finally(() => { f.value = ''; });
  });
  body.addEventListener('input', (e) => {
    const x = e.target;
    if (x.dataset.rv != null) { const r = review[+x.dataset.rv]; if (!r) return; r[x.dataset.rk] = x.value; if (x.dataset.rk === 'kind') openReview(review); return; }
    if (!draft || !x.dataset.it) return;
    draft[x.dataset.it] = x.value;
    if (x.dataset.it === 'kind') fill();
    if (x.dataset.it === 'flight') { // airline + number: the card names itself; status and manage links appear once saved
      const n = flightName(x.value); const ni = formSlot().querySelector('#it-name');
      if (n && (!draft.name || draft.name === autoName)) { draft.name = autoName = n; ni.value = n; }
    }
    if (x.dataset.it === 'to' && /^[a-z]{3}$/i.test(x.value)) draft.to = x.value.toUpperCase();
  });
}

function renderViewer(cfg, { exampleId, tab } = {}) {
  LANG = guestLangPick(cfg); document.documentElement.lang = LANG; document.documentElement.dir = RTL.has(LANG) ? 'rtl' : 'ltr';
  document.title = (cfg.title || 'Event') + ' · 1LinkTrip';
  const packed = location.hash.split('&t=')[0].slice(3);
  const editHref = exampleId ? `#edit-ex=${exampleId}` : `#edit=${packed}`;
  $('#app').innerHTML = `<div class="viewer"><div class="vbar"><a class="brand sm" href="#">${BRAND}</a>${exampleId ? `<span class="vbar-note">${t('Example page')}</span>` : ''}<a class="btn sm" href="${editHref}">${exampleId ? t('Customize this') : t('Edit a copy')}</a></div><div id="ev-root"></div></div>`;
  $('.vbar').insertAdjacentHTML('beforeend', langSelectHTML(cfg));
  renderEvent(translatedView(cfg, LANG), $('#ev-root'), { tab, src: cfg });
  const foot = $('.ev-foot a'); if (foot && exampleId) foot.setAttribute('href', editHref);
  if (location.search) $$('#app a[href="#"]').forEach(x => x.setAttribute('href', siteBase()));
  window.scrollTo(0, 0);
}

// ---------- editor ----------
let B = null; // builder state
function renderBuilder(cfg, source, hosted, pid) {
  LANG = 'en'; document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr';
  document.title = 'Edit your page · 1LinkTrip';
  B = { cfg: normalize(cfg), venueResults: [], tab: 'edit', card: null, hosted: hosted && hosted.id ? hosted : null };
  LS.set('draftHosted', B.hosted); B.pid = pid || newPid(); LS.set('draftId', B.pid); LS.set('draft', B.cfg); pageSave(B.pid, { cfg: B.cfg, hosted: B.hosted });
  $('#app').innerHTML = `
  <div class="builder" data-tab="edit">
    <header class="b-top">
      <a class="brand sm" href="#">${BRAND}</a>
      <div class="seg" role="tablist"><button role="tab" data-tab="edit" aria-selected="true">Edit</button><button role="tab" data-tab="preview" aria-selected="false">Preview</button></div>
      <button class="btn primary sm" data-act="publish">Share</button>
      <div class="b-save" data-save role="status" aria-live="polite"></div>
    </header>
    <form class="b-form" autocomplete="off" onsubmit="return false">${source ? `<p class="b-note">${esc(source)}</p>` : ''}</form>
    <div class="b-preview"><div class="b-frame" id="preview"></div></div>
  </div>
  <dialog id="sheet" class="sheet"><form class="sheet-in" autocomplete="off" onsubmit="return false"></form></dialog>
  <dialog id="pub"><form method="dialog" class="pub">
    <h2>Your page is ready to share</h2>
    <textarea id="pub-url" readonly rows="4"></textarea>
    <div id="pub-host"></div>
    <div class="btns"><button type="button" class="btn primary" data-act="copy">Copy link</button><button type="button" class="btn" data-act="native-share" hidden>Share…</button><button type="button" class="btn" data-act="qr">QR code</button><a class="btn" id="pub-open" href="#" target="_blank" rel="noopener noreferrer">Open page</a><button class="btn ghost">Close</button></div>
  </form></dialog>`;
  // what guests see on a shared page: the config last pushed (a page opened from My pages is live as opened)
  B.live = B.hosted ? ((pagesAll().find(x => x.pid === B.pid) || {}).live || cfgHash(B.cfg)) : ''; if (B.hosted) pageSave(B.pid, { live: B.live });
  buildForm(); saveStatus('');
  const bl = $('.builder');
  bl.addEventListener('click', (e) => {
    const tb = e.target.closest('[data-tab]'); if (tb && tb.tagName === 'BUTTON') { bl.dataset.tab = tb.dataset.tab; $$('.seg button').forEach(b => b.setAttribute('aria-selected', String(b === tb))); if (tb.dataset.tab === 'preview') { maps.forEach(m => m.invalidateSize()); window.scrollTo(0, 0); } }
    if (e.target.closest('[data-act="publish"]')) publishTranslated();
    if (e.target.closest('[data-act="update-live"]')) updateLive();
  });
  const dlg = $('#pub');
  dlg.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'copy') copy($('#pub-url').value);
    if (a.dataset.act === 'native-share') navigator.share({ title: B.cfg.title, url: $('#pub-url').value }).catch(() => {});
    if (a.dataset.act === 'qr') openQR(B.cfg, $('#pub-url').value);
  });
  const sh = $('#sheet');
  sh.addEventListener('close', () => { B.card = null; if (DU && DU.key !== 'main') DU = null; buildForm(); });
  sh.addEventListener('click', (e) => { if (e.target === sh) sh.close(); });
  wireInputs(sh.querySelector('.sheet-in'));
  DU = null; PH = null; wireDocs(sh.querySelector('.sheet-in')); wireDocs($('.b-form')); wirePageDrop(); docAIKnown(); wirePhotos(sh.querySelector('.sheet-in')); wirePhotos($('.b-form'));
  if (typeof wirePubHost === 'function') wirePubHost();
  if (SB && (LS.get('signedIn') || B.hosted)) msgReady().then(ok => { if (ok && B && !$('[data-card="msgs"]')) buildForm(); }); // no network for signed-out drafts
  if (LS.get('signedIn') && SB) aiModes().then(m => { if (m.includes('translate') && B && !$('[data-card="langs"]')) buildForm(); });
  preview();
  if (window.__openCard) { const id = window.__openCard; window.__openCard = null; openCard(id); }
}
async function publishTranslated() {
  const c = B.cfg; const langs = (c.langs || []).filter(l => l !== srcLang(c));
  if (langs.length && canTranslate() && langs.some(l => Object.keys(staleFields(c, l)).length)) {
    toast(t('Translating for your guests…'));
    try { await translateCfg(c); changed(); } catch { toast('Couldn’t translate right now; publishing in your language'); }
  }
  publish();
}
function publish(opts = {}) {
  const c = B.cfg; const problems = [];
  if (!c.title.trim()) problems.push('a title');
  if (!c.start) problems.push('a date');
  if (problems.length) { toast('Add ' + problems.join(' and ') + ' first'); return; }
  const url = shareURL(c); $('#pub-url').value = url; $('#pub-open').href = url;
  $('[data-act="native-share"]').hidden = !navigator.share;
  $('#pub h2').textContent = 'Your page is ready to share'; $('#pub-url').rows = 4;
  LS.set('published:' + Date.now(), { title: c.title, url }); pageSave(B.pid, { cfg: c, url });
  if (!$('#pub').open) $('#pub').showModal();
  if (typeof renderPubHost === 'function') { B.pub = { state: 'offer' }; renderPubHost(); if (SB && (B.hosted || opts.host)) hostNow(); }
}
const savedraft = debounce(() => { LS.set('draft', B.cfg); pageSave(B.pid, { cfg: B.cfg, hosted: B.hosted }); saveStatus('saved'); }, 300);
// Builder top bar: "Saving…" → "Saved" (this device) after every change; on a shared page with changes guests can't
// see yet: "Changes not live yet" + Update page (the same publish as Share, without the share sheet) → "Live ✓".
const cfgHash = (c) => hashStr(JSON.stringify(c));
function saveStatus(st) {
  const el = $('[data-save]'); if (!el || !B) return;
  const dirty = !!(B.hosted && B.live && cfgHash(B.cfg) !== B.live);
  const dev = st === 'saving' ? 'Saving…' : st === 'saved' ? 'Saved' : '';
  el.innerHTML = B.pushing ? `<span>Updating page…</span>` : dirty ? `<span>${dev ? esc(dev) + ' · ' : ''}Changes not live yet</span><button type="button" class="btn sm" data-act="update-live">Update page</button>`
    : B.hosted && B.justLive ? `<span class="ok">Live ✓</span>` : dev ? `<span>${esc(dev)}${dev === 'Saved' ? ' <small>on this device</small>' : ''}</span>` : '';
  el.classList.toggle('dirty', dirty);
}
async function updateLive() {
  if (!B || !B.hosted || B.pushing) return;
  let user = null; try { user = await sbUser(); } catch { /* below */ }
  if (!user) { publishTranslated(); return; } // signed out: the Share sheet asks to sign in, then publishes
  B.pushing = true; saveStatus('');
  try {
    const c = B.cfg; const langs = (c.langs || []).filter(l => l !== srcLang(c));
    if (langs.length && canTranslate() && langs.some(l => Object.keys(staleFields(c, l)).length)) { try { await translateCfg(c); LS.set('draft', B.cfg); } catch { /* publish in the organizer's language */ } }
    const row = await publishHosted(B.cfg, B.hosted); B.hosted = { id: row.id, slug: row.slug };
    markLive(); toast('Your page is updated');
  } catch (e) { toast('Couldn’t update: ' + (e.message || 'try again')); }
  finally { B.pushing = false; saveStatus(''); }
}
function markLive() { B.live = cfgHash(B.cfg); B.justLive = true; pageSave(B.pid, { cfg: B.cfg, hosted: B.hosted, live: B.live }); saveStatus(''); }
const preview = debounce(() => { const p = $('#preview'); if (!p) return; const sc = p.parentElement; const y = sc.scrollTop; const tab = p.querySelector('[data-tab-go][aria-selected="true"]')?.dataset.tabGo; renderEvent(B.cfg, p, { preview: true, shareUrl: shareURL(B.cfg), tab }); sc.scrollTop = y; }, 350);
function changed(rebuild) { if (B) B.justLive = false; saveStatus('saving'); savedraft(); preview(); if (rebuild) { if (B.card) renderSheet(); else buildForm(); } }

const fieldWrap = (label, html, id) => `<div class="field"><label${id ? ` for="${id}"` : ''}>${esc(label)}</label>${html}</div>`;
// shorter labels inside a card sheet, where the card title already gives context (the page keeps the full labels)
const EDIT_LABEL = { rsvp: 'Link', rsvpBy: 'Reply by', blockHotel: 'Hotel', blockUrl: 'Booking link', blockCode: 'Code', blockBy: 'Book by',
  packet: 'Where', packetWhen: 'When', badge: 'Where', badgeWhen: 'When', checkin: 'Where', checkinWhen: 'When', closures: 'Details', closuresUrl: 'Link',
  openerAt: 'Opener time', headlinerAt: 'Headliner time', callTime: 'Call time', slot: 'Slot', program: 'Program', photo: 'Photo and video',
  spectators: 'Info', pickup: 'Rideshare pickup' };
function xFieldHTML(c, [k, label, kind, ph = ''], solo) {
  const d = typeData(c); const id = `x-${k}`; const val = d[k];
  label = EDIT_LABEL[k] || label; if (ph === label) ph = '';
  if (solo && kind !== 'links' && kind !== 'place') { // the sheet title is the label
    const type = { url: 'url', date: 'date', time: 'time', datetime: 'datetime-local' }[kind] || 'text'; const a = `aria-label="${esc(label)}" placeholder="${esc(ph || label)}"`;
    return `<div class="field">${kind === 'lines' ? `<textarea id="${id}" data-x="${k}" rows="4" ${a}>${esc(val || '')}</textarea>` : `<input id="${id}" type="${type}" data-x="${k}" value="${esc(val || '')}" ${a}>`}</div>`;
  }
  if (solo && kind === 'links') return `<div class="field">${(val || []).map((l, i) => `<div class="rowed"><input data-xl="${k}" data-i="${i}" data-k="label" value="${esc(l.label)}" placeholder="Name" aria-label="${esc(label)} name"><input data-xl="${k}" data-i="${i}" data-k="url" type="url" value="${esc(l.url)}" placeholder="https://…" aria-label="${esc(label)} link"><button type="button" class="ic del" data-xdel="${k}" data-i="${i}" aria-label="Remove">Remove</button></div>`).join('')}<button type="button" class="btn sm" data-xadd="${k}">+ Add</button></div>`;
  if (kind === 'links') return `<div class="field"><label>${esc(label)}</label>${(val || []).map((l, i) => `<div class="rowed"><input data-xl="${k}" data-i="${i}" data-k="label" value="${esc(l.label)}" placeholder="Name" aria-label="${esc(label)} name"><input data-xl="${k}" data-i="${i}" data-k="url" type="url" value="${esc(l.url)}" placeholder="https://…" aria-label="${esc(label)} link"><button type="button" class="ic del" data-xdel="${k}" data-i="${i}" aria-label="Remove">Remove</button></div>`).join('')}<button type="button" class="btn sm" data-xadd="${k}">+ Add</button></div>`;
  if (kind === 'place') return `<div class="field"><label for="${id}">${esc(label)}</label><div class="search"><input id="${id}" data-xp="${k}" value="${esc(val ? val.q : '')}" placeholder="${esc(ph)}"><button type="button" class="btn" data-xfind="${k}">${val && val.lat != null ? 'Pinned' : 'Pin on map'}</button></div></div>`;
  if (kind === 'lines') return fieldWrap(label, `<textarea id="${id}" data-x="${k}" rows="4" placeholder="${esc(ph)}">${esc(val || '')}</textarea>`, id);
  const type = { url: 'url', date: 'date', time: 'time', datetime: 'datetime-local' }[kind] || 'text';
  return fieldWrap(label, `<input id="${id}" type="${type}" data-x="${k}" value="${esc(val || '')}"${ph ? ` placeholder="${esc(ph)}"` : ''}>`, id);
}
function cardDone(c, id) {
  if (id === 'route') return stopsOf(c).length > 0;
  const tc = (TYPE_CARDS[c.type] || []).find(x => x[0] === id);
  if (tc) { const sp = typeSpec(c), d = typeData(c); return tc[3].some(k => { const f = sp.fields.find(x => x[0] === k); return f && filled(f[2], d[k]); }); }
  return { schedule: () => c.schedule.some(x => x.title), custom: () => c.custom.some(x => x.title.trim()), notes: () => c.notes.some(x => x.label), about: () => !!(c.description || c.host), look: () => !!c.cover, bring: () => !!c.bring.trim(),
    access: () => !!(c.access && Object.values(c.access).some(Boolean)), replies: () => !c.off.rsvp, msgs: () => !!c.guestMessages, langs: () => (c.langs || []).length > 0 }[id]?.() || false;
}
const cardBtn = (c, [id, title, sub]) => { const done = cardDone(c, id); return `<button type="button" class="acard ${done ? 'on' : ''}" data-card="${id}"><span class="aic">${cardIcon(id)}</span><b>${esc(title)}</b><span>${esc(sub)}</span><i class="plus" aria-hidden="true">${done ? '✓' : '+'}</i></button>`; };
function allCards(c) { const cc0 = COMMON_CARDS.filter(x => (x[0] !== 'langs' || canTranslate() || (c.langs || []).length) && (x[0] !== 'msgs' || msgReadyNow())); return { type: TYPE_CARDS[c.type] || [], common: isTrip(c) ? cc0.filter(x => x[0] !== 'replies').map(x => x[0] === 'schedule' ? ['schedule', 'Day by day', 'Plans, bookings'] : x) : cc0 }; }
function buildForm() {
  const c = B.cfg; const f = $('.b-form'); if (!f) return; const keepNote = f.querySelector('.b-note:not(.b-host)'); const keepAI = f.querySelector('[data-ai-edit]');
  const open = new Set($$('details[data-acc][open]', f).map(d => d.dataset.acc)); B.moreOpen = open.has('design-more');
  if (!f.dataset.init) { f.dataset.init = '1'; if (!c.title) open.add('basics'); }
  const basicsOk = !!c.title.trim(); const whenOk = !!(c.start && c.venue);
  const cards = allCards(c);
  f.innerHTML = `${keepNote ? keepNote.outerHTML : ''}
  <details class="acc" data-acc="basics" ${open.has('basics') ? 'open' : ''}><summary><span class="st ${basicsOk ? 'ok' : ''}" aria-hidden="true"></span><b>Basics</b><small>${esc([c.type, c.title].filter(Boolean).join(' · '))}</small></summary><div class="acc-b">
    ${fieldWrap('Event type', `<select id="f-type" data-f="type">${TYPES.map(x => `<option value="${x}" ${x === c.type ? 'selected' : ''}>${TYPE_LABEL[x] || x}</option>`).join('')}</select>`, 'f-type')}
    ${fieldWrap('Title', `<input id="f-title" data-f="title" value="${esc(c.title)}" maxlength="80">`, 'f-title')}
    ${fieldWrap('Tagline', `<input id="f-tagline" data-f="tagline" value="${esc(c.tagline)}" maxlength="140" placeholder="Optional">`, 'f-tagline')}
  </div></details>
  <details class="acc" data-acc="when" ${open.has('when') ? 'open' : ''}><summary><span class="st ${whenOk ? 'ok' : ''}" aria-hidden="true"></span><b>When and where</b><small>${esc([c.start ? fmt(c.start.slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' }) : '', c.venue ? c.venue.name : ''].filter(Boolean).join(' · '))}</small></summary><div class="acc-b">
    ${whenFieldsHTML(c, 'f')}
    ${venueFieldHTML(c)}
  </div></details>
  <details class="acc" data-acc="design" ${open.has('design') ? 'open' : ''}><summary><span class="st ok" aria-hidden="true" style="background:${esc(c.theme.accent)};border-color:${esc(c.theme.accent)}"></span><b>Design</b><small>${esc([FONTS[c.theme.font]?.label, c.theme.mode === 'dark' ? 'Dark' : 'Light', c.cover ? 'Cover photo' : ''].filter(Boolean).join(' · '))}</small></summary><div class="acc-b">
    ${designHTML(c)}
  </div></details>
  ${docBlockHTML('main')}
  <h2 class="b-h">Add to your page</h2>
  ${cards.type.length ? `<p class="grp">${TYPE_GROUP[c.type]}</p><div class="cards">${cards.type.map(x => cardBtn(c, x)).join('')}</div>` : ''}
  <p class="grp">For any event</p><div class="cards">${cards.common.map(x => cardBtn(c, x)).join('')}</div>
  <p class="grp">Automatic for guests</p>
  <div class="tools">${TOOLS.map(([k, l]) => `<label class="tool"><input type="checkbox" data-tool="${k}" ${c.tools[k] ? 'checked' : ''}><span class="sw" aria-hidden="true"></span>${esc(l)}</label>`).join('')}</div>
  <div class="b-end"><button type="button" class="btn primary" data-act="publish">Share</button><button type="button" class="btn ghost" data-b="reset">Start over</button></div>`;
  wireInputs(f);
  if (typeof renderHostNote === 'function') renderHostNote();
  // the AI edit box survives form rebuilds (its preview and Undo live in it)
  if (keepAI) f.insertBefore(keepAI, f.firstChild); else if (SB && LS.get('signedIn')) { f.insertAdjacentHTML('afterbegin', aiEditHTML()); wireAIEdit(); }
  placeAutocomplete($('#vq', f), { bias: () => null, onPick: (id, tok) => gpVenue(id, tok).then(r => { B.vq = ''; B.venueResults = []; pickVenue(r); }).catch(() => toast('Couldn’t load that place')) });
}
function venueFieldHTML(c) {
  return c.venue ? `<div class="venue-sel"><div><b>${esc(c.venue.name)}</b><span>${esc(c.venue.address || '')}</span></div><button type="button" class="btn sm" data-b="clear-venue">Change</button></div>
      ${fieldWrap('Venue name on the page', `<input id="f-vname" data-v="name" value="${esc(c.venue.name)}">`, 'f-vname')}`
    : `<div class="field"><label for="vq">${isTrip(c) ? 'Destination' : 'Venue'}</label><div class="search"><input id="vq" placeholder="${isTrip(c) ? 'City or region' : 'Venue name or address'}" value="${esc(B.vq || '')}"><button type="button" class="btn" data-b="search">Search</button></div></div>
      <ul class="vres">${B.venueResults.map((r, i) => `<li><button type="button" data-pick="${i}"><b>${esc(r.name)}</b><span>${esc(r.display)}</span></button></li>`).join('')}</ul>${B.vmsg ? `<p class="hint">${esc(B.vmsg)}</p>` : ''}`;
}
function openCard(id) { if (id === 'custom' && !B.cfg.custom.length) B.cfg.custom.push(blankCustom()); if (DU && DU.key !== 'main') DU = null; B.card = id; renderSheet(); const sh = $('#sheet'); if (!sh.open) sh.showModal(); }
function renderSheet() {
  const c = B.cfg; const id = B.card; const form = $('#sheet .sheet-in'); if (!form || !id) return;
  const tc = (TYPE_CARDS[c.type] || []).find(x => x[0] === id); const cc = allCards(c).common.find(x => x[0] === id) || COMMON_CARDS.find(x => x[0] === id);
  const title = tc ? tc[1] : cc ? cc[1] : ''; let body = '';
  if (id === 'route') body = routeHTML(c);
  else if (tc) { const sp = typeSpec(c); body = tc[3].map(k => xFieldHTML(c, sp.fields.find(f => f[0] === k), tc[3].length === 1)).join(''); }
  else if (id === 'schedule' && isTrip(c)) body = tripPlanHTML(c);
  else if (id === 'schedule') body = `${c.schedule.map((x, i) => `<div class="rowed"><div class="two"><input type="date" data-s="${i}" data-k="date" value="${esc(x.date)}" aria-label="Date"><input type="time" data-s="${i}" data-k="time" value="${esc(x.time)}" aria-label="Time"></div><input data-s="${i}" data-k="title" value="${esc(x.title)}" placeholder="What's happening" aria-label="Title"><input data-s="${i}" data-k="note" value="${esc(x.note)}" placeholder="Where, or a note" aria-label="Note"><button type="button" class="ic del" data-sdel="${i}" aria-label="Remove item">Remove</button></div>`).join('')}
    <div class="btns"><button type="button" class="btn sm" data-b="add-sched">+ Add item</button>${typeof importButtonHTML === 'function' ? importButtonHTML() : ''}</div>`;
  else if (id === 'notes') body = `${c.notes.map((x, i) => `<div class="rowed"><input data-n="${i}" data-k="label" value="${esc(x.label)}" placeholder="Title" aria-label="Title"><input data-n="${i}" data-k="text" value="${esc(x.text || '')}" placeholder="Text" aria-label="Text"><input data-n="${i}" data-k="url" type="url" value="${esc(x.url || '')}" placeholder="Link (optional)" aria-label="Link"><button type="button" class="ic del" data-ndel="${i}" aria-label="Remove">Remove</button></div>`).join('')}
    <button type="button" class="btn sm" data-b="add-note">+ Add note</button>`;
  else if (id === 'custom') body = `${c.custom.map((x, i) => `<div class="rowed cs-row"><input data-cs="${i}" data-k="title" value="${esc(x.title)}" placeholder="Title" aria-label="Title" maxlength="80" required>
    <textarea data-cs="${i}" data-k="text" rows="4" placeholder="Text" aria-label="Text" maxlength="3000">${esc(x.text)}</textarea>
    <div class="two"><input data-cs="${i}" data-k="label" value="${esc(x.label)}" placeholder="Link name" aria-label="Link name" maxlength="80"><input data-cs="${i}" data-k="url" type="url" value="${esc(x.url)}" placeholder="Link, https://…" aria-label="Link"></div>
    ${SB ? photoCtlHTML('cs:' + i, x.img, `<input data-cs="${i}" data-k="img" type="url" value="${esc(x.img)}" placeholder="or a photo link, https://…" aria-label="Photo link">`) : `<div class="cover-row">${httpsUrl(x.img) ? `<img src="${esc(x.img)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<input data-cs="${i}" data-k="img" type="url" value="${esc(x.img)}" placeholder="Photo link, https://…" aria-label="Photo link"></div>`}
    ${docBlockHTML(customSid(x))}
    <button type="button" class="ic del" data-cdel="${i}" aria-label="Delete ${esc(x.title || 'section')}">Delete</button></div>`).join('')}
    <button type="button" class="btn sm" data-b="add-custom">+ Add section</button>`;
  else if (id === 'langs') body = langsCardHTML(c);
  else if (id === 'about') body = `${aboutSiteHTML(c)}${fieldWrap('Hosted by', `<input id="f-host" data-f="host" value="${esc(c.host)}">`, 'f-host')}${fieldWrap('About', `<textarea id="f-desc" data-f="description" rows="6">${esc(c.description)}</textarea>`, 'f-desc')}`;
  else if (id === 'look') body = `${coverFieldHTML(c)}
    <div class="field"><label>Color</label><div class="swatches">${SWATCHES.map(s => `<button type="button" class="sw ${s.toLowerCase() === c.theme.accent.toLowerCase() ? 'on' : ''}" style="background:${s}" data-sw="${s}" aria-label="Color ${s}"></button>`).join('')}<input type="color" data-t="accent" value="${esc(c.theme.accent)}" aria-label="Custom color"></div></div>
    <div class="field"><label>Title font</label><div class="fonts">${Object.entries(FONTS).map(([k, x]) => `<button type="button" class="fontb ${k === c.theme.font ? 'on' : ''}" data-font="${k}" style="font-family:${esc(x.css)}">${x.label}</button>`).join('')}</div></div>
    <div class="field"><label>Background</label><div class="seg2"><button type="button" data-theme-mode="light" class="${c.theme.mode !== 'dark' ? 'on' : ''}">Light</button><button type="button" data-theme-mode="dark" class="${c.theme.mode === 'dark' ? 'on' : ''}">Dark</button></div></div>`;
  else if (id === 'bring') body = fieldWrap('Guests must bring', `<textarea id="f-bring" data-f="bring" rows="5" placeholder="One per line">${esc(c.bring)}</textarea>`, 'f-bring');
  else if (typeof extraCardBody === 'function') body = extraCardBody(id, c);
  const head = title;
  if (id !== 'custom' && docCardOk(c, id)) body += docBlockHTML(id);
  setTimeout(() => { if (id === 'route') wireRouteAC(c); if (id === 'msgs') loadCardGroups(); }, 0);
  form.innerHTML = `<div class="grab" aria-hidden="true"></div><h2>${esc(head)}<button type="button" class="x" data-b="close" aria-label="Close">×</button></h2><div class="sheet-b">${body}</div><button type="button" class="btn primary big" data-b="close">Done</button>`;
}
// one input handler for the form and the card sheet
function wireInputs(root) {
  const c = () => B.cfg;
  root.oninput = (e) => {
    const i = e.target; const d = i.dataset; const cfg = c();
    const xd = () => (cfg.x[cfg.type] = cfg.x[cfg.type] || {});
    if (designInput(i, cfg) || routeInput(i, cfg) || langsInput(i, cfg)) return;
    if (d.when) { whenInput(cfg, d.when, i.value); changed(); }
    else if (d.x) { xd()[d.x] = i.value; changed(); }
    else if (d.xl) { xd()[d.xl][+d.i][d.k] = i.value; changed(); }
    else if (d.xp) { xd()[d.xp] = i.value ? { q: i.value } : null; const fb = root.querySelector(`[data-xfind="${d.xp}"]`); if (fb) fb.textContent = 'Pin on map'; changed(); }
    else if (d.f) { cfg[d.f] = i.value; if (d.f === 'start' && cfg.end && cfg.end < cfg.start) { cfg.end = ''; const en = root.querySelector('[data-f="end"]'); if (en) en.value = ''; } changed(d.f === 'type'); }
    else if (d.v) { cfg.venue[d.v] = i.value; changed(); }
    else if (d.t) { cfg.theme[d.t] = i.value; $$('.sw', root).forEach(s => s.classList.remove('on')); changed(); }
    else if (d.s != null) { cfg.schedule[+d.s][d.k] = i.value; changed(); }
    else if (d.n != null) { cfg.notes[+d.n][d.k] = i.value; changed(); }
    else if (d.cs != null) { const x = cfg.custom[+d.cs]; if (x) { x[d.k] = i.value; changed(); } }
    else if (d.tool) { cfg.tools[d.tool] = i.checked; changed(); }
    else if (i.id === 'vq') B.vq = i.value;
    else if (i.id === 'f-site') B.site = i.value;
    else if (typeof extraInput === 'function') extraInput(i, cfg);
  };
  root.onkeydown = (e) => { if (e.target.id === 'vq' && e.key === 'Enter') { e.preventDefault(); venueSearch(); } if (e.target.id === 'f-site' && e.key === 'Enter') { e.preventDefault(); aboutFill(); } };
  root.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return; const d = b.dataset; const cfg = c();
    if (designClick(b, cfg) || tripClick(b, cfg) || routeClick(b, cfg)) return;
    if (b.dataset.b === 'translate-now') { langsClick(b, cfg); return; }
    if (d.whenTg != null) { whenToggle(cfg); changed(true); setTimeout(() => root.querySelector(hasTime(cfg.start) ? '[data-when="st"]' : '[data-when-tg]')?.focus(), 0); }
    else if (d.card) openCard(d.card);
    else if (d.b === 'close') $('#sheet').close();
    else if (d.b === 'search') venueSearch();
    else if (d.b === 'site-fill') { if (!B.siteBusy) aboutFill(); }
    else if (d.pick != null) pickVenue(B.venueResults[+d.pick]);
    else if (d.b === 'clear-venue') { cfg.venue = null; cfg.tz = ''; B.venueResults = []; B.vmsg = ''; changed(true); setTimeout(() => $('#vq')?.focus(), 0); }
    else if (d.sw) { cfg.theme.accent = d.sw; changed(true); }
    else if (d.font) { cfg.theme.font = d.font; loadFont(d.font); changed(true); }
    else if (d.themeMode) { cfg.theme.mode = d.themeMode; changed(true); }
    else if (d.b === 'add-sched') { const last = cfg.schedule[cfg.schedule.length - 1]; cfg.schedule.push({ date: last?.date || cfg.start.slice(0, 10), time: '', title: '', note: '' }); changed(true); }
    else if (d.sdel != null) { cfg.schedule.splice(+d.sdel, 1); changed(true); }
    else if (d.b === 'add-note') { cfg.notes.push({ label: '', text: '', url: '' }); changed(true); }
    else if (d.ndel != null) { cfg.notes.splice(+d.ndel, 1); changed(true); }
    else if (d.b === 'add-custom') { cfg.custom.push(blankCustom()); changed(true); setTimeout(() => $$('#sheet [data-cs][data-k="title"]').pop()?.focus(), 0); }
    else if (d.cdel != null) {
      const x = cfg.custom[+d.cdel]; if (!x) return;
      const drop = () => { const sid = customSid(x); const i = cfg.custom.indexOf(x); if (i < 0) return; cfg.custom.splice(i, 1); delete cfg.off[sid]; if (Array.isArray(cfg.order)) cfg.order = cfg.order.filter(k => k !== sid); changed(true); };
      if (![x.title, x.text, x.label, x.url, x.img].join('').trim()) drop();
      else confirmDlg({ title: `Delete “${x.title.trim() || 'Custom section'}”?`, ok: 'Delete' }).then(yes => { if (yes) drop(); });
    }
    else if (d.xadd) { const x = (cfg.x[cfg.type] = cfg.x[cfg.type] || {}); (x[d.xadd] = x[d.xadd] || []).push({ label: '', url: '' }); changed(true); }
    else if (d.xdel) { cfg.x[cfg.type][d.xdel].splice(+d.i, 1); changed(true); }
    else if (d.xfind) pinPlace(d.xfind, b);
    else if (d.b === 'reset') { if (confirm('Clear this draft and start over?')) { LS.del('draft'); renderSetup(); } }
    else if (typeof extraClick === 'function') extraClick(b, cfg);
  };
}
async function venueSearch() {
  const q = ($('#vq')?.value || '').trim(); B.vq = q;
  if (q.length < 3) { B.vmsg = 'Type at least 3 characters.'; buildForm(); return; }
  const btn = $('[data-b="search"]'); if (btn) { btn.disabled = true; btn.textContent = 'Searching…'; }
  try { B.venueResults = await geocode(q); B.vmsg = B.venueResults.length ? '' : 'No matches. Try adding the city or street.'; }
  catch { B.venueResults = []; B.vmsg = 'Search is unavailable right now. Try again in a moment.'; }
  buildForm(); const d = $('details[data-acc="when"]'); if (d) d.open = true; $('#vq')?.focus();
}
async function pickVenue(r) {
  const c = B.cfg; c.venue = { name: r.name, address: r.address, lat: r.lat, lon: r.lon, city: r.city, region: r.region, country: r.country, cc: r.cc };
  c.tz = ''; changed(true);
  try { c.tz = await lookupTZ(r.lat, r.lon); changed(); } catch { /* times stay floating */ }
}

// ---------- guided setup: type → name and date → venue → done ----------
let SU = null;
function renderSetup() {
  LANG = 'en'; document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr';
  document.title = 'Create a page · 1LinkTrip';
  SU = { step: 0, cfg: blankEvent('Party'), results: [], q: '', msg: '' }; LS.del('draftHosted'); LS.set('draftId', newPid());
  B = { cfg: SU.cfg, venueResults: [] };
  $('#app').innerHTML = `<div class="setup"><div class="su-main"></div><div class="su-preview"><div class="su-tag">Preview</div><div class="b-frame" id="su-frame"></div></div></div>`;
  suRender();
}
const suPreview = debounce(() => { const p = $('#su-frame'); if (p && getComputedStyle(p.parentElement).display !== 'none') renderEvent(SU.cfg, p, { preview: true }); }, 250);
function suTicket(c) {
  const g = (v, ph) => v ? esc(v) : `<span class="ghost">${ph}</span>`;
  const air = c.venue ? pickAirport(nearestAirports(c.venue.lat, c.venue.lon), null, []) : null;
  return `<div class="su-ticket" style="--acc:${c.theme.accent}"><div><span class="lbl">${esc(c.type)}${c.venue && c.venue.city ? ' · ' + esc(c.venue.city) : ''}</span><b>${g(c.title, 'Your event')}</b><span>${c.start && SU.dated ? esc(dateRange(c.start, c.end)) + (c.start.length > 10 ? ' · ' + esc(fmtTime(c.start.slice(11, 16))) : '') : '<span class="ghost">Date</span>'}</span><span>${g(c.venue && c.venue.name, 'Venue')}</span></div><div class="r"><span class="lbl">Fly into</span><b>${air ? esc(air.iata) : '<span class="ghost">···</span>'}</b></div></div>`;
}
function suRender() {
  const c = SU.cfg; const n = SU.step; const m = $('.su-main'); if (!m) return;
  const prog = `<div class="prog" aria-hidden="true">${[0, 1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>`;
  const top = `<div class="su-top">${n > 0 && n < 3 ? '<button type="button" class="link" data-su="back">← Back</button>' : '<a class="brand sm" href="#">' + BRAND + '</a>'}${n === 2 ? '<button type="button" class="link strong" data-su="skip">Skip</button>' : ''}</div>`;
  let h = '', body = '', cta = '';
  if (n === 0) {
    h = 'What are you planning?';
    body = `${suAIHTML()}<div class="su-types">${SETUP_TYPES.map(([type, label, sub, col]) => `<button type="button" class="su-type ${SU.pick === type ? 'on' : ''}" aria-pressed="${SU.pick === type}" data-su-type="${esc(type)}"><i class="ti" aria-hidden="true"><svg viewBox="0 0 24 24">${TYPE_ICONS[type] || TYPE_ICONS.Party}</svg></i><b>${esc(label)}</b><span>${esc(sub)}</span></button>`).join('')}</div>`;
    cta = `<button type="button" class="btn primary big" data-su="next0" ${SU.pick ? '' : 'disabled'}>Next</button>`;
  } else if (n === 1) {
    h = 'What’s it called, and when?';
    body = `<div class="field"><label for="su-title">Name</label><input id="su-title" data-su-f="title" value="${esc(c.title)}" maxlength="80" autocomplete="off"></div>
      ${whenFieldsHTML(c, 'su', !SU.dated, true)}`;
    cta = `<button type="button" class="btn primary big" data-su="next" ${c.title.trim() && SU.dated ? '' : 'disabled'}>Continue</button>`;
  } else if (n === 2) {
    h = isTrip(c) ? 'Where are you going?' : 'Where is it?';
    body = `<div class="search"><input id="su-q" placeholder="${isTrip(c) ? 'City or region' : 'Venue name or address'}" value="${esc(SU.q)}" autocomplete="off"><button type="button" class="btn" data-su="search">Search</button></div>
      ${SU.results.length ? `<div class="su-res">${SU.results.map((r, i) => `<button type="button" data-su-pick="${i}" class="${c.venue && c.venue.lat === r.lat && c.venue.lon === r.lon ? 'on' : ''}"><b>${esc(r.name)}</b><span>${esc(r.display)}</span></button>`).join('')}</div>` : ''}${SU.msg ? `<p class="hint">${esc(SU.msg)}</p>` : ''}`;
    cta = `<button type="button" class="btn primary big" data-su="next" ${c.venue ? '' : 'disabled'}>Continue</button>`;
  } else {
    h = 'Your page is ready';
    const url = shareURL(c); const sugg = (TYPE_CARDS[c.type] || []).slice(0, 2).concat([COMMON_CARDS[0]]);
    body = `<div class="su-done" aria-hidden="true">✓</div>
      <div class="su-link"><input readonly value="${esc(url)}" aria-label="Link to your page"><button type="button" class="btn sm" data-su="copy">Copy</button></div>
      <div class="two su-share"><button type="button" class="btn primary" data-su="share">Share</button><a class="btn" href="${esc(url)}">View page</a></div>
      ${typeof qrButtonHTML === 'function' ? qrButtonHTML() : ''}
      <p class="grp">Add to your page</p>
      <div class="su-later">${sugg.map(([id, title]) => `<button type="button" data-su-card="${id}"><span>${esc(title)}</span><b>+ Add</b></button>`).join('')}<button type="button" data-su-card=""><span>See all</span><b>→</b></button></div>`;
    LS.set('published:' + Date.now(), { title: c.title, url });
  }
  m.innerHTML = `${prog}${top}<h1>${h}</h1><div class="su-body">${body}</div><div class="grow"></div>${n === 1 || n === 2 ? suTicket(c) : ''}${cta}`;
  LS.set('draft', c); pageSave(LS.get('draftId'), { cfg: c }); suPreview();
  if (n === 0) aiReady().then(ok => { const el = $('[data-su-ai]'); if (el && ok) el.hidden = false; const pend = LS.get('pendingAiUrl'); if (ok && pend && el) { LS.del('pendingAiUrl'); sbUser().then(u => { if (!u) return; el.querySelector('.su-ai-form').hidden = false; $('#su-ai-url').value = pend; SU.pick = SU.aiType = LS.get('pendingAiType') || ''; LS.del('pendingAiType'); $$('.su-type').forEach(x => x.classList.toggle('on', x.dataset.suType === SU.aiType)); const nb = $('[data-su="next0"]'); if (nb) nb.disabled = !SU.pick; suAIHint(); suAIGo(); }).catch(() => {}); } });
  placeAutocomplete($('#su-q'), { bias: () => null, onPick: (id, tok) => gpVenue(id, tok).then(r => {
    if (!SU) return; const cc = SU.cfg; cc.venue = { name: r.name, address: r.address, lat: r.lat, lon: r.lon, city: r.city, region: r.region, country: r.country, cc: r.cc }; SU.q = r.name; SU.results = []; SU.msg = '';
    suRender(); lookupTZ(r.lat, r.lon).then(tz => { cc.tz = tz; LS.set('draft', cc); }).catch(() => {});
  }).catch(() => { SU.msg = 'Couldn’t load that place. Try the Search button.'; suRender(); }) });
  const first = m.querySelector('#su-title, #su-q'); if (first && !first.value) setTimeout(() => first.focus(), 30);
}
document.addEventListener('click', (e) => {
  if (!SU || !e.target.closest('.setup')) return;
  const b = e.target.closest('button'); if (!b) return; const d = b.dataset; const c = SU.cfg;
  if (d.suType) {
    // picking a category only selects it; Next moves on, so a website link can be added too
    SU.pick = SU.aiType = SU.pick === d.suType ? '' : d.suType;
    $$('.su-type').forEach(x => { const on = x.dataset.suType === SU.pick; x.classList.toggle('on', on); x.setAttribute('aria-pressed', on); });
    suAIHint(); const nb = $('[data-su="next0"]'); if (nb) nb.disabled = !SU.pick;
  } else if (d.su === 'next0') {
    const f = $('.su-ai-form'); const url = f && !f.hidden ? ($('#su-ai-url').value || '').trim() : '';
    if (url) suAIGo();
    else if (SU.pick) {
      const type = SU.pick; const keep = { title: c.title, start: c.start, end: c.end, venue: c.venue, tz: c.tz };
      if (!(SU.typed && c.type === type)) { SU.cfg = Object.assign(blankEvent(type), keep); B.cfg = SU.cfg; }
      SU.typed = true; SU.step = 1; suRender();
    }
  } else if (d.whenTg != null) { whenToggle(c); suRender(); const f = $(hasTime(c.start) ? '#su-st' : '#su-sd'); if (f) f.focus(); }
  else if (d.su === 'ai-open') { const f = $('.su-ai-form'); f.hidden = !f.hidden; if (!f.hidden) { SU.aiType = SU.pick || ''; suAIHint(); $('#su-ai-url').focus(); } }
  else if (d.su === 'ai-go') suAIGo();
  else if (d.si === 'send') signInSubmit($('.setup'));
  else if (d.su === 'back') { SU.step = Math.max(0, SU.step - 1); suRender(); }
  else if (d.su === 'skip') { c.venue = null; SU.step = 3; suRender(); }
  else if (d.su === 'next') { if (!b.disabled) { SU.step++; suRender(); } }
  else if (d.su === 'search') suSearch();
  else if (d.suPick != null) {
    const r = SU.results[+d.suPick]; c.venue = { name: r.name, address: r.address, lat: r.lat, lon: r.lon, city: r.city, region: r.region, country: r.country, cc: r.cc };
    suRender(); lookupTZ(r.lat, r.lon).then(tz => { c.tz = tz; LS.set('draft', c); }).catch(() => {});
  }
  else if (d.su === 'copy') copy(shareURL(c));
  else if (d.su === 'share') { if (navigator.share) navigator.share({ title: c.title, url: shareURL(c) }).catch(() => {}); else copy(shareURL(c)); }
  else if (d.suCard != null) { LS.set('draft', c); window.__openCard = d.suCard || null; SU = null; if (location.hash === '#new') route(); else location.hash = '#new'; }
  else if (typeof suExtraClick === 'function') suExtraClick(b, c);
});
document.addEventListener('input', (e) => {
  if (!SU || !e.target.closest('.setup')) return;
  const i = e.target; const c = SU.cfg; const f = i.dataset.suF;
  if (i.id === 'su-q') { SU.q = i.value; return; }
  if (i.dataset.when) { if (i.dataset.when === 'sd') SU.dated = !!i.value; whenInput(c, i.dataset.when, i.value); }
  else if (!f) return;
  if (f === 'title') c.title = i.value;
  const nb = $('[data-su="next"]'); if (nb) nb.disabled = !(c.title.trim() && SU.dated);
  const tk = $('.su-ticket'); if (tk) tk.outerHTML = suTicket(c);
  LS.set('draft', c); pageSave(LS.get('draftId'), { cfg: c }); suPreview();
});
document.addEventListener('keydown', (e) => {
  if (!SU || !e.target.closest('.setup') || e.key !== 'Enter') return;
  if (e.target.id === 'su-q') { e.preventDefault(); suSearch(); }
  else if (e.target.id === 'su-ai-url') { e.preventDefault(); suAIGo(); }
  else if (SU.step === 1) { const nb = $('[data-su="next"]'); if (nb && !nb.disabled) nb.click(); }
});
async function suSearch() {
  const q = SU.q.trim(); if (q.length < 3) { SU.msg = 'Type at least 3 characters.'; suRender(); return; }
  const btn = $('[data-su="search"]'); if (btn) { btn.disabled = true; btn.textContent = 'Searching…'; }
  try { SU.results = await geocode(q); SU.msg = SU.results.length ? '' : 'No matches. Try adding the city or street.'; }
  catch { SU.results = []; SU.msg = 'Search is unavailable right now. Try again in a moment.'; }
  suRender();
}

// ================= phase B: QR + print card, schedule import, access and arrival, guest languages =================
const LANGS = [['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['pt', 'Português'], ['de', 'Deutsch'], ['it', 'Italiano'], ['ja', '日本語']];
function pickLang() {
  const saved = LS.get('lang'); if (saved && LOCALES[saved]) return saved;
  const nav = (navigator.languages || [navigator.language || 'en']).map(x => String(x).slice(0, 2).toLowerCase()).find(x => LOCALES[x]);
  return nav || 'en';
}

// ---- QR code and printable card ----
function qrSVG(text, cell = 4) {
  if (typeof qrcode !== 'function') return null;
  for (const ecl of ['M', 'L']) {
    try { const q = qrcode(0, ecl); q.addData(text, 'Byte'); q.make(); return { svg: q.createSvgTag({ cellSize: cell, margin: cell * 2, scalable: true }), n: q.getModuleCount() }; } catch { /* too long for this level */ }
  }
  return null;
}
const qrButtonHTML = () => `<button type="button" class="btn" data-su="qr">QR code</button>`;
function openQR(cfg, url) {
  url = url || shareURL(cfg); const q = qrSVG(url);
  if (!q) { toast('This page has too much text for a QR code. Shorten the description or notes.'); return; }
  let d = $('#qrdlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'qrdlg'; document.body.appendChild(d); d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); }
  d.innerHTML = `<div class="pub qr-dlg"><h2>${esc(cfg.title || 'Your page')}</h2><div class="qr-box">${q.svg}</div>
    <div class="btns"><button type="button" class="btn primary" data-qr="print">Print card</button><button type="button" class="btn" data-qr="svg">Download</button><button type="button" class="btn ghost" data-qr="close">Close</button></div></div>`;
  d.onclick = (e) => {
    const b = e.target.closest('[data-qr]'); if (!b) { if (e.target === d) d.close(); return; }
    if (b.dataset.qr === 'close') d.close();
    if (b.dataset.qr === 'svg') { const blob = new Blob([q.svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')], { type: 'image/svg+xml' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (cfg.title || 'event').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '-qr.svg'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
    if (b.dataset.qr === 'print') printCard(cfg, q.svg);
  };
  if (!d.open) d.showModal();
}
function printCard(cfg, svg) {
  let c = $('#print-card'); if (!c) { c = document.createElement('div'); c.id = 'print-card'; document.body.appendChild(c); }
  const v = cfg.venue; loadFont(cfg.theme.font);
  c.setAttribute('style', themeStyle(cfg.theme));
  c.innerHTML = `<div class="pc-in"><p class="pc-k">${esc(cfg.type)}${v && v.city ? ' · ' + esc(v.city) : ''}</p><h1>${esc(cfg.title)}</h1>
    <p class="pc-when">${esc(dateRange(cfg.start, cfg.end))}${cfg.start && cfg.start.length > 10 ? ' · ' + esc(fmtTime(cfg.start.slice(11, 16))) : ''}</p>${v ? `<p class="pc-where">${esc(v.name)}</p>` : ''}
    <div class="pc-qr">${svg}</div><p class="pc-cta">Scan for the schedule, travel and more</p></div>`;
  setTimeout(() => window.print(), 300);
}

// ---- import a schedule from .ics or CSV ----
const importButtonHTML = () => `<label class="btn sm file-btn">Import .ics or CSV<input type="file" data-import accept=".ics,.csv,text/calendar,text/csv"></label>`;
function utcToWall(date, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
function parseICS(text, tz) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/); const out = []; let ev = null;
  const unesc = (s) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
  for (const ln of lines) {
    if (/^BEGIN:VEVENT/i.test(ln)) { ev = {}; continue; }
    if (/^END:VEVENT/i.test(ln)) { if (ev && ev.title && ev.date) out.push(ev); ev = null; continue; }
    if (!ev) continue;
    const m = ln.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/i); if (!m) continue;
    const [, key, params, val] = m; const K = key.toUpperCase();
    if (K === 'SUMMARY') ev.title = unesc(val);
    else if (K === 'LOCATION') ev.note = unesc(val);
    else if (K === 'DESCRIPTION' && !ev.note) ev.note = unesc(val).slice(0, 120);
    else if (K === 'DTSTART') {
      const d = val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z?))?/); if (!d) continue;
      const day = `${d[1]}-${d[2]}-${d[3]}`;
      if (!d[4]) { ev.date = day; ev.time = ''; continue; }
      let wall = `${day}T${d[4]}:${d[5]}`;
      const tzid = (params.match(/TZID=([^;:]+)/i) || [])[1];
      if (d[6] === 'Z') wall = utcToWall(new Date(wall + ':00Z'), tz);
      else if (tzid && tz && tzid !== tz) { try { wall = utcToWall(wallToUTC(wall, tzid), tz); } catch { /* keep as written */ } }
      ev.date = wall.slice(0, 10); ev.time = wall.slice(11, 16);
    }
  }
  return out;
}
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',' || ch === ';' || ch === '\t') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  const clean = rows.map(r => r.map(c => c.trim())).filter(r => r.some(Boolean)); if (!clean.length) return [];
  const head = clean[0].map(h => h.toLowerCase());
  const find = (...names) => head.findIndex(h => names.some(n => h === n || h.includes(n)));
  let idx = { date: find('date', 'day'), time: find('time', 'start'), title: find('title', 'name', 'event', 'session', 'what'), note: find('note', 'location', 'room', 'where', 'description', 'place') };
  let body = clean.slice(1);
  if (idx.title < 0) { idx = { date: 0, time: 1, title: 2, note: 3 }; body = clean; }
  const toDate = (s) => { let m; if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`; if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(+m[1])}-${pad(+m[2])}`; return ''; };
  const toTime = (s) => { const m = (s || '').match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([ap])?\.?m?\.?$/i); if (!m) return ''; let h = +m[1]; if (m[3]) { h %= 12; if (/p/i.test(m[3])) h += 12; } return h < 24 ? `${pad(h)}:${m[2] || '00'}` : ''; };
  return body.map(r => ({ date: toDate(r[idx.date] || ''), time: toTime(r[idx.time] || ''), title: r[idx.title] || '', note: idx.note >= 0 ? (r[idx.note] || '') : '' })).filter(x => x.title);
}
function extraInput(i, cfg) {
  if (i.dataset.import != null && i.files && i.files[0]) {
    const f = i.files[0];
    f.text().then(text => {
      const items = /\.ics$/i.test(f.name) || /BEGIN:VCALENDAR/.test(text) ? parseICS(text, cfg.tz) : parseCSV(text);
      if (!items.length) { toast('No schedule items found in that file'); return; }
      cfg.schedule = cfg.schedule.filter(x => x.title).concat(items.map(x => ({ date: x.date || cfg.start.slice(0, 10), time: x.time || '', title: x.title, note: x.note || '' })))
        .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
      changed(true); toast(`Added ${items.length} item${items.length > 1 ? 's' : ''}`);
    });
    return;
  }
  if (i.dataset.rsvpOn != null) { cfg.off.rsvp = !i.checked; changed(); return; }
  if (i.dataset.gmsg != null) { cfg.guestMessages = i.checked; changed(); return; }
  if (i.dataset.access) { cfg.access = cfg.access || {}; cfg.access[i.dataset.access] = i.value; changed(); }
}

// ---- access and arrival ----
const ACCESS_FIELDS = [['dropoff', 'Drop-off point'], ['entrance', 'Step-free entrance'], ['parking', 'Accessible parking'], ['restrooms', 'Accessible restrooms'], ['notes', 'Other access notes']];
COMMON_CARDS.splice(3, 0, ['access', 'Access and arrival', 'Drop-off, step-free']);
COMMON_CARDS.splice(1, 0, ['replies', 'RSVP form', 'Collect replies']);
COMMON_CARDS.push(['msgs', t('Messages'), t('Guest messages, groups')]); // shown once schema-3 is installed
async function loadCardGroups() {
  const slot = $('#sheet [data-grp-slot]'); if (!slot || !B.hosted || !SB) return; const eid = B.hosted.id;
  const paint = async () => { try { const c = await sb(); const gs = await loadGroups(c, eid); if (!document.body.contains(slot)) return; slot.innerHTML = groupsEdHTML(gs); wireGroupsEd(slot, c, eid, paint); } catch { slot.innerHTML = ''; } };
  if (!(await myGuestUser())) { slot.innerHTML = `<p class="hint">${t('Sign in to manage groups.')}</p>`; return; }
  paint();
}
function extraCardBody(id, c) {
  if (id === 'msgs') return `<label class="tool"><input type="checkbox" data-gmsg ${c.guestMessages ? 'checked' : ''}><span class="sw" aria-hidden="true"></span>${t('Let guests message you')}</label>
    <h3 class="sub-h">${t('Groups')}</h3><div data-grp-slot>${B.hosted ? `<p class="muted small">${t('Loading…')}</p>` : `<p class="hint">${t('Get a short link first.')}</p>`}</div>`;
  if (id === 'replies') return `<label class="chk"><input type="checkbox" data-rsvp-on ${c.off.rsvp ? '' : 'checked'}> RSVP form on your short link</label><p class="hint">Replies show in My pages. Short links only.</p>`;
  if (id !== 'access') return '';
  const a = c.access || {};
  return ACCESS_FIELDS.map(([k, l]) => fieldWrap(l, `<input id="acc-${k}" data-access="${k}" value="${esc(a[k] || '')}">`, `acc-${k}`)).join('');
}
function accessHTML(cfg, osm) {
  if (cfg.off.access) return '';
  const a = cfg.access || {}; const rows = ACCESS_FIELDS.filter(([k]) => a[k] && String(a[k]).trim()).map(([k, l]) => `<li class="note"><b>${esc(t(l))}</b><span>${esc(a[k])}</span></li>`);
  let st = '';
  if (osm && cfg.venue) {
    const v = cfg.venue; const sts = ['subway', 'rail', 'tram', 'ferry', 'bus'].flatMap(k => osm.transit[k] || []).filter(x => x.wheelchair === 'yes' || x.wheelchair === 'limited').sort((x, y) => x.d - y.d).slice(0, 3);
    if (sts.length) st = `<h3 class="sub-h">${t('Step-free stations nearby')}</h3><ul class="plist">${sts.map(x => `<li><div><b>${esc(x.name)}</b><span>${esc(t(x.wheelchair === 'yes' ? 'Step-free' : 'Partly step-free'))}${x.line ? ' · ' + esc(x.line.split(';').join(' · ')) : ''}</span></div><span class="dist">${esc(fmtDist(x.d, v.cc))}<small>${walkTxt(x.d)}</small></span></li>`).join('')}</ul>`;
  }
  const docs = docsHTML(cfg, ['access']);
  if (!rows.length && !st && !docs) return '';
  return sec('access', t('Access and arrival'), `${rows.length ? `<ul class="links">${rows.join('')}</ul>` : ''}${st}${docs}`);
}

function extraClick(b, cfg) { if (b.dataset.act === 'qr') openQR(cfg); }
function suExtraClick(b, cfg) { if (b.dataset.su === 'qr') openQR(cfg); }

// ================= About: fill from a website link =================
// Free, keyless, CORS-enabled readers: Microlink first, Jina Reader as the fallback. Everything fetched is treated as plain text.
const cleanText = (s, max) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const safeImg = (u) => { try { const x = new URL(String(u || '')); return x.protocol === 'https:' && x.href.length <= 800 ? x.href : ''; } catch { return ''; } };
function normSite(u) { u = String(u || '').trim(); if (!u) return ''; if (!/^https?:\/\//i.test(u)) u = 'https://' + u; try { const x = new URL(u); return /\./.test(x.hostname) ? x.href : ''; } catch { return ''; } }
async function fetchTimeout(url, init = {}, ms = 12000) {
  const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...init, signal: ac.signal }); } finally { clearTimeout(tm); }
}
async function readSite(url) {
  const tries = [
    async () => {
      const r = await fetchTimeout(`https://api.microlink.io/?url=${enc(url)}`); if (!r.ok) throw new Error('microlink ' + r.status);
      const j = await r.json(); if (j.status !== 'success' || !j.data) throw new Error('microlink failed');
      const d = j.data; return { title: d.title, description: d.description, image: d.image && d.image.url, publisher: d.publisher };
    },
    async () => {
      const r = await fetchTimeout(`https://r.jina.ai/${url}`, { headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error('jina ' + r.status);
      const j = await r.json(); const d = j && j.data; if (!d) throw new Error('jina failed');
      return { title: d.title, description: d.description || '', image: '', publisher: '' };
    },
  ];
  for (const f of tries) {
    try {
      const m = await f();
      const out = { title: cleanText(m.title, 120), description: cleanText(m.description, 1200), image: safeImg(m.image), publisher: cleanText(m.publisher, 80) };
      // a reader that could not load the page tends to echo the hostname or an error page back
      const host = hostOf(url);
      if (/application error|access denied|just a moment|attention required|404|not found|enable javascript/i.test(out.title + ' ' + out.description.slice(0, 120))) continue;
      if (!out.description && (!out.title || out.title.replace(/^www\./, '') === host)) continue;
      return out;
    } catch { /* next reader */ }
  }
  return null;
}
const aboutSiteHTML = (c) => `<div class="field"><label for="f-site">Website</label><div class="search"><input id="f-site" type="url" inputmode="url" placeholder="yourwedding.com" value="${esc(B.site || '')}" autocomplete="off"><button type="button" class="btn" data-b="site-fill" ${B.siteBusy ? 'disabled' : ''}>${B.siteBusy ? 'Reading…' : 'Fill in'}</button></div><p class="hint" id="site-msg" role="status" aria-live="polite">${esc(B.siteMsg || 'Copies the description and photo.')}</p></div>`;
async function aboutFill() {
  const c = B.cfg; const url = normSite(B.site);
  if (!url) { B.siteMsg = 'That doesn’t look like a website link.'; renderSheet(); return; }
  B.siteBusy = true; B.siteMsg = 'Reading that site…'; renderSheet();
  const m = await readSite(url);
  B.siteBusy = false;
  if (!m) { B.siteMsg = 'Couldn’t read that site. Type it in below.'; renderSheet(); setTimeout(() => $('#f-desc')?.focus(), 0); return; }
  const got = [];
  if (m.description) { c.description = m.description; got.push('description'); } else if (m.title && !c.description) { c.description = m.title; got.push('title'); }
  if (!c.title.trim() && m.title) { c.title = m.title.slice(0, 80); got.push('title'); }
  if (!c.host.trim() && m.publisher && m.publisher.replace(/^www\./, '') !== hostOf(url)) { c.host = m.publisher; got.push('host'); }
  if (m.image && !c.cover) { c.cover = m.image; got.push('photo'); }
  B.siteMsg = got.length ? `Filled in from ${hostOf(url)}. Edit anything below.` : 'That site had nothing to copy. Type it in below.';
  changed(true);
}

// ================= phase C: hosted pages (Supabase) =================
// Guests talk to the database over plain REST with the publishable key (no library download).
// Organizers load supabase-js only when they ask for a short link or open My pages (lazy sign-in, magic link only).
const SB = window.EP_SUPABASE && window.EP_SUPABASE.url ? window.EP_SUPABASE : null;
const SB_JS = { src: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.js', integrity: 'sha384-uteMfOloLDGt042uDz+xHGF3ym63/WQ6rFq7murQRG8Ih7QrXGEGNtWd8688sb4O' };
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
const siteBase = () => location.origin + location.pathname;
const shortURL = (slug) => `${siteBase()}?e=${slug}`;
let sbClient = null, sbLoading = null;
function sb() {
  if (sbClient) return Promise.resolve(sbClient);
  if (!SB) return Promise.reject(new Error('Hosting is not set up'));
  return sbLoading || (sbLoading = new Promise((res, rej) => {
    const go = () => {
      try {
        sbClient = window.supabase.createClient(SB.url, SB.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'ep-auth' } });
        res(sbClient);
      } catch (e) { sbLoading = null; rej(e); }
    };
    if (window.supabase && window.supabase.createClient) return go();
    const s = document.createElement('script'); s.src = SB_JS.src; s.integrity = SB_JS.integrity; s.crossOrigin = 'anonymous';
    s.onload = go; s.onerror = () => { sbLoading = null; s.remove(); rej(new Error('Could not load sign-in. Check your connection.')); };
    document.head.appendChild(s);
  }));
}
async function sbUser() { const c = await sb(); const { data } = await c.auth.getSession(); return data && data.session ? data.session.user : null; }
async function rest(path, { method = 'GET', body, prefer } = {}) {
  if (!SB) throw new Error('Hosting is not set up');
  const headers = { apikey: SB.key, Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const url = `${SB.url}/rest/v1/${path}`; const keep = method === 'GET' && offKeepRest(path);
  let r;
  try { r = await fetchTimeout(url, { method, headers, body: body ? JSON.stringify(body) : undefined }, 15000); }
  catch (e) { if (method === 'GET' && OFFLINE_REST.test(path)) { const h = await offGet(url); if (h) return h.json(); } throw e; }
  if (!r.ok) { const e = new Error('Request failed (' + r.status + ')'); e.status = r.status; throw e; }
  if (keep && r.status === 200) { const j = await r.json(); offPut(url, new Response(JSON.stringify(j), { headers: { 'Content-Type': 'application/json' } })); return j; }
  return r.status === 204 || r.status === 201 && prefer === 'return=minimal' ? null : r.json();
}
// ================= offline: a trip the guest opened stays readable without a connection =================
// The service worker keeps the app itself (sw.js). This keeps the page's data: its config and updates (REST), its
// documents and photos (Storage), in the 'ep-data' cache that survives app updates; My trip data is in localStorage.
// "Save for offline" in My trip is on by default for every trip opened; off removes this page's copies.
const DATA_CACHE = 'ep-data';
const OFFLINE_REST = /^(events\?slug=eq\.|announcements\?|event_groups\?)/;
const offOK = () => typeof caches !== 'undefined';
const offSlugOf = (path) => { const m = path.match(/^events\?slug=eq\.([a-z0-9-]+)/); return m ? m[1] : ''; };
const offOn = (key) => LS.get('offline:' + key) !== false;
const offKeepRest = (path) => OFFLINE_REST.test(path) && (!offSlugOf(path) || offOn(offSlugOf(path)));
async function offPut(url, resp) { if (!offOK()) return; try { await (await caches.open(DATA_CACHE)).put(url, resp); } catch { /* storage full or blocked */ } }
async function offGet(url, ignoreSearch) { if (!offOK()) return null; try { return (await (await caches.open(DATA_CACHE)).match(url, { ignoreSearch: !!ignoreSearch })) || null; } catch { return null; } }
const offFiles = (cfg) => [...(cfg.files || []).map(f => f.url), cfg.cover, ...(cfg.custom || []).map(x => x.img)].map(u => httpsUrl(u || '')).filter(Boolean);
async function offSave(cfg) {
  if (!offOK()) return 0; const c = await caches.open(DATA_CACHE); let n = 0;
  for (const u of offFiles(cfg)) { if (await c.match(u)) { n++; continue; } try { const r = await fetch(u, { mode: 'cors' }); if (r.ok) { await c.put(u, r); n++; } } catch { /* not reachable now; tried again next open */ } }
  return n;
}
async function offForget(cfg, hosted) {
  if (!offOK()) return; const c = await caches.open(DATA_CACHE);
  for (const u of offFiles(cfg)) await c.delete(u);
  if (hosted) for (const req of await c.keys()) if (req.url.includes(`slug=eq.${hosted.slug}`) || req.url.includes(`event_id=eq.${hosted.id}`)) await c.delete(req);
}
// queued while offline, sent when the connection is back: RSVPs and messages to the host
const outbox = () => LS.get('outbox', []) || [];
function outboxAdd(x) { LS.set('outbox', outbox().concat([{ ...x, at: Date.now() }])); }
let flushing = false;
async function flushOutbox() {
  if (flushing || navigator.onLine === false) return; const xs = outbox(); if (!xs.length) return; flushing = true; const left = []; let sent = 0;
  for (const x of xs) {
    try {
      if (x.kind === 'rsvp') { await sendRSVP(x.row); const m = LS.get('rsvp:' + x.row.event_id); if (m) { delete m.pending; LS.set('rsvp:' + x.row.event_id, m); } }
      else if (x.kind === 'msg') { const c = await sb(); const { data, error } = await c.from('event_messages').insert(x.row).select('id').single(); if (error) throw error; notifyEmail('message', data.id); }
      sent++;
    } catch (e) { if (!(e && e.status >= 400 && e.status < 500)) left.push(x); } // refused (4xx): dropped, not retried forever
  }
  LS.set('outbox', left); flushing = false;
  if (sent) { toast(t('Sent what you saved while offline')); document.querySelectorAll('[data-rsvp-pending]').forEach(el => el.remove()); }
}
const isNetErr = (e) => navigator.onLine === false || !(e && e.status);
function offlineRowHTML(cfg, opts) {
  if (!offOK() || opts.preview) return '';
  const key = opts.hosted ? opts.hosted.slug : syncKey(cfg);
  return `<div class="off-row" data-slot="offline"><label class="tool"><input type="checkbox" data-offline ${offOn(key) ? 'checked' : ''}><span class="sw" aria-hidden="true"></span>${t('Save for offline')}</label><small class="muted" data-offline-st></small></div>`;
}
function wireOffline(cfg, art, opts) {
  const html = document.documentElement; const set = () => html.classList.toggle('is-offline', navigator.onLine === false); set();
  if (!wireOffline.on) { wireOffline.on = true; addEventListener('offline', set); addEventListener('online', () => { set(); flushOutbox(); }); }
  if (opts.preview) return;
  const key = opts.hosted ? opts.hosted.slug : syncKey(cfg);
  const stEl = () => art.querySelector('[data-offline-st]');
  const status = (n) => { const el = stEl(); if (!el) return; el.textContent = !offOn(key) ? t('Needs a connection to open') : navigator.onLine === false ? t('Showing the copy saved on this device') : t('Saved on this device · {n} files', { n }); };
  const save = () => { if (!offOn(key)) return status(0); if (navigator.onLine === false) return status(0); offSave(cfg).then(status).catch(() => status(0)); };
  save(); flushOutbox();
  addEventListener('online', () => { if (!document.body.contains(art)) return; if (LS.get('signedIn') && cfg.tools.mytrip) syncPush(cfg); save(); });
  addEventListener('offline', () => { if (document.body.contains(art)) { status(0); art._offMap && art._offMap(); } });
  art.addEventListener('change', (e) => { if (!e.target.matches('[data-offline]')) return; const on = e.target.checked; LS.set('offline:' + key, on);
    if (on) { if (opts.hosted) fetchHosted(opts.hosted.slug).catch(() => {}); save(); } else offForget(cfg, opts.hosted).then(() => status(0)); });
  // documents: with no connection, open the saved copy
  art.addEventListener('click', (e) => {
    const a = e.target.closest('.docs a[href], .doc-files a[href]'); if (!a || navigator.onLine !== false) return;
    e.preventDefault(); const dl = a.hasAttribute('download'); const w = dl ? null : window.open('', '_blank');
    offGet(a.href, true).then(r => r ? r.blob() : null).then(b => {
      if (!b) { if (w) w.close(); toast(t('This document isn’t saved on this device')); return; }
      const u = URL.createObjectURL(b); if (w) w.location.href = u; else { const x = document.createElement('a'); x.href = u; x.download = a.getAttribute('download') || 'document'; x.click(); }
    });
  });
  // Nearby with no connection: the map can't load; the hotel and saved spots with their addresses instead
  const offMap = () => { const el = art.querySelector('[data-slot="map-off"]'); if (!el) return; el.innerHTML = navigator.onLine === false ? `<p class="muted off-msg"><b>${t('Offline')}</b> · ${t('The map needs a connection. Open in Google Maps works with its offline maps.')}</p>${spotsHTML(cfg)}` : ''; };
  art._offMap = offMap; offMap(); addEventListener('online', offMap);
}
async function fetchHosted(slug) {
  if (!SLUG_RE.test(slug)) return null;
  const rows = await rest(`events?slug=eq.${enc(slug)}&select=id,slug,config,updated_at&limit=1`);
  return rows && rows[0] ? rows[0] : null;
}
const fetchAnnouncements = (id) => rest(`announcements?event_id=eq.${enc(id)}&select=id,body,created_at&order=created_at.desc&limit=20`);
const sendRSVP = (row) => rest('rsvps', { method: 'POST', body: row, prefer: 'return=minimal' });
function makeSlug(title) {
  let base = String(title || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '');
  if (base.length < 2) base = 'event';
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  return base + '-' + Array.from(crypto.getRandomValues(new Uint8Array(5)), b => abc[b % abc.length]).join('');
}
const fmtStamp = (iso) => { try { return new Intl.DateTimeFormat(LOCALES[LANG] || 'en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)); } catch { return ''; } };

// ---------- guest side: a hosted page ----------
async function renderHosted(slug, tab) {
  LANG = pickLang(); document.documentElement.lang = LANG;
  $('#app').innerHTML = `<div class="viewer"><div class="vbar"><a class="brand sm" href="#">${BRAND}</a></div><div id="ev-root"><div class="skel" role="status"><span></span><span></span><em>${t('Loading…')}</em></div></div></div>`;
  let row = null;
  try { row = await fetchHosted(slug); }
  catch { return hostedProblem(t('Couldn’t load this page. Check your connection and try again.'), true); }
  if (!row) return hostedProblem(t('This page isn’t available. It may have been removed or hidden by its organizer.'));
  const osm = row.config && row.config.osm; const cfg = normalize(row.config); const hosted = { id: row.id, slug: row.slug, url: shortURL(row.slug) };
  if (osm && cfg.venue && Array.isArray(osm.food)) memo.set(osmKey(cfg.venue.lat, cfg.venue.lon), Promise.resolve(osm));
  document.title = (cfg.title || 'Event') + ' · 1LinkTrip';
  LANG = guestLangPick(cfg); document.documentElement.lang = LANG; document.documentElement.dir = RTL.has(LANG) ? 'rtl' : 'ltr';
  $('.vbar').insertAdjacentHTML('beforeend', `${langSelectHTML(cfg)}<a class="btn sm" href="#edit=${packEvent(cfg)}">${t('Edit a copy')}</a>`);
  renderEvent(translatedView(cfg, LANG), $('#ev-root'), { tab, hosted, shareUrl: hosted.url, src: cfg });
  // '#' alone can't leave a ?e= page (the hash doesn't change), so home links point at the app itself
  $$('#app a[href="#"]').forEach(x => x.setAttribute('href', siteBase()));
  window.scrollTo(0, 0);
}
function hostedProblem(msg, retry) {
  $('#app').innerHTML = `<main class="land"><header class="land-top"><a class="brand" href="#">${BRAND}</a></header><section class="broken"><h1>${esc(msg)}</h1>${retry ? `<button class="btn primary" onclick="location.reload()">${t('Try again')}</button>` : `<a class="btn primary" href="${esc(siteBase())}">${t('Go to 1LinkTrip')}</a>`}</section></main>`;
  $$('#app a[href="#"]').forEach(x => x.setAttribute('href', siteBase()));
}
function rsvpFormHTML(cfg, hosted) {
  const mine = LS.get('rsvp:' + hosted.id);
  if (mine && !mine.editing) return `<div class="rsvp-done"><p><b>${esc(t('Thanks, {n}.', { n: mine.name }))}</b> ${esc(mine.attending ? t('We’ve got you down as coming.') : t('We’ve let the host know you can’t make it.'))}</p>${mine.pending ? `<p class="hint" data-rsvp-pending>${esc(t('Saved on this device. It will be sent when you’re back online.'))}</p>` : ''}<button type="button" class="btn sm" data-rsvp="again">${t('Change my reply')}</button></div>`;
  const prev = mine || {};
  return `<form class="rsvp" novalidate onsubmit="return false">
    <div class="field"><label for="rs-name">${t('Your name')}</label><input id="rs-name" maxlength="120" autocomplete="name" value="${esc(prev.name || '')}" required></div>
    <div class="field"><span class="lbl-s">${t('Will you be there?')}</span><div class="seg2" role="radiogroup"><button type="button" role="radio" data-rsvp-att="1" aria-checked="${prev.attending !== false}" class="${prev.attending !== false ? 'on' : ''}">${t('Yes, I’ll be there')}</button><button type="button" role="radio" data-rsvp-att="0" aria-checked="${prev.attending === false}" class="${prev.attending === false ? 'on' : ''}">${t('Can’t make it')}</button></div></div>
    <div class="two"><div class="field" data-rsvp-guests ${prev.attending === false ? 'hidden' : ''}><label for="rs-guests">${t('How many, including you')}</label><input id="rs-guests" type="number" min="1" max="20" inputmode="numeric" value="${esc(prev.guests || 1)}"></div>
    <div class="field"><label for="rs-email">${t('Email (optional)')}</label><input id="rs-email" type="email" maxlength="254" autocomplete="email" value="${esc(prev.email || '')}"></div></div>
    <div data-rsvp-group></div>
    <div class="field"><label for="rs-note">${t('Note for the host (optional)')}</label><textarea id="rs-note" rows="2" maxlength="1000">${esc(prev.note || '')}</textarea></div>
    <p class="rsvp-msg" role="status" aria-live="polite"></p>
    <button type="button" class="btn primary" data-rsvp="send">${t('Send reply')}</button>
    <p class="muted small">${t('Only the host sees your reply.')}</p>
  </form>`;
}
function wireHosted(cfg, art, hosted, opts = {}) {
  const body = art.querySelector('.ev-panel[data-panel="event"] .ev-body'); if (!body) return;
  body.insertAdjacentHTML('afterbegin', '<div data-slot="ann"></div>');
  if (!cfg.off.rsvp) {
    const html = sec('rsvp', t('RSVP'), `<div data-slot="rsvp">${rsvpFormHTML(cfg, hosted)}</div>`);
    const wrap = body.querySelector('[data-slot="rsvp-wrap"]');
    if (wrap) wrap.innerHTML = html; else body.querySelector('[data-slot="ann"]').insertAdjacentHTML('afterend', html);
  }
  if (opts.preview) { art.querySelectorAll('.rsvp input, .rsvp textarea, .rsvp button').forEach(x => { x.disabled = true; }); return; }
  // groups guests can pick at RSVP, and messages (both hidden until schema-3 is installed)
  art._fillPick = () => { const g = art.querySelector('[data-rsvp-group]'); const P = art._gm; if (g && P && P.picks.length) g.innerHTML = groupPickHTML(P.picks, (LS.get('rsvp:' + hosted.id) || {}).group || ''); };
  wireGuestMsgs(cfg, art, hosted);
  fetchAnnouncements(hosted.id).then(rows => {
    const s = art.querySelector('[data-slot="ann"]'); if (!s || !rows || !rows.length) return;
    const tr = (cfg.tr && cfg.tr[LANG]) || {}; const show = (r) => { const e = tr['ann.' + r.id]; return e && e.h === hashStr(r.body) ? e.t : r.body; };
    s.innerHTML = `<section class="ev-sec ann" aria-label="${t('Updates from the host')}"><h2 class="sec-h">${t('Updates from the host')}</h2><ul class="ann-list">${rows.map(r => `<li><time>${esc(fmtStamp(r.created_at))}</time><p>${esc(show(r))}</p></li>`).join('')}</ul></section>`;
  }).catch(() => {});
  art.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rsvp],[data-rsvp-att]'); if (!b) return;
    const slot = art.querySelector('[data-slot="rsvp"]');
    if (b.dataset.rsvpAtt != null) {
      $$('[data-rsvp-att]', slot).forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); });
      slot.querySelector('[data-rsvp-guests]').hidden = b.dataset.rsvpAtt === '0'; return;
    }
    if (b.dataset.rsvp === 'again') { const m = LS.get('rsvp:' + hosted.id) || {}; m.editing = true; LS.set('rsvp:' + hosted.id, m); slot.innerHTML = rsvpFormHTML(cfg, hosted); art._fillPick(); return; }
    if (b.dataset.rsvp !== 'send') return;
    const v = (id) => (slot.querySelector('#' + id)?.value || '').trim();
    const msg = slot.querySelector('.rsvp-msg');
    const attending = slot.querySelector('[data-rsvp-att="1"]').classList.contains('on');
    const name = v('rs-name').slice(0, 120), email = v('rs-email').slice(0, 254), note = v('rs-note').slice(0, 1000);
    const guests = attending ? Math.min(20, Math.max(1, parseInt(v('rs-guests'), 10) || 1)) : 0;
    if (!name) { msg.textContent = t('Add your name first.'); slot.querySelector('#rs-name').focus(); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg.textContent = t('That email doesn’t look right.'); slot.querySelector('#rs-email').focus(); return; }
    const group = (slot.querySelector('#rs-group') || {}).value || '';
    b.disabled = true; msg.textContent = t('Sending…');
    try {
      await sendRSVP({ event_id: hosted.id, name, email: email || null, attending, guests, note: note || null, ...(group ? { group_id: group } : {}) });
      LS.set('rsvp:' + hosted.id, { name, email, attending, guests, note, group, at: Date.now() });
      if (group) { const u = art._gm && art._gm.user; if (u) setMyGroup(hosted.id, group, u).then(() => art._gmLoad && art._gmLoad()).catch(() => {}); else LS.set('grpPick:' + hosted.id, group); }
      slot.innerHTML = rsvpFormHTML(cfg, hosted);
    } catch (err) {
      if (isNetErr(err)) { outboxAdd({ kind: 'rsvp', row: { event_id: hosted.id, name, email: email || null, attending, guests, note: note || null, ...(group ? { group_id: group } : {}) } }); LS.set('rsvp:' + hosted.id, { name, email, attending, guests, note, group, at: Date.now(), pending: true }); slot.innerHTML = rsvpFormHTML(cfg, hosted); return; }
      b.disabled = false; msg.textContent = t('Couldn’t send your reply. Check your connection and try again.');
    }
  });
}

// ---------- organizer: sign-in (magic link) ----------
async function sendMagicLink(email) {
  const c = await sb();
  const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: siteBase(), shouldCreateUser: true } });
  if (error) throw error;
}
// Social sign-in: add a provider here and switch it on in supabase-config.js (EP_AUTH_PROVIDERS)
const OAUTH = [['google', 'Continue with Google'], ['apple', 'Sign in with Apple']];
const oauthOn = () => OAUTH.filter(([k]) => window.EP_AUTH_PROVIDERS && window.EP_AUTH_PROVIDERS[k]);
// A plain link to Supabase's authorize endpoint (implicit flow, same URL signInWithOAuth builds): the tap itself
// navigates, so it can't silently stall in an installed iPhone app or while the sign-in library is still loading.
const oauthURL = (provider) => `${SB.url}/auth/v1/authorize?provider=${encodeURIComponent(provider)}&redirect_to=${encodeURIComponent(siteBase())}`;
function oauthSignIn(provider, before) {
  try { if (before) before(); } catch { /* storage full: sign-in still works, the draft stays saved locally */ }
  LS.set('afterSignIn', location.hash || '#mine');
}
const signInFormHTML = (msg, email = '') => `<div class="signin">${oauthOn().length ? `<div class="oauth">${oauthOn().map(([k, l]) => `<a class="btn oauth-${k}" data-si-oauth="${k}" href="${esc(oauthURL(k))}">${esc(l)}</a>`).join('')}</div><p class="or muted small">or get a link by email</p>` : ''}
    <div class="field"><label for="si-email">Your email</label><div class="search"><input id="si-email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" value="${esc(email)}"><button type="button" class="btn primary" data-si="send">Send link</button></div></div>
    <p class="hint" role="status" aria-live="polite">${esc(msg || 'We’ll email you a one-time sign-in link. No password.')}</p></div>`;
async function signInSubmit(root, after) {
  const inp = root.querySelector('#si-email'); const hint = root.querySelector('.signin .hint'); const btn = root.querySelector('[data-si="send"]');
  const email = (inp.value || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { hint.textContent = 'Enter the email address you want to sign in with.'; inp.focus(); return; }
  if (navigator.onLine === false) { hint.textContent = t('Offline') + ' · ' + t('Sign in when you’re back online.'); return; }
  btn.disabled = true; hint.textContent = 'Sending…';
  try { if (after) after(); await sendMagicLink(email); LS.set('signinEmail', email); root.querySelector('.signin').outerHTML = `<div class="signin sent"><p><b>Check your email.</b> We sent a sign-in link to ${esc(email)}. Open it on this device to finish.</p><button type="button" class="link" data-si="retry">Use a different email</button></div>`; }
  catch (e) { btn.disabled = false; hint.textContent = /rate|too many|seconds/i.test(e.message || '') ? 'Sign-in email limit reached for now. Use Continue with Google, or try the email link again in an hour.' : 'Couldn’t send the link. ' + (e.message || 'Try again.'); }
}
async function authReturn() {
  $('#app').innerHTML = `<main class="land"><section class="broken"><h1>Signing you in…</h1></section></main>`;
  let session = null;
  try { const c = await sb(); const r = await c.auth.getSession(); session = r.data && r.data.session; } catch { /* below */ }
  history.replaceState(null, '', siteBase());
  if (!session) { LS.del('pendingPublish'); return renderMine('', 'That sign-in link has expired or was already used. Send yourself a new one.'); }
  LS.set('signedIn', true);
  const p = LS.get('pendingPublish'); LS.del('pendingPublish');
  if (p && p.cfg) { LS.set('draft', p.cfg); LS.set('draftHosted', p.hosted || null); history.replaceState(null, '', siteBase() + '#new'); renderBuilder(p.cfg, null, p.hosted || null, LS.get('draftId') || undefined); publish({ host: true }); return; }
  const back = LS.get('afterSignIn'); LS.del('afterSignIn');
  if (back && back !== '#mine' && /^#(mine|new|setup|page=[\w-]+$)/.test(back)) { history.replaceState(null, '', siteBase() + back); return route(); }
  if (back && /^\?e=[a-z0-9-]+(#t=[a-z]+)?$/.test(back)) { history.replaceState(null, '', siteBase() + back); return route(); } // a guest signed in on a hosted page
  history.replaceState(null, '', siteBase() + '#mine'); renderMine('');
}

// ---------- organizer: publish to a short link ----------
async function publishHosted(cfg, hosted) {
  const c = await sb(); const config = normalize(clone(cfg));
  if (config.venue) { // guests then skip the slow public Overpass servers
    const v = config.venue; const cached = LS.get('c4:' + osmKey(v.lat, v.lon)); const snap = window.OSM_SNAPSHOTS && window.OSM_SNAPSHOTS[osmKey(v.lat, v.lon)];
    const osm = snap || (cached && cached.d) || await Promise.race([osmNearby(v.lat, v.lon).catch(() => null), sleep(15000).then(() => null)]);
    if (osm) config.osm = { ...osm, snapshot: osm.snapshot || todayYMD() };
  }
  if (hosted && hosted.id) {
    const { data, error } = await c.from('events').update({ config, published: true }).eq('id', hosted.id).select('id,slug');
    if (!error && data && data.length) return data[0];
  }
  for (let i = 0; i < 4; i++) {
    const { data, error } = await c.from('events').insert({ slug: makeSlug(cfg.title), config }).select('id,slug').single();
    if (!error) return data;
    if (error.code !== '23505') throw error;
  }
  throw new Error('Could not pick a free link. Try again.');
}
function pubHostHTML() {
  const P = B.pub || {};
  if (!SB) return '';
  if (P.state === 'busy') return `<div class="pub-host"><p><b>Publishing your short link…</b></p></div>`;
  if (P.state === 'done') return `<div class="pub-host ok"><p><b>Short link is live.</b> Tap Share again to update it. <a href="#mine">Replies in My pages</a></p></div>`;
  if (P.state === 'signin') return `<div class="pub-host"><p><b>Sign in to get a short link.</b> Your page is saved.</p>${signInFormHTML(P.msg, LS.get('signinEmail') || '')}</div>`;
  return `<div class="pub-host"><p><b>Short link with RSVP</b> <span class="mono">${esc(location.host + location.pathname.replace(/[^/]*$/, ''))}?e=${esc(makeSlug(B.cfg.title).replace(/-[a-z0-9]{5}$/, ''))}</span></p>${P.msg ? `<p class="hint">${esc(P.msg)}</p>` : ''}<button type="button" class="btn" data-ph="go">Get a short link</button></div>`;
}
function renderPubHost() { const box = $('#pub-host'); if (box) box.innerHTML = pubHostHTML(); }
async function hostNow() {
  B.pub = { state: 'busy' }; renderPubHost();
  let user = null;
  try { user = await sbUser(); } catch (e) { B.pub = { state: 'offer', msg: e.message }; renderPubHost(); return; }
  if (!user) { B.pub = { state: 'signin' }; renderPubHost(); setTimeout(() => $('#si-email')?.focus(), 0); return; }
  try {
    const row = await publishHosted(B.cfg, B.hosted);
    B.hosted = { id: row.id, slug: row.slug }; LS.set('draftHosted', B.hosted); LS.set('signedIn', true); pageSave(B.pid, { cfg: B.cfg, hosted: B.hosted });
    const url = shortURL(row.slug); $('#pub-url').value = url; $('#pub-url').rows = 2; $('#pub-open').href = url;
    $('#pub h2').textContent = 'Your short link is ready';
    LS.set('published:' + Date.now(), { title: B.cfg.title, url });
    B.pub = { state: 'done' }; renderPubHost(); renderHostNote(); markLive();
  } catch (e) { B.pub = { state: 'offer', msg: 'Couldn’t publish: ' + (e.message || 'try again') }; renderPubHost(); }
}
function wirePubHost() {
  const dlg = $('#pub'); if (!dlg || dlg._host) return; dlg._host = true;
  dlg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ph],[data-si],[data-si-oauth]'); if (!b) return;
    if (b.dataset.siOauth) oauthSignIn(b.dataset.siOauth, () => LS.set('pendingPublish', { cfg: B.cfg, hosted: B.hosted }));
    if (b.dataset.ph === 'go') hostNow();
    if (b.dataset.si === 'send') signInSubmit(dlg, () => LS.set('pendingPublish', { cfg: B.cfg, hosted: B.hosted }));
    if (b.dataset.si === 'retry') { B.pub = { state: 'signin' }; renderPubHost(); }
  });
  dlg.addEventListener('keydown', (e) => { if (e.target.id === 'si-email' && e.key === 'Enter') { e.preventDefault(); signInSubmit(dlg, () => LS.set('pendingPublish', { cfg: B.cfg, hosted: B.hosted })); } });
}
function renderHostNote() {
  const f = $('.b-form'); if (!f) return; let n = $('.b-host', f);
  if (!B.hosted) { if (n) n.remove(); return; }
  const html = `<p class="b-note b-host">Editing your page at <a href="${esc(shortURL(B.hosted.slug))}" target="_blank" rel="noopener noreferrer">?e=${esc(B.hosted.slug)}</a>. Tap Share to update it. <a href="#mine">My pages</a></p>`;
  if (n) n.outerHTML = html; else f.insertAdjacentHTML('afterbegin', html);
}

// ---------- organizer: My pages, replies, updates ----------
async function renderMine(id, notice) {
  LANG = 'en'; document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr'; document.title = 'My pages · 1LinkTrip';
  const shell = (inner) => { $('#app').innerHTML = `<main class="mine"><header class="land-top"><a class="brand" href="#">${BRAND}</a><nav class="mine-nav"><a href="#mine">My pages</a><a class="btn sm primary" href="#setup">New page</a></nav></header><div class="mine-in">${notice ? `<p class="b-note">${esc(notice)}</p>` : ''}${inner}</div></main>`; };
  if (!SB) return shell('<h1>Hosting isn’t set up</h1>');
  shell('<p class="muted">Loading…</p>');
  let user = null;
  try { user = await sbUser(); } catch (e) { return shell(`<h1>My pages</h1><p>${esc(e.message)}</p>`); }
  if (!user) {
    LS.del('signedIn');
    shell(`<h1>My pages</h1><p class="lede">Sign in to see your short links, RSVPs and updates.</p>${signInFormHTML('', LS.get('signinEmail') || '')}`);
    const m = $('.mine'); m.addEventListener('click', (e) => { const b = e.target.closest('[data-si],[data-si-oauth]'); if (!b) return; if (b.dataset.siOauth) { oauthSignIn(b.dataset.siOauth); return; } if (b.dataset.si === 'send') signInSubmit(m); if (b.dataset.si === 'retry') renderMine(id); });
    m.addEventListener('keydown', (e) => { if (e.target.id === 'si-email' && e.key === 'Enter') { e.preventDefault(); signInSubmit(m); } });
    return;
  }
  LS.set('signedIn', true);
  const c = await sb();
  if (id) return renderMineEvent(id, shell, c, user);
  const { data, error } = await c.from('events').select('id,slug,config,published,updated_at').eq('owner', user.id).order('updated_at', { ascending: false });
  if (error) return shell(`<h1>My pages</h1><p>Couldn’t load your pages. ${esc(error.message)}</p>`);
  shell(`<div class="mine-h"><h1>My pages</h1><span class="muted small">${esc(user.email || '')} · <button type="button" class="link" data-mine="signout">Sign out</button></span></div>
    ${data.length ? `<ul class="mine-list">${data.map(r => { const cfg = normalize(r.config); return `<li><div><b>${esc(cfg.title || 'Untitled')}</b><span>${esc(cfg.start ? dateRange(cfg.start, cfg.end) : '')}${r.published ? '' : ' · hidden'}</span><a class="mono small" href="${esc(shortURL(r.slug))}" target="_blank" rel="noopener noreferrer">?e=${esc(r.slug)}</a></div><div class="btns"><a class="btn sm" href="#mine/${esc(r.id)}">Replies and updates</a><button type="button" class="btn sm" data-mine-edit="${esc(r.id)}">Edit</button><button type="button" class="btn sm ghost" data-mine-copy="${esc(r.slug)}">Copy link</button></div></li>`; }).join('')}</ul>` : `<p class="lede">No short links yet. Make a page, tap Share, then Get a short link.</p><a class="btn primary" href="#setup">Make a page</a>`}`);
  if (data.length) msgReady().then(async ok => { // "2 new" next to pages with unanswered guest messages
    if (!ok) return; const { data: ms } = await c.from('event_messages').select('event_id,guest,from_host,created_at').in('event_id', data.map(x => x.id)).order('created_at', { ascending: true }).limit(5000);
    data.forEach(ev => { const seen = LS.get('inboxSeen:' + ev.id, {}) || {}; const last = new Map(); (ms || []).filter(x => x.event_id === ev.id).forEach(x => last.set(x.guest, x));
      const n = [...last.values()].filter(x => !x.from_host && x.created_at > (seen[x.guest] || '')).length;
      const a = n && $(`.mine-list a[href="#mine/${CSS.escape(ev.id)}"]`); if (a) a.insertAdjacentHTML('beforeend', ` <span class="badge">${esc(t('{n} new', { n }))}</span>`); });
  }).catch(() => {});
  $('.mine').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mine === 'signout') { await c.auth.signOut(); LS.del('signedIn'); LS.del('draftHosted'); location.hash = '#'; }
    if (b.dataset.mineCopy) copy(shortURL(b.dataset.mineCopy));
    if (b.dataset.mineEdit) { const r = data.find(x => x.id === b.dataset.mineEdit); const cfg = normalize(r.config); const ex = pagesAll().find(x => x.hosted && x.hosted.id === r.id); LS.set('draft', cfg); LS.set('draftHosted', { id: r.id, slug: r.slug }); LS.set('draftId', ex ? ex.pid : newPid()); location.hash = '#new'; }
  });
}
let mineOpenThr = [];
const guestListKey = (id) => 'guests:' + id;
function parseGuestList(text) {
  const rows = String(text || '').split(/\r?\n/).map(l => l.split(/[,;\t]/).map(x => x.replace(/^"|"$/g, '').trim())).filter(r => r.some(Boolean));
  if (!rows.length) return [];
  const head = rows[0].map(h => h.toLowerCase()); const ni = head.findIndex(h => /name/.test(h)), ei = head.findIndex(h => /e-?mail/.test(h));
  const body = ni >= 0 || ei >= 0 ? rows.slice(1) : rows;
  return body.map(r => { const email = (ei >= 0 ? r[ei] : r.find(x => /@/.test(x))) || ''; const name = ni >= 0 ? r[ni] : (r.find(x => x && !/@/.test(x)) || ''); return { name: name.slice(0, 120), email: email.toLowerCase().slice(0, 254) }; }).filter(g => g.name || g.email);
}
const normName = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function notReplied(guests, rsvps) {
  const names = new Set(rsvps.map(r => normName(r.name))), emails = new Set(rsvps.map(r => (r.email || '').toLowerCase()).filter(Boolean));
  return guests.filter(g => !(g.email && emails.has(g.email)) && !(g.name && names.has(normName(g.name))));
}
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n;]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s; };
async function renderMineEvent(id, shell, c, user) {
  const ev = await c.from('events').select('id,slug,config,published').eq('id', id).maybeSingle();
  if (ev.error || !ev.data) return shell(`<h1>Page not found</h1><p><a href="#mine">Back to My pages</a></p>`);
  const r = ev.data; const cfg = normalize(r.config);
  const ready = await msgReady(); // messages and groups (schema-3): sections stay out until it is installed
  const [rs, an, ms, grp] = await Promise.all([c.from('rsvps').select('id,name,email,attending,guests,note,created_at' + (ready ? ',group_id' : '')).eq('event_id', id).order('created_at', { ascending: true }),
    c.from('announcements').select('id,body,created_at' + (ready ? ',group_ids' : '')).eq('event_id', id).order('created_at', { ascending: false }),
    ready ? c.from('event_messages').select('id,guest,from_host,guest_name,guest_email,body,created_at').eq('event_id', id).order('created_at', { ascending: true }).limit(2000) : null,
    ready ? loadGroups(c, id).catch(() => null) : null]);
  const msgs = ms && !ms.error ? ms.data || [] : null; const groups = grp || []; const gName = (gid) => (groups.find(g => g.id === gid) || {}).name || '';
  const seenKey = 'inboxSeen:' + id; const seen = LS.get(seenKey, {}) || {};
  // one row per guest: a later reply from the same name or email replaces the earlier one
  const latest = new Map(); (rs.data || []).forEach(x => latest.set((x.email || '').toLowerCase() || normName(x.name), x));
  const replies = [...latest.values()].reverse(); const yes = replies.filter(x => x.attending); const no = replies.filter(x => !x.attending);
  const guests = LS.get(guestListKey(id), []) || []; const waiting = notReplied(guests, replies);
  shell(`<p><a href="#mine">← My pages</a></p><div class="mine-h"><h1>${esc(cfg.title || 'Untitled')}</h1><a class="mono small" href="${esc(shortURL(r.slug))}" target="_blank" rel="noopener noreferrer">?e=${esc(r.slug)}</a></div>
    ${msgs ? `<section class="mine-sec" id="mine-msgs"><h2>${t('Messages')}</h2><label class="tool gm-on"><input type="checkbox" data-gm-on ${cfg.guestMessages ? 'checked' : ''}><span class="sw" aria-hidden="true"></span>${t('Let guests message you')}</label>${inboxHTML(msgs, seen)}</section>` : ''}
    <section class="mine-sec"><h2>Updates</h2><p class="muted small">Guests see these at the top of your page.</p>
      <form class="ann-form" onsubmit="return false"><textarea id="an-body" rows="3" maxlength="2000" placeholder="Shuttle leaves the hotel at 4:30. Bring a jacket."></textarea>${msgs ? sendToHTML(groups) : ''}<div class="btns"><button type="button" class="btn primary" data-an="post">Post update</button></div><p class="hint" role="status" aria-live="polite"></p></form>
      <ul class="ann-list own">${(an.data || []).map(a => `<li><time>${esc(fmtStamp(a.created_at))}${(a.group_ids || []).length ? ' · ' + esc(t('Send to')) + ': ' + esc(a.group_ids.map(gName).filter(Boolean).join(', ')) : ''}</time><p>${esc(a.body)}</p><button type="button" class="link" data-an-del="${esc(a.id)}">Delete</button></li>`).join('')}</ul></section>
    <section class="mine-sec"><h2>Replies</h2>
      <p class="rs-sum"><b>${yes.reduce((n, x) => n + (x.guests || 1), 0)}</b> coming <span class="muted">(${yes.length} ${yes.length === 1 ? 'reply' : 'replies'})</span> · <b>${no.length}</b> can’t make it${guests.length ? ` · <b>${waiting.length}</b> of ${guests.length} on your list haven’t replied` : ''}</p>
      ${replies.length ? `<div class="tbl-wrap"><table class="rs-tbl"><thead><tr><th>Name</th><th>Reply</th><th>Party</th>${groups.length ? `<th>${t('Group')}</th>` : ''}<th>Email</th><th>Note</th></tr></thead><tbody>${replies.map(x => `<tr><td>${esc(x.name)}</td><td>${x.attending ? 'Coming' : 'Can’t make it'}</td><td>${x.attending ? esc(x.guests) : '–'}</td>${groups.length ? `<td>${esc(gName(x.group_id))}</td>` : ''}<td>${esc(x.email || '')}</td><td data-note-id="${esc(x.id)}">${esc(x.note || '')}</td></tr>`).join('')}</tbody></table></div><div class="btns"><button type="button" class="btn sm" data-rs="csv">Download CSV</button></div>` : '<p class="muted">No replies yet. Share your short link and they’ll show up here.</p>'}
      <h3 class="sub-h">Guest list</h3><p class="muted small">Import a CSV or paste names (one per line, optional email) to see who hasn’t replied. Your list stays on this device.</p>
      <div class="btns"><label class="btn sm file-btn">Import CSV<input type="file" data-gl-file accept=".csv,.txt,text/csv,text/plain"></label>${guests.length ? '<button type="button" class="btn sm ghost" data-gl="clear">Clear list</button>' : ''}</div>
      <textarea id="gl-paste" rows="3" placeholder="Ana Ruiz, ana@example.com&#10;Ben Okafor"></textarea><div class="btns"><button type="button" class="btn sm" data-gl="add">Add to list</button></div>
      ${guests.length ? `<h3 class="sub-h">Haven’t replied (${waiting.length})</h3>${waiting.length ? `<ul class="gl-list">${waiting.map(g => `<li>${esc(g.name || g.email)}${g.name && g.email ? ` <span class="muted small">${esc(g.email)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Everyone on your list has replied.</p>'}` : ''}
    </section>
    ${msgs ? `<section class="mine-sec" id="mine-groups"><h2>${t('Groups')}</h2><div data-grp-root>${groupsEdHTML(groups)}</div></section>` : ''}
    <section class="mine-sec"><h2>Page</h2><div class="btns"><button type="button" class="btn sm" data-pg="edit">Edit page</button><button type="button" class="btn sm ghost" data-pg="vis">${r.published ? 'Hide page' : 'Show page again'}</button></div><p class="muted small">${r.published ? 'Anyone with the link can see it.' : 'Hidden: guests see “This page isn’t available”.'}</p></section>`);
  const m = $('.mine'); const again = () => { mineOpenThr = [...$$('details.thr[open]', m)].map(d => d.dataset.thr); return renderMine(id); };
  if (msgs) {
    $$('details.thr', m).forEach(d => { if (mineOpenThr.includes(d.dataset.thr)) d.open = true; d.addEventListener('toggle', () => { if (!d.open) return; const xs = msgs.filter(x => x.guest === d.dataset.thr); const last = xs[xs.length - 1]; if (last) { seen[d.dataset.thr] = last.created_at; LS.set(seenKey, seen); d.querySelector('.dot')?.remove(); } }); });
    mineOpenThr = [];
    const gr = m.querySelector('[data-grp-root]'); if (gr) wireGroupsEd(gr, c, id, again);
    wireSendTo(m);
    m.addEventListener('change', async (e) => { if (e.target.dataset.gmOn == null) return; const on = e.target.checked; const { error } = await c.from('events').update({ config: { ...r.config, guestMessages: on } }).eq('id', id); if (error) { e.target.checked = !on; toast(error.message); } else { r.config.guestMessages = on; toast(on ? t('Guests can message you') : t('Messages off')); } });
    m.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-gm-send^="h-"]'); if (!b) return; const guest = b.dataset.gmSend.slice(2);
      const box = b.closest('details'); const ta = box.querySelector('textarea'); const hint = box.querySelector('[data-gm-msg]'); const body = (ta.value || '').trim().slice(0, 2000); if (!body) { ta.focus(); return; }
      b.disabled = true; hint.textContent = t('Sending…');
      const { data, error } = await c.from('event_messages').insert({ event_id: id, guest, from_host: true, body }).select('id').single();
      if (error) { b.disabled = false; hint.textContent = t('Couldn’t send. Try again.'); return; }
      notifyEmail('message', data.id); again();
    });
    // new messages show up while the page is open (every 30 s), unless the host is typing
    const n0 = msgs.length; const iv = setInterval(async () => {
      if (!document.body.contains(m)) return clearInterval(iv); if (document.hidden || $$('textarea', m).some(x => x.value.trim())) return;
      const { count } = await c.from('event_messages').select('id', { count: 'exact', head: true }).eq('event_id', id); if (count != null && count !== n0) { clearInterval(iv); again(); }
    }, 30000);
  }
  const notes = Object.fromEntries(replies.filter(x => x.note && x.note.trim().length > 1).map(x => [x.id, x.note]));
  if (Object.keys(notes).length && canTranslate()) translateForHost(notes).then(tr => { for (const [k, v] of Object.entries(tr)) { const td = m.querySelector(`[data-note-id="${CSS.escape(k)}"]`); if (td && v && v.trim() !== notes[k].trim()) td.insertAdjacentHTML('beforeend', `<div class="tr-note">↳ ${esc(v)}</div>`); } }).catch(() => {});
  const addGuests = (list) => { if (!list.length) { toast('No names found'); return; } const cur = LS.get(guestListKey(id), []) || []; const seen = new Set(cur.map(g => g.email || normName(g.name))); list.forEach(g => { const k = g.email || normName(g.name); if (!seen.has(k)) { seen.add(k); cur.push(g); } }); LS.set(guestListKey(id), cur); toast(`${cur.length} on your guest list`); again(); };
  m.addEventListener('change', (e) => { const i = e.target; if (i.dataset.glFile != null && i.files && i.files[0]) i.files[0].text().then(tx => addGuests(parseGuestList(tx))); });
  m.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
    if (d.an === 'post') {
      const body = $('#an-body').value.trim().slice(0, 2000); const hint = $('.ann-form .hint'); if (!body) { hint.textContent = 'Write something first.'; return; }
      const gids = msgs ? sendToIds(m) : []; // updates for chosen groups are never copied into the public page config (no stored translations)
      b.disabled = true; const { data: an0, error } = await c.from('announcements').insert({ event_id: id, body, ...(gids.length ? { group_ids: gids } : {}) }).select('id').single(); if (error) { b.disabled = false; hint.textContent = 'Couldn’t post: ' + error.message; return; }
      if (msgs && an0) notifyEmail('announcement', an0.id);
      const langs = (cfg.langs || []).filter(l => l !== srcLang(cfg));
      if (langs.length && canTranslate() && an0 && !gids.length) { hint.textContent = 'Translating for your guests…'; const raw = clone(r.config); raw.tr = raw.tr || {};
        for (const l of langs) { try { const j = await aiImport({ mode: 'translate', fields: { ['ann.' + an0.id]: body }, target: l, source: srcLang(cfg) }); const x = ((j.data && j.data.translations) || [])[0]; if (x) { raw.tr[l] = raw.tr[l] || {}; raw.tr[l]['ann.' + an0.id] = { h: hashStr(body), t: x.text }; } } catch { /* post stays in the original language */ } }
        await c.from('events').update({ config: raw }).eq('id', id); }
      again();
    }
    if (d.anDel && confirm('Delete this update?')) { await c.from('announcements').delete().eq('id', d.anDel); again(); }
    if (d.rs === 'csv') {
      const lines = [['Name', 'Reply', 'Party', 'Email', 'Note', 'Sent']].concat(replies.map(x => [x.name, x.attending ? 'Coming' : 'Can’t make it', x.attending ? x.guests : 0, x.email || '', x.note || '', x.created_at]));
      const blob = new Blob(['﻿' + lines.map(l => l.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (cfg.title || 'event').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() + '-replies.csv'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    if (d.gl === 'add') addGuests(parseGuestList($('#gl-paste').value));
    if (d.gl === 'clear' && confirm('Clear your guest list on this device?')) { LS.del(guestListKey(id)); again(); }
    if (d.pg === 'edit') { const ex = pagesAll().find(x => x.hosted && x.hosted.id === r.id); LS.set('draft', cfg); LS.set('draftHosted', { id: r.id, slug: r.slug }); LS.set('draftId', ex ? ex.pid : newPid()); location.hash = '#new'; }
    if (d.pg === 'vis') { await c.from('events').update({ published: !r.published }).eq('id', id); again(); }
  });
}

// ================= phase D: in-app Nearby places with filters (OpenStreetMap data) =================
// Guests browse and filter here; they only leave the app to get directions, reserve, call, or visit the place's own site.
const PLACE_CATS = [['restaurant', 'Restaurants'], ['cafe', 'Cafés'], ['bar', 'Bars'], ['fast_food', 'Quick bites'], ['pharmacy', 'Pharmacies'], ['grocery', 'Groceries']];
const PLACE_ONE = { restaurant: 'Restaurant', cafe: 'Café', bar: 'Bar', fast_food: 'Quick bite', pharmacy: 'Pharmacy', grocery: 'Grocery', hotel: 'Hotel', sight: 'Sight' };
const DIETS = [['gluten_free', 'Gluten-free'], ['vegan', 'Vegan'], ['vegetarian', 'Vegetarian'], ['halal', 'Halal'], ['kosher', 'Kosher']];
const DISTS = [[0, 'Any distance'], [400, '5 min walk'], [800, '10 min walk'], [1200, '15 min walk']];
const isEatery = (k) => /^(restaurant|cafe|bar|fast_food)$/.test(k);
// OSM diet:* = yes | only | limited | no
const hasDiet = (p, k) => /^(yes|only|limited)$/.test((p.diet || {})[k] || '');

// ---- opening_hours: the common subset (day ranges, several time ranges, overnight, off, 24/7). Anything else → unknown ----
const OH_DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
function ohOpenAt(spec, wall) {
  spec = String(spec || '').trim(); if (!spec) return null;
  if (/^24\/7$/.test(spec)) return true;
  const day = (wall.getUTCDay() + 6) % 7, prev = (day + 6) % 7, mins = wall.getUTCHours() * 60 + wall.getUTCMinutes();
  let result = false;
  for (let rule of spec.split(/\s*;\s*/)) {
    rule = rule.trim(); if (!rule) continue;
    if (/^(PH|SH)\b/.test(rule)) continue; // holidays: ignore
    if (/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|week|easter|sunrise|sunset|dawn|dusk)\b|\[|"/.test(rule)) return null;
    const m = rule.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)?\s*(.*)$/);
    if (!m) return null;
    const days = new Set();
    if (!m[1]) for (let i = 0; i < 7; i++) days.add(i);
    else for (const seg of m[1].split(',')) { const [a, b] = seg.split('-'); const ia = OH_DAYS.indexOf(a), ib = b ? OH_DAYS.indexOf(b) : ia; for (let i = ia, n = 0; n < 8; i = (i + 1) % 7, n++) { days.add(i); if (i === ib) break; } }
    const times = m[2].trim().replace(/^:\s*/, '');
    if (/^(off|closed)$/i.test(times)) { if (days.has(day)) result = false; continue; }
    const ranges = times.split(/\s*,\s*/).map(r => r.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\+?$/));
    if (!ranges.length || ranges.some(r => !r)) return null;
    let touched = false, open = false;
    for (const r of ranges) {
      const s = +r[1] * 60 + +r[2]; let e = +r[3] * 60 + +r[4]; if (e === 0) e = 1440;
      if (days.has(day)) { touched = true; if (e > s ? (mins >= s && mins < e) : mins >= s) open = true; }
      if (days.has(prev) && e <= s && mins < e) { touched = true; open = true; } // past midnight from yesterday
    }
    if (touched) result = open;
  }
  return result;
}
const venueNow = (cfg) => asUTC(utcToWall(new Date(), cfg.tz || 'UTC'));
const prettyHours = (spec) => String(spec || '').split(/\s*;\s*/).filter(Boolean).map(r => r.replace(/\bMo\b/g, 'Mon').replace(/\bTu\b/g, 'Tue').replace(/\bWe\b/g, 'Wed').replace(/\bTh\b/g, 'Thu').replace(/\bFr\b/g, 'Fri').replace(/\bSa\b/g, 'Sat').replace(/\bSu\b/g, 'Sun').replace(/,(?=[A-Z])/g, ', ').replace(/\boff\b/g, 'closed').replace(/(\d{1,2}):(\d{2})/g, (_, h, mm) => fmtTime(`${pad(+h % 24)}:${mm}`)));

// all browsable places from the classified OSM data
const placesMemo = new WeakMap(); // one set of place objects per data set, so Google matches stick to them
function allPlaces(data) {
  if (placesMemo.has(data)) return placesMemo.get(data);
  const r = placesOf(data); placesMemo.set(data, r); return r;
}
function placesOf(data) {
  const food = (data.food || []).map(p => ({ ...p, cat: p.kind === 'bar' || p.kind === 'pub' ? 'bar' : p.kind }));
  return food.concat((data.places || []).map(p => ({ ...p, cat: p.kind })));
}
const osmPlanPlace = (p) => ({ src: 'osm', ref: placeKey(p), name: p.name, lat: p.lat, lon: p.lon, rating: p.g ? p.g.rating : 0, count: p.g ? p.g.count : 0, addr: [p.street, p.city].filter(Boolean).join(', '), hours: p.hours || '', type: placeType([], p.cat) });
const placeKey = (p) => `${p.name}|${(+p.lat).toFixed(5)},${(+p.lon).toFixed(5)}`;
const cuisineList = (p) => (p.cuisines || String(p.cuisine || '').split(',')).map(x => String(x).trim().toLowerCase()).filter(Boolean);
const cuisineLabel = (c) => c.replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());

function placeFilters(cfg, art) { return art._pf || (art._pf = { cat: 'restaurant', cuisine: '', diet: [], open: false, dist: 0, price: '', stars: 0 }); }
const placePrice = (p) => p.price || (p.g && p.g.price) || '';
function filterPlaces(cfg, places, f) {
  const now = f.open ? venueNow(cfg) : null;
  return places.filter(p => (!f.cat || f.cat === 'all' || p.cat === f.cat)
    && (!f.cuisine || cuisineList(p).includes(f.cuisine))
    && f.diet.every(k => hasDiet(p, k))
    && (!f.dist || p.d <= f.dist)
    && (!f.price || placePrice(p) === f.price)
    && (!f.stars || (p.g && p.g.rating >= f.stars))
    && (!now || ohOpenAt(p.hours, now) === true));
}
function placesHTML(cfg, data, art) {
  const v = cfg.venue; const f = placeFilters(cfg, art); const all = allPlaces(data);
  if (!all.length) return `<p class="muted">${t('No restaurants, cafés or bars are mapped within 900 m of the venue.')}</p>${ext(L.place('restaurants', placeLabel(v)), t('Search on Google Maps'), 'btn')}`;
  const counts = {}; all.forEach(p => counts[p.cat] = (counts[p.cat] || 0) + 1);
  if (f.cat !== 'all' && !counts[f.cat]) f.cat = PLACE_CATS.find(([k]) => counts[k])?.[0] || 'all';
  const inCat = all.filter(p => f.cat === 'all' || p.cat === f.cat);
  const cuis = {}; inCat.forEach(p => cuisineList(p).forEach(c => { cuis[c] = (cuis[c] || 0) + 1; }));
  const cuisTop = Object.entries(cuis).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30);
  if (f.cuisine && !cuis[f.cuisine]) f.cuisine = '';
  const prices = [...new Set(inCat.map(placePrice).filter(Boolean))].sort((a, b) => a.length - b.length);
  const rated = inCat.some(p => p.g && p.g.rating);
  const eat = isEatery(f.cat) || f.cat === 'all';
  const dietCount = (k) => inCat.filter(p => hasDiet(p, k)).length;
  const list = filterPlaces(cfg, all, f); const now = venueNow(cfg);
  const active = (f.cuisine ? 1 : 0) + f.diet.length + (f.open ? 1 : 0) + (f.dist ? 1 : 0) + (f.price ? 1 : 0) + (f.stars ? 1 : 0);
  return `<div class="pf" role="group" aria-label="${t('Filters')}">
    <div class="chips pf-cats">${PLACE_CATS.filter(([k]) => counts[k]).map(([k, l]) => `<button type="button" class="chip ${f.cat === k ? 'on' : ''}" data-pf-cat="${k}" aria-pressed="${f.cat === k}">${t(l)} <span>${counts[k]}</span></button>`).join('')}</div>
    <div class="pf-row">
      ${eat && cuisTop.length ? `<label class="pf-sel"><span class="sr">${t('Cuisine')}</span><select data-pf="cuisine"><option value="">${t('Any cuisine')}</option>${cuisTop.map(([c, n]) => `<option value="${esc(c)}" ${f.cuisine === c ? 'selected' : ''}>${esc(cuisineLabel(c))} (${n})</option>`).join('')}</select></label>` : ''}
      <label class="pf-sel"><span class="sr">${t('Distance')}</span><select data-pf="dist">${DISTS.map(([m, l]) => `<option value="${m}" ${+f.dist === m ? 'selected' : ''}>${t(l)}</option>`).join('')}</select></label>
      <button type="button" class="chip ${f.open ? 'on' : ''}" data-pf-open aria-pressed="${f.open}">${t('Open now')}</button>
      ${rated ? [4, 4.5].map(n => `<button type="button" class="chip ${f.stars === n ? 'on' : ''}" data-pf-stars="${n}" aria-pressed="${f.stars === n}">★ ${n.toFixed(1)}+</button>`).join('') : ''}
    </div>
    ${eat ? `<div class="chips pf-diet">${DIETS.map(([k, l]) => { const n = dietCount(k); const on = f.diet.includes(k); return n || on ? `<button type="button" class="chip ${on ? 'on' : ''}" data-pf-diet="${k}" aria-pressed="${on}">${t(l)} <span>${n}</span></button>` : ''; }).join('')}</div>` : ''}
    ${prices.length > 1 ? `<div class="chips pf-price">${prices.map(pr => `<button type="button" class="chip ${f.price === pr ? 'on' : ''}" data-pf-price="${esc(pr)}" aria-pressed="${f.price === pr}">${esc(pr)}</button>`).join('')}</div>` : ''}
  </div>
  <p class="pf-count muted small" role="status" aria-live="polite">${esc(list.length === 1 ? t('1 place') : t('{n} places', { n: list.length }))}${active ? ` · <button type="button" class="link" data-pf-clear>${t('Clear filters')}</button>` : ''}</p>
  ${list.length ? `<ul class="plist rich places">${list.slice(0, art._pfMore ? 80 : 12).map(p => { const o = ohOpenAt(p.hours, now); const dl = DIETS.filter(([k]) => hasDiet(p, k)).map(([, l]) => t(l));
    return `<li><button type="button" class="place-row" data-place="${esc(placeKey(p))}"><div><b>${esc(p.name)}</b>${p.g && p.g.rating ? `<span class="rt">${gRatingHTML(p.g)}</span>` : ''}<span>${esc([t(PLACE_ONE[p.cat] || ''), cuisineList(p).slice(0, 2).map(cuisineLabel).join(', '), placePrice(p)].filter(Boolean).join(' · '))}</span>${dl.length || o != null ? `<span class="tags">${o === true ? `<em class="open">${t('Open now')}</em>` : o === false ? `<em class="closed">${t('Closed now')}</em>` : ''}${dl.map(x => `<em>${esc(x)}</em>`).join('')}</span>` : ''}</div><span class="dist">${esc(fmtDist(p.d, v.cc))}<small>${walkTxt(p.d)}</small></span></button></li>`; }).join('')}
    ${list.length > 12 && !art._pfMore ? `<li class="more-li"><button type="button" class="btn sm" data-pf-more>${t('Show {n} more', { n: Math.min(80, list.length) - 12 })}</button></li>` : ''}</ul>`
    : `<p class="muted">${t('Nothing matches these filters.')} <button type="button" class="link" data-pf-clear>${t('Clear filters')}</button></p>`}
  ${rated ? `<p class="muted small g-attr">${t('Ratings from Google')}</p>` : ''}`;
}
function placeCardHTML(cfg, p) {
  const v = cfg.venue; const now = venueNow(cfg); const o = ohOpenAt(p.hours, now); const tr = tripDates(cfg);
  const dl = DIETS.filter(([k]) => hasDiet(p, k)).map(([k, l]) => `<em>${esc(t(l))}${p.diet[k] === 'only' ? ' ' + esc(t('only')) : p.diet[k] === 'limited' ? ' ' + esc(t('(some dishes)')) : ''}</em>`);
  const facts = [p.outdoor === 'yes' ? t('Outdoor seating') : '', p.takeaway === 'yes' || p.takeaway === 'only' ? t('Takeaway') : '', p.wheelchair === 'yes' ? t('Wheelchair accessible') : p.wheelchair === 'limited' ? t('Partly wheelchair accessible') : ''].filter(Boolean);
  const addr = [p.street, p.city || v.city].filter(Boolean).join(', ');
  const dirURL = `https://www.google.com/maps/dir/?api=1&origin=${v.lat},${v.lon}&destination=${p.lat},${p.lon}&travelmode=walking`;
  return `<div class="pc"><button type="button" class="x" data-pc-close aria-label="${t('Close')}">×</button>
    <p class="lbl">${esc([t(PLACE_ONE[p.cat] || p.kind || ''), cuisineList(p).map(cuisineLabel).join(', ')].filter(Boolean).join(' · '))}</p>
    <h2>${esc(p.name)}</h2>
    ${GKEY && p.cat !== 'pharmacy' && p.cat !== 'grocery' ? `<div class="pc-g" data-gslot>${p.g && p.g.rating ? `<p class="rt">${gRatingHTML(p.g)}</p>` : ''}</div>` : ''}
    <p class="pc-dist">${esc(t('{d} from the venue', { d: fmtDist(p.d, v.cc) }))} · ${walkTxt(p.d)}${placePrice(p) ? ' · ' + esc(placePrice(p)) : ''}</p>
    ${dl.length ? `<p class="tags">${dl.join('')}</p>` : ''}
    ${p.hours ? `<div class="pc-hours"><b>${o === true ? `<span class="open">${t('Open now')}</span>` : o === false ? `<span class="closed">${t('Closed now')}</span>` : t('Hours')}</b><ul>${prettyHours(p.hours).map(h => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}
    ${addr ? `<p class="pc-addr">${esc(addr)}</p>` : ''}
    ${facts.length ? `<p class="muted small">${esc(facts.join(' · '))}</p>` : ''}
    ${planAddHTML(cfg, osmPlanPlace(p))}
    <div class="btns sec-acts">${p.cat === 'hotel' ? (() => { const a = hotelBookAction(cfg, p); return ext(a.url, a.label, 'btn book'); })() : ''}${ext(dirURL, t('Directions'), 'btn')}${p.cat === 'restaurant' ? bookExt('restaurants', 'opentable', { name: p.name, venue: v, date: cfg.start.slice(0, 10), n: tr.guests || 2 }, t('Reserve') + ' · OpenTable', 'btn') : ''}${p.phone ? `<a class="btn" href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">${t('Call')}</a>` : ''}${p.website ? ext(p.website, t('Website'), 'btn') : ''}</div>
    <button type="button" class="link" data-pc-map>${t('Show on map')}</button>
  </div>`;
}
function wirePlaces(cfg, art, data, setMarkers, center) {
  const s = art.querySelector('[data-slot="food"]'); if (!s) return;
  if (s._wpOff) s._wpOff(); const ac = new AbortController(); s._wpOff = () => ac.abort(); const on = { signal: ac.signal }; // re-wired after Search this area
  const all = allPlaces(data);
  const byKey = new Map(all.concat((data.hotels || []).map(p => ({ ...p, cat: 'hotel' })), (data.sights || []).map(p => ({ ...p, cat: 'sight' }))).map(p => [placeKey(p), p]));
  const gDone = {};
  const gLoad = () => {
    const cat = placeFilters(cfg, art).cat; if (ac.signal.aborted || !GKEY || !cfg.venue || !G_TYPES[cat] || gDone[cat]) return;
    const panel = art.querySelector('[data-panel="nearby"]'); if (panel && panel.hidden) return;
    gDone[cat] = true;
    gNearby(center || cfg.venue, cat).then(gs => { gMerge(all, gs); if (document.body.contains(s) && !ac.signal.aborted) render(); }).catch(() => {});
  };
  (art._showFns = art._showFns || []).push((k) => { if (k === 'nearby') gLoad(); });
  const render = () => { if (ac.signal.aborted) return; s.innerHTML = placesHTML(cfg, data, art); if (setMarkers) setMarkers(filterPlaces(cfg, all, placeFilters(cfg, art)).slice(0, 60)); gLoad(); };
  art._openPlace = (key) => {
    const p = byKey.get(key); if (!p) return;
    let d = $('#placedlg'); if (!d) { d = document.createElement('dialog'); d.id = 'placedlg'; d.className = 'sheet place-sheet'; document.body.appendChild(d); d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); }
    d.setAttribute('style', themeStyle(cfg.theme)); d.classList.toggle('dark', cfg.theme.mode === 'dark'); d.setAttribute('lang', LANG);
    d.innerHTML = placeCardHTML(cfg, p);
    d.onclick = (e) => { if (planCardClick(cfg, art, d, e, osmPlanPlace(p))) return; if (e.target === d || e.target.closest('[data-pc-close]')) d.close(); if (e.target.closest('[data-pc-map]')) { d.close(); art._focusPlace && art._focusPlace(p); } };
    if (!d.open) d.showModal();
    const gs = d.querySelector('[data-gslot]');
    if (gs) gDetails(p).then(g => {
      if (!g || !d.open || !d.contains(gs)) return;
      gs.innerHTML = `${g.photo ? `<figure class="pc-photo"><img src="${esc(gPhotoURL(g.photo))}" alt="${esc(p.name)}" loading="lazy" onerror="this.closest('figure').remove()">${g.photoBy && g.photoBy.name ? `<figcaption>${esc(t('Photo: {n}', { n: g.photoBy.name }))}</figcaption>` : ''}</figure>` : ''}
        ${g.rating ? `<p class="rt">${gRatingHTML(g)} <small class="muted">${t('on Google')}</small></p>` : ''}
        ${!p.hours && g.hours.length ? `<div class="pc-hours"><b>${g.openNow === true ? `<span class="open">${t('Open now')}</span>` : g.openNow === false ? `<span class="closed">${t('Closed now')}</span>` : t('Hours')}</b><ul>${g.hours.map(h => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}`;
      if (g.rating && !p.g) p.g = { gid: g.gid, rating: g.rating, count: g.count, price: g.price, url: g.url };
    }).catch(() => {});
  };
  if (!art._placeClicks) { art._placeClicks = true; art.addEventListener('click', (e) => { const b = e.target.closest('[data-place]'); if (b && art._openPlace) art._openPlace(b.dataset.place); }); }
  s.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; const f = placeFilters(cfg, art); const d = b.dataset;
    if (d.place) return;
    if (d.pfCat) { f.cat = d.pfCat; f.cuisine = ''; art._pfMore = false; }
    else if (d.pfDiet) { f.diet = f.diet.includes(d.pfDiet) ? f.diet.filter(x => x !== d.pfDiet) : f.diet.concat(d.pfDiet); }
    else if (d.pfOpen != null) f.open = !f.open;
    else if (d.pfPrice) f.price = f.price === d.pfPrice ? '' : d.pfPrice;
    else if (d.pfStars) f.stars = f.stars === +d.pfStars ? 0 : +d.pfStars;
    else if (d.pfClear != null) Object.assign(f, { cuisine: '', diet: [], open: false, dist: 0, price: '', stars: 0 });
    else if (d.pfMore != null) art._pfMore = true;
    else return;
    render();
  }, on);
  s.addEventListener('change', (e) => { const i = e.target; if (!i.dataset.pf) return; const f = placeFilters(cfg, art); f[i.dataset.pf] = i.dataset.pf === 'dist' ? +i.value : i.value; render(); }, on);
  render();
}

// ================= Google ratings, photos and hours on top of the OpenStreetMap places =================
// Only when a key is configured (google-config.js; the key is locked to this site's address).
// Calls are few and cached: one Nearby Search per category when the guest first looks at it (≤20 places, ratings only),
// and one Place Details when a place card is opened (photo + hours). Nothing is fetched on filter changes.
const GKEY = window.EP_GOOGLE && window.EP_GOOGLE.key ? window.EP_GOOGLE.key : '';
// footer credits for the sources that actually supplied the page's map and places
const attribHTML = (srcs) => [srcs.has('google') && !(gpBroken && gmapsBroken) ? 'Maps and places © Google' : '', srcs.has('osm') ? 'Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>' : '',
  'Weather by <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo</a>'].filter(Boolean).join(' · ');
const G_TYPES = { restaurant: ['restaurant'], cafe: ['cafe', 'coffee_shop'], bar: ['bar', 'pub'], fast_food: ['fast_food_restaurant'] };
const G_PRICE = { PRICE_LEVEL_INEXPENSIVE: '$', PRICE_LEVEL_MODERATE: '$$', PRICE_LEVEL_EXPENSIVE: '$$$', PRICE_LEVEL_VERY_EXPENSIVE: '$$$$' };
const G_TTL = 3 * 864e5;
const gNorm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/\b(the|restaurant|ristorante|cafe|bar|nyc|new york)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
function gSameName(a, b) {
  a = gNorm(a); b = gNorm(b); if (!a || !b) return false; if (a === b || a.includes(b) || b.includes(a)) return true;
  const A = new Set(a.split(' ')), B = b.split(' '); const hit = B.filter(x => A.has(x)).length; return hit / Math.max(A.size, B.length) >= 0.5;
}
async function gFetch(url, body, mask) {
  const r = await fetchTimeout(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GKEY, 'X-Goog-FieldMask': mask }, body: body ? JSON.stringify(body) : undefined }, 12000);
  if (!r.ok) throw new Error('places ' + r.status); return r.json();
}
// ratings for one category around the venue → [{gid, name, lat, lon, rating, count, price, url}]
function gNearby(v, cat) {
  const key = `gp2:${osmKey(v.lat, v.lon)}:${cat}`; const c = LS.get(key); if (c && Date.now() - c.t < G_TTL) return Promise.resolve(c.d);
  if (memo.has(key)) return memo.get(key);
  const p = gFetch('https://places.googleapis.com/v1/places:searchNearby', { includedTypes: G_TYPES[cat], maxResultCount: 20, rankPreference: 'DISTANCE', locationRestriction: { circle: { center: { latitude: v.lat, longitude: v.lon }, radius: 1000 } } },
    'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.priceLevel,places.googleMapsUri')
    .then(j => { const d = (j.places || []).map(x => ({ gid: x.id, name: x.displayName && x.displayName.text || '', lat: x.location && x.location.latitude, lon: x.location && x.location.longitude, rating: x.rating || 0, count: x.userRatingCount || 0, price: G_PRICE[x.priceLevel] || '', url: x.googleMapsUri || '' })); LS.set(key, { t: Date.now(), d }); return d; });
  memo.set(key, p); p.catch(() => memo.delete(key)); return p;
}
// attach Google data to matching OSM places (same name nearby)
function gMerge(places, gs) {
  for (const p of places) {
    if (p.g) continue;
    const m = gs.filter(g => g.lat != null && distM(p.lat, p.lon, g.lat, g.lon) < 150 && gSameName(p.name, g.name)).sort((a, b) => distM(p.lat, p.lon, a.lat, a.lon) - distM(p.lat, p.lon, b.lat, b.lon))[0];
    if (m) p.g = m;
  }
}
// photo + hours for one place card (by Google id, or found by name next to the OSM point)
function gDetails(p) {
  const key = 'gd1:' + (p.g ? p.g.gid : placeKey(p)); const c = LS.get(key); if (c && Date.now() - c.t < G_TTL) return Promise.resolve(c.d);
  const mask = 'id,displayName,rating,userRatingCount,priceLevel,googleMapsUri,regularOpeningHours.weekdayDescriptions,currentOpeningHours.openNow,photos';
  const req = p.g ? gFetch(`https://places.googleapis.com/v1/places/${enc(p.g.gid)}`, null, mask)
    : gFetch('https://places.googleapis.com/v1/places:searchText', { textQuery: [p.name, p.street, p.city].filter(Boolean).join(', '), maxResultCount: 1, locationBias: { circle: { center: { latitude: p.lat, longitude: p.lon }, radius: 150 } } }, mask.split(',').map(f => 'places.' + f).join(','))
      .then(j => { const x = (j.places || [])[0]; return x && gSameName(p.name, x.displayName && x.displayName.text) ? x : null; });
  return req.then(x => {
    const ph = x && x.photos && x.photos[0];
    const d = x ? { gid: x.id, rating: x.rating || 0, count: x.userRatingCount || 0, price: G_PRICE[x.priceLevel] || '', url: x.googleMapsUri || '', hours: (x.regularOpeningHours && x.regularOpeningHours.weekdayDescriptions) || [],
      openNow: x.currentOpeningHours ? !!x.currentOpeningHours.openNow : null, photo: ph ? ph.name : '', photoBy: ph && ph.authorAttributions && ph.authorAttributions[0] ? { name: ph.authorAttributions[0].displayName || '', uri: ph.authorAttributions[0].uri || '' } : null } : null;
    LS.set(key, { t: Date.now(), d }); return d;
  });
}
const gPhotoURL = (name) => `https://places.googleapis.com/v1/${name}/media?maxWidthPx=800&key=${enc(GKEY)}`;
const gStars = (r) => `<span class="stars" aria-label="${esc(t('{r} out of 5 stars', { r: r.toFixed(1) }))}">★ ${r.toFixed(1)}</span>`;
const gRatingHTML = (g) => g && g.rating ? `${gStars(g.rating)}${g.count ? ` <small>(${g.count.toLocaleString(LOCALES[LANG] || 'en-US')})</small>` : ''}` : '';

// ================= maps: Google Maps when a key is set, Leaflet + OpenStreetMap otherwise or if Google fails =================
// Both sit behind one small adapter: center, fit, pin, label, group(color) → set/show, invalidateSize, remove.
let gmapsP = null, gmapsBroken = false;
const gmapsFails = new Set();
function loadGoogleMaps() {
  if (window.google && window.google.maps && window.google.maps.Map) return Promise.resolve(window.google.maps);
  if (!GKEY || gmapsBroken) return Promise.reject(new Error('no Google Maps'));
  return gmapsP || (gmapsP = new Promise((res, rej) => {
    window.__epGmaps = () => res(window.google.maps);
    // Google calls this when the key is refused (it can happen after the map is drawn): switch every map to Leaflet
    window.gm_authFailure = () => { gmapsBroken = true; gmapsFails.forEach(f => { try { f(); } catch {} }); };
    const s = document.createElement('script'); s.async = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${enc(GKEY)}&v=weekly&loading=async&callback=__epGmaps`;
    s.onerror = () => { gmapsP = null; gmapsBroken = true; rej(new Error('Google Maps did not load')); };
    document.head.appendChild(s);
    setTimeout(() => rej(new Error('Google Maps timed out')), 15000);
  }));
}
// map marks: the guest's hotel is a deep-blue pin with a white bed (same size as the other pins, top of the stack); saved spots are gold stars
const pinText = (s) => { s = String(s || ''); return s.length > 22 ? s.slice(0, 21).trim() + '…' : s; };
const HOTEL_PIN = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 48 60"><defs><filter id="s" x="-40%" y="-30%" width="180%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity=".4"/></filter></defs><path filter="url(#s)" d="M24 3C13 3 4 11.6 4 22.4 4 36.6 24 57 24 57s20-20.4 20-34.6C44 11.6 35 3 24 3z" fill="#1E3A8A" stroke="#fff" stroke-width="3.5"/><g fill="#fff"><rect x="12" y="15" width="3.2" height="17" rx="1.2"/><rect x="12" y="26" width="24" height="3.2" rx="1"/><rect x="32.8" y="22" width="3.2" height="10" rx="1.2"/><circle cx="19.6" cy="21.4" r="2.9"/><rect x="23.6" y="19" width="12.4" height="5.6" rx="2.4"/></g></svg>');
const STAR_PIN = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34"><defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-color="#000" flood-opacity=".4"/></filter></defs><path filter="url(#s)" d="M17 2.5l4.3 8.9 9.7 1.4-7 6.8 1.7 9.7-8.7-4.6-8.7 4.6 1.7-9.7-7-6.8 9.7-1.4z" fill="#E8A100" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/></svg>');
function googleAdapter(g, el, c) {
  const map = new g.Map(el, { center: { lat: c.lat, lng: c.lon }, zoom: c.zoom || 15, disableDefaultUI: true, zoomControl: true, gestureHandling: 'cooperative', clickableIcons: false, keyboardShortcuts: false });
  const info = new g.InfoWindow(); const all = []; el._gmap = map;
  const pop = (m, html) => m.addListener('click', () => { info.setContent(html); info.open({ anchor: m, map }); });
  return {
    kind: 'google', map,
    center: (lat, lon, z) => { map.setCenter({ lat, lng: lon }); if (z) map.setZoom(z); },
    fit: (pts) => { const b = new g.LatLngBounds(); pts.forEach(([la, lo]) => b.extend({ lat: la, lng: lo })); map.fitBounds(b, 60); g.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > 16) map.setZoom(16); }); },
    pin: (lat, lon, { title, html, color }) => { const m = new g.Marker({ map, position: { lat, lng: lon }, title, zIndex: 1000, label: title ? { text: pinText(title), className: 'gmap-lbl', color: '#12141B', fontSize: '11px', fontWeight: '700' } : undefined, icon: { path: 'M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z', fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 1.15, anchor: new g.Point(12, 36), labelOrigin: new g.Point(12, 46) } }); pop(m, html); all.push(m); },
    hotelPins: (() => { let ms = []; return (items) => { ms.forEach(m => m.setMap(null)); ms = items.map(x => { const m = new g.Marker({ map, position: { lat: x.lat, lng: x.lon }, title: x.title, zIndex: 5000, optimized: false, label: { text: pinText(x.label), className: 'gmap-lbl hotel', color: '#12141B', fontSize: '12px', fontWeight: '700' }, icon: { url: HOTEL_PIN, scaledSize: new g.Size(32, 40), anchor: new g.Point(16, 38), labelOrigin: new g.Point(16, 49) } }); m.addListener('click', () => x.onClick && x.onClick()); return m; }); }; })(),
    label: (lat, lon, { title, text, html }) => { const m = new g.Marker({ map, position: { lat, lng: lon }, title, zIndex: 900, label: { text, fontSize: '11px', fontWeight: '700', color: '#12141B' }, icon: { path: g.SymbolPath.CIRCLE, scale: 0 } }); pop(m, html); all.push(m); },
    group: (color) => { let ms = [], vis = true; return {
      set: (items) => { ms.forEach(m => m.setMap(null)); ms = items.map(x => { const m = new g.Marker({ map: vis ? map : null, position: { lat: x.lat, lng: x.lon }, title: x.title, icon: { path: g.SymbolPath.CIRCLE, scale: 6, fillColor: color, fillOpacity: .95, strokeColor: '#fff', strokeWeight: 1.5 } }); if (x.onClick) m.addListener('click', x.onClick); else if (x.html) pop(m, x.html); return m; }); },
      show: (on) => { vis = on; ms.forEach(m => m.setMap(on ? map : null)); }, visible: () => vis, count: () => ms.length }; },
    pins: (() => { let ms = []; return (items, color) => { ms.forEach(m => m.setMap(null)); ms = items.map(x => { const m = new g.Marker({ map, position: { lat: x.lat, lng: x.lon }, title: x.title, zIndex: x.z || 500, optimized: false, icon: color ? { path: 'M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z', fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale: 1, anchor: new g.Point(12, 36) } : undefined }); m.addListener('click', () => x.onClick && x.onClick()); return m; }); }; })(),
    savedPins: (() => { let ms = []; return (items) => { ms.forEach(m => m.setMap(null)); ms = items.map(x => { const m = new g.Marker({ map, position: { lat: x.lat, lng: x.lon }, title: x.title, zIndex: 4000, optimized: false, icon: { url: STAR_PIN, scaledSize: new g.Size(34, 34), anchor: new g.Point(17, 17) } }); m.addListener('click', () => x.onClick && x.onClick()); return m; }); }; })(),
    onPoi: (fn) => { map.setOptions({ clickableIcons: true }); map.addListener('click', (e) => { if (e.placeId) { e.stop(); fn(e.placeId); } }); },
    view: () => { const b = map.getBounds(); if (!b) return null; const c = b.getCenter(), ne = b.getNorthEast(); return { lat: c.lat(), lon: c.lng(), ne: [ne.lat(), ne.lng()] }; },
    onMoved: (fn) => map.addListener('idle', fn), zoom: () => map.getZoom(),
    invalidateSize: () => { g.event.trigger(map, 'resize'); },
    remove: () => { all.forEach(m => m.setMap(null)); el.innerHTML = ''; },
  };
}
function leafletAdapter(el, c) {
  const Lf = window.L; el.innerHTML = ''; delete el._leaflet_id;
  const map = Lf.map(el, { scrollWheelZoom: false, zoomControl: false, attributionControl: true }).setView([c.lat, c.lon], c.zoom || 15);
  Lf.control.zoom({ position: 'topright' }).addTo(map); el._leafletMap = map;
  Lf.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  return {
    kind: 'leaflet', map,
    center: (lat, lon, z) => map.setView([lat, lon], z || map.getZoom()),
    fit: (pts) => map.fitBounds(pts, { padding: [50, 50], maxZoom: 16 }),
    pin: (lat, lon, { title, html, color }) => Lf.marker([lat, lon], { icon: Lf.divIcon({ className: 'pin', html: `<span style="--accent:${color}"></span>${title ? `<em class="map-lbl">${esc(pinText(title))}</em>` : ''}`, iconSize: [30, 40], iconAnchor: [15, 38] }), title, zIndexOffset: 1000 }).addTo(map).bindPopup(html),
    hotelPins: (() => { let lg = null; return (items) => { if (!lg) lg = Lf.layerGroup().addTo(map); lg.clearLayers(); items.forEach(x => Lf.marker([x.lat, x.lon], { icon: Lf.divIcon({ className: 'hpin', html: `<img src="${HOTEL_PIN}" alt=""><em class="map-lbl hotel">${esc(pinText(x.label))}</em>`, iconSize: [32, 40], iconAnchor: [16, 38] }), title: x.title, zIndexOffset: 5000 }).on('click', () => x.onClick && x.onClick()).addTo(lg)); }; })(),
    label: (lat, lon, { title, text, html }) => Lf.marker([lat, lon], { icon: Lf.divIcon({ className: 'tpin', html: `<span>${esc(text)}</span>`, iconSize: null, iconAnchor: [0, 0] }), title, zIndexOffset: 900 }).addTo(map).bindPopup(html),
    group: (color) => { const lg = Lf.layerGroup().addTo(map); return {
      set: (items) => { lg.clearLayers(); items.forEach(x => { const m = Lf.circleMarker([x.lat, x.lon], { radius: 6, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: .95 }); if (x.onClick) m.on('click', x.onClick); else if (x.html) m.bindPopup(x.html); m.addTo(lg); }); },
      show: (on) => { on ? lg.addTo(map) : map.removeLayer(lg); }, visible: () => map.hasLayer(lg), count: () => lg.getLayers().length }; },
    pins: (() => { let lg = null; return (items, color) => { if (!lg) lg = Lf.layerGroup().addTo(map); lg.clearLayers(); items.forEach(x => Lf.circleMarker([x.lat, x.lon], { radius: 10, color: '#fff', weight: 2, fillColor: color || '#D93025', fillOpacity: 1 }).on('click', () => x.onClick && x.onClick()).bindTooltip(x.title || '').addTo(lg)); }; })(),
    savedPins: (() => { let lg = null; return (items) => { if (!lg) lg = Lf.layerGroup().addTo(map); lg.clearLayers(); items.forEach(x => Lf.marker([x.lat, x.lon], { icon: Lf.divIcon({ className: 'spin', html: `<img src="${STAR_PIN}" alt="">`, iconSize: [34, 34], iconAnchor: [17, 17] }), title: x.title, zIndexOffset: 4000 }).on('click', () => x.onClick && x.onClick()).addTo(lg)); }; })(),
    onPoi: () => {},
    view: () => { const b = map.getBounds(); const c = b.getCenter(), ne = b.getNorthEast(); return { lat: c.lat, lon: c.lng, ne: [ne.lat, ne.lng] }; },
    onMoved: (fn) => map.on('moveend', fn), zoom: () => map.getZoom(),
    invalidateSize: () => map.invalidateSize(),
    remove: () => map.remove(),
  };
}
// The venue map on the Nearby tab. Built the first time the tab is shown; nearby data can arrive before or after.
function wireMap(cfg, art, opts) {
  let el = art.querySelector('[data-slot="map"]'); const v = cfg.venue; if (!el || !v) return;
  const T = cfg.tools; const st = { data: null, food: null, groups: {}, adapter: null, building: false, gmode: false, pins: [], poi: null, saved: [], hotels: [], area: null, areaFns: [] };
  const drawPins = () => { const a = st.adapter; if (!a) return; a.pins(st.pins); if (st.poi) a.onPoi(st.poi); };
  // "Search this area": after any pan/zoom that moves the view away from the last searched area, a button offers to
  // search again inside what is on screen. Compared against the last search (not a flag set by code), so it can't get stuck.
  const wrap = el.closest('.map-wrap');
  if (wrap && !wrap.querySelector('[data-area-go]')) wrap.insertAdjacentHTML('afterbegin', `<button type="button" class="area-btn" data-area-go hidden>${esc(t('Search this area'))}</button>`);
  const areaBtn = wrap ? wrap.querySelector('[data-area-go]') : null;
  const viewArea = () => { const a = st.adapter; const w = a && a.view ? a.view() : null; if (!w || !isFinite(w.lat)) return null; return { lat: +w.lat.toFixed(5), lon: +w.lon.toFixed(5), r: Math.round(Math.min(50000, Math.max(250, distM(w.lat, w.lon, w.ne[0], w.ne[1])))) }; };
  const areaMoved = (a, b) => !b || distM(a.lat, a.lon, b.lat, b.lon) > 0.3 * Math.min(a.r, b.r) || a.r < b.r * 0.45 || a.r > b.r * 2.2;
  const onMoved = () => {
    const a0 = st.adapter; if (a0 && a0.zoom) el.classList.toggle('z-close', a0.zoom() >= 17); // street level: pin labels give way
    const now = viewArea(); if (!now || !areaBtn) return;
    if (!st.area) { st.area = now; return; } // the first view after drawing is the starting area
    areaBtn.hidden = !(st.areaFns.length && areaMoved(now, st.area));
  };
  if (areaBtn) areaBtn.onclick = () => { const now = viewArea(); if (!now) return; st.area = now; areaBtn.hidden = true; st.areaFns.forEach(fn => { try { fn(now); } catch { /* one list failing doesn't stop the others */ } }); };
  const draw = (a) => {
    st.adapter = a; maps.add(a); st.groups = {}; st.area = null; if (areaBtn) areaBtn.hidden = true;
    if (a.onMoved) { a.onMoved(onMoved); setTimeout(() => { if (!st.area && st.adapter === a) st.area = viewArea(); }, 0); } // Leaflet's first view fires before we listen
    a.pin(v.lat, v.lon, { title: v.pinName || v.name, color: cfg.theme.accent, html: `<b>${esc(v.pinName || v.name)}</b><br>${esc(v.address || '')}` });
    const sp = typeSpec(cfg), td = typeData(cfg), pts = [[v.lat, v.lon]];
    if (sp && !cfg.off.details) sp.fields.filter(f => f[2] === 'place' && td[f[0]] && td[f[0]].lat != null).forEach(([k, label]) => {
      const p = td[k]; pts.push([p.lat, p.lon]); a.label(p.lat, p.lon, { title: `${t(label)}: ${p.q}`, text: t(label), html: `<b>${esc(t(label))}</b><br>${esc(p.q)}` });
    });
    if (pts.length > 1) a.fit(pts);
    if (st.gmode) drawPins(); else if (st.data) layers();
    if (st.saved.length) a.savedPins(st.saved);
    if (st.hotels.length) a.hotelPins(st.hotels);
  };
  const popup = (x) => `<b>${esc(x.name)}</b><br>${esc(t('{d} from the venue', { d: fmtDist(x.d, v.cc) }))}`;
  const layers = () => {
    const a = st.adapter, d = st.data; if (!a || !d || st.gmode) return;
    Object.values(st.groups).forEach(x => { try { x.g.set([]); x.g.show(false); } catch { /* gone */ } }); st.groups = {};
    const defs = [['food', '#E4572E', t('Food & drink'), (st.food || d.food.slice(0, 25)).map(x => ({ lat: x.lat, lon: x.lon, title: x.name, onClick: () => art._openPlace && art._openPlace(placeKey(x)), html: popup(x) }))]];
    if (T.stay) defs.push(['hotels', '#7B4FD6', t('Hotels'), d.hotels.slice(0, 15).map(x => ({ lat: x.lat, lon: x.lon, title: x.name, onClick: () => art._openPlace && art._openPlace(placeKey(x)), html: popup(x) }))]);
    if (T.tours) defs.push(['sights', '#0B9A6D', t('Sights'), (d.sights || []).slice(0, 12).map(x => ({ lat: x.lat, lon: x.lon, title: x.name, onClick: () => art._openPlace && art._openPlace(placeKey(x)), html: popup(x) }))]);
    defs.push(['transit', '#1D8FD8', t('Transit'), [].concat(...Object.values(d.transit)).map(x => ({ lat: x.lat, lon: x.lon, title: x.name, html: popup(x) }))]);
    defs.forEach(([k, color, label, items]) => { if (!items.length && k !== 'food') return; const g = a.group(color); g.set(items); st.groups[k] = { g, color, label }; });
    const lg = art.querySelector('[data-slot="legend"]');
    lg.innerHTML = Object.entries(st.groups).map(([k, x]) => `<button class="chip on" data-layer="${k}" aria-pressed="true"><i style="background:${x.color}"></i>${x.label}</button>`).join('');
    lg.onclick = (e) => { const b = e.target.closest('[data-layer]'); if (!b) return; const l = st.groups[b.dataset.layer]; const on = !l.g.visible(); l.g.show(on); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); };
  };
  const fallback = () => {
    if (st.adapter && st.adapter.kind === 'leaflet') return; gmapsFails.delete(fallback);
    if (st.adapter) { maps.delete(st.adapter); try { st.adapter.remove(); } catch {} st.adapter = null; }
    if (window.L && document.body.contains(el)) { const fresh = el.cloneNode(false); el.replaceWith(fresh); el = fresh; el.dataset.engine = 'leaflet'; draw(leafletAdapter(el, v)); if (art._useSrc) art._useSrc('osm'); }
  };
  const build = () => {
    if (st.adapter || st.building) return; st.building = true;
    loadGoogleMaps().then(g => {
      if (!document.body.contains(el)) return;
      if (gmapsBroken) throw new Error('key refused');
      draw(googleAdapter(g, el, v)); el.dataset.engine = 'google'; gmapsFails.add(fallback); if (art._useSrc) art._useSrc('google');
      setTimeout(() => { if (gmapsBroken) fallback(); }, 0); // a refusal can land while the map is being drawn
    })
      .catch(() => { if (document.body.contains(el)) fallback(); });
  };
  (art._showFns = art._showFns || []).push((k) => { if (k === 'nearby') build(); });
  if (!art.querySelector('[data-panel="nearby"]')?.hidden) build();
  return {
    setData: (d) => { st.data = d; layers(); },
    googleMode: () => { st.gmode = true; const lg = art.querySelector('[data-slot="legend"]'); if (lg) lg.innerHTML = ''; Object.values(st.groups).forEach(x => x.g.show(false)); },
    osmMode: () => { st.gmode = false; st.pins = []; drawPins(); layers(); },
    setPins: (items) => { st.pins = items; if (st.adapter && st.adapter.pins) st.adapter.pins(items); },
    onPoi: (fn) => { st.poi = fn; if (st.adapter) st.adapter.onPoi(fn); },
    setSaved: (items) => { st.saved = items; if (st.adapter && st.adapter.savedPins) st.adapter.savedPins(items); },
    setHotels: (items) => { st.hotels = items; if (st.adapter && st.adapter.hotelPins) st.adapter.hotelPins(items); },
    centerOn: (lat, lon, z) => { const go = () => st.adapter && st.adapter.center(lat, lon, z || 15); st.adapter ? go() : setTimeout(go, 1500); },
    setFood: (items) => { st.food = items; const g = st.groups.food; if (g) g.g.set(items.map(x => ({ lat: x.lat, lon: x.lon, title: x.name, onClick: () => art._openPlace && art._openPlace(placeKey(x)) }))); },
    center: (lat, lon, z) => { st.area = null; const go = () => { st.area = null; if (areaBtn) areaBtn.hidden = true; if (st.adapter) st.adapter.center(lat, lon, z || 14); }; st.adapter ? go() : setTimeout(go, 1500); }, // a programmatic move is a new starting area
    onArea: (fn) => { st.areaFns.push(fn); },
    searchedArea: (a) => { st.area = a; if (areaBtn) areaBtn.hidden = true; },
    _view: () => viewArea(),
    focus: (p) => { if (p.lat == null) return; showTab(art, 'nearby', opts); const go = () => { if (st.adapter) st.adapter.center(p.lat, p.lon, 17); }; st.adapter ? go() : setTimeout(go, 1500); el.scrollIntoView({ block: 'center' }); },
  };
}

// ================= My pages on this device, samples, demo links, duplicate =================
// Every page made here is kept in localStorage (config + its links), so starting a new page, copying a sample or duplicating
// never loses one. Pages always render with the current code: a link or a stored config is just data.
const DEMOS = { japan: 'japan-trip', wedding: 'tulum-wedding', race: 'chicago-10k', concert: 'redrocks-concert', conference: 'nyc-conference', festival: 'sf-festival' };
const newPid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const pagesLoad = () => { const xs = LS.get('pages'); return Array.isArray(xs) ? xs : null; };
function pagesAll() {
  let xs = pagesLoad();
  if (!xs) { // first run: bring in the old single draft and the links published from this device
    xs = []; const d = LS.get('draft');
    if (d && d.title) { const pid = newPid(); xs.push({ pid, cfg: d, url: '', hosted: LS.get('draftHosted') || null, updated: Date.now() }); LS.set('draftId', pid); }
    try { Object.keys(localStorage).filter(k => k.startsWith('ep:published:')).forEach(k => { const v = LS.get(k.slice(3)); if (!v || !v.url) return; const m = v.url.match(/#e=([^&]+)/); const cfg = m ? unpackEvent(m[1]) : null; if (!cfg || xs.some(x => x.url === v.url)) return; xs.push({ pid: newPid(), cfg, url: v.url, hosted: null, updated: +k.split(':')[2] || Date.now() }); }); } catch { /* storage blocked */ }
    LS.set('pages', xs);
  }
  return xs;
}
function pageSave(pid, patch) {
  if (!pid) return; const xs = pagesAll(); const i = xs.findIndex(x => x.pid === pid);
  const e = { ...(i >= 0 ? xs[i] : { pid, url: '', hosted: null }), ...patch, updated: Date.now() };
  if (!e.cfg || !(e.cfg.title || '').trim()) return; // untitled scratch drafts stay out of the list
  if (i >= 0) xs[i] = e; else xs.unshift(e);
  LS.set('pages', xs.slice(0, 60));
}
// Deleting a page only drops it from this device's list. A page with a short link stays on the server (links you shared keep
// working), so its id is remembered here to keep it out of the "On your account" list too.
function pageRemove(pid) {
  const xs = pagesAll(); const x = xs.find(p => p.pid === pid);
  if (x && x.hosted && x.hosted.id) { const h = LS.get('hiddenHosted') || []; if (!h.includes(x.hosted.id)) LS.set('hiddenHosted', [x.hosted.id, ...h].slice(0, 200)); }
  LS.set('pages', xs.filter(p => p.pid !== pid));
}
// In-app "are you sure?" (window.confirm is suppressed in installed iOS web apps and some in-app browsers, where it just returns false).
// Resolves true only on the destructive button; Cancel, Escape and a tap on the backdrop resolve false.
function confirmDlg({ title, body = '', ok = 'Delete', cancel = 'Cancel' }) {
  return new Promise((resolve) => {
    let d = $('#confirmdlg');
    if (!d) { d = document.createElement('dialog'); d.id = 'confirmdlg'; d.className = 'confirm-dlg'; d.setAttribute('aria-labelledby', 'confirmdlg-h'); d.setAttribute('aria-describedby', 'confirmdlg-b'); document.body.appendChild(d); }
    if (typeof d.showModal !== 'function') { d.remove(); resolve(confirm(body ? `${title} ${body}` : title)); return; }
    d.innerHTML = `<form method="dialog" class="cf-in"><h2 id="confirmdlg-h">${esc(title)}</h2>${body ? `<p id="confirmdlg-b">${esc(body)}</p>` : ''}
      <div class="btns cf-b"><button type="submit" class="btn" value="cancel" autofocus>${esc(cancel)}</button><button type="submit" class="btn danger" value="ok">${esc(ok)}</button></div></form>`;
    d.returnValue = '';
    d.onclick = (e) => { if (e.target === d) d.close('cancel'); }; // backdrop
    d.onclose = () => { d.onclose = null; resolve(d.returnValue === 'ok'); };
    d.showModal();
  });
}
function duplicateCfg(cfg) { const c = normalize(clone(cfg)); c.title = (c.title || 'Untitled') + ' (copy)'; return c; }
function myPagesHTML() {
  const xs = pagesAll().slice().sort((a, b) => b.updated - a.updated); if (!xs.length) return '';
  const cur = LS.get('draftId');
  return `<section class="land-mine" id="my-pages"><h2>My pages <small class="muted">on this device</small></h2><ul class="mp-list">${xs.slice(0, 12).map(x => { const c = normalize(clone(x.cfg)); const open = x.hosted ? shortURL(x.hosted.slug) : x.url;
    return `<li style="${themeStyle(c.theme)}"><i class="mp-dot" aria-hidden="true"></i><div class="mp-t"><b>${esc(c.title || 'Untitled')}</b><span>${esc([TYPE_LABEL[c.type] || c.type, c.start ? dateRange(c.start, c.end) : '', x.hosted ? 'short link' : open ? 'shared' : 'draft', x.pid === cur ? 'open in editor' : ''].filter(Boolean).join(' · '))}</span></div>
      <div class="mp-b">${open ? `<a class="btn sm" href="${esc(open)}">Open</a>` : ''}<a class="btn sm ${open ? '' : 'primary'}" href="#page=${esc(x.pid)}">Edit</a><a class="btn sm ghost" href="#dup=${esc(x.pid)}">Duplicate</a><button type="button" class="btn sm ghost" data-mp-del="${esc(x.pid)}" aria-label="Delete ${esc(c.title || 'Untitled')} from this list">Delete</button></div></li>`; }).join('')}</ul>
    <div data-slot="acct-pages"></div></section>`;
}
function renderExamples() {
  document.title = 'Example pages · 1LinkTrip'; scrollTo(0, 0);
  $('#app').innerHTML = `<main class="land"><header class="land-top"><a class="brand" href="#">${BRAND}</a><span class="land-nav"><a class="btn primary" href="#setup">Create a page</a></span></header>${samplesHTML()}</main>`;
}
function samplesHTML() {
  const ex = window.EXAMPLES; const order = ['japan-trip', 'tulum-wedding', 'chicago-10k', 'redrocks-concert', 'nyc-conference', 'sf-festival'].filter(id => ex[id]);
  const demoOf = (id) => Object.keys(DEMOS).find(k => DEMOS[k] === id);
  return `<section class="land-ex" id="samples"><h2>Example pages</h2>
    <div class="ex-grid">${order.map(id => { const e = normalize(clone(ex[id])); const v = e.venue;
      return `<div class="ex-card" style="${themeStyle(e.theme)}"><a class="ex-hit" href="?demo=${demoOf(id)}" aria-label="Open ${esc(e.title)}"></a>
        <span class="ex-img" style="background-image:url('${esc(e.cover)}')"></span>
        <span class="ex-body"><span class="lbl">${esc(TYPE_LABEL[e.type] || e.type)}${v ? ' · ' + esc(v.city) : ''}</span><b>${esc(e.title)}</b><span>${esc(dateRange(e.start, e.end))}</span></span>
        <span class="ex-acts"><a class="btn sm" href="?demo=${demoOf(id)}">Open</a><a class="btn sm ghost" href="#edit-ex=${id}">Make a copy</a></span></div>`; }).join('')}</div></section>`;
}
function wireLanding() {
  const m = $('.land'); if (!m) return;
  m.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mp-del]'); if (!b) return; const x = pagesAll().find(p => p.pid === b.dataset.mpDel); if (!x) return;
    if (!await confirmDlg({ title: `Delete “${(x.cfg && x.cfg.title) || 'Untitled'}”?`, body: 'Links you already shared keep working.', ok: 'Delete' })) return;
    pageRemove(x.pid); if (LS.get('draftId') === x.pid) { LS.del('draftId'); LS.del('draft'); LS.del('draftHosted'); } renderLanding();
  });
  // pages on the account (other devices) when signed in
  if (LS.get('signedIn') && SB) sbUser().then(async (u) => {
    if (!u) return; const c = await sb(); const { data } = await c.from('events').select('id,slug,config,updated_at').eq('owner', u.id).order('updated_at', { ascending: false }).limit(20);
    const local = new Set([...pagesAll().filter(x => x.hosted).map(x => x.hosted.id), ...(LS.get('hiddenHosted') || [])]); const rows = (data || []).filter(r => !local.has(r.id)); const slot = $('[data-slot="acct-pages"]');
    if (!rows.length || !slot) return;
    slot.innerHTML = `<h3 class="sub-h">On your account</h3><ul class="mp-list">${rows.map(r => { const c = normalize(r.config); return `<li style="${themeStyle(c.theme)}"><i class="mp-dot"></i><div class="mp-t"><b>${esc(c.title)}</b><span>${esc([TYPE_LABEL[c.type] || c.type, c.start ? dateRange(c.start, c.end) : '', 'short link'].filter(Boolean).join(' · '))}</span></div><div class="mp-b"><a class="btn sm" href="${esc(shortURL(r.slug))}">Open</a><a class="btn sm" href="#mine/${esc(r.id)}">Replies</a></div></li>`; }).join('')}</ul>`;
  }).catch(() => {});
}

// ================= Nearby from Google Places (when a key is set): list + pins + tappable map POIs → in-app card =================
// One request per category / cuisine / dietary search, cached per event for 3 days. Open now, rating and price filter
// the cached results in the browser, so changing them costs nothing. OpenStreetMap stays as the fallback.
const GP_CATS = [['restaurant', 'Restaurants', ['restaurant'], 1500], ['coffee', 'Coffee', ['cafe', 'coffee_shop'], 1500], ['bar', 'Bars', ['bar', 'pub', 'wine_bar'], 1500],
  ['todo', 'Things to do', ['tourist_attraction', 'museum', 'park', 'art_gallery'], 4000], ['hotel', 'Hotels', ['lodging'], 3000]];
const GP_CUISINES = ['american', 'barbecue', 'brazilian', 'breakfast', 'brunch', 'chinese', 'french', 'greek', 'hamburger', 'indian', 'indonesian', 'italian', 'japanese', 'korean', 'lebanese', 'mediterranean', 'mexican', 'middle_eastern', 'pizza', 'ramen', 'seafood', 'spanish', 'steak_house', 'sushi', 'thai', 'turkish', 'vegan', 'vegetarian', 'vietnamese'];
const gpCuisineType = (c) => c === 'steak_house' ? 'steak_house' : c + '_restaurant';
const GP_DIETS = [['vegetarian', 'Vegetarian', 'vegetarian'], ['vegan', 'Vegan', 'vegan'], ['gluten_free', 'Gluten-free', 'gluten free'], ['halal', 'Halal', 'halal'], ['kosher', 'Kosher', 'kosher']];
const GP_LIST_MASK = 'places.id,places.displayName,places.location,places.rating,places.userRatingCount,places.priceLevel,places.primaryTypeDisplayName,places.currentOpeningHours.openNow,places.shortFormattedAddress';
const GP_CARD_MASK = 'id,displayName,location,formattedAddress,rating,userRatingCount,priceLevel,primaryTypeDisplayName,regularOpeningHours.weekdayDescriptions,currentOpeningHours.openNow,websiteUri,nationalPhoneNumber,internationalPhoneNumber,googleMapsUri,photos,servesVegetarianFood,reservable,types,primaryType';
let gpBroken = false; // set when the Places API refuses (quota, key): pages fall back to OpenStreetMap
const gpRow = (x, v) => ({ id: x.id, name: (x.displayName && x.displayName.text) || '', lat: x.location && x.location.latitude, lon: x.location && x.location.longitude,
  rating: x.rating || 0, count: x.userRatingCount || 0, price: G_PRICE[x.priceLevel] || '', type: (x.primaryTypeDisplayName && x.primaryTypeDisplayName.text) || '',
  open: x.currentOpeningHours ? !!x.currentOpeningHours.openNow : null, addr: x.shortFormattedAddress || x.formattedAddress || '',
  d: x.location ? distM(v.lat, v.lon, x.location.latitude, x.location.longitude) : 0 });
function gpQueryKey(f) { if (f.q) return `q:${f.q.toLowerCase()}:${f.diet}`; return f.diet ? `diet:${f.cat}:${f.diet}` : f.cuisine && f.cat === 'restaurant' ? `cuisine:${f.cuisine}` : `cat:${f.cat}`; }
function gpSearch(cfg, f, center) {
  const v = center || cfg.venue; const qk = gpQueryKey(f); const key = `gq1:${osmKey(v.lat, v.lon)}${v.r ? ':r' + v.r : ''}:${qk}`;
  const c = LS.get(key); if (c && (Date.now() - c.t < G_TTL || navigator.onLine === false)) return Promise.resolve(c.d);
  if (memo.has(key)) return memo.get(key);
  const cat = GP_CATS.find(x => x[0] === f.cat) || GP_CATS[0]; const rad = v.r || cat[3]; const circle = { center: { latitude: v.lat, longitude: v.lon }, radius: rad };
  let req;
  if (f.q) {
    const diet = f.diet ? GP_DIETS.find(x => x[0] === f.diet)[2] + ' ' : '';
    req = gFetch('https://places.googleapis.com/v1/places:searchText', { textQuery: diet + f.q, maxResultCount: 20, locationBias: { circle: { center: { latitude: v.lat, longitude: v.lon }, radius: v.r || 5000 } } }, GP_LIST_MASK);
  } else if (f.diet) {
    const noun = { restaurant: 'restaurants', coffee: 'cafes', bar: 'bars', todo: 'restaurants', hotel: 'restaurants' }[f.cat] || 'restaurants';
    req = gFetch('https://places.googleapis.com/v1/places:searchText', { textQuery: `${GP_DIETS.find(x => x[0] === f.diet)[2]} ${noun}`, maxResultCount: 20, locationBias: { circle } }, GP_LIST_MASK);
  } else {
    const types = f.cuisine && f.cat === 'restaurant' ? [gpCuisineType(f.cuisine)] : cat[2];
    req = gFetch('https://places.googleapis.com/v1/places:searchNearby', { includedTypes: types, maxResultCount: 20, locationRestriction: { circle } }, GP_LIST_MASK);
  }
  const from = v.anchor || v; // an area search still measures distance from the venue (or the trip stop)
  const p = req.then(j => { const d = (j.places || []).map(x => gpRow(x, from)).filter(x => x.lat != null && (f.q || distM(v.lat, v.lon, x.lat, x.lon) <= rad * (v.r ? 1.2 : 1.8))); LS.set(key, { t: Date.now(), d }); return d; })
    .catch(e => { if (c && !/places 4/.test(e.message)) return c.d; throw e; }); // offline: the last list
  memo.set(key, p); p.catch(() => memo.delete(key)); return p;
}
function gpDetails(id, session) {
  const key = 'gc3:' + id; const c = LS.get(key); if (c && Date.now() - c.t < G_TTL) return Promise.resolve(c.d);
  return gFetch(`https://places.googleapis.com/v1/places/${enc(id)}${session ? '?sessionToken=' + enc(session) : ''}`, null, GP_CARD_MASK).then(x => {
    const ph = (x.photos || []).slice(0, 4).map(p => ({ name: p.name, by: p.authorAttributions && p.authorAttributions[0] ? p.authorAttributions[0].displayName || '' : '' }));
    const d = { id: x.id, name: (x.displayName && x.displayName.text) || '', lat: x.location && x.location.latitude, lon: x.location && x.location.longitude, addr: x.formattedAddress || '',
      rating: x.rating || 0, count: x.userRatingCount || 0, price: G_PRICE[x.priceLevel] || '', type: (x.primaryTypeDisplayName && x.primaryTypeDisplayName.text) || '',
      hours: (x.regularOpeningHours && x.regularOpeningHours.weekdayDescriptions) || [], open: x.currentOpeningHours ? !!x.currentOpeningHours.openNow : null,
      web: x.websiteUri || '', phone: x.internationalPhoneNumber || x.nationalPhoneNumber || '', phoneLocal: x.nationalPhoneNumber || '', url: x.googleMapsUri || '', photos: ph,
      veg: !!x.servesVegetarianFood, reservable: !!x.reservable, food: (x.types || []).some(t => /restaurant|food|meal/.test(t)), types: x.types || [], ptype: x.primaryType || '' };
    LS.set(key, { t: Date.now(), d }); return d;
  });
}
function gpFilter(rows, f) { return rows.filter(r => (!f.open || r.open === true) && (!f.stars || r.rating >= f.stars) && (!f.price || r.price === f.price)); }
function gpHTML(cfg, art, rows) {
  const v = cfg.venue; const f = art._gp; const list = gpFilter(rows || [], f);
  const prices = ['$', '$$', '$$$', '$$$$']; const isFood = f.cat === 'restaurant' || f.cat === 'coffee' || f.cat === 'bar';
  const active = (f.cuisine ? 1 : 0) + (f.diet ? 1 : 0) + (f.open ? 1 : 0) + (f.stars ? 1 : 0) + (f.price ? 1 : 0);
  return `<div class="pf gp" role="group" aria-label="${t('Filters')}">
    <div class="chips pf-cats">${GP_CATS.map(([k, l]) => `<button type="button" class="chip ${f.cat === k && !f.q ? 'on' : ''}" data-gp-cat="${k}" aria-pressed="${f.cat === k && !f.q}">${t(l)}</button>`).join('')}</div>
    <div class="chips pf-diet">
      <button type="button" class="chip ${f.open ? 'on' : ''}" data-gp-open aria-pressed="${f.open}">${t('Open now')}</button>
      ${[4, 4.5].map(n => `<button type="button" class="chip ${f.stars === n ? 'on' : ''}" data-gp-stars="${n}" aria-pressed="${f.stars === n}">★ ${n.toFixed(1)}+</button>`).join('')}
      ${f.cat !== 'todo' ? prices.map(pr => `<button type="button" class="chip ${f.price === pr ? 'on' : ''}" data-gp-price="${pr}" aria-pressed="${f.price === pr}">${esc(priceSym(cfg, pr))}</button>`).join('') : ''}
    </div>
    ${isFood ? `<div class="pf-row">
      ${f.cat === 'restaurant' ? `<label class="pf-sel"><span class="sr">${t('Cuisine')}</span><select data-gp="cuisine" ${f.diet ? 'disabled' : ''}><option value="">${t('Any cuisine')}</option>${GP_CUISINES.map(c => `<option value="${c}" ${f.cuisine === c ? 'selected' : ''}>${esc(cuisineLabel(c))}</option>`).join('')}</select></label>` : ''}
      <label class="pf-sel"><span class="sr">${t('Dietary')}</span><select data-gp="diet"><option value="">${t('Any dietary need')}</option>${GP_DIETS.map(([k, l]) => `<option value="${k}" ${f.diet === k ? 'selected' : ''}>${t(l)}</option>`).join('')}</select></label>
    </div>` : ''}
  </div>
  ${rows == null ? `<div class="skel" role="status"><span></span><span></span><em>${t('Loading places…')}</em></div>` : `
  ${f.q ? `<p class="gp-q"><span>${esc(t('Results for “{q}”', { q: f.q }))}</span> <button type="button" class="link" data-gp-q-clear>${t('Clear search')}</button></p>` : ''}
  <p class="pf-count muted small" role="status" aria-live="polite">${esc(list.length === 1 ? t('1 place') : t('{n} places', { n: list.length }))}${active ? ` · <button type="button" class="link" data-gp-clear>${t('Clear filters')}</button>` : ''}</p>
  ${list.length ? `<ul class="plist rich places">${list.map(r => `<li class="has-star"><button type="button" class="place-row" data-gplace="${esc(r.id)}"><div><b>${esc(r.name)}</b>${r.rating ? `<span class="rt">${gRatingHTML(r)}</span>` : ''}<span>${esc([r.type, priceSym(cfg, r.price)].filter(Boolean).join(' · '))}</span>${r.open != null ? `<span class="tags">${r.open ? `<em class="open">${t('Open now')}</em>` : `<em class="closed">${t('Closed now')}</em>`}</span>` : ''}</div><span class="dist">${esc(fmtDist(r.d, v.cc))}<small>${r.d < 2500 ? walkTxt(r.d) : art._fromHotel ? t('from your hotel') : t('from the venue')}</small></span></button>${starBtnHTML(cfg, r.id, r.name)}</li>`).join('')}</ul>`
    : navigator.onLine === false ? `<p class="muted off-msg"><b>${t('Offline')}</b> · ${t('Searching places needs a connection. Your saved spots are in My trip.')}</p>` : `<p class="muted">${t('Nothing matches these filters.')} ${active ? `<button type="button" class="link" data-gp-clear>${t('Clear filters')}</button>` : ''}</p>`}
  <p class="muted small g-attr">${t('Places and ratings from Google')}</p>`}`;
}
const gPlanPlace = (d) => ({ src: 'g', ref: d.id, name: d.name, lat: d.lat, lon: d.lon, rating: d.rating, count: d.count, addr: d.addr, hours: d.hours, type: d.ptype ? placeType([d.ptype], '') : placeType(d.types, '') });
function gpCardHTML(cfg, d, art) {
  const v = cfg.venue; const tr = tripDates(cfg); const o = art && art._fromHotel && art._hotelPt ? art._hotelPt : v; const dist = d.lat != null ? distM(o.lat, o.lon, d.lat, d.lon) : 0;
  const dirURL = `https://www.google.com/maps/dir/?api=1&origin=${o.lat},${o.lon}&destination=${enc(d.name)}&destination_place_id=${enc(d.id)}&travelmode=${dist < 2500 ? 'walking' : 'transit'}`;
  const ph = d.photos[0];
  return `<div class="pc"><button type="button" class="x" data-pc-close aria-label="${t('Close')}">×</button>
    ${ph ? `<figure class="pc-photo"><img src="${esc(gPhotoURL(ph.name))}" alt="${esc(d.name)}" loading="lazy" onerror="this.closest('figure').remove()">${ph.by ? `<figcaption>${esc(t('Photo: {n}', { n: ph.by }))}</figcaption>` : ''}</figure>` : ''}
    ${d.type ? `<p class="lbl">${esc(d.type)}</p>` : ''}
    <h2>${esc(d.name)}</h2>
    ${d.rating ? `<p class="rt">${gRatingHTML(d)} <small class="muted">${t('on Google')}</small></p>` : ''}
    <p class="pc-dist">${esc(t(o === v ? '{d} from the venue' : '{d} from your hotel', { d: fmtDist(dist, v.cc) }))}${dist < 2500 ? ' · ' + walkTxt(dist) : ''}${d.price ? ' · ' + esc(priceSym(cfg, d.price)) : ''}</p>
    ${d.veg ? `<p class="tags"><em>${t('Vegetarian options')}</em></p>` : ''}
    ${d.hours.length ? `<div class="pc-hours"><b>${d.open === true ? `<span class="open">${t('Open now')}</span>` : d.open === false ? `<span class="closed">${t('Closed now')}</span>` : t('Hours')}</b><ul>${d.hours.map(h => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}
    ${d.addr ? `<p class="pc-addr">${esc(d.addr)}</p>` : ''}
    ${planAddHTML(cfg, gPlanPlace(d))}
    <div class="btns sec-acts">${(d.types || []).includes('lodging') ? (() => { const a = hotelBookAction(cfg, { name: d.name, web: d.web, city: '' }); return ext(a.url, a.label, 'btn book'); })() : ''}${ext(dirURL, t('Directions'), 'btn')}${d.food ? bookExt('restaurants', 'opentable', { name: d.name, venue: v, date: cfg.start.slice(0, 10), n: tr.guests || 2 }, t('Reserve') + ' · OpenTable', 'btn') : ''}${d.phone ? `<a class="btn" href="tel:${esc(d.phone.replace(/[^\d+]/g, ''))}">${t('Call')}</a>` : ''}${d.web ? ext(d.web, t('Website'), 'btn') : ''}</div>
    <button type="button" class="link" data-pc-map>${t('Show on map')}</button>
  </div>`;
}
function openPlaceDialog(cfg, html, onMap, place, art) {
  let d = $('#placedlg'); if (!d) { d = document.createElement('dialog'); d.id = 'placedlg'; d.className = 'sheet place-sheet'; document.body.appendChild(d); d.addEventListener('click', (e) => { if (e.target === d) d.close(); }); }
  d.setAttribute('style', themeStyle(cfg.theme)); d.classList.toggle('dark', cfg.theme.mode === 'dark'); d.setAttribute('lang', LANG);
  d.innerHTML = html; d.onclick = (e) => { if (place && planCardClick(cfg, art, d, e, place)) return; if (e.target === d || e.target.closest('[data-pc-close]')) d.close(); if (e.target.closest('[data-pc-map]')) { d.close(); onMap && onMap(); } };
  if (!d.open) d.showModal(); return d;
}
// returns false when Google can't be used (no key, refused) so the caller wires the OpenStreetMap list instead
function wireGPlaces(cfg, art, mapCtl, onFail) {
  const s = art.querySelector('[data-slot="food"]'); if (!s || !GKEY || gpBroken || !cfg.venue) return false;
  art._gp = art._gp || { cat: 'restaurant', cuisine: '', diet: '', open: false, stars: 0, price: '', q: '' };
  let rows = null, seq = 0, started = false;
  const ss = stopsOf(cfg);
  s.innerHTML = `${ss.length > 1 ? `<div class="chips stop-chips" role="group" aria-label="${t('Route')}">${ss.map((x, i) => `<button type="button" class="chip ${i === 0 ? 'on' : ''}" data-gp-stop="${i}" aria-pressed="${i === 0}">${esc(x.name)}</button>`).join('')}</div>` : ''}<form class="gp-search" role="search" onsubmit="return false"><input type="search" data-gp-q placeholder="${t('Search places, e.g. ramen')}" aria-label="${t('Search places')}" autocomplete="off" enterkeyhint="search"><button type="submit" class="btn sm" data-gp-go>${t('Search')}</button></form><div data-gp-body></div>`;
  const bodyEl = s.querySelector('[data-gp-body]'); const qIn = s.querySelector('[data-gp-q]');
  const v0 = cfg.venue;
  const pickPlace = (id, tok) => gpDetails(id, tok).then(pl => {
    if (mapCtl && pl.lat != null) { mapCtl.setPins(gpFilter(rows || [], art._gp).map(r => ({ lat: r.lat, lon: r.lon, title: r.name, onClick: () => art._openGPlace(r.id) })).concat([{ lat: pl.lat, lon: pl.lon, title: pl.name, z: 900, onClick: () => art._openGPlace(pl.id) }])); mapCtl.focus(pl); }
    openPlaceDialog(cfg, gpCardHTML(cfg, pl, art), () => mapCtl && mapCtl.focus(pl), gPlanPlace(pl), art);
  }).catch(() => toast(t('Couldn’t load this place right now.')));
  const textSearch = (q) => { if (!q) return; art._gp.q = q.slice(0, 80); art._gp.cuisine = ''; qIn.blur(); load(); };
  placeAutocomplete(qIn, { bias: () => cfg.venue, onPick: pickPlace, onText: textSearch });
  const pins = () => { if (mapCtl) mapCtl.setPins(gpFilter(rows || [], art._gp).map(r => ({ lat: r.lat, lon: r.lon, title: r.name, onClick: () => art._openGPlace(r.id) }))); };
  const render = () => { bodyEl.innerHTML = gpHTML(cfg, art, rows); pins(); };
  const load = () => {
    const my = ++seq; rows = null; render();
    gpSearch(cfg, art._gp, art._center).then(d => { if (my !== seq) return; rows = d; if (art._useSrc) art._useSrc('google'); render(); })
      .catch(e => { if (my !== seq) return; if (/places 4(03|29)|places 400/.test(e.message)) { gpBroken = true; onFail && onFail(); return; } rows = []; render(); });
  };
  art._openGPlace = (id) => {
    const dlg = openPlaceDialog(cfg, `<div class="pc"><button type="button" class="x" data-pc-close aria-label="${t('Close')}">×</button><div class="skel" role="status"><span></span><span></span><em>${t('Loading…')}</em></div></div>`);
    gpDetails(id).then(d => { if (!dlg.open) return; openPlaceDialog(cfg, gpCardHTML(cfg, d, art), () => mapCtl && mapCtl.focus(d), gPlanPlace(d), art); })
      .catch(() => { if (dlg.open) dlg.querySelector('.pc').insertAdjacentHTML('beforeend', `<p class="muted">${t('Couldn’t load this place right now.')}</p>`); });
  };
  if (mapCtl) {
    mapCtl.googleMode(); mapCtl.onPoi((placeId) => art._openGPlace(placeId));
    mapCtl.onArea((a) => { if (gpBroken) return; const base = art._center && !art._center.r ? art._center : (art._center && art._center.anchor) || v0; art._center = { lat: a.lat, lon: a.lon, r: a.r, anchor: { lat: base.lat, lon: base.lon } }; started = true; load(); });
  }
  const go = () => { if (started) return; const panel = art.querySelector('[data-panel="nearby"]'); if (panel && panel.hidden) return; started = true; load(); };
  art._gpReload = () => { if (started) load(); else render(); };
  (art._showFns = art._showFns || []).push((k) => { if (k === 'nearby') go(); });
  bodyEl.innerHTML = gpHTML(cfg, art, null);
  s.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; const f = art._gp; const d = b.dataset;
    if (d.gplace) { art._openGPlace(d.gplace); return; }
    if (d.gpSave) { const r = (rows || []).find(x => x.id === d.gpSave); if (r) toggleSaved(cfg, art, { src: 'g', ref: r.id, name: r.name, lat: r.lat, lon: r.lon, rating: r.rating, count: r.count, addr: r.addr, hours: '', type: placeType([], r.type.toLowerCase()) }); render(); return; }
    if (d.gpStop != null) { const st = ss[+d.gpStop]; art._stop = hotelStops(cfg).indexOf(st); if (art._stop < 0) art._stop = 0; const h = art._hotelAt ? art._hotelAt(art._stop) : null; art._center = h || st; art._fromHotel = !!h; art._hotelPt = h; $$('[data-gp-stop]', s).forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); }); if (mapCtl) mapCtl.center(art._center.lat, art._center.lon, h ? 15 : 13); art._hotelUI && art._hotelUI(); return load(); }
    if ('gpGo' in d) { textSearch(qIn.value.trim()); return; }
    if ('gpQClear' in d) { f.q = ''; qIn.value = ''; return load(); }
    if (d.gpCat) { if (f.cat === d.gpCat && !f.q) return; f.cat = d.gpCat; f.cuisine = ''; f.price = ''; f.q = ''; qIn.value = ''; return load(); }
    if (d.gpOpen != null) f.open = !f.open;
    else if (d.gpStars) f.stars = f.stars === +d.gpStars ? 0 : +d.gpStars;
    else if (d.gpPrice) f.price = f.price === d.gpPrice ? '' : d.gpPrice;
    else if (d.gpClear != null) { const refetch = f.cuisine || f.diet; Object.assign(f, { cuisine: '', diet: '', open: false, stars: 0, price: '' }); if (refetch) return load(); }
    else return;
    render();
  });
  s.addEventListener('change', debounce((e) => { const i = e.target; if (!i.dataset.gp) return; art._gp[i.dataset.gp] = i.value; if (i.dataset.gp === 'diet' && i.value) art._gp.cuisine = ''; load(); }, 250));
  go();
  return true;
}

// ================= the guest's own plan: places added from any place card, by day or saved for later =================
// Stored per event in localStorage (account sync arrives with the itinerary table). Shown in My trip, merged into the
// schedule / trip itinerary, and as gold ★ pins on the map. Tapping one opens the same place card.
const planKey = (cfg) => 'plan:' + eventKey(cfg).slice(6);
const planLoad = (cfg) => LS.get(planKey(cfg), []) || [];
const planSave = (cfg, xs) => { LS.set(planKey(cfg), xs); if (typeof syncPush === 'function' && LS.get('signedIn')) syncPush(cfg); };
function planDays(cfg) {
  if (!cfg.start) return [];
  const tr = tripDates(cfg); let s = isTrip(cfg) ? cfg.start.slice(0, 10) : tr.arrive, e = isTrip(cfg) ? (cfg.end || cfg.start).slice(0, 10) : tr.leave;
  if (e < s) e = s; const n = Math.min(45, daysBetween(s, e)); return Array.from({ length: n + 1 }, (_, i) => addDays(s, i));
}
const dayLabel = (cfg, d) => { const st = stopsOf(cfg).length > 1 ? stopFor(cfg, d) : null; return `${isTrip(cfg) && cfg.start && d >= cfg.start.slice(0, 10) ? t('Day {n}', { n: daysBetween(cfg.start, d) + 1 }) + ' · ' : ''}${fmt(d, { weekday: 'short', month: 'short', day: 'numeric' })}${st ? ' · ' + st.name : ''}`; };
function planAddHTML(cfg, place) {
  const have = planLoad(cfg).find(x => x.ref === place.ref);
  const days = planDays(cfg);
  return `<div class="plan-add" data-plan-box>
    ${have ? `<p class="plan-have">✓ ${esc(have.day ? t('In your plan: {d}', { d: dayLabel(cfg, have.day) }) : t('Saved for later'))}</p>` : ''}
    <div class="btns"><button type="button" class="btn primary" data-plan-open>${have ? t('Change day') : t('Add to itinerary')}</button>${have && !have.day ? '' : `<button type="button" class="btn" data-plan-later>${t('Save for later')}</button>`}</div>
    <div class="plan-form" hidden>
      <div class="two"><label class="field"><span>${t('Day')}</span><select data-plan-day>${days.map(d => `<option value="${d}" ${have && have.day === d ? 'selected' : ''}>${esc(dayLabel(cfg, d))}</option>`).join('')}</select></label>
      <label class="field"><span>${t('Time (optional)')}</span><input type="time" data-plan-time value="${esc(have ? have.time : '')}"></label></div>
      <label class="field"><span>${t('Note (optional)')}</span><input data-plan-note maxlength="200" value="${esc(have ? have.note : '')}" placeholder="${t('Book a table for 4, try the tasting menu…')}"></label>
      <div class="btns"><button type="button" class="btn primary" data-plan-save>${t('Add to day')}</button><button type="button" class="btn ghost" data-plan-cancel>${t('Cancel')}</button></div>
    </div></div>`;
}
// the place card's Add / Save handlers; place = {src:'g'|'osm', ref, name, lat, lon, rating, count, addr, open, hours}
function planCardClick(cfg, art, dlg, e, place) {
  const b = e.target.closest('[data-plan-open],[data-plan-later],[data-plan-save],[data-plan-cancel]'); if (!b) return false;
  const box = dlg.querySelector('[data-plan-box]'); const form = box.querySelector('.plan-form');
  if ('planOpen' in b.dataset) { form.hidden = false; box.querySelector('.btns').hidden = true; return true; }
  if ('planCancel' in b.dataset) { form.hidden = true; box.querySelector('.btns').hidden = false; return true; }
  const xs = planLoad(cfg); const i = xs.findIndex(x => x.ref === place.ref);
  const prev = i >= 0 ? xs[i] : { id: 'pl' + Date.now().toString(36), booked: false, conf: '' };
  const item = { ...prev, src: place.src, ref: place.ref, name: place.name, lat: place.lat, lon: place.lon, rating: place.rating || 0, count: place.count || 0, addr: place.addr || '', hours: place.hours || '',
    type: prev.type || place.type || 'other',
    day: 'planLater' in b.dataset ? '' : form.querySelector('[data-plan-day]').value, time: 'planLater' in b.dataset ? '' : form.querySelector('[data-plan-time]').value, note: 'planLater' in b.dataset ? (prev.note || '') : form.querySelector('[data-plan-note]').value.trim() };
  if (i >= 0) xs.splice(i, 1); xs.push(item); planSave(cfg, xs);
  toast(item.day ? t('Added to {d}', { d: dayLabel(cfg, item.day) }) : t('Saved for later'));
  box.outerHTML = planAddHTML(cfg, place); art._planChanged && art._planChanged();
  return true;
}
const PTYPES = [['flight', 'Flights'], ['stay', 'Hotels & stays'], ['transport', 'Transport'], ['food', 'Restaurants'], ['activity', 'Tours & activities'], ['other', 'Other']];
const itinType = (x) => ({ flight: 'flight', hotel: 'stay', stay: 'stay', car: 'transport', train: 'transport', food: 'food' }[x.kind] || 'other');
// type from a Google place's types or an OpenStreetMap category
function placeType(types, cat) {
  const ts = (types || []).join(' ') + ' ' + (cat || '');
  if (/lodging|hotel|hostel|guest_house|motel/.test(ts)) return 'stay';
  if (/restaurant|cafe|coffee|bar|pub|food|bakery|meal|fast_food/.test(ts)) return 'food';
  if (/train|transit|subway|bus_station|airport|car_rental|ferry/.test(ts)) return 'transport';
  if (/tourist|museum|park|gallery|attraction|zoo|aquarium|amusement|sight|viewpoint|stadium|theater|night_club/.test(ts)) return 'activity';
  return 'other';
}
// one list: places the guest added + bookings they entered
function itineraryEntries(cfg) {
  const ps = planLoad(cfg).map((x, i) => ({ ...x, ent: 'plan', type: x.type || 'other', order: i }));
  const bs = itinLoad(cfg).map((x, i) => ({ ent: 'book', id: 'bk' + i, bi: i, name: x.name || t(ITIN_KINDS[x.kind] || 'Booking'), type: itinType(x), day: (x.start || '').slice(0, 10), time: (x.start || '').slice(11, 16), addr: x.address || '', conf: x.confNo || '', booked: true, kindLabel: t(ITIN_KINDS[x.kind] || ''), order: 1000 + i }));
  return ps.concat(bs);
}
function planHTML(cfg) {
  const all = itineraryEntries(cfg);
  if (!all.length) return `<p class="muted">${t('Add places from the Nearby tab.')}</p>`;
  const k = eventKey(cfg).slice(6); const view = LS.get('planview:' + k) || 'day'; const on = LS.get('plantypes:' + k) || [];
  const counts = {}; all.forEach(x => { counts[x.type] = (counts[x.type] || 0) + 1; });
  const xs = on.length ? all.filter(x => on.includes(x.type)) : all;
  const days = planDays(cfg); const byTime = (a, b) => (a.time || '').localeCompare(b.time || '') || a.order - b.order;
  const tlabel = (ty) => t((PTYPES.find(p => p[0] === ty) || PTYPES[5])[1]);
  const row = (x) => x.ent === 'book' ? `<li class="plan-row bk"><div class="plan-main"><b>${esc(x.name)}</b><span class="muted small">${esc([x.kindLabel, x.day ? dayLabel(cfg, x.day) : '', x.time ? fmtTime(x.time) : '', x.conf ? t('Conf. {n}', { n: x.conf }) : ''].filter(Boolean).join(' · '))}</span></div><div class="plan-ctl"><button type="button" class="link" data-bk-edit="${x.bi}">${t('Edit booking')}</button></div></li>`
    : `<li class="plan-row ${x.booked ? 'booked' : ''}" data-plan-id="${esc(x.id)}">
      <div class="plan-main"><button type="button" class="link plan-name" data-plan-card="${esc(x.id)}">${esc(x.name)}</button>
        <span class="muted small">${esc([view === 'type' && x.day ? dayLabel(cfg, x.day) : '', x.time ? fmtTime(x.time) : '', x.addr].filter(Boolean).join(' · '))}</span>
        ${x.rating ? `<span class="rt">${gRatingHTML(x)}</span>` : ''}${x.note ? `<span class="small">${esc(x.note)}</span>` : ''}
        <div class="plan-book"><label class="chk"><input type="checkbox" data-plan-booked ${x.booked ? 'checked' : ''}> ${t('Booked')}</label>${x.booked ? `<input class="plan-conf" data-plan-conf value="${esc(x.conf || '')}" placeholder="${t('Confirmation #')}" aria-label="${t('Confirmation #')}">` : ''}</div></div>
      <div class="plan-ctl"><select data-plan-move aria-label="${t('Move to day')}"><option value="">${t('Saved for later')}</option>${days.map(d => `<option value="${d}" ${x.day === d ? 'selected' : ''}>${esc(dayLabel(cfg, d))}</option>`).join('')}</select>
        <select data-plan-type aria-label="${t('Type')}">${PTYPES.map(([v, l]) => `<option value="${v}" ${x.type === v ? 'selected' : ''}>${t(l)}</option>`).join('')}</select>
        <span class="mv"><button type="button" data-plan-mv="-1" aria-label="${t('Move up')}">↑</button><button type="button" data-plan-mv="1" aria-label="${t('Move down')}">↓</button></span><button type="button" class="link" data-plan-del>${t('Remove')}</button></div></li>`;
  let groups;
  if (view === 'type') {
    groups = PTYPES.map(([ty]) => [tlabel(ty), xs.filter(x => x.type === ty).sort((a, b) => (a.day || '9999').localeCompare(b.day || '9999') || byTime(a, b))]).filter(([, g]) => g.length);
  } else {
    const inDays = days.map(d => [dayLabel(cfg, d), xs.filter(x => x.day === d).sort(byTime)]).filter(([, g]) => g.length);
    const other = xs.filter(x => x.day && !days.includes(x.day)).sort((a, b) => a.day.localeCompare(b.day) || byTime(a, b));
    groups = inDays.concat(other.length ? [[t('Other days'), other]] : [], [[t('Saved for later'), xs.filter(x => !x.day).sort(byTime)]]).filter(([, g]) => g.length);
  }
  return `<div class="plan-tools"><div class="seg2" role="group" aria-label="${t('View')}"><button type="button" data-plan-view="day" class="${view === 'day' ? 'on' : ''}" aria-pressed="${view === 'day'}">${t('By day')}</button><button type="button" data-plan-view="type" class="${view === 'type' ? 'on' : ''}" aria-pressed="${view === 'type'}">${t('By type')}</button></div>
      <div class="chips plan-chips">${PTYPES.filter(([ty]) => counts[ty]).map(([ty, l]) => `<button type="button" class="chip ${on.includes(ty) ? 'on' : ''}" data-plan-chip="${ty}" aria-pressed="${on.includes(ty)}">${t(l)} <span>${counts[ty]}</span></button>`).join('')}</div></div>
    ${groups.length ? groups.map(([h, g]) => `<h3 class="sub-h">${esc(h)}</h3><ul class="plan-list">${g.map(row).join('')}</ul>`).join('') : `<p class="muted">${t('Nothing of these types yet.')}</p>`}`;
}
function wirePlan(cfg, art, mapCtl) {
  const sec0 = art.querySelector('#sec-plan'); const body = sec0 && sec0.querySelector('.sec-b');
  const pins = () => { if (mapCtl) mapCtl.setSaved(planLoad(cfg).filter(x => x.lat != null && !x.hotel).map(x => ({ lat: x.lat, lon: x.lon, title: x.name, onClick: () => openPlan(x) }))); };
  const openPlan = (x) => { if (x.src === 'g' && art._openGPlace) art._openGPlace(x.ref); else if (art._openPlace) art._openPlace(x.ref); };
  const render = () => { if (body) body.innerHTML = planHTML(cfg); art._renderSchedule && art._renderSchedule(); pins(); const sp = art.querySelector('#sec-spots .sec-b'); if (sp) sp.innerHTML = spotsHTML(cfg); art._hotelUI && art._hotelUI(); };
  art._planChanged = render; pins();
  if (LS.get('signedIn') && cfg.tools.mytrip) syncPull(cfg, art).catch(() => {});
  if (!body) return;
  body.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; const li = b.closest('[data-plan-id]'); const xs = planLoad(cfg); const i = li ? xs.findIndex(x => x.id === li.dataset.planId) : -1;
    const k = eventKey(cfg).slice(6);
    if (b.dataset.planView) { LS.set('planview:' + k, b.dataset.planView); render(); return; }
    if (b.dataset.planChip) { const on = LS.get('plantypes:' + k) || []; LS.set('plantypes:' + k, on.includes(b.dataset.planChip) ? on.filter(x => x !== b.dataset.planChip) : on.concat(b.dataset.planChip)); render(); return; }
    if (b.dataset.bkEdit != null) { const s2 = art.querySelector('#sec-itinerary'); const eb = s2 && s2.querySelector(`[data-itin-edit="${b.dataset.bkEdit}"]`); if (eb) { s2.scrollIntoView({ block: 'start' }); eb.click(); } return; }
    if (b.dataset.planCard) { const x = xs.find(y => y.id === b.dataset.planCard); if (x) openPlan(x); return; }
    if (i < 0) return;
    if ('planDel' in b.dataset) { xs.splice(i, 1); planSave(cfg, xs); render(); }
    if (b.dataset.planMv) { const same = xs.map((y, j) => [y, j]).filter(([y]) => y.day === xs[i].day).map(([, j]) => j); const k = same.indexOf(i) + +b.dataset.planMv; if (k >= 0 && k < same.length) { const j = same[k]; [xs[i], xs[j]] = [xs[j], xs[i]]; planSave(cfg, xs); render(); } }
  });
  body.addEventListener('change', (e) => {
    const el = e.target; const li = el.closest('[data-plan-id]'); if (!li) return; const xs = planLoad(cfg); const x = xs.find(y => y.id === li.dataset.planId); if (!x) return;
    if (el.matches('[data-plan-move]')) { x.day = el.value; if (!x.day) x.time = ''; }
    if (el.matches('[data-plan-booked]')) x.booked = el.checked;
    if (el.matches('[data-plan-type]')) x.type = el.value;
    if (el.matches('[data-plan-conf]')) x.conf = el.value.trim().slice(0, 60);
    planSave(cfg, xs); render();
  });
}

// ================= the guest's hotel per city + saved spots (★) =================
// Hotel per route city: the guest's own hotel booking (My trip) for those dates → else the host's stay on the itinerary
// for that leg → else one the guest sets here. A hotel the guest sets is a plan item { hotel: true } so it syncs and
// works offline like the rest of My trip. Saved spots are plan items too (★ on any place); My trip lists them per city.
const hotelStops = (cfg) => { const ss = stopsOf(cfg).filter(s => s.lat != null); return ss.length ? ss : cfg.venue ? [cfg.venue] : []; };
const nearestStop = (cfg, p) => { let b = 0, bd = Infinity; hotelStops(cfg).forEach((s, i) => { const d = distM(s.lat, s.lon, p.lat, p.lon); if (d < bd) { bd = d; b = i; } }); return b; };
const stopOfDay = (cfg, d) => { const ss = hotelStops(cfg); if (ss.length < 2 || !d) return 0; const i = legOf(ss, d); return i < 0 ? 0 : i; };
const HOTEL_RE = /\b(check[- ]?in|hotel|hostel|ryokan|resort|airbnb|guest ?house|inn|lodge)\b/i;
const hgeoKey = (q) => 'hgeo:' + q.trim().toLowerCase().slice(0, 120);
function hotelCands(cfg) {
  const out = hotelStops(cfg).map(() => null);
  itinLoad(cfg).filter(x => x.kind === 'hotel' || x.kind === 'stay').forEach(x => { const i = stopOfDay(cfg, (x.start || '').slice(0, 10)); if (!out[i] && (x.name || x.address)) out[i] = { src: 'booking', name: x.name || t('Your hotel'), q: [x.name, x.address].filter(Boolean).join(', '), addr: x.address || '' }; });
  (cfg.off.schedule ? [] : cfg.schedule || []).filter(x => x.title && HOTEL_RE.test(x.title) && !/check[- ]?out/i.test(x.title)).forEach(x => { const i = stopOfDay(cfg, x.date); const name = x.title.replace(/^\s*check[- ]?in\s*[:\-–—]?\s*(at\s+)?/i, '').trim(); if (!out[i] && name) out[i] = { src: 'host', name, q: name, addr: '' }; });
  return out;
}
// per stop: { name, addr, lat, lon, src: 'set'|'booking'|'host', ref } (lat == null while it is still being found), or null
function hotelsNow(cfg) {
  const mine = planLoad(cfg).filter(x => x.hotel && x.lat != null); const cands = hotelCands(cfg);
  return hotelStops(cfg).map((s, i) => {
    const set = mine.filter(x => nearestStop(cfg, x) === i).slice(-1)[0];
    if (set) return { name: set.name, addr: set.addr || '', lat: set.lat, lon: set.lon, src: 'set', ref: set.ref || '', id: set.id };
    const c = cands[i]; if (!c) return null; const g = LS.get(hgeoKey(c.q));
    if (g && g.miss) return null;
    return g ? { ...c, lat: g.lat, lon: g.lon, addr: c.addr || g.addr || '', ref: g.ref || '' } : { ...c, lat: null };
  });
}
async function resolveHotels(cfg) {
  const ss = hotelStops(cfg); let n = 0;
  for (const [i, h] of hotelsNow(cfg).entries()) {
    if (!h || h.lat != null || !h.q) continue; const s = ss[i];
    const r = await geocode(`${h.q}, ${s.city || s.name}`).then(xs => xs.find(x => x.lat != null && distM(x.lat, x.lon, s.lat, s.lon) < 80000)).catch(() => undefined);
    if (r === undefined) continue; // offline or refused: try again next time
    LS.set(hgeoKey(h.q), r ? { lat: r.lat, lon: r.lon, addr: r.address || '', ref: r.gid || '' } : { miss: 1 }); n++;
  }
  return n;
}
function setHotel(cfg, art, i, p) {
  const xs = planLoad(cfg).filter(x => !(x.hotel && nearestStop(cfg, x) === i));
  if (p) xs.push({ id: 'pl' + Date.now().toString(36), src: p.gid ? 'g' : 'osm', ref: p.gid || '', name: p.name, lat: p.lat, lon: p.lon, addr: p.address || '', hotel: true, type: 'stay', day: '', time: '', note: '', booked: true, conf: '', rating: 0, count: 0, hours: '' });
  planSave(cfg, xs); art._planChanged && art._planChanged();
}
const isSaved = (cfg, ref) => !!ref && planLoad(cfg).some(x => x.ref === ref && !x.hotel);
function toggleSaved(cfg, art, place) {
  const xs = planLoad(cfg); const i = xs.findIndex(x => x.ref === place.ref && !x.hotel);
  if (i >= 0) { xs.splice(i, 1); toast(t('Removed from saved spots')); } else { xs.push({ id: 'pl' + Date.now().toString(36), booked: false, conf: '', day: '', time: '', note: '', rating: 0, count: 0, hours: '', ...place }); toast(t('Saved')); }
  planSave(cfg, xs); art._planChanged && art._planChanged();
}
const starBtnHTML = (cfg, ref, name) => { const on = isSaved(cfg, ref); return `<button type="button" class="star-b${on ? ' on' : ''}" data-gp-save="${esc(ref)}" aria-pressed="${on}" aria-label="${esc(t(on ? 'Saved: {n}' : 'Save {n}', { n: name }))}">${on ? '★' : '☆'}</button>`; };
const gmapsLink = (x) => `https://www.google.com/maps/search/?api=1&query=${enc(x.addr || x.address ? `${x.name}, ${x.addr || x.address}` : x.lat != null ? `${x.lat},${x.lon}` : x.name)}${x.src === 'g' && x.ref ? '&query_place_id=' + enc(x.ref) : ''}`;
// My trip → Saved spots: per city, the hotel first, then the starred places
function spotsByCity(cfg) {
  const ss = hotelStops(cfg); const hs = hotelsNow(cfg); const sp = planLoad(cfg).filter(x => x.lat != null && !x.hotel);
  return ss.map((s, i) => ({ city: s.city || s.name, hotel: hs[i] && hs[i].lat != null ? hs[i] : null, spots: sp.filter(x => nearestStop(cfg, x) === i) })).filter(g => g.hotel || g.spots.length);
}
function spotsHTML(cfg) {
  const gs = spotsByCity(cfg); const many = hotelStops(cfg).length > 1;
  if (!gs.length) return `<p class="muted">${t('Tap ☆ on a place in Nearby to save it here.')}</p>`;
  const row = (x, hotel) => `<li><div><b>${hotel ? `<span class="spot-ic" aria-hidden="true">🛏</span> ` : '★ '}${esc(x.name)}</b>${hotel ? `<span>${esc(t('Your hotel'))}${x.addr ? ' · ' + esc(x.addr) : ''}</span>` : x.addr ? `<span>${esc(x.addr)}</span>` : ''}</div>${ext(gmapsLink(x), t('Open in Google Maps'), 'mini-b')}</li>`;
  return `${gs.map(g => `${many ? `<h3 class="sub-h">${esc(g.city)}</h3>` : ''}<ul class="plist spots">${g.hotel ? row(g.hotel, true) : ''}${g.spots.map(x => row(x, false)).join('')}</ul>`).join('')}
    <div class="btns"><button type="button" class="btn" data-kml>${t('Save all to Google Maps')}</button></div><p class="muted small">${t('Import into Google My Maps — shows in the Google Maps app under Saved → Maps')}</p>`;
}
const xmlEsc = (s) => String(s || '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
function spotsKML(cfg) {
  const pm = (name, desc, x) => `<Placemark><name>${xmlEsc(name)}</name>${desc ? `<description>${xmlEsc(desc)}</description>` : ''}<Point><coordinates>${x.lon},${x.lat},0</coordinates></Point></Placemark>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xmlEsc(cfg.title || 'Trip')}</name>${spotsByCity(cfg).map(g => `<Folder><name>${xmlEsc(g.city)}</name>${g.hotel ? pm(`${t('Your hotel')}: ${g.hotel.name}`, g.hotel.addr, g.hotel) : ''}${g.spots.map(x => pm(x.name, x.addr, x)).join('')}</Folder>`).join('')}</Document></kml>`;
}
function hotelBarHTML(cfg, art) {
  const ss = hotelStops(cfg); const i = art._stop || 0; const h = hotelsNow(cfg)[i]; const city = ss.length > 1 ? (ss[i].city || ss[i].name) : '';
  const lbl = city ? t('Your hotel in {c}', { c: city }) : t('Your hotel');
  if (h && !art._hotelEdit) return `<div class="hb"><img class="hb-ic" src="${HOTEL_PIN}" alt=""><div class="hb-t"><span class="lbl">${esc(lbl)}</span><b>${esc(h.name)}</b><small class="muted">${esc(h.lat == null ? t('Finding it on the map…') : h.src === 'booking' ? t('From your bookings') : h.src === 'host' ? t('From the itinerary') : h.addr || '')}</small></div><button type="button" class="btn sm" data-hotel-change>${t('Change')}</button></div>`;
  return `<form class="hb-set" onsubmit="return false"><label for="hb-q">${esc(t('Set your hotel'))}${city ? ` <small class="muted">${esc(city)}</small>` : ''}</label><div class="search"><input id="hb-q" data-hotel-q placeholder="${t('Search your hotel')}" autocomplete="off"><button type="submit" class="btn sm" data-hotel-find>${t('Find')}</button></div>${h && h.src === 'set' ? `<button type="button" class="link" data-hotel-clear>${t('Remove hotel')}</button>` : ''}${h ? `<button type="button" class="link" data-hotel-cancel>${t('Cancel')}</button>` : ''}<p class="hint" data-hotel-msg role="status" aria-live="polite"></p></form>`;
}
function wireHotel(cfg, art, mapCtl) {
  const bar = art.querySelector('[data-slot="hotel"]'); const key = art.querySelector('[data-slot="map-key"]'); const ss = hotelStops(cfg);
  art._stop = art._stop || 0;
  art._hotelAt = (i) => { const h = hotelsNow(cfg)[i]; return h && h.lat != null ? h : null; };
  // the current city's hotel is where Nearby searches start and distances are measured from; true when that changed
  const center = () => { const h = art._hotelAt(art._stop), prev = art._hotelPt || null;
    if (h ? prev && prev.lat === h.lat && prev.lon === h.lon : !prev) return false;
    art._hotelPt = h; art._fromHotel = !!h; art._center = h ? { lat: h.lat, lon: h.lon } : ss[art._stop]; return true; };
  const ui = () => {
    const hs = hotelsNow(cfg);
    if (mapCtl) mapCtl.setHotels(hs.map((h, i) => h && h.lat != null ? { lat: h.lat, lon: h.lon, title: `${t('Your hotel')}: ${h.name}`, label: h.name, onClick: () => { art._stop = i; ui(); } } : null).filter(Boolean));
    if (bar) { bar.innerHTML = hotelBarHTML(cfg, art); const q = bar.querySelector('[data-hotel-q]'); if (q) placeAutocomplete(q, { bias: () => ss[art._stop], onPick: (id, tok) => gpVenue(id, tok).then(v => { art._hotelEdit = false; setHotel(cfg, art, art._stop, v); }).catch(() => toast(t('Couldn’t load that place right now.'))) }); }
    const cur = art._hotelAt(art._stop); const saved = planLoad(cfg).some(x => x.lat != null && !x.hotel);
    if (key) key.innerHTML = cur || saved ? `${cur ? `<span class="mk"><img src="${HOTEL_PIN}" alt="">${t('Your hotel')}</span>` : ''}${saved ? `<span class="mk"><img src="${STAR_PIN}" alt="">${t('Saved')}</span>` : ''}${cur ? `<button type="button" class="mk-go" data-hotel-go>${t('Hotel')}</button>` : ''}` : '';
    if (center()) { if (art._gpReload) art._gpReload(); const h = art._hotelPt; if (mapCtl) { if (h) mapCtl.center(h.lat, h.lon, 15); else if (ss[art._stop]) mapCtl.center(ss[art._stop].lat, ss[art._stop].lon, 13); } }
  };
  art._hotelUI = ui; ui();
  resolveHotels(cfg).then(n => { if (n && document.body.contains(art)) ui(); }).catch(() => {});
  const find = (q) => { const m = bar.querySelector('[data-hotel-msg]'); if (q.length < 2) return; if (m) m.textContent = t('Searching…');
    const s = ss[art._stop]; geocode(`${q}, ${s.city || s.name}`).then(xs => { const r = xs.find(x => x.lat != null && !(x.types || []).some(ty => ty === 'country' || ty === 'continent') && distM(x.lat, x.lon, s.lat, s.lon) < 80000); if (!r) { if (m) m.textContent = t('No match. Try the hotel name and street.'); return; } art._hotelEdit = false; setHotel(cfg, art, art._stop, { ...r, name: r.name || q }); })
      .catch(() => { if (m) m.textContent = navigator.onLine === false ? t('Offline') : t('Search is unavailable right now'); }); };
  if (bar) bar.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
    if ('hotelChange' in d) { art._hotelEdit = true; ui(); const q = bar.querySelector('[data-hotel-q]'); if (q) q.focus(); }
    if ('hotelCancel' in d) { art._hotelEdit = false; ui(); }
    if ('hotelClear' in d) { art._hotelEdit = false; setHotel(cfg, art, art._stop, null); }
    if ('hotelFind' in d) find((bar.querySelector('[data-hotel-q]') || {}).value.trim()); });
  if (key) key.addEventListener('click', (e) => { if (!e.target.closest('[data-hotel-go]')) return; const h = art._hotelAt(art._stop); if (h && mapCtl) mapCtl.centerOn(h.lat, h.lon, 16); });
  art.addEventListener('click', (e) => {
    const k = e.target.closest('[data-kml]'); if (!k) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([spotsKML(cfg)], { type: 'application/vnd.google-earth.kml+xml' }));
    a.download = (slug(cfg.title) || 'trip') + '-saved-spots.kml'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
}

// ================= one as-you-type place dropdown for every place field (Google Places Autocomplete, New) =================
// Bias only, never restrict: 'Grand Hyatt Cancun' is found from a Japan trip too. A session token ties the keystrokes
// and the final Place Details call into one billed session.
const AC_ICONS = {
  stay: '<path d="M3 18V8M3 14h18v4M21 18v-5a3 3 0 0 0-3-3h-7v4"/><circle cx="7" cy="11" r="1.6"/>',
  food: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M16 3c-2 1-3 3-3 6v3h3v9"/>',
  fly: '<path d="M2 16l20-6-2-2-7 2-5-6-2 1 3 6-5 2-2-2-1 1z"/>',
  rail: '<rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 11h12M9 20l-2 2M15 20l2 2M9 16l-1 4M15 16l1 4"/>',
  sight: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
  city: '<path d="M3 21V9l6-4v16M9 21V3h8v18M17 21v-8h4v8M12 7h2M12 11h2M12 15h2"/>',
  pin: '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
};
function acIcon(types) {
  const s = (types || []).join(' ');
  const k = /lodging|hotel/.test(s) ? 'stay' : /restaurant|food|cafe|bar|bakery|meal/.test(s) ? 'food' : /airport/.test(s) ? 'fly' : /train|transit|subway|station/.test(s) ? 'rail'
    : /tourist|museum|park|attraction|gallery|landmark/.test(s) ? 'sight' : /locality|political|administrative|country|sublocality/.test(s) ? 'city' : 'pin';
  return `<svg class="ac-ic" viewBox="0 0 24 24" aria-hidden="true">${AC_ICONS[k]}</svg>`;
}
const newSession = () => (crypto.randomUUID ? crypto.randomUUID() : 'ep-' + Date.now() + Math.random().toString(36).slice(2));
// input: the text field. opts: { bias: () => ({lat, lon}) | null, onPick(placeId, session), onText?(query) }. Returns false without Google.
function placeAutocomplete(input, opts) {
  if (!input || !GKEY || gpBroken || input._ac) return false; input._ac = true;
  let wrap = input.parentElement; if (!wrap.classList.contains('ac-wrap')) { wrap = document.createElement('div'); wrap.className = 'ac-wrap'; input.replaceWith(wrap); wrap.appendChild(input); }
  const ul = document.createElement('ul'); ul.className = 'gp-sugg'; ul.setAttribute('role', 'listbox'); ul.hidden = true; ul.id = 'ac-' + Math.random().toString(36).slice(2, 8); wrap.appendChild(ul);
  input.setAttribute('autocomplete', 'off'); input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-controls', ul.id);
  let session = '', seq = 0, first = null;
  const close = () => { ul.hidden = true; input.setAttribute('aria-expanded', 'false'); };
  const run = debounce(() => {
    const q = input.value.trim(); const my = ++seq; if (q.length < 2 || document.activeElement !== input) { close(); return; }
    if (!session) session = newSession();
    const b = opts.bias && opts.bias(); const body = { input: q, sessionToken: session };
    if (b && b.lat != null) body.locationBias = { circle: { center: { latitude: b.lat, longitude: b.lon }, radius: 50000 } };
    gFetch('https://places.googleapis.com/v1/places:autocomplete', body, 'suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.types')
      .then(j => {
        if (my !== seq || document.activeElement !== input) return;
        const xs = (j.suggestions || []).map(x => x.placePrediction).filter(Boolean).slice(0, 6); first = xs[0] || null;
        const main = (x) => x.structuredFormat && x.structuredFormat.mainText ? x.structuredFormat.mainText.text : '';
        const sub = (x) => x.structuredFormat && x.structuredFormat.secondaryText ? x.structuredFormat.secondaryText.text : '';
        ul.innerHTML = xs.map(x => `<li role="option"><button type="button" data-ac-pick="${esc(x.placeId)}">${acIcon(x.types)}<span class="ac-t"><b>${esc(main(x))}</b><span>${esc(sub(x))}</span></span></button></li>`).join('')
          + (opts.onText ? `<li role="option"><button type="button" data-ac-text>${AC_ICONS.pin ? `<svg class="ac-ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>` : ''}<span class="ac-t"><b>${esc(t('Search for “{q}”', { q }))}</b></span></button></li>` : '')
          + `<li class="ac-by" aria-hidden="true">Google</li>`;
        ul.hidden = !xs.length && !opts.onText; input.setAttribute('aria-expanded', String(!ul.hidden));
      }).catch(() => close());
  }, 250);
  const pick = (id) => { close(); const tok = session; session = ''; opts.onPick(id, tok); };
  input.addEventListener('input', run);
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) run(); });
  input.addEventListener('blur', () => setTimeout(close, 250));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (opts.onText) { close(); seq++; opts.onText(input.value.trim()); } else if (first && !ul.hidden) pick(first.placeId); }
  }, true);
  ul.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the field while choosing
  ul.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; e.stopPropagation(); if (b.dataset.acPick) pick(b.dataset.acPick); else if ('acText' in b.dataset) { close(); seq++; opts.onText && opts.onText(input.value.trim()); } });
  return true;
}
// a Google place as a 1LinkTrip venue
function gpVenue(id, session) {
  return gFetch(`https://places.googleapis.com/v1/places/${enc(id)}${session ? '?sessionToken=' + enc(session) : ''}`, null, 'id,displayName,formattedAddress,location,addressComponents,types').then(gpToVenue);
}
// free-text address / venue search → the same shape the OpenStreetMap geocoder returns
function gGeocode(q) {
  const key = 'gg1:' + q.trim().toLowerCase(); if (memo.has(key)) return memo.get(key);
  const p = gFetch('https://places.googleapis.com/v1/places:searchText', { textQuery: q, pageSize: 6 }, 'places.id,places.displayName,places.formattedAddress,places.location,places.addressComponents,places.types')
    .then(j => (j.places || []).filter(x => x.location).map(x => { const r = gpToVenue(x); r.types = x.types || []; r.display = r.address && r.address !== r.name ? `${r.name}, ${r.address}` : r.address; return r; }));
  memo.set(key, p); p.catch(() => memo.delete(key)); return p;
}
// hotels, sights and stations near a point, in the shape osmNearby returns (no restaurants: the Google list covers food)
const GN_MASK = 'places.id,places.displayName,places.location,places.types,places.accessibilityOptions,places.rating,places.userRatingCount,places.googleMapsUri';
const GN_SIGHT = [['museum', 'museum'], ['art_gallery', 'gallery'], ['zoo', 'zoo'], ['aquarium', 'aquarium'], ['amusement_park', 'theme park']];
function gNearbyAll(lat, lon) {
  const key = 'gn1:' + osmKey(lat, lon); const c = LS.get(key); if (c && Date.now() - c.t < G_TTL) return Promise.resolve(c.d);
  if (memo.has(key)) return memo.get(key);
  const q = (types, radius, near) => gFetch('https://places.googleapis.com/v1/places:searchNearby', { includedTypes: types, maxResultCount: 20, ...(near ? { rankPreference: 'DISTANCE' } : {}), locationRestriction: { circle: { center: { latitude: lat, longitude: lon }, radius } } }, GN_MASK)
    .then(j => (j.places || []).filter(x => x.location && x.displayName && x.displayName.text).map(x => {
      const la = x.location.latitude, lo = x.location.longitude, name = x.displayName.text, ac = x.accessibilityOptions || {};
      return { name, lat: la, lon: lo, d: distM(lat, lon, la, lo), types: x.types || [], website: '', street: '', city: '', wheelchair: ac.wheelchairAccessibleEntrance ? 'yes' : '',
        g: { gid: x.id, name, lat: la, lon: lo, rating: x.rating || 0, count: x.userRatingCount || 0, price: '', url: x.googleMapsUri || '' } };
    }));
  const dedupe = (arr, n) => { const seen = new Set(); return arr.filter(x => { const k = x.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, n); };
  const has = (x, ty) => x.types.includes(ty);
  const p = Promise.all([q(['lodging'], 2500), q(['tourist_attraction', 'museum', 'art_gallery', 'zoo', 'aquarium', 'amusement_park'], 3000), q(['subway_station', 'train_station', 'light_rail_station', 'ferry_terminal'], 1500, true), q(['bus_stop', 'bus_station'], 400, true)])
    .then(([ho, si, ra, bu]) => {
      const hotels = dedupe(ho.map(x => ({ ...x, kind: has(x, 'hostel') ? 'hostel' : has(x, 'motel') ? 'motel' : has(x, 'bed_and_breakfast') || has(x, 'guest_house') ? 'guest house' : 'hotel', stars: '' })).sort((a, b) => a.d - b.d), 30);
      const known = si.filter(x => x.g.count >= 20);
      const sights = dedupe((known.length >= 4 ? known : si).map(x => ({ ...x, kind: (GN_SIGHT.find(([ty]) => has(x, ty)) || [, 'attraction'])[1] })), 12);
      const near = (arr) => arr.sort((a, b) => a.d - b.d);
      const transit = { subway: [], rail: [], tram: [], bus: [], bike: [], ferry: [] };
      near(ra).forEach(x => transit[has(x, 'subway_station') ? 'subway' : has(x, 'light_rail_station') ? 'tram' : has(x, 'ferry_terminal') ? 'ferry' : 'rail'].push({ ...x, line: '' }));
      near(bu).forEach(x => transit.bus.push({ ...x, line: '' }));
      for (const k in transit) transit[k] = dedupe(transit[k], k === 'bus' ? 4 : 3);
      const d = { food: [], places: [], hotels, sights, transit, src: 'google' }; LS.set(key, { t: Date.now(), d }); return d;
    });
  memo.set(key, p); p.catch(() => memo.delete(key)); return p;
}
function gpToVenue(x) {
    const ac = x.addressComponents || []; const get = (ty, short) => { const c = ac.find(a => (a.types || []).includes(ty)); return c ? (short ? c.shortText : c.longText) : ''; };
    const name = (x.displayName && x.displayName.text) || '';
    const city = get('locality') || get('postal_town') || get('administrative_area_level_2') || get('sublocality') || ((x.types || []).some(t => /locality|administrative_area/.test(t)) ? name : '');
    return { name, address: x.formattedAddress || name, lat: +(+x.location.latitude).toFixed(5), lon: +(+x.location.longitude).toFixed(5), city, region: get('administrative_area_level_1'), country: get('country'), cc: (get('country', true) || '').toLowerCase(), gid: x.id };
}

// ================= AI import (Supabase Edge Function 'ai-import'; hidden until it answers) =================
let aiReadyP = null;
function aiReady() {
  if (!SB) return Promise.resolve(false);
  const c = LS.get('aiReady'); if (c && Date.now() - c.t < (c.ok ? 3600e3 : 300e3)) return Promise.resolve(c.ok);
  // a plain GET (no preflight): 200 or 401 (deployed, sign-in required) means it exists; 404 means not deployed yet
  return aiReadyP || (aiReadyP = fetchTimeout(`${SB.url}/functions/v1/ai-import`, {}, 8000)
    .then(r => r.status === 200 || r.status === 401).catch(() => false).then(ok => { LS.set('aiReady', { t: Date.now(), ok }); return ok; }));
}
async function aiImport(body) {
  const c = await sb(); const { data } = await c.auth.getSession(); const tok = data && data.session && data.session.access_token;
  if (!tok) { const e = new Error('signin'); e.signin = true; throw e; }
  const r = await fetchTimeout(`${SB.url}/functions/v1/ai-import`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, apikey: SB.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 90000);
  let j = null; try { j = await r.json(); } catch { /* not JSON */ }
  if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || 'Import failed (' + r.status + ')');
  return j;
}
const isoDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? s : '';
// A trip date that falls outside the trip (wrong year, or month and day swapped) is moved to the reading that fits;
// strict: an import with no fitting reading gives '' (Unscheduled); otherwise the date is kept as written.
const realDay = (d) => { try { return ymd(asUTC(d)) === d; } catch { return false; } };
function fitTripDate(start, end, d, strict = true) {
  if (!d || !start || !isoDay(start.slice(0, 10))) return d || '';
  const s = start.slice(0, 10), e = (isoDay((end || '').slice(0, 10)) || s), lo = addDays(s, -3), hi = addDays(e, 3);
  if (d >= lo && d <= hi) return d;
  const [y, m, dd] = d.split('-'); const ys = [...new Set([s.slice(0, 4), e.slice(0, 4), y])]; const c = [];
  ys.forEach(yy => { c.push(`${yy}-${m}-${dd}`); if (+dd <= 12) c.push(`${yy}-${dd}-${m}`); });
  return c.find(x => realDay(x) && x >= lo && x <= hi) || (strict ? '' : d);
}
const isoTime = (s) => /^\d{2}:\d{2}$/.test(s || '') ? s : '';
const httpsUrl = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; } };
// the function's event JSON → a 1LinkTrip config (venue resolved separately)
function aiEventToCfg(d) {
  const type = TYPES.includes(d.type) ? d.type : 'Party'; const c = blankEvent(type);
  c.title = cleanText(d.title, 80); c.tagline = cleanText(d.tagline, 140); c.host = cleanText(d.host, 120);
  c.description = String(d.description || '').replace(/<[^>]*>/g, '').slice(0, 3000).trim();
  const sd = isoDay(d.start_date); if (sd) c.start = sd + (isoTime(d.start_time) ? 'T' + d.start_time : '');
  const ed = isoDay(d.end_date); if (ed && ed >= c.start.slice(0, 10)) c.end = ed + (isoTime(d.end_time) && hasTime(c.start) ? 'T' + d.end_time : '');
  const trip = d.type === 'Trip';
  c.schedule = (d.schedule || []).slice(0, 80).map(x => ({ date: trip ? fitTripDate(c.start, c.end, isoDay(x.date)) : isoDay(x.date) || c.start.slice(0, 10), time: isoTime(x.time), title: cleanText(x.title, 120), note: cleanText(x.note, 200), ...(PLAN_KINDS[x.kind] ? { kind: x.kind } : {}) })).filter(x => x.title);
  c.notes = (d.faqs || []).slice(0, 30).map(x => ({ label: cleanText(x.question, 120), text: cleanText(x.answer, 600), url: '' })).filter(x => x.label)
    .concat((d.links || []).slice(0, 20).map(x => ({ label: cleanText(x.label, 80), text: '', url: httpsUrl(x.url) })).filter(x => x.label && x.url));
  const w = {}; const hb = (d.hotel_blocks || [])[0];
  if (type === 'Wedding') {
    if (httpsUrl(d.rsvp_url)) w.rsvp = httpsUrl(d.rsvp_url); if (isoDay(d.rsvp_by)) w.rsvpBy = d.rsvp_by; if (d.dress_code) w.dress = cleanText(d.dress_code, 140);
    if (hb) { w.blockHotel = cleanText(hb.hotel, 120); if (httpsUrl(hb.url)) w.blockUrl = httpsUrl(hb.url); if (hb.code) w.blockCode = cleanText(hb.code, 40); if (isoDay(hb.book_by)) w.blockBy = hb.book_by; }
    c.x.Wedding = w;
  } else {
    if (hb) c.notes.unshift({ label: 'Room block: ' + cleanText(hb.hotel, 100), text: [hb.code ? 'Code ' + cleanText(hb.code, 40) : '', isoDay(hb.book_by) ? 'Book by ' + hb.book_by : ''].filter(Boolean).join(' · '), url: httpsUrl(hb.url) });
    if (d.dress_code) c.notes.push({ label: 'Dress code', text: cleanText(d.dress_code, 140), url: '' });
    if (httpsUrl(d.rsvp_url)) c.notes.push({ label: 'RSVP', text: isoDay(d.rsvp_by) ? 'Reply by ' + d.rsvp_by : '', url: httpsUrl(d.rsvp_url) });
  }
  // type-specific sections (newer function versions send these; older ones don't, which is fine)
  const D = d.details || {}; const X = (c.x[type] = c.x[type] || {}); const tx = (v, n = 300) => cleanText(v, n);
  const dt = (v) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v || '') ? v : isoDay(v) ? v : '';
  if (type === 'Race') {
    if (D.start_place) X.startAt = { q: tx(D.start_place, 160) }; if (D.finish_place) X.finishAt = { q: tx(D.finish_place, 160) };
    if (D.packet_pickup) X.packet = tx(D.packet_pickup); if (dt(D.packet_pickup_when)) X.packetWhen = dt(D.packet_pickup_when);
    if (httpsUrl(D.course_map_url)) X.course = httpsUrl(D.course_map_url);
    if ((D.spectator_spots || []).length) X.spots = D.spectator_spots.slice(0, 12).map(x => tx(x, 120)).filter(Boolean).join('\n');
    if (D.road_closures) X.closures = tx(D.road_closures, 500); if (httpsUrl(D.road_closures_url)) X.closuresUrl = httpsUrl(D.road_closures_url);
  } else if (type === 'Concert') {
    if (isoTime(D.doors)) X.doors = D.doors; if (D.opener) X.opener = tx(D.opener, 80); if (isoTime(D.opener_at)) X.openerAt = D.opener_at;
    if (D.headliner) X.headliner = tx(D.headliner, 80); if (isoTime(D.headliner_at)) X.headlinerAt = D.headliner_at; if (httpsUrl(D.setlist_url)) X.setlist = httpsUrl(D.setlist_url);
    if (D.bag_policy) X.bags = tx(D.bag_policy); if (D.parking) X.parking = tx(D.parking); if (D.rideshare_pickup) X.pickup = tx(D.rideshare_pickup, 160);
  } else if (type === 'Performance') {
    if (D.performer) X.performer = tx(D.performer, 120); if (isoTime(D.doors)) X.doors = D.doors; if (isoTime(D.showtime)) X.showtime = D.showtime;
    if (isoTime(D.call_time)) X.callTime = D.call_time; if (D.performer_slot) X.slot = tx(D.performer_slot, 160);
    if (httpsUrl(D.program_url)) X.program = httpsUrl(D.program_url); if (httpsUrl(D.tickets_url)) X.tickets = httpsUrl(D.tickets_url);
    if (D.flowers_gifts) X.flowers = tx(D.flowers_gifts); if (D.photo_policy) X.photo = tx(D.photo_policy); if (D.parking) X.parking = tx(D.parking);
    if (D.bag_policy) c.notes.push({ label: 'Bag policy', text: tx(D.bag_policy), url: '' });
  } else if (type === 'Hyrox') {
    if (D.division) X.division = tx(D.division, 120); if (isoTime(D.wave_start)) X.wave = D.wave_start;
    if (D.checkin) X.checkin = tx(D.checkin); if (dt(D.checkin_when)) X.checkinWhen = dt(D.checkin_when);
    if (D.bag_drop) X.bagdrop = tx(D.bag_drop); if (D.spectator_info) X.spectators = tx(D.spectator_info, 500);
    if (httpsUrl(D.results_url)) X.results = httpsUrl(D.results_url); if (D.parking) X.parking = tx(D.parking);
    if (D.bag_policy) c.notes.push({ label: 'Bag policy', text: tx(D.bag_policy), url: '' });
  } else if (type === 'Sporting event') {
    if (httpsUrl(D.seating_url)) X.seating = httpsUrl(D.seating_url); const tm = (D.teams || []).map(x => ({ label: tx(x.label, 60), url: httpsUrl(x.url) })).filter(x => x.label && x.url); if (tm.length) X.teams = tm;
    if (D.tailgate) X.tailgate = tx(D.tailgate); if (D.parking) X.parking = tx(D.parking); if (D.bag_policy) X.bags = tx(D.bag_policy);
  } else if (type === 'Conference') {
    if (D.badge_pickup) X.badge = tx(D.badge_pickup); if (dt(D.badge_pickup_when)) X.badgeWhen = dt(D.badge_pickup_when); if (httpsUrl(D.agenda_url)) X.agenda = httpsUrl(D.agenda_url);
    if ((D.speakers || []).length) X.speakers = D.speakers.slice(0, 40).map(x => tx(x, 120)).filter(Boolean).join('\n');
  } else if (type === 'Wedding') {
    const rg = (D.registry || []).map(x => ({ label: tx(x.label, 60), url: httpsUrl(x.url) })).filter(x => x.label && x.url); if (rg.length) X.registry = rg;
  }
  if (!['Race', 'Concert', 'Sporting event', 'Conference', 'Performance', 'Hyrox'].includes(type)) { // other types: parking and bag rules as notes
    if (D.parking) c.notes.push({ label: 'Parking', text: tx(D.parking), url: '' }); if (D.bag_policy) c.notes.push({ label: 'Bag policy', text: tx(D.bag_policy), url: '' });
  }
  (d.extras || []).slice(0, 20).forEach(x => { const label = tx(x.label, 80); if (label) c.notes.push({ label, text: tx(x.text, 600), url: httpsUrl(x.url) }); });
  return c;
}
// start/finish and pickup places get map pins when they can be found
async function aiPinPlaces(cfg) {
  const X = cfg.x[cfg.type] || {}; const v = cfg.venue; const near = v ? [v.city, v.country].filter(Boolean).join(', ') : '';
  for (const k of ['startAt', 'finishAt']) {
    if (!X[k] || !X[k].q || X[k].lat != null) continue;
    const r = await aiResolveVenue(X[k].q, near).catch(() => null);
    if (r && (!v || distM(v.lat, v.lon, r.lat, r.lon) < 60000)) { X[k].lat = r.lat; X[k].lon = r.lon; }
  }
}
async function aiResolveVenue(name, address) {
  const q = [name, address].filter(Boolean).join(', '); if (!q) return null;
  if (GKEY && !gpBroken) {
    try {
      const j = await gFetch('https://places.googleapis.com/v1/places:searchText', { textQuery: q, maxResultCount: 1 }, 'places.id');
      const id = j.places && j.places[0] && j.places[0].id; if (id) { const v = await gpVenue(id); if (name) v.name = cleanText(name, 120) || v.name; return v; }
    } catch { /* fall back to OpenStreetMap */ }
  }
  try { const r = (await osmGeocode(q))[0]; return r ? { name: cleanText(name, 120) || r.name, address: r.address, lat: r.lat, lon: r.lon, city: r.city, region: r.region, country: r.country, cc: r.cc } : null; } catch { return null; }
}
async function startFromWebsite(url, msgEl, type) {
  const say = (t2) => { if (msgEl) msgEl.textContent = t2; };
  say('Reading the site and filling in your page…');
  const j = await aiImport(type ? { url, type } : { url });
  // a category the organizer picked wins over the model's guess
  if (type && TYPES.includes(type)) { j.data = j.data || {}; if (j.data.type !== type) { j.data.type = type; } }
  const cfg = aiEventToCfg(j.data || {});
  if (!cfg.title) cfg.title = hostOf(url);
  say('Finding the venue…');
  const v = await aiResolveVenue(j.data.venue_name, j.data.venue_address);
  if (v) { cfg.venue = { name: v.name, address: v.address, lat: v.lat, lon: v.lon, city: v.city, region: v.region, country: v.country, cc: v.cc }; try { cfg.tz = await lookupTZ(v.lat, v.lon); } catch { /* floating */ } }
  say('Pinning the start, finish and other places…'); await aiPinPlaces(cfg).catch(() => {});
  const pid = newPid(); LS.set('draft', cfg); LS.set('draftHosted', null); LS.set('draftId', pid); pageSave(pid, { cfg });
  SU = null; history.replaceState(null, '', siteBase() + '#page=' + pid);
  renderBuilder(cfg, `Filled in from ${hostOf(url)}. Check every detail before you publish.`, null, pid);
}
function suAIHTML() {
  return `<div class="su-ai" data-su-ai hidden><button type="button" class="link strong" data-su="ai-open">✦ Start from a website</button>
    <div class="su-ai-form" hidden><p class="hint" data-su-ai-type></p>
      <div class="search"><input id="su-ai-url" type="url" inputmode="url" placeholder="https://yourwedding.com" autocomplete="off"><button type="button" class="btn primary" data-su="ai-go">Fill in</button></div>
      <p class="hint" data-su-ai-msg role="status" aria-live="polite"></p><div data-su-ai-signin></div></div></div>`;
}
function suAIHint() {
  const el = $('[data-su-ai-type]'); if (!el) return;
  const t = SU && SU.aiType && (SETUP_TYPES.find(x => x[0] === SU.aiType) || [])[1];
  el.innerHTML = t ? `Category: <b>${esc(t)}</b>` : '';
}
async function suAIGo() {
  const inp = $('#su-ai-url'); const msg = $('[data-su-ai-msg]'); const url = normSite(inp ? inp.value : '');
  if (!url) { msg.textContent = 'That doesn’t look like a website link.'; return; }
  const btn = $('[data-su="ai-go"]'); btn.disabled = true;
  try { await startFromWebsite(url, msg, SU && SU.aiType); }
  catch (e) {
    btn.disabled = false;
    if (e.signin) { LS.set('pendingAiUrl', url); LS.set('pendingAiType', (SU && SU.aiType) || ''); LS.set('afterSignIn', '#setup'); msg.textContent = 'Sign in first, so imports stay yours.'; $('[data-su-ai-signin]').innerHTML = signInFormHTML(''); return; }
    msg.textContent = e.message || 'Couldn’t read that site.';
  }
}
// "Read with AI" in the guest booking form: every reservation in a pasted confirmation becomes a booking
const AI_KIND = { flight: 'flight', hotel: 'hotel', stay: 'stay', car: 'car', train: 'train', food: 'food', tour: 'other', other: 'other' };
function aiItemsToBookings(items) {
  return (items || []).slice(0, 40).map(x => {
    const st = String(x.start || ''), en = String(x.end || '');
    const okDT = (s) => /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(s) ? s : '';
    return { kind: AI_KIND[x.type] || 'other', name: cleanText(x.name || x.provider, 120), start: okDT(st), end: okDT(en), address: cleanText(x.address, 200), confNo: cleanText(x.confirmation, 60),
      link: httpsUrl(x.link), flight: cleanText(x.flight_number, 12), to: AI_KIND[x.type] === 'flight' ? cleanText(x.to, 60) : '', note: cleanText([x.from && x.to ? `${x.from} → ${x.to}` : '', x.note].filter(Boolean).join(' · '), 300) };
  }).filter(x => x.name || x.start);
}

// ================= multi-city trips: a route of stops with dates =================
// cfg.stops = [{ name, address, lat, lon, city, region, country, cc, from, to }]. The first stop doubles as the venue
// when none is set. Old pages kept stops as plain lines in x.Trip.stops; those still render.
const stopsOf = (cfg) => Array.isArray(cfg.stops) ? cfg.stops.filter(s => s && s.name) : [];
const stopFor = (cfg, d) => stopsOf(cfg).find(s => s.from && s.to && d >= s.from && d < s.to) || stopsOf(cfg).filter(s => s.from && d >= s.from).slice(-1)[0] || null;
const stopRange = (s) => s.from ? (s.to && s.to !== s.from ? dateRange(s.from, s.to) : dateRange(s.from, s.from)) : '';
const CUR = { jp: '¥', gb: '£', ie: '€', fr: '€', de: '€', it: '€', es: '€', pt: '€', nl: '€', be: '€', at: '€', fi: '€', gr: '€', kr: '₩', in: '₹', cn: '¥', th: '฿', ch: 'CHF ', mx: '$' };
const priceSym = (cfg, p) => { const cc = (cfg.venue && cfg.venue.cc) || ''; const sym = CUR[cc]; return p && sym && sym !== '$' ? p.replace(/\$/g, sym.trim()) : p; };
function routeHTML(c) {
  const ss = Array.isArray(c.stops) ? c.stops : [];
  return `<ol class="route-ed">${ss.map((s, i) => `<li class="rowed">
      ${s.name ? `<div class="venue-sel"><div><b>${esc(s.name)}</b><span>${esc([s.region, s.country].filter(Boolean).join(', '))}</span></div><button type="button" class="btn sm" data-st-clear="${i}">Change</button></div>`
        : `<div class="field"><label for="st-q-${i}">City or place</label><div class="search"><input id="st-q-${i}" data-st-q="${i}" placeholder="Kyoto" autocomplete="off"><button type="button" class="btn" data-st-find="${i}">Find</button></div></div>`}
      <div class="two"><div class="field"><label for="st-from-${i}">Arrive</label><input id="st-from-${i}" type="date" data-st="${i}" data-k="from" value="${esc(s.from || '')}"></div><div class="field"><label for="st-to-${i}">Leave</label><input id="st-to-${i}" type="date" data-st="${i}" data-k="to" value="${esc(s.to || '')}"></div></div>
      <div class="plan-ctl"><span class="mv"><button type="button" data-st-mv="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button type="button" data-st-mv="${i}" data-dir="1" ${i === ss.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button></span><button type="button" class="link" data-st-del="${i}">Remove</button></div>
    </li>`).join('')}</ol>
    <button type="button" class="btn sm" data-st-add>+ Add a stop</button>`;
}
function setStop(cfg, i, v) {
  const prev = cfg.stops[i] || {};
  cfg.stops[i] = { name: v.name, address: v.address, lat: v.lat, lon: v.lon, city: v.city || v.name, region: v.region, country: v.country, cc: v.cc, from: prev.from || '', to: prev.to || '' };
  if (!cfg.venue && i === 0) { cfg.venue = { name: v.name, address: v.address, lat: v.lat, lon: v.lon, city: v.city || v.name, region: v.region, country: v.country, cc: v.cc }; lookupTZ(v.lat, v.lon).then(tz => { cfg.tz = tz; changed(); }).catch(() => {}); }
  changed(true);
}
function routeClick(b, cfg) {
  const d = b.dataset; if (!('stAdd' in d || d.stDel || d.stMv || d.stClear || d.stFind)) return false;
  cfg.stops = Array.isArray(cfg.stops) ? cfg.stops : [];
  if ('stAdd' in d) { const last = cfg.stops[cfg.stops.length - 1]; const from = last && last.to ? last.to : cfg.start.slice(0, 10); cfg.stops.push({ name: '', from, to: '' }); changed(true); setTimeout(() => $(`#st-q-${cfg.stops.length - 1}`)?.focus(), 40); }
  if (d.stDel) { cfg.stops.splice(+d.stDel, 1); changed(true); }
  if (d.stMv) { const i = +d.stMv, j = i + +d.dir; if (j >= 0 && j < cfg.stops.length) { [cfg.stops[i], cfg.stops[j]] = [cfg.stops[j], cfg.stops[i]]; changed(true); } }
  if (d.stClear) { const s = cfg.stops[+d.stClear]; cfg.stops[+d.stClear] = { name: '', from: s.from, to: s.to }; changed(true); }
  if (d.stFind) { const i = +d.stFind; const q = ($(`#st-q-${i}`) || {}).value || ''; if (q.trim().length < 2) return true;
    geocode(q.trim()).then(rs => { const cc = tripCC(cfg); const ok = rs.filter(x => !(x.types || []).some(ty => ty === 'country' || ty === 'continent')); const r = ok.find(x => !cc || !x.cc || x.cc === cc) || ok[0] || rs[0]; if (!r) { toast('No match. Try adding the country.'); return; } setStop(cfg, i, r); }).catch(() => toast('Search is unavailable right now')); }
  return true;
}
function routeInput(i, cfg) {
  if (i.dataset.st == null) return false;
  const s = cfg.stops[+i.dataset.st]; if (!s) return true; s[i.dataset.k] = i.value;
  if (i.dataset.k === 'from' && s.to && s.to < s.from) s.to = '';
  changed(); return true;
}
function wireRouteAC(cfg) {
  $$('#sheet [data-st-q]').forEach(inp => placeAutocomplete(inp, { bias: () => cfg.venue, onPick: (id, tok) => gpVenue(id, tok).then(v => setStop(cfg, +inp.dataset.stQ, v)).catch(() => toast('Couldn’t load that place')) }));
}
// guest page: the route
function routeGuestHTML(cfg) {
  const ss = stopsOf(cfg);
  if (ss.length < 2) { const lines = String((typeData(cfg) || {}).stops || '').split('\n').map(x => x.trim()).filter(Boolean); return lines.length && !ss.length ? '' : ''; }
  return `<ol class="route">${ss.map((s, i) => `<li><button type="button" class="route-stop" data-route-stop="${i}"><span class="route-n">${i + 1}</span><span><b>${esc(s.name)}</b><small>${esc(stopRange(s))}</small></span></button></li>`).join('')}</ol>`;
}
function routeTrainsHTML(cfg) {
  const ss = stopsOf(cfg); if (ss.length < 2) return '';
  const jp = ss.some(s => s.cc === 'jp');
  const legs = ss.slice(1).map((s, i) => [ss[i], s]);
  return `<h3 class="sub-h">${t('Between stops')}</h3><div class="row-links">${legs.map(([a, b]) => ext(`https://www.google.com/maps/dir/?api=1&origin=${a.lat},${a.lon}&destination=${b.lat},${b.lon}&travelmode=transit`, `${esc(a.name)} → ${esc(b.name)}${b.from ? ` <small>${esc(fmt(b.from, { month: 'short', day: 'numeric' }))} · Google Maps</small>` : ' <small>Google Maps</small>'}`, 'row-link')).join('')}
    ${jp ? `${ext('https://smart-ex.jp/en/', `${t('Shinkansen tickets (Tokaido, Sanyo, Kyushu)')} <small>SmartEX</small>`, 'row-link')}${ext('https://japanrailpass.net/en/', `${t('Japan Rail Pass')} <small>JR Group</small>`, 'row-link')}` : ''}</div>`;
}
function routeStaysHTML(cfg) {
  const ss = stopsOf(cfg); if (ss.length < 2) return '';
  const n = tripDates(cfg).guests || 2;
  return `<h3 class="sub-h">${t('Stays along the route')}</h3><div class="row-links">${ss.filter(s => s.from && s.to && s.to > s.from).map(s => { const q = [s.city || s.name, s.country].filter(Boolean).join(', '); const p = { q, d1: s.from, d2: s.to, n };
    return bookExt('hotels', 'ghotels', p, `${esc(t('Hotels in {c}', { c: s.name }))} <small>${esc(dateRange(s.from, s.to))} · Google Hotels</small>`) + bookExt('hotels', 'booking', p, `${esc(t('Hotels and apartments'))} · ${esc(s.name)} <small>Booking.com</small>`); }).join('')}</div>`;
}

// ================= personal itinerary ↔ account (trip_items; quiet no-op until schema-2 is installed) =================
const syncKey = (cfg) => eventKey(cfg).slice(6);
const syncOff = () => { const o = LS.get('syncOff'); return o && Date.now() - o < 3600e3; };
const tableMissing = (e) => e && (e.code === 'PGRST205' || e.code === '42P01' || /does not exist|schema cache/i.test(e.message || ''));
function withIds(cfg) { // bookings had no ids before sync existed
  const xs = itinLoad(cfg); let ch = false; xs.forEach(x => { if (!x.id) { x.id = 'bk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); ch = true; } }); if (ch) LS.set(itinKey(cfg), xs); return xs;
}
async function syncUser() { if (!SB || !LS.get('signedIn') || syncOff()) return null; try { return await sbUser(); } catch { return null; } }
const syncPush = debounce(async (cfg) => {
  const u = await syncUser(); if (!u) return; const c = await sb(); const key = syncKey(cfg);
  const rows = withIds(cfg).map(x => ({ id: x.id, page_key: key, kind: 'booking', item: x, updated_at: new Date().toISOString() }))
    .concat(planLoad(cfg).map(x => ({ id: x.id, page_key: key, kind: 'place', item: x, updated_at: new Date().toISOString() })))
    .concat(shopLoad(cfg).map(x => ({ id: x.id, page_key: key, kind: 'place', item: { ...x, shop: true }, updated_at: new Date().toISOString() })));
  if (rows.length) { const { error } = await c.from('trip_items').upsert(rows, { onConflict: 'owner,id' }); if (tableMissing(error)) { LS.set('syncOff', Date.now()); return; } }
  let q = c.from('trip_items').delete().eq('page_key', key); if (rows.length) q = q.not('id', 'in', `(${rows.map(r => '"' + r.id.replace(/"/g, '') + '"').join(',')})`);
  await q;
}, 800);
async function syncPull(cfg, art) {
  const u = await syncUser(); if (!u) return; const c = await sb(); const key = syncKey(cfg);
  const { data, error } = await c.from('trip_items').select('id,page_key,kind,item,source').in('page_key', [key, 'inbox']);
  if (error) { if (tableMissing(error)) LS.set('syncOff', Date.now()); return; }
  const mine = (data || []).filter(r => r.page_key === key); const inbox = (data || []).filter(r => r.page_key === 'inbox');
  const bk = withIds(cfg), pl = planLoad(cfg), sh = shopLoad(cfg); const have = new Set(bk.map(x => x.id).concat(pl.map(x => x.id), sh.map(x => x.id))); let added = 0;
  mine.forEach(r => { if (have.has(r.id) || !r.item) return; if (r.kind === 'place' && r.item.shop) { const { shop, ...x } = r.item; sh.push({ ...x, id: r.id }); } else if (r.kind === 'place') pl.push({ ...r.item, id: r.id }); else bk.push({ ...r.item, id: r.id }); added++; });
  if (added) { LS.set(shopKey(cfg), sh); art._shop && art._shop(); LS.set(itinKey(cfg), bk); planSave(cfg, pl); art._planChanged && art._planChanged(); const s2 = art.querySelector('#sec-itinerary .sec-b'); if (s2) s2.innerHTML = bookingsHTML(cfg); art._renderSchedule && art._renderSchedule(); }
  if (added || !mine.length) syncPush(cfg); // first sync uploads what this device already had
  const slot = art.querySelector('#sec-plan .sec-b');
  if (inbox.length && slot) {
    slot.insertAdjacentHTML('afterbegin', `<div class="inbox-note"><b>${esc(t('{n} forwarded bookings', { n: inbox.length }))}</b> <button type="button" class="btn sm" data-inbox-add>${t('Add to this trip')}</button></div>`);
    slot.querySelector('[data-inbox-add]').onclick = async (e) => {
      e.target.disabled = true; const xs = withIds(cfg); inbox.forEach(r => xs.push({ ...r.item, id: r.id }));
      LS.set(itinKey(cfg), xs); await c.from('trip_items').update({ page_key: key }).in('id', inbox.map(r => r.id));
      art._planChanged && art._planChanged(); const s2 = art.querySelector('#sec-itinerary .sec-b'); if (s2) s2.innerHTML = bookingsHTML(cfg); art._renderSchedule && art._renderSchedule(); toast(t('Added {n} bookings', { n: inbox.length }));
    };
  }
}

// ================= book with the company itself: hotel chains, airlines, rental-car brands =================
// Templates verified on WebKit/iPhone (Nov 2026). Brands that only accept their homepage get the homepage.
// Order everywhere: the brand's own deep link → the place's own website → an aggregator as the last resort.
const slug = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const mdy = (d) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
const HOTEL_BRANDS = [
  ['marriott', 'Marriott', /marriott|westin|sheraton|ritz[- ]carlton|st\.? regis|courtyard|fairfield|residence inn|springhill|aloft|moxy|m[eé]ridien|renaissance|four points|\bac hotel|autograph collection|delta hotels|element by|tribute portfolio|luxury collection|\bedition\b|\bw (hotel|[a-z]+$)/i],
  ['hilton', 'Hilton', /hilton|doubletree|hampton|conrad|waldorf|embassy suites|homewood|home2|curio|canopy by|tapestry|signia|\blxr\b|motto by|tempo by/i],
  ['ihg', 'IHG', /intercontinental|holiday inn|crowne plaza|kimpton|hotel indigo|staybridge|candlewood|even hotels?|\bvoco\b|regent|six senses|vignette collection/i],
  ['accor', 'Accor', /novotel|\bibis\b|sofitel|mercure|pullman|fairmont|swiss[oô]tel|m[oö]venpick|mgallery|raffles|adagio|mama shelter|25hours|banyan tree/i],
  ['choice', 'Choice Hotels', /comfort inn|comfort suites|quality inn|clarion|sleep inn|econo lodge|rodeway|cambria|ascend|mainstay|suburban studios|everhome/i],
  ['hyatt', 'Hyatt', /hyatt|andaz|alila|thompson hotel|zoetry|secrets |dreams |breathless|zilara|ziva|miraval/i],
  ['wyndham', 'Wyndham', /wyndham|ramada|days inn|super 8|la quinta|baymont|microtel|tryp|wingate|hawthorn|trademark collection/i],
  ['bestwestern', 'Best Western', /best western|sure hotel|aiden by/i],
];
const hotelBrand = (name) => (HOTEL_BRANDS.find(([, , re]) => re.test(name || '')) || [])[0] || '';
Object.assign(PROVIDERS, {
  marriott: { name: 'Marriott', kinds: ['hotels'], mode: 'link', url: (p) => `https://www.marriott.com/search/findHotels.mi?destinationAddress.destination=${enc(p.q)}&fromDate=${mdy(p.d1)}&toDate=${mdy(p.d2)}&roomCount=1&numAdultsPerRoom=${p.n || 2}` },
  hilton: { name: 'Hilton', kinds: ['hotels'], mode: 'link', url: (p) => `https://www.hilton.com/en/search/?query=${enc(p.q)}&arrivalDate=${p.d1}&departureDate=${p.d2}&flexibleDates=false&numRooms=1&numAdults=${p.n || 2}&numChildren=0` },
  // IHG months are zero-based: March 2027 is 022027
  ihg: { name: 'IHG', kinds: ['hotels'], mode: 'link', url: (p) => { const my = (d) => pad(+d.slice(5, 7) - 1) + d.slice(0, 4); return `https://www.ihg.com/hotels/us/en/find-hotels/hotel/list?qDest=${enc(p.q)}&qCiD=${+p.d1.slice(8, 10)}&qCiMy=${my(p.d1)}&qCoD=${+p.d2.slice(8, 10)}&qCoMy=${my(p.d2)}&qAdlt=${p.n || 2}&qChld=0&qRms=1&qRtP=6CBARC&qSrt=sBR`; } },
  accor: { name: 'Accor', kinds: ['hotels'], mode: 'link', url: (p) => `https://all.accor.com/booking/en/accor/hotels/${slug(p.city)}-${slug(p.country)}?dateIn=${p.d1}&nights=${Math.max(1, daysBetween(p.d1, p.d2))}&compositions=${p.n || 2}&stayplus=false&snu=false` },
  choice: { name: 'Choice Hotels', kinds: ['hotels'], mode: 'link', url: (p) => `https://www.choicehotels.com/${slug(p.country)}/${slug(p.city)}/hotels?checkInDate=${p.d1}&checkOutDate=${p.d2}&adults=${p.n || 2}` },
  hyatt: { name: 'Hyatt', kinds: ['hotels'], mode: 'link', url: () => 'https://www.hyatt.com/' },
  wyndham: { name: 'Wyndham', kinds: ['hotels'], mode: 'link', url: () => 'https://www.wyndhamhotels.com/' },
  bestwestern: { name: 'Best Western', kinds: ['hotels'], mode: 'link', url: () => 'https://www.bestwestern.com/' },
});
// the booking action for a hotel: brand deep link, else the hotel's website, else Booking.com
function hotelBookAction(cfg, h) {
  const tr = tripDates(cfg); const v = cfg.venue || {}; const b = hotelBrand(h.name);
  const p = { q: [h.name, h.city || v.city || '', v.country || ''].filter(Boolean).join(', '), city: h.city || v.city || '', country: v.country || '', d1: tr.arrive, d2: tr.leave, n: tr.guests || 2 };
  if (b && (b !== 'accor' && b !== 'choice' || (p.city && p.country))) return { url: bookingLink('hotels', b, b === 'marriott' || b === 'hilton' || b === 'ihg' ? { ...p, q: p.city ? `${p.city}${p.country ? ', ' + p.country : ''}` : p.q } : p).url, label: t('Book with {b}', { b: PROVIDERS[b].name }) };
  if (h.web || h.website) { const w = h.web || h.website; return { url: w, label: t('Book direct · {h}', { h: hostOf(w) }) }; }
  return { url: bookingLink('hotels', 'booking', { q: p.q, d1: p.d1, d2: p.d2, n: p.n }).url, label: t('Check rates') + ' · Booking.com' };
}
// airlines: route + dates where the airline's site accepts them, otherwise its booking homepage
const AIRLINE_BOOK = {
  UA: ['United', (o, d, a, b, n) => `https://www.united.com/en/us/fsr/choose-flights?f=${o}&t=${d}&d=${a}&r=${b}&tt=RT&sc=7,7&px=${n}&taxng=1&clm=7&st=bestmatches`],
  AS: ['Alaska', (o, d, a, b, n) => `https://www.alaskaair.com/search/results?A=${n}&O=${o}&D=${d}&OD=${a}&DD=${b}&RT=true`],
  BA: ['British Airways', (o, d, a, b, n) => `https://www.britishairways.com/nx/b/airselect/en/usa/book/search?trip=round&departureDate=${a}&arrivalDate=${b}&from=${o}&to=${d}&travelClass=economy&adults=${n}&children=0&infants=0&youngAdults=0`],
  DL: ['Delta', (o, d, a, b, n) => `https://www.delta.com/flight-search/book-a-flight?tripType=ROUND_TRIP&originCity=${o}&destinationCity=${d}&departureDate=${a}&returnDate=${b}&paxCount=${n}`],
  AA: ['American', () => 'https://www.aa.com/homePage.do'], B6: ['JetBlue', () => 'https://www.jetblue.com/'], WN: ['Southwest', () => 'https://www.southwest.com/'],
  AC: ['Air Canada', () => 'https://www.aircanada.com/us/en/aco/home.html'], KL: ['KLM', () => 'https://www.klm.com/'], AF: ['Air France', () => 'https://wwws.airfrance.us/'],
  LH: ['Lufthansa', () => 'https://www.lufthansa.com/us/en/homepage'], JL: ['JAL', () => 'https://www.jal.co.jp/flights/en-us/'], NH: ['ANA', () => 'https://www.ana.co.jp/en/us/'],
  EK: ['Emirates', () => 'https://www.emirates.com/us/english/'], QF: ['Qantas', () => 'https://www.qantas.com/us/en.html'],
};
function airlinePickHTML(cfg, air, ap = chosenAirport(cfg, air)) {
  const o = LS.get('origin'); if (!air.length) return '';
  const cur = LS.get('airline') || '';
  const tr = tripDates(cfg); const n = tr.guests || 1;
  const link = cur && AIRLINE_BOOK[cur] && ap ? [ap].map(a => { const [name, fn] = AIRLINE_BOOK[cur]; return ext(fn(o || '', a.iata, tr.arrive, tr.leave, n), `${esc(t('Book with {b}', { b: name }))}${o ? ` <small>${esc(o)} → ${esc(a.iata)}</small>` : ''}`, 'row-link'); }).join('') : '';
  return `<div class="airline-pick"><label class="pf-sel"><span>${t('Booking with a specific airline?')}</span><select data-airline><option value="">${t('Choose an airline')}</option>${Object.entries(AIRLINE_BOOK).map(([k, [name]]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>${link ? `<div class="row-links">${link}</div>` : ''}</div>`;
}
// rental counters at the arrival airport (Google), each to its own brand site
const CAR_BRANDS = [['avis', 'Avis', /\bavis\b/i], ['budget', 'Budget', /\bbudget\b/i], ['hertz', 'Hertz', /\bhertz\b/i], ['enterprise', 'Enterprise', /enterprise/i], ['national', 'National', /\bnational\b/i], ['alamo', 'Alamo', /\balamo\b/i], ['sixt', 'Sixt', /\bsixt\b/i], ['thrifty', 'Thrifty', /thrifty/i], ['dollar', 'Dollar', /\bdollar\b/i], ['europcar', 'Europcar', /europcar/i]];
const CAR_HOME = { avis: 'https://www.avis.com/', budget: 'https://www.budget.com/', hertz: 'https://www.hertz.com/', enterprise: 'https://www.enterprise.com/', national: 'https://www.nationalcar.com/', alamo: 'https://www.alamo.com/', sixt: 'https://www.sixt.com/', thrifty: 'https://www.thrifty.com/', dollar: 'https://www.dollar.com/', europcar: 'https://www.europcar.com/' };
function carBrandURL(brand, ap) { // Avis and Budget airport pages prefill the pickup location
  const city = ap && ap.city ? slug(ap.city) : ''; const cc = ap && ap.cc ? String(ap.cc).toLowerCase() : '';
  // verified for airports outside the US (US location pages use a different path), so US airports get the homepage
  if ((brand === 'avis' || brand === 'budget') && city && cc && cc !== 'us' && ap.iata) return `https://www.${brand}.com/en/locations/${cc}/${city}/${ap.iata.toLowerCase()}`;
  return CAR_HOME[brand];
}
function gpCars(cfg, ap) {
  const key = `gcar1:${ap.iata}`; const c = LS.get(key); if (c && Date.now() - c.t < 7 * 864e5) return Promise.resolve(c.d);
  return gFetch('https://places.googleapis.com/v1/places:searchNearby', { includedTypes: ['car_rental'], maxResultCount: 20, locationRestriction: { circle: { center: { latitude: ap.lat, longitude: ap.lon }, radius: 4000 } } }, 'places.id,places.displayName,places.websiteUri,places.rating,places.userRatingCount')
    .then(j => { const seen = new Set(); const d = (j.places || []).map(x => { const name = (x.displayName && x.displayName.text) || ''; const b = (CAR_BRANDS.find(([, , re]) => re.test(name)) || [])[0] || ''; return { id: x.id, name, brand: b, web: x.websiteUri || '', rating: x.rating || 0, count: x.userRatingCount || 0 }; })
      .filter(x => { const k = x.brand || x.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8); LS.set(key, { t: Date.now(), d }); return d; });
}
// counters at the arrival airport and in town around the venue, each with rating, open now and distance
const GCAR_MASK = 'places.id,places.displayName,places.websiteUri,places.rating,places.userRatingCount,places.location,places.currentOpeningHours.openNow,places.shortFormattedAddress,places.googleMapsUri';
function gpCarsNear(lat, lon, radius, key) {
  const c = LS.get(key); if (c && Date.now() - c.t < 3 * 864e5) return Promise.resolve(c.d);
  return gFetch('https://places.googleapis.com/v1/places:searchNearby', { includedTypes: ['car_rental'], maxResultCount: 20, rankPreference: 'DISTANCE', locationRestriction: { circle: { center: { latitude: lat, longitude: lon }, radius } } }, GCAR_MASK)
    .then(j => { const d = (j.places || []).filter(x => x.location).map(x => { const name = (x.displayName && x.displayName.text) || ''; return { id: x.id, name, brand: (CAR_BRANDS.find(([, , re]) => re.test(name)) || [])[0] || '', web: x.websiteUri || '', rating: x.rating || 0, count: x.userRatingCount || 0,
      open: x.currentOpeningHours ? !!x.currentOpeningHours.openNow : null, addr: x.shortFormattedAddress || '', maps: x.googleMapsUri || '', d: Math.round(distM(lat, lon, x.location.latitude, x.location.longitude)) }; }); LS.set(key, { t: Date.now(), d }); return d; });
}
function gpCarsAll(cfg, ap) {
  const v = cfg.venue; const far = !ap || ap.d > 3000;
  return Promise.all([ap ? gpCarsNear(ap.lat, ap.lon, 4000, `gcar2:${ap.iata}`).then(xs => xs.map(x => ({ ...x, where: 'airport' }))) : Promise.resolve([]),
    far ? gpCarsNear(v.lat, v.lon, 8000, `gcar2:${osmKey(v.lat, v.lon)}`).then(xs => xs.map(x => ({ ...x, where: 'town' }))).catch(() => []) : Promise.resolve([])])
    .then(([a, b]) => { const ids = new Set(a.map(x => x.id)); return a.concat(b.filter(x => !ids.has(x.id))); });
}
function carRowURL(r, ap) { const deep = r.brand && carBrandURL(r.brand, ap); const own = r.web && r.brand && hostOf(r.web).replace(/^www\./, '').endsWith(r.brand + '.com') ? r.web.replace(/[?#].*$/, '') : '';
  return r.brand ? (ap && r.where === 'airport' && deep !== CAR_HOME[r.brand] ? deep : own || deep) : r.web || r.maps; }
function carCountersHTML(cfg, ap, rows, art) {
  if (art) {
    art._lf = art._lf || {}; const prev = art._lf.cars; const hasA = rows.some(r => r.where === 'airport'), hasT = rows.some(r => r.where === 'town');
    const f = prev ? prev.f : { q: '', where: hasA ? 'airport' : 'town', open: false, sort: 'dist' }; if (f.where === 'airport' && !hasA) f.where = 'town'; if (f.where === 'town' && !hasT) f.where = 'airport';
    const v = cfg.venue; const hasRating = rows.some(r => r.rating), hasOpen = rows.some(r => r.open != null);
    const x = art._lf.cars = { f,
      on: (id) => id === 'open' ? f.open : id === f.where,
      chip: (id) => { if (id === 'open') f.open = !f.open; else f.where = id; },
      clear: () => { f.q = ''; f.open = false; f.sort = 'dist'; },
      list: () => {
        const xs = lfSort(rows.filter(r => (!hasA || !hasT || r.where === f.where) && (!f.q || lfMatch(f.q, r.name, r.brand)) && (!f.open || r.open === true)), f.sort);
        const active = !!(f.q || f.open);
        return `${lfCount(xs.length, active)}${xs.length ? `<ul class="plist rich cars">${xs.map(r => { const url = carRowURL(r, ap); const nm = r.brand ? (CAR_BRANDS.find(b => b[0] === r.brand) || [])[1] : r.name;
          return `<li><div><b>${url ? ext(url, esc(nm), '') : esc(nm)}</b>${r.rating ? `<span class="rt">${gRatingHTML(r)}</span>` : ''}${r.brand && nm !== r.name ? `<span>${esc(r.name)}</span>` : r.addr ? `<span>${esc(r.addr)}</span>` : ''}${r.open != null ? `<span class="tags">${r.open ? `<em class="open">${t('Open now')}</em>` : `<em class="closed">${t('Closed now')}</em>`}</span>` : ''}</div>
            <span class="dist">${esc(fmtDist(r.d, v.cc))}<small>${esc(r.where === 'airport' && ap ? t('from {a}', { a: ap.iata }) : t('from the venue'))}</small></span></li>`; }).join('')}</ul>` : `<p class="muted">${t('Nothing matches these filters.')} <button type="button" class="link" data-lf-clear>${t('Clear filters')}</button></p>`}
          <p class="muted small g-attr">${t('Places and ratings from Google')}</p>`;
      } };
    lfWire(art);
    const chips = [...(hasA && hasT ? [['airport', t('At the airport'), f.where === 'airport'], ['town', t('In town'), f.where === 'town']] : []), ...(hasOpen ? [['open', t('Open now'), f.open]] : [])];
    return `<h3 class="sub-h">${esc(hasA && !hasT && ap ? t('Rental counters at {a}', { a: ap.iata }) : t('Rental counters'))}</h3><div data-lf-box="cars">${lfBarHTML('cars', f, { ph: t('Search companies'), chips, sorts: hasRating ? [['dist', t('Distance')], ['rating', t('Rating')]] : [] })}<div data-lf-list>${x.list()}</div></div>`;
  }
  rows = rows.filter(r => r.where !== 'town');
  return `<h3 class="sub-h">${esc(t('Rental counters at {a}', { a: ap.iata }))}</h3><div class="row-links">${rows.map(r => { const deep = r.brand && carBrandURL(r.brand, ap); const own = r.web && r.brand && hostOf(r.web).replace(/^www\./, '').endsWith(r.brand + '.com') ? r.web.replace(/[?#].*$/, '') : '';
    const url = r.brand ? (deep !== CAR_HOME[r.brand] ? deep : own || deep) : r.web; if (!url) return ''; // no prefilled page: the counter's own listing page
    return ext(url, `${esc(r.brand ? (CAR_BRANDS.find(b => b[0] === r.brand) || [])[1] : r.name)}${r.rating ? ` <small>★ ${r.rating.toFixed(1)}</small>` : ` <small>${esc(hostOf(url))}</small>`}`, 'row-link'); }).join('')}</div>`;
}

// ================= "Ask AI to edit" (ai-import mode:"edit"; shown only when the deployed function lists it) =================
async function aiModes() {
  const c = LS.get('aiModes'); if (c && c.m && c.m.length && Date.now() - c.t < 3600e3) return c.m; // only cache a non-empty answer, so a fresh redeploy shows up on reload
  if (!SB || !LS.get('signedIn')) return [];
  try {
    const cl = await sb(); const { data } = await cl.auth.getSession(); const tok = data && data.session && data.session.access_token; if (!tok) return [];
    const r = await fetchTimeout(`${SB.url}/functions/v1/ai-import`, { headers: { Authorization: 'Bearer ' + tok, apikey: SB.key } }, 8000);
    const j = r.ok ? await r.json() : null; const m = j && Array.isArray(j.modes) ? j.modes : [];
    LS.set('aiModes', { t: Date.now(), m }); return m;
  } catch { return []; }
}
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v), isTime = (v) => v === '' || /^\d{2}:\d{2}$/.test(v), isWhen = (v) => /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(v);
const strOk = (n) => (v) => typeof v === 'string' && v.length <= n;
// allowed paths → value check (and normalizer). Anything else is rejected.
function editRule(cfg, path) {
  let m;
  if ((m = path.match(/^(title|tagline|host|bring|cover)$/))) return { ok: strOk(m[1] === 'bring' ? 2000 : m[1] === 'cover' ? 800 : 140), label: m[1] };
  if (path === 'description') return { ok: strOk(5000), label: 'About' };
  if (path === 'start') return { ok: (v) => typeof v === 'string' && isWhen(v), label: 'Starts' };
  if (path === 'end') return { ok: (v) => typeof v === 'string' && (v === '' || isWhen(v)), label: 'Ends' };
  if (path === 'type') return { ok: (v) => TYPES.includes(v), label: 'Event type' };
  if (path === 'venue.name') return { ok: (v) => !!cfg.venue && strOk(140)(v), label: 'Venue name' };
  if (path === 'theme.accent') return { ok: (v) => /^#[0-9a-f]{6}$/i.test(v), label: 'Color' };
  if (path === 'theme.mode') return { ok: (v) => v === 'light' || v === 'dark', label: 'Background' };
  if (path === 'theme.font') return { ok: (v) => !!FONTS[v], label: 'Title font' };
  if ((m = path.match(/^tools\.(\w+)$/)) && TOOLS.some(x => x[0] === m[1])) return { ok: (v) => typeof v === 'boolean', label: 'Show ' + m[1] };
  if ((m = path.match(/^off\.(about|schedule|details|notes|rsvp|access|route|c-[\w-]+)$/))) return { ok: (v) => typeof v === 'boolean', label: 'Hide ' + m[1] };
  if ((m = path.match(/^schedule\[(\d+)\]\.(date|time|title|note|kind)$/)) && cfg.schedule[+m[1]]) return { ok: m[2] === 'date' ? (v) => isDate(v) : m[2] === 'time' ? (v) => typeof v === 'string' && isTime(v) : m[2] === 'kind' ? (v) => ['activity', 'reservation', 'note'].includes(v) : strOk(200), label: `${schedTitle(cfg)} · ${cfg.schedule[+m[1]].title || 'item ' + (+m[1] + 1)} · ${m[2]}` };
  if (path === 'schedule[]') return { add: true, ok: (v) => v && typeof v === 'object' && strOk(200)(v.title || '') && !!v.title && (!v.date || isDate(v.date)) && isTime(v.time || ''), fix: (v) => ({ date: v.date || (isTrip(cfg) ? '' : cfg.start.slice(0, 10)), time: v.time || '', title: cleanText(v.title, 200), note: cleanText(v.note || '', 200), ...(PLAN_KINDS[v.kind] ? { kind: v.kind } : {}) }), label: `${schedTitle(cfg)} · new item` };
  if ((m = path.match(/^schedule\[(\d+)\]$/)) && cfg.schedule[+m[1]]) return { remove: true, label: `${schedTitle(cfg)} · ${cfg.schedule[+m[1]].title}` };
  if ((m = path.match(/^notes\[(\d+)\]\.(label|text|url)$/)) && cfg.notes[+m[1]]) return { ok: m[2] === 'url' ? (v) => v === '' || !!httpsUrl(v) : strOk(600), label: `Notes · ${cfg.notes[+m[1]].label} · ${m[2]}` };
  if (path === 'notes[]') return { add: true, ok: (v) => v && typeof v === 'object' && !!v.label && strOk(120)(v.label), fix: (v) => ({ label: cleanText(v.label, 120), text: cleanText(v.text || '', 600), url: httpsUrl(v.url || '') }), label: 'Notes · new' };
  if ((m = path.match(/^notes\[(\d+)\]$/)) && cfg.notes[+m[1]]) return { remove: true, label: `Notes · ${cfg.notes[+m[1]].label}` };
  if ((m = path.match(/^x\.([A-Za-z ]+)\.(\w+)$/)) && m[1] === cfg.type) {
    const f = (typeSpec(cfg) || { fields: [] }).fields.find(x => x[0] === m[2]); if (!f) return null;
    const kind = f[2]; const ok = kind === 'links' ? (v) => Array.isArray(v) && v.every(l => l && strOk(80)(l.label) && httpsUrl(l.url)) : kind === 'place' ? (v) => v && typeof v === 'object' && strOk(160)(v.q || '') : kind === 'date' ? (v) => isDate(v) : kind === 'time' ? (v) => isTime(v) : kind === 'datetime' ? (v) => isWhen(v) : kind === 'url' ? (v) => v === '' || !!httpsUrl(v) : strOk(1000);
    return { ok: (v) => v === '' || ok(v), clear: true, label: f[1], fix: kind === 'place' ? (v) => v === '' ? '' : { q: cleanText(v.q, 160) } : null };
  }
  if ((m = path.match(/^stops\[(\d+)\]\.(from|to)$/)) && (cfg.stops || [])[+m[1]]) return { ok: (v) => v === '' || isDate(v), label: `Route · ${cfg.stops[+m[1]].name} · ${m[2] === 'from' ? 'arrive' : 'leave'}` };
  // a renamed city loses its map point; the page finds the new one by name
  if ((m = path.match(/^stops\[(\d+)\]\.name$/)) && (cfg.stops || [])[+m[1]]) return { ok: (v) => typeof v === 'string' && !!v.trim() && v.length <= 80, label: `Route · ${cfg.stops[+m[1]].name}`, after: (next, i = +m[1]) => { const s = next.stops[i]; ['lat', 'lon', 'address', 'city', 'region'].forEach(k => delete s[k]); } };
  if (path === 'stops[]') return { add: true, ok: (v) => v && typeof v === 'object' && typeof v.name === 'string' && !!v.name.trim() && (!v.from || isDate(v.from)) && (!v.to || isDate(v.to)), fix: (v) => ({ name: cleanText(v.name, 80), from: v.from || '', to: v.to || '' }), label: 'Route · new city' };
  if ((m = path.match(/^stops\[(\d+)\]$/)) && (cfg.stops || [])[+m[1]]) return { remove: true, label: `Route · ${cfg.stops[+m[1]].name}${stopRange(cfg.stops[+m[1]]) ? ' · ' + stopRange(cfg.stops[+m[1]]) : ''}` };
  if ((m = path.match(/^custom\[(\d+)\]\.(title|text|label|url|img)$/)) && (cfg.custom || [])[+m[1]]) return { ok: m[2] === 'url' || m[2] === 'img' ? (v) => v === '' || !!httpsUrl(v) : m[2] === 'text' ? strOk(3000) : strOk(120), fix: m[2] === 'text' ? (v) => cleanLong(v, 3000) : null, label: `${cfg.custom[+m[1]].title || 'Section'} · ${m[2]}` };
  if (path === 'custom[]') return { add: true, ok: (v) => v && typeof v === 'object' && !!(v.title || '').trim() && strOk(120)(v.title), fix: (v) => ({ ...blankCustom(), title: cleanText(v.title, 80), text: cleanLong(v.text || '', 3000) }), label: 'New section' };
  if ((m = path.match(/^custom\[(\d+)\]$/)) && (cfg.custom || [])[+m[1]]) return { remove: true, label: `Section · ${cfg.custom[+m[1]].title || 'untitled'}` };
  if ((m = path.match(/^files\[(\d+)\]$/)) && (cfg.files || [])[+m[1]]) return { remove: true, label: `Document · ${cfg.files[+m[1]].name}` };
  return null;
}
const showVal = (x) => x == null || x === '' ? '—' : typeof x === 'object' ? (Array.isArray(x) ? x.map(l => l.label).join(', ') : x.q || JSON.stringify(x)) : String(x).slice(0, 300);
function getPath(o, path) { return path.split(/\.|\[|\]/).filter(Boolean).reduce((a, k) => a == null ? undefined : a[k], o); }
function setPath(o, path, v) { const ks = path.split(/\.|\[|\]/).filter(Boolean); let a = o; ks.slice(0, -1).forEach(k => { if (a[k] == null) a[k] = {}; a = a[k]; }); a[ks[ks.length - 1]] = v; }
// validate the model's changes against the page; returns { next, rows, rejected }
function planEdits(cfg, changes) {
  const next = clone(cfg); const rows = [], rejected = []; const removals = [];
  for (const ch of (changes || []).slice(0, 40)) {
    const rule = editRule(cfg, String(ch.path || '')); let v;
    try { v = ch.value_json === '' || ch.value_json == null ? '' : JSON.parse(ch.value_json); } catch { rejected.push(ch.path); continue; }
    if (!rule) { rejected.push(ch.path); continue; }
    if (ch.op === 'remove' && !rule.remove && (rule.clear || /^(tagline|bring|cover|description)$/.test(ch.path))) { const before = getPath(cfg, ch.path); if (before == null || before === '') continue; setPath(next, ch.path, ''); rows.push({ label: rule.label, before: showVal(before), after: '', rm: true }); continue; }
    if (ch.op === 'remove') { if (!rule.remove) { rejected.push(ch.path); continue; } if (removals.includes(ch.path)) continue; removals.push(ch.path); rows.push({ label: rule.label, before: rule.label.split(' · ').slice(1).join(' · ') || rule.label, after: '', rm: true }); continue; }
    if (ch.op === 'add') { if (!rule.add || !rule.ok(v)) { rejected.push(ch.path); continue; } const val = rule.fix(v); const arr = ch.path.slice(0, -2); (next[arr] = next[arr] || []).push(val); rows.push({ label: rule.label, before: '—', after: [val.title, val.label, val.name, val.date, val.time, val.from, val.to, val.text, val.note].filter(Boolean).join(' · ').slice(0, 200) }); continue; }
    if (rule.add || rule.remove || !rule.ok(v)) { rejected.push(ch.path); continue; }
    const val = rule.fix ? rule.fix(v) : typeof v === 'string' ? (ch.path === 'description' || ch.path === 'bring' ? v.replace(/<[^>]*>/g, '') : cleanText(v, 1000)) : v;
    const before = getPath(cfg, ch.path); setPath(next, ch.path, val); if (rule.after) rule.after(next);
    rows.push({ label: rule.label, before: showVal(before), after: showVal(val) });
  }
  // remove from the end so indexes stay valid (per list)
  removals.map(p => p.match(/^(\w+)\[(\d+)\]$/)).sort((a, b) => +b[2] - +a[2]).forEach(m => next[m[1]].splice(+m[2], 1));
  if (next.files && !next.files.length) delete next.files;
  if (next.end && next.start && next.end.slice(0, 10) < next.start.slice(0, 10)) next.end = '';
  return { next: normalize(next), rows, rejected };
}
function aiEditHTML() {
  return `<div class="ai-edit" data-ai-edit hidden><label for="ai-edit-q">✦ Ask AI to edit</label>
    <div class="search"><textarea id="ai-edit-q" rows="2" maxlength="1000" placeholder="e.g. move the ceremony to 5pm"></textarea><button type="button" class="btn primary" data-ai-edit-go>Preview</button></div>
    <p class="hint" data-ai-edit-msg role="status" aria-live="polite"></p><div data-ai-edit-preview></div></div>`;
}
function wireAIEdit() {
  const box = $('[data-ai-edit]'); if (!box || box._wired) return; box._wired = true;
  aiModes().then(m => { if (m.includes('edit')) box.hidden = false; });
  const msg = box.querySelector('[data-ai-edit-msg]'), prev = box.querySelector('[data-ai-edit-preview]'); let pending = null;
  box.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if ('aiEditGo' in b.dataset) {
      const q = box.querySelector('#ai-edit-q').value.trim(); if (!q) { msg.textContent = 'Say what to change.'; return; }
      b.disabled = true; msg.textContent = 'Working out the changes…'; prev.innerHTML = '';
      try {
        const j = await aiImport({ mode: 'edit', page: B.cfg, instruction: q });
        const plan = planEdits(B.cfg, j.data && j.data.changes); pending = plan;
        if (!plan.rows.length) { msg.textContent = plan.rejected.length ? 'Those changes aren’t something the editor can apply. Try rephrasing.' : 'Nothing to change.'; return; }
        msg.textContent = (j.data.summary ? cleanText(j.data.summary, 200) + ' ' : '') + (plan.rejected.length ? `(${plan.rejected.length} change${plan.rejected.length > 1 ? 's' : ''} skipped)` : '');
        prev.innerHTML = `<ul class="ai-diff">${plan.rows.map(r => r.rm ? `<li class="rm"><b>${esc(r.label.split(' · ')[0])}</b><s class="was">${esc(r.before)}</s><span class="now rm-t">Removed</span></li>` : `<li><b>${esc(r.label)}</b><span class="was">${esc(r.before)}</span><span class="arr">→</span><span class="now">${esc(r.after)}</span></li>`).join('')}</ul><div class="btns"><button type="button" class="btn primary" data-ai-edit-apply>Apply</button><button type="button" class="btn ghost" data-ai-edit-cancel>Cancel</button></div>`;
      } catch (err) { msg.textContent = err.signin ? 'Sign in (My pages) to use AI edits.' : (err.message || 'Couldn’t do that.'); }
      finally { b.disabled = false; }
    }
    if ('aiEditCancel' in b.dataset) { pending = null; prev.innerHTML = ''; msg.textContent = ''; }
    if ('aiEditApply' in b.dataset && pending) {
      const before = clone(B.cfg); B.cfg = pending.next; pending = null; changed(true); renderHostNote();
      box.querySelector('#ai-edit-q').value = ''; msg.textContent = 'Applied.'; prev.innerHTML = '<button type="button" class="btn sm" data-ai-edit-undo>Undo</button>';
      box._undo = before;
    }
    if ('aiEditUndo' in b.dataset && box._undo) { B.cfg = box._undo; box._undo = null; changed(true); msg.textContent = 'Undone.'; prev.innerHTML = ''; }
  });
}

// ================= documents: "Upload a document" (fill a section from a PDF/photo via ai-import mode:"doc", or attach it for guests) =================
// cfg.files = [{ id, sec, name, url, type: 'pdf'|'image', size }]; sec = the card it was attached in ('route', 'schedule', 'notes', 'about',
// 'bring', 'access', a type card id like 'block') or a custom section ('c-<id>'). Files live in the public 'event-files' bucket under <user id>/.
const DOC_BUCKET = 'event-files';
const DOC_ACCEPT = 'application/pdf,.pdf,image/*';
const DOC_CARDS = ['route', 'schedule', 'notes', 'about', 'bring', 'access'];
const docCardOk = (c, id) => DOC_CARDS.includes(id) || /^c-/.test(id) || (TYPE_CARDS[c.type] || []).some(x => x[0] === id && id !== 'route');
function normFiles(xs) {
  const seen = new Set();
  return (Array.isArray(xs) ? xs : []).filter(x => x && typeof x === 'object').slice(0, 40).map((x, i) => {
    let id = typeof x.id === 'string' && /^[a-z0-9]{1,12}$/.test(x.id) ? x.id : 'f' + i; while (seen.has(id)) id += 'x'; seen.add(id);
    return { id, sec: typeof x.sec === 'string' && /^[a-z][\w-]{0,30}$/i.test(x.sec) ? x.sec : 'notes', name: cleanText(x.name, 120) || 'Document', url: httpsUrl(x.url), type: x.type === 'image' ? 'image' : 'pdf', size: Math.max(0, Math.round(+x.size || 0)) };
  }).filter(x => x.url);
}
// guest page: the documents attached to these cards, as a list with View / Download
const tl = (key, en) => LANG === 'en' ? en : t(key);
function docsHTML(cfg, secs) {
  const fs = (cfg.files || []).filter(f => secs.includes(f.sec)); if (!fs.length) return '';
  const dl = (f) => f.url + (f.url.includes('?') ? '&' : '?') + 'download=' + encodeURIComponent(f.name);
  return `<ul class="docs">${fs.map(f => `<li><a class="doc-main" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer"><span class="doc-ic" aria-hidden="true">${f.type === 'pdf' ? 'PDF' : 'IMG'}</span><b>${esc(f.name)}</b></a><span class="doc-a"><a class="mini-b" href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(tl('View document', 'View'))}</a><a class="mini-b" href="${esc(dl(f))}" download="${esc(f.name)}">${esc(t('Download'))}</a></span></li>`).join('')}</ul>`;
}
const bringInPacking = (cfg) => !!(cfg.start && cfg.tools.packing);
const detailDocSecs = (cfg) => ['notes', ...(TYPE_CARDS[cfg.type] || []).map(x => x[0]).filter(x => x !== 'route'), ...(bringInPacking(cfg) ? [] : ['bring'])];

// uploads: PDFs up to 10 MB as they are; photos re-encoded to a ~300 KB JPEG on the phone first
async function shrinkPhoto(f, max = 300e3, maxSide = 1600) {
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Use a PDF or a photo.')); i.src = url; });
    let side = Math.min(maxSide, Math.max(img.naturalWidth, img.naturalHeight)), q = 0.82, blob = null;
    for (let n = 0; n < 8; n++) {
      const k = side / Math.max(img.naturalWidth, img.naturalHeight); const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      blob = await new Promise(res => c.toBlob(res, 'image/jpeg', q)); if (blob.size <= max) break;
      if (q > 0.6) q -= 0.11; else side = Math.round(side * 0.8);
    }
    return blob;
  } finally { URL.revokeObjectURL(url); }
}
const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
async function docPrepare(f) {
  if (isPdf(f)) { if (f.size > 10 * 1024 * 1024) throw new Error('That PDF is too large (10 MB max).'); return { blob: f, type: 'application/pdf', name: f.name || 'Document.pdf', kind: 'pdf' }; }
  if (!/^image\//.test(f.type)) throw new Error('Use a PDF or a photo.');
  return { blob: await shrinkPhoto(f), type: 'image/jpeg', name: (f.name || 'Photo').replace(/\.\w+$/, '') + '.jpg', kind: 'image' };
}
async function docUpload(f, prepared) {
  const user = await myGuestUser(); if (!user) { const e = new Error('signin'); e.signin = true; throw e; }
  const p = prepared || await docPrepare(f); const id = Math.random().toString(36).slice(2, 8);
  const safe = p.name.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(-80) || 'document';
  const path = `${user.id}/${Date.now().toString(36)}-${id}-${safe}`;
  const c = await sb(); const { error } = await c.storage.from(DOC_BUCKET).upload(path, p.blob, { contentType: p.type, cacheControl: '31536000', upsert: false });
  if (error) throw new Error(error.message || 'Upload failed.');
  return { id, name: cleanText(f.name || p.name, 120), url: c.storage.from(DOC_BUCKET).getPublicUrl(path).data.publicUrl, type: p.kind, size: p.blob.size };
}
async function docRemoteDelete(f) { // best effort: only files under this user's own folder
  try { const user = await myGuestUser(); const pre = `${SB.url}/storage/v1/object/public/${DOC_BUCKET}/`; if (!user || !f.url.startsWith(pre)) return;
    const path = decodeURIComponent(f.url.slice(pre.length).split('?')[0]); if (!path.startsWith(user.id + '/')) return;
    if ((B.cfg.files || []).some(x => x.url === f.url)) return; // still used elsewhere on this page
    const c = await sb(); await c.storage.from(DOC_BUCKET).remove([path]); } catch { /* the page no longer links it */ }
}
const fileEntry = (f, sec) => ({ id: f.id, sec, name: f.name, url: f.url, type: f.type, size: f.size }); // same key order as normFiles
const fmtSize = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

// ---- photos: cover (Design) and a custom section's photo — Upload / drop / link ----
const PH_LIMIT = { cover: [500e3, 1600], cs: [300e3, 1600] };
let PH = null; // { key, phase: 'busy'|'signin', msg }
function photoCtlHTML(key, url, linkInput) {
  const st = PH && PH.key === key ? PH : null;
  return `<div class="ph-up" data-ph-key="${esc(key)}">${httpsUrl(url) ? `<img class="ph-img" src="${esc(url)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
    <div class="ph-drop" data-ph-drop><label class="btn sm file-pick${st && st.phase === 'busy' ? ' busy' : ''}">${httpsUrl(url) ? 'Replace photo' : 'Upload photo'}<input type="file" accept="image/*" data-ph-file hidden></label><span class="ph-or muted small">or drop a photo here</span>${httpsUrl(url) ? '<button type="button" class="link" data-ph-clear>Remove photo</button>' : ''}</div>
    ${linkInput}
    <p class="hint" data-ph-msg role="status" aria-live="polite">${esc(st && st.msg || '')}</p>${st && st.phase === 'signin' ? `<div class="bk-signin"><p><b>Sign in to upload photos.</b></p>${signInFormHTML('')}</div>` : ''}</div>`;
}
function phSet(key, url) { const c = B.cfg; if (key === 'cover') c.cover = url; else { const x = c.custom[+key.slice(3)]; if (x) x.img = url; } }
function phPaint(key) { const el = document.querySelector(`[data-ph-key="${CSS.escape(key)}"]`); if (!el) return; if (B.card) renderSheet(); else buildForm(); }
async function phUpload(key, file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) { PH = { key, msg: 'Use a photo (JPG, PNG, HEIC).' }; return phPaint(key); }
  if (!LS.get('signedIn')) { PH = { key, phase: 'signin' }; return phPaint(key); }
  PH = { key, phase: 'busy', msg: 'Uploading…' }; phPaint(key);
  try {
    const [max, side] = PH_LIMIT[key === 'cover' ? 'cover' : 'cs'];
    const blob = await shrinkPhoto(file, max, side);
    const f = await docUpload(file, { blob, type: 'image/jpeg', name: (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', kind: 'image' });
    phSet(key, f.url); PH = null; changed(true);
  } catch (e) { PH = e.signin ? { key, phase: 'signin' } : { key, msg: e.message || 'Upload failed.' }; phPaint(key); }
}
function wirePhotos(root) {
  if (!root || root._ph) return; root._ph = true;
  root.addEventListener('change', (e) => { const i = e.target; if (!i.matches || !i.matches('[data-ph-file]')) return; const box = i.closest('[data-ph-key]'); const f = i.files && i.files[0]; i.value = ''; if (box && f) phUpload(box.dataset.phKey, f); });
  root.addEventListener('click', (e) => {
    const box = e.target.closest('[data-ph-key]'); if (!box) return; const key = box.dataset.phKey;
    const sio = e.target.closest('[data-si-oauth]'); if (sio) { oauthSignIn(sio.dataset.siOauth); LS.set('afterSignIn', '#page=' + B.pid); return; }
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.si === 'send') { signInSubmit(box, () => LS.set('afterSignIn', '#page=' + B.pid)); return; }
    if ('phClear' in b.dataset) { phSet(key, ''); PH = null; changed(true); }
  });
  root.addEventListener('dragover', (e) => { const z = e.target.closest && e.target.closest('[data-ph-drop]'); if (!z) return; e.preventDefault(); z.classList.add('over'); });
  root.addEventListener('dragleave', (e) => { const z = e.target.closest && e.target.closest('[data-ph-drop]'); if (z) z.classList.remove('over'); });
  root.addEventListener('drop', (e) => { const z = e.target.closest && e.target.closest('[data-ph-drop]'); if (!z) return; e.preventDefault(); z.classList.remove('over'); const f = [...(e.dataTransfer && e.dataTransfer.files || [])].find(x => /^image\//.test(x.type)) || (e.dataTransfer && e.dataTransfer.files[0]); const box = z.closest('[data-ph-key]'); if (box && f) phUpload(box.dataset.phKey, f); });
}

// ---- reading a document into reviewable items ----
// item = { sec, key, title, text, date, time, end, url, kind, raw, target }; sec decides where it goes and can be changed in the review
const cleanLong = (s, n) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
const docScopeSection = (c, scope) => scope === 'auto' ? '' : /^c-|^new-custom$/.test(scope) ? 'custom' : DOC_CARDS.includes(scope) ? scope : 'details';
function docItems(cfg, d, scope) {
  d = d || {}; const out = []; const want = (s) => scope === 'auto' || scope === s;
  const add = (sec, o) => out.push({ sec, key: '', title: '', text: '', date: '', time: '', end: '', url: '', ...o });
  const C = aiEventToCfg({ ...d, type: cfg.type, start_date: isoDay(d.start_date) || cfg.start.slice(0, 10) });
  const stops = (Array.isArray(d.stops) ? d.stops : []).slice(0, 20).map(x => ({ title: cleanText(x && x.city, 80), country: cleanText(x && x.country, 60), date: isoDay(x && x.arrive), end: isoDay(x && x.leave) })).filter(x => x.title);
  const tripish = isTrip(cfg) || scope === 'route';
  if (scope === 'auto' && !cfg.title.trim() && C.title) add('basics', { key: 'title', title: C.title });
  if (want('route') || scope === 'auto') {
    let s = isoDay(d.start_date) ? C.start : (tripish && stops[0] ? stops[0].date : ''); let e = isoDay(d.end_date) ? C.end : (tripish && stops.length ? stops[stops.length - 1].end : '');
    if (tripish) { s = (s || '').slice(0, 10); e = (e || '').slice(0, 10); } // trips run by the day
    if (s && (s.slice(0, 10) !== cfg.start.slice(0, 10) || (e || '').slice(0, 10) !== (cfg.end || '').slice(0, 10))) add('basics', { key: 'dates', date: s, end: e && e.slice(0, 10) >= s.slice(0, 10) ? e : '' });
  }
  if (tripish && want('route')) stops.forEach(x => add('route', x));
  if (scope === 'auto' && !cfg.venue && !stops.length && cleanText(d.venue_name, 140)) add('basics', { key: 'venue', title: cleanText(d.venue_name, 140), text: cleanText(d.venue_address, 200) });
  if (want('schedule')) C.schedule.forEach(x => isTrip(cfg) && scope === 'auto' && !x.date ? add('notes', { title: x.title, text: x.note }) : add('schedule', { date: x.date, time: x.time, title: x.title, text: x.note, kind: x.kind || '' }));
  if (want('notes')) C.notes.forEach(x => add('notes', { title: x.label, text: x.text, url: x.url }));
  if (want('about')) { if (C.host) add('about', { key: 'host', text: C.host }); if (C.description) add('about', { text: cleanLong(d.description, 3000) || C.description }); }
  const tc = (TYPE_CARDS[cfg.type] || []).find(x => x[0] === scope); const sp = typeSpec(cfg);
  if (sp && (scope === 'auto' || tc)) {
    const X = C.x[cfg.type] || {};
    sp.fields.filter(f => (tc ? tc[3] : Object.keys(X)).includes(f[0]) && filled(f[2], X[f[0]])).forEach(f => {
      const v = X[f[0]]; add('field:' + f[0], { text: typeof v === 'string' ? v : v && v.q ? v.q : Array.isArray(v) ? v.map(l => `${l.label} ${l.url}`).join('\n') : '', raw: v, kind: f[2] });
    });
  }
  if (want('bring') && d.bring) { const lines = String(d.bring).split('\n').map(x => cleanText(x.replace(/^[-•*]\s*/, ''), 120)).filter(Boolean).slice(0, 40); if (lines.length) add('bring', { text: lines.join('\n') }); }
  if (want('access') && d.access && typeof d.access === 'object') ACCESS_FIELDS.forEach(([k]) => { const v = cleanText(d.access[k], 300); if (v) add('access:' + k, { text: v }); });
  const secs = (Array.isArray(d.sections) ? d.sections : []).map(x => ({ title: cleanText(x && x.title, 80), text: cleanLong(x && x.text, 3000) })).filter(x => x.title || x.text);
  if (/^c-|^new-custom$/.test(scope)) {
    const s0 = secs[0] || { title: cleanText(d.title, 80), text: cleanLong(d.description, 3000) || C.notes.map(n => [n.label, n.text].filter(Boolean).join(': ')).join('\n') };
    if (secs.length > 1) s0.text = secs.map(x => (x === s0 ? '' : x.title + '\n') + x.text).join('\n\n').slice(0, 3000);
    if (s0.title || s0.text) add('custom', { ...s0, target: scope === 'new-custom' ? '' : scope });
  } else if (scope === 'auto') secs.forEach(x => add('custom', x));
  return docTidy(cfg, out.filter(x => x.title || x.text || x.date)).slice(0, 120);
}
// fewer, cleaner items: exact/trivial duplicates merged; on a trip, a day's untimed activities become one item for that day
const normT = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function docTidy(cfg, xs) {
  const seen = new Map(); const out = [];
  xs.forEach(x => {
    const k = [x.sec, x.key, x.target || '', normT(x.title) || normT(x.text), /^(schedule|route)$/.test(x.sec) ? x.date : '', x.sec === 'schedule' ? x.time : ''].join('|'); const y = seen.get(k);
    if (y) { ['text', 'url', 'end', 'country'].forEach(f => { if (!y[f] && x[f]) y[f] = x[f]; }); return; }
    seen.set(k, x); out.push(x);
  });
  if (!isTrip(cfg)) return out;
  const byDay = {}; out.forEach(x => { if (x.sec === 'schedule' && x.date && !x.time && (!x.kind || x.kind === 'activity')) (byDay[x.date] = byDay[x.date] || []).push(x); });
  const gone = new Set();
  Object.values(byDay).forEach(g => {
    if (g.length < 2) return; const titles = g.map(x => x.title || String(x.text || '').split('\n')[0]).filter(Boolean); const all = titles.join(' · ');
    const h = g[0]; const notes = g.map(x => x.title && x.text ? `${x.title}: ${x.text}` : '');
    h.title = all.length <= 110 ? all : `${titles.slice(0, 2).join(' · ')} + ${titles.length - 2} more`;
    h.text = [all.length > 110 ? all : '', ...notes].filter(Boolean).join('\n');
    h.kind = g.some(x => x.kind === 'activity') ? 'activity' : ''; g.slice(1).forEach(x => gone.add(x));
  });
  return out.filter(x => !gone.has(x));
}
// where an item can go, and its label
function docSecLabel(c, sec, it) {
  if (sec === 'basics') return 'Basics';
  if (sec === 'route') return 'Route';
  if (sec === 'schedule') return isTrip(c) ? 'Itinerary' : 'Schedule';
  if (sec === 'notes') return 'Notes for guests';
  if (sec === 'about') return 'About';
  if (sec === 'bring') return 'Must-bring items';
  if (sec === 'custom') { const x = it && it.target && c.custom.find(y => customSid(y) === it.target); return x ? (x.title.trim() || 'Custom section') : 'New custom section'; }
  let m;
  if ((m = sec.match(/^field:(\w+)$/))) { const tc = (TYPE_CARDS[c.type] || []).find(x => x[3].includes(m[1])); const f = (typeSpec(c) || { fields: [] }).fields.find(x => x[0] === m[1]); const fl = f ? (EDIT_LABEL[m[1]] || f[1]) : m[1]; return tc && tc[3].length > 1 ? `${tc[1]} · ${fl}` : (tc ? tc[1] : fl); }
  if ((m = sec.match(/^access:(\w+)$/))) return 'Access · ' + ((ACCESS_FIELDS.find(x => x[0] === m[1]) || [])[1] || m[1]);
  return sec;
}
const docMoveTargets = (c, it, home) => {
  const base = [...(isTrip(c) ? ['route'] : []), 'schedule', 'notes', 'custom', 'about', 'bring'];
  return [...new Set([...(home && !base.includes(home) ? [home] : []), ...base])];
};
const docFields = (it) => {
  switch (it.sec) {
    case 'basics': return it.key === 'title' ? [['title', 'Title', 'text']] : it.key === 'dates' ? [['date', 'Starts', 'when'], ['end', 'Ends', 'when']] : [['title', 'Venue', 'text'], ['text', 'Address', 'text']];
    case 'route': return [['title', 'City or place', 'text'], ['date', 'Arrive', 'date'], ['end', 'Leave', 'date']];
    case 'schedule': return [['date', 'Date', 'date'], ['time', 'Time', 'time'], ['title', 'What', 'text'], ['text', 'Note', 'text']];
    case 'notes': return [['title', 'Title', 'text'], ['text', 'Text', 'long'], ['url', 'Link', 'url']];
    case 'custom': return [['title', 'Title', 'text'], ['text', 'Text', 'long']];
    case 'about': return [['text', it.key === 'host' ? 'Hosted by' : 'About', it.key === 'host' ? 'text' : 'long']];
    case 'bring': return [['text', 'One per line', 'long']];
    default: return [['text', '', it.kind === 'links' ? 'ro' : /lines/.test(it.kind || '') || (it.text || '').length > 80 ? 'long' : 'text']];
  }
};
const drGroupKey = (c, it) => it.sec === 'custom' ? 'custom:' + (it.target || '') : it.sec.startsWith('field:') ? 'field:' + (((TYPE_CARDS[c.type] || []).find(x => x[3].includes(it.sec.slice(6))) || [''])[0]) : it.sec.replace(/:.*$/, '');
const drLive = (c, st) => st.items.filter(x => !x.gone && !(st.off || {})[drGroupKey(c, x)]);
const drKeyLabel = (c, it) => it.key === 'dates' ? (isTrip(c) ? 'Trip dates' : 'Dates') : it.key === 'title' ? 'Title' : 'Venue';
function drGroupName(c, G, items) {
  const it = items[G.idx[0]];
  if (G.sec.startsWith('access:')) return 'Access and arrival';
  if (G.sec.startsWith('field:')) { const tc = (TYPE_CARDS[c.type] || []).find(x => x[3].includes(G.sec.slice(6))); return tc ? tc[1] : docSecLabel(c, G.sec, it); }
  if (G.sec === 'custom' && !it.target && G.idx.length > 1) return 'New custom sections';
  return docSecLabel(c, G.sec, it);
}
function drGroupCount(c, G, items) {
  const n = G.idx.length;
  if (G.sec === 'route') return n === 1 ? '1 city' : `${n} cities`;
  if (G.sec === 'schedule') return n === 1 ? '1 item' : `${n} items`;
  if (G.sec === 'basics') return G.idx.map(i => drKeyLabel(c, items[i]).toLowerCase()).join(', ');
  return String(n);
}
function drLine(c, it) {
  const one = (x) => String(x || '').split('\n')[0].trim().slice(0, 90);
  if (it.sec === 'basics') return `${drKeyLabel(c, it)}: ${it.key === 'dates' ? dateRange(it.date, it.end) : one(it.title)}`;
  if (it.sec === 'route') return [one(it.title), it.date ? dateRange(it.date, it.end || it.date) : ''].filter(Boolean).join(' · ');
  if (it.sec === 'schedule') return [it.date ? fmt(it.date, { month: 'short', day: 'numeric' }) : '', it.time ? fmtTime(it.time) : '', one(it.title || it.text)].filter(Boolean).join(' · ');
  if (it.sec === 'about' && it.key === 'host') return 'Hosted by ' + one(it.text);
  return one(it.title || it.text) || '—';
}
function docReviewHTML(c, items, st = {}) {
  const order = ['basics', 'route', 'schedule', 'notes', 'about', 'bring', 'custom'];
  const rank = (s) => { const i = order.indexOf(s); return i < 0 ? (s.startsWith('field:') ? 6.5 : 6.7) : i; };
  const groups = []; items.forEach((it, i) => { if (it.gone) return; const g = drGroupKey(c, it); let G = groups.find(x => x.g === g); if (!G) groups.push(G = { g, sec: it.sec, idx: [] }); G.idx.push(i); });
  groups.sort((a, b) => rank(a.sec) - rank(b.sec));
  const off = st.off || {}, open = st.open || {}, ed = st.edit == null ? -1 : st.edit;
  const n = items.filter(x => !x.gone && !off[drGroupKey(c, x)]).length;
  const fld = (it, i, [k, label, kind]) => {
    const id = `dr${i}-${k}`; const v = it[k] || ''; const lab = label ? `<label for="${id}">${esc(label)}</label>` : '';
    if (kind === 'ro') return `<div class="field wide"><p class="dr-ro">${esc(v)}</p></div>`;
    if (kind === 'long') return `<div class="field wide">${lab}<textarea id="${id}" data-dr="${i}" data-dk="${k}" rows="3"${label ? '' : ` aria-label="${esc(docSecLabel(c, it.sec, it))}"`}>${esc(v)}</textarea></div>`;
    const ty = kind === 'when' ? (isDate(v) || !v ? 'date' : 'datetime-local') : kind === 'url' ? 'url' : kind;
    return `<div class="field${kind === 'text' || kind === 'url' ? ' wide' : ''}">${lab}<input id="${id}" type="${ty}" data-dr="${i}" data-dk="${k}" value="${esc(v)}"${label ? '' : ` aria-label="${esc(docSecLabel(c, it.sec, it))}"`}></div>`;
  };
  const editHTML = (i) => { const it = items[i]; const tg = it.sec === 'basics' ? [] : docMoveTargets(c, it, it.home);
    return `<li class="dr-item" data-dr-at="${i}"><div class="dr-top">${tg.length ? `<select data-dr-sec="${i}" aria-label="Put it in">${tg.map(s => `<option value="${esc(s)}" ${s === it.sec ? 'selected' : ''}>${esc(docSecLabel(c, s, s === 'custom' && s === it.sec ? it : null))}</option>`).join('')}</select>` : `<span class="dr-k">${esc(drKeyLabel(c, it))}</span>`}<button type="button" class="ic del dr-x" data-dr-del="${i}" aria-label="Remove">×</button></div>
      <div class="dr-f">${docFields(it).map(f => fld(it, i, f)).join('')}</div><button type="button" class="link dr-done" data-dr-edit="-1">Done</button></li>`; };
  return `<div class="dr" data-sheet="doc-review"><p class="dr-lead">Found in your document. Untick anything you don't want, or tap a row to see it.</p>
    <div class="dr-gs">${groups.map(G => { const on = !off[G.g], op = !!open[G.g]; const name = drGroupName(c, G, items);
      return `<div class="dr-g${on ? '' : ' off'}${op ? ' open' : ''}" data-dr-g="${esc(G.g)}"><div class="dr-gh"><input type="checkbox" class="dr-on" data-dr-gon="${esc(G.g)}" ${on ? 'checked' : ''} aria-label="Add ${esc(name)}"><button type="button" class="dr-gt" data-dr-open="${esc(G.g)}" aria-expanded="${op}"><span class="dr-gn"><b>${esc(name)}</b> · ${esc(drGroupCount(c, G, items))}${G.sec === 'route' && stopsOf(c).length ? '<small class="muted">Replaces the current route</small>' : ''}</span><i class="dr-chev" aria-hidden="true"></i></button></div>
        ${op ? `<ul class="dr-lines">${G.idx.map(i => i === ed ? editHTML(i) : `<li><button type="button" class="dr-line" data-dr-edit="${i}">${esc(drLine(c, items[i]))}</button></li>`).join('')}</ul>` : ''}</div>`; }).join('')}</div>
    <div class="btns"><button type="button" class="btn primary" data-doc-apply ${n ? '' : 'disabled'}>${st.key && st.key !== 'main' ? 'Add' : 'Add to page'}</button><button type="button" class="btn ghost" data-doc-cancel>Cancel</button></div></div>`;
}
// apply the reviewed items to a copy of the page (async: route stops and the venue are looked up on the map)
async function docApply(cfg, items) {
  const next = clone(cfg); const live = items.filter(x => !x.gone); const xd = () => (next.x[next.type] = next.x[next.type] || {});
  const route = live.filter(x => x.sec === 'route' && cleanText(x.title, 80));
  if (route.length) {
    const cc0 = tripCC(next), co0 = (next.venue && next.venue.country) || '';
    next.stops = await Promise.all(route.map(async (x) => { const name = cleanText(x.title, 80); const r = await geocodeCity(name, x.country || co0, x.country ? '' : cc0).catch(() => null) || await aiResolveVenue(name, x.country || co0).catch(() => null);
      const s = { name, from: isoDay(x.date), to: isoDay(x.end) && (!isoDay(x.date) || x.end >= x.date) ? x.end : '' };
      return r && r.lat != null ? { name, address: r.address, lat: r.lat, lon: r.lon, city: r.city || name, region: r.region, country: r.country, cc: r.cc, from: s.from, to: s.to } : s; }));
    const f0 = next.stops.find(s => s.lat != null);
    if (!next.venue && f0) { next.venue = { name: f0.name, address: f0.address, lat: f0.lat, lon: f0.lon, city: f0.city, region: f0.region, country: f0.country, cc: f0.cc }; next.tz = await lookupTZ(f0.lat, f0.lon).catch(() => ''); }
  }
  for (const x of live) {
    const title = cleanText(x.title, 120), text = cleanLong(x.text, 3000), date = isoDay(x.date), time = isoTime(x.time); let m;
    if (x.sec === 'basics') {
      if (x.key === 'title' && title) next.title = title.slice(0, 80);
      if (x.key === 'dates') { const s = isWhen(x.date || '') ? x.date : ''; if (s) { next.start = s; next.end = isWhen(x.end || '') && x.end.slice(0, 10) >= s.slice(0, 10) ? x.end : ''; } }
      if (x.key === 'venue' && title && !next.venue) { const r = await aiResolveVenue(title, cleanText(x.text, 200)).catch(() => null); if (r) { next.venue = { name: r.name, address: r.address, lat: r.lat, lon: r.lon, city: r.city, region: r.region, country: r.country, cc: r.cc }; next.tz = await lookupTZ(r.lat, r.lon).catch(() => ''); } }
    } else if (x.sec === 'schedule') {
      const it = { date: isTrip(next) ? fitTripDate(next.start, next.end, date) : date || next.start.slice(0, 10), time, title: title || cleanText(text, 120), note: title ? cleanText(text, 200) : '', ...(PLAN_KINDS[x.kind] ? { kind: x.kind } : {}) };
      if (it.title && !next.schedule.some(y => y.date === it.date && y.time === it.time && y.title === it.title)) next.schedule.push(it);
    } else if (x.sec === 'notes') { const label = title || cleanText(text, 60); if (label && !next.notes.some(y => y.label === label && (y.text || '') === (title ? cleanText(text, 600) : ''))) next.notes.push({ label, text: title ? cleanText(text, 600) : '', url: httpsUrl(x.url || '') }); }
    else if (x.sec === 'custom') {
      const tgt = x.target && next.custom.find(y => customSid(y) === x.target);
      if (tgt) { if (title) tgt.title = title.slice(0, 80); if (text) tgt.text = text; }
      else { const cs = { ...blankCustom(), title: (title || cleanText(text, 60) || 'Info').slice(0, 80), text: title ? text : '' }; next.custom.push(cs); x.made = customSid(cs); }
    } else if (x.sec === 'about') {
      if (x.key === 'host') { const h = cleanText(text || title, 120); if (h) next.host = h; }
      else { const body = [title, text].filter(Boolean).join('\n'); if (body && !next.description.includes(body)) next.description = (next.description ? next.description.trim() + '\n\n' : '') + body; next.description = next.description.slice(0, 5000); }
    } else if (x.sec === 'bring') {
      const have = new Set(next.bring.split('\n').map(y => y.trim().toLowerCase()).filter(Boolean));
      const add = [title, text].filter(Boolean).join('\n').split('\n').map(y => cleanText(y, 120)).filter(y => y && !have.has(y.toLowerCase()));
      if (add.length) next.bring = [next.bring.trim(), ...add].filter(Boolean).join('\n');
    } else if ((m = x.sec.match(/^field:(\w+)$/))) {
      const f = (typeSpec(next) || { fields: [] }).fields.find(y => y[0] === m[1]); if (!f) continue; const k = f[2];
      if (k === 'links') { if (Array.isArray(x.raw)) xd()[m[1]] = x.raw; }
      else if (k === 'place') { if (text) xd()[m[1]] = x.raw && x.raw.q === text ? x.raw : { q: cleanText(text, 160) }; }
      else if (k === 'date') { if (isDate(text)) xd()[m[1]] = text; }
      else if (k === 'time') { if (isTime(text)) xd()[m[1]] = text; }
      else if (k === 'datetime') { if (isWhen(text)) xd()[m[1]] = text; }
      else if (k === 'url') { if (httpsUrl(text)) xd()[m[1]] = httpsUrl(text); }
      else if (text) xd()[m[1]] = k === 'lines' ? text : cleanText(text, 1000);
    } else if ((m = x.sec.match(/^access:(\w+)$/))) { if (text) next.access = { ...(next.access || {}), [m[1]]: cleanText(text, 300) }; }
  }
  if (next.end && next.start && next.end.slice(0, 10) < next.start.slice(0, 10)) next.end = '';
  return normalize(next);
}

// ---- the control: in each section sheet, and once on the main page ----
let DU = null; // { key, phase: 'pick'|'busy'|'signin'|'review'|'done', file, into, items, msg, undo, scope, attachNew }
let DOC_AI = null; // does the deployed function read documents? (null = not known yet)
function docAIKnown() {
  if (DOC_AI !== null || !SB) return;
  DOC_AI = false;
  (LS.get('signedIn') ? aiModes().then(m => m.includes('doc')) : aiReady()).then(ok => { DOC_AI = !!ok; if (ok) $$('[data-doc-fillbtn]').forEach(b => { b.hidden = false; }); }).catch(() => {});
}
function docIntoOptions(c) {
  const cards = allCards(c);
  const opts = [...cards.type, ...cards.common].filter(x => docCardOk(c, x[0]));
  return `<option value="auto">Sort automatically</option>${opts.map(x => `<option value="${x[0]}">${esc(x[1])}</option>`).join('')}${c.custom.filter(x => x.title.trim()).map(x => `<option value="${customSid(x)}">${esc(x.title)}</option>`).join('')}<option value="new-custom">New custom section</option>`;
}
function docBlockHTML(key) {
  const c = B.cfg; const main = key === 'main'; const st = DU && DU.key === key ? DU : null;
  if (!SB) return '';
  const files = main ? [] : (c.files || []).filter(f => f.sec === key);
  let inner = '';
  if (st && st.phase === 'review') inner = docReviewHTML(c, st.items, st);
  else if (st && st.phase === 'signin') inner = `<div class="bk-signin"><p><b>Sign in to upload documents.</b></p>${signInFormHTML('')}</div>`;
  else if (main && st && (st.phase === 'pick' || st.phase === 'busy')) inner = `<p class="doc-name"><b>${esc(st.file.name || 'Document')}</b> <small class="muted">${esc(fmtSize(st.file.size))}</small></p>
      <div class="field"><label for="doc-into">Put it in</label><select id="doc-into" data-doc-into>${docIntoOptions(c)}</select></div>
      <div class="btns"><button type="button" class="btn primary" data-doc-go="fill" data-doc-fillbtn ${DOC_AI ? '' : 'hidden'} ${st.phase === 'busy' ? 'disabled' : ''}>Fill from document</button><button type="button" class="btn" data-doc-go="attach" ${st.phase === 'busy' ? 'disabled' : ''}>Attach for guests</button><button type="button" class="btn ghost" data-doc-cancel>Cancel</button></div>`;
  else if (!main && st && st.phase === 'pick') inner = `<p class="doc-name"><b>${esc(st.file.name || 'Document')}</b> <small class="muted">${esc(fmtSize(st.file.size))}</small></p>
      <div class="btns"><button type="button" class="btn sm primary" data-doc-go="fill" data-doc-fillbtn ${DOC_AI ? '' : 'hidden'}>Fill from document</button><button type="button" class="btn sm" data-doc-go="attach">Attach for guests</button><button type="button" class="btn sm ghost" data-doc-cancel>Cancel</button></div>`;
  const msg = st && st.msg ? st.msg : '';
  const undo = st && st.phase === 'done' && st.undo ? ' <button type="button" class="btn sm" data-doc-undo>Undo</button>' : '';
  const pickers = main
    ? (!st || st.phase === 'done' ? `<div class="doc-drop" data-doc-drop><label class="btn file-pick doc-pick">✦ Upload a document<input type="file" accept="${DOC_ACCEPT}" data-doc-pick hidden></label><span class="doc-or muted small">or drop a file here</span></div>` : '')
    : (!st || st.phase === 'done' || st.phase === 'busy' ? `<p class="doc-h">Upload a document</p><div class="doc-drop" data-doc-drop><div class="doc-btns"><label class="btn sm file-pick${st && st.phase === 'busy' ? ' busy' : ''}" data-doc-fillbtn ${DOC_AI ? '' : 'hidden'}>Fill from document<input type="file" accept="${DOC_ACCEPT}" data-doc-fill hidden></label><label class="btn sm file-pick">Attach for guests<input type="file" accept="${DOC_ACCEPT}" data-doc-attach hidden></label></div><span class="doc-or muted small">or drop a file here</span></div>` : '');
  const list = files.length ? `<ul class="doc-files">${files.map(f => `<li><span class="doc-ic" aria-hidden="true">${f.type === 'pdf' ? 'PDF' : 'IMG'}</span><a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.name)}</a><button type="button" class="link" data-doc-del="${f.id}" aria-label="Remove ${esc(f.name)}">Remove</button></li>`).join('')}</ul>` : '';
  return `<div class="doc-up${main ? ' doc-main-up' : ''}" data-doc-key="${esc(key)}">${pickers}${list}${inner}<p class="hint" data-doc-msg role="status" aria-live="polite">${esc(msg)}${undo}</p></div>`;
}
// a file dropped anywhere else on the builder goes to the main "Upload a document"
function wirePageDrop() {
  if (wirePageDrop.on) return; wirePageDrop.on = true;
  const live = () => !!document.querySelector('[data-doc-key="main"]');
  const other = (e) => e.target.closest && e.target.closest('[data-doc-drop],[data-ph-drop]');
  document.addEventListener('dragover', (e) => { if (!dragFiles(e) || !live() || other(e)) { if (other(e)) document.body.classList.remove('doc-dragging'); return; } e.preventDefault(); document.body.classList.add('doc-dragging'); });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget || e.relatedTarget === document.documentElement) document.body.classList.remove('doc-dragging'); });
  document.addEventListener('drop', (e) => {
    document.body.classList.remove('doc-dragging'); if (!dragFiles(e) || !live() || other(e)) return; e.preventDefault();
    const f = e.dataTransfer.files[0]; if (!f) return; const sh = $('#sheet');
    const go = () => { docDropped('main', f); const el = document.querySelector('[data-doc-key="main"]'); if (el) el.scrollIntoView({ block: 'center' }); };
    if (sh && sh.open) { sh.addEventListener('close', () => setTimeout(go, 0), { once: true }); sh.close(); } else go();
  });
}
function docPaint(key) { const el = document.querySelector(`[data-doc-key="${CSS.escape(key)}"]`); if (el) el.outerHTML = docBlockHTML(key); }
const docSignIn = (key) => { DU = { key, phase: 'signin' }; docPaint(key); };
async function docRead(key, scope, file) {
  if (!LS.get('signedIn')) return docSignIn(key);
  const keep = DU && DU.key === key ? DU : {};
  DU = { ...keep, key, phase: 'busy', file, scope, msg: 'Reading…' }; docPaint(key);
  try {
    const part = await bookingFile(file);
    const j = await aiImport({ mode: 'doc', files: [part], type: B.cfg.type, section: docScopeSection(B.cfg, scope), ...(isDate(B.cfg.start.slice(0, 10)) ? { trip_start: B.cfg.start.slice(0, 10), trip_end: (B.cfg.end || '').slice(0, 10) } : {}) });
    const items = docItems(B.cfg, j.data, scope); items.forEach(x => { x.home = x.sec; x.homeTarget = x.target || ''; });
    if (DU.key !== key) return;
    if (!items.length) { DU = { key, phase: key === 'main' ? 'pick' : 'done', file, msg: 'Nothing found to fill in. Try Attach for guests.' }; docPaint(key); return; }
    DU = { key, phase: 'review', file, scope, items, msg: '', attachNew: scope === 'new-custom', off: {}, open: {}, edit: -1 }; docPaint(key);
  } catch (e) {
    if (e.signin) return docSignIn(key);
    DU = { key, phase: key === 'main' ? 'pick' : 'done', file, msg: e.message || 'Couldn’t read it.' }; docPaint(key);
  }
}
async function docAttach(key, sec, file, { newCustom } = {}) {
  if (!LS.get('signedIn')) return docSignIn(key);
  DU = { key, phase: key === 'main' ? 'busy' : 'busy', file, msg: 'Uploading…' }; docPaint(key);
  try {
    const f = await docUpload(file); const cfg = B.cfg; const undo = clone(cfg);
    if (newCustom) { const cs = { ...blankCustom(), title: cleanText((file.name || 'Document').replace(/\.\w+$/, '').replace(/[_-]+/g, ' '), 80) || 'Document' }; cfg.custom.push(cs); sec = customSid(cs); }
    cfg.files = (cfg.files || []).concat(fileEntry(f, sec));
    DU = { key, phase: 'done', msg: key === 'main' ? `Attached to ${docSecLabel(cfg, /^c-/.test(sec) ? 'custom' : sec, { target: sec })}.` : 'Attached.', undo: key === 'main' ? undo : null };
    changed(true);
  } catch (e) {
    if (e.signin) return docSignIn(key);
    DU = { key, phase: key === 'main' ? 'pick' : 'done', file, msg: e.message || 'Upload failed.' }; docPaint(key);
  }
}
// a dropped file starts the same flow as picking one: the main block asks "Put it in", a section asks Fill or Attach
function docDropped(key, file) { if (!file) return; DU = { key, phase: 'pick', file, into: key === 'main' ? 'auto' : key }; docPaint(key); }
const dragFiles = (e) => !!(e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files'));
function wireDocs(root) {
  if (!root || root._docs) return; root._docs = true;
  const zone = (e) => e.target.closest && e.target.closest('[data-doc-drop]');
  root.addEventListener('dragover', (e) => { const z = zone(e); if (!z || !dragFiles(e)) return; e.preventDefault(); z.classList.add('over'); });
  root.addEventListener('dragleave', (e) => { const z = zone(e); if (z && !z.contains(e.relatedTarget)) z.classList.remove('over'); });
  root.addEventListener('drop', (e) => { const z = zone(e); if (!z) return; e.preventDefault(); z.classList.remove('over'); document.body.classList.remove('doc-dragging'); const box = z.closest('[data-doc-key]'); if (box) docDropped(box.dataset.docKey, e.dataTransfer && e.dataTransfer.files[0]); });
  root.addEventListener('change', (e) => {
    const i = e.target; const box = i.closest && i.closest('[data-doc-key]'); if (!box) return; const key = box.dataset.docKey;
    if (i.matches('[data-doc-pick]') && i.files && i.files[0]) { DU = { key, phase: 'pick', file: i.files[0], into: 'auto' }; docPaint(key); return; }
    if (i.matches('[data-doc-fill]') && i.files && i.files[0]) { const f = i.files[0]; i.value = ''; docRead(key, key, f); return; }
    if (i.matches('[data-doc-attach]') && i.files && i.files[0]) { const f = i.files[0]; i.value = ''; docAttach(key, key, f); return; }
    if (i.matches('[data-doc-into]') && DU) DU.into = i.value;
    if (i.dataset.drSec != null && DU && DU.items) { const it = DU.items[+i.dataset.drSec]; if (!it) return; it.sec = i.value; it.target = it.sec === 'custom' && it.home === 'custom' ? it.homeTarget || '' : ''; DU.open = { ...(DU.open || {}), [drGroupKey(B.cfg, it)]: true }; docPaint(key); }
    if (i.dataset.drGon != null && DU && DU.items) { DU.off = { ...(DU.off || {}), [i.dataset.drGon]: !i.checked }; docPaint(key); }
  });
  root.addEventListener('input', (e) => { const i = e.target; if (i.dataset.dr == null || !DU || !DU.items) return; const it = DU.items[+i.dataset.dr]; if (it) it[i.dataset.dk] = i.value; e.stopPropagation(); }, true);
  root.addEventListener('click', (e) => {
    const box = e.target.closest('[data-doc-key]'); if (!box) return; const key = box.dataset.docKey;
    const sio = e.target.closest('[data-si-oauth]'); if (sio) { oauthSignIn(sio.dataset.siOauth); LS.set('afterSignIn', '#page=' + B.pid); return; }
    const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
    if (d.si === 'send') { signInSubmit(box, () => LS.set('afterSignIn', '#page=' + B.pid)); return; }
    if (d.si === 'retry') { docSignIn(key); return; }
    if (d.docGo && DU && DU.file) {
      const into = (box.querySelector('[data-doc-into]') || {}).value || DU.into || 'auto';
      if (d.docGo === 'fill') docRead(key, into, DU.file);
      else docAttach(key, into === 'auto' ? 'notes' : into, DU.file, { newCustom: into === 'new-custom' });
      return;
    }
    if ('docCancel' in d) { DU = null; docPaint(key); return; }
    if (d.drDel != null && DU && DU.items) { DU.items[+d.drDel].gone = true; DU.edit = -1; docPaint(key); return; }
    if (d.drOpen != null && DU && DU.items) { const o = DU.open = DU.open || {}; o[d.drOpen] = !o[d.drOpen]; if (!o[d.drOpen] && DU.edit >= 0 && drGroupKey(B.cfg, DU.items[DU.edit]) === d.drOpen) DU.edit = -1; docPaint(key); return; }
    if (d.drEdit != null && DU && DU.items) { DU.edit = +d.drEdit; docPaint(key); if (DU.edit >= 0) { const f = document.querySelector(`[data-doc-key="${CSS.escape(key)}"] [data-dr-at="${DU.edit}"] :is(input,textarea)`); if (f) f.focus({ preventScroll: true }); } return; }
    if ('docApply' in d && DU && DU.items) {
      const st = DU; const use = drLive(B.cfg, st); if (!use.length) return; b.disabled = true; const m = box.querySelector('[data-doc-msg]'); if (m) m.textContent = use.some(x => x.sec === 'route' || x.key === 'venue') ? 'Finding places…' : 'Adding…';
      (async () => {
        const undo = clone(B.cfg); let next = await docApply(B.cfg, use);
        if (st.attachNew) { const made = use.find(x => x.made); if (made) { try { const f = await docUpload(st.file); next.files = (next.files || []).concat(fileEntry(f, made.made)); } catch { /* the section is still made */ } } }
        if (DU !== st) return;
        B.cfg = next; DU = { key, phase: 'done', msg: 'Added. Everything stays editable in its section.', undo }; changed(true); toast('Added to the page'); if (typeof renderHostNote === 'function') renderHostNote();
      })().catch(err => { b.disabled = false; if (m) m.textContent = err.message || 'Couldn’t apply that.'; });
      return;
    }
    if ('docUndo' in d && DU && DU.undo) { B.cfg = DU.undo; DU = { key, phase: 'done', msg: 'Undone.' }; changed(true); return; }
    if (d.docDel) {
      const cfg = B.cfg; const f = (cfg.files || []).find(x => x.id === d.docDel); if (!f) return;
      confirmDlg({ title: `Remove “${f.name}”?`, ok: 'Remove' }).then(yes => { if (!yes) return; cfg.files = cfg.files.filter(x => x !== f); if (!cfg.files.length) delete cfg.files; changed(true); docRemoteDelete(f); });
    }
  });
}

// ================= guest languages: the organizer's own text, translated (ai-import mode:"translate") =================
// cfg.lang = the language the organizer writes in; cfg.langs = guest languages; cfg.tr[lang][path] = { h: hash of the source text, t: translation, o: organizer override }.
// Only fields whose source text changed (hash) are sent again. Names, places, dates, codes and links are left alone by the function.
const GUEST_LANGS = [['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['pt', 'Português'], ['de', 'Deutsch'], ['it', 'Italiano'], ['nl', 'Nederlands'], ['pl', 'Polski'], ['sv', 'Svenska'], ['el', 'Ελληνικά'],
  ['ru', 'Русский'], ['uk', 'Українська'], ['tr', 'Türkçe'], ['ar', 'العربية'], ['he', 'עברית'], ['hi', 'हिन्दी'], ['ja', '日本語'], ['zh', '中文'], ['ko', '한국어'], ['vi', 'Tiếng Việt'], ['th', 'ไทย'], ['id', 'Bahasa Indonesia'], ['tl', 'Tagalog']];
const langName = (k) => (GUEST_LANGS.find(x => x[0] === k) || [k, k])[1];
const RTL = new Set(['ar', 'he']);
const srcLang = (cfg) => cfg.lang || 'en';
const hashStr = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
// every piece of organizer-written text, by path
function textFields(cfg) {
  const out = {}; const put = (k, v) => { if (typeof v === 'string' && v.trim()) out[k] = v; };
  ['title', 'tagline', 'description', 'bring'].forEach(k => put(k, cfg[k]));
  (cfg.schedule || []).forEach((x, i) => { put(`schedule[${i}].title`, x.title); put(`schedule[${i}].note`, x.note); });
  (cfg.notes || []).forEach((x, i) => { put(`notes[${i}].label`, x.label); put(`notes[${i}].text`, x.text); });
  (cfg.custom || []).forEach((x, i) => { put(`custom[${i}].title`, x.title); put(`custom[${i}].text`, x.text); put(`custom[${i}].label`, x.label); });
  const sp = typeSpec(cfg), td = typeData(cfg);
  if (sp) sp.fields.filter(f => f[2] === 'text' || f[2] === 'lines').forEach(([k]) => put(`x.${cfg.type}.${k}`, td[k]));
  Object.entries(cfg.access || {}).forEach(([k, v]) => put(`access.${k}`, v));
  return out;
}
function staleFields(cfg, lang) {
  const tr = (cfg.tr && cfg.tr[lang]) || {}; const out = {};
  for (const [k, v] of Object.entries(textFields(cfg))) { const e = tr[k]; if (!e || e.h !== hashStr(v)) out[k] = v; }
  return out;
}
async function translateCfg(cfg, say) {
  const langs = (cfg.langs || []).filter(l => l !== srcLang(cfg)); let n = 0;
  cfg.tr = cfg.tr && typeof cfg.tr === 'object' ? cfg.tr : {};
  const live = textFields(cfg);
  for (const lang of langs) {
    const tr = (cfg.tr[lang] = cfg.tr[lang] || {});
    Object.keys(tr).forEach(k => { if (!(k in live) && !k.startsWith('ann.')) delete tr[k]; }); // fields that no longer exist
    const todo = Object.entries(staleFields(cfg, lang)); if (!todo.length) continue;
    if (say) say(t('Translating into {l}…', { l: langName(lang) }));
    for (let i = 0; i < todo.length; i += 120) {
      const part = Object.fromEntries(todo.slice(i, i + 120));
      const j = await aiImport({ mode: 'translate', fields: part, target: lang, source: srcLang(cfg) });
      ((j.data && j.data.translations) || []).forEach(x => { if (x.key in part && typeof x.text === 'string') { tr[x.key] = { h: hashStr(part[x.key]), t: String(x.text).slice(0, 6000) }; n++; } });
    }
  }
  return n;
}
// the page as guests in `lang` see it
function translatedView(cfg, lang) {
  const tr = cfg.tr && cfg.tr[lang]; if (!tr || lang === srcLang(cfg)) return cfg;
  const c = clone(cfg);
  for (const [k, v] of Object.entries(textFields(cfg))) { const e = tr[k]; if (e && e.h === hashStr(v) && typeof e.t === 'string') setPath(c, k, e.t); }
  return c;
}
// languages a guest can pick: the page's own, its guest languages, and the interface languages
const pageLangs = (cfg) => [...new Set([srcLang(cfg), ...(cfg.langs || []), ...LANGS.map(x => x[0])])];
function guestLangPick(cfg) {
  const avail = pageLangs(cfg); const ok = (l) => l && avail.includes(l);
  const q = (new URLSearchParams(location.search).get('lang') || '').slice(0, 2).toLowerCase(); if (ok(q)) return q;
  const saved = LS.get('lang'); if (ok(saved)) return saved;
  const nav = (navigator.languages || [navigator.language || 'en']).map(x => String(x).slice(0, 2).toLowerCase());
  return nav.find(l => (cfg.langs || []).includes(l) || l === srcLang(cfg)) || nav.find(ok) || srcLang(cfg);
}
const langSelectHTML = (cfg) => `<select class="lang-sel" data-lang aria-label="Language">${pageLangs(cfg).map(k => `<option value="${k}" ${k === LANG ? 'selected' : ''}>${esc(langName(k))}${(cfg.langs || []).includes(k) || k === srcLang(cfg) ? '' : ' ·'}</option>`).join('')}</select>`;
// choosing a language also rewrites a ?lang= in the address, so the choice wins over the link it came from
function setGuestLang(v) { LS.set('lang', v); const q = new URLSearchParams(location.search); if (q.has('lang')) { q.set('lang', v); history.replaceState(null, '', location.pathname + '?' + q.toString() + location.hash); } route(); }
document.addEventListener('change', (e) => { const s0 = e.target.closest && e.target.closest('.vbar [data-lang]'); if (!s0) return; setGuestLang(s0.value); });
// editor card
function langsCardHTML(c) {
  const src = srcLang(c); const sel = new Set(c.langs || []);
  const reviews = [...sel].filter(l => l !== src).map(l => { const tr = (c.tr && c.tr[l]) || {}; const f = textFields(c);
    const rows = Object.entries(f).map(([k, v]) => { const e = tr[k]; const fresh = e && e.h === hashStr(v); return `<div class="tr-row"><span class="tr-src">${esc(v.length > 140 ? v.slice(0, 140) + '…' : v)}</span><textarea data-tr-lang="${l}" data-tr-key="${esc(k)}" rows="${v.length > 80 ? 3 : 1}" placeholder="${fresh ? '' : 'Not translated yet'}">${esc(fresh ? e.t : '')}</textarea></div>`; }).join('');
    const missing = Object.keys(staleFields(c, l)).length;
    return `<details class="tr-review"><summary><b>${esc(langName(l))}</b> <small class="muted">${missing ? `${missing} to translate` : 'up to date'}</small></summary>${rows || '<p class="hint">Nothing to translate yet.</p>'}</details>`; }).join('');
  return `<p class="hint">Translated when you publish. Edit any line below.</p>
    <div class="field"><label for="f-lang">You write in</label><select id="f-lang" data-src-lang>${GUEST_LANGS.map(([k, n]) => `<option value="${k}" ${k === src ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
    <div class="field"><label>Guest languages</label><div class="chips tr-langs">${GUEST_LANGS.filter(([k]) => k !== src).map(([k, n]) => `<label class="chip ${sel.has(k) ? 'on' : ''}"><input type="checkbox" data-guest-lang="${k}" ${sel.has(k) ? 'checked' : ''} hidden>${esc(n)}</label>`).join('')}</div></div>
    <div class="btns"><button type="button" class="btn" data-b="translate-now" ${sel.size ? '' : 'disabled'}>Translate now</button></div><p class="hint" data-tr-msg role="status" aria-live="polite"></p>
    ${reviews}`;
}
function langsInput(i, cfg) {
  if (i.dataset.guestLang) { const s0 = new Set(cfg.langs || []); i.checked ? s0.add(i.dataset.guestLang) : s0.delete(i.dataset.guestLang); cfg.langs = [...s0]; changed(true); return true; }
  if (i.dataset.srcLang != null) { cfg.lang = i.value; cfg.langs = (cfg.langs || []).filter(l => l !== i.value); changed(true); return true; }
  if (i.dataset.trLang) { const l = i.dataset.trLang, k = i.dataset.trKey; const v = textFields(cfg)[k]; if (v == null) return true; cfg.tr = cfg.tr || {}; cfg.tr[l] = cfg.tr[l] || {};
    if (i.value.trim()) cfg.tr[l][k] = { h: hashStr(v), t: i.value, o: true }; else delete cfg.tr[l][k]; changed(); return true; }
  return false;
}
async function langsClick(b, cfg) {
  if (b.dataset.b !== 'translate-now') return false;
  const msg = $('[data-tr-msg]'); b.disabled = true;
  try { const n = await translateCfg(cfg, (m) => { if (msg) msg.textContent = m; }); changed(true); toast(n ? `Translated ${n} pieces of text` : 'Already up to date'); }
  catch (e) { if (msg) msg.textContent = e.signin ? 'Sign in (My pages) to translate.' : (e.message || 'Translation failed'); b.disabled = false; }
  return true;
}
const canTranslate = () => { const c = LS.get('aiModes'); return !!(c && c.m && c.m.includes('translate')) && !!LS.get('signedIn'); };
// translate a few strings for the host (guest notes) into the host's language, cached
async function translateForHost(map) {
  const host = (navigator.language || 'en').slice(0, 2).toLowerCase(); const out = {}; const todo = {};
  for (const [k, v] of Object.entries(map)) { const c = LS.get('htr:' + host + ':' + hashStr(v)); if (c) out[k] = c; else todo[k] = v; }
  if (Object.keys(todo).length) { const j = await aiImport({ mode: 'translate', fields: todo, target: host }); ((j.data && j.data.translations) || []).forEach(x => { if (todo[x.key] != null) { out[x.key] = x.text; LS.set('htr:' + host + ':' + hashStr(todo[x.key]), x.text); } }); }
  return out;
}

// ================= trips: day-by-day itinerary builder (reuses cfg.schedule: {date, time, title, note, kind}) =================
const PLAN_KINDS = { activity: 'Activity', reservation: 'Reservation', note: 'Note' };
function tripDays(c) {
  const s = c.start.slice(0, 10), e = (c.end || c.start).slice(0, 10); const n = Math.min(60, Math.max(0, daysBetween(s, e)));
  const days = Array.from({ length: n + 1 }, (_, i) => addDays(s, i));
  c.schedule.forEach(x => { if (x.date && !days.includes(x.date)) days.push(x.date); });
  return days.sort();
}
function tripPlanHTML(c) {
  return `${tripDays(c).map((d, di) => {
    const items = c.schedule.map((x, i) => [x, i]).filter(([x]) => x.date === d);
    return `<div class="plan-day"><h3>${d >= c.start.slice(0, 10) ? `<span class="dayn">Day ${daysBetween(c.start, d) + 1}</span> ` : ''}${esc(friendlyDate(d))}</h3>
      ${items.map(([x, i], k) => `<div class="rowed plan-item"><div class="plan-top"><select data-s="${i}" data-k="kind" aria-label="Kind">${Object.entries(PLAN_KINDS).map(([v, l]) => `<option value="${v}" ${(x.kind || 'activity') === v ? 'selected' : ''}>${l}</option>`).join('')}</select><input type="time" data-s="${i}" data-k="time" value="${esc(x.time)}" aria-label="Time (optional)"><span class="mv"><button type="button" data-tp-mv="${i}" data-dir="-1" ${k === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button type="button" data-tp-mv="${i}" data-dir="1" ${k === items.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button></span></div>
        <input data-s="${i}" data-k="title" value="${esc(x.title)}" placeholder="${(x.kind || 'activity') === 'reservation' ? 'Dinner at…, tour, tickets' : (x.kind === 'note' ? 'Something to remember' : 'What you’re doing')}" aria-label="Title"><input data-s="${i}" data-k="note" value="${esc(x.note)}" placeholder="Where, confirmation, or a note" aria-label="Note"><button type="button" class="ic del" data-sdel="${i}" aria-label="Remove">Remove</button></div>`).join('')}
      <button type="button" class="btn sm" data-tp-add="${d}">+ Add to this day</button></div>`;
  }).join('')}<div class="btns">${typeof importButtonHTML === 'function' ? importButtonHTML() : ''}</div>`;
}
function tripClick(b, cfg) {
  const d = b.dataset;
  if (d.tpAdd) { cfg.schedule.push({ date: d.tpAdd, time: '', title: '', note: '', kind: 'activity' }); const n = cfg.schedule.length - 1; changed(true); setTimeout(() => $(`#sheet [data-s="${n}"][data-k="title"]`)?.focus(), 30); return true; }
  if (d.tpMv != null) {
    const i = +d.tpMv; const x = cfg.schedule[i]; const same = cfg.schedule.map((y, j) => [y, j]).filter(([y]) => y.date === x.date).map(([, j]) => j);
    const k = same.indexOf(i) + +d.dir; if (k >= 0 && k < same.length) { const j = same[k]; [cfg.schedule[i], cfg.schedule[j]] = [cfg.schedule[j], cfg.schedule[i]]; changed(true); }
    return true;
  }
  return false;
}

// ================= customization: Design section, section order, type defaults =================
const THEME_PRESETS = [
  ['Classic', { accent: LAGOON, font: 'field', mode: 'light' }], ['Garden', { accent: '#0B7A75', font: 'serif', mode: 'light' }],
  ['Romance', { accent: '#C2185B', font: 'classic', mode: 'light' }], ['Sunset', { accent: '#FF6B35', font: 'wide', mode: 'light' }],
  ['Gold', { accent: '#B8860B', font: 'classic', mode: 'dark' }], ['Night', { accent: '#6D28D9', font: 'condensed', mode: 'dark' }],
  ['Stadium', { accent: '#C2185B', font: 'condensed', mode: 'dark' }], ['Trail', { accent: '#2E7D32', font: 'wide', mode: 'light' }],
];
// guest Event tab sections the organizer can reorder and hide
const EVENT_SECTIONS = [['route', 'Route'], ['about', 'About'], ['details', 'Need to know'], ['rsvp', 'RSVP form'], ['access', 'Access and arrival'], ['schedule', 'Schedule'], ['weather', 'Weather']];
const schedTitle = (cfg) => isTrip(cfg) ? 'Itinerary' : 'Schedule';
function sectionOrder(cfg) {
  const ids = EVENT_SECTIONS.map(x => x[0]).concat((cfg.custom || []).filter(x => x && (x.title || '').trim()).map(customSid)); const o = (Array.isArray(cfg.order) ? cfg.order : (typeDefaults(cfg.type).order || [])).filter((x, i, a) => ids.includes(x) && a.indexOf(x) === i);
  ids.forEach((x, i) => { if (!o.includes(x)) o.splice(Math.min(i, o.length), 0, x); });
  return o;
}
const sectionShown = (cfg, id) => id === 'weather' ? !!cfg.tools.weather : !cfg.off[id];
function setSectionShown(cfg, id, on) { if (id === 'weather') cfg.tools.weather = on; else cfg.off[id] = !on; }
const sameTheme = (a, b) => a.accent.toLowerCase() === b.accent.toLowerCase() && a.font === b.font && (a.mode || 'light') === (b.mode || 'light');
// Design: one dropdown per setting, each with a small preview; display names only (stored values unchanged)
const PRESET_LABEL = { Classic: 'Classic', Garden: 'Natural', Romance: 'Romantic', Sunset: 'Bright', Gold: 'Elegant', Night: 'Night', Stadium: 'Bold', Trail: 'Outdoors' };
const COLOR_NAME = { '#0f4a50': 'Dark teal', '#0b7a75': 'Teal', '#ff6b35': 'Orange', '#c2185b': 'Rose', '#6d28d9': 'Purple', '#b8860b': 'Gold', '#1f2937': 'Charcoal', '#2e7d32': 'Green' };
const colorName = (hex) => COLOR_NAME[String(hex || '').toLowerCase()] || 'Custom';
function coverFieldHTML(c) {
  const link = `<input id="f-cover" data-f="cover" type="url" value="${esc(c.cover)}" placeholder="${SB ? 'or a photo link, https://…' : 'Photo link, https://…'}" aria-label="Cover photo link">`;
  return `<div class="field"><label for="f-cover">Cover photo</label>${SB ? photoCtlHTML('cover', c.cover, link) : `<div class="cover-row">${c.cover ? `<img src="${esc(c.cover)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}${link}</div>${c.cover ? '<button type="button" class="link" data-b="cover-clear">Remove photo</button>' : ''}`}</div>`;
}
function designHTML(c) {
  const th = c.theme; const order = sectionOrder(c);
  const lab = Object.fromEntries(EVENT_SECTIONS);
  lab.schedule = schedTitle(c); if (isTrip(c)) lab.route = 'Route (shown in Itinerary)'; (c.custom || []).forEach(x => { lab[customSid(x)] = x.title; });
  const pre = THEME_PRESETS.find(([, p]) => sameTheme(th, p)); const known = !!COLOR_NAME[th.accent.toLowerCase()]; const custom = !known || (B && B.customColor);
  const sel = (id, key, prev, opts) => `<div class="dsel">${prev}<select id="${id}" data-d="${key}">${opts}</select></div>`;
  return `<div class="dgrid">
    <div class="field"><label for="d-style">Style</label>${sel('d-style', 'preset', `<span class="dprev${th.mode === 'dark' ? ' dark' : ''}" style="--pa:${esc(th.accent)};--pc:#fff;font-family:${esc(FONTS[th.font].css)}" aria-hidden="true">Aa</span>`, `${pre ? '' : '<option value="" selected>Custom</option>'}${THEME_PRESETS.map(([n]) => `<option value="${esc(n)}" ${pre && pre[0] === n ? 'selected' : ''}>${esc(PRESET_LABEL[n] || n)}</option>`).join('')}`)}</div>
    <div class="field"><label for="d-color">Color</label>${sel('d-color', 'color', `<span class="ddot" style="background:${esc(th.accent)}" aria-hidden="true"></span>`, `${SWATCHES.map(x => `<option value="${x}" ${!custom && x.toLowerCase() === th.accent.toLowerCase() ? 'selected' : ''}>${esc(colorName(x))}</option>`).join('')}<option value="custom" ${custom ? 'selected' : ''}>Custom…</option>`)}</div>
    <div class="field"><label for="d-font">Title font</label>${sel('d-font', 'font', `<span class="dprev" style="font-family:${esc(FONTS[th.font].css)}" aria-hidden="true">Aa</span>`, Object.entries(FONTS).map(([k, x]) => `<option value="${k}" ${k === th.font ? 'selected' : ''}>${esc(x.label)}</option>`).join(''))}</div>
    <div class="field"><label for="d-mode">Background</label>${sel('d-mode', 'mode', `<span class="ddot${th.mode === 'dark' ? ' dk' : ' lt'}" aria-hidden="true"></span>`, `<option value="light" ${th.mode !== 'dark' ? 'selected' : ''}>Light</option><option value="dark" ${th.mode === 'dark' ? 'selected' : ''}>Dark</option>`)}</div>
  </div>
  ${custom ? `<div class="field"><div class="swatches custom-row"><label class="custom-c"><input type="color" data-t="accent" value="${esc(th.accent)}" aria-label="Pick any color"><span>Pick</span></label><input id="f-accent-hex" class="hex" data-hex value="${esc(th.accent)}" maxlength="7" spellcheck="false" aria-label="Color code"></div></div>` : ''}
    ${coverFieldHTML(c)}
    <details class="tr-review" data-acc="design-more" ${B && B.moreOpen ? 'open' : ''}><summary><b>More options</b> <small class="muted">Sections</small></summary><div class="acc-b" style="padding:12px 0 0">
    <div class="field"><label>Sections</label>
      <ol class="order">${order.map((id, i) => `<li class="${sectionShown(c, id) ? '' : 'off'}"><label class="chk"><input type="checkbox" data-sec-on="${id}" ${sectionShown(c, id) ? 'checked' : ''}> ${esc(lab[id])}</label><span class="mv"><button type="button" data-sec-mv="${id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(lab[id])} up">↑</button><button type="button" data-sec-mv="${id}" data-dir="1" ${i === order.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(lab[id])} down">↓</button></span></li>`).join('')}</ol></div>
    <div class="btns"><button type="button" class="btn sm ghost" data-b="type-defaults">Reset to ${esc(c.type)} defaults</button></div></div></details>`;
}
// returns true when it handled the click
function designClick(b, cfg) {
  const d = b.dataset;
  if (d.preset) { const p = THEME_PRESETS.find(x => x[0] === d.preset); if (p) { cfg.theme = { ...cfg.theme, ...p[1] }; loadFont(p[1].font); changed(true); } return true; }
  if (d.secMv) { const o = sectionOrder(cfg); const i = o.indexOf(d.secMv), j = i + +d.dir; if (j >= 0 && j < o.length) { [o[i], o[j]] = [o[j], o[i]]; cfg.order = o; changed(true); } return true; }
  if (d.b === 'cover-clear') { cfg.cover = ''; changed(true); return true; }
  if (d.b === 'type-defaults') { const td = typeDefaults(cfg.type); cfg.theme = { ...td.theme }; cfg.tools = defaultTools(cfg.type); delete cfg.order; ['about', 'details', 'access', 'rsvp', 'schedule'].forEach(k => { cfg.off[k] = false; }); loadFont(cfg.theme.font); changed(true); toast(`${cfg.type} defaults applied`); return true; }
  return false;
}
function designInput(i, cfg) {
  const dk = i.dataset.d;
  if (dk) {
    if (dk === 'preset') { const p = THEME_PRESETS.find(x => x[0] === i.value); if (p) { cfg.theme = { ...cfg.theme, ...p[1] }; loadFont(p[1].font); if (B) B.customColor = false; changed(true); } }
    else if (dk === 'color') { if (i.value === 'custom') { if (B) B.customColor = true; } else { cfg.theme.accent = i.value; if (B) B.customColor = false; } changed(true); }
    else if (dk === 'font' && FONTS[i.value]) { cfg.theme.font = i.value; loadFont(i.value); changed(true); }
    else if (dk === 'mode') { cfg.theme.mode = i.value === 'dark' ? 'dark' : 'light'; changed(true); }
    return true;
  }
  if (i.dataset.secOn) { setSectionShown(cfg, i.dataset.secOn, i.checked); changed(true); return true; }
  if (i.dataset.hex != null) { const v = i.value.trim(); if (/^#[0-9a-f]{6}$/i.test(v)) { cfg.theme.accent = v; const cp = i.closest('.swatches')?.querySelector('[data-t="accent"]'); if (cp) cp.value = v; changed(); } return true; }
  return false;
}
// friendly date text over the native picker
const friendlyDate = (d) => d ? new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(asUTC(d)) : '';
document.addEventListener('input', (e) => { const i = e.target; if (!i.matches || !i.matches('.datef input')) return; const s = i.parentElement.querySelector('.datef-txt'); if (s) { s.textContent = friendlyDate(i.value) || i.dataset.ph || ''; s.classList.toggle('ph', !i.value); } });
document.addEventListener('click', (e) => { const i = e.target; if (i.matches && i.matches('.datef input') && i.showPicker) { try { i.showPicker(); } catch { /* not allowed here */ } } });

// ================= dates with optional times =================
// start/end are wall-clock in the venue's zone: 'YYYY-MM-DD' (date only, the default) or 'YYYY-MM-DDTHH:MM'.
const hasTime = (s) => !!s && s.length > 10;
// Calendar span. Date-only events are all-day: { allDay, s: 'YYYY-MM-DD', e: day after the last day }. Timed: UTC Dates.
function eventSpan(cfg) {
  const st = cfg.start, en = cfg.end || '';
  if (!hasTime(st)) return { allDay: true, s: st.slice(0, 10), e: addDays((en && en.slice(0, 10) > st.slice(0, 10) ? en : st).slice(0, 10), 1) };
  const s = wallToUTC(st, cfg.tz);
  let e = en ? wallToUTC(hasTime(en) ? en : en.slice(0, 10) + 'T23:59', cfg.tz) : null;
  if (!e || e <= s) e = new Date(s.getTime() + 2 * 3600e3);
  return { allDay: false, s, e };
}
function countdown(cfg) {
  if (!cfg.start) return '';
  const today = todayYMD(), s = cfg.start.slice(0, 10), e = (cfg.end || cfg.start).slice(0, 10);
  const n = daysBetween(today, s);
  if (n > 1) return t('In {n} days', { n });
  if (n === 1) return t('Tomorrow');
  if (n === 0) return t('Today');
  if (today <= e) return t('Happening now');
  return '';
}
function whenFieldsHTML(c, p, blankDate = false, datesOnly = false) {
  const timed = !datesOnly && hasTime(c.start); const sd = blankDate ? '' : c.start.slice(0, 10); const ed = (c.end || '').slice(0, 10);
  const fld = (k, label, type, val, extra = '') => type === 'date'
    ? `<div class="field"><label for="${p}-${k}">${label}</label><div class="datef"><span class="datef-txt ${val ? '' : 'ph'}" aria-hidden="true">${esc(friendlyDate(val) || (k === 'ed' ? 'Same day' : 'Choose a date'))}</span><input id="${p}-${k}" type="date" data-when="${k}" data-ph="${k === 'ed' ? 'Same day' : 'Choose a date'}" value="${esc(val)}"${extra}></div></div>`
    : `<div class="field"><label for="${p}-${k}">${label}</label><input id="${p}-${k}" type="${type}" data-when="${k}" value="${esc(val)}"${extra}></div>`;
  return `<div class="when ${timed ? 'timed' : ''}">
    <div class="when-row">${fld('sd', 'Starts', 'date', sd)}${timed ? fld('st', 'Time', 'time', c.start.slice(11, 16)) : ''}</div>
    <div class="when-row">${fld('ed', 'Ends', 'date', ed, sd ? ` min="${sd}"` : '')}${timed ? fld('et', 'Time', 'time', hasTime(c.end) ? c.end.slice(11, 16) : '') : ''}</div>
    ${datesOnly ? '' : `<button type="button" class="link when-tg" data-when-tg>${timed ? 'Remove times' : '+ Add time'}</button>`}
  </div>`;
}
function whenInput(c, k, v) {
  const sd = c.start.slice(0, 10), st = hasTime(c.start) ? c.start.slice(11, 16) : '';
  const ed = (c.end || '').slice(0, 10), et = hasTime(c.end) ? c.end.slice(11, 16) : '';
  if (k === 'sd' && v) { c.start = v + (st ? 'T' + st : ''); if (ed && ed < v) c.end = ''; }
  if (k === 'st' && v) c.start = sd + 'T' + v;
  if (k === 'ed') c.end = v && v >= sd ? v + (et ? 'T' + et : '') : '';
  if (k === 'et') c.end = v ? (ed || sd) + 'T' + v : ed;
  if (c.end && c.end.slice(0, 10) === sd && !hasTime(c.end) && !hasTime(c.start)) c.end = '';
}
function whenToggle(c) {
  if (hasTime(c.start)) {
    c.start = c.start.slice(0, 10); const ed = (c.end || '').slice(0, 10); c.end = ed && ed > c.start ? ed : '';
  } else {
    c.start = c.start.slice(0, 10) + 'T18:00'; if (c.end) c.end = c.end.slice(0, 10);
  }
}

// ---------- router ----------
function route() {
  const full = location.hash.slice(1);
  if (/(^|&)(access_token|error_description|error_code)=/.test(full)) return authReturn();
  const [h, tab] = full.split('&t=');
  maps.forEach(m => { try { m.remove(); } catch {} }); maps.clear();
  const qs = new URLSearchParams(location.search); const qe = qs.get('e'), qd = qs.get('demo');
  if (qe && (h === '' || h.startsWith('t='))) { SU = null; return renderHosted(qe.toLowerCase(), h.startsWith('t=') ? h.slice(2) : tab); }
  if (qd && DEMOS[qd] && (h === '' || h.startsWith('t='))) { SU = null; return renderViewer(normalize(clone(window.EXAMPLES[DEMOS[qd]])), { exampleId: DEMOS[qd], tab: h.startsWith('t=') ? h.slice(2) : tab }); }
  if (qe || qd) history.replaceState(null, '', siteBase() + location.hash);
  if (h === 'mine' || h.startsWith('mine/')) { SU = null; return renderMine(h.slice(5)); }
  if (!h.startsWith('new') && !h.startsWith('setup')) SU = null;
  if (h.startsWith('e=')) { const c = unpackEvent(h.slice(2)); if (c) return renderViewer(c, { tab }); return renderBroken(); }
  if (h.startsWith('ex=')) { const e = window.EXAMPLES[h.slice(3)]; if (e) return renderViewer(normalize(clone(e)), { exampleId: h.slice(3), tab }); return renderBroken(); }
  if (h.startsWith('edit=')) { const c = unpackEvent(h.slice(5)); if (c) return renderBuilder(c, 'Editing a copy. The original link won’t change.'); return renderBroken(); }
  if (h.startsWith('edit-ex=')) { const e = window.EXAMPLES[h.slice(8)]; if (e) return renderBuilder(clone(e), 'Copy of an example. Tap Share to get your own link.'); }
  if (h === 'examples') { SU = null; return renderExamples(); }
  if (h === 'setup') return renderSetup();
  if (h === 'new') { const d = LS.get('draft'); return d && d.title ? renderBuilder(d, null, LS.get('draftHosted'), LS.get('draftId') || undefined) : renderSetup(); }
  if (h.startsWith('page=')) { const x = pagesAll().find(p => p.pid === h.slice(5)); if (x) return renderBuilder(x.cfg, null, x.hosted, x.pid); }
  if (h.startsWith('dup=')) { const x = pagesAll().find(p => p.pid === h.slice(4)); if (x) { const pid = newPid(); history.replaceState(null, '', siteBase() + '#page=' + pid); return renderBuilder(duplicateCfg(x.cfg), 'This is a copy. Tap Share to get its own link.', null, pid); } }
  SU = null; renderLanding();
}

window.addEventListener('hashchange', route);
route();
window.__ep = { docItems, docApply, docsHTML, normFiles, shrinkPhoto, docPrepare, bookingFile, flightName, pickAirport, flightArrival, rentalHTML, flightsHTML, stayLinks, apKey, textFields, staleFields, translatedView, hashStr, planEdits, editRule, hotelBrand, hotelBookAction, AIRLINE_BOOK, carBrandURL, syncKey, aiEventToCfg, aiItemsToBookings, pagesAll, DEMOS, gNearby, gMerge, gSameName, GKEY, ohOpenAt, filterPlaces, allPlaces, bookingLink, PROVIDERS, sb, makeSlug, parseGuestList, notReplied, SB_JS, parseReservation, osmQuery, classify, osmKey, OVERPASS, packEvent, unpackEvent, icsText, nearestAirports, weatherFor, nearby, L };
})();
