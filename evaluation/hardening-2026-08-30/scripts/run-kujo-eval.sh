#!/usr/bin/env bash
# Run the same Kujo Eval suite against the two exact Lens checkouts.

set -euo pipefail

if [[ $# -ne 5 ]]; then
  echo "usage: $0 <eval-repo> <kujo-bin> <baseline-root> <current-root> <output-root>" >&2
  exit 2
fi

EVAL_REPO="$1"
KUJO_BIN_PATH="$2"
BASELINE_ROOT="$3"
CURRENT_ROOT="$4"
OUTPUT_ROOT="$5"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVALUATION_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SUITE="$EVALUATION_ROOT/eval/eval.json"
CHECK="$EVALUATION_ROOT/eval/eval-target.sh"

for required in "$EVAL_REPO/main.kujo" "$KUJO_BIN_PATH" "$BASELINE_ROOT/lens" "$CURRENT_ROOT/lens" "$SUITE" "$CHECK"; do
  [[ -e "$required" ]] || { echo "missing required path: $required" >&2; exit 2; }
done
[[ ! -e "$OUTPUT_ROOT" ]] || { echo "output root already exists: $OUTPUT_ROOT" >&2; exit 2; }
mkdir -p "$OUTPUT_ROOT"

cd "$EVAL_REPO"
"$KUJO_BIN_PATH" run main.kujo lint "$SUITE"

for version in baseline current; do
  target="$BASELINE_ROOT"
  [[ "$version" == current ]] && target="$CURRENT_ROOT"
  set +e
  LENS_CHECK="$CHECK" LENS_EVAL_TARGET="$target" LENS_EVAL_KUJO="$KUJO_BIN_PATH" \
    "$KUJO_BIN_PATH" run main.kujo run "$SUITE" \
      --output-dir "$OUTPUT_ROOT/$version" --artifact-checksums --quiet --no-color
  eval_exit=$?
  set -e
  if [[ "$version" == baseline && "$eval_exit" -ne 1 ]]; then
    echo "baseline Eval was expected to expose missing hardening capabilities" >&2
    exit 1
  fi
  if [[ "$version" == current && "$eval_exit" -ne 0 ]]; then
    echo "current Eval must pass" >&2
    exit 1
  fi
  "$KUJO_BIN_PATH" run main.kujo verify-manifest \
    --manifest "$OUTPUT_ROOT/$version/artifact-manifest.json" \
    --output-dir "$OUTPUT_ROOT/$version"
done

python3 - "$OUTPUT_ROOT" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
baseline = json.loads((root / "baseline/summary.json").read_text())
current = json.loads((root / "current/summary.json").read_text())
assert (baseline["passed"], baseline["total"]) == (4, 14), baseline
assert (current["passed"], current["total"]) == (14, 14), current
print("Kujo Eval comparison verified: 4/14 -> 14/14")
PY
