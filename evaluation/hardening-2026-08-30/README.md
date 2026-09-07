# Lens hardening evaluation reproduction guide

This package compares the exact pre-hardening commit `da8740cc6c82631821ae6258af0fc554bc32e468` with the released `v1.0.1` commit `504ff55a63440b895bd4ea515612ddde94ea9cdb`.

## Requirements

- macOS or Linux with Python 3.10+, Node.js 18+, npm, Git, and a release Kujo runtime
- Playwright Chromium installed for the `playwright-core` version in `bridge/package-lock.json`
- a local checkout of the Kujo Eval repository
- at least 2 GiB free disk space for temporary worktrees and browser artifacts

## Prepare exact checkouts

Run from the Lens repository. Choose empty temporary paths and replace the example Kujo/Eval paths for your machine.

```bash
git worktree add --detach /tmp/lens-eval-baseline da8740cc6c82631821ae6258af0fc554bc32e468
git worktree add --detach /tmp/lens-eval-current 504ff55a63440b895bd4ea515612ddde94ea9cdb
(cd /tmp/lens-eval-baseline/bridge && npm ci)
(cd /tmp/lens-eval-current/bridge && npm ci)
```

Both lockfiles resolve the same two direct and two locked dependencies. Use the same Kujo binary, Node version, browser build, and fixture inputs for both targets.

## Run the benchmarks

The runner alternates which version executes first, performs three warmups, records ten measured runs, checkpoints every run, samples process-tree RSS, and stores raw timing records plus one compressed representative output per workload.

```bash
KUJO_BIN=/path/to/kujo/target/release/kujo \
python3 evaluation/hardening-2026-08-30/scripts/run-comparison.py \
  --baseline-root /tmp/lens-eval-baseline \
  --current-root /tmp/lens-eval-current \
  --output /tmp/lens-hardening-results \
  --warmups 3 \
  --samples 10 \
  --fresh
```

Interrupted runs are resumable: repeat the command without `--fresh`. Use `--only workload_a,workload_b` to split execution while retaining the shared checkpoint. The canonical workload names are in `run-comparison.py`.

## Run Kujo Eval

The baseline intentionally fails ten hardening-capability checks; the current release must pass all fourteen. The script validates both manifests and asserts the expected scores.

```bash
evaluation/hardening-2026-08-30/scripts/run-kujo-eval.sh \
  /path/to/kujo-repos/eval \
  /path/to/kujo/target/release/kujo \
  /tmp/lens-eval-baseline \
  /tmp/lens-eval-current \
  /tmp/lens-kujo-eval-results
```

## Build the aggregate JSON

To rebuild the checked-in aggregate, place benchmark outputs at `evaluation/hardening-2026-08-30/results/` and Eval artifacts under its `eval/` directory, then run:

```bash
python3 evaluation/hardening-2026-08-30/scripts/build-results.py \
  --baseline-root /tmp/lens-eval-baseline \
  --current-root /tmp/lens-eval-current \
  --evaluation-root evaluation/hardening-2026-08-30
```

Validate the package:

```bash
python3 -m json.tool evaluation/hardening-2026-08-30/results/evaluation-results.json >/dev/null
python3 -m py_compile evaluation/hardening-2026-08-30/scripts/*.py
git diff --check
```

## Evidence layout

- `results/raw/runs.jsonl`: one raw measurement record per warmup and measured run
- `results/raw/runs.json`: the same records as an array
- `results/benchmark-summary.json`: descriptive statistics for every workload
- `results/evaluation-results.json`: aggregate boundary, environment, scores, measurements, regressions, and conclusion
- `results/eval/{baseline,current}/`: Kujo Eval reports and checksum manifests
- `results/representative/`: gzip-compressed stdout/stderr and representative artifacts

The runner does not call an LLM, external website, or provider. All HTTP traffic stays on loopback.
