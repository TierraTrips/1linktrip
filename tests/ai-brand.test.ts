// ai-import mode "brand": a site's colors, fonts and logo from its HTML + stylesheets, no model call; signed-in only.
//   AI_IMPORT_TEST=1 deno test -A tests/ai-brand.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
const { handler, brandFromSources, cssColor } = await import(new URL("../ai/ai-import.ts", import.meta.url).href);

const HTML = `<!doctype html><html><head><meta name="theme-color" content="#5B2A86"><meta property="og:image" content="/og.jpg">
<link rel="stylesheet" href="/site.css"><link rel="apple-touch-icon" sizes="180x180" href="/touch.png">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Inter&display=swap" rel="stylesheet">
<style>:root{--brand-primary:#5b2a86;--text-on-primary:#fff}</style></head>
<body><header><a href="/"><img src="/img/acme-logo.svg" alt="Acme"></a></header>
<section class="partners"><img class="logo" src="/img/client-logos.png" alt="Our clients"></section>
<img src="/hero.jpg" alt="An aerial view imitating the Acme logo" width="2400" height="1000"></body></html>`;
const CSS = `body{background-color:#FFFDF8;color:rgb(34, 34, 34);font-family:"Playfair Display",Georgia,serif}
.btn{background:#5B2A86;color:#fff}.btn:hover{background:hsl(272, 52%, 30%)}a{color:var(--brand-primary)}
.badge{border:1px solid rgba(0,0,0,.1)}.x{color:var(--hds-color-orange-500)}h1{font-family:var(--font-display), 'Inter', sans-serif}
.icon{font-family:"Font Awesome 6 Free"}.y{--font-weight-bold:700;--font-size-lg:1.2rem}`;

Deno.test("cssColor reads hex / rgb / hsl / named, drops see-through", () => {
  assertEquals(cssColor("#abc"), "#aabbcc"); assertEquals(cssColor("rgb(91, 42, 134)"), "#5b2a86"); assertEquals(cssColor("rgba(0,0,0,.1)"), "");
  assertEquals(cssColor("hsl(0, 100%, 50%)"), "#ff0000"); assertEquals(cssColor("#5b2a8633"), ""); assertEquals(cssColor("white"), "#ffffff"); assertEquals(cssColor("var(--x)"), "");
});
Deno.test("brandFromSources: theme color, brand vars, page colors, fonts, own logo", () => {
  const b = brandFromSources(HTML, "https://acme.example/", [CSS]);
  assertEquals(b.themeColor, "#5b2a86"); assertEquals(b.background, "#fffdf8"); assertEquals(b.text, "#222222");
  assertEquals(b.colors[0].hex, "#5b2a86"); assert(b.vars.some((v: { name: string }) => v.name === "--brand-primary"));
  assert(!b.colors.some((c: { hex: string }) => c.hex === "#ffa500"), "a color word inside var() is not a color");
  assertEquals(b.fonts[0], "Playfair Display"); assert(b.fonts.includes("Inter")); assert(!b.fonts.some((f: string) => /awesome|^\d/i.test(f)), "no icon fonts or sizes");
  assertEquals(b.logo, "https://acme.example/img/acme-logo.svg"); assertEquals(b.icon, "https://acme.example/touch.png"); assertEquals(b.image, "https://acme.example/og.jpg");
});
Deno.test("brand mode over HTTP: signed in only, reads page + stylesheet, lists the mode, keeps CORS", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async (req: Request | URL | string) => {
    const url = typeof req === "string" ? req : req instanceof URL ? req.href : req.url;
    if (url === "https://acme.example/") return new Response(HTML, { status: 200, headers: { "content-type": "text/html" } });
    if (url === "https://acme.example/site.css") return new Response(CSS, { status: 200, headers: { "content-type": "text/css" } });
    return new Response("no", { status: 404 });
  }) as typeof fetch;
  Deno.env.set("ANTHROPIC_API_KEY", "sk-ant-test");
  const jwt = (p: unknown) => "Bearer x." + btoa(JSON.stringify(p)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_") + ".y";
  const call = (b: unknown, auth = jwt({ role: "authenticated", sub: "u1" })) => handler(new Request("https://fn.example/ai-import", { method: "POST", headers: { authorization: auth, Origin: "https://1linktrip.com" }, body: JSON.stringify(b) }));
  try {
    const r = await call({ mode: "brand", url: "https://acme.example/" }); const j = await r.json();
    assertEquals(r.status, 200); assertEquals(j.kind, "brand"); assertEquals(j.data.themeColor, "#5b2a86"); assertEquals(j.data.fonts[0], "Playfair Display");
    assertEquals(r.headers.get("access-control-allow-origin"), "https://1linktrip.com");
    assertEquals((await call({ mode: "brand", url: "https://acme.example/" }, "Bearer sb_publishable_x")).status, 401);
    assertEquals((await call({ mode: "brand", url: "http://127.0.0.1/" })).status, 400);
    assertEquals((await call({ mode: "brand", url: "https://nothing.example/" })).status, 422);
    const g = await (await handler(new Request("https://fn.example/ai-import", { headers: { Origin: "https://www.1linktrip.com" } }))).json();
    assert(g.modes.includes("brand") && ["url", "text", "edit", "translate", "file", "doc"].every((m: string) => g.modes.includes(m)));
  } finally { globalThis.fetch = real; }
});
