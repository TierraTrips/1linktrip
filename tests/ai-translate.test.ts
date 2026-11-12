// ai-import mode "translate" without signing in (guests switching language): allowed, capped per request (40k chars)
// and per address (30 per 10 min); every other mode still needs a signed-in user.
//   AI_IMPORT_TEST=1 deno test -A tests/ai-translate.test.ts
import { assertEquals } from "jsr:@std/assert@1";
const { handler } = await import(new URL("../ai/ai-import.ts", import.meta.url).href);
const stub = (() => (async (req: Request | URL | string) => {
  const url = typeof req === "string" ? req : req instanceof URL ? req.href : req.url;
  if (!url.startsWith("https://api.anthropic.com/")) return new Response("no", { status: 404 });
  return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "x", stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    content: [{ type: "tool_use", id: "t", name: "save_translations", input: { translations: [{ key: "title", text: "Japón en primavera" }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch)();
const call = (b: unknown, ip = "1.1.1.1", auth = "Bearer sb_publishable_x") => handler(new Request("https://fn.example/ai-import", { method: "POST", headers: { authorization: auth, "x-forwarded-for": ip, Origin: "https://1linktrip.com" }, body: typeof b === "string" ? b : JSON.stringify(b) }));
Deno.test("translate works without signing in; other modes don't", async () => {
  Deno.env.set("ANTHROPIC_API_KEY", "sk-ant-test"); const real = globalThis.fetch; globalThis.fetch = stub;
  try {
    const r = await call({ mode: "translate", fields: { title: "Japan in spring" }, target: "es" }); const j = await r.json();
    assertEquals(r.status, 200); assertEquals(j.data.translations[0].text, "Japón en primavera");
    assertEquals(r.headers.get("access-control-allow-origin"), "https://1linktrip.com");
    assertEquals((await call({ mode: "edit", page: {}, instruction: "x" })).status, 401);
    assertEquals((await call({ text: "hello" })).status, 401);
    assertEquals((await call({ mode: "translate", fields: { a: "x".repeat(41_000) }, target: "es" }, "2.2.2.2")).status, 413);
    let last = 0; for (let i = 0; i < 31; i++) last = (await call({ mode: "translate", fields: { title: "Hi" }, target: "ja" }, "3.3.3.3")).status;
    assertEquals(last, 429);
  } finally { globalThis.fetch = real; }
});
