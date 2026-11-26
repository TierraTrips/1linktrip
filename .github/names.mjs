#!/usr/bin/env node
// Page names (https://1linktrip.com/<name>): writes the site files that serve them. Run by .github/workflows/names.yml
// (on every push to main and every few minutes); safe to run by hand: `node .github/names.mjs` from the site root.
//
//  404.html       GitHub Pages serves it for any path it doesn't have, with status 404: the app itself, so /<name> works the
//                 moment a name is chosen. Link previews get the generic 1LinkTrip card there.
//  <name>.html    one per name of a published page (current and old names): index.html with that page's title, description
//                 and cover image in <title> / og: / twitter: tags and <meta name="ep-page"> naming the page, so /<name> is
//                 served with status 200 and previews (iMessage, WhatsApp, Slack, Facebook…) show the page itself.
//                 Files this script made carry GEN_MARK; it removes those whose name is gone. It never touches other files.
//
// Reads only public data: rpc/page_names_public with the site's publishable key (published pages only). No secrets.
// Every value from a page is HTML-escaped; names and slugs are re-validated before they become file names.
// --json <file>: use that list instead of the network (tests).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SITE = 'https://1linktrip.com/';
const GEN_MARK = '<!-- ep-name-page: written by .github/names.mjs from index.html. Do not edit. -->';
const NAME_RE = /^(?!.*--)[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/;
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = (s) => String(s ?? '').replace(/\*\*|==|(^|\s)\*|\*(?=\s|$)/g, '$1').replace(/\s+/g, ' ').trim(); // the app's **bold** *italic* ==mark==
const clip = (s, n) => { s = plain(s); if (s.length <= n) return s; const cut = s.slice(0, n - 1); const at = cut.lastIndexOf(' '); return (at > n * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,.;:–—-]+$/, '') + '…'; };
function dateText(start, end) {
  const d = (x) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(x || ''); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
  const a = d(start), b = d(end); if (!a) return '';
  const f = (x, o) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...o }).format(x);
  if (!b || +b === +a) return f(a, { month: 'short', day: 'numeric', year: 'numeric' });
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${f(a, { month: 'short', day: 'numeric', year: 'numeric' })} – ${f(b, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  if (a.getUTCMonth() === b.getUTCMonth()) return `${f(a, { month: 'short', day: 'numeric' })} – ${f(b, { day: 'numeric' })}, ${a.getUTCFullYear()}`;
  return `${f(a, { month: 'short', day: 'numeric' })} – ${f(b, { month: 'short', day: 'numeric' })}, ${a.getUTCFullYear()}`;
}

export function page404(index) {
  // a path with a trailing slash or more segments: back to /<first segment> (relative asset paths need one segment)
  const fix = `<script>(function(){var p=location.pathname;if(/^\\/[^/]+\\/./.test(p)||/^\\/[^/]+\\/$/.test(p))location.replace('/'+p.split('/')[1]+location.search+location.hash);})();</script>`;
  return index.replace(/<head>\s*/, `<head>\n${fix}\n<meta name="robots" content="noindex">\n`);
}

export function namePage(index, r) {
  const title = clip(r.title, 120) || '1LinkTrip';
  const lead = clip(r.tagline, 160) || clip(r.description, 160);
  const when = [dateText(r.start_at, r.end_at), clip(r.place, 80)].filter(Boolean).join(' · ');
  const desc = clip([lead, when].filter(Boolean).join(' — '), 200) || 'One link for your guests’ whole trip.';
  const url = SITE + r.current_name;
  const img = /^https:\/\/[^\s"<>]+$/.test(r.image || '') ? r.image : SITE + 'icon-512.png';
  const tags = [
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="1LinkTrip">`,
    `<meta property="og:url" content="${esc(url)}">`,
    `<meta property="og:image" content="${esc(img)}">`,
    `<meta name="twitter:card" content="${r.image ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<meta name="twitter:image" content="${esc(img)}">`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<meta name="ep-page" content="${esc(r.slug)}" data-name="${esc(r.name)}" data-current="${esc(r.current_name)}">`,
  ].join('\n');
  let h = index;
  h = h.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)} · 1LinkTrip</title>`);
  h = h.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(desc)}">`);
  h = h.replace(/<meta property="og:title"[^>]*>\s*/, '').replace(/<meta property="og:description"[^>]*>\s*/, '');
  h = h.replace(/(<meta name="description"[^>]*>)/, `$1\n${tags}`);
  return GEN_MARK + '\n' + h;
}

async function names() {
  const j = arg('--json'); if (j) return JSON.parse(fs.readFileSync(j, 'utf8'));
  const cfg = fs.readFileSync(path.join(ROOT, 'supabase-config.js'), 'utf8');
  const m = /window\.EP_SUPABASE\s*=\s*(\{[^;]*\})/.exec(cfg); if (!m) throw new Error('supabase-config.js: no EP_SUPABASE');
  const { url, key } = JSON.parse(m[1]);
  const r = await fetch(`${url}/rest/v1/rpc/page_names_public`, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, body: '{}' });
  if (!r.ok) throw new Error(`page_names_public ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const writeIf = (f, s) => { const p = path.join(ROOT, f); if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === s) return false; fs.writeFileSync(p, s); return true; };

async function main() {
  const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  if (index.startsWith(GEN_MARK)) throw new Error('index.html looks generated');
  const out = [];
  if (writeIf('404.html', page404(index))) out.push('404.html');
  const rows = (await names()).filter(r => r && NAME_RE.test(r.name || '') && NAME_RE.test(r.current_name || '') && SLUG_RE.test(r.slug || ''));
  const keep = new Set();
  for (const r of rows) {
    const f = r.name + '.html';
    if (fs.existsSync(path.join(ROOT, f)) && !fs.readFileSync(path.join(ROOT, f), 'utf8').startsWith(GEN_MARK)) { console.warn(`skip ${f}: a site file of that name exists`); continue; }
    if (fs.existsSync(path.join(ROOT, r.name)) && fs.statSync(path.join(ROOT, r.name)).isDirectory()) { console.warn(`skip ${r.name}: a site folder of that name exists`); continue; }
    keep.add(f); if (writeIf(f, namePage(index, r))) out.push(f);
  }
  for (const f of fs.readdirSync(ROOT)) {
    if (!f.endsWith('.html') || keep.has(f) || f === 'index.html' || f === '404.html') continue;
    const p = path.join(ROOT, f); if (!fs.statSync(p).isFile()) continue;
    if (fs.readFileSync(p, 'utf8').startsWith(GEN_MARK)) { fs.unlinkSync(p); out.push('-' + f); }
  }
  console.log(`${rows.length} names; changed: ${out.length ? out.join(' ') : 'nothing'}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.message || e); process.exit(1); });
