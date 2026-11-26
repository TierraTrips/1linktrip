// 1LinkTrip "notify" Supabase Edge Function: emails new guest messages, host replies and host updates through Resend.
// In-app delivery (My trip, My pages) always works without this; email is the extra.
//
// Deploy: Supabase Dashboard → Edge Functions → Deploy a new function → Via editor → name it notify → paste this file → Deploy.
//         Keep "Verify JWT" on (the default): only signed-in people can call it, and it checks they may notify for that row.
// Secrets: RESEND_API_KEY (a Resend key with Sending access).
//          NOTIFY_FROM (optional), e.g. "1LinkTrip <hello@yourdomain.com>" once your domain is verified in Resend.
//          Until then the sender is onboarding@resend.dev, which Resend only delivers to the Resend account's own email.
//          SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided to Edge Functions automatically.
//
// POST { "kind": "message", "id": "<event_messages.id>" }   guest wrote → email the page owner; host replied → email that guest
// POST { "kind": "announcement", "id": "<announcements.id>" } owner / planner posted → email the chosen groups (or everyone known)
// POST { "kind": "planner", "id": "<page_planners.id>" }     owner invited a co-planner → email the invite link
// POST { "kind": "household", "id": "<guest_households.id>" } owner / planner → email that household its personal link,
//                                                            in the household's language
// POST { "kind": "invite", "id": "<invitations.id>", "households": [ids], "again": false }  owner / planner → email each
//                                                            household the invitation picture + its personal link, in its
//                                                            language. Already sent (or queued) households are skipped unless
//                                                            "again". Sends what today's email allowance allows now; the rest
//                                                            is queued and goes out automatically on the next day (cron
//                                                            "drain"), or with { "kind": "drain", "id": "<event id>" }.
// POST { "kind": "invite_test", "id": "<invitations.id>", "household": "<id>"?, "lang": "es"? } → the same email, to the
//                                                            signed-in organizer's own (confirmed) address
// POST { "kind": "invite_status", "id": "<event id>" }        → today's / this month's emails left, queued, next send time
// POST { "kind": "drain" } + header x-cron-secret               → sends queued invitations that are due (pg_cron, see
//                                                            supabase/schema-invites-cron.sql; secret NOTIFY_CRON_SECRET)
// GET  → { ok, ready } (ready = RESEND_API_KEY is set)
// Secrets (optional): NOTIFY_DAILY_CAP (100), NOTIFY_MONTHLY_CAP (3000) = the Resend plan's allowance;
//          NOTIFY_RESERVE (10) = emails a day kept back for sign-in links, planner invites and messages.
//          Never more than the allowance is sent: the server reads Resend's x-resend-daily-quota / -monthly-quota
//          headers after every send and logs its own sends (email_usage / email_log, schema-invites.sql).
// Each row is emailed at most once (notified_at). The host's own email address is never sent to guests.

import { createClient } from "npm:@supabase/supabase-js@2.119.0";

// The site's addresses. A browser call from one of these gets its own Origin echoed back; anything else gets the first.
const ALLOWED_ORIGINS = ["https://1linktrip.com", "https://www.1linktrip.com", "https://bbbot0209.github.io"];
const SITE = "https://1linktrip.com/";
const MAX_RECIPIENTS = 300;
const THREAD_QUIET_MS = 10 * 60 * 1000; // one email per thread per 10 minutes
const RESEND_MS = 10 * 60 * 1000; // an invite can be emailed again after 10 minutes

// household invitation email, per language (the household's own language when the page has it)
// one = a household of one person (neutral "you"), many = two or more (plural "you"): no gendered forms ("Querido/a", "invitado")
type InvT = { s: string; hi: string; body: string; btn: string };
export const INVITE: Record<string, { one: InvT; many: InvT }> = {
  en: { one: { s: "Invitation: {t}", hi: "Hi {n},", body: "You're invited to {t}. Your page has the details, and you can reply there.", btn: "Open your invitation" },
    many: { s: "Invitation: {t}", hi: "Hi {n},", body: "You're invited to {t}. Your page has the details, and you can reply for everyone in your household there.", btn: "Open your invitation" } },
  es: { one: { s: "Invitación: {t}", hi: "Hola, {n}:", body: "Te invitamos a {t}. En tu página están todos los detalles y puedes responder allí.", btn: "Abrir tu invitación" },
    many: { s: "Invitación: {t}", hi: "Hola, {n}:", body: "Nos encantaría contar con ustedes en {t}. En su página están todos los detalles y pueden responder por todo su hogar.", btn: "Abrir su invitación" } },
  fr: { one: { s: "Invitation : {t}", hi: "Bonjour {n},", body: "Nous avons le plaisir de vous inviter à {t}. Votre page contient tous les détails, et vous pouvez y répondre.", btn: "Ouvrir votre invitation" },
    many: { s: "Invitation : {t}", hi: "Bonjour {n},", body: "Nous avons le plaisir de vous inviter à {t}. Votre page contient tous les détails, et vous pouvez y répondre pour tout votre foyer.", btn: "Ouvrir votre invitation" } },
  pt: { one: { s: "Convite: {t}", hi: "Olá, {n},", body: "Temos o prazer de convidar você para {t}. Sua página tem todos os detalhes, e você pode responder por lá.", btn: "Abrir seu convite" },
    many: { s: "Convite: {t}", hi: "Olá, {n},", body: "Temos o prazer de convidar vocês para {t}. A página de vocês tem todos os detalhes, e vocês podem responder por todos da casa.", btn: "Abrir o convite" } },
  de: { one: { s: "Einladung: {t}", hi: "Hallo {n},", body: "Wir laden dich herzlich zu {t} ein. Auf deiner Seite stehen alle Details, und du kannst dort antworten.", btn: "Einladung öffnen" },
    many: { s: "Einladung: {t}", hi: "Hallo {n},", body: "Wir laden euch herzlich zu {t} ein. Auf eurer Seite stehen alle Details, und ihr könnt dort für euren ganzen Haushalt antworten.", btn: "Einladung öffnen" } },
  it: { one: { s: "Invito: {t}", hi: "Ciao {n},", body: "Abbiamo il piacere di invitarti a {t}. Nella tua pagina trovi tutti i dettagli e puoi rispondere lì.", btn: "Apri l'invito" },
    many: { s: "Invito: {t}", hi: "Ciao {n},", body: "Abbiamo il piacere di invitarvi a {t}. Nella vostra pagina trovate tutti i dettagli e potete rispondere per tutta la famiglia.", btn: "Apri l'invito" } },
  ja: { one: { s: "ご招待：{t}", hi: "{n} 様", body: "{t} にご招待します。ページに詳細があり、そちらからご返信いただけます。", btn: "招待状を開く" },
    many: { s: "ご招待：{t}", hi: "{n} 様", body: "{t} にご招待します。ページに詳細があり、ご家族全員分の出欠をまとめて返信できます。", btn: "招待状を開く" } },
};
const AND: Record<string, string> = { en: "and", es: "y", fr: "et", pt: "e", de: "und", it: "e", ja: "と" };
export const joinNames = (xs: string[], lang: string) => { const a = AND[lang] || AND.en; if (lang === "ja") return xs.join("、").replace(/、([^、]*)$/, a + "$1");
  return xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " " + a + " " + xs[xs.length - 1]; };
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w)\}/g, (_, k) => v[k] ?? "");

export function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export type Mail = { to: string; subject: string; text: string; html: string; from?: string };
// deno-lint-ignore no-explicit-any
type Admin = any;
// sendBatch: one Resend batch call (≤100 emails) → the Resend id of each email, in order. Throws SendError on failure.
export type Deps = { admin: Admin; send: (mails: Mail[]) => Promise<void>; ready: boolean; now?: () => number;
  sendBatch?: (mails: Mail[], key?: string) => Promise<string[]>; sleep?: (ms: number) => Promise<void>; caps?: Partial<Caps>; isServer?: (req: Request) => boolean };
export type Caps = { daily: number; monthly: number; reserve: number };
export class SendError extends Error { status: number; retryAfter: number; quota: boolean;
  constructor(m: string, status: number, retryAfter = 1, quota = false) { super(m); this.status = status; this.retryAfter = retryAfter; this.quota = quota; } }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function mail(to: string, subject: string, lines: string[], link: string, linkLabel: string): Mail {
  const text = `${lines.join("\n\n")}\n\n${linkLabel}: ${link}\n`;
  const html = `<div style="font:16px/1.5 -apple-system,system-ui,sans-serif;color:#111;max-width:560px">${lines.map((l) => `<p style="white-space:pre-wrap;margin:0 0 14px">${esc(l)}</p>`).join("")}<p><a href="${esc(link)}" style="display:inline-block;background:#3048F0;color:#fff;text-decoration:none;padding:10px 16px;border-radius:10px">${esc(linkLabel)}</a></p><p style="color:#777;font-size:13px">1LinkTrip</p></div>`;
  return { to, subject, text, html };
}

async function userEmail(admin: Admin, id: string): Promise<string> {
  const { data } = await admin.auth.admin.getUserById(id);
  const u = data && data.user;
  return u && u.email && u.email_confirmed_at ? String(u.email).toLowerCase() : "";
}

// claim the row so a repeat call (or a double tap) never sends twice
async function claim(admin: Admin, table: string, id: string): Promise<boolean> {
  const { data, error } = await admin.from(table).update({ notified_at: new Date().toISOString() }).eq("id", id).is("notified_at", null).select("id");
  return !error && Array.isArray(data) && data.length === 1;
}
// invites: once, or again after RESEND_MS (guarded on the value read, so two taps send one)
async function claimAgain(admin: Admin, table: string, id: string, was: string | null, now: number): Promise<boolean> {
  if (was && now - Date.parse(was) < RESEND_MS) return false;
  let q = admin.from(table).update({ notified_at: new Date(now).toISOString() }).eq("id", id);
  q = was ? q.eq("notified_at", was) : q.is("notified_at", null);
  const { data, error } = await q.select("id");
  return !error && Array.isArray(data) && data.length === 1;
}
// a failed send gives the claim back, so the invite can be tried again
async function unclaim(admin: Admin, table: string, id: string, was: string | null) {
  try { await admin.from(table).update({ notified_at: was }).eq("id", id); } catch { /* the 10-minute wait still applies */ }
}
// the page's owner, or an accepted planner (signed in with the invited, confirmed email)
async function plans(admin: Admin, ev: { id: string; owner: string }, me: { id: string; email?: string; email_confirmed_at?: string }): Promise<boolean> {
  if (ev.owner === me.id) return true;
  if (!me.email || !me.email_confirmed_at) return false;
  const { data } = await admin.from("page_planners").select("id").eq("event_id", ev.id).eq("user_id", me.id).eq("email", String(me.email).toLowerCase()).not("accepted_at", "is", null).limit(1);
  return Array.isArray(data) && data.length > 0;
}

// Every answer carries the CORS headers for this request's Origin.
export async function handler(req: Request, deps?: Deps): Promise<Response> {
  const res = await route(req, deps);
  for (const [k, v] of Object.entries(corsFor(req))) res.headers.set(k, v);
  return res;
}

async function route(req: Request, deps?: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok");
  const d = deps || defaultDeps();
  if (req.method === "GET") return json(200, { ok: true, ready: d.ready });
  if (req.method !== "POST") return json(405, { ok: false, error: "Use POST" });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  // deno-lint-ignore no-explicit-any
  let b: any;
  // the scheduled drain (pg_cron + pg_net) carries the cron secret (x-cron-secret = NOTIFY_CRON_SECRET, kept in Vault)
  if (d.isServer && d.isServer(req)) {
    try { b = await req.json(); } catch { return json(400, { ok: false, error: "Send JSON" }); }
    if (b.kind !== "drain") return json(400, { ok: false, error: "Unknown request" });
    if (!d.ready) return json(200, { ok: true, sent: 0, skipped: "email not set up" });
    return json(200, { ok: true, ...(await drain(d, d.now ? d.now() : Date.now(), null)) });
  }
  const { data: who } = token ? await d.admin.auth.getUser(token) : { data: null };
  const me = who && who.user;
  if (!me) return json(401, { ok: false, error: "Sign in first" });

  try { b = await req.json(); } catch { return json(400, { ok: false, error: "Send JSON" }); }
  const id = String(b.id || "");
  if (!UUID.test(id) || !["message", "announcement", "planner", "household", "invite", "invite_test", "invite_status", "drain"].includes(String(b.kind))) return json(400, { ok: false, error: "Unknown request" });
  if (!d.ready) return json(200, { ok: true, sent: 0, skipped: "email not set up" });
  const now = d.now ? d.now() : Date.now();
  if (String(b.kind).startsWith("invite") || b.kind === "drain") return invites(d, me, b, now);

  if (b.kind === "message") {
    const { data: m } = await d.admin.from("event_messages").select("id,event_id,guest,from_host,guest_name,guest_email,body,notified_at,created_at").eq("id", id).maybeSingle();
    if (!m) return json(404, { ok: false, error: "Not found" });
    const { data: ev } = await d.admin.from("events").select("id,slug,owner,config").eq("id", m.event_id).maybeSingle();
    if (!ev) return json(404, { ok: false, error: "Not found" });
    // only the person who wrote it can ask for its email (a host reply: the owner or a planner)
    if (m.from_host ? !(await plans(d.admin, ev, me)) : m.guest !== me.id) return json(403, { ok: false, error: "Not yours" });
    if (m.notified_at) return json(200, { ok: true, sent: 0, skipped: "already sent" });
    const title = String((ev.config && ev.config.title) || "your page").slice(0, 120);
    // a burst of messages in one thread becomes one email
    const { data: recent } = await d.admin.from("event_messages").select("id,notified_at").eq("event_id", m.event_id).eq("guest", m.guest).eq("from_host", m.from_host)
      .not("notified_at", "is", null).gte("notified_at", new Date(now - THREAD_QUIET_MS).toISOString()).limit(1);
    if (!(await claim(d.admin, "event_messages", id))) return json(200, { ok: true, sent: 0, skipped: "already sent" });
    if (recent && recent.length) return json(200, { ok: true, sent: 0, skipped: "recently emailed" });
    let out: Mail;
    if (m.from_host) {
      const to = await userEmail(d.admin, m.guest); if (!to) return json(200, { ok: true, sent: 0, skipped: "no guest email" });
      out = mail(to, `New message from the host: ${title}`, [`The host of ${title} wrote:`, String(m.body)], `${SITE}?e=${ev.slug}#t=mytrip`, "Open your messages");
    } else {
      const to = await userEmail(d.admin, ev.owner); if (!to) return json(200, { ok: true, sent: 0, skipped: "no host email" });
      const from = [m.guest_name, m.guest_email].filter(Boolean).join(" · ") || "A guest";
      out = mail(to, `New message: ${title}`, [`${from} wrote:`, String(m.body)], `${SITE}#mine/${ev.id}`, "Reply in My pages");
    }
    try { await d.send([out]); } catch (e) { return json(502, { ok: false, error: String((e as Error).message || e).slice(0, 200) }); }
    return json(200, { ok: true, sent: 1 });
  }

  if (b.kind === "planner") { // the owner's invite to a co-planner
    const { data: p } = await d.admin.from("page_planners").select("id,event_id,email,token,accepted_at,notified_at").eq("id", id).maybeSingle();
    if (!p) return json(404, { ok: false, error: "Not found" });
    const { data: ev } = await d.admin.from("events").select("id,slug,owner,config").eq("id", p.event_id).maybeSingle();
    if (!ev || ev.owner !== me.id) return json(403, { ok: false, error: "Not yours" });
    if (p.accepted_at) return json(200, { ok: true, sent: 0, skipped: "already joined" });
    if (!EMAIL.test(p.email)) return json(200, { ok: true, sent: 0, skipped: "no email" });
    const was = p.notified_at;
    if (!(await claimAgain(d.admin, "page_planners", id, was, now))) return json(200, { ok: true, sent: 0, skipped: "recently emailed" });
    const title = String((ev.config && ev.config.title) || "a page").slice(0, 120);
    const who = String((me.user_metadata && (me.user_metadata.full_name || me.user_metadata.name)) || "").trim().slice(0, 60) || "The organizer";
    const out = mail(p.email, `${who} invited you to plan ${title}`, [`${who} invited you to plan ${title} on 1LinkTrip with them.`, `Sign in with this email address (${p.email}) to edit the page together.`], `${SITE}?e=${ev.slug}&p=${p.token}`, "Open the page");
    try { await d.send([out]); } catch (e) { await unclaim(d.admin, "page_planners", id, was); return json(502, { ok: false, error: String((e as Error).message || e).slice(0, 200) }); }
    return json(200, { ok: true, sent: 1 });
  }

  if (b.kind === "household") { // a household's personal invitation link, in its language
    const { data: h } = await d.admin.from("guest_households").select("id,event_id,name,email,lang,token,notified_at,greeting").eq("id", id).maybeSingle();
    if (!h) return json(404, { ok: false, error: "Not found" });
    const { data: ev } = await d.admin.from("events").select("id,slug,owner,config,published").eq("id", h.event_id).maybeSingle();
    if (!ev || !(await plans(d.admin, ev, me))) return json(403, { ok: false, error: "Not yours" });
    if (!ev.published) return json(200, { ok: true, sent: 0, skipped: "page not shared" });
    if (!h.email || !EMAIL.test(h.email)) return json(200, { ok: true, sent: 0, skipped: "no email" });
    const was = h.notified_at;
    if (!(await claimAgain(d.admin, "guest_households", id, was, now))) return json(200, { ok: true, sent: 0, skipped: "recently emailed" });
    const langs: string[] = [String((ev.config && ev.config.lang) || "en"), ...((ev.config && Array.isArray(ev.config.langs)) ? ev.config.langs : [])];
    const lang = h.lang && langs.includes(h.lang) ? h.lang : "";
    const TT = INVITE[lang || String((ev.config && ev.config.lang) || "en")] || INVITE.en;
    const tr = lang && ev.config && ev.config.tr && ev.config.tr[lang]; // the page's own translated title, when it has one
    const title = String((tr && tr.title && tr.title.t) || (ev.config && ev.config.title) || "").slice(0, 120);
    const { data: ps } = await d.admin.from("guest_people").select("household_id,name,age,added_by").eq("household_id", h.id).eq("added_by", "host").limit(30);
    const n = greetingOf(h, ps || [], lang || String((ev.config && ev.config.lang) || "en")); // "Michael and Sarah" or the household's name
    const T = TT[manyOf(h, ps || []) ? "many" : "one"];
    const v = { t: title, n };
    const out = mail(h.email, fill(T.s, v), [fill(T.hi, v), fill(T.body, v)], `${SITE}?e=${ev.slug}&g=${h.token}${lang ? "&lang=" + lang : ""}`, T.btn);
    try { await d.send([out]); } catch (e) { await unclaim(d.admin, "guest_households", id, was); return json(502, { ok: false, error: String((e as Error).message || e).slice(0, 200) }); }
    return json(200, { ok: true, sent: 1 });
  }

  // announcement: the page owner or a planner, and only once
  const { data: a } = await d.admin.from("announcements").select("id,event_id,body,group_ids,notified_at").eq("id", id).maybeSingle();
  if (!a) return json(404, { ok: false, error: "Not found" });
  const { data: ev } = await d.admin.from("events").select("id,slug,owner,config,published").eq("id", a.event_id).maybeSingle();
  if (!ev || !(await plans(d.admin, ev, me))) return json(403, { ok: false, error: "Not yours" });
  if (a.notified_at) return json(200, { ok: true, sent: 0, skipped: "already sent" });
  const gids: string[] = Array.isArray(a.group_ids) ? a.group_ids : [];
  const emails = new Set<string>();
  let q = d.admin.from("event_group_members").select("email").eq("event_id", ev.id);
  if (gids.length) q = q.in("group_id", gids);
  const { data: mem } = await q.limit(MAX_RECIPIENTS * 2);
  (mem || []).forEach((r: { email: string }) => emails.add(String(r.email).toLowerCase()));
  if (!gids.length) { // everyone: group members plus everyone who left an email with their reply
    const { data: rs } = await d.admin.from("rsvps").select("email,attending").eq("event_id", ev.id).not("email", "is", null).limit(MAX_RECIPIENTS * 2);
    (rs || []).forEach((r: { email: string; attending: boolean }) => { if (r.attending !== false) emails.add(String(r.email).toLowerCase()); });
  }
  const owner = await userEmail(d.admin, ev.owner); if (owner) emails.delete(owner);
  const to = [...emails].filter((e) => EMAIL.test(e)).slice(0, MAX_RECIPIENTS);
  if (!(await claim(d.admin, "announcements", id))) return json(200, { ok: true, sent: 0, skipped: "already sent" });
  if (!to.length) return json(200, { ok: true, sent: 0 });
  const title = String((ev.config && ev.config.title) || "an event").slice(0, 120);
  // one email per person, so nobody sees the other recipients
  const mails = to.map((e) => mail(e, `Update: ${title}`, [`An update about ${title}:`, String(a.body)], `${SITE}?e=${ev.slug}${gids.length ? "#t=mytrip" : ""}`, "Open the page"));
  try { await d.send(mails); } catch (e) { return json(502, { ok: false, error: String((e as Error).message || e).slice(0, 200) }); }
  return json(200, { ok: true, sent: mails.length });
}

// ================= invitations (schema-invites.sql) =================
const INV_BUCKET = "invitations";
// the invitation email, per language: subject / greeting / body / button / footer, for an invitation and a save the date
type InvMailT = { s: string; std: string; hi: string; body: string; stdBody: string; btn: string; stdBtn: string; foot: string };
// one = a household of one (neutral singular "you"), many = two or more (plural "you"); greetings are "Hi"/"Hola"-style so
// nothing is gendered ("Querido/a", "Chère, cher", "Liebe/r", "invitado" are gone)
export const INV_MAIL: Record<string, { one: InvMailT; many: InvMailT }> = {
  en: {
    one: { s: "You’re invited: {t}", std: "Save the date: {t}", hi: "Dear {n},", body: "You’re invited to {t}{d}. Your invitation is below; your page has all the details, and you can reply there.", stdBody: "Please save the date for {t}{d}. A formal invitation will follow; your page already has the details.", btn: "Open your invitation", stdBtn: "Open your page", foot: "Sent for {t} with 1LinkTrip. This link is personal to you." },
    many: { s: "You’re invited: {t}", std: "Save the date: {t}", hi: "Dear {n},", body: "You’re invited to {t}{d}. Your invitation is below; your page has all the details, and you can reply there for everyone in your household.", stdBody: "Please save the date for {t}{d}. A formal invitation will follow; your page already has the details.", btn: "Open your invitation", stdBtn: "Open your page", foot: "Sent for {t} with 1LinkTrip. This link is personal to your household." } },
  es: {
    one: { s: "Invitación: {t}", std: "Reserva la fecha: {t}", hi: "Hola, {n}:", body: "Te invitamos a {t}{d}. Tu invitación está abajo; en tu página están todos los detalles y puedes responder allí.", stdBody: "Reserva la fecha para {t}{d}. La invitación formal llegará más adelante; tu página ya tiene los detalles.", btn: "Abrir tu invitación", stdBtn: "Abrir tu página", foot: "Enviado para {t} con 1LinkTrip. Este enlace es solo para ti." },
    many: { s: "Invitación: {t}", std: "Reserven la fecha: {t}", hi: "Hola, {n}:", body: "Nos encantaría contar con ustedes en {t}{d}. Su invitación está abajo; en su página están todos los detalles y pueden responder por todo su hogar.", stdBody: "Reserven la fecha para {t}{d}. La invitación formal llegará más adelante; su página ya tiene los detalles.", btn: "Abrir su invitación", stdBtn: "Abrir su página", foot: "Enviado para {t} con 1LinkTrip. Este enlace es personal para su hogar." } },
  fr: {
    one: { s: "Invitation : {t}", std: "Réservez la date : {t}", hi: "Bonjour {n},", body: "Nous avons le plaisir de vous inviter à {t}{d}. Votre invitation est ci-dessous ; votre page contient tous les détails et vous pouvez y répondre.", stdBody: "Réservez la date pour {t}{d}. L’invitation officielle suivra ; votre page contient déjà les détails.", btn: "Ouvrir votre invitation", stdBtn: "Ouvrir votre page", foot: "Envoyé pour {t} avec 1LinkTrip. Ce lien vous est personnel." },
    many: { s: "Invitation : {t}", std: "Réservez la date : {t}", hi: "Bonjour {n},", body: "Nous avons le plaisir de vous inviter à {t}{d}. Votre invitation est ci-dessous ; votre page contient tous les détails et vous pouvez y répondre pour tout votre foyer.", stdBody: "Réservez la date pour {t}{d}. L’invitation officielle suivra ; votre page contient déjà les détails.", btn: "Ouvrir votre invitation", stdBtn: "Ouvrir votre page", foot: "Envoyé pour {t} avec 1LinkTrip. Ce lien est personnel à votre foyer." } },
  pt: {
    one: { s: "Convite: {t}", std: "Reserve a data: {t}", hi: "Olá, {n},", body: "Temos o prazer de convidar você para {t}{d}. Seu convite está abaixo; sua página tem todos os detalhes, e você pode responder por lá.", stdBody: "Reserve a data para {t}{d}. O convite oficial virá depois; sua página já tem os detalhes.", btn: "Abrir seu convite", stdBtn: "Abrir sua página", foot: "Enviado para {t} com o 1LinkTrip. Este link é só seu." },
    many: { s: "Convite: {t}", std: "Reservem a data: {t}", hi: "Olá, {n},", body: "Temos o prazer de convidar vocês para {t}{d}. O convite de vocês está abaixo; a página de vocês tem todos os detalhes, e vocês podem responder por todos da casa.", stdBody: "Reservem a data para {t}{d}. O convite oficial virá depois; a página de vocês já tem os detalhes.", btn: "Abrir o convite", stdBtn: "Abrir a página", foot: "Enviado para {t} com o 1LinkTrip. Este link é pessoal para a casa de vocês." } },
  de: {
    one: { s: "Einladung: {t}", std: "Save the Date: {t}", hi: "Hallo {n},", body: "Wir laden dich herzlich zu {t}{d} ein. Deine Einladung siehst du unten; auf deiner Seite stehen alle Details, und du kannst dort antworten.", stdBody: "Bitte merk dir den Termin für {t}{d} vor. Die offizielle Einladung folgt; auf deiner Seite stehen schon die Details.", btn: "Einladung öffnen", stdBtn: "Deine Seite öffnen", foot: "Für {t} mit 1LinkTrip gesendet. Dieser Link gilt nur für dich." },
    many: { s: "Einladung: {t}", std: "Save the Date: {t}", hi: "Hallo {n},", body: "Wir laden euch herzlich zu {t}{d} ein. Eure Einladung seht ihr unten; auf eurer Seite stehen alle Details, und ihr könnt dort für euren ganzen Haushalt antworten.", stdBody: "Bitte merkt euch den Termin für {t}{d} vor. Die offizielle Einladung folgt; auf eurer Seite stehen schon die Details.", btn: "Einladung öffnen", stdBtn: "Eure Seite öffnen", foot: "Für {t} mit 1LinkTrip gesendet. Dieser Link gilt nur für euren Haushalt." } },
  it: {
    one: { s: "Invito: {t}", std: "Segna la data: {t}", hi: "Ciao {n},", body: "Abbiamo il piacere di invitarti a {t}{d}. Il tuo invito è qui sotto; nella tua pagina trovi tutti i dettagli e puoi rispondere lì.", stdBody: "Segna la data di {t}{d}. L’invito ufficiale seguirà; la tua pagina ha già i dettagli.", btn: "Apri l’invito", stdBtn: "Apri la tua pagina", foot: "Inviato per {t} con 1LinkTrip. Questo link è solo per te." },
    many: { s: "Invito: {t}", std: "Segnate la data: {t}", hi: "Ciao {n},", body: "Abbiamo il piacere di invitarvi a {t}{d}. Il vostro invito è qui sotto; nella vostra pagina trovate tutti i dettagli e potete rispondere per tutta la famiglia.", stdBody: "Segnate la data di {t}{d}. L’invito ufficiale seguirà; la vostra pagina ha già i dettagli.", btn: "Apri l’invito", stdBtn: "Apri la vostra pagina", foot: "Inviato per {t} con 1LinkTrip. Questo link è personale per la vostra famiglia." } },
  ja: {
    one: { s: "ご招待：{t}", std: "日程のお知らせ：{t}", hi: "{n} 様", body: "{t}{d}にご招待いたします。招待状は下にございます。ページに詳細があり、そちらからご返信いただけます。", stdBody: "{t}{d}の日程をお知らせします。正式な招待状は後日お送りします。詳細はページでご覧いただけます。", btn: "招待状を開く", stdBtn: "ページを開く", foot: "1LinkTrip から {t} のためにお送りしています。このリンクはご本人専用です。" },
    many: { s: "ご招待：{t}", std: "日程のお知らせ：{t}", hi: "{n} 様", body: "{t}{d}にご招待いたします。招待状は下にございます。ページに詳細があり、ご家族全員分の出欠をまとめて返信できます。", stdBody: "{t}{d}の日程をお知らせします。正式な招待状は後日お送りします。詳細はページでご覧いただけます。", btn: "招待状を開く", stdBtn: "ページを開く", foot: "1LinkTrip から {t} のためにお送りしています。このリンクはご家族専用です。" } },
};
const SEND_PAUSE_MS = 150; // Resend allows 10 requests a second; one batch call per 150 ms stays well under
const BATCH = 100; // Resend batch: up to 100 emails a call
const STUCK_MS = 15 * 60 * 1000;
export const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const nextUtcDay = (ms: number) => { const d = new Date(ms); d.setUTCHours(24, 10, 0, 0); return d.getTime(); }; // 00:10 UTC next day
const envNum = (k: string, dflt: number) => { const v = Number((globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k) ?? ""); return Number.isFinite(v) && v > 0 ? v : dflt; };
export function capsOf(d: Deps): Caps { return { daily: d.caps?.daily ?? envNum("NOTIFY_DAILY_CAP", 100), monthly: d.caps?.monthly ?? envNum("NOTIFY_MONTHLY_CAP", 3000), reserve: d.caps?.reserve ?? envNum("NOTIFY_RESERVE", 10) }; }

// what is left today / this month: Resend's own counts at the last send (headers) + what was sent since, or our own log
export async function allowance(d: Deps, now: number) {
  const c = capsOf(d); const day = utcDay(now), month = day.slice(0, 7);
  const { data: u } = await d.admin.from("email_usage").select("day,day_used,month,month_used,observed_at").eq("id", 1).maybeSingle();
  const dayFrom = u && u.day === day && u.observed_at ? u.observed_at : day + "T00:00:00.000Z";
  const monFrom = u && u.month === month && u.observed_at ? u.observed_at : month + "-01T00:00:00.000Z";
  const from = dayFrom < monFrom ? dayFrom : monFrom;
  const { data: logs } = await d.admin.from("email_log").select("at,n").gte("at", from).limit(20000);
  const ms = (x: unknown) => Date.parse(String(x)) || 0;
  const sum = (since: string) => (logs || []).filter((r: Row) => ms(r.at) >= ms(since)).reduce((n: number, r: Row) => n + (r.n || 0), 0);
  const dayUsed = (u && u.day === day ? u.day_used || 0 : 0) + sum(dayFrom);
  const monthUsed = (u && u.month === month ? u.month_used || 0 : 0) + sum(monFrom);
  const dayLeft = Math.max(0, c.daily - c.reserve - dayUsed), monthLeft = Math.max(0, c.monthly - c.reserve - monthUsed);
  return { dayLeft, monthLeft, left: Math.min(dayLeft, monthLeft), dayUsed, monthUsed, dailyCap: c.daily, monthlyCap: c.monthly, reserve: c.reserve };
}
// the page's link: https://1linktrip.com/<name>?g=<token> (or ?e=<slug>&g=…), + &lang= when the household reads another language
export function personalLink(slug: string, name: string | null, tok: string, lang: string) {
  const base = name ? `${SITE}${name}` : `${SITE}?e=${slug}`;
  return base + (base.includes("?") ? "&" : "?") + "g=" + tok + (lang ? "&lang=" + lang : "");
}
export const publicUrl = (supaUrl: string, path: string) => `${supaUrl.replace(/\/$/, "")}/storage/v1/object/public/${INV_BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`;
// the greeting: the household's name, or the first names of the adults the organizer listed ("Michael and Sarah")
// two or more people (or a household with nobody listed yet, e.g. "The Kims") → the plural forms
export function manyOf(h: Row, people: Row[]): boolean {
  const ps = people.filter((p) => (!p.household_id || p.household_id === h.id) && p.added_by === "host");
  return ps.length !== 1;
}
export function greetingOf(h: Row, people: Row[], lang: string): string {
  let n = String(h.name || "").slice(0, 120);
  if (h.greeting === "names") {
    const fs = people.filter((p) => (!p.household_id || p.household_id === h.id) && p.added_by === "host" && p.age !== "child" && p.age !== "infant").map((p) => String(p.name || "").trim().split(/\s+/)[0]).filter(Boolean);
    if (fs.length) n = joinNames(fs, lang);
  }
  return n;
}
// " · 12 June 2027" style date for the body, in the household's language (the page's start day)
export function dateLine(cfg: Row, lang: string): string {
  const s = String((cfg && cfg.start) || "").slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  try { const f = new Intl.DateTimeFormat(lang || "en", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(s + "T12:00:00Z")); return lang === "ja" ? `（${f}）` : `, ${f}`; } catch { return ""; }
}
export function senderOf(from: string, title: string) { // "Ana & Ben via 1LinkTrip <invites@…>"
  const m = from.match(/<([^<>\s]+@[^<>\s]+)>/); const addr = m ? m[1] : from.trim();
  const nm = String(title || "").replace(/["<>\r\n\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  return nm ? `"${nm} via 1LinkTrip" <${addr}>` : from;
}
// one invitation email
export function inviteMail(o: { to: string; kind: string; lang: string; title: string; cfg: Row; greet: string; link: string; img: string | null; w?: number; h?: number; test?: boolean; many?: boolean }): Mail {
  const T = (INV_MAIL[o.lang] || INV_MAIL.en)[o.many === false ? "one" : "many"]; const std = o.kind === "save_the_date";
  const v = { t: o.title, n: o.greet, d: dateLine(o.cfg, o.lang) };
  const subject = (o.test ? "[Test] " : "") + fill(std ? T.std : T.s, v);
  const hi = fill(T.hi, v), body = fill(std ? T.stdBody : T.body, v), btn = std ? T.stdBtn : T.btn, foot = fill(T.foot, v);
  const text = `${hi}\n\n${body}\n\n${btn}: ${o.link}\n\n${foot}\n`;
  const W = 520; const ih = o.w && o.h ? Math.round(W * o.h / o.w) : 0;
  const img = o.img ? `<tr><td style="padding:0 0 22px"><a href="${esc(o.link)}"><img src="${esc(o.img)}" width="${W}"${ih ? ` height="${ih}"` : ""} alt="${esc(o.title)}" style="display:block;width:100%;max-width:${W}px;height:auto;border:0;border-radius:6px;box-shadow:0 10px 30px -12px rgba(15,74,80,.35)"></a></td></tr>` : "";
  const html = `<!doctype html><html lang="${esc(o.lang || "en")}"><body style="margin:0;padding:0;background:#EDF4F1"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EDF4F1"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="${W}" cellpadding="0" cellspacing="0" style="width:100%;max-width:${W}px;font:16px/1.55 Georgia,'Times New Roman',serif;color:#0F4A50">
<tr><td style="padding:0 2px 16px;font-size:18px">${esc(hi)}</td></tr>
<tr><td style="padding:0 2px 22px">${esc(body)}</td></tr>
${img}
<tr><td align="center" style="padding:0 0 26px"><a href="${esc(o.link)}" style="display:inline-block;background:#0F4A50;color:#ffffff;text-decoration:none;font:600 16px -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;padding:13px 22px;border-radius:10px">${esc(btn)}</a></td></tr>
<tr><td style="padding:14px 2px 0;border-top:1px solid #C5DDD8;font:13px/1.5 -apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#41655F">${esc(foot)}</td></tr>
</table></td></tr></table></body></html>`;
  return { to: o.to, subject, text, html };
}

// the page, its link name, its languages, its designs: what every invitation email of a page needs
async function pageCtx(d: Deps, eid: string) {
  const { data: ev } = await d.admin.from("events").select("id,slug,owner,config,published").eq("id", eid).maybeSingle();
  if (!ev) return null;
  const { data: nm } = await d.admin.from("page_names").select("name").eq("event_id", eid).eq("is_current", true).limit(1);
  const cfg = ev.config || {}; const src = String(cfg.lang || "en");
  const langs = [src, ...(Array.isArray(cfg.langs) ? cfg.langs : [])].map(String);
  return { ev, cfg, src, langs, name: (nm && nm[0] && nm[0].name) || null };
}
const titleIn = (cfg: Row, lang: string) => { const tr = lang && cfg.tr && cfg.tr[lang]; return String((tr && tr.title && tr.title.t) || cfg.title || "").slice(0, 120); };
const pickImage = (inv: Row, lang: string, src: string) => { const im = inv.images || {}; return im[lang] || im[src] || im.en || Object.values(im)[0] || null; };
const SUPA = () => (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get("SUPABASE_URL") || "https://example.supabase.co";

// send queued invitation emails that are due (one page, or all), within the allowance; the rest waits for tomorrow
export async function drain(d: Deps, now: number, eid: string | null, force = false) { // force: "Send the rest now" (one page, waiting rows too)
  const iso = (ms: number) => new Date(ms).toISOString();
  // an email stuck "sending" (the function died mid-call) is not retried — it may have gone out; it shows as failed
  { let q = d.admin.from("invite_sends").update({ status: "failed", error: "Interrupted while sending; check with the guest before sending again." }).eq("status", "sending").lte("queued_at", iso(now - STUCK_MS)); if (eid) q = q.eq("event_id", eid); await q; }
  let q = d.admin.from("invite_sends").select("id,event_id,household_id,invitation_id,kind,to_email,lang,image_path").eq("status", "queued").order("queued_at", { ascending: true }).limit(BATCH * 3);
  if (!(force && eid)) q = q.lte("not_before", iso(now));
  if (eid) q = q.eq("event_id", eid);
  const { data: due } = await q; const rows: Row[] = due || [];
  const al = await allowance(d, now);
  const out = { sent: 0, failed: 0, deferred: 0, left: al.left, next_at: null as string | null };
  if (!rows.length) return out;
  const take = rows.slice(0, al.left); const later = rows.slice(al.left);
  if (later.length) { // over today's allowance: tomorrow (00:10 UTC), automatically
    const at = iso(nextUtcDay(now)); await d.admin.from("invite_sends").update({ not_before: at }).in("id", later.map((r) => r.id)).eq("status", "queued");
    out.deferred = later.length; out.next_at = at;
  }
  if (!take.length) return out;
  // claim: only rows still queued are ours (a cron run and a "Send the rest" tap never send the same row twice)
  const { data: got } = await d.admin.from("invite_sends").update({ status: "sending" }).in("id", take.map((r) => r.id)).eq("status", "queued").select("id");
  const mine = new Set((got || []).map((r: Row) => r.id)); const work = take.filter((r) => mine.has(r.id));
  const ctxs = new Map<string, Row | null>(); const invs = new Map<string, Row | null>(); const hhs = new Map<string, Row>(); const ppl: Row[] = [];
  for (const e of [...new Set(work.map((r) => r.event_id))]) ctxs.set(e, await pageCtx(d, e));
  for (const i of [...new Set(work.map((r) => r.invitation_id).filter(Boolean))]) { const { data } = await d.admin.from("invitations").select("id,kind,images").eq("id", i).maybeSingle(); invs.set(i, data || null); }
  const hids = [...new Set(work.map((r) => r.household_id))];
  for (let i = 0; i < hids.length; i += 200) {
    const { data: hs } = await d.admin.from("guest_households").select("id,event_id,name,email,lang,token,greeting").in("id", hids.slice(i, i + 200)); (hs || []).forEach((h: Row) => hhs.set(h.id, h));
    const { data: ps } = await d.admin.from("guest_people").select("household_id,name,age,added_by").in("household_id", hids.slice(i, i + 200)).limit(5000); ppl.push(...(ps || []));
  }
  const from = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get("NOTIFY_FROM") || "1LinkTrip <onboarding@resend.dev>";
  const ready: { r: Row; m: Mail }[] = [];
  for (const r of work) {
    const c = ctxs.get(r.event_id); const h = hhs.get(r.household_id); const inv = r.invitation_id ? invs.get(r.invitation_id) : null;
    const why = !c || !c.ev.published ? "The page isn’t shared" : !h ? "Household removed" : !h.email || !EMAIL.test(h.email) ? "No email address" : !inv ? "The design was deleted" : "";
    if (why) { await d.admin.from("invite_sends").update({ status: "failed", error: why }).eq("id", r.id); out.failed++; continue; }
    const lang = r.lang && INV_MAIL[r.lang] ? r.lang : (INV_MAIL[c!.src] ? c!.src : "en");
    const img = pickImage(inv!, r.lang, c!.src); const path = r.image_path || (img && img.path) || null;
    const m = inviteMail({ to: h!.email, kind: r.kind, lang, title: titleIn(c!.cfg, r.lang), cfg: c!.cfg, greet: greetingOf(h!, ppl, lang), many: manyOf(h!, ppl), link: personalLink(c!.ev.slug, c!.name, h!.token, r.lang && r.lang !== c!.src ? r.lang : ""),
      img: path ? publicUrl(SUPA(), path) : null, w: img && img.w, h: img && img.h });
    m.from = senderOf(from, titleIn(c!.cfg, c!.src)); m.to = h!.email;
    ready.push({ r, m });
  }
  const sendBatch = d.sendBatch || (async (ms: Mail[]) => { await d.send(ms); return ms.map(() => ""); });
  const sleep = d.sleep || ((ms: number) => new Promise((res) => setTimeout(res, ms)));
  const backTo = async (rs: Row[], at: number, err: string | null) => { await d.admin.from("invite_sends").update({ status: "queued", not_before: iso(at), error: err }).in("id", rs.map((x) => x.id)).eq("status", "sending"); };
  for (let i = 0; i < ready.length; i += BATCH) {
    const part = ready.slice(i, i + BATCH); let ids: string[] | null = null; let stop = false;
    for (let tries = 0; tries < 4 && !ids; tries++) {
      try { ids = await sendBatch(part.map((x) => x.m), "inv-" + part[0].r.id + "-" + part.length); }
      catch (e) {
        const se = e as SendError;
        if (se && se.status === 429 && !se.quota && tries < 3) { await sleep(Math.min(5000, Math.max(1000, (se.retryAfter || 1) * 1000))); continue; } // rate limit: wait, try again
        if (se && se.status === 429) { // allowance used up (or still rate limited): back in the queue — tomorrow for the allowance, a minute for the rate
          const at = se.quota ? nextUtcDay(now) : now + 60_000; await backTo(part.map((x) => x.r), at, null);
          for (let j = i + BATCH; j < ready.length; j += BATCH) await backTo(ready.slice(j, j + BATCH).map((x) => x.r), at, null);
          out.deferred += ready.length - i; out.next_at = iso(at); stop = true; break;
        }
        const msg = String((e as Error).message || e).slice(0, 280);
        await d.admin.from("invite_sends").update({ status: "failed", error: msg }).in("id", part.map((x) => x.r.id)).eq("status", "sending");
        out.failed += part.length; break;
      }
    }
    if (stop) break;
    if (ids) {
      const at = iso(d.now ? d.now() : Date.now());
      for (let j = 0; j < part.length; j++) await d.admin.from("invite_sends").update({ status: "sent", sent_at: at, resend_id: ids[j] || null, error: null }).eq("id", part[j].r.id);
      out.sent += part.length;
    }
    if (i + BATCH < ready.length) await sleep(SEND_PAUSE_MS);
  }
  out.left = Math.max(0, al.left - out.sent);
  return out;
}

async function invites(d: Deps, me: Row & { id: string }, b: Row, now: number): Promise<Response> {
  const id = String(b.id);
  if (b.kind === "invite_status" || b.kind === "drain") { // id = the page
    const c = await pageCtx(d, id); if (!c || !(await plans(d.admin, c.ev, me))) return json(403, { ok: false, error: "Not yours" });
    const r = b.kind === "drain" ? await drain(d, now, id, true) : null;
    const al = await allowance(d, now);
    const { data: q } = await d.admin.from("invite_sends").select("id,not_before").eq("event_id", id).eq("status", "queued").limit(5000);
    const qs = (q || []).map((x: Row) => String(x.not_before)).sort();
    return json(200, { ok: true, ...(r || {}), left: al.left, dayLeft: al.dayLeft, monthLeft: al.monthLeft, dailyCap: al.dailyCap, monthlyCap: al.monthlyCap, reserve: al.reserve,
      queued: qs.length, next_at: qs[0] || (r && r.next_at) || null });
  }
  const { data: inv } = await d.admin.from("invitations").select("id,event_id,kind,images").eq("id", id).maybeSingle();
  if (!inv) return json(404, { ok: false, error: "Not found" });
  const c = await pageCtx(d, inv.event_id); if (!c || !(await plans(d.admin, c.ev, me))) return json(403, { ok: false, error: "Not yours" });
  if (!c.ev.published) return json(200, { ok: true, sent: 0, skipped: "page not shared" });
  if (!inv.images || !Object.keys(inv.images).length) return json(400, { ok: false, error: "Save the design first" });

  if (b.kind === "invite_test") { // to the organizer's own confirmed email, personalized like a household (or plainly)
    const to = me.email && me.email_confirmed_at ? String(me.email).toLowerCase() : ""; if (!to) return json(400, { ok: false, error: "Confirm your email first" });
    const al = await allowance(d, now); if (al.left < 1) return json(429, { ok: false, error: "No emails left today", left: 0 });
    let h: Row | null = null; let ppl: Row[] = [];
    if (UUID.test(String(b.household || ""))) { const { data } = await d.admin.from("guest_households").select("id,event_id,name,lang,token,greeting").eq("id", b.household).eq("event_id", c.ev.id).maybeSingle(); h = data || null;
      if (h) { const { data: ps } = await d.admin.from("guest_people").select("household_id,name,age,added_by").eq("household_id", h.id).limit(60); ppl = ps || []; } }
    const want = String(b.lang || (h && h.lang) || ""); const lang = c.langs.includes(want) || INV_MAIL[want] ? want : "";
    const ml = lang && INV_MAIL[lang] ? lang : (INV_MAIL[c.src] ? c.src : "en");
    const img = pickImage(inv, lang, c.src);
    const who = String((me.user_metadata && (me.user_metadata.full_name || me.user_metadata.name)) || "").trim().split(/\s+/)[0];
    const m = inviteMail({ to, kind: inv.kind, lang: ml, title: titleIn(c.cfg, lang), cfg: c.cfg, greet: h ? greetingOf(h, ppl, ml) : (who || to.split("@")[0]), many: h ? manyOf(h, ppl) : false,
      link: h ? personalLink(c.ev.slug, c.name, h.token, lang && lang !== c.src ? lang : "") : (c.name ? SITE + c.name : `${SITE}?e=${c.ev.slug}`), img: img ? publicUrl(SUPA(), img.path) : null, w: img && img.w, h: img && img.h, test: true });
    m.from = senderOf((globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get("NOTIFY_FROM") || "1LinkTrip <onboarding@resend.dev>", titleIn(c.cfg, c.src));
    try { const sb = d.sendBatch || (async (ms: Mail[]) => { await d.send(ms); return [""]; }); await sb([m]); }
    catch (e) { const se = e as SendError; return json(se && se.status === 429 ? 429 : 502, { ok: false, error: String((e as Error).message || e).slice(0, 200) }); }
    return json(200, { ok: true, sent: 1, to });
  }

  // kind "invite": queue one email per household (skipping ones already sent / queued unless again), then send what's allowed
  const want: string[] = Array.isArray(b.households) ? b.households.map(String).filter((x: string) => UUID.test(x)).slice(0, 2000) : [];
  if (!want.length) return json(400, { ok: false, error: "Choose who to send it to" });
  const hs: Row[] = [];
  for (let i = 0; i < want.length; i += 200) { const { data } = await d.admin.from("guest_households").select("id,event_id,email,lang").eq("event_id", c.ev.id).in("id", want.slice(i, i + 200)); hs.push(...(data || [])); }
  const withEmail = hs.filter((h) => h.email && EMAIL.test(h.email));
  const prev: Row[] = [];
  for (let i = 0; i < withEmail.length; i += 200) { const { data } = await d.admin.from("invite_sends").select("household_id,status").eq("invitation_id", inv.id).eq("channel", "email").in("household_id", withEmail.slice(i, i + 200).map((h) => h.id)).in("status", ["queued", "sending", "sent", "delivered"]); prev.push(...(data || [])); }
  const pending = new Set(prev.filter((p) => p.status === "queued" || p.status === "sending").map((p) => p.household_id)); // never twice in the queue
  const done = new Set(prev.filter((p) => p.status === "sent" || p.status === "delivered").map((p) => p.household_id));
  const go = withEmail.filter((h) => !pending.has(h.id) && (b.again === true || !done.has(h.id)));
  const rows = go.map((h) => { const lang = h.lang && (c.langs.includes(h.lang) || INV_MAIL[h.lang]) ? h.lang : ""; const img = pickImage(inv, lang, c.src);
    return { event_id: c.ev.id, household_id: h.id, invitation_id: inv.id, kind: inv.kind, channel: "email", status: "queued", to_email: h.email, lang, image_path: img ? img.path : null, created_by: me.id, not_before: new Date(now).toISOString() }; });
  for (let i = 0; i < rows.length; i += 500) { const { error } = await d.admin.from("invite_sends").insert(rows.slice(i, i + 500)); if (error) return json(500, { ok: false, error: String(error.message || error).slice(0, 200) }); }
  const r = await drain(d, now, c.ev.id);
  const { data: q } = await d.admin.from("invite_sends").select("id").eq("event_id", c.ev.id).eq("status", "queued").limit(5000);
  return json(200, { ok: true, queued: rows.length, already: [...done].filter((x) => !go.some((h) => h.id === x)).length, pending: pending.size, noEmail: hs.length - withEmail.length,
    ...r, waiting: (q || []).length });
}

function defaultDeps(): Deps {
  const url = Deno.env.get("SUPABASE_URL") || ""; const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const key = Deno.env.get("RESEND_API_KEY") || ""; const from = Deno.env.get("NOTIFY_FROM") || "1LinkTrip <onboarding@resend.dev>";
  const admin = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });
  // every email is counted (email_log); Resend's own running counts (quota headers) are kept in email_usage
  const record = async (r: Response, kind: string, n: number) => {
    try {
      await admin.from("email_log").insert({ kind, n });
      const dq = Number(r.headers.get("x-resend-daily-quota")), mq = Number(r.headers.get("x-resend-monthly-quota"));
      if (Number.isFinite(dq) && r.headers.get("x-resend-daily-quota") !== null) {
        const now = Date.now(); const day = utcDay(now);
        await admin.from("email_usage").upsert({ id: 1, day, day_used: dq, month: day.slice(0, 7), month_used: Number.isFinite(mq) ? mq : 0, observed_at: new Date(now + 1).toISOString() });
      }
    } catch { /* counting must never stop a send */ }
  };
  const post = async (mails: Mail[], idem?: string) => {
    const r = await fetch("https://api.resend.com/emails/batch", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(idem ? { "Idempotency-Key": idem } : {}) },
      body: JSON.stringify(mails.map((m) => ({ from: m.from || from, to: [m.to], subject: m.subject, text: m.text, html: m.html }))),
    });
    if (!r.ok) {
      const body = (await r.text()).slice(0, 300);
      throw new SendError(`Resend ${r.status}: ${body.slice(0, 160)}`, r.status, Number(r.headers.get("retry-after")) || 1, r.status === 429 && /quota/i.test(body));
    }
    const j = await r.json().catch(() => null);
    await record(r, "batch", mails.length);
    return (j && Array.isArray(j.data) ? j.data : []).map((x: { id?: string }) => String((x && x.id) || ""));
  };
  const send = async (mails: Mail[]) => { for (let i = 0; i < mails.length; i += 100) await post(mails.slice(i, i + 100)); };
  const sendBatch = (mails: Mail[], idem?: string) => post(mails, idem); // same key on a retry → Resend never sends it twice (24 h)
  const cron = Deno.env.get("NOTIFY_CRON_SECRET") || "";
  const same = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
  return { admin, send, sendBatch, ready: !!key && !!url && !!svc, isServer: (req: Request) => cron.length >= 32 && same(req.headers.get("x-cron-secret") || "", cron) };
}

// Supabase runs this file as the function; tests import it with NOTIFY_TEST=1 and pass fake deps.
if (!Deno.env.get("NOTIFY_TEST")) Deno.serve((req) => handler(req));
