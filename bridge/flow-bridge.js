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

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

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

// Draw/position a visible cursor overlay at viewport coords (x, y). Done with
// page.evaluate (not an init-script event listener — that proved unreliable),
// and re-created if a navigation wiped it. Pure visual aid for the recording;
// it changes nothing the checks observe.
async function setCursor(page, x, y) {
  await page.evaluate(([x, y]) => {
    let c = document.getElementById('__lens_cursor');
    if (!c && document.body) {
      c = document.createElement('div');
      c.id = '__lens_cursor';
      c.style.cssText = 'position:fixed;z-index:2147483647;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(255,59,48,.35);border:3px solid #ff3b30;pointer-events:none;box-shadow:0 0 0 3px rgba(255,255,255,.85),0 2px 8px rgba(0,0,0,.4);';
      document.body.appendChild(c);
    }
    if (c) { c.style.left = x + 'px'; c.style.top = y + 'px'; }
  }, [x, y]).catch(() => {});
}

// Draw an expanding click ripple at (x, y) for the recording.
async function drawRipple(page, x, y) {
  await page.evaluate(([x, y]) => {
    if (!document.body) return;
    const r = document.createElement('div');
    r.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;z-index:2147483646;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;border:3px solid #ff3b30;background:rgba(255,59,48,.25);pointer-events:none;';
    document.body.appendChild(r);
    r.animate([{ transform: 'scale(1)', opacity: .9 }, { transform: 'scale(5)', opacity: 0 }], { duration: 600 }).onfinish = () => r.remove();
  }, [x, y]).catch(() => {});
}

// Visibly glide the mouse to an element's center (for the recording). Playwright
// mouse.move `steps` dispatch with no inter-step delay (instant), so we
// interpolate manually with frame pauses, drawing the cursor each frame, and
// track the position so the next move starts where this one ended.
let _mouseX = null, _mouseY = null;
async function moveCursorTo(page, locator) {
  try {
    const box = await locator.boundingBox();
    if (!box) return null;
    const tx = box.x + box.width / 2, ty = box.y + box.height / 2;
    if (_mouseX === null) {
      const vp = page.viewportSize() || { width: 1440, height: 900 };
      _mouseX = vp.width / 2; _mouseY = vp.height / 2;
    }
    const frames = 22;
    const sx = _mouseX, sy = _mouseY;
    for (let k = 1; k <= frames; k++) {
      const e = k / frames;
      const t = 1 - Math.pow(1 - e, 2); // ease-out
      const x = sx + (tx - sx) * t, y = sy + (ty - sy) * t;
      await page.mouse.move(x, y);
      await setCursor(page, x, y);
      await page.waitForTimeout(16);
    }
    _mouseX = tx; _mouseY = ty;
    await page.waitForTimeout(250);
    return { x: tx, y: ty };
  } catch (_) { return null; }
}
function resolveViewport(token) {
  const preset = VIEWPORT_SIZES[token];
  if (preset) return { width: preset.width, height: preset.height };
  const m = /^(\d+)x(\d+)$/.exec(String(token || '').toLowerCase());
  if (m) return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
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
      // Cap the network-idle wait: sites with analytics/long-polling never go
      // idle, and waiting the full timeout per navigation can exceed the
      // runtime's process limit. A few seconds is plenty to settle.
      try { await page.waitForLoadState('networkidle', { timeout: Math.min(timeout, 3500) }); } catch (_) {}
      return { status: 'pass', message: 'Navigated to ' + step.url };
    }
    if (type === 'click') {
      const loc = page.locator(step.selector).first();
      await loc.scrollIntoViewIfNeeded({ timeout }).catch(() => {});
      // Keep a `target="_blank"` link in the SAME tab so the destination loads
      // in the recorded page (otherwise it opens an un-recorded new tab and the
      // ending screen never appears in the video). Benign: only the nav target
      // changes, no page state is mutated.
      await loc.evaluate((el) => { if (el && el.tagName === 'A' && el.target === '_blank') el.removeAttribute('target'); }).catch(() => {});
      const at = await moveCursorTo(page, loc);
      if (at) { await drawRipple(page, at.x, at.y); await page.waitForTimeout(120); }
      await loc.click({ timeout });
      // If the click navigated, let the destination paint so it's visibly
      // captured in the recording — a bounded wait, kept short so long journeys
      // don't trip the runtime's process time limit.
      try { await page.waitForLoadState('domcontentloaded', { timeout: Math.min(timeout, 4000) }); } catch (_) {}
      await page.waitForTimeout(1200);
      return { status: 'pass', message: 'Clicked ' + step.selector };
    }
    if (type === 'type') {
      const loc = page.locator(step.selector).first();
      await moveCursorTo(page, loc);
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
        await loc.evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }))
          .catch(async () => { await loc.scrollIntoViewIfNeeded(); });
        await page.waitForTimeout(900);
        return { status: 'pass', message: 'Scrolled to ' + step.selector };
      }
      if (step.y != null) {
        await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), step.y);
        await page.waitForTimeout(900);
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
    if (type === 'assert_selector') {
      const el = await page.$(step.selector);
      return el ? { status: 'pass', message: 'Selector present: ' + step.selector }
                : { status: 'fail', message: 'Selector NOT found: ' + step.selector };
    }
    if (type === 'assert_not_selector') {
      const el = await page.$(step.selector);
      return el ? { status: 'fail', message: 'Selector unexpectedly present: ' + step.selector }
                : { status: 'pass', message: 'Selector absent as expected: ' + step.selector };
    }
    if (type === 'assert_text') {
      const body = await page.evaluate(() => document.body ? document.body.innerText : '');
      return body.includes(step.text) ? { status: 'pass', message: 'Text present: ' + step.text }
                                      : { status: 'fail', message: 'Text NOT found: ' + step.text };
    }
    if (type === 'screenshot') {
      const name = sanitizeScreenshotName(step.name) + '.png';
      const p = path.join(opts.screenshotDir, name);
      await page.screenshot({ path: p, fullPage: false });
      return { status: 'pass', message: 'Captured ' + name, screenshot: 'screenshots/' + name };
    }
    return { status: 'skipped', message: 'Unsupported step type: ' + type };
  } catch (err) {
    return { status: 'fail', message: type + ' failed: ' + err.message };
  }
}

async function main() {
  const opts = parseArgs();
  if (!opts.program) { console.error('Error: --program is required'); process.exit(1); }
  const program = JSON.parse(fs.readFileSync(opts.program, 'utf8'));

  const size = resolveViewport(program.viewport);
  const result = {
    final_url: program.url || '',
    video: '',
    console_messages: [],
    network_events: [],
    dom_summary: null,
    steps: [],
    started_at: nowISO(),
  };

  const browser = await chromium.launch({ headless: true });
  const contextOptions = { viewport: { width: size.width, height: size.height } };
  if (program.record && opts.videoDir) {
    contextOptions.recordVideo = { dir: opts.videoDir, size: { width: size.width, height: size.height } };
  }
  if (program.auth_file) contextOptions.storageState = program.auth_file;
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      result.console_messages.push({ type: msg.type(), text: msg.text(), timestamp: nowISO() });
    }
  });
  page.on('response', (r) => { if (r.status() >= 400) result.network_events.push({ url: r.url(), status: r.status(), method: r.request().method(), timestamp: nowISO() }); });
  page.on('requestfailed', (r) => result.network_events.push({ url: r.url(), status: null, failure_text: (r.failure() && r.failure().errorText) || 'failed', timestamp: nowISO() }));

  const recording = program.record && opts.videoDir;
  for (const step of program.steps) {
    const r = await executeStep(page, step, opts, program.timeout);
    result.steps.push({ index: step.index, type: step.type, status: r.status, message: r.message, screenshot: r.screenshot || '' });
    // A short, watchable pause between steps so the recording is followable.
    if (recording) await page.waitForTimeout(450);
  }

  try { result.final_url = page.url(); } catch (_) {}
  try {
    result.dom_summary = await page.evaluate(() => ({
      title: document.title || '',
      body_text_length: document.body ? document.body.innerText.length : 0,
      document_width: document.documentElement.scrollWidth,
      viewport_width: window.innerWidth,
    }));
  } catch (_) {}

  // Playwright finalizes (flushes) videos on context close.
  await context.close();
  await browser.close();

  // Finalize the recording robustly. A `target="_blank"` link can open a second
  // tab with its own short video, and page.video().path() before close is racy,
  // so instead we scan the video dir AFTER close, promote the largest .webm
  // (the primary session) to the stable name walkthrough.webm, and drop the
  // stray tab clips. This guarantees the path the walkthrough.html references
  // actually exists.
  if (program.record && opts.videoDir) {
    try {
      const dest = path.join(opts.videoDir, 'walkthrough.webm');
      const webms = fs.readdirSync(opts.videoDir)
        .filter((f) => f.endsWith('.webm') && f !== 'walkthrough.webm')
        .map((f) => path.join(opts.videoDir, f))
        .sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
      if (webms.length > 0) {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        fs.renameSync(webms[0], dest);
        for (let i = 1; i < webms.length; i++) { try { fs.unlinkSync(webms[i]); } catch (_) {} }
        result.video = 'video/walkthrough.webm';
      }
      if (fs.existsSync(dest)) {
        result.video = 'video/walkthrough.webm';
        // mp4 transcode (for universal inline playback) is done on the Kujo side
        // after this bridge returns — keeping the bridge fast so it never trips
        // the runtime's process time limit on longer recordings.
      }
    } catch (_) { result.video = ''; }
  }

  result.finished_at = nowISO();
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => { console.error('Flow bridge fatal: ' + err.message); process.exit(1); });
} else {
  module.exports = { parseArgs, resolveViewport, sanitizeScreenshotName, resolveStepTimeout, executeStep, VIEWPORT_SIZES };
}
