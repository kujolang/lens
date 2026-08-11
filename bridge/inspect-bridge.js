#!/usr/bin/env node
/**
 * inspect-bridge.js — Lens selector-discovery bridge.
 *
 * Loads a URL in headless Chromium and dumps the page's interactive elements
 * (buttons, links, inputs, modal triggers, …) with a SUGGESTED selector and
 * visible text for each, so an author (human or AI agent) can write accurate
 * flow steps instead of guessing selectors. Read-only: it never clicks, types,
 * or mutates anything.
 *
 * Usage: node inspect-bridge.js --url <url> --timeout <seconds>
 * Output: JSON to stdout.
 */

const { chromium } = require('playwright-core');

function nowISO() { return new Date().toISOString(); }

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { url: '', timeout: 30, maxElements: 250 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url') opts.url = args[++i] || '';
    else if (args[i] === '--timeout') opts.timeout = parseInt(args[++i], 10) || 30;
    else if (args[i] === '--max-elements') opts.maxElements = parseInt(args[++i], 10) || 250;
  }
  return opts;
}

// Collected in the page context. Returns an array of element descriptors with
// a best-effort stable selector and a kind classification.
const COLLECT = (maxElements) => {
  const esc = (s) => String(s).replace(/(["\\])/g, '\\$1');
  function suggest(el) {
    if (el.id) return '#' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id);
    const testAttr = ['data-testid', 'data-test', 'data-cy'].find((name) => el.hasAttribute(name));
    if (testAttr) return '[' + testAttr + '="' + esc(el.getAttribute(testAttr)) + '"]';
    const al = el.getAttribute('aria-label');
    if (al) return '[aria-label="' + esc(al) + '"]';
    const tag = el.tagName.toLowerCase();
    if (tag === 'a' && el.getAttribute('href')) return 'a[href="' + esc(el.getAttribute('href')) + '"]';
    const nm = el.getAttribute('name');
    if (nm && /^(input|select|textarea|button)$/.test(tag)) return tag + '[name="' + esc(nm) + '"]';
    const ph = el.getAttribute('placeholder');
    if (ph && /^(input|textarea)$/.test(tag)) return tag + '[placeholder="' + esc(ph) + '"]';
    const txt = (el.innerText || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (txt) return tag + ':has-text("' + esc(txt) + '")';
    return tag;
  }
  function kindOf(el) {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (el.hasAttribute('aria-haspopup') || el.getAttribute('data-toggle') === 'modal' || el.hasAttribute('data-modal')) return 'modal-trigger';
    if (tag === 'button' || role === 'button' || (tag === 'input' && /^(button|submit|reset)$/i.test(el.type || ''))) return 'button';
    if (tag === 'a' || role === 'link') return 'link';
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    if (tag === 'input') return 'input:' + (el.type || 'text');
    if (role === 'menuitem' || role === 'tab' || role === 'checkbox' || role === 'switch') return role;
    return tag;
  }
  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  }

  const sel = 'a[href], button, input, select, textarea, [role=button], [role=link], [role=menuitem], [role=tab], [role=checkbox], [role=switch], [aria-haspopup], [data-toggle], [data-modal], summary, label[for]';
  const nodes = Array.from(document.querySelectorAll(sel));
  const out = [];
  const seen = new Set();
  for (const el of nodes) {
    if (out.length >= maxElements) break;
    if (!visible(el)) continue;
    const selector = suggest(el);
    const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const key = kindOf(el) + '|' + selector + '|' + text;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: kindOf(el),
      text: text,
      selector: selector,
      href: el.tagName.toLowerCase() === 'a' ? (el.getAttribute('href') || '') : '',
      opens_modal: el.hasAttribute('aria-haspopup') || el.getAttribute('data-toggle') === 'modal' || el.hasAttribute('data-modal'),
    });
  }
  return out;
};

async function main() {
  const opts = parseArgs();
  if (!opts.url) { console.error('Error: --url is required'); process.exit(1); }
  const timeoutMs = opts.timeout * 1000;
  const result = { url: opts.url, final_url: opts.url, started_at: nowISO(), title: '', elements: [], error: null };

  let browser = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    try {
      await page.goto(opts.url, { waitUntil: 'load', timeout: timeoutMs });
      try { await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 3500) }); } catch (_) {}
    } catch (err) { result.error = 'navigation: ' + err.message; }
    try { result.final_url = page.url(); result.title = await page.title(); } catch (_) {}
    try { result.elements = await page.evaluate(COLLECT, opts.maxElements); } catch (err) { result.error = 'collect: ' + err.message; }
  } catch (err) {
    result.error = 'launch: ' + err.message;
  } finally {
    if (browser) { try { await browser.close(); } catch (_) {} }
  }

  result.finished_at = nowISO();
  process.stdout.write(JSON.stringify(result));
  process.exit(result.elements.length > 0 || !result.error ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => { console.error('Inspect bridge fatal: ' + err.message); process.exit(1); });
} else {
  module.exports = { parseArgs, COLLECT };
}
