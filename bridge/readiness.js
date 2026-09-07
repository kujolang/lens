'use strict';
const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { withDeadline } = require('./runtime');

// Install BEFORE navigation. Observers retain counts/times only, not DOM text,
// request URLs or payloads. Network requests are released at completion/dispose.
async function observeReadiness(page) {
  const pending = new Set();
  let lastNetwork = performance.now(), overflow = false;
  const request = r => { if (pending.size < 2000) pending.add(r); else overflow = true; lastNetwork = performance.now(); };
  const completed = r => { pending.delete(r); lastNetwork = performance.now(); };
  page.on('request', request);
  page.on('requestfinished', completed);
  page.on('requestfailed', completed);
  await page.addInitScript(() => {
    const state = { last: performance.now() };
    Object.defineProperty(window, '__lensReadiness', { value: state, configurable: true });
    new MutationObserver(() => { state.last = performance.now(); })
      .observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  return {
    async wait({ timeoutMs = 30000, settleMs = 0, readySelector = '' } = {}) {
      const start = performance.now();
      // Keep the old quick-mode 500ms evidence horizon, while replacing its
      // networkidle dependency. settle-ms preserves the historical extra evidence horizon.
      const minimum = 500 + Math.min(Math.max(0, settleMs), 10000);
      const cap = Math.min(timeoutMs, Math.max(2000, minimum));
      if (readySelector) {
        try {
          await page.locator(readySelector).first().waitFor({ state: 'visible', timeout: cap });
          return { reason: 'explicit-selector', duration_ms: Math.round(performance.now() - start) };
        } catch (_) {
          return { reason: 'max-wait-reached', duration_ms: Math.round(performance.now() - start) };
        }
      }
      let reason = 'max-wait-reached';
      // The quiet condition cannot succeed before this evidence horizon.
      // Observers continue tracking activity; avoid repeated browser round trips
      // until their state can actually make the page ready.
      const horizon = Math.min(minimum, cap);
      // Timer granularity can wake us slightly early. Recheck the monotonic
      // deadline before querying the browser, rather than adding a 50ms poll.
      while (performance.now() - start < horizon) {
        await delay(Math.max(1, Math.ceil(horizon - (performance.now() - start))));
      }
      while (performance.now() - start < cap && !page.isClosed()) {
        let quiet = false;
        try {
          quiet = await withDeadline(() => page.evaluate(() => !!window.__lensReadiness && performance.now() - window.__lensReadiness.last >= 250), cap - (performance.now() - start));
        } catch (_) { /* Navigation/crash: bounded retry, never assume ready. */ }
        const elapsed = performance.now() - start;
        if (elapsed >= minimum && quiet && !overflow && pending.size === 0 && performance.now() - lastNetwork >= 250) {
          reason = 'quiet-window';
          break;
        }
        // REQUIRED: bounded observation polling, not an unconditional page delay.
        await delay(Math.max(1, Math.min(50, cap - elapsed)));
      }
      return { reason, duration_ms: Math.round(performance.now() - start) };
    },
    dispose() {
      page.off('request', request);
      page.off('requestfinished', completed);
      page.off('requestfailed', completed);
      pending.clear();
    },
  };
}
module.exports = { observeReadiness };
