# Lens examples

Runnable sample inputs. Point them at any local dev server (swap the ports/paths
for your app).

| File | Used with |
|------|-----------|
| [`.lens.toml`](.lens.toml) | Project defaults — copy to your repo root, then just run `lens check <url>`. |
| [`specs/dashboard.json`](specs/dashboard.json) | `lens check <url> --spec examples/specs/dashboard.json` |
| [`flows/dashboard.json`](flows/dashboard.json) | `lens flow examples/flows/dashboard.json` (read-only) |
| [`flows/login.json`](flows/login.json) | `lens flow examples/flows/login.json --execute --record --walkthrough` |

## Try it against a throwaway server

```bash
python3 -m http.server 3000 --bind 127.0.0.1 &
lens check http://127.0.0.1:3000 --html --accessibility
```

The `flows/login.json` example uses a `secret: true` field — its typed value is
redacted to `[REDACTED]` in `flow.json` and omitted from the written artifacts.
