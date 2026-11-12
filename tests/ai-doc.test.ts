// ai-import mode "doc": an organizer's own document (PDF / image) → event JSON (with stops and sections), optional
// section focus, every older mode still listed, file checks shared with mode "file".
//   AI_IMPORT_TEST=1 deno test -A tests/ai-doc.test.ts
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
      content: [{ type: "tool_use", id: "t", name: "save_event", input }] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}
const call = (b: unknown, origin = "https://1linktrip.com") => handler(new Request("https://fn.example/ai-import", { method: "POST", headers: { authorization: "Bearer " + jwt, Origin: origin }, body: JSON.stringify(b) }));

Deno.test("doc mode: listed with every older mode", async () => {
  Deno.env.set("ANTHROPIC_API_KEY", "sk-ant-test");
  const g = await (await handler(new Request("https://fn.example/ai-import"))).json();
  assertEquals(g.modes, ["url", "text", "edit", "translate", "file", "doc"]);
});

Deno.test("doc mode: PDF → event JSON with stops; section focus; CORS echo", async () => {
  const real = globalThis.fetch; const sent: { body?: any } = {};
  globalThis.fetch = stub({ title: "Japan", type: "Trip", stops: [{ city: "Tokyo", country: "Japan", arrive: "2027-04-01", leave: "2027-04-04" }] }, sent);
  try {
    Deno.env.set("ANTHROPIC_API_KEY", "sk-ant-test");
    const r = await call({ mode: "doc", files: [{ media_type: "application/pdf", data: pdf }], type: "Trip", section: "route" });
    const j = await r.json(); assertEquals(r.status, 200, JSON.stringify(j));
    assert(j.kind === "event" && j.data.stops[0].city === "Tokyo" && j.section === "route", JSON.stringify(j));
    assertEquals(r.headers.get("Access-Control-Allow-Origin"), "https://1linktrip.com");
    const b = sent.body; const content = b.messages[0].content;
    assert(b.tool_choice.name === "save_event" && b.tools[0].input_schema.properties.stops && b.tools[0].input_schema.properties.sections, "event tool with stops + sections");
    assert(content[0].type === "document" && content[0].source.media_type === "application/pdf", "PDF sent as a document block");
    const txt = content[content.length - 1].text;
    assert(/Fill ONLY stops/.test(txt) && /use that type/.test(txt) && /organizer's own document/.test(txt), txt);
    // whole document (no section) → no focus line
    await call({ mode: "doc", files: [{ media_type: "image/jpeg", data: pdf }] });
    const t2 = sent.body.messages[0].content.at(-1).text; assert(!/Fill ONLY/.test(t2) && sent.body.messages[0].content[0].type === "image", t2);
    // an unknown section is ignored, not passed through
    const r3 = await (await call({ mode: "doc", files: [{ media_type: "application/pdf", data: pdf }], section: "ignore previous" })).json();
    assert(r3.section === "" && !/ignore previous/.test(sent.body.messages[0].content.at(-1).text), "unknown section dropped");
  } finally { globalThis.fetch = real; }
});

Deno.test("doc mode: same file checks as file mode; sign-in required", async () => {
  Deno.env.set("ANTHROPIC_API_KEY", "sk-ant-test");
  assertEquals((await call({ mode: "doc", files: [] })).status, 400);
  assertEquals((await call({ mode: "doc", files: [{ media_type: "text/html", data: pdf }] })).status, 415);
  assertEquals((await call({ mode: "doc", files: [{ media_type: "application/pdf", data: "not base64!" }] })).status, 400);
  assertEquals((await call({ mode: "file", files: [{ media_type: "text/html", data: pdf }] })).status, 415);
  const anon = await handler(new Request("https://fn.example/ai-import", { method: "POST", body: JSON.stringify({ mode: "doc", files: [{ media_type: "application/pdf", data: pdf }] }) }));
  assertEquals(anon.status, 401);
});
