# Authoring Flows — from a task description to a verified walkthrough

This guide turns a plain-English QA task ("open My Account, click the button
that opens the modal, toggle a setting, verify it advances") into a **Lens flow
JSON** that Lens runs and verifies **deterministically**. An AI agent does the
*translation*; Lens does the *verification* — no AI in the check path, so the
result is reproducible and trustworthy.

It's written so you can hand the whole file (plus a task) to an agent and get a
correct flow back. The [agent prompt](#copy-paste-agent-prompt) at the bottom is
ready to paste.

## The team workflow

```
task description
   │
   ├─ 1. lens inspect <url>        → real selectors + element inventory
   ├─ 2. agent writes flow.json    → using this guide + the inspect output
   ├─ 3. lens flow flow.json --validate   → structure/safety check, no browser
   └─ 4. lens flow flow.json --execute --record --walkthrough
                                   → runs it, records video, emits proof
```

Branch on the exit code: `0` = passed, `1` = a step failed (read
`flow-steps.json` / the walkthrough), `2` = bad input.

## 1. Discover real selectors: `lens inspect`

Guessing selectors is the main reason generated flows fail. Don't guess — ask
the page:

```bash
lens inspect http://localhost:3000/account
```

It loads the page read-only and lists every interactive element with a
**suggested selector**, its **kind**, and its visible **text**:

```
  [modal-trigger] "Open Preferences"  →  #open-preferences
  [button]        "Save Changes"      →  [data-testid=save-btn]
  [input:text]    "Email"             →  input[name="email"]
  [link]          "Billing"           →  a[href="/billing"]
```

Full JSON is saved to `elements.json`. Feed this to the agent so it uses real
selectors. (`--json` prints the array to stdout for piping.)

## 2. The flow file

A flow is JSON with top-level fields and an ordered `steps` array:

```json
{
  "name": "Short human label",
  "url": "http://localhost:3000/account",
  "viewports": ["desktop"],
  "timeout_seconds": 20,
  "allow_external": false,
  "allow_destructive": false,
  "steps": [ ... ]
}
```

| Field | Meaning |
|-------|---------|
| `name` | Label shown in reports / the walkthrough. |
| `url` | Starting URL. Localhost by default; public URLs need `allow_external: true` (or `--allow-external`). |
| `viewports` | `["desktop"]`, `["mobile"]`, or custom `["1280x800"]`. |
| `timeout_seconds` | Per-navigation timeout. |
| `allow_external` | Permit non-localhost URLs. |
| `allow_destructive` | Permit destructive-looking clicks (see [safety](#safety-rules)). |

### Step reference

Each step is a one-key object. Interactive steps run only with `--execute`.

| Step | JSON | Notes |
|------|------|-------|
| Visit | `{ "visit": "http://localhost:3000/x" }` | Navigates. |
| Click | `{ "click": { "selector": "#save", "safe": true } }` | **`safe: true` is required.** |
| Type | `{ "type": { "selector": "#email", "value": "me@x.com" } }` | Add `"secret": true` for passwords/tokens (value redacted everywhere). |
| Scroll | `{ "scroll": { "selector": "h2:has-text('Plans')" } }` | Or `{ "scroll": { "y": 1200 } }`. Smooth-scrolls into view. |
| Wait for selector | `{ "wait_for_selector": "[role=dialog]" }` | Waits until visible. |
| Wait for text | `{ "wait_for_text": "Saved" }` | Waits until the text appears. |
| Assert selector | `{ "assert_selector": "[role=dialog]" }` | Fails if absent. |
| Assert NOT selector | `{ "assert_not_selector": "[role=dialog]" }` | Fails if present (great for "modal closed"). |
| Assert text | `{ "assert_text": "Preferences saved" }` | Fails if body text lacks it. |
| Screenshot | `{ "screenshot": { "name": "after-save" } }` | Named capture. |
| Wait | `{ "wait": { "ms": 500 } }` | Static wait, max 10000. |
| No console errors | `{ "assert_no_console_errors": true }` | Checked against the run. |
| No failed requests | `{ "assert_no_failed_requests": true }` | Checked against the run. |

## 3. Selectors

Lens uses **Playwright selectors** (CSS + Playwright's text engine). Prefer, in
order:

1. **id** — `#open-preferences`
2. **test id** — `[data-testid=save-btn]`
3. **aria-label** — `[aria-label="Close"]`
4. **name / placeholder** (inputs) — `input[name="email"]`
5. **link href** — `a[href="/billing"]`
6. **text** — `button:has-text("Save")` or `text="Save"`

Useful patterns:
- **Scope to a modal:** `[role=dialog] button:has-text("Save")`
- **Substring href:** `a[href*="/plan"]`
- **First match wins** automatically when several elements match — no strict-mode errors.

## Safety rules

Lens enforces these even with `--execute` — author with them in mind:

- **Every `click` needs `safe: true`.** Without it the step is blocked.
- **Destructive-looking targets are blocked** (text/selector containing delete,
  remove, logout, cancel subscription, purchase, …) unless **both**
  `allow_destructive: true` (flow) **and** `"destructive": true` (step) are set.
- **Secret fields** (password/token/secret) in a `type` step need
  `"secret": true`; the value is redacted in every artifact.
- **Public URLs** need `allow_external: true` (or `--allow-external`).

## 4. Validate before running

```bash
lens flow flow.json --validate
```

No browser — checks every step's type, required fields, and safety gating, and
prints `ok` / `INVALID` / `BLOCKED` per step. Exit `0` = good to run. Let the
agent loop on this until clean.

## 5. Run and prove it

```bash
lens flow flow.json --execute --record --walkthrough --out runs/account
open runs/account/walkthrough.html
```

You get a recording (visible cursor + clicks, ending on the final screen), a
step-by-step PASS/FAIL timeline, the final URL in text, and a run fingerprint —
the shareable proof.

## Worked example

The "open page → modal → toggle setting → verify next screen" task, as a flow:
[`examples/flows/account-modal.json`](../examples/flows/account-modal.json).
Swap its placeholder selectors for the ones `lens inspect` gives you.

## For autonomous agents (the full loop)

A shell-capable agent can run the entire cycle unattended. The contract is
designed for it: every command has a stable **exit code** and a
**machine-readable** mode.

```
1. lens inspect <url> --json                 # → elements array on stdout
2. author flow.json                          # using this guide + the elements
3. lens flow flow.json --validate --json     # → { "valid": bool, "steps": [...] }
4. if not valid: fix the flagged steps, go to 3
5. lens flow flow.json --execute --record --walkthrough --out runs/<id>
6. read exit code + runs/<id>/flow-steps.json (JSON) to decide pass/fail
7. if a step failed: classify (below), fix, go to 3   # cap at ~3 iterations
```

**Exit codes** (branch on these, don't parse prose): `0` pass · `1` a
check/step failed · `2` invalid input (bad flow, blocked URL) · `3`
browser/runtime failure · `4` artifact-write failure.

**Failure taxonomy + recovery** (read `flow-steps.json`; each step has
`status` and `error`):

| Symptom | Likely cause | Recovery |
|---------|--------------|----------|
| step `fail`, error "Selector NOT found" | wrong/guessed selector | re-run `lens inspect`, pick the real selector |
| step `fail` on an `assert_*` | real bug **or** wrong expectation | inspect the screenshot; if the app is correct, fix the assertion; otherwise report the bug |
| step `blocked` | safety gate (missing `safe: true`, destructive, external) | add the required opt-in **only if the task intends it** |
| step `fail`, error "Timeout" | slow page / element not ready | add a `wait_for_selector` before it, or raise `timeout_seconds` |
| `bridge produced no output` (exit 3) | browser missing / very slow | `npx playwright install chromium`; ensure Node ≥ 18 |

**Guardrails for an agent:** cap iterations (≈3) and stop with a clear summary
rather than looping forever; never invent selectors — only use `inspect` output
or DOM evidence; never add `allow_destructive`/`destructive` or inject
credentials unless the task explicitly says so; treat a persistent assert
failure as a *finding to report*, not something to "make pass."

## Security (agents and teams)

- **Never put credentials in the flow JSON.** For logged-in journeys, use
  `--auth-file <path>` pointing at a Playwright storage-state file kept **out of
  git**; Lens hands it to the browser by path and never reads or logs it. Or log
  in via `type` steps with `"secret": true` (the value is redacted everywhere).
- **`type` secrets** (password/token fields) must set `"secret": true`.
- **Local-first.** Public URLs require `allow_external: true` (or
  `--allow-external`) — keep that explicit, per-flow.
- **Recordings can film on-screen content.** `--record` captures whatever
  renders; password fields show masked, but review a recording before sharing
  it externally. Omit `--record` for sensitive screens.
- **Destructive actions are opt-in twice** (`allow_destructive` + step
  `destructive`) — don't add them to "make a step pass."
- Redaction is centralized and applied to every artifact; see
  [Redaction & Privacy](reference.md#redaction--privacy).

## Determinism — write flows that don't flake

Lens is deterministic; keep your flows that way:

- **Synchronize on state, not time.** Prefer `wait_for_selector` /
  `wait_for_text` over `wait { ms }`. Use a fixed `wait` only as a last resort.
- **Use stable selectors** (id / `data-testid`) over text where possible; text
  changes with copy edits and locale.
- **Assert outcomes, not timing.** After an action, assert the *resulting* state
  (a confirmation, a closed modal) rather than assuming it happened.
- **Pin the viewport** for visual consistency (`"viewports": ["desktop"]`).
- **Same input → same report.** No randomness, no LLM in the check path.

## Extending Lens with a new step type

Adding a step keeps Lens modular — four touch-points, each small:

1. `src/flow.kujo` — add the key to `STEP_TYPES` and to `get_step_type`.
2. `src/flow_exec.kujo` — map it in `build_program_step` (what the bridge needs).
3. `bridge/flow-bridge.js` — implement it in `executeStep`.
4. `src/runner.kujo` — add its required-field check in
   `step_required_field_error` (so `--validate` covers it).

Then add a test in `tests/lens_tests.kujo` (Kujo side) and
`bridge/test/bridge.test.js` (bridge side), and document it here + in the
[reference](reference.md) and [`examples/flow.schema.json`](../examples/flow.schema.json).

## Running in CI / for a team

- **`lens flow <file> --validate`** needs no browser — run it on every PR to
  catch malformed/unsafe flows in seconds.
- **`lens flow <file> --execute`** runs in a browser job (Chromium via the
  bridge); upload the run dir as an artifact. See the reusable
  [GitHub Action](../action.yml).
- Flows are plain JSON validated by
  [`examples/flow.schema.json`](../examples/flow.schema.json) — wire it into your
  editor / a JSON-schema lint step so authors get inline validation.
- Branch CI on the exit code; the walkthrough artifact is your reviewable proof.

## Copy-paste agent prompt

Paste this to your agent, then add the task + the `lens inspect` output:

> You translate a QA task into a **Lens flow JSON** that Lens will execute and
> verify deterministically. Output **only** valid JSON for the flow — no prose.
>
> Rules:
> - Top-level: `name`, `url`, `viewports` (default `["desktop"]`),
>   `timeout_seconds` (default 20), `allow_external` (true only for non-localhost),
>   `allow_destructive` (default false), and `steps`.
> - Use only these step types: `visit`, `click` (always include `"safe": true`),
>   `type` (add `"secret": true` for passwords/tokens), `scroll`,
>   `wait_for_selector`, `wait_for_text`, `assert_selector`,
>   `assert_not_selector`, `assert_text`, `screenshot`,
>   `assert_no_console_errors`, `assert_no_failed_requests`.
> - Use the SELECTORS from the provided `lens inspect` output verbatim; do not
>   invent selectors. Prefer id → data-testid → aria-label → name → href → text.
>   Scope modal interactions with `[role=dialog] ...`.
> - After an action that should change the screen, add an assertion that proves
>   it (e.g. `wait_for_selector` for a modal, `assert_text` for a confirmation,
>   `assert_not_selector` for a closed modal). Add `screenshot` steps at key
>   moments and `assert_no_console_errors` at the end.
> - Never use destructive targets (delete/remove/logout/purchase/cancel) unless
>   the task explicitly asks; if it does, set `allow_destructive: true` and the
>   step's `"destructive": true`.
>
> TASK: «describe what to verify»
> INSPECT OUTPUT: «paste the elements.json or `lens inspect <url> --json` array»

A shell-capable agent should run the full loop itself: `lens inspect <url>
--json` → author → `lens flow flow.json --validate --json` (fix until
`"valid": true`) → `lens flow flow.json --execute --record --walkthrough` →
branch on the exit code and read `flow-steps.json`, iterating ≤3 times using the
[failure taxonomy](#for-autonomous-agents-the-full-loop). A chat-only model just
returns the JSON; you run the commands.
