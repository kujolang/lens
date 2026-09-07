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

const { Timings, launchBrowser, withDeadline, closeContext } = require('./runtime');
const { observeReadiness } = require('./readiness');

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
  // Form values may be credentials; only button labels are selector evidence.
  function controlText(el) {
    if (el.tagName === 'INPUT') return /^(button|submit|reset)$/i.test(el.type || '') ? (el.value || '') : '';
    if (el.tagName === 'TEXTAREA' || el.isContentEditable) return '';
    return el.innerText || '';
  }
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
    const txt = (controlText(el) || '').trim().replace(/\s+/g, ' ').slice(0, 40);
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
    const text = (controlText(el) || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 80);
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
  const timings = new Timings();
  timings.values.process_boot_ms = process.uptime() * 1000;
  const timeoutMs = opts.timeout * 1000;
  const result = { url: opts.url, final_url: opts.url, started_at: nowISO(), title: '', elements: [], error: null };

  let browser = null, context = null, readiness = null;
  try {
    await timings.measure('runtime_load_ms', async () => require('playwright-core'));
    browser = await timings.measure('browser_launch_ms', () => launchBrowser());
    context = await timings.measure('context_create_ms', () => browser.newContext({ viewport: { width: 1440, height: 900 } }), timeoutMs);
    const page = await timings.measure('page_create_ms', () => context.newPage(), timeoutMs);
    readiness = await withDeadline(() => observeReadiness(page), timeoutMs);
    try {
      await timings.measure('navigation_ms', () => page.goto(opts.url, { waitUntil: 'load', timeout: timeoutMs }));
      result.readiness = await timings.measure('readiness_ms', () => readiness.wait({ timeoutMs }));
    } catch (err) { result.error = 'navigation: ' + err.message; }
    try { result.final_url = page.url(); result.title = await withDeadline(() => page.title(), timeoutMs); } catch (_) {}
    try { result.elements = await timings.measure('dom_capture_ms', () => page.evaluate(COLLECT, opts.maxElements), timeoutMs); } catch (err) { result.error = 'collect: ' + err.message; }
  } catch (err) {
    result.error = 'launch: ' + err.message;
  } finally {
    if (readiness) readiness.dispose();
    if (context) result.context_cleanup_failed = !(await closeContext(context));
    if (browser) await timings.measure('browser_close_ms', () => browser.close().catch(() => {}));
  }

  result.timings = timings.finish();
  result.finished_at = nowISO();
  process.stdout.write(JSON.stringify(result));
  process.exitCode = result.elements.length > 0 || !result.error ? 0 : 1;
}

if (require.main === module) {
  main().catch((err) => { console.error('Inspect bridge fatal: ' + err.message); process.exit(1); });
} else {
  module.exports = { parseArgs, COLLECT };
}
