# Security Policy

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue.
Email **me@robertdevore.com** with details and reproduction steps. You'll get an
acknowledgement within a few business days.

## Lens's security model

Lens is built local-first and evidence-based, with a deliberately small attack
surface. Key guarantees:

- **Localhost-only by default.** Only `localhost` / `127.0.0.1` / `::1` are
  allowed; any other host requires the explicit `--allow-external` flag.
- **Observe, don't mutate.** Outside an explicit, opted-in `--execute` flow,
  Lens never clicks, types, submits forms, or logs in. Flow execution is gated
  by a safety model (clicks need `safe: true`, destructive targets need
  explicit opt-in, secret fields need `secret: true`).
- **Centralized secret redaction.** Bearer tokens, JWTs, basic-auth
  credentials, sensitive query parameters, and `key=value` secrets are redacted
  from **every** artifact and report (`src/redact.kujo`), applied at capture, at
  finding construction, and as a final sweep.
- **Never stored at all:** request/response bodies, cookies, and auth headers.
  The network capture is a strict whitelist.
- **Typed-input safety.** Values typed in a flow (e.g. credentials) are redacted
  to `[REDACTED]` in `flow.json`; the internal program handoff is deleted
  immediately after the bridge consumes it. The `--auth-file` storage state is
  passed to Playwright by path and never read, logged, or written by Lens.

## Caveats to be aware of

- **Recordings can film on-screen content.** With `--record`, a video may show
  whatever the page renders. Password fields render masked, but review
  recordings before sharing them externally.
- **`--allow-external` and `--auth-file` are powerful.** Only point Lens at
  hosts and credentials you control.

## Scope

Lens is **not** a security scanner — it does not check CSP, cookie security,
HTTPS configuration, or XSS. Reports of "Lens doesn't detect <web vuln>" are out
of scope; reports of Lens itself leaking secrets, escaping localhost, or
executing unintended actions are in scope and very welcome.
