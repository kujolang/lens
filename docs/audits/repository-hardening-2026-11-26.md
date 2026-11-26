# Lens repository hardening, November 26, 2026

Audited public `kujolang/lens` on `main` from `20071d8e30220d5ddbb8c548a1f3be25695a821f` through code commit `cf78a47`. Lens captures deterministic browser evidence through a Kujo CLI and a pinned Playwright bridge.

| Priority | Finding and correction |
|---|---|
| P0 | The installed launcher inherited project module resolution and started browser and visual helpers relative to the calling project. It now isolates Kujo imports, strips inherited module and script-argument controls, resolves helpers from the installation, and preserves caller-relative configuration and outputs. Kujo 1.4.0 is the first release with import isolation. The launcher rejects older versions before running Lens code. |
| P0 | The bridge reopened authentication state by path and read private flow inputs without an independent bound. It now reads bounded regular-file snapshots and passes the validated state to Playwright. Flow input remains private and bounded at 8 MiB. Errors omit private input details. |
| P1 | The evidence projection enforced its byte cap on arrays and repeatedly serialized nested values. It now accounts for encoded bytes in arrays and dictionaries as it walks them. It preserves complete collection entries, reports omissions, and measures UTF-8 and JSON escapes. |
| P1 | The private browser session accepted unbounded numbers of idle sockets and repeatedly measured its partial request. It now accepts up to 32 concurrent connections and buffers at most 1 MiB per request. External opt-in contexts observe the same creation deadline and late-context cleanup as restricted contexts. |
| P1 | Visual baseline comparison read unbounded identity metadata. It now checks regular-file type, a 1 MiB limit and the JSON object shape before comparing identities. Legacy baselines without metadata still work. CI checkouts no longer preserve credentials. |

## Coverage

- Reviewed the launcher, CLI configuration, browser and inspection bridge, flow gates, evidence and artifact pipelines, input containment, browser session and cleanup, networking, recording and visual comparison, accessibility, release checks, pinned dependencies and documentation.
- Public command names and evidence schema remain stable. The managed Kennel launcher can find its helpers through the installed package root. Direct development commands require a trusted Lens checkout. The minimum runtime advances to Kujo 1.4.0.
- The default browser policy remains loopback-only with isolated contexts. Browser opt-in behavior, flows, model context and output shape were checked with controlled fixtures. Model token consumption was outside the benchmark workload.
- Existing historical reference images and benchmark receipts remain release evidence. Production bridge dependencies and pinned browser revision are unchanged. No release was published.

## Verification

- Baseline passed 549 Kujo unit checks on published 1.2.3 and the 1.10.0 development build, 59 bridge tests, 21 real CLI Chromium cases and two visual comparison tests.
- Final `kujo run tests/lens_tests.kujo` passed 551 checks on checksum-verified Kujo 1.4.0 and the local 1.10.0 development build. A separate project verified that the launcher keeps outputs local while locating its installed bridge. An explicit 1.2.3 probe failed before execution with the documented minimum-runtime error.
- Real Chromium Headless Shell 149 exercised 22 CLI cases, including browse and inspect, authentication, guarded flow execution, capture and redaction, visual comparisons, and caller-relative output. The visual comparison and benchmark-harness checks passed. `npm audit --prefix bridge` reported zero advisories.
- In 17 alternating samples on Node 24.22.1, one nested projection containing 3,500 ordinary link records returned byte-identical JSON. Median projection time was 41.752 → 4.003 ms.
- The standard harness ran three samples per case with official Kujo 1.5.0 and the same browser build. The quick many-links median was 3.261 → 2.529 s. Trivial bridge startup varied between runs, with final medians of 2.112 → 2.312 s for the pure bridge and 2.912 → 3.375 s for the full CLI. These runs show variation in whole-process startup and do not establish a general latency improvement.
- The five alternating many-links pairs recorded medians of 2.523 → 2.578 s and a median paired difference of +0.017 s. The diagnostic interval from −0.345 to +0.066 s includes zero. This isolates the projection gain from the variability of browser startup.
- The final bridge suite passed 62 tests with real Chromium on Node 24.22.1. On Node 22.23.4 and 26.12.1, 38 tests passed with eight browser-only cases skipped. Kennel manifest validation and the source archive check passed.
