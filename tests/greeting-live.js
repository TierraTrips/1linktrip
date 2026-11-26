// Live check of the number-aware, gender-neutral invitation email (11/25): a throwaway organizer
// (bbbot0209+arrivaltest-…), a published Spanish page, two households — the Garcias (Ana + Luis) and Ben (alone) —
// and exactly TWO real emails: "Send test to me" as each household (both go to the organizer's own bbbot0209+ address).
// Gmail is read back and the received HTML screenshotted at 390 + 1280. Everything is backed up and deleted.
//   SHOTS=<dir> node tests/greeting-live.js      (PAT from secrets/supabase-pat, never printed)
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const SHOTS = process.env.SHOTS || '/tmp/arr/greet'; fs.mkdirSync(SHOTS, { recursive: true });
const REF = 'mljzoujystouqkmmoemn'; const SBURL = `https://${REF}.supabase.co`;
const PAT = fs.readFileSync(__dirname + '/../../../../secrets/supabase-pat', 'utf8').trim();
const BACKUP = __dirname + '/../../../eventpages-supabase/backups';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const TS = Date.now().toString(36); const EMAIL = `bbbot0209+arrivaltest-${TS}-owner@gmail.com`; const PASS = 'T' + Math.random().toString(36).slice(2) + 'x9!'; const SLUG = `greet-e2e-${TS}`;
(async () => {
  const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${PAT}` } })).json();
  const SR = keys.find(k => k.name === 'service_role').api_key; const ANON = keys.find(k => k.name === 'anon').api_key;
  const admin = (p, init = {}) => fetch(SBURL + p, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const sql = async (q) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) })).json();
  const u = await (await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: EMAIL, password: PASS, email_confirm: true, user_metadata: { full_name: 'Olly Owner' } }) })).json();
  const uid = u.id; ok(/^[0-9a-f-]{36}$/.test(uid || ''), 'throwaway organizer');
  let eid = ''; const sent = [];
  try {
    const cfg = { v: 2, type: 'Wedding', title: 'Lena & Sam', start: '2027-06-12T16:00', tz: 'Europe/Lisbon', lang: 'en', langs: ['es'], venue: { name: 'Quinta da Regaleira', city: 'Sintra', country: 'Portugal' } };
    const ev = await sql(`insert into public.events (slug, owner, config, published) values ('${SLUG}', '${uid}', '${JSON.stringify(cfg).replace(/'/g, "''")}'::jsonb, true) returning id`);
    eid = ev[0].id; ok(!!eid, 'published page');
    const img = `${eid}/greet${TS}.png`;
    const up = await fetch(`${SBURL}/storage/v1/object/invitations/${img}`, { method: 'POST', headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'image/png' }, body: fs.readFileSync(path.join(__dirname, '..', 'icon-512.png')) });
    ok(up.status < 300, 'picture uploaded ' + up.status);
    const inv = await sql(`insert into public.invitations (event_id, kind, design, images) values ('${eid}', 'invitation', '{}'::jsonb, '{"es":{"path":"${img}","w":512,"h":512}}'::jsonb) returning id`);
    const hh = await sql(`insert into public.guest_households (event_id, name, lang, greeting, sort) values ('${eid}', 'The Garcias', 'es', 'names', 1), ('${eid}', 'Ben Okafor', 'es', 'household', 2) returning id, name`);
    const H = Object.fromEntries(hh.map(x => [x.name, x.id]));
    await sql(`insert into public.guest_people (household_id, name, sort) values ('${H['The Garcias']}', 'Ana Garcia', 0), ('${H['The Garcias']}', 'Luis Garcia', 1), ('${H['Ben Okafor']}', 'Ben Okafor', 0)`);
    const tok = (await (await fetch(`${SBURL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASS }) })).json()).access_token;
    for (const name of ['The Garcias', 'Ben Okafor']) {
      const r = await fetch(`${SBURL}/functions/v1/notify`, { method: 'POST', headers: { apikey: ANON, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', Origin: 'https://1linktrip.com' }, body: JSON.stringify({ kind: 'invite_test', id: inv[0].id, household: H[name] }) });
      const j = await r.json(); ok(j.ok && j.sent === 1, `test email as ${name}: ${JSON.stringify(j)}`); if (j.sent) sent.push(name);
    }
    // Gmail
    let lines = []; const t0 = Date.now();
    while (Date.now() - t0 < 180000) { try { lines = execFileSync('/opt/homebrew/bin/uv', ['run', '--quiet', '--with', 'google-auth', '--with', 'google-api-python-client', 'python3', '/tmp/arr/gmail_html.py', `to:bbbot0209+arrivaltest-${TS}-owner`, SHOTS], { encoding: 'utf8', cwd: '/Users/bot/bbbot' }).trim().split('\n').filter(Boolean); } catch { lines = []; } if (lines.length >= 2) break; await new Promise(r => setTimeout(r, 10000)); }
    console.log('     gmail: ' + lines.join('\n     gmail: ')); ok(lines.length === 2, '2 emails received');
    const browser = await chromium.launch();
    for (const l of lines) {
      const id = l.split('|')[0]; const html = fs.readFileSync(`${SHOTS}/${id}.html`, 'utf8'); const two = /Ana y Luis/.test(html); const who = two ? 'garcias' : 'ben';
      if (two) ok(/\[Test\] Invitación: Lena &amp;? ?Sam|\[Test\] Invitación: Lena & Sam/.test(l) && /Hola, Ana y Luis:/.test(html) && /Nos encantaría contar con ustedes/.test(html) && /Abrir su invitación/.test(html) && !/Querid|invitad[oa]/.test(html), 'Garcias (2): Hola, Ana y Luis: … contar con ustedes … Abrir su invitación');
      else ok(/Hola, Ben Okafor:/.test(html) && /Te invitamos a/.test(html) && /Abrir tu invitación/.test(html) && !/Querid|invitad[oa]|ustedes/.test(html), 'Ben (1): Hola, Ben Okafor: Te invitamos … Abrir tu invitación');
      ok(/dkim=pass/.test(l), `${who}: DKIM pass`);
      for (const w of [390, 1280]) { const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2, isMobile: w < 600 }); const p = await ctx.newPage(); await p.goto('file://' + path.resolve(`${SHOTS}/${id}.html`)); await p.waitForTimeout(1500); await p.screenshot({ path: `${SHOTS}/${w}-email-${who}.png`, fullPage: true }); await ctx.close(); }
    }
    await browser.close();
  } catch (e) { ok(false, 'crashed: ' + (e && e.stack || e)); }
  finally {
    const z = eid || '00000000-0000-0000-0000-000000000000';
    const objs = await sql(`select name from storage.objects where bucket_id = 'invitations' and name like '${z}/%'`);
    const dump = { events: await sql(`select * from public.events where owner = '${uid}'`), invitations: await sql(`select * from public.invitations where event_id = '${z}'`), guest_households: await sql(`select * from public.guest_households where event_id = '${z}'`), guest_people: await sql(`select * from public.guest_people where event_id = '${z}'`), storage: objs, user: uid, sent };
    fs.mkdirSync(BACKUP, { recursive: true }); const bf = `${BACKUP}/greet-e2e-${TS}.json`; fs.writeFileSync(bf, JSON.stringify(dump, null, 1)); fs.chmodSync(bf, 0o600); console.log('backup ' + bf);
    if (Array.isArray(objs) && objs.length) await admin('/storage/v1/object/invitations', { method: 'DELETE', body: JSON.stringify({ prefixes: objs.map(x => x.name) }) });
    await sql(`delete from public.events where owner = '${uid}' and slug = '${SLUG}'`);
    if (uid) await admin(`/auth/v1/admin/users/${uid}`, { method: 'DELETE' });
    const left = await sql(`select (select count(*) from public.events where slug = '${SLUG}') e, (select count(*) from storage.objects where bucket_id = 'invitations' and name like '${z}/%') o, (select count(*) from auth.users where id = '${uid}') u`);
    ok(Array.isArray(left) && Object.values(left[0]).every(v => +v === 0), 'test data deleted ' + JSON.stringify(left));
    console.log(`emails sent: ${sent.length}`);
  }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})();
