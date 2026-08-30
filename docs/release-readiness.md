# Release Readiness

Use this checklist for every Lens GitHub release.

## Version consistency

Set the same release version in:

- `src/config.kujo` (`lens_version()`)
- `kennel.toml`
- `kujo.toml`
- `lens.spec.yml`
- `README.md` version badge
- `bridge/package.json` and `bridge/package-lock.json`
- `tests/lens_tests.kujo`
- versioned headings in `docs/getting-started.md` and `docs/reference.md`
- `CHANGELOG.md`

The private browser bridge tracks the Lens release version so a repository-wide
version audit has one unambiguous answer.

## Release gates

1. Move the release notes from `Unreleased` to a dated version heading in
   `CHANGELOG.md`.
2. Run `kujo run tests/lens_tests.kujo`.
3. Run `npm test --prefix bridge` and syntax-check all bridge entrypoints.
4. Run `npm audit --omit=dev --prefix bridge`.
5. Parse `action.yml`, CI workflows, and `lens.spec.yml` as YAML.
6. Verify every version surface above matches exactly.
7. Confirm `main` is clean and synchronized with `origin/main`.
8. Commit and push the release metadata.
9. Create and push an annotated `vX.Y.Z` tag at the intended `main` commit.
10. Publish the GitHub release from that exact tag, then verify it is marked
    Latest and that the tag, release target, local `main`, and `origin/main`
    resolve to the intended release commit.
