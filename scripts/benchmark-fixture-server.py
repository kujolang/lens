#!/usr/bin/env python3
"""Deterministic local fixtures for Lens performance and CI coverage."""

from __future__ import annotations

import argparse
import http.server
import json
import time
from urllib.parse import urlparse


def html(body: str, scripts: str = "") -> bytes:
    return (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width'><title>Lens Fixture</title>"
        "</head><body><main>" + body + "</main>" + scripts + "</body></html>"
    ).encode()


class FixtureHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        return

    def send(self, status: int, content_type: str, body: bytes) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler contract
        path = urlparse(self.path).path
        if path in ("/", "/trivial"):
            self.send(200, "text/html; charset=utf-8", html("<h1>Trivial</h1><p>Ready</p>"))
            return
        if path == "/realistic":
            time.sleep(0.15)
            body = "<h1>Dashboard</h1><p>Representative server latency.</p>"
            scripts = "<script src='/assets/app.js'></script><link rel='stylesheet' href='/assets/app.css'>"
            self.send(200, "text/html; charset=utf-8", html(body, scripts))
            return
        if path == "/spa":
            scripts = (
                "<script>fetch('/api/spa').then(r=>r.json()).then(d=>{"
                "document.querySelector('#state').textContent=d.state;});</script>"
            )
            self.send(200, "text/html; charset=utf-8", html("<h1>SPA</h1><p id='state'>Loading</p>", scripts))
            return
        if path == "/image-heavy":
            images = "".join(f"<img alt='fixture {i}' src='/assets/image-{i}.svg'>" for i in range(24))
            self.send(200, "text/html; charset=utf-8", html("<h1>Images</h1>" + images))
            return
        if path == "/late-network":
            scripts = (
                "<script>setTimeout(()=>fetch('/api/late').then(r=>r.json()).then(d=>{"
                "document.querySelector('#late').textContent=d.state;}),200);</script>"
            )
            self.send(200, "text/html; charset=utf-8", html("<h1>Late network</h1><p id='late'>Waiting</p>", scripts))
            return
        if path == "/many-links":
            links = "".join(f"<a href='/page/{i}'>Page {i}</a> " for i in range(250))
            self.send(200, "text/html; charset=utf-8", html("<h1>Many links</h1>" + links))
            return
        if path.startswith("/page/"):
            self.send(200, "text/html; charset=utf-8", html("<h1>Linked page</h1>"))
            return
        if path == "/api/spa":
            time.sleep(0.12)
            self.send(200, "application/json", json.dumps({"state": "Ready"}).encode())
            return
        if path == "/api/late":
            time.sleep(0.6)
            self.send(200, "application/json", json.dumps({"state": "Settled"}).encode())
            return
        if path == "/assets/app.js":
            time.sleep(0.08)
            self.send(200, "application/javascript", b"document.body.dataset.ready='true';")
            return
        if path == "/assets/app.css":
            time.sleep(0.08)
            self.send(200, "text/css", b"body{font-family:system-ui;margin:2rem}img{width:64px;height:64px}")
            return
        if path.startswith("/assets/image-") and path.endswith(".svg"):
            time.sleep(0.03)
            svg = b"<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64'><rect width='64' height='64' fill='black'/></svg>"
            self.send(200, "image/svg+xml", svg)
            return
        self.send(404, "text/plain; charset=utf-8", b"not found")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=9972)
    args = parser.parse_args()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), FixtureHandler)
    server.serve_forever()


if __name__ == "__main__":
    main()
