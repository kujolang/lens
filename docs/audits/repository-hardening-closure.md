# Lens open-item closure — 2026-09-22

Repository: `kujolang/lens`. Branch: `codex/hardening-2026-09-22` → `main` through PR #5. Closure starting SHA: `e4e1ebfb3837961df232a660d66349547e9474a1`; original baseline: `fd388efd4f55f3f844cf7de4fc541abfd07a6785`. Implementation: `a61aabf`, CONNECT port-80 follow-up `18b826b`; CI: `2e9e7db`. Final commit/merge receipts are available in Git history; this document cannot contain its own SHA.

The [original audit](repository-hardening.md) records purpose, dependencies, inspected contracts and earlier verified changes. This pass resolves its admitted open items and distinguishes unsupported threat models from demonstrated bugs. No sibling repository was modified.

## Closure findings

| ID | Priority | Evidence and action | Status |
|---|---|---|---|
| L11 | P1 | Per-context proxy checks every HTTP request/CONNECT, including redirect hops, and pins localhost resolution to literal IPv4/IPv6 loopback. Page and worker WebSocket denial, resources, popups and navigation tested against a local disallowed sink with an opt-in positive control. | Closed for documented HTTP(S)/WebSocket scope |
| L12 | P2 | Whole strings above 16 KiB omitted; captured arrays bounded to 1 MiB; bridge results above 16 MiB fail explicitly. DOM/axe projections run before page-to-Node transfer, event arrays are bounded on insertion, omissions propagate to warnings/inspect exit 1. | Closed |
| L13 | Retracted | Original reproduction updated caller `fields` via bare assignment. Explicit `let fields` fixes both execution modes under documented Kujo semantics; a scoped-clone fixture now runs in the Lens suite. | No Kujo defect; no upstream change required |
| L14 | Measurement | Full original/current benchmark and interleaved controls retained below. | Measurement completed; no unsupported speedup claim |
| CI runtime | P2 | Pin tested Kujo commit; independently run immutable minimum-1.2.3 revision. All-engine destination checks added to existing CI. | Implemented |
| Output races | Needs evidence | Existing final-path/symlink validation retained. Invoking-user-owned output trees and separate directories for concurrent writers are documented requirements. No demonstrated in-scope exploit. | Closed as unsupported concurrent/local-adversary scenario, not a security fix |
| WebKit native proxy | Compatibility | macOS worker WebSockets bypass the HTTP proxy; attempted SOCKS alternative also failed. No partial enforcement shipped. | Restricted contexts fail before page creation; explicit external opt-in preserves trusted WebKit use |
| Firefox worker sockets | Upstream | Playwright 1.61.1 crashes in `FFPage._onWebSocketOpened` for a successful dedicated-worker WebSocket, reproduced without Lens. Page WebSockets succeed. | Existing upstream limitation; independently reproducible follow-up |

## Implementation and contracts

`bridge/network-policy.js` owns destination validation, streaming HTTP/CONNECT/WebSocket forwarding, bounded connections and context lifecycle. Shared context creation is used by capture/session, flow and inspect. Failed creation closes its listener; context/browser teardown destroys sockets. `localhost` uses only `::1` and `127.0.0.1`, preserving IPv6-only and IPv4-only applications without DNS rebinding. Independent candidate review reproduced the IPv6 compatibility issue; the corrected implementation and tests cover it.

`--allow-external` and flow `allow_external` retain their existing names and now control the entire browser context. Restricted contexts disable service workers. WebKit requires explicit opt-in because its native worker sockets cannot be confined reliably. This is an intentional fail-closed compatibility correction with an actionable error and migration path. Chromium/Firefox remain the restricted engines. Browser network admission is not an OS sandbox or WebRTC/UDP firewall; hostile-code isolation requires an external sandbox.

`bridge/evidence.js` bounds retained and projected evidence. Complete oversized values are replaced with a marker, never a credential prefix. Oversized link/selector entries are omitted rather than followed. Existing count limits remain. `evidence_limits` adds byte limits and `byte_limit_reached`; report schema version and existing fields remain. Checks/flows emit warnings; inspect persists its receipt and exits 1 for byte omissions. Inspect also now treats provider errors as exit 3 instead of silently returning success. Typed-value redaction and structured Kujo redaction remain in place. Browser/page heaps and raw protocol event buffers are outside these retained-evidence budgets.

No new package dependency, config name, environment variable or flag. No removed browser engine; WebKit now requires opt-in. Existing report filenames and exit-code meanings remain. Consumers must tolerate additive diagnostic fields and explicitly incomplete evidence warnings. No ecosystem-wide migration is required.

## Verification and evidence

All 12 remote CI jobs passed at `2e9e7db`: Node 18/20/22 × Ubuntu/macOS, pinned/minimum Kujo, Chromium/Firefox/WebKit, and full E2E. The [receipt](evidence/2026-09-22-closure/ci-verification.json) records that run. The final branch head must also pass its PR checks before merging; GitHub retains those results on [PR #5](https://github.com/kujolang/lens/pull/5).

Exact local commands are below; full logs remain in ignored `.lens/closure-2026-09-22/`.

| Command | Result |
|---|---|
| `../kujo/target/release/kujo run tests/lens_tests.kujo` | 523 assertions pass |
| `npm test --prefix bridge` | 58 tests pass, real Chromium enabled |
| `LENS_POLICY_ENGINES=chromium,firefox,webkit node --test bridge/test/network-policy.test.js` | Eight tests pass: denied destinations, opt-in control, page sockets, Chromium worker sockets, IPv4/IPv6 localhost and CONNECT controls |
| `KUJO_BIN="$PWD/../kujo/target/release/kujo" python3 scripts/runtime-e2e.py` | 16 groups pass, including actual check/flow/inspect redirect failures, opt-in and oversized Unicode receipts |
| `python3 scripts/test-visual-diff.py` | Two tests pass |
| `python3 scripts/test-benchmark-harness.py` | Four checks pass |
| `../kujo/target/release/kujo check lens.kujo` / `lint lens.kujo` | Pass |
| `node --check` for every `bridge/*.js`; Python `ast.parse` for tracked Python; `bash -n lens scripts/bench.sh` | Pass |
| `npm audit --omit=dev --json --prefix bridge` | Zero known advisories; two production dependencies |
| `git diff --check` | Pass |

The initial proxy-only WebKit tests failed on page/worker WebSockets; those failed experiments were removed. WebKit's shipped test asserts rejection before page creation plus successful opted-in navigation. The independent Firefox successful-worker control failed without Lens; its [source](evidence/2026-09-22-closure/firefox-ws-control.cjs) and [output](evidence/2026-09-22-closure/firefox-ws-control.log) remain visible rather than marking the crash as a passing Lens capability. Run it from the repository with `node docs/audits/evidence/2026-09-22-closure/firefox-ws-control.cjs` after installing Firefox. Denied Firefox worker sockets remain part of the boundary regression suite.

## Performance and efficiency

Existing verified gains remain: visual peak RSS 372,084,736 → 295,497,728 bytes on the fixed 2048×2048 fixture; axe projection 3,035,880 → 247 bytes on the fixed 500-node fixture. No token reduction is claimed; Lens has no model-call pipeline. Detailed evidence stays in files while normal command output remains concise.

Complete benchmark command: `LENS_BENCH_TARGET_ROOT="$PWD/.lens/audit-2026-09-22/baseline-tree" KUJO_BIN="$PWD/../kujo/target/release/kujo" scripts/bench.sh 3 "$PWD/.lens/closure-2026-09-22/before.json"`, then the same command without `LENS_BENCH_TARGET_ROOT` using `after.json`. [Before](evidence/2026-09-22-closure/before.json) and [after](evidence/2026-09-22-closure/after.json) retain all ten medians. The first full final run encountered renewed host load, so it is not used to claim causal regression or improvement.

Three original/current samples interleaved in alternating order on the same local fixture server then measured realistic, many-links and SPA CLI paths. Raw durations and host load: [paired-runtime.json](evidence/2026-09-22-closure/paired-runtime.json). These expose real hardening overhead and are not a speedup claim. The final implementation keeps the verified behavior rather than claiming an unsupported speedup:

| CLI fixture | Original median | Hardened median | Observed added time |
|---|---:|---:|---:|
| Realistic | 3.744 s | 4.737 s | 0.993 s |
| Many-links, quick | 2.937 s | 4.015 s | 1.078 s |
| SPA, quick | 2.992 s | 3.793 s | 0.801 s |

These comparisons include all hardening since the original SHA, not just the
proxy. Stronger structured privacy and destination checks have a measurable
cost; latency non-regression is **not** claimed. A scalar-frame/regex-marker
micro-optimization was tested and discarded after it failed to demonstrate an
improvement (200 redactions: original median 26.041 s, experiment 33.006 s with
renewed host load). No benchmark assertion was weakened, timeout increased,
safety check removed, or speculative optimization retained. The tiny subsequent
CONNECT port-80 correction does not change these random-port benchmark paths.

## Remaining work and cross-repository scope

- P0: none established.
- P1: none remaining within the documented Lens boundary.
- P2 upstream: successful dedicated-worker WebSockets crash Playwright Firefox 1.61.1 on this macOS host; recheck a future upstream browser/package release against the standalone control before expanding the support claim. This does not require another Kujo repository to change.
- WebKit: trusted opt-in is the supported migration path. Restricted WebKit would require upstream enforcement or a separately designed OS sandbox; no bypass is accepted silently.
- Needs more evidence: no open speculative code-change request. Timing observations remain fixture/host-specific rather than universal performance guarantees.
- Not worth changing: established public formats/wrappers, optional dependencies and documented parent-symlink semantics.

## Durable records

Strata lesson `b7ab92c3-320a-4362-b5fc-ae65df3dc69b` now carries the dated Kujo scoping correction while preserving the original claim's provenance. Session note `65bb7743-4162-4dac-890c-14a3a5ea8dd5` is the merge handoff/current-state record. Final merge SHA and final-head CI results are consolidated there after merge.

SignalBox closed the original destination Signal `sig_4fa560d5-7410-4757-b5e6-07ab91f10d9c` as implemented and the misclassified Kujo Signal `sig_cd737663-1eb7-4713-9442-951143c10c3c` as rejected. Existing captures remain historical; no completed-work or disposition captures were added. The only newly admitted unresolved finding is the Lens-independent Firefox worker-socket crash: Capture `cap_0e7a79d9-4352-491c-bca4-3ff86a727cbe`, Signal `sig_e9b242ab-0e7d-4e85-b65b-9142f63bfcfe`. Exact-ID and Firefox/WebSocket concept retrieval succeeded for both. Duplicate captures skipped: zero; completed fixes, routine results, handoff and speculative output-race claims were rejected as new-capture candidates.
