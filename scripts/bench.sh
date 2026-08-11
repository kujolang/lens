#!/usr/bin/env bash
# bench.sh — Lens performance benchmark harness.
#
# Measures median wall-clock for the browser bridge and the full CLI against
# two fixtures: a trivial static page and a realistic page (per-request
# latency + subresources). Use it to catch performance regressions — capture
# medians before and after a change and compare.
#
# Usage:
#   scripts/bench.sh [iterations]   # default 8
#
# Requires: python3, node, a built kujo (KUJO_BIN or ../kujo/target/debug/kujo).

set -euo pipefail

ITERS="${1:-8}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [[ -z "${KUJO_BIN:-}" ]]; then
  if [[ -x "$ROOT/../kujo/target/release/kujo" ]]; then
    export KUJO_BIN="$ROOT/../kujo/target/release/kujo"
  else
    export KUJO_BIN="$ROOT/../kujo/target/debug/kujo"
  fi
fi

TRIVIAL_PORT=9971
REALISTIC_PORT=9972
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; kill ${TRIVIAL_PID:-0} ${REALISTIC_PID:-0} 2>/dev/null || true' EXIT

median() { sort -n | awk '{a[NR]=$1} END{ if(NR==0){print "n/a"} else if(NR%2){print a[(NR+1)/2]} else {print (a[NR/2]+a[NR/2+1])/2} }'; }

time_run() { # $@ = command; prints elapsed seconds
  local t0 t1
  t0=$(date +%s.%N); "$@" >/dev/null 2>&1 || true; t1=$(date +%s.%N)
  echo "$t1 - $t0" | bc
}

# ── Fixtures ──────────────────────────────────────────────────────────
python3 -m http.server "$TRIVIAL_PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
TRIVIAL_PID=$!

cat > "$WORK/realistic.py" <<EOF
import http.server, socketserver, time
PAGE = b"""<!doctype html><html><head><title>App</title>
<link rel=stylesheet href=a.css><link rel=stylesheet href=b.css>
<script src=x.js></script><script src=y.js></script></head>
<body><h1>Dashboard</h1><main><p>Hello</p></main></body></html>"""
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_GET(self):
        time.sleep(0.6)
        if self.path=='/' or self.path.endswith('.html'):
            self.send_response(200); self.send_header('Content-Type','text/html'); self.end_headers(); self.wfile.write(PAGE)
        elif self.path.endswith('.css'):
            self.send_response(200); self.send_header('Content-Type','text/css'); self.end_headers(); self.wfile.write(b'body{margin:0}')
        else:
            self.send_response(200); self.send_header('Content-Type','application/javascript'); self.end_headers(); self.wfile.write(b'console.log(1)')
with socketserver.ThreadingTCPServer(('127.0.0.1',$REALISTIC_PORT),H) as s: s.serve_forever()
EOF
python3 "$WORK/realistic.py" >/dev/null 2>&1 &
REALISTIC_PID=$!
sleep 1

# ── Warm Chromium so the launch cost isn't counted as a cold outlier ──
node "$ROOT/bridge/browser-bridge.js" --url "http://127.0.0.1:$TRIVIAL_PORT" \
  --viewports desktop --timeout 30 --screenshot-dir "$WORK/warm" --format json >/dev/null 2>&1 || true

bench_bridge() { # $1 = url
  for _ in $(seq 1 "$ITERS"); do
    time_run node "$ROOT/bridge/browser-bridge.js" --url "$1" \
      --viewports desktop,mobile --timeout 30 --screenshot-dir "$WORK/shots" --format json
  done | median
}

bench_cli() { # $1 = url
  for _ in $(seq 1 "$ITERS"); do
    time_run "$ROOT/lens" check "$1" --out "$WORK/run"
  done | median
}

bench_cli_quick() { # $1 = url
  for _ in $(seq 1 "$ITERS"); do
    time_run "$ROOT/lens" check "$1" --quick --out "$WORK/quick-run"
  done | median
}

echo "Lens benchmark — median of $ITERS iterations (seconds, lower is better)"
echo "---------------------------------------------------------------"
printf "%-32s %s\n" "bridge  trivial (desktop+mobile):"   "$(bench_bridge "http://127.0.0.1:$TRIVIAL_PORT")"
printf "%-32s %s\n" "bridge  realistic (desktop+mobile):" "$(bench_bridge "http://127.0.0.1:$REALISTIC_PORT/")"
printf "%-32s %s\n" "cli     trivial:"                    "$(bench_cli "http://127.0.0.1:$TRIVIAL_PORT")"
printf "%-32s %s\n" "cli     realistic:"                  "$(bench_cli "http://127.0.0.1:$REALISTIC_PORT/")"
printf "%-32s %s\n" "cli quick trivial:"                  "$(bench_cli_quick "http://127.0.0.1:$TRIVIAL_PORT")"
printf "%-32s %s\n" "cli quick realistic:"                "$(bench_cli_quick "http://127.0.0.1:$REALISTIC_PORT/")"
