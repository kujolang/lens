#!/usr/bin/env python3
"""Compare two bench.sh JSON receipts and report median regressions."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def load_medians(path: str) -> dict[str, float]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if payload.get("schema_version") != 1 or payload.get("unit") != "seconds":
        raise ValueError(f"unsupported benchmark receipt: {path}")
    medians = payload.get("medians")
    if not isinstance(medians, dict) or not medians:
        raise ValueError(f"benchmark receipt has no medians: {path}")
    return {str(name): float(value) for name, value in medians.items()}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("before")
    parser.add_argument("after")
    parser.add_argument("--threshold-percent", type=float, default=20.0)
    parser.add_argument("--warn-only", action="store_true")
    args = parser.parse_args()

    before = load_medians(args.before)
    after = load_medians(args.after)
    if set(before) != set(after):
        missing = sorted(set(before) - set(after))
        added = sorted(set(after) - set(before))
        print(f"ERROR: benchmark metric sets differ; missing={missing}, added={added}")
        return 2
    regressions: list[str] = []
    for name in sorted(before):
        old = float(before[name])
        new = float(after[name])
        delta = 0.0 if old == 0 else ((new - old) / old) * 100.0
        print(f"{name}: {old:.3f}s -> {new:.3f}s ({delta:+.1f}%)")
        if delta > args.threshold_percent:
            regressions.append(f"{name} regressed {delta:.1f}%")

    if regressions:
        prefix = "::warning::" if args.warn_only else "ERROR: "
        print(prefix + "; ".join(regressions))
        return 0 if args.warn_only else 1
    print(f"No median exceeded the {args.threshold_percent:.1f}% regression threshold.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
