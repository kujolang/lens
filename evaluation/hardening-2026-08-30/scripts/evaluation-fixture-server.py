#!/usr/bin/env python3
"""Deterministic local workloads for the Lens hardening comparison."""

from __future__ import annotations

import argparse
import http.server
import json
from urllib.parse import parse_qs, urlparse


def bounded_int(query: dict[str, list[str]], name: str, default: int, maximum: int) -> int:
    try:
        return max(0, min(int(query.get(name, [str(default)])[0]), maximum))
    except (TypeError, ValueError):
        return default


def page(body: str, script: str = "") -> bytes:
    return (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width'><title>Lens evaluation</title>"
        f"</head><body><main>{body}</main>{script}</body></html>"
    ).encode("utf-8")


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def send_body(self, status: int, content_type: str, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self) -> None:  # noqa: N802 -- BaseHTTPRequestHandler contract
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path in ("/", "/trivial"):
            self.send_body(200, "text/html; charset=utf-8", page("<h1>Ready</h1><p>Minimal fixture.</p>"))
            return
        if parsed.path == "/realistic":
            cards = "".join(f"<article><h2>Card {i}</h2><p>Representative content.</p></article>" for i in range(40))
            links = "".join(f"<a href='/page/{i}'>Page {i}</a>" for i in range(100))
            self.send_body(200, "text/html; charset=utf-8", page(f"<h1>Dashboard</h1>{cards}{links}"))
            return
        if parsed.path == "/scale":
            count = bounded_int(query, "links", 10, 20000)
            links = "".join(f"<a href='/page/{i}'>Page {i}</a> " for i in range(count))
            self.send_body(200, "text/html; charset=utf-8", page(f"<h1>Scale {count}</h1>{links}"))
            return
        if parsed.path == "/noisy":
            console_count = bounded_int(query, "console", 0, 20000)
            network_count = bounded_int(query, "network", 0, 5000)
            links_count = bounded_int(query, "links", 0, 20000)
            links = "".join(f"<a href='/page/{i}'>Page {i}</a> " for i in range(links_count))
            script = (
                "<script>"
                f"for(let i=0;i<{console_count};i++)console.error('fixture-error-'+i);"
                f"for(let i=0;i<{network_count};i++)fetch('/missing?id='+i);"
                "</script>"
            )
            self.send_body(200, "text/html; charset=utf-8", page(f"<h1>Noisy</h1>{links}", script))
            return
        if parsed.path == "/agent":
            script = (
                "<script>for(let i=0;i<3;i++)console.error('agent-error-'+i);"
                "for(let i=0;i<2;i++)fetch('/missing?agent='+i);</script>"
            )
            links = "".join(f"<a href='/page/{i}'>Page {i}</a> " for i in range(100))
            self.send_body(200, "text/html; charset=utf-8", page(f"<h1>Agent workload</h1>{links}", script))
            return
        if parsed.path.startswith("/page/"):
            self.send_body(200, "text/html; charset=utf-8", page("<h1>Linked page</h1>"))
            return
        if parsed.path == "/missing":
            self.send_body(404, "application/json", json.dumps({"error": "fixture"}).encode("utf-8"))
            return
        self.send_body(404, "text/plain; charset=utf-8", b"not found")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9984)
    args = parser.parse_args()
    http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
