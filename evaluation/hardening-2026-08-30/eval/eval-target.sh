#!/usr/bin/env bash
# Identical deterministic Kujo Eval checks for an exact Lens checkout.

set -euo pipefail

: "${LENS_EVAL_TARGET:?set LENS_EVAL_TARGET to an exact Lens checkout}"
: "${LENS_EVAL_KUJO:?set LENS_EVAL_KUJO to the Kujo runtime binary}"
export KUJO_BIN="$LENS_EVAL_KUJO"
cd "$LENS_EVAL_TARGET"

case "${1:-}" in
  kujo-tests)
    "$LENS_EVAL_KUJO" run tests/lens_tests.kujo
    ;;
  bridge-tests)
    npm test --prefix "$LENS_EVAL_TARGET/bridge"
    ;;
  version)
    "$LENS_EVAL_TARGET/lens" --version
    ;;
  missing-auth-exit)
    eval_tmp="$(mktemp -d)"
    trap 'rm -rf "$eval_tmp"' EXIT
    set +e
    "$LENS_EVAL_TARGET/lens" check http://127.0.0.1:1/trivial --quick \
      --auth-file "$eval_tmp/EVAL_SECRET_PATH_SHOULD_NOT_LEAK.json" \
      --out "$eval_tmp/output" >/dev/null 2>&1
    status=$?
    set -e
    [[ "$status" -eq 2 ]]
    ;;
  missing-auth-redaction)
    eval_tmp="$(mktemp -d)"
    trap 'rm -rf "$eval_tmp"' EXIT
    set +e
    output="$("$LENS_EVAL_TARGET/lens" check http://127.0.0.1:1/trivial --quick \
      --auth-file "$eval_tmp/EVAL_SECRET_PATH_SHOULD_NOT_LEAK.json" \
      --out "$eval_tmp/output" 2>&1)"
    set -e
    ! grep -Fq 'EVAL_SECRET_PATH_SHOULD_NOT_LEAK' <<<"$output"
    ;;
  console-bound)
    rg -q 'MAX_CONSOLE_MESSAGES = 1000' "$LENS_EVAL_TARGET/bridge/browser-bridge.js"
    rg -q 'dropped_console_messages' "$LENS_EVAL_TARGET/bridge/browser-bridge.js"
    ;;
  network-bound)
    rg -q 'MAX_NETWORK_EVENTS = 2000' "$LENS_EVAL_TARGET/bridge/browser-bridge.js"
    rg -q 'dropped_network_events' "$LENS_EVAL_TARGET/bridge/browser-bridge.js"
    ;;
  links-bound)
    rg -q 'MAX_CAPTURED_LINKS = 5000' "$LENS_EVAL_TARGET/bridge/browser-bridge.js"
    rg -q 'dropped_links' "$LENS_EVAL_TARGET/bridge/browser-bridge.js"
    ;;
  viewport-bound)
    rg -q 'MAX_VIEWPORT_DIMENSION = 4096' "$LENS_EVAL_TARGET/bridge/browser-bridge.js"
    rg -q 'MAX_VIEWPORT_DIMENSION' "$LENS_EVAL_TARGET/src/config.kujo"
    ;;
  write-path-validation)
    rg -q 'validate_config_write_paths' "$LENS_EVAL_TARGET/src/validate.kujo"
    rg -q 'path_is_symlink' "$LENS_EVAL_TARGET/src/validate.kujo"
    ;;
  malformed-provider-guard)
    rg -q 'Browser provider returned malformed JSON' "$LENS_EVAL_TARGET/src/provider.kujo"
    rg -q 'Browser bridge output was not valid JSON' "$LENS_EVAL_TARGET/src/provider.kujo"
    ;;
  accessibility-redaction)
    rg -q 'redact_accessibility_scans' "$LENS_EVAL_TARGET/src/redact.kujo"
    rg -q 'redact_accessibility_scans' "$LENS_EVAL_TARGET/src/runner.kujo"
    ;;
  limit-warning)
    rg -q 'check_capture_limits' "$LENS_EVAL_TARGET/src/checks.kujo"
    rg -q 'Browser evidence capture reached a safety limit' "$LENS_EVAL_TARGET/src/checks.kujo"
    ;;
  forced-overwrite)
    rg -Fq 'write_file(out_dir + "/lens-report.md", md_report, true)' "$LENS_EVAL_TARGET/src/runner.kujo"
    rg -Fq 'write_file(out_dir + "/lens-report.json", json_report, true)' "$LENS_EVAL_TARGET/src/runner.kujo"
    ;;
  *)
    echo "unknown check: ${1:-}" >&2
    exit 2
    ;;
esac
