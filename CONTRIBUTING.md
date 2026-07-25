# Contributing

Thanks for helping improve this Kujo ecosystem project.

This guide is intended for standalone Kujo tools and primitives. It does not
cover the core Kujo language repo, Kujo Skills, or Kujo Workflows when those
projects have their own contribution rules.

## Development Principles

- Keep changes focused, reviewable, and tied to one user-visible concern.
- Prefer deterministic, local-first behavior.
- Do not add network calls, provider calls, timestamps, or machine-specific
  output to core command paths unless the feature explicitly requires it.
- Preserve redaction, path safety, guarded cleanup, and stable output ordering.
- Add tests for behavior changes. Bug fixes should include regression coverage.
- Avoid speculative refactors unless they directly simplify the change at hand.

For Lens specifically, preserve these invariants on every change:

- No AI or LLM in the check path.
- Localhost-only by default; external URLs require `--allow-external`.
- No unredacted secrets in artifacts or reports.
- Deterministic output for the same input.
- No state mutation outside explicit, opted-in flow execution.

## Local Setup

Install Kujo so the `kujo` command is available on your `PATH`:

```bash
kujo --version
```

See `docs/getting-started.md` for the full walkthrough. In short:

```bash
kujo --version
cd /path/to/lens/bridge && npm install && npx playwright install chromium
cd /path/to/lens && ./lens --version
```

Check the repo README, `Makefile`, `tests/`, and `scripts/` directory for the
authoritative local commands.

## Agent And Example Hygiene

Start with `README.md`, `CONTRIBUTING.md`, relevant docs, and examples before
broad source sweeps.

Treat user-facing examples as canonical copyable surfaces. Examples should be
short, runnable, and representative of the idioms humans and agents should copy.

For Lens, start with `README.md`, this file, `docs/getting-started.md`, and
`examples/README.md` before broad source sweeps. Treat `README.md`,
`docs/getting-started.md`, `docs/flow-authoring.md`, and `examples/` as
canonical copyable surfaces.

Keep placeholder, opt-in external, generated, or legacy material clearly labeled
where it lives. Do not silently copy those patterns into quick starts.

Exclude generated and bulk paths from broad searches unless the task explicitly
targets them. A good Lens default is `.git`, `bridge/node_modules`,
`docs/assets`, `.lens`, and other generated run directories.

```bash
rg "pattern" README.md CONTRIBUTING.md docs examples src tests bridge \
  -g '!.git/**' \
  -g '!bridge/node_modules/**' \
  -g '!docs/assets/**' \
  -g '!.lens/**'
```

Document any important search exclusions in larger cleanup or audit PRs.

## Code Standards

- Match the surrounding code style before introducing a new abstraction.
- Keep command output readable and stable.
- Prefer small local helpers for repeated output, error, section, or key/value
  formatting once repetition distracts from the behavior.
- Keep CLI contracts explicit: flags, exit codes, JSON fields, artifact paths,
  and documented examples should agree with parser behavior.
- Keep config honest. A config key should either change observable behavior or
  be clearly documented as reserved.
- Preserve compatibility entrypoints and wrappers when a repo provides them.
- In Kujo source, use `mut` only where reassigned, guard dictionary access, and
  keep functions small and named by intent.

## Kujo Runtime Notes

Kujo ecosystem tools often follow these defensive patterns:

- Prefer `while` loops in complex functions.
- Avoid duplicate local names across branches in the same function.
- Keep imports at the top of the file.
- Export functions that are imported by another module.
- Guard dictionary access with `has_key()` or local helper wrappers.
- Remember that some builtins return int-like `1`/`0` instead of booleans.
- Guard parsing operations such as JSON or TOML parsing and validate the result.
- Keep deep tree walks iterative where recursion risks VM stack limits.
- Be careful with byte-based string indexes versus character-based substring
  operations; use existing repo helpers when available.

See the Kujo language gotchas referenced in `docs/reference.md` for Lens-specific
runtime notes.

## Validation

Before opening a pull request, run the strongest local validation available for
the repo.

Lens changes should follow this verification gauntlet:

The full per-step detail lives in `docs/enhancements.md`.

1. Record the current test count before implementation.
2. Branch from `main`.
3. Implement the change.
4. Add tests. Behavior changes raise the test count in `tests/lens_tests.kujo`
   with happy path, failure or edge coverage, and any new redaction surface.
5. Run the full suite; for tested behavior changes, the count should go up:
   `kujo run tests/lens_tests.kujo` should report `0 failed`.
6. If `bridge/*.js` changed, run `node --check bridge/browser-bridge.js`.
7. For performance-sensitive changes, compare `scripts/bench.sh` medians against
   the pre-change build and document the delta.
8. If capture, storage, or report surfaces change, prove no secret leaks with a
   secret-bearing URL or flow data and add redaction coverage.
9. Run the real CLI end to end and read the generated report.

Tests should stay offline and deterministic unless the repo explicitly marks a
live-provider or network test as opt-in.

## Documentation And Changelog

Update docs when behavior, configuration, command output, flags, schemas,
examples, or security expectations change.

For Lens, check:

- `README.md`
- `docs/getting-started.md`
- `docs/reference.md`
- `docs/flow-authoring.md`
- `examples/`
- `src/config.kujo` help text
- `kennel.toml`
- version strings in source and help output
- `CHANGELOG.md`

User-visible behavior changes should include a changelog entry when the repo has
a changelog.

## Pull Requests

A good PR includes:

- Problem statement.
- Change summary.
- User-visible impact.
- Test evidence with commands and outcomes.
- Documentation or changelog updates.
- Known risks or follow-up work, if any.

Keep generated artifacts out of commits unless the artifact is the reviewed
output of the change.

Commit with a conventional message prefix such as `feat:`, `fix:`, `perf:`,
`docs:`, `chore:`, or `test:`.
