// "Ask AI to edit" against the real model: runs ai-import mode "edit" (this repo's handler, locally) for a set of
// instructions on a sample Japan trip and writes the model's changes for tests/ai-edit-check.mjs, which applies them
// with the page's own validator (planEdits) and checks the result.
//   ANTHROPIC_API_KEY=… AI_IMPORT_TEST=1 deno run -A tests/ai-edit-live.ts /tmp/aiedit/out.json [runs]
const { handler } = await import(new URL("../ai/ai-import.ts", import.meta.url).href);
import { PAGE, PROMPTS } from "./ai-edit-cases.mjs";
const jwt = "x." + btoa(JSON.stringify({ role: "authenticated", sub: "u1" })).replace(/=+$/, "") + ".y";
const runs = +(Deno.args[1] || 2); const out: unknown[] = [];
for (const [id, instruction] of PROMPTS) for (let r = 0; r < runs; r++) {
  const res = await handler(new Request("https://fn.example/ai-import", { method: "POST", headers: { authorization: "Bearer " + jwt, Origin: "https://1linktrip.com" }, body: JSON.stringify({ mode: "edit", page: PAGE, instruction }) }));
  const j = await res.json(); out.push({ id, instruction, run: r, status: res.status, data: j.data || null, error: j.error || null });
  console.log(id, r, res.status, j.data ? JSON.stringify(j.data.changes).slice(0, 300) : j.error);
}
await Deno.writeTextFile(Deno.args[0], JSON.stringify(out, null, 1));
