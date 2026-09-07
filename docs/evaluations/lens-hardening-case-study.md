# Hardening Lens

## Why we did it

Lens turns browser behavior into deterministic reports for developers and agents. That makes page-controlled console, network, DOM, selector, and path data a trust boundary. Before v1.0.1, several of those evidence arrays had no explicit ceiling, nested redaction was incomplete, and malformed subprocess output could escape the normal provider error contract.

## What changed

The v1.0.1 hardening pass added:

- stable parsing guards around browser and flow subprocess JSON
- validation for auth storage state and artifact write targets
- nested redaction across accessibility, flow, report, URL, and path fields
- per-viewport caps of 1,000 console messages, 2,000 failed network events, and 5,000 links
- 4096×4096 viewport and 100 MiB recording limits
- explicit warnings and dropped counts whenever evidence is truncated
- broader compatibility, E2E, and performance CI

The npm dependency graph did not change.

## How we measured it

We compared the exact hardening-branch parent, `da8740c`, with released `v1.0.1`, `504ff55`. This avoids crediting three earlier performance commits to the hardening pass.

Both versions used the same Kujo release binary, Node/Playwright installation, loopback fixtures, inputs, and flags. Each workload received three warmups and ten measured runs with alternating execution order. We recorded latency distributions, process-tree RSS, output/artifact bytes, exit codes, and evidence counts. A dedicated Kujo Eval suite tested fourteen hardening and correctness properties.

The host was shared, so small timing changes were treated conservatively and assessed with a 10,000-resample bootstrap interval.

## Before vs after

| Metric | Before | After | Change |
|---|---:|---:|---:|
| Hardening Eval | 4/14 | 14/14 | +10 passes |
| Console-stress stdout | 825,241 B | 165,634 B | -79.9% |
| 10,000-link stdout | 681,131 B | 341,524 B | -49.9% |
| 10,000-link median | 3.750s | 3.230s | -13.9% |
| 10,000-link sampled peak RSS | 479.0 MiB | 443.0 MiB | -7.5% |
| Typical quick median | 4.245s | 4.830s | +13.8% |
| Typical full median | 5.610s | 6.415s | +14.3% |
| Kujo assertions | 398 | 448 | +50 |
| Bridge tests | 15 | 18 | +3 |
| Direct / locked dependencies | 2 / 2 | 2 / 2 | unchanged |

All general test suites passed in every one of ten repetitions for both versions.

## Biggest improvements

The most important result is not a small average speedup. It is a hard ceiling on context-amplifying page evidence.

A fixture that emitted 5,000 console errors produced 825 KB of bridge JSON before hardening. Current retained 1,000 errors, reported that 4,000 were omitted, and produced 166 KB. Both runs completed successfully.

At 10,000 links, baseline serialized all 10,000 while current retained 5,000 and disclosed the truncation. That halved stdout, reduced sampled process-tree RSS by 36 MiB, and cut median runtime by 520ms. Below the 5,000-link threshold, differences were mostly inconclusive; the improvement appears where the new bound activates.

## What surprised us

Normal paths were slower. The quick profile added 585ms at the median, and the default two-viewport path added 805ms. Those results survived the bootstrap classification despite a noisy shared host. The hardened release also adds 334 source lines and 201 test lines.

That is an acceptable direction only if the safety properties matter—and for an agent-facing browser evidence tool, they do—but it is still a regression worth profiling.

## What did not improve

- Dependency footprint stayed at two direct and two locked packages.
- Agent-facing terminal output stayed at 267 bytes on the failing quick workload.
- Agent-facing runtime was statistically inconclusive: 9.095s versus 9.260s.
- Token and model cost did not improve because Lens invokes no LLM; those metrics are not applicable.
- Most below-threshold scaling timings were inconclusive.

## What remains

The next high-value step is a repeat on a quiescent dedicated runner, followed by phase-level profiling of validation, redaction, checks, and report generation. The goal should be to recover normal-path latency without weakening evidence bounds or disclosure protections.

## Reproducing the results

The repository contains the exact fixtures, runner, Kujo Eval suite, raw records, representative artifacts, verified manifests, and aggregate JSON in [`evaluation/hardening-2026-08-30/`](../../evaluation/hardening-2026-08-30/README.md).

## Verdict

**PARTIALLY.** v1.0.1 is empirically better engineered for boundedness, failure handling, and agent evidence. It is not uniformly faster or smaller, and the normal-path latency regressions prevent an unqualified “better on every axis” conclusion.
