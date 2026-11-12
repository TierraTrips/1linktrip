// Applies the model's edits from tests/ai-edit-live.ts with the page's own validator (planEdits) and checks each
// instruction's result; prints the pass rate and a preview screenshot of a removal.
//   python3 -m http.server 18765 --bind 127.0.0.1 &  node tests/ai-edit-check.mjs /tmp/aiedit/out.json
import { createRequire } from 'module'; import fs from 'fs';
import { PAGE, CHECKS } from './ai-edit-cases.mjs';
const require = createRequire(import.meta.url); const { chromium } = require(process.env.PW || 'playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:18765/';
const out = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const browser = await chromium.launch(); const page = await (await browser.newContext({ serviceWorkers: 'block' })).newPage();
await page.goto(BASE); await page.waitForFunction(() => window.__ep);
let pass = 0; const byId = {};
for (const r of out) {
  let ok = false, why = r.error || '';
  if (r.data) {
    const plan = await page.evaluate(([p, ch]) => { const x = window.__ep.planEdits(window.__ep.unpackEvent(window.__ep.packEvent(p)), ch); return { next: x.next, rows: x.rows, rejected: x.rejected }; }, [PAGE, r.data.changes]);
    ok = CHECKS[r.id](plan.next); why = ok ? '' : `rows ${JSON.stringify(plan.rows).slice(0, 400)} rejected ${JSON.stringify(plan.rejected)}`;
  }
  pass += ok; (byId[r.id] = byId[r.id] || []).push(ok);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.id}#${r.run} ${r.instruction}${why ? ' — ' + why : ''}`);
}
console.log(`\npass rate ${pass}/${out.length}`); Object.entries(byId).forEach(([k, v]) => console.log(`  ${k}: ${v.filter(Boolean).length}/${v.length}`));
await browser.close(); process.exit(pass === out.length ? 0 : 1);
