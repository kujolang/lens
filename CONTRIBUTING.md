# Contributing to Lens

Thanks for working on Lens. This file encodes the bar every change must clear —
human or agent. If you follow it, your PR will be easy to review and safe to
merge.

## Build & run

See [docs/getting-started.md](docs/getting-started.md) for the full walkthrough.
In short:

```bash
cd /path/to/kujo && cargo build          # produces the `kujo` binary
cd /path/to/lens/bridge && npm install && npx playwright install chromium
cd /path/to/lens && ./lens --version
```

## The verification gauntlet

No change is "done" until all of these pass. The full per-step detail (with
commands) lives in [docs/enhancements.md](docs/enhancements.md#-standing-verification-gauntlet-applies-to-every-task).
The short form:

1. **Baseline green** — record the current test count before you start.
2. **Branch** — never work on `main` (`git checkout -b <type>/<short-name>`).
3. **Implement** the change.
4. **Add tests** — every change raises the test count in `tests/lens_tests.kujo`
   (happy path + at least one failure/edge + any new redaction surface).
5. **Full suite passes**, count went up:
   `kujo run tests/lens_tests.kujo` → `0 failed`.
6. **Bridge syntax** (if `bridge/*.js` changed): `node --check bridge/browser-bridge.js`.
7. **Performance** — no silent regressions. Compare medians with
   `scripts/bench.sh` against the pre-change build; document the delta.
8. **Security & redaction** — if you capture/store/emit new data, prove no
   secret leaks (run with a `?token=…` URL and grep artifacts; extend
   `src/redact.kujo` + add a redaction test).
9. **Docs** — update `README.md`, `docs/getting-started.md`,
   `docs/reference.md`, and the `lens --help` text in `src/config.kujo` as
   applicable.
10. **Smoke** — run the real CLI end-to-end and read the report.
11. **Version + changelog** — bump `kennel.toml`, `LENS_VERSION` in
    `src/runner.kujo`, the `print_help`/`print_version` strings, and add a
    `CHANGELOG.md` entry.
12. **Commit** with a conventional message (`feat:`, `fix:`, `perf:`, `docs:`,
    `chore:`, `test:`).

## Invariants that must never regress

Re-confirm these on every change:

- **No AI/LLM** anywhere in the check path.
- **Localhost-only** by default; external URLs require `--allow-external`.
- **No unredacted secrets** in any artifact or report.
- **Deterministic output** — same input produces the same report.
- **No state mutation** — the browser never clicks/types/submits outside an
  explicit, opted-in flow step.

## Code style

Match the surrounding Kujo idioms: `mut` only where reassigned, guard dict
access with `has_key`, keep functions small and named by intent. See
[the Kujo language gotchas](docs/reference.md) referenced in the reference for
runtime quirks.
