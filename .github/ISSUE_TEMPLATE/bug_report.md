---
name: Bug report
about: Something Lens did wrong, with reproduction steps
title: "[bug] "
labels: bug
---

**What happened**
A clear description of the bug.

**Reproduction**
1. Command run (e.g. `lens check http://localhost:3000 --html`)
2. App / page under test (a minimal fixture if possible)
3. What you expected vs. what happened

**Lens output**
- Exit code:
- Terminal output (redact anything sensitive):
- Relevant lines from `lens-report.md` / `metadata.json`:

**Environment**
- Lens version (`lens --version`):
- OS:
- Node version (`node --version`, must be ≥ 18):
- Kujo version / commit:
- Browser engine (`--browser`, default chromium):

**Additional context**
Anything else that helps — config file, flow/spec file, screenshots.
