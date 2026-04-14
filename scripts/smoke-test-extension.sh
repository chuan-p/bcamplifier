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

python3 "$ROOT_DIR/scripts/serve-smoke-fixture.py" \
    "$ROOT_DIR" \
    extension \
    "$PORT" \
    "$CERT_DIR/cert.pem" \
    "$CERT_DIR/key.pem" >"$SERVER_LOG" 2>&1 &
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
const releaseUrl = (() => {
  const parsed = new URL(testUrl);
  return `https://fixture.bandcamp.com:${parsed.port}/album/synthetic-release`;
})();

const checks = [
  ["data-bcampx-host", "webextension", "extension content host bridge initialized"],
  ["data-bcampx-script-loaded", "true", "shared core booted"],
  ["data-bcampx-page-kind", "feed", "page recognized as feed"],
  ["data-bcampx-init-state", "ready", "feed initializer finished"],
  ["data-bcampx-enhanced-count", "2", "two cards enhanced"],
];

(async () => {
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      ignoreHTTPSErrors: true,
      args: [
        "--ignore-certificate-errors",
        `--host-resolver-rules=MAP bandcamp.com 127.0.0.1, MAP fixture.bandcamp.com 127.0.0.1, MAP shop.fixture.example 127.0.0.1, EXCLUDE localhost`,
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
        document.documentElement.getAttribute("data-bcampx-enhanced-count") === "2" &&
        document.querySelectorAll("#fixture-main-card .bcampx").length === 1 &&
        document.querySelectorAll("#fixture-delayed-card .bcampx").length === 1 &&
        document.querySelectorAll("#fixture-sidebar-card .bcampx").length === 0 &&
        (document.querySelector("#fixture-main-card .bcampx__facts")?.textContent || "").includes("2024") &&
        (document.querySelector("#fixture-main-card .bcampx__facts")?.textContent || "").includes("Shanghai") &&
        (document.querySelector("#fixture-delayed-card .bcampx__empty")?.textContent || "").includes("custom domain"),
      { timeout: 15000 },
    );

    const missing = await page.evaluate((expectedChecks) => {
      return expectedChecks
        .filter(([attribute, value]) => {
          return document.documentElement.getAttribute(attribute) !== value;
        })
        .map(([, , label]) => label);
    }, checks);

    const cardState = await page.evaluate(() => ({
      main: document.querySelectorAll("#fixture-main-card .bcampx").length,
      delayed: document.querySelectorAll("#fixture-delayed-card .bcampx").length,
      sidebar: document.querySelectorAll("#fixture-sidebar-card .bcampx").length,
      mainFacts:
        document.querySelector("#fixture-main-card .bcampx__facts")?.textContent || "",
      mainTrackTitles: Array.from(
        document.querySelectorAll("#fixture-main-card .bcampx__tracks li"),
      ).map((node) => node.textContent || ""),
      delayedMessage:
        document.querySelector("#fixture-delayed-card .bcampx__empty")?.textContent || "",
    }));
    if (cardState.main !== 1) {
      missing.push("main feed card enhanced");
    }
    if (cardState.delayed !== 1) {
      missing.push("delayed feed card recovered and enhanced");
    }
    if (cardState.sidebar !== 0) {
      missing.push("sidebar card remained filtered");
    }
    if (!cardState.mainFacts.includes("2024") || !cardState.mainFacts.includes("Shanghai")) {
      missing.push("main feed card rendered release facts");
    }
    if (!cardState.mainTrackTitles.includes("Track One")) {
      missing.push("main feed card rendered tracklist");
    }
    if (!/custom domain/i.test(cardState.delayedMessage)) {
      missing.push("custom-domain release showed limitation message");
    }

    const releasePage = await context.newPage();
    await releasePage.goto(releaseUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await releasePage.waitForFunction(
      () =>
        document.documentElement.getAttribute("data-bcampx-host") === "webextension" &&
        document.documentElement.getAttribute("data-bcampx-script-loaded") === "true" &&
        document.documentElement.getAttribute("data-bcampx-page-kind") === "other",
      { timeout: 15000 },
    );
    const releaseChecks = await releasePage.evaluate(() => ({
      host: document.documentElement.getAttribute("data-bcampx-host"),
      loaded: document.documentElement.getAttribute("data-bcampx-script-loaded"),
      pageKind: document.documentElement.getAttribute("data-bcampx-page-kind"),
    }));
    if (releaseChecks.host !== "webextension") {
      missing.push("bandcamp release page host bridge initialized");
    }
    if (releaseChecks.loaded !== "true") {
      missing.push("bandcamp release page core booted");
    }
    if (releaseChecks.pageKind !== "other") {
      missing.push("bandcamp release page recognized as non-feed page");
    }
    await releasePage.close();

    console.log("chrome_smoke_mode=playwright");
    console.log("chrome_smoke_fixture=" + (missing.length ? "failed" : "passed"));

    if (missing.length) {
      for (const label of missing) {
        console.log("missing=" + label);
      }
      console.log(JSON.stringify(cardState, null, 2));
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
