#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
DIST_DIR="$ROOT_DIR/dist"
CHROME_BIN=$("$ROOT_DIR/scripts/find-chrome.sh")
PORT=${PORT:-8766}
SERVER_LOG=${SERVER_LOG:-/tmp/bcampx-extension-fixture-server.log}
CERT_DIR=${CERT_DIR:-/tmp/bcampx-extension-cert}
TEST_URL=${TEST_URL:-https://bandcamp.com:${PORT}/feed}

if [ ! -d "$DIST_DIR/chrome" ] || [ ! -f "$DIST_DIR/chrome/manifest.json" ]; then
    echo "Chrome build output is missing. Run ./scripts/build-extension.sh first." >&2
    exit 1
fi

if node -e 'require.resolve("playwright")' >/dev/null 2>&1; then
    if [ "$(uname)" = "Linux" ] && [ -z "${DISPLAY:-}" ] && [ "${BCAMPX_XVFB_WRAPPED:-}" != "1" ]; then
        if command -v xvfb-run >/dev/null 2>&1; then
            exec env BCAMPX_XVFB_WRAPPED=1 xvfb-run -a "$0"
        fi
    fi
fi

rm -rf "$CERT_DIR"
mkdir -p "$CERT_DIR"

openssl req \
    -x509 \
    -newkey rsa:2048 \
    -keyout "$CERT_DIR/key.pem" \
    -out "$CERT_DIR/cert.pem" \
    -days 1 \
    -nodes \
    -subj "/CN=bandcamp.com" >/dev/null 2>&1

python3 - "$ROOT_DIR" "$PORT" "$CERT_DIR/cert.pem" "$CERT_DIR/key.pem" >"$SERVER_LOG" 2>&1 <<'PY' &
import ssl
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

root_dir, port, cert_path, key_path = sys.argv[1:5]
fixtures_dir = Path(root_dir) / "fixtures" / "extension"
feed_html = (fixtures_dir / "feed.html").read_text(encoding="utf-8").replace(
    "__PORT__", port
)
release_html = (fixtures_dir / "release.html").read_text(encoding="utf-8").replace(
    "__PORT__", port
)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        host = (self.headers.get("Host") or "").split(":", 1)[0]

        if host == "bandcamp.com" and self.path == "/feed":
            self.respond(feed_html)
            return

        if host == "fixture.bandcamp.com" and self.path == "/album/synthetic-release":
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


httpd = ThreadingHTTPServer(("127.0.0.1", int(port)), Handler)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(certfile=cert_path, keyfile=key_path)
httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
httpd.serve_forever()
PY
SERVER_PID=$!

cleanup() {
    kill "$SERVER_PID" >/dev/null 2>&1 || true
}

trap cleanup EXIT INT TERM

sleep 1

if node -e 'require.resolve("playwright")' >/dev/null 2>&1; then
    node - "$DIST_DIR/chrome" "$TEST_URL" <<'JS'
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const [extensionDir, testUrl] = process.argv.slice(2);
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "bcampx-smoke-"));

const checks = [
  ["data-bcampx-host", "webextension", "extension content host bridge initialized"],
  ["data-bcampx-script-loaded", "true", "shared core booted"],
  ["data-bcampx-page-kind", "feed", "page recognized as feed"],
  ["data-bcampx-init-state", "ready", "feed initializer finished"],
  ["data-bcampx-enhanced-count", "1", "one card enhanced"],
];

(async () => {
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      ignoreHTTPSErrors: true,
      args: [
        "--ignore-certificate-errors",
        `--host-resolver-rules=MAP bandcamp.com 127.0.0.1, MAP fixture.bandcamp.com 127.0.0.1, EXCLUDE localhost`,
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
      ],
    });

    const page = context.pages()[0] || (await context.newPage());
    await page.goto(testUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForFunction(
      () =>
        document.documentElement.getAttribute("data-bcampx-host") === "webextension" &&
        document.documentElement.getAttribute("data-bcampx-init-state") === "ready" &&
        document.documentElement.getAttribute("data-bcampx-enhanced-count") === "1",
      { timeout: 15000 },
    );

    const missing = await page.evaluate((expectedChecks) => {
      return expectedChecks
        .filter(([attribute, value]) => {
          return document.documentElement.getAttribute(attribute) !== value;
        })
        .map(([, , label]) => label);
    }, checks);

    const content = await page.content();
    if (!content.includes("Track One")) {
      missing.push("tracklist rendered");
    }
    if (!content.includes("Loading extra context")) {
      missing.push("extension enhancement shell rendered");
    }

    console.log("chrome_smoke_mode=playwright");
    console.log("chrome_smoke_fixture=" + (missing.length ? "failed" : "passed"));

    if (missing.length) {
      for (const label of missing) {
        console.log("missing=" + label);
      }
      console.log(content);
      process.exitCode = 1;
    }
  } catch (error) {
    console.log("chrome_smoke_mode=playwright");
    console.log("chrome_smoke_fixture=failed");
    console.log(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  } finally {
    if (context) {
      await context.close();
    }
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
})();
JS
else
    python3 - "$CHROME_BIN" "$DIST_DIR/chrome" <<'PY'
import shutil
import subprocess
import sys

chrome_bin, extension_dir = sys.argv[1:3]
profile_dir = "/tmp/bcampx-smoke-profile"
shutil.rmtree(profile_dir, ignore_errors=True)
cmd = [
    chrome_bin,
    "--headless=new",
    "--disable-gpu",
    "--dump-dom",
    f"--user-data-dir={profile_dir}",
    f"--disable-extensions-except={extension_dir}",
    f"--load-extension={extension_dir}",
    "about:blank",
]

try:
    result = subprocess.run(cmd, capture_output=True, timeout=12)
    stderr = result.stderr.decode("utf-8", "ignore")
    return_code = result.returncode
except subprocess.TimeoutExpired as exc:
    stderr = (exc.stderr or b"").decode("utf-8", "ignore")
    return_code = None

manifest_error = "manifest" in stderr.lower() and "error" in stderr.lower()
process_error = return_code not in (None, 0)

print("chrome_smoke_mode=fallback")
print("chrome_manifest_error=" + ("true" if manifest_error else "false"))
print("chrome_process_error=" + ("true" if process_error else "false"))

if manifest_error or process_error:
    print(stderr)
    sys.exit(1)
PY
fi
