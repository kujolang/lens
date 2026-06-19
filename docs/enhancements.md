# Lens Enhancement Checklist

An **agent-executable** backlog. Each task is self-contained: an agent can pick
one, implement it, run the standard verification gauntlet, and open a PR —
without needing the others in front of it. Tasks are ordered by dependency, so
working top-to-bottom is always safe.

> **Status note:** many items in this checklist have since shipped in Lens
> v0.9.0. For the current next-session readiness worklist, use
> [Enterprise Readiness Next Session](enterprise-readiness-next-session.md).

This document supersedes the short "Roadmap" list in
[reference.md](reference.md#roadmap).

---

## 🎯 The North Star

Everything here builds toward one capability:

> An agent is given a real work task and the app under test. It runs Lens to
> verify the app, fact-checks and applies fixes, then runs Lens again to produce
> a **screen recording that walks through the app passing** — a shareable,
> tamper-evident artifact proving the agent's work is visually and behaviorally
> sound.

Read that before starting any task. Several early items (interactive flow
execution, HTML reporting, readiness detection) exist specifically to make that
final recording **trustworthy** — a video of a broken page proves nothing. The
capstone is [Phase 4](#phase-4--the-proof-of-work-artifact-north-star).

---

## ✅ Standing verification gauntlet (applies to EVERY task)

No task is "done" until all of these pass. Run them in order. This is the
"highest standards" bar — every loop ends here.

1. **Baseline green.** Before touching code, record the current state:
   ```bash
   ../kujo/target/debug/kujo run tests/lens_tests.kujo   # note the pass count
   ```
2. **Branch.** Never work on `main`. `git checkout -b enh/<task-id>`.
3. **Implement** the task's steps.
4. **Add tests.** Every task must raise the test count. Add cases to
   `tests/lens_tests.kujo` covering the happy path, at least one failure/edge
   path, and any new redaction surface.
5. **Full suite passes, count went up:**
   ```bash
   ../kujo/target/debug/kujo run tests/lens_tests.kujo   # 0 failed, count > baseline
   ```
6. **Bridge syntax** (only if `bridge/*.js` changed):
   ```bash
   node --check bridge/browser-bridge.js
   ```
7. **Performance check.** No silent regressions. Use the median A/B method:
   ```bash
   python3 -m http.server 9999 --bind 127.0.0.1 &   # or a realistic app
   for i in $(seq 1 8); do /usr/bin/time -p ./lens check http://127.0.0.1:9999 --out /tmp/perf$i; done
   ```
   Compare median wall-clock against the pre-change build (git stash the change,
   re-measure). Document the delta in the PR. A regression must be justified.
8. **Security & redaction review.** If the task captures, stores, or emits any
   new data, prove no secret leaks:
   ```bash
   ./lens check "http://127.0.0.1:9999/?token=SUPERSECRET123&api_key=abc" --out /tmp/sec --allow-external
   grep -rE "SUPERSECRET123|abc" /tmp/sec/   # must return NOTHING
   ```
   Extend `src/redact.kujo` for any new field, and add a redaction test.
9. **Docs updated.** Reflect the change in **all** of: `README.md` (if
   user-facing), `docs/getting-started.md` (if it changes the workflow),
   `docs/reference.md` (always — flags, schema, limitations), and the `lens
   --help` text in `src/config.kujo`.
10. **Smoke run** the real CLI end-to-end and eyeball the report.
11. **Version + changelog.** Bump `version` in `kennel.toml` + `LENS_VERSION` in
    `src/runner.kujo` + `print_help`/`print_version` strings, and add a
    `CHANGELOG.md` entry (after Task 0.2 exists).
12. **Commit** with a conventional message (`feat:`, `fix:`, `perf:`, `docs:`,
    `chore:`) describing the change and the verification result.

> **Invariants that must never regress** (re-confirm every task): no AI/LLM in
> the check path; localhost-only by default; no unredacted secrets in any
> artifact; deterministic output (same input → same report); the browser never
> mutates state outside an explicit, opted-in flow step.

---

## Phase 0 — Foundations & hygiene (do these first)

These unblock CI, contribution, and safe iteration on everything below.

### Task 0.1 — Add a LICENSE file
- **Goal:** Ship the MIT license `kennel.toml` already declares.
- **Why:** The manifest and README say MIT, but there is no `LICENSE` file. A repo "of highest standards" must carry its license text.
- **Depends on:** nothing.
- **Steps:** Add a root `LICENSE` with the standard MIT text, `Copyright (c) 2026 Robert DeVore`. Confirm `kennel.toml` `license = "MIT"` and `README.md` footer agree.
- **Done when:** `LICENSE` exists; README license link resolves.
- **Effort:** XS.

### Task 0.2 — Add CHANGELOG.md
- **Goal:** A Keep-a-Changelog file tracking every release.
- **Why:** Required by gauntlet step 11; gives downstream tools and humans a history.
- **Depends on:** nothing.
- **Steps:** Create `CHANGELOG.md` with an `## [Unreleased]` section and a `## [0.6.0]` entry summarizing current capabilities. From now on, every task adds a line.
- **Done when:** File exists and the gauntlet references it.
- **Effort:** XS.

### Task 0.3 — Add CONTRIBUTING.md
- **Goal:** Document how to build, test, and the verification gauntlet for contributors/agents.
- **Why:** Encodes the "things I typically do" so any agent or human follows the same bar.
- **Depends on:** 0.1, 0.2.
- **Steps:** Write `CONTRIBUTING.md` covering: prerequisites, build, the gauntlet (link to this section), code style (match surrounding Kujo idioms), and the never-regress invariants.
- **Done when:** A new contributor can go from clone → green tests using only this file + getting-started.
- **Effort:** S.

### Task 0.4 — Continuous integration (GitHub Actions)
- **Goal:** Run the test suite and bridge syntax check on every push/PR.
- **Why:** Automated proof the gauntlet's core steps pass; prevents regressions landing.
- **Depends on:** 0.3.
- **Steps:** Add `.github/workflows/ci.yml`: build Kujo (or fetch a pinned binary), `kujo run tests/lens_tests.kujo`, `node --check bridge/browser-bridge.js`, `npm ci` in `bridge/`. Cache cargo + npm. Add a status badge to the README.
- **Acceptance:** A red test makes CI fail; green on `main`.
- **Effort:** M.

### Task 0.5 — Error-path & coverage hardening pass
- **Goal:** Audit untested branches and add cases (artifact-write failures, malformed bridge JSON, partial provider results, every exit code 2/3/4).
- **Why:** "Highest standards" means failure paths are tested, not just the happy path.
- **Depends on:** 0.4.
- **Steps:** Map each exit code and error branch in `runner.kujo`/`provider.kujo` to a test. Add fixtures for malformed/partial provider results.
- **Acceptance:** Every exit code and provider-failure branch has a test.
- **Effort:** M.

### Task 0.6 — Performance-regression guard
- **Goal:** A repeatable benchmark harness + recorded baselines.
- **Why:** Gauntlet step 7 needs a stable reference; perf claims must be measurable.
- **Depends on:** 0.4.
- **Steps:** Add `scripts/bench.sh` that spins up a fixture server (trivial + realistic-latency variants), runs N iterations, and prints medians for the bridge and the full CLI. Record current baselines in `docs/reference.md` (Performance section, new). Optionally fail CI if a labeled-perf PR regresses > 15%.
- **Acceptance:** `scripts/bench.sh` prints stable medians; baselines documented.
- **Effort:** M.

---

## Phase 1 — Core enabling features

These are prerequisites for the capture-depth and reporting work below.

### Task 1.1 — Config file support (`.lens.toml`)
- **Goal:** Project-level defaults so teams don't repeat flags. (Roadmap item.)
- **Why:** Custom viewports, concurrency, fail thresholds, and a11y scoping all want a persistent home; later tasks read from it.
- **Depends on:** Phase 0.
- **In scope:** Load `.lens.toml` from CWD (or `--config <path>`); CLI flags override file values; file overrides built-in defaults.
- **Out of scope:** Per-URL profiles (future).
- **Steps:** Add `src/config_file.kujo` to parse TOML (or JSON fallback if Kujo TOML support is limited — verify `parse_toml` availability first). Merge order: defaults < file < CLI. Surface the resolved config in `metadata.json`.
- **Acceptance:** `lens check` with no flags picks up `.lens.toml`; a CLI flag still wins; invalid file → exit 2 with a clear message.
- **Verify (delta):** Add tests for merge precedence and invalid-file handling.
- **Effort:** M.

### Task 1.2 — Smart page-readiness (replace the fixed 500 ms wait)
- **Goal:** Wait for the page to actually settle (network-idle + a short quiet window) instead of a blind `waitForTimeout(500)`.
- **Why:** Both **accuracy** (catches late console/network errors deterministically) and **performance** (fast pages don't pay a flat 500 ms). Directly serves the North Star: the recording must reflect a genuinely-settled page.
- **Depends on:** 1.1 (for a configurable timeout/quiet-window).
- **In scope:** Use Playwright `waitForLoadState('networkidle')` with a capped fallback, plus a small configurable quiet window; keep behavior deterministic.
- **Out of scope:** Heuristic "app ready" detection via framework hooks.
- **Steps:** In `browser-bridge.js`, replace the fixed wait with `networkidle` (bounded by `--timeout`) followed by a short settle. Expose `--settle-ms` (default small) via config. Ensure timeouts degrade to captured evidence, not a crash.
- **Acceptance:** Trivial page is faster than today; a page with a delayed XHR error reliably surfaces the error.
- **Verify (delta):** Median perf A/B on both trivial and realistic fixtures; add a fixture with a late console error and assert it's captured.
- **Effort:** M.

### Task 1.3 — Configurable concurrency & custom viewports
- **Goal:** Let users define arbitrary viewport sizes and cap parallelism.
- **Why:** The bridge already captures viewports in parallel; expose control and remove the desktop/mobile-only limit.
- **Depends on:** 1.1, 1.2.
- **In scope:** `viewports = [{name, width, height}]` in config; `--viewport WxH` ad-hoc sizes; `--max-concurrency N` (default = number of viewports, capped for resource safety).
- **Steps:** Generalize `VIEWPORT_SIZES` in both `config.kujo` and `browser-bridge.js`; thread sizes through the provider; bound the `Promise.all` fan-out by `max-concurrency`.
- **Acceptance:** A custom 768×1024 viewport produces a correctly-sized screenshot; concurrency cap is honored.
- **Verify (delta):** Tests for viewport parsing/validation; perf check at concurrency 1 vs N.
- **Effort:** M.

---

## Phase 2 — Capture depth

Richer evidence. Each becomes a new check + finding type and feeds the artifact.

### Task 2.1 — Core Web Vitals / performance metrics
- **Goal:** Capture LCP, CLS, TTFB, and load timings per viewport; add a `LENS-PERF-NNN` check with thresholds.
- **Why:** "Visually passing" should include "performs acceptably." Strong evidence for the North-Star artifact.
- **Depends on:** 1.2 (readiness must be settled before reading vitals).
- **In scope:** PerformanceObserver / `web-vitals`-style collection in-page; deterministic thresholds via config; honest "metric unavailable" handling.
- **Steps:** Add a metrics `page.evaluate` block to the bridge; add `src/checks.kujo` PERF check + thresholds in config; document in reference.
- **Acceptance:** Metrics appear in `metadata.json`/report; threshold breach produces a finding.
- **Verify (delta):** Tests for threshold classification; confirm metrics carry no PII.
- **Effort:** M–L.

### Task 2.2 — Network throttling & device emulation
- **Goal:** `--throttle <profile>` (e.g. `3g`, `4g`) and `--device <name>` emulation.
- **Why:** Reproduces real-user conditions; makes the recording representative.
- **Depends on:** 1.3, 2.1.
- **Steps:** Use Playwright device descriptors + CDP `Network.emulateNetworkConditions`. Expose profiles via config/flags.
- **Acceptance:** A throttled run reflects slower timings in metrics; device emulation sets UA + viewport.
- **Effort:** M.

### Task 2.3 — Multi-browser providers (Firefox / WebKit)
- **Goal:** `--browser firefox|webkit|chromium` (chromium default). (Roadmap item.)
- **Why:** Cross-browser visual proof.
- **Depends on:** 1.3.
- **Steps:** Parameterize the bridge launcher over the Playwright browser type; ensure `npx playwright install` covers them; document that axe-core/video behave per engine.
- **Acceptance:** Each engine produces screenshots + evidence; unavailable engine degrades honestly.
- **Verify (delta):** Provider-shape tests per engine (mocked); manual smoke per engine.
- **Effort:** M.

### Task 2.4 — Optional auth-gated runs (safety-gated)
- **Goal:** Allow checking pages behind a login, **opt-in only**, with strict redaction.
- **Why:** Real work apps are usually authenticated. **This is the highest-risk item** — treat security as the primary acceptance criterion.
- **Depends on:** 0.5, 1.1, and the redaction suite must be rock-solid.
- **In scope:** Inject credentials/storage-state from a file referenced in config (never on the CLI); never log or persist them; require an explicit `allow_auth: true`.
- **Out of scope:** Credential discovery, OAuth flows, anything implicit.
- **Steps:** Add a vetted storage-state/header injection path; route everything through `redact.kujo`; ensure auth material is never written to any artifact.
- **Acceptance:** An authed page renders; **grep proves no credential/token appears in any artifact**; without `allow_auth` nothing is injected.
- **Verify (delta):** Dedicated redaction tests for the new auth fields; security review is mandatory and blocking.
- **Effort:** L.

### Task 2.5 — Deeper opt-in crawling
- **Goal:** Bounded, same-origin BFS crawl with `--crawl --max-depth N --max-pages M`.
- **Why:** Verify a small flow of pages, not just one. Keeps Lens "not a crawler" by default (opt-in, bounded, same-origin, destructive-path-skipping preserved).
- **Depends on:** 1.1.
- **Steps:** Extend link logic into a bounded queue reusing existing same-origin + unsafe-scheme + destructive-path guards; one report per page or an aggregated report.
- **Acceptance:** Crawl respects depth/page caps and never leaves the origin or hits destructive paths.
- **Effort:** L.

---

## Phase 3 — Reporting & ecosystem

### Task 3.1 — HTML report output
- **Goal:** A self-contained `lens-report.html` embedding screenshots, findings, and (later) video. `--report html|md|json|all`.
- **Why:** **Direct prerequisite for the North-Star artifact** — the shareable proof is an HTML page a non-technical stakeholder can open.
- **Depends on:** Phase 0; pairs with 1.x.
- **In scope:** Inline CSS, base64 or relative-linked screenshots, severity-grouped findings, the Agent Repair Brief; fully offline-openable.
- **Steps:** Add `src/report_html.kujo`; reuse the existing report data model; ensure redaction sweep still runs before HTML generation.
- **Acceptance:** `lens-report.html` opens offline and shows screenshots + findings; secrets still redacted.
- **Verify (delta):** Snapshot-style test of HTML structure; redaction test through the HTML path.
- **Effort:** M.

### Task 3.2 — Watch mode
- **Goal:** `lens watch <url>` re-runs on a debounce / file-change signal.
- **Why:** Tightens the build-verify loop the agent lives in.
- **Depends on:** Phase 0.
- **Steps:** Add a `watch` subcommand polling a path or interval; reuse the run pipeline; print a compact diff of findings vs the previous run.
- **Acceptance:** Editing the app triggers a fresh run; Ctrl-C exits cleanly.
- **Effort:** M.

### Task 3.3 — RunLedger integration
- **Goal:** Record each run to RunLedger for trend analysis. (Roadmap item.)
- **Why:** History of pass/fail + metrics over time.
- **Depends on:** 2.1 (metrics worth trending), 3.1.
- **Steps:** Add an opt-in `--ledger` that writes the run summary in RunLedger's expected schema (see the RunLedger tool). Keep it optional and side-effect-free by default.
- **Acceptance:** A run appears in RunLedger; absence of RunLedger is a no-op, not an error.
- **Effort:** M.

### Task 3.4 — Howl integration
- **Goal:** Post a pass/fail summary to Howl. (Roadmap item.)
- **Why:** Notify on completion / failure.
- **Depends on:** Phase 0.
- **Steps:** Opt-in `--howl`; emit a concise summary via the Howl tool's interface; never include unredacted data.
- **Acceptance:** Pass and fail both notify; opt-out is the default.
- **Effort:** S–M.

### Task 3.5 — Reusable GitHub Action
- **Goal:** A published action wrapping `lens check`/`flow` with the HTML report uploaded as a CI artifact.
- **Why:** Drops the North-Star artifact straight into a PR/workflow.
- **Depends on:** 0.4, 3.1.
- **Steps:** Add `action.yml` + a thin entrypoint; document inputs (url, fail-on, report format) and the uploaded artifact.
- **Acceptance:** A sample workflow runs Lens and attaches `lens-report.html`.
- **Effort:** M.

---

## Phase 4 — The proof-of-work artifact (North Star)

The capstone. Do these last; they depend on trustworthy evidence from above.

### Task 4.1 — Interactive flow execution
- **Goal:** Actually execute `click`, `type`, `wait_for_text`, `wait_for_selector`, `assert_text`, `assert_selector`, `assert_not_selector` — with per-step evidence — instead of skipping them. (Roadmap item; today's biggest limitation.)
- **Why:** A walkthrough recording is meaningless if the steps aren't performed. **This is the foundation of the North Star.**
- **Depends on:** 1.2 (readiness), 0.5 (error paths). Safety model in `src/flow.kujo` already exists — keep every guard.
- **In scope:** Real execution of safety-checked steps; per-step screenshots, console, and network deltas; assertions evaluated against true post-action state. Preserve: `safe: true` for clicks, destructive opt-in, secret-field opt-in, no implicit form submit, external-URL blocking.
- **Out of scope:** Recording macros / AI-generated flows.
- **Steps:** Extend `browser-bridge.js` to accept a step program and stream per-step results; rewrite the `execute_*` stubs in `runner.kujo` to consume real results; capture per-step evidence; keep honest `skipped` only when a step legitimately can't run.
- **Acceptance:** A flow that clicks a nav link and asserts text **passes only when the action truly succeeded**; every safety guard still blocks what it blocked before; redaction still covers typed values.
- **Verify (delta):** Tests for each step type (pass + fail + blocked); full re-run of the safety-model tests; security review of typed-input redaction; perf note on multi-step flows.
- **Effort:** L (highest-value).

### Task 4.2 — Video / screen recording of a flow
- **Goal:** Record the browser session to video while a flow runs; emit `recording.webm` (and/or mp4) as an artifact.
- **Why:** The literal deliverable — the screen recording of Lens walking the app.
- **Depends on:** 4.1.
- **In scope:** Playwright `recordVideo: { dir, size }` on the context (per the chosen viewport); attach the path to the report + artifact list; opt-in `--record`.
- **Out of scope:** Audio/narration tracks.
- **Steps:** Add `recordVideo` to the flow context in the bridge; ensure the video is saved and the path returned; add it to `meta["artifacts"]`, the HTML report (`<video>` tag), and the manifest. Redaction note: a recording can show on-screen secrets — document this and gate behind opt-in; consider masking known secret fields.
- **Acceptance:** A recorded flow produces a playable video embedded in `lens-report.html`; `--record` off by default.
- **Verify (delta):** Smoke that the video file is non-empty and embeds; document the on-screen-secret caveat in reference + getting-started.
- **Effort:** M.

### Task 4.3 — Narrated walkthrough artifact (the shareable proof)
- **Goal:** Combine the recording + per-step pass/fail into a single self-contained `walkthrough.html` (video + synchronized step timeline + overall PASS/FAIL banner + run metadata + verification hash).
- **Why:** This is the thing you hand to stakeholders at work: "the agent built it, here's Lens walking through it passing."
- **Depends on:** 4.1, 4.2, 3.1.
- **In scope:** Step timeline aligned to the video; PASS/FAIL summary; environment/version stamp; a content hash of the artifacts so it's tamper-evident. Fully offline.
- **Out of scope:** Hosting/upload (use Task 3.5 / Howl for distribution).
- **Steps:** Generate `walkthrough.html` from the flow results + video + screenshots; include a manifest hash; ensure the redaction sweep runs over every embedded string.
- **Acceptance:** Opening `walkthrough.html` offline shows the video, a step-by-step pass/fail timeline, and a clear top-line verdict; no unredacted secrets anywhere.
- **Verify (delta):** Redaction test through the walkthrough path; manual review that the verdict matches the underlying findings.
- **Effort:** M–L.

### Task 4.4 — Offending-element detection for overflow
- **Goal:** Identify *which* element causes horizontal overflow, not just that it occurred. (Roadmap item.)
- **Why:** Turns an overflow finding into an actionable, annotatable one — nicer in the walkthrough and the repair brief.
- **Depends on:** independent; nice complement to 4.3.
- **Steps:** Add an in-page scan (bridge) that finds elements exceeding the viewport width and returns selectors + bounds; surface in the OVERFLOW finding; optionally annotate the screenshot.
- **Acceptance:** Overflow findings name the offending selector; degrades gracefully when none found.
- **Effort:** M.

---

## Suggested execution order

```
0.1 → 0.2 → 0.3 → 0.4 → 0.5 → 0.6        (foundations: license, changelog, contributing, CI, coverage, bench)
1.1 → 1.2 → 1.3                          (config, readiness, viewports/concurrency)
2.1 → 2.2 → 2.3 → 2.5 → 2.4              (metrics, throttle, browsers, crawl; auth LAST in phase — riskiest)
3.1 → 3.2 → 3.3 → 3.4 → 3.5              (HTML report, watch, RunLedger, Howl, Action)
4.1 → 4.2 → 4.3 → 4.4                    (interactive flows → video → walkthrough artifact → overflow detail)
```

Loop an agent through one task at a time. Each ends at the
[standing gauntlet](#-standing-verification-gauntlet-applies-to-every-task);
only move to the next when the current one is fully green.
