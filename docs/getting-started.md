# Getting Started with Lens

A guided, copy-paste walkthrough from a clean machine to a passing run, your
first report, and the test suite. Should take about 10 minutes.

> Already comfortable? The [README](../README.md) has the 3-step quick start,
> and the [reference](reference.md) has every flag and detail.

---

## 1. Prerequisites

You need three things before installing Lens:

| Tool | Why | Check |
|------|-----|-------|
| [Kujo](https://github.com/kujolang/kujo) runtime | Lens is written in Kujo | `kujo --version` |
| Node.js ≥ 18 | Drives the headless browser | `node --version` |
| bash | The `lens` launcher is a bash script | `bash --version` |

If `node --version` prints something below 18, upgrade from
[nodejs.org](https://nodejs.org) before continuing.

## 2. Verify the Kujo runtime

Lens runs on Kujo, so install Kujo until the `kujo` command is available on
your `PATH`:

```bash
kujo --version
```

If your environment needs an explicit runtime override, set `KUJO_BIN=kujo`.

## 3. Install the browser bridge

Lens uses a small Node/Playwright bridge to drive Chromium. Install it and the
browser binary:

```bash
cd /path/to/lens/bridge
npm install                      # Playwright + axe-core
npx playwright install chromium  # the Chromium binary itself
```

Then make the launcher executable (one time):

```bash
cd /path/to/lens
chmod +x lens
```

Optionally, add Lens to your `PATH` so you can run `lens` from anywhere:

```bash
export PATH="/path/to/lens:$PATH"
```

## 4. Verify the install

```bash
./lens --version
# Lens v1.0.0

./lens --help
# Usage, flags, and examples
```

If you see a "Kujo binary not found" style error, point Lens at your build:

```bash
export KUJO_BIN="kujo"
./lens --version
```

## 5. Your first run

Lens is local-first, so let's check a real local server. Start a throwaway one
in a second terminal:

```bash
python3 -m http.server 3000 --bind 127.0.0.1
```

Then point Lens at it:

```bash
./lens check http://localhost:3000
```

You should see:

```
Lens completed: PASS
Report: .lens/runs/<timestamp>/lens-report.md
```

That's a full pass: the page loaded, rendered, and produced no console or
network errors.

> **Trying an external URL?** Lens blocks non-localhost addresses by default and
> exits with code 2. Add `--allow-external` to check a public URL on purpose.

## 6. Read the report

Every run writes a self-contained directory under `.lens/runs/<timestamp>/`:

```bash
ls .lens/runs/*/
# lens-report.md   lens-report.json   metadata.json
# console.json     network.json       dom-summary.json
# screenshots/desktop.png  screenshots/mobile.png
```

Open the human-readable report:

```bash
open .lens/runs/*/lens-report.md     # macOS  (use xdg-open on Linux)
```

The Markdown report is organized so you can scan top-to-bottom:

1. **Header & Summary** — pass/fail, finding counts, exit code, timing.
2. **Findings by severity** — Critical → Errors → Warnings, each with a stable
   ID (`LENS-CONSOLE-001`) and a suggested repair task.
3. **Agent Repair Brief** — a structured handoff: which artifacts to inspect
   first and an ordered first-pass repair strategy.

For tooling, `lens-report.json` carries the same data with a stable
`schema_version: 1`. To get a quick summary on stdout instead of opening files:

```bash
./lens check http://localhost:3000 --json
```

## 7. Common workflows

Once the basic run works, these are the next steps you'll reach for:

```bash
# Check same-origin links too (opt-in)
./lens check http://localhost:3000 --check-links

# Run automated accessibility checks (axe-core)
./lens check http://localhost:3000 --a11y

# Be stricter — fail on warnings, not just errors
./lens check http://localhost:3000 --fail-on warning

# Verify deterministic expectations from a Spec file
./lens check http://localhost:3000 --spec examples/specs/dashboard.json

# Save a visual baseline, then catch regressions later
./lens check http://localhost:3000 --baseline
./lens check http://localhost:3000 --compare-baseline

# Run a safe, declarative browser flow
./lens flow examples/flows/dashboard.json
```

Each of these has a dedicated section in the [reference](reference.md):
[link checking](reference.md#link-checking),
[accessibility](reference.md#accessibility-checks-phase-10),
[Spec integration](reference.md#spec-integration-phase-7),
[visual regression](reference.md#visual-regression-phase-9), and
[safe flows](reference.md#safe-browser-flows-phase-8).

## 8. Run the test suite

To confirm Lens itself is healthy (the full test suite passes, no browser needed):

```bash
kujo run tests/lens_tests.kujo
```

Expected:

```
=== Lens Test Results ===
Passed: 372
Failed: 0
Total:  372

All tests passed.
```

## 9. Wire it into your loop

Lens is built for the build-then-verify cycle. A typical agent or CI step is:

```bash
./lens check http://localhost:3000 --fail-on error --json
echo "exit code: $?"   # 0 = clean, 1 = findings, 2-4 = setup/runtime issue
```

Branch on the [exit code](reference.md#exit-codes): `0` means ship it, `1` means
read the Agent Repair Brief and fix what it points to.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Node.js is required for browser automation` | Install Node ≥ 18; verify with `node --version`. |
| `Browser provider failed` | `cd bridge && npm install && npx playwright install chromium`. |
| Kujo binary not found | `export KUJO_BIN=kujo`. |
| External URL blocked (exit 2) | Add `--allow-external` — this is a safety default. |
| Page load timeout | Confirm the server is running; raise `--timeout <seconds>`. |

The reference has a [fuller troubleshooting list](reference.md#troubleshooting).

## Where to go next

- [README](../README.md) — the quick tour and feature overview
- [Reference](reference.md) — every flag, the JSON schema, the safety model, and
  the redaction model
