// For tests written against the old Edit tab: the owner's page now opens on the page itself, with the page-wide editors
// (accordions, cards, document upload) in the Settings panel. This opens Settings once on every builder that appears, so
// those tests keep driving the same editors. Usage: require('./_open-settings')(browser) right after chromium.launch().
const SCRIPT = `(() => { const seen = new WeakSet(); const go = () => { const b = document.querySelector('.builder'); if (!b || seen.has(b)) return; seen.add(b); if (b.dataset.set !== '1') b.querySelector('.b-top [data-act="settings"]')?.click(); };
  new MutationObserver(go).observe(document, { childList: true, subtree: true }); })();`;
module.exports = (browser) => {
  const nc = browser.newContext.bind(browser);
  browser.newContext = async (...a) => { const c = await nc(...a); await c.addInitScript(SCRIPT); return c; };
  const np = browser.newPage.bind(browser);
  browser.newPage = async (...a) => { const p = await np(...a); await p.addInitScript(SCRIPT); return p; };
  return browser;
};
