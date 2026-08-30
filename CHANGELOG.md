# Changelog

All notable changes to Lens are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- User-selected output, baseline, Eval, RunLedger, and Howl destinations are
  validated before any write. Dangerous root/current-directory targets,
  final-target symlinks, type mismatches, missing file parents, and duplicate
  direct-file destinations now fail as invalid input.
- Visual baseline directory names and metadata now redact secret-bearing URLs
  and flow names, and HTML regression tests cover every user-controlled field.
- Terminal JSON/verbose summaries and flow reports, walkthroughs, validation
  output, Eval records, names, URLs, and artifact paths now pass through the
  final secret-redaction boundary.

### Scalability
- Browser evidence is bounded at 1,000 console messages, 2,000 network events,
  and 5,000 captured links per viewport, with explicit truncation findings.
- Custom viewport dimensions are capped at 4096×4096 and flow recordings at
  100 MiB; oversized recordings are removed with a warning finding.
- Added deterministic trivial, realistic, SPA, image-heavy, late-network, and
  many-link fixtures, machine-readable medians, and a labeled/manual CI
  regression comparison.

### CI
- Added Linux/macOS coverage across Node 18/20/22, installed/missing behavior
  for Chromium, Firefox, and WebKit, and full fixture-backed artifact/redaction
  coverage for checks, crawls, baselines, and recorded walkthroughs.

### Changed
- Version promoted to **1.0.1** across the CLI, manifests, spec, docs, and badge.

### Performance
- Added `--quick`, an opt-in agent repair profile that emits JSON, captures one
  desktop viewport, removes the settle delay, and keeps explicit CLI overrides.
- The launcher now prefers an installed Kujo runtime or sibling release build
  before falling back to the sibling debug build.
- Replaced the full Playwright package with Playwright Core and the optimized
  Chromium headless shell, reducing the bridge install footprint.
- The benchmark harness now prefers release Kujo and reports full and quick
  end-to-end medians.

### Fixed
- Invalid Playwright auth storage-state files now fail with exit 2 before the
  browser launches; errors do not expose file paths, JSON contents, or parser
  details. The same validation protects executed flows.
- Malformed or non-object browser-bridge output now becomes a structured exit-3
  provider failure instead of aborting on an uncaught JSON parse error.
- The reusable GitHub Action no longer interpolates inputs as shell source;
  quoted extra arguments are safely tokenized without command evaluation.
- Accessibility scan URLs, nested engine errors, and selector targets now pass
  through the final redaction sweep before entering reports or artifacts.
- Reusing an explicit `--out` directory now overwrites generated accessibility,
  visual-diff, and flow report artifacts instead of failing on stale files.
- Malformed flow JSON now returns an input error instead of aborting the Kujo VM.
- Malformed Spec JSON now returns an input error instead of aborting the Kujo VM.
- Document-relative and query-relative links now resolve against the current page correctly.
- Protocol-relative external links remain external during link checks and crawls.
- Secret-bearing links are requested with their real URL while artifacts retain only the redacted URL.
- Duplicate destinations captured across viewports no longer consume the link-check limit.
- `lens inspect` now emits valid selectors for `data-test` and `data-cy` elements.
- Hidden anchors are no longer included in captured link evidence.
- Flow screenshot names can no longer escape the run's screenshot directory.
- Executed flow steps now honor the flow's configured timeout.

## [1.0.0] - 2026-08-08

### Added
- Launch-readiness Eval metadata for the Kujo prelaunch review.
- **`lens inspect <url>`**: read-only selector discovery — lists a page's
  interactive elements (buttons, links, inputs, modal triggers) with suggested
  selectors + text, saved to `elements.json`. The key to authoring flows.
- **`lens flow --validate`**: dry-run that checks a flow's structure, required
  fields, and safety gating (per-step ok / INVALID / BLOCKED) without launching
  a browser. Add `--json` for a machine-readable verdict (for autonomous agents).
- **`examples/flow.schema.json`**: a JSON Schema for flow files (editor / lint
  validation). `docs/flow-authoring.md` gains an autonomous-agent loop (exit-code
  branching + failure taxonomy), and security, determinism, extensibility, and
  CI sections.
- **`docs/flow-authoring.md`**: turn a plain-English task into a flow JSON,
  including a copy-paste agent prompt; plus `examples/flows/account-modal.json`
  (open page → modal → toggle → verify next screen).
- **`scroll` flow step**: smooth-scroll to a selector or `y` position during an
  executed flow.
- **Visible cursor in recordings**: with `--record`, the walkthrough video shows
  a cursor that glides to each target and pulses on click (visual aid only;
  typed secrets are never shown).
- `examples/flows/site-journey.json` — an interactive, recorded journey example.
- Front-door `README.md` and a step-by-step `docs/getting-started.md` guide.
- `docs/enhancements.md` — an agent-executable, dependency-ordered backlog.
- `LICENSE` (MIT), this `CHANGELOG.md`, `CONTRIBUTING.md`, and CI.
- `scripts/bench.sh` — median benchmark harness with documented baselines.
- **Project config file** (`.lens.toml`, or `--config <path>`): project-level
  defaults with precedence defaults < file < CLI flags (Phase 1.1).
- **Custom viewports**: `--viewport 1024x768` (and config `viewports`) in
  addition to the `desktop`/`mobile` presets (Phase 1.3).
- **`--max-concurrency <n>`**: cap concurrent viewport captures (Phase 1.3).
- **`--settle-ms <n>`**: configurable post-readiness settle window (Phase 1.2).
- **`--perf`**: opt-in performance metrics (LCP/CLS/TTFB/FCP) written to
  `metrics.json` with a `LENS-PERF` threshold check (Phase 2.1).
- **`--throttle <profile>` / `--device <name>`**: network throttling and device
  emulation (Chromium) (Phase 2.2).
- **`--browser <chromium|firefox|webkit>`**: select the browser engine; absent
  engines degrade honestly with exit 3 (Phase 2.3).
- **`--auth-file <path>`**: opt-in auth storage-state injection. Contents stay
  inside Playwright — never logged, never written to any artifact (Phase 2.4).
- **`--crawl` / `--max-depth` / `--max-pages`**: bounded, same-origin,
  safety-gated crawl writing `crawl.json` with per-page health (Phase 2.5).
- **`--html`**: self-contained `lens-report.html` (escaped, screenshots
  embedded, findings by severity) (Phase 3.1).
- **`--watch` / `--watch-interval`**: re-run on an interval until interrupted
  (Phase 3.2).
- **`--ledger <path>`**: append a RunLedger-compatible JSONL record (Phase 3.3).
- **`--howl <path>`**: write a Howl pass/fail summary (Phase 3.4).
- **`action.yml`**: reusable GitHub composite Action that runs Lens and uploads
  the report as a CI artifact (Phase 3.5).
- **`lens flow --execute`**: real interactive flow execution — click, type,
  wait_for_*, and assert_* steps run in a live browser session with per-step
  results, still gated by the full flow safety model (Phase 4.1).
- **`--record`**: record the flow session to `video/walkthrough.webm` (Phase 4.2).
- **`--walkthrough`**: a shareable `walkthrough.html` — recording + synchronized
  step timeline + verdict + tamper-evident run fingerprint (Phase 4.3).
- **Overflow offending-element detection**: horizontal-overflow findings now
  name the specific oversized element(s) and their width (Phase 4.4).

### Project & robustness
- Version promoted to **1.0.0**, single-sourced via `lens_version()`.
- `examples/` directory (`.lens.toml`, read-only + interactive flows, a spec);
  docs now reference real, runnable example paths.
- CI gained an **end-to-end job** that runs `lens check` + `lens flow --execute`
  against real Chromium and asserts artifacts/exit codes; bridge unit tests
  (`bridge/test/`) and `flow-bridge` syntax check added.
- Community-health files: `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue + PR
  templates, `CODEOWNERS`, `.editorconfig`, `.nvmrc`, and a Node `>=18` engines
  constraint.
- Flow files are capped at 200 steps to bound untrusted input (the Kujo VM can
  abort uncatchably on pathological nesting/size).

### Fixed
- **Verbose-log redaction**: `--verbose` now redacts target URL secrets and
  `--auth-file` paths before printing the browser bridge command.
- **Documentation freshness**: the reference, spec, README, and getting-started
  guide now describe the current 0.9.0 surface instead of older pre-execution
  flow limitations.
- **Heavy-site reliability**: both bridges cap the network-idle wait (~3.5s)
  instead of waiting the full page timeout, fixing `bridge produced no output`
  on public sites whose network never goes idle (analytics, long-polling).
- **UTF-8-safe `html_escape`**: the HTML report no longer crashes
  (`Index out of bounds`) on multi-byte characters — the Kujo VM's `len()` is
  byte length while string indexing is per character.
- **Walkthrough video**: finalize the recording by scanning the video dir after
  context close (handles `target="_blank"` second tabs and the previously racy
  rename), so `walkthrough.html` always points at an existing
  `video/walkthrough.webm`; added an inline download fallback for browsers that
  don't play webm.

### Security
- Verbose bridge command logging now uses the same defense-in-depth posture as
  artifacts: URL secrets are redacted and auth storage-state paths are masked.
- Typed-input values (e.g. credentials in `type` steps) are redacted to
  `[REDACTED]` in `flow.json`, and the internal `flow-program.json` handoff is
  deleted immediately after the bridge consumes it — no secret reaches any
  artifact, walkthrough, or report.

### Changed
- Root project metadata in `kujo.toml` now matches the released `0.9.0`
  package/spec version.
- Browser bridge now captures viewports **concurrently** instead of
  sequentially (~37% faster wall-clock on realistic pages; neutral on trivial
  ones). Output order remains deterministic.
- **Event-driven readiness**: the bridge now waits for `networkidle` (bounded
  by the page timeout) plus a short, configurable settle window, replacing the
  flat 500 ms wait — more accurate on real apps, no flat tax on fast pages
  (Phase 1.2).
- The former `docs/README.md` reference manual moved to `docs/reference.md`.

## [0.6.0] - 2026-05-31

### Added
- `lens check <url>` — browser checks: page load, console errors, network
  failures, blank-page detection, horizontal overflow, screenshots.
- Same-origin, opt-in, shallow link checking (`--check-links`).
- Spec-backed deterministic assertions (`--spec`) and Eval output (`--eval-out`).
- Safe browser flows (`lens flow`) with a strict safety model.
- Visual baselines and pixel diffing (`--baseline` / `--compare-baseline`).
- axe-core automated accessibility scanning (`--accessibility` / `--a11y`).
- Centralized secret redaction across every artifact and report.
- Stable JSON report (`schema_version: 1`), exit codes 0–4, Agent Repair Brief.
