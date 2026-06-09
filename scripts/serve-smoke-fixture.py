#!/usr/bin/env python3

import ssl
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def build_label_root_html(port: str):
    return f"""<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta property="og:site_name" content="Bandcamp" />
    <title>Fixture Label</title>
  </head>
  <body>
    <div id="band-navbar"></div>
    <script
      data-band='{{"id":654,"name":"Fixture Label","https_url":"https://fixture.bandcamp.com:{port}","is_label":true,"has_public_tralbums":true}}'
      data-tralbum='{{"url":"https://fixture.bandcamp.com:{port}/music"}}'
    ></script>
    <ol id="music-grid">
      <li data-item-id="album-321" class="music-grid-item">
        <a href="https://fixture.bandcamp.com:{port}/album/synthetic-release">Synthetic Release</a>
      </li>
    </ol>
  </body>
</html>"""


def load_fixture(root_dir: Path, mode: str, port: str):
    fixtures_dir = root_dir / "fixtures" / mode
    feed_html = (fixtures_dir / "feed.html").read_text(encoding="utf-8").replace(
        "__PORT__", port
    )
    release_html = (
        fixtures_dir / "release.html"
    ).read_text(encoding="utf-8").replace("__PORT__", port)
    label_root_html = build_label_root_html(port)

    userscript_body = ""
    if mode == "userscript":
        userscript_body = (root_dir / "dist" / "bcamplifier.user.js").read_text(
            encoding="utf-8"
        )

    return feed_html, release_html, label_root_html, userscript_body


def make_handler(
    mode: str,
    feed_html: str,
    release_html: str,
    label_root_html: str,
    userscript_body: str,
):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            host = (self.headers.get("Host") or "").split(":", 1)[0]

            if mode == "userscript" and self.path == "/dist/bcamplifier.user.js":
                self.respond(
                    userscript_body, "application/javascript; charset=utf-8"
                )
                return

            if host == "bandcamp.com" and self.path == "/feed":
                self.respond(feed_html)
                return

            if host == "fixture.bandcamp.com" and self.path.startswith("/?"):
                self.respond(label_root_html)
                return

            if host in {"shop.fixture.example", "fixture.bandcamp.com"} and self.path == "/album/synthetic-release":
                self.respond(release_html)
                return

            if host == "fixture.bandcamp.com" and self.path.startswith("/audio/"):
                self.respond("", content_type="audio/mpeg")
                return

            self.send_response(404)
            self.end_headers()

        def log_message(self, format, *args):
            return

        def respond(self, body, content_type="text/html; charset=utf-8"):
            payload = body.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    return Handler


def main():
    if len(sys.argv) != 6:
        raise SystemExit(
            "usage: serve-smoke-fixture.py <root_dir> <mode> <port> <cert_path> <key_path>"
        )

    root_dir = Path(sys.argv[1])
    mode = sys.argv[2]
    port = sys.argv[3]
    cert_path = sys.argv[4]
    key_path = sys.argv[5]

    if mode not in {"extension", "userscript"}:
        raise SystemExit(f"unsupported fixture mode: {mode}")

    feed_html, release_html, label_root_html, userscript_body = load_fixture(
        root_dir,
        mode,
        port,
    )
    handler = make_handler(
        mode,
        feed_html,
        release_html,
        label_root_html,
        userscript_body,
    )

    httpd = ThreadingHTTPServer(("127.0.0.1", int(port)), handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certfile=cert_path, keyfile=key_path)
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
