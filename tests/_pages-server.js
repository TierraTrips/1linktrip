// A tiny stand-in for GitHub Pages, for tests that need its routing (python's http.server has none):
//   /            → index.html          /file.ext → the file
//   /name        → name.html if it exists (200), else 404.html with status 404 — like GitHub Pages
//   /dir/        → dir/index.html
// virtual: a Map name → html served as if <name>.html existed (tests add link-preview pages without touching the repo).
//   node tests/_pages-server.js [port]   (standalone; default 18766)
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
function start(port, virtual = new Map()) {
  const srv = http.createServer((req, res) => {
    let p; try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { p = '/'; }
    const send = (code, file, body) => { res.writeHead(code, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(body); };
    const file = (rel) => { const f = path.join(ROOT, rel); if (!f.startsWith(ROOT)) return null; try { return fs.statSync(f).isFile() ? f : null; } catch { return null; } };
    const name = p.replace(/^\//, '');
    if (virtual.has(name)) return send(200, 'x.html', virtual.get(name));
    const hit = p === '/' ? file('index.html') : p.endsWith('/') ? file(p + 'index.html') : file(p) || (path.extname(p) ? null : file(p + '.html'));
    if (hit) return send(200, hit, fs.readFileSync(hit));
    const nf = file('404.html'); return send(404, '404.html', nf ? fs.readFileSync(nf) : 'Not found');
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r(srv)));
}
module.exports = { start };
if (require.main === module) start(+process.argv[2] || 18766).then(() => console.log('pages server on ' + (+process.argv[2] || 18766)));
