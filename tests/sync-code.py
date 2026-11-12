#!/usr/bin/env python3
"""Fill every <textarea data-src="relative/path"> in the copy-paste pages with that file, HTML-escaped,
so a page's Copy button always hands out exactly the source in the repo.
  python3 tests/sync-code.py          rewrite the pages
  python3 tests/sync-code.py --check  exit 1 if any page is out of date (run before committing a .ts/.sql change)"""
import html, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGES = ["setup/index.html", "ai/index.html", "ai/notify.html"]
TA = re.compile(r'(<textarea\b[^>]*\bdata-src="([^"]+)"[^>]*>)(.*?)(</textarea>)', re.S)
esc = lambda s: s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")

stale = []
for rel in PAGES:
    page = ROOT / rel
    text = page.read_text()
    def fill(m):
        src = (page.parent / m.group(2)).resolve().read_text()
        return m.group(1) + esc(src) + m.group(4)
    new, n = TA.subn(fill, text)
    for m in TA.finditer(new):  # round-trip: what the browser's .value will be == the file
        assert html.unescape(m.group(3)) == (page.parent / m.group(2)).resolve().read_text(), (rel, m.group(2))
    if new != text:
        stale.append(rel)
        if "--check" not in sys.argv: page.write_text(new)
    print(f"{rel}: {n} code block(s){' (updated)' if new != text and '--check' not in sys.argv else ' (STALE)' if new != text else ''}")
if "--check" in sys.argv and stale: sys.exit(1)
