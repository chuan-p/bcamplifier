#!/usr/bin/env python3

import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent.parent
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8767


class FixtureHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.split("?", 1)[0] in {
            "/fixturefan",
            "/fixturefan/following/extra",
        }:
            self.send_file(
                ROOT_DIR / "fixtures" / "fan-profile" / "index.html",
                "text/html; charset=utf-8",
            )
            return
        if self.path.split("?", 1)[0] == "/bcamplifier.user.js":
            self.send_file(
                ROOT_DIR / "bcamplifier.user.js",
                "application/javascript; charset=utf-8",
            )
            return

        self.send_error(404)

    def send_file(self, path, content_type):
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format, *_args):
        return


ThreadingHTTPServer(("127.0.0.1", PORT), FixtureHandler).serve_forever()
