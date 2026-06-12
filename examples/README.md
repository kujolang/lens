# Lens examples

Runnable sample inputs. Point them at any local dev server and swap only the
ports, paths, and selectors that belong to your app.

Prioritize copyable examples over tests: examples should model the most
token-efficient idioms we want agents to imitate.

## Canonical copyable examples

| File | Use with | Notes |
|------|----------|-------|
| [`.lens.toml`](.lens.toml) | `lens check <url>` | Project defaults to copy to your repo root. |
| [`specs/dashboard.json`](specs/dashboard.json) | `lens check <url> --spec examples/specs/dashboard.json` | Small Spec file for deterministic assertions. |
| [`flows/dashboard.json`](flows/dashboard.json) | `lens flow examples/flows/dashboard.json` | Read-only smoke flow. |
| [`flows/login.json`](flows/login.json) | `lens flow examples/flows/login.json --execute --record --walkthrough` | Interactive walkthrough; the password field is marked secret. |

## Templates and demos

| File | Label | Notes |
|------|-------|-------|
| [`flows/account-modal.json`](flows/account-modal.json) | Placeholder template | Replace selectors with `lens inspect <url>` output before executing. |
| [`flows/site-journey.json`](flows/site-journey.json) | Opt-in external demo | Uses `allow_external: true`; keep that explicit when adapting it. |
| [`flow.schema.json`](flow.schema.json) | Schema/reference | Editor and lint support for flow files. |

## Try it against a throwaway server

```bash
python3 -m http.server 3000 --bind 127.0.0.1 &
lens check http://127.0.0.1:3000 --html --accessibility
```

Expected terminal output:

```
Lens completed: PASS
Report: .lens/runs/<timestamp>/lens-report.md
```

The `flows/login.json` example uses a `secret: true` field — its typed value is
redacted to `[REDACTED]` in `flow.json` and omitted from the written artifacts.
