# Lens v1.0.1 before/after hardening evaluation

Evaluation date: 2026-08-30  
Baseline: `da8740cc6c82631821ae6258af0fc554bc32e468`  
Current: `504ff55a63440b895bd4ea515612ddde94ea9cdb` (`v1.0.1`)  
Overall conclusion: **PARTIALLY**

## Executive summary

Lens v1.0.1 is demonstrably safer and more predictable under hostile or unusually large browser evidence, but it is not uniformly faster. The hardening pass added trust-boundary parsing, nested redaction, auth-envelope validation, safe write-target validation, bounded browser evidence, recording limits, explicit overwrite behavior, expanded compatibility CI, and a reproducible performance gate. It did not change Lens's dependency graph or its core deterministic, no-LLM architecture.

The strongest measured gain is bounded output under scaling and stress. On a page emitting 5,000 console errors, direct bridge stdout fell from 825,241 bytes to 165,634 bytes, a 79.9% reduction, while both versions completed successfully. Current retained the first 1,000 messages and reported that 4,000 were dropped; baseline retained all 5,000 without a bound. At 10,000 visible links, current capped retained links at 5,000 and recorded truncation. Median runtime fell from 3.750s to 3.230s (13.9%), sampled process-tree peak RSS fell from 479.0 MiB to 443.0 MiB (7.5%), and stdout fell from 681,131 to 341,524 bytes (49.9%). A 10,000-resample bootstrap classified that runtime result as a clear improvement.

The hardening-specific Kujo Eval suite improved from 4/14 checks (28.6%) to 14/14 (100%). Both versions still passed their complete pre-existing correctness suites on every one of ten measured repetitions. Current increased the Kujo assertion count from 398 to 448 and bridge tests from 15 to 18. This is evidence of added coverage and capability, not merely a score assigned by inspection.

Normal-path latency moved the other way. Median `lens check --quick` time rose from 4.245s to 4.830s (+13.8%, bootstrap median-difference interval +0.310s to +0.935s). The default two-viewport check rose from 5.610s to 6.415s (+14.3%, interval +0.035s to +1.285s). The agent-facing quick workload remained statistically inconclusive at 9.095s versus 9.260s, with identical 267-byte terminal output and a 345-byte artifact increase. These regressions are small compared with the new hard bounds' protection against unbounded growth, but they are real in this dataset and should not be hidden.

The host was shared with other local compilation and benchmark workloads. Alternating version order, three warmups, ten measured runs, variance reporting, and bootstrap intervals reduce ordering bias but cannot remove shared-host noise. One current 100-link run took 17.72s while its median was 2.75s; this is why the report classifies many small differences as inconclusive and recommends confirmation on a dedicated runner.

For actual users, v1.0.1 is a better failure-containment and agent-evidence release: it limits context-amplifying output, discloses truncation, prevents unsafe output targets, and produces safer diagnostics. It is not an across-the-board performance release. Users with ordinary small pages may pay roughly 0.6–0.8 seconds in the tested quick/default paths; users or agents encountering noisy and very large pages gain bounded memory/output behavior and a better scaling ceiling.

## Before/after scorecard

| Metric | Baseline | Current | Change | Assessment |
|---|---:|---:|---:|---|
| Kujo Eval hardening checks | 4/14 | 14/14 | +10 passes | Clear improvement |
| Kujo assertions, repeated 10× | 398 passed | 448 passed | +50; zero failures | Clear coverage gain |
| Bridge tests, repeated 10× | 15 passed | 18 passed | +3; zero failures | Clear coverage gain |
| 5,000-console stress stdout | 825,241 B | 165,634 B | -659,607 B (-79.9%) | Clear improvement |
| Console messages retained | 5,000 | 1,000 + 4,000 dropped count | bounded | Clear improvement |
| 10,000-link median runtime | 3.750s | 3.230s | -0.520s (-13.9%) | Clear improvement |
| 10,000-link p95 runtime | 3.867s | 3.436s | -0.431s (-11.1%) | Clear improvement |
| 10,000-link median total CPU | 5.175s | 4.440s | -0.735s (-14.2%) | Likely improvement |
| 10,000-link derived throughput | 0.267 ops/s | 0.310 ops/s | +16.1% | Derived improvement |
| 10,000-link sampled peak RSS | 479.0 MiB | 443.0 MiB | -36.0 MiB (-7.5%) | Likely improvement |
| 10,000-link stdout | 681,131 B | 341,524 B | -339,607 B (-49.9%) | Clear improvement |
| Typical quick median runtime | 4.245s | 4.830s | +0.585s (+13.8%) | Regression |
| Typical quick median total CPU | 4.575s | 5.085s | +0.510s (+11.1%) | Regression |
| Typical full median runtime | 5.610s | 6.415s | +0.805s (+14.3%) | Regression |
| Agent-facing median runtime | 9.095s | 9.260s | +0.165s (+1.8%) | Inconclusive |
| Agent-facing terminal output | 267 B | 267 B | unchanged | Neutral |
| Missing-auth diagnostic output | 143 B | 52 B | -91 B (-63.6%) | Clear noise/privacy gain |
| Direct dependencies | 2 | 2 | unchanged | Neutral |
| Locked dependencies | 2 | 2 | unchanged | Neutral |
| Source lines | 8,925 | 9,259 | +334 (+3.7%) | Safety complexity added |
| Test lines | 1,818 | 2,019 | +201 (+11.1%) | Coverage added |
| Tracked tree size | 1,664,360 B | 1,729,549 B | +65,189 B (+3.9%) | Tradeoff |

All latency rows use ten measured runs after three warmups per version. “Sampled peak RSS” is the whole observed process tree at approximately 250ms intervals; short-lived peaks can be missed.

## Evaluation boundary

### Current

- Branch evaluated: detached exact release checkout
- Commit: `504ff55a63440b895bd4ea515612ddde94ea9cdb`
- Commit timestamp: 2026-08-30T18:47:01-04:00
- Tag: `v1.0.1` (annotated tag peeled to the commit above)
- Worktree: clean before the evaluation package was created

### Baseline

- Commit: `da8740cc6c82631821ae6258af0fc554bc32e468`
- Commit timestamp: 2026-08-11T16:03:31-04:00
- Subject: `perf: prefer release runtime and document fast path`
- Selection evidence: the `codex/repository-hardening` reflog records `branch: Created from HEAD` at this exact SHA on 2026-08-30T17:19:15-04:00. The first hardening commit is its child, `abb0c0f`.

This is more defensible than using `v1.0.0`: the quick profile, `playwright-core` slimming, and release-runtime preference landed after v1.0.0 but before the dedicated hardening branch. Including those commits in “current only” would have falsely attributed earlier performance work to this hardening pass.

## What changed and why

### Trust-boundary and diagnostic hardening

**Observed:** `abb0c0f` wrapped browser and flow bridge JSON parsing so malformed or non-object output becomes a stable provider failure instead of an uncaught parse error. It also validates Playwright storage-state structure before browser handoff, redacts nested accessibility evidence and page-controlled report fields, uses explicit overwrite for generated artifacts, and tokenizes GitHub Action arguments with Python `shlex` rather than shell interpolation.

The previous design trusted subprocess JSON and partially redacted some nested structures. A malformed bridge response could escape the documented exit contract, while page-controlled selector/error text and path-bearing diagnostics could reach artifacts. The new design moves checks to the process and artifact boundaries. The intended metrics are failure correctness, diagnostic size, evidence privacy, and deterministic exit behavior—not happy-path speed.

**Measured:** the missing-auth failure remained exit code 2 in both versions, but stdout fell 143 B to 52 B and the baseline failed the Eval “path is not disclosed” check while current passed. Median failure latency increased 0.280s to 0.365s; the added validation/redaction path costs about 85ms on this host.

### Bounded evidence and artifacts

**Observed:** `bef1a45` introduced per-viewport bounds of 1,000 console messages, 2,000 failed network events, 5,000 links, 4096×4096 custom viewport dimensions, and 100 MiB recordings. Dropped evidence is counted and converted to a warning rather than silently discarded. It also validates output destinations against roots, working directories, parent traversal, existing files, and final-target symlinks.

The previous bridge appended page-controlled arrays without a ceiling. That made memory, serialization, output, and downstream agent context proportional to arbitrary page noise. The new bridge changes growth from unbounded in those dimensions to a documented constant ceiling per viewport. The tradeoff is extra metadata on every bridge response and incomplete evidence above the ceiling; the warning preserves that limitation for reviewers.

**Measured:** the console stress output reduction was 79.9%. The 10,000-link workload halved stdout, reduced sampled peak RSS 7.5%, and improved median runtime 13.9%. At or below 5,000 links, runtime changes were mostly inconclusive; this is consistent with a ceiling that changes behavior only after the threshold.

### CI and benchmark reproducibility

**Observed:** `e397af3` added Linux/macOS and Node 18/20/22 bridge compatibility, expanded real-browser E2E assertions, added a scheduled/manual performance workflow, replaced the previous benchmark with deterministic fixtures, and added machine-readable baseline comparison. These changes affect defect detection and repeatability rather than shipped runtime.

**Measured:** the evaluation in this report uses exact checkouts, a shared fixture server, alternating order, checkpointed raw records, ten samples, and Kujo Eval artifacts with verified SHA-256 manifests. No runtime gain is attributed to this commit.

### Documentation and release metadata

`f5f52c8`, `e6394d1`, and `504ff55` document the audit, align manifests/spec/docs, and publish v1.0.1 metadata. They do not materially change the benchmarked execution path, except that the package/version strings changed. They are classified as observed maintainability/release changes, not performance improvements.

## Benchmark methodology

### Environment

| Field | Value |
|---|---|
| OS | macOS 26.3.1, Darwin 25.3.0, x86_64 |
| CPU | Intel Core i7-9750H, 6 physical / 12 logical cores |
| RAM | 16 GiB |
| Kujo | 1.0.0 release binary, identical for both targets |
| Node / npm | v24.20.0 / 11.19.0 |
| Python | 3.10.5 |
| Rust / Cargo | 1.96.0 / 1.96.0 |
| Browser dependency | `playwright-core` 1.60.0, identical installation |
| Provider/model | None; Lens invokes no LLM |
| Network | Loopback HTTP only; no external calls |

Both exact worktrees used the same installed dependencies, Kujo binary, fixture server, flags, input URLs, and browser installation. Each workload had three warmups and ten measured runs per version. First position alternated by workload and round. `/usr/bin/time -l` supplied command CPU and direct-process max-RSS data; a process-tree sampler observed aggregate RSS approximately every 250ms. The report uses medians for comparison and also records minimum, maximum, mean, standard deviation, and p95. With `n=10`, p99 is not reported.

Total CPU is recorded as user plus system CPU reported for the launched command and its waited descendants; it can exceed wall time because browser processes run concurrently. Throughput is derived as one completed workload operation divided by median wall time, not measured under concurrent request load.

The confidence classification uses a deterministic 10,000-resample bootstrap of the difference between independent medians:

- upper 95% bound below zero: clear improvement
- lower 95% bound above zero: regression
- interval spanning zero: inconclusive

The machine was shared with other active local tasks. A current 100-link outlier reached 17.72s while the median was 2.75s. Absolute timings and small differences should therefore be rechecked on a dedicated runner.

### Workloads

| Class | Workload | Purpose |
|---|---|---|
| Minimal | version; one-viewport trivial bridge | startup and fixed overhead |
| Typical | quick and default checks on a 40-card/100-link page | normal developer use |
| Large | direct bridge with 1,000 links | larger serialization/DOM input |
| Stress | 5,000 console errors; 2,200 failed requests | output and evidence amplification |
| Failure | missing auth storage-state file | failure latency and diagnostic noise |
| Agent-facing | quick JSON run with deterministic findings | terminal bytes, artifacts, completion |
| Scaling | 10, 100, 1,000, 5,000, 10,000 links | threshold and scaling curve |
| Reliability | Kujo and Node test suites | repeated correctness and flake signal |

### Full wall-time statistics

| Workload | Version | n | Min | Max | Mean | Median | SD | p95 | Classification |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| startup_version | baseline | 10 | 0.190 | 0.260 | 0.216 | 0.215 | 0.023 | 0.251 | |
| startup_version | current | 10 | 0.190 | 0.240 | 0.208 | 0.210 | 0.015 | 0.231 | Inconclusive |
| minimal_bridge | baseline | 10 | 3.020 | 4.230 | 3.511 | 3.445 | 0.367 | 4.109 | |
| minimal_bridge | current | 10 | 3.110 | 5.030 | 3.850 | 3.580 | 0.723 | 4.868 | Inconclusive |
| typical_quick_cli | baseline | 10 | 4.010 | 4.850 | 4.303 | 4.245 | 0.243 | 4.670 | |
| typical_quick_cli | current | 10 | 4.410 | 5.520 | 4.900 | 4.830 | 0.321 | 5.362 | Regression |
| typical_full_cli | baseline | 10 | 5.040 | 6.800 | 5.624 | 5.610 | 0.503 | 6.377 | |
| typical_full_cli | current | 10 | 5.460 | 6.850 | 6.243 | 6.415 | 0.517 | 6.827 | Regression |
| large_links_bridge | baseline | 10 | 3.380 | 7.460 | 4.600 | 4.450 | 1.202 | 6.497 | |
| large_links_bridge | current | 10 | 3.340 | 4.930 | 4.241 | 4.305 | 0.452 | 4.795 | Inconclusive |
| stress_console_bridge | baseline | 10 | 4.220 | 6.640 | 5.250 | 5.375 | 0.857 | 6.374 | |
| stress_console_bridge | current | 10 | 4.520 | 6.320 | 5.457 | 5.275 | 0.622 | 6.244 | Inconclusive |
| stress_network_bridge | baseline | 10 | 6.260 | 9.920 | 7.123 | 6.635 | 1.138 | 9.042 | |
| stress_network_bridge | current | 10 | 6.100 | 8.000 | 6.912 | 6.710 | 0.676 | 7.973 | Inconclusive |
| failure_invalid_auth | baseline | 10 | 0.260 | 0.300 | 0.280 | 0.280 | 0.011 | 0.295 | |
| failure_invalid_auth | current | 10 | 0.330 | 0.410 | 0.367 | 0.365 | 0.021 | 0.396 | Regression |
| agent_quick_json | baseline | 10 | 8.500 | 11.000 | 9.345 | 9.095 | 0.768 | 10.671 | |
| agent_quick_json | current | 10 | 8.870 | 9.820 | 9.310 | 9.260 | 0.322 | 9.771 | Inconclusive |
| kujo_test_suite | baseline | 10 | 8.160 | 15.110 | 11.049 | 11.125 | 2.004 | 13.926 | |
| kujo_test_suite | current | 10 | 10.410 | 14.130 | 12.802 | 13.170 | 1.286 | 14.062 | Regression |
| bridge_test_suite | baseline | 10 | 5.380 | 9.260 | 6.812 | 6.885 | 1.156 | 8.423 | |
| bridge_test_suite | current | 10 | 5.800 | 11.930 | 8.732 | 8.555 | 2.133 | 11.723 | Inconclusive |
| scale_links_10 | baseline | 10 | 2.500 | 3.240 | 2.691 | 2.635 | 0.227 | 3.096 | |
| scale_links_10 | current | 10 | 2.480 | 4.660 | 2.840 | 2.560 | 0.664 | 3.890 | Inconclusive |
| scale_links_100 | baseline | 10 | 2.510 | 2.700 | 2.631 | 2.630 | 0.060 | 2.700 | |
| scale_links_100 | current | 10 | 2.560 | 17.720 | 4.290 | 2.750 | 4.723 | 11.168 | Inconclusive |
| scale_links_1000 | baseline | 10 | 2.920 | 4.730 | 3.690 | 3.560 | 0.581 | 4.645 | |
| scale_links_1000 | current | 10 | 3.080 | 3.700 | 3.361 | 3.280 | 0.220 | 3.678 | Inconclusive |
| scale_links_5000 | baseline | 10 | 3.360 | 3.920 | 3.579 | 3.545 | 0.195 | 3.866 | |
| scale_links_5000 | current | 10 | 3.340 | 4.030 | 3.671 | 3.630 | 0.234 | 4.017 | Inconclusive |
| scale_links_10000 | baseline | 10 | 3.660 | 3.930 | 3.749 | 3.750 | 0.075 | 3.867 | |
| scale_links_10000 | current | 10 | 3.090 | 3.440 | 3.259 | 3.230 | 0.141 | 3.436 | Clear improvement |

## Scaling analysis

Below 5,000 links the cap is inactive, so both implementations retain the same evidence and their median differences are small or noisy. At 10,000 links the baseline continues to serialize all 10,000 entries while current stops at 5,000 and reports the omitted count. This creates a visible step change rather than a new general algorithmic curve:

| Links in DOM | Baseline retained | Current retained | Baseline stdout | Current stdout | Median runtime change |
|---:|---:|---:|---:|---:|---:|
| 10 | 10 | 10 | 2,021 B | 2,408 B | -2.8%, inconclusive |
| 100 | 100 | 100 | 8,511 B | 8,898 B | +4.6%, inconclusive |
| 1,000 | 1,000 | 1,000 | 69,121 B | 69,508 B | -7.9%, inconclusive |
| 5,000 | 5,000 | 5,000 | 341,123 B | 341,510 B | +2.4%, inconclusive |
| 10,000 | 10,000 | 5,000 | 681,131 B | 341,524 B | -13.9%, clear improvement |

Baseline storage/output remains approximately linear in page evidence. Current is linear until the configured ceiling and approximately constant thereafter for retained link evidence. The DOM query itself still visits anchors until the cap is reached; this is bounded output, not proof of constant total page-processing cost.

## Token, context, and agent efficiency

Lens does not call an LLM. Input tokens, completion tokens, cached tokens, provider cost, and model context are therefore **not applicable**, not zero-cost estimates. No dollar savings are claimed.

Agent-facing byte measurements are still relevant:

- Typical quick terminal output stayed at 272 B.
- The failing agent-facing quick workload stayed at 267 B and one CLI invocation; median runtime difference was inconclusive.
- Current quick artifacts grew 345 B (63,601 B to 63,946 B, +0.54%) because limit metadata/check results are retained.
- Direct bridge output gained 387 B on a trivial page (1,311 B to 1,698 B) for limit metadata.
- That fixed metadata cost buys a 659,607 B reduction per 5,000-console-error run and a 339,607 B reduction per 10,000-link run.

Operational byte model, without pretending bytes equal tokens:

| Workload | Saved/run | 100 runs | 1,000 runs | 10,000 runs |
|---|---:|---:|---:|---:|
| 5,000 console errors | 659,607 B | 65.96 MB | 659.61 MB | 6.60 GB |
| 10,000 links | 339,607 B | 33.96 MB | 339.61 MB | 3.40 GB |

Reasoning/action cycles, model retries, cached context, and semantic task-quality scores are not demonstrated because no model participates. Tool-call count was one command per measured workload; subprocess counts were not instrumented.

## Kujo Eval report

The checked-in suite uses Kujo Eval's real deterministic checks. It does not assign subjective 1–10 scores. Scores below are pass counts derived from Eval results; tag categories overlap.

| Eval category | Baseline | Current | Change |
|---|---:|---:|---:|
| Correctness | 2/2 (100%) | 2/2 (100%) | unchanged |
| Context efficiency | 0/4 (0%) | 4/4 (100%) | +4 passes |
| Reliability | 3/10 (30%) | 10/10 (100%) | +7 passes |
| Failure behavior | 1/6 (16.7%) | 6/6 (100%) | +5 passes |
| Agent usability | 1/5 (20%) | 5/5 (100%) | +4 passes |
| Overall unique checks | 4/14 (28.6%) | 14/14 (100%) | +10 passes |

The baseline passes both correctness suites, version output, and missing-auth exit contract. It fails the new redaction, bound, safe-path, malformed-provider, truncation-warning, and overwrite capability checks. Current passes all. Both artifact manifests were independently verified by Kujo Eval: seven checksum entries each.

This suite is deliberately about the hardening properties. It is not an independent general product-quality score, and the baseline's low overall percentage should not be read as “Lens was 28.6% correct.”

The raw baseline Markdown report contains an unrelated Kujo Eval rendering defect: it displays “Pass Rate 0%” despite structured `passed: 4` and `total: 14` fields. This report uses the authoritative counts to derive 28.6%. The bug belongs to the sibling Eval repository and is recorded as a cross-repository follow-up; Lens was not changed to mask it.

## Reliability and determinism

**Measured:** every one of ten baseline and ten current Kujo-suite runs passed. Every one of ten baseline and ten current bridge-suite runs passed. No flake, crash, timeout, or unexpected exit occurred in those repetitions.

Current test runtime rose because it executes 50 additional Kujo assertions and three additional bridge tests. Median Kujo-suite time increased from 11.125s to 13.170s; bridge-suite median increased from 6.885s to 8.555s, although the latter bootstrap interval spans zero under host noise.

For representative runtime workloads, exit codes, stdout byte counts, and artifact byte counts were stable across all ten samples. Raw stdout hashes differed because reports contain timestamps and temporary paths. This demonstrates stable outcome/shape sizing, not bit-for-bit deterministic artifacts.

## Build, dependency, and artifact footprint

Lens owns interpreted Kujo and JavaScript source, not a compiled binary. Clean build time, incremental build time, release-link time, and owned binary size are therefore not applicable. Both versions used the same external 27.7 MB release Kujo runtime; attributing its size or build cost to Lens would be misleading.

The npm graph is unchanged at two direct and two locked dependencies (`axe-core`, `playwright-core`). No dependency reduction was demonstrated.

The hardening adds code and repository artifacts:

| Structural metric | Baseline | Current | Change |
|---|---:|---:|---:|
| Tracked files | 67 | 74 | +7 (+10.4%) |
| Code files | 23 | 23 | unchanged |
| Code lines | 11,828 | 12,469 | +641 (+5.4%) |
| Source lines | 8,925 | 9,259 | +334 (+3.7%) |
| Test lines | 1,818 | 2,019 | +201 (+11.1%) |
| Function declarations | 449 | 472 | +23 (+5.1%) |
| TODO/FIXME markers | 0 | 0 | unchanged |
| Tracked tree bytes | 1,664,360 | 1,729,549 | +65,189 (+3.9%) |
| Gzip-compressed Git archive | 1,143,682 B | 1,162,196 B | +18,514 B (+1.6%) |

Complexity was added rather than removed: validation and boundary logic grew, test coverage grew faster than source, and the number of code files stayed flat. The new complexity is localized in existing bridge/validation/report modules instead of creating a new abstraction layer. Cyclomatic complexity, duplicate-code percentage, and allocation counts were not measured reliably and are not claimed.

## Change-to-result mapping

| Code change | Behavioral change | Measured result | Evidence class |
|---|---|---|---|
| `bef1a45`: console cap + dropped count | Retains 1,000 of 5,000 messages and signals omission | 825,241 B → 165,634 B (-79.9%); same exit success | Measured |
| `bef1a45`: 5,000-link cap | Stops retained evidence growth above threshold | 10,000-link stdout -49.9%, median -13.9%, RSS -7.5% | Measured |
| `abb0c0f`: generic auth validation errors | Path no longer reaches terminal output | 143 B → 52 B; Eval fail → pass | Measured |
| `abb0c0f`: malformed bridge guards | Converts parse exceptions to stable provider results | Baseline Eval fail → current pass; current unit suite passes | Measured/observed |
| `abb0c0f` + `bef1a45`: nested redaction | Sweeps accessibility, flow, paths, URLs, and findings | Hardening Eval redaction checks pass; 448 assertions pass | Measured |
| `bef1a45`: write-target and recording limits | Rejects unsafe final targets and oversized recordings | Hardening Eval checks pass; bridge tests 15 → 18 | Measured |
| `e397af3`: benchmark and CI matrices | Makes compatibility/performance drift observable | Reproduction package runs; no shipped runtime claim | Observed |

The console and 10,000-link graphs move because fewer page-controlled records are retained and serialized. The fixed tradeoff is roughly 387 B of limit metadata in ordinary direct bridge JSON and small additional validation/report work on normal checks.

## Commit attribution

| Commit | Change | Intended effect | Observed/measured effect |
|---|---|---|---|
| `abb0c0f` | Provider/flow guards, auth validation, nested redaction, Action argument tokenization | Stable failures and reduced disclosure/injection risk | Missing-auth output -63.6%; relevant Eval capabilities pass in current |
| `f5f52c8` | Hardening audit document | Reviewability | No runtime effect attributed |
| `bef1a45` | Evidence/viewport/video bounds, write-path validation, truncation warnings | Bound memory/output/disk and preserve warning evidence | Console output -79.9%; 10k-link stdout -49.9%, runtime -13.9%, RSS -7.5% |
| `e397af3` | Compatibility, E2E, and performance CI | Detect drift and improve reproducibility | Benchmark/Eval comparison reproducible; no runtime effect attributed |
| `e6394d1` | Docs, manifests, spec alignment | Release maintainability | No runtime effect attributed |
| `504ff55` | v1.0.1 release metadata | Accurate published release | Version/package alignment; no material runtime effect |

## Top improvements

1. **Unbounded page evidence became bounded and explicit.** This prevents a noisy page from linearly consuming agent context and bridge memory without a ceiling. The 79.9% console-output reduction is operationally larger than any small normal-path timing change.
2. **Very-large link evidence crossed to a better scaling regime.** Above 5,000 retained links, current stops growing the output array; at 10,000 links it halved stdout, cut sampled RSS 7.5%, and improved median time 13.9%.
3. **Hardening capabilities became executable contracts.** Kujo Eval moved from 4/14 to 14/14 while both general correctness suites remained green.
4. **Failure output became smaller and less revealing.** Missing-auth output fell 63.6% and no longer disclosed the supplied path.
5. **Compatibility and regression detection expanded.** CI now covers six OS/Node combinations plus broader E2E/performance workflows.

## Regressions and tradeoffs

| Metric | Baseline | Current | Severity | Likely cause | Disposition |
|---|---:|---:|---|---|---|
| Typical quick median | 4.245s | 4.830s | Low | Additional validation, redaction, limit bookkeeping; shared-host noise | Confirm on dedicated runner; retain safety checks |
| Typical full median | 5.610s | 6.415s | Low | Same | Confirm and profile report/redaction stages |
| Missing-auth median | 0.280s | 0.365s | Low | Structured validation and generic error path | Accept 85ms for smaller/private diagnostic |
| Kujo test median | 11.125s | 13.170s | Low | 50 additional assertions | Accept as coverage cost |
| Minimal bridge JSON | 1,311 B | 1,698 B | Low | Evidence-limit metadata | Accept; enables explicit truncation |
| Typical quick artifacts | 58,184 B | 58,529 B | Low | New evidence/check metadata | Accept (+0.59%) |
| Source/repository size | 8,925 source lines / 1,664,360 B | 9,259 / 1,729,549 B | Low | Validation, tests, CI, docs | Accept with continued complexity review |

No functional regression or test failure was identified. Normal-path latency regressions were identified and are reported rather than dismissed. Network-stress timing/output is inconclusive because the fixture completed different request counts under shared-host contention; it is retained in raw evidence but not used as a headline claim.

## Remaining opportunities

- **P0:** none demonstrated.
- **P1:** repeat the complete runtime matrix on a dedicated, quiescent runner to confirm the +13.8% quick and +14.3% full-check medians and eliminate the 17.72s outlier source.
- **P1:** add phase timing around validation, bridge execution, redaction, checks, and report writing; optimize only the measured normal-path stage without weakening bounds.
- **P2:** add deterministic completed-request accounting to the network-stress fixture so baseline/current event counts are guaranteed identical before output comparison.
- **P2:** record subprocess count and process-tree CPU, not only direct-process CPU and sampled RSS.
- **P2 (cross-repository):** fix Kujo Eval's partial-suite percentage rendering and add a 4/14 regression fixture; its structured counts are already correct.
- **P3:** consider compacting always-present evidence-limit metadata only if it preserves explicit ceilings and dropped counts.

## Evidence and reproduction

The reproducibility package is in [`evaluation/hardening-2026-08-30/`](../../evaluation/hardening-2026-08-30/README.md). It contains exact workload definitions, a deterministic loopback fixture server, checkpointed raw records, descriptive statistics, representative compressed outputs/artifacts, the Kujo Eval suite, verified manifests, and [`evaluation-results.json`](../../evaluation/hardening-2026-08-30/results/evaluation-results.json).

Run records preserve command outcome, wall/user/system time, direct RSS, sampled process-tree RSS, stdout/stderr bytes, artifact counts/bytes, hashes, and parsed evidence counts. No inconvenient result was deleted; setup-invalid Eval attempts were excluded before the clean canonical run and are not part of the result set.

## Final question

> If we erase the commit messages and ignore what the hardening work intended to accomplish, does the empirical evidence independently demonstrate that CURRENT is a better engineered version than BASELINE?

**PARTIALLY.**

The evidence independently shows materially better boundedness, lower worst-case output, lower large-link memory, safer diagnostics, more executable reliability properties, and unchanged task success. It also shows statistically supported normal-path latency regressions and added code/artifact size. Current is better engineered for containment, reliability, and agent evidence, but the data does not justify the broader claim that it is uniformly faster, leaner, or better on every axis.
