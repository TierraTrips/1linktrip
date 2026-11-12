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
// POST { "kind": "announcement", "id": "<announcements.id>" } owner posted → email the chosen groups (or everyone known)
// GET  → { ok, ready } (ready = RESEND_API_KEY is set)
// Each row is emailed at most once (notified_at). The host's own email address is never sent to guests.

import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const ALLOWED_ORIGIN = "https://bbbot0209.github.io";
const SITE = "https://bbbot0209.github.io/eventpages/";
const MAX_RECIPIENTS = 300;
const THREAD_QUIET_MS = 10 * 60 * 1000; // one email per thread per 10 minutes

const cors = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Vary": "Origin",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

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

export async function handler(req: Request, deps?: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
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
  if (!UUID.test(id) || (b.kind !== "message" && b.kind !== "announcement")) return json(400, { ok: false, error: "Unknown request" });
  if (!d.ready) return json(200, { ok: true, sent: 0, skipped: "email not set up" });
  const now = d.now ? d.now() : Date.now();

  if (b.kind === "message") {
    const { data: m } = await d.admin.from("event_messages").select("id,event_id,guest,from_host,guest_name,guest_email,body,notified_at,created_at").eq("id", id).maybeSingle();
    if (!m) return json(404, { ok: false, error: "Not found" });
    const { data: ev } = await d.admin.from("events").select("id,slug,owner,config").eq("id", m.event_id).maybeSingle();
    if (!ev) return json(404, { ok: false, error: "Not found" });
    // only the person who wrote it can ask for its email
    if (m.from_host ? ev.owner !== me.id : m.guest !== me.id) return json(403, { ok: false, error: "Not yours" });
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

  // announcement: only the page owner, and only once
  const { data: a } = await d.admin.from("announcements").select("id,event_id,body,group_ids,notified_at").eq("id", id).maybeSingle();
  if (!a) return json(404, { ok: false, error: "Not found" });
  const { data: ev } = await d.admin.from("events").select("id,slug,owner,config,published").eq("id", a.event_id).maybeSingle();
  if (!ev || ev.owner !== me.id) return json(403, { ok: false, error: "Not yours" });
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
