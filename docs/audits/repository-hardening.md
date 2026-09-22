# Lens repository hardening — 2026-09-22

## Repository and scope

- Repository: `kujolang/lens`; branch: `codex/hardening-2026-09-22`.
- Starting SHA: `fd388efd4f55f3f844cf7de4fc541abfd07a6785` (clean `main`).
- Ending implementation SHA: `f6689b6dc4a3569f3590ff2cc9276b920721d801`. The final documentation commit is recorded in the engineering receipt; a document cannot contain its own commit hash.
- Purpose: local browser QA, deterministic checks, screenshots/visual comparison, optional accessibility/crawling, safe-by-default flow validation and explicitly executed flows, redacted reports for people and agents.
- Runtime: Kujo CLI/modules → argv-based Node bridge → Playwright browser; optional Python/Pillow/NumPy visual comparison. Integrations: Spec, Eval, Howl, RunLedger, GitHub composite action, browser storage state, project JSON configuration.
- Public contracts reviewed: `lens` launcher and commands, flags/defaults/exit codes, project/flow/Spec input, report/metadata/Eval output, provider process/framing/environment, artifact/output paths, browser-engine and auth configuration.

Read the implementation of all `src/*.kujo` and bridge JavaScript modules, active tests, build/package configuration, CI/action, launcher and primary scripts. Reviewed documentation and fixtures against those paths. Historical benchmark/evaluation artifacts and third-party package internals were sampled, not exhaustively audited. No sibling repository was modified. The [previous audit](repository-hardening-2026-08-30.md) is retained.

Local host: macOS x86_64, Node 26.7.0/npm 11.19.0, Python 3.10, Pillow 12.3.0, NumPy 1.23.5, Kujo 1.4.0. Kujo checkout `7f4a288587710003c60869c016c8f4d97ca3b8af`; tested binary SHA-256 `eeea79362ea8c89cb3e8fe0b34984a8588bc57a9eea829cd902e91d16d9a4787` (unchanged across the audit). Local verification used Chromium. CI retains Node 18/20/22, Ubuntu/macOS and Chromium/Firefox/WebKit jobs; that remote matrix and the minimum Kujo version were not executed locally.

## Baseline

All existing checks passed before edits: **462 Kujo assertions, 51 bridge tests, 10 runtime E2E scenario groups, 4 benchmark-harness tests**. No baseline suite failures. New regression assertions against the original source exposed ten failures followed by an accessibility-evidence lookup failure caused by the original redactor discarding that evidence.

Baseline benchmark: `KUJO_BIN="$PWD/../kujo/target/release/kujo" scripts/bench.sh 3 .lens/audit-2026-09-22/before.json`. The ten medians and environment are preserved in [before.json](evidence/2026-09-22/before.json). Some early browser measurements overlapped baseline checks. Later timing runs encountered substantial unrelated CPU load, including Rust builds/tests, browser activity and a long-running dashboard. Wall-clock results are informational, not a stable latency budget.

`npm audit --omit=dev --json` reported zero advisories for the two pinned production packages (`playwright-core` 1.61.1 and `axe-core` 4.11.4); see [receipt](evidence/2026-09-22/dependency-audit.json). This is an advisory-database result, not proof that dependencies are vulnerability-free.

## Findings

| ID | Priority | Area | Finding / evidence | Action | Status |
|---|---|---|---|---|---|
| L01 | P1 | URL boundary | Host extraction accepted local-looking userinfo before an external authority, e.g. `localhost:pass@example.com`; regression fixtures reproduce it | Parse authority at last `@`, validate brackets/ports and reject controls/backslashes | Fixed |
| L02 | P1 | Privacy / integrity | Regex applied to serialized JSON could break escaping; flow fell back to original data and accessibility parsing discarded evidence | Structured redaction before encoding, preserving shape/types and complete evidence | Fixed |
| L03 | P1 | Privacy | Encoded sensitive query names, fragment/hash-router parameters, DOM fields and HTTP status text escaped existing scrubbers | Central structured/URL-aware scrubbing and raw-artifact E2E assertions | Fixed |
| L04 | P1 | Verdict | Metadata status was calculated before optional checks; failing crawl/a11y could emit PASS with exit 1; walkthrough ignored blocked-step failure policy | Set final status with final exit; apply fail-on to walkthrough | Fixed |
| L05 | P1 | Config / resources | Config-file values bypassed CLI bounds; explicit visual threshold invoked nonexistent `to_number` | Reuse numeric/enum parsers after merge; use supported float conversion | Fixed |
| L06 | P2 | Baselines | Second opted-in baseline update attempted a non-overwriting metadata write | Permit metadata overwrite within existing explicit update operation | Fixed |
| L07 | P2 | Eval / complexity | Spec results already in checks were collected and passed again, duplicating Eval entries | Remove redundant collection; keep generator interface | Fixed |
| L08 | P2 | Memory | Visual subtraction allocated multiple int64 pixel arrays | Signed int16 subtract plus in-place absolute; exhaustive pixel equivalence test | Fixed |
| L09 | P2 | Transport | Axe transferred full node HTML and unused arrays across browser boundary before projecting | Project inside browser; preserve output schema/counts/first five targets | Fixed |
| L10 | P2 | Supply chain | Composite action used mutable upload-artifact major tag | Pin to same SHA already used by CI | Fixed |
| L11 | P1 | Browser destinations | Initial target admission does not confine redirects, JavaScript navigation, clicks or subresources | Correct docs; retain as explicit design work with Signal | Open |
| L12 | P2 | Evidence resources | Console/network/link count caps do not cap individual string or aggregate bytes; receiver limit is after serialization | Preserve source evidence; design observable byte budgets | Open |
| L13 | P1 upstream | Kujo runtime | Imported recursive object traversal changes nested dictionary keys; minimal reproduction below | Iterative Lens traversal with depth/shape tests; upstream Signal | Lens workaround complete; upstream open |
| L14 | Needs evidence | Performance | Final wall-clock timings are higher on heavily contended host; causal overhead is not isolated | Preserve all observations; repeat on idle controlled host before latency claims | Open measurement |

## Changes implemented and compatibility

**Authority admission (`src/validate.kujo`, Kujo/E2E tests).** The host parser previously split port text before separating credentials. Last-userinfo separation now prevents the bypass; IPv6 bracket suffixes, numeric port range and forbidden characters are validated. Legitimate local basic-auth authorities remain accepted. External/malformed targets now consistently fail preflight with exit 2. This intentionally corrects invalid-input behavior, not a new allowlist format.

**Structured privacy (`src/redact.kujo`, `flow`, `report`, `runner`, `eval`).** Redaction runs over string values before JSON serialization instead of treating escape syntax as prose. An iterative postorder walker preserves objects, arrays, keys and scalar types, does not modify the input, handles 100-level nesting without runtime recursion, and masks sensitive string-valued fields/headers. URL comparison decodes ASCII percent escapes in parameter names without rewriting benign URL components. Userinfo is scrubbed through its last `@` (including username-only credentials). Queries, fragments, nested DOM fields, accessibility errors, status text and engine diagnostics retain useful redacted evidence. Quoted assignments containing spaces are covered. Sensitive-name dictionaries avoid repeated linear scans; ordinary unescaped names avoid decoding; assignment patterns share one scan; plainly benign text avoids regex work. No cache or invalidation policy was introduced. Removed an unused local shadowing the `keys` builtin and an unused visual shell-command string.

Tests cover all supported assignment keys, encoded/fragment URLs, quoted and escaped text, sibling keys, null/bool/numeric values, nonmutation, idempotence, deep nesting and real persisted artifacts. Recognized secret patterns are covered; arbitrary unlabelled secrets cannot be guaranteed detectable. Sensitive non-string values retain the established scalar-type policy.

**Verdicts, configuration and baseline lifecycle (`runner`, `config`, `visual`).** Reports, metadata, Markdown/HTML, Eval and process exit now agree after optional failures. Spec entries are emitted once. Config-file numeric/enumerated values follow existing CLI bounds/default policies: timeout 300 seconds, links 500, settle 10,000 ms, concurrency 16, pages 200, depth 5, watch interval 3,600 seconds; threshold 0–1. CLI flags still take precedence and quick-profile behavior is preserved. Explicit fractional thresholds work. Replacing an existing baseline is still opt-in. Tests exercise repeated updates, negative/oversized/invalid config, Spec counts, crawl/a11y failure and blocked flow walkthroughs.

**Resource and transport changes (`bridge/visual-diff.py`, `bridge/browser-bridge.js`).** Pixel subtraction has exact range −255…255, so signed int16 preserves all comparisons. Tests exhaust all 65,536 channel pairs and compare rendered images, RGBA conversion and error contracts. Axe projection still yields the same violation metadata, target samples and total pass/incomplete/inapplicable counts; its browser evaluation now returns only that projection. A 500-node fixture locks this boundary down. New visual tests run in the existing E2E CI job using already pinned Python requirements.

**Contract summary:** no removed public API, flag, environment variable, schema field, file format, package dependency or browser engine. `redact_value` is an additive internal module export. JSON shape remains stable; secrets are scrubbed in additional supported locations. Corrected verdicts/counts and rejected invalid authorities/config bounds can affect consumers that relied on buggy behavior. No ecosystem migration is required. The package version remains 1.1.0 with an Unreleased changelog entry. README, SECURITY, reference, test counts and contributor commands now describe actual behavior.

## Performance and efficiency

| Dimension / method | Before | After | Interpretation |
|---|---:|---:|---|
| Visual process peak RSS, median of 3 alternating runs, 2048×2048 RGB fixture | 372,084,736 bytes | 295,497,728 bytes | 20.6% lower on this fixture/host |
| Same visual comparison elapsed median | 2.1523 s | 2.0814 s | Observed only; too few/noisy samples for latency promise |
| Same comparison output | 419,810 / 4,194,304 pixels; ratio 0.100091 | Identical | Exact output equivalence |
| Axe evaluation transport JSON, synthetic 500-node fixture | 3,035,880 bytes | 247 bytes | Internal transport reduction; not a stdout/token claim |
| Production dependencies | 2 | 2 | No dependency churn |
| Kujo / bridge / E2E / visual tests | 462 / 51 / 10 / absent | 521 / 52 / 14 / 2 | Behavior-focused ratchets |

Raw visual samples: [visual-performance.json](evidence/2026-09-22/visual-performance.json); transport fixture: [axe-transport.json](evidence/2026-09-22/axe-transport.json). Visual fixture uses NumPy `default_rng(0)`, uint8 RGB random values, with every tenth row changed to zero; independent subprocess `resource.getrusage(RUSAGE_SELF).ru_maxrss` on macOS reports bytes. Compare the original `bridge/visual-diff.py` at the starting SHA against the final implementation. Local benchmark script and PNGs are retained under `.lens/audit-2026-09-22/`.

Full-suite intermediate timing after the security changes is retained as [runtime-intermediate.json](evidence/2026-09-22/runtime-intermediate.json); it precedes the final lookup optimization and is **not** a final measurement. Alternating baseline/current measurements after the lookup optimization (before the final userinfo-pattern correction) are in `paired-runtime.json` alongside the receipts. They demonstrate substantial host drift (baseline many-links itself rose from about 3.31 s to over 13 s). They do not establish latency non-regression or a speedup; controlled timing remains follow-up work. No performance assertion was loosened, timeout increased or timing failure hidden.

No model calls or token-bearing prompt pipeline exists in Lens. Reviewed compact JSON/repair briefs, schemas and report generation; no token saving is claimed. Full reports and detailed artifacts remain available. The existing bounded context/output interfaces were preserved. No meaningful compiled-binary/build-size claim applies to these interpreted source changes. Existing browser/session reuse, batched bridge capture, argv processes and bounded concurrency remain intact.

## Security, failure semantics and remaining work

Reviewed CLI/config/flow/repository input, local authority admission, paths/symlinks, storage state, subprocess argv/environment/framing, captured page strings, output files, browser lifecycle and network access. Kept explicit execution opt-in, click/type safety checks, root-path protections, structured provider errors, process termination and stdout isolation. Added negative-path tests instead of weakening diagnostics.

- **P0:** none established.
- **P1 L11:** browser destination confinement is not implemented. Initial URL admission is not an egress sandbox. A trustworthy policy must cover redirects/popups/service workers and all three engines while defining legitimate external CDN behavior. Playwright routing is not a universal redirect guard: [Page routing documentation](https://playwright.dev/docs/api/class-page) and [Route semantics](https://playwright.dev/docs/api/class-route) describe restrictions. No live external exploit was executed. Avoid a partial route-only patch that claims confinement it cannot provide.
- **P2 L12:** counts are bounded (console 1,000, network 2,000, links 5,000), but individual strings/serialized aggregate bytes need a documented, observable truncation policy. The transport receiver ceiling does not bound browser-side accumulation. This is source-supported resource risk, not a measured real-world DoS.
- **P2:** CI Kujo checkout follows the upstream default branch. Consider a tested runtime revision plus a separate latest-runtime compatibility job; this pass did not silently change ecosystem policy.
- **Needs more evidence:** derived-path symlink/shared-output-directory races; realistic idle-host redaction/CLI timings; Linux/Firefox/WebKit/minimum-version execution. Root symlink policy alone does not prove every derived path safe, and no exploit is asserted.
- **Not worth changing:** established wrappers/public formats, historical fixtures/evaluation evidence, provider compatibility fallbacks with explicit diagnostics, optional integrations and two pinned runtime dependencies. No unsupported dead-code deletion or style rewrite.
- **P3:** no cosmetic backlog created.

Security audit records were validated with the security skill contract finalizer and retained locally in `.lens/audit-2026-09-22/security/` (`scan-manifest.json`, `findings.json`, `coverage.json`, `report.md`, exports). Coverage limitations are explicit; no claim of complete dependency or multi-engine security assurance is made.

## Cross-repository follow-up: Kujo recursive module bindings

Affected repository: `kujolang/kujo`; contract: an imported recursive function must preserve caller locals/collection keys across nested calls. On the exact runtime above, this minimal clone transforms `[{"a":[{"b":"hi"}]}]` into `[{"b":[{"b":"hi"}]}]`. This is observed data corruption, not a Lens parser inference. Lens uses an iterative workaround, so its fix does not require a runtime change. Correcting the runtime should preserve intended semantics; audit other imported recursive routines and interpreter/compiled parity upstream.

Reproduce from Lens with this file at `tests/tmp/hardening_clone.kujo`:

```kujo
export func clone_nested(value) {
    if is_array(value) {
        mut items := array(); mut i := 0
        while i < len(value) { items = append(items, clone_nested(value[i])); i = i + 1 }
        return items
    }
    if is_dict(value) {
        mut obj := {}; fields := keys(value); mut k := 0
        while k < len(fields) { obj[fields[k]] = clone_nested(value[fields[k]]); k = k + 1 }
        return obj
    }
    return value
}
```

At `tests/tmp/hardening_clone_probe.kujo`:

```kujo
from tests.tmp.hardening_clone import clone_nested
input := array({"a": array({"b": "hi"})})
print(to_json(input))
print(to_json(clone_nested(input)))
```

Run `../kujo/target/release/kujo run tests/tmp/hardening_clone_probe.kujo`; [observed output](evidence/2026-09-22/runtime-recursion.txt) is preserved. No other required cross-repository change was identified.

## Verification receipt

Commands run from Lens unless a directory is specified. Detailed logs remain in ignored `.lens/audit-2026-09-22/`; compact reproducible receipts are committed above.

| Command | Result |
|---|---|
| `../kujo/target/release/kujo run tests/lens_tests.kujo` | Baseline 462; final 521 assertions pass |
| `npm test --prefix bridge` | Baseline 51; final 52 pass, real Chromium enabled |
| `KUJO_BIN="$PWD/../kujo/target/release/kujo" python3 scripts/runtime-e2e.py` | Baseline 10; Final uninterrupted rerun: 14 groups pass; intervening watch deadline failure retained |
| `python3 scripts/test-benchmark-harness.py` | 4 pass on final rerun; two intervening resume timeouts retained |
| `python3 scripts/test-visual-diff.py` | 2 pass, including exhaustive channel equivalence |
| `../kujo/target/release/kujo check lens.kujo` | Pass |
| `../kujo/target/release/kujo lint lens.kujo` | Pass |
| `node --check bridge/browser-bridge.js` (also `flow-bridge.js`, `inspect-bridge.js`) | Pass |
| Python `ast.parse` over tracked `.py`; `bash -n lens scripts/bench.sh` | Pass |
| `npm audit --omit=dev --json` (in `bridge`) | Zero known advisories |
| `KUJO_BIN="$PWD/../kujo/target/release/kujo" scripts/bench.sh 3 .lens/audit-2026-09-22/before.json` | Completed baseline |
| Same benchmark with `after.json` | Completed intermediate; not final code timing |
| `python3 .lens/audit-2026-09-22/paired-bench.py` | Lookup-optimized alternating samples; host contention limits interpretation |
| `python3 .lens/audit-2026-09-22/bench-visual.py fixture`, then alternating `before` / `after` subprocesses | Identical pixels/ratio; measured RSS above |
| Security `finalize_scan_contract.py --scan-dir .lens/audit-2026-09-22/security --source-root .` | Contract validation passed |
| `git diff --check` | Pass |

No disabled tests, weakened assertions, new retries/sleeps, hidden errors or increased timeouts. Final local verification passed: 521 Kujo assertions, 52 bridge tests, 14 uninterrupted E2E scenario groups, 2 visual tests, 4 harness checks, compile/lint/syntax and whitespace checks. CI’s remote platform/engine matrix was not run locally. Intervening contention-related timing failures are retained below; wall-clock latency non-regression is not established.

## Durable handoff and open-item tracking

SignalBox was deduplicated before writes. Three captures and two review Signals were created; each was retrieved by exact ID and concept search:

| Subject | Capture | Signal |
|---|---|---|
| Lens browser destination boundary | `cap_f1cd6620-47f8-4344-b91d-a3eb644c7088` | `sig_4fa560d5-7410-4757-b5e6-07ab91f10d9c` |
| Lens evidence byte budgets | `cap_58d9ee83-2620-4ada-b62c-dc32587374f5` | None: design evidence retained without escalation |
| Kujo imported recursion corruption | `cap_0cf94c54-d6a7-4b70-92d2-4da9183f844b` | `sig_cd737663-1eb7-4713-9442-951143c10c3c` |

Skipped duplicates: zero. Rejected capture candidates: completed fixes, routine verification, implementation recaps and handoffs. Those belong in Strata. Strata consolidation saved two deduplicated Agent Notes:

- `b7ab92c3-320a-4362-b5fc-ae65df3dc69b` — **Memory · Lesson · Lens structured redaction must precede JSON encoding**: reusable privacy invariant and runtime workaround evidence.
- `65bb7743-4162-4dac-890c-14a3a5ea8dd5` — **Session Memory · Lens · September 2026 hardening audit**: implementation provenance, project-state/timeline update, measured results, verification limits and open-item handoff; links to the atomic lesson instead of duplicating it.

Both were retrieved by exact note ID and concept search. No existing memory was superseded; the earlier browser-runtime performance milestone remains historical context.

### Verification history and recovery

One E2E invocation completed the first 13 groups but failed the existing 40-second watch deadline. Both baseline and final-revision isolated watch controls subsequently passed with the same deadline, including cookie/context isolation and one browser launch. A fresh, uninterrupted E2E invocation on the committed source then passed **all 14 groups**. The unchanged harness passed all four checks after two intervening 30-second resume timeouts. No timeout, assertion or source change was made to obtain these rerun passes.

The host reached load averages above 570 on 12 logical CPUs; see [host-contention.json](evidence/2026-09-22/host-contention.json). Detailed failed logs remain in `.lens/audit-2026-09-22/e2e-contended-watch-timeout.log`, `harness-contended-timeout.log` and `harness-contended-timeout-2.log`. [verification.json](evidence/2026-09-22/verification.json) retains both final results and intervening failures. Baseline/current watch control source and receipts are preserved alongside it. Functional verification is green; controlled idle-host latency measurement remains outstanding.
