#!/usr/bin/env python3
"""Numeric-only API phase profiling of immutable baseline/candidate bridges.
Usage: bench-phase-comparison.py /path/to/baseline /tmp/phases.json [iterations]
The preload is confined to these child processes; it changes no repository code.
"""
import importlib.util
import json
import os
from pathlib import Path
import statistics
import subprocess
import sys
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'scripts/benchmark-fixture-server.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
PRELOAD = r'''
const Module = require('node:module');
const fs = require('node:fs');
const {performance} = require('node:perf_hooks');
const load = Module._load, values = {}, started = performance.now();
function wrap(object, method, category, after) {
  const original = object[method];
  object[method] = async function(...args) {
    const start = performance.now();
    try { const value = await original.apply(this, args); if (after) after(value); return value; }
    finally { values[category] = (values[category] || 0) + performance.now() - start; }
  };
}
Module._load = function(name, ...args) {
  const start = performance.now(), result = load.call(this, name, ...args);
  if (name === 'playwright-core' && !result.__lensProfile) {
    result.__lensProfile = true;
    values.runtime_load_ms = performance.now() - start;
    wrap(result.chromium, 'launch', 'browser_launch_ms', browser => {
      wrap(browser, 'close', 'browser_close_ms');
      wrap(browser, 'newContext', 'context_create_ms', context => {
        wrap(context, 'close', 'context_close_ms');
        wrap(context, 'newPage', 'page_create_ms', page => {
          for (const [method, category] of Object.entries({goto:'navigation_ms', screenshot:'screenshot_ms', evaluate:'evaluate_ms', waitForLoadState:'load_state_wait_ms', waitForTimeout:'fixed_wait_ms', addInitScript:'observer_install_ms'})) wrap(page, method, category);
        });
      });
    });
  }
  return result;
};
process.once('exit', () => fs.writeFileSync(process.env.LENS_PHASE_OUTPUT, JSON.stringify({...values,total_process_ms:performance.now()-started})));
'''

def main():
    baseline = Path(sys.argv[1]).resolve()
    output = Path(sys.argv[2])
    iterations = int(sys.argv[3]) if len(sys.argv) > 3 else 8
    if iterations < 1: raise ValueError('iterations must be positive')
    server = fixture.FixtureServer(('127.0.0.1', 0), fixture.FixtureHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    samples = {}
    try:
        with tempfile.TemporaryDirectory(prefix='lens-phase-') as directory:
            work = Path(directory)
            preload = work / 'profile.cjs'
            preload.write_text(PRELOAD)
            for case in ['trivial', 'image-heavy']:
                samples[case] = {'before': [], 'after': []}
                for trial in range(iterations):
                    order = [('before', baseline), ('after', ROOT)]
                    if trial % 2: order.reverse()
                    for side, root in order:
                        phase_file = work / 'phase.json'
                        with tempfile.TemporaryFile() as result:
                            subprocess.run(['node', '--require', str(preload), str(root / 'bridge/browser-bridge.js'), '--url', f'http://127.0.0.1:{server.server_port}/{case}', '--viewports', 'desktop', '--settle-ms', '0', '--screenshot-dir', str(work / 'shots')], cwd=root, env={**os.environ, 'LENS_PHASE_OUTPUT': str(phase_file)}, stdout=result, stderr=subprocess.PIPE, timeout=90, check=True)
                            result.seek(0)
                            evidence = json.load(result)
                        if evidence['provider_errors']: raise RuntimeError('Phase capture failed')
                        phases = json.loads(phase_file.read_text())
                        # Current runtime includes the readiness loop outside Playwright calls.
                        for viewport in evidence['viewports']:
                            if 'readiness' in viewport: phases['readiness_ms'] = viewport['readiness']['duration_ms']
                        samples[case][side].append(phases)
                print(case, 'complete', flush=True)
            medians = {case: {side: {key: statistics.median(sample.get(key, 0) for sample in values) for key in sorted(set().union(*(sample.keys() for sample in values)))} for side, values in sides.items()} for case, sides in samples.items()}
            output.write_text(json.dumps({'schema_version':1, 'iterations':iterations, 'unit':'milliseconds', 'method':'alternating direct bridge calls with numeric-only API preload', 'samples':samples, 'medians':medians}, indent=2)+'\n')
    finally:
        server.shutdown()
        server.server_close()
if __name__ == '__main__': main()
