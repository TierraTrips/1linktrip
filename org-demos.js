// Organizer demos (?demo=wedding|conference|race&view=organizer): sample data for the real organizer screens, and an
// in-memory stand-in for the database those screens talk to. Loaded only in a demo. Nothing here reaches a server:
// reads and writes go to the arrays below (a reload starts fresh), and "sending" an invitation only marks it sent here.
// The events are the example pages (examples.js); the people, companies and vendors are made up. Hotels, airports and
// venues are real places.
(() => {
'use strict';
const NOW = Date.now(), DAY = 864e5, HOUR = 36e5;
const iso = (ms) => new Date(ms).toISOString();
const ago = (d) => iso(NOW - d * DAY);
const J = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const hex = (n) => { let s = ''; while (s.length < n) s += Math.floor(Math.random() * 16).toString(16); return s; };
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`);
// stable ids, so a reload opens the same addresses (#guests/<event id>)
let SEQ = 0;
const sid = (k) => `${k.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-${(++SEQ).toString(16).padStart(12, '0')}`;

// ================= the stand-in database =================
// Enough of PostgREST / supabase-js for the organizer screens: select (columns, count), insert / upsert / update /
// delete, eq / neq / in / is / not in / gt(e) / lt(e) / match, order, limit, single / maybeSingle, the rpc functions
// they call, Storage (pictures stay in this tab as blob: links) and a session for the demo organizer.
const KEYS = { guest_travel: ['household_id'], guest_seating: ['event_id'], guest_field_values: ['field_id', 'person_id'], shuttle_riders: ['run_id', 'person_id'],
  event_group_members: ['group_id', 'email'], page_opens: ['event_id', 'day'], event_private: ['event_id'], trip_items: ['owner', 'id'], page_names: ['name'],
  trip_shares: ['token'], arrival_shares: ['event_id', 'user_id'], inbound_page_tokens: ['token'] };
const DEF = {
  events: () => ({ published: true }),
  guest_households: () => ({ token: hex(24), lang: '', plus_ones: 0, greeting: 'household', group_id: null, email: null, phone: null, address: null, sort: 0, user_id: null, first_opened_at: null, last_opened_at: null, opens: 0, notified_at: null }),
  guest_people: () => ({ name: '', plus_ones: 0, age: 'adult', plus_of: null, added_by: 'host', group_id: null, sort: 0, table_id: null }),
  event_groups: () => ({ self_pick: false, sort: 0 }),
  guest_tables: () => ({ shape: 'round', capacity: 8, head: false, sort: 0, x: null, y: null }),
  guest_fields: () => ({ kind: 'text', choices: [], visible: 'planners', sort: 0 }),
  shuttle_runs: () => ({ name: null, from_place: '', to_place: '', depart_date: null, depart_time: null, capacity: 8, vehicle: null, meet: null, notes: null, sort: 0 }),
  invitations: () => ({ kind: 'invitation', source: 'template', design: {}, images: {}, show_on_page: true }),
  invite_sends: () => ({ kind: 'invitation', status: 'queued', lang: '', error: null, to_email: null, image_path: null, not_before: iso(Date.now()), queued_at: iso(Date.now()), sent_at: null, delivered_at: null, bounced_at: null }),
  page_planners: () => ({ name: '', token: hex(32), user_id: null, accepted_at: null, notified_at: null }),
  rsvps: () => ({ attending: true, guests: 1, email: null, note: null, person_id: null, household_id: null, group_id: null }),
  announcements: () => ({ pinned: true, group_ids: [] }),
  event_messages: () => ({ from_host: false, guest_email: null, guest_name: null }),
  guest_travel: () => ({ updated_by: 'planner' }),
  guest_seating: () => ({ show_guests: false }),
  volunteer_slots: () => ({ shift: '', day: null, starts: null, ends: null, capacity: 1, notes: null, sort: 0 }),
  volunteer_signups: () => ({ email: null, phone: null }),
};
const UNIQUE = { event_groups: (a, b) => a.event_id === b.event_id && String(a.name).trim().toLowerCase() === String(b.name).trim().toLowerCase(),
  page_planners: (a, b) => a.event_id === b.event_id && a.email === b.email, events: (a, b) => a.slug === b.slug };
// what goes with a deleted row (on delete cascade / set null)
const CASCADE = {
  guest_households: [['guest_people', 'household_id'], ['guest_travel', 'household_id'], ['invite_sends', 'household_id'], ['rsvps', 'household_id']],
  guest_people: [['guest_people', 'plus_of'], ['guest_field_values', 'person_id'], ['shuttle_riders', 'person_id'], ['rsvps', 'person_id']],
  shuttle_runs: [['shuttle_riders', 'run_id']], guest_fields: [['guest_field_values', 'field_id']], volunteer_slots: [['volunteer_signups', 'slot_id']],
};
const NULLIFY = { guest_tables: [['guest_people', 'table_id']], event_groups: [['guest_households', 'group_id'], ['guest_people', 'group_id']] };
const col = (r, c) => { const m = c.match(/^(\w+)->>(\w+)$/); if (m) { const o = r[m[1]]; return o && o[m[2]] != null ? String(o[m[2]]) : null; } return r[c]; };
const same = (a, b) => (a == null || b == null ? a == b : String(a) === String(b)); // eslint-disable-line eqeqeq
const cmp = (a, b) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)));

function fakeClient(S, files) {
  const db = S.db; const T = (t) => (db[t] = db[t] || []);
  const pick = (r, cols) => { if (!cols || cols.trim() === '*') return J(r); const o = {}; cols.split(',').map(s => s.trim()).filter(Boolean).forEach(c => { o[c] = r[c] === undefined ? null : J(r[c]); }); return o; };
  const fill = (t, row) => {
    const r = { ...(DEF[t] ? DEF[t]() : {}), ...J(row) };
    if (!KEYS[t] && r.id == null) r.id = t === 'page_activity' ? (T(t).reduce((n, x) => Math.max(n, +x.id || 0), 0) + 1) : uuid();
    if (r.created_at == null) r.created_at = iso(Date.now());
    if (t === 'events') { r.owner = r.owner || S.me.id; r.updated_at = iso(Date.now()); }
    if (!r.event_id && r.household_id) { const h = T('guest_households').find(x => x.id === r.household_id); if (h) r.event_id = h.event_id; }
    if (!r.event_id && r.field_id) { const f = T('guest_fields').find(x => x.id === r.field_id); if (f) r.event_id = f.event_id; } // as the triggers do
    if (!r.event_id && r.slot_id) { const v = T('volunteer_slots').find(x => x.id === r.slot_id); if (v) r.event_id = v.event_id; }
    if (t === 'invite_sends' && r.channel === 'text') { r.status = 'sent'; r.sent_at = iso(Date.now()); }
    if (t === 'invite_sends') { const h = T('guest_households').find(x => x.id === r.household_id); if (h && r.channel === 'email') r.to_email = h.email; }
    if (t === 'page_planners' && r.email) r.email = String(r.email).toLowerCase().trim();
    if ('updated_at' in r || ['guest_travel', 'guest_field_values', 'invitations', 'event_private', 'guest_seating'].includes(t)) r.updated_at = iso(Date.now());
    return r;
  };
  const keyOf = (t, conflict) => (conflict ? conflict.split(',').map(s => s.trim()) : KEYS[t] || ['id']);
  const drop = (t, rows) => {
    const ids = rows.map(r => r.id); db[t] = T(t).filter(r => !rows.includes(r));
    (CASCADE[t] || []).forEach(([t2, c]) => { const gone = T(t2).filter(x => ids.includes(x[c])); if (gone.length) drop(t2, gone); });
    (NULLIFY[t] || []).forEach(([t2, c]) => T(t2).forEach(x => { if (ids.includes(x[c])) x[c] = null; }));
  };
  class Q {
    constructor(t) { this.t = t; this.op = 'select'; this.f = []; this.ord = []; this.lim = null; this.one = null; this.cols = '*'; this.ret = false; }
    select(cols = '*', o = {}) { if (this.op === 'select') { this.cols = cols; this.head = !!o.head; this.cnt = !!o.count; } else { this.ret = true; this.cols = cols; } return this; }
    insert(rows) { this.op = 'insert'; this.rows = [].concat(rows); return this; }
    upsert(rows, o = {}) { this.op = 'upsert'; this.rows = [].concat(rows); this.conflict = o.onConflict; this.ignore = !!o.ignoreDuplicates; return this; }
    update(p) { this.op = 'update'; this.patch = J(p); return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.f.push(r => same(col(r, c), v)); return this; }
    neq(c, v) { this.f.push(r => !same(col(r, c), v)); return this; }
    gt(c, v) { this.f.push(r => col(r, c) != null && cmp(col(r, c), v) > 0); return this; }
    gte(c, v) { this.f.push(r => col(r, c) != null && cmp(col(r, c), v) >= 0); return this; }
    lt(c, v) { this.f.push(r => col(r, c) != null && cmp(col(r, c), v) < 0); return this; }
    lte(c, v) { this.f.push(r => col(r, c) != null && cmp(col(r, c), v) <= 0); return this; }
    in(c, xs) { const s = new Set((xs || []).map(String)); this.f.push(r => col(r, c) != null && s.has(String(col(r, c)))); return this; }
    is(c, v) { this.f.push(r => (v === null ? col(r, c) == null : col(r, c) === v)); return this; }
    not(c, op, v) {
      if (op === 'in') { const s = new Set(String(v).replace(/^\(|\)$/g, '').split(',').map(x => x.trim().replace(/^"|"$/g, '')).filter(Boolean)); this.f.push(r => !s.has(String(col(r, c)))); }
      else if (op === 'is') this.f.push(r => (v === null || v === 'null' ? col(r, c) != null : col(r, c) !== v)); else this.f.push(r => !same(col(r, c), v));
      return this;
    }
    match(o) { Object.entries(o || {}).forEach(([c, v]) => this.eq(c, v)); return this; }
    filter(c, op, v) { return op === 'eq' ? this.eq(c, v) : op === 'in' ? this.in(c, String(v).replace(/^\(|\)$/g, '').split(',')) : this; }
    order(c, o = {}) { this.ord.push([c, o.ascending !== false]); return this; }
    limit(n) { this.lim = n; return this; }
    range(a, b) { this.off = a; this.lim = b - a + 1; return this; }
    single() { this.one = 'single'; return this; }
    maybeSingle() { this.one = 'maybe'; return this; }
    abortSignal() { return this; }
    throwOnError() { return this; }
    then(res, rej) { let out; try { out = this.run(); } catch (e) { out = { data: null, error: { message: String(e && e.message || e) } }; } return Promise.resolve(out).then(res, rej); }
    rows_() { return T(this.t).filter(r => this.f.every(fn => fn(r))); }
    shape(rows) {
      let xs = rows.slice();
      if (this.ord.length) xs.sort((a, b) => { for (const [c, up] of this.ord) { const d = cmp(col(a, c), col(b, c)); if (d) return up ? d : -d; } return 0; });
      if (this.off) xs = xs.slice(this.off); if (this.lim != null) xs = xs.slice(0, this.lim);
      let data = xs.map(r => pick(r, this.cols));
      if (this.one) { if (this.one === 'single' && data.length !== 1) return { data: null, error: { code: 'PGRST116', message: 'Expected one row' } }; data = data[0] || null; }
      return { data, error: null, count: rows.length, status: 200 };
    }
    run() {
      const t = this.t;
      if (this.op === 'select') { const rows = this.rows_(); if (this.head) return { data: null, error: null, count: rows.length }; return this.shape(rows); }
      if (this.op === 'insert' || this.op === 'upsert') {
        const out = [];
        for (const row of this.rows) {
          const r = fill(t, row);
          if (this.op === 'upsert') {
            const k = keyOf(t, this.conflict); const ex = T(t).find(x => k.every(c => same(x[c], r[c])));
            if (ex) { if (!this.ignore) { Object.assign(ex, J(row)); if ('updated_at' in ex) ex.updated_at = iso(Date.now()); out.push(ex); } continue; }
          } else {
            const k = KEYS[t]; if (k && T(t).some(x => k.every(c => same(x[c], r[c])))) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          }
          if (UNIQUE[t] && T(t).some(x => UNIQUE[t](x, r))) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          T(t).push(r); out.push(r);
        }
        if (t === 'events' && out.length) { /* a demo page saved as a new row stays the demo's */ }
        return this.ret ? this.shape(out) : { data: null, error: null, status: 201 };
      }
      if (this.op === 'update') {
        const rows = this.rows_();
        for (const r of rows) {
          const next = { ...r, ...this.patch }; if (UNIQUE[t] && T(t).some(x => x !== r && UNIQUE[t](x, next))) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
          Object.assign(r, this.patch);
          if (t === 'events') { let u = Date.now(); if (Date.parse(r.updated_at) >= u) u = Date.parse(r.updated_at) + 1; r.updated_at = iso(u); }
          else if ('updated_at' in r) r.updated_at = iso(Date.now());
        }
        return this.ret ? this.shape(rows) : { data: null, error: null, status: 204 };
      }
      if (this.op === 'delete') { const rows = this.rows_(); drop(t, rows); return this.ret ? this.shape(rows) : { data: null, error: null, status: 204 }; }
      return { data: null, error: { message: 'unsupported' } };
    }
  }
  const session = { access_token: 'demo', user: { id: S.me.id, email: S.me.email, user_metadata: { full_name: S.me.name } } };
  const nameOf = (uid) => (S.users.find(u => u.id === uid) || {}).name || '';
  const RPC = {
    household_hotels: ({ eid }) => T('guest_households').filter(h => h.event_id === eid).map(h => ({ id: h.id, has_hotel: S.hotels.has(h.id) ? S.hotels.get(h.id) : null })),
    page_team: ({ eid }) => {
      const ev = T('events').find(e => e.id === eid); if (!ev) return [];
      const own = S.users.find(u => u.id === ev.owner) || S.me;
      return [{ id: null, role: 'owner', name: own.name, email: own.email, joined: true, me: own.id === S.me.id, token: null },
        ...T('page_planners').filter(p => p.event_id === eid).sort((a, b) => cmp(a.created_at, b.created_at)).map(p => ({ id: p.id, role: 'planner', name: p.user_id ? nameOf(p.user_id) || p.name : p.name, email: p.email, joined: !!p.accepted_at, me: p.user_id === S.me.id, token: ev.owner === S.me.id ? p.token : null }))];
    },
    planner_pending: () => [],
    arrivals_trips: ({ eid }) => J((S.trips || []).filter(x => x.event_id === eid).map(({ event_id, ...x }) => x)),
    page_name_check: () => 'ok', page_name_set: ({ nm }) => nm, page_name_resolve: () => [],
  };
  return {
    from: (t) => new Q(t),
    rpc: (fn, args = {}) => Promise.resolve(RPC[fn] ? { data: RPC[fn](args), error: null } : { data: null, error: { message: 'Not available in the demo' } }),
    auth: {
      getSession: () => Promise.resolve({ data: { session }, error: null }), getUser: () => Promise.resolve({ data: { user: session.user }, error: null }),
      signOut: () => Promise.resolve({ error: null }), signInWithOtp: () => Promise.resolve({ error: { message: 'Not available in the demo' } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    storage: { from: (b) => ({
      upload: (path, blob) => { try { files.set(b + '/' + path, URL.createObjectURL(blob)); } catch { /* no blob URLs: the picture just won't show */ } return Promise.resolve({ data: { path }, error: null }); },
      getPublicUrl: (path) => ({ data: { publicUrl: files.get(b + '/' + path) || '' } }),
      remove: () => Promise.resolve({ data: [], error: null }),
    }) },
    channel: () => { const ch = { on: () => ch, subscribe: () => ch, unsubscribe: () => Promise.resolve('ok'), send: () => Promise.resolve('ok') }; return ch; },
    removeChannel: () => Promise.resolve('ok'),
  };
}
// the notify function's answers (invitation email, test email, today's allowance, planner invites): nothing is sent;
// an "emailed" invitation is marked sent so the screens move on as they would
function fakeNotify(S, b) {
  const db = S.db; const sends = db.invite_sends; const today = new Date().toISOString().slice(0, 10);
  const cap = 100; const usedToday = () => sends.filter(s => s.channel === 'email' && (s.sent_at || '').slice(0, 10) === today).length;
  S.notified.push(b.kind || '');
  if (b.kind === 'invite_status') return { ok: true, left: Math.max(0, cap - usedToday()), dailyCap: cap };
  if (b.kind === 'invite_test') return { ok: true, sent: 1, to: S.me.email };
  if (b.kind === 'invite') {
    const inv = db.invitations.find(x => x.id === b.id); if (!inv) return { ok: false, error: 'Not found' };
    let sent = 0; (b.households || []).forEach(hid => { const h = db.guest_households.find(x => x.id === hid); if (!h || !h.email) return;
      sends.push({ id: uuid(), event_id: h.event_id, household_id: h.id, invitation_id: inv.id, kind: inv.kind, channel: 'email', status: 'sent', lang: h.lang || '', error: null, to_email: h.email,
        not_before: iso(Date.now()), queued_at: iso(Date.now()), sent_at: iso(Date.now()), delivered_at: null, bounced_at: null, created_at: iso(Date.now()) }); sent++; });
    return { ok: true, sent };
  }
  if (b.kind === 'drain') { let sent = 0; sends.forEach(s => { if (s.status === 'queued') { s.status = 'sent'; s.sent_at = iso(Date.now()); sent++; } }); return { ok: true, sent }; }
  if (b.kind === 'household') return { ok: true, sent: true };
  return { ok: true, sent: 0 };
}

// ================= building a demo from a compact description =================
// households: [name, group key, { lang, email, phone, names (greeting by first names), plus (plus-ones), open: [days ago, opens],
//   sent: [status, days ago, 'text'?], hotel: true|false, tr: 'arrive | depart | stay', trip: true (from their shared My trip) }, people]
// a leg: 'YYYY-MM-DD HH:MM PLACE NO…'; a person: [name, reply 'y'|'n'|'', { age, meal, diets, diet, skip (events), table, sh (shuttle), f (fields), by: 'guest', of (their +1 host), replied (days ago) }]
function build(D, cfg, X) {
  SEQ = 0; const eid = sid(D.key + 'e'); const me = { id: sid('user'), name: D.me[0], email: D.me[1] };
  const users = [me, ...D.planners.filter(p => p.joined).map(p => ({ id: sid('user'), name: p.name, email: p.email }))];
  const db = { events: [], guest_households: [], guest_people: [], rsvps: [], event_groups: [], guest_tables: [], guest_seating: [], invitations: [], invite_sends: [], guest_travel: [],
    shuttle_runs: [], shuttle_riders: [], guest_fields: [], guest_field_values: [], page_planners: [], page_activity: [], page_opens: [], announcements: [], event_messages: [], event_group_members: [],
    event_private: [], page_names: [], trip_items: [], trip_shares: [], arrival_shares: [], inbound_page_tokens: [], volunteer_slots: [], volunteer_signups: [] };
  const S = { db, me, users, eid, hotels: new Map(), trips: [], notified: [] };
  // the page: the example, with the organizer's RSVP questions and guest languages
  Object.assign(cfg, D.cfg || {}); if (D.rsvpq) cfg.rsvpq = D.rsvpq; cfg.ek = cfg.ek || ('ek:' + D.key + '-demo');
  if (D.x) cfg.x = { ...(cfg.x || {}), [cfg.type]: { ...((cfg.x || {})[cfg.type] || {}), ...D.x } }; // the page's own race-weekend details
  if (D.year) { // the organizer demo runs a year later than the guest example, so its arrivals and shuttles are still ahead
    const y = (v) => (typeof v === 'string' ? v.replace(/^(\d{4})/, (m) => String(+m + D.year)) : v);
    cfg.start = y(cfg.start); cfg.end = y(cfg.end); (cfg.schedule || []).forEach(x => { x.date = y(x.date); });
    Object.values(cfg.x || {}).forEach(o => Object.keys(o).forEach(k => { if (/When$/.test(k)) o[k] = y(o[k]); }));
  }
  const updated = ago(0.02);
  db.events.push({ id: eid, slug: D.slug, owner: me.id, config: cfg, published: true, created_at: ago(D.created), updated_at: updated });
  // groups
  const G = {}; D.groups.forEach(([k, name, self], i) => { const id = sid('group'); G[k] = id; db.event_groups.push({ id, event_id: eid, name, self_pick: !!self, sort: i, created_at: ago(D.created - 1) }); });
  // tables
  const TB = {}; (D.tables || []).forEach(([k, name, shape, cap, x, y, head], i) => { const id = sid('table'); TB[k] = id; db.guest_tables.push({ id, event_id: eid, name, shape, capacity: cap, head: !!head, sort: i, x, y, created_at: ago(20) }); });
  if (D.tables) db.guest_seating.push({ event_id: eid, show_guests: !!D.showSeats, updated_at: ago(3) });
  // shuttle runs
  const SH = {}; (D.shuttles || []).forEach(([k, name, from, to, date, time, cap, vehicle, meet, notes], i) => { const id = sid('run'); SH[k] = id;
    db.shuttle_runs.push({ id, event_id: eid, name, from_place: from, to_place: to, depart_date: date, depart_time: time, capacity: cap, vehicle, meet, notes, sort: i, created_at: ago(6) }); });
  // fields
  const FD = {}; (D.fields || []).forEach(([label, kind, choices, visible], i) => { const id = sid('field'); FD[label] = id; db.guest_fields.push({ id, event_id: eid, label, kind, choices: choices || [], visible, sort: i, created_at: ago(14) }); });
  // invitations (pictures are drawn when the demo opens)
  const INV = {}; (D.invites || []).forEach(([kind, tpl, extra]) => { const id = sid('invite'); INV[kind] = id;
    db.invitations.push({ id, event_id: eid, kind, source: 'template', design: { ...X.ivDefault(cfg, kind), tpl, ...(extra || {}) }, images: {}, show_on_page: true, created_at: ago(D.created - 2), updated_at: ago(D.created - 2) }); });
  const leg = (s) => { if (!s) return {}; const [date, time, place, ...no] = s.trim().split(/\s+/); return { date, time, place, no: no.join(' ') }; };
  const evs = (cfg.schedule || []).map(x => x.title);
  D.households.forEach(([name, gk, o, people], hi) => {
    const hid = sid('house'); const open = o.open;
    db.guest_households.push({ id: hid, event_id: eid, token: hex(24), name, lang: o.lang || '', plus_ones: o.plus || 0, greeting: o.names ? 'names' : 'household', group_id: G[gk] || null,
      email: o.email || null, phone: o.phone || null, address: null, sort: hi, user_id: open && o.hotel != null ? sid('guest') : null,
      first_opened_at: open ? ago(open[0]) : null, last_opened_at: open ? ago(Math.max(0.1, open[0] - (open[1] > 1 ? open[0] * 0.6 : 0))) : null, opens: open ? open[1] : 0, notified_at: null, created_at: ago(D.created - 3) });
    if (o.hotel != null) S.hotels.set(hid, o.hotel);
    // invitation sends: save the date first (weddings), then the invitation
    (o.sent ? [o.sent] : []).forEach(([status, d, ch]) => {
      (INV.save_the_date && d < 60 ? [['save_the_date', D.stdAgo || 95]] : []).concat([['invitation', d]]).forEach(([kind, dd]) => {
        if (!INV[kind]) return; const st = kind === 'invitation' || status === 'bounced' ? status : 'delivered';
        db.invite_sends.push({ id: sid('send'), event_id: eid, household_id: hid, invitation_id: INV[kind], kind, channel: ch || 'email', status: ch === 'text' ? 'sent' : st, lang: o.lang || '',
          error: st === 'bounced' ? 'The address doesn’t exist (mailbox not found)' : null, to_email: ch === 'text' ? null : o.email || null, not_before: ago(dd), queued_at: ago(dd), sent_at: st === 'queued' ? null : ago(dd - 0.001),
          delivered_at: st === 'delivered' ? ago(dd - 0.002) : null, bounced_at: st === 'bounced' ? ago(dd - 0.003) : null, created_at: ago(dd) });
      });
    });
    // travel: their RSVP answers, or (trip) the bookings they share from My trip
    if (o.tr) { const [a, d2, stay] = o.tr.split('|').map(s => s.trim()); const A = leg(a), Dp = leg(d2);
      if (o.trip) { const uid = sid('guest'); const fl = (L, arr) => L.date ? { kind: /^\d/.test(L.no) || !L.no ? 'train' : 'flight', name: L.no, flight: L.no, from: arr ? (L.from || '') : L.place, to: arr ? L.place : (L.to || ''),
            start: arr ? `${L.date}T${String(Math.max(0, +L.time.slice(0, 2) - 3)).padStart(2, '0')}${L.time.slice(2)}` : `${L.date}T${L.time}`, end: arr ? `${L.date}T${L.time}` : '' } : null;
        S.trips.push({ event_id: eid, user_id: uid, household_id: hid, name: (people[0] || [name])[0], items: [fl(A, true), fl(Dp, false), stay ? { kind: 'hotel', name: stay, start: A.date ? A.date + 'T15:00' : '', end: Dp.date ? Dp.date + 'T11:00' : '' } : null].filter(Boolean) }); }
      else db.guest_travel.push({ household_id: hid, event_id: eid, arr_date: A.date || null, arr_time: A.time || null, arr_place: A.place || null, arr_no: A.no || null,
        dep_date: Dp.date || null, dep_time: Dp.time || null, dep_place: Dp.place || null, dep_no: Dp.no || null, stay: stay || null, updated_by: o.trBy || 'guest', updated_at: ago((open && open[0] * 0.5) || 2) }); }
    // people + replies
    const byName = {};
    people.forEach(([pname, reply, po = {}], pi) => {
      const pid = sid('person'); byName[pname] = pid;
      db.guest_people.push({ id: pid, household_id: hid, event_id: eid, name: pname, plus_ones: po.plus || 0, age: po.age || 'adult', plus_of: po.of ? byName[po.of] || null : null, added_by: po.by || 'host',
        group_id: null, sort: pi, table_id: po.table ? TB[po.table] || null : null, created_at: po.by === 'guest' ? ago((po.replied || 5) + 0.01) : ago(D.created - 3) });
      if (reply) {
        const x = { v: 1 }; if (reply === 'y') { if (po.meal) x.meal = po.meal; if (po.diets) x.diets = po.diets; if (po.diet) x.diet = po.diet; if (D.rsvpq && D.rsvpq.events) x.events = evs.filter(e => !(po.skip || []).includes(e)); }
        const when = po.replied != null ? po.replied : open ? Math.max(0.2, open[0] - 1) : 3;
        db.rsvps.push({ id: sid('rsvp'), event_id: eid, name: pname, email: pi === 0 ? o.email || null : null, attending: reply === 'y', guests: 1, note: X.rqPack(po.note || '', Object.keys(x).length > 1 ? x : null),
          created_at: ago(when), person_id: pid, household_id: hid, group_id: null });
      }
      if (po.sh) [].concat(po.sh).forEach(k => SH[k] && db.shuttle_riders.push({ run_id: SH[k], person_id: pid, event_id: eid, created_at: ago(2) }));
      Object.entries(po.f || {}).forEach(([label, value]) => FD[label] && db.guest_field_values.push({ field_id: FD[label], person_id: pid, event_id: eid, value: String(value), updated_at: ago(4) }));
    });
  });
  // co-planners and what they changed ("Edited by …")
  const ids = new Map(users.map(u => [u.name, u.id]));
  D.planners.forEach((p, i) => db.page_planners.push({ id: sid('plan'), event_id: eid, email: p.email, name: p.name, token: hex(32), user_id: p.joined ? ids.get(p.name) : null, invited_by: me.id,
    accepted_at: p.joined ? ago(D.created - 4 - i) : null, notified_at: ago(D.created - 4 - i), created_at: ago(D.created - 4 - i) }));
  const sched = (title) => { const x = (cfg.schedule || []).find(y => y.title === title); return x ? 'sc:' + x.id : 'f:description'; };
  (D.activity || []).forEach(([who, keys, d], i) => db.page_activity.push({ id: i + 1, event_id: eid, actor: who === 'me' ? me.id : ids.get(who) || null, actor_name: who === 'me' ? me.name : who,
    keys: keys.map(k => (k.startsWith('sc:') ? sched(k.slice(3)) : k)), at: ago(d) }));
  db.page_activity.sort((a, b) => a.at.localeCompare(b.at)).forEach((a, i) => { a.id = i + 1; });
  // the plain (not personal) link's opens, by day
  (D.opens || []).forEach(([d, n]) => db.page_opens.push({ event_id: eid, day: ago(d).slice(0, 10), n }));
  // updates and guest messages
  (D.updates || []).forEach(([body, d, gks]) => db.announcements.push({ id: sid('ann'), event_id: eid, body, pinned: true, group_ids: (gks || []).map(k => G[k]).filter(Boolean), created_at: ago(d) }));
  (D.messages || []).forEach(([gname, email, thread]) => { const guest = sid('guest');
    thread.forEach(([fromHost, body, d]) => db.event_messages.push({ id: sid('msg'), event_id: eid, guest, from_host: fromHost, guest_email: email, guest_name: gname, body, notified_at: null, created_at: ago(d) })); });
  if (D.vendors) db.event_private.push({ event_id: eid, data: { cur: D.vendors.cur, on: true, t: NOW - 2 * DAY, vendors: D.vendors.list.map((v, i) => ({ id: 'v' + i, ...v, pays: (v.pays || []).map((p, j) => ({ id: 'v' + i + 'p' + j, ...p })) })) }, updated_at: ago(2), created_at: ago(30) });
  // volunteer shifts and who took them: [task, shift, day, from, to, needed, [names]]
  (D.vol || []).forEach(([task, shift, day, a, b, cap, names], i) => { const id = sid('vslot');
    db.volunteer_slots.push({ id, event_id: eid, task, shift, day, starts: a, ends: b, capacity: cap, notes: null, sort: i, created_at: ago(20) });
    (names || []).forEach((nm, j) => db.volunteer_signups.push({ id: sid('vsign'), slot_id: id, event_id: eid, name: nm, email: nm.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com', phone: null, created_at: ago(15 - j * 0.7) })); });
  S.priv = D.vendors ? db.event_private[0].data : null; S.slug = D.slug; S.cfg = cfg;
  return S;
}

// ================= the three demos =================
const W = 'Welcome drinks', C = 'Ceremony', DN = 'Dinner', DA = 'Dancing', FB = 'Farewell brunch';
const WEDDING = {
  key: 'wedding', slug: 'maya-and-theo-demo', created: 120, stdAgo: 96,
  me: ['Lucía Ferrer', 'lucia@ferrer-weddings.example'],
  planners: [{ name: 'Maya Ortiz', email: 'maya@example.com', joined: true }, { name: 'Theo Lindqvist', email: 'theo@example.com', joined: true }, { name: 'Sofía Ferrer', email: 'sofia@ferrer-weddings.example', joined: false }],
  cfg: { langs: ['es', 'ja', 'de'], guestMessages: true, x: { Wedding: { dress: 'Beach formal. Linen is perfect; leave the stilettos at home.', rsvpBy: '2027-01-15', blockHotel: 'Nomade Tulum', blockCode: 'MAYATHEO', blockBy: '2027-01-31' } } },
  rsvpq: { meal: true, meals: ['Grilled red snapper', 'Short rib barbacoa', 'Roasted vegetable mole'], diet: true, plus: true, events: true, evOff: [], qs: false, q: ['', ''] },
  groups: [['bf', 'Bride’s family'], ['bfr', 'Bride’s friends'], ['gf', 'Groom’s family'], ['gfr', 'Groom’s friends'], ['mu', 'Mutual friends'], ['wk', 'Work'], ['wp', 'Wedding party']],
  tables: [['head', 'Head table', 'rect', 10, 500, 100, true], ['dos', 'Dos Ojos', 'round', 8, 170, 330], ['gran', 'Gran Cenote', 'round', 8, 390, 330], ['cal', 'Calavera', 'round', 8, 610, 330],
    ['zac', 'Zacil-Ha', 'round', 8, 830, 330], ['suy', 'Suytun', 'round', 8, 280, 540], ['azul', 'Azul', 'round', 8, 500, 540], ['ik', 'Ik Kil', 'round', 8, 720, 540]],
  showSeats: false,
  shuttles: [['cun1', 'Cancún arrivals', 'CUN', 'Nomade Tulum', '2027-03-11', '15:30', 14, 'Sprinter van', 'Terminal 3, outside door 5 — look for the Maya & Theo sign', 'About 1 h 45 min'],
    ['tqo1', 'Tulum airport pickup', 'TQO', 'Nomade Tulum', '2027-03-12', '13:00', 8, 'Van', 'Arrivals hall', ''],
    ['cer', 'To the ceremony', 'Nomade Tulum', 'Playa Paraíso', '2027-03-13', '15:45', 40, 'Coach', 'Hotel lobby', 'Second coach at 16:00 from Be Tulum'],
    ['back', 'Back to the hotels', 'Playa Paraíso', 'Nomade Tulum', '2027-03-14', '00:30', 40, 'Coach', 'Beach club entrance', 'Stops at Be Tulum and Azulik']],
  fields: [['Role', 'choice', ['Maid of honor', 'Best man', 'Bridesmaid', 'Groomsman', 'Reader', 'Flower girl', 'Ring bearer'], 'guest'], ['Hotel room', 'text', [], 'guest'], ['Welcome bag', 'choice', ['To pack', 'Packed', 'Delivered'], 'planners']],
  invites: [['save_the_date', 'classic', {}], ['invitation', 'classic', {}]],
  households: [
    ['Ortiz family', 'bf', { lang: 'es', email: 'elena.ortiz@example.com', names: true, open: [29, 6], sent: ['delivered', 30], hotel: true, tr: '2027-03-11 14:20 CUN AM 573 | 2027-03-15 12:40 CUN AM 576 | Nomade Tulum' },
      [['Elena Ortiz', 'y', { meal: 'Grilled red snapper', table: 'head', sh: ['cun1', 'cer', 'back'], f: { 'Hotel room': 'Nomade · Casita 4', 'Welcome bag': 'Delivered' } }],
        ['Rafael Ortiz', 'y', { meal: 'Short rib barbacoa', table: 'head', sh: ['cun1', 'cer', 'back'], f: { 'Hotel room': 'Nomade · Casita 4', 'Welcome bag': 'Delivered' } }]]],
    ['Carmen Ruiz', 'bf', { lang: 'es', phone: '+52 55 5555 0142', open: [27, 2], sent: ['sent', 30, 'text'], hotel: true, tr: '2027-03-11 14:20 CUN AM 573 | 2027-03-15 12:40 CUN AM 576 | Nomade Tulum', trBy: 'planner' },
      [['Carmen Ruiz', 'y', { meal: 'Grilled red snapper', diet: 'Low sodium, please', table: 'head', sh: ['cun1', 'cer', 'back'], f: { 'Hotel room': 'Nomade · Casita 5', 'Welcome bag': 'Packed' } }]]],
    ['Diego & Ana Ortiz', 'bf', { lang: 'es', email: 'diego.ortiz@example.com', names: true, open: [28, 4], sent: ['delivered', 30], hotel: true, tr: '2027-03-12 11:05 TQO VB 1170 | 2027-03-15 14:30 TQO VB 1171 | Be Tulum' },
      [['Diego Ortiz', 'y', { meal: 'Short rib barbacoa', table: 'dos', sh: ['tqo1', 'cer'] }], ['Ana Ortiz', 'y', { meal: 'Roasted vegetable mole', diets: ['vegetarian'], table: 'dos', sh: ['tqo1', 'cer'] }],
        ['Lucas Ortiz', 'y', { age: 'child', meal: 'Grilled red snapper', diets: ['nut_allergy'], diet: 'Tree nuts and peanuts', table: 'dos', sh: ['tqo1', 'cer'], f: { Role: 'Ring bearer' } }],
        ['Sofi Ortiz', 'y', { age: 'infant', skip: [DA], table: 'dos', sh: ['tqo1'] }]]],
    ['Rosa & Javier Méndez', 'bf', { lang: 'es', email: 'rosa.mendez@example.com', names: true, open: [25, 3], sent: ['delivered', 30], hotel: true, tr: '2027-03-12 09:50 CUN Y4 280 | 2027-03-14 18:15 CUN Y4 283 | Nomade Tulum' },
      [['Rosa Méndez', 'y', { meal: 'Grilled red snapper', table: 'dos', sh: ['cer', 'back'] }], ['Javier Méndez', 'n', { note: 'Javier has surgery that week. Rosa is coming with Valeria.' }]]],
    ['Valeria Méndez', 'bf', { lang: 'es', email: 'vale.mendez@example.com', plus: 1, open: [24, 5], sent: ['delivered', 30], hotel: true, tr: '2027-03-12 09:50 CUN Y4 280 | 2027-03-14 18:15 CUN Y4 283 | Nomade Tulum' },
      [['Valeria Méndez', 'y', { meal: 'Short rib barbacoa', table: 'dos', sh: ['cer', 'back'], f: { Role: 'Bridesmaid' } }], ['Marco Bianchi', 'y', { by: 'guest', meal: 'Grilled red snapper', replied: 2, sh: ['cer'] }]]],
    ['Priya Raman', 'bfr', { email: 'priya.raman@example.com', plus: 1, open: [26, 7], sent: ['delivered', 30], hotel: true, tr: '2027-03-11 16:55 CUN B6 1773 | 2027-03-15 10:30 CUN B6 1774 | Nomade Tulum', trip: true },
      [['Priya Raman', 'y', { meal: 'Roasted vegetable mole', diets: ['vegetarian'], table: 'cal', sh: ['cun1', 'cer', 'back'], f: { Role: 'Bridesmaid', 'Welcome bag': 'Packed' } }],
        ['Sam Okafor', 'y', { by: 'guest', meal: 'Short rib barbacoa', table: 'cal', sh: ['cun1', 'cer', 'back'] }]]],
    ['Chloé Martin', 'bfr', { lang: 'fr', email: 'chloe.martin@example.com', open: [22, 2], sent: ['delivered', 30], hotel: false, tr: '2027-03-12 07:35 CUN AF 3684 | 2027-03-16 20:05 CUN AF 3685 |' },
      [['Chloé Martin', 'y', { meal: 'Grilled red snapper', diets: ['gluten_free'], table: 'cal', sh: ['cer'] }]]],
    ['Hannah Lee & Josh Park', 'bfr', { email: 'hannah.lee@example.com', names: true, open: [21, 3], sent: ['delivered', 30], hotel: true, tr: '2027-03-11 17:40 CUN UA 1532 | 2027-03-15 13:15 CUN UA 1533 | Be Tulum' },
      [['Hannah Lee', 'y', { meal: 'Short rib barbacoa', diets: ['shellfish'], table: 'cal', sh: ['cun1', 'cer'] }], ['Josh Park', 'y', { meal: 'Short rib barbacoa', table: 'cal', sh: ['cun1', 'cer'] }]]],
    ['Isabel Torres', 'bfr', { lang: 'es', email: 'isa.torres@example.com', open: [12, 1], sent: ['delivered', 30] }, [['Isabel Torres', '']]],
    ['Nadia Haddad', 'bfr', { email: 'nadia.haddad@example.com', open: [19, 2], sent: ['delivered', 30], hotel: true, tr: '2027-03-12 12:10 CUN DL 597 | 2027-03-15 11:45 CUN DL 598 | Azulik' },
      [['Nadia Haddad', 'y', { meal: 'Roasted vegetable mole', diets: ['halal'], table: 'cal', sh: ['cer', 'back'] }]]],
    ['Lindqvist family', 'gf', { email: 'karin.lindqvist@example.com', names: true, open: [29, 5], sent: ['delivered', 30], hotel: true, tr: '2027-03-11 15:05 CUN DL 1957 | 2027-03-15 12:05 CUN DL 1958 | Nomade Tulum', trip: true },
      [['Karin Lindqvist', 'y', { meal: 'Roasted vegetable mole', diets: ['vegetarian'], table: 'head', sh: ['cun1', 'cer', 'back'], f: { 'Hotel room': 'Nomade · Casita 7', 'Welcome bag': 'Delivered' } }],
        ['Erik Lindqvist', 'y', { meal: 'Short rib barbacoa', table: 'head', sh: ['cun1', 'cer', 'back'], f: { 'Hotel room': 'Nomade · Casita 7', 'Welcome bag': 'Delivered' } }]]],
    ['Greta & Klaus Weber', 'gf', { lang: 'de', email: 'greta.weber@example.com', names: true, open: [23, 2], sent: ['delivered', 30], hotel: true, tr: '2027-03-11 13:30 CUN DE 2204 | 2027-03-16 16:10 CUN DE 2205 | Nomade Tulum' },
      [['Greta Weber', 'y', { meal: 'Grilled red snapper', diets: ['dairy_free'], table: 'gran', skip: [DA], sh: ['cun1', 'cer', 'back'] }], ['Klaus Weber', 'y', { meal: 'Short rib barbacoa', table: 'gran', skip: [DA], sh: ['cun1', 'cer', 'back'] }]]],
    ['Anna Lindqvist & Felix Braun', 'gf', { email: 'anna.lindqvist@example.com', names: true, open: [20, 4], sent: ['delivered', 30], hotel: true, tr: '2027-03-12 10:40 TQO AA 2675 | 2027-03-15 15:20 TQO AA 2676 | Be Tulum' },
      [['Anna Lindqvist', 'y', { meal: 'Grilled red snapper', table: 'gran', sh: ['tqo1', 'cer'] }], ['Felix Braun', 'y', { meal: 'Short rib barbacoa', table: 'gran', sh: ['tqo1', 'cer'] }],
        ['Mia Braun', 'y', { age: 'child', meal: 'Grilled red snapper', table: 'gran', sh: ['tqo1', 'cer'], f: { Role: 'Flower girl' } }]]],
    ['Lars Lindqvist', 'gf', { email: 'lars.lindqvist@example.com', open: [18, 1], sent: ['delivered', 30] }, [['Lars Lindqvist', 'n', { note: 'So sorry to miss it — sending love from Stockholm.' }]]],
    ['The Andersons', 'gf', { email: 'peter.anderson@example.com', sent: ['delivered', 30] }, [['Peter Anderson', ''], ['Julia Anderson', '']]],
    ['Kenji & Yui Watanabe', 'gfr', { lang: 'ja', email: 'kenji.watanabe@example.com', names: true, open: [17, 3], sent: ['delivered', 30], hotel: true, tr: '2027-03-11 19:25 CUN AA 1088 | 2027-03-15 09:15 CUN AA 1089 | Nomade Tulum' },
      [['Kenji Watanabe', 'y', { meal: 'Grilled red snapper', table: 'zac', sh: ['cer', 'back'], f: { Role: 'Reader' } }], ['Yui Watanabe', 'y', { meal: 'Grilled red snapper', diet: 'No red meat', table: 'zac', sh: ['cer', 'back'] }]]],
    ['Marcus Johnson', 'gfr', { email: 'marcus.j@example.com', plus: 1, open: [15, 2], sent: ['delivered', 30], hotel: true, tr: '2027-03-12 13:50 CUN AA 2401 | 2027-03-14 15:05 CUN AA 2402 | Papaya Playa Project' },
      [['Marcus Johnson', 'y', { meal: 'Short rib barbacoa', table: 'zac', sh: ['cer'], f: { Role: 'Groomsman' } }]]],
    ['Ben Carter & Olivia Reyes', 'gfr', { email: 'ben.carter@example.com', names: true, open: [14, 2], sent: ['delivered', 30], hotel: true, tr: '2027-03-12 13:50 CUN AA 2401 | 2027-03-14 15:05 CUN AA 2402 | Papaya Playa Project' },
      [['Ben Carter', 'y', { meal: 'Short rib barbacoa', table: 'zac', sh: ['cer'], f: { Role: 'Groomsman' } }], ['Olivia Reyes', 'n', { note: 'Olivia has a work trip; Ben will be there.' }]]],
    ['Tom Becker', 'gfr', { email: 'tom.becker@exmaple.com', sent: ['bounced', 30] }, [['Tom Becker', '']]],
    ['Ravi Shah', 'gfr', { email: 'ravi.shah@example.com', open: [3, 1], sent: ['delivered', 30], hotel: false },
      [['Ravi Shah', 'y', { meal: 'Roasted vegetable mole', diets: ['vegan'], replied: 1 }]]],
    ['Lucía & Andrés Romero', 'mu', { lang: 'es', email: 'lucia.romero@example.com', names: true, open: [16, 2], sent: ['delivered', 30], hotel: true, tr: '2027-03-12 16:20 CUN AM 559 | 2027-03-14 19:30 CUN AM 562 | Nomade Tulum' },
      [['Lucía Romero', 'y', { meal: 'Grilled red snapper', table: 'suy', sh: ['cer', 'back'] }], ['Andrés Romero', 'y', { meal: 'Short rib barbacoa', table: 'suy', sh: ['cer', 'back'] }]]],
    ['Grace Kim', 'mu', { email: 'grace.kim@example.com', open: [4, 2], sent: ['delivered', 30], hotel: true, tr: '2027-03-12 18:05 CUN UA 1990 | 2027-03-15 11:10 CUN UA 1991 | Azulik' },
      [['Grace Kim', 'y', { meal: 'Grilled red snapper', diets: ['gluten_free', 'dairy_free'], replied: 2 }]]],
    ['Owen & Emma Brooks', 'mu', { email: 'owen.brooks@example.com', names: true, sent: ['delivered', 30] }, [['Owen Brooks', ''], ['Emma Brooks', '']]],
    ['Sakura Tanaka', 'mu', { lang: 'ja', email: 'sakura.tanaka@example.com', open: [9, 1], sent: ['delivered', 30] }, [['Sakura Tanaka', '']]],
    ['Jordan Ellis', 'wk', { email: 'jordan.ellis@example.com', open: [13, 2], sent: ['delivered', 30], hotel: true, tr: '2027-03-12 14:45 CUN WN 1520 | 2027-03-14 16:25 CUN WN 1521 | Be Tulum' },
      [['Jordan Ellis', 'y', { meal: 'Short rib barbacoa', table: 'azul', sh: ['cer'] }], ['Taylor Ellis', 'y', { meal: 'Roasted vegetable mole', diets: ['vegetarian'], table: 'azul', sh: ['cer'] }]]],
    ['Aisha Bello', 'wk', { email: 'aisha.bello@example.com', open: [11, 1], sent: ['delivered', 30] }, [['Aisha Bello', 'n', { note: 'Congratulations, both of you!' }]]],
    ['Daniel Cho', 'wk', { email: 'daniel.cho@example.com' }, [['Daniel Cho', '']]],
    ['Camila Ortiz', 'wp', { email: 'camila.ortiz@example.com', open: [30, 9], sent: ['delivered', 30], hotel: true, tr: '2027-03-10 13:15 CUN AM 573 | 2027-03-15 12:40 CUN AM 576 | Nomade Tulum' },
      [['Camila Ortiz', 'y', { meal: 'Roasted vegetable mole', diets: ['vegetarian'], table: 'head', sh: ['cer', 'back'], f: { Role: 'Maid of honor', 'Hotel room': 'Nomade · Casita 2', 'Welcome bag': 'Packed' } }]]],
    ['Nils Berg', 'wp', { email: 'nils.berg@example.com', open: [29, 6], sent: ['delivered', 30], hotel: true, tr: '2027-03-11 15:05 CUN DL 1957 | 2027-03-15 12:05 CUN DL 1958 | Nomade Tulum' },
      [['Nils Berg', 'y', { meal: 'Short rib barbacoa', table: 'head', sh: ['cun1', 'cer', 'back'], f: { Role: 'Best man', 'Hotel room': 'Nomade · Casita 3', 'Welcome bag': 'To pack' } }]]],
  ],
  activity: [['Maya Ortiz', ['f:description'], 1.2], ['Theo Lindqvist', ['sc:' + FB], 0.3], ['Maya Ortiz', ['f:x'], 3], ['me', ['f:rsvpq'], 5]],
  opens: [[12, 4], [9, 7], [6, 3], [2, 5], [1, 2]],
  updates: [['Shuttles from Cancún airport leave at 3:30 PM on Thursday. Look for the Maya & Theo sign outside Terminal 3.', 2], ['Room block at Nomade Tulum: use code MAYATHEO by January 31.', 18]],
  messages: [['Chloé Martin', 'chloe.martin@example.com', [[false, 'Bonjour ! Is there a shuttle from the airport on Friday morning?', 3.2], [true, 'Hi Chloé! Friday we have the Tulum airport pickup at 1 PM. From Cancún, a taxi or ADO bus is easiest; we can help book a taxi.', 3.0]]],
    ['Grace Kim', 'grace.kim@example.com', [[false, 'Can I bring my own snacks for the gluten-free thing, or will the caterer have options?', 0.4]]]],
  vendors: { cur: 'USD', list: [
    { cat: 'Venue', name: 'Playa Paraíso beach club', contact: 'Events office', total: 9500, sched: '2027-03-13 15:00', pays: [{ amt: 4750, due: '2026-09-01', paid: '2026-08-28' }, { amt: 4750, due: '2027-02-13', paid: '' }] },
    { cat: 'Catering', name: 'Cocina del Mar', contact: 'Chef Paola', total: 14200, sched: '2027-03-13 17:30', pays: [{ amt: 5000, due: '2026-10-15', paid: '2026-10-12' }, { amt: 9200, due: '2027-03-01', paid: '' }] },
    { cat: 'Photographer', name: 'Luz de Luna Photo', contact: 'Inés', total: 4800, sched: '2027-03-13 14:30', pays: [{ amt: 1600, due: '2026-08-01', paid: '2026-08-01' }, { amt: 3200, due: '2027-03-06', paid: '' }] },
    { cat: 'Florist', name: 'Flores del Caribe', total: 3100, pays: [{ amt: 1000, due: '2026-12-01', paid: '' }] },
    { cat: 'DJ/Band', name: 'DJ Marea', total: 2200, sched: '2027-03-13 20:30', pays: [{ amt: 500, due: '2026-11-01', paid: '2026-10-30' }] },
    { cat: 'Transport', name: 'Riviera Shuttles', contact: 'Dispatch', total: 2650, notes: 'Cancún and Tulum airport pickups, ceremony coaches, late return.' }] },
};
const CONFERENCE = {
  key: 'conference', slug: 'signal-noise-demo', created: 95,
  me: ['Dana Whitfield', 'dana@signalnoise.example'],
  planners: [{ name: 'Marco Ruiz', email: 'marco@signalnoise.example', joined: true }, { name: 'Priya Nair', email: 'priya@signalnoise.example', joined: true }, { name: 'Javits event services', email: 'events@javits-partner.example', joined: false }],
  cfg: { langs: ['es', 'fr', 'ja'], guestMessages: true },
  rsvpq: { meal: false, meals: [], diet: true, plus: false, events: true, evOff: ['Badge pickup and coffee'], qs: false, q: ['', ''] },
  groups: [['sp', 'Speakers'], ['spo', 'Sponsors'], ['st', 'Staff'], ['at', 'Attendees'], ['pr', 'Press']],
  tables: [['hud', 'Hudson', 'round', 8, 220, 300], ['che', 'Chelsea', 'round', 8, 500, 300], ['hl', 'High Line', 'round', 8, 780, 300], ['host', 'Hosts', 'rect', 6, 500, 100, true]],
  showSeats: true,
  shuttles: [['jfk', 'JFK speaker pickup', 'JFK', 'Hilton Garden Inn Times Square Central', '2026-11-17', '14:30', 12, 'Sprinter van', 'Terminal 4 arrivals, door 2', 'Driver: Luis, sign “Signal & Noise”'],
    ['lga', 'LaGuardia pickup', 'LGA', 'Hilton Garden Inn Times Square Central', '2026-11-17', '16:00', 8, 'Van', 'Terminal B ground transportation', ''],
    ['ewr', 'Newark pickup', 'EWR', 'Hilton Garden Inn Times Square Central', '2026-11-17', '13:00', 8, 'Van', 'Terminal C, door 6', ''],
    ['d1', 'Day 1 to Javits', 'Hilton Garden Inn Times Square Central', 'Javits Center', '2026-11-18', '07:45', 28, 'Coach', 'Hotel lobby', 'North Concourse drop-off']],
  fields: [['Badge', 'choice', ['Speaker', 'Sponsor', 'Staff', 'Attendee', 'Press'], 'guest'], ['Company', 'text', [], 'guest'], ['Workshop', 'choice', ['Dashboards people use', 'SQL for designers', 'Prototyping with data'], 'guest'], ['T-shirt', 'choice', ['S', 'M', 'L', 'XL'], 'planners']],
  invites: [['invitation', 'conference', {}]],
  households: [
    ['Dr. Amara Okafor', 'sp', { email: 'amara.okafor@example.com', open: [40, 6], sent: ['delivered', 44], hotel: true, tr: '2026-11-17 13:40 JFK BA 117 | 2026-11-19 21:30 JFK BA 178 | Hilton Garden Inn Times Square Central', trip: true },
      [['Amara Okafor', 'y', { table: 'host', sh: ['jfk', 'd1'], f: { Badge: 'Speaker', Company: 'University of Lagos', 'T-shirt': 'M' } }]]],
    ['Julien Moreau', 'sp', { lang: 'fr', email: 'julien.moreau@example.com', open: [39, 4], sent: ['delivered', 44], hotel: true, tr: '2026-11-17 14:05 JFK AF 22 | 2026-11-20 18:30 JFK AF 23 | Hilton Garden Inn Times Square Central' },
      [['Julien Moreau', 'y', { diets: ['vegetarian'], table: 'hud', sh: ['jfk', 'd1'], f: { Badge: 'Speaker', Company: 'Datavis Lab', Workshop: 'Dashboards people use', 'T-shirt': 'L' } }]]],
    ['Haruto Sato', 'sp', { lang: 'ja', email: 'haruto.sato@example.com', open: [35, 3], sent: ['delivered', 44], hotel: true, tr: '2026-11-17 11:15 JFK JL 4 | 2026-11-20 13:25 JFK JL 3 | Hilton Garden Inn Times Square Central' },
      [['Haruto Sato', 'y', { table: 'hud', sh: ['d1'], f: { Badge: 'Speaker', Company: 'Kumo Analytics', Workshop: 'Prototyping with data', 'T-shirt': 'M' } }]]],
    ['Elena Vasquez', 'sp', { lang: 'es', email: 'elena.vasquez@example.com', open: [33, 2], sent: ['delivered', 44], hotel: true, tr: '2026-11-17 15:55 LGA AA 1421 | 2026-11-19 19:45 LGA AA 1424 | Pod Times Square' },
      [['Elena Vasquez', 'y', { diets: ['gluten_free'], table: 'che', sh: ['lga'], f: { Badge: 'Speaker', Company: 'Mapa Studio', Workshop: 'SQL for designers', 'T-shirt': 'S' } }]]],
    ['Sam Whitaker', 'sp', { email: 'sam.whitaker@example.com', open: [31, 2], sent: ['delivered', 44], hotel: true, tr: '2026-11-17 18:20 NYP Acela 2163 | 2026-11-19 19:00 NYP Acela 2170 | Equinox Hotel New York', trBy: 'planner' },
      [['Sam Whitaker', 'y', { table: 'che', f: { Badge: 'Speaker', Company: 'Civic Data Co.', 'T-shirt': 'XL' } }]]],
    ['Grace Liu', 'sp', { email: 'grace.liu@example.com', open: [8, 1], sent: ['delivered', 44] }, [['Grace Liu', '', { f: { Badge: 'Speaker', Company: 'Northwind Analytics' } }]]],
    ['Northwind Analytics', 'spo', { email: 'events@northwind.example', open: [37, 5], sent: ['delivered', 44], hotel: true, tr: '2026-11-17 12:45 EWR UA 1137 | 2026-11-19 20:10 EWR UA 1140 | Hilton Garden Inn Times Square Central' },
      [['Rachel Kim', 'y', { table: 'hl', sh: ['ewr', 'd1'], f: { Badge: 'Sponsor', Company: 'Northwind Analytics', 'T-shirt': 'S' } }], ['Omar Haddad', 'y', { diets: ['halal'], table: 'hl', sh: ['ewr', 'd1'], f: { Badge: 'Sponsor', Company: 'Northwind Analytics', 'T-shirt': 'L' } }],
        ['Lena Fischer', 'y', { table: 'hl', sh: ['ewr', 'd1'], f: { Badge: 'Sponsor', Company: 'Northwind Analytics', 'T-shirt': 'M' } }]]],
    ['Tidewater Cloud', 'spo', { email: 'hello@tidewater.example', open: [30, 3], sent: ['delivered', 44], hotel: true, tr: '2026-11-17 15:20 LGA DL 2187 | 2026-11-19 18:40 LGA DL 2190 | Equinox Hotel New York' },
      [['Marcus Bell', 'y', { table: 'hl', sh: ['lga'], f: { Badge: 'Sponsor', Company: 'Tidewater Cloud', 'T-shirt': 'XL' } }], ['Ana Costa', 'y', { diets: ['vegan'], table: 'che', sh: ['lga'], f: { Badge: 'Sponsor', Company: 'Tidewater Cloud', 'T-shirt': 'S' } }]]],
    ['Signal & Noise crew', 'st', { email: 'crew@signalnoise.example', open: [45, 12], sent: ['delivered', 44], hotel: false },
      [['Jess Morgan', 'y', { table: 'host', f: { Badge: 'Staff', 'T-shirt': 'M' } }], ['Tomás Reyes', 'y', { table: 'host', f: { Badge: 'Staff', 'T-shirt': 'L' } }], ['Ivy Chen', 'y', { f: { Badge: 'Staff', 'T-shirt': 'S' } }], ['Noah Brooks', 'y', { f: { Badge: 'Staff', 'T-shirt': 'L' } }]]],
    ['Priyanka Desai', 'at', { email: 'priyanka.desai@example.com', open: [28, 2], sent: ['delivered', 44], hotel: true, tr: '2026-11-17 19:10 JFK B6 616 | 2026-11-19 21:00 JFK B6 617 | Pod Times Square' },
      [['Priyanka Desai', 'y', { diets: ['vegetarian'], f: { Badge: 'Attendee', Company: 'Brightline Health', Workshop: 'Dashboards people use', 'T-shirt': 'M' } }]]],
    ['Lucas Ferreira', 'at', { lang: 'pt', email: 'lucas.ferreira@example.com', open: [26, 3], sent: ['delivered', 44], hotel: true, tr: '2026-11-17 06:30 JFK LA 8180 | 2026-11-20 23:55 JFK LA 8181 | Pod Times Square' },
      [['Lucas Ferreira', 'y', { f: { Badge: 'Attendee', Company: 'Dados Abertos', Workshop: 'SQL for designers', 'T-shirt': 'L' } }]]],
    ['Brightline Health team', 'at', { email: 'ops@brightline.example', open: [24, 4], sent: ['delivered', 44], hotel: true, tr: '2026-11-17 22:15 EWR UA 2244 | 2026-11-19 20:55 EWR UA 2247 | Hilton Garden Inn Times Square Central' },
      [['Kevin Park', 'y', { f: { Badge: 'Attendee', Company: 'Brightline Health', Workshop: 'Prototyping with data', 'T-shirt': 'L' } }], ['Maria Santos', 'y', { diets: ['dairy_free'], f: { Badge: 'Attendee', Company: 'Brightline Health', Workshop: 'Dashboards people use', 'T-shirt': 'S' } }],
        ['Dev Patel', 'n', { note: 'Dev can’t travel that week; Kevin and Maria are going.' }]]],
    ['Sophie Wagner', 'at', { lang: 'de', email: 'sophie.wagner@example.com', open: [21, 2], sent: ['delivered', 44], hotel: false, tr: '2026-11-16 16:40 EWR LH 402 | 2026-11-21 17:50 EWR LH 403 |' },
      [['Sophie Wagner', 'y', { f: { Badge: 'Attendee', Company: 'Zahlenwerk', Workshop: 'Prototyping with data', 'T-shirt': 'M' } }]]],
    ['Chris O’Neill', 'at', { email: 'chris.oneill@example.com', open: [6, 1], sent: ['delivered', 44] }, [['Chris O’Neill', '', { f: { Badge: 'Attendee', Company: 'Harbor Bank' } }]]],
    ['Mei Lin', 'at', { email: 'mei.lin@example.com', open: [19, 2], sent: ['delivered', 44], hotel: true },
      [['Mei Lin', 'y', { diets: ['shellfish'], f: { Badge: 'Attendee', Company: 'Harbor Bank', Workshop: 'SQL for designers', 'T-shirt': 'S' } }]]],
    ['Jamal Wright', 'at', { email: 'jamal.wright@exampel.com', sent: ['bounced', 44] }, [['Jamal Wright', '', { f: { Badge: 'Attendee' } }]]],
    ['Alex Novak', 'at', { email: 'alex.novak@example.com', sent: ['queued', 1] }, [['Alex Novak', '']]],
    ['Fatima Zahra', 'at', { email: 'fatima.zahra@example.com', open: [16, 2], sent: ['delivered', 44], hotel: true, tr: '2026-11-17 20:35 JFK AT 200 | 2026-11-20 22:10 JFK AT 201 | Hilton Garden Inn Times Square Central', trip: true },
      [['Fatima Zahra', 'y', { diets: ['halal'], f: { Badge: 'Attendee', Company: 'Casablanca Data', Workshop: 'Dashboards people use', 'T-shirt': 'M' } }]]],
    ['Ben Rosen', 'at', { email: 'ben.rosen@example.com', open: [14, 1], sent: ['delivered', 44] }, [['Ben Rosen', 'n', { note: 'Conflict with a product launch. Next year!' }]]],
    ['Olivia Hart', 'pr', { email: 'olivia.hart@example.com', open: [12, 2], sent: ['delivered', 44], hotel: false },
      [['Olivia Hart', 'y', { f: { Badge: 'Press', Company: 'The Data Desk' } }]]],
    ['Tech Weekly', 'pr', { email: 'desk@techweekly.example', open: [10, 1], sent: ['delivered', 44] }, [['Ravi Menon', '', { f: { Badge: 'Press', Company: 'Tech Weekly' } }]]],
  ],
  activity: [['Priya Nair', ['sc:Hands-on workshops'], 0.6], ['Marco Ruiz', ['f:custom'], 2], ['me', ['f:description'], 6]],
  opens: [[40, 31], [30, 22], [20, 18], [10, 26], [3, 9], [1, 4]],
  updates: [['Badge pickup opens at 8:00 AM on the North Concourse. Bring a photo ID.', 7], ['Speakers: tech check is Tuesday at 4 PM in Hall 1A.', 9, ['sp']]],
  messages: [['Julien Moreau', 'julien.moreau@example.com', [[false, 'Will there be an HDMI-to-USB-C adapter at the podium?', 4], [true, 'Yes, both USB-C and HDMI are on stage, plus a clicker. See you Tuesday at the tech check!', 3.8]]],
    ['Lucas Ferreira', 'lucas.ferreira@example.com', [[false, 'Is the workshop room accessible for a wheelchair?', 0.7]]]],
  vendors: { cur: 'USD', list: [
    { cat: 'Venue', name: 'Javits Center', contact: 'Event services', total: 86000, pays: [{ amt: 43000, due: '2026-06-01', paid: '2026-05-28' }, { amt: 43000, due: '2026-11-01', paid: '2026-10-30' }] },
    { cat: 'Catering', name: 'Hudson Yards Catering Co.', total: 31500, pays: [{ amt: 15750, due: '2026-10-01', paid: '2026-09-29' }, { amt: 15750, due: '2026-11-25', paid: '' }] },
    { cat: 'Transport', name: 'Metro Sprinter Service', total: 3800, notes: 'Airport pickups Nov 17, hotel coach Nov 18.' },
    { cat: 'Other', name: 'Stagecraft AV', total: 22400, pays: [{ amt: 11200, due: '2026-09-15', paid: '2026-09-15' }] }] },
};
// a seeded random stream: the same demo every time it opens
const rnd = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; };
const FIRST = ['Maya', 'Chris', 'Priya', 'Tom', 'Andre', 'Kim', 'Luis', 'Emily', 'Chidi', 'Ada', 'Marta', 'Ryo', 'Ashley', 'Ben', 'Carlos', 'Hannah', 'Jordan', 'Megan', 'Sara', 'Diego',
  'Nina', 'Greg', 'Rosa', 'Leah', 'Sam', 'Alicia', 'Owen', 'Grace', 'Mateo', 'Zoe', 'Ethan', 'Aisha', 'Noah', 'Lena', 'Victor', 'Hana', 'Jake', 'Tess', 'Omar', 'Clara',
  'Ivan', 'Sofia', 'Marcus', 'Julia', 'Kofi', 'Elena', 'Ravi', 'Mia', 'Pablo', 'Erin', 'Felix', 'Yuki', 'Dana', 'Liam', 'Fatima', 'Jonah', 'Paige', 'Arjun', 'Lucy', 'Theo'];
const LAST = ['Patel', 'Alvarez', 'Shah', 'Novak', 'Wilson', 'Nguyen', 'Ortega', 'Carter', 'Okafor', 'Kowalski', 'Yamamoto', 'Moore', 'Fischer', 'Mendoza', 'Schmidt', 'Lee', 'Doyle',
  'Lindgren', 'Hernández', 'Russo', 'Hall', 'Díaz', 'Kim', 'Torres', 'Grant', 'Brennan', 'Walsh', 'Romero', 'Becker', 'Murphy', 'Haddad', 'Costa', 'Sato', 'Rivera', 'Bauer',
  'Ito', 'Morgan', 'Reyes', 'Price', 'Mensah', 'Rossi', 'Iyer', 'Larsen', 'Dubois', 'Flores', 'Quinn', 'Silva', 'Adams', 'Byrne', 'Cho'];
const unique = (r, n) => { const seen = new Set(); const out = []; while (out.length < n) { const nm = FIRST[Math.floor(r() * FIRST.length)] + ' ' + LAST[Math.floor(r() * LAST.length)]; if (!seen.has(nm)) { seen.add(nm); out.push(nm); } } return out; };
const mail = (nm) => nm.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com';
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// ================= Lakefront 10K: ~150 runners over three distances, waves, clubs, 4 in 10 from out of town =================
const RACE_TOWNS = [['Madison, WI', 'MDW WN', 1], ['Milwaukee, WI', '', 0], ['Indianapolis, IN', '', 0], ['Minneapolis, MN', 'ORD DL', 1], ['Detroit, MI', 'ORD DL', 1], ['St. Louis, MO', 'MDW WN', 1],
  ['Toronto, ON', 'ORD AC', 1], ['Denver, CO', 'ORD UA', 1], ['Austin, TX', 'ORD AA', 1], ['New York, NY', 'ORD AA', 1], ['Boston, MA', 'ORD B6', 1], ['Columbus, OH', 'MDW WN', 1],
  ['Des Moines, IA', '', 0], ['Mexico City, Mexico', 'ORD AM', 1], ['Atlanta, GA', 'MDW WN', 1], ['Nashville, TN', 'MDW WN', 1]];
const RACE_HOTELS = ['Hilton Chicago', 'Hilton Chicago', 'Palmer House Hilton', 'Hotel Blake', 'Congress Plaza Hotel', 'Hyatt Regency Chicago'];
const RACE_CLUBS = ['Lakeview Runners', 'South Loop Striders', 'Lincoln Park Pacers', 'Fleet Feet Racing', 'Windy City Women Run'];
// distance → its waves [wave, start] and first bib
const RACE_DIST = [['Half marathon', [['1', '06:45'], ['2', '06:55']], 1, 42], ['10K', [['A', '07:15'], ['B', '07:25'], ['C', '07:35']], 2001, 64], ['5K', [['D', '08:00'], ['E', '08:10']], 5001, 46]];
function raceRunners() {
  const r = rnd(1016); const names = unique(r, RACE_DIST.reduce((n, d) => n + d[3], 0)); const out = []; let k = 0;
  RACE_DIST.forEach(([dist, waves, bib0, n]) => {
    for (let i = 0; i < n; i++) {
      const nm = names[k++]; const [wave, start] = waves[Math.min(waves.length - 1, Math.floor(i * waves.length / n))];
      const away = r() < 0.4; const town = away ? RACE_TOWNS[Math.floor(r() * RACE_TOWNS.length)] : null; const club = r() < 0.35 ? RACE_CLUBS[Math.floor(r() * RACE_CLUBS.length)] : '';
      const f = { Bib: String(bib0 + i), Distance: dist, Wave: wave, 'Start time': start, Hometown: town ? town[0] : 'Chicago, IL', ...(club ? { Club: club } : {}) };
      const o = { email: mail(nm), ...(r() < 0.12 ? { lang: 'es' } : {}) };
      if (r() < 0.7) o.open = [Math.round(2 + r() * 20), 1 + Math.floor(r() * 4)];
      const p = { f };
      if (town) {
        const stay = RACE_HOTELS[Math.floor(r() * RACE_HOTELS.length)]; const day = r() < 0.6 ? '2027-05-15' : '2027-05-14';
        if (town[2] && r() < 0.8) { const [ap, al] = town[1].split(' '); const t1 = 540 + Math.floor(r() * 9) * 60 + (r() < 0.5 ? 25 : 50); const no = Math.floor(100 + r() * 2800);
          o.tr = `${day} ${hhmm(t1)} ${ap} ${al} ${no} | 2027-05-${r() < 0.7 ? '16' : '17'} ${hhmm(900 + Math.floor(r() * 6) * 60 + 10)} ${ap} ${al} ${no + 1} | ${stay}`; o.hotel = true; o.trip = r() < 0.2; }
        else if (r() < 0.6) { o.tr = ` |  | ${stay}`; o.hotel = true; }
        else o.hotel = r() < 0.3;
        if (o.tr && /Hilton Chicago|Palmer House/.test(o.tr)) p.sh = [/Palmer/.test(o.tr) ? 'am2' : 'am1', 'fin'];
        if (o.tr && /ORD/.test(o.tr) && dist === 'Half marathon' && wave === '1' && r() < 0.6) p.sh = ['ord'].concat(p.sh || []);
      }
      out.push([nm, '', o, [[nm, '', p]]]);
    }
  });
  return out;
}
const RACE = {
  key: 'race', slug: 'lakefront-10k-demo', created: 80,
  me: ['Ray Delgado', 'ray@lakefrontrc.example'],
  planners: [{ name: 'Tess Morgan', email: 'tess@lakefrontrc.example', joined: true }, { name: 'Ken Ito', email: 'ken@lakefrontrc.example', joined: true }],
  // a race page starts lean (travel, runners, race weekend, updates); this one has Volunteers and Shuttles turned on
  cfg: { langs: ['es'], guestMessages: true, org: { mods: { vol: true, shut: true, rsvp: false, groups: false, seat: false, inv: false, fld: false, diet: false, badge: false } } },
  x: { packetHours: 'Fri May 14, 12–7 PM\nSat May 15, 9 AM–5 PM', packetBring: 'Photo ID and your bib number (it’s in your confirmation email). Picking up for a friend? Bring a photo of their ID.',
    gearCheck: 'White tents behind the start corrals on Columbus Dr. Use the clear bag from your packet; closes 15 minutes before your wave.', meetup: 'Family reunion area on Columbus Dr south of Balbo, letters A–Z by last name.',
    spots: 'Museum Campus (mile 1 and 5)\nNortherly Island (turnaround)\nFinish straight on Columbus Dr' },
  groups: [['half', 'Half marathon'], ['10k', '10K'], ['5k', '5K']],
  shuttles: [['ord', 'O’Hare pickup · half marathon wave 1', 'ORD', 'Hilton Chicago', '2027-05-15', '13:00', 8, 'Van', 'Terminal 1, door 1E', 'For wave 1 runners arriving Saturday'],
    ['am1', 'Race morning · Hilton Chicago', 'Hilton Chicago', 'Buckingham Fountain', '2027-05-16', '05:45', 40, 'Coach', 'Michigan Ave entrance', 'Gear check is next to the start corrals'],
    ['am2', 'Race morning · Palmer House', 'Palmer House Hilton', 'Buckingham Fountain', '2027-05-16', '05:50', 40, 'Coach', 'Monroe St entrance', ''],
    ['fin', 'Finish back to hotels', 'Adler Planetarium', 'Hilton Chicago', '2027-05-16', '09:45', 40, 'Coach', 'Finish area, Solidarity Dr', 'Loops every 20 minutes until 11:00']],
  fields: [['Bib', 'text', [], 'guest'], ['Distance', 'text', [], 'guest'], ['Wave', 'text', [], 'guest'], ['Start time', 'text', [], 'guest'], ['Hometown', 'text', [], 'planners'], ['Club', 'text', [], 'planners']],
  households: raceRunners().map(h => { h[1] = { 'Half marathon': 'half', '10K': '10k', '5K': '5k' }[h[3][0][2].f.Distance]; return h; }),
  vol: [['Packet pickup', 'Friday early', '2027-05-14', '12:00', '15:30', 6, ['Dave Russo', 'Nina Patel', 'Greg Hall', 'Rosa Díaz', 'Owen Walsh', 'Clara Reyes']],
    ['Packet pickup', 'Friday late', '2027-05-14', '15:30', '19:00', 6, ['Leah Kim', 'Sam Torres', 'Jonah Price']],
    ['Packet pickup', 'Saturday', '2027-05-15', '09:00', '13:00', 8, ['Alicia Grant', 'Paige Byrne', 'Felix Bauer', 'Hana Sato', 'Ivan Rossi']],
    ['Course marshals', 'Race morning', '2027-05-16', '05:30', '10:00', 14, ['Marcus Quinn', 'Julia Costa', 'Kofi Mensah', 'Erin Murphy', 'Victor Silva', 'Lucy Adams', 'Arjun Iyer', 'Tess Larsen', 'Jake Dubois']],
    ['Water station 2 (mile 2)', 'Race morning', '2027-05-16', '06:00', '09:30', 8, ['Zoe Flores', 'Noah Cho', 'Mia Becker', 'Liam Brennan', 'Grace Romero', 'Ethan Walsh', 'Sofia Rivera', 'Pablo Ito']],
    ['Water station 4 (mile 4.5)', 'Race morning', '2027-05-16', '06:15', '10:00', 8, ['Aisha Haddad', 'Theo Larsen', 'Yuki Morgan']],
    ['Finish line medals', 'Race morning', '2027-05-16', '07:30', '11:00', 10, ['Dana Price', 'Omar Novak', 'Lena Shah', 'Mateo Hall', 'Elena Moore', 'Ravi Cho']],
    ['Gear check', 'Race morning', '2027-05-16', '05:30', '11:00', 6, ['Fatima Lee', 'Chris Nguyen']]],
  activity: [['Tess Morgan', ['f:x'], 0.8], ['Ken Ito', ['sc:First wave starts'], 2.5]],
  opens: [[30, 41], [20, 33], [10, 28], [4, 19], [1, 7]],
  updates: [['Packet pickup: Friday 12–7 PM and Saturday 9 AM–5 PM at Lower Hutchinson Field. Bring a photo ID.', 4], ['Half marathoners: wave 1 starts at 6:45 sharp. Corrals close at 6:35.', 2, ['half']]],
  messages: [['Jordan Lee', 'jordan.lee@example.com', [[false, 'Can I switch from the 10K to the half?', 6], [true, 'Yes, until May 1. We’ll move your bib to wave 2 of the half.', 5.5]]]],
  vendors: { cur: 'USD', list: [
    { cat: 'Venue', name: 'Chicago Park District permit', total: 4200, pays: [{ amt: 4200, due: '2027-02-01', paid: '' }] },
    { cat: 'Other', name: 'LakeTime chip timing', contact: 'Ken Ito', total: 6800, pays: [{ amt: 2000, due: '2026-12-15', paid: '' }] },
    { cat: 'Transport', name: 'Loop Coach Lines', total: 3600, notes: 'Two coaches race morning + finish loop.' },
    { cat: 'Rentals', name: 'Barricades and finish arch', total: 2900 }] },
};
// ================= Signal & Noise (organizer demo a year on: Nov 18–19, 2027): attendees, speakers, sponsors, badges =================
const CONF_HOME = { 'Amara Okafor': 'Lagos, Nigeria', 'Julien Moreau': 'Paris, France', 'Haruto Sato': 'Tokyo, Japan', 'Elena Vasquez': 'Mexico City, Mexico', 'Sam Whitaker': 'Boston, MA',
  'Grace Liu': 'San Francisco, CA', 'Rachel Kim': 'Seattle, WA', 'Omar Haddad': 'Seattle, WA', 'Lena Fischer': 'Seattle, WA', 'Marcus Bell': 'Atlanta, GA', 'Ana Costa': 'Atlanta, GA',
  'Priyanka Desai': 'Chicago, IL', 'Lucas Ferreira': 'São Paulo, Brazil', 'Kevin Park': 'Denver, CO', 'Maria Santos': 'Denver, CO', 'Sophie Wagner': 'Berlin, Germany', 'Fatima Zahra': 'Casablanca, Morocco' };
const CONF_CO = ['Harbor Bank', 'Brightline Health', 'Civic Data Co.', 'Northwind Analytics', 'Tidewater Cloud', 'Atlas Insurance', 'Greenleaf Foods', 'Metro Transit Authority', 'Lumen Labs', 'Parsec Media', 'Kestrel Robotics', 'Bluefin Retail'];
const CONF_TOWNS = [['New York, NY', ''], ['New York, NY', ''], ['New York, NY', ''], ['Jersey City, NJ', ''], ['Boston, MA', 'LGA DL'], ['Chicago, IL', 'LGA UA'], ['Toronto, ON', 'LGA AC'], ['Washington, DC', 'LGA AA'], ['Austin, TX', 'JFK B6'],
  ['San Francisco, CA', 'JFK UA'], ['London, UK', 'JFK BA'], ['Philadelphia, PA', ''], ['Atlanta, GA', 'LGA DL'], ['Seattle, WA', 'EWR AS']];
const CONF_HOTELS = ['Hilton Garden Inn Times Square Central', 'Hilton Garden Inn Times Square Central', 'Pod Times Square', 'Equinox Hotel New York', 'Hyatt Place New York Chelsea'];
function confPeople(base) {
  const sh = (v) => (typeof v === 'string' ? v.replace(/2026-11-/g, '2027-11-') : v);
  // one attendee per row (badges are per person), the old Badge field is the attendee Type, everything a year on
  const out = []; base.forEach(([hname, gk, o, people]) => people.forEach(([nm, rep, po = {}], i) => { if (rep === 'n') return;
    const f = { ...(po.f || {}) }; if (f.Badge) { f.Type = f.Badge; delete f.Badge; } if (!f.Type) f.Type = { sp: 'Speaker', spo: 'Sponsor', st: 'Staff', at: 'Attendee', pr: 'Press' }[gk] || 'Attendee';
    f.Hometown = CONF_HOME[nm] || 'New York, NY'; delete f.Workshop; delete f['T-shirt'];
    const oo = { ...o, email: i === 0 && people.length === 1 ? o.email : mail(nm), tr: sh(o.tr) }; delete oo.sent; out.push([nm, gk, oo, [[nm, '', { sh: po.sh, f }]]]); }));
  const r = rnd(1118); const names = unique(r, 70).filter(nm => !out.some(x => x[0] === nm)).slice(0, 46);
  names.forEach((nm, i) => { const town = CONF_TOWNS[Math.floor(r() * CONF_TOWNS.length)]; const kind = i < 7 ? 'Speaker' : i < 11 ? 'Sponsor' : i < 13 ? 'Press' : 'Attendee';
    const o = { email: mail(nm), ...(r() < 0.75 ? { open: [Math.round(2 + r() * 25), 1 + Math.floor(r() * 3)] } : {}) };
    if (town[1]) { const [ap, al] = town[1].split(' '); const no = Math.floor(100 + r() * 2500); const stay = CONF_HOTELS[Math.floor(r() * CONF_HOTELS.length)];
      if (r() < 0.75) { o.tr = `2027-11-17 ${hhmm(600 + Math.floor(r() * 10) * 60 + 15)} ${ap} ${al} ${no} | 2027-11-19 ${hhmm(1080 + Math.floor(r() * 4) * 60)} ${ap} ${al} ${no + 1} | ${stay}`; o.hotel = true; } else o.hotel = r() < 0.4; }
    const p = { f: { Type: kind, Company: CONF_CO[Math.floor(r() * CONF_CO.length)], Hometown: town[0] } };
    if (o.tr && /Hilton Garden/.test(o.tr)) p.sh = (/JFK/.test(o.tr) ? ['jfk'] : /LGA/.test(o.tr) ? ['lga'] : ['ewr']).concat(['d1']);
    out.push([nm, { Speaker: 'sp', Sponsor: 'spo', Press: 'pr' }[kind] || 'at', o, [[nm, '', p]]]); });
  return out;
}
Object.assign(CONFERENCE, {
  year: 1,
  // lean: travel, attendees, agenda, updates — with Badges & check-in and Shuttles turned on
  cfg: { title: 'Signal & Noise 2027', langs: ['es', 'fr', 'ja'], guestMessages: true, org: { mods: { badge: true, shut: true, rsvp: false, groups: false, seat: false, inv: false, fld: false, diet: false, vol: false } } },
  x: { speakers: '' },
  groups: [['sp', 'Speakers'], ['spo', 'Sponsors'], ['st', 'Staff'], ['at', 'Attendees'], ['pr', 'Press']],
  tables: [], invites: [], showSeats: false,
  shuttles: CONFERENCE.shuttles.map(x => x.map(v => (typeof v === 'string' ? v.replace(/2026-11-/g, '2027-11-') : v))),
  fields: [['Type', 'text', [], 'guest'], ['Company', 'text', [], 'guest'], ['Hometown', 'text', [], 'planners']],
  households: confPeople(CONFERENCE.households),
  updates: [['Badge pickup opens at 8:00 AM on the North Concourse. Bring a photo ID.', 7], ['Speakers: tech check is Wednesday at 4 PM in Hall 1A.', 9, ['sp']]],
});
// the wedding keeps the full set: guest list & RSVP, dietary, seating, invitations, shuttles (and groups + fields, one tap away)
WEDDING.cfg = { ...WEDDING.cfg, org: { mods: { rsvp: true, diet: true, seat: true, inv: true, shut: true, groups: false, fld: false, vol: false, badge: false } } };
window.ORG_DEMOS = { wedding: WEDDING, conference: CONFERENCE, race: RACE };
window.ORG_DEMO = { build, fakeClient, fakeNotify };
})();
