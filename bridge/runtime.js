'use strict';
const { performance } = require('node:perf_hooks');

async function withDeadline(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([operation(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Browser operation deadline reached')), Math.max(1, timeoutMs));
    })]);
  } finally { clearTimeout(timer); }
}

// Context.close has no Playwright timeout option. Retire its browser if this
// deadline expires; Browser.close uses Playwright's bounded close-or-kill path.
async function closeContext(context, timeoutMs = 5000) {
  try { await withDeadline(() => context.close(), Math.min(5000, timeoutMs)); return true; }
  catch (_) { return false; }
}

// Diagnostics only: monotonic durations and fixed field names, never page data.
class Timings {
  constructor() { this.started = performance.now(); this.values = {}; }
  async measure(name, operation, timeoutMs = 0) {
    const start = performance.now();
    try { return await (timeoutMs ? withDeadline(operation, timeoutMs) : operation()); }
    finally { this.values[name] = (this.values[name] || 0) + performance.now() - start; }
  }
  finish() {
    return Object.fromEntries(Object.entries({ ...this.values, total_bridge_ms: performance.now() - this.started })
      .map(([key, value]) => [key, Math.round(value * 100) / 100]));
  }
}

async function launchBrowser(engine = 'chromium') {
  const engines = require('playwright-core');
  if (!['chromium', 'firefox', 'webkit'].includes(engine)) throw new Error('Unsupported browser engine');
  return engines[engine].launch({ headless: true });
}

// A session holds a process, never a page/context/auth state. Jobs are serialized
// by the caller. A crashed browser is replaced for the NEXT job, never replayed.
class BrowserHost {
  constructor() { this.browser = null; this.engine = ''; this.launches = 0; this.generation = 0; this.closing = Promise.resolve(); }
  async acquire(engine = 'chromium') {
    await this.closing;
    if (this.browser && (!this.browser.isConnected() || this.engine !== engine)) await this.close();
    if (!this.browser) {
      const generation = this.generation;
      const browser = await launchBrowser(engine);
      this.launches++;
      if (generation !== this.generation) {
        await browser.close().catch(() => {});
        throw new Error('Browser job cancelled during launch');
      }
      this.browser = browser;
      this.engine = engine;
    }
    return this.browser;
  }
  async close() {
    this.generation++;
    const browser = this.browser;
    this.browser = null;
    if (browser) this.closing = browser.close().catch(() => {});
    await this.closing;
  }
}
module.exports = { Timings, launchBrowser, BrowserHost, withDeadline, closeContext };
