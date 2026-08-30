#!/usr/bin/env bash
# Deterministic Lens benchmark harness. Prints medians and optionally writes a
# machine-readable receipt for regression comparison.

set -euo pipefail

ITERS="${1:-8}"
JSON_OUT="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT="${LENS_BENCH_TARGET_ROOT:-$HARNESS_ROOT}"
if [[ -z "${KUJO_BIN:-}" ]]; then
  if [[ -x "$ROOT/../kujo/target/release/kujo" ]]; then
    export KUJO_BIN="$ROOT/../kujo/target/release/kujo"
  else
    export KUJO_BIN="$ROOT/../kujo/target/debug/kujo"
  fi
fi

PORT="${LENS_BENCH_PORT:-9972}"
WORK="$(mktemp -d)"
FIXTURE_PID=""
cleanup() {
  if [[ -n "$FIXTURE_PID" ]]; then
    kill "$FIXTURE_PID" 2>/dev/null || true
    wait "$FIXTURE_PID" 2>/dev/null || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT

median() { sort -n | awk '{a[NR]=$1} END{ if(NR==0){print "n/a"} else if(NR%2){print a[(NR+1)/2]} else {print (a[NR/2]+a[NR/2+1])/2} }'; }

time_run() {
  local allowed_exit="$1" t0 t1 status
  shift
  t0=$(python3 -c 'import time; print(time.perf_counter())')
  set +e
  "$@" >/dev/null 2>&1
  status=$?
  set -e
  if (( status > allowed_exit )); then
    echo "benchmark command failed with exit $status: $*" >&2
    return "$status"
  fi
  t1=$(python3 -c 'import time; print(time.perf_counter())')
  python3 - "$t0" "$t1" <<'PY'
import sys
print(float(sys.argv[2]) - float(sys.argv[1]))
PY
}

python3 "$SCRIPT_DIR/benchmark-fixture-server.py" --port "$PORT" >/dev/null 2>&1 &
FIXTURE_PID=$!
sleep 1
BASE_URL="http://127.0.0.1:$PORT"

node "$ROOT/bridge/browser-bridge.js" --url "$BASE_URL/trivial" \
  --viewports desktop --timeout 30 --screenshot-dir "$WORK/warm" --format json >/dev/null 2>&1 || true

bench_bridge() {
  local path="$1"
  for _ in $(seq 1 "$ITERS"); do
    time_run 0 node "$ROOT/bridge/browser-bridge.js" --url "$BASE_URL/$path" \
      --viewports desktop,mobile --timeout 30 --screenshot-dir "$WORK/shots" --format json
  done | median
}

bench_cli() {
  local path="$1"
  for _ in $(seq 1 "$ITERS"); do
    time_run 1 "$ROOT/lens" check "$BASE_URL/$path" --out "$WORK/run"
  done | median
}

bench_quick() {
  local path="$1"
  for _ in $(seq 1 "$ITERS"); do
    time_run 1 "$ROOT/lens" check "$BASE_URL/$path" --quick --out "$WORK/quick-run"
  done | median
}

bridge_trivial="$(bench_bridge trivial)"
bridge_realistic="$(bench_bridge realistic)"
cli_trivial="$(bench_cli trivial)"
cli_realistic="$(bench_cli realistic)"
quick_trivial="$(bench_quick trivial)"
quick_realistic="$(bench_quick realistic)"
quick_spa="$(bench_quick spa)"
quick_images="$(bench_quick image-heavy)"
quick_late="$(bench_quick late-network)"
quick_links="$(bench_quick many-links)"

echo "Lens benchmark — median of $ITERS iterations (seconds, lower is better)"
echo "----------------------------------------------------------------"
printf "%-36s %s\n" "bridge trivial (desktop+mobile):" "$bridge_trivial"
printf "%-36s %s\n" "bridge realistic (desktop+mobile):" "$bridge_realistic"
printf "%-36s %s\n" "cli trivial:" "$cli_trivial"
printf "%-36s %s\n" "cli realistic:" "$cli_realistic"
printf "%-36s %s\n" "quick trivial:" "$quick_trivial"
printf "%-36s %s\n" "quick realistic:" "$quick_realistic"
printf "%-36s %s\n" "quick SPA-like:" "$quick_spa"
printf "%-36s %s\n" "quick image-heavy:" "$quick_images"
printf "%-36s %s\n" "quick late-network:" "$quick_late"
printf "%-36s %s\n" "quick many-links:" "$quick_links"

if [[ -n "$JSON_OUT" ]]; then
  python3 - "$JSON_OUT" "$ITERS" "$bridge_trivial" "$bridge_realistic" \
    "$cli_trivial" "$cli_realistic" "$quick_trivial" "$quick_realistic" \
    "$quick_spa" "$quick_images" "$quick_late" "$quick_links" <<'PY'
import json
import platform
import sys
from pathlib import Path

names = [
    "bridge_trivial", "bridge_realistic", "cli_trivial", "cli_realistic",
    "quick_trivial", "quick_realistic", "quick_spa", "quick_image_heavy",
    "quick_late_network", "quick_many_links",
]
payload = {
    "schema_version": 1,
    "iterations": int(sys.argv[2]),
    "unit": "seconds",
    "lower_is_better": True,
    "environment": {"system": platform.system(), "machine": platform.machine()},
    "medians": {name: float(value) for name, value in zip(names, sys.argv[3:])},
}
Path(sys.argv[1]).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
PY
fi
