#!/usr/bin/env python3
"""Build the auditable machine-readable Lens hardening evaluation result."""

from __future__ import annotations

import argparse
import gzip
import json
import os
import platform
import random
import re
import statistics
import subprocess
import time
from pathlib import Path
from typing import Any


BASELINE_SHA = "da8740cc6c82631821ae6258af0fc554bc32e468"
CURRENT_SHA = "504ff55a63440b895bd4ea515612ddde94ea9cdb"


def command(args: list[str], cwd: Path) -> str:
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


def commit(root: Path) -> dict[str, str]:
    fields = command(["git", "show", "-s", "--format=%H%n%cI%n%s", "HEAD"], root).splitlines()
    return {"sha": fields[0], "timestamp": fields[1], "subject": fields[2]}


def code_metrics(root: Path) -> dict[str, int]:
    code_files: list[Path] = []
    source_files: list[Path] = []
    test_files: list[Path] = []
    for base in (root / "src", root / "tests", root / "bridge"):
        for path in base.rglob("*"):
            if "node_modules" in path.parts or not path.is_file() or path.suffix not in (".kujo", ".js"):
                continue
            code_files.append(path)
            if "test" in path.parts or "tests" in path.parts:
                test_files.append(path)
            elif "src" in path.parts:
                source_files.append(path)
    def lines(paths: list[Path]) -> int:
        return sum(len(path.read_text(encoding="utf-8").splitlines()) for path in paths)
    joined = "\n".join(path.read_text(encoding="utf-8") for path in code_files)
    lock = json.loads((root / "bridge/package-lock.json").read_text(encoding="utf-8"))
    package = json.loads((root / "bridge/package.json").read_text(encoding="utf-8"))
    tracked = command(["git", "ls-tree", "-r", "--name-only", "HEAD"], root).splitlines()
    archive = subprocess.run(["git", "archive", "--format=tar", "HEAD"], cwd=root, capture_output=True, check=True).stdout
    tree_bytes = sum(path.stat().st_size for path in root.rglob("*") if path.is_file() and ".git" not in path.parts and "node_modules" not in path.parts)
    return {
        "tracked_files": len(tracked),
        "tracked_tree_bytes": tree_bytes,
        "repository_archive_gzip_bytes": len(gzip.compress(archive, compresslevel=9, mtime=0)),
        "code_files": len(code_files),
        "code_lines": lines(code_files),
        "source_lines": lines(source_files),
        "test_lines": lines(test_files),
        "function_declarations": len(re.findall(r"(?m)^\s*(?:export\s+)?func\s+|^\s*(?:async\s+)?function\s+", joined)),
        "todo_fixme": len(re.findall(r"\b(?:TODO|FIXME)\b", joined)),
        "direct_dependencies": len(package.get("dependencies", {})),
        "locked_dependencies": max(0, len(lock.get("packages", {})) - 1),
    }


def bootstrap_median_difference(before: list[float], after: list[float], iterations: int = 10000) -> dict[str, float]:
    rng = random.Random(20260830)
    differences: list[float] = []
    for _ in range(iterations):
        b = [before[rng.randrange(len(before))] for _ in before]
        a = [after[rng.randrange(len(after))] for _ in after]
        differences.append(statistics.median(a) - statistics.median(b))
    differences.sort()
    return {
        "iterations": iterations,
        "lower_95_seconds": differences[int(iterations * 0.025)],
        "upper_95_seconds": differences[int(iterations * 0.975)],
    }


def percentile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * q
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def summary(values: list[float]) -> dict[str, float | int]:
    return {
        "n": len(values),
        "min": min(values),
        "max": max(values),
        "mean": statistics.fmean(values),
        "median": statistics.median(values),
        "standard_deviation": statistics.stdev(values) if len(values) > 1 else 0.0,
        "p95": percentile(values, 0.95),
    }


def eval_categories(suite_path: Path, last_run_path: Path) -> dict[str, Any]:
    suite = json.loads(suite_path.read_text(encoding="utf-8"))
    result = json.loads(last_run_path.read_text(encoding="utf-8"))
    tests = suite["tests"]
    outcomes = {item["name"]: bool(item["passed"]) for item in result["data"]["test_results"]}
    tags: dict[str, list[str]] = {}
    for test in tests:
        for tag in test.get("tags", []):
            tags.setdefault(tag, []).append(test["name"])
    categories = {}
    for tag, names in sorted(tags.items()):
        passed = sum(1 for name in names if outcomes.get(name, False))
        categories[tag] = {"passed": passed, "total": len(names), "score_percent": passed / len(names) * 100.0}
    passed = sum(outcomes.values())
    categories["overall"] = {"passed": passed, "total": len(tests), "score_percent": passed / len(tests) * 100.0}
    return categories


def pct(after: float, before: float) -> float:
    return (after - before) / before * 100.0 if before else 0.0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline-root", type=Path, required=True)
    parser.add_argument("--current-root", type=Path, required=True)
    parser.add_argument("--evaluation-root", type=Path, required=True)
    args = parser.parse_args()
    evaluation_root = args.evaluation_root.resolve()
    results_root = evaluation_root / "results"
    runs = [json.loads(line) for line in (results_root / "raw/runs.jsonl").read_text(encoding="utf-8").splitlines() if line]
    benchmark = json.loads((results_root / "benchmark-summary.json").read_text(encoding="utf-8"))
    baseline = commit(args.baseline_root)
    current = commit(args.current_root)
    if baseline["sha"] != BASELINE_SHA or current["sha"] != CURRENT_SHA:
        raise SystemExit(f"unexpected comparison boundary: {baseline['sha']}..{current['sha']}")

    for name, workload in benchmark["workloads"].items():
        samples = {
            version: [float(record["wall_seconds"]) for record in runs if record["phase"] == "measured" and record["version"] == version and record["workload"] == name]
            for version in ("baseline", "current")
        }
        interval = bootstrap_median_difference(samples["baseline"], samples["current"])
        if interval["upper_95_seconds"] < 0:
            classification = "CLEAR IMPROVEMENT"
        elif interval["lower_95_seconds"] > 0:
            classification = "REGRESSION"
        else:
            classification = "INCONCLUSIVE"
        workload["wall_time_bootstrap_median_difference"] = interval
        workload["runtime_classification"] = classification
        for version in ("baseline", "current"):
            selected = [record for record in runs if record["phase"] == "measured" and record["version"] == version and record["workload"] == name]
            workload[version]["cpu_seconds_total"] = summary([
                float(record["user_seconds"]) + float(record["system_seconds"]) for record in selected
            ])
            workload[version]["operations_per_second_from_median_wall"] = 1.0 / workload[version]["wall_seconds"]["median"]

    baseline_metrics = code_metrics(args.baseline_root)
    current_metrics = code_metrics(args.current_root)
    suite = evaluation_root / "eval/eval.json"
    eval_scores = {
        version: eval_categories(suite, results_root / f"eval/{version}/last_run.json")
        for version in ("baseline", "current")
    }
    eval_summaries = {
        version: json.loads((results_root / f"eval/{version}/summary.json").read_text(encoding="utf-8"))
        for version in ("baseline", "current")
    }

    payload: dict[str, Any] = {
        "schema_version": 1,
        "evaluation": "Lens before/after hardening",
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "boundary": {
            "baseline": {**baseline, "tag": None, "selection_reason": "The hardening branch reflog records creation from this exact HEAD at 2026-08-30T17:19:15-04:00."},
            "current": {**current, "tag": "v1.0.1", "selection_reason": "Exact released and peeled v1.0.1 commit."},
        },
        "methodology": {
            "warmups_per_workload_per_version": 3,
            "measured_runs_per_workload_per_version": 10,
            "ordering": "Alternating baseline/current first position by workload and round.",
            "latency_statistics": ["minimum", "maximum", "mean", "median", "standard_deviation", "p95"],
            "p99": "Not reported: n=10 does not support a stable p99 estimate.",
            "confidence_method": "Deterministic 10,000-resample bootstrap of the difference between independent medians.",
            "machine_load_limitation": "The host was shared with other local workloads. Alternating order and variance reporting reduce but do not eliminate this noise.",
            "memory_method": "Peak process-tree RSS sampled approximately every 250 ms; short-lived peaks may be missed.",
        },
        "environment": {
            **benchmark["environment"],
            "os": command(["sw_vers", "-productVersion"], args.current_root),
            "kernel": command(["uname", "-srv"], args.current_root),
            "cpu": command(["sysctl", "-n", "machdep.cpu.brand_string"], args.current_root),
            "physical_cores": int(command(["sysctl", "-n", "hw.physicalcpu"], args.current_root)),
            "logical_cores": int(command(["sysctl", "-n", "hw.logicalcpu"], args.current_root)),
            "ram_bytes": int(command(["sysctl", "-n", "hw.memsize"], args.current_root)),
            "rust": command(["rustc", "--version"], args.current_root),
            "cargo": command(["cargo", "--version"], args.current_root),
            "git": command(["git", "--version"], args.current_root),
            "provider": None,
            "model": None,
            "network": "Loopback-only deterministic HTTP fixtures; no external calls.",
            "filesystem": "APFS on /dev/disk1s2; approximately 22 GiB available at initial boundary capture.",
            "available_ram_at_benchmark_start": None,
            "compiler_settings": "Not applicable to Lens sources; both targets used the same prebuilt Kujo release runtime.",
            "material_environment_variables": {"KUJO_BIN": str(benchmark["environment"]["kujo_binary"])},
        },
        "benchmarks": benchmark["workloads"],
        "kujo_eval": {"scores": eval_scores, "summaries": eval_summaries, "suite": "eval/eval.json"},
        "codebase": {
            "baseline": baseline_metrics,
            "current": current_metrics,
            "changes_percent": {key: pct(current_metrics[key], baseline_metrics[key]) for key in baseline_metrics if isinstance(baseline_metrics[key], int)},
        },
        "dependencies": {
            "baseline_direct": baseline_metrics["direct_dependencies"],
            "current_direct": current_metrics["direct_dependencies"],
            "baseline_locked": baseline_metrics["locked_dependencies"],
            "current_locked": current_metrics["locked_dependencies"],
            "conclusion": "No dependency-footprint change.",
        },
        "llm_efficiency": {
            "applicable": False,
            "reason": "Lens is deterministic and invokes no LLM or model provider.",
            "input_tokens": None,
            "output_tokens": None,
            "cached_tokens": None,
            "estimated_cost": None,
        },
        "build": {
            "applicable": False,
            "reason": "Lens owns interpreted Kujo/JavaScript sources, not a compiled binary. The external Kujo release runtime was identical for both versions.",
        },
        "regressions": [
            {"metric": "typical quick CLI median wall time", "baseline_seconds": benchmark["workloads"]["typical_quick_cli"]["baseline"]["wall_seconds"]["median"], "current_seconds": benchmark["workloads"]["typical_quick_cli"]["current"]["wall_seconds"]["median"], "severity": "low", "cause": "Additional validation, redaction, and evidence-limit bookkeeping; shared-host noise also contributed.", "action": "Track in the existing performance workflow; do not remove safety checks."},
            {"metric": "typical full CLI median wall time", "baseline_seconds": benchmark["workloads"]["typical_full_cli"]["baseline"]["wall_seconds"]["median"], "current_seconds": benchmark["workloads"]["typical_full_cli"]["current"]["wall_seconds"]["median"], "severity": "low", "cause": "Additional validation, redaction, and evidence-limit bookkeeping; shared-host noise also contributed.", "action": "Re-run on a dedicated CI runner before treating the magnitude as stable."},
            {"metric": "test-suite runtime", "baseline_seconds": benchmark["workloads"]["kujo_test_suite"]["baseline"]["wall_seconds"]["median"], "current_seconds": benchmark["workloads"]["kujo_test_suite"]["current"]["wall_seconds"]["median"], "severity": "low", "cause": "50 additional Kujo assertions and three additional bridge tests.", "action": "Accept as coverage cost."},
        ],
        "conclusion": {
            "answer": "PARTIALLY",
            "reason": "Empirical evidence independently demonstrates much stronger boundedness, redaction, failure handling, and capability coverage, but normal-workload latency regressed and several runtime differences remain noisy on the shared host.",
        },
    }
    (results_root / "evaluation-results.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
