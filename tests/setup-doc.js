// New page setup, step 0: "Start from a document" next to "Start from a website". A PDF/photo (itinerary, invitation,
// confirmation) goes through the same reader as Upload a document (ai-import mode "doc") and becomes the page: type,
// title, dates, route/venue, schedule, notes, sections, must-bring; then the builder, like Start from a website. A picked
// category is sent along and wins. Signed out → inline sign-in (the file is chosen again after). Errors say why.
// Also: setup's last step Share goes through the builder's Share (short link), not a long link.
//
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/setup-doc.js
const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const SHOTS = process.env.SHOTS || '';
const fails = []; const ok = (c, m) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) fails.push(m); };
const DOC = {
  title: 'Japan in spring', type: 'Trip', tagline: '', host: 'Sam', description: 'Ten days from Tokyo to Osaka.', start_date: '2027-04-01', start_time: '', end_date: '2027-04-10', end_time: '',
  venue_name: '', venue_address: '', rsvp_url: '', rsvp_by: '', dress_code: '', hotel_blocks: [], faqs: [{ question: 'Money', answer: 'Carry some cash; many small places are cash only.' }], links: [], details: {}, extras: [],
  stops: [{ city: 'Tokyo', country: 'Japan', arrive: '2027-04-01', leave: '2027-04-05' }, { city: 'Kyoto', country: 'Japan', arrive: '2027-04-05', leave: '2027-04-08' }, { city: 'Osaka', country: 'Japan', arrive: '2027-04-08', leave: '2027-04-10' }],
  schedule: [{ date: '2027-04-01', time: '15:00', title: 'Check in: Park Hotel Tokyo', note: 'Conf. PH-4417', kind: 'reservation' }, { date: '2027-04-02', time: '09:00', title: 'Tsukiji outer market', note: '', kind: 'activity' },
    { date: '2027-04-05', time: '10:03', title: 'Shinkansen Nozomi 215 to Kyoto', note: 'Car 7, seats 4A-4B', kind: 'reservation' }],
  sections: [{ title: 'Emergency contacts', text: 'Police 110\nAmbulance 119' }], bring: 'Passport\nJR Pass voucher', access: { dropoff: '', entrance: '', parking: '', restrooms: '', notes: '' },
};
const INVITE = { ...DOC, title: 'Ana & Leo', type: 'Party', host: '', description: 'Join us.', start_date: '2027-09-18', end_date: '', start_time: '16:00', venue_name: 'Hacienda Uayamon', venue_address: 'Campeche, Mexico', stops: [], schedule: [], sections: [], bring: '', faqs: [] };
const CITY = { 'tokyo, japan': [35.6764, 139.65], 'kyoto, japan': [35.0116, 135.7681], 'osaka, japan': [34.6937, 135.5023] };

function fakeSupabase(user) {
  window.supabase = { createClient: () => ({ storage: { from: () => ({}) }, from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
    auth: { getSession: async () => ({ data: { session: user ? { user, access_token: 'a.b.c' } : null } }), signInWithOtp: async () => ({ error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } }) };
}
(async () => {
  const browser = await chromium.launch();
  const USER = { id: 'u0000000-0000-4000-8000-0000000000bb', email: 'host@example.com' };
  const mk = async ({ user = USER, answer = () => DOC, status = 200 } = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage(); page._err = []; page.on('pageerror', e => page._err.push(String(e))); page._ai = [];
    await page.addInitScript(fakeSupabase, user);
    await page.route(/open-meteo|overpass|nominatim|googleapis\.com\/(?!css)|tile\.openstreetmap|timeapi|photon/, r => r.abort());
    await page.route('**/functions/v1/ai-import', async (r) => {
      if (r.request().method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ready: true, modes: ['url', 'text', 'edit', 'translate', 'file', 'doc'] }) });
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 200, body: 'ok' });
      const body = JSON.parse(r.request().postData() || '{}'); page._ai.push({ ...body, files: (body.files || []).map(f => ({ media_type: f.media_type, n: (f.data || '').length })) });
      if (status !== 200) return r.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Couldn\'t read the file (529)' }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, kind: 'event', data: answer(body) }) });
    });
    await page.route(/supabase\.co\/rest\//, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await page.goto(BASE); await page.waitForFunction(() => window.__ep);
    await page.evaluate(([city, signed]) => { localStorage.clear(); if (signed) localStorage.setItem('ep:signedIn', 'true');
      for (const [q, [lat, lon]] of Object.entries(city)) localStorage.setItem('ep:sgeo:' + q, JSON.stringify({ name: q.split(',')[0].replace(/^./, c => c.toUpperCase()), address: q, lat, lon, city: q.split(',')[0], region: '', country: 'Japan', cc: 'jp' })); }, [CITY, !!user]);
    return { ctx, page };
  };
  const pdf = (name = 'japan-itinerary.pdf') => ({ name, mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(3000, 32)]) });
  const draft = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('ep:draft')));

  // ---- 1. signed in, no category: a trip itinerary fills the page ----
  {
    const { ctx, page } = await mk();
    await page.goto(BASE + '#setup'); await page.waitForSelector('[data-su-ai]:not([hidden])');
    ok(/Start from a website/.test(await page.textContent('[data-su-ai]')) && /Start from a document/.test(await page.textContent('[data-su-ai]')), 'step 0: Start from a website / Start from a document');
    await page.click('[data-su="doc-open"]'); await page.waitForSelector('.su-doc-form:not([hidden])');
    ok(await page.$eval('.su-ai-form', e => e.hidden && !e.offsetHeight) && await page.$eval('.su-doc-form', e => !!e.offsetHeight), 'one form open at a time (the website form is really hidden)');
    if (SHOTS) await page.screenshot({ path: SHOTS + '/setup-doc-390.png' });
    await page.setInputFiles('#su-doc-file', pdf());
    await page.waitForSelector('.b-form', { timeout: 20000 });
    const c = await draft(page);
    ok(page._ai.length === 1 && page._ai[0].mode === 'doc' && page._ai[0].files.length === 1 && page._ai[0].files[0].media_type === 'application/pdf' && !page._ai[0].type, 'sent once as mode doc with the PDF (no category)');
    ok(c.type === 'Trip' && c.title === 'Japan in spring', 'type + title: ' + c.type + ' / ' + c.title);
    ok(c.start === '2027-04-01' && c.end === '2027-04-10', 'dates ' + c.start + '–' + c.end);
    ok((c.stops || []).map(s => s.name).join() === 'Tokyo,Kyoto,Osaka' && c.stops[0].lat != null, 'route Tokyo → Kyoto → Osaka, pinned');
    ok(c.venue && c.venue.name === 'Tokyo', 'venue from the first stop');
    ok(c.schedule.length === 3 && c.schedule.some(x => /Shinkansen/.test(x.title) && x.date === '2027-04-05'), 'schedule filled');
    ok(c.notes.some(n => n.label === 'Money'), 'notes filled');
    ok(c.custom.some(x => x.title === 'Emergency contacts'), 'custom section filled');
    ok(/Passport/.test(c.bring) && c.host === 'Sam', 'must-bring + host');
    ok(/Filled in from japan-itinerary\.pdf/.test(await page.textContent('.b-form')), 'builder: Filled in from japan-itinerary.pdf');
    ok(/#page=/.test(page.url()), 'on the page in the builder');
    ok(!page._err.length, 'no page errors ' + page._err.join(' | '));
    await ctx.close();
  }
  // ---- 2. a picked category is sent and wins ----
  {
    const { ctx, page } = await mk({ answer: () => INVITE });
    await page.goto(BASE + '#setup'); await page.waitForSelector('[data-su-ai]:not([hidden])');
    await page.click('[data-su-type="Wedding"]'); await page.click('[data-su="doc-open"]');
    ok(/Category: Wedding/.test(await page.textContent('.su-doc-form')), 'doc form shows the category');
    await page.setInputFiles('#su-doc-file', { name: 'invite.jpg', mimeType: 'image/png', buffer: require('fs').readFileSync(__dirname + '/../icon-192.png') });
    await page.waitForSelector('.b-form', { timeout: 20000 }); const c = await draft(page);
    ok(page._ai[0].type === 'Wedding' && page._ai[0].files[0].media_type === 'image/jpeg', 'category + shrunk photo sent');
    ok(c.type === 'Wedding' && c.title === 'Ana & Leo' && c.start === '2027-09-18T16:00', 'Wedding page, title, date+time ' + JSON.stringify([c.type, c.title, c.start]));
    ok(!page._err.length, 'no page errors ' + page._err.join(' | '));
    await ctx.close();
  }
  // ---- 3. signed out: inline sign-in, nothing sent ----
  {
    const { ctx, page } = await mk({ user: null });
    await page.goto(BASE + '#setup'); await page.waitForSelector('[data-su-ai]:not([hidden])');
    await page.click('[data-su="doc-open"]'); await page.setInputFiles('#su-doc-file', pdf());
    await page.waitForSelector('[data-su-doc-signin] .signin');
    ok(/Sign in first/.test(await page.textContent('[data-su-doc-msg]')) && !page._ai.length, 'signed out: Sign in first (inline), nothing sent');
    ok(await page.evaluate(() => localStorage.getItem('ep:pendingAiDoc')) !== null, 'remembers to reopen the document form after sign-in');
    await page.goto(BASE + '#mine'); await page.goto(BASE + '#setup'); await page.waitForSelector('.su-doc-form:not([hidden])');
    ok(/Choose your document again/.test(await page.textContent('[data-su-doc-msg]')), 'back from sign-in: the form is open, choose the file again');
    ok(!page._err.length, 'no page errors ' + page._err.join(' | '));
    await ctx.close();
  }
  // ---- 4. a failed read says why ----
  {
    const { ctx, page } = await mk({ status: 502 });
    await page.goto(BASE + '#setup'); await page.waitForSelector('[data-su-ai]:not([hidden])');
    await page.click('[data-su="doc-open"]'); await page.setInputFiles('#su-doc-file', pdf());
    await page.waitForFunction(() => /529/.test(document.querySelector('[data-su-doc-msg]').textContent));
    ok(/Couldn’t read that file/.test(await page.textContent('#toast')), 'toast: ' + await page.textContent('#toast'));
    ok(!(await page.$('.b-form')) && !(await page.$eval('[data-su-doc-drop]', e => e.classList.contains('busy'))), 'stays on setup, can try again');
    await page.setInputFiles('#su-doc-file', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
    ok(/Use a PDF or a photo/.test(await page.textContent('[data-su-doc-msg]')), 'other file types: Use a PDF or a photo');
    await ctx.close();
  }
  // ---- 5. setup's last step: Share → the builder's short-link Share ----
  {
    const { ctx, page } = await mk({ user: null });
    await page.goto(BASE + '#setup'); await page.waitForSelector('.su-type');
    await page.click('[data-su-type="Race"]'); await page.click('[data-su="next0"]');
    await page.fill('#su-title', 'Mia turns 7'); await page.dispatchEvent('#su-title', 'input');
    const sd = await page.$('#su-sd'); if (sd) { await sd.fill('2027-03-06'); await sd.dispatchEvent('input'); await sd.dispatchEvent('change'); }
    await page.click('[data-su="next"]'); await page.click('[data-su="skip"]'); await page.waitForSelector('[data-su="share"]');
    ok(!(await page.$('.su-link')), 'no long link handed out on the last step');
    await page.click('[data-su="share"]'); await page.waitForSelector('#pub[open] .signin', { timeout: 15000 });
    ok(/Sign in to get a link you can update later/.test(await page.textContent('#pub')), 'Share → builder share sheet (sign in for an updatable link)');
    ok(!page._err.length, 'no page errors ' + page._err.join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `\n${fails.length} failed` : '\nall passed'); process.exit(fails.length ? 1 : 0);
})();
