'use strict';
// Unit tests for the pure (non-browser) logic in the Lens bridges.
// Run with: node --test   (from the bridge/ directory)

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { chromium } = require('playwright-core');

const browser = require('../browser-bridge.js');
const flow = require('../flow-bridge.js');
const inspect = require('../inspect-bridge.js');

function withArgv(args, fn) {
  const saved = process.argv;
  process.argv = ['node', 'bridge.js', ...args];
  try { return fn(); } finally { process.argv = saved; }
}

test('browser-bridge resolveViewport: presets', () => {
  assert.deepStrictEqual(browser.resolveViewport('desktop'), { name: 'desktop', width: 1440, height: 900 });
  assert.deepStrictEqual(browser.resolveViewport('mobile'), { name: 'mobile', width: 390, height: 844 });
});

test('browser-bridge resolveViewport: custom WxH', () => {
  assert.deepStrictEqual(browser.resolveViewport('1024x768'), { name: '1024x768', width: 1024, height: 768 });
});

test('browser-bridge resolveViewport: unknown falls back to desktop size, keeps name', () => {
  const r = browser.resolveViewport('garbage');
  assert.strictEqual(r.width, 1440);
  assert.strictEqual(r.name, 'garbage');
});

test('browser-bridge parseArgs: defaults and flags', () => {
  const opts = withArgv(['--url', 'http://x', '--perf', '--browser', 'firefox', '--settle-ms', '150'], browser.parseArgs);
  assert.strictEqual(opts.url, 'http://x');
  assert.strictEqual(opts.perf, true);
  assert.strictEqual(opts.browser, 'firefox');
  assert.strictEqual(opts.settleMs, 150);
});

test('browser-bridge parseArgs: invalid browser falls back to chromium', () => {
  const opts = withArgv(['--url', 'http://x', '--browser', 'ie6'], browser.parseArgs);
  assert.strictEqual(opts.browser, 'chromium');
});

test('browser-bridge THROTTLE_PROFILES are well formed', () => {
  for (const name of ['slow-3g', '3g', '4g']) {
    const p = browser.THROTTLE_PROFILES[name];
    assert.ok(p && p.downloadThroughput > 0 && p.latency >= 0, `${name} profile`);
  }
});

test('browser-bridge mapWithConcurrency preserves input order', async () => {
  const items = [1, 2, 3, 4, 5];
  // Resolve out of order on purpose; results must still be in input order.
  const out = await browser.mapWithConcurrency(items, 2, async (n) => {
    await new Promise((r) => setTimeout(r, (6 - n) * 5));
    return n * 10;
  });
  assert.deepStrictEqual(out, [10, 20, 30, 40, 50]);
});

test('flow-bridge resolveViewport: preset + custom', () => {
  assert.deepStrictEqual(flow.resolveViewport('desktop'), { width: 1440, height: 900 });
  assert.deepStrictEqual(flow.resolveViewport('800x600'), { width: 800, height: 600 });
});

test('flow-bridge parseArgs reads program/screenshot/video dirs', () => {
  const opts = withArgv(['--program', '/p.json', '--screenshot-dir', '/s', '--video-dir', '/v'], flow.parseArgs);
  assert.strictEqual(opts.program, '/p.json');
  assert.strictEqual(opts.screenshotDir, '/s');
  assert.strictEqual(opts.videoDir, '/v');
});

test('flow-bridge screenshot names cannot escape the screenshot directory', () => {
  const name = flow.sanitizeScreenshotName('../../outside\\nested');
  const root = path.resolve('/tmp/lens-screenshots');
  const target = path.resolve(root, name + '.png');
  assert.ok(target.startsWith(root + path.sep));
  assert.ok(!name.includes('/') && !name.includes('\\'));
});

test('flow-bridge applies the flow timeout to steps without overrides', () => {
  assert.strictEqual(flow.resolveStepTimeout({}, 42000), 42000);
  assert.strictEqual(flow.resolveStepTimeout({ timeout_ms: 1500 }, 42000), 1500);
});

test('inspect-bridge parseArgs: url/timeout/max-elements', () => {
  const opts = withArgv(['--url', 'http://x', '--timeout', '15', '--max-elements', '50'], inspect.parseArgs);
  assert.strictEqual(opts.url, 'http://x');
  assert.strictEqual(opts.timeout, 15);
  assert.strictEqual(opts.maxElements, 50);
});

test('inspect-bridge parseArgs: defaults', () => {
  const opts = withArgv(['--url', 'http://x'], inspect.parseArgs);
  assert.strictEqual(opts.timeout, 30);
  assert.strictEqual(opts.maxElements, 250);
});

test('inspect-bridge suggests the test attribute that actually exists', async () => {
  const instance = await chromium.launch({ headless: true });
  try {
    const page = await instance.newPage();
    await page.setContent('<button data-test="save">Save</button><button data-cy="cancel">Cancel</button>');
    const elements = await page.evaluate(inspect.COLLECT, 20);
    assert.deepStrictEqual(elements.map((entry) => entry.selector), [
      '[data-test="save"]',
      '[data-cy="cancel"]',
    ]);
  } finally {
    await instance.close();
  }
});

test('browser-bridge excludes display-none links from captured link evidence', async () => {
  const instance = await chromium.launch({ headless: true });
  try {
    const page = await instance.newPage();
    await page.setContent('<a href="/visible">Visible</a><a href="/hidden" style="display:none">Hidden</a>');
    const links = await page.evaluate(browser.COLLECT_LINKS);
    assert.deepStrictEqual(links.map((entry) => entry.href), ['/visible']);
  } finally {
    await instance.close();
  }
});
