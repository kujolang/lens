# Summary

What this change does and why.

## Verification gauntlet

See [CONTRIBUTING.md](../CONTRIBUTING.md). Confirm each:

- [ ] Branched off `main`
- [ ] Added tests; full suite passes and the count went up (`kujo run tests/lens_tests.kujo`)
- [ ] Bridge changed? `node --check` + `node --test` in `bridge/` pass
- [ ] No performance regression (compared `scripts/bench.sh` medians; delta noted below)
- [ ] No new secret-leak surface (ran with a `?token=…` URL and grepped artifacts; extended `src/redact.kujo` + added a redaction test if needed)
- [ ] Docs updated (`README.md`, `docs/`, `lens --help`) as applicable
- [ ] Version + `CHANGELOG.md` updated if user-facing

## Never-regress invariants

- [ ] No AI/LLM in the check path
- [ ] Localhost-only by default
- [ ] No unredacted secrets in any artifact
- [ ] Deterministic output (same input → same report)
- [ ] No browser state mutation outside an explicit, opted-in flow step

## Performance delta

```
# scripts/bench.sh before/after medians, if relevant
```

## Notes for reviewers
