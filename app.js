/* Eventpages — static event microsite builder. No backend: events live in the URL hash. */
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
const LOCALES = { en: 'en-US', es: 'es-ES', fr: 'fr-FR', pt: 'pt-BR', de: 'de-DE', it: 'it-IT' };
const fmt = (s, o) => new Intl.DateTimeFormat(LOCALES[LANG] || 'en-US', { timeZone: 'UTC', ...o }).format(asUTC(s));
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
    if (cached && Date.now() - cached.t < ttl) return cached.d;
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(url, { ...init, signal: ctl.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(tm); }
  })();
  memo.set(key, p);
  p.catch(() => memo.delete(key));
  return p;
}
function cacheSet(key, d) { LS.set('c3:' + key, { t: Date.now(), d }); }

// ---------- external integrations ----------
let lastNominatim = 0;
async function geocode(q) {
  const wait = 1100 - (Date.now() - lastNominatim); if (wait > 0) await sleep(wait); // Nominatim: max 1 req/s
  lastNominatim = Date.now();
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&accept-language=en&q=${enc(q)}`;
  const data = await getJSON(url, { ttl: 864e5 * 7 });
  return data.map(r => {
    const a = r.address || {};
    const city = a.city || a.town || a.village || a.municipality || a.hamlet || a.suburb || a.county || '';
    const street = [a.house_number, a.road].filter(Boolean).join(' ');
    const name = r.name || street || city;
    const address = [street && street !== name ? street : '', city, a.state, a.postcode].filter(Boolean).join(', ') || r.display_name;
    return { name, address, display: r.display_name, lat: +(+r.lat).toFixed(5), lon: +(+r.lon).toFixed(5), city, region: a.state || '', country: a.country || '', cc: (a.country_code || '').toLowerCase() };
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

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
function osmQuery(lat, lon) {
  const A = (r) => `(around:${r},${lat},${lon})`;
  return `[out:json][timeout:60];(
nwr["amenity"~"^(restaurant|cafe|bar|pub)$"]["name"]${A(800)};
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
async function nearby(lat, lon) {
  const key = osmKey(lat, lon);
  const snap = window.OSM_SNAPSHOTS && window.OSM_SNAPSHOTS[key]; if (snap) return snap;
  const c = LS.get('c3:' + key); if (c && Date.now() - c.t < 864e5) return c.d;
  if (memo.has(key)) return memo.get(key);
  const q = osmQuery(lat, lon);
  const p = (async () => {
    let lastErr;
    for (const ep of OVERPASS) { // public servers: one at a time, fail over on errors
      try {
        const d = await getJSON(ep, { key: key + ep, ttl: 0, timeout: 70000, init: { method: 'POST', body: 'data=' + enc(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } });
        const out = classify(d.elements || [], lat, lon); cacheSet(key, out); return out;
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('Overpass unavailable');
  })();
  memo.set(key, p); p.catch(() => memo.delete(key));
  return p;
}
function classify(els, lat, lon) {
  const food = [], hotels = [], sights = [], transit = { subway: [], rail: [], tram: [], bus: [], bike: [], ferry: [] };
  for (const el of els) {
    const t = el.tags || {}; const la = el.lat ?? el.center?.lat, lo = el.lon ?? el.center?.lon; if (la == null) continue;
    const d = distM(lat, lon, la, lo);
    const base = { name: t.name || '', wheelchair: t.wheelchair || '', lat: la, lon: lo, d, website: t.website || t['contact:website'] || '', street: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') };
    if (/^(restaurant|cafe|bar|pub)$/.test(t.amenity)) {
      food.push({ ...base, kind: t.amenity === 'pub' ? 'bar' : t.amenity, cuisine: (t.cuisine || '').split(';').map(x => x.replace(/_/g, ' ')).slice(0, 2).join(', ') });
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
  const r = { food: dedupe(food, 60), hotels: dedupe(hotels, 30), sights: dedupe(sights, 12), transit: {} };
  for (const k in transit) r.transit[k] = dedupe(transit[k], k === 'bus' ? 4 : 3);
  return r;
}

// ---------- deep links ----------
const L = {
  gflights: (to, from, d1, d2) => `https://www.google.com/travel/flights?q=${enc(`Flights to ${to}${from ? ' from ' + from : ''} on ${d1} through ${d2}`)}`,
  kayak: (from, to, d1, d2) => `https://www.kayak.com/flights/${from}-${to}/${d1}/${d2}`,
  skyscanner: (from, to, d1, d2) => `https://www.skyscanner.com/transport/flights/${from.toLowerCase()}/${to.toLowerCase()}/${d1.slice(2).replace(/-/g, '')}/${d2.slice(2).replace(/-/g, '')}/`,
  booking: (q, d1, d2, n) => `https://www.booking.com/searchresults.html?ss=${enc(q)}&checkin=${d1}&checkout=${d2}&group_adults=${n}&no_rooms=1`,
  airbnb: (q, d1, d2, n) => `https://www.airbnb.com/s/${enc(q.replace(/, /g, '--').replace(/ /g, '-'))}/homes?checkin=${d1}&checkout=${d2}&adults=${n}`,
  expedia: (q, d1, d2, n) => `https://www.expedia.com/Hotel-Search?destination=${enc(q)}&startDate=${d1}&endDate=${d2}&adults=${n}`,
  gyg: (q, d1, d2) => `https://www.getyourguide.com/s/?q=${enc(q)}&date_from=${d1}&date_to=${d2}`,
  viator: (q) => `https://www.viator.com/searchResults/all?text=${enc(q)}`,
  airbnbExp: (q, d1, d2) => `https://www.airbnb.com/s/${enc(q.replace(/, /g, '--').replace(/ /g, '-'))}/experiences?checkin=${d1}&checkout=${d2}`,
  kayakCars: (iata, d1, d2) => `https://www.kayak.com/cars/${iata}/${d1}/${d2}`,
  rome2rio: (from, to) => `https://www.rome2rio.com/map/${enc(from.replace(/ /g, '-'))}/${enc(to.replace(/ /g, '-'))}`,
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

// ---------- event model ----------
const FONTS = {
  grotesk: { label: 'Grotesk', css: "'Bricolage Grotesque', system-ui, sans-serif", gf: null },
  serif: { label: 'Editorial serif', css: "'Fraunces', Georgia, serif", gf: 'Fraunces:opsz,wght@9..144,400..800' },
  classic: { label: 'Classic', css: "'Cormorant Garamond', Georgia, serif", gf: 'Cormorant+Garamond:wght@500;600;700' },
  condensed: { label: 'Poster', css: "'Big Shoulders Display', 'Arial Narrow', sans-serif", gf: 'Big+Shoulders+Display:wght@600..900' },
  wide: { label: 'Wide', css: "'Unbounded', system-ui, sans-serif", gf: 'Unbounded:wght@400..800' }
};
const TYPES = ['Wedding', 'Conference', 'Concert', 'Race', 'Sporting event', 'Festival', 'Bachelor party', 'Bachelorette party', 'Birthday', 'Reunion', 'Retreat', 'Meetup', 'Party', 'Other'];
// ---------- type-specific details: fields appear in the editor only for that type; on the page only if filled ----------
// field: [key, label, kind, placeholder]; kinds: text, url, date, time, datetime, place {q,lat,lon}, links [{label,url}], lines
const TYPE_FIELDS = {
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
const SWATCHES = ['#3048F0', '#0B7A75', '#FF6B35', '#C2185B', '#6D28D9', '#B8860B', '#1F2937', '#2E7D32'];

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
const themeStyle = (t) => `--accent:${t.accent};--on-accent:${onAccent(t.accent)};--display:${FONTS[t.font]?.css || FONTS.grotesk.css}`;

// ---------- ICS ----------
function icsText(cfg, url) {
  const escI = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const fold = (line) => { const out = []; let cur = ''; for (const ch of line) { if (new Blob([cur + ch]).size > 74) { out.push(cur); cur = ' ' + ch; } else cur += ch; } out.push(cur); return out.join('\r\n'); };
  const now = icsStamp(new Date()); const uidBase = Math.abs([...cfg.title + cfg.start].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7));
  const ev = (uid, title, s, e, desc) => ['BEGIN:VEVENT', `UID:${uid}-${uidBase}@eventpages`, `DTSTAMP:${now}`, ...(typeof s === 'string' ? [`DTSTART;VALUE=DATE:${s.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${e.replace(/-/g, '')}`] : [`DTSTART:${icsStamp(s)}`, `DTEND:${icsStamp(e)}`]), `SUMMARY:${escI(title)}`, `LOCATION:${escI(venueLine(cfg.venue))}`, `DESCRIPTION:${escI(desc)}`, `URL:${url}`, 'END:VEVENT'];
  const { s, e } = eventSpan(cfg);
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Eventpages//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${escI(cfg.title)}`];
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
const ext = (href, label, cls = 'btn') => `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`;
const arrow = '<svg class="arr" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 11L11 5M6 5h5v5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
let renderSeq = 0;
const maps = new Set();

const loading = (what) => `<div class="skel" role="status"><span></span><span></span><span></span><em>${t('Loading {w} from OpenStreetMap…', { w: what })}</em><em class="slow">${t('The map servers are busy. This can take up to a minute.')}</em></div>`;

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

function typeInfoHTML(cfg, opt = {}) {
  const sp = typeSpec(cfg), d = typeData(cfg); if (!sp) return '';
  const v = cfg.venue; const lab = Object.fromEntries(sp.fields.map(([k, l]) => [k, l]));
  const has = (k) => { const f = sp.fields.find(x => x[0] === k); return f && filled(f[2], d[k]); };
  const dt = (s) => s ? (s.length > 10 ? `${fmt(s.slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmtTime(s.slice(11, 16))}` : fmt(s, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })) : '';
  const linkRow = (label, url, sub) => `<li><a href="${esc(url)}" target="_blank" rel="noopener"><b>${esc(t(label))}</b><span>${esc(sub || hostOf(url))}</span>${arrow}</a></li>`;
  const noteRow = (label, text) => `<li class="note"><b>${esc(t(label))}</b><span>${esc(text)}</span></li>`;
  const placeURL = (p) => p.lat != null ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}` : L.place(p.q, v ? placeLabel(v) : '');
  const rows = []; const out = [];
  // time-line style rows (concert running order)
  const tl = [];
  if (has('doors')) tl.push([d.doors, t('Doors')]);
  if (has('openerAt') || has('opener')) tl.push([d.openerAt || '', d.opener || t(lab.opener)]);
  if (has('headlinerAt') || has('headliner')) tl.push([d.headlinerAt || '', d.headliner || t(lab.headliner)]);
  if (tl.length) out.push(`<ol class="tl">${tl.sort((a, b) => (a[0] || '99').localeCompare(b[0] || '99')).map(([tm, n]) => `<li><time>${esc(fmtTime(tm)) || '—'}</time><div><b>${esc(n)}</b></div></li>`).join('')}</ol>`);
  for (const [k, label, kind] of sp.fields) {
    if (['doors', 'opener', 'openerAt', 'headliner', 'headlinerAt', 'rsvpBy', 'blockHotel', 'blockUrl', 'blockCode', 'blockBy', 'packetWhen', 'badgeWhen', 'closuresUrl', 'spots', 'speakers'].includes(k) || !filled(kind, d[k])) continue;
    const val = d[k];
    if (k === 'rsvp') rows.push(linkRow('RSVP', val, d.rsvpBy ? t('Reply by {d}', { d: dt(d.rsvpBy) }) : ''));
    else if (k === 'course' && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(val)) out.push(`<a class="course-img" href="${esc(val)}" target="_blank" rel="noopener"><img src="${esc(val)}" alt="${t('Course map')}" loading="lazy" referrerpolicy="no-referrer"></a>`);
    else if (k === 'course') rows.push(linkRow('Course map', val, /\.gpx(\?|$)/i.test(val) ? t('GPX file') : ''));
    else if (k === 'closures') rows.push(d.closuresUrl ? linkRow('Road closures', d.closuresUrl, val) : noteRow('Road closures', val));
    else if (k === 'packet' || k === 'badge') { const w = d[k + 'When']; rows.push(`<li><a href="${esc(L.place(val, v ? placeLabel(v) : ''))}" target="_blank" rel="noopener"><b>${esc(t(label))}</b><span>${esc([val, dt(w)].filter(Boolean).join(' · '))}</span>${arrow}</a></li>`); }
    else if (kind === 'place') rows.push(`<li><a href="${esc(placeURL(val))}" target="_blank" rel="noopener"><b>${esc(t(label))}</b><span>${esc(val.q)}</span>${arrow}</a></li>`);
    else if (kind === 'links') val.filter(l => l.label && l.url).forEach(l => rows.push(linkRow(label === 'Teams' || l.label.toLowerCase() === label.toLowerCase() ? l.label : `${label} · ${l.label}`, l.url)));
    else if (kind === 'url') rows.push(linkRow(label, val));
    else rows.push(noteRow(label, val));
  }
  if (!has('packet') && has('packetWhen')) rows.push(noteRow('Packet pickup', dt(d.packetWhen)));
  if (!has('badge') && has('badgeWhen')) rows.push(noteRow('Badge pickup', dt(d.badgeWhen)));
  if (!has('rsvp') && has('rsvpBy')) rows.push(noteRow('RSVP', t('Reply by {d}', { d: dt(d.rsvpBy) })));
  if (!has('closures') && has('closuresUrl')) rows.push(linkRow('Road closures', d.closuresUrl));
  if (rows.length) out.push(`<ul class="links">${rows.join('')}</ul>`);
  if (!opt.skipBlock && ['blockHotel', 'blockUrl', 'blockCode', 'blockBy'].some(has)) {
    const sub = [d.blockCode ? t('Code {c}', { c: d.blockCode }) : '', d.blockBy ? t('Book by {d}', { d: dt(d.blockBy) }) : ''].filter(Boolean).join(' · ');
    out.push(`<h3 class="sub-h">${t('Room block')}</h3><ul class="links">${d.blockUrl ? linkRow(d.blockHotel || t('Book the room block'), d.blockUrl, sub || hostOf(d.blockUrl)) : noteRow(d.blockHotel || 'Room block', sub)}</ul>`);
  }
  const lines = (k) => String(d[k] || '').split('\n').map(x => x.trim()).filter(Boolean);
  if (has('spots')) out.push(`<h3 class="sub-h">${esc(t(lab.spots))}</h3><ul class="links">${lines('spots').map(x => `<li><a href="${esc(L.place(x, v ? placeLabel(v) : ''))}" target="_blank" rel="noopener"><b>${esc(x)}</b><span>Google Maps</span>${arrow}</a></li>`).join('')}</ul>`);
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
const flightLinks = (f) => { const code = (f || '').replace(/\s+/g, '').toUpperCase(); if (!/^[A-Z0-9]{2}\d{1,4}$/.test(code)) return {}; const a = AIRLINES[code.slice(0, 2)]; return { status: `https://www.flightaware.com/live/flight/${code}`, manage: a && a[1] ? a[1] : '' }; };
function itinFormHTML(x, i) {
  const k = x.kind || '';
  const f = (key, label, type = 'text', ph = '', cls = '') => `<div class="field ${cls}"><label for="it-${key}">${t(label)}</label><input id="it-${key}" type="${type}" data-it="${key}" value="${esc(x[key] || '')}"${ph ? ` placeholder="${esc(ph)}"` : ''}></div>`;
  return `<form class="itin-form" onsubmit="return false">
    ${i == null ? `<div class="field wide"><label for="it-paste">${t('Confirmation')}</label><textarea id="it-paste" rows="3" placeholder="${t('Paste a confirmation email or link')}"></textarea></div>` : ''}
    <div class="trip">
      <div class="field"><label for="it-kind">${t('Type')}</label><select id="it-kind" data-it="kind"><option value="">${t('Choose')}</option>${Object.entries(ITIN_KINDS).map(([v, l]) => `<option value="${v}" ${v === k ? 'selected' : ''}>${t(l)}</option>`).join('')}</select></div>
      ${f('flight', 'Flight number', 'text', 'UA 1234').replace('<div class="field', `<div${k === 'flight' ? '' : ' hidden'} class="field`)}
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
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Eventpages//Itinerary//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc2('My trip · ' + cfg.title)}`];
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
  ['clearbag', 'Clear bag', c => /clear/i.test(c.td.bags || '')],
  ['tickets', 'Tickets', isT('Concert', 'Sporting event', 'Festival')],
  ['earplugs', 'Earplugs', isT('Concert', 'Festival')],
  ['teamgear', 'Team gear', isT('Sporting event')],
  ['laptop', 'Laptop and charger', isT('Conference')],
  ['bizcards', 'Business cards', isT('Conference')],
  ['powerbank', 'Portable charger', isT('Festival', 'Concert', 'Conference', 'Race')]
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

function tripDates(cfg) {
  const s = cfg.start.slice(0, 10), e = (cfg.end || cfg.start).slice(0, 10);
  const st = LS.get('trip:' + s + ':' + e);
  return st || { arrive: addDays(s, -1), leave: addDays(e, 1), guests: 2 };
}
// ---------- travel mode filter (multi-select; nothing picked = everything) ----------
const TRAVEL_MODES = [['fly', 'Flying'], ['train', 'Train'], ['rental', 'Rental car'], ['drive', 'Driving'], ['transit', 'Transit']];
const eventKey = (cfg) => 'modes:' + Math.abs([...(cfg.title || '') + (cfg.start || '') + (cfg.venue ? cfg.venue.name : '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36);
const hasTrains = (v) => v.cc === 'us' || TRAINLINE_CC.has(v.cc);
function travelModes(cfg, air) {
  const v = cfg.venue;
  return TRAVEL_MODES.filter(([k]) => k === 'fly' ? air.length > 0 : k === 'train' ? hasTrains(v) : true);
}
function modeBarHTML(cfg, air) {
  const ms = travelModes(cfg, air); if (ms.length < 2) return '';
  return `<div class="chips mode-bar" role="group" aria-label="${t('How are you getting there?')}"><button type="button" class="chip on" data-tmode="all" aria-pressed="true">${t('All')}</button>${ms.map(([k, l]) => `<button type="button" class="chip" data-tmode="${k}" aria-pressed="false">${t(l)}</button>`).join('')}</div>`;
}
function flightsHTML(cfg, air) {
  const tr = tripDates(cfg); const o = LS.get('origin'); const v = cfg.venue;
  if (!air.length) return `<p class="muted">${t('No airports with scheduled flights within 220 km of the venue.')}</p>`;
  return `<h3 class="sub-h">${t('Nearest airports')}</h3><ul class="airports">${air.map(a => `<li>
    <div class="ap-code">${esc(a.iata)}</div>
    <div class="ap-info"><b>${esc(a.name)}</b><span>${esc(t('{d} from the venue', { d: fmtDist(a.d, v.cc) }))}${a.large ? '' : ' · ' + t('regional')}</span></div>
    <div class="btns">
      ${o === a.iata ? `<span class="muted small">${t('That is your home airport.')}</span>` : `${ext(L.gflights(a.iata, o, tr.arrive, tr.leave), 'Google Flights')}
      ${o ? ext(L.kayak(o, a.iata, tr.arrive, tr.leave), 'Kayak') + ext(L.skyscanner(o, a.iata, tr.arrive, tr.leave), 'Skyscanner') : ''}`}
    </div></li>`).join('')}</ul>
    ${o ? '' : `<p class="muted small">${t('Add the airport you are flying from to compare fares on Kayak and Skyscanner too.')}</p>`}`;
}
function trainsHTML(cfg) {
  const v = cfg.venue; const o = LS.get('origin'); const oa = o && airportByCode(o);
  const from = oa ? (oa[2] || oa[1]) : '';
  const to = v.city || v.name;
  const items = [];
  if (from) items.push(ext(L.rome2rio(from, to), `${esc(t('Every way from {a} to {b}', { a: from, b: to }))} <small>Rome2Rio</small>`, 'row-link'));
  if (v.cc === 'us') items.push(ext('https://www.amtrak.com/home', `${t('Trains across the US')} <small>Amtrak</small>`, 'row-link'));
  if (TRAINLINE_CC.has(v.cc)) items.push(ext('https://www.thetrainline.com/', `${t('Trains and coaches in Europe')} <small>Trainline</small>`, 'row-link'));
  return `<h3 class="sub-h">${t('Train and bus')}</h3><div class="row-links">${items.join('')}</div>${from ? '' : `<p class="muted small">${t('Add where you are coming from to see train and bus routes on Rome2Rio.')}</p>`}`;
}
function rentalHTML(cfg, air) {
  const tr = tripDates(cfg); const v = cfg.venue;
  const items = air.slice(0, 2).map(a => ext(L.kayakCars(a.iata, tr.arrive, tr.leave), `${esc(t('Rental cars at {c}', { c: a.iata }))} <small>Kayak</small>`, 'row-link'));
  items.push(ext(L.place('car rental', placeLabel(v) || v.name), `${esc(t('Rental desks in {c}', { c: v.city || v.name }))} <small>Google Maps</small>`, 'row-link'));
  return `<h3 class="sub-h">${t('Rental car')}</h3><div class="row-links">${items.join('')}</div>`;
}
function stayLinks(cfg) {
  const tr = tripDates(cfg); const v = cfg.venue; const q = placeLabel(v) || v.name; const n = tr.guests || 2;
  return [ext(L.booking(q, tr.arrive, tr.leave, n), `${esc(t('Hotels in {c}', { c: v.city || q }))} <small>Booking.com</small>`, 'row-link'),
    ext(L.airbnb(q, tr.arrive, tr.leave, n), `${t('Homes and apartments')} <small>Airbnb</small>`, 'row-link'),
    ext(L.expedia(q, tr.arrive, tr.leave, n), `${t('Hotels and packages')} <small>Expedia</small>`, 'row-link')].join('');
}
function toursHTML(cfg) {
  return `<div class="row-links" data-slot="tour-links">${tourLinks(cfg)}</div>
    <h3 class="sub-h">${t('Sights near the venue')}</h3>
    <div data-slot="sights">${loading(t('sights'))}</div>`;
}
function tourLinks(cfg) {
  const tr = tripDates(cfg); const v = cfg.venue; const q = v.city || placeLabel(v) || v.name; const qa = placeLabel(v) || q;
  return [ext(L.gyg(q, tr.arrive, tr.leave), `${esc(t('Tours in {c}', { c: q }))} <small>GetYourGuide</small>`, 'row-link'),
    ext(L.viator(q), `${t('Tours and day trips')} <small>Viator</small>`, 'row-link'),
    ext(L.airbnbExp(qa, tr.arrive, tr.leave), `${t('Experiences with locals')} <small>Airbnb</small>`, 'row-link')].join('');
}
function sightsHTML(cfg, data) {
  const v = cfg.venue; const xs = data.sights || [];
  if (!xs.length) return `<p class="muted">${t('No museums, viewpoints or attractions are mapped within 3 km of the venue.')}</p>${ext(L.place('things to do', placeLabel(v)), t('Search on Google Maps'), 'btn')}`;
  return `<ul class="plist rich">${xs.slice(0, 8).map(x => `<li>
    <div><b>${esc(x.name)}</b><span>${esc(t(x.kind))}</span>
      <div class="mini">${ext(L.place(x.name, placeLabel(v)), 'Google Maps', 'mini-b')}${x.website ? ext(x.website, t('Website'), 'mini-b') : ''}</div></div>
    <span class="dist">${esc(fmtDist(x.d, v.cc))}<small>${x.d < 2000 ? walkTxt(x.d) : t('from the venue')}</small></span></li>`).join('')}</ul>`;
}
const TRANSIT_LABELS = { subway: 'Subway & metro', rail: 'Rail', tram: 'Light rail & tram', bus: 'Bus stops', bike: 'Bike share & rental', ferry: 'Ferry' };
function transitHTML(cfg, data) {
  const v = cfg.venue; const groups = Object.entries(data.transit).filter(([, xs]) => xs.length);
  if (!groups.length) return `<p class="muted">${t('No mapped stations or stops within walking distance. Rideshare or driving is the way in.')}</p>`;
  return `<div class="tgroups">${groups.map(([k, xs]) => `<div class="tgroup"><h3 class="sub-h">${t(TRANSIT_LABELS[k])}</h3><ul class="plist">${xs.map(x => `<li>
    <div><b>${esc(x.name)}</b>${x.line ? `<span>${esc(x.line.split(';').join(' · '))}</span>` : ''}</div>
    <a class="dist" href="${esc(`https://www.google.com/maps/dir/?api=1&origin=${x.lat},${x.lon}&destination=${v.lat},${v.lon}&travelmode=walking`)}" target="_blank" rel="noopener" title="${t('Walking directions to the venue')}">${esc(fmtDist(x.d, v.cc))}<small>${walkTxt(x.d)}</small></a></li>`).join('')}</ul></div>`).join('')}</div>`;
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
      <div class="mini">${f.kind !== 'cafe' ? ext(L.opentable(f.name, v, date, tr.guests || 2), t('Reserve') + ' · OpenTable', 'mini-b') : ''}${ext(L.place(f.name, f.street ? `${f.street}, ${v.city}` : placeLabel(v)), 'Google Maps', 'mini-b')}${f.website ? ext(f.website, t('Website'), 'mini-b') : ''}</div></div>
    <span class="dist">${esc(fmtDist(f.d, v.cc))}<small>${walkTxt(f.d)}</small></span></li>`).join('')}${list.length > 5 ? `<li class="more-li"><button type="button" class="btn sm" data-more>${t('Show {n} more', { n: list.length - 5 })}</button></li>` : ''}</ul>`;
}
function hotelsHTML(cfg, data) {
  const v = cfg.venue; const tr = tripDates(cfg);
  if (!data.hotels.length) return `<p class="muted">${t('No hotels are mapped within 3 km of the venue. Try the searches above.')}</p>`;
  const hs = data.hotels.slice(0, 8);
  return `<ul class="plist rich">${hs.map((h, i) => `<li${i >= 3 ? ' class="more"' : ''}>
    <div><b>${esc(h.name)}</b><span>${esc([t(h.kind), h.stars ? `${h.stars}★` : ''].filter(Boolean).join(' · '))}</span>
      <div class="mini">${ext(L.booking(`${h.name}, ${v.city || placeLabel(v)}`, tr.arrive, tr.leave, tr.guests || 2), t('Check rates') + ' · Booking.com', 'mini-b')}${ext(L.place(h.name, h.street ? `${h.street}, ${v.city}` : placeLabel(v)), 'Google Maps', 'mini-b')}${h.website ? ext(h.website, t('Website'), 'mini-b') : ''}</div></div>
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
  LANG = 'en'; document.documentElement.lang = 'en';
  document.title = 'Eventpages — give every guest the whole trip in one link';
  const ex = window.EXAMPLES; const draft = LS.get('draft');
  $('#app').innerHTML = `
  <main class="land">
    <header class="land-top"><a class="brand" href="#"><span class="brand-mark" aria-hidden="true"></span>Eventpages</a><a class="btn primary" href="#new">Create a page</a></header>
    <section class="land-hero">
      <div class="land-copy">
        <h1>Give every guest the whole trip <em>in one link</em>.</h1>
        <p class="lede">For wedding planners, race directors and conference teams. One page carries your schedule and event details, plus live weather, the map, flights, places to stay, tables to book and the train to the door.</p>
        <div class="btns"><a class="btn primary big" href="#new">${draft && draft.title ? 'Continue your draft' : 'Create a page'}</a><a class="btn big" href="#ex=tulum-wedding">See an example</a></div>
        <p class="muted small">Free, no account. The whole page lives in the link you share.</p>
      </div>
      <div class="land-stack" aria-hidden="true">${Object.entries(ex).slice(0, 3).map(([id, e], i) => miniTicket(id, e, i)).join('')}</div>
    </section>
    <section class="land-ex">
      <h2>Open an example</h2>
      <div class="ex-grid">${Object.entries(ex).map(([id, e]) => `
        <a class="ex-card" href="#ex=${id}" style="${themeStyle(e.theme)}">
          <span class="ex-img" style="background-image:url('${esc(e.cover)}')"></span>
          <span class="ex-body"><span class="lbl">${esc(e.type)} · ${esc(e.venue.city)}</span><b>${esc(e.title)}</b><span>${esc(dateRange(e.start, e.end))}</span></span>
          <span class="ex-code">${esc(nearestAirports(e.venue.lat, e.venue.lon)[0]?.iata || '')}</span>
        </a>`).join('')}</div>
    </section>
    <section class="land-what">
      <h2>What your guests get</h2>
      <dl>
        <div><dt>Weather</dt><dd>The live forecast once the event is within 16 days, and the typical weather for those dates before that.</dd></div>
        <div><dt>Map</dt><dd>The venue pinned, with restaurants, hotels and stations around it.</dd></div>
        <div><dt>Flights</dt><dd>The nearest airports, with fares searched for their dates on Google Flights, Kayak and Skyscanner.</dd></div>
        <div><dt>Stays</dt><dd>Hotels near the venue, plus Booking.com, Airbnb and Expedia searches with the dates filled in.</dd></div>
        <div><dt>Tables</dt><dd>Restaurants, cafés and bars within walking distance, each with a link to reserve.</dd></div>
        <div><dt>Event details</dt><dd>RSVP and room blocks for weddings, packet pickup and the course for races, doors and bag policy for shows.</dd></div>
        <div><dt>Their itinerary</dt><dd>Guests paste their bookings and see them beside your schedule, ready for their calendar.</dd></div>
        <div><dt>Getting around</dt><dd>The nearest subway, rail, bus and bike-share stops, directions for every mode, and Uber or Lyft with the drop-off set.</dd></div>
      </dl>
    </section>
    <footer class="land-foot">Built on OpenStreetMap, Open-Meteo and OurAirports data.</footer>
  </main>`;
}
function miniTicket(id, e, i) {
  const a = nearestAirports(e.venue.lat, e.venue.lon)[0];
  return `<div class="mt mt-${i}" style="${themeStyle(e.theme)}"><div class="mt-l"><span class="lbl">${esc(e.type)}</span><b>${esc(e.title)}</b><span>${esc(dateRange(e.start, e.end))}</span><span>${esc(e.venue.name)}</span></div><div class="mt-r"><span class="lbl">Fly into</span><b>${esc(a ? a.iata : '')}</b></div></div>`;
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
// ---------- router ----------
function renderBroken() {
  $('#app').innerHTML = `<main class="land"><header class="land-top"><a class="brand" href="#"><span class="brand-mark"></span>Eventpages</a></header><section class="broken"><h1>This link is incomplete.</h1><p class="lede">The event is stored inside the link, and part of it is missing. Ask whoever sent it to copy the whole link again.</p><a class="btn primary" href="#">Go to Eventpages</a></section></main>`;
}

// ================= v2: defaults, guest tabs, editor gallery, setup flow =================
// guest-interface strings go through t(); host content never does
let LANG = 'en';
const I18N = window.EP_I18N || {};
const t = (s, vars) => { let r = (I18N[LANG] && I18N[LANG][s]) || s; if (vars) r = r.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? ''); return r; };

const TOOLS = [['weather', 'Weather'], ['travel', 'Travel'], ['stay', 'Stay'], ['nearby', 'Nearby'], ['tours', 'Things to do'], ['mytrip', 'My trip'], ['packing', 'Packing list']];
const TYPE_DEFAULTS = {
  Wedding: { theme: { accent: '#0B7A75', font: 'serif', mode: 'light' }, off: [] },
  Race: { theme: { accent: '#2E7D32', font: 'wide', mode: 'light' }, off: ['tours'] },
  Conference: { theme: { accent: '#3048F0', font: 'grotesk', mode: 'light' }, off: ['packing'] },
  Concert: { theme: { accent: '#FF6B35', font: 'condensed', mode: 'dark' }, off: ['stay'] },
  Festival: { theme: { accent: '#FF6B35', font: 'condensed', mode: 'dark' }, off: [] },
  'Sporting event': { theme: { accent: '#C2185B', font: 'condensed', mode: 'dark' }, off: ['stay', 'packing'] }
};
const typeDefaults = (type) => TYPE_DEFAULTS[type] || { theme: { accent: '#3048F0', font: 'grotesk', mode: 'light' }, off: [] };
const defaultTools = (type) => Object.fromEntries(TOOLS.map(([k]) => [k, !typeDefaults(type).off.includes(k)]));
const SETUP_TYPES = [['Wedding', 'Wedding', 'RSVP, room block, dress code', '#0B7A75'], ['Race', 'Race', 'Start, finish, packet pickup', '#2E7D32'],
  ['Conference', 'Conference', 'Badges, agenda, speakers', '#3048F0'], ['Concert', 'Concert', 'Doors, set times, bag policy', '#FF6B35'],
  ['Festival', 'Festival', 'Several days, several stages', '#B8860B'], ['Sporting event', 'Game day', 'Seats, tailgating, parking', '#C2185B'],
  ['Party', 'Something else', 'Party, reunion, retreat', '#1F2937']];
// "Add to your page" cards: [id, title, subtitle, field keys]
const TYPE_CARDS = {
  Wedding: [['rsvp', 'RSVP', 'Link and reply-by date', ['rsvp', 'rsvpBy']], ['block', 'Room block', 'Hotel, code, book-by date', ['blockHotel', 'blockUrl', 'blockCode', 'blockBy']],
    ['dress', 'Dress code', 'One line guests will see', ['dress']], ['registry', 'Registry', 'One or more links', ['registry']]],
  Race: [['startfinish', 'Start and finish', 'Pinned on the map', ['startAt', 'finishAt']], ['packet', 'Packet pickup', 'Where and when', ['packet', 'packetWhen']],
    ['course', 'Course map', 'Link, GPX or image', ['course']], ['spots', 'Spectator spots', 'Good places to cheer', ['spots']], ['closures', 'Road closures', 'Which roads, and when', ['closures', 'closuresUrl']]],
  Concert: [['settimes', 'Set times', 'Doors, opener, headliner', ['doors', 'opener', 'openerAt', 'headliner', 'headlinerAt']], ['bags', 'Bag policy', 'What guests can bring in', ['bags']],
    ['parking', 'Parking and pickup', 'Lots and rideshare spot', ['parking', 'pickup']], ['setlist', 'Setlist', 'Link', ['setlist']]],
  'Sporting event': [['seating', 'Seating chart', 'Link', ['seating']], ['teams', 'Teams', 'Links', ['teams']], ['tailgate', 'Tailgating and parking', 'Lots and times', ['tailgate', 'parking']], ['bags', 'Bag policy', 'What guests can bring in', ['bags']]],
  Conference: [['badge', 'Badge pickup', 'Where and when', ['badge', 'badgeWhen']], ['speakers', 'Speakers', 'One per line', ['speakers']], ['agenda', 'Full agenda', 'Link', ['agenda']]]
};
const TYPE_GROUP = { Wedding: 'For weddings', Race: 'For races', Concert: 'For concerts', 'Sporting event': 'For game day', Conference: 'For conferences' };
const COMMON_CARDS = [['schedule', 'Schedule', 'Times and places'], ['notes', 'Notes for guests', 'Kids, parking, FAQ'], ['about', 'About', 'Host and a few words'],
  ['look', 'Cover and colors', 'Photo, color, font'], ['bring', 'Must-bring items', 'Top of the packing list']];
const CARD_ICONS = {
  rsvp: '<path d="M4 6h16v12H4z"/><path d="M4 7l8 6 8-6"/>', block: '<path d="M3 20V9l9-5 9 5v11"/><path d="M9 20v-6h6v6"/>', dress: '<path d="M9 3l3 3 3-3 3 4-3 2v12H9V9L6 7z"/>',
  registry: '<rect x="3" y="8" width="18" height="13" rx="1"/><path d="M12 8v13M3 12h18M12 8S8 3 6 5s6 3 6 3 8-1 6-3-6 3-6 3"/>', startfinish: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  packet: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>', course: '<path d="M4 18c3 0 3-6 6-6s3 6 6 6 2-3 4-3"/><circle cx="4" cy="18" r="1.5"/><circle cx="20" cy="15" r="1.5"/>',
  spots: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', closures: '<path d="M12 3l8 17H4z"/><path d="M8 13h8"/>',
  settimes: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', bags: '<path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>', parking: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M10 17V7h3a3 3 0 0 1 0 6h-3"/>',
  setlist: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>', seating: '<path d="M4 10h16M4 15h16M9 5v15M15 5v15"/><rect x="4" y="5" width="16" height="15" rx="2"/>',
  teams: '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M2 20c0-3 3-5 6-5s6 2 6 5M14 15c3 0 8 1 8 5"/>', tailgate: '<path d="M3 15l2-6h14l2 6v4H3z"/><circle cx="7" cy="17" r="1.5"/><circle cx="17" cy="17" r="1.5"/>',
  badge: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M8 17h8"/>', speakers: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  agenda: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>', schedule: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', notes: '<path d="M5 3h14v18H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>', look: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-6-5-9 8"/>',
  bring: '<path d="M6 8h12l-1 12H7z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>', access: '<circle cx="12" cy="4.5" r="1.5"/><path d="M12 7v6h5l2 6M12 10H7"/><path d="M9 13a5 5 0 1 0 6 6"/>'
};
const cardIcon = (id) => `<svg viewBox="0 0 24 24" aria-hidden="true">${CARD_ICONS[id] || CARD_ICONS.notes}</svg>`;

function blankEvent(type) {
  const s = addDays(todayYMD(), 30); type = type || 'Party';
  return { v: 2, type, title: '', tagline: '', host: '', description: '', start: s, end: '', tz: '', venue: null, cover: '',
    theme: { ...typeDefaults(type).theme }, tools: defaultTools(type), off: {}, schedule: [], notes: [], x: {}, bring: '' };
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
  c.tools = { ...defaultTools(c.type), ...(c.tools || {}) };
  c.off = c.off || {}; c.notes = Array.isArray(c.notes) ? c.notes : []; c.schedule = Array.isArray(c.schedule) ? c.schedule : [];
  c.x = c.x && typeof c.x === 'object' ? c.x : {}; c.bring = typeof c.bring === 'string' ? c.bring : '';
  return c;
}

// ---------- guest view ----------
const TABS = [['event', 'Event'], ['travel', 'Travel'], ['nearby', 'Nearby'], ['mytrip', 'My trip']];
const TAB_ICONS = {
  event: '<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M15 7v12" stroke-dasharray="2 2"/>',
  travel: '<path d="M2 16l20-6-3-3-6 2-6-5-2 1 4 6-4 1-2-2-1 1z"/>',
  nearby: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  mytrip: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 2v4M16 2v4M8 12l2.5 2.5L16 9"/>'
};
function tabsFor(cfg) {
  const v = cfg.venue, T = cfg.tools;
  return TABS.filter(([k]) => k === 'event' || (k === 'travel' && v && (T.travel || T.stay)) || (k === 'nearby' && v && (T.nearby || T.tours)) || (k === 'mytrip' && cfg.start && (T.mytrip || T.packing)));
}
const sec = (id, title, body, cls = '') => body ? `<section class="ev-sec ${cls}" id="sec-${id}" data-sec="${id}"><h2 class="sec-h">${esc(title)}</h2><div class="sec-b">${body}</div></section>` : '';
function notesHTML(cfg) {
  const ns = cfg.notes.filter(x => x.label && (x.url || x.text)); if (!ns.length) return '';
  return `<ul class="links">${ns.map(x => x.url
    ? `<li><a href="${esc(x.url)}" target="_blank" rel="noopener"><b>${esc(x.label)}</b><span>${esc(x.text || hostOf(x.url))}</span>${arrow}</a></li>`
    : `<li class="note"><b>${esc(x.label)}</b><span>${esc(x.text)}</span></li>`).join('')}</ul>`;
}
function needToKnowHTML(cfg) {
  const parts = [];
  if (!cfg.off.details) parts.push(typeInfoHTML(cfg, { skipBlock: !!(cfg.venue && cfg.tools.stay) }));
  if (!cfg.off.notes) parts.push(notesHTML(cfg));
  return parts.filter(Boolean).join('');
}
function aboutHTML(cfg) {
  if (cfg.off.about || !(cfg.description || cfg.host)) return '';
  return `${cfg.host ? `<p class="host"><span class="lbl">${t('Hosted by')}</span> ${esc(cfg.host)}</p>` : ''}${cfg.description.split(/\n\s*\n/).filter(Boolean).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}`;
}
// one schedule: the organizer's items, with the guest's own bookings mixed in
function scheduleHTML(cfg) {
  const evs = cfg.off.schedule ? [] : cfg.schedule.filter(x => x.title).map(x => ({ ev: true, start: (x.date || '') + (x.date && x.time ? 'T' + x.time : ''), name: x.title, note: x.note }));
  const mine = cfg.tools.mytrip ? itinLoad(cfg).map((x, i) => ({ ...x, i })) : [];
  if (!evs.length && !mine.length) return '';
  const view = mine.length ? (LS.get('schedview:' + itinKey(cfg)) || 'all') : 'all';
  const all = (view === 'event' ? evs : evs.concat(mine)).sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999'));
  const days = {}; all.forEach(x => (days[(x.start || '').slice(0, 10)] = days[(x.start || '').slice(0, 10)] || []).push(x));
  const tm = (s) => fmtTime((s || '').slice(11, 16));
  return `${mine.length ? `<div class="seg2 sched-seg" role="group"><button type="button" data-sched="all" class="${view === 'all' ? 'on' : ''}" aria-pressed="${view === 'all'}">${t('Everything')}</button><button type="button" data-sched="event" class="${view === 'event' ? 'on' : ''}" aria-pressed="${view === 'event'}">${t('Event only')}</button></div>` : ''}
  ${Object.entries(days).map(([d, xs]) => `<div class="day"><h3 class="day-h">${d ? esc(fmt(d, { weekday: 'long', month: 'short', day: 'numeric' })) : t('Anytime')}</h3><ol class="tl">${xs.map(x => {
    if (x.ev) return `<li><time>${esc(tm(x.start)) || '—'}</time><div><b>${esc(x.name)}</b>${x.note ? `<span>${esc(x.note)}</span>` : ''}</div></li>`;
    const fl = x.kind === 'flight' ? flightLinks(x.flight) : {};
    const until = x.end ? (x.end.slice(0, 10) !== (x.start || '').slice(0, 10) ? t('until {d}', { d: fmt(x.end.slice(0, 10), { month: 'short', day: 'numeric' }) }) : t('until {d}', { d: tm(x.end) })) : '';
    return `<li class="mine"><time>${esc(tm(x.start)) || '—'}</time><div><b>${esc(x.name || t(ITIN_KINDS[x.kind] || 'Booking'))} <em class="yours">${t('Yours')}</em></b><span>${esc([t(ITIN_KINDS[x.kind] || ''), until, x.confNo ? t('Conf. {n}', { n: x.confNo }) : ''].filter(Boolean).join(' · '))}</span>${fl.status ? ext(fl.status, t('Flight status') + ' ↗', 'tl-link') : ''}</div></li>`;
  }).join('')}</ol></div>`).join('')}`;
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
        <div class="stub-cell wide"><span class="lbl">${t('Venue')}</span><b>${v ? esc(v.name) : t('To be announced')}</b>${v && v.address && v.address !== v.name ? `<small>${esc(v.address)}</small>` : ''}</div>
      </div>
      <div class="stub-tear" aria-hidden="true"></div>
      <div class="stub-side">
        ${air[0] ? `<span class="lbl">${t('Fly into')}</span><b class="code">${esc(air[0].iata)}</b><small>${esc(t('{d} away', { d: fmtDist(air[0].d, v.cc) }))}</small>` : (cfg.start ? `<span class="lbl">${esc(fmt(cfg.start.slice(0, 10), { weekday: 'short' }))}</span><b class="code">${esc(fmt(cfg.start.slice(0, 10), { month: 'short' }).toUpperCase())}</b><small class="big-day">${esc(fmt(cfg.start.slice(0, 10), { day: 'numeric' }))}</small>` : `<span class="lbl">${t('Date')}</span><b class="code">TBA</b>`)}
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
    <div class="field"><label for="ep-arrive">${t('Travel there')}</label><input type="date" id="ep-arrive" data-k="arrive" value="${tr.arrive}"></div>
    <div class="field"><label for="ep-leave">${t('Travel home')}</label><input type="date" id="ep-leave" data-k="leave" value="${tr.leave}"></div>
    <div class="field narrow"><label for="ep-guests">${t('Guests')}</label><input type="number" id="ep-guests" min="1" max="16" data-k="guests" value="${tr.guests}"></div>
  </div>`;
}
function travelTabHTML(cfg, air) {
  const v = cfg.venue; const T = cfg.tools; const out = [];
  out.push(`<div class="ev-sec trip-sec">${tripBarHTML(cfg)}${T.travel ? modeBarHTML(cfg, air) : ''}</div>`);
  if (T.travel) out.push(sec('travel', t('Getting there'), `
    <div data-slot="flights" data-mode="fly"></div>
    ${hasTrains(v) ? '<div data-slot="trains" data-mode="train"></div>' : ''}
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
  return `<div class="row-links block-row">${d.blockUrl ? `<a class="row-link hl" href="${esc(d.blockUrl)}" target="_blank" rel="noopener">${inner}</a>` : `<div class="row-link hl">${inner}</div>`}</div>`;
}
function nearbyTabHTML(cfg) {
  const T = cfg.tools; const out = [];
  if (T.nearby) out.push(sec('map', t('Map'), `<div class="map-wrap"><div class="map" data-slot="map" role="region" aria-label="${t('Map of the venue and surroundings')}"></div><div class="map-legend" data-slot="legend"></div></div>`));
  if (T.nearby) out.push(sec('food', t('Eat & drink'), `<div data-slot="food">${loading(t('places to eat'))}</div>`));
  if (T.tours) out.push(sec('tours', t('Things to do'), toursHTML(cfg)));
  return out.join('');
}
function bookingsHTML(cfg) {
  const items = itinLoad(cfg);
  return `${items.length ? `<ul class="plist rich bookings">${items.map((x, i) => {
    const fl = x.kind === 'flight' ? flightLinks(x.flight) : {};
    const when = x.start ? fmt(x.start.slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' }) + (x.start.length > 10 ? ' · ' + fmtTime(x.start.slice(11, 16)) : '') : '';
    const links = [fl.status ? ext(fl.status, t('Flight status'), 'mini-b') : '', fl.manage ? ext(fl.manage, t('Manage booking'), 'mini-b') : '', x.link ? ext(x.link, t('Open booking'), 'mini-b') : '', x.address ? ext(L.place(x.address), 'Google Maps', 'mini-b') : ''].join('');
    return `<li><div><b>${esc(x.name || t(ITIN_KINDS[x.kind] || 'Booking'))}</b><span>${esc([t(ITIN_KINDS[x.kind] || ''), when, x.confNo ? t('Conf. {n}', { n: x.confNo }) : ''].filter(Boolean).join(' · '))}</span>${x.note ? `<span>${esc(x.note)}</span>` : ''}<div class="mini">${links}<button type="button" class="mini-b" data-itin-edit="${i}">${t('Edit')}</button></div></div></li>`;
  }).join('')}</ul>` : ''}
  <div class="btns itin-btns"><button type="button" class="btn primary" data-itin-add>+ ${t('Add booking')}</button>${items.length ? `<button type="button" class="btn" data-itin-ics>${t('Add to calendar')}</button>` : ''}</div><div data-slot="itin-form"></div>`;
}
function myTripTabHTML(cfg) {
  const T = cfg.tools; const out = [];
  if (T.mytrip) out.push(sec('itinerary', t('Your bookings'), bookingsHTML(cfg)));
  if (T.packing) out.push(`<section class="ev-sec" id="sec-packing"><details class="pack-wrap"><summary><h2 class="sec-h">${t('Packing list')}</h2><span class="pack-sum" data-slot="pack-sum"></span></summary><div data-slot="pack-list"></div><div class="pack-add"><input placeholder="${t('Add an item')}" aria-label="${t('Add an item')}" maxlength="80"><button type="button" class="btn" data-pack-add>${t('Add')}</button></div></details></section>`);
  return out.join('');
}
function eventTabHTML(cfg) {
  const out = [];
  out.push(sec('about', t('About'), aboutHTML(cfg)));
  out.push(sec('details', t('Need to know'), needToKnowHTML(cfg)));
  out.push(`<div data-slot="access-wrap">${accessHTML(cfg, null)}</div>`);
  out.push(`<div data-slot="schedule-wrap">${sec('schedule', t('Schedule'), scheduleHTML(cfg))}</div>`);
  if (cfg.venue && cfg.start && cfg.tools.weather) out.push(sec('weather', t('Weather'), `<div data-slot="weather"><div class="skel" role="status"><span></span><span></span><em>${t('Loading weather…')}</em></div></div>`));
  return out.join('');
}
function renderEvent(cfg, root, opts = {}) {
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
    ${tabs.some(x => x[0] === 'mytrip') ? panel('mytrip', myTripTabHTML(cfg), tabHead('mytrip')) : ''}
    <footer class="ev-foot">
      ${opts.preview ? '' : `<p class="lang-row"><select class="lang-sel" data-lang aria-label="Language">${LANGS.map(([k, l]) => `<option value="${k}" ${k === LANG ? 'selected' : ''}>${l}</option>`).join('')}</select></p><a href="#edit=${packEvent(cfg)}">${t('Edit a copy of this page')}</a> · <a href="#">${t('Make your own')}</a>`}
      <p>Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · Weather by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a></p>
    </footer>
  </article>`;
  const art = root.querySelector('.ev');
  wireEvent(cfg, art, seq, air, opts);
}
function showTab(art, k, opts = {}) {
  $$('.ev-panel', art).forEach(p => { p.hidden = p.dataset.panel !== k; });
  $$('[data-tab-go]', art).forEach(b => b.setAttribute('aria-selected', String(b.dataset.tabGo === k)));
  if (k === 'nearby') maps.forEach(m => { try { m.invalidateSize(); } catch {} });
  if (!opts.preview && /^#(e|ex)=/.test(location.hash)) { const base = location.hash.split('&t=')[0]; history.replaceState(null, '', k === 'event' ? base : `${base}&t=${k}`); }
  if (!opts.preview) window.scrollTo(0, 0); else art.closest('.b-preview, .su-preview')?.scrollTo(0, 0);
}

function wireEvent(cfg, art, seq, air, opts) {
  const v = cfg.venue; const T = cfg.tools; const alive = () => seq === renderSeq && document.body.contains(art);
  const slot = (n) => art.querySelector(`[data-slot="${n}"]`);
  const renderSchedule = () => { const w = slot('schedule-wrap'); if (w) w.innerHTML = sec('schedule', t('Schedule'), scheduleHTML(cfg)); };
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
  wireItin(cfg, art); wirePacking(cfg, art);
  art.querySelector('[data-lang]')?.addEventListener('change', (e) => { LS.set('lang', e.target.value); route(); });
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
  const refreshTrip = () => {
    if (slot('flights')) slot('flights').innerHTML = flightsHTML(cfg, air);
    if (slot('trains')) slot('trains').innerHTML = trainsHTML(cfg);
    if (slot('rental')) slot('rental').innerHTML = rentalHTML(cfg, air);
    if (slot('stay-links')) slot('stay-links').innerHTML = stayLinks(cfg);
    if (slot('tour-links')) slot('tour-links').innerHTML = tourLinks(cfg);
    if (art._osm && slot('hotels')) slot('hotels').innerHTML = hotelsHTML(cfg, art._osm);
    $$('[data-k]', art).forEach(i => { const tr = tripDates(cfg); if (document.activeElement !== i && tr[i.dataset.k] != null) i.value = tr[i.dataset.k]; });
    art._pack && art._pack();
  };
  const tripKey = 'trip:' + cfg.start.slice(0, 10) + ':' + (cfg.end || cfg.start).slice(0, 10);
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
      .catch(() => { if (alive() && slot('weather')) slot('weather').innerHTML = `<p class="muted">${t('Weather is unavailable right now. Try reloading the page.')}</p>`; });
  }
  const mapEl = slot('map'); let map, layers = {};
  if (mapEl && window.L) {
    map = window.L.map(mapEl, { scrollWheelZoom: false, zoomControl: false, attributionControl: true }).setView([v.lat, v.lon], 15);
    maps.add(map); window.L.control.zoom({ position: 'topright' }).addTo(map);
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
    const pin = window.L.divIcon({ className: 'pin', html: `<span style="--accent:${cfg.theme.accent}"></span>`, iconSize: [30, 40], iconAnchor: [15, 38] });
    window.L.marker([v.lat, v.lon], { icon: pin, title: v.name, zIndexOffset: 1000 }).addTo(map).bindPopup(`<b>${esc(v.name)}</b><br>${esc(v.address || '')}`);
    const sp = typeSpec(cfg), td = typeData(cfg), pts = [[v.lat, v.lon]];
    if (sp && !cfg.off.details) sp.fields.filter(f => f[2] === 'place' && td[f[0]] && td[f[0]].lat != null).forEach(([k, label]) => {
      const p = td[k]; pts.push([p.lat, p.lon]);
      const ic = window.L.divIcon({ className: 'tpin', html: `<span>${esc(t(label))}</span>`, iconSize: null, iconAnchor: [0, 0] });
      window.L.marker([p.lat, p.lon], { icon: ic, title: `${t(label)}: ${p.q}`, zIndexOffset: 900 }).addTo(map).bindPopup(`<b>${esc(t(label))}</b><br>${esc(p.q)}`);
    });
    if (pts.length > 1) map.fitBounds(pts, { padding: [50, 50], maxZoom: 16 });
    setTimeout(() => map.invalidateSize(), 120);
  }
  if (T.nearby || T.stay || T.travel || T.tours) {
    nearby(v.lat, v.lon).then(d => {
      if (!alive()) return; art._osm = d;
      const ft = art.querySelector('.ev-foot p'); if (ft && d.snapshot) ft.insertAdjacentHTML('beforeend', ` · ${esc(t('Nearby places as mapped on {d}', { d: d.snapshot }))}`);
      if (slot('food')) slot('food').innerHTML = foodHTML(cfg, d);
      if (slot('hotels')) slot('hotels').innerHTML = hotelsHTML(cfg, d);
      if (slot('sights')) slot('sights').innerHTML = sightsHTML(cfg, d);
      if (slot('transit')) slot('transit').innerHTML = transitHTML(cfg, d);
      if (slot('access-wrap')) slot('access-wrap').innerHTML = accessHTML(cfg, d);
      if (!Object.values(d.transit).some(xs => xs.length)) { const tb = art.querySelector('[data-tmode="transit"]'); if (tb) { tb.hidden = true; const bar = tb.parentElement; if ($$('[data-tmode]:not([hidden])', bar).length < 3) bar.hidden = true; } }
      applyModes();
      if (map) {
        const mk = (color) => ({ radius: 6, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: .95 });
        const add = (key, items, color, label) => { if (!items.length) return; layers[key] = { label, color, layer: window.L.layerGroup(items.map(x => window.L.circleMarker([x.lat, x.lon], mk(color)).bindPopup(`<b>${esc(x.name)}</b><br>${esc(t('{d} from the venue', { d: fmtDist(x.d, v.cc) }))}`))).addTo(map) }; };
        add('food', d.food.slice(0, 25), '#E4572E', t('Food & drink'));
        if (T.stay) add('hotels', d.hotels.slice(0, 15), '#7B4FD6', t('Hotels'));
        if (T.tours) add('sights', (d.sights || []).slice(0, 12), '#0B9A6D', t('Sights'));
        add('transit', [].concat(...Object.values(d.transit)), '#1D8FD8', t('Transit'));
        const lg = slot('legend');
        lg.innerHTML = Object.entries(layers).map(([k, x]) => `<button class="chip on" data-layer="${k}" aria-pressed="true"><i style="background:${x.color}"></i>${x.label}</button>`).join('');
        lg.addEventListener('click', (e) => { const b = e.target.closest('[data-layer]'); if (!b) return; const l = layers[b.dataset.layer]; const on = map.hasLayer(l.layer); on ? map.removeLayer(l.layer) : l.layer.addTo(map); b.classList.toggle('on', !on); b.setAttribute('aria-pressed', String(!on)); });
      }
    }).catch(() => {
      if (!alive()) return;
      const msg = (what, q) => `<p class="muted">${t('Nearby places could not be loaded from OpenStreetMap right now.')}</p>${ext(L.place(q, placeLabel(v)), t('Search on Google Maps'), 'btn')}`;
      if (slot('food')) slot('food').innerHTML = msg('restaurants', 'restaurants near ' + v.name);
      if (slot('hotels')) slot('hotels').innerHTML = msg('hotels', 'hotels near ' + v.name);
      if (slot('sights')) slot('sights').innerHTML = msg('sights', 'things to do near ' + v.name);
      if (slot('transit')) slot('transit').innerHTML = `<p class="muted">${t('Nearby stations could not be loaded right now.')}</p>${ext(L.dir(v, 'transit'), t('Transit directions'), 'btn')}`;
    });
  }
}

function wireItin(cfg, art) {
  const s = art.querySelector('#sec-itinerary'); if (!s) return;
  const body = s.querySelector('.sec-b'); let draft = null, editing = null;
  const rerender = () => { body.innerHTML = bookingsHTML(cfg); art._renderSchedule && art._renderSchedule(); };
  const openForm = (x, i) => {
    draft = { ...x }; editing = i; const slot = body.querySelector('[data-slot="itin-form"]'); slot.innerHTML = itinFormHTML(draft, i);
    body.querySelector('.itin-btns')?.setAttribute('hidden', '');
    (slot.querySelector('#it-paste') || slot.querySelector('#it-name')).focus();
  };
  const fill = () => { const slot = body.querySelector('[data-slot="itin-form"]'); slot.querySelectorAll('[data-it]').forEach(el => { el.value = draft[el.dataset.it] || ''; });
    const fo = slot.querySelector('[data-it="flight"]').closest('.field'); fo.hidden = draft.kind !== 'flight';
    slot.querySelector('label[for="it-start"]').textContent = t(draft.kind === 'flight' ? 'Departs' : 'Starts'); slot.querySelector('label[for="it-end"]').textContent = t(draft.kind === 'flight' ? 'Arrives' : 'Ends');
    slot.querySelector('#it-note').placeholder = draft.kind === 'flight' ? t('Confirmation code, last name') : ''; };
  body.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
    if ('itinAdd' in d) openForm({}, null);
    else if ('itinEdit' in d) openForm(itinLoad(cfg)[+d.itinEdit], +d.itinEdit);
    else if ('itinCancel' in d) rerender();
    else if ('itinDel' in d) { const xs = itinLoad(cfg); xs.splice(+d.itinDel, 1); LS.set(itinKey(cfg), xs); rerender(); }
    else if ('itinSave' in d) {
      if (!draft.name && !draft.flight && !draft.start) { toast(t('Add a name or a date')); return; }
      if (draft.kind === 'flight' && draft.flight && !draft.name) { const a = AIRLINES[draft.flight.replace(/\s+/g, '').slice(0, 2).toUpperCase()]; draft.name = [a ? a[0] : '', draft.flight.toUpperCase()].filter(Boolean).join(' '); }
      const xs = itinLoad(cfg); editing == null ? xs.push(draft) : (xs[editing] = draft); LS.set(itinKey(cfg), xs); rerender();
    }
    else if ('itinIcs' in d) itinICS(cfg);
  });
  body.addEventListener('input', (e) => {
    const x = e.target; if (!draft) return;
    if (x.id === 'it-paste') { const p = parseReservation(x.value, cfg.start); for (const k in p) if (p[k]) draft[k] = p[k]; if (!x.value.trim()) for (const k in draft) draft[k] = ''; fill(); return; }
    if (x.dataset.it) { draft[x.dataset.it] = x.value; if (x.dataset.it === 'kind') fill(); }
  });
}

function renderViewer(cfg, { exampleId, tab } = {}) {
  LANG = pickLang(); document.documentElement.lang = LANG;
  document.title = (cfg.title || 'Event') + ' · Eventpages';
  const packed = location.hash.split('&t=')[0].slice(3);
  const editHref = exampleId ? `#edit-ex=${exampleId}` : `#edit=${packed}`;
  $('#app').innerHTML = `<div class="viewer"><div class="vbar"><a class="brand sm" href="#"><span class="brand-mark" aria-hidden="true"></span>Eventpages</a>${exampleId ? `<span class="vbar-note">${t('Example page')}</span>` : ''}<a class="btn sm" href="${editHref}">${exampleId ? t('Customize this') : t('Edit a copy')}</a></div><div id="ev-root"></div></div>`;
  renderEvent(cfg, $('#ev-root'), { tab });
  const foot = $('.ev-foot a'); if (foot && exampleId) foot.setAttribute('href', editHref);
  window.scrollTo(0, 0);
}

// ---------- editor ----------
let B = null; // builder state
function renderBuilder(cfg, source) {
  LANG = 'en'; document.documentElement.lang = 'en';
  document.title = 'Edit your page · Eventpages';
  B = { cfg: normalize(cfg), venueResults: [], tab: 'edit', card: null };
  $('#app').innerHTML = `
  <div class="builder" data-tab="edit">
    <header class="b-top">
      <a class="brand sm" href="#"><span class="brand-mark" aria-hidden="true"></span>Eventpages</a>
      <div class="seg" role="tablist"><button role="tab" data-tab="edit" aria-selected="true">Edit</button><button role="tab" data-tab="preview" aria-selected="false">Preview</button></div>
      <button class="btn primary sm" data-act="publish">Publish</button>
    </header>
    <form class="b-form" autocomplete="off" onsubmit="return false">${source ? `<p class="b-note">${esc(source)}</p>` : ''}</form>
    <div class="b-preview"><div class="b-frame" id="preview"></div></div>
  </div>
  <dialog id="sheet" class="sheet"><form class="sheet-in" autocomplete="off" onsubmit="return false"></form></dialog>
  <dialog id="pub"><form method="dialog" class="pub">
    <h2>Your page is ready to share</h2>
    <textarea id="pub-url" readonly rows="4"></textarea>
    <div class="btns"><button type="button" class="btn primary" data-act="copy">Copy link</button><button type="button" class="btn" data-act="native-share" hidden>Share…</button><button type="button" class="btn" data-act="qr">QR code</button><a class="btn" id="pub-open" href="#" target="_blank" rel="noopener">Open page</a><button class="btn ghost">Close</button></div>
  </form></dialog>`;
  buildForm();
  const bl = $('.builder');
  bl.addEventListener('click', (e) => {
    const tb = e.target.closest('[data-tab]'); if (tb && tb.tagName === 'BUTTON') { bl.dataset.tab = tb.dataset.tab; $$('.seg button').forEach(b => b.setAttribute('aria-selected', String(b === tb))); if (tb.dataset.tab === 'preview') { maps.forEach(m => m.invalidateSize()); window.scrollTo(0, 0); } }
    if (e.target.closest('[data-act="publish"]')) publish();
  });
  const dlg = $('#pub');
  dlg.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'copy') copy($('#pub-url').value);
    if (a.dataset.act === 'native-share') navigator.share({ title: B.cfg.title, url: $('#pub-url').value }).catch(() => {});
    if (a.dataset.act === 'qr') openQR(B.cfg);
  });
  const sh = $('#sheet');
  sh.addEventListener('close', () => { B.card = null; buildForm(); });
  sh.addEventListener('click', (e) => { if (e.target === sh) sh.close(); });
  wireInputs(sh.querySelector('.sheet-in'));
  preview();
  if (window.__openCard) { const id = window.__openCard; window.__openCard = null; openCard(id); }
}
function publish() {
  const c = B.cfg; const problems = [];
  if (!c.title.trim()) problems.push('a title');
  if (!c.start) problems.push('a date');
  if (problems.length) { toast('Add ' + problems.join(' and ') + ' first'); return; }
  const url = shareURL(c); $('#pub-url').value = url; $('#pub-open').href = url;
  $('[data-act="native-share"]').hidden = !navigator.share;
  LS.set('published:' + Date.now(), { title: c.title, url });
  $('#pub').showModal();
}
const savedraft = debounce(() => LS.set('draft', B.cfg), 300);
const preview = debounce(() => { const p = $('#preview'); if (!p) return; const sc = p.parentElement; const y = sc.scrollTop; const tab = p.querySelector('[data-tab-go][aria-selected="true"]')?.dataset.tabGo; renderEvent(B.cfg, p, { preview: true, shareUrl: shareURL(B.cfg), tab }); sc.scrollTop = y; }, 350);
function changed(rebuild) { savedraft(); preview(); if (rebuild) { if (B.card) renderSheet(); else buildForm(); } }

const fieldWrap = (label, html, id) => `<div class="field"><label${id ? ` for="${id}"` : ''}>${esc(label)}</label>${html}</div>`;
function xFieldHTML(c, [k, label, kind, ph = '']) {
  const d = typeData(c); const id = `x-${k}`; const val = d[k];
  if (kind === 'links') return `<div class="field"><label>${esc(label)}</label>${(val || []).map((l, i) => `<div class="rowed"><input data-xl="${k}" data-i="${i}" data-k="label" value="${esc(l.label)}" placeholder="Name" aria-label="${esc(label)} name"><input data-xl="${k}" data-i="${i}" data-k="url" type="url" value="${esc(l.url)}" placeholder="https://…" aria-label="${esc(label)} link"><button type="button" class="ic del" data-xdel="${k}" data-i="${i}" aria-label="Remove">Remove</button></div>`).join('')}<button type="button" class="btn sm" data-xadd="${k}">+ Add</button></div>`;
  if (kind === 'place') return `<div class="field"><label for="${id}">${esc(label)}</label><div class="search"><input id="${id}" data-xp="${k}" value="${esc(val ? val.q : '')}" placeholder="${esc(ph)}"><button type="button" class="btn" data-xfind="${k}">${val && val.lat != null ? 'Pinned' : 'Pin on map'}</button></div></div>`;
  if (kind === 'lines') return fieldWrap(label, `<textarea id="${id}" data-x="${k}" rows="4" placeholder="${esc(ph)}">${esc(val || '')}</textarea>`, id);
  const type = { url: 'url', date: 'date', time: 'time', datetime: 'datetime-local' }[kind] || 'text';
  return fieldWrap(label, `<input id="${id}" type="${type}" data-x="${k}" value="${esc(val || '')}"${ph ? ` placeholder="${esc(ph)}"` : ''}>`, id);
}
function cardDone(c, id) {
  const tc = (TYPE_CARDS[c.type] || []).find(x => x[0] === id);
  if (tc) { const sp = typeSpec(c), d = typeData(c); return tc[3].some(k => { const f = sp.fields.find(x => x[0] === k); return f && filled(f[2], d[k]); }); }
  return { schedule: () => c.schedule.some(x => x.title), notes: () => c.notes.some(x => x.label), about: () => !!(c.description || c.host), look: () => !!c.cover, bring: () => !!c.bring.trim(),
    access: () => !!(c.access && Object.values(c.access).some(Boolean)) }[id]?.() || false;
}
const cardBtn = (c, [id, title, sub]) => { const done = cardDone(c, id); return `<button type="button" class="acard ${done ? 'on' : ''}" data-card="${id}"><span class="aic">${cardIcon(id)}</span><b>${esc(title)}</b><span>${esc(sub)}</span><i class="plus" aria-hidden="true">${done ? '✓' : '+'}</i></button>`; };
function allCards(c) { return { type: TYPE_CARDS[c.type] || [], common: COMMON_CARDS }; }
function buildForm() {
  const c = B.cfg; const f = $('.b-form'); if (!f) return; const keepNote = f.querySelector('.b-note');
  const open = new Set($$('details.acc[open]', f).map(d => d.dataset.acc));
  if (!f.dataset.init) { f.dataset.init = '1'; if (!c.title) open.add('basics'); }
  const basicsOk = !!c.title.trim(); const whenOk = !!(c.start && c.venue);
  const cards = allCards(c);
  f.innerHTML = `${keepNote ? keepNote.outerHTML : ''}
  <details class="acc" data-acc="basics" ${open.has('basics') ? 'open' : ''}><summary><span class="st ${basicsOk ? 'ok' : ''}" aria-hidden="true"></span><b>Basics</b><small>${esc([c.type, c.title].filter(Boolean).join(' · '))}</small></summary><div class="acc-b">
    ${fieldWrap('Event type', `<select id="f-type" data-f="type">${TYPES.map(x => `<option ${x === c.type ? 'selected' : ''}>${x}</option>`).join('')}</select>`, 'f-type')}
    ${fieldWrap('Title', `<input id="f-title" data-f="title" value="${esc(c.title)}" maxlength="80">`, 'f-title')}
    ${fieldWrap('Tagline', `<input id="f-tagline" data-f="tagline" value="${esc(c.tagline)}" maxlength="140" placeholder="Optional">`, 'f-tagline')}
  </div></details>
  <details class="acc" data-acc="when" ${open.has('when') ? 'open' : ''}><summary><span class="st ${whenOk ? 'ok' : ''}" aria-hidden="true"></span><b>When and where</b><small>${esc([c.start ? fmt(c.start.slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' }) : '', c.venue ? c.venue.name : ''].filter(Boolean).join(' · '))}</small></summary><div class="acc-b">
    ${whenFieldsHTML(c, 'f')}
    ${venueFieldHTML(c)}
  </div></details>
  <h2 class="b-h">Add to your page</h2>
  ${cards.type.length ? `<p class="grp">${TYPE_GROUP[c.type]}</p><div class="cards">${cards.type.map(x => cardBtn(c, x)).join('')}</div>` : ''}
  <p class="grp">For any event</p><div class="cards">${cards.common.map(x => cardBtn(c, x)).join('')}</div>
  <p class="grp">Automatic for guests</p>
  <div class="tools">${TOOLS.map(([k, l]) => `<label class="tool"><input type="checkbox" data-tool="${k}" ${c.tools[k] ? 'checked' : ''}><span class="sw" aria-hidden="true"></span>${esc(l)}</label>`).join('')}</div>
  <div class="b-end"><button type="button" class="btn primary" data-act="publish">Publish</button><button type="button" class="btn ghost" data-b="reset">Start over</button></div>`;
  wireInputs(f);
}
function venueFieldHTML(c) {
  return c.venue ? `<div class="venue-sel"><div><b>${esc(c.venue.name)}</b><span>${esc(c.venue.address || '')}</span></div><button type="button" class="btn sm" data-b="clear-venue">Change</button></div>
      ${fieldWrap('Venue name on the page', `<input id="f-vname" data-v="name" value="${esc(c.venue.name)}">`, 'f-vname')}`
    : `<div class="field"><label for="vq">Venue</label><div class="search"><input id="vq" placeholder="Venue name or address" value="${esc(B.vq || '')}"><button type="button" class="btn" data-b="search">Search</button></div></div>
      <ul class="vres">${B.venueResults.map((r, i) => `<li><button type="button" data-pick="${i}"><b>${esc(r.name)}</b><span>${esc(r.display)}</span></button></li>`).join('')}</ul>${B.vmsg ? `<p class="hint">${esc(B.vmsg)}</p>` : ''}`;
}
function openCard(id) { B.card = id; renderSheet(); const sh = $('#sheet'); if (!sh.open) sh.showModal(); }
function renderSheet() {
  const c = B.cfg; const id = B.card; const form = $('#sheet .sheet-in'); if (!form || !id) return;
  const tc = (TYPE_CARDS[c.type] || []).find(x => x[0] === id); const cc = COMMON_CARDS.find(x => x[0] === id);
  const title = tc ? tc[1] : cc ? cc[1] : ''; let body = '';
  if (tc) { const sp = typeSpec(c); body = tc[3].map(k => xFieldHTML(c, sp.fields.find(f => f[0] === k))).join(''); }
  else if (id === 'schedule') body = `${c.schedule.map((x, i) => `<div class="rowed"><div class="two"><input type="date" data-s="${i}" data-k="date" value="${esc(x.date)}" aria-label="Date"><input type="time" data-s="${i}" data-k="time" value="${esc(x.time)}" aria-label="Time"></div><input data-s="${i}" data-k="title" value="${esc(x.title)}" placeholder="What's happening" aria-label="Title"><input data-s="${i}" data-k="note" value="${esc(x.note)}" placeholder="Where, or a note" aria-label="Note"><button type="button" class="ic del" data-sdel="${i}" aria-label="Remove item">Remove</button></div>`).join('')}
    <div class="btns"><button type="button" class="btn sm" data-b="add-sched">+ Add item</button>${typeof importButtonHTML === 'function' ? importButtonHTML() : ''}</div>`;
  else if (id === 'notes') body = `${c.notes.map((x, i) => `<div class="rowed"><input data-n="${i}" data-k="label" value="${esc(x.label)}" placeholder="Title" aria-label="Title"><input data-n="${i}" data-k="text" value="${esc(x.text || '')}" placeholder="Text" aria-label="Text"><input data-n="${i}" data-k="url" type="url" value="${esc(x.url || '')}" placeholder="Link (optional)" aria-label="Link"><button type="button" class="ic del" data-ndel="${i}" aria-label="Remove">Remove</button></div>`).join('')}
    <button type="button" class="btn sm" data-b="add-note">+ Add note</button>`;
  else if (id === 'about') body = `${fieldWrap('Hosted by', `<input id="f-host" data-f="host" value="${esc(c.host)}">`, 'f-host')}${fieldWrap('About', `<textarea id="f-desc" data-f="description" rows="6">${esc(c.description)}</textarea>`, 'f-desc')}`;
  else if (id === 'look') body = `${fieldWrap('Cover photo link', `<input id="f-cover" data-f="cover" type="url" value="${esc(c.cover)}" placeholder="https://…/photo.jpg">`, 'f-cover')}
    <div class="field"><label>Color</label><div class="swatches">${SWATCHES.map(s => `<button type="button" class="sw ${s.toLowerCase() === c.theme.accent.toLowerCase() ? 'on' : ''}" style="background:${s}" data-sw="${s}" aria-label="Color ${s}"></button>`).join('')}<input type="color" data-t="accent" value="${esc(c.theme.accent)}" aria-label="Custom color"></div></div>
    <div class="field"><label>Title font</label><div class="fonts">${Object.entries(FONTS).map(([k, x]) => `<button type="button" class="fontb ${k === c.theme.font ? 'on' : ''}" data-font="${k}" style="font-family:${esc(x.css)}">${x.label}</button>`).join('')}</div></div>
    <div class="field"><label>Background</label><div class="seg2"><button type="button" data-theme-mode="light" class="${c.theme.mode !== 'dark' ? 'on' : ''}">Light</button><button type="button" data-theme-mode="dark" class="${c.theme.mode === 'dark' ? 'on' : ''}">Dark</button></div></div>`;
  else if (id === 'bring') body = fieldWrap('Guests must bring', `<textarea id="f-bring" data-f="bring" rows="5" placeholder="One per line">${esc(c.bring)}</textarea>`, 'f-bring');
  else if (typeof extraCardBody === 'function') body = extraCardBody(id, c);
  const head = title;
  form.innerHTML = `<div class="grab" aria-hidden="true"></div><h2>${esc(head)}<button type="button" class="x" data-b="close" aria-label="Close">×</button></h2><div class="sheet-b">${body}</div><button type="button" class="btn primary big" data-b="close">Done</button>`;
}
// one input handler for the form and the card sheet
function wireInputs(root) {
  const c = () => B.cfg;
  root.oninput = (e) => {
    const i = e.target; const d = i.dataset; const cfg = c();
    const xd = () => (cfg.x[cfg.type] = cfg.x[cfg.type] || {});
    if (d.when) { whenInput(cfg, d.when, i.value); changed(); }
    else if (d.x) { xd()[d.x] = i.value; changed(); }
    else if (d.xl) { xd()[d.xl][+d.i][d.k] = i.value; changed(); }
    else if (d.xp) { xd()[d.xp] = i.value ? { q: i.value } : null; const fb = root.querySelector(`[data-xfind="${d.xp}"]`); if (fb) fb.textContent = 'Pin on map'; changed(); }
    else if (d.f) { cfg[d.f] = i.value; if (d.f === 'start' && cfg.end && cfg.end < cfg.start) { cfg.end = ''; const en = root.querySelector('[data-f="end"]'); if (en) en.value = ''; } changed(d.f === 'type'); }
    else if (d.v) { cfg.venue[d.v] = i.value; changed(); }
    else if (d.t) { cfg.theme[d.t] = i.value; $$('.sw', root).forEach(s => s.classList.remove('on')); changed(); }
    else if (d.s != null) { cfg.schedule[+d.s][d.k] = i.value; changed(); }
    else if (d.n != null) { cfg.notes[+d.n][d.k] = i.value; changed(); }
    else if (d.tool) { cfg.tools[d.tool] = i.checked; changed(); }
    else if (i.id === 'vq') B.vq = i.value;
    else if (typeof extraInput === 'function') extraInput(i, cfg);
  };
  root.onkeydown = (e) => { if (e.target.id === 'vq' && e.key === 'Enter') { e.preventDefault(); venueSearch(); } };
  root.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return; const d = b.dataset; const cfg = c();
    if (d.whenTg != null) { whenToggle(cfg); changed(true); setTimeout(() => root.querySelector(hasTime(cfg.start) ? '[data-when="st"]' : '[data-when-tg]')?.focus(), 0); }
    else if (d.card) openCard(d.card);
    else if (d.b === 'close') $('#sheet').close();
    else if (d.b === 'search') venueSearch();
    else if (d.pick != null) pickVenue(B.venueResults[+d.pick]);
    else if (d.b === 'clear-venue') { cfg.venue = null; cfg.tz = ''; B.venueResults = []; B.vmsg = ''; changed(true); setTimeout(() => $('#vq')?.focus(), 0); }
    else if (d.sw) { cfg.theme.accent = d.sw; changed(true); }
    else if (d.font) { cfg.theme.font = d.font; loadFont(d.font); changed(true); }
    else if (d.themeMode) { cfg.theme.mode = d.themeMode; changed(true); }
    else if (d.b === 'add-sched') { const last = cfg.schedule[cfg.schedule.length - 1]; cfg.schedule.push({ date: last?.date || cfg.start.slice(0, 10), time: '', title: '', note: '' }); changed(true); }
    else if (d.sdel != null) { cfg.schedule.splice(+d.sdel, 1); changed(true); }
    else if (d.b === 'add-note') { cfg.notes.push({ label: '', text: '', url: '' }); changed(true); }
    else if (d.ndel != null) { cfg.notes.splice(+d.ndel, 1); changed(true); }
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
  LANG = 'en'; document.documentElement.lang = 'en';
  document.title = 'Create a page · Eventpages';
  SU = { step: 0, cfg: blankEvent('Party'), results: [], q: '', msg: '' };
  B = { cfg: SU.cfg, venueResults: [] };
  $('#app').innerHTML = `<div class="setup"><div class="su-main"></div><div class="su-preview"><div class="su-tag">Preview</div><div class="b-frame" id="su-frame"></div></div></div>`;
  suRender();
}
const suPreview = debounce(() => { const p = $('#su-frame'); if (p && getComputedStyle(p.parentElement).display !== 'none') renderEvent(SU.cfg, p, { preview: true }); }, 250);
function suTicket(c) {
  const g = (v, ph) => v ? esc(v) : `<span class="ghost">${ph}</span>`;
  const air = c.venue ? nearestAirports(c.venue.lat, c.venue.lon)[0] : null;
  return `<div class="su-ticket" style="--acc:${c.theme.accent}"><div><span class="lbl">${esc(c.type)}${c.venue && c.venue.city ? ' · ' + esc(c.venue.city) : ''}</span><b>${g(c.title, 'Your event')}</b><span>${c.start && SU.dated ? esc(dateRange(c.start, c.end)) + (c.start.length > 10 ? ' · ' + esc(fmtTime(c.start.slice(11, 16))) : '') : '<span class="ghost">Date</span>'}</span><span>${g(c.venue && c.venue.name, 'Venue')}</span></div><div class="r"><span class="lbl">Fly into</span><b>${air ? esc(air.iata) : '<span class="ghost">···</span>'}</b></div></div>`;
}
function suRender() {
  const c = SU.cfg; const n = SU.step; const m = $('.su-main'); if (!m) return;
  const prog = `<div class="prog" aria-hidden="true">${[0, 1, 2, 3].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</div>`;
  const top = `<div class="su-top">${n > 0 && n < 3 ? '<button type="button" class="link" data-su="back">← Back</button>' : '<a class="brand sm" href="#"><span class="brand-mark" aria-hidden="true"></span>Eventpages</a>'}${n === 2 ? '<button type="button" class="link strong" data-su="skip">Skip</button>' : ''}</div>`;
  let h = '', body = '', cta = '';
  if (n === 0) {
    h = 'What are you planning?';
    body = `<div class="su-types">${SETUP_TYPES.map(([type, label, sub, col]) => `<button type="button" class="su-type ${c.type === type && SU.typed ? 'on' : ''}" data-su-type="${esc(type)}"><i style="background:${col}"></i><b>${esc(label)}</b><span>${esc(sub)}</span></button>`).join('')}</div>`;
  } else if (n === 1) {
    h = 'What’s it called, and when?';
    body = `<div class="field"><label for="su-title">Name</label><input id="su-title" data-su-f="title" value="${esc(c.title)}" maxlength="80" autocomplete="off"></div>
      ${whenFieldsHTML(c, 'su', !SU.dated)}`;
    cta = `<button type="button" class="btn primary big" data-su="next" ${c.title.trim() && SU.dated ? '' : 'disabled'}>Continue</button>`;
  } else if (n === 2) {
    h = 'Where is it?';
    body = `<div class="search"><input id="su-q" placeholder="Venue name or address" value="${esc(SU.q)}" autocomplete="off"><button type="button" class="btn" data-su="search">Search</button></div>
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
  LS.set('draft', c); suPreview();
  const first = m.querySelector('#su-title, #su-q'); if (first && !first.value) setTimeout(() => first.focus(), 30);
}
document.addEventListener('click', (e) => {
  if (!SU || !e.target.closest('.setup')) return;
  const b = e.target.closest('button'); if (!b) return; const d = b.dataset; const c = SU.cfg;
  if (d.suType) {
    const type = d.suType; const keep = { title: c.title, start: c.start, end: c.end, venue: c.venue, tz: c.tz };
    SU.cfg = Object.assign(blankEvent(type), keep); SU.typed = true; B.cfg = SU.cfg; SU.step = 1; suRender();
  } else if (d.whenTg != null) { whenToggle(c); suRender(); const f = $(hasTime(c.start) ? '#su-st' : '#su-sd'); if (f) f.focus(); }
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
  LS.set('draft', c); suPreview();
});
document.addEventListener('keydown', (e) => {
  if (!SU || !e.target.closest('.setup') || e.key !== 'Enter') return;
  if (e.target.id === 'su-q') { e.preventDefault(); suSearch(); }
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
const LANGS = [['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['pt', 'Português'], ['de', 'Deutsch'], ['it', 'Italiano']];
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
const qrButtonHTML = () => `<button type="button" class="btn" data-su="qr">QR code and print card</button>`;
function openQR(cfg) {
  const url = shareURL(cfg); const q = qrSVG(url);
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
  if (i.dataset.access) { cfg.access = cfg.access || {}; cfg.access[i.dataset.access] = i.value; changed(); }
}

// ---- access and arrival ----
const ACCESS_FIELDS = [['dropoff', 'Drop-off point'], ['entrance', 'Step-free entrance'], ['parking', 'Accessible parking'], ['restrooms', 'Accessible restrooms'], ['notes', 'Other access notes']];
COMMON_CARDS.splice(3, 0, ['access', 'Access and arrival', 'Drop-off, step-free entrance']);
function extraCardBody(id, c) {
  if (id !== 'access') return '';
  const a = c.access || {};
  return ACCESS_FIELDS.map(([k, l]) => fieldWrap(l, `<input id="acc-${k}" data-access="${k}" value="${esc(a[k] || '')}">`, `acc-${k}`)).join('');
}
function accessHTML(cfg, osm) {
  const a = cfg.access || {}; const rows = ACCESS_FIELDS.filter(([k]) => a[k] && String(a[k]).trim()).map(([k, l]) => `<li class="note"><b>${esc(t(l))}</b><span>${esc(a[k])}</span></li>`);
  let st = '';
  if (osm && cfg.venue) {
    const v = cfg.venue; const sts = ['subway', 'rail', 'tram', 'ferry', 'bus'].flatMap(k => osm.transit[k] || []).filter(x => x.wheelchair === 'yes' || x.wheelchair === 'limited').sort((x, y) => x.d - y.d).slice(0, 3);
    if (sts.length) st = `<h3 class="sub-h">${t('Step-free stations nearby')}</h3><ul class="plist">${sts.map(x => `<li><div><b>${esc(x.name)}</b><span>${esc(t(x.wheelchair === 'yes' ? 'Step-free' : 'Partly step-free'))}${x.line ? ' · ' + esc(x.line.split(';').join(' · ')) : ''}</span></div><span class="dist">${esc(fmtDist(x.d, v.cc))}<small>${walkTxt(x.d)}</small></span></li>`).join('')}</ul>`;
  }
  if (!rows.length && !st) return '';
  return sec('access', t('Access and arrival'), `${rows.length ? `<ul class="links">${rows.join('')}</ul>` : ''}${st}`);
}

function extraClick(b, cfg) { if (b.dataset.act === 'qr') openQR(cfg); }
function suExtraClick(b, cfg) { if (b.dataset.su === 'qr') openQR(cfg); }

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
function whenFieldsHTML(c, p, blankDate = false) {
  const timed = hasTime(c.start); const sd = blankDate ? '' : c.start.slice(0, 10); const ed = (c.end || '').slice(0, 10);
  const fld = (k, label, type, val, extra = '') => `<div class="field"><label for="${p}-${k}">${label}</label><input id="${p}-${k}" type="${type}" data-when="${k}" value="${esc(val)}"${extra}></div>`;
  return `<div class="when ${timed ? 'timed' : ''}">
    <div class="when-row">${fld('sd', 'Starts', 'date', sd)}${timed ? fld('st', 'Time', 'time', c.start.slice(11, 16)) : ''}</div>
    <div class="when-row">${fld('ed', 'Ends <small>optional</small>', 'date', ed, sd ? ` min="${sd}"` : '')}${timed ? fld('et', 'Time', 'time', hasTime(c.end) ? c.end.slice(11, 16) : '') : ''}</div>
    <button type="button" class="link when-tg" data-when-tg>${timed ? 'Remove times' : '+ Add time'}</button>
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
  const full = location.hash.slice(1); const [h, tab] = full.split('&t=');
  maps.forEach(m => { try { m.remove(); } catch {} }); maps.clear();
  if (!h.startsWith('new') && !h.startsWith('setup')) SU = null;
  if (h.startsWith('e=')) { const c = unpackEvent(h.slice(2)); if (c) return renderViewer(c, { tab }); return renderBroken(); }
  if (h.startsWith('ex=')) { const e = window.EXAMPLES[h.slice(3)]; if (e) return renderViewer(normalize(clone(e)), { exampleId: h.slice(3), tab }); return renderBroken(); }
  if (h.startsWith('edit=')) { const c = unpackEvent(h.slice(5)); if (c) return renderBuilder(c, 'Editing a copy. Publish to get a new link; the original link keeps showing the old version.'); return renderBroken(); }
  if (h.startsWith('edit-ex=')) { const e = window.EXAMPLES[h.slice(8)]; if (e) return renderBuilder(clone(e), 'Started from an example. Change anything, then publish your own link.'); }
  if (h === 'setup') return renderSetup();
  if (h === 'new') { const d = LS.get('draft'); return d && d.title ? renderBuilder(d) : renderSetup(); }
  SU = null; renderLanding();
}

window.addEventListener('hashchange', route);
route();
window.__ep = { parseReservation, osmQuery, classify, osmKey, OVERPASS, packEvent, unpackEvent, icsText, nearestAirports, weatherFor, nearby, L };
})();
