// 1LinkTrip "inbound" Supabase Edge Function: "Forward a booking email to your itinerary" (Resend Inbound).
// Someone forwards a confirmation to add-<token>@in.1linktrip.com (their personal address, table inbound_tokens) — or to
// any address there from the email they sign in with — and Resend POSTs an `email.received` webhook here. We verify the
// signature, find the person, fetch the body and attachments from Resend, read them with ai-import (same handler, in
// process: text mode for the body, file mode for PDFs/photos) and save each booking as a trip_items row (source 'email')
// for the trip whose dates it falls in, or page_key 'inbox' when none/several fit. The app turns those rows into real
// bookings the next time that trip opens, through the same add path as Add a booking (dedupe, hotel replace).
//
// Deploy: name `inbound`, files ai/inbound.ts + ai/inbound-env.ts + ai/ai-import.ts, Verify JWT OFF (Resend can't sign
//         in; the webhook signature is checked here instead). Database: supabase/schema-inbound.sql.
// Secrets: RESEND_INBOUND_SECRET  the webhook's signing secret (whsec_…). Unset → every POST is refused (401).
//          INBOUND_DOMAIN         e.g. in.1linktrip.com. Unset → the app keeps the "Forward bookings" row hidden.
//          RESEND_INBOUND_API_KEY a Resend key with FULL access (reading received mail); falls back to RESEND_API_KEY.
//          NOTIFY_FROM (optional) a verified sender, e.g. "1LinkTrip <hello@1linktrip.com>": a short "Added …" email.
//          ANTHROPIC_API_KEY (ai-import's), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY are already there.
// GET → { ok, enabled, domain } (public; the app shows the row only when enabled).
// POST (Resend webhook) → 401 unsigned/invalid · 200 { ok, added, trips } · 200 { duplicate } · 200 { dropped } (unknown sender).
// Idempotent per Resend email_id (ledger table inbound_messages, plus deterministic row ids).

import "./inbound-env.ts";
import { handler as aiImportHandler } from "./ai-import.ts";
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const ALLOWED_ORIGINS = ["https://1linktrip.com", "https://www.1linktrip.com", "https://bbbot0209.github.io"];
const DEFAULT_DOMAIN = "in.1linktrip.com";
const RESEND_API = "https://api.resend.com";
const TOLERANCE_S = 5 * 60;
const MAX_FILES = 6, MAX_FILE_BYTES = 10_000_000, LOGO_BYTES = 40_000;
const FILE_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"];
const SITE = "https://1linktrip.com/";

// deno-lint-ignore no-explicit-any
type Any = any;
export type AiItem = Record<string, Any> & { type?: string; name?: string; start?: string; end?: string; confirmation?: string };
export type Trip = { key: string; title: string; start: string; end: string; slug?: string; own?: boolean };
export type ResendEmail = { id?: string; from?: string; subject?: string; text?: string | null; html?: string | null; authentication?: { spf?: string; dkim?: string; dmarc?: string } | null };
export type ResendAttachment = { id: string; filename?: string; size?: number; content_type?: string; content_disposition?: string; download_url?: string };
export interface Store {
  claim(emailId: string): Promise<"new" | "dup">;
  release(emailId: string): Promise<void>;
  finish(emailId: string, patch: Record<string, unknown>): Promise<void>;
  userByToken(token: string): Promise<string | null>;
  userByEmail(addr: string): Promise<string | null>;
  trips(uid: string): Promise<Trip[]>;
  saveRows(rows: Record<string, unknown>[]): Promise<void>;
  userEmail(uid: string): Promise<string | null>;
}
export interface Deps {
  env(name: string): string | undefined;
  store: Store;
  getEmail(id: string): Promise<ResendEmail>;
  listAttachments(id: string): Promise<ResendAttachment[]>;
  download(url: string): Promise<Uint8Array>;
  extract(uid: string, body: Record<string, unknown>): Promise<AiItem[]>;
  mail(to: string, subject: string, text: string): Promise<void>;
  now(): number;
  log(...a: unknown[]): void;
}

// ---------- pure helpers (tested) ----------
const enc = new TextEncoder();
export function b64(bytes: Uint8Array): string {
  let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s: string): Uint8Array<ArrayBuffer> { const bin = atob(s); const out = new Uint8Array(new ArrayBuffer(bin.length)); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
function sameStr(a: string, b: string): boolean { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

// Resend signs webhooks the Svix way: HMAC-SHA256(base64-decoded secret after "whsec_", `${id}.${timestamp}.${body}`),
// base64, sent as one or more space-separated "v1,<sig>" in svix-signature. Timestamps older/newer than 5 min are refused.
export async function signSvix(secret: string, id: string, ts: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", unb64(secret.replace(/^whsec_/, "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${id}.${ts}.${body}`))));
}
export async function verifySignature(secret: string | undefined, h: { id?: string | null; timestamp?: string | null; signature?: string | null }, body: string, nowMs: number): Promise<boolean> {
  if (!secret || !h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp); if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > TOLERANCE_S) return false;
  let want: string; try { want = await signSvix(secret, h.id, h.timestamp, body); } catch { return false; }
  return h.signature.split(" ").some((p) => { const [v, sig] = p.split(","); return v === "v1" && !!sig && sameStr(sig, want); });
}

// "Name <a@b.com>" → a@b.com (lowercase)
export function addrOf(s: unknown): string {
  const t = String(s || "").trim(); const m = t.match(/<([^<>\s]+@[^<>\s]+)>/); const a = (m ? m[1] : t).toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a) ? a : "";
}
// the personal token in any recipient: add-<18 hex>@<domain> (or the bare <token>@<domain> of the first design)
export function tokenFrom(addrs: unknown[], domain: string): string | null {
  const d = domain.toLowerCase().replace(/[.]/g, "\\.");
  const re = new RegExp(`^(?:add-)?([a-f0-9]{18})@${d}$`);
  for (const a of addrs) { const m = addrOf(a).match(re); if (m) return m[1]; }
  return null;
}
// a From address only counts when the receiving server says it wasn't forged: DMARC pass, or a DKIM pass (aligned with From)
export const senderTrusted = (auth: ResendEmail["authentication"]) => !!auth && (auth.dmarc === "pass" || auth.dkim === "pass");

// the app's eventKey(cfg).slice(6) — the page_key a page's My trip syncs under (app.js syncKey)
export function pageKeyOf(cfg: Any): string {
  const ek = cfg && (cfg._ek || cfg.ek);
  if (ek) return String(ek).slice(6);
  const s = String((cfg && cfg.title) || "") + String((cfg && cfg.start) || "") + String((cfg && cfg.venue && cfg.venue.name) || "");
  return Math.abs([...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36);
}
const day = (s: unknown) => { const m = String(s || "").match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : ""; };
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
// uid: the person the email is for — their own pages are marked own (they win when several trips overlap)
export function tripsFrom(events: { slug?: string; owner?: string; config: Any }[], uid?: string): Trip[] {
  const out = new Map<string, Trip>();
  for (const e of events || []) {
    const c = e && e.config; if (!c) continue; const key = pageKeyOf(c); if (!key || out.has(key)) continue;
    const start = day(c.start); out.set(key, { key, title: String(c.title || "your trip").slice(0, 80), start, end: day(c.end) || start, slug: e.slug, own: !!uid && e.owner === uid });
  }
  return [...out.values()];
}
// the one trip whose dates (a day either side for flights and early check-ins) overlap the booking; when several do, the
// one of those the person owns (Dylan 11/24); still several (or none) → null = Inbox
export function pickTrip(item: AiItem, trips: Trip[]): Trip | null {
  const s = day(item.start); if (!s) return null; const e = day(item.end) && day(item.end) >= s ? day(item.end) : s;
  const hits = trips.filter((t) => t.start && s <= addDays(t.end || t.start, 1) && e >= addDays(t.start, -2));
  if (hits.length === 1) return hits[0];
  const own = hits.filter((t) => t.own); return own.length === 1 ? own[0] : null;
}
// the body as plain text for ai-import's text mode (no styles, scripts or inline images)
export function htmlToText(html: unknown): string {
  return String(html || "").replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}
// the body and a PDF of the same booking both come back: keep the fuller copy
export function dedupeItems(items: AiItem[]): AiItem[] {
  const filled = (x: AiItem) => Object.values(x).filter((v) => Array.isArray(v) ? v.length : v !== "" && v != null).length;
  const keyOf = (x: AiItem) => String(x.type || "") + "|" + (String(x.confirmation || "").trim().toUpperCase() || (String(x.name || "").toLowerCase().trim() + "|" + day(x.start)));
  const out: AiItem[] = [];
  for (const x of items || []) {
    if (!x || !(x.name || x.provider || x.start)) continue;
    const j = out.findIndex((y) => keyOf(y) === keyOf(x) && day(y.start) === day(x.start));
    if (j < 0) out.push(x); else if (filled(x) > filled(out[j])) out[j] = x;
  }
  return out.slice(0, 40);
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function spanText(item: AiItem): string {
  const s = day(item.start), e = day(item.end); if (!s) return "";
  const f = (d: string) => `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}`;
  if (!e || e === s) return f(s);
  return s.slice(0, 7) === e.slice(0, 7) ? `${f(s)}–${+e.slice(8, 10)}` : `${f(s)}–${f(e)}`;
}
export function confirmationText(items: AiItem[], trips: (Trip | null)[]): { subject: string; text: string } {
  const one = (x: AiItem) => [x.name || x.provider || "Booking", spanText(x)].filter(Boolean).join(", ");
  const placed = new Set(trips.map((t) => t ? t.title : "")); const allIn = trips.every((t) => t) && placed.size === 1;
  const what = items.length === 1 ? one(items[0]) : `${items.length} bookings`;
  if (allIn) { const t = trips[0]!; const s = `Added ${what} to ${t.title}`; return { subject: s, text: `${s}.\n\n${t.slug ? SITE + "?e=" + t.slug : SITE}` }; }
  const s = `Got ${what}`;
  return { subject: s, text: `${s}.\n\n${items.map((x, i) => `• ${one(x)} → ${trips[i] ? trips[i]!.title : "Inbox (open My trip to pick its trip)"}`).join("\n")}\n\n${SITE}#mine` };
}
export const rowId = (emailId: string, i: number) => `em-${String(emailId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 16)}-${i}`;

// ---------- the webhook ----------
const cors = (req: Request): Record<string, string> => {
  const o = req.headers.get("Origin") || "";
  return { "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0], "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Vary": "Origin" };
};
const json = (status: number, body: unknown, h: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...h } });

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  const secret = deps.env("RESEND_INBOUND_SECRET"); const domain = (deps.env("INBOUND_DOMAIN") || "").trim().toLowerCase();
  if (req.method === "GET") return json(200, { ok: true, enabled: !!(secret && domain), domain: secret && domain ? domain : "" }, { ...cors(req), "Cache-Control": "public, max-age=300" });
  if (req.method !== "POST") return json(405, { ok: false });
  const raw = await req.text();
  const signed = await verifySignature(secret, { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") }, raw, deps.now());
  if (!signed) return json(401, { ok: false, error: secret ? "invalid signature" : "inbound is not configured" });
  let ev: Any; try { ev = JSON.parse(raw); } catch { return json(400, { ok: false }); }
  if (!ev || ev.type !== "email.received") return json(200, { ok: true, ignored: ev && ev.type });
  const d = ev.data || {}; const emailId = String(d.email_id || "");
  if (!emailId) return json(400, { ok: false, error: "no email_id" });
  if (await deps.store.claim(emailId) === "dup") return json(200, { ok: true, duplicate: true });
  try {
    const dom = domain || DEFAULT_DOMAIN;
    const rcpts = [].concat(d.to || [], d.cc || [], d.bcc || [], d.received_for || []);
    const token = tokenFrom(rcpts, dom);
    let uid = token ? await deps.store.userByToken(token) : null; let email: ResendEmail | null = null; let via = token && uid ? "token" : "";
    if (!uid) {
      const sender = addrOf(d.from);
      if (sender) { email = await deps.getEmail(emailId); if (senderTrusted(email.authentication)) { uid = await deps.store.userByEmail(sender); via = uid ? "sender" : ""; } }
    }
    if (!uid) { deps.log("inbound: dropped", emailId, token ? "unknown token" : "unknown or unverified sender"); await deps.store.finish(emailId, { status: "unknown" }); return json(200, { ok: true, dropped: true }); }
    email = email || await deps.getEmail(emailId);
    const subject = String(email.subject || d.subject || "").slice(0, 300);
    const text = (email.text && String(email.text).trim()) || htmlToText(email.html);
    // attachments: PDFs and photos (not the little inline logos), up to ai-import's limits
    const metas = Array.isArray(d.attachments) && d.attachments.length ? await deps.listAttachments(emailId) : [];
    const files: { media_type: string; data: string }[] = []; let bytes = 0;
    for (const a of metas) {
      const mt = String(a.content_type || "").toLowerCase().split(";")[0]; if (!FILE_TYPES.includes(mt) || !a.download_url) continue;
      if (mt !== "application/pdf" && a.content_disposition === "inline" && (a.size || 0) < LOGO_BYTES) continue;
      if (files.length >= MAX_FILES || bytes + (a.size || 0) > MAX_FILE_BYTES) break;
      const buf = await deps.download(a.download_url); bytes += buf.length; if (bytes > MAX_FILE_BYTES) break;
      files.push({ media_type: mt, data: b64(buf) });
    }
    const jobs: Promise<AiItem[]>[] = [];
    if (text.length >= 20) jobs.push(deps.extract(uid, { text: `Subject: ${subject}\nFrom: ${String(email.from || d.from || "")}\n\n${text}`, kind: "confirmation" }));
    if (files.length) jobs.push(deps.extract(uid, { mode: "file", files }));
    const items = dedupeItems((await Promise.all(jobs)).flat());
    const trips = items.length ? await deps.store.trips(uid) : []; const picks = items.map((x) => pickTrip(x, trips));
    const at = new Date(deps.now()).toISOString();
    const rows = items.map((x, i) => ({ id: rowId(emailId, i), owner: uid, page_key: picks[i] ? picks[i]!.key : "inbox", kind: "booking", source: "email", updated_at: at,
      item: { inbound: 1, ai: x, em: emailId, subj: subject.slice(0, 200), at } }));
    if (rows.length) await deps.store.saveRows(rows);
    await deps.store.finish(emailId, { status: rows.length ? "added" : "empty", owner: uid, added: rows.length });
    deps.log("inbound:", emailId, via, rows.length, "items", picks.map((p) => p ? p.key : "inbox").join(","));
    if (rows.length && deps.env("NOTIFY_FROM")) { // optional "Added …" email, only once a real sender domain is set up
      try { const to = await deps.store.userEmail(uid); if (to) { const m = confirmationText(items, picks); await deps.mail(to, m.subject, m.text); } } catch (e) { deps.log("inbound: confirmation failed", String(e)); }
    }
    return json(200, { ok: true, added: rows.length, trips: picks.map((p) => p ? p.key : "inbox") });
  } catch (e) {
    deps.log("inbound: failed", emailId, String(e && (e as Error).message || e));
    await deps.store.release(emailId).catch(() => {}); // let Resend's retry run it again
    return json(500, { ok: false, error: "processing failed" });
  }
}

// ---------- the real dependencies ----------
const missing = (e: Any) => e && (e.code === "PGRST205" || e.code === "42P01" || /does not exist|schema cache/i.test(e.message || ""));
export function makeStore(db: Any): Store {
  return {
    async claim(id) { const { error } = await db.from("inbound_messages").insert({ email_id: id, status: "processing" }); if (!error || missing(error)) return "new"; if (error.code === "23505") return "dup"; throw new Error(error.message); },
    async release(id) { await db.from("inbound_messages").delete().eq("email_id", id); },
    async finish(id, patch) { await db.from("inbound_messages").update(patch).eq("email_id", id); },
    async userByToken(t) { const { data, error } = await db.from("inbound_tokens").select("owner").eq("token", t).maybeSingle(); if (error) throw new Error(error.message); return data ? data.owner : null; },
    async userByEmail(a) { const { data, error } = await db.rpc("inbound_user_by_email", { addr: a }); if (error) throw new Error(error.message); return data || null; },
    async trips(uid) {
      const own = await db.from("events").select("slug,owner,config").eq("owner", uid).limit(200);
      const ks = await db.from("trip_items").select("page_key").eq("owner", uid).neq("page_key", "inbox").limit(5000);
      if (own.error || ks.error) throw new Error((own.error || ks.error).message);
      const keys = [...new Set(((ks.data || []) as { page_key: string }[]).map((r) => r.page_key))].slice(0, 100);
      const guest = keys.length ? await db.from("events").select("slug,owner,config").in("config->>ek", keys.map((k) => "modes:" + k)).limit(200) : { data: [], error: null };
      if (guest.error) throw new Error(guest.error.message);
      const mine = new Set(keys); // a page they own counts; a page of someone else's counts once they've used its My trip
      return tripsFrom([...(own.data || []), ...((guest.data || []) as Any[]).filter((e) => mine.has(pageKeyOf(e.config)))], uid);
    },
    async saveRows(rows) { const { error } = await db.from("trip_items").upsert(rows, { onConflict: "owner,id", ignoreDuplicates: true }); if (error) throw new Error(error.message); },
    async userEmail(uid) { const { data } = await db.auth.admin.getUserById(uid); return (data && data.user && data.user.email) || null; },
  };
}
function realDeps(): Deps {
  const env = (n: string) => Deno.env.get(n);
  const key = () => { const k = env("RESEND_INBOUND_API_KEY") || env("RESEND_API_KEY"); if (!k) throw new Error("no Resend API key"); return k; };
  const rget = async (path: string) => { const r = await fetch(RESEND_API + path, { headers: { Authorization: "Bearer " + key() } }); if (!r.ok) throw new Error(`Resend ${path.split("?")[0]} ${r.status}`); return r.json(); };
  let store: Store | null = null;
  return {
    env, now: () => Date.now(), log: (...a) => console.log(...a),
    get store() { return store || (store = makeStore(createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } }))); },
    getEmail: (id) => rget(`/emails/receiving/${encodeURIComponent(id)}?html_format=cid`),
    listAttachments: async (id) => { const j = await rget(`/emails/receiving/${encodeURIComponent(id)}/attachments?limit=20`); return (j && j.data) || []; },
    download: async (url) => { const r = await fetch(url); if (!r.ok) throw new Error("attachment " + r.status); return new Uint8Array(await r.arrayBuffer()); },
    extract: (uid, body) => extractVia(aiImportHandler, uid, body),
    mail: async (to, subject, text) => { await fetch(RESEND_API + "/emails", { method: "POST", headers: { Authorization: "Bearer " + (env("RESEND_API_KEY") || key()), "Content-Type": "application/json" }, body: JSON.stringify({ from: env("NOTIFY_FROM"), to: [to], subject, text }) }); },
  } as Deps;
}
// ai-import's own handler, called in process as that signed-in person (its signedInUser() reads role + sub; the platform's
// JWT check is skipped because this never leaves the function). A 4xx (no reservations, unreadable file) = no items;
// busy/5xx throws so Resend retries.
export async function extractVia(h: (r: Request) => Promise<Response>, uid: string, body: Record<string, unknown>): Promise<AiItem[]> {
  const p = btoa(JSON.stringify({ role: "authenticated", sub: uid })).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const r = await h(new Request("https://inbound.local/ai-import", { method: "POST", headers: { authorization: `Bearer inbound.${p}.local`, "content-type": "application/json" }, body: JSON.stringify(body) }));
  const j = await r.json().catch(() => null);
  if (r.status === 429 || r.status >= 500) throw new Error("ai-import " + r.status + " " + (j && j.error || ""));
  return j && j.ok && j.data && Array.isArray(j.data.items) ? j.data.items : [];
}

if (!Deno.env.get("INBOUND_TEST")) { const deps = realDeps(); Deno.serve((req) => handle(req, deps)); }
