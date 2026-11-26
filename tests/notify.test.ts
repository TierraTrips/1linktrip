// Tests for ai/notify.ts with an in-memory stand-in for the Supabase admin client and a captured "send".
//   NOTIFY_TEST=1 deno test --allow-env tests/notify.test.ts
import { handler, type Mail } from "../ai/notify.ts";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const H = "00000000-0000-0000-0000-0000000000a1", G = "00000000-0000-0000-0000-0000000000b1", X = "00000000-0000-0000-0000-0000000000c1";
const E = "00000000-0000-0000-0000-0000000000e1";
const M1 = "00000000-0000-0000-0000-0000000000a9", M2 = "00000000-0000-0000-0000-0000000000a2", M3 = "00000000-0000-0000-0000-0000000000a3";
const A1 = "00000000-0000-0000-0000-0000000000f1", A2 = "00000000-0000-0000-0000-0000000000f2", GV = "00000000-0000-0000-0000-0000000000d1";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
function fakeDb() {
  const t: Record<string, Row[]> = {
    events: [{ id: E, slug: "w-abc12", owner: H, config: { title: "Ana & Ben" }, published: true }],
    event_messages: [
      { id: M1, event_id: E, guest: G, from_host: false, guest_name: "Gia", guest_email: "g@x.com", body: "Parking?", notified_at: null },
      { id: M2, event_id: E, guest: G, from_host: true, guest_name: null, guest_email: null, body: "Lot B", notified_at: null },
      { id: M3, event_id: E, guest: G, from_host: false, guest_name: "Gia", guest_email: "g@x.com", body: "Thanks", notified_at: null },
    ],
    announcements: [{ id: A1, event_id: E, body: "VIP dinner 7pm", group_ids: [GV], notified_at: null }, { id: A2, event_id: E, body: "Shuttle 4:30", group_ids: [], notified_at: null }],
    event_group_members: [{ event_id: E, group_id: GV, email: "vip@x.com" }, { event_id: E, group_id: "other", email: "runner@x.com" }],
    page_planners: [],
    rsvps: [{ event_id: E, email: "Rsvp@X.com", attending: true }, { event_id: E, email: "no@x.com", attending: false }, { event_id: E, email: "vip@x.com", attending: true }, { event_id: E, email: "host@x.com", attending: true }],
  };
  const users: Record<string, Row> = { [H]: { id: H, email: "host@x.com", email_confirmed_at: "x" }, [G]: { id: G, email: "g@x.com", email_confirmed_at: "x" }, [X]: { id: X, email: "x@x.com", email_confirmed_at: "x" } };
  const from = (name: string) => {
    const fs: ((r: Row) => boolean)[] = []; let patch: Row | null = null; let lim = 1e9;
    const q = {
      select: () => q, update: (p: Row) => { patch = p; return q; },
      eq: (k: string, v: unknown) => { fs.push((r) => r[k] === v); return q; },
      is: (k: string, v: unknown) => { fs.push((r) => (r[k] ?? null) === v); return q; },
      not: (k: string, _op: string, _v: unknown) => { fs.push((r) => r[k] != null); return q; },
      gte: (k: string, v: string) => { fs.push((r) => r[k] >= v); return q; },
      in: (k: string, vs: unknown[]) => { fs.push((r) => vs.includes(r[k])); return q; },
      limit: (n: number) => { lim = n; return q; },
      rows: () => t[name].filter((r) => fs.every((f) => f(r))).slice(0, lim),
      maybeSingle: () => Promise.resolve({ data: q.rows()[0] || null, error: null }),
      then: (res: (v: unknown) => void) => { const rs = q.rows(); if (patch) rs.forEach((r) => Object.assign(r, patch)); res({ data: rs, error: null }); },
    };
    return q;
  };
  const admin = {
    from, auth: { getUser: (tok: string) => Promise.resolve({ data: { user: users[tok] || null } }), admin: { getUserById: (id: string) => Promise.resolve({ data: { user: users[id] || null } }) } },
  };
  return { t, admin };
}
const call = (tok: string | null, body: unknown, deps: unknown) =>
  handler(new Request("https://x/functions/v1/notify", { method: "POST", headers: tok ? { Authorization: "Bearer " + tok } : {}, body: JSON.stringify(body) }), deps as never).then(async (r) => ({ status: r.status, j: await r.json() }));

Deno.test("guest message → host email; repeat is a no-op; replies go to the guest", async () => {
  const db = fakeDb(); const sent: Mail[] = []; const deps = { admin: db.admin, ready: true, send: (m: Mail[]) => { sent.push(...m); return Promise.resolve(); } };
  assert((await call(null, { kind: "message", id: M1 }, deps)).status === 401, "signed out → 401");
  assert((await call(X, { kind: "message", id: M1 }, deps)).status === 403, "someone else's message → 403");
  assert((await call(H, { kind: "message", id: M1 }, deps)).status === 403, "host cannot trigger a guest's message");
  let r = await call(G, { kind: "message", id: M1 }, deps);
  assert(r.j.sent === 1 && sent.length === 1 && sent[0].to === "host@x.com" && /Parking\?/.test(sent[0].text) && /#mine\//.test(sent[0].text), "host gets the guest message: " + JSON.stringify(r.j));
  r = await call(G, { kind: "message", id: M1 }, deps); assert(r.j.sent === 0 && sent.length === 1, "second call sends nothing");
  r = await call(G, { kind: "message", id: M3 }, deps); assert(r.j.skipped === "recently emailed" && sent.length === 1, "a burst in one thread is one email");
  r = await call(H, { kind: "message", id: M2 }, deps);
  assert(r.j.sent === 1 && sent[1].to === "g@x.com" && !/host@x\.com/.test(sent[1].text + sent[1].html + sent[1].subject) && /#t=mytrip/.test(sent[1].text), "guest gets the reply without the host's email");
});

Deno.test("announcements: groups only, or everyone known; owner only; once", async () => {
  const db = fakeDb(); const sent: Mail[] = []; const deps = { admin: db.admin, ready: true, send: (m: Mail[]) => { sent.push(...m); return Promise.resolve(); } };
  assert((await call(G, { kind: "announcement", id: A1 }, deps)).status === 403, "guest cannot send an update email");
  let r = await call(H, { kind: "announcement", id: A1 }, deps);
  assert(r.j.sent === 1 && sent.map((m) => m.to).join() === "vip@x.com", "VIP update → VIP members only: " + sent.map((m) => m.to));
  r = await call(H, { kind: "announcement", id: A2 }, deps);
  const to = sent.slice(1).map((m) => m.to).sort().join();
  assert(to === "rsvp@x.com,runner@x.com,vip@x.com", "everyone → members + attending RSVP emails, minus the host: " + to);
  r = await call(H, { kind: "announcement", id: A2 }, deps); assert(r.j.sent === 0, "sent once");
});

Deno.test("not set up → nothing sent, rows stay unclaimed", async () => {
  const db = fakeDb(); const deps = { admin: db.admin, ready: false, send: () => { throw new Error("should not send"); } };
  const r = await call(G, { kind: "message", id: M1 }, deps);
  assert(r.j.ok && r.j.skipped === "email not set up" && db.t.event_messages[0].notified_at === null, "skipped, unclaimed");
  const g = await handler(new Request("https://x/", { method: "GET" }), deps as never); assert((await g.json()).ready === false, "GET reports not ready");
});

Deno.test("CORS: echoes an allowed Origin, falls back to 1linktrip.com otherwise, on every answer", async () => {
  const { admin } = fakeDb(); const deps = { admin, send: () => Promise.resolve(), ready: true };
  for (const [origin, want] of [["https://1linktrip.com", "https://1linktrip.com"], ["https://www.1linktrip.com", "https://www.1linktrip.com"], ["https://bbbot0209.github.io", "https://bbbot0209.github.io"], ["https://evil.example", "https://1linktrip.com"], [null, "https://1linktrip.com"]] as const) {
    for (const method of ["OPTIONS", "GET", "POST"]) {
      const h: Record<string, string> = origin ? { Origin: origin } : {};
      const r = await handler(new Request("https://x/functions/v1/notify", { method, headers: h, body: method === "POST" ? "{}" : undefined }), deps as never);
      await r.body?.cancel();
      assert(r.headers.get("Access-Control-Allow-Origin") === want, `${method} ${origin} → ${r.headers.get("Access-Control-Allow-Origin")}`);
      assert(r.headers.get("Vary") === "Origin", "Vary");
    }
  }
});

Deno.test("planner invite: owner only, resend after 10 min; household invite in its language, owner or planner", async () => {
  const db = fakeDb(); const sent: Mail[] = []; let now = Date.parse("2026-11-25T12:00:00Z");
  const deps = { admin: db.admin, ready: true, now: () => now, send: (m: Mail[]) => { sent.push(...m); return Promise.resolve(); } };
  const P1 = "00000000-0000-0000-0000-0000000000b9", HH = "00000000-0000-0000-0000-0000000000d9";
  db.t.page_planners = [{ id: P1, event_id: E, email: "ana@x.com", token: "a".repeat(32), user_id: null, accepted_at: null, notified_at: null }];
  db.t.events[0].config = { title: "Ana & Ben", lang: "en", langs: ["es"], tr: { es: { title: { h: 1, t: "Ana y Ben" } } } };
  db.t.guest_households = [{ id: HH, event_id: E, name: "The Garcias", email: "garcia@x.com", lang: "es", token: "b".repeat(24), notified_at: null }]; db.t.guest_people = [];
  assert((await call(X, { kind: "planner", id: P1 }, deps)).status === 403, "a stranger cannot send a planner invite");
  let r = await call(H, { kind: "planner", id: P1 }, deps);
  assert(r.j.sent === 1 && sent[0].to === "ana@x.com" && sent[0].text.includes("?e=w-abc12&p=" + "a".repeat(32)), "owner's invite carries the link: " + JSON.stringify(r.j));
  r = await call(H, { kind: "planner", id: P1 }, deps); assert(r.j.sent === 0 && r.j.skipped === "recently emailed", "a second tap sends nothing");
  now += 11 * 60 * 1000; r = await call(H, { kind: "planner", id: P1 }, deps); assert(r.j.sent === 1, "after 10 minutes it can go again");
  assert((await call(X, { kind: "household", id: HH }, deps)).status === 403, "a stranger cannot email a household");
  // X becomes an accepted planner
  db.t.page_planners.push({ id: "p2", event_id: E, email: "x@x.com", user_id: X, accepted_at: "y", token: "c".repeat(32) });
  r = await call(X, { kind: "household", id: HH }, deps);
  const m = sent[sent.length - 1];
  assert(r.j.sent === 1 && m.to === "garcia@x.com" && m.subject === "Invitación: Ana y Ben" && /Hola, The Garcias/.test(m.text) && m.text.includes("&g=" + "b".repeat(24) + "&lang=es"), "planner sends the household its link in Spanish: " + m.subject + " " + m.text);
  // greeting by first names (adults the organizer listed)
  db.t.guest_households[0].greeting = "names"; db.t.guest_people = [{ household_id: HH, name: "Michael Smith", age: "adult", added_by: "host" }, { household_id: HH, name: "Sarah Smith", age: "adult", added_by: "host" }, { household_id: HH, name: "Kid Smith", age: "child", added_by: "host" }];
  now += 11 * 60 * 1000; r = await call(X, { kind: "household", id: HH }, deps);
  assert(r.j.sent === 1 && /Hola, Michael y Sarah:/.test(sent[sent.length - 1].text), "first-name greeting: " + sent[sent.length - 1].text);
  db.t.events[0].published = false; now += 11 * 60 * 1000;
  r = await call(X, { kind: "household", id: HH }, deps); assert(r.j.sent === 0 && r.j.skipped === "page not shared", "no invitation for a hidden page");
});

Deno.test("a failed invite send gives the claim back", async () => {
  const db = fakeDb(); const P1 = "00000000-0000-0000-0000-0000000000b9";
  db.t.page_planners = [{ id: P1, event_id: E, email: "ana@x.com", token: "a".repeat(32), user_id: null, accepted_at: null, notified_at: null }];
  const deps = { admin: db.admin, ready: true, send: () => Promise.reject(new Error("Resend 403")) };
  const r = await call(H, { kind: "planner", id: P1 }, deps);
  assert(r.status === 502 && db.t.page_planners[0].notified_at === null, "send failed → notified_at back to null: " + JSON.stringify(db.t.page_planners[0]));
});
