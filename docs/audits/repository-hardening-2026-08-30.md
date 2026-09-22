# Repository Hardening Audit — 2026-08-30

## Repository

- Repository: `lens`
- Branch: `codex/repository-hardening`
- Starting SHA: `da8740cc6c82631821ae6258af0fc554bc32e468`
- Initial implementation SHA: `abb0c0f3fadf6ce076002f8775587e5d28a83a80`
- Hardening follow-through SHA: `e397af3497e96336f788c01beebb316fb0d8c678`
- Purpose: deterministic, local-first browser and visual QA with redacted,
  agent-ready evidence.
- Important dependencies and integrations: Kujo runtime, Node.js,
  `playwright-core`, `axe-core`, optional Python visual-diff tooling, GitHub
  Actions, RunLedger, Howl, Spec, and Eval.

The implementation SHA identifies the audited code change. This audit document
is committed separately, so the final repository SHA is recorded in the
engineering receipt.

## Baseline

The repository started clean on `main`. Baseline verification passed:

- `kujo run tests/lens_tests.kujo`: 398/398 assertions.
- `npm test` in `bridge/`: 15/15 tests.
- `node --check` for all three bridge scripts: passed.
- `npm audit --omit=dev`: zero known vulnerabilities across the locked runtime
  dependency graph.
- CLI version/help smoke: Lens v1.0.0, passed.
- `scripts/bench.sh 3` medians: bridge trivial 3.171 s, bridge realistic
  4.270 s, CLI trivial 4.304 s, CLI realistic 5.251 s, quick trivial 4.888 s,
  quick realistic 5.026 s.

The audit reviewed source, tests, bridges, configuration, artifacts, reports,
flows, crawling, visual checks, accessibility, CI, packaging, security policy,
dependencies, documentation, examples, benchmarks, and agent-facing contracts.

## Findings

| ID | Priority | Area | Finding | Evidence | Action | Status |
| -- | -------- | ---- | ------- | -------- | ------ | ------ |
| LENS-HARD-001 | P1 | Security | The composite Action interpolated free-form inputs into shell source. | `action.yml` used `${{ inputs.args }}` directly in `run`. | Move inputs to environment variables and tokenize `args` with `shlex` without evaluation. | Fixed |
| LENS-HARD-002 | P1 | Secrets | Nested accessibility scan URLs retained secret query values in `lens-report.json`; page-derived selector/error text bypassed the final sweep. | Secret-bearing localhost smoke reproduced the raw token under `checks[].scans[].url`. | Add a nested accessibility redaction pass and use it for both artifacts and report check results. | Fixed |
| LENS-HARD-003 | P1 | Auth boundary | `--auth-file` checked only existence for normal checks, was not prevalidated for executed flows, and missing-file errors exposed the path. | `src/runner.kujo` and Playwright handoff inspection. | Validate the storage-state JSON envelope (`cookies` and `origins` arrays) before browser launch and emit content/path-safe errors. | Fixed |
| LENS-HARD-004 | P1 | Reliability | Malformed bridge JSON could escape as an uncaught VM parse failure. | Direct `parse_json` calls at browser and flow process boundaries. | Convert malformed/non-object output to structured browser failures without reflecting raw page-controlled output. | Fixed |
| LENS-HARD-005 | P2 | Determinism | Reusing an explicit output directory failed when accessibility, visual, or flow artifacts already existed. | Repeated accessibility smoke failed on existing `accessibility.json`. | Make generated run artifacts overwrite their established paths consistently. | Fixed |
| LENS-HARD-006 | P2 | Privacy docs | README did not warn that screenshots and recordings can contain rendered private data. | README/reference/security comparison. | Add the rendered-pixel privacy caveat and recording guidance. | Fixed |
| LENS-HARD-007 | P2 | Write safety | User-selected output roles had no shared destination policy. | Output, baseline, Eval, RunLedger, and Howl paths reached writers independently. | Reject roots/current directories, traversal, final symlinks (including broken links), type mismatches, missing direct-file parents, and direct-file collisions before writes. | Fixed |
| LENS-HARD-008 | P2 | Scalability | Console, failed-network, link, custom-viewport, and recording growth was not explicitly bounded. | Bridge collectors appended without hard limits and custom dimensions accepted any positive integer. | Add per-viewport evidence caps with dropped counts/findings, a 4096-pixel dimension cap, and a 100 MiB recording cap with warnings. | Fixed |
| LENS-HARD-009 | P2 | Compatibility | CI covered one OS/Node/browser path. | Workflow inspection. | Add Linux/macOS and Node 18/20/22 bridge coverage plus installed/missing Chromium, Firefox, and WebKit jobs. | Fixed |
| LENS-HARD-010 | P2 | Performance | The benchmark surface covered only trivial/realistic pages and emitted text only. | `scripts/bench.sh` inspection. | Add six deterministic fixture classes, JSON receipts, same-runner comparison, a stored informational baseline, and labeled/manual CI warning guard. | Fixed |
| LENS-HARD-011 | P1 | Secrets | Final smoke found the verbose terminal summary still printed a secret-bearing target URL; flow names/URLs and paths also had incomplete final sweeping. | Artifact-and-log grep reproduced the raw query token. | Extend centralized redaction to terminal JSON/verbose output and every flow report, walkthrough, Eval, validation, and path surface. | Fixed |
| LENS-HARD-012 | P2 | HTML safety | Escaping was implemented but not proven for every user-controlled report and walkthrough field. | Coverage inspection. | Add adversarial field-complete HTML tests and defense-in-depth text redaction for artifact/video/step fields. | Fixed |

## Changes Implemented

### Browser and auth trust boundaries

- Problem: malformed bridge output and malformed authentication state could
  abort late or expose private context.
- Root cause: process output was parsed without exception handling, and auth
  state was delegated to Playwright without validating its envelope.
- Implementation: added structured bridge parsers and a shared storage-state
  validator used by normal checks and executed flows.
- Files: `src/provider.kujo`, `src/flow_exec.kujo`, `src/validate.kujo`,
  `src/runner.kujo`.
- Tests: malformed/non-object provider output; absent, missing, malformed,
  wrong-shape, and valid auth state; terminal path/content non-disclosure smoke.
- Compatibility: valid Playwright storage-state files behave unchanged;
  malformed files now fail earlier with the documented input exit code 2.

### Complete accessibility redaction

- Problem: report-embedded accessibility scans bypassed nested redaction.
- Root cause: the artifact writer redacted only the scan URL and the final check
  sweep copied `scans` unchanged.
- Implementation: serialize/sweep/parse the complete nested scan payload at the
  central redaction boundary and use the same helper for `accessibility.json`.
- Files: `src/redact.kujo`, `src/runner.kujo`.
- Tests: nested URL, engine error, and selector target secret regression cases;
  full localhost artifact grep.
- Compatibility: schemas are unchanged; only sensitive values become
  `[REDACTED]`.

### GitHub Action input safety

- Problem: workflow-supplied text could become shell syntax.
- Root cause: GitHub expressions were interpolated directly into the generated
  shell program.
- Implementation: transfer inputs through environment variables and use
  non-evaluating `shlex` tokenization with NUL-delimited arguments.
- File: `action.yml`.
- Verification: YAML parse passed; quoted values remained one argument; command
  substitution text remained inert.
- Compatibility: quoted multi-word values remain supported.

### Repeatable explicit output directories

- Problem: a second run against the same `--out` path could fail on stale
  generated files.
- Root cause: several writers omitted the runtime's overwrite flag.
- Implementation: enable overwrite for accessibility, visual-diff, flow,
  metadata, report, and flow Eval artifacts.
- File: `src/runner.kujo`.
- Verification: repeated full accessibility runs to the same directory passed.
- Compatibility: this aligns affected artifacts with the existing overwrite
  behavior of core reports; visual baseline replacement still requires its
  explicit update opt-in.

## Performance & Efficiency

The benchmark harness now serves deterministic trivial, realistic, SPA-like,
image-heavy, late-network, and many-link fixtures and measures ten bridge/CLI
scenarios. It emits JSON receipts and compares before/after medians on the same
runner. `benchmarks/baseline.json` stores an explicitly informational
three-iteration local reference; CI warns, but does not fail, above a 20% median
regression on labeled/manual runs.

Dependency surface remained unchanged. `npm audit --omit=dev` reported zero
known vulnerabilities. Default command output stayed concise; malformed bridge
output now preserves detail as a structured classification without dumping raw,
page-controlled stdout.

## Security

Reviewed boundaries included URL admission, browser subprocess arguments and
results, auth state, flow mutation gates, output paths, redaction, accessibility
payloads, HTML escaping coverage, CI shell inputs, crawl/link origin controls,
and generated artifact persistence.

Fixed vulnerabilities and hardening gaps:

- shell evaluation risk in composite Action inputs;
- secret leakage through nested accessibility scan data;
- unvalidated auth storage-state envelopes and path-bearing errors;
- raw malformed bridge output reaching unstructured failure paths.
- unsafe or ambiguous user-selected write destinations;
- secret leakage in terminal summaries and flow-derived outputs;
- unbounded page-controlled evidence and visual artifact dimensions.

Regression coverage rose from 398 to 448 Kujo assertions and from 15 to 18
bridge tests. A final secret-bearing check and recorded flow proved raw tokens
absent from run artifacts, baselines, walkthroughs, JSON output, and verbose
logs.

## Compatibility

- Public APIs: unchanged.
- CLI flags and normal output: unchanged.
- Exit behavior: malformed auth storage state now consistently exits 2;
  malformed bridge output consistently maps to browser failure exit 3.
- File formats and JSON schemas: unchanged.
- Configuration and environment variables: unchanged.
- External consumers: valid Action `args` values remain supported, including
  quoted multi-word arguments. Inputs are no longer interpreted as shell code.

## Cross-Repository Follow-Ups

None required. The Kujo runtime's existing overwrite and process APIs were
sufficient; no sibling repository changes are needed.

## Remaining Work

- P0/P1/P2 findings from this hardening audit: none open.
- Product expansion and presentation ideas remain in the enterprise worklist;
  they are not correctness or release blockers for Lens's documented scope.
- Large evidence is deliberately bounded rather than streamed: 1,000 console
  messages, 2,000 failed-network events, and 5,000 links per viewport; crawl is
  bounded by `--max-pages`; viewports and recordings have explicit limits.
- Not worth changing: dependency replacement or broad source rewrites; the
  current small bridge dependency set and module boundaries are justified.

## Verification Receipt

| Command | Result |
| ------- | ------ |
| `kujo run tests/lens_tests.kujo` | Passed, 448/448 assertions |
| `npm test --prefix bridge` | Passed, 18/18 tests |
| `node --check bridge/browser-bridge.js` | Passed |
| `node --check bridge/flow-bridge.js` | Passed |
| `node --check bridge/inspect-bridge.js` | Passed |
| `npm audit --omit=dev --prefix bridge` | Passed, zero vulnerabilities |
| YAML parse for `action.yml`, CI, and performance workflows | Passed |
| `git diff --check` | Passed |
| malformed `--auth-file` CLI smoke with `--verbose` | Exit 2; path and content absent from output |
| secret-bearing localhost full run with HTML, links, accessibility, performance, crawl, and baseline | Passed at `--fail-on critical`; token absent from all artifacts, baseline metadata, JSON, and verbose logs |
| secret-bearing executed flow with recording and walkthrough | Passed; flow token absent from reports, evidence, walkthrough, and terminal log |
| repeated full run to the same explicit `--out` directory | Passed |
| `scripts/bench.sh 1 /tmp/lens-benchmark-final.json` and self-comparison | Passed; all ten fixture metrics emitted and comparator reported 0% delta |
