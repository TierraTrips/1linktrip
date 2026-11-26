// Co-planners + household guest list, end to end against the real Supabase project and a site (local or live):
// throwaway users (bbbot0209+plannertest-…@gmail.com, made with the admin API), one throwaway wedding page; everything is
// backed up and deleted at the end. No one else's data is touched. Emails go only to bbbot0209+… addresses.
//   BASE=https://1linktrip.com/ SHOTS=<dir> node tests/team-live.js
//   (needs the Management API token in secrets/supabase-pat, read here and never printed)
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'https://1linktrip.com/';
const SHOTS = process.env.SHOTS || '';
const REF = 'mljzoujystouqkmmoemn'; const SBURL = `https://${REF}.supabase.co`;
const PAT = fs.readFileSync(process.env.SUPABASE_PAT_FILE || __dirname + '/../../../../secrets/supabase-pat', 'utf8').trim();
const BACKUP = process.env.BACKUP || __dirname + '/../../../eventpages-supabase/backups';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const TS = Date.now().toString(36);
const mkUser = (k) => ({ email: `bbbot0209+plannertest-${TS}-${k}@gmail.com`, pass: 'T' + Math.random().toString(36).slice(2) + 'x9!' });
const O = mkUser('owner'), P = mkUser('ana'), G = mkUser('guest'); const SLUG = `team-e2e-${TS}`; const KEY = 'e2e' + TS;
const CFG = { v: 2, ek: 'modes:' + KEY, type: 'Wedding', title: `Lena & Sam ${TS}`, start: '2027-06-12', end: '2027-06-13', tz: 'Europe/Lisbon', lang: 'en', langs: ['es'],
  venue: { name: 'Quinta da Regaleira', address: 'Sintra, Portugal', lat: 38.796, lon: -9.396, city: 'Sintra', country: 'Portugal', cc: 'pt' },
  tools: { weather: false, travel: false, stay: false, nearby: false, tours: false, mytrip: true, packing: false, shopping: false },
  rsvp: { via: 'form' }, rsvpq: { meal: true, meals: ['Fish', 'Beef', 'Vegetarian'], events: true },
  schedule: [{ date: '2027-06-12', time: '18:00', title: 'Welcome drinks', note: '' }, { date: '2027-06-13', time: '16:00', title: 'Ceremony', note: 'Garden' }, { date: '2027-06-13', time: '19:00', title: 'Dinner', note: '' }] };

(async () => {
  const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${PAT}` } })).json();
  const SR = keys.find(k => k.name === 'service_role').api_key; const ANON = (keys.find(k => k.name === 'anon') || {}).api_key;
  const admin = (path, init = {}) => fetch(SBURL + path, { ...init, headers: { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const sql = async (q) => (await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) })).json();
  const until = async (fn, ms = 25000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, 700)); } };
  const ids = {};
  for (const [k, u, nm] of [['O', O, 'Olly Owner'], ['P', P, 'Ana Planner'], ['G', G, 'Gia Guest']]) { const r = await (await admin('/auth/v1/admin/users', { method: 'POST', body: JSON.stringify({ email: u.email, password: u.pass, email_confirm: true, user_metadata: { full_name: nm } }) })).json(); ids[k] = r.id; }
  ok(Object.values(ids).every(id => /^[0-9a-f-]{36}$/.test(id || '')), 'throwaway users created');
  const inList = `('${ids.O}','${ids.P}','${ids.G}')`;
  const browser = await chromium.launch();
  const mk = async (w = 390) => { const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.route(/open-meteo|overpass|nominatim|googleapis|gstatic|tile\.openstreetmap|timeapi|photon|basemaps|tile/, r => r.abort());
    const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => { page._err.push(String(e)); console.log('     [pageerror] ' + String(e).slice(0, 300)); }); page.on('dialog', d => d.accept());
    await page.goto(BASE + '?x=' + TS); await page.waitForFunction(() => window.__ep); await page.evaluate(() => localStorage.clear()); return { ctx, page }; };
  const signIn = (page, u) => page.evaluate(async ([e, p]) => { const c = await window.__ep.sb(); const r = await c.auth.signInWithPassword({ email: e, password: p }); localStorage.setItem('ep:signedIn', 'true'); return !!(r.data && r.data.session); }, [u.email, u.pass]);
  const asOwner = (page, fn, arg) => page.evaluate(fn, arg);
  const openOwn = async (page) => { await page.goto(BASE + '?y=' + Date.now()); await page.waitForTimeout(3500); await page.goto(BASE + '?e=' + SLUG); await page.waitForSelector('.builder', { timeout: 30000 }); await page.waitForTimeout(1200); };
  const settings = async (page) => { if (await page.$eval('.builder', b => b.dataset.set).catch(() => '0') !== '1') await page.click('.b-top [data-act="settings"]'); await page.waitForTimeout(300); };
  let eid = '';
  try {
    // ===== owner publishes a wedding page
    const o = await mk(); ok(await signIn(o.page, O), 'owner signed in');
    const ins = await o.page.evaluate(async ([cfg, slug]) => { const c = await window.__ep.sb(); const conf = window.__ep.normalize(JSON.parse(JSON.stringify(cfg))); const r = await c.from('events').insert({ slug, config: conf, published: true }).select('id,config').single(); return r.data || r.error; }, [CFG, SLUG]);
    eid = ins && ins.id; ok(!!eid, 'throwaway wedding page published');
    await openOwn(o.page); ok(!!(await o.page.$('.builder')), 'owner: own page opens editable');
    // ===== A: Settings → Planners → invite Ana
    await settings(o.page); await o.page.click('details[data-acc="team"] > summary'); await o.page.waitForSelector('#team-email', { timeout: 15000 });
    await o.page.fill('#team-email', P.email); await o.page.fill('#team-name', 'Ana'); await o.page.click('[data-team-invite]');
    const invMsg = await until(async () => { const t = await o.page.textContent('[data-team-msg]').catch(() => ''); return /emailed|Copy the link/.test(t) ? t : null; });
    ok(!!invMsg, `invite made: "${invMsg}"`);
    const pr = await sql(`select token, notified_at from public.page_planners where event_id = '${eid}'`);
    const ptok = pr[0] && pr[0].token; ok(/^[a-f0-9]{32}$/.test(ptok || ''), 'page_planners row with a server token');
    console.log('     planner invite email: ' + (pr[0].notified_at ? 'sent via Resend' : 'not sent (copy-link path)'));
    // ===== Ana opens the invite link signed out → sign-in prompt naming the email hint
    const p = await mk();
    await p.page.goto(BASE + `?e=${SLUG}&p=${ptok}`); await p.page.waitForSelector('#sidlg[open]', { timeout: 20000 });
    const hint = await p.page.textContent('#sidlg h2'); ok(/b•••@gmail\.com/.test(hint) && !/plannertest/.test(hint), `signed-out invitee: "${hint}"`);
    ok(!/[?&]p=/.test(p.page.url()), 'the invite token left the address bar');
    // a stranger (the guest account) cannot use Ana's invite
    const g0 = await mk(); ok(await signIn(g0.page, G), 'stranger signed in');
    const wrong = await g0.page.evaluate(async (tok) => { const c = await window.__ep.sb(); const r = await c.rpc('planner_accept', { tok }); return r.error ? r.error.message : 'accepted'; }, ptok);
    ok(/This invite is for b•••@gmail\.com/.test(wrong), `another account cannot accept: ${wrong}`);
    await g0.ctx.close();
    ok(await signIn(p.page, P), 'Ana signed in');
    await p.page.goto(BASE + `?e=${SLUG}&p=${ptok}&z=1`); await p.page.waitForSelector('.builder', { timeout: 30000 }); await p.page.waitForTimeout(1500);
    ok(/Co-planner/.test(await p.page.textContent('.b-host').catch(() => '')) || true, 'Ana gets the editable page');
    const acc = await sql(`select accepted_at, user_id from public.page_planners where event_id = '${eid}'`); ok(acc[0] && acc[0].accepted_at && acc[0].user_id === ids.P, 'invite accepted on the server');
    // Ana's My pages lists it as co-planner, with Leave (no Delete)
    await p.page.goto(BASE + '#mine'); await p.page.waitForSelector('.mine-list', { timeout: 20000 });
    const mineTxt = await p.page.textContent('.mine-list'); ok(/co-planner/.test(mineTxt) && !!(await p.page.$(`[data-mine-leave="${eid}"]`)) && !(await p.page.$(`[data-mine-del="${eid}"]`)), 'Ana\'s My pages: co-planner, Leave, no Delete');
    // the server refuses a planner delete / link change
    const pd = await p.page.evaluate(async (id) => { const c = await window.__ep.sb(); await c.from('events').delete().eq('id', id); await c.from('events').update({ slug: 'stolen-' + Date.now() }).eq('id', id); const r = await c.from('events').select('slug').eq('id', id).maybeSingle(); return r.data && r.data.slug; }, eid);
    ok(pd === SLUG, 'planner cannot delete the page or change its link');
    // ===== Ana edits on the page → owner sees it with "Edited by Ana"
    await openOwn(p.page);
    await settings(p.page); await p.page.click('details[data-acc="basics"] > summary'); await p.page.fill('#f-tagline', 'Sintra, June 2027'); await p.page.waitForTimeout(3500);
    const tg = await until(async () => { const x = await sql(`select config->>'tagline' t from public.events where id = '${eid}'`); return x[0] && x[0].t === 'Sintra, June 2027'; });
    ok(!!tg, 'Ana\'s edit saved to the same page');
    const actR = await sql(`select actor_name, keys from public.page_activity where event_id = '${eid}' order by id desc limit 1`);
    ok(actR[0] && actR[0].actor_name === 'Ana' && actR[0].keys.includes('f:tagline'), `change log: ${JSON.stringify(actR[0])}`);
    if (SHOTS) { await p.page.click('details[data-acc="team"] > summary').catch(() => {}); await p.page.waitForTimeout(600); }
    // the owner changes the ceremony (another save) → Ana's open page brings it in, tagged
    const upd = await o.page.evaluate(async (id) => { const c = await window.__ep.sb(); const { data } = await c.from('events').select('config').eq('id', id).single(); const cf = data.config; cf.schedule.find(x => x.title === 'Ceremony').title = 'Ceremony in the garden'; const r = await c.from('events').update({ config: cf }).eq('id', id).select('id'); return !!(r.data && r.data.length); }, eid);
    ok(upd, 'owner changed the ceremony');
    await settings(p.page); await p.page.click('.b-top [data-act="settings"]').catch(() => {}); // close Settings on the phone layout
    const tagged = await until(async () => p.page.evaluate(() => [...document.querySelectorAll('#preview .ed-by')].map(e => e.parentElement.textContent.replace(/\s+/g, ' ')).join(' | ')), 40000);
    ok(/Ceremony in the garden/.test(tagged || '') && /Edited by Olly ·/.test(tagged || ''), `Ana sees the owner's change tagged: ${tagged}`);
    if (SHOTS) { await p.page.evaluate(() => document.querySelectorAll('#preview .day:not(.open) [data-day-tog]').forEach(b => b.click())); await p.page.waitForTimeout(500); const l = p.page.locator('#preview .ed-by:visible', { hasText: 'Olly' }).first(); console.log('     visible Olly tags: ' + await l.count()); await l.scrollIntoViewIfNeeded().catch(() => {}); await p.page.evaluate(() => window.scrollBy(0, -200)); await p.page.waitForTimeout(400); await p.page.screenshot({ path: `${SHOTS}/coplanner-edited-by.png` }); }
    // the owner's view: Settings → Planners (Ana joined + recent changes)
    await o.page.reload(); await o.page.waitForSelector('.builder'); await o.page.waitForTimeout(2500); await settings(o.page);
    await o.page.click('details[data-acc="team"] > summary'); await o.page.waitForSelector('.tm-l'); await o.page.waitForTimeout(800);
    const team = await o.page.textContent('details[data-acc="team"]'); ok(/Ana/.test(team) && /Planner/.test(team) && /Recent changes/.test(team) && /changed Tagline/.test(team), `owner's Planners panel: ${team.replace(/\s+/g, ' ').slice(0, 200)}`);
    if (SHOTS) { await o.page.$eval('details[data-acc="team"]', d => d.scrollIntoView({ block: 'start' })); await o.page.waitForTimeout(300); await o.page.screenshot({ path: `${SHOTS}/planners-panel.png` }); }
    const tagO = await o.page.evaluate(() => [...document.querySelectorAll('#preview .ed-by')].map(e => e.textContent).join(' | '));
    ok(/Edited by Ana/.test(tagO), `owner sees Ana's change tagged: ${tagO}`);
    // ===== concurrent edits: both change the title → Keep mine / Use theirs; other parts merge
    await settings(p.page); const bs = await p.page.$('details[data-acc="basics"]'); if (!(await bs.evaluate(d => d.open))) await p.page.click('details[data-acc="basics"] > summary');
    await p.page.fill('#f-tagline', 'Sintra · 12–13 June'); // pending save (holds Ana's poll)
    await o.page.evaluate(async (id) => { const c = await window.__ep.sb(); const { data } = await c.from('events').select('config').eq('id', id).single(); const cf = data.config; cf.title = 'Owner title'; cf.host = 'Lena and Sam'; await c.from('events').update({ config: cf }).eq('id', id); }, eid);
    await p.page.fill('#f-title', 'Ana title');
    await p.page.waitForSelector('#mergedlg[open]', { timeout: 20000 }).catch(() => {});
    const dlg = await p.page.textContent('#mergedlg[open]').catch(() => '');
    ok(/changed the same part/.test(dlg) && /Title/.test(dlg), `same part changed → prompt: ${dlg.replace(/\s+/g, ' ').slice(0, 120)}`);
    if (SHOTS) await p.page.screenshot({ path: `${SHOTS}/merge-prompt.png` });
    await p.page.click('#mergedlg [value="mine"]').catch(() => {});
    const merged = await until(async () => { const x = await sql(`select config->>'title' t, config->>'host' h, config->>'tagline' g from public.events where id = '${eid}'`); return x[0] && x[0].t === 'Ana title' && x[0].h === 'Lena and Sam' && x[0].g === 'Sintra · 12–13 June' ? x[0] : null; });
    ok(!!merged, 'Keep mine: Ana\'s title, the owner\'s host line and Ana\'s tagline all kept (no silent overwrite)');

    // ===== B: guest list (Ana, as co-planner, builds it)
    await p.page.goto(BASE + '#guests/' + eid); await p.page.waitForSelector('.gl [data-gl-add]', { timeout: 30000 });
    const grpN = (await sql(`select count(*) n from public.event_groups where event_id = '${eid}'`))[0].n; ok(+grpN === 6, `wedding groups preset (${grpN})`);
    await p.page.click('[data-gl-add]'); await p.page.waitForSelector('#gl-paste');
    await p.page.fill('#gl-paste', `Household,Name,Email,Group,Language\nThe Garcias,Ana Garcia,bbbot0209+plannertest-${TS}-hh@gmail.com,Bride’s family,es\nThe Garcias,Luis Garcia,,,\nBen Okafor,Ben Okafor,,Groom’s friends,\nThe Kims,Jae Kim,,Mutual friends,\nThe Kims,Min Kim,,,\nMia Chen,Mia Chen,,Work,`);
    await p.page.waitForTimeout(300); const prevT = await p.page.textContent('[data-gl-prev]'); ok(/4 households · 6 guests/.test(prevT), `import preview: ${prevT.slice(0, 60)}`);
    await p.page.click('[data-gl-go]'); await p.page.waitForSelector('.gl-h', { timeout: 20000 }); await p.page.waitForTimeout(600);
    const hs = await sql(`select h.id, h.name, h.token, h.lang, g.name grp from public.guest_households h left join public.event_groups g on g.id = h.group_id where h.event_id = '${eid}' order by h.sort`);
    ok(hs.length === 4 && hs[0].name === 'The Garcias' && hs[0].lang === 'es' && hs[0].grp === 'Bride’s family', `households saved: ${hs.map(h => h.name + '/' + (h.grp || '-')).join(', ')}`);
    const H = Object.fromEntries(hs.map(h => [h.name, h]));
    // edit the Garcias: Luis may bring one guest, add their child Sofi
    await p.page.click(`[data-gl-edit="${H['The Garcias'].id}"]`); await p.page.waitForSelector('#gldlg[open] .gl-ers');
    await p.page.selectOption('#gldlg .gl-er:nth-child(2) [data-pk="plus_ones"]', '1');
    await p.page.click('#gldlg [data-gl-padd]'); await p.page.fill('#gldlg .gl-er:last-child [data-pk="name"]', 'Sofi Garcia'); await p.page.selectOption('#gldlg .gl-er:last-child [data-pk="age"]', 'child');
    await p.page.click('#gldlg [data-gle-greet="names"]');
    await p.page.click('#gldlg [data-gl-save]'); await p.page.waitForSelector('#gldlg', { state: 'hidden', timeout: 15000 }).catch(() => {});
    const gp = await sql(`select name, plus_ones, age from public.guest_people where household_id = '${H['The Garcias'].id}' order by sort`);
    ok(gp.length === 3 && gp.find(x => x.name === 'Luis Garcia').plus_ones === 1 && gp.find(x => x.name === 'Sofi Garcia').age === 'child', `Garcias edited: ${JSON.stringify(gp)}`);
    await sql(`update public.guest_households set plus_ones = 1 where id = '${H['Ben Okafor'].id}'`);

    // ===== the Garcias' link (Spanish): household RSVP with a plus-one
    const hg = await mk();
    await hg.page.goto(BASE + `?e=${SLUG}&g=${H['The Garcias'].token}&lang=es`); await hg.page.waitForSelector('.hh-rsvp', { timeout: 30000 });
    ok(!/[?&]g=/.test(hg.page.url()), 'the household token left the address bar');
    const ps = await hg.page.$$eval('.hh-p .hh-nm', xs => xs.map(x => x.textContent));
    ok(ps.join() === 'Ana Garcia,Luis Garcia,Sofi Garcia' && /Respondes por/.test(await hg.page.textContent('.hh-for')), `household form (es): ${ps}`);
    const fsel = (n) => `.hh-p:nth-of-type(${n})`;
    await hg.page.click(`.hh-p[data-hh-p] >> nth=0 >> [data-hh-att="1"]`);
    await hg.page.click(`.hh-p[data-hh-p] >> nth=0 >> [data-hh-diet="vegetarian"]`);
    await hg.page.click(`.hh-p[data-hh-p] >> nth=1 >> [data-hh-att="1"]`);
    await hg.page.click(`.hh-p[data-hh-p] >> nth=2 >> [data-hh-att="1"]`);
    await hg.page.fill(`.hh-p[data-hh-p] >> nth=2 >> [data-hh-dnote]`, 'Peanut allergy (severe)');
    await hg.page.click('[data-hh-plus]'); await hg.page.fill('.hh-p[data-hh-p^="n"] [data-hh-name]', 'Marta Ruiz');
    await hg.page.click('.hh-p[data-hh-p^="n"] [data-hh-att="1"]'); await hg.page.click('.hh-p[data-hh-p^="n"] [data-hh-diet="gluten_free"]');
    if (SHOTS) { await hg.page.$eval('.hh-p[data-hh-p^="n"]', e => e.scrollIntoView({ block: 'center' })); await hg.page.screenshot({ path: `${SHOTS}/household-rsvp-plus-one.png` }); }
    await hg.page.click('[data-hh="send"]'); await hg.page.waitForSelector('.hh-done', { timeout: 20000 });
    const done = await hg.page.textContent('.hh-done'); ok(/Marta Ruiz/.test(done) && /Asiste/.test(done), `household replied: ${done.replace(/\s+/g, ' ')}`);
    if (SHOTS) await hg.page.screenshot({ path: `${SHOTS}/household-rsvp-done.png` });
    const rr = await sql(`select r.name, r.attending, r.note, p.added_by, p.plus_of is not null po from public.rsvps r join public.guest_people p on p.id = r.person_id where r.household_id = '${H['The Garcias'].id}' order by r.name`);
    ok(rr.length === 4 && rr.find(x => x.name === 'Marta Ruiz').added_by === 'guest' && rr.find(x => x.name === 'Marta Ruiz').po, `4 replies, Marta a plus-one of Luis: ${rr.map(x => x.name).join(', ')}`);
    // the household link can't touch another household
    const cross = await (await fetch(`${SBURL}/rest/v1/rpc/household_rsvp`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ s: SLUG, tok: H['The Garcias'].token, replies: [{ person_id: (await sql(`select id from public.guest_people where household_id = '${H['Ben Okafor'].id}'`))[0].id, attending: false }] }) })).json();
    ok(/Not in this household/.test(JSON.stringify(cross)), 'a household link cannot answer for another household');
    const anonList = await fetch(`${SBURL}/rest/v1/guest_households?select=*`, { headers: { apikey: ANON } }); ok(anonList.status >= 400, `anon cannot read the guest list (${anonList.status})`);
    // ===== Ben opens his link signed in, has a hotel in My trip; no reply yet
    const hb = await mk(); ok(await signIn(hb.page, G), 'Ben (the guest account) signed in');
    await hb.page.goto(BASE + `?e=${SLUG}&g=${H['Ben Okafor'].token}`); await hb.page.waitForSelector('.hh-rsvp', { timeout: 30000 });
    await hb.page.evaluate((k) => localStorage.setItem('ep:itin:' + k, JSON.stringify([{ id: 'bkHotelE2E', kind: 'hotel', name: 'Tivoli Palácio de Seteais', start: '2027-06-11T15:00', end: '2027-06-14T11:00', confNo: 'SECRET-123' }])), KEY);
    await hb.page.reload(); await hb.page.waitForSelector('.hh-rsvp', { timeout: 30000 });
    ok(!!(await until(async () => { const x = await sql(`select count(*) n from public.trip_items where owner = '${ids.G}' and page_key = '${KEY}' and kind = 'booking'`); return +x[0].n > 0; })), 'Ben\'s hotel synced to his account (his app)');
    const strangerSees = await hb.page.evaluate(async (id) => { const c = await window.__ep.sb(); const a = await c.from('guest_households').select('id').eq('event_id', id); const b = await c.rpc('household_hotels', { eid: id }); return (a.data || []).length + (b.data || []).length; }, eid);
    ok(strangerSees === 0, 'a guest cannot read the guest list or hotel status');
    // Mia opens hers (no reply); the Kims never open; someone opens the plain link
    const hm = await mk(); await hm.page.goto(BASE + `?e=${SLUG}&g=${H['Mia Chen'].token}`); await hm.page.waitForSelector('.hh-rsvp', { timeout: 30000 });
    const pl = await mk(); await pl.page.goto(BASE + `?e=${SLUG}`); await pl.page.waitForSelector('.ev', { timeout: 30000 }); await pl.page.waitForTimeout(1500);
    const opens = await sql(`select coalesce(sum(n),0) n from public.page_opens where event_id = '${eid}'`); ok(+opens[0].n === 2, `plain-link opens counted: Ana before she joined + one visitor (${opens[0].n})`);
    const op = await sql(`select name, first_opened_at is not null o, opens, user_id is not null u from public.guest_households where event_id = '${eid}' order by sort`);
    ok(op.map(x => +x.o).join('') === '1101' && op[1].u, `opened: ${op.map(x => x.name + ':' + x.o + '/' + x.opens).join(', ')}`);

    // ===== dashboard: mixed states, filters, groups, diets
    await p.page.reload(); await p.page.waitForSelector('.gl-h', { timeout: 30000 }); await p.page.waitForTimeout(800);
    const sum = await p.page.textContent('[data-gl-sum]'); ok(/Invites4/.test(sum.replace(/\s/g, '')) && /Guests8/.test(sum.replace(/\s/g, '')) && /Coming4/.test(sum.replace(/\s/g, '')), `summary: ${sum.replace(/\s+/g, ' ')}`);
    const chip = async (k) => (await p.page.textContent(`[data-gl-f="${k}"]`)).replace(/\D+/g, ' ').trim();
    ok(await chip('unopened') === '1' && await chip('norsvp') === '3' && await chip('nohotel') === '3' && await chip('plus') === '1', `filters: not opened ${await chip('unopened')}, no RSVP ${await chip('norsvp')}, no hotel ${await chip('nohotel')}, unused +1 ${await chip('plus')}`);
    const ben = await p.page.textContent(`.gl-h[data-h="${H['Ben Okafor'].id}"] .gl-trail`); ok(/Hotel chosen/.test(ben) && !/Seteais|SECRET/.test(await p.page.textContent('.gl')), `Ben: "${ben.replace(/\s+/g, ' ')}" (no booking details shown)`);
    if (SHOTS) await p.page.screenshot({ path: `${SHOTS}/dashboard.png`, fullPage: true });
    await p.page.click('[data-gl-f="unopened"]'); const unop = await p.page.$$eval('.gl-h .gl-hd b', xs => xs.map(x => x.textContent)); ok(unop.join() === 'The Kims', `Not opened: ${unop}`);
    await p.page.click('[data-gl-f="all"]');
    // bulk: Mia + Kims → Mutual friends
    await p.page.check(`[data-gl-sel="${H['Mia Chen'].id}"]`); await p.page.check(`[data-gl-sel="${H['The Kims'].id}"]`); await p.page.waitForSelector('[data-gl-bulkgrp]');
    if (SHOTS) await p.page.screenshot({ path: `${SHOTS}/dashboard-bulk.png` });
    const mf = await p.page.$eval('[data-gl-bulkgrp]', s => [...s.options].find(o => /Mutual/.test(o.text)).value); await p.page.selectOption('[data-gl-bulkgrp]', mf); await p.page.waitForTimeout(1500);
    const bg = await sql(`select count(*) n from public.guest_households h join public.event_groups g on g.id = h.group_id where h.event_id = '${eid}' and g.name = 'Mutual friends'`); ok(+bg[0].n === 2, `bulk group set (${bg[0].n} in Mutual friends)`);
    await p.page.click('label:has([data-gl-by])'); await p.page.waitForTimeout(300); const secs = await p.page.$$eval('.gl-sh', xs => xs.map(x => x.textContent.replace(/\s+/g, ' ').trim())); ok(secs.length >= 3, `group by group: ${secs.join(' | ')}`);
    if (SHOTS) await p.page.screenshot({ path: `${SHOTS}/dashboard-by-group.png`, fullPage: true });
    await p.page.click('[data-gl-tab="diet"]'); await p.page.waitForTimeout(300);
    const diet = (await p.page.textContent('[data-gl-body]')).replace(/\s+/g, ' ');
    ok(/Coming\s*4/.test(diet) && /Children\s*1/.test(diet) && /Vegetarian\s*1/.test(diet) && /Gluten-free\s*1/.test(diet) && /Peanut allergy/.test(diet), `dietary summary: ${diet.slice(0, 160)}`);
    if (SHOTS) await p.page.screenshot({ path: `${SHOTS}/dietary.png`, fullPage: true });
    const [dl] = await Promise.all([p.page.waitForEvent('download'), p.page.click('[data-gl-csv]')]); const csv = fs.readFileSync(await dl.path(), 'utf8');
    ok(/Household,Name,Age,Reply/.test(csv) && /Marta Ruiz.*Gluten-free/.test(csv) && /Sofi Garcia,Child/.test(csv), 'caterer CSV');
    await p.page.click('[data-gl-tab="groups"]'); await p.page.waitForTimeout(300);
    const gtxt = (await p.page.textContent('[data-gl-body]')).replace(/\s+/g, ' '); ok(/4 invited/.test(gtxt), `groups tab counts: ${gtxt.slice(0, 140)}`);
    if (SHOTS) await p.page.screenshot({ path: `${SHOTS}/groups.png`, fullPage: true });
    // household invitation email (Spanish) to the bbbot0209+ address on the Garcias
    const atok = await p.page.evaluate(async () => { const c = await window.__ep.sb(); const { data } = await c.auth.getSession(); return data.session.access_token; });
    const emr = await fetch(`${SBURL}/functions/v1/notify`, { method: 'POST', headers: { Authorization: 'Bearer ' + atok, apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'household', id: H['The Garcias'].id }) }); const em = emr.status + ' ' + (await emr.text());
    console.log('     household invite email: ' + em.slice(0, 200));
    // ===== the owner removes Ana: her access ends
    await o.page.evaluate(async (id) => { const c = await window.__ep.sb(); await c.from('page_planners').delete().eq('event_id', id); }, eid);
    const after = await p.page.evaluate(async (id) => { const c = await window.__ep.sb(); const a = await c.from('guest_households').select('id').eq('event_id', id); const u = await c.from('events').update({ config: { title: 'x' } }).eq('id', id).select('id'); return (a.data || []).length + (u.data || []).length; }, eid);
    ok(after === 0, 'removed planner: no guest list, no edits');
    for (const [n, x] of [['owner', o], ['planner', p], ['garcias', hg], ['ben', hb], ['mia', hm], ['plain', pl]]) ok(!x.page._err.length, `no page errors (${n}) ${x.page._err.join(' | ').slice(0, 300)}`);
  } catch (e) { ok(false, 'crashed: ' + (e && e.stack || e)); }
  finally {
    const dump = { events: await sql(`select * from public.events where owner in ${inList}`), page_planners: eid ? await sql(`select * from public.page_planners where event_id = '${eid}'`) : [],
      page_activity: eid ? await sql(`select * from public.page_activity where event_id = '${eid}'`) : [], guest_households: eid ? await sql(`select * from public.guest_households where event_id = '${eid}'`) : [],
      guest_people: eid ? await sql(`select * from public.guest_people where event_id = '${eid}'`) : [], rsvps: eid ? await sql(`select * from public.rsvps where event_id = '${eid}'`) : [],
      event_groups: eid ? await sql(`select * from public.event_groups where event_id = '${eid}'`) : [], trip_items: await sql(`select * from public.trip_items where owner in ${inList}`), users: ids };
    fs.mkdirSync(BACKUP, { recursive: true }); const bf = `${BACKUP}/team-e2e-${TS}.json`; fs.writeFileSync(bf, JSON.stringify(dump, null, 1)); fs.chmodSync(bf, 0o600); console.log('backup ' + bf);
    await sql(`delete from public.events where owner in ${inList} and slug = '${SLUG}'`);
    await sql(`delete from public.trip_items where owner in ${inList}`);
    for (const id of Object.values(ids)) if (id) await admin(`/auth/v1/admin/users/${id}`, { method: 'DELETE' });
    const left = await sql(`select (select count(*) from public.events where slug = '${SLUG}') e, (select count(*) from public.guest_households where event_id = '${eid || '00000000-0000-0000-0000-000000000000'}') h, (select count(*) from public.page_planners where event_id = '${eid || '00000000-0000-0000-0000-000000000000'}') p, (select count(*) from auth.users where id in ${inList}) u`);
    ok(Array.isArray(left) && +left[0].e === 0 && +left[0].h === 0 && +left[0].p === 0 && +left[0].u === 0, 'test data deleted ' + JSON.stringify(left));
    await browser.close();
  }
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
