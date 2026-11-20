# Lens hardening audit · 2026-11-20

Lens runs deterministic browser QA, flows, and visual comparisons for humans and
agents. The review covered `kujolang/lens` on `main` from
`91049646d70c11bf0c6071f39cf7dfac6b1ba70b` through code commit
`87696f675558fd928588db8f4bbf724b4f511980`. The main boundaries are the
Kujo CLI, Node and Playwright browser bridges, Python image comparison, and
local filesystem artifacts. Integration consumers include Spec, Eval,
RunLedger, Howl, and the GitHub composite action.

## Baseline and scope

The starting tree contained an untracked investor-deck QA output directory,
which was excluded from the review. The starting code passed 534 Kujo
assertions, 58 Node tests with real Chromium, 18 real CLI E2E groups, two visual
comparison tests, and four benchmark-harness checks. The npm audit returned
zero known production advisories. The baseline benchmark ran from a Git
archive of the starting commit using the same installed Kujo, Node, browser
driver and Chromium as the candidate. Previous hardening reports remain
available in this directory.

## Findings and changes

| ID | Priority | Area | Evidence and resolution | Status |
|---|---|---|---|---|
| H11-01 | P0 | Browser transport | `src/provider.kujo`, `src/flow_exec.kujo`, and inspect inherited Kujo's 1 MiB child-output limit even though the bridge allowed 16 MiB. They now request the bridge's limit and recognize transport truncation. Oversized Node results return a structured failure, including through the session socket, so the provider treats the failure as authoritative. A two-viewport browser fixture exceeds 1 MiB and completes successfully. | Fixed |
| H11-02 | P0 | Artifact integrity | `src/runner.kujo` deleted existing reports before writing and used file existence or ignored results in several command paths. Structured reports, check evidence, flow artifacts, inspect output, and Howl now check atomic writes. The CLI exits 4 when a requested write fails. Fixtures cover blocked destinations in check, flow, and inspect, plus long valid names for direct Eval and Howl outputs. | Fixed |
| H11-03 | P0 | Flow verdicts | A full console buffer could hide subsequent errors while `assert_no_console_errors` still passed. Explicit absence assertions fail when the evidence needed to verify them was dropped. The Chromium fixture fills the console buffer before emitting a final error. | Fixed |
| H11-04 | P0 | Visual integrity | `src/visual.kujo` looked up screenshots by existence and supplied a diff path even when Python produced no current diff. Failed captures can no longer consume old PNGs. Only current diff paths reach the artifact inventory. Baseline replacements stage the new PNG before renaming, and identifiable baselines cannot be reused for a different redacted URL. Tests cover stale evidence, historical metadata compatibility, and identity collisions. | Fixed |
| H11-05 | P1 | RunLedger | `src/integrations.kujo` rewrote the entire ledger for every record, and the runner logged success even when the size guard rejected the write. Native append preserves existing bytes and retains legacy newline repair and the 8 MiB budget. The caller now returns exit 4 on failure. | Fixed |
| H11-06 | P1 | Watch and agent output | A 30-second subprocess ceiling shortened long watch waits. Watch now uses native sleep, with periodic supervisor checks during long waits. Verbose check diagnostics use stderr and successful JSON watch reports omit banners. The suite parses verbose check stdout and consecutive watch receipts. | Fixed |
| H11-07 | P1 | Destination integrity | `src/validate.kujo` checked trimmed path strings even though writers received the original paths. Direct output aliases and absolute working-directory aliases now share a consistent POSIX path check. Tests verify aliased destinations produce an input error. | Fixed |
| H11-08 | P1 | Proxy lifecycle | `bridge/network-policy.js` piped interrupted HTTP response bodies without propagating failure downstream. The proxy now closes interrupted responses so clients can report them promptly. A fixture tests disconnect after headers and partial body. | Fixed |
| H11-09 | P2 | Flow artifact inventory | Walkthroughs were added to the inventory after the reports were serialized. The flow now uses the same condition for creating and listing walkthroughs. E2E checks the recorded flow metadata. | Fixed |

## Review coverage

| Phase | Evidence and disposition |
|---|---|
| 0 · Repository | Traced `lens` → Kujo command/config dispatch → provider/flow/inspect → redaction, findings, report and optional integrations. Reviewed README, reference, examples, manifests and workflows alongside implementation. |
| 1 · Baseline | Recorded original tests, dependency audit and sample-fixture benchmarks on macOS x86_64. |
| 2 · Complexity | Replaced duplicate delete/write/check sequences with the same checked primitive and shared browser-result parsing across command paths. |
| 3 · Runtime | Reviewed readiness loops, viewport scheduling, bounded crawl and link requests, session reuse, and retry conditions. Oversized results now terminate the attempt deterministically. |
| 4 · Resources | Checked viewport, evidence, structured-file and recording bounds. Aligned forwarding ceilings and removed ledger-size-dependent rewrites. |
| 5 · Agent context | Checked the compact stdout receipt, Agent Repair Brief, full reports and their finding projections. Existing consumers still have access to detailed evidence on demand. |
| 6 · Command output | Separated verbose check status lines from JSON receipts. Verified consecutive JSON watch receipts. |
| 7 · Failure semantics | Reviewed provider errors, malformed output, optional writes, incomplete flow evidence, and visual result status. Added boundary regressions. |
| 8 · Security | Reviewed loopback destination admission, subprocess arguments, controlled artifact paths, flow opt-ins, secret-bearing inputs, redaction and HTML escaping. Verified with fixture-only checks. |
| 9 · State | Reviewed browser/context lifetime, Unix IPC, cancellation, watch/supervisor behavior, baseline replacement and ledger appends. Kept the documented dedicated-output-directory contract. |
| 10 · Contracts | Compared practical configuration, CLI, report, flow and integration behavior against public docs and tests. |
| 11 · Supply chain | Reviewed the pinned npm lock, supported Node ranges, Python visual requirements, and pinned Actions. Registry audit found zero known production advisories. |
| 12 · Tests | Extended native, Node and real-browser tests for the defects above. |
| 13 · CI | Reviewed Linux/macOS compatibility, pinned and minimum Kujo jobs, Chromium E2E, engine-specific jobs, artifact guard and fixture-backed performance workflow. Regressions run through the existing jobs. |
| 14 · Docs | Updated the reference and changelog for the visible corrections. Fixed the outdated Node prerequisite in flow troubleshooting. |
| 15 · AI workflows | Reviewed inspect → validate → execute, structured repair briefs, evidence locality and optional Eval output. No model provider or MCP registration is part of the runtime. |
| 16 · Dead weight | Removed duplicate parsers, delete/write paths and redundant subprocess sleep/copy operations. Historical evaluation artifacts remain source evidence. |
| 17–18 · Fix and verify | Implemented the changes above and reran the checks listed below. |

## Compatibility and verification limits

The corrections affect exit status for failed artifact writes and incomplete
explicit flow assertions, stdout/stderr placement during verbose checks,
watch intervals, path and baseline validation, and visual artifact inventory.
JSON versions, option names, config/environment keys and integration record
formats retain their existing contracts. Older baselines without identity
metadata are still accepted. For a confirmed baseline-name collision, use
separate `--baseline-dir` values.

Runtime 1.2.3 provides the native APIs used here, verified against the
CI minimum source ref. The full hosted Linux/macOS and Firefox/WebKit matrices
were outside local verification. No changes to sibling repositories, Node
dependencies, package interfaces or release tags were required. Existing
artifact directory ownership requirements and the optional Python image
comparison dependencies still apply.

## Verification receipt

| Command | Result |
|---|---|
| `kujo run tests/lens_tests.kujo` and `../kujo/target/release/kujo run tests/lens_tests.kujo` | 546 passed on each runtime, Kujo 1.5.0 and 1.9.0 |
| `npm test --prefix bridge` | 59 passed on Node 26.12.1 with real Chromium |
| `LENS_SKIP_BROWSER_TESTS=1 node --test bridge/test/*.test.js` | 35 passed and 8 browser groups skipped on each of Node 22.23.4 and 24.22.1 |
| `KUJO_BIN="$(command -v kujo)" python3 scripts/runtime-e2e.py` | 21 passed with real Chromium |
| `python3 scripts/test-visual-diff.py` and `python3 scripts/test-benchmark-harness.py` | Two and four passed |
| `kujo check lens.kujo`, `kujo check` on each `src/*.kujo` and `tests/lens_tests.kujo`, and `kujo lint lens.kujo` | Passed |
| `node --check` on bridge sources/tests, `bash -n` on the wrapper/bench/artifact guard, and `python3 -m py_compile scripts/*.py bridge/visual-diff.py` | Passed |
| `npm audit --prefix bridge --omit=dev --json` | Zero known advisories |
| `git diff --check` and repository artifact guard on the audit commit range | Passed |

## Performance and efficiency

The three-iteration fixture benchmark used Kujo 1.5.0 and Node 26.12.1
on macOS x86_64. Baseline and candidate medians are in seconds.

| Workload | Before | After |
|---|---:|---:|
| bridge trivial | 2.360 | 1.954 |
| bridge realistic | 2.664 | 2.189 |
| cli trivial | 4.047 | 3.109 |
| cli realistic | 3.591 | 3.389 |
| quick trivial | 2.619 | 2.536 |
| quick realistic | 3.257 | 2.788 |
| quick spa | 2.454 | 2.540 |
| quick image heavy | 2.706 | 2.775 |
| quick late network | 2.983 | 3.141 |
| quick many links | 3.153 | 2.648 |

The same 20% threshold used by the performance workflow passed. The largest
increase was 5.3% on quick late-network. The two separate runs capture host
variation as well as any code effect, so these medians do not establish a
speedup. Direct artifact name staging landed after the measured code
snapshot, and none of these command profiles writes direct integrations.

Baseline command: `LENS_BENCH_TARGET_ROOT=<baseline-checkout> scripts/bench.sh 3 <before.json>`.
Candidate command: `scripts/bench.sh 3 <after.json>`.
Both used `KUJO_BIN` set to Kujo 1.5.0 and `LENS_BENCH_PORT=19283`.
Comparison: `python3 scripts/compare-benchmarks.py <before.json> <after.json> --threshold-percent 20`.

The ledger write now scales with the new record, while newline repair still
reads existing history within the size cap. The browser transport test
covers valid evidence above the former 1 MiB ceiling. Peak memory, token
counts, and browser heaps were not measured in this pass.
