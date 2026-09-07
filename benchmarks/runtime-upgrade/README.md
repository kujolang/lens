# Runtime upgrade receipts

Baseline: `e96fb383366b845c633302a59effd4b3010f4b6e`, Lens 1.0.1,
Playwright 1.60.0 with its matching Chromium revision 1223.
After: Lens 1.1.0, Playwright 1.61.1, headless shell revision 1228.
Local trials use the installed Kujo 1.2.3 release binary and the same local fixtures.
Linux CI builds one release-mode Kujo binary and uses it for both revisions.
See the environment receipts and [engineering report](../../docs/browser-runtime-upgrade.md).

Reproduce from the repository root, with an immutable baseline checkout:

```sh
export KUJO_BIN=/absolute/path/to/kujo
# Keep both lockfile-matched browser revisions installed when comparing.
export PLAYWRIGHT_SKIP_BROWSER_GC=1
LENS_BENCH_TARGET_ROOT=/path/to/baseline scripts/bench.sh 8 /tmp/core-before.json
scripts/bench.sh 8 /tmp/core-after.json
python3 scripts/bench-runtime.py 8 /tmp/runtime-before.json /path/to/baseline
python3 scripts/bench-runtime.py 8 /tmp/runtime-after.json
node scripts/bench-host.js 8 /tmp/host.json
python3 scripts/bench-paired.py /path/to/baseline /tmp/paired.json 8
# Start scripts/benchmark-fixture-server.py separately for this diagnostic:
node scripts/bench-concurrency.js http://127.0.0.1:9972 /tmp/concurrency.json 3
node scripts/bench-resources.js http://127.0.0.1:9972 /tmp/resources.json
python3 scripts/bench-phase-comparison.py /path/to/baseline /tmp/phases.json 8
```

The core harness checkpoints completed groups of medians; pass `--resume` as
its third argument after an interruption. The additional runtime harness stores
raw samples and checkpoints each completed sample.
`--resume` can resume an interrupted run with the same target and iteration count;
it fills the remaining samples without reusing failed runs. Never mix receipts from different source versions.
The comparison tool rejects incomplete receipts. Failed core commands retain a
fixture-only diagnostic beside the receipt and cannot contribute to a median.
The original core harness records medians only. Host trials include real 30- and
60-second idle shutdown observations; they do not enable a cross-command daemon.

Run benchmark groups sequentially. Treat small differences as machine noise,
not guaranteed speedups. The development machine also runs unrelated desktop
applications; these receipts are not controlled low-powered Linux CI results.
Failed runs (missing browser, malformed/truncated baseline output, or host process
exhaustion) were rejected, not included as fast samples. The baseline additional
harness writes stdout to a regular temporary file because its old bridge could
truncate piped JSON at immediate process exit. The changed bridge drains stdout.

The labeled performance workflow compares baseline and candidate on the same
runner and retains receipts. Performance checks warn at a 20% threshold rather
than altering Lens's deterministic product verdict. Its manual `phases_only`
mode runs 24 alternating direct-bridge pairs without building Kujo; use it to
localize startup/readiness regressions. API profiling is confined to benchmark
child processes and is not part of normal Lens execution.

The paired diagnostic alternates run order and retains raw samples. Its fixed-seed
bootstrap interval describes timing uncertainty only; it is never product verdict
logic. Core batch medians and paired follow-ups are both retained, including
slower observations.

## Receipt provenance

- `linux-release-8/`: final acceptance run, eight repetitions per core/runtime
  case on one clean Linux runner; see its provenance receipt for exact commits,
  versions, verification counts and workflow URL.
- `linux-confirmation-3/`: successful earlier three-run confirmation at candidate
  `75416a0b87d8d82ee598428f5b57d8b987fc3e71`, workflow
  [34081707770](https://github.com/kujolang/lens/actions/runs/34081707770). This
  predates the readiness timer correction and is not the final result.
- Root `core-*`, `runtime-*`, `paired.json`, `host.json`, `concurrency.json` and
  `resources.json`: earlier macOS implementation-stage measurements. They explain
  decisions and preserve slower observations; they do not substitute for the
  final Linux source revision.
- `phase-comparison.json`: direct bridge profiling that exposed unnecessary
  readiness round trips; `cli-startup.json` ruled out a material CLI startup
  parsing cost.
- `diagnostic-overhead*`: exploratory removal of duplicate diagnostic fields;
  inconclusive under contention, so that production change was not adopted.
- `core-after-supervised.json` and `supervised-single-checks.json`: rejected
  ordinary-check supervisor variant. Ordinary unconfigured checks remain one-shot.
- `late-local-*`: excluded late desktop batches. The enclosing Codex host
  accumulated over 1,000 unreaped children and encountered process-creation
  failures; startup timings shifted severalfold. Root cause is unverified. Entire
  affected batches are excluded, including successful samples, and carry an
  `excluded_reason` rejected by the comparison tool.

The CI baseline is `504ff55a63440b895bd4ea515612ddde94ea9cdb` (`origin/main`
when dispatched). Its production runtime and fixture are byte-identical to the
initial local baseline `e96fb383366b845c633302a59effd4b3010f4b6e`; the two intervening
commits add only hardening evaluation documentation/artifacts. This equivalence
was verified with `git diff --exit-code` over `bridge`, `src`, `lens`, and the
benchmark fixture server.

The final directory also retains separate alternating API profiles:
`phase-comparison-8.json` is workflow
[34086539771](https://github.com/kujolang/lens/actions/runs/34086539771), candidate
`3eaff7989c67ee347e870508223187362257799c`; `phase-comparison-24.json` is workflow
[34086825049](https://github.com/kujolang/lens/actions/runs/34086825049), candidate
`42c73c3ff12f877ec58b4ad8978c9c587606dc8a`. Both candidates have the same production
runtime as the eight-run acceptance job; intervening commits change CI only.
`phase-analysis.json` describes the fixed-seed paired bootstrap. These profiles
confirm a small cold-process cost and do not alter the main eight-run medians.
