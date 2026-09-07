#!/usr/bin/env node
/**
 * flow-bridge.js — Lens interactive flow execution bridge (Phase 4.1 / 4.2).
 *
 * Unlike browser-bridge.js (read-only observation), this bridge EXECUTES a
 * declarative, already-safety-validated step program in a single browser
 * session and reports real per-step results. Kujo performs all safety gating
 * BEFORE invoking this bridge: blocked steps are never sent here. The bridge
 * trusts that the program it receives is the set of allowed actions and does
 * exactly — and only — those.
 *
 * Optionally records the whole session to video (--record), which produces the
 * raw material for the proof-of-work walkthrough artifact.
 *
 * Input:  a JSON program on the path given by --program <path>.
 * Output: JSON results to stdout.
 */

const { Timings, launchBrowser, closeContext, withDeadline } = require('./runtime');
const { observeReadiness } = require('./readiness');
const fs = require('fs');
const path = require('path');

const MAX_CONSOLE_MESSAGES = 1000;
const MAX_NETWORK_EVENTS = 2000;
const MAX_VIEWPORT_DIMENSION = 4096;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

function pushBounded(items, value, limit) {
  if (items.length >= limit) return false;
  items.push(value);
  return true;
}

function recordingExceedsLimit(filePath, maxBytes = MAX_VIDEO_BYTES) {
  return fs.statSync(filePath).size > maxBytes;
}

function nowISO() { return new Date().toISOString(); }

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { program: '', screenshotDir: '', videoDir: '' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--program') opts.program = args[++i] || '';
    else if (args[i] === '--screenshot-dir') opts.screenshotDir = args[++i] || '';
    else if (args[i] === '--video-dir') opts.videoDir = args[++i] || '';
  }
  return opts;
}

const VIEWPORT_SIZES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

function resolveViewport(token) {
  const preset = VIEWPORT_SIZES[token];
  if (preset) return { width: preset.width, height: preset.height };
  const m = /^(\d+)x(\d+)$/.exec(String(token || '').toLowerCase());
  if (m) {
    const width = parseInt(m[1], 10), height = parseInt(m[2], 10);
    if (width > 0 && height > 0 && width <= MAX_VIEWPORT_DIMENSION && height <= MAX_VIEWPORT_DIMENSION) {
      return { width, height };
    }
  }
  return VIEWPORT_SIZES.desktop;
}

function sanitizeScreenshotName(raw) {
  const cleaned = String(raw || 'step')
    .replace(/[\\/]+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 100);
  return cleaned || 'step';
}

function resolveStepTimeout(step, defaultTimeoutMs) {
  if (step.timeout_ms && step.timeout_ms > 0) return step.timeout_ms;
  if (defaultTimeoutMs && defaultTimeoutMs > 0) return defaultTimeoutMs;
  return 10000;
}

// Execute a single step. Returns { status, message, screenshot }.
async function executeStep(page, step, opts, defaultTimeoutMs) {
  const type = step.type;
  const timeout = resolveStepTimeout(step, defaultTimeoutMs);
  try {
    if (type === 'visit') {
      await page.goto(step.url, { waitUntil: 'load', timeout });
      if (opts.readiness) await opts.readiness.wait({ timeoutMs: timeout });
      return { status: 'pass', message: 'Navigated to ' + step.url };
    }
    if (type === 'click') {
      const loc = page.locator(step.selector).first().describe('Lens click target');
      // Keep a `target="_blank"` link in the SAME tab so the destination loads
      // in the recorded page (otherwise it opens an un-recorded new tab and the
      // ending screen never appears in the video). Benign: only the nav target
      // changes, no page state is mutated.
      await loc.evaluate((el) => { if (el && el.tagName === 'A' && el.target === '_blank') el.removeAttribute('target'); }, undefined, { timeout });
      // Native annotations are click-only: fill titles can contain typed values.
      if (opts.recording) await page.screencast.showActions({ duration: 500, cursor: 'pointer' });
      try { await loc.click({ timeout }); }
      finally { if (opts.recording) await page.screencast.hideActions(); }
      await page.waitForLoadState('domcontentloaded', { timeout });
      return { status: 'pass', message: 'Clicked ' + step.selector };
    }
    if (type === 'type') {
      const loc = page.locator(step.selector).first();
      if (step.secret) await loc.evaluate(el => el.style.setProperty('-webkit-text-security', 'disc', 'important'), undefined, { timeout });
      await loc.fill(step.value != null ? String(step.value) : '', { timeout });
      // Never echo the typed value (it may be sensitive).
      return { status: 'pass', message: 'Typed into ' + step.selector };
    }
    if (type === 'wait') {
      await page.waitForTimeout(Math.min(step.ms || 0, 10000));
      return { status: 'pass', message: 'Waited ' + (step.ms || 0) + 'ms' };
    }
    if (type === 'scroll') {
      if (step.selector) {
        const loc = page.locator(step.selector).first();
        await loc.scrollIntoViewIfNeeded({ timeout });
        return { status: 'pass', message: 'Scrolled to ' + step.selector };
      }
      if (step.y != null) {
        await withDeadline(() => page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), step.y), timeout);
        return { status: 'pass', message: 'Scrolled to y=' + step.y };
      }
      return { status: 'skipped', message: 'scroll: no selector or y given' };
    }
    if (type === 'wait_for_selector') {
      await page.waitForSelector(step.selector, { timeout, state: 'visible' });
      return { status: 'pass', message: 'Selector appeared: ' + step.selector };
    }
    if (type === 'wait_for_text') {
      await page.getByText(step.text, { exact: false }).first().waitFor({ timeout, state: 'visible' });
      return { status: 'pass', message: 'Text appeared: ' + step.text };
    }
    if (type === 'assert_selector' || type === 'assert_not_selector') {
      const absent = type === 'assert_not_selector';
      try {
        await page.locator(step.selector).first().waitFor({ state: absent ? 'detached' : 'attached', timeout });
        return { status: 'pass', message: (absent ? 'Selector absent as expected: ' : 'Selector present: ') + step.selector };
      } catch (_) {
        return { status: 'fail', message: (absent ? 'Selector unexpectedly present: ' : 'Selector NOT found: ') + step.selector };
      }
    }
    if (type === 'assert_text') {
      try {
        await page.waitForFunction(text => !!document.body && document.body.innerText.includes(text), step.text, { timeout });
        return { status: 'pass', message: 'Text present: ' + step.text };
      } catch (_) { return { status: 'fail', message: 'Text NOT found: ' + step.text }; }
    }
    if (type === 'screenshot') {
      const name = sanitizeScreenshotName(step.name) + '.png';
      const p = path.join(opts.screenshotDir, name);
      await page.screenshot({ path: p, fullPage: false, timeout });
      return { status: 'pass', message: 'Captured ' + name, screenshot: 'screenshots/' + name };
    }
    return { status: 'skipped', message: 'Unsupported step type: ' + type };
  } catch (err) {
    // Playwright fill errors may echo the value in their call log.
    return { status: 'fail', message: type === 'type' ? 'type failed: input action did not complete' : type + ' failed: ' + err.message };
  }
}

async function runFlow(program, opts) {
  const timings = new Timings();
  timings.values.process_boot_ms = process.uptime() * 1000;

  const size = resolveViewport(program.viewport);
  const result = {
    final_url: program.url || '',
    video: '',
    console_messages: [],
    network_events: [],
    dom_summary: null,
    steps: [],
    started_at: nowISO(),
    evidence_limits: {
      max_console_messages: MAX_CONSOLE_MESSAGES,
      max_network_events: MAX_NETWORK_EVENTS,
      dropped_console_messages: 0,
      dropped_network_events: 0,
    },
    artifact_warnings: [],
  };

  await timings.measure('runtime_load_ms', async () => require('playwright-core'));
  const browser = await timings.measure('browser_launch_ms', () => launchBrowser());
  let context, readiness;
  try {
    const contextOptions = { viewport: { width: size.width, height: size.height } };
    if (program.auth_file) contextOptions.storageState = program.auth_file;
    context = await timings.measure('context_create_ms', () => browser.newContext(contextOptions), program.timeout || 30000);
    const page = await timings.measure('page_create_ms', () => context.newPage(), program.timeout || 30000);
    readiness = await withDeadline(() => observeReadiness(page), program.timeout || 30000);
    opts = { ...opts, readiness, recording: !!(program.record && opts.videoDir) };
    const videoPath = opts.recording ? path.join(opts.videoDir, 'walkthrough.webm') : '';
    if (opts.recording) {
      fs.mkdirSync(opts.videoDir, { recursive: true });
      if (fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
      await timings.measure('recording_start_ms', () => page.screencast.start({ path: videoPath, size }), program.timeout || 30000);
    }

    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        const entry = { type: msg.type(), text: msg.text(), timestamp: nowISO() };
        if (!pushBounded(result.console_messages, entry, MAX_CONSOLE_MESSAGES)) {
          result.evidence_limits.dropped_console_messages++;
        }
      }
    });
    page.on('pageerror', err => {
      if (!pushBounded(result.console_messages, { type: 'error', text: err.message, timestamp: nowISO() }, MAX_CONSOLE_MESSAGES)) result.evidence_limits.dropped_console_messages++;
    });
    page.on('response', (r) => {
      if (r.status() >= 400) {
        const entry = { url: r.url(), status: r.status(), method: r.request().method(), timestamp: nowISO() };
        if (!pushBounded(result.network_events, entry, MAX_NETWORK_EVENTS)) {
          result.evidence_limits.dropped_network_events++;
        }
      }
    });
    page.on('requestfailed', (r) => {
      const entry = { url: r.url(), status: null, failure_text: (r.failure() && r.failure().errorText) || 'failed', timestamp: nowISO() };
      if (!pushBounded(result.network_events, entry, MAX_NETWORK_EVENTS)) {
        result.evidence_limits.dropped_network_events++;
      }
    });

    for (const step of program.steps) {
      const startOffset = timings.finish().total_bridge_ms;
      const r = await timings.measure('step_execution_ms', () => executeStep(page, step, opts, program.timeout));
      result.steps.push({ index: step.index, type: step.type, start_offset_ms: startOffset, end_offset_ms: timings.finish().total_bridge_ms, status: r.status, message: r.message, screenshot: r.screenshot || '' });

    }

    try { result.final_url = page.url(); } catch (_) {}
    try {
      result.dom_summary = await withDeadline(() => page.evaluate(() => ({
        title: document.title || '',
        body_text_length: document.body ? document.body.innerText.length : 0,
        document_width: document.documentElement.scrollWidth,
        viewport_width: window.innerWidth,
      })), program.timeout || 30000);
    } catch (_) {}

    if (opts.recording) {
      // RECORDING-ONLY: hold the final screen long enough to be read and encoded.
      // A closed/crashed page must not discard completed step evidence.
      await page.waitForTimeout(300).catch(() => {});
      let recordingStopped = false;
      try {
        await timings.measure('recording_stop_ms', () => page.screencast.stop(), program.timeout || 30000);
        recordingStopped = true;
      } catch (_) {
        result.artifact_warnings.push('Recording finalization did not complete; the incomplete video was removed.');
        try { fs.rmSync(videoPath, { force: true }); }
        catch (_) { result.artifact_warnings.push('Incomplete recording cleanup failed.'); }
      }
      if (recordingStopped) await timings.measure('artifact_finalize_ms', async () => {
        if (fs.existsSync(videoPath) && !recordingExceedsLimit(videoPath)) result.video = 'video/walkthrough.webm';
        else if (fs.existsSync(videoPath)) {
          fs.unlinkSync(videoPath);
          result.artifact_warnings.push('Recording exceeded the 100 MiB artifact limit and was removed.');
        }
      }).catch(() => { result.artifact_warnings.push('Recording artifact finalization failed.'); });
    }
  } finally {
    if (readiness) readiness.dispose();
    if (context) result.context_cleanup_failed = !(await timings.measure('context_close_ms', () => closeContext(context)));
    await timings.measure('browser_close_ms', () => browser.close().catch(() => {}));
  }
  result.timings = timings.finish();
  result.finished_at = nowISO();
  return redactTypedValues(result, program);
}

function redactTypedValues(result, program) {
  const secrets = program.steps.filter(s => s.type === 'type' && s.secret && s.value != null && String(s.value)).flatMap(s => { const value = String(s.value); return [value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)]; }).sort((a,b) => b.length-a.length);
  function scrub(value) {
    if (typeof value === 'string') {
      for (const secret of secrets) value = value.split(secret).join('[REDACTED]');
      return value;
    }
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
    return value;
  }
  return scrub(result);
}

async function main() {
  const opts = parseArgs();
  if (!opts.program) throw new Error("Program is required");
  const program = JSON.parse(fs.readFileSync(opts.program === "-" ? 0 : opts.program, "utf8"));
  process.stdout.write(JSON.stringify(await runFlow(program, opts)));
}

if (require.main === module) {
  main().catch(() => { console.error('Flow bridge failed before structured completion'); process.exitCode = 1; });
} else {
  module.exports = {
    parseArgs, resolveViewport, sanitizeScreenshotName, resolveStepTimeout,
    runFlow, redactTypedValues, executeStep, VIEWPORT_SIZES, pushBounded, MAX_CONSOLE_MESSAGES,
    MAX_NETWORK_EVENTS, MAX_VIEWPORT_DIMENSION, MAX_VIDEO_BYTES,
    recordingExceedsLimit,
  };
}
