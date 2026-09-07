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
  finding construction, and as a final sweep. Nested accessibility scan data,
  including page-derived selector targets and engine errors, is swept too.
- **Never stored at all:** request/response bodies, cookies, and auth headers.
  The network capture is a strict whitelist.
- **Typed-input safety.** Values typed in a flow (e.g. credentials) are redacted
  to `[REDACTED]` in `flow.json`; the internal program is supplied through private, unlinked stdin storage. Lens reads `--auth-file` only to
  validate the Playwright storage-state envelope, then passes the path to the
  browser; contents and parse details are never logged or written by Lens.
- **Verbose logs are sanitized.** `--verbose` keeps diagnostic bridge-command
  output useful while redacting secret-bearing URLs and masking `--auth-file`
  paths.
- **CI inputs are data, not shell code.** The composite Action passes inputs via
  environment variables and tokenizes extra arguments without shell evaluation.
- **Write destinations are validated.** Lens refuses root/current-directory
  artifact targets, final-target symlinks, file/directory type mismatches,
  missing parents for direct files, and duplicate Eval/RunLedger/Howl paths.
  Parent-directory symlinks follow normal host filesystem semantics.
- **Bounded evidence and visuals.** Per viewport, Lens retains at most 1,000
  console messages, 2,000 failed network events, and 5,000 links. Custom
  viewports are capped at 4096×4096; recordings above 100 MiB are removed and
  reported as warnings.
- **Baseline identifiers are redacted.** Secret-bearing URLs and flow names are
  redacted before they become baseline directory names or metadata.

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

## Browser session lifetime

Unconfigured single checks use one-shot browsers. Crawl/watch and configuration-driven
checks use a session with a user-only Unix socket directory (0700; socket 0600)
and at most one browser process. The socket accepts observation jobs only; Kujo
continues to gate URLs and redact evidence. Contexts, cookies and storage are
never reused across captures. Requests and responses are bounded in memory,
not logged or persisted. Browser crashes are not replayed; later jobs may start
a replacement. Idle browsers close after 60 seconds; ordinary command termination
closes the host. No shared profile or cross-command daemon is installed.

Native recording decorations are enabled only for click actions using a fixed
label. Typing/navigation annotations are disabled. Known secret input values are
scrubbed from structured flow results and secret inputs are visually masked.
This does not remove other sensitive account content from rendered pixels.
