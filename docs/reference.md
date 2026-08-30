# Lens Reference

> Complete reference manual. New here? Start with the [README](../README.md) for
> a quick tour, then come back here for the full details.

```
lens check http://localhost:3000
```

## What Lens Is

Lens is a standalone CLI tool that gives AI agents (and developers) "eyes" by
opening a local app or URL in a real Chromium browser, collecting deterministic
evidence (screenshots, console logs, network activity, DOM structure), running
pass/fail checks against that evidence, and producing an agent-ready repair
report.

Lens is designed for the feedback loop between "I just built this" and "is it
working?" — without requiring AI vision models, manual inspection, or complex
CI pipelines.

## What Lens Is Not

- **Not an AI/LLM tool** — No language models, no vision models, no subjective
  analysis. All checks are deterministic rules. Lens makes no design judgments
  and draws no root-cause conclusions it cannot back with captured evidence.
- **Not a general browser-automation tool** — Outside the explicit, safety-gated
  flow system, Lens does not click buttons, fill forms, or log in. `lens check`
  opens a URL and observes. `lens flow --execute` performs only the declared
  steps after safety validation.
- **Not a security scanner** — Lens does not check CSP headers, cookie security,
  HTTPS configuration, or XSS vectors.
- **Not a crawler** — Link checking is shallow, same-origin only, and opt-in.
  Lens does not recursively follow links.
- **Not a WCAG-compliance certifier** — Accessibility scanning uses axe-core
  automated rules. It detects common violations but never claims full compliance
  or certification, and does not replace manual review or screen-reader testing.

## Why Lens Exists

AI agents building software need fast, deterministic feedback about what they
just built. Before Lens, there was no tool in the Kujo ecosystem that could:

- Open a browser and capture what actually renders
- Detect blank pages, console errors, broken network requests, and overflow
- Produce a structured, machine-readable report an agent can act on
- Do all of this without AI/LLM dependencies, keeping the feedback loop cheap
  and repeatable

Lens fills the browser/visual QA gap in the Kujo toolchain.

## Ecosystem Fit

```
kujo (language runtime)
 ├── kennel (package manager)
 ├── spec (test expectations)
 ├── eval (grading/assertions)
 ├── shipcheck (release readiness)
 ├── runledger (run history)
 ├── howl (notifications)
 └── lens ← browser/visual QA
```

Lens integrates with the ecosystem through:
- **Stable JSON output** (`schema_version: "1"`) for tool consumption
- **Exit codes 0-4** for CI/CD and script integration
- **Agent Repair Brief** for downstream agent handoff
- Opt-in Spec/Eval/RunLedger/Howl integration surfaces

## Installation & Build

### Prerequisites

- **Kujo** runtime — built from `/2026/kujo` (`cargo build` produces
  `kujo`)
- **Node.js** >= 18 — required for the Playwright browser bridge
- **bash** — for the `lens` shell wrapper

### Build

```bash
# 1. Build Kujo (if not already built)
kujo --version
cargo build

# 2. Install Playwright Core + Chromium in the Lens bridge directory
cd /path/to/lens/bridge
npm install
npm run install-browser

# 3. Make the lens wrapper executable
chmod +x /path/to/lens/lens

# 4. (Optional) Add to PATH
export PATH="/path/to/lens:$PATH"
```

### Verify Installation

```bash
lens --version
# Lens v1.0.1

lens --help
# Shows usage and flags
```

For accessibility scanning, install axe-core in the bridge (bundled by
`npm install`, declared in `bridge/package.json`):

```bash
cd /path/to/lens/bridge
npm install   # installs playwright-core + axe-core
```

## Basic Usage

```bash
# Check a local dev server
lens check http://localhost:3000

# Fast one-viewport agent repair pass (also enables JSON output)
lens check http://localhost:3000 --quick

# Check with link checking enabled
lens check http://localhost:3000 --check-links

# Check with specific viewports
lens check http://localhost:5173 --viewport desktop --viewport mobile

# Limit link checking scope
lens check http://localhost:3000 --check-links --max-links 10

# Set a custom fail threshold
lens check http://localhost:3000 --fail-on warning

# Allow an external URL (use with caution)
lens check https://example.com --allow-external

# JSON output to stdout
lens check http://localhost:3000 --json

# Custom output directory
lens check http://localhost:3000 --out ./tmp/lens-run

# Verbose output for debugging
lens check http://localhost:3000 --verbose

# Custom timeout (seconds)
lens check http://localhost:3000 --timeout 60
```

## CLI Command Reference

```
lens check <url> [flags]

Flags:
  --config <path>      Load defaults from a TOML file (default: ./.lens.toml)
  --out <dir>          Output directory (default: .lens/runs/<timestamp>/)
  --viewport <name>    Viewport to capture: desktop, mobile, or WxH (repeatable)
                       Default: desktop and mobile
  --settle-ms <n>      Post-readiness settle window in ms (default: 400)
  --max-concurrency <n> Max viewports captured at once (default: all)
  --timeout <seconds>  Page load timeout in seconds (default: 30, max: 300)
  --verbose            Enable verbose terminal output
  --json               Print JSON summary to stdout
  --quick              Compact agent profile: JSON, desktop only, no settle
  --check-links        Enable shallow same-origin link checking
  --max-links <n>      Maximum links to check (default: 50)
  --allow-external     Allow checking external (non-localhost) URLs
  --fail-on <level>    Severity threshold for failure: info, warning, error,
                       critical (default: error)
  --spec <path>        Run deterministic browser assertions from a JSON spec
  --eval-out <path>    Write Eval-compatible JSON output
  --baseline           Save screenshots as visual baselines
  --compare-baseline   Compare screenshots against existing baselines
  --update-baseline    Permit overwriting existing baselines
  --baseline-dir <dir> Baseline storage directory
  --diff-threshold <n> Visual diff threshold from 0.0 to 1.0
  --accessibility      Run axe-core accessibility checks
  --a11y               Alias for --accessibility
  --a11y-tags <csv>    Limit axe-core rule tags
  --a11y-include <sel> Scope accessibility checks to a selector
  --a11y-exclude <sel> Exclude a selector from accessibility checks
  --perf               Capture opt-in performance metrics
  --throttle <profile> Emulate slow-3g, 3g, or 4g network conditions
  --device <name>      Emulate a Playwright device descriptor
  --browser <name>     Browser engine: chromium, firefox, or webkit
  --auth-file <path>   Inject Playwright storage-state into the browser
  --crawl              Run a bounded same-origin crawl
  --max-depth <n>      Crawl depth, default 1, max 5
  --max-pages <n>      Crawl page cap, default 20, max 200
  --html               Also write lens-report.html
  --watch              Re-run on an interval until interrupted
  --watch-interval <n> Watch interval in seconds
  --ledger <path>      Append RunLedger-compatible JSONL
  --howl <path>        Write a Howl summary JSON
  --help, -h           Show help
  --version, -v        Show version
```

## Configuration File

Lens reads project-level defaults from a TOML file so teams don't repeat flags
on every run. By default it looks for `.lens.toml` in the current directory;
pass `--config <path>` to use a specific file.

**Precedence:** built-in defaults < config file < CLI flags. A CLI flag always
wins. Boolean flags are additive — the file can turn a feature on, and a flag
can also turn it on, but a flag cannot turn off something the file enabled.

An **explicit** `--config` that is missing or malformed is a hard error
(exit 2). An **implicit** absent `.lens.toml` is simply ignored.

Supported keys (mirror the flag names with underscores; unknown keys ignored):

```toml
# .lens.toml
fail_on        = "warning"          # info | warning | error | critical
timeout        = 45                 # seconds
check_links    = true
max_links      = 25
allow_external = false
viewports      = ["desktop", "mobile", "1024x768"]
out_dir        = "./.lens/runs"
settle_ms      = 300                # post-readiness settle window (ms)
max_concurrency = 2                 # cap concurrent viewport captures
accessibility  = true
a11y_tags      = ["wcag2a", "wcag2aa"]
a11y_include   = "main"
a11y_exclude   = "[data-testid='widget']"
diff_threshold = 0.02
baseline_dir   = "./.lens/baselines"
```

### Custom viewports

Beyond the `desktop` (1440×900) and `mobile` (390×844) presets, any
`<width>x<height>` token is a custom viewport — `--viewport 1024x768` or a
`viewports = ["1024x768"]` entry. The screenshot and DOM summary are captured at
that exact size, and the artifact is named after the token (`1024x768.png`).
Each dimension must be between 1 and 4096 pixels, bounding screenshot memory and
artifact size.

### Readiness & concurrency

`--settle-ms` controls how long Lens waits after the page reaches network-idle
before capturing (default 400 ms). Lower it for snappier runs on simple pages;
raise it for apps with late client-side rendering. `--max-concurrency` caps how
many viewports are captured at once (default: all of them, in parallel).

### Quick agent profile

`--quick` is an opt-in inner-loop profile for autonomous repair work. It emits
JSON, captures only the desktop viewport, sets the post-readiness settle window
to zero, and uses Chromium. Explicit `--viewport`, `--settle-ms`, and
`--browser` flags still override those choices. Project config cannot silently
weaken the profile. Run a normal check without `--quick` before handoff to
restore the default desktop+mobile coverage.

## Capture Depth (Phase 2)

These options enrich the evidence Lens collects. All are opt-in; default runs
are unchanged and fully deterministic.

| Flag | What it does | Notes |
|------|--------------|-------|
| `--perf` | Capture LCP, CLS, TTFB, FCP, and load timings per viewport into `metrics.json`; emit `LENS-PERF` warnings past thresholds | Opt-in because timing is environment-dependent. Thresholds: `perf_lcp_ms` (4000), `perf_cls_x100` (25), `perf_ttfb_ms` (1500), tunable in the config file. |
| `--throttle <profile>` | Emulate `slow-3g` / `3g` / `4g` network conditions | Chromium only; other engines ignore it (recorded in metadata). |
| `--device <name>` | Emulate a Playwright device descriptor (e.g. `"iPhone 13"`) | Sets the device's viewport + user agent. |
| `--browser <name>` | Run on `chromium` (default), `firefox`, or `webkit` | Non-default engines require `npx playwright-core install <engine>`; a missing engine exits 3 with a clear message. |
| `--auth-file <path>` | Inject a Playwright **storage-state** JSON so Lens can check an authenticated page | **Opt-in.** Lens validates the JSON envelope, then passes the path to Playwright. Contents are never logged or written to an artifact. Missing, malformed, or invalid-shape files exit 2. |
| `--crawl` | Bounded, same-origin, safety-gated crawl from the start URL | See below. |
| `--max-depth <n>` | Crawl depth from the start URL | Default 1, max 5. |
| `--max-pages <n>` | Total pages a crawl may visit | Default 20, max 200. |

### Performance metrics (`--perf`)

Metrics are written to `metrics.json` (one object per viewport) and surfaced as
`LENS-PERF` findings only when a value exceeds its threshold. Because timings
vary by machine and network, this is **off by default** to keep ordinary runs
reproducible. Treat the numbers as environment-relative evidence, not absolute
pass/fail gates.

### Authenticated runs (`--auth-file`)

Pass a Playwright storage-state file (cookies + localStorage, the output of
`context.storageState({ path })`) to check a page behind a login. Lens reads the
file only to verify that it is valid JSON with Playwright's `cookies` and
`origins` arrays; it never returns, echoes, or persists the parsed content. The
validated path is then handed to Playwright. Validation errors omit the path and
parser details. The network capture remains a strict whitelist (no headers,
cookies, or bodies), so no credential reaches an artifact. This is the one
feature that can render authenticated content on screen — review screenshots
before sharing them.

### Bounded crawl (`--crawl`)

A crawl is a breadth-first sweep of a local app's **own** pages — not a general
web crawler. Every link is re-validated before navigation and must be
same-origin; unsafe schemes (`mailto:`, `javascript:`, …) and destructive paths
(`/logout`, `/delete`, …) are skipped, and external URLs are never followed.
Each page gets a lightweight health assessment (page load, console errors,
network failures, blank content); results are aggregated into `crawl.json` and
`LENS-CRAWL` findings, with per-page screenshots under `pages/<n>/`.

## Reporting & ecosystem (Phase 3)

| Flag | What it does |
|------|--------------|
| `--html` | Also write a self-contained `lens-report.html` (escaped, screenshots embedded, findings by severity). |
| `--watch` / `--watch-interval <n>` | Re-run the check every `n` seconds until interrupted (Ctrl-C). |
| `--ledger <path>` | Append a RunLedger-compatible JSONL record (one line per run). |
| `--howl <path>` | Write a Howl pass/fail summary (verdict, counts, report pointer). |

A reusable GitHub Action ships as [`action.yml`](../action.yml): it installs the
bridge, runs `lens check`, and uploads the report as a CI artifact.

Action inputs are passed through environment variables rather than interpolated
into the shell program. The free-form `args` input is tokenized without shell
evaluation, so quoted values remain usable and command substitutions are inert.

CI also runs the bridge on Linux and macOS with Node 18/20/22, verifies each
Playwright engine and its missing-engine exit-3 behavior, and exercises the full
fixture-backed artifact surface. The separate performance workflow runs only
manually or for pull requests labeled `performance`.

## Interactive flows & the proof-of-work artifact (Phase 4)

By default `lens flow` is read-only: interactive steps are safety-checked but
reported as `skipped`. With `--execute`, Lens performs them for real.

```bash
# Execute a flow, record it, and emit the shareable walkthrough
lens flow examples/flows/login.json --execute --record --walkthrough
```

| Flag | What it does |
|------|--------------|
| `--execute` | Actually perform `click` / `type` / `wait_for_*` / `assert_*` steps in a live browser session, with real per-step pass/fail. |
| `--record` | Record the session to `video/walkthrough.webm`. |
| `--walkthrough` | Emit `walkthrough.html`: the recording + a synchronized step timeline + a PASS/FAIL verdict + a deterministic run fingerprint. |

**Safety is unchanged.** Every step is still run through the flow safety model
*before* execution — clicks need `safe: true`, destructive targets need explicit
opt-in, secret fields need `secret: true`, external URLs need `allow_external`.
Blocked steps are never sent to the browser.

**Secrets are redacted in the written artifacts.** Typed values are redacted to
`[REDACTED]` in `flow.json`, and the internal program handoff is deleted right
after use. Because a recording *can* film on-screen content, treat `--record`
output like any screenshot — password fields render masked, but review before
sharing.

The North-Star workflow: an agent fixes a task, runs the flow to verify its own
work, and hands a stakeholder the `walkthrough.html` as visual proof the app
passes.

## Horizontal overflow detail (Phase 4.4)

Overflow findings now name the offending element(s) and width, e.g.
*"Offending element(s): div#wide (3000px)"* — turning a vague warning into an
actionable, annotatable one. Only CSS-style selectors and widths are captured,
never element HTML or text.

## URL Safety

Lens is **local-first** by design. Only development hosts are allowed without
the explicit `--allow-external` flag:

| Host | Example |
|------|---------|
| `localhost` | `http://localhost:3000` |
| `127.0.0.1` | `http://127.0.0.1:8080` |
| `::1` | `http://[::1]:3000` |

Attempting to check an external URL without `--allow-external` exits with code
**2** and prints:

```
Lens failed: External URLs are blocked by default. Use --allow-external to check
 public URLs.
```

## Browser Provider Strategy

Lens uses a Node.js/Playwright Core bridge (`bridge/browser-bridge.js`) to
control Chromium's optimized headless shell. That is the fastest and leanest
default for Lens's capture workload; Firefox and WebKit remain opt-in
compatibility engines. The bridge is a minimal script that handles only what
Kujo cannot do natively:

- Launching Chromium in headless mode
- Navigating to the target URL
- Capturing per-viewport screenshots (PNG)
- Collecting console messages (errors, warnings, logs)
- Recording network request/response metadata
- Extracting DOM summaries (title, element counts, dimensions)
- Extracting visible same-origin links

The bridge does **not**:
- Click, type, scroll, or interact with the page
- Store request/response bodies
- Store cookies or auth headers
- Follow redirects beyond the initial navigation
- Run JavaScript beyond what the page itself loads

Bridge output is always JSON. Kujo parses the JSON and runs all checks in pure
Kujo code — the bridge has no awareness of checks, findings, or reports.

## Output Directory Structure

```
<out-dir>/
├── lens-report.md          # Human-readable Markdown report
├── lens-report.json        # Machine-readable JSON report (schema v1)
├── metadata.json           # Run metadata (timing, config, versions)
├── console.json            # Browser console messages (redacted)
├── network.json            # Network request/response metadata (redacted)
├── dom-summary.json        # DOM element counts and viewport dimensions
├── links.json              # Link check results (only when --check-links)
└── screenshots/
    ├── desktop.png         # 1440x900 viewport (when --viewport desktop)
    └── mobile.png          # 390x844 viewport (when --viewport mobile)
```

Notes:
- `links.json` is only generated when `--check-links` is enabled.
- Screenshots are generated for each requested viewport.
- Reports are redacted by default so unredacted secrets, tokens, or credentials
  do not appear in the standard artifact set.
- All JSON artifacts use stable keys suitable for tool integration.
- The default output directory is `.lens/runs/<timestamp>/`.
- Per viewport, console evidence is capped at 1,000 entries, failed-network
  evidence at 2,000 entries, and captured links at 5,000 entries. Lens emits a
  `LENS-CAPTURE-LIMITS` warning if evidence is truncated.
- Flow recordings are capped at 100 MiB. An oversized recording is removed and
  represented by an `artifact_limit` warning in the flow results.

### Write destination policy

Lens validates all user-selected write destinations before creating artifacts.
`--out` and `--baseline-dir` must name dedicated directories; `/`, `.`, `..`,
existing files, and final-target symlinks are rejected. `--eval-out`, `--ledger`,
and `--howl` must name files whose parent directory already exists; existing
directories, final-target symlinks, trailing-slash paths, and duplicate direct
file destinations are rejected. Paths containing a `..` traversal component
are rejected. Parent-directory symlinks retain ordinary host
filesystem behavior (for example, macOS `/tmp`). Invalid destinations exit 2.

## Checks

| Check | Finding ID Prefix | What it detects | Severity |
|-------|-------------------|----------------|----------|
| Page Load | `LENS-PAGELOAD-` | Provider failures, navigation errors, timeouts | critical/error |
| Console Errors | `LENS-CONSOLE-` | Browser console errors and warnings | error/warning |
| Network Failures | `LENS-NETWORK-` | Failed requests (4xx/5xx, connection failures) | error/warning |
| Blank Page | `LENS-BLANK-` | Pages with little or no rendered content (multi-factor) | critical/warning |
| Horizontal Overflow | `LENS-OVERFLOW-` | Document width exceeding viewport width | error/warning |
| Screenshots | `LENS-SCREENSHOT-` | Missing screenshot artifacts | error |
| Link Check | `LENS-LINKS-` | Broken same-origin links (opt-in) | error/warning |

## Markdown Report Format

The Markdown report includes these sections:

- **Header**: Status, URL, timing, viewports, output directory
- **Summary**: Pass/fail status, finding counts by severity, fail threshold,
  exit code, checks run/skipped, artifacts written, one-paragraph summary
- **Critical Issues / Errors / Warnings**: Findings grouped by severity with
  finding IDs
- **Evidence**: Runtime artifacts collected
- **Suggested Repair Tasks**: Numbered, severity-ordered repair tasks
- **Agent Repair Brief**: Page-load trust gate, viewport summary, link summary,
  first artifacts to inspect, ordered first-pass strategy, avoid-assumptions
- **Artifacts**: List of all generated files

## JSON Report Schema

The JSON report uses `schema_version: "1"` for stable tool integration.

Top-level fields: `schema_version`, `status`, `url`, `final_url`, `started_at`,
`finished_at`, `duration_ms`, `viewports`, `fail_threshold`, `exit_code`,
`summary`, `checks`, `findings`, `artifacts`, `repair_brief`, `metadata`.

### Check Result Object

```json
{
  "name": "Page Load",
  "id": "page_load",
  "status": "pass",
  "severity": "info",
  "finding_count": 0,
  "findings": [],
  "duration_ms": 0
}
```

Check statuses: `pass`, `fail`, `skipped`, `error`.

### Finding Object

```json
{
  "id": "LENS-PAGELOAD-001",
  "check_name": "PAGELOAD",
  "severity": "critical",
  "title": "Page failed to load",
  "description": "The browser could not navigate to the target URL.",
  "evidence": "console.json (provider_errors)",
  "suggested_repair_task": "Verify the server is running and the URL is correct."
}
```

## Agent Repair Brief

The Agent Repair Brief is a concise, structured section designed for downstream
AI agents. It provides:

1. **Page-load trust gate** — Whether the page loaded enough to trust secondary
   findings (console, network, overflow, links)
2. **Viewport summary** — Which viewports were tested
3. **Link check status** — Whether link checking ran and findings count
4. **First artifacts to inspect** — Top 3 evidence files from critical/error
   findings
5. **Ordered first-pass strategy** — Steps by severity (critical, error, warning)
6. **Avoid-assumptions note** — Don't assume framework-specific root causes
   without evidence

For passing runs: states no repair needed, artifacts can serve as baseline.
For `--fail-on info` edge case: explains the situation and suggests raising the
threshold.

## Severity Model

```
info < warning < error < critical
```

| Severity | Meaning | Example |
|----------|---------|---------|
| `info` | Informational only, no action needed | Link check was skipped |
| `warning` | Potential issue, may need attention | Minor horizontal overflow |
| `error` | Definite problem, should be fixed | Console error, 404 response |
| `critical` | Blocking issue, must be fixed | Page failed to load, blank page |

### `--fail-on` Behavior

| Flag | Fails on |
|------|----------|
| `--fail-on critical` | Critical only (strictest) |
| `--fail-on error` | Error + critical (default) |
| `--fail-on warning` | Warning + error + critical |
| `--fail-on info` | All findings (most sensitive) |

## Exit Codes

| Code | Name | When |
|------|------|------|
| 0 | `EXIT_OK` | No findings at or above fail threshold |
| 1 | `EXIT_CHECK_FAIL` | One or more findings at or above fail threshold |
| 2 | `EXIT_INVALID_INPUT` | Bad URL, missing args, blocked external URL |
| 3 | `EXIT_BROWSER_FAIL` | Browser bridge crashed, Node.js missing, timeout |
| 4 | `EXIT_ARTIFACT_FAIL` | Disk full, permission denied, write failure |

## Link Checking

### What `--check-links` Does

- Checks same-origin links only (same scheme + host + port as target URL)
- Uses HTTP GET; verifies 2xx/3xx status
- Respects `--max-links` limit (default: 50)
- Skips unsafe schemes: `javascript:`, `mailto:`, `tel:`, `data:`, `file:`,
  `ftp:`
- Skips destructive-looking paths: `/logout`, `/signout`, `/delete`, `/remove`,
  `/admin/delete`
- Normalizes URLs (fragments, trailing slashes)
- Produces `links.json` with per-link status and error details
- Adds `LENS-LINKS-NNN` findings for broken links

### What `--check-links` Does NOT Do

- Does not follow redirects to external domains
- Does not recursively crawl linked pages
- Does not check external links
- Does not submit forms or click buttons
- Does not execute JavaScript to discover links
- Does not check link response bodies (only HTTP status codes)

## Redaction & Privacy

Redaction is centralized in `src/redact.kujo` and applied as **defense in
depth** at three layers:

1. **At capture** — when `console.json`, `network.json`, `dom-summary.json`,
   and `links.json` are written.
2. **At finding construction** — so in-memory findings are already clean.
3. **As a final sweep** — every finding is scrubbed again (via
   `redact_check_results`) before any report, Eval file, or JSON output is
   generated.

This redaction pipeline is designed so raw secrets do not reach
`lens-report.md`, `lens-report.json`, `metadata.json`, `dom-summary.json`,
`accessibility.json`, an Eval file, or the Agent Repair Brief — not only the
raw capture artifacts.

**What is redacted everywhere (artifacts AND reports):**
- Bearer tokens → `Bearer [REDACTED]`
- JWTs (`eyJ…`) → `[REDACTED_JWT]`
- Basic-auth credentials in URLs (`user:pass@host`) → `[REDACTED]@host`
- Sensitive URL query parameters (token, access_token, refresh_token, id_token,
  api_key, apikey, auth, password, secret, client_secret, key, signature, sig,
  session, sessionid, jsessionid, phpsessid, code, …) → `<param>=[REDACTED]`
- Inline `key=value` / `key: value` secret assignments in any free text,
  including console message text and the console `location` field
- The target URL itself (in every report, metadata, and DOM summary)
- The visible DOM text sample (scrubbed of any rendered secrets)

**Sensitive headers** (Authorization, Cookie, Set-Cookie, X-API-Key,
X-CSRF-Token, …) are recognized and never emitted.

**Never stored at all:** request bodies, response bodies, cookies, and auth
headers. The network capture is a strict whitelist — only URL (redacted),
method, status, status text, failure text, resource type, timestamp, and
viewport are retained.

Benign values (e.g. `page=1`, `q=hello`, `monkey=1`) are preserved; the
generic `key=` rule is length-qualified to avoid over-redacting short tokens.

## Safe Browser Behavior

- **No state mutation** — Lens does not click, type, submit, or interact
- **No authentication** — Lens does not log in or use credentials
- **No form submission** — Forms are never filled or submitted
- **No navigation** — Exactly one URL per viewport
- **No crawling** — Link checking is shallow, not recursive
- **No destructive paths** — Destructive-looking link patterns are skipped
- **No external requests by default** — Requires `--allow-external`
- **Browser sessions close** — Chromium exits after each run
- **No persistent storage** — No cookies, localStorage, or cache preserved

## Finding IDs

Each finding gets a unique, stable ID with a per-check prefix:

- `LENS-PAGELOAD-001`, `LENS-PAGELOAD-002`, ...
- `LENS-CONSOLE-001`, `LENS-CONSOLE-002`, ...
- `LENS-NETWORK-001`, `LENS-NETWORK-002`, ...
- `LENS-BLANK-001`, `LENS-BLANK-002`, ...
- `LENS-OVERFLOW-001`, `LENS-OVERFLOW-002`, ...
- `LENS-SCREENSHOT-001`, `LENS-SCREENSHOT-002`, ...
- `LENS-LINKS-001`, `LENS-LINKS-002`, ...

Counters are per-check and padded to 3 digits. Finding IDs are deterministic
within a run and appear in both Markdown and JSON reports.

## Tests

```bash
kujo run tests/lens_tests.kujo
# 448 assertions covering CLI parsing, URL validation, checks, findings,
# report generation, redaction (free-text, URL, finding, sweep, console,
# network, DOM), provider partial-failure resilience, error/exit-code
# paths, page-load classification, accessibility engine handling,
# binary-safe baseline copy, provider shapes, and artifact writing.
```

## Performance

The dominant cost of a run is the browser bridge (Chromium launch +
navigation), not the Kujo pipeline. Lens uses Playwright Core and Chromium's
optimized headless shell by default; Firefox and WebKit remain explicit
compatibility choices. The bridge captures viewports
**concurrently**, so a default desktop+mobile run is close to the cost of a
single viewport on pages with real load latency.

The launcher prefers an installed Kujo runtime, then a sibling release build,
before falling back to a sibling debug build. Set `KUJO_BIN` to override that
selection. For the shortest agent repair loop, use `--quick`; keep the full
default run as the final regression gate.

Use the fixture-backed benchmark harness to capture medians and catch regressions:

```bash
scripts/bench.sh 3 /tmp/lens-bench.json
python3 scripts/compare-benchmarks.py /tmp/before.json /tmp/after.json
```

The harness covers direct bridge and CLI runs plus trivial, realistic, SPA,
image-heavy, late-network, and many-link pages. It writes stable JSON receipts;
`benchmarks/baseline.json` records an informational local reference. Compare
before/after receipts on the same runner because browser timings are
environment-sensitive.

When making a change that could affect speed, record `scripts/bench.sh` output
before and after (or set `LENS_BENCH_TARGET_ROOT` to another checkout) and note
the delta in the PR. A regression must be justified.

## Architecture

```
lens (shell wrapper)
└── lens.kujo (entry point)
    ├── src/config.kujo        — CLI parsing, severity model, defaults
    ├── src/validate.kujo      — URL validation, localhost safety
    ├── src/provider.kujo      — Browser bridge abstraction (with retry)
    ├── src/checks.kujo        — Deterministic check implementations
    ├── src/report.kujo        — Markdown + JSON report generation
    ├── src/redact.kujo        — Centralized secret/sensitive data redaction
    ├── src/spec.kujo          — Spec file loading + assertion classification
    ├── src/eval.kujo          — Eval-compatible output generation
    ├── src/flow.kujo          — Safe flow parsing, validation, safety model
    ├── src/visual.kujo        — Visual baselines + diffing
    ├── src/accessibility.kujo — axe-core results → findings
    ├── src/runner.kujo        — Orchestrator (provider → checks → report)
    └── src/common.kujo        — Shared helpers

bridge/
├── browser-bridge.js         — Playwright/Chromium automation + axe-core (Node.js)
└── visual-diff.py            — Pixel-level screenshot diff (Pillow + numpy)

tests/
└── lens_tests.kujo           — 398 unit/integration tests

docs/
└── reference.md              — This reference manual
```

## Manual Smoke Testing

### Basic Smoke Test

```bash
# Start a test server
python3 -m http.server 9876 --bind 127.0.0.1 &

# Run Lens
./lens check http://127.0.0.1:9876

# Expected output:
#   Lens completed: PASS
#   Report: .lens/runs/<timestamp>/lens-report.md

# Expected artifacts:
ls .lens/runs/*/
#   lens-report.md, lens-report.json, metadata.json
#   console.json, network.json, dom-summary.json
#   screenshots/desktop.png, screenshots/mobile.png
```

### Link Check Smoke Test

```bash
./lens check http://127.0.0.1:9876 --check-links --max-links 5
# Expected additional artifact: links.json
```

### External URL Blocking

```bash
./lens check https://example.com
# Expected: "External URLs are blocked by default." Exit code: 2
```

### External URL with --allow-external

```bash
./lens check https://example.com --allow-external
# Expected: Runs normally (PASS or FAIL with findings)
```

### Fail Threshold

```bash
./lens check http://127.0.0.1:9876 --fail-on warning
```

### JSON Output

```bash
./lens check http://127.0.0.1:9876 --json
# Expected: Valid JSON on stdout
```

### Custom Output Directory

```bash
./lens check http://127.0.0.1:9876 --out ./tmp/my-lens-run
```

### Cleanup

```bash
kill %1  # Stop the test server
```

## Troubleshooting

### 1. Node.js Missing
```
Lens error: Node.js is required for browser automation.
```
**Fix:** Install Node.js >= 18. Verify: `node --version`.

### 2. Browser Failed to Launch
```
Lens error: Browser provider failed.
```
**Fix:** `cd bridge && npm install && npm run install-browser`.

### 3. Page Load Timeout
**Fix:** Verify server is running. Increase timeout in seconds: `--timeout 60`
or, at most, `--timeout 300`.

### 4. Screenshots Not Generated
Check write permissions on output directory. Run with `--verbose`.

### 5. Empty Artifacts
Empty `[]` console/network arrays are normal if the page produced no output.

### 6. External URL Blocked
Add `--allow-external`. This is a safety feature.

### 7. Link Checking Skipped
Add `--check-links`. Link checking is opt-in.

### 8. Many Link Check Warnings
Links may require auth (401/403), be rate-limited (429), or redirect
externally. Use HTTP status codes in findings to triage.

### 9. JSON Output Confusion
`--json` prints a summary to stdout. For full JSON, read `lens-report.json`.

### 10. Write/Permission Failure
Use `--out` with a writable directory. Check disk space with `df -h`.

## Known Limitations

1. **Observation by default** — `lens check` never mutates state. Interaction
   happens only through explicit, safety-gated `lens flow --execute`.
2. **Performance metrics are not Lighthouse scores** — `--perf` captures basic
   LCP/CLS/TTFB/FCP-style evidence for trend and threshold checks, not a full
   Lighthouse audit.
3. **Bounded crawl only** — `--crawl` is same-origin, capped, and
   destructive-path-aware. Lens is not a general crawler.
4. **Auth is storage-state only** — `--auth-file` injects a Playwright
   storage-state file by path. Lens does not discover credentials, manage
   logins, or store auth material.
5. **Alternate browsers require local installs** — `--browser firefox|webkit`
   uses Playwright engines that must be installed in the bridge environment.
6. **Link checking is HTTP only** — No WebSocket/SSE. Shallow redirect following.
7. **Blank page detection is heuristic** — multi-signal but may miss
   canvas-only or WebGL-only pages.
8. **Overflow evidence is selector-level, not DOM dumps** — Findings name
   oversized selectors and widths without storing element HTML or rendered text.
9. **Visual diff is pixel-based** — Fixed per-channel threshold; sub-pixel
    anti-aliasing may trigger small differences (tune with `--diff-threshold`).
10. **Accessibility is automated-only** — axe-core catches common violations but
    cannot detect every issue; manual review remains essential.
11. **Kujo runtime constraints** — Immutable function params; dict access guarded
    with `has_key`; binary files copied via the system `cp` (Unix environments).

## Dependencies

- **Kujo** runtime — built from `/2026/kujo`
- **Node.js** >= 18 — for Playwright browser bridge
- **Playwright Core** + **Chromium headless shell** — in `bridge/node_modules`
- **bash** — for the `lens` shell wrapper

## Spec Integration (Phase 7)

Lens can optionally verify browser-focused Spec assertions via `--spec <path>`.

### What `--spec` Does

- Loads a JSON Spec file with deterministic browser-checkable assertions
- Runs Spec-backed checks after normal Lens checks
- Adds `LENS-SPEC-NNN` findings for failing assertions
- References Spec evidence in reports

### What `--spec` Does NOT Do

- Does not require Spec to run — Lens works normally without it
- Does not interpret natural language
- Does not use AI/LLM to evaluate assertions
- Does not replace or modify Lens's normal check behavior

### Supported Assertions

| Key | Sub-key | What it checks |
|-----|---------|---------------|
| `url` | `path_contains` | URL path contains expected string |
| `title` | `contains` | Page title contains expected text (case-insensitive) |
| `text` | `contains` | Page body text contains expected strings |
| `selectors` | `exists` | Known selectors (`main`, `body`) exist in DOM |
| `selectors` | `not_exists` | Known selectors do not exist in DOM |
| `console` | `no_errors` | No browser console errors |
| `network` | `no_5xx` | No HTTP 5xx server errors |
| `layout` | `no_horizontal_overflow` | No horizontal overflow in any viewport |
| `links` | `no_broken_same_origin` | No broken same-origin links (requires `--check-links`) |

### Example Spec File

```json
{
  "title": { "contains": "Dashboard" },
  "url": { "path_contains": "/dashboard" },
  "text": { "contains": ["Welcome", "Recent Activity"] },
  "selectors": {
    "exists": ["main"],
    "not_exists": [".error-boundary"]
  },
  "console": { "no_errors": true },
  "network": { "no_5xx": true },
  "layout": { "no_horizontal_overflow": true },
  "links": { "no_broken_same_origin": true }
}
```

### Usage

```bash
# Run with a Spec file
lens check http://localhost:3000 --spec examples/specs/dashboard.json

# Spec + Eval output
lens check http://localhost:3000 --spec examples/specs/dashboard.json --eval-out ./eval/lens-results.json
```

### Unsupported Spec Keys

Keys not in the supported list are silently ignored. They do not crash the run.
Future versions may produce warning findings for unsupported keys.

### Invalid Spec Behavior

- Missing file → exit code 2
- Invalid JSON → exit code 2
- Empty spec → exit code 2

## Eval Output (Phase 7)

When `--eval-out <path>` is provided, Lens writes an Eval-compatible JSON file.

### What `--eval-out` Does

- Writes a stable JSON result file at the specified path
- Includes all Lens check results plus Spec-backed results when `--spec` is used
- Uses `schema_version: 1` for tool compatibility

### Eval Output Structure

```json
{
  "schema_version": 1,
  "tool": "lens",
  "status": "PASS",
  "url": "http://localhost:3000",
  "started_at": "2026-05-31T00:00:00Z",
  "finished_at": "2026-05-31T00:00:05Z",
  "duration_ms": 5000,
  "summary": { "total": 2, "passed": 1, "failed": 1, "skipped": 0 },
  "results": [
    {
      "id": "LENS-SPEC-001",
      "name": "Page title does not contain expected text",
      "status": "fail",
      "severity": "error",
      "evidence": ["spec file, dom-summary.json"],
      "message": "Spec expected title to contain 'Dashboard'..."
    }
  ],
  "artifacts": ["lens-report.md", "..."],
  "spec": { "path": "examples/specs/dashboard.json", "enabled": true }
}
```

### Usage

```bash
# Write eval output
lens check http://localhost:3000 --eval-out ./eval/lens-results.json

# Spec + Eval
lens check http://localhost:3000 --spec examples/specs/dashboard.json --eval-out ./eval/lens-results.json
```

Write failures (permission denied, disk full) return exit code 4.

## Safe Browser Flows (Phase 8)

Lens can execute safe, deterministic browser flow files via `lens flow <file>`.

### What `lens flow` Does

- Validates safety rules for every declared step before anything runs
- In default read-only mode, performs the declared primary navigation and
  reports interactive steps as `skipped`
- With `--execute`, performs declared `click`, `type`, `scroll`,
  `wait_for_*`, and `assert_*` steps in a live browser session
- Evaluates assertions against captured or executed evidence — these are real
  pass/fail checks, never fabricated
- Blocks destructive-looking actions by default
- Produces flow-specific artifacts and reports with `LENS-FLOW-NNN` findings

### What `lens flow` Does NOT Do

- Does not use AI/LLM to interpret or generate flows
- Does not submit forms implicitly
- Does not recursively crawl pages
- Does not perform destructive actions without explicit opt-in
- Does not store secrets or credentials

### Basic Usage

```bash
# Run a flow file
lens flow examples/flows/dashboard.json

# With custom output and fail threshold
lens flow examples/flows/dashboard.json --out ./tmp/flow-run --fail-on warning

# With eval output
lens flow examples/flows/dashboard.json --eval-out ./eval/flow-results.json

# Execute safe interactions and produce proof
lens flow examples/flows/login.json --execute --record --walkthrough
```

### Flow File Format

Flow files use JSON format with these top-level fields:

```json
{
  "name": "Dashboard smoke flow",
  "description": "Verify dashboard renders key UI safely",
  "url": "http://localhost:3000/dashboard",
  "viewports": ["desktop", "mobile"],
  "timeout_seconds": 20,
  "allow_external": false,
  "allow_destructive": false,
  "steps": [
    {"visit": "http://localhost:3000/dashboard"},
    {"screenshot": {"name": "initial"}},
    {"wait": {"ms": 500}},
    {"assert_no_console_errors": true}
  ]
}
```

### Supported Steps

Steps marked "interactive" are **executed** only with `--execute` (Phase 4.1);
without it they are reported honestly as `skipped`. All clicks remain
safety-gated regardless.

| Step | Description | Notes |
|------|-------------|-------|
| `visit` | Navigate to a URL | Always executed; external URLs require `allow_external: true` |
| `screenshot` | Capture a named screenshot | `{ "screenshot": { "name": "step" } }` |
| `scroll` | Smooth-scroll to an element or position | `{ "scroll": { "selector": "..." } }` or `{ "scroll": { "y": 1200 } }` (interactive) |
| `wait` | Static wait (max 10s) | Safety-limited |
| `click` | Click a selector | Requires `safe: true`; destructive targets blocked (interactive) |
| `type` | Type into a field | Secret fields require `secret: true`; value redacted everywhere (interactive) |
| `wait_for_text` | Wait for visible text | interactive |
| `wait_for_selector` | Wait for a visible selector | interactive |
| `assert_text` | Assert body text contains | interactive |
| `assert_selector` | Assert a selector exists | interactive |
| `assert_not_selector` | Assert a selector is absent | interactive |
| `assert_no_console_errors` | Assert no console errors | Evaluated against captured/execution evidence |
| `assert_no_failed_requests` | Assert no failed requests | Evaluated against captured/execution evidence |

Selectors are Playwright selectors — CSS plus the text engine (e.g.
`h3:has-text("Pricing")`, `a[href*="/signup"]`). When multiple elements match,
the first is used.

### Recording the walkthrough

Add `--record` (with `--execute`) to capture the session to
`video/walkthrough.webm`, and `--walkthrough` to emit a shareable
`walkthrough.html` (recording + synchronized step timeline + run fingerprint).
While recording, Lens overlays a **visible cursor** that glides to each target
and pulses on click, so the video shows what happened. The cursor is a visual
aid only — it changes nothing the checks observe, and typed secret values are
never shown.

### Safety Model

Lens enforces a strict safety model for all flow execution:

1. **Click safety**: Every click step must declare `safe: true`
2. **Destructive detection**: 18 keywords matched against selectors (delete, destroy, remove, logout, signout, payment, purchase, buy, checkout, confirm, archive, disable, deactivate, revoke, reset, drop, truncate, cancel subscription, unsubscribe)
3. **Destructive opt-in**: Destructive-looking clicks require BOTH `allow_destructive: true` at flow level AND `destructive: true` at step level
4. **Secret field detection**: Fields matching password/token/secret require `secret: true` at step level
5. **No implicit form submission**: Forms are never submitted automatically
6. **External URL blocking**: External URLs require `allow_external: true`

Blocked actions produce `LENS-FLOW-NNN` findings with warning severity.

### Flow Artifacts

```
<out-dir>/
├── lens-report.md          # Flow-specific markdown report
├── lens-report.json        # Flow-specific JSON report
├── metadata.json
├── flow.json               # Parsed flow definition
├── flow-steps.json         # Per-step results with status
├── console.json
├── network.json
├── dom-summary.json
└── screenshots/
```

### Flow Findings

Blocked, failed, and errored steps produce `LENS-FLOW-001`, `LENS-FLOW-002`, etc. findings with severity based on status:
- `blocked` → warning
- `fail` → error
- `error` → critical

### Known Limitations

1. Default flow mode is read-only; interactive steps require `--execute`
2. Recording can film rendered page content; review `walkthrough.html` before
   sharing sensitive screens
3. Safety keyword list is not configurable per-project
4. Flow execution is intentionally declarative; Lens does not infer or repair
   steps with AI/LLM logic

## Visual Regression (Phase 9)

Lens supports deterministic screenshot diffing against stored baselines.

### What Visual Regression Does

- Saves current screenshots as visual baselines with `--baseline`
- Compares new screenshots against baselines with `--compare-baseline`
- Generates pixel-level diff images highlighting changed regions
- Produces `LENS-VISUAL-NNN` findings when visual differences exceed threshold

### What Visual Regression Does NOT Do

- Does not use AI/LLM for visual analysis
- Does not make subjective design judgments
- Does not automatically approve or reject visual changes
- Does not compare screenshots across different viewport dimensions

### Creating Baselines

```bash
# Save current screenshots as baselines
lens check http://localhost:3000 --baseline

# Save to custom directory
lens check http://localhost:3000 --baseline --baseline-dir ./.lens/baselines

# Overwrite existing baselines
lens check http://localhost:3000 --baseline --update-baseline
```

Baselines are stored at `.lens/baselines/check/<sanitized-url>/` with:
- `desktop.png`, `mobile.png` — baseline screenshots
- `baseline-metadata.json` — creation timestamp, tool version, URL

### Comparing Against Baselines

```bash
# Compare current screenshots against baselines
lens check http://localhost:3000 --compare-baseline

# With custom threshold (default: 0.01 = 1%)
lens check http://localhost:3000 --compare-baseline --diff-threshold 0.05

# With custom baseline directory
lens check http://localhost:3000 --compare-baseline --baseline-dir ./.lens/my-baselines
```

### Visual Findings

| Status | Severity | When |
|--------|----------|------|
| `fail` | error | Pixel difference exceeds threshold |
| `missing_baseline` | warning | No baseline exists for comparison |
| `dimension_mismatch` | error | Current and baseline dimensions differ |
| `pass` | info | Screenshots match within threshold |

### Diff Artifacts

When `--compare-baseline` is used, the run directory includes:

```
<out-dir>/
├── visual-diffs.json           # Per-viewport comparison results
└── diffs/
    ├── desktop.diff.png         # Red-highlighted changed pixels
    ├── desktop.current.png      # Current screenshot copy
    └── desktop.baseline.png     # Baseline copy
```

### Updating Baselines

Intentional visual changes require explicit baseline updates:

```bash
# Update baselines after intentional changes
lens check http://localhost:3000 --baseline --update-baseline
```

Without `--update-baseline`, existing baselines are never overwritten.

### Known Limitations

- Requires Python Pillow + numpy (`pip install Pillow numpy`)
- Pixel comparison uses a fixed per-channel threshold (sub-pixel anti-aliasing may trigger small differences; tune with `--diff-threshold`)
- Binary PNG copying uses the system `cp` command (requires a Unix environment); `read_file`/`write_file` are UTF-8 only and cannot copy binary data safely
- Baselines are never overwritten without `--update-baseline`
- `--diff-threshold` float parsing limited by Kujo runtime `to_number` support
- No flow-mode visual integration yet

## Accessibility Checks (Phase 10)

Lens supports automated accessibility checks via `--accessibility` (or `--a11y`).

### What Accessibility Checks Do

- Inject and run **axe-core** (bundled in the bridge) against each viewport
- Detect violations like missing alt text, color contrast issues, missing labels
- Produce `LENS-A11Y-NNN` findings with severity based on impact level
- Generate `accessibility.json` with structured, privacy-safe violation data
  (rule id, impact, description, help URL, affected-node count, and CSS-selector
  targets — never rendered node HTML, which could contain secrets)
- Degrade honestly: if axe-core is not installed or injection fails, the check
  is reported as **skipped** with a clear note — never as a clean pass

### What Accessibility Checks Do NOT Do

- Do not replace manual accessibility review
- Do not claim WCAG compliance or certification
- Do not test with screen readers or assistive technology
- Do not provide AI-based accessibility judgment
- Do not guarantee full accessibility

### Basic Usage

```bash
# Run accessibility checks
lens check http://localhost:3000 --accessibility

# Short alias
lens check http://localhost:3000 --a11y

# Filter by rule tags
lens check http://localhost:3000 --a11y --a11y-tags wcag2a,wcag2aa

# Scope to specific area
lens check http://localhost:3000 --a11y --a11y-include main

# Exclude third-party content
lens check http://localhost:3000 --a11y --a11y-exclude "[data-testid='widget']"

# With eval output
lens check http://localhost:3000 --a11y --eval-out ./eval/a11y-results.json
```

### Severity Mapping

| axe-core Impact | Lens Severity |
|----------------|---------------|
| critical | error |
| serious | error |
| moderate | warning |
| minor | info |

### Artifacts

When enabled:
```
<out-dir>/
└── accessibility.json    # Per-viewport scan results with violations
```

### Known Limitations

- Requires axe-core in the bridge (`cd bridge && npm install`); when absent, the
  check is reported as skipped rather than producing misleading results
- Automated checks cannot detect all accessibility issues
- Manual review and screen reader testing are still essential
- Multi-tag comma parsing uses Kujo `index_of`/`substring` (functional but simpler than JS split)

## Roadmap

Lens now includes the original foundation items: config files, custom
viewports, performance metrics, bounded crawl, HTML reports, RunLedger/Howl
outputs, accessibility checks, multi-browser selection, flow execution, and
walkthrough proof artifacts.

For the next enterprise-readiness pass, see the new
[**Enterprise Readiness Next Session**](enterprise-readiness-next-session.md)
worklist. The older [Enhancement Checklist](enhancements.md) remains as
historical implementation context.

## Version

Lens v1.0.1 — browser checks, same-origin link checking, Spec/Eval integration,
safe executable flows, visual baselines/diffing, axe-core accessibility
scanning, performance evidence, bounded crawl, HTML reports, and centralized
secret redaction across artifacts, reports, and verbose bridge logs.
