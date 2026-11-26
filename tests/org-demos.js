// Organizer demos (Dylan 11/25: "examples of the business facing side with all the details we've added"):
// ?demo=wedding|conference|race&view=organizer opens the real organizer screens on sample data, no account.
//  - each demo is filled in: guest list + dashboard, dietary, groups, seating, invitations (picture + send history),
//    arrivals, shuttles, fields, replies & messages, the page with its planners and "Edited by"
//  - it is a sandbox: clicking through and changing things (groups, seats, fields, an invitation email, a test email,
//    an update, a co-planner invite, a page edit) makes ZERO requests to Supabase (REST, notify, storage, AI) and writes
//    nothing to localStorage; the stand-in's notify answered instead
//  - #examples lists the three organizer demos next to their guest pages; ?demo=wedding alone is still the guest page
// 390 and 1280 px, offline (third-party data APIs aborted).
//
//   node tests/_pages-server.js 18765 &  node tests/org-demos.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const overflow = (page) => page.evaluate(() => { const cw = document.documentElement.clientWidth; return [...document.querySelectorAll('body *')].filter(e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false; const r = e.getBoundingClientRect(); return r.width && r.right > cw + 1; }).map(e => e.className).slice(0, 3); });
(async () => {
  const browser = await chromium.launch();
  const open = async (w) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: w < 500 ? 844 : 900 }, deviceScaleFactor: w < 500 ? 2 : 1, isMobile: w < 500, hasTouch: w < 500, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const net = { sb: [], notify: 0 }; const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('request', r => { const u = r.url(); if (/supabase\.(co|in)\b/.test(u)) net.sb.push(r.method() + ' ' + u.replace(/\?.*/, '')); if (/\/functions\/v1\/notify/.test(u)) net.notify++; });
    await page.route(/open-meteo|overpass|nominatim|tile\.openstreetmap|photon|timeapi|maps\.mail\.ru/, r => r.abort());
    return { ctx, page, net, errors };
  };
  const tab = async (page, k) => { await page.click(`[data-gl-tab="${k}"]`); await page.waitForTimeout(350); };
  const count = (page, sel) => page.$$eval(sel, xs => xs.length);

  const mods = async (page, on) => { await page.click('[data-mod-open]'); await page.waitForSelector('dialog[open] [data-mod]');
    for (const k of on) { const c = await page.$(`dialog[open] [data-mod="${k}"]`); if (c && !(await c.isChecked())) { await c.evaluate(x => x.click()); await page.waitForTimeout(250); } }
    await page.click('dialog[open] [data-gl-x]'); await page.waitForTimeout(250); };

  // 11/26: every type opens travel-first (Travel, its people, its own tab, Updates + the features it has on). The wedding demo
  // has Guest list & RSVP, Dietary, Seating, Invitations and Shuttles on; race and conference are checked in tests/org-types.js.
  for (const [k, title, min] of [['wedding', 'Maya & Theo', { hs: 25, ppl: 40, tables: 8, runs: 4, fields: 3 }], ['conference', 'Signal & Noise 2027', { runs: 4 }], ['race', 'Lakefront 10K', { runs: 4 }]]) {
    for (const w of [390, 1280]) {
      const { ctx, page, net, errors } = await open(w);
      await page.goto(`${BASE}?demo=${k}&view=organizer`); await page.waitForSelector('[data-gl-tab]', { timeout: 30000 }); await page.waitForTimeout(500);
      const L = `${k} ${w}:`;
      ok(/#guests\/[\w-]+$/.test(page.url()) && (await page.textContent('#org-bar')).includes(title), `${L} opens the organizer screen under the Demo bar`);
      ok(await page.$eval('[data-gl-tab="trav"]', b => b.classList.contains('on')), `${L} opens on Travel`);
      await tab(page, 'trav'); ok((await count(page, '.ar-tag')) >= 5, `${L} travel: arrivals board`);
      await tab(page, 'shut'); ok((await page.textContent('.gl')).match(/\d+ runs · \d+ riders/) && !(await page.textContent('.gl')).includes(' 0 riders'), `${L} shuttle runs with riders`);
      if (k === 'wedding') {
        await tab(page, 'list'); await page.waitForSelector('.gl-h');
        const sum = await page.$$eval('[data-gl-sum] div', ds => Object.fromEntries(ds.map(d => [d.querySelector('small').textContent, d.querySelector('b').textContent])));
        ok(+sum.Invites >= min.hs && +sum.Guests >= min.ppl && /^\d+\/\d+$/.test(sum.Opened) && +sum.Coming > 10, `${L} dashboard filled in (${JSON.stringify(sum)})`);
        ok((await count(page, '.gl-trail li.on')) > 20 && (await count(page, '.gl-trail li.off')) > 0, `${L} households at different steps (sent / opened / replied / hotel)`);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/${k}-${w}-guests.png` });
        await tab(page, 'diet'); ok((await count(page, '.gl-tiles div')) >= 4, `${L} dietary tiles`);
        await tab(page, 'seat'); ok((await count(page, '[data-drop]')) >= min.tables, `${L} seating: tables arranged`);
        await tab(page, 'inv'); await page.waitForTimeout(300);
        ok(await page.$eval('.iv-card img', i => i.complete && i.naturalWidth > 100).catch(() => false), `${L} invitations: the designed picture shows`);
        ok(/Sent|Delivered|Bounced|Queued/.test(await page.textContent('.iv-send')), `${L} invitations: send history`);
        await mods(page, ['groups', 'fld']);
        await tab(page, 'groups'); ok((await count(page, '.gl-groups li')) >= 5, `${L} groups (turned on in Add features) with counts`);
        await tab(page, 'fld'); ok((await count(page, '[data-fd-edit]')) >= min.fields && (await count(page, '[data-fd-cell]')) > 20, `${L} fields (turned on in Add features)`);
      }
      ok((await overflow(page)).length === 0, `${L} no sideways overflow`);
      if (w === 1280 && k === 'wedding') {
        // change things everywhere: all of it stays here
        await tab(page, 'groups'); await page.fill('#gl-gnew', 'Neighbors'); await page.click('[data-gl-gadd]'); await page.waitForTimeout(300);
        ok((await page.$$eval('[data-gl-gname]', xs => xs.map(x => x.value))).includes('Neighbors'), 'sandbox: a new group shows');
        await tab(page, 'fld'); const sel = await page.$('select[data-fd-cell]');
        if (sel) { const v = await sel.evaluate(s => [...s.options].map(o => o.value).filter(Boolean).pop()); await sel.selectOption(v); await page.waitForTimeout(300); }
        await tab(page, 'inv'); await page.click('[data-iv-test]'); await page.waitForTimeout(400);
        ok(/Test sent to lucia@/.test(await page.textContent('#toast')), 'sandbox: Send test to me answered by the stand-in');
        await page.click('[data-iv-send]'); await page.waitForTimeout(400); const dlg = await page.$('dialog[open] [data-c="skip"]'); if (dlg) await dlg.click(); await page.waitForTimeout(600);
        ok(/Emailed/.test(await page.textContent('#toast')), 'sandbox: Email households "sends" (marked sent here only)');
        ok(await page.evaluate(() => window.__orgDemo.notified.includes('invite')), 'sandbox: the invite went to the stand-in');
        await tab(page, 'seat'); await page.click('[data-st-view="cards"]').catch(() => {}); await page.waitForTimeout(300);
        await page.goto(page.url().replace(/#.*/, '') + '#mine/' + await page.evaluate(() => window.__orgDemo.eid)); await page.waitForSelector('#an-body', { timeout: 30000 });
        await page.fill('#an-body', 'Bring sunscreen for the ceremony.'); await page.click('[data-an="post"]'); await page.waitForTimeout(800);
        ok((await page.textContent('.ann-list')).includes('Bring sunscreen'), 'sandbox: an update posts');
        ok((await page.textContent('#mine-msgs')).includes('Grace Kim'), 'messages: guest threads');
        await page.click('.org-nav a[href^="#page="]'); await page.waitForSelector('.builder', { timeout: 30000 }); await page.waitForTimeout(1500);
        ok((await count(page, '.ed-by')) >= 2, 'page: "Edited by" a co-planner');
        await page.click('.b-top [data-act="settings"]'); await page.waitForTimeout(500);
        await page.evaluate(() => { const d = document.querySelector('details[data-acc="team"]'); if (d) d.open = true; }); await page.waitForTimeout(300);
        ok(/Maya Ortiz[\s\S]*Theo Lindqvist[\s\S]*Sofía Ferrer/.test(await page.textContent('details[data-acc="team"]')), 'page: planners (owner, two joined, one invited)');
        await page.fill('#team-email', 'ana@example.com'); await page.click('[data-team-invite]'); await page.waitForTimeout(800);
        ok((await page.textContent('details[data-acc="team"]')).includes('ana@example.com'), 'sandbox: a co-planner invite shows');
        ok(await page.evaluate(() => window.__orgDemo.notified.includes('planner')), 'sandbox: the planner email went to the stand-in');
        await page.evaluate(() => { const B = window.__ep.lists.B(); B.cfg.tagline = 'Edited in the demo'; }); await page.waitForTimeout(200);
        await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); await page.waitForTimeout(2600);
      }
      ok(net.sb.length === 0, `${L} zero requests to Supabase${net.sb.length ? ' — ' + net.sb.slice(0, 3).join(' | ') : ''}`);
      ok(net.notify === 0, `${L} zero notify calls`);
      ok(await page.evaluate(() => Object.keys(localStorage).filter(x => x.startsWith('ep:')).length === 0), `${L} nothing written to localStorage`);
      ok(!errors.length, `${L} no page errors${errors.length ? ' — ' + errors.slice(0, 2).join(' | ') : ''}`);
      await ctx.close();
    }
  }
  // #examples: the organizer demos, each with its guest page next to it; the guest example itself is unchanged
  {
    const { ctx, page } = await open(390);
    await page.goto(BASE + '#examples'); await page.waitForSelector('#for-planners');
    const links = await page.$$eval('#for-planners .ex-acts a', as => as.map(a => a.getAttribute('href')));
    ok(['wedding', 'conference', 'race'].every(k => links.includes(`?demo=${k}&view=organizer`) && links.includes(`?demo=${k}`)), `#examples: organizer + guest links for all three (${links.join(' ')})`);
    ok((await overflow(page)).length === 0, '#examples: no overflow at 390');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/examples-390.png`, fullPage: true });
    await page.goto(BASE + '?demo=wedding'); await page.waitForSelector('#sec-schedule', { timeout: 30000 });
    ok(!(await page.$('#org-bar')), '?demo=wedding (no view=organizer) is still the guest page');
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok'); process.exit(fails.length ? 1 : 0);
})();
