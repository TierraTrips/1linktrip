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
// GET  → { ok, ready } (ready = RESEND_API_KEY is set)
// Each row is emailed at most once (notified_at). The host's own email address is never sent to guests.

import { createClient } from "npm:@supabase/supabase-js@2.119.0";

// The site's addresses. A browser call from one of these gets its own Origin echoed back; anything else gets the first.
const ALLOWED_ORIGINS = ["https://1linktrip.com", "https://www.1linktrip.com", "https://bbbot0209.github.io"];
const SITE = "https://1linktrip.com/";
const MAX_RECIPIENTS = 300;
const THREAD_QUIET_MS = 10 * 60 * 1000; // one email per thread per 10 minutes
const RESEND_MS = 10 * 60 * 1000; // an invite can be emailed again after 10 minutes

// household invitation email, per language (the household's own language when the page has it)
export const INVITE: Record<string, { s: string; hi: string; body: string; btn: string }> = {
  en: { s: "Invitation: {t}", hi: "Hi {n},", body: "You're invited to {t}. Your page has the details, and you can reply for everyone in your household there.", btn: "Open your invitation" },
  es: { s: "Invitación: {t}", hi: "Hola, {n}:", body: "Estás invitado a {t}. En tu página están todos los detalles y puedes responder por todos los de tu hogar.", btn: "Abrir tu invitación" },
  fr: { s: "Invitation : {t}", hi: "Bonjour {n},", body: "Vous êtes invités à {t}. Votre page contient tous les détails, et vous pouvez y répondre pour tout votre foyer.", btn: "Ouvrir votre invitation" },
  pt: { s: "Convite: {t}", hi: "Olá, {n},", body: "Você está convidado para {t}. Sua página tem todos os detalhes, e você pode responder por todos da sua casa.", btn: "Abrir seu convite" },
  de: { s: "Einladung: {t}", hi: "Hallo {n},", body: "Ihr seid zu {t} eingeladen. Auf eurer Seite stehen alle Details, und ihr könnt dort für euren ganzen Haushalt antworten.", btn: "Einladung öffnen" },
  it: { s: "Invito: {t}", hi: "Ciao {n},", body: "Siete invitati a {t}. Nella vostra pagina trovate tutti i dettagli e potete rispondere per tutta la famiglia.", btn: "Apri l'invito" },
  ja: { s: "ご招待：{t}", hi: "{n} 様", body: "{t} にご招待します。ページに詳細があり、ご家族全員分の出欠をまとめて返信できます。", btn: "招待状を開く" },
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

export type Mail = { to: string; subject: string; text: string; html: string };
// deno-lint-ignore no-explicit-any
type Admin = any;
export type Deps = { admin: Admin; send: (mails: Mail[]) => Promise<void>; ready: boolean; now?: () => number };

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
  const { data: who } = token ? await d.admin.auth.getUser(token) : { data: null };
  const me = who && who.user;
  if (!me) return json(401, { ok: false, error: "Sign in first" });

  let b: { kind?: string; id?: string };
  try { b = await req.json(); } catch { return json(400, { ok: false, error: "Send JSON" }); }
  const id = String(b.id || "");
  if (!UUID.test(id) || !["message", "announcement", "planner", "household"].includes(String(b.kind))) return json(400, { ok: false, error: "Unknown request" });
  if (!d.ready) return json(200, { ok: true, sent: 0, skipped: "email not set up" });
  const now = d.now ? d.now() : Date.now();

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
    const T = INVITE[lang || String((ev.config && ev.config.lang) || "en")] || INVITE.en;
    const tr = lang && ev.config && ev.config.tr && ev.config.tr[lang]; // the page's own translated title, when it has one
    const title = String((tr && tr.title && tr.title.t) || (ev.config && ev.config.title) || "").slice(0, 120);
    let n = String(h.name).slice(0, 120);
    if (h.greeting === "names") { // "Michael and Sarah": the first names of the adults the organizer listed
      const { data: ps } = await d.admin.from("guest_people").select("name,age,added_by").eq("household_id", h.id).eq("added_by", "host").limit(30);
      const fs = (ps || []).filter((p: Row) => p.age !== "child" && p.age !== "infant").map((p: Row) => String(p.name || "").trim().split(/\s+/)[0]).filter(Boolean);
      if (fs.length) n = joinNames(fs, lang || String((ev.config && ev.config.lang) || "en"));
    }
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

function defaultDeps(): Deps {
  const url = Deno.env.get("SUPABASE_URL") || ""; const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const key = Deno.env.get("RESEND_API_KEY") || ""; const from = Deno.env.get("NOTIFY_FROM") || "1LinkTrip <onboarding@resend.dev>";
  const admin = createClient(url, svc, { auth: { persistSession: false, autoRefreshToken: false } });
  const send = async (mails: Mail[]) => {
    for (let i = 0; i < mails.length; i += 100) { // Resend batch: up to 100 emails a call
      const r = await fetch("https://api.resend.com/emails/batch", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(mails.slice(i, i + 100).map((m) => ({ from, to: [m.to], subject: m.subject, text: m.text, html: m.html }))),
      });
      if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 160)}`);
    }
  };
  return { admin, send, ready: !!key && !!url && !!svc };
}

// Supabase runs this file as the function; tests import it with NOTIFY_TEST=1 and pass fake deps.
if (!Deno.env.get("NOTIFY_TEST")) Deno.serve((req) => handler(req));
