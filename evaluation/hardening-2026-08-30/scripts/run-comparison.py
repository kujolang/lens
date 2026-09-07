#!/usr/bin/env python3
"""Run identical Lens workloads against exact baseline and current checkouts."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import platform
import re
import shutil
import signal
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any


TIME_RE = re.compile(r"^\s*([0-9.]+) real\s+([0-9.]+) user\s+([0-9.]+) sys\s*$", re.MULTILINE)
RSS_RE = re.compile(r"^\s*(\d+)\s+maximum resident set size\s*$", re.MULTILINE)


def percentile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * q
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return ordered[lower] * (1 - fraction) + ordered[upper] * fraction


def summarize(values: list[float]) -> dict[str, float | int]:
    return {
        "n": len(values),
        "min": min(values),
        "max": max(values),
        "mean": statistics.fmean(values),
        "median": statistics.median(values),
        "standard_deviation": statistics.stdev(values) if len(values) > 1 else 0.0,
        "p95": percentile(values, 0.95),
    }


def process_tree_rss(root_pid: int) -> int:
    proc = subprocess.run(
        ["ps", "-axo", "pid=,ppid=,rss="], capture_output=True, text=True, check=False
    )
    children: dict[int, list[int]] = {}
    rss: dict[int, int] = {}
    for line in proc.stdout.splitlines():
        parts = line.split()
        if len(parts) != 3:
            continue
        pid, ppid, kib = map(int, parts)
        children.setdefault(ppid, []).append(pid)
        rss[pid] = kib * 1024
    stack = [root_pid]
    seen: set[int] = set()
    total = 0
    while stack:
        pid = stack.pop()
        if pid in seen:
            continue
        seen.add(pid)
        total += rss.get(pid, 0)
        stack.extend(children.get(pid, []))
    return total


def directory_metrics(path: Path) -> tuple[int, int]:
    if not path.exists():
        return 0, 0
    files = [item for item in path.rglob("*") if item.is_file()]
    return len(files), sum(item.stat().st_size for item in files)


def extract_counts(stdout: bytes) -> dict[str, int]:
    try:
        payload = json.loads(stdout.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {}
    viewports = payload.get("viewports", []) if isinstance(payload, dict) else []
    if not isinstance(viewports, list):
        return {}
    counts = {
        "viewports": len(viewports),
        "console_messages": 0,
        "network_events": 0,
        "links": 0,
        "dropped_console_messages": 0,
        "dropped_network_events": 0,
    }
    for viewport in viewports:
        if not isinstance(viewport, dict):
            continue
        counts["console_messages"] += len(viewport.get("console_messages", []))
        counts["network_events"] += len(viewport.get("network_events", []))
        counts["links"] += len(viewport.get("links", []))
        limits = viewport.get("evidence_limits", {})
        if isinstance(limits, dict):
            counts["dropped_console_messages"] += int(limits.get("dropped_console_messages", 0))
            counts["dropped_network_events"] += int(limits.get("dropped_network_events", 0))
    return counts


def timed_run(command: list[str], cwd: Path, env: dict[str, str], artifact_dir: Path) -> tuple[dict[str, Any], bytes, bytes]:
    artifact_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="lens-eval-time-") as temp:
        stdout_path = Path(temp) / "stdout"
        stderr_path = Path(temp) / "stderr"
        with stdout_path.open("wb") as stdout_file, stderr_path.open("wb") as stderr_file:
            proc = subprocess.Popen(
                ["/usr/bin/time", "-l", *command], cwd=cwd, env=env,
                stdout=stdout_file, stderr=stderr_file, start_new_session=True,
            )
            peak_tree_rss = 0
            try:
                while proc.poll() is None:
                    peak_tree_rss = max(peak_tree_rss, process_tree_rss(proc.pid))
                    time.sleep(0.25)
                status = proc.wait()
            except BaseException:
                os.killpg(proc.pid, signal.SIGTERM)
                proc.wait(timeout=5)
                raise
        stdout = stdout_path.read_bytes()
        stderr = stderr_path.read_bytes()
    stderr_text = stderr.decode("utf-8", errors="replace")
    timing = TIME_RE.search(stderr_text)
    rss = RSS_RE.search(stderr_text)
    artifact_files, artifact_bytes = directory_metrics(artifact_dir)
    metrics: dict[str, Any] = {
        "exit_code": status,
        "wall_seconds": float(timing.group(1)) if timing else None,
        "user_seconds": float(timing.group(2)) if timing else None,
        "system_seconds": float(timing.group(3)) if timing else None,
        "max_rss_bytes_direct_process": int(rss.group(1)) if rss else None,
        "peak_rss_bytes_process_tree_sampled": peak_tree_rss,
        "stdout_bytes": len(stdout),
        "stdout_lines": len(stdout.splitlines()),
        "stderr_bytes_including_time_report": len(stderr),
        "artifact_files": artifact_files,
        "artifact_bytes": artifact_bytes,
        "stdout_sha256": hashlib.sha256(stdout).hexdigest(),
        "captured_counts": extract_counts(stdout),
    }
    return metrics, stdout, stderr


def environment(command: list[str], cwd: Path) -> str:
    return subprocess.run(command, cwd=cwd, capture_output=True, text=True, check=False).stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline-root", type=Path, required=True)
    parser.add_argument("--current-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--samples", type=int, default=10)
    parser.add_argument("--warmups", type=int, default=3)
    parser.add_argument("--port", type=int, default=9984)
    parser.add_argument("--only", help="comma-separated workload names; omitted runs all")
    parser.add_argument("--fresh", action="store_true", help="discard any checkpointed runs")
    args = parser.parse_args()
    if args.samples < 2 or args.warmups < 1:
        parser.error("samples must be >= 2 and warmups must be >= 1")

    script_dir = Path(__file__).resolve().parent
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    raw_dir = output / "raw"
    representative_dir = output / "representative"
    checkpoint = raw_dir / "runs.jsonl"
    for path in (raw_dir, representative_dir):
        if args.fresh and path.exists():
            shutil.rmtree(path)
        path.mkdir(parents=True, exist_ok=True)

    roots = {"baseline": args.baseline_root.resolve(), "current": args.current_root.resolve()}
    kujo_bin = Path(os.environ.get("KUJO_BIN", roots["current"].parent / "kujo/target/release/kujo"))
    if not kujo_bin.is_file():
        discovered = shutil.which("kujo")
        if not discovered:
            raise SystemExit("Kujo runtime not found; set KUJO_BIN")
        kujo_bin = Path(discovered)
    env = os.environ.copy()
    env["KUJO_BIN"] = str(kujo_bin)
    base_url = f"http://127.0.0.1:{args.port}"

    workloads = [
        {"name": "startup_version", "kind": "minimal", "allowed": [0], "command": ["{root}/lens", "--version"]},
        {"name": "minimal_bridge", "kind": "minimal", "allowed": [0], "command": ["node", "{root}/bridge/browser-bridge.js", "--url", f"{base_url}/trivial", "--viewports", "desktop", "--timeout", "30", "--settle-ms", "0", "--screenshot-dir", "{artifact}", "--format", "json"]},
        {"name": "typical_quick_cli", "kind": "typical", "allowed": [0, 1], "command": ["{root}/lens", "check", f"{base_url}/realistic", "--quick", "--out", "{artifact}"]},
        {"name": "typical_full_cli", "kind": "typical", "allowed": [0, 1], "command": ["{root}/lens", "check", f"{base_url}/realistic", "--out", "{artifact}"]},
        {"name": "large_links_bridge", "kind": "large", "allowed": [0], "command": ["node", "{root}/bridge/browser-bridge.js", "--url", f"{base_url}/scale?links=1000", "--viewports", "desktop", "--timeout", "30", "--settle-ms", "0", "--screenshot-dir", "{artifact}", "--format", "json"]},
        {"name": "stress_console_bridge", "kind": "stress", "allowed": [0], "command": ["node", "{root}/bridge/browser-bridge.js", "--url", f"{base_url}/noisy?console=5000", "--viewports", "desktop", "--timeout", "30", "--settle-ms", "0", "--screenshot-dir", "{artifact}", "--format", "json"]},
        {"name": "stress_network_bridge", "kind": "stress", "allowed": [0], "command": ["node", "{root}/bridge/browser-bridge.js", "--url", f"{base_url}/noisy?network=2200", "--viewports", "desktop", "--timeout", "30", "--settle-ms", "0", "--screenshot-dir", "{artifact}", "--format", "json"]},
        {"name": "failure_invalid_auth", "kind": "failure", "allowed": [2, 3], "command": ["{root}/lens", "check", f"{base_url}/trivial", "--quick", "--auth-file", "{missing_auth}", "--out", "{artifact}"]},
        {"name": "agent_quick_json", "kind": "agent-facing", "allowed": [1], "command": ["{root}/lens", "check", f"{base_url}/agent", "--quick", "--out", "{artifact}"]},
        {"name": "kujo_test_suite", "kind": "reliability", "allowed": [0], "command": ["{kujo}", "run", "{root}/tests/lens_tests.kujo"]},
        {"name": "bridge_test_suite", "kind": "reliability", "allowed": [0], "command": ["npm", "test", "--prefix", "{root}/bridge"]},
    ]
    for count in (10, 100, 1000, 5000, 10000):
        workloads.append({
            "name": f"scale_links_{count}", "kind": "scaling", "allowed": [0],
            "command": ["node", "{root}/bridge/browser-bridge.js", "--url", f"{base_url}/scale?links={count}", "--viewports", "desktop", "--timeout", "30", "--settle-ms", "0", "--screenshot-dir", "{artifact}", "--format", "json"],
        })
    all_workloads = workloads
    if args.only:
        selected_names = {name.strip() for name in args.only.split(",") if name.strip()}
        known_names = {workload["name"] for workload in workloads}
        unknown = selected_names - known_names
        if unknown:
            parser.error(f"unknown workload(s): {', '.join(sorted(unknown))}")
        workloads = [workload for workload in workloads if workload["name"] in selected_names]

    records: list[dict[str, Any]] = []
    if checkpoint.exists():
        for line in checkpoint.read_text(encoding="utf-8").splitlines():
            if line.strip():
                records.append(json.loads(line))
    completed = {
        (record["version"], record["workload"], record["phase"], int(record["sample_index"]))
        for record in records
    }

    server = subprocess.Popen(
        [sys.executable, str(script_dir / "evaluation-fixture-server.py"), "--port", str(args.port)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        time.sleep(1)
        total_rounds = args.warmups + args.samples
        for workload_index, workload in enumerate(workloads):
            for round_index in range(total_rounds):
                versions = ["baseline", "current"] if (round_index + workload_index) % 2 == 0 else ["current", "baseline"]
                for version in versions:
                    phase = "warmup" if round_index < args.warmups else "measured"
                    sample_index = round_index if phase == "warmup" else round_index - args.warmups
                    run_key = (version, workload["name"], phase, sample_index)
                    if run_key in completed:
                        continue
                    run_root = Path(tempfile.mkdtemp(prefix=f"lens-eval-{version[0]}-{workload['name']}-"))
                    artifact_dir = run_root / "artifacts"
                    missing_auth = run_root / "missing-auth.json"
                    command = [
                        part.format(root=roots[version], artifact=artifact_dir, missing_auth=missing_auth, kujo=kujo_bin)
                        for part in workload["command"]
                    ]
                    metrics, stdout, stderr = timed_run(command, roots[version], env, artifact_dir)
                    record = {
                        "version": version, "workload": workload["name"], "kind": workload["kind"],
                        "phase": phase, "sample_index": sample_index, **metrics,
                    }
                    records.append(record)
                    with checkpoint.open("a", encoding="utf-8") as handle:
                        handle.write(json.dumps(record, separators=(",", ":")) + "\n")
                        handle.flush()
                    completed.add(run_key)
                    if metrics["exit_code"] not in workload["allowed"]:
                        raise RuntimeError(f"unexpected exit {metrics['exit_code']} for {version}/{workload['name']}: {stderr[-2000:]!r}")
                    if phase == "measured" and sample_index == 0:
                        rep = representative_dir / version / workload["name"]
                        rep.mkdir(parents=True, exist_ok=True)
                        with gzip.open(rep / "stdout.gz", "wb") as handle:
                            handle.write(stdout)
                        with gzip.open(rep / "stderr.gz", "wb") as handle:
                            handle.write(stderr)
                        if artifact_dir.exists():
                            shutil.copytree(artifact_dir, rep / "artifacts", dirs_exist_ok=True)
                    shutil.rmtree(run_root)

        (raw_dir / "runs.json").write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")
        summaries: dict[str, Any] = {}
        fields = [
            "wall_seconds", "user_seconds", "system_seconds", "max_rss_bytes_direct_process",
            "peak_rss_bytes_process_tree_sampled", "stdout_bytes", "stdout_lines", "artifact_files", "artifact_bytes",
        ]
        for workload in all_workloads:
            name = workload["name"]
            complete = all(
                (version, name, "measured", sample_index) in completed
                for version in roots for sample_index in range(args.samples)
            )
            if not complete:
                continue
            summaries[name] = {"kind": workload["kind"]}
            for version in roots:
                selected = [r for r in records if r["phase"] == "measured" and r["workload"] == name and r["version"] == version]
                summaries[name][version] = {
                    field: summarize([float(r[field]) for r in selected if r[field] is not None]) for field in fields
                }
                summaries[name][version]["exit_codes"] = sorted({int(r["exit_code"]) for r in selected})
                summaries[name][version]["captured_counts"] = selected[0]["captured_counts"] if selected else {}
            before = summaries[name]["baseline"]["wall_seconds"]["median"]
            after = summaries[name]["current"]["wall_seconds"]["median"]
            summaries[name]["wall_median_change_percent"] = ((after - before) / before * 100.0) if before else None

        metadata = {
            "schema_version": 1,
            "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "baseline": {"sha": environment(["git", "rev-parse", "HEAD"], roots["baseline"]), "root": str(roots["baseline"])},
            "current": {"sha": environment(["git", "rev-parse", "HEAD"], roots["current"]), "root": str(roots["current"])},
            "method": {"warmups": args.warmups, "samples": args.samples, "order": "alternating per workload/round", "fixture_url": base_url},
            "environment": {
                "platform": platform.platform(), "machine": platform.machine(), "python": platform.python_version(),
                "node": environment(["node", "--version"], roots["current"]),
                "npm": environment(["npm", "--version"], roots["current"]),
                "kujo": environment([str(kujo_bin), "--version"], roots["current"]),
                "kujo_binary": str(kujo_bin),
            },
            "workloads": summaries,
        }
        (output / "benchmark-summary.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    finally:
        server.send_signal(signal.SIGTERM)
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
