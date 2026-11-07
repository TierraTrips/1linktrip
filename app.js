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
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- dates (all event times are wall-clock in the venue's time zone) ----------
const asUTC = (s) => new Date((s.length === 10 ? s + 'T00:00' : s) + ':00Z');
const fmt = (s, o) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...o }).format(asUTC(s));
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (s, n) => { const d = asUTC(s.slice(0, 10)); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const todayYMD = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const daysBetween = (a, b) => Math.round((asUTC(b.slice(0, 10)) - asUTC(a.slice(0, 10))) / 864e5);
const fmtTime = (hm) => { if (!hm) return ''; const [h, m] = hm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`; };

function dateRange(start, end) {
  if (!start) return 'Date to be announced';
  const s = start.slice(0, 10), e = (end || start).slice(0, 10);
  if (s === e) return fmt(s, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
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
function cacheSet(key, d) { LS.set('c2:' + key, { t: Date.now(), d }); }

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
  const c = LS.get('c2:' + key); if (c && Date.now() - c.t < 864e5) return c.d;
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
    const base = { name: t.name || '', lat: la, lon: lo, d, website: t.website || t['contact:website'] || '', street: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') };
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
    const s = wallToUTC(cfg.start, cfg.tz), e = cfg.end ? wallToUTC(cfg.end, cfg.tz) : new Date(s.getTime() + 2 * 3600e3);
    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${enc(cfg.title)}&dates=${icsStamp(s)}/${icsStamp(e)}&details=${enc((cfg.tagline ? cfg.tagline + '\n\n' : '') + url)}&location=${enc(venueLine(cfg.venue))}${cfg.tz ? '&ctz=' + enc(cfg.tz) : ''}`;
  }
};
const LYFT_CC = new Set(['us', 'ca']);
const TRAINLINE_CC = new Set(['gb', 'fr', 'de', 'it', 'es', 'nl', 'be', 'at', 'ch', 'pt', 'ie', 'dk', 'se', 'cz', 'pl', 'lu']);
const venueLine = (v) => v ? [v.name, v.address && !v.address.startsWith(v.name) ? v.address : (v.address && v.address !== v.name ? v.address : '')].filter(Boolean).join(', ') : '';
const placeLabel = (v) => [v.city, v.cc === 'us' ? v.region : v.country].filter(Boolean).join(', ');

// ---------- event model ----------
const SECTION_NAMES = {
  about: 'About', typeinfo: 'Event details', schedule: 'Schedule', links: 'Details', weather: 'Weather', map: 'Map',
  travel: 'Getting there', stay: 'Where to stay', food: 'Eat & drink', tours: 'Tours & things to do', around: 'Getting around', calendar: 'Save the date'
};
const DEFAULT_ORDER = ['about', 'typeinfo', 'schedule', 'links', 'weather', 'map', 'travel', 'stay', 'food', 'tours', 'around', 'calendar'];
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
const secName = (id, cfg) => id === 'typeinfo' ? (typeSpec(cfg)?.name || 'Event details') : SECTION_NAMES[id];
const SWATCHES = ['#3048F0', '#0B7A75', '#FF6B35', '#C2185B', '#6D28D9', '#B8860B', '#1F2937', '#2E7D32'];

function blankEvent() {
  const s = addDays(todayYMD(), 30);
  return { v: 1, type: 'Party', title: '', tagline: '', host: '', description: '', start: s + 'T18:00', end: s + 'T23:00', tz: '', venue: null, cover: '',
    theme: { accent: '#3048F0', font: 'grotesk', mode: 'light' }, sections: DEFAULT_ORDER.map(id => ({ id, on: true })), schedule: [], links: [] };
}
function normalize(c) {
  const b = blankEvent(); c = { ...b, ...c, theme: { ...b.theme, ...(c.theme || {}) } };
  const have = new Set((c.sections || []).map(s => s.id));
  c.sections = (c.sections || []).filter(s => SECTION_NAMES[s.id]).concat(DEFAULT_ORDER.filter(id => !have.has(id)).map(id => ({ id, on: id === 'typeinfo' })));
  if (!have.has('typeinfo')) { const ti = c.sections.findIndex(s => s.id === 'typeinfo'), sec = c.sections.splice(ti, 1)[0], ai = c.sections.findIndex(s => s.id === 'about'); c.sections.splice(ai + 1, 0, sec); }
  c.schedule = c.schedule || []; c.links = c.links || []; c.x = c.x && typeof c.x === 'object' ? c.x : {};
  return c;
}
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
  const ev = (uid, title, s, e, desc) => ['BEGIN:VEVENT', `UID:${uid}-${uidBase}@eventpages`, `DTSTAMP:${now}`, `DTSTART:${icsStamp(s)}`, `DTEND:${icsStamp(e)}`, `SUMMARY:${escI(title)}`, `LOCATION:${escI(venueLine(cfg.venue))}`, `DESCRIPTION:${escI(desc)}`, `URL:${url}`, 'END:VEVENT'];
  const s = wallToUTC(cfg.start, cfg.tz), e = cfg.end ? wallToUTC(cfg.end, cfg.tz) : new Date(s.getTime() + 2 * 3600e3);
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

function renderEvent(cfg, root, opts = {}) {
  const seq = ++renderSeq;
  maps.forEach(m => { try { m.remove(); } catch {} }); maps.clear();
  loadFont(cfg.theme.font);
  const v = cfg.venue; const enabled = cfg.sections.filter(s => s.on && sectionAvailable(s.id, cfg));
  const air = v ? nearestAirports(v.lat, v.lon) : [];
  root.innerHTML = `
  <article class="ev ${cfg.theme.mode === 'dark' ? 'dark' : ''}" style="${themeStyle(cfg.theme)}">
    <header class="ev-hero ${cfg.cover ? 'has-cover' : ''}">
      ${cfg.cover ? `<img class="ev-cover" src="${esc(cfg.cover)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
      <div class="ev-hero-in">
        <p class="ev-kicker">${esc(cfg.type || 'Event')}${v && v.city ? ` · ${esc(v.city)}` : ''}</p>
        <h1 class="ev-title">${esc(cfg.title || 'Untitled event')}</h1>
        ${cfg.tagline ? `<p class="ev-tagline">${esc(cfg.tagline)}</p>` : ''}
      </div>
    </header>
    <section class="stub" aria-label="Event summary">
      <div class="stub-main">
        <div class="stub-cell"><span class="lbl">Date</span><b>${esc(dateRange(cfg.start, cfg.end))}</b></div>
        ${cfg.start && cfg.start.length >= 16 ? `<div class="stub-cell"><span class="lbl">${cfg.start.slice(0, 10) === (cfg.end || '').slice(0, 10) ? 'Time' : 'Starts'}</span><b>${esc(cfg.start.slice(0, 10) === (cfg.end || '').slice(0, 10) ? timeRange(cfg.start, cfg.end) : fmtTime(cfg.start.slice(11, 16)))}</b></div>` : ''}
        <div class="stub-cell wide"><span class="lbl">Venue</span><b>${esc(v ? v.name : 'To be announced')}</b>${v && v.address && v.address !== v.name ? `<small>${esc(v.address)}</small>` : ''}</div>
      </div>
      <div class="stub-tear" aria-hidden="true"></div>
      <div class="stub-side">
        ${air[0] ? `<span class="lbl">Fly into</span><b class="code">${esc(air[0].iata)}</b><small>${esc(fmtDist(air[0].d, v.cc))} away</small>` : (cfg.start ? `<span class="lbl">${esc(fmt(cfg.start.slice(0, 10), { weekday: 'short' }))}</span><b class="code">${esc(fmt(cfg.start.slice(0, 10), { month: 'short' }).toUpperCase())}</b><small class="big-day">${esc(fmt(cfg.start.slice(0, 10), { day: 'numeric' }))}</small>` : `<span class="lbl">Date</span><b class="code">TBA</b>`)}
      </div>
      <div class="stub-actions">
        ${cfg.start ? `<button class="btn primary" data-act="ics">Add to calendar</button>` : ''}
        ${v ? ext(L.dir(v, 'transit'), 'Directions') : ''}
        <button class="btn" data-act="share">Share</button>
      </div>
    </section>
    ${enabled.length > 2 ? `<nav class="ev-nav" aria-label="Sections">${enabled.map(s => `<a href="#" data-jump="${s.id}">${esc(secName(s.id, cfg))}</a>`).join('')}</nav>` : ''}
    <div class="ev-body">
      ${enabled.map(s => `<section class="ev-sec" id="sec-${s.id}" data-sec="${s.id}"><h2 class="sec-h">${esc(secName(s.id, cfg))}</h2><div class="sec-b">${sectionHTML(s.id, cfg, air)}</div></section>`).join('')}
    </div>
    <footer class="ev-foot">
      ${opts.preview ? '' : `<a href="#edit=${packEvent(cfg)}">Edit a copy of this page</a> · <a href="#">Make your own</a>`}
      <p>Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · Weather by <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a></p>
    </footer>
  </article>`;
  const art = root.querySelector('.ev');
  wireEvent(cfg, art, seq, air, opts);
}

function sectionAvailable(id, cfg) {
  if (['weather', 'map', 'travel', 'stay', 'food', 'tours', 'around'].includes(id)) return !!cfg.venue;
  if (id === 'schedule') return cfg.schedule.some(x => x.title);
  if (id === 'links') return cfg.links.some(x => x.label && (x.url || x.note));
  if (id === 'about') return !!(cfg.description || cfg.host);
  if (id === 'typeinfo') return hasTypeInfo(cfg);
  if (id === 'calendar') return !!cfg.start;
  return true;
}
const loading = (what) => `<div class="skel" role="status"><span></span><span></span><span></span><em>Loading ${what} from OpenStreetMap…</em><em class="slow">The map servers are busy. This can take up to a minute.</em></div>`;

function sectionHTML(id, cfg, air) {
  const v = cfg.venue;
  switch (id) {
    case 'about':
      return `${cfg.host ? `<p class="host"><span class="lbl">Hosted by</span> ${esc(cfg.host)}</p>` : ''}${cfg.description.split(/\n\s*\n/).filter(Boolean).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}`;
    case 'schedule': {
      const items = cfg.schedule.filter(x => x.title).slice().sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
      const days = {}; items.forEach(x => (days[x.date || ''] = days[x.date || ''] || []).push(x));
      return Object.entries(days).map(([d, xs]) => `<div class="day"><h3 class="day-h">${d ? esc(fmt(d, { weekday: 'long', month: 'short', day: 'numeric' })) : 'Anytime'}</h3><ol class="tl">${xs.map(x => `<li><time>${esc(fmtTime(x.time)) || '—'}</time><div><b>${esc(x.title)}</b>${x.note ? `<span>${esc(x.note)}</span>` : ''}</div></li>`).join('')}</ol></div>`).join('');
    }
    case 'links':
      return `<ul class="links">${cfg.links.filter(x => x.label && (x.url || x.note)).map(x => x.url
        ? `<li><a href="${esc(x.url)}" target="_blank" rel="noopener"><b>${esc(x.label)}</b><span>${esc(hostOf(x.url))}</span>${arrow}</a></li>`
        : `<li class="note"><b>${esc(x.label)}</b><span>${esc(x.note)}</span></li>`).join('')}</ul>`;
    case 'weather': return `<div data-slot="weather"><div class="skel" role="status"><span></span><span></span><em>Loading weather…</em></div></div>`;
    case 'map': return `<div class="map-wrap"><div class="map" data-slot="map" role="region" aria-label="Map of the venue and surroundings"></div><div class="map-legend" data-slot="legend"></div></div>`;
    case 'typeinfo': return typeInfoHTML(cfg);
    case 'travel': return travelHTML(cfg, air);
    case 'stay': return stayHTML(cfg);
    case 'food': return `<div data-slot="food">${loading('places to eat')}</div>`;
    case 'tours': return toursHTML(cfg);
    case 'around': return aroundHTML(cfg);
    case 'calendar': return `<div class="cal"><p><b>${esc(cfg.title)}</b><br>${esc(dateRange(cfg.start, cfg.end))}${cfg.start.length >= 16 ? ' · ' + esc(timeRange(cfg.start, cfg.end)) : ''}${cfg.tz ? ` <span class="muted">(${esc(cfg.tz.replace(/_/g, ' '))} time)</span>` : ''}</p><div class="btns"><button class="btn primary" data-act="ics">Download .ics</button>${ext(L.gcal(cfg, location.href), 'Google Calendar')}</div>${cfg.schedule.some(x => x.date && x.time && x.title) ? '<p class="muted small">The .ics file includes every timed schedule item.</p>' : ''}</div>`;
  }
  return '';
}
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

function typeInfoHTML(cfg) {
  const sp = typeSpec(cfg), d = typeData(cfg); if (!sp) return '';
  const v = cfg.venue; const lab = Object.fromEntries(sp.fields.map(([k, l]) => [k, l]));
  const has = (k) => { const f = sp.fields.find(x => x[0] === k); return f && filled(f[2], d[k]); };
  const dt = (s) => s ? (s.length > 10 ? `${fmt(s.slice(0, 10), { weekday: 'short', month: 'short', day: 'numeric' })}, ${fmtTime(s.slice(11, 16))}` : fmt(s, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })) : '';
  const linkRow = (label, url, sub) => `<li><a href="${esc(url)}" target="_blank" rel="noopener"><b>${esc(label)}</b><span>${esc(sub || hostOf(url))}</span>${arrow}</a></li>`;
  const noteRow = (label, text) => `<li class="note"><b>${esc(label)}</b><span>${esc(text)}</span></li>`;
  const placeURL = (p) => p.lat != null ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}` : L.place(p.q, v ? placeLabel(v) : '');
  const rows = []; const out = [];
  // time-line style rows (concert running order)
  const tl = [];
  if (has('doors')) tl.push([d.doors, 'Doors']);
  if (has('openerAt') || has('opener')) tl.push([d.openerAt || '', d.opener || lab.opener]);
  if (has('headlinerAt') || has('headliner')) tl.push([d.headlinerAt || '', d.headliner || lab.headliner]);
  if (tl.length) out.push(`<ol class="tl">${tl.sort((a, b) => (a[0] || '99').localeCompare(b[0] || '99')).map(([t, n]) => `<li><time>${esc(fmtTime(t)) || '—'}</time><div><b>${esc(n)}</b></div></li>`).join('')}</ol>`);
  for (const [k, label, kind] of sp.fields) {
    if (['doors', 'opener', 'openerAt', 'headliner', 'headlinerAt', 'rsvpBy', 'blockHotel', 'blockUrl', 'blockCode', 'blockBy', 'packetWhen', 'badgeWhen', 'closuresUrl', 'spots', 'speakers'].includes(k) || !filled(kind, d[k])) continue;
    const val = d[k];
    if (k === 'rsvp') rows.push(linkRow('RSVP', val, d.rsvpBy ? `Reply by ${dt(d.rsvpBy)}` : ''));
    else if (k === 'course' && /\.(jpe?g|png|webp|gif)(\?|$)/i.test(val)) out.push(`<a class="course-img" href="${esc(val)}" target="_blank" rel="noopener"><img src="${esc(val)}" alt="Course map" loading="lazy" referrerpolicy="no-referrer"></a>`);
    else if (k === 'course') rows.push(linkRow('Course map', val, /\.gpx(\?|$)/i.test(val) ? 'GPX file' : ''));
    else if (k === 'closures') rows.push(d.closuresUrl ? linkRow('Road closures', d.closuresUrl, val) : noteRow('Road closures', val));
    else if (k === 'packet' || k === 'badge') { const w = d[k + 'When']; rows.push(`<li><a href="${esc(L.place(val, v ? placeLabel(v) : ''))}" target="_blank" rel="noopener"><b>${esc(label)}</b><span>${esc([val, dt(w)].filter(Boolean).join(' · '))}</span>${arrow}</a></li>`); }
    else if (kind === 'place') rows.push(`<li><a href="${esc(placeURL(val))}" target="_blank" rel="noopener"><b>${esc(label)}</b><span>${esc(val.q)}</span>${arrow}</a></li>`);
    else if (kind === 'links') val.filter(l => l.label && l.url).forEach(l => rows.push(linkRow(`${label === 'Teams' ? '' : label + ' · '}${l.label}`, l.url)));
    else if (kind === 'url') rows.push(linkRow(label, val));
    else rows.push(noteRow(label, val));
  }
  if (!has('packet') && has('packetWhen')) rows.push(noteRow('Packet pickup', dt(d.packetWhen)));
  if (!has('badge') && has('badgeWhen')) rows.push(noteRow('Badge pickup', dt(d.badgeWhen)));
  if (!has('rsvp') && has('rsvpBy')) rows.push(noteRow('RSVP', `Reply by ${dt(d.rsvpBy)}`));
  if (!has('closures') && has('closuresUrl')) rows.push(linkRow('Road closures', d.closuresUrl));
  if (rows.length) out.push(`<ul class="links">${rows.join('')}</ul>`);
  if (['blockHotel', 'blockUrl', 'blockCode', 'blockBy'].some(has)) {
    const sub = [d.blockCode ? `Code ${d.blockCode}` : '', d.blockBy ? `Book by ${dt(d.blockBy)}` : ''].filter(Boolean).join(' · ');
    out.push(`<h3 class="sub-h">Room block</h3><ul class="links">${d.blockUrl ? linkRow(d.blockHotel || 'Book the room block', d.blockUrl, sub || hostOf(d.blockUrl)) : noteRow(d.blockHotel || 'Room block', sub)}</ul>`);
  }
  const lines = (k) => String(d[k] || '').split('\n').map(x => x.trim()).filter(Boolean);
  if (has('spots')) out.push(`<h3 class="sub-h">${esc(lab.spots)}</h3><ul class="links">${lines('spots').map(x => `<li><a href="${esc(L.place(x, v ? placeLabel(v) : ''))}" target="_blank" rel="noopener"><b>${esc(x)}</b><span>Google Maps</span>${arrow}</a></li>`).join('')}</ul>`);
  if (has('speakers')) out.push(`<h3 class="sub-h">${esc(lab.speakers)}</h3><ul class="links">${lines('speakers').map(x => { const [n, ...r] = x.split(/\s+[—–-]\s+|,\s+/); return `<li class="note"><b>${esc(n)}</b>${r.length ? `<span>${esc(r.join(', '))}</span>` : ''}</li>`; }).join('')}</ul>`);
  return out.join('');
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
  const v = cfg.venue; const around = cfg.sections.some(s => s.id === 'around' && s.on);
  return TRAVEL_MODES.filter(([k]) => k === 'fly' ? air.length > 0 : k === 'train' ? hasTrains(v) : k === 'transit' ? around : true);
}
function modeBarHTML(cfg, air) {
  const ms = travelModes(cfg, air); if (ms.length < 2) return '';
  return `<div class="chips mode-bar" role="group" aria-label="How are you getting there?"><button type="button" class="chip on" data-tmode="all" aria-pressed="true">All</button>${ms.map(([k, l]) => `<button type="button" class="chip" data-tmode="${k}" aria-pressed="false">${l}</button>`).join('')}</div>`;
}
function travelHTML(cfg, air) {
  const t = tripDates(cfg); const o = LS.get('origin');
  const oa = o && airportByCode(o);
  return `${modeBarHTML(cfg, air)}<div class="trip">
    <div class="field origin" data-mode="fly train"><label for="ep-origin">Flying from</label>
      <div class="ac"><input id="ep-origin" autocomplete="off" placeholder="City or airport code" value="${oa ? esc(`${oa[2] || oa[1]} (${oa[0]})`) : ''}" data-code="${oa ? oa[0] : ''}"><ul class="ac-list" hidden></ul></div></div>
    <div class="field"><label for="ep-arrive">Arrive</label><input type="date" id="ep-arrive" value="${t.arrive}"></div>
    <div class="field"><label for="ep-leave">Leave</label><input type="date" id="ep-leave" value="${t.leave}"></div>
  </div>
  <div data-slot="flights" data-mode="fly"></div>
  ${hasTrains(cfg.venue) ? '<div data-slot="trains" data-mode="train"></div>' : ''}
  <div data-slot="rental" data-mode="rental"></div>
  <div data-mode="drive"><h3 class="sub-h">Driving</h3><div class="row-links">${ext(L.dir(cfg.venue, 'driving'), `Directions to the venue <small>Google Maps</small>`, 'row-link')}${ext(L.place('parking near ' + cfg.venue.name, placeLabel(cfg.venue)), `Parking nearby <small>Google Maps</small>`, 'row-link')}</div></div>
  <div data-mode="transit"><h3 class="sub-h">Transit</h3><div class="row-links">${ext(L.dir(cfg.venue, 'transit'), `Transit directions to the venue <small>Google Maps</small>`, 'row-link')}</div></div>`;
}
function flightsHTML(cfg, air) {
  const t = tripDates(cfg); const o = LS.get('origin'); const v = cfg.venue;
  if (!air.length) return `<p class="muted">No airports with scheduled flights within 220 km of the venue.</p>`;
  return `<h3 class="sub-h">Nearest airports</h3><ul class="airports">${air.map(a => `<li>
    <div class="ap-code">${esc(a.iata)}</div>
    <div class="ap-info"><b>${esc(a.name)}</b><span>${esc(fmtDist(a.d, v.cc))} from the venue${a.large ? '' : ' · regional'}</span></div>
    <div class="btns">
      ${o === a.iata ? '<span class="muted small">That is your home airport.</span>' : `${ext(L.gflights(a.iata, o, t.arrive, t.leave), 'Google Flights')}
      ${o ? ext(L.kayak(o, a.iata, t.arrive, t.leave), 'Kayak') + ext(L.skyscanner(o, a.iata, t.arrive, t.leave), 'Skyscanner') : ''}`}
    </div></li>`).join('')}</ul>
    ${o ? '' : '<p class="muted small">Add the airport you are flying from to compare fares on Kayak and Skyscanner too.</p>'}`;
}
function trainsHTML(cfg) {
  const v = cfg.venue; const o = LS.get('origin'); const oa = o && airportByCode(o);
  const from = oa ? (oa[2] || oa[1]) : '';
  const to = v.city || v.name;
  const items = [];
  if (from) items.push(ext(L.rome2rio(from, to), `Every way from ${esc(from)} to ${esc(to)} <small>Rome2Rio</small>`, 'row-link'));
  if (v.cc === 'us') items.push(ext('https://www.amtrak.com/home', 'Trains across the US <small>Amtrak</small>', 'row-link'));
  if (TRAINLINE_CC.has(v.cc)) items.push(ext('https://www.thetrainline.com/', 'Trains and coaches in Europe <small>Trainline</small>', 'row-link'));
  return `<h3 class="sub-h">Train and bus</h3><div class="row-links">${items.join('')}</div>${from ? '' : '<p class="muted small">Add where you are coming from to see train and bus routes on Rome2Rio.</p>'}`;
}
function rentalHTML(cfg, air) {
  const t = tripDates(cfg); const v = cfg.venue;
  const items = air.slice(0, 2).map(a => ext(L.kayakCars(a.iata, t.arrive, t.leave), `Rental cars at ${esc(a.iata)} <small>Kayak</small>`, 'row-link'));
  items.push(ext(L.place('car rental', placeLabel(v) || v.name), `Rental desks in ${esc(v.city || v.name)} <small>Google Maps</small>`, 'row-link'));
  return `<h3 class="sub-h">Rental car</h3><div class="row-links">${items.join('')}</div>`;
}
function stayHTML(cfg) {
  const t = tripDates(cfg); const v = cfg.venue; const q = placeLabel(v) || v.name;
  return `<div class="trip trip-2">
      <div class="field"><label>Check in</label><input type="date" data-k="arrive" value="${t.arrive}"></div>
      <div class="field"><label>Check out</label><input type="date" data-k="leave" value="${t.leave}"></div>
      <div class="field narrow"><label>Guests</label><input type="number" min="1" max="16" data-k="guests" value="${t.guests}"></div>
    </div>
    <div class="row-links" data-slot="stay-links">${stayLinks(cfg)}</div>
    <h3 class="sub-h">Hotels near the venue</h3>
    <div data-slot="hotels">${loading('hotels')}</div>`;
}
function stayLinks(cfg) {
  const t = tripDates(cfg); const v = cfg.venue; const q = placeLabel(v) || v.name; const n = t.guests || 2;
  return [ext(L.booking(q, t.arrive, t.leave, n), `Hotels in ${esc(v.city || q)} <small>Booking.com</small>`, 'row-link'),
    ext(L.airbnb(q, t.arrive, t.leave, n), `Homes and apartments <small>Airbnb</small>`, 'row-link'),
    ext(L.expedia(q, t.arrive, t.leave, n), `Hotels and packages <small>Expedia</small>`, 'row-link')].join('');
}
function toursHTML(cfg) {
  return `<div class="row-links" data-slot="tour-links">${tourLinks(cfg)}</div>
    <h3 class="sub-h">Sights near the venue</h3>
    <div data-slot="sights">${loading('sights')}</div>`;
}
function tourLinks(cfg) {
  const t = tripDates(cfg); const v = cfg.venue; const q = v.city || placeLabel(v) || v.name; const qa = placeLabel(v) || q;
  return [ext(L.gyg(q, t.arrive, t.leave), `Tours in ${esc(q)} <small>GetYourGuide</small>`, 'row-link'),
    ext(L.viator(q), `Tours and day trips <small>Viator</small>`, 'row-link'),
    ext(L.airbnbExp(qa, t.arrive, t.leave), `Experiences with locals <small>Airbnb</small>`, 'row-link')].join('');
}
function sightsHTML(cfg, data) {
  const v = cfg.venue; const xs = data.sights || [];
  if (!xs.length) return `<p class="muted">No museums, viewpoints or attractions are mapped within 3 km of the venue.</p>${ext(L.place('things to do', placeLabel(v)), 'Search things to do on Google Maps', 'btn')}`;
  return `<ul class="plist rich">${xs.slice(0, 8).map(x => `<li>
    <div><b>${esc(x.name)}</b><span>${esc(x.kind)}</span>
      <div class="mini">${ext(L.place(x.name, placeLabel(v)), 'Google Maps', 'mini-b')}${x.website ? ext(x.website, 'Website', 'mini-b') : ''}</div></div>
    <span class="dist">${esc(fmtDist(x.d, v.cc))}<small>${x.d < 2000 ? walkMin(x.d) + ' min walk' : 'from venue'}</small></span></li>`).join('')}</ul>`;
}
function aroundHTML(cfg) {
  const v = cfg.venue; const name = v.name;
  const modes = [['transit', 'Transit', 'transit'], ['walking', 'Walk', ''], ['bicycling', 'Bike', ''], ['driving', 'Drive', 'drive rental']];
  const tag = (m) => m ? ` data-mode="${m}"` : '';
  return `<div class="modes">${modes.map(([m, l, k]) => ext(L.dir(v, m), `<span>${l}</span><small>Google Maps</small>`, 'mode').replace('<a ', `<a${tag(k)} `)).join('')}
    ${ext(L.uber(v, name), '<span>Uber</span><small>Drop-off set</small>', 'mode')}
    ${LYFT_CC.has(v.cc) ? ext(L.lyft(v), '<span>Lyft</span><small>Drop-off set</small>', 'mode') : ''}</div>
    <div data-slot="transit" data-mode="transit">${loading('nearby stations')}</div>`;
}

const TRANSIT_LABELS = { subway: 'Subway & metro', rail: 'Rail', tram: 'Light rail & tram', bus: 'Bus stops', bike: 'Bike share & rental', ferry: 'Ferry' };
function transitHTML(cfg, data) {
  const v = cfg.venue; const groups = Object.entries(data.transit).filter(([, xs]) => xs.length);
  if (!groups.length) return `<p class="muted">No mapped stations or stops within walking distance. Rideshare or driving is the way in.</p>`;
  return `<div class="tgroups">${groups.map(([k, xs]) => `<div class="tgroup"><h3 class="sub-h">${TRANSIT_LABELS[k]}</h3><ul class="plist">${xs.map(x => `<li>
    <div><b>${esc(x.name)}</b>${x.line ? `<span>${esc(x.line.split(';').join(' · '))}</span>` : ''}</div>
    <a class="dist" href="${esc(`https://www.google.com/maps/dir/?api=1&origin=${x.lat},${x.lon}&destination=${v.lat},${v.lon}&travelmode=walking`)}" target="_blank" rel="noopener" title="Walking directions to the venue">${esc(fmtDist(x.d, v.cc))}<small>${walkMin(x.d)} min walk</small></a></li>`).join('')}</ul></div>`).join('')}</div>`;
}
function foodHTML(cfg, data, filter = 'all') {
  const v = cfg.venue; const t = tripDates(cfg); const date = cfg.start.slice(0, 10);
  const counts = { all: data.food.length }; data.food.forEach(f => counts[f.kind] = (counts[f.kind] || 0) + 1);
  if (!data.food.length) return `<p class="muted">No restaurants, cafés or bars are mapped within 900 m of the venue.</p>${ext(L.place('restaurants', placeLabel(v)), 'Search restaurants on Google Maps', 'btn')}`;
  const list = data.food.filter(f => filter === 'all' || f.kind === filter).slice(0, 12);
  const chip = (k, l) => counts[k] ? `<button class="chip ${filter === k ? 'on' : ''}" data-food="${k}">${l} <span>${counts[k]}</span></button>` : '';
  return `<div class="chips">${chip('all', 'All')}${chip('restaurant', 'Restaurants')}${chip('cafe', 'Cafés')}${chip('bar', 'Bars')}</div>
  <ul class="plist rich">${list.map(f => `<li>
    <div><b>${esc(f.name)}</b><span>${esc([f.kind === 'cafe' ? 'café' : f.kind, f.cuisine].filter(Boolean).join(' · '))}</span>
      <div class="mini">${f.kind !== 'cafe' ? ext(L.opentable(f.name, v, date, t.guests || 2), 'Reserve · OpenTable', 'mini-b') : ''}${ext(L.place(f.name, f.street ? `${f.street}, ${v.city}` : placeLabel(v)), 'Google Maps', 'mini-b')}${f.website ? ext(f.website, 'Website', 'mini-b') : ''}</div></div>
    <span class="dist">${esc(fmtDist(f.d, v.cc))}<small>${walkMin(f.d)} min walk</small></span></li>`).join('')}</ul>`;
}
function hotelsHTML(cfg, data) {
  const v = cfg.venue; const t = tripDates(cfg);
  if (!data.hotels.length) return `<p class="muted">No hotels are mapped within 3 km of the venue. Try the searches above.</p>`;
  return `<ul class="plist rich">${data.hotels.slice(0, 8).map(h => `<li>
    <div><b>${esc(h.name)}</b><span>${esc([h.kind, h.stars ? `${h.stars}★` : ''].filter(Boolean).join(' · '))}</span>
      <div class="mini">${ext(L.booking(`${h.name}, ${v.city || placeLabel(v)}`, t.arrive, t.leave, t.guests || 2), 'Check rates · Booking.com', 'mini-b')}${ext(L.place(h.name, h.street ? `${h.street}, ${v.city}` : placeLabel(v)), 'Google Maps', 'mini-b')}${h.website ? ext(h.website, 'Website', 'mini-b') : ''}</div></div>
    <span class="dist">${esc(fmtDist(h.d, v.cc))}<small>${h.d < 2000 ? walkMin(h.d) + ' min walk' : 'from venue'}</small></span></li>`).join('')}</ul>`;
}
function weatherHTML(w, cfg) {
  const heads = { forecast: 'Forecast', recent: 'Recent weather', past: 'What the weather was', typical: `Typical for these dates · ${w.from}–${w.to} average` };
  const r = Math.round;
  return `<p class="wx-head"><span class="lbl">${esc(heads[w.kind])}</span>${w.partial ? '<span class="muted small">Later days appear as they come into the 16-day forecast.</span>' : ''}</p>
  <div class="wx">${w.days.map(d => {
    const [label, ic] = w.kind === 'typical' ? (d.wet / (d.of || 1) >= 0.5 ? ['Often wet', 'rain'] : d.wet ? ['Mostly dry', 'part'] : ['Usually dry', 'sun']) : WMO(d.code);
    return `<div class="wx-d"><span class="wx-date">${esc(fmt(d.date, { weekday: 'short' }))}<small>${esc(fmt(d.date, { month: 'short', day: 'numeric' }))}</small></span>${icon(ic)}
      <span class="wx-t"><b>${r(d.hi)}°</b><span>${r(d.lo)}°F</span></span>
      <span class="wx-x">${w.kind === 'typical' ? `Rain ${d.wet} of ${d.of} yrs` : w.kind === 'past' ? `${d.precip ? d.precip.toFixed(2) + ' in' : 'Dry'}` : d.pop != null ? `${d.pop}% rain` : esc(label)}</span>
      <span class="wx-l">${esc(label)}</span></div>`;
  }).join('')}</div>`;
}

function wireEvent(cfg, art, seq, air, opts) {
  const v = cfg.venue; const alive = () => seq === renderSeq && document.body.contains(art);
  const slot = (n) => art.querySelector(`[data-slot="${n}"]`);
  art.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act],[data-jump],[data-food],[data-tmode]'); if (!a) return;
    if (a.dataset.tmode) { const k = a.dataset.tmode; const sel = new Set(LS.get(eventKey(cfg), [])); k === 'all' ? sel.clear() : sel.has(k) ? sel.delete(k) : sel.add(k); LS.set(eventKey(cfg), [...sel]); applyModes(); }
    else if (a.dataset.act === 'ics') downloadICS(cfg);
    else if (a.dataset.act === 'share') shareEvent(cfg, opts);
    else if (a.dataset.jump) { e.preventDefault(); art.querySelector('#sec-' + a.dataset.jump)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }
    else if (a.dataset.food) { const s = slot('food'); s.innerHTML = foodHTML(cfg, art._osm, a.dataset.food); }
  });
  if (!v) return;

  // travel mode filter: show content for every picked mode; nothing picked = all
  const applyModes = () => {
    const bar = art.querySelector('.mode-bar');
    const avail = bar && !bar.hidden ? $$('[data-tmode]', bar).filter(b => !b.hidden).map(b => b.dataset.tmode) : [];
    const sel = new Set((LS.get(eventKey(cfg), []) || []).filter(k => avail.includes(k)));
    if (bar) $$('[data-tmode]', bar).forEach(b => { const on = b.dataset.tmode === 'all' ? !sel.size : sel.has(b.dataset.tmode); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    $$('[data-mode]', art).forEach(el => { el.hidden = !!sel.size && !el.dataset.mode.split(' ').some(k => sel.has(k)); });
  };
  art._applyModes = applyModes;

  // trip date + origin inputs drive the deep links
  const refreshTrip = () => {
    if (slot('flights')) slot('flights').innerHTML = flightsHTML(cfg, air);
    if (slot('trains')) slot('trains').innerHTML = trainsHTML(cfg);
    if (slot('rental')) slot('rental').innerHTML = rentalHTML(cfg, air);
    if (slot('stay-links')) slot('stay-links').innerHTML = stayLinks(cfg);
    if (slot('tour-links')) slot('tour-links').innerHTML = tourLinks(cfg);
    if (art._osm && slot('hotels')) slot('hotels').innerHTML = hotelsHTML(cfg, art._osm);
    $$('[data-k], #ep-arrive, #ep-leave', art).forEach(i => { const t = tripDates(cfg); const k = i.dataset.k || (i.id === 'ep-arrive' ? 'arrive' : 'leave'); if (document.activeElement !== i) i.value = t[k]; });
  };
  const tripKey = 'trip:' + cfg.start.slice(0, 10) + ':' + (cfg.end || cfg.start).slice(0, 10);
  art.addEventListener('change', (e) => {
    const i = e.target; const k = i.dataset.k || (i.id === 'ep-arrive' ? 'arrive' : i.id === 'ep-leave' ? 'leave' : null);
    if (!k) return;
    const t = tripDates(cfg); t[k] = k === 'guests' ? Math.max(1, Math.min(16, +i.value || 2)) : i.value;
    if (t.leave <= t.arrive) t.leave = addDays(t.arrive, 1);
    LS.set(tripKey, t); refreshTrip();
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

  if (slot('weather') && cfg.start) {
    weatherFor(cfg).then(w => { if (alive()) slot('weather').innerHTML = weatherHTML(w, cfg); })
      .catch(() => { if (alive()) slot('weather').innerHTML = `<p class="muted">Weather is unavailable right now. Try reloading the page.</p>`; });
  }
  const mapEl = slot('map'); let map, layers = {};
  if (mapEl && window.L) {
    map = window.L.map(mapEl, { scrollWheelZoom: false, zoomControl: false, attributionControl: true }).setView([v.lat, v.lon], 15);
    maps.add(map); window.L.control.zoom({ position: 'topright' }).addTo(map);
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
    const pin = window.L.divIcon({ className: 'pin', html: `<span style="--accent:${cfg.theme.accent}"></span>`, iconSize: [30, 40], iconAnchor: [15, 38] });
    window.L.marker([v.lat, v.lon], { icon: pin, title: v.name, zIndexOffset: 1000 }).addTo(map).bindPopup(`<b>${esc(v.name)}</b><br>${esc(v.address || '')}`);
    const sp = typeSpec(cfg), td = typeData(cfg), pts = [[v.lat, v.lon]];
    if (sp && cfg.sections.some(s => s.id === 'typeinfo' && s.on)) sp.fields.filter(f => f[2] === 'place' && td[f[0]] && td[f[0]].lat != null).forEach(([k, label]) => {
      const p = td[k]; pts.push([p.lat, p.lon]);
      const ic = window.L.divIcon({ className: 'tpin', html: `<span>${esc(label)}</span>`, iconSize: null, iconAnchor: [0, 0] });
      window.L.marker([p.lat, p.lon], { icon: ic, title: `${label}: ${p.q}`, zIndexOffset: 900 }).addTo(map).bindPopup(`<b>${esc(label)}</b><br>${esc(p.q)}`);
    });
    if (pts.length > 1) map.fitBounds(pts, { padding: [50, 50], maxZoom: 16 });
    setTimeout(() => map.invalidateSize(), 120);
  }
  const needOSM = ['food', 'stay', 'tours', 'around', 'map'].some(id => cfg.sections.find(s => s.id === id && s.on));
  if (needOSM) {
    nearby(v.lat, v.lon).then(d => {
      if (!alive()) return; art._osm = d;
      const ft = art.querySelector('.ev-foot p'); if (ft && d.snapshot) ft.insertAdjacentHTML('beforeend', ` · Nearby places as mapped on ${esc(d.snapshot)}`);
      if (slot('food')) slot('food').innerHTML = foodHTML(cfg, d);
      if (slot('hotels')) slot('hotels').innerHTML = hotelsHTML(cfg, d);
      if (slot('sights')) slot('sights').innerHTML = sightsHTML(cfg, d);
      if (slot('transit')) slot('transit').innerHTML = transitHTML(cfg, d);
      if (!Object.values(d.transit).some(xs => xs.length)) { const tb = art.querySelector('[data-tmode="transit"]'); if (tb) { tb.hidden = true; const bar = tb.parentElement; if ($$('[data-tmode]:not([hidden])', bar).length < 3) bar.hidden = true; } }
      applyModes();
      if (map) {
        const mk = (color) => ({ radius: 6, color: '#fff', weight: 1.5, fillColor: color, fillOpacity: .95 });
        const add = (key, items, color, label) => { if (!items.length) return; layers[key] = { label, color, layer: window.L.layerGroup(items.map(x => window.L.circleMarker([x.lat, x.lon], mk(color)).bindPopup(`<b>${esc(x.name)}</b><br>${esc(fmtDist(x.d, v.cc))} from venue`))).addTo(map) }; };
        add('food', d.food.slice(0, 25), '#E4572E', 'Food & drink');
        add('hotels', d.hotels.slice(0, 15), '#7B4FD6', 'Hotels');
        if (cfg.sections.some(s => s.id === 'tours' && s.on)) add('sights', (d.sights || []).slice(0, 12), '#0B9A6D', 'Sights');
        add('transit', [].concat(...Object.values(d.transit)), '#1D8FD8', 'Transit');
        const lg = slot('legend');
        lg.innerHTML = Object.entries(layers).map(([k, x]) => `<button class="chip on" data-layer="${k}" aria-pressed="true"><i style="background:${x.color}"></i>${x.label}</button>`).join('');
        lg.addEventListener('click', (e) => { const b = e.target.closest('[data-layer]'); if (!b) return; const l = layers[b.dataset.layer]; const on = map.hasLayer(l.layer); on ? map.removeLayer(l.layer) : l.layer.addTo(map); b.classList.toggle('on', !on); b.setAttribute('aria-pressed', String(!on)); });
      }
    }).catch(() => {
      if (!alive()) return;
      const msg = (what, q) => `<p class="muted">Nearby ${what} could not be loaded from OpenStreetMap right now.</p>${ext(L.place(q, placeLabel(v)), `Search ${what} on Google Maps`, 'btn')}`;
      if (slot('food')) slot('food').innerHTML = msg('restaurants', 'restaurants near ' + v.name);
      if (slot('hotels')) slot('hotels').innerHTML = msg('hotels', 'hotels near ' + v.name);
      if (slot('sights')) slot('sights').innerHTML = msg('sights', 'things to do near ' + v.name);
      if (slot('transit')) slot('transit').innerHTML = `<p class="muted">Nearby stations could not be loaded right now. The Transit button above has live directions.</p>`;
    });
  }
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
  document.title = 'Eventpages — a page for your event, with the trip attached';
  const ex = window.EXAMPLES; const draft = LS.get('draft');
  $('#app').innerHTML = `
  <main class="land">
    <header class="land-top"><a class="brand" href="#"><span class="brand-mark" aria-hidden="true"></span>Eventpages</a><a class="btn primary" href="#new">Create a page</a></header>
    <section class="land-hero">
      <div class="land-copy">
        <h1>One link for the event <em>and</em> the trip to it.</h1>
        <p class="lede">Make a page for a wedding, a conference or a weekend away. Guests get the schedule, live weather, a map, flights, places to stay, tables to book and the train to the door.</p>
        <div class="btns"><a class="btn primary big" href="#new">${draft && draft.title ? 'Continue your draft' : 'Create a page'}</a><a class="btn big" href="#ex=tulum-wedding">See an example</a></div>
        <p class="muted small">Free, no account. The whole page lives in the link you share.</p>
      </div>
      <div class="land-stack" aria-hidden="true">${Object.entries(ex).map(([id, e], i) => miniTicket(id, e, i)).join('')}</div>
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
      <h2>What every page can show</h2>
      <dl>
        <div><dt>Weather</dt><dd>The live forecast once the event is within 16 days, and the typical weather for those dates before that.</dd></div>
        <div><dt>Map</dt><dd>The venue pinned, with restaurants, hotels and stations around it.</dd></div>
        <div><dt>Flights</dt><dd>The nearest airports, with fares searched for your dates on Google Flights, Kayak and Skyscanner.</dd></div>
        <div><dt>Stays</dt><dd>Hotels near the venue, plus Booking.com, Airbnb and Expedia searches with the dates filled in.</dd></div>
        <div><dt>Tables</dt><dd>Restaurants, cafés and bars within walking distance, each with a link to reserve.</dd></div>
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
function renderViewer(cfg, { exampleId } = {}) {
  document.title = (cfg.title || 'Event') + ' · Eventpages';
  const editHref = exampleId ? `#edit-ex=${exampleId}` : `#edit=${location.hash.slice(3)}`;
  $('#app').innerHTML = `<div class="viewer"><div class="vbar"><a class="brand sm" href="#"><span class="brand-mark" aria-hidden="true"></span>Eventpages</a>${exampleId ? `<span class="vbar-note">Example page</span>` : ''}<a class="btn sm" href="${editHref}">${exampleId ? 'Customize this' : 'Edit a copy'}</a></div><div id="ev-root"></div></div>`;
  renderEvent(cfg, $('#ev-root'), {});
  const foot = $('.ev-foot a'); if (foot && exampleId) foot.setAttribute('href', editHref);
  window.scrollTo(0, 0);
}

// ---------- builder ----------
let B = null; // builder state
function renderBuilder(cfg, source) {
  document.title = 'Create a page · Eventpages';
  B = { cfg: normalize(cfg), venueResults: [], tab: 'edit' };
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
  <dialog id="pub"><form method="dialog" class="pub">
    <h2>Your page is ready to share</h2>
    <p class="muted">Anyone with this link sees the page. The event lives inside the link, so publish again after you edit and share the new link.</p>
    <textarea id="pub-url" readonly rows="4"></textarea>
    <div class="btns"><button type="button" class="btn primary" data-act="copy">Copy link</button><button type="button" class="btn" data-act="native-share" hidden>Share…</button><a class="btn" id="pub-open" href="#" target="_blank" rel="noopener">Open page</a><button class="btn ghost">Close</button></div>
  </form></dialog>`;
  buildForm();
  const bl = $('.builder');
  bl.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]'); if (t && t.tagName === 'BUTTON') { bl.dataset.tab = t.dataset.tab; $$('.seg button').forEach(b => b.setAttribute('aria-selected', String(b === t))); if (t.dataset.tab === 'preview') { maps.forEach(m => m.invalidateSize()); window.scrollTo(0, 0); } }
    if (e.target.closest('[data-act="publish"]')) publish();
  });
  const dlg = $('#pub');
  dlg.addEventListener('click', (e) => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'copy') copy($('#pub-url').value);
    if (a.dataset.act === 'native-share') navigator.share({ title: B.cfg.title, url: $('#pub-url').value }).catch(() => {});
  });
  preview();
}
function publish() {
  const c = B.cfg; const problems = [];
  if (!c.title.trim()) problems.push('a title');
  if (!c.venue) problems.push('a venue');
  if (!c.start) problems.push('a start date');
  if (problems.length) { toast('Add ' + problems.join(', ') + ' first'); return; }
  const url = shareURL(c); $('#pub-url').value = url; $('#pub-open').href = url;
  $('[data-act="native-share"]').hidden = !navigator.share;
  LS.set('published:' + Date.now(), { title: c.title, url });
  $('#pub').showModal();
}
const savedraft = debounce(() => LS.set('draft', B.cfg), 300);
const preview = debounce(() => { const p = $('#preview'); if (!p) return; const y = p.parentElement.scrollTop; renderEvent(B.cfg, p, { preview: true, shareUrl: shareURL(B.cfg) }); p.parentElement.scrollTop = y; }, 350);
function changed(rebuild) { savedraft(); preview(); if (rebuild) buildForm(); }

function buildForm() {
  const c = B.cfg; const f = $('.b-form'); const keepNote = f.querySelector('.b-note');
  const field = (label, html, hint = '') => `<div class="field"><label>${label}</label>${html}${hint ? `<p class="hint">${hint}</p>` : ''}</div>`;
  f.innerHTML = `${keepNote ? keepNote.outerHTML : ''}
  <fieldset><legend>Basics</legend>
    ${field('Event type', `<select data-f="type">${TYPES.map(t => `<option ${t === c.type ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}
    ${field('Title', `<input data-f="title" value="${esc(c.title)}" placeholder="Maya & Theo" maxlength="80">`)}
    ${field('Tagline', `<input data-f="tagline" value="${esc(c.tagline)}" placeholder="Getting married on the beach in Tulum" maxlength="140">`)}
    ${field('Hosted by', `<input data-f="host" value="${esc(c.host)}" placeholder="Optional">`)}
    ${field('Description', `<textarea data-f="description" rows="5" placeholder="What guests should know. Leave a blank line between paragraphs.">${esc(c.description)}</textarea>`)}
    ${field('Cover image link', `<input data-f="cover" type="url" value="${esc(c.cover)}" placeholder="https://…/photo.jpg">`, 'Paste a link to a photo that is already online. Landscape photos work best.')}
  </fieldset>
  ${typeFieldset(c)}
  <fieldset><legend>When</legend>
    <div class="two">${field('Starts', `<input type="datetime-local" data-f="start" value="${esc(c.start)}">`)}${field('Ends', `<input type="datetime-local" data-f="end" value="${esc(c.end)}">`)}</div>
    <p class="hint">Times are local to the venue${c.tz ? ` (${esc(c.tz.replace(/_/g, ' '))})` : ''}.</p>
  </fieldset>
  <fieldset><legend>Where</legend>
    ${c.venue ? `<div class="venue-sel"><div><b>${esc(c.venue.name)}</b><span>${esc(c.venue.address || '')}</span><span class="muted small">${c.venue.lat}, ${c.venue.lon}</span></div><button type="button" class="btn sm" data-b="clear-venue">Change</button></div>
      ${field('Venue name shown on the page', `<input data-v="name" value="${esc(c.venue.name)}">`)}
      ${field('Address shown on the page', `<input data-v="address" value="${esc(c.venue.address || '')}">`)}`
    : `<div class="field"><label for="vq">Find the venue</label><div class="search"><input id="vq" placeholder="Venue name or address" value="${esc(B.vq || '')}"><button type="button" class="btn" data-b="search">Search</button></div><p class="hint">Search runs on OpenStreetMap. Add the city if the venue name is common.</p></div>
      <ul class="vres">${B.venueResults.map((r, i) => `<li><button type="button" data-pick="${i}"><b>${esc(r.name)}</b><span>${esc(r.display)}</span></button></li>`).join('')}</ul>${B.vmsg ? `<p class="hint">${esc(B.vmsg)}</p>` : ''}`}
  </fieldset>
  <fieldset><legend>Look</legend>
    <div class="field"><label>Accent color</label><div class="swatches">${SWATCHES.map(s => `<button type="button" class="sw ${s.toLowerCase() === c.theme.accent.toLowerCase() ? 'on' : ''}" style="background:${s}" data-sw="${s}" aria-label="Accent ${s}"></button>`).join('')}<input type="color" data-t="accent" value="${esc(c.theme.accent)}" aria-label="Custom accent color"></div></div>
    <div class="field"><label>Title font</label><div class="fonts">${Object.entries(FONTS).map(([k, f]) => `<button type="button" class="fontb ${k === c.theme.font ? 'on' : ''}" data-font="${k}" style="font-family:${esc(f.css)}">${f.label}</button>`).join('')}</div></div>
    <div class="field"><label>Background</label><div class="seg2"><button type="button" data-mode="light" class="${c.theme.mode !== 'dark' ? 'on' : ''}">Light</button><button type="button" data-mode="dark" class="${c.theme.mode === 'dark' ? 'on' : ''}">Dark</button></div></div>
  </fieldset>
  <fieldset><legend>Sections</legend>
    <p class="hint">Turn sections on or off and set their order.</p>
    <ol class="secs">${c.sections.map((s, i) => `<li${s.id === 'typeinfo' && !typeSpec(c) ? ' hidden' : ''}><label><input type="checkbox" data-sec="${i}" ${s.on ? 'checked' : ''}> ${esc(secName(s.id, c))}</label><span><button type="button" class="ic" data-up="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move ${SECTION_NAMES[s.id]} up">↑</button><button type="button" class="ic" data-down="${i}" ${i === c.sections.length - 1 ? 'disabled' : ''} aria-label="Move ${SECTION_NAMES[s.id]} down">↓</button></span></li>`).join('')}</ol>
  </fieldset>
  <fieldset><legend>Schedule</legend>
    ${c.schedule.map((x, i) => `<div class="rowed"><div class="two"><input type="date" data-s="${i}" data-k="date" value="${esc(x.date)}" aria-label="Date"><input type="time" data-s="${i}" data-k="time" value="${esc(x.time)}" aria-label="Time"></div><input data-s="${i}" data-k="title" value="${esc(x.title)}" placeholder="What's happening" aria-label="Title"><input data-s="${i}" data-k="note" value="${esc(x.note)}" placeholder="Where or a note (optional)" aria-label="Note"><button type="button" class="ic del" data-sdel="${i}" aria-label="Remove item">Remove</button></div>`).join('')}
    <button type="button" class="btn sm" data-b="add-sched">Add schedule item</button>
  </fieldset>
  <fieldset><legend>Details and links</legend>
    <p class="hint">Add a link (registration, RSVP form, registry, tickets) or a short note (dress code, FAQ).</p>
    ${c.links.map((x, i) => `<div class="rowed"><input data-l="${i}" data-k="label" value="${esc(x.label)}" placeholder="Label" aria-label="Label"><input data-l="${i}" data-k="url" type="url" value="${esc(x.url || '')}" placeholder="https://… (optional)" aria-label="Link"><input data-l="${i}" data-k="note" value="${esc(x.note || '')}" placeholder="Note, if there's no link" aria-label="Note"><button type="button" class="ic del" data-ldel="${i}" aria-label="Remove">Remove</button></div>`).join('')}
    <div class="chips">${['RSVP', 'Registration', 'Tickets', 'Registry', 'Dress code', 'FAQ', 'Parking'].map(p => `<button type="button" class="chip" data-lp="${p}">+ ${p}</button>`).join('')}</div>
  </fieldset>
  <div class="b-end"><button type="button" class="btn primary" data-act="publish">Publish</button><button type="button" class="btn ghost" data-b="reset">Start over</button></div>`;
  wireForm();
}
function typeFieldset(c) {
  const sp = typeSpec(c); if (!sp) return '';
  const d = typeData(c);
  const one = ([k, label, kind, ph = '']) => {
    const id = `x-${k}`; const val = d[k];
    if (kind === 'links') return `<div class="field"><label>${esc(label)}</label>${(val || []).map((l, i) => `<div class="rowed"><input data-xl="${k}" data-i="${i}" data-k="label" value="${esc(l.label)}" placeholder="Name" aria-label="${esc(label)} name"><input data-xl="${k}" data-i="${i}" data-k="url" type="url" value="${esc(l.url)}" placeholder="https://…" aria-label="${esc(label)} link"><button type="button" class="ic del" data-xdel="${k}" data-i="${i}" aria-label="Remove">Remove</button></div>`).join('')}<button type="button" class="btn sm" data-xadd="${k}">Add ${esc(label.toLowerCase())}</button></div>`;
    if (kind === 'place') return `<div class="field"><label for="${id}">${esc(label)}</label><div class="search"><input id="${id}" data-xp="${k}" value="${esc(val ? val.q : '')}" placeholder="${esc(ph)}"><button type="button" class="btn" data-xfind="${k}">${val && val.lat != null ? 'Pinned' : 'Pin on map'}</button></div></div>`;
    if (kind === 'lines') return `<div class="field"><label for="${id}">${esc(label)}</label><textarea id="${id}" data-x="${k}" rows="3" placeholder="${esc(ph)}">${esc(val || '')}</textarea></div>`;
    const type = { url: 'url', date: 'date', time: 'time', datetime: 'datetime-local' }[kind] || 'text';
    return `<div class="field"><label for="${id}">${esc(label)}</label><input id="${id}" type="${type}" data-x="${k}" value="${esc(val || '')}"${ph ? ` placeholder="${esc(ph)}"` : ''}></div>`;
  };
  // pair short fields side by side
  const html = []; const fs = sp.fields;
  for (let i = 0; i < fs.length; i++) {
    const short = (f) => f && ['date', 'time', 'datetime'].includes(f[2]);
    if (short(fs[i + 1]) && !['links', 'lines', 'place'].includes(fs[i][2])) { html.push(`<div class="two">${one(fs[i])}${one(fs[i + 1])}</div>`); i++; }
    else html.push(one(fs[i]));
  }
  return `<fieldset class="typef"><legend>${esc(sp.name)}</legend>${html.join('')}</fieldset>`;
}
function wireForm() {
  const f = $('.b-form'); const c = B.cfg;
  f.oninput = (e) => {
    const i = e.target; const d = i.dataset;
    const xd = () => (c.x[c.type] = c.x[c.type] || {});
    if (d.x) { xd()[d.x] = i.value; changed(); }
    else if (d.xl) { xd()[d.xl][+d.i][d.k] = i.value; changed(); }
    else if (d.xp) { xd()[d.xp] = i.value ? { q: i.value } : null; const fb = f.querySelector(`[data-xfind="${d.xp}"]`); if (fb) fb.textContent = 'Pin on map'; changed(); }
    else if (d.f) { c[d.f] = i.value; if (d.f === 'start' && c.end && c.end < c.start) { c.end = c.start; const en = f.querySelector('[data-f="end"]'); if (en) en.value = c.end; } changed(d.f === 'type'); }
    else if (d.v) { c.venue[d.v] = i.value; changed(); }
    else if (d.t) { c.theme[d.t] = i.value; $$('.sw', f).forEach(s => s.classList.remove('on')); changed(); }
    else if (d.s != null) { c.schedule[+d.s][d.k] = i.value; changed(); }
    else if (d.l != null) { c.links[+d.l][d.k] = i.value; changed(); }
    else if (d.sec != null) { c.sections[+d.sec].on = i.checked; changed(); }
    else if (i.id === 'vq') B.vq = i.value;
  };
  f.onkeydown = (e) => { if (e.target.id === 'vq' && e.key === 'Enter') { e.preventDefault(); venueSearch(); } };
  f.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
    if (d.b === 'search') venueSearch();
    else if (d.pick != null) pickVenue(B.venueResults[+d.pick]);
    else if (d.b === 'clear-venue') { c.venue = null; c.tz = ''; B.venueResults = []; B.vmsg = ''; changed(true); setTimeout(() => $('#vq')?.focus(), 0); }
    else if (d.sw) { c.theme.accent = d.sw; changed(true); }
    else if (d.font) { c.theme.font = d.font; loadFont(d.font); changed(true); }
    else if (d.mode) { c.theme.mode = d.mode; changed(true); }
    else if (d.up != null || d.down != null) { const i = +(d.up ?? d.down), j = d.up != null ? i - 1 : i + 1; [c.sections[i], c.sections[j]] = [c.sections[j], c.sections[i]]; changed(true); }
    else if (d.b === 'add-sched') { const last = c.schedule[c.schedule.length - 1]; c.schedule.push({ date: last?.date || c.start.slice(0, 10), time: '', title: '', note: '' }); changed(true); }
    else if (d.sdel != null) { c.schedule.splice(+d.sdel, 1); changed(true); }
    else if (d.ldel != null) { c.links.splice(+d.ldel, 1); changed(true); }
    else if (d.xadd) { const x = (c.x[c.type] = c.x[c.type] || {}); (x[d.xadd] = x[d.xadd] || []).push({ label: '', url: '' }); changed(true); }
    else if (d.xdel) { c.x[c.type][d.xdel].splice(+d.i, 1); changed(true); }
    else if (d.xfind) pinPlace(d.xfind, b);
    else if (d.lp) { c.links.push({ label: d.lp, url: '', note: '' }); changed(true); }
    else if (d.b === 'reset') { if (confirm('Clear this draft and start over?')) { LS.del('draft'); renderBuilder(blankEvent()); } }
  };
}
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
async function venueSearch() {
  const q = ($('#vq')?.value || '').trim(); B.vq = q;
  if (q.length < 3) { B.vmsg = 'Type at least 3 characters.'; buildForm(); return; }
  const btn = $('[data-b="search"]'); if (btn) { btn.disabled = true; btn.textContent = 'Searching…'; }
  try { B.venueResults = await geocode(q); B.vmsg = B.venueResults.length ? '' : 'No matches. Try adding the city or street.'; }
  catch { B.venueResults = []; B.vmsg = 'Search is unavailable right now. Try again in a moment.'; }
  buildForm(); $('#vq')?.focus();
}
async function pickVenue(r) {
  const c = B.cfg; c.venue = { name: r.name, address: r.address, lat: r.lat, lon: r.lon, city: r.city, region: r.region, country: r.country, cc: r.cc };
  c.tz = ''; changed(true);
  try { c.tz = await lookupTZ(r.lat, r.lon); changed(true); } catch { /* leave blank; times then stay floating */ }
}

// ---------- router ----------
function route() {
  const h = location.hash.slice(1);
  maps.forEach(m => { try { m.remove(); } catch {} }); maps.clear();
  if (h.startsWith('e=')) { const c = unpackEvent(h.slice(2)); if (c) return renderViewer(c); return renderBroken(); }
  if (h.startsWith('ex=')) { const e = window.EXAMPLES[h.slice(3)]; if (e) return renderViewer(normalize(clone(e)), { exampleId: h.slice(3) }); return renderBroken(); }
  if (h.startsWith('edit=')) { const c = unpackEvent(h.slice(5)); if (c) return renderBuilder(c, 'Editing a copy. Publish to get a new link; the original link keeps showing the old version.'); return renderBroken(); }
  if (h.startsWith('edit-ex=')) { const e = window.EXAMPLES[h.slice(8)]; if (e) return renderBuilder(clone(e), 'Started from an example. Change anything, then publish your own link.'); }
  if (h === 'new') return renderBuilder(LS.get('draft') || blankEvent());
  renderLanding();
}
function renderBroken() {
  $('#app').innerHTML = `<main class="land"><header class="land-top"><a class="brand" href="#"><span class="brand-mark"></span>Eventpages</a></header><section class="broken"><h1>This link is incomplete.</h1><p class="lede">The event is stored inside the link, and part of it is missing. Ask whoever sent it to copy the whole link again.</p><a class="btn primary" href="#">Go to Eventpages</a></section></main>`;
}
window.addEventListener('hashchange', route);
route();
window.__ep = { osmQuery, classify, osmKey, OVERPASS, packEvent, unpackEvent, icsText, nearestAirports, weatherFor, nearby, L };
})();
