// 1LinkTrip "invite-hook" Supabase Edge Function: Resend's delivery webhook for invitation emails.
// Marks the invite_sends row with that Resend id delivered / bounced / complained (schema-invites.sql). Nothing else.
//
// Deploy: name invite-hook, "Verify JWT" OFF (Resend calls it; every call must carry a valid Resend signature instead).
// Resend → Webhooks → endpoint https://<project>.supabase.co/functions/v1/invite-hook, events email.delivered,
//          email.bounced, email.complained. Secret: INVITE_HOOK_SECRET = that webhook's signing secret (whsec_…).
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const TOLERANCE_S = 300;
const enc = new TextEncoder();
const b64 = (bytes: Uint8Array) => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => { const bin = atob(s); const out = new Uint8Array(new ArrayBuffer(bin.length)); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
const same = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };
export async function signSvix(secret: string, id: string, ts: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", unb64(secret.replace(/^whsec_/, "")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${id}.${ts}.${body}`))));
}
async function verified(secret: string, req: Request, body: string, now: number) {
  const id = req.headers.get("svix-id"), ts = req.headers.get("svix-timestamp"), sig = req.headers.get("svix-signature");
  if (!secret || !id || !ts || !sig || !Number.isFinite(+ts) || Math.abs(now / 1000 - +ts) > TOLERANCE_S) return false;
  let want: string; try { want = await signSvix(secret, id, ts, body); } catch { return false; }
  return sig.split(" ").some((p) => { const [v, s] = p.split(","); return v === "v1" && !!s && same(s, want); });
}

// event type → the row's new state; a later "delivered" never hides a bounce / complaint
// deno-lint-ignore no-explicit-any
export function patchFor(type: string, data: any, at: string): { patch: Record<string, unknown>; from: string[] } | null {
  if (type === "email.delivered") return { patch: { status: "delivered", delivered_at: at }, from: ["sent", "sending"] };
  if (type === "email.bounced") return { patch: { status: "bounced", bounced_at: at, error: String((data && data.bounce && (data.bounce.message || data.bounce.type)) || "Bounced").slice(0, 280) }, from: ["sent", "sending", "delivered"] };
  if (type === "email.complained") return { patch: { status: "complained" }, from: ["sent", "sending", "delivered"] };
  return null;
}
// deno-lint-ignore no-explicit-any
export type HookDeps = { admin: any; secret: string; now: () => number };

export async function handler(req: Request, deps?: HookDeps): Promise<Response> {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const d = deps || defaultDeps(); const body = await req.text();
  if (!(await verified(d.secret, req, body, d.now()))) return new Response("bad signature", { status: 401 });
  // deno-lint-ignore no-explicit-any
  let ev: any; try { ev = JSON.parse(body); } catch { return new Response("bad json", { status: 400 }); }
  const id = String((ev && ev.data && ev.data.email_id) || "");
  const p = patchFor(String(ev && ev.type), ev && ev.data, String((ev && ev.created_at) || new Date(d.now()).toISOString()));
  if (!id || !p) return Response.json({ ok: true, skipped: true });
  const { error } = await d.admin.from("invite_sends").update(p.patch).eq("resend_id", id).in("status", p.from);
  return error ? new Response("db", { status: 500 }) : Response.json({ ok: true });
}
function defaultDeps(): HookDeps {
  const admin = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", { auth: { persistSession: false, autoRefreshToken: false } });
  return { admin, secret: Deno.env.get("INVITE_HOOK_SECRET") || "", now: () => Date.now() };
}
if (!Deno.env.get("NOTIFY_TEST")) Deno.serve((req) => handler(req));
