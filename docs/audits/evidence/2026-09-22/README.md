# Measurement receipts

These are observations, not universal performance guarantees. Read the audit's limitations before comparing wall times. The lookup-optimized implementation benchmark (before the final userinfo-pattern correction) alternates baseline/current execution order, three samples per case. The host became severely contended during it. Allowed exit 1 includes check failures, so these wall times alone also cannot establish equivalent successful work.

- `before.json`: original ten-case benchmark.
- `runtime-intermediate.json`: completed ten-case run before the final sensitive-name lookup optimization; not final code timing.
- `paired-runtime.json`: lookup-optimized code and archived baseline alternating samples.
- `host-contention.json`: observed host load and harness timeouts.
- `visual-performance.json`: three independent runs per side, alternating order; process peak RSS in bytes on macOS.
- `axe-transport.json`: raw-versus-projected JSON bytes for a synthetic 500-node axe result. The projection is exercised in `bridge/test/bridge.test.js`.
- `dependency-audit.json`: npm advisory receipt.
- `runtime-recursion.txt`: upstream runtime reproduction output; full source is in the audit.

The `.py.txt` files preserve the exact one-off measurement scripts as evidence, not supported project tools. To reproduce, copy them to `.lens/audit-2026-09-22/` under the Lens root. Run from that root. The visual script expects `visual-before.py` there (extract `bridge/visual-diff.py` from starting commit `fd388efd4f55f3f844cf7de4fc541abfd07a6785`). Run `python3 .lens/audit-2026-09-22/bench-visual.py fixture`, then separate `before`/`after` subprocesses. It writes fixture/diff PNGs only in that ignored audit directory.

The paired script expects a complete `git archive` of the starting commit unpacked at `.lens/audit-2026-09-22/baseline-tree`, with its `bridge/node_modules` linked to the tested installed modules. It uses port 9973, a temporary artifact directory and the sibling release runtime; the fixture server is terminated in `finally`. Use an idle host and the same runtime/browser/dependency revisions for meaningful timing. Do not compare samples from changing code or treat the local measurements as a CI latency budget.
