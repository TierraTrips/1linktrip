// Tests for ai/inbound.ts ("Forward a booking email", Resend Inbound): webhook signature, who the email is for (token
// address / verified sender), which trip each booking goes to, idempotency per email_id, and one end-to-end run through
// ai-import's real handler (Anthropic stubbed) with a fixture hotel confirmation + PDF attachment.
//   INBOUND_TEST=1 deno test -A tests/inbound.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
Deno.env.set("INBOUND_TEST", "1");
const M = await import(new URL("../ai/inbound.ts", import.meta.url).href);
const { handle, verifySignature, signSvix, tokenFrom, addrOf, senderTrusted, pickTrip, tripsFrom, pageKeyOf, htmlToText, dedupeItems, confirmationText, extractVia, rowId } = M;
const { handler: aiImport } = await import(new URL("../ai/ai-import.ts", import.meta.url).href);
const FX = JSON.parse(await Deno.readTextFile(new URL("./fixtures/inbound-hotel-email.json", import.meta.url)));
const PDF = await Deno.readFile(new URL("./fixtures/inbound-hyatt-kyoto.pdf", import.meta.url));

const SECRET = "whsec_" + btoa("0123456789abcdef0123456789abcdef");
const NOW = Date.parse("2026-11-24T18:02:12Z");
const U = "00000000-0000-4000-8000-0000000000d1", TQ = "00000000-0000-4000-8000-0000000000e1";
const TOKEN = "0123456789abcdef01";
const JAPAN = { slug: "japan-trip-djepw", owner: U, config: { title: "Japan Trip", ek: "modes:xfr8ua", start: "2027-04-25", end: "2027-06-02" } };
const HOLIDAY = { slug: "holiday-ball-a7t8s", owner: "someone", config: { title: "Holiday Ball", ek: "modes:wxxj2r", start: "2026-12-10", end: "2026-12-13" } };

// deno-lint-ignore no-explicit-any
type Any = any;
function fakeStore(opts: { events?: Any[]; tripItems?: Any[]; users?: Record<string, string> } = {}) {
  const ledger = new Map<string, Any>(); const rows: Any[] = (opts.tripItems || []).slice(); const users = opts.users || { [U]: "dylan@example.com" };
  const events = opts.events || [JAPAN, HOLIDAY];
  const store = {
    ledger, rows,
    async claim(id: string) { if (ledger.has(id)) return "dup"; ledger.set(id, { status: "processing" }); return "new"; },
    async release(id: string) { ledger.delete(id); },
    async finish(id: string, p: Any) { ledger.set(id, { ...ledger.get(id), ...p }); },
    async userByToken(t: string) { return t === TOKEN ? U : null; },
    async userByEmail(a: string) { return Object.entries(users).find(([, e]) => e === a)?.[0] || null; },
    async trips(uid: string) { const keys = new Set(rows.filter((r) => r.owner === uid && r.page_key !== "inbox").map((r) => r.page_key)); return tripsFrom(events.filter((e) => e.owner === uid || keys.has(pageKeyOf(e.config))), uid); },
    async saveRows(rs: Any[]) { for (const r of rs) if (!rows.some((x) => x.owner === r.owner && x.id === r.id)) rows.push(r); },
    async userEmail(uid: string) { return users[uid] || null; },
  };
  return store;
}
function deps(over: Any = {}) {
  const calls: Any = { extract: [] as Any[], mail: [] as Any[], getEmail: 0, logs: [] as Any[] };
  const env: Record<string, string> = { RESEND_INBOUND_SECRET: SECRET, INBOUND_DOMAIN: "in.1linktrip.com", ...(over.env || {}) };
  const d = {
    env: (n: string) => env[n], now: () => NOW, log: (...a: Any[]) => calls.logs.push(a.join(" ")),
    store: over.store || fakeStore(),
    getEmail: async () => { calls.getEmail++; return over.email || FX.email; },
    listAttachments: async () => FX.attachments,
    download: async (url: string) => url.includes("att-pdf") ? PDF : new Uint8Array(10),
    extract: over.extract || (async (uid: string, body: Any) => { calls.extract.push({ uid, body }); return body.mode === "file" ? [FX.ai_item] : [{ ...FX.ai_item, room_type: "" }]; }),
    mail: async (to: string, s: string, t: string) => { calls.mail.push({ to, s, t }); },
  };
  return { d, calls };
}
async function signedReq(payload: unknown, { secret = SECRET, ts = String(Math.floor(NOW / 1000)), id = "msg_1", tamper = false } = {}) {
  const body = JSON.stringify(payload); const sig = await signSvix(secret, id, ts, body);
  return new Request("https://x.supabase.co/functions/v1/inbound", { method: "POST", headers: { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}`, "content-type": "application/json" }, body: tamper ? body.replace("Kyoto", "Osaka") : body });
}
const hook = (data: Any = {}) => ({ ...FX.webhook, data: { ...FX.webhook.data, ...data } });

// ---------- signature ----------
Deno.test("signature: valid, tampered, wrong secret, stale, missing, several signatures", async () => {
  const body = '{"a":1}', ts = String(Math.floor(NOW / 1000)); const good = await signSvix(SECRET, "msg_1", ts, body);
  assert(await verifySignature(SECRET, { id: "msg_1", timestamp: ts, signature: "v1," + good }, body, NOW));
  assert(await verifySignature(SECRET, { id: "msg_1", timestamp: ts, signature: "v1,bad= v1," + good }, body, NOW), "any of several v1 signatures");
  assert(!(await verifySignature(SECRET, { id: "msg_1", timestamp: ts, signature: "v1," + good }, '{"a":2}', NOW)), "body changed");
  assert(!(await verifySignature(SECRET, { id: "msg_2", timestamp: ts, signature: "v1," + good }, body, NOW)), "id changed");
  assert(!(await verifySignature("whsec_" + btoa("another-secret-another-secret!!"), { id: "msg_1", timestamp: ts, signature: "v1," + good }, body, NOW)), "other secret");
  assert(!(await verifySignature(SECRET, { id: "msg_1", timestamp: ts, signature: "v1," + good }, body, NOW + 6 * 60_000)), "older than 5 min");
  assert(!(await verifySignature(SECRET, { id: "msg_1", timestamp: ts, signature: "v2," + good }, body, NOW)), "only v1");
  assert(!(await verifySignature(undefined, { id: "msg_1", timestamp: ts, signature: "v1," + good }, body, NOW)), "no secret");
  assert(!(await verifySignature(SECRET, { id: null, timestamp: ts, signature: "v1," + good }, body, NOW)), "no id header");
});
Deno.test("webhook: 401 unsigned, 401 bad signature, 401 when the secret isn't set; GET says dormant until configured", async () => {
  const { d } = deps();
  assertEquals((await handle(new Request("https://x/inbound", { method: "POST", body: "{}" }), d)).status, 401);
  assertEquals((await handle(await signedReq(hook(), { tamper: true }), d)).status, 401);
  assertEquals((await handle(await signedReq(hook(), { ts: String(Math.floor(NOW / 1000) - 900) }), d)).status, 401);
  const off = deps({ env: { RESEND_INBOUND_SECRET: "" } }).d;
  const r = await handle(await signedReq(hook()), off); assertEquals(r.status, 401); assertEquals((await r.json()).error, "inbound is not configured");
  assertEquals(await (await handle(new Request("https://x/inbound"), off)).json(), { ok: true, enabled: false, domain: "" });
  assertEquals(await (await handle(new Request("https://x/inbound"), deps({ env: { INBOUND_DOMAIN: "" } }).d)).json(), { ok: true, enabled: false, domain: "" });
  const on = await handle(new Request("https://x/inbound", { headers: { Origin: "https://1linktrip.com" } }), d);
  assertEquals(await on.json(), { ok: true, enabled: true, domain: "in.1linktrip.com" }); assertEquals(on.headers.get("access-control-allow-origin"), "https://1linktrip.com");
});

// ---------- who it's for ----------
Deno.test("recipient token and sender parsing", () => {
  assertEquals(tokenFrom(["add-0123456789abcdef01@in.1linktrip.com"], "in.1linktrip.com"), TOKEN);
  assertEquals(tokenFrom(["Trips <ADD-0123456789ABCDEF01@IN.1linktrip.com>"], "in.1linktrip.com"), TOKEN);
  assertEquals(tokenFrom(["someone@gmail.com", "0123456789abcdef01@in.1linktrip.com"], "in.1linktrip.com"), TOKEN, "bare token (first design)");
  assertEquals(tokenFrom(["add-0123456789abcdef01@in1linktrip.com"], "in.1linktrip.com"), null, "dot is literal");
  assertEquals(tokenFrom(["add-0123456789abcdef01@evil.com", "trips@in.1linktrip.com"], "in.1linktrip.com"), null);
  assertEquals(addrOf('"Dylan T" <Dylan@Example.com>'), "dylan@example.com"); assertEquals(addrOf("x@y.co"), "x@y.co"); assertEquals(addrOf("nope"), "");
  assert(senderTrusted({ dmarc: "pass" }) && senderTrusted({ dkim: "pass", dmarc: "gray" }));
  assert(!senderTrusted({ spf: "pass", dkim: "gray", dmarc: "fail" }) && !senderTrusted(null));
});
Deno.test("resolution: token → that person; verified sender → their account; forged or unknown sender → dropped silently", async () => {
  let x = deps(); let r = await handle(await signedReq(hook()), x.d); let j = await r.json();
  assertEquals(r.status, 200); assertEquals(j.added, 1); assert(x.calls.extract.every((c: Any) => c.uid === U));
  // no token, From is the signed-in email, DMARC pass
  x = deps(); r = await handle(await signedReq(hook({ email_id: "e-sender", to: ["trips@in.1linktrip.com"] })), x.d); j = await r.json();
  assertEquals(j.added, 1); assertEquals(x.d.store.rows[0].owner, U);
  // same, but the receiving server saw DMARC/DKIM fail → not trusted → dropped, nothing read by the model
  x = deps({ email: { ...FX.email, authentication: { spf: "fail", dkim: "fail", dmarc: "fail" } } });
  r = await handle(await signedReq(hook({ email_id: "e-forged", to: ["trips@in.1linktrip.com"] })), x.d); j = await r.json();
  assertEquals(r.status, 200); assert(j.dropped); assertEquals(x.calls.extract.length, 0); assertEquals(x.d.store.ledger.get("e-forged").status, "unknown");
  // a stranger
  x = deps(); r = await handle(await signedReq(hook({ email_id: "e-stranger", from: "promo@spam.biz", to: ["trips@in.1linktrip.com"] })), x.d); j = await r.json();
  assert(j.dropped); assertEquals(x.calls.extract.length, 0); assertEquals(x.d.store.rows.length, 0);
  // an unknown token from an unknown sender
  x = deps(); r = await handle(await signedReq(hook({ email_id: "e-tok", from: "a@b.com", to: ["add-ffffffffffffffffff@in.1linktrip.com"] })), x.d);
  assert((await r.json()).dropped); assert(x.calls.logs.some((l: string) => /dropped/.test(l)));
  // other event types are acknowledged and ignored
  assertEquals((await (await handle(await signedReq({ type: "email.sent", data: {} }), deps().d)).json()).ignored, "email.sent");
});

// ---------- which trip ----------
Deno.test("trip selection: the one trip whose dates overlap, else Inbox", () => {
  const trips = tripsFrom([JAPAN, HOLIDAY, { slug: "tokyo-wk", config: { title: "Tokyo weekend", ek: "modes:tk1", start: "2027-05-21T18:00", end: "2027-05-23" } }]);
  assertEquals(trips.map((t: Any) => t.key), ["xfr8ua", "wxxj2r", "tk1"]);
  assertEquals(pickTrip({ start: "2027-05-01T15:00", end: "2027-05-04" }, trips)?.title, "Japan Trip");
  assertEquals(pickTrip({ start: "2027-04-24T11:05", end: "2027-04-25T15:25" }, trips)?.title, "Japan Trip", "flight the day before");
  assertEquals(pickTrip({ start: "2027-05-10T15:00", end: "2027-05-22T11:00" }, trips), null, "overlaps two trips → Inbox");
  assertEquals(pickTrip({ start: "2027-08-01" }, trips), null, "no trip then → Inbox");
  assertEquals(pickTrip({ start: "" }, trips), null, "no date → Inbox");
  assertEquals(pickTrip({ start: "2026-12-11" }, trips)?.key, "wxxj2r");
  assertEquals(pickTrip({ start: "2027-05-01" }, tripsFrom([{ config: { title: "Undated", ek: "modes:u1" } }])), null);
});
Deno.test("page key matches the app's eventKey (same hash when a page has no pinned ek)", async () => {
  const src = await Deno.readTextFile(new URL("../app.js", import.meta.url));
  const line = src.match(/^const eventKey = \(cfg\) => .*;$/m); assert(line, "eventKey in app.js");
  const appKey = new Function(line[0].replace("const eventKey =", "return") )() as (c: Any) => string;
  for (const c of [{ title: "Japan Trip", start: "2027-04-25", venue: { name: "Tokyo" } }, { title: "Ana & Bén 💍", start: "2027-03-12T16:00" }, { ek: "modes:xfr8ua" }, {}])
    assertEquals(pageKeyOf(c), appKey(c).slice(6), JSON.stringify(c));
});
Deno.test("bookings land in the overlapping trip (owned or one they've used My trip on); several fits → inbox", async () => {
  // Dylan owns Japan Trip; the Holiday Ball is someone else's page he has My trip items on
  const store = fakeStore({ tripItems: [{ owner: U, id: "bk1", page_key: "wxxj2r", item: {} }] });
  const x = deps({ store, extract: async (_u: string, b: Any) => b.mode === "file" ? [] : [FX.ai_item, { ...FX.ai_item, type: "food", name: "Ball dinner", confirmation: "", start: "2026-12-11T19:00", end: "" }, { ...FX.ai_item, name: "Somewhere", confirmation: "Z1", start: "2028-01-01", end: "" }] });
  const j = await (await handle(await signedReq(hook({ attachments: [] })), x.d)).json();
  assertEquals(j.trips, ["xfr8ua", "wxxj2r", "inbox"]);
  const r0 = store.rows.find((r: Any) => r.id === rowId(FX.webhook.data.email_id, 0));
  assertEquals(r0.kind, "booking"); assertEquals(r0.source, "email"); assertEquals(r0.item.inbound, 1); assertEquals(r0.item.ai.name, "Hyatt Place Kyoto");
  // a stranger's page he never opened doesn't count
  const s2 = fakeStore(); const y = deps({ store: s2, extract: async (_u: string, b: Any) => b.mode === "file" ? [] : [{ ...FX.ai_item, start: "2026-12-11", end: "" }] });
  assertEquals((await (await handle(await signedReq(hook({ email_id: "e2", attachments: [] })), y.d)).json()).trips, ["inbox"]);
});

// ---------- idempotency ----------
Deno.test("idempotent on email_id: a redelivery adds nothing and doesn't call the model again; a failure lets the retry run", async () => {
  const x = deps(); const p = hook();
  const a = await (await handle(await signedReq(p, { id: "msg_a" }), x.d)).json();
  const b = await (await handle(await signedReq(p, { id: "msg_b" }), x.d)).json();
  assertEquals(a.added, 1); assert(b.duplicate); assertEquals(x.d.store.rows.length, 1); assertEquals(x.calls.extract.length, 2, "text + pdf, once");
  // ai-import busy → 500 and the ledger entry is released, so Resend's retry is processed
  let fail = true; const y = deps({ extract: async () => { if (fail) throw new Error("ai-import 429"); return [FX.ai_item]; } });
  const r1 = await handle(await signedReq(hook({ email_id: "e-retry" })), y.d); assertEquals(r1.status, 500); assert(!y.d.store.ledger.has("e-retry"));
  fail = false; const r2 = await (await handle(await signedReq(hook({ email_id: "e-retry" })), y.d)).json(); assertEquals(r2.added, 1);
  // deterministic row ids: even without the ledger, saving twice doesn't duplicate
  assertEquals(rowId("8c1f7c3e-2b7a-4d7e-9f4e-1a2b3c4d5e6f", 0), "em-8c1f7c3e2b7a4d7e-0");
});

// ---------- body, attachments, extraction ----------
Deno.test("helpers: html → text, dedupe the body/PDF copies, confirmation wording", () => {
  const t = htmlToText(FX.email.html); assert(/Hyatt Place Kyoto/.test(t) && /58213977/.test(t) && !/color:red/.test(t) && !/<td|<img|cid:/.test(t), t);
  const d = dedupeItems([{ ...FX.ai_item, room_type: "" }, FX.ai_item, { type: "flight", name: "", provider: "", start: "" }]);
  assertEquals(d.length, 1); assertEquals(d[0].room_type, "King Bed, Non-Smoking", "keeps the fuller copy");
  const trip = { key: "xfr8ua", title: "Japan Trip", start: "2027-04-25", end: "2027-06-02", slug: "japan-trip-djepw" };
  assertEquals(confirmationText([FX.ai_item], [trip]).subject, "Added Hyatt Place Kyoto, May 10–22 to Japan Trip");
  assert(/Inbox/.test(confirmationText([FX.ai_item], [null]).text));
});
Deno.test("attachments: the PDF is read, the inline logo isn't; confirmation email only when NOTIFY_FROM is set", async () => {
  const x = deps(); await handle(await signedReq(hook()), x.d);
  const f = x.calls.extract.find((c: Any) => c.body.mode === "file"); assert(f, "file mode called");
  assertEquals(f.body.files.length, 1); assertEquals(f.body.files[0].media_type, "application/pdf"); assert(atob(f.body.files[0].data).startsWith("%PDF-1.4"));
  const tx = x.calls.extract.find((c: Any) => c.body.kind === "confirmation"); assert(/Subject: Fwd: Your Hyatt Place Kyoto/.test(tx.body.text));
  assertEquals(x.calls.mail.length, 0);
  const y = deps({ env: { NOTIFY_FROM: "1LinkTrip <hello@1linktrip.com>" } }); await handle(await signedReq(hook()), y.d);
  assertEquals(y.calls.mail.length, 1); assertEquals(y.calls.mail[0].to, "dylan@example.com"); assertEquals(y.calls.mail[0].s, "Added Hyatt Place Kyoto, May 10–22 to Japan Trip");
});
Deno.test("end to end through ai-import's own handler (Anthropic stubbed): fixture hotel email + PDF → one booking in Japan Trip", async () => {
  const sent: Any[] = []; const realFetch = globalThis.fetch;
  globalThis.fetch = (async (req: Request | URL | string, init?: RequestInit) => {
    const url = typeof req === "string" ? req : req instanceof URL ? req.href : req.url;
    if (!url.startsWith("https://api.anthropic.com/")) return new Response("no", { status: 404 });
    sent.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "tool_use", id: "t", name: "save_items", input: { items: [FX.ai_item] } }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  Deno.env.set("ANTHROPIC_API_KEY", "sk-test");
  try {
    const x = deps({ extract: (uid: string, body: Any) => extractVia(aiImport, uid, body) });
    const j = await (await handle(await signedReq(hook()), x.d)).json();
    assertEquals(j.added, 1); assertEquals(j.trips, ["xfr8ua"]);
    assertEquals(sent.length, 2, "text mode + file mode");
    assert(sent.every((b) => b.tools[0].name === "save_items"), "both use ai-import's items tool");
    const docMsg = sent.find((b) => Array.isArray(b.messages[0].content)); assertEquals(docMsg.messages[0].content[0].type, "document");
    const txtMsg = sent.find((b) => typeof b.messages[0].content === "string"); assert(/Hyatt Place Kyoto/.test(txtMsg.messages[0].content));
    const row = x.d.store.rows[0]; assertEquals(row.page_key, "xfr8ua"); assertEquals(row.owner, U); assertEquals(row.item.ai.confirmation, "58213977");
  } finally { globalThis.fetch = realFetch; }
});
Deno.test("several trips overlap: the one they own wins; two owned (or none owned) → Inbox", () => {
  const SPRING = { slug: "japan-in-spring-zsk99", owner: "someone", config: { title: "Japan in spring", ek: "modes:i7z7z2", start: "2027-04-26", end: "2027-06-04" } };
  const hyatt = { start: "2027-05-10T15:00", end: "2027-05-22T11:00" };
  assertEquals(pickTrip(hyatt, tripsFrom([JAPAN, SPRING], U))?.key, "xfr8ua", "Dylan's own Japan Trip over someone else's overlapping page");
  assertEquals(pickTrip(hyatt, tripsFrom([JAPAN, { ...SPRING, owner: U }], U)), null, "two of his own → Inbox");
  assertEquals(pickTrip(hyatt, tripsFrom([{ ...JAPAN, owner: "x" }, SPRING], U)), null, "none his → Inbox");
  assertEquals(pickTrip(hyatt, tripsFrom([JAPAN, SPRING])), null, "no uid → nothing counts as owned");
});
Deno.test("store-level: an owned trip and a guest trip with My trip items both overlapping → the owned one", async () => {
  const SPRING = { slug: "japan-in-spring-zsk99", owner: "someone", config: { title: "Japan in spring", ek: "modes:i7z7z2", start: "2027-04-26", end: "2027-06-04" } };
  const store = fakeStore({ events: [JAPAN, SPRING], tripItems: [{ owner: U, id: "bk1", page_key: "i7z7z2", item: {} }] });
  const x = deps({ store, extract: async (_u: string, b: Any) => b.mode === "file" ? [] : [FX.ai_item] });
  assertEquals((await (await handle(await signedReq(hook({ email_id: "e-own", attachments: [] })), x.d)).json()).trips, ["xfr8ua"]);
});
