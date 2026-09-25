# Lens repository hardening — 2026-09-25

## Scope and baseline

- Repository: `kujolang/lens`, branch `main`; clean starting revision
  `bd59d8efa8334d62954ded043f3758fce222d6ec`.
- Reviewed the CLI/configuration pipeline, all Kujo source modules, Node and
  Python bridges, tests, workflows, packaging, release/readiness documents,
  security policy, dependency lockfile, artifact formats, subprocess and
  browser boundaries. Sibling repositories were read only where needed to
  verify Kujo runtime behavior.
- Host: macOS x86_64; Kujo 1.5.0, Node 26.7.0, npm 11.19.0, Python 3.10.5,
  Lens 1.1.0.
- Before edits: 523 Kujo assertions, 58 Node bridge tests, 16 runtime E2E
  groups, 2 visual tests, and 4 benchmark-harness tests passed. Kujo check and
  lint, JavaScript/Python/shell syntax checks, and `git diff --check` passed.
  `npm audit --omit=dev` reported zero known advisories.

The audit preserved CLI flags, defaults, exit codes, report schemas, artifact
names, browser/provider contracts, flow formats, configuration precedence, and
package interfaces. Security corrections intentionally reject inputs that
could escape an artifact root or exceed documented resource bounds.

## Findings and disposition

| ID | Priority | Finding | Evidence | Disposition |
|---|---:|---|---|---|
| H25-01 | P1 | Existing symlinks below a valid output or baseline root redirected browser, Python, or copy writes outside the selected artifact tree; default output roots were resolved after the original validation. | `src/runner.kujo`, `src/validate.kujo`, `src/provider.kujo`, `src/visual.kujo`, `src/crawl.kujo` | Fixed: validate effective roots and recursively reject existing descendant symlinks with depth/entry bounds. Same-user concurrent replacement remains outside the documented threat model. |
| H25-02 | P1 | Flow JSON accepted arbitrary viewport names; the browser used the name as a PNG path component, allowing `../` traversal without `--execute`. | `src/flow.kujo`, `src/provider.kujo`, `bridge/browser-bridge.js` | Fixed at both the flow parser and browser bridge; regression tests cover traversal and oversized tokens. |
| H25-03 | P1 | Link checking admitted only the initial same-origin URL, then used redirect-following `http_get`, bypassing the per-hop browser destination policy. | `src/checks.kujo`; verified against Kujo's HTTP client implementation | Fixed with `http_request`, redirects disabled, DNS pinning, and an E2E loopback-to-disallowed redirect sentinel. A 3xx remains a successful reachable-link result. |
| H25-04 | P2 | Up to 500 sequential link requests each inherited a 30-second runtime timeout, permitting multi-hour opt-in checks. | `src/checks.kujo`, `src/config.kujo` | Fixed with two-second per-link requests and an aggregate deadline derived from the configured run timeout; exhaustion is an observable warning. |
| H25-05 | P2 | Config, flow, Spec, auth-state, and existing ledger files were read whole without byte ceilings. | `src/config_file.kujo`, `src/flow.kujo`, `src/spec.kujo`, `src/validate.kujo`, `src/integrations.kujo` | Fixed with regular-file/symlink checks and 1 MiB or 8 MiB limits at or below Kujo's runtime read ceiling. Ledger newline-repair compatibility is preserved. |
| H25-06 | P2 | Crawl/link destructive-path filtering covered fewer state-changing terms than interactive flow safety, and authenticated GET navigation could mutate a misdesigned application through an innocuous-looking route. | `src/checks.kujo`, `src/flow.kujo`, `src/runner.kujo` | Fixed by extending conservative path filtering and refusing authenticated crawl unless the caller supplies the CLI-only `--allow-authenticated-crawl` high-trust opt-in. |
| H25-07 | P2 | `kujo.toml` claimed Kujo 0.1.0 while packaging and active documentation required 1.2.3. | `kujo.toml`, `kennel.toml`, runtime documentation | Fixed with one authoritative 1.2.3 floor and a manifest-consistency regression test. |

No confirmed P0 issue was found. Browser contexts still isolate pages and auth
state, loopback policy covers redirects/subresources/workers/WebSockets for
restricted Chromium/Firefox, flow mutation remains explicit, subprocesses use
argument arrays, and textual evidence is bounded and redacted. Screenshots and
recordings can contain rendered private content as documented.

## Performance and dependency evidence

The repository's representative benchmark was run for three iterations before
and after the changes. Values are medians in seconds; lower is better.

| Scenario | Before | After |
|---|---:|---:|
| bridge trivial | 2.0958 | 2.2638 |
| bridge realistic | 2.4460 | 2.3964 |
| CLI trivial | 4.7171 | 3.1623 |
| CLI realistic | 4.7162 | 3.4521 |
| quick trivial | 4.0480 | 2.6464 |
| quick realistic | 3.8745 | 2.9185 |
| quick SPA | 3.3325 | 2.6790 |
| quick image-heavy | 3.9298 | 3.0015 |
| quick late-network | 3.8442 | 4.0217 |
| quick many-links | 2.6662 | 3.5797 |

The mixed movement on an interactive host does not establish either a speedup
or a regression. No timeout or performance threshold was loosened. The new
tree walk is bounded and occurs once per selected existing artifact root;
link checks now have a strict wall-clock ceiling.

Production dependencies remain pinned. `axe-core` 4.11.4 and
`playwright-core` 1.61.1 had no known npm advisories; newer releases (4.13.0
and 1.63.0 respectively) were not adopted without the full remote browser/OS
matrix required for a safe Playwright upgrade. No dependency or tool-schema
churn was introduced.

## Verification and compatibility

Final verification covers Kujo compile/lint, 532 Kujo assertions, all 58 Node
bridge tests with real Chromium, 18 runtime E2E scenario groups, 2 visual-diff
tests, 4 benchmark-harness tests, JavaScript/Python/shell syntax, npm advisory
audit, and whitespace checks. The E2E suite proves that link redirects are not
followed and that existing check, inspect, crawl, baseline, interactive flow,
recording, auth-isolation, redaction, and watch behavior remains operational.

The only intentional compatibility tightening is rejection of unsafe viewport
tokens, symlinked internal artifact trees, symlinked structured-input files,
and oversized structured inputs. Ordinary repeated `--out`, explicit baseline
updates, absolute host-ancestor symlink semantics, and existing report consumers
are unchanged. Workspace-relative ancestor symlinks are intentionally rejected.
No sibling repository change is required.

## Remaining boundaries

- Local concurrent mutation by another process using the same account remains
  unsupported; robust adversarial race resistance would require descriptor-
  relative no-follow writes in the Kujo runtime and foreign bridges.
- Artifact-tree validation rejects more than 10,000 entries, but Kujo 1.2.3's
  `list_dir` materializes each directory before Lens can apply that ceiling;
  paged enumeration requires a newer runtime contract.
- CI's complete OS/Node/browser-engine matrix was not reproduced locally.
- Dependency upgrades remain a release-matrix task, not an audit shortcut.
- Wall-clock benchmark deltas are recorded as observations only.
