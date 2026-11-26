// Tests for the invitation emails in ai/notify.ts (kinds invite / invite_test / invite_status / drain) with an in-memory
// stand-in for the Supabase admin client, a captured Resend batch call and a fake clock.
//   NOTIFY_TEST=1 deno test --allow-env tests/invites.test.ts
import { handler, SendError, inviteMail, personalLink, greetingOf, manyOf, allowance, nextUtcDay, type Mail } from "../ai/notify.ts";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const OWN = "00000000-0000-0000-0000-0000000000a1", PLN = "00000000-0000-0000-0000-0000000000a2", STR = "00000000-0000-0000-0000-0000000000a3";
const E = "00000000-0000-0000-0000-0000000000e1", E2 = "00000000-0000-0000-0000-0000000000e2";
const INV = "00000000-0000-0000-0000-0000000000d1", STD = "00000000-0000-0000-0000-0000000000d2";
const hid = (i: number) => "00000000-0000-0000-0000-0000000" + String(10000 + i).padStart(5, "0");
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

function fakeDb(nHouse = 3) {
  const t: Record<string, Row[]> = {
    events: [{ id: E, slug: "ana-ben-x1", owner: OWN, published: true, config: { title: "Ana & Ben", lang: "en", langs: ["es", "ja"], start: "2027-06-12", tr: { es: { title: { h: 1, t: "Ana y Ben" } } } } },
      { id: E2, slug: "other", owner: STR, published: true, config: { title: "Other" } }],
    page_names: [{ name: "ana-ben", event_id: E, is_current: true }, { name: "old-name", event_id: E, is_current: false }],
    page_planners: [{ id: "p1", event_id: E, email: "pat@x.com", user_id: PLN, accepted_at: "y" }],
    invitations: [{ id: INV, event_id: E, kind: "invitation", images: { en: { path: `${E}/inv-en-aaaaaa.jpg`, w: 1200, h: 1680 }, es: { path: `${E}/inv-es-aaaaaa.jpg`, w: 1200, h: 1680 } } },
      { id: STD, event_id: E, kind: "save_the_date", images: {} }],
    guest_households: [], guest_people: [], invite_sends: [], email_log: [], email_usage: [],
  };
  for (let i = 0; i < nHouse; i++) {
    t.guest_households.push({ id: hid(i), event_id: E, name: `House ${i}`, email: i === 1 ? null : `h${i}@x.com`, lang: i === 2 ? "es" : "", token: String(i).repeat(24).slice(0, 24).replace(/\d/g, "a"), greeting: "household" });
  }
  t.guest_households.push({ id: hid(999), event_id: E2, name: "Not this page", email: "other@x.com", lang: "", token: "f".repeat(24), greeting: "household" });
  const users: Record<string, Row> = { [OWN]: { id: OWN, email: "olly@x.com", email_confirmed_at: "x", user_metadata: { full_name: "Olly Owner" } }, [PLN]: { id: PLN, email: "pat@x.com", email_confirmed_at: "x" }, [STR]: { id: STR, email: "s@x.com", email_confirmed_at: "x" } };
  let seq = 0;
  const from = (name: string) => {
    const fs: ((r: Row) => boolean)[] = []; let patch: Row | null = null; let ins: Row[] | null = null; let ups: Row | null = null; let lim = 1e9; let ord: [string, boolean] | null = null;
    const q = {
      select: () => q, order: (k: string, o?: { ascending?: boolean }) => { ord = [k, o?.ascending !== false]; return q; },
      update: (p: Row) => { patch = p; return q; }, insert: (rs: Row | Row[]) => { ins = Array.isArray(rs) ? rs : [rs]; return q; }, upsert: (r: Row) => { ups = r; return q; },
      eq: (k: string, v: unknown) => { fs.push((r) => r[k] === v); return q; },
      is: (k: string, v: unknown) => { fs.push((r) => (r[k] ?? null) === v); return q; },
      not: (k: string) => { fs.push((r) => r[k] != null); return q; },
      gte: (k: string, v: string) => { fs.push((r) => String(r[k]) >= v); return q; },
      lte: (k: string, v: string) => { fs.push((r) => String(r[k]) <= v); return q; },
      in: (k: string, vs: unknown[]) => { fs.push((r) => vs.includes(r[k])); return q; },
      limit: (n: number) => { lim = n; return q; },
      rows: () => { let rs = t[name].filter((r) => fs.every((f) => f(r))); if (ord) { const [k, asc] = ord; rs = [...rs].sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : 1) * (asc ? 1 : -1)); } return rs.slice(0, lim); },
      maybeSingle: () => Promise.resolve({ data: q.rows()[0] || null, error: null }),
      then: (res: (v: unknown) => void) => {
        if (ins) { const add = ins.map((r) => ({ id: r.id || "s" + (++seq), queued_at: new Date(Date.parse("2026-11-25T12:00:00Z") + seq).toISOString(), at: r.at || new Date(clock.now).toISOString(), ...r })); t[name].push(...add); return res({ data: add, error: null }); }
        if (ups) { const i = t[name].findIndex((r) => r.id === ups!.id); if (i >= 0) t[name][i] = { ...t[name][i], ...ups }; else t[name].push(ups); return res({ data: [ups], error: null }); }
        const rs = q.rows(); if (patch) rs.forEach((r) => Object.assign(r, patch)); res({ data: rs, error: null });
      },
    };
    return q;
  };
  const admin = { from, auth: { getUser: (tok: string) => Promise.resolve({ data: { user: users[tok] || null } }), admin: { getUserById: (id: string) => Promise.resolve({ data: { user: users[id] || null } }) } } };
  return { t, admin };
}
const clock = { now: Date.parse("2026-11-25T12:00:00Z") };
const call = (tok: string | null, body: unknown, deps: unknown) =>
  handler(new Request("https://x/functions/v1/notify", { method: "POST", headers: tok === "SERVICE" ? { Authorization: "Bearer anon-jwt", "x-cron-secret": "CRON" } : tok ? { Authorization: "Bearer " + tok } : {}, body: JSON.stringify(body) }), deps as never).then(async (r) => ({ status: r.status, j: await r.json() }));
function mkDeps(db: ReturnType<typeof fakeDb>, opts: { caps?: Row; fail?: (n: number) => SendError | null } = {}) {
  const sent: Mail[] = []; const calls: { n: number; key?: string; at: number }[] = []; const slept: number[] = []; let k = 0;
  const deps = { admin: db.admin, ready: true, now: () => clock.now, caps: opts.caps || { daily: 100, monthly: 3000, reserve: 10 },
    send: (m: Mail[]) => { sent.push(...m); return Promise.resolve(); },
    sendBatch: (m: Mail[], key?: string) => { const e = opts.fail ? opts.fail(++k) : (++k, null); calls.push({ n: m.length, key, at: clock.now }); if (e) return Promise.reject(e);
      sent.push(...m); db.t.email_log.push({ at: new Date(clock.now).toISOString(), n: m.length }); return Promise.resolve(m.map((_, i) => `re_${k}_${i}`)); },
    sleep: (ms: number) => { slept.push(ms); clock.now += ms; return Promise.resolve(); },
    isServer: (req: Request) => req.headers.get("x-cron-secret") === "CRON" };
  return { deps, sent, calls, slept };
}

Deno.test("pure parts: personal link, greeting, mail text per language", () => {
  assert(personalLink("ana-ben-x1", "ana-ben", "a".repeat(24), "") === "https://1linktrip.com/ana-ben?g=" + "a".repeat(24), "named page → /<name>?g=");
  assert(personalLink("ana-ben-x1", null, "a".repeat(24), "es") === "https://1linktrip.com/?e=ana-ben-x1&g=" + "a".repeat(24) + "&lang=es", "no name → ?e=&g=&lang=");
  const ppl = [{ household_id: "h", name: "Michael Smith", age: "adult", added_by: "host" }, { household_id: "h", name: "Sarah Smith", age: "adult", added_by: "host" }, { household_id: "h", name: "Kid", age: "child", added_by: "host" }, { household_id: "h", name: "Plus One", age: "adult", added_by: "guest" }];
  assert(greetingOf({ id: "h", name: "The Smiths", greeting: "names" }, ppl, "en") === "Michael and Sarah", "first names of listed adults");
  assert(greetingOf({ id: "h", name: "The Smiths", greeting: "names" }, ppl, "es") === "Michael y Sarah", "joined in Spanish");
  assert(greetingOf({ id: "h", name: "The Smiths", greeting: "household" }, ppl, "en") === "The Smiths", "household name");
  const m = inviteMail({ to: "a@x.com", kind: "invitation", lang: "es", title: "Ana y Ben", cfg: { start: "2027-06-12" }, greet: "Michael y Sarah", link: "https://1linktrip.com/ana-ben?g=x", img: "https://s/x.jpg", w: 1200, h: 1680 });
  assert(m.subject === "Invitación: Ana y Ben" && /Hola, Michael y Sarah:/.test(m.text) && /Nos encantaría contar con ustedes/.test(m.text) && /Abrir su invitación/.test(m.text) && !/Querido|invitad[oa]/.test(m.text) && /12 de junio de 2027/.test(m.text) && /Abrir su invitación: https:\/\/1linktrip.com\/ana-ben\?g=x/.test(m.text), "Spanish invitation: " + m.subject + " | " + m.text);
  assert(/<img src="https:\/\/s\/x.jpg" width="520" height="728"/.test(m.html) && /lang="es"/.test(m.html), "picture at email width, aspect kept");
  const x = inviteMail({ to: "a@x.com", kind: "save_the_date", lang: "en", title: "<b>A & B</b>", cfg: {}, greet: "Ann", link: "https://1linktrip.com/x?g=1", img: null, test: true });
  assert(x.subject === "[Test] Save the date: <b>A & B</b>" && !/<b>A/.test(x.html) && /&lt;b&gt;A &amp; B/.test(x.html) && !/<img/.test(x.html), "save the date, test prefix, escaped, no picture");
  const j = inviteMail({ to: "a@x.com", kind: "invitation", lang: "ja", title: "結婚式", cfg: { start: "2027-06-12" }, greet: "山田", link: "l", img: null });
  assert(j.subject === "ご招待：結婚式" && /山田 様/.test(j.text) && /2027年6月12日/.test(j.text), "Japanese: " + j.text);
});

Deno.test("number + gender: one person → neutral singular, two or more → plural, in all 7 languages", () => {
  const mk = (lang: string, many: boolean, kind = "invitation") => inviteMail({ to: "a@x.com", kind, lang, title: "T", cfg: { start: "2027-06-12" }, greet: many ? "Ana y Luis" : "Ana", link: "L", img: null, many });
  // what each form must (and must not) say: singular "you" vs plural "you"; nothing gendered (o/a, (a), /r, Chère/cher, Cari, invitado/a, convidado)
  const GENDERED = /\bQuerid|o\/a\b|\(a\)|\/r\b|Chère|\bcher\b|\bCari\b|\binvitad[oa]s?\b|\bconvidad[oa]s?\b|\binvitat[oi]\b|\binvités?\b|\bLiebe/;
  const want: Record<string, [RegExp, RegExp, RegExp, RegExp]> = { // [one must, one must not, many must, many must not]
    es: [/Hola, Ana:[\s\S]*Te invitamos[\s\S]*Abrir tu invitación/, /ustedes|\bsu\b|pueden/, /Hola, Ana y Luis:[\s\S]*contar con ustedes[\s\S]*pueden responder por todo su hogar/, /\btu\b|puedes|Te invitamos/],
    fr: [/Bonjour Ana,[\s\S]*vous inviter/, /foyer/, /Bonjour Ana y Luis,[\s\S]*pour tout votre foyer/, /vous est personnel/],
    pt: [/Olá, Ana,[\s\S]*convidar você[\s\S]*Abrir seu convite/, /vocês/, /convidar vocês[\s\S]*todos da casa/, /você(?!s)|\bseu\b|\bsua\b/],
    de: [/Hallo Ana,[\s\S]*laden dich[\s\S]*deiner Seite/, /\beuch\b|\beure?r?\b|\bihr\b/, /laden euch[\s\S]*ganzen Haushalt/, /\bdich\b|\bdu\b|\bdeine?r?\b/],
    it: [/Ciao Ana,[\s\S]*invitarti[\s\S]*tua pagina/, /\bvi\b|vostr|invitarvi|trovate/, /invitarvi[\s\S]*vostra pagina[\s\S]*tutta la famiglia/, /invitarti|\btua\b|\btuo\b|trovi\b/],
    ja: [/Ana 様[\s\S]*ご返信いただけます/, /ご家族/, /ご家族全員分/, /ご本人専用/],
    en: [/Dear Ana,[\s\S]*reply there\./, /household/, /everyone in your household/, /personal to you\./],
  };
  for (const [l, [om, on, mm, mn]] of Object.entries(want)) {
    for (const kind of ["invitation", "save_the_date"]) {
      const one = mk(l, false, kind), many = mk(l, true, kind); const o = one.subject + "\n" + one.text, m = many.subject + "\n" + many.text;
      assert(!GENDERED.test(o) && !GENDERED.test(m), `${l} ${kind}: no gendered forms\n${o}\n${m}`);
      if (kind === "invitation") { assert(om.test(o) && !on.test(o), `${l} one person:\n${o}`); assert(mm.test(m) && !mn.test(m), `${l} two people:\n${m}`); }
    }
  }
  assert(mk("es", false, "save_the_date").subject === "Reserva la fecha: T" && mk("es", true, "save_the_date").subject === "Reserven la fecha: T", "es save the date: tú vs ustedes");
  assert(mk("it", false, "save_the_date").subject === "Segna la data: T" && mk("it", true, "save_the_date").subject === "Segnate la data: T", "it save the date: tu vs voi");
  // who counts: the people the organizer listed in the household (none listed yet → plural, e.g. "The Kims")
  const p = (n: number) => Array.from({ length: n }, (_, i) => ({ household_id: "h", name: "P" + i, age: "adult", added_by: "host" }));
  assert(!manyOf({ id: "h" }, p(1)) && manyOf({ id: "h" }, p(2)) && manyOf({ id: "h" }, []) && !manyOf({ id: "h" }, [...p(1), { household_id: "h", name: "x", added_by: "guest" }, { household_id: "z", name: "y", added_by: "host" }]), "manyOf counts the household's host-listed people");
});

Deno.test("only the page's organizers can send; a stranger and other pages' households are refused", async () => {
  const db = fakeDb(); const { deps, sent } = mkDeps(db);
  assert((await call(null, { kind: "invite", id: INV, households: [hid(0)] }, deps)).status === 401, "signed out → 401");
  assert((await call(STR, { kind: "invite", id: INV, households: [hid(0)] }, deps)).status === 403, "stranger → 403");
  assert((await call(STR, { kind: "invite_status", id: E }, deps)).status === 403, "stranger cannot read the allowance of the page");
  assert((await call(STR, { kind: "drain", id: E }, deps)).status === 403, "stranger cannot drain the page");
  assert((await call(OWN, { kind: "invite", id: STD, households: [hid(0)] }, deps)).status === 400, "a design without a picture cannot be sent");
  const r = await call(PLN, { kind: "invite", id: INV, households: [hid(999)] }, deps);
  assert(r.j.queued === 0 && sent.length === 0, "another page's household is ignored: " + JSON.stringify(r.j));
  assert((await call("SERVICE", { kind: "invite", id: INV, households: [hid(0)] }, deps)).status === 400, "the cron secret only drains");
  const wrong = await handler(new Request("https://x/", { method: "POST", headers: { Authorization: "Bearer anon-jwt", "x-cron-secret": "nope" }, body: JSON.stringify({ kind: "drain" }) }), deps as never);
  assert(wrong.status === 401, "a wrong cron secret is just an unsigned call → 401");
});

Deno.test("send: personalized per household, language, link; no email → skipped; dedupe and again", async () => {
  const db = fakeDb(4); db.t.guest_households[3].greeting = "names";
  db.t.guest_people = [{ household_id: hid(3), name: "Michael Smith", age: "adult", added_by: "host" }, { household_id: hid(3), name: "Sarah Smith", age: "adult", added_by: "host" }];
  const { deps, sent, calls } = mkDeps(db);
  let r = await call(PLN, { kind: "invite", id: INV, households: [hid(0), hid(1), hid(2), hid(3)] }, deps);
  assert(r.status === 200 && r.j.queued === 3 && r.j.sent === 3 && r.j.noEmail === 1 && calls.length === 1, "3 emailed in one batch call, 1 without email: " + JSON.stringify(r.j));
  const es = sent.find((m) => m.to === "h2@x.com")!; const en = sent.find((m) => m.to === "h0@x.com")!; const nm = sent.find((m) => m.to === "h3@x.com")!;
  assert(es.subject === "Invitación: Ana y Ben" && /ana-ben\?g=a{24}&lang=es/.test(es.text) && /inv-es-aaaaaa\.jpg/.test(es.html), "Spanish household: Spanish text, title, picture and link: " + es.text);
  assert(en.subject === "You’re invited: Ana & Ben" && /Dear House 0,/.test(en.text) && /https:\/\/1linktrip.com\/ana-ben\?g=a{24}\n/.test(en.text) && /inv-en-aaaaaa\.jpg/.test(en.html), "English household: " + en.text);
  assert(/Dear Michael and Sarah,/.test(nm.text), "first-name greeting");
  assert(en.from === '"Ana & Ben via 1LinkTrip" <onboarding@resend.dev>', "sender shows the page: " + en.from);
  assert(!sent.some((m) => /olly@x\.com/.test(m.text + m.html)), "the organizer's email is never in a guest email");
  const rows = db.t.invite_sends; assert(rows.length === 3 && rows.every((x) => x.status === "sent" && /^re_1_/.test(x.resend_id) && x.sent_at), "3 rows sent with their Resend ids");
  // a second tap sends nothing
  r = await call(OWN, { kind: "invite", id: INV, households: [hid(0), hid(2), hid(3)] }, deps);
  assert(r.j.queued === 0 && r.j.already === 3 && sent.length === 3, "already sent → skipped: " + JSON.stringify(r.j));
  // again (after the organizer confirmed "Send again to 1 already sent?")
  r = await call(OWN, { kind: "invite", id: INV, households: [hid(0)], again: true }, deps);
  assert(r.j.queued === 1 && r.j.sent === 1 && sent.length === 4 && db.t.invite_sends.length === 4, "again → one more email, one more row");
});

Deno.test("allowance: never more than today's emails; the rest is queued for tomorrow; drain sends them then", async () => {
  const db = fakeDb(30); const { deps, sent } = mkDeps(db, { caps: { daily: 30, monthly: 3000, reserve: 5 } });
  db.t.email_usage.push({ id: 1, day: "2026-11-25", day_used: 12, month: "2026-11", month_used: 40, observed_at: "2026-11-25T08:00:00.000Z" });
  db.t.email_log.push({ at: "2026-11-25T07:00:00.000Z", n: 50 }, { at: "2026-11-25T09:00:00.000Z", n: 3 }); // before the reading (already in it) / after it
  const al = await allowance(deps as never, clock.now);
  assert(al.dayUsed === 15 && al.dayLeft === 10 && al.left === 10, "Resend's count at the reading + what we sent since; reserve kept: " + JSON.stringify(al));
  let s = await call(OWN, { kind: "invite_status", id: E }, deps); assert(s.j.left === 10 && s.j.dailyCap === 30 && s.j.queued === 0, "status shows what's left: " + JSON.stringify(s.j));
  const all = db.t.guest_households.filter((h) => h.event_id === E && h.email).map((h) => h.id); // 29 with email
  const r = await call(OWN, { kind: "invite", id: INV, households: all }, deps);
  assert(r.j.queued === 29 && r.j.sent === 10 && r.j.deferred === 19 && r.j.waiting === 19 && sent.length === 10, "10 now, 19 wait: " + JSON.stringify(r.j));
  const tomorrow = new Date(nextUtcDay(clock.now)).toISOString(); assert(r.j.next_at === tomorrow && tomorrow === "2026-11-26T00:10:00.000Z", "next send 00:10 UTC tomorrow: " + r.j.next_at);
  assert(db.t.invite_sends.filter((x) => x.status === "queued").every((x) => x.not_before === tomorrow), "queued rows wait for tomorrow");
  // a drain today sends nothing more
  let d = await call("SERVICE", { kind: "drain" }, deps); assert(d.j.sent === 0 && sent.length === 10, "cron today: nothing due: " + JSON.stringify(d.j));
  s = await call(OWN, { kind: "invite_status", id: E }, deps); assert(s.j.left === 0 && s.j.queued === 19 && s.j.next_at === tomorrow, "status: 0 left, 19 queued for tomorrow");
  d = await call(OWN, { kind: "drain", id: E }, deps); assert(d.j.sent === 0 && sent.length === 10, "Send the rest now with no allowance left: nothing");
  // tomorrow: the allowance is back (new UTC day) → the cron sends up to it
  clock.now = Date.parse("2026-11-26T00:15:00Z");
  d = await call("SERVICE", { kind: "drain" }, deps);
  assert(d.j.sent === 19 && sent.length === 29 && d.j.left === 6, "tomorrow the queue goes out: " + JSON.stringify(d.j));
  assert(new Set(sent.map((m) => m.to)).size === 29, "nobody got two emails");
  clock.now = Date.parse("2026-11-25T12:00:00Z");
});

Deno.test("monthly allowance and the server's own Resend counts limit too", async () => {
  const db = fakeDb(5); const { deps } = mkDeps(db, { caps: { daily: 100, monthly: 3000, reserve: 10 } });
  db.t.email_usage.push({ id: 1, day: "2026-11-25", day_used: 4, month: "2026-11", month_used: 2988, observed_at: "2026-11-25T11:00:00.000Z" });
  const r = await call(OWN, { kind: "invite", id: INV, households: db.t.guest_households.filter((h) => h.event_id === E).map((h) => h.id) }, deps);
  assert(r.j.sent === 2 && r.j.deferred === 2, "3000 − 10 reserve − 2988 = 2 this month: " + JSON.stringify(r.j));
});

Deno.test("429: rate limit waits and retries; a quota 429 puts everything back for tomorrow; other errors fail", async () => {
  // rate limited twice, then fine
  let db = fakeDb(3); let m = mkDeps(db, { fail: (n) => n <= 2 ? new SendError("Resend 429: rate_limit_exceeded", 429, 1, false) : null });
  let r = await call(OWN, { kind: "invite", id: INV, households: [hid(0), hid(2)] }, m.deps);
  assert(r.j.sent === 2 && m.calls.length === 3 && m.slept.filter((x) => x >= 1000).length === 2 && m.calls.every((c) => c.key === m.calls[0].key), "two waits, third try sent, same idempotency key: " + JSON.stringify(r.j));
  // quota exhausted at Resend (sign-in emails used it up): back in the queue for tomorrow, nothing lost, nothing failed
  db = fakeDb(3); m = mkDeps(db, { fail: () => new SendError("Resend 429: daily_quota_exceeded", 429, 1, true) });
  r = await call(OWN, { kind: "invite", id: INV, households: [hid(0), hid(2)] }, m.deps);
  assert(r.j.sent === 0 && r.j.deferred === 2 && r.j.next_at === "2026-11-26T00:10:00.000Z" && db.t.invite_sends.every((x) => x.status === "queued" && x.not_before === r.j.next_at), "quota 429 → queued for tomorrow: " + JSON.stringify(r.j));
  // rate limited every time: back in the queue a minute later
  db = fakeDb(3); m = mkDeps(db, { fail: () => new SendError("Resend 429", 429, 2, false) }); const t0 = clock.now;
  r = await call(OWN, { kind: "invite", id: INV, households: [hid(0)] }, m.deps);
  assert(r.j.sent === 0 && r.j.deferred === 1 && db.t.invite_sends[0].status === "queued" && Date.parse(db.t.invite_sends[0].not_before) > t0 && m.calls.length === 4, "still limited → queued a minute later: " + JSON.stringify(r.j));
  clock.now = Date.parse("2026-11-25T12:00:00Z");
  // a hard error marks the rows failed (shown to the organizer), never retried silently
  db = fakeDb(3); m = mkDeps(db, { fail: () => new SendError("Resend 422: invalid from", 422) });
  r = await call(OWN, { kind: "invite", id: INV, households: [hid(0)] }, m.deps);
  assert(r.j.failed === 1 && db.t.invite_sends[0].status === "failed" && /422/.test(db.t.invite_sends[0].error), "422 → failed with the reason");
});

Deno.test("claims: a row being sent is never sent twice; stuck rows fail instead of resending", async () => {
  const db = fakeDb(3); const { deps, sent } = mkDeps(db);
  db.t.invite_sends.push({ id: "q1", event_id: E, household_id: hid(0), invitation_id: INV, kind: "invitation", channel: "email", status: "sending", to_email: "h0@x.com", lang: "", not_before: "2026-11-25T11:00:00.000Z", queued_at: "2026-11-25T11:00:00.000Z" },
    { id: "q2", event_id: E, household_id: hid(2), invitation_id: INV, kind: "invitation", channel: "email", status: "sending", to_email: "h2@x.com", lang: "es", not_before: "2026-11-25T11:59:00.000Z", queued_at: "2026-11-25T11:59:00.000Z" });
  const r = await call(OWN, { kind: "drain", id: E }, deps);
  assert(r.j.sent === 0 && sent.length === 0, "rows another run is sending are left alone");
  assert(db.t.invite_sends[0].status === "failed" && db.t.invite_sends[1].status === "sending", "a row stuck > 15 min is failed (not resent); a fresh one is left");
  const r2 = await call(OWN, { kind: "invite", id: INV, households: [hid(2)] }, deps);
  assert(r2.j.queued === 0 && r2.j.pending === 1, "a household already in the queue is not queued twice: " + JSON.stringify(r2.j));
});

Deno.test("test email goes to the organizer only, personalized like the household chosen", async () => {
  const db = fakeDb(3); const { deps, sent } = mkDeps(db);
  let r = await call(PLN, { kind: "invite_test", id: INV, household: hid(2) }, deps);
  assert(r.j.sent === 1 && r.j.to === "pat@x.com" && sent[0].to === "pat@x.com" && sent[0].subject === "[Test] Invitación: Ana y Ben" && /lang=es/.test(sent[0].text), "test to the planner, as the Spanish household: " + sent[0].subject);
  assert(db.t.invite_sends.length === 0, "a test is not a send");
  r = await call(OWN, { kind: "invite_test", id: INV, lang: "en" }, deps);
  assert(sent[1].to === "olly@x.com" && /Dear Olly,/.test(sent[1].text) && /https:\/\/1linktrip.com\/ana-ben\n/.test(sent[1].text), "no household: greets the organizer, plain page link: " + sent[1].text);
  r = await call(OWN, { kind: "invite_test", id: INV, household: hid(999) }, deps);
  assert(!/f{24}/.test(sent[2].text), "another page's household is not used");
  const db2 = fakeDb(1); const m2 = mkDeps(db2, { caps: { daily: 10, monthly: 3000, reserve: 10 } });
  r = await call(OWN, { kind: "invite_test", id: INV }, m2.deps); assert(r.status === 429 && m2.sent.length === 0, "no allowance → no test email");
});

Deno.test("a hidden page sends nothing", async () => {
  const db = fakeDb(2); db.t.events[0].published = false; const { deps, sent } = mkDeps(db);
  const r = await call(OWN, { kind: "invite", id: INV, households: [hid(0)] }, deps); assert(r.j.skipped === "page not shared" && sent.length === 0, "not shared → nothing");
});

// ---------- the delivery webhook (ai/invite-hook.ts) ----------
import { handler as hook, signSvix } from "../ai/invite-hook.ts";
Deno.test("delivery webhook: signed events mark the send; unsigned / stale are refused; a bounce is not undone", async () => {
  const rows: Row[] = [{ id: "r1", resend_id: "re_a", status: "sent" }, { id: "r2", resend_id: "re_b", status: "sent" }];
  const admin = { from: () => { let patch: Row = {}; const fs: ((r: Row) => boolean)[] = []; const q = { update: (p: Row) => { patch = p; return q; }, eq: (k: string, v: unknown) => { fs.push((r) => r[k] === v); return q; }, in: (k: string, vs: unknown[]) => { fs.push((r) => vs.includes(r[k])); return q; },
    then: (res: (v: unknown) => void) => { rows.filter((r) => fs.every((f) => f(r))).forEach((r) => Object.assign(r, patch)); res({ error: null }); } }; return q; } };
  const secret = "whsec_" + btoa("0123456789abcdef0123456789abcdef"); const now = Date.parse("2026-11-25T12:00:00Z");
  const send = async (ev: Row, opts: { sig?: string; ts?: number } = {}) => { const body = JSON.stringify(ev); const ts = String(Math.floor((opts.ts ?? now) / 1000));
    const sig = opts.sig ?? "v1," + await signSvix(secret, "msg_1", ts, body);
    return (await hook(new Request("https://x/", { method: "POST", headers: { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": sig }, body }), { admin, secret, now: () => now })).status; };
  assert(await send({ type: "email.delivered", data: { email_id: "re_a" } }, { sig: "v1,AAAA" }) === 401 && rows[0].status === "sent", "bad signature → 401, untouched");
  assert(await send({ type: "email.delivered", data: { email_id: "re_a" } }, { ts: now - 3600e3 }) === 401, "an old timestamp → 401");
  assert(await send({ type: "email.delivered", created_at: "2026-11-25T12:00:01Z", data: { email_id: "re_a" } }) === 200 && rows[0].status === "delivered" && rows[0].delivered_at, "delivered");
  assert(await send({ type: "email.bounced", data: { email_id: "re_b", bounce: { message: "Mailbox does not exist" } } }) === 200 && rows[1].status === "bounced" && rows[1].error === "Mailbox does not exist", "bounced with the reason");
  await send({ type: "email.delivered", data: { email_id: "re_b" } }); assert(rows[1].status === "bounced", "a late delivered does not hide the bounce");
  assert(await send({ type: "email.opened", data: { email_id: "re_a" } }) === 200 && rows[0].status === "delivered", "other events are ignored");
});

Deno.test("Send the rest now: an organizer sends waiting rows early when the allowance allows; the cron only sends due ones", async () => {
  const db = fakeDb(3); const { deps, sent } = mkDeps(db);
  db.t.invite_sends.push({ id: "w1", event_id: E, household_id: hid(0), invitation_id: INV, kind: "invitation", channel: "email", status: "queued", to_email: "h0@x.com", lang: "", not_before: "2026-11-26T00:10:00.000Z", queued_at: "2026-11-25T11:00:00.000Z" });
  let r = await call("SERVICE", { kind: "drain" }, deps); assert(r.j.sent === 0 && sent.length === 0, "cron: not due yet");
  assert((await call(STR, { kind: "drain", id: E }, deps)).status === 403, "a stranger cannot");
  r = await call(PLN, { kind: "drain", id: E }, deps); assert(r.j.sent === 1 && sent.length === 1 && db.t.invite_sends[0].status === "sent" && r.j.queued === 0, "planner: sent now: " + JSON.stringify(r.j));
});
