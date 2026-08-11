#!/usr/bin/env node
/**
 * browser-bridge.js — Lens browser automation bridge.
 *
 * Minimal Playwright-based bridge that captures browser runtime evidence
 * for the Kujo Lens tool. All orchestration, config, artifact writing,
 * reporting, redaction, and checks live in Kujo. This bridge only handles
 * the browser interaction that Kujo cannot do natively.
 *
 * Usage:
 *   node browser-bridge.js \
 *     --url <url> \
 *     --viewports desktop,mobile \
 *     --timeout <seconds> \
 *     --screenshot-dir <path> \
 *     --format json
 *
 * Output: JSON to stdout.
 * Exit codes: 0 on success, 1 on bridge/runtime error.
 */

const { chromium, firefox, webkit } = require('playwright');
const fs = require('fs');
const path = require('path');

// ── CLI argument parsing ──────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    url: '',
    viewports: ['desktop', 'mobile'],
    timeout: 30,
    screenshotDir: '',
    format: 'json',
    accessibility: false,
    a11yTags: [],
    a11yInclude: '',
    a11yExclude: '',
    settleMs: 400,
    maxConcurrency: 0,
    browser: 'chromium',
    throttle: '',
    device: '',
    perf: false,
    authFile: '',
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--url':
        opts.url = args[++i] || '';
        break;
      case '--viewports':
        opts.viewports = (args[++i] || 'desktop,mobile').split(',').map(v => v.trim()).filter(Boolean);
        break;
      case '--timeout':
        opts.timeout = parseInt(args[++i], 10) || 30;
        break;
      case '--screenshot-dir':
        opts.screenshotDir = args[++i] || '';
        break;
      case '--format':
        opts.format = args[++i] || 'json';
        break;
      case '--accessibility':
        opts.accessibility = true;
        break;
      case '--a11y-tags':
        opts.a11yTags = (args[++i] || '').split(',').map(v => v.trim()).filter(Boolean);
        break;
      case '--a11y-include':
        opts.a11yInclude = args[++i] || '';
        break;
      case '--a11y-exclude':
        opts.a11yExclude = args[++i] || '';
        break;
      case '--settle-ms': {
        const v = parseInt(args[++i], 10);
        opts.settleMs = Number.isFinite(v) && v >= 0 ? v : 400;
        break;
      }
      case '--max-concurrency': {
        const v = parseInt(args[++i], 10);
        opts.maxConcurrency = Number.isFinite(v) && v > 0 ? v : 0;
        break;
      }
      case '--browser': {
        const b = (args[++i] || 'chromium').toLowerCase();
        opts.browser = ['chromium', 'firefox', 'webkit'].includes(b) ? b : 'chromium';
        break;
      }
      case '--throttle':
        opts.throttle = (args[++i] || '').toLowerCase();
        break;
      case '--device':
        opts.device = args[++i] || '';
        break;
      case '--perf':
        opts.perf = true;
        break;
      case '--auth-file':
        opts.authFile = args[++i] || '';
        break;
    }
  }

  return opts;
}

// Network throttle profiles (CDP Network.emulateNetworkConditions units).
// Chromium-only; other engines ignore throttling (reported in metadata).
const THROTTLE_PROFILES = {
  'slow-3g': { downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8, latency: 400 },
  '3g': { downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8, latency: 150 },
  '4g': { downloadThroughput: (4 * 1024 * 1024) / 8, uploadThroughput: (3 * 1024 * 1024) / 8, latency: 20 },
};

// Collect performance metrics from the page (Phase 2.1). Uses buffered
// Performance entries; any unavailable metric (engine-dependent) is null.
// Never throws — returns a best-effort object.
async function collectMetrics(page) {
  try {
    return await page.evaluate(() => {
      const out = { ttfb_ms: null, dom_content_loaded_ms: null, load_event_ms: null, fcp_ms: null, lcp_ms: null, cls: null };
      const nav = performance.getEntriesByType('navigation')[0];
      if (nav) {
        out.ttfb_ms = Math.round(nav.responseStart);
        out.dom_content_loaded_ms = Math.round(nav.domContentLoadedEventEnd);
        out.load_event_ms = Math.round(nav.loadEventEnd);
      }
      const fcp = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint');
      if (fcp) out.fcp_ms = Math.round(fcp.startTime);
      try {
        const lcps = performance.getEntriesByType('largest-contentful-paint');
        if (lcps && lcps.length) out.lcp_ms = Math.round(lcps[lcps.length - 1].startTime);
      } catch (_) { /* unsupported */ }
      try {
        const shifts = performance.getEntriesByType('layout-shift');
        if (shifts && shifts.length) {
          let cls = 0;
          for (const s of shifts) { if (!s.hadRecentInput) cls += s.value; }
          out.cls = Math.round(cls * 1000) / 1000;
        }
      } catch (_) { /* unsupported */ }
      return out;
    });
  } catch (_) {
    return { ttfb_ms: null, dom_content_loaded_ms: null, load_event_ms: null, fcp_ms: null, lcp_ms: null, cls: null };
  }
}

// Resolve a viewport token to { name, width, height }. Accepts the presets
// "desktop"/"mobile" and custom "<width>x<height>" tokens (e.g. "1024x768").
// Unknown tokens fall back to desktop dimensions but keep their name.
function resolveViewport(token) {
  const preset = VIEWPORT_SIZES[token];
  if (preset) return { name: token, width: preset.width, height: preset.height };
  const m = /^(\d+)x(\d+)$/.exec(String(token).toLowerCase());
  if (m) return { name: token, width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
  return { name: token, width: VIEWPORT_SIZES.desktop.width, height: VIEWPORT_SIZES.desktop.height };
}

// Run an array of async task factories with a bounded concurrency. Results are
// returned in input order (deterministic), regardless of completion order.
// A limit of 0 (or >= the task count) means "all at once".
async function mapWithConcurrency(items, limit, factory) {
  const results = new Array(items.length);
  const effective = !limit || limit >= items.length ? items.length : limit;
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await factory(items[idx], idx);
    }
  }
  const workers = [];
  for (let w = 0; w < effective; w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

// ── Accessibility scan (axe-core) ─────────────────────────────────────

// Run an axe-core accessibility scan in the page context. Returns a
// structured result. Degrades gracefully (engine_available: false) when
// axe-core is not installed or injection fails, so the run never crashes.
async function runAxeScan(page, opts) {
  let axeSource;
  let axeVersion;
  try {
    axeSource = require('axe-core').source;
    axeVersion = require('axe-core/package.json').version;
  } catch (err) {
    return { engine_available: false, error: 'axe-core not installed: ' + err.message };
  }

  try {
    await page.evaluate(axeSource);
    const axeResult = await page.evaluate(async (cfg) => {
      const runOptions = {};
      if (cfg.tags && cfg.tags.length) {
        runOptions.runOnly = { type: 'tag', values: cfg.tags };
      }
      let context;
      if (cfg.include && cfg.exclude) {
        context = { include: [cfg.include], exclude: [cfg.exclude] };
      } else if (cfg.include) {
        context = cfg.include;
      } else if (cfg.exclude) {
        context = { exclude: [cfg.exclude] };
      } else {
        context = document;
      }
      // eslint-disable-next-line no-undef
      return await axe.run(context, runOptions);
    }, { tags: opts.a11yTags, include: opts.a11yInclude, exclude: opts.a11yExclude });

    // Map to a compact, privacy-safe shape. We deliberately do NOT include
    // node.html (which can contain rendered secrets); only CSS-selector
    // targets and counts are retained.
    const violations = (axeResult.violations || []).map((v) => ({
      id: v.id,
      impact: v.impact || 'moderate',
      description: v.description || '',
      help: v.help || '',
      help_url: v.helpUrl || '',
      tags: v.tags || [],
      node_count: (v.nodes || []).length,
      targets: (v.nodes || []).slice(0, 5).map((n) => (n.target || []).join(' ')),
    }));

    return {
      engine_available: true,
      engine: 'axe-core',
      version: axeVersion,
      violations,
      passes_count: (axeResult.passes || []).length,
      incomplete_count: (axeResult.incomplete || []).length,
      inapplicable_count: (axeResult.inapplicable || []).length,
    };
  } catch (err) {
    return { engine_available: false, error: 'axe-core scan failed: ' + err.message };
  }
}

// ── Viewport dimensions ───────────────────────────────────────────────

const VIEWPORT_SIZES = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

// ── Helpers ───────────────────────────────────────────────────────────

function nowISO() {
  return new Date().toISOString();
}

function formatMs(ms) {
  return Math.round(ms);
}

// Collect visible anchors only. This lives outside captureViewport so the DOM
// behavior can be exercised directly in bridge regression tests.
const COLLECT_LINKS = () => {
  const anchorNodes = document.querySelectorAll('a[href]');
  const results = [];
  for (const a of anchorNodes) {
    const style = getComputedStyle(a);
    if (style.display === 'none' || style.visibility === 'hidden' || a.getClientRects().length === 0) continue;
    const href = a.getAttribute('href') || '';
    const text = (a.textContent || '').trim().substring(0, 200);
    const title = (a.getAttribute('title') || '').trim().substring(0, 200);
    const ariaLabel = (a.getAttribute('aria-label') || '').trim().substring(0, 200);
    results.push({ href, text, title, aria_label: ariaLabel });
  }
  return results;
};

// ── Main capture logic per viewport ───────────────────────────────────

async function captureViewport(browser, url, viewportName, timeoutMs, screenshotDir, opts) {
  const size = resolveViewport(viewportName);

  // Build context options. A device descriptor (Phase 2.2) sets its own
  // viewport/userAgent; otherwise we use the requested viewport size.
  const contextOptions = {};
  const { devices } = require('playwright');
  if (opts && opts.device && devices[opts.device]) {
    Object.assign(contextOptions, devices[opts.device]);
  } else {
    contextOptions.viewport = { width: size.width, height: size.height };
  }
  // Auth-gated runs (Phase 2.4): load a Playwright storage-state file into the
  // context. Opt-in only. The contents stay inside Playwright — never logged,
  // never written to any Lens artifact.
  if (opts && opts.authFile) {
    contextOptions.storageState = opts.authFile;
  }

  const context = await browser.newContext(contextOptions);

  const page = await context.newPage();

  // Network throttling (Phase 2.2) — Chromium/CDP only. Other engines ignore
  // it (reported in metadata). Applied to the page we actually navigate.
  if (opts && opts.throttle && THROTTLE_PROFILES[opts.throttle] && opts.browser === 'chromium') {
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', { offline: false, ...THROTTLE_PROFILES[opts.throttle] });
    } catch (_) { /* throttling is best-effort */ }
  }

  // Collect console messages
  const consoleMessages = [];
  page.on('console', (msg) => {
    const entry = {
      type: msg.type(),
      text: msg.text(),
      timestamp: nowISO(),
      viewport: viewportName,
    };
    // Capture location if available
    const loc = msg.location();
    if (loc && loc.url) {
      entry.location = `${loc.url}:${loc.lineNumber || 0}:${loc.columnNumber || 0}`;
    }
    consoleMessages.push(entry);
  });

  // Collect network events (only failures and HTTP errors)
  const networkEvents = [];
  page.on('response', (response) => {
    const status = response.status();
    // Capture 4xx and 5xx responses
    if (status >= 400) {
      networkEvents.push({
        url: response.url(),
        method: response.request().method(),
        status: status,
        status_text: response.statusText(),
        resource_type: response.request().resourceType(),
        timestamp: nowISO(),
        viewport: viewportName,
      });
    }
  });

  page.on('requestfailed', (request) => {
    networkEvents.push({
      url: request.url(),
      method: request.method(),
      status: null,
      failure_text: request.failure()?.errorText || 'Unknown failure',
      resource_type: request.resourceType(),
      timestamp: nowISO(),
      viewport: viewportName,
    });
  });

  // Navigate
  let finalUrl = url;
  let navigationError = null;
  try {
    const response = await page.goto(url, {
      waitUntil: 'load',
      timeout: timeoutMs,
    });
    finalUrl = page.url();
  } catch (err) {
    navigationError = err.message;
  }

  // Phase 1.2: event-driven readiness. Wait for the network to go idle so we
  // capture late console/network events on real apps without paying a flat
  // delay on fast pages. The wait is capped well below the page timeout:
  // sites with analytics/long-polling never go idle, and waiting the full
  // timeout there can exceed the runtime's process-spawn limit (a real failure
  // seen on heavy public sites). A few seconds is plenty to settle.
  if (!navigationError) {
    const idleCap = Math.min(timeoutMs, 3500);
    try {
      await page.waitForLoadState('networkidle', { timeout: idleCap });
    } catch (_) {
      // networkidle didn't settle within the cap — proceed anyway.
    }
  }

  // Short settle window for any final stragglers (configurable, small).
  const settleMs = opts && Number.isFinite(opts.settleMs) ? opts.settleMs : 400;
  if (settleMs > 0) {
    await page.waitForTimeout(settleMs);
  }

  // Take screenshot
  let screenshotPath = '';
  if (screenshotDir) {
    const filename = `${viewportName}.png`;
    screenshotPath = path.join(screenshotDir, filename);
    try {
      await page.screenshot({ path: screenshotPath, fullPage: false });
    } catch (err) {
      // Screenshot failure is non-fatal per-viewport
      screenshotPath = '';
    }
  }

  // Capture DOM summary
  let domSummary = null;
  try {
    domSummary = await page.evaluate(() => {
      const body = document.body;
      return {
        viewport: '', // filled by caller
        url: window.location.href,
        final_url: window.location.href,
        title: document.title || '',
        body_text_length: body ? body.innerText.length : 0,
        visible_element_count: document.querySelectorAll('*').length,
        document_width: document.documentElement.scrollWidth,
        document_height: document.documentElement.scrollHeight,
        viewport_width: window.innerWidth,
        viewport_height: window.innerHeight,
        has_body: body !== null,
        has_main: document.querySelector('main') !== null,
        heading_count: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
        link_count: document.querySelectorAll('a[href]').length,
        button_count: document.querySelectorAll('button').length,
        input_count: document.querySelectorAll('input').length,
        // Phase 4.4: identify elements wider than the viewport (overflow
        // culprits). Returns up to 5 compact CSS-ish selectors — never inner
        // HTML or text, so no rendered secret can leak.
        overflow_elements: (() => {
          try {
            const vw = window.innerWidth;
            const out = [];
            const all = document.body ? document.body.querySelectorAll('*') : [];
            for (const el of all) {
              const r = el.getBoundingClientRect();
              if (r.width > vw + 1 || r.right > vw + 1) {
                let sel = el.tagName.toLowerCase();
                if (el.id) sel += '#' + el.id;
                else if (el.classList && el.classList.length) sel += '.' + Array.from(el.classList).slice(0, 2).join('.');
                out.push({ selector: sel, width: Math.round(r.width) });
                if (out.length >= 5) break;
              }
            }
            return out;
          } catch (_) { return []; }
        })(),
        // Phase 7: text samples and selector presence for Spec assertions
        visible_text_sample: (body ? body.innerText.substring(0, 2000) : ''),
        page_text_contains: (() => {
          const full = (body ? body.innerText.toLowerCase() : '');
          return {
            // Truncated; full check is done server-side in Lens
            _note: 'Full text available via body_text_length. Use Spec assertions for substring checks.'
          };
        })(),
      };
    });
    domSummary.viewport = viewportName;
    domSummary.url = url;
  } catch (err) {
    domSummary = {
      viewport: viewportName,
      url: url,
      final_url: finalUrl,
      title: null,
      body_text_length: null,
      visible_element_count: null,
      document_width: null,
      document_height: null,
      viewport_width: null,
      viewport_height: null,
      has_body: null,
      has_main: null,
      heading_count: null,
      link_count: null,
      button_count: null,
      input_count: null,
      visible_text_sample: null,
      error: err.message,
    };
  }

  // Capture links
  let links = [];
  try {
    links = await page.evaluate(COLLECT_LINKS);
  } catch (_) {
    links = [];
  }

  // Performance metrics (Phase 2.1), only when requested and navigated.
  let metrics = null;
  if (opts && opts.perf && !navigationError) {
    metrics = await collectMetrics(page);
  }

  // Accessibility scan (axe-core), only when requested and the page
  // actually navigated. Never throws — degrades to engine_available:false.
  let accessibility = null;
  if (opts && opts.accessibility && !navigationError) {
    accessibility = await runAxeScan(page, opts);
  }

  // Clean up
  await context.close();

  return {
    name: viewportName,
    width: size.width,
    height: size.height,
    final_url: finalUrl,
    screenshot: screenshotPath,
    console_messages: consoleMessages,
    network_events: networkEvents,
    dom_summary: domSummary,
    links: links,
    navigation_error: navigationError,
    accessibility: accessibility,
    metrics: metrics,
  };
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  if (!opts.url) {
    console.error('Error: --url is required');
    process.exit(1);
  }

  const startedAt = nowISO();
  const startMs = Date.now();

  const result = {
    url: opts.url,
    final_url: opts.url,
    started_at: startedAt,
    finished_at: '',
    duration_ms: 0,
    viewports: [],
    provider_errors: [],
    metadata: {
      bridge: 'lens-browser-bridge',
      version: '0.1.0',
      playwright_version: require('playwright/package.json').version,
      node_version: process.version,
      browser: opts.browser,
      throttle: opts.throttle || 'none',
      device: opts.device || 'none',
      perf: opts.perf,
      auth: opts.authFile ? 'storage-state' : 'none',
    },
  };

  // Select the browser engine (Phase 2.3). chromium is the default; firefox
  // and webkit require the corresponding Playwright browser to be installed.
  const engines = { chromium, firefox, webkit };
  const engine = engines[opts.browser] || chromium;

  let browser = null;

  try {
    browser = await engine.launch({ headless: true });
  } catch (err) {
    result.provider_errors.push(`Browser launch failed: ${err.message}`);
    result.finished_at = nowISO();
    result.duration_ms = formatMs(Date.now() - startMs);
    process.stdout.write(JSON.stringify(result));
    process.exit(1);
  }

  const timeoutMs = opts.timeout * 1000;

  // Capture viewports concurrently (bounded by --max-concurrency). Each
  // viewport runs in its own isolated browser context (no shared state,
  // distinct screenshot files), so they navigate in parallel — this roughly
  // halves wall-clock time for the default desktop+mobile run versus capturing
  // them one at a time. Output stays deterministic: mapWithConcurrency returns
  // results in viewport order, never in completion order.
  const captures = await mapWithConcurrency(
    opts.viewports,
    opts.maxConcurrency,
    (vpName) =>
      captureViewport(browser, opts.url, vpName, timeoutMs, opts.screenshotDir, opts)
        .then((vpResult) => ({ vpName, vpResult, error: null }))
        .catch((err) => ({ vpName, vpResult: null, error: err }))
  );

  for (const { vpName, vpResult, error } of captures) {
    if (error) {
      result.provider_errors.push(
        `Viewport '${vpName}' capture failed: ${error.message}`
      );
      // Add partial result so we don't lose data from other viewports
      const fb = resolveViewport(vpName);
      result.viewports.push({
        name: vpName,
        width: fb.width,
        height: fb.height,
        final_url: opts.url,
        screenshot: '',
        console_messages: [],
        network_events: [],
        dom_summary: null,
        navigation_error: error.message,
      });
      continue;
    }
    if (vpResult.navigation_error) {
      result.provider_errors.push(
        `Viewport '${vpName}' navigation error: ${vpResult.navigation_error}`
      );
    }
    result.viewports.push(vpResult);
    if (result.final_url === opts.url && vpResult.final_url !== opts.url) {
      result.final_url = vpResult.final_url;
    }
  }

  // Close browser
  try {
    await browser.close();
  } catch (_) {
    // Ignore close errors
  }

  result.finished_at = nowISO();
  result.duration_ms = formatMs(Date.now() - startMs);

  process.stdout.write(JSON.stringify(result));

  // Determinism: a transient navigation error on one viewport must not
  // discard the evidence captured from the others. We exit 0 whenever at
  // least one viewport produced usable data (a DOM summary, a screenshot,
  // or a clean navigation). Kujo then classifies any per-viewport
  // navigation errors into findings via the page-load check. We exit 1
  // only on total failure (no usable viewport data at all).
  const hasUsableData = result.viewports.some(
    (vp) => vp && (vp.dom_summary || vp.screenshot || !vp.navigation_error)
  );
  process.exit(hasUsableData ? 0 : 1);
}

// Only drive a browser when invoked directly as a CLI. When required as a
// module (unit tests), export the pure helpers instead.
if (require.main === module) {
  main().catch((err) => {
    console.error(`Bridge fatal error: ${err.message}`);
    process.exit(1);
  });
} else {
  module.exports = { parseArgs, resolveViewport, mapWithConcurrency, COLLECT_LINKS, VIEWPORT_SIZES, THROTTLE_PROFILES };
}
