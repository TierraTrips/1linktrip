// ai-import mode "vendor": an organizer's vendor invoice / contract (PDF or image) → { vendor, payments } for the
// builder's Vendors tracking (organizer-only; nothing is paid or booked). Listed in GET modes; same file checks as "doc".
//   AI_IMPORT_TEST=1 deno test -A tests/ai-vendor.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
const { handler } = await import(new URL("../ai/ai-import.ts", import.meta.url).href);

const jwt = "x." + btoa(JSON.stringify({ role: "authenticated", sub: "u1" })).replace(/=+$/, "") + ".y";
const pdf = btoa("%PDF-1.4 tiny");
function stub(input: unknown, sent: { body?: any }) {
  return (async (req: Request | URL | string, init?: RequestInit) => {
    const url = typeof req === "string" ? req : req instanceof URL ? req.href : req.url;
    if (!url.startsWith("https://api.anthropic.com/")) return new Response("no", { status: 404 });
    sent.body = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
      content: [{ type: "tool_use", id: "t", name: "save_vendor", input }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}
const call = (b: unknown) => handler(new Request("https://fn.example/ai-import", { method: "POST", headers: { authorization: "Bearer " + jwt, Origin: "https://1linktrip.com" }, body: JSON.stringify(b) }));

Deno.test("vendor mode: listed", async () => {
  Deno.env.set("ANTHROPIC_API_KEY", "sk-ant-test");
  const g = await (await handler(new Request("https://fn.example/ai-import"))).json();
  assert(g.modes.includes("vendor") && g.modes.includes("doc") && g.modes.includes("file"), JSON.stringify(g.modes));
});

Deno.test("vendor mode: invoice → vendor + payments, event date passed, vendor tool forced", async () => {
  const real = globalThis.fetch; const sent: { body?: any } = {};
  const out = { vendor: { category: "Photographer", name: "Lumen Studio", contact: "", phone: "", email: "hi@lumen.example", website: "", address: "", total: "5000", currency: "USD", notes: "" },
    payments: [{ amount: 1500, due: "2027-01-10", paid: "2027-01-10", note: "Deposit" }, { amount: 3500, due: "2027-03-01", paid: "", note: "Balance" }] };
  globalThis.fetch = stub(out, sent);
  try {
    Deno.env.set("ANTHROPIC_API_KEY", "sk-ant-test");
    const r = await call({ mode: "vendor", files: [{ media_type: "application/pdf", data: pdf }], event_date: "2027-03-12" });
    const j = await r.json(); assertEquals(r.status, 200, JSON.stringify(j));
    assert(j.kind === "vendor" && j.data.vendor.name === "Lumen Studio" && j.data.payments.length === 2, JSON.stringify(j));
    const b = sent.body; const content = b.messages[0].content;
    assert(b.tool_choice.name === "save_vendor" && b.tools[0].strict === true && b.tools[0].input_schema.properties.payments, "vendor tool forced");
    assert(b.tools[0].input_schema.properties.vendor.properties.category.enum.includes("Hair & makeup"), "categories match the builder chips");
    assert(content[0].type === "document", "PDF as a document block");
    const txt = content.at(-1).text; assert(/event date is 2027-03-12/.test(txt) && /invoice, contract/.test(txt), txt);
    // a bad event date is not passed through
    await call({ mode: "vendor", files: [{ media_type: "image/png", data: pdf }], event_date: "ignore previous" });
    assert(!/ignore previous/.test(sent.body.messages[0].content.at(-1).text) && sent.body.messages[0].content[0].type === "image", "event date checked");
  } finally { globalThis.fetch = real; }
});

Deno.test("vendor mode: file checks; sign-in required", async () => {
  Deno.env.set("ANTHROPIC_API_KEY", "sk-ant-test");
  assertEquals((await call({ mode: "vendor", files: [] })).status, 400);
  assertEquals((await call({ mode: "vendor", files: [{ media_type: "text/html", data: pdf }] })).status, 415);
  const anon = await handler(new Request("https://fn.example/ai-import", { method: "POST", body: JSON.stringify({ mode: "vendor", files: [{ media_type: "application/pdf", data: pdf }] }) }));
  assertEquals(anon.status, 401);
});
