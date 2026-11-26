// Invitations end to end against the real Supabase project, the real notify function and real email (Resend), on a site
// (local or live): a throwaway organizer (bbbot0209+invitetest-…@gmail.com, made with the admin API, no sign-in email),
// one throwaway wedding page with a page name and a small guest list. Emails go ONLY to bbbot0209+invitetest-… addresses
// (4 in total: a test to the organizer, two households, nothing else). Everything is backed up and deleted at the end.
//   LOCAL=1 BASE=http://127.0.0.1:18792/ SHOTS=<dir> node tests/invites-live.js
//   BASE=https://1linktrip.com/ SHOTS=<dir> node tests/invites-live.js
//   (needs the Management API token in secrets/supabase-pat, read here and never printed; GMAIL=1 checks the inbox with
//    /Users/bot/bbbot/scripts/gmail_tool.py and writes the received HTML to SHOTS/mail-*.html)
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const BASE = process.env.BASE || 'https://1linktrip.com/';
const SHOTS = process.env.SHOTS || ''; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const REF = 'mljzoujystouqkmmoemn'; const SBURL = `https://${REF}.supabase.co`;
const PAT = fs.readFileSync(process.env.SUPABASE_PAT_FILE || __dirname + '/../../../../secrets/supabase-pat', 'utf8').trim();
const BACKUP = process.env.BACKUP || __dirname + '/../../../eventpages-supabase/backups';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const TS = Date.now().toString(36);
const addr = (k) => `bbbot0209+invitetest-${TS}-${k}@gmail.com`;
const O = { email: addr('owner'), pass: 'T' + Math.random().toString(36).slice(2) + 'x9!' }; const SLUG = `inv-e2e-${TS}`; const NAME = `lena-sam-${TS}`;
const COVER = 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/ff/Mexico_-_beach_by_Tulum%2C_2022.jpg/1280px-Mexico_-_beach_by_Tulum%2C_2022.jpg';
const CFG = { v: 2, ek: 'modes:inv' + TS, type: 'Wedding', title: 'Lena & Sam', start: '2027-06-12T16:00', end: '2027-06-12T23:00', tz: 'Europe/Lisbon', lang: 'en', langs: ['es'], cover: COVER,
  theme: { accent: '#0B7A75', font: 'serif', mode: 'light' },
  venue: { name: 'Quinta da Regaleira', address: 'Sintra, Portugal', lat: 38.796, lon: -9.396, city: 'Sintra', country: 'Portugal', cc: 'pt' },
  tools: { weather: false, travel: false, stay: false, nearby: false, tours: false, mytrip: true, packing: false, shopping: false },
  rsvp: { via: 'form' }, schedule: [{ date: '2027-06-12', time: '16:00', title: 'Ceremony', note: '' }] };
const HH = [ // name, email key, lang, greeting, people
  ['The Garcias', 'garcia', 'es', 'names', ['Ana Garcia', 'Luis Garcia']],
  ['Ben Okafor', 'okafor', '', 'household', ['Ben Okafor']],
  ['The Kims', null, '', 'household', ['Jae Kim', 'Min Kim']]]; // no email: Text only
const HEIC = process.env.HEIC || '/System/Library/PrivateFrameworks/Portrait.framework/Versions/A/Resources/backgrounds/image/be880a5d0e.heic';

(async () => {
  let srv = null; if (process.env.LOCAL) srv = await require('./_pages-server.js').start(+new URL(BASE).port);
  const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${PAT}` } })).json();
  const SR = keys.find(k => k.name === 'service_role').api_key; const ANON = (keys.find(k => k.name === 'anon') || {}).api_key;
  const admin = (p, init = {}) => fetch(SBURL + p, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const sql = async (q) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) })).json();
  const until = async (fn, ms = 30000, step = 800) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, step)); } };
  const u = await (await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: O.email, password: O.pass, email_confirm: true, user_metadata: { full_name: 'Olly Owner' } }) })).json();
  const uid = u.id; ok(/^[0-9a-f-]{36}$/.test(uid || ''), 'throwaway organizer created');
  const browser = await chromium.launch();
  const mk = async (w = 1280) => { const touch = w < 600; const ctx = await browser.newContext({ viewport: { width: w, height: touch ? 844 : 900 }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch, serviceWorkers: 'block' });
    await ctx.route(/open-meteo|overpass|nominatim|maps\.googleapis|tile\.openstreetmap|timeapi|photon|basemaps/, r => r.abort());
    // a local site: the functions only answer 1linktrip.com's origin, so their calls go through the test (same request, origin swapped)
    if (process.env.LOCAL) await ctx.route(/supabase\.co\/functions\/v1\//, async (r) => { const o = new URL(BASE).origin; const cors = { 'access-control-allow-origin': o, 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type', 'access-control-allow-methods': 'POST, GET, OPTIONS' };
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, headers: cors, body: 'ok' });
      const resp = await r.fetch({ headers: { ...r.request().headers(), origin: 'https://1linktrip.com' } }); return r.fulfill({ response: resp, headers: { ...resp.headers(), ...cors } }); });
    const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => { page._err.push(String(e)); console.log('     [pageerror] ' + String(e).slice(0, 300)); });
    await page.goto(BASE + '?x=' + TS); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear()); return { ctx, page }; };
  const signIn = (page) => page.evaluate(async ([e, p]) => { const c = await window.__ep.sb(); const r = await c.auth.signInWithPassword({ email: e, password: p }); localStorage.setItem('ep:signedIn', 'true'); return !!(r.data && r.data.session); }, [O.email, O.pass]);
  const shot = async (page, name, full) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: !!full }); };
  const sends = () => sql(`select h.name, s.status, s.channel, s.lang, s.resend_id, s.to_email, s.error from public.invite_sends s join public.guest_households h on h.id = s.household_id where s.event_id = '${eid}' order by s.queued_at`);
  let eid = ''; const emailed = []; let fakeLog = null;
  try {
    // ===== a published wedding page with a name and a guest list
    const o = await mk(1280); ok(await signIn(o.page), 'organizer signed in');
    const ins = await o.page.evaluate(async ([cfg, slug, name]) => { const c = await window.__ep.sb(); const r = await c.from('events').insert({ slug, config: window.__ep.normalize(JSON.parse(JSON.stringify(cfg))), published: true }).select('id').single(); if (r.error) return r.error;
      const n = await c.rpc('page_name_set', { eid: r.data.id, nm: name }); return { id: r.data.id, nameErr: n.error && n.error.message }; }, [CFG, SLUG, NAME]);
    eid = ins && ins.id; ok(!!eid && !ins.nameErr, `throwaway wedding page published, named /${NAME} ${ins && ins.nameErr || ''}`);
    const built = await o.page.evaluate(async ([eid, HH, emails]) => { const c = await window.__ep.sb(); let k = 0;
      for (const [name, em, lang, greeting, ps] of HH) { const hid = crypto.randomUUID(); let r = await c.from('guest_households').insert({ id: hid, event_id: eid, name, email: em ? emails[em] : null, phone: em ? null : '+15550100', lang, greeting, sort: ++k }); if (r.error) return r.error.message;
        r = await c.from('guest_people').insert(ps.map((n, i) => ({ id: crypto.randomUUID(), household_id: hid, name: n, sort: i }))); if (r.error) return r.error.message; }
      return 'ok'; }, [eid, HH, { garcia: addr('garcia'), okafor: addr('okafor') }]);
    ok(built === 'ok', `guest list: 3 households (Spanish Garcias by first names, Ben, the Kims without email): ${built}`);
    const H = Object.fromEntries((await sql(`select name, id, token from public.guest_households where event_id = '${eid}'`)).map(x => [x.name, x]));

    // ===== the Invitations tab: empty → builder (desktop + phone)
    await o.page.goto(BASE + '?r=' + Date.now() + '#guests/' + eid + '&t=inv'); await o.page.waitForSelector('.iv-start', { timeout: 30000 }); await o.page.waitForTimeout(1200);
    ok(await o.page.$$eval('.gl-tabs [data-gl-tab="inv"]', b => b.length === 1 && b[0].getAttribute('aria-selected') === 'true'), 'Guest list → Invitations tab opens from #guests/<id>&t=inv');
    await shot(o.page, '1280-invitations-start');
    await o.page.click('[data-iv-new]'); await o.page.waitForSelector('[data-iv-prev]'); await o.page.waitForTimeout(2500);
    const tpl = await o.page.$eval('[data-iv-tpl].on', b => b.dataset.ivTpl); ok(tpl === 'classic', `a wedding starts on the Classic style (${tpl})`);
    const ph = await o.page.$$eval('[data-iv-t]', xs => Object.fromEntries(xs.map(x => [x.dataset.ivT, x.placeholder])));
    ok(ph.names === 'Lena & Sam' && /June 12, 2027/.test(ph.date) && /4:00/.test(ph.date) && ph.place === 'Quinta da Regaleira · Sintra' && ph.headline === 'Together with their families', `auto-filled from the page: ${JSON.stringify(ph)}`);
    const blank = await o.page.$eval('[data-iv-prev]', c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] < 200) n++; return n; });
    ok(blank > 200, `the live preview is drawn (${blank} ink samples)`);
    await o.page.fill('[data-iv-t="note"]', 'Dinner and dancing to follow'); await o.page.waitForTimeout(600);
    await shot(o.page, '1280-builder');
    // the phone builder
    const m = await mk(390); ok(await signIn(m.page), 'organizer signed in on a phone');
    await m.page.goto(BASE + '?r=' + Date.now() + '#guests/' + eid + '&t=inv'); await m.page.waitForSelector('.iv-start', { timeout: 30000 }); await m.page.tap('[data-iv-new]'); await m.page.waitForSelector('[data-iv-prev]'); await m.page.waitForTimeout(2500);
    await shot(m.page, '390-builder'); await m.page.tap('[data-iv-tpl="party"]'); await m.page.waitForTimeout(1200); await shot(m.page, '390-builder-party');
    ok(await m.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'phone builder: no sideways overflow');
    // save (en + es, the note translated by the page's translator)
    await o.page.click('[data-iv-save]');
    const row = await until(async () => { const r = await sql(`select id, source, images, design from public.invitations where event_id = '${eid}' and kind = 'invitation'`); return r[0]; }, 120000, 1500);
    ok(row && row.source === 'template' && row.images.en && row.images.es && row.images.en.w === 1200 && row.images.en.h === 1680, `design saved with pictures en + es (${row && Object.keys(row.images || {})})`);
    const esNote = row && row.design && row.design.tx && row.design.tx.es && row.design.tx.es.note; ok(!!esNote && esNote !== 'Dinner and dancing to follow', `the note is translated for the Spanish household: "${esNote}"`);
    for (const l of ['en', 'es']) { const r = await fetch(`${SBURL}/storage/v1/object/public/invitations/${row.images[l].path}`); const b = Buffer.from(await r.arrayBuffer());
      ok(r.status === 200 && /image\/jpeg/.test(r.headers.get('content-type')) && b.length > 30000 && b.length < 900000, `${l} picture is a public JPEG (${Math.round(b.length / 1024)} KB)`); if (SHOTS) fs.writeFileSync(`${SHOTS}/invitation-${l}.jpg`, b); }
    const list = await (await fetch(`${SBURL}/storage/v1/object/list/invitations`, { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: eid + '/' }) })).json();
    ok(!Array.isArray(list) || list.length === 0, `anon cannot list the pictures (${JSON.stringify(list).slice(0, 60)})`);
    const up = await fetch(`${SBURL}/storage/v1/object/invitations/${eid}/evil-123456.jpg`, { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + ANON, 'Content-Type': 'image/jpeg' }, body: Buffer.from('x') });
    ok(up.status >= 400, `anon cannot upload into the page folder (${up.status})`);
    await o.page.waitForSelector('.iv-main', { timeout: 30000 }); await o.page.waitForTimeout(1500);

    // ===== upload a design: HEIC (converted) and a PDF's first page, for the save the date; preview first
    await o.page.click('[data-iv-kind="save_the_date"]'); await o.page.waitForSelector('.iv-start');
    for (const [file, label] of [[HEIC, 'heic'], [path.join(__dirname, 'fixtures', 'inbound-hyatt-kyoto.pdf'), 'pdf']]) {
      if (!fs.existsSync(file)) { ok(false, 'missing fixture ' + file); continue; }
      await o.page.setInputFiles('.iv-start [data-iv-file]', file);
      const got = await o.page.waitForSelector('#gldlg[open] [data-iv-upv] img', { timeout: 60000 }).then(() => true).catch(() => false);
      const dim = got ? await o.page.$eval('#gldlg [data-iv-upv] img', i => [i.naturalWidth, i.naturalHeight]) : [0, 0];
      ok(got && dim[0] > 300 && dim[0] <= 1200, `${label} → preview JPEG ${dim.join('×')}`);
      if (label === 'pdf') { await shot(o.page, '1280-upload-preview'); await o.page.click('#gldlg [data-iv-uok]'); } else await o.page.click('#gldlg [data-iv-ux]');
      await o.page.waitForTimeout(500);
    }
    const std = await until(async () => (await sql(`select source, images from public.invitations where event_id = '${eid}' and kind = 'save_the_date'`))[0], 30000);
    ok(std && std.source === 'upload' && Object.keys(std.images).join() === 'en', 'uploaded save the date saved (one picture, as is)');
    await m.page.goto(BASE + '?r=' + Date.now() + '#guests/' + eid + '&t=inv'); await m.page.waitForSelector('.iv-main', { timeout: 30000 });
    await m.page.tap('[data-iv-kind="save_the_date"]'); await m.page.waitForTimeout(300);
    await m.page.setInputFiles('[data-iv-file]', path.join(__dirname, 'fixtures', 'brand-screenshot.png')); await m.page.waitForSelector('#gldlg[open] [data-iv-upv] img', { timeout: 30000 }); await m.page.waitForTimeout(500);
    await shot(m.page, '390-upload-preview'); await m.page.tap('#gldlg [data-iv-ux]');
    await o.page.click('[data-iv-kind="invitation"]'); await o.page.waitForSelector('.iv-main');

    // ===== send: quota line, a test to me, then two households with today's allowance down to 1 (one goes, one waits)
    await o.page.waitForSelector('[data-iv-quota] b', { timeout: 30000 });
    const q0 = await o.page.textContent('[data-iv-quota]'); ok(/You can email \d+ more households today/.test(q0) && /100 emails a day/.test(q0), `quota line: "${q0.trim()}"`);
    const sel0 = await o.page.$$eval('[data-iv-sel]:checked', xs => xs.length); ok(sel0 === 2, `Not sent filter: the 2 households with email are picked (${sel0})`);
    ok(/Email 2 households/.test(await o.page.textContent('[data-iv-send]')), 'button: Email 2 households');
    await shot(o.page, '1280-send'); await o.page.locator('.iv-send').screenshot({ path: SHOTS ? `${SHOTS}/1280-send-panel.png` : '/tmp/x.png' });
    // test to me (as the Spanish household, since it's first)
    await o.page.click('[data-iv-test]'); await o.page.waitForFunction(() => /Test sent to|Couldn/.test(document.getElementById('toast').textContent), null, { timeout: 60000 });
    const tt = await o.page.textContent('#toast'); ok(/Test sent to bbbot0209\+invitetest-/.test(tt), `test to me: "${tt}"`); emailed.push(O.email);
    ok((await sends()).length === 0, 'a test is not recorded as a send');
    // today's allowance down to 1 (a made-up log entry, removed right after)
    const st = await o.page.evaluate(async (eid) => { const c = await window.__ep.sb(); const { data } = await c.auth.getSession(); const r = await fetch(window.EP_SUPABASE.url + '/functions/v1/notify', { method: 'POST', headers: { Authorization: 'Bearer ' + data.session.access_token, apikey: window.EP_SUPABASE.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'invite_status', id: eid }) }); return r.json(); }, eid);
    ok(st && st.ok && st.left > 2, `invite_status: ${st && st.left} left today, cap ${st && st.dailyCap}`);
    fakeLog = (await sql(`insert into public.email_log (kind, n) values ('e2e-hold-${TS}', ${st.left - 1}) returning id`))[0].id;
    await o.page.reload(); await o.page.waitForSelector('[data-iv-quota] b', { timeout: 30000 }); await o.page.waitForTimeout(800);
    const q1 = await o.page.textContent('[data-iv-quota]'); ok(/You can email 1 more household today/.test(q1) && /1 go now; the other 1 go out automatically tomorrow/.test(q1), `quota line warns: "${q1.trim()}"`);
    await shot(o.page, '1280-send-over-quota');
    await o.page.evaluate(() => { document.getElementById('toast').textContent = ''; }); await o.page.click('[data-iv-send]'); await o.page.waitForFunction(() => /Emailed|Couldn/.test(document.getElementById('toast').textContent), null, { timeout: 90000 });
    const t1 = await o.page.textContent('#toast'); ok(/Emailed 1 household · 1 go out tomorrow/.test(t1), `send: "${t1}"`);
    let S = await sends(); const sentNow = S.filter(x => x.status === 'sent'); const queued = S.filter(x => x.status === 'queued');
    ok(S.length === 2 && sentNow.length === 1 && queued.length === 1 && sentNow[0].resend_id, `one sent (with a Resend id), one queued: ${JSON.stringify(S.map(x => [x.name, x.status, x.lang]))}`);
    emailed.push(...sentNow.map(x => x.to_email));
    const nb = await sql(`select not_before from public.invite_sends where event_id = '${eid}' and status = 'queued'`); ok(nb[0] && /T00:10:00/.test(new Date(nb[0].not_before).toISOString()), `the queued one waits for 00:10 UTC tomorrow (${nb[0] && nb[0].not_before})`);
    await o.page.waitForSelector('[data-iv-rest]:not([hidden])'); await shot(o.page, '1280-send-queued');
    // double-send guard: the one already sent asks first; Cancel sends nothing
    await o.page.click('[data-iv-rf="all"]'); await o.page.waitForTimeout(300);
    for (const x of await o.page.$$('[data-iv-sel]:checked')) await x.uncheck();
    await o.page.check(`[data-iv-sel="${H[sentNow[0].name].id}"]`);
    await o.page.click('[data-iv-send]'); await o.page.waitForSelector('#gldlg[open] [data-c="again"]');
    ok(/Send again to 1 already sent\?/.test(await o.page.textContent('#gldlg h2')), 'Send again to 1 already sent? asked'); await shot(o.page, '1280-send-again');
    await o.page.click('#gldlg [data-c="x"]'); await o.page.waitForTimeout(1500); ok((await sends()).length === 2, 'Cancel → nothing sent');
    // allowance back → "Send the rest now"
    await sql(`delete from public.email_log where id = ${fakeLog}`); fakeLog = null;
    await o.page.evaluate(() => { document.getElementById('toast').textContent = ''; }); await o.page.click('[data-iv-rest-go]'); await o.page.waitForFunction(() => /Emailed|No emails|Couldn/.test(document.getElementById('toast').textContent), null, { timeout: 90000 });
    S = await until(async () => { const x = await sends(); return x.every(y => ['sent', 'delivered'].includes(y.status)) && x; }, 20000) || await sends(); ok(S.every(x => ['sent', 'delivered'].includes(x.status)) && S.length === 2, `Send the rest now: both sent ${JSON.stringify(S.map(x => [x.name, x.status]))}`);
    emailed.push(...S.filter(x => !emailed.includes(x.to_email)).map(x => x.to_email));
    // a text for the Kims (no email): Messages opens; the send is recorded
    await o.page.click('[data-iv-rf="all"]'); await o.page.waitForTimeout(300);
    const smsHref = await o.page.$eval(`[data-iv-text="${H['The Kims'].id}"]`, a => a.getAttribute('href'));
    ok(/^sms:\+15550100\?&body=/.test(smsHref) && decodeURIComponent(smsHref).includes(`/${NAME}?g=${H['The Kims'].token}`), `Text: sms link with greeting + /<name>?g= link (${decodeURIComponent(smsHref).slice(0, 120)})`);
    await o.page.evaluate((id) => { const a = document.querySelector(`[data-iv-text="${id}"]`); a.addEventListener('click', e => e.preventDefault(), { once: true }); a.click(); }, H['The Kims'].id);
    ok(await until(async () => (await sends()).some(x => x.name === 'The Kims' && x.channel === 'text' && x.status === 'sent'), 15000), 'Text tap is recorded as sent (text)');
    // delivery webhook
    ok(!!(await until(async () => (await sends()).filter(x => x.channel === 'email' && x.status === 'delivered').length === 2, 120000, 4000)), `Resend's webhook marks both delivered: ${JSON.stringify((await sends()).map(x => [x.name, x.status]))}`);

    // ===== the guest: personal link from the email → their invitation at the top, in Spanish
    const g = await mk(390); await g.page.goto(BASE + `${NAME}?g=${H['The Garcias'].token}&lang=es`);
    await g.page.waitForSelector('.iv-guest img', { timeout: 30000 }); await g.page.waitForFunction(() => { const i = document.querySelector('.iv-guest img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 30000 });
    const gsrc = await g.page.$eval('.iv-guest img', i => i.getAttribute('src')); ok(gsrc.includes(row.images.es.path), 'the Garcias see the Spanish picture at the top of their page');
    ok(/invitación/i.test(await g.page.$eval('.iv-guest img', i => i.alt)), 'alt text in Spanish');
    await g.page.waitForTimeout(800); await shot(g.page, '390-guest-page');
    const g2 = await mk(1280); await g2.page.goto(BASE + `${NAME}?g=${H['Ben Okafor'].token}`); await g2.page.waitForSelector('.iv-guest img', { timeout: 30000 }); await g2.page.waitForTimeout(1200);
    ok((await g2.page.$eval('.iv-guest img', i => i.getAttribute('src'))).includes(row.images.en.path), 'Ben sees the English picture'); await shot(g2.page, '1280-guest-page');
    const plain = await mk(390); await plain.page.goto(BASE + `${NAME}`); await plain.page.waitForSelector('.ev-hero', { timeout: 30000 }); ok(!(await plain.page.$('.iv-guest')), 'the plain link shows no invitation');
    const anon = await (await fetch(`${SBURL}/rest/v1/rpc/household_invitation`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ s: SLUG, tok: 'a'.repeat(24) }) })).text(); ok(anon === 'null', 'made-up token: no invitation');
    for (const tb of ['invitations', 'invite_sends', 'email_usage']) { const r = await fetch(`${SBURL}/rest/v1/${tb}?select=*`, { headers: { apikey: ANON } }); ok(r.status >= 400, `anon cannot read ${tb} (${r.status})`); }
    // they reply
    const pid = (await sql(`select id from public.guest_people where household_id = '${H['The Garcias'].id}' order by sort`)).map(x => x.id);
    const rr = await fetch(`${SBURL}/rest/v1/rpc/household_rsvp`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ s: SLUG, tok: H['The Garcias'].token, replies: pid.map(id => ({ person_id: id, attending: true, note: null })) }) });
    ok(rr.status < 300, 'the Garcias reply');
    // toggle off → gone from their page
    await o.page.click('label:has([data-iv-show])'); ok(!!(await until(async () => (await sql(`select show_on_page from public.invitations where event_id = '${eid}' and kind = 'invitation'`))[0].show_on_page === false)), '"Show it at the top of their page" off saved');
    await g.page.reload(); await g.page.waitForSelector('.ev-hero', { timeout: 30000 }); await g.page.waitForTimeout(800); ok(!(await g.page.$('.iv-guest')), 'toggle off: not on their page');
    await o.page.click('label:has([data-iv-show])'); await until(async () => (await sql(`select show_on_page from public.invitations where event_id = '${eid}' and kind = 'invitation'`))[0].show_on_page === true);

    // ===== dashboard: Sent → Opened → Replied
    for (const [w, x] of [[1280, o], [390, m]]) {
      await x.page.goto(BASE + '?r=' + Date.now() + '#guests/' + eid); await x.page.waitForSelector('.gl-h', { timeout: 30000 }); await x.page.waitForTimeout(800);
      const tr = await x.page.$eval(`.gl-h[data-h="${H['The Garcias'].id}"] .gl-trail`, e => e.innerText.replace(/\s+/g, ' '));
      if (w === 1280) ok(/^Sent \S+ Opened \S+ Replied 2\/2/.test(tr), `Garcias trail: ${tr}`);
      const tk = await x.page.$eval(`.gl-h[data-h="${H['The Kims'].id}"] .gl-trail`, e => e.innerText.replace(/\s+/g, ' ')); if (w === 1280) ok(/^Texted/.test(tk), `Kims trail: ${tk}`);
      await shot(x.page, `${w}-dashboard`, w === 1280);
    }
    ok(/SENT\s*3\/3/i.test(await o.page.textContent('.gl-sum')), 'summary: Sent 3/3');

    // ===== the received emails
    if (process.env.GMAIL) {
      const q = `to:bbbot0209+invitetest-${TS}`; let lines = [];
      await until(async () => { try { lines = execFileSync('/opt/homebrew/bin/uv', ['run', '--quiet', '--with', 'google-auth', '--with', 'google-api-python-client', 'python3', process.env.GMAIL_HTML || '/tmp/epinv/gmail_html.py', q, SHOTS || '/tmp/epinv/mail'], { encoding: 'utf8', cwd: '/Users/bot/bbbot' }).trim().split('\n').filter(Boolean); } catch { lines = []; } return lines.length >= 3; }, 180000, 10000);
      console.log('     gmail: ' + lines.join('\n     gmail: '));
      ok(lines.length === 3, `3 emails received (test + 2 households): ${lines.length}`);
      const es = lines.find(l => l.includes('-garcia@')); ok(es && /Invitación: Lena & Sam/.test(es) && /dkim=pass/.test(es) && /"?Lena & Sam via 1LinkTrip"? <invites@in\.1linktrip\.com>/.test(es), 'Garcias: Spanish subject, from "Lena & Sam via 1LinkTrip", DKIM pass');
      const ts = lines.find(l => l.includes('-owner@')); ok(ts && /\[Test\]/.test(ts), 'organizer: [Test] email');
      if (es && SHOTS) { const id = es.split('|')[0]; const html = fs.readFileSync(`${SHOTS}/${id}.html`, 'utf8'); ok(html.includes(`/${NAME}?g=${H['The Garcias'].token}&amp;lang=es`) && html.includes(row.images.es.path) && /Hola, Ana y Luis:/.test(html) && /contar con ustedes/.test(html) && !/Querido|invitad[oa]/.test(html), 'Garcias email: personal /<name>?g= link, Spanish picture, first-name greeting');
        fs.copyFileSync(`${SHOTS}/${id}.html`, `${SHOTS}/mail-garcias.html`);
        for (const w of [390, 1280]) { const x = await mk(w); await x.page.goto('file://' + path.resolve(`${SHOTS}/mail-garcias.html`)); await x.page.waitForTimeout(2500); await shot(x.page, `${w}-email`, true); } }
    }
    for (const [n, x] of [['owner', o], ['phone', m], ['garcias', g], ['ben', g2], ['plain', plain]]) ok(!x.page._err.length, `no page errors (${n}) ${x.page._err.join(' | ').slice(0, 300)}`);
  } catch (e) { ok(false, 'crashed: ' + (e && e.stack || e)); }
  finally {
    if (fakeLog) await sql(`delete from public.email_log where id = ${fakeLog}`);
    const z = eid || '00000000-0000-0000-0000-000000000000';
    const objs = await sql(`select name from storage.objects where bucket_id = 'invitations' and name like '${z}/%'`);
    const dump = { events: await sql(`select * from public.events where owner = '${uid}'`), invitations: await sql(`select * from public.invitations where event_id = '${z}'`), invite_sends: await sql(`select * from public.invite_sends where event_id = '${z}'`),
      guest_households: await sql(`select * from public.guest_households where event_id = '${z}'`), guest_people: await sql(`select * from public.guest_people where event_id = '${z}'`), rsvps: await sql(`select * from public.rsvps where event_id = '${z}'`),
      page_names: await sql(`select * from public.page_names where event_id = '${z}'`), storage: objs, user: uid, emailed };
    fs.mkdirSync(BACKUP, { recursive: true }); const bf = `${BACKUP}/invite-e2e-${TS}.json`; fs.writeFileSync(bf, JSON.stringify(dump, null, 1)); fs.chmodSync(bf, 0o600); console.log('backup ' + bf);
    if (Array.isArray(objs) && objs.length) { const r = await admin('/storage/v1/object/invitations', { method: 'DELETE', body: JSON.stringify({ prefixes: objs.map(x => x.name) }) }); ok(r.status < 300, `pictures deleted (${objs.length})`); }
    await sql(`delete from public.events where owner = '${uid}' and slug = '${SLUG}'`);
    await sql(`delete from public.trip_items where owner = '${uid}'`);
    if (uid) await admin(`/auth/v1/admin/users/${uid}`, { method: 'DELETE' });
    const left = await sql(`select (select count(*) from public.events where slug = '${SLUG}') e, (select count(*) from public.invitations where event_id = '${z}') i, (select count(*) from public.invite_sends where event_id = '${z}') s, (select count(*) from storage.objects where bucket_id = 'invitations' and name like '${z}/%') o, (select count(*) from public.page_names where name = '${NAME}') n, (select count(*) from auth.users where id = '${uid}') u`);
    ok(Array.isArray(left) && Object.values(left[0]).every(v => +v === 0), 'test data deleted ' + JSON.stringify(left));
    console.log(`emails sent by this run: ${emailed.length} → ${emailed.join(', ')}`);
    await browser.close(); if (srv) srv.close();
  }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
